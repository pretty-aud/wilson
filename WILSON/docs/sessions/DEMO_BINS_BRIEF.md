# The bin system — brief for the first demo-sprint session

Audrey, 2026-09-09 (verbatim, this is the spec):

> lets start a session for the bin system first.
>
> for rabbit, if a project has scenes and shots set to true, we are going to
> create a new system for a new file type. these files will be the raw footage
> from shoots, animations, stills, anything that is used in the assembly of an
> edit.
>
> for each file in the bin, i need the name of the shot/still/etc. for what
> type of files go into this system/folders, study how avid and premiere
> treats bins. idea is i should be able to add files to the bins, review the
> footage and what is in each bin.
>
> this should be a new tab in the rabbit tool next to the scenes table tab.
>
> after the mile stone of building the tab and the system for bins, please
> create a way to assign files in bins to shots in a scene that are in an
> edit. because a single shot can have multiple takes, the shot item in the
> scenes table should be able to show which take/files are being used in the
> shot. because some editors will also build a shot from multiple takes to
> make a reworked version of a shot, please make sure multiple files from a
> bin can be assigned to a single shot.
>
> this is all this feature should have. so please make sure to go as in-depth
> as you can. for the new session, please start doing research about best
> work practices for managing avid and premiere edits and how to manage bins.
> after research ask me any follow up questions after your research and make
> sure you have everything you need, then start building.

Read this file, then `DEMO_2026-09-11_PLAN.md` §0 (what already exists), §2
(branch mechanics — they are unusual, follow them exactly), §4 (rules) and §5
(reserved numbers), then `HANDOFF_PROTOCOL.md` §2 (worktree setup) and §4
(hand-off file). You have **no memory of this repo** beyond `docs/`.

**Model:** this session runs on **Fable 5.1 at max effort** by Audrey's
instruction (the repo's Opus 5 rule does not apply to it). State your model in
your first line; if it is not Fable 5.1, stop and tell her.

---

## 1. The order of work (hers, not negotiable)

1. **Research first.** Avid Media Composer and Adobe Premiere Pro: how bins
   are organised, what goes in them, what a bin shows about each clip, how
   editors name and log footage, how takes relate to scenes and shots, how
   media is ingested and managed. Write it down (§3) — the design has to be
   traceable to it.
2. **Then ask Audrey your follow-up questions** — everything you need and
   nothing you can measure yourself (§6 is the starting list; add what the
   research raises). **Wait for her answers before designing the data model.**
3. **Milestone 1 — the Bins tab and the bin system** (§4).
4. **Milestone 2 — assigning bin files to shots** (§5), only after M1 is
   integrated and she has a walkthrough for it.
5. Nothing else. *"this is all this feature should have."* Depth over breadth:
   every screen finished, every state handled, every edge she would hit.

---

## 2. Where it plugs in (measured 2026-09-09; verify before relying on it)

- **The gate.** `src/tools/rabbit_v0.1.0/Rabbit.jsx` builds `hiddenTabs`:
  `if (!project?.scenes_enabled) hidden.add('scenes')`, likewise
  `levels_enabled` and `experiences_enabled`. **Bins is visible under exactly
  the same condition as Scenes** (`project.scenes_enabled`). A hidden tab must
  not stay open — the same effect that closes Scenes handles it.
- **The tab strip.** `src/tools/rabbit_v0.1.0/components/ViewTabs.jsx`
  exports `RABBIT_VIEWS` (a hardcoded, ordered array:
  `{ id, label, Icon }` from `lucide-react`). The new entry goes **immediately
  after `scenes`**: `{ id: 'bins', label: 'Bins', Icon: … }`. The view is
  mounted from `Rabbit.jsx` like the others.
- **The scenes table.** `src/tools/rabbit_v0.1.0/views/ScenesView.jsx`
  (3,133 lines): `ctx.shots`, `shotsByScene`, `contentMode` = `'scenes' |
  `'shots'`, per-shot `frame_count` and `thumbnail_image`, `nextShotNumberFor`,
  filters, sort, detail view. Milestone 2 lands inside this file — read it
  fully before touching it, and add rather than restructure.
- **Shots and scenes** are real tables (`supabase/migrations/0040_*.sql`):
  `public.shots` (`id`, `project_id`, `workspace_id`, `scene_id` nullable,
  `name`, `description`, `notes`, `shot_number`, `status` in nine values,
  `type`, `time_of_day`, `framing`, `camera_movement`, `frame_count`,
  `thumbnail_image`, dates, `sort_order`, audit columns) and `public.scenes`.
  Writes are gated by `can_write_project` (NOT the money gate). The local
  backend keeps the same shapes inside the project bundle.
- **Files already have plumbing.** Managed files (kinds
  `source | reference | deliverable | export | other`) live behind the
  R.A.B.B.I.T. adapters (`adapters/index.js` is the contract; `localServerAdapter.js`
  and `supabaseAdapter.js` implement all of it; `googleDriveAdapter.js` is
  partial). The desktop's Express server (`electron/main.cjs`) serves
  `managed-files` list/create/patch/delete, `…/:id/stream`, `…/:id/thumbnail`
  (ffmpeg poster via `electron/ffmpeg.cjs`: `probeDurationSec`,
  `extractFrame`; **no ffprobe is shipped**), `import-folder` (user-authorized
  folder → subfolders become assets), `ingestion-chunks` / `ingestion-runs`,
  and `video-support`. `sharp` handles stills. `FileManager.jsx` and
  `ProjectAssetsView.jsx` are the existing file UI; `storage/managedVideoThumbnail.js`
  and `intake/pipeline.js` are the existing thumbnail and intake code. **Reuse
  this plumbing for the bytes; the bin system is the layer above it.**
- **Capabilities.** Gate features on the adapter context
  (`ctx.supportsManagedFiles` is the pattern), never on `window.electronAPI`.
  New adapter methods go in a `// --- bins ---` block at the end of each
  adapter and of the contract doc. PATCH column allowlists are tested
  (`adapters/columnAllowlist.test.js`); new tables need entries there too.
- **Local backend storage.** A project is a JSON bundle under
  `userData/rabbit-data/` (`readRabbitBundle` / the write helper in
  `main.cjs`); files resolve under the configured root
  (`rabbit-data/files-config.json` → `defaultRootDir`). New local routes go in
  a NEW file `electron/rabbitBins.cjs` mounted from `main.cjs` with one line;
  export the helpers you need from `main.cjs` rather than copying them.
- **Cloud backend.** If the cloud side is built (ask her, §6): migration
  **0079** and pgTAP suite **75** are reserved for bins; every new table goes
  into `RLS_TABLES` in root `.github/workflows/rls.yml` in the same commit as
  its suite; RLS mirrors scenes/shots (read by project membership, write by
  `can_write_project`). `supabase link --project-ref eqjzmnvkrakroyqxfsvw
  --password ""` from `WILSON/` links wilson-dev; never touch staging or prod
  from this session.

---

## 3. Research deliverable: `docs/BINS_DESIGN.md`

Web research is allowed and expected. Write a design note, in this order,
before asking Audrey anything:

1. **How Avid organises bins:** bin as a container of master clips, subclips,
   sequences and group clips; bins inside folders; Frame / Text / Script /
   Brief views; the standard columns (Name, Duration, Start / End, Mark IN /
   OUT, Tracks, Tape / Source, Scene, Take, Camroll, Soundroll, Comments,
   Color, Video format, Creation date) and custom columns; sifting and
   sorting; locators / markers; script integration (takes linked to script
   lines); how "circled" or "good" takes and selects are handled.
2. **How Premiere organises bins:** nested bins in the Project panel; List vs
   Icon view and hover scrub; the metadata columns (Scene, Shot, Take, Good,
   Log Note, Tape Name, Description, Client…); labels and colours; search /
   smart bins; ingest presets (copy, transcode, proxies); Media Browser.
3. **Working practice shared by both:** bins per shoot day, per scene, per
   media type (footage, audio, music, SFX, VO, graphics, VFX, stills, docs),
   "selects" and "stringout" bins; naming conventions (`Scene_Shot_Take`,
   camera letters, roll / card / day); metadata entered at ingest; never
   renaming source media on disk; checksum-verified offloads; proxies vs
   originals; master clip vs subclip; script-supervisor notes and circled
   takes; how one shot in the cut is built from several takes.
4. **What this means for R.A.B.B.I.T.:** which of the above the bin system
   adopts, which it simplifies, and why — mapped onto scenes and shots as
   they already exist here. Name the media types the system accepts and what
   each shows on a card. Propose the data model (§4.3) with every field
   justified by a line above.

Keep it tight and cite what you read (URLs). This file is the argument for
every design decision; she will read it.

---

## 4. Milestone 1 — the Bins tab and the bin system

### 4.1 What a bin is here

A **bin** belongs to a project and holds **bin files**: raw footage from
shoots, animations, stills, audio, graphics, VFX renders, "anything that is
used in the assembly of an edit." Bins are for review and organisation before
the edit; they are not the deliverables file manager (`Assets` keeps that job).
Whether bins nest, and whether they are seeded per scene / shoot day / media
type, comes from the research and her answers.

### 4.2 What the tab must do

- **Bins list** for the project (create, rename, describe, reorder, delete
  with a real confirmation that says what is inside; empty state that
  teaches). Counts and total duration per bin.
- **Add files to a bin:** OS file dialog (multi-select), OS folder dialog
  (ingest a folder into a bin, with progress and a per-file result), and
  drag-and-drop onto the bin. Duplicates are detected (same path, or same
  size + name) and reported, not silently added.
- **Every bin file has a display name — "the name of the shot/still/etc." —
  separate from the filename**, plus the fields the research justifies:
  media type, scene / shot / take, camera, roll or card or day, duration,
  resolution, fps, codec, file size, timecode if cheaply available, notes,
  a review flag (select / reject / unflagged, and whatever else she asks for),
  status, added-by and added-at. Inline editing, bulk editing of a selection,
  and a keyboard path through a bin (arrows, S select, R reject, space
  preview) so reviewing forty clips is not forty mouse trips.
- **Review the footage:** list and frame (thumbnail grid) views; sort and
  filter by every field that matters; search; a preview panel — `<video>`
  through the stream route for browser-playable formats, the poster frame
  with an honest "preview not available for this format" for the rest, image
  preview for stills, an audio player for sound. Never a spinner that never
  ends: `fetch` resolves for every status here, so an empty grid is a bug
  until proven otherwise.
- **Move and copy** files between bins; multi-select everywhere; undo for
  destructive actions where feasible or a confirm that names the count.
- Works on the desktop in Local Server mode, signed out, offline. Cloud
  parity per her answer.

### 4.3 Data model (to be validated by the research and her answers)

Proposed, so you have something to argue against:

- `bins`: `id`, `project_id`, `workspace_id`, `name`, `description`,
  `parent_bin_id` (nullable, if nesting is wanted), `kind` (free-form or
  enum: footage / audio / stills / graphics / vfx / selects / other),
  `sort_order`, audit columns.
- `bin_files` (the "new file type"): `id`, `project_id`, `bin_id`,
  `managed_file_id` (the bytes; the existing managed-file row carries path,
  size, mime, thumbnail), `display_name`, `media_type`, `scene_id` (nullable),
  `shot_id` (nullable — the take's *intended* shot, distinct from M2's
  assignment), `take_number`, `camera`, `roll`, `shoot_day`, `duration_sec`,
  `width`, `height`, `fps`, `codec`, `timecode_start`, `review_flag`,
  `rating`, `notes`, `status`, `sort_order`, audit columns.
- `shot_takes` (Milestone 2): `id`, `project_id`, `shot_id`, `bin_file_id`,
  `role` (`primary` | `part` | `alt`), `position`, `notes`, audit columns;
  unique on (`shot_id`, `bin_file_id`).

Local backend: `bundle.bins`, `bundle.binFiles`, `bundle.shotTakes`. Cloud:
migration 0079, suite 75, RLS as scenes/shots, PATCH allowlists.

### 4.4 Done means

- Vitest green (state your count; the base is 1706 / 71 files) with tests for
  the reducers / selectors / allowlists you add and a probe of every new local
  route (happy path, refusal, missing file).
- One adversarial review round minimum, a second if time (the reviewer
  attacks the corrections). Review subagents pass `model: "opus"` or better.
- Integrated onto `feat/demo-2026-09-11` (plan §2 step 3), CI green on the
  pushed head (read the run by full SHA from the public GitHub API).
- A walkthrough for Audrey, `docs/walkthroughs/16_bins.md` (the next free
  number; 01–08 are Track A's, 10–12 Track B's, 13–15 Track C's), written for
  a person clicking, with the expected result beside each step — **and sent
  to her directly with `SendUserFile`**, because walkthroughs left only in a
  branch have gone unread here for a week.
- `docs/SYSTEMS_HANDBOOK.md` gains a Bins section (append; do not reflow
  other sections) and `docs/OUTSTANDING.md` gains only what is broken and
  unfixed.

---

## 5. Milestone 2 — assigning bin files to shots

Her words: *"a way to assign files in bins to shots in a scene that are in an
edit … a single shot can have multiple takes, the shot item in the scenes
table should be able to show which take/files are being used in the shot …
some editors will also build a shot from multiple takes to make a reworked
version of a shot, please make sure multiple files from a bin can be assigned
to a single shot."*

- **Many-to-many, from both sides.** From a bin file: "Assign to shot…" (pick
  scene → shot, with search; assign several files at once). From a shot in
  the scenes table: a **Takes** affordance that opens the project's bins
  filtered sensibly (same scene first), multi-select, assign. Unassign from
  either side.
- **The scenes table shows it.** In both content modes (`scenes` and
  `shots`), a shot row shows its assigned takes: thumbnail chips (or names
  when there is no thumbnail), a count, and which is primary. The shot detail
  view lists the takes in order with role and notes, and lets her reorder
  them and set the primary. A bin file shows where it is used.
- **Ask her what "shots in a scene that are in an edit" means** before you
  build the filter (all shots with a status other than `omitted`? shots that
  belong to an assembly, which does not exist yet? every shot?). Ask whether
  one take may be assigned to more than one shot, whether assigning should
  set the shot's `thumbnail_image` or `frame_count` from the take, and what a
  "reworked" shot should display.
- Data: `shot_takes` as in §4.3; local routes in `rabbitBins.cjs`; cloud
  table in the same migration 0079 if the cloud side is in scope, else a
  follow-on migration is **not** yours to number — ask the controller.
- Done means the same list as §4.4, plus walkthrough `16_bins.md` extended
  (or `17_shot_takes.md` if the file grows past what one sitting can run).

---

## 6. Questions for Audrey after the research (starting list)

Ask them in one message, numbered, with your recommended answer beside each
so she can say "yes" or correct you. Do not start the data model until she
has answered.

1. **Both backends, or the desktop's local backend first?** The Friday demo
   runs in Local Server mode; the cloud side is migration 0079 + suite 75 and
   roughly doubles the storage work. Recommend: local first, cloud second if
   time remains before Friday.
2. **Is Friday afternoon still the deadline for both milestones**, or is M1
   the demo and M2 may land after?
3. **Where do bin files' bytes live?** Recommend: the project's existing
   files storage (managed files), so thumbnails, streaming, quotas and
   backups keep working; the bin system is the layer above.
4. **Copy files into the project storage on add, or reference them where
   they are** (with relink when a drive is unplugged)? Recommend: ask which
   she does today on shoots.
5. **Media types accepted**: video, stills, image sequences, audio, graphics
   (PSD/AI/PNG), VFX renders, documents (script sides, camera reports)?
6. **Bin structure**: nested bins? Auto-created bins per scene or shoot day
   at ingest, or always by hand?
7. **Naming and logging**: which fields she actually fills in (scene / shot /
   take / camera / roll / day), and whether to parse them from filenames
   (`12A_3_T4_A.mov` → scene 12A, shot 3, take 4, camera A) as Avid and
   Premiere do.
8. **Review vocabulary**: select / reject / unflagged only, or also
   star ratings, "circled" takes, colours / labels?
9. **"Shots in a scene that are in an edit"** — see §5. And: can one take be
   used by more than one shot? Should the shot's thumbnail come from the
   primary take?
10. **Proxies / transcodes**: needed for review of camera-original formats
    the browser cannot play, or is a poster frame enough for Friday?
11. **Sample footage** for the demo: format, count, size — so the preview
    path is built for what she will actually show.
12. Anything the research raised that changes the shape of the feature.

---

## 7. Process, branch and hand-offs

- **Setup** (worktree is cut from `main`; nothing below exists until this):
  ```
  git fetch origin
  git checkout -b demo/bins origin/feat/demo-2026-09-11
  npm install --ignore-scripts && git checkout -- package-lock.json
  ```
  Copy `.env.local` from `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.env.local`
  into this worktree's `WILSON/` (never commit it). No `supabase link` unless
  the cloud side is in scope.
- **Integrate** per plan §2 step 3: merge `origin/feat/demo-2026-09-11` into
  your branch, vitest, `git push origin HEAD:feat/demo-2026-09-11`. Never check
  out `feat/demo-2026-09-11` (Audrey's checkout holds it). Push `demo/bins`
  early and often; CI runs on `demo/**`.
- **Hand off** (protocol §1 triggers: one compaction, ~300 KB of reads, before
  a review round): `docs/sessions/handoffs/demo-bins-<YYYY-MM-DD>.md` in
  protocol §4 order, integrated, then a `spawn_task` chip titled
  `Continue demo: bins (<what is left>)` whose prompt repeats §7's setup, names
  this brief and the hand-off, and says **Fable 5.1 at max effort**.
- **Do not** touch a `track-*` branch, `feat/multi-user-v1`, staging or prod;
  do not deploy; do not spawn track chips (the fix tracks are paused); do not
  edit `src/tools/otter_v0.3.1/**`.
- **Traps that cost sessions here:** `fetch` resolves for every status;
  features have shipped with no caller (enumerate exports, grep callers);
  never `open(path, "w")` on a file you cannot regenerate; never a backslash
  in generated code (`chr(92)`); heredocs over ~100 lines fail (Write tool);
  `%APPDATA%` is virtualized for Claude — you cannot read Audrey's running
  app's data, point a dev instance at a scratch folder instead; a `<!--` in a
  long markdown file has deleted 227 lines here.
