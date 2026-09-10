import { store } from '../state/store';
import { BackgroundType, FrameTemplateId, isTauri } from '../types';
import { t } from '../i18n';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

export class SettingsController {
  private showToastFn: (msg: string, type?: 'success' | 'error' | 'info') => void;

  constructor(showToastFn: (msg: string, type?: 'success' | 'error' | 'info') => void) {
    this.showToastFn = showToastFn;
    this.bindEvents();
    this.syncUI();

    store.subscribe((e) => {
      if (e.type === 'config_changed' || e.type === 'active_index_changed') {
        this.syncUI();
      }
    });
  }

  public syncUI() {
    const config = store.getActiveConfig();

    // 1. Template cards
    const templateCards = Array.from(document.querySelectorAll<HTMLElement>('.template-card'));
    templateCards.forEach((card) => {
      const active = card.dataset.template === config.template;
      card.classList.toggle('active', active);
    });

    // 2. Background style buttons
    const bgBtns = Array.from(document.querySelectorAll<HTMLElement>('.bg-type-btn'));
    bgBtns.forEach((btn) => {
      const active = btn.dataset.bg === config.backgroundType;
      btn.classList.toggle('active', active);
    });

    // Frosted blur slider row
    const rowBlur = document.getElementById('row-blur-intensity');
    if (rowBlur) {
      rowBlur.style.display = config.backgroundType === 'frosted_blur' ? 'block' : 'none';
    }

    // Custom color row
    const customColorRow = document.getElementById('custom-color-row');
    if (customColorRow) {
      customColorRow.style.display = config.backgroundType === 'custom' ? 'flex' : 'none';
    }

    // Template specific slider visibility
    this.updateTemplateSpecificVisibility(config.template);

    // Form inputs sync
    this.setInputValue('cfg-blur-intensity', String(config.blurIntensity));
    this.setInputValue('cfg-custom-color', config.customBackgroundColor || '#ffffff');
    this.setInputValue('cfg-brand-logo', config.selectedLogo);
    this.setCheckboxValue('cfg-show-logo', config.showLogo);
    this.setCheckboxValue('cfg-show-model', config.showModel);
    this.setCheckboxValue('cfg-show-lens', config.showLens);
    this.setCheckboxValue('cfg-show-params', config.showParams);
    this.setCheckboxValue('cfg-show-date', config.showDate);
    this.setInputValue('cfg-focal-mode', config.focalLengthMode);
    this.setInputValue('cfg-custom-note', config.customNote || '');
    this.setInputValue('cfg-font-family', config.fontFamily);
    this.setInputValue('cfg-padding', String(config.paddingPercent));
    this.setInputValue('cfg-bar-height', String(config.bottomBarHeightPercent));
    this.setInputValue('cfg-font-scale', String(Math.round(config.fontSizeScale * 100)));
    this.setInputValue('cfg-font-weight', String(config.fontWeight));
    this.setInputValue('cfg-secondary-font-weight', String(config.secondaryFontWeight));
    this.setInputValue('cfg-border-radius', String(config.borderRadius));
    this.setInputValue('cfg-shadow', String(config.shadowRadius));
    this.setInputValue('cfg-vertical-offset', String(config.contentVerticalOffset));
    this.setInputValue('cfg-film-sim', config.filmSimulation || '');
    this.setInputValue('cfg-cine-meta', config.cineMetaText || '');
    this.setInputValue('cfg-film-frame-no', config.filmFrameNo || '');
    this.setInputValue('cfg-film-exp', config.filmExp || '');
    this.setInputValue('cfg-film-code', config.filmCode || '');
    this.setCheckboxValue('cfg-show-soundtrack', config.showSoundTrack);
    this.setCheckboxValue('cfg-show-grain', config.showFilmGrain);
    this.setCheckboxValue('cfg-show-dx-barcode', config.showDxBarcode);
    this.setCheckboxValue('cfg-show-neighbor-frames', config.showNeighborFrames);
    this.setCheckboxValue('cfg-show-light-leak', config.showLightLeak);
    this.setCheckboxValue('cfg-show-date-stamp', config.showDateStamp);

    // Custom Logo Section
    const customLogoRow = document.getElementById('row-custom-logo');
    if (customLogoRow) {
      customLogoRow.style.display = config.selectedLogo === 'custom' ? 'flex' : 'none';
    }
    const customLogoThumb = document.getElementById('custom-logo-thumb') as HTMLImageElement | null;
    if (customLogoThumb) {
      if (config.customLogoDataUrl) {
        customLogoThumb.src = config.customLogoDataUrl;
        customLogoThumb.style.display = 'block';
      } else {
        customLogoThumb.style.display = 'none';
      }
    }

    // Per-photo override checkbox
    const chkOverride = document.getElementById('cfg-per-photo-override') as HTMLInputElement | null;
    if (chkOverride) {
      chkOverride.checked = store.perPhotoOverrideEnabled;
    }

    this.updateValueBadges();
  }

  private updateTemplateSpecificVisibility(template: FrameTemplateId) {
    const blockPadding = document.getElementById('block-padding');
    const blockBarHeight = document.getElementById('block-bar-height');
    const blockRadius = document.getElementById('block-border-radius');
    const blockShadow = document.getElementById('block-shadow');

    // Decoration markings exist only for the cinematic / film_roll templates
    const groupDecor = document.getElementById('group-decor');
    const blockDecorCine = document.getElementById('block-decor-cine');
    const blockDecorFilm = document.getElementById('block-decor-film');
    const hasFilmDecor = template === 'film_roll' || template === 'medium_format' || template === 'slide_mount' || template === 'street_split' || (template as string) === 'contact_sheet' || (template as string) === 'recipe_card';
    const hasCineDecor = template === 'cinematic';
    if (groupDecor) groupDecor.style.display = hasFilmDecor || hasCineDecor ? 'block' : 'none';
    if (blockDecorCine) blockDecorCine.style.display = hasCineDecor ? 'block' : 'none';
    if (blockDecorFilm) blockDecorFilm.style.display = hasFilmDecor ? 'block' : 'none';

    if (template === 'bottom_bar' || template === 'border' || template === 'center_brand' || template === 'street_split' || (template as string) === 'recipe_card') {
      if (blockPadding) blockPadding.style.display = 'block';
      if (blockBarHeight) blockBarHeight.style.display = template === 'border' ? 'none' : 'block';
      if (blockRadius) blockRadius.style.display = 'block';
      if (blockShadow) blockShadow.style.display = 'block';
    } else if (template === 'museum_matte' || template === 'medium_format' || (template as string) === 'floating_frame') {
      if (blockPadding) blockPadding.style.display = 'block';
      if (blockBarHeight) blockBarHeight.style.display = 'none';
      if (blockRadius) blockRadius.style.display = template === 'medium_format' ? 'block' : 'none';
      if (blockShadow) blockShadow.style.display = 'block';
    } else if (template === 'slide_mount') {
      if (blockPadding) blockPadding.style.display = 'block';
      if (blockBarHeight) blockBarHeight.style.display = 'none';
      if (blockRadius) blockRadius.style.display = 'block';
      if (blockShadow) blockShadow.style.display = 'block';
    } else if (template === 'cinematic' || template === 'film_roll') {
      if (blockPadding) blockPadding.style.display = 'none';
      if (blockBarHeight) blockBarHeight.style.display = 'none';
      if (blockRadius) blockRadius.style.display = 'none';
      if (blockShadow) blockShadow.style.display = 'none';
    } else if (template === 'polaroid') {
      if (blockPadding) blockPadding.style.display = 'none';
      if (blockBarHeight) blockBarHeight.style.display = 'none';
      if (blockRadius) blockRadius.style.display = 'block';
      if (blockShadow) blockShadow.style.display = 'none';
    } else {
      // minimal badge
      if (blockPadding) blockPadding.style.display = 'none';
      if (blockBarHeight) blockBarHeight.style.display = 'none';
      if (blockRadius) blockRadius.style.display = 'none';
      if (blockShadow) blockShadow.style.display = 'none';
    }
  }

  private updateValueBadges() {
    const config = store.getActiveConfig();
    this.setTextContent('val-blur-intensity', String(config.blurIntensity));
    this.setTextContent('val-padding', `${config.paddingPercent}%`);
    this.setTextContent('val-bar-height', `${config.bottomBarHeightPercent}%`);
    this.setTextContent('val-font-scale', `${Math.round(config.fontSizeScale * 100)}%`);
    this.setTextContent('val-font-weight', String(config.fontWeight));
    this.setTextContent('val-secondary-font-weight', String(config.secondaryFontWeight));
    this.setTextContent('val-border-radius', `${config.borderRadius}px`);
    this.setTextContent('val-shadow', String(config.shadowRadius));

    const offset = config.contentVerticalOffset || 0;
    const offsetText = offset === 0 ? t('居中') : offset > 0 ? `+${offset}` : String(offset);
    this.setTextContent('val-vertical-offset', offsetText);
  }

  private bindEvents() {
    // 1. Template selection
    document.querySelector('.template-grid')?.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.template-card');
      if (!card) return;
      const template = card.dataset.template as FrameTemplateId;
      if (template) {
        store.updateActiveConfig({ template });
      }
    });

    // 2. Background style selection
    document.querySelector('.bg-type-grid')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.bg-type-btn');
      if (!btn) return;
      const bg = btn.dataset.bg as BackgroundType;
      if (bg) {
        store.updateActiveConfig({ backgroundType: bg });
      }
    });

    // Custom background color
    document.getElementById('cfg-custom-color')?.addEventListener('input', (e) => {
      const color = (e.target as HTMLInputElement).value;
      store.updateActiveConfig({ customBackgroundColor: color });
    });

    // Custom Logo File input
    const btnUploadLogo = document.getElementById('btn-upload-logo');
    const inputCustomLogoFile = document.getElementById('input-custom-logo-file') as HTMLInputElement | null;
    const btnClearLogo = document.getElementById('btn-clear-custom-logo');

    btnUploadLogo?.addEventListener('click', async () => {
      if (isTauri()) {
        try {
          const selected = await open({
            multiple: false,
            filters: [
              {
                name: 'Images',
                extensions: ['png', 'svg', 'jpg', 'jpeg', 'PNG', 'SVG', 'JPG', 'JPEG', 'webp', 'WEBP'],
              },
            ],
          });
          if (selected && typeof selected === 'string') {
            const dataUrl = await invoke<string>('load_full_photo', { path: selected });
            store.updateActiveConfig({
              selectedLogo: 'custom',
              customLogoDataUrl: dataUrl,
            });
            this.showToastFn(t('自定义印章 / Logo 已加载'), 'success');
            return;
          } else if (selected === null) {
            return;
          }
        } catch (err) {
          console.warn('Tauri open logo failed:', err);
        }
      }
      inputCustomLogoFile?.click();
    });
    inputCustomLogoFile?.addEventListener('change', () => {
      const file = inputCustomLogoFile.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        store.updateActiveConfig({
          selectedLogo: 'custom',
          customLogoDataUrl: dataUrl,
        });
        this.showToastFn(t('自定义印章 / Logo 已加载'), 'success');
      };
      reader.readAsDataURL(file);
    });

    btnClearLogo?.addEventListener('click', () => {
      store.updateActiveConfig({
        selectedLogo: 'auto',
        customLogoDataUrl: '',
      });
      this.showToastFn(t('已清除自定义 Logo'), 'info');
    });

    // Per-photo override checkbox
    document.getElementById('cfg-per-photo-override')?.addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      store.perPhotoOverrideEnabled = on;
      const photo = store.getActivePhoto();
      if (on && photo && !photo.configOverride) {
        photo.configOverride = { ...store.globalConfig };
      }
      this.syncUI();
      this.showToastFn(on ? t('已启用仅对当前照片微调') : t('已切换回全局统一配置'), 'info');
    });

    // Reset All Settings
    document.getElementById('btn-reset-all')?.addEventListener('click', () => {
      store.resetActiveConfigToDefault();
      this.showToastFn(t('已重置所有参数为默认配置'), 'success');
    });

    // Single-field reset buttons
    document.querySelectorAll<HTMLButtonElement>('.btn-reset-single').forEach((btn) => {
      btn.addEventListener('click', () => {
        const field = btn.dataset.reset;
        if (!field) return;
        switch (field) {
          case 'padding':
            store.updateActiveConfig({ paddingPercent: 4 });
            break;
          case 'bar-height':
            store.updateActiveConfig({ bottomBarHeightPercent: 12 });
            break;
          case 'font-scale':
            store.updateActiveConfig({ fontSizeScale: 1.0 });
            break;
          case 'font-weight':
            store.updateActiveConfig({ fontWeight: 500 });
            break;
          case 'secondary-font-weight':
            store.updateActiveConfig({ secondaryFontWeight: 400 });
            break;
          case 'border-radius':
            store.updateActiveConfig({ borderRadius: 0 });
            break;
          case 'shadow':
            store.updateActiveConfig({ shadowRadius: 15 });
            break;
          case 'blur-intensity':
            store.updateActiveConfig({ blurIntensity: 55 });
            break;
          case 'vertical-offset':
            store.updateActiveConfig({ contentVerticalOffset: 0 });
            break;
          case 'cineMetaText':
            store.updateActiveConfig({ cineMetaText: '180.0° · 24 FPS' });
            break;
          case 'filmFrameNo':
            store.updateActiveConfig({ filmFrameNo: '24A' });
            break;
          case 'filmExp':
            store.updateActiveConfig({ filmExp: '24 · EXP 36' });
            break;
          case 'filmCode':
            store.updateActiveConfig({ filmCode: '5063' });
            break;
        }
      });
    });

    // Control Sliders
    this.bindRange('cfg-blur-intensity', (v) => store.updateActiveConfig({ blurIntensity: v }));
    this.bindRange('cfg-padding', (v) => store.updateActiveConfig({ paddingPercent: v }));
    this.bindRange('cfg-bar-height', (v) => store.updateActiveConfig({ bottomBarHeightPercent: v }));
    this.bindRange('cfg-font-scale', (v) => store.updateActiveConfig({ fontSizeScale: v / 100 }));
    this.bindRange('cfg-font-weight', (v) => store.updateActiveConfig({ fontWeight: v }));
    this.bindRange('cfg-secondary-font-weight', (v) => store.updateActiveConfig({ secondaryFontWeight: v }));
    this.bindRange('cfg-border-radius', (v) => store.updateActiveConfig({ borderRadius: v }));
    this.bindRange('cfg-shadow', (v) => store.updateActiveConfig({ shadowRadius: v }));
    this.bindRange('cfg-vertical-offset', (v) => store.updateActiveConfig({ contentVerticalOffset: v }));

    // Checkboxes & Selects
    this.bindCheckbox('cfg-show-logo', (v) => store.updateActiveConfig({ showLogo: v }));
    this.bindSelect('cfg-brand-logo', (v) => store.updateActiveConfig({ selectedLogo: v }));
    this.bindCheckbox('cfg-show-model', (v) => store.updateActiveConfig({ showModel: v }));
    this.bindCheckbox('cfg-show-lens', (v) => store.updateActiveConfig({ showLens: v }));
    this.bindCheckbox('cfg-show-params', (v) => store.updateActiveConfig({ showParams: v }));
    this.bindCheckbox('cfg-show-date', (v) => store.updateActiveConfig({ showDate: v }));
    this.bindSelect('cfg-focal-mode', (v) => store.updateActiveConfig({ focalLengthMode: v as any }));
    this.bindSelect('cfg-font-family', (v) => store.updateActiveConfig({ fontFamily: v }));
    this.bindInput('cfg-custom-note', (v) => store.updateActiveConfig({ customNote: v }));
    this.bindInput('cfg-film-sim', (v) => store.updateActiveConfig({ filmSimulation: v }));
    this.bindInput('cfg-cine-meta', (v) => store.updateActiveConfig({ cineMetaText: v }));
    this.bindInput('cfg-film-frame-no', (v) => store.updateActiveConfig({ filmFrameNo: v }));
    this.bindInput('cfg-film-exp', (v) => store.updateActiveConfig({ filmExp: v }));
    this.bindInput('cfg-film-code', (v) => store.updateActiveConfig({ filmCode: v }));
    this.bindCheckbox('cfg-show-soundtrack', (v) => store.updateActiveConfig({ showSoundTrack: v }));
    this.bindCheckbox('cfg-show-grain', (v) => store.updateActiveConfig({ showFilmGrain: v }));
    this.bindCheckbox('cfg-show-dx-barcode', (v) => store.updateActiveConfig({ showDxBarcode: v }));
    this.bindCheckbox('cfg-show-neighbor-frames', (v) => store.updateActiveConfig({ showNeighborFrames: v }));
    this.bindCheckbox('cfg-show-light-leak', (v) => store.updateActiveConfig({ showLightLeak: v }));
    this.bindCheckbox('cfg-show-date-stamp', (v) => store.updateActiveConfig({ showDateStamp: v }));

    // Export Settings Controls
    const expQualitySlider = document.getElementById('export-quality') as HTMLInputElement | null;
    const expQualityNum = document.getElementById('export-quality-val') as HTMLInputElement | null;
    const expFormatSelect = document.getElementById('export-format') as HTMLSelectElement | null;
    const expNameInput = document.getElementById('export-filename-template') as HTMLInputElement | null;

    if (expQualitySlider && expQualityNum) {
      expQualitySlider.addEventListener('input', () => {
        expQualityNum.value = expQualitySlider.value;
        store.updateExportSettings({ quality: Number(expQualitySlider.value) });
      });
      expQualityNum.addEventListener('input', () => {
        expQualitySlider.value = expQualityNum.value;
        store.updateExportSettings({ quality: Number(expQualityNum.value) });
      });
    }

    expFormatSelect?.addEventListener('change', () => {
      store.updateExportSettings({ format: expFormatSelect.value as any });
    });

    expNameInput?.addEventListener('input', () => {
      store.updateExportSettings({ filenameTemplate: expNameInput.value.trim() });
    });
  }

  private bindRange(id: string, onChange: (val: number) => void) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.addEventListener('input', () => onChange(Number(el.value)));
  }

  private bindCheckbox(id: string, onChange: (val: boolean) => void) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.addEventListener('change', () => onChange(el.checked));
  }

  private bindSelect(id: string, onChange: (val: string) => void) {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    el?.addEventListener('change', () => onChange(el.value));
  }

  private bindInput(id: string, onChange: (val: string) => void) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.addEventListener('input', () => onChange(el.value));
  }

  private setInputValue(id: string, val: string) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (el && el.value !== val) el.value = val;
  }

  private setCheckboxValue(id: string, val: boolean) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.checked = val;
  }

  private setTextContent(id: string, text: string) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
}
