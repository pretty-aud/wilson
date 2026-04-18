# Session 2 → Session 3 Checklist

## Progress

| # | Task | Status |
|---|---|---|
| 1 | Install Supabase CLI + log in | ✅ **Done** (Scoop install, CLI 2.90.0) |
| 2 | Commit + push Session 2 work | ✅ **Done** (4 commits, pushed as `feat/multi-user-v1` on 2026-04-18) |
| 3 | `supabase link` + `supabase db push` | ⏳ To do |
| 4 | Deploy `provision-workspace` Edge Function | ⏳ To do |
| 5 | pgTAP suite green | ⏳ To do (CI is running now — see link below) |
| 6 | Sign-in smoke test against wilson-dev | ⏳ To do |
| 7 | (Optional) fix preview port mismatch | Optional |

**Session 2 commits on `origin/feat/multi-user-v1`:**
- `59181df` feat(rls): session 2 lockdown — RLS sweep of 13 RABBIT tables
- `d03fca8` refactor(cloud): remove supabase.json fallback; extract AuthShell
- `de140f2` feat(auth): login rebuild on AuthShell + new-company + new-user wizards
- `33556bc` feat(migrate): single-user → cloud data migration tool

**CI run in progress:** https://github.com/pretty-aud/wilson/actions

---

## Standard bash preamble (needed before every terminal command)

```bash
export PATH="/c/Users/Audrey/scoop/shims:/c/Program Files/nodejs:$PATH"
cd "/c/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON"
```

The Scoop shims dir is where `supabase.exe` lives. Without it, `supabase` commands fail with "command not found" in bash. `npm` lives in Program Files. `cd` keeps git + supabase commands on the right repo.

---

## 1. Install the Supabase CLI · **BLOCKING**

### 1a. Check if it's already installed

```bash
supabase --version
```

- **If it prints `2.x.x`:** skip to 1c.
- **If "command not found":** continue to 1b.

### 1b. Install

Try `npm` first (works on this machine per memory — `npm` lives at `/c/Program Files/nodejs/npm.cmd`):

```bash
npm install -g supabase
```

**If npm install fails** with a permissions error or "EACCES":
```bash
# Try the Scoop path instead (popular on Windows):
scoop install supabase
```

**If you don't have Scoop:**
1. Download the Windows binary from https://github.com/supabase/cli/releases/latest
2. Extract `supabase.exe` to `C:\Users\Audrey\bin\` (which is already on your PATH)
3. Verify: `supabase --version`

### 1c. Log in (one-time)

```bash
supabase login
```

This opens your browser. Click **Authorize CLI**. The CLI stores a token at `%APPDATA%\supabase\access-token` — you won't need to log in again on this machine.

**Expected terminal output:**
```
Hello from Supabase! Press Enter to open browser to login or Ctrl+C to abort.
You are now logged in. Happy coding!
```

---

## 2. ✅ DONE — Commit + push Session 2

All 4 commits are on `origin/feat/multi-user-v1`. No action needed. Verify if you want:

```bash
git log --oneline origin/feat/multi-user-v1 -6
```

Should show `33556bc`, `de140f2`, `d03fca8`, `59181df` at the top.

---

## 3. Link the repo to wilson-dev and push migrations · **BLOCKING**

### 3a. Find your `wilson-dev` project ref

Go to https://supabase.com/dashboard — log in if needed.

Click the **wilson-dev** project tile. The URL becomes:
```
https://supabase.com/dashboard/project/abcdefghijklmno
                                        ^^^^^^^^^^^^^^^
                                        this is the ref
```

Copy that 15-20 character ref (it's lowercase letters only).

### 3b. Link the local repo

```bash
supabase link --project-ref <paste-the-ref-here>
```

Replace `<paste-the-ref-here>` with your actual ref.

**It will ask for the database password.** This is the password you set when you created the `wilson-dev` project (NOT your Supabase login password). If you don't remember it, reset it from the dashboard:
- Dashboard → Project Settings → Database → Reset database password

**Expected output:**
```
Finished supabase link.
```

A `supabase/.temp/` directory gets created (already in `.gitignore`).

### 3c. Push pending migrations

```bash
supabase db push
```

**Expected output** (approximately):
```
Connecting to remote database...
Applying migration 0004_rls_rabbit.sql...
Applying migration 0005_test_helpers.sql...
Applying migration 0006_user_profile_fields.sql...
Finished supabase db push.
```

### 3d. If `supabase db push` fails

**Error: "migration X already applied but checksum changed"**
This means an earlier migration was edited after being applied. Since you're on a fresh dev environment, repair and re-push:
```bash
supabase migration repair --status reverted <version-number-from-error>
supabase db push
```

**Error: SQL syntax / function does not exist**
Fix the offending migration file, then re-run `supabase db push`. All three Session 2 migrations are idempotent (`IF NOT EXISTS` / `DROP ... IF EXISTS` / `ON CONFLICT DO NOTHING`) so re-running is safe.

**Error: "column already exists"**
Probably a partially-applied migration from an earlier attempt. Run:
```bash
supabase db push --dry-run
```
to see what it thinks is pending, then either repair (above) or manually run the individual remaining `ALTER TABLE` statements in the Supabase SQL editor.

---

## 4. Deploy the `provision-workspace` Edge Function · **BLOCKING**

```bash
supabase functions deploy provision-workspace --no-verify-jwt
```

`--no-verify-jwt` is correct for this function because new-company callers aren't authenticated yet.

**Expected output:**
```
Bundling provision-workspace
Deploying provision-workspace (project ref: <your-ref>)
Deployed Functions on project <your-ref>: provision-workspace
You can inspect your deployment in the Dashboard:
https://supabase.com/dashboard/project/<your-ref>/functions
```

### 4a. Verify

```bash
supabase functions list
```

You should see three functions:
```
NAME                 │ STATUS │ ...
provision-workspace  │ ACTIVE │ ...
issue-session        │ ACTIVE │ ...
resolve-login        │ ACTIVE │ ...
```

### 4b. Smoke-test the function itself (optional, ~10 seconds)

```bash
curl -X POST "https://<your-ref>.supabase.co/functions/v1/provision-workspace" \
  -H "content-type: application/json" \
  -H "apikey: <your-anon-key>" \
  -d '{}'
```

**Expected response:** `{"error":"validation_failed","errors":[...]}` with 400 status. This confirms the function is reachable and rate-limit/validation is working. (Don't call it with real data yet — use the UI wizard for that.)

---

## 5. Verify the pgTAP suite is green · **BLOCKING**

You have two paths. **Pick option A or option B — not both.**

### Option A — GitHub Actions (easiest; already running)

The `git push` you did in step 2 triggered `.github/workflows/rls.yml`. Check it:

1. Go to https://github.com/pretty-aud/wilson/actions
2. Click the most recent run (should be near the top, tagged `feat/multi-user-v1`)
3. Click the **pgTAP (Supabase local DB)** job
4. Expand the **Run pgTAP suite** step

**Expected:** All 53 assertions pass. Final line reads:
```
All tests successful.
Files=13, Tests=53, ...
Result: PASS
```

**If it fails:** the log shows exactly which table + which assertion failed. Most common causes:
- Policy typo (wrong column name referenced) → fix migration 0004
- Audit trigger missing on one table → check the audit-trigger `FOREACH` loop in 0004
- Test UUID uses a non-hex character → fix the test file

After fixing, commit and push — CI will re-run automatically.

### Option B — locally (requires Docker Desktop running)

```bash
supabase start --exclude realtime,storage-api,imgproxy,edge-runtime,studio,mailpit
```

Takes ~60 seconds the first time (pulls Docker images). Watch for:
```
Started supabase local development setup.
```

Then:
```bash
supabase test db
```

**Expected output ends with:**
```
All tests successful.
Files=13, Tests=53, Passed=53, Failed=0
```

Clean up when done:
```bash
supabase stop --no-backup
```

---

## 6. Sign-in smoke test against wilson-dev · **BLOCKING**

This is the biggest step — it verifies Session 1 + Session 2 work end-to-end. Break it into three sub-steps.

### 6a. Pre-checks

**JWT hook configured?**
1. Go to `https://supabase.com/dashboard/project/<your-ref>/auth/hooks`
2. Look for **Custom Access Token (Beta)** — should be enabled
3. The function should be `public.custom_access_token_hook`

If it's not there: click **Add hook** → **Custom Access Token** → select the function. This was set up in Session 1; if it got disabled for any reason, this is where you fix it.

**Environment variables present?**
```bash
cat .env.local 2>/dev/null | grep VITE_SUPABASE
```

You should see two lines:
```
VITE_SUPABASE_URL=https://<your-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR...
```

If `.env.local` doesn't exist or is missing these, copy from `.env.example` and fill in:
- `VITE_SUPABASE_URL` from dashboard → Project Settings → API → Project URL
- `VITE_SUPABASE_ANON_KEY` from dashboard → Project Settings → API → Project API keys → `anon public`

### 6b. Seed a test user

You need: a workspace, an auth.users row, a workspace_members row linking them, and one project.

**Step 1: Create the auth user via dashboard** (this handles password hashing correctly)
1. Dashboard → Authentication → Users → **Add user** → **Create new user**
2. Email: `smoke@example.com`
3. Password: pick something memorable like `SmokeTest2026!`
4. ✅ **Auto Confirm User** (checkbox — very important, skip the email verification)
5. Click **Create user**
6. Click the newly-created user. Copy the **User UID** (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`). You'll paste this below.

**Step 2: Seed the workspace + membership + project**

Dashboard → SQL Editor → **New query** → paste and run:

```sql
-- 1. Workspace
INSERT INTO public.workspaces (id, name, slug)
VALUES ('99999999-0000-0000-0000-000000000001', 'Smoke Workspace', 'smoke')
ON CONFLICT (id) DO NOTHING;

-- 2. Membership — replace <USER_UID> with the UID you copied above
INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active, onboarded_at)
VALUES ('99999999-0000-0000-0000-000000000001',
        '<USER_UID>',
        'admin', 'smoke_admin', 'Smoke Admin', true, now())
ON CONFLICT DO NOTHING;

-- 3. Project
INSERT INTO public.projects (id, workspace_id, title, created_by)
VALUES ('99999999-0000-0000-0000-000000000002',
        '99999999-0000-0000-0000-000000000001',
        'Smoke Project',
        '<USER_UID>')
ON CONFLICT (id) DO NOTHING;

-- Verify
SELECT m.username, m.app_role, w.name AS workspace, p.title AS project
  FROM public.workspace_members m
  JOIN public.workspaces w ON w.id = m.workspace_id
  LEFT JOIN public.projects p ON p.workspace_id = w.id
 WHERE m.user_id = '<USER_UID>';
```

Expected: one row, `smoke_admin | admin | Smoke Workspace | Smoke Project`.

### 6c. Walk the full flow

Launch the app in dev mode. Open **two terminals**:

**Terminal 1:**
```bash
npm run dev
```
Vite starts on port 5203. Keep it running.

**Terminal 2:**
```bash
# Start Electron pointing at the dev server.
# Check package.json "scripts" for the exact name — commonly one of:
npm run electron:dev
# or:
npm run start
# or:
npm run electron
```

Check [package.json scripts](../../package.json) if none work.

**Walk through the app:**

| Step | Action | What to verify |
|------|--------|----------------|
| 1 | App boots → MUTINY gate shows (logo, orange bars, PASSWORD prompt) | ✅ PasswordScreen unchanged |
| 2 | Type `MUTINY`, press Enter | Bars compress, light-orange reveal, app appears briefly |
| 3 | **LoginScreen takes over** — logo card → bars → `LOGIN` title → `USERNAME` label → blinking `_` cursor | ✅ **THIS is the Session 2 aesthetic rebuild.** Compare visually to PasswordScreen — same orange shades, same monospace, same cursor blink rate. |
| 4 | Type `smoke_admin`, press Enter | Stage swaps to PASSWORD with a small `· smoke_admin change` subtitle. Bars stay compressed. |
| 5 | Type your password (`SmokeTest2026!`), press Enter | Bars compress further to 268px, light-orange fades, app reveals. |
| 6 | Home page shows, navigate to **RABBIT** | "Smoke Project" visible in the project list |
| 7 | Open DevTools (Ctrl+Shift+I), Console tab | Ready for the JWT check |
| 8 | Run in console: | See below |

```js
// Paste this into the Console:
(async () => {
  const { data: { session } } = await window.supabase.auth.getSession();
  const claims = JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
  console.table(claims.app_metadata);
})()
```

**Expected output:** a table with 4 rows:
| key | value |
|---|---|
| workspace_id | `99999999-0000-0000-0000-000000000001` |
| workspace_ids | `["99999999-0000-0000-0000-000000000001"]` |
| app_role | `admin` |
| is_platform_operator | `false` |

**Key proof: `workspace_id` is NOT null.** If it's null, the JWT hook isn't firing — go back to 6a and fix the hook configuration.

**Note:** if `window.supabase` isn't exposed (it might not be — it's an internal import), use this alternative:
```js
(async () => {
  const s = JSON.parse(localStorage.getItem('wilson.dev.session') || 'null');
  if (!s) { console.warn('no session in localStorage — did you check safeStorage?'); return; }
  const claims = JSON.parse(atob(s.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
  console.table(claims.app_metadata);
})()
```

| Step | Action | What to verify |
|---|---|---|
| 9 | Navigate to **Settings → General** | `WorkspaceSwitcher` should be **hidden** (single-workspace user). If it renders anyway, that's a bug. |
| 10 | Navigate to **Settings → RABBIT** | `MigrationPanel` visible under "Storage Backend" with **DRY-RUN** + **MIGRATE** buttons |
| 11 | Click **DRY-RUN** | Progress log shows "Found N local project(s)." If you have local rabbit-data it shows counts; otherwise `Found 0 local projects.` — either is fine |
| 12 | Sign out in the console: `await window.wilsonSignOut()` | Should return to PasswordScreen (MUTINY gate). Refreshing the page should NOT auto-sign-in anymore. |

### 6d. If any step fails

| Symptom | Likely cause |
|---|---|
| LoginScreen shows the OLD dark-panel UI | Stale Vite cache. Stop `npm run dev`, delete `node_modules/.vite/`, restart. |
| Sign-in button/Enter does nothing | Check Console for errors. Most likely `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` missing. |
| "Sign-in failed. Check username and password." on correct creds | Either the JWT hook is misconfigured (see 6a), or the password is actually wrong. |
| App reveals but no project shows | RLS blocking. Double-check the membership row exists (`SELECT * FROM workspace_members WHERE user_id = '<UID>'`) and `is_active = true`. |
| `workspace_id` is null in the JWT claim | JWT hook not firing. See 6a. Alternatively the hook fires but the user has no active memberships — verify with `SELECT * FROM workspace_members WHERE user_id = '<UID>' AND is_active`. |
| `WorkspaceSwitcher` shows when it shouldn't | The fetch succeeded but returned >1 row — inspect `SELECT * FROM workspaces` (RLS scoped to your user) to find the extra one. |

---

## 7. (Optional) Fix preview port mismatch

Not blocking but saves future friction. Skip if you don't care.

### Option A — align Vite to 5173 (preview-tool-friendly)

1. Edit `vite.config.js`:
   ```js
   server: {
     port: 5173,  // was 5203
   },
   ```
2. Edit `supabase/config.toml` — replace both occurrences of `http://localhost:5203` with `http://localhost:5173`.
3. Apply the new auth redirect config:
   ```bash
   supabase db push
   ```
   (The config.toml change is picked up by push too.)

### Option B — leave 5203 and document it

Already done in `SESSION_03_prompt.md` → "Known rough edges." Skip.

---

## Go-signal for Session 3

You're ready to paste `SESSION_03_prompt.md` into a new Claude Code conversation when:

- [x] Commits on `origin/feat/multi-user-v1` (done)
- [ ] GitHub Actions **RLS tests** workflow is green
- [ ] `supabase functions list` includes `provision-workspace`
- [ ] `smoke_admin` sign-in lands on Home with "Smoke Project" visible
- [ ] JWT `app_metadata.workspace_id` is non-null and matches the seeded workspace UUID

Session 3's first action is the `ws_members_self_update` RLS policy (unblocks NewUserWelcome for non-admin invited users). Then email infra → PermissionGate → invite flow.

---

**Reference paths:**
- Session 3 prompt: `docs/sessions/SESSION_03_prompt.md`
- This checklist: `docs/sessions/SESSION_02_TO_03_CHECKLIST.md`
- Master plan: `C:\Users\Audrey\.claude\plans\curried-cooking-unicorn.md`
- Memory: `C:\Users\Audrey\.claude\projects\C--Users-Audrey-Documents-My-Work-Dev-Work-Claude-Work\memory\wilson_multi_user_plan.md`
