use std::io::Cursor;
use std::path::Path;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use image::{DynamicImage, GenericImageView};

/// Load and orient an image from an in-memory buffer.
fn load_oriented_from_bytes(
    data: &[u8],
    orientation: Option<u32>,
) -> Result<DynamicImage, String> {
    let img = image::load_from_memory(data).map_err(|e| format!("Failed to decode image: {}", e))?;

    let oriented = match orientation.unwrap_or(1) {
        3 => img.rotate180(),
        6 => img.rotate90(),
        8 => img.rotate270(),
        _ => img,
    };
    Ok(oriented)
}

fn load_and_orient_image<P: AsRef<Path>>(path: P, orientation: Option<u32>) -> Result<DynamicImage, String> {
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

/// Deterministic cache key: same path+size+mtime → same file, stable across
/// runs (DefaultHasher::new has fixed keys).
fn thumbnail_cache_key(path: &str, size_bytes: u64, mtime_secs: u64) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    size_bytes.hash(&mut hasher);
    mtime_secs.hash(&mut hasher);
    format!("{:016x}{:016x}", hasher.finish(), size_bytes)
}

/// Encode the thumbnail into `cache_dir/thumbnails` (skipping decode on a
/// warm cache) and return it as a base64 data URL plus original dimensions.
/// The data URL goes over IPC as in 1.4.x: the asset protocol cannot serve
/// the cache directory on Unix (dot-dir + require_literal_leading_dot).
pub fn generate_thumbnail_cached(
    data: &[u8],
    path: &str,
    size_bytes: u64,
    mtime_secs: u64,
    cache_dir: &Path,
    max_edge: u32,
    orientation: Option<u32>,
) -> Result<(String, String, u32, u32), String> {
    let thumb_dir = cache_dir.join("thumbnails");
    let key = thumbnail_cache_key(path, size_bytes, mtime_secs);
    let cache_file = thumb_dir.join(format!("{}.jpg", key));

    let (jpeg_bytes, orig_w, orig_h) = if cache_file.exists() {
        // Cache hit: no decode, no encode — read the stored JPEG back.
        (
            std::fs::read(&cache_file).map_err(|e| format!("Failed to read thumbnail cache: {}", e))?,
            0,
            0,
        )
    } else {
        let img = load_oriented_from_bytes(data, orientation)?;
        let (orig_w, orig_h) = img.dimensions();
        let thumb = if orig_w <= max_edge && orig_h <= max_edge {
            img
        } else {
            img.thumbnail(max_edge, max_edge)
        };

        std::fs::create_dir_all(&thumb_dir)
            .map_err(|e| format!("Failed to create thumbnail cache dir: {}", e))?;
        let tmp = thumb_dir.join(format!(".{}.tmp", key));
        {
            let file = std::fs::File::create(&tmp)
                .map_err(|e| format!("Failed to create cache file: {}", e))?;
            let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(
                std::io::BufWriter::new(file),
                85,
            );
            encoder
                .encode_image(&thumb)
                .map_err(|e| format!("Failed to encode thumbnail: {}", e))?;
        }
        std::fs::rename(&tmp, &cache_file)
            .map_err(|e| format!("Failed to finalize cache file: {}", e))?;
        prune_thumbnails(&thumb_dir);
        (
            std::fs::read(&cache_file).map_err(|e| format!("Failed to read thumbnail cache: {}", e))?,
            orig_w,
            orig_h,
        )
    };

    let data_url = format!("data:image/jpeg;base64,{}", BASE64.encode(jpeg_bytes));
    Ok((data_url, cache_file.to_string_lossy().to_string(), orig_w, orig_h))
}

/// Keep the thumbnail cache bounded: drop the oldest files beyond 800 entries.
fn prune_thumbnails(thumb_dir: &Path) {
    const MAX_FILES: usize = 800;
    let Ok(entries) = std::fs::read_dir(thumb_dir) else {
        return;
    };
    let mut files: Vec<(std::time::SystemTime, std::path::PathBuf)> = entries
        .filter_map(|entry| {
            let p = entry.ok()?.path();
            if p.extension().and_then(|x| x.to_str()) != Some("jpg") {
                return None;
            }
            let meta = p.metadata().ok()?;
            Some((meta.modified().ok()?, p))
        })
        .collect();
    if files.len() <= MAX_FILES {
        return;
    }
    files.sort_by_key(|(t, _)| *t);
    let excess = files.len() - MAX_FILES;
    for (_, p) in files.into_iter().take(excess) {
        let _ = std::fs::remove_file(p);
    }
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
