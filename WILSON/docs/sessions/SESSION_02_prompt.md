# SESSION 2 launch prompt — RLS Lockdown + Data Migration + Onboarding Wizards

> Paste this into a new Claude Code conversation in the WILSON repo to begin Session 2.
> The master plan lives at `C:\Users\Audrey\.claude\plans\curried-cooking-unicorn.md`.
> Read the **Locked Decisions** and **Cross-Session Conventions** sections first — they do not change.

---

## Where Session 1 left the repo

Branch: **`feat/multi-user-v1`** (cut from `feature/finder-column-resources` after two cleanup commits).

Landed in Session 1 (three commits):
1. `d4c256f` — scaffolding: supabase/migrations + functions + src/cloud/auth/ + electron/env.cjs + .env.example
2. `c0fc59f` — wiring: Sentry, safeStorage session IPC, LoginScreen swapped into App.jsx, supabaseAdapter.js prefers authenticated client, audit columns appended to RABBIT schema.sql, @sentry/electron in deps
3. Follow-up commits with verification fixes if any

Vertical-slice test (must pass before Session 2 starts):
- log in as a seeded user → exactly one project visible in ProjectListPanel
- manually-tampered JWT (swapped workspace_id) → Supabase rejects (RLS enforces against the real JWT, not client state)
- renderer + main-process test exceptions visible in Sentry
- resolver rate-limit trips after 5 req/min/IP with `curl`

## Known rough edges / plan deltas from Session 1

- **PITR deferred.** `wilson-prod` is on Free tier; PITR costs +$100/mo. Session 9 adds a nightly `pg_dump` to Backblaze B2 + documented restore runbook. TPN TS-2.x still passes with documented, tested backups. Remove PITR from the Session 1 verification list permanently.
- **Legacy `supabase.json` adapter fallback still present.** `src/tools/rabbit_v0.1.0/adapters/supabaseAdapter.js` falls back to the old per-project `supabase.json` if no authenticated session — Session 2 removes this fallback.
- **Single-workspace-only login in v1.** `LoginScreen` does not yet surface a workspace picker on multi-workspace users; resolver returns "not found" when the match is ambiguous. Session 2 adds the "Switch workspace" UI and the multi-workspace chooser.

## Session 2 goal

Every RABBIT table has RLS locked down, an RLS test suite runs in CI, single-user local data can be migrated into a workspace, and a new company can self-serve onboarding.

### Scope checklist

1. **Full RLS sweep of `src/tools/rabbit_v0.1.0/db/schema.sql`.** For every table listed below:
   - Add `workspace_id UUID NOT NULL REFERENCES public.workspaces(id)` (and index on it) — most tables already carry one; a few ingestion/comment tables may not.
   - Enable RLS + FORCE RLS.
   - Write SELECT/INSERT/UPDATE/DELETE policies. Reads = `workspace_id = current_workspace_id()`. Writes also require an active membership row.
   - Write one pgTAP test per table covering: cross-tenant SELECT denied, cross-tenant UPDATE denied, same-tenant SELECT allowed, audit column auto-populates.

   Tables in scope: `projects, phases, assets, tasks, files, asset_versions, comments, task_dependencies, task_links, rate_cards, rate_card_entries, ingestion_runs, ingestion_chunks`.

2. **CI for RLS tests.** GitHub Actions workflow at `.github/workflows/rls.yml` that runs pgTAP against `wilson-dev` on every push to `feat/*` branches. New table without an RLS test file **fails CI**. See Supabase pgTAP docs.

3. **Remove the legacy `supabase.json` fallback** in `supabaseAdapter.js`. Every code path now goes through the authenticated shared client. Delete the Settings UI for per-project Supabase credentials (or gate it behind a "legacy" flag).

4. **Data migration tool** at `src/cloud/migrate/` + an Electron IPC entry point. Reads existing IndexedDB (projects + rabbit-data JSON on disk) → asks user to pick a target workspace (or create one) → POSTs via authenticated client. Idempotent, resumable, with a dry-run flag. Surfaces a "Migrate to cloud" button on the Rabbit Settings panel.

5. **New Company Setup wizard** at `src/cloud/onboarding/NewCompanyWizard.jsx`. Form: company name + slug (validated) + admin profile (display_name, username, email) → calls a new Edge Function `provision-workspace` (service_role) → creates workspace + auth user + admin workspace_member → redirects to login.

6. **New User Welcome flow** after admin-initiated invite (one-time password flow lands in Session 3). Wizard captures display_name, pronouns, title, avatar. Persists into `workspace_members` + uploads avatar to Supabase Storage.

7. **"Switch workspace" UI.** When `workspace_ids` on the JWT has more than one entry, show a chooser in the Settings → General tab. Calls `issue-session` with the chosen id; refreshSession picks up the new workspace.

### Non-goals for Session 2

- Email infra (Session 3).
- PermissionGate component / app-role visibility rules (Session 3).
- Project-role permissions (Session 6).
- Realtime subscriptions (Session 7).

### Exit criteria

- [ ] pgTAP suite runs green in CI for every RABBIT table
- [ ] Cross-workspace SELECT probe fails at the DB (not the UI) for every table
- [ ] IndexedDB migration dry-run on a real user's data produces a clean diff report
- [ ] New Company wizard provisions a workspace + admin in < 30 seconds
- [ ] Multi-workspace user can switch workspaces via Settings
- [ ] `docs/sessions/SESSION_03_prompt.md` written with any deltas
- [ ] `wilson_multi_user_plan.md` memory updated

## Reminder

Per user's standing rule: **no code changes before branch is confirmed.** First tool call in Session 2 should be `git status` on `feat/multi-user-v1`, then start real work.
