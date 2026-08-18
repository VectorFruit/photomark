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
}

export type FrameTemplateId = 'bottom_bar' | 'border' | 'polaroid' | 'minimal_badge';
export type BackgroundType = 'white' | 'dark' | 'frosted_blur' | 'custom';

export interface FrameConfig {
  template: FrameTemplateId;
  backgroundType: BackgroundType;
  customBackgroundColor: string;
  fontFamily: string;
  fontSizeScale: number; // 0.8 to 1.5
  paddingPercent: number; // 2% to 15%
  bottomBarHeightPercent: number; // 8% to 25%
  shadowRadius: number; // 0 to 50
  shadowOpacity: number; // 0 to 1
  borderRadius: number; // 0 to 40
  blurIntensity: number; // 10 to 120
  showLogo: boolean;
  selectedLogo: string; // 'auto' or specific brand key
  customNote: string;
  
  // Field toggles
  showMake: boolean;
  showModel: boolean;
  showLens: boolean;
  showParams: boolean;
  showDate: boolean;
  showCustomNote: boolean;
}

export const DEFAULT_FRAME_CONFIG: FrameConfig = {
  template: 'bottom_bar',
  backgroundType: 'white',
  customBackgroundColor: '#ffffff',
  fontFamily: 'Inter, -apple-system, sans-serif',
  fontSizeScale: 1.0,
  paddingPercent: 4,
  bottomBarHeightPercent: 12,
  shadowRadius: 15,
  shadowOpacity: 0.28,
  borderRadius: 0,
  blurIntensity: 55,
  showLogo: true,
  selectedLogo: 'auto',
  customNote: '',
  showMake: true,
  showModel: true,
  showLens: true,
  showParams: true,
  showDate: true,
  showCustomNote: false,
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
