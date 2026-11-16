# Walkthrough 39 — R.A.B.B.I.T.: Tasks, the task popup, New task and task templates (UI overhaul B2)

For Audrey, at the end of the UI pass (W14: nothing here waits on you).
About 20 minutes. Open R.A.B.B.I.T. from your own checkout of
`feat/ui-overhaul`, pick a project, and open the Tasks tab. Part B needs the
packaged desktop app with your real data.

Before and after screenshots, at 1440x900 and 1280x700, are in
`docs/sessions/handoffs/img/b2-before-*.png` and `b2-after-*.png`.

---

## Part A — what changed, and what to check (any mode)

### 1. The four numbers at the top

- **They are the same tile Summary uses now**: the label on top, the number
  under it, one size. *Tasks completed* keeps its green number.
- **Check:** the numbers match what they said before.

### 2. The toolbar

- **Every control is the same height and on one line** at a normal window
  size. In the narrowest desktop window it wraps onto a second line rather
  than cutting anything off.
- **Table / Board is an underline now, not an orange block** (your orange
  rule: no small text on orange).
- **Filter, Sort and Group show an orange edge while they are doing
  something** (a filter set, a sort chosen, a grouping chosen). They used to
  turn their text orange. On the board, Group shows the edge only when it is
  set to something other than status.
- **New task is the one orange button.** Key date lost its amber text.
- **Check:** use each control once. Filter adds a row, Sort sorts, the arrow
  beside Sort flips the order, Group groups, Views saves and loads a view,
  Search filters, Export downloads, Phase and Key date create, New task opens
  its dialog.

### 3. The table

- **It is a real table now.** The column headings sit exactly over their
  columns. They used to sit 12px to the left of them (24px when grouped).
- **Rows are one hairline apart instead of each being a bordered box.** A
  ticked row gets the one selection treatment: a faint orange tint and an
  orange edge on the left.
- **The little arrows on the dropdown cells and the calendar icons on the
  dates only appear on the row under your pointer.** Five arrows on every
  row were most of the table's ink.
- **Status is a coloured dot plus the word.** Priority is coloured only when
  it is *High* (amber) or *Urgent* (red), the same as the Dashboard.
- **The row buttons (details, history, delete) appear on hover and also when
  you Tab to them** with the keyboard.
- **Bid is right-aligned**, so the numbers line up, and a key date's empty
  Bid dash lines up with them.
- **An empty cell shows one long dash (—)** everywhere; some used to show
  two hyphens.
- **Grouped by phase, each phase's dates sit right after its name**, at the
  same place in every group, so they stay on screen in a narrow window.
- **Check:** tick a row: the bar with the bulk actions appears over the
  heading. Its *Delete* now asks in the standard dialog (it was a Windows
  pop-up). Edit a title and press Escape: it goes back. Drag a row onto
  another group when grouped by status: it moves, and only that group's
  heading lights up while you drag. In a long group, drag a row near the
  group's end: the group's heading stays pinned under the column headings
  while you drag, so you can see where the row will land.
- **Key dates** keep their coloured diamond. Their date now reads like the
  task dates (08/03/2026), and a new, unnamed key date says *Untitled key
  date* so you can click it to name it. Deleting one asks in the standard
  dialog. **Their names and dates can be reached with Tab now** (press Space
  to edit; see question 10 about Enter).
- **In the narrowest desktop window (1024px) the table scrolls sideways**
  instead of squeezing a date onto two lines. At 1280px it fits, and the
  Title column keeps at least 200px.

### 4. The board

- Columns are on the raised surface, cards on the page colour, each card
  with its status dot. The card buttons appear on hover. A card's date reads
  like the table's.
- **Check:** drag a card to another column. Open a card's details.

### 5. The task popup (from Tasks, from the Dashboard, from Timeline)

- **It is the standard dialog now**, the same as every other dialog: no
  thick orange frame, no heavy shadow. It is 720px wide on its own and 960px
  with the files column.
- **The title at the top is the dialog's heading, and the Title field below
  is where you edit it.** They were the same size and colour before.
- **The status sits under the title as a badge**, where a coloured bar used
  to be.
- **The fifteen fields are in four groups** (Workflow, Placement, People,
  Schedule and cost), in the same order as before.
- **Escape closes it now.** If you are typing in a field, the first Escape
  undoes the typing and the second closes the popup.
- **Clicking outside closes it, and keeps what you were typing.**
- **Check on the Dashboard too:** click a task row. The same popup opens.
  *Delete task* still asks the Dashboard's question first, and Escape on
  that question closes only the question.

### 6. New task

- The standard dialog at the form width. Every field and default is where
  it was. A failed save shows its message next to the buttons.
- **Check:** create a task. Then open New task, type a title, press Escape:
  the dialog closes and nothing is created.

### 7. Task templates (Settings → Storage → Manage task templates, or the Timeline's settings)

- All three windows (the list, the editor, the delete question) are the
  standard dialog. The editor opens on top of the list.
- **New template is at the top of the list** rather than beside the ✕.
- The *Depends on* list works as before: a click outside it closes it
  without pressing whatever was underneath. **It now opens above its row
  when there is no room below**, and it closes when you Tab away from it.
- **Check:** open the editor, add a task, set its dependency, press Escape
  three times: the list closes, then the editor, then the manager.

---

## Part B — the packaged app, with your real data

1. **A task with files, in Local Server mode.** Open its details. The files
   column shows the asset's files. Play a video: Escape does nothing while
   the video is open (it did nothing before either). Add a note to a file
   and press Escape: the note is cancelled and the popup stays.
2. **Timeline:** double-click a task bar. The same popup opens.
3. **Scenes, Levels, Experiences:** open a scene's details and click a task
   in it. The task popup opens on top; Escape closes only the task popup.
4. **125% and 150% Windows scaling:** the Tasks table and the popup at a
   small window. Nothing should be cut off; the table may scroll sideways.

---

## Questions (carried in the hand-off; answer any time)

1. **The standard dialog adds a ✕ to the small dialogs that had none**
   (Save view, Create phase, and the delete questions). It does the same as
   Cancel. Keep it, or ask for the ✕ to be left off question dialogs?
2. **Clicking a dropdown's caption in the task popup (Status, Priority,
   Assignee…) now puts focus on that dropdown.** That is how the standard
   form field works everywhere else. The captions of Title, Description and
   Notes do nothing, as before. Keep?
3. **The Tasks table scrolls sideways in the narrowest window (1024px).**
   Ten columns do not fit otherwise without cutting dates in half. Is
   sideways scrolling acceptable there?
4. **Key-date colours**: your key dates keep their own colours, including
   blues and pinks, because they are your data. The app's own chrome has no
   cool colours. Keep the data colours?
5. **Priority colour only on High and Urgent** (Medium and Low are plain),
   matching the Dashboard. Right?
6. **The task popup's four group headings** (Workflow, Placement, People,
   Schedule and cost). Do the names read right?
7. **New templates are now called "New template"** by default (it was
   "New Template"). Existing template names are unchanged.
8. **New task's "Assigned to" is now "Assignee"**, the word the task popup
   uses for the same field.
9. **Export stays a text button.** The review suggested an icon, but that
   would hide its name. Keep the text?
10. **Enter on a focused button opens or closes your companion** instead of
    pressing the button, everywhere in the app (it predates this work).
    Space presses the button. Should Enter press buttons, with the companion
    on another key?
