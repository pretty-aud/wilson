// Module-scope color helpers — shared by LayoutVisualizer and export logic
export const getLuminance = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
};

export const getContrastRatio = (hex1, hex2) => {
  const l1 = getLuminance(hex1);
  const l2 = getLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
};

export const ensureContrast = (palette) => {
  const result = [...palette];
  while (result.length < 4) result.push('#e0e0e0');
  const bg = result[0];
  const bgLum = getLuminance(bg);
  const isLightBg = bgLum > 0.4;
  if (getContrastRatio(bg, result[1]) < 4.0) {
    result[1] = isLightBg ? '#1a1a1a' : '#ffffff';
  }
  if (getContrastRatio(bg, result[2]) < 2.5) {
    result[2] = isLightBg ? '#555555' : '#aaaaaa';
  }
  if (getContrastRatio(bg, result[3]) < 3.5) {
    result[3] = isLightBg ? '#2d2d2d' : '#e0e0e0';
  }
  return result;
};
