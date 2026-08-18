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

export type FrameTemplateId = 'bottom_bar' | 'border' | 'frosted_blur' | 'polaroid' | 'minimal_badge';

export interface FrameConfig {
  template: FrameTemplateId;
  theme: 'light' | 'dark' | 'auto';
  backgroundColor: string;
  fontFamily: string;
  fontSizeScale: number; // 0.8 to 1.5
  paddingPercent: number; // 2% to 15%
  bottomBarHeightPercent: number; // 8% to 25%
  shadowRadius: number; // 0 to 50
  shadowOpacity: number; // 0 to 1
  borderRadius: number; // 0 to 40
  showLogo: boolean;
  selectedLogo: string; // 'auto' or specific brand key
  customNote: string;
  
  // Field toggles
  showMake: boolean;
  showModel: boolean;
  showLens: boolean;
  showParams: boolean; // Aperture + Shutter + ISO + Focal
  showDate: boolean;
  showCustomNote: boolean;
  
  // Aspect ratio
  aspectRatio: 'original' | '1:1' | '4:3' | '3:2' | '16:9';
  landscapeMode: boolean;
}

export interface ExportSettings {
  format: 'jpeg' | 'png' | 'webp';
  quality: number; // 70 to 100
  scale: number; // 1 = original, 2 = 2x, 0.5 = preview
  outputDir: string;
}
