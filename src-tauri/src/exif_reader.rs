use std::io::Cursor;
use std::sync::OnceLock;
use exif::{Context, In, Reader, Tag, Value};
use crate::models::ExifData;

/// Lens info is read from the standard EXIF "LensID" tag, which is stored in
/// the same IFD slot as LensModel (tag 0xA434 / decimal 42036).
const LENS_ID_TAG: Tag = Tag(Context::Exif, 0xa434);

/// Formal multi-manufacturer lens database generated from ExifTool lens ID tables.
/// Entries are keyed by normalized focal-length/aperture spec plus camera make,
/// so lenses that share the same numeric Lightroom LensID are disambiguated.
const LENS_DB_JSON: &str = include_str!("../../src/lensDatabase.json");

/// XMP data lives in APP1 segments near the start of the file — scanning the
/// first 512KB is enough and avoids reading multi-MB files into a String.
const XMP_SCAN_BYTES: usize = 512 * 1024;

/// Parsed once per process; previously re-parsed the 124KB JSON per photo.
fn lens_db() -> &'static Vec<(String, String, String)> {
    static LENS_DB: OnceLock<Vec<(String, String, String)>> = OnceLock::new();
    LENS_DB.get_or_init(|| {
        let mut entries = Vec::new();
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(LENS_DB_JSON) {
            if let Some(lenses) = value.get("lenses").and_then(|v| v.as_array()) {
                for entry in lenses {
                    let make = entry.get("make").and_then(|v| v.as_str()).map(|s| s.to_string());
                    let spec = entry.get("spec").and_then(|v| v.as_str()).map(|s| s.to_string());
                    let name = entry.get("name").and_then(|v| v.as_str()).map(|s| s.to_string());
                    if let (Some(make), Some(spec), Some(name)) = (make, spec, name) {
                        entries.push((make, spec, name));
                    }
                }
            }
        }
        entries
    })
}

fn looks_like_lens_spec(s: &str) -> bool {
    let t = s.trim().to_lowercase();
    t.contains("mm") && t.contains('f')
        && !t.contains("nikkor") && !t.contains("af-") && !t.contains("nikon ")
}

fn extract_xmp_attr(text: &str, name: &str) -> Option<String> {
    let needle = format!("{}=\"", name);
    let start = text.find(&needle)? + needle.len();
    let end = text[start..].find('"')? + start;
    Some(text[start..end].to_string())
}

fn norm_lens_number(s: &str) -> Option<String> {
    let n: f64 = s.parse().ok()?;
    Some(format!("{}", n))
}

fn normalize_make(make: &str) -> String {
    let raw: String = make
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect();

    match raw.as_str() {
        "nikoncorporation" | "nikkor" => "nikon".to_string(),
        "canoninc" => "canon".to_string(),
        "sonycorporation" => "sony".to_string(),
        "olympuscorporation" | "olympusimagingcorporation" | "omdigital" | "omsystem" => "olympus".to_string(),
        "fuji" | "fujifilmcorporation" => "fujifilm".to_string(),
        "panasoniccorporation" | "matsushitaelectricindustrialcoltd" => "panasonic".to_string(),
        "pentaxcorporation" => "pentax".to_string(),
        "ricohimagingcompanyltd" => "ricoh".to_string(),
        "samsungelectronics" => "samsung".to_string(),
        "sigmacorporation" => "sigma".to_string(),
        "minoltacoltd" => "minolta".to_string(),
        _ if raw.contains("nikon") => "nikon".to_string(),
        _ if raw.contains("canon") => "canon".to_string(),
        _ if raw.contains("sony") => "sony".to_string(),
        _ if raw.contains("olympus") || raw.contains("omsystem") || raw == "om" => "olympus".to_string(),
        _ if raw.contains("fujifilm") || raw == "fuji" => "fujifilm".to_string(),
        _ if raw.contains("panasonic") => "panasonic".to_string(),
        _ if raw.contains("pentax") => "pentax".to_string(),
        _ if raw.contains("ricoh") => "ricoh".to_string(),
        _ if raw.contains("samsung") => "samsung".to_string(),
        _ if raw.contains("sigma") => "sigma".to_string(),
        _ if raw.contains("minolta") => "minolta".to_string(),
        _ => raw,
    }
}

fn lens_spec_key(text: &str) -> Option<String> {
    let compact: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    let mm = compact.find("mm")?;
    let focal = &compact[..mm];
    let rest = &compact[mm + 2..];
    let fpos = rest.find("f/").or_else(|| rest.find('f')).or_else(|| rest.find('F'))?;
    let mut aperture = &rest[fpos + 1..];
    if aperture.starts_with('/') {
        aperture = &aperture[1..];
    }
    let aperture_token: String = aperture
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-' || *c == '/')
        .collect();
    let aperture_parts: Vec<&str> = aperture_token.split('-').filter(|s| !s.is_empty()).collect();
    let focal_parts: Vec<&str> = focal.split('-').filter(|s| !s.is_empty()).collect();
    if focal_parts.is_empty() || aperture_parts.is_empty() {
        return None;
    }

    let a = norm_lens_number(focal_parts[0])?;
    let b = focal_parts.get(1).and_then(|s| norm_lens_number(s));
    let c = norm_lens_number(aperture_parts[0])?;
    let d = aperture_parts.get(1).and_then(|s| norm_lens_number(s));
    match (b, d) {
        (Some(b), Some(d)) => Some(format!("{}-{}|{}-{}", a, b, c, d)),
        (Some(b), None) => Some(format!("{}-{}|{}", a, b, c)),
        (None, Some(d)) => Some(format!("{}|{}-{}", a, c, d)),
        (None, None) => Some(format!("{}|{}", a, c)),
    }
}

fn lens_name_from_database(make: &str, spec: &str) -> Option<String> {
    lens_db()
        .iter()
        .find(|(m, s, _)| m == make && s == spec)
        .map(|(_, _, name)| name.clone())
}

fn resolve_lens_name(lens_model: &str, make: Option<&str>, lens: Option<&str>) -> Option<String> {
    if !looks_like_lens_spec(lens_model) {
        return None;
    }

    let make = normalize_make(make?);
    let source = lens.unwrap_or(lens_model);
    let key = lens_spec_key(source)?;
    lens_name_from_database(&make, &key)
}

/// Parse EXIF (and, when needed, XMP) from an in-memory file buffer.
/// Import previously opened each file up to 3 times; this path reads once.
pub fn read_exif_from_memory(data: &[u8]) -> ExifData {
    let mut exif_data = ExifData::default();

    let exif = match Reader::new().read_from_container(&mut Cursor::new(data)) {
        Ok(ex) => ex,
        Err(_) => return exif_data,
    };

    // Make (Camera brand)
    if let Some(field) = exif.get_field(Tag::Make, In::PRIMARY) {
        let val = field.display_value().to_string();
        let clean = clean_string(&val);
        if !clean.is_empty() {
            exif_data.make = Some(clean);
        }
    }

    // Model (Camera body)
    if let Some(field) = exif.get_field(Tag::Model, In::PRIMARY) {
        let val = field.display_value().to_string();
        let clean = clean_string(&val);
        if !clean.is_empty() {
            exif_data.model = Some(clean);
        }
    }

    // Lens ID (standard EXIF tag 0xA434, same slot as LensModel)
    if let Some(field) = exif.get_field(LENS_ID_TAG, In::PRIMARY) {
        let val = field.display_value().to_string();
        let clean = clean_string(&val);
        if !clean.is_empty() {
            exif_data.lens_model = Some(clean);
        }
    }

    // If the stored LensModel is only a focal-range spec (e.g. "18.0-140.0 mm f/3.5-5.6"),
    // resolve it back to a readable lens name from XMP aux:LensID / aux:Lens when possible.
    if let Some(current) = exif_data.lens_model.clone() {
        if looks_like_lens_spec(&current) {
            let head = &data[..data.len().min(XMP_SCAN_BYTES)];
            let text = String::from_utf8_lossy(head);
            let lens = extract_xmp_attr(&text, "aux:Lens");
            if let Some(name) = resolve_lens_name(&current, exif_data.make.as_deref(), lens.as_deref()) {
                exif_data.lens_model = Some(name);
            }
        }
    }

    // F-Number (Aperture)
    if let Some(field) = exif.get_field(Tag::FNumber, In::PRIMARY) {
        match field.value {
            Value::Rational(ref v) if !v.is_empty() => {
                let f_val = v[0].to_f64();
                if f_val > 0.0 {
                    exif_data.f_number = Some(format!("f/{:.1}", f_val).replace(".0", ""));
                }
            }
            _ => {
                let s = field.display_value().to_string();
                if !s.is_empty() {
                    exif_data.f_number = Some(format!("f/{}", clean_string(&s)));
                }
            }
        }
    }

    // Exposure Time (Shutter Speed)
    if let Some(field) = exif.get_field(Tag::ExposureTime, In::PRIMARY) {
        match field.value {
            Value::Rational(ref v) if !v.is_empty() => {
                let num = v[0].num;
                let denom = v[0].denom;
                if num > 0 && denom > 0 {
                    if num >= denom {
                        let sec = (num as f64) / (denom as f64);
                        exif_data.exposure_time = Some(format!("{:.1}s", sec).replace(".0s", "s"));
                    } else {
                        let approx_denom = ((denom as f64) / (num as f64)).round() as u32;
                        exif_data.exposure_time = Some(format!("1/{}s", approx_denom));
                    }
                }
            }
            _ => {
                let s = field.display_value().to_string();
                if !s.is_empty() {
                    exif_data.exposure_time = Some(format!("{}s", clean_string(&s)));
                }
            }
        }
    }

    // ISO (PhotographicSensitivity / ISOSpeed)
    if let Some(field) = exif.get_field(Tag::PhotographicSensitivity, In::PRIMARY) {
        let s = field.display_value().to_string();
        let clean = clean_string(&s);
        if !clean.is_empty() {
            exif_data.iso = Some(format!("ISO {}", clean));
        }
    } else if let Some(field) = exif.get_field(Tag::ISOSpeed, In::PRIMARY) {
        let s = field.display_value().to_string();
        let clean = clean_string(&s);
        if !clean.is_empty() {
            exif_data.iso = Some(format!("ISO {}", clean));
        }
    }

    // Focal Length (Physical focal length of the lens)
    if let Some(field) = exif.get_field(Tag::FocalLength, In::PRIMARY) {
        match field.value {
            Value::Rational(ref v) if !v.is_empty() => {
                let fl = v[0].to_f64();
                if fl > 0.0 {
                    if (fl.fract()).abs() < 0.05 {
                        exif_data.focal_length = Some(format!("{:.0}mm", fl));
                    } else {
                        exif_data.focal_length = Some(format!("{:.1}mm", fl));
                    }
                }
            }
            _ => {
                let s = clean_string(&field.display_value().to_string());
                let val_clean = s.trim_end_matches("mm").trim();
                if !val_clean.is_empty() {
                    exif_data.focal_length = Some(format!("{}mm", val_clean));
                }
            }
        }
    }

    // 35mm Equivalent Focal Length
    if let Some(field) = exif.get_field(Tag::FocalLengthIn35mmFilm, In::PRIMARY) {
        let s = clean_string(&field.display_value().to_string());
        let val_clean = s.trim_end_matches("mm").trim();
        if !val_clean.is_empty() {
            exif_data.focal_length_35mm = Some(format!("{}mm", val_clean));
        }
    }

    // Date Time Original
    if let Some(field) = exif.get_field(Tag::DateTimeOriginal, In::PRIMARY) {
        let s = field.display_value().to_string();
        let clean = clean_string(&s);
        if !clean.is_empty() {
            exif_data.datetime = Some(clean);
        }
    }

    // Exposure Bias
    if let Some(field) = exif.get_field(Tag::ExposureBiasValue, In::PRIMARY) {
        match field.value {
            Value::SRational(ref v) if !v.is_empty() => {
                let bias = v[0].to_f64();
                if bias.abs() > 0.01 {
                    let sign = if bias > 0.0 { "+" } else { "" };
                    exif_data.exposure_bias = Some(format!("{}{:.1} EV", sign, bias));
                } else {
                    exif_data.exposure_bias = Some("0 EV".to_string());
                }
            }
            _ => {}
        }
    }

    // Orientation
    if let Some(field) = exif.get_field(Tag::Orientation, In::PRIMARY) {
        if let Some(val) = field.value.get_uint(0) {
            exif_data.orientation = Some(val);
        }
    }

    // Width & Height from EXIF if present
    if let Some(field) = exif.get_field(Tag::PixelXDimension, In::PRIMARY) {
        if let Some(val) = field.value.get_uint(0) {
            exif_data.width = Some(val);
        }
    }
    if let Some(field) = exif.get_field(Tag::PixelYDimension, In::PRIMARY) {
        if let Some(val) = field.value.get_uint(0) {
            exif_data.height = Some(val);
        }
    }

    exif_data
}

fn clean_string(input: &str) -> String {
    input
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string()
}


