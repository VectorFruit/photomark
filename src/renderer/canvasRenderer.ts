import { ExifData, FocalLengthMode, FrameConfig } from '../types';
import { detectBrandId, loadLogoImage } from './logoManager';
import { drawDeepFrostedBackground } from './blurEngine';

function formatFocalLength(exif: ExifData, mode: FocalLengthMode): string {
  const physical = exif.focal_length;
  const equiv = exif.focal_length_35mm;

  if (!physical && !equiv) return '';

  if (mode === 'equiv35mm') {
    return equiv || physical || '';
  }

  if (mode === 'both') {
    if (physical && equiv && physical !== equiv) {
      return `${physical} (等效 ${equiv})`;
    }
    return physical || equiv || '';
  }

  // Default 'physical'
  return physical || equiv || '';
}

export async function renderPhotoFrame(
  image: HTMLImageElement,
  exif: ExifData,
  config: FrameConfig,
  targetCanvas?: HTMLCanvasElement
): Promise<HTMLCanvasElement> {
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

  // Determine Logo
  const brandId = config.selectedLogo === 'auto' ? detectBrandId(exif.make, exif.model) : config.selectedLogo;
  const logoImg = config.showLogo ? await loadLogoImage(brandId, isDark) : null;

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
        logoImg
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
        logoImg
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
        logoImg
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
        logoImg
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
  logoImg: HTMLImageElement | null
) {
  const padX = Math.round(imgW * (config.paddingPercent / 100));
  const padTop = padX;
  const barHeight = Math.max(Math.round(imgH * (config.bottomBarHeightPercent / 100)), 120);

  const canvasW = imgW + padX * 2;
  const canvasH = imgH + padTop + barHeight;

  canvas.width = canvasW;
  canvas.height = canvasH;

  // Background Rendering
  if (isFrosted) {
    drawDeepFrostedBackground(ctx, img, canvasW, canvasH, config.blurIntensity);
  } else if (config.backgroundType === 'dark') {
    ctx.fillStyle = '#121316';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else if (config.backgroundType === 'custom') {
    ctx.fillStyle = config.customBackgroundColor || '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  // Draw Photo with shadow (Frosted mode always gives a prominent floating shadow)
  const photoX = padX;
  const photoY = padTop;
  const shadowBlur = isFrosted ? Math.max(config.shadowRadius, 35) : config.shadowRadius;
  const shadowOpacity = isFrosted ? Math.max(config.shadowOpacity, 0.45) : config.shadowOpacity;

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
  const midY = contentY + contentH / 2;

  const fontScale = (imgW / 1200) * config.fontSizeScale;
  const mainFontSize = Math.max(Math.round(22 * fontScale), 16);
  const subFontSize = Math.max(Math.round(15 * fontScale), 12);
  const fontFam = config.fontFamily || 'Inter, -apple-system, sans-serif';

  // If frosted blur, apply text drop shadow for pristine legibility
  if (isFrosted) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
  }

  // Left Section: Model & Lens
  const leftX = photoX + Math.round(padX * 0.5);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const hasLens = !!lensText;
  if (hasLens) {
    ctx.font = `600 ${mainFontSize}px ${fontFam}`;
    ctx.fillStyle = textColor;
    ctx.fillText(modelText, leftX, midY - mainFontSize * 0.6);

    ctx.font = `400 ${subFontSize}px ${fontFam}`;
    ctx.fillStyle = subTextColor;
    ctx.fillText(lensText, leftX, midY + subFontSize * 0.8);
  } else {
    ctx.font = `600 ${mainFontSize * 1.1}px ${fontFam}`;
    ctx.fillStyle = textColor;
    ctx.fillText(modelText, leftX, midY);
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
    ctx.font = `600 ${mainFontSize}px ${fontFam}`;
    ctx.fillStyle = textColor;
    ctx.fillText(paramsText, currentRightX, midY - mainFontSize * 0.6);

    ctx.font = `400 ${subFontSize}px ${fontFam}`;
    ctx.fillStyle = subTextColor;
    ctx.fillText(rightSubText, currentRightX, midY + subFontSize * 0.8);
  } else {
    ctx.font = `600 ${mainFontSize * 1.05}px ${fontFam}`;
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
  logoImg: HTMLImageElement | null
) {
  const pad = Math.round(Math.min(imgW, imgH) * (config.paddingPercent / 100));
  const subMetaParts = [noteText, dateText].filter(Boolean);
  const subMetaLine = subMetaParts.join('  •  ');
  const bottomExtra = subMetaLine ? Math.round(pad * 1.6) : Math.round(pad * 1.2);

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
  const fontFam = config.fontFamily || 'Inter, -apple-system, sans-serif';

  if (isFrosted) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const summaryParts = [modelText, lensText, paramsText].filter(Boolean);
  const summaryLine = summaryParts.join('  •  ');
  const hasSubLine = !!subMetaLine;
  const mainY = hasSubLine ? bottomAreaY + captionH * 0.42 : bottomAreaY + captionH * 0.5;

  if (logoImg) {
    const logoH = Math.round(fontSize * 1.25);
    const logoW = Math.round((logoImg.width / logoImg.height) * logoH);
    ctx.font = `500 ${fontSize}px ${fontFam}`;
    const textWidth = ctx.measureText(summaryLine).width;
    const spacing = Math.round(14 * fontScale);
    const totalWidth = logoW + spacing + textWidth;

    const startX = (canvasW - totalWidth) / 2;
    ctx.drawImage(logoImg, startX, mainY - logoH / 2, logoW, logoH);

    ctx.textAlign = 'left';
    ctx.fillStyle = textColor;
    ctx.fillText(summaryLine, startX + logoW + spacing, mainY);
  } else {
    ctx.font = `500 ${fontSize}px ${fontFam}`;
    ctx.fillStyle = textColor;
    ctx.fillText(summaryLine, canvasW / 2, mainY);
  }

  if (hasSubLine) {
    ctx.font = `400 ${subFontSize}px ${fontFam}`;
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
  logoImg: HTMLImageElement | null
) {
  const pad = Math.round(imgW * 0.06);
  const bottomExtra = Math.round(imgH * 0.24);

  const canvasW = imgW + pad * 2;
  const canvasH = imgH + pad + bottomExtra;

  canvas.width = canvasW;
  canvas.height = canvasH;

  if (isFrosted) {
    drawDeepFrostedBackground(ctx, img, canvasW, canvasH, config.blurIntensity);
  } else {
    ctx.fillStyle =
      config.backgroundType === 'dark'
        ? '#121316'
        : config.backgroundType === 'custom'
          ? config.customBackgroundColor || '#fbfaf8'
          : '#fbfaf8';
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
  const fontFam = config.fontFamily || 'Georgia, serif, -apple-system';

  const bottomAreaY = pad + imgH;
  const bottomAreaH = bottomExtra - pad * 0.5;
  const midY = bottomAreaY + bottomAreaH / 2;

  const leftX = pad + Math.round(pad * 0.4);
  const rightX = canvasW - pad - Math.round(pad * 0.4);

  if (isFrosted) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
  }

  // Left Content: Model + (Lens | Params) + Signature Note
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const subLine = [lensText, paramsText].filter(Boolean).join('  |  ');
  const hasNote = !!noteText;

  if (hasNote && subLine) {
    ctx.font = `600 ${fontSize}px ${fontFam}`;
    ctx.fillStyle = textColor;
    ctx.fillText(modelText, leftX, midY - fontSize * 0.95);

    ctx.font = `400 ${subFontSize}px ${fontFam}`;
    ctx.fillStyle = subTextColor;
    ctx.fillText(subLine, leftX, midY);

    drawSignatureNote(ctx, noteText, leftX, midY + fontSize * 0.95, subFontSize, isFrosted);
  } else if (subLine || hasNote) {
    ctx.font = `600 ${fontSize}px ${fontFam}`;
    ctx.fillStyle = textColor;
    ctx.fillText(modelText, leftX, midY - fontSize * 0.6);

    if (subLine) {
      ctx.font = `400 ${subFontSize}px ${fontFam}`;
      ctx.fillStyle = subTextColor;
      ctx.fillText(subLine, leftX, midY + subFontSize * 0.8);
    } else {
      drawSignatureNote(ctx, noteText, leftX, midY + subFontSize * 0.8, subFontSize, isFrosted);
    }
  } else {
    ctx.font = `600 ${fontSize * 1.1}px ${fontFam}`;
    ctx.fillStyle = textColor;
    ctx.fillText(modelText, leftX, midY);
  }

  // Right Content: Logo + Vintage Date Stamp (Supports showing BOTH simultaneously)
  if (logoImg && dateText) {
    const logoH = Math.round(fontSize * 1.25);
    const logoW = Math.round((logoImg.width / logoImg.height) * logoH);
    ctx.drawImage(logoImg, rightX - logoW, midY - logoH * 1.05, logoW, logoH);

    ctx.textAlign = 'right';
    ctx.font = `500 ${subFontSize * 0.95}px 'Courier New', Courier, monospace`;
    ctx.fillStyle = isFrosted ? '#fdba74' : '#c2410c'; // Vintage retro amber stamp
    ctx.fillText(dateText, rightX, midY + subFontSize * 0.85);
  } else if (logoImg) {
    const logoH = Math.round(fontSize * 1.5);
    const logoW = Math.round((logoImg.width / logoImg.height) * logoH);
    ctx.drawImage(logoImg, rightX - logoW, midY - logoH / 2, logoW, logoH);
  } else if (dateText) {
    ctx.textAlign = 'right';
    ctx.font = `500 ${subFontSize}px 'Courier New', Courier, monospace`;
    ctx.fillStyle = isFrosted ? '#fdba74' : '#c2410c';
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
  logoImg: HTMLImageElement | null
) {
  canvas.width = imgW;
  canvas.height = imgH;

  ctx.drawImage(img, 0, 0, imgW, imgH);

  const fontScale = (imgW / 1200) * config.fontSizeScale;
  const fontSize = Math.max(Math.round(15 * fontScale), 12);
  const fontFam = config.fontFamily || 'Inter, -apple-system, sans-serif';

  const extraParts = [noteText, dateText].filter(Boolean).join('  ');
  const summary = [modelText, paramsText, extraParts].filter(Boolean).join('  |  ');

  // No text and no logo: keep the photo untouched instead of an empty badge
  if (!summary && !logoImg) return;

  ctx.font = `500 ${fontSize}px ${fontFam}`;
  const textW = ctx.measureText(summary).width;
  const logoH = Math.round(fontSize * 1.1);
  const logoW = logoImg ? Math.round((logoImg.width / logoImg.height) * logoH) : 0;
  const pad = Math.round(fontSize * 0.8);

  const badgeW = textW + (logoW ? logoW + pad * 0.6 : 0) + pad * 2;
  const badgeH = fontSize * 2.2;
  const badgeX = imgW - badgeW - Math.round(imgW * 0.03);
  const badgeY = imgH - badgeH - Math.round(imgH * 0.03);

  ctx.save();
  ctx.fillStyle = 'rgba(15, 17, 23, 0.75)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1;
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, Math.round(badgeH / 2));
  ctx.fill();
  ctx.stroke();

  let curX = badgeX + pad;
  const midY = badgeY + badgeH / 2;

  if (logoImg) {
    ctx.drawImage(logoImg, curX, midY - logoH / 2, logoW, logoH);
    curX += logoW + Math.round(pad * 0.6);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(summary, curX, midY);
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
  isFrosted: boolean
) {
  const color = isFrosted ? '#e0e7ff' : '#4b5563';
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
