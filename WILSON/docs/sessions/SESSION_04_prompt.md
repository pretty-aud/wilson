# SESSION 4 launch prompt — Team Members + User Profile

> Paste into a new Claude Code conversation from the WILSON repo to start Session 4.
> Master plan: `C:\Users\Audrey\.claude\plans\curried-cooking-unicorn.md`.
> Session 3 handoff: `docs/sessions/SESSION_03_prompt.md` (prior deltas).
> **First tool call** per standing rule: `git status` on `feat/multi-user-v1`.

---

## Where Session 3 left the repo

Branch: **`feat/multi-user-v1`**. Session 3 landed in two commits:

- **`4ed1d9c` (Session 3a)** — issue-session ES256 fix, permissions framework, migration 0009 (self-RLS + bucket + atomic RPC), CI smoke-test guard.
- **`<latest>` (Session 3b)** — Resend SMTP config, email templates, invite-member Edge Function + UI, ForgotPasswordWizard, ResetPasswordWizard, Playwright skeleton + auth spec. *(commit this before starting Session 4 if not already.)*

### Migration history

| Version | File | Added in |
|---|---|---|
| 0000 | `rabbit_base_schema.sql` | Session 2 |
| 0001 | `workspaces_and_users.sql` | Session 1 |
| 0002 | `rls_workspaces.sql` | Session 1 |
| 0003 | `fix_access_token_hook.sql` | Session 1 |
| 0004 | `rls_rabbit.sql` | Session 2 |
| 0005 | `test_helpers.sql` | Session 2 |
| 0006 | `user_profile_fields.sql` | Session 2 |
| 0007 | `drop_public_users_fks.sql` | Session 2 |
| 0008 | `fix_rls_recursion.sql` | Session 2 |
| 0009 | `perms_and_provisioning.sql` | **Session 3** — ws_members self-update RLS + escalation-prevention trigger + user-avatars bucket + `provision_workspace_and_admin` RPC |

### Session 3 deliverables by area

| Block | Key files |
|---|---|
| issue-session ES256 fix | `supabase/functions/issue-session/index.ts`, `supabase/config.toml` (`verify_jwt = false`), `scripts/probes/issue-session.sh`, CI job in `.github/workflows/rls.yml` |
| Atomic provisioning | `supabase/migrations/0009_perms_and_provisioning.sql`, `supabase/functions/provision-workspace/index.ts` (now calls the RPC), `supabase/tests/rls/15_provision_rpc.sql` |
| Self-update RLS | `supabase/migrations/0009_perms_and_provisioning.sql`, `supabase/tests/rls/14_ws_members_self.sql` |
| User-avatars bucket | `supabase/migrations/0009_perms_and_provisioning.sql` (bucket + 4 storage policies) |
| Permissions framework | `src/permissions/{roleMatrix,usePermissions,PermissionGate,index}.{js,jsx}` |
| Email infrastructure | `supabase/config.toml` ([auth.email.template.*], [auth.email.smtp]), `supabase/templates/{invite,recovery,email_change}.html`, `src/tools/rabbit_v0.1.0/db/README.md` §6 |
| Invite flow | `supabase/functions/invite-member/index.ts`, `src/cloud/auth/InviteMemberDialog.jsx`, `src/components/TeamMembers/TeamMembersPage.jsx` (button + dialog wiring) |
| Forgot/Reset wizards | `src/cloud/auth/ForgotPasswordWizard.jsx`, `src/cloud/auth/ResetPasswordWizard.jsx`, `src/App.jsx` (authMode gate + hash detection), `src/cloud/auth/LoginScreen.jsx` (forgot-password link) |
| Playwright | `playwright.config.ts`, `tests/e2e/auth.spec.ts` (3 scenarios, not yet installed) |

## Must-do before writing code

1. **Resend configuration.** The SMTP creds + DNS records live outside the repo. Before invites/resets will actually deliver mail, complete §6 of `src/tools/rabbit_v0.1.0/db/README.md`: verify `mail.wilsonapp.com` on Resend, create an SMTP credential, paste it into Supabase Dashboard → Auth → SMTP Settings for each env, and upload the three templates from `supabase/templates/`. Session 3 staged the config but did **not** perform these external steps.
2. **GitHub repo secrets for the issue-session CI job.** Without these the `issue-session-smoke` job skips silently:
   - `DEV_SUPABASE_URL` = `https://eqjzmnvkrakroyqxfsvw.supabase.co`
   - `DEV_SUPABASE_ANON_KEY` = (from `.env.development`)
   - `DEV_PROBE_USERNAME` = `smoke_admin`
   - `DEV_PROBE_PASSWORD` = `SmokeTest2026!`
3. **Install Playwright.** `npm install -D @playwright/test && npx playwright install chromium`. The spec file exists; Session 4 should wire a CI job alongside the pgTAP one.
4. **Install Vitest.** Not yet present. `roleMatrix.js` has a placeholder comment pointing at a future unit suite. Session 4 (or whenever convenient) lands `vitest` + `src/permissions/roleMatrix.test.js` + a CI step.

## Known rough edges from Session 3

### Verified working on wilson-dev

- `issue-session` HTTP 200 with correct `workspace_id` (probe against seeded `smoke_admin`).
- `provision-workspace` calls the new RPC cleanly.
- `invite-member` deployed; **not smoke-tested end-to-end** without Resend SMTP. The DB-side path (admin check, membership insert, cleanup-on-failure) is covered by manual reasoning only.
- Migration 0009 applied; manual pgTAP run of 14 + 15 pending.

### Needs manual verification

- **Hash-based recovery routing.** `App.jsx` reads `window.location.hash` on first mount to decide if we're in the recovery flow. The Electron build uses `loadURL(file://…/index.html)` — confirm the recovery email's deep link (`http://localhost:5203/#/recovery#access_token=…`) actually reaches the renderer when the desktop app is open, or whether we need an Electron protocol handler. On web this works; on Electron it probably needs a `custom URL scheme` handler in Session 10's web-build work.
- **React 18 StrictMode re-mount behavior on the two new wizards.** They follow the AuthShell pattern (empty cleanup, phase/ref check inside timer callbacks), but the user-facing timer paths weren't exercised under StrictMode. Worth a quick `npm run dev` smoke before committing.
- **`storage.foldername` on the `user-avatars` policies.** Supabase's helper returns a `text[]` 1-indexed. The policies assume path `{workspace_id}/{user_id}/{filename}` → `[1]=workspace_id, [2]=user_id`. NewUserWelcome uploads match this. Any future caller that uses a different prefix will silently get rejected — document in §6 of db/README.

### Stale / opportunistic cleanup

- `public.users` remains empty and orphan after Session 2's migration 0007. Drop it in a Session 5-era migration once grep confirms no remaining references.
- `schema.sql` (standalone RABBIT installs) drifted from the migration chain in Session 2. Reconsider retiring it entirely; the multi-user flow is now the only supported path.
- `provision-workspace` still has an in-memory rate-limit bucket that resets on cold start. Session 3 kept it as-is (3/h/IP); swap to Upstash KV when we have real signup volume.
- `InviteMemberDialog.onInvited` is a no-op today because `useTeamMembers` tracks the RABBIT `team_members` entity, not `workspace_members`. Session 4 unifies these — at which point the dialog can push the new row straight into the list without a refetch.

## Session 4 goal

Team Members page becomes the single source of truth for workspace membership: three saved views (Admin / Manager / User), role-aware column visibility, inline role editing, rate-card management, and a profile editor that powers both Settings and the upcoming Dashboard.

### Scope (copied from master plan)

- Sweep `src/components/TeamMembers/TeamMembersPage.jsx` to read from `workspace_members` + `auth.users` joined (not the separate `team_members` RABBIT entity).
- Three role-based views: Admin (everything), Manager (hide rate cards), User (read-only self + teammates' non-sensitive fields).
- App-role dropdown per row, gated by `<PermissionGate requires="member.role.change">`.
- Rate-card view + edit with admin confirmation modal. Role matrix already has `rate_card.edit` / `rate_card.view` — wire the UI through them.
- "Projects assigned to" computed column (joined from RABBIT `project_members` — lands in Session 6, so this is a stub that reads empty for now OR a pre-fetched count).
- User profile editor (in Settings → Profile AND Dashboard). Avatar upload via the `user-avatars` bucket with the path layout already enforced by 0009's storage policies.
- Admins/Managers can edit other users' `title` + `department`; Users edit only their own non-restricted fields. The self-escalation trigger from 0009 already blocks `app_role` / `username` self-edits at the DB level; the UI just needs to disable the inputs.

### Non-goals for Session 4

- Edit history (Session 5).
- Project-level role gating (Session 6).
- Realtime collaboration (Session 7).
- Dashboard page itself (Session 8) — only the profile pane lives here.

### Exit criteria

- [ ] TeamMembersPage shows all `workspace_members` rows for the active workspace with RLS respected.
- [ ] App-role dropdown enforces `member.role.change` + blocks self-escalation via DB trigger (no client-side-only guard).
- [ ] Profile editor saves `display_name`, `pronouns`, `title`, `avatar_url` to `workspace_members` and pushes the new avatar to `user-avatars/{workspace_id}/{user_id}/…`.
- [ ] Admin → Manager → User views cover every field; non-admins never see rate-card columns.
- [ ] Vitest + at least one `roleMatrix.test.js` suite live in CI.
- [ ] Playwright installed; `auth.spec.ts` scenarios pass green.
- [ ] `docs/sessions/SESSION_05_prompt.md` drafted; `wilson_multi_user_plan.md` memory refreshed.

## Reminder

Per user's standing rule: **no code changes before branch is confirmed.** First tool call: `git status` on `feat/multi-user-v1`, verify clean, then read Session 3b's `<latest>` commit before starting.
