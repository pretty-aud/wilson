import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { FileText, Sparkles, ChevronRight, Layers, Eye, Image, RefreshCw } from 'lucide-react';
import { parseSlideContent, parsePlacedAssets } from './parser';
import { getLuminance, getContrastRatio, ensureContrast } from './colorUtils';
import { PRESET_THEMES } from './constants';
import VideoThumbnail from './VideoThumbnail';

const LayoutVisualizer = ({ content, compact = false, overrideColors = null, onRefreshColors = null, onCycleTheme = null, themeName = '', themeIndex = 0, themeCount = 0, isGeneratingTheme = false, onContentChange = null, onTextContextMenu = null, placementAssets = [], zoomLevel = 0 }) => {
  const parsed = parseSlideContent(content);
  // Strip "N/A" values so they don't render — treat as empty/blank
  if (parsed.subtitle && /^n\/?a\b/i.test(parsed.subtitle.trim())) {
    parsed.subtitle = '';
  }
  if (parsed.copyContent && /^n\/?a\b/i.test(parsed.copyContent.trim())) {
    parsed.copyContent = '';
  }
  const rawLayoutType = parsed.layoutType || '';
  
  // Normalize layout type - remove extra spaces, convert to lowercase
  const normalizeLayout = (lt) => {
    return lt.toLowerCase().trim().replace(/\s+/g, ' ');
  };
  
  const layoutType = normalizeLayout(rawLayoutType);
  
  // Determine which layout to render based on the layout type string
  const getLayoutKey = (lt) => {
    // Exact matches first (matching Google Slides layout names)
    if (lt === 'title slide') return 'TITLE_SLIDE';
    if (lt === 'section header') return 'SECTION_HEADER';
    if (lt === 'title and body') return 'TITLE_BODY';
    if (lt === 'title and two columns') return 'TWO_COLUMNS';
    if (lt === 'title and three columns') return 'THREE_COLUMNS';
    if (lt === 'title and four columns') return 'FOUR_COLUMNS';
    if (lt === 'title only') return 'TITLE_ONLY';
    if (lt === 'one column text') return 'ONE_COLUMN';
    if (lt === 'main point') return 'MAIN_POINT';
    if (lt === 'section title and description') return 'SECTION_TITLE_DESC';
    if (lt === 'caption') return 'CAPTION';
    if (lt === 'big number') return 'BIG_NUMBER';
    if (lt === 'blank') return 'BLANK';
    if (lt === 'section header w/gradient') return 'SECTION_HEADER_GRADIENT';
    if (lt === 'title page w/gradient') return 'TITLE_PAGE_GRADIENT';
    
    // Partial matches (more flexible)
    if (lt.includes('title slide')) return 'TITLE_SLIDE';
    if (lt.includes('title page') && lt.includes('gradient')) return 'TITLE_PAGE_GRADIENT';
    if (lt.includes('section header') && lt.includes('gradient')) return 'SECTION_HEADER_GRADIENT';
    if (lt.includes('section header')) return 'SECTION_HEADER';
    if (lt.includes('section title')) return 'SECTION_TITLE_DESC';
    if (lt.includes('four column')) return 'FOUR_COLUMNS';
    if (lt.includes('three column')) return 'THREE_COLUMNS';
    if (lt.includes('two column')) return 'TWO_COLUMNS';
    if (lt.includes('title only')) return 'TITLE_ONLY';
    if (lt.includes('one column')) return 'ONE_COLUMN';
    if (lt.includes('main point')) return 'MAIN_POINT';
    if (lt.includes('big number') || lt.includes('stats') || lt.includes('data')) return 'BIG_NUMBER';
    if (lt.includes('caption')) return 'CAPTION';
    if (lt.includes('blank')) return 'BLANK';
    if (lt.includes('title') && lt.includes('body')) return 'TITLE_BODY';
    
    // Default
    return 'TITLE_BODY';
  };
  
  const layoutKey = getLayoutKey(layoutType);
  console.log('LayoutVisualizer - Raw:', rawLayoutType, '| Normalized:', layoutType, '| Key:', layoutKey, '| Title:', parsed.title);
  
  // Fallback theme — used only when no overrideColors provided (first render)
  const generateThemeColors = () => {
    return PRESET_THEMES[0].colors;
  };
  
  const colors = overrideColors ? ensureContrast(overrideColors) : generateThemeColors();

  // In-place editable text helper — replaces a field in the raw content and calls onContentChange
  // Handles both formats: "▸ TITLE:\n  text" (newline) and "▸ TITLE: text" (same line)
  const updateField = useCallback((field, newText) => {
    if (!onContentChange || !content) return;
    let updated = content;
    if (field === 'title') {
      // Try newline format first: ▸ TITLE:\n  text
      let m = updated.match(/(▸\s*TITLE\s*:\s*\n\s*)([^\n]*)/i);
      if (!m) {
        // Try same-line format: ▸ TITLE: text
        m = updated.match(/(▸\s*TITLE\s*:\s+)([^\n]*)/i);
      }
      if (m) updated = updated.replace(m[0], m[1] + newText);
    } else if (field === 'subtitle') {
      // Try newline format first: ▸ SUBTITLE:\n  text
      let m = updated.match(/(▸\s*SUBTITLE\s*:\s*\n\s*)([^\n]*)/i);
      if (!m) {
        // Try same-line format: ▸ SUBTITLE: text
        m = updated.match(/(▸\s*SUBTITLE\s*:\s+)([^\n]*)/i);
      }
      if (m) updated = updated.replace(m[0], m[1] + newText);
    } else if (field === 'copyContent') {
      // Replace entire COPY/TEXT CONTENT section body
      const m = updated.match(/(▸\s*COPY\/TEXT CONTENT\s*:\s*\n)([\s\S]*?)(?=\n▸|═{10,}|$)/i);
      if (m) updated = updated.replace(m[0], m[1] + newText);
    }
    if (updated !== content) onContentChange(updated);
  }, [content, onContentChange]);

  const editableProps = (field, extraStyle = {}) => {
    if (!onContentChange) return { style: extraStyle };
    return {
      onContextMenu: onTextContextMenu ? (e) => {
        e.preventDefault();
        e.stopPropagation();
        const selection = window.getSelection();
        const selectedText = selection ? selection.toString() : '';
        onTextContextMenu(e, selectedText, field);
      } : undefined,
      style: { ...extraStyle, cursor: 'default', outline: 'none', userSelect: 'text' },
    };
  };

  // Props for body/copy content — read-only with right-click rewrite support
  const editableBodyProps = (extraStyle = {}) => {
    if (!onContentChange) return { style: extraStyle };
    return {
      onContextMenu: onTextContextMenu ? (e) => {
        e.preventDefault();
        e.stopPropagation();
        const selection = window.getSelection();
        const selectedText = selection ? selection.toString() : '';
        onTextContextMenu(e, selectedText, 'copyContent');
      } : undefined,
      style: { ...extraStyle, cursor: 'default', outline: 'none', userSelect: 'text' },
    };
  };

  // Compute the highest-contrast color against background for asset placeholders
  const assetColor = useMemo(() => {
    const getLuminance = (hex) => {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      const toLinear = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
    };
    const getContrast = (c1, c2) => {
      const l1 = getLuminance(c1);
      const l2 = getLuminance(c2);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    };
    const bg = colors[0];
    let best = colors[1];
    let bestContrast = 0;
    [colors[1], colors[2], colors[3]].forEach(c => {
      if (!c || !/^#[0-9a-fA-F]{6}$/.test(c)) return;
      const contrast = getContrast(bg, c);
      if (contrast > bestContrast) {
        bestContrast = contrast;
        best = c;
      }
    });
    return best;
  }, [colors]);
  
  // Helper to render text with markdown bold (**text**) as actual bold
  const renderMarkdownText = (text) => {
    if (!text) return null;
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };
  
  // Render a single parsed item (bullet, numbered, or plain) with proper prefix
  const renderItem = (item, colors, bodyFontSize) => {
    if (typeof item === 'string') {
      // Backward compat: plain string items render as bullet
      return <span>• {renderMarkdownText(item)}</span>;
    }
    if (item.type === 'bullet') {
      return <span>• {renderMarkdownText(item.text)}</span>;
    }
    if (item.type === 'numbered') {
      return <span>{item.number}. {renderMarkdownText(item.text)}</span>;
    }
    // plain text
    return <span>{renderMarkdownText(item.text)}</span>;
  };

  // Parse copy content into sections
  // columnCount: 1 = normal (no splitting), 2/3/4 = split on --- into that many columns
  const parseCopyContent = (copyText, columnCount = 1) => {
    // Multi-column layouts: split on --- column break marker, then parse each part independently
    if (columnCount >= 2) {
      // Split on --- breaks
      const parts = copyText.split(/\n\s*---\s*\n/);
      if (parts.length >= 2) {
        // Parse up to columnCount sections
        return parts.slice(0, columnCount).map(part => parseCopySection(part.trim()));
      }
      // Fallback: try legacy bold-header splitting for backward compat
      const legacyResult = parseCopyLegacy(copyText);
      if (legacyResult.length >= 2) return legacyResult;
      // If only 1 section found, return it (single column will be handled by rendering)
      return legacyResult;
    }
    // All other layouts: use legacy bold-header parsing
    return parseCopyLegacy(copyText);
  };

  // Parse a single column's text into { header, items }
  const parseCopySection = (text) => {
    const lines = text.split('\n');
    let header = '';
    const items = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Check if this line is a bold header: **HEADER** or **HEADER:**
      const headerMatch = line.match(/^\*\*([^*]+)\*\*:?\s*$/);
      if (headerMatch && !header) {
        header = headerMatch[1].replace(/:$/, '');
        continue;
      }

      // Bullet items
      if (line.startsWith('•')) {
        items.push({ type: 'bullet', text: line.substring(1).trim() });
      } else if (line.startsWith('- ')) {
        items.push({ type: 'bullet', text: line.substring(2).trim() });
      } else if (/^\d+[.)]\s/.test(line)) {
        const numMatch = line.match(/^(\d+)[.)]\s*(.*)/);
        items.push({ type: 'numbered', number: numMatch[1], text: numMatch[2] });
      } else {
        items.push({ type: 'plain', text: line });
      }
    }

    return { header: header || '', items };
  };

  // Legacy parsing: splits on bold headers (for non-two-column layouts and backward compat)
  const parseCopyLegacy = (copyText) => {
    const sections = [];
    const lines = copyText.split('\n');
    let currentSection = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      // Match bold header: **HEADER** or **HEADER:** (colon inside or outside bold)
      const headerMatch = line.match(/^\*\*([^*]+)\*\*:?\s*$/);
      // Also match bold header with trailing content on same line: **HEADER:** some text
      const inlineHeaderMatch = !headerMatch && line.match(/^\*\*([^*]+)\*\*:?\s+(.+)$/);

      if (headerMatch) {
        if (currentSection) sections.push(currentSection);
        currentSection = { header: headerMatch[1].replace(/:$/, ''), items: [] };
      } else if (inlineHeaderMatch) {
        if (currentSection) sections.push(currentSection);
        currentSection = { header: inlineHeaderMatch[1].replace(/:$/, ''), items: [{ type: 'plain', text: inlineHeaderMatch[2].trim() }] };
      } else if (line.startsWith('•')) {
        if (!currentSection) currentSection = { header: '', items: [] };
        currentSection.items.push({ type: 'bullet', text: line.substring(1).trim() });
      } else if (line.startsWith('- ')) {
        if (!currentSection) currentSection = { header: '', items: [] };
        currentSection.items.push({ type: 'bullet', text: line.substring(2).trim() });
      } else if (/^\d+[.)]\s/.test(line)) {
        if (!currentSection) currentSection = { header: '', items: [] };
        const numMatch = line.match(/^(\d+)[.)]\s*(.*)/);
        currentSection.items.push({ type: 'numbered', number: numMatch[1], text: numMatch[2] });
      } else if (line) {
        if (!currentSection) currentSection = { header: '', items: [] };
        currentSection.items.push({ type: 'plain', text: line });
      }
    }
    if (currentSection) sections.push(currentSection);
    return sections;
  };
  
  // Parse required assets into list
  const parseAssets = () => {
    if (!parsed.requiredAssets || parsed.requiredAssets.toLowerCase().includes('none')) return [];
    return parsed.requiredAssets.split(/[•\n]/).map(a => a.trim()).filter(a => a.length > 0);
  };
  
  // Classify asset type from the bracketed prefix
  const getAssetType = (asset) => {
    const assetLower = asset.toLowerCase();
    if (assetLower.includes('[image background]')) return 'image_background';
    if (/\[image\s*[\|]/.test(assetLower) || assetLower.startsWith('[image]') || assetLower.includes('[image]')) return 'image';
    if (/\[video\s*[\|]/.test(assetLower) || assetLower.startsWith('[video]') || assetLower.includes('[video]')) return 'video';
    if (assetLower.includes('[icon/logo]') || assetLower.includes('[icon]') || assetLower.includes('[logo]')) return 'icon_logo';
    if (/\[infograph\s*[\|]/.test(assetLower) || assetLower.startsWith('[infograph]') || assetLower.includes('[infograph]')) return 'infograph';
    if (/\[timeline\s*[\|]/.test(assetLower) || assetLower.startsWith('[timeline]') || assetLower.includes('[timeline]')) return 'timeline';
    // Fallback detection for older/unprefixed assets
    if (['photo', 'screenshot', 'mockup', 'illustration', 'render', 'picture', 'portrait', 'headshot', 'artwork', 'mood board'].some(kw => assetLower.includes(kw))) return 'image';
    if (['video', 'footage', 'clip', 'animation', 'reel', 'demo'].some(kw => assetLower.includes(kw))) return 'video';
    if (['logo', 'icon', 'badge'].some(kw => assetLower.includes(kw))) return 'icon_logo';
    if (['chart', 'graph', 'diagram', 'table', 'pie', 'bar graph', 'line graph', 'data viz'].some(kw => assetLower.includes(kw))) return 'infograph';
    if (['timeline', 'schedule', 'roadmap', 'gantt'].some(kw => assetLower.includes(kw))) return 'timeline';
    if (['background', 'bg image', 'backdrop'].some(kw => assetLower.includes(kw))) return 'image_background';
    return 'other';
  };

  // Parse aspect ratio from asset string like "[Image | 16:9]" → { w: 16, h: 9 }
  const getAssetRatio = (asset) => {
    const ratioMatch = asset.match(/\|\s*(\d+):(\d+)/);
    if (ratioMatch) {
      const w = parseInt(ratioMatch[1]);
      const h = parseInt(ratioMatch[2]);
      // Enforce minimum 16:9 for timelines
      const type = getAssetType(asset);
      if (type === 'timeline' && (w / h) < (16 / 9)) {
        return { w: 16, h: 9 };
      }
      return { w, h };
    }
    // Defaults by type
    const type = getAssetType(asset);
    if (type === 'timeline') return { w: 4, h: 1 };
    if (type === 'infograph') return { w: 4, h: 3 };
    if (type === 'video') return { w: 16, h: 9 };
    return { w: 16, h: 9 };
  };

  // Get CSS aspect ratio string
  const getAspectStyle = (asset) => {
    const r = getAssetRatio(asset);
    return `${r.w}/${r.h}`;
  };
  
  // Get ratio label for display
  const getRatioLabel = (asset) => {
    const ratioMatch = asset.match(/\|\s*(\d+:\d+)/);
    return ratioMatch ? ratioMatch[1] : null;
  };

  // Get clean asset label (strip the type prefix and ratio)
  const getAssetLabel = (asset) => {
    return asset.replace(/^\[(?:Image Background|Image|Video|Icon\/Logo|Icon|Logo|Infograph|Timeline)(?:\s*\|\s*\d+:\d+)?\]\s*[-–—]?\s*/i, '').replace(/<<.+?>>/g, '').trim();
  };

  // Get human-readable type label
  const getAssetTypeLabel = (type) => {
    const labels = {
      image: 'Image',
      video: 'Video',
      icon_logo: 'Icon/Logo',
      infograph: 'Infograph',
      timeline: 'Timeline',
      image_background: 'Image Background',
      other: 'Asset'
    };
    return labels[type] || 'Asset';
  };
  
  // Filter to assets that need large frames in the visualizer
  const isFrameAsset = (asset) => {
    const type = getAssetType(asset);
    return ['image', 'video', 'timeline', 'infograph'].includes(type);
  };

  // Parse layout structure hints for dynamic asset placement
  const parseLayoutHints = () => {
    const ls = (parsed.layoutStructure || '').toLowerCase();
    const hints = {
      imageSpansFullWidth: false,  // image goes above all columns
      imagePerColumn: false,       // one image per column
      imageLeft: false,            // image on left side
      imageRight: false,           // image on right side
      imageTop: false,             // image at top of content area
      imageBottom: false,          // image at bottom
      textLeft: false,
      textRight: false,
    };
    
    if (/(?:wide|hero|full[- ]?width|spanning).+(?:image|photo|video|asset)/i.test(ls) || 
        (/(?:image|photo|video|asset).+(?:span|full[- ]?width|across|above.*column)/i.test(ls) && !/span.*full.*height/i.test(ls))) {
      hints.imageSpansFullWidth = true;
    }
    if (/(?:image|photo).+(?:each|per|above each|both) (?:column|section)/i.test(ls) ||
        /(?:each|per|both) (?:column|section).+(?:image|photo|topped)/i.test(ls)) {
      hints.imagePerColumn = true;
    }
    if (/(?:image|photo|video|visual|asset).+(?:left|on the left)/i.test(ls) || /(?:left).+(?:image|photo|video|visual)/i.test(ls)) {
      hints.imageLeft = true;
    }
    if (/(?:image|photo|video|visual|asset).+(?:right|on the right)/i.test(ls) || /(?:right).+(?:image|photo|video|visual)/i.test(ls)) {
      hints.imageRight = true;
    }
    // "image at top" or "image above" but NOT "top image 16:9" (which means stacking order, not page position)
    if ((/(?:image|photo|video).+(?:at top|above text|upper area|top of)/i.test(ls) || /(?:at top|above text|upper area).+(?:image|photo|video)/i.test(ls)) &&
        !/top image \d/i.test(ls)) {
      hints.imageTop = true;
    }
    if (/(?:image|photo|video).+(?:bottom|below|lower)/i.test(ls) || /(?:bottom|below|lower).+(?:image|photo|video)/i.test(ls)) {
      hints.imageBottom = true;
    }
    if (/(?:text|content|copy).+(?:left)/i.test(ls)) hints.textLeft = true;
    if (/(?:text|content|copy).+(?:right)/i.test(ls)) hints.textRight = true;
    
    // Priority: explicit side placement (left/right) overrides top/bottom
    // This prevents dual rendering when both hints accidentally fire
    if ((hints.imageRight || hints.imageLeft) && (hints.imageTop || hints.imageBottom)) {
      hints.imageTop = false;
      hints.imageBottom = false;
    }
    
    return hints;
  };
  
  const columnCount = layoutKey === 'TWO_COLUMNS' ? 2 : layoutKey === 'THREE_COLUMNS' ? 3 : layoutKey === 'FOUR_COLUMNS' ? 4 : 1;
  const copySections = parseCopyContent(parsed.copyContent, columnCount);
  const assets = parseAssets();
  const visualAssets = assets.filter(isFrameAsset);
  const iconAssets = assets.filter(a => getAssetType(a) === 'icon_logo');
  const layoutHints = parseLayoutHints();
  
  // Asset index map: maps each asset string → 1-based index in the full asset list
  // Used for numbered references in both the preview and info panel
  const assetIndexMap = useMemo(() => {
    const map = new Map();
    assets.forEach((asset, i) => map.set(asset, i + 1));
    return map;
  }, [assets]);

  // Image/Video placeholder component - visible frame with icon, label, and ratio
  // Uses CSS aspect-ratio to match the ratio declared in the markdown
  // When placedAsset is provided, renders the actual image/video thumbnail instead of placeholder
  const ImagePlaceholder = ({ label, assetType = 'image', className = "", fillContainer = false, placedAsset = null }) => {
    const isVideo = assetType === 'video';
    const isInfograph = assetType === 'infograph';
    const isTimeline = assetType === 'timeline';
    const ratioLabel = getRatioLabel(label);
    const aiRatio = getAssetRatio(label);

    // For placed assets, use pre-computed native aspect ratio from cache (stable, no re-renders)
    let ratio = aiRatio;
    if (placedAsset && placedAsset.type !== 'video') {
      const cleanName = (placedAsset.file?.name || '').replace(/^\[Project\]\s*/, '').toLowerCase();
      if (nativeRatioCache[cleanName]) {
        ratio = nativeRatioCache[cleanName];
      }
    }

    // Aspect-ratio enforcement strategy:
    // fillContainer: Parent gives us a bounding box. We set aspect-ratio and
    //   height:100% so the image fills the container height. maxWidth:100% prevents
    //   horizontal overflow — ultra-wide images scale down proportionally.
    // Normal: width:100%, aspect-ratio computes height. No height constraint.

    // When a placed asset is provided, render the actual image
    if (placedAsset) {
      const isPlacedVideo = placedAsset.type === 'video';
      const placedStyle = fillContainer
        ? {
            minHeight: '40px',
            aspectRatio: `${ratio.w}/${ratio.h}`,
            height: '100%',
            maxWidth: '100%',
          }
        : {
            minHeight: '40px',
            aspectRatio: `${ratio.w}/${ratio.h}`,
            width: '100%',
          };

      return (
        <div
          className={`rounded overflow-hidden relative ${className}`}
          style={placedStyle}
        >
          {isPlacedVideo ? (
            <VideoThumbnail asset={placedAsset} />
          ) : (
            <img
              src={`data:${placedAsset.mediaType};base64,${placedAsset.content}`}
              alt={placedAsset.file?.name || 'Placed asset'}
              className="w-full h-full object-cover"
            />
          )}
          {/* Filename overlay */}
          <span
            className="absolute bottom-0 left-0 right-0 text-center px-1 py-0.5 truncate"
            style={{
              fontSize: '6px',
              color: '#fff',
              backgroundColor: 'rgba(0,0,0,0.6)',
              letterSpacing: '0.02em'
            }}
          >
            {placedAsset.file?.name || 'Asset'}
          </span>
        </div>
      );
    }

    // Height-driven sizing for all images in fillContainer mode:
    // height:100% fills container, maxWidth:100% prevents horizontal overflow.
    // The layout wrapper clamps ultra-wide ARs to the available space, so ImagePlaceholder
    // doesn't need to know about AR limits — it just fills its container.
    const style = fillContainer
      ? {
          borderColor: assetColor,
          backgroundColor: `${colors[0]}66`,
          minHeight: '40px',
          aspectRatio: `${ratio.w}/${ratio.h}`,
          height: '100%',
          maxWidth: '100%',
        }
      : {
          borderColor: assetColor,
          backgroundColor: `${colors[0]}66`,
          minHeight: '40px',
          aspectRatio: `${ratio.w}/${ratio.h}`,
          width: '100%',
        };

    return (
      <div
        className={`border-2 border-dashed flex flex-col items-center justify-center rounded p-1 relative ${className}`}
        style={style}
      >
        {ratioLabel && (
          <span className="absolute top-0.5 right-1 text-[10px] font-mono opacity-70" style={{color: assetColor}}>{ratioLabel}</span>
        )}
        {isVideo ? (
          <svg className="w-5 h-5 flex-shrink-0 mb-0.5" style={{color: assetColor}} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="2" y="4" width="20" height="16" rx="2" strokeWidth="1.5"/>
            <polygon points="10,8 16,12 10,16" strokeWidth="1.5" fill="currentColor" opacity="0.3"/>
          </svg>
        ) : isInfograph ? (
          <svg className="w-5 h-5 flex-shrink-0 mb-0.5" style={{color: assetColor}} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="3" y="12" width="4" height="8" rx="1" strokeWidth="1.5"/>
            <rect x="10" y="6" width="4" height="14" rx="1" strokeWidth="1.5"/>
            <rect x="17" y="9" width="4" height="11" rx="1" strokeWidth="1.5"/>
          </svg>
        ) : isTimeline ? (
          <svg className="w-6 h-4 flex-shrink-0 mb-0.5" style={{color: assetColor}} fill="none" stroke="currentColor" viewBox="0 0 24 12">
            <line x1="1" y1="6" x2="23" y2="6" strokeWidth="1.5"/>
            <circle cx="4" cy="6" r="2" strokeWidth="1.5"/>
            <circle cx="12" cy="6" r="2" strokeWidth="1.5"/>
            <circle cx="20" cy="6" r="2" strokeWidth="1.5"/>
          </svg>
        ) : (
          <svg className="w-5 h-5 flex-shrink-0 mb-0.5" style={{color: assetColor}} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeWidth="1.5"/>
            <circle cx="8.5" cy="8.5" r="1.5" strokeWidth="1.5"/>
            <path d="M21 15l-5-5L5 21" strokeWidth="1.5"/>
          </svg>
        )}
        <span
          className="text-center w-full px-1 leading-tight"
          style={{
            color: assetColor,
            fontSize: '7px',
            wordBreak: 'break-word'
          }}
        >
          {getAssetLabel(label) || 'Image'}
        </span>
      </div>
    );
  };
  
  // Small icon/logo placeholder for inline placement
  // When assetIndex is provided, shows the number badge. Otherwise shows label.
  const IconLogoPlaceholder = ({ label, assetIndex }) => (
    <div 
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-dashed"
      style={{ borderColor: `${assetColor}88`, backgroundColor: `${colors[0]}44` }}
    >
      <svg className="w-3 h-3 flex-shrink-0" style={{color: assetColor}} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <rect x="3" y="3" width="18" height="18" rx="4" strokeWidth="1.5"/>
        <circle cx="12" cy="12" r="4" strokeWidth="1.5"/>
      </svg>
      <span style={{ color: assetColor, fontSize: '8px', fontWeight: 'bold' }}>
        {assetIndex != null ? `${assetIndex}` : (getAssetLabel(label) || 'Logo')}
      </span>
    </div>
  );
  
  // Calculate dynamic font size based on content length - small threshold range
  const getDynamicFontSize = (text, baseSize = 14, minSize = 11, maxChars = 400) => {
    const length = text?.length || 0;
    if (length <= 80) return baseSize;
    if (length >= maxChars) return minSize;
    const scale = 1 - ((length - 80) / (maxChars - 80)) * 0.25;
    return Math.max(minSize, Math.round(baseSize * scale));
  };
  
  // Get all copy text for sizing calculation
  const getAllCopyText = () => {
    return copySections.map(s => s.header + ' ' + s.items.map(i => typeof i === 'string' ? i : i.text).join(' ')).join(' ') || parsed.copyContent || '';
  };
  
  // Build placed asset lookup: maps filenames to actual file data from placementAssets
  const placedAssetFileMap = useMemo(() => {
    const map = new Map();
    if (!placementAssets || placementAssets.length === 0) return map;
    placementAssets.forEach(f => {
      const name = f.file?.name || '';
      const cleanName = name.replace(/^\[Project\]\s*/, '');
      map.set(cleanName.toLowerCase(), f);
      map.set(name.toLowerCase(), f);
    });
    return map;
  }, [placementAssets]);

  // Pre-compute native aspect ratios for all placement assets (images only).
  // Keyed by lowercase filename. Stable across re-renders — only recomputes when assets change.
  const [nativeRatioCache, setNativeRatioCache] = useState({});
  useEffect(() => {
    if (!placementAssets || placementAssets.length === 0) { setNativeRatioCache({}); return; }
    const cache = {};
    let pending = 0;
    placementAssets.forEach(f => {
      if (f.type === 'video') return;
      const cleanName = (f.file?.name || '').replace(/^\[Project\]\s*/, '').toLowerCase();
      if (!cleanName) return;
      pending++;
      const img = new window.Image();
      img.onload = () => {
        if (img.naturalWidth && img.naturalHeight) {
          cache[cleanName] = { w: img.naturalWidth, h: img.naturalHeight };
        }
        pending--;
        if (pending === 0) setNativeRatioCache({ ...cache });
      };
      img.onerror = () => { pending--; if (pending === 0) setNativeRatioCache({ ...cache }); };
      const src = f.content?.startsWith('data:')
        ? f.content
        : `data:${f.mediaType};base64,${f.content}`;
      img.src = src;
    });
    if (pending === 0) setNativeRatioCache({});
  }, [placementAssets]);

  // Look up placed asset for a given asset label from REQUIRED ASSETS
  // Matches <<filename.jpg>> markers embedded in the asset description
  const getPlacedAsset = (label) => {
    if (placedAssetFileMap.size === 0 || !label) return null;
    // Look for <<filename>> marker in the label
    const markerMatch = label.match(/<<(.+?)>>/);
    if (markerMatch) {
      const filename = markerMatch[1].trim().toLowerCase();
      if (placedAssetFileMap.has(filename)) return placedAssetFileMap.get(filename);
    }
    return null;
  };

  const renderLayout = () => {
    const copyText = getAllCopyText();
    // Font sizes scaled to match preview size (11→12px body, 10→11px min)
    const bodyFontSize = getDynamicFontSize(copyText, 12, 11, 800);
    const headerFontSize = Math.min(13, bodyFontSize + 1);
    
    // Title slide - centered title with subtitle, optional logo
    // Supports two icon placements: large+centered above title (logo) or small badge in corner
    if (layoutKey === 'TITLE_SLIDE') {
      const hasLargeLogo = iconAssets.some(icon => {
        const desc = (icon + ' ' + (parsed.layoutStructure || '')).toLowerCase();
        return desc.includes('large') || desc.includes('centered') || desc.includes('center');
      });
      return (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 relative overflow-hidden" style={{backgroundColor: colors[0]}}>
          {iconAssets.length > 0 && !hasLargeLogo && (
            <div className="absolute top-3 left-4 flex gap-2">
              {iconAssets.map((icon, i) => <IconLogoPlaceholder key={i} label={icon} assetIndex={assetIndexMap.get(icon)} />)}
            </div>
          )}
          {iconAssets.length > 0 && hasLargeLogo && (
            <div className="flex flex-col items-center gap-1 mb-4 z-10">
              {iconAssets.map((icon, i) => (
                <div key={i} className="flex flex-col items-center justify-center rounded border-2 border-dashed p-3" style={{borderColor: `${assetColor}88`, backgroundColor: `${colors[0]}44`, width: '72px', height: '72px'}}>
                  <svg className="w-8 h-8 flex-shrink-0" style={{color: assetColor}} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <rect x="3" y="3" width="18" height="18" rx="4" strokeWidth="1.5"/>
                    <circle cx="12" cy="12" r="4" strokeWidth="1.5"/>
                  </svg>
                  <span style={{ color: assetColor, fontSize: '7px', fontWeight: 'bold', marginTop: '2px' }}>
                    {assetIndexMap.get(icon) != null ? `${assetIndexMap.get(icon)}` : (getAssetLabel(icon) || 'Logo')}
                  </span>
                </div>
              ))}
            </div>
          )}
          <h2 className="text-2xl font-bold mb-3 text-center max-w-lg" {...editableProps('title', {color: colors[1]})}>{parsed.title || 'Click to add title'}</h2>
          {parsed.subtitle && <p className="text-base text-center max-w-md" {...editableProps('subtitle', {color: colors[2]})}>{parsed.subtitle}</p>}
        </div>
      );
    }
    
    // Title Page w/Gradient - title slide with gradient background, supports [Image Background]
    // Background uses theme color. Black gradient radiates from bottom-left corner, fading out before upper third.
    // Supports two icon placements: large+centered above title (logo) or small badge in corner
    if (layoutKey === 'TITLE_PAGE_GRADIENT') {
      const bgAssets = assets.filter(a => getAssetType(a) === 'image_background');
      const hasLargeLogo = iconAssets.some(icon => {
        const desc = (icon + ' ' + (parsed.layoutStructure || '')).toLowerCase();
        return desc.includes('large') || desc.includes('centered') || desc.includes('center');
      });
      return (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 relative overflow-hidden" style={{backgroundColor: colors[0]}}>
          {bgAssets.length > 0 && (
            <div className="absolute inset-0 border-2 border-dashed rounded flex items-center justify-center" style={{borderColor: `${assetColor}44`, backgroundColor: `${colors[0]}11`}}>
              <span style={{color: assetColor, fontSize: '9px', opacity: 0.6}}>{getAssetLabel(bgAssets[0])}</span>
            </div>
          )}
          {/* Black gradient from bottom-left corner — small, fades out before upper third */}
          <div className="absolute inset-0 z-[1]" style={{background: 'radial-gradient(ellipse at 0% 100%, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 25%, rgba(0,0,0,0) 55%)'}} />
          {iconAssets.length > 0 && !hasLargeLogo && (
            <div className="absolute top-3 left-4 flex gap-2 z-10">
              {iconAssets.map((icon, i) => <IconLogoPlaceholder key={i} label={icon} assetIndex={assetIndexMap.get(icon)} />)}
            </div>
          )}
          {iconAssets.length > 0 && hasLargeLogo && (
            <div className="flex flex-col items-center gap-1 mb-4 z-10">
              {iconAssets.map((icon, i) => (
                <div key={i} className="flex flex-col items-center justify-center rounded border-2 border-dashed p-3" style={{borderColor: `${assetColor}88`, backgroundColor: `${colors[0]}44`, width: '72px', height: '72px'}}>
                  <svg className="w-8 h-8 flex-shrink-0" style={{color: assetColor}} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <rect x="3" y="3" width="18" height="18" rx="4" strokeWidth="1.5"/>
                    <circle cx="12" cy="12" r="4" strokeWidth="1.5"/>
                  </svg>
                  <span style={{ color: assetColor, fontSize: '7px', fontWeight: 'bold', marginTop: '2px' }}>
                    {assetIndexMap.get(icon) != null ? `${assetIndexMap.get(icon)}` : (getAssetLabel(icon) || 'Logo')}
                  </span>
                </div>
              ))}
            </div>
          )}
          <h2 className="text-2xl font-bold mb-3 text-center max-w-lg relative z-10" {...editableProps('title', {color: colors[1]})}>{parsed.title || 'Click to add title'}</h2>
          {parsed.subtitle && <p className="text-base text-center max-w-md relative z-10" {...editableProps('subtitle', {color: colors[2]})}>{parsed.subtitle}</p>}
        </div>
      );
    }
    
    // Section header - large centered section text
    if (layoutKey === 'SECTION_HEADER') {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 overflow-hidden relative" style={{backgroundColor: colors[0]}}>
          {iconAssets.length > 0 && (
            <div className="absolute top-3 left-4 flex gap-2">
              {iconAssets.map((icon, i) => <IconLogoPlaceholder key={i} label={icon} assetIndex={assetIndexMap.get(icon)} />)}
            </div>
          )}
          <h2 className="text-3xl font-bold text-center max-w-lg" {...editableProps('title', {color: colors[1]})}>{parsed.title || 'Click to add title'}</h2>
          {parsed.subtitle && <p className="text-base text-center max-w-md mt-3" {...editableProps('subtitle', {color: colors[2]})}>{parsed.subtitle}</p>}
        </div>
      );
    }
    
    // Section Header w/Gradient - section header with gradient
    // Background uses theme color. Black gradient radiates from bottom-left corner, fading out before upper third.
    if (layoutKey === 'SECTION_HEADER_GRADIENT') {
      const bgAssets = assets.filter(a => getAssetType(a) === 'image_background');
      return (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 relative overflow-hidden" style={{backgroundColor: colors[0]}}>
          {bgAssets.length > 0 && (
            <div className="absolute inset-0 border-2 border-dashed rounded flex items-center justify-center" style={{borderColor: `${assetColor}44`, backgroundColor: `${colors[0]}11`}}>
              <span style={{color: assetColor, fontSize: '9px', opacity: 0.6}}>{getAssetLabel(bgAssets[0])}</span>
            </div>
          )}
          {/* Black gradient from bottom-left corner — small, fades out before upper third */}
          <div className="absolute inset-0 z-[1]" style={{background: 'radial-gradient(ellipse at 0% 100%, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 25%, rgba(0,0,0,0) 55%)'}} />
          <h2 className="text-3xl font-bold text-center max-w-lg relative z-10" {...editableProps('title', {color: colors[1]})}>{parsed.title || 'Click to add title'}</h2>
          {parsed.subtitle && <p className="text-base text-center max-w-md mt-3 relative z-10" {...editableProps('subtitle', {color: colors[2]})}>{parsed.subtitle}</p>}
        </div>
      );
    }
    
    // Title only - title at top with open space below for content
    if (layoutKey === 'TITLE_ONLY') {
      return (
        <div className="w-full h-full flex flex-col p-4 overflow-hidden" style={{backgroundColor: colors[0]}}>
          <div className="flex items-center gap-2 mb-1 flex-shrink-0">
            <h2 className="text-xl font-bold" {...editableProps('title', {color: colors[1]})}>{parsed.title || 'Click to add title'}</h2>
            {iconAssets.length > 0 && iconAssets.map((icon, i) => <IconLogoPlaceholder key={i} label={icon} assetIndex={assetIndexMap.get(icon)} />)}
          </div>
          {parsed.subtitle && <p className="text-sm mb-2 flex-shrink-0" {...editableProps('subtitle', {color: colors[2]})}>{parsed.subtitle}</p>}
          <div className="flex-1 flex gap-3">
            <div className="flex-1 rounded border-2 border-dashed flex items-center justify-center p-2" {...editableBodyProps({borderColor: `${assetColor}44`, color: colors[3], fontSize: `${bodyFontSize}px`})}>
              <span className="text-xs" style={{color: `${assetColor}88`}}>{parsed.copyContent || 'Content area'}</span>
            </div>
            {visualAssets.length > 0 && (
              <div className="flex items-center justify-center" style={{width: '180px', height: '160px'}}>
                <ImagePlaceholder label={visualAssets[0]} assetType={getAssetType(visualAssets[0])} fillContainer={true} placedAsset={getPlacedAsset(visualAssets[0])} />
              </div>
            )}
          </div>
        </div>
      );
    }
    
    // Title and two columns - visual assets ALWAYS above text columns (never inside them)
    // 1 image: centered above columns. 2-4 images: horizontal row left-to-right.
    // Text columns: min 40% of frame height. Assets max 57% of frame height. 3% spacing between.
    if (layoutKey === 'TWO_COLUMNS') {
      const assetCount = Math.min(visualAssets.length, 4);
      const centerAssets = assetCount === 1 || assetCount === 2; // center-align 1 or 2 assets

      // Build the visual assets row (above text columns)
      // Max 57% of content area height. Images share same height with correct aspect ratios.
      //
      // Strategy: width-driven sizing with percentage widths. No flex gap — spacing via padding.
      // Each image width% = ratio_i / totalRatioSum * 100. Inner div has aspect-ratio + width:100%.
      // Since all widths are proportional to their ratios, all computed heights are equal:
      //   h_i = (width_i / ratio_i) = (totalWidth * ratio_i/sum) / ratio_i = totalWidth / sum = const.
      // The row uses aspect-ratio: totalRatioSum to set its intrinsic height = width / sum.
      // maxHeight: 57% caps it. When capped, images overflow but overflow:hidden clips — however
      // since all images share the same height, if any overflows they all do, and we prevent that
      // by adjusting the row width down when capped (CSS aspect-ratio + maxHeight handles this).
      const assetRatios = visualAssets.slice(0, 4).map(a => { const r = getAssetRatio(a); return r.w / r.h; });
      const totalRatioSum = assetRatios.reduce((s, r) => s + r, 0);
      // Height thresholds: 1-2 images 50%-57%, 3 images 37%-51%, 4 images 30%-51%.
      // Text gets remainder minus 3% spacer.
      const assetsMaxPct = assetCount <= 2 ? 57 : 51;
      const assetsMinPct = assetCount <= 2 ? 50 : (assetCount === 3 ? 37 : 30);
      const textMinPct = assetCount <= 2 ? '40%' : '46%';
      // Strategy: height-driven sizing. The row gets a fixed height (flex-basis) between min and max.
      // The ideal height = rowWidth / totalRatioSum (all images fill full width at shared height).
      // We clamp this between min% and max% of content area.
      // Each image uses height:100% + aspect-ratio to compute its width from the shared height.
      // flex-grow proportional to ratio ensures correct width distribution.
      // When height is clamped below ideal, images won't fill full width (some space on right).
      // When height equals ideal, images fill exactly. Height never exceeds max.
      //
      // We compute the ideal height as a % of content area: idealPct = 100 / totalRatioSum * (contentW/contentH).
      // Content area is ~1009x503px (from 720x405 slide minus title block).
      // Title block height is fixed regardless of subtitle presence.
      // idealPct = 100 * contentAR / totalRatioSum where contentAR = contentW/contentH ≈ 2.006.
      const contentW = 1009;
      const contentH = 503;
      const contentAR = contentW / contentH;
      const idealPct = Math.round(100 * contentAR / totalRatioSum * 10) / 10;
      // For centerAssets (1-2 images), each image is in a flex-1 container with 8px gap.
      // The container width per image = (contentW - gap*(n-1)) / n.
      // Max height before any image overflows its container: containerW / maxRatio.
      // We must cap the max to prevent horizontal overflow within individual containers.
      let widthCapPct = assetsMaxPct;
      if (centerAssets) {
        const gap = 8;
        const containerW = (contentW - gap * (assetCount - 1)) / assetCount;
        const maxRatio = Math.max(...assetRatios);
        widthCapPct = Math.round(100 * containerW / (maxRatio * contentH) * 10) / 10;
      }
      const effectiveMax = Math.min(assetsMaxPct, widthCapPct);
      // If min height would cause images to overflow horizontally, use idealPct instead
      const effectiveMin = idealPct < assetsMinPct ? idealPct : assetsMinPct;

      // Dynamic sizing: estimate text content volume and adjust asset height accordingly.
      // More text → assets shrink toward min. Less text → assets stay at ideal/max.
      // Count total text items across all columns. Each item ≈ 1 rendered line.
      const totalTextItems = copySections.reduce((sum, s) => sum + (s.header ? 1 : 0) + s.items.length, 0);
      const numCols = 2;
      // Estimate how many lines fit in the text area when assets are at minimum height.
      // At effectiveMin, text gets (100 - effectiveMin - 3)% of contentH. Each line ≈ 16px.
      const lineHeight = 16;
      const maxTextH = contentH * (100 - effectiveMin - 3) / 100;
      const linesPerColAtMin = Math.floor(maxTextH / lineHeight);
      const maxLinesAtMin = linesPerColAtMin * numCols;
      // textDemand: 0 (few lines) to 1 (many lines, need maximum text space)
      const textDemand = Math.min(1, totalTextItems / Math.max(1, maxLinesAtMin));
      // Blend: at textDemand=0 use upperTarget (ideal/max), at textDemand=1 use effectiveMin
      const upperTarget = Math.min(effectiveMax, idealPct);
      const dynamicPct = upperTarget - textDemand * (upperTarget - effectiveMin);
      let clampedPct = Math.max(effectiveMin, Math.min(effectiveMax, Math.round(dynamicPct * 10) / 10));

      // Derive AR width limit from the actual available space.
      // At minimum asset height (effectiveMin), the asset row is at its smallest.
      // widthLimitAR = containerW / minAssetH → the widest AR that fills the container at min height.
      // Images wider than this get their rendered AR clamped so they fill the space instead of shrinking.
      const minAssetH = contentH * effectiveMin / 100;
      const perImageW = centerAssets
        ? (contentW - 8 * (assetCount - 1)) / assetCount
        : contentW;
      const widthLimitAR = perImageW / minAssetH;

      const assetsRow = assetCount > 0 && (
        <div style={{
          flex: `0 0 ${clampedPct}%`,
          display: 'flex',
          alignItems: 'stretch',
          width: '100%',
          overflow: 'hidden',
          gap: centerAssets ? '8px' : undefined,
        }}>
          {visualAssets.slice(0, 4).map((asset, i) => {
            const r = getAssetRatio(asset);
            const imageAR = r.w / r.h;
            // Clamp the rendered AR: if image is wider than the available space allows,
            // cap at widthLimitAR so it fills the container instead of being tiny.
            const renderAR = Math.min(imageAR, widthLimitAR);
            if (centerAssets) {
              // Height-driven with aspect-ratio wrapper.
              // height:100% fills the allocated row height, aspect-ratio computes width,
              // maxWidth:100% on the inner wrapper prevents horizontal overflow.
              return (
                <div key={i} style={{flex: '1 1 0%', display: 'flex', justifyContent: 'center', alignItems: 'stretch', minWidth: 0, overflow: 'hidden'}}>
                  <div style={{maxHeight: '100%', maxWidth: '100%', height: '100%', flexShrink: 0}}>
                    <div style={{aspectRatio: `${renderAR}`, height: '100%'}}>
                      <ImagePlaceholder label={asset} assetType={getAssetType(asset)} fillContainer={true} placedAsset={getPlacedAsset(asset)} />
                    </div>
                  </div>
                </div>
              );
            }
            // For 3-4 images: pack left, height-driven sizing.
            return (
              <div key={i} style={{height: '100%', flexShrink: 0, flexGrow: 0, flexBasis: 'auto'}}>
                <div style={{aspectRatio: `${renderAR}`, height: '100%'}}>
                  <ImagePlaceholder label={asset} assetType={getAssetType(asset)} fillContainer={true} placedAsset={getPlacedAsset(asset)} />
                </div>
              </div>
            );
          })}
        </div>
      );

      // Text columns — pure text, no images inside. Min height varies by asset count.
      const textColumns = (
        <div className="flex gap-2 min-h-0" {...editableBodyProps({flex: `1 0 ${textMinPct}`})}>
          {copySections.length >= 2 ? (
            copySections.slice(0, 2).map((section, idx) => (
              <div key={idx} className="flex-1 p-2 rounded border overflow-hidden" style={{borderColor: `${colors[1]}44`, backgroundColor: `${colors[0]}cc`}}>
                {section.header && <h3 className="font-bold mb-1 uppercase flex-shrink-0" style={{color: colors[1], fontSize: `${headerFontSize}px`}}>{section.header}</h3>}
                <div className="overflow-hidden">
                  {section.items.map((item, i) => (
                    <p key={i} className="leading-snug mb-1" style={{color: colors[3], fontSize: `${bodyFontSize}px`}}>{renderItem(item, colors, bodyFontSize)}</p>
                  ))}
                </div>
              </div>
            ))
          ) : copySections.length === 1 ? (
            <>
              <div className="flex-1 p-2 rounded border overflow-hidden" style={{borderColor: `${colors[1]}44`, backgroundColor: `${colors[0]}cc`}}>
                {copySections[0].header && <h3 className="font-bold mb-1 uppercase flex-shrink-0" style={{color: colors[1], fontSize: `${headerFontSize}px`}}>{copySections[0].header}</h3>}
                <div className="overflow-hidden">
                  {copySections[0].items.map((item, i) => (
                    <p key={i} className="leading-snug mb-1" style={{color: colors[3], fontSize: `${bodyFontSize}px`}}>{renderItem(item, colors, bodyFontSize)}</p>
                  ))}
                </div>
              </div>
              <div className="flex-1 p-2 rounded border overflow-hidden" style={{borderColor: `${colors[1]}44`, backgroundColor: `${colors[0]}cc`}}>
                <p style={{color: colors[3], fontSize: `${bodyFontSize}px`}}>Click to add text</p>
              </div>
            </>
          ) : (
            <>
              <div className="flex-1 p-2 rounded border overflow-hidden" style={{borderColor: `${colors[1]}44`, backgroundColor: `${colors[0]}cc`}}>
                <p style={{color: colors[3], fontSize: `${bodyFontSize}px`}}>Click to add text</p>
              </div>
              <div className="flex-1 p-2 rounded border overflow-hidden" style={{borderColor: `${colors[1]}44`, backgroundColor: `${colors[0]}cc`}}>
                <p style={{color: colors[3], fontSize: `${bodyFontSize}px`}}>Click to add text</p>
              </div>
            </>
          )}
        </div>
      );

      return (
        <div className="w-full h-full flex flex-col p-3 overflow-hidden" style={{backgroundColor: colors[0]}}>
          <div className="mb-2 flex-shrink-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold" {...editableProps('title', {color: colors[1]})}>{parsed.title || 'Click to add title'}</h2>
              {iconAssets.length > 0 && iconAssets.map((icon, i) => <IconLogoPlaceholder key={i} label={icon} assetIndex={assetIndexMap.get(icon)} />)}
            </div>
            <p className="text-xs" {...editableProps('subtitle', {color: colors[2], visibility: parsed.subtitle ? 'visible' : 'hidden'})}>{parsed.subtitle || '\u00A0'}</p>
          </div>
          {/* Content area: assets (max 57% for 1-2 imgs, 51% for 3-4) + spacer (3%) + text (min 40%/48%) */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {assetsRow}
            {assetCount > 0 && <div className="flex-shrink-0" style={{flex: '0 0 3%'}} />}
            {textColumns}
          </div>
        </div>
      );
    }

    // Title and three columns / Title and four columns
    // Same visual pattern as TWO_COLUMNS: assets ABOVE text columns, never inside.
    // centerAssets when asset count matches column count (3 for THREE_COLUMNS, 4 for FOUR_COLUMNS) or 1-2 images.
    // Same height thresholds and text minimums as TWO_COLUMNS.
    if (layoutKey === 'THREE_COLUMNS' || layoutKey === 'FOUR_COLUMNS') {
      const numColumns = layoutKey === 'THREE_COLUMNS' ? 3 : 4;
      const assetCount = Math.min(visualAssets.length, 4);
      // centerAssets: align images above columns when count matches column count, or for 1-2 images
      const centerAssets = assetCount <= 2 || assetCount === numColumns;

      const assetRatios = visualAssets.slice(0, 4).map(a => { const r = getAssetRatio(a); return r.w / r.h; });
      const totalRatioSum = assetRatios.reduce((s, r) => s + r, 0);
      // Height thresholds: 1-2 images 50%-57%, 3 images 37%-51%, 4 images 30%-51%.
      const assetsMaxPct = assetCount <= 2 ? 57 : 51;
      const assetsMinPct = assetCount <= 2 ? 50 : (assetCount === 3 ? 37 : 30);
      const textMinPct = assetCount <= 2 ? '40%' : '46%';
      const contentW = 1009;
      const contentH = 503;
      const contentAR = contentW / contentH;
      const idealPct = Math.round(100 * contentAR / totalRatioSum * 10) / 10;
      // Width cap for centerAssets to prevent horizontal overflow
      let widthCapPct = assetsMaxPct;
      if (centerAssets) {
        const gap = 8;
        const containerW = (contentW - gap * (assetCount - 1)) / assetCount;
        const maxRatio = Math.max(...assetRatios);
        widthCapPct = Math.round(100 * containerW / (maxRatio * contentH) * 10) / 10;
      }
      const effectiveMax = Math.min(assetsMaxPct, widthCapPct);
      const effectiveMin = idealPct < assetsMinPct ? idealPct : assetsMinPct;

      // Dynamic sizing: estimate text content volume and adjust asset height accordingly.
      // More text → assets shrink toward min. Less text → assets stay at ideal/max.
      const totalTextItems = copySections.reduce((sum, s) => sum + (s.header ? 1 : 0) + s.items.length, 0);
      const lineHeight = 16;
      const maxTextH = contentH * (100 - effectiveMin - 3) / 100;
      const linesPerColAtMin = Math.floor(maxTextH / lineHeight);
      const maxLinesAtMin = linesPerColAtMin * numColumns;
      const textDemand = Math.min(1, totalTextItems / Math.max(1, maxLinesAtMin));
      const upperTarget = Math.min(effectiveMax, idealPct);
      const dynamicPct = upperTarget - textDemand * (upperTarget - effectiveMin);
      let clampedPct = Math.max(effectiveMin, Math.min(effectiveMax, Math.round(dynamicPct * 10) / 10));

      // Derive AR width limit from the actual available space (same logic as TWO_COLUMNS).
      const minAssetH3 = contentH * effectiveMin / 100;
      const perImageW3 = centerAssets
        ? (contentW - 8 * (assetCount - 1)) / assetCount
        : contentW;
      const widthLimitAR3 = perImageW3 / minAssetH3;

      const assetsRow = assetCount > 0 && (
        <div style={{
          flex: `0 0 ${clampedPct}%`,
          display: 'flex',
          alignItems: 'stretch',
          width: '100%',
          overflow: 'hidden',
          gap: centerAssets ? '8px' : undefined,
        }}>
          {visualAssets.slice(0, 4).map((asset, i) => {
            const r = getAssetRatio(asset);
            const imageAR = r.w / r.h;
            // Clamp the rendered AR to the width limit derived from available space
            const renderAR = Math.min(imageAR, widthLimitAR3);
            if (centerAssets) {
              // Height-driven with aspect-ratio wrapper.
              return (
                <div key={i} style={{flex: '1 1 0%', display: 'flex', justifyContent: 'center', alignItems: 'stretch', minWidth: 0, overflow: 'hidden'}}>
                  <div style={{maxHeight: '100%', maxWidth: '100%', height: '100%', flexShrink: 0}}>
                    <div style={{aspectRatio: `${renderAR}`, height: '100%'}}>
                      <ImagePlaceholder label={asset} assetType={getAssetType(asset)} fillContainer={true} placedAsset={getPlacedAsset(asset)} />
                    </div>
                  </div>
                </div>
              );
            }
            // Pack left, height-driven sizing
            return (
              <div key={i} style={{height: '100%', flexShrink: 0, flexGrow: 0, flexBasis: 'auto'}}>
                <div style={{aspectRatio: `${renderAR}`, height: '100%'}}>
                  <ImagePlaceholder label={asset} assetType={getAssetType(asset)} fillContainer={true} placedAsset={getPlacedAsset(asset)} />
                </div>
              </div>
            );
          })}
        </div>
      );

      // Text columns — render numColumns columns. Fill missing sections with placeholders.
      const renderColumn = (section, idx) => (
        <div key={idx} className="flex-1 p-2 rounded border overflow-hidden" style={{borderColor: `${colors[1]}44`, backgroundColor: `${colors[0]}cc`}}>
          {section.header && <h3 className="font-bold mb-1 uppercase flex-shrink-0" style={{color: colors[1], fontSize: `${headerFontSize}px`}}>{section.header}</h3>}
          <div className="overflow-hidden">
            {section.items.map((item, i) => (
              <p key={i} className="leading-snug mb-1" style={{color: colors[3], fontSize: `${bodyFontSize}px`}}>{renderItem(item, colors, bodyFontSize)}</p>
            ))}
          </div>
        </div>
      );
      const renderPlaceholderColumn = (idx) => (
        <div key={`placeholder-${idx}`} className="flex-1 p-2 rounded border overflow-hidden" style={{borderColor: `${colors[1]}44`, backgroundColor: `${colors[0]}cc`}}>
          <p style={{color: colors[3], fontSize: `${bodyFontSize}px`}}>Click to add text</p>
        </div>
      );

      const textColumns = (
        <div className="flex gap-2 min-h-0" {...editableBodyProps({flex: `1 0 ${textMinPct}`})}>
          {Array.from({length: numColumns}, (_, idx) => {
            if (idx < copySections.length) {
              return renderColumn(copySections[idx], idx);
            }
            return renderPlaceholderColumn(idx);
          })}
        </div>
      );

      return (
        <div className="w-full h-full flex flex-col p-3 overflow-hidden" style={{backgroundColor: colors[0]}}>
          <div className="mb-2 flex-shrink-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold" {...editableProps('title', {color: colors[1]})}>{parsed.title || 'Click to add title'}</h2>
              {iconAssets.length > 0 && iconAssets.map((icon, i) => <IconLogoPlaceholder key={i} label={icon} assetIndex={assetIndexMap.get(icon)} />)}
            </div>
            <p className="text-xs" {...editableProps('subtitle', {color: colors[2], visibility: parsed.subtitle ? 'visible' : 'hidden'})}>{parsed.subtitle || '\u00A0'}</p>
          </div>
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {assetsRow}
            {assetCount > 0 && <div className="flex-shrink-0" style={{flex: '0 0 3%'}} />}
            {textColumns}
          </div>
        </div>
      );
    }

    // One column text - text left with title, visual assets on right half.
    // Right half: images span full page height (edge to edge). No padding on image side.
    // Fixed aspect ratios: 1 asset = 8:9, 2 assets = 16:9 stacked, 3 assets = 8:3 stacked. No gaps.
    // Timelines go on top as an exception (they need horizontal space).
    if (layoutKey === 'ONE_COLUMN') {
      const timelineAssets = visualAssets.filter(a => getAssetType(a) === 'timeline');
      const sideAssets = visualAssets.filter(a => getAssetType(a) !== 'timeline');

      const textBlock = (
        <div className="flex-1 p-2 rounded border overflow-hidden" {...editableBodyProps({borderColor: `${colors[1]}44`, backgroundColor: `${colors[0]}cc`})}>
          {copySections.length > 0 ? (
            copySections.map((section, idx) => (
              <div key={idx} className="mb-2">
                {section.header && <h3 className="font-bold mb-1 uppercase" style={{color: colors[1], fontSize: `${headerFontSize}px`}}>{section.header}</h3>}
                {section.items.map((item, i) => (
                  <p key={i} className="leading-snug mb-1" style={{color: colors[3], fontSize: `${bodyFontSize}px`}}>{renderItem(item, colors, bodyFontSize)}</p>
                ))}
              </div>
            ))
          ) : (
            <p style={{color: colors[3], fontSize: `${bodyFontSize}px`}}>{renderMarkdownText(parsed.copyContent) || 'Click to add text'}</p>
          )}
        </div>
      );

      // Right side asset block — fills entire right half from top edge to bottom edge, no gaps
      // Uses absolute positioning to ensure images fill their containers completely (no AR constraint)
      const rightAssetBlock = sideAssets.length > 0 && (
        <div className="flex flex-col overflow-hidden" style={{width: '50%', minWidth: '50%', height: '100%'}}>
          {sideAssets.slice(0, 3).map((asset, i) => (
            <div key={i} className="relative overflow-hidden" style={{flex: '1 1 0%', minHeight: 0}}>
              <div className="absolute inset-0 border-2 border-dashed flex flex-col items-center justify-center" style={{borderColor: assetColor, backgroundColor: `${colors[0]}66`}}>
                <svg className="w-8 h-8" style={{color: assetColor}} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeWidth="1.5"/>
                  <circle cx="8.5" cy="8.5" r="1.5" strokeWidth="1.5"/>
                  <path d="M21 15l-5-5L5 21" strokeWidth="1.5"/>
                </svg>
                <span className="mt-1 text-center px-1 truncate max-w-full" style={{color: assetColor, fontSize: '7px'}}>{asset}</span>
              </div>
            </div>
          ))}
        </div>
      );

      // Timeline bar goes above the text+image row (rare exception)
      const timelineBlock = timelineAssets.length > 0 && (
        <div className="flex-shrink-0 w-full mb-1 overflow-hidden" style={{maxHeight: '35%'}}>
          {timelineAssets.slice(0, 1).map((asset, i) => {
            const assetRatio = getAssetRatio(asset);
            const arVal = assetRatio.w / assetRatio.h;
            return (
              <div key={i} style={{aspectRatio: `${assetRatio.w}/${assetRatio.h}`, maxHeight: '100%', maxWidth: '100%', ...(arVal >= 1 ? {width: '100%'} : {height: '100%'})}}>
                <ImagePlaceholder label={asset} assetType={getAssetType(asset)} fillContainer={true} placedAsset={getPlacedAsset(asset)} />
              </div>
            );
          })}
        </div>
      );

      // Use a horizontal flex layout. Right assets span full height (no padding).
      // Left side has title + text with padding.
      return (
        <div className="w-full h-full flex overflow-hidden" style={{backgroundColor: colors[0]}}>
          <div className="flex flex-col overflow-hidden" style={{width: sideAssets.length > 0 ? '50%' : '100%'}}>
            <div className="mb-2 flex-shrink-0 px-3 pt-3">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold" {...editableProps('title', {color: colors[1]})}>{parsed.title || 'Click to add title'}</h2>
                {iconAssets.length > 0 && iconAssets.map((icon, i) => <IconLogoPlaceholder key={i} label={icon} assetIndex={assetIndexMap.get(icon)} />)}
              </div>
              {parsed.subtitle && <p className="text-sm" {...editableProps('subtitle', {color: colors[2]})}>{parsed.subtitle}</p>}
            </div>
            {timelineBlock}
            <div className="flex-1 flex flex-col px-3 pb-3 min-h-0">
              {textBlock}
            </div>
          </div>
          {rightAssetBlock}
        </div>
      );
    }
    
    // Main point - large title on left, subtitle below
    if (layoutKey === 'MAIN_POINT') {
      return (
        <div className="w-full h-full flex flex-col p-6 overflow-hidden relative" style={{backgroundColor: colors[0]}}>
          {iconAssets.length > 0 && (
            <div className="absolute top-3 right-4 flex gap-2">
              {iconAssets.map((icon, i) => <IconLogoPlaceholder key={i} label={icon} assetIndex={assetIndexMap.get(icon)} />)}
            </div>
          )}
          <div className="flex-1 flex items-center">
            <h2 className="text-2xl font-bold leading-tight max-w-md" {...editableProps('title', {color: colors[1]})}>{parsed.title || 'Click to add title'}</h2>
          </div>
          {parsed.subtitle && <p className="text-sm" {...editableProps('subtitle', {color: colors[2]})}>{parsed.subtitle}</p>}
        </div>
      );
    }
    
    // Section title and description
    // LEFT half: images fill entire half edge-to-edge. Title + subtitle overlaid, centered vertically.
    // RIGHT half: colored background with body text block centered with margin on all sides.
    // Fixed aspect ratios: 1 asset = 8:9, 2 assets = 16:9 stacked, 3 assets = 8:3 stacked. No gaps/padding.
    if (layoutKey === 'SECTION_TITLE_DESC') {
      const bgAssets = assets.filter(a => getAssetType(a) === 'image_background');
      const displayAssets = visualAssets.length > 0 ? visualAssets.slice(0, 3) : (bgAssets.length > 0 ? bgAssets.slice(0, 3) : []);
      const assetCount = displayAssets.length;

      // LEFT half: images filling entire left side + title/subtitle overlaid centered
      const leftHalf = (
        <div className="relative overflow-hidden" style={{width: '50%', height: '100%'}}>
          {/* Image layer — fills entire left half, stacked vertically, no gaps */}
          <div className="absolute inset-0 flex flex-col">
            {assetCount > 0 ? displayAssets.map((asset, i) => (
              <div key={i} className="relative overflow-hidden" style={{flex: '1 1 0%', minHeight: 0}}>
                <div className="absolute inset-0 border-2 border-dashed flex flex-col items-center justify-center" style={{borderColor: assetColor, backgroundColor: `${colors[0]}66`}}>
                  <svg className="w-8 h-8" style={{color: assetColor}} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeWidth="1.5"/>
                    <circle cx="8.5" cy="8.5" r="1.5" strokeWidth="1.5"/>
                    <path d="M21 15l-5-5L5 21" strokeWidth="1.5"/>
                  </svg>
                  <span className="mt-1 text-center px-1 truncate max-w-full" style={{color: assetColor, fontSize: '7px'}}>{asset}</span>
                </div>
              </div>
            )) : (
              <div className="absolute inset-0 border-2 border-dashed flex flex-col items-center justify-center" style={{borderColor: assetColor, backgroundColor: `${colors[0]}33`}}>
                <svg className="w-12 h-12" style={{color: assetColor}} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeWidth="1.5"/>
                  <circle cx="8.5" cy="8.5" r="1.5" strokeWidth="1.5"/>
                  <path d="M21 15l-5-5L5 21" strokeWidth="1.5"/>
                </svg>
                <span className="mt-1" style={{color: assetColor, fontSize: '8px'}}>Image</span>
              </div>
            )}
          </div>
          {/* Title/subtitle overlay — centered vertically on the left half */}
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 pointer-events-none" style={{zIndex: 1}}>
            <div className="text-center pointer-events-auto">
              <div className="flex items-center justify-center gap-2 mb-1">
                <h2 className="text-xl font-bold drop-shadow-md" {...editableProps('title', {color: colors[1]})}>{parsed.title || 'Click to add title'}</h2>
                {iconAssets.length > 0 && iconAssets.map((icon, i) => <IconLogoPlaceholder key={i} label={icon} assetIndex={assetIndexMap.get(icon)} />)}
              </div>
              {parsed.subtitle && <p className="text-sm drop-shadow-md" {...editableProps('subtitle', {color: colors[2]})}>{parsed.subtitle}</p>}
            </div>
          </div>
        </div>
      );

      // RIGHT half: colored background with body text block centered.
      // Text box has fixed 8:9 aspect ratio, dynamically sized 33%-85% of right side based on content.
      const totalTextChars = copySections.reduce((sum, s) => sum + s.items.reduce((iSum, item) => iSum + (typeof item === 'string' ? item.length : item.text?.length || 0), 0), 0) || (parsed.copyContent?.length || 0);
      // Map character count to a scale: ~0-80 chars → 33%, ~400+ chars → 85%
      const textScale = Math.min(85, Math.max(33, 33 + (totalTextChars / 400) * (85 - 33)));
      const rightHalf = (
        <div className="flex items-center justify-center" style={{width: '50%', height: '100%', backgroundColor: colors[0]}}>
          <div className="overflow-hidden flex flex-col justify-center" style={{width: `${textScale}%`, aspectRatio: '8 / 9', maxHeight: '85%'}} {...editableBodyProps()}>
            {copySections.length > 0 ? (
              copySections.map((section, idx) => (
                <div key={idx} className={idx > 0 ? 'mt-2' : ''}>
                  {section.items.map((item, i) => (
                    <p key={i} className="leading-snug mb-1" style={{color: colors[3], fontSize: `${bodyFontSize}px`}}>{renderItem(item, colors, bodyFontSize)}</p>
                  ))}
                </div>
              ))
            ) : (
              <p className="text-sm leading-relaxed" style={{color: colors[3]}}>{parsed.copyContent || 'Click to add text'}</p>
            )}
          </div>
        </div>
      );

      return (
        <div className="w-full h-full flex overflow-hidden" style={{backgroundColor: colors[0]}}>
          {leftHalf}{rightHalf}
        </div>
      );
    }
    
    // Caption - large image area (2/3 of page) with text in lower third
    if (layoutKey === 'CAPTION') {
      // Display visual asset frames - images take up most of the page
      const displayAssets = visualAssets.length > 0 ? visualAssets.slice(0, 3) : ['Image'];
      return (
        <div className="w-full h-full flex flex-col p-3 overflow-hidden" style={{backgroundColor: colors[0]}}>
          <div className="mb-1 flex-shrink-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold" {...editableProps('title', {color: colors[1]})}>{parsed.title || 'Click to add title'}</h2>
              {iconAssets.length > 0 && iconAssets.map((icon, i) => <IconLogoPlaceholder key={i} label={icon} assetIndex={assetIndexMap.get(icon)} />)}
            </div>
          </div>
          {/* Image area takes up ~85% of the page — captions have very little text */}
          <div className="flex gap-2 mb-1" style={{flex: '5 1 0', minHeight: '200px'}}>
            {displayAssets.map((asset, idx) => {
              const assetRatio = getAssetRatio(asset);
              const arVal = assetRatio.w / assetRatio.h;
              return (
                <div key={idx} className="flex-1 flex items-center justify-center overflow-hidden">
                  <div style={{aspectRatio: `${assetRatio.w}/${assetRatio.h}`, maxHeight: '100%', maxWidth: '100%', ...(arVal >= 1 ? {width: '100%'} : {height: '100%'})}}>
                    <ImagePlaceholder label={asset} assetType={getAssetType(asset)} fillContainer={true} placedAsset={getPlacedAsset(asset)} />
                  </div>
                </div>
              );
            })}
          </div>
          {/* Text content — minimal caption area */}
          <div style={{flex: '1 1 0', minHeight: '40px', maxHeight: '20%'}} className="overflow-hidden">
            {parsed.subtitle && <p className="text-xs mb-1" {...editableProps('subtitle', {color: colors[2]})}>{parsed.subtitle}</p>}
            <div {...editableBodyProps()}>
            {copySections.length > 0 ? (
              copySections.slice(0, 1).map((section, idx) => (
                <div key={idx}>
                  {section.items.slice(0, 2).map((item, i) => (
                    <p key={i} className="leading-snug mb-0.5" style={{color: colors[3], fontSize: `${bodyFontSize}px`}}>{renderItem(item, colors, bodyFontSize)}</p>
                  ))}
                </div>
              ))
            ) : (
              <p className="text-xs leading-snug" style={{color: colors[3]}}>{parsed.copyContent.substring(0, 100) || 'Caption text'}</p>
            )}
            </div>
          </div>
        </div>
      );
    }
    
    // Big number - large statistic display
    // The title IS the big number (e.g., "$1M", "40%", "10K+")
    // The subtitle provides context beneath it
    if (layoutKey === 'BIG_NUMBER') {
      const bgAssets = assets.filter(a => getAssetType(a) === 'image_background');
      return (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 relative overflow-hidden" style={{backgroundColor: colors[0]}}>
          {bgAssets.length > 0 && (
            <div className="absolute inset-0 border-2 border-dashed rounded flex items-center justify-center" style={{borderColor: `${assetColor}44`, backgroundColor: `${colors[0]}22`}}>
              <span style={{color: assetColor, fontSize: '9px', opacity: 0.6}}>{getAssetLabel(bgAssets[0])}</span>
            </div>
          )}
          {iconAssets.length > 0 && (
            <div className="absolute top-3 left-4 flex gap-2 z-10">
              {iconAssets.map((icon, i) => <IconLogoPlaceholder key={i} label={icon} assetIndex={assetIndexMap.get(icon)} />)}
            </div>
          )}
          <div className="text-6xl font-bold mb-4 relative z-10" {...editableProps('title', {color: colors[1]})}>{parsed.title || '—'}</div>
          {parsed.subtitle && <p className="text-base text-center max-w-md relative z-10" {...editableProps('subtitle', {color: colors[2]})}>{parsed.subtitle}</p>}
        </div>
      );
    }
    
    // Blank - empty slide
    if (layoutKey === 'BLANK') {
      return (
        <div className="w-full h-full p-4 flex items-center justify-center" style={{backgroundColor: colors[0]}}>
          <span className="text-sm" style={{color: colors[2]}}>Blank slide</span>
        </div>
      );
    }
    
    // Default: Title and body - dynamic asset placement based on layout hints
    // Check if any visual asset is a timeline or ultra-wide - force to top/full-width
    const hasTimelineOrUltraWide = visualAssets.some(a => {
      const type = getAssetType(a);
      const r = getAssetRatio(a);
      return type === 'timeline' || (r.w / r.h) >= 2.5;
    });

    // Placement priority: timelines/ultra-wide always top. Explicit hints next. Default = right side.
    const imgTop = hasTimelineOrUltraWide || (layoutHints.imageTop && !layoutHints.imageRight && !layoutHints.imageLeft) || layoutHints.imageSpansFullWidth;
    const imgBottom = !imgTop && layoutHints.imageBottom;
    const imgLeft = !imgTop && !imgBottom && layoutHints.imageLeft;
    const imgRight = !imgTop && !imgBottom && !imgLeft;
    const sidePlacement = imgRight || imgLeft;

    const bodyTextBlock = (
      <div className="flex-1 p-2 rounded border overflow-hidden" {...editableBodyProps({borderColor: `${colors[1]}44`, backgroundColor: `${colors[0]}cc`})}>
        {copySections.length > 0 ? (
          copySections.map((section, idx) => (
            <div key={idx} className="mb-2">
              {section.header && <h3 className="font-bold mb-1 uppercase" style={{color: colors[1], fontSize: `${headerFontSize}px`}}>{section.header}</h3>}
              {section.items.map((item, i) => (
                <p key={i} className="leading-snug mb-1" style={{color: colors[3], fontSize: `${bodyFontSize}px`}}>{renderItem(item, colors, bodyFontSize)}</p>
              ))}
            </div>
          ))
        ) : (
          <p style={{color: colors[3], fontSize: `${bodyFontSize}px`}}>{renderMarkdownText(parsed.copyContent) || 'Click to add text'}</p>
        )}
      </div>
    );

    const sideAssetBlock = visualAssets.length > 0 && sidePlacement && (
      <div className="flex flex-col gap-1 min-h-0 overflow-hidden" style={{width: '42%', maxWidth: '340px', minWidth: '120px'}}>
        {visualAssets.slice(0, 2).map((asset, i) => (
          <div key={i} className="min-h-0 overflow-hidden flex items-center" style={{flex: '1 1 0'}}>
            <ImagePlaceholder label={asset} assetType={getAssetType(asset)} className="w-full" placedAsset={getPlacedAsset(asset)} />
          </div>
        ))}
      </div>
    );

    const topBottomAssetBlock = visualAssets.length > 0 && (imgTop || imgBottom) && (
      <div className="flex-shrink-0 w-full" style={{maxHeight: visualAssets.length > 1 ? '50%' : '35%'}}>
        <div className="flex flex-col gap-1 w-full">
          {visualAssets.slice(0, 2).map((asset, i) => (
            <div key={i} className="w-full">
              <ImagePlaceholder label={asset} assetType={getAssetType(asset)} className="w-full" placedAsset={getPlacedAsset(asset)} />
            </div>
          ))}
        </div>
      </div>
    );

    return (
      <div className="w-full h-full flex flex-col p-3 overflow-hidden" style={{backgroundColor: colors[0]}}>
        <div className="mb-1 flex-shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold" {...editableProps('title', {color: colors[1]})}>{parsed.title || 'Click to add title'}</h2>
            {iconAssets.length > 0 && iconAssets.map((icon, i) => <IconLogoPlaceholder key={i} label={icon} assetIndex={assetIndexMap.get(icon)} />)}
          </div>
          {parsed.subtitle && <p className="text-xs" {...editableProps('subtitle', {color: colors[2]})}>{parsed.subtitle}</p>}
        </div>
        {imgTop && topBottomAssetBlock && <div className="mb-1 flex-shrink-0">{topBottomAssetBlock}</div>}
        <div className="flex-1 flex gap-3 min-h-0 overflow-hidden">
          {imgLeft && sideAssetBlock}
          {bodyTextBlock}
          {imgRight && sideAssetBlock}
        </div>
        {imgBottom && topBottomAssetBlock && <div className="mt-1 flex-shrink-0">{topBottomAssetBlock}</div>}
      </div>
    );
  };

  // Compact mode - just the slide preview (no wrapper, colors, or info)
  if (compact) {
    return (
      <div
        className="overflow-hidden"
        style={{ width: '672px', height: '378px' }}
      >
        {renderLayout()}
      </div>
    );
  }

  // Counter-scale to undo Electron page zoom so the preview stays a fixed visual size
  const counterScale = zoomLevel !== 0 ? 1 / Math.pow(1.2, zoomLevel) : 1;
  const baseW = 1141;  // 16:9 slide frame (1037 * 1.10)
  const baseH = 641;   // 16:9 slide frame (583 * 1.10)
  // Wrapper dimensions shrink/grow to match the counter-scaled visual size
  const wrapperW = Math.round(baseW * counterScale);
  const wrapperH = Math.round(baseH * counterScale);

  return (
    <div className="flex flex-col bg-stone-950 px-4 py-4">
      {/* Color Palette with Theme Cycling */}
      <div className="flex items-center gap-3 mb-3 flex-shrink-0">
        <span className="text-xs text-orange-400 uppercase tracking-wide font-bold whitespace-nowrap">Suggested Theme Colors:</span>
        <div className="flex gap-2 items-center flex-wrap">
          {/* Left/Right cycle arrows */}
          {onCycleTheme && themeCount > 1 && (
            <button
              onClick={() => onCycleTheme(-1)}
              className="w-7 h-7 flex items-center justify-center rounded border border-stone-600 bg-stone-800 hover:bg-stone-700 text-stone-400 hover:text-orange-400 transition-colors"
              title="Previous theme"
            >
              <ChevronRight className="w-3.5 h-3.5 rotate-180" />
            </button>
          )}
          {onCycleTheme && themeCount > 1 && (
            <button
              onClick={() => onCycleTheme(1)}
              className="w-7 h-7 flex items-center justify-center rounded border border-stone-600 bg-stone-800 hover:bg-stone-700 text-stone-400 hover:text-orange-400 transition-colors"
              title="Next theme"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
          {/* Color swatches */}
          {colors.map((color, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <div
                className="w-9 h-9 rounded border border-stone-600"
                style={{ backgroundColor: color }}
                title={color}
              />
              <span className="text-[8px] font-mono text-orange-400">{color}</span>
            </div>
          ))}
          {/* Generate new button */}
          {onRefreshColors && (
            <button
              onClick={onRefreshColors}
              disabled={isGeneratingTheme}
              className="w-8 h-8 flex items-center justify-center rounded border border-stone-600 bg-stone-800 hover:bg-stone-700 transition-colors ml-1"
              title="Generate new theme colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingTheme ? 'animate-spin text-orange-400' : 'text-stone-400 hover:text-orange-400'}`} />
            </button>
          )}
          {/* Theme name + index — always visible */}
          <span className="text-[10px] text-orange-400 ml-1 whitespace-nowrap font-medium">
            {themeName || 'Theme'} <span className="text-stone-500">({themeIndex + 1}/{themeCount})</span>
          </span>
        </div>
      </div>

      {/* Main Content: Preview + Info — side-by-side, equal height */}
      <div className="flex gap-4 py-2" style={{ transition: 'height 0.15s ease-out' }}>
        {/* Slide Preview - 16:9 — counter-scale wrapper tracks visual size */}
        <div className="flex-shrink-0" style={{ width: `${wrapperW}px`, height: `${wrapperH}px`, transition: 'width 0.15s ease-out, height 0.15s ease-out' }}>
          <div
            className="bg-stone-900 border-2 border-stone-700 rounded overflow-hidden"
            style={{
              width: `${baseW}px`,
              height: `${baseH}px`,
              transform: counterScale !== 1 ? `scale(${counterScale})` : undefined,
              transformOrigin: 'top left',
              transition: 'transform 0.15s ease-out',
            }}
          >
            {renderLayout()}
          </div>
        </div>

        {/* Info Panel - Right Side — fixed width, same height as preview */}
        <div className="flex flex-col gap-2 flex-shrink-0" style={{ width: '280px', height: `${wrapperH}px`, transition: 'height 0.15s ease-out' }}>
          {/* Layout Type + Page Number */}
          <div className="bg-stone-900 border border-stone-700 rounded p-3 flex-shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-[10px] text-stone-500 uppercase tracking-wide font-bold mb-1">Layout</span>
                <span className="text-sm text-orange-400 font-bold leading-tight">{parsed.layoutType || 'Standard'}</span>
              </div>
              {parsed.pageNum && (
                <div className="flex flex-col items-end">
                  <span className="text-[10px] text-stone-500 uppercase tracking-wide font-bold mb-1">Page</span>
                  <span className="text-sm text-orange-400 font-bold leading-tight">#{parsed.pageNum}</span>
                </div>
              )}
            </div>
          </div>

          {/* Assets - Consolidated Block */}
          <div className="bg-stone-900 border border-stone-700 rounded p-3 flex-1 overflow-y-auto min-h-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-stone-500 uppercase tracking-wide font-bold">Assets</span>
              <span className="text-xs text-orange-400 font-bold">{assets.length}</span>
            </div>
            {assets.length > 0 ? (
              <div className="space-y-2">
                {(() => {
                  // Sort: images/videos/backgrounds first, infographs/timelines next, icons/logos last
                  const sortPriority = (type) => {
                    if (['image', 'video', 'image_background'].includes(type)) return 0;
                    if (['infograph', 'timeline'].includes(type)) return 1;
                    if (type === 'icon_logo') return 2;
                    return 3;
                  };
                  const sortedAssets = [...assets].sort((a, b) => {
                    return sortPriority(getAssetType(a)) - sortPriority(getAssetType(b));
                  });
                  return sortedAssets.map((asset, i) => {
                    const assetNum = assetIndexMap.get(asset) || (i + 1);
                    const type = getAssetType(asset);
                    const typeLabel = getAssetTypeLabel(type);
                    const cleanLabel = getAssetLabel(asset);
                    const ratio = getRatioLabel(asset);
                    const isHighlight = ['image', 'video', 'timeline', 'infograph', 'image_background'].includes(type);
                    return (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-[10px] font-mono font-bold mt-0.5 flex-shrink-0 w-4 text-right" style={{color: isHighlight ? '#fb923c' : '#78716c'}}>{assetNum}</span>
                        {type === 'image' || type === 'image_background' ? (
                          <Image className="w-3.5 h-3.5 text-orange-400 mt-0.5 flex-shrink-0" />
                        ) : type === 'video' ? (
                          <Eye className="w-3.5 h-3.5 text-orange-400 mt-0.5 flex-shrink-0" />
                        ) : type === 'infograph' ? (
                          <Layers className="w-3.5 h-3.5 text-orange-400 mt-0.5 flex-shrink-0" />
                        ) : type === 'timeline' ? (
                          <Layers className="w-3.5 h-3.5 text-orange-400 mt-0.5 flex-shrink-0" />
                        ) : type === 'icon_logo' ? (
                          <Sparkles className="w-3.5 h-3.5 text-stone-500 mt-0.5 flex-shrink-0" />
                        ) : (
                          <FileText className="w-3.5 h-3.5 text-stone-500 mt-0.5 flex-shrink-0" />
                        )}
                        <div className="flex flex-col">
                          <span className={`text-xs leading-tight ${isHighlight ? 'text-stone-300' : 'text-stone-500'}`}>
                            <span className={`font-bold ${isHighlight ? 'text-orange-400' : 'text-stone-500'}`}>{typeLabel}</span>
                            {ratio && <span className="text-[9px] font-mono text-stone-500 ml-1.5">{ratio}</span>}
                          </span>
                          {cleanLabel && <span className="text-[10px] text-stone-500 leading-snug mt-0.5">{cleanLabel}</span>}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            ) : (
              <span className="text-xs text-stone-600 italic">No assets specified</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Duplicate Page Resolver Modal

export default LayoutVisualizer;
