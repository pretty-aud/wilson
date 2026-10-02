// RABBIT v0.1.0 — in-app help content.
// Sidebar items + RabbitHelpContent component matching the
// DOG/OTTER help-modal pattern (light + dark theme tokens).

import React from 'react';
import { Kbd } from '../../ui';

// The Bins tab's keyboard, as BinsView's document handler binds it (and the
// preview's Space). UI overhaul Q10 ("no shortcut bar anywhere") removed the
// footer bar that showed these on the tab; every hint it carried is here, and
// the controls that act on a selection name their key in their title.
// `keys` are the caps a person presses together; `or` separates alternatives.
export const BINS_SHORTCUTS = [
  { keys: [['↑'], ['↓']], does: 'Move (in the frame view ← and → too)' },
  { keys: [['Home'], ['End']], does: 'First and last file' },
  { keys: [['Shift', '↑'], ['Shift', '↓']], does: 'Extend the selection' },
  { keys: [['Ctrl', 'A']], does: 'Select every file shown' },
  { keys: [['Esc']], does: 'Clear the selection' },
  { keys: [['S']], does: 'Select (the review mark)' },
  { keys: [['R']], does: 'Reject' },
  { keys: [['U']], does: 'Unflag' },
  { keys: [['C']], does: 'Circle, or uncircle' },
  { keys: [['1'], ['8']], range: true, does: 'Colour; 0 clears it' },
  { keys: [['A']], does: 'Assign to shot' },
  { keys: [['Space']], does: 'Play or pause the preview' },
  { keys: [['F2'], ['Enter']], does: 'Rename' },
  { keys: [['Del'], ['Backspace']], does: 'Remove from the bin (undo in the toast)' },
  { keys: [['Ctrl', 'Z']], does: 'Undo' },
  { keys: [['Ctrl', 'Shift', 'Z'], ['Ctrl', 'Y']], does: 'Redo' },
];

function KeyCombos({ keys, range, surface }) {
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {keys.map((combo, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className={`text-caption ${surface === 'light' ? 'text-ink-light' : 'text-ink-3'}`}>{range ? '–' : 'or'}</span>}
          {combo.map((k) => <Kbd key={k} surface={surface}>{k}</Kbd>)}
        </React.Fragment>
      ))}
    </span>
  );
}

export const RABBIT_HELP_SIDEBAR_ITEMS = [
  { id: 'rabbit-overview',     label: 'Overview' },
  { id: 'rabbit-projects',     label: 'Projects' },
  { id: 'rabbit-files',        label: 'Files' },
  { id: 'rabbit-intake',       label: 'Intake wizard' },
  { id: 'rabbit-assets',       label: 'Assets' },
  { id: 'rabbit-scenes',       label: 'Scenes & shot lists' },
  { id: 'rabbit-timeline',     label: 'Timeline' },
  { id: 'rabbit-phases',       label: 'Phases & tasks' },
  { id: 'rabbit-dependencies', label: 'Dependencies' },
  { id: 'rabbit-zoom',         label: 'Zoom & weekends' },
  { id: 'rabbit-budget',       label: 'Budget' },
  { id: 'rabbit-settings',     label: 'Settings' },
  { id: 'rabbit-shortcuts',    label: 'Shortcuts & tips' },
];

// Light-theme style tokens (used by an external help page if any).
// P1-35: key for key HelpPage's `L` — one ink on the orange (the stone greys
// here were the rule's exact failure), the section title at H2 in sentence
// case, the card title at H3.
const L = {
  sectionTitle: 'text-h2 text-ink-light mb-3',
  bodyText: 'text-body text-ink-light',
  card: 'bg-well-light border border-rule-light rounded-control p-3',
  cardTitle: 'text-h3 text-ink-light mb-2',
  listItem: 'text-dense text-ink-light',
  listBold: 'font-semibold',
  notesBox: 'bg-signal/10 border border-signal/30 rounded-control p-3',
  notesTitle: 'text-label text-ink-light uppercase mb-2',
};

// Dark-theme style tokens for the in-tool help modal
// UI overhaul B6 (review round 1): onto the kit's tokens — #fb923c (orange-400)
// and the stone ramp retired from chrome. A card's title is the H3 step in the
// ink; emphasis is the ink, not a faded orange; the notes box is the signal
// tint with the ink. The section title is the ink too (round 2): the Help
// modal's own ground is #292524 (TimelineView's, B3's), where the signal
// measures 4.26:1 at 11px — round one had measured it on the paper.
// P1-35: the section title leaves the Label step for H2 in sentence case
// (Q2, §3.1), as D.O.G.'s and O.T.T.E.R.'s now are; it was capitals at 11px
// ABOVE a 14px card title, an inverted hierarchy.
const D = {
  sectionTitle: 'text-h2 text-ink mb-3',
  bodyText: 'text-dense text-ink-2 leading-relaxed',
  card: 'bg-paper-raised p-3 rounded-control border border-rule',
  cardTitle: 'text-h3 font-semibold text-ink mb-2',
  listItem: 'text-dense text-ink-2 leading-relaxed',
  listBold: 'text-ink font-semibold',
  notesBox: 'bg-signal-tint border border-signal rounded-control p-3',
  notesTitle: 'text-label font-semibold text-ink uppercase mb-2',
};

export function RabbitHelpContent({ helpPage, theme }) {
  const T = theme === 'dark' ? D : L;

  if (helpPage === 'rabbit-overview') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>R.A.B.B.I.T. overview</h3>
        <p className={`${T.bodyText} mb-4`}>
          R.A.B.B.I.T. (Resource Allocation, Budgeting, Bidding & Intake Tracker)
          is WILSON's project planning tool. It ingests intake documents,
          breaks them into phases / assets / tasks, schedules everything on a
          two-pane Notion-style timeline, tracks dependencies, and exports a
          budget summary you can hand to a client.
        </p>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Key features</h4>
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
            <h4 className={T.cardTitle}>Picking & creating</h4>
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

  // Post-overhaul S4a (E13): the Files tab, the file window, previews.
  if (helpPage === 'rabbit-files') {
    const surface = theme === 'dark' ? 'dark' : 'light';
    return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Files</h3>
        <p className={`${T.bodyText} mb-4`}>
          The Files tab holds the open project's files. It is the same
          explorer as Files on the Resources page, without the project
          picker: Table lists every file and Columns walks the folders. In
          Table, the filter matches a file's name, its path or its tags.
        </p>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>The toolbar</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Add files</span> — Puts files into the project.</li>
              <li>• <span className={T.listBold}>Add as Legal</span> — For project managers and workspace admins: puts files into the project's LEGAL folder. Only project managers and workspace admins will see these files.</li>
              <li>• <span className={T.listBold}>Relink</span> — Appears when files are missing from disk, and finds them again.</li>
              <li>• <span className={T.listBold}>File activity</span> — The selected file's history: uploaded, moved, relinked, downloaded, trashed or restored.</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>The file window</h4>
            <p className={`${T.listItem} mb-2`}>
              Click a file's name to open its details beside the list; Close
              puts them away. What you change there is saved as you go: a
              note when you leave the box (Escape puts the old note back),
              everything else at once. On the cloud each change is also
              kept in the edit history, as every edit is.
            </p>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Notes</span> — Anything worth knowing about the file.</li>
              <li>• <span className={T.listBold}>Core project file</span> — The files that give context about the project: the script, the treatment, storyboards, mood boards. Intake and D.O.G. read them as the project's context.</li>
              <li>• <span className={T.listBold}>Kind</span> — What the document is, from the same list as Intake.</li>
              <li>• <span className={T.listBold}>Tags</span> — Production, Creative, Legal, Finance, Reference, Assets, Code, Shots and Documentation; a file can carry several. Finance comes from the file being marked financial when it was added; it is not set by hand. Legal is chosen when a file is added, with Add as Legal, and stays with the file: only project managers and workspace admins can see a Legal file, it is never a core file, and to change it you add the file again. On this computer's storage (the Local Server) Legal is a folder, not a lock: restrict the LEGAL folder on the drive or NAS itself.</li>
              <li>• <span className={T.listBold}>A file of an asset, a shot or a scene</span> — Takes notes and tags. Core and Kind are for the project's own files.</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Previews</h4>
            <p className={`${T.listItem} mb-2`}>
              Double-click a file, press <Kbd surface={surface}>Enter</Kbd> on
              its name, or choose Preview in the file window. Images, video,
              audio, PDFs, Markdown, code and plain text open in a window over
              the list. <Kbd surface={surface}>←</Kbd> and <Kbd surface={surface}>→</Kbd>{' '}
              (or the arrows at its top) step through the files you are
              looking at; <Kbd surface={surface}>Esc</Kbd> closes it.
            </p>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• Video and audio wait for you to press play.</li>
              <li>• HTML and SVG show as their text, never as a page; a Markdown file's links and pictures are not opened.</li>
              <li>• A format WILSON cannot draw here (Photoshop, EXR, TIFF, 3D) says so and offers the file's own action. A text file over 2 MB is not read.</li>
              <li>• A preview is recorded in File activity as a download once its file has been read, never for one whose file could not be fetched; looking again soon after is not recorded twice.</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Download and opening</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Download</span> — Saves a copy of a file stored in the cloud.</li>
              <li>• <span className={T.listBold}>Show in folder</span> — For a file already on this computer: opens its folder with the file selected.</li>
              <li>• <span className={T.listBold}>Open in default app</span> — Opens a document, picture, video, audio or 3D file in the program your computer uses for it. Anything else (a program, a script, another app's project file) opens from Show in folder instead.</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
    );
  }

  if (helpPage === 'rabbit-intake') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Intake wizard</h3>
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

  // Post-overhaul S3b: the Scenes tab's shot lists, in the controls' own
  // words (rabbitScenesHelp.test.jsx holds them to the files that draw them).
  if (helpPage === 'rabbit-scenes') {
    const surface = theme === 'dark' ? 'dark' : 'light';
    return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Scenes and shot lists</h3>
        <p className={`${T.bodyText} mb-2`}>
          A shot list is a version of the project's scenes and shots: which
          of them it holds, and in what order. A project can have several,
          and one of them is the active list.
        </p>
        <ul className={`${T.listItem} space-y-1 ml-2 mb-4`}>
          <li>• <span className={T.listBold}>One row, many lists</span> — A scene or shot is one row shared by every shot list that holds it: rename a shot, or change its status, notes or thumbnail, in one list and it changes in every list. Only which scenes and shots a list holds, and their order, belong to the list.</li>
          <li>• <span className={T.listBold}>Viewing and active</span> — The Scenes tab shows the list you are viewing, which can differ from the project's active list. The Timeline, Budget, Tasks, Assets, Bins and every other tab show only the active list's scenes and shots.</li>
          <li>• <span className={T.listBold}>Tasks stay</span> — Clearing a list, making another one active, or taking a scene or shot out of the active list never deletes a task, a phase or anything on the Budget. A task on a scene or shot the active list does not hold reads as not assigned to it on the Timeline and the Budget (under "No scene in the active list" or "No shot in the active list"), and its tooltip there and the task's own window say what it points at. The task keeps its link: when the scene is in the active list again, so is the task.</li>
          <li>• <span className={T.listBold}>Who can do what</span> — Reviewers can make and change shot lists, but cannot add, rename or delete a scene or shot. Making a list active and archiving one are for project managers and workspace admins, except that whoever made a new list can withdraw it while nobody has saved it or saved an edit of it. On the Local Server there are no roles, so everything is open.</li>
        </ul>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>The shot list bar</h4>
            <p className={`${T.listItem} mb-2`}>
              Between the totals and the toolbar: the list you are viewing,
              marked Active when it is the project's active list (otherwise
              "Active: …" takes you to that one), and whether it has changed
              since it was last saved. Then:
            </p>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>New shot list</span> — Starts a list from the one on screen, from every scene and shot, or empty.</li>
              <li>• <span className={T.listBold}>Shot lists…</span> — Every list, to open one; also "Not in any list" (the scenes and shots no list holds) and Archived….</li>
              <li>• <span className={T.listBold}>Save</span> — Records that the list was saved as it is now: the bar says "Saved" with the date until the list next changes.</li>
              <li>• <span className={T.listBold}>Save as…</span> — A new list from this one, by default the same title at the next version.</li>
              <li>• <span className={T.listBold}>Set active</span> — Makes the list on screen the one every other tab shows.</li>
              <li>• <span className={T.listBold}>More</span> — Add from another list…, Edit details…, Clear this list (only before it is first saved), Withdraw and Archive.</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Linked, not copied</h4>
            <p className={T.listItem}>
              A new list made from another, and Add from another list…, link
              the same scenes and shots: nothing is copied. Add from another
              list… shows another list's scenes and shots, or the ones in no
              list, or every one; tick a scene to take all its shots, and the
              ones this list already holds are greyed.
            </p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Remove from this list, or delete</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Remove from this list</span> — In a row's shot-list menu (the … beside Delete), or Remove from list for a selection. Takes the scene or shot out of the list on screen only: nothing is deleted, and every other list keeps it. One no other list holds is found under "Not in any list".</li>
              <li>• <span className={T.listBold}>Delete</span> — Deletes the scene or shot from the project, and so from every list that holds it. The question names those lists.</li>
              <li>• <span className={T.listBold}>A selection</span> — Holds only what is on screen: opening another list, a search or a filter unticks the rows it hides, and closing a scene unticks its shots. A scene's own bar acts on its own ticked shots.</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Order and names</h4>
            <p className={T.listItem}>
              While a list is on screen, List order is the default sort: the
              list's own order, which Move up and Move down in a row's
              shot-list menu change. Hover a scene's or shot's name to see
              the lists that hold it.
            </p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Undo</h4>
            <p className={T.listItem}>
              On the Local Server, <Kbd surface={surface}>Ctrl</Kbd> <Kbd surface={surface}>Z</Kbd> undoes
              and <Kbd surface={surface}>Ctrl</Kbd> <Kbd surface={surface}>Y</Kbd> redoes
              on the Scenes tab, in its scene and shot windows and in the
              windows they open, but not while you type in a field, while a
              menu, a question, the settings drawer or a shot-list window is
              open, or while a delete of several rows is still going. While
              an edit is unsaved they undo and redo its own changes instead,
              on every backend.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h3 className={T.sectionTitle}>Edits</h3>
        <p className={`${T.bodyText} mb-2`}>
          An edit is a cut of a shot list: its shots in the order the film
          plays them. A shot can play more than once, a shot can be left
          out, and a new shot can be added to the list for it. A shot keeps
          its name in every edit; only the order is the edit's. Each list
          has one line of edits, each saved as a version (Title · v2).
        </p>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Seeing an edit</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Edit</span> — On the shot list bar, after the list's name: List order shows the list itself, and each saved edit of it can be chosen.</li>
              <li>• <span className={T.listBold}>The cut</span> — The edit's shots in order, numbered by their place in the cut, under the scene they play in; a scene that comes back later in the cut shows again there. The totals count the cut: Edit runtime, each shot as often as it plays.</li>
              <li>• <span className={T.listBold}>Missing shot</span> — A shot deleted from the project stays in the edit as "Missing shot:" and its old name, and counts for nothing. Undoing the delete brings it back.</li>
              <li>• <span className={T.listBold}>Shot lists…</span> — Shows each list's edits: title, version, when it was made and its summary.</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Making an edit</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Drag</span> — Drag a scene or a shot by the grip in its number cell. On a list in List order, the first drag asks "Make a new edit from this list?", and Start new edit shows the new edit; the list itself does not change. On an edit, it asks "Make a new version of this edit?", and Start new version shows the next version.</li>
              <li>• <span className={T.listBold}>New edit from this list</span> — In the bar's More menu: the same question, starting from the list's order.</li>
              <li>• <span className={T.listBold}>A row's edit actions</span> — Move up, Move down, Duplicate in edit, Add shot…, New shot and Remove from edit; a scene's: Move scene up, Move scene down, Duplicate scene in edit and Remove scene from edit. New shot adds a real shot to the list.</li>
              <li>• <span className={T.listBold}>After the first change</span> — Nothing asks again until the edit is saved or discarded.</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Saving an edit</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Unsaved</span> — An unsaved edit is saved nowhere yet: Save edit pulses slowly beside "Unsaved" (with reduced motion the pulse stops and the word stays).</li>
              <li>• <span className={T.listBold}>Save edit</span> — Saves it as the next version: by default the same title, next version, which "Same title, next version" turns off for a title of your own; add a summary of what changed.</li>
              <li>• <span className={T.listBold}>Discard changes</span> — Drops the unsaved edit; what was on screen before comes back.</li>
              <li>• <span className={T.listBold}>Recover unsaved edit?</span> — If WILSON closes before an edit is saved, the next visit to the Scenes tab offers it back. Not now keeps it: the bar's More menu then has Recover unsaved edit…, and a new edit of that list says it would replace it.</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Leaving with an edit unsaved</h4>
            <p className={T.listItem}>
              Another tab, another tool or page, another project, another
              list or edit on the bar, closing WILSON, and restarting it for
              an update each ask first: Save edit, Discard changes or Keep
              editing (Escape keeps editing). A change WILSON makes by itself
              (a tab turned off, the project closed) does not ask, and the
              unsaved edit is kept. An edit whose list is archived or
              withdrawn is kept too, out of sight, until the list is
              restored.
            </p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Who can do what with edits</h4>
            <p className={T.listItem}>
              Reviewers can make and save edits, but New shot is for the
              members who add scenes and shots. Archive this edit is for
              project managers and workspace admins. On the Local Server
              there are no roles.
            </p>
          </div>
        </div>
      </section>
    </div>
    );
  }

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
        <h3 className={T.sectionTitle}>Phases & tasks</h3>
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
        <h3 className={T.sectionTitle}>Zoom & weekends</h3>
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
              Click the gear at the right end of the tool's strip (Help sits
              beside it) to open the slide-out, from any tab. It has
              two tabs: <span className={T.listBold}>Settings</span> for
              persistent toggles and <span className={T.listBold}>System prompts</span>
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
        <h3 className={T.sectionTitle}>Shortcuts & tips</h3>
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
          <div className={T.card}>
            <h4 className={T.cardTitle}>Bins: the keyboard</h4>
            <p className={`${T.bodyText} mb-2`}>
              On the files pane, with a file selected. Click selects one file, Shift-click extends, Ctrl-click adds or removes one. The keys act only while R.A.B.B.I.T. is the page on screen and nothing is open over it.
            </p>
            <dl className="grid gap-x-4 gap-y-1.5 items-center" style={{ gridTemplateColumns: 'max-content 1fr' }}>
              {BINS_SHORTCUTS.map((s) => (
                <React.Fragment key={s.does}>
                  <dt><KeyCombos keys={s.keys} range={s.range} surface={theme === 'dark' ? 'dark' : 'light'} /></dt>
                  <dd className={T.listItem}>{s.does}</dd>
                </React.Fragment>
              ))}
            </dl>
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
