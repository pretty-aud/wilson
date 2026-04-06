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
// Visual: warm orange palette, 2px borders, monospace caps.

import {
  Sparkles, FileText, Boxes, GanttChart, DollarSign,
} from 'lucide-react'

export const RABBIT_VIEWS = [
  { id: 'intake',   label: 'Intake',   Icon: Sparkles    },
  { id: 'summary',  label: 'Summary',  Icon: FileText    },
  { id: 'assets',   label: 'Assets',   Icon: Boxes       },
  { id: 'timeline', label: 'Timeline', Icon: GanttChart  },
  { id: 'budget',   label: 'Budget',   Icon: DollarSign  },
]

export default function ViewTabs({ activeView, onChange, disabled }) {
  return (
    <div
      className="flex items-center gap-1 px-2"
      style={{
        backgroundColor: '#fff7ed',
        borderTop: '1px solid #f4a261',
        borderBottom: '2px solid #7c2d12',
      }}
    >
      {RABBIT_VIEWS.map(({ id, label, Icon }) => {
        const active = id === activeView
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            disabled={disabled}
            className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono uppercase tracking-wider transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              color: active ? '#fff7ed' : '#7c2d12',
              backgroundColor: active ? '#ea580c' : 'transparent',
              borderLeft: active ? '2px solid #7c2d12' : '2px solid transparent',
              borderRight: active ? '2px solid #7c2d12' : '2px solid transparent',
              borderTop: active ? '2px solid #7c2d12' : '2px solid transparent',
              borderBottom: active ? '2px solid #ea580c' : '2px solid transparent',
              marginBottom: '-2px',
            }}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        )
      })}
    </div>
  )
}
