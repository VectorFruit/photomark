use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use rayon::prelude::*;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use crate::exif_reader::read_exif_from_memory;
use crate::image_engine::{generate_thumbnail_cached, load_full_image_data_url, save_base64_image};
use crate::models::{BatchExportItem, ExportResult, PhotoInfo};

#[derive(Clone, Serialize)]
pub struct ProgressEvent {
    pub current: usize,
    pub total: usize,
    pub filename: String,
    pub percent: u8,
}

#[tauri::command]
pub async fn load_photos(app: AppHandle, paths: Vec<String>) -> Result<Vec<PhotoInfo>, String> {
    // Heavy decode work runs on a blocking thread so the async runtime stays free.
    tauri::async_runtime::spawn_blocking(move || load_photos_blocking(app, paths))
        .await
        .map_err(|e| format!("load_photos task failed: {}", e))
}

fn load_photos_blocking(app: AppHandle, paths: Vec<String>) -> Vec<PhotoInfo> {
    let total = paths.len();
    let counter = Arc::new(AtomicUsize::new(0));
    let thumb_cache_dir: Option<PathBuf> = app
        .path()
        .app_cache_dir()
        .ok()
        .map(|d| d.join("thumbnails"));

    paths
        .par_iter()
        .filter_map(|p_str| {
            let path = Path::new(p_str);
            if !path.exists() || !path.is_file() {
                return None;
            }

            let filename = path.file_name()?.to_string_lossy().to_string();
            let metadata = std::fs::metadata(path).ok()?;
            let size_bytes = metadata.len();
            let mtime_secs = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            // Single read: EXIF, XMP and decode all work off this buffer.
            let data = match std::fs::read(path) {
                Ok(d) => d,
                Err(_) => return None,
            };

            // 1. Read EXIF
            let mut exif = read_exif_from_memory(&data);

            // 2. Thumbnail: encode once into the on-disk cache (warm cache
            //    skips decode + encode), deliver as a base64 data URL over IPC.
            let (thumbnail_data_url, _thumbnail_path, w, h) = match &thumb_cache_dir {
                Some(dir) => match generate_thumbnail_cached(
                    &data,
                    p_str,
                    size_bytes,
                    mtime_secs,
                    dir,
                    1440,
                    exif.orientation,
                ) {
                    Ok((url, p, w, h)) => (Some(url), Some(p), Some(w), Some(h)),
                    Err(_) => (None, None, None, None),
                },
                None => (None, None, None, None),
            };

            if exif.width.is_none() {
                exif.width = w;
            }
            if exif.height.is_none() {
                exif.height = h;
            }

            let id = format!("{}_{}", p_str, size_bytes);

            let curr = counter.fetch_add(1, Ordering::SeqCst) + 1;
            let percent = ((curr as f64 / total as f64) * 100.0).round() as u8;

            let _ = app.emit(
                "parse-progress",
                ProgressEvent {
                    current: curr,
                    total,
                    filename: filename.clone(),
                    percent,
                },
            );

            Some(PhotoInfo {
                id,
                path: p_str.clone(),
                filename,
                size_bytes,
                exif,
                thumbnail_data_url,
                thumbnail_path: _thumbnail_path,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn load_full_photo(path: String, orientation: Option<u32>) -> Result<String, String> {
    load_full_image_data_url(&path, orientation)
}

/// Enumerate installed system font family names (sorted, cached per process).
#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        static FAMILIES: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
        let families = FAMILIES.get_or_init(|| {
            let mut list = font_kit::source::SystemSource::new()
                .all_families()
                .unwrap_or_default();
            list.sort_by_key(|f| f.to_lowercase());
            list
        });
        families.clone()
    })
    .await
    .map_err(|e| format!("list_system_fonts task failed: {}", e))
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


/// Resolve a non-conflicting output path inside `output_dir`.
/// If `filename` already exists, append `(1)`, `(2)`, ... before the extension.
#[tauri::command]
pub fn resolve_unique_path(output_dir: String, filename: String) -> Result<String, String> {
    let dir = Path::new(&output_dir);
    let candidate = dir.join(&filename);
    if !candidate.exists() {
        return Ok(candidate.to_string_lossy().to_string());
    }

    let stem = Path::new(&filename)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| filename.clone());
    let ext = Path::new(&filename)
        .extension()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    for i in 1..=9999 {
        let name = if ext.is_empty() {
            format!("{}({})", stem, i)
        } else {
            format!("{}({}).{}", stem, i, ext)
        };
        let candidate = dir.join(&name);
        if !candidate.exists() {
            return Ok(candidate.to_string_lossy().to_string());
        }
    }

    Err("无法为输出文件生成唯一名称（同名文件过多）".to_string())
}

#[tauri::command]
pub async fn batch_export(app: AppHandle, items: Vec<BatchExportItem>) -> Result<Vec<ExportResult>, String> {
    let total = items.len();
    let counter = Arc::new(AtomicUsize::new(0));

    let results: Vec<ExportResult> = items
        .into_par_iter()
        .map(|item| {
            let filename = Path::new(&item.output_path)
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default();

            let res = match save_base64_image(&item.output_path, &item.base64_image, &item.format, item.quality) {
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
            };

            let curr = counter.fetch_add(1, Ordering::SeqCst) + 1;
            let percent = ((curr as f64 / total as f64) * 100.0).round() as u8;

            let _ = app.emit(
                "batch-progress",
                ProgressEvent {
                    current: curr,
                    total,
                    filename,
                    percent,
                },
            );

            res
        })
        .collect();

    Ok(results)
}

#[cfg(test)]
mod tests {
    #[test]
    fn system_font_enumeration_finds_families() {
        let mut families = font_kit::source::SystemSource::new()
            .all_families()
            .expect("font enumeration failed");
        assert!(!families.is_empty(), "no system fonts found");
        families.sort_by_key(|f| f.to_lowercase());
        assert!(families.first().unwrap().len() > 0);
    }
}
