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
   <https://resend.com>. Add the sending domain (`mail.wilsonapp.com` is
   the current choice). Resend will show three DNS records:
   - `TXT` at `mail` — SPF (`v=spf1 include:amazonses.com ~all`)
   - `TXT` at `resend._domainkey.mail` — DKIM public key
   - `TXT` at `_dmarc.mail` — DMARC (`v=DMARC1; p=none; rua=mailto:postmaster@wilsonapp.com`)
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
   - Sender email: `wilson@mail.wilsonapp.com`
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
