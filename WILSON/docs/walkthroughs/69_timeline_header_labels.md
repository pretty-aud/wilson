# 69 — THE TIMELINE'S PROJECT AND BID VER.: ONE LABEL, ONE COLUMN (R.A.B.B.I.T. → TIMELINE)

1. **PROJECT and BID VER. are the same label now.** The same size, the
   same weight and the same light grey: the small capitals every field label
   in WILSON uses. Before, PROJECT was a darker grey than BID VER. under it.
2. **No folder icon before PROJECT.** The word starts on the page's left
   margin, right above BID VER.
3. **The two labels sit in one column,** so the project's name and the bid
   version's dropdown start at the same place, one above the other.
4. **The project's name is the one that stands out:** it is the largest and
   boldest value on the two rows. The dropdown's value stays in regular
   weight, a step under it.
5. **Everything on the version bar works as before:** the dropdown, Save,
   Save as new version…, Edit this version, Current, the rates, and the
   words for each state.

**What this is.** FX7, from your words of 2026-10-12, with your screenshot
of the two rows: "bid ver and project should be same sizing and color. if
anything project should stand out more. lets remove the folder icon before
the word project". Nothing in the database changed, and nothing needs
applying anywhere. The project title bar is on every tab but Summary, so
PROJECT reads the same, with no icon, on Tasks, Assets, Scenes, Files and
the rest too.

**Before you start.** The test data (the development copy's fixtures) holds
Salt Hours with its budget active, so the version bar starts locked (Bid v2
greyed, with the sentence saying why). Step 2 goes back to bidding. The bid
version bar shows only for project managers and workspace admins; everyone
else sees the project title bar alone (step 6 shows it on its own). The test
data lives in memory: reloading the page puts it back.

The pictures are in `docs/sessions/handoffs/img/`, named
`po-fx7-before-NN-<state>-<size>.png` and `po-fx7-after-NN-<state>-<size>.png`,
each with a close-up of the two rows (`…-rows-<size>.png`), at 1440x900 and
1280x700: the same six states before and after, taken by
`scripts/fx7-shots.mjs`.

---

## 1. Step by step

| # | Do | You should see |
|---|----|----------------|
| 1 | Open Salt Hours' **Timeline** | The first row: **PROJECT** *Salt Hours* ● ACTIVE. Right under it: **BID VER.** and the dropdown, greyed on *Bid v2 (pre-production) · 09/02/2026 · Locked*, and the sentence. PROJECT and BID VER. are in the same small grey capitals, one above the other on the left margin, with no folder icon. *Salt Hours* starts right above the dropdown's left edge. (after-01; before-01 had the folder icon, PROJECT darker and further right, and the name and the dropdown at different places) |
| 2 | **Budget** tab → **Reset to bidding**, then back to **Timeline** | BID VER. reads *Current*, and *No version is open.* The labels and the column are as in step 1. (after-02) |
| 3 | In the dropdown, choose **Bid v1 (fund application)** | The bar takes its grey tint and reads *Viewing bid version: Bid v1 (fund application) · 08/12/2026 · Read-only*, with **Edit this version** and **Current**. The labels have not moved. (after-03) |
| 4 | Click **Edit this version**, then **Edit this version** in the question | *Open: Bid v1 (fund application) · Saved …*, **Save** greyed, **Save as new version…**. (after-04) |
| 5 | Drag a task bar one day later | *Unsaved changes*, and **● Unsaved** beside **Save**, which pulses. (after-05) |
| 6 | Click **Tasks** (or any tab but Summary) | The project title bar reads the same: **PROJECT** *Salt Hours*, no icon. (after-06) |
| 7 | Hover **BID VER.** | *Bid version*, as before. The dropdown's own name for a screen reader is still *Bid version*. |

## 2. How to check it

Do each step at a large window and again at 1280 by 700. Steps 1 to 7 work
on the test data in the development copy. As a member or a reviewer of a
cloud project (or with `?fixtures=member` on the test data), the Timeline
has no version bar: check that the title bar's PROJECT has no icon and reads
like every other label. On the Local Server every tab reads the same.

---

## 3. The numbers, measured

Measured in Chromium on the test data at 1440x900, 1280x700 and 1024x700,
in every state of steps 1 to 6:

| | Before | After |
|---|---|---|
| Before PROJECT | a 14px folder icon | nothing |
| PROJECT | x 46, 55.4px wide, 11px, weight 600, the third ink (#8d8986) | x 24, 56px wide, 11px, weight 600, the second ink (#b8b4b0) |
| BID VER. | x 24, 50.5px wide, 11px, weight 600, the second ink (#b8b4b0) | x 24, 56px wide, the same as PROJECT |
| The project's name | starts at x 109.4; 14px, weight 600 | starts at x 88; 14px, weight 600 |
| The dropdown | starts at x 82.5; 13px, weight 400 | starts at x 88; 13px, weight 400 |

- **Both labels wear one style,** the kit's field label, so they cannot
  drift apart: a change to one is a change to both.
- **The version bar did not move or shrink anything else.** The dropdown,
  the words and the buttons are the same widths as before at all three
  sizes (the dropdown 320px at 1440 and 1280, 140px at 1024). Nothing
  overflows, the buttons end on the right margin, the two rows are 44px and
  37px tall, and the chart starts where it did. At 1280 the widest state
  (viewing Bid v1) still leaves 151px free; the dropdown starts 5.5px
  further right than before.
- **Tests:** 357 test files / 8,593 tests (2 skipped) at the start (the
  last merge's count); 357 / 8,604 (2 skipped) after the change, all
  passing. The eleven new tests pin both labels' one style, the missing
  icon, the one column and the project's name a step above the dropdown.
  Each was proved by breaking the code on purpose and watching a test
  fail: 16 deliberately broken versions, all 16 caught.

---

## 4. Still not right, and not this session's to change

- **The version's name in the words beside the dropdown is still bold**
  (*Open: **Bid v1 (fund application)***, *Viewing bid version: **Bid v1…***),
  as it is on the Budget tab's save row. It is 13px against the project
  name's 14px, both bold. That is your question below.

---

## 5. Question, when you test

1. **The version's name beside the dropdown is still bold,** as it is on
   the Budget tab. Should it be regular weight on the Timeline too, so that
   the project's name is the only bold name in the two rows?

---

## What was checked, and what was not

Checked in the development copy with its test data at 1440x900, 1280x700
and 1024x700, in Chromium: the six states in the pictures, measured, and a
member's Timeline (no version bar) at 1280. The pictures were taken by
`scripts/fx7-shots.mjs`, which prints every measurement above.

**Not checked:** the desktop app (it draws with the same browser engine and
the same bundled typeface, so the widths should hold), a real cloud
project, staging or production.
