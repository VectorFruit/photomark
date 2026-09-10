import { store, FxIntensity } from '../state/store';

export class AmbientController {
  private dominantColorCache: Map<string, [number, number, number]> = new Map();
  private isPaused = false;
  private pointerGlowEl: HTMLDivElement | null;

  constructor() {
    this.pointerGlowEl = document.getElementById('pointer-glow') as HTMLDivElement | null;
    this.applyTheme(store.currentTheme);
    this.applyPalette(store.currentPalette);
    this.applyFxIntensity(store.currentFx);
    this.applyPhotoLight(store.photoLightEnabled);
    this.bindEvents();
  }

  public bindEvents() {
    // Theme options
    const themeOptionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.theme-option'));
    themeOptionButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const opt = btn.dataset.themeOption as 'dark' | 'light' | 'system';
        if (opt) {
          store.currentTheme = opt;
          localStorage.setItem('photomark_theme', opt);
          this.applyTheme(opt);
          this.updateThemeToggleUI();
        }
      });
    });

    // Segmented FX Intensity
    const fxSeg = document.getElementById('fx-intensity-seg');
    fxSeg?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.fx-btn');
      if (!btn) return;
      const level = btn.dataset.fx as FxIntensity;
      if (level) {
        store.currentFx = level;
        localStorage.setItem('photomark_fx', level);
        this.applyFxIntensity(level);
      }
    });

    // Palette Swatches
    const paletteRow = document.getElementById('palette-row');
    paletteRow?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.swatch');
      if (!btn) return;
      const palette = btn.dataset.palette;
      if (palette) {
        store.currentPalette = palette;
        localStorage.setItem('photomark_palette', palette);
        this.applyPalette(palette);
      }
    });

    // Photo Light Checkbox
    const chkPhotoLight = document.getElementById('cfg-photo-light') as HTMLInputElement | null;
    chkPhotoLight?.addEventListener('change', () => {
      store.photoLightEnabled = chkPhotoLight.checked;
      localStorage.setItem('photomark_photo_light', chkPhotoLight.checked ? '1' : '0');
      this.applyPhotoLight(chkPhotoLight.checked);
    });

    // Pointer Glow
    window.addEventListener('pointermove', (e) => {
      if (!this.pointerGlowEl || this.isPaused) return;
      this.pointerGlowEl.style.transform = `translate3d(${e.clientX - 170}px, ${e.clientY - 170}px, 0)`;
    }, { passive: true });
  }

  public resolveTheme(theme: 'dark' | 'light' | 'system'): 'dark' | 'light' {
    if (theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return theme;
  }

  public applyTheme(theme: 'dark' | 'light' | 'system') {
    const resolved = this.resolveTheme(theme);
    document.documentElement.setAttribute('data-theme', resolved);
    this.updateThemeToggleUI();
  }

  public updateThemeToggleUI() {
    const themeOptionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.theme-option'));
    themeOptionButtons.forEach((btn) => {
      const active = btn.dataset.themeOption === store.currentTheme;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  public applyPalette(palette: string) {
    document.documentElement.setAttribute('data-palette', palette);
    const swatches = Array.from(document.querySelectorAll<HTMLButtonElement>('.swatch'));
    swatches.forEach((s) => s.classList.toggle('active', s.dataset.palette === palette));
  }

  public applyFxIntensity(level: FxIntensity) {
    document.documentElement.setAttribute('data-fx', level);
    const fxBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('.fx-btn'));
    fxBtns.forEach((b) => b.classList.toggle('active', b.dataset.fx === level));
  }

  public applyPhotoLight(on: boolean) {
    document.body.classList.toggle('photo-light', on);
    const chk = document.getElementById('cfg-photo-light') as HTMLInputElement | null;
    if (chk) chk.checked = on;
  }

  public updatePhotoDominantColor(img: HTMLImageElement, key: string) {
    if (this.dominantColorCache.has(key)) {
      const [r, g, b] = this.dominantColorCache.get(key)!;
      this.setAmbientPhotoColor(r, g, b);
      return;
    }

    try {
      const probe = document.createElement('canvas');
      probe.width = 16;
      probe.height = 16;
      const ctx = probe.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, 16, 16);
      const data = ctx.getImageData(0, 0, 16, 16).data;
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        rSum += data[i];
        gSum += data[i + 1];
        bSum += data[i + 2];
        count++;
      }
      const r = Math.round(rSum / count);
      const g = Math.round(gSum / count);
      const b = Math.round(bSum / count);
      this.dominantColorCache.set(key, [r, g, b]);
      this.setAmbientPhotoColor(r, g, b);
    } catch {
      // ignore
    }
  }

  private setAmbientPhotoColor(r: number, g: number, b: number) {
    const root = document.documentElement;
    root.style.setProperty('--ambient-photo-color', `${r}, ${g}, ${b}`);
  }
}
