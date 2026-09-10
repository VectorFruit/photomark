export interface ExifData {
  make?: string;
  model?: string;
  lens_model?: string;
  focal_length?: string;
  focal_length_35mm?: string;
  f_number?: string;
  exposure_time?: string;
  iso?: string;
  datetime?: string;
  exposure_bias?: string;
  width?: number;
  height?: number;
  orientation?: number;
}

export interface PhotoItem {
  id: string;
  path: string;
  filename: string;
  size_bytes: number;
  exif: ExifData;
  thumbnail_data_url?: string;
  /** Tauri mode: cached thumbnail file, read via the asset protocol */
  thumbnail_path?: string;
  /** Browser mode: original file handle (Tauri mode loads from disk instead) */
  sourceFile?: File;
  /** Per-photo config override for independent tuning */
  configOverride?: Partial<FrameConfig>;
}

/** Helper: the best available <img> source for a photo's preview thumbnail. */
export function thumbnailSrc(photo: PhotoItem, convertFileSrcFn?: (p: string) => string): string {
  if (photo.thumbnail_data_url) return photo.thumbnail_data_url;
  if (photo.thumbnail_path && convertFileSrcFn) return convertFileSrcFn(photo.thumbnail_path);
  return '';
}

/** Check if running inside the Tauri native desktop runtime */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);
}

export type FrameTemplateId =
  | 'bottom_bar'
  | 'border'
  | 'polaroid'
  | 'minimal_badge'
  | 'center_brand'
  | 'cinematic'
  | 'film_roll'
  | 'medium_format'
  | 'museum_matte'
  | 'street_split'
  | 'slide_mount'
  // Legacy alias support for stored presets (normalized at runtime)
  | 'contact_sheet'
  | 'floating_frame'
  | 'recipe_card';

export type BackgroundType = 'white' | 'dark' | 'frosted_blur' | 'custom';

export type FocalLengthMode = 'physical' | 'equiv35mm' | 'both';

export interface FrameConfig {
  template: FrameTemplateId;
  backgroundType: BackgroundType;
  customBackgroundColor: string;
  fontFamily: string;
  fontSizeScale: number; // 0.8 to 1.5
  fontWeight: number; // 300 to 800 (main text)
  secondaryFontWeight: number; // 300 to 800 (sub text)
  paddingPercent: number; // 2% to 15%
  bottomBarHeightPercent: number; // 8% to 25%
  contentVerticalOffset: number; // -100 to 100, shifts watermark text & logo up/down
  shadowRadius: number; // 0 to 50
  shadowOpacity: number; // 0 to 1
  borderRadius: number; // 0 to 40
  blurIntensity: number; // 10 to 120
  showLogo: boolean;
  selectedLogo: string; // 'auto', specific brand key, or 'custom'
  customLogoDataUrl?: string; // Custom uploaded stamp/logo
  filmSimulation?: string; // Film simulation recipe or label (e.g. Classic Chrome)
  focalLengthMode: FocalLengthMode;
  customNote: string;

  // Field toggles
  showMake: boolean;
  showModel: boolean;
  showLens: boolean;
  showParams: boolean;
  showDate: boolean;
  showCustomNote: boolean;

  // Editable decorative markings — film_roll (empty string hides a marking)
  filmFrameNo: string; // rebate frame index, e.g. '24A'
  filmExp: string; // exposure counter, e.g. '24 · EXP 36' (empty falls back to real ISO)
  filmCode: string; // film stock code, e.g. '5063'
  showDxBarcode: boolean; // DX optical edge barcode
  showNeighborFrames: boolean; // dimmed adjacent frame slivers above/below
  showLightLeak: boolean; // warm light-leak gradients over the strip
  showDateStamp: boolean; // orange point-and-shoot date imprint on the photo

  // Editable decorative markings — cinematic (empty string hides cineMetaText)
  cineMetaText: string; // top-right decorative meta, e.g. '180.0° · 24 FPS'
  showSoundTrack: boolean; // optical sound track waveform in bottom letterbox
  showFilmGrain: boolean; // fine grain overlay on the photo
}

export const DEFAULT_FRAME_CONFIG: FrameConfig = {
  template: 'bottom_bar',
  backgroundType: 'white',
  customBackgroundColor: '#ffffff',
  fontFamily: 'Noto Sans SC',
  fontSizeScale: 1.0,
  fontWeight: 500,
  secondaryFontWeight: 400,
  paddingPercent: 4,
  bottomBarHeightPercent: 12,
  contentVerticalOffset: 0,
  shadowRadius: 15,
  shadowOpacity: 0.28,
  borderRadius: 0,
  blurIntensity: 55,
  showLogo: true,
  selectedLogo: 'auto',
  customLogoDataUrl: '',
  filmSimulation: '',
  focalLengthMode: 'physical',
  customNote: '',
  showMake: true,
  showModel: true,
  showLens: true,
  showParams: true,
  showDate: true,
  showCustomNote: false,
  filmFrameNo: '24A',
  filmExp: '24 · EXP 36',
  filmCode: '5063',
  showDxBarcode: true,
  showNeighborFrames: true,
  showLightLeak: true,
  showDateStamp: true,
  cineMetaText: '180.0° · 24 FPS',
  showSoundTrack: true,
  showFilmGrain: true,
};

export interface ExportSettings {
  format: 'jpeg' | 'png' | 'webp';
  quality: number; // 70 to 100
  isOriginalResolution: boolean;
  outputDir: string;
}

export interface ParseProgressEvent {
  current: number;
  total: number;
  filename: string;
  percent: number;
}
