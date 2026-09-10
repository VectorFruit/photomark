import { store } from '../state/store';
import { thumbnailSrc, isTauri } from '../types';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getStoredLang } from '../i18n';

export class PhotoListController {
  private photoListEl: HTMLDivElement;
  private photoCountEl: HTMLSpanElement;
  private emptyQueueEl: HTMLDivElement;
  private dragFromIndex = -1;

  constructor() {
    this.photoListEl = document.getElementById('photo-list') as HTMLDivElement;
    this.photoCountEl = document.getElementById('photo-count') as HTMLSpanElement;
    this.emptyQueueEl = document.getElementById('empty-queue') as HTMLDivElement;

    this.bindEvents();
    store.subscribe((e) => {
      if (e.type === 'photos_changed' || e.type === 'active_index_changed') {
        this.render();
      }
    });
  }

  private bindEvents() {
    const navPrev = document.getElementById('btn-prev-photo');
    const navNext = document.getElementById('btn-next-photo');

    navPrev?.addEventListener('click', () => this.switchPhoto(-1));
    navNext?.addEventListener('click', () => this.switchPhoto(1));
  }

  public switchPhoto(dir: number) {
    if (store.photos.length <= 1) return;
    let next = store.activeIndex + dir;
    if (next < 0) next = store.photos.length - 1;
    if (next >= store.photos.length) next = 0;
    store.setActiveIndex(next);
  }

  public render() {
    const photos = store.photos;
    const activeIndex = store.activeIndex;

    this.photoCountEl.textContent = String(photos.length);
    this.emptyQueueEl.style.display = photos.length === 0 ? 'flex' : 'none';

    const navPrev = document.getElementById('btn-prev-photo');
    const navNext = document.getElementById('btn-next-photo');
    const showNav = photos.length > 1 ? 'flex' : 'none';
    if (navPrev) navPrev.style.display = showNav;
    if (navNext) navNext.style.display = showNav;

    this.photoListEl.innerHTML = '';

    photos.forEach((photo, idx) => {
      const card = document.createElement('div');
      card.className = 'photo-card ' + (idx === activeIndex ? 'active' : '');
      card.draggable = true;
      card.dataset.index = String(idx);

      const thumb = document.createElement('img');
      thumb.className = 'photo-thumb';
      thumb.src = thumbnailSrc(photo, isTauri() ? convertFileSrc : undefined);

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
      const overrideTag = photo.configOverride ? ' [独立配置]' : '';
      badge.textContent = camera + lens + dims + overrideTag;

      meta.appendChild(name);
      meta.appendChild(badge);

      const delBtn = document.createElement('button');
      delBtn.className = 'photo-remove';
      delBtn.innerHTML = '✕';
      delBtn.onclick = (e) => {
        e.stopPropagation();
        store.removePhoto(idx);
      };

      card.appendChild(thumb);
      card.appendChild(meta);
      card.appendChild(delBtn);

      card.addEventListener('dragstart', () => {
        this.dragFromIndex = idx;
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        card.classList.remove('drag-over');
        this.dragFromIndex = -1;
      });
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        card.classList.add('drag-over');
      });
      card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');
        if (this.dragFromIndex < 0 || this.dragFromIndex === idx) return;
        const list = [...store.photos];
        const moved = list.splice(this.dragFromIndex, 1)[0];
        list.splice(idx, 0, moved);

        let newActive = store.activeIndex;
        if (newActive === this.dragFromIndex) newActive = idx;
        else if (this.dragFromIndex < newActive && idx >= newActive) newActive--;
        else if (this.dragFromIndex > newActive && idx <= newActive) newActive++;

        this.dragFromIndex = -1;
        store.photos = list;
        store.setActiveIndex(newActive);
      });

      card.onclick = () => {
        store.setActiveIndex(idx);
      };

      this.photoListEl.appendChild(card);
    });
  }
}
