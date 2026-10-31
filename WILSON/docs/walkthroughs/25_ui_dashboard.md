# Walkthrough 25 — The Dashboard, moved onto the dark page and onto the kit

UI overhaul bundle C2. Branch `ui/c2-dashboard`, merged into `feat/ui-overhaul`.
Nothing here reaches the beta: `feat/multi-user-v1` is untouched.

**To look at it yourself**

```bash
git checkout feat/ui-overhaul && git pull --ff-only
```

then `cd WILSON && npm run dev` and open `/dashboard`. Screenshots are in
`docs/sessions/handoffs/img/ui-c2-after-*.png` if you would rather just look.

> **One thing to know before you open it.** The tester mode we use for these
> sessions signs in with no session at all, so every cloud query comes back
> empty and all I could photograph in the real app were the *empty* states. To
> see the populated table, board, gallery and note editor I rendered the
> components' own markup against the real stylesheets and photographed that —
> those are the files with `fixture` in the name. They are the components'
> actual output, not a mock-up, but they are not a screenshot of your data.
> **When you open it signed in, that is the first thing worth checking.**

---

## What you asked for, and where it landed

> *"right now i can tell you everything seems to use fonts that dont look super
> contemporary … make sure we have uniform font sizing … really focus on hicks
> law … i never liked when we had white backgrounds"*

The Dashboard had ten type sizes on a screen holding one table, one list and
one editor. Thirty-five of its text elements were set in the browser's fallback
monospace and none in a sans — including the body of your notes, so writing in
your own notebook meant typing into a terminal. Most of its status colours were
invisible: measured against the orange page, the *default* status dot came out
at 1.42:1, which is not a colour so much as a rumour.

---

## The eight things you will notice first

1. **The page is dark now.** You ruled this back in Q1: the six data pages come
   off the orange and onto the same dark paper the three tools use, with the
   orange frame kept. The Dashboard is the second one to move (Team Members
   went first). The single biggest effect is that **status colour works at
   all** — green means approved, red means blocked, and you can see both.

2. **The note editor reads like a document.** The body is the app's sans at
   14px with normal leading, and the column is capped at a proper reading
   measure and centred, instead of running about 106 characters wide. **And it
   no longer rewrites your headings.** Typing a Heading 1 used to convert what
   you wrote to capitals. It doesn't any more — what you type is what you see.

3. **The task table is the same table as Team Members.** Same row height, same
   header, same hairlines, same alignment. It was the fifth hand-written copy
   of the same header component in the repo; that copy is gone.

4. **The dates line up.** Start and Due are right-aligned with fixed-width
   figures, so the commas and the years sit in a column. They used to be
   left-aligned, which is why "Sep 3, 2026" and "Sep 14, 2026" never agreed
   with each other.

5. **Sixty dropdown arrows left the table.** Every row's Status and Priority
   cell was drawing the browser's own arrow, permanently — at thirty tasks
   that is sixty of them competing with your data. They appear when you point
   at a row, and the dropdowns work exactly as before.

6. **The toolbar has one baseline and three groups.** Nine controls sat at four
   different heights in a ragged strip. They are all the same height now, and
   a thin rule separates *what you are looking at* (view, search) from *how it
   is arranged* (group, sort, direction, filter) from *how much of it there is*
   (the count, refresh). **Nothing was hidden and nothing moved behind a
   menu** — every control is still one click away, in the same order.

7. **The white cards are gone from Notes.** Every unselected note sat on a pale
   near-white panel. Notes are separated by hairlines now, and the selected one
   takes a quiet orange tint with a 2px orange edge — the same "this is
   selected" treatment the tables use. It also stops shifting a pixel when you
   click it.

8. **Deleting asks in a real dialog.** Both delete confirmations used the
   Windows system pop-up; per your ruling W9 they are the app's own dialog now,
   with the same words. "Notes have no trash" still says so, because it is
   true.

---

## Smaller things, in case you spot them

- The tabs say "My tasks", "Notes", "Profile" in sentence case, and the active
  one is marked by one orange underline instead of a filled block.
- The "Live" badge in the corner was orange text on an orange tint at 1.81:1 —
  the lowest-contrast thing on the page. It is the standard status badge now.
- "Assigned" and "Reviewing" were a bright orange pill and a brown one. They
  are both plain outlined labels now: colour is spent on status, and the word
  carries the role.
- The board and the gallery used to disagree about what a coloured edge meant —
  status on top of a board card, priority along the bottom of a gallery card.
  Status takes the top edge in both; priority is a word in both.
- The gallery card's big letter is gone. It was the loudest thing on the card
  and it only repeated the first character of the title underneath it.
- Priority is only coloured for **urgent** and **high**. When every step is
  coloured there is no emphasis left for the step that matters.
- The page content starts at the same left edge as the page title above it. It
  used to be 8px off, which reads as an accident rather than an indent.
- The orange bars are 120/80 now, per W10, which gives the table about 150px
  more room.

---

## Two things I could not finish, and one I need you to look at

**1. The Profile tab is borrowing a fix.** The profile editor is one component
shared by Settings and the Dashboard, and it is Settings' file, not this
session's. It has the light page's colours written into it, so on the new dark
page it would have rendered black on black. I have put a small, clearly-marked
patch around it that re-points those colours for that tab only. It works, but
the real fix is a one-line change to the shared component, which belongs to the
Settings pass. **If the Profile tab looks wrong to you in any way, that patch is
the first suspect.**

**2. The task pop-up is still R.A.B.B.I.T.'s.** Clicking a row opens the same
detail pop-up R.A.B.B.I.T. uses — dark panel, bright orange 2px frame, heavy
shadow. It belongs to the R.A.B.B.I.T. pass, so it has not been touched and it
will look like a visitor from another page until that lane runs. That is
expected, not a defect.

**3. There are no metric tiles.** My brief asked me to move "the four metric
tiles" onto the shared Stat component. The Dashboard has no metric tiles — the
four tiles that description refers to are in R.A.B.B.I.T.'s Tasks view. I did
not invent any, because adding four new things to a page is a change to what
the page shows and that is yours to ask for, not mine to assume. **If you do
want a summary band at the top of My Tasks — overdue, due this week, blocked,
total — say so and it is a small job.**

---

## One question for you

**Does "Assigned" still need to stand out more than "Reviewing"?** It used to be
a filled orange pill against a brown one, which made it the loudest thing in its
row. Filling a small label with orange is against the colour rule now (orange
under small text has no legible ink), so both are plain outlined labels and only
the word distinguishes them. If the distinction matters at a glance, the honest
options are a different shape for one of them, or grouping by role — both of
which I would rather you choose than guess.
