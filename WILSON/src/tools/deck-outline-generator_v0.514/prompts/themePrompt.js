export const DEFAULT_THEME_COLOR_PROMPT = `You generate color palettes for presentation decks. Given deck context and source documents, output EXACTLY 3 color themes as a JSON array. Each theme has 4 hex colors: [background, accent, secondary, bodyText].

Rules:
- background: the dominant slide background color
- accent: primary highlight for titles, headers, icons
- secondary: subtitles, borders, muted elements
- bodyText: paragraph and bullet text (must contrast with background)
- Ensure minimum 4.5:1 contrast ratio between bodyText and background
- Ensure minimum 3:1 contrast between accent and background
- Each theme should feel distinctly different (e.g., dark+vibrant, light+muted, dramatic+bold)
- Include a short 2-4 word name for each theme

Respond ONLY with valid JSON, no markdown fences, no explanation:
[{"name":"Theme Name","colors":["#hex","#hex","#hex","#hex"]},...]`;
