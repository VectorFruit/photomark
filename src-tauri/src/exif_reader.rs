use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use exif::{Context, In, Reader, Tag, Value};
use crate::models::ExifData;

/// Lens info is read from the standard EXIF "LensID" tag, which is stored in
/// the same IFD slot as LensModel (tag 0xA434 / decimal 42036).
const LENS_ID_TAG: Tag = Tag(Context::Exif, 0xa434);

/// Lightroom/Camera Raw writes `aux:LensID` and `aux:Lens` into XMP. The
/// numeric LensID is not readable by itself, so we keep a small Nikon table.
const LENS_NAME_BY_ID: &[(u32, &str)] = &[
    (160, "AF-S DX Nikkor 18-140mm f/3.5-5.6G ED VR"),
];

const LENS_NAME_BY_SPEC: &[(&str, &str)] = &[
    ("18.0-140.0 mm f/3.5-5.6", "AF-S DX Nikkor 18-140mm f/3.5-5.6G ED VR"),
    ("18.0-140.0mm f/3.5-5.6", "AF-S DX Nikkor 18-140mm f/3.5-5.6G ED VR"),
    ("18-140mm f/3.5-5.6", "AF-S DX Nikkor 18-140mm f/3.5-5.6G ED VR"),
];

fn looks_like_lens_spec(s: &str) -> bool {
    let t = s.trim().to_lowercase();
    t.contains("mm") && t.contains("f/")
        && !t.contains("nikkor") && !t.contains("af-") && !t.contains("nikon ")
}

fn extract_xmp_attr(text: &str, name: &str) -> Option<String> {
    let needle = format!("{}=\"", name);
    let start = text.find(&needle)? + needle.len();
    let end = text[start..].find('"')? + start;
    Some(text[start..end].to_string())
}

fn resolve_lens_name(lens_model: &str, lens_id: Option<&str>, lens: Option<&str>) -> Option<String> {
    if !looks_like_lens_spec(lens_model) {
        return None;
    }

    if let Some(id) = lens_id.and_then(|v| v.trim().parse::<u32>().ok()) {
        if let Some((_, name)) = LENS_NAME_BY_ID.iter().find(|(k, _)| *k == id) {
            return Some((*name).to_string());
        }
    }

    if let Some(spec) = lens {
        let spec = spec.split_whitespace().collect::<Vec<_>>().join(" ");
        if let Some((_, name)) = LENS_NAME_BY_SPEC.iter().find(|(k, _)| *k == &spec) {
            return Some((*name).to_string());
        }
    }

    None
}

pub fn read_exif_from_path<P: AsRef<Path>>(path: P) -> ExifData {
    let mut exif_data = ExifData::default();

    let file = match File::open(&path) {
        Ok(f) => f,
        Err(_) => return exif_data,
    };

    let mut bufreader = BufReader::new(file);
    let exif = match Reader::new().read_from_container(&mut bufreader) {
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
            if let Ok(bytes) = std::fs::read(&path) {
                let text = String::from_utf8_lossy(&bytes);
                let lens_id = extract_xmp_attr(&text, "aux:LensID");
                let lens = extract_xmp_attr(&text, "aux:Lens");
                if let Some(name) = resolve_lens_name(&current, lens_id.as_deref(), lens.as_deref()) {
                    exif_data.lens_model = Some(name);
                }
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

