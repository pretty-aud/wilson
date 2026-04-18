# Session 2 → Session 3 Checklist

Seven tasks. **1-6 are blocking**; 7 is optional cleanup.

Work from the WILSON repo root:
`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON`

Every bash session needs the npm path prefix (per memory):
```bash
export PATH="/c/Program Files/nodejs:$PATH"
cd "/c/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON"
```

---

## 1. Install the Supabase CLI (if missing) · **BLOCKING**

Check:
```bash
supabase --version
```
Expected: `2.x.x` or similar. If "command not found":

```bash
# Windows, via npm (easiest on this machine):
npm install -g supabase

# Or via scoop:
scoop install supabase
```

Verify again with `supabase --version`. Then log in (one-time):
```bash
supabase login
```
It opens a browser, you click "Authorize CLI". Token is saved in `%APPDATA%\supabase`.

---

## 2. Commit Session 2 work · **BLOCKING**

Still on branch `feat/multi-user-v1`. Review first:
```bash
git status
git diff --stat
```

You should see **22 new files + 8 modified**. If anything unexpected shows up, resolve before committing.

I recommend splitting Session 2 into four commits so the history stays legible and reviewable:

### Commit A — RLS lockdown (migrations + tests + CI)
```bash
git add supabase/migrations/0004_rls_rabbit.sql \
        supabase/migrations/0005_test_helpers.sql \
        supabase/tests/rls/ \
        .github/workflows/rls.yml

git commit -m "feat(rls): session 2 lockdown — RLS sweep of 13 RABBIT tables

Migration 0004 enables + forces RLS on every RABBIT table with policies
keyed on current_workspace_id() + active-membership check on writes.
Hybrid denormalization: direct workspace_id on assets/tasks/files/comments
(populated by BEFORE INSERT trigger from parent); parent-join on
phases/asset_versions/task_dependencies/task_links/rate_card_entries/
ingestion_runs/ingestion_chunks. Drops the hardcoded default
workspace_id on projects + rate_cards.

Migration 0005 adds a tests schema with rls_setup()/login_as()/logout()
fixtures used by the pgTAP suite.

13 pgTAP files (one per table, 53 asserts total) cover cross-tenant
SELECT denied, cross-tenant UPDATE denied, same-tenant SELECT allowed,
and audit-column auto-population.

.github/workflows/rls.yml runs the suite via supabase CLI local DB on
every push to feat/* and on every PR. A bash guard step fails CI if a
RABBIT table lacks its dedicated test file."
```

### Commit B — Legacy fallback removal + auth chrome primitive
```bash
git add src/tools/rabbit_v0.1.0/adapters/supabaseAdapter.js \
        src/tools/rabbit_v0.1.0/db/README.md \
        electron/preload.cjs \
        electron/main.cjs \
        src/cloud/auth/AuthShell.jsx

git commit -m "refactor(cloud): remove supabase.json fallback; extract AuthShell

Session 1 kept a per-project supabase.json fallback adapter path so
pre-migration tenants could keep running. Session 2 removes it: every
query now carries the user's JWT via the shared authenticated client.
The three rabbit:*-supabase-config IPC handlers are deleted; a one-shot
cleanupLegacySupabaseConfig runs on app.whenReady() to delete any
stale file left over from earlier installs.

AuthShell.jsx extracts the reusable chrome from PasswordScreen — the
compressing orange bars, light-orange content fill, logo card, and
reveal animation — so LoginScreen / NewCompanyWizard / NewUserWelcome
(and Session 3's password-reset wizards) inherit the same visual
language."
```

### Commit C — Login rebuild, workspace switcher, onboarding wizards
```bash
git add src/cloud/auth/LoginScreen.jsx \
        src/cloud/auth/WorkspaceSwitcher.jsx \
        src/cloud/onboarding/ \
        supabase/functions/provision-workspace/ \
        supabase/migrations/0006_user_profile_fields.sql \
        src/App.jsx \
        src/components/SettingsPage.jsx

git commit -m "feat(auth): login rebuild on AuthShell + new-company + new-user wizards

LoginScreen rewritten as a three-stage flow on AuthShell: USERNAME →
PASSWORD → WORKSPACE chooser (only shown when the user has >1 active
membership). Terminal typography throughout. Generic error copy stays
constant-time-safe.

WorkspaceSwitcher in Settings → General is hidden when the user
belongs to a single workspace; otherwise it shows an admin-style
picker that calls issue-session + refreshSession + saveSession and
reloads the renderer.

provision-workspace Edge Function (rate-limited 3/hr/IP) creates a
workspace + auth user + admin membership for self-serve onboarding,
with best-effort rollback on partial failure. Session 3 will replace
this with a transactional PL/pgSQL RPC.

NewCompanyWizard + NewUserWelcome both live on AuthShell. The welcome
flow captures display_name/pronouns/title/avatar and sets
workspace_members.onboarded_at. Migration 0006 adds those profile
columns with length guards + a partial index for admin views.

App.jsx gains an authMode state (login/new-company) and a
pendingOnboarding post-auth check that surfaces NewUserWelcome when
onboarded_at is null."
```

### Commit D — Data migration tool + session handoff docs
```bash
git add src/cloud/migrate/ \
        docs/sessions/SESSION_03_prompt.md \
        docs/sessions/SESSION_02_TO_03_CHECKLIST.md

# main.cjs + preload.cjs already committed in B but the archive-local-data
# IPC landed in the same edit; git considers it already tracked. If git
# status still shows them dirty, re-add:
git add electron/main.cjs electron/preload.cjs

git commit -m "feat(migrate): single-user → cloud data migration tool

src/cloud/migrate/runMigration.js walks /api/rabbit/projects served by
the local_server adapter and writes each project + children into the
active workspace via the shared authenticated client. Idempotent
(23505 on pk = skip), resumable, dry-runnable, with per-table counters
and an error list streamed via onProgress.

MigrationPanel is mounted in Settings → RABBIT under the Storage
Backend selector. Dry-run and Migrate buttons run the same runner
with different flags; post-migration, an Archive + Clear button
snapshots rabbit-data to a timestamped archives/rabbit-data-{ts}.json
and removes projects/ + thumbnails/ from disk, making the install
cloud-first.

Session 3 handoff prompt + this checklist finish Session 2."
```

### Push
```bash
git push -u origin feat/multi-user-v1
```
This triggers `.github/workflows/rls.yml` — watch the run in GitHub Actions. It'll fail if migrations or pgTAP are broken (see task 4).

---

## 3. Push migrations to wilson-dev · **BLOCKING**

```bash
# One-time per machine: link the repo to the wilson-dev project.
supabase link --project-ref <wilson-dev-project-ref>
# You can find the ref in the Supabase dashboard URL:
# https://supabase.com/dashboard/project/<ref>/

supabase db push
```

Expected output: lists 0004/0005/0006 as pending, applies all three. Should end with a success message and a summary like `Migrations applied: 3`.

**If it fails** with a SQL error, fix the migration file, then:
```bash
supabase db push
```
Re-runs are safe because 0004/0005/0006 are all `IF NOT EXISTS` / `DROP ... IF EXISTS` / `ON CONFLICT DO NOTHING`.

**If it fails with a "migration 0001 already applied but checksum changed"** error, you have an older version on the DB. Repair:
```bash
supabase migration repair --status reverted <migration-version>
supabase db push
```

---

## 4. Deploy `provision-workspace` Edge Function · **BLOCKING**

```bash
supabase functions deploy provision-workspace --no-verify-jwt
```
`--no-verify-jwt` because this is a public endpoint (creates new companies; callers aren't authenticated yet).

Verify deployment:
```bash
supabase functions list
```
You should see `provision-workspace` alongside `resolve-login` and `issue-session`.

---

## 5. Run the pgTAP suite against wilson-dev · **BLOCKING**

Two ways to do this:

### Option A — local DB (fast, recommended)
```bash
supabase start --exclude realtime,storage-api,imgproxy,edge-runtime,studio
supabase test db
supabase stop --no-backup
```
Expected: **53 asserts passing across 13 files.** Any failure identifies a bug in migration 0004 or the fixtures.

### Option B — GitHub Actions
Check the run triggered by your `git push` in step 2:
```
https://github.com/<your-org>/WILSON/actions
```
The **RLS tests** workflow should be green.

**If any test fails**, the failure message identifies the table and assertion. Most common causes: a policy typo (wrong column), the audit trigger missing on one of the 13 tables, or a test UUID using a non-hex character.

---

## 6. Sign-in smoke test against wilson-dev · **BLOCKING**

Pre-check your JWT hook is still configured in the Supabase dashboard:

> **Dashboard → Authentication → Hooks → Custom Access Token (Beta)**
> Should point at `public.custom_access_token_hook`. This was set up in Session 1; Session 2 didn't touch it.

Pre-check your `.env.local`:
```bash
cat .env.local | grep VITE_SUPABASE
```
Should show `VITE_SUPABASE_URL=https://<ref>.supabase.co` and `VITE_SUPABASE_ANON_KEY=eyJ…`.

Seed data (if needed — this creates a workspace, admin user, and one project you can use for the smoke test):
```bash
supabase db query "
INSERT INTO public.workspaces (id, name, slug)
VALUES ('99999999-0000-0000-0000-000000000001', 'Smoke Workspace', 'smoke')
ON CONFLICT (id) DO NOTHING;

-- Seed an admin user via the dashboard UI (Authentication → Users → Add user)
-- or via admin.createUser from a scratch script. Grab the generated user_id.

-- Then link it:
INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active, onboarded_at)
VALUES ('99999999-0000-0000-0000-000000000001',
        '<auth.users.id from above>',
        'admin', 'smoke_admin', 'Smoke Admin', true, now())
ON CONFLICT DO NOTHING;

INSERT INTO public.projects (id, workspace_id, title, created_by)
VALUES ('99999999-0000-0000-0000-000000000002',
        '99999999-0000-0000-0000-000000000001',
        'Smoke Project',
        '<auth.users.id from above>')
ON CONFLICT (id) DO NOTHING;
"
```

Launch the app in dev mode:
```bash
npm run dev            # Vite on 5203
# In a second terminal:
npm run electron:dev   # if that's your electron start script; otherwise
                       # the usual npm start / electron-forge start
```

Walk through:
1. App boots → **PasswordScreen** shows (MUTINY gate). Type `MUTINY` + Enter.
2. **LoginScreen** replaces it. Logo card → bars → `LOGIN` title → `USERNAME` input with blinking `_` cursor. ← this is the Session 2 aesthetic rebuild; confirm it matches your memory of `PasswordScreen`.
3. Type `smoke_admin` → Enter. Stage swaps to `PASSWORD` with a small `· smoke_admin change` line.
4. Type the seeded user's password → Enter.
5. Bars compress to 268px, light-orange bg fades, app reveals. Home screen renders with "Smoke Project" visible.
6. Open DevTools console (Ctrl+Shift+I) and run:
   ```js
   const s = await window.supabase?.auth.getSession()
   const claims = JSON.parse(atob((s.data.session.access_token).split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))
   console.log(claims.app_metadata)
   ```
   You should see `{ workspace_id: '99999999-...', workspace_ids: [...], app_role: 'admin', is_platform_operator: false }`. The key proof: **`workspace_id` is non-null**.
7. Navigate to **Settings → General**. `WorkspaceSwitcher` should be **hidden** (only one workspace). If you add a second workspace_members row for this user on a different workspace, the switcher becomes visible. Optional extended test.
8. Navigate to **Settings → RABBIT**. `MigrationPanel` should be visible. Click **DRY-RUN**. If there are local projects, you'll see a count table. If there are no local projects, the progress log says "Found 0 local projects".
9. Sign out:
   ```js
   await window.wilsonSignOut?.()
   ```
   You should return to PasswordScreen.

**If any step fails**, that's a real bug — diagnose before Session 3.

---

## 7. (Optional) Fix preview port mismatch

Unrelated to Session 2 functionally, but saves friction in future sessions. Pick one:

### Option A — align Vite to 5173
```bash
# Edit vite.config.js:
#   server.port: 5203  →  5173
# Edit supabase/config.toml:
#   site_url = "http://localhost:5203"  →  5173
#   additional_redirect_urls = ["http://localhost:5203"]  →  5173
# (Then `supabase db push` so the auth redirect URLs update.)
```

### Option B — teach the preview tool about 5203
The mismatch is in Claude's preview tooling, not in your repo. Already documented in `SESSION_03_prompt.md` under "Known rough edges." Leave it and revisit if it becomes painful.

---

## Go-signal for Session 3

You're ready to paste the Session 3 prompt into a fresh Claude Code conversation when:

- [ ] Commits A-D are on `origin/feat/multi-user-v1`
- [ ] `.github/workflows/rls.yml` run is green
- [ ] `supabase functions list` shows `provision-workspace`
- [ ] You can sign in as `smoke_admin` and see "Smoke Project" in the projects list
- [ ] JWT `app_metadata` contains the expected workspace_id + app_role

Session 3's first action will be the `ws_members_self_update` RLS policy, which unblocks NewUserWelcome for non-admin invited users. After that, email infra, PermissionGate, and the invite flow land.

---

**Reference paths:**
- Session 3 prompt: `docs/sessions/SESSION_03_prompt.md`
- Master plan: `C:\Users\Audrey\.claude\plans\curried-cooking-unicorn.md`
- Memory: `C:\Users\Audrey\.claude\projects\C--Users-Audrey-Documents-My-Work-Dev-Work-Claude-Work\memory\wilson_multi_user_plan.md`
