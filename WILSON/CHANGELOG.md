# Changelog

All notable changes to WILSON are recorded here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file starts at 1.0.0. Everything before it shipped as the 0.x single-user desktop app and was never changelogged.

---

## [1.0.0] — 2026-07-30

### The 1.0.0 story

0.6.3 was a single-user Electron app: one shared password checked against a hardcoded string, every user's data on their own disk, and an Anthropic API key sitting in `localStorage` on every client.

1.0.0 is a multi-tenant platform. A company is a **workspace**, and **Postgres Row-Level Security is the security boundary** — not the client, not the Edge Functions. Every tenant-scoped table is policy-gated, either on its own `workspace_id` or through a live-parent join for child tables that carry none. Sign-in is username-first; TOTP is available to everyone, becomes a challenge stage once a factor is verified, and is mandatory on the operator console. The Anthropic key never reaches a client on either host, and each company can bring its own. There is a platform operator console for Petal Studios, four append-only audit streams, real-time collaborative editing across R.A.B.B.I.T., and the whole thing now runs on the web as well as the desktop.

Tools in this release: D.O.G. 0.514, O.T.T.E.R. 0.3.1, R.A.B.B.I.T. 0.1.0. Database at migration 0030; twelve Edge Functions across three environments.

---

### Added

**Tenancy and authority**

- **Workspaces.** A workspace is a company. Membership is a `workspace_members` row carrying a per-workspace username, app role and rate-card grants. A user can belong to several and switch between them.
- **Four tiers of authority:** `user` → `manager` (bypasses project-level gating, reads rate cards, views change requests without deciding) → `admin` (Admin Terminal, roster, grants, company-standard courses, project delete) → **platform operator** (cross-tenant, separate surface).
- **Project roles inside R.A.B.B.I.T.** — `manager` / `reviewer` / `member`, orthogonal to app roles, gating writes at the project level. Producers and Creative Directors are auto-staffed as project managers (see *Changed* for what that does to access).
- **RLS as the boundary.** Every tenant-scoped table is policy-gated; reads may trust the JWT claim, but **anything that acts re-checks a live database row**. Some tables deviate on purpose: `notes`, `note_subjects` and `otter_progress` add `owner_id = auth.uid()` with no admin bypass, and `workspace_ai_keys`, `edge_rate_limits` and `storage_gc_queue` carry no policies at all, so nothing but the service role reaches them. Pinned by pgTAP suites in CI.

**Accounts, sign-in and onboarding**

- **Username-first login.** You type a workspace username, not an email; a constant-time server-side resolver finds the account. Multiple memberships get a workspace chooser.
- **TOTP multi-factor.** Enrol and manage in Settings → Profile. Enrolment is optional for ordinary users, and the login MFA stage fires only once an account has a verified factor. It is **required** for the operator console and enforced as a step-up on privileged admin actions.
- **Show-once credentials.** New users get a copyable username + password panel shown exactly once at creation, plus admin-initiated resets.
- **Invite, forgot-password and reset wizards**, with mail delivered through Resend.
- **New Company wizard** (company → profile → team → submit, creating several users at once) and a **New User welcome** flow (display name, pronouns, title, avatar).

**Company Admin Terminal** (admins only)

- **Users** — roster, role dropdown, rate-card view/edit grant toggles with confirms, MFA and last-sign-in lookup, show-once reset, deactivate/reactivate with a last-admin guard, and Add People (invite or create-with-password).
- **Company** — workspace name/slug/id, live member counts, departments editor, and **Workspace Takeout**.
- **Requests** — the O.T.T.E.R. change-request review queue.
- **Logs** — System (`app_events`) and Activity (`edit_history`) with filters and expandable context.
- **Diagnostics** — build/env block, live adapter and realtime status, the WIL-#### error-code reference, test event, test Sentry exception, and **Storage Cleanup**.

**Platform operator console (`/wilsonadmin`)**

- Its own build target and its own React root — not a page inside the app, and **never built into the Electron installer**.
- Sign-in is email + password + **TOTP**, because an operator has no company to resolve a username against.
- **Sessions are isolated from the app** on the same origin by a build-time surface define that picks a distinct session key, so signing out of one no longer signs you out of the other.
- **Companies**: list, create, rename, suspend, restore, and **teardown** — snapshot → typed-slug confirm → paged blob sweep → delete with a certificate at every step.
- **Per-company Anthropic keys**: set and clear, validated against Anthropic before storage, stored as AES-256-GCM ciphertext, never readable back (you get a four-character hint).
- **Audit**: `platform_audit`, append-only, with no workspace foreign key so teardown certificates outlive the tenant they describe.
- **Granting the operator tier is SQL-only, by design.** There is no endpoint, no component and no UI on any surface. The console can destroy companies, so the one thing it must not be able to do is mint more operators — the highest privilege in the system cannot be escalated from a web session even by someone already holding it. Bootstrapping an environment costs one `INSERT` in the SQL editor (`docs/OWED_AUDREY.md` §9B).

**Real-time collaboration (R.A.B.B.I.T.)**

- **Live sync** over broadcast-from-database on two channels: a project channel and a workspace channel.
- **Presence** — avatar chips and a LIVE pill showing who else is in the project.
- **Last-writer-wins merge, per field.** Fields with an in-flight local write keep the local value; everything else takes the incoming row, with a stale guard on `updated_at`.
- **Edit history with revert.** Append-only diff rows captured on 13 tables, browsable in a drawer by managers and above — members below manager write history but cannot read it. Revert-to-state on projects, phases, assets and tasks. 90-day retention.
- **Soft delete with undo.** Delete gives you an undo toast; the row sits in a 30-day trash before purge, cascading each subtree.

**Rate cards**

- **Rate cards are workspace-scoped**, with a `general` and an `internal` card auto-created per workspace. An entry's total is `wage + burden + overhead`, each a row-level percent or fixed amount or a department default.
- **Access is the role matrix OR a live per-user grant** on the member's own row — fetched fresh rather than carried in the JWT, so a revoke bites immediately, and refreshed over the workspace channel.
- **A view-only grant renders the card read-only rather than empty**, so an RLS-scoped empty table can never masquerade as "no data".

**Personal Dashboard**

- **My Tasks** — cross-project assignments as table, kanban or gallery, sharing the same detail popup as R.A.B.B.I.T.
- **Notes** — rich text on TipTap, the one Yjs surface in the product. Owner-only with **no admin bypass**, never broadcast, excluded from exports. Multi-device safety comes from snapshot-merge-write with a version guard, not live sync.
- **Profile** — the same profile and avatar editor Settings uses.

**O.T.T.E.R. cloud content**

- **Three visibility tiers**: `personal` (owner only, no admin bypass), `shared` (every active member), `company_standard` (admin-set, at most one per topic). Content is never visible across companies.
- Sharing, per-course **editor grants**, admin set/clear of company standard, and a metadata-only index so admins can see that a private course *exists* without reading it.
- **Fork on use** — opening a company-standard course gives you a personal copy, so the official version stays pristine and admin edits never change a course underneath someone mid-study.
- **The change-request loop.** Submit a change against the standard; a decider approves, declines with a required note, or asks for changes. **Approval applies the change** — it archives the target to a private snapshot owned by the approver, then merges the proposer's **subjects** additively: update by slug in place, insert when absent, never delete. It moves subjects only; the five reference documents (hotkeys, functions, nodes, reference URLs, corrections) are deliberately left untouched, and the approve dialog says so. Declining can be accepted or revised and resubmitted, with a revision counter.
- **The consented review window** — submitting grants reviewers read access to your own source course, opening on submit and closing the moment the request settles.
- **Requests view inside O.T.T.E.R.**, serving three audiences by capability: deciders get the approve/decline queue with live diff counts, managers a read-only queue, proposers their own requests with the reviewer's note verbatim.
- **Trash and restore** as a filter state, with a 30-day purge.

**AI access**

- **Every Anthropic call now rides the `ai-proxy` Edge Function**, on both hosts, with no direct-to-Anthropic fallback anywhere.
- **Per-workspace key with a platform fallback.** A tenant key is a billing preference, not an authorization boundary.
- Always-streaming upstream with a client-side reassembler, so long O.T.T.E.R. generations no longer die on the Edge response deadline.
- Per-workspace rate limiting and usage telemetry (`WIL-6001` / `WIL-6002`, with model, tool, token counts and which key was used) into the Admin Terminal log stream.

**The web build**

- All three tools, the Dashboard, Projects, Rate Card, Team Members, Settings, Help and the Admin Terminal run in a browser at **`https://beta.petalstudios.co/wilson`** (staging-backed, auto-deploying from `feat/multi-user-v1`).
- Deep links and back/forward work — every page has a path, synced to the shell without a router rewrite.
- Web sessions persist across reloads and survive token refresh.

**Files and storage**

- **Three storage providers**: local / local server, Supabase Storage (the private `rabbit-files` bucket, the only web-capable one), and read-only Google Drive. Connections configured per company in Settings.
- **Relink**, modelled on ShotGrid: point WILSON at the new folder and it re-finds moved files itself, in three matching rungs, with an old→new preview before it writes anything. Applying a relink re-homes the project's files directory — disclosed before the write, resettable, and refused outright if the change would strand files or if the current home is merely offline.
- **`file_events`** — an append-only per-file lifecycle stream: uploaded, moved, relinked, trashed, restored, purged. The `purged` rows **are deletion certificates**, readable by project readers and by workspace admins so proof of deletion survives the project.
- **Blob garbage collection** — admin-invoked from Diagnostics (a human clicking a stated confirm is the second authorization), draining the delete queue, sweeping orphaned objects and stale avatars, failing closed on tenancy, and writing a certificate for what it destroyed.
- **CSV exports** on the team roster, rate card and project tasks — each exports exactly what the viewer sees, so a hidden wage column cannot leak through an export.
- **Workspace takeout** (admin-only): one CSV per table across 19 tables plus a manifest, zipped, built from the requesting admin's own RLS-scoped reads and never a privileged sweep. O.T.T.E.R. content and Notes are excluded, with the reason stated in the UI and the manifest.

**Operations**

- **Auto-update** via electron-updater/NSIS off a Backblaze B2 feed, with an update prompt at login and a version panel in Settings.
- **Nightly off-platform `pg_dump` backups** to B2, 90-day retention, alongside Supabase's own daily 7-day backups.
- **Sentry** in both the renderer and the Electron main process, per environment.
- **`app_events` with WIL-#### codes** and a visible error-code reference in Diagnostics.
- **Single-user → cloud migration tools** for both R.A.B.B.I.T. and O.T.T.E.R. — dry-runnable, resumable, idempotent, with an optional Archive + Clear Local afterwards that is always user-initiated.
- **CI**: four jobs — pgTAP against real Postgres, unit (Vitest), smoke, and Playwright e2e including a lane against the real web bundle.

---

### Changed

- **Team Members reads the real membership table.** The roster is `workspace_members` via an RPC, not R.A.B.B.I.T.'s legacy local `team_members` entity. It has live roster updates, an assigned-projects column, a Day Rate column visible only to admins with rate access, and role-filtered saved views.
- **New projects are staffed at creation, and that narrows who can write to them.** An unstaffed project stays open to every active member, as before; but `fn_projects_auto_staff` seats the creator and the producer on client creates, so projects made in-app are staffed from birth — **plain members no longer get write access to new projects they are not seated on**. That is the intent. Legacy projects are unchanged.
- **Admins reset passwords; they never read them.** This is a deliberate departure from the original brief's "admin can see member passwords" — that is not securable. Credentials are show-once at creation, and reset-only thereafter.
- **Settings no longer has a password field.** Your password belongs to your workspace account; use Forgot password or ask an admin.
- **Settings no longer has an API key field.** The per-user key in `localStorage` is deleted on upgrade.
- **Deactivating a member is a real cutoff** — RLS refusal, token revocation and a best-effort logout, not just a flag.
- **Realtime uses broadcast-from-database, never `postgres_changes`** — because `postgres_changes` re-evaluates the subscriber's read policy against the new row, which would silently withhold the single event collaborators most need ("this was just trashed").
- **Inviting a member now requires a fresh MFA sign-in.** An admin with a verified TOTP factor on an older session sees *"This action needs a fresh MFA sign-in"* instead of a successful invite. Its sibling path, create-with-password, always worked this way; invite could mint an admin and did not. Sign out and back in to complete the invite.
- **Backups are two layers, and PITR stays deferred.** Supabase's own daily backups cover the last week on-platform; the nightly dump to B2 exists for what those cannot do — surviving a suspended account and holding long retention.
- **In cloud mode an O.T.T.E.R. course's client-facing slug is its UUID**, because two visible courses in a shared workspace can legitimately share a name-derived slug.
- **Google Drive rate-card reads return empty** rather than raising a permanent red error banner. Drive is read-only in v1.0 and now says so quietly.
- **O.T.T.E.R.'s Space-to-search shortcut only fires on the O.T.T.E.R. page.** Every page is mounted at once, so it used to fire from anywhere in the app.
- **The Help page's password section** was rewritten; it documented a panel that no longer exists.

---

### Security

- **The access-token hook is locked away from clients.** `custom_access_token_hook` derives its target user from a caller-supplied argument rather than the caller's own identity, and a blanket grant in an early migration had silently re-opened it — it was reachable with nothing but the public anon key, returning any user's full claim set (memberships, role, operator flag). Now revoked, with a migration post-condition to keep it that way. The wider sweep of that same grant left a documented residue; see *Known limitations*.
- **Privilege changes are audited.** Role promotions, rate-card grants and deactivations now write reserved audit lines (`WIL-4105` / `WIL-4106` / `WIL-4107`) from a trigger the client cannot forge. It fires only when authority actually changes — editing a profile writes nothing, so the stream stays one worth reading. "Who granted this person admin, and when" is now answerable. Coverage boundary: Edge Functions that change privileges run as `service_role` with no `auth.uid()`, so the trigger records a NULL actor and the function's own admin event records the real one.
- **`invite-member` enforces the MFA step-up** it was missing while it could mint an admin. This does **not** mean no unauthenticated path can create an admin — see *Known limitations*.
- **Path containment on managed files.** Hard delete, thumbnail cache and thumbnail source all resolved client-supplied path fragments against the project root with no containment check; the asset rename/delete pair could move an arbitrary directory; folder import lacked the authorization check its sibling had. All four now go through the containment resolver, and the update route strips path fields outright.
- **Operator write lockdown.** A broad `FOR ALL` policy meant an operator's ordinary browser session could delete a workspace directly — skipping the console's hard MFA, the typed confirm, the blob sweep *and* the certificate. Write arms narrowed, INSERT/DELETE/TRUNCATE revoked, and a delete guard added at the table.
- **The Anthropic key never reaches a client on either host**, and the two legacy `localStorage` slots are purged on every launch.
- **Per-company AI keys** are AES-256-GCM with a per-record IV and a key-length check, held in a table with zero policies, and cannot be read back.
- **Guards fail closed on MFA.** The company admin guard refuses on a failed factor check; the operator guard refuses both on no enrolment and on a failed lookup.
- **Durable, cross-isolate rate limiting on the `ai-proxy` path**, replacing per-isolate in-memory counters whose real limit was requests-per-minute multiplied by however many warm isolates happened to be alive. It is not universal and it is not strict: `resolve-login` and `provision-workspace` still use per-isolate buckets, six other functions have no limiter, and the shared limiter **fails open** by design, so a limiter outage cannot take sign-in down with it. See *Known limitations*.
- **Four append-only audit streams** — edit history, app events, file events and platform audit — each enforced append-only three ways: no write policies, revoked grants, and migration post-conditions. File and platform audit have no purge job, deliberately: the deletion certificates must outlive their subjects. `app_events` and `edit_history` do purge, at 90 days, which is short of the one-year retention the compliance target asks for.
- **Storage buckets are split by sensitivity.** `rabbit-files` is private, with delete-own limited to a one-hour cleanup window. `user-avatars` is public with unconditional SELECT — an accepted weak point, listed below.
- **The local password gate is gone**, along with its routes, its hardcoded constants and its on-disk credential file. The code and the data were removed together — deleting only the routes would have left the screen falling through to a string comparison, a fail-*open* gate strictly worse than the dead code.

---

### Fixed

The defects worth listing here are the ones a 0.6.3 user could actually have hit. Defects found and fixed inside the new multi-tenant code — which ships for the first time in this release — are described by the features above, not repeated as fixes.

- **R.A.B.B.I.T. milestones were dropped on every project load** by both the local and Drive adapters — a milestone silently reverted to nothing on the next reload, project switch or refetch. Real data loss; now pinned by a test that fails on the whole class of bug.

Three further pre-1.0 defects are described under *Changed*, because the fix changed behaviour: the Google Drive rate-card error banner, O.T.T.E.R.'s global Space shortcut, and the Help page's password section.

---

### Removed

- The local password screen, its three Express routes, its hardcoded constants and its on-disk credential file.
- The Settings Anthropic API key field, the `apiKey` prop plumbing behind it, and the per-user key in `localStorage`.
- The legacy `public.users` table and the checked-in schema/seed files that recreated it.
- **1,840 lines of unreachable code across 13 files** — verified by per-symbol greps, a strict import-path grep, and a module-reachability walk from every real entry point, and confirmed by an unchanged bundle size. Includes a superseded budget grid and topsheet tab, two orphaned data hooks and an empty constants module.
- Superseded documentation copy in-product: the Agent Skills description no longer claims capability the checkboxes do not have. The copy was corrected; **the checkboxes themselves are still present and still inert** — see *Known limitations*.

---

### Known limitations

The user-facing subset, with each item marked blocking or note, is **`docs/RELEASE_TESTING.md`**. The live gap register is `docs/MASTER_PLAN.md` §6, which carries a verdict — CLOSED, RE-OWNED or ACCEPTED — against every entry, and the consolidated technical list is `docs/SYSTEMS_HANDBOOK.md` §17. The headline items, because they change what you can do or what you can claim:

**Security and audit**

- **`provision-workspace` can still create an `admin` from a public, pre-authentication endpoint.** This is by design — it is self-serve company creation and the caller becomes that company's first admin — but it means *"no unauthenticated path can mint an admin"* is not a true statement about this system, even with `invite-member` now gated.
- **Eight SECURITY DEFINER functions remain executable by `anon`.** Six key on `auth.uid()` and leak nothing; `project_is_staffed` and `fn_comment_project_id` have no caller gate but reveal one bit about a UUID the caller must already hold. Revoking them was tested and is a **behaviour change** — `has_active_membership` backs nearly every policy, so every anonymous table read turns from an empty result into a 42501. The post-1.0 fix is a `auth.uid() IS NOT NULL` guard inside the two ungated functions, not a grant change.
- **Authentication events are not logged anywhere.** Sign-in success, sign-in failure, MFA challenge failure, sign-out and session expiry write no row; the same is true of operator sign-in, sign-out and guard refusals, and `platform_audit`'s action CHECK has no value that would accept them. Two of the three declared `WIL-1001` / `WIL-1002` / `WIL-1003` codes **cannot** be wired client-side at all — at sign-in failure there is no session, and `app_events`' INSERT policy requires one. This needs a server-side writer.
- **Rate limiting is uneven.** `resolve-login` and `provision-workspace` still use per-isolate in-memory buckets; six other Edge Functions have no limiter; `resolve-login` keys its per-IP throttle on the **first**, client-supplied `X-Forwarded-For` hop (spoofable) where `provision-workspace` correctly uses the last.
- **`app_events` and `edit_history` purge at 90 days** against a one-year retention requirement.
- **The `user-avatars` bucket is public**, with unconditional SELECT.
- **Storage-cleanup failures log as informational.** `logAdminEvent` hardcodes `severity: 'info'`, so `WIL-3004` "Storage cleanup **failed**" is indistinguishable from the success line in the admin log stream. One line to fix — but `adminGuard.ts` is bundled by nine Edge Functions, so changing it forces a redeploy of all nine, which was not worth doing on release day.
- **A username that collides across two workspaces makes sign-in unreachable** — the resolver treats two matches as a miss unless a workspace slug disambiguates, and the login screen has no field for one.

**Product and correctness**

- **D.O.G. cloud attachments are refused at the write layer.** Local mode works end to end; re-homing them is post-1.0.
- **Quiz scores and Validator findings are never persisted.** The columns, routes and adapter operations exist; the client never calls them. They live for the visit only.
- **Scenes, shots, levels, experiences and milestones are local-only** — their cloud adapter methods throw with a stated reason and they do not sync.
- **Managed files** (the ASSETS/SCENES/SHOTS folder mirror) are local-server only, and thumbnails resolve only under `ASSETS/` — `SCENES/` and `SHOTS/` thumbnails always 410.
- **Google Drive is read-only.** Every write throws.
- **Settings → Tools "Storage Location" is editable and has no effect.**
- **R.A.B.B.I.T.'s agent integration is prompt-only and unreachable** — the agent surface is hard-gated to the O.T.T.E.R. page, so the R.A.B.B.I.T. prompt can never reach the model.
- **The Agent Skills checkboxes gate nothing.** `isSkillEnabled` has zero call sites repo-wide, for O.T.T.E.R. as well as R.A.B.B.I.T.; the state is loaded, persisted, rendered and read by nothing. Only the misleading copy was fixed in this release.
- **The Attach button in Budget → Crew and Talent appears to do nothing.** The invoice-folder call's `res.ok` is unchecked, so a 400 becomes a swallowed error with no message.
- **The Summary view's Budget tile is structurally zero** — the estimate rollup is called with no role rates.
- **No single-instance lock** on the desktop app; two copies can run against one data directory. Web multi-tab is last-writer-wins on companion, O.T.T.E.R. settings and agent skills.

---

### Deployment and upgrade notes

There is no migration path from 0.6.x data other than the in-app tools: Settings → R.A.B.B.I.T. holds both single-user → cloud migrations. Run them dry first; Archive + Clear Local is offered afterwards and is never automatic.

Before this release is usable in an environment, **four** things must be done by hand — they are secrets and grants, and none of them can be committed. Each is written out in **`docs/OWED_AUDREY.md`**:

- **§0 — rotate the published CI probe password.** It was committed to this public repository and is permanent in git history, so rotation is the only remedy. Open critical.
- **§5 — set `ANTHROPIC_API_KEY`** on each environment. Already set on staging; dev and prod remain. Without it `ai-proxy` returns `501 ai_not_configured` and every AI feature in all three tools fails.
- **§9A + §9B — enrol TOTP *and* seed `platform_operators`.** Do both: either one alone leaves the operator console signing you in and then refusing everything.
- **§9C — set `WILSON_AI_KEY_SECRET`** per environment, or per-company AI keys cannot be stored.

Not a prerequisite, but decided post-1.0: **§11C — where the operator console is hosted.** It already serves at `https://beta.petalstudios.co/wilsonadmin` through a `vercel.json` rewrite; moving it to a subdomain would additionally buy browser-enforced session separation, which today is a build-time key string and nothing more.

Deployment reference: `docs/WEB_DEPLOY.md`. Architecture reference: `docs/SYSTEMS_HANDBOOK.md`.

[1.0.0]: https://github.com/pretty-aud/wilson/releases/tag/v1.0.0
