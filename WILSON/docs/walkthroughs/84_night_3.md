# 84 — NIGHT 3

One file for the night (`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one
section per session: **B2** (subject shares in O.T.T.E.R.), **M1** (the
desktop → cloud migration, part 1) and **S2** (an offline launch), and
**DG4** (D.O.G.'s project and references card), which Audrey added. Each
section stands on its own; answer its questions by their numbers.

## B2 — Subject shares in O.T.T.E.R.

1. **You can share one subject with a colleague.** On a course of yours,
   the **⋯** menu now has **Share a subject…** and **Share this course
   with…** beside *Share or submit…*; the study view of one of your subjects
   has **Share…** under the breadcrumb. They read it inside a course of
   their own, live and read-only, once they accept, with their own
   progress; nothing else of your course is shared.
2. **A whole course is one offer.** *Share this course with…* sends every
   subject the course holds that day; they see one card and **Accept all**
   or **Decline all**. When you later add a subject to that course,
   O.T.T.E.R. asks **Share the new subject too?** — nothing is shared unless
   you say so.
3. **Someone who accepted can pass it on**, one subject at a time
   (**Pass on…**); your list shows every link (*Ben via Mara*), and if you
   withdraw it from the first person, everyone they passed it on to loses
   it too.
4. **Requests holds all of it**: *Shared with you* (offers waiting on you,
   counted on the tab) and *Shared by you* (every link of your subjects,
   with **Withdraw**).

**What this is.** B2 of night 3 (`docs/sessions/briefs/po-b2-subject-shares-client.md`),
the screens over B1's server (migration 0100, already on dev and staging),
built to the design you ruled on (`docs/design/OTTER_SUBJECT_SHARES_DESIGN.md`
§5, §10). Nothing of it shows on your computer's own library: it needs a
signed-in workspace.

### What to click, as two people

You need two accounts in one workspace on the beta (yours and a
colleague's, in two browsers or a private window); a third for step 8.
No session holds a password for any account, so this flow is yours.

| # | Who | Do | You should see |
|---|---|---|---|
| 1 | You | Open a course of yours, **⋯ › Share a subject…**, pick a subject, pick your colleague under **With**, add a note, **Share** | The dialog's line: *They will read this one subject inside their own «…» course, live and read-only, once they accept…* Then, in the library: *Shared with <name>. It is waiting for them to accept.* |
| 2 | Them | Open O.T.T.E.R. | The **Requests** tab carries a count (1). Under **Shared with you**: the subject, *from <you> · <course> · just now*, your note, **Accept** and **Decline** |
| 3 | Them | **Accept** | O.T.T.E.R. opens their course of the same name (made for them if they had none), the new row marked by an orange edge; *«…» is now in your … course, linked live from <you>. It stays read-only; your progress is your own.* |
| 4 | Them | Open the linked subject | In the sidebar a chain glyph where a number would be, and no delete; on its card a **Linked** badge; under the breadcrumb *Linked from <you>'s … · read only · you see their edits as they make them*, with **Pass on…** and **Remove from my course**. No Generate, no editing |
| 5 | Them | **Mark complete** on a lesson | Ticked for them; your own progress on your subject is untouched |
| 6 | You | Change a lesson of that subject | They see it the next time they open it |
| 7 | You | **Requests** | **Shared by you**: the subject, *<name> · accepted*, **Withdraw**. Your subject's study view says *Shared with <name>* (it opens Requests) |
| 8 | Them | **Pass on…** to a third person | Your list adds *<third> via <them> · waiting* |
| 9 | You | **⋯ › Share this course with…** | The subtitle counts the subjects (*7 subjects, 2 of them outlines*); after Share: *Shared your course with <name>: N subjects, waiting for them to accept.* (any subject already shared with them is named). They see one card, **Accept all** / **Decline all** |
| 10 | You | Add a subject to that course | *Share the new subject too?* with them ticked; **Share** or **Not now** |
| 11 | You | **Withdraw** on a link | The confirm: *<name> will lose the link. Their own progress stays theirs.* (and, when they passed it on: *Removing it ends it for the 1 person it was passed on to…*). Their next open: *«…» is no longer shared with you.* and the row leaves their course |
| 12 | You | Move the subject to **Recently deleted** | Their row greys: *No longer available — the owner removed it*, with **Remove**; restore it and it comes back the next time their list is read (they open the library or Requests, or another course) |
| 13 | Either | Sign out on the desktop (your own library) | None of the above shows |

### Pictures

From Chromium at a real 1280×800 and 1440×900 window, on the dev fixtures'
tester (made-up people; the fixtures hold no share, by design, so the
sections themselves are pinned by tests, not photographed). In the folder
*84_night_3 pictures* beside this file:

- `po-b2-after-course-menu-1280x800`, `…-1440x900` — the two new items
  (before: `po-b2-before-course-menu-…`, three items).
- `po-b2-after-share-subject-dialog-…` and `po-b2-after-share-course-dialog-…`
  — the dialog in its two menu modes (new; no before).
- `po-b2-after-study-view-…` — **Share…** under the breadcrumb (before:
  `po-b2-before-study-view-…`, nothing there).
- `po-b2-after-course-view-…` and `po-b2-before-course-view-…` — the course
  view, unchanged when nothing is shared.

### Questions

- **Q1. Pronouns in the new sentences.** The design's examples say *her*
  (*Audrey shared her course…*, *Her own progress stays hers*, *you see her
  edits as she makes them*, *waiting for her to accept*). O.T.T.E.R. cannot
  know a colleague's pronouns, so B2 wrote *their / them* everywhere, as the
  design's own *It is waiting for them to accept.* already does. (a) Keep
  *their / them* (Recommended). (b) Use the person's name instead of a
  pronoun.
- **Q2. The subject delete confirm, in the company library.** It still says
  *This will permanently remove this subject and its lessons. This cannot be
  undone.*, while there a delete is the 30-day trash; B2's added sentence
  for a shared subject (*…while it is in the trash and ends when it is
  purged*) sits under it. Recorded in `docs/OUTSTANDING.md`, not changed.
  (a) Reword it for the company library as the course delete already is,
  in 1.1 (Recommended). (b) Before 1.0.
- **Q3. Size.** The app's main file grew by 36 KB (35,731 bytes: the share
  dialog, the reminder, the two Requests sections, the linked subject and
  the sentences the design names), over the night's 20 KB guide. (a) Accept it: it is one
  whole feature (Recommended). (b) Load the two dialogs only when first
  opened (about 7 KB less in the main file).

## DG4 — D.O.G.'s project and references card

1. **Project and References are one card**, *1 Project and references*:
   the project first, then what the deck reads in your order (the line
   *What goes to the AI…*, Uploads, Items, Files, Notes, the bar, Add
   references). The Generate outline card is *2* now.
2. **The bar is a fixed length, and a little thicker.** It is as long as
   the line above it (576px; that line measured 571px) at any window size;
   it was the card's whole width, 2,278px on a 2560 monitor. 8px thick, was
   6px. In the Add references window it still spans the footer.
3. **Generate outline has two checkboxes, side by side**: **Place visual**
   (was *Use visual assets*; no subtitle; hover it for what it does), then
   **Theme generator**, on the line under the Single page / Full deck
   switch, on both sides of it (a single page uses the theme generator too).
   **Use project assets** is gone: what card 1 lists is what is read, and
   Place visual places pictures and videos from your uploads and your
   references alike.
4. **Core files only**, beside Add references: ticked, the deck reads the
   project's files marked Core in R.A.B.B.I.T.'s Files tab instead of what
   you chose; your uploads still go. Clear it and what you chose comes back
   as it was.

**What this is.** DG4, which you added to night 3 (your five notes verbatim
in `docs/sessions/briefs/po-dg4-dog-project-references-card.md`). D.O.G.
only: no migration, nothing on the server, the same on your computer's
library and on the cloud. Single page's grey line now names only your deck
context (the theme generator is on screen there), and only when the box has
words. On your computer's library a project from before its files moved to
the Files tab counts its older attachments as Core unless they were marked
Ref, and the ticked box says so. The app's main file grew by 1,938 bytes.

### What to click

On the beta after the morning's merge, or the development copy (`session-a`,
the dev fixtures' tester, its project *Salt Hours*). The project to try is
one with files you marked Core in R.A.B.B.I.T.'s Files tab.

| # | Do | You should see |
|---|---|---|
| 1 | Open D.O.G. | One card at the top, **1 PROJECT AND REFERENCES**, *None chosen* at its right: *Choose a project*, the dropdown and New project; then *What goes to the AI…*, Uploads, the bar, **Add references** and beside it **Core files only**, grey, with *Core files come from a project: choose one above.* under it |
| 2 | On your widest window, look at the bar | It ends where *What goes to the AI…* ends, not at the card's edge |
| 3 | Choose a project with Core files | *Core files only* turns on, with no sentence. (A project with none keeps it grey: *This project has no Core files D.O.G. can read.*) |
| 4 | **Add references**, tick one file, **Done** | It is listed under Files, as before |
| 5 | Tick **Core files only** | The list becomes the project's Core files, each with its CORE mark and an eye, no ×; the count and the bar follow; Add references greys out; under it: *Your 1 chosen reference is set aside while this is ticked; it comes back when you clear it.* A Core file D.O.G. cannot read (a Photoshop file, say) is not listed |
| 6 | Clear it | The file from step 4 is back; Add references is on |
| 7 | Look at **2 GENERATE OUTLINE** | Under the switch: **Place visual** and **Theme generator**, side by side, nothing after them. Switch to Single page: the same two |
| 8 | (on the beta) Upload a picture, keep Core files only ticked on a project with a Core picture, tick **Place visual**, write a line in the deck context box, **Generate full deck outline** | Both pictures can be placed in the slides; with Place visual off neither is, and both are still read |
| 9 | Fold card 1 by its chevron | Its header keeps the count |

### Pictures

From Chromium at a real 1280×800, 1440×900 and 2560×1440 window, on the dev
fixtures' tester (a made-up project and files; no upload). In the folder
*84_night_3 pictures* beside this file:

- `po-dg4-before-01-cards-…` and `po-dg4-after-01-cards-…` — D.O.G. as it
  opens, no project: two cards then, one now.
- `po-dg4-before-02-project-…` and `po-dg4-after-02-project-…` — *Salt
  Hours* chosen; at 2560 the bar's length is your note 1.
- `po-dg4-after-03-core-files-…` — Core files only ticked: the project's six
  Core files D.O.G. can read (its Photoshop file left out), the count, the
  bar's words (new; no before).
- `po-dg4-before-03-single-page-…` and `po-dg4-after-04-single-page-…` —
  Single page: two boxes and a subtitle, no Theme generator, then; Place
  visual and Theme generator now.

### The laws of UX in the layout pass (your note 5)

- **Common region:** one card, one header, one fold: choosing the project
  and choosing what it reads are one decision.
- **Proximity:** the project's dropdown sits right above the references it
  scopes; Core files only sits beside Add references; its sentence is 8px
  under it, the card's parts 16px apart.
- **Hick's law:** D.O.G. opens with 10 Tab stops, was 12 (a card header and
  a checkbox fewer); Generate outline asks two questions, not three.
- **Fitts's law:** Core files only is 16px from Add references; a row's eye
  and × stay within 576px of its name at any width (at 2560 they were up to
  2,278px away).
- **The text measure:** card 1 is one 576px column, the length of its
  longest line; the project's description wraps to two short lines instead
  of one line about 1,070px long at 1440.
- **Vertical rhythm:** 16px between the card's parts, 8px between a control
  and its own sentence, on the house's 8px steps; the bar 8px.
- **Alignment:** the dropdown, Choose file, the bar, Add references and the
  rows share one left edge (261px from the window's at all three sizes,
  measured).

### Questions

- **Q1. The card's title.** (a) *Project and references* (Recommended: your
  two names, kept). (b) *Project and sources*. (c) Another, in your words.
- **Q2. The new checkbox's name.** (a) *Core files only* (Recommended: it
  says what the deck reads while ticked). (b) *Use Core files*. (c)
  *Reference Core files*.
- **Q3. Your notes while Core files only is ticked.** Everything you chose
  in Add references steps aside, your notes too: only the Core files and
  your uploads go. (a) As built (Recommended). (b) Keep chosen notes going
  with the Core files.
- **Q4. Generate outline on a wide window.** Card 1 is a 576px column now;
  the deck context box and the Generate button below still span the window
  (2,278px at 2560). (a) Leave it for 1.1 (Recommended). (b) Give that card
  the same column.
- **Q5. A click on a checkbox's words.** It does nothing; only the small box
  ticks it, in D.O.G. as before (`docs/OUTSTANDING.md`, DG4-01). (a) Make the
  words tick it too, in 1.1 (Recommended). (b) Before 1.0.
