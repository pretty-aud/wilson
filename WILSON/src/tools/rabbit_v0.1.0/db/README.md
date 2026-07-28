# RABBIT v0.1 — database setup

RABBIT can persist its data to one of three backends. This README is for the
**Supabase** backend (the recommended path for cloud sync). For the Local Server
and Google Drive backends see `adapters/localServerAdapter.js` and
`adapters/googleDriveAdapter.js` — neither requires a schema migration.

## 1. Create a fresh Supabase project

1. Sign in at <https://supabase.com> and click **New project**.
2. Pick a region close to you, set a database password, and wait for provisioning.
3. Once ready, go to **Project settings → API**. You will need:
   - **Project URL** (e.g. `https://abcdefghij.supabase.co`)
   - **anon public** key
   - **service_role** key (optional in v0.1, see §3 below)

## 2. Apply the schema

In the Supabase dashboard, open **SQL Editor → New query** and paste the entire
contents of `schema.sql` from this folder. Click **Run**. The script is
re-runnable — every `create` is wrapped in `if not exists` or
`exception when duplicate_object`.

To sanity-check the adapter round-trip, run `seed.sql` next. It inserts a
single demo project ("Sample Short Film") with 2 phases, 3 assets, 6 tasks, and
2 dependencies. You can delete this row at any time:

```sql
delete from projects where id = '11111111-0000-0000-0000-000000000001';
```

The cascade rules will clean up the dependent rows automatically.

## 3. Storage bucket

The Supabase adapter uploads files (intake docs, thumbnails, deliverables) to a
storage bucket named **`rabbit-files`**. Create it once via the dashboard:

1. Go to **Storage → New bucket**.
2. Name: `rabbit-files`. Make it **private** (not public).
3. Click **Create**.

The adapter will key uploads as
`projects/{project_id}/{entity}/{entity_id}/{filename}`. For v0.1 single-user
mode this works fine with anon-only auth as long as RLS is left disabled
(see §4).

## 4. Row-level security (v0.1: disabled)

RABBIT v0.1 ships with **RLS disabled** for single-user simplicity. The
service-role key is NOT required and an anon key alone is enough. This is fine
because the only client is the user's local Electron app — there is no shared
multi-tenant traffic.

> **Multi-user RLS is live (Session 2, 2026-04).** Every RABBIT table is now
> `FORCE ROW LEVEL SECURITY` on `current_workspace_id()` + active membership.
> See `supabase/migrations/0004_rls_rabbit.sql` for the full policy sweep and
> `supabase/tests/rls/*.sql` for the pgTAP coverage.

## 5. Tell WILSON about your project

Supabase credentials are centralised at build time, not per-project. WILSON's
shared client (`src/cloud/auth/supabaseClient.js`) reads two variables from the
environment:

```
VITE_SUPABASE_URL       = https://abcdefghij.supabase.co
VITE_SUPABASE_ANON_KEY  = eyJhbGciOiJIUzI1NiIsInR...
```

Populate these in `.env.local` during development; CI sets them as repo
secrets. The session itself is persisted by the main process via Electron's
`safeStorage` (see `electron/main.cjs` → `wilson:session-save`), so the
renderer never handles the encrypted blob directly.

The Session 1 per-project `{userData}/rabbit-data/supabase.json` fallback was
removed in Session 2; a one-shot cleanup in `electron/main.cjs` deletes any
stale file left over from earlier installs.

## 6. Email delivery (Resend)

WILSON sends three kinds of transactional mail: **invites**, **password
resets**, and **email-change confirmations**. The templates live at
`supabase/templates/*.html` (source of truth) and the send path goes
through Supabase Auth → SMTP → **Resend**.

### Why Resend

Chosen in Session 3 over Postmark and SES on DX grounds: API-key-only
setup, React Email compatibility, 3k/month free tier, no sandbox-exit
paperwork. Deliverability is comparable to Postmark for volumes under
10k/month. If we exceed that or a TPN-audited customer insists on SES,
swap the SMTP creds and leave templates + call sites untouched.

### One-time per-environment setup

Run this for each of `wilson-dev`, `wilson-staging`, `wilson-prod`.

1. **Resend account & domain.** Create an account at
   <https://resend.com>. Add the sending domain (`mail.petalstudios.co` is
   the current choice). Resend will show three DNS records:
   - `TXT` at `mail` — SPF (`v=spf1 include:amazonses.com ~all`)
   - `TXT` at `resend._domainkey.mail` — DKIM public key
   - `TXT` at `_dmarc.mail` — DMARC (`v=DMARC1; p=none; rua=mailto:postmaster@petalstudios.co`)
   Add all three to the DNS provider; propagation usually takes under 5
   minutes. Resend's domain status must go green before the next step.
2. **Create an SMTP credential.** In Resend → API Keys → *Create SMTP
   credential*. Copy the generated password (it's the only time Resend
   shows it).
3. **Paste into Supabase.** Dashboard → Auth → SMTP Settings:
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: *paste the Resend SMTP password*
   - Sender name: `WILSON`
   - Sender email: `wilson@mail.petalstudios.co`
   Save. "Enable custom SMTP" toggles to green.
4. **Upload templates.** Dashboard → Auth → Email Templates. For each of
   *Invite user*, *Reset password*, *Change email address*: paste the
   contents of the matching file under `supabase/templates/`. Subject
   lines in the UI must match the `subject` fields in
   `supabase/config.toml` → `[auth.email.template.*]`. Save.
5. **Smoke test.** Trigger a password reset against your own account via
   the ForgotPasswordWizard. Expect delivery to the inbox within 30
   seconds and a working recovery link.

### Local development

`supabase/config.toml` pins `[auth.email.smtp] enabled = false` so
`supabase start` routes mail to the local **mailpit** server at
<http://localhost:54324>. This is deliberate — no real email is ever
sent from a developer machine. To preview a template visually without
triggering the flow, open the HTML file directly in a browser.

### Editing templates

Treat `supabase/templates/*.html` as the source of truth. After editing
any template, re-upload it to each hosted environment via the Dashboard
(no CLI push for templates today). A future Session 9 automation will
sync these via the Management API.

## 7. Realtime (free, opt-in)

The Supabase adapter wires `subscribeProjectChanges()` to a Realtime
subscription on `projects`, `phases`, `assets`, and `tasks`. RABBIT v0.1 does
not yet consume the events visually — they are wired so collaboration UI in
v0.2 can flip a single feature flag and start receiving updates. No extra
setup is needed; Supabase enables Realtime on every table by default.

## 8. Migrations

For v0.1 there is exactly one migration — `schema.sql`. There is no
migrations runner. When the schema needs to evolve, append a new file
(`schema_v0.2.sql`, etc.) and a CHANGELOG entry. Do not edit `schema.sql`
in-place after a release ships.

## 9. Member directory & profiles (Session 4, migration 0010)

The Team Members page and the Settings → Profile editor read and write
`public.workspace_members` directly (multi-user path; the RABBIT
`team_members` JSON entity remains only for RABBIT's internal views until
project assignment unifies in Session 6).

- **Listing** goes through the `workspace_directory()` RPC (SECURITY
  DEFINER, migration 0010). It joins `auth.users` for email — email is
  returned only to admin/manager callers, plus each caller's own row. The
  UI falls back to a plain `workspace_members` SELECT (no emails) when the
  RPC isn't deployed in an environment yet.
- **Write scopes** (enforced by RLS + the `trg_ws_members_self_guard`
  trigger, NOT by the UI): admins edit anything inside their workspace;
  managers may change only `title` + `department` on other members;
  everyone edits their own profile fields but never their own `app_role`,
  `username`, or `workspace_id`.
- **`user-avatars` path convention** (0009 storage policies): objects MUST
  be keyed `{workspace_id}/{user_id}/{filename}` —
  `storage.foldername(name)` is a 1-indexed `text[]`, and the policies pin
  `[1]` to the caller's active workspace and `[2]` to `auth.uid()`. Any
  caller using a different prefix is silently rejected with a
  row-level-security error. NewUserWelcome and ProfileSection both build
  paths as `{workspace_id}/{user_id}/{ts}-{sanitized-filename}`; keep new
  callers on that shape.

## 10. Edit history (Session 5, migration 0012)

Every mutation of the 13 RABBIT tables in supabase mode writes an
append-only row to `public.edit_history` — who (`actor_user_id` +
`actor_label` captured at write time), what (`entity_type`/`entity_id` +
per-field `diff`), when (`created_at`). Capture is a single generic
`AFTER INSERT/UPDATE/DELETE` trigger (`fn_edit_history_capture`), so it
covers every client — Electron, web, Edge Functions, raw SQL — with no
adapter involvement. Revert/undo is deliberately absent until Session 7.

- **Reads** are RLS-gated: admin + manager, own workspace only, active
  membership required. Below-manager members write history but cannot
  read it. The UI additionally gates the drawer on `rabbit.history.view`.
- **Writes** are impossible for client roles: no INSERT/UPDATE/DELETE
  policies exist and the 0011 default-privilege grants are revoked.
  Only the SECURITY DEFINER trigger path inserts.
- **Diffs**: `create` → `{"new": {...}}`, `delete` → `{"old": {...}}`,
  `update` → `{"col": {"old": ..., "new": ...}}` per changed field.
  Audit-touch columns (`updated_at/by`, `last_updated_at/by`) are
  excluded; touch-only updates write nothing.
- **Retention** is 90 days (locked decision), enforced by
  `purge_edit_history()` (service_role-only). Hosted envs schedule it
  nightly via pg_cron (`wilson-purge-edit-history`, 04:43 UTC); the CI
  local stack has no pg_cron, so pgTAP calls the function directly.
- **Known gap**: direct service_role writes to the seven tables without
  a `workspace_id` column (phases, asset_versions, task_dependencies,
  task_links, rate_card_entries, ingestion_runs, ingestion_chunks) skip
  capture when the parent row can't resolve a workspace and no JWT claim
  is present. Cascade deletes from signed-in users ARE captured.
- **local_server / google_drive modes**: no capture. In practice the
  History button never renders there — the `rabbit.history.view` gate
  needs a Supabase-session role, which pure local mode doesn't have. (The
  drawer itself also carries an "unavailable in this mode" notice for
  mixed setups where a signed-in user switches adapters.) Local parity is
  a candidate for the Session 6 identity unification work.
