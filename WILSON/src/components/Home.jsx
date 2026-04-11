import { useState, useEffect, useCallback, useRef } from 'react'
import {
  FolderKanban,
  Layers,
  Settings,
  HelpCircle,
  GraduationCap,
  BookOpen,
  ChevronLeft,
  Briefcase,
  DollarSign,
  ListChecks,
  Users,
} from 'lucide-react'

// Sentinel id used for the inline Resources sub-menu trigger.
// This is NOT a navigable page — it just opens the slide-right panel.
const RESOURCES_SENTINEL = '__resources'

const MAIN_ITEMS = [
  { id: 'dog',                   label: 'D.O.G.',           Icon: Layers },
  { id: 'otter',                 label: 'O.T.T.E.R.',       Icon: GraduationCap },
  { id: 'rabbit',                label: 'R.A.B.B.I.T.',     Icon: ListChecks },
  { id: RESOURCES_SENTINEL,      label: 'Resources',        Icon: BookOpen },
  { id: 'settings',              label: 'System Settings',  Icon: Settings },
  { id: 'help',                  label: 'Help',             Icon: HelpCircle },
]

const RESOURCES_ITEMS = [
  { id: 'project-manager', label: 'Projects',       Icon: Briefcase },
  { id: 'rate-card',       label: 'Rate Card',      Icon: DollarSign },
  { id: 'team-members',    label: 'Team Members',   Icon: Users },
]

export default function Home({ onNavigate, currentPage }) {
  const [submenu, setSubmenu] = useState(null)        // null | 'resources'
  const [selectedIndex, setSelectedIndex] = useState(null)
  const wasOnHomeRef = useRef(currentPage === 'home')

  // Reset submenu state whenever the user navigates away from home
  // (so reopening Home shows the main menu first, per §4.1).
  useEffect(() => {
    if (currentPage !== 'home' && wasOnHomeRef.current) {
      setSubmenu(null)
      setSelectedIndex(null)
    }
    wasOnHomeRef.current = currentPage === 'home'
  }, [currentPage])

  const activeItems = submenu === 'resources' ? RESOURCES_ITEMS : MAIN_ITEMS

  const enterResources = useCallback(() => {
    setSubmenu('resources')
    setSelectedIndex(null)
  }, [])

  const exitResources = useCallback(() => {
    setSubmenu(null)
    setSelectedIndex(null)
  }, [])

  const handleSelect = useCallback((item) => {
    if (item.id === RESOURCES_SENTINEL) {
      enterResources()
      return
    }
    onNavigate(item.id)
  }, [onNavigate, enterResources])

  const handleKeyDown = useCallback((e) => {
    // Escape backs out of the submenu, never out of the main menu.
    if (e.key === 'Escape' && submenu) {
      e.preventDefault()
      exitResources()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => prev === null ? 0 : (prev + 1) % activeItems.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => prev === null ? activeItems.length - 1 : (prev - 1 + activeItems.length) % activeItems.length)
    } else if (e.key === 'Enter' && selectedIndex !== null) {
      e.preventDefault()
      handleSelect(activeItems[selectedIndex])
    }
  }, [selectedIndex, submenu, activeItems, handleSelect, exitResources])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // ── Render one menu pane (used for both main + submenu) ──
  const renderMenu = (items, paneKey) => (
    <div
      key={paneKey}
      className="flex flex-col gap-4 py-6"
      style={{
        width: '50%',
        flexShrink: 0,
        minHeight: '100%',
        justifyContent: 'center',
      }}
    >
      {paneKey === 'resources' && (
        <button
          onClick={exitResources}
          className="flex items-center gap-3 pr-8 py-3 transition-opacity hover:opacity-70"
          style={{
            paddingLeft: 'clamp(2rem, 20vw, 16rem)',
            color: '#1c1917',
          }}
        >
          <ChevronLeft className="w-5 h-5" />
          <span className="font-bold text-xs tracking-widest uppercase">Back</span>
        </button>
      )}
      {items.map((item, index) => {
        const isSelected = selectedIndex === index
        const { Icon } = item
        return (
          <button
            key={item.id}
            onClick={() => handleSelect(item)}
            onMouseEnter={() => setSelectedIndex(index)}
            onMouseLeave={() => setSelectedIndex(null)}
            className="flex items-center gap-5 pr-8 py-4 transition-all duration-200"
            style={{
              paddingLeft: 'clamp(2rem, 20vw, 16rem)',
              backgroundColor: isSelected ? 'rgba(154, 100, 56, 0.65)' : 'transparent',
            }}
          >
            <Icon
              className="w-8 h-8 transition-colors duration-200 flex-shrink-0"
              style={{ color: isSelected ? '#fff' : '#1c1917' }}
            />
            <span
              className="font-bold text-sm tracking-widest uppercase transition-colors duration-200"
              style={{ color: isSelected ? '#fff' : '#1c1917' }}
            >
              {item.label}
            </span>
          </button>
        )
      })}
    </div>
  )

  // Two panes side-by-side; we translate left when the submenu is open.
  // Pure CSS transform — no animation library.
  return (
    <div className="h-full overflow-hidden">
      <div
        className="flex h-full"
        style={{
          width: '200%',
          transform: submenu === 'resources' ? 'translateX(-50%)' : 'translateX(0)',
          transition: 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {renderMenu(MAIN_ITEMS, 'main')}
        {renderMenu(RESOURCES_ITEMS, 'resources')}
      </div>
    </div>
  )
}
