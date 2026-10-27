# 81 — D.O.G.'S CLOSED LIST: GENERATE RIGHT AFTER TYPING, CHOOSE FILE BY KEYBOARD, "CHOOSE A PROJECT", THE RING ON R.A.B.B.I.T.

1. **A click on Generate right after typing works.** Before, with the cursor
   still in the deck context box, a click on **Generate full deck outline**
   did nothing: the box shrank as it lost the cursor, and the button moved up
   from under the pointer before the click landed. **Generate page outline**
   under the page request box did the same. Now the click lands, and the box
   keeps the cursor and its size.
2. **Choose file is reached with Tab.** It is a real button now: Tab stops on
   it (after the uploads' × buttons, before **Add references**), **Enter** or
   **Space** opens the file window, and a screen reader hears *"Choose file,
   button"* and the kinds it takes. It looks exactly as before. At 20 uploads it
   goes, as before; if the 20th came from the keyboard, the ring moves to that
   file's ×, never off the page.
3. **Card 1's field label reads "Choose a project".** The card's title stays
   **1 Project**, and a screen reader names the dropdown *"Choose a project"*.
4. **The orange ring round a page's main area shows on R.A.B.B.I.T.**, and on
   Help, where it was cut off too. It is drawn just inside the area's edge now,
   the same 2px on all four sides of every page. On the other pages it moved
   3px in and shows at the sides as well as the top and bottom. Nothing else on
   any page moved.

**What this is.** DG3 of the post-overhaul plan
(`docs/sessions/briefs/po-dg3-label-and-ring.md`): two entries of the closed
defects list for 1.0 (`docs/sessions/PLAN_TO_1_0.md` §3) and your two answers
of 2026-10-27 (section 2). Written 2026-10-27 against
`feat/post-overhaul-edit-versioning` (`po/dg3-dog-closed-list`). No database
change, no server function.

## 1. Step by step

On the development copy with the dev fixtures' tester (no sign-in), serving
`feat/post-overhaul-edit-versioning` after the morning's merge: the launch
entry the morning note names (tonight's N1 replaces the per-session entries).
D.O.G. at `/dog`. Any small .txt will do as an upload.

| # | Do | You should see |
|---|----|----------------|
| 1 | Open D.O.G. and look at card 1 | Its title **1 Project**, then the label **CHOOSE A PROJECT** above the dropdown (before: **PROJECT**) (`po-dg3-after-03-card1`; before: `po-dg3-before-03-card1`). |
| 2 | With a screen reader on, Tab to the dropdown | *"CHOOSE A PROJECT, combo box"*. Click the words above it: the dropdown takes focus, as before. |
| 3 | Press **Tab** until the ring is on the **References** chevron (a screen reader: *"REFERENCES, button, expanded"*), then press **Tab** once more | The ring is on **Choose file** (before, Tab went straight to **Add references**) (`po-dg3-after-02-choose-tab`). A screen reader says *"Choose file, button, (PDF, MD, TXT, images)"*. |
| 4 | Press **Enter** (or **Space**) | The file window opens. Pick the .txt: it becomes a row under **Uploads (1)**, and focus is back on **Choose file**. Nothing generates, with the deck context box empty or with words in it. The mouse opens the window as before. |
| 5 | Type a few words in the deck context box and, with the cursor still in it, click **Generate full deck outline** | The click lands. The box keeps the cursor and stays tall. On the development copy no AI is signed in, so a banner at the top of the column (scroll up) says *"Error generating full deck outline. Please try again."*: that is the click landing. Before, nothing happened at all (`po-dg3-before-01-click-full-deck`: the box shrank and the button moved up). |
| 6 | Press **Alt** (Single page), choose a layout, type a page request and, with the cursor still in that box, click **Generate page outline** | The same: the click lands (*"Error generating outline. Please try again."* here). Press **Alt** again to go back. |
| 7 | Empty the deck context box, click an empty part of the page and press **Enter** (D.O.G.'s note *"Write in the deck context box first"*). Press **Tab** twice (Generate full deck outline, then the note's ×), then **Alt**, as in walkthrough 78 step 13 | The note goes, focus goes to D.O.G.'s main area, and the orange ring is now just inside the column's edge on all four sides. Before, it was 1px outside and cut off at the right and the bottom. |

**On R.A.B.B.I.T., measured, not walked.** R.A.B.B.I.T.'s notes come only
from a teammate's change, which the development copy cannot make (as in
walkthrough 79). In Chromium, with a note's × pressed from the keyboard and
the thing focus came from gone, focus goes to R.A.B.B.I.T.'s main area, and
now the ring shows round it on all four sides, on Tasks and on Budget
(`po-dg3-after-04-ring-rabbit-tasks`; before, nothing showed:
`po-dg3-before-04-ring-rabbit-tasks`). On Team members and the other plain
pages it is now inside the area's edge on all four sides
(`po-dg3-after-04-ring-team-members`; before, a line along the top and the
bottom only).

## 2. Your answers (2026-10-27, verbatim)

| Question | Your answer |
|---|---|
| Card 1 says "Project" twice | "Reword the label", then the words: "Choose a project (Recommended)". *Says what the dropdown does. A screen reader reads the dropdown as "Choose a project".* |
| The orange outline round the page's main area | "Keep it everywhere (Recommended)". *A keyboard user always sees where focus landed. A later session makes R.A.B.B.I.T. show it too, since it is clipped there today. Nothing changes for mouse users.* |
| The two defects (DG2-01 and DG2-02) | On the closed list you confirmed: "Yes, the nine as listed (Recommended)". |

No questions are open.

## 3. How it was checked

- **In Chromium, before and after**, at 1280x800 and 1440x900, the two sizes
  the same. Each click after typing: before, the button 80px up (64px under
  the page request box) and nothing generated; after, the deck and the page
  started, with no blur first. A walk with Tab through D.O.G.: 28 stops before,
  29 after (31 and 32 with two uploads), the one new stop **Choose file**.
  **Enter** and **Space** on it open the file window and make no deck. The
  dropdown's name, *"CHOOSE A PROJECT"*.
- **The ring on all thirteen views** (every page, and R.A.B.B.I.T.'s Tasks
  and Budget): with it and without it, before and after, compared pixel by
  pixel. With focus off, every page is identical before and after, except
  card 1's label and the pet's line on Settings (its sex is picked at random
  each time). With the ring, the only pixels that differ are the old ring's
  and the new one's. No page scrolled.
- **The tests**: the whole suite, and new tests for each change, each shown to
  fail when its change is taken out (twelve ways).
- No sign-in, no AI call, nothing sent to a server.

## 4. Left as it is

- **After a click on Generate, the cursor stays in the box**, so the box stays
  tall while the deck is made. That is what keeps the button from moving.
- **Single page's *Page #* and *Page Request* fields** are still named by
  their example text for a screen reader (`docs/OUTSTANDING.md`, FX15-02).
- **Choose file's hint** still says *(PDF, MD, TXT, images)* without videos,
  as before.
