# Walkthrough 24 — Resources: Files, Projects, Rate card

UI overhaul, lane C, session C1. Branch `ui/c1-resources`, merged into
`feat/ui-overhaul`.

This is the session that answers "files database for example looks atrocious".
Three of the four pages under RESOURCES were reworked: **Files**, **Projects**
and **Rate card**. Team members was already done (walkthrough 21); Dashboard
and Admin terminal are the next two sessions in this lane.

**Nothing about what these pages DO has changed.** Both Files views are there,
every column is there, every button is there, nothing moved behind a menu or a
"more" link, and no click does anything different. If you find something that
behaves differently, that is a bug — tell me and I will fix it, not defend it.

---

## How to look at it

```bash
git checkout feat/ui-overhaul && git pull --ff-only
```

Then run the app and go to Resources → Files, Projects, Rate card.

Screenshots of all three at both window sizes are in
`docs/sessions/handoffs/img/`, named `ui-c1-*`. **They show empty pages**, and
that is not a bug in the pages: the dev build I can run here has no sign-in, so
every cloud-backed table comes back empty. The chrome, the type, the ground and
the empty states are real; the rows are not there. **You are the only one who
can see these pages with your data in them, which is what this walkthrough is
asking you to do.**

---

## 1. The pages are dark now

This is the biggest change and the one you decided (Q1, option A). Files,
Projects and Rate card have moved off the light orange onto the same dark
surface the three tools use. The orange frame stays on every page.

The reason is not fashion. `#f4a261` is a saturated mid-tone, and on it there
is exactly **one** ink that can be read — black. Every one of these pages
needed more than one, so each invented its own workaround, and all three
workarounds are things you have complained about:

- **Files** invented a second ink, a brown `#7c4f1f`, and ran **six of its
  seven columns** in it. Measured, that is 3.40:1 on the page and 2.64:1 on the
  darker zebra rows — under the readable threshold. It is grey-on-orange
  wearing a warm hue.
- **Files** also invented a cream `#f5efe6` band for its table header. That is
  a near-white sheet laid on the orange page, and it is the only place in the
  whole app that value appears.
- **Projects** painted its status column green or red on a brown well on a
  striped row. Composited, the green measures **1.33:1** and the red
  **1.10:1** — not "hard to read", but genuinely not resolvable.
- **Files** and **Projects create** both dropped a **black input box** onto the
  orange page, which is the same problem from the other direction.

All four are gone with the ground they were working around. On the dark
surface there are three legible inks and status colour works, so none of those
inventions is needed.

**What to check:** does anything read as washed out, or as too dim? The body
text should be comfortable, the secondary columns clearly quieter but still
readable, and the greens and ambers on Rate card and Projects clearly visible.

---

## 2. Files: the name column lines up now

Look down the **Name** column in the table view, and down a column in the
Finder view.

It could not line up before. A folder drew a small triangle and a file drew a
middle dot, and those two characters are different widths in any normal
typeface — so inside a single folder listing, the file names started a couple
of pixels to the right of the folder names above them. Every row. It is the
single most visible line in the whole design review.

Both are proper icons in a slot of fixed width now, so the text after them
starts at exactly the same place on every row, at every depth, for both kinds.

**What to check:** put the pointer down the left edge of the Name column and
run your eye down it. Nothing should wobble.

---

## 3. Files: the page got much taller

Files was the only page in the app missing from the bar-height table, so for
three weeks it rendered inside **Home's** chrome — 268px of orange top and
bottom — on the densest table in the app. That was fixed in the foundation
session.

This session took it further, and this is a change worth arguing with if you
disagree: **Files now takes the same bar heights as D.O.G., O.T.T.E.R. and
R.A.B.B.I.T.** (95px top, 8px bottom), on the argument that it is a working
page rather than a reading page. Against Home's chrome that is **433px** of
field given back; against the 200/150 its sibling pages use, another 247px.

Projects and Rate card took the middle option — 120/80 — which is 150px each.

**What to check:** does Files feel right with that much less orange around it,
or does it now read as a tool rather than as a resource page? Either answer is
fine and it is a one-line change.

---

## 4. Files: the toolbar, and the two things that looked identical

The row above the table used to hold an 18px heading, two 38px fields, three
27px buttons and a 12px count, all centred against each other, with nothing
sitting on a common baseline.

Worse, one helper drew **both** the Table/Columns switch **and** the Refresh
button, so the row offered three identical pills for two completely different
kinds of decision — and a person looking for the view switch found one that
was not a view.

Everything is still there. It is arranged by job now:

- **Left:** the project picker, then the Table/Columns switch. Those are the
  two things that decide what you are looking at.
- **Right:** the filter, Refresh, and the folder/file counts.

**What to check:** can you find the view switch faster than before? And does
Refresh read as a command rather than as a third view?

---

## 5. Files: sizes and durations line up; sorting stops lying

Size and Duration were set in a monospaced face — the entire point of which is
that digits line up — and then left-aligned, which throws that away. You could
not tell 9.8 MB from 98 MB without reading both. They are right-aligned with
proper tabular figures now, along with both date columns.

Separately: sorting by any column other than Name used to keep the tree
indentation, even though the sort had just scrambled the parent/child order.
So a file three levels deep would sit indented under an unrelated root folder,
claiming a relationship that no longer existed. The indent now disappears the
moment a sort or a filter makes it untrue.

**What to check:** sort by Size. The indentation should flatten. Sort back by
Name and it should come back.

---

## 6. Files: loading and "nothing here" are different pictures

One component served "choose a project", "Loading…" and "no files", so a slow
connection and an empty project looked identical — and on this page that is
the entire question you are asking. They are three different things now, and
loading draws skeleton rows so you can see that something is coming.

---

## 7. Projects: the status column was unreadable

See §1. The control is unchanged — it is still the same dropdown, in the same
cell, doing the same thing. Only its colour changed, and the **word** now
carries the state with colour as reinforcement rather than colour carrying it
alone.

"Inactive" is now a neutral grey rather than a red, on the argument that a
project which is not currently running is not an error. Say if you would
rather it stayed red.

---

## 8. Projects detail: it has a main action now

Back, Open in R.A.B.B.I.T. and **Delete Project** were the same button, at the
same size, in the same weight — so the view technically had no primary action
at all, and Delete sat at the bottom after a divider identical to every other
divider on the page.

- **Back to projects** is a quiet ghost button with its chevron.
- **Open in R.A.B.B.I.T.** is the secondary.
- **Delete project** is inside a bounded box under a "DANGER ZONE" label, with
  a heavier gap above it than any other section.

The control, the confirmation and the two outcomes are exactly what they were.

Also on this page: the drop zone no longer **moves the page**. It used to
animate its own padding and margin when the first file arrived, shifting
everything below it by 28px at the exact moment the feature was proving it
worked.

---

## 9. Rate card: the columns finally line up

This is the one I would most like you to check with real numbers in it.

The header cells were padded 6px/4px and the body cells 1px/2px, and then
every control inside a cell added its own padding on top. The result: in an
**eleven-column financial grid**, every column label sat about 6px to the left
of its own data. The row height was not set anywhere — it came from the
minimum height of whatever was inside the cell.

One cell inset now, on headers and body alike, with every control inside
padded to nothing and filling its cell.

**What to check:** run your eye down each money column, and check each header
sits directly over its own figures.

---

## 10. Rate card: the %/$ toggle you can actually hit

In every Burden and Overhead cell there is a small toggle that switches
between "a percentage" and "a fixed amount". It was 9px tall, at 45% opacity,
in roughly a 16 by 14 pixel target, sitting **two pixels** from a different
button — on every row.

A mis-click there silently changes a rate from a percentage into a dollar
amount, on a financial record.

Both controls are still there and both still do exactly what they did. The
toggle now has a reserved 28px slot at the right edge of its cell, 8px clear
of the value, at full strength.

---

## 11. Rate card: there is a total now

A rate card with no total is a rate card you add up by hand.

It totals the Day column and the Total column, and it does it **per
currency**, with the currency and the number of rates named on the row. If
your card mixes currencies you will see one total row per currency rather than
one meaningless number added across them.

**What to check:** the arithmetic, against what you would expect.

---

## 12. Everything reads like Team members now

The three pages use the same table, the same toolbar, the same empty states,
the same buttons and the same type as Team members, which was the reference
page built in the foundation session. The sizes on these pages went from nine
to four. Capitals now appear in exactly one role — small labels and table
headers — instead of on every heading, button, tab, chip and badge.

**What to check, and this is the real question:** click between Team members,
Files, Projects and Rate card. Does it feel like one app?

---

## Things I did NOT do, that the review asked for

1. **The Files details panel still takes its 300px when nothing is selected.**
   The review wanted it to collapse to nothing until you pick a file. I left
   it: it changes what the page shows at rest, the review itself marks it
   "taste, not error", and the bar change in §3 just gave the page back 433px
   on the axis the panel was actually costing. **Your call.**

2. **No keyboard shortcut bar.** The review wanted the Bins footer promoted
   and mounted on these pages. You ruled against it ("i prefer it being
   cleaner"), so the keys keep working and the hints live in each control's
   tooltip.

3. **Rate card's department defaults are still editable in two places** — on
   every department bar and in the bulk panel. The review kept both
   deliberately; the panel is just labelled "Edit all department defaults" now
   so it reads as the bulk path rather than a competing one.

---

## What I could not check, and need you for

- **Every table on these three pages with real rows in it.** I could not sign
  in, so I have never seen them populated. The structure is pinned by tests
  (columns, alignment, the totals arithmetic, the edit-and-revert behaviour,
  and specifically that clicking a blank rate-card row does not create an
  entry), but tests are not eyes.
- **The Projects detail view and the Create project view**, both of which need
  a project to reach.
- **Windows display scaling at 125% and 150%**, which only exists on your
  machine.
- **The import preview dialog**, which needs a spreadsheet to open.

If any of those is wrong, it will be wrong in a way I could not have seen from
here.
