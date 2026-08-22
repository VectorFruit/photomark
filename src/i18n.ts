export type Lang = 'zh' | 'en';

const STORAGE_KEY = 'photomark_lang';

const zhToEn: Record<string, string> = {
  '两者同时显示 (实际+等效)': 'Show both (actual + equivalent)',
  '镜头实际物理焦距 (默认)': 'Physical focal length (default)',
  '导出保持原分辨率；JPEG 质量在上方选择。': 'Exports at original resolution; choose JPEG quality above.',
  '取消当前任务': 'Cancel current task',
  '恢复所有参数为默认配置': 'Reset all settings to defaults',
  '正在编码与写入文件...': 'Encoding & writing file...',
  '正在读取文件列表...': 'Reading file list...',
  '读取原始分辨率像素...': 'Reading full-resolution pixels...',
  '部分照片导出失败': 'Some photos failed to export',
  '没有可导入的图片文件': 'No image files to import',
  '文件句柄缺失，请重新导入': 'File handle missing, please re-import',
  '当前没有选中任何照片': 'No photo selected',
  '列表为空，请先添加照片': 'The list is empty, add photos first',
  '已重置所有参数为默认配置': 'All settings reset to defaults',
  '已取消导出，完成 ': 'Export cancelled, completed ',
  '批量导出完成: ': 'Batch export complete: ',
  '批量导出失败: ': 'Batch export failed: ',
  '正在解析照片 EXIF...': 'Parsing photo EXIF...',
  '正在导出照片...': 'Exporting photo...',
  '正在渲染照片...': 'Rendering photo...',
  '正在批量导出...': 'Batch exporting...',
  '正在写入文件...': 'Writing file...',
  '准备批量导出...': 'Preparing batch export...',
  '正在解析照片...': 'Parsing photos...',
  '正在读取文件...': 'Reading files...',
  '准备解析照片...': 'Preparing to parse photos...',
  '生成相框排版...': 'Rendering frame layout...',
  '相框与参数配置': 'Frame & settings',
  '相机与品牌 Logo': 'Camera & brand logo',
  '相框与背景质感': 'Frame & background',
  '相框细节微调': 'Frame details',
  '自定义背景色': 'Custom background color',
  '毛玻璃模糊强度': 'Blur intensity',
  '显示品牌 Logo': 'Show brand logo',
  '自定义签名 / 备注': 'Custom signature / note',
  '焦距显示方式': 'Focal length display',
  '参数显示项': 'Displayed info',
  '导出设置': 'Export settings',
  '文件名模板': 'Filename template',
  '导出当前照片': 'Export current photo',
  '批量导出全部照片': 'Export all photos',
  '照片立体阴影': 'Drop shadow',
  '按钮文本...': 'Button text...',
  '自动识别 (EXIF)': 'Auto detect (EXIF)',
  '添加照片': 'Add photos',
  '照片列表': 'Photos',
  '清空列表': 'Clear list',
  '清空': 'Clear',
  '重置全部参数': 'Reset all',
  '相框模板': 'Frame templates',
  '经典底栏': 'Classic bottom bar',
  '画廊相框': 'Gallery border',
  '拍立得即显': 'Polaroid instant',
  '极简微章': 'Minimal badge',
  '纯白相框': 'White frame',
  '深黑相框': 'Dark frame',
  '毛玻璃虚化': 'Frosted blur',
  '自定义颜色': 'Custom color',
  '相机型号': 'Camera model',
  '镜头型号': 'Lens model',
  '曝光三要素': 'Exposure trio',
  '拍摄日期': 'Date taken',
  '35mm 等效焦距': '35mm equivalent',
  '字体族': 'Font family',
  '边距留白': 'Padding',
  '字体大小': 'Font size',
  '圆角弧度': 'Corner radius',
  '画质': 'Quality',
  '导出格式': 'Format',
  '品牌图标': 'Brand icon',
  '取消任务': 'Cancel',
  '正在取消...': 'Cancelling...',
  '关闭': 'Close',
  '准备中...': 'Preparing...',
  '正在处理...': 'Processing...',
  '浅色模式': 'Light mode',
  '深色模式': 'Dark mode',
  '跟随系统': 'Follow system',
  '导入失败: ': 'Import failed: ',
  '解析失败: ': 'Parse failed: ',
  '导出失败: ': 'Export failed: ',
  '成功导入 ': 'Imported ',
  '已保存 (': 'Saved (',
  '分辨率: ': 'Resolution: ',
  '共 ': 'Total ',
  '张照片': ' photo(s)',
  '张': ' photo(s)',
  '成功 ': 'Succeeded ',
  '失败 ': 'failed ',
  '失败明细 (前 8 条)': 'Failures (first 8)',
  '无法解码图片': 'Unable to decode image',
  '已跳过': 'Skipped',
  '拖入照片或点击导入': 'Drop photos or click to import',
  '支持 JPG, JPEG, PNG, WebP, TIFF': 'Supports JPG, JPEG, PNG, WebP, TIFF',
  '缩小': 'Zoom out',
  '放大': 'Zoom in',
  '适应': 'Fit',
  '原图': 'Original',
  'UI 缩放:': 'UI Scale:',
  '100% (默认)': '100% (Default)',
  '，': ', ',
  '：': ': ',
  '可用变量: {filename} {model} {make} {lens} {date} {index} {width} {height}': 'Variables: {filename} {model} {make} {lens} {date} {index} {width} {height}',
  '例如: Photo by Alex': 'e.g. Photo by Alex',
  'Inter / 系统': 'Inter / System',
  '系统 UI / 中文': 'System UI / Chinese',
  '衬线 / 杂志': 'Serif / Editorial',
  '等宽 / 胶片': 'Mono / Film',
  '切换浅色/深色模式': 'Toggle light/dark mode',
  '调节界面整体缩放比例': 'Adjust UI scale',
  '缩小界面': 'Zoom out',
  '放大界面': 'Zoom in',
  '适应屏幕': 'Fit to screen',
  '按住查看原图': 'Hold to view original',
  '恢复默认边距': 'Reset padding',
  '恢复默认字号': 'Reset font size',
  '恢复默认圆角': 'Reset corner radius',
  '恢复默认阴影': 'Reset shadow',
  '恢复默认模糊度': 'Reset blur',
  '照片 EXIF 水印与相框': 'Photo EXIF Watermark & Frame Studio',
};

export function getStoredLang(): Lang {
  const saved = localStorage.getItem(STORAGE_KEY) as Lang | null;
  if (saved === 'zh' || saved === 'en') return saved;
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function setStoredLang(lang: Lang) {
  localStorage.setItem(STORAGE_KEY, lang);
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
}

export function translateText(input: string): string {
  if (getStoredLang() === 'zh') return input;
  const keys = Object.keys(zhToEn).sort((a, b) => b.length - a.length);
  let out = input;
  for (const key of keys) {
    if (out.includes(key)) out = out.split(key).join(zhToEn[key]);
  }
  return out;
}

const originalText = new WeakMap<Text, string>();
const originalAttrs = new WeakMap<Element, Map<string, string>>();

export function applyLanguage() {
  const lang = getStoredLang();
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.title = lang === 'en' ? zhToEn['照片 EXIF 水印与相框'] : 'PhotoMark - 照片 EXIF 水印与相框';

  const skip = document.getElementById('select-language');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (skip && node.parentElement && skip.contains(node.parentElement)) continue;
    if (!originalText.has(node)) originalText.set(node, node.nodeValue || '');
    const original = originalText.get(node)!;
    node.nodeValue = lang === 'en' ? translateText(original) : original;
  }

  const attrs = Array.from(document.querySelectorAll<HTMLElement>('[placeholder], [title]'));
  for (const el of attrs) {
    if (skip && skip.contains(el)) continue;
    let map = originalAttrs.get(el);
    if (!map) {
      map = new Map<string, string>();
      originalAttrs.set(el, map);
    }
    for (const attr of ['placeholder', 'title'] as const) {
      const current = el.getAttribute(attr);
      if (current === null) continue;
      if (!map.has(attr)) map.set(attr, current);
      const original = map.get(attr)!;
      el.setAttribute(attr, lang === 'en' ? translateText(original) : original);
    }
  }
}