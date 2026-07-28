# SESSION 5 launch prompt — Edit History (no revert)

> Paste into a new Claude Code conversation from the WILSON repo to start Session 5.
> Session 4 handoff: `docs/sessions/SESSION_04_prompt.md` (prior deltas).
> **First tool call** per standing rule: `git status` on `feat/multi-user-v1`.

---

## Where Session 4 left the repo

Branch: **`feat/multi-user-v1`**. Session 4 landed in two commits:

- **`76536e8`** — docs: Resend domain swap to `mail.petalstudios.co` + pre-session completions.
- **`163892d`** — Team Members on `workspace_members` + profile editor (full session).

### Migration history

| Version | File | Added in |
|---|---|---|
| 0000–0009 | (unchanged — see SESSION_04_prompt.md) | Sessions 1–3 |
| 0010 | `member_directory.sql` | **Session 4** — `workspace_members.department`, manager title/department write policy, extended guard trigger (self-reactivation block + inactive-caller check), `workspace_directory()` RPC |

### Session 4 deliverables by area

| Block | Key files |
|---|---|
| Member directory RPC + manager scope | `supabase/migrations/0010_member_directory.sql`, `supabase/tests/rls/16_member_directory.sql` (12 probes), `src/tools/rabbit_v0.1.0/db/README.md` §9 |
| Team Members rework | `src/components/TeamMembers/TeamMembersPage.jsx` (rewritten), `src/components/TeamMembers/useWorkspaceMembers.js` (new hook; also exports `isOwnAvatarUrl`) |
| Rate columns + confirm modal | TeamMembersPage (RateCardEditorModal), `src/components/RateCard/useRateCard.js` (stale-guard + surfaced auto-create errors) |
| Profile editor | `src/components/settings/ProfileSection.jsx` (new), `src/components/SettingsPage.jsx` (Profile tab) — self-contained; Session 8's Dashboard mounts the same component |
| Permissions | `src/permissions/roleMatrix.js` (+`member.profile.edit_others`: admin+manager), `src/permissions/roleMatrix.test.js` (39 tests) |
| Invite flow polish | `src/cloud/auth/InviteMemberDialog.jsx` (passes typed display_name through `onInvited`); TeamMembersPage injects the row without refetch |
| Test infra | `vitest.config.js`, `package.json` (test/test:watch/test:e2e), `playwright.config.ts` (webServer, 60s timeout, actionTimeout), `tests/e2e/auth.spec.ts` (fixed selectors; scenario 1 asserts the member directory) |
| CI | `.github/workflows/rls.yml` — new `unit` (Vitest) + `e2e-auth` (Playwright vs wilson-dev, `PLAYWRIGHT_SKIP_EMAIL=1`, reuses the 4 `DEV_*` secrets) jobs |

### Verified working (2026-07-28)

- Migration 0010 applied to **wilson-dev**; `workspace_directory()` probed via REST (admin sees emails, `department` present).
- Playwright scenario 1 green locally (sign-in → Resources → Team Members → RLS-scoped roster row visible). Scenarios 2–3 skip without mailpit.
- Vitest 39/39; `vite build` green; browser-verified: three views show exactly the specced column sets; Profile tab locked fields; profile save + revert round-trip through self-update RLS.
- **StrictMode fix**: the `mountedRef` pattern in `useTeamMembers` / `useRateCard` / `useWorkspaceMembers` stranded `false` after StrictMode's remount → perpetual "Loading…" in dev. Effect bodies now reset the flag. If you write a hook with a mounted ref, copy the fixed pattern.

## Must-do before writing code

1. **Check the first CI run of `163892d`** (Actions tab): pgTAP now includes `16_member_directory.sql` (12 probes) — it has NOT run locally (no Docker on this machine). Also confirm the new `unit` + `e2e-auth` jobs pass; `e2e-auth` is the first CI Playwright run ever.
2. **Deploy 0010 to staging + prod.** Only wilson-dev has it. Same recipe as SESSION_03_TO_04_CHECKLIST §2 (`supabase link` → `supabase db push --linked` for `rzkirvkotslbovzbsdfh` then `rqyriuyldhovirbuievt`; re-link to wilson-dev after). No new Edge Functions this session.

## Known rough edges from Session 4 (review findings deliberately deferred)

- **Internal rate-card RLS is workspace-scoped, not role-scoped.** In supabase adapter mode ANY member can `SELECT` `rate_card_entries` (per-person wages) directly — 0004's policies predate roles. The UI now avoids fetching them for non-admins, but that is not enforcement. Candidate: a 0011-era policy gating `rate_cards`/`rate_card_entries` reads on `current_app_role()` (check RateCardPage's manager use of the General card before locking down).
- **Deactivated members with live tokens.** RLS trusts JWT claims (0008 recursion constraint). 0010's trigger now blocks manager writes and self-reactivation for inactive callers, but a deactivated ADMIN claim-holder can still write until the token expires. Real fix is session revocation on deactivate — Session 9 (admin terminal + MFA) territory.
- **Admins may self-change `app_role`/`username` at the DB level** (0009's deliberate admin bypass; UI disables it). Consider last-admin-standing protection when edit-history lands.
- **Rate entries written from TeamMembersPage use `member_id = auth user_id`.** Legacy RABBIT team-member ids won't match — they appear as orphan rows on RateCardPage's internal card until Session 6 unifies project/team identity.
- **`public.users` drop + `schema.sql` retirement** still pending from the Session 3 handoff — this is the "Session 5-era migration" to fold in if convenient.

## Session 5 goal (from master plan)

**Edit History (no revert).** RABBIT-only edit history with 90-day retention (locked decision). Capture who/what/when for RABBIT entity mutations into an append-only history table (workspace-scoped RLS, admin+manager read), a per-entity history drawer in the RABBIT views, and a retention sweep. Revert/undo is explicitly OUT (revert-to-state arrives with Realtime in Session 7).

### Suggested shape (verify against master plan before committing to it)

- Migration 0011: `edit_history` table (`workspace_id`, `entity_type`, `entity_id`, `actor_user_id`, `action`, `diff jsonb`, `created_at`) + RLS + indexes + 90-day purge function (pg_cron if available, else a cleanup Edge Function).
- Capture path: DB triggers on the 13 RABBIT tables (survives every client) vs. adapter-layer logging (works for local_server too). Decide early — TPN auditability favors DB triggers for cloud, adapter hook for local parity.
- UI: history drawer component in RABBIT (probably `src/tools/rabbit_v0.1.0/components/`), gated `atLeast('manager')`.
- Workspace_members changes (role flips, deactivations) are prime audit candidates — decide whether membership history is in-scope now or waits for Session 9's admin terminal.

### Non-goals

- Revert / undo from history (Session 7).
- Project-level role gating (Session 6).
- Dashboard (Session 8).

### Exit criteria

- [ ] Every RABBIT mutation in supabase mode writes an `edit_history` row with actor + diff.
- [ ] History rows are RLS-scoped to the workspace; users below manager cannot read them.
- [ ] 90-day retention enforced by an automated sweep, with a pgTAP test.
- [ ] History drawer visible in at least Assets + Tasks views.
- [ ] CI green (pgTAP incl. new history tests, Vitest, Playwright).
- [ ] `docs/sessions/SESSION_06_prompt.md` drafted; `wilson_multi_user_plan.md` memory refreshed.

## Token discipline (standing rule from Session 4)

Session 4's review workflow burned ~3.2M subagent tokens and hit the session cap twice. Rules for this and every future session:

- **Hard cap: no more than 15 agents at once** (one workflow's total agent count included — size fan-outs accordingly).
- Finders must paste the relevant code excerpts INTO their findings so verifiers don't independently re-read the diff/repo (~100k tokens per agent otherwise).
- **Never resume a workflow whose early stages are nondeterministic fan-outs** — resume caching is call-order-prefix based and pipeline interleaving breaks it, silently re-running everything. Salvage completed results from the output file/journal and verify stragglers inline instead.
- Prefer inline verification by the main session (code already in context) over spawning verify agents when there are only a handful of claims.

## Reminder

Per the standing rule: **no code changes before branch is confirmed.** First tool call: `git status` on `feat/multi-user-v1`, verify clean, then read `163892d` before starting.
