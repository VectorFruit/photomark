import { store } from './state/store';
import { applyLanguage, getStoredLang, setStoredLang, t } from './i18n';
import { ViewportController } from './ui/viewportController';
import { PhotoListController } from './ui/photoListController';
import { SettingsController } from './ui/settingsController';
import { PresetController } from './ui/presetController';
import { AmbientController } from './ui/ambientController';
import { ShortcutsController } from './ui/shortcuts';
import { ImportManager } from './ui/importManager';
import { ExportManager } from './export/exportManager';

// Toast Notification
let toastTimer: any = null;
const toastEl = document.getElementById('toast') as HTMLDivElement;

export function showToast(
  msg: string,
  type: 'success' | 'error' | 'info' = 'info',
  action?: { label: string; onClick: () => void }
) {
  if (!toastEl) return;
  toastEl.textContent = t(msg);
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = t(action.label);
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

// Confirmation Modal
let confirmAction: (() => void) | null = null;
const confirmModalEl = document.getElementById('confirm-modal') as HTMLDivElement;
const confirmTitleEl = document.getElementById('confirm-title') as HTMLDivElement;
const confirmMessageEl = document.getElementById('confirm-message') as HTMLParagraphElement;
const confirmOkBtn = document.getElementById('btn-confirm-ok') as HTMLButtonElement;
const confirmCancelBtn = document.getElementById('btn-confirm-cancel') as HTMLButtonElement;

export function openConfirm(options: {
  title: string;
  message: string;
  okText?: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  if (!confirmModalEl) return;
  confirmTitleEl.textContent = t(options.title);
  confirmMessageEl.textContent = t(options.message);
  confirmOkBtn.textContent = options.okText ? t(options.okText) : t('确认');
  confirmOkBtn.className = options.danger ? 'btn btn-danger' : 'btn btn-primary';
  confirmAction = options.onConfirm;
  confirmModalEl.style.display = 'flex';
}

export function closeConfirm() {
  if (confirmModalEl) confirmModalEl.style.display = 'none';
  confirmAction = null;
}

// UI Scale Management
const UI_SCALES = [0.8, 0.85, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5];
const selectUiScale = document.getElementById('select-ui-scale') as HTMLSelectElement | null;
const btnUiScaleDown = document.getElementById('btn-ui-scale-down') as HTMLButtonElement | null;
const btnUiScaleUp = document.getElementById('btn-ui-scale-up') as HTMLButtonElement | null;

function applyUiScale(scale: number) {
  store.currentUiScale = scale;
  localStorage.setItem('photomark_ui_scale', String(scale));
  document.documentElement.style.setProperty('--ui-scale', String(scale));
  if (selectUiScale) selectUiScale.value = String(scale);
}

function bindUiScale() {
  applyUiScale(store.currentUiScale);
  selectUiScale?.addEventListener('change', () => {
    const val = parseFloat(selectUiScale.value);
    if (!isNaN(val)) applyUiScale(val);
  });
  btnUiScaleDown?.addEventListener('click', () => {
    const cur = store.currentUiScale;
    const prev = [...UI_SCALES].reverse().find((s) => s < cur - 0.01);
    if (prev !== undefined) applyUiScale(prev);
  });
  btnUiScaleUp?.addEventListener('click', () => {
    const cur = store.currentUiScale;
    const next = UI_SCALES.find((s) => s > cur + 0.01);
    if (next !== undefined) applyUiScale(next);
  });
}

// Sidebar Collapse
function bindSidebarCollapse(viewportCtrl: ViewportController) {
  const ws = document.querySelector('.workspace');
  let leftCollapsed = false;
  let rightCollapsed = false;

  const update = () => {
    if (!ws) return;
    ws.classList.toggle('collapse-left', leftCollapsed);
    ws.classList.toggle('collapse-right', rightCollapsed);
    const btnRestoreLeft = document.getElementById('btn-restore-left');
    const btnRestoreRight = document.getElementById('btn-restore-right');
    if (btnRestoreLeft) btnRestoreLeft.style.display = leftCollapsed ? 'flex' : 'none';
    if (btnRestoreRight) btnRestoreRight.style.display = rightCollapsed ? 'flex' : 'none';
    setTimeout(() => viewportCtrl.applyPreviewFit(), 300);
  };

  document.getElementById('btn-collapse-left')?.addEventListener('click', () => {
    leftCollapsed = true;
    update();
  });
  document.getElementById('btn-restore-left')?.addEventListener('click', () => {
    leftCollapsed = false;
    update();
  });
  document.getElementById('btn-collapse-right')?.addEventListener('click', () => {
    rightCollapsed = true;
    update();
  });
  document.getElementById('btn-restore-right')?.addEventListener('click', () => {
    rightCollapsed = false;
    update();
  });
}

// Clear All Photos Button
function bindClearAll() {
  document.getElementById('btn-clear-all')?.addEventListener('click', () => {
    if (store.photos.length === 0) return;
    openConfirm({
      title: '清空列表',
      message: '确定要清空照片列表吗？此操作不可撤销。',
      okText: '清空',
      danger: true,
      onConfirm: () => {
        store.clearPhotos();
        showToast('已清空照片列表', 'info');
      },
    });
  });

  confirmOkBtn?.addEventListener('click', () => {
    if (confirmAction) confirmAction();
    closeConfirm();
  });
  confirmCancelBtn?.addEventListener('click', closeConfirm);
}

// Language Switch
function bindLanguage() {
  const selectLanguageEl = document.getElementById('select-language') as HTMLSelectElement | null;
  if (selectLanguageEl) {
    selectLanguageEl.value = getStoredLang();
    selectLanguageEl.addEventListener('change', () => {
      setStoredLang(selectLanguageEl.value as any);
      applyLanguage();
    });
  }
  applyLanguage();
}

// Application Startup
function init() {
  bindUiScale();
  bindLanguage();
  bindClearAll();

  const ambientCtrl = new AmbientController();
  const viewportCtrl = new ViewportController();
  const photoListCtrl = new PhotoListController();
  new SettingsController(showToast);
  new PresetController(showToast);
  const exportManager = new ExportManager(showToast);
  new ImportManager(showToast);

  bindSidebarCollapse(viewportCtrl);

  new ShortcutsController({
    onExport: () => exportManager.exportCurrent(),
    onPrevPhoto: () => photoListCtrl.switchPhoto(-1),
    onNextPhoto: () => photoListCtrl.switchPhoto(1),
    onDeleteCurrent: () => {
      if (store.activeIndex >= 0) store.removePhoto(store.activeIndex);
    },
    onZoomIn: () => viewportCtrl.zoomStep(0.15),
    onZoomOut: () => viewportCtrl.zoomStep(-0.15),
    onZoomFit: () => viewportCtrl.resetZoomAndPan(),
    onStartCompare: () => viewportCtrl.startComparing(),
    onStopCompare: () => viewportCtrl.stopComparing(),
  });

  // Re-render preview whenever store indicates
  store.subscribe((e) => {
    if (e.type === 'render_needed' || e.type === 'photos_changed' || e.type === 'active_index_changed') {
      viewportCtrl.triggerRender();
      const photo = store.getActivePhoto();
      if (photo && photo.thumbnail_data_url) {
        const img = new Image();
        img.src = photo.thumbnail_data_url;
        ambientCtrl.updatePhotoDominantColor(img, photo.path);
      }
    }
  });

  viewportCtrl.triggerRender();
}

let initialized = false;
function safeInit() {
  if (initialized) return;
  initialized = true;
  init();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', safeInit);
} else {
  safeInit();
}
