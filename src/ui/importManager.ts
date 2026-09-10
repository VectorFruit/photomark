import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { store } from '../state/store';
import { ExifData, PhotoItem, ParseProgressEvent, isTauri } from '../types';
import { t } from '../i18n';

const SESSION_KEY = 'photomark_last_session';

export class ImportManager {
  private fileInputEl: HTMLInputElement | null;
  private dropOverlayEl: HTMLElement | null;
  private showToastFn: (msg: string, type?: 'success' | 'error' | 'info') => void;

  constructor(showToastFn: (msg: string, type?: 'success' | 'error' | 'info') => void) {
    this.showToastFn = showToastFn;
    this.fileInputEl = document.getElementById('file-input') as HTMLInputElement | null;
    this.dropOverlayEl = document.querySelector('.drop-overlay') as HTMLElement | null;

    this.bindEvents();
    if (isTauri()) {
      void this.loadSystemFontsIntoSelect();
      void this.restoreLastSession();
    }
  }

  private bindEvents() {
    // Both header button and empty queue card trigger import
    document.getElementById('btn-import-photos')?.addEventListener('click', () => this.handleImportDialog());
    const emptyQueueEl = document.getElementById('empty-queue');
    emptyQueueEl?.addEventListener('click', () => this.handleImportDialog());

    this.fileInputEl?.addEventListener('change', async () => {
      const files = this.fileInputEl?.files;
      if (files && files.length > 0) {
        await this.importBrowserFiles(Array.from(files));
        this.fileInputEl!.value = '';
      }
    });

    // Listen to Rust parse progress in Tauri mode
    if (isTauri()) {
      void listen<ParseProgressEvent>('parse-progress', (event) => {
        const { current, total, filename, percent } = event.payload;
        this.showProgressModal(t('正在解析照片 EXIF...'), `(${current}/${total}) ${filename}`, percent);
      });
    }

    // Drag & Drop
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (this.dropOverlayEl) this.dropOverlayEl.style.display = 'flex';
    });
    window.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null && this.dropOverlayEl) {
        this.dropOverlayEl.style.display = 'none';
      }
    });
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (this.dropOverlayEl) this.dropOverlayEl.style.display = 'none';
      await this.handleFileDrop(e);
    });

    // Save session on photo changes
    store.subscribe((e) => {
      if (e.type === 'photos_changed' || e.type === 'active_index_changed') {
        this.persistSession();
      }
    });
  }

  public async handleImportDialog() {
    if (isTauri()) {
      try {
        const selected = await open({
          multiple: true,
          filters: [
            {
              name: 'Images',
              extensions: [
                'jpg', 'jpeg', 'png', 'webp', 'tiff', 'tif',
                'JPG', 'JPEG', 'PNG', 'WEBP', 'TIFF', 'TIF',
              ],
            },
          ],
        });

        if (selected && Array.isArray(selected) && selected.length > 0) {
          await this.importPaths(selected);
          return;
        } else if (typeof selected === 'string') {
          await this.importPaths([selected]);
          return;
        } else if (selected === null) {
          // User closed or cancelled the dialog
          return;
        }
      } catch (err) {
        console.warn('Tauri open dialog error, trying fallback:', err);
      }
    }

    // Browser mode or fallback
    this.fileInputEl?.click();
  }

  public async handleFileDrop(e: DragEvent) {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    if (!isTauri()) {
      await this.importBrowserFiles(Array.from(files));
      return;
    }

    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const p = (files[i] as any).path || files[i].name;
      if (p) paths.push(p);
    }
    if (paths.length > 0) {
      await this.importPaths(paths);
    }
  }

  public async importPaths(paths: string[]) {
    try {
      this.showProgressModal(t('准备解析照片...'), t('正在读取文件列表...'), 5);
      const newItems: PhotoItem[] = await invoke('load_photos', { paths });

      if (newItems.length > 0) {
        store.addPhotos(newItems);
        this.showToastFn(`${t('成功导入 ')}${newItems.length} ${t('张照片')}`, 'success');
      } else {
        this.showToastFn(t('没有可导入的图片文件'), 'info');
      }
    } catch (err) {
      this.showToastFn(`${t('解析失败: ')}${err}`, 'error');
    } finally {
      this.hideProgressModal();
    }
  }

  public async importBrowserFiles(files: File[]) {
    const BROWSER_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
    const imageFiles = files.filter(
      (f) => BROWSER_IMAGE_TYPES.has(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name)
    );
    if (imageFiles.length === 0) {
      this.showToastFn(t('没有可导入的图片文件'), 'info');
      return;
    }

    this.showProgressModal(t('正在解析照片 EXIF...'), `${t('共 ')}${imageFiles.length}${t('张照片')}`, 10);
    const newItems: PhotoItem[] = [];

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      try {
        const exif = await this.parseExifInBrowser(file);
        const thumb = await this.makeThumbnail(file);
        newItems.push({
          id: `browser_${file.name}_${file.size}_${file.lastModified}`,
          path: `browser://${file.name}`,
          filename: file.name,
          size_bytes: file.size,
          exif,
          thumbnail_data_url: thumb,
          sourceFile: file,
        });
      } catch (err) {
        console.warn('Browser parse error:', file.name, err);
      }
    }

    this.hideProgressModal();
    if (newItems.length > 0) {
      store.addPhotos(newItems);
      this.showToastFn(`${t('成功导入 ')}${newItems.length} ${t('张照片')}`, 'success');
    }
  }

  private async parseExifInBrowser(file: File): Promise<ExifData> {
    const exifr = await import('exifr');
    const raw: any = (await exifr.parse(file, { tiff: true, xmp: true })) || {};
    const exif: ExifData = {};

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

    const fNumber = this.exifToNumber(getTag(['FNumber'], 33437));
    if (fNumber !== undefined) exif.f_number = `f/${fNumber.toFixed(1)}`.replace('.0', '');

    const exposure = this.exifToNumber(getTag(['ExposureTime'], 33434));
    if (exposure !== undefined && exposure > 0) {
      exif.exposure_time = exposure >= 1 ? `${exposure.toFixed(1)}s` : `1/${Math.round(1 / exposure)}s`;
    }

    const iso = this.exifToNumber(getTag(['ISO', 'PhotographicSensitivity'], 34855));
    if (iso !== undefined) exif.iso = `ISO ${iso}`;

    const focal = this.exifToNumber(getTag(['FocalLength'], 37386));
    if (focal !== undefined) exif.focal_length = `${focal.toFixed(0)}mm`;

    const focal35 = this.exifToNumber(getTag(['FocalLengthIn35mmFormat', 'FocalLengthIn35mmFilm'], 41989));
    if (focal35 !== undefined) exif.focal_length_35mm = `${focal35.toFixed(0)}mm`;

    const dt = getTag(['DateTimeOriginal'], 36867);
    if (dt) exif.datetime = String(dt);

    return exif;
  }

  private exifToNumber(v: any): number | undefined {
    if (typeof v === 'number') return v;
    if (Array.isArray(v) && v.length >= 2) {
      const num = Number(v[0]);
      const den = Number(v[1]);
      return den ? num / den : undefined;
    }
    return undefined;
  }

  private async makeThumbnail(file: File): Promise<string> {
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = url;
    });
    const maxSide = 512;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')?.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    img.src = '';
    return c.toDataURL('image/jpeg', 0.82);
  }

  public persistSession() {
    if (!isTauri()) return;
    try {
      const paths = store.photos.map((p) => p.path).filter((p) => !p.startsWith('browser://'));
      localStorage.setItem(SESSION_KEY, JSON.stringify({ paths, activeIndex: store.activeIndex }));
    } catch {
      // ignore
    }
  }

  public async restoreLastSession() {
    if (!isTauri()) return;
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
      this.showProgressModal('正在恢复上次会话...', `共 ${paths.length} 张照片`, 5);
      const items: PhotoItem[] = await invoke('load_photos', { paths });
      if (items.length > 0) {
        store.setPhotos(items);
        const savedIdx = Math.max(0, Math.min(items.length - 1, saved?.activeIndex ?? 0));
        store.setActiveIndex(savedIdx);
      }
    } catch {
      // best-effort
    } finally {
      this.hideProgressModal();
    }
  }

  public async loadSystemFontsIntoSelect() {
    try {
      const select = document.getElementById('cfg-font-family') as HTMLSelectElement | null;
      if (!select) return;
      const families: string[] = await invoke('list_system_fonts');
      if (!Array.isArray(families) || families.length === 0) return;

      const bundled = new Set(['Noto Sans SC', 'Noto Serif SC', 'Brass Mono']);
      const optgroup = document.createElement('optgroup');
      optgroup.label = t('系统字体');

      for (const f of families) {
        if (bundled.has(f)) continue;
        const opt = document.createElement('option');
        opt.value = f;
        opt.textContent = f;
        optgroup.appendChild(opt);
      }
      select.appendChild(optgroup);
      select.value = store.globalConfig.fontFamily || 'Noto Sans SC';
    } catch {
      // ignore
    }
  }

  private showProgressModal(title: string, status: string, percent: number) {
    const modal = document.getElementById('progress-modal');
    const titleEl = document.getElementById('progress-title');
    const statusEl = document.getElementById('progress-status');
    const percentEl = document.getElementById('progress-percent');
    const fillEl = document.getElementById('progress-fill');

    if (modal) modal.style.display = 'flex';
    if (titleEl) titleEl.textContent = title;
    if (statusEl) statusEl.textContent = status;
    if (percentEl) percentEl.textContent = `${percent}%`;
    if (fillEl) fillEl.style.width = `${percent}%`;
  }

  private hideProgressModal() {
    const modal = document.getElementById('progress-modal');
    if (modal) modal.style.display = 'none';
  }
}
