import { ExifData, FocalLengthMode, FrameConfig } from '../types';
import { detectBrandId, loadLogoImage } from './logoManager';
import { drawDeepFrostedBackground } from './blurEngine';
import { isNikonCamera, loadNikonModelLogoImage } from './nikonTypography';
import { getStoredLang } from '../i18n';

function formatFocalLength(exif: ExifData, mode: FocalLengthMode): string {
  const physical = exif.focal_length;
  const equiv = exif.focal_length_35mm;

  if (!physical && !equiv) return '';

  if (mode === 'equiv35mm') {
    return equiv || physical || '';
  }

  if (mode === 'both') {
    if (physical && equiv && physical !== equiv) {
      const label = getStoredLang() === 'en' ? 'equiv.' : '等效';
      return `${physical} (${label} ${equiv})`;
    }
    return physical || equiv || '';
  }

  // Default 'physical'
  return physical || equiv || '';
}

/**
 * Portrait photos derive bar/padding scale from an equivalent-landscape
 * reference height so bars keep proportions close to landscape (fonts always
 * scale with imgW; a taller factor gives the bar more presence in the tall
 * portrait composition without overflowing the narrower width).
 * Landscape and square photos are unaffected.
 */
function verticalReferenceHeight(imgW: number, imgH: number, portraitFactor = 0.9): number {
  return imgH > imgW ? Math.round(imgW * portraitFactor) : imgH;
}

/**
 * Map config.contentVerticalOffset (-100..100, 0 = default layout) onto the
 * free space of a content area: negative moves content up, positive down,
 * clamped so content stays inside its area.
 */
function contentVerticalShift(offset: number, halfFree: number): number {
  if (!offset || halfFree <= 0) return 0;
  return Math.max(-halfFree, Math.min(halfFree, (offset / 100) * halfFree));
}

/**
 * Canvas fillText never triggers webfont loading (only DOM usage does), and
 * the UI chrome uses system fonts — so without an explicit load the embedded
 * Noto/Brass faces are never fetched and font switching silently falls back.
 * Load once per family+weight before any render; later calls resolve instantly.
 */
const loadedFonts = new Set<string>();

/** Families shipped as webfonts; anything else (e.g. installed system fonts)
 *  resolves natively in canvas and needs no loading. */
const EMBEDDED_FONTS = ['Noto Sans SC', 'Noto Serif SC', 'Brass Mono'];

async function ensureFontsLoaded(config: FrameConfig): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const family = config.fontFamily || 'Noto Sans SC';
  if (!EMBEDDED_FONTS.includes(family)) return;
  const weights = new Set<number>([config.fontWeight || 500, config.secondaryFontWeight || 400]);
  await Promise.all(
    [...weights].map(async (weight) => {
      const key = `${family}|${weight}`;
      if (loadedFonts.has(key)) return;
      try {
        await document.fonts.load(`${weight} 32px "${family}"`, '预览Preview 0123');
        loadedFonts.add(key);
      } catch {
        // Font unavailable: canvas keeps its current fallback behavior
      }
    })
  );
}

export async function renderPhotoFrame(
  image: HTMLImageElement,
  exif: ExifData,
  config: FrameConfig,
  targetCanvas?: HTMLCanvasElement
): Promise<HTMLCanvasElement> {
  await ensureFontsLoaded(config);
  const canvas = targetCanvas || document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get canvas 2D context');

  const imgW = image.naturalWidth || image.width;
  const imgH = image.naturalHeight || image.height;

  // Determine theme and colors
  const isFrosted = config.backgroundType === 'frosted_blur';
  const isDark = config.backgroundType === 'dark' || isFrosted;

  const textColor = isDark ? '#f3f4f6' : '#111827';
  const subTextColor = isDark ? '#9ca3af' : '#6b7280';
  const dividerColor = isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.12)';

  // Determine Logo (minimal badge is a glass pill, so keep both color variants available)
  const brandId = config.selectedLogo === 'auto' ? detectBrandId(exif.make, exif.model) : config.selectedLogo;
  const isMinimalBadge = config.template === 'minimal_badge';
  const logoLightImg = config.showLogo ? await loadLogoImage(brandId, true) : null;
  const logoDarkImg = config.showLogo ? await loadLogoImage(brandId, false) : null;
  const logoImg = isMinimalBadge ? null : (isDark ? logoLightImg : logoDarkImg);

  // Determine Nikon Model Logo (if camera is Nikon and model display is enabled)
  const isNikon = isNikonCamera(exif.make, exif.model) || brandId === 'nikon';
  const nikonModelLightImg = (config.showModel && isNikon) ? await loadNikonModelLogoImage(exif.model, exif.make, true) : null;
  const nikonModelDarkImg = (config.showModel && isNikon) ? await loadNikonModelLogoImage(exif.model, exif.make, false) : null;
  const nikonModelImg = isMinimalBadge ? null : (isDark ? nikonModelLightImg : nikonModelDarkImg);

  // Build text strings
  const modelText = config.showModel
    ? (exif.model || exif.make || '')
    : (config.showMake ? (exif.make || '') : '');

  const lensText = config.showLens && exif.lens_model ? exif.lens_model : '';

  const paramParts: string[] = [];
  if (config.showParams) {
    const focalText = formatFocalLength(exif, config.focalLengthMode || 'physical');
    if (focalText) paramParts.push(focalText);
    if (exif.f_number) paramParts.push(exif.f_number);
    if (exif.exposure_time) paramParts.push(exif.exposure_time);
    if (exif.iso) paramParts.push(exif.iso);
    if (exif.exposure_bias && exif.exposure_bias !== '0 EV') paramParts.push(exif.exposure_bias);
  }
  const paramsText = paramParts.join('  ');

  const dateText = config.showDate && exif.datetime ? exif.datetime : '';
  const noteText = config.showCustomNote && config.customNote ? config.customNote : '';

  switch (config.template) {
    case 'bottom_bar':
      renderBottomBar(
        canvas,
        ctx,
        image,
        imgW,
        imgH,
        config,
        isFrosted,
        textColor,
        subTextColor,
        dividerColor,
        modelText,
        lensText,
        paramsText,
        dateText,
        noteText,
        logoImg,
        nikonModelImg
      );
      break;
    case 'border':
      renderBorderFrame(
        canvas,
        ctx,
        image,
        imgW,
        imgH,
        config,
        isFrosted,
        textColor,
        subTextColor,
        modelText,
        lensText,
        paramsText,
        dateText,
        noteText,
        logoImg,
        nikonModelImg
      );
      break;
    case 'polaroid':
      renderPolaroid(
        canvas,
        ctx,
        image,
        imgW,
        imgH,
        config,
        isFrosted,
        textColor,
        subTextColor,
        modelText,
        lensText,
        paramsText,
        dateText,
        noteText,
        logoImg,
        nikonModelImg
      );
      break;
    case 'minimal_badge':
    default:
      renderMinimalBadge(
        canvas,
        ctx,
        image,
        imgW,
        imgH,
        config,
        modelText,
        paramsText,
        dateText,
        noteText,
        logoLightImg,
        logoDarkImg,
        nikonModelLightImg,
        nikonModelDarkImg
      );
      break;
  }

  return canvas;
}

// -----------------------------------------------------------------------------
// 1. Template: Classic Bottom Bar (经典底栏 / 支持可调深度毛玻璃相框)
// -----------------------------------------------------------------------------
function renderBottomBar(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  imgW: number,
  imgH: number,
  config: FrameConfig,
  isFrosted: boolean,
  textColor: string,
  subTextColor: string,
  dividerColor: string,
  modelText: string,
  lensText: string,
  paramsText: string,
  dateText: string,
  noteText: string,
  logoImg: HTMLImageElement | null,
  nikonModelImg: HTMLImageElement | null
) {
  const padX = Math.round(imgW * (config.paddingPercent / 100));
  // Portrait: uniform mat (padding slider widens all four photo margins
  // equally) and a bottom band sized off the photo WIDTH with polaroid-grade
  // presence (16% of width at the default bar height) — thin landscape-style
  // strips read as broken on a tall composition. Landscape is unchanged.
  const isPortrait = imgH > imgW;
  const padTop = isPortrait ? padX : Math.round(imgH * (config.paddingPercent / 100));
  const barHeight = isPortrait
    ? Math.round(imgW * 0.16 * (config.bottomBarHeightPercent / 12))
    : Math.round(imgH * (config.bottomBarHeightPercent / 100));

  const canvasW = imgW + padX * 2;
  const canvasH = imgH + padTop + barHeight;

  canvas.width = canvasW;
  canvas.height = canvasH;

  // Background
  if (isFrosted) {
    drawDeepFrostedBackground(ctx, img, canvasW, canvasH, config.blurIntensity);
  } else if (config.backgroundType === 'dark') {
    ctx.fillStyle = '#14151a';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else if (config.backgroundType === 'custom') {
    ctx.fillStyle = config.customBackgroundColor || '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  // Draw Photo
  const photoX = padX;
  const photoY = padTop;
  const shadowBlur = isFrosted ? Math.max(config.shadowRadius, 30) : config.shadowRadius;
  const shadowOpacity = isFrosted ? Math.max(config.shadowOpacity, 0.4) : config.shadowOpacity;

  drawPhotoWithOptionalShadow(
    ctx,
    img,
    photoX,
    photoY,
    imgW,
    imgH,
    config.borderRadius,
    shadowBlur,
    shadowOpacity
  );

  // Bottom Bar Content Area
  const contentY = photoY + imgH;
  const contentH = barHeight;

  const fontScale = (imgW / 1200) * config.fontSizeScale;
  const mainFontSize = Math.max(Math.round(22 * fontScale), 16);
  const subFontSize = Math.max(Math.round(15 * fontScale), 12);
  const fontFam = config.fontFamily || 'Noto Sans SC';
  const mainWeight = config.fontWeight || 500;
  const subWeight = config.secondaryFontWeight || 400;

  // Watermark content (text + logo) vertical position within the bar
  const midY =
    contentY +
    contentH / 2 +
    contentVerticalShift(config.contentVerticalOffset || 0, Math.max(0, contentH / 2 - mainFontSize * 1.1));

  // If frosted blur, apply text drop shadow for pristine legibility
  if (isFrosted) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
  }

  // Left Section: Model & Lens — each column is block-centered on the bar
  // centerline so multi-line stacks share one optical middle with the logo.
  const leftX = photoX + Math.round(padX * 0.5);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const hasLens = !!lensText;
  const hasModel = !!modelText || !!nikonModelImg;
  const stackGap = Math.round(subFontSize * 0.5);

  if (nikonModelImg) {
    const modelLogoH = Math.round(barHeight * (hasLens ? 0.30 : 0.36));
    const modelLogoW = Math.round((nikonModelImg.width / nikonModelImg.height) * modelLogoH);

    if (hasLens) {
      const stackH = modelLogoH + stackGap + subFontSize;
      const stackTop = midY - stackH / 2;
      ctx.drawImage(nikonModelImg, leftX, stackTop, modelLogoW, modelLogoH);

      ctx.font = `${subWeight} ${subFontSize}px ${fontFam}`;
      ctx.fillStyle = subTextColor;
      ctx.fillText(lensText, leftX, stackTop + modelLogoH + stackGap + subFontSize / 2);
    } else {
      ctx.drawImage(nikonModelImg, leftX, midY - modelLogoH / 2, modelLogoW, modelLogoH);
    }
  } else if (hasModel && hasLens) {
    const stackH = mainFontSize + stackGap + subFontSize;
    const stackTop = midY - stackH / 2;

    ctx.font = `${mainWeight} ${mainFontSize}px ${fontFam}`;
    ctx.fillStyle = textColor;
    ctx.fillText(modelText, leftX, stackTop + mainFontSize / 2);

    ctx.font = `${subWeight} ${subFontSize}px ${fontFam}`;
    ctx.fillStyle = subTextColor;
    ctx.fillText(lensText, leftX, stackTop + mainFontSize + stackGap + subFontSize / 2);
  } else if (hasModel || hasLens) {
    ctx.font = `${mainWeight} ${mainFontSize * 1.05}px ${fontFam}`;
    ctx.fillStyle = textColor;
    ctx.fillText(modelText || lensText, leftX, midY);
  }

  // Right Section: Logo & Params
  const rightX = photoX + imgW - Math.round(padX * 0.5);
  let currentRightX = rightX;

  // Draw Logo if available
  if (logoImg) {
    const logoHeight = Math.round(barHeight * 0.38);
    const logoWidth = Math.round((logoImg.width / logoImg.height) * logoHeight);
    const logoX = currentRightX - logoWidth;
    const logoY = midY - logoHeight / 2;

    ctx.drawImage(logoImg, logoX, logoY, logoWidth, logoHeight);
    currentRightX = logoX - Math.round(24 * fontScale);

    // Divider Line
    ctx.strokeStyle = dividerColor;
    ctx.lineWidth = Math.max(1, Math.round(1.5 * fontScale));
    ctx.beginPath();
    ctx.moveTo(currentRightX, midY - logoHeight * 0.45);
    ctx.lineTo(currentRightX, midY + logoHeight * 0.45);
    ctx.stroke();

    currentRightX -= Math.round(24 * fontScale);
  }

  // Draw Parameters, Date & Signature
  ctx.textAlign = 'right';
  const subMetaParts: string[] = [];
  if (noteText) subMetaParts.push(noteText);
  if (dateText) subMetaParts.push(dateText);
  const rightSubText = subMetaParts.join('   •   ');

  if (rightSubText) {
    const stackH = mainFontSize + stackGap + subFontSize;
    const stackTop = midY - stackH / 2;

    ctx.font = `${mainWeight} ${mainFontSize}px ${fontFam}`;
    ctx.fillStyle = textColor;
    ctx.fillText(paramsText, currentRightX, stackTop + mainFontSize / 2);

    ctx.font = `${subWeight} ${subFontSize}px ${fontFam}`;
    ctx.fillStyle = subTextColor;
    ctx.fillText(rightSubText, currentRightX, stackTop + mainFontSize + stackGap + subFontSize / 2);
  } else {
    ctx.font = `${mainWeight} ${mainFontSize * 1.05}px ${fontFam}`;
    ctx.fillStyle = textColor;
    ctx.fillText(paramsText, currentRightX, midY);
  }

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

// -----------------------------------------------------------------------------
// 2. Template: Gallery Border (画廊全包相框 / 支持可调深度毛玻璃相框)
// -----------------------------------------------------------------------------
function renderBorderFrame(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  imgW: number,
  imgH: number,
  config: FrameConfig,
  isFrosted: boolean,
  textColor: string,
  subTextColor: string,
  modelText: string,
  lensText: string,
  paramsText: string,
  dateText: string,
  noteText: string,
  logoImg: HTMLImageElement | null,
  nikonModelImg: HTMLImageElement | null
) {
  const pad = Math.round(Math.min(imgW, imgH) * (config.paddingPercent / 100));
  const subMetaParts = [noteText, dateText].filter(Boolean);
  const subMetaLine = subMetaParts.join('  •  ');
  // Portrait: size the caption band off the photo WIDTH (16% with a sub-line,
  // 12% single-line) so it carries the same presence as the polaroid chin;
  // the pad-anchored band is too thin on a tall composition.
  const isPortrait = imgH > imgW;
  const bottomExtra = isPortrait
    ? Math.max(Math.round(imgW * (subMetaLine ? 0.16 : 0.12)) - pad, Math.round(pad * 1.2))
    : subMetaLine
      ? Math.round(pad * 1.6)
      : Math.round(pad * 1.2);

  const canvasW = imgW + pad * 2;
  const canvasH = imgH + pad * 2 + bottomExtra;

  canvas.width = canvasW;
  canvas.height = canvasH;

  // Background
  if (isFrosted) {
    drawDeepFrostedBackground(ctx, img, canvasW, canvasH, config.blurIntensity);
  } else if (config.backgroundType === 'dark') {
    ctx.fillStyle = '#14151a';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else if (config.backgroundType === 'custom') {
    ctx.fillStyle = config.customBackgroundColor || '#fafafa';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else {
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  // Draw Photo with shadow
  const shadowBlur = isFrosted ? Math.max(config.shadowRadius, 35) : config.shadowRadius;
  const shadowOpacity = isFrosted ? Math.max(config.shadowOpacity, 0.45) : config.shadowOpacity;

  drawPhotoWithOptionalShadow(
    ctx,
    img,
    pad,
    pad,
    imgW,
    imgH,
    config.borderRadius,
    shadowBlur,
    shadowOpacity
  );

  // Centered Caption at Bottom
  const bottomAreaY = pad + imgH;
  const captionH = pad + bottomExtra;
  const fontScale = (imgW / 1200) * config.fontSizeScale;
  const fontSize = Math.max(Math.round(18 * fontScale), 14);
  const subFontSize = Math.max(Math.round(13 * fontScale), 11);
  const fontFam = config.fontFamily || 'Noto Sans SC';
  const mainWeight = config.fontWeight || 500;
  const subWeight = config.secondaryFontWeight || 400;

  if (isFrosted) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
  }

  const remainingParts = [nikonModelImg ? '' : modelText, lensText, paramsText].filter(Boolean);
  const remainingText = remainingParts.join('  •  ');
  const hasSubLine = !!subMetaLine;
  const mainY =
    (hasSubLine ? bottomAreaY + captionH * 0.36 : bottomAreaY + captionH * 0.44) +
    contentVerticalShift(config.contentVerticalOffset || 0, Math.max(0, captionH / 2 - fontSize * 1.6));

  ctx.font = `${mainWeight} ${fontSize}px ${fontFam}`;
  const spacing = Math.round(14 * fontScale);
  const textWidth = remainingText ? ctx.measureText(remainingText).width : 0;

  const logoH = Math.round(fontSize * 1.25);
  const logoW = logoImg ? Math.round((logoImg.width / logoImg.height) * logoH) : 0;

  const modelLogoH = Math.round(fontSize * 1.15);
  const modelLogoW = nikonModelImg ? Math.round((nikonModelImg.width / nikonModelImg.height) * modelLogoH) : 0;

  let totalWidth = 0;
  if (logoImg) totalWidth += logoW;
  if (nikonModelImg) totalWidth += (totalWidth > 0 ? spacing : 0) + modelLogoW;
  if (remainingText) totalWidth += (totalWidth > 0 ? spacing : 0) + textWidth;

  let curX = (canvasW - totalWidth) / 2;

  if (logoImg) {
    ctx.drawImage(logoImg, curX, mainY - logoH / 2, logoW, logoH);
    curX += logoW + spacing;
  }

  if (nikonModelImg) {
    ctx.drawImage(nikonModelImg, curX, mainY - modelLogoH / 2, modelLogoW, modelLogoH);
    curX += modelLogoW + (remainingText ? spacing : 0);
  }

  if (remainingText) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = textColor;
    ctx.fillText(remainingText, curX, mainY);
  }

  if (hasSubLine) {
    ctx.font = `${subWeight} ${subFontSize}px ${fontFam}`;
    ctx.fillStyle = subTextColor;
    ctx.textAlign = 'center';
    ctx.fillText(subMetaLine, canvasW / 2, mainY + fontSize * 1.25);
  }

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

// -----------------------------------------------------------------------------
// 3. Template: Polaroid (拍立得即显照片)
// -----------------------------------------------------------------------------
function renderPolaroid(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  imgW: number,
  imgH: number,
  config: FrameConfig,
  isFrosted: boolean,
  textColor: string,
  subTextColor: string,
  modelText: string,
  lensText: string,
  paramsText: string,
  dateText: string,
  noteText: string,
  logoImg: HTMLImageElement | null,
  nikonModelImg: HTMLImageElement | null
) {
  const pad = Math.round(imgW * 0.06);
  // Portrait photos: keep the classic chin proportion of a physical instant
  // film frame (~16% of the width), otherwise the bottom area grows with imgH.
  const vRef = verticalReferenceHeight(imgW, imgH, 2 / 3);
  const bottomExtra = Math.round(vRef * 0.24);

  const canvasW = imgW + pad * 2;
  const canvasH = imgH + pad + bottomExtra;

  canvas.width = canvasW;
  canvas.height = canvasH;

  const isDarkBg = isFrosted || config.backgroundType === 'dark';

  if (isFrosted) {
    drawDeepFrostedBackground(ctx, img, canvasW, canvasH, config.blurIntensity);
  } else if (config.backgroundType === 'dark') {
    ctx.fillStyle = '#14151a';
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, canvasW, canvasH);
  } else {
    ctx.fillStyle = config.backgroundType === 'custom' ? (config.customBackgroundColor || '#fbfaf8') : '#fbfaf8';
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, canvasW, canvasH);
  }

  const shadowBlur = isFrosted ? 35 : 0;
  const shadowOpacity = isFrosted ? 0.35 : 0;

  drawPhotoWithOptionalShadow(ctx, img, pad, pad, imgW, imgH, config.borderRadius, shadowBlur, shadowOpacity);

  const fontScale = (imgW / 1200) * config.fontSizeScale;
  const fontSize = Math.max(Math.round(20 * fontScale), 15);
  const subFontSize = Math.max(Math.round(14 * fontScale), 12);
  const fontFam = config.fontFamily || 'Noto Serif SC';
  const mainWeight = config.fontWeight || 500;
  const subWeight = config.secondaryFontWeight || 400;

  const bottomAreaY = pad + imgH;
  const bottomAreaH = bottomExtra - pad * 0.5;
  const midY =
    bottomAreaY +
    bottomAreaH / 2 +
    contentVerticalShift(config.contentVerticalOffset || 0, Math.max(0, bottomAreaH / 2 - fontSize * 1.6));

  const leftX = pad + Math.round(pad * 0.4);
  const rightX = canvasW - pad - Math.round(pad * 0.4);

  if (isFrosted) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
  }

  // Left Content: Model + (Lens | Params) + Signature Note, laid out as one
  // vertically centered stack with an even, comfortable gap between rows
  // (the old fixed offsets packed the model line against the EXIF line).
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const subLine = [lensText, paramsText].filter(Boolean).join('  |  ');
  const hasNote = !!noteText;
  const stackGap = Math.round(subFontSize * 1.0);

  const entries: { h: number; draw: (cy: number) => void }[] = [];

  if (nikonModelImg) {
    const modelLogoH = Math.round(fontSize * 1.3);
    const modelLogoW = Math.round((nikonModelImg.width / nikonModelImg.height) * modelLogoH);
    entries.push({
      h: modelLogoH,
      draw: (cy) => ctx.drawImage(nikonModelImg, leftX, cy - modelLogoH / 2, modelLogoW, modelLogoH),
    });
  } else if (modelText) {
    entries.push({
      h: fontSize,
      draw: (cy) => {
        ctx.font = `${mainWeight} ${fontSize * 1.05}px ${fontFam}`;
        ctx.fillStyle = textColor;
        ctx.fillText(modelText, leftX, cy);
      },
    });
  }

  if (subLine) {
    entries.push({
      h: subFontSize,
      draw: (cy) => {
        ctx.font = `${subWeight} ${subFontSize}px ${fontFam}`;
        ctx.fillStyle = subTextColor;
        ctx.fillText(subLine, leftX, cy);
      },
    });
  }

  if (hasNote) {
    entries.push({
      h: subFontSize,
      draw: (cy) => drawSignatureNote(ctx, noteText, leftX, cy, subFontSize, isDarkBg),
    });
  }

  if (entries.length === 1) {
    entries[0].draw(midY);
  } else if (entries.length > 1) {
    const stackH = entries.reduce((s, e) => s + e.h, 0) + stackGap * (entries.length - 1);
    let cy = midY - stackH / 2;
    for (const e of entries) {
      e.draw(cy + e.h / 2);
      cy += e.h + stackGap;
    }
  }

  // Right Content: Logo + Vintage Date Stamp
  if (logoImg && dateText) {
    const logoH = Math.round(fontSize * 1.25);
    const logoW = Math.round((logoImg.width / logoImg.height) * logoH);
    ctx.drawImage(logoImg, rightX - logoW, midY - logoH * 1.05, logoW, logoH);

    ctx.textAlign = 'right';
    ctx.font = `${subWeight} ${subFontSize * 0.95}px 'Courier New', Courier, monospace`;
    ctx.fillStyle = isDarkBg ? '#fdba74' : '#c2410c';
    ctx.fillText(dateText, rightX, midY + subFontSize * 0.85);
  } else if (logoImg) {
    const logoH = Math.round(fontSize * 1.5);
    const logoW = Math.round((logoImg.width / logoImg.height) * logoH);
    ctx.drawImage(logoImg, rightX - logoW, midY - logoH / 2, logoW, logoH);
  } else if (dateText) {
    ctx.textAlign = 'right';
    ctx.font = `${subWeight} ${subFontSize}px 'Courier New', Courier, monospace`;
    ctx.fillStyle = isDarkBg ? '#fdba74' : '#c2410c';
    ctx.fillText(dateText, rightX, midY);
  }

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

// -----------------------------------------------------------------------------
// 4. Template: Minimal Badge (极简微章)
// -----------------------------------------------------------------------------
function renderMinimalBadge(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  imgW: number,
  imgH: number,
  config: FrameConfig,
  modelText: string,
  paramsText: string,
  dateText: string,
  noteText: string,
  logoLightImg: HTMLImageElement | null,
  logoDarkImg: HTMLImageElement | null,
  nikonModelLightImg: HTMLImageElement | null,
  nikonModelDarkImg: HTMLImageElement | null
) {
  canvas.width = imgW;
  canvas.height = imgH;

  ctx.drawImage(img, 0, 0, imgW, imgH);

  const fontScale = (imgW / 1200) * config.fontSizeScale;
  const fontSize = Math.max(Math.round(15 * fontScale), 12);
  const fontFam = config.fontFamily || 'Noto Sans SC';
  const mainWeight = config.fontWeight || 500;

  // Sample the bottom-right corner and pick a glass style that keeps contrast
  let useLightBadge = false;
  try {
    const sampleW = Math.max(1, Math.round(imgW * 0.35));
    const sampleH = Math.max(1, Math.round(imgH * 0.18));
    const sample = ctx.getImageData(imgW - sampleW, imgH - sampleH, sampleW, sampleH).data;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < sample.length; i += 4) {
      sum += 0.2126 * sample[i] + 0.7152 * sample[i + 1] + 0.0722 * sample[i + 2];
      count++;
    }
    useLightBadge = (sum / count) < 128;
  } catch {
    useLightBadge = false;
  }

  const logoImg = useLightBadge ? logoDarkImg : logoLightImg;
  const modelImg = useLightBadge ? nikonModelDarkImg : nikonModelLightImg;

  const extraParts = [noteText, dateText].filter(Boolean).join('  ');
  const summary = [modelImg ? '' : modelText, paramsText, extraParts].filter(Boolean).join('  |  ');

  // No text and no logo: keep the photo untouched instead of an empty badge
  if (!summary && !logoImg && !modelImg) return;

  ctx.font = mainWeight + ' ' + fontSize + 'px ' + fontFam;
  const textW = summary ? ctx.measureText(summary).width : 0;
  const logoH = Math.round(fontSize * 1.1);
  const logoW = logoImg ? Math.round((logoImg.width / logoImg.height) * logoH) : 0;
  const modelLogoH = Math.round(fontSize * 1.05);
  const modelLogoW = modelImg ? Math.round((modelImg.width / modelImg.height) * modelLogoH) : 0;
  const pad = Math.round(fontSize * 0.8);
  const spacing = Math.round(pad * 0.6);

  let contentW = 0;
  if (logoW) contentW += logoW;
  if (modelLogoW) contentW += (contentW > 0 ? spacing : 0) + modelLogoW;
  if (textW) contentW += (contentW > 0 ? spacing : 0) + textW;

  const badgeW = contentW + pad * 2;
  const badgeH = fontSize * 2.2;
  const badgeX = imgW - badgeW - Math.round(imgW * 0.03);
  // 0 keeps the default bottom-right spot; positive offset slides the badge up
  // along the right edge, clamped so it never leaves the photo.
  const vMargin = Math.round(imgH * 0.03);
  const vTravel = Math.max(0, imgH - badgeH - vMargin * 2);
  const upShift = Math.max(0, Math.min(vTravel, ((config.contentVerticalOffset || 0) / 100) * vTravel));
  const badgeY = imgH - badgeH - vMargin - upShift;

  ctx.save();
  if (useLightBadge) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
  } else {
    ctx.fillStyle = 'rgba(15, 17, 23, 0.75)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  }
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.lineWidth = 1;
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, Math.round(badgeH / 2));
  ctx.fill();
  ctx.stroke();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  let curX = badgeX + pad;
  const midY = badgeY + badgeH / 2;

  if (logoImg) {
    ctx.drawImage(logoImg, curX, midY - logoH / 2, logoW, logoH);
    curX += logoW + spacing;
  }

  if (modelImg) {
    ctx.drawImage(modelImg, curX, midY - modelLogoH / 2, modelLogoW, modelLogoH);
    curX += modelLogoW + (textW ? spacing : 0);
  }

  if (summary) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = useLightBadge ? '#111827' : '#ffffff';
    ctx.fillText(summary, curX, midY);
  }
  ctx.restore();
}

// Handwritten-style signature note (polaroid template):
// script font stack with graceful fallbacks + a subtle hand-drawn underline.
const SIGNATURE_FONT_STACK =
  "'Snell Roundhand', 'Apple Chancery', 'Brush Script MT', 'Segoe Script', 'Ink Free', 'URW Chancery L', 'Z003', cursive";

function drawSignatureNote(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  isLightText: boolean
) {
  const color = isLightText ? '#ece9e3' : '#4b5563';
  ctx.font = `italic 500 ${Math.round(size * 0.95)}px ${SIGNATURE_FONT_STACK}`;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);

  const w = ctx.measureText(text).width;
  if (w > 4) {
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, Math.round(size * 0.07));
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y + size * 0.5);
    ctx.quadraticCurveTo(x + w * 0.5, y + size * 0.3, x + w, y + size * 0.5);
    ctx.stroke();
    ctx.restore();
  }
}

function drawPhotoWithOptionalShadow(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  shadowBlur: number,
  shadowOpacity: number
) {
  ctx.save();

  if (shadowBlur > 0 && shadowOpacity > 0) {
    ctx.shadowColor = `rgba(0, 0, 0, ${shadowOpacity})`;
    ctx.shadowBlur = shadowBlur;
    ctx.shadowOffsetY = Math.round(shadowBlur * 0.38);
  }

  if (radius > 0) {
    roundRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = '#000000';
    ctx.fill();
    ctx.clip();
  }

  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
