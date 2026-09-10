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
 * Test whether a hex color string is perceptually dark using ITU-R BT.601 luminance.
 */
function isColorDark(hexColor?: string): boolean {
  if (!hexColor) return false;
  let hex = hexColor.replace('#', '').trim();
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
      return (0.299 * r + 0.587 * g + 0.114 * b) < 140;
    }
  }
  return false;
}

/**
 * Fit a string to maxWidth: shrink ctx.font proportionally (floor 80%), then
 * truncate with an ellipsis as a last resort. Pure with respect to ctx (font
 * is restored), so callers can either draw the spec or just measure it.
 */
function fitTextSpec(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): { text: string; font: string; width: number } {
  if (!text) return { text: '', font: ctx.font, width: 0 };
  const baseFont = ctx.font;
  let font = baseFont;
  let width = ctx.measureText(text).width;
  if (width > maxWidth && width > 0) {
    const scale = maxWidth / width;
    if (scale > 0.8) {
      const m = baseFont.match(/^(.*\s)?(\d+(?:\.\d+)?)px(.*)$/);
      if (m) {
        font = `${m[1] || ''}${(parseFloat(m[2]) * scale).toFixed(1)}px${m[3]}`;
        ctx.font = font;
        width = ctx.measureText(text).width;
      }
    }
    if (width > maxWidth) {
      const chars = [...text];
      while (chars.length > 1 && ctx.measureText(chars.join('') + '…').width > maxWidth) {
        chars.pop();
      }
      text = chars.join('').trimEnd() + '…';
      width = ctx.measureText(text).width;
    }
  }
  ctx.font = baseFont;
  return { text, font, width };
}

/** Measure a string exactly as drawFittedText would render it, without drawing. */
function measureFittedText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): number {
  if (!text) return 0;
  const baseFont = ctx.font;
  const spec = fitTextSpec(ctx, text, maxWidth);
  ctx.font = spec.font;
  const width = ctx.measureText(spec.text).width;
  ctx.font = baseFont;
  return width;
}

/** Draw text with overflow protection (see fitTextSpec). Returns drawn width. */
function drawFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  align: CanvasTextAlign = 'left'
): number {
  if (!text) return 0;
  const baseFont = ctx.font;
  const spec = fitTextSpec(ctx, text, maxWidth);
  if (!spec.text) return 0;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = align;
  ctx.font = spec.font;
  ctx.fillText(spec.text, x, y);
  ctx.font = baseFont;
  ctx.textAlign = prevAlign;
  return spec.width;
}

/** Total width of a per-character tracked string (see drawTrackedText). */
function measureTrackedText(ctx: CanvasRenderingContext2D, text: string, tracking: number): number {
  if (!text) return 0;
  const chars = [...text];
  let total = 0;
  for (const c of chars) total += ctx.measureText(c).width;
  return total + tracking * Math.max(0, chars.length - 1);
}

/**
 * Draw text with manual letter spacing — canvas letterSpacing support is
 * uneven across WebView engines, so tracking is applied char by char.
 * Returns total drawn width including tracking.
 */
function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  align: CanvasTextAlign = 'center'
): number {
  if (!text) return 0;
  const chars = [...text];
  const total = measureTrackedText(ctx, text, tracking);
  let cursor = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const c of chars) {
    ctx.fillText(c, cursor, y);
    cursor += ctx.measureText(c).width + tracking;
  }
  ctx.textAlign = prevAlign;
  return total;
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
        // Race a timeout: a stuck font fetch must never block rendering —
        // the canvas falls back to system fonts until the face arrives.
        await Promise.race([
          document.fonts.load(`${weight} 32px "${family}"`, '预览Preview 0123'),
          new Promise((res) => setTimeout(res, 3000)),
        ]);
        loadedFonts.add(key);
      } catch {
        loadedFonts.add(key);
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
  const isCustomDark = config.backgroundType === 'custom' && isColorDark(config.customBackgroundColor);
  const isDark = config.backgroundType === 'dark' || isFrosted || isCustomDark;

  const textColor = isDark ? '#f3f4f6' : '#111827';
  const subTextColor = isDark ? '#9ca3af' : '#6b7280';
  const dividerColor = isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.12)';

  // Determine Logo (minimal badge is a glass pill, so keep both color variants available)
  const brandId = config.selectedLogo === 'auto' ? detectBrandId(exif.make, exif.model) : config.selectedLogo;
  const isMinimalBadge = config.template === 'minimal_badge';
  // Normalize consolidated templates & legacy aliases
  let effectiveTemplate = config.template;
  if ((effectiveTemplate as string) === 'floating_frame') effectiveTemplate = 'museum_matte';
  else if ((effectiveTemplate as string) === 'contact_sheet') effectiveTemplate = 'film_roll';
  else if ((effectiveTemplate as string) === 'recipe_card') effectiveTemplate = 'street_split';

  // Cinematic and film_roll paint their own fixed dark chrome regardless of the
  // background setting — the light (dark-background) logo variant must be used.
  const darkChrome = isDark || effectiveTemplate === 'cinematic' || effectiveTemplate === 'film_roll';
  const logoLightImg = config.showLogo ? await loadLogoImage(brandId, true, config.customLogoDataUrl) : null;
  const logoDarkImg = config.showLogo ? await loadLogoImage(brandId, false, config.customLogoDataUrl) : null;
  const logoImg = isMinimalBadge ? null : (darkChrome ? logoLightImg : logoDarkImg);

  // Determine Nikon Model Logo (if camera is Nikon and model display is enabled)
  const isNikon = isNikonCamera(exif.make, exif.model) || brandId === 'nikon';
  const nikonModelLightImg = (config.showModel && isNikon) ? await loadNikonModelLogoImage(exif.model, exif.make, true) : null;
  const nikonModelDarkImg = (config.showModel && isNikon) ? await loadNikonModelLogoImage(exif.model, exif.make, false) : null;
  const nikonModelImg = isMinimalBadge ? null : (darkChrome ? nikonModelLightImg : nikonModelDarkImg);

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

  switch (effectiveTemplate) {
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
    case 'center_brand':
      renderCenterBrandFrame(
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
    case 'cinematic':
      renderCinematicFrame(
        canvas,
        ctx,
        image,
        imgW,
        imgH,
        config,
        modelText,
        lensText,
        paramsText,
        dateText,
        noteText,
        logoImg,
        nikonModelImg
      );
      break;
    case 'film_roll':
      renderFilmRollFrame(
        canvas,
        ctx,
        image,
        imgW,
        imgH,
        config,
        exif,
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
    case 'medium_format':
      renderMediumFormatFrame(
        canvas,
        ctx,
        image,
        imgW,
        imgH,
        config,
        exif,
        isDark,
        modelText,
        lensText,
        paramsText,
        dateText,
        noteText,
        logoImg,
        nikonModelImg
      );
      break;
    case 'museum_matte':
      renderMuseumMatteFrame(
        canvas,
        ctx,
        image,
        imgW,
        imgH,
        config,
        exif,
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
    case 'street_split':
      renderStreetSplitFrame(
        canvas,
        ctx,
        image,
        imgW,
        imgH,
        config,
        exif,
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
    case 'slide_mount':
      renderSlideMountFrame(
        canvas,
        ctx,
        image,
        imgW,
        imgH,
        config,
        exif,
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


// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// 5. Template: Center Brand (画廊典藏居中大标 / 艺术展签对称装裱)
// -----------------------------------------------------------------------------
function renderCenterBrandFrame(
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
  nikonModelImg?: HTMLImageElement | null
) {
  const pad = Math.round(Math.min(imgW, imgH) * (config.paddingPercent / 100));
  const isPortrait = imgH > imgW;
  const bottomExtra = isPortrait
    ? Math.round(imgW * 0.16 * (config.bottomBarHeightPercent / 10))
    : Math.round(imgH * 0.14 * (config.bottomBarHeightPercent / 10));

  const canvasW = imgW + pad * 2;
  const canvasH = imgH + pad * 2 + bottomExtra;

  canvas.width = canvasW;
  canvas.height = canvasH;

  const isDark = config.backgroundType === 'dark' || isFrosted;

  // 1. Background
  if (isFrosted) {
    drawDeepFrostedBackground(ctx, img, canvasW, canvasH, config.blurIntensity);
  } else if (config.backgroundType === 'dark') {
    ctx.fillStyle = '#121316';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else if (config.backgroundType === 'custom') {
    ctx.fillStyle = config.customBackgroundColor || '#fafafa';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else {
    ctx.fillStyle = '#faf9f6';
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  // 2. Subtle Passe-partout deboss keyline (gallery matting accent)
  if (!isFrosted && pad >= 6) {
    const keylineOffset = Math.max(Math.round(pad * 0.18), 3);
    ctx.save();
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
    ctx.lineWidth = 1;
    if (config.borderRadius > 0) {
      roundRect(
        ctx,
        pad - keylineOffset + 0.5,
        pad - keylineOffset + 0.5,
        imgW + keylineOffset * 2,
        imgH + keylineOffset * 2,
        config.borderRadius + keylineOffset
      );
      ctx.stroke();
    } else {
      ctx.strokeRect(
        pad - keylineOffset + 0.5,
        pad - keylineOffset + 0.5,
        imgW + keylineOffset * 2,
        imgH + keylineOffset * 2
      );
    }
    ctx.restore();
  }

  // 2b. Hairline frame near the mat edge — finishes the mounted-print look (only on solid mat paper)
  if (!isFrosted) {
    const frameInset = Math.max(Math.round(Math.min(canvasW, canvasH) * 0.018), 10);
    ctx.save();
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.07)';
    ctx.lineWidth = 1;
    ctx.strokeRect(frameInset + 0.5, frameInset + 0.5, canvasW - frameInset * 2, canvasH - frameInset * 2);
    ctx.restore();
  }

  // 3. Draw Photo with optional shadow
  const shadowBlur = isFrosted ? Math.max(config.shadowRadius, 35) : config.shadowRadius;
  const shadowOpacity = isFrosted ? Math.max(config.shadowOpacity, 0.45) : config.shadowOpacity;
  drawPhotoWithOptionalShadow(ctx, img, pad, pad, imgW, imgH, config.borderRadius, shadowBlur, shadowOpacity);

  // 4. Centered Exhibition Plaque Typography
  const bottomAreaY = pad + imgH;
  const captionH = pad + bottomExtra;
  const fontScale = (imgW / 1200) * config.fontSizeScale;
  const fontFam = config.fontFamily || 'Noto Sans SC';
  const mainWeight = config.fontWeight || 600;
  const subWeight = config.secondaryFontWeight || 400;

  const titleFontSize = Math.max(Math.round(20 * fontScale), 15);
  const subFontSize = Math.max(Math.round(13.5 * fontScale), 11.5);
  const microFontSize = Math.max(Math.round(11 * fontScale), 9.5);
  const textMaxW = Math.round(canvasW - pad * 1.5);

  if (isFrosted) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
  }

  const centerLogo = logoImg;
  const logoH = centerLogo ? Math.min(Math.round(captionH * 0.24), Math.round(38 * fontScale)) : 0;
  const logoW = centerLogo ? Math.round((centerLogo.width / centerLogo.height) * logoH) : 0;

  // Build hierarchical text lines
  const filmLabel = config.filmSimulation ? `[${config.filmSimulation}]` : '';
  const titleText = [modelText, filmLabel].filter(Boolean).join('  ');
  const subParts = [lensText, paramsText].filter(Boolean);
  const subText = subParts.join('   ·   ');
  const microParts = [dateText, noteText].filter(Boolean);
  const microText = microParts.join('   ·   ');

  // Rule + diamond ornament anchors the plaque when no logo is shown
  const useOrnament = !centerLogo && (!!titleText || !!noteText || !!nikonModelImg);
  const ornamentH = Math.max(Math.round(titleFontSize * 0.8), 12);

  // Compute total content block height for vertical centering
  const lineGap = Math.round(8 * fontScale);
  const hasModelLogo = !!nikonModelImg;
  const modelLogoH = hasModelLogo ? Math.round(titleFontSize * 1.25) : 0;
  const displayTitle = hasModelLogo ? '' : (titleText || (!titleText && noteText ? noteText : ''));

  let totalContentH = 0;
  if (centerLogo) totalContentH += logoH + lineGap + Math.round(2 * fontScale);
  else if (useOrnament) totalContentH += ornamentH + lineGap;
  if (hasModelLogo) totalContentH += modelLogoH + lineGap;
  else if (displayTitle) totalContentH += titleFontSize + lineGap;
  if (subText) totalContentH += subFontSize + (microText ? lineGap : 0);
  if (microText && (titleText || hasModelLogo)) totalContentH += microFontSize;

  const shiftY = contentVerticalShift(config.contentVerticalOffset || 0, Math.max(0, captionH * 0.25));
  let curY = bottomAreaY + (captionH - totalContentH) / 2 + shiftY;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Draw Logo with subtle flanking accent rules
  if (centerLogo) {
    const logoX = (canvasW - logoW) / 2;
    ctx.drawImage(centerLogo, logoX, curY, logoW, logoH);

    // Subtle horizontal accent rules flanking the logo
    const ruleW = Math.round(imgW * 0.06);
    const ruleY = Math.round(curY + logoH / 2);
    const ruleGap = Math.round(16 * fontScale);
    ctx.save();
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(logoX - ruleGap - ruleW, ruleY);
    ctx.lineTo(logoX - ruleGap, ruleY);
    ctx.moveTo(logoX + logoW + ruleGap, ruleY);
    ctx.lineTo(logoX + logoW + ruleGap + ruleW, ruleY);
    ctx.stroke();
    ctx.restore();

    curY += logoH + lineGap + Math.round(2 * fontScale);
  } else if (useOrnament) {
    const midY = Math.round(curY + ornamentH / 2);
    const ruleW = Math.round(imgW * 0.06);
    const ruleGap = Math.round(14 * fontScale);
    const diamond = Math.max(Math.round(titleFontSize * 0.22), 3);
    ctx.save();
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.18)';
    ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.45)' : 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(canvasW / 2 - ruleGap - ruleW, midY);
    ctx.lineTo(canvasW / 2 - ruleGap, midY);
    ctx.moveTo(canvasW / 2 + ruleGap, midY);
    ctx.lineTo(canvasW / 2 + ruleGap + ruleW, midY);
    ctx.stroke();
    ctx.translate(canvasW / 2, midY);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-diamond / 2, -diamond / 2, diamond, diamond);
    ctx.restore();

    curY += ornamentH + lineGap;
  }

  // Draw Primary Title (Nikon Model Glyph or text)
  if (hasModelLogo && nikonModelImg) {
    const modelLogoW = Math.round((nikonModelImg.width / nikonModelImg.height) * modelLogoH);
    ctx.drawImage(nikonModelImg, (canvasW - modelLogoW) / 2, curY, modelLogoW, modelLogoH);
    curY += modelLogoH + lineGap;
  } else if (displayTitle) {
    ctx.font = `${mainWeight} ${titleFontSize}px ${fontFam}`;
    ctx.fillStyle = textColor;
    const tracking = titleFontSize * 0.08;
    if (measureTrackedText(ctx, displayTitle, tracking) <= textMaxW) {
      drawTrackedText(ctx, displayTitle, canvasW / 2, curY, tracking, 'center');
    } else {
      drawFittedText(ctx, displayTitle, canvasW / 2, curY, textMaxW, 'center');
    }
    curY += titleFontSize + lineGap;
  }

  // Draw Subtitle (Lens & Exposure)
  if (subText) {
    ctx.font = `${subWeight} ${subFontSize}px ${fontFam}`;
    ctx.fillStyle = subTextColor;
    drawFittedText(ctx, subText, canvasW / 2, curY, textMaxW, 'center');
    curY += subFontSize + lineGap;
  }

  // Draw Micro-line (Date & Note)
  if (microText && titleText) {
    ctx.font = `${subWeight} ${microFontSize}px ${fontFam}`;
    ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.45)' : 'rgba(0, 0, 0, 0.42)';
    drawFittedText(ctx, microText, canvasW / 2, curY, textMaxW, 'center');
  }

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

// -----------------------------------------------------------------------------
// 6. Template: Cinematic (电影宽银幕 2.39:1 / 导演监视器与对白剧照)
// -----------------------------------------------------------------------------
let grainTile: HTMLCanvasElement | null = null;
function getGrainTile(): HTMLCanvasElement | null {
  if (grainTile) return grainTile;
  if (typeof document === 'undefined') return null;
  const tile = document.createElement('canvas');
  tile.width = 96;
  tile.height = 96;
  const tctx = tile.getContext('2d');
  if (!tctx) return null;
  const timg = tctx.createImageData(96, 96);
  let seed = 31;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < timg.data.length; i += 4) {
    const v = Math.round(rand() * 255);
    timg.data[i] = timg.data[i + 1] = timg.data[i + 2] = v;
    timg.data[i + 3] = 255;
  }
  tctx.putImageData(timg, 0, 0);
  grainTile = tile;
  return tile;
}

function renderCinematicFrame(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  imgW: number,
  imgH: number,
  config: FrameConfig,
  modelText: string,
  lensText: string,
  paramsText: string,
  dateText: string,
  noteText: string,
  logoImg: HTMLImageElement | null,
  nikonModelImg?: HTMLImageElement | null
) {
  // Cinema letterbox flush with photo: height is proportional to image height,
  // creating classic widescreen letterboxing without ballooning the photo into a square!
  const canvasW = imgW;
  const letterboxH = Math.max(
    Math.round(imgH * (config.bottomBarHeightPercent / 100)),
    Math.round(imgH * 0.085),
    54
  );
  const canvasH = imgH + letterboxH * 2;

  canvas.width = canvasW;
  canvas.height = canvasH;

  // Solid deep cinematic obsidian black
  ctx.fillStyle = '#08080a';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Photo: drawn cleanly with NO muddy gradient destruction!
  ctx.drawImage(img, 0, letterboxH, imgW, imgH);

  // Crisp, elegant matte dividing hairlines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, letterboxH - 0.5);
  ctx.lineTo(canvasW, letterboxH - 0.5);
  ctx.moveTo(0, letterboxH + imgH + 0.5);
  ctx.lineTo(canvasW, letterboxH + imgH + 0.5);
  ctx.stroke();

  // Film grain: fine texture overlay on photo if requested
  if (config.showFilmGrain) {
    const tile = getGrainTile();
    const pattern = tile ? ctx.createPattern(tile, 'repeat') : null;
    if (pattern) {
      ctx.save();
      ctx.globalAlpha = 0.06;
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = pattern;
      ctx.fillRect(0, letterboxH, canvasW, imgH);
      ctx.restore();
    }
  }

  const fontScale = (imgW / 1200) * config.fontSizeScale;
  const padX = Math.max(Math.round(imgW * 0.035), 24);

  // ---------------------------------------------------------------------------
  // Top: Director's Production Monitor Header
  // ---------------------------------------------------------------------------
  const topY = letterboxH / 2;
  const topFontSize = Math.max(Math.round(12 * fontScale), 10);
  ctx.font = `500 ${topFontSize}px 'Brass Mono', 'Courier New', monospace`;
  ctx.textBaseline = 'middle';

  // Top Left: Red REC Indicator + timecode (falls back gracefully to real time/date)
  const redDotR = Math.max(Math.round(3.5 * fontScale), 3);
  let topLeftText = '';
  const timeMatch = dateText.match(/(\d{2}):(\d{2}):(\d{2})/);
  if (timeMatch) {
    topLeftText = `REC  TC ${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]}`;
  } else if (dateText) {
    topLeftText = `REC  ${dateText.split(' ')[0].replace(/:/g, '.')}`;
  } else {
    topLeftText = 'REC  TC 01:24:16:08';
  }

  // Top Center: authentic photo/cinema aspect ratio + film-simulation tag
  const photoRatio = imgW / imgH;
  let ratioTag = '';
  if (photoRatio >= 2.2) ratioTag = '2.39:1 SCOPE';
  else if (photoRatio >= 1.7) ratioTag = '16:9 WIDE';
  else if (photoRatio >= 1.4) ratioTag = '3:2 VISTAVISION';
  else if (photoRatio >= 1.25) ratioTag = '4:3 ACADEMY';
  else if (photoRatio >= 0.95 && photoRatio <= 1.05) ratioTag = '1:1 SQUARE';
  else if (photoRatio <= 0.6) ratioTag = '9:16 VERTICAL';
  else if (photoRatio <= 0.72) ratioTag = '2:3 VERTICAL';
  else if (photoRatio <= 0.85) ratioTag = '4:5 PORTRAIT';
  else ratioTag = `${photoRatio.toFixed(2)}:1`;
  const filmTag = config.filmSimulation ? `  ·  ${config.filmSimulation.toUpperCase()}` : '';
  const topCenterText = `${ratioTag}${filmTag}`;

  // Top Right: editable decorative meta
  const topRightText = config.cineMetaText.trim() || '180.0° · 24 FPS';

  const sideMaxW = Math.round(canvasW * 0.38);
  const minGap = Math.round(14 * fontScale);

  let leftExtent = padX;
  if (topLeftText) {
    const leftTextW = measureFittedText(ctx, topLeftText, sideMaxW);
    // Soft red halo + solid dot
    const redDotX = padX + redDotR;
    ctx.beginPath();
    ctx.arc(redDotX, topY, redDotR * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(239, 68, 68, 0.28)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(redDotX, topY, redDotR, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444';
    ctx.fill();
    // Timecode text
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    drawFittedText(ctx, topLeftText, padX + redDotR * 4, topY, sideMaxW, 'left');
    leftExtent = padX + redDotR * 4 + leftTextW;
  }

  const rightTextW = topRightText ? measureFittedText(ctx, topRightText, sideMaxW) : 0;
  const rightStart = canvasW - padX - rightTextW;
  const centerW = topCenterText ? measureFittedText(ctx, topCenterText, Math.round(canvasW * 0.35)) : 0;
  const centerFits =
    centerW > 0 &&
    canvasW / 2 - centerW / 2 - leftExtent >= minGap &&
    rightStart - (canvasW / 2 + centerW / 2) >= minGap;

  if (centerFits) {
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    drawFittedText(ctx, topCenterText, canvasW / 2, topY, Math.round(canvasW * 0.35), 'center');
  }

  if (topRightText) {
    const rightMaxW = Math.min(sideMaxW, Math.max(0, rightStart - minGap - leftExtent));
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.50)';
    drawFittedText(ctx, topRightText, canvasW - padX, topY, rightMaxW, 'right');
  }

  // ---------------------------------------------------------------------------
  // Viewfinder Framelines (Four-Corner Brackets, NO invasive center crosshair)
  // ---------------------------------------------------------------------------
  const cornerLen = Math.round(imgW * 0.022);
  const cornerOffset = Math.max(Math.round(imgW * 0.018), 14);
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1.5;

  // Top-left
  ctx.beginPath();
  ctx.moveTo(cornerOffset, letterboxH + cornerOffset + cornerLen);
  ctx.lineTo(cornerOffset, letterboxH + cornerOffset);
  ctx.lineTo(cornerOffset + cornerLen, letterboxH + cornerOffset);
  ctx.stroke();

  // Top-right
  ctx.beginPath();
  ctx.moveTo(canvasW - cornerOffset - cornerLen, letterboxH + cornerOffset);
  ctx.lineTo(canvasW - cornerOffset, letterboxH + cornerOffset);
  ctx.lineTo(canvasW - cornerOffset, letterboxH + cornerOffset + cornerLen);
  ctx.stroke();

  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(cornerOffset, letterboxH + imgH - cornerOffset - cornerLen);
  ctx.lineTo(cornerOffset, letterboxH + imgH - cornerOffset);
  ctx.lineTo(cornerOffset + cornerLen, letterboxH + imgH - cornerOffset);
  ctx.stroke();

  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(canvasW - cornerOffset - cornerLen, letterboxH + imgH - cornerOffset);
  ctx.lineTo(canvasW - cornerOffset, letterboxH + imgH - cornerOffset);
  ctx.lineTo(canvasW - cornerOffset, letterboxH + imgH - cornerOffset - cornerLen);
  ctx.stroke();
  ctx.restore();

  // ---------------------------------------------------------------------------
  // Movie Subtitle (电影对白字幕: 电影黄带投影)
  // ---------------------------------------------------------------------------
  if (config.showCustomNote && noteText) {
    ctx.save();
    const subFontSize = Math.max(Math.round(18 * fontScale), 14);
    ctx.font = `500 ${subFontSize}px 'Noto Sans SC', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#fef08a'; // Classic cinema subtitle pale yellow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = Math.round(6 * fontScale);
    ctx.shadowOffsetY = Math.round(2 * fontScale);

    const subtitleY = letterboxH + imgH - Math.round(letterboxH * 0.25);
    drawFittedText(ctx, noteText, canvasW / 2, subtitleY, canvasW - padX * 2, 'center');
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Bottom: Production & Lens Info Bar
  // ---------------------------------------------------------------------------
  const bottomY = letterboxH + imgH + letterboxH / 2;
  const mainFontSize = Math.max(Math.round(14 * fontScale), 11);
  const fontFam = config.fontFamily || 'Noto Sans SC';

  ctx.textBaseline = 'middle';

  const brandLogo = logoImg;
  const logoH = brandLogo ? Math.round(mainFontSize * 1.3) : 0;
  const logoW = brandLogo ? Math.round((brandLogo.width / brandLogo.height) * logoH) : 0;
  const logoGap = Math.round(12 * fontScale);

  let leftCursor = padX;
  if (brandLogo) {
    ctx.drawImage(brandLogo, leftCursor, bottomY - logoH / 2, logoW, logoH);
    leftCursor += logoW + logoGap;
  }

  const rightText = paramsText;
  const bottomRightW = rightText ? measureFittedText(ctx, rightText, Math.round(canvasW * 0.46)) : 0;

  if (nikonModelImg) {
    const modelLogoH = Math.round(mainFontSize * 1.15);
    const modelLogoW = Math.round((nikonModelImg.width / nikonModelImg.height) * modelLogoH);
    ctx.drawImage(nikonModelImg, leftCursor, bottomY - modelLogoH / 2, modelLogoW, modelLogoH);
    leftCursor += modelLogoW + (lensText ? logoGap : 0);
    if (lensText) {
      const leftAvail = Math.max(0, canvasW - leftCursor - padX - (bottomRightW ? bottomRightW + minGap : 0));
      ctx.font = `500 ${mainFontSize}px ${fontFam}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.90)';
      drawFittedText(ctx, `·   ${lensText}`, leftCursor, bottomY, leftAvail, 'left');
    }
  } else {
    const leftParts = [modelText, lensText].filter(Boolean);
    const leftText = leftParts.join('   ·   ');
    const leftAvail = Math.max(0, canvasW - leftCursor - padX - (bottomRightW ? bottomRightW + minGap : 0));
    if (leftText) {
      ctx.font = `500 ${mainFontSize}px ${fontFam}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.90)';
      drawFittedText(ctx, leftText, leftCursor, bottomY, leftAvail, 'left');
    }
  }

  if (rightText) {
    ctx.font = `400 ${mainFontSize}px 'Brass Mono', ${fontFam}, monospace`;
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    drawFittedText(ctx, rightText, canvasW - padX, bottomY, Math.round(canvasW * 0.46), 'right');
  }

  // Optical Sound Track (光学声轨)
  if (config.showSoundTrack) {
    const trackBaseY = canvasH - Math.max(Math.round(letterboxH * 0.16), 8);
    const amp = Math.max(Math.round(letterboxH * 0.10), 4);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    let wSeed = 97;
    const wrand = () => {
      wSeed = (wSeed * 16807) % 2147483647;
      return wSeed / 2147483647;
    };
    const span = canvasW - padX * 2;
    const step = Math.max(Math.round(span / 160), 6);
    const steps = Math.floor(span / step);
    let prev = 0;
    for (let i = 0; i <= steps; i++) {
      const x = padX + i * step;
      const t = i / Math.max(1, steps);
      const env = 0.35 + 0.65 * Math.abs(Math.sin(t * Math.PI * 7) * 0.6 + Math.sin(t * Math.PI * 23 + 1.7) * 0.4);
      prev = prev * 0.72 + (wrand() * 2 - 1) * 0.28;
      const y = trackBaseY + prev * amp * env;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

// -----------------------------------------------------------------------------
// 7. Template: Film Roll (复古 35mm 胶卷负片 / 真实齿孔、DX 条形码与冲印记号)
// -----------------------------------------------------------------------------
function renderFilmRollFrame(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  imgW: number,
  imgH: number,
  config: FrameConfig,
  exif: ExifData,
  modelText: string,
  lensText: string,
  paramsText: string,
  dateText: string,
  noteText: string,
  logoImg: HTMLImageElement | null,
  nikonModelImg?: HTMLImageElement | null
) {
  // Proportions: True 35mm film strip rebate bands on top and bottom,
  // NO bizarre vertical slice neighbor frames that distort aspect ratio and break physics!
  const padTop = Math.max(Math.round(imgW * 0.085), 64);
  const padBottom = Math.max(Math.round(imgW * 0.085), 64);
  const padX = Math.max(Math.round(imgW * 0.035), 24);

  const canvasW = imgW + padX * 2;
  const canvasH = imgH + padTop + padBottom;

  canvas.width = canvasW;
  canvas.height = canvasH;

  const photoTop = padTop;

  // 1. Film base: deep obsidian acetate black
  ctx.fillStyle = '#0d0d0f';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Subtle sheen across both rebate bands
  const sheenTop = ctx.createLinearGradient(0, 0, 0, padTop);
  sheenTop.addColorStop(0, 'rgba(255, 255, 255, 0.03)');
  sheenTop.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = sheenTop;
  ctx.fillRect(0, 0, canvasW, padTop);
  const sheenBottom = ctx.createLinearGradient(0, canvasH - padBottom, 0, canvasH);
  sheenBottom.addColorStop(0, 'rgba(255, 255, 255, 0)');
  sheenBottom.addColorStop(1, 'rgba(255, 255, 255, 0.03)');
  ctx.fillStyle = sheenBottom;
  ctx.fillRect(0, canvasH - padBottom, canvasW, padBottom);

  // 2. Draw Main Photo (undistorted, full quality)
  ctx.drawImage(img, padX, photoTop, imgW, imgH);

  // Crisp photo boundary hairline
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(padX - 0.5, photoTop - 0.5, imgW + 1, imgH + 1);

  // 3. Authentic KS-1870 Sprocket Holes (~8 per 35mm frame exposure width)
  const targetHoles = Math.max(Math.round(canvasW / (imgW * 0.12)), 8);
  const pitch = Math.round(canvasW / (targetHoles + 0.5));
  const holeW = Math.max(Math.round(pitch * 0.40), 16);
  const holeH = Math.max(Math.round(padTop * 0.38), 22);
  const holeRadius = Math.round(holeW * 0.28);
  const totalHoles = Math.floor(canvasW / pitch);
  const startX = Math.round((canvasW - totalHoles * pitch) / 2);

  const drawSprockets = (yCenter: number) => {
    for (let i = 0; i < totalHoles; i++) {
      const hx = startX + i * pitch;
      const hy = yCenter - holeH / 2;

      ctx.fillStyle = '#000000';
      roundRect(ctx, hx, hy, holeW, holeH, holeRadius);
      ctx.fill();

      // Top and left highlight (punch cut bevel)
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(hx + holeRadius, hy + holeRadius, holeRadius, Math.PI, 1.5 * Math.PI);
      ctx.lineTo(hx + holeW - holeRadius, hy);
      ctx.stroke();

      // Bottom inner shadow
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.beginPath();
      ctx.arc(hx + holeW - holeRadius, hy + holeH - holeRadius, holeRadius, 0, 0.5 * Math.PI);
      ctx.lineTo(hx + holeRadius, hy + holeH);
      ctx.stroke();
      ctx.restore();
    }
  };

  const topSprocketY = padTop * 0.36;
  const bottomSprocketY = canvasH - padBottom * 0.36;
  drawSprockets(topSprocketY);
  drawSprockets(bottomSprocketY);

  // 3b. Optional ambient light leak wash
  if (config.showLightLeak) {
    const leakR = Math.max(canvasW, canvasH) * 0.55;
    const amber = ctx.createRadialGradient(canvasW * 0.88, 0, 0, canvasW * 0.88, 0, leakR);
    amber.addColorStop(0, 'rgba(255, 138, 60, 0.16)');
    amber.addColorStop(0.5, 'rgba(255, 138, 60, 0.05)');
    amber.addColorStop(1, 'rgba(255, 138, 60, 0)');
    ctx.fillStyle = amber;
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  // 4. Determine Authentic Film Tone
  const isFuji = /fuji|provia|velvia|eterna|classic|astia/i.test(config.filmSimulation || exif.make || '');
  const filmColor = isFuji ? '#34d399' : '#f59e0b';
  const filmDimColor = isFuji ? 'rgba(52, 211, 153, 0.45)' : 'rgba(245, 158, 11, 0.45)';

  const fontScale = (imgW / 1200) * config.fontSizeScale;
  const fontSize = Math.max(Math.round(12.5 * fontScale), 10);
  ctx.font = `600 ${fontSize}px 'Brass Mono', 'Courier New', monospace`;
  ctx.textBaseline = 'middle';

  // 5. Top Rebate Markings
  const topTextY = padTop * 0.78;
  let defaultFilm = 'KODAK PORTRA 400';
  if (isFuji) defaultFilm = 'FUJIFILM PROVIA 100F';
  else if (/leica/i.test(exif.make || '')) defaultFilm = 'LEICA MONOPAN 400';
  const filmName = (config.filmSimulation || defaultFilm).toUpperCase();

  const topLeftBits = [`▶ ${filmName} · SAFETY FILM`];
  if (config.filmCode.trim()) topLeftBits.push(config.filmCode.trim().toUpperCase());
  const topLeftText = topLeftBits.join(' · ');
  const topCenterText = modelText ? `[ ${modelText.toUpperCase()} ]` : '';

  // Fix EXP EXP bug:
  const rawExp = config.filmExp.trim();
  const expFormatted = rawExp ? (/^exp/i.test(rawExp) ? rawExp : `EXP ${rawExp}`) : (exif.iso ? `ISO ${exif.iso}` : 'EXP 36');
  const topRightText = `▶ ${expFormatted} ▷ ▷ ▷`;

  const sideMaxW = Math.round(canvasW * 0.38);
  const minGap = Math.round(10 * fontScale);

  ctx.textAlign = 'left';
  const topLeftW = measureFittedText(ctx, topLeftText, sideMaxW);
  const topRightW = topRightText ? measureFittedText(ctx, topRightText, Math.round(canvasW * 0.30)) : 0;
  const topCenterW = nikonModelImg
    ? Math.round((nikonModelImg.width / nikonModelImg.height) * Math.round(fontSize * 1.15))
    : (topCenterText ? measureFittedText(ctx, topCenterText, Math.round(canvasW * 0.34)) : 0);
  const topLeftEnd = padX + topLeftW;
  const topRightStart = canvasW - padX - topRightW;
  const topCenterFits =
    topCenterW > 0 &&
    canvasW / 2 - topCenterW / 2 - topLeftEnd >= minGap &&
    topRightStart - (canvasW / 2 + topCenterW / 2) >= minGap;

  ctx.fillStyle = filmColor;
  drawFittedText(ctx, topLeftText, padX, topTextY, sideMaxW, 'left');
  if (nikonModelImg && topCenterFits) {
    const modelH = Math.round(fontSize * 1.15);
    const modelW = Math.round((nikonModelImg.width / nikonModelImg.height) * modelH);
    ctx.drawImage(nikonModelImg, Math.round(canvasW / 2 - modelW / 2), Math.round(topTextY - modelH / 2), modelW, modelH);
  } else if (topCenterText && topCenterFits) {
    ctx.fillStyle = filmDimColor;
    drawFittedText(ctx, topCenterText, canvasW / 2, topTextY, Math.round(canvasW * 0.34), 'center');
  }
  if (topRightText) {
    ctx.fillStyle = filmColor;
    drawFittedText(ctx, topRightText, canvasW - padX, topTextY, Math.round(canvasW * 0.30), 'right');
  }

  // 6. Bottom Rebate Markings
  const bottomTextY = photoTop + imgH + padBottom * 0.24;
  const brandLogo = logoImg;

  let leftCursor = padX;
  const frameNoText = config.filmFrameNo.trim() ? `◀◀ ${config.filmFrameNo.trim()}` : '◀◀ 24A';
  ctx.fillStyle = filmColor;
  const w = drawFittedText(ctx, frameNoText, leftCursor, bottomTextY, Math.round(canvasW * 0.16), 'left');
  leftCursor += w + Math.round(10 * fontScale);

  const logoH = brandLogo ? Math.max(Math.round(fontSize * 1.4), 12) : 0;
  const logoW = brandLogo ? Math.round((brandLogo.width / brandLogo.height) * logoH) : 0;
  if (brandLogo) {
    ctx.drawImage(brandLogo, leftCursor, bottomTextY - logoH / 2, logoW, logoH);
    leftCursor += logoW + Math.round(10 * fontScale);
  }

  if (config.showDxBarcode) {
    const barPattern = [3, 1, 4, 2, 1, 3, 2, 1, 4, 1, 2, 3, 1, 1, 4, 2, 1, 3, 1, 2, 4];
    const barStep = Math.max(Math.round(1.5 * fontScale), 1);
    const barcodeH = Math.max(Math.round(13 * fontScale), 11);
    let barcodeW = 0;
    for (let i = 0; i < barPattern.length; i++) {
      barcodeW += Math.max(Math.round(barPattern[i] * 0.7 * fontScale), 1) + barStep;
    }
    const barcodeAvail = Math.max(0, canvasW * 0.48 - leftCursor);
    if (barcodeW <= barcodeAvail) {
      ctx.fillStyle = filmColor;
      let curBx = leftCursor;
      for (let i = 0; i < barPattern.length; i++) {
        const bW = Math.max(Math.round(barPattern[i] * 0.7 * fontScale), 1);
        if (i % 2 === 0) {
          ctx.fillRect(curBx, bottomTextY - barcodeH / 2, bW, barcodeH);
        }
        curBx += bW + barStep;
      }
      leftCursor = curBx;
    }
  }
  const bottomLeftEnd = leftCursor;

  const bottomMetaParts = [lensText, paramsText].filter(Boolean);
  const bottomCenterText = bottomMetaParts.length ? `[ ${bottomMetaParts.join('  ·  ')} ]` : '';
  const dateShort = dateText ? dateText.split(' ')[0].replace(/:/g, '.').replace(/-/g, '.') : '';
  const bottomRightText = [dateShort, noteText].filter(Boolean).join('  ');

  const bottomRightW = bottomRightText ? measureFittedText(ctx, bottomRightText, Math.round(canvasW * 0.36)) : 0;
  const bottomRightStart = canvasW - padX - bottomRightW;
  const bottomCenterW = bottomCenterText ? measureFittedText(ctx, bottomCenterText, Math.round(canvasW * 0.40)) : 0;
  const bottomCenterFits =
    bottomCenterW > 0 &&
    canvasW / 2 - bottomCenterW / 2 - bottomLeftEnd >= minGap &&
    bottomRightStart - (canvasW / 2 + bottomCenterW / 2) >= minGap;

  if (bottomCenterText && bottomCenterFits) {
    ctx.fillStyle = filmDimColor;
    drawFittedText(ctx, bottomCenterText, canvasW / 2, bottomTextY, Math.round(canvasW * 0.40), 'center');
  }
  if (bottomRightText) {
    ctx.fillStyle = filmColor;
    drawFittedText(ctx, bottomRightText, canvasW - padX, bottomTextY, Math.round(canvasW * 0.36), 'right');
  }

  // 7. Quartz Date Stamp burned into photo corner
  if (config.showDateStamp && dateText) {
    const dateMatch = dateText.split(' ')[0].match(/(\d{2,4})[:.\-](\d{1,2})[:.\-](\d{1,2})/);
    if (dateMatch) {
      const stampText = `'${dateMatch[1].slice(-2)} ${parseInt(dateMatch[2], 10)} ${parseInt(dateMatch[3], 10)}`;
      const stampSize = Math.max(Math.round(imgW * 0.020), 12);
      const inset = Math.max(Math.round(imgW * 0.018), 10);
      ctx.save();
      ctx.font = `500 ${stampSize}px 'Brass Mono', 'Courier New', monospace`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(255, 149, 54, 0.88)';
      ctx.shadowColor = 'rgba(255, 120, 30, 0.55)';
      ctx.shadowBlur = Math.round(stampSize * 0.35);
      ctx.fillText(stampText, padX + imgW - inset, photoTop + imgH - inset);
      ctx.restore();
    }
  }
}

// -----------------------------------------------------------------------------
// 8. Template: Medium Format (中画幅胶片 / 经典 Hasselblad 500C/M 120 胶片相框)
// -----------------------------------------------------------------------------
function renderMediumFormatFrame(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  imgW: number,
  imgH: number,
  config: FrameConfig,
  _exif: ExifData,
  isDark: boolean,
  modelText: string,
  lensText: string,
  paramsText: string,
  dateText: string,
  noteText: string,
  logoImg: HTMLImageElement | null,
  nikonModelImg?: HTMLImageElement | null
) {
  const fontScale = (imgW / 1200) * config.fontSizeScale;
  const padX = Math.max(Math.round(imgW * Math.max(config.paddingPercent / 100, 0.05)), 28);
  const topRebateH = Math.max(Math.round(imgH * 0.065), Math.round(40 * fontScale));
  const bottomRebateH = Math.max(Math.round(imgH * 0.12), Math.round(88 * fontScale));
  const shutterLineH = Math.max(Math.round(14 * fontScale), 10);

  const canvasW = imgW + padX * 2;
  const canvasH = imgH + padX + topRebateH + bottomRebateH + shutterLineH;

  canvas.width = canvasW;
  canvas.height = canvasH;

  const photoX = padX;
  const photoY = topRebateH + Math.round(padX * 0.4);

  // Background - Authentic medium format carbon rebate or clean gallery white/custom
  if (config.backgroundType === 'frosted_blur') {
    drawDeepFrostedBackground(ctx, img, canvasW, canvasH, config.blurIntensity);
  } else if (config.backgroundType === 'custom') {
    ctx.fillStyle = config.customBackgroundColor || (isDark ? '#0b0c0e' : '#ffffff');
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else if (config.backgroundType === 'white') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else {
    ctx.fillStyle = '#0b0c0e';
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  // Draw photo with optional shadow
  const shadowBlur = config.shadowRadius;
  const shadowOpacity = config.shadowOpacity;
  drawPhotoWithOptionalShadow(ctx, img, photoX, photoY, imgW, imgH, config.borderRadius, shadowBlur, shadowOpacity);

  // Subtle photo rebate hairline
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.10)';
  ctx.lineWidth = 1;
  ctx.strokeRect(photoX - 0.5, photoY - 0.5, imgW + 1, imgH + 1);

  // Authentic Hasselblad 500C/M film gate V-notches on left photo border
  const notchW = Math.max(Math.round(imgW * 0.013), 9);
  const notchH = Math.max(Math.round(notchW * 1.5), 14);
  const notchY1 = photoY + imgH * 0.35;
  const notchY2 = photoY + imgH * 0.65;

  const isFrosted = config.backgroundType === 'frosted_blur';
  const drawNotch = (ny: number) => {
    ctx.save();
    if (isFrosted) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(photoX - 1, ny - notchH / 2);
      ctx.lineTo(photoX + notchW, ny);
      ctx.lineTo(photoX - 1, ny + notchH / 2);
      ctx.closePath();
      ctx.clip();
      drawDeepFrostedBackground(ctx, img, canvasW, canvasH, config.blurIntensity);
      ctx.restore();
    } else {
      const notchBg = config.backgroundType === 'white'
        ? '#ffffff'
        : (config.backgroundType === 'custom' ? (config.customBackgroundColor || (isDark ? '#0b0c0e' : '#ffffff')) : '#0b0c0e');
      ctx.fillStyle = notchBg;
      ctx.beginPath();
      ctx.moveTo(photoX - 1, ny - notchH / 2);
      ctx.lineTo(photoX + notchW, ny);
      ctx.lineTo(photoX - 1, ny + notchH / 2);
      ctx.closePath();
      ctx.fill();
    }

    // Delicate highlight stroke on notch rim
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(photoX - 0.5, ny - notchH / 2);
    ctx.lineTo(photoX + notchW, ny);
    ctx.lineTo(photoX - 0.5, ny + notchH / 2);
    ctx.stroke();
    ctx.restore();
  };

  drawNotch(notchY1);
  drawNotch(notchY2);

  // Top 120 Film Rebate Markings: Dynamic Authentic Gate Name
  const ratio = imgW / imgH;
  let gateName = '6×6 GATE';
  if (ratio >= 0.92 && ratio <= 1.08) gateName = '6×6 GATE';
  else if (ratio > 1.08 && ratio <= 1.28) gateName = '6×7 GATE';
  else if (ratio > 1.28 && ratio <= 1.42) gateName = '645 GATE';
  else if (ratio > 1.42 && ratio <= 1.85) gateName = '6×9 GATE';
  else if (ratio > 1.85) gateName = '6×17 PANORAMA';
  else if (ratio < 0.92) gateName = 'PORTRAIT GATE';

  const topTextY = Math.round(topRebateH * 0.55);
  const fontSizeTop = Math.max(Math.round(12 * fontScale), 10);
  ctx.font = `500 ${fontSizeTop}px 'Brass Mono', 'Courier New', monospace`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = isDark ? 'rgba(235, 235, 240, 0.65)' : 'rgba(31, 41, 55, 0.78)';

  const topLeftText = `120 FILM · ${gateName}`;
  const filmStock = (config.filmSimulation || 'KODAK TRI-X 400').toUpperCase();
  const topCenterText = `[ ${filmStock} ]`;
  const frameCounter = config.filmFrameNo ? `№ ${config.filmFrameNo.trim()}` : (config.filmExp ? `EXP ${config.filmExp.trim()}` : 'EXP 12');
  const topRightText = `▶ ${frameCounter} ▷`;

  drawFittedText(ctx, topLeftText, photoX, topTextY, Math.round(canvasW * 0.30), 'left');
  drawFittedText(ctx, topCenterText, canvasW / 2, topTextY, Math.round(canvasW * 0.34), 'center');
  drawFittedText(ctx, topRightText, canvasW - photoX, topTextY, Math.round(canvasW * 0.30), 'right');

  // Middle Accent: Amber Shutter Line & Indicator Scale
  const shutterY = photoY + imgH + Math.round(shutterLineH * 0.55);
  ctx.save();
  ctx.strokeStyle = isDark ? '#f97316' : '#ea580c';
  ctx.lineWidth = Math.max(Math.round(1.5 * fontScale), 1);
  ctx.beginPath();
  ctx.moveTo(photoX, shutterY);
  ctx.lineTo(photoX + imgW, shutterY);
  ctx.stroke();

  // Shutter scale tick mark in center
  const tickH = Math.max(Math.round(4 * fontScale), 3);
  const centerTickX = canvasW / 2;
  ctx.beginPath();
  ctx.moveTo(centerTickX, shutterY - tickH);
  ctx.lineTo(centerTickX, shutterY + tickH);
  ctx.stroke();
  ctx.restore();

  // Bottom Information Area
  const bottomAreaY = shutterY + Math.round(shutterLineH * 0.6);
  const bottomContentH = canvasH - bottomAreaY - Math.round(padX * 0.3);
  const shiftY = contentVerticalShift(config.contentVerticalOffset || 0, Math.max(0, bottomContentH * 0.2));
  const lineY1 = bottomAreaY + Math.round(bottomContentH * 0.35) + shiftY;
  const lineY2 = bottomAreaY + Math.round(bottomContentH * 0.72) + shiftY;

  const mainFontSize = Math.max(Math.round(15 * fontScale), 12);
  const subFontSize = Math.max(Math.round(12 * fontScale), 10);
  const fontFam = config.fontFamily || 'Noto Sans SC';

  // Left: Camera Model & Lens
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  if (nikonModelImg) {
    const modelLogoH = Math.round(mainFontSize * 1.25);
    const modelLogoW = Math.round((nikonModelImg.width / nikonModelImg.height) * modelLogoH);
    ctx.drawImage(nikonModelImg, photoX, lineY1 - modelLogoH / 2, modelLogoW, modelLogoH);
  } else if (modelText) {
    ctx.font = `600 ${mainFontSize}px '${fontFam}', sans-serif`;
    ctx.fillStyle = isDark ? '#f3f4f6' : '#0f172a';
    drawFittedText(ctx, modelText.toUpperCase(), photoX, lineY1, Math.round(imgW * 0.40), 'left');
  }

  const leftSubText = [lensText, noteText].filter(Boolean).join('  ·  ');
  if (leftSubText) {
    ctx.font = `400 ${subFontSize}px '${fontFam}', sans-serif`;
    ctx.fillStyle = isDark ? 'rgba(209, 213, 219, 0.65)' : 'rgba(75, 85, 99, 0.85)';
    drawFittedText(ctx, leftSubText, photoX, lineY2, Math.round(imgW * 0.40), 'left');
  }

  // Center: Camera Brand Logo
  const brandLogo = logoImg;
  if (brandLogo) {
    const logoMaxH = Math.max(Math.round(mainFontSize * 1.6), 14);
    const logoW = Math.round((brandLogo.width / brandLogo.height) * logoMaxH);
    const logoX = Math.round(canvasW / 2 - logoW / 2);
    const logoY = Math.round((lineY1 + lineY2) / 2 - logoMaxH / 2);
    ctx.drawImage(brandLogo, logoX, logoY, logoW, logoMaxH);
  }

  // Right: Exposure parameters & Date
  if (paramsText) {
    ctx.font = `500 ${mainFontSize}px 'Brass Mono', 'Courier New', monospace`;
    ctx.fillStyle = isDark ? '#f3f4f6' : '#0f172a';
    drawFittedText(ctx, paramsText, canvasW - photoX, lineY1, Math.round(imgW * 0.40), 'right');
  }

  if (dateText) {
    ctx.font = `400 ${subFontSize}px 'Brass Mono', 'Courier New', monospace`;
    ctx.fillStyle = isDark ? 'rgba(209, 213, 219, 0.65)' : 'rgba(75, 85, 99, 0.85)';
    drawFittedText(ctx, dateText, canvasW - photoX, lineY2, Math.round(imgW * 0.40), 'right');
  }

  // Quartz Date Stamp on photo corner if enabled
  if (config.showDateStamp && dateText) {
    const dateMatch = dateText.split(' ')[0].match(/(\d{2,4})[:.\-](\d{1,2})[:.\-](\d{1,2})/);
    if (dateMatch) {
      const stampText = `'${dateMatch[1].slice(-2)} ${parseInt(dateMatch[2], 10)} ${parseInt(dateMatch[3], 10)}`;
      const stampSize = Math.max(Math.round(imgW * 0.020), 12);
      const inset = Math.max(Math.round(imgW * 0.018), 10);
      ctx.save();
      ctx.font = `500 ${stampSize}px 'Brass Mono', 'Courier New', monospace`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(255, 149, 54, 0.88)';
      ctx.shadowColor = 'rgba(255, 120, 30, 0.55)';
      ctx.shadowBlur = Math.round(stampSize * 0.35);
      ctx.fillText(stampText, photoX + imgW - inset, photoY + imgH - inset);
      ctx.restore();
    }
  }
}

// -----------------------------------------------------------------------------
// 9. Template: Museum Matte (画廊典藏展签 / 45° 倒角卡纸微浮雕展签与立体悬浮装裱)
// -----------------------------------------------------------------------------
function renderMuseumMatteFrame(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  imgW: number,
  imgH: number,
  config: FrameConfig,
  exif: ExifData,
  isFrosted: boolean,
  textColor: string,
  subTextColor: string,
  modelText: string,
  lensText: string,
  paramsText: string,
  dateText: string,
  noteText: string,
  logoImg: HTMLImageElement | null,
  nikonModelImg?: HTMLImageElement | null
) {
  const fontScale = (imgW / 1200) * config.fontSizeScale;
  const padX = Math.max(Math.round(imgW * Math.max(config.paddingPercent / 100, 0.07)), 36);
  const padTop = Math.max(Math.round(imgH * Math.max(config.paddingPercent / 100, 0.07)), 36);
  const padBottom = Math.max(Math.round(padTop + imgH * 0.12), Math.round(92 * fontScale));

  const canvasW = imgW + padX * 2;
  const canvasH = imgH + padTop + padBottom;

  canvas.width = canvasW;
  canvas.height = canvasH;

  const isDark = config.backgroundType === 'dark' || isFrosted;

  // Background - Museum cotton-rag archival warm off-white or deep museum black
  if (isFrosted) {
    drawDeepFrostedBackground(ctx, img, canvasW, canvasH, config.blurIntensity);
  } else if (config.backgroundType === 'dark') {
    ctx.fillStyle = '#141417';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else if (config.backgroundType === 'custom') {
    ctx.fillStyle = config.customBackgroundColor || '#f7f6f2';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else {
    ctx.fillStyle = '#f7f6f2';
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  // Draw Photo cleanly without muddy outer shadow clashing with the mat cut
  drawPhotoWithOptionalShadow(ctx, img, padX, padTop, imgW, imgH, config.borderRadius, 0, 0);

  // 45-degree Beveled Mat Board Cutout Effect
  const bevelDepth = Math.max(Math.round(4 * fontScale), 3);
  const topGrad = ctx.createLinearGradient(padX, padTop, padX, padTop + bevelDepth * 2.5);
  topGrad.addColorStop(0, 'rgba(0, 0, 0, 0.32)');
  topGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(padX, padTop, imgW, bevelDepth * 2.5);

  const leftGrad = ctx.createLinearGradient(padX, padTop, padX + bevelDepth * 2.5, padTop);
  leftGrad.addColorStop(0, 'rgba(0, 0, 0, 0.32)');
  leftGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = leftGrad;
  ctx.fillRect(padX, padTop, bevelDepth * 2.5, imgH);

  // Bottom & Right bevel highlight rim
  ctx.save();
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = Math.max(Math.round(1.5 * fontScale), 1);
  ctx.beginPath();
  ctx.moveTo(padX, padTop + imgH);
  ctx.lineTo(padX + imgW, padTop + imgH);
  ctx.lineTo(padX + imgW, padTop);
  ctx.stroke();

  // Subtle outer archival border hairline
  if (!isFrosted) {
    const borderInset = Math.max(Math.round(padX * 0.28), 12);
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)';
    ctx.lineWidth = 1;
    ctx.strokeRect(borderInset - 0.5, borderInset - 0.5, canvasW - borderInset * 2 + 1, canvasH - borderInset * 2 + 1);
  }
  ctx.restore();

  // Baseline divider rule (from floating_frame integration)
  const bottomAreaY = padTop + imgH;
  const baselineY = bottomAreaY + Math.round(padBottom * 0.28);
  ctx.save();
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX, baselineY);
  ctx.lineTo(canvasW - padX, baselineY);
  ctx.stroke();
  ctx.restore();

  // Bottom Archival Plaque Typography
  const plaqueContentH = canvasH - baselineY;
  const shiftY = contentVerticalShift(config.contentVerticalOffset || 0, Math.max(0, plaqueContentH * 0.2));
  const plaqueY1 = baselineY + Math.round(plaqueContentH * 0.32) + shiftY;
  const plaqueY2 = baselineY + Math.round(plaqueContentH * 0.68) + shiftY;

  const titleFontSize = Math.max(Math.round(15 * fontScale), 12);
  const metaFontSize = Math.max(Math.round(11.5 * fontScale), 9.5);
  const fontFam = config.fontFamily || 'Noto Serif SC';

  ctx.textBaseline = 'middle';

  const brandLogo = logoImg;
  const logoH = brandLogo ? Math.max(Math.round(titleFontSize * 1.5), 14) : 0;
  const logoW = brandLogo ? Math.round((brandLogo.width / brandLogo.height) * logoH) : 0;
  const maxWingW = Math.round(canvasW / 2 - logoW / 2 - padX - Math.round(18 * fontScale));

  // Left Wing: Archival edition & artist note
  const editionTitle = (noteText || 'FINE ART ARCHIVAL PRINT').toUpperCase();
  ctx.font = `600 ${metaFontSize}px '${fontFam}', serif`;
  ctx.fillStyle = isDark ? '#e5e7eb' : '#27272a';
  drawFittedText(ctx, editionTitle, padX, plaqueY1, maxWingW, 'left');

  const makeDateStr = [exif.make?.toUpperCase(), dateText].filter(Boolean).join('  ·  ') || 'EDITION 1 OF 25';
  ctx.font = `400 ${metaFontSize * 0.9}px '${fontFam}', serif`;
  ctx.fillStyle = subTextColor;
  drawFittedText(ctx, makeDateStr, padX, plaqueY2, maxWingW, 'left');

  // Right Wing: Artwork title (model) & exposure specifications
  if (nikonModelImg) {
    const modelLogoH = Math.round(titleFontSize * 1.15);
    const modelLogoW = Math.round((nikonModelImg.width / nikonModelImg.height) * modelLogoH);
    ctx.drawImage(nikonModelImg, canvasW - padX - modelLogoW, plaqueY1 - modelLogoH / 2, modelLogoW, modelLogoH);
  } else {
    const workTitle = (modelText || 'UNTITLED').toUpperCase();
    ctx.font = `600 ${titleFontSize}px '${fontFam}', serif`;
    ctx.fillStyle = textColor;
    drawFittedText(ctx, workTitle, canvasW - padX, plaqueY1, maxWingW, 'right');
  }

  const rightMeta = [lensText, paramsText].filter(Boolean).join('   ');
  if (rightMeta) {
    ctx.font = `400 ${metaFontSize}px 'Brass Mono', 'Courier New', monospace`;
    ctx.fillStyle = subTextColor;
    drawFittedText(ctx, rightMeta, canvasW - padX, plaqueY2, maxWingW, 'right');
  }

  // Center: Minimal artist brand logo
  if (brandLogo) {
    const logoX = Math.round(canvasW / 2 - logoW / 2);
    const logoY = Math.round((plaqueY1 + plaqueY2) / 2 - logoH / 2);
    ctx.drawImage(brandLogo, logoX, logoY, logoW, logoH);
  }
}

function extractPhotoPalette(img: HTMLImageElement): string[] {
  try {
    const probe = document.createElement('canvas');
    probe.width = 16;
    probe.height = 16;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) return ['#1e293b', '#e11d48', '#3b82f6', '#f8fafc'];
    ctx.drawImage(img, 0, 0, 16, 16);
    const data = ctx.getImageData(0, 0, 16, 16).data;

    interface ColorSample { r: number; g: number; b: number; sat: number; lum: number }
    const samples: ColorSample[] = [];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b) / 255;
      const min = Math.min(r, g, b) / 255;
      const lum = (max + min) / 2;
      const sat = max === min ? 0 : (lum > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min));
      samples.push({ r, g, b, sat, lum });
    }

    samples.sort((a, b) => a.lum - b.lum);
    const shadow = samples[Math.floor(samples.length * 0.12)] || samples[0];
    const highlight = samples[Math.floor(samples.length * 0.88)] || samples[samples.length - 1];
    const midtone = samples[Math.floor(samples.length * 0.50)] || samples[0];

    let vibrant = samples[0];
    for (const s of samples) {
      if (s.sat > vibrant.sat && s.lum > 0.15 && s.lum < 0.85) {
        vibrant = s;
      }
    }

    const toHex = (s: ColorSample) =>
      `#${s.r.toString(16).padStart(2, '0')}${s.g.toString(16).padStart(2, '0')}${s.b.toString(16).padStart(2, '0')}`;

    return [toHex(shadow), toHex(vibrant), toHex(midtone), toHex(highlight)];
  } catch {
    return ['#1e293b', '#e11d48', '#3b82f6', '#f8fafc'];
  }
}

// -----------------------------------------------------------------------------
// 10. Template: Street Split & Recipe Matrix (现代街拍色彩与胶片配方矩阵卡)
// -----------------------------------------------------------------------------
function renderStreetSplitFrame(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  imgW: number,
  imgH: number,
  config: FrameConfig,
  exif: ExifData,
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
  const fontScale = (imgW / 1200) * config.fontSizeScale;
  const padX = Math.max(Math.round(imgW * Math.max(config.paddingPercent / 100, 0.045)), 22);
  const barH = Math.max(Math.round(imgH * (config.bottomBarHeightPercent / 100)), Math.round(88 * fontScale));

  const canvasW = imgW + padX * 2;
  const canvasH = imgH + padX + barH;

  canvas.width = canvasW;
  canvas.height = canvasH;

  const isDark = config.backgroundType === 'dark' || isFrosted;

  // Background
  if (isFrosted) {
    drawDeepFrostedBackground(ctx, img, canvasW, canvasH, config.blurIntensity);
  } else if (config.backgroundType === 'dark') {
    ctx.fillStyle = '#111215';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else if (config.backgroundType === 'custom') {
    ctx.fillStyle = config.customBackgroundColor || '#f8f9fa';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else {
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  // Draw Photo with optional shadow & border radius
  const shadowBlur = isFrosted ? Math.max(config.shadowRadius, 30) : config.shadowRadius;
  const shadowOpacity = isFrosted ? Math.max(config.shadowOpacity, 0.4) : config.shadowOpacity;
  drawPhotoWithOptionalShadow(ctx, img, padX, padX, imgW, imgH, config.borderRadius, shadowBlur, shadowOpacity);

  // Subtle photo hairline border
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(padX - 0.5, padX - 0.5, imgW + 1, imgH + 1);

  // Bottom Bar Split Layout
  const barY = padX + imgH;
  const splitRatio = 0.46;
  const splitX = padX + Math.round(imgW * splitRatio);
  const divY1 = barY + Math.round(barH * 0.16);
  const divY2 = barY + Math.round(barH * 0.84);

  // Vertical Divider Line
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(splitX, divY1);
  ctx.lineTo(splitX, divY2);
  ctx.stroke();

  const fontFam = config.fontFamily || 'Noto Sans SC';
  const mainFontSize = Math.max(Math.round(15 * fontScale), 12);
  const subFontSize = Math.max(Math.round(11 * fontScale), 9);
  const rightMaxW = canvasW - padX - splitX - Math.round(16 * fontScale);

  const shiftY = contentVerticalShift(config.contentVerticalOffset || 0, Math.max(0, barH * 0.2));
  const lineY1 = barY + Math.round(barH * 0.36) + shiftY;
  const lineY2 = barY + Math.round(barH * 0.70) + shiftY;

  ctx.textBaseline = 'middle';

  // --- Left Wing: Model Identity & 4-Color Extracted Palette Swatch + Recipe Badge ---
  let leftCursor = padX;
  const brandLogo = logoImg;
  if (brandLogo) {
    const logoH = Math.max(Math.round(mainFontSize * 1.4), 13);
    const logoW = Math.round((brandLogo.width / brandLogo.height) * logoH);
    ctx.drawImage(brandLogo, leftCursor, lineY1 - logoH / 2, logoW, logoH);
    leftCursor += logoW + Math.round(8 * fontScale);
  }

  if (nikonModelImg) {
    const modelLogoH = Math.round(mainFontSize * 1.15);
    const modelLogoW = Math.round((nikonModelImg.width / nikonModelImg.height) * modelLogoH);
    const availW = Math.max(splitX - leftCursor - Math.round(12 * fontScale), 40);
    if (modelLogoW <= availW) {
      ctx.drawImage(nikonModelImg, leftCursor, lineY1 - modelLogoH / 2, modelLogoW, modelLogoH);
    } else {
      ctx.drawImage(nikonModelImg, leftCursor, lineY1 - modelLogoH / 2, availW, (availW / modelLogoW) * modelLogoH);
    }
  } else if (modelText) {
    ctx.font = `700 ${mainFontSize}px '${fontFam}', sans-serif`;
    ctx.fillStyle = textColor;
    const availW = Math.max(splitX - leftCursor - Math.round(12 * fontScale), 40);
    drawFittedText(ctx, modelText.toUpperCase(), leftCursor, lineY1, availW, 'left');
  }

  // Row 2 Left: Extracted 4-color palette swatch dots
  const palette = extractPhotoPalette(img);
  const dotR = Math.max(Math.round(mainFontSize * 0.36), 5);
  const dotGap = Math.round(dotR * 2.5);
  let dotX = padX + dotR;
  for (const col of palette) {
    ctx.beginPath();
    ctx.arc(dotX, lineY2, dotR, 0, 2 * Math.PI);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.15)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    dotX += dotGap;
  }

  // Film simulation recipe badge or street tag
  const leftBadgeText = config.filmSimulation ? config.filmSimulation.toUpperCase() : (noteText || 'STREET RECIPE');
  if (leftBadgeText) {
    ctx.font = `600 ${subFontSize}px 'Brass Mono', 'Courier New', monospace`;
    ctx.fillStyle = subTextColor;
    const badgeX = dotX + Math.round(4 * fontScale);
    const badgeW = splitX - badgeX - Math.round(8 * fontScale);
    if (badgeW > 20) {
      drawFittedText(ctx, `· ${leftBadgeText}`, badgeX, lineY2, badgeW, 'left');
    }
  }

  // --- Right Wing: Tabular Exposure Matrix & Lens/Recipe Specs ---
  const rightStartX = splitX + Math.round(16 * fontScale);
  const rightMetaStr = [lensText, dateText].filter(Boolean).join('  ·  ');

  const focalVal = formatFocalLength(exif, config.focalLengthMode || 'physical') || '--';
  const apVal = exif.f_number || '--';
  const ssVal = exif.exposure_time || '--';
  // Strip any duplicate 'ISO' prefixes from raw EXIF string
  const isoVal = exif.iso ? String(exif.iso).replace(/^iso\s*/i, '').trim() : '--';

  const drawMatrixCell = (label: string, val: string, x: number, y: number, maxW: number) => {
    ctx.font = `500 ${subFontSize * 0.85}px 'Brass Mono', monospace`;
    ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.40)' : 'rgba(0, 0, 0, 0.38)';
    const lblW = ctx.measureText(label).width;
    ctx.fillText(label, x, y);

    ctx.font = `600 ${subFontSize * 1.05}px 'Brass Mono', monospace`;
    ctx.fillStyle = textColor;
    drawFittedText(ctx, val, x + lblW + Math.round(5 * fontScale), y, maxW - lblW - Math.round(5 * fontScale), 'left');
  };

  const isNarrow = rightMaxW < 440 || (imgW / imgH) < 0.85;
  if (config.showParams && !isNarrow) {
    const colStep = Math.round(rightMaxW / 4);
    drawMatrixCell('FL', focalVal, rightStartX, lineY1, colStep);
    drawMatrixCell('AP', apVal, rightStartX + colStep, lineY1, colStep);
    drawMatrixCell('SS', ssVal, rightStartX + colStep * 2, lineY1, colStep);
    drawMatrixCell('ISO', isoVal, rightStartX + colStep * 3, lineY1, colStep);

    // Row 2: Lens / Date / Recipe tuning
    ctx.font = `400 ${subFontSize}px 'Brass Mono', 'Courier New', monospace`;
    ctx.fillStyle = subTextColor;
    drawFittedText(ctx, rightMetaStr, rightStartX, lineY2, rightMaxW, 'left');
  } else if (config.showParams && isNarrow) {
    // 2x2 matrix on portrait / narrow screen
    const col1X = rightStartX;
    const col2X = rightStartX + Math.round(rightMaxW * 0.50);
    const cellW = Math.round(rightMaxW * 0.48);

    drawMatrixCell('FL', focalVal, col1X, lineY1, cellW);
    drawMatrixCell('AP', apVal, col2X, lineY1, cellW);
    drawMatrixCell('SS', ssVal, col1X, lineY2, cellW);
    drawMatrixCell('ISO', isoVal, col2X, lineY2, cellW);
  } else if (paramsText) {
    ctx.font = `600 ${subFontSize}px 'Brass Mono', monospace`;
    ctx.fillStyle = textColor;
    drawFittedText(ctx, paramsText, rightStartX, lineY1, rightMaxW, 'left');

    ctx.font = `400 ${subFontSize}px 'Brass Mono', 'Courier New', monospace`;
    ctx.fillStyle = subTextColor;
    drawFittedText(ctx, rightMetaStr, rightStartX, lineY2, rightMaxW, 'left');
  }
}

// -----------------------------------------------------------------------------
// 11. Template: Slide Mount (135 反转片幻灯卡 / Kodachrome & Velvia 装框片)
// -----------------------------------------------------------------------------
function renderSlideMountFrame(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  imgW: number,
  imgH: number,
  config: FrameConfig,
  _exif: ExifData,
  modelText: string,
  lensText: string,
  paramsText: string,
  dateText: string,
  noteText: string,
  logoImg: HTMLImageElement | null,
  nikonModelImg?: HTMLImageElement | null
) {
  const fontScale = (imgW / 1200) * config.fontSizeScale;
  const padX = Math.max(Math.round(imgW * Math.max(config.paddingPercent / 100, 0.06)), 32);
  const topBarH = Math.max(Math.round(imgH * 0.08), Math.round(50 * fontScale));
  const bottomBarH = Math.max(Math.round(imgH * 0.12), Math.round(76 * fontScale));

  const canvasW = imgW + padX * 2;
  const canvasH = imgH + padX + topBarH + bottomBarH;

  canvas.width = canvasW;
  canvas.height = canvasH;

  const photoX = padX;
  const photoY = topBarH + Math.round(padX * 0.4);

  const isDark = config.backgroundType === 'dark';

  // Background - Ivory White or Black Slide Plastic
  if (config.backgroundType === 'frosted_blur') {
    drawDeepFrostedBackground(ctx, img, canvasW, canvasH, config.blurIntensity);
  } else if (config.backgroundType === 'dark') {
    ctx.fillStyle = '#1b1c20';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else if (config.backgroundType === 'custom') {
    ctx.fillStyle = config.customBackgroundColor || '#f0ece3';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else {
    ctx.fillStyle = '#f0ece3';
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  // Outer Mold Guide Hairline (plastic slide injection mold frame)
  const moldInset = Math.max(Math.round(padX * 0.22), 8);
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(moldInset - 0.5, moldInset - 0.5, canvasW - moldInset * 2 + 1, canvasH - moldInset * 2 + 1);

  // Draw Photo cleanly
  drawPhotoWithOptionalShadow(ctx, img, photoX, photoY, imgW, imgH, config.borderRadius, 0, 0);

  // Inset Aperture Bevel Cutout Shadow
  const bevelW = Math.max(Math.round(4 * fontScale), 3);
  const topAperture = ctx.createLinearGradient(photoX, photoY, photoX, photoY + bevelW * 2);
  topAperture.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
  topAperture.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = topAperture;
  ctx.fillRect(photoX, photoY, imgW, bevelW * 2);

  const leftAperture = ctx.createLinearGradient(photoX, photoY, photoX + bevelW * 2, photoY);
  leftAperture.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
  leftAperture.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = leftAperture;
  ctx.fillRect(photoX, photoY, bevelW * 2, imgH);

  // Bottom & Right aperture rim highlight
  ctx.save();
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.75)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(photoX, photoY + imgH);
  ctx.lineTo(photoX + imgW, photoY + imgH);
  ctx.lineTo(photoX + imgW, photoY);
  ctx.stroke();
  ctx.restore();

  // Top Mold Markings (Debossed lettering)
  const topTextY = Math.round(topBarH * 0.52);
  const fontSizeTop = Math.max(Math.round(11 * fontScale), 9.5);
  ctx.font = `600 ${fontSizeTop}px 'Brass Mono', 'Courier New', monospace`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = isDark ? '#9ca3af' : '#57534e';

  const topLeftText = '▲ THIS SIDE TOWARDS SCREEN';
  const processStock = `PROCESS E-6 · ${(config.filmSimulation || 'FUJICHROME').toUpperCase()}`;
  drawFittedText(ctx, topLeftText, photoX, topTextY, Math.round(imgW * 0.45), 'left');
  drawFittedText(ctx, processStock, canvasW - photoX, topTextY, Math.round(imgW * 0.45), 'right');

  // Bottom Information
  const bottomAreaY = photoY + imgH;
  const bottomContentH = canvasH - bottomAreaY - Math.round(padX * 0.3);
  const shiftY = contentVerticalShift(config.contentVerticalOffset || 0, Math.max(0, bottomContentH * 0.2));
  const lineY1 = bottomAreaY + Math.round(bottomContentH * 0.38) + shiftY;
  const lineY2 = bottomAreaY + Math.round(bottomContentH * 0.72) + shiftY;

  const mainFontSize = Math.max(Math.round(14 * fontScale), 11.5);
  const subFontSize = Math.max(Math.round(11.5 * fontScale), 9.5);
  const fontFam = config.fontFamily || 'Noto Sans SC';

  // Left: Camera & Optics
  if (nikonModelImg) {
    const modelLogoH = Math.round(mainFontSize * 1.2);
    const modelLogoW = Math.round((nikonModelImg.width / nikonModelImg.height) * modelLogoH);
    ctx.drawImage(nikonModelImg, photoX, lineY1 - modelLogoH / 2, modelLogoW, modelLogoH);
  } else if (modelText) {
    ctx.font = `700 ${mainFontSize}px '${fontFam}', sans-serif`;
    ctx.fillStyle = isDark ? '#f3f4f6' : '#292524';
    drawFittedText(ctx, modelText.toUpperCase(), photoX, lineY1, Math.round(imgW * 0.42), 'left');
  }

  const leftSubText = [lensText, paramsText].filter(Boolean).join('  ·  ');
  if (leftSubText) {
    ctx.font = `500 ${subFontSize}px 'Brass Mono', 'Courier New', monospace`;
    ctx.fillStyle = isDark ? '#9ca3af' : '#78716c';
    drawFittedText(ctx, leftSubText, photoX, lineY2, Math.round(imgW * 0.45), 'left');
  }

  // Center: Brand Logo
  const brandLogo = logoImg;
  if (brandLogo) {
    const logoMaxH = Math.max(Math.round(mainFontSize * 1.5), 14);
    const logoW = Math.round((brandLogo.width / brandLogo.height) * logoMaxH);
    const logoX = Math.round(canvasW / 2 - logoW / 2);
    const logoY = Math.round((lineY1 + lineY2) / 2 - logoMaxH / 2);
    ctx.drawImage(brandLogo, logoX, logoY, logoW, logoMaxH);
  }

  // Right: Frame stamp (#24 VELVIA 50) & Origin / Note / Date
  const frameNo = config.filmFrameNo ? `#${config.filmFrameNo.trim()}` : '#24';
  const rightTag = `${frameNo} ${(config.filmSimulation || 'VELVIA 50').toUpperCase()}`;
  ctx.font = `700 ${mainFontSize}px 'Brass Mono', monospace`;
  ctx.fillStyle = '#dc2626'; // Red stamp
  drawFittedText(ctx, rightTag, canvasW - photoX, lineY1, Math.round(imgW * 0.40), 'right');

  const rightSubText = [dateText, noteText].filter(Boolean).join('  ·  ') || 'PROCESS E-6 ARCHIVAL';
  ctx.font = `500 ${subFontSize}px 'Brass Mono', monospace`;
  ctx.fillStyle = isDark ? '#9ca3af' : '#78716c';
  drawFittedText(ctx, rightSubText, canvasW - photoX, lineY2, Math.round(imgW * 0.40), 'right');
}

