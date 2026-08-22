export interface BrandLogo {
  id: string;
  name: string;
  lightSvg: string;
  darkSvg: string;
}

export const BRAND_LOGOS: BrandLogo[] = [
  { id: 'sony', name: 'SONY', lightSvg: '/logos/sony-w.svg', darkSvg: '/logos/sony-b.svg' },
  { id: 'canon', name: 'Canon', lightSvg: '/logos/canon-w.svg', darkSvg: '/logos/canon-b.svg' },
  { id: 'nikon', name: 'Nikon', lightSvg: '/logos/nikon-w.svg', darkSvg: '/logos/nikon-b.svg' },
  { id: 'leica', name: 'Leica', lightSvg: '/logos/leica-w.svg', darkSvg: '/logos/leica-b.svg' },
  { id: 'fujifilm', name: 'FUJIFILM', lightSvg: '/logos/fujifilm-w.svg', darkSvg: '/logos/fujifilm-b.svg' },
  { id: 'hasselblad', name: 'HASSELBLAD', lightSvg: '/logos/hasselblad-w.svg', darkSvg: '/logos/hasselblad-b.svg' },
  { id: 'panasonic', name: 'Panasonic', lightSvg: '/logos/panasonic-w.svg', darkSvg: '/logos/panasonic-b.svg' },
  { id: 'olympus', name: 'Olympus', lightSvg: '/logos/olympus-w.svg', darkSvg: '/logos/olympus-b.svg' },
  { id: 'dji', name: 'DJI', lightSvg: '/logos/dji-w.svg', darkSvg: '/logos/dji-b.svg' },
  { id: 'ricoh', name: 'RICOH', lightSvg: '/logos/ricoh-w.svg', darkSvg: '/logos/ricoh-b.svg' },
  { id: 'pentax', name: 'PENTAX', lightSvg: '/logos/pentax-w.svg', darkSvg: '/logos/pentax-b.svg' },
  { id: 'sigma', name: 'SIGMA', lightSvg: '/logos/sigma-w.svg', darkSvg: '/logos/sigma-b.svg' },
  { id: 'apple', name: 'Apple', lightSvg: '/logos/apple.svg', darkSvg: '/logos/apple.svg' },
  { id: 'zeiss', name: 'ZEISS', lightSvg: '/logos/zeiss.svg', darkSvg: '/logos/zeiss.svg' },
];

const imageCache: Map<string, HTMLImageElement> = new Map();

export function detectBrandId(make?: string, model?: string): string | null {
  const text = `${make || ''} ${model || ''}`.toLowerCase().trim();

  if (!text) return null;

  if (text.includes('sony')) return 'sony';
  if (text.includes('canon')) return 'canon';
  if (text.includes('nikon')) return 'nikon';
  if (text.includes('leica')) return 'leica';
  if (text.includes('fuji') || text.includes('gfx') || text.includes('x-t')) return 'fujifilm';
  if (text.includes('hasselblad')) return 'hasselblad';
  if (text.includes('panasonic') || text.includes('lumix')) return 'panasonic';
  if (text.includes('olympus') || text.includes('om system') || text.includes('om-')) return 'olympus';
  if (text.includes('dji') || text.includes('mavic') || text.includes('osmo')) return 'dji';
  if (text.includes('ricoh') || text.includes('gr iii') || text.includes('gr ii')) return 'ricoh';
  if (text.includes('pentax')) return 'pentax';
  if (text.includes('sigma')) return 'sigma';
  if (text.includes('apple') || text.includes('iphone')) return 'apple';
  if (text.includes('zeiss')) return 'zeiss';

  // Unknown brand: no logo instead of a wrong fallback
  return null;
}

export async function loadLogoImage(brandId: string | null, isDarkTheme: boolean): Promise<HTMLImageElement | null> {
  if (!brandId) return null;
  const brand = BRAND_LOGOS.find((b) => b.id === brandId);
  if (!brand) return null;
  const url = isDarkTheme ? brand.lightSvg : brand.darkSvg;

  if (imageCache.has(url)) {
    return imageCache.get(url)!;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageCache.set(url, img);
      resolve(img);
    };
    img.onerror = () => {
      resolve(null);
    };
    img.src = url;
  });
}
