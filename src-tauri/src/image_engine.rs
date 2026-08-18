use std::io::Cursor;
use std::path::Path;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use image::{DynamicImage, GenericImageView};

pub fn load_and_orient_image<P: AsRef<Path>>(path: P, orientation: Option<u32>) -> Result<DynamicImage, String> {
    let img = image::open(&path).map_err(|e| format!("Failed to open image: {}", e))?;
    
    // Apply orientation if present
    let oriented = match orientation.unwrap_or(1) {
        3 => img.rotate180(),
        6 => img.rotate90(),
        8 => img.rotate270(),
        _ => img,
    };

    Ok(oriented)
}

pub fn generate_thumbnail<P: AsRef<Path>>(path: P, max_edge: u32, orientation: Option<u32>) -> Result<(String, u32, u32), String> {
    let img = load_and_orient_image(&path, orientation)?;
    let (orig_w, orig_h) = img.dimensions();

    let thumb = img.thumbnail(max_edge, max_edge);
    let mut buffer = Cursor::new(Vec::new());
    
    // Encode as JPEG with high quality for fast preview
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, 90);
    encoder.encode_image(&thumb)
        .map_err(|e| format!("Failed to encode thumbnail: {}", e))?;

    let base64_str = BASE64.encode(buffer.into_inner());
    let data_url = format!("data:image/jpeg;base64,{}", base64_str);

    Ok((data_url, orig_w, orig_h))
}

pub fn load_full_image_data_url<P: AsRef<Path>>(path: P, orientation: Option<u32>) -> Result<String, String> {
    let path_ref = path.as_ref();
    let ext = path_ref.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let need_rotation = matches!(orientation, Some(3 | 6 | 8));

    // If no rotation needed and file is standard JPEG/PNG/WebP, read 100% UNTOUCHED RAW BYTES directly!
    // This avoids double compression artifacts and guarantees 100% master original fidelity.
    if !need_rotation && matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp") {
        let bytes = std::fs::read(path_ref).map_err(|e| format!("Failed to read raw file bytes: {}", e))?;
        let mime = match ext.as_str() {
            "png" => "image/png",
            "webp" => "image/webp",
            _ => "image/jpeg",
        };
        let b64 = BASE64.encode(bytes);
        return Ok(format!("data:{};base64,{}", mime, b64));
    }

    // If rotation is required or RAW format, decode and encode with 100% max quality
    let img = load_and_orient_image(path_ref, orientation)?;
    let mut buffer = Cursor::new(Vec::new());

    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, 100);
    encoder.encode_image(&img)
        .map_err(|e| format!("Failed to encode full image: {}", e))?;

    let base64_str = BASE64.encode(buffer.into_inner());
    let data_url = format!("data:image/jpeg;base64,{}", base64_str);

    Ok(data_url)
}

pub fn save_base64_image<P: AsRef<Path>>(
    output_path: P,
    base64_data: &str,
    format: &str,
    quality: u8,
) -> Result<(), String> {
    let raw_b64 = if let Some(idx) = base64_data.find(";base64,") {
        &base64_data[idx + 8..]
    } else if let Some(idx) = base64_data.find(",") {
        &base64_data[idx + 1..]
    } else {
        base64_data
    };

    let bytes = BASE64.decode(raw_b64.trim())
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    if let Some(parent) = output_path.as_ref().parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent dir: {}", e))?;
    }

    // If saving as JPEG from a lossless PNG canvas buffer, encode in Rust with exact quality
    if (format.eq_ignore_ascii_case("jpeg") || format.eq_ignore_ascii_case("jpg"))
        && bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47])
    {
        let img = image::load_from_memory(&bytes)
            .map_err(|e| format!("Failed to decode image buffer: {}", e))?;
        let mut buffer = Cursor::new(Vec::new());
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, quality);
        encoder.encode_image(&img)
            .map_err(|e| format!("Failed to encode JPEG: {}", e))?;
        std::fs::write(&output_path, buffer.into_inner())
            .map_err(|e| format!("Failed to write output file: {}", e))?;
        return Ok(());
    }

    std::fs::write(&output_path, bytes)
        .map_err(|e| format!("Failed to write output file: {}", e))?;

    Ok(())
}
