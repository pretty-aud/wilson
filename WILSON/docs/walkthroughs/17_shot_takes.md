# Walkthrough 17 — Shot takes (bins, milestone 2)

For Audrey, on the desktop app in **Local Server mode**. Launch the packaged
`WILSON.exe` the local-storage session built for you on 2026-09-10 at 23:30
(it holds this branch, bins included):

```
C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\laughing-proskuriakova-bf7d67\WILSON\out\WILSON-win32-x64\WILSON.exe
```

or, from your checkout after `git pull --ff-only` on `feat/demo-2026-09-11`,
`npx vite build --mode staging && npx electron .` — **not** `npm run
electron:dev`, which builds against wilson-dev, where your password is
refused (walkthrough 18 explains). Sign in, then Menu → SYSTEM SETTINGS →
STORAGE → *Storage Backend* → **Local Server**: the bins are Local Server
only this week. About ten minutes. Each step says what to do and what you should see;
if you see something else, note the step number and what you got, and say
"17_shot_takes.md" — Track C's walkthroughs also have a 16.

**What this is.** Your words: *"a way to assign files in bins to shots in a
scene that are in an edit … a single shot can have multiple takes, the shot
item in the scenes table should be able to show which take/files are being
used in the shot … make sure multiple files from a bin can be assigned to a
single shot."* A **take** here is a bin file assigned to a shot. A shot can
have any number of takes, in an order you set, each with a **role**:
**Primary** (the take the shot is cut from — one per shot), **Part** (one
piece of a shot rebuilt from several takes) or **Alt** (a spare, kept for
review). One file may be a take in several shots. Nothing about the files
changes; a take is a link.

**Before you start**
- Walkthrough 16 done, or at least: a project with **Scenes** on, two scenes
  with a few shots each, and a bin with eight or ten files in it (a few MP4s
  and stills). If some files are logged to a scene (the Scene field in the
  Bins inspector, or the "Scene (all)" batch field when adding), the pickers
  below will put those first.
- `ffmpeg.exe` in `WILSON/resources/ffmpeg/` (from walkthrough 16). Without
  it, MP4 posters appear in the scenes table only after the Bins tab has been
  opened once in the session (that is where the app's own decoder runs).

## 1. From a shot: the Takes chip

1. Open **Scenes**, table view, **Scenes** mode. Expand a scene (the chevron)
   so its shots show. → Each shot row has a dashed **+ takes** chip right
   after its name. Switch to **Shots** mode → the same chip sits in a new
   **Takes** column after the shot name. Switch to **Gallery** → it sits
   under each shot card. All three open the same thing.
2. Click **+ takes** on a shot. → **Takes — <shot name>** opens, empty: "No
   takes assigned", a sentence explaining primary and parts, the three roles
   at the bottom, and an orange **Add takes…** button.
3. Click **Add takes…**. → **Add takes to "<shot>"** lists the bin files with
   the ones logged to this shot's scene first (a **Same scene** heading, and
   a **same scene only** chip that is on when there are any — it says how
   many more it is hiding; switch it off and **Everything else** appears
   below). Search narrows by name, slate, notes or path; the
   type chips (Video / Still / Audio …) narrow by type. Tick three files —
   two stills and an MP4 — and click **Assign 3 takes**.
4. → The picker closes; the Takes dialog lists the three in the order you
   ticked them: **1** is starred and marked **Primary**, **2** and **3** are
   **Alt**. Each row shows the poster, the name, the slate line
   ("12A · T4 · A cam"), the technical line and the bin it lives in, a
   **Why this take…** note field, a role dropdown (greyed while a shot has a
   single take: the only take is always its primary), and buttons: up, down,
   star (make primary), folder (show in Bins), ✕ (unassign). The header says
   "3 takes · 2 alts · primary: <name>".
5. Click the **star** on row 3. → Row 3 becomes Primary; the old primary
   becomes Alt (the two swap roles). The header's "primary:" changes.
6. Set row 2's dropdown to **Part**. → Its left bar turns purple and the
   header says "1 part · 1 alt". Type `sound is clean` in row 1's note and
   press Tab → it sticks (reopen the dialog later to check). Type something
   else in it and press **Escape** → the old text comes back and the dialog
   stays open (Escape in any field cancels that edit; a second Escape
   closes the dialog).
7. Click **up** on row 3. → It moves to position 2; the numbers renumber.
8. Click **Close**. → The row's chip now shows the three posters with the
   primary ringed in orange with a small star, and the count **3**. The
   shot's own thumbnail slot, which was empty, now shows the **primary
   take's poster** (hover: "From the primary take. Click to set a thumbnail
   of your own."). A thumbnail you set yourself is never replaced — pick one
   with the slot's click and it wins; remove it and the take's poster is
   back.

## 2. Length, undo, the popup

9. If the primary take is an MP4 with a duration, the dialog header shows
   **Use take length (N fr)**. Click it. → The shot's **Frames** becomes N
   (2 seconds at 24 fps = 48), the scene runtime and the totals at the top
   update, and the button disappears (it only shows while the two differ).
   Nothing writes the frame count without that click.
10. In the Takes dialog click ✕ on the primary take. → It goes; the next take
    in order becomes Primary. Press **Ctrl+Z** on the page. → It is back,
    with its star, in its old position, and the promoted take is Alt again.
    Ctrl+Y (or Ctrl+Shift+Z) redoes. Every takes edit — assign, role, note,
    reorder, unassign — is one undo step, on both the Scenes and the Bins
    tab.
11. Click the **eye** on a shot row (or a gallery card). → The shot popup has
    a **Takes (3)** section above Files with the same list and controls, and
    its thumbnail slot reads **from primary take** when it shows a take's
    poster.
12. Click the **folder** icon on a take. → The app switches to the **Bins**
    tab with that file selected in its bin, the inspector open on it.

## 3. From a bin file: Assign to shot…

13. On **Bins**, click a file, then look at the inspector. → A **Used in
    shots (1)** section lists "<scene> · #<n> <shot name>" with the role chip,
    an arrow (open the shot in Scenes) and ✕ (unassign). Files not used say
    "Not assigned to any shot yet." Tiles carry a small **clapperboard + count**
    badge at the top-left when used; the list view has a **Used in** column
    ("1 shot", "2 shots").
14. Click the arrow. → The **Scenes** tab opens with that shot's popup.
    Back on **Bins**, select three files with Ctrl-click and press **A** (or
    right-click → **Assign to shot…**, or **Assign to shot** in the selection
    bar, or the **+** in the inspector's Used-in section). → **Assign 3 files
    to a shot** shows the three posters, then the shots grouped by scene with
    the scene most of the files are logged to first ("· where these files are
    logged"), each shot with its status and how many takes it already has.
    Omitted shots are hidden and counted in the subtitle ("1 omitted shot
    hidden") — your rule: any shot not marked omitted.
15. Tick **two** shots and click **Assign to 2 shots**. → A green notice:
    "Assigned 6 takes to 2 shots. Ctrl+Z undoes it." The badges on the three
    tiles read 2 (or more). Press **Ctrl+Z** → the six go together; **Ctrl+Y**
    → back.
16. Assign one of those files to the same shot again. → The shot row in the
    dialog says "already assigned" and cannot be ticked; a batch that
    includes an already-assigned pair reports "· n already assigned" and
    skips it, never duplicating.

## 4. What happens around it

17. Delete a shot that has takes (row trash → Delete). → Its takes vanish
    from the bin files' badges and Used-in lists. **Ctrl+Z** → the shot is
    back **with its takes**. The same holds for a bin file: remove it (Del
    in Bins), its takes leave every shot; undo, and they return.
18. Mark a shot **omitted**. → It disappears from both pickers; takes it
    already had stay on it and still show in its row.
19. A take whose file is offline (drive unplugged) shows the amber **offline**
    strip on its chip and in the dialog; everything else still works.
20. Switch the storage backend to Supabase (Settings → Storage). → No Takes
    column, no chips, no Assign items: the feature is Local Server only, like
    Bins. Switch back.

**Report back** the step numbers that did not match, with what you saw.
