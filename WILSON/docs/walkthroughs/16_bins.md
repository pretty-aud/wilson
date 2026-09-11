# Walkthrough 16 — Bins (milestone 1)

For Audrey, on the desktop app in Local Server mode, from your checkout:
`git pull --ff-only` on `feat/demo-2026-09-11`, then `npm run electron:dev`
(or your usual launch). Ten minutes. Each step says what to do and what you
should see; if you see something else, note the step number and what you got.

**Before you start**
- Put `ffmpeg.exe` in `WILSON/resources/ffmpeg/` (copy it from
  `C:\Users\Audrey\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe`). Without
  it, MP4 and WebM still get posters and durations through the app's own
  decoder, but MOV / ProRes / MXF / R3D and frame sequences show an icon and
  "no decoder" in the inspector.
- Have a folder of footage somewhere on your machine: a few MP4 clips, a
  still or two, a WAV, and if you have one a folder of numbered frames
  (`plate.0001.png …`). Subfolders are welcome; they become nested bins.
- Open a project that has **Scenes** switched on (the Bins tab rides on the
  same toggle: Control Panel → Scenes). A project without scenes has no Bins
  tab, and that is intended.

## 1. The tab

1. Open the project and look at the tab strip. → A **Bins** tab sits right
   after **Scenes**. Click it.
2. You should see three panes: the bin tree on the left ("All files"), an
   empty page in the middle saying **No bins yet** with the starter buttons
   (four; five when the project already has scenes), and the inspector on
   the right. The footer lists the keyboard keys.
3. Click **One bin per media type**. → Six bins appear in the tree
   (Footage, Audio, Stills, Graphics, VFX, Selects), each with a colour dot,
   and a green notice "Created 6 bins." Press **Ctrl+Z** on the page. → All
   six disappear. Press **Ctrl+Shift+Z** (or Ctrl+Y). → They come back.

## 2. Adding files

4. Click **Footage** in the tree, then **Add ▾ → Folder…** and pick your
   footage folder. → The **Add to "Footage"** dialog lists every file it
   found: one row per file, a folder of numbered frames as ONE row (a
   frame-sequence icon and the frame count beside its name), subfolders in
   the FOLDER column, the type guessed in a dropdown per row (Video / Still /
   Audio / Document …), the size, and in "From the name" the slate / take / camera it read
   from names like `12A_3_T4_A` or `A001C003_240612` with a tick you can
   untick. The subtitle counts what will be added and how much is referenced
   in place.
5. Set a **Shoot day** at the top (it applies to the batch), leave "Folders
   become nested bins" on, click **Add N items**. → The dialog closes, a
   green notice says how many were added and how many nested bins were
   created, the tree shows your folder as a nested bin under Footage with its
   own subfolders inside, and the grid fills with tiles. Posters and the
   technical line (duration · 640×360 · 24 fps · H264) appear within a few
   seconds; the header shows "reading N" while that runs.
6. Drag two clips from Explorer onto the **Audio** bin in the tree. → The
   same dialog opens for Audio. Drop the same clips again on Footage. → Each
   row is flagged "already in "Audio"" and starts unticked; tick one and add
   it anyway → it lands as a second reference to the same file (an instance).
7. Nothing on disk changed: open the source folder in Explorer. → Same
   files, same names.

## 3. Reviewing

8. Click a video tile. → The inspector shows a playable preview (poster,
   play button). Press **Space** → it plays; Space again pauses. Move the
   mouse slowly across another MP4 tile in the grid → the tile scrubs through
   the clip, with an orange progress line.
9. With a tile selected press **S**, then **3**, then **C**. → A green tick,
   a yellow bar across the top of the tile, and an orange circle appear on
   it; the inspector's Marks show Select and Circled lit and yellow chosen;
   the header says "1 select · 1 circled". Press **R** → the tick becomes a
   red ⊘. Press **U** → unflagged. Press **0** → colour cleared.
10. Click the first tile, shift-click the fourth. → Four tiles highlighted,
    the selection bar at the bottom says "4 selected" with Select / Reject /
    Unflag / Circle / colours / Move to / Copy to / Remove; the inspector
    says "4 files selected" and fields that differ say **mixed**. Type `A` in
    Camera and tab out → all four get camera A.
11. Click the **list** icon (next to the grid icon). → A table with Name,
    Type, Marks, Slate, Take, Cam, Roll, Day, Scene, Duration, Size px, fps,
    Codec, Bytes. Click the **Slate** heading → sorted 12, 12A, 24A, 100 (a
    natural order, not text order). Click **Marks** on a row → the flag
    cycles select → reject → unflagged.
12. In the inspector, set **Slate** `24A`, **Take** `3`, **Modifier** PU,
    **Scene** one of the project's scenes. → The tile's second line reads
    "24A · T3 PU · A cam". Open the Filters (funnel icon) → chips for each
    type, selects / rejects / circled / offline, colours, cameras, days,
    scenes and tags, each with a count; click a chip → the grid narrows;
    "clear 1" resets. Type in the search box → matches name, file name,
    slate, notes, path.
13. Double-click a tile's name (or press **F2**). → Rename in place. Right-
    click a tile. → A menu with the marks, colours, Move to / Copy to every
    other bin, Open in default app, Reveal in Explorer, Read columns again,
    Rename, Remove. Click **Open in default app** → the clip opens in your
    player. **Reveal in Explorer** → Explorer selects the file.

## 4. Bins

14. Right-click a bin in the tree. → Add files / Add a folder / New bin
    inside / Rename / Kind / Colour / Move up / Move down / Move to top level
    / Move inside … / Delete bin…. Drag one bin onto another. → It nests
    inside it (the chevron expands). Drag it onto **All files** → it returns
    to the top level.
15. Select a tile, press **Delete**. → It leaves the bin, the toast at the
    bottom says "Removed … from the bin" with **Undo**; click Undo → it is
    back. Press Delete on six selected → a confirm names the count first.
16. Right-click your imported folder's bin → **Delete bin…** → The dialog
    lists the files inside (with their bin paths) and offers **Move the
    files to another bin** (choose one) or **Remove the files from the
    project**; the red button says exactly what it will do. Choose move →
    the files appear in the target, the bin is gone, the toast offers Undo →
    click it → bin and files return where they were.

## 5. Offline and relink

17. In Explorer, rename the footage folder (add `_moved`). Back in WILSON
    click **Summary**, then **Bins** again. → A green notice: "Relinked N
    files from the folders this project knows." (the app remembers every
    folder you added from and looked there). If instead a header count says
    "N offline" in amber (the count is this bin's), click it → the **Relink
    offline files** dialog lists every offline file in the project, and the
    folders it knows with a **Scan** and a **Forget** for each; click
    **Choose the folder they moved to…**, pick the renamed
    folder → each file shows its match in green ("→ new path"); a file with
    two same-named candidates shows a chooser; click **Relink N** → "N files
    relinked." and the tiles come back online.
18. Rename the folder back. Nothing else needs doing.

## 6. States worth a look

19. Switch the storage backend to Supabase (Settings → Storage) and open
    Bins. → "Bins live on the desktop" with the sentence explaining why.
    Switch back to Local Server.
20. Unplug a drive that holds referenced files (or rename its folder) and
    look at a tile → an amber **offline** strip on the poster; the inspector
    preview says "Offline — the file is not at its recorded path. Plug the
    drive in, or use Relink."; Open and Reveal are disabled.
21. Remove `ffmpeg.exe` from `resources/ffmpeg/` and restart: MP4s still get
    posters and durations; a MOV shows an icon, "Preview is not available for
    this format in the app and there is no decoder to make a poster", and
    the header shows "· no decoder". Put it back.

**Report back** the step numbers that did not match, with what you saw.
