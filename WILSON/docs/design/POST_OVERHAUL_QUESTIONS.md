# WILSON — the questions before the plan (2026-09-29)

Your brief: five sessions on a new branch after the UI overhaul (timeline pass, D.O.G. / O.T.T.E.R. settings placement, shot lists + edits, project files, budget versions in the timeline). You asked for every question before the plan is written, nothing assumed. This is that list.

**How to answer.** Every question has a number and a **default**. Answer by number ("A1 b", "D3 copy"). Anything you skip takes its default. Questions marked **⛔** change the shape of a session; the rest are details with a safe default, and "default for everything else" is a fine answer.

**What was done to produce this.** Thirteen readers went through the closed overhaul branch (`feat/ui-overhaul` at `bbf3bcd`, the build on your Desktop), the schema, the Local Server code, the plan, the hand-offs, walkthrough 47 and OUTSTANDING, then a second pass re-verified every claim against the code and a third pass checked the five sessions against each other. Where the answer was already in the code I did not ask.

**Every session runs on Opus 5.5** (your instruction). Each chip's first line will say so and the session halts if the picker shows anything else.

**The two images did not arrive.** Neither blocks: the Nov 30 / Dec 1 stacking is reproducible from the calendar and the code (any month whose 1st is a Tuesday or Wednesday collides at week zoom), and the narrow O.T.T.E.R. view is explained by a 45-character measure in the stylesheet. The second image would settle only one thing (C4.3 below). Re-attach them if you can; otherwise answer C4.3.

---

## A. The branch, the order, the numbers

**A1 ⛔ Branch base and merge order.** The overhaul is finished on `feat/ui-overhaul` but merged nowhere. The beta still runs `feat/multi-user-v1`. The three paused track branches (A product, B auth, C storage) are also unmerged, and they changed exactly the files these sessions will edit (Timeline, Budget, D.O.G., O.T.T.E.R., App shell, the adapters, the Local Server). Two ways to go:
- (a) Stack the new branch on `feat/ui-overhaul` now. Fastest start; nothing reaches the beta until the whole chain merges (tracks → overhaul → `feat/multi-user-v1` → PR #4), and the eventual merge gets bigger with every line these sessions add.
- (b) Merge first: you read walkthrough 47, the tracks merge over the overhaul, the overhaul merges into `feat/multi-user-v1` (merge commit, never squash), then the new branch comes off the beta's branch and each session shows on the beta as it lands.
Default: (a) for the sessions that touch no schema (Timeline, D.O.G./O.T.T.E.R., the shot-list schema design); the merge happens before the schema-heavy sessions start (shot-list UI, files, budget versions).

**A2 ⛔ Branch name.** Proposed `feat/post-overhaul`, sessions on `po/<name>` branches integrating by `git push origin HEAD:feat/post-overhaul`, the same mechanics as the overhaul. Default: that name.

**A3 ⛔ How many sessions at once.** The demo week ran one at a time; the overhaul ran up to three. Three can start on day one on files that do not overlap: the Timeline pass, the D.O.G./O.T.T.E.R. pass, and the shot-list design + schema (no view code). Default: three.

**A4 Order and dependencies (confirm).** Wave 1: Timeline (S1), D.O.G./O.T.T.E.R. (S2), shot-list design + schema (S3a). Wave 2: shot-list UI (S3b), Files UI (S4a). Wave 3: edits + drag-and-drop + guards (S3c), Files schema + restricted tags (S4b, after Track C merges — see E5). Wave 4: budget versions in the timeline (S5, last, because it reuses S3's picker table and S3 already adds columns to the budget-versions table). Default: that order.

**A5 Migration and test-suite numbers.** Measured across every branch: 0000–0078 and 0081 are taken; 0079 (bins cloud side) and 0080 (assemblies) are reserved on paper only. The "assemblies" reservation was the demo plan's own version-control-for-edits idea, which your Session 3 replaces. Take 0082 onward and suites 82 onward, or release 0080 to the shot-list work? Default: 0082+ / 82+; the demo plan gets a note that 0080 and suite 73 are released.

**A6 The overhaul's constraints.** C1 ("no interaction or view changes") obviously ends here, since every session adds controls. C2–C9 stay: the page transition untouched, Home fonts only, the D.O.G. preview box pixel-fixed, the pets untouched, white-or-black on orange, the type scale, the kit + tokens (no loose hex), no white surfaces. Default: yes, C1 lifted, the rest binding.

**A7 Walkthroughs.** Numbered 48 onward, one per session, copied to `Desktop\WILSON walkthroughs\Post-overhaul\`. Sessions integrate after their two review rounds without waiting for your report (the overhaul's W14 rule); you answer by number when you choose. Default: yes.

**A8 May the sessions write your rulings into walkthrough 47 and OUTSTANDING themselves** (narrowly: the questions this brief answers, the rows they close)? Default: yes.

**A9 Both backends?** Shot lists, file tags/notes and budget-version timelines on both the desktop Local Server and the cloud, like scenes were — or Local Server first, like bins? Note: the Local Server has no roles, so anything "restricted" or "managers only" is a label there, not a gate. Default: both, with the caveat stated in each walkthrough.

**A10 Cherry-pick the date fix early?** S1's date-parse fix (B3) is a data bug that affects the beta today. Want it on the beta ahead of the overhaul merge? Default: the hand-off names the commit as cherry-pickable; nothing moves until you say.

---

## B. Session 1 — Timeline

**B1 ⛔ Which orange for the phase names.** Your bullet 4 keeps the phase rows' grey band, and on that band the app's orange (`#ea580c`, the frame colour) measures 4.11:1, under the 4.5:1 floor the timeline's own probe enforces (3.63:1 when hovered). Options: (a) that orange anyway, with the floor lowered for phase names as a recorded exception; (b) an existing lighter token reused as text (`#f4a261`, the Home orange, 7.1:1 — or `#dd9155`, 5.8:1); (c) one new token, a lighter orange for small text on dark (e.g. `#fb923c`, 6.5:1), added properly with its contrast pairs. Default: (c).

**B2 ⛔ Short weeks — your three options.** The header today prints a Monday label whenever it is not right AFTER a month's 1st, never checking the day BEFORE, so "Nov 30" lands under "Dec 2026 / Dec 1".
- (A) Symmetric suppression: a Monday within three days before or after a 1st keeps its tick line but loses its label. "Nov 30" vanishes; "Dec 2026 / Dec 1" stays. Smallest change.
- (B) Measured no-overlap: a label prints only when it fits before the next tick, and the 1st always wins. Zoom-independent, testable at all four zooms, and it also fixes a sibling defect in Day view (a month label wider than one day column, crossed by the next tick line).
- (C) Two-tier header: a month band on top, one cell per unit below (days / Monday-to-Sunday weeks / months). A short week becomes one cell and nothing can ever stack, at the cost of new header structure, the help copy and every pixel baseline.
Default: (B) now; (C) offered as its own later session if you want a week to read as a cell.

**B3 ⛔ The one-day-back drag — cause found, two confirmations needed.** Dates are stored as plain `YYYY-MM-DD`. The Timeline reads them as UTC midnight and then takes the local day, so on this workstation (Eastern time, measured) every bar draws one day EARLY. Drop a bar on Dec 3 → it stores Dec 3 → it draws on Dec 2. (1) Which did you see: a bar drag in the main gantt, a bar drag in the minimap, or the Save in a phase / asset / key-date editor? All three fit, and the editor is the worst: its fields open a day early and Save stores them a day early, every time. (2) After the fix, every bar, key date and editor date on this machine draws one day LATER than today, matching what is stored. Accept that visible shift? Default: one fix covers all three; the shift is accepted and checked against stored values on two tasks and a key date; the pixel baselines are re-taken.

**B4 Already-drifted dates.** Every editor Save and phase drag on this machine has stored dates a day early. Want a per-project listing of dates that look shifted (there is no automatic way to tell a drift from an intended date), or just stop it going forward? Default: stop it; the hand-off offers a read-only listing script you can run.

**B5 One shared date helper.** Fix the same parse on the Projects page (P1-20, dates a day early there too) in this pass, through one helper the shot-list and budget sessions then reuse? Default: yes.

**B6 Borders, confirm the edges.** Task rows lose their line in the gantt half only; the name column keeps every line; phase rows keep theirs; the "+ New task" row under each phase also loses its line (it is not a phase row); applies in every grouping (phase / team / asset / scene). Default: yes to all.

**B7 Minimap animation, confirm.** "The orange bar" = the outlined window that shows the gantt's visible span (not the grey scroll thumb, not a phase bar). Animate only on the Day / Week / Month / Quarter change; scrolling and dragging the window stay instant. Two small code changes come with it (the first frame after a zoom change is currently drawn wrong and then corrected, which an animation would show). Default: yes.

**B8 Two adjacent things the every-view test will find.** (a) Clicking to create a task rounds to the nearest column edge, so a click past a cell's middle creates the task on the next day — fix now or record? (b) In Day view with weekends hidden, a month whose 1st falls on a weekend loses its month label entirely — move the label to the first visible day? Default: (a) record, (b) fix.

**B9 "White" and where.** White for task names = the app's ink (`#f5f0ec`, the same off-white every label uses). Orange phase names = the left name column only, not the label printed on the phase bar and not the minimap. Sub-phase (group) rows follow the phase rule. Default: yes.

---

## C. Session 2 — D.O.G. and O.T.T.E.R.

**C1 ⛔ Which D.O.G. toolbar.** Three D.O.G. bars carry undo/redo: the "Deck outline" sidebar header (undo/redo delete, import/export history, clear history — 240px wide, the only one that does not reach the right edge), the "Edit output" bar and the text-format bar (both inside the output card, already full width). Confirm it is the sidebar header that becomes a full-width strip above both columns, drawn at the same height as O.T.T.E.R.'s and R.A.B.B.I.T.'s tab strips so the gear sits at the same x AND y in all three tools, with "Deck outline" as the strip's leading label, the four buttons beside it, then Help and Settings at the far right. The sidebar keeps its 240px this session. Default: yes; the preview box is measured before and after (C4).

**C2 ⛔ The generate buttons are already orange.** Both "Generate" buttons are the app's filled primary (`#c2410c`, white text) whenever they can be pressed. They show as a grey outline only while DISABLED: until a document is loaded, and for "Generate page outline" until a layout is chosen and a request typed. Were you looking at the disabled state? (a) No change; the session sends you a screenshot with a document loaded. (b) A dimmed-orange disabled look, which changes every primary button in the app. (c) The brighter frame orange with white text — that pair fails contrast (3.56:1) and is exactly what your "white or black on orange" rule forbids. Default: (a).

**C3 ⛔ Orange section titles in D.O.G.** The two card heads take a hover wash on which orange text measures 3.86:1 (fails). Pick: (a) orange title text and remove that hover wash (chevron and cursor still say clickable); (b) orange ring on the step-number circle only, text stays grey; (c) orange text that reverts to white on hover; (d) accept 3.86 as a written exception. Also: text only, or the numeral circle too? And the code says "deck context" where you wrote "deck content" — a rename or a slip? Default: (a), text only, keep "context".

**C4 ⛔ Lesson width.** Today the prose is capped at 45 characters (~418px) inside a 720px page; that is the negative space. (1) Grow with the window up to a ceiling — 60 characters (~86 letters), 66 (~95, the plan's upper bound) — or fill the pane with no ceiling (110–140 letters a line at 1440, past every readability norm)? (2) Drop the 720px page cap? (3) Which page was your screenshot: the LESSON page (breadcrumb "Course › Subject › Section › Lesson", Key takeaways + Practice exercise cards) or the SUBJECT page before content is generated ("Course › Subject [outline]")? Apply to both? (4) Body text to 16px while widening (your open walkthrough Q76)? (5) Column stays centred? Default: 66-character ceiling, cap dropped, both pages, 14px, centred; screenshots at 1440 and 1280 before the number is final.

**C5 Breadcrumb on one line.** Never wraps; if it cannot fit, the middle segments shorten with an ellipsis and the current lesson is never cut. Default: yes.

**C6 Removing "Tool settings" from the nav strip.** For all three tools (R.A.B.B.I.T. already has the in-page gear), deleting the plumbing behind it, rewriting the test that pins it, and: rename O.T.T.E.R.'s settings-drawer tab that is also called "Tool settings" to "Storage & data" (that is what it holds); rewrite the three help passages that describe the hamburger path; name the buttons "D.O.G. settings" / "O.T.T.E.R. settings" and retitle R.A.B.B.I.T.'s "RABBIT settings" to match; every Help button "Help & documentation". Note: "Tool settings / App settings" was your own Q7 ruling in the overhaul — this reverses half of it, recorded as such. Default: yes to all.

**C7 What Help opens, and R.A.B.B.I.T.** The in-page Help button opens the tool's own Help window (not the app's Help page), as R.A.B.B.I.T.'s does. R.A.B.B.I.T. also gets Help beside its gear so all three match. Icon-only 28px buttons with tooltips, Help left of Settings. Default: yes.

**C8 O.T.T.E.R. orange, the exact list.** "Course library" title only (not "Functions reference", "Keyboard shortcuts" or quiz titles). Hotkeys: the key-cap TEXT only (border and fill unchanged), on the Hotkeys page AND in the Search window's hotkey table (same table). Lesson page: Key takeaways and Practice exercise — title text + icon in orange, or a 1px orange edge on the Practice card for the "block/window" feel? Is this the complete list of new orange (progress bars and lesson links stay as they are, your open Q80/Q81)? Default: Course library; cap text in both tables; both card titles + icons; edges unchanged; the design notes record these as your exceptions so a later reviewer does not "correct" them back.

**C9 Function colouring.** The lessons already use a highlighter with a VS-Code-like dark theme (oneDark, comments re-inked to pass contrast). Use that (one code look across the tool), or VS Code Dark+ literally (its colours were designed for a different grey and need a contrast sweep)? Colour only the signature and example blocks (name / parameters / returns are prose, not code); also the Search window's function results; long lines keep wrapping. Default: oneDark, signature + example, Search included, wrapping kept.

**C10 Your real coding-language courses, and a data bug.** (1) Which coding-language courses are in your library (Python? JavaScript? C#? HLSL/GLSL? MEL? Blueprint?) — a course carries no language field, so the session needs the list to map course → language and to replay against your real files. (2) Found while reading: the Functions merge keys categories by the wrong field on every backend, so a generated function library collapses into ONE nameless category (an empty heading). Fix it for new merges and show "General" for a nameless category on read, never rewriting your existing files — and tell you what your files contain? Default: map the common languages, unknown = plain text; fix the merger; your files untouched.

**C11 Split S2 in two:** S2a (nav item removal + placement in three tools + orange + tests + docs), then S2b (O.T.T.E.R. only: merger fix + function colouring + lesson width). Default: yes.

**C12 Enter toggles the pet (P1-01).** Two more icon buttons per tool multiply that known dead end. Fix it now, or leave it as the app-wide open item? Default: leave; the hand-off lists the six affected buttons.

---

## D. Session 3 — Shot lists and edits

One fact first. Five things already point at scenes and shots by their ids: files, folders on disk, bin takes, tasks (desktop only) and assets (desktop only). A frozen copy like the budget's versions cannot be pointed at, so "tasks and assets clearly indicate which shot version" is impossible under a budget-style snapshot. That drives D1.

**D1 ⛔ Storage model.** (a) Real rows: every scene and shot belongs to a shot list (a new `shot_lists` table, a `shot_list_id` on scenes and shots). A new list is real rows; files, takes, tasks and assets keep pointing at real shots; an old list can be reopened and edited; a snapshot is also written on every Save for history. (b) Frozen JSON copies like the budget, with one live working set that "load" overwrites (destructive; nothing can link to an old version). Default: (a).

**D2 ⛔ "Load an old shot list."** = the Scenes tab switches to viewing/editing that list (remembered per person, per project), independent of which list is ACTIVE for the project. Any list is editable, not read-only until set active. The context bar shows both when they differ. Default: yes.

**D3 ⛔ "Create new shot list."** Starts EMPTY, as a COPY of the list on screen, or the dialog asks ("Start from: empty | copy of Storyboard pass v3")? And on a copy, the things pointing at the OLD shots (tasks, assets, files, takes): (a) stay on the old shots, (b) move to the new ones, (c) get duplicated? Folders on disk: only the ACTIVE list's scenes/shots own folders (a copied scene with the same name would otherwise collide with the original's folder)? Default: the dialog asks (copy when a list is open, empty when none); "Save as" always copies; (a) links stay; folders only for the active list.

**D4 ⛔ "Clear."** Delete every scene and shot of the list on screen (files unlink, folders and takes orphan — destructive, undo only until you reload), or start a new empty version and leave the saved one intact? And can a whole list be deleted from the picker — recommended instead: archive (hidden behind "Show archived", nothing cascades; the active list cannot be archived). Default: Clear = empty the current unsaved working copy after a confirm; saved lists are never cleared; archive instead of delete.

**D5 ⛔ Do shot lists stay live-saved?** Today every scene/shot edit saves instantly with undo. Keep that for shot lists, with "Save" = record a version point and "Save as" = copy to a new version — and confirm the no-auto-save / blinking button / ask-before-leaving behaviour is for EDITS only? (Making the whole Scenes tab a draft would be a much larger change.) Default: yes.

**D6 ⛔ What an edit is.** An ordered list of items referencing shot ids (so a shot can appear twice and keeps its name), grouped in scene order; "entirely new shots" become real shot rows on the active list (so tasks and takes can attach to them), not free-text placeholders; no in/out points or per-item notes in v1; one linear chain of edits per shot list (v1, v2, v3 — no branches), the first seeded from the list's order; edits only on the ACTIVE list. The demo plan's earlier "assemblies" idea (clips from bins as items, a compare view, an EDL export) is superseded — items are shots only, takes stay attached to their shot, no compare/export in v1. Default: yes to all.

**D7 ⛔ Where the controls live.** The Scenes toolbar's sixteen controls already fill one line at 1440. (a) A third mode inside the Scenes tab ("Scenes | Shots | Edit"); (b) a new "Edits" tab beside Bins; (c) a new bar between the summary tiles and the toolbar: [Shot list ▾ (title · v3 · Active)] [New shot list] [Load…] [Save shot list] [Save as…] [Set active] · [Edit ▾] [Save edit]. Edits render in the existing shots-by-scene table with drag handles. May the toolbar be regrouped (your open walkthrough Q184)? Default: (c), toolbar left as built.

**D8 ⛔ Who may do what.** Create/save/edit a shot list or edit: any project member who can write (like scenes today)? Set active and archive: managers/admins only (like activating a budget)? Reviewers read only. Default: exactly that.

**D9 ⛔ Cloud parity for tasks and assets.** In the cloud, tasks have NO scene/shot link (deliberately left out in an earlier migration) and assets' links exist in no migration at all — they only work on the desktop. So "tasks and assets indicate which shot version" is true only on the Local Server today. Authorise a tasks migration (scene + shot links) and an assets link so it works on the beta? Side effect: the Budget's By scene / By shot reports, which read "No scene" for every cloud task today, start working. Default: yes.

**D10 ⛔ Which list everything else reads.** About twenty surfaces read "the scenes" and "the shots": Timeline group-by-scene, Budget by-scene, the task popup's Scene/Shot pickers, the asset relations, the bins pickers, the Summary tiles. Once a project has several lists, do they show the ACTIVE list only, the list the Scenes tab is currently viewing, or every list flattened with a label on each scene? Default: the active list everywhere; only the Scenes tab shows the viewed list; every scene/shot name gains its list in a tooltip ("SC001 · Storyboard pass v3").

**D11 ⛔ Existing projects on day one.** Every project's current scenes and shots become "Shot list 1 · v1", active, automatically, on both backends (including projects where scenes are switched off but rows exist)? Default: yes; no edit is created.

**D12 ⛔ The leave guard.** Which exits ask "save or discard": the R.A.B.B.I.T. tab strip, switching tool or page, switching project, a jump from Bins into Scenes, closing the window? Automatic switches (scenes turned off, project cleared, a background refresh) cannot ask — the draft lives above the view and survives them. Three buttons: "Save edit" / "Discard changes" / "Keep editing" (Escape = keep editing), or your two? Default: all five exits ask; three buttons.

**D13 ⛔ The first drag.** On the first drop the question fires once. Yes creates a draft edit (same title, next version number, seeded from the edit on screen — or from the shot list's order if none exists yet) and the Save edit button starts pulsing; Cancel springs the rows back and creates nothing; no further questions until that draft is saved or discarded; dragging on an older version creates the next version number (linear). Default: yes.

**D14 Names and numbers.** A list is TITLE + integer VERSION, shown "Storyboard pass · v3", unique per project; the "+1" shortcut is a toggle in the create / save-as dialog ("Same title, next version", on by default for Save as). Copies keep every scene and shot number and name exactly; nothing is ever renumbered automatically. Default: yes.

**D15 "Blink."** A literal on/off blink is the attention anti-pattern the UX laws flag and the design system's motion rules forbid. Proposed: a slow 1.2-second pulse on the button's orange edge plus an "Unsaved" dot and word; under reduced-motion the pulse stops and the dot + word remain. Default: the pulse.

**D16 Drag-and-drop mechanics.** Reorder shots within a scene, move shots between scenes, reorder scenes — native drag on a handle (no library added); repeats, removals and additions through row actions and the existing scene → shot picker; Move up / Move down buttons as the keyboard path (the takes already work that way). Default: yes.

**D17 Deleting a shot an edit uses.** Keep the item as a "Missing shot" row (last-known name, excluded from runtime) rather than blocking the delete or silently shortening the cut; undoing the delete brings it back. Default: yes.

**D18 The budget link.** A "Based on shot list" dropdown beside the bid-version name (defaults to the active list), stored on the bid version and also frozen into its snapshot so the label survives an archive. The Timeline gets a read-only "Shot list: Storyboard pass · v2" label only, no selector (S5 owns the Timeline's dropdown). Default: yes.

**D19 Split and order.** S3a design + schema + provider/adapters/Local Server (no view code); S3b shot lists in the Scenes tab; S3c edits + drag-and-drop + first-drag confirm + pulse + leave guard + the budget dropdown + the task/asset indicators. Default: yes, in that order.

**D20 Tiles and counts.** The four tiles (runtime, frames, scenes, shots) follow what is on screen: a shot list totals its rows once; an edit totals its items in order, repeats included, missing shots excluded, labelled "Edit runtime". Default: yes.

**D21 Pending Scenes questions this work lands on.** (i) Escape asks before discarding a popup draft (your open P1-09 / Q32) using the same guard? (ii) Fix the four old Scenes bugs P1-21..24 in S3b, since it rewrites the same tables and popups? (iii) Enter on confirm dialogs keeps Cancel focused (Q31)? Default: yes / yes / yes.

**D22 Small ones.** The desktop mirror gains a `scenes.json` beside the other visible database files; no export (EDL/CSV) in v1; copied shots do not carry takes or files (they stay with the original). Default: all as stated.

---

## E. Session 4 — Project files

Two facts first. (1) The Files page you use (Resources → Files, the Finder-style explorer) is read-only by design; the older files table on Summary / Intake already has a Core checkbox, a Kind select and a Description cell. (2) In the cloud, Kind and Description are silently thrown away today — the columns exist only in Track C's unmerged migration 0075. Core (`is_core_definer`) has existed since day one: it is the flag the Intake pipeline and D.O.G. read as "project context". So the session brings properties the app already half-has into the explorer, on top of the new tags and previews.

**E1 ⛔ Which Summary section goes.** There are two: the read-only "Project files" card, and the Control Panel's "Files & storage" section, which also holds Add files, the missing-files Relink banner, the folder reset and the file-activity drawer. Remove the card only, or both — and if both, Add files / Relink / Activity move to the new Files tab's toolbar (uploads still file to the project root as today, not into the selected folder)? Default: both go; those three controls move to the Files tab; the project-folder controls stay in the Control Panel.

**E2 ⛔ Notes and Core.** Is the note the existing Description column (Track C's 0075, up to 2000 characters, one line today) shown as a multi-line field — or a new `notes` column? Is "core project file" the existing Core checkbox (which Intake and D.O.G. read — one truth) or a second flag? Default: Description IS the note; Core = the existing flag, its description rewritten to your definition.

**E3 ⛔ Tags.** (1) One tag per file, or several (a storyboard PDF that is both Creative and Reference)? (2) Beside the existing Kind (script / treatment / deck / … — the document sub-type) or replacing it? (3) The ten as written, sentence case: Production, Creative, Legal, Finance, Reference, Assets, Code, Shots, Documentation, Notes — but a tag called "Notes" next to a field called "Notes" is a reading hazard: label that tag "Meeting notes"? (4) Plain monochrome badges (ten colours would break the palette). Default: several; beside Kind; "Meeting notes"; monochrome.

**E4 ⛔ Legal and Finance — what "restricted" can mean.** Finance already exists: an invoice is marked financial AT UPLOAD, its bytes go into a reserved folder in Supabase storage, and only workspace admins and project managers can see the row or the bytes. The bytes' location is the real gate; it cannot be changed after upload without a new privileged mover, and money files can never live on BYO storage. Legal has no gate at all, and your Legal audience (leads, admins, reviewers/managers) is wider than Finance's ("admins and leads" — today reviewers see no money). Options: (a) Finance tag = the existing money gate; Legal = a new gate with the same audience (plus reviewers only if you confirm), both at upload only; (b) both = the money gate; (c) this session ships the ten tags as LABELS (Finance shown read-only from the existing financial flag; Legal labelled "not restricted yet"), and the Legal gate is its own later session once you rule on the audience. Also: who may set or remove a restricted tag (a member un-tagging Legal would expose the file)? Default: (c) now, (a) later, restricted tags settable only by people who pass the gate.

**E5 ⛔ Schema sequencing.** The files migration must come after Track C's 0074/0075/0078 (they re-point the files policies and add the Description column), which are not on this branch. Split S4 into S4a (the UI now, tags/notes stubbed behind the columns that exist) and S4b (schema + policies after Track C merges)? Default: yes.

**E6 ⛔ FBX preview.** No 3D library is installed; three.js is a new dependency (lazy-loaded so the rest of the app pays nothing; the lock regenerated with npm 10). An FBX is parsed whole in memory, so "very large" is about RAM: warn above 50 MB, refuse above 250 MB with a Download button instead? Untextured grey shading; on S3/Drive workspaces the viewer states it cannot fetch the body. Default: accept; 50 / 250.

**E7 ⛔ "Table view issue" in your title.** It is never described. Candidates found: (1) Kind/Description edits on Summary never persist in the cloud (they are dropped); (2) column widths cutting "DURATI…" at 1280 (may already be fixed by V2, needs measuring); (3) indentation removed from the Files table (your Q59); (4) the 300px details panel showing at rest (Q60); (5) dates right-aligned on Files, left elsewhere; (6) the Control Panel table scrolling sideways at narrow widths. Which one — or something else? Default: (1) is treated as the defect and fixed by E2; (2) measured and fixed if real; the rest stay as your open questions.

**E8 The Files tab.** A twelfth R.A.B.B.I.T. tab, in the first group after Summary; the project picker hidden (it is the open project); the Resources → Files page stays as well (one component, two hosts). Default: yes.

**E9 Preview and download, the list.** Inline: images, video (the existing player, autoplay OFF), audio, text / markdown / code (up to 2 MB; HTML and SVG shown as escaped text, never rendered), PDF (the browser's viewer, verified in the packaged app and on the beta), FBX. Everything else: icon + Download. Preview in the largest kit dialog (960px; a full-window lightbox is filed as a kit request). Desktop-only "Open in default app" (new) and "Show in folder" (exists). Download: cloud via the signed link as today; desktop rows that are already on disk reveal the file. Default: as stated.

**E10 Where the editor opens.** The existing right-hand Details panel becomes the editor (notes, Core switch, tag chips, Preview / Download / Show in folder), collapsed until a file is selected; double-click or Enter opens the preview; the Name cell becomes a button so the keyboard can reach it. Default: yes.

**E11 Desktop-managed files.** The explorer also lists the desktop's per-asset/shot managed files, which already have notes. They get notes and tags too; the Core toggle is hidden for them with a one-line reason (Intake reads project files only); bin files are out of scope. Default: yes.

**E12 Existing rows.** Tags start empty (no backfill); Finance is displayed from the existing financial flag, not written; the old `kind` column is ignored, not mapped. Default: yes.

**E13 Audit and help.** Opening a preview logs one "downloaded" per file per session (chain of custody); tag/note edits ride the existing edit history, no new event type. A new "Files" help page. Default: yes.

**E14 Google Drive research.** The session may read the web for it; the result is a short section in the hand-off naming what was borrowed (arrow-key next/previous, the title bar with Download / Open, the "no preview available" card) and what was not. Default: yes.

---

## F. Session 5 — Budget versions in the Timeline

Two facts first. (1) A saved bid version stores task ids, roles, days and totals — NO dates, no phases, no key dates. No existing version can show a timeline. (2) In the desktop's signed-out Local Server mode (the demo mode) the Budget tab is hidden entirely by the money gate, so no bid version can exist there and a Timeline dropdown would be empty in the demo.

**F1 ⛔ Only new bids carry a timeline.** From now on a saved bid also stores its phases, task dates, key dates and computed span (which also fixes the "$0 total" bug on locked versions). Older bids show "no timeline captured". Accept? Default: yes.

**F2 ⛔ What the Timeline shows for a version.** A read-only gantt of that bid in the same view (no drag, no create, undo/redo disabled while viewing) under a banner naming the version; "Current" restores the live view; key dates stay live; groupings allowed with today's assignments. Default: yes.

**F3 ⛔ Dropdown AND table.** Your bullets 2 and 3 name both. Proposed: a dropdown on the Budget Summary (chooses the selected bid) and in the Timeline (view only), plus a "Manage versions…" button opening the same picker dialog as the shot lists, whose table keeps Delete, the Locked badge, date, total, bid days, timeline length and the summary. Default: yes.

**F4 ⛔ The demo mode.** Open the money gate on the desktop Local Server (the folder picker already opens when there is no workspace — one line, one test), so bids can be saved and viewed in the demo — or keep money closed everywhere and demo this on staging? Default: keep it closed (no permission change without your ruling); the one-line opening is written into the hand-off.

**F5 ⛔ Order.** S5 waits for S3's picker table (wave 4), or builds its own picker now and S3 adopts it? Default: wait.

**F6 "Overall length of the timeline."** = calendar span in days ("142 d", the dates in a tooltip), computed and stored when the bid is saved; bid days shown beside it; older bids "—". (Working days are per-person because holidays are per machine, so they are not a stable figure.) Default: yes.

**F7 Which total.** The stored total leaves the agency fee out while the on-screen Grand total adds it — so the two can disagree. Store the total WITH the agency fee when it is on (match the screen); it stays the task-based bid; the Topsheet is not versioned. Default: yes.

**F8 "What is different and why."** A short optional note typed when saving (editable later) PLUS an automatic line against the previous bid (Δ bid days, tasks added/removed, rates changed, margin/contingency from→to, Δ total, Δ span). Stored as a real column, riding in S3's budget-versions migration (or inside the snapshot if S5 runs first). Default: both; column.

**F9 While a budget is active.** The Timeline dropdown is shown disabled, pinned to the locked bid, with the reason ("Reset to bidding to view other versions") — or do you want the locked bid's timeline viewable during production (the "what we planned vs what is happening" use), with only switching disabled? Default: honour your brief (disabled).

**F10 Who sees the dropdown.** Bid versions are managers-only money; the Timeline is open to everyone. Hide the dropdown for non-managers; never show money in its options. Default: yes.

**F11 The Summary after the move.** Order: active-budget banner, the three stats (Bid days / Logged days / Variance — they stay live), the versions block (create row: name + summary + Save, the dropdown, the details of the selected bid, Variance vs selected, Set budget active), then Cost breakdown, then the Topsheet. "Save bid version" is the page's one orange button. Words: "Bid version" everywhere; "Selected bid" for the one the variance measures against; "Budget active — in production" for the lock. Default: yes.

**F12 Housekeeping while in there.** Fix the $0 totals on the test fixtures; write the lock date into its real columns at activation; make the cloud and desktop clear the previous "selected" bid the way the test adapter already does; version writes no longer reload the whole project (so Undo survives). Default: yes.

**F13 Dropdown details.** Newest first; option text "Name · date · Active/Locked"; choosing writes immediately (as the table's one click does); deleting the selected bid leaves the dropdown on "Choose a bid version" rather than promoting another. Default: yes.

---

## G. Things I decided without asking (say if any is wrong)

- The nav strip loses "Tool settings" for all three tools; the plumbing goes; the help copy changes in the same commit.
- Every new orange text gets a named job in the design notes and a contrast pair in the tokens test, so the next review cannot "correct" it away.
- Every session keeps the overhaul's protocol: state-extraction commit first where it restyles, tests updated in the same commit, two adversarial review rounds (the second attacking the first's corrections), the vitest count stated (baseline 178 files / 3,892 tests), a hand-off and a walkthrough, the chip for the next session, `git checkout --detach` last. Sessions 3 and 4 load the laws-of-ux and design-direction skills by name; 1, 2 and 5 load laws-of-ux.
- Migrations land on dev only; the staging and prod commands go into each hand-off's "Waiting on Audrey".
- No session touches `feat/multi-user-v1`, the demo branch, the track branches, staging or prod.
