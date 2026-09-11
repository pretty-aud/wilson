# 24 — Dev fixtures mode: a fake studio to review the UI against

**What this is.** Your ask, 2026-09-11, late: *"for reviewing instead of seeing
empty tables. lets add a dev mode/debug menu and add a fake project with a fake
team, fake assets fake everything just to show what it looks like. make it easy
to turn off. like a bypass for the database data, databases with data just to
test"*, right after *"no just bypass password entry."*

So: **one switch, one fake studio.** With it on, every table in the app is full —
"Lantern & Ash Pictures", a short film called *Salt Hours*, eight people, five
phases, forty-two tasks, files with thumbnails, scenes, shots, takes, bins, a
budget, two rate cards, four notes and one O.T.T.E.R. course — and **nothing
reaches Supabase at all**, not a read, not a write. With it off, you are back to
tester mode (no session, empty tables). It only exists in dev builds; the
installer and the beta cannot contain it (step 9 proves that).

Written 2026-09-11 against `feat/ui-overhaul`, session branch `ui/dev-fixtures`.
Nothing here touches a migration, an Edge Function, or a real row anywhere.

**Before you start.** `git checkout feat/ui-overhaul && git pull --ff-only &&
npm install`. Then, in `WILSON/.env.local`, two lines:

```
VITE_DEV_AUTOLOGIN=tester
VITE_DEV_FIXTURES=1
```

and `npm run dev`. (Both lines are documented in `.env.example`. The first
skips the sign-in with no session; the second fills the tables. Either alone is
fine; together is the review setup.)

---

| # | Do | You should see |
|---|----|----------------|
| 1 | Open the app. | Home as usual, plus a small dark pill at the **top-left**: **DEV · FIXTURES ON · Salt Hours · OFF**. That pill is the whole debug menu. It only renders in a dev build, and only when `VITE_DEV_FIXTURES=1` is set. Hover it for a one-line explanation. `ui-fixtures-root-*.png`. |
| 2 | Menu → **RESOURCES → Team members**. | **8 members**, with roles (one admin — that is you, Mara Okonkwo, producer), departments, pronouns, day rates from the internal rate card, and a projects column that says *Salt Hours*. The avatars are generated initials — there are no real pictures anywhere in this. Edit a title or flip someone's role: it saves (in memory, for this session) and the row updates. `ui-fixtures-team-members-*.png`. |
| 3 | **R.A.B.B.I.T.** and click the *Salt Hours* card. | Summary: 5 phases, 15 assets, 42 tasks, a project files list. Then walk the tabs: **Team** (the roster of eight with project roles), **Tasks** (42 across every status, three milestones), **Timeline** (five phases Aug–Dec 2026, critical path, one blocked task), **Budget** (crew, talent and expenses sheets, actuals, an active bid version, a grand total), **Assets** (15, with placeholder thumbnails in the gallery view), **Scenes** (6 scenes, 16 shots, runtime and frame counts), **Bins** (five bins, twelve files with posters, one rejected take, takes assigned to shots). `ui-fixtures-open-rabbit-*.png` for the Summary; the tabs were checked in the pane. |
| 4 | Change something. Drag a task's status, add a task, rename an asset, assign a take. | It works and it sticks for as long as the tab is open. **Reload and it is back to the dataset.** That is deliberate: the data is a script, not a database, so a review can never leave the fixture in a state nobody can reproduce. |
| 5 | Try something the fake studio cannot do: **Bins → Add files**, or upload a file on an asset. | A toast, top of the stack: *"Dev fixtures: Picking files from disk is not available on fixture data."* Nothing is dropped silently — every refused write says so, and the control's state rolls back the way it would after a real server error. The same happens for downloads, opening a file on disk, relinking a drive, forking or sharing an O.T.T.E.R. course. |
| 6 | **Dashboard.** | *My tasks*: 16 rows, the ones where Mara is assignee or reviewer, grouped by status, with ASSIGNED / REVIEWING chips. *Notes*: four notes with real bodies (open one — the text is there, the editor works, the version guard is real). `ui-fixtures-dashboard-*.png`. |
| 7 | **RESOURCES → Files**, then **Rate card**. | Files: *41 folders · 32 files · Salt Hours*, the same ASSETS / SCENES / SHOTS / INVOICES tree the real folder planner makes. Rate card: the **General** card with fourteen roles by department and burden/overhead, and the **Internal** card priced from six salaried members' wages. `ui-fixtures-project-files-*.png`, `ui-fixtures-rate-card-*.png`. |
| 8 | **O.T.T.E.R.** | One course, *DaVinci Resolve 19*, marked STANDARD, by Sofia Aldana, four subjects. Open it: sections and lessons with markdown, key takeaways and a practice prompt; the first subject shows as complete and the second half-done (that is your progress row). **Hotkeys** and **Functions** have entries. `ui-fixtures-otter-*.png`. |
| 9 | Click **OFF** on the pill. | The page reloads. The pill now reads **DEV · FIXTURES OFF · ON**, and every table is empty again — Team members says *No members yet*, R.A.B.B.I.T. has no projects. That is tester mode, exactly as before this bundle. Click **ON** to come back. The choice is remembered per browser profile (localStorage), so you can leave it off without touching `.env.local`. `ui-fixtures-off-*.png`. |
| 10 | Remove `VITE_DEV_FIXTURES=1` from `.env.local` (or set it to anything but `1`) and restart the dev server. | No pill at all, and no way to turn the fixtures on from inside the app. The env line is the master switch; the pill is the per-session one. |
| 11 | Optional, the proof: `npm run build` and then `grep -rl "Salt Hours" dist/`. | **Nothing.** Twelve fixture strings were grepped against a production build (the switch name, the storage key, the studio, the film, the id prefix, the badge, the adapter names): zero hits, six asset files. `vite build` replaces `import.meta.env.DEV` with `false`; every seam is on a line that names it first, and the dataset is behind one dynamic import in `main.jsx` that the bundler drops as dead code. `src/dev/devFixtures.test.js` pins that shape the way `devAutoLogin.test.js` pins the sign-in modes. |
| 12 | Optional: `node scripts/devFixturesProbe.mjs http://localhost:5233`. | Loads nine pages twice — fixtures on, then off — and lists every request that left for the Supabase host. **Fixtures ON: 0 requests, 0 console errors.** Fixtures OFF: 27, all the model-tier reads tester mode has always made (and always got 401 for). |
| 13 | Optional: `npx vitest run`. | **128 files, 2,396 tests, green** (124 / 2,348 before this bundle). The 48 new ones: the compile-out guard; a contract test that builds the REAL Supabase adapter (client mocked, never called), lists its methods and demands each exists on the fixtures adapter; a dataset test that checks every foreign key, every vocabulary word and every id; and the O.T.T.E.R. route handler against every route the parser produces. |

## What it is not

- **Not a mode you can pick in Settings.** The R.A.B.B.I.T. backend picker still
  says Supabase / Local Server / Google Drive. With the fixtures on, the
  Supabase slot is *served* by the in-memory studio, so `adapterMode` stays
  "supabase" and every cloud-only feature (project roster, notes, my tasks,
  edit history, realtime status) shows up the way it would on wilson-dev. A
  fourth visible mode would have hidden all of those.
- **Not real bytes.** Thumbnails, posters and avatars are generated SVGs
  (labels on a tint). Opening a file shows its placeholder; downloading is
  refused with a toast.
- **Not persistent.** A reload resets everything. If you want a state to
  survive, it has to be written into `src/dev/fixtures/data/*.js`, which is
  plain data and easy to edit.
- **Not in Electron's packaged build.** `npm run electron:dev` is a dev build
  (Vite's development mode), so the fixtures work there too when the two env
  lines are set; `npm run package` / `dist` / `build:web` / `build:vercel` are
  production builds and carry none of it.

## Decisions this bundle needs from you

1. **The pill's position.** Top-left, under the Electron title bar, out of the
   way of the hamburger. If you would rather have it in the nav strip or on
   the bottom bar, it is one style object in `src/dev/DevFixturesBadge.jsx`.
2. **"Salt Hours".** The studio, the film, the people and every name in the
   dataset are invented; the email domain cannot resolve. If you want a
   different kind of project (a brand campaign, a game) the data files are the
   only thing to change — the adapter does not care what the rows say.
3. **Nothing else.** No question about behaviour is open: with the pill off,
   the app is byte-for-byte what it was.
