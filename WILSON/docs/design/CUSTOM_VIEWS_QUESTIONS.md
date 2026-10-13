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

## Batch 4 — where a card opens, grouping by a linked item, the other tables, columns

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

### Her answers, batch 4

*(waiting)*

---

## Batch 5 — what a view remembers, filters, sorts, grouping

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

### Her answers, batch 5

*(waiting)*

---

## Batch 6 — Scenes and Shots, the old views, Budget and Team, ready-made views

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

### Her answers, batch 6

*(waiting)*

---

## Batch 7 — what was found along the way

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

### Her answers, batch 7

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
