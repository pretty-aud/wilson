// RABBIT v0.1.0 — in-app help content.
// Sidebar items + RabbitHelpContent component matching the
// DOG/OTTER help-modal pattern (light + dark theme tokens).

import React from 'react';

export const RABBIT_HELP_SIDEBAR_ITEMS = [
  { id: 'rabbit-overview',     label: 'Overview' },
  { id: 'rabbit-projects',     label: 'Projects' },
  { id: 'rabbit-intake',       label: 'Intake Wizard' },
  { id: 'rabbit-assets',       label: 'Assets' },
  { id: 'rabbit-timeline',     label: 'Timeline' },
  { id: 'rabbit-phases',       label: 'Phases & Tasks' },
  { id: 'rabbit-dependencies', label: 'Dependencies' },
  { id: 'rabbit-zoom',         label: 'Zoom & Weekends' },
  { id: 'rabbit-budget',       label: 'Budget' },
  { id: 'rabbit-settings',     label: 'Settings' },
  { id: 'rabbit-shortcuts',    label: 'Shortcuts & Tips' },
];

// Light-theme style tokens (used by an external help page if any)
const L = {
  sectionTitle: 'text-sm font-bold text-stone-900 uppercase tracking-wide mb-3',
  bodyText: 'text-xs text-stone-800 leading-relaxed',
  card: 'bg-white/40 p-3 rounded-sm border border-stone-400/30',
  cardTitle: 'text-xs font-bold text-stone-900 mb-2',
  listItem: 'text-[11px] text-stone-700 leading-relaxed',
  listBold: 'text-stone-900',
  notesBox: 'bg-orange-600/10 border border-orange-600/30 rounded-sm p-3',
  notesTitle: 'text-xs font-bold text-stone-900 uppercase tracking-wide mb-2',
};

// Dark-theme style tokens for the in-tool help modal
const D = {
  sectionTitle: 'text-sm font-bold text-orange-400 uppercase tracking-wide mb-3',
  bodyText: 'text-xs text-stone-300 leading-relaxed',
  card: 'bg-stone-900 p-3 rounded-sm border border-stone-700',
  cardTitle: 'text-xs font-bold text-orange-400 mb-2',
  listItem: 'text-[11px] text-stone-300 leading-relaxed',
  listBold: 'text-orange-400/80',
  notesBox: 'bg-orange-500/10 border border-orange-500/30 rounded-sm p-3',
  notesTitle: 'text-xs font-bold text-orange-400 uppercase tracking-wide mb-2',
};

export function RabbitHelpContent({ helpPage, theme }) {
  const T = theme === 'dark' ? D : L;

  if (helpPage === 'rabbit-overview') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>R.A.B.B.I.T. Overview</h3>
        <p className={`${T.bodyText} mb-4`}>
          R.A.B.B.I.T. (Resource Allocation, Budgeting, Bidding & Intake Tracker)
          is WILSON's project planning tool. It ingests intake documents,
          breaks them into phases / assets / tasks, schedules everything on a
          two-pane Notion-style timeline, tracks dependencies, and exports a
          budget summary you can hand to a client.
        </p>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Key Features</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Document intake</span> — Drop a brief or SOW; RABBIT extracts assets, tasks, and rough phases.</li>
              <li>• <span className={T.listBold}>Two-pane timeline</span> — A zoomed-out minimap up top and a zoomable gantt below.</li>
              <li>• <span className={T.listBold}>Phase containment</span> — Tasks live inside phases; drag a task outside and RABBIT will offer to extend the phase.</li>
              <li>• <span className={T.listBold}>Drag-and-drop</span> — Move tasks between phases right from the gutter labels.</li>
              <li>• <span className={T.listBold}>Dependencies</span> — Drag the right-edge dot of any bar onto another bar to wire them.</li>
              <li>• <span className={T.listBold}>Critical path</span> — RABBIT highlights the longest must-do chain.</li>
              <li>• <span className={T.listBold}>Adapter-first</span> — Local JSON for prototyping or a real backend for production, same UI either way.</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );

  if (helpPage === 'rabbit-projects') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Projects</h3>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Picking & Creating</h4>
            <p className={T.listItem}>
              Project picking and creation live exclusively in the
              <span className={T.listBold}> Summary tab</span>. The context bar
              under the tabs shows the active project and exposes a Switch
              dropdown so you can hop between projects without leaving the
              current view.
            </p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Refreshing</h4>
            <p className={T.listItem}>
              The circular arrow in the page header re-reads the projects
              index from disk. Use it after dropping a backup folder into
              your storage location.
            </p>
          </div>
        </div>
      </section>
    </div>
  );

  if (helpPage === 'rabbit-intake') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Intake Wizard</h3>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>How it works</h4>
            <p className={T.listItem}>
              Drop a brief, SOW, or quote document into the wizard. RABBIT
              chunks it, runs it through the intake LLM, and produces a
              proposed breakdown of phases, assets, and tasks. You review,
              edit, and hit save — at that point everything is committed to
              the active project.
            </p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Re-running intake</h4>
            <p className={T.listItem}>
              You can re-run intake on any document. RABBIT will not delete
              existing entities — it merges new ones in.
            </p>
          </div>
        </div>
      </section>
    </div>
  );

  if (helpPage === 'rabbit-assets') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Assets</h3>
        <p className={T.bodyText}>
          Assets are the deliverables of a project (a shot, a key art piece,
          a marketing video). They live off the timeline — they don't have
          their own bar — but tasks can be tagged with an asset id to
          categorize them. Use the Assets tab to create, rename, and group
          them by phase.
        </p>
      </section>
    </div>
  );

  if (helpPage === 'rabbit-timeline') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Timeline</h3>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Two panes</h4>
            <p className={T.listItem}>
              The top pane is a <span className={T.listBold}>minimap</span>: a
              zoomed-out view of the entire project. Drag the orange frame to
              scroll the bottom pane. The bottom pane is the
              <span className={T.listBold}> detail gantt</span> — that's where
              you do the bulk of your work.
            </p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Drawing bars</h4>
            <p className={T.listItem}>
              Drag on empty space in either pane to draw a new task. Drag the
              middle of a bar to move it. Drag a bar's left/right edge to
              resize it. Click any bar to open its editor.
            </p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Zoom toolbar</h4>
            <p className={T.listItem}>
              The Day / Week / Month / Quarter buttons sit in a toolbar
              <span className={T.listBold}> above</span> the detail gantt and
              control only the bottom pane. The minimap is permanently locked
              to a weeks-or-larger view so it always reads as the
              "navigator".
            </p>
          </div>
        </div>
      </section>
    </div>
  );

  if (helpPage === 'rabbit-phases') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Phases & Tasks</h3>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Containment</h4>
            <p className={T.listItem}>
              Tasks live inside phases. The detail gantt draws containment
              rails so you can see which task belongs to which phase at a
              glance. If you drag a task outside its parent phase's date
              window, RABBIT will pop up a confirmation asking whether to
              <span className={T.listBold}> clamp the task</span> back to the
              phase or <span className={T.listBold}> extend the phase</span>
              {' '}to cover the new dates.
            </p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Drag-and-drop between phases</h4>
            <p className={T.listItem}>
              Grab a task's row in the left gutter and drag it onto another
              phase row. The drop target highlights orange. Releasing reparents
              the task to the new phase.
            </p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Collapse / expand</h4>
            <p className={T.listItem}>
              Phases with children show a chevron in the gutter. Click it to
              hide their tasks and sub-phases. Collapse state is persisted on
              the phase record so it survives a reload.
            </p>
          </div>
          <div className={T.notesBox}>
            <div className={T.notesTitle}>Empty phases still render</div>
            <p className={T.listItem}>
              A phase with no tasks gets a fallback "today → today + 14d" bar
              so you can drag it into place before adding any work to it.
            </p>
          </div>
        </div>
      </section>
    </div>
  );

  if (helpPage === 'rabbit-dependencies') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Dependencies</h3>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Linking</h4>
            <p className={T.listItem}>
              Hover over any bar to reveal a colored dot on its right edge.
              Drag that dot onto another bar of the same kind (task→task or
              phase→phase) to wire a dependency. The two will be connected by
              a curved arrow with an animated light pulse showing the flow
              direction.
            </p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Removing</h4>
            <p className={T.listItem}>
              Click any dependency arrow to remove it (RABBIT will confirm
              first). Task dependencies are orange; phase dependencies are
              cyan.
            </p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Critical path</h4>
            <p className={T.listItem}>
              The longest chain of dependent tasks is highlighted in orange.
              The Summary band reports its length in days.
            </p>
          </div>
        </div>
      </section>
    </div>
  );

  if (helpPage === 'rabbit-zoom') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Zoom & Weekends</h3>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Zoom levels</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Day</span> — Day-by-day cells, taller rows, weekend tints.</li>
              <li>• <span className={T.listBold}>Week</span> — Default view; week ticks across the axis.</li>
              <li>• <span className={T.listBold}>Month</span> — Compressed for medium projects.</li>
              <li>• <span className={T.listBold}>Quarter</span> — Birds-eye view for multi-year programs.</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Weekend handling</h4>
            <p className={T.listItem}>
              In day view RABBIT tints Saturdays and Sundays so they read at
              a glance. If you toggle <span className={T.listBold}>Show weekends</span>
              {' '}off in Settings, weekend columns disappear from the gantt
              entirely — bars get squashed across the gap so the calendar
              reads like a workweek.
            </p>
          </div>
        </div>
      </section>
    </div>
  );

  if (helpPage === 'rabbit-budget') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Budget</h3>
        <p className={T.bodyText}>
          The Budget tab rolls up bid_days × role rate per task to produce a
          phase-level and project-level cost summary. Edit role rates in the
          intake wizard or in the asset editor and the budget recalculates
          live.
        </p>
      </section>
    </div>
  );

  if (helpPage === 'rabbit-settings') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Settings</h3>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Slide-out panel</h4>
            <p className={T.listItem}>
              Click the gear icon in the timeline header (or the settings
              entry on the WILSON nav strip) to open the slide-out. It has
              two tabs: <span className={T.listBold}>Settings</span> for
              persistent toggles and <span className={T.listBold}>System Prompts</span>
              {' '}for editing the LLM prompts that drive the scheduler /
              recommender / phase generator.
            </p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Show weekends</h4>
            <p className={T.listItem}>
              Toggles weekend visibility in day view. Off = weekends are
              hidden entirely; on = weekends get a soft tint.
            </p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Lock switch</h4>
            <p className={T.listItem}>
              Each tab has a Lock switch to protect from accidental edits.
              Toggle Unlock before changing prompts.
            </p>
          </div>
        </div>
      </section>
    </div>
  );

  if (helpPage === 'rabbit-shortcuts') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Shortcuts & Tips</h3>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Tips</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• Drag empty space on the timeline to draw a new task quickly.</li>
              <li>• Drag the orange frame on the minimap to scroll the detail gantt.</li>
              <li>• Click any bar to open its editor; drag to move; drag edges to resize.</li>
              <li>• Hover a bar to expose its dependency-drag handle.</li>
              <li>• In day view, taller rows + weekend tints make scheduling crew-day-by-crew-day easy.</li>
              <li>• Drag a task's gutter row onto another phase to reparent it.</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );

  return (
    <div className={T.bodyText}>
      Pick a topic from the sidebar.
    </div>
  );
}

// Default export keeps the old import (`import RabbitHelpContent from`)
// from breaking. The named export is the canonical one.
export default RabbitHelpContent;
