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

> **Changed in Session 10 (2026-07-28).** `schema.sql` and `seed.sql` were
> **deleted**. The migrations in `supabase/migrations/` are now the only
> description of the schema.
>
> They were the bootstrap for "run RABBIT standalone against your own Supabase
> project", which Audrey confirmed is no longer a supported deployment. It had
> in fact been unreachable since **Session 2**, for two independent reasons:
> the per-project `{userData}/rabbit-data/supabase.json` credential fallback was
> removed (project URL and anon key are now build-time `VITE_*` values, so a
> shipped WILSON cannot be pointed at a hand-bootstrapped project at all), and
> `schema.sql` was never updated past `0000` — it does not create
> `edit_history`, `project_members`, `notes` or `note_subjects`, all of which
> the current adapter queries. A database built from it could not have run the
> app even if you could have connected to it.
>
> Both files remain in git history if that path is ever revived.

Apply migrations with the Supabase CLI instead:

```bash
supabase db push --linked
```

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

The numbered files in `supabase/migrations/` (`0000`–`0023`) are the single
source of truth for the schema, applied with `supabase db push --linked`.
Every migration is written to be idempotent and ends with a `DO $$`
post-condition block that raises if its own invariants did not land.

Never edit a migration that has shipped to staging or prod. To re-apply one
that is still only on dev after editing it:

```bash
supabase migration repair --status reverted NNNN --linked
supabase db push --linked --include-all
```

(The v0.1 text here described a single `schema.sql` with no runner; see §2 for
why that file is gone.)

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

## 18. Session 9 — Admin Terminal server core (0020 + 0021)

**Per-user rate-card grants (locked §10-A).** `workspace_members` gains
`grant_rate_card_view` / `grant_rate_card_edit`. Effective access =
role matrix OR grant, evaluated by `has_rate_card_grant(kind)` against the
LIVE row (SECURITY DEFINER — revokes bite immediately, no token TTL
window). All four `rce_*` policies now also require
`has_active_membership`; the read arm is admin/manager-or-view-grant, the
write arms admin-or-edit-grant. Grants are admin-only edits: the 0010
guard trigger raises 'self-grant change not allowed' on self-flips and
managers stay limited to title+department. Client mirror:
`useRateCardAccess` (role ∪ own-row grants, live off the workspace
channel); `workspace_directory()` returns both flags (0021 recreate).

**Deactivated-member read alignment (closes the 0018 divergence).**
`projects_select`, `rate_cards_select`, `project_members_select`, the
workspace arm of `ws_members_select`, and `ws_members_admin_write` now
require `has_active_membership()`. Leaf tables (phases/assets/tasks/files/
comments/versions/deps/links/ingestion) inherit through their caller-RLS
EXISTS joins on the spine. The self arm of `ws_members_select` stays open
(own row remains visible). pgTAP 20 probe 20 flipped (channel ≡ table
reads — both deny now); 23 probe 12's message records the alignment.

**Last-admin protection.** `trg_ws_members_last_admin_guard`
(BEFORE UPDATE OR DELETE, SECURITY DEFINER, FOR UPDATE-locked peer count)
raises 'cannot demote or deactivate the last active admin'. No admin or
service_role bypass — Edge Functions lean on it as the backstop. Escape
hatch for operator tooling: `SET LOCAL wilson.bypass_last_admin_guard='on'`.
Workspace hard-delete cascades are exempt (parent row already gone).

**Auto-staffing (locked §10-B).** `projects.producer_id` / `director_id`
(plain UUIDs, indexed — cloud parity with the local-mode fields).
`trg_projects_auto_staff` seats creator + producer as project managers on
INSERT / producer change, ON CONFLICT DO NOTHING, membership-checked,
best-effort (never aborts the write). It SKIPS auth-less inserts
(`auth.uid() IS NULL`): pgTAP fixtures and service scripts stay unstaffed
per 0013's unstaffed-open contract; real client creates always staff.

**Workspace admin writes.** `workspaces_admin_update` (admin + active
membership) with `fn_workspaces_client_guard` making slug / id /
created_at / deleted_at immutable from clients ('workspace slug is
immutable' — resolve-login depends on it).

**app_events (0021).** Append-only log stream for the terminal
(`event_type` auth/admin/error/system/update/storage/realtime, `code`
`WIL-####`, severity, JSONB context). ENABLE+FORCE RLS: active members
INSERT into their own workspace — but the 'admin' stream and WIL-41xx
codes are reserved for server-stamped Edge Function writes (service_role
BYPASSRLS); actor identity is stamped by a BEFORE INSERT trigger either
way. SELECT is admin-only. No UPDATE/DELETE policies;
`purge_app_events()` + pg_cron 'wilson-purge-app-events' 04:51 UTC keep
90 days (0012 pattern). Client reporter: `src/cloud/errorCodes.js`
(registry + best-effort insert + Sentry mirror, TPN: no customer content).

**Admin Edge Functions.** `admin-create-user` (show-once credentials,
optional email w/ synthesized fallback), `admin-reset-password`
(show-once), `admin-set-active` (deactivate = is_active=false + GoTrue ban
when no other active membership + best-effort session logout + claim
repoint; RLS alignment cuts data access instantly), `admin-user-security`
(MFA/ban/last-sign-in read). Shared guard `_shared/adminGuard.ts`:
verify_jwt=false (ES256), token-payload claims (NOT the getUser record —
app_role is hook-minted, never persisted), LIVE admin-row check, and MFA
step-up (enrolled admins must present aal2). invite-member gained the
same token-decode + live-row check; provision-workspace gained the
initial-team `invites[]` (≤19, per-item results, last-XFF limiter + hourly
invite budget — durable limiter is S11 TPN work).

pgTAP: 24_admin_grants.sql (32 probes) + 25_app_events.sql (13 probes);
rls.yml RLS_TABLES += app_events, replay += 24/25.

## 19. O.T.T.E.R. cloud content model (Session 10, migrations 0022 + 0023)

O.T.T.E.R. moves off local-disk JSON (`otter-data/`) onto workspace-tenanted
cloud tables. This is the prerequisite for the Session 11 web build: a browser
has no in-app Express server, so `fetch('/api/software/...')` has no local
backend there at all.

### Three visibility tiers (Audrey, 2026-07-28 — refines locked #17)

| Tier | Who can read the CONTENT | Who can write |
|---|---|---|
| `personal` | the owner only — **no admin bypass** | owner (+ admins, + granted editors) |
| `shared` | every active workspace member | owner, workspace admins, granted editors |
| `company_standard` | every active workspace member | same, but only an **admin** may set or clear the tier |

Never cross-company: every row carries `workspace_id` and every policy starts
from `workspace_id = current_workspace_id()`. Deactivated members are closed
out of reads *and* writes — unlike `notes` (0017), whose SELECT arms predate
the Session 9 alignment, these tables treat 0020 as the baseline.

**Admins see that a personal course exists, not what is in it.** That is
`otter_course_index()` — a SECURITY DEFINER RPC returning metadata only (name,
owner label, subject count, tier, `can_read_content`, `can_write`). It has no
content columns, and pgTAP 26 asserts against its declared signature that it
never grows one. A plain member's index shows only courses they can actually
open, so nobody can fish for colleagues' course titles.

### Tables

- **`otter_courses`** — the "software"/course. The five per-course reference
  documents (`hotkeys`, `functions`, `nodes`, `reference_urls`, `corrections`)
  are JSONB columns, not tables: each is one whole-document blob the app merges
  in place and never queries piecewise.
- **`otter_subjects`** — one row per subject. Queryable metadata is columnar;
  the nested `sections[] -> lessons[]` content stays JSONB (always loaded and
  saved whole). `subject_order` is now **genuinely persisted** — on disk it was
  recomputed by a regex "curriculum score" that rewrote every subject file on
  *every* list read, which as a cloud read would be N UPDATEs per page load.
- **`otter_progress`** — per-user study state, one row per `(course, user)`.
  On disk this lived in the course directory because O.T.T.E.R. was
  single-user; keying it to the course alone in a shared workspace would let
  two people studying one course silently overwrite each other. Owner-only, no
  admin bypass.
- **`otter_course_editors`** — per-user edit grants ("owners can add others to
  have edit access"). Composite FK to `workspace_members` (the 0013
  `project_members` shape) so a grant dies with the membership. A grantee
  cannot recruit further editors.
- **`otter_change_requests`** — a user who forked a company-standard course can
  propose their changes back with a written rationale; admins approve or
  reject. The proposer may keep refining or withdraw, never decide. A settled
  request can never be reopened (`fn_otter_cr_review`), and there is no DELETE
  policy at all — review history is retained.

### Helpers and RPCs

`otter_has_editor_grant` / `otter_is_course_owner` / `otter_course_visibility`
/ `otter_can_write_course` are all SECURITY DEFINER, each reading a *different*
table from the policy that calls it — that is what keeps the policy graph free
of the 0008 recursion trap — and all live-row, so a revoked grant takes effect
on the next statement rather than the next token refresh (the 0020
`has_rate_card_grant` convention).

`otter_fork_course(course_id, new_name)` backs "use the company standard course
instead of generating a new one": it copies a readable course and its live
subjects into a **personal** copy owned by the caller, recording
`source_course_id`. Forks are always born personal — taking a copy must never
republish anything. Because DEFINER bypasses RLS it re-asserts readability
itself.

### Trash

Soft delete with a 30-day sweep (`purge_otter_trash`, pg_cron
`wilson-purge-otter-trash` 04:55 UTC). **0014's `soft_delete_row()` could not
be reused** — `fn_trash_authz` hardcodes the seven RABBIT tables and authorizes
through `can_write_project()`, which has no meaning here.
`otter_soft_delete_row` / `otter_restore_row` are the O.T.T.E.R.-shaped
equivalents.

Two traps worth remembering, both found by probing rather than by reading:

1. `fn_otter_trash_authz` must **not** delegate to `otter_can_write_course()`.
   That helper filters `deleted_at IS NULL`, so routing restore through it made
   the trash a **one-way door** — the row being restored is by definition
   already hidden. It resolves its row directly instead, exactly as 0014's does.
2. The UPDATE policies carry an explicit `AND deleted_at IS NULL` in their
   WITH CHECK. 0014 relied on the *observation* that Postgres re-checks the
   SELECT policy against the NEW row; stating it makes the refusal explicit and
   version-independent, and forces every delete through the RPC where
   authorization and the `deleted_by` stamp actually live.

Identity columns are pinned by BEFORE UPDATE triggers
(`fn_otter_pin_course_identity` and siblings). Policies decide *who* may write
a row; without the pin a granted editor could still set `owner_id` to
themselves and steal the course, or move a subject between courses to smuggle
content across a visibility boundary.

### Deliberate exclusions

- **No storage bucket.** O.T.T.E.R. has zero binary content — no images, audio
  or uploads anywhere in the tool.
- **Not broadcast on any realtime topic.** The 0018 workspace channel delivers
  full row payloads to every subscriber, so personal course bodies must never
  ride it; and courses are not a live co-editing surface. Revisit only with a
  per-course topic in the 0016 `rabbit:project:{id}` style.
- **Not edit-history captured.** 0012's entity CHECK stays locked to the 13
  RABBIT tables — same precedent as `project_members` and `notes`.
- **Scraped reference page text is not migrated** (url + title only). It is a
  regenerable cache of third-party page content and does not belong in a shared
  multi-tenant database.

### Client seam

`src/tools/otter_v0.3.1/adapters/` — `otterFetch()` parses O.T.T.E.R.'s own API
paths and dispatches to Supabase when a workspace session exists, or to the
in-app Express server otherwise. The ~85 call sites in `Otter.jsx` and
`Validator.jsx` keep their exact `fetch(...).then(r => r.json())` shape, so the
diff is one identifier rather than a rewrite of a 4,600-line component.

In cloud mode the "slug" handed to the client is the course **UUID**. On disk a
course was identified by `slugify(name)`, which is only unique inside one
user's own folder — in a shared workspace two visible courses can legitimately
carry the same slug (your fork and the company standard). `Otter.jsx` never
interprets the slug: it looks courses up by NAME (`Otter.jsx:645, 1528, 3408`)
and passes the slug back only as an opaque URL key, so this is transparent. The
real slug stays on the row as the migration tool's natural key.

Migration tool: `src/cloud/migrate/runOtterMigration.js`. It reads with **raw
`fetch`, never `otterFetch`** — the latter routes to the cloud exactly when a
migration is running, which would copy the cloud onto itself and report
success.

### 0023 — `public.users` dropped

Vestigial since 0000 and FK-free since 0007. Worth removing rather than leaving
inert: `0011_role_grants.sql` grants ALL on every public table to `anon`, and
`public.users` was the only table in the schema that never had RLS enabled, so
PostgREST was exposing it as an unauthenticated read *and write* endpoint. It
was empty, so nothing leaked. The migration refuses to run if it finds rows.

pgTAP: `26_otter_courses.sql` (29) · `27_otter_subjects.sql` (18) ·
`28_otter_progress.sql` (13) · `29_otter_course_editors.sql` (14) ·
`30_otter_change_requests.sql` (16). `rls.yml` RLS_TABLES += the five tables,
replay list += 26–30.
