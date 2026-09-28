// Shared D.O.G. Help Content — used by both DeckOutlineGenerator help modal and HelpPage
// IMPORTANT: This is the single source of truth for D.O.G. help text.

export const DOG_HELP_SIDEBAR_ITEMS = [
  { id: 'overview', label: 'Overview' },
  { id: 'workflow', label: 'Basic workflow' },
  { id: 'tips', label: 'Tips & best practices' },
  { id: 'upload', label: 'Document upload' },
  { id: 'prompting', label: 'Deck context & prompting' },
  { id: 'editing', label: 'Editing & regenerating' },
  { id: 'system-prompts', label: 'System prompts' },
  { id: 'output-format', label: 'Output format' },
  { id: 'theme', label: 'Theme generator' },
  { id: 'image-prompts', label: 'Image prompt generation' },
  { id: 'asset-placement', label: 'Visual asset placement' },
  { id: 'layouts', label: 'Slide layouts' },
  { id: 'settings', label: 'Settings panel' },
  { id: 'slides-extension', label: 'Download the Slides extension' },
];

// Two role sets, one per surface (P1-35). Until P1 the light Help page drew
// this content through a sheet of !important overrides on the dark classes:
// translucent white cards on the orange (C9), three stone greys (one ink on
// orange is the rule), and a dark grey notes box with orange text. Now the
// content names a ROLE and each surface supplies its classes, as O.T.T.E.R.'s
// and R.A.B.B.I.T.'s help already do.
//
// D is the in-tool dialog, on the kit's tokens the way R.A.B.B.I.T.'s help
// went in B6: the stone ramp and orange-400 retired from its prose (141
// orange and 368 stone utilities, P1-35), emphasis in the ink rather than a
// faded orange, the second ink for running text and hints (the third
// measures ~4.35:1 on the #292524 ground one of the dialogs paints), the
// section title at H2 and a card's title at H3 (§3.1). L is HelpPage's own
// `L`, key for key where the roles match.
const D = {
  sectionTitle: 'text-h2 text-ink mb-3',
  sectionTitleTight: 'text-h2 text-ink mb-2',
  card: 'bg-paper-raised p-3 rounded-control border border-rule',
  notesBox: 'bg-signal-tint border border-signal rounded-control p-3',
  cardTitle: 'text-h3 text-ink mb-2',
  cardTitleTight: 'text-h3 text-ink mb-1',
  lead: 'text-dense text-ink-2 leading-relaxed mb-4',
  body: 'text-dense text-ink-2 leading-relaxed mb-3',
  bodyList: 'text-dense text-ink-2 leading-relaxed space-y-1',
  bodyList2: 'text-dense text-ink-2 leading-relaxed space-y-2',
  list: 'text-dense text-ink-2 leading-relaxed space-y-1 ml-2',
  listLoose: 'text-dense text-ink-2 leading-relaxed space-y-1.5 ml-2',
  para: 'text-dense text-ink-2 leading-relaxed',
  paraSpaced: 'text-dense text-ink-2 leading-relaxed mb-2',
  hint: 'text-dense text-ink-2 mt-2',
  hintTight: 'text-dense text-ink-2 mt-1',
  hintList: 'text-dense text-ink-2 mt-1 space-y-0.5 ml-2',
  hintList2: 'text-dense text-ink-2 mt-2 space-y-1 ml-2',
  hintIndent: 'text-dense text-ink-2 mt-2 ml-2',
  hintPara: 'text-dense text-ink-2 leading-relaxed',
  hintListLoose: 'text-dense text-ink-2 leading-relaxed space-y-1 ml-2',
  example: 'text-dense text-ink-2 bg-paper-recessed p-2 rounded-control leading-relaxed',
  exampleTight: 'text-dense text-ink-2 mt-1 bg-paper-recessed p-2 rounded-control',
  exampleWell: 'mt-2 bg-paper-recessed p-2 rounded-control',
  caption: 'text-caption text-ink-2 ml-2',
  em: 'text-ink',
  emStrong: 'text-ink font-semibold',
  accent: 'text-ink font-semibold',
  accentStrong: 'text-ink font-semibold',
  accentSoft: 'text-ink font-semibold',
  quiet: 'text-ink-2',
  label: 'text-dense text-ink font-semibold',
  labelTight: 'text-dense text-ink font-semibold mb-1',
  glyph: 'text-ink text-dense',
  download: 'flex items-center gap-3 px-3 py-2.5 rounded-control border border-rule bg-paper-recessed transition-colors hover:bg-hover',
};

const L = {
  sectionTitle: 'text-h2 text-ink-light mb-3',
  sectionTitleTight: 'text-h2 text-ink-light mb-2',
  card: 'bg-well-light border border-rule-light rounded-control p-3',
  notesBox: 'bg-well-light border border-rule-light rounded-control p-3',
  cardTitle: 'text-h3 text-ink-light mb-2',
  cardTitleTight: 'text-h3 text-ink-light mb-1',
  lead: 'text-body text-ink-light mb-4',
  body: 'text-body text-ink-light mb-3',
  bodyList: 'text-dense text-ink-light space-y-1',
  bodyList2: 'text-dense text-ink-light space-y-2',
  list: 'text-dense text-ink-light space-y-1 ml-2',
  listLoose: 'text-dense text-ink-light space-y-1.5 ml-2',
  para: 'text-dense text-ink-light',
  paraSpaced: 'text-dense text-ink-light mb-2',
  hint: 'text-dense text-ink-light mt-2',
  hintTight: 'text-dense text-ink-light mt-1',
  hintList: 'text-dense text-ink-light mt-1 space-y-0.5 ml-2',
  hintList2: 'text-dense text-ink-light mt-2 space-y-1 ml-2',
  hintIndent: 'text-dense text-ink-light mt-2 ml-2',
  hintPara: 'text-dense text-ink-light',
  hintListLoose: 'text-dense text-ink-light space-y-1 ml-2',
  example: 'text-dense text-ink-light bg-ground-light border border-rule-light p-2 rounded-control',
  exampleTight: 'text-dense text-ink-light mt-1 bg-ground-light border border-rule-light p-2 rounded-control',
  exampleWell: 'mt-2 bg-ground-light border border-rule-light p-2 rounded-control',
  caption: 'text-caption text-ink-light ml-2',
  em: 'font-semibold',
  emStrong: 'font-semibold',
  accent: 'font-semibold',
  accentStrong: 'font-semibold',
  accentSoft: 'font-semibold',
  quiet: 'text-ink-light',
  label: 'text-dense font-semibold',
  labelTight: 'text-dense font-semibold mb-1',
  glyph: 'text-dense',
  download: 'flex items-center gap-3 px-3 py-2.5 rounded-control border border-rule-light bg-well-light transition-colors hover:bg-hover-light'
};

export function DogHelpContent({ helpPage, theme }) {
  const T = theme === 'light' ? L : D;
  return (
    <>
      {/* P1 review R1-01: the light surface sets its one ink HERE. The light
          roles that only add weight (em, accent, label, glyph, download) name
          no ink of their own, and outside a list they inherited the app's
          white: 19 runs at 2.53:1 on the orange well (C6). */}
      <div className={theme === 'light' ? 'text-ink-light' : undefined}>
      {/* ═══ OVERVIEW ═══ */}
      {helpPage === 'overview' && (
      <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Overview</h3>
        <p className={T.lead}>
          D.O.G. (Deck Outline Generator) is an AI-powered tool that transforms your project documentation into structured presentation slide outlines.
          Upload your source materials (PDFs, markdown files, text files, or images), provide context about your deck, and generate either individual slides or complete deck outlines.
        </p>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Key features</h4>
            <ul className={T.list}>
              <li>• <span className={T.em}>Single page or full deck generation</span> — Generate individual slides or entire presentations at once</li>
              <li>• <span className={T.em}>15 slide layout types</span> — Title slides, two/three/four columns, big numbers, captions, and more</li>
              <li>• <span className={T.em}>Dynamic visual asset sizing</span> — Image heights auto-adjust based on text content volume in column layouts</li>
              <li>• <span className={T.em}>AI theme color generation</span> — Context-aware color palettes generated by Haiku AI</li>
              <li>• <span className={T.em}>Live slide visualizer</span> — Preview layouts with theme colors and asset placeholders</li>
              <li>• <span className={T.em}>AI rewrite tools</span> — Rewrite selected text with tone adjustments (Relaxed, Formal, Extend, Shorten, Custom)</li>
              <li>• <span className={T.em}>Formatting toolbar</span> — Bold, italic, bullets, numbered lists, and heading formatting</li>
              <li>• <span className={T.em}>Visual asset placement</span> — Upload your own images/videos and let the AI place them into contextually matching slide frames</li>
              <li>• <span className={T.em}>Image prompt generation</span> — Generate AI image prompts for all visual assets at export time</li>
              <li>• <span className={T.em}>Customizable system prompts</span> — Full control over AI instructions and output formats</li>
              <li>• <span className={T.em}>Custom export folder</span> — Choose a specific folder for exported files with remembered location</li>
              <li>• <span className={T.em}>Export as markdown</span> — Download as DECKOUTLINE.md or VIS_DECKOUTLINE.md with theme data</li>
            </ul>
          </div>
        </div>
      </section>
      </div>
      )}

      {/* ═══ BASIC WORKFLOW ═══ */}
      {helpPage === 'workflow' && (
      <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Basic workflow</h3>
        <div className={T.bodyList2}>
          <p><span className={T.accentStrong}>1. Upload documents:</span> Add up to 5 source files (PDFs, markdown, text, or images) that contain your project information.</p>
          <p><span className={T.accentStrong}>2. Set deck context:</span> Provide guidelines about the overall tone, style, and objectives for your presentation.</p>
          <p><span className={T.accentStrong}>3. Choose mode:</span> Toggle "Full deck" to generate an entire presentation, or leave it off to generate individual slides.</p>
          <p><span className={T.accentStrong}>4. For single pages:</span> Select a layout type, optionally set a page number, and describe what content you want on the slide.</p>
          <p><span className={T.accentStrong}>5. Generate & review:</span> Generated outlines appear in the output panel. Use the visualizer to preview layouts with theme colors, or edit the raw markdown.</p>
          <p><span className={T.accentStrong}>6. Refine output:</span> Use the Edit Output bar to regenerate pages with revision notes, change layouts, and undo/redo changes.</p>
          <p><span className={T.accentStrong}>7. Theme colors:</span> Enable "Theme generator" to auto-generate AI color palettes. Cycle through themes with arrow buttons. Refresh for new options.</p>
          <p><span className={T.accentStrong}>8. Export:</span> Download as DECKOUTLINE.md, or check "Include theme colors" for VIS_DECKOUTLINE.md with theme data and visual descriptions.</p>
          <p><span className={T.accentStrong}>9. Image prompts (optional):</span> Enable "Generate image prompts" in the export modal to create AI image prompts for all visual assets. Select your target model (Midjourney, Flux, Nano Banana, or ChatGPT) and download alongside your outline.</p>
        </div>
      </section>
      </div>
      )}

      {/* ═══ DOCUMENT UPLOAD ═══ */}
      {helpPage === 'upload' && (
      <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Document upload best practices</h3>
        <p className={T.body}>
          The quality of your uploaded documents directly impacts the quality of generated slides. The system reads and references your documents as context when generating content.
        </p>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Ideal document types</h4>
            <ul className={T.list}>
              <li>• <span className={T.em}>Project briefs or creative briefs</span> — Best for giving the AI a clear understanding of goals, audience, and scope</li>
              <li>• <span className={T.em}>Content outlines or structured notes</span> — Pre-organized content translates directly into well-structured slides</li>
              <li>• <span className={T.em}>Marketing copy or messaging documents</span> — Provides exact language, taglines, and key phrases to pull from</li>
              <li>• <span className={T.em}>Data sheets or fact sheets</span> — Great for generating Big Number and data-driven slide layouts</li>
              <li>• <span className={T.em}>Reference images</span> — Upload mood boards or style references to inform visual styling suggestions</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Tips for better document input</h4>
            <ul className={T.list}>
              <li>• <span className={T.em}>Use clear headers and sections</span> in your documents — the AI can better extract relevant content when it's well-organized</li>
              <li>• <span className={T.em}>Include specific data points</span> (stats, percentages, timelines) if you want them surfaced in slides</li>
              <li>• <span className={T.em}>Keep documents focused</span> — a concise 2-page brief outperforms a 50-page document dump</li>
              <li>• <span className={T.em}>Multiple smaller files &gt; one massive file</span> — split content by topic area (e.g., one for strategy, one for visuals, one for copy)</li>
              <li>• <span className={T.em}>Avoid scanned PDFs</span> — machine-readable text extracts cleanly, while scanned images may not</li>
              <li>• <span className={T.em}>Name your files descriptively</span> — "Q3_Marketing_Strategy.pdf" gives the AI better context than "doc1.pdf"</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>What to avoid</h4>
            <ul className={T.hintListLoose}>
              <li>• Raw meeting transcripts with lots of filler — clean and summarize first</li>
              <li>• Documents with heavy formatting or tables that may not parse well</li>
              <li>• Uploading only images with no text context — pair images with a written brief</li>
              <li>• Contradictory documents — if you upload two files with conflicting info, the AI may produce inconsistent slides</li>
            </ul>
          </div>
        </div>
      </section>
      </div>
      )}

      {/* ═══ DECK CONTEXT & PROMPTING ═══ */}
      {helpPage === 'prompting' && (
      <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Deck context & page request prompting</h3>
        <p className={T.body}>
          Your Deck Context and Page Request prompts are the primary way you steer the AI. Specific, well-structured prompts produce dramatically better results than vague ones.
        </p>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Deck context (section 1) — best practices</h4>
            <p className={T.paraSpaced}>
              This field sets the tone for every slide generated in the session. Think of it as the creative director's brief.
            </p>
            <ul className={T.list}>
              <li>• <span className={T.em}>Define your audience</span> — "This deck is for C-suite executives at a Fortune 500 retail company"</li>
              <li>• <span className={T.em}>Set the visual tone</span> — "Dark, cinematic aesthetic with noir influences" or "Clean, minimal, modern SaaS style"</li>
              <li>• <span className={T.em}>Specify the purpose</span> — "Sales pitch to close a $2M deal" vs "Internal team kickoff for Q3 initiative"</li>
              <li>• <span className={T.em}>Mention brand guidelines</span> — "Use formal language, avoid slang, always refer to product as 'Platform' not 'app'"</li>
              <li>• <span className={T.em}>Include page count for full deck</span> — "Create a 12-slide presentation with a clear narrative arc"</li>
            </ul>
            <div className="mt-3">
              <p className={T.labelTight}>Example — strong deck context:</p>
              <p className={T.example}>
                "Create a 10-slide pitch deck for ZeroSpace's holographic display technology. Target audience: brand marketing directors at luxury fashion houses. Tone: premium, forward-thinking, slightly provocative. Emphasize ROI and experiential impact. Use data from the uploaded case studies. Visual style: dark backgrounds, gold/amber accents, large hero imagery."
              </p>
            </div>
            <div className="mt-2">
              <p className={T.labelTight}>Example — weak deck context:</p>
              <p className={T.example}>
                "Make a nice presentation about our company."
              </p>
            </div>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Page request (section 2) — best practices</h4>
            <p className={T.paraSpaced}>
              The page request tells the AI exactly what content you want on a specific slide. The more specific you are, the better the output.
            </p>
            <ul className={T.list}>
              <li>• <span className={T.em}>Reference your documents</span> — "Use the pricing data from the uploaded brief to create a comparison slide"</li>
              <li>• <span className={T.em}>Be specific about content</span> — "Cover the 3 key differentiators: speed, quality, and cost" not just "differentiators slide"</li>
              <li>• <span className={T.em}>Mention the slide's role in the deck</span> — "This is the closing slide after the case studies section"</li>
              <li>• <span className={T.em}>Specify data to include</span> — "Include the stat about 40% engagement increase from the case study"</li>
              <li>• <span className={T.em}>Describe the visual you want</span> — "Hero image of the holographic display on the left, key specs on the right"</li>
            </ul>
            <div className="mt-3">
              <p className={T.labelTight}>Example — strong page request:</p>
              <p className={T.example}>
                "Create a 'Title and two columns' slide comparing traditional LED activations vs ZeroSpace holographic experiences. Left column: limitations of LED (flat, static, high setup cost). Right column: benefits of holographic (3D, interactive, modular). Pull specific metrics from the uploaded ROI document."
              </p>
            </div>
          </div>
        </div>
      </section>
      </div>
      )}

      {/* ═══ EDITING & REGENERATING ═══ */}
      {helpPage === 'editing' && (
      <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Editing & regenerating output</h3>
        <p className={T.body}>
          After generating a slide, the Edit Output bar gives you powerful tools to refine content without starting over.
        </p>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Edit output bar controls</h4>
            <ul className={T.listLoose}>
              <li>• <span className={T.em}>Revision prompt</span> — Type specific instructions for how the slide should change (e.g., "make the title punchier" or "add a bullet about timeline")</li>
              <li>• <span className={T.em}>Layout dropdown</span> — Switch to a different layout type during regeneration. Select "Keep layout" to preserve the current one</li>
              <li>• <span className={T.em}>Regenerate page</span> — Sends the current slide content + your revision notes back to the AI for a new version</li>
              <li>• <span className={T.em}>Undo (&#8630;)</span> — Reverts to the previous version before the last regeneration</li>
              <li>• <span className={T.em}>Redo (&#8631;)</span> — Re-applies a version you just undid</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Regeneration tips</h4>
            <ul className={T.list}>
              <li>• <span className={T.em}>Be specific with revisions</span> — "Shorten all bullet points to under 8 words" works better than "make it shorter"</li>
              <li>• <span className={T.em}>Use revision + layout change together</span> — Switch to "Big number" and type "Focus on the 40% engagement stat" for a complete pivot</li>
              <li>• <span className={T.em}>Iterate incrementally</span> — Make one change at a time so you can undo precisely if needed</li>
              <li>• <span className={T.em}>Press Enter</span> in the revision prompt field to trigger regeneration quickly</li>
              <li>• <span className={T.em}>Leave revision empty</span> to get a fresh take on the same content without specific direction</li>
              <li>• <span className={T.em}>Manual editing</span> — Switch to text view (code icon) to directly edit the markdown if you just need small tweaks</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Text view vs visualizer</h4>
            <p className={T.para}>
              Toggle between <span className={T.em}>text view</span> (code icon) for raw markdown editing and the <span className={T.em}>visualizer</span> (eye icon) for a layout preview with theme colors and asset placeholders.
              Edits in text view are live — the visualizer updates immediately to reflect your changes.
            </p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>AI rewrite</h4>
            <p className={T.paraSpaced}>
              Select any text in the output editor and right-click to access AI rewrite options. Available modes:
            </p>
            <ul className={T.list}>
              <li>• <span className={T.em}>Relaxed:</span> Makes text more casual and conversational</li>
              <li>• <span className={T.em}>Formal:</span> Elevates language to a professional, polished tone</li>
              <li>• <span className={T.em}>Extend:</span> Expands the selected text with more detail and depth</li>
              <li>• <span className={T.em}>Shorten:</span> Condenses text while preserving key meaning</li>
              <li>• <span className={T.em}>Custom:</span> Type your own rewrite instruction for full control</li>
            </ul>
            <p className={T.hint}>
              Rewrite prompts can be customized in Settings &rarr; Prompts tab &rarr; "AI rewrite prompts" section.
            </p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Formatting toolbar</h4>
            <p className={T.paraSpaced}>
              The formatting toolbar appears above the text editor (hidden in visualizer view) and provides quick formatting shortcuts:
            </p>
            <ul className={T.list}>
              <li>• <span className={T.em}>Bold (B):</span> Wraps selected text in **bold** markers</li>
              <li>• <span className={T.em}>Italic (I):</span> Wraps selected text in *italic* markers</li>
              <li>• <span className={T.em}>Bullet list:</span> Converts lines to bulleted list items</li>
              <li>• <span className={T.em}>Numbered list:</span> Converts lines to numbered list items with auto-increment</li>
              <li>• <span className={T.em}>Heading:</span> Adds heading markers to selected text</li>
            </ul>
            <p className={T.hint}>
              Press Enter at the end of a bullet or numbered list item to automatically continue the list on the next line.
            </p>
          </div>
        </div>
      </section>
      </div>
      )}

      {/* ═══ SYSTEM PROMPTS ═══ */}
      {helpPage === 'system-prompts' && (
      <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Understanding system prompts</h3>
        <p className={T.body}>
          System prompts are the instructions that tell the AI how to generate your slide content. They control everything from formatting rules to content style.
          There are two types of prompts for each generation mode (single page and full deck), and understanding their purpose is key to customizing the tool effectively.
        </p>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>API system message</h4>
            <p className={T.paraSpaced}>
              This is the core instruction sent to the AI model as its "system" directive. It establishes the AI's fundamental role and behavior before it sees any of your content.
              Think of it as the AI's "job description" - it tells the AI what kind of assistant it should be.
            </p>
            <div className="mt-3 space-y-2">
              <div>
                <p className={T.label}>Required elements (do not remove):</p>
                <ul className={T.hintList}>
                  <li>• Instruction to generate "presentation slide outlines"</li>
                  <li>• Rule to start output with "SLIDE #" (no preamble text)</li>
                  <li>• Rule to use &#9656; markers (&#9656; TITLE:, &#9656; SUBTITLE:, etc.)</li>
                  <li>• Rule to NEVER use # markdown headers</li>
                  <li>• Rule to include ALL 7 sections for every slide</li>
                  <li>• Rule to avoid explanatory text like "Here is..." or "Based on..."</li>
                </ul>
              </div>
              <div>
                <p className={T.label}>Safe to modify:</p>
                <ul className={T.hintList}>
                  <li>• Tone instructions (e.g., "Be concise" vs "Be detailed")</li>
                  <li>• Creativity level (e.g., "Be creative with titles" or "Use straightforward language")</li>
                  <li>• Industry-specific terminology preferences</li>
                  <li>• Additional formatting rules that don't conflict with required elements</li>
                  <li>• Emphasis on certain aspects (e.g., "Focus on visual descriptions")</li>
                </ul>
              </div>
              <div>
                <p className={T.label}>Example customization:</p>
                <p className={T.exampleTight}>
                  Add: "Use professional business language suitable for executive presentations. Avoid jargon and keep bullet points to 10 words or fewer."
                </p>
              </div>
            </div>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Generation rules</h4>
            <p className={T.paraSpaced}>
              These are detailed instructions included in the user prompt that specify exactly how slides should be formatted, what sections to include, and what rules to follow for different layout types.
              This is where the actual output structure is defined.
            </p>
            <div className="mt-3 space-y-2">
              <div>
                <p className={T.label}>Required sections (must keep all 7):</p>
                <ul className={T.hintList}>
                  <li>• <span className={T.accentSoft}>&#9656; TITLE:</span> The main headline for the slide</li>
                  <li>• <span className={T.accentSoft}>&#9656; SUBTITLE:</span> Supporting text beneath the title</li>
                  <li>• <span className={T.accentSoft}>&#9656; LAYOUT STRUCTURE:</span> How content is arranged visually</li>
                  <li>• <span className={T.accentSoft}>&#9656; COPY/TEXT CONTENT:</span> The actual body text and bullet points</li>
                  <li>• <span className={T.accentSoft}>&#9656; VISUAL STYLING:</span> Mood, texture, atmosphere, and typography notes (no color references — colors handled by theme system)</li>
                  <li>• <span className={T.accentSoft}>&#9656; REQUIRED ASSETS:</span> Typed assets: [Image], [Video], [Icon/Logo], [Infograph], [Timeline], [Image Background]</li>
                  <li>• <span className={T.accentSoft}>&#9656; COMPONENT GEOMETRY:</span> JSON code block with x/y/width/height coordinates for Google Slides automation</li>
                </ul>
              </div>
              <div>
                <p className={T.label}>Safe to modify:</p>
                <ul className={T.hintList}>
                  <li>• Content length limits (e.g., "max 3 bullet points per section")</li>
                  <li>• Which layouts should have body text vs. title-only</li>
                  <li>• Asset requirements and suggestions</li>
                  <li>• Visual styling guidelines and color preferences</li>
                  <li>• Rules for specific layout types (e.g., "Caption slides should have 2 bullet points max")</li>
                  <li>• Industry-specific content formatting</li>
                </ul>
              </div>
              <div>
                <p className={T.label}>Layout-specific rules:</p>
                <p className={T.hintTight}>
                  The default rules specify that certain layouts (Title slide, Section header, Title Page w/Gradient, Title only, Big number) should only have title and subtitle with no body text.
                  You can modify which layouts follow this rule by editing the list in rule #7.
                </p>
              </div>
              <div>
                <p className={T.label}>Example customization:</p>
                <p className={T.exampleTight}>
                  Change "max 4 sentences per section" to "max 2 sentences per section, use punchy language"
                  <br/>Add: "8. Always suggest a specific stock photo description in REQUIRED ASSETS"
                </p>
              </div>
            </div>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>How they work together</h4>
            <p className={T.para}>
              When you generate a slide, the system combines these prompts with your uploaded documents and page request:
            </p>
            <ol className={T.hintList2}>
              <li>1. <span className={T.em}>API system message</span> is sent as the AI's system instruction</li>
              <li>2. Your <span className={T.em}>uploaded documents</span> are included as context</li>
              <li>3. Your <span className={T.em}>deck context and guidelines</span> from the main interface are added</li>
              <li>4. The selected <span className={T.em}>layout type</span> and <span className={T.em}>page request</span> are specified</li>
              <li>5. <span className={T.em}>Generation rules</span> with the output format template are appended</li>
              <li>6. The AI generates content following all these instructions</li>
            </ol>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Visual assets system prompt</h4>
            <ul className={T.list}>
              <li>• <span className={T.em}>Theme color generation:</span> Haiku prompt for AI theme color palette generation</li>
              <li>• <span className={T.em}>Shared rules (all models):</span> Common formatting and data completeness rules for all image models</li>
              <li>• <span className={T.em}>Midjourney prompt:</span> Model-specific rules for Midjourney v6 syntax</li>
              <li>• <span className={T.em}>Flux prompt:</span> Model-specific rules for Flux image generation</li>
              <li>• <span className={T.em}>Nano Banana prompt:</span> Model-specific rules for Nano Banana</li>
              <li>• <span className={T.em}>Chat GPT / DALL-E prompt:</span> Model-specific rules for ChatGPT/DALL-E 3</li>
              <li>• <span className={T.em}>Image prompt - API system message:</span> Core instruction for the Claude API call that generates image prompts</li>
            </ul>
          </div>
        </div>
      </section>
      </div>
      )}

      {/* ═══ OUTPUT FORMAT ═══ */}
      {helpPage === 'output-format' && (
      <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Understanding output format</h3>
        <p className={T.body}>
          Output formats define the markdown schema used when exporting slides. The system parses generated content based on these patterns.
          All format schemas are accessible in the Settings panel under the Format tab as collapsible sections.
        </p>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitleTight}>Single page export schema</h4>
            <p className={T.para}>
              Template for individual slide exports. Each slide uses this structure.
            </p>
            <p className={T.hint}><span className={T.accent}>Critical elements:</span> SLIDE #[NUMBER] — [Layout Name] header, ═══ delimiters, and all six &#9656; section markers must be present for the parser to work correctly.</p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitleTight}>Full deck export schema</h4>
            <p className={T.para}>
              Template showing how multiple slides are concatenated in a full deck export. Each slide follows the single page format, separated by delimiters.
            </p>
            <p className={T.hint}><span className={T.accent}>Critical elements:</span> Consistent delimiter pattern between slides (═══════), sequential slide numbering format.</p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitleTight}>Visual deck export schema (VIS_DECKOUTLINE)</h4>
            <p className={T.para}>
              Extended export format that wraps the standard DECKOUTLINE with a deck summary header (title, page count, selected theme colors, visual description)
              and an alternate themes footer listing all unused themes. This schema is read-only and cannot be edited.
            </p>
            <p className={T.hint}><span className={T.accent}>How to use:</span> In the Import/Export modal, check "Include theme colors & deck visual description" to switch the download button to VIS_DECKOUTLINE format. The file is named <span className={T.accent}>PROJECTNAME_VIS_DECKOUTLINE.md</span>.</p>
            <p className={T.hintTight}><span className={T.accent}>Importing:</span> VIS_DECKOUTLINE files can be imported back — the system will parse theme colors from the header and footer and restore them automatically.</p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitleTight}>Image prompt export schema</h4>
            <p className={T.para}>
              Template showing the markdown output format for generated image prompts. Each asset includes title, aspect ratio, and the full prompt text.
            </p>
            <p className={T.hint}><span className={T.accent}>How to use:</span> This schema defines how the DECKNAME_IMG_PROMPTS.md file is structured. Assets are grouped by slide number with formatted prompt blocks.</p>
          </div>
        </div>
      </section>
      </div>
      )}

      {/* ═══ THEME GENERATOR ═══ */}
      {helpPage === 'theme' && (
      <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Theme generator</h3>
        <p className={T.body}>
          The Theme Generator creates color palettes tailored to your deck content using the Haiku AI model. Theme colors are applied in the slide visualizer preview and can be exported with the VIS_DECKOUTLINE format.
        </p>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>How it works</h4>
            <ul className={T.list}>
              <li>• <span className={T.em}>Enable:</span> Check "Theme generator" next to Deck Context & Guidelines</li>
              <li>• <span className={T.em}>Auto-generation:</span> When enabled, themes are generated automatically after each deck or page generation</li>
              <li>• <span className={T.em}>Context-aware:</span> Haiku reads your deck context, slide titles, and file content to create relevant palettes</li>
              <li>• <span className={T.em}>3 themes per batch:</span> Each generation produces 3 new color themes</li>
              <li>• <span className={T.em}>Each theme = 4 colors:</span> Background, Accent, Secondary, Body Text</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Visualizer controls</h4>
            <ul className={T.list}>
              <li>• <span className={T.em}>Left/Right arrows:</span> Cycle through available themes (presets + generated)</li>
              <li>• <span className={T.em}>Refresh button:</span> Generate a new batch of 3 themes (icon spins orange while generating)</li>
              <li>• <span className={T.em}>Color swatches:</span> Show the 4 colors of the active theme with hex codes</li>
              <li>• <span className={T.em}>Theme name & index:</span> Displayed in orange next to the swatches</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Preset vs generated</h4>
            <p className={T.para}>
              4 preset themes are always available: Black & Orange, Orange & Black, Black & White, White & Black.
              When "Theme generator" is unchecked, only these presets are used. When enabled,
              AI-generated themes are added after the presets and the first generated theme is auto-selected.
            </p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Visual styling — no color rule</h4>
            <p className={T.para}>
              Slide outlines never include color references in the VISUAL STYLING section. This is by design — colors are handled
              separately by the theme system. Visual styling descriptions focus only on mood, texture, atmosphere, typography, and composition.
            </p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Theme prompt customization</h4>
            <p className={T.para}>
              The Haiku prompt used for theme generation can be customized in Settings &rarr; Prompts tab &rarr; "Theme color generation".
              This controls how the AI interprets your content and generates color palettes. Requires unlocking the prompts tab.
            </p>
          </div>
        </div>
      </section>
      </div>
      )}

      {/* ═══ IMAGE PROMPT GENERATION ═══ */}
      {helpPage === 'image-prompts' && (
      <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Image prompt generation</h3>
        <p className={T.lead}>
          The Image Prompt Generation system creates detailed AI image prompts for every visual asset defined in your slide outlines.
          Prompts are generated at export time and downloaded as a separate markdown file alongside your deck outline.
        </p>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>How it works</h4>
            <ul className={T.listLoose}>
              <li>• <span className={T.em}>Export-triggered:</span> Image prompts are ONLY generated when you click the export button with "Generate image prompts" enabled</li>
              <li>• <span className={T.em}>Asset extraction:</span> The system scans all slides and extracts visual assets from the &#9656; REQUIRED ASSETS section</li>
              <li>• <span className={T.em}>Logo/Icon skip:</span> Assets typed as Icon or Logo are automatically skipped since they represent existing brand assets</li>
              <li>• <span className={T.em}>Context-aware:</span> The AI uses your deck visual description, deck context, and slide content to create relevant prompts</li>
              <li>• <span className={T.em}>Model-specific:</span> Prompts are tailored to the syntax and best practices of your selected AI image model</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Using image prompts at export</h4>
            <ul className={T.listLoose}>
              <li>• <span className={T.em}>Step 1:</span> Open the Import/Export modal from the header</li>
              <li>• <span className={T.em}>Step 2:</span> Check "Generate image prompts"</li>
              <li>• <span className={T.em}>Step 3:</span> Select your target model from the dropdown (Midjourney, Flux, Nano Banana, or Chat GPT)</li>
              <li>• <span className={T.em}>Step 4:</span> Click the export button — your outline downloads first, then image prompts are generated and downloaded as a separate file</li>
              <li>• <span className={T.em}>Output file:</span> Downloaded as DECKNAME_IMG_PROMPTS.md</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Supported AI image models</h4>
            <ul className={T.listLoose}>
              <li>• <span className={T.em}>Midjourney:</span> Comma-separated descriptors, camera references, quality tags, v6 syntax</li>
              <li>• <span className={T.em}>Flux:</span> Natural language descriptions, text-in-image support, material textures</li>
              <li>• <span className={T.em}>Nano Banana:</span> Composition-focused, visual hierarchy emphasis</li>
              <li>• <span className={T.em}>Chat GPT / DALL-E:</span> Paragraph-style prompts, spatial relationships, DALL-E 3 optimized</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Output format</h4>
            <p className={T.paraSpaced}>
              The exported markdown file includes a header with the deck visual description, followed by assets grouped by slide:
            </p>
            <ul className={T.list}>
              <li>• <span className={T.em}>&#9656; ASSET TITLE:</span> Name and type of the visual asset</li>
              <li>• <span className={T.em}>&#9656; ASPECT RATIO:</span> Recommended dimensions for the asset</li>
              <li>• <span className={T.em}>&#9656; PROMPT:</span> Full AI-optimized image generation prompt</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Customizing image prompts</h4>
            <p className={T.para}>
              Image prompt system prompts can be customized in Settings &rarr; Prompts tab &rarr; "Visual assets system prompt" section.
              You can edit the shared rules (applied to all models), individual model-specific prompts, and the API system message.
              The output format template is editable in Settings &rarr; Format tab &rarr; "Image prompt export schema".
            </p>
          </div>
        </div>
      </section>
      </div>
      )}

      {/* ═══ VISUAL ASSET PLACEMENT ═══ */}
      {helpPage === 'asset-placement' && (
      <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Visual asset placement</h3>
        <p className={T.lead}>
          Visual Asset Placement allows you to embed your own uploaded images and videos directly into generated slide outlines.
          When enabled, the AI reviews your visual assets and assigns them to contextually matching slide frames. The visualizer then renders your actual images instead of placeholder boxes.
        </p>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>How to enable</h4>
            <ul className={T.listLoose}>
              <li>• <span className={T.em}>Use uploaded assets:</span> Check this box in Section 1 (next to Theme generator) to include images and videos you uploaded via the file upload area</li>
              <li>• <span className={T.em}>Use project assets:</span> Check this box to include visual assets stored in the currently selected project</li>
              <li>• <span className={T.em}>Both can be enabled simultaneously</span> — the system combines assets from both sources</li>
              <li>• <span className={T.em}>Non-destructive:</span> Unchecking both boxes returns the system to its default behavior with no side effects</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>How it works</h4>
            <ul className={T.listLoose}>
              <li>• <span className={T.em}>AI-driven placement:</span> The AI sees your uploaded assets and decides which frames they best match based on slide content and visual context</li>
              <li>• <span className={T.em}>Marker system:</span> Placed assets appear in the REQUIRED ASSETS section with a {"<<filename>>"} marker (e.g., {"<<hero_shot.jpg>>"}) that links the frame to your uploaded file</li>
              <li>• <span className={T.em}>Native aspect ratios:</span> The visualizer automatically detects each image's native dimensions and renders it at its true aspect ratio, ignoring any AI-specified ratio</li>
              <li>• <span className={T.em}>Unplaced frames:</span> Any frames that don't have a matching uploaded asset are shown as the usual placeholder boxes with image prompt descriptions</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Supported file types</h4>
            <ul className={T.listLoose}>
              <li>• <span className={T.em}>Images:</span> JPG, PNG, GIF, WebP, BMP, TIFF, SVG</li>
              <li>• <span className={T.em}>Videos:</span> MP4, MOV, WebM, AVI, MKV — displayed as auto-generated thumbnail frames with a play icon overlay</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Regeneration & editing</h4>
            <ul className={T.listLoose}>
              <li>• <span className={T.em}>Preserved on regeneration:</span> When you regenerate a page, placed asset markers are preserved automatically. The AI is instructed to keep existing {"<<filename>>"} entries verbatim</li>
              <li>• <span className={T.em}>Request specific placements:</span> Use the revision prompt to direct the AI, e.g., "use hero_shot.jpg for the main image" or "remove the team photo from this slide"</li>
              <li>• <span className={T.em}>Full deck mode:</span> Each asset is placed once across the entire deck — the AI distributes your uploads across slides where they contextually fit best</li>
              <li>• <span className={T.em}>Manual editing:</span> You can edit the raw markdown to add, remove, or change {"<<filename>>"} markers directly in text view</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Exporting with placed assets</h4>
            <ul className={T.listLoose}>
              <li>• <span className={T.em}>DECKOUTLINE.md / VIS_DECKOUTLINE.md:</span> The {"<<filename>>"} markers remain in the exported markdown for reference</li>
              <li>• <span className={T.em}>Export placed visual assets:</span> Check this option in the export modal to download all placed image/video files as individually numbered files (e.g., PROJECTNAME_VIS_ASSETS_01_hero.jpg)</li>
              <li>• <span className={T.em}>Image prompts:</span> When generating image prompts at export, frames with placed assets are automatically skipped — prompts are only generated for unplaced frames</li>
              <li>• <span className={T.em}>Export folder:</span> Use the Browse button in the export modal to select a custom output folder. The selected folder is remembered between sessions</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Tips</h4>
            <ul className={T.list}>
              <li>• Name your files descriptively — "product_hero.jpg" gives the AI better context for placement than "IMG_4521.jpg"</li>
              <li>• Upload the right number of images for your deck — if you have 10 slides with 2 frames each, 5-8 unique images works well</li>
              <li>• Use high-resolution images — the visualizer renders at the slide preview size, but exports will reference your original files</li>
              <li>• Combine with Image Prompts — placed assets fill matched frames, and Image Prompts generates prompts for the remaining unplaced frames</li>
            </ul>
          </div>
        </div>
      </section>
      </div>
      )}

      {/* ═══ SLIDE LAYOUTS ═══ */}
      {helpPage === 'layouts' && (
      <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Available slide layouts</h3>
        <p className={T.body}>
          15 layout types are available. Layouts with visual assets have maximum asset limits enforced by the system. Column layouts (2, 3, 4) feature dynamic image sizing that adjusts asset height based on text content volume.
        </p>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Column layouts — visual assets above text</h4>
            <p className={T.paraSpaced}>
              These layouts display visual assets in a row above the text columns. Asset height dynamically adjusts based on text content length — more text causes images to shrink, less text allows images to stay larger.
            </p>
            <ul className={T.listLoose}>
              <li>• <span className={T.emStrong}>Title and two columns</span> — Two side-by-side text columns with up to <span className={T.accentStrong}>4 visual assets</span> above. Columns separated by --- in copy content. Assets centered above matching column widths (1-2 images) or packed left (3-4 images).</li>
              <li>• <span className={T.emStrong}>Title and three columns</span> — Three text columns with up to <span className={T.accentStrong}>4 visual assets</span> above. Columns separated by --- dividers. Ideal for comparing three items, phases, or categories.</li>
              <li>• <span className={T.emStrong}>Title and four columns</span> — Four text columns with up to <span className={T.accentStrong}>4 visual assets</span> above. Columns separated by --- dividers. Best for process flows, phase breakdowns, or multi-category comparisons.</li>
            </ul>
            <div className={T.exampleWell}>
              <p className={T.hintPara}>
                <span className={T.accentStrong}>Dynamic sizing:</span> Image row height ranges from 30-57% of the content area depending on asset count and text length. Short text = larger images. Long text = smaller images. Aspect ratios are always preserved.
              </p>
            </div>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Single column & split layouts</h4>
            <ul className={T.listLoose}>
              <li>• <span className={T.emStrong}>One column text</span> — Text on the left with up to <span className={T.accentStrong}>3 visual assets</span> stacked on the right side, plus <span className={T.accentStrong}>1 timeline asset</span> if present (4 total). Assets span the full height of the content area.</li>
              <li>• <span className={T.emStrong}>Section title and description</span> — Up to <span className={T.accentStrong}>3 visual assets</span> fill the left half with the title/subtitle overlaid. The right half displays body text (bullets, numbered lists, paragraphs — no section headers).</li>
              <li>• <span className={T.emStrong}>Title and body</span> — Standard content slide with title, subtitle, and body text. Supports visual assets as background or inline references.</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Title-only layouts (no body text)</h4>
            <ul className={T.listLoose}>
              <li>• <span className={T.emStrong}>Title slide</span> — Centered title and subtitle. Used for opening slides and section transitions.</li>
              <li>• <span className={T.emStrong}>Section header</span> — Large divider text for breaking a deck into sections.</li>
              <li>• <span className={T.emStrong}>Title only</span> — Minimal slide with title and subtitle. Useful for visual-heavy slides where the image background is the focus.</li>
              <li>• <span className={T.emStrong}>Big number</span> — Large statistic or metric as the focal point with a supporting subtitle.</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Specialty layouts</h4>
            <ul className={T.listLoose}>
              <li>• <span className={T.emStrong}>Main point</span> — Emphasized key message with large centered text. Draws attention to a single important statement.</li>
              <li>• <span className={T.emStrong}>Caption</span> — Image-focused layout with minimal text overlay. Best for hero imagery, product shots, or cinematic moments.</li>
              <li>• <span className={T.emStrong}>Blank</span> — Empty layout for fully custom content arrangement.</li>
              <li>• <span className={T.emStrong}>Section Header w/Gradient</span> — Section header variant with a gradient background effect.</li>
              <li>• <span className={T.emStrong}>Title Page w/Gradient</span> — Title slide variant with a gradient background effect.</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Visual asset limits summary</h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-dense ml-2">
              <div className={T.quiet}>Title and two columns</div>
              <div className={T.accentStrong}>4 assets max</div>
              <div className={T.quiet}>Title and three columns</div>
              <div className={T.accentStrong}>4 assets max</div>
              <div className={T.quiet}>Title and four columns</div>
              <div className={T.accentStrong}>4 assets max</div>
              <div className={T.quiet}>One column text</div>
              <div className={T.accentStrong}>3 side + 1 timeline</div>
              <div className={T.quiet}>Section title and description</div>
              <div className={T.accentStrong}>3 assets max</div>
            </div>
            <p className={T.hintIndent}>
              Assets beyond these limits are not rendered in the visualizer. The AI is instructed to respect these limits when generating content.
            </p>
          </div>
        </div>
      </section>
      </div>
      )}

      {/* ═══ SETTINGS PANEL ═══ */}
      {helpPage === 'settings' && (
      <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Settings panel</h3>
        <p className={T.body}>
          The Settings panel (gear icon) contains all system prompts and output format schemas in collapsible dropdown sections.
          Each section has a title bar that expands/collapses the content and a "Reset to default" button.
        </p>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Prompts tab</h4>
            <ul className={T.list}>
              <li>• <span className={T.em}>Single page - API system message:</span> Core system instruction for single page generation</li>
              <li>• <span className={T.em}>Single page - generation rules:</span> Formatting rules and constraints for single page output</li>
              <li>• <span className={T.em}>Full deck - API system message:</span> Core system instruction for full deck generation</li>
              <li>• <span className={T.em}>Full deck - generation rules:</span> Formatting rules and constraints for full deck output</li>
              <li>• <span className={T.em}>Theme color generation:</span> System prompt for AI theme color generation</li>
              <li>• <span className={T.em}>AI rewrite prompts:</span> Customize the 5 rewrite modes (Relaxed, Formal, Extend, Shorten, Custom Editor)</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Visual assets system prompt</h4>
            <ul className={T.list}>
              <li>• <span className={T.em}>Shared rules (all models):</span> Common formatting rules for all image models</li>
              <li>• <span className={T.em}>Midjourney / Flux / Nano Banana / Chat GPT:</span> Model-specific prompt rules</li>
              <li>• <span className={T.em}>Image prompt - API system message:</span> Core instruction for the image prompt generation API call</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Format tab</h4>
            <ul className={T.list}>
              <li>• <span className={T.em}>Single page export schema:</span> Markdown structure for individual slide exports</li>
              <li>• <span className={T.em}>Full deck export schema:</span> Markdown structure for complete deck exports</li>
              <li>• <span className={T.em}>Visual deck export schema:</span> Read-only schema showing the VIS_DECKOUTLINE format structure</li>
              <li>• <span className={T.em}>Image prompt export schema:</span> Markdown structure for AI image prompt exports</li>
            </ul>
          </div>
        </div>
      </section>
      </div>
      )}

      {/* ═══ TIPS ═══ */}
      {helpPage === 'tips' && (
      <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Tips for best results</h3>
        <ul className={T.bodyList}>
          <li>• <span className={T.accent}>Be specific</span> in your deck context about tone, audience, and visual style preferences.</li>
          <li>• <span className={T.accent}>Use descriptive page requests</span> that reference specific content from your uploaded documents.</li>
          <li>• <span className={T.accent}>Review and edit</span> generated content in the text view before exporting.</li>
          <li>• <span className={T.accent}>Use the visualizer</span> to preview how your slide will look with different layouts and theme colors.</li>
          <li>• <span className={T.accent}>Enable "Theme generator"</span> for AI-powered color palettes that match your content.</li>
          <li>• <span className={T.accent}>Cycle themes</span> with arrow buttons to compare palettes before exporting.</li>
          <li>• <span className={T.accent}>Export with VIS format</span> to include theme colors and visual descriptions for downstream design tools.</li>
          <li>• <span className={T.accent}>For full decks</span>, include desired page count in your deck context (e.g., "Create a 10-slide presentation...").</li>
          <li>• <span className={T.accent}>Lock settings</span> after configuring to prevent accidental changes during your session.</li>
          <li>• <span className={T.accent}>Collapse settings sections</span> you don't need to keep the panel tidy.</li>
          <li>• <span className={T.accent}>Use AI rewrite</span> to quickly adjust tone — select text, right-click, and choose a rewrite mode.</li>
          <li>• <span className={T.accent}>Generate image prompts</span> at export time to get model-specific prompts for all visual assets in your deck.</li>
          <li>• <span className={T.accent}>Column layouts support up to 4 images</span> — Two, three, and four column layouts can display up to 4 visual assets above the text columns. Images are dynamically sized based on text length.</li>
          <li>• <span className={T.accent}>Use --- separators</span> in column layouts — The AI separates column content with --- dividers. Each section becomes one column.</li>
          <li>• <span className={T.accent}>Match image count to columns</span> — For the best visual balance in column layouts, request one image per column (e.g., 3 images for three columns).</li>
          <li>• <span className={T.accent}>Control image sizes with text length</span> — In column layouts, adding more bullet points causes images to shrink dynamically. Use shorter text for larger images.</li>
          <li>• <span className={T.accent}>Place your own images</span> — Enable "Use uploaded assets" or "Use project assets" to have the AI embed your images directly into slide frames.</li>
          <li>• <span className={T.accent}>Name image files descriptively</span> — "product_hero.jpg" gives the AI much better context for placement than "IMG_4521.jpg".</li>
          <li>• <span className={T.accent}>Set an export folder</span> — Use the Browse button in the export modal to save files directly to a specific folder instead of the browser's downloads.</li>
          <li>• <span className={T.accent}>Include contact info</span> in your Deck Context prompt — emails and contact details from both source documents and the deck context are included in OUTRO slides.</li>
          <li>• <span className={T.accent}>Use the formatting toolbar</span> for quick markdown formatting — bold, italic, bullets, and numbered lists.</li>
        </ul>
      </section>

      <section className={T.notesBox}>
        <h3 className={T.sectionTitleTight}>Important notes</h3>
        <ul className={T.bodyList}>
          <li>• Modifying system prompts incorrectly may cause parsing errors or unexpected output formats.</li>
          <li>• Always use "Reset to default" if you encounter issues after editing prompts.</li>
          <li>• The &#9656; markers and ═══ delimiters are required for the system to parse slides correctly.</li>
          <li>• Changes to prompts and formats are applied immediately but are not persisted between sessions.</li>
          <li>• Theme generation requires an active API connection. The refresh button spins orange while generating.</li>
          <li>• Visual Deck Export Schema is read-only and cannot be edited — it reflects the fixed VIS_DECKOUTLINE format.</li>
          <li>• VISUAL STYLING sections in slide outlines intentionally exclude color references — colors are handled by the theme system.</li>
          <li>• Column layouts (2, 3, 4) enforce a maximum of 4 visual assets. One column text supports 3 side assets + 1 timeline. Section title and description supports up to 3 assets. Extra assets beyond these limits are not displayed.</li>
        </ul>
      </section>
      </div>
      )}

      {/* ═══ DOWNLOAD SLIDES EXTENSION ═══ */}
      {helpPage === 'slides-extension' && (
      <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Download Slides extension</h3>
        <p className={T.lead}>
          The D.O.G. Bridge is a Google Slides Apps Script extension that reads your exported VIS_DECKOUTLINE markdown files and programmatically builds
          Google Slides decks with precise coordinate-based placement. It bridges the gap between D.O.G.'s outline generation and your final presentation.
        </p>

        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>What it does</h4>
            <ul className={T.listLoose}>
              <li>• <span className={T.em}>Parses DECKOUTLINE and VIS_DECKOUTLINE</span> markdown files into structured slide data</li>
              <li>• <span className={T.em}>Creates slides</span> with matched layout templates from your Google Slides theme</li>
              <li>• <span className={T.em}>Positions text boxes</span> using COMPONENT GEOMETRY coordinates for pixel-perfect placement</li>
              <li>• <span className={T.em}>Injects formatted text</span> with bold, bullets, numbered lists, and section headers</li>
              <li>• <span className={T.em}>Applies theme colors</span> from your VIS_DECKOUTLINE to backgrounds, titles, subtitles, and body text</li>
              <li>• <span className={T.em}>Creates asset placeholder frames</span> for images, videos, infographics, and timelines</li>
              <li>• <span className={T.em}>Places images from Google Drive</span> folders with fuzzy name matching</li>
            </ul>
          </div>

          <div className={T.card}>
            <h4 className={T.cardTitle}>Installation steps</h4>
            <ol className={T.listLoose}>
              <li><span className={T.accentStrong}>1.</span> Download both files below (<span className={T.em}>Code.gs</span> and <span className={T.em}>Sidebar.html</span>)</li>
              <li><span className={T.accentStrong}>2.</span> Open a Google Slides presentation</li>
              <li><span className={T.accentStrong}>3.</span> Go to <span className={T.em}>Extensions</span>, then <span className={T.em}>Apps Script</span></li>
              <li><span className={T.accentStrong}>4.</span> Replace the default Code.gs content with the downloaded <span className={T.em}>Code.gs</span> file</li>
              <li><span className={T.accentStrong}>5.</span> Click the <span className={T.em}>+</span> next to Files, select <span className={T.em}>HTML</span>, name it <span className={T.em}>Sidebar</span>, and paste the <span className={T.em}>Sidebar.html</span> content</li>
              <li><span className={T.accentStrong}>6.</span> Save and close the Apps Script editor</li>
              <li><span className={T.accentStrong}>7.</span> Refresh your Google Slides — a new <span className={T.em}>"D.O.G. Bridge"</span> menu item will appear</li>
            </ol>
          </div>

          <div className={T.card}>
            <h4 className={T.cardTitle}>Download files</h4>
            <div className="space-y-2">
              <a
                href="./extensions/Code.gs"
                download="Code.gs"
                className={T.download}
              >
                <span className={T.glyph}>&#8595;</span>
                <div>
                  <span className={T.label}>Code.gs</span>
                  <span className={T.caption}>Server-side Apps Script</span>
                </div>
              </a>
              <a
                href="./extensions/Sidebar.html"
                download="Sidebar.html"
                className={T.download}
              >
                <span className={T.glyph}>&#8595;</span>
                <div>
                  <span className={T.label}>Sidebar.html</span>
                  <span className={T.caption}>Sidebar UI interface</span>
                </div>
              </a>
            </div>
          </div>

          <div className={T.card}>
            <h4 className={T.cardTitle}>Features</h4>
            <ul className={T.list}>
              <li>• <span className={T.em}>Full Deck or Single Page mode</span> — Build the entire deck or replace a single slide</li>
              <li>• <span className={T.em}>Theme color application</span> — Applies background, accent, secondary, and body text colors from your outline</li>
              <li>• <span className={T.em}>Coordinate-based text positioning</span> — Uses COMPONENT GEOMETRY JSON for precise element placement</li>
              <li>• <span className={T.em}>Asset placeholder creation</span> — Gray, outlined, or transparent placeholder frames for visual assets</li>
              <li>• <span className={T.em}>Auto-shrink text to fit</span> — Automatically reduces font size when text overflows its box</li>
              <li>• <span className={T.em}>Header/footer with date format detection</span> — Sets project name, date, and slide numbers from your theme's format</li>
              <li>• <span className={T.em}>Drive folder asset matching</span> — Fuzzy-matches uploaded images to placeholder frames by description</li>
              <li>• <span className={T.em}>Configurable settings</span> — Font sizes, placeholder styles, date formats, and debug mode</li>
            </ul>
          </div>
        </div>
      </section>
      </div>
      )}
      </div>
    </>
  );
}
