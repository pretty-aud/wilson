# D.O.G. Bridge — Google Slides Extension

## Prompt for Claude Code

---

Build me a Google Slides Apps Script extension called **"D.O.G. Bridge"** (Deck Outline Generator Bridge). This extension reads a structured markdown outline exported from the D.O.G. tool, then programmatically creates/populates an entire Google Slides deck — placing text boxes, image frames, and visual assets exactly where the outline specifies using a precise coordinate system. The output must be a complete Apps Script project (Code.gs + sidebar HTML) that can be copy-pasted directly into the Google Slides Apps Script editor. **Do NOT use or require any external AI API keys. This is purely an Apps Script extension with no external AI calls.**

---

## PART 1 — UNDERSTANDING THE D.O.G. MARKDOWN FORMAT

The D.O.G. tool exports outlines in a structured markdown format. The extension must be able to parse **both** of the following outline formats:

### Format A: DECKOUTLINE.md (Standard)

Each slide in the outline follows this exact structure:

```
SLIDE #[NUMBER] — [Layout Name]
═══════════════════════════════════════════════════════════════

▸ TITLE:
[Title text]

▸ SUBTITLE:
[Subtitle text or "N/A"]

▸ LAYOUT STRUCTURE:
• [Description of how elements are arranged]
• [Description of how elements are arranged]

▸ COPY/TEXT CONTENT:
**[Section Name]:**
• Bullet point text
• Bullet point text
---
**[Another Section Name]:**
• Bullet point text
• Bullet point text

▸ VISUAL STYLING:
[1-2 sentences describing mood, texture, atmosphere — NO color values]

▸ REQUIRED ASSETS:
• [Image | 16:9] - Description of the image
• [Icon/Logo] - Description of the icon
• [Infograph | 4:3] - Description of the infographic

▸ COMPONENT GEOMETRY:
```json
{
  "canvas": { "width": 720, "height": 405 },
  "frames": [
    { "type": "image_placeholder", "description": "Right image", "aspect_ratio": "3:2", "x": 374, "y": 100, "width": 310, "height": 207 },
    { "type": "text_title", "description": "Title", "x": 36, "y": 30, "width": 648, "height": 45 },
    { "type": "text_body", "description": "Body text", "x": 36, "y": 80, "width": 300, "height": 290 }
  ]
}
```

═══════════════════════════════════════════════════════════════
```

**Parsing rules:**
- Slides are separated by delimiter lines of 60+ `═` characters.
- Slide headers match: `SLIDE #[number] — [Layout Name]` OR `SLIDE #[number] [Layout Type: Layout Name]`
- Each section is prefixed with `▸` marker.
- COMPONENT GEOMETRY contains a JSON code block with exact coordinates.
- COPY/TEXT CONTENT may use `---` (three dashes on own line) to separate columns.
- Text formatting: `**bold**`, `• bullet`, `1. numbered list`

### Format B: VIS_DECKOUTLINE.md (Visual Outline with Theme)

This format wraps the standard outline with a header and footer containing theme color data:

**Header:**
```
▸ DECK TITLE: [Project Name]
▸ PAGE COUNT: [Number]
▸ SELECTED THEME: [Theme Name] — [#hex1, #hex2, #hex3, #hex4]
▸ VISUAL DESCRIPTION: [Optional deck visual language description]
═══════════════════════════════════════════════════════════════
```

**Body:** All slides in Format A structure.

**Footer:**
```
ALTERNATE THEME COLORS
═══════════════════════════════════════════════════════════════
• [Theme Name 2]: [#hex1, #hex2, #hex3, #hex4]
• [Theme Name 3]: [#hex1, #hex2, #hex3, #hex4]
═══════════════════════════════════════════════════════════════
```

**Theme Color Array Positions:**
- Index 0: `background` — slide background color
- Index 1: `accent` — titles, headers, icons
- Index 2: `secondary` — subtitles, borders, muted elements
- Index 3: `bodyText` — paragraph/bullet text

The parser must detect which format is being used. If a `▸ SELECTED THEME:` line exists in the header, it's Format B. Otherwise it's Format A.

---

## PART 2 — COORDINATE SYSTEM

The D.O.G. tool uses a **720pt × 405pt** canvas with the following coordinate system:

| Property | Value |
|----------|-------|
| Canvas Width | 720 pt |
| Canvas Height | 405 pt |
| Left Margin | 36 pt |
| Right Margin | 36 pt |
| Top Margin | 30 pt |
| Bottom Margin | 35 pt |
| Safe Area X | [36, 684] |
| Safe Area Y | [30, 370] |
| Content Width | 648 pt (720 − 36 − 36) |
| Content Height | 340 pt (405 − 30 − 35) |
| Gutter | 15 pt between elements |

**Origin:** (0, 0) = top-left corner. All coordinate values are integers in points.

**Google Slides uses inches by default.** The conversion is: **1 pt = 1/72 inch**. So:
- Canvas = 10 inches × 5.625 inches
- To convert any DOG coordinate to inches: `inches = pt / 72`

All `x`, `y`, `width`, `height` values from the COMPONENT GEOMETRY JSON must be converted from points to inches when calling the Google Slides API.

---

## PART 3 — LAYOUT TYPES

The extension must recognize and handle all 15 layout types:

| Layout ID | Layout Name |
|-----------|-------------|
| title_slide | Title slide |
| section_header | Section header |
| title_body | Title and body |
| title_two_columns | Title and two columns |
| title_three_columns | Title and three columns |
| title_four_columns | Title and four columns |
| title_only | Title only |
| one_column | One column text |
| main_point | Main point |
| section_title_desc | Section title and description |
| caption | Caption |
| big_number | Big number |
| blank | Blank |
| section_header_gradient | Section Header w/Gradient |
| title_page_gradient | Title Page w/Gradient |

When creating slides, the extension must attempt to match each slide's layout name to the closest Google Slides predefined layout from the applied theme. The matching should be case-insensitive and use fuzzy matching (e.g., "Title and two columns" → `TITLE_AND_TWO_COLUMNS` or the theme's equivalent). If no close match is found, use the `BLANK` layout and build all elements from scratch using the COMPONENT GEOMETRY coordinates.

---

## PART 4 — FRAME TYPES IN COMPONENT GEOMETRY

Each frame in the `"frames"` array has a `"type"` field:

| Frame Type | Description | Has Aspect Ratio |
|------------|-------------|-----------------|
| `image_placeholder` | Image frame | Yes |
| `video_placeholder` | Video frame | Yes |
| `infograph_placeholder` | Chart/infographic frame | Yes |
| `timeline_placeholder` | Timeline/process flow frame | Yes |
| `icon_placeholder` | Small icon/logo badge | No |
| `background_image` | Full-bleed background (0,0,720,405) | No |
| `text_title` | Title text box | No |
| `text_body` | Body text box | No |
| `text_subtitle` | Subtitle text box | No |

---

## PART 5 — SYSTEM FLOW (Execution Order)

When the user presses "Create Deck", the extension must execute in this exact order:

### Step 1: Parse the Outline
- Read the uploaded `.md` file content.
- Detect format (A or B) by checking for `▸ SELECTED THEME:` header.
- Parse each slide: extract slide number, layout name, title, subtitle, layout structure, copy/text content, visual styling, required assets, and component geometry JSON.
- If Format B: extract the selected theme name and 4-color hex array. Extract alternate themes from the footer.

### Step 2: Create Slides with Correct Layouts
- For **Full Deck** mode: create all slides from the outline in order (slide 1, slide 2, ..., slide N). Remove any default blank slides that Google Slides creates automatically.
- For **Single Page** mode: find the slide in the current deck whose position matches the input slide number and replace it. Delete the old slide at that position and insert the new one in its place.
- For each slide: match the outline's layout name to the Google Slides theme's predefined layout. Apply that layout to the new slide. If no match, use BLANK.

### Step 3: Apply Theme Colors (if checkbox is TRUE)
- If the outline is Format B and "Use Outline Theme" is checked:
  - Set the slide master's background to color index 0 (background).
  - Update all title placeholder text styles to use color index 1 (accent).
  - Update all subtitle placeholder text styles to use color index 2 (secondary).
  - Update all body text placeholder text styles to use color index 3 (bodyText).
  - Apply these to the theme/master so they cascade to all slides.

### Step 4: Size and Position Text Boxes
- For each slide, iterate through the COMPONENT GEOMETRY frames.
- For frames with type `text_title`, `text_body`, `text_subtitle`:
  - Find the corresponding placeholder text box on the Google Slide (match by type: TITLE, SUBTITLE, BODY).
  - If the slide layout provided a placeholder, resize and reposition it to match the COMPONENT GEOMETRY coordinates (convert pt to inches: value / 72).
  - Set: `left = x/72`, `top = y/72`, `width = width/72`, `height = height/72` (all in inches).
  - If no placeholder exists (BLANK layout), create a new text box at those exact coordinates.

### Step 5: Inject Text Content with Formatting
- For each slide, inject the text content into the positioned text boxes:
  - **Title** → inject into `text_title` frame / TITLE placeholder.
  - **Subtitle** → inject into `text_subtitle` frame / SUBTITLE placeholder. If "N/A", leave empty.
  - **Body Content** → inject into `text_body` frame(s) / BODY placeholder(s).
- Apply formatting:
  - `**bold text**` → set those runs to bold.
  - `• ` prefix → format as bullet point (use Google Slides bullet preset or `setBulletGlyph`).
  - `1. `, `2. `, etc. → format as numbered list.
  - `---` separator → this indicates column split. For multi-column layouts, split content at `---` and inject left content into the left column text box and right content into the right column text box (matching by x-coordinate position: lower x = left column, higher x = right column). For three columns, split at two `---` markers. For four columns, split at three `---` markers.
- Make sure text does NOT overflow its text box. If content is too long, reduce font size proportionally to fit.

### Step 6: Header & Footer Setup
- From SLIDE #1 (the title page), extract the **title text**.
- Find all header and footer text boxes in the Google Slides theme/master.
- Place that exact title text into the theme's header and footer title fields.
- For any date placeholder in the header/footer: use the **exact date and time the user clicked "Create Deck"**.
- Match the date format found in the theme's existing date placeholder. Examples:
  - If the theme shows `month.dd.yyyy` → output `february.12.2026`
  - If the theme shows `MM/DD/YY` → output `02/12/26`
  - If the theme shows `MMMM DD, YYYY` → output `February 12, 2026`
  - If the theme shows `mm-dd-yyyy` → output `02-12-2026`
  - Parse the existing date format string and replicate it with the current date values. Use lowercase month names for lowercase format, uppercase for uppercase, etc.

### Step 7: Create Image/Asset Frames
- For each slide, iterate through COMPONENT GEOMETRY frames.
- For frames with type `image_placeholder`, `video_placeholder`, `infograph_placeholder`, `timeline_placeholder`:
  - Create a **placeholder rectangle shape** (or image placeholder) on the slide at the exact coordinates from the geometry.
  - Position: `left = x/72 inches`, `top = y/72 inches`
  - Size: `width = width/72 inches`, `height = height/72 inches`
  - Style the placeholder: light gray fill (#E0E0E0), thin border (#999999), with the description text centered inside as a label so the user knows what asset goes there.
  - Maintain the aspect ratio specified in the frame's `"aspect_ratio"` field.
- For `icon_placeholder`: create a smaller shape at the specified coordinates.
- For `background_image`: set the slide background to a placeholder color or leave for asset injection.

### Step 8: Place Visual Assets (if checkbox is TRUE)
- If "Use Assets" is checked and a folder path was provided:
  - Read all image files from the specified folder.
  - Match each image file to the corresponding frame by matching the filename to the asset description from `▸ REQUIRED ASSETS:` section (use fuzzy name matching — asset titles use underscores for spaces, filenames may vary).
  - For each matched image:
    - Insert the image into the slide at the exact position and size specified by the COMPONENT GEOMETRY frame.
    - The image should fill the frame completely (crop to fit if needed to maintain the frame's aspect ratio).
    - Replace the gray placeholder rectangle with the actual image.
  - For `background_image` frames: set the image as the slide's background image.

### Step 9: Final Validation Pass
- After all slides are built, run a validation pass on every slide:
  1. **Boundary Check:** Verify no element (text box or image) extends beyond the canvas (720×405 pt = 10×5.625 inches). If any element overflows, clamp it to the canvas bounds.
  2. **Header/Footer Overlap:** Verify no content elements overlap with the theme's header or footer regions. If overlap detected, shift the element inward.
  3. **Text Clipping:** For each text box, check if the text content fits. If text is clipped/overflowing, reduce font size until it fits or flag a warning in the console log.
  4. **Image Clipping:** Verify all images are fully within their designated frames and not bleeding outside.
  5. **Safe Area:** All non-background content must stay within the safe area: x ∈ [36, 684] pt, y ∈ [30, 370] pt (converted to inches: x ∈ [0.5, 9.5], y ∈ [0.417, 5.139]).

---

## PART 6 — EXTENSION USER INTERFACE

The sidebar UI should use the app's visual language: **dark gray backgrounds (#1c1917, #292524, #44403c), orange accents (#ea580c, #f4a261), white text, monospace font (or system monospace), uppercase tracking-wide labels.**

### Layout: Two-Tab Sidebar

**Tab 1: "CREATE" (default active tab)**

The CREATE tab contains all the inputs for building the deck:

1. **Mode Selector: "SINGLE PAGE" / "FULL DECK"**
   - Toggle switch or two radio buttons.
   - Default: "FULL DECK".
   - If "SINGLE PAGE" is selected, show an additional input field: "Page Number" (integer input).
   - Single Page mode: the system replaces only the slide at that page number position in the existing deck with the content from the uploaded outline for that page number.

2. **OUTLINE FILE** (File Input)
   - Label: "OUTLINE FILE" (uppercase, tracking-wide, small text, orange or white label).
   - A file picker / upload button that accepts `.md` files.
   - After upload, show the filename below the input.
   - The system reads the file content as text.

3. **ASSETS FOLDER** (Folder Path Input)
   - Label: "ASSETS FOLDER"
   - Text input field where the user enters/pastes the path to the folder containing exported visual assets from the D.O.G. tool.
   - This field is optional. If left empty, the system skips asset placement regardless of the checkbox.
   - Style: dark input (#1c1917 background, #f4a261 text, no border, orange focus ring).

4. **USE OUTLINE THEME?** (Checkbox)
   - Label: "USE OUTLINE THEME"
   - When TRUE: the system extracts theme colors from the outline (Format B) and applies them to the Google Slides theme/master.
   - When FALSE: leave the theme colors as they are.
   - If the outline is Format A (no theme data), this checkbox is ignored and grayed out.

5. **USE ASSETS?** (Checkbox)
   - Label: "USE ASSETS"
   - When TRUE: read images from the assets folder and place them into their corresponding frames on the Google Slides.
   - When FALSE: leave the image frames as empty placeholders (gray rectangles with labels). The user will manually place images later.

6. **CREATE DECK Button**
   - Large button at the bottom of the tab.
   - Background: #ea580c (orange), white bold uppercase text.
   - On click: execute the full system flow (Steps 1–9 above).
   - Show a progress indicator during execution (e.g., "Creating slide 3 of 12...").
   - On completion: show a success message.

**Tab 2: "SETTINGS"**

The SETTINGS tab contains configuration options:

1. **Default Font Family** — text input or dropdown for the font to use for body text (default: the theme's font).
2. **Title Font Size** — number input (default: 24pt).
3. **Subtitle Font Size** — number input (default: 16pt).
4. **Body Font Size** — number input (default: 12pt).
5. **Placeholder Style** — dropdown: "Gray with Label" (default), "Outlined Only", "Transparent".
6. **Date Format Override** — optional text input to override the auto-detected date format (e.g., "MMMM DD, YYYY"). If blank, auto-detect from theme.
7. **Debug Mode** — checkbox. When on, log detailed parsing and placement info to the browser console / Apps Script execution log.

### Tab Styling
- Tab bar at top: two tabs side by side.
- Active tab: #1c1917 background, orange text, orange bottom border (2px).
- Inactive tab: #44403c background, #a8a29e (stone-400) text.
- Tab labels: uppercase, bold, tracking-wide.

### Overall Sidebar Styling
- Sidebar background: #292524
- Labels: #a8a29e (light gray), uppercase, font-size ~10px, letter-spacing wide
- Input fields: #1c1917 background, #f4a261 text, no border, rounded-sm
- Checkboxes: custom styled with orange accent
- Buttons: #ea580c background, white text, bold uppercase
- Scrollable if content exceeds sidebar height

---

## PART 7 — OUTPUT FORMAT

**Produce the complete Apps Script project as two clearly separated files that can be copy-pasted into the Google Slides Script Editor:**

### File 1: `Code.gs`
- All server-side Apps Script functions.
- `onOpen()` to add the extension menu item.
- `showSidebar()` to open the HTML sidebar.
- All parsing functions for the markdown format.
- All slide creation, text injection, formatting, image placement functions.
- The validation pass function.
- All helper functions (coordinate conversion, color parsing, date formatting, etc.).

### File 2: `Sidebar.html`
- Complete HTML file with embedded CSS and JavaScript.
- The two-tab interface (CREATE and SETTINGS).
- All form inputs, checkboxes, buttons.
- Client-side JavaScript for tab switching, file reading, calling server-side functions via `google.script.run`.
- Progress indicator UI.
- Styled with the dark gray + orange color scheme described above.

**Make sure both files are complete, functional, and ready to paste. Include clear comments throughout the code. Do not use any external libraries or CDNs — everything must be self-contained within Apps Script.**

---

## PART 8 — CRITICAL RULES

1. **No external API keys required.** This extension uses ONLY Google Apps Script native APIs (SlidesApp, DriveApp, etc.). No external API calls.
2. **Coordinate precision is critical.** The COMPONENT GEOMETRY coordinates define exact pixel-perfect placement. Every frame must be placed at exactly the specified position and size (after pt → inches conversion).
3. **Both outline formats must work.** The parser must handle Format A (DECKOUTLINE.md) and Format B (VIS_DECKOUTLINE.md) seamlessly.
4. **Text formatting must be preserved.** Bold, bullets, and numbered lists from the markdown must appear correctly in Google Slides.
5. **Column splitting must work.** Multi-column text separated by `---` must be routed to the correct column text boxes based on x-coordinate position.
6. **Date format matching is required.** The header/footer date must match the format pattern found in the theme, using the current execution date.
7. **Safe area must be respected.** No content (except background images) should extend outside x ∈ [36, 684] pt, y ∈ [30, 370] pt.
8. **The final validation pass is mandatory.** Always run the boundary/overlap/clipping checks after building the deck.

---

## PART 9 — IMPLEMENTATION GUIDANCE FOR CLAUDE CODE

When building this in Claude Code:

1. **Create two files:**
   - `Code.gs` — the server-side Apps Script
   - `Sidebar.html` — the client-side HTML/CSS/JS sidebar

2. **Start with the parser.** Build and test the markdown parsing functions first. Make sure both Format A and Format B parse correctly. Write thorough parsing logic with regex for:
   - Slide header detection: `/^SLIDE\s+#(\d+)\s*[—-]\s*(.+)$/m`
   - Section extraction: `/▸\s*(TITLE|SUBTITLE|LAYOUT STRUCTURE|COPY\/TEXT CONTENT|VISUAL STYLING|REQUIRED ASSETS|COMPONENT GEOMETRY)\s*:\s*([\s\S]*?)(?=▸|═{10,}|$)/g`
   - Theme color extraction: `/▸\s*SELECTED THEME:\s*([^—\n]+)—\s*(#[0-9a-f]{6}(?:\s*,\s*#[0-9a-f]{6})*)/i`
   - Component geometry JSON extraction from fenced code blocks
   - Column separator detection: `/^---$/m`

3. **Build the slide creation logic.** Use `SlidesApp.getActivePresentation()` and its methods:
   - `presentation.getLayouts()` to get available layouts from the theme
   - `presentation.appendSlide(layout)` to add slides
   - `slide.insertShape()`, `slide.insertTextBox()`, `slide.insertImage()` for element creation
   - `element.setLeft()`, `element.setTop()`, `element.setWidth()`, `element.setHeight()` for positioning

4. **Build the text formatting engine.** When injecting text:
   - Parse `**bold**` markers and apply bold to those ranges
   - Parse `• ` prefixes and apply bullet formatting
   - Parse `1. ` prefixes and apply numbered list formatting
   - Use `textRange.getTextStyle().setBold(true)` for bold runs
   - Use `listStyle.applyListPreset()` for bullets/numbers

5. **Build the coordinate converter.** Simple function: `function ptToInches(pt) { return pt / 72; }`

6. **Build the asset placement logic.** Use `DriveApp` to access files by folder path, or accept base64-encoded images from the sidebar.

7. **Build the validation pass.** Iterate all elements on all slides, check bounds, clamp if needed.

8. **Build the sidebar.** HTML with embedded `<style>` and `<script>`. Use `google.script.run` to communicate with server-side functions. Implement the two-tab layout with all inputs.

9. **Test thoroughly.** Make sure all 15 layout types are handled. Test with both Format A and Format B outlines. Test single page mode and full deck mode.
