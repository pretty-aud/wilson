# 19 — FILES: every folder and file of a project (RESOURCES → FILES)

**What this is.** A read-only explorer for one project's folders and files,
under the RESOURCES menu, in two views: a **table** of everything and
**Finder-style columns**. Every file shows its name, type, size, created
time, modified time, duration (audio/video) and where it is stored.

Your words, 2026-09-11: *"in the resource section of the app please add a
way for me to view all the files in a project. allow me to choose a project
and have a way to view folders and files. it should look something like
window explorer. have a way to view all files and folder in one table, and
also have a view that works like the column system in finder for mac os."*

Written 2026-09-11 against `feat/demo-2026-09-11`. Works on both backends
(Supabase and Local Server); the rows come straight from the adapter, so
choosing a project here does not change which project is open elsewhere.

**Before you start.** For the duration and the file's own modified time to
be recorded on the cloud, migration 0081 must be on the database you sign
into (the hand-off's "Waiting on Audrey" has the command, next to 0072).
Without it everything else here still works; those two columns simply stay
empty for cloud rows. Files added BEFORE tonight have no duration either —
it is read from the bytes as a file is added, not backfilled.

---

| # | Do | You should see |
|---|----|----------------|
| 1 | Menu (≡) → **RESOURCES** → **FILES** | The FILES page: a project picker ("Choose a project…"), **Table** / **Columns** buttons, a filter box, **Refresh**. If a project was already open, it is selected and its files are loaded. |
| 2 | Pick a project | The count line: *N folders · M files · <title>*. Columns view by default: the first column lists the project's top-level folders (ASSETS, SCENES, SHOTS, …) and any files at the root. |
| 3 | Click a folder | The next column opens with that folder's folders and files; click deeper and another column opens — one column per level, exactly like Finder. The selected folder in each column is highlighted. |
| 4 | Click a file | The **Details** panel on the right fills in: Name, Type (e.g. *Video · MOV*), Size, Created, Modified, Duration, Location (the folder path), Stored (*Petal cloud*, *This computer*, *The project folder on this computer*, or *Your own bucket*). |
| 5 | Click **Table** | Every folder and file in one table, folders in bold with their files indented beneath them. Columns: Name, Type, Size, Created, Modified, Duration, Location. Click a header to sort by it; click again to reverse. Click a file row to see its details. |
| 6 | Type in the filter box | Both views narrow to names or paths containing what you typed; in the table the matching file's folders stay so the path still reads. |
| 7 | Add a clip to a project (its Files panel or an asset), then **Refresh** here | The new file appears with its size and, for an MP4/WebM/MP3/WAV, its duration. A ProRes or MXF clip shows *not read* for duration — the app cannot decode it without ffmpeg, which is not installed on this machine. |
| 8 | Switch the Storage Backend (Settings → Storage) and come back | The project list is the other backend's; a Local Server project also lists the assets' managed files (the ones the bins ingest) beside the project files. |

**What "Created" and "Modified" mean.** Created is when WILSON recorded the
file. Modified is the source file's own last-modified time as your computer
reported it when you added it — a browser cannot read a file's original
creation time, so that is the closest fact available.

**Limits, stated.** Read-only: opening, moving and deleting stay in the
project's own Files panel and FileManager. Duration is decoded by the app
itself (H.264/AAC MP4, WebM, MP3, WAV, FLAC, OGG); other codecs record no
duration. Files added before 2026-09-11 carry no duration or modified time.
