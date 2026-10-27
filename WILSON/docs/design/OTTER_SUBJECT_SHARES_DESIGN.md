# O.T.T.E.R. subject shares — the design (N2, 2026-10-27)

Phase 5c of the plan to 1.0 (`docs/sessions/PLAN_TO_1_0.md` §2; the brief is
`docs/sessions/briefs/po-n2-subject-shares-design.md`). Built on three rulings
of Audrey's from 2026-08-12, quoted in migration 0065's header and binding here:

> **"LIVE LINK. ACCEPT FIRST."**
>
> *"so if the receiver doesnt have the course in their library of the subject.
> you would add the new course and then place the subject in there. if the user
> already has that software/ language course, you add the new subject shared to
> that course."*
>
> *"each user should have their own progression of subjects. dont make it a
> universal one"*

and her answer of 2026-10-27: *"Build it before 1.0"*.

Migration 0065 (2026-08-12) is the draft this design starts from. It was applied
on no environment (CI builds it because the file is in the tree). B1 writes the
schema as **migration 0100** and removes 0065 in the same commit; the pgTAP suite
is **103**. What her rulings and the code do not decide is in
`docs/design/OTTER_SUBJECT_SHARES_QUESTIONS.md` (four questions, one batch);
where this design needs one of those answers it follows the recommended pick and
marks it **provisional (Sn)**, built so that a different answer is one change.

Measured on 2026-10-27 against `origin/feat/post-overhaul-edit-versioning`
(`c48dbb8d`): migrations 0022, 0025, 0045, 0046, 0064, 0065 and 0069; the
adapter, the routes, `Otter.jsx`, the Phase 5 components, `petKnowledge.js`;
`rls.yml`'s two coverage guards; suite 70 as the house pattern.

---

## 1. What a share is

**One subject, one owner, one receiver, in one workspace.** A share is a row
about two people (`otter_subject_shares`), never a property of the subject:
`otter_subjects` has no visibility column and keeps 0022's rule that a subject
is readable exactly when its course is. The share adds one more way to read
**one** subject, for **one** person, and nothing of the course around it.

| Term | Means |
|---|---|
| The subject | One `otter_subjects` row, by id. Its course stays the owner's. |
| The owner | The person whose course the subject is in (`otter_courses.owner_id`). Only they can share it (§2). |
| The receiver | One active member of the same workspace, chosen from the directory. |
| Live | The receiver reads the owner's row. An edit by the owner is seen at the receiver's next open of the subject (O.T.T.E.R. is on no realtime topic, 0022's decision, and a linked subject is read on each open rather than from the session cache, §5.4). |
| Read-only | The receiver can never write it: `otter_subjects_update` is untouched (writes need `otter_can_write_course` on the **source**), and the client shows no edit control on a linked subject. |
| The host course | The receiver's own course the linked subject is shown inside, found or made at accept (§1.2). |

### 1.1 The states

Stored `status`: `pending` → `accepted` → `revoked`; `pending` → `declined`;
`pending` → `revoked` (the owner withdraws before an answer). Nothing reopens.

| From | To | Who | What else is written |
|---|---|---|---|
| — | `pending` | the owner, `otter_subject_share()` | `shared_by`, `shared_with`, `workspace_id` from the server, an optional note (≤ 2000 characters) |
| `pending` | `accepted` | the receiver, `otter_subject_share_accept()` | `host_course_id`, `responded_at` |
| `pending` | `declined` | the receiver, `otter_subject_share_decline()` | `responded_at` |
| `pending` or `accepted` | `revoked` | the owner (withdraws, from either state) or, from `accepted` only, the receiver (removes it from their course; a pending offer is declined, not removed; **provisional (S3)**; round 1, finding 8), `otter_subject_share_revoke()` | `ended_by`, `responded_at` if unset; `host_course_id` is kept as history |

**Gone** is not stored; it is derived. A share whose subject or whose course is
in the trash, or whose course is no longer the sharer's, reads as `gone` in the
index (§3.6) and the link stops resolving at once (the consent helper checks
`deleted_at` on both). If the owner restores the subject within the 30 days, the
link resumes with nothing to redo; when the trash purge hard-deletes the subject,
the share row goes with it (`ON DELETE CASCADE`: "it disappears if I delete it").
A pending share whose subject was trashed cannot be accepted (the function
refuses) and reads `gone` to both.

**A declined share is a record**, as a declined change request and a declined
nomination are (0022, 0064): both people can read the row; the owner sees
*Declined* with the date; the row keeps the note and the subject's title and
course name **as they were when it was offered** (two snapshot columns written
at share time), never their live values, so a settled share stops telling its
ex-receiver anything about the subject from that moment (round 1, finding 2);
and the share never opened anything. Re-sharing after a decline or a revoke is
allowed (one **live** share per subject and person: the partial unique index).
There is no cooldown (§7).

### 1.2 Where it lands for the receiver

Her ruling, applied at accept, on the server, in one transaction:

1. **The receiver already has the course.** The match is the course's **key**:
   `otter_courses.slug` of a live course owned by the receiver in the same
   workspace. The slug is frozen at creation (`slugify` of the name the course
   was created with), is inherited verbatim by `otter_fork_course`, and is never
   re-derived on rename, so a receiver who forked the owner's course, or made
   their own "Blender 5.0", matches; one who renamed theirs still matches. It is
   never the typed name: `Otter.jsx` creates a course under `parsed.software_name
   || softwareNameInput` (the AI's name wins over what was typed), and two people
   can hold courses of one name with different keys. The subject is placed in
   that course.
2. **The receiver does not have it.** A personal course is created for them:
   the source's `slug`, `name`, `course_type` and `skill_level`, `visibility =
   'personal'`, owned by the receiver, with the empty reference documents (no
   hotkeys, functions or nodes are copied: a share is one subject, and a copy of
   the documents would be the copy she ruled out). The receiver can rename,
   fill, share or trash that course as any of theirs.
3. **The receiver has it under another software version.** "Blender 4.2"
   (`blender-4-2`) and "Blender 5.0" (`blender-5-0`) are two keys, so case 2
   applies and a "Blender 5.0" course is made for them. **Provisional (S2)**:
   the question offers letting the receiver choose the course at accept.

Two consequences, stated: a receiver whose matching course is in the **trash**
gets a new course (the match ignores trashed rows), and restoring the old one
later collides on the name (the adapter already says *"You already have a course
with this name. Rename that one first, then restore."*). And a linked subject is
**not a row of the host course**: the host's own `subject.list` never returns
it, so a receiver who later shares or publishes their host course shares only
their own subjects; the link stays theirs alone (§5.7).

### 1.3 The receiver's own progression, quiz scores and validator findings

`otter_progress` is one row per (course, user) and its `completed_lessons` is
keyed by subject **slug**: `{ "<slug>": { completed_lessons: [...], last_accessed } }`.
A linked subject is shown in the receiver's host course but belongs to the
owner's; keyed by slug it would collide with a subject of the same slug the
receiver already has (0065's trap), and two courses can hold subjects of one slug.

So the client keys a linked subject's progress **`link:<subject_id>`**, on the
receiver's progress row **for the host course**. The adapter's `progress.get` and
`progress.put` store the `subjects` map verbatim and tolerate any key, so no
schema or adapter change is needed; the client is the only place the key is
made, and `otterSharing.js` owns the one function that makes it (§5.5). This
gives her third ruling for free: the receiver's ticks are on their row, the
owner's on theirs, nobody reads the other's (`otter_progress` is owner-only with
no admin bypass), and the receiver's ticks **survive a revoke** (the row is on
their course). The orphaned key is kept, never pruned: if the owner shares the
same subject again its id is the same, and the ticks come back **when it lands
in the same host course** (a receiver who trashed and purged the first host gets
a new one at re-accept, and the old row's keys went with the purge; round 1,
finding 14). A subject a person can reach both through a `shared` course and
through a link has two progressions, one per row (the slug key on the shared
course's row, the `link:` key on the host's): two reads, two records, as the
rule says (round 1, note).

Quiz attempts (`otter_quiz_attempts`, 0045) record the courses the quiz was
drawn from as `{id, name}`; a linked subject ticked in the quiz picker records
the **host** course. Validator findings are session state on every subject
(handbook §13.2; her 2026-08-05 decision), so the receiver's audit of a linked
subject is theirs and is kept nowhere; *Request fixes* and *Accept* are not
offered on a linked subject, because a fix is a write to the owner's row (the
adapter would answer 403, *not allowed to edit this subject*).

Inherited, not new: lesson ids are positional (`lesson_1_1`), so an owner who
inserts a section shifts which lesson a tick names, for the receiver exactly as
for a colleague studying a shared course today.

---

## 2. Who may share and receive

**Share:** the **owner** of the course the subject is in, signed in to a
workspace (cloud mode), an active member of it. The function re-checks all
three on the live rows (`otter_courses.owner_id = auth.uid()`, the course and the
subject not trashed, `has_active_membership`). A granted editor cannot share
(consent is not transferable: the rule 0025 and 0064 enforce for their windows).
Whether an **admin** may share a subject from a colleague's **shared** or
**company-standard** course on the owner's behalf is **S1** (recommended: no;
the design and suite 103 are written to "owner only"). For a **personal** course
the code decides: an admin cannot read it, so cannot share from it.

**Receive:** any **active member of the same workspace**, any role, chosen from
the directory (`workspace_directory()` through `useWorkspaceMembers`, the list
the editor picker already uses), never yourself (a CHECK), never a deactivated
member (the function refuses: a share to a dead account would wait forever).
Sharing with an admin or a manager grants them exactly what it grants anyone:
one subject.

**Same workspace only, by construction.** `workspace_id` defaults to
`current_workspace_id()` and the client never sends it; the share function
requires the receiver's active membership **in that workspace**; the consent
helper requires the share's workspace to be the caller's active one and the
subject's workspace to be the share's; and `otter_subjects_select` begins, as
every policy does, with `workspace_id = current_workspace_id()`. `cloudMode` is
decided from nothing but `jwt.app_metadata.workspace_id`, so a person who
belongs to two workspaces reads a link only while the workspace it was made in
is the active one. A cross-workspace share cannot be inserted: the function
refuses it, and the guard trigger refuses any insert whose subject is not in the
row's workspace, armed or not, from any role (round 1, finding 1). A row forged
past both (the trigger disabled by the table's owner) opens and lists nothing
across the boundary: the helper, the index and the policy each carry the
workspace predicate, and suite 103 forges exactly that row to prove it. The claim
is about a **cross-tenant** forgery; a row forged inside the subject's own
workspace, naming its real owner, is a forged consent, and preventing that is
the service role's job, not RLS's (round 1, finding 9).

**Managers** have no special part: unlike a nomination, a share is between two
people and is not workspace business. **Admins** see no share row (the SELECT
policy names the two parties); they see the audit lines in `app_events` (§3.7),
which carry ids and never a title, as `otter_course_index()` shows them that a
personal course exists and not what is in it. `otter_course_index()`'s
`subject_count` counts a course's own subjects, not links.

**When the receiver is deactivated** they read nothing (`has_active_membership`
in the policy and the helper); reactivated, the link resumes. **When the owner
leaves** (deactivated) is **S4**, hers: the design and the SQL are written to
the recommended answer, *the link stays live*, as a `shared` course stays
readable after its owner leaves and as no consent window in the schema (0025,
0064) consults the proposer's membership; its cost, said in the question, is
that nobody but the receiver can then end it short of an admin trashing the
course (`otter_soft_delete_row` admits an admin), because the deactivated owner
is not active and cannot call the function (round 1, finding 7). Her other
choices are a link **paused** while the sharer is inactive (one more predicate
in the helper, nothing written) or **ended for good** at deactivation. A
workspace teardown cascades the rows away. Ownership transfer does not exist
(the identity-pin triggers), so `src.owner_id = shared_by` is kept in the helper
as 0065's defence and nothing more.

---

## 3. The schema as migration 0100 (0065 retired by B1)

The SQL is Appendix A, whole. This section says what it does and why it differs
from 0065; B1 copies the appendix into `supabase/migrations/0100_otter_subject_shares.sql`
and removes `0065_otter_subject_shares.sql` in the same commit (0065 was applied
nowhere; CI rebuilds from the files present; `rls.yml`'s `KNOWN_UNCOVERED` entry
for the table goes, and `otter_subject_shares` joins `RLS_TABLES` with suite
103). 0100 also drops 0065's trigger and function names in case a database ever
carried them (none does outside a CI run).

### 3.1 What changes from 0065

| 0065 (the draft) | 0100 (this design) | Why |
|---|---|---|
| The client INSERTs and UPDATEs the table; three policies and a trigger decide | **Every write goes through four SECURITY DEFINER functions**: `otter_subject_share`, `_accept`, `_decline`, `_revoke`. `authenticated` holds **SELECT only**; there is no INSERT, UPDATE or DELETE policy (RLS default-denies an unpoliced verb, 0045's lesson) | The brief's rule (the approval pattern 0025 and 0064 use), and a smaller surface: one SELECT policy to reason about, and the transition table lives in one trigger instead of being split between a policy's WITH CHECK and a trigger |
| One GUC arms the accept trigger | **Two GUCs, two id spaces**: `wilson.otter_subject_share_insert` carries the **subject** id for the insert, `wilson.otter_subject_share_update` the **share** id for a transition; the guard trigger refuses any unarmed write, from any role | 0064's lesson: one GUC holding two kinds of id authorises the wrong row eventually. The trigger also binds `service_role` and the runner, which bypass RLS but not triggers |
| No audit | **One `app_events` line per transition** (WIL-4110 shared, 4111 accepted, 4112 declined, 4113 revoked), stream `admin`, ids only | The brief asks for the audit lines; the TPN posture wants who-did-what; admins learn nothing a title would tell them |
| `host_course_id` is nulled on revoke | **Kept** on a revoke from `accepted` (history); nulled on decline; `ended_by` added | The receiver's notice can say which course it left; the owner's list can say who ended it |
| Lists read the table | **`otter_subject_shares_index()`** serves both sides' lists with the live subject title, course name, both labels, the derived `state`, and `host_live` | The receiver of a pending share may not read the subject yet (not accepted), so the title has to come from a definer read; one function for the inbox, the sent list, the linked rows and the pet |
| Suite 71 | Suite 103 | 71 is milestones now |
| The row carries ids only | **Two snapshot columns**, `subject_title` and `course_name`, written at share time | A settled share (declined, revoked) shows its ex-receiver what the subject was called when it was offered, never its live title (round 1, finding 2) |
| The helper | The helper **and the index** carry `sub.workspace_id = s.workspace_id` (the index `src.workspace_id` too), and the guard trigger refuses an insert whose subject is in another workspace | Belts: a cross-tenant row cannot be made, and one forged past the trigger opens and lists nothing (round 1, finding 1) |

Unchanged from 0065, deliberately: the table's columns and defaults (the client
sends nothing but what the functions take), the CHECKs, the partial unique index
(one live share per subject and person), the three lookup indexes, `FORCE ROW
LEVEL SECURITY`, the `fn_audit_touch` trigger, no DELETE for anyone but the
cascade, the consent helper as plpgsql SECURITY DEFINER STABLE (not inlinable into
the policy's qual, so no role test can leak into a personal-content SELECT
policy), `otter_subjects_select` as 0022 plus one arm, and `otter_subjects_update`
untouched.

### 3.2 The table

`otter_subject_shares`: `id`, `workspace_id` (default `current_workspace_id()`,
FK to workspaces, cascade), `subject_id` (FK to `otter_subjects`, **cascade: the
feature**), `shared_by` (default `auth.uid()`), `shared_with`, `status`,
`message`, `subject_title` and `course_name` (snapshots of the subject's title
and its course's name at share time, as 0045 snapshots a quiz's course names: a
settled row keeps what it was called, never what it is called now; round 1,
finding 2), `host_course_id` (FK-less on purpose, as `archive_course_id` is: a
pointer that outlives the course it names), `responded_at`, `ended_by`, the four
audit columns. CHECKs: the four statuses; not to yourself; the note ≤ 2000; the
snapshots within the source columns' own bounds (300 and 200); an accepted share
has a host and a pending or declined one has none; a revoked share names who
ended it; a pending share has no `responded_at` and a settled one has. Indexes
as 0065. `shared_by` and `shared_with` are FK-less (the 0007 convention: a
record survives an `auth.users` row disappearing; the directory row carries the
label).

### 3.3 The consent helper and the one arm

`otter_has_accepted_subject_share(p_subject_id)` is true when the caller is an
active member of their workspace and a share row in that workspace names them as
receiver, is `accepted`, names this subject, the subject and its course are not
trashed, the subject's workspace is the share's, and the course is still the
sharer's. `otter_subjects_select` becomes 0022's predicate with `OR
public.otter_has_accepted_subject_share(id)` inside the parent-EXISTS group, so a
subject of a readable course is readable as before and **one more row at a
time** becomes readable through a share. The parent course is not opened: the
receiver reads the subject and nothing of `otter_courses`, the other subjects, or
the documents. The UPDATE policy does not name the helper (a post-condition
refuses the migration if it ever does). The arm costs a three-table lookup per
subject row whose course EXISTS fails (the OR short-circuits left to right and
the helper is STABLE); a person's own and shared courses never reach it, and a
linked subject is read one row at a time by id (round 1, note).

### 3.4 The guard trigger

`fn_otter_subject_share_guard` BEFORE INSERT OR UPDATE: refuses an insert not
armed with the row's subject id, and one whose subject is not in the row's
workspace (read as definer: the invariant `fn_otter_editor_grant_workspace`
asserts for grants, here for shares; round 1, finding 1), and an update not
armed with the row's id; pins `id`, `workspace_id`, `subject_id`, `shared_by`,
`shared_with`, `message`, `subject_title`, `course_name`, `created_at`,
`created_by`; allows exactly the transitions of §1.1 and raises in words for any
other; stamps `responded_at`; requires `ended_by` on a revoke and clears it
otherwise; requires a host on accept, clears it on decline, keeps it on revoke;
and on an update with no status change lets nothing else move.
`fn_audit_touch` runs first (name order, `_audit` before `_guard`) and touches
only `created_by`/`updated_by`/`updated_at` on insert and the two `updated_*` on
update, so the two never fight over a column.

### 3.5 The four functions (all SECURITY DEFINER, `search_path = public`)

| Function | Who | Checks, in order | Writes |
|---|---|---|---|
| `otter_subject_share(p_subject_id, p_shared_with, p_message)` → share id | the owner | active member; receiver named and not self; subject live and in this workspace; its course live, in this workspace, **owned by the caller**; receiver an active member of this workspace; note ≤ 2000; no live share for (subject, receiver) ("already shared with that person": the unique index catches the race). A stub may be shared: it is an outline that fills live when the owner writes it (round 1, finding 12) | the row (armed, with the title and course-name snapshots), WIL-4110 |
| `otter_subject_share_accept(p_share_id)` → host course id | the receiver | active member; share in this workspace; `shared_with` is the caller; `pending`; subject live **and in this workspace** (round 1, finding 1); course live and still the sharer's; the host match by slug, else the personal course made (§1.2) | the course if made, the row (armed), WIL-4111 |
| `otter_subject_share_decline(p_share_id)` | the receiver | active member; share in this workspace; `shared_with` is the caller; `pending` | the row (armed), WIL-4112 |
| `otter_subject_share_revoke(p_share_id)` | the owner (`pending` or `accepted`), or the receiver (`accepted` only: a pending offer is declined, not removed; **provisional (S3)**; round 1, finding 8) | active member; share in this workspace; caller is `shared_by` or `shared_with`; the state allowed for that caller | the row (armed, `ended_by` = caller), WIL-4113 |

Every refusal is a sentence written for a person; the adapter passes them
through, as it does for nominations. The accept function's INSERT into
`otter_courses` runs the audit trigger (`created_by` = the receiver) and no pin
trigger (those are BEFORE UPDATE), so there is no silent-revert hazard. A race
between accept and the receiver creating the same course by hand ends in the
owner-slug unique index's 23505, surfaced in words.

### 3.6 The index function

`otter_subject_shares_index()` (STABLE, SECURITY DEFINER, membership re-checked
on the live row) returns every share in the caller's active workspace where they
are the sharer or the receiver **and whose subject and course are in that
workspace** (the belt the helper carries, so a forged cross-tenant row lists
nothing; round 1, finding 1): the share's ids and status, `state` (`gone` when
the subject or course is trashed or the course changed hands; else the status),
both people's labels, the note, the dates, `ended_by`, `is_mine`, and then
**what each side may learn**, decided in the function and not by the client:

| Row | The owner sees | The receiver sees |
|---|---|---|
| `pending` | the live title and `is_stub`, the course's id, name, slug, type and skill level (their own) | the **title**, whether it is an outline only (`is_stub`), the course's **name**, the sharer's label and the note: the minimum to decide on (round 1, finding 10). Course id, slug, type, skill level: null |
| `accepted` | as above; `host_course_id` and `host_live` **null** (the receiver's course is theirs, and whether they trashed it is not the owner's to learn; round 1, finding 11) | the live title and `is_stub`, the course's id, name, slug, type and skill level (they can read the subject row itself now), `host_course_id`, `host_live` (the host exists and is not trashed) |
| `declined`, `revoked` | the live columns (the owner can read their own subject anyway) | the **snapshots only** (`subject_title`, `course_name` as they were when offered); every live column null (round 1, finding 2) |

No description, no body, no other subject, ever.

### 3.7 The audit lines

One `app_events` row per transition, `event_type = 'admin'`, `severity =
'info'`, codes **WIL-4110** (shared), **4111** (accepted), **4112** (declined),
**4113** (revoked), `context` = `{share_id, subject_id, course_id, shared_by,
shared_with}` plus `host_course_id` on accept and `ended_by_role`
(`owner`/`receiver`) on revoke. Never a title, a name or a body. The write
succeeds because the functions run as their owner, which must bypass RLS
(`app_events_insert` refuses the `admin` stream and WIL-41xx to everyone else):
0100 opens with 0069's preflight and closes with the same check as a
post-condition. An audit failure is a failure: it is in the same transaction and
rolls the transition back, which is the right way round for a consent record.

### 3.8 The grants (the PUBLIC lesson)

`CREATE FUNCTION` grants EXECUTE to PUBLIC by Postgres's own default (0011 once
re-armed it by default privileges as well; 0033 disarmed that, and 0030 and 0033
are the replay rule in handbook §4.9), so every function here names **PUBLIC** in
its REVOKE (round 1, note): the four functions, the index
and the helper are `REVOKE … FROM PUBLIC, anon` then `GRANT … TO authenticated,
service_role`; the guard trigger function is `REVOKE … FROM PUBLIC, anon,
authenticated`. A SECURITY DEFINER function is reachable at `/rest/v1/rpc/` by
anyone it is granted to, so each function begins by re-deriving who is calling
from `auth.uid()` and the live membership row, and trusts no argument. On the
table: `REVOKE ALL FROM PUBLIC, anon, authenticated`, `GRANT SELECT TO
authenticated`, `GRANT ALL TO service_role`. Post-conditions assert each of these
with `has_table_privilege` and `has_function_privilege('anon', …)` (anon is a
member of PUBLIC, so a PUBLIC grant shows there).

### 3.9 Post-conditions, and the ordering rule

The `DO` block at the foot refuses the migration unless: RLS is enabled and
forced; exactly one policy exists and it is SELECT; `anon` holds nothing and
`authenticated` holds SELECT and not INSERT, UPDATE or DELETE; the two defaults
are `current_workspace_id()` and `auth.uid()`; the link arm is in
`otter_subjects_select`, 0022's `otter_courses` EXISTS, `has_active_membership`
and `deleted_at IS NULL` survived in it, and the arm is absent from
`otter_subjects_update`; `current_app_role` appears in no SELECT policy on
`otter_courses`, `otter_subjects` or `otter_progress`; the partial unique index
exists **with its predicate**; the seven functions exist and the guard trigger
is BEFORE, for INSERT and for UPDATE (`pg_trigger.tgtype`, not only its name);
none of the seven is executable by `anon`; the guard's body carries both arms
**with comments stripped first** (0069's lesson: a `LIKE` on
`pg_get_functiondef` is satisfied by a commented-out arm); the functions' owner
bypasses RLS (round 1, finding 16).

**Ordering rule:** 0100 redefines `otter_subjects_select` (0022). A by-hand
replay of 0022 must be followed by 0100, or links silently stop being readable
while every post-condition still passes. B1 adds the row to handbook §4.9.

---

## 4. pgTAP suite 103

`supabase/tests/rls/103_otter_subject_shares.sql` (the name the two-directional
guard demands: `NNN_<table>.sql`). The house pattern is suite 70: the client's
exact call shapes, `tests.login_as` for members, claims built by hand for an
admin (it sets no `app_role`), every scalar read `ORDER BY id LIMIT 1`, and the
control before the probe it controls.

**Fixtures** (as the runner): workspace A with `user_a` (admin, from
`rls_setup`), `user_c` the **owner**, `user_d` the **receiver**, `user_e` a
**third person** who also holds an **editor grant** on C1 (so "a granted editor
cannot share" has a subject), `user_f` a **deactivated** member; workspace B
with `user_b`. `user_c` owns C1 `blender-5-0` "Blender 5.0" (personal) with
subjects S1 `modifiers` and S2 `rigging`, C2 `houdini` "Houdini" (personal) with
S3 `sops` and a stub S5 `vops`, and C3 `shared-topic` (visibility `shared`) with
S4. `user_d` owns D1 `blender-5-0` "My Blender" (same slug, a different name,
and its own subject `modifiers`: the key decides and the slugs may coincide).
Shares made in the suite: SH1 S1 → d; SH2 S3 → d (no Houdini course on d's
side); SH3 S4 → d (from a shared course); SH4 S2 → e (to be declined); SH5 a
cross-workspace row the runner forges **with the guard trigger disabled**
(`ALTER TABLE … DISABLE TRIGGER trg_otter_subject_share_guard`, the row, then
`ENABLE TRIGGER`): with the trigger on, the forgery is refused even when armed,
which is its own probe; SH6 S1 → d again after a revoke; SH7 the stub S5 → d;
SH8 S5 → e, made to be trashed before e can accept.

Arming by hand: the suite is one transaction, and a GUC set with
`set_config(…, true)` lasts to its end, so every probe that arms a GUC resets it
to `''` straight after, and each "unarmed" probe first asserts the GUC reads
empty (round 1, finding 6).

### 4.1 The matrix

Each cell is what the actor gets when they try; a probe per cell.

The anon column is **42501** throughout: `anon` holds no privilege on these
tables and no EXECUTE on these functions (0033's sweep), so a probe written as a
count would abort the file; those cells are probed with `throws_ok`,
`has_table_privilege` and `has_function_privilege` (round 1, finding 5).

| | Owner (c) | Receiver (d) | Third person (e; a granted editor on C1) | Another workspace (b, active in B) | anon |
|---|---|---|---|---|---|
| Read S1 before accept | 1 row | 0 | 0 | 0 | 42501 |
| Read S1 after accept | 1 | **1** (the arm) | 0 | 0 | 42501 |
| Read S2, C1, C1's documents after accept | yes | **0** (0022's rule kept) | 0 | 0 | 42501 |
| Read S2 after e declines SH4 | 1 | — | 0 | — | 42501 |
| Read S1 after the owner revokes | 1 | 0 | 0 | 0 | 42501 |
| Read S3 while trashed / after restore / after purge | 0 (trashed) / 1 / gone | 0 / 1 / the share row is gone | 0 | 0 | 42501 |
| Read S1 after the owner is deactivated (before any revoke) | — (not active) | 1 (the link survives; S1 is in a **personal** course, so only the arm can be opening it; **S4**) | 0 | 0 | 42501 |
| Read the share row | yes | yes | 0 (and 0 as `user_a`, an admin) | 0 | 42501 |
| UPDATE S1 | 1 row | 0 rows, before and after | 0 | 0 | 42501 |
| INSERT the share row directly | 42501 | 42501 | 42501 | 42501 | 42501 |
| UPDATE the share row directly | 42501 | 42501 | 42501 | 42501 | 42501 |
| `otter_subject_share(S1, d)` | ok | raises (not the owner) | raises (an editor grant is not consent) | raises: *subject not found in this workspace* (b is active in B, so membership passes; round 1, finding 17) | 42501 |
| `otter_subject_share_accept(SH1)` | raises | ok → D1 | raises | raises | 42501 |
| `otter_subject_share_decline(SH4)` | raises | raises (not its receiver) | ok | raises | 42501 |
| `otter_subject_share_revoke(SH1)` | ok, `ended_by` = c | ok from `accepted`, `ended_by` = d; raises while `pending` (**S3**) | raises | raises | 42501 |
| `otter_subject_shares_index()` | SH1..SH4, SH6, SH7, SH8 (`is_mine`) | SH1, SH2, SH3, SH6, SH7, with S1's title before accept and the pending row's course id, slug, type and skill level null | none | empty before SH5 **and after it** (the belt lists no cross-tenant row) | 42501 |
| Progress for the link, on D1, key `link:<S1>` | cannot read d's row | upsert ok | — | — | 42501 |
| Progress on C1 (the owner's course) | own row | refused (the course is not readable) | refused | refused | 42501 |
| The helper `otter_has_accepted_subject_share(S1)` | false (not a receiver) | true after accept, false after revoke | false | false, even with SH5 forged | 42501 |

### 4.2 The probes, in timeline order

1. **Structure (9):** the table; FORCE RLS; the seven functions; the guard
   trigger is BEFORE, for INSERT and for UPDATE (`tgtype`); the partial unique
   index with its predicate; exactly one policy, cmd SELECT; `authenticated`
   has SELECT and not INSERT/UPDATE/DELETE; `anon` nothing on the table; `anon`
   cannot execute any of the seven.
2. **Sharing, as c (13):** SH1 returns a uuid; its `status` `pending`,
   `shared_by` c, `workspace_id` A (the defaults); its `subject_title`
   "Modifiers" and `course_name` "Blender 5.0" (the snapshots); SH1 again →
   *already shared*; to self → raises; to `user_f` → raises; to `user_b` →
   raises; SH3 from the shared course → ok; SH7, the stub S5 → ok (an outline
   may be shared); a direct INSERT → 42501; as e (a granted editor on C1),
   sharing S1 → raises; as a (claims by hand, admin) sharing S1 → raises
   (**S1**; flips if she answers otherwise); as b in B, sharing S1 → raises
   *subject not found in this workspace*. SH2 and SH4 made here too.
3. **Before accept (10):** d reads S1: 0; d reads C1: 0; d reads SH1's row: 1;
   e reads no share row; a (admin, claims by hand) reads no share row; b (in B)
   none; anon → 42501; d's index lists SH1 with `subject_title` "Modifiers",
   `course_name` "Blender 5.0", `sharer_label` "User C", `state` `pending`, and
   `course_id`, `course_slug`, `course_type`, `skill_level` **null** (the
   pending receiver's disclosure); e's index is empty.
4. **Accept (13):** e → raises; c → raises; d's direct UPDATE → 42501; d accepts
   SH1 → returns D1 (slug matched, name ignored); the row `accepted`, `host`
   D1, `responded_at` set; again → raises; d accepts SH2 → returns a new course:
   owner d, slug `houdini`, name "Houdini", `personal`, `hotkeys` at its default
   (nothing copied), `created_by` d; d accepts SH3 → a D-side course for
   `shared-topic` made; d accepts SH7 → lands in the Houdini course just made
   (the same slug, a second link in one host).
5. **After accept (14):** d reads S1: 1; S2: 0; C1: 0; C1's `hotkeys` through
   the table: 0 rows; d lists `otter_subjects WHERE course_id = C1` (what
   `subject.list` on the owner's course id would ask): exactly S1 and its list
   columns (the second door, consented; round 1, note); d UPDATEs S1: 0 rows; d
   INSERTs a subject into C1: refused; e reads S1: 0; b: 0; d upserts
   `otter_progress` on D1 with `{"link:<S1>": {...}}`: ok, and reads it back; d
   inserts progress on C1: refused; c reads d's row: 0; the helper as d: true;
   as e: false; as d for S2: false.
6. **The forged row (7):** as the runner, an **armed** insert of a row naming
   workspace B and subject S1 → raises (the guard's workspace invariant), and
   the arm is reset to `''`; the runner disables the guard trigger, inserts SH5
   (`workspace_id` B, `shared_with` b, `shared_by` c, `subject_id` S1, `status`
   accepted, a host id, the snapshots filled) and re-enables it; as b in B: the
   helper for S1 is **false** (the subject's workspace is not the share's), S1
   reads 0, and b's index is **empty** (the belt lists no cross-tenant row;
   round 1, finding 1); as the runner, after asserting the update GUC reads
   empty, an **unarmed** update of SH4's note raises (the guard binds the
   runner); and an armed update of SH1 with **no status change** that tries to
   move `host_course_id` leaves it where it was (the guard's no-transition arm).
7. **Decline (9):** c declines SH4 → raises; d declines SH4 → raises; e revokes
   SH4 while pending → raises (a receiver declines, never removes, what they
   have not accepted; **S3**; round 1, finding 8); e declines → `declined`,
   `responded_at` set, `host` null; again → raises; e reads S2: 0; c renames S2
   to "Rigging II" → e's index still shows SH4 as "Rigging" with `course_slug`
   null (the snapshot, not the live title; round 1, finding 2); c's index shows
   SH4 `declined` with the live title (the record).
8. **Trash, restore, purge (9):** c trashes S3 (`otter_soft_delete_row`) → d
   reads S3: 0; d's index shows SH2 `state` `gone`; c restores → d reads S3: 1,
   `state` `accepted`; c shares S5 → e (SH8), then trashes S5 → e accepts SH8 →
   raises *that subject no longer exists*; d's SH7 reads `gone` meanwhile; c
   restores S5 → SH7 `accepted` again; the runner hard-deletes S3 → SH2's row is
   gone; d's progress on the Houdini host still holds its `link:` key.
9. **The owner leaves, the receiver leaves (6):** the runner deactivates c →
   d still reads S1: 1 (SH1; S1 is in a personal course, so only the arm opens
   it); c's revoke of SH1 → raises (not active); the runner reactivates c; the
   runner deactivates d → d reads S1: 0, and d's index raises
   `not_a_workspace_member`; the runner reactivates d → d reads S1: 1 again.
10. **Revoke (11):** e revokes SH4 (declined) → raises; e revokes SH1 → raises;
    c revokes SH1 → `revoked`, `ended_by` c, `host_course_id` **kept**,
    `responded_at` kept; d reads S1: 0; the helper as d: false; d's index shows
    SH1 with the snapshot title and every live column null; d's D1 progress row
    is untouched; c shares S1 → d again (SH6, allowed: no live row); d accepts
    SH6 → D1; d revokes SH6 → `ended_by` d (**S3**); d reads S1: 0; c revokes
    SH3 (accepted) → ok (the owner withdraws from a shared course's subject; d
    still reads S4 through 0022's `shared` arm, which is the point: the share
    and the tier are two different reads).
11. **Audit (6):** WIL-4110 count = 7 (SH1, SH2, SH3, SH4, SH6, SH7, SH8; the
    refusals and the forged row wrote none); 4111 = 5 (SH1, SH2, SH3, SH6,
    SH7); 4112 = 1; 4113 = 3 (c on SH1, d on SH6, c on SH3); every row's
    `context` has no `subject_title`, `title` or `name` key and `event_type`
    `admin`; as a (admin, claims by hand) the rows read; as e they do not.
12. **Belt (3):** the link arm is in `otter_subjects_select` and not in
    `_update`; `current_app_role` is in no SELECT policy of the three tables;
    no DELETE policy on the share table.

About **110** probes; B1 counts the plan. **Failing controls** (each must
redden exactly its probes, and B1 runs each once): the arm removed from the
policy → every "d reads S1: 1"; the helper without `status = 'accepted'` → "d
reads S1 before accept: 0" goes red the other way; `GRANT INSERT, UPDATE TO
authenticated` → the two 42501 probes; the accept function without the
`shared_with` check → "c accepts → raises"; the helper without the workspace
belt → the SH5 helper probe; the index without its workspace belt → b's index
lists SH5; the index serving the live title to a settled receiver → the
"Rigging II" probe; the index without the pending receiver's nulls → probe 3's
null columns; the guard's workspace invariant removed → the armed cross-tenant
insert no longer raises; the guard's update arm removed → the runner's unarmed
update no longer raises (the "direct UPDATE → 42501" probes stay green either
way, which is why that runner probe exists); the audit `context` with the title
→ the no-title probe.

---

## 5. The client

### 5.1 The adapter and the routes (B1)

Six operations, all `cloudOnly` under `/api/otter/` (in local mode `otterFetch`
answers 501 *This O.T.T.E.R. feature needs a signed-in workspace*, as for every
Phase 5 route; the dev fixtures answer them as they answer nominations: lists
empty, writes refused in words, the id read 404):

| Route | Op | Does |
|---|---|---|
| `GET /api/otter/subject-shares` | `share.list` | `rpc('otter_subject_shares_index')` → the rows as returned (no derived key on the wire: the client makes it with `linkKey()`, the one definition; round 1, finding 13) |
| `POST /api/otter/subject-shares` `{subject_id, shared_with, message}` | `share.create` | `rpc('otter_subject_share', …)` → `{id}`; a 23505 becomes the function's own *already shared* sentence |
| `POST /api/otter/subject-shares/:id/accept` | `share.accept` | `rpc('otter_subject_share_accept')` → `{host_course_id}` |
| `POST /api/otter/subject-shares/:id/decline` | `share.decline` | `rpc('otter_subject_share_decline')` → `{ok}` |
| `POST /api/otter/subject-shares/:id/revoke` | `share.revoke` | `rpc('otter_subject_share_revoke')` → `{ok}` |
| `GET /api/otter/subjects/:id` | `subject.getById` | `from('otter_subjects').select(SUBJECT_FULL_COLS + ', course_id').eq('id', id).maybeSingle()` (`course_id` is not among the full columns today; round 1, finding 3); **no row is 404** (RLS hid it: the link ended, or the subject is in the trash), and that 404 is a signal the client acts on (§5.4); the wire is `toSubjectWire(row, row.course_id)` plus `id` and `linked: true` |

The `subject.list` and `subject.get` wires gain the row's **`id`** (today
neither carries it, so the owner's client would have had nothing to share with;
the fixtures' wire too; round 1, finding 3). Every refusal the functions raise is
passed through verbatim (they are written for people), as `nomination.update`
does. `export.all` gains each course's
accepted linked subjects as `linked_subjects` (full bodies through
`subject.getById`, each with `linked_from: {course_name, owner_label}`): the
export is a claim about completeness, and the receiver's progress rows already
carry the `link:` keys verbatim.

### 5.2 Where a share is offered (the owner)

Phase 5's lesson is that sharing was unfindable until it sat in the one menu a
person opens on a course row, so the subject share sits there too: `CourseRowMenu`
gains **"Share a subject…"** beside *Share or submit…* (owner only, cloud only;
the trigger's label names the verb; the menu sees only the course row, so it
does not gate on the subjects, and a stub may be shared, marked *outline only*
in the picker; round 1, finding 12). It opens `ShareSubjectDialog` with a
subject picker. The same
dialog opens, pre-filled, from the study view of one of the owner's own subjects:
a **Share…** action in that view's title row (where the course view already puts
its actions). Not on the sidebar's subject row and not on the card: the 200px
sidebar row already holds a name and a delete control, and the brief's rule for
new chrome is subtract first.

**`ShareSubjectDialog`** (the kit `Dialog` at `width="form"`, as the share
dialog): title *Share a subject*, the subtitle the subject's title (or a `Select`
of the course's subjects when opened from the menu); **With**, a `Select` of
active members except the owner, from `useWorkspaceMembers` (the editor picker's
list); **A note for them** (optional, 2000 characters, live count); one plain
line that is the contract: *"They will read this one subject inside their own
«Blender 5.0» course, live and read-only, once they accept. Nothing else in your
course is shared, and their progress is their own."*; **Share**. Success closes
on *Shared with Mara. It is waiting for them to accept.* (the kit `Banner` in the
library); a refusal is the function's sentence in the Dialog's footer. **Several
colleagues at once**: the picker multi-selects and the dialog calls the function
once per person, reporting each; one row per person is the model either way
(decided without asking, as the questions file says; round 1, note).

### 5.3 Where a pending share appears (the receiver), accept and decline

**The Requests view**, not a notice, for three reasons: it is already the home of
every O.T.T.E.R. thing waiting on a person (change requests, nominations), so it
is where they will look (Jakob); a share is an offer with no deadline, and a
banner on every library load until it is answered would nag (a notice is for an
outcome, which is how the library's banners are used today); and the kit `Tabs`
carries a `count`, so the **Requests** tab (or **Admin**, for an admin) shows
the number of shares waiting on them from the moment the library loads, quietly
and persistently.

`RequestsView` gains two sections at the top, each drawn only when it has rows:

- **Shared with you** (the receiver): one row per share where `shared_with` is
  me and `state` is `pending`: the subject's title, *from Audrey · Blender 5.0 ·
  2 days ago*, the note if any, **Accept** and **Decline**. Accept calls the
  function, re-reads the course list (the host may be new), selects and expands
  the host course with the linked row marked, and says *«Modifiers» is now in
  your Blender 5.0 course, linked live from Audrey. It stays read-only; your
  progress is your own.* Decline removes the row with no further word. A row
  whose `state` is `gone` reads *No longer available* with Dismiss (a decline).
  Accepted shares whose host course is gone (`host_live` false: the receiver
  trashed it) are listed here too, as *Its course in your library was deleted:
  restore it from Recently deleted, or remove this link*, with **Remove**.
- **Shared by you** (the owner): every share where `shared_by` is me, newest
  first: the subject, the person, the state in words (*waiting*, *accepted*,
  *declined*, *withdrawn*, *they removed it*, *no longer available*) and, on a
  pending or accepted row, **Withdraw** (a confirm: *Mara will lose the link.
  Her own progress stays hers.*). Decided rows fold under *Show decided*, as
  change requests do.

The view's description line for a plain member gains *and subjects shared with
you*. The `refreshTick` pattern stays: the share dialog bumps it on close.

### 5.4 The linked subject inside the receiver's course

The client holds the share index (`subjectShares` state, loaded with the course
list in cloud mode, re-read after any share action, when the Requests view
mounts, and when a course is selected: one cheap RPC). For a host course the
rows drawn are the course's own subjects (as today) followed by the **linked
rows**: the accepted shares whose `host_course_id` is this course and
`host_live`, in accept order.

| Surface | How a linked row reads | What is not there |
|---|---|---|
| Sidebar 2 | the title with a chain glyph (`Link2`) in place of the order number, hint *Linked from Audrey's Blender 5.0 · read only* | the delete control |
| The course view's card | the title, a **Linked** badge (`CourseBadges.jsx`, the kit `Badge` with `Link2`, hint as above) in the badge row, the skill level as today; a stub reads *Outline only — the owner hasn't written this yet* (today's words) | the delete control, Generate |
| The study view | the breadcrumb *My Blender › Modifiers*, the title, and under it one line: *Linked from Audrey's Blender 5.0 · read only · you see her edits as she makes them*, with the **Linked** badge; lessons, sections, the completion ticks and Previous/Next as on any subject | lesson editing, regenerate, delete, the validator's fixes, the agent's Apply (the agent is told the subject is read-only and its apply path would be refused by the database anyway) |
| A row whose `state` is `gone` | stays, greyed, *No longer available — the owner removed it*, with **Remove** | it does not open |

**Live, as of the open, and in no session cache.** A linked subject's body is
fetched by `subject.getById` on each use and is **never written to any session
cache**: not `subjectCacheRef`, not `quizSelectionData`, not the Validator's
cache, not search's. Every reader that holds bodies today (the study view, the
quiz's `getQuizContent`, the Validator's prefetch, `performSearch`) reads a
linked body live by id at the moment it needs it, so a revoked subject's words
cannot be quizzed on, searched or sent to the AI from a cache for the rest of
the session (round 1, finding 4); the quiz picker's linked rows come from the
live `subjectShares` state, not from `quizSelectionData`. The one body in
memory is the open `activeSubject`, until the person navigates (round 1, note).
The owner's edits are therefore seen at the next open. A 404 on an open means
the row is no longer readable; the client re-reads the share list first and
lets the index's `state` choose the words (round 1, finding 20): `gone` →
*«Modifiers» is no longer available: the owner removed it. It comes back if they
restore it.*; `revoked` → *«Modifiers» is no longer shared with you.*; either
way the row leaves the course and the pet's index is cleared (§5.6). The
`activeSubjectKey` (§5.5), not the slug, drives the active-row highlight in the
sidebar and every cache key for the host's own subjects, so a linked
`modifiers` never lights up the host's own `modifiers` (round 1, finding 19).

**Remove from my course** (the receiver's revoke, **S3**) sits in the study
view's title row of a linked subject, behind a confirm (*It leaves your course.
Your ticks are kept, and come back if it is shared with you again.*).

**The owner's side of a shared subject**: the study view of an owned subject that
has live shares shows one line, *Shared with Mara · Ben (waiting)*, which opens
the Requests view. The subject delete confirm, when the subject has live shares,
adds *Shared with 2 people: the link stops for them while it is in the trash and
ends when it is purged.*

### 5.5 The progression key

`otterSharing.js` gains the one definition: `linkKey(subjectId) → 'link:' +
subjectId` and `isLinkKey(key)`; nothing on the wire carries the key, so it
cannot drift between B1's adapter and B2's client (round 1, finding 13). The
client's "active subject key" is the slug for an own subject and `linkKey(id)`
for a linked one; `toggleLessonComplete`, `completedLessonsCache` and
`getCurrentProgressPercent` read and write
`activeProgress.subjects[activeSubjectKey]` on the **host** course's progress
(`saveProgress` already posts to the active course). Two tests pin it, each
with its failing control: a linked subject never writes under its slug (key by
slug: red), and no reader writes a linked body into a session cache (cache it:
red). The quiz picker lists linked subjects under their host course and reads
their content live by id; the attempt records the host course. The validator
lists them under the host course, audits them live, and hides *Request fixes*
and *Accept*.

### 5.6 What the pet reads

Phase 6's rule stands: nothing a person may not read is listed or sent to the
AI, and the gate is the database. `loadKnowledgeIndex` reads the course list and
each readable course's subjects; B2 adds one `share.list` read per build (ignored
on a 501 or 401: the Local Server and the web signed out) and, for each accepted
share with a live host in the index, an entry in that host course's `subjects`
with `linkedId`, its title and description read through `subject.getById`
(a 404 drops it, as an empty 200 drops a hidden course today). Phase B's body
read uses `/api/otter/subjects/:id` for an entry with `linkedId`. Nothing of the
owner's course beyond the one subject is ever read: the index entry is the
subject, under the receiver's own course, and `isRetrievableCourse` is unchanged.

**A revoke reaches the pet on the receiver's next sync**: the body is read live
under RLS every message, so a revoked subject's words never reach the AI again
from the moment the function commits; its **title** can sit in the warm index
for at most `INDEX_TTL_MS` (five minutes), and the client clears the index
(`clearPetKnowledgeCache`, already exported and used for the library switch)
whenever the accepted set changes on a share-list read or a 404 on open. The
same holds for a trashed subject.

### 5.7 Privacy, stated once

1. The receiver reads one subject; never the course row, its documents, its
   other subjects, or who else it is shared with (the SELECT policy names the
   two parties, and the index returns only the caller's rows). Two doors, both
   consented and both the one subject: `subject.getById`, and a `subject.list`
   on the owner's course id, which returns exactly the linked subject's list
   columns because the policy admits that row (round 1, note). A settled share
   shows its ex-receiver the title and course name as they were when offered,
   never the live ones (§3.6).
2. The receiver's progress, quiz history and validator findings are theirs
   (owner-only rows; session state). The owner sees *accepted* and nothing of
   how far they got.
3. A linked subject is not a row of the host course: sharing, publishing or
   granting editors on the host course never carries the link to anyone; the
   pet of a third person never sees it; `subject_count` does not count it.
4. Admins see audit lines of ids, as they see that personal courses exist.
5. A revoke, a decline, a trashed subject, a deactivated receiver and a
   workspace switch each close the read at the next statement; the client
   learns at its next list, open or sync, and the pet with it; no session cache
   holds a linked body (§5.4).
6. A row forged inside the subject's own workspace by the service role would be
   a forged consent, which no RLS can tell from a real one; a cross-tenant one
   is refused by the trigger and, past it, by the helper, the index and the
   policy (§2).

### 5.8 The Local Server

Nothing is shown, as for every Phase 5 control: the share item, the sections and
the linked rows render only in `cloudMode`, and the routes answer 501 beneath.
The library-source notice already says which library is showing and how to get
to the other; her six courses on this computer reach the company library through
the O.T.T.E.R. migration panel in Settings, and are shareable there. An inert
menu item would be the one grey item in a menu that otherwise filters by
capability (its own rule), and would say what the notice above the list already
says.

---

## 6. The build plan

Two nights, each a session with its brief, two review rounds, a hand-off and a
merge; neither touches the other's files.

### 6.1 B1 — the server (night 2)

| Touches | What |
|---|---|
| `supabase/migrations/0100_otter_subject_shares.sql` (new) | Appendix A, whole; `0065_otter_subject_shares.sql` removed in the same commit |
| `supabase/tests/rls/103_otter_subject_shares.sql` (new) | §4, with the fixtures named there and the failing controls run once each |
| `.github/workflows/rls.yml` | `otter_subject_shares` into `RLS_TABLES`; its `KNOWN_UNCOVERED` line removed; the suite named in the list and the running commentary as the house does |
| `src/tools/otter_v0.3.1/adapters/otterRoutes.js`, `supabaseOtterAdapter.js` | §5.1's six routes and operations; `id` added to the `subject.list` and `subject.get` wires (and to the fixtures' wire), `course_id` to `subject.getById`'s select (round 1, finding 3); `export.all`'s `linked_subjects` |
| `otterRoutes.test.js`, a new `subjectShares.test.js` beside the adapter | the parse of each route (and that `/api/otter/subjects/:id` does not collide with `/api/software/:slug/subjects/:sub`); the wire shapes against a mocked client; the 404 on a hidden subject; a 23505 becoming the sentence; `export.all` carrying a linked subject |
| `src/dev/fixtures/otterFixturesRoutes.js` (+ test) | the six ops answered as nominations are |
| `docs/SYSTEMS_HANDBOOK.md` §13.2, §4.9, §17; `docs/OUTSTANDING.md`; the hand-off | one paragraph, the replay row, the limits of §7 |

**Must not:** touch `Otter.jsx`, any component, `petKnowledge.js`, `otter.css`,
or anything under `src/` outside the adapter folder and the fixtures. No screen.

**Applies:** 0100 to **dev**, by the session, the house way (the statements
first, the `schema_migrations` row second, the file's md5 recorded; never
`supabase db push`, which would carry anything else in the tree); suite 103
against dev; staging is the controller's. **Measures:** suite 103 N/N on dev and
in CI; the full `tap-all` count before and after; vitest files and tests before
and after; the built bundle's size before and after (the adapter and routes are
a few KB); CI green on the pushed head, all four jobs; `git status` clean after
each review round.

**Needs from Audrey first:** the four answers (S1 to S4). S1 changes one check
and one probe; S2 changes the accept function's signature if she wants the
receiver to choose (it takes an optional host course id the receiver must own);
S3 decides whether the revoke function admits the receiver; S4 decides whether
the helper also requires the sharer's active membership (a paused link) or a
trigger on `workspace_members` ends shares at deactivation. **Does not need:** a
sign-in from her, a walkthrough, staging, or anything from N1 or N3.

Beside it on night 2, from the plan and not from this design: the avatars'
bucket and policy.

### 6.2 B2 — the client (night 3)

| Touches | What |
|---|---|
| `components/ShareSubjectDialog.jsx` (new) + test | §5.2 |
| `components/CourseRowMenu.jsx` | the item; `shareDiscoverability.test.js` extended (the label names the verb) |
| `components/RequestsView.jsx` + test | §5.3's two sections, the count, the accept flow |
| `components/CourseBadges.jsx` | `LinkedBadge` |
| `components/otterSharing.js` (+ test) | `linkKey`, `isLinkKey`, the share-state words |
| `Otter.jsx` | the share list; the linked rows in the three surfaces; `activeSubjectKey`; the open-by-id path and its 404; the tab count; the owner's line and the delete confirm's sentence; the quiz picker; the write gates on a linked subject |
| `Validator.jsx` | linked subjects listed read-only; fixes hidden |
| `petKnowledge.js` (+ test) | §5.6: the linked entries, the id read, a 404 drops the entry |
| `otter.css` | the linked row, badge and greyed states (house weights 400 and 600; no new colour) |
| the night's walkthrough (its section), `docs/OUTSTANDING.md`, the hand-off | |

**Must not:** touch `supabase/`, `rls.yml`, the adapter's SQL calls or the route
table (if a wire gap is found, B2 says so in its hand-off and the controller
decides; it does not reach into B1's files). **Tests:** `linkedProgress.test.js`
(the key, with the slug-keyed failing control; no linked body in any session
cache, with the cached control; the active row by key, not slug); the dialog's
contract line and its refusal path; the sections' states (`pending`, `gone`, a
dead host) and the 404 words chosen by `state`; `petKnowledge.test.js`'s linked
entry and its 404; the existing source pins (`shareDiscoverability`,
`suggestChangeGating`, `otterCss`) kept green.
**Measures:** vitest counts; the bundle (the growth should stay under 20 KB; say
it); Chromium at 1280 and 1440 for the walkthrough's pictures; the dev fixtures
for the chrome (the list is empty there by design, so the sections are proved by
tests, not by the fixtures). The **two-person flow on the real cloud** needs two
accounts: either B2's brief names two dev accounts the controller provides, or
the flow is hers in the walkthrough; this design does not assume either.

---

## 7. What is not in 1.0

| Not built | Why |
|---|---|
| A share of a **whole course** to one person | A course already has `shared` visibility and per-person editor grants; a per-person live course link would be a fourth visibility (the thing 0064 refused to add) or N subject rows behind one button. She asked for one subject. |
| Sharing **outside the workspace** | `cloudMode` is one workspace claim; every policy starts from `current_workspace_id()`; no read in WILSON crosses a tenant (locked #17). The policy refuses it, not the client. |
| A share that **copies** | Her first ruling is the link. A copy of a subject is a different feature with its own questions (whose edits win later), and the fork already exists for a course. |
| **Onward sharing** by the receiver | Only the owner of the course shares its subjects; the receiver owns nothing of it. |
| **Expiry** of a pending share; a **cooldown** after a decline | A record is cheap and an unanswered offer harms nobody; the owner can withdraw. A colleague who re-shares after a decline is a people problem, not a schema one. |
| **Notice outside WILSON** (an email), **realtime** arrival | O.T.T.E.R. is on no realtime topic (0022) and Resend is for auth mail; the Requests count is the notice. |
| The owner seeing the receiver's **progress** | Her third ruling, and `otter_progress` is owner-only. |
| Sharing with a **role or a group** | She described a receiver, singular; a row per person is the model, and several people at once is several rows, each accepted on its own. |
| The receiver choosing the **host course** at accept | Asked (S2); if she wants it, the accept function takes an optional host course id the receiver must own, and B1 builds it. |

---

## 8. Design review round 1 (2026-10-27): the findings and what was done

One Fable reviewer read this design, Appendix A, the questions file, the brief,
0065, 0022, the consent helpers, the audit table, the adapter, the routes, the
pet's reader, the named parts of `Otter.jsx`, the Phase 5 components, `rls.yml`
and suite 70, read-only. Twenty-two findings and seven notes; every one is
answered above, each marked *(round 1, finding n)* where it landed.

| # | Severity | Finding | Done |
|---|---|---|---|
| 1 | HIGH | The index function listed a forged cross-workspace row's live title and course identity, and `accept` never checked the subject's workspace; probe group 6 pinned the leak as expected | The index carries the helper's belt (`sub.workspace_id` and `src.workspace_id` = the share's); `accept` checks the subject's workspace; the guard trigger refuses any insert whose subject is in another workspace, armed or not (§2, §3.4, §3.6, A §2, §6, §9); group 6 forges the row with the trigger disabled and expects an empty list |
| 2 | MEDIUM | A declined or revoked share fed its ex-receiver the subject's live title and course name for ever; "nothing else is kept" was false (the note is kept) | Two snapshot columns written at share time; the index serves a settled receiver the snapshots and nothing live (§1.1, §3.2, §3.6, A §1, §5, §9); the rename probe in group 7; the sentence rewritten in both documents |
| 3 | MEDIUM | No wire carried a subject's `id`, so the owner's client had nothing to share with; `subject.getById` read a column its select did not name | `id` on the `subject.list` and `subject.get` wires (and the fixtures'), `course_id` in `getById`'s select, both B1's (§5.1, §6.1) |
| 4 | MEDIUM | "Not kept in the session cache" named one cache; the quiz, the Validator and search hold bodies in others, so a revoked body could be quizzed on and sent to the AI for the rest of the session | No reader writes a linked body to any session cache; each reads live by id; the quiz picker derives linked rows from the live share state; a test with its failing control (§5.4, §5.5, §6.2) |
| 5 | MEDIUM | The matrix's anon column expected 0 rows where `anon` has no privilege and a count would abort the file with 42501 | The anon column is 42501 throughout, probed with `throws_ok` and the privilege functions (§4.1, group 1) |
| 6 | MEDIUM | The suite is one transaction, so a GUC armed by hand lasts to its end and the "unarmed update raises" probe could not raise | Every arming probe resets the GUC after; each unarmed probe asserts it reads empty first; SH5 is forged with the trigger disabled instead (§4) |
| 7 | MEDIUM | "The link survives the owner leaving" was a consent decision made on her behalf, leaving nobody able to revoke | Asked as **S4** (stays live, recommended; paused while the sharer is inactive; ended at deactivation), with the cost stated; the design marks it provisional (§2, §6.1, the questions file) |
| 8 | LOW | The receiver could "revoke" a pending share, recording a removal of something never held | The receiver's revoke is from `accepted` only; a pending offer is declined (§1.1, §3.5, A §8); probed in group 7 |
| 9 | LOW | "A forged row opens nothing" overclaimed: an in-tenant forgery naming the real owner satisfies the helper | The claim is about cross-tenant rows; an in-tenant forged consent is the service role's to prevent (§2, §5.7) |
| 10 | LOW | The pending receiver learned the course's slug, type and skill level, more than "title and name" | Null for a pending receiver: title, outline-or-not, course name, label, note only (§3.6, A §9); probe group 3 |
| 11 | LOW | The owner learned the receiver's host course id and whether they had trashed it | `host_course_id` and `host_live` are returned to the receiver only (§3.6, A §9) |
| 12 | LOW | §5.2 gated the menu item on a non-stub subject, §5.4 described a linked stub, the function never checked `is_stub`, and the menu has no subject list to decide on | Stubs may be shared (an outline that fills live); the menu gate is gone; the picker marks *outline only* (§3.5, §5.2); SH7 probes it |
| 13 | LOW | Two definitions of the progression key straddled the B1/B2 boundary | No key on the wire; `linkKey()` in `otterSharing.js` is the one definition (§5.1, §5.5) |
| 14 | LOW | "The ticks come back" holds only when the host course is the same | Stated, with the purged-host case (§1.3) |
| 15 | LOW | An accepted share with a purged host has no exit if S3 is answered "No" | The consequence is in S3's text, so her answer is informed |
| 16 | LOW | Post-conditions could pass in a broken state: a `LIKE` on the function body, no check of the index's predicate, the trigger's type or the policy's own guards | Comments stripped before the arm check (0069's way), the index's predicate, `tgtype`, and `has_active_membership` / `deleted_at IS NULL` in the policy asserted (§3.9, A §10) |
| 17 | LOW | Two matrix cells were wrong: b is an active member of B, so the share call raises *subject not found*, not a membership error; the index cell asserted two moments at once | Both cells rewritten (§4.1) |
| 18 | LOW | Missing probes: an editor grantee sharing, an admin reading share rows, accepting a trashed subject's share, an armed no-transition update moving the host, a receiver revoking a pending share | All five added (groups 2, 3, 6, 7, 8); the fixtures give e an editor grant and add S5 and SH8 |
| 19 | LOW | The sidebar's active row and the cache keys are by slug and collide for a linked subject whose slug matches a host subject | `activeSubjectKey` drives the highlight and every cache key (§5.4, §6.2) |
| 20 | LOW | A 404 on open was read as "no longer shared" but is also what a trashed subject returns | The client re-reads the share list and the index's `state` chooses the words (§5.4) |
| 21 | LOW | The questions file said "anyone who may read the subject can be offered it"; the receiver usually cannot read it yet | Reworded: any active member of the same company |
| 22 | LOW | The preflight tests `current_user`, 0069 tests the function owner; they coincide only when the applying role owns the functions | The assumption is stated in the preflight's comment; the post-condition checks the owner, as 0069 does (A §0, §10) |

**Notes answered:** the per-row cost of the arm (§3.3); the second door, a
`subject.list` on the owner's course id (§5.7, probe group 5); two
progressions for a subject reachable by tier and by link (§1.3); PUBLIC EXECUTE
is Postgres's own default (§3.8); the open `activeSubject` stays until
navigation (§5.4); several colleagues at once is decided, not asked (§5.2, the
questions file). A forged armed update's `host_course_id` draws nothing on the
client because the linked rows are filtered by the receiver's own courses.

---

## Appendix A — migration 0100, whole

B1 copies this into `supabase/migrations/0100_otter_subject_shares.sql` and
removes 0065. It is written to apply on dev, staging and production (none of
which hold 0065) and on a clean CI database.

```sql
-- =============================================================================
-- 0100_otter_subject_shares.sql — B1 (designed 2026-10-27 by N2)
--
-- SHARE ONE SUBJECT WITH ONE PERSON, AS A LIVE LINK THEY ACCEPT FIRST.
--
-- Retires 0065 (the 2026-08-12 draft; applied on no environment; its file
-- leaves the tree in this commit). Audrey, 2026-08-12, verbatim:
--   "so if the receiver doesnt have the course in their library of the subject.
--    you would add the new course and then place the subject in there. if the
--    user already has that software/ language course, you add the new subject
--    shared to that course."
--   LIVE LINK. ACCEPT FIRST.
--   "each user should have their own progression of subjects. dont make it a
--    universal one"
-- and 2026-10-27: "Build it before 1.0".
--
-- The design is docs/design/OTTER_SUBJECT_SHARES_DESIGN.md. In short:
--   * a share is a ROW ABOUT TWO PEOPLE, not a property of the subject.
--     otter_subjects has no visibility column and its SELECT policy stays pure
--     inheritance (0022) plus ONE arm, otter_has_accepted_subject_share(id),
--     which opens one subject to one person and nothing of the course.
--   * every write goes through four SECURITY DEFINER functions (share, accept,
--     decline, revoke). `authenticated` holds SELECT on the table and nothing
--     else; there is no INSERT, UPDATE or DELETE policy. A guard trigger refuses
--     any write not armed by a transaction-local GUC, from any role.
--   * one index function serves both sides' lists: live titles while a share
--     is pending or accepted, the snapshots taken at share time once it is
--     settled, and nothing of a course in another workspace.
--   * a share names a subject of its own workspace: the guard trigger refuses
--     any other, armed or not, and the helper and the index carry the same
--     predicate as belts.
--   * one app_events line per transition, ids only (WIL-4110 .. WIL-4113).
--   * progress for a linked subject is keyed 'link:<subject_id>' BY THE CLIENT
--     on the receiver's own progress row for their host course. Nothing here
--     enforces that; the design's §1.3 and its test do.
--
-- 🚨 ORDERING RULE: this file redefines otter_subjects_select (0022). A by-hand
--    replay of 0022 must be followed by 0100 (handbook §4.9).
-- pgTAP: supabase/tests/rls/103_otter_subject_shares.sql.
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP+CREATE throughout.
-- =============================================================================

-- ── 0. Preflight: the functions' owner must bypass RLS ───────────────────────
-- The four functions write a table on which `authenticated` has no INSERT or
-- UPDATE and no policy for either. They can write only because they run as
-- their owner, and only if that owner bypasses RLS (0069's preflight, for the
-- same reason: app_events_insert refuses the admin stream to everyone else).
-- The role running this file is the role that will own the functions it
-- creates (`postgres` on every Supabase project and in CI, which bypasses RLS);
-- the post-conditions at the foot check the OWNER's attribute once the
-- functions exist, as 0069 does.
DO $$
BEGIN
  IF NOT COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user), false) THEN
    RAISE EXCEPTION '0100 preflight failed: % does not bypass RLS, so the share functions could not write their own table', current_user;
  END IF;
END $$;

-- ── 1. The table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.otter_subject_shares (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Defaults matter: the functions pass neither, so a sharer cannot file as
  -- someone else or into another workspace.
  workspace_id   UUID NOT NULL DEFAULT public.current_workspace_id()
                 REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- The LIVE source. CASCADE is the feature: "it disappears if I delete it".
  subject_id     UUID NOT NULL REFERENCES public.otter_subjects(id) ON DELETE CASCADE,
  shared_by      UUID NOT NULL DEFAULT auth.uid(),
  shared_with    UUID NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  message        TEXT,
  -- What the subject and its course were called when it was offered. A settled
  -- share (declined, revoked) shows its ex-receiver these and never the live
  -- values (0045's precedent: a quiz attempt keeps its courses' names).
  subject_title  TEXT NOT NULL,
  course_name    TEXT NOT NULL,
  -- The RECEIVER'S course the subject is shown inside. NULL until accepted;
  -- kept after a revoke as history. FK-less on purpose (archive_course_id's
  -- precedent): a pointer that outlives the course it names.
  host_course_id UUID,
  responded_at   TIMESTAMPTZ,
  -- Who ended it: the owner withdrew, or the receiver removed it.
  ended_by       UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID
);

ALTER TABLE public.otter_subject_shares ADD COLUMN IF NOT EXISTS ended_by      UUID;
ALTER TABLE public.otter_subject_shares ADD COLUMN IF NOT EXISTS subject_title TEXT;
ALTER TABLE public.otter_subject_shares ADD COLUMN IF NOT EXISTS course_name   TEXT;
-- On a table 0065 made (no rows anywhere: CI only), the two columns above were
-- just added nullable; make them what the CREATE says.
ALTER TABLE public.otter_subject_shares ALTER COLUMN subject_title SET NOT NULL;
ALTER TABLE public.otter_subject_shares ALTER COLUMN course_name   SET NOT NULL;
ALTER TABLE public.otter_subject_shares
  ALTER COLUMN workspace_id SET DEFAULT public.current_workspace_id();
ALTER TABLE public.otter_subject_shares
  ALTER COLUMN shared_by    SET DEFAULT auth.uid();

-- 0065's shapes, if a database ever carried them (none does outside a CI run
-- made before this file). The names that stay (the helper, the accept
-- function) are CREATE OR REPLACE'd below with the same signatures.
DROP TRIGGER  IF EXISTS trg_otter_subject_share_respond ON public.otter_subject_shares;
DROP FUNCTION IF EXISTS public.fn_otter_subject_share_respond();
ALTER TABLE public.otter_subject_shares DROP CONSTRAINT IF EXISTS otter_subject_share_host_chk;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_status_chk') THEN
    ALTER TABLE public.otter_subject_shares ADD CONSTRAINT otter_subject_share_status_chk
      CHECK (status IN ('pending', 'accepted', 'declined', 'revoked'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_not_self_chk') THEN
    ALTER TABLE public.otter_subject_shares ADD CONSTRAINT otter_subject_share_not_self_chk
      CHECK (shared_with <> shared_by);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_message_chk') THEN
    ALTER TABLE public.otter_subject_shares ADD CONSTRAINT otter_subject_share_message_chk
      CHECK (message IS NULL OR char_length(message) <= 2000);
  END IF;

  -- The snapshots stay within the source columns' own bounds (0022).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_snapshot_chk') THEN
    ALTER TABLE public.otter_subject_shares ADD CONSTRAINT otter_subject_share_snapshot_chk
      CHECK (char_length(subject_title) BETWEEN 1 AND 300
         AND char_length(course_name)   BETWEEN 1 AND 200);
  END IF;

  -- An accepted share has a host; a pending or declined one has none; a
  -- revoked one keeps whatever it had (history).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_host_state_chk') THEN
    ALTER TABLE public.otter_subject_shares ADD CONSTRAINT otter_subject_share_host_state_chk
      CHECK ((status <> 'accepted' OR host_course_id IS NOT NULL)
         AND (status NOT IN ('pending', 'declined') OR host_course_id IS NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_ended_chk') THEN
    ALTER TABLE public.otter_subject_shares ADD CONSTRAINT otter_subject_share_ended_chk
      CHECK ((status = 'revoked') = (ended_by IS NOT NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_responded_chk') THEN
    ALTER TABLE public.otter_subject_shares ADD CONSTRAINT otter_subject_share_responded_chk
      CHECK ((status = 'pending') = (responded_at IS NULL));
  END IF;
END $$;

-- One LIVE share of a subject to a person. Re-sharing after a decline or a
-- revoke is allowed; queueing five copies is not.
CREATE UNIQUE INDEX IF NOT EXISTS otter_subject_share_live_uidx
  ON public.otter_subject_shares (subject_id, shared_with)
  WHERE status IN ('pending', 'accepted');

CREATE INDEX IF NOT EXISTS otter_subject_share_recipient_idx
  ON public.otter_subject_shares (shared_with, status);
CREATE INDEX IF NOT EXISTS otter_subject_share_sender_idx
  ON public.otter_subject_shares (shared_by, status);
CREATE INDEX IF NOT EXISTS otter_subject_share_host_idx
  ON public.otter_subject_shares (host_course_id) WHERE host_course_id IS NOT NULL;

ALTER TABLE public.otter_subject_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otter_subject_shares FORCE  ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_otter_subject_share_audit ON public.otter_subject_shares;
CREATE TRIGGER trg_otter_subject_share_audit
  BEFORE INSERT OR UPDATE ON public.otter_subject_shares
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();

-- SELECT and nothing else for a signed-in person. The functions below are the
-- only writers; they run as their owner. PUBLIC is named: 0011's default
-- privileges re-arm it otherwise.
REVOKE ALL    ON public.otter_subject_shares FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.otter_subject_shares TO authenticated;
GRANT  ALL    ON public.otter_subject_shares TO service_role;

COMMENT ON TABLE public.otter_subject_shares IS
  '0100: a live link of ONE subject to ONE person, accepted before it appears. The receiver reads the sharer''s subject inside their own host course; they never own or edit it; it stops when the source is trashed, ends when the share is revoked, and goes when the source is purged. Written only by otter_subject_share / _accept / _decline / _revoke.';
COMMENT ON COLUMN public.otter_subject_shares.host_course_id IS
  '0100: the RECEIVER''S course the linked subject is shown inside, found by slug or made at accept. FK-less on purpose; kept after a revoke.';

-- Policies on this table: SELECT only. Both sides of a share can see it; nobody
-- else, including admins: a share is between two people, not workspace
-- business. No INSERT/UPDATE/DELETE policy: RLS default-denies them, and the
-- grants above refuse them a step earlier.
DROP POLICY IF EXISTS otter_subject_share_select ON public.otter_subject_shares;
DROP POLICY IF EXISTS otter_subject_share_insert ON public.otter_subject_shares;
DROP POLICY IF EXISTS otter_subject_share_update ON public.otter_subject_shares;
CREATE POLICY otter_subject_share_select ON public.otter_subject_shares
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (shared_by = auth.uid() OR shared_with = auth.uid())
  );

-- ── 2. The guard trigger: armed writes only, and the transition table ────────
-- Two GUCs, two id spaces (0064's lesson): the INSERT arm carries the SUBJECT
-- id, the UPDATE arm the SHARE id. Triggers fire for every role, so this binds
-- the service role and the test runner as well as the functions below.

CREATE OR REPLACE FUNCTION public.fn_otter_subject_share_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_insert_arm TEXT := current_setting('wilson.otter_subject_share_insert', true);
  v_update_arm TEXT := current_setting('wilson.otter_subject_share_update', true);
  v_sub_ws     UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(v_insert_arm, '') <> NEW.subject_id::text THEN
      RAISE EXCEPTION 'a subject share is made by otter_subject_share(), not by inserting a row';
    END IF;
    -- A share names a subject of its own workspace: the invariant
    -- fn_otter_editor_grant_workspace asserts for grants, here for shares. Read
    -- as definer; refused armed or not, from any role.
    SELECT sub.workspace_id INTO v_sub_ws
      FROM public.otter_subjects sub WHERE sub.id = NEW.subject_id;
    IF v_sub_ws IS NULL OR v_sub_ws IS DISTINCT FROM NEW.workspace_id THEN
      RAISE EXCEPTION 'a subject share names a subject of its own workspace';
    END IF;
    IF NEW.status <> 'pending' OR NEW.host_course_id IS NOT NULL
       OR NEW.responded_at IS NOT NULL OR NEW.ended_by IS NOT NULL THEN
      RAISE EXCEPTION 'a new subject share starts pending, with nothing decided';
    END IF;
    RETURN NEW;
  END IF;

  IF COALESCE(v_update_arm, '') <> OLD.id::text THEN
    RAISE EXCEPTION 'a subject share changes through accept, decline or revoke, not by updating a row';
  END IF;

  -- Immutable provenance: re-pointing any of these would move a consented read
  -- onto a different subject or a different person.
  NEW.id           := OLD.id;
  NEW.workspace_id := OLD.workspace_id;
  NEW.subject_id   := OLD.subject_id;
  NEW.shared_by    := OLD.shared_by;
  NEW.shared_with  := OLD.shared_with;
  NEW.message      := OLD.message;
  NEW.subject_title := OLD.subject_title;
  NEW.course_name  := OLD.course_name;
  NEW.created_at   := OLD.created_at;
  NEW.created_by   := OLD.created_by;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'pending' AND NEW.status IN ('accepted', 'declined', 'revoked') THEN
      NULL;
    ELSIF OLD.status = 'accepted' AND NEW.status = 'revoked' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'a subject share cannot move from % to %', OLD.status, NEW.status;
    END IF;

    NEW.responded_at := COALESCE(OLD.responded_at, now());

    IF NEW.status = 'revoked' THEN
      IF NEW.ended_by IS NULL THEN
        RAISE EXCEPTION 'a revoked share records who ended it';
      END IF;
      -- host_course_id is kept as it was: history of where it lived.
      NEW.host_course_id := OLD.host_course_id;
    ELSE
      NEW.ended_by := NULL;
    END IF;

    IF NEW.status = 'accepted' AND NEW.host_course_id IS NULL THEN
      RAISE EXCEPTION 'accepting places the subject in a course';
    END IF;
    IF NEW.status = 'declined' THEN
      NEW.host_course_id := NULL;
    END IF;
  ELSE
    -- No transition: nothing else may move.
    NEW.host_course_id := OLD.host_course_id;
    NEW.responded_at   := OLD.responded_at;
    NEW.ended_by       := OLD.ended_by;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_otter_subject_share_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_otter_subject_share_guard ON public.otter_subject_shares;
CREATE TRIGGER trg_otter_subject_share_guard
  BEFORE INSERT OR UPDATE ON public.otter_subject_shares
  FOR EACH ROW EXECUTE FUNCTION public.fn_otter_subject_share_guard();

-- ── 3. The consent helper ────────────────────────────────────────────────────
-- True when the caller may read p_subject_id BECAUSE it was shared with them
-- and they accepted. plpgsql SECURITY DEFINER, not sql: it must not inline into
-- the calling policy's qual. It reads no role: a share names one person.

CREATE OR REPLACE FUNCTION public.otter_has_accepted_subject_share(p_subject_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ws  UUID := public.current_workspace_id();
BEGIN
  IF v_uid IS NULL OR v_ws IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public.otter_subject_shares s
      JOIN public.otter_subjects sub ON sub.id = s.subject_id
      JOIN public.otter_courses  src ON src.id = sub.course_id
     WHERE s.subject_id = p_subject_id
       AND s.workspace_id = v_ws
       -- Belt: a row that names a subject of another workspace opens nothing,
       -- before the policy's own workspace predicate refuses it too.
       AND sub.workspace_id = s.workspace_id
       AND s.shared_with = v_uid
       AND s.status = 'accepted'
       AND sub.deleted_at IS NULL
       AND src.deleted_at IS NULL
       -- Consent re-check: only the sharer's OWN course opens, and only the
       -- subject named. Also enforced by otter_subject_share().
       AND src.owner_id = s.shared_by
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_has_accepted_subject_share(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_has_accepted_subject_share(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_has_accepted_subject_share IS
  '0100: consented read on ONE linked subject. True when p_subject_id was shared with the caller by the owner of its course, in the caller''s active workspace, and the caller accepted. Grants nothing on the parent course.';

-- ── 4. The read reaches the subject, and only the subject ────────────────────
-- 0022 verbatim plus the link arm. A subject of a course you can read is still
-- readable through the EXISTS; the arm adds exactly one more way in, one row at
-- a time. The UPDATE policy is untouched (a post-condition says so).

DROP POLICY IF EXISTS otter_subjects_select ON public.otter_subjects;
CREATE POLICY otter_subjects_select ON public.otter_subjects
  FOR SELECT USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (
      EXISTS (
        SELECT 1 FROM public.otter_courses c WHERE c.id = otter_subjects.course_id
      )
      OR public.otter_has_accepted_subject_share(id)
    )
  );

-- ── 5. otter_subject_share() — the owner offers one subject to one person ────

CREATE OR REPLACE FUNCTION public.otter_subject_share(
  p_subject_id  UUID,
  p_shared_with UUID,
  p_message     TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_ws      UUID := public.current_workspace_id();
  v_sub     public.otter_subjects%ROWTYPE;
  v_src     public.otter_courses%ROWTYPE;
  v_message TEXT := NULLIF(btrim(p_message), '');
  v_id      UUID;
BEGIN
  IF v_uid IS NULL OR v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;
  IF p_shared_with IS NULL OR p_shared_with = v_uid THEN
    RAISE EXCEPTION 'choose a colleague to share it with';
  END IF;

  SELECT * INTO v_sub FROM public.otter_subjects
   WHERE id = p_subject_id AND deleted_at IS NULL;
  IF v_sub.id IS NULL OR v_sub.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'subject not found in this workspace';
  END IF;

  SELECT * INTO v_src FROM public.otter_courses
   WHERE id = v_sub.course_id AND deleted_at IS NULL;
  IF v_src.id IS NULL OR v_src.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'the course that subject belongs to no longer exists';
  END IF;
  -- Consent is not transferable: the owner, not an admin, not an editor (S1).
  IF v_src.owner_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'only the owner of a course may share its subjects';
  END IF;

  -- A live member of THIS workspace. A share to a deactivated account would
  -- wait forever in a queue nobody reads; one to another workspace cannot be.
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members wm
                  WHERE wm.workspace_id = v_ws
                    AND wm.user_id = p_shared_with
                    AND wm.is_active) THEN
    RAISE EXCEPTION 'that person is not an active member of this workspace';
  END IF;

  IF v_message IS NOT NULL AND char_length(v_message) > 2000 THEN
    RAISE EXCEPTION 'the note is longer than 2000 characters';
  END IF;

  -- A sentence instead of a bare 23505; the partial unique index catches the
  -- race between two concurrent offers.
  IF EXISTS (SELECT 1 FROM public.otter_subject_shares s
              WHERE s.subject_id = p_subject_id
                AND s.shared_with = p_shared_with
                AND s.status IN ('pending', 'accepted')) THEN
    RAISE EXCEPTION 'this subject is already shared with that person';
  END IF;

  PERFORM set_config('wilson.otter_subject_share_insert', p_subject_id::text, true);
  INSERT INTO public.otter_subject_shares
    (workspace_id, subject_id, shared_by, shared_with, message, subject_title, course_name)
  VALUES
    (v_ws, p_subject_id, v_uid, p_shared_with, v_message,
     left(v_sub.title, 300), left(v_src.name, 200))
  RETURNING id INTO v_id;
  PERFORM set_config('wilson.otter_subject_share_insert', '', true);

  -- Ids only: admins read this stream, and a title would tell them what the
  -- course index deliberately does not.
  INSERT INTO public.app_events
    (workspace_id, actor_user_id, event_type, code, severity, message, context)
  VALUES (v_ws, v_uid, 'admin', 'WIL-4110', 'info',
          'A subject was shared with a colleague',
          jsonb_build_object('share_id', v_id, 'subject_id', p_subject_id,
                             'course_id', v_src.id, 'shared_by', v_uid,
                             'shared_with', p_shared_with));

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_subject_share(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_subject_share(UUID, UUID, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_subject_share IS
  '0100: the owner of a course offers ONE of its subjects to ONE active member of the same workspace. Starts pending. Returns the share id. The only path to a share row.';

-- ── 6. otter_subject_share_accept() — the only path to 'accepted' ────────────
-- SECURITY DEFINER because the receiver must read the SOURCE course's slug,
-- name and type to find or make their own copy, and that course may be
-- personal to the sharer. The INSERT into otter_courses runs the audit trigger
-- and no pin trigger (those are BEFORE UPDATE), so there is no silent-revert
-- hazard of the kind 0064 had to work around.

CREATE OR REPLACE FUNCTION public.otter_subject_share_accept(p_share_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_ws    UUID := public.current_workspace_id();
  v_share public.otter_subject_shares%ROWTYPE;
  v_sub   public.otter_subjects%ROWTYPE;
  v_src   public.otter_courses%ROWTYPE;
  v_host  UUID;
BEGIN
  IF v_uid IS NULL OR v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;

  SELECT * INTO v_share FROM public.otter_subject_shares
   WHERE id = p_share_id FOR UPDATE;
  IF v_share.id IS NULL OR v_share.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'share not found in this workspace';
  END IF;
  IF v_share.shared_with IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'only the person it was shared with may accept it';
  END IF;
  IF v_share.status <> 'pending' THEN
    RAISE EXCEPTION 'this share is % — only a pending share can be accepted', v_share.status;
  END IF;

  SELECT * INTO v_sub FROM public.otter_subjects
   WHERE id = v_share.subject_id AND deleted_at IS NULL;
  IF v_sub.id IS NULL THEN
    RAISE EXCEPTION 'that subject no longer exists';
  END IF;
  -- The guard refuses a cross-workspace row at insert; this is the belt.
  IF v_sub.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'subject not found in this workspace';
  END IF;
  SELECT * INTO v_src FROM public.otter_courses
   WHERE id = v_sub.course_id AND deleted_at IS NULL;
  IF v_src.id IS NULL THEN
    RAISE EXCEPTION 'the course that subject belongs to no longer exists';
  END IF;
  IF v_src.owner_id IS DISTINCT FROM v_share.shared_by THEN
    RAISE EXCEPTION 'that subject is no longer owned by the person who shared it';
  END IF;

  -- "if the user already has that software/language course, you add the new
  --  subject shared to that course" — matched on the KEY (slug), which is what
  -- "the same course" means structurally: frozen at creation, inherited by
  -- forks, unaffected by either person renaming their copy. Never the name.
  SELECT c.id INTO v_host
    FROM public.otter_courses c
   WHERE c.workspace_id = v_ws
     AND c.owner_id = v_uid
     AND c.slug = v_src.slug
     AND c.deleted_at IS NULL
   LIMIT 1;

  -- "if the receiver doesnt have the course ... you would add the new course
  --  and then place the subject in there." A personal course of the source's
  -- identity, with no documents: a share is one subject, not a copy.
  IF v_host IS NULL THEN
    INSERT INTO public.otter_courses
      (workspace_id, owner_id, slug, name, course_type, skill_level, visibility, created_by, updated_by)
    VALUES
      (v_ws, v_uid, v_src.slug, v_src.name, v_src.course_type, v_src.skill_level, 'personal', v_uid, v_uid)
    RETURNING id INTO v_host;
  END IF;

  PERFORM set_config('wilson.otter_subject_share_update', v_share.id::text, true);
  UPDATE public.otter_subject_shares
     SET status = 'accepted', host_course_id = v_host
   WHERE id = v_share.id;
  PERFORM set_config('wilson.otter_subject_share_update', '', true);

  INSERT INTO public.app_events
    (workspace_id, actor_user_id, event_type, code, severity, message, context)
  VALUES (v_ws, v_uid, 'admin', 'WIL-4111', 'info',
          'A shared subject was accepted',
          jsonb_build_object('share_id', v_share.id, 'subject_id', v_share.subject_id,
                             'course_id', v_src.id, 'shared_by', v_share.shared_by,
                             'shared_with', v_uid, 'host_course_id', v_host));

  RETURN v_host;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_subject_share_accept(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_subject_share_accept(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_subject_share_accept IS
  '0100: the receiver accepts a pending share. Finds their live course with the source''s slug, or makes a personal one, and links the subject into it. Returns the host course id. The only path to status=accepted.';

-- ── 7. otter_subject_share_decline() ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.otter_subject_share_decline(p_share_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_ws    UUID := public.current_workspace_id();
  v_share public.otter_subject_shares%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;

  SELECT * INTO v_share FROM public.otter_subject_shares
   WHERE id = p_share_id FOR UPDATE;
  IF v_share.id IS NULL OR v_share.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'share not found in this workspace';
  END IF;
  IF v_share.shared_with IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'only the person it was shared with may decline it';
  END IF;
  IF v_share.status <> 'pending' THEN
    RAISE EXCEPTION 'this share is % — only a pending share can be declined', v_share.status;
  END IF;

  PERFORM set_config('wilson.otter_subject_share_update', v_share.id::text, true);
  UPDATE public.otter_subject_shares SET status = 'declined' WHERE id = v_share.id;
  PERFORM set_config('wilson.otter_subject_share_update', '', true);

  INSERT INTO public.app_events
    (workspace_id, actor_user_id, event_type, code, severity, message, context)
  VALUES (v_ws, v_uid, 'admin', 'WIL-4112', 'info',
          'A shared subject was declined',
          jsonb_build_object('share_id', v_share.id, 'subject_id', v_share.subject_id,
                             'shared_by', v_share.shared_by, 'shared_with', v_uid));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_subject_share_decline(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_subject_share_decline(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_subject_share_decline IS
  '0100: the receiver declines a pending share. A record both can read; nothing was opened.';

-- ── 8. otter_subject_share_revoke() — either side ends it ────────────────────
-- The owner withdraws (pending or accepted); the receiver removes it from
-- their course (S3). Both reach the same terminal state: the link stops
-- resolving on the next statement. The receiver's progress row is theirs and
-- is not touched.

CREATE OR REPLACE FUNCTION public.otter_subject_share_revoke(p_share_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_ws    UUID := public.current_workspace_id();
  v_share public.otter_subject_shares%ROWTYPE;
  v_role  TEXT;
BEGIN
  IF v_uid IS NULL OR v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;

  SELECT * INTO v_share FROM public.otter_subject_shares
   WHERE id = p_share_id FOR UPDATE;
  IF v_share.id IS NULL OR v_share.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'share not found in this workspace';
  END IF;
  IF v_share.shared_by = v_uid THEN
    v_role := 'owner';
  ELSIF v_share.shared_with = v_uid THEN
    v_role := 'receiver';
  ELSE
    RAISE EXCEPTION 'only the sharer or the person it was shared with may end this share';
  END IF;
  IF v_share.status NOT IN ('pending', 'accepted') THEN
    RAISE EXCEPTION 'this share is already % — there is nothing to end', v_share.status;
  END IF;
  -- A receiver removes what they hold; an offer they have not accepted is
  -- declined, not removed (S3).
  IF v_role = 'receiver' AND v_share.status <> 'accepted' THEN
    RAISE EXCEPTION 'this share is still waiting for your answer — decline it instead';
  END IF;

  PERFORM set_config('wilson.otter_subject_share_update', v_share.id::text, true);
  UPDATE public.otter_subject_shares
     SET status = 'revoked', ended_by = v_uid
   WHERE id = v_share.id;
  PERFORM set_config('wilson.otter_subject_share_update', '', true);

  INSERT INTO public.app_events
    (workspace_id, actor_user_id, event_type, code, severity, message, context)
  VALUES (v_ws, v_uid, 'admin', 'WIL-4113', 'info',
          'A shared subject was revoked',
          jsonb_build_object('share_id', v_share.id, 'subject_id', v_share.subject_id,
                             'shared_by', v_share.shared_by, 'shared_with', v_share.shared_with,
                             'ended_by_role', v_role));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_subject_share_revoke(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_subject_share_revoke(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_subject_share_revoke IS
  '0100: the sharer withdraws, or the receiver removes, a pending or accepted share. Records who ended it; keeps the host pointer as history.';

-- ── 9. otter_subject_shares_index() — both sides' lists ──────────────────────
-- The receiver of a PENDING share may not read the subject yet (not accepted),
-- so its title comes from here: the owner's consented disclosure, the minimum
-- to decide on. What each side may learn is decided HERE, per row:
--   * the owner: the live columns always (it is their subject);
--   * the receiver, pending: the title, is_stub, the course's NAME, the labels
--     and the note; no course id, slug, type or level;
--   * the receiver, accepted: the live columns, plus the host pointer and
--     whether the host is live (the owner never gets those two);
--   * the receiver, declined or revoked: the two snapshots and nothing live.
-- A row whose subject or course sits in another workspace is not listed at
-- all (the helper's belt, repeated here).

DROP FUNCTION IF EXISTS public.otter_subject_shares_index();

CREATE FUNCTION public.otter_subject_shares_index()
RETURNS TABLE (
  id              UUID,
  subject_id      UUID,
  subject_title   TEXT,
  subject_is_stub BOOLEAN,
  course_id       UUID,
  course_name     TEXT,
  course_slug     TEXT,
  course_type     TEXT,
  skill_level     TEXT,
  shared_by       UUID,
  sharer_label    TEXT,
  shared_with     UUID,
  receiver_label  TEXT,
  status          TEXT,
  state           TEXT,
  message         TEXT,
  host_course_id  UUID,
  host_live       BOOLEAN,
  created_at      TIMESTAMPTZ,
  responded_at    TIMESTAMPTZ,
  ended_by        UUID,
  is_mine         BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ws  UUID := public.current_workspace_id();
BEGIN
  -- Membership from the LIVE row (definer bypasses RLS, so the function
  -- re-checks itself: the 0010/0021 convention).
  IF v_uid IS NULL OR v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;

  RETURN QUERY
  SELECT s.id,
         s.subject_id,
         -- live while the share is live, or for its owner; the snapshot after
         CASE WHEN s.shared_by = v_uid OR s.status IN ('pending', 'accepted')
              THEN sub.title ELSE s.subject_title END,
         CASE WHEN s.shared_by = v_uid OR s.status IN ('pending', 'accepted')
              THEN sub.is_stub ELSE NULL END,
         -- the course's identity: the owner's, or the receiver's once accepted
         CASE WHEN s.shared_by = v_uid OR s.status = 'accepted'
              THEN src.id ELSE NULL END,
         CASE WHEN s.shared_by = v_uid OR s.status IN ('pending', 'accepted')
              THEN src.name ELSE s.course_name END,
         CASE WHEN s.shared_by = v_uid OR s.status = 'accepted'
              THEN src.slug ELSE NULL END,
         CASE WHEN s.shared_by = v_uid OR s.status = 'accepted'
              THEN src.course_type ELSE NULL END,
         CASE WHEN s.shared_by = v_uid OR s.status = 'accepted'
              THEN src.skill_level ELSE NULL END,
         s.shared_by,
         COALESCE(wb.display_name, wb.username),
         s.shared_with,
         COALESCE(ww.display_name, ww.username),
         s.status,
         CASE
           WHEN s.status IN ('pending', 'accepted')
                AND (sub.deleted_at IS NOT NULL
                     OR src.deleted_at IS NOT NULL
                     OR src.owner_id IS DISTINCT FROM s.shared_by)
             THEN 'gone'
           ELSE s.status
         END,
         s.message,
         -- the receiver's course is theirs: the owner gets neither of these
         CASE WHEN s.shared_with = v_uid THEN s.host_course_id ELSE NULL END,
         CASE WHEN s.shared_with = v_uid
              THEN (s.host_course_id IS NOT NULL AND EXISTS (
                      SELECT 1 FROM public.otter_courses h
                       WHERE h.id = s.host_course_id AND h.deleted_at IS NULL))
              ELSE NULL END,
         s.created_at,
         s.responded_at,
         s.ended_by,
         (s.shared_by = v_uid)
    FROM public.otter_subject_shares s
    JOIN public.otter_subjects sub ON sub.id = s.subject_id
    JOIN public.otter_courses  src ON src.id = sub.course_id
    LEFT JOIN public.workspace_members wb
           ON wb.workspace_id = s.workspace_id AND wb.user_id = s.shared_by
    LEFT JOIN public.workspace_members ww
           ON ww.workspace_id = s.workspace_id AND ww.user_id = s.shared_with
   WHERE s.workspace_id = v_ws
     -- the belt: nothing of another workspace is listed, whatever the row says
     AND sub.workspace_id = s.workspace_id
     AND src.workspace_id = s.workspace_id
     AND (s.shared_by = v_uid OR s.shared_with = v_uid)
   ORDER BY s.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_subject_shares_index() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_subject_shares_index() TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_subject_shares_index IS
  '0100: every subject share the caller sent or received in their active workspace, with the live subject title, the course''s identity, both labels, the derived state (gone when the source is trashed or changed hands) and whether the host course is live. Backs the Requests view, the linked rows and the pet''s index.';

-- ── 10. Post-conditions ──────────────────────────────────────────────────────

DO $$
DECLARE
  t    TEXT;
  n    INTEGER;
  body TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class
                  WHERE oid = 'public.otter_subject_shares'::regclass
                    AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION '0100 post-condition failed: RLS must be enabled AND forced on otter_subject_shares';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'otter_subject_shares';
  IF n <> 1 THEN
    RAISE EXCEPTION '0100 post-condition failed: expected exactly 1 policy (SELECT), found %', n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'otter_subject_shares'
                AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION '0100 post-condition failed: the share table admits a write policy; writes go through the functions';
  END IF;

  IF has_table_privilege('anon', 'public.otter_subject_shares', 'SELECT')
     OR has_table_privilege('anon', 'public.otter_subject_shares', 'INSERT')
     OR has_table_privilege('anon', 'public.otter_subject_shares', 'UPDATE')
     OR has_table_privilege('anon', 'public.otter_subject_shares', 'DELETE') THEN
    RAISE EXCEPTION '0100 post-condition failed: anon holds a privilege on otter_subject_shares';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.otter_subject_shares', 'SELECT')
     OR has_table_privilege('authenticated', 'public.otter_subject_shares', 'INSERT')
     OR has_table_privilege('authenticated', 'public.otter_subject_shares', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.otter_subject_shares', 'DELETE') THEN
    RAISE EXCEPTION '0100 post-condition failed: authenticated must hold SELECT and nothing else on otter_subject_shares';
  END IF;

  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema='public' AND table_name='otter_subject_shares'
         AND column_name='workspace_id') IS DISTINCT FROM 'current_workspace_id()' THEN
    RAISE EXCEPTION '0100 post-condition failed: workspace_id must default to current_workspace_id()';
  END IF;
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema='public' AND table_name='otter_subject_shares'
         AND column_name='shared_by') IS DISTINCT FROM 'auth.uid()' THEN
    RAISE EXCEPTION '0100 post-condition failed: shared_by must default to auth.uid()';
  END IF;

  -- The link arm landed AND 0022's inheritance rule survived it.
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='otter_subjects' AND cmd='SELECT'
                    AND qual LIKE '%otter_has_accepted_subject_share%') THEN
    RAISE EXCEPTION '0100 post-condition failed: the subject-link arm is missing from otter_subjects_select';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='otter_subjects' AND cmd='SELECT'
                    AND qual LIKE '%otter_courses%') THEN
    RAISE EXCEPTION '0100 post-condition failed: 0022 course inheritance was dropped from otter_subjects_select';
  END IF;
  -- A linked subject must stay READ-only: the update policy is untouched.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='public' AND tablename='otter_subjects' AND cmd='UPDATE'
                AND (qual LIKE '%otter_has_accepted_subject_share%'
                     OR with_check LIKE '%otter_has_accepted_subject_share%')) THEN
    RAISE EXCEPTION '0100 post-condition failed: the link arm leaked into otter_subjects_update';
  END IF;
  -- The admin-bypass rule 0022/0025/0026/0064 all defend, now on three tables.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='public'
                AND tablename IN ('otter_courses','otter_subjects','otter_progress')
                AND cmd='SELECT' AND qual LIKE '%current_app_role%') THEN
    RAISE EXCEPTION '0100 post-condition failed: admin bypass leaked into a personal-content SELECT policy';
  END IF;

  FOREACH t IN ARRAY ARRAY['otter_subject_share(uuid,uuid,text)',
                           'otter_subject_share_accept(uuid)',
                           'otter_subject_share_decline(uuid)',
                           'otter_subject_share_revoke(uuid)',
                           'otter_subject_shares_index()',
                           'otter_has_accepted_subject_share(uuid)',
                           'fn_otter_subject_share_guard()']
  LOOP
    IF to_regprocedure('public.' || t) IS NULL THEN
      RAISE EXCEPTION '0100 post-condition failed: function % missing', t;
    END IF;
    -- anon is a member of PUBLIC, so a PUBLIC grant shows here too.
    IF has_function_privilege('anon', 'public.' || t, 'EXECUTE') THEN
      RAISE EXCEPTION '0100 post-condition failed: % is executable by anon or PUBLIC', t;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.fn_otter_subject_share_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION '0100 post-condition failed: the guard trigger function is executable by authenticated';
  END IF;

  FOREACH t IN ARRAY ARRAY['trg_otter_subject_share_audit', 'trg_otter_subject_share_guard']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.otter_subject_shares'::regclass
                      AND tgname = t AND NOT tgisinternal) THEN
      RAISE EXCEPTION '0100 post-condition failed: trigger % missing', t;
    END IF;
  END LOOP;

  -- The guard is BEFORE, FOR EACH ROW, for INSERT and for UPDATE: tgtype bits
  -- 1 (row), 2 (before), 4 (insert), 16 (update). Its name alone proves none.
  SELECT tgtype INTO n FROM pg_trigger
   WHERE tgrelid = 'public.otter_subject_shares'::regclass
     AND tgname = 'trg_otter_subject_share_guard';
  IF n IS NULL OR (n & 23) <> 23 THEN
    RAISE EXCEPTION '0100 post-condition failed: trg_otter_subject_share_guard is not BEFORE INSERT OR UPDATE FOR EACH ROW (tgtype %)', n;
  END IF;

  -- The policy kept its own guards, not only the new arm.
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='otter_subjects' AND cmd='SELECT'
                    AND qual LIKE '%has_active_membership%'
                    AND qual LIKE '%deleted_at IS NULL%') THEN
    RAISE EXCEPTION '0100 post-condition failed: otter_subjects_select lost has_active_membership or deleted_at IS NULL';
  END IF;

  -- One LIVE share per subject and person: the partial unique index, with its
  -- predicate (a plain unique index would refuse every re-share after a decline).
  SELECT indexdef INTO body FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'otter_subject_share_live_uidx';
  IF body IS NULL OR body NOT LIKE 'CREATE UNIQUE INDEX%' OR body NOT LIKE '%WHERE%'
     OR body NOT LIKE '%pending%' OR body NOT LIKE '%accepted%' THEN
    RAISE EXCEPTION '0100 post-condition failed: otter_subject_share_live_uidx is missing, not unique, or lost its predicate';
  END IF;

  -- Both arms are in the guard's body, with the comments stripped first: a
  -- LIKE on pg_get_functiondef is satisfied by a commented-out arm (0069's
  -- lesson). chr(45) is '-', so this file holds no comment marker in a string.
  body := regexp_replace(
            pg_get_functiondef('public.fn_otter_subject_share_guard()'::regprocedure),
            chr(45) || chr(45) || '[^' || chr(10) || ']*', '', 'g');
  IF body NOT LIKE '%wilson.otter_subject_share_insert%'
     OR body NOT LIKE '%wilson.otter_subject_share_update%'
     OR body NOT LIKE '%names a subject of its own workspace%' THEN
    RAISE EXCEPTION '0100 post-condition failed: the guard trigger lost one of its arms';
  END IF;

  -- The functions' owner bypasses RLS (else they could not write the table).
  IF NOT COALESCE((SELECT r.rolbypassrls
                     FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
                    WHERE p.oid = 'public.otter_subject_share(uuid,uuid,text)'::regprocedure), false) THEN
    RAISE EXCEPTION '0100 post-condition failed: otter_subject_share is not owned by a BYPASSRLS role';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
```
