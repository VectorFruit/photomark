import { FrameConfig } from '../types';
import { store } from '../state/store';
import { t } from '../i18n';

const PRESETS_KEY = 'photomark_presets';

export const BUILT_IN_PRESETS: { name: string; config: Partial<FrameConfig> }[] = [
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
  {
    name: '居中大标',
    config: { template: 'center_brand', backgroundType: 'white', paddingPercent: 6, bottomBarHeightPercent: 14 },
  },
  {
    name: '电影宽银幕',
    config: {
      template: 'cinematic',
      backgroundType: 'dark',
      cineMetaText: '180.0° · 24 FPS',
      showSoundTrack: true,
      showFilmGrain: true,
    },
  },
  {
    name: '复古胶卷',
    config: {
      template: 'film_roll',
      backgroundType: 'dark',
      filmFrameNo: '24A',
      filmExp: '24 · 36 EXP',
      filmCode: '5063',
      showDxBarcode: true,
      showNeighborFrames: true,
      showLightLeak: true,
      showDateStamp: true,
    },
  },
  {
    name: '中画幅胶片',
    config: {
      template: 'medium_format',
      backgroundType: 'dark',
      paddingPercent: 6,
      filmSimulation: 'KODAK TRI-X 400',
      filmFrameNo: '07',
      showDateStamp: true,
    },
  },
  {
    name: '画廊典藏展签',
    config: {
      template: 'museum_matte',
      backgroundType: 'white',
      paddingPercent: 7,
      fontFamily: 'Noto Serif SC',
      shadowRadius: 20,
    },
  },
  {
    name: '现代街拍配方',
    config: {
      template: 'street_split',
      backgroundType: 'dark',
      paddingPercent: 5,
      bottomBarHeightPercent: 12,
      filmSimulation: 'Classic Chrome',
    },
  },
  {
    name: '反转片幻灯夹',
    config: {
      template: 'slide_mount',
      backgroundType: 'white',
      paddingPercent: 6,
      filmSimulation: 'Velvia 50',
    },
  },
];

export class PresetController {
  private grid: HTMLDivElement | null;
  private saveRow: HTMLDivElement | null;
  private nameInput: HTMLInputElement | null;
  private showToastFn: (msg: string, type?: 'success' | 'error' | 'info') => void;

  constructor(showToastFn: (msg: string, type?: 'success' | 'error' | 'info') => void) {
    this.showToastFn = showToastFn;
    this.grid = document.getElementById('preset-grid') as HTMLDivElement | null;
    this.saveRow = document.getElementById('preset-save-row') as HTMLDivElement | null;
    this.nameInput = document.getElementById('preset-name-input') as HTMLInputElement | null;

    this.bindEvents();
    this.render();
  }

  public getCustomPresets(): { name: string; config: FrameConfig }[] {
    try {
      const raw = localStorage.getItem(PRESETS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.slice(0, 24) : [];
    } catch {
      return [];
    }
  }

  public saveCustomPresets(list: { name: string; config: FrameConfig }[]) {
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
    } catch {
      // ignore
    }
  }

  public applyPreset(presetConfig: Partial<FrameConfig>, name: string) {
    store.updateActiveConfig(presetConfig);
    this.showToastFn(t('已应用预设「{name}」', { name }), 'success');
  }

  public exportPresets() {
    const list = this.getCustomPresets();
    if (list.length === 0) {
      this.showToastFn('当前没有已保存的自定义预设', 'info');
      return;
    }
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(list, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `photomark_presets_${Date.now()}.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
    this.showToastFn('预设导出成功', 'success');
  }

  public importPresets(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const imported = JSON.parse(content);
        if (!Array.isArray(imported)) {
          throw new Error('格式错误');
        }
        const current = this.getCustomPresets();
        // Merge by name
        for (const item of imported) {
          if (item && item.name && item.config) {
            const existingIdx = current.findIndex((c) => c.name === item.name);
            if (existingIdx >= 0) {
              current[existingIdx] = item;
            } else {
              current.push(item);
            }
          }
        }
        this.saveCustomPresets(current);
        this.render();
        this.showToastFn('预设导入成功', 'success');
      } catch (err) {
        this.showToastFn('预设文件格式不正确: ' + err, 'error');
      }
    };
    reader.readAsText(file);
  }

  public render() {
    if (!this.grid) return;
    this.grid.innerHTML = '';

    // 1. Built-in presets
    BUILT_IN_PRESETS.forEach((preset) => {
      const btn = document.createElement('button');
      btn.className = 'preset-chip';
      btn.textContent = t(preset.name);
      btn.onclick = () => this.applyPreset(preset.config, preset.name);
      this.grid!.appendChild(btn);
    });

    // 2. User-saved custom presets
    const customList = this.getCustomPresets();
    customList.forEach((preset, idx) => {
      const chip = document.createElement('span');
      chip.className = 'preset-chip preset-custom';

      const label = document.createElement('span');
      label.textContent = preset.name;
      label.style.cursor = 'pointer';
      label.onclick = () => this.applyPreset(preset.config, preset.name);

      const del = document.createElement('button');
      del.className = 'preset-delete';
      del.title = t('删除');
      del.textContent = '×';
      del.onclick = (e) => {
        e.stopPropagation();
        customList.splice(idx, 1);
        this.saveCustomPresets(customList);
        this.render();
        this.showToastFn(t('已移除 {name}', { name: preset.name }), 'info');
      };

      chip.appendChild(label);
      chip.appendChild(del);
      this.grid!.appendChild(chip);
    });
  }

  private bindEvents() {
    const saveBtn = document.getElementById('btn-preset-save');
    const confirmBtn = document.getElementById('btn-preset-save-confirm');
    const cancelBtn = document.getElementById('btn-preset-save-cancel');
    const exportBtn = document.getElementById('btn-preset-export');
    const importBtn = document.getElementById('btn-preset-import');
    const importFileInput = document.getElementById('preset-file-input') as HTMLInputElement | null;

    saveBtn?.addEventListener('click', () => {
      if (!this.saveRow || !this.nameInput) return;
      this.saveRow.style.display = 'flex';
      this.nameInput.value = '';
      this.nameInput.focus();
    });

    cancelBtn?.addEventListener('click', () => {
      if (this.saveRow) this.saveRow.style.display = 'none';
    });

    confirmBtn?.addEventListener('click', () => {
      if (!this.nameInput || !this.saveRow) return;
      const name = this.nameInput.value.trim();
      if (!name) {
        this.showToastFn('请输入预设名称', 'info');
        return;
      }
      const list = this.getCustomPresets();
      const currentConfig = store.getActiveConfig();
      const existingIdx = list.findIndex((p) => p.name === name);
      if (existingIdx >= 0) {
        list[existingIdx].config = JSON.parse(JSON.stringify(currentConfig));
      } else {
        list.push({ name, config: JSON.parse(JSON.stringify(currentConfig)) });
      }
      this.saveCustomPresets(list);
      this.saveRow.style.display = 'none';
      this.render();
      this.showToastFn(t('已保存预设「{name}」', { name }), 'success');
    });

    exportBtn?.addEventListener('click', () => this.exportPresets());
    importBtn?.addEventListener('click', () => importFileInput?.click());
    importFileInput?.addEventListener('change', () => {
      const file = importFileInput.files?.[0];
      if (file) {
        this.importPresets(file);
        importFileInput.value = '';
      }
    });
  }
}
