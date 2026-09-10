// Replicates tauri 2.11.5 fs-scope matching (scope/fs.rs) to verify which
// asset-protocol scope patterns actually allow our paths.
use glob::Pattern;
use std::path::Path;

fn opts() -> glob::MatchOptions {
    glob::MatchOptions {
        require_literal_separator: true,
        require_literal_leading_dot: true,
        case_sensitive: true,
        ..Default::default()
    }
}

#[test]
fn asset_scope_pattern_semantics() {
    let star_star = Pattern::new("**").unwrap();
    let home_all = Pattern::new("$HOME/**").unwrap_or(Pattern::new("/home/**").unwrap());

    let thumb = Path::new("/home/vectorfruit/.cache/com.vectorfruit.photomark/thumbnails/abc123.jpg");
    let photo = Path::new("/home/vectorfruit/Pictures/holiday.jpg");

    println!("thumbnail path:");
    println!("  '**'         -> {}", star_star.matches_path_with(thumb, opts()));
    println!("  '/home/**'   -> {}", home_all.matches_path_with(thumb, opts()));
    println!("original photo:");
    println!("  '**'         -> {}", star_star.matches_path_with(photo, opts()));
    println!("  '/home/**'   -> {}", home_all.matches_path_with(photo, opts()));
}
