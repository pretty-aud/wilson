// ============================================================
// RABBIT — ViewTabs
// ============================================================
//
// Strip of buttons that switches the active RabbitPage view.
// The tab list is hardcoded — RABBIT v0.1 ships exactly five
// views and ordering matches the typical workflow:
//
//   Intake → Summary → Assets → Timeline → Budget
//
// Visual: dark stone surface with orange accents, monospace caps.

import {
  Sparkles, FileText, Boxes, GanttChart, DollarSign, Users, ListChecks,
  Film, Gamepad2,
} from 'lucide-react'

export const RABBIT_VIEWS = [
  { id: 'intake',      label: 'Intake',       Icon: Sparkles   },
  { id: 'summary',     label: 'Summary',      Icon: FileText   },
  { id: 'team',        label: 'Team',         Icon: Users      },
  { id: 'tasks',       label: 'Tasks',        Icon: ListChecks },
  { id: 'assets',      label: 'Assets',       Icon: Boxes      },
  { id: 'scenes',      label: 'Scenes',       Icon: Film       },
  { id: 'levels',      label: 'Levels',       Icon: Gamepad2   },
  { id: 'experiences', label: 'Experiences',   Icon: Sparkles   },
  { id: 'timeline',    label: 'Timeline',     Icon: GanttChart },
  { id: 'budget',      label: 'Budget',       Icon: DollarSign },
]

export default function ViewTabs({ activeView, onChange, disabled, rightSlot, hiddenTabs }) {
  return (
    <div
      className="flex items-center gap-1 px-2"
      style={{
        backgroundColor: '#1c1917',
        borderBottom: '1px solid #44403c',
      }}
    >
      {RABBIT_VIEWS.filter(v => !hiddenTabs || !(hiddenTabs instanceof Set ? hiddenTabs.has(v.id) : Array.isArray(hiddenTabs) && hiddenTabs.includes(v.id))).map(({ id, label, Icon }) => {
        const active = id === activeView
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            disabled={disabled}
            className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono uppercase tracking-wider transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              color: active ? '#fff7ed' : '#a8a29e',
              backgroundColor: active ? '#ea580c' : 'transparent',
              borderLeft: '1px solid transparent',
              borderRight: '1px solid transparent',
              borderTop: '1px solid transparent',
              borderBottom: active ? '2px solid #ea580c' : '2px solid transparent',
              marginBottom: '-1px',
            }}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        )
      })}
      {/* Optional right-aligned slot for view-specific controls
          (e.g. settings + help buttons on the Timeline view). */}
      {rightSlot && (
        <div className="ml-auto flex items-center gap-1 pr-2">
          {rightSlot}
        </div>
      )}
    </div>
  )
}
