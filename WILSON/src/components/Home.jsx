import { useState, useEffect, useCallback } from 'react'
import { FolderKanban, Layers, Settings, HelpCircle, GraduationCap } from 'lucide-react'

const NAV_ITEMS = [
  { id: 'dog', label: 'D.O.G.', Icon: Layers },
  { id: 'otter', label: 'O.T.T.E.R.', Icon: GraduationCap },
  { id: 'project-manager', label: 'Project Manager', Icon: FolderKanban },
  { id: 'settings', label: 'System Settings', Icon: Settings },
  { id: 'help', label: 'Help', Icon: HelpCircle },
]

export default function Home({ onNavigate }) {
  const [selectedIndex, setSelectedIndex] = useState(null)

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => prev === null ? 0 : (prev + 1) % NAV_ITEMS.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => prev === null ? NAV_ITEMS.length - 1 : (prev - 1 + NAV_ITEMS.length) % NAV_ITEMS.length)
    } else if (e.key === 'Enter' && selectedIndex !== null) {
      e.preventDefault()
      onNavigate(NAV_ITEMS[selectedIndex].id)
    }
  }, [selectedIndex, onNavigate])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-4 py-6" style={{ minHeight: '100%', justifyContent: 'center' }}>
        {NAV_ITEMS.map((item, index) => {
          const isSelected = selectedIndex === index
          const { Icon } = item

          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
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
                style={{
                  color: isSelected ? '#fff' : '#1c1917',
                }}
              />
              <span
                className="font-bold text-sm tracking-widest uppercase transition-colors duration-200"
                style={{
                  color: isSelected ? '#fff' : '#1c1917',
                }}
              >
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
