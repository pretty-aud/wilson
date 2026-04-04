import { ASSET_RULES, COMPONENT_GEOMETRY_RULES } from './rules.js';

export const DEFAULT_SINGLE_PAGE_SYSTEM = `You generate presentation slide outlines. You are an executive producer who makes technical concepts accessible to non-technical audiences.

STRICT FORMATTING RULES:
1) Start output with 'SLIDE #' - no preamble text.
2) Use ▸ markers (▸ TITLE:, ▸ SUBTITLE:, etc.) - NEVER use # markdown.
3) Include ALL 7 sections for every slide.
4) No explanatory text like 'Here is...' or 'Based on...'.
5) REQUIRED ASSETS must use ONLY these type prefixes: [Image], [Video], [Icon/Logo], [Infograph], [Timeline], [Image Background]. Follow the exact format shown.
6) If a section has no content (e.g., no subtitle needed), write "N/A" as the value on the line below the section marker. Never leave a section completely empty.

COHESION WITH EXISTING DECK: When the user's prompt or deck context references existing pages in the deck, match the visual language and structural patterns of those pages. This means:
- If existing slides use subtitles, the new slide should use a subtitle.
- If existing slides use a specific bullet structure (verb-first, short phrases), match that style.
- If existing slides favor certain layouts (e.g., "One column text" with right-side assets), use the same approach for similar content.
- If existing slides describe a specific color palette or design language in VISUAL STYLING, reference the same palette.
- The new slide should feel like it belongs in the same deck — not like it was made by a different designer.

LAYOUT DESIGN REVIEW — After drafting the slide, review it as a layout designer with developer experience. Think systematically:
1) NEGATIVE SPACE CHECK: Does each image fill ≥60% of its container zone? A 16:9 image in a side panel wastes ~50% of vertical space. A single 16:9 image above two columns wastes ~60% of available height. Fix by: switching to portrait ratio for side panels, using 21:9+ for wide banners, adding a second asset, or switching layouts.
2) BOUNDARY CHECK: Will all visual asset frames fit within the canvas (720×405pt) respecting margins? Use the per-layout coordinate recipes from COMPONENT GEOMETRY rules. No frame should bleed outside the safe area.
3) RATIO-LAYOUT MATCH: Does the image ratio match the container shape? Portrait (2:3, 3:4) for side panels. Wide (21:9+) for full-width banners. Standard (16:9, 3:2) for column-width or per-column placement.
4) Would a different layout better serve this content? Don't default to "Title and body" when "One column text", "Caption", or "Two columns" would create a more balanced page.

COMPANY LOGO: Only include the company logo on title/opener/closer pages where it appears large and centered. Do NOT add as a small badge on content pages — these decks use a preexisting theme template. When including a logo on a title page, describe it in REQUIRED ASSETS as "[Icon/Logo] - Company name logo, large and centered" so the visualizer renders it prominently above the title. This is optional — use it when the deck benefits from strong brand presence.

ICON CONSISTENCY: If existing pages in the deck use [Icon/Logo] badges next to titles on content pages, match that pattern on the new page. If existing pages do NOT use this pattern, don't start it.

VISUAL STYLING — NO COLORS: The VISUAL STYLING section must NEVER mention colors, hex codes, or color names. Describe only mood, texture, atmosphere, typography, and composition. Colors are handled separately by the deck theme system.`;

export const DEFAULT_SINGLE_PAGE_OUTPUT_FORMAT = `SLIDE #[NUMBER] — [Layout Name]
═══════════════════════════════════════════════════════════════

▸ TITLE:
[Write your title here]

▸ SUBTITLE:
[Write your subtitle here]

▸ LAYOUT STRUCTURE:
• [Layout point 1]
• [Layout point 2]
• [Layout point 3]

▸ COPY/TEXT CONTENT:
**[SECTION NAME]:**
• [Content bullet 1]
• [Content bullet 2]

▸ VISUAL STYLING:
[1-2 sentences about visual mood, texture, typography. NO color details — colors handled by deck theme.]

▸ REQUIRED ASSETS:
• [Image] - description of image asset
• [Icon/Logo] - description of icon or logo asset

▸ COMPONENT GEOMETRY:
\`\`\`json
{
  "canvas": { "width": 720, "height": 405 },
  "frames": [
    { "type": "image_placeholder", "description": "Right image", "aspect_ratio": "3:2", "x": 374, "y": 100, "width": 310, "height": 207 }
  ]
}
\`\`\`

═══════════════════════════════════════════════════════════════`;

export const DEFAULT_SINGLE_PAGE_INSTRUCTIONS = `Generate a slide outline based on the project documentation and user's request.

CRITICAL: Output ONLY the structured format below. No explanations, no commentary, no "Based on..." text.

RULES:
1. Start output with "SLIDE #" — nothing before it.
2. Use ▸ markers for ALL 7 sections.
3. NEVER use # or ## markdown headers.
4. No explanatory text like "Here is..." or "Based on..."
5. Keep content concise — max 4 sentences per section. HOWEVER, if the user's deck context prompt requests more detail, longer descriptions, or more thorough/descriptive content, honor that request: allow more sentences per section, longer bullets, and additional sections as needed while ensuring text still fits within the visible slide frame.
6. CAPTION LAYOUTS: COPY/TEXT CONTENT minimal (2-3 bullets max) — focus on visuals. Exception: if user explicitly requests detailed captions, allow up to 4-5 bullets.
7. TITLE-ONLY LAYOUTS: Title slide, Section header, Title Page w/Gradient, Section Header w/Gradient, Title only, Big number — COPY/TEXT CONTENT = "N/A - title slide".
8. BREVITY: Max 8 words per bullet, max 2 sections with 3 bullets each. Reduce text when large assets are present. OVERRIDE: If the user's deck context prompt asks for more detail, richer descriptions, or expanded content, increase these limits — allow longer bullets (up to ~15 words), more sections (up to 3-4), and more bullets per section (up to 5). Always ensure all text fits within the visible slide frame without overflow.
8a. TIMELINE/LARGE VISUAL TEXT LIMIT: When a [Timeline], [Infograph], or large visual element occupies the top portion of a slide (reducing the body text area to ~115pt or less), limit COPY/TEXT CONTENT to ≤8 lines total (max 2 sections with 3-4 bullets each). Do NOT generate 3+ full sections — the reduced body area cannot fit them.
9. ICONS SPARINGLY: Most slides need 0-1 icons. No decorative icons.
10. DATA VIZ LIMIT: Max ONE [Timeline] OR ONE [Infograph] per slide — never both.
11. LAYOUT PREFERENCE: Body text + visual asset → "One column text". Text-only → "Title and body".
12. GRADIENT LAYOUTS: Gradient MUST be dark/black for text contrast.
13. BIG NUMBER: TITLE = number, SUBTITLE = description/context, COPY = "N/A - title slide". In geometry: use text_title + text_subtitle only — do NOT use text_body.
14. WIDE IMAGES: 21:9+ must NOT go in "Title and body" or side panels. Use "Caption".
15. TITLE AND BODY = TEXT ONLY: No side panel for images. Wide image ABOVE body is acceptable.
16. NEGATIVE SPACE PREVENTION: After choosing layout + assets, verify image fills ≥60% of its container zone. If not, ADD MORE VISUAL ASSETS (preferred), switch ratio, or switch layout. When single asset leaves >40% empty space, add a second asset.
17. COMPANY LOGO: Only on title/opener/closer. "[Icon/Logo] - Company name logo, large and centered".
18. ONE COLUMN TEXT: Images fill RIGHT HALF (50% width). FIXED ASPECT RATIOS: 1 asset = 8:9 (fills entire half), 2 assets = 16:9 each (stacked top/bottom), 3 assets = 8:3 each (stacked in thirds). No gaps or padding between images. No other ratios allowed for this layout.
19. TWO COLUMNS: PREFER two per-column images over single wide. Horizontal only — one per column or single wide above. If 2+ assets exist, ALWAYS use per-column mode. Single wide image above: ratio between 21:9 (2.33:1) and 2.75:1. NEVER wider than 2.75:1. HEIGHT THRESHOLDS: 1-2 images use 50-57% of content height, 3 images 37-51%, 4 images 30-51%. Min 40% of page reserved for text (1-2 imgs) or 46% (3-4 imgs). TWO COLUMNS COPY FORMAT: Use --- (three dashes on its own line) to separate left and right column content. Each column can optionally start with a **Bold Header**. Example: **Left Header:**\n• bullet 1\n• bullet 2\n---\n**Right Header:**\n• bullet 1\n• bullet 2. Bold text is allowed freely in content without breaking columns. Columns can contain bullet points, numbered lists, or plain paragraph text.
20. THREE COLUMNS: Visual assets above columns. If 3 assets, each centered above its column. If 1-2 assets, center above columns. If 4 assets, pack left. HEIGHT THRESHOLDS: same as TWO COLUMNS (1-2 images 50-57%, 3 images 37-51%, 4 images 30-51%). Min 40% text (1-2 imgs) or 46% (3-4 imgs). THREE COLUMNS COPY FORMAT: Use --- (three dashes on its own line) to separate column content. Three sections = three columns. Each column can optionally start with a **Bold Header**. Columns can contain bullet points, numbered lists, or plain paragraph text.
21. FOUR COLUMNS: Visual assets above columns. If 4 assets, each centered above its column. If 1-2 assets, center above columns. If 3 assets, pack left. HEIGHT THRESHOLDS: same as TWO COLUMNS (1-2 images 50-57%, 3 images 37-51%, 4 images 30-51%). Min 40% text (1-2 imgs) or 46% (3-4 imgs). FOUR COLUMNS COPY FORMAT: Use --- (three dashes on its own line) to separate column content. Four sections = four columns. Each column can optionally start with a **Bold Header**. Columns can contain bullet points, numbered lists, or plain paragraph text.
22. CAPTION: Image-dominant layout. Visual area ~85% of page, text caption ~15%. Single assets up to 21:9. Minimal text only. CRITICAL: text_title and text_body frames must NOT overlap — stack them vertically below the image with gaps (title first, then body). See caption coordinate recipe.
23. SECTION TITLE DESC: Images fill the LEFT half (x=0, width=360). Text on RIGHT half (x=378, width=306). FIXED ASPECT RATIOS: 1 asset = 8:9 (fills entire left half), 2 assets = 16:9 each (stacked top/bottom), 3 assets = 8:3 each (stacked in thirds). No gaps or padding between images. No other ratios allowed for this layout.
24. VISUAL STYLING: NO colors. Mood, texture, atmosphere, typography only.
25. COMPONENT GEOMETRY: Every slide MUST include geometry JSON. Use the per-layout coordinate recipes. Verify ALL frames stay within canvas bounds (720×405) with margins (36pt L/R, 30pt top, 35pt bottom). See rules below.
${ASSET_RULES}
${COMPONENT_GEOMETRY_RULES}`;
