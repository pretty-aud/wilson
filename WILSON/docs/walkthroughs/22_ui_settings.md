# Walkthrough 22 — System Settings, rebuilt on one row contract

UI overhaul bundle D1. Branch `ui/d1-settings`, merged into `feat/ui-overhaul`.
Nothing here reaches the beta: `feat/multi-user-v1` is untouched.

**To look at it yourself**

```bash
git checkout feat/ui-overhaul && git pull --ff-only
```

then `cd WILSON && npm run dev` and open `/settings`. Screenshots of all seven
tabs, at 1440x900 and 1280x700 plus a full-column image of each, are in
`docs/sessions/handoffs/img/ui-d1-settings-*.png` if you would rather just look.

---

## What you asked for, and where it landed

> *"see where there could be more uniformity … make sure alignment in rows and
> items all make sense … really focus on hicks law … i never liked when we had
> white backgrounds"*

Settings was the surface with the most of all four problems: eight type sizes
and sixteen type treatments on one screen, 77 uppercase runs, the same input
style object copy-pasted into four files, four different things all claiming to
be the primary button, and five ways of saying "nothing here".

**Every section of every tab is now the same object.** A label on the left at
the small uppercase label size, its control on the right, one row height, a
hairline between rows, a 16px sentence-case title over each group. That is the
whole change, applied about sixty times.

---

## The eight things you will notice first

1. **Sentence case.** "Storage Backend" is "Storage backend", "Change Password"
   is "Change password", the buttons say "Manage task templates" instead of
   "MANAGE TASK TEMPLATES". Uppercase survives in exactly one role: the small
   field labels. That is the single biggest change to how the page reads.

2. **The tab bar stopped shouting.** It used to signal the active tab three
   ways at once — a filled brown block, the label flipping to white, and an
   orange underline — with the white label measuring 4.05:1, under the
   readable floor. Now there is one 2px underline and the label just goes
   semi-bold. Both states are the same black, at 8.49:1.

3. **The seven tabs read as three groups.** Two thin separators split them into
   [General · Profile] [Models · Storage · Teams] [Agent · Agent Skills] —
   account, workspace, AI. **Nothing moved, nothing is hidden, nothing was
   collapsed behind a "more" control.** Every tab is still one click away, and
   that is deliberate: the review wanted several things folded behind
   disclosures and I did not do it, because it would change what is reachable
   at a glance. You get the grouping without the hiding.

4. **One column, one width.** The password form used to be 448px wide inside a
   672px column under paragraphs that ran the full width, so the right edge
   stepped three times as you scrolled. It is one measure now, and body copy is
   capped at a readable line length instead of the ~110 characters it was.

5. **You can read the messages.** Every success and error on this page was
   below the readable floor on the orange — "Saved." at 2.60:1, the errors at
   2.51:1, and the auto-approve warning ("All agent edits will be applied
   immediately without review") at 2.41:1, which made the most consequential
   sentence on the page the least readable text on it. They are all black now,
   on a tinted well with a thick left edge, which is the treatment your own
   new-pet status block already used at 7.68:1.

6. **No white anywhere.** The two pale pastel chips on the storage backends,
   the near-white hover on every department row, the near-white hover under
   "Sign out", and — the one I would not have found without measuring — the
   Models tab's dropdown, which set a border and a text colour but no
   background, so Chrome painted its own near-white grey behind it, twenty-eight
   times.

7. **The pet card.** Its name and both numbers were painted in `#f4a261` — the
   page's own background colour used as ink — which measured 2.10:1. That is
   the same defect as the white-on-orange one you caught in August. One ink
   now, the name larger, the numbers in aligned figures. The bars moved from a
   half-second animation to a tenth. **The pet itself is untouched.**

8. **The two confirmation dialogs** ("Reset pet history", "New pet") were the
   least systematic code on the page — fully inline styles, their own radius,
   their own hard-coded monospace font, and no Escape key. They are the shared
   dialog now, so Escape closes them, they stack properly, and they lock while
   something is saving.

---

## Three things I deliberately did **not** do

- **I did not split `SettingsPage.jsx` into seven files.** The review asks for
  it, and it would genuinely be easier to work on. But Tracks A and C both have
  unmerged changes to that file, and the plan's own rule for files with track
  work is to touch them mechanically so a later merge conflicts on lines rather
  than on structure. A seven-way split is the most merge-hostile change
  available. It is recorded for a session after the tracks land.

- **I did not convert the four `window.confirm` pop-ups.** One of them is the
  "reset the demo folder" confirmation, and a test pins it in place by name
  from the demo sprint. Converting only the other three would leave one screen
  with two kinds of confirmation. **This one is a decision for you** — see
  below.

- **I did not touch the "Active workspace" panel or the two-factor panel.**
  They sit on the Settings page but the files belong to the auth bundle (D2),
  so they are still in the old style. On the Profile tab you will see the
  difference: the profile block and the sign-out block are on the new contract,
  the 2FA block between them is not. That is the only place the page does not
  yet read as one system, and D2 closes it.

---

## What I need from you

1. **The confirmation pop-ups.** Four places still use the operating system's
   own grey dialog box: removing a department, disconnecting Google Drive,
   closing the demo folder, resetting the demo folder. They do not follow the
   palette and they cannot. Do you want them converted to WILSON's own dialog?
   It is a small change but it is a behaviour change, so I am asking rather
   than doing it.

2. **The page has no title.** Settings opens straight onto the tab bar; the
   word "Settings" only exists in the nav strip and in the transition. The
   shared page header that would fix this is Foundation 2's and has not been
   built yet, so this is queued rather than skipped.

3. **The bar heights.** The orange bars above Settings are still 200px and
   150px, so roughly a third of the window is chrome before the tabs start.
   The plan has them dropping to 120/80 in a later wave. Look at the two
   screenshot sizes and tell me whether the shorter bars are what you want, or
   whether the "card on a desk" proportion matters more to you here.

4. **Walk the seven tabs in the packaged build.** I can only see the page
   signed out, so every table and list is empty. What I could not check: the
   Models tab with 28 real functions in it, the Storage tab with a demo folder
   actually open, the Teams tab with your real departments, and any of it at
   125% or 150% Windows scaling.

---

## Known rough edges

- **The Profile tab's middle block** is the old style, as above.
- **"Manage task templates"** opens a window that is entirely untouched — six
  type sizes, three of them below the floor, all monospace. It belongs to the
  R.A.B.B.I.T. bundle.
- **The disabled state on a light background** is weaker than it should be: a
  disabled button and a live secondary button look nearly identical, because
  the shared kit gives them the same treatment. That is a kit fix, filed.
- **Permission-denied controls** (the ones only an admin can use) still fade to
  40% rather than using the proper disabled treatment, which puts them at
  2.20:1. That lives in shared permission code, not in Settings.
