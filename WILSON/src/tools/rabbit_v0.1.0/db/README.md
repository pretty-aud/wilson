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

> **TODO (v0.2):** turn RLS on with `created_by = auth.uid()` rules and require
> users to sign in via Supabase Auth. The schema is already prepared for this:
> `projects.created_by`, `comments.author_user_id`, `tasks.assigned_user_id`,
> and `files.id` are all designed to scope cleanly per-user once
> `auth.uid()` is populated. See `RABBIT_v0.6_post_build_notes.md` § "Multi-user
> auth" in `Claude_Work/` for the full v0.2 plan.

## 5. Tell WILSON about your project

WILSON expects the credentials at:

```
{Electron userData}/rabbit-data/supabase.json
```

The shape is:

```json
{
  "url":               "https://abcdefghij.supabase.co",
  "anon_key":          "eyJhbGciOiJIUzI1NiIsInR...",
  "service_role_key":  null
}
```

You can write this file directly, or use the **RABBIT settings** panel (added in
Session 3) which exposes a Connect form. The renderer reads the file via the
IPC bridge `rabbit:read-supabase-config` and writes it via
`rabbit:write-supabase-config`. Both are wired in `electron/main.cjs`.

## 6. Realtime (free, opt-in)

The Supabase adapter wires `subscribeProjectChanges()` to a Realtime
subscription on `projects`, `phases`, `assets`, and `tasks`. RABBIT v0.1 does
not yet consume the events visually — they are wired so collaboration UI in
v0.2 can flip a single feature flag and start receiving updates. No extra
setup is needed; Supabase enables Realtime on every table by default.

## 7. Migrations

For v0.1 there is exactly one migration — `schema.sql`. There is no
migrations runner. When the schema needs to evolve, append a new file
(`schema_v0.2.sql`, etc.) and a CHANGELOG entry. Do not edit `schema.sql`
in-place after a release ships.
