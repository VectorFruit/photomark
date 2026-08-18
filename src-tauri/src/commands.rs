use std::path::Path;
use rayon::prelude::*;
use crate::exif_reader::read_exif_from_path;
use crate::image_engine::{generate_thumbnail, save_base64_image};
use crate::models::{BatchExportItem, ExportResult, PhotoInfo};

#[tauri::command]
pub async fn load_photos(paths: Vec<String>) -> Result<Vec<PhotoInfo>, String> {
    // Process in parallel using Rayon
    let results: Vec<PhotoInfo> = paths
        .par_iter()
        .filter_map(|p_str| {
            let path = Path::new(p_str);
            if !path.exists() || !path.is_file() {
                return None;
            }

            let filename = path.file_name()?.to_string_lossy().to_string();
            let metadata = std::fs::metadata(path).ok()?;
            let size_bytes = metadata.len();

            // 1. Read EXIF
            let mut exif = read_exif_from_path(path);

            // 2. Generate Thumbnail & get dimensions
            let (thumbnail_data_url, w, h) = match generate_thumbnail(path, 1600, exif.orientation) {
                Ok((url, w, h)) => (Some(url), Some(w), Some(h)),
                Err(_) => (None, None, None),
            };

            if exif.width.is_none() {
                exif.width = w;
            }
            if exif.height.is_none() {
                exif.height = h;
            }

            let id = format!("{}_{}", p_str, size_bytes);

            Some(PhotoInfo {
                id,
                path: p_str.clone(),
                filename,
                size_bytes,
                exif,
                thumbnail_data_url,
            })
        })
        .collect();

    Ok(results)
}

#[tauri::command]
pub async fn save_rendered_photo(
    output_path: String,
    base64_data: String,
    format: String,
    quality: u8,
) -> Result<bool, String> {
    save_base64_image(&output_path, &base64_data, &format, quality)?;
    Ok(true)
}

#[tauri::command]
pub async fn batch_export(items: Vec<BatchExportItem>) -> Result<Vec<ExportResult>, String> {
    let results: Vec<ExportResult> = items
        .into_par_iter()
        .map(|item| {
            match save_base64_image(&item.output_path, &item.base64_image, &item.format, item.quality) {
                Ok(_) => ExportResult {
                    success: true,
                    source_path: item.photo_path,
                    output_path: item.output_path,
                    error: None,
                },
                Err(e) => ExportResult {
                    success: false,
                    source_path: item.photo_path,
                    output_path: item.output_path,
                    error: Some(e),
                },
            }
        })
        .collect();

    Ok(results)
}
