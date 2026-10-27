# 82 — R.A.B.B.I.T. ROBUSTNESS: THE LEVELS GATE, A REWIRE IN ONE STEP, LIVE BID VERSIONS, EVERY FILE, LIVE DASHBOARD ASSETS, THE TASKS CSV, TEAM MEMBERS AND THE RATE CARD AT 1280

1. **Levels and Experiences ask before a reviewer writes.** A seat that cannot
   write the project (a reviewer, or someone with no seat on a staffed
   project) sees **New level**, each row's **Delete**, the bulk bar's
   **Status** and **Delete**, and the window's **Delete level** and thumbnail
   buttons greyed, with the reason on hover. A name or a description is plain
   words, not a field; the status and the window's dates cannot be changed;
   the window offers no **Add new task**. It is the Scenes page's treatment.
   Before, every one of them was live, and a reviewer's delete vanished the
   row until the cloud refused it.
2. **Replace link is one step, and a refused link loses nothing.** When you
   drag an arrow's head onto another bar and choose **Replace link**, the old
   link is removed and then the new one saved, as the confirm says. If the new
   one is refused (most often because that link exists already), the old link
   is put back and the strip says *"Could not link those tasks. The change was
   not saved."* One **Ctrl+Z** takes back the whole rewire, and a Ctrl+Z
   pressed while it is still saving waits for it. Before, a refused link left
   neither link, and one Ctrl+Z took back only half a rewire.
3. **A bid version saved in one window shows in the other.** Saved, made or
   deleted on the Budget page, it appears in every other window on that
   project within a second, without reloading the project. (Opening one
   already did.)
4. **A project's files are all read.** Past its 1,000th file a project
   showed only the first thousand, silently: in D.O.G.'s references, the
   Budget's attachments, the Projects page and the Files tab. Every file is
   read now.
5. **The Dashboard names a task's second asset at once.** Add an asset to a
   task in one window and *My tasks* on the Dashboard in another names it
   within a second. (A private project's tasks still update at the Dashboard's
   next load: that channel is every member's.)
6. **The Tasks export writes what the table shows.** Its columns are the
   table's, in the table's order: Title, Status, Priority, an Asset column
   (and Scene, Shot, Level or Experience where the project uses them), Phase,
   Assignee, Start, End, **Bid**, then Notes and Created as before. Statuses and
   priorities read as the table reads them (*In progress*, not
   `in_progress`; *Waiting to start* and *Medium* where none was set, as the
   row shows). A column your view hides is left out of the file too.
7. **Team members and the Rate card fit a 1280 window.** The Rate card no
   longer scrolls sideways at 1280 (nor at 1440). On Team members the day
   rate, the status, the row buttons, every name and the *Producer*,
   *Director* and *You* badges show whole: a badge that does not fit beside
   the name sits on the line under it. A title as long as *Producer* is
   whole; longer titles, the emails and the longest usernames are what give
   way, each whole on hover.

**What this is.** R1 of night 2 of the plan to 1.0
(`docs/sessions/PLAN_TO_1_0.md`): five entries of the closed defects list
(S5-02, DG1-01, P1-29 and P1-30, the Dashboard's assets with the Tasks
export) and the two small R.A.B.B.I.T. features §2 names (the write gate, the
rewire). Written 2026-10-27 against `feat/post-overhaul-edit-versioning`
(`po/r1-rabbit-robustness`). One migration, **0101**, on wilson-dev (two
small database triggers; staging is the controller's). No server function.

## 1. On the development copy

The development copy with the dev fixtures' tester (no sign-in), serving
`feat/post-overhaul-edit-versioning` after the morning's merge
(`session-a/b/c` in the launch file, ports 5301 to 5303).

| # | Do | You should see |
|---|----|----------------|
| 1 | Make the window 1280 wide and open **Rate card** | The table fits the page: no sideways scroll, every heading whole, the cells a little tighter (8px a side, where the app's tables have 12) (`po-r1-after-rate-card-1280x800`; before: `po-r1-before-rate-card-1280x800`, the table cut at the right edge). The one long role name still ends in "…", as before. |
| 2 | Open **Team members** at the same width | Every heading whole; **Day rate** (both figures), **Status** and the row buttons whole on every row. Every name is whole; Mara Okonkwo's **Producer** and **You** and Theo Lindqvist's **Director** sit whole on a second line under the name, so those two rows are taller. Titles as long as *Producer* are whole; longer titles, the emails and the longest usernames end in "…", and pointing at one shows it whole (`po-r1-after-team-members-1280x800`; before: `po-r1-before-team-members-1280x800`, the day rate, status and buttons cut). Make the window 1440 wide: the same picture — this page's width stops growing near 1,290px, so the table has about 1,240px at either size. |
| 3 | R.A.B.B.I.T. → **Tasks** → **Export** | A file named `Salt_Hours-tasks-<today>.csv`. Its first line: `Title,Status,Priority,Asset,Scene,Shot,Phase,Assignee,Start,End,Bid,Notes,Created`. **Set build**'s line reads *In progress*, *Urgent*, *Lighthouse Interior* and a bid of 10. Before: `Task,Status,Priority,Assignee,Phase,Start,End,Notes,Created`, with `in_progress` and `urgent`, and no asset or bid. |
| 4 | Views → **Fields** → switch **Show Priority** off, then **Export** again | The file has no Priority column, as the table has none. |
| 5 | R.A.B.B.I.T. → **Timeline**. Drag the round head of an arrow (for instance *Clean boards, all shots* → *Animatic with scratch track*) onto another task's bar, and choose **Replace link** | The arrow now points at the new bar. Press **Ctrl+Z** once: the old arrow is back and the new one gone. Press **Ctrl+Y**: the rewire again. Before, one Ctrl+Z left neither arrow. |

## 2. On the cloud (two windows, signed in as you)

What the development copy cannot show: it has no live sync, no second
person, no reviewer seat, and its links have no "already exists" rule.

| # | Do | You should see |
|---|----|----------------|
| 6 | Open the same project's **Budget** in two windows. In the first, **Save** into the open version (or **Save as new version**, or delete a version you do not need) | The second window's version list shows it within a second; the project does not reload (the Timeline's place, your filters, Undo all stay). |
| 7 | Open the **Dashboard** in one window. In the other, open a task assigned to you (in a project that is not private) and add a second asset to it | *My tasks* names both assets within a second. |
| 8 | On the **Timeline**, link A → C. Then drag the head of A → B onto C and choose **Replace link** | The strip: *"Could not link those tasks. The change was not saved."* A → B is still there, and A → C. Nothing to undo. |
| 9 | Ask a teammate whose role is **User** and whose seat on a staffed project with levels is **Reviewer** to open **Levels** (your own seat will not show it: an admin writes every project) | **New level**, each **Delete** and the window's **Delete level** greyed, the reason on hover; names and descriptions as plain words; the status not changeable (`po-r1-after-rabbit-levels-1280x800`, `po-r1-after-rabbit-level-detail-1280x800`; before: `po-r1-before-…`, all live). The screenshots are the dev fixtures with the tester's seat lowered to reviewer for the photo only; that change was never kept. |

## 3. What R1 chose, for you to overrule (2026-10-27)

- **Team members (walkthrough 47 Q57):** nothing hidden. The page has no
  column chooser to bring a hidden column back, and Title, Department, Role
  and Full-time are an admin's editors there. So the free text gives way —
  Title, Email and the longest usernames, each whole on hover — and every
  heading, control, figure, name and badge keeps its room. A badge that does
  not fit beside the name goes to the line under it, so a producer's or a
  director's row is taller. Twelve columns have about 1,230px, so every
  column has its least: a title as long as *Producer* is whole, and
  *Physical Production*, the longest of the default departments, loses part
  of its last letter in its dropdown (pointing at it shows it whole). The
  room it needs would come from Day rate, where a six-figure rate would then
  be cut.
- **Rate card (walkthrough 47 Q62):** the compact cells (the kit's 8px, which
  P1 measured would fit), the table's floor 1,080 → 980px (the room a 1280
  window gives it), and Region one share wider (from Overhead) so its heading
  is whole.
- **The Tasks export:** headed as the table is (**Title**, not *Task*), in its
  order (Phase before Assignee, as the table), the view's hidden columns left
  out; Notes and Created kept at the end.
- **The rewire confirm keeps its words** (the brief said so). Its last
  sentence still says *"the old one is already gone"*; it is not any more.

## 4. Questions

1. **Team members at every width:** (a) keep it as built — nothing hidden, the
   free text narrower (recommended for now: no data out of reach); (b) let
   this page use the window's full width (it stops near 1,290px today), so at
   1440 and up more of the free text shows; (c) move Pronouns and Full-time
   into a member's own window; (d) hide columns behind a column chooser like
   the R.A.B.B.I.T. tables' (a build of its own).
2. **The rewire confirm's last sentence:** (a) *"If the new link is refused —
   for instance because it already exists — the old link is put back, and the
   timeline's "Not saved" strip says so."* (recommended: it is what happens
   now); (b) keep it as it is.
3. **The export's first column:** (a) **Title**, as the table (built); (b)
   **Task**, as the file said before.
