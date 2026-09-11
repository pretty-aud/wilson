import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { ICON } from '../ui/tokens'
import { DOG_HELP_SIDEBAR_ITEMS, DogHelpContent } from '../data/dogHelpContent'
import { OTTER_HELP_SIDEBAR_ITEMS, OtterHelpContent } from '../data/otterHelpContent'

const TOOL_SECTIONS = [
  { id: 'dog', label: 'D.O.G.', subtitle: 'Deck Outline Generator' },
  { id: 'otter', label: 'O.T.T.E.R.', subtitle: 'Training & Education Platform' },
  { id: 'project-manager', label: 'Project Manager', subtitle: 'Project & Asset Management' },
  { id: 'wilson', label: 'Wilson', subtitle: 'Application Overview' },
]

const PM_ITEMS = [
  { id: 'pm-overview', label: 'Overview' },
  { id: 'pm-projects', label: 'Managing Projects' },
  { id: 'pm-assets', label: 'Documents & Assets' },
]

const WILSON_ITEMS = [
  { id: 'wilson-overview', label: 'About Wilson' },
  { id: 'wilson-navigation', label: 'Navigation' },
  { id: 'wilson-companion', label: 'Pet Companion' },
  { id: 'wilson-settings', label: 'System Settings' },
]

// Light-surface text roles for the content area (HELP-03, HELP-06).
//
// Every value here is a Tailwind utility generated from the `@theme` block in
// index.css — the same values `src/ui/tokens.js` exports by name. There is no
// hex, no rgba and no off-scale size in this object, because this object is
// the worked example other light pages copy.
//
// ONE ink. On `ground-light` the only legible ink is `ink-light` (8.48:1);
// white is 2.06:1 and a grey is worse than both. Hierarchy comes from the
// scale and from weight, never from a second colour — which is why the old
// `listMuted` (stone-600, 3.70:1) is gone rather than retinted: it was a grey
// by another name.
//
// Every key below has at least one call site in this file. `mono`, `notesBox`
// and `notesTitle` were carried here with no caller and have been deleted: a
// worked example that ships three roles nothing renders teaches three roles
// nothing renders, and `notesBox`/`notesTitle` were byte-identical to
// `card`/`cardTitle` anyway. A notes callout takes `card`.
const L = {
  // H2 — 16 / 600 / sentence case / zero tracking
  sectionTitle: 'text-h2 text-ink-light mb-3',
  // Body — 14 / 400 / leading 1.5
  bodyText: 'text-body text-ink-light',
  // A well, not a white card (C9): ground + one hairline + the control radius
  card: 'bg-well-light border border-rule-light rounded-control p-3',
  // H3 — 14 / 600 / sentence case
  cardTitle: 'text-h3 text-ink-light mb-2',
  // Dense — 13 / 400
  listItem: 'text-dense text-ink-light',
  // Emphasis inside a list item: weight only, same ink
  listBold: 'font-semibold',
  // The lists themselves: real markers in their own column (HELP-05)
  list: 'list-disc pl-5 space-y-1',
}

export default function HelpPage() {
  const [expandedTool, setExpandedTool] = useState('dog')
  const [activePage, setActivePage] = useState('overview')

  const toggleTool = (toolId) => {
    if (expandedTool === toolId) {
      setExpandedTool(null)
    } else {
      setExpandedTool(toolId)
      if (toolId === 'dog') setActivePage('overview')
      else if (toolId === 'otter') setActivePage('otter-overview')
      else if (toolId === 'project-manager') setActivePage('pm-overview')
      else if (toolId === 'wilson') setActivePage('wilson-overview')
    }
  }

  const getSidebarItems = (toolId) => {
    if (toolId === 'dog') return DOG_HELP_SIDEBAR_ITEMS
    if (toolId === 'otter') return OTTER_HELP_SIDEBAR_ITEMS
    if (toolId === 'project-manager') return PM_ITEMS
    if (toolId === 'wilson') return WILSON_ITEMS
    return []
  }

  return (
    // `data-surface="light"` is what makes the global :focus-visible ring
    // resolve to ink-light here. Without it the ring is the signal orange on
    // an orange page, which is 1.0:1 — a focus indicator nobody can see.
    // `wilson-light-scroll` replaces the two DIFFERENT inline scrollbar
    // treatments this page used to carry (white-alpha on the sidebar,
    // black-alpha on the content pane) with the one the light pages share.
    <div className="h-full w-full flex overflow-hidden wilson-light-scroll" data-surface="light">
        {/* ===== SIDEBAR =====
            No ground of its own: it sits on the page's orange and is separated
            by a single hairline, like every other panel in the system. The
            brown well and its seven alpha-whites are gone (HELP-04). */}
        <nav
          className="flex-shrink-0 overflow-y-auto flex flex-col border-r border-rule-light"
          style={{ width: '200px' }}
        >
          {/* Tool Sections */}
          <div className="flex-1 overflow-y-auto pt-1">
            {TOOL_SECTIONS.map(tool => {
              const isExpanded = expandedTool === tool.id
              const items = getSidebarItems(tool.id)
              const panelId = `help-pages-${tool.id}`
              return (
                <div key={tool.id}>
                  {/* Tool Toggle Header. Hover is `hover-light`, the expanded
                      state is `well-light`, and the hover is scoped to
                      collapsed so a transient state and a persistent one never
                      share a fill — a well is a surface, a hover is a state.
                      That split is worth keeping for what it means, and the
                      baseline drew the same two values by hand
                      (`rgba(0,0,0,0.06)` / `rgba(0,0,0,0.1)`, via the
                      `e.currentTarget.style` handlers this session removed).

                      🚨 R2: it buys almost nothing to the eye, and round 1's
                      note here read as if it did. The honest figure is the one
                      nobody had measured — the two fills against EACH OTHER:

                        hover-light over the ground  #e3975b
                        well-light  over the ground  #de9155
                        the two vs each other        1.07:1   (baseline: 1.08:1)

                      1.15:1 and 1.23:1 are each fill against the ground, which
                      is the comparison a user never makes. So a hovered
                      collapsed header and an open one are still all but the
                      same colour. What actually separates them is the
                      ChevronDown/ChevronRight swap at 8.48:1 — the standard
                      disclosure signal, present before this session and after
                      it — plus `aria-expanded` for anyone not looking.

                      Not fixed here, and deliberately: the second signal the
                      sub-items use is weight, and this header's label is
                      already `font-semibold` in BOTH states, so adding it means
                      demoting the collapsed header rather than promoting the
                      open one. The remaining options — a 2px `ink-light` left
                      edge like the sub-items, or dropping the header hover and
                      letting the chevron carry it alone — are both new marks on
                      this surface rather than restorations, so they belong in
                      the walkthrough as a question, not in this pass. */}
                  <button
                    onClick={() => toggleTool(tool.id)}
                    data-state={isExpanded ? 'expanded' : 'collapsed'}
                    aria-expanded={isExpanded}
                    aria-controls={isExpanded ? panelId : undefined}
                    className="w-full text-left px-3 py-2.5 flex items-center gap-2 border-b border-rule-light transition-colors duration-state data-[state=collapsed]:hover:bg-hover-light data-[state=expanded]:bg-well-light"
                  >
                    {/* Decorative: `aria-expanded` above carries this state now */}
                    {isExpanded
                      ? <ChevronDown size={ICON.sm} aria-hidden="true" className="text-ink-light flex-shrink-0" />
                      : <ChevronRight size={ICON.sm} aria-hidden="true" className="text-ink-light flex-shrink-0" />
                    }
                    <span className="flex flex-col min-w-0">
                      <span className="text-dense font-semibold text-ink-light">
                        {tool.label}
                      </span>
                      {/* HELP-07: the subtitle the file already defines, finally rendered */}
                      <span className="text-caption text-ink-light">
                        {tool.subtitle}
                      </span>
                    </span>
                  </button>

                  {/* Expanded Sub-items — the selected page is carried by three
                      signals: the `well-light` fill, the 2px `ink-light` edge and
                      weight 600. The edge was `signal`, which is 1.73:1 on this
                      orange ground (1.40:1 once hovered) — below WCAG 1.4.11's
                      3:1 for a non-text indicator, i.e. a marker nobody can see.
                      `ink-light` is 8.48:1 and is the one ink this surface has;
                      it still reads as an edge rather than as text because it is
                      2px and vertical. Same decision as WorkspaceSwitcher's
                      `border-ink-light` active row on the same ground.
                      Hover is `hover-light` and is scoped to idle rows, so a
                      transient state and a persistent one never share a fill. */}
                  {isExpanded && (
                    <div id={panelId}>
                      {items.map(item => (
                        <button
                          key={item.id}
                          onClick={() => setActivePage(item.id)}
                          data-state={activePage === item.id ? 'active' : 'idle'}
                          aria-current={activePage === item.id ? 'page' : undefined}
                          className="w-full text-left py-1.5 pl-6 pr-2 text-dense text-ink-light border-l-2 border-l-transparent transition-colors duration-state data-[state=idle]:font-normal data-[state=idle]:hover:bg-hover-light data-[state=active]:font-semibold data-[state=active]:bg-well-light data-[state=active]:border-l-ink-light"
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Version footer — Label step, full ink, mono because a version is data */}
          <div className="px-3 py-2 flex-shrink-0 border-t border-rule-light">
            <span className="text-label font-mono text-ink-light">
              {typeof __WILSON_VERSION__ !== 'undefined' ? __WILSON_VERSION__ : 'v?'}
            </span>
          </div>
        </nav>

        {/* ===== CONTENT AREA ===== */}
        <div className="flex-1 overflow-y-auto p-6 bg-ground-light">
          {/* D.O.G. and O.T.T.E.R. render at the pane's full width, exactly as
              they did before this session. They come from `src/data/` and are
              lane A's; the measure cap below deliberately stops short of them
              because one of them lays out a two-column grid that 72ch would
              halve, and nobody has looked at those 880 lines. Lane A should
              adopt the same cap when it restyles them. */}

          {/* D.O.G. Help Content — light theme */}
          {expandedTool === 'dog' && (
            <DogHelpContent helpPage={activePage} theme="light" />
          )}

          {/* O.T.T.E.R. Help Content */}
          {expandedTool === 'otter' && (
            <OtterHelpContent helpPage={activePage} />
          )}

          {/* HELP-01: one measure cap for the prose this page owns — the
              Project Manager and Wilson sections. Cards and lists inherit it;
              none sets its own. */}
          <div style={{ maxWidth: 'var(--measure-prose-max)' }}>
          {/* Project Manager Help Content */}
          {expandedTool === 'project-manager' && activePage === 'pm-overview' && (
            <div className="space-y-5">
              <section>
                <h3 className={L.sectionTitle}>Project Manager Overview</h3>
                <p className={`${L.bodyText} mb-4`}>
                  The Project Manager lets you organize your presentation work into discrete projects.
                  Each project stores its own documents, visual assets, dates, and descriptions — keeping everything organized across multiple concurrent presentations.
                </p>
                <div className="space-y-3">
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Key Features</h4>
                    <ul className={`${L.listItem} ${L.list}`}>
                      <li><span className={L.listBold}>Multiple projects</span> — Create and manage separate projects with their own documents and assets</li>
                      <li><span className={L.listBold}>Document storage</span> — Upload PDFs, text files, markdown, and other source materials per project</li>
                      <li><span className={L.listBold}>Visual asset library</span> — Store images and videos that can be used for visual asset placement in D.O.G.</li>
                      <li><span className={L.listBold}>Date tracking</span> — Set start and end dates for project timelines</li>
                      <li><span className={L.listBold}>Persistent storage</span> — Projects are saved locally using IndexedDB for large file support</li>
                    </ul>
                  </div>
                </div>
              </section>
            </div>
          )}

          {expandedTool === 'project-manager' && activePage === 'pm-projects' && (
            <div className="space-y-5">
              <section>
                <h3 className={L.sectionTitle}>Managing Projects</h3>
                <div className="space-y-3">
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Creating a Project</h4>
                    <ul className={`${L.listItem} ${L.list}`}>
                      <li><span className={L.listBold}>Click the + button</span> in the project list to create a new project</li>
                      <li><span className={L.listBold}>Set a descriptive title</span> that identifies the presentation or campaign</li>
                      <li><span className={L.listBold}>Add a description</span> with project scope, goals, or notes for reference</li>
                      <li><span className={L.listBold}>Set project dates</span> to track deadlines and timelines</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Using Projects with D.O.G.</h4>
                    <ul className={`${L.listItem} ${L.list}`}>
                      <li><span className={L.listBold}>Select a project</span> in D.O.G. to load its documents and assets into the generation context</li>
                      <li><span className={L.listBold}>Enable "Use Project Assets"</span> to let the AI place project images into slide frames</li>
                      <li><span className={L.listBold}>Project documents</span> are automatically included as context alongside any directly uploaded files</li>
                    </ul>
                  </div>
                </div>
              </section>
            </div>
          )}

          {expandedTool === 'project-manager' && activePage === 'pm-assets' && (
            <div className="space-y-5">
              <section>
                <h3 className={L.sectionTitle}>Documents & Visual Assets</h3>
                <div className="space-y-3">
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Documents</h4>
                    <ul className={`${L.listItem} ${L.list}`}>
                      <li><span className={L.listBold}>Supported formats:</span> PDF, DOC, DOCX, TXT, MD, CSV, XLSX</li>
                      <li><span className={L.listBold}>Upload via drag-and-drop</span> or click the upload area in the project detail view</li>
                      <li><span className={L.listBold}>Documents are stored locally</span> using IndexedDB for larger file support</li>
                      <li><span className={L.listBold}>Remove documents</span> by clicking the X button next to each file</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Visual Assets</h4>
                    <ul className={`${L.listItem} ${L.list}`}>
                      <li><span className={L.listBold}>Supported image formats:</span> JPG, PNG, GIF, WebP, BMP, TIFF, SVG</li>
                      <li><span className={L.listBold}>Supported video formats:</span> MP4, MOV, WebM, AVI, MKV</li>
                      <li><span className={L.listBold}>Name files descriptively</span> for better AI-driven placement (e.g., "product_hero.jpg" not "IMG_4521.jpg")</li>
                      <li><span className={L.listBold}>Storage limits:</span> Large assets are stored in IndexedDB. A warning appears when storage is running low</li>
                    </ul>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* Wilson App Help Content */}
          {expandedTool === 'wilson' && activePage === 'wilson-overview' && (
            <div className="space-y-5">
              <section>
                <h3 className={L.sectionTitle}>About Wilson</h3>
                <p className={`${L.bodyText} mb-4`}>
                  Wilson is a desktop application container that hosts creative production tools. It provides a unified interface for managing projects
                  and running AI-powered generation workflows. The app is built with Electron and runs locally on your machine.
                </p>
                <div className="space-y-3">
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Included Tools</h4>
                    <ul className={`${L.listItem} ${L.list}`}>
                      <li><span className={L.listBold}>D.O.G. (Deck Outline Generator)</span> — AI-powered slide outline generation with theme colors, image prompts, and a live visualizer</li>
                      <li><span className={L.listBold}>O.T.T.E.R. (Training & Education)</span> — AI-powered learning platform for software, shortcuts, and coding languages</li>
                      <li><span className={L.listBold}>Project Manager</span> — Organize documents, visual assets, and metadata for multiple projects</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Technical Details</h4>
                    <ul className={`${L.listItem} ${L.list}`}>
                      <li><span className={L.listBold}>Platform:</span> Electron desktop application (Windows)</li>
                      <li><span className={L.listBold}>Storage:</span> Workspace data lives in your company's cloud workspace; per-machine preferences stay local</li>
                      <li><span className={L.listBold}>AI:</span> Included with your workspace sign-in — requests route through your workspace's secure AI service, no API key to configure</li>
                      <li><span className={L.listBold}>Storage:</span> Uses localStorage and IndexedDB for project data and settings</li>
                    </ul>
                  </div>
                </div>
              </section>
            </div>
          )}

          {expandedTool === 'wilson' && activePage === 'wilson-navigation' && (
            <div className="space-y-5">
              <section>
                <h3 className={L.sectionTitle}>Navigation</h3>
                <div className="space-y-3">
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Home Screen</h4>
                    <ul className={`${L.listItem} ${L.list}`}>
                      <li><span className={L.listBold}>The home screen</span> is the central hub with buttons for each tool and System Settings</li>
                      <li><span className={L.listBold}>Use arrow keys</span> to navigate between buttons, press Enter to select</li>
                      <li><span className={L.listBold}>Help page</span> is accessible from the home screen below System Settings</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Navigation Menu</h4>
                    <ul className={`${L.listItem} ${L.list}`}>
                      <li><span className={L.listBold}>Hamburger menu</span> — Available on all non-home pages via the icon in the top-right</li>
                      <li><span className={L.listBold}>Quick access</span> to HOME, other tools, and System Settings from any page</li>
                      <li><span className={L.listBold}>Click outside</span> the nav strip to dismiss it</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Page Transitions</h4>
                    <p className={L.bodyText}>
                      Navigating between pages triggers an animated transition: the content fades out, orange bars compress to the center revealing the destination page title, then expand to reveal the new page. This creates a smooth, branded experience between tools.
                    </p>
                  </div>
                </div>
              </section>
            </div>
          )}

          {expandedTool === 'wilson' && activePage === 'wilson-companion' && (
            <div className="space-y-5">
              <section>
                <h3 className={L.sectionTitle}>Pet Companion</h3>
                <p className={`${L.bodyText} mb-4`}>
                  Your AI pet companion is visible on every page in Wilson. It combines a Tamagotchi-style virtual pet
                  with an AI chat assistant powered by Claude, providing a study buddy and creative helper across all tools.
                </p>
                <div className="space-y-3">
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Interacting with Your Pet</h4>
                    <ul className={`${L.listItem} ${L.list}`}>
                      <li><span className={L.listBold}>Click the sprite</span> (bottom-right corner) to open/close the chat window</li>
                      <li><span className={L.listBold}>Press Enter</span> to toggle the chat window (when not typing in an input)</li>
                      <li><span className={L.listBold}>Feed button</span> — Restores hunger (available when pet mode is on and pet is alive)</li>
                      <li><span className={L.listBold}>Pet button</span> — Increases happiness and shows affection</li>
                      <li><span className={L.listBold}>Thumbs up/down</span> — Rate AI responses to help the companion learn your preferences</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Pet Lifecycle</h4>
                    <ul className={`${L.listItem} ${L.list}`}>
                      <li><span className={L.listBold}>Egg</span> — Your pet starts as an egg. Pet it 2-4 times to hatch</li>
                      <li><span className={L.listBold}>Baby</span> — Hatches with a random breed and gender. Smaller sprite. Evolves over time</li>
                      <li><span className={L.listBold}>Adult</span> — Fully grown. Needs regular feeding and attention to stay happy</li>
                      <li><span className={L.listBold}>Corpse → Ghost</span> — If hunger reaches 0, the pet dies. A ghost appears</li>
                      <li><span className={L.listBold}>New egg</span> — When your pet is a ghost, you can create a new egg from System Settings</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>8 Pet Breeds</h4>
                    <ul className={`${L.listItem} ${L.list}`}>
                      <li><span className={L.listBold}>Otter, Bird, Octopus, Blob, Rabbit, Pig, Monkey</span> — 14% chance each</li>
                      <li><span className={L.listBold}>Demon</span> — Rare breed with only a 2% chance of hatching</li>
                      <li>Breed is randomly assigned at hatch time and cannot be changed</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Pet States & Moods</h4>
                    <ul className={`${L.listItem} ${L.list}`}>
                      <li><span className={L.listBold}>Content</span> — Default happy state when well-fed and recently petted</li>
                      <li><span className={L.listBold}>Hungry</span> — Hunger dropping below 40%. Feed to fix</li>
                      <li><span className={L.listBold}>Starving</span> — Hunger below 15%. Feed urgently or pet will die</li>
                      <li><span className={L.listBold}>Lonely</span> — Happiness dropped too low. Pet or chat to restore</li>
                      <li><span className={L.listBold}>Sleeping</span> — Pet sleeps periodically. Cannot feed during sleep</li>
                      <li><span className={L.listBold}>Happy</span> — Temporarily shown after feeding or petting</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Pet Mode & Settings</h4>
                    <ul className={`${L.listItem} ${L.list}`}>
                      <li><span className={L.listBold}>Pet Mode ON</span> — Full Tamagotchi experience with hunger, sleep, mood, and lifecycle</li>
                      <li><span className={L.listBold}>Pet Mode OFF</span> — Companion is a helper-only chatbot with no mechanics</li>
                      <li><span className={L.listBold}>Difficulty (Low/Medium/High)</span> — Controls how fast hunger and happiness decay</li>
                      <li><span className={L.listBold}>All pet settings</span> are in System Settings under the "Companion" section</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Dream Cloud & Animations</h4>
                    <ul className={`${L.listItem} ${L.list}`}>
                      <li>A thought bubble appears above the sprite showing its current mood</li>
                      <li><span className={L.listBold}>Hearts</span> when content or happy, <span className={L.listBold}>sad face</span> when hungry/lonely</li>
                      <li><span className={L.listBold}>Zzz</span> when sleeping — the sprite bobs slowly</li>
                      <li>The sprite slides out during page transitions and slides back in when the new page loads</li>
                    </ul>
                  </div>
                </div>
              </section>
            </div>
          )}

          {expandedTool === 'wilson' && activePage === 'wilson-settings' && (
            <div className="space-y-5">
              <section>
                <h3 className={L.sectionTitle}>System Settings</h3>
                <div className="space-y-3">
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>AI Features</h4>
                    <ul className={`${L.listItem} ${L.list}`}>
                      <li><span className={L.listBold}>Included with sign-in</span> — generation, theme colors, image prompts and rewrites work as soon as you're signed in to your workspace</li>
                      <li><span className={L.listBold}>No API key</span> — access is managed by your workspace admins, not per-user keys</li>
                      <li><span className={L.listBold}>Shared across tools</span> — D.O.G., O.T.T.E.R. and R.A.B.B.I.T. all use the same workspace AI access</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Password</h4>
                    <ul className={`${L.listItem} ${L.list}`}>
                      <li><span className={L.listBold}>Managed by your workspace account</span> — not stored in the app</li>
                      <li><span className={L.listBold}>Reset it</span> with "Forgot password" on the sign-in screen, or ask a workspace admin</li>
                      <li><span className={L.listBold}>No separate launch password</span> — signing in to your workspace is the only gate</li>
                    </ul>
                  </div>
                </div>
              </section>
            </div>
          )}
          </div>
        </div>
    </div>
  )
}
