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

  // The header (format 1, SLIDE #X — [LAYOUT TYPE: Name], tried before format
  // 2, SLIDE #X — Name) and the title (▸ TITLE: on the next line or the same
  // line, else a markdown # heading) are read the way generation reads them:
  // slideHeader and slideTitle below (F6, A2).
  const header = slideHeader(content);
  if (header) {
    result.pageNum = header.pageNum;
    result.layoutType = header.layout;
  }
  result.title = slideTitle(content) ?? '';

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

  // (F4, 2026-11-13: this function logged its result at every call, and the
  // preview called it at every render: two lines in the console for each
  // letter typed anywhere in D.O.G. The log is gone.)
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
    const asset = parseAssetLine(line, { arrow: true });
    if (!asset) return null;
    return { filename: asset.filename, assetType: asset.type || 'Image', ratio: asset.ratio || '', description: asset.description };
  }).filter(Boolean);
};

// ═════════════════════════════════════════════════════════════════════════════
// ONE SLIDE FORMAT, READ IN ONE PLACE (F6, A2)
//
// D.O.G. read its own slide format in three places: generation's
// parseOutputToPages, the History import, and parseSlideContent above (the
// visualiser's and the exports' reader). Their copies accepted different
// shapes, so the same text could split one way when generated and another
// when imported. The header, the title and the frame are now these functions,
// used by all three. Where the two splitters still differ an output would
// change, so each keeps today's reading (`as`), pinned side by side in
// parser.test.js and recorded in docs/OUTSTANDING.md:
//   - import wants rules of 20 or more ═ around (format 1) or after (format 2)
//     the header; generation splits on 5 or more ═ anywhere.
//   - import's title is the literal "▸ TITLE:" and stops at ▸, with no
//     markdown fallback; generation's is slideTitle below.
//   - generation's last resort is a loose "SLIDE n" scan; import's is one item
//     holding the whole text as written.
// ═════════════════════════════════════════════════════════════════════════════

// Format 1: SLIDE #X — [LAYOUT TYPE: Layout Name]; format 2: SLIDE #X — Layout Name.
const HEADER_BRACKETED = /SLIDE\s*#\s*(\d+|X)\s*[—–\-]+\s*\[?\s*LAYOUT\s*TYPE\s*:?\s*([^\]\n]+)/i;
const HEADER_PLAIN = /SLIDE\s*#\s*(\d+|X)\s*[—–\-]+\s*([^\n═]+)/i;

/** A slide's header, format 1 tried before format 2: { pageNum, layout, match }
 *  (`match`: the header text as found), or null. */
export function slideHeader(text) {
  const m = text.match(HEADER_BRACKETED) || text.match(HEADER_PLAIN);
  if (!m) return null;
  return { pageNum: m[1].trim(), layout: m[2].trim().replace(/\]$/, '').trim(), match: m[0] };
}

/** A slide's title: "▸ TITLE:" with the text on the next line or the same
 *  line, else a markdown "# " heading; null when there is none. */
export function slideTitle(body) {
  const m = body.match(/▸\s*TITLE\s*:\s*\n\s*([^\n]+)/i)
    || body.match(/▸\s*TITLE\s*:\s+([^\n]+)/i)
    || body.match(/^#\s+([^\n]+)/m);
  return m ? m[1].trim() : null;
}

const RULE = '═'.repeat(63);

/** One slide in D.O.G.'s own frame (the header, a rule, the body, a rule),
 *  the geometry's icons put in reading order. */
export function frameSlide(pageNum, layout, body) {
  return correctGeometryIconOrder(`SLIDE #${pageNum} — ${layout}\n${RULE}\n\n${body}\n\n${RULE}`);
}

/**
 * Split a deck's text into slides: [{ pageNum, layout, title, content }].
 * `as: 'generation'` reads a model's answer; `as: 'import'` reads a
 * DECKOUTLINE file brought in through the History. See the header above.
 */
export function splitSlides(text, { as = 'generation' } = {}) {
  return as === 'import' ? splitImported(text) : splitGenerated(text);
}

function splitGenerated(output) {
  const pages = [];

  // Strategy 1: split on the rule lines; a header in a block starts a slide.
  const blocks = output.split(/═{5,}/);
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block) continue;
    const header = slideHeader(block);
    if (!header) continue;
    // The body is the rest of this block, or the next block when a rule
    // follows the header.
    let contentBody = block.replace(header.match, '').trim();
    if (!contentBody && blocks[i + 1]) {
      contentBody = blocks[i + 1].trim();
      i++;
    }
    pages.push({
      pageNum: header.pageNum,
      layout: header.layout,
      title: slideTitle(contentBody) ?? 'Untitled',
      content: frameSlide(header.pageNum, header.layout, contentBody),
    });
  }

  // Strategy 2: the headers themselves, each slide running to the next.
  if (pages.length === 0) {
    let matches = [...output.matchAll(new RegExp(HEADER_BRACKETED.source, 'gi'))];
    if (matches.length === 0) matches = [...output.matchAll(new RegExp(HEADER_PLAIN.source, 'gi'))];
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const pageNum = match[1].trim();
      const layout = match[2].trim().replace(/\]$/, '').trim();
      const startIdx = match.index + match[0].length;
      const endIdx = matches[i + 1] ? matches[i + 1].index : output.length;
      const contentBody = output.substring(startIdx, endIdx).trim()
        .replace(/^[═\s]+/g, '').replace(/[═\s]+$/g, '').trim();
      pages.push({
        pageNum,
        layout,
        title: slideTitle(contentBody) ?? 'Untitled',
        content: frameSlide(pageNum, layout, contentBody),
      });
    }
  }

  // Strategy 3: last resort, any "SLIDE n" at all, its block kept as written.
  if (pages.length === 0) {
    const looseMatches = [...output.matchAll(/SLIDE\s*#?\s*(\d+)/gi)];
    for (let i = 0; i < looseMatches.length; i++) {
      const match = looseMatches[i];
      const pageNum = match[1];
      const endIdx = looseMatches[i + 1] ? looseMatches[i + 1].index : output.length;
      const blockContent = output.substring(match.index, endIdx).trim();

      const layoutMatch = blockContent.match(/LAYOUT\s*(?:TYPE)?\s*:?\s*([^\]\n]+)/i);
      let layout = layoutMatch ? layoutMatch[1].trim().replace(/\]$/, '').trim() : '';
      if (!layout) {
        const slideLayoutMatch = blockContent.match(/SLIDE\s*#\s*\d+\s*[—–\-]+\s*([^\n═]+)/i);
        layout = slideLayoutMatch ? slideLayoutMatch[1].trim() : 'Title and body';
      }

      const titleMatch = blockContent.match(/▸?\s*TITLE\s*:\s*\n\s*([^\n▸]+)/i)
        || blockContent.match(/▸?\s*TITLE\s*:\s+([^\n▸]+)/i)
        || blockContent.match(/^#\s+([^\n]+)/m);

      pages.push({
        pageNum,
        layout,
        title: titleMatch ? titleMatch[1].trim() : 'Slide ' + pageNum,
        content: correctGeometryIconOrder(blockContent),
      });
    }
  }

  return pages;
}

function importedTitle(text) {
  const m = text.match(/▸ TITLE:\s*\n([^\n▸]+)/) || text.match(/▸ TITLE:\s+([^\n▸]+)/);
  return m ? m[1].trim() : 'Untitled';
}

function splitImported(importText) {
  const slides = [];
  const take = (pattern) => {
    let match;
    while ((match = pattern.exec(importText)) !== null) {
      const layout = match[2].trim();
      const contentBody = match[3].trim();
      slides.push({
        pageNum: match[1],
        layout,
        title: importedTitle(contentBody),
        content: frameSlide(match[1], layout, contentBody),
      });
    }
  };

  // Format 1: SLIDE #X — [LAYOUT TYPE: Layout Name], between rules of 20+ ═.
  take(/═{20,}\s*\nSLIDE\s*#(\d+|X)\s*[—–\-]+\s*\[LAYOUT TYPE:\s*([^\]]+)\]\s*\n═{20,}\s*\n([\s\S]*?)(?=═{20,}\s*\nSLIDE\s*#|$)/gi);
  // Format 2: SLIDE #X — Layout Name, a rule of 20+ ═ after it.
  if (slides.length === 0) {
    take(/SLIDE\s*#(\d+|X)\s*[—–\-]+\s*([^\n═]+)\s*\n═{20,}\s*\n([\s\S]*?)(?=SLIDE\s*#\d|$)/gi);
  }
  // Fallback: one slide, the whole text as written.
  if (slides.length === 0 && importText.includes('SLIDE #')) {
    const headerMatch = importText.match(/SLIDE\s*#(\d+|X)\s*[—–\-]+\s*\[LAYOUT TYPE:\s*([^\]]+)\]/i)
      || importText.match(/SLIDE\s*#(\d+|X)\s*[—–\-]+\s*([^\n═]+)/i);
    if (headerMatch) {
      slides.push({
        pageNum: headerMatch[1],
        layout: headerMatch[2].trim(),
        title: importedTitle(importText),
        content: correctGeometryIconOrder(importText.trim()),
      });
    }
  }
  return slides;
}

// ── One asset line ───────────────────────────────────────────────────────────
// "• [Type | RATIO] - description" (REQUIRED ASSETS), or with `arrow`,
// "• filename → [Type | RATIO] - description" (PLACED ASSETS). The parts come
// back trimmed and otherwise raw: each caller keeps its own defaults (a placed
// asset is an 'Image' with no ratio; an image prompt's ratio is 'N/A'). The
// visualiser reads its frames its own way (any piece of the section, a bullet
// or not) and is recorded, not changed.
const ASSET_LINE = /•\s*\[([^\]]+)\]\s*-\s*(.+)/;
const PLACED_LINE = /•\s*(.+?)\s*→\s*\[([^\]]+)\]\s*-\s*(.+)/;

export function parseAssetLine(line, { arrow = false } = {}) {
  const m = line.match(arrow ? PLACED_LINE : ASSET_LINE);
  if (!m) return null;
  const [type, ratio] = (arrow ? m[2] : m[1]).trim().split('|').map(s => s.trim());
  return {
    filename: arrow ? m[1].trim() : undefined,
    type,
    ratio,
    description: (arrow ? m[3] : m[2]).trim(),
  };
}
