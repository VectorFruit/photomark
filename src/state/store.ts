import { DEFAULT_FRAME_CONFIG, FrameConfig, PhotoItem } from '../types';

export interface ExportSettings {
  format: 'jpeg' | 'png' | 'webp';
  quality: number;
  filenameTemplate: string;
}

export type FxIntensity = 'strong' | 'balanced' | 'weak';

export type StateListener = (event: StateChangeEvent) => void;

export type StateChangeEvent =
  | { type: 'photos_changed' }
  | { type: 'active_index_changed'; index: number }
  | { type: 'config_changed'; config: FrameConfig }
  | { type: 'export_settings_changed'; settings: ExportSettings }
  | { type: 'theme_changed'; theme: 'dark' | 'light' | 'system' }
  | { type: 'ui_scale_changed'; scale: number }
  | { type: 'render_needed' };

const CONFIG_STORAGE_KEY = 'photomark_frame_config';
const EXPORT_STORAGE_KEY = 'photomark_export_settings';
const DEFAULT_FILENAME_TEMPLATE = '{filename}_framed';

class Store {
  public photos: PhotoItem[] = [];
  public activeIndex: number = -1;
  public globalConfig: FrameConfig = { ...DEFAULT_FRAME_CONFIG };
  public perPhotoOverrideEnabled: boolean = false;
  public exportSettings: ExportSettings = {
    format: 'jpeg',
    quality: 100,
    filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
  };

  public currentTheme: 'dark' | 'light' | 'system' = 'system';
  public currentPalette: string = 'amber';
  public currentFx: FxIntensity = 'balanced';
  public photoLightEnabled: boolean = true;
  public currentUiScale: number = 1.0;

  private listeners: Set<StateListener> = new Set();

  constructor() {
    this.loadPersistedState();
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public emit(event: StateChangeEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('State listener error:', err);
      }
    }
  }

  public getActivePhoto(): PhotoItem | null {
    if (this.activeIndex < 0 || this.activeIndex >= this.photos.length) return null;
    return this.photos[this.activeIndex];
  }

  /**
   * Get the active effective configuration:
   * Combines global config with per-photo overrides if enabled.
   */
  public getActiveConfig(): FrameConfig {
    const photo = this.getActivePhoto();
    if (photo && photo.configOverride) {
      return { ...this.globalConfig, ...photo.configOverride };
    }
    return { ...this.globalConfig };
  }

  /**
   * Update active configuration.
   * If per-photo override is active for the current photo, modifies its override;
   * otherwise updates global config.
   */
  public updateActiveConfig(partial: Partial<FrameConfig>) {
    const photo = this.getActivePhoto();
    if (this.perPhotoOverrideEnabled && photo) {
      photo.configOverride = { ...(photo.configOverride || {}), ...partial };
    } else {
      Object.assign(this.globalConfig, partial);
      this.persistConfig();
    }
    this.emit({ type: 'config_changed', config: this.getActiveConfig() });
    this.emit({ type: 'render_needed' });
  }

  public resetActiveConfigToDefault() {
    const photo = this.getActivePhoto();
    if (this.perPhotoOverrideEnabled && photo) {
      photo.configOverride = undefined;
    } else {
      this.globalConfig = { ...DEFAULT_FRAME_CONFIG };
      this.persistConfig();
    }
    this.emit({ type: 'config_changed', config: this.getActiveConfig() });
    this.emit({ type: 'render_needed' });
  }

  public setPhotos(photos: PhotoItem[]) {
    this.photos = photos;
    if (this.activeIndex >= photos.length) {
      this.activeIndex = photos.length - 1;
    }
    this.emit({ type: 'photos_changed' });
    this.emit({ type: 'render_needed' });
  }

  public addPhotos(newPhotos: PhotoItem[]) {
    const wasEmpty = this.photos.length === 0;
    this.photos.push(...newPhotos);
    if (wasEmpty && this.photos.length > 0) {
      this.activeIndex = 0;
    }
    this.emit({ type: 'photos_changed' });
    this.emit({ type: 'render_needed' });
  }

  public removePhoto(index: number) {
    if (index < 0 || index >= this.photos.length) return;
    this.photos.splice(index, 1);
    if (this.activeIndex >= this.photos.length) {
      this.activeIndex = this.photos.length - 1;
    }
    this.emit({ type: 'photos_changed' });
    this.emit({ type: 'render_needed' });
  }

  public clearPhotos() {
    this.photos = [];
    this.activeIndex = -1;
    this.emit({ type: 'photos_changed' });
    this.emit({ type: 'render_needed' });
  }

  public setActiveIndex(index: number) {
    if (index < -1 || index >= this.photos.length) return;
    this.activeIndex = index;
    this.emit({ type: 'active_index_changed', index });
    this.emit({ type: 'config_changed', config: this.getActiveConfig() });
    this.emit({ type: 'render_needed' });
  }

  public updateExportSettings(partial: Partial<ExportSettings>) {
    Object.assign(this.exportSettings, partial);
    this.persistExportSettings();
    this.emit({ type: 'export_settings_changed', settings: this.exportSettings });
  }

  public loadPersistedState() {
    // Config
    try {
      const savedConfig = localStorage.getItem(CONFIG_STORAGE_KEY);
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        this.globalConfig = { ...DEFAULT_FRAME_CONFIG, ...parsed };
      }
    } catch {
      this.globalConfig = { ...DEFAULT_FRAME_CONFIG };
    }

    // Export Settings
    try {
      const savedExport = localStorage.getItem(EXPORT_STORAGE_KEY);
      if (savedExport) {
        const parsed = JSON.parse(savedExport);
        this.exportSettings = { ...this.exportSettings, ...parsed };
      }
    } catch {
      // keep defaults
    }

    // Themes & Visual preferences
    this.currentTheme = (localStorage.getItem('photomark_theme') as any) || 'system';
    this.currentPalette = localStorage.getItem('photomark_palette') || 'amber';
    this.currentFx = (localStorage.getItem('photomark_fx') as any) || 'balanced';
    this.photoLightEnabled = localStorage.getItem('photomark_photo_light') !== '0';
    this.currentUiScale = parseFloat(localStorage.getItem('photomark_ui_scale') || '1.0');
  }

  public persistConfig() {
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(this.globalConfig));
    } catch {
      // ignore
    }
  }

  public persistExportSettings() {
    try {
      localStorage.setItem(EXPORT_STORAGE_KEY, JSON.stringify(this.exportSettings));
    } catch {
      // ignore
    }
  }
}

export const store = new Store();
