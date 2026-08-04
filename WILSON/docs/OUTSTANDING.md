# Outstanding problems

Everything currently known to be **broken and not yet fixed**. Live document —
updated at the end of every session.

## The rule for this file

**Only add something if it is broken and unfixed.** Not "could be improved",
not "worth watching", not "we should probably". If it is fixed in the same
session it is not an entry, it is a commit message.

Three things follow from that:

- **An empty session adds nothing.** A session that fixes things and breaks
  nothing leaves this file untouched. That is a good outcome, not a gap to
  fill. Padding it with hedges makes the real entries harder to see, and a list
  nobody trusts is a list nobody reads.
- **Delete entries when they are fixed.** Cite the commit in the session
  close-out, then remove the entry. This file is the present state, not a
  history — `git log` is the history.
- **Say how you know.** Every entry is tagged, because the difference decides
  whether the next session starts by fixing or by diagnosing:
  - **MEASURED** — observed failing. Says what was run and what came back.
  - **REPORTED** — Audrey hit it; not yet reproduced or diagnosed.
  - **INFERRED** — code reading says it must break, not yet seen failing.
    Names what would settle it.

Anything that is merely unverified, interim, or planned belongs in
`MASTER_PLAN_S19_ONWARD.md`, not here.

---

## 🚨 Security — blocks the v1.0.0 tag

### `smoke_admin` password is in public git history
**MEASURED.** The repo `pretty-aud/wilson` is public and the password was
committed. Rotating the account does not remove it from history.
→ `OWED_AUDREY.md` §0, TPN-SDLC-007. **Audrey's action.**

### `wilson-staging` legacy `service_role` key was exposed
**MEASURED.** S19 (2026-08-02): `supabase projects api-keys` returns every key
in a single JSON line, and a `grep -v service_role` filter that assumed
line-per-key printed all of them into a session transcript. The key bypasses
RLS.
→ Rotate: dashboard → wilson-staging → Settings → API → Legacy API keys → roll
`service_role`. The `anon` key beside it is publishable and needs nothing.
**Audrey's action.** Never filter that command's output; select the one field.

---

## Broken features

### Every R.A.B.B.I.T. create button can vanish behind one `canWrite` flag
**MEASURED gate, cause NOT ESTABLISHED (S22/S23, 2026-08-03).** Audrey reported
the New Task button first showing the label "export", then disappearing from
the Tasks tab *and* Board view.

The gate is certain. `canOnProject(..., 'project.entity.write')`
(`projectRoleMatrix.js:70-76`) drives a single `canWrite` boolean that hides
the toolbar New task, every add-row, the per-group rows, the row menu action,
both kanban add affordances **and** the New Asset button — six surfaces from
one flag. The "export" observation is confirmed as its signature, not a
rendering glitch: the JSX order is `[count, Export, [Phase, Key Date, New
task]]`, so dropping the gated three leaves Export in New task's pixel
position.

**The cause is not established, and two measurements argue against the obvious
one.** `canWrite === false` requires a session that is neither app
admin/manager *nor* project manager/member. On staging `audrey` is **both**
(workspace admin, project manager) and cannot satisfy that conjunction. And
decisively: `setShowNewAssetPopup(true)` has exactly one caller — the
`canWrite`-gated button — so the fact that she *opened* the New Asset dialog
proves `canWrite` was **true** at that moment, and both views compute it from
identical inputs.

Candidates not excluded: the session is `audrey2` (app_role `user`, project
role `reviewer` — the one account that fits) or `tester`; or
`usePermissions` returns `role: null` while its own `getSession()` is
outstanding, since consumers ignore its `ready` flag and the known auth-lock
defect can hold that read forever.

→ **Do not write a fix from this.** One runtime observation settles it: which
account the session holds, and whether New asset is present while New task is
gone. Separately, the UX is wrong either way — a reviewer should be told why
they cannot add, not have the control silently disappear.

### The budget system does not exist in the cloud schema
**MEASURED (S23, 2026-08-03).** Reported by Audrey as "the default contingency
and margin come up as 0%" and "i have tried to update the percentage and it
doesn't save". The cause is not a save bug: checked against a full census of
all 36 public tables, there is **no `budget_lines`, `budget_actuals`,
`budget_versions` or `expenses` table, and no `margin` or `contingency` column
anywhere in the database.** The cloud schema holds only
`projects.budget_currency` and the rate fields on `rate_card_entries`
(`day_rate`, `week_rate`, `month_rate`, `wage`, `burden`, `burden_type`,
`overhead`, `overhead_type`).

Those structures exist only in the local JSON bundle — `mirrorProjectDatabases`
on `origin/main` writes `budget.json` with exactly `budgetLines`,
`budgetActuals`, `budgetVersions`, `expenses`. So there is nowhere in the cloud
to persist a percentage, and the 0% is what an absent value renders as.

Same defect class as `tasks.asset_id` and `assets.start_date`, one layer up: a
UI built against a local schema the cloud migration never gained.

**Wider than the budget — `projects` is missing columns three planned sessions
need.** MEASURED: `public.projects` has 22 columns, and ALL of these are
absent: `budget_actual_column_mode` (so the pay-cadence selector at
`ProjectSummaryView.jsx:669` cannot save either), `margin`, `contingency`,
`code`, `scene_start_number`, `scene_digits`, `shot_digits` (S24's scene/shot
auto-naming has no settings to read) and `folder_slug` / `folder_root` (S25's
folder tree has no anchor — main's `ensureProjectFolders` keys off
`folder_slug`). One defect class, not four bugs: the UI was built against
main's local JSON project shape and the cloud table never gained the fields.

Also reported and unbuilt: the crew/team tab should show each member's title
plus a **separate, manager-editable project job title**; the budget's phases
tab should list the timeline's phases; and a phase should total
`(task cost = rate × days) + expenses`.

→ **S27**, scoped in `docs/sessions/SESSION_27_prompt.md`, which carries the
open questions and the 🚨 warning that a job title must NOT be written into
`project_members.project_role` (a permission column read by
`can_write_project()`).

### Task templates do not exist in cloud mode
**MEASURED (S23).** `listProjectTaskTemplates` / `listTaskTemplates` have zero
occurrences in `supabaseAdapter.js` — they are `localServerAdapter`-only — so
`useTaskTemplates` returns `[]` and the New Asset dialog's Task Template
dropdown is permanently empty. The template branch
(`ProjectAssetsView.jsx:1378-1419`) is dead code in cloud, which also makes its
`role_slug` bug there unreachable (the real column is `assigned_role_slug`).
`task_template_id` is dropped by the S23 adapter allowlist rather than given a
column, because a column for a feature with no cloud implementation is schema
debt. → S24 adapter parity.

### ~~R.A.B.B.I.T. item creation fails in cloud mode~~ — FIXED (S23, `2727328`)
Deleted per the rule for this file. Migrations 0034 + 0035 and the adapter
column allowlist; proven by re-running the original probe, where the exact
payload that returned `23502` now SUCCEEDS on staging. Detail is in the commit
and the session log below.

<!-- removed: the original entry's evidence now lives in 2727328's message

Inserting the exact payload the UI sends, as an authenticated admin member of
the fixture workspace, via `tests.rls_setup()` + real JWT claims:

```
23502: null value in column "asset_id" of relation "tasks"
       violates not-null constraint
```

The chain, every hop read:
- `ProjectTasksView.jsx:406` `handleAddTask` sends `{title, status, priority}`.
  The toolbar button (`:635`) passes no defaults; the Board's inline add
  (`:1582-1594`) only sets `asset_id` when `kanbanGroup === 'asset'`, and the
  default group is `'status'`.
- `RabbitProvider.jsx:1577` adds `id`/`project_id`/`status`/`priority` — still
  no `asset_id`.
- `0000_rabbit_base_schema.sql:178` — `asset_id uuid not null references
  assets(id)`. No migration ever relaxed it. Contrast `workspace_id`, which
  IS auto-stamped by `trg_tasks_populate_workspace` (`0004:161-164`) — which
  is why adding `workspace_id` by hand changes nothing (measured, case B).
- `supabaseAdapter.js:83` `unwrap` throws; `RabbitProvider.jsx:1584` awaits
  the adapter **before** `setBundle` at `:1587`, so no row is ever added to
  state and there is no optimistic row to flicker.
- `ProjectTasksView.jsx:406` has no `try/catch` and the `onClick` arrow drops
  the rejected promise. No `unhandledrejection` handler exists anywhere in
  `src/` or `electron/`. **Net effect on screen: nothing at all.**

So "the button does nothing" is literal. And in Board view what *vanishes* is
the typed text, not a rendered card — `commitAdd` clears the input
unconditionally before the write resolves. The optimistic-insert theory in the
old plan doc is **refuted**: there is no optimistic state on this path.

Cloud-mode only. The local Express route (`main.cjs:1090-1098`) writes
`req.body` into a JSON bundle with no column check, so the same click succeeds
on Local Server. **Cheap falsifying test before anyone edits code:** switch
R.A.B.B.I.T. to Local Server and click New task. Works locally + dead in cloud
confirms this; dead in both refutes it. (The web build forces `supabase`, so
the beta always takes the failing path.)

→ **Not fixed here — deliberately.** The obvious fix is wrong on its own:
`0014_soft_delete.sql:238` makes `tasks_select` require
`EXISTS (SELECT 1 FROM assets a WHERE a.id = tasks.asset_id)`, so a task with
a NULL `asset_id` fails its own SELECT policy and `.single()` returns PGRST116.
Making the column nullable would **move** the failure, not remove it. Both must
change together, and whether a task may exist without an asset is a product
decision, not a schema detail. Also worth knowing: there is **no automated
coverage of task creation at any layer** — no vitest, no pgTAP. That is why a
total failure shipped unnoticed. → S24.
-->

**Still true and still owed:** there is **no automated coverage of item
creation at any layer** — no vitest, no pgTAP. A total, permanent failure of
the app's primary action shipped unnoticed for that reason alone. → S24.

### Two of the four assignee dropdowns are hard-empty in cloud mode
**MEASURED (S23).** Upgraded from the S22 entry, which reasoned from **dev**
where `project_members` is empty. On **staging** — Audrey's actual environment
— it has 3 rows, so the *staffed* branch runs, not the fallback. The S22
conclusion was measured against the wrong database.

- `TimelineView.jsx:4228` (task editor) and `ProjectAssetsView.jsx:2108`
  (asset-detail task rows) are **unconditionally empty in cloud**, independent
  of roster, claims or RLS: both read `useTeamMembers`, which early-returns
  without `adapter.listTeamMembers`, and that method exists **only** on
  `localServerAdapter`. `supabaseAdapter.loadProject` (`:247`) also omits
  `teamAssignments` entirely. Audrey was most likely looking at one of these.
- `ProjectTasksView`'s dropdown is on the healthy `workspace_directory()` path
  and intersects correctly — but if the roster ever resolves to `[]`, the
  staffed branch filters an empty list and yields `[]` too, and
  `useRosterMembers` **drops the error** rather than passing it through, so an
  RPC failure and a genuinely empty workspace are indistinguishable at every
  call site.

→ Fix the two legacy dropdowns via adapter parity, and surface the roster
error. S24.

### Scenes / levels / experiences are unavailable on cloud projects
**MEASURED.** Local-only by design — the Supabase adapter throws (Known #5).
Audrey calls these crucial, so the current behaviour is a silent throw where
there should at least be honest copy.
→ Decision pending: make them cloud-capable (migration + RLS + adapter + suite,
a session of its own) or keep local and say so in the UI.

### One hung `getSession()` pins the whole app's auth, and `withTimeout` cannot unpin it
**MEASURED (S21, against `@supabase/auth-js` 2.101.1 as installed.)** This
replaces the old "Profile panel can spin forever" entry, which framed the
problem as N independent call sites. It is not.

Two facts, both read out of `node_modules`:

1. **The class is far larger than the explicit call sites.** supabase-js binds
   `_getAccessToken()` into `fetchWithAuth` for *every* PostgREST, Storage and
   Functions request, and that awaits `auth.getSession()` internally
   (`supabase-js/dist/index.mjs:523-528`). So every `.from(...)` carries the
   same unbounded wait. Counting `.auth.getSession()` occurrences understates
   it by an order of magnitude.
2. **`withTimeout` races, it does not abort** — by design
   (`withTimeout.js:16-19`). The abandoned call still holds `lockAcquired` in
   auth-js, and the lock is global per `storageKey`. Every later auth operation
   then queues in `pendingInLock`, which consults **no** acquire timeout
   (`GoTrueClient.js:2232-2251`). All three clients share the one lock —
   RABBIT's `sharedAuthedClient` is the same instance.

**Consequence, and why the planned "sweep the 22 sites" was not done:** bounding
a call site restores *that site's UI* and nothing else. A sweep would have gone
green and left the app just as stuck, while letting the session report the class
as closed.

What S21 did instead (`10fcd29`): fixed the two places where the defect was
actually reachable and reportable — `ProfileSection`'s loader now has
`try/catch/finally` so `loading` clears on every path (the `Promise.all`'s
*other* leg is unbounded too, so bounding only the auth call would not have
closed it), and `aiProxy`'s pre-flight is bounded with its own code and message
rather than falling through to "Sign in to use AI features."

→ The real remediation is probably an app-level circuit-breaker or forced
re-hydrate, not per-site ceilings. **Design it before writing it.**

### Avatar does not persist
**REPORTED; root cause still unproven.** S21 falsified four hypotheses by
measurement — the `avatar_url` column, the `user-avatars` bucket (public, 2 MB,
correct MIME list), the storage policies, and the `isOwnAvatarUrl` render guard
all exist and are correct, and the self-guard trigger RAISES rather than
silently reverting and does not block `avatar_url` on a self-update.

**Definitively NOT the same cause as the loader hang above** — if the load
hangs, the component early-returns "Loading profile…" and the avatar controls
are never mounted, so no upload can start.

`10fcd29` fixed two things that were making every failure mode *look like
success*: an RLS-refused UPDATE matches zero rows and raises nothing, and the
code merged the patch into local state anyway; and the `catch` never cleared
`avatarFile`, so the blob preview survived any failure until the next mount.

→ **That makes a silent failure loud; it does not prove the report is fixed.**
If it recurs, the panel will now say what went wrong — capture that message.
The one candidate not yet excluded is whether the Storage API populates
`request.jwt.claims` with `app_metadata` at all; if it does not,
`current_workspace_id()` is NULL inside the storage policy and every upload is
refused in every environment. One devtools Network capture of the
`POST /storage/v1/object/user-avatars/...` settles it.

### O.T.T.E.R. validator findings and quiz scores are not saved
**MEASURED.** Known #2. Both generate correctly and neither result is
persisted, so the work is lost on navigation.

### D4 is enforced for stored settings, not for a hand-made request
**MEASURED (S20).** Migration 0031 FKs both override tables to
`platform_approved_models`, so an admin or user cannot *persist* an unapproved
model — verified against wilson-dev, the insert fails on
`workspace_model_overrides_model_id_fkey`. What is **not** covered: `ai-proxy`
does not check the requested model against the catalogue, so an authenticated
user with devtools can POST an arbitrary model id on a one-off request and it
will be served.

This is a deliberate scope decision (Audrey, 2026-08-02), not an oversight: a
catalogue read on the path of every AI call turns a database hiccup into an AI
outage, which is the exact failure class that cost 47 days. D4's stated purpose
— stopping a company admin putting every generation on the priciest model —
holds, because that requires *storing* a choice.
→ Fix if it ever needs to be airtight: check `model` against a cached catalogue
in `ai-proxy` and 403 on a miss, failing **open** if the catalogue read itself
fails. Not scheduled.

### Welcome page has a phantom cursor
**REPORTED.** A black cursor blinks permanently, unattached to any input, and
keeps blinking on the right while typing elsewhere. Likely the shared
`AuthCursor` from `AuthShell.jsx` — **that is a guess, confirm in the DOM
first.**
→ S25.

---

## Session log

Kept so the file's own history is visible without `git log`.

| Session | Added | Removed |
|---|---|---|
| S19 (2026-08-02) | staging `service_role` exposure | **email templates** (confirmed on all three projects; the entry was seeded from a stale S18 note). **wilson-dev auth config** — added and closed the same session; restored by hand, CI green on `68c9758`. |
| S20 (2026-08-02) | the D4 / `ai-proxy` boundary above — recorded because it is a stated limit of what shipped, not because anything regressed | nothing (S20 touched none of the entries below the security block) |
| S20, later the same day | nothing new. The Profile-panel entry was **corrected**: the unbounded-`getSession()` class is 26 sites, not 18, and S20 itself added two of them (`modelSources.js`, both writers). Those two are now bounded with `withTimeout` and pinned by tests that fail with a hang when the bound is removed. The rest of the class is S21's sweep. | nothing |
| S23 (2026-08-03) — **same conversation as S22**; it completed the S22 brief, wrote the S23 brief, then executed it in the same sitting when Audrey reported she could not create anything. No gap, nothing skipped. | **every create button can vanish behind one `canWrite` flag** — the gate is MEASURED, the cause is NOT ESTABLISHED, and the leading theory was refuted by the fact that opening the New Asset dialog proves the flag was true. **Task templates absent in cloud.** Both are pre-existing, neither was introduced this session. | **R.A.B.B.I.T. item creation** (0034 + 0035 + `2727328`, applied and verified by query on all three envs; the original failing payload now SUCCEEDS on staging). The assignee-dropdown entry was **corrected, not closed** — S22 measured it against dev, where the roster is empty; staging behaves differently and two dropdowns are hard-empty for a different reason entirely. |
| S22 (2026-08-03) | the R.A.B.B.I.T. task-creation entry, **upgraded REPORTED → MEASURED** with a reproduced `23502` and a named cause, plus a separate **assignee-dropdown** entry whose documented lead turned out to point at a branch that never runs. Neither is new breakage — the old entry was one line of guesswork and is now two entries of evidence. | the **`anon` privilege spread** (0033 + `494a13d`, applied and verified **by query** on dev, staging and prod: 25 tables → 0, and 7 anon-executable SECURITY DEFINER functions → 0). **Storage tab reads as broken on the web** (`8709b1e`). |
| S21 (2026-08-02) | the **`anon` privilege spread** (25 tables remaining) — found by a test assertion failing, not by looking for it. The **auth-js global lock**, which replaces the old Profile-panel entry with a correct account of why per-site ceilings do not fix it. | **`rate_cards.type`** (0032 + `10fcd29`, applied and verified on dev, staging and prod). **Password change missing** (`10fcd29`). **Profile panel spins forever** — superseded, see above. The avatar entry is kept but rewritten: four hypotheses falsified, the success-masking fixed, root cause still open. |

S23's lesson is **measure the environment the user is actually in.** S22
measured `project_members` on wilson-dev, found zero rows, and concluded the
staffed branch never runs — sound reasoning from a real query. But Audrey uses
the beta, which is **staging-backed**, where that table has three rows and the
opposite branch runs. The measurement was correct and the conclusion was wrong
because it was taken from the wrong database. Checking `.env.local` (dev) vs
the beta host (staging) is one command and it reframes every roster symptom.

Its corollary is about evidence ranking. The single most useful fact in the
whole investigation was not found by reading permission code: it is that
`setShowNewAssetPopup(true)` has exactly one caller, the `canWrite`-gated
button — so **Audrey having opened that dialog proves the flag was true**. A
user action that requires a precondition is direct evidence about that
precondition, and it outranks any amount of reasoning about how the flag is
computed. Two agents had built confident stories that this one observation
killed.

S22's lesson, and it is about **grantees, not grants**. The 25 tables were
granted to `anon` explicitly, so `REVOKE ... FROM anon` worked. The seven
SECURITY DEFINER functions were granted to **PUBLIC** — every one carried a
bare `=X/postgres` aclitem — so the same statement against them would have been
a **silent no-op**: no error, migration reports success, hole still open, and
nothing visible afterwards without re-querying the ACL. 0011:42 already knew
this (`REVOKE ... FROM PUBLIC, anon`) and the knowledge had not travelled.
**Check who actually holds the privilege before writing the REVOKE, and make
the post-condition scan every object rather than the ones you listed.** The
scan is what would have caught it; the list is what would have missed it.

The second half of the lesson is about scope. The recorded problem was "25
tables". Asking what *else* migration 0011's blanket grant touched found two
more things nobody had written down — the anon-executable SECURITY DEFINER
functions (a live pre-auth RLS bypass, not a latent grant) and the still-armed
`ALTER DEFAULT PRIVILEGES` that would have re-opened the hole on the next
`CREATE TABLE`. Fixing only the documented 25 would have been a correct fix to
a third of the problem, and would have read as complete.

S21's own lesson, and the reason the `anon` entry exists at all: **a test
assertion written to the house convention found a hole nobody was looking for.**
The migration was scoped to add one column. The suite grew the standing
`ok(NOT has_table_privilege('anon', …))` probe because that is what the
convention says to do, it failed, and 26 tables turned out to be open. Two
independent investigators had both reasoned — correctly, from the migration
text — that no REVOKE was needed, because `ALTER TABLE ADD COLUMN` creates no
new object and so does not trip 0011's trap. That reasoning was sound and the
conclusion was still wrong, because nobody had checked the *existing* grant
state. Reasoning about what a migration does is not a substitute for querying
what is there.

Both S19 additions were the same root cause: **a shell command built by string
interpolation, where the content was not safe for the shell.** The first
printed a `service_role` key into a transcript because a `grep -v` filter
assumed line-per-key JSON; the second ran `supabase config push` because bash
evaluated backticks inside a double-quoted `node -e`. Neither was a reasoning
error — both were quoting. See the standing rule in `MASTER_PLAN.md`.

One lesson from closing the second one, worth keeping: **the push diff showed
what it attempted, not what it changed.** Of nine settings listed, only two
were actually off when checked — `Enable email provider` and TOTP. Site URL,
OTP length, signup and confirm-email were all still original. Reading the live
state first would have replaced a nine-row restore list with a two-row one.
