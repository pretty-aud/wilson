// Helper function to parse slide content
export const parseSlideContent = (content) => {
  const result = {
    title: '',
    subtitle: '',
    layoutStructure: '',
    copyContent: '',
    visualStyling: '',
    requiredAssets: '',
    placedAssets: '',
    componentGeometry: '',
    layoutType: '',
    pageNum: ''
  };

  if (!content) return result;

  // Try format 1: SLIDE #X — [LAYOUT TYPE: Layout Name]
  let headerMatch = content.match(/SLIDE\s*#\s*(\d+|X)\s*[—–\-]+\s*\[?\s*LAYOUT\s*TYPE\s*:?\s*([^\]\n]+)/i);

  // Try format 2: SLIDE #X — Layout Name (no brackets, no "LAYOUT TYPE:")
  if (!headerMatch) {
    headerMatch = content.match(/SLIDE\s*#\s*(\d+|X)\s*[—–\-]+\s*([^\n═]+)/i);
  }

  if (headerMatch) {
    result.pageNum = headerMatch[1].trim();
    result.layoutType = headerMatch[2].trim().replace(/\]$/, '').trim();
  }

  // Title - try ▸ TITLE: format first (handles both "▸ TITLE:\n  text" and "▸ TITLE: text")
  let titleMatch = content.match(/▸\s*TITLE\s*:\s*\n\s*([^\n]+)/i);
  if (!titleMatch) {
    // Try same-line format: ▸ TITLE: text
    titleMatch = content.match(/▸\s*TITLE\s*:\s+([^\n]+)/i);
  }
  if (titleMatch) {
    result.title = titleMatch[1].trim();
  } else {
    // Fallback: try markdown # header format
    titleMatch = content.match(/^#\s+([^\n]+)/m);
    if (titleMatch) {
      result.title = titleMatch[1].trim();
    }
  }

  // Subtitle - look for content on the same line or the very next line after ▸ SUBTITLE:
  // Must not cross blank lines or reach another ▸ section marker.
  // Strategy: first try same-line text, then try next-line text (only if next line is not blank/section marker).
  let subtitleText = '';
  const subtitleSameLine = content.match(/▸\s*SUBTITLE\s*:[^\S\n]+([^\n]+)/i);
  if (subtitleSameLine) {
    subtitleText = subtitleSameLine[1].trim();
  } else {
    // Try next line: must be non-empty and must not start with ▸ (allow leading whitespace)
    const subtitleNextLine = content.match(/▸\s*SUBTITLE\s*:[^\S\n]*\n[^\S\n]*([^\n▸\s][^\n]*)/i);
    if (subtitleNextLine) {
      subtitleText = subtitleNextLine[1].trim();
    }
  }
  if (!subtitleText) {
    // Fallback: try markdown ## header format
    const mdHeader = content.match(/^##\s+([^\n]+)/m);
    if (mdHeader) subtitleText = mdHeader[1].trim();
  }
  if (subtitleText) {
    result.subtitle = subtitleText;
  }

  const layoutMatch = content.match(/▸\s*LAYOUT STRUCTURE\s*:\s*\n([\s\S]*?)(?=\n▸|═{10,}|$)/i);
  if (layoutMatch) result.layoutStructure = layoutMatch[1].trim();

  const copyMatch = content.match(/▸\s*COPY\/TEXT CONTENT\s*:\s*\n([\s\S]*?)(?=\n▸|═{10,}|$)/i);
  if (copyMatch) result.copyContent = copyMatch[1].trim();

  const stylingMatch = content.match(/▸\s*VISUAL STYLING\s*:\s*\n([\s\S]*?)(?=\n▸|═{10,}|$)/i);
  if (stylingMatch) result.visualStyling = stylingMatch[1].trim();

  const assetsMatch = content.match(/▸\s*REQUIRED ASSETS\s*:\s*\n([\s\S]*?)(?=\n▸|═{10,}|$)/i);
  if (assetsMatch) result.requiredAssets = assetsMatch[1].trim();

  const placedMatch = content.match(/▸\s*PLACED ASSETS\s*:\s*\n([\s\S]*?)(?=\n▸|═{10,}|$)/i);
  if (placedMatch) result.placedAssets = placedMatch[1].trim();

  const geometryMatch = content.match(/▸\s*COMPONENT GEOMETRY\s*:\s*\n([\s\S]*?)(?=═{10,}|$)/i);
  if (geometryMatch) {
    // Extract the JSON from inside ```json ... ``` code block
    const jsonBlock = geometryMatch[1].match(/```json\s*\n?([\s\S]*?)```/);
    result.componentGeometry = jsonBlock ? jsonBlock[1].trim() : geometryMatch[1].trim();
  }

  console.log('parseSlideContent result:', {
    layoutType: result.layoutType,
    title: result.title,
    subtitle: result.subtitle,
    hasCopy: !!result.copyContent
  });

  return result;
};

// Post-process geometry JSON to fix icon_placeholder placement on title-type layouts.
// The visualizer renders icon ABOVE title for large centered logos, but the AI sometimes
// generates geometry with icon BELOW title. This corrects the geometry to match the visual.
export const TITLE_LAYOUT_NAMES = ['title slide', 'title page w/gradient', 'section header', 'section header w/gradient'];

export const correctGeometryIconOrder = (content) => {
  if (!content) return content;

  // Check if this is a title-type layout
  const headerMatch = content.match(/SLIDE\s*#\s*\d+\s*[—–\-]+\s*([^\n═]+)/i);
  if (!headerMatch) return content;
  const layoutName = headerMatch[1].trim().toLowerCase();
  const isTitleLayout = TITLE_LAYOUT_NAMES.some(name => layoutName.includes(name));
  if (!isTitleLayout) return content;

  // Find the COMPONENT GEOMETRY JSON block
  const geoSectionMatch = content.match(/(▸\s*COMPONENT GEOMETRY\s*:\s*\n\s*```json\s*\n)([\s\S]*?)(```)/i);
  if (!geoSectionMatch) return content;

  let geoJson;
  try {
    geoJson = JSON.parse(geoSectionMatch[2].trim());
  } catch (e) {
    return content; // Can't parse, leave unchanged
  }

  if (!geoJson.frames || !Array.isArray(geoJson.frames)) return content;

  const iconFrame = geoJson.frames.find(f => f.type === 'icon_placeholder');
  const titleFrame = geoJson.frames.find(f => f.type === 'text_title');

  // Only fix if both exist and icon is at or below title
  if (!iconFrame || !titleFrame || iconFrame.y < titleFrame.y) return content;

  // Check if this is a "large and centered" logo (not a small corner badge)
  const isLargeLogo = iconFrame.description &&
    (/large|centered|center/i.test(iconFrame.description));
  // Also check REQUIRED ASSETS for large/centered clues
  const assetsMatch = content.match(/▸\s*REQUIRED ASSETS\s*:\s*\n([\s\S]*?)(?=\n▸|═{10,}|$)/i);
  const assetsText = assetsMatch ? assetsMatch[1].toLowerCase() : '';
  const assetsHaveLargeLogo = assetsText.includes('large') || assetsText.includes('centered') || assetsText.includes('center');

  if (!isLargeLogo && !assetsHaveLargeLogo) return content; // Small corner badge, leave as-is

  // Swap y-coordinates: icon goes above title.
  // Use the icon's current y for title, and place icon above it with a gap.
  const subtitleFrame = geoJson.frames.find(f => f.type === 'text_subtitle');

  // Calculate corrected positions: icon at y=100, title at y=200, subtitle at y=270
  // (matches the few-shot examples and the centered flex layout rendering)
  const iconH = iconFrame.height || 80;
  const titleH = titleFrame.height || 60;
  const gap = 20;

  // Vertically center the group: icon + gap + title + (gap + subtitle if present)
  let totalGroupH = iconH + gap + titleH;
  const subtitleH = subtitleFrame ? (subtitleFrame.height || 40) : 0;
  if (subtitleFrame) totalGroupH += 10 + subtitleH; // 10pt gap before subtitle

  const canvasH = geoJson.canvas?.height || 405;
  const startY = Math.round((canvasH - totalGroupH) / 2);

  iconFrame.y = Math.max(30, startY); // respect top margin
  titleFrame.y = iconFrame.y + iconH + gap;
  if (subtitleFrame) {
    subtitleFrame.y = titleFrame.y + titleH + 10;
  }

  // Rebuild the JSON with consistent formatting
  const correctedJson = JSON.stringify(geoJson, null, 2);
  const correctedSection = geoSectionMatch[1] + correctedJson + '\n' + geoSectionMatch[3];

  return content.replace(geoSectionMatch[0], correctedSection);
};

// Parse ▸ PLACED ASSETS section into structured array
// Format: • filename.jpg → [Image | 16:9] - frame description
export const parsePlacedAssets = (placedAssetsText) => {
  if (!placedAssetsText) return [];
  const lines = placedAssetsText.split('\n').filter(l => l.trim().startsWith('•'));
  return lines.map(line => {
    const match = line.match(/•\s*(.+?)\s*→\s*\[([^\]]+)\]\s*-\s*(.+)/);
    if (!match) return null;
    const filename = match[1].trim();
    const typeAndRatio = match[2].trim();
    const description = match[3].trim();
    const ratioParts = typeAndRatio.split('|').map(s => s.trim());
    const assetType = ratioParts[0] || 'Image';
    const ratio = ratioParts[1] || '';
    return { filename, assetType, ratio, description };
  }).filter(Boolean);
};
