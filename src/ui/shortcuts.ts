export class ShortcutsController {
  private modalEl: HTMLDivElement | null;
  private onExport: () => void;
  private onPrevPhoto: () => void;
  private onNextPhoto: () => void;
  private onDeleteCurrent: () => void;
  private onZoomIn: () => void;
  private onZoomOut: () => void;
  private onZoomFit: () => void;
  private onStartCompare: () => void;
  private onStopCompare: () => void;

  constructor(options: {
    onExport: () => void;
    onPrevPhoto: () => void;
    onNextPhoto: () => void;
    onDeleteCurrent: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onZoomFit: () => void;
    onStartCompare: () => void;
    onStopCompare: () => void;
  }) {
    this.modalEl = document.getElementById('shortcuts-modal') as HTMLDivElement | null;
    this.onExport = options.onExport;
    this.onPrevPhoto = options.onPrevPhoto;
    this.onNextPhoto = options.onNextPhoto;
    this.onDeleteCurrent = options.onDeleteCurrent;
    this.onZoomIn = options.onZoomIn;
    this.onZoomOut = options.onZoomOut;
    this.onZoomFit = options.onZoomFit;
    this.onStartCompare = options.onStartCompare;
    this.onStopCompare = options.onStopCompare;

    this.bindEvents();
  }

  public toggleModal(show?: boolean) {
    if (!this.modalEl) return;
    const isVisible = this.modalEl.style.display !== 'none';
    const target = show !== undefined ? show : !isVisible;
    this.modalEl.style.display = target ? 'flex' : 'none';
  }

  private bindEvents() {
    document.getElementById('btn-shortcuts')?.addEventListener('click', () => this.toggleModal());
    document.getElementById('btn-shortcuts-close')?.addEventListener('click', () => this.toggleModal(false));

    window.addEventListener('keydown', (e) => {
      // Ignore shortcut if user is typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
        return;
      }

      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        this.toggleModal();
      } else if (e.key === 'Escape') {
        this.toggleModal(false);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.onPrevPhoto();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.onNextPhoto();
      } else if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        this.onStartCompare();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        this.onZoomFit();
      } else if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        this.onZoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        this.onZoomOut();
      } else if (e.key === 'e' || e.key === 'E') {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          this.onExport();
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.onDeleteCurrent();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') {
        e.preventDefault();
        this.onStopCompare();
      }
    });
  }
}
