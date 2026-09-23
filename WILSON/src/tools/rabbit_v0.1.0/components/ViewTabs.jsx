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
  Film, Gamepad2, Clapperboard,
} from 'lucide-react'
import '../rabbitShell.css'

export const RABBIT_VIEWS = [
  { id: 'intake',      label: 'Intake',       Icon: Sparkles   },
  { id: 'summary',     label: 'Summary',      Icon: FileText   },
  { id: 'team',        label: 'Team',         Icon: Users      },
  { id: 'tasks',       label: 'Tasks',        Icon: ListChecks },
  { id: 'timeline',    label: 'Timeline',     Icon: GanttChart },
  { id: 'budget',      label: 'Budget',       Icon: DollarSign },
  { id: 'assets',      label: 'Assets',       Icon: Boxes      },
  { id: 'scenes',      label: 'Scenes',       Icon: Film       },
  // The bin system (demo 2026-09-11): visible under the same condition as
  // Scenes (project.scenes_enabled), hidden with it in Rabbit.jsx.
  { id: 'bins',        label: 'Bins',         Icon: Clapperboard },
  { id: 'levels',      label: 'Levels',       Icon: Gamepad2   },
  { id: 'experiences', label: 'Experiences',   Icon: Sparkles   },
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
        /* 🚨 C6, and it was live on every R.A.B.B.I.T. screen (V1,
           2026-09-23). The active tab painted `#fff7ed` on the signal
           `#ea580c` at the Dense step — 3.35:1, under 4.5, and neither of the
           two inks C6 allows on orange (white only at 19px bold and above,
           `#1c1917` below it). tokens.test.js already names this exact pair
           "the most-copied wrong fix"; the tab bar was still shipping it.

           The ink is the only thing that changed: `ink-light` on the same
           fill is 4.91:1. The FILL is still §3.2's open item — "the active
           R.A.B.B.I.T. tab stops borrowing the frame's colour and takes the
           underline" — and that restyle is lane B1's; this is the smallest
           change that stops the tab bar breaking a hard constraint in the
           meantime. `aria-current` is the same step's other half: the active
           view was expressed ONLY as an inline colour, so neither a screen
           reader nor ui-page-check's tab proof could tell which view was
           showing.

           B1 (2026-09-23), commit 1: the active branch moved out of this
           inline style onto `data-active` + `.rb-viewtab` in rabbitShell.css,
           values unchanged. */
        return (
          <button
            key={id}
            type="button"
            aria-current={active ? 'page' : undefined}
            data-active={active ? 'true' : undefined}
            onClick={() => onChange(id)}
            disabled={disabled}
            className="rb-viewtab flex items-center gap-1.5 px-3 py-2 text-dense transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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
