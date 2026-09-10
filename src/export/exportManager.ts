import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { store } from '../state/store';
import { PhotoItem, isTauri } from '../types';
import { renderPhotoFrame } from '../renderer/canvasRenderer';
import { t } from '../i18n';

export class ExportManager {
  private showToastFn: (msg: string, type?: 'success' | 'error' | 'info', action?: { label: string; onClick: () => void }) => void;
  private exportCancelled = false;

  constructor(showToastFn: (msg: string, type?: 'success' | 'error' | 'info', action?: { label: string; onClick: () => void }) => void) {
    this.showToastFn = showToastFn;
    this.bindEvents();
  }

  private bindEvents() {
    document.getElementById('btn-export-current')?.addEventListener('click', () => this.exportCurrent());
    document.getElementById('btn-batch-export')?.addEventListener('click', () => this.batchExport());
    document.getElementById('btn-progress-cancel')?.addEventListener('click', () => {
      this.exportCancelled = true;
      this.hideProgressModal();
    });
  }

  public async exportCurrent() {
    const photo = store.getActivePhoto();
    if (!photo) {
      this.showToastFn(t('当前没有选中任何照片'), 'info');
      return;
    }

    if (!isTauri()) {
      await this.exportCurrentBrowser(photo);
      return;
    }

    const { format, quality } = store.exportSettings;
    const ext = format === 'jpeg' ? 'jpg' : format;
    const defaultName = this.buildOutputName(photo, store.activeIndex);

    try {
      const savePath = await save({
        defaultPath: defaultName,
        filters: [{ name: 'Image', extensions: [ext] }],
      });
      if (!savePath) return;

      this.showProgressModal(t('正在导出照片...'), t('正在读取原片...'), 25);

      let fullImg: HTMLImageElement | null = await this.loadFullImage(photo);
      this.showProgressModal(t('正在渲染照片...'), t('正在生成相框...'), 60);

      const exportCanvas = document.createElement('canvas');
      const config = store.getActiveConfig();
      await renderPhotoFrame(fullImg, photo.exif, config, exportCanvas);

      // Clean up original image from memory immediately
      fullImg.src = '';
      fullImg = null;

      this.showProgressModal(
        t('正在编码与写入文件...'),
        `${t('分辨率: ')}${exportCanvas.width} × ${exportCanvas.height}`,
        85
      );

      const binaryData = await this.canvasToUint8Array(exportCanvas, format, quality);

      // Call binary Tauri command with source_path for EXIF/ICC preservation!
      await invoke('save_rendered_photo_binary', {
        outputPath: savePath,
        data: Array.from(binaryData),
        format,
        quality,
        sourcePath: photo.path,
      });

      this.showToastFn(
        `${t('已保存 (')}${exportCanvas.width}×${exportCanvas.height}): ${savePath}`,
        'success',
        {
          label: t('打开所在文件夹'),
          onClick: () => {
            revealItemInDir(savePath).catch((err) => this.showToastFn(`${t('打开文件夹失败: ')}${err}`, 'error'));
          },
        }
      );
    } catch (err) {
      this.showToastFn(`${t('导出失败: ')}${err}`, 'error');
    } finally {
      this.hideProgressModal();
    }
  }

  public async batchExport() {
    const photos = store.photos;
    if (photos.length === 0) {
      this.showToastFn(t('列表为空，请先添加照片'), 'info');
      return;
    }

    if (!isTauri()) {
      await this.batchExportBrowser();
      return;
    }

    const outputDir = await open({ directory: true, multiple: false });
    if (!outputDir || typeof outputDir !== 'string') return;

    const { format, quality } = store.exportSettings;
    const failures: { filename: string; error: string }[] = [];
    let successCount = 0;
    this.exportCancelled = false;

    try {
      this.showProgressModal(t('准备批量导出...'), `${t('共 ')}${photos.length}${t('张照片')}`, 5, true);
      const cancelBtn = document.getElementById('btn-progress-cancel');
      if (cancelBtn) cancelBtn.style.display = 'block';

      const exportCanvas = document.createElement('canvas');

      for (let i = 0; i < photos.length; i++) {
        if (this.exportCancelled) {
          this.showToastFn(`${t('已取消导出，完成 ')}${successCount} / ${photos.length} ${t('张')}`, 'info');
          return;
        }

        const item = photos[i];
        this.showProgressModal(
          t('正在渲染照片...'),
          `(${i + 1}/${photos.length}) ${item.filename}`,
          Math.round(((i + 1) / photos.length) * 65),
          true
        );

        let fullImg: HTMLImageElement | null = null;
        try {
          fullImg = await this.loadFullImage(item);
          // Get per-photo effective config
          const config = item.configOverride ? { ...store.globalConfig, ...item.configOverride } : store.globalConfig;
          await renderPhotoFrame(fullImg, item.exif, config, exportCanvas);

          // Promptly release image handle
          fullImg.src = '';
          fullImg = null;

          const outName = this.buildOutputName(item, i);
          const outPath = await this.resolveUniqueOutputPath(outputDir, outName);

          this.showProgressModal(
            t('正在写入文件...'),
            `(${i + 1}/${photos.length}) ${item.filename}`,
            70 + Math.round(((i + 1) / photos.length) * 25),
            true
          );

          const binaryData = await this.canvasToUint8Array(exportCanvas, format, quality);

          await invoke('save_rendered_photo_binary', {
            outputPath: outPath,
            data: Array.from(binaryData),
            format,
            quality,
            sourcePath: item.path,
          });

          successCount++;
        } catch (err) {
          if (fullImg) {
            fullImg.src = '';
            fullImg = null;
          }
          failures.push({ filename: item.filename, error: String(err) });
        }
      }

      if (this.exportCancelled) {
        this.showToastFn(`${t('已取消导出，完成 ')}${successCount} / ${photos.length} ${t('张')}`, 'info');
        return;
      }

      if (failures.length === 0) {
        this.showToastFn(`${t('批量导出完成: ')}${successCount} / ${photos.length} ${t('张')}`, 'success', {
          label: t('打开所在文件夹'),
          onClick: () => {
            revealItemInDir(outputDir).catch((err) => this.showToastFn(`${t('打开文件夹失败: ')}${err}`, 'error'));
          },
        });
      } else {
        this.showToastFn(`${t('部分照片导出失败')}: ${successCount} 成功, ${failures.length} 失败`, 'error');
      }
    } catch (err) {
      this.showToastFn(`${t('批量导出失败: ')}${err}`, 'error');
    } finally {
      this.hideProgressModal();
    }
  }

  private async exportCurrentBrowser(item: PhotoItem) {
    if (!item.sourceFile) {
      this.showToastFn(t('文件句柄缺失，请重新导入'), 'error');
      return;
    }
    const { format, quality } = store.exportSettings;
    const defaultName = this.buildOutputName(item, store.activeIndex);

    try {
      this.showProgressModal(t('正在导出照片...'), t('正在读取原片...'), 25);
      const img = await this.loadImageFromFile(item.sourceFile);
      const canvas = document.createElement('canvas');
      const config = store.getActiveConfig();
      await renderPhotoFrame(img, item.exif, config, canvas);

      img.src = '';

      const blob = await this.canvasToBlob(canvas, format, quality);
      if (blob) this.downloadBlob(blob, defaultName);
      this.showToastFn(`${t('已保存 (')}${canvas.width}×${canvas.height}): ${defaultName}`, 'success');
    } catch (err) {
      this.showToastFn(`${t('导出失败: ')}${err}`, 'error');
    } finally {
      this.hideProgressModal();
    }
  }

  private async batchExportBrowser() {
    const photos = store.photos;
    const { format, quality } = store.exportSettings;
    let ok = 0;
    this.showProgressModal(t('准备批量导出...'), `${t('共 ')}${photos.length}${t('张照片')}`, 5);

    try {
      for (let i = 0; i < photos.length; i++) {
        const item = photos[i];
        if (!item.sourceFile) continue;
        const img = await this.loadImageFromFile(item.sourceFile);
        const canvas = document.createElement('canvas');
        const config = item.configOverride ? { ...store.globalConfig, ...item.configOverride } : store.globalConfig;
        await renderPhotoFrame(img, item.exif, config, canvas);
        img.src = '';

        const blob = await this.canvasToBlob(canvas, format, quality);
        const outName = this.buildOutputName(item, i);
        if (blob) this.downloadBlob(blob, outName);
        ok++;
        await new Promise((r) => setTimeout(r, 200));
      }
      this.showToastFn(`${t('批量导出完成: ')}${ok} / ${photos.length} ${t('张')}`, 'success');
    } catch (err) {
      this.showToastFn(`${t('批量导出失败: ')}${err}`, 'error');
    } finally {
      this.hideProgressModal();
    }
  }

  private async loadFullImage(item: PhotoItem): Promise<HTMLImageElement> {
    const ext = (item.filename.split('.').pop() || '').toLowerCase();
    if (isTauri() && ['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = convertFileSrc(item.path);
        await Promise.race([
          new Promise((res, rej) => {
            img.onload = () => res(null);
            img.onerror = () => rej(new Error('asset load failed'));
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('asset timeout')), 8000)),
        ]);
        return img;
      } catch {
        // fallback to Rust load
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

  private loadImageFromFile(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(t('无法解码图片')));
      };
      img.src = url;
    });
  }

  private async canvasToUint8Array(
    canvas: HTMLCanvasElement,
    format: 'jpeg' | 'png' | 'webp',
    quality: number
  ): Promise<Uint8Array> {
    const blob = await this.canvasToBlob(canvas, format, quality);
    if (!blob) throw new Error('画布编码失败');
    const buffer = await blob.arrayBuffer();
    return new Uint8Array(buffer);
  }

  private canvasToBlob(canvas: HTMLCanvasElement, format: string, quality: number): Promise<Blob | null> {
    const mime = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
    return new Promise((resolve) => canvas.toBlob(resolve, mime, quality / 100));
  }

  private downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  public buildOutputName(item: PhotoItem, index: number): string {
    const template = store.exportSettings.filenameTemplate || '{filename}_framed';
    const baseName = item.filename.replace(/\.[^/.]+$/, '');
    const ext = store.exportSettings.format === 'jpeg' ? 'jpg' : store.exportSettings.format;

    const sanitize = (val: string) => val.replace(/[\\/:*?"<>|]/g, '_').trim();
    const dateFormatted = item.exif.datetime ? item.exif.datetime.replace(/:/g, '-').replace(/\s+/g, '_') : '';

    const vars: Record<string, string> = {
      '{filename}': baseName,
      '{model}': sanitize(item.exif.model || ''),
      '{make}': sanitize(item.exif.make || ''),
      '{lens}': sanitize(item.exif.lens_model || ''),
      '{date}': sanitize(dateFormatted),
      '{index}': String(index + 1),
      '{width}': String(item.exif.width || ''),
      '{height}': String(item.exif.height || ''),
    };

    let result = template;
    for (const [k, v] of Object.entries(vars)) {
      result = result.split(k).join(v);
    }
    result = sanitize(result);
    return `${result || baseName + '_framed'}.${ext}`;
  }

  public async resolveUniqueOutputPath(outputDir: string, filename: string): Promise<string> {
    return await invoke('resolve_unique_path', { outputDir, filename });
  }

  private showProgressModal(title: string, status: string, percent: number, showCancel = false) {
    const modal = document.getElementById('progress-modal');
    const titleEl = document.getElementById('progress-title');
    const statusEl = document.getElementById('progress-status');
    const percentEl = document.getElementById('progress-percent');
    const fillEl = document.getElementById('progress-fill');
    const cancelBtn = document.getElementById('btn-progress-cancel');

    if (modal) modal.style.display = 'flex';
    if (titleEl) titleEl.textContent = title;
    if (statusEl) statusEl.textContent = status;
    if (percentEl) percentEl.textContent = `${percent}%`;
    if (fillEl) fillEl.style.width = `${percent}%`;
    if (cancelBtn) cancelBtn.style.display = showCancel ? 'block' : 'none';
  }

  private hideProgressModal() {
    const modal = document.getElementById('progress-modal');
    if (modal) modal.style.display = 'none';
  }
}
