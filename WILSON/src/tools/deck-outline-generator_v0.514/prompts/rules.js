export const ASSET_RULES = `
ASSET TYPE RULES — Every asset in REQUIRED ASSETS must be prefixed with its type AND aspect ratio in brackets:
• [Image | RATIO] - stills, drawings, concept art, photos
• [Video | RATIO] - video content (demo reels, walkthroughs, clips)
• [Icon/Logo] - logos, tool icons, company badges (no ratio needed)
• [Infograph | RATIO] - charts, tables, graphs, data visualizations
• [Timeline | RATIO] - timelines, process flows, roadmaps
• [Image Background] - full-bleed backgrounds behind gradients/overlays (no ratio needed)
FORMAT: "• [Type | RATIO] - description". [Icon/Logo] and [Image Background] need no ratio. NEVER invent new type prefixes. For "w/Gradient" layouts, use [Image Background] NOT [Image].

ASPECT RATIO GUIDE:
  Ultra-wide: 21:9 or 32:9 — landscapes, panoramic shots, cinematic establishing shots
  Standard wide: 16:9 — general scenes, product shots, team photos, demo videos
  Moderate: 3:2 — editorial photos, lifestyle, product photography
  Classic: 4:3 — data-heavy infographs, tables, detailed diagrams
  Portrait: 2:3, 3:4, 9:16 — headshots, portraits, mobile screenshots
  Square: 1:1 — profile photos, icons in frame
  Banner: 4:1 or 5:1 — timelines, horizontal process flows

ICON/LOGO — Use SPARINGLY. Only include when essential (client logos, product logos). Most slides need 0-1 icons. Never add generic icons like "graph icon" — use [Image] or [Infograph] instead.

DATA VIZ LIMIT — Max ONE [Timeline] OR ONE [Infograph] per slide, never both. Split across slides if needed.

LAYOUT STRUCTURE AS DESIGN — The ▸ LAYOUT STRUCTURE section must describe EXACTLY how text and visual assets are arranged on the page.
Consider: asset positions relative to text, visual hierarchy, vertical space allocation, and how the number of assets affects composition.

═══ PER-LAYOUT PLACEMENT RULES ═══

TITLE SLIDE / TITLE PAGE w/GRADIENT / SECTION HEADER / SECTION HEADER w/GRADIENT:
  - Title-only layouts: COPY/TEXT CONTENT = "N/A - title slide"
  - Optional [Icon/Logo] "large and centered" above title for brand presence
  - Optional [Image Background] for gradient layouts
  - No frame assets (images/videos/infographs) in these layouts

TITLE AND BODY (TEXT-ONLY):
  - NO images, videos, or infographs beside or to the right of body text
  - No right column or side panel exists in this layout
  - ONLY acceptable visual: a wide image (21:9 or 16:9) ABOVE body text spanning full width
  - If content needs text + side image → use "One column text" instead
  - Best for: text-heavy content with no visual assets, or text with a single wide banner above

TITLE AND TWO COLUMNS:
  - NEVER stack images vertically
  - Images arranged HORIZONTALLY only: (a) one image above each column side by side, or (b) single wide image spanning full width above both columns
  - SINGLE WIDE IMAGE MAX RATIO: 2.75:1 (≈21.5:9). Do NOT use ratios wider than 2.75:1 (no 32:9, 3:1, etc.) for a single image above columns. If content calls for something wider, use TWO images (one per column) instead.
  - Use 21:9 (2.33:1) or 2.75:1 for single wide banner above columns. Use 3:2, 4:3, or 16:9 for per-column images — never portrait ratios.
  - PREFER TWO PER-COLUMN IMAGES over a single wide image. Two images fill the page better and reduce negative space. Only use a single wide image if content specifically requires a banner/panoramic shot.
  - NEGATIVE SPACE CHECK: A single 16:9 image above two columns uses only ~37% of the content height. Use 21:9 for a better-proportioned banner, or add two images (one per column). 16:9 is acceptable ONLY if paired as two per-column images.
  - When placing 2 images side by side: each gets ~half the content width minus gutter
  - HEIGHT THRESHOLDS: 1-2 images above columns: 50-57% of content height. 3 images: 37-51%. 4 images: 30-51%. The visualizer auto-scales image height within these ranges based on aspect ratios.
  - MINIMUM TEXT SPACE: At least 40% of the content area must be reserved for text columns (1-2 images). For 3-4 images, at least 46% for text.
  - ALL frames must fit within canvas bounds (720×405)

TITLE AND THREE COLUMNS:
  - Same rules as TWO COLUMNS: images ABOVE columns, NEVER inside them, NEVER stacked vertically
  - When 3 images: one centered above each of the 3 columns. Use 3:2, 4:3, or 16:9 ratios.
  - When 1-2 images: center above columns. When 4 images: pack left.
  - SINGLE WIDE IMAGE: same ratio constraints as TWO COLUMNS (21:9 to 2.75:1)
  - HEIGHT THRESHOLDS: same as TWO COLUMNS. MINIMUM TEXT SPACE: same as TWO COLUMNS.
  - COPY FORMAT: Use --- separator for 3 sections (one per column)

TITLE AND FOUR COLUMNS:
  - Same rules as TWO COLUMNS: images ABOVE columns, NEVER inside them, NEVER stacked vertically
  - When 4 images: one centered above each of the 4 columns. Use 3:2, 4:3, or 16:9 ratios.
  - When 1-2 images: center above columns. When 3 images: pack left.
  - SINGLE WIDE IMAGE: same ratio constraints as TWO COLUMNS (21:9 to 2.75:1)
  - HEIGHT THRESHOLDS: same as TWO COLUMNS. MINIMUM TEXT SPACE: same as TWO COLUMNS.
  - COPY FORMAT: Use --- separator for 4 sections (one per column)

ONE COLUMN TEXT:
  - Text left (~55%), visual assets RIGHT (~45%). Never place images above/below text.
  - Visual assets MUST stay on the RIGHT side only and MUST NOT extend past the page halfway point to the left.
  - Prefer PORTRAIT ratios (2:3, 3:4, 9:16) — they fill the tall right panel naturally
  - A single 16:9 image wastes ~50% of the right panel height → stack TWO 16:9 images vertically, or use a portrait ratio instead
  - EXTRA-WIDE images (21:9+) must NEVER go on the right panel — use "Caption" layout instead
  - Multiple images stack vertically with 15pt gutters. Max 3 images on right side.
  - HEIGHT LIMITS: 1 image max 70% of panel height. 2 images max 45% each. 3 images max 30% each.
  - NEGATIVE SPACE CHECK: Calculate total image height vs available panel height. If single image fills <60% of panel, add another image or switch to portrait ratio. If there's significant empty space, ADD MORE VISUAL ASSETS (up to 3).
  - Exception: [Timeline] assets go full-width ABOVE the text+image row (they need horizontal space)

CAPTION:
  - Image-DOMINANT layout: visual assets fill upper ~80-85%, text caption in lower ~15-20%
  - This layout is for showcasing images with MINIMAL text. The image area should be as large as possible.
  - Best for: extra-wide images (up to 21:9), hero shots, key visuals, timelines, infographics
  - Single assets can use any ratio up to 21:9. Very little text space is needed — just a brief caption.
  - Keep COPY/TEXT CONTENT minimal (1-3 bullets max, or a short sentence)
  - Multiple images arrange horizontally in the upper area
  - HEIGHT LIMIT: Image area gets ~85% of page. Caption text gets ~15%.
  - EVERY image frame must fit fully within the upper zone — no bleeding past boundaries

BIG NUMBER:
  - TITLE = the number/stat (e.g., "$1M", "40%"). SUBTITLE = description/context. COPY/TEXT CONTENT = "N/A - title slide"
  - The description text goes in SUBTITLE (not body copy) — same pattern as title pages
  - In COMPONENT GEOMETRY: use text_title for the number and text_subtitle for the description. Do NOT use text_body.
  - Optional [Image Background] for atmosphere

SECTION TITLE AND DESCRIPTION:
  - Split layout: image(s) fill the LEFT half entirely, title/subtitle/body text on the RIGHT half
  - Images ALWAYS on LEFT side (x=0, width=360). Text ALWAYS on RIGHT side (x=378, width=306)
  - Visual assets MUST stay on the LEFT half (50% of page width) — no gaps or padding around images
  - FIXED ASPECT RATIOS (mandatory): 1 asset = 8:9 (fills entire left half), 2 assets = 16:9 each (stacked top/bottom), 3 assets = 8:3 each (stacked in thirds). No other ratios allowed.
  - Assets stack vertically with NO spacing between them, each filling the full width of the left half
  - Best for: visual storytelling with accompanying narrative

MAIN POINT:
  - Large title centered/left-aligned with subtitle. Minimal layout, no body text frames.

BLANK:
  - Empty slide. No asset frames needed.

═══ CROSS-LAYOUT RULES ═══

HEIGHT LIMITS PER LAYOUT (VISUALIZER CONSTRAINTS):
  - Title and Two Columns: 1-2 images 50-57% of content height; 3 images 37-51%; 4 images 30-51%. Visualizer auto-scales within these ranges.
  - Title and Three Columns: Same height thresholds as Two Columns. 3 images align above their columns.
  - Title and Four Columns: Same height thresholds as Two Columns. 4 images align above their columns.
  - One Column Text: assets fill right half (50% width). FIXED RATIOS: 1 asset = 8:9, 2 assets = 16:9 stacked, 3 assets = 8:3 stacked. No gaps between images.
  - Caption: image area ~85% of page height, text area ~15%
  - Section Title and Description: images fill the LEFT half (x=0, width=360), text on RIGHT half (x=378). FIXED RATIOS: 1 asset = 8:9, 2 assets = 16:9 stacked, 3 assets = 8:3 stacked. No gaps between images.
  - Title and Body: wide image above text max 40% of content height (text-only layout, this is the exception where negative space in the text area is expected)

NEGATIVE SPACE PREVENTION — After choosing a layout and assets, mentally calculate how much of the available frame area the image(s) actually fill. If any image fills <50% of its container zone:
  1. ADD MORE VISUAL ASSETS to fill the gap (up to the layout's max: 3 for one-column, 2 for two-columns)
  2. Switch to a ratio that better fits the container (e.g., 16:9 → 2:3 for side panels)
  3. Switch to a layout that matches the image shape (e.g., wide image → "Caption" instead of side panel)
  IMPORTANT: When a single visual asset leaves significant empty space, the PREFERRED solution is to add additional visual assets rather than leaving the space empty.

BOUNDARY ENFORCEMENT — ALL visual asset frames must fit ENTIRELY within the canvas (720×405) respecting margins (36pt left/right, 30pt top, 35pt bottom). No frame may have: x < 36, y < 30, x+width > 684, or y+height > 370. Verify every frame's bounds before finalizing.

GRADIENT RULE — For "w/Gradient" layouts, a dark gradient radiates from bottom-left, fading before upper third. In VISUAL STYLING, describe mood/atmosphere only (no colors).

WIDE IMAGE RULE — Extra-wide images (21:9+) must NOT go in "Title and body" or side panels. Use "Caption" or full-width top placement.

COMPANY LOGO — Only on title/opener/closer pages, LARGE AND CENTERED. Not on content pages.
ICON CONSISTENCY — If using [Icon/Logo] badges on content page titles, apply to ALL content pages or none.
OUTRO PAGE — Every full deck ends with a clean closing page. Minimal text. Contact info only if provided in source docs.
VISUAL STYLING — NO COLORS — Describe only mood, texture, atmosphere, typography. Colors handled by deck theme system.
VISUAL DESIGN OPTIONS — Optional: (1) Large centered logo on title/outro, (2) Icon badges on all content pages, (3) [Image Background] on gradient layouts. Use intentionally, not by default.`;

export const COMPONENT_GEOMETRY_RULES = `
COMPONENT GEOMETRY — Every slide MUST include a ▸ COMPONENT GEOMETRY JSON code block after ▸ REQUIRED ASSETS.
This data drives a Google Slides automation extension that draws placeholder frames on the actual slides.

CANVAS: 720pt × 405pt. MARGINS: 36pt left/right, 30pt top, 35pt bottom. GUTTERS: 15pt between elements.
SAFE AREA: x ∈ [36, 684], y ∈ [30, 370]. Content width = 648pt. Content height = 340pt.
COORDINATE SYSTEM: Origin (0,0) = top-left. All values integers (pt).
TEXT FRAMES are built into templates — do NOT include them. Only output visual asset frames.

FRAME TYPES:
  "image_placeholder" — requires "aspect_ratio"
  "video_placeholder" — requires "aspect_ratio"
  "infograph_placeholder" — requires "aspect_ratio"
  "timeline_placeholder" — requires "aspect_ratio"
  "icon_placeholder" — small badge, no ratio
  "background_image" — always x:0, y:0, width:720, height:405

EVERY frame: "type", "description", "x", "y", "width", "height". Plus "aspect_ratio" for image/video/infograph/timeline.
HEIGHT FORMULA: height = width × (ratioH / ratioW). Example: 16:9 at width 648 → height = 648 × 9/16 = 365.
If a slide has NO visual assets, output empty frames array.

═══ PER-LAYOUT GEOMETRY RECIPES ═══
Use these pre-calculated coordinates. Title/subtitle text occupies y:[30–90]. Body text starts at y:95.

TITLE AND TWO COLUMNS — Title area y:[30–75]. Subtitle y:[80-100]. Images start at y:110. Text columns below images.
  Single wide image above columns:
    width=648, height=width×(ratioH/ratioW), x=36, y=110. Columns start at y=110+height+10.
    CHECK: y+height must be ≤ 250 (leave room for columns). If 16:9→height=365 is TOO TALL. Use 21:9→height=278.
    RULE: Single wide image max ratio is 2.75:1 (height ≥ 236). Do NOT go wider than 2.75:1. If content needs a wider visual, use TWO per-column images instead.
    RULE: Min ratio for single wide image is 21:9 (2.33:1). 16:9 is too tall for single wide above columns.
  Two images side by side (one per column):
    Each: width=316, x1=36, x2=36+316+15=367, y=110, height=max 145 (cap images to leave room for text).
    Good ratios: 16:9→height=145 (capped), 3:2→height=145 (capped), 4:3→height=145 (capped).
    Images bottom at y=255. Text columns start at y=265.
    Text body: x1=36, x2=367, y=265, width=316, height=105 (bottom at y=370, safe area limit).
    RULE: Image height MUST NOT exceed 145pt when columns have substantial text (bold headers + 4-5 bullets).
  No images: empty frames array.

TITLE AND THREE COLUMNS — Title area y:[30–75]. Subtitle y:[80-100]. Images start at y:110.
  Each column width = (648 - 2×15) / 3 = 206pt. Positions: x1=36, x2=257, x3=478.
  Three images aligned above columns (one per column):
    Each: width=206, x1=36, x2=257, x3=478, y=110, height=max 145 (cap for text room).
    Good ratios: 3:2→height=137, 16:9→height=116, 4:3→height=145 (capped).
    Text columns start at y=110+height+10. Text body height=105 (bottom at y=370).
  Single wide image above columns:
    width=648, height=width×(ratioH/ratioW), x=36, y=110. Same rules as TWO COLUMNS.
    RULE: Single wide image ratio between 21:9 (2.33:1) and 2.75:1.
  Two images side by side:
    Each: width=316, x1=36, x2=367, y=110, height=max 145. Same as TWO COLUMNS.
  No images: empty frames array.

TITLE AND FOUR COLUMNS — Title area y:[30–75]. Subtitle y:[80-100]. Images start at y:110.
  Each column width = (648 - 3×15) / 4 = 151pt. Positions: x1=36, x2=202, x3=368, x4=534.
  Four images aligned above columns (one per column):
    Each: width=151, x1=36, x2=202, x3=368, x4=534, y=110, height=max 145 (cap for text room).
    Good ratios: 3:2→height=101, 16:9→height=85, 4:3→height=113.
    Text columns start at y=110+height+10. Text body height=105 (bottom at y=370).
  Single wide image above columns:
    width=648, height=width×(ratioH/ratioW), x=36, y=110. Same rules as TWO COLUMNS.
    RULE: Single wide image ratio between 21:9 (2.33:1) and 2.75:1.
  Two images side by side:
    Each: width=316, x1=36, x2=367, y=110, height=max 145. Same as TWO COLUMNS.
  No images: empty frames array.

ONE COLUMN TEXT — Title area at top with padding. Images fill RIGHT HALF (50% width, x=360 to x=720).
  FIXED ASPECT RATIOS based on asset count (images fill entire right half, no gaps):
  1 asset: x=360, y=0, width=360, height=405 (8:9 ratio). Fills entire right half.
  2 assets: each 360×202 (16:9 ratio). Top: x=360, y=0, height=202. Bottom: x=360, y=203, height=202.
  3 assets: each 360×135 (8:3 ratio). Top: x=360, y=0, height=135. Middle: x=360, y=135, height=135. Bottom: x=360, y=270, height=135.
  No gaps between stacked images. All images span full width of right half (width=360).
  Text area: left half with padding. x=36, y=80, width=288, height=290.
  Timeline exception: full width at top — x=36, y=80, width=648. Content shifts below.

CAPTION — Image-dominant layout. Title at y:30. Image zone: y=45 to y=305 (height=260). Text zone below image: y=310 to y=370.
  Single image: x=36, y=45, width=648, height=min(260, 648×ratioH/ratioW).
    16:9→height=365→clamp to 260. Frame: x=36, y=45, width=648, height=260.
    21:9→height=278→clamp to 260. Frame: x=36, y=45, width=648, height=260.
  Multiple images side by side: split width. 2 images: each width=316, gap=15.
  RULE: Image height clamped to 260pt max. Caption text gets MINIMAL space (~60pt). Image should dominate the page.
  RULE: Single assets can use any ratio up to 21:9. This layout is for showcasing visuals with very little text.
  TEXT FRAME STACKING (CRITICAL — no overlaps):
    text_title.y = image.y + image.height + 4 (4pt gap below image)
    text_title.height = 28 (single line title)
    text_body.y = text_title.y + text_title.height + 2 (2pt gap below title)
    text_body.height = 370 - text_body.y (fill remaining space down to safe area bottom)
    RULE: text_title and text_body must NEVER overlap vertically. Verify text_body.y > text_title.y + text_title.height.
    RULE: If image is too tall to fit both title and body below it, reduce image height. Minimum 60pt combined for title + body.
  Example with 21:9 image: image y=45, h=260 → title y=309, h=28 → body y=339, h=31.

TITLE AND BODY — Usually empty frames. Wide image/timeline above body:
  x=36, y=80, width=648, height=min(150, 648×ratioH/ratioW). Body text starts below at y=80+height+15.
  Only 21:9 or wider ratios work here (16:9→height=365 far too tall, even clamped to 150 it crowds body text).
  TIMELINE EXCEPTION: A 5:1 timeline at y=110, height=130 leaves body at y=255, height=115. With only ~115pt for body text, limit copy to ≤8 lines (max 2 sections, 3-4 bullets each).

SECTION TITLE AND DESCRIPTION — Images on LEFT half, text on RIGHT half. Images fill the LEFT half with NO padding.
  IMAGES: Always LEFT side (x=0, width=360). Text/title/subtitle: Always RIGHT side (x=378, width=306).
  FIXED ASPECT RATIOS based on asset count (all images at x=0, width=360):
  1 asset: x=0, y=0, width=360, height=405 (8:9 ratio).
  2 assets: each 360×202 (16:9 ratio). Top: x=0, y=0, height=202. Bottom: x=0, y=203, height=202.
  3 assets: each 360×135 (8:3 ratio). Top: x=0, y=0, height=135. Middle: x=0, y=135, height=135. Bottom: x=0, y=270, height=135.
  No gaps between stacked images. All images span full width of the LEFT half (width=360).
  Text frames: text_title x=378, y=30, width=306. text_subtitle x=378, y=85, width=306. text_body x=378, y=120, width=306, height=250.

TITLE SLIDE / TITLE PAGE w/GRADIENT / SECTION HEADER / SECTION HEADER w/GRADIENT:
  Large centered logo: x=310, y=100, width=100, height=100 (icon_placeholder).
  Background image: x=0, y=0, width=720, height=405 (background_image).
  Usually empty frames for these layouts.

BIG NUMBER / MAIN POINT / TITLE ONLY / BLANK:
  Usually empty frames. BIG NUMBER may have background_image (x:0, y:0, 720×405).
  BIG NUMBER geometry: text_title (the number) centered, text_subtitle (the description) below. Do NOT use text_body — use text_subtitle.
    text_title: x=36, y=120, width=648, height=80 (large centered number).
    text_subtitle: x=120, y=220, width=480, height=60 (description centered below number).
  MAIN POINT geometry: text_title centered, text_subtitle below (same as big number). No text_body.

═══ BOUNDARY VALIDATION ═══
Before outputting, verify EVERY frame: x ≥ 0, y ≥ 0, x+width ≤ 720, y+height ≤ 405.
For non-background frames: x ≥ 36, y ≥ 30, x+width ≤ 684, y+height ≤ 370.
If any frame violates bounds, recalculate by clamping height and adjusting width to preserve aspect ratio.

FORMAT:
▸ COMPONENT GEOMETRY:
\`\`\`json
{
  "canvas": { "width": 720, "height": 405 },
  "frames": [ ... ]
}
\`\`\`
`;
