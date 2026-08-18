import { ExifData, FrameConfig } from '../types';
import { detectBrandId, loadLogoImage } from './logoManager';

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

  // Determine dark/light theme
  const isDark = config.theme === 'dark' || (config.theme === 'auto' && config.template === 'frosted_blur');
  const textColor = isDark ? '#f3f4f6' : '#111827';
  const subTextColor = isDark ? '#9ca3af' : '#6b7280';
  const accentColor = isDark ? '#fbbf24' : '#d97706';
  const dividerColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)';

  // Determine Logo
  const brandId = config.selectedLogo === 'auto' ? detectBrandId(exif.make, exif.model) : config.selectedLogo;
  const logoImg = config.showLogo ? await loadLogoImage(brandId, isDark) : null;

  // Build text strings
  const modelText = config.showModel
    ? (exif.model || exif.make || 'Camera')
    : (config.showMake ? (exif.make || '') : '');

  const lensText = config.showLens && exif.lens_model ? exif.lens_model : '';

  const paramParts: string[] = [];
  if (config.showParams) {
    if (exif.focal_length_35mm || exif.focal_length) {
      paramParts.push(exif.focal_length_35mm || exif.focal_length!);
    }
    if (exif.f_number) paramParts.push(exif.f_number);
    if (exif.exposure_time) paramParts.push(exif.exposure_time);
    if (exif.iso) paramParts.push(exif.iso);
    if (exif.exposure_bias && exif.exposure_bias !== '0 EV') paramParts.push(exif.exposure_bias);
  }
  const paramsText = paramParts.join('  ');

  const dateText = config.showDate && exif.datetime ? exif.datetime : '';
  const noteText = config.showCustomNote && config.customNote ? config.customNote : '';

  // Apply layout based on template
  switch (config.template) {
    case 'bottom_bar':
      renderBottomBar(canvas, ctx, image, imgW, imgH, config, isDark, textColor, subTextColor, dividerColor, modelText, lensText, paramsText, dateText, noteText, logoImg);
      break;
    case 'border':
      renderBorderFrame(canvas, ctx, image, imgW, imgH, config, isDark, textColor, subTextColor, dividerColor, modelText, lensText, paramsText, dateText, noteText, logoImg);
      break;
    case 'frosted_blur':
      renderFrostedBlur(canvas, ctx, image, imgW, imgH, config, textColor, subTextColor, accentColor, modelText, lensText, paramsText, dateText, noteText, logoImg);
      break;
    case 'polaroid':
      renderPolaroid(canvas, ctx, image, imgW, imgH, config, textColor, subTextColor, modelText, lensText, paramsText, dateText, noteText, logoImg);
      break;
    case 'minimal_badge':
    default:
      renderMinimalBadge(canvas, ctx, image, imgW, imgH, config, isDark, textColor, subTextColor, modelText, lensText, paramsText, logoImg);
      break;
  }

  return canvas;
}

// -----------------------------------------------------------------------------
// 1. Template: Classic Bottom Bar (经典参数底栏)
// -----------------------------------------------------------------------------
function renderBottomBar(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  imgW: number,
  imgH: number,
  config: FrameConfig,
  isDark: boolean,
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

  // Background
  ctx.fillStyle = config.backgroundColor || (isDark ? '#121316' : '#ffffff');
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Main image with shadow / rounded corners
  const photoX = padX;
  const photoY = padTop;

  drawPhotoWithOptionalShadow(ctx, img, photoX, photoY, imgW, imgH, config.borderRadius, config.shadowRadius, config.shadowOpacity);

  // Bottom bar content area
  const contentY = photoY + imgH;
  const contentH = barHeight;
  const midY = contentY + contentH / 2;

  const fontScale = (imgW / 1200) * config.fontSizeScale;
  const mainFontSize = Math.max(Math.round(22 * fontScale), 16);
  const subFontSize = Math.max(Math.round(15 * fontScale), 12);
  const fontFam = config.fontFamily || 'Inter, -apple-system, sans-serif';

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

    // Vertical divider line between params and logo
    ctx.strokeStyle = dividerColor;
    ctx.lineWidth = Math.max(1, Math.round(1.5 * fontScale));
    ctx.beginPath();
    ctx.moveTo(currentRightX, midY - logoHeight * 0.45);
    ctx.lineTo(currentRightX, midY + logoHeight * 0.45);
    ctx.stroke();

    currentRightX -= Math.round(24 * fontScale);
  }

  // Draw Parameters and Date
  ctx.textAlign = 'right';
  const hasDateOrNote = !!(dateText || noteText);

  if (hasDateOrNote) {
    ctx.font = `600 ${mainFontSize}px ${fontFam}`;
    ctx.fillStyle = textColor;
    ctx.fillText(paramsText, currentRightX, midY - mainFontSize * 0.6);

    ctx.font = `400 ${subFontSize}px ${fontFam}`;
    ctx.fillStyle = subTextColor;
    ctx.fillText(dateText || noteText, currentRightX, midY + subFontSize * 0.8);
  } else {
    ctx.font = `600 ${mainFontSize * 1.05}px ${fontFam}`;
    ctx.fillStyle = textColor;
    ctx.fillText(paramsText, currentRightX, midY);
  }
}

// -----------------------------------------------------------------------------
// 2. Template: Gallery Border (画廊全包相框)
// -----------------------------------------------------------------------------
function renderBorderFrame(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  imgW: number,
  imgH: number,
  config: FrameConfig,
  isDark: boolean,
  textColor: string,
  subTextColor: string,
  _dividerColor: string,
  modelText: string,
  lensText: string,
  paramsText: string,
  dateText: string,
  _noteText: string,
  logoImg: HTMLImageElement | null
) {
  const pad = Math.round(Math.min(imgW, imgH) * (config.paddingPercent / 100));
  const bottomExtra = Math.round(pad * 1.2);

  const canvasW = imgW + pad * 2;
  const canvasH = imgH + pad * 2 + bottomExtra;

  canvas.width = canvasW;
  canvas.height = canvasH;

  // Frame Background
  ctx.fillStyle = config.backgroundColor || (isDark ? '#14151a' : '#fafafa');
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Photo
  drawPhotoWithOptionalShadow(ctx, img, pad, pad, imgW, imgH, config.borderRadius, config.shadowRadius, config.shadowOpacity);

  // Centered Caption at Bottom
  const captionY = pad + imgH + (pad + bottomExtra) / 2;
  const fontScale = (imgW / 1200) * config.fontSizeScale;
  const fontSize = Math.max(Math.round(18 * fontScale), 14);
  const subFontSize = Math.max(Math.round(13 * fontScale), 11);
  const fontFam = config.fontFamily || 'Inter, -apple-system, sans-serif';

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Compose line: [LOGO] Model • Params
  const summaryParts = [modelText, lensText, paramsText].filter(Boolean);
  const summaryLine = summaryParts.join('  •  ');

  if (logoImg) {
    const logoH = Math.round(fontSize * 1.2);
    const logoW = Math.round((logoImg.width / logoImg.height) * logoH);
    ctx.font = `500 ${fontSize}px ${fontFam}`;
    const textWidth = ctx.measureText(summaryLine).width;
    const spacing = Math.round(14 * fontScale);
    const totalWidth = logoW + spacing + textWidth;

    const startX = (canvasW - totalWidth) / 2;
    ctx.drawImage(logoImg, startX, captionY - logoH / 2, logoW, logoH);

    ctx.textAlign = 'left';
    ctx.fillStyle = textColor;
    ctx.fillText(summaryLine, startX + logoW + spacing, captionY);
  } else {
    ctx.font = `500 ${fontSize}px ${fontFam}`;
    ctx.fillStyle = textColor;
    ctx.fillText(summaryLine, canvasW / 2, captionY);
  }

  if (dateText) {
    ctx.font = `400 ${subFontSize}px ${fontFam}`;
    ctx.fillStyle = subTextColor;
    ctx.textAlign = 'center';
    ctx.fillText(dateText, canvasW / 2, captionY + fontSize * 1.3);
  }
}

// -----------------------------------------------------------------------------
// 3. Template: Frosted Blur Glass (毛玻璃虚化背景)
// -----------------------------------------------------------------------------
function renderFrostedBlur(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  imgW: number,
  imgH: number,
  config: FrameConfig,
  _textColor: string,
  _subTextColor: string,
  accentColor: string,
  modelText: string,
  lensText: string,
  paramsText: string,
  _dateText: string,
  _noteText: string,
  logoImg: HTMLImageElement | null
) {
  const padX = Math.round(imgW * 0.12);
  const padY = Math.round(imgH * 0.12);
  const bottomBarH = Math.round(imgH * 0.14);

  const canvasW = imgW + padX * 2;
  const canvasH = imgH + padY * 2 + bottomBarH;

  canvas.width = canvasW;
  canvas.height = canvasH;

  // 1. Draw Blurred background
  ctx.save();
  ctx.filter = 'blur(40px) brightness(0.65) saturate(1.4)';
  ctx.drawImage(img, -canvasW * 0.1, -canvasH * 0.1, canvasW * 1.2, canvasH * 1.2);
  ctx.filter = 'none';
  ctx.restore();

  // Dark overlay
  ctx.fillStyle = 'rgba(10, 12, 18, 0.4)';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // 2. Draw Main Photo with prominent shadow
  const photoX = padX;
  const photoY = padY;
  const radius = Math.max(config.borderRadius, Math.round(imgW * 0.015));

  drawPhotoWithOptionalShadow(ctx, img, photoX, photoY, imgW, imgH, radius, Math.max(config.shadowRadius, 30), 0.45);

  // 3. Frosted Glass Capsule at bottom
  const capsuleW = Math.round(imgW * 0.88);
  const capsuleH = Math.round(bottomBarH * 0.7);
  const capsuleX = (canvasW - capsuleW) / 2;
  const capsuleY = photoY + imgH + Math.round((padY + bottomBarH - capsuleH) / 2);
  const capsuleRadius = Math.round(capsuleH / 2);

  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, capsuleX, capsuleY, capsuleW, capsuleH, capsuleRadius);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Draw metadata inside capsule
  const fontScale = (imgW / 1200) * config.fontSizeScale;
  const fontSize = Math.max(Math.round(18 * fontScale), 14);
  const subFontSize = Math.max(Math.round(13 * fontScale), 11);
  const fontFam = config.fontFamily || 'Inter, -apple-system, sans-serif';
  const midY = capsuleY + capsuleH / 2;

  // Left in capsule: Logo + Model
  const padInner = Math.round(capsuleH * 0.35);
  let curX = capsuleX + padInner;

  if (logoImg) {
    const logoH = Math.round(capsuleH * 0.45);
    const logoW = Math.round((logoImg.width / logoImg.height) * logoH);
    ctx.drawImage(logoImg, curX, midY - logoH / 2, logoW, logoH);
    curX += logoW + Math.round(16 * fontScale);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${fontSize}px ${fontFam}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(modelText, curX, midY - (lensText ? fontSize * 0.5 : 0));

  if (lensText) {
    ctx.font = `400 ${subFontSize}px ${fontFam}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText(lensText, curX, midY + subFontSize * 0.7);
  }

  // Right in capsule: Parameters
  ctx.textAlign = 'right';
  ctx.font = `600 ${fontSize}px ${fontFam}`;
  ctx.fillStyle = accentColor;
  ctx.fillText(paramsText, capsuleX + capsuleW - padInner, midY);
}

// -----------------------------------------------------------------------------
// 4. Template: Polaroid (拍立得底片)
// -----------------------------------------------------------------------------
function renderPolaroid(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  imgW: number,
  imgH: number,
  config: FrameConfig,
  textColor: string,
  subTextColor: string,
  modelText: string,
  lensText: string,
  paramsText: string,
  dateText: string,
  _noteText: string,
  logoImg: HTMLImageElement | null
) {
  const pad = Math.round(imgW * 0.06);
  const bottomExtra = Math.round(imgH * 0.22);

  const canvasW = imgW + pad * 2;
  const canvasH = imgH + pad + bottomExtra;

  canvas.width = canvasW;
  canvas.height = canvasH;

  // Warm off-white polaroid card
  ctx.fillStyle = config.backgroundColor || '#fbfaf8';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Subtle paper texture / border
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, canvasW, canvasH);

  // Photo
  ctx.drawImage(img, pad, pad, imgW, imgH);

  // Handcrafted / Typewriter style typography
  const fontScale = (imgW / 1200) * config.fontSizeScale;
  const fontSize = Math.max(Math.round(20 * fontScale), 15);
  const subFontSize = Math.max(Math.round(14 * fontScale), 12);
  const fontFam = config.fontFamily || 'Georgia, serif, -apple-system';

  const bottomAreaY = pad + imgH;
  const midY = bottomAreaY + (bottomExtra - pad) / 2 + pad * 0.5;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${fontSize}px ${fontFam}`;
  ctx.fillStyle = textColor;
  ctx.fillText(modelText, pad + Math.round(pad * 0.3), midY - fontSize * 0.6);

  ctx.font = `400 ${subFontSize}px ${fontFam}`;
  ctx.fillStyle = subTextColor;
  const subLine = [lensText, paramsText].filter(Boolean).join('  |  ');
  ctx.fillText(subLine, pad + Math.round(pad * 0.3), midY + subFontSize * 0.8);

  // Right side: Logo or Date stamp
  if (logoImg) {
    const logoH = Math.round(fontSize * 1.5);
    const logoW = Math.round((logoImg.width / logoImg.height) * logoH);
    ctx.drawImage(logoImg, canvasW - pad - logoW - Math.round(pad * 0.3), midY - logoH / 2, logoW, logoH);
  } else if (dateText) {
    ctx.textAlign = 'right';
    ctx.font = `400 ${subFontSize}px ${fontFam}`;
    ctx.fillStyle = '#ea580c'; // Vintage orange date stamp
    ctx.fillText(dateText, canvasW - pad - Math.round(pad * 0.3), midY);
  }
}

// -----------------------------------------------------------------------------
// 5. Template: Minimal Badge (浮动微章极简水印)
// -----------------------------------------------------------------------------
function renderMinimalBadge(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  imgW: number,
  imgH: number,
  config: FrameConfig,
  _isDark: boolean,
  _textColor: string,
  _subTextColor: string,
  modelText: string,
  _lensText: string,
  paramsText: string,
  logoImg: HTMLImageElement | null
) {
  canvas.width = imgW;
  canvas.height = imgH;

  // Draw full image
  ctx.drawImage(img, 0, 0, imgW, imgH);

  // Floating dark glass badge in bottom right corner
  const fontScale = (imgW / 1200) * config.fontSizeScale;
  const fontSize = Math.max(Math.round(15 * fontScale), 12);
  const fontFam = config.fontFamily || 'Inter, -apple-system, sans-serif';

  const summary = [modelText, paramsText].filter(Boolean).join('  |  ');

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
  ctx.fillStyle = 'rgba(15, 17, 23, 0.72)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
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

// -----------------------------------------------------------------------------
// Helper: Draw photo with optional rounded corners & drop shadow
// -----------------------------------------------------------------------------
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
    ctx.shadowOffsetY = Math.round(shadowBlur * 0.35);
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

// -----------------------------------------------------------------------------
// Helper: Rounded Rectangle Path
// -----------------------------------------------------------------------------
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
