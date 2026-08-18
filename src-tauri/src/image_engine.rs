use std::io::Cursor;
use std::path::Path;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use image::{DynamicImage, GenericImageView, ImageFormat};

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
    thumb.write_to(&mut buffer, ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to encode thumbnail: {}", e))?;

    let base64_str = BASE64.encode(buffer.into_inner());
    let data_url = format!("data:image/jpeg;base64,{}", base64_str);

    Ok((data_url, orig_w, orig_h))
}

pub fn load_full_image_data_url<P: AsRef<Path>>(path: P, orientation: Option<u32>) -> Result<String, String> {
    let img = load_and_orient_image(&path, orientation)?;
    let mut buffer = Cursor::new(Vec::new());
    
    // Encode at 100% full original resolution
    img.write_to(&mut buffer, ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to encode full image: {}", e))?;

    let base64_str = BASE64.encode(buffer.into_inner());
    let data_url = format!("data:image/jpeg;base64,{}", base64_str);

    Ok(data_url)
}

pub fn save_base64_image<P: AsRef<Path>>(output_path: P, base64_data: &str, _format: &str, _quality: u8) -> Result<(), String> {
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

    std::fs::write(&output_path, bytes)
        .map_err(|e| format!("Failed to write output file: {}", e))?;

    Ok(())
}
