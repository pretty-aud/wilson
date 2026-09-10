# 18 — The local demo folder

**What this is.** One folder on your own disk that holds every R.A.B.B.I.T.
project you make for the demo — the project data, the project folders with
their files, and the thumbnail cache. Close the app, reopen it, it is all
there. Copy the folder to another computer, point WILSON at the copy, same
demo.

**What it is not.** A way past the sign-in screen. You sign in exactly as
today (your instruction, 2026-09-10: *"user still needs to login no matter
what"*); the folder is chosen afterwards, in Settings → Storage.

Written 2026-09-10 against `feat/demo-2026-09-11` at `2ab285f`. Every step
says what you should see; if you see something else, that is the report.

---

## Before you start

1. **Run the desktop app, built against staging** (measured 2026-09-10 —
   the build that lets you sign in with your own account). From `WILSON\`:

   ```bash
   npx vite build --mode staging && npx electron .
   ```

   Not `npm run dev` (the browser build has no local server and no folder
   dialog). Not `npm run electron:dev` either: that builds against
   **wilson-dev**, where the username `audrey` belongs to the
   `admin@petalstudios.co` account and your password is refused
   (`docs/sessions/SESSION_22_prompt.md` line 79 records the same thing).

2. **Sign in** as usual: company, username `audrey`, your password, TOTP if
   asked. Staging is only used for the sign-in and your account data; every
   R.A.B.B.I.T. project in this walkthrough lives in the folder on your disk.

3. **Make an empty folder** somewhere you can find in Explorer, for example
   `C:\Users\Audrey\Desktop\WILSON Demo`.

---

## The walkthrough

| # | Do | You should see |
|---|----|----------------|
| 1 | Menu (≡) → **SYSTEM SETTINGS** → **STORAGE** tab → scroll to *Storage Connections* | A card **LOCAL DEMO FOLDER** with a grey dot: *"No demo folder is open. Projects live in this computer's app data:"* and the app-data path, plus a button **Choose a demo folder…**. Below it, *Project files root* (the old per-machine setting) still shows. |
| 2 | Click **Choose a demo folder…** → the OS dialog *"Choose the folder that holds this demo"* → pick your empty folder → **Use this folder** | The window reloads (a second of orange) and lands on Home. |
| 3 | Menu → SYSTEM SETTINGS → STORAGE again | The card has a **green dot**, the folder's **full path**, the line *"Projects, files and thumbnails live in this folder. Copy the whole folder to carry the demo to another computer."* and three buttons: **Change folder…**, **Open in Explorer**, **Close folder**. The *Project files root* line is gone (the folder's `projects\` is the root now). Above the cards, *Storage Backend* shows **Local Server — In use**. |
| 4 | Click **Open in Explorer** | Explorer opens the folder. It holds `wilson-demo.json`, `projects\` and `.wilson\` (nothing else yet). |
| 5 | Menu → **PROJECTS** → **NEW PROJECT** → title `Friday Demo` → create | The project opens. In Explorer, `projects\Friday-Demo\` now exists with `ASSETS`, `INVOICES`, `SCENES`, `SHOTS`, `Friday-Demo_DATABASES` and `Friday-Demo_FILES`; `.wilson\rabbit-data\projects\<id>\project.json` is the project's data. |
| 6 | In the project, add a file to an asset (Assets → add files) | The file lands under `projects\Friday-Demo\ASSETS\<asset>\`, and its thumbnail under `.wilson\rabbit-data\thumbnails\`. Nothing appears in `%APPDATA%\wilson\rabbit-data`. |
| 7 | **Close the app. Reopen it. Sign in.** | Projects lists `Friday Demo`. Settings → Storage shows the same folder with the green dot. |
| 8 | Settings → Storage → **Change folder…** → pick a *second* empty folder | Reload. PROJECTS is empty — this is a different demo. Settings → Storage now lists the first folder under **RECENT FOLDERS** with **Open** and **Forget**. |
| 9 | Under RECENT FOLDERS click **Open** on the first folder | Reload. `Friday Demo` is back. |
| 10 | **Change folder…** → pick a folder that already has other files in it (a folder of photos) | The card asks: *"This folder already holds N items. Nothing in it is touched. Use it for the demo anyway?"* with **Use this folder** / **Choose another**. Click **Choose another** — nothing was written to that folder. (Choosing *Use this folder* would add `wilson-demo.json`, `projects\`, `.wilson\` beside the photos and leave the photos alone.) |
| 11 | Close the app. In Explorer, **rename** the demo folder (pretend the drive is unplugged). Reopen, sign in, Settings → Storage | The card says in red *"Your demo folder is not available. Plug the drive in, or point WILSON at it again."* with the old path and two buttons: **Locate it…** and **Forget it**. Projects is empty meanwhile — WILSON did **not** quietly switch to app data. |
| 12 | Rename the folder back → **Locate it…** → pick it | Reload. `Friday Demo` is back; the folder was **adopted**, not reinitialised (the project is intact). |
| 13 | Copy the whole folder to another computer (or move it here and rename the original) → **Change folder…** → pick the copy | Reload. Same projects, same files; each project's folder now resolves under the copy. (A project remembers an absolute folder path; while a demo folder is open, a remembered path that **no longer exists** is rebased to `<folder>\projects\<slug>` on read, and the move is written to the project's audit stream. A copy made on the **same** machine while the original still exists keeps pointing at the original's files — deliberate: a pointer to real files is never overwritten.) |
| 14 | Settings → Storage → **Create demo project** (second row of buttons on the card) | A green line: *Created "Friday Demo" with 2 scenes and 5 shots. Open it from PROJECTS.* PROJECTS lists **Friday Demo**; opening it in R.A.B.B.I.T. shows the **Scenes** tab (scenes and shots are on) with SC01 (three shots) and SC02 (two shots). In Explorer, `projects\Friday-Demo\SCENES\` and `SHOTS\` have a folder per scene and shot. The names are placeholders until you answer question 4. |
| 15 | Settings → Storage → **Reset demo folder…** | A confirmation that names the folder and exactly what goes: `<folder>\projects` and `<folder>\.wilson\rabbit-data`, *"Nothing outside this folder is touched, and the folder stays open."* Confirm → reload → PROJECTS is empty, the folder is still open, `wilson-demo.json` is still there (now with `last_reset_at`), and any file you had put beside them survives. If the folder already had a `projects\` of its own before WILSON opened it (step 10's "use it anyway" case), Reset **refuses** with a red sentence and deletes nothing — empty that folder by hand first. |
| 15a | While the folder is missing (step 11) open PROJECTS | The list is empty and Settings → Storage → *Storage Backend* shows **Offline — the demo folder is not available: <path> — open Settings → Storage to locate it, forget it, or close it**. WILSON refuses to read or write R.A.B.B.I.T. data until you do one of the three; it never quietly uses app data instead. |
| 16 | Settings → Storage → **Close folder** → confirm | Reload. The card is back to the grey-dot state; Projects shows whatever lives in app data (an old Local Server install's projects, or nothing). The folder on disk is untouched — closing never deletes. |

---

## The cable pulled

Sign in **while online first**, then pull the cable. R.A.B.B.I.T. keeps
working from the folder — the local server is an in-app Express server on
127.0.0.1 and never leaves the machine. O.T.T.E.R.'s library is local too.
Anything that needs the cloud (AI, the pet's account sync, the Admin
Terminal, cloud storage) reports unavailable rather than hanging.

**The one limit, stated plainly (corrected 2026-09-10):** a LAUNCH needs the
auth server, however fresh the saved sign-in is. Restoring a saved session asks
Supabase to confirm the account first (`@supabase/auth-js` 2.101.1,
`GoTrueClient._setSession`: the `_getUser` request it makes for a token that
has *not* expired), and offline that request fails, so the app shows the
sign-in screen and cannot get past it — a minute after signing in as much as
a day after. Once the app is OPEN the session lives in memory: R.A.B.B.I.T.
keeps working from the folder, and after about an hour (when the token can no
longer be renewed) only the cloud features — AI, account sync, the Admin
Terminal — report unavailable. So on the demo machine: **sign in while
online, then pull the cable, and do not close the app** between then and the
demo. If the app has to be relaunched, reconnect first, launch, sign in, then
disconnect again. (An offline-tolerant launch — open the shell on a saved,
unexpired sign-in when the auth server cannot be reached — is a small change
to `hydrateSupabase` in `src/cloud/auth/supabaseClient.js`; it is a policy
decision, asked in the hand-off, not built.)

To rehearse without unplugging anything (dev builds only):

```bash
set WILSON_DEV_OFFLINE=1 && npm run electron:dev
```

Every request that is not to the app's own local server is cancelled before
it leaves the window. The terminal shows
`[wilson] WILSON_DEV_OFFLINE=1 — every non-loopback request is cancelled`.

---

## What lives where

| Thing | With a demo folder open | With no folder open |
|---|---|---|
| Project data (the JSON bundle per project) | `<folder>\.wilson\rabbit-data\projects\<id>\project.json` | `%APPDATA%\wilson\rabbit-data\projects\…` |
| Project folders and files | `<folder>\projects\<slug>\…` | the *Project files root* (Settings → General) or nowhere |
| Thumbnail cache | `<folder>\.wilson\rabbit-data\thumbnails\` | `%APPDATA%\wilson\rabbit-data\thumbnails\` |
| Rate cards, team members, task templates | `<folder>\.wilson\rabbit-data\…` | `%APPDATA%\wilson\rabbit-data\…` |
| The folder's manifest | `<folder>\wilson-demo.json` (format, created, app version, last opened) | — |
| Which folder is open, and the recent list | `%APPDATA%\wilson\local-demo.json` | same file, `activeFolder: null` |
| The pet, O.T.T.E.R. settings, agent skills, **which storage backend is in use** | `%APPDATA%\wilson\otter-data\` — per machine, unchanged | same |
| Your sign-in | `%APPDATA%\wilson\session.enc` — per machine, unchanged | same |

`%APPDATA%\wilson` is `C:\Users\Audrey\AppData\Roaming\wilson`.

---

## Things to know

- **Opening or closing a folder reloads the window.** R.A.B.B.I.T. loads its
  project list once per launch; a new root needs a fresh start. You land on
  Home after the reload.
- **Choosing a folder switches the Storage Backend to Local Server** if it
  was on Supabase, and clears the remembered "active project".
- **A folder made by a newer WILSON is refused** with a sentence, never
  opened half-way.
- **Nothing is moved silently.** Projects that already sit in app data stay
  there; opening a folder does not copy them. (An explicit "adopt existing
  local projects" action is on the list if you want it — question 3.)
- The pet you see while working locally is this machine's own pet, saved in
  app data.
