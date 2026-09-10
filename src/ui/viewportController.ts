import { store } from '../state/store';
import { renderPhotoFrame } from '../renderer/canvasRenderer';
import { thumbnailSrc, isTauri } from '../types';
import { convertFileSrc } from '@tauri-apps/api/core';

export class ViewportController {
  private previewCanvas: HTMLCanvasElement;
  private canvasContainer: HTMLDivElement;
  private viewportEl: HTMLDivElement | null;
  private zoomLevelEl: HTMLSpanElement | null;
  private compareBtn: HTMLButtonElement | null;

  public currentZoom = 1.0;
  public panX = 0;
  public panY = 0;
  public isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private isComparing = false;

  private previewImageCache: Map<string, HTMLImageElement> = new Map();
  private renderTimer: any = null;

  constructor() {
    this.previewCanvas = document.getElementById('preview-canvas') as HTMLCanvasElement;
    this.canvasContainer = document.getElementById('canvas-container') as HTMLDivElement;
    this.viewportEl = document.getElementById('viewport-area') as HTMLDivElement | null;
    this.zoomLevelEl = document.getElementById('zoom-level') as HTMLSpanElement | null;
    this.compareBtn = document.getElementById('btn-compare-original') as HTMLButtonElement | null;

    this.bindEvents();
    window.addEventListener('resize', () => this.applyPreviewFit());
  }

  private bindEvents() {
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => this.zoomStep(0.15));
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => this.zoomStep(-0.15));
    document.getElementById('btn-zoom-fit')?.addEventListener('click', () => this.resetZoomAndPan());

    // Wheel zoom & pan
    this.viewportEl?.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        this.zoomStep(delta);
      } else {
        this.panX -= e.deltaX;
        this.panY -= e.deltaY;
        this.applyTransform();
      }
    }, { passive: false });

    // Drag to pan
    this.viewportEl?.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target === this.compareBtn) return;
      this.isPanning = true;
      this.panStartX = e.clientX - this.panX;
      this.panStartY = e.clientY - this.panY;
      if (this.viewportEl) this.viewportEl.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isPanning) return;
      this.panX = e.clientX - this.panStartX;
      this.panY = e.clientY - this.panStartY;
      this.applyTransform();
    });

    window.addEventListener('mouseup', () => {
      if (!this.isPanning) return;
      this.isPanning = false;
      if (this.viewportEl) this.viewportEl.style.cursor = 'default';
    });

    // Compare button
    if (this.compareBtn) {
      this.compareBtn.addEventListener('mousedown', () => this.startComparing());
      window.addEventListener('mouseup', () => {
        if (this.isComparing) this.stopComparing();
      });
    }
  }

  public zoomStep(delta: number) {
    let next = Math.max(0.2, Math.min(4.0, this.currentZoom + delta));
    this.setZoom(next);
  }

  public setZoom(val: number) {
    this.currentZoom = val;
    if (this.currentZoom <= 1.01) {
      this.panX = 0;
      this.panY = 0;
    }
    this.applyTransform();
    if (this.zoomLevelEl) {
      this.zoomLevelEl.textContent = `${Math.round(this.currentZoom * 100)}%`;
    }
  }

  public resetZoomAndPan() {
    this.panX = 0;
    this.panY = 0;
    this.setZoom(1.0);
    this.applyPreviewFit();
  }

  public applyTransform() {
    this.canvasContainer.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.currentZoom})`;
  }

  public applyPreviewFit() {
    if (!this.viewportEl || !this.previewCanvas) return;
    const cs = getComputedStyle(this.viewportEl);
    const availH = this.viewportEl.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const availW = this.viewportEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    this.previewCanvas.style.maxHeight = `${Math.max(120, Math.floor(availH))}px`;
    this.previewCanvas.style.maxWidth = `${Math.max(120, Math.floor(availW))}px`;
  }

  public triggerRender() {
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => this.doRender(), 30);
  }

  public async doRender() {
    const photo = store.getActivePhoto();
    if (!photo) {
      this.clear();
      return;
    }

    this.canvasContainer.style.display = 'flex';
    let img = this.previewImageCache.get(photo.path);

    if (!img) {
      img = new Image();
      const loaded = await new Promise<boolean>((res) => {
        img!.onload = () => res(true);
        img!.onerror = () => res(false);
        setTimeout(() => res(false), 10000);
        img!.src = thumbnailSrc(photo, isTauri() ? convertFileSrc : undefined);
      });
      if (!loaded) return;
      this.previewImageCache.set(photo.path, img);
      if (this.previewImageCache.size > 16) {
        const oldest = this.previewImageCache.keys().next().value;
        if (oldest !== undefined && oldest !== photo.path) {
          this.previewImageCache.delete(oldest);
        }
      }
    }

    const config = store.getActiveConfig();
    await renderPhotoFrame(img, photo.exif, config, this.previewCanvas);
    this.applyPreviewFit();
  }

  public clear() {
    const ctx = this.previewCanvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
      this.previewCanvas.width = 0;
      this.previewCanvas.height = 0;
    }
    this.canvasContainer.style.display = 'none';
  }

  public startComparing() {
    const photo = store.getActivePhoto();
    if (!photo) return;
    const img = this.previewImageCache.get(photo.path);
    const ctx = this.previewCanvas.getContext('2d');
    if (!img || !ctx) return;
    this.isComparing = true;
    this.previewCanvas.width = img.naturalWidth || img.width;
    this.previewCanvas.height = img.naturalHeight || img.height;
    ctx.drawImage(img, 0, 0, this.previewCanvas.width, this.previewCanvas.height);
  }

  public stopComparing() {
    if (!this.isComparing) return;
    this.isComparing = false;
    this.doRender();
  }
}
