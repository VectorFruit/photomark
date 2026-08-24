import { D_GLYPHS, Z_GLYPHS, NIKON_OFFICIAL_MODELS } from './nikonGlyphsData';

export interface NikonModelMatch {
  officialName: string;
  system: 'd' | 'z';
}

const imageCache: Map<string, HTMLImageElement> = new Map();

/**
 * 判断当前 EXIF 数据是否来自 Nikon 相机
 */
export function isNikonCamera(make?: string, model?: string): boolean {
  const text = `${make || ''} ${model || ''}`.trim().toLowerCase();
  return text.includes('nikon');
}

/**
 * 标准化并解析 Nikon 相机型号
 * 若机型不在官方支持库内（例如 COOLPIX 系列、Nikon 1 微单等），则返回 null 触发纯文本 fallback
 */
export function resolveNikonModel(rawModel?: string, rawMake?: string): NikonModelMatch | null {
  if (!rawModel && !rawMake) return null;

  let text = (rawModel || '').trim();
  if (!text && rawMake) text = rawMake.trim();

  // 去除常见品牌前缀
  text = text.replace(/^NIKON\s+/i, '').replace(/^NIKON_CORPORATION\s+/i, '').trim();

  // 标准化 EXIF 固件中的世代标识 (如 Z 6_2 -> Z 6II, Z 7_2 -> Z 7II, Z 6_3 -> Z 6III)
  text = text
    .replace(/_2$/i, 'II')
    .replace(/_3$/i, 'III')
    .replace(/_II$/i, 'II')
    .replace(/_III$/i, 'III')
    .replace(/\s+II$/i, 'II')
    .replace(/\s+III$/i, 'III');

  const normKey = text.replace(/[\s_\-]/g, '').toLowerCase();

  // 1. 匹配 Z 系列微单官方白名单
  for (const z of NIKON_OFFICIAL_MODELS.z_series_mirrorless) {
    const zNorm = z.replace(/[\s_\-]/g, '').toLowerCase();
    if (normKey === zNorm) {
      return { officialName: z, system: 'z' };
    }
  }

  // 2. 匹配 D 系列单反官方白名单
  for (const d of NIKON_OFFICIAL_MODELS.d_series_dslr) {
    const dNorm = d.replace(/[\s_\-]/g, '').toLowerCase();
    if (normKey === dNorm) {
      return { officialName: d, system: 'd' };
    }
  }

  // 3. 不在支持名单中（如 COOLPIX P1000, Nikon 1 J5 等），返回 null 走默认纯文本逻辑
  return null;
}

/**
 * 拼装 D 系列单反型号矢量 SVG
 */
export function composeNikonD(modelName: string, fillColor: string, kerning: number = 24.5): string | null {
  const cleanText = modelName.trim();
  const upper = cleanText.toUpperCase();

  // 特殊复古单反: Nikon Df
  if (upper === 'DF' || upper === 'D_F') {
    return composeDf(fillColor);
  }

  const standardCapH = 395.0;
  const padY = 20.0;
  const padX = 20.0;

  const isFlagship = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'].some((p) => upper.startsWith(p));
  let currentX = 0.0;
  const charNodes: string[] = [];

  for (let i = 0; i < cleanText.length; i++) {
    const ch = cleanText[i];
    let glyphKey = ch;

    // 顶级旗舰数字双线空心替换
    if (isFlagship && ['2', '3', '4', '5', '6'].includes(ch)) {
      if (`${ch}_outline` in D_GLYPHS) {
        glyphKey = `${ch}_outline`;
      }
    }

    if (!(glyphKey in D_GLYPHS)) {
      if (ch.toUpperCase() in D_GLYPHS) glyphKey = ch.toUpperCase();
      else if (ch.toLowerCase() in D_GLYPHS) glyphKey = ch.toLowerCase();
      else return null;
    }

    const gInfo = D_GLYPHS[glyphKey];
    const offsetY = padY + (standardCapH - gInfo.height);
    charNodes.push(
      `<g id="d-glyph-${glyphKey}" transform="translate(${currentX.toFixed(2)}, ${offsetY.toFixed(2)})"><path d="${gInfo.d}" /></g>`
    );
    currentX += gInfo.width + kerning;
  }

  const totalWidth = +(currentX - kerning).toFixed(2);
  const totalHeight = +(standardCapH + padY * 2).toFixed(2);
  const viewBoxW = +(totalWidth + padX * 2).toFixed(2);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxW} ${totalHeight}" width="${viewBoxW}" height="${totalHeight}">
  <g id="nikon-${cleanText}" transform="translate(${padX.toFixed(2)}, 0)" fill="${fillColor}" fill-rule="evenodd">
    ${charNodes.join('\n    ')}
  </g>
</svg>`;
}

function composeDf(fillColor: string): string {
  const gD = D_GLYPHS['D'];
  const gF = D_GLYPHS['f'];
  const padX = 25.0;
  const padTop = 20.0;
  const standardCapH = 395.0;
  const yBase = padTop + standardCapH;

  const posYD = +(yBase - gD.height).toFixed(2);
  const posYF = +(yBase - 265.05).toFixed(2);
  const posXF = +(gD.width - 12.0).toFixed(2);
  const totalW = +(posXF + gF.width).toFixed(2);
  const totalH = +(yBase + 60.20 + 20.0).toFixed(2);
  const viewW = +(totalW + padX * 2).toFixed(2);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewW} ${totalH}" width="${viewW}" height="${totalH}">
  <g id="nikon-Df" transform="translate(${padX.toFixed(2)}, 0)" fill="${fillColor}" fill-rule="evenodd">
    <g id="glyph-D" transform="translate(0.00, ${posYD})"><path d="${gD.d}" /></g>
    <g id="glyph-f" transform="translate(${posXF}, ${posYF})"><path d="${gF.d}" /></g>
  </g>
</svg>`;
}

/**
 * 拼装 Z 系列微单型号矢量 SVG
 */
export function composeNikonZ(modelName: string, fillColor: string): string | null {
  const cleanText = modelName.trim();
  const upper = cleanText.toUpperCase().replace(/[\s_\-]/g, '');

  if (upper === 'ZF' || upper === 'Z_F') {
    return composeZf(fillColor);
  }
  if (upper === 'ZFC' || upper === 'Z_FC') {
    return composeZfc(fillColor);
  }

  let t = cleanText.replace(/[\s_\-]/g, '');
  const tokens: string[] = [];
  if (t.startsWith('Z') || t.startsWith('z')) {
    tokens.push('Z');
    t = t.substring(1);
  }

  let gen = '';
  if (t.endsWith('III') || t.endsWith('iii')) {
    gen = 'III';
    t = t.slice(0, -3);
  } else if (t.endsWith('II') || t.endsWith('ii')) {
    gen = 'II';
    t = t.slice(0, -2);
  }

  for (const char of t) {
    tokens.push(char);
  }
  if (gen) {
    tokens.push(gen);
  }

  const standardCapH = 395.0;
  const padX = 25.0;
  const padTop = 20.0;
  const yBase = padTop + standardCapH;

  let currentX = 0.0;
  const charNodes: string[] = [];

  for (const token of tokens) {
    if (!(token in Z_GLYPHS)) {
      return null;
    }
    const gInfo = Z_GLYPHS[token];
    if (token === 'Z') {
      const posY = +(yBase - standardCapH).toFixed(2);
      charNodes.push(
        `<g id="z-glyph-Z" transform="translate(${currentX.toFixed(2)}, ${posY})"><path d="${gInfo.d}" /></g>`
      );
      currentX += gInfo.width + 60.0;
    } else if (token === 'II' || token === 'III') {
      const posY = +(yBase - gInfo.height).toFixed(2);
      currentX += 15.0;
      charNodes.push(
        `<g id="z-generation-${token}" transform="translate(${currentX.toFixed(2)}, ${posY})"><path d="${gInfo.d}" /></g>`
      );
      currentX += gInfo.width;
    } else {
      const posY = +(yBase - gInfo.height).toFixed(2);
      charNodes.push(
        `<g id="z-glyph-${token}" transform="translate(${currentX.toFixed(2)}, ${posY})"><path d="${gInfo.d}" /></g>`
      );
      currentX += gInfo.width + 12.0;
    }
  }

  const lastToken = tokens[tokens.length - 1];
  const totalWidth = +(currentX - (!['Z', 'II', 'III'].includes(lastToken) ? 12.0 : 0.0)).toFixed(2);
  const totalHeight = +(yBase + 25.0).toFixed(2);
  const viewBoxW = +(totalWidth + padX * 2).toFixed(2);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxW} ${totalHeight}" width="${viewBoxW}" height="${totalHeight}">
  <g id="nikon-${cleanText}" transform="translate(${padX.toFixed(2)}, 0)" fill="${fillColor}" fill-rule="evenodd">
    ${charNodes.join('\n    ')}
  </g>
</svg>`;
}

function composeZf(fillColor: string): string {
  const gZ = Z_GLYPHS['Z'];
  const gF = Z_GLYPHS['f'] || Z_GLYPHS['F'];
  const padX = 25.0;
  const padTop = 20.0;
  const standardCapH = 395.0;
  const yBase = padTop + standardCapH;

  const posYZ = +(yBase - standardCapH).toFixed(2);
  const posYF = +(yBase - 249.13).toFixed(2);
  const posXF = +(gZ.width + 78.74).toFixed(2);
  const totalW = +(posXF + gF.width).toFixed(2);
  const totalH = +(yBase + 89.07 + 25.0).toFixed(2);
  const viewW = +(totalW + padX * 2).toFixed(2);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewW} ${totalH}" width="${viewW}" height="${totalH}">
  <g id="nikon-Z-f" transform="translate(${padX.toFixed(2)}, 0)" fill="${fillColor}" fill-rule="evenodd">
    <g id="glyph-Z" transform="translate(0.00, ${posYZ})"><path d="${gZ.d}" /></g>
    <g id="glyph-f" transform="translate(${posXF}, ${posYF})"><path d="${gF.d}" /></g>
  </g>
</svg>`;
}

function composeZfc(fillColor: string): string {
  const gZ = Z_GLYPHS['Z'];
  const gF = Z_GLYPHS['f'] || Z_GLYPHS['F'];
  const gC = Z_GLYPHS['c'];
  const padX = 25.0;
  const padTop = 20.0;
  const standardCapH = 395.0;
  const yBase = padTop + standardCapH;

  const posYZ = +(yBase - standardCapH).toFixed(2);
  const posYF = +(yBase - 249.13).toFixed(2);
  const posYC = +(yBase - 166.52).toFixed(2);
  const posXF = +(gZ.width + 78.74).toFixed(2);
  const posXC = +(posXF + gF.width).toFixed(2);
  const totalW = +(posXC + gC.width).toFixed(2);
  const totalH = +(yBase + 89.07 + 25.0).toFixed(2);
  const viewW = +(totalW + padX * 2).toFixed(2);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewW} ${totalH}" width="${viewW}" height="${totalH}">
  <g id="nikon-Z-fc" transform="translate(${padX.toFixed(2)}, 0)" fill="${fillColor}" fill-rule="evenodd">
    <g id="glyph-Z" transform="translate(0.00, ${posYZ})"><path d="${gZ.d}" /></g>
    <g id="glyph-f" transform="translate(${posXF}, ${posYF})"><path d="${gF.d}" /></g>
    <g id="glyph-c" transform="translate(${posXC}, ${posYC})"><path d="${gC.d}" /></g>
  </g>
</svg>`;
}

/**
 * 异步加载并生成 Nikon 机型 Logo 图像对象
 */
export async function loadNikonModelLogoImage(
  rawModel?: string,
  rawMake?: string,
  isDarkTheme: boolean = false
): Promise<HTMLImageElement | null> {
  const match = resolveNikonModel(rawModel, rawMake);
  if (!match) return null;

  const fillColor = isDarkTheme ? '#f3f4f6' : '#111827';
  const cacheKey = `${match.system}-${match.officialName}-${fillColor}`;

  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey)!;
  }

  let svgStr: string | null = null;
  if (match.system === 'z') {
    svgStr = composeNikonZ(match.officialName, fillColor);
  } else {
    svgStr = composeNikonD(match.officialName, fillColor);
  }

  if (!svgStr) return null;

  return new Promise((resolve) => {
    const img = new Image();
    const blob = new Blob([svgStr!], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      imageCache.set(cacheKey, img);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
