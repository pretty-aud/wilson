import { useState } from 'react'
import { ChevronDown, ChevronRight, HelpCircle } from 'lucide-react'
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

// Light-theme style tokens for content area
const L = {
  sectionTitle: 'text-sm font-bold text-stone-900 uppercase tracking-wide mb-3',
  bodyText: 'text-xs text-stone-800 leading-relaxed',
  card: 'bg-white/40 p-3 rounded-sm border border-stone-400/30',
  cardTitle: 'text-xs font-bold text-stone-900 mb-2',
  listItem: 'text-[11px] text-stone-700 leading-relaxed',
  listBold: 'text-stone-900',
  listMuted: 'text-[11px] text-stone-600 leading-relaxed',
  mono: 'text-[10px] text-stone-600 bg-white/30 p-2 rounded font-mono leading-relaxed',
  notesBox: 'bg-orange-600/10 border border-orange-600/30 rounded-sm p-3',
  notesTitle: 'text-xs font-bold text-stone-900 uppercase tracking-wide mb-2',
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
    <div className="h-full w-full flex overflow-hidden">
        {/* ===== SIDEBAR ===== */}
        <nav
          className="flex-shrink-0 overflow-y-auto flex flex-col"
          style={{
            width: '200px',
            backgroundColor: 'rgba(120, 70, 30, 0.55)',
            borderRight: '1px solid rgba(0,0,0,0.1)',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,0.2) transparent',
          }}
        >
          {/* Tool Sections */}
          <div className="flex-1 overflow-y-auto pt-1">
            {TOOL_SECTIONS.map(tool => {
              const isExpanded = expandedTool === tool.id
              const items = getSidebarItems(tool.id)
              return (
                <div key={tool.id}>
                  {/* Tool Toggle Header */}
                  <button
                    onClick={() => toggleTool(tool.id)}
                    className="w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors"
                    style={{
                      borderBottom: '1px solid rgba(0,0,0,0.08)',
                      backgroundColor: isExpanded ? 'rgba(0,0,0,0.1)' : 'transparent',
                    }}
                    onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.06)' }}
                    onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.backgroundColor = 'transparent' }}
                  >
                    {isExpanded
                      ? <ChevronDown className="w-3 h-3 text-white flex-shrink-0" />
                      : <ChevronRight className="w-3 h-3 text-white/50 flex-shrink-0" />
                    }
                    <span className={`text-[11px] font-bold uppercase tracking-wider ${isExpanded ? 'text-white' : 'text-white/70'}`}>
                      {tool.label}
                    </span>
                  </button>

                  {/* Expanded Sub-items */}
                  {isExpanded && (
                    <div style={{ backgroundColor: 'rgba(0,0,0,0.12)' }}>
                      {items.map(item => (
                        <button
                          key={item.id}
                          onClick={() => setActivePage(item.id)}
                          className="w-full text-left py-1.5 text-[11px] transition-colors"
                          style={{
                            paddingLeft: '24px',
                            paddingRight: '8px',
                            color: activePage === item.id ? '#fff' : 'rgba(255,255,255,0.55)',
                            fontWeight: activePage === item.id ? 'bold' : 'normal',
                            borderLeft: activePage === item.id ? '2px solid #fff' : '2px solid transparent',
                            backgroundColor: activePage === item.id ? 'rgba(0,0,0,0.1)' : 'transparent',
                          }}
                          onMouseEnter={(e) => { if (activePage !== item.id) { e.currentTarget.style.color = 'rgba(255,255,255,0.8)'; e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.06)' } }}
                          onMouseLeave={(e) => { if (activePage !== item.id) { e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; e.currentTarget.style.backgroundColor = 'transparent' } }}
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

          {/* Version footer */}
          <div className="px-3 py-2 flex-shrink-0" style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}>
            <span className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {typeof __WILSON_VERSION__ !== 'undefined' ? __WILSON_VERSION__ : 'v?'}
            </span>
          </div>
        </nav>

        {/* ===== CONTENT AREA ===== */}
        <div
          className="flex-1 overflow-y-auto p-6"
          style={{
            backgroundColor: '#f4a261',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(0,0,0,0.15) transparent',
          }}
        >
          {/* D.O.G. Help Content — light theme */}
          {expandedTool === 'dog' && (
            <DogHelpContent helpPage={activePage} theme="light" />
          )}

          {/* O.T.T.E.R. Help Content */}
          {expandedTool === 'otter' && (
            <OtterHelpContent helpPage={activePage} />
          )}

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
                    <ul className={`${L.listItem} space-y-1 ml-2`}>
                      <li>• <span className={L.listBold}>Multiple projects</span> — Create and manage separate projects with their own documents and assets</li>
                      <li>• <span className={L.listBold}>Document storage</span> — Upload PDFs, text files, markdown, and other source materials per project</li>
                      <li>• <span className={L.listBold}>Visual asset library</span> — Store images and videos that can be used for visual asset placement in D.O.G.</li>
                      <li>• <span className={L.listBold}>Date tracking</span> — Set start and end dates for project timelines</li>
                      <li>• <span className={L.listBold}>Persistent storage</span> — Projects are saved locally using IndexedDB for large file support</li>
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
                    <ul className={`${L.listItem} space-y-1 ml-2`}>
                      <li>• <span className={L.listBold}>Click the + button</span> in the project list to create a new project</li>
                      <li>• <span className={L.listBold}>Set a descriptive title</span> that identifies the presentation or campaign</li>
                      <li>• <span className={L.listBold}>Add a description</span> with project scope, goals, or notes for reference</li>
                      <li>• <span className={L.listBold}>Set project dates</span> to track deadlines and timelines</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Using Projects with D.O.G.</h4>
                    <ul className={`${L.listItem} space-y-1 ml-2`}>
                      <li>• <span className={L.listBold}>Select a project</span> in D.O.G. to load its documents and assets into the generation context</li>
                      <li>• <span className={L.listBold}>Enable "Use Project Assets"</span> to let the AI place project images into slide frames</li>
                      <li>• <span className={L.listBold}>Project documents</span> are automatically included as context alongside any directly uploaded files</li>
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
                    <ul className={`${L.listItem} space-y-1 ml-2`}>
                      <li>• <span className={L.listBold}>Supported formats:</span> PDF, DOC, DOCX, TXT, MD, CSV, XLSX</li>
                      <li>• <span className={L.listBold}>Upload via drag-and-drop</span> or click the upload area in the project detail view</li>
                      <li>• <span className={L.listBold}>Documents are stored locally</span> using IndexedDB for larger file support</li>
                      <li>• <span className={L.listBold}>Remove documents</span> by clicking the X button next to each file</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Visual Assets</h4>
                    <ul className={`${L.listItem} space-y-1 ml-2`}>
                      <li>• <span className={L.listBold}>Supported image formats:</span> JPG, PNG, GIF, WebP, BMP, TIFF, SVG</li>
                      <li>• <span className={L.listBold}>Supported video formats:</span> MP4, MOV, WebM, AVI, MKV</li>
                      <li>• <span className={L.listBold}>Name files descriptively</span> for better AI-driven placement (e.g., "product_hero.jpg" not "IMG_4521.jpg")</li>
                      <li>• <span className={L.listBold}>Storage limits:</span> Large assets are stored in IndexedDB. A warning appears when storage is running low</li>
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
                    <ul className={`${L.listItem} space-y-1 ml-2`}>
                      <li>• <span className={L.listBold}>D.O.G. (Deck Outline Generator)</span> — AI-powered slide outline generation with theme colors, image prompts, and a live visualizer</li>
                      <li>• <span className={L.listBold}>O.T.T.E.R. (Training & Education)</span> — AI-powered learning platform for software, shortcuts, and coding languages</li>
                      <li>• <span className={L.listBold}>Project Manager</span> — Organize documents, visual assets, and metadata for multiple projects</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Technical Details</h4>
                    <ul className={`${L.listItem} space-y-1 ml-2`}>
                      <li>• <span className={L.listBold}>Platform:</span> Electron desktop application (Windows)</li>
                      <li>• <span className={L.listBold}>Local-first:</span> All data is stored locally — nothing is sent to external servers except Anthropic API calls</li>
                      <li>• <span className={L.listBold}>API Key:</span> Requires an Anthropic API key for AI features, configured in System Settings</li>
                      <li>• <span className={L.listBold}>Storage:</span> Uses localStorage and IndexedDB for project data and settings</li>
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
                    <ul className={`${L.listItem} space-y-1 ml-2`}>
                      <li>• <span className={L.listBold}>The home screen</span> is the central hub with buttons for each tool and System Settings</li>
                      <li>• <span className={L.listBold}>Use arrow keys</span> to navigate between buttons, press Enter to select</li>
                      <li>• <span className={L.listBold}>Help page</span> is accessible from the home screen below System Settings</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Navigation Menu</h4>
                    <ul className={`${L.listItem} space-y-1 ml-2`}>
                      <li>• <span className={L.listBold}>Hamburger menu</span> — Available on all non-home pages via the icon in the top-right</li>
                      <li>• <span className={L.listBold}>Quick access</span> to HOME, other tools, and System Settings from any page</li>
                      <li>• <span className={L.listBold}>Click outside</span> the nav strip to dismiss it</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Page Transitions</h4>
                    <p className={L.listItem}>
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
                    <ul className={`${L.listItem} space-y-1 ml-2`}>
                      <li>• <span className={L.listBold}>Click the sprite</span> (bottom-right corner) to open/close the chat window</li>
                      <li>• <span className={L.listBold}>Press Enter</span> to toggle the chat window (when not typing in an input)</li>
                      <li>• <span className={L.listBold}>Feed button</span> — Restores hunger (available when pet mode is on and pet is alive)</li>
                      <li>• <span className={L.listBold}>Pet button</span> — Increases happiness and shows affection</li>
                      <li>• <span className={L.listBold}>Thumbs up/down</span> — Rate AI responses to help the companion learn your preferences</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Pet Lifecycle</h4>
                    <ul className={`${L.listItem} space-y-1 ml-2`}>
                      <li>• <span className={L.listBold}>Egg</span> — Your pet starts as an egg. Pet it 2-4 times to hatch</li>
                      <li>• <span className={L.listBold}>Baby</span> — Hatches with a random breed and gender. Smaller sprite. Evolves over time</li>
                      <li>• <span className={L.listBold}>Adult</span> — Fully grown. Needs regular feeding and attention to stay happy</li>
                      <li>• <span className={L.listBold}>Corpse → Ghost</span> — If hunger reaches 0, the pet dies. A ghost appears</li>
                      <li>• <span className={L.listBold}>New egg</span> — When your pet is a ghost, you can create a new egg from System Settings</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>8 Pet Breeds</h4>
                    <ul className={`${L.listItem} space-y-1 ml-2`}>
                      <li>• <span className={L.listBold}>Otter, Bird, Octopus, Blob, Rabbit, Pig, Monkey</span> — 14% chance each</li>
                      <li>• <span className={L.listBold}>Demon</span> — Rare breed with only a 2% chance of hatching</li>
                      <li>• Breed is randomly assigned at hatch time and cannot be changed</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Pet States & Moods</h4>
                    <ul className={`${L.listItem} space-y-1 ml-2`}>
                      <li>• <span className={L.listBold}>Content</span> — Default happy state when well-fed and recently petted</li>
                      <li>• <span className={L.listBold}>Hungry</span> — Hunger dropping below 40%. Feed to fix</li>
                      <li>• <span className={L.listBold}>Starving</span> — Hunger below 15%. Feed urgently or pet will die</li>
                      <li>• <span className={L.listBold}>Lonely</span> — Happiness dropped too low. Pet or chat to restore</li>
                      <li>• <span className={L.listBold}>Sleeping</span> — Pet sleeps periodically. Cannot feed during sleep</li>
                      <li>• <span className={L.listBold}>Happy</span> — Temporarily shown after feeding or petting</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Pet Mode & Settings</h4>
                    <ul className={`${L.listItem} space-y-1 ml-2`}>
                      <li>• <span className={L.listBold}>Pet Mode ON</span> — Full Tamagotchi experience with hunger, sleep, mood, and lifecycle</li>
                      <li>• <span className={L.listBold}>Pet Mode OFF</span> — Companion is a helper-only chatbot with no mechanics</li>
                      <li>• <span className={L.listBold}>Difficulty (Low/Medium/High)</span> — Controls how fast hunger and happiness decay</li>
                      <li>• <span className={L.listBold}>All pet settings</span> are in System Settings under the "Companion" section</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Dream Cloud & Animations</h4>
                    <ul className={`${L.listItem} space-y-1 ml-2`}>
                      <li>• A thought bubble appears above the sprite showing its current mood</li>
                      <li>• <span className={L.listBold}>Hearts</span> when content or happy, <span className={L.listBold}>sad face</span> when hungry/lonely</li>
                      <li>• <span className={L.listBold}>Zzz</span> when sleeping — the sprite bobs slowly</li>
                      <li>• The sprite slides out during page transitions and slides back in when the new page loads</li>
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
                    <h4 className={L.cardTitle}>API Key</h4>
                    <ul className={`${L.listItem} space-y-1 ml-2`}>
                      <li>• <span className={L.listBold}>Anthropic API Key</span> — Required for all AI-powered features (generation, theme colors, image prompts, rewrites)</li>
                      <li>• <span className={L.listBold}>Stored locally</span> in localStorage — never transmitted anywhere except the Anthropic API</li>
                      <li>• <span className={L.listBold}>Shared across tools</span> — Set it once and all tools use the same key</li>
                    </ul>
                  </div>
                  <div className={L.card}>
                    <h4 className={L.cardTitle}>Password</h4>
                    <ul className={`${L.listItem} space-y-1 ml-2`}>
                      <li>• <span className={L.listBold}>Login password</span> — Protects the application on launch</li>
                      <li>• <span className={L.listBold}>Change password</span> — Requires entering your current password first</li>
                      <li>• <span className={L.listBold}>Letters and numbers only</span>, up to 12 characters</li>
                      <li>• <span className={L.listBold}>Case-insensitive</span> — "hello" and "HELLO" are treated as the same password</li>
                    </ul>
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
    </div>
  )
}
