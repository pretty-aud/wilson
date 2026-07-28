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

## 7. Realtime (live since Session 7)

Superseded by §14. `subscribeProjectChanges()` now joins the private
broadcast channel `rabbit:project:{id}` (migration 0016) and the client
consumes the events — live sync is on by default in cloud mode. The
original postgres_changes scaffolding described here was replaced; §14
explains why.

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

## 11. Project roles (Session 6, migration 0013)

`public.project_members` holds one row per seat: `(project_id, user_id)`
→ `project_role` (`manager` | `reviewer` | `member`). A composite FK to
`workspace_members(workspace_id, user_id)` guarantees seats belong to
real workspace members and cascades them away on workspace removal.

The gating rule lives in one DB helper, `can_write_project()`, and is
mirrored client-side in `src/permissions/projectRoleMatrix.js` — change
them in lockstep:

- app `admin`/`manager` (JWT `app_role`) bypass project gating entirely;
- an **unstaffed** project (zero seats) stays open to every active
  member — every pre-Session-6 project is unstaffed, so adding the
  feature changed nothing until someone staffs a roster;
- staffed: project `manager`/`member` write entities; `reviewer` reads
  and comments only (`can_comment_project()`);
- rosters are workspace-visible; managed by app admin/manager or the
  project's manager (`can_manage_project_roster()`). Initial staffing is
  therefore an app-admin/manager act.

Every project-scoped entity write policy (assets, tasks, files, phases,
comments, versions, deps, links, ingestion) now carries the gate.
Matrix-parity tightening on `projects` itself: INSERT admin+manager
(`project.create`), hard DELETE admin only (`project.delete`).
`rate_cards`/`rate_card_entries` are workspace-level, not project-scoped.

Known gaps: roster changes are NOT edit-history captured (0012's
`entity_type` CHECK locks the 13 RABBIT tables; project_members is
auth-layer, like workspace_members). Legacy local-mode team_assignments
remain untouched — TeamView branches by adapter mode.

## 12. Soft delete + undo (Session 6, migration 0014)

The 7 user-facing tables (`projects`, `phases`, `assets`, `tasks`,
`files`, `comments`, `rate_cards`) soft-delete through two SECURITY
DEFINER RPCs — `soft_delete_row()` / `restore_soft_deleted()` — which
re-check workspace + membership + the project gate, then flip
`deleted_at`; a trigger (`fn_soft_delete_stamp`) stamps `deleted_by` and
clears it on restore. Plain UPDATEs cannot do either direction: SELECT
policies apply to both sides of an UPDATE that reads the table, so
setting `deleted_at` makes the new row invisible (RLS violation) and a
hidden row can't even be targeted for restore (silent 0-row no-op).
The 6 leaf/link tables stay hard-delete — their UNIQUE constraints
(`(asset_id, version_no)`, `(predecessor_id, successor_id)`) would
collide with recreated rows; in-session undo for them is the provider's
inverse-op history stack.

- **No propagation writes.** SELECT policies filter `deleted_at IS NULL`
  plus a live-parent EXISTS that runs under the caller's RLS, so hiding
  a parent transitively hides the subtree (assets→projects,
  tasks→assets, files→projects, comments→polymorphic parent). Soft
  delete touches one row; restore clears one row and the subtree
  reappears.
- **Projects are admin-only** to delete or restore (trigger-enforced:
  `only workspace admins can delete or restore projects`).
- **Undo UI**: deletes show a bottom-center toast with an 8s Undo window
  (pause on hover). Undo restores the row (cloud) or replays inverse ops
  (local). Row-level confirms are gone; bulk and project deletes keep
  their confirm step.
- **Retention**: `purge_soft_deleted()` (service_role-only) hard-deletes
  rows soft-deleted >30 days ago, cascading each subtree; scheduled
  nightly where pg_cron exists (`wilson-purge-soft-deleted`, 04:47 UTC).
- **Edit history** records the transition as an `update` diff; the
  drawer labels it Deleted / Restored (`editHistoryFormat.js`).
- **Known gap**: storage blobs for soft-deleted `files` rows are no
  longer removed at delete time (the row must stay restorable) and the
  SQL purge can't reach the storage API — blob GC is deferred to the
  hardening sessions. Hard-deleting files via purge orphans blobs.

## 13. Rate-entry identity + role scoping (Session 6, migration 0015)

`rate_card_entries` gained the columns the client always wrote in local
mode (`member_id`, `wage`, `burden`, `burden_type`, `overhead`,
`overhead_type`, `department`) — cloud-mode upserts previously died with
PGRST204. `member_id` canonically holds an **auth user id**
(`workspace_members.user_id`) in cloud mode; the client resolves people
through `useRosterMembers()` (directory in cloud, legacy JSON locally),
which closes the Session-4 orphan-rows problem.

RLS is now role-scoped (the Session-4 deferral): SELECT admin+manager
(`rate_card.view` parity), writes admin only (`rate_card.edit` parity).
Plain members get an empty list via PostgREST; the Rate Card page shows
a permission notice instead of an empty table.

## 14. Realtime live sync (Session 7, migration 0016)

Live sync uses **broadcast-from-database**, not postgres_changes. The
reason is the Session 6 lesson resurfacing on the realtime path:
postgres_changes authorizes each event by evaluating the SUBSCRIBER's
SELECT policy against the NEW row of every UPDATE, so a soft delete
(`deleted_at` set → row invisible under the §12 policies) is **withheld
from every other client** — collaborators would keep stale rows forever.
Broadcast delivers full old/new rows for every write and authorizes the
channel ONCE at join.

Pieces:

- **`fn_realtime_broadcast()`** — one generic AFTER INSERT/UPDATE/DELETE
  trigger on the 10 project-scoped tables (`projects`, `phases`,
  `assets`, `tasks`, `files`, `comments`, `task_dependencies`,
  `task_links`, `asset_versions`, `project_members`). Resolves the row's
  project (own column, or parent join for the link tables) and calls
  `realtime.broadcast_changes('rabbit:project:' || project_id, TG_OP, …)`.
  Same resilience contract as the §10 capture trigger: a broadcast
  failure NEVER aborts the write, and environments without the realtime
  schema (the db-only CI stack — `supabase start --exclude realtime`)
  skip silently.
- **`can_read_project_topic(uuid)`** — SECURITY INVOKER on purpose: the
  check is "can the caller SELECT this project row", so `projects_select`
  is the single source of truth and channel access can never drift from
  table visibility. A trashed project's topic therefore denies (re)joins
  while trashed; a subscriber who stays joined still hears the restore.
- **realtime.messages policies** — `rabbit_project_topic_read` (SELECT,
  broadcast + presence) and `rabbit_project_topic_presence_write`
  (INSERT, presence only — clients never send data broadcasts; the
  SECURITY DEFINER trigger is the only writer). `fn_try_uuid()` guards
  the topic-suffix cast so a hand-crafted topic can't error the policy.
- **Client** — the adapter normalizes events to
  `{ table, op, record, oldRecord }`; the pure merge layer
  (`state/realtimeMerge.js`) applies them with **LWW per field**: writes
  go up as per-field patches (`patchPhase/patchAsset/patchTask`, plus
  patch-shaped `updateProject`), and incoming rows replace local state
  field-by-field EXCEPT fields with an in-flight local write. Remote
  soft-deletes mirror the local cascade shapes (asset → its tasks,
  task → its dependency edges); remote restores refetch the bundle
  (children were only hidden transitively, never deleted). On channel
  rejoin after a drop the client refetches to close the missed-events
  window. Presence ("who ELSE has this project open" — the local user is
  filtered out) rides the same channel and renders next to the adapter
  dot.

No publication or REPLICA IDENTITY management is involved —
`broadcast_changes` reads trigger NEW/OLD, not the WAL.

**Partition provisioning (verified live on wilson-dev, 2026-07-28):** on a
hosted project whose Realtime tenant has never been active,
`realtime.messages` has NO partitions and `realtime.send()` drops every
row with only a WARNING — DB-side broadcasts silently vanish. The FIRST
websocket connection activates the tenant and the janitor creates the
partitions; from then on broadcasts land (probed empirically: send → 0
rows before any connection, 1 row after a single anon channel join).
This is self-healing in practice — broadcasts only matter when a
subscriber exists, and a subscriber existing implies the tenant is
active — but after deploying 0016 to a fresh environment, do not expect
`realtime.messages` rows until a client has connected at least once.

Two operational notes: (1) the `realtime.messages` channel policies are
created only when that table exists at migration time — a stack that
gains the realtime service AFTER 0016 was applied must re-apply 0016
(it is idempotent; pgTAP 20 probe 22 reporting `missing` is the
detector for that state). (2) pgTAP's partition detection is empirical
(a `realtime.send` probe), because stale historical partitions would
otherwise read as "routable".

Known gaps: a client whose token refreshes while its project sits in the
trash can miss that project's restore event (catches up on next open).
(The Session 7 "projects INDEX only updates live for the OPEN project"
gap is CLOSED by the Session 8 workspace channel — §17.)

## 15. Revert-to-state (Session 7)

The Edit History drawer (§10) gained per-entry revert, gated by
`rabbit.history.revert` (admin + manager, mirrors `.view`). A revert is
an ORDINARY write through the provider mutators — captured in history
itself, undoable with Ctrl+Z, and subject to the same RLS as any edit.
Mapping (`components/editHistoryRevert.js`, pure + unit-tested):

| History entry            | Revert action                                  |
|--------------------------|------------------------------------------------|
| update (plain diff)      | inverse patch — every diffed field back to `.old` |
| update (Deleted label)   | restore via `restore_soft_deleted()`           |
| update (Restored label)  | soft delete via `soft_delete_row()`            |
| create                   | soft delete                                    |
| delete (hard, pre-§12 or purge) | recreate from the `{old}` snapshot, id preserved |

Under LWW-per-field a revert applies the inverse of ONE entry as the
newest write — it does not rewind later edits to other fields. Audit,
tenancy and trash columns never ride an inverse patch (`deleted_at` is
RPC-only per §12). Supported entity types: projects, phases, assets,
tasks (full mutator coverage); hard-deleted projects cannot be recreated
(a fresh id would orphan the subtree).

## 16. Notes + Dashboard (Session 8, migrations 0017/0019)

`notes` + `note_subjects` are OWNER-ONLY tables (every verb requires
`workspace_id = current_workspace_id() AND owner_id = auth.uid()`), with
deliberately NO app-role bypass: a workspace admin cannot read another
member's notes. `owner_id`/`workspace_id` fill from column defaults
(`auth.uid()` / `current_workspace_id()`); WITH CHECK pins both on every
write, so a note can never be re-pointed at another owner or workspace.

The note body is a **Yjs snapshot** (`ydoc_state`, base64 text — the ONLY
place Yjs is used, per the locked decision; RABBIT entity fields stay
LWW-per-field). Multi-device safety is snapshot-merge-write, enforced by
the `version` column:

    UPDATE notes SET ydoc_state=$1, version = v+1 WHERE id=$2 AND version = v

A zero-row result means another device saved first; the client merges the
remote snapshot into its local Y.Doc (Yjs updates are commutative and
idempotent) and retries with the fresh version (`saveNoteDoc` +
`noteSync.saveWithMerge`, bounded). `saveNoteDoc` is the ONLY writer of
`ydoc_state`/`version`; `patchNote` is metadata-only.

Deliberate exclusions: not edit-history captured (0012's entity CHECK
stays locked — project_members precedent), never broadcast on any
realtime topic (owner-private content), hard delete + UI confirm in v1
(no `deleted_at`; the trash RPCs' allowlist does not include notes).

`0019_task_ui_parity.sql` closed two pre-existing UI/DB mismatches the
Dashboard would have tripped: `tasks.notes` (TaskDetailPopup always wrote
it; cloud mode raised PGRST204) and the `'urgent'` label on
`task_priority` (UI vocabulary; the enum only had `'critical'`, which
stays but is unused).

The Dashboard's cross-project "my tasks" read is one indexed query on
`tasks.assignee_id / reviewer_id` (0013) — RLS supplies workspace
scoping, trash hiding and trashed-parent hiding; no per-project bundle
loads. Rate/budget data never rides it (rate_card_entries stay RLS-empty
for the `user` role, and the Dashboard renders no budget columns).

## 17. Workspace channel (Session 8, migration 0018)

Closes the §14 known gap: private topic `rabbit:workspace:{workspace_id}`
carries, via `fn_workspace_realtime_broadcast()` (same resilience contract
as §14 — catalog probe, catch-all WARNING, never aborts the write):

  * `projects` — index liveness (create/rename/trash/restore land without
    the project being open); the provider merges these into projectsIndex
    with the same stale guard, and the per-project channel remains the
    single owner of active-project teardown.
  * `workspace_members` — roster / profile / avatar liveness.
  * `tasks` — Dashboard liveness, ONLY when assignee_id or reviewer_id is
    set on either side of the write (unassigned churn stays off the
    channel; the per-project topic still carries it for the open project).
  * `assets` — the transitive-hide path (adversarial-review finding):
    trashing/restoring an asset hides/reveals its tasks via tasks_select's
    live-parent EXISTS without touching any tasks row. UPDATEs broadcast
    only on deleted_at / name / phase_id changes — reorder churn stays off
    the channel.
  * `project_members` — role/staffing liveness for the Dashboard's write
    gating (myProjectRole / projectIsStaffed).

Join authorization: `can_read_workspace_topic()` = workspace match +
`has_active_membership()`. Everything the channel broadcasts is
workspace-visible for SELECT (projects/tasks reads have no staffing
gate), so channel access ≡ table visibility — with ONE deliberate
divergence, pinned by pgTAP 23: a DEACTIVATED member is denied this
channel even though table reads still allow them until Session 9 aligns
those. Clients only ever WRITE presence (extension='presence'); data
broadcasts come from the trigger alone. projects/tasks rows reach both
their project topic (0016) and the workspace topic — double delivery is
absorbed by the client's stale guard / debounced refetch.
