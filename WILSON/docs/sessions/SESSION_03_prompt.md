# SESSION 3 launch prompt — Permissions Framework + Email Infra

> Paste this into a new Claude Code conversation in the WILSON repo to begin Session 3.
> Master plan: `C:\Users\Audrey\.claude\plans\curried-cooking-unicorn.md`.
> Session 2 handoff: `docs/sessions/SESSION_02_prompt.md` (for context on what landed).
> Read the **Locked Decisions** and **Cross-Session Conventions** sections of the master plan first.

---

## Where Session 2 left the repo

Branch: **`feat/multi-user-v1`** — same branch every session lands on. Session 2 commits (not yet created at time of writing; user to commit):

| Block | Deliverable | Key files |
|---|---|---|
| 1 | RLS sweep migration | `supabase/migrations/0004_rls_rabbit.sql` (13 tables, hybrid denorm, full CRUD policies) |
| 1 | Test fixture helpers | `supabase/migrations/0005_test_helpers.sql` (`tests` schema + `rls_setup` / `login_as` / `logout`) |
| 2 | pgTAP RLS suite | `supabase/tests/rls/01_projects.sql` … `13_ingestion_chunks.sql` (53 tests) |
| 3 | CI workflow | `.github/workflows/rls.yml` (supabase CLI local DB + pg_prove + coverage guard) |
| 4 | Legacy fallback removal | `src/tools/rabbit_v0.1.0/adapters/supabaseAdapter.js`, `electron/preload.cjs`, `electron/main.cjs`, `src/tools/rabbit_v0.1.0/db/README.md` |
| 5 | Auth chrome primitive | `src/cloud/auth/AuthShell.jsx` (+ `AUTH_TEXT_STYLE`, `AuthCursor`) |
| 6 | Login rebuild + workspace chooser | `src/cloud/auth/LoginScreen.jsx`, `src/cloud/auth/WorkspaceSwitcher.jsx`, `src/components/SettingsPage.jsx` |
| 7 | New-company onboarding | `supabase/functions/provision-workspace/index.ts`, `src/cloud/onboarding/NewCompanyWizard.jsx`, `src/App.jsx` wiring |
| 8 | New-user welcome | `supabase/migrations/0006_user_profile_fields.sql`, `src/cloud/onboarding/NewUserWelcome.jsx`, `src/App.jsx` onboarding gate |
| 9 | Data migration tool | `src/cloud/migrate/runMigration.js`, `src/cloud/migrate/MigrationPanel.jsx`, `rabbit:archive-local-data` IPC |

## Known rough edges / Session 2 deltas

- **Storage bucket `user-avatars` does not exist yet.** NewUserWelcome uploads to `user-avatars/{workspace_id}/{user_id}/…`. Session 3 must either add a migration that runs `storage.create_bucket('user-avatars', true)` + a Storage RLS policy, or document it in the platform-operator runbook.
- **`workspace_members` self-update RLS is missing.** Current 0002 only grants `ws_members_admin_write`. NewUserWelcome relies on the authenticated user UPDATEing their own row; that works for the first admin (who gets 'admin' role) but non-admin invited users will be rejected. Session 3 must add `ws_members_self_update`:
  ```sql
  CREATE POLICY ws_members_self_update ON public.workspace_members
    FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid() AND workspace_id = public.current_workspace_id());
  ```
- **`provision-workspace` is non-atomic.** Three sequential steps (workspace insert → auth user → membership) with best-effort cleanup on partial failure. Session 3 should replace with a PL/pgSQL `provision_workspace_and_admin(...)` RPC using a single transaction, called from the Edge Function instead of three admin.* calls.
- **Multi-workspace login ordering.** `LoginScreen`'s workspace chooser queries `public.workspaces` post-signIn. If RLS is misconfigured (no 0002 policies applied), the list returns empty and the chooser silently falls through to the single-workspace path. The Session 2 smoke test must include a multi-workspace user.
- **Preview tooling port mismatch.** `vite.config.js` pins port 5203 (Supabase `config.toml` redirect URLs key off it), but Claude's preview tool defaults to 5173. `.claude/launch.json` stays at 5173 so the preview tool doesn't break; manual Electron run via `npm run dev` renders on 5203 as intended.

## Session 3 goal

Every permission decision in the app runs through a single `<PermissionGate>` primitive driven by the JWT's `app_role`. Emails actually get sent. Invites + password resets flow end-to-end.

### Scope checklist

1. **PermissionGate component** at `src/permissions/PermissionGate.jsx`. Props: `{ requires: 'admin' | 'manager' | 'user' | 'platform_operator', fallback?, children }`. Reads `app_role` from the JWT via a shared `usePermissions()` hook. Drop-in replacement for `{isAdmin && <Button/>}` patterns scattered across the app.
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
