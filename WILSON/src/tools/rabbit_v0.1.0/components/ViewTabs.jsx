// ============================================================
// RABBIT — ViewTabs
// ============================================================
//
// The strip that switches the active R.A.B.B.I.T. view. Since B1
// (UI overhaul, 2026-09-23) it is the kit's `Tabs` (plan §4): Body
// step, sentence case, 400 inactive / 600 active, ONE 2px signal
// underline and no fill.
//
// The active tab used to borrow the frame's own orange as a fill
// (review R16, B06), which under 13px text has no legal ink (C6) —
// V1 painted it `#1c1917` as a stopgap. The underline retires the
// fill, so the stopgap retires with it.
//
// Eleven equal peers is a Hick's-law problem on its own, so the tabs
// are GROUPED by the kit's hairline separator — never reduced (C1: no
// tab removed, none merged, none moved behind a disclosure, and the
// order is the order they always had):
//
//   Intake · Summary · Team │ Tasks · Timeline · Budget │ Assets · Scenes · Bins · Levels · Experiences
//   (the project)             (the plan)                  (the material)
//
// A group whose every tab is hidden (Budget for a non-manager; Scenes,
// Bins, Levels, Experiences by project toggle) draws no separator of
// its own, so the strip never shows two hairlines in a row.

import {
  Sparkles, FileText, Boxes, GanttChart, DollarSign, Users, ListChecks,
  Film, Gamepad2, Clapperboard,
} from 'lucide-react'
import { Tabs } from '../../../ui/Tabs'
import '../rabbitShell.css'

export const RABBIT_VIEWS = [
  { id: 'intake',      label: 'Intake',      Icon: Sparkles,     group: 'project'  },
  { id: 'summary',     label: 'Summary',     Icon: FileText,     group: 'project'  },
  { id: 'team',        label: 'Team',        Icon: Users,        group: 'project'  },
  { id: 'tasks',       label: 'Tasks',       Icon: ListChecks,   group: 'plan'     },
  { id: 'timeline',    label: 'Timeline',    Icon: GanttChart,   group: 'plan'     },
  { id: 'budget',      label: 'Budget',      Icon: DollarSign,   group: 'plan'     },
  { id: 'assets',      label: 'Assets',      Icon: Boxes,        group: 'material' },
  { id: 'scenes',      label: 'Scenes',      Icon: Film,         group: 'material' },
  // The bin system (demo 2026-09-11): visible under the same condition as
  // Scenes (project.scenes_enabled), hidden with it in Rabbit.jsx.
  { id: 'bins',        label: 'Bins',        Icon: Clapperboard, group: 'material' },
  { id: 'levels',      label: 'Levels',      Icon: Gamepad2,     group: 'material' },
  { id: 'experiences', label: 'Experiences', Icon: Sparkles,     group: 'material' },
]

/** The id of the region the tabs switch; Rabbit.jsx puts role="tabpanel" on it. */
export const RABBIT_VIEW_PANEL_ID = 'rabbit-view-panel'

const isHidden = (hiddenTabs, id) =>
  !!hiddenTabs && (hiddenTabs instanceof Set ? hiddenTabs.has(id) : Array.isArray(hiddenTabs) && hiddenTabs.includes(id))

/** The kit's item list: visible views, a separator wherever the group changes. */
export function viewTabItems({ hiddenTabs, disabled } = {}) {
  const items = []
  let group = null
  for (const { id, label, Icon, group: g } of RABBIT_VIEWS) {
    if (isHidden(hiddenTabs, id)) continue
    if (group !== null && g !== group) items.push({ separator: true })
    group = g
    items.push({
      id,
      label: <><Icon className="rb-viewtab-icon" aria-hidden="true" />{label}</>,
      disabled: !!disabled,
    })
  }
  return items
}

export default function ViewTabs({ activeView, onChange, disabled, rightSlot, hiddenTabs, panelId = RABBIT_VIEW_PANEL_ID }) {
  return (
    <div className="rb-viewtabs">
      <Tabs
        items={viewTabItems({ hiddenTabs, disabled })}
        value={activeView}
        onChange={onChange}
        panelId={panelId}
        label="R.A.B.B.I.T. views"
        className="rb-viewtabs-list"
      />
      {/* Optional right-aligned slot for shell-level controls (settings,
          help) and, on Summary, the adapter dot and presence pill. */}
      {rightSlot && <div className="rb-viewtabs-right">{rightSlot}</div>}
    </div>
  )
}
