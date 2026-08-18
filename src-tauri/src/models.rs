use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExifData {
    pub make: Option<String>,
    pub model: Option<String>,
    pub lens_model: Option<String>,
    pub focal_length: Option<String>,
    pub focal_length_35mm: Option<String>,
    pub f_number: Option<String>,
    pub exposure_time: Option<String>,
    pub iso: Option<String>,
    pub datetime: Option<String>,
    pub exposure_bias: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub orientation: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhotoInfo {
    pub id: String,
    pub path: String,
    pub filename: String,
    pub size_bytes: u64,
    pub exif: ExifData,
    pub thumbnail_data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchExportItem {
    pub photo_path: String,
    pub output_path: String,
    pub base64_image: String,
    pub format: String,
    pub quality: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportResult {
    pub success: bool,
    pub source_path: String,
    pub output_path: String,
    pub error: Option<String>,
}
