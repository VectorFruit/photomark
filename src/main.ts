import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  BackgroundType,
  DEFAULT_FRAME_CONFIG,
  ExifData,
  FrameConfig,
  FrameTemplateId,
  ParseProgressEvent,
  PhotoItem,
  thumbnailSrc,
} from './types';
import { renderPhotoFrame } from './renderer/canvasRenderer';
import { applyLanguage, getStoredLang, setStoredLang, translateText } from './i18n';

// Application State
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

let photos: PhotoItem[] = [];
let activeIndex = -1;
let currentZoom = 1.0;
let panX = 0;
let panY = 0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let isComparing = false;
let dragFromIndex = -1;
let currentTheme: 'dark' | 'light' | 'system' = (localStorage.getItem('photomark_theme') as 'dark' | 'light' | 'system') || 'system';

// Immersive-light preferences (HarmonyOS 沉浸光感): intensity tier, accent
// palette, and whether the ambient light field follows the photo's colors.
type FxIntensity = 'strong' | 'balanced' | 'weak';
const PALETTES = ['amber', 'sunset', 'celadon', 'peakblue', 'crimson'];
let currentPalette = localStorage.getItem('photomark_palette') || 'amber';
let currentFx: FxIntensity = (localStorage.getItem('photomark_fx') as FxIntensity) || 'balanced';
let photoLightEnabled = localStorage.getItem('photomark_photo_light') !== '0';
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
let confirmAction: (() => void) | null = null;

// DOM Elements
const photoListEl = document.getElementById('photo-list') as HTMLDivElement;
const photoCountEl = document.getElementById('photo-count') as HTMLSpanElement;
const emptyQueueEl = document.getElementById('empty-queue') as HTMLDivElement;
const previewCanvas = document.getElementById('preview-canvas') as HTMLCanvasElement;
const canvasContainer = document.getElementById('canvas-container') as HTMLDivElement;
const viewportEl = document.getElementById('viewport-area') as HTMLDivElement | null;
const compareBtn = document.getElementById('btn-compare-original') as HTMLButtonElement | null;
const zoomLevelEl = document.getElementById('zoom-level') as HTMLSpanElement;
const toastEl = document.getElementById('toast') as HTMLDivElement;
const fileInputEl = document.getElementById('file-input') as HTMLInputElement;
const pointerGlowEl = document.getElementById('pointer-glow') as HTMLDivElement | null;
const confirmModalEl = document.getElementById('confirm-modal') as HTMLDivElement;
const confirmTitleEl = document.getElementById('confirm-title') as HTMLDivElement;
const confirmMessageEl = document.getElementById('confirm-message') as HTMLParagraphElement;
const confirmOkBtn = document.getElementById('btn-confirm-ok') as HTMLButtonElement;
const confirmCancelBtn = document.getElementById('btn-confirm-cancel') as HTMLButtonElement;

// UI Scale DOM
const selectUiScale = document.getElementById('select-ui-scale') as HTMLSelectElement;
const btnUiScaleDown = document.getElementById('btn-ui-scale-down') as HTMLButtonElement;
const btnUiScaleUp = document.getElementById('btn-ui-scale-up') as HTMLButtonElement;

// Theme Toggle DOM (segmented control)
const themeOptionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.theme-option'));

// Language DOM
const selectLanguageEl = document.getElementById('select-language') as HTMLSelectElement | null;

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
const valBarHeightEl = document.getElementById('val-bar-height') as HTMLSpanElement;
const valVerticalOffsetEl = document.getElementById('val-vertical-offset') as HTMLSpanElement;
const valFontScaleEl = document.getElementById('val-font-scale') as HTMLSpanElement;
const valFontWeightEl = document.getElementById('val-font-weight') as HTMLSpanElement;
const valSecondaryFontWeightEl = document.getElementById('val-secondary-font-weight') as HTMLSpanElement;
const valBorderRadiusEl = document.getElementById('val-border-radius') as HTMLSpanElement;
const valShadowEl = document.getElementById('val-shadow') as HTMLSpanElement;

const inputPadding = document.getElementById('cfg-padding') as HTMLInputElement;
const inputBarHeight = document.getElementById('cfg-bar-height') as HTMLInputElement;
const inputVerticalOffset = document.getElementById('cfg-vertical-offset') as HTMLInputElement;
const inputFontScale = document.getElementById('cfg-font-scale') as HTMLInputElement;
const inputFontWeight = document.getElementById('cfg-font-weight') as HTMLInputElement;
const inputSecondaryFontWeight = document.getElementById('cfg-secondary-font-weight') as HTMLInputElement;
const inputBorderRadius = document.getElementById('cfg-border-radius') as HTMLInputElement;
const inputShadow = document.getElementById('cfg-shadow') as HTMLInputElement;
const inputBlurIntensity = document.getElementById('cfg-blur-intensity') as HTMLInputElement;

// Image Cache (for fast preview)
const previewImageCache: Map<string, HTMLImageElement> = new Map();

async function init() {
  applyTheme(currentTheme);
  applyPalette(currentPalette);
  applyFxIntensity(currentFx);
  applyUiScale(currentUiScale);
  bindPointerGlow();
  bindLightFieldControls();
  bindUsabilityHelpers();
  loadPersistedState();
  bindEvents();
  setupProgressListeners();
  syncUIWithConfig();
  syncExportSettingsUI();
  updateValueBadges();
  if (selectLanguageEl) selectLanguageEl.value = getStoredLang();
  applyLanguage();
  renderPhotoList();
  clearCanvas();
  bindPresetControls();
  bindSidebarCollapse();
  if (isTauri) {
    void loadSystemFontsIntoSelect();
    void restoreLastSession();
  }
}

/* ---- Frame presets: built-in looks + user-saved configurations ---- */
const PRESETS_KEY = 'photomark_presets';
const BUILT_IN_PRESETS: { name: string; config: Partial<FrameConfig> }[] = [
  { name: '经典白', config: {} },
  {
    name: '深色画廊',
    config: { template: 'border', backgroundType: 'dark', paddingPercent: 5, bottomBarHeightPercent: 12 },
  },
  {
    name: '毛玻璃底栏',
    config: { template: 'bottom_bar', backgroundType: 'frosted_blur', blurIntensity: 60 },
  },
  {
    name: '拍立得',
    config: { template: 'polaroid', backgroundType: 'white' },
  },
];

function getCustomPresets(): { name: string; config: FrameConfig }[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch {
    return [];
  }
}

function saveCustomPresets(list: { name: string; config: FrameConfig }[]) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
  } catch {
    // ignore quota errors
  }
}

function applyPreset(presetConfig: Partial<FrameConfig>, name: string) {
  Object.assign(config, JSON.parse(JSON.stringify(DEFAULT_FRAME_CONFIG)), JSON.parse(JSON.stringify(presetConfig)));
  syncUIWithConfig();
  triggerReRender();
  showToast(`已应用预设「${name}」`, 'success');
}

function renderPresets() {
  const grid = document.getElementById('preset-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const makeChip = (label: string, onClick: () => void, deletable = false) => {
    const chip = document.createElement('div');
    chip.className = 'preset-chip';
    const text = document.createElement('span');
    text.textContent = translateText(label);
    text.addEventListener('click', onClick);
    chip.appendChild(text);
    if (deletable) {
      const del = document.createElement('button');
      del.className = 'preset-delete';
      del.textContent = '×';
      del.title = translateText('删除此预设');
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        onClickDelete(label);
      });
      chip.appendChild(del);
    }
    grid.appendChild(chip);
  };

  const onClickDelete = (name: string) => {
    const rest = getCustomPresets().filter((p) => p.name !== name);
    saveCustomPresets(rest);
    renderPresets();
    showToast(`已删除预设「${name}」`, 'info');
  };

  for (const p of BUILT_IN_PRESETS) {
    makeChip(p.name, () => applyPreset(p.config, p.name));
  }
  for (const p of getCustomPresets()) {
    makeChip(p.name, () => applyPreset(p.config, p.name), true);
  }
}

function bindPresetControls() {
  const row = document.getElementById('preset-save-row');
  const input = document.getElementById('preset-name-input') as HTMLInputElement | null;
  const showRow = (show: boolean) => {
    if (row) row.style.display = show ? 'flex' : 'none';
    if (show && input) input.focus();
  };

  document.getElementById('btn-preset-save')?.addEventListener('click', () => {
    showRow(true);
  });
  document.getElementById('btn-preset-save-cancel')?.addEventListener('click', () => showRow(false));
  const confirmSave = () => {
    const name = (input?.value || '').trim() || `预设 ${getCustomPresets().length + 1}`;
    const list = getCustomPresets();
    list.push({ name, config: JSON.parse(JSON.stringify(config)) });
    if (list.length > 12) {
      list.shift();
      showToast('预设已达上限，最早的预设已被移除', 'info');
    }
    saveCustomPresets(list);
    renderPresets();
    showRow(false);
    if (input) input.value = '';
    showToast(`已保存预设「${name}」`, 'success');
  };
  document.getElementById('btn-preset-save-confirm')?.addEventListener('click', confirmSave);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmSave();
    if (e.key === 'Escape') showRow(false);
  });
  renderPresets();
}

/* ---- Session restore (Tauri only): remember the last photo list ---- */
const SESSION_KEY = 'photomark_last_session';

function persistSession() {
  if (!isTauri) return;
  try {
    const paths = photos.map((p) => p.path).filter((p) => !p.startsWith('browser://'));
    localStorage.setItem(SESSION_KEY, JSON.stringify({ paths, activeIndex }));
  } catch {
    // ignore quota errors
  }
}

async function restoreLastSession() {
  if (!isTauri) return;
  let saved: { paths?: string[]; activeIndex?: number } | null = null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    return;
  }
  const paths = saved?.paths;
  if (!Array.isArray(paths) || paths.length === 0) return;

  try {
    showProgressModal('正在恢复上次会话...', `共 ${paths.length} 张照片`, 5);
    const items: PhotoItem[] = await invoke('load_photos', { paths });
    if (items.length > 0) {
      photos.push(...items);
      const savedIdx = Math.max(0, Math.min(items.length - 1, saved?.activeIndex ?? 0));
      activeIndex = savedIdx;
      renderPhotoList();
      triggerReRender();
    }
  } catch {
    // restore is best-effort; start empty on failure
  } finally {
    hideProgressModal();
  }
}
/* ---- System font enumeration (Tauri only) ----
   Fills the font picker with the families actually installed on this machine.
   Invalid persisted values fall back to the default once the list arrives. */
const EMBEDDED_FONTS = ['Noto Sans SC', 'Noto Serif SC', 'Brass Mono'];

async function loadSystemFontsIntoSelect() {
  const select = document.getElementById('cfg-font-family') as HTMLSelectElement | null;
  if (!select) return;
  try {
    const families = await invoke<string[]>('list_system_fonts');
    const usable = families.filter((f) => f && !EMBEDDED_FONTS.includes(f));
    if (usable.length === 0) return;

    const group = document.createElement('optgroup');
    group.label = '系统字体';
    for (const family of usable) {
      const opt = document.createElement('option');
      opt.value = family;
      opt.textContent = family;
      group.appendChild(opt);
    }
    select.appendChild(group);

    // A persisted font that exists on neither list falls back to the default.
    if (
      !EMBEDDED_FONTS.includes(config.fontFamily) &&
      !usable.includes(config.fontFamily)
    ) {
      config.fontFamily = DEFAULT_FRAME_CONFIG.fontFamily;
      syncUIWithConfig();
      triggerReRender();
    }
  } catch {
    // Enumeration unavailable: keep the embedded fonts only
  }
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

function resolveTheme(theme: 'dark' | 'light' | 'system'): 'dark' | 'light' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return theme;
}

function applyTheme(theme: 'dark' | 'light' | 'system') {
  currentTheme = theme;
  const resolved = resolveTheme(theme);
  document.documentElement.setAttribute('data-theme', resolved);
  localStorage.setItem('photomark_theme', theme);
  updateThemeToggleUI();
}

function applyPalette(palette: string) {
  currentPalette = PALETTES.includes(palette) ? palette : 'amber';
  document.documentElement.dataset.palette = currentPalette;
  localStorage.setItem('photomark_palette', currentPalette);
  document.querySelectorAll('.swatch').forEach((s) => {
    s.classList.toggle('active', s.getAttribute('data-palette') === currentPalette);
  });
}

function applyFxIntensity(level: FxIntensity) {
  currentFx = ['strong', 'balanced', 'weak'].includes(level) ? level : 'balanced';
  document.body.classList.toggle('fx-strong', currentFx === 'strong');
  document.body.classList.toggle('fx-balanced', currentFx === 'balanced');
  document.body.classList.toggle('fx-weak', currentFx === 'weak');
  localStorage.setItem('photomark_fx', currentFx);
  document.querySelectorAll('.fx-btn').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-fx') === currentFx);
  });
}

function applyPhotoLight(on: boolean) {
  photoLightEnabled = on;
  document.body.classList.toggle('photo-light', on && !isNoPhoto());
  localStorage.setItem('photomark_photo_light', on ? '1' : '0');
  const cb = document.getElementById('cfg-photo-light') as HTMLInputElement | null;
  if (cb) cb.checked = on;
}

function isNoPhoto(): boolean {
  return activeIndex < 0 || activeIndex >= photos.length;
}

/* ---- Photo-reactive light field ----
   Extract a vibrant dominant color from the preview thumbnail (8×8 downsample,
   saturation-weighted average) and drive the ambient orbs / edge flows / photo
   bloom via CSS variables. Runs once per photo (cached by path). */
const photoColorCache = new Map<string, [number, number, number]>();

function extractPhotoDominantColor(img: HTMLImageElement, key: string): [number, number, number] {
  const cached = photoColorCache.get(key);
  if (cached) return cached;
  let result: [number, number, number] = [212, 162, 76];
  try {
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 8;
    const cx = c.getContext('2d', { willReadFrequently: true });
    if (cx) {
      cx.drawImage(img, 0, 0, 8, 8);
      const d = cx.getImageData(0, 0, 8, 8).data;
      const vibrant: [number, number, number, number][] = [];
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        sr += r;
        sg += g;
        sb += b;
        n++;
        const sat = Math.max(r, g, b) - Math.min(r, g, b);
        vibrant.push([r, g, b, sat]);
      }
      vibrant.sort((a, b) => b[3] - a[3]);
      const half = Math.max(1, Math.floor(vibrant.length / 2));
      let vr = 0;
      let vg = 0;
      let vb = 0;
      for (let i = 0; i < half; i++) {
        vr += vibrant[i][0];
        vg += vibrant[i][1];
        vb += vibrant[i][2];
      }
      vr = Math.round(vr / half) || 1;
      vg = Math.round(vg / half) || 1;
      vb = Math.round(vb / half) || 1;
      // Keep the tint in a pleasant luminance band (avoid near-black/white)
      const scaleIn = (v: number) => Math.round(v + (150 - v) * 0.35);
      const ar = Math.min(240, Math.max(70, scaleIn(vr)));
      const ag = Math.min(240, Math.max(70, scaleIn(vg)));
      const ab = Math.min(240, Math.max(70, scaleIn(vb)));
      // Secondary tone: the photo's global average, softly lightened —
      // pairs with the vibrant dominant without clashing.
      const avg = (v: number) => Math.round(v / n);
      const br = Math.min(235, Math.max(80, avg(sr) + 26));
      const bg2 = Math.min(235, Math.max(80, avg(sg) + 26));
      const bb = Math.min(235, Math.max(80, avg(sb) + 26));
      result = [ar, ag, ab];
      const rootStyle = document.documentElement.style;
      rootStyle.setProperty('--photo-orb-a', `rgba(${ar}, ${ag}, ${ab}, 0.58)`);
      rootStyle.setProperty('--photo-orb-b', `rgba(${Math.round(br / 2 + 96)}, ${Math.round(bg2 / 2 + 96)}, ${Math.round(bb / 2 + 96)}, 0.40)`);
      rootStyle.setProperty('--photo-orb-c', `rgba(${ar}, ${ag}, ${ab}, 0.24)`);
      rootStyle.setProperty('--photo-glow-rgb', `${ar} ${ag} ${ab}`);
    }
  } catch {
    // Cross-origin or decode issues: keep the palette default light field
  }
  photoColorCache.set(key, result);
  if (photoColorCache.size > 24) {
    photoColorCache.delete(photoColorCache.keys().next().value as string);
  }
  return result;
}

/* ---- Pause the light field when hidden / unfocused ---- */
function setLightFieldPaused(paused: boolean) {
  document.body.classList.toggle('fx-paused', paused);
}

function updateThemeToggleUI() {
  themeOptionButtons.forEach((btn) => {
    const option = btn.getAttribute('data-theme-option');
    const active = option === currentTheme;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', active ? 'true' : 'false');
  });
}

// -----------------------------------------------------------------------------
// Immersive pointer glow (HarmonyOS-style light follows the cursor)
// -----------------------------------------------------------------------------
let pointerGlowRaf = 0;

function bindPointerGlow() {
  window.addEventListener('pointermove', (e) => {
    if (pointerGlowRaf) return;
    pointerGlowRaf = requestAnimationFrame(() => {
      pointerGlowRaf = 0;
      if (pointerGlowEl) {
        pointerGlowEl.style.setProperty('--pointer-x', String(e.clientX) + 'px');
        pointerGlowEl.style.setProperty('--pointer-y', String(e.clientY) + 'px');
        document.body.classList.add('has-pointer');
      }
    });
  });

  window.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget) document.body.classList.remove('has-pointer');
  });
}

// -----------------------------------------------------------------------------
// Immersive-light controls: intensity tier, accent palette, photo-follow
// -----------------------------------------------------------------------------
function bindLightFieldControls() {
  document.querySelectorAll('.fx-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyFxIntensity((btn.getAttribute('data-fx') || 'balanced') as FxIntensity));
  });

  document.querySelectorAll('.swatch').forEach((sw) => {
    sw.addEventListener('click', () => applyPalette(sw.getAttribute('data-palette') || 'amber'));
  });

  bindCheckbox('cfg-photo-light', (val) => applyPhotoLight(val));
  const cb = document.getElementById('cfg-photo-light') as HTMLInputElement | null;
  if (cb) cb.checked = photoLightEnabled;

  // Pause the whole light field while hidden or unfocused — zero idle GPU.
  document.addEventListener('visibilitychange', () => setLightFieldPaused(document.hidden));
  window.addEventListener('blur', () => setLightFieldPaused(true));
  window.addEventListener('focus', () => setLightFieldPaused(false));
}

// -----------------------------------------------------------------------------
// Usability: keyboard shortcuts, wheel zoom, drag-over highlight, shortcuts card
// -----------------------------------------------------------------------------
let dragDepth = 0;

function bindUsabilityHelpers() {
  const shortcutsModal = document.getElementById('shortcuts-modal');

  function toggleShortcuts(show?: boolean) {
    if (!shortcutsModal) return;
    const visible = shortcutsModal.style.display === 'flex';
    shortcutsModal.style.display = (show === undefined ? !visible : show) ? 'flex' : 'none';
  }

  document.getElementById('btn-shortcuts')?.addEventListener('click', () => toggleShortcuts(true));
  document.getElementById('btn-shortcuts-close')?.addEventListener('click', () => toggleShortcuts(false));
  shortcutsModal?.addEventListener('click', (e) => {
    if (e.target === shortcutsModal) toggleShortcuts(false);
  });

  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;

    // Close the shortcuts card first so Esc/? behave locally
    if (e.key === 'Escape' && shortcutsModal?.style.display === 'flex') {
      toggleShortcuts(false);
      return;
    }
    if (e.key === '?') {
      toggleShortcuts();
      return;
    }

    if (isNoPhoto() && !['+', '=', '-', '_'].includes(e.key)) return;

    switch (e.key) {
      case 'ArrowLeft':
        switchPhoto(-1);
        break;
      case 'ArrowRight':
        switchPhoto(1);
        break;
      case ' ':
        if (!e.repeat) {
          isComparing = true;
          drawOriginalPreview();
        }
        e.preventDefault();
        break;
      case 'f':
      case 'F':
        setZoom(1.0);
        break;
      case '+':
      case '=':
        setZoom(currentZoom + 0.15);
        break;
      case '-':
      case '_':
        setZoom(Math.max(0.2, currentZoom - 0.15));
        break;
      case 'e':
      case 'E':
        handleExportCurrent();
        break;
      case 'Delete':
      case 'Backspace':
        removePhoto(activeIndex);
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === ' ' && isComparing) {
      isComparing = false;
      triggerReRender();
    }
  });

  // Wheel zoom around the cursor
  viewportEl?.addEventListener(
    'wheel',
    (e) => {
      if (isNoPhoto()) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newZoom = Math.min(5, Math.max(0.2, currentZoom * factor));
      if (newZoom === currentZoom) return;
      const rect = viewportEl.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const ux = (cx - panX) / currentZoom;
      const uy = (cy - panY) / currentZoom;
      currentZoom = newZoom;
      if (newZoom <= 1.01) {
        panX = 0;
        panY = 0;
      } else {
        panX = cx - ux * newZoom;
        panY = cy - uy * newZoom;
      }
      applyCanvasTransform();
      if (zoomLevelEl) zoomLevelEl.textContent = Math.round(currentZoom * 100) + '%';
    },
    { passive: false }
  );

  // Drag-over highlight on the whole stage
  window.addEventListener('dragenter', (e) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      dragDepth++;
      document.body.classList.add('import-dragover');
    }
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) document.body.classList.remove('import-dragover');
  });
  window.addEventListener('drop', () => {
    dragDepth = 0;
    document.body.classList.remove('import-dragover');
  });
}

function switchPhoto(dir: number) {
  if (photos.length === 0) return;
  const next = (activeIndex + dir + photos.length) % photos.length;
  if (next === activeIndex) return;
  activeIndex = next;
  renderPhotoList();
  triggerReRender();
  persistSession();
}

/* ---- Sidebar collapse: give the photo the full stage when needed ---- */
const SIDEBAR_STATE_KEY = 'photomark_sidebar_collapsed';

function applySidebarCollapse(left: boolean, right: boolean) {
  const workspace = document.querySelector('.workspace');
  if (!workspace) return;
  workspace.classList.toggle('collapse-left', left);
  workspace.classList.toggle('collapse-right', right);
  const restoreLeft = document.getElementById('btn-restore-left');
  const restoreRight = document.getElementById('btn-restore-right');
  if (restoreLeft) restoreLeft.style.display = left ? 'flex' : 'none';
  if (restoreRight) restoreRight.style.display = right ? 'flex' : 'none';
}

function bindSidebarCollapse() {
  let state: { left: boolean; right: boolean } = { left: false, right: false };
  try {
    const raw = localStorage.getItem(SIDEBAR_STATE_KEY);
    if (raw) state = { left: false, right: false, ...JSON.parse(raw) };
  } catch {
    // defaults
  }
  applySidebarCollapse(state.left, state.right);

  const toggle = (side: 'left' | 'right') => {
    state[side] = !state[side];
    applySidebarCollapse(state.left, state.right);
    try {
      localStorage.setItem(SIDEBAR_STATE_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
    applyPreviewFit();
  };

  document.getElementById('btn-collapse-left')?.addEventListener('click', () => toggle('left'));
  document.getElementById('btn-collapse-right')?.addEventListener('click', () => toggle('right'));
  document.getElementById('btn-restore-left')?.addEventListener('click', () => toggle('left'));
  document.getElementById('btn-restore-right')?.addEventListener('click', () => toggle('right'));

  document.getElementById('btn-prev-photo')?.addEventListener('click', () => switchPhoto(-1));
  document.getElementById('btn-next-photo')?.addEventListener('click', () => switchPhoto(1));
}

function removePhoto(index: number) {
  if (index < 0 || index >= photos.length) return;
  const removed = photos.splice(index, 1)[0];
  previewImageCache.delete(removed.path);
  if (activeIndex >= photos.length) activeIndex = photos.length - 1;
  renderPhotoList();
  triggerReRender();
  persistSession();
  showToast(`已移除 ${removed.filename}`, 'info');
}

// -----------------------------------------------------------------------------
// Dangerous action confirmation modal
// -----------------------------------------------------------------------------
function openConfirm(options: {
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  confirmAction = options.onConfirm;
  confirmTitleEl.textContent = translateText('确认操作');
  confirmMessageEl.textContent = translateText(options.message);
  confirmOkBtn.textContent = translateText(options.confirmLabel || '确认');
  confirmOkBtn.className = 'btn ' + (options.danger === false ? 'btn-primary' : 'btn-danger');
  confirmModalEl.style.display = 'flex';
  confirmCancelBtn?.focus();
}

function closeConfirm() {
  confirmModalEl.style.display = 'none';
  confirmAction = null;
}

function loadPersistedState() {
  try {
    const savedConfig = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (savedConfig) {
      const parsed = JSON.parse(savedConfig);
      if (parsed && typeof parsed === 'object') {
        Object.assign(config, { ...DEFAULT_FRAME_CONFIG, ...parsed });
      }
      // Fonts: embedded faces are always valid; system font names (from the
      // Tauri font enumeration) are kept as-is and validated once the list arrives.
      if (!config.fontFamily || typeof config.fontFamily !== 'string') {
        config.fontFamily = DEFAULT_FRAME_CONFIG.fontFamily;
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
        if (typeof parsed.quality === 'number' && parsed.quality >= 0 && parsed.quality <= 100) {
          exportSettings.quality = Math.round(parsed.quality);
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
  const qualitySlider = document.getElementById('export-quality') as HTMLInputElement | null;
  const templateEl = document.getElementById('export-filename-template') as HTMLInputElement | null;
  if (formatEl) formatEl.value = exportSettings.format;
  if (qualitySlider) qualitySlider.value = String(exportSettings.quality);
  updateExportQualityBadge();
  if (templateEl) templateEl.value = exportSettings.filenameTemplate;
}

function updateExportQualityBadge() {
  const input = document.getElementById('export-quality-val') as HTMLInputElement | null;
  if (input) input.value = String(exportSettings.quality);
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
  progressTitleEl.textContent = translateText(title);
  progressStatusEl.textContent = translateText(status);
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
  if (valBarHeightEl) valBarHeightEl.textContent = `${config.bottomBarHeightPercent}%`;
  if (valVerticalOffsetEl) {
    const offset = config.contentVerticalOffset || 0;
    valVerticalOffsetEl.textContent = offset === 0 ? translateText('居中') : offset > 0 ? `+${offset}` : `${offset}`;
  }
  if (valFontScaleEl) valFontScaleEl.textContent = `${Math.round(config.fontSizeScale * 100)}%`;
  if (valFontWeightEl) valFontWeightEl.textContent = `${config.fontWeight}`;
  if (valSecondaryFontWeightEl) valSecondaryFontWeightEl.textContent = `${config.secondaryFontWeight}`;
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

  // Theme Mode Segmented Control (Light / Dark / System)
  themeOptionButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const option = btn.getAttribute('data-theme-option');
      if (option === 'light' || option === 'dark' || option === 'system') {
        applyTheme(option);
      }
    });
  });

  // Follow OS theme changes while in system mode
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (currentTheme === 'system') applyTheme('system');
  });

  // Language Switcher — re-translate the DOM, refresh dynamic badges/list and
  // re-render the canvas (watermark text follows the interface language).
  selectLanguageEl?.addEventListener('change', () => {
    setStoredLang(selectLanguageEl.value as 'zh' | 'en');
    applyLanguage();
    updateValueBadges();
    renderPhotoList();
    triggerReRender();
  });

  // Dangerous Action Confirmation Modal
  confirmOkBtn?.addEventListener('click', () => {
    const action = confirmAction;
    closeConfirm();
    action?.();
  });
  confirmCancelBtn?.addEventListener('click', closeConfirm);
  confirmModalEl?.addEventListener('click', (e) => {
    if (e.target === confirmModalEl) closeConfirm();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && confirmModalEl?.style.display === 'flex') closeConfirm();
  });

  // Collapsible Inspector Groups
  document.querySelectorAll('.settings-group .group-title').forEach((title) => {
    title.addEventListener('click', () => {
      const group = (title as HTMLElement).closest('.settings-group');
      group?.classList.toggle('collapsed');
    });
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

  // Clear All Photos (with confirmation)
  document.getElementById('btn-clear-all')?.addEventListener('click', () => {
    if (photos.length === 0) return;
    openConfirm({
      message: '确定要清空照片列表吗？此操作不可撤销。',
      confirmLabel: '清空',
      danger: true,
      onConfirm: () => {
        photos = [];
        activeIndex = -1;
        previewImageCache.clear();
        renderPhotoList();
        clearCanvas();
        persistSession();
        showToast('已清空照片列表', 'info');
      },
    });
  });

  // Global Reset All Config Button (with confirmation)
  document.getElementById('btn-reset-all')?.addEventListener('click', () => {
    openConfirm({
      message: '确定要恢复所有参数为默认配置吗？',
      confirmLabel: '重置',
      danger: false,
      onConfirm: () => {
        Object.assign(config, DEFAULT_FRAME_CONFIG);
        syncUIWithConfig();
        triggerReRender();
        showToast('已重置所有参数为默认配置', 'info');
      },
    });
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
        case 'bar-height':
          config.bottomBarHeightPercent = DEFAULT_FRAME_CONFIG.bottomBarHeightPercent;
          inputBarHeight.value = `${config.bottomBarHeightPercent}`;
          break;
        case 'vertical-offset':
          config.contentVerticalOffset = DEFAULT_FRAME_CONFIG.contentVerticalOffset;
          inputVerticalOffset.value = `${config.contentVerticalOffset}`;
          break;
        case 'font-scale':
          config.fontSizeScale = DEFAULT_FRAME_CONFIG.fontSizeScale;
          inputFontScale.value = `${Math.round(config.fontSizeScale * 100)}`;
          break;
        case 'font-weight':
          config.fontWeight = DEFAULT_FRAME_CONFIG.fontWeight;
          inputFontWeight.value = `${config.fontWeight}`;
          break;
        case 'secondary-font-weight':
          config.secondaryFontWeight = DEFAULT_FRAME_CONFIG.secondaryFontWeight;
          inputSecondaryFontWeight.value = `${config.secondaryFontWeight}`;
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
      updateTemplateSpecificRows();
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
  bindSelect('cfg-font-family', (val) => (config.fontFamily = val));
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

  inputBarHeight?.addEventListener('input', () => {
    config.bottomBarHeightPercent = parseInt(inputBarHeight.value, 10);
    updateValueBadges();
    triggerReRender();
  });

  inputVerticalOffset?.addEventListener('input', () => {
    config.contentVerticalOffset = parseInt(inputVerticalOffset.value, 10);
    updateValueBadges();
    triggerReRender();
  });

  inputFontScale?.addEventListener('input', () => {
    config.fontSizeScale = parseInt(inputFontScale.value, 10) / 100;
    updateValueBadges();
    triggerReRender();
  });

  inputFontWeight?.addEventListener('input', () => {
    config.fontWeight = parseInt(inputFontWeight.value, 10);
    updateValueBadges();
    triggerReRender();
  });

  inputSecondaryFontWeight?.addEventListener('input', () => {
    config.secondaryFontWeight = parseInt(inputSecondaryFontWeight.value, 10);
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

  // Original / Result Compare
  compareBtn?.addEventListener('mousedown', () => {
    isComparing = true;
    drawOriginalPreview();
  });
  compareBtn?.addEventListener('mouseup', () => {
    if (isComparing) {
      isComparing = false;
      triggerReRender();
    }
  });
  compareBtn?.addEventListener('mouseleave', () => {
    if (isComparing) {
      isComparing = false;
      triggerReRender();
    }
  });

  // Pan when zoomed in
  viewportEl?.addEventListener('pointerdown', (e) => {
    if (currentZoom <= 1.01) return;
    isPanning = true;
    panStartX = e.clientX - panX;
    panStartY = e.clientY - panY;
    viewportEl.style.cursor = 'grabbing';
  });
  window.addEventListener('resize', applyPreviewFit);
  viewportEl?.addEventListener('pointermove', (e) => {
    if (!isPanning) return;
    panX = e.clientX - panStartX;
    panY = e.clientY - panStartY;
    applyCanvasTransform();
  });
  window.addEventListener('pointerup', () => {
    if (isPanning) {
      isPanning = false;
      if (viewportEl) viewportEl.style.cursor = '';
    }
  });

  // Export Buttons
  document.getElementById('btn-export-current')?.addEventListener('click', handleExportCurrent);
  document.getElementById('btn-batch-export')?.addEventListener('click', handleBatchExport);

  // Export Settings Persistence
  const exportFormatEl = document.getElementById('export-format') as HTMLSelectElement | null;
  const exportQualitySlider = document.getElementById('export-quality') as HTMLInputElement | null;
  const exportQualityNum = document.getElementById('export-quality-val') as HTMLInputElement | null;
  const exportTemplateEl = document.getElementById('export-filename-template') as HTMLInputElement | null;
  exportFormatEl?.addEventListener('change', () => {
    exportSettings.format = exportFormatEl.value as ExportSettings['format'];
    persistExportSettings();
  });
  exportQualitySlider?.addEventListener('input', () => {
    exportSettings.quality = parseInt(exportQualitySlider.value, 10);
    updateExportQualityBadge();
    persistExportSettings();
  });
  exportQualityNum?.addEventListener('input', () => {
    const v = parseInt(exportQualityNum.value, 10);
    if (Number.isNaN(v)) return;
    const clamped = Math.max(0, Math.min(100, v));
    exportSettings.quality = clamped;
    if (exportQualitySlider) exportQualitySlider.value = String(clamped);
    persistExportSettings();
  });
  exportQualityNum?.addEventListener('blur', updateExportQualityBadge);
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
    if (progressCancelBtn) progressCancelBtn.textContent = translateText('正在取消...');
  });

  // Drag & Drop
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', handleFileDrop);
}

/**
 * Template-scoped controls: options that only affect specific templates are
 * hidden unless a template that uses them is selected.
 */
function updateTemplateSpecificRows() {
  const t = config.template;
  const show = (id: string, cond: boolean) => {
    const el = document.getElementById(id) as HTMLElement | null;
    if (el) el.style.display = cond ? 'block' : 'none';
  };
  show('block-padding', t === 'bottom_bar' || t === 'border');
  show('block-bar-height', t === 'bottom_bar');
  show('block-border-radius', t !== 'minimal_badge');
  show('block-shadow', t === 'bottom_bar' || t === 'border');
}

function syncUIWithConfig() {
  inputPadding.value = `${config.paddingPercent}`;
  inputBarHeight.value = `${config.bottomBarHeightPercent}`;
  inputVerticalOffset.value = `${config.contentVerticalOffset || 0}`;
  inputFontScale.value = `${Math.round(config.fontSizeScale * 100)}`;
  inputFontWeight.value = `${config.fontWeight}`;
  inputSecondaryFontWeight.value = `${config.secondaryFontWeight}`;
  inputBorderRadius.value = `${config.borderRadius}`;
  inputShadow.value = `${config.shadowRadius}`;
  inputBlurIntensity.value = `${config.blurIntensity}`;

  // Update Focal Length Mode Select
  const focalSelect = document.getElementById('cfg-focal-mode') as HTMLSelectElement | null;
  if (focalSelect) focalSelect.value = config.focalLengthMode || 'physical';

  // Update Font Family Input
  const fontFamilySelect = document.getElementById('cfg-font-family') as HTMLSelectElement | null;
  if (fontFamilySelect) fontFamilySelect.value = config.fontFamily || 'Noto Sans SC';

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

  updateTemplateSpecificRows();

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
    showToast(`导入失败: ${err}`, 'error');
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
      persistSession();
      showToast(`成功导入 ${newItems.length} 张照片`, 'success');
    }
  } catch (err) {
    showToast(`解析失败: ${err}`, 'error');
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
    showToast('没有可导入的图片文件', 'info');
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
      persistSession();
      showToast(`成功导入 ${newItems.length} 张照片`, 'success');
    }
  } catch (err) {
    showToast(`导入失败: ${err}`, 'error');
  } finally {
    hideProgressModal();
  }
}

// Helper: resolve generic lens specs back to official lens names.
// The database is generated from ExifTool lens ID tables (Nikon, Canon, Sony,
// Sigma, Pentax, Olympus, Panasonic, Minolta, Samsung) and is keyed by the
// normalized focal-length/aperture spec plus camera maker. The 122KB database
// is dynamically imported (browser-mode EXIF path only) to keep the startup
// chunk lean.
interface LensDbEntry { make: string; spec: string; name: string; }
let lensDbMapPromise: Promise<Map<string, string>> | null = null;

function ensureLensDbMap(): Promise<Map<string, string>> {
  if (!lensDbMapPromise) {
    lensDbMapPromise = import('./lensDatabase.json').then(
      (mod) =>
        new Map(
          (mod.default as { lenses: LensDbEntry[] }).lenses.map((e) => [e.make + '|' + e.spec, e.name])
        )
    );
  }
  return lensDbMapPromise;
}

const GENERIC_LENS_SPEC_RE = /\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*mm\s*(?:[fF]\s*\/\s*)?[fF]?\s*\d+(?:\.\d+)?/i;

function normalizeMake(make: string | undefined): string | null {
  if (!make) return null;
  const raw = make.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!raw) return null;

  // Common full manufacturer strings -> compact make keys used by lensDatabase.json.
  const aliases: Record<string, string> = {
    'nikoncorporation': 'nikon',
    'nikkor': 'nikon',
    'canoninc': 'canon',
    'sonycorporation': 'sony',
    'olympuscorporation': 'olympus',
    'olympusimagingcorporation': 'olympus',
    'omdigital': 'olympus',
    'omsystem': 'olympus',
    'fuji': 'fujifilm',
    'fujifilmcorporation': 'fujifilm',
    'panasoniccorporation': 'panasonic',
    'matsushitaelectricindustrialcoltd': 'panasonic',
    'pentaxcorporation': 'pentax',
    'ricohimagingcompanyltd': 'ricoh',
    'samsungelectronics': 'samsung',
    'sigmacorporation': 'sigma',
    'minoltacoltd': 'minolta',
  };
  if (aliases[raw]) return aliases[raw];

  if (raw.includes('nikon')) return 'nikon';
  if (raw.includes('canon')) return 'canon';
  if (raw.includes('sony')) return 'sony';
  if (raw.includes('olympus') || raw.includes('omsystem') || raw === 'om') return 'olympus';
  if (raw.includes('fujifilm') || raw === 'fuji') return 'fujifilm';
  if (raw.includes('panasonic')) return 'panasonic';
  if (raw.includes('pentax')) return 'pentax';
  if (raw.includes('ricoh')) return 'ricoh';
  if (raw.includes('samsung')) return 'samsung';
  if (raw.includes('sigma')) return 'sigma';
  if (raw.includes('minolta')) return 'minolta';
  return raw;
}

function extractLensSpecKey(text: string): string | null {
  const m = text.match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*mm\s*(?:[fF]\s*\/\s*)?[fF]?\s*(\d+(?:\.\d+)?)(?:\s*[-/]\s*(\d+(?:\.\d+)?))?/i);
  if (!m) return null;
  const a = String(Number(m[1]));
  const b = m[2] ? String(Number(m[2])) : '';
  const c = String(Number(m[3]));
  const d = m[4] ? String(Number(m[4])) : '';
  return b ? (d ? a + '-' + b + '|' + c + '-' + d : a + '-' + b + '|' + c) : a + '|' + c;
}

async function resolveLensName(lensModel: string, make: string | undefined, lens: string | undefined): Promise<string | null> {
  if (!GENERIC_LENS_SPEC_RE.test(lensModel.trim())) return null;
  const makeKey = normalizeMake(make);
  const key = extractLensSpecKey((lens || lensModel).replace(/\s+/g, ' ').trim());
  if (!makeKey || !key) return null;
  const map = await ensureLensDbMap();
  return map.get(makeKey + '|' + key) || null;
}
async function parseExifInBrowser(file: File): Promise<ExifData> {
  const exifr = await import('exifr');
  const raw: any = (await exifr.parse(file, { tiff: true, xmp: true })) || {};
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
  // LensModel/LensID share the standard EXIF tag 0xA434. If the stored LensModel
  // is only a focal-range spec (e.g. "18.0-140.0 mm f/3.5-5.6"), resolve it back
  // to a readable lens name from the XMP LensID/Lens fields when possible.
  const lens = getTag(['LensModel'], 42036);
  const lensText = lens ? String(lens).trim() : '';
  if (lensText) {
    const resolved = await resolveLensName(lensText, raw.Make, raw.Lens || raw.LensInfo);
    exif.lens_model = resolved || lensText;
  }

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
  photoCountEl.textContent = String(photos.length);
  emptyQueueEl.style.display = photos.length === 0 ? 'flex' : 'none';
  const navPrev = document.getElementById('btn-prev-photo');
  const navNext = document.getElementById('btn-next-photo');
  const showNav = photos.length > 1 ? 'flex' : 'none';
  if (navPrev) navPrev.style.display = showNav;
  if (navNext) navNext.style.display = showNav;
  photoListEl.innerHTML = '';

  photos.forEach((photo, idx) => {
    const card = document.createElement('div');
    card.className = 'photo-card ' + (idx === activeIndex ? 'active' : '');
    card.draggable = true;
    card.dataset.index = String(idx);

    const thumb = document.createElement('img');
    thumb.className = 'photo-thumb';
    thumb.src = thumbnailSrc(photo, isTauri ? convertFileSrc : undefined);

    const meta = document.createElement('div');
    meta.className = 'photo-meta';

    const name = document.createElement('div');
    name.className = 'photo-name';
    name.textContent = photo.filename;

    const badge = document.createElement('div');
    badge.className = 'photo-exif-badge';
    const camera = photo.exif.model || photo.exif.make || (getStoredLang() === 'zh' ? '无 EXIF' : 'No EXIF');
    const lens = photo.exif.lens_model ? ' | ' + photo.exif.lens_model : '';
    const dims = photo.exif.width && photo.exif.height ? ' | ' + photo.exif.width + '×' + photo.exif.height : '';
    badge.textContent = camera + lens + dims;

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
      persistSession();
    };

    card.appendChild(thumb);
    card.appendChild(meta);
    card.appendChild(delBtn);

    card.addEventListener('dragstart', () => {
      dragFromIndex = idx;
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      card.classList.remove('drag-over');
      dragFromIndex = -1;
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (dragFromIndex < 0 || dragFromIndex === idx) return;
      const moved = photos.splice(dragFromIndex, 1)[0];
      photos.splice(idx, 0, moved);
      if (activeIndex === dragFromIndex) activeIndex = idx;
      else if (dragFromIndex < activeIndex && idx >= activeIndex) activeIndex--;
      else if (dragFromIndex > activeIndex && idx <= activeIndex) activeIndex++;
      dragFromIndex = -1;
      renderPhotoList();
      triggerReRender();
      persistSession();
    });

    card.onclick = () => {
      activeIndex = idx;
      renderPhotoList();
      triggerReRender();
      persistSession();
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

  canvasContainer.style.display = 'flex';

  const currentPhoto = photos[activeIndex];
  let img = previewImageCache.get(currentPhoto.path);

  if (!img) {
    img = new Image();
    const loaded = await new Promise<boolean>((res) => {
      img!.onload = () => res(true);
      // A rejected/failed thumbnail source must never hang the render pipeline.
      img!.onerror = () => res(false);
      setTimeout(() => res(false), 10000);
      img!.src = thumbnailSrc(currentPhoto, isTauri ? convertFileSrc : undefined);
    });
    if (!loaded) {
      showToast('预览加载失败，请重新导入或重启应用', 'error');
      return;
    }
    previewImageCache.set(currentPhoto.path, img);
    // LRU cap: bound memory when large queues are browsed for a long time
    if (previewImageCache.size > 16) {
      const oldest = previewImageCache.keys().next().value;
      if (oldest !== undefined && oldest !== currentPhoto.path) {
        previewImageCache.delete(oldest);
      }
    }
  }

  await renderPhotoFrame(img, currentPhoto.exif, config, previewCanvas);
  applyPreviewFit();
  extractPhotoDominantColor(img, currentPhoto.path);
  document.body.classList.toggle('photo-light', photoLightEnabled);
}

/**
 * Fit the preview canvas into the viewport: portrait canvases are much taller
 * than landscape ones, so the max box must be measured from the real viewport
 * padding instead of a brittle vh estimate — otherwise the frame gets clipped
 * (bottom bar cut off, top margin hidden) and looks broken.
 */
function applyPreviewFit() {
  if (!viewportEl || !previewCanvas) return;
  const cs = getComputedStyle(viewportEl);
  const availH =
    viewportEl.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const availW =
    viewportEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  previewCanvas.style.maxHeight = `${Math.max(120, Math.floor(availH))}px`;
  previewCanvas.style.maxWidth = `${Math.max(120, Math.floor(availW))}px`;
}

function clearCanvas() {
  const ctx = previewCanvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewCanvas.width = 0;
    previewCanvas.height = 0;
  }
  canvasContainer.style.display = 'none';
}

function setZoom(val: number) {
  currentZoom = val;
  if (currentZoom <= 1.01) {
    panX = 0;
    panY = 0;
  }
  applyCanvasTransform();
  zoomLevelEl.textContent = Math.round(currentZoom * 100) + '%';
}

function applyCanvasTransform() {
  canvasContainer.style.transform = 'translate(' + panX + 'px, ' + panY + 'px) scale(' + currentZoom + ')';
}

function drawOriginalPreview() {
  const currentPhoto = photos[activeIndex];
  if (!currentPhoto) return;
  const img = previewImageCache.get(currentPhoto.path);
  const ctx = previewCanvas.getContext('2d');
  if (!img || !ctx) return;
  previewCanvas.width = img.naturalWidth || img.width;
  previewCanvas.height = img.naturalHeight || img.height;
  ctx.drawImage(img, 0, 0, previewCanvas.width, previewCanvas.height);
}

// -----------------------------------------------------------------------------
// Exporting Operations (Full Original Resolution)
// -----------------------------------------------------------------------------
/**
 * Load the full-resolution original for export/preview:
 * - Tauri + JPEG/PNG/WebP: stream the file straight into the webview via the
 *   asset protocol (no 33MB base64 IPC, no Rust re-encode; the browser applies
 *   EXIF orientation natively).
 * - TIFF/other or asset failures: fall back to the Rust decode path.
 */
async function loadFullImage(item: PhotoItem): Promise<HTMLImageElement> {
  const ext = (item.filename.split('.').pop() || '').toLowerCase();
  if (isTauri && ['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
    try {
      const img = new Image();
      // Required for the asset-protocol image to stay CORS-clean: without it
      // the request runs in no-cors mode and taints the export canvas, making
      // toDataURL/toBlob throw SecurityError.
      img.crossOrigin = 'anonymous';
      img.src = convertFileSrc(item.path);
      await Promise.race([
        new Promise((res, rej) => {
          img.onload = () => res(null);
          img.onerror = () => rej(new Error('asset load failed'));
        }),
        // A stuck asset request must fall back to the Rust decode path.
        new Promise((_, rej) => setTimeout(() => rej(new Error('asset load timeout')), 8000)),
      ]);

      // Verify the image is actually CORS-clean for canvas readback; a taint
      // check on a 1x1 probe is cheaper than failing inside the big export.
      const probe = document.createElement('canvas');
      probe.width = 1;
      probe.height = 1;
      probe.getContext('2d')!.drawImage(img, 0, 0, 1, 1);
      probe.toDataURL();

      return img;
    } catch {
      // fall through to the Rust decode path
    }
  }
  const fullResDataUrl: string = await invoke('load_full_photo', {
    path: item.path,
    orientation: item.exif.orientation,
  });
  const img = new Image();
  img.src = fullResDataUrl;
  await new Promise((res) => (img.onload = res));
  return img;
}

/**
 * Encode the framed canvas and write it out.
 * - JPEG @ 100%: keep the PNG → Rust exact-encode path (quality unchanged).
 * - Everything else: browser-encode directly to the target format (skips the
 *   old detour of PNG-encoding every export and re-encoding in Rust), which
 *   cuts CPU and shrinks the base64 IPC payload several-fold.
 */
async function encodeAndSaveExport(
  canvas: HTMLCanvasElement,
  outputPath: string,
  format: 'jpeg' | 'png' | 'webp',
  quality: number
): Promise<void> {
  if (format === 'jpeg' && quality >= 100) {
    const base64Data = canvas.toDataURL('image/png');
    await invoke('save_rendered_photo', { outputPath, base64Data, format, quality });
    return;
  }
  const blob = await canvasToBlob(canvas, format, quality);
  if (!blob) throw new Error('画布编码失败');
  const base64Data = await blobToBase64(blob);
  await invoke('save_rendered_photo', { outputPath, base64Data, format, quality });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('读取编码数据失败'));
    reader.readAsDataURL(blob);
  });
}

async function handleExportCurrent() {
  if (activeIndex < 0 || activeIndex >= photos.length) {
    showToast('当前没有选中任何照片', 'info');
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

    showProgressModal('正在导出照片...', '正在读取原片...', 25);

    const fullImg = await loadFullImage(currentPhoto);

    showProgressModal('正在渲染照片...', '正在生成相框...', 60);

    const exportCanvas = document.createElement('canvas');
    await renderPhotoFrame(fullImg, currentPhoto.exif, config, exportCanvas);

    showProgressModal('正在编码与写入文件...', '分辨率: ' + exportCanvas.width + ' × ' + exportCanvas.height, 85);

    await encodeAndSaveExport(exportCanvas, savePath, format, quality);

    showToast('已保存 (' + exportCanvas.width + '×' + exportCanvas.height + '): ' + savePath, 'success', {
      label: '打开所在文件夹',
      onClick: () => {
        revealItemInDir(savePath).catch((err) => showToast('打开文件夹失败: ' + err, 'error'));
      },
    });
  } catch (err) {
    showToast('导出失败: ' + err, 'error');
  } finally {
    hideProgressModal();
  }
}

async function handleExportCurrentBrowser(item: PhotoItem) {
  if (!item.sourceFile) {
    showToast('文件句柄缺失，请重新导入', 'error');
    return;
  }

  const format = exportSettings.format;
  const quality = exportSettings.quality;
  const defaultName = buildOutputName(item, activeIndex);

  try {
    showProgressModal('正在导出照片...', '正在读取原片...', 25);

    const img = await loadImageFromFile(item.sourceFile);

    showProgressModal('正在渲染照片...', '正在生成相框...', 60);

    const exportCanvas = document.createElement('canvas');
    await renderPhotoFrame(img, item.exif, config, exportCanvas);

    showProgressModal('正在写入文件...', '分辨率: ' + exportCanvas.width + ' × ' + exportCanvas.height, 85);

    const blob = await canvasToBlob(exportCanvas, format, quality);
    if (blob) downloadBlob(blob, defaultName);
    showToast('已保存 (' + exportCanvas.width + '×' + exportCanvas.height + '): ' + defaultName, 'success');
  } catch (err) {
    showToast('导出失败: ' + err, 'error');
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
    showToast('列表为空，请先添加照片', 'info');
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
      progressCancelBtn.textContent = translateText('取消任务');
    }
    if (progressFailuresEl) progressFailuresEl.style.display = 'none';

    const exportCanvas = document.createElement('canvas');
    for (let i = 0; i < photos.length; i++) {
      if (exportCancelled) {
        showToast('已取消导出，完成 ' + successCount + ' / ' + photos.length + ' 张', 'info');
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
        const fullImg = await loadFullImage(item);
        await renderPhotoFrame(fullImg, item.exif, config, exportCanvas);

        const outName = buildOutputName(item, i);
        const outPath = await resolveUniqueOutputPath(outputDir, outName);

        showProgressModal(
          '正在写入文件...',
          '(' + (i + 1) + '/' + photos.length + ') ' + item.filename,
          70 + Math.round(((i + 1) / photos.length) * 25),
          true
        );

        await encodeAndSaveExport(exportCanvas, outPath, format, quality);
        successCount++;
      } catch (err) {
        failures.push({ filename: item.filename, error: String(err) });
      }
    }

    if (exportCancelled) {
      showToast('已取消导出，完成 ' + successCount + ' / ' + photos.length + ' 张', 'info');
      return;
    }

    if (failures.length === 0) {
      showToast('批量导出完成: ' + successCount + ' / ' + photos.length + ' 张', 'success', {
        label: '打开所在文件夹',
        onClick: () => {
          revealItemInDir(outputDir).catch((err) => showToast('打开文件夹失败: ' + err, 'error'));
        },
      });
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
        progressFailuresEl.innerHTML = translateText('<div class="failure-title">失败明细 (前 8 条)</div><ul>' + items + '</ul>');
      }
      if (progressCancelBtn) {
        progressCancelBtn.style.display = 'block';
        progressCancelBtn.textContent = translateText('关闭');
      }
    }
  } catch (err) {
    showToast('批量导出失败: ' + err, 'error');
  } finally {
    if (!keepProgressModalOpen) hideProgressModal();
  }
}

async function handleBatchExportBrowser() {
  if (photos.length === 0) {
    showToast('列表为空，请先添加照片', 'info');
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
    showToast('批量导出完成: ' + ok + ' / ' + photos.length + ' 张', 'success');
  } catch (err) {
    showToast('批量导出失败: ' + err, 'error');
  } finally {
    hideProgressModal();
  }
}


let toastTimer: any = null;

function showToast(msg: string, type: 'success' | 'error' | 'info' = 'info', action?: { label: string; onClick: () => void }) {
  toastEl.textContent = translateText(msg);
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = translateText(action.label);
    btn.addEventListener('click', () => {
      action.onClick();
      toastEl.style.display = 'none';
    });
    toastEl.appendChild(btn);
  }
  toastEl.className = 'toast ' + type;
  toastEl.style.display = 'block';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.style.display = 'none';
  }, action ? 8000 : 3500);
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
