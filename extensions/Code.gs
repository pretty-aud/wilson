// ═══════════════════════════════════════════════════════════════
// D.O.G. Bridge — Google Slides Extension
// Server-Side Apps Script (Code.gs)
// ═══════════════════════════════════════════════════════════════
// Reads structured markdown outlines from the Deck Outline
// Generator and programmatically builds Google Slides decks
// with precise coordinate-based placement.
// ═══════════════════════════════════════════════════════════════

// ── Menu & Sidebar ──────────────────────────────────────────

function onOpen() {
  SlidesApp.getUi()
    .createMenu('D.O.G. Bridge')
    .addItem('Open Sidebar', 'showSidebar')
    .addToUi();
}

function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('D.O.G. Bridge')
    .setWidth(320);
  SlidesApp.getUi().showSidebar(html);
}

// ── Constants ───────────────────────────────────────────────

var CANVAS = { width: 720, height: 405 };
var SAFE_AREA = { left: 36, right: 684, top: 30, bottom: 370 };
var PT_PER_INCH = 72;

// Default settings (overridable from sidebar)
var DEFAULT_SETTINGS = {
  defaultFontFamily: '',
  titleFontSize: 24,
  subtitleFontSize: 13,
  bodyFontSize: 12,
  placeholderStyle: 'gray_with_label',
  dateFormatOverride: '',
  debugMode: false
};

// ── Polyfills (for older Apps Script runtimes) ──────────────

if (!String.prototype.padStart) {
  String.prototype.padStart = function(targetLength, padString) {
    targetLength = targetLength >> 0;
    padString = String(typeof padString !== 'undefined' ? padString : ' ');
    if (this.length >= targetLength) return String(this);
    targetLength = targetLength - this.length;
    if (targetLength > padString.length) {
      padString += padString.repeat(targetLength / padString.length);
    }
    return padString.slice(0, targetLength) + String(this);
  };
}

// ── Main Entry Point ────────────────────────────────────────

/**
 * Main function called from the sidebar.
 * @param {Object} params - { outlineText, mode, pageNumber, useTheme, useAssets, assetFolderId, settings }
 * @return {Object} - { success, message, slideCount, warnings }
 */
function createDeck(params) {
  var warnings = [];
  var settings = mergeSettings(params.settings || {});

  try {
    debugLog(settings, '=== D.O.G. Bridge: Starting deck creation ===');

    // Step 1: Parse the outline
    debugLog(settings, 'Step 1: Parsing outline...');
    var parsed = parseOutline(params.outlineText);
    debugLog(settings, 'Detected format: ' + (parsed.isFormatB ? 'B (VIS_DECKOUTLINE)' : 'A (DECKOUTLINE)'));
    debugLog(settings, 'Slides parsed: ' + parsed.slides.length);

    if (parsed.slides.length === 0) {
      return { success: false, message: 'No slides found in the outline.', slideCount: 0, warnings: warnings };
    }

    var presentation = SlidesApp.getActivePresentation();

    // Step 2: Create slides
    debugLog(settings, 'Step 2: Creating slides...');
    var createdSlides;
    if (params.mode === 'single') {
      var pageNum = parseInt(params.pageNumber, 10);
      createdSlides = createSingleSlide(presentation, parsed, pageNum, settings);
    } else {
      createdSlides = createFullDeck(presentation, parsed, settings);
    }
    debugLog(settings, 'Slides created: ' + createdSlides.length);

    // Step 3: Apply theme colors
    if (params.useTheme && parsed.isFormatB && parsed.theme) {
      debugLog(settings, 'Step 3: Applying theme colors...');
      applyThemeColors(presentation, parsed.theme, settings);
    } else {
      debugLog(settings, 'Step 3: Skipping theme colors (useTheme=' + params.useTheme + ', isFormatB=' + parsed.isFormatB + ')');
    }

    // Steps 4-7: Position elements, inject text, create asset frames
    for (var i = 0; i < createdSlides.length; i++) {
      var slideInfo = createdSlides[i];
      debugLog(settings, 'Processing slide ' + (i + 1) + '/' + createdSlides.length + ': ' + slideInfo.parsedSlide.title);

      // Step 4 & 5: Position text boxes and inject content
      positionAndInjectText(slideInfo.slide, slideInfo.parsedSlide, settings, warnings);

      // Step 7: Create image/asset placeholder frames
      createAssetFrames(slideInfo.slide, slideInfo.parsedSlide, settings);
    }

    // Step 6: Header & footer setup
    debugLog(settings, 'Step 6: Setting up headers & footers...');
    var themeBodyColor = (params.useTheme && parsed.isFormatB && parsed.theme && parsed.theme.colors && parsed.theme.colors.length >= 4) ? parsed.theme.colors[3] : null;
    setupHeaderFooter(presentation, parsed, settings, themeBodyColor);

    // Step 8: Place visual assets
    if (params.useAssets && params.assetFolderId) {
      debugLog(settings, 'Step 8: Placing visual assets...');
      placeAssets(createdSlides, parsed, params.assetFolderId, settings, warnings);
    } else {
      debugLog(settings, 'Step 8: Skipping asset placement');
    }

    // Step 9: Validation pass
    debugLog(settings, 'Step 9: Running validation pass...');
    runValidation(createdSlides, settings, warnings);

    debugLog(settings, '=== D.O.G. Bridge: Deck creation complete ===');
    return {
      success: true,
      message: 'Deck created successfully! ' + createdSlides.length + ' slides built.',
      slideCount: createdSlides.length,
      warnings: warnings
    };

  } catch (e) {
    Logger.log('D.O.G. Bridge Error: ' + e.message + '\n' + e.stack);
    return {
      success: false,
      message: 'Error: ' + e.message,
      slideCount: 0,
      warnings: warnings
    };
  }
}

// ── Settings Merge ──────────────────────────────────────────

function mergeSettings(userSettings) {
  var merged = {};
  for (var key in DEFAULT_SETTINGS) {
    merged[key] = (userSettings[key] !== undefined && userSettings[key] !== '')
      ? userSettings[key]
      : DEFAULT_SETTINGS[key];
  }
  // Ensure numeric types
  merged.titleFontSize = Number(merged.titleFontSize) || 24;
  merged.subtitleFontSize = Number(merged.subtitleFontSize) || 16;
  merged.bodyFontSize = Number(merged.bodyFontSize) || 12;
  merged.debugMode = !!merged.debugMode;
  return merged;
}

function debugLog(settings, msg) {
  if (settings.debugMode) {
    Logger.log('[D.O.G. Bridge] ' + msg);
  }
}

// ═══════════════════════════════════════════════════════════════
// STEP 1: OUTLINE PARSER
// ═══════════════════════════════════════════════════════════════

/**
 * Parse the full outline text into structured data.
 * @param {string} text - The raw markdown content
 * @return {Object} - { isFormatB, theme, alternateThemes, deckTitle, pageCount, visualDescription, slides[] }
 */
function parseOutline(text) {
  var result = {
    isFormatB: false,
    theme: null,
    alternateThemes: [],
    deckTitle: '',
    pageCount: 0,
    visualDescription: '',
    slides: []
  };

  // Normalize line endings
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Detect Format B by checking for SELECTED THEME header
  var themeMatch = text.match(/\u25B8\s*SELECTED THEME:\s*([^\u2014\n]+)[\u2014\u2013-]\s*(#[0-9a-fA-F]{6}(?:\s*,\s*#[0-9a-fA-F]{6})*)/i);
  if (themeMatch) {
    result.isFormatB = true;
    result.theme = {
      name: themeMatch[1].trim(),
      colors: themeMatch[2].split(/\s*,\s*/).map(function(c) { return c.trim(); })
    };

    // Extract deck title
    var titleMatch = text.match(/\u25B8\s*DECK TITLE:\s*(.+)/i);
    if (titleMatch) result.deckTitle = titleMatch[1].trim();

    // Extract page count
    var countMatch = text.match(/\u25B8\s*PAGE COUNT:\s*(\d+)/i);
    if (countMatch) result.pageCount = parseInt(countMatch[1], 10);

    // Extract visual description
    var descMatch = text.match(/\u25B8\s*VISUAL DESCRIPTION:\s*(.+)/i);
    if (descMatch) result.visualDescription = descMatch[1].trim();

    // Extract alternate themes from footer
    var altSection = text.match(/ALTERNATE THEME COLORS[\s\S]*?\u2550{10,}([\s\S]*?)\u2550{10,}/);
    if (altSection) {
      var altLines = altSection[1].split('\n');
      for (var a = 0; a < altLines.length; a++) {
        var altMatch = altLines[a].match(/•\s*([^:]+):\s*(#[0-9a-fA-F]{6}(?:\s*,\s*#[0-9a-fA-F]{6})*)/);
        if (altMatch) {
          result.alternateThemes.push({
            name: altMatch[1].trim(),
            colors: altMatch[2].split(/\s*,\s*/).map(function(c) { return c.trim(); })
          });
        }
      }
    }
  }

  // Split into slide blocks using the delimiter line (60+ ═ chars)
  // The slide header "SLIDE #N" starts each block
  var slideBlocks = extractSlideBlocks(text);

  for (var i = 0; i < slideBlocks.length; i++) {
    var slideData = parseSlideBlock(slideBlocks[i]);
    if (slideData) {
      result.slides.push(slideData);
    }
  }

  // Sort slides by page number
  result.slides.sort(function(a, b) { return a.pageNumber - b.pageNumber; });

  return result;
}

/**
 * Extract individual slide text blocks from the full outline.
 */
function extractSlideBlocks(text) {
  var blocks = [];
  // Split on delimiter lines (10+ ═ chars)
  var parts = text.split(/\u2550{10,}/);

  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    // A slide block must contain a SLIDE # header
    if (/SLIDE\s*#\s*\d+/i.test(part)) {
      // Check if the ▸ sections are in this same part or in the next part
      if (part.indexOf('\u25B8') >= 0) {
        // Content is in same part (already combined)
        blocks.push(part);
      } else if (i + 1 < parts.length) {
        // Content is in the next part (separated by delimiter)
        // Merge header with the following content block
        var nextPart = parts[i + 1].trim();
        blocks.push(part + '\n\n' + nextPart);
        i++; // Skip the content part since we've consumed it
      } else {
        blocks.push(part);
      }
    }
  }
  return blocks;
}

/**
 * Parse a single slide block into structured data.
 * @param {string} block - Raw text of one slide
 * @return {Object|null} - Parsed slide data
 */
function parseSlideBlock(block) {
  // Extract slide number and layout name from the first line
  // Matches: "SLIDE #1 — Title slide" or "SLIDE #2 — [LAYOUT_TYPE: Title and body]"
  var firstLine = block.split('\n')[0].trim();
  var headerMatch = firstLine.match(/SLIDE\s*#\s*(\d+)\s*[\u2014\u2013\-]+\s*(.+)/i);
  if (!headerMatch) return null;

  // Clean up layout name: remove brackets, "LAYOUT_TYPE:" prefix, trim
  var rawLayout = headerMatch[2].trim();
  rawLayout = rawLayout.replace(/^\[/, '').replace(/\]$/, '').trim();
  rawLayout = rawLayout.replace(/^[A-Z_]+:\s*/i, '').trim();

  var slide = {
    pageNumber: parseInt(headerMatch[1], 10),
    layoutName: rawLayout,
    title: '',
    subtitle: '',
    layoutStructure: '',
    copyContent: '',
    copySections: [],
    visualStyling: '',
    requiredAssets: [],
    geometry: null
  };

  // Extract each section using ▸ markers
  slide.title = extractSection(block, 'TITLE');
  slide.subtitle = extractSection(block, 'SUBTITLE');
  slide.layoutStructure = extractSection(block, 'LAYOUT STRUCTURE');
  slide.copyContent = extractSection(block, 'COPY[/]TEXT CONTENT');
  slide.visualStyling = extractSection(block, 'VISUAL STYLING');

  // Parse required assets
  var assetsRaw = extractSection(block, 'REQUIRED ASSETS');
  if (assetsRaw) {
    var assetLines = assetsRaw.split('\n');
    for (var i = 0; i < assetLines.length; i++) {
      var assetMatch = assetLines[i].match(/\u2022\s*\[([^\]]+)\]\s*[-\u2013\u2014]\s*(.+)/);
      if (assetMatch) {
        slide.requiredAssets.push({
          type: assetMatch[1].trim(),
          description: assetMatch[2].trim()
        });
      }
    }
  }

  // Parse component geometry JSON
  var geomSection = extractSection(block, 'COMPONENT GEOMETRY');
  if (geomSection) {
    var jsonMatch = geomSection.match(/```json\s*\n?([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        slide.geometry = JSON.parse(jsonMatch[1].trim());
      } catch (e) {
        Logger.log('Failed to parse geometry JSON for slide #' + slide.pageNumber + ': ' + e.message);
      }
    } else {
      // Try parsing without code fences (sometimes raw JSON)
      var rawJsonMatch = geomSection.match(/\{[\s\S]*"frames"[\s\S]*\}/);
      if (rawJsonMatch) {
        try {
          slide.geometry = JSON.parse(rawJsonMatch[0]);
        } catch (e2) {
          Logger.log('Failed to parse raw geometry JSON for slide #' + slide.pageNumber);
        }
      }
    }
  }

  // Parse copy sections (split by --- for columns)
  if (slide.copyContent) {
    slide.copySections = slide.copyContent.split(/\n---\n/).map(function(s) { return s.trim(); });
  }

  return slide;
}

/**
 * Extract the content following a ▸ SECTION_NAME: marker.
 * Captures everything until the next ▸ marker or end of block.
 * Uses negative lookbehind-style matching to avoid partial matches
 * (e.g., "TITLE" should not match "SUBTITLE").
 */
function extractSection(block, sectionName) {
  // Use a two-step approach: find all ▸ sections, then match the right one
  var allSections = block.split(/\n(?=\u25B8)/);
  var targetRegex = new RegExp('^\u25B8\\s*(?:' + sectionName + ')\\s*:', 'i');

  for (var i = 0; i < allSections.length; i++) {
    var section = allSections[i].trim();
    if (targetRegex.test(section)) {
      // Remove the header line and return the content
      var content = section.replace(targetRegex, '').trim();
      return content;
    }
  }
  return '';
}

// ═══════════════════════════════════════════════════════════════
// STEP 2: SLIDE CREATION & LAYOUT MATCHING
// ═══════════════════════════════════════════════════════════════

/**
 * Layout name mapping for fuzzy matching.
 * Maps DOG layout names (lowercase) to arrays of possible Google Slides
 * layout names to try matching against. getLayoutName() returns ENUM-style
 * names like "TITLE_AND_TWO_COLUMNS", "SECTION_HEADER", etc.
 * We normalize everything to lowercase with underscores for comparison.
 */
var LAYOUT_MAPPING = {
  'title slide':                    ['title', 'title_1'],
  'section header':                 ['section_header'],
  'title and body':                 ['title_and_body'],
  'title and two columns':          ['title_and_two_columns'],
  'title and three columns':        ['title_and_two_columns_1', 'title_and_two_columns', 'blank'],
  'title and four columns':         ['title_and_two_columns_1_1', 'title_and_two_columns_1', 'blank'],
  'title only':                     ['title_only'],
  'one column text':                ['one_column_text', 'title_and_body'],
  'main point':                     ['main_point', 'title_only', 'section_header'],
  'section title and description':  ['section_title_and_description', 'section_header'],
  'caption':                        ['caption_only'],
  'big number':                     ['big_number', 'title_only', 'main_point'],
  'blank':                          ['blank'],
  'section header w/gradient':      ['section_header'],
  'section header w/ gradient':     ['section_header'],
  'title page w/gradient':          ['title_1', 'title_1_1', 'title'],
  'title page w/ gradient':         ['title_1', 'title_1_1', 'title'],
  'two columns':                    ['title_and_two_columns']
};

/**
 * Normalize a layout name to a common form for comparison.
 * Converts to lowercase, replaces spaces with underscores, strips non-alphanumeric chars.
 */
function normalizeLayoutName(name) {
  return name.toLowerCase().trim().replace(/\s+/g, '_');
}

/**
 * Find the best matching layout from the presentation's theme.
 * Uses a multi-tier strategy: exact → mapping table → substring → word overlap → BLANK fallback.
 * Note: getLayoutName() returns ENUM-style names like "TITLE_AND_TWO_COLUMNS".
 */
function findMatchingLayout(presentation, layoutName, settings) {
  var layouts = presentation.getLayouts();
  // Normalize incoming DOG layout name: "Title and two columns" → "title_and_two_columns"
  var normalizedName = normalizeLayoutName(layoutName);

  // Build a lookup array of normalized layout names
  var normalizedLayoutNames = [];
  for (var n = 0; n < layouts.length; n++) {
    normalizedLayoutNames.push(normalizeLayoutName(layouts[n].getLayoutName()));
  }

  // Log all available layouts in debug mode
  debugLog(settings, 'Matching layout: "' + layoutName + '" (normalized: "' + normalizedName + '")');
  debugLog(settings, 'Available layouts: [' + normalizedLayoutNames.join(', ') + ']');

  // Tier 1: Direct exact match (normalized)
  for (var i = 0; i < layouts.length; i++) {
    if (normalizedLayoutNames[i] === normalizedName) {
      debugLog(settings, 'Layout match (exact): "' + layoutName + '" → "' + layouts[i].getLayoutName() + '"');
      return layouts[i];
    }
  }

  // Tier 2: Mapping table — try each candidate in order
  var candidates = LAYOUT_MAPPING[normalizedName.replace(/_/g, ' ')];
  if (!candidates) {
    // Also try the underscore form as key
    candidates = LAYOUT_MAPPING[normalizedName];
  }
  if (candidates) {
    for (var c = 0; c < candidates.length; c++) {
      var candidateNorm = normalizeLayoutName(candidates[c]);
      for (var j = 0; j < layouts.length; j++) {
        if (normalizedLayoutNames[j] === candidateNorm) {
          debugLog(settings, 'Layout match (mapped): "' + layoutName + '" → "' + layouts[j].getLayoutName() + '"');
          return layouts[j];
        }
      }
    }
  }

  // Tier 3: Fuzzy substring match (bidirectional, using normalized names)
  for (var k = 0; k < layouts.length; k++) {
    if (normalizedLayoutNames[k].indexOf(normalizedName) !== -1 || normalizedName.indexOf(normalizedLayoutNames[k]) !== -1) {
      debugLog(settings, 'Layout match (fuzzy): "' + layoutName + '" → "' + layouts[k].getLayoutName() + '"');
      return layouts[k];
    }
  }

  // Tier 4: Word overlap matching (need at least 2 shared words)
  var nameWords = normalizedName.split(/_+/);
  var bestScore = 0;
  var bestLayout = null;
  for (var m = 0; m < layouts.length; m++) {
    var candidateWords = normalizedLayoutNames[m].split(/_+/);
    var score = 0;
    for (var w = 0; w < nameWords.length; w++) {
      if (nameWords[w].length > 1 && candidateWords.indexOf(nameWords[w]) !== -1) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestLayout = layouts[m];
    }
  }
  if (bestScore >= 2 && bestLayout) {
    debugLog(settings, 'Layout match (word overlap ' + bestScore + '): "' + layoutName + '" → "' + bestLayout.getLayoutName() + '"');
    return bestLayout;
  }

  // Tier 5: Fallback to BLANK
  for (var b = 0; b < layouts.length; b++) {
    if (normalizedLayoutNames[b] === 'blank') {
      debugLog(settings, 'Layout match (fallback): "' + layoutName + '" → BLANK');
      return layouts[b];
    }
  }

  // Last resort: first layout
  debugLog(settings, 'Layout match (last resort): "' + layoutName + '" → "' + layouts[0].getLayoutName() + '"');
  return layouts[0];
}

/**
 * Create all slides for a full deck.
 */
function createFullDeck(presentation, parsed, settings) {
  var createdSlides = [];

  // Remove all existing slides
  var existingSlides = presentation.getSlides();
  for (var r = existingSlides.length - 1; r >= 0; r--) {
    existingSlides[r].remove();
  }

  for (var i = 0; i < parsed.slides.length; i++) {
    var slideData = parsed.slides[i];
    var layout = findMatchingLayout(presentation, slideData.layoutName, settings);
    var newSlide = presentation.appendSlide(layout);

    createdSlides.push({
      slide: newSlide,
      parsedSlide: slideData,
      index: i
    });
  }

  return createdSlides;
}

/**
 * Create/replace a single slide at a specific page position.
 */
function createSingleSlide(presentation, parsed, pageNum, settings) {
  // Find the slide data for the requested page number
  var slideData = null;
  for (var i = 0; i < parsed.slides.length; i++) {
    if (parsed.slides[i].pageNumber === pageNum) {
      slideData = parsed.slides[i];
      break;
    }
  }

  if (!slideData) {
    throw new Error('Slide #' + pageNum + ' not found in the outline.');
  }

  var existingSlides = presentation.getSlides();
  var slideIndex = pageNum - 1; // 0-based index

  if (slideIndex < 0 || slideIndex >= existingSlides.length) {
    throw new Error('Page number ' + pageNum + ' is out of range. Deck has ' + existingSlides.length + ' slides.');
  }

  // Create the new slide with matched layout
  var layout = findMatchingLayout(presentation, slideData.layoutName, settings);
  var newSlide;

  if (slideIndex === 0) {
    // Insert at the beginning
    newSlide = presentation.insertSlide(0, layout);
    // Remove the old slide (now at index 1)
    presentation.getSlides()[1].remove();
  } else {
    // Insert after the previous slide
    newSlide = presentation.insertSlide(slideIndex, layout);
    // Remove the old slide (now shifted to slideIndex + 1)
    presentation.getSlides()[slideIndex + 1].remove();
  }

  return [{
    slide: newSlide,
    parsedSlide: slideData,
    index: slideIndex
  }];
}

// ═══════════════════════════════════════════════════════════════
// STEP 3: THEME COLOR APPLICATION
// ═══════════════════════════════════════════════════════════════

/**
 * Apply theme colors from the outline to the presentation.
 * Color array: [background, accent, secondary, bodyText]
 */
function applyThemeColors(presentation, theme, settings) {
  if (!theme || !theme.colors || theme.colors.length < 4) {
    debugLog(settings, 'Theme colors incomplete, skipping.');
    return;
  }

  var bgColor = theme.colors[0];
  var accentColor = theme.colors[1];
  var secondaryColor = theme.colors[2];
  var bodyTextColor = theme.colors[3];

  debugLog(settings, 'Theme: bg=' + bgColor + ' accent=' + accentColor + ' secondary=' + secondaryColor + ' body=' + bodyTextColor);

  // Apply background color to all slides
  var slides = presentation.getSlides();
  for (var i = 0; i < slides.length; i++) {
    slides[i].getBackground().setSolidFill(bgColor);
  }

  // Apply colors to masters
  var masters = presentation.getMasters();
  for (var m = 0; m < masters.length; m++) {
    applyThemeToPageElements(masters[m], bgColor, accentColor, secondaryColor, bodyTextColor, settings);
  }

  // Also apply to layouts
  var layouts = presentation.getLayouts();
  for (var l = 0; l < layouts.length; l++) {
    applyThemeToPageElements(layouts[l], bgColor, accentColor, secondaryColor, bodyTextColor, settings);
  }
}

/**
 * Set background and style all placeholders on a single page (master or layout).
 */
function applyThemeToPageElements(page, bgColor, accentColor, secondaryColor, bodyTextColor, settings) {
  page.getBackground().setSolidFill(bgColor);
  var elements = page.getPageElements();
  for (var i = 0; i < elements.length; i++) {
    applyThemeToElement(elements[i], accentColor, secondaryColor, bodyTextColor, settings);
  }
}

/**
 * Apply theme colors to a page element based on its placeholder type.
 */
function applyThemeToElement(element, accentColor, secondaryColor, bodyTextColor, settings) {
  try {
    if (element.getPageElementType() !== SlidesApp.PageElementType.SHAPE) return;

    var shape = element.asShape();
    var phType = shape.getPlaceholderType();

    if (!phType || phType === SlidesApp.PlaceholderType.NONE) return;

    var color = null;
    if (phType === SlidesApp.PlaceholderType.TITLE || phType === SlidesApp.PlaceholderType.CENTERED_TITLE) {
      color = accentColor;
    } else if (phType === SlidesApp.PlaceholderType.SUBTITLE) {
      color = secondaryColor;
    } else if (phType === SlidesApp.PlaceholderType.BODY) {
      color = bodyTextColor;
    } else if (phType === SlidesApp.PlaceholderType.HEADER ||
               phType === SlidesApp.PlaceholderType.FOOTER ||
               phType === SlidesApp.PlaceholderType.DATE_AND_TIME ||
               phType === SlidesApp.PlaceholderType.SLIDE_NUMBER) {
      color = bodyTextColor;
    }

    if (color) {
      var textRange = shape.getText();
      if (textRange) {
        textRange.getTextStyle().setForegroundColor(color);
      }
    }
  } catch (e) {
    debugLog(settings, 'applyThemeToElement error: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// STEPS 4 & 5: TEXT BOX POSITIONING & CONTENT INJECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Check whether the parsed slide has a non-empty, non-placeholder subtitle.
 */
function hasSubtitle(parsedSlide) {
  return !!(parsedSlide.subtitle && parsedSlide.subtitle !== 'N/A');
}

/**
 * Position text boxes from geometry and inject text content.
 */
function positionAndInjectText(slide, parsedSlide, settings, warnings) {
  var geometry = parsedSlide.geometry;
  if (!geometry || !geometry.frames) {
    debugLog(settings, 'No geometry for slide #' + parsedSlide.pageNumber + ', using placeholder-based injection');
    injectTextToPlaceholders(slide, parsedSlide, settings, warnings);
    return;
  }

  // Gather text frames from geometry
  var textFrames = {
    title: [],
    subtitle: [],
    body: []
  };

  for (var i = 0; i < geometry.frames.length; i++) {
    var frame = geometry.frames[i];
    if (frame.type === 'text_title') textFrames.title.push(frame);
    else if (frame.type === 'text_subtitle') textFrames.subtitle.push(frame);
    else if (frame.type === 'text_body') textFrames.body.push(frame);
  }

  // Detect section_header layouts where template positions title/subtitle are swapped
  var layoutLower = (parsedSlide.layoutName || '').toLowerCase();
  var isSectionHeader = layoutLower.indexOf('section header') !== -1 || layoutLower === 'main point';

  // Get existing placeholders on the slide
  var existingElements = slide.getPageElements();
  var placeholders = { title: null, subtitle: null, body: [] };

  for (var j = 0; j < existingElements.length; j++) {
    try {
      if (existingElements[j].getPageElementType() === SlidesApp.PageElementType.SHAPE) {
        var shape = existingElements[j].asShape();
        var phType = shape.getPlaceholderType();
        if (phType === SlidesApp.PlaceholderType.TITLE || phType === SlidesApp.PlaceholderType.CENTERED_TITLE) {
          placeholders.title = shape;
        } else if (phType === SlidesApp.PlaceholderType.SUBTITLE) {
          placeholders.subtitle = shape;
        } else if (phType === SlidesApp.PlaceholderType.BODY) {
          placeholders.body.push(shape);
        }
      }
    } catch (e) { /* skip non-shape elements */ }
  }

  // Position and fill title
  if (textFrames.title.length > 0) {
    var titleFrame = textFrames.title[0];
    var titleShape;
    if (placeholders.title) {
      // Use existing template text box — only scale dimensions, keep position
      titleShape = placeholders.title;
      if (isSectionHeader) {
        // Section header templates have swapped title/subtitle positions — override with geometry
        positionElement(titleShape, titleFrame);
      } else {
        scaleElement(titleShape, titleFrame);
      }
    } else {
      titleShape = createTextBox(slide, titleFrame);
    }
    injectFormattedText(titleShape, parsedSlide.title, settings.titleFontSize, true, settings);
    // Tighten title paragraph spacing to reduce gap before subtitle
    try {
      var titleParas = titleShape.getText().getParagraphs();
      for (var tp = 0; tp < titleParas.length; tp++) {
        titleParas[tp].getRange().getParagraphStyle().setSpaceBelow(0);
      }
    } catch (e) { /* best effort */ }
    // Ensure title font size is always larger than body section headers
    try {
      var currentTitleSize = titleShape.getText().getTextStyle().getFontSize();
      var minTitleSize = settings.bodyFontSize + 2;
      if (currentTitleSize && currentTitleSize < minTitleSize) {
        titleShape.getText().getTextStyle().setFontSize(minTitleSize);
        debugLog(settings, 'Title font guardrail: bumped from ' + currentTitleSize + 'pt to ' + minTitleSize + 'pt (must exceed body ' + settings.bodyFontSize + 'pt)');
      }
    } catch (e) { /* best effort */ }

  }

  // Position and fill subtitle
  if (textFrames.subtitle.length > 0 && hasSubtitle(parsedSlide)) {
    var subtitleFrame = textFrames.subtitle[0];
    var subtitleShape;
    if (placeholders.subtitle) {
      subtitleShape = placeholders.subtitle;
      if (isSectionHeader) {
        positionElement(subtitleShape, subtitleFrame);
      } else {
        scaleElement(subtitleShape, subtitleFrame);
      }
    } else {
      subtitleShape = createTextBox(slide, subtitleFrame);
    }
    injectFormattedText(subtitleShape, parsedSlide.subtitle, settings.subtitleFontSize, false, settings);
    // Tighten subtitle paragraph spacing to reduce gap before body
    try {
      var subParas = subtitleShape.getText().getParagraphs();
      for (var sp = 0; sp < subParas.length; sp++) {
        subParas[sp].getRange().getParagraphStyle().setSpaceBelow(2);
      }
    } catch (e) { /* best effort */ }
  } else if (!hasSubtitle(parsedSlide)) {
    // Remove the subtitle placeholder when there's no subtitle content
    // (setting text to empty still shows "Click to add subtitle" ghost text)
    if (placeholders.subtitle) {
      placeholders.subtitle.remove();
    }
  }

  // Position and fill body text boxes
  // Sort body frames by x-coordinate (left to right) for column assignment
  textFrames.body.sort(function(a, b) { return a.x - b.x; });

  // Sort existing body placeholders by position
  placeholders.body.sort(function(a, b) {
    return a.getLeft() - b.getLeft();
  });

  // For multi-column layouts (2+ body frames), use full positionElement
  // because the body text must go to specific geometry positions (e.g., below images).
  // For single-body layouts, preserve template position with scaleElement.
  var isMultiBody = textFrames.body.length > 1;

  for (var b = 0; b < textFrames.body.length; b++) {
    var bodyFrame = textFrames.body[b];
    var bodyShape;

    if (b < placeholders.body.length) {
      bodyShape = placeholders.body[b];
      if (isMultiBody) {
        // Multi-column: must position precisely per geometry
        positionElement(bodyShape, bodyFrame);
      } else {
        // Single body: use positionElement when subtitle exists and geometry specifies
        // a different y-position (avoids subtitle-body overlap). Otherwise scale only.
        var hasSub = hasSubtitle(parsedSlide);
        var templateTop = bodyShape.getTop();
        var geomWantsLower = bodyFrame.y > templateTop + 10; // geometry body is >10pt below template
        if (hasSub && geomWantsLower) {
          // Geometry accounts for subtitle spacing — reposition body to match
          positionElement(bodyShape, bodyFrame);
        } else {
          scaleElement(bodyShape, bodyFrame);
        }
      }
    } else {
      bodyShape = createTextBox(slide, bodyFrame);
    }

    // Determine which content section goes into this body frame
    var content = '';
    if (parsedSlide.copySections.length > b) {
      content = parsedSlide.copySections[b];
    } else if (b === 0 && parsedSlide.copyContent) {
      content = parsedSlide.copyContent;
    }

    if (content) {
      injectFormattedText(bodyShape, content, settings.bodyFontSize, false, settings);
      clampToFooterZone(bodyShape, bodyShape.getText(), settings.bodyFontSize, settings);
    }
  }

  // If there are body sections but no body geometry frames, inject into any available body placeholder
  // Skip body entirely if content is "N/A" (title slides have no real body)
  var bodyContent = parsedSlide.copyContent || '';
  var isNABody = /^\s*N\/A\b/i.test(bodyContent.trim());
  if (textFrames.body.length === 0 && bodyContent && !isNABody) {
    if (placeholders.body.length > 0) {
      injectFormattedText(placeholders.body[0], bodyContent, settings.bodyFontSize, false, settings);
      clampToFooterZone(placeholders.body[0], placeholders.body[0].getText(), settings.bodyFontSize, settings);
    } else {
      // Create a default body text box in the safe area
      var defaultBody = slide.insertTextBox('', 36, 100, 648, 250);
      injectFormattedText(defaultBody, bodyContent, settings.bodyFontSize, false, settings);
      clampToFooterZone(defaultBody, defaultBody.getText(), settings.bodyFontSize, settings);
    }
  }
}

/**
 * Fallback: inject text into layout placeholders without geometry.
 */
function injectTextToPlaceholders(slide, parsedSlide, settings, warnings) {
  var elements = slide.getPageElements();
  var titleDone = false, subtitleDone = false, bodyIdx = 0;

  for (var i = 0; i < elements.length; i++) {
    try {
      if (elements[i].getPageElementType() !== SlidesApp.PageElementType.SHAPE) continue;
      var shape = elements[i].asShape();
      var phType = shape.getPlaceholderType();

      if (!titleDone && (phType === SlidesApp.PlaceholderType.TITLE || phType === SlidesApp.PlaceholderType.CENTERED_TITLE)) {
        injectFormattedText(shape, parsedSlide.title, settings.titleFontSize, true, settings);
        titleDone = true;
      } else if (!subtitleDone && phType === SlidesApp.PlaceholderType.SUBTITLE) {
        if (hasSubtitle(parsedSlide)) {
          injectFormattedText(shape, parsedSlide.subtitle, settings.subtitleFontSize, false, settings);
        }
        subtitleDone = true;
      } else if (phType === SlidesApp.PlaceholderType.BODY) {
        var content = parsedSlide.copySections[bodyIdx] || '';
        if (content) {
          injectFormattedText(shape, content, settings.bodyFontSize, false, settings);
        }
        bodyIdx++;
      }
    } catch (e) { /* skip */ }
  }
}

/**
 * Create a new text box at geometry-specified coordinates.
 */
function createTextBox(slide, frame) {
  // Google Slides API insertTextBox uses POINTS directly
  return slide.insertTextBox(
    '',
    frame.x,
    frame.y,
    frame.width,
    frame.height
  );
}

/**
 * Position an existing element to match geometry coordinates (for new text boxes only).
 */
function positionElement(element, frame) {
  // Google Slides API setLeft/setTop/setWidth/setHeight use POINTS directly
  element.setLeft(frame.x);
  element.setTop(frame.y);
  element.setWidth(frame.width);
  element.setHeight(frame.height);
}

/**
 * Scale an existing template element — update width/height from geometry
 * but preserve the original position (left/top) from the template layout.
 * Only resizes if the geometry frame is LARGER than the existing box
 * (avoids shrinking well-placed template elements).
 */
function scaleElement(element, frame) {
  // Only widen if geometry demands more width
  if (frame.width > element.getWidth()) {
    element.setWidth(frame.width);
  }
  // Only grow height if geometry demands more height
  if (frame.height > element.getHeight()) {
    element.setHeight(frame.height);
  }
}

// ═══════════════════════════════════════════════════════════════
// TEXT FORMATTING ENGINE
// ═══════════════════════════════════════════════════════════════

/**
 * Inject formatted text into a shape, handling bold, bullets, numbered lists.
 * @param {Shape} shape - The target text box
 * @param {string} rawText - The markdown-formatted text content
 * @param {number} fontSize - Base font size
 * @param {boolean} isTitle - If true, apply title styling
 * @param {Object} settings
 */
function injectFormattedText(shape, rawText, fontSize, isTitle, settings) {
  if (!rawText || !shape) return;

  var textRange = shape.getText();
  textRange.clear();

  // Parse the text into structured runs
  var lines = rawText.split('\n');
  var formattedLines = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim();
    if (!trimmed) continue;

    var lineInfo = {
      text: '',
      isBullet: false,
      isNumbered: false,
      numberPrefix: '',
      isBold: false, // entire line bold
      isSectionHeader: false,
      runs: [] // { text, bold }
    };

    // Detect bullet prefix
    if (trimmed.match(/^[•●]\s+/)) {
      lineInfo.isBullet = true;
      trimmed = trimmed.replace(/^[•●]\s+/, '');
    }

    // Detect numbered list
    var numMatch = trimmed.match(/^(\d+)\.\s+/);
    if (numMatch) {
      lineInfo.isNumbered = true;
      lineInfo.numberPrefix = numMatch[1] + '. ';
      trimmed = trimmed.replace(/^\d+\.\s+/, '');
    }

    // Detect section header (entire line bold with colon)
    if (trimmed.match(/^\*\*[^*]+\*\*:?\s*$/)) {
      lineInfo.isSectionHeader = true;
    }

    // Parse bold runs within the line
    lineInfo.runs = parseBoldRuns(trimmed);

    formattedLines.push(lineInfo);
  }

  if (formattedLines.length === 0) return;

  // Build the full text string and track formatting ranges
  var fullText = '';
  var formatRanges = []; // { start, end, bold }
  var bulletLines = [];  // line indices that are bullets
  var numberedLines = []; // line indices that are numbered

  for (var j = 0; j < formattedLines.length; j++) {
    var fl = formattedLines[j];
    var lineStart = fullText.length;

    // Build the line text from runs
    var lineText = '';
    for (var r = 0; r < fl.runs.length; r++) {
      var run = fl.runs[r];
      var runStart = lineStart + lineText.length;
      lineText += run.text;
      if (run.bold) {
        formatRanges.push({ start: runStart, end: runStart + run.text.length, bold: true });
      }
    }

    fullText += lineText;

    if (fl.isBullet) bulletLines.push(j);
    if (fl.isNumbered) numberedLines.push(j);

    // Add newline between lines (not after last)
    if (j < formattedLines.length - 1) {
      fullText += '\n';
    }
  }

  // Set the text content
  textRange.setText(fullText);

  // Apply font settings
  var textStyle = textRange.getTextStyle();
  textStyle.setFontSize(fontSize);
  if (settings.defaultFontFamily) {
    textStyle.setFontFamily(settings.defaultFontFamily);
  }
  if (isTitle) {
    textStyle.setBold(true);
  }

  // Apply bold ranges
  for (var f = 0; f < formatRanges.length; f++) {
    var range = formatRanges[f];
    if (range.start < fullText.length && range.end <= fullText.length) {
      try {
        textRange.getRange(range.start, range.end).getTextStyle().setBold(range.bold);
      } catch (e) {
        debugLog(settings, 'Bold range error: ' + e.message);
      }
    }
  }

  // Apply bullet formatting
  if (bulletLines.length > 0 || numberedLines.length > 0) {
    applyListFormatting(textRange, fullText, formattedLines, bulletLines, numberedLines, settings);
  }

  // Tighten body paragraph spacing: reduce gaps between section headers and bullets
  if (!isTitle) {
    try {
      var bodyParas = textRange.getParagraphs();
      for (var bp = 0; bp < bodyParas.length; bp++) {
        var paraStyle = bodyParas[bp].getRange().getParagraphStyle();
        var paraText = bodyParas[bp].getRange().asString().trim();
        // Section headers (bold lines ending with colon) get reduced space above
        if (paraText.match(/^[A-Z][A-Z\s&:]+:?$/) || paraText.match(/^(PHASE|YEAR|STEP)\s/)) {
          paraStyle.setSpaceAbove(4);
          paraStyle.setSpaceBelow(1);
        } else {
          // Regular bullets/text: minimal spacing
          paraStyle.setSpaceAbove(0);
          paraStyle.setSpaceBelow(0);
        }
      }
    } catch (e) { /* best effort */ }
  }

  // Auto-shrink text if it overflows the box
  autoShrinkText(shape, textRange, fontSize, settings);
}

/**
 * Parse a line of text into runs with bold markers.
 * "Hello **world** today" → [{text:"Hello ", bold:false}, {text:"world", bold:true}, {text:" today", bold:false}]
 */
function parseBoldRuns(text) {
  var runs = [];
  var regex = /\*\*([^*]+)\*\*/g;
  var lastIndex = 0;
  var match;

  while ((match = regex.exec(text)) !== null) {
    // Text before the bold
    if (match.index > lastIndex) {
      runs.push({ text: text.substring(lastIndex, match.index), bold: false });
    }
    // The bold text
    runs.push({ text: match[1], bold: true });
    lastIndex = regex.lastIndex;
  }

  // Remaining text after last bold
  if (lastIndex < text.length) {
    runs.push({ text: text.substring(lastIndex), bold: false });
  }

  // If no runs parsed, return the whole text as a single non-bold run
  if (runs.length === 0) {
    runs.push({ text: text, bold: false });
  }

  return runs;
}

/**
 * Apply bullet or numbered list formatting to specific paragraphs.
 */
function applyListFormatting(textRange, fullText, formattedLines, bulletLines, numberedLines, settings) {
  var paragraphs = textRange.getParagraphs();

  for (var p = 0; p < paragraphs.length && p < formattedLines.length; p++) {
    try {
      var para = paragraphs[p];
      var listStyle = para.getRange().getListStyle();

      if (bulletLines.indexOf(p) !== -1) {
        listStyle.applyListPreset(SlidesApp.ListPreset.DISC_CIRCLE_SQUARE);
      } else if (numberedLines.indexOf(p) !== -1) {
        listStyle.applyListPreset(SlidesApp.ListPreset.DIGIT_ALPHA_ROMAN);
      }
    } catch (e) {
      debugLog(settings, 'List formatting error at paragraph ' + p + ': ' + e.message);
    }
  }
}

/**
 * Auto-shrink text to fit within the text box if overflowing.
 * Uses TEXT_AUTOFIT as a hint for future manual edits, then ALWAYS runs
 * manual line-count estimation (TEXT_AUTOFIT does NOT retroactively shrink
 * text set via the API).
 * v2: Line-count based estimation with bullet indent detection. Min 8pt.
 */
function autoShrinkText(shape, textRange, baseFontSize, settings) {
  // Set TEXT_AUTOFIT as a hint for future manual edits
  try {
    var autoFit = shape.getAutofit();
    if (autoFit) {
      autoFit.setAutofitType(SlidesApp.AutofitType.TEXT_AUTOFIT);
    }
  } catch (e) { /* AutoFit not available on this shape type */ }

  // Always run manual shrink — TEXT_AUTOFIT alone does not shrink text set via API
  try {
    var text = textRange.asString();
    // getWidth()/getHeight() already return points — do NOT multiply by PT_PER_INCH
    var boxWidth = shape.getWidth();
    var boxHeight = shape.getHeight();
    // Cap effective height at safe area bottom to prevent estimating text fits
    // when the box actually extends past the footer zone
    var maxUsable = SAFE_AREA.bottom - shape.getTop();
    if (maxUsable > 0 && maxUsable < boxHeight) {
      boxHeight = maxUsable;
    }

    // Count actual lines in the text, accounting for wrapping at box width
    var rawLines = text.split("\n");
    var totalLines = 0;
    for (var i = 0; i < rawLines.length; i++) {
      var line = rawLines[i];
      // Bullet lines have indentation reducing effective width by ~30pt
      var isBullet = /^\s*[\u2022\u25CF•\-]/.test(line) || /^\s*\d+[\.\)]/.test(line);
      var effectiveWidth = isBullet ? (boxWidth - 30) : boxWidth;
      var charsPerLine = Math.floor(effectiveWidth / (baseFontSize * 0.55));
      var wrappedLines = Math.ceil(Math.max(line.length, 1) / Math.max(charsPerLine, 1));
      totalLines += wrappedLines;
    }

    var estTextHeight = totalLines * baseFontSize * 1.35;

    if (estTextHeight > boxHeight && estTextHeight > 0) {
      var scaleFactor = boxHeight / estTextHeight;
      var newSize = Math.max(Math.floor(baseFontSize * scaleFactor), 8);
      if (newSize < baseFontSize) {
        textRange.getTextStyle().setFontSize(newSize);
        debugLog(settings, 'Auto-shrunk text from ' + baseFontSize + 'pt to ' + newSize + 'pt (est ' + totalLines + ' lines, box ' + Math.round(boxHeight) + 'pt)');
      }
    }
  } catch (e2) {
    // Best effort; ignore
  }
}

/**
 * Clamp a text box so it doesn't extend below the footer zone (SAFE_AREA.bottom).
 * If the shape's bottom edge exceeds the safe area, reduces height and re-runs autoShrinkText.
 */
function clampToFooterZone(shape, textRange, baseFontSize, settings) {
  try {
    var shapeBottom = shape.getTop() + shape.getHeight();
    var maxBottom = SAFE_AREA.bottom;
    if (shapeBottom > maxBottom) {
      var overflow = shapeBottom - maxBottom;
      var newHeight = shape.getHeight() - overflow;
      if (newHeight > 20) { // minimum viable height
        shape.setHeight(newHeight);
        // Re-run auto-shrink with the reduced box size
        autoShrinkText(shape, textRange, baseFontSize, settings);
        debugLog(settings, 'Clamped text box to footer zone: reduced height by ' + Math.round(overflow) + 'pt');
      }
    }
  } catch (e) { /* best effort */ }
}

// ═══════════════════════════════════════════════════════════════
// STEP 6: HEADER & FOOTER SETUP
// ═══════════════════════════════════════════════════════════════

/**
 * Ensure a footer text box is wide enough for its content to stay on one line.
 * Estimates minimum width from character count and font size, then expands
 * the shape if needed. Also sets autofit to shrink text on overflow.
 */
function ensureSingleLineFooter(shape, text) {
  try {
    var fontSize = shape.getText().getTextStyle().getFontSize() || 10;
    // Estimate: each character is roughly 0.55× the font size in pt width
    var estimatedWidth = text.length * fontSize * 0.55 + 10; // +10pt padding
    var minWidth = Math.max(estimatedWidth, 100); // at least 100pt
    if (shape.getWidth() < minWidth) {
      shape.setWidth(minWidth);
    }
    // Try to set autofit to shrink on overflow (prevents wrapping)
    try {
      shape.getAutoFit().setAutoFitType(SlidesApp.AutoFitType.SHRINK_TEXT_ON_OVERFLOW);
    } catch (e) { /* AutoFit API may not be available */ }
  } catch (e) { /* skip if shape manipulation fails */ }
}

/**
 * Set up headers and footers using the title from Slide #1.
 * @param {string|null} bodyTextColor - When non-null, apply this color to all header/footer text.
 */
function setupHeaderFooter(presentation, parsed, settings, bodyTextColor) {
  if (parsed.slides.length === 0) return;

  var titleText = parsed.slides[0].title || parsed.deckTitle || '';
  var now = new Date();

  // Detect existing date format from theme's header/footer
  var dateStr = formatDateForTheme(presentation, now, settings);

  debugLog(settings, 'Header/Footer title: "' + titleText + '", date: "' + dateStr + '"' + (bodyTextColor ? ', bodyColor=' + bodyTextColor : ''));

  // Helper: apply body text color to a shape's text and any line border
  function applyFooterColor(shape) {
    if (!bodyTextColor) return;
    try { shape.getText().getTextStyle().setForegroundColor(bodyTextColor); } catch (e) { /* skip */ }
  }

  // Helper: apply body text color to line elements on a page
  function colorLinesOnPage(page) {
    if (!bodyTextColor) return;
    var elements = page.getPageElements();
    for (var k = 0; k < elements.length; k++) {
      try {
        if (elements[k].getPageElementType() === SlidesApp.PageElementType.LINE) {
          elements[k].asLine().getLineFill().setSolidFill(bodyTextColor);
        }
      } catch (e) { /* skip */ }
    }
  }

  // Helper: replace footer text in shapes on a page (slide, layout, or master)
  function replaceFooterTextOnPage(page, label) {
    var elements = page.getPageElements();
    for (var j = 0; j < elements.length; j++) {
      try {
        if (elements[j].getPageElementType() !== SlidesApp.PageElementType.SHAPE) continue;
        var shape = elements[j].asShape();
        var phType = shape.getPlaceholderType();
        var text = shape.getText().asString().trim();

        // Check formal placeholder types first
        if (phType === SlidesApp.PlaceholderType.HEADER || phType === SlidesApp.PlaceholderType.FOOTER) {
          shape.getText().setText(titleText);
          applyFooterColor(shape);
          debugLog(settings, label + ': Set formal placeholder ' + phType + ' to "' + titleText + '"');
        } else if (phType === SlidesApp.PlaceholderType.DATE_AND_TIME) {
          shape.getText().setText(dateStr);
          applyFooterColor(shape);
          ensureSingleLineFooter(shape, dateStr);
          debugLog(settings, label + ': Set formal date placeholder to "' + dateStr + '"');
        } else if (phType === SlidesApp.PlaceholderType.SLIDE_NUMBER) {
          // Don't change text (slide numbers are auto-generated), just color it
          applyFooterColor(shape);
          debugLog(settings, label + ': Colored slide number placeholder');
        }
        // Fallback: match by text content for non-placeholder text boxes
        else if (/^(Month\s+dd|month\s+dd|MM\/DD|mm\/dd)/i.test(text) || text === 'Month dd,yyyy' || text === 'Month dd, yyyy') {
          shape.getText().setText(dateStr);
          applyFooterColor(shape);
          ensureSingleLineFooter(shape, dateStr);
          debugLog(settings, label + ': Set date text box "' + text + '" to "' + dateStr + '"');
        } else if (/^PROJECT\s*NAME$/i.test(text)) {
          shape.getText().setText(titleText);
          applyFooterColor(shape);
          ensureSingleLineFooter(shape, titleText);
          debugLog(settings, label + ': Set project name text box to "' + titleText + '"');
        }
      } catch (e) { /* skip */ }
    }
    // Color any decorative lines in the header/footer area
    colorLinesOnPage(page);
  }

  // Apply to all slides
  var slides = presentation.getSlides();
  for (var i = 0; i < slides.length; i++) {
    replaceFooterTextOnPage(slides[i], 'Slide ' + (i + 1));
  }

  // Apply to all layouts
  var masters = presentation.getMasters();
  for (var m = 0; m < masters.length; m++) {
    var layouts = masters[m].getLayouts();
    for (var l = 0; l < layouts.length; l++) {
      replaceFooterTextOnPage(layouts[l], 'Layout[' + l + ']');
    }
    // Also set on masters themselves
    replaceFooterTextOnPage(masters[m], 'Master[' + m + ']');
  }
}

/**
 * Format the current date to match the theme's existing date format pattern.
 */
function formatDateForTheme(presentation, date, settings) {
  // If user provided an override, use that
  if (settings.dateFormatOverride) {
    return applyDateFormat(settings.dateFormatOverride, date);
  }

  // Try to detect format from existing date placeholders
  var detectedFormat = detectDateFormat(presentation);
  if (detectedFormat) {
    debugLog(settings, 'Detected date format: "' + detectedFormat + '"');
    return applyDateFormat(detectedFormat, date);
  }

  // Default: "Month DD, YYYY"
  return applyDateFormat('MMMM DD, YYYY', date);
}

/**
 * Try to detect the date format from existing placeholder text.
 */
function detectDateFormat(presentation) {
  var masters = presentation.getMasters();
  for (var m = 0; m < masters.length; m++) {
    var result = findDateInElements(masters[m].getPageElements());
    if (result) return result;
    var layouts = masters[m].getLayouts();
    for (var l = 0; l < layouts.length; l++) {
      result = findDateInElements(layouts[l].getPageElements());
      if (result) return result;
    }
  }
  return null;
}

/**
 * Scan an array of page elements for a date placeholder or pattern; return format or null.
 */
function findDateInElements(elements) {
  for (var i = 0; i < elements.length; i++) {
    try {
      if (elements[i].getPageElementType() !== SlidesApp.PageElementType.SHAPE) continue;
      var shape = elements[i].asShape();
      var text = shape.getText().asString().trim();
      if (shape.getPlaceholderType() === SlidesApp.PlaceholderType.DATE_AND_TIME) {
        if (text && text.length > 0) return inferDateFormat(text);
      }
      if (/^Month\s+dd/i.test(text)) return 'MMMM DD, YYYY';
    } catch (e) { /* skip */ }
  }
  return null;
}

/**
 * Infer the date format pattern from an example date string.
 */
function inferDateFormat(dateStr) {
  dateStr = dateStr.trim();

  // month.dd.yyyy
  if (/^[a-z]+\.\d{1,2}\.\d{4}$/i.test(dateStr)) {
    return dateStr.match(/^[A-Z]/) ? 'Month.DD.YYYY' : 'month.dd.yyyy';
  }
  // MM/DD/YY
  if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(dateStr)) return 'MM/DD/YY';
  // MM/DD/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) return 'MM/DD/YYYY';
  // MM-DD-YYYY
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(dateStr)) return 'mm-dd-yyyy';
  // MMMM DD, YYYY
  if (/^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(dateStr)) return 'MMMM DD, YYYY';
  // mmmm dd, yyyy
  if (/^[a-z]+ \d{1,2}, \d{4}$/.test(dateStr)) return 'mmmm dd, yyyy';
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return 'YYYY-MM-DD';

  return null;
}

/**
 * Apply a date format pattern to produce a formatted date string.
 */
function applyDateFormat(format, date) {
  var months = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
  var monthsLower = months.map(function(m) { return m.toLowerCase(); });

  var y = date.getFullYear();
  var m = date.getMonth(); // 0-based
  var d = date.getDate();

  var yy = String(y).slice(-2);
  var mm = String(m + 1).padStart(2, '0');
  var dd = String(d).padStart(2, '0');

  // Replace patterns (longest first to avoid partial matches)
  var result = format;
  result = result.replace('YYYY', String(y));
  result = result.replace('yyyy', String(y));
  result = result.replace('YY', yy);
  result = result.replace('yy', yy);

  result = result.replace('MMMM', months[m]);
  result = result.replace('mmmm', monthsLower[m]);
  result = result.replace('Month', months[m]);
  result = result.replace('month', monthsLower[m]);
  result = result.replace('MM', mm);
  result = result.replace('mm', mm);

  result = result.replace('DD', dd);
  result = result.replace('dd', dd);

  return result;
}

// ═══════════════════════════════════════════════════════════════
// STEP 7: ASSET FRAME CREATION
// ═══════════════════════════════════════════════════════════════

/**
 * Create placeholder frames for images, videos, infographics, etc.
 */
function createAssetFrames(slide, parsedSlide, settings) {
  if (!parsedSlide.geometry || !parsedSlide.geometry.frames) return;

  var assetTypes = [
    'image_placeholder', 'video_placeholder', 'infograph_placeholder',
    'timeline_placeholder', 'icon_placeholder', 'background_image'
  ];

  for (var i = 0; i < parsedSlide.geometry.frames.length; i++) {
    var frame = parsedSlide.geometry.frames[i];
    if (assetTypes.indexOf(frame.type) === -1) continue;

    if (frame.type === 'background_image') {
      // Background images are handled as slide backgrounds, not frames.
      // No placeholder shape is created — the actual image will be set
      // as the slide background in placeAssets (Step 8).
      debugLog(settings, 'Background image noted for slide (will be set as page background)');
      continue;
    }

    // Compute dimensions — enforce aspect ratio if declared
    var left = frame.x;
    var top = frame.y;
    var width = frame.width;
    var height = frame.height;

    if (frame.aspect_ratio) {
      var ratioParts = frame.aspect_ratio.split(':');
      if (ratioParts.length === 2) {
        var rw = parseFloat(ratioParts[0]);
        var rh = parseFloat(ratioParts[1]);
        if (rw > 0 && rh > 0) {
          var targetRatio = rw / rh; // width / height
          var currentRatio = width / height;

          if (Math.abs(currentRatio - targetRatio) > 0.01) {
            // Fit within the bounding box while preserving aspect ratio
            var fitByWidth = width / targetRatio; // height if we keep width
            var fitByHeight = height * targetRatio; // width if we keep height

            if (fitByWidth <= height) {
              // Keep width, reduce height, center vertically
              var newHeight = fitByWidth;
              top = top + (height - newHeight) / 2;
              height = newHeight;
            } else {
              // Keep height, reduce width, center horizontally
              var newWidth = fitByHeight;
              left = left + (width - newWidth) / 2;
              width = newWidth;
            }
            debugLog(settings, 'Adjusted frame to aspect ratio ' + frame.aspect_ratio + ': ' + Math.round(width) + 'x' + Math.round(height));
          }
        }
      }
    }

    var placeholderShape;

    if (settings.placeholderStyle === 'transparent') {
      placeholderShape = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, left, top, width, height);
      placeholderShape.getFill().setTransparent();
      placeholderShape.getBorder().getLineFill().setSolidFill('#999999');
      placeholderShape.getBorder().setWeight(0.5);
      placeholderShape.getBorder().setDashStyle(SlidesApp.DashStyle.DASH);
    } else if (settings.placeholderStyle === 'outlined_only') {
      placeholderShape = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, left, top, width, height);
      placeholderShape.getFill().setTransparent();
      placeholderShape.getBorder().getLineFill().setSolidFill('#999999');
      placeholderShape.getBorder().setWeight(1);
    } else {
      // Default: gray with label
      placeholderShape = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, left, top, width, height);
      placeholderShape.getFill().setSolidFill('#E0E0E0');
      placeholderShape.getBorder().getLineFill().setSolidFill('#999999');
      placeholderShape.getBorder().setWeight(0.75);
    }

    // Add label text
    var label = frame.description || frame.type.replace(/_/g, ' ');
    if (frame.aspect_ratio) {
      label += ' [' + frame.aspect_ratio + ']';
    }

    var labelText = placeholderShape.getText();
    labelText.setText(label);
    labelText.getTextStyle().setFontSize(8).setForegroundColor('#666666');
    labelText.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);

    // Set title for accessibility / identification
    placeholderShape.setTitle('DOG_ASSET:' + frame.type + ':' + (frame.description || ''));
    // Send asset placeholder to back so text elements stay on top
    try { placeholderShape.sendToBack(); } catch (e) { /* best effort */ }

    debugLog(settings, 'Created asset placeholder: ' + label + ' at (' + Math.round(left) + ',' + Math.round(top) + ') ' + Math.round(width) + 'x' + Math.round(height));
  }
}

// ═══════════════════════════════════════════════════════════════
// STEP 8: ASSET PLACEMENT
// ═══════════════════════════════════════════════════════════════

/**
 * Place actual images from a Drive folder into the placeholder frames.
 */
function placeAssets(createdSlides, parsed, assetFolderId, settings, warnings) {
  var folder;
  try {
    folder = DriveApp.getFolderById(assetFolderId);
  } catch (e) {
    warnings.push('Could not access asset folder: ' + e.message);
    return;
  }

  // Build an index of all image files in the folder
  var imageFiles = {};
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    var mimeType = file.getMimeType();
    if (mimeType.indexOf('image/') === 0) {
      var name = file.getName().replace(/\.[^.]+$/, ''); // strip extension
      imageFiles[name.toLowerCase()] = file;
      // Also index with underscores replaced by spaces
      imageFiles[name.toLowerCase().replace(/_/g, ' ')] = file;
    }
  }

  debugLog(settings, 'Found ' + Object.keys(imageFiles).length + ' image entries in asset folder');

  for (var i = 0; i < createdSlides.length; i++) {
    var slideInfo = createdSlides[i];
    var parsedSlide = slideInfo.parsedSlide;
    var slide = slideInfo.slide;

    if (!parsedSlide.geometry || !parsedSlide.geometry.frames) continue;

    for (var f = 0; f < parsedSlide.geometry.frames.length; f++) {
      var frame = parsedSlide.geometry.frames[f];
      var placeable = ['image_placeholder', 'background_image', 'icon_placeholder',
                       'infograph_placeholder', 'video_placeholder', 'timeline_placeholder'];
      if (placeable.indexOf(frame.type) === -1) continue;

      // Try to match an image file to this frame
      var matchedFile = matchAssetFile(frame, parsedSlide.requiredAssets, imageFiles, settings);

      if (!matchedFile) {
        debugLog(settings, 'No matching asset for: ' + (frame.description || frame.type));
        continue;
      }

      var blob = matchedFile.getBlob();

      if (frame.type === 'background_image') {
        // Set as slide background
        slide.getBackground().setPictureFill(blob);
        debugLog(settings, 'Set background image from: ' + matchedFile.getName());
      } else {
        // Insert image at exact coordinates
        var image = slide.insertImage(
          blob,
          frame.x,
          frame.y,
          frame.width,
          frame.height
        );

        // Remove the placeholder shape if it exists
        removePlaceholderAt(slide, frame, settings);

        debugLog(settings, 'Placed image: ' + matchedFile.getName() + ' at (' + frame.x + ',' + frame.y + ')');
      }
    }
  }
}

/**
 * Count how many words appear as substrings in a filename.
 */
function scoreFuzzyMatch(filename, words) {
  var score = 0;
  for (var i = 0; i < words.length; i++) {
    if (filename.indexOf(words[i]) !== -1) score++;
  }
  return score;
}

/**
 * Match an asset file to a geometry frame by comparing descriptions.
 */
function matchAssetFile(frame, requiredAssets, imageFiles, settings) {
  var description = (frame.description || '').toLowerCase().trim();

  // Direct match on description
  if (imageFiles[description]) return imageFiles[description];

  // Try with underscores for spaces
  var underscored = description.replace(/\s+/g, '_');
  if (imageFiles[underscored]) return imageFiles[underscored];

  // Fuzzy match: check if any file name contains key words from the description
  var descWords = description.split(/[\s_-]+/).filter(function(w) { return w.length > 2; });
  var bestMatch = null;
  var bestScore = 0;

  for (var filename in imageFiles) {
    var score = scoreFuzzyMatch(filename, descWords);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = imageFiles[filename];
    }
  }

  if (bestScore >= Math.max(1, Math.floor(descWords.length / 2))) {
    return bestMatch;
  }

  // Try matching against required assets descriptions
  for (var a = 0; a < requiredAssets.length; a++) {
    var assetDesc = requiredAssets[a].description.toLowerCase();
    // Check if this asset matches the frame
    if (assetDesc === description || assetDesc.indexOf(description) !== -1 || description.indexOf(assetDesc) !== -1) {
      var assetWords = assetDesc.split(/[\s_-]+/).filter(function(w) { return w.length > 2; });
      for (var fn in imageFiles) {
        if (scoreFuzzyMatch(fn, assetWords) >= Math.max(1, Math.floor(assetWords.length / 2))) {
          return imageFiles[fn];
        }
      }
    }
  }

  return null;
}

/**
 * Remove the placeholder rectangle shape at a frame's position.
 */
function removePlaceholderAt(slide, frame, settings) {
  var elements = slide.getPageElements();
  var targetTitle = 'DOG_ASSET:' + frame.type + ':' + (frame.description || '');

  for (var i = 0; i < elements.length; i++) {
    try {
      if (elements[i].getTitle() === targetTitle) {
        elements[i].remove();
        return;
      }
    } catch (e) { /* skip */ }
  }
}

// ═══════════════════════════════════════════════════════════════
// STEP 9: VALIDATION PASS
// ═══════════════════════════════════════════════════════════════

/**
 * Run boundary, overlap, and clipping validation on all created slides.
 */
function runValidation(createdSlides, settings, warnings) {
  // getLeft/getTop/getWidth/getHeight return POINTS, so use point values directly
  var canvasW = CANVAS.width;       // 720 pt
  var canvasH = CANVAS.height;      // 405 pt
  var safeLeft = SAFE_AREA.left;    // 36 pt
  var safeRight = SAFE_AREA.right;  // 684 pt
  var safeTop = SAFE_AREA.top;      // 30 pt
  var safeBottom = SAFE_AREA.bottom; // 370 pt

  for (var i = 0; i < createdSlides.length; i++) {
    var slide = createdSlides[i].slide;
    var slideNum = createdSlides[i].parsedSlide.pageNumber;
    var elements = slide.getPageElements();

    for (var j = 0; j < elements.length; j++) {
      var el = elements[j];
      try {
        var left = el.getLeft();
        var top = el.getTop();
        var width = el.getWidth();
        var height = el.getHeight();
        var right = left + width;
        var bottom = top + height;
        var title = '';
        try { title = el.getTitle() || ''; } catch (e) { /* ignore */ }

        // Skip background images (they intentionally fill the canvas)
        if (title.indexOf('background_image') !== -1) continue;

        // Boundary check: clamp to canvas
        var clamped = false;
        if (left < 0) { el.setLeft(0); clamped = true; }
        if (top < 0) { el.setTop(0); clamped = true; }
        if (right > canvasW) {
          el.setWidth(canvasW - left);
          clamped = true;
        }
        if (bottom > canvasH) {
          el.setHeight(canvasH - top);
          clamped = true;
        }

        if (clamped) {
          var warnMsg = 'Slide #' + slideNum + ': Element clamped to canvas bounds';
          warnings.push(warnMsg);
          debugLog(settings, warnMsg);
        }

        // Safe area check (warning only, don't force-move)
        if (title.indexOf('DOG_ASSET:') === -1) {
          // Only check non-background content
          if (left < safeLeft || top < safeTop || right > safeRight || bottom > safeBottom) {
            var safeWarn = 'Slide #' + slideNum + ': Element near/outside safe area (' +
              Math.round(left * 72) + ',' + Math.round(top * 72) + ' → ' +
              Math.round(right * 72) + ',' + Math.round(bottom * 72) + ' pt)';
            warnings.push(safeWarn);
            debugLog(settings, safeWarn);
          }
        }
      } catch (e) {
        debugLog(settings, 'Validation error on slide #' + slideNum + ': ' + e.message);
      }
    }
  }

  debugLog(settings, 'Validation complete. ' + warnings.length + ' warnings total.');
}

// ═══════════════════════════════════════════════════════════════
// UTILITY: GET DRIVE FOLDERS FOR SIDEBAR PICKER
// ═══════════════════════════════════════════════════════════════

/**
 * Search for folders in Drive by name (for the sidebar folder picker).
 * @param {string} query - Search query
 * @return {Array} - [{ id, name, path }]
 */
function searchDriveFolders(query) {
  var results = [];
  try {
    var folders = DriveApp.searchFolders('title contains "' + query.replace(/"/g, '\\"') + '"');
    var count = 0;
    while (folders.hasNext() && count < 20) {
      var folder = folders.next();
      results.push({
        id: folder.getId(),
        name: folder.getName()
      });
      count++;
    }
  } catch (e) {
    Logger.log('Folder search error: ' + e.message);
  }
  return results;
}
