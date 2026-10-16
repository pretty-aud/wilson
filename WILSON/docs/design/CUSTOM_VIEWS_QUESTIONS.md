# Custom table views (VW1) — the questions before the design (2026-10-13)

Your words of 2026-10-13: *"lets do a research phase first, then ask me any
questions to clarify things and not make any assumptions."* The research is
`docs/design/CUSTOM_VIEWS_RESEARCH.md` (how Notion does it, how WILSON's
five tables work today, the gap, the pictures). Below is every decision the
design would otherwise make for you, in plain words, each with two to four
choices and the one I would pick first, marked *(Recommended)*, with the
reason. They are asked in this session's chat four at a time; your answers
are written in under each batch, word for word, as they come. Nothing is
designed or built until they are in.

**Already settled by your words, so not asked:** you make your own views; you
make them from a dropdown opened by the *Views* control; a view holds
filters, sorting, grouping and which fields show; views belong to a project;
the Filter button, the Sort dropdown and the Group dropdown stay; it covers
Tasks, Scenes, Assets, Levels and Experiences.

**The UX laws behind the picks** (the `laws-of-ux` and `design-direction`
skills, loaded for this list): *Jakob's law* (people expect a view to behave
as Notion's does), *Hick's law* and *choice overload* (a short list of views;
the editor's power behind one click, not on the toolbar), *working memory*
(see the table change while you build the view), *Tesler's law* (the
complexity lives in the editor, not in every person's day), and
*forgiveness* (nothing a teammate relies on changes by accident; Reset and
undo).

---

## Batch 1 — who sees a view, who can change it, what opens first (answered)

**Q1. Who sees a view you save?**
Today a saved view lives in one browser for one person, and every project
shares the list. In Notion every view is shared by everyone, and a person's
filter or sort change stays their own until *Save for everyone*.
- **You choose, each time** *(Recommended)*: when you save a view you pick
  *Everyone on this project* or *Only me*.
- **Everyone on the project**: every view is shared with the project's team.
- **Only me**: every view is your own (still per project, following you to
  any computer); teammates make their own.

**Q2. Who may create, change and delete a view everyone sees?**
(WILSON's roles: company-wide admin, manager or user; on a project,
manager, member or reviewer.)
- **Managers and admins** *(Recommended)*: the project's managers, and the
  company's admins and managers; members and reviewers make their own *Only
  me* views.
- **Anyone who can edit the project**: the above plus the project's members
  (who already edit its tasks and scenes); reviewers use shared views.
- **Everyone on the project**: reviewers too.

**Q3. While a view is open, what do the Filter, Sort and Group controls do to
it?**
- **Change it until you save** *(Recommended)*: the table changes at once;
  the Views button shows the view as *edited*, with *Save* and *Reset*.
- **Save into the view at once.**
- **Never touch the view**: the toolbar is always for the moment only; a
  view changes only through the Views dropdown's own editor.

**Q4. What does a table show when you open it?**
- **The view you last used** *(Recommended)*: each table opens on the view
  you last used there, in that project; the very first time, on the built-in
  *All* view (today's table: every field, nothing filtered).
- **A project default**: a manager picks one view per table.
- **Always All.**

### Her answers, batch 1 (2026-10-13; asked in chat as multiple choice; recorded verbatim)

- **Q1:** "Everyone on the project"
- **Q2:** "Anyone who can edit"
- **Q3:** "similar to notion, let people create specific view for the exact session they are in. and give them a button to save the view for later.  so use pre saved views, if the user starts to make their own unique view, please allow them to use it just for that moment AND allow them to save it for future use. again refer to Notion UX for this"
- **Q4:** "The view you last used (Recommended)"

### What follows from batch 1 (say if any is wrong)

- **Every view is shared with the project's team**; there are no *Only me*
  views.
- **Who may save, change and delete views:** the project's managers and
  members, and the company's admins and managers (everyone who can already
  edit the project). **Reviewers** use every view and can change one for the
  moment (Q3), but cannot save it.
- **A change made with Filter, Sort or Group (or in the editor) is for the
  moment until it is saved**, and there is a button to save it for later
  (Q3). What that button does to an already-saved view, and how long "the
  moment" lasts, are the follow-ups Q3a and Q3b.
- **Each person opens each table on the view they last used there**, per
  project (Q4); on the signed-out desktop, per computer.
- **The signed-out desktop (old Q18, answered by Q1 and your rule that it
  works the same on the cloud or a NAS):** views are saved with the
  project's data on that computer or NAS, so they survive restarts and
  everyone using the project there sees them. With no sign-in there, anyone
  using it may save views (there are no roles to check); the walkthrough
  says so in one line.

---

## Batch 2 — saving a view, and the Views dropdown (answered)

**Q3a. When you have changed an open view, what does saving do?** (A
follow-up to your Q3 answer.)
- **Save, or Save as new** *(Recommended)*: the changed view shows *Save*
  (writes the change into this view, for everyone), *Save as new view*
  (keeps the original and names a new one) and *Reset* (back to the view as
  saved). The built-in *All* view cannot be changed or deleted, so there is
  always a way back to the whole table; from it, only *Save as new view* is
  offered. Reviewers see only *Reset*: their changes are for the moment.
- **Save as new only**: a change never alters a saved view from the
  toolbar; to change a view itself, use *Edit* in the Views dropdown. The
  changed view shows *Save as new view* and *Reset*.
- **Save only (Notion's way)**: *Save* writes the change into this view for
  everyone (Notion's *Save for everyone*); new views are made with *New
  view* in the dropdown.

*Why my pick:* your words name both: "save it for future use" (a new view)
and "refer to Notion" (Notion's *Save for everyone* updates the view). The
buttons show only while there is a change (Hick's law: no clutter at rest).

**Q3b. How long does a change you have not saved last?**
- **While WILSON is open** *(Recommended)*: going to another tab and coming
  back keeps it; closing WILSON, reloading, or switching project drops it,
  and the table then opens on the last saved view you used (your Q4).
- **Until you leave the table**: as today, opening another R.A.B.B.I.T. tab
  drops it.
- **Until you save or reset it**: kept for you even after closing WILSON
  (Notion keeps a person's unsaved changes), until you save or reset.

*Why my pick:* your words "for the exact session they are in" and "just for
that moment"; moving between tabs is part of one piece of work, closing
WILSON is not.

**Q5. What should the Views dropdown hold, and where do you build a view?**
The dropdown opens from today's *Views* button (on Scenes the bookmark icon
becomes the word *Views*, as on the other tables). In every choice the
button shows the name of the view on screen, and *edited* while it has a
change.
- **A list, and an editor at the side** *(Recommended)*: the dropdown lists
  the project's views, the one on screen ticked; for people who may save
  views, *New view* at the bottom and a *…* menu on each view (Edit, Rename,
  Duplicate, Delete; Delete asks first). *New view* and *Edit* open a panel
  at the side of the table with four parts (Filters, Sort, Group, Fields),
  and the table follows as you change them, so you see the result while you
  build it.
- **Everything inside the dropdown**: like Notion's settings menu, the
  dropdown itself becomes the editor, one part at a time (Filters ›, Sort ›,
  Group ›, Fields ›), the table following behind it.
- **Tabs above the table**: each view is a tab above the table, as in
  Notion; the editor opens from a tab's menu. It takes a new row of space
  above every table.

*Why my pick:* you see the table while you build the view (working memory);
the toolbar keeps its height and place (your rule: keep things relatively
the same); the dropdown stays a short list (Hick's law).

**Q6. Which fields can a view hide?**
- **All but the name** *(Recommended)*: every field can be turned off except
  the item's name, which always shows (it opens the item and holds its
  buttons). In Tasks, the key dates can be turned off too.
- **All but the name, key dates always shown**: the same, but the Tasks
  table's key dates always show.
- **Every field, the name too.**

*Why my pick:* the name is how you recognise and open a row; a Tasks view
about one asset's work may not want the project's key dates in it.

### Her answers, batch 2 (2026-10-13; asked in chat as multiple choice; recorded verbatim)

- **Q3a:** "Save, or Save as new (Recommended)"
- **Q3b:** "While WILSON is open (Recommended)"
- **Q5:** "option 1 but make it similar to the notion system where it is a dropdown where you can select what you want to view and edit and a second dropdown /card appears. so if i press on the option for filters a card with just filters should pop up. again like notion"
- **Q6:** "All but the name (Recommended)"

### What follows from batch 2 (say if any is wrong)

- **A changed view shows *Save*, *Save as new view* and *Reset*** (only
  while it has a change). *Save* writes into the view for everyone; *Save as
  new view* names a new one; *Reset* returns to the view as saved. The
  built-in *All* view cannot be changed or deleted (only *Save as new view*
  from it). Reviewers see *Reset* only.
- **A change you have not saved lasts while WILSON is open**: going to
  another tab and back keeps it; closing WILSON, reloading or switching
  project drops it, and the table opens on the last saved view you used.
- **The Views dropdown** (opened from today's *Views* button, which shows
  the name of the view on screen and *edited* while it has a change; on
  Scenes the bookmark icon becomes the word *Views*): it lists the project's
  views with the one on screen ticked, and holds what you can view and edit,
  Notion-style: choosing **Filters**, **Sort**, **Group** or **Fields** opens
  a card with just that part. For people who may save views it also holds
  *New view* and, on each view, a *…* menu (Edit, Rename, Duplicate,
  Delete; Delete asks first). My side panel is dropped. Where that second
  card opens is Q5a.
- **Fields:** every field but the item's name can be hidden; in Tasks, the
  key-date rows can be turned off too.

---

## Batch 3 — the card, and a task's linked items in the table (your screenshot) (answered)

**Q5a. When you press Filters (or Sort, Group, Fields) in the Views dropdown,
where does its card appear?** (A follow-up to your Q5 answer.)
- **In place of the list, with a back arrow** *(Recommended)*: the dropdown
  becomes the Filters card (one card at a time); a ← at its top returns to
  the list. It covers only as much of the table as the dropdown did, so you
  see the rows change as you set the filter.
- **Beside the dropdown**: the Filters card opens next to the dropdown and
  both stay open; it covers more of the table.

*Why my pick:* one card at a time keeps the table in view while you work
(working memory) and the place you are in obvious (common region); on a
1280 screen two cards side by side would cover half the table.

**Q9. In the Tasks table, what should the Asset column show for a task linked
to several assets?** (Your words: "either shows all or none".)
- **All of them** *(Recommended)*: every linked asset by name, side by side,
  the main (first) one first; when they do not fit, as many as fit and
  "+2", with the whole list when you hover.
- **None**: the Asset column leaves the Tasks table; a task's linked items
  show only in its window.
- **A count**: "2 assets", with the names when you hover.

*Why my pick:* the information stays where you are looking, and it is how a
Notion relation cell reads.

**Q10. Clicking that cell should…**
- **Let you pick several there** *(Recommended)*: a small picker opens on
  the cell, like Notion's: every asset of the project with a tick box and a
  search box (two assets with the same name show their type and phase so you
  can tell them apart); tick or untick several; the order and the main one
  stay as the task's window sets them.
- **Open the task's window**: the cell is not editable in the table;
  clicking it opens the task's window at its Items table.
- **Keep one choice**: today's dropdown (it changes the first asset only),
  with the others shown beside it.

*Why my pick:* you edit where your eye already is (Fitts's law), the way
Notion does.

**Q11. Your note said "i can see the levels or scenes or shots related". Did
you mean you can NOT see them in the Tasks table, and want them there?**
- **Yes, a column for each** *(Recommended)*: Scene, Shot, Level and
  Experience columns join the Tasks table, each working like the Asset
  column (every linked item shown, the picker on click), and you can filter
  and group by them; like any field, a view can hide them. Level and
  Experience show only on projects that use them.
- **Yes, one Items column**: one column listing every linked item of every
  kind (assets, scenes, shots, levels, experiences) together.
- **No, they are fine where they are** (the task's window).

*Why my pick:* each kind reads and edits like the Asset column you know
(law of similarity), and a view can show only the kinds it needs.

### Her answers, batch 3 (2026-10-13; asked in chat as multiple choice; recorded verbatim)

- **Q5a:** "so when i press in filters show me a card with the current existing and set filters. then have a button to allow me to create a new filter. when i start to make a filter use the interface you create before for filters but in the dropdown card"
- **Q9:** "All of them (Recommended)"
- **Q10:** "Pick several there (Recommended)"
- **Q11:** "Yes, a column for each (Recommended)"

### What follows from batch 3 (say if any is wrong)

- **The Filters card** lists the view's filters as they are set now, then a
  button to add a new filter; a new filter is made with today's filter rows
  (*Where / And*, field · condition · value), inside the card. The Sort,
  Group and Fields cards follow the same pattern: what is set now, then the
  way to add or change it. Where the card opens was not answered; it is
  Q5b, with a picture of each.
- **The Tasks table's Asset column shows every linked asset** by name, the
  main one first, "+2" when they do not fit, the whole list on hover; the
  Board's cards name them all too.
- **Clicking the cell opens a picker**: every asset of the project with a
  tick box and a search box (same-named assets show their type and phase);
  tick or untick several; the order and the main one stay as the task's
  window sets them.
- **Scene, Shot, Level and Experience columns join the Tasks table**, each
  working like the Asset column; Level and Experience show only on projects
  that use them; a view can hide any of them.
- **Filtering by any of these kinds finds a task through any of its items**
  ("Asset is Storm Lantern" finds a task whose second asset is Storm
  Lantern), as the cell shows them all. Today the Asset filter matches the
  first asset only.

---

## Batch 4 — where a card opens, grouping by a linked item, the other tables, columns (answered)

**Q5b. Where does a card open?** (Your Q5a answer said what the Filters card
holds; this asks only where it appears. In the chat each choice has a
picture.)
- **In place of the list, with a back arrow** *(Recommended)*: the dropdown
  becomes the Filters card, one card at a time; a ← at its top returns to
  the list of views and parts. It covers only as much of the table as the
  dropdown did, so you watch the rows change as you set the filter.
- **Beside the dropdown**: the Filters card opens next to the dropdown and
  both stay open; it covers more of the table (about half of it at 1280).

*Why my pick:* the table stays in view while you work (working memory), and
the card you are in is the only thing open (common region).

**Q11a. Grouping the Tasks table by Asset (or Scene, Shot, Level,
Experience): where does a task linked to two of them go?** (FX2 asked you a
wider version of this, for the Timeline and the Budget too; it is still
open there. This asks only about the Tasks table.)
- **Once, under its main one** *(Recommended)*: the task shows once, under
  its first (main) asset; its cell names the others. The groups' counts add
  up to the number of tasks, as the Timeline and the Budget count today.
- **Under each of them**: the task shows in the group of every asset it is
  linked to (twice for two); each group lists all the work about that asset,
  and the counts add up to more than the number of tasks.

*Why my pick:* one row per task keeps the counts, the ticked rows and bulk
changes honest; the cell already names every asset, and filtering by an
asset finds the task wherever it is linked.

**Q12. The other four tables: should they show their linked items too?**
Today Assets shows a count of its tasks (right); Scenes and Shots show no
tasks or assets; Levels and Experiences show counts of assets and tasks
that are wrong (assets always 0; a task counted only under its first level,
so "Cliff Path" reads 0 and 0 while its window lists 2 assets and 1 task).
- **Fix the counts; no new columns** *(Recommended)*: every count counts
  every link (so a level's numbers match its window), and views can show or
  hide the counts; no new columns in this work.
- **Names, as in Tasks**: each table also gets linked-item columns by name
  (Assets: its scenes and shots; Scenes: its assets and tasks; Levels and
  Experiences: their assets and tasks), each a field a view can show or
  hide.

*Why my pick:* your note was about the Tasks table; the counts are wrong and
should be right either way; names in the other tables can follow once the
Tasks columns have been used.

**Q7. Can a view change the columns' order and width?**
- **Order, not width** *(Recommended)*: you drag fields up and down in the
  view's Fields list to reorder the columns; widths stay as WILSON sets them
  today (the name takes the room left, up to 360px).
- **Order and width**: you can also drag a column's edge to make it wider or
  narrower, kept with the view.
- **Neither**: only show and hide; the order stays as it is.

*Why my pick:* the widths were set so every table fits a 1280 screen
(FX8); free widths bring sideways scrolling back. Notion does allow widths,
so it is a real choice.

### Her answers, batch 4 (2026-10-13; asked in chat as multiple choice, Q5b and Q11a with a picture of each choice; recorded verbatim)

- **Q5b:** "In place, with a back arrow (Recommended)"
- **Q11a:** "Once, under its main one (Recommended)"
- **Q12:** "Fix counts, no new columns (Recommended)"
- **Q7:** "Order, not width (Recommended)"

### What follows from batch 4 (say if any is wrong)

- **A card opens in place of the dropdown's list**, one at a time, with a ←
  back to the list; the table stays in view below it.
- **Grouped by a linked kind, a task shows once, under its main item**; its
  cell names the others; the groups' counts add up to the number of tasks.
- **The other four tables get no new columns**; every count counts every
  link (Levels' and Experiences' asset and task counts, the scene window's
  asset count), and a view can show or hide the counts.
- **A view sets the columns' order** (dragging fields in the Fields card) and
  which show; **widths stay as WILSON sets them**.

---

## Batch 5 — what a view remembers, filters, sorts, grouping (answered)

**Q8. Besides filters, sorting, grouping and fields, what else does a view
remember?**
- **Its layout and size** *(Recommended)*: whether it is the Table, the
  Board or the Gallery, and the picture or card size, as saved views do
  today. The search box is never saved.
- **Its layout, size and the search text.**
- **Nothing else**: the layout and size stay as you left them whichever
  view you pick.

*Why my pick:* a "Board by status" view should open as a board; a search is
a moment's question, not a way of reading the project (Notion does not save
it either).

**Q13. How much can a view's filter do?**
- **All must match, any of several values** *(Recommended)*: as the Filter
  button works today (every condition must match), plus one thing: a
  condition can match any of several values ("Status is In progress or
  Pending review").
- **And / Or groups**: Notion's advanced filters: conditions joined by *and*
  or *or*, gathered in groups.
- **Exactly as today**: every condition must match, one value each.

*Why my pick:* it covers what a production table needs ("my open work")
without the and/or puzzle Notion itself moved out of sight in 2022.

**Q14. How many sorts can a view hold?**
- **Several, in order** *(Recommended)*: for example by Phase, then by Start
  date, set in the Sort card; the toolbar's Sort dropdown still sets the
  first.
- **One, as today.**

*Why my pick:* a schedule reads by phase and then by date; one sort cannot
say that.

**Q15. Grouping in a view:**
- **One grouping, and hide empty groups** *(Recommended)*: one grouping as
  today, plus a switch to show or hide groups with nothing in them, on every
  table.
- **Groups within groups**: a second grouping inside each group (Status,
  then Priority).
- **As today.**

*Why my pick:* today empty groups show in one place only (the Tasks table's
Status grouping); the switch makes every table behave one way. Notion's
tables cannot sub-group either (only its boards).

### Her answers, batch 5 (2026-10-13; asked in chat as multiple choice; recorded verbatim)

- **Q8:** "layout if anything"
- **Q13:** "All match, several values (Recommended)"
- **Q14:** "Several, in order (Recommended)"
- **Q15:** "One, and hide empty (Recommended)"

### What follows from batch 5 (say if any is wrong)

- **A view remembers its layout** (Table, Board or Gallery) besides its
  filters, sorts, grouping and fields; **not** the picture or card size
  (that stays as you left it, as today) and **never** the search.
- **Filters:** every condition must match; a condition can match any of
  several values ("Status is In progress or Pending review").
- **Sorts:** several, in order, set in the Sort card; the toolbar's Sort
  dropdown sets the first.
- **Grouping:** one grouping, with a switch to show or hide empty groups, the
  same on every table.

---

## Batch 6 — Scenes and Shots, the old views, Budget and Team, ready-made views (answered)

**Q16. Scenes and Shots: one list of views, or two?**
- **Two lists** *(Recommended)*: Scenes views and Shots views are separate,
  because their fields differ (a Shots view can filter by framing, a Scenes
  view cannot); the dropdown shows the list for the mode you are in.
- **One list**: each view remembers whether it shows Scenes or Shots, and
  picking it switches the mode.

*Why my pick:* today the two modes share one filter list and one sort, and a
Shots filter can empty the Scenes table (research §2.7); two lists end
that.

**Q17. Your saved views today live in each browser and are shared by every
project. Now views belong to the project and everyone on it sees them. What
happens to the old ones?** (On the desktop they most likely already vanish
at every restart: research §2.2.)
- **Offer to bring them in** *(Recommended)*: the first time someone who may
  save views opens a table's Views in a project, it offers that browser's
  old views for that table once: bring them into this project (everyone on
  it will see them) or delete them. A filter that points at something not in
  this project is dropped, and it says so.
- **Start fresh**: the old views are removed; you make new ones.
- **Keep them apart**: they stay in that browser as a separate *From this
  computer* list beside the project's views.

**Q19. Budget's Expenses and the Team tab have saved views too (you did not
name them). What about them?**
- **Later** *(Recommended)*: they stay as they are in this work; once the
  five tables have their new views, the same comes to them in a later
  session.
- **Now**: they get the new views in this work too.
- **Remove theirs**: their saved views are taken out.

**Q20. Should a table come with ready-made views?**
- **Only All** *(Recommended)*: each table has the built-in *All* view; you
  make the rest.
- **A few starters**: for example Tasks: *By phase*, *Overdue*; Scenes: *By
  status*; Shots: *By scene*; each can be deleted.

### Her answers, batch 6 (2026-10-13; asked in chat as multiple choice; recorded verbatim)

- **Q16:** "Two lists (Recommended)"
- **Q17:** "Start fresh"
- **Q19:** "Later (Recommended)"
- **Q20:** "Only All (Recommended)"

### What follows from batch 6 (say if any is wrong)

- **Scenes and Shots each have their own list of views**; the dropdown shows
  the list for the mode on screen.
- **The five tables' old views are removed** (the lists each browser keeps
  for Tasks, Assets, Scenes, Levels and Experiences); everyone starts from
  the built-in *All* view.
- **Budget's Expenses and the Team tab keep their saved views as they are**;
  the new views come to them in a later session.
- **Each table comes with the built-in *All* view only.**

---

## Batch 7 — where saving sits, what All shows, the views' order, what was found along the way (answered)

**Q3c. While a view has a change, where do *Save*, *Save as new view* and
*Reset* sit?** (Today the Tasks, Scenes and Shots toolbars already take two
lines at 1280; Assets, Levels and Experiences fit on one.)
- **A bar under the toolbar** *(Recommended)*: while the view has a change, a
  slim bar under the toolbar says "Shoot week: changed for now" with
  *Reset*, *Save as new view* and *Save*; it goes when you save or reset. The
  toolbar does not move. (Notion shows its *Reset* / *Save for everyone*
  under the view tabs in the same way.)
- **In the toolbar, after Views**: the three buttons appear right after the
  Views button; on a smaller screen the toolbar wraps onto a second line.
- **Inside the Views dropdown**: the Views button reads "Shoot week ·
  edited"; *Save*, *Save as new view* and *Reset* sit at the top of the
  dropdown.

*Why my pick:* the change is impossible to miss (Von Restorff) without
moving or crowding the toolbar, and the buttons go away when there is
nothing to save.

**Q6a. What does the built-in *All* view show in the Tasks table, now that
Scene, Shot, Level and Experience columns join it?** Today the table needs
1,238px and fits a 1280 window with nothing to spare; each new column adds
about 150px (two on a film project: about 1,540px; four on a project with
both scenes and levels: about 1,840px).
- **Every column, the name kept in view** *(Recommended)*: *All* is the
  whole table: every column the project uses (Scene and Shot where the
  project has scenes, Level and Experience where it uses them). A narrower
  window scrolls the table sideways, as the Shots table does today, and the
  task's name stays in place while the rest scrolls. Views you make trim it.
- **Today's columns only**: *All* keeps today's columns and fits as now; the
  new columns show in views you make (one view, made once for the project,
  shows them for everyone).

*Why my pick:* you asked to see what a task is about; *All* should show it
without a view to make first. Keeping the name in view keeps every row
readable while you scroll.

**Q5c. How are the views ordered in the dropdown?** (*All* is always first.)
- **The order they were made, and dragged** *(Recommended)*: a new view goes
  to the end; anyone who can save views can drag one to another place, and
  everyone sees that order (as Notion's view tabs).
- **Alphabetical**: always A to Z.

**Q21. The research found defects in the same controls (research §2.7).
Fix them in this work?**
- **Fix the ones in these controls** *(Recommended)*: fix the defects inside
  the Filter, Sort, Group and Views controls: a new filter row empties the
  table; a filter row keeps the wrong condition when its field changes;
  Scenes and Shots share one filter list and one sort; ticked rows stay
  ticked when a filter hides them; a saved view cannot be opened by keyboard
  and Escape does not close the menus. The rest (the Tasks CSV export's
  missing columns, the Expenses filter's "Untitled" tasks) are recorded for
  later.
- **Fix them all**: the CSV export and the Expenses filter too.
- **Record only**: fix nothing beyond the views themselves; record every
  defect in `docs/OUTSTANDING.md`.

### Her answers, batch 7 (2026-10-13; asked in chat as multiple choice, Q3c and Q6a with pictures; recorded verbatim)

- **Q3c:** "A bar under the toolbar (Recommended)"
- **Q6a:** "Every column, name in view (Recommended)"
- **Q5c:** "Made order, draggable (Recommended)"
- **Q21:** "Fix those in these controls (Recommended)"

### What follows from batch 7 (say if any is wrong)

- **While a view has a change, a slim bar under the toolbar** says "<view>:
  changed for now" with *Reset*, *Save as new view* and *Save* (for
  reviewers, *Reset* only; from *All*, no *Save*); it goes when the change
  is saved or reset; the toolbar does not move.
- **The Tasks table's *All* view shows every column the project uses**
  (Scene and Shot where it has scenes, Level and Experience where it uses
  them); a narrower window scrolls the table sideways, and the task's name
  stays in place while the rest scrolls.
- **Views are listed in the order they were made**, *All* first; anyone who
  can save views can drag one to another place, and everyone sees that
  order.
- **Fixed in this work:** a new filter row no longer empties the table; a
  filter row's condition follows its field; Scenes and Shots keep separate
  filters and sorts; ticked rows that a filter or search hides are unticked;
  the views menu works by keyboard and Escape closes it. **Recorded for
  later** in `docs/OUTSTANDING.md`: the Tasks CSV export's missing columns,
  the Expenses filter's "Untitled" tasks, and the other findings of research
  §2.7 outside these controls.

---

## Batch 8 — when a teammate saves the view you have open (answered)

**Q3d. A teammate saves a change to a view you have open. What does your
table do?**
- **It follows** *(Recommended)*: your table updates in place. If you have
  a change of your own that you have not saved, yours stays on screen and the
  bar under the toolbar says the view was changed by someone else (*Reset*
  brings theirs).
- **It waits**: your table keeps what you opened until you pick the view
  again or reopen the table.

*Why my pick:* everyone reading "Shoot week" sees the same thing, without
losing a change of your own.

### Her answers, batch 8 (2026-10-13; asked in chat as multiple choice; recorded verbatim)

- **Q3d:** "It follows (Recommended)"

### What follows from batch 8 (say if any is wrong)

- **A teammate's save reaches your open table at once.** If you have an
  unsaved change of your own, yours stays on screen and the bar under the
  toolbar says the view was changed by someone else; *Reset* brings theirs.

**Every question is answered (2026-10-13).** The design is
`docs/design/CUSTOM_VIEWS_DESIGN.md`, written to these answers.

---

## Batch 9 onward — the design's remaining questions (prepared 2026-10-13, not yet asked)

Writing the design and its two review rounds found twelve more things she
will see that her answers do not reach. At her word (*"im going to sleep.
please continue. leave any remaining questions for tomorrow"*) they were not
asked that night. They are in the design's §10 (Q-A to Q-J, Q-G in three),
each with its choices, the recommended one first, and the **interim choice**
a build session uses until she answers. Ask them four at a time, as above,
and record her answers here, verbatim, under "Her answers, batch 9" and on.

### Her answers, batch 9 (asked as a numbered list 1–12 in VW1's close-out of 2026-10-13; answered by number in the chat on 2026-10-16; recorded verbatim)

| # | Question (design §10) | Her answer |
|---|---|---|
| 1 | Q-A, room for the view's name on the Tasks toolbar | "can we try make more room in the toolbar for the views name. if its the button lets just make it longer. what did you mean by a dot?" |
| 2 | Q-B, Scenes and Shots on two lines at 1440 | "keep" |
| 3 | Q-C, the Tasks tab's two groupings | "keep" |
| 4 | Q-D, dragging a task onto another item's group | "what main item?" |
| 5 | Q-E, fields on cards | "yes. allow the user to select what shows in the cards" |
| 6 | Q-F, reviewers and the editing controls | "hidden" |
| 7 | Q-G1, a *New view* saved at once, starting as *All* | "yes" |
| 8 | Q-G2, the item columns after Priority at 150px | "yes" |
| 9 | Q-G3, *Save* over a teammate's newer save | "go with your pick" |
| 10 | Q-H, switching views with a change for now | "dont ask" |
| 11 | Q-I, empty groups when a table is first grouped | "go with your pick" |
| 12 | Q-J, the pictures and numbers in front of the name | "what are you asking? elaborate" |

### What follows from batch 9 (say if any is wrong)

- **Scenes and Shots** keep their search box and count on a second line at
  1440 once the Views button names the view (Q-B).
- **The Tasks tab keeps two groupings**: the table's and the Board's
  columns, each with its own *Hide empty groups* switch (Q-C).
- **A view's fields also choose what shows on cards** (Q-E): on the Board,
  in the Gallery and on the Scenes table's nested shot rows, the Fields card
  is where you pick which lines a card shows, in the view's order.
- **A seat that cannot write does not see** *New view*, the move buttons,
  the handles or the *…* menus (Q-F); the bar shows it *Reset* only.
- **A *New view* is saved for everyone at once, starting as *All*** (Q-G1);
  **the item columns sit after Priority, 150px each** (Q-G2); ***Save* over a
  teammate's newer save asks first** (Q-G3).
- **Switching views drops a change for now without asking** (Q-H): the
  table shows the chosen view as it is saved.
- **Empty groups start as today** (Q-I): in tables only the Tasks Status
  grouping shows its empty groups, and the Board shows every column; the
  switch changes it per view.
- **Q-A, Q-D and Q-J are explained and asked again** (batch 10, below).

---

## Batch 10 — three of batch 9 explained, and asked again

**Q-A1. How do we make room for the view's name on the Tasks toolbar?**
(Her words: "can we try make more room in the toolbar for the views name.
if its the button lets just make it longer.") Measured at 1440: the Tasks
toolbar has about 42px to spare, so making the Views button longer needs
room taken from somewhere, or a second line.
- **"Deleted key dates" becomes an icon** *(Recommended)*: today it is a
  156px text button; as an icon (its name on hover) it frees about 128px, so
  the Views button can be about 250px: about 17 letters of the view's name
  plus *edited*, on one line. (It opens the bin of deleted key dates.)
- **Phase, Key date and New task become one *New* button with a menu**
  (Task, Phase, Key date): frees about 196px, but making a phase or a key
  date takes one more click.
- **The toolbar takes two lines at 1440**, as it already does at 1280: the
  name gets 20 letters or more and nothing else changes.

**Q-A2. How does the button show that the view has unsaved changes?** ("A
dot", her question: instead of the word *edited* after the view's name, a
small orange dot ● after the name means "this view has changes you have
not saved"; the bar under the toolbar says it in words either way.)
- **The word *edited*** *(Recommended)*: "Shoot week · edited"; with Q-A1's
  room it fits, and a word needs no learning.
- **A dot**: "Shoot week ●"; about five more letters of the name.

**Q-D. Dragging a task onto another asset's group** (her question: "what
main item?"). Since FX2 a task can be linked to several assets (and scenes,
shots, levels, experiences). The first one in its list is its **main**
asset: the task's window marks it *Main*, and you change which one is main
by reordering there. The Timeline and the Budget place the task under its
main asset only (its bar and its days count once, there), and so does the
Tasks table when you group it by asset (your Q11a). So when the Tasks table
is grouped by asset and you drag a task from one asset's group to another's:
- **The new asset is added as the main one** *(Recommended)*: the task
  keeps its other assets; nothing is lost. A task about *Lighthouse
  Interior* and *Storm Lantern* dropped on *Mara*'s group becomes about
  *Mara* (main), *Lighthouse Interior* and *Storm Lantern*.
- **The new asset replaces the main one** (what dragging does today): the
  old main asset comes off the task. The same task becomes about *Mara*
  (main) and *Storm Lantern*.
- **No dragging between these groups.**
The same for scene, shot, level and experience groups.

**Q-J. The columns in front of the name** (her question: "what are you
asking? elaborate"). In three tables some columns sit to the left of the
item's name: in **Assets** the picture; in **Scenes** the arrow that opens
a scene's shots, the picture and the scene number; in **Shots** the picture
and the shot number. A view lets you hide columns and change their order,
and the name always comes first among them, because it is the column that
stays in place when a wide table scrolls sideways (your Q6a). What happens
to the columns in front of it?
- **They stay in front of the name** *(Recommended)*: a view can hide them
  (a Scenes view without pictures, say) but not move them; tables look as
  they do today.
- **They become ordinary columns after the name**: the name is the first
  column (after the tick box), and you can place the picture or the number
  anywhere after it.

### Her answers, batch 10 (2026-10-16; asked in chat as multiple choice, Q-A1, Q-A2, Q-D and Q-J with pictures; recorded verbatim)

- **Q-A1:** "One 'New' button with a menu"
- **Q-A2:** "add a button that only appears when their is edits made. the button should say "save view". if the view has no edits made just hide the button overall"
- **Q-D:** "no what i want is make a group for the assets grouped together. example: so asset A, Asset B, Asset C if they have the a shared task. there should be a group called  Asset A, Asset B, Asset C. so dragging is just moving it around. when in grouping. create a button called create grouping. so if the user wants to create a grouping give them a button that allows them to do this with a window with boolean check boxes for each item.

  same for scene, shot, level and experience groups."
- **Q-J:** "Stay in front (Recommended)"

### What follows from batch 10 (say if any is wrong)

- **The Tasks toolbar's Phase, Key date and New task become one *New*
  button with a menu** (Task, Phase, Key date) (Q-A1); the room it frees
  (about 196px) goes to a longer Views button and to Q-A2's *Save view*
  button.
- **Unsaved changes show as a *Save view* button** that appears only while
  the view has edits and is hidden otherwise (Q-A2): no *edited* word and no
  dot on the Views button. How it fits with the bar under the toolbar is
  batch 11's first question.
- **Grouping the Tasks table by Asset (or Scene, Shot, Level, Experience)
  makes one group per combination of items** (Q-D): a task linked to Asset
  A, Asset B and Asset C sits in the group "Asset A, Asset B, Asset C"; a
  task linked to Asset A alone sits in "Asset A". This replaces "once, under
  its main one" (her Q11a) for the Tasks table and the Board; the Timeline
  and the Budget still place a task under its main item (FX2's rule), as
  they do today. Dragging moves a task between groups. A *Create grouping*
  button opens a window with a check box for each item, to make a group for
  a combination. Batch 11 asks the details.
- **The columns in front of the name stay in front** (Q-J): Assets'
  picture; Scenes' expand arrow, picture and number; Shots' picture and
  number. A view can hide them but not move them.

---

## Batch 11 — the *Save view* button and the combination groups

**Q-A3. The *Save view* button and the bar under the toolbar** (her Q3c
chose a bar with *Reset*, *Save as new view* and *Save*; her Q-A2 asks for a
*Save view* button that appears only with edits).
- **The button does the saving; the bar only gives news** *(Recommended)*:
  while there are edits, *Save view* appears right after the Views button;
  clicking it saves the change into the view for everyone; its small arrow
  offers *Save as new view* and *Reset changes* (on *All*, which cannot
  change, the button reads *Save as new view*). The slim bar under the
  toolbar appears only with news: a teammate changed or deleted the view, or
  a save failed. A reviewer sees *Reset changes* in the button's place (they
  cannot save, her Q3a).
- **Both, as chosen before plus the button**: the *Save view* button and the
  bar with its words and *Reset*, *Save as new view*, *Save*.
- **The button only, no bar**: the news (a teammate's change, a failed save)
  shows as a short message that fades.

*Why my pick:* one place to save, beside the view's name (law of
proximity), and the bar's words only when something happened that you need
to know.

**Q-D1. Dragging a task into another group** (grouped by asset).
- **Its assets become the group's** *(Recommended)*: dragging a task into
  the group "Asset A, Asset B, Asset C" makes A, B and C its assets (any
  others come off; Undo puts them back); dragging it into "No asset" takes
  them all off. Its main asset becomes the first of the group's.
- **The group's assets are added**: the task keeps its other assets too, so
  it lands in the group of its new, larger combination (not always where you
  dropped it).
- **No dragging between these groups.**

**Q-D2. A grouping made with *Create grouping*** (a group for a combination
no task has yet, to drag tasks into).
- **Part of the view** *(Recommended)*: it belongs to the view's grouping
  like a filter: kept for everyone when you save the view, gone if you
  reset; it shows even while empty, so you can drag tasks into it.
- **Only for the moment**: it lasts while WILSON is open; once a task is in
  it, it shows like any other group.
- **Saved for the project**: every view grouped by that kind shows it.

**Q-D3. Where the *Create grouping* button sits** (only while the table is
grouped by Asset, Scene, Shot, Level or Experience).
- **After the last group** *(Recommended)*: a "+ Create grouping" row at the
  end of the groups, where the eye finishes reading them; on the Board, at
  the end of the columns.
- **In the toolbar**, beside the Group dropdown.
- **In the Group card** of the Views dropdown.

### Her answers, batch 11 (2026-10-16; asked in chat as multiple choice, Q-A3, Q-D1 and Q-D3 with pictures; recorded verbatim)

- **Q-A3:** "sorry i forgot we added the bar that appears. just to confirm that bar with those three buttons should only appear on a view that has unsaved edits"
- **Q-D1:** "option 1 but what do you mean by main one about the asset?"
- **Q-D2:** "Saved for the project"
- **Q-D3:** "In the toolbar"

### What follows from batch 11 (say if any is wrong)

- **Confirmed: the bar under the toolbar, with *Reset*, *Save as new view*
  and *Save*, appears only while the view on screen has unsaved edits**, and
  is gone otherwise (Q3c, Q-A3). It is the *Save view* button her Q-A2 asked
  for: there is no separate *Save view* button, and the Views button shows
  only the view's name (no *edited* word, no dot). The room Q-A1's *New*
  menu frees goes to the Views button's name and to Q-D3's *Create
  grouping* button.
- **Dragging a task into a combination group makes that group's items the
  task's items** (Q-D1): any others come off (the undo toast puts them
  back); dragging it into "No asset" takes them all off. Which item becomes
  its main one is batch 12's first question.
- **A combination is the set of items, in no order**: "Lighthouse Interior,
  Storm Lantern" is one group whichever of the two is main; its name lists
  the items A to Z.
- **A grouping made with *Create grouping* is saved for the project**
  (Q-D2): every view of the Tasks table grouped by that kind shows it, even
  while empty, for everyone. Like views (her Q2), it is created by anyone who
  can edit the project; reviewers do not see *Create grouping* (Q-F).
- ***Create grouping* sits in the toolbar** beside the Group dropdown (Q-D3),
  shown only while the table is grouped by Asset, Scene, Shot, Level or
  Experience; it opens a window with a check box for each item of that kind
  (with a search box) and a name made from the ticked items.

---

## Batch 12 — the main item after a drag, and removing a grouping

**What "main" means** (her question, twice: "what do you mean by main one
about the asset?"). When a task has several assets, a few places can show
the task only once: the Timeline grouped by asset puts each task's bar in one
row, and the Budget's *By asset* tab counts a task's days and money under one
asset (counting them under every asset would add the money twice). For those
places WILSON uses one asset per task, its **main** asset: the first in the
task's list (the task's window marks it *Main*, and you change it by moving
another asset to the top there). With the combination groups, the Tasks
table no longer uses it; the Timeline and the Budget still do.

**Q-D4. After a drag changes a task's assets, which is its main asset?**
- **Keep the old main one if it is still there** *(Recommended)*: if the
  task's main asset is in the new group, it stays main (the Timeline and
  the Budget do not move the task); otherwise the group's first (A to Z)
  becomes main.
- **Always the group's first** (A to Z).

**Q-D5. Removing a grouping made with *Create grouping*.**
- **From the group's own menu** *(Recommended)*: the group's header has a
  *…* with *Remove grouping* (it asks first). Tasks keep their items; a
  group that still holds tasks stays, as any combination with tasks does.
- **It goes by itself** when it is empty and nobody has dragged a task into
  it for the visit.
- **It cannot be removed.**

### Her answers, batch 12 (2026-10-16; asked in chat as multiple choice, Q-D4 with pictures; recorded verbatim)

- **Q-D4:** "lets not have main asset be a thing. thats not needed and i dont like. instead lets do the same as the grouping option. make the grouping a group in the timeline as well. do not add a new group button in timeline view though. creating of a grouping should only be in the other tabs (assets, tasks, levels, etc.)"
- **Q-D5:** "From the group's menu (Recommended)"

### What follows from batch 12 (say if any is wrong)

- **There is no main asset (or main scene, shot, level, experience) any
  more, anywhere she sees it.** A task's items are its items, with no first
  one that counts for more. This reverses FX2's "main item" (her FX2 brief
  never ruled on it; FX2's question 7 was still open).
- **The Timeline groups the same way as the Tasks table**: grouped by asset
  (or scene, shot, level, experience), a task's bar sits in the row of its
  combination ("Lighthouse Interior, Storm Lantern"); the project's saved
  groupings (Q-D2) show there as rows too. **The Timeline has no *Create
  grouping* button**; groupings are created only in the other tabs.
- **A grouping made with *Create grouping* is removed from its group's
  *…* menu** (*Remove grouping*, which asks first); tasks keep their items,
  and a group that still holds tasks stays, as any combination with tasks
  does (Q-D5).
- **Taking "main" out reaches past the views.** Today the main item also
  decides: where a task's days and money count in the Budget's *By asset*,
  *By scene* and *By shot* tabs; what deleting an asset does (the tasks whose
  main asset it is are deleted with it, migration 0034's rule); which files
  the task's window shows under its Items table; what a bid version
  remembers; the asset the Dashboard's task window shows; and the database
  keeps each task's main asset, scene and shot in its own columns, kept in
  step by migration 0096's triggers. Batch 13 asks the decisions that change
  what she sees, and when the work happens.

---

## Batch 13 — taking out the main item: the Budget, deleting, which tabs, and when

**Q-M1. The Budget's *By asset* tab** (and *By scene*, *By shot*): with no
main asset, how does it count a task that has several assets?
- **Under its combination** *(Recommended)*: one row per combination, like
  the grouping: "Lighthouse Interior, Storm Lantern" is a row holding that
  task's days and money; every row adds up to the project's total.
- **Split between its assets**: half its days and money to each of two
  assets, a third to each of three; the totals add up, but rows show
  fractions of a day.
- **Under each asset**: the task's days and money appear under every one of
  its assets; the rows add up to more than the project's total.

**Q-M2. Deleting an asset that tasks are linked to.** Today the tasks whose
main asset it is are deleted with it. With no main asset:
- **The tasks stay** *(Recommended)*: the asset comes off its tasks; they
  keep their other assets, or none.
- **A task goes only if it was its one asset**: a task linked to that asset
  alone is deleted with it; the others lose it and stay.
- **Ask each time**: the delete question lists the tasks and lets you choose.

**Q-M3. Which tables get combination groups and *Create grouping*?** (Her
words: "creating of a grouping should only be in the other tabs (assets,
tasks, levels, etc.)".)
- **The Tasks table** *(Recommended)*: grouped by asset, scene, shot, level or
  experience, with *Create grouping*; the Timeline shows the same groups;
  the other tables keep grouping by their own fields (type, phase, status).
- **Tasks and Assets**: Assets also groups by the scenes, shots, levels and
  experiences an asset is in, with combination groups and *Create grouping*.
- **Tasks, Assets, Levels and Experiences**: Levels and Experiences also
  group by their assets.

**Q-M4. When does taking out the main item happen?** It touches the
Timeline (the file the plan calls unsafe to edit), the Budget, deleting, the
task window, bid versions and the database (a migration).
- **Its own session first** *(Recommended)*: one session takes the main item
  out everywhere, with its own measured list of every place it is read (as
  FX2 had) and the questions that list raises, before the views are built,
  because the Tasks table's columns and grouping stand on it.
- **Inside the next session**, with the Tasks table's item columns.
- **After the views**: the views come first, with combination groups in the
  Tasks table only; the rest of "main" goes later.

### Her answers, batch 13

*(waiting)*

---

## Not asked, because nothing you see depends on it

- Where the cloud keeps the views (a table per project, readable only by the
  project's people under the same rules as the project itself, with the role
  rule of Q2 checked by the database, not only by the screen), and how the
  desktop keeps them with the project's files.
- The new dropdown and editor are built from the app's shared kit (the same
  look as every other menu and panel), work entirely by keyboard, and every
  change to a view can be undone.
