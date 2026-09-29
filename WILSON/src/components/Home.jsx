import { useState, useEffect, useCallback, useRef } from 'react'
import {
  FolderKanban,
  Layers,
  Settings,
  HelpCircle,
  GraduationCap,
  BookOpen,
  Briefcase,
  DollarSign,
  ListChecks,
  Users,
  LayoutDashboard,
  Terminal,
} from 'lucide-react'
import { usePermissions } from '../permissions'

// Sentinel id used for the inline Resources column trigger.
// This is NOT a navigable page — it toggles the right column.
const RESOURCES_SENTINEL = '__resources'

const MAIN_ITEMS = [
  { id: 'dog',              label: 'D.O.G.',          Icon: Layers },
  { id: 'otter',            label: 'O.T.T.E.R.',      Icon: GraduationCap },
  { id: 'rabbit',           label: 'R.A.B.B.I.T.',    Icon: ListChecks },
  // Session 8: the personal cross-tool surface, below the tools.
  { id: 'dashboard',        label: 'Dashboard',        Icon: LayoutDashboard },
  { id: RESOURCES_SENTINEL, label: 'Resources',        Icon: BookOpen },
  { id: 'settings',         label: 'App settings',  Icon: Settings },
]

const RESOURCES_ITEMS = [
  { id: 'project-manager', label: 'Projects',       Icon: Briefcase },
  { id: 'rate-card',       label: 'Rate Card',      Icon: DollarSign },
  { id: 'team-members',    label: 'Team Members',   Icon: Users },
  { id: 'help',            label: 'Help',            Icon: HelpCircle },
]

// Session 9: the Admin Terminal entry is spliced in for admins only. The
// keyboard handler indexes into the SAME array the buttons render from, so
// gating must swap the array — hiding one button would desync arrow keys.
const RESOURCES_ITEMS_ADMIN = [
  ...RESOURCES_ITEMS.slice(0, 3),
  { id: 'admin-terminal', label: 'Admin Terminal', Icon: Terminal },
  RESOURCES_ITEMS[3],
]

// ── UI overhaul D2 (2026-09-11): the only change to this file ──────────────
// Two class strings, at :226 and :300. `font-bold text-sm tracking-widest
// uppercase` became `text-h2`: 16px, weight 600, sentence case, zero tracking,
// in the ink already declared beside it. Nothing else moved — not the layout,
// the icons, the spacing, the six buttons, the Resources column, the keyboard
// handler or the two arrays it indexes.
//
// ⚠️ C3 scopes Home to "family, scale steps and weights", which on the narrow
// reading would keep the labels UPPERCASE. The plan's critic ruled the
// fonts-only version of HOME-01 is "16px, weight 600, sentence case, zero
// tracking, LIGHT_INK … that is the whole type change", and §0 says a session
// executes the critic's reframe rather than the original finding. Home would
// otherwise be the last screen in the app still shouting. It is Audrey's call
// and it is one string, twice — the walkthrough (docs/walkthroughs/
// 23_ui_auth_help_home.md, decision 1) puts it to her with the revert.
//
// Audrey, 2026-09-11 (walkthroughs 21 and 23, answered the next morning):
// Home is ALL CAPITALS ("make sure its all capitals in the home page"), by
// `uppercase` on the two label spans so the label strings the e2e selector
// guard pins stay as written; the word is "App settings" on Home too; the
// icons shrink to 24px so the 16px labels lead; the hover keeps the white
// label on a DARKER fill ("whatever looks more visually appealing and
// stand[s] out clearly"). The fill was rgba(154,100,56,0.65), where white
// measured 3.52:1 — the history of that measurement is below.
//
// The hover fill below WAS Q19 and untouched until that ruling. Measured: it
// composites to #ba7a46, where the white label is 3.52:1 and fails while the
// resting black is 8.48:1 — so the state being read is the less legible one.
// Both fixes are one token (black label, 4.96:1; or a darker fill) and both
// ratios are asserted in authContrast.test.js so whichever she picks has a
// control the day it lands. NAV_DESTINATIONS belongs to the shell session.
const HIGHLIGHT_BG = 'rgba(120, 70, 30, 0.8)'
const MAIN_PADDING = 'clamp(2rem, 20%, 16rem)'
const RESOURCES_PADDING = 'clamp(1rem, 3%, 2.5rem)'
const EASE_CURVE = 'cubic-bezier(0.4, 0, 0.2, 1)'

export default function Home({ onNavigate, currentPage }) {
  const perms = usePermissions()
  // One list for BOTH mouse and keyboard (see RESOURCES_ITEMS_ADMIN note).
  const resourcesItems = perms.ready && perms.role === 'admin'
    ? RESOURCES_ITEMS_ADMIN
    : RESOURCES_ITEMS
  const [resourcesOpen, setResourcesOpen] = useState(false)
  const [activeColumn, setActiveColumn] = useState('main') // 'main' | 'resources'
  const [selectedIndex, setSelectedIndex] = useState(null)
  const wasOnHomeRef = useRef(currentPage === 'home')

  // Reset when navigating away from home
  useEffect(() => {
    if (currentPage !== 'home' && wasOnHomeRef.current) {
      setResourcesOpen(false)
      setActiveColumn('main')
      setSelectedIndex(null)
    }
    wasOnHomeRef.current = currentPage === 'home'
  }, [currentPage])

  const openResources = useCallback(() => {
    setResourcesOpen(true)
    setActiveColumn('resources')
    setSelectedIndex(null)
  }, [])

  const closeResources = useCallback(() => {
    setResourcesOpen(false)
    setActiveColumn('main')
    setSelectedIndex(null)
  }, [])

  const handleMainItemClick = useCallback((item) => {
    if (item.id === RESOURCES_SENTINEL) {
      resourcesOpen ? closeResources() : openResources()
      return
    }
    // When resources column is visible, main buttons are disabled —
    // the left-column dismiss overlay handles closing instead.
    if (!resourcesOpen) onNavigate(item.id)
  }, [onNavigate, resourcesOpen, openResources, closeResources])

  const handleResourceItemClick = useCallback((item) => {
    // A role flip can shrink resourcesItems under a stale selectedIndex.
    if (!item) return
    onNavigate(item.id)
  }, [onNavigate])

  // ── Keyboard navigation ──
  const handleKeyDown = useCallback((e) => {
    if (!resourcesOpen) {
      // Single-column mode: arrows move through main items
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev =>
          prev === null ? 0 : (prev + 1) % MAIN_ITEMS.length,
        )
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev =>
          prev === null
            ? MAIN_ITEMS.length - 1
            : (prev - 1 + MAIN_ITEMS.length) % MAIN_ITEMS.length,
        )
      } else if (e.key === 'Enter' && selectedIndex !== null) {
        e.preventDefault()
        handleMainItemClick(MAIN_ITEMS[selectedIndex])
      }
      return
    }

    // Two-column mode: keyboard drives the resources column
    if (e.key === 'Escape' || e.key === 'ArrowLeft') {
      e.preventDefault()
      closeResources()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveColumn('resources')
      setSelectedIndex(prev =>
        prev === null ? 0 : (prev + 1) % resourcesItems.length,
      )
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveColumn('resources')
      setSelectedIndex(prev =>
        prev === null
          ? resourcesItems.length - 1
          : (prev - 1 + resourcesItems.length) % resourcesItems.length,
      )
    } else if (
      e.key === 'Enter' &&
      activeColumn === 'resources' &&
      selectedIndex !== null
    ) {
      e.preventDefault()
      handleResourceItemClick(resourcesItems[selectedIndex])
    }
  }, [
    selectedIndex,
    activeColumn,
    resourcesOpen,
    resourcesItems,
    handleMainItemClick,
    handleResourceItemClick,
    closeResources,
  ])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // ── Render ──
  return (
    <div className="h-full overflow-hidden flex">
      {/* ── Left column: main items ── */}
      <div
        className="flex flex-col gap-3 py-6 wilson-light-scroll"
        style={{
          position: 'relative',
          width: resourcesOpen ? '25%' : '100%',
          flexShrink: 0,
          flexGrow: 0,
          // 'safe center' + scroll: with six items (Session 8 added
          // Dashboard) plain centering clips both ends on short windows
          // with no way to reach them — safe centering degrades to
          // flex-start and the column scrolls instead.
          justifyContent: 'safe center',
          overflowY: 'auto',
          minHeight: '100%',
          transition: `width 300ms ${EASE_CURVE}`,
        }}
      >
        {MAIN_ITEMS.map((item, index) => {
          const isResourcesTrigger = item.id === RESOURCES_SENTINEL
          const highlighted = resourcesOpen
            ? isResourcesTrigger                              // locked-on when open
            : activeColumn === 'main' && selectedIndex === index // normal hover/kb
          const grayed = resourcesOpen && !isResourcesTrigger
          const { Icon } = item

          return (
            <button
              key={item.id}
              onClick={() => handleMainItemClick(item)}
              onMouseEnter={() => {
                if (!resourcesOpen) {
                  setActiveColumn('main')
                  setSelectedIndex(index)
                }
              }}
              onMouseLeave={() => {
                if (!resourcesOpen && activeColumn === 'main') {
                  setSelectedIndex(null)
                }
              }}
              className="flex items-center gap-5 pr-8 py-3 transition-all duration-200"
              style={{
                paddingLeft: MAIN_PADDING,
                backgroundColor: highlighted ? HIGHLIGHT_BG : 'transparent',
                opacity: grayed ? 0.3 : 1,
                cursor: grayed ? 'default' : 'pointer',
                flexShrink: 0,
              }}
            >
              <Icon
                className="w-6 h-6 transition-colors duration-200 flex-shrink-0"
                style={{ color: highlighted ? '#fff' : '#1c1917' }}
              />
              <span
                className="text-h2 uppercase tracking-[0.06em] transition-colors duration-200"
                style={{ color: highlighted ? '#fff' : '#1c1917' }}
              >
                {item.label}
              </span>
            </button>
          )
        })}

        {/* Dismiss overlay — clicking anywhere in the left column closes resources */}
        {resourcesOpen && (
          <div
            onClick={closeResources}
            style={{ position: 'absolute', inset: 0, zIndex: 1, cursor: 'pointer' }}
          />
        )}
      </div>

      {/* ── Divider + right column: resources (Finder-style) ── */}
      <div
        className="flex"
        style={{
          width: resourcesOpen ? '75%' : '0',
          flexShrink: 0,
          flexGrow: 0,
          overflow: 'hidden',
          transition: `width 300ms ${EASE_CURVE}`,
        }}
      >
        {/* Vertical divider line */}
        <div
          style={{
            width: 1,
            flexShrink: 0,
            backgroundColor: 'rgba(28, 25, 23, 0.2)',
            opacity: resourcesOpen ? 1 : 0,
            transition: 'opacity 200ms ease 80ms',
          }}
        />

        {/* Resource items */}
        <div
          className="flex flex-col gap-4 py-6 flex-1"
          style={{ justifyContent: 'center', minHeight: '100%' }}
        >
          {resourcesItems.map((item, index) => {
            const highlighted =
              activeColumn === 'resources' && selectedIndex === index
            const { Icon } = item

            return (
              <button
                key={item.id}
                onClick={() => handleResourceItemClick(item)}
                onMouseEnter={() => {
                  setActiveColumn('resources')
                  setSelectedIndex(index)
                }}
                onMouseLeave={() => {
                  if (activeColumn === 'resources') {
                    setSelectedIndex(null)
                  }
                }}
                className="flex items-center gap-5 pr-8 py-4 transition-all duration-200"
                style={{
                  paddingLeft: RESOURCES_PADDING,
                  backgroundColor: highlighted ? HIGHLIGHT_BG : 'transparent',
                }}
              >
                <Icon
                  className="w-6 h-6 transition-colors duration-200 flex-shrink-0"
                  style={{ color: highlighted ? '#fff' : '#1c1917' }}
                />
                <span
                  className="text-h2 uppercase tracking-[0.06em] transition-colors duration-200"
                  style={{ color: highlighted ? '#fff' : '#1c1917' }}
                >
                  {item.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
