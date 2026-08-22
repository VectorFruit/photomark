import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  BackgroundType,
  DEFAULT_FRAME_CONFIG,
  ExifData,
  FrameConfig,
  FrameTemplateId,
  ParseProgressEvent,
  PhotoItem,
} from './types';
import { renderPhotoFrame } from './renderer/canvasRenderer';

// Application State
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

let photos: PhotoItem[] = [];
let activeIndex = -1;
let currentZoom = 1.0;
let currentTheme: 'dark' | 'light' = (localStorage.getItem('photomark_theme') as 'dark' | 'light') || 'dark';
const UI_SCALES = [0.8, 0.85, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5];
let currentUiScale = parseFloat(localStorage.getItem('photomark_ui_scale') || '1.0');

const config: FrameConfig = { ...DEFAULT_FRAME_CONFIG };

const CONFIG_STORAGE_KEY = 'photomark_frame_config';
const EXPORT_STORAGE_KEY = 'photomark_export_settings';
const DEFAULT_FILENAME_TEMPLATE = '{filename}_framed';

interface ExportSettings {
  format: 'jpeg' | 'png' | 'webp';
  quality: number;
  filenameTemplate: string;
}

let exportSettings: ExportSettings = {
  format: 'jpeg',
  quality: 100,
  filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
};

let exportCancelled = false;
let keepProgressModalOpen = false;

// DOM Elements
const photoListEl = document.getElementById('photo-list') as HTMLDivElement;
const photoCountEl = document.getElementById('photo-count') as HTMLSpanElement;
const emptyQueueEl = document.getElementById('empty-queue') as HTMLDivElement;
const previewCanvas = document.getElementById('preview-canvas') as HTMLCanvasElement;
const canvasContainer = document.getElementById('canvas-container') as HTMLDivElement;
const zoomLevelEl = document.getElementById('zoom-level') as HTMLSpanElement;
const toastEl = document.getElementById('toast') as HTMLDivElement;
const fileInputEl = document.getElementById('file-input') as HTMLInputElement;

// UI Scale DOM
const selectUiScale = document.getElementById('select-ui-scale') as HTMLSelectElement;
const btnUiScaleDown = document.getElementById('btn-ui-scale-down') as HTMLButtonElement;
const btnUiScaleUp = document.getElementById('btn-ui-scale-up') as HTMLButtonElement;

// Theme Toggle DOM
const themeToggleBtn = document.getElementById('btn-theme-toggle') as HTMLButtonElement;
const themeTextEl = document.getElementById('theme-text') as HTMLSpanElement;

// Progress Modal DOM
const progressModalEl = document.getElementById('progress-modal') as HTMLDivElement;
const progressTitleEl = document.getElementById('progress-title') as HTMLDivElement;
const progressFillEl = document.getElementById('progress-fill') as HTMLDivElement;
const progressStatusEl = document.getElementById('progress-status') as HTMLSpanElement;
const progressPercentEl = document.getElementById('progress-percent') as HTMLSpanElement;
const progressCancelBtn = document.getElementById('btn-progress-cancel') as HTMLButtonElement | null;
const progressFailuresEl = document.getElementById('progress-failures') as HTMLDivElement | null;

// Slider Value Badges & Inputs
const blurRowEl = document.getElementById('row-blur-intensity') as HTMLDivElement;
const valBlurEl = document.getElementById('val-blur-intensity') as HTMLSpanElement;
const valPaddingEl = document.getElementById('val-padding') as HTMLSpanElement;
const valFontScaleEl = document.getElementById('val-font-scale') as HTMLSpanElement;
const valBorderRadiusEl = document.getElementById('val-border-radius') as HTMLSpanElement;
const valShadowEl = document.getElementById('val-shadow') as HTMLSpanElement;

const inputPadding = document.getElementById('cfg-padding') as HTMLInputElement;
const inputFontScale = document.getElementById('cfg-font-scale') as HTMLInputElement;
const inputBorderRadius = document.getElementById('cfg-border-radius') as HTMLInputElement;
const inputShadow = document.getElementById('cfg-shadow') as HTMLInputElement;
const inputBlurIntensity = document.getElementById('cfg-blur-intensity') as HTMLInputElement;

// Image Cache (for fast preview)
const previewImageCache: Map<string, HTMLImageElement> = new Map();

async function init() {
  applyTheme(currentTheme);
  applyUiScale(currentUiScale);
  loadPersistedState();
  bindEvents();
  setupProgressListeners();
  syncUIWithConfig();
  syncExportSettingsUI();
  updateValueBadges();
  renderPhotoList();
}

function applyUiScale(scale: number) {
  currentUiScale = Math.min(1.5, Math.max(0.8, Math.round(scale * 100) / 100));
  (document.body.style as any).zoom = `${currentUiScale}`;
  localStorage.setItem('photomark_ui_scale', `${currentUiScale}`);

  if (selectUiScale) {
    selectUiScale.value = `${currentUiScale}`;
    if (!selectUiScale.value) {
      selectUiScale.value = `${currentUiScale}`;
    }
  }
}

function applyTheme(theme: 'dark' | 'light') {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('photomark_theme', theme);

  if (theme === 'light') {
    themeTextEl.textContent = '深色模式';
  } else {
    themeTextEl.textContent = '浅色模式';
  }
}

function loadPersistedState() {
  try {
    const savedConfig = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (savedConfig) {
      const parsed = JSON.parse(savedConfig);
      if (parsed && typeof parsed === 'object') {
        Object.assign(config, { ...DEFAULT_FRAME_CONFIG, ...parsed });
      }
    }
  } catch {
    // ignore corrupted persisted config
  }

  try {
    const savedExport = localStorage.getItem(EXPORT_STORAGE_KEY);
    if (savedExport) {
      const parsed = JSON.parse(savedExport);
      if (parsed && typeof parsed === 'object') {
        if (['jpeg', 'png', 'webp'].includes(parsed.format)) exportSettings.format = parsed.format;
        if (typeof parsed.quality === 'number' && parsed.quality >= 70 && parsed.quality <= 100) {
          exportSettings.quality = parsed.quality;
        }
        if (typeof parsed.filenameTemplate === 'string') {
          exportSettings.filenameTemplate = parsed.filenameTemplate;
        }
      }
    }
  } catch {
    // ignore corrupted persisted export settings
  }
}

function persistConfig() {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage may be unavailable
  }
}

function persistExportSettings() {
  try {
    localStorage.setItem(EXPORT_STORAGE_KEY, JSON.stringify(exportSettings));
  } catch {
    // localStorage may be unavailable
  }
}

function syncExportSettingsUI() {
  const formatEl = document.getElementById('export-format') as HTMLSelectElement | null;
  const qualityEl = document.getElementById('export-quality-select') as HTMLSelectElement | null;
  const templateEl = document.getElementById('export-filename-template') as HTMLInputElement | null;
  if (formatEl) formatEl.value = exportSettings.format;
  if (qualityEl) qualityEl.value = exportSettings.quality + '';
  if (templateEl) templateEl.value = exportSettings.filenameTemplate;
}

function sanitizeFilenamePart(input: string): string {
  return input.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
}

function sanitizeFilename(input: string): string {
  return sanitizeFilenamePart(input) || 'photo';
}

function buildOutputName(item: PhotoItem, index: number): string {
  const template = (exportSettings.filenameTemplate || DEFAULT_FILENAME_TEMPLATE).trim() || DEFAULT_FILENAME_TEMPLATE;
  const base = item.filename.replace(/\.[^/.]+$/, '');
  const model = sanitizeFilenamePart(item.exif.model || item.exif.make || 'camera') || 'camera';
  const make = sanitizeFilenamePart(item.exif.make || 'camera') || 'camera';
  const lens = sanitizeFilenamePart(item.exif.lens_model || '') || '';
  const date = item.exif.datetime ? String(item.exif.datetime).replace(/[^\d]/g, '').slice(0, 12) : '';
  const width = item.exif.width || 0;
  const height = item.exif.height || 0;
  const tokens: Record<string, string> = {
    '{filename}': base,
    '{model}': model,
    '{make}': make,
    '{lens}': lens,
    '{date}': date,
    '{index}': String(index + 1),
    '{width}': String(width),
    '{height}': String(height),
  };
  let name = template;
  for (const [key, value] of Object.entries(tokens)) {
    name = name.split(key).join(value);
  }
  const ext = exportSettings.format === 'jpeg' ? 'jpg' : exportSettings.format;
  return sanitizeFilename(name) + '.' + ext;
}

async function resolveUniqueOutputPath(outputDir: string, filename: string): Promise<string> {
  if (!isTauri) return outputDir + '/' + filename;
  try {
    return await invoke('resolve_unique_path', { outputDir, filename });
  } catch {
    return outputDir + '/' + filename;
  }
}

function setupProgressListeners() {
  // Browser mode has no Rust-side progress events
  if (!isTauri) return;

  listen<ParseProgressEvent>('parse-progress', (event) => {
    const { current, total, filename, percent } = event.payload;
    showProgressModal('正在解析照片 EXIF...', `(${current}/${total}) ${filename}`, percent);
  });

  listen<ParseProgressEvent>('batch-progress', (event) => {
    const { current, total, filename, percent } = event.payload;
    showProgressModal('正在批量导出...', `(${current}/${total}) ${filename}`, percent);
  });
}

function showProgressModal(title: string, status: string, percent: number, showCancel = false) {
  progressModalEl.style.display = 'flex';
  progressTitleEl.textContent = title;
  progressStatusEl.textContent = status;
  progressPercentEl.textContent = percent + '%';
  progressFillEl.style.width = percent + '%';
  if (progressCancelBtn) progressCancelBtn.style.display = showCancel ? 'block' : 'none';
  if (progressFailuresEl) progressFailuresEl.style.display = 'none';
}

function hideProgressModal() {
  setTimeout(() => {
    progressModalEl.style.display = 'none';
  }, 400);
}

function updateValueBadges() {
  if (valPaddingEl) valPaddingEl.textContent = `${config.paddingPercent}%`;
  if (valFontScaleEl) valFontScaleEl.textContent = `${Math.round(config.fontSizeScale * 100)}%`;
  if (valBorderRadiusEl) valBorderRadiusEl.textContent = `${config.borderRadius}px`;
  if (valShadowEl) valShadowEl.textContent = `${config.shadowRadius}`;
  if (valBlurEl) valBlurEl.textContent = `${config.blurIntensity}`;

  if (blurRowEl) {
    blurRowEl.style.display = config.backgroundType === 'frosted_blur' ? 'flex' : 'none';
  }
}

function bindEvents() {
  // UI Scale Select & Step Buttons
  selectUiScale?.addEventListener('change', () => {
    applyUiScale(parseFloat(selectUiScale.value));
  });

  btnUiScaleDown?.addEventListener('click', () => {
    const idx = UI_SCALES.findIndex((s) => s >= currentUiScale);
    const nextIdx = Math.max(0, (idx === -1 ? UI_SCALES.length - 1 : idx) - 1);
    applyUiScale(UI_SCALES[nextIdx]);
  });

  btnUiScaleUp?.addEventListener('click', () => {
    const idx = UI_SCALES.findIndex((s) => s > currentUiScale);
    const nextIdx = idx === -1 ? UI_SCALES.length - 1 : idx;
    applyUiScale(UI_SCALES[nextIdx]);
  });

  // Theme Toggle Button
  themeToggleBtn?.addEventListener('click', () => {
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
  });

  // Import Buttons
  document.getElementById('btn-import-photos')?.addEventListener('click', handleImportDialog);
  emptyQueueEl?.addEventListener('click', handleImportDialog);

  // Browser mode: hidden file input
  fileInputEl?.addEventListener('change', async () => {
    if (fileInputEl.files && fileInputEl.files.length > 0) {
      await importBrowserFiles(Array.from(fileInputEl.files));
      fileInputEl.value = '';
    }
  });

  // Clear All Photos
  document.getElementById('btn-clear-all')?.addEventListener('click', () => {
    photos = [];
    activeIndex = -1;
    previewImageCache.clear();
    renderPhotoList();
    clearCanvas();
  });

  // Global Reset All Config Button
  document.getElementById('btn-reset-all')?.addEventListener('click', () => {
    Object.assign(config, DEFAULT_FRAME_CONFIG);
    syncUIWithConfig();
    triggerReRender();
    showToast('已重置所有参数为默认配置');
  });

  // Single Slider Reset Buttons
  document.querySelectorAll('.btn-reset-single').forEach((btn) => {
    btn.addEventListener('click', () => {
      const resetType = btn.getAttribute('data-reset');
      switch (resetType) {
        case 'padding':
          config.paddingPercent = DEFAULT_FRAME_CONFIG.paddingPercent;
          inputPadding.value = `${config.paddingPercent}`;
          break;
        case 'font-scale':
          config.fontSizeScale = DEFAULT_FRAME_CONFIG.fontSizeScale;
          inputFontScale.value = `${Math.round(config.fontSizeScale * 100)}`;
          break;
        case 'border-radius':
          config.borderRadius = DEFAULT_FRAME_CONFIG.borderRadius;
          inputBorderRadius.value = `${config.borderRadius}`;
          break;
        case 'shadow':
          config.shadowRadius = DEFAULT_FRAME_CONFIG.shadowRadius;
          config.shadowOpacity = DEFAULT_FRAME_CONFIG.shadowOpacity;
          inputShadow.value = `${config.shadowRadius}`;
          break;
        case 'blur-intensity':
          config.blurIntensity = DEFAULT_FRAME_CONFIG.blurIntensity;
          inputBlurIntensity.value = `${config.blurIntensity}`;
          break;
      }
      updateValueBadges();
      triggerReRender();
    });
  });

  // Template Buttons
  document.querySelectorAll('.template-card').forEach((card) => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.template-card').forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      config.template = card.getAttribute('data-template') as FrameTemplateId;
      triggerReRender();
    });
  });

  // Background Type Buttons (纯白 / 深黑 / 毛玻璃虚化)
  document.querySelectorAll('.bg-type-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bg-type-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      config.backgroundType = btn.getAttribute('data-bg') as BackgroundType;

      const customRow = document.getElementById('custom-color-row');
      if (customRow) {
        customRow.style.display = config.backgroundType === 'custom' ? 'flex' : 'none';
      }

      updateValueBadges();
      triggerReRender();
    });
  });

  const customColorInput = document.getElementById('cfg-custom-color') as HTMLInputElement | null;
  customColorInput?.addEventListener('input', () => {
    config.customBackgroundColor = customColorInput.value;
    triggerReRender();
  });

  // Controls Binding
  bindCheckbox('cfg-show-logo', (val) => (config.showLogo = val));
  bindSelect('cfg-brand-logo', (val) => (config.selectedLogo = val));
  bindSelect('cfg-focal-mode', (val) => (config.focalLengthMode = val as any));
  bindCheckbox('cfg-show-model', (val) => (config.showModel = val));
  bindCheckbox('cfg-show-lens', (val) => (config.showLens = val));
  bindCheckbox('cfg-show-params', (val) => (config.showParams = val));
  bindCheckbox('cfg-show-date', (val) => (config.showDate = val));
  bindInput('cfg-custom-note', (val) => {
    config.customNote = val;
    config.showCustomNote = !!val;
  });

  // Sliders with Live Badge Updates
  inputPadding?.addEventListener('input', () => {
    config.paddingPercent = parseInt(inputPadding.value, 10);
    updateValueBadges();
    triggerReRender();
  });

  inputFontScale?.addEventListener('input', () => {
    config.fontSizeScale = parseInt(inputFontScale.value, 10) / 100;
    updateValueBadges();
    triggerReRender();
  });

  inputBorderRadius?.addEventListener('input', () => {
    config.borderRadius = parseInt(inputBorderRadius.value, 10);
    updateValueBadges();
    triggerReRender();
  });

  inputShadow?.addEventListener('input', () => {
    config.shadowRadius = parseInt(inputShadow.value, 10);
    config.shadowOpacity = config.shadowRadius > 0 ? 0.28 : 0;
    updateValueBadges();
    triggerReRender();
  });

  inputBlurIntensity?.addEventListener('input', () => {
    config.blurIntensity = parseInt(inputBlurIntensity.value, 10);
    updateValueBadges();
    triggerReRender();
  });

  // Zoom Toolbar
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => setZoom(currentZoom + 0.15));
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => setZoom(Math.max(0.2, currentZoom - 0.15)));
  document.getElementById('btn-zoom-fit')?.addEventListener('click', () => setZoom(1.0));

  // Export Buttons
  document.getElementById('btn-export-current')?.addEventListener('click', handleExportCurrent);
  document.getElementById('btn-batch-export')?.addEventListener('click', handleBatchExport);

  // Export Settings Persistence
  const exportFormatEl = document.getElementById('export-format') as HTMLSelectElement | null;
  const exportQualityEl = document.getElementById('export-quality-select') as HTMLSelectElement | null;
  const exportTemplateEl = document.getElementById('export-filename-template') as HTMLInputElement | null;
  exportFormatEl?.addEventListener('change', () => {
    exportSettings.format = exportFormatEl.value as ExportSettings['format'];
    persistExportSettings();
  });
  exportQualityEl?.addEventListener('change', () => {
    exportSettings.quality = parseInt(exportQualityEl.value, 10);
    persistExportSettings();
  });
  exportTemplateEl?.addEventListener('input', () => {
    exportSettings.filenameTemplate = exportTemplateEl.value;
    persistExportSettings();
  });

  // Progress Cancel / Result Close
  progressCancelBtn?.addEventListener('click', () => {
    if (keepProgressModalOpen) {
      keepProgressModalOpen = false;
      hideProgressModal();
      return;
    }
    exportCancelled = true;
    if (progressCancelBtn) progressCancelBtn.textContent = '正在取消...';
  });

  // Drag & Drop
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', handleFileDrop);
}

function syncUIWithConfig() {
  inputPadding.value = `${config.paddingPercent}`;
  inputFontScale.value = `${Math.round(config.fontSizeScale * 100)}`;
  inputBorderRadius.value = `${config.borderRadius}`;
  inputShadow.value = `${config.shadowRadius}`;
  inputBlurIntensity.value = `${config.blurIntensity}`;

  // Update Focal Length Mode Select
  const focalSelect = document.getElementById('cfg-focal-mode') as HTMLSelectElement | null;
  if (focalSelect) focalSelect.value = config.focalLengthMode || 'physical';

  // Update Inputs & Checkboxes
  const customNoteInput = document.getElementById('cfg-custom-note') as HTMLInputElement | null;
  if (customNoteInput) customNoteInput.value = config.customNote || '';

  const showLogoCheckbox = document.getElementById('cfg-show-logo') as HTMLInputElement | null;
  if (showLogoCheckbox) showLogoCheckbox.checked = config.showLogo;

  const showModelCheckbox = document.getElementById('cfg-show-model') as HTMLInputElement | null;
  if (showModelCheckbox) showModelCheckbox.checked = config.showModel;

  const showLensCheckbox = document.getElementById('cfg-show-lens') as HTMLInputElement | null;
  if (showLensCheckbox) showLensCheckbox.checked = config.showLens;

  const showParamsCheckbox = document.getElementById('cfg-show-params') as HTMLInputElement | null;
  if (showParamsCheckbox) showParamsCheckbox.checked = config.showParams;

  const showDateCheckbox = document.getElementById('cfg-show-date') as HTMLInputElement | null;
  if (showDateCheckbox) showDateCheckbox.checked = config.showDate;

  const brandSelect = document.getElementById('cfg-brand-logo') as HTMLSelectElement | null;
  if (brandSelect) brandSelect.value = config.selectedLogo || 'auto';

  // Update Template Active Card
  document.querySelectorAll('.template-card').forEach((card) => {
    card.classList.toggle('active', card.getAttribute('data-template') === config.template);
  });

  // Update Background Button Active
  document.querySelectorAll('.bg-type-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-bg') === config.backgroundType);
  });

  // Keep custom color row in sync (reset-all / persisted config)
  const customRow = document.getElementById('custom-color-row');
  if (customRow) {
    customRow.style.display = config.backgroundType === 'custom' ? 'flex' : 'none';
  }

  updateValueBadges();
}

// -----------------------------------------------------------------------------
// Photo Queue Management
// -----------------------------------------------------------------------------
async function handleImportDialog() {
  if (!isTauri) {
    fileInputEl?.click();
    return;
  }

  try {
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: 'Images',
          extensions: [
            'jpg',
            'jpeg',
            'png',
            'webp',
            'tiff',
            'tif',
            'JPG',
            'JPEG',
            'PNG',
            'WEBP',
            'TIFF',
            'TIF',
          ],
        },
      ],
    });

    if (selected && Array.isArray(selected) && selected.length > 0) {
      await importPaths(selected);
    } else if (typeof selected === 'string') {
      await importPaths([selected]);
    }
  } catch (err) {
    showToast(`导入失败: ${err}`);
  }
}

async function handleFileDrop(e: DragEvent) {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;

  // Browser mode: use File objects directly
  if (!isTauri) {
    await importBrowserFiles(Array.from(files));
    return;
  }

  const paths: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const p = (files[i] as any).path || files[i].name;
    if (p) paths.push(p);
  }

  if (paths.length > 0) {
    await importPaths(paths);
  }
}

async function importPaths(paths: string[]) {
  try {
    showProgressModal('准备解析照片...', '正在读取文件列表...', 5);
    const newItems: PhotoItem[] = await invoke('load_photos', { paths });

    if (newItems.length > 0) {
      photos.push(...newItems);
      if (activeIndex === -1) {
        activeIndex = 0;
      }
      renderPhotoList();
      triggerReRender();
      showToast(`成功导入 ${newItems.length} 张照片`);
    }
  } catch (err) {
    showToast(`解析失败: ${err}`);
  } finally {
    hideProgressModal();
  }
}

// -----------------------------------------------------------------------------
// Browser Mode (no Tauri runtime): import via file picker, EXIF parsed in-page
// -----------------------------------------------------------------------------
const BROWSER_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

async function importBrowserFiles(files: File[]) {
  const imageFiles = files.filter(
    (f) => BROWSER_IMAGE_TYPES.has(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name)
  );
  if (imageFiles.length === 0) {
    showToast('没有可导入的图片文件');
    return;
  }

  try {
    showProgressModal('正在解析照片...', '正在读取文件...', 5);
    const newItems: PhotoItem[] = [];

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      try {
        const exif = await parseExifInBrowser(file);
        const thumbnail = await makeThumbnail(file);
        newItems.push({
          id: `${file.name}-${file.size}-${i}`,
          path: `browser://${file.name}#${i}`,
          filename: file.name,
          size_bytes: file.size,
          exif,
          thumbnail_data_url: thumbnail,
          sourceFile: file,
        });
      } catch (err) {
        console.warn('解析失败，已跳过:', file.name, err);
      }
      showProgressModal(
        '正在解析照片 EXIF...',
        `(${i + 1}/${imageFiles.length}) ${file.name}`,
        Math.round(((i + 1) / imageFiles.length) * 90)
      );
    }

    if (newItems.length > 0) {
      photos.push(...newItems);
      if (activeIndex === -1) activeIndex = 0;
      renderPhotoList();
      triggerReRender();
      showToast(`成功导入 ${newItems.length} 张照片`);
    }
  } catch (err) {
    showToast(`导入失败: ${err}`);
  } finally {
    hideProgressModal();
  }
}

async function parseExifInBrowser(file: File): Promise<ExifData> {
  const exifr = await import('exifr');
  const raw: any = (await exifr.parse(file)) || {};
  const exif: ExifData = {};

  // exifr names tags per-IFD; some files store tags flattened into IFD0
  // where exifr leaves numeric keys, so resolve by name first, then by tag id.
  const getTag = (names: string[], id: number): any => {
    for (const n of names) {
      const v = raw[n];
      if (v !== undefined && v !== null) return v;
    }
    return raw[id];
  };

  const make = getTag(['Make'], 271);
  if (make) exif.make = String(make).trim();
  const model = getTag(['Model'], 272);
  if (model) exif.model = String(model).trim();
  const lens = getTag(['LensModel'], 42036);
  if (lens) exif.lens_model = String(lens).trim();

  const fNumber = exifToNumber(getTag(['FNumber'], 33437));
  if (fNumber !== undefined) exif.f_number = `f/${trimNumber(fNumber, 1)}`.replace('.0', '');

  const exposure = exifToNumber(getTag(['ExposureTime'], 33434));
  if (exposure !== undefined && exposure > 0) {
    exif.exposure_time =
      exposure >= 1 ? `${trimNumber(exposure, 1)}s` : `1/${Math.round(1 / exposure)}s`;
  }

  const iso = exifToNumber(getTag(['ISO', 'PhotographicSensitivity'], 34855));
  if (iso !== undefined) exif.iso = `ISO ${iso}`;

  const focal = exifToNumber(getTag(['FocalLength'], 37386));
  if (focal !== undefined) exif.focal_length = `${trimNumber(focal, 1)}mm`;
  const focal35 = exifToNumber(getTag(['FocalLengthIn35mmFormat', 'FocalLengthIn35mmFilm'], 41989));
  if (focal35 !== undefined) exif.focal_length_35mm = `${trimNumber(focal35, 1)}mm`;

  const dt = getTag(['DateTimeOriginal'], 36867);
  if (dt) exif.datetime = formatExifDateTime(dt);

  const bias = exifToNumber(getTag(['ExposureCompensation', 'ExposureBiasValue'], 37380));
  if (bias !== undefined && Math.abs(bias) > 0.01) {
    const sign = bias > 0 ? '+' : '';
    exif.exposure_bias = `${sign}${trimNumber(bias, 1)} EV`;
  }

  const orientation = getTag(['Orientation'], 274);
  if (typeof orientation === 'number') {
    exif.orientation = orientation;
  } else if (typeof orientation === 'string') {
    exif.orientation = ORIENTATION_MAP[orientation];
  }

  const width = exifToNumber(getTag(['ExifImageWidth', 'PixelXDimension'], 40962));
  if (width !== undefined) exif.width = width;
  const height = exifToNumber(getTag(['ExifImageHeight', 'PixelYDimension'], 40963));
  if (height !== undefined) exif.height = height;

  return exif;
}

const ORIENTATION_MAP: Record<string, number> = {
  'Horizontal (normal)': 1,
  'Mirror horizontal': 2,
  'Rotate 180': 3,
  'Mirror vertical': 4,
  'Mirror horizontal and rotate 270 CW': 5,
  'Rotate 90 CW': 6,
  'Mirror horizontal and rotate 90 CW': 7,
  'Rotate 270 CW': 8,
};

/** Normalize an exifr value to a number: accepts plain numbers, [num, denom] arrays and {0:num,1:denom} objects. */
function exifToNumber(v: any): number | undefined {
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && v.length >= 2) {
    const num = Number(v[0]);
    const den = Number(v[1]);
    return den ? num / den : undefined;
  }
  if (v && typeof v === 'object' && v[0] !== undefined && v[1] !== undefined) {
    const num = Number(v[0]);
    const den = Number(v[1]);
    return den ? num / den : undefined;
  }
  return undefined;
}

function trimNumber(v: number, digits: number): string {
  return v.toFixed(digits).replace(/\.?0+$/, '');
}

function formatExifDateTime(d: unknown): string {
  if (d instanceof Date) {
    // exifr interprets EXIF wall-clock time in the local timezone
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (typeof d === 'string') {
    const m = d.match(/^(\d{4})[:/-](\d{2})[:/-](\d{2})[ T](\d{2}):(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
    return d;
  }
  return '';
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法解码图片'));
    };
    img.src = url;
  });
}

async function makeThumbnail(file: File): Promise<string> {
  const img = await loadImageFromFile(file);
  const maxSide = 512;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')?.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(img.src);
  return c.toDataURL('image/jpeg', 0.82);
}

function canvasToBlob(canvas: HTMLCanvasElement, format: string, quality: number): Promise<Blob | null> {
  const mime = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality / 100));
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function renderPhotoList() {
  photoCountEl.textContent = `${photos.length}`;
  emptyQueueEl.style.display = photos.length === 0 ? 'flex' : 'none';
  photoListEl.innerHTML = '';

  photos.forEach((photo, idx) => {
    const card = document.createElement('div');
    card.className = `photo-card ${idx === activeIndex ? 'active' : ''}`;

    const thumb = document.createElement('img');
    thumb.className = 'photo-thumb';
    thumb.src = photo.thumbnail_data_url || '';

    const meta = document.createElement('div');
    meta.className = 'photo-meta';

    const name = document.createElement('div');
    name.className = 'photo-name';
    name.textContent = photo.filename;

    const badge = document.createElement('div');
    badge.className = 'photo-exif-badge';
    const camera = photo.exif.model || photo.exif.make || 'No EXIF';
    const lens = photo.exif.lens_model ? ` | ${photo.exif.lens_model}` : '';
    badge.textContent = `${camera}${lens}`;

    meta.appendChild(name);
    meta.appendChild(badge);

    const delBtn = document.createElement('button');
    delBtn.className = 'photo-remove';
    delBtn.innerHTML = '✕';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      photos.splice(idx, 1);
      if (activeIndex >= photos.length) activeIndex = photos.length - 1;
      renderPhotoList();
      triggerReRender();
    };

    card.appendChild(thumb);
    card.appendChild(meta);
    card.appendChild(delBtn);

    card.onclick = () => {
      activeIndex = idx;
      renderPhotoList();
      triggerReRender();
    };

    photoListEl.appendChild(card);
  });
}

// -----------------------------------------------------------------------------
// Canvas Live Preview Rendering
// -----------------------------------------------------------------------------
let renderTimer: any = null;

function triggerReRender() {
  persistConfig();
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(doRender, 30);
}

async function doRender() {
  if (activeIndex < 0 || activeIndex >= photos.length) {
    clearCanvas();
    return;
  }

  const currentPhoto = photos[activeIndex];
  let img = previewImageCache.get(currentPhoto.path);

  if (!img) {
    img = new Image();
    img.src = currentPhoto.thumbnail_data_url || '';
    await new Promise((res) => (img!.onload = res));
    previewImageCache.set(currentPhoto.path, img);
  }

  await renderPhotoFrame(img, currentPhoto.exif, config, previewCanvas);
}

function clearCanvas() {
  const ctx = previewCanvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewCanvas.width = 0;
    previewCanvas.height = 0;
  }
}

function setZoom(val: number) {
  currentZoom = val;
  canvasContainer.style.transform = `scale(${currentZoom})`;
  zoomLevelEl.textContent = `${Math.round(currentZoom * 100)}%`;
}

// -----------------------------------------------------------------------------
// Exporting Operations (Full Original Resolution)
// -----------------------------------------------------------------------------
async function handleExportCurrent() {
  if (activeIndex < 0 || activeIndex >= photos.length) {
    showToast('当前没有选中任何照片');
    return;
  }

  const currentPhoto = photos[activeIndex];

  // Browser mode: export via canvas download
  if (!isTauri) {
    await handleExportCurrentBrowser(currentPhoto);
    return;
  }

  const format = exportSettings.format;
  const quality = exportSettings.quality;
  const ext = format === 'jpeg' ? 'jpg' : format;

  const defaultName = buildOutputName(currentPhoto, activeIndex);

  try {
    const savePath = await save({
      defaultPath: defaultName,
      filters: [{ name: 'Image', extensions: [ext] }],
    });

    if (!savePath) return;

    showProgressModal('正在导出照片...', '读取原始分辨率像素...', 25);

    const fullResDataUrl: string = await invoke('load_full_photo', {
      path: currentPhoto.path,
      orientation: currentPhoto.exif.orientation,
    });

    showProgressModal('正在渲染照片...', '生成相框排版...', 60);

    const fullImg = new Image();
    fullImg.src = fullResDataUrl;
    await new Promise((res) => (fullImg.onload = res));

    const exportCanvas = document.createElement('canvas');
    await renderPhotoFrame(fullImg, currentPhoto.exif, config, exportCanvas);

    showProgressModal('正在编码与写入文件...', '分辨率: ' + exportCanvas.width + ' × ' + exportCanvas.height, 85);

    const base64Data = exportCanvas.toDataURL('image/png');

    await invoke('save_rendered_photo', {
      outputPath: savePath,
      base64Data,
      format,
      quality,
    });

    showToast('已保存 (' + exportCanvas.width + '×' + exportCanvas.height + '): ' + savePath);
  } catch (err) {
    showToast('导出失败: ' + err);
  } finally {
    hideProgressModal();
  }
}

async function handleExportCurrentBrowser(item: PhotoItem) {
  if (!item.sourceFile) {
    showToast('文件句柄缺失，请重新导入');
    return;
  }

  const format = exportSettings.format;
  const quality = exportSettings.quality;
  const defaultName = buildOutputName(item, activeIndex);

  try {
    showProgressModal('正在导出照片...', '读取原始分辨率像素...', 25);

    const img = await loadImageFromFile(item.sourceFile);

    showProgressModal('正在渲染照片...', '生成相框排版...', 60);

    const exportCanvas = document.createElement('canvas');
    await renderPhotoFrame(img, item.exif, config, exportCanvas);

    showProgressModal('正在写入文件...', '分辨率: ' + exportCanvas.width + ' × ' + exportCanvas.height, 85);

    const blob = await canvasToBlob(exportCanvas, format, quality);
    if (blob) downloadBlob(blob, defaultName);
    showToast('已保存 (' + exportCanvas.width + '×' + exportCanvas.height + '): ' + defaultName);
  } catch (err) {
    showToast('导出失败: ' + err);
  } finally {
    hideProgressModal();
  }
}

async function handleBatchExport() {
  // Browser mode: sequential downloads
  if (!isTauri) {
    await handleBatchExportBrowser();
    return;
  }

  if (photos.length === 0) {
    showToast('列表为空，请先添加照片');
    return;
  }

  const outputDir = await open({
    directory: true,
    multiple: false,
  });
  if (!outputDir || typeof outputDir !== 'string') return;

  const format = exportSettings.format;
  const quality = exportSettings.quality;
  const failures: { filename: string; error: string }[] = [];
  let successCount = 0;

  exportCancelled = false;
  keepProgressModalOpen = false;

  try {
    showProgressModal('准备批量导出...', '共 ' + photos.length + ' 张照片', 5, true);
    if (progressCancelBtn) {
      progressCancelBtn.style.display = 'block';
      progressCancelBtn.textContent = '取消任务';
    }
    if (progressFailuresEl) progressFailuresEl.style.display = 'none';

    for (let i = 0; i < photos.length; i++) {
      if (exportCancelled) {
        showToast('已取消导出，完成 ' + successCount + ' / ' + photos.length + ' 张');
        return;
      }

      const item = photos[i];
      showProgressModal(
        '正在渲染照片...',
        '(' + (i + 1) + '/' + photos.length + ') ' + item.filename,
        Math.round(((i + 1) / photos.length) * 65),
        true
      );

      try {
        const fullResDataUrl: string = await invoke('load_full_photo', {
          path: item.path,
          orientation: item.exif.orientation,
        });

        const fullImg = new Image();
        fullImg.src = fullResDataUrl;
        await new Promise((res) => (fullImg.onload = res));

        const canvas = document.createElement('canvas');
        await renderPhotoFrame(fullImg, item.exif, config, canvas);
        const base64Data = canvas.toDataURL('image/png');

        showProgressModal(
          '正在写入文件...',
          '(' + (i + 1) + '/' + photos.length + ') ' + item.filename,
          70 + Math.round(((i + 1) / photos.length) * 25),
          true
        );

        const outName = buildOutputName(item, i);
        const outPath = await resolveUniqueOutputPath(outputDir, outName);
        await invoke('save_rendered_photo', {
          outputPath: outPath,
          base64Data,
          format,
          quality,
        });
        successCount++;
      } catch (err) {
        failures.push({ filename: item.filename, error: String(err) });
      }
    }

    if (exportCancelled) {
      showToast('已取消导出，完成 ' + successCount + ' / ' + photos.length + ' 张');
      return;
    }

    if (failures.length === 0) {
      showToast('批量导出完成: ' + successCount + ' / ' + photos.length + ' 张');
    } else {
      showProgressModal(
        '部分照片导出失败',
        '成功 ' + successCount + ' / ' + photos.length + ' 张，失败 ' + failures.length + ' 张',
        100,
        true
      );
      keepProgressModalOpen = true;
      if (progressFailuresEl) {
        progressFailuresEl.style.display = 'block';
        const items = failures
          .slice(0, 8)
          .map((f) => '<li>' + f.filename + ': ' + f.error + '</li>')
          .join('');
        progressFailuresEl.innerHTML = '<div class="failure-title">失败明细 (前 8 条)</div><ul>' + items + '</ul>';
      }
      if (progressCancelBtn) {
        progressCancelBtn.style.display = 'block';
        progressCancelBtn.textContent = '关闭';
      }
    }
  } catch (err) {
    showToast('批量导出失败: ' + err);
  } finally {
    if (!keepProgressModalOpen) hideProgressModal();
  }
}

async function handleBatchExportBrowser() {
  if (photos.length === 0) {
    showToast('列表为空，请先添加照片');
    return;
  }

  const format = exportSettings.format;
  const quality = exportSettings.quality;

  showProgressModal('准备批量导出...', '共 ' + photos.length + ' 张照片', 5);

  let ok = 0;
  try {
    for (let i = 0; i < photos.length; i++) {
      const item = photos[i];
      showProgressModal(
        '正在渲染照片...',
        '(' + (i + 1) + '/' + photos.length + ') ' + item.filename,
        Math.round(((i + 1) / photos.length) * 80)
      );

      if (!item.sourceFile) continue;
      try {
        const img = await loadImageFromFile(item.sourceFile);
        const canvas = document.createElement('canvas');
        await renderPhotoFrame(img, item.exif, config, canvas);
        const blob = await canvasToBlob(canvas, format, quality);
        const outName = buildOutputName(item, i);
        if (blob) downloadBlob(blob, outName);
        ok++;
      } catch (err) {
        console.warn('导出失败:', item.filename, err);
      }
      await new Promise((r) => setTimeout(r, 350));
    }
    showToast('批量导出完成: ' + ok + ' / ' + photos.length + ' 张');
  } catch (err) {
    showToast('批量导出失败: ' + err);
  } finally {
    hideProgressModal();
  }
}


function showToast(msg: string) {
  toastEl.textContent = msg;
  toastEl.style.display = 'block';
  setTimeout(() => {
    toastEl.style.display = 'none';
  }, 3500);
}

function bindCheckbox(id: string, setter: (val: boolean) => void) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  el?.addEventListener('change', () => {
    setter(el.checked);
    triggerReRender();
  });
}

function bindSelect(id: string, setter: (val: string) => void) {
  const el = document.getElementById(id) as HTMLSelectElement | null;
  el?.addEventListener('change', () => {
    setter(el.value);
    triggerReRender();
  });
}

function bindInput(id: string, setter: (val: string) => void) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  el?.addEventListener('input', () => {
    setter(el.value);
    triggerReRender();
  });
}

// Start
window.addEventListener('DOMContentLoaded', init);
