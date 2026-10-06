# SESSION 3 launch prompt — Permissions Framework + Email Infra

> Paste this into a new Claude Code conversation in the WILSON repo to begin Session 3.
> Master plan: `C:\Users\Audrey\.claude\plans\curried-cooking-unicorn.md`.
> Session 2 handoff: `docs/sessions/SESSION_02_prompt.md` (for context on what landed).
> Read the **Locked Decisions** and **Cross-Session Conventions** sections of the master plan first.

---

## Where Session 2 left the repo

Branch: **`feat/multi-user-v1`** — same branch every session lands on. Pushed through `ce4487e`. All 8 migrations applied to `wilson-dev`; CI RLS suite green; smoke test passed end-to-end (sign-in → Smoke Project visible → Supabase Connected).

**Migration history on `wilson-dev`:**

| Version | File | Purpose |
|---|---|---|
| 0000 | `rabbit_base_schema.sql` | Promoted from `src/tools/rabbit_v0.1.0/db/schema.sql` so fresh DBs get RABBIT tables before 0004's ALTERs |
| 0001 | `workspaces_and_users.sql` | Session 1 — workspaces / workspace_members / platform_operators / custom_access_token_hook |
| 0002 | `rls_workspaces.sql` | Session 1 — RLS bootstrap for workspaces + workspace_members |
| 0003 | `fix_access_token_hook.sql` | Session 1 hotfix — rename uid var in hook |
| 0004 | `rls_rabbit.sql` | RLS sweep of 13 RABBIT tables + audit-column ALTERs (added during smoke test when trigger hit missing columns) |
| 0005 | `test_helpers.sql` | `tests` schema with pgTAP fixtures |
| 0006 | `user_profile_fields.sql` | pronouns / title / avatar_url / onboarded_at on workspace_members |
| 0007 | `drop_public_users_fks.sql` | Drops orphan FKs on projects.created_by / tasks.assigned_user_id / comments.author_user_id that targeted the legacy public.users table |
| 0008 | `fix_rls_recursion.sql` | `current_app_role()` helper + SECURITY DEFINER on `has_active_membership` + rewrite `ws_members_admin_write` to read JWT role instead of self-querying workspace_members |

**Other Session 2 deliverables:**

| Block | Key files |
|---|---|
| Legacy fallback removal | `src/tools/rabbit_v0.1.0/adapters/supabaseAdapter.js`, `electron/preload.cjs`, `electron/main.cjs`, `src/tools/rabbit_v0.1.0/db/README.md` |
| Auth chrome primitive | `src/cloud/auth/AuthShell.jsx` (+ `AUTH_TEXT_STYLE`; the `AuthCursor` glyph is defined but no longer used by LoginScreen — retained for wizard reuse) |
| Login rebuild + workspace chooser | `src/cloud/auth/LoginScreen.jsx` (single-form), `src/cloud/auth/WorkspaceSwitcher.jsx`, Settings integration |
| New-company onboarding | `supabase/functions/provision-workspace/index.ts`, `src/cloud/onboarding/NewCompanyWizard.jsx`, `src/App.jsx` wiring |
| New-user welcome | `src/cloud/onboarding/NewUserWelcome.jsx`, `src/App.jsx` onboarding gate |
| Data migration tool | `src/cloud/migrate/runMigration.js`, `src/cloud/migrate/MigrationPanel.jsx`, `rabbit:archive-local-data` IPC |
| CI workflow | `.github/workflows/rls.yml` at repo root (note: WILSON app lives in `WILSON/` subdir; workflow uses `defaults.run.working-directory: WILSON`) |
| Electron webPreferences | `autoplayPolicy: 'no-user-gesture-required'` so the startup chime plays without a user gesture |
| RabbitProvider auth listener | Subscribes to `supabase.auth.onAuthStateChange` to re-poll adapter status on SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT — otherwise the bootstrap status check runs pre-sign-in and never refreshes |

## Known rough edges / Session 2 deltas

### Critical — blocks a Session 3 scope item

- **`issue-session` Edge Function returns 401 on every call** (discovered during Session 2 smoke test). Inside the function, `userClient.auth.getUser()` rejects the fresh JWT that `signInWithPassword` just minted — the token works against PostgREST (RLS queries succeed) and against `refreshSession`, but not against GoTrue's `/user` endpoint from inside the Edge runtime. Session 2 worked around it by skipping `issue-session` entirely for single-workspace users (the `custom_access_token_hook` had already baked the right `workspace_id` into the token). **But the multi-workspace chooser path in `LoginScreen.jsx` still calls `issueSession(...)` when the user picks a workspace** — that path will hang or error today. Session 3 MUST diagnose and fix before the multi-workspace flow is real. Candidates to check: JWT signing key env in the Edge Function, `auth.verify_jwt` RLS on the `/user` endpoint, whether the hook is producing a claim shape GoTrue rejects.

### Must fix before / during Session 3

- **Storage bucket `user-avatars` does not exist yet.** NewUserWelcome uploads to `user-avatars/{workspace_id}/{user_id}/…`. Session 3 must either add a migration that runs `storage.create_bucket('user-avatars', true)` + a Storage RLS policy, or document it in the platform-operator runbook.
- **`workspace_members` self-update RLS is missing.** Current 0002 only grants `ws_members_admin_write`. NewUserWelcome relies on the authenticated user UPDATEing their own row; works for the first admin (app_role='admin') but non-admin invited users will be rejected. Session 3 must add `ws_members_self_update`:
  ```sql
  CREATE POLICY ws_members_self_update ON public.workspace_members
    FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid() AND workspace_id = public.current_workspace_id());
  ```
  Also add `ws_members_self_select` so invited users can read their own row pre-onboarding.
- **`provision-workspace` is non-atomic.** Three sequential steps (workspace insert → auth user → membership) with best-effort rollback on partial failure. Session 3 should replace with a PL/pgSQL `provision_workspace_and_admin(...)` function called via a single `rpc` from the Edge Function.

### Known traps to avoid

- **React 18 StrictMode deadlock in timer-based effects.** AuthShell had three effects that got stuck on the pattern `ref guard + clearTimeout cleanup` — StrictMode simulates setup→cleanup→setup on mount, so the cleanup cancels the first-run timers and the second run early-returns on the guard. Fix: either drop the guard OR use an empty cleanup and rely on a phase/ref check inside the timer callback. Session 3's `ForgotPasswordWizard` / `ResetPasswordWizard` will have the same pitfall — follow the pattern already established in AuthShell's `logo-in`, `split→notify`, and `revealing` effects.
- **Bootstrap-once providers miss the sign-in event.** `RabbitProvider`'s initial adapter-status check ran pre-sign-in and never refreshed; users saw "Offline — no active session" after a successful login. Fixed by subscribing to `supabase.auth.onAuthStateChange` and re-polling on SIGNED_IN / TOKEN_REFRESHED. Session 3's PermissionGate / `usePermissions` hook should follow the same pattern (listen for TOKEN_REFRESHED so role changes propagate without a reload).
- **`issue-session` is redundant for single-workspace users.** The `custom_access_token_hook` already sets `workspace_id` in `app_metadata` on every token issuance. Only call `issueSession` when the user is explicitly switching workspaces via the chooser. LoginScreen's `completeSignIn` now gates on `workspaceId != null` to respect this — preserve that behavior when fixing issue #1 above.

### Schema housekeeping (opportunistic)

- **`public.users` is now orphaned.** Migration 0007 dropped the three FKs that pointed to it; the table is empty on every environment. Retire it with a drop-table migration once no other code path references it (grep for `public.users` outside `schema.sql` and auth.users).
- **`schema.sql` and `0000_rabbit_base_schema.sql` must stay in sync.** `schema.sql` is retained for standalone RABBIT installs (Express test harness). If Session 3 adds a column to either, mirror it in the other, or retire `schema.sql` entirely if the standalone path is no longer needed.

### Cosmetic / low priority

- **Preview tooling port mismatch.** `vite.config.js` pins port 5203 (Supabase `config.toml` redirect URLs key off it). Claude's preview tool defaults to 5173. `.claude/launch.json` stays at 5173 so the tool's cache doesn't block new sessions; Electron loads from 5203 at runtime.
- **`AuthCursor` glyph is unused.** LoginScreen dropped it in favour of the native white caret. Still exported from AuthShell for potential wizard reuse — can be removed if Session 3's wizards don't want it.

## Session 3 goal

Every permission decision in the app runs through a single `<PermissionGate>` primitive driven by the JWT's `app_role`. Emails actually get sent. Invites + password resets flow end-to-end.

### Scope checklist

0. **Fix `issue-session` 401.** Must land first — several Session 3 flows (workspace switching, possibly the invite hand-off) call through this function. Diagnose the getUser() failure (likely Edge Function JWT verification config or hook-claim mismatch), restore issue-session for single-workspace users in `LoginScreen.completeSignIn`, then land a pgTAP or curl-based smoke test in CI so it can't regress silently.

1. **PermissionGate component** at `src/permissions/PermissionGate.jsx`. Props: `{ requires: 'admin' | 'manager' | 'user' | 'platform_operator', fallback?, children }`. Reads `app_role` from the JWT via a shared `usePermissions()` hook that subscribes to `onAuthStateChange` so TOKEN_REFRESHED propagates without a reload. Drop-in replacement for `{isAdmin && <Button/>}` patterns scattered across the app.
2. **Role matrix** at `src/permissions/roleMatrix.js`. Exports `can(role, action) -> boolean` covering: `project.create`, `member.invite`, `member.remove`, `rate_card.edit`, `workspace.settings.read`, `workspace.settings.write`, `platform.operator.*`.
3. **`workspace_members` self-update RLS policy** — see rough edges above. Also add `ws_members_self_select` so invited users can read their own row before onboarding.
4. **Email infrastructure.** Supabase Auth SMTP config in `supabase/config.toml` + secret refs. Three templates:
   - Invite email (admin invites new member → one-time password link)
   - Password reset (forgot-password flow)
   - Email change confirmation
   Document the SMTP provider choice (Postmark / Resend / SES) in `db/README.md` §6.
4. **Invite flow**:
   - Edge Function `invite-member` (admin-only): creates auth user with random password, creates workspace_members row with `onboarded_at=null`, triggers invite email.
   - Admin UI in TeamMembersPage: "Invite new member" button → form → calls invite-member.
   - Invited user clicks email link → Supabase Auth `recovery` flow → sets password → lands on LoginScreen pre-filled → first login triggers NewUserWelcome (already in place from Session 2).
5. **Forgot password wizard** at `src/cloud/auth/ForgotPasswordWizard.jsx` on `AuthShell`. Triggered from LoginScreen via a "forgot password?" link on the password stage. Calls `supabase.auth.resetPasswordForEmail`.
6. **Reset password wizard** at `src/cloud/auth/ResetPasswordWizard.jsx`. Mounted when the URL contains a recovery token (Supabase's recovery flow). Captures new password, calls `updateUser({ password })`, then routes to LoginScreen.
7. **Atomic `provision-workspace` RPC.** Migration 0007 adds `provision_workspace_and_admin(...)` PL/pgSQL function. Edge Function refactored to call the RPC in one transaction.
8. **`user-avatars` Storage bucket**. Migration or seed script to `storage.create_bucket('user-avatars', true)` with an RLS policy allowing authenticated users to upload only under `{their user_id}/…` prefixes.
9. **Playwright auth + permissions test suite** at `tests/e2e/auth.spec.ts`. Three scenarios minimum: resolve-login + signIn + RLS-filtered project list; admin invite → invited user onboarding; forgot-password → reset-password. Runs on `wilson-dev` in CI.

### Non-goals for Session 3

- Project-role permissions (Session 6).
- MFA enrollment (Session 9).
- Realtime subscriptions (Session 7).
- Web build (Session 10).

### Exit criteria

- [ ] `issue-session` returns 200 on a valid JWT; CI guard in place so the next 401 regression fails a push
- [ ] `<PermissionGate>` wraps every privileged UI affordance in SettingsPage, TeamMembersPage, Rabbit Settings
- [ ] Invited user can complete the end-to-end invite → set-password → onboard → sign-in flow
- [ ] Forgot-password delivers a working reset link via the configured SMTP provider
- [ ] `workspace_members` self-update + self-select policies are live and covered by pgTAP
- [ ] `provision-workspace` writes via a single transactional RPC
- [ ] `user-avatars` bucket exists in `wilson-dev` + `wilson-staging` with RLS enforced
- [ ] `docs/sessions/SESSION_04_prompt.md` written with deltas
- [ ] `wilson_multi_user_plan.md` memory updated

## Reminder

Per user's standing rule: **no code changes before branch is confirmed.** First tool call in Session 3 should be `git status` on `feat/multi-user-v1`, then start real work.
