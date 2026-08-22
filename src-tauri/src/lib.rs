mod models;
mod exif_reader;
mod image_engine;
mod commands;

use commands::{load_photos, load_full_photo, save_rendered_photo, batch_export, resolve_unique_path};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            load_photos,
            load_full_photo,
            save_rendered_photo,
            batch_export,
            resolve_unique_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running photomark tauri application");
}
