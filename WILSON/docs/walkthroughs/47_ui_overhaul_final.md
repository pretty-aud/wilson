# 47 — The UI overhaul, in one read

The UI overhaul gave WILSON one visual language. Every page and tool now uses one typeface (Geist, with Geist Mono for figures only), one type scale with an 11px floor, one set of colours from a single token file, 1px hairlines, two corner sizes and one shadow for things that float. The repeated parts (buttons, tables, dialogs, drawers, tabs, switches, empty states) are one shared kit. The light pages (Home, Settings, Help) stay on the orange; the data pages and the tools sit on the dark paper inside the orange frame. Sessions F1 to P1 did the work between 2026-09-11 and 2026-09-27, and none of it has reached `main`: it merges as one, on your word, after this read.

The build on your Desktop is the last commit of the overhaul (the start-here note beside this file names it). This document replaces walkthroughs 20 to 46: you need not open them. Section 1 says, page by page, what changed and where the before and after pictures are. Section 2 is every question those walkthroughs left open, 193 after merging the ones asked more than once, numbered once across the whole list, so you can answer "12: yes, 40: the second". Section 3 is where the pet covers the page, measured. Appendix A lists what you already ruled (23 questions settled by your rulings, 5 answered by later work), so nothing is asked twice. Appendix B lists the parts the shared kit still lacks. The 251 question rows the walkthroughs held were read by six extraction passes, whose files sit in `docs/sessions/handoffs/p1-consolidation-*.md` if you want the originals.

## 1. What changed, page by page

### App-wide and the shared parts

- Everything is set in Geist, with Geist Mono for figures, sizes, dates, ids and code only (F1, T0). One type scale: seven sizes, 11px the smallest, two weights; capitals only on short labels (table heads, field labels, badges).
- One hairline, two corner sizes (3px controls, 6px floating things) and one shadow, for floating surfaces only (T0, P1 moved the last five stray shadows onto it).
- Keyboard focus shows one ring (orange on dark, black on orange), never on a mouse click (F1). Dialogs take the keyboard: focus starts inside, Tab stays inside, Escape reverts a field then closes, focus goes back to where it was (F3).
- Date pickers, number arrows and drop-down lists open dark on the dark pages (F3). Every native confirm box is the app's dialog, except two on R.A.B.B.I.T.'s Team tab (still open).
- P1: the pet's chat bubble writes its bold, italics and headings in the bubble's own ink (it used amber, grey and orange, which vanished on the orange bubble).

Shots, before → after, in `docs/sessions/handoffs/img/`: `ui-f3-colorscheme-before-1440x900.png` → `ui-f3-colorscheme-after-1440x900.png`.

### The shell and sign-in

- The nav strip is grouped and in sentence case; the two settings items are "App settings" and "Tool settings" (F2, Q7).
- The sign-in screens are sentence case with one filled primary, aligned fields and thinner bars on a short window (D2, W7); V2 measured every stage at both window sizes.
- The "Close WILSON" box is sentence case, with an outlined Cancel and a darker orange Close (T3).
- P1: the title bar's three window buttons have names and tooltips (Minimize, Maximize or restore, Close).

Shots, before → after, in `docs/sessions/handoffs/img/`: `t3-before-close-dialog-1280x700.png` → `t3-after-close-dialog-1280x700.png`.

### Home

- Fonts only, as you asked (C3): all capitals (W4) at 16px, the hover a darker fill with a white label (W5), icons at 24px (W6).

Shots, before → after, in `docs/sessions/handoffs/img/`: `t0-before-home-1440x900.png` → `t0-after-home-1440x900.png`; `t1-before-home-1440x900.png` → `t1-after-home-1440x900.png`; `ui-f1-before-root-1440x900.png` → `ui-f1-after-root-1440x900.png` (6 pairs in all).

### Settings

- Every section is one row pattern: a small label on the left, the control on the right, hairlines, a 16px title per group; one underline marks the tab; the seven tabs sit in three groups (D1).
- The four native confirm boxes are the app's dialog with the same words (D1b, W9); the orange bars are 120/80 (W10).
- P1: Pet mode and Agent mode are the app's switch (they were orange "ON"/"OFF" buttons); the difficulty, auto-approve and lock buttons read in sentence case; the grey info boxes line up with the rows under them; the model pickers show whole model names.

Shots, before → after, in `docs/sessions/handoffs/img/`: `t0-before-settings-1440x900.png` → `t0-after-settings-1440x900.png`; `t1-before-settings-1440x900.png` → `t1-after-settings-1440x900.png`; `ui-d1b-before-settings-1440x900.png` → `ui-d1b-after-settings-1440x900.png` (7 pairs in all).

### Help

- The brown sidebar and white cards are gone; body text is capped at a reading width (D2); the bars are 120/80 (W10).
- P1: D.O.G.'s help reads like the others (one ink, no pale cards or grey text on the orange); every nav label and heading is in sentence case; the sections say "Projects" and "App settings" as the app does; every section keeps one reading width; the current item is marked by a thin dark edge.

Shots, before → after, in `docs/sessions/handoffs/img/`: `ui-d1b-before-help-1440x900.png` → `ui-d1b-after-help-1440x900.png`.

### The resource pages together

- Files, Projects, Rate card, Team members, Dashboard and the Admin terminal sit on the dark paper inside the orange frame (Q1), so status colours read. Their bars are 120/80; Files takes the tools' 95/8 (Q8, W10).

### Dashboard

- On the dark paper with sentence-case tabs; My tasks is the shared table, with dates right-aligned and one toolbar height (C2).

### Admin Terminal

- On the dark paper, with the kit's tables, pop-ups and buttons; the credentials pop-up has its two-step gate (C3, C3b, C3c).
- P1: two content widths where there were four (a reading width for Company, Diagnostics and Storage; the data width for Users, Requests, Logs and Models), so Refresh stays in one place; Storage's load error is the same banner as Logs'; Models shows whole model names; request statuses come from the one status list.

Shots, before → after, in `docs/sessions/handoffs/img/`: `v2-before-admin-diagnostics-1280x700.png` → `v2-after-admin-diagnostics-1280x700.png`.

### Team Members

- Rebuilt on the dark surface: status in colour, dot and word, money aligned, row buttons (F2). Its confirm boxes are the app's dialog (D1b).

Shots, before → after, in `docs/sessions/handoffs/img/`: `v2-before-team-members-1280x700.png` → `v2-after-team-members-1280x700.png`.

### Files

- On the dark surface: names line up, numbers right-align, the misleading indent is gone, the toolbar is split by job (C1); one project files table everywhere (B4).

Shots, before → after, in `docs/sessions/handoffs/img/`: `b4-before-files-project-1440x900.png` → `b4-after-files-project-1440x900.png`; `t0-before-files-1440x900.png` → `t0-after-files-1440x900.png`; `t1-before-files-1440x900.png` → `t1-after-files-1440x900.png` (9 pairs in all).

### Projects

- On the dark surface (C1), with the shared project files table in its detail (B4).

Shots, before → after, in `docs/sessions/handoffs/img/`: `b4-before-projects-detail-1440x900.png` → `b4-after-projects-detail-1440x900.png`; `t2-before-projects-1440x900.png` → `t2-after-projects-1440x900.png`; `v2-before-projects-detail-1280x700.png` → `v2-after-projects-detail-1280x700.png` (5 pairs in all).

### Rate card

- On the dark surface with the kit's table (C1). At 1280 wide it still scrolls sideways (a question in section 2).

Shots, before → after, in `docs/sessions/handoffs/img/`: `v2-before-rate-card-1280x700.png` → `v2-after-rate-card-1280x700.png`.

### D.O.G.

- The sidebar and section bars use the kit: quiet titles, standard buttons with one deep-orange primary, the standard switch, checkboxes and banners, no shadows (A1).
- The toolbars, the right-click menu and the rewrite box are the standard parts; History, the duplicate picker, New project and Help are standard dialogs (A2). V2 levelled the checkboxes and the settings accordions.
- P1: "Select layout..." reads as a placeholder, like "No project selected"; its help window is on the app's colours.

Shots, before → after, in `docs/sessions/handoffs/img/`: `a1-dog-before-1440x900.png` → `a1-dog-after-1440x900.png`; `a2-dog-help-before-1440x900.png` → `a2-dog-help-after-1440x900.png`; `t0-before-dog-1440x900.png` → `t0-after-dog-1440x900.png` (24 pairs in all).

### O.T.T.E.R.

- Lessons read at about 63 letters a line with one right edge, white headings over grey text, compact tables and one code well; the top strip matches R.A.B.B.I.T.'s (A3).
- All nine windows are the app's one window: four widths, Cancel then the action at the bottom right, a ✕, Escape and the busy lock; the Validator has grade badges (A4).
- P1: its help window's section titles are sentence case and its emphasis is readable; the agent's new-course proposal is the app's dialog (it was a green-buttoned box of its own).

Shots, before → after, in `docs/sessions/handoffs/img/`: `a3-otter-course-before-1440x900.png` → `a3-otter-course-after-1440x900.png`; `a4-otter-change-request-before-1440x900.png` → `a4-otter-change-request-after-1440x900.png`; `t0-before-otter-1440x900.png` → `t0-after-otter-1440x900.png` (41 pairs in all).

### R.A.B.B.I.T.: the shell, Intake, Summary and Team

- The active tab is an underline; the eleven tabs sit in three groups; the storage dot and LIVE badge moved into the project bar; Summary, Intake and Team are on the kit (B1, T2).
- P1: "Control panel" is in sentence case; "No project loaded" is drawn one way on every tab; the help window's section titles are sentence case.

Shots, before → after, in `docs/sessions/handoffs/img/`: `b1-before-rabbit-1440x900.png` → `b1-after-rabbit-1440x900.png`; `b2-before-rabbit-task-detail-1440x900.png` → `b2-after-rabbit-task-detail-1440x900.png`; `b3-before-rabbit-help-1440x900.png` → `b3-after-rabbit-help-1440x900.png` (40 pairs in all).

### R.A.B.B.I.T.: Tasks

- Number tiles, a one-line toolbar (Table / Board, New task the one orange button) and a real table with a dot-and-word status; the task popup, New task and the templates are the app's dialog (B2).

Shots, before → after, in `docs/sessions/handoffs/img/`: `b2-before-dashboard-task-detail-1440x900.png` → `b2-after-dashboard-task-detail-1440x900.png` (8 pairs in all).

### R.A.B.B.I.T.: Timeline

- The minimap draws and names every phase (taller up to ten, never cut) with readable dates; the gantt is one row across both halves, coloured by status, with grey links and one legend line (B3, B3b, B3c, B3d).
- V2: the "+ Task" editor fits a 700px window and scrolls inside; its Save and "Extend phase" are white on the deeper orange.

Shots, before → after, in `docs/sessions/handoffs/img/`: `b3-before-rabbit-timeline-1440x900.png` → `b3-after-rabbit-timeline-1440x900.png`; `b3b-minimap-before-9phases-5yr-1440x900.png` → `b3b-minimap-after-9phases-5yr-1440x900.png`; `t0-before-rabbit-timeline-1440x900.png` → `t0-after-rabbit-timeline-1440x900.png` (13 pairs in all).

### R.A.B.B.I.T.: Files, Assets, Levels and Experiences

- One project files table everywhere; the video player, the asset, level and experience popups, File activity and Edit history are on the kit (B4, B4b, B4c).
- P1: an empty description shows "—" as every other table does.

Shots, before → after, in `docs/sessions/handoffs/img/`: `b4-before-rabbit-asset-detail-1440x900.png` → `b4-after-rabbit-asset-detail-1440x900.png`; `v2-before-rabbit-assets-1280x700.png` → `v2-after-rabbit-assets-1280x700.png` (33 pairs in all).

### R.A.B.B.I.T.: Bins

- Every button and row reacts to the mouse, the too-faint greys are fixed, the poster tags have a backing; mono only on data; the dialogs are the app's; the shortcut bar is gone, its keys listed in Help (B6, Q10).
- P1: a poster with no picture draws its icon at one of the app's three icon sizes.

Shots, before → after, in `docs/sessions/handoffs/img/`: `b4-before-rabbit-bins-1440x900.png` → `b4-after-rabbit-bins-1440x900.png`; `b6-before-rabbit-bins-1440x900.png` → `b6-after-rabbit-bins-1440x900.png` (4 pairs in all).

### R.A.B.B.I.T.: Budget

- Money is written one way (mono, right-aligned, a variance carries its sign); standard tiles, tables and underlined tabs; Crew/team and Talent read Actual before Variance; the client estimate prints on white paper (B5, B5b).
- P1: a six-figure actual fits its period cell in Crew/team and Talent.

Shots, before → after, in `docs/sessions/handoffs/img/`: `b5-before-rabbit-budget-1440x900.png` → `b5-after-rabbit-budget-1440x900.png`; `v2-before-rabbit-budget-1280x700.png` → `v2-after-rabbit-budget-1280x700.png` (34 pairs in all).

### R.A.B.B.I.T.: Scenes

- Scenes' tables, tiles and toolbar use the kit; the scene and shot popups are the app's dialog; the create buttons read "New scene" and "New shot" (B5b).

Shots, before → after, in `docs/sessions/handoffs/img/`: `b4-before-rabbit-scene-detail-1440x900.png` → `b4-after-rabbit-scene-detail-1440x900.png`; `b5b-before-rabbit-scene-detail-1440x900.png` → `b5b-after-rabbit-scene-detail-1440x900.png`; `b6-before-rabbit-scenes-1440x900.png` → `b6-after-rabbit-scenes-1440x900.png` (17 pairs in all).

## 2. Every open question, in one list

193 questions. Each gives what to look at, the choices as its walkthrough put them, and every walkthrough that asked it (WT45 Q30 is walkthrough 45's question 30). Answer by number.

### Your walk of the packaged build (W12)

These need the real app, your data or Windows scaling at 125% and 150%: report what you see.

1. **Walk the seven Settings tabs in the packaged build with real data and at 125% and 150% Windows scaling, and report what is wrong.**
   Look at: Packaged build: Models with its 28 real functions, Storage with a demo folder open, Teams with real departments; 125% and 150% scaling. Choices: None: a report, not a choice. (WT22 §4)

2. **Walk Files, Projects and Rate card with real data, including the views that need it, at 125% and 150% scaling, and report what is wrong.**
   Look at: Every table on the three pages with real rows; the Projects detail and Create project views; the import preview dialog (needs a spreadsheet); 125% and 150% Windows scaling. Choices: None: a report, not a choice. (WT24 u1)

3. **Signed in with your real data, do the populated task table, board, gallery and note editor look right? The only populated shots are renders of the components' markup, not the app.**
   Look at: /dashboard signed in to your workspace: My tasks as table, board and gallery, and a note open in the editor. Choices: None given; the walkthrough calls it the first thing worth checking and asks for a report. (WT25 u1)

4. **In the real build, does the date picker open dark on App settings and in R.A.B.B.I.T. at 125% and 150% Windows scaling?**
   Look at: The packaged build at 125% and 150% scaling: a date field's calendar on App settings and in R.A.B.B.I.T. (a project → Assets, a Start or Due cell). Choices: Confirm, or report where it still opens light. (WT28 u3)

5. **Walk the Storage tab in the packaged build: a real close and a real reset of the demo folder with the window reload that follows, and what a real failure message looks like in the dialog footer.**
   Look at: The packaged build → App settings → Storage tab: Close folder, Reset folder, Disconnect Google Drive. Choices: Report what you see; the browser shots used a stand-in desktop bridge. (WT29 Need 1)

6. **Do the 120/80 bars hold up in the app on your own screens at 125% and 150% Windows scaling?**
   Look at: App settings, Help and Team Members in the packaged build at 125% and 150% scaling. Choices: Report; 1440x900 and 1280x700 are already in the screenshots. (WT29 Need 2)

7. **Do the 12px initials fit inside the 24px circles on R.A.B.B.I.T.'s Team tab at 100%, 125% and 150% Windows scaling?**
   Look at: R.A.B.B.I.T. → Salt Hours → Team at 100%, 125% and 150% Windows scaling; two wide capitals ('WW') are the worst case. Choices: None; look and report (the session could check only one scaling). (WT34 item 1)

8. **With your real bins, are offline files readable, and still obviously offline?**
   Look at: A bin with offline files (an unplugged drive), in the packaged build in Local Server mode. Choices: Yes / no: a check. (WT38 Check 1)

9. **Are the VID / IMG / AUD type tags readable on your real footage posters?**
   Look at: Bins with your real footage, in the packaged build in Local Server mode. Choices: Yes / no: a check. The tags now have a small tinted backing. (WT38 Check 2)

10. **Check how the columns feel with the whole real library: how many courses fit, and how long lesson titles wrap.**
   Look at: The packaged build in Local Server mode: O.T.T.E.R.'s courses and lesson columns with the six real courses. Choices: None (a check to report). (WT41 u1)

### App-wide and the shared parts

11. **Where should the dev fixtures pill sit?**
   Look at: Any page under npm run dev with VITE_DEV_FIXTURES=1: the dark pill 'DEV · FIXTURES ON · Salt Hours · OFF' at the top left. Choices: Top-left under the Electron title bar, out of the hamburger's way (current); the nav strip; or the bottom bar. It is one style object in src/dev/DevFixturesBadge.jsx. (WT26 Decision 1)

12. **Keep 'Salt Hours', an invented short film by Lantern & Ash Pictures, as the fake studio, or switch to a different kind of project?**
   Look at: Any populated page with the fixtures on; the data lives in src/dev/fixtures/data/*.js. Choices: Keep Salt Hours (current), or a different kind of project such as a brand campaign or a game; only the data files change. (WT26 Decision 2)

13. **On the orange pages a disabled icon button is now legible but still looks much like an enabled one (it says 'not allowed' on hover). Does that bother you enough to change the design?**
   Look at: App settings: a disabled icon button, the one place it appears today. Choices: Leave it (current), or make a design decision to mark disabled glyphs; no option offered, the walkthrough calls it a design decision rather than a bug fix. (WT28 u1)

14. **Keep the new disabled button on the orange pages: a recessed well with no edge that reads as a slot rather than a control?**
   Look at: App settings: any disabled button. Choices: Keep (current), or change it: 'one line to change if you dislike them'. (WT28 u2)

15. **Keep the filled dark red destructive button (white text) on the orange pages, the only status colour drawn there, or go back to an outlined button that looks like every other button?**
   Look at: App settings → Profile: Remove beside the avatar and Sign out everywhere; and the Disable MFA confirm. Choices: Keep it (current: an unreadable error message is worse than an inconsistent one, and the sign-in screen already uses this red), or go back to outlined. (WT28 u4)

16. **Keep the 54 former spaced-capital section headings in D.O.G., O.T.T.E.R., R.A.B.B.I.T. and the help pages as 14px semibold sentence-case headings ('Overview', 'Basic workflow'), or restore their capitals?**
   Look at: O.T.T.E.R.'s library page (the category marker SOFTWARE now reads 'Software'), or the section headings in any tool's help pane. Choices: Keep sentence case (the session decided and shipped it), or restore the capitals ('one line in the map and a re-run'). (WT30 u2)

17. **Should field labels keep their small capitals where several sit in a row, as beside D.O.G.'s checkboxes?**
   Look at: D.O.G.'s main screen: THEME GENERATOR, USE UPLOADED ASSETS and USE PROJECT ASSETS beside their checkboxes. Choices: None given; the labels are 'correct by the rules' and the session did not decide ('Same question as the headings, narrower'). (WT30 Q1)

18. **Should names, such as a course name, be exempted from the capitals of the label-styled spans they sit in?**
   Look at: O.T.T.E.R.'s sidebar: the course DAVINCI RESOLVE, which was uppercase before this work too. Choices: Exempt names ('I will hand the lanes a list'), or keep the label's capitals (current). (WT30 Q2)

19. **Keep people's email addresses in the normal font rather than the typewriter (mono) font?**
   Look at: A person's email in 'the team list' (the walkthrough does not name the screen). Choices: Keep the normal font (the session's call: an address is 'closer to a name than to an id'), or go back to mono ('Easy to reverse if you disagree'). (WT30 Q3)

20. **Nothing is asked explicitly: listed as an open question, it reports that 94 controls still fade to 40% opacity when disabled instead of taking a proper disabled colour.**
   Look at: Any disabled button, e.g. a disabled orange one (90 of the 94 paint their own background). Choices: None offered; the session left all 94 for 'the sessions that follow', to be done per surface, not by search and replace. P1's sweep finds three left, all in the Timeline task editor's footer; they change with the editor's look (the Timeline question on it). (WT30 Q4)

21. **Does a too-narrow table column header, now trailing off with '…', look right on Audrey's screen?**
   Look at: Admin Terminal → Users, narrowing the window until the RATE ACCESS header runs out of room. Choices: None; a look-and-report ('does this still look right on YOUR screen'). (WT31 §1)

22. **Does a two-tab strip in a toolbar, now kept to one line, look right on Audrey's screen?**
   Look at: Admin Terminal → Logs, the row holding System / Activity and the All types / All severities dropdowns. Choices: None; a look-and-report. (WT31 §2)

23. **Does any notification ever appear over the orange bar, on any page, at any window size?**
   Look at: App settings: trigger two notifications at once, then other pages and a short window (at 1280x700 the bar is 80px and the stack starts at 104). Choices: None; the check is 'that nothing ever appears over the orange, on any page, at any window size', with a short window 'the interesting case'. (WT31 §4)

24. **Do you want the faint outline on the app's secondary buttons made stronger, now that it is purely a look question?**
   Look at: Any secondary button: its faint outline. Choices: Stronger / as it is. No recommendation. P1 also measured the kit field's edge (`.ui-input`, P1-68) at 1.48:1 on the raised paper, where WCAG asks 3:1 of a control's only boundary: one answer can cover both. (WT35 §5, WT32 Q2)

25. **May a session download Geist's full release to see whether it draws → ← ✓ ✕ ● ○ ▸ and the like, and ship them if it does?**
   Look at: O.T.T.E.R.'s new-course form, whose round ●/○ option buttons are drawn as text (v1-otter-new-course-1280x700.png); also "Run Intake →" and "Copied ✓". Choices: Yes: download it (free, the same licence as now) and ship the glyphs if Geist draws them; if it does not, the app's own ~40 uses get icons and generated lessons keep Segoe UI for those characters. Or no. Since V2 the same holds for "₩" in the currency pickers, and since P1 for D.O.G.'s ▸ output markers on Help → D.O.G. → System prompts (drawn in Cambria Math). (WT43 Q16, WT41 Q11, WT40 Q8d, WT36 Q6, WT35 Q1)

26. **Will you run `gh auth login` once, in a terminal in this repo, so sessions can read build results without being rate-limited?**
   Look at: A terminal in the repo; nothing in the app. Choices: None: a one-time action, now owed by eight sessions. (WT35 Q6, WT33 §6, WT32 Q3)

27. **O.T.T.E.R. no longer shifts sideways between a long page and a short one (the scrollbar space is kept either way): make it the same everywhere?**
   Look at: O.T.T.E.R.: go between a long page and a short one (a lesson and Sources), then do the same in D.O.G. or R.A.B.B.I.T. Choices: The same everywhere, or O.T.T.E.R. only. (WT41 Q15)

28. **Home's arrow and Enter keys work on every page (in O.T.T.E.R.'s Search they could take you to D.O.G. or R.A.B.B.I.T.): what should be done?**
   Look at: O.T.T.E.R.: open Search and press the arrow keys and Enter. Choices: None given; left to the closing session. (WT43 Q19)

29. **The standard dialog adds a ✕ to small question dialogs that had none (the Assets bulk delete, the create-task question): keep it?**
   Look at: Assets: select several and delete (the bulk-delete question). Choices: Keep? yes (the ✕) / no (none, as before); no recommendation. (WT44 Q2, WT43 Q17, WT39 Q1)

30. **Side drawers (File activity, Edit history) do not take the keyboard when they open, so Tab stays on the page behind: should they take it, as dialogs do?**
   Look at: Open File activity, then press Tab. Choices: Take the keyboard / leave as is; no recommendation. (WT44 Q29)

31. **The delete questions (Scenes' three, Expenses' bulk delete and both "Reset M/C") open with Cancel focused, so Enter cancels where the browser's box confirmed: keep Cancel as the default?**
   Look at: Scenes: tick rows and delete, then press Enter. Choices: Keep Cancel as the default / confirm on Enter, as the browser's box did; no recommendation. (WT45 Q25)

32. **Escape closes a scene, shot or expense popup even with an unsaved description, notes or a half-filled task form: should the popup ask before throwing a draft away?**
   Look at: A scene popup: open the task form, type a title, press Escape. Choices: Ask before discarding / close as now (the standard dialog's Escape); no recommendation. (WT45 Q27, WT42 Q22)

33. **Enter on any focused button toggles the pet instead of pressing the button (Space works): fix it in P1?**
   Look at: Tab to any button and press Enter. Choices: Fix it in P1 / leave; it waits for Audrey because the pets are hers to change. The code is `App.jsx` about lines 1404–1417 (P1-01). (WT45 Q30, WT44 Q25, WT42 Q7, WT39 Q10)
   Q33: answered 2026-09-29 (post-overhaul ruling C12): the pet's toggle moves from Enter to a bare Shift tap (never while typing in a field, never over a dialog), and Enter presses whatever is focused. Done by post-overhaul S2a, 2026-09-30 (P1-01 closed); see walkthrough 49.

34. **The Undo toast now sits over menus as well as dialogs (the standard order), so a context menu opened near the bottom centre (Bins, Tasks) can sit under a live toast: keep?**
   Look at: Delete something in Bins, then right-click near the bottom centre while the Undo toast shows. Choices: Keep? yes / no; no recommendation. (WT45 Q32)

35. **At 1280 wide the pet covers some table figures (the Topsheet's grand-total variance, the Scenes runtime column): move it?**
   Look at: Budget → Topsheet at 1280x700 (WT46 §5 lists every screen). Choices: Move it / leave it; the pets are Audrey's to change. The measured list, screen by screen, is section 3. (WT45 Q33)

36. **The standard chip is set in small capitals because the component plan says chips use the label style, while the sentence-case ruling (Q2) names chips among the things that go to sentence case: which should win?**
   Look at: O.T.T.E.R.'s course-list filter chips ("ALL", "MADE FOR ME") and the Admin Terminal's filters. Choices: The component plan (label-style capitals) / plan Q2 (sentence case); no recommendation. (WT46 Q1, WT41 Q4)

37. **The app writes dates six ways ("Aug 3, 2026", "08/24/2026", "9/2/2026", "2026-09-21", "08/02", "Aug 19, 2026, 7:00 AM"): shall P1 make them one?**
   Look at: The six forms quoted, across the app's tables and pop-ups. Choices: One form, for example "Sep 2, 2026" with the time only where it matters (the walkthrough's example) / leave. (WT46 Q2)

38. **A level's (or experience's), a scene's (or shot's) and a task's pop-up draw the same things differently (plain text or boxed fields, capital or sentence-case headings, "Done" or "Close"): which one should P1 make the others match?**
   Look at: A level popup, a scene popup and a task popup, one after the other. Choices: The level/experience pop-up / the scene/shot pop-up / the task pop-up; no recommendation. (WT46 Q4)

39. **On Levels, Experiences, Tasks and Assets the table runs edge to edge under a toolbar on the 24px margin, while on Scenes and Budget the table sits on the margin too: which?**
   Look at: Assets, then Scenes, at 1440x900. Choices: Tables across the full width / tables on the 24px margin; no recommendation. (WT46 Q5)

40. **Names are bold in the asset, level, scene and task tables but regular in the file tables, and the Files page puts its dates on the right (as figures) where R.A.B.B.I.T.'s file tables put them on the left: one rule for each?**
   Look at: The Assets table beside a project files table; the Files page beside the Control Panel's files table. Choices: One rule for names (bold or regular) and one for dates (right or left); no recommendation. (WT46 Q6)

41. **Every side panel (File activity, Edit history, R.A.B.B.I.T. settings) is titled only by a small capitalised word at the top, where a dialog has a proper title: give side panels a title too?**
   Look at: R.A.B.B.I.T.'s File activity panel beside any dialog. Choices: Yes / no; no recommendation. (WT46 Q8, WT44 Q23, WT43 Q4, WT40 Q8b, WT36 Q2)

### The shell and sign-in

42. **What should the Close WILSON box look like (walkthrough 32's question 1, still open)?**
   Look at: The Close WILSON box, beside one of the four rebuilt kit dialogs. Choices: V1 recommends moving it to the raised dark with a plain title, which is what the four rebuilt dialogs look like. WT32 Q1's own options are not restated. (WT35 Q4, WT32 Q1)

### Home

43. **When Home's Resources column opens, the other five items fade to a brown very hard to read on the orange (1.77 to 1, against the black-or-white-on-orange rule): keep the fade, or make them readable?**
   Look at: Home: open the Resources column. Choices: Keep the fade / make them readable; the walkthrough notes Home is Audrey's to keep as it is. Home is fonts only (C3), and the rule on orange is black or white. (WT46 Q3)

### Settings

44. **The Storage card's 'Disconnect' button is red-outlined but the confirmation it opens has an orange 'Disconnect'. Both red, or both orange?**
   Look at: App settings → Storage → Google Drive: the Disconnect button and the confirmation it opens. Choices: Both red, or both orange: 'it is one word'. Current: red outline on the card, orange in the dialog, because reconnecting undoes it. (WT29 Need 4)

45. **Should any confirmation button's words change? The four dialogs say 'Remove', 'Disconnect', 'Close folder' and 'Reset folder' where the OS box said OK.**
   Look at: App settings → Teams (remove a department) and Storage (disconnect Drive, close and reset the demo folder). Choices: Keep the action names (current), or name other words; one word each. (WT29 Need 5)

### Help

46. **Ctrl+Z and Ctrl+Shift+Z work in Expenses and Scenes but only a button's tooltip mentions them: should Help list them?**
   Look at: Help, beside the Undo button's tooltip in Expenses. Choices: List them in Help / tooltip only; no recommendation. (WT45 Q10)

### The resource pages together

47. **On the new dark ground, does anything on Files, Projects or Rate card read washed out or too dim?**
   Look at: Files, Projects and Rate card with real rows: body text, the quieter secondary columns, the greens and ambers on Rate card and Projects. Choices: Report yes/no. The aim: comfortable body text, secondary columns quieter but readable, status colours clearly visible. (WT24 §1)

48. **Clicking between Team members, Files, Projects and Rate card, does it feel like one app?**
   Look at: Team members, Files, Projects and Rate card in turn: the same table, toolbar, empty states, buttons and type. Choices: Report yes/no; the walkthrough calls it 'the real question'. (WT24 §12)

### Dashboard

49. **Does the Dashboard's Profile tab look right? It shows Settings' shared profile editor through a small local patch that re-points its light-page colours for the dark page.**
   Look at: Dashboard → Profile tab. Choices: None given; if anything looks wrong the patch is the first suspect, and the real fix is a one-line change to the shared component in the Settings pass. (WT25 item 1 (Two things…))

50. **Do you want a summary band at the top of My tasks: overdue, due this week, blocked, total?**
   Look at: Dashboard → My tasks, above the toolbar. Choices: Say so and it is 'a small job'; the default is no band, since the session would not add things the page never showed. (WT25 item 3 (Two things…))

51. **Does 'Assigned' still need to stand out more than 'Reviewing' at a glance? Both are now plain outlined labels and only the word tells them apart.**
   Look at: Dashboard → My tasks: the Assigned and Reviewing labels on the task rows. Choices: Keep both outlined (current); a different shape for one of them; or grouping by role. The walkthrough would rather Audrey choose than guess. (WT25 u2)

### Admin Terminal

52. **Is the ADD PEOPLE menu's explanatory copy right: 'Invite by email… — They set their own password' and 'Create with password… — You hand over the credentials'? Tell me if either is wrong or misleading.**
   Look at: Admin Terminal → Users → ADD PEOPLE menu (workspace admins only). Choices: Keep the two lines as written, or reword either; no alternative offered. (WT27 §2)

53. **Did anything stop responding after every hover, selected, active, disabled and confirmation state moved out of the JavaScript into a stylesheet? Try to find something that used to light up and no longer does.**
   Look at: Admin Terminal, all seven sections, with part one's §3 checklist: nav selection; Users rows, side panel, filter, rate-card switches, Escape; Logs tabs, row expand, filters, Refresh; the Requests count; Company's copy flash and chip removal; Storage selection; the Models override wash; the Diagnostics copy tick. Choices: Report any regression; nothing to choose. (WT27 §3)

54. **On the Users roster, is exactly one row marked at a time, and does a deactivated member read as quieter rather than faded out?**
   Look at: Admin Terminal → Users: click a row, then another. Choices: Report if not; nothing to choose. (WT27 Part two 1)

55. **Does the credentials pop-up's two-step gate feel right? Until the password is copied, the X, Escape and the button each ask 'Close without copying?' once and close only on a second press within three seconds.**
   Look at: Admin Terminal → Users → ADD PEOPLE → Create with password, using a throwaway user: the show-once credentials pop-up. Choices: Keep the gate as built (keyed to copying the password, not the username), or say what should change; no alternative offered. It is show-once, so judge it the first time. (WT27 Part two 2)

56. **How should the department chip's × be fixed, given it is a 28px button in a 20px chip that makes the row too tall?**
   Look at: Admin Terminal → Company, the department chips with an ×. Choices: 1. Leave it (the row stays slightly tall); 2. Shrink the button to 16 (the chip is exactly right, but the × drops below the minimum click target); 3. Grow the chip to 24 (everything fits and the target stays big, but every chip in the app would want to match). Recommends 3, only with Audrey's say-so; nothing is blocked, and the current state is 1. (WT31 u1)

### Team Members

57. **Team members still cuts its right-hand columns at 1280 (the day rate, status and the deactivate buttons): what gives way?**
   Look at: Team Members at 1280x700 (docs/sessions/handoffs/img/v2-before-team-members-1280x700.png). Choices: No options given here; WT35 Q2 holds the question. (WT46 u1, WT35 Q2)

### Files

58. **With the toolbar arranged by job, can you find the Table/Columns switch faster, and does Refresh read as a command rather than a third view?**
   Look at: Files toolbar: left, the project picker and the Table/Columns switch; right, the filter, Refresh and the counts. Choices: Report yes/no; no alternative offered. (WT24 §4)
   Q58: overtaken by E1 and E8 (2026-09-29). The toolbar keeps its arrangement by job. On R.A.B.B.I.T.'s new Files tab the picker is hidden (it is the open project) and the right side gains File activity and Add files, with Relink on a warning banner above the list. Done by S4a 2026-09-30; whether it reads faster is asked again in walkthrough 52.

59. **Do you miss the indentation that was taken out of the Files table view?**
   Look at: Files → Table view: sort by each column and check the order; the Location column shows each path and the Columns view is the tree. Choices: Keep the flat, unindented table (shipped; row order unchanged), or have it back by opening the table in folder order (one-line change; loses the plain A-to-Z view on arrival). (WT24 §5)
   Q59: the flat, unindented table stays (2026-09-29; post-overhaul ruling E7, "the table view issue is dropped"). S4a left the table's order and indentation as shipped; see walkthrough 52.

60. **Should the Files details panel collapse until a file is selected, instead of keeping its 300px at rest?**
   Look at: Files with nothing selected: the 300px details panel. Choices: Keep it (shipped; the review marks it 'taste, not error' and §3 gave back 433px), or collapse it to nothing until a file is picked. 'Your call.' (WT24 Not done 1)
   Q60: collapsed until a file is selected (2026-09-29; post-overhaul ruling E10, done by S4a 2026-09-30). The panel is now the file window: the facts, then notes, Core, Kind and tags, with Preview and the file's actions in a footer. Close puts it away. See walkthrough 52.

### Projects

61. **Keep 'Inactive' as a neutral grey, or should it stay red?**
   Look at: Projects: the status column, where the word now carries the state and colour reinforces it. Choices: Neutral grey (shipped: an idle project is not an error), or red as before. (WT24 §7)

### Rate card

62. **The Rate Card still cuts its right-hand columns at 1280 (region, tier and the department rows' overhead default): what gives way?**
   Look at: Rate Card at 1280x700 (docs/sessions/handoffs/img/v2-before-rate-card-1280x700.png). Choices: No options given. P1 measured it: at 1280 the table's frame is 980px and its eleven columns' content needs about 1,040px (the longest role name 175, the Tier select's value 120, the actions 84…), so any new split cuts another column; today the table scrolls sideways. The three ways out: keep the scroll; give this table the compact cell padding the kit does not have yet (8px a side, kit request B4-KR-3, which saves 88px and fits); or narrow the import panel beside it. (WT46 u2)

### D.O.G.

63. **When Audrey next meets D.O.G.'s Resolve Duplicate window, can she still tell each preview card's subtitle from the copy lines under it, now that both are 13px?**
   Look at: D.O.G.'s Resolve Duplicate window, which appears only when D.O.G. generates two versions of the same slide (no screenshot; not reproducible with test data). Choices: Fine as is (the rule line and the bullets separate them), or 'tell me' and the session that reworks D.O.G. gives them a real distinction. (WT33 §2)

64. **Keep D.O.G.'s main column 8px from the sidebar, where the rest of the app uses 24px, so the slide preview stays exactly where it was?**
   Look at: D.O.G. with a deck open, at 1440x900 and 1280x700: the gap between the sidebar and the output panel (a1-dog-preview-after-1440x900.png). Choices: Keep 8px (current) / a preview 32px narrower / a narrower sidebar with its four buttons moved onto a second row. (WT40 Q8a, WT36 Q1)
   Q64: note 2026-09-30 (post-overhaul S2a, ruling C1): the "Deck outline" title and its four buttons left the sidebar for a full-width bar, so the reason the sidebar is 240px wide (a head holding five controls) is gone. The sidebar stays 240px and the gap 8px this bundle, and the slide preview is exactly where it was (`dog-preview-probe --check`, byte-identical). Whether the sidebar can now be 200px is walkthrough 49's question 1.

65. **Are the "Full deck" switch label in normal-size text, and the Core / Ref file tags as the kit's toggle chips ("CORE" / "REF" in small capitals, an orange edge when on), fine?**
   Look at: D.O.G.'s sidebar: the Full deck switch, and a project's files with their Core / Ref tags. Choices: Fine / change. No alternative given. (WT36 Q3)

66. **Keep three accessibility additions you did not ask for: the sidebar's remove ✕ on keyboard focus, a hover tooltip on every icon-only button, and checkboxes and a switch that announce themselves to a screen reader?**
   Look at: D.O.G.'s sidebar: Tab to a row's ✕; hover an icon-only button. Choices: Listed for approval; no alternative given (implied: keep). (WT36 Q4)

67. **Do you want any of three behaviours changed that A1 left alone because changing them changes behaviour?**
   Look at: D.O.G.: type in a prompt box; hover a sidebar row; generate a full deck. Choices: Say which, if any: the two prompt boxes grow taller while you type; the sidebar's time disappears when you hover a row; the output panel says "No output yet" while a full deck is generating. Default: all stay as they are. (WT40 Q8c, WT36 Q5)

68. **Make the read-only caption under the slide preview 12px and wrapped to a shorter line, as the critic wanted, at the cost of about two pixels in the measured preview box?**
   Look at: D.O.G. with an outline and a page open: the 'Preview is read-only…' caption under the slide preview, at 1440x900 and 1280x700. Choices: Allow the two pixels, or leave it (now upright instead of italic, size unchanged). (WT40 Q1)

69. **Keep each dialog's main button in its new bottom-right place (History's download, the duplicate picker's, New project's), the app's standard?**
   Look at: D.O.G.: History import/export (the sidebar's folder icon), the duplicate picker, New project. Choices: Keep (current: same buttons, new place), or put them back. (WT40 Q4)

70. **Keep the duplicate picker's half-second hover delay and its 'Hold...' hint, or take the critic's shorter delay with no hint?**
   Look at: D.O.G.: export a deck where two pages share a number, then hover a version in the duplicate picker. Choices: Unchanged (half a second, 'Hold...' hint), or the critic's shorter delay and no hint; left to Audrey because it changes behaviour. (WT40 Q5)

71. **While a D.O.G. window is open, stop ← and → on a focused button from switching the page behind it, and Alt from flipping Full deck?**
   Look at: D.O.G. with any dialog open: focus a button and press ←, →, Alt and Enter. Choices: Stop the first two while a window is open, or leave them (present before this session). Enter going to the pet instead of pressing the button (Space works) is stated, not asked. (WT40 Q6)

72. **Is the 'Maximum update depth exceeded' warning the slide preview logs when a duplicate-picker version is hovered worth a look later (pre-existing; nothing visible goes wrong)?**
   Look at: D.O.G.: the duplicate picker with the developer console open; hover a version. Choices: Worth a look later, or leave it. (WT40 Q7)

73. **D.O.G.'s settings accordions have titles in small capitals, the same size as the labels under them, while O.T.T.E.R.'s have a bold 14px title that reads as a heading: make D.O.G.'s like O.T.T.E.R.'s?**
   Look at: D.O.G.'s settings accordions beside O.T.T.E.R.'s. Choices: Yes, like O.T.T.E.R.'s / no; no recommendation. (WT46 Q7)

### O.T.T.E.R.

74. **Live with the lesson page's ragged right edge (the prose stops at about 613px while the Key Takeaways and Practice Exercise cards run full width) until lane A3, or pull the cards' narrowing forward?**
   Look at: O.T.T.E.R.'s lesson pane: the prose against the orange-bordered cards below it (t1-after-otter-lesson-1280x700.png). Choices: Live with it until A3 (recommended: 'the reading win is worth more than the alignment cost'), or pull it forward. (WT33 Q2)

75. **Keep lesson lines at about 63 measured letters, or follow the plan's '60 to 66ch' to the letter, which in the app's font gives 86–95 letters?**
   Look at: O.T.T.E.R.: a long lesson (course → subject → lesson) at 1440x900; and Help → D.O.G. → Slide layouts, whose 13px lists run up to 113 letters a line under Help's 668px cap (P1 review round two). Choices: About 63 letters (current), or the plan's 60–66ch; it is one number, and it would set Help's measure too. (WT41 Q1)

76. **Keep lesson text at 14px, or make it 16px for reading?**
   Look at: O.T.T.E.R.: a lesson's body text. Choices: 14px (current, the September type pass), or 16px (one line). (WT41 Q2, WT33 Q1)

77. **The course labels (Standard, Shared by you, From someone, Yours) are one grey told apart by icon and word: is that enough, or should Standard stand out?**
   Look at: O.T.T.E.R.: the Course library cards and a course's page. Choices: One grey with icon and word (current), or make Standard stand out. (WT41 Q3)

78. **Is the lesson column right at 240px (was 220px), the app's standard medium column?**
   Look at: O.T.T.E.R.: the lesson column with long lesson titles, best with the real library in the packaged build. Choices: 240px (current), or 220px. (WT41 Q6)

79. **Are library card titles too small at the app's card-title size (14px, were 20px)?**
   Look at: O.T.T.E.R.: the Course library cards. Choices: 14px (current), or larger. (WT41 Q7)

80. **Are the progress bars (lessons completed, and the sweeping generation bar) right in grey, orange being kept for selected and current?**
   Look at: O.T.T.E.R.: a course's lessons-completed bar, and '+ New' while a course generates. Choices: Grey (current), or orange. (WT41 Q8)
   Q80: unchanged, 2026-09-29 (post-overhaul ruling C8: the new orange is exactly the list she named, and the progress bars are not on it). Recorded by post-overhaul S2a, 2026-09-30; see walkthrough 49.

81. **Are links in lessons right as white and underlined rather than orange?**
   Look at: O.T.T.E.R.: a lesson with a link. Choices: White and underlined (current), or orange. (WT41 Q9)
   Q81: unchanged, 2026-09-29 (post-overhaul ruling C8: lesson links stay white and underlined; the new orange is exactly the list she named). Recorded by post-overhaul S2a, 2026-09-30; see walkthrough 49.

82. **Do the kept node type colours match the host application's socket colours, and if not, should they become one warm family?**
   Look at: O.T.T.E.R.: a real node-system course's Nodes page in the packaged build, beside Blender's sockets (the test data has no nodes). Choices: Keep as written (Q9), or one warm family if they do not match. Plan Q9 kept them as an exempt ramp on the assumption that they mirror the host application's sockets; this asks you to confirm that assumption. (WT41 Q10)

83. **A lesson's first and second heading levels are now the same size (the title is the big one): fine, or should every heading inside a lesson move one size down instead?**
   Look at: O.T.T.E.R.: a lesson that uses both heading levels. Choices: Fine as is, or every heading one size down. (WT41 Q13)

84. **Is it fine that a small table is compact at its own width rather than stretched across the page?**
   Look at: O.T.T.E.R.: a lesson with a two-column shortcut table. Choices: Compact (current), or stretched. (WT41 Q14)

85. **Is it fine that the company-standard offer is read out once by a screen reader when it appears (the old one was silent)?**
   Look at: O.T.T.E.R.: '+ New', type the name of a course the company already has, with a screen reader on. Choices: Read out once (current, the app's standard notice), or silent. (WT41 Q16)

86. **Is it fine that a very long node type name (only an unusual generated one) is cut short with '…' so the other columns keep their place?**
   Look at: O.T.T.E.R.: the Nodes page, a card with a very long generated type name. Choices: Cut with '…' (current), or not. (WT41 Q17)

87. **The confirmations' buttons moved to the bottom right, Cancel first and the action last, where they were two equal halves of a row: do the halves read better?**
   Look at: O.T.T.E.R.: any confirmation (delete a subject, clear everything). Choices: Bottom right, Cancel then the action (current, the app's one window), or the old halves. (WT43 Q1)

88. **Are the four window widths right: Help 720 (was 850; D.O.G.'s is 720), Import 560 (480), Search 960 (900), Share 560 (520), confirmations 400?**
   Look at: O.T.T.E.R.: Help, Import, Search, Share and a confirmation, at 1280x700. Choices: The four widths (current), or the old ones. (WT43 Q2)

89. **Are the Validator's grades right as small badges instead of the coloured square, with B green and C amber (they were blue and orange)?**
   Look at: O.T.T.E.R. Validator: an audit's grade beside its accuracy line (needs a validation run). Choices: Badges: A and B green, C amber, D and F red (current), or the square. (WT43 Q5)

90. **Is it right that a wrong finding shows its colour on the card's edge, not across the whole card?**
   Look at: O.T.T.E.R. Validator: a wrong claim's card and one that cannot be checked. Choices: Edge and badge (current), or the whole card washed. (WT43 Q6)

91. **Are request statuses right in the Admin Terminal's colours, Open orange (it was amber) and Changes requested amber?**
   Look at: O.T.T.E.R. Requests / Admin: the status badges, beside the Admin Terminal's Requests page. Choices: The Admin Terminal's five colours (current), or the old ones. (WT43 Q7)

92. **Is it right that errors in Share and Suggest a change appear at the bottom of the window, not in a red box in the middle?**
   Look at: O.T.T.E.R.: Share or submit and Suggest a change when a request fails. Choices: At the bottom (current), or the red box. (WT43 Q8)

93. **Fine that the keyboard can now reach Import's 'Choose file' and the quiz's course and subject rows, the same click doing the same thing?**
   Look at: O.T.T.E.R.: Tab to Import's 'Choose file' and to the Quiz center's course and subject rows. Choices: Reachable (current), or not. (WT43 Q9)

94. **Fine that the quiz's 'some subjects chosen' box shows a dash where it showed a paler tick?**
   Look at: O.T.T.E.R. Quiz center: a course with only some subjects chosen. Choices: Dash (current), or the paler tick. (WT43 Q10)

95. **Fine that the Search field shows its focus ring, since it has focus whenever Search opens?**
   Look at: O.T.T.E.R.: open Search. Choices: Ring shown (current), or hidden. (WT43 Q12)

96. **Is the Validator's lesson tree right at 20px a level, a lesson's row stepping 22px so its name sits under its section's?**
   Look at: O.T.T.E.R. Validator: the lesson tree. Choices: As set (current); no alternative given. (WT43 Q13)

97. **The duplicate-found window can never open (nothing in the app asks for it) but is restyled: delete it, or have the import use it?**
   Look at: Nothing in the app opens it; it was forced open for its a4-otter screenshot. Choices: Delete it, or have the import use it. (WT43 Q14)

98. **'Import failed: …' is still the browser's own alert box: should it become the app's window too?**
   Look at: O.T.T.E.R.: an Import that fails. Choices: The app's window, or leave the alert. (WT43 Q15)

99. **Space and Enter cannot press a focused button in O.T.T.E.R. (Space opens Search, Enter is the pet's shortcut): how should the two keys behave?**
   Look at: O.T.T.E.R.: Tab to a button, then press Space and Enter. Choices: None given; left to the closing session. (WT43 Q18, WT41 Q12)

### R.A.B.B.I.T.: the shell, Intake, Summary and Team

100. **Does the project files table on Intake, after uploading something, feel too tight now that it fits exactly?**
   Look at: R.A.B.B.I.T. → Salt Hours → Intake after uploading a file; this is the narrowest of the table's four places (Intake, Summary, the control panel, Projects). Choices: Report; if it feels tight, 'the honest fix is to rebuild that table, which is already on the plan'. (WT34 item 3)

101. **Summary has no project bar, so the storage dot and LIVE pill sit at the right end of its tab strip: is that right?**
   Look at: R.A.B.B.I.T. → Summary: the right end of the tab strip. Choices: Keep them in the tab strip (current; at most three faces and "+N") / a thin project bar on Summary that holds only those two, with no project name. (WT37 Q1)

102. **Do you want the roles on R.A.B.B.I.T.'s Team colour-coded again (Manager was amber, Reviewer violet), now that every role is the same ink?**
   Look at: R.A.B.B.I.T. → Team: the roster's roles. Choices: Keep one ink for every role (current) / colour-code roles again, which would need a ruling on which colours. (WT37 Q3)

103. **Which session should own the data fix for Summary's Budget figure, which shows $0 on every project with tasks because it never loads the rate-card rates?**
   Look at: R.A.B.B.I.T. → Summary on a project with tasks: the Budget figure. Choices: None proposed; recorded for a later session. (WT37 Q5)

104. **Should non-managers see Summary's Budget figure and Budget snapshot tiles at all?**
   Look at: R.A.B.B.I.T. → Summary as a non-manager: the tiles show $0. Choices: Show them to everyone (current; non-managers see $0) / hide them from non-managers, which changes what the view shows. (WT37 Q6)

105. **Keep Settings at 40% of the window (576 at 1440, never under 420), as D.O.G.'s and O.T.T.E.R.'s are, rather than the app's fixed drawer width of 420?**
   Look at: R.A.B.B.I.T.: the gear at the top right → Settings, at 1440x900 and 1280x700. Choices: Keep the 40%, or the fixed 420. (WT42 Q20, WT40 Q2)

106. **Is it right that a locked Settings tab greys every control and the keyboard can no longer change a locked setting (it could before)?**
   Look at: R.A.B.B.I.T. Settings: lock a tab, then try its controls with the mouse and the keyboard. Choices: Right? (current). (WT42 Q21)

107. **Is it right that 'Manage task templates' is a quiet button (it was orange) while a holiday's 'Add' stays orange?**
   Look at: R.A.B.B.I.T. Settings: 'Manage task templates' and the holidays card's 'Add'. Choices: Right? (current). (WT42 Q24)

108. **Is it right that Help in the Settings footer is the question-mark button (it said 'Help'), as in D.O.G. and O.T.T.E.R.?**
   Look at: R.A.B.B.I.T. Settings: the footer. Choices: Right? (current). (WT42 Q25)

109. **Project type names are Title Case ('Music Video'), as everywhere else in R.A.B.B.I.T.: sentence case everywhere ('Music video')?**
   Look at: R.A.B.B.I.T. Settings → Project type defaults, and wherever project types show. Choices: Title Case (current), or sentence case everywhere. Plan Q2 would make them "Music video"; V2 kept this open for you because a project type is a name. (WT42 Q26)

### R.A.B.B.I.T.: Tasks

110. **Keep that clicking a dropdown's caption in the task popup (Status, Priority, Assignee…) puts focus on that dropdown?**
   Look at: The task popup: click the Status caption. Choices: Keep, as the standard form field does everywhere (current) / not. The captions of Title, Description and Notes still do nothing. (WT39 Q2)

111. **Is sideways scrolling of the Tasks table acceptable in the narrowest window (1024px)?**
   Look at: R.A.B.B.I.T. → Tasks at 1024px wide. Choices: Accept it (current) / not; ten columns do not fit otherwise without cutting dates in half. At 1280px the table fits. (WT39 Q3)

112. **Keep key dates in their own colours, blues and pinks included, although the app's chrome has no cool colours?**
   Look at: R.A.B.B.I.T. → Tasks: the key-date diamonds. Choices: Keep the data colours (current) / not. No alternative given. (WT39 Q4)

113. **Is colouring Priority only on High (amber) and Urgent (red), with Medium and Low plain, right?**
   Look at: R.A.B.B.I.T. → Tasks: the Priority column. Choices: Right (current; matches the Dashboard) / not. (WT39 Q5)

114. **Do the task popup's four group headings (Workflow, Placement, People, Schedule and cost) read right?**
   Look at: The task popup, from Tasks, the Dashboard or the Timeline. Choices: Keep the names / suggest others. (WT39 Q6)

115. **Is renaming New task's "Assigned to" to "Assignee", the task popup's word for the same field, fine?**
   Look at: R.A.B.B.I.T. → Tasks → New task. Choices: None given; stated for confirmation. (WT39 Q8)

116. **Keep Export as a text button rather than the icon the review suggested?**
   Look at: R.A.B.B.I.T. → Tasks: Export in the toolbar. Choices: Keep the text (current; an icon would hide its name) / an icon, as the review suggested. (WT39 Q9)

117. **Keep the edit history's 'Edited' badge grey (it was orange), with created and restored green and deleted red?**
   Look at: Tasks tab → a task's 'View edit history': the badges. Choices: Keep, or not. (WT42 Q17)

### R.A.B.B.I.T.: Timeline

118. **Is growing the minimap to keep every phase's name the right trade (124px up to five phases, up to 186px at ten, thinner rows beyond, never cut)?**
   Look at: R.A.B.B.I.T., a project with more than five phases, Timeline tab: the minimap at 1280x700. Choices: Right trade? (current). (WT42 Q1)

119. **Keep the phase names on the minimap's bars (inside when they fit, beside when not)?**
   Look at: Timeline: the minimap's bars. Choices: Keep, or not. (WT42 Q2)

120. **Are the minimap's dates right ('Oct', the year at January, the first label with its year when it fits)?**
   Look at: Timeline: the dates along the minimap's top, across the zoom levels. Choices: Right? (current). (WT42 Q3)

121. **Keep the zoom readout in words ('2.3 yr', '4.5 mo'), and keep Fit as it is though it goes below the slider's six-month end on a short project?**
   Look at: Timeline: the minimap's zoom readout, and Fit on a short project. Choices: Keep Fit as it is, or change it. (WT42 Q4)

122. **A phase's label and a sub-phase's label are two separate rules at the same weight: keep them so, or set them apart?**
   Look at: Timeline: a phase's label beside its sub-phases' labels. Choices: None given. (WT42 Q5, WT34 Q1, WT30 u1)

123. **Restyle the task editor's and the phase-extend window's own look (their delete questions are already the app's window) now, or in a later pass?**
   Look at: Timeline: click a phase's bar in the minimap to open the task editor; the phase-extend window. Choices: Now, or in a later pass. (WT42 Q6, WT42 Q23)

124. **A minimap bar cannot be dragged to move its phase (it never could): fix it, which changes what a drag does, or leave it?**
   Look at: Timeline: try to drag a phase's bar in the minimap. Choices: Fix it, or leave it. (WT42 Q8)

125. **There are two 'Today' buttons, the minimap's and the gantt's: rename one?**
   Look at: Timeline: the minimap's Today and the gantt toolbar's Today. Choices: Rename one, or leave both. (WT42 Q9)

126. **Keep '· no dates' after the name of a phase without dates in the minimap?**
   Look at: Timeline: a phase with no dates in the minimap. Choices: Keep, or not. (WT42 Q10)

127. **Is the minimap's window (a light orange tint with 2px orange sides) the right weight?**
   Look at: Timeline: the minimap's window, the span the gantt is showing. Choices: Right weight? (current). (WT42 Q11)

128. **Are the phase colours right (in progress the orange fill, delayed the amber outline, completed a quiet grey, a group row reading the same)?**
   Look at: Timeline gantt: bars in progress, delayed and completed, and a group row. Choices: Right? (current, the Tasks tab's status colours). (WT42 Q12)

129. **Are needs revisions and final, now the stronger fill of their colour beside pending review and approved (needs revisions was pink), different enough?**
   Look at: Timeline gantt: a needs-revisions bar beside a pending-review one, a final bar beside an approved one. Choices: Enough of a difference? (current). (WT42 Q13)

130. **Keep the links grey (solid between tasks, dashed between phases), where they were orange and cyan?**
   Look at: Timeline gantt: the links between bars. Choices: Keep, or not. (WT42 Q14)

131. **Keep the legend (twelve entries) on its own line between the minimap and the toolbar?**
   Look at: Timeline: the legend line under the minimap. Choices: Keep it there, or move it. (WT42 Q15)

132. **At a 1024px window the toolbar is two lines (it used to overprint itself), so the gantt is 37px shorter: right?**
   Look at: Timeline at 1024x700: the toolbar and the gantt's height. Choices: Right? (current). (WT42 Q16)

133. **The gantt's week dates print a week's date against a month's first day ('Aug 31' beside 'Sep 1' at week zoom): apply the minimap's no-overlap rule to the gantt?**
   Look at: Timeline gantt at Week zoom: the dates at a month's start. Choices: Apply the minimap's rule, or leave it (not changed). (WT42 Q18)
   Q133: option B chosen 2026-09-29 (post-overhaul ruling B2: a label prints only where it fits before the next tick, and a month's start always wins). Done by post-overhaul S1, 2026-09-30; see walkthrough 48.

134. **Is a hairline under every gantt row, like the Tasks table, the right weight?**
   Look at: Timeline gantt: the line under each row. Choices: Right weight? (current). (WT42 Q19)
   Q134: no rule under task rows in the gantt half, kept under phase rows (2026-09-29; post-overhaul ruling B6, done by S1 2026-09-30 in every grouping, the "+ New task" row included; the name column keeps every line; see walkthrough 48).

### R.A.B.B.I.T.: Files, Assets, Levels and Experiences

135. **Should cloud uploads carry the file kind that Intake gives local files?**
   Look at: The project files table (Summary, Control Panel, Projects page or Intake): the kind of a cloud-uploaded file beside a local one. Choices: Yes / no; no recommendation. (WT44 Q1, WT37 Q4)
   Q135: the cloud keeps Kind now (2026-09-29; the post-overhaul E-note, "dont have the cloud silently throw away kind and description"). Track C's 0075 put `files.document_kind` and `files.description` on the cloud, and dev carries it. The Resources drop zone, D.O.G. and the attachment migration write Kind, and since S4a (2026-09-30) the file window's Kind select sets it on any project file. R.A.B.B.I.T.'s own Add files, now on the Files tab, still leaves it empty. Whether it should guess the kind from the name, as Intake does, is asked in walkthrough 52.

136. **The task popup's files column is 400px wide, so its file table scrolls sideways: widen the column, or accept the scroll?**
   Look at: A task popup's files column (R.A.B.B.I.T. Tasks), at 1280x700. Choices: Widen the column / accept the scroll; no recommendation. (WT44 Q3)

137. **The file manager's view switch is two words, "Table" and "Gallery": keep?**
   Look at: The file manager's header in an asset popup. Choices: Keep? yes / no; no recommendation. (WT44 Q4)

138. **The batch-upload summary is the neutral notice, not amber: keep?**
   Look at: The file manager after adding several files at once. Choices: Keep? yes (neutral) / no (amber); no recommendation. (WT44 Q5)

139. **The Assets gallery card lost its 2px status stripe for a badge with the word: keep?**
   Look at: Assets, Gallery view. Choices: Keep? yes (badge) / no (the 2px stripe); no recommendation. (WT44 Q7)

140. **In the asset popup a status badge under the title replaces the coloured header line, the orange frame is gone, and the property values are borderless in-place editors: keep?**
   Look at: An asset popup. Choices: Keep? yes / no; no recommendation. (WT44 Q8)

141. **The asset popup's tasks table has fixed columns, so a long title ends in "…" with the full title on hover: keep?**
   Look at: An asset popup with a long-titled task. Choices: Keep? yes / no; no recommendation. (WT44 Q9)

142. **The relation fields are chips with a glyph and a count ("Scenes: 2 linked"): keep?**
   Look at: An asset popup's relation fields. Choices: Keep? yes / no ("2 scene(s)", as before); no recommendation. (WT44 Q10)

143. **"Link scene" and "Link shot" are one glyph each and lost their "+": keep?**
   Look at: An asset popup's relations sidebar. Choices: Keep? yes / no (the "+" back); no recommendation. (WT44 Q11)

144. **Both relation sidebars are 300px (they were 360 and 320), so names cut off sooner with the full name on hover, and status words are grey sentence case, not coloured capitals: keep?**
   Look at: The relations sidebar of an asset popup and of a scene popup. Choices: Keep? yes / no; no recommendation. (WT44 Q12)

145. **A picker over the asset popup dims the window a second time, and the pickers and the video player now cover the whole window: keep?**
   Look at: An asset popup: open Link scene, then play a video from its files. Choices: Keep? yes / no; no recommendation. (WT44 Q13)

146. **The thumbnail's remove control stays 18px in the corner, as before, because the standard kit has no smaller button: keep?**
   Look at: An asset popup's thumbnail, the remove control in its corner. Choices: Keep? yes / no; no recommendation. (WT44 Q14)

147. **Should one picker serve both directions of linking (scenes to an asset, assets to a scene), which would move where one of them appears?**
   Look at: Link a scene from an asset popup, then an asset from a scene popup. Choices: One picker / keep the two; not done, no recommendation. (WT44 Q15)

148. **The Assets toolbar has ten controls before the data: put search first and one "View" menu holding Filter, Sort, Group and Saved views, or leave it?**
   Look at: The Assets toolbar at 1280x700. Choices: Yes (search first, one "View" menu) / leave it; not done. (WT44 Q16)

149. **At the larger thumbnail sizes, should a row show two lines (the name over its details)?**
   Look at: The Assets table at its largest thumbnail size. Choices: Yes / no; not done because it would be a new view. (WT44 Q17)

150. **Clicking a related asset in a level or experience popup does nothing: open the asset beside the popup, or stop it looking clickable?**
   Look at: A level popup (a game project): click a related asset. Choices: Open the asset beside the popup / stop it looking clickable; no recommendation. (WT44 Q18)

151. **The task form opens inside the level or experience popup as its left column (it was a separate panel beside the popup): keep?**
   Look at: A level popup: Add new task, at 1280x700. Choices: Keep? yes / no; the standard dialog cannot keep a panel outside itself, so it grows wider. (WT44 Q19)

152. **The video player's title is the file name in plain 16px text (it was small orange capitals), and its "not available" message box is 560px wide (it was 482): keep?**
   Look at: Play a video from an asset's files (and one that cannot play). Choices: Keep? yes / no; no recommendation. (WT44 Q20)

153. **Levels and Experiences rows lost their coloured left edge and show status as a dot and a word, as on Assets: keep?**
   Look at: The Levels table (a game project). Choices: Keep? yes / no; no recommendation. (WT44 Q21)

154. **The status-warning dialog is a little narrower (400px, it was 448): keep?**
   Look at: An asset's "tasks not yet done" warning. Choices: Keep? yes / no; no recommendation. (WT44 Q22)

155. **Asset rows stay 36px tall because a 36px thumbnail does not fit the 32px row the plan gives media tables: keep 36?**
   Look at: The Assets table. Choices: Keep 36px / the plan's 32px; no recommendation. (WT44 Q27)

156. **In narrow places (the Control Panel, Intake, the task popup's files) the file-name column stays narrow, so the table does not scroll sideways and long names end in "…": wider names with sideways scrolling instead?**
   Look at: The files table in Intake with long file names, at 1280x700. Choices: Keep narrow with "…" (as built) / wider names with sideways scrolling. (WT44 Q28)

### R.A.B.B.I.T.: Bins

157. **Keep an active filter chip and the inspector's Select / Reject / Circled marks as a soft tint with a coloured edge, or go back to solid?**
   Look at: Bins: an active filter chip (Video, Selects…) and the inspector's marks. Choices: Keep the soft tint (current) / go back to solid, where white text on the solid colour was too faint to read. (WT38 Q1)

158. **Is it fine that orange text in a row (a tile's slate line "1A · T1 · A cam", the list's "1 shot") turns white when the row is hovered or selected?**
   Look at: Bins: hover or select a tile, then a list row. Choices: Fine (current) / not. No alternative given; orange is too faint on the highlight. (WT38 Q2)

159. **Is it fine that chips with your own words (a camera, a day, a scene name, a tag) keep the case you typed, while the other chips are in capitals (VIDEO, SELECTS)?**
   Look at: Bins' filter row: a camera or tag chip beside VIDEO or SELECTS. Choices: Fine (current) / not. No alternative given. (WT38 Q3)

160. **Is the foot of the bins list where you would look for the count ("12 files in 5 bins")?**
   Look at: Bins: the bottom of the bins list on the left. Choices: Yes (current) / elsewhere. No alternative given. (WT38 Q4)

161. **Keep the orange frame that appears around the files area once you use the keyboard there, to show the keys go to that pane?**
   Look at: Bins: use the arrow keys or Shift-click in the files area. Choices: Keep (current; before, there was no sign at all) / remove. (WT38 Q5)

162. **Offline files are now quiet grey instead of faded: are they still obviously offline?**
   Look at: Bins: a bin with offline files; the poster still says OFFLINE. Choices: Yes (current) / no. (WT38 Q6)

163. **Keep the key on the selection bar's Clear button ("Clear Esc")?**
   Look at: Bins: select several files, then the selection bar's Clear button. Choices: Keep / drop the key. No recommendation. (WT38 Q7)

164. **Which of four items still on the review's list, left undone because each changes a control or needs your eye, do you want done?**
   Look at: Bins: the tile-size slider, the toolbar and the selection bar in a narrow window, the right-click menu and the filter row. Choices: The tile-size slider (steps instead of a slide?); the media-type colours (video's orange is one of the retired oranges); the toolbar sitting on two lines and the selection bar wrapping; grouping the long right-click menu and the filter row. (WT38 Q8)

165. **The Bins list keeps showing codecs in capitals ("PRORES 422 HQ"), as the Inspector does: keep, or show them as they are stored?**
   Look at: Bins, list view, the codec column. Choices: Keep capitals / show as stored; no recommendation. (WT44 Q24)

166. **The Bins list's sorted column is no longer orange (its name is the normal text colour and its arrow grey, as on the Files page): keep?**
   Look at: Bins, list view, sorted by a column. Choices: Keep? yes / no (the orange name); no recommendation. (WT44 Q26)

### R.A.B.B.I.T.: Budget

167. **Crew/team and Talent now read Actual before Variance, the order the Topsheet, Expenses and the reports already used: keep the swap?**
   Look at: Budget → Crew/team. Choices: Keep the swap / Variance before Actual, as before; no recommendation. Plan Q22 held the Budget column order for later ("will deal with column order later"); B5b set Actual before Variance, so this asks you to confirm it. (WT45 Q1)

168. **With the app's one status set (Bidding grey, it was purple; Needs revisions amber, it was magenta; Approved and Final one green), does Bidding deserve its own colour?**
   Look at: A Budget report's status words. Choices: Its own colour / grey as now; no recommendation. (WT45 Q2)

169. **Crew and Talent's sky-blue and slate headers, every too-faint grey and the forty-seven one-off colours are gone for the app's three inks: confirm?**
   Look at: Budget → Crew/team and Talent. Choices: Confirm / no; no recommendation. (WT45 Q3)

170. **The active Budget tab lost its orange fill for the underline: confirm?**
   Look at: The Budget tab strip. Choices: Confirm / no (the orange fill); no recommendation. (WT45 Q4)

171. **Crew and Talent's thick orange zone divider is one hairline and the actual side one ground: confirm?**
   Look at: Budget → Crew/team, the Actual side. Choices: Confirm / no; no recommendation. (WT45 Q5)

172. **The five hand-made popovers are one popover, and it now closes on Escape (none did): keep?**
   Look at: Crew/team: open a period cell's popover, press Escape. Choices: Keep? yes / no; no recommendation. (WT45 Q7)

173. **Should the thirteen Budget tabs get group captions (Breakdowns, Entry, Output), or should the seven "By …" reports fold into one tab with a picker?**
   Look at: The Budget tab strip. Choices: Group captions / one "By …" tab with a picker (or leave); either is a view change, so nothing was done. (WT45 Q8)

174. **The Summary has three equal actions (edit the percentages, save a bid version, set the budget active): which one is the page's main action?**
   Look at: Budget → Summary. Choices: Edit the percentages / save a bid version / set the budget active; no recommendation. (WT45 Q9)

175. **Expenses' toolbar has eleven controls: group them, or move the rarely used "Reset M/C" into a menu?**
   Look at: Budget → Expenses toolbar at 1280x700. Choices: Group them / move "Reset M/C" into a menu (or leave); no recommendation. (WT45 Q11)

176. **The client estimate prints role codes ("production_designer") as line labels: should it print the rate card's role names?**
   Look at: Budget → Client view → Print / export. Choices: The rate card's role names / the codes as now; no recommendation. (WT45 Q12)

177. **The Client view is dark on screen now (no white surfaces) and the printed estimate is white paper in Geist: is this right?**
   Look at: Budget → Client view, then its printed PDF. Choices: Yes / no; no recommendation. (WT45 Q13, WT35 Q3)

178. **A zero margin reads "+$0" in the Summary but "$0" in Crew and Talent's margin cells, and a variance under 50¢ reads "$0" in its red or green: keep, or make them one rule?**
   Look at: Budget → Summary with a 0% margin, then Crew/team's margin cells. Choices: Keep / one rule; no recommendation. (WT45 Q14)

179. **Rows you cannot click have no hover highlight now (Summary's tables, the reports, Crew and Talent), while Expenses' rows, which open the expense, keep it: right?**
   Look at: Hover rows in a report, then in Expenses. Choices: Yes / no; no recommendation. (WT45 Q15)

180. **Crew and Talent scroll sideways inside their own frame, with the scrollbar under the last row, and their columns are wider for the 13px figures: right?**
   Look at: Budget → Crew/team with many periods, at 1280x700. Choices: Yes / no; no recommendation. (WT45 Q16)

181. **Escape on an Expenses relation picker now closes the open list first and keeps the popup (it used to close the whole expense and lose the draft): confirm?**
   Look at: An expense popup: open a relation picker, press Escape. Choices: Confirm / no; no recommendation. (WT45 Q17)

182. **Talent's rate shows "900", bold, with no currency, while Crew/team's shows "$520": make them the same?**
   Look at: Budget → Talent and Crew/team, the rate column. Choices: Yes / no; no recommendation. (WT46 Q9)

### R.A.B.B.I.T.: Scenes

183. **The create buttons read "New scene" and "New shot" (they read "Scene" and "Shot"), as "New level" and "New asset" do, which adds a word: keep?**
   Look at: The Scenes toolbar, Scenes and Shots modes. Choices: Keep? yes / no ("Scene", "Shot"); no recommendation. (WT45 Q18)

184. **Do you want the review's regrouping of the Scenes toolbar: one size control instead of two, the FPS readout in the page header, and a left group (modes, filter, sort, group) and a right group (size, saved views, search, count, the create buttons)?**
   Look at: The Scenes toolbar at 1440x900 and 1280x700, both modes. Choices: Regroup as the review proposed / keep the sixteen controls in one row (as built). (WT45 Q19)

185. **The shots table has sixteen columns, and at 1440 Description gets no room while Start and End scroll sideways: hide some behind a column chooser, or keep all sixteen?**
   Look at: Scenes → Shots table at 1440x900. Choices: A column chooser / keep all sixteen; no recommendation. (WT45 Q20)

186. **Editable cells now show their control at rest (a select's arrow, a number or date field's box), where the review proposed only an underline: keep the arrows and boxes?**
   Look at: The Scenes or Shots table without the mouse over it. Choices: Keep the arrows and boxes (as built) / an underline only at rest (the review's proposal). (WT45 Q21)

187. **The four Scenes tiles lost their small icons because the standard tile has none: want the icons back (an icon slot is a kit change)?**
   Look at: The Scenes stat tiles. Choices: Icons back (a kit change) / no icons; no recommendation. (WT45 Q22)

188. **Scene and shot names in the tables are bold white, not orange, and the gallery cards lost the coloured status bar for a badge with the word, as on Assets: keep?**
   Look at: The Scenes table and the Scenes gallery. Choices: Keep? yes / no; no recommendation. (WT45 Q23)

189. **The saved-views button on Scenes stays an icon (other pages show the word "Views") because at 1440 the shots toolbar has no room for the word: keep the icon?**
   Look at: Scenes → Shots toolbar at 1440x900. Choices: Keep the icon / the word "Views"; no recommendation. (WT45 Q24)

190. **Some things are now reachable by Tab that were mouse-only (the shot table's scene bands, the row checkboxes, the popups' name, description and notes, the scene popup's shot names): keep?**
   Look at: The Shots table and a scene popup: Tab through them. Choices: Keep? yes / no; no recommendation. (WT45 Q26)

191. **The popups' fields have section headings (Identity, Camera, Schedule), and values you cannot edit have no box: keep?**
   Look at: A scene popup and a shot popup. Choices: Keep? yes / no; no recommendation. (WT45 Q28)

192. **Four older Scenes bugs were left alone (a shot row's delete in the scene popup also opens that shot; a related asset's click in a popup opens nothing; "Files (N)" appears twice in a popup; the ungrouped scene table does not show a newly picked thumbnail until something else changes): fix them in P1?**
   Look at: A scene popup (its shots, related assets and files) and the ungrouped Scenes table after picking a thumbnail. Choices: Fix them in P1 / leave; no recommendation. (WT45 Q29)

193. **A scene's or shot's name and description in the tables are edited by clicking and Tab does not reach them: make each one a Tab stop (one per row)?**
   Look at: The Scenes table: Tab along a row. Choices: Yes / no; not done because it would change how the tables behave. (WT45 Q31)

## 3. Where the pet sits over the page

Measured by P1's final walk (every screen, 118 of them, at each window size,
on the overhaul's last code, after both review rounds; the lists did not
change from the walk before them). The pet stays exactly where you had it (C5:
fixed at the bottom right, moving with the bars), so this is a list for your
question 35 ("move it?"), not something any session changed. Where a dialog
or drawer is open the pet is drawn **behind** the panel, so those screens
are listed apart: nothing is hidden there.

**At 1280x700, over the open page (13 screens):**

| screen | what it covers |
|---|---|
| D.O.G. | the brief box's placeholder ("Example: I need a page l…") |
| the nav strip, open over D.O.G. | the "Full deck" switch's label |
| Rate card | the table's right-hand cells ("—", "Overhead") |
| Dashboard | a due date ("Sep 18, 2026") |
| R.A.B.B.I.T. Intake | the "Run intake" button's words |
| R.A.B.B.I.T. Tasks, board | the "Add a task to Needs revisions" line |
| R.A.B.B.I.T. Assets, gallery | a card's phase ("Pre-production") |
| R.A.B.B.I.T. Scenes, shots | a shot's timecode ("00:00:12:00") and its "Scene details" button |
| Budget, Topsheet | the grand total's variance ("+$13,826") |
| Budget, By role | a total ("$1,728") |
| Budget, By asset | two totals ("$4,992", "$3,744") |
| Budget, Custom | the total ("$92,172") |
| Budget, Client view | two figures ("$15,360", "$9,240") |

Behind a panel at 1280x700 (11): D.O.G.'s History and Settings, O.T.T.E.R.'s
Settings, Help and Clear, R.A.B.B.I.T.'s Settings, Edit history, File
activity and a shot's popup, the Rate card's Google Sheet dialog, and the
Dashboard's task popup.

**At 1440x900, over the open page (6 screens):**

| screen | what it covers |
|---|---|
| R.A.B.B.I.T. Intake | the "Run intake" button's words |
| R.A.B.B.I.T. Summary | two dates ("Aug 21, 2026", "Aug 11, 2026") |
| R.A.B.B.I.T. Scenes, shots | four fields (Frames and Start date for "Two-shot" and "Her side") |
| Budget, By asset | two totals ("$1,872", "$1,440") |
| Budget, Crew/team | an empty period's mark ("·") |
| Budget, Client view | two figures ("$12,942", "$142,364") |

Behind a panel at 1440x900 (10): D.O.G.'s Settings, O.T.T.E.R.'s Settings,
Help and Clear, R.A.B.B.I.T.'s Settings, Help, Edit history, File activity
and a shot's popup, and Crew/team's actuals popover.

V2 measured 13 and 5 over the open page at the same two sizes.

## Appendix A. Already ruled or already answered (do not re-answer)

Your rulings (plan §2's W1–W16 and Q1–Q22) and the walkthrough questions they settle; then the questions later work answered.

**The W rulings in force:** W1 the roster export toast stays; W2 Escape in a dialog field reverts first; W3 Home says "App settings"; W4 Home is all capitals; W5 Home's hover is white on a darker fill; W6 Home's icons are 24px; W7 the thinner sign-in bars stay; W8 the model warning stays a dark strip; W9 every native confirm becomes the app's dialog; W10 the light pages' bars are 120/80; W11 T0 ran; W12 you walk the packaged build (its checks open section 2); W13 lanes A and B went ahead; W14 walkthroughs wait for the end; W15 this document; W16 a second visual check before this one.

**Questions those rulings (or plan §2) settle:**

- **Keep the new toast that confirms a roster export and names the file, or take it out?** — W1 — the roster export confirmation toast stays. (WT21 §4(a))
- **In the day-rate dialog, keep Escape in a field undoing the edit first (a second Escape closes), or close the dialog on the first press as before?** — W2 — Escape in a dialog field reverts the edit first, closes on the second press; keep. (WT21 §4(b))
- **Should Home's button say 'App settings' too, instead of 'SYSTEM SETTINGS'?** — W3 — Home's button says 'App settings' too. (WT21 §4(c))
- **Convert the four operating-system confirm pop-ups on Settings to WILSON's own dialog?** — W9 — convert all four to the kit Dialog, and every window.confirm app-wide. (WT22 §1)
- **Drop the Settings bars from 200/150 to the planned 120/80, or keep the 'card on a desk' proportion here?** — W10 (plan Q8(b)) — light-page bars 120/80 confirmed. (WT22 §3)
- **Keep Home's six labels in sentence case (the critic's reading of 'fonts only'), or put the capitals back?** — W4 (WT23 §1) — Home is ALL CAPITALS: six buttons and the Resources column, +0.06em, 16px/600. (WT23 Decision 1)
- **Fix Home's hover, where the white label on the #ba7a46 fill measures 3.52:1: a black hover label, or a darker fill?** — W5 (WT23 §2) — the white label on a darker fill, rgba(120,70,30,0.8). (WT23 Decision 2)
- **Shrink Home's 32px icons to 24px so they stop dominating the 16px labels?** — W6 (WT23 §3) — Home's icons shrink to 24px. (WT23 Decision 3)
- **Keep the thinner sign-in bars on short windows (sized so the 529px MFA enrolment gate fits), or restore the old proportion and let the gate spill onto the bars?** — W7 (WT23 §4) — the thinner sign-in bars stay; check nothing bleeds between the boxes. (WT23 Decision 4)
- **Keep the degraded-model warning as a dark strip above the orange bar, or make it black text on a plain orange strip?** — W8 (WT23 §5) — the degraded-model warning stays a dark strip above the orange bar. (WT23 Decision 5)
- **Should Help's 140/100 bars, an outlier among resource pages at 200/150, change together with the other light pages, which changes the card-on-a-desk proportion?** — W10 (plan Q8(b)) — light-page bars 120/80; Help's 140/100 goes with them. (WT23 u1)
- **Does Files feel right with the tool bars (95/8), or does it now read as a tool rather than a resource page?** — plan Q8 — Files takes the tool geometry 95/8, resource pages 120/80. (WT24 §3)
- **Should the operator console's one-time-code field, a third copy of sign-in's two-factor field with different letter spacing and no centring correction, be brought into line?** — plan Q14 — the operator console is out of scope (the walkthrough cites this ruling itself). (WT32 u1)
- **Keep Intake's four remaining capitals (CONFIGURATION, PERSONAS, GENERATE and '3 FILES'), which are labels by the rules, or quieten them?** — plan Q2 — eyebrows are the 11px Label step and keep their capitals ("3 FILES" is a count; see the counts note in P1's hand-off, P1-49). (WT34 item 2)
- **Is the admin-only operator console still out of scope, although its two-factor code field is a slightly different copy of the sign-in one?** — plan Q14 — the operator console is out of scope. (WT35 Q5)
- **Is Intake calm enough with the page eyebrows (CONFIGURATION, PERSONAS, GENERATE) and the personas still in capitals, or should the eyebrows go to normal case too?** — plan Q2 — eyebrows are the 11px Label step, so they stay in capitals. (WT37 Q2)
- **Is "New template" (it was "New Template") fine as the default name for a new task template? Existing names are unchanged.** — plan Q2 — sentence case everywhere. (WT39 Q7)
- **Keep Escape closing Settings, the right-click menu and every dialog now that they use the standard parts (before, it did nothing on Settings and the menu)?** — plan Q17 — the kit Dialog gets Escape, the stack and the busy lock; the drawer and menu use the kit's same Escape. (WT40 Q3)
- **Are course names in the sidebar fine no longer in capitals ('DaVinci Resolve 19', not 'DAVINCI RESOLVE 19')?** — plan Q2 — sentence case everywhere but the 34px title and the 11px Label step, so names show as typed. (WT41 Q5)
- **Confirm Escape and the busy lock on every O.T.T.E.R. window, including Suggest a change's Close now waiting while a request sends.** — plan Q17 — the kit Dialog gets Escape, the stack and the busy lock. (WT43 Q3)
- **Is Restore in Recently deleted right as the darker button orange, which passes the orange rule (it was white on bright orange)?** — plan Q16 — #c2410c is the one filled primary with white text. (WT43 Q11)
- **The files table lists kinds in sentence case: keep?** — plan Q2 — sentence case everywhere but the 34px title and the 11px Label step. (WT44 Q6)
- **Expenses' and Talent's row actions show when you Tab to the row, as well as on hover: keep?** — plan Q17 — HoverActions reveal on focus. (WT45 Q6)

**Questions later work answered:**

- **Settings has no page title (the word appears only in the nav strip and the transition): accept that it waits for the shared page header?** — Settings has its title now: the shared page header reads "App settings" in the orange bar. (WT22 §2)
- **Should every WILSON dialog trap focus, so a keyboard user cannot Tab to the page behind it?** — F3 gave the kit Dialog focus management: focus starts inside, Tab stays inside, and focus returns to the opener. Every converted dialog has it. (WT29 Need 3)
- **When you walk the build, check the sign-in stages V1 could not reach, on a short window, and report whether anything bleeds from one box to the other.** — V2 walked every sign-in stage (company, credentials, forgot password, invite link, used link) at 1280x700 and 1440x900: nothing bleeds between the boxes, and each well was measured (V2 hand-off §2). (WT35 §3)
- **While Settings is open the dimmed page covers the undo and upload notices at the bottom: raise them above it?** — B5b raised the undo and upload notices to z 90, above the Settings drawer's dim. (WT42 Q27)
- **What to do about the Help pages' own prose, the only thing still under the reading minimum (§6 says 'see the questions', but none of the nineteen covers it)?** — P1 set O.T.T.E.R.'s help emphasis in the ink (it was orange at 70%, 4.23:1); the walk's contrast census on that screen went from 8 to 0. (WT43 u1)

## Appendix B. The kit requests carried (34)

Parts the shared kit does not have yet, asked for by the sessions. None blocks anything; each is one line.

- **A1-KR-1** — A tab that can close (`onClose` on Tabs).
- **A1-KR-2** — The gap under a Panel's header.
- **A1-KR-3** — A shared panel header part.
- **A1-KR-4, B3d-KR-1** — A Checkbox: D.O.G. and O.T.T.E.R. draw two stand-ins, the Timeline's project types a third.
- **A2-KR-1, B5-KR-1** — A Popover.
- **A2-KR-2** — A Drawer width that works for its three consumers (see the settings-drawer question).
- **A3-KR-3** — An active tab's bold widens it and moves the tabs after it, on every strip.
- **A4-KR-3** — An inset Banner.
- **A4-KR-4** — A disclosure row for D.O.G.'s and O.T.T.E.R.'s accordions (two hand-made copies today).
- **A4-KR-5** — A help layout inside a Dialog.
- **A4-KR-6** — A loading state on the icon button (three callers wrap a spinner by hand).
- **A4-KR-8** — A dialog's error line taking the footer's full width.
- **A4-KR-10** — The drawer head's focus ring drawn inside the button — done in P1 (P1-71).
- **B3b-KR-1** — A Range (a slider).
- **B3d-KR-2** — The kit fields and the window's Enter key agreeing.
- **B3d-KR-3** — A layer for notices (the toasts have sat at z 90 since B5b).
- **B4-KR-2** — A Dialog option to render outside its parent (a portal).
- **B4-KR-3** — Compact cell padding for dense tables (it would let the Rate card fit at 1280).
- **B4b-KR-1** — A compact icon button.
- **B4c-KR-1** — A side-panel slot in a Dialog.
- **B4c-KR-2** — A Row's "current" state.
- **B4c-KR-3** — The sort arrow's slot before a right-aligned label (the 14px gap on Expenses' figures and the Files page's Size).
- **B4c-KR-4** — Drawers and keyboard focus (a ruling first: the drawer question).
- **B4c-KR-5** — The cell select's transitions under reduced motion.
- **B5-KR-2** — An icon slot on tab items.
- **B5-KR-3** — A visible hint on the number tile.
- **B5-KR-4** — A bulk-selection bar.
- **B5b-KR-1** — An icon slot on the number tile (the Scenes tiles' lost icons).
- **B5b-KR-2** — A segmented control (Settings → Agent's choices, the icon toggles on Scenes and Assets).
- **B5b-KR-3** — A table band row that spans the scroller.
- **B5b-KR-4** — Layer (z-index) tokens.
- **B5b-KR-5** — Scroll padding under a sticky table head.
- **V2-KR-1** — One date formatter beside the money formatter, a short and a long form (see the dates question).
- **V2-KR-2** — A title for the Drawer (see the drawer-title question).
