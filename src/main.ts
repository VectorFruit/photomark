import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { FrameConfig, PhotoItem, FrameTemplateId } from './types';
import { renderPhotoFrame } from './renderer/canvasRenderer';

// Default State
let photos: PhotoItem[] = [];
let activeIndex = -1;
let currentZoom = 1.0;

const config: FrameConfig = {
  template: 'bottom_bar',
  theme: 'light',
  backgroundColor: '#ffffff',
  fontFamily: 'Inter, -apple-system, sans-serif',
  fontSizeScale: 1.0,
  paddingPercent: 4,
  bottomBarHeightPercent: 12,
  shadowRadius: 10,
  shadowOpacity: 0.25,
  borderRadius: 0,
  showLogo: true,
  selectedLogo: 'auto',
  customNote: '',
  showMake: true,
  showModel: true,
  showLens: true,
  showParams: true,
  showDate: true,
  showCustomNote: false,
  aspectRatio: 'original',
  landscapeMode: false,
};

// DOM Elements
const photoListEl = document.getElementById('photo-list') as HTMLDivElement;
const photoCountEl = document.getElementById('photo-count') as HTMLSpanElement;
const emptyQueueEl = document.getElementById('empty-queue') as HTMLDivElement;
const previewCanvas = document.getElementById('preview-canvas') as HTMLCanvasElement;
const canvasContainer = document.getElementById('canvas-container') as HTMLDivElement;
const zoomLevelEl = document.getElementById('zoom-level') as HTMLSpanElement;
const toastEl = document.getElementById('toast') as HTMLDivElement;

// Cache loaded HTMLImageElements
const loadedImages: Map<string, HTMLImageElement> = new Map();

async function init() {
  bindEvents();
  renderPhotoList();
}

function bindEvents() {
  // Import Buttons
  document.getElementById('btn-import-photos')?.addEventListener('click', handleImportDialog);
  emptyQueueEl?.addEventListener('click', handleImportDialog);

  // Clear All
  document.getElementById('btn-clear-all')?.addEventListener('click', () => {
    photos = [];
    activeIndex = -1;
    loadedImages.clear();
    renderPhotoList();
    clearCanvas();
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

  bindSelect('cfg-theme', (val) => {
    config.theme = val as 'light' | 'dark';
    config.backgroundColor = val === 'dark' ? '#14151a' : '#ffffff';
  });

  bindRange('cfg-padding', (val) => (config.paddingPercent = val));
  bindRange('cfg-font-scale', (val) => (config.fontSizeScale = val / 100));
  bindRange('cfg-border-radius', (val) => (config.borderRadius = val));
  bindRange('cfg-shadow', (val) => {
    config.shadowRadius = val;
    config.shadowOpacity = val > 0 ? 0.25 : 0;
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
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'tiff', 'tif', 'JPG', 'JPEG', 'PNG'],
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
    // In Tauri, webkitRelativePath or path exists
    const p = (files[i] as any).path || files[i].name;
    if (p) paths.push(p);
  }

  if (paths.length > 0) {
    await importPaths(paths);
  }
}

async function importPaths(paths: string[]) {
  try {
    showToast(`正在解析 ${paths.length} 张照片的 EXIF...`);
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
  let img = loadedImages.get(currentPhoto.path);

  if (!img) {
    img = new Image();
    img.src = currentPhoto.thumbnail_data_url || currentPhoto.path;
    await new Promise((res) => (img!.onload = res));
    loadedImages.set(currentPhoto.path, img);
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
// Exporting Operations
// -----------------------------------------------------------------------------
async function handleExportCurrent() {
  if (activeIndex < 0 || activeIndex >= photos.length) {
    showToast('当前没有选中任何照片');
    return;
  }

  const currentPhoto = photos[activeIndex];
  const formatSelect = document.getElementById('export-format') as HTMLSelectElement;
  const qualityRange = document.getElementById('export-quality') as HTMLInputElement;

  const format = formatSelect.value;
  const quality = parseInt(qualityRange.value, 10);
  const ext = format === 'jpeg' ? 'jpg' : format;

  const defaultName = currentPhoto.filename.replace(/\.[^/.]+$/, '') + `_framed.${ext}`;

  try {
    const savePath = await save({
      defaultPath: defaultName,
      filters: [{ name: 'Image', extensions: [ext] }],
    });

    if (!savePath) return;

    showToast('正在导出高分辨率照片...');

    // Render full quality
    const fullImg = new Image();
    fullImg.src = currentPhoto.thumbnail_data_url || currentPhoto.path;
    await new Promise((res) => (fullImg.onload = res));

    const exportCanvas = document.createElement('canvas');
    await renderPhotoFrame(fullImg, currentPhoto.exif, config, exportCanvas);

    const mime = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
    const base64Data = exportCanvas.toDataURL(mime, quality / 100);

    await invoke('save_rendered_photo', {
      outputPath: savePath,
      base64Data,
      format,
      quality,
    });

    showToast(`✓ 已成功保存到: ${savePath}`);
  } catch (err) {
    showToast(`导出失败: ${err}`);
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
    const qualityRange = document.getElementById('export-quality') as HTMLInputElement;
    const format = formatSelect.value;
    const quality = parseInt(qualityRange.value, 10);
    const ext = format === 'jpeg' ? 'jpg' : format;
    const mime = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';

    showToast(`开始批量处理 ${photos.length} 张照片...`);

    const batchTasks = [];

    for (let i = 0; i < photos.length; i++) {
      const item = photos[i];
      let img = loadedImages.get(item.path);
      if (!img) {
        img = new Image();
        img.src = item.thumbnail_data_url || item.path;
        await new Promise((res) => (img!.onload = res));
      }

      const canvas = document.createElement('canvas');
      await renderPhotoFrame(img, item.exif, config, canvas);
      const base64Image = canvas.toDataURL(mime, quality / 100);

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

    const results: any[] = await invoke('batch_export', { items: batchTasks });
    const successCount = results.filter((r) => r.success).length;

    showToast(`✓ 批量导出完成: 成功 ${successCount} / ${photos.length}`);
  } catch (err) {
    showToast(`批量导出失败: ${err}`);
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

function bindRange(id: string, setter: (val: number) => void) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  el?.addEventListener('input', () => {
    setter(parseInt(el.value, 10));
    triggerReRender();
  });
}

// Start
window.addEventListener('DOMContentLoaded', init);
