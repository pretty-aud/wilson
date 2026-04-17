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
} from 'lucide-react'

// Sentinel id used for the inline Resources column trigger.
// This is NOT a navigable page — it toggles the right column.
const RESOURCES_SENTINEL = '__resources'

const MAIN_ITEMS = [
  { id: 'dog',              label: 'D.O.G.',          Icon: Layers },
  { id: 'otter',            label: 'O.T.T.E.R.',      Icon: GraduationCap },
  { id: 'rabbit',           label: 'R.A.B.B.I.T.',    Icon: ListChecks },
  { id: RESOURCES_SENTINEL, label: 'Resources',        Icon: BookOpen },
  { id: 'settings',         label: 'System Settings',  Icon: Settings },
]

const RESOURCES_ITEMS = [
  { id: 'project-manager', label: 'Projects',       Icon: Briefcase },
  { id: 'rate-card',       label: 'Rate Card',      Icon: DollarSign },
  { id: 'team-members',    label: 'Team Members',   Icon: Users },
  { id: 'help',            label: 'Help',            Icon: HelpCircle },
]

const HIGHLIGHT_BG = 'rgba(154, 100, 56, 0.65)'
const MAIN_PADDING = 'clamp(2rem, 20%, 16rem)'
const RESOURCES_PADDING = 'clamp(1rem, 3%, 2.5rem)'
const EASE_CURVE = 'cubic-bezier(0.4, 0, 0.2, 1)'

export default function Home({ onNavigate, currentPage }) {
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
        prev === null ? 0 : (prev + 1) % RESOURCES_ITEMS.length,
      )
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveColumn('resources')
      setSelectedIndex(prev =>
        prev === null
          ? RESOURCES_ITEMS.length - 1
          : (prev - 1 + RESOURCES_ITEMS.length) % RESOURCES_ITEMS.length,
      )
    } else if (
      e.key === 'Enter' &&
      activeColumn === 'resources' &&
      selectedIndex !== null
    ) {
      e.preventDefault()
      handleResourceItemClick(RESOURCES_ITEMS[selectedIndex])
    }
  }, [
    selectedIndex,
    activeColumn,
    resourcesOpen,
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
        className="flex flex-col gap-4 py-6"
        style={{
          position: 'relative',
          width: resourcesOpen ? '25%' : '100%',
          flexShrink: 0,
          flexGrow: 0,
          justifyContent: 'center',
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
              className="flex items-center gap-5 pr-8 py-4 transition-all duration-200"
              style={{
                paddingLeft: MAIN_PADDING,
                backgroundColor: highlighted ? HIGHLIGHT_BG : 'transparent',
                opacity: grayed ? 0.3 : 1,
                cursor: grayed ? 'default' : 'pointer',
              }}
            >
              <Icon
                className="w-8 h-8 transition-colors duration-200 flex-shrink-0"
                style={{ color: highlighted ? '#fff' : '#1c1917' }}
              />
              <span
                className="font-bold text-sm tracking-widest uppercase transition-colors duration-200"
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
          {RESOURCES_ITEMS.map((item, index) => {
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
                  className="w-8 h-8 transition-colors duration-200 flex-shrink-0"
                  style={{ color: highlighted ? '#fff' : '#1c1917' }}
                />
                <span
                  className="font-bold text-sm tracking-widest uppercase transition-colors duration-200"
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
