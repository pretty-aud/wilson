# Walkthrough 37 — R.A.B.B.I.T.: the shell, Intake, Summary and Team (UI overhaul B1)

For Audrey, at the end of the UI pass (W14: nothing here waits on you).
About 15 minutes. Open R.A.B.B.I.T. from your own checkout of
`feat/ui-overhaul`, pick a project, and go tab by tab. Part B needs the
packaged desktop app in Local Server mode.

Before and after screenshots, at 1440x900 and 1280x700, are in
`docs/sessions/handoffs/img/b1-before-*.png` and `b1-after-*.png`.

---

## Part A — what changed, and what to check (any mode)

### 1. The tab strip

- **The active tab is an underline now, not an orange block.** The orange
  fill under small text broke your orange rule (C6), and V1's stopgap was
  black text on it. Now no text sits on orange at all.
- **The eleven tabs are grouped, not reduced.** Two thin vertical lines
  split them into three groups, in the same order as before:
  *Intake · Summary · Team* | *Tasks · Timeline · Budget* |
  *Assets · Scenes · Bins · Levels · Experiences*.
  A group whose tabs are all hidden, such as Budget for a non-manager,
  leaves no stray line.
- **In a narrow window** (the desktop app's narrowest is 1024px) the small
  tab icons drop out so every tab name still fits in one row.
- **Check:** click every tab once. Each still opens its view. Left and right
  arrow keys now move between tabs, which the kit adds; Tab works as before.

### 2. The bar under the tabs (every view except Summary)

- The project name, a status badge (a dot plus the word), then on the right
  the **LIVE badge, who else is here, and the green storage dot**, then
  Switch.
- **The dot and the LIVE pill used to float over the bottom-left corner of
  every view.** They covered Tasks' last row and Summary's "Project Files".
  Your "no shortcut bar" ruling (Q10) moved them here. The Bins footer bar is
  gone too (that was B6).
- **Check:** hover the green dot. The tooltip still names the storage mode.
  Open Switch and pick another project; it behaves as before.

### 3. Summary

- The same dot and LIVE badge sit at the right end of the tab strip here,
  because Summary has no project bar (see question 1). There they show at
  most three faces and "+N" for the rest, so the tabs keep their one row.
- The four figures (Phases, Assets, Tasks, Budget) are the kit's metric tile:
  label above, number below.
- Cards are one style: one surface, one thin line, a white title (no orange
  titles, no orange left stripes). The selected project in the Projects strip
  has the one "selected" look used everywhere: a faint orange tint and a thin
  orange edge on its left.
- **Project Files now shows SIZE for cloud files.** It showed a dash before.
  KIND still shows a dash for cloud files (see question 4).
- **Check:** open Control Panel. Every field is the same height. The toggles
  are the app's one switch.

### 4. Intake

- The step strip reads *1 Prepare · 2 Run · 3 Review* in normal case with an
  underline on the current step. It used to be three shouting chips.
- The personas are the app's standard chips. **Run intake** and **New
  project** are the app's standard orange buttons (white text on the darker
  orange, legal at any size).
- **Check:** start a new project, fill a name, press *Review and create*.
  The confirm box is the app's standard dialog: Escape now closes it and a
  click outside still closes it. While the project is being created, Escape
  and the outside click wait; *Go back* still works, as it always did.

### 5. Team (cloud)

- The roster panel keeps its shape, as you ruled (Q21). It is just recoloured.
- **Check:** the role selects still change a person's role.

---

## Part B — Local Server mode (packaged app only)

These are the screens the dev fixture cannot show.

1. **Team → the Local Server table.** Its column header now has a ground of
   its own, so rows no longer scroll through the header text. Avatars are
   28px. **Check:** scroll a long team; the header stays readable. Tab into
   the search box: the box shows the orange focus ring.
2. **Team → "Add" members.** The member picker is the standard dialog now.
   **Check:** search, tick two people, press *Add 2 members*. Escape and a
   click outside both close it.
3. **Team → Save view.** It is the standard small dialog. **Check:** type a
   name and press Enter; it saves as before.
4. **The storage dot in Local Server mode.** It sits in the project bar.
   There is no LIVE pill in this mode, and that is expected.

---

## Questions (carried in the hand-off; answer any time)

1. **Summary has no project bar, so the dot and LIVE pill sit in the tab
   strip there.** Is that right? The alternative is a thin project bar on
   Summary that holds only those two, with no project name.
2. **The personas and the page eyebrows stay in capitals** (the Label step:
   *CONFIGURATION*, *PERSONAS*, *GENERATE*). The three step names moved to
   normal case. Is Intake calm enough now, or should the eyebrows go too?
3. **Role colours on Team are gone.** Manager was amber and Reviewer violet;
   now all roles are the same ink, because the chrome carries no cool colours
   and a role is not a status. Do you want roles colour-coded back? It would
   need a ruling on which colours.
4. **KIND shows a dash for cloud files.** The column shows the intake's
   classification (script, treatment, and so on). Cloud file rows carry a
   different kind (source, reference, other), so B1 did not relabel it. Should
   cloud uploads get the intake classification?
5. **The Summary budget figure shows $0** on every project with tasks. The
   figure multiplies task days by rate-card rates that the summary never
   loads. That is a data fix, not a look fix, and it is recorded for a later
   session. Which session should own it?
6. **Summary shows the Budget figure and the Budget snapshot to everyone.**
   They are not behind the managers-only money rule. The data behind them is
   already zero for non-managers, so they see $0, but the tiles are there.
   Hiding them changes what the view shows, so it is yours to rule. Should
   non-managers see those tiles at all?
