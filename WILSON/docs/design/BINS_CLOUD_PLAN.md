# WILSON — Bins on the cloud: the plan (2026-10-06)

Branch `feat/post-overhaul-edit-versioning` (the working branch; the beta carries it as of `cb7cf9d8`). Three sessions, then a fourth that is a product of its own. Written by the controller from Audrey's answers of 2026-10-05/06 (`docs/design/BINS_CLOUD_QUESTIONS.md`, her words verbatim there). The post-overhaul mechanics apply unchanged (`docs/design/POST_OVERHAUL_PLAN.md` §4: Opus 5.5, `po/<name>` branches, two review rounds, the controller spawns every chip, migrations rehearsed rolled back and applied to dev by the session when the app allows, else the Desktop kit).

**Every session runs on Claude Opus 5.5.** Line one of every session states its model and stops if the picker shows anything else.

## 0. What she asked for, and what she ruled

Her requirement, in her words (2026-10-06): *"if i have them in a local server. i need to be able to view them and access them in the local app and if possible in the webapp. at the very least i need to view them for the local server WITHOUT having to download them to the local pc drive … for editing and animation, i am accessing the files where they are, im not downloading them and making a local copy."* The footage lives on the server on a locally accessed network; browser viewing is for remote people and people who prefer the web app; the company admin decides whether files may be viewed remotely; "view" means play and scrub.

| # | ruling |
|---|---|
| B1 | The footage stays where it is — on the company's server. Only the lists and the logging go to the cloud. Nothing uploads, nothing costs storage. |
| B2 | A footage location is saved by its **network address** (`\\server\footage`) with a name; never a drive letter. A computer is asked where a location is only when it can see it as a drive letter alone. |
| B3 | A clip a computer cannot reach still shows, with its details, marked "not on this computer"; it can be logged, flagged and assigned to a shot; it cannot be played there. |
| B4 | *"if the user allows external access pictures are fine. never take images when external access is denied."* → a clip's small picture goes to the cloud ONLY in a workspace whose admin has turned remote viewing on (B5a); while it is off, not even a poster leaves the server — enforced in the database, not only the client. A teammate on the office network still gets pictures, made on their own computer from the file it can reach. |
| B5 | Play and scrub in a browser come from a **WILSON file gateway** installed on the company's server (the storage design's Option D, §4b/§4c), built after the three sessions below. Until it exists the browser shows the catalogue only. Preview copies in the cloud are not built unless a company that cannot install anything on its server asks. |
| B5a | The admin's switch, per company, off by default: "Allow files to be viewed from outside the office network." It is the TPN compliance boundary and says so at the control. |
| B6 | **Reviewers may do everything members may** in bins (add and remove clips and bins, log, flag, assign takes). The gate is the shot-list gate (`can_edit_shot_lists()`, 0084), which already admits reviewers. |
| B7 | Live: a flag or a take assignment appears for everyone without reloading. |
| B8 | A clip already in the project (same location, same file): "already in this project", Skip or Add anyway. |
| B9 | A desktop project moving to the cloud brings its bins, logging, flags and takes; its footage locations are named once; pictures upload only if B4 allows. |
| B10 | Removing a clip never touches the file on the server; removing a bin that still has clips asks move-or-remove; Undo for the person who did it. |
| B11 | A clip only one person has shows who added it and the name of its location. |
| B12 | The desktop with nobody signed in stays exactly as it is. |
| B13 | Three sessions in order, after S4c (the Files tab); then the gateway. |

Standing rules that bind: A9 (the same on the cloud, the Local Server and a NAS); the private-projects arm (0072) applies to every new table; the money gate does not (footage is not money); [[never delete her artefacts]]; `supportsBins` today means Local Server + desktop — it becomes "this backend can hold bins", true on the cloud after BC1.

## 1. The model

- **Catalogue in the cloud:** `bins`, `bin_files`, `shot_takes` as `docs/BINS_DESIGN.md` §4.4 lays them out, plus **`bin_locations`** (per WORKSPACE: `id, workspace_id, name, unc_path, added_by, created_at`) — a NAS share is the company's, not one project's. A cloud `bin_files` row holds `location_id` + `relative_path` instead of the desktop's absolute `source_path`; the desktop's signed-out bundle keeps `source_path` and `binRoots` untouched (B12).
- **Resolving a file on a computer:** `unc_path + relative_path`, which is the same string on every computer on the network; a per-computer override (`\\server\footage` seen as `Z:\`) lives in that computer's local settings, never in the cloud (B2's fallback).
- **Pictures:** the existing `rabbit-thumbnails` bucket (0053: `projects/{project_id}/{entity}/{entity_id}/{ts}-{name}`), entity `bin_files`, project-membership policies as the other entities — **plus a RESTRICTIVE policy that refuses the insert while the workspace's switch is off** (B4). The poster is made on the computer that added the clip (ffmpeg or the renderer's decode, as today) and uploaded only if allowed; a teammate's computer that can reach the file makes its own poster locally either way.
- **The switch:** `workspaces.remote_viewing_enabled BOOLEAN NOT NULL DEFAULT false`, writable by workspace admins only; read by the poster policy now and by the gateway later. Its control sits in the company's settings with the sentence the storage design §4b prescribes.
- **Live updates:** the three tables broadcast the way `milestones` do (0077's mechanism), merged by `realtimeMerge.js`.
- **The browser:** the Bins tab shows every bin and clip (pictures where they exist), lets people log, flag, assign and remove, and says plainly that adding files and playing them needs the desktop app (until the gateway).
- **The gateway (BC4):** a service the company installs on its server; it verifies the WILSON sign-in (Supabase JWT), reads the clip from the share, serves ranged reads to the browser, logs every read; inside the network by default, from outside only while the switch is on. Its own design-first bundle; not briefed here.

## 2. Sessions

| bundle | branch | port | walkthrough | starts when |
|---|---|---|---|---|
| **BC1** the database and the plumbing: migration 0091 + suites 93 (bins, bin_files, bin_locations, shot_takes, the switch, the poster policy), the allowlists and `RLS_TABLES`, the cloud adapter's bins methods (the same contract the Local Server adapter has), the provider on both backends, `supportsBins` on the cloud, the dev fixtures with bins, realtime | `po/bc1-bins-schema` | 5284 | — (its hand-off is the deliverable; the API for BC2/BC3) | S4c integrated |
| **BC2** the desktop app signed in: adding clips from a named location (the location picked once, saved by network address), the per-computer fallback, posters made locally and uploaded only when allowed, play and scrub in place, offline and relink against a location, duplicates (B8), who added it and from where (B11) | `po/bc2-bins-desktop` | 5285 | 57 | BC1 integrated |
| **BC3** the browser's Bins tab (catalogue, logging, flags, takes, remove — no adding, no playing; the notice), and the desktop→cloud migration carrying bins (B9) | `po/bc3-bins-web` | 5286 | 58 | BC2 integrated |
| **BC4** the file gateway: a design-first bundle with its own question list (install story, TLS, the switch's enforcement, audit, what it serves to the Scenes tab's takes as well) | later | — | — | BC3 integrated, and her answers to its questions |

**Numbers.** Migration **0091 / suite 93** for BC1 (and 94 if the policies need a second suite). The numbers 0079 (bins) and 0080 (assemblies) that the demo plan reserved on paper are **retired**: 0079 would sort before migrations already applied everywhere, and assemblies were superseded by edits (D6). Next free after BC1: 0092 / suite 95. Walkthroughs 57, 58 (56 is S4c's). Ports 5284–5286.

**Shared files and who owns them.** BC1: `supabase/migrations`, `supabase/tests/rls`, `adapters/supabaseAdapter.js` (a bins block), `adapters/localServerAdapter.js`, `state/RabbitProvider.jsx` (the bins block only), `electron/rabbitBins.cjs` (parity), `src/dev/fixtures`, `.github/workflows/rls.yml` (`RLS_TABLES`). BC2: `views/BinsView.jsx` and `views/bins/*`, `electron/rabbitBins.cjs`, the settings UI for locations and the switch. BC3: `views/BinsView.jsx` (the browser branch), `src/cloud/migrate/runMigration.js`, the help. Nothing of these runs beside S4c (the Files tab): BC1 starts when S4c is in.

## 3. Verification

As the post-overhaul plan §5, plus: BC1's hand-off states the dev query that proves the migration and every suite's count, and proves the poster policy both ways (switch off → the insert refused; on → admitted); BC2 is exercised on a real network path — Audrey's server, or a share stood up for the test (a UNC path, not a drive letter) — with the measurements in the hand-off; BC3's browser run is on the dev-backed web build signed in as the seeded smoke users.
