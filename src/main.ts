import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  BackgroundType,
  DEFAULT_FRAME_CONFIG,
  FrameConfig,
  FrameTemplateId,
  ParseProgressEvent,
  PhotoItem,
} from './types';
import { renderPhotoFrame } from './renderer/canvasRenderer';

// Application State
let photos: PhotoItem[] = [];
let activeIndex = -1;
let currentZoom = 1.0;
let currentTheme: 'dark' | 'light' = (localStorage.getItem('photomark_theme') as 'dark' | 'light') || 'dark';

const config: FrameConfig = { ...DEFAULT_FRAME_CONFIG };

// DOM Elements
const photoListEl = document.getElementById('photo-list') as HTMLDivElement;
const photoCountEl = document.getElementById('photo-count') as HTMLSpanElement;
const emptyQueueEl = document.getElementById('empty-queue') as HTMLDivElement;
const previewCanvas = document.getElementById('preview-canvas') as HTMLCanvasElement;
const canvasContainer = document.getElementById('canvas-container') as HTMLDivElement;
const zoomLevelEl = document.getElementById('zoom-level') as HTMLSpanElement;
const toastEl = document.getElementById('toast') as HTMLDivElement;

// Theme Toggle DOM
const themeToggleBtn = document.getElementById('btn-theme-toggle') as HTMLButtonElement;
const themeIconEl = document.getElementById('theme-icon') as HTMLSpanElement;
const themeTextEl = document.getElementById('theme-text') as HTMLSpanElement;

// Progress Modal DOM
const progressModalEl = document.getElementById('progress-modal') as HTMLDivElement;
const progressTitleEl = document.getElementById('progress-title') as HTMLDivElement;
const progressFillEl = document.getElementById('progress-fill') as HTMLDivElement;
const progressStatusEl = document.getElementById('progress-status') as HTMLSpanElement;
const progressPercentEl = document.getElementById('progress-percent') as HTMLSpanElement;

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
  bindEvents();
  setupProgressListeners();
  updateValueBadges();
  renderPhotoList();
}

function applyTheme(theme: 'dark' | 'light') {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('photomark_theme', theme);

  if (theme === 'light') {
    themeIconEl.textContent = '🌙';
    themeTextEl.textContent = '深色模式';
  } else {
    themeIconEl.textContent = '☀️';
    themeTextEl.textContent = '浅色模式';
  }
}

function setupProgressListeners() {
  listen<ParseProgressEvent>('parse-progress', (event) => {
    const { current, total, filename, percent } = event.payload;
    showProgressModal('正在解析照片 EXIF...', `(${current}/${total}) ${filename}`, percent);
  });

  listen<ParseProgressEvent>('batch-progress', (event) => {
    const { current, total, filename, percent } = event.payload;
    showProgressModal('正在批量导出原画照片...', `(${current}/${total}) ${filename}`, percent);
  });
}

function showProgressModal(title: string, status: string, percent: number) {
  progressModalEl.style.display = 'flex';
  progressTitleEl.textContent = title;
  progressStatusEl.textContent = status;
  progressPercentEl.textContent = `${percent}%`;
  progressFillEl.style.width = `${percent}%`;
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
  // Theme Toggle Button
  themeToggleBtn?.addEventListener('click', () => {
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
  });

  // Import Buttons
  document.getElementById('btn-import-photos')?.addEventListener('click', handleImportDialog);
  emptyQueueEl?.addEventListener('click', handleImportDialog);

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

  // Update Template Active Card
  document.querySelectorAll('.template-card').forEach((card) => {
    card.classList.toggle('active', card.getAttribute('data-template') === config.template);
  });

  // Update Background Button Active
  document.querySelectorAll('.bg-type-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-bg') === config.backgroundType);
  });

  updateValueBadges();
}

// -----------------------------------------------------------------------------
// Photo Queue Management
// -----------------------------------------------------------------------------
async function handleImportDialog() {
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
            'ARW',
            'CR2',
            'CR3',
            'NEF',
            'RAF',
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
  const formatSelect = document.getElementById('export-format') as HTMLSelectElement;
  const qualitySelect = document.getElementById('export-quality-select') as HTMLSelectElement;

  const format = formatSelect.value;
  const quality = parseInt(qualitySelect.value, 10);
  const ext = format === 'jpeg' ? 'jpg' : format;

  const defaultName = currentPhoto.filename.replace(/\.[^/.]+$/, '') + `_framed.${ext}`;

  try {
    const savePath = await save({
      defaultPath: defaultName,
      filters: [{ name: 'Image', extensions: [ext] }],
    });

    if (!savePath) return;

    showProgressModal('正在导出原画相框照片...', '读取原始完整分辨率像素...', 25);

    // 1. Load FULL original resolution image (Untouched Raw Bytes)
    const fullResDataUrl: string = await invoke('load_full_photo', {
      path: currentPhoto.path,
      orientation: currentPhoto.exif.orientation,
    });

    showProgressModal('正在渲染原画相框...', '生成高分辨率矢量排版...', 60);

    const fullImg = new Image();
    fullImg.src = fullResDataUrl;
    await new Promise((res) => (fullImg.onload = res));

    // 2. Render on full-resolution offscreen canvas
    const exportCanvas = document.createElement('canvas');
    await renderPhotoFrame(fullImg, currentPhoto.exif, config, exportCanvas);

    showProgressModal('正在编码与写入文件...', `分辨率: ${exportCanvas.width} × ${exportCanvas.height}`, 85);

    // Capture lossless PNG buffer from canvas for zero transmission loss
    const base64Data = exportCanvas.toDataURL('image/png');

    await invoke('save_rendered_photo', {
      outputPath: savePath,
      base64Data,
      format,
      quality,
    });

    showToast(`✓ 原画照片已保存 (${exportCanvas.width}×${exportCanvas.height}): ${savePath}`);
  } catch (err) {
    showToast(`导出失败: ${err}`);
  } finally {
    hideProgressModal();
  }
}

async function handleBatchExport() {
  if (photos.length === 0) {
    showToast('列表为空，请先添加照片');
    return;
  }

  try {
    const outputDir = await open({
      directory: true,
      multiple: false,
    });

    if (!outputDir || typeof outputDir !== 'string') return;

    const formatSelect = document.getElementById('export-format') as HTMLSelectElement;
    const qualitySelect = document.getElementById('export-quality-select') as HTMLSelectElement;
    const format = formatSelect.value;
    const quality = parseInt(qualitySelect.value, 10);
    const ext = format === 'jpeg' ? 'jpg' : format;

    showProgressModal('准备批量导出...', `共 ${photos.length} 张照片`, 5);

    const batchTasks = [];

    for (let i = 0; i < photos.length; i++) {
      const item = photos[i];
      showProgressModal(
        '正在渲染原画照片...',
        `(${i + 1}/${photos.length}) ${item.filename}`,
        Math.round(((i + 1) / photos.length) * 70)
      );

      // Load full-resolution image
      const fullResDataUrl: string = await invoke('load_full_photo', {
        path: item.path,
        orientation: item.exif.orientation,
      });

      const fullImg = new Image();
      fullImg.src = fullResDataUrl;
      await new Promise((res) => (fullImg.onload = res));

      const canvas = document.createElement('canvas');
      await renderPhotoFrame(fullImg, item.exif, config, canvas);
      const base64Image = canvas.toDataURL('image/png');

      const outName = item.filename.replace(/\.[^/.]+$/, '') + `_framed.${ext}`;
      const outPath = `${outputDir}/${outName}`;

      batchTasks.push({
        photo_path: item.path,
        output_path: outPath,
        base64_image: base64Image,
        format,
        quality,
      });
    }

    showProgressModal('多线程并行写入磁盘...', 'Rust Rayon 并发保存中...', 85);

    const results: any[] = await invoke('batch_export', { items: batchTasks });
    const successCount = results.filter((r) => r.success).length;

    showToast(`✓ 批量导出完成: 成功 ${successCount} / ${photos.length}`);
  } catch (err) {
    showToast(`批量导出失败: ${err}`);
  } finally {
    hideProgressModal();
  }
}

// -----------------------------------------------------------------------------
// UI Helpers
// -----------------------------------------------------------------------------
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
