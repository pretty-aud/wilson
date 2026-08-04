# SESSION 25 launch prompt — scenes/shots/levels/experiences at ADAPTER PARITY

> **Renumbered from S24 (Audrey, 2026-08-03)** when the budget moved forward.
>
> 🚨 **OPEN THIS SESSION BY CLOSING ITS HALF OF THE `projects` DRIFT.**
> **RE-MEASURED after S24 (2026-08-03):** `public.projects` now has **31**
> columns — 0036 added the nine budget settings. It still does NOT have `code`,
> `scene_start_number`, `scene_digits` or `shot_digits` — the settings the
> scene/shot auto-naming reads. Port the naming and you will hit this
> immediately. Add those four here; leave `folder_slug` / `folder_root` to the
> folder session (Audrey: "splitting is fine"). The budget columns are DONE.
>
> ➕ **THREE MORE, FOUND IN S24, AND THEY BELONG TO THIS SESSION:**
> `scenes_enabled`, `levels_enabled` and `experiences_enabled` do not exist
> either. `BudgetView.jsx:54-57` gates the **By Scene / By Shot / By Level /
> By Experience** budget tabs on exactly those three, and `:183` filters them
> out, so all four tabs silently vanish on every cloud project today.
> **Add them WITH the entities, never before** — a toggle that reveals four
> blank tabs is worse than a hidden one. Getting scenes/shots into the cloud
> therefore lights up four budget tabs for free, which is worth knowing before
> you scope.
>
> Also: `code` is needed by more than auto-naming. `ClientViewTab.jsx:129,184`
> prints `--` for the project code on the **client-facing topsheet**, the one
> document that leaves the building. Its sibling bug needs no migration at all
> — `ClientViewTab.jsx:108,126,177` reads `project.name`, which has never
> existed; the column is `title`. One-word fix, take it while you are there.

> **STATE AFTER S24, so you do not re-measure it:** migrations run
> **0000–0037** on dev, staging and prod (next free number is **0038**); pgTAP
> is **47 suites / 717 assertions**; vitest is **512**. `supabaseAdapter` now
> has the full budget surface, `listTeamMembers` (over the existing
> `workspace_directory()` RPC) and `teamAssignments` in `loadProject`.
> ⚠️ **`listTeamMembers` landing means the two hard-empty assignee dropdowns
> in `TimelineView` and `ProjectAssetsView` should now populate — nobody has
> watched them do it.** Confirm at runtime before deleting that
> `OUTSTANDING.md` entry; it was a by-product of the budget work, not a
> targeted repair.

> Paste into a new Claude Code conversation. **Start from `WILSON/`, not
> `Claude_Work/`.**
> **First tool calls**, in order and before any code:
> 1. `git status` on `feat/multi-user-v1`
> 2. read **`docs/OUTSTANDING.md`** — everything currently broken
> 3. read `docs/sessions/MASTER_PLAN_S19_ONWARD.md` — **the sequence changed;
>    read the REORDERED sequence table first - it is the authority**
> 4. `cat supabase/.temp/linked-project.json` — **read it, do not recall it.**
>    S23 left it on `wilson-dev` (`eqjzmnvkrakroyqxfsvw`).

---

## 🚨 THE RULE THAT OVERRIDES EVERYTHING

**Do not write code, ship a fix, or state a conclusion from an unproven
theory. Measure first.** (`feedback_prove_before_acting.md`.)

S23 added two sharp corollaries, both of which cost real time:

1. **Measure the environment the user is actually in.** S22 queried
   `project_members` on **wilson-dev**, found zero rows, and concluded the
   staffed branch never runs. Correct query, wrong database — Audrey uses the
   beta, which is **staging**-backed, where that table has three rows and the
   *opposite* branch runs. `.env.local` points at dev; the beta points at
   staging. Check which one the symptom came from before reasoning about it.
2. **A user action that requires a precondition is direct evidence about that
   precondition, and it outranks code reading.** The most useful fact in the
   whole investigation was that `setShowNewAssetPopup(true)` has exactly one
   caller — the `canWrite`-gated button — so Audrey having *opened* that dialog
   proves the flag was true. Two agents had built confident stories that this
   one observation killed.

**Label everything MEASURED / INFERRED / GUESSED.**

---

## Where S23 left things

**`2727328` — item creation works again.** Applied and verified **by query** on
dev, staging and prod; all four CI jobs green.

- **0034** — `tasks.asset_id` nullable (Audrey: *"not all tasks need assets"*),
  `tasks.phase_id` added, `tasks_select` DROPped and re-CREATEd so an
  asset-less task is visible while still vanishing with a deleted project.
- **0035** — `assets.start_date` / `assets.due_date`. Columns rather than
  deleting the keys, because those values are written from four surfaces;
  dropping them would trade a loud failure for silent data loss.
- **Adapter column allowlist** on upsert AND patch for `tasks`/`assets`.
  `sanitize()` was a **denylist**, so every invented field reached PostgREST
  and killed the whole request with PGRST204. It **warns** on each dropped key
  — a warning for a field a user can edit means that field needs a column, not
  a bigger allowlist.
- **Errors surface.** The New Asset dialog had `try/finally` with no `catch`;
  `RabbitProvider.addTask` now reports through the provider's error channel and
  rethrows, covering all six add affordances.

**Proven, not claimed:** the exact payload that returned `23502` before now
SUCCEEDS on staging, re-run through the same probe.

**pgTAP 42 suites / 655 assertions, vitest 482.** Unchanged by S23 — and that
is itself a finding: *nothing* tests item creation, which is why a total
failure of the app's primary action shipped unnoticed. Fix that this session.

---

## S25 — scenes, shots, levels, experiences on BOTH adapters

**Audrey, explicitly: "it shouldn't only be cloud. it should be able to live in
a local server as well."** They already work in `local_server` (JSON bundle —
`ScenesView.jsx`, `LevelsView.jsx`, `ExperiencesView.jsx`); the Supabase
adapter **throws** (Known #5). So this is not "make them cloud", it is
**parity**: one entity shape, implemented on both sides, neither losing the
other.

Scope:
- Migrations + RLS + pgTAP suites for scenes, shots, levels, experiences.
  Follow the 0033 shape: `REVOKE ALL … FROM anon` and the standing
  `ok(NOT has_table_privilege('anon', …))` probe per table. **`rls.yml`'s
  `RLS_TABLES` allowlist at the GIT ROOT must gain each new table**, and a new
  suite file must also be added to the failure-replay list at `rls.yml:114`.
- Supabase adapter methods to match the Express routes.
- **Port the auto-naming into shared code so both adapters name identically:**
  scene `CODE{sep}SC{n}` padded to `scene_digits` (default 3), shot
  `CODE{sep}SC{n}{sep}SH{n}` padded to `shot_digits` (default 4). It lives in
  `ScenesView.jsx:348,363` on `origin/main` today — view-local, which is why
  nothing else can reuse it.
- **Toggle semantics:** ON creates; OFF removes from the R.A.B.B.I.T. view
  **only** and never deletes anything.
- **Task templates** — `listProjectTaskTemplates` is `localServerAdapter`-only,
  so the New Asset dialog's template dropdown is permanently empty in cloud and
  its template branch is dead code. Same parity problem; fix it here.
- **The two hard-empty assignee dropdowns** — `TimelineView.jsx:4228` and
  `ProjectAssetsView.jsx:2108` read `useTeamMembers`, which needs
  `adapter.listTeamMembers`, which exists only on localServer. Same fix shape.
- **Add the missing creation coverage** — vitest around the adapter payloads
  (an allowlist regression is invisible otherwise) and pgTAP for the new tables.

**Do NOT add scene/shot/level/experience columns to `tasks` yet.** 0034's
header says why: those four fields are on the Timeline task payload and are
dropped by the allowlist today. Once these entities are real, decide
deliberately whether a task references them.

**Close-out owes Audrey a decision:** Supabase Storage has no real folders —
object storage with prefixes, so an *empty* folder cannot exist. Either a
placeholder object per folder or a **`folders` table as source of truth**
(recommended: survives a backend switch, makes "toggle off never deletes"
trivial, identical on all three backends). **S26, the folder session,
  cannot start without it.**

---

## Still open, and NOT to be guessed at

### Every create button can vanish behind one `canWrite` flag
**Gate MEASURED, cause NOT ESTABLISHED.** See `OUTSTANDING.md`. One boolean
hides six surfaces including New Asset. `canWrite === false` needs a session
that is neither app admin/manager nor project manager/member — and `audrey` is
**both** on staging. **Ask Audrey which account the session holds, and whether
New asset is present while New task is gone**, before writing anything. If it
recurs, instrument it; do not reason about it further.

Regardless of cause, the UX is wrong: a reviewer should be told why they cannot
add, not have the control silently disappear.

---

## Traps

- 🚨 **NEVER run `supabase config push`, and never build a shell command by
  interpolating content into it.** Write scripts to a file and run the file.
- **`git add -A` sweeps untracked files into a PUBLIC commit.** Stage explicit
  paths. `docs/messed up handbook.pdf` must stay untracked.
- **A migration's text does not tell you the database's state.** Query it.
- **Check the GRANTEE, not just the grant** (S22): the 25 tables were granted
  to `anon`, but seven SECURITY DEFINER functions were granted to **PUBLIC**, so
  `REVOKE … FROM anon` on those would have been a silent no-op.
- **`supabase db query --file` returns only the LAST result set.** One query
  per file.
- **`sanitize()` is a denylist; `toColumns()` is the allowlist** (S23,
  `supabaseAdapter.js`). Any new table written from the client needs an entry
  in `COLUMN_ALLOWLIST` or its first invented field will PGRST204 the request.
- **Ordering rules for manual re-runs:** 0022 → 0025 AND 0026 · 0028 → 0031 ·
  0002 → 0029 · 0011 → 0030 · 0009 → 0020 · **0011 → 0033** (re-running 0011
  silently undoes the entire S22 privilege sweep and 0011 has no post-condition
  that would notice).
- **Run the whole pgTAP set before pushing a migration**, one suite per
  transaction. `collected` MUST equal `planned`. The shim has NO `has_index`,
  `col_type_is`, `col_default_is`, `col_not_null`, `results_eq` or `matches`;
  `throws_ok` matches **message text**, not a SQLSTATE.
- **Permissive RLS policies OR together** — replace a policy by DROP + CREATE,
  never by adding a narrower one beside it.
- **`.github/workflows/rls.yml` is at the GIT ROOT**, not under `WILSON/`.
- **`docs/SYSTEMS_HANDBOOK.md` is a gate, not an oracle.** S21 corrected its
  counts, S22 its migration range and SECURITY DEFINER count. Check the code.

---

## Still owed by Audrey — blocking the v1.0.0 tag

1. **Rotate `smoke_admin`** — published in the PUBLIC repo, permanent in git
   history. `OWED_AUDREY.md` §0, TPN-SDLC-007. The one open CRITICAL.
2. **Rotate `wilson-staging`'s legacy `service_role` key** (S19 exposure).
3. **Complete `docs/RELEASE_TESTING.md`.**
4. **v1.0.0 is prepared, NOT tagged, NOT merged.** Ask before tagging, and ask
   **again** before merging to `main` (Vercel's production branch).

---

## Close-out ritual

Feature commit(s) → CI green (**all four jobs** — a skip is not green) → deploy
migrations dev → staging → prod (dry-run each, verify each **by query**) →
re-link CLI to `wilson-dev` → write `docs/sessions/SESSION_25_prompt.md` →
update `docs/MASTER_PLAN.md` (§4 ledger, §6 gaps) and
`MASTER_PLAN_S19_ONWARD.md` → update `docs/SYSTEMS_HANDBOOK.md` if behaviour
changed → **update `docs/OUTSTANDING.md`** → update the Claude auto-memory →
docs commit + push.

> **On `docs/OUTSTANDING.md`:** add only what is **broken and not yet fixed**,
> including anything this session breaks; delete what it fixes, citing the
> commit; tag MEASURED / REPORTED / INFERRED. **Adding nothing is a correct
> outcome.**

> **THEN, FINALLY, IN THE CHAT — both required, after everything is pushed:**
>
> 1. **List the remaining sessions**, one line each, a few words only, marking
>    any that are done. If the order changed, say so.
> 2. **A layman's breakdown of what this session accomplished**, in bullet
>    points, plain English. **No jargon, no table names, no migration numbers,
>    no file paths.** Write what CHANGED FOR AUDREY, not what was done to the
>    code — "you can create tasks again, every one you made before tonight was
>    silently failing", not "dropped the NOT NULL on tasks.asset_id". Say
>    plainly what is fixed, what is only diagnosed, and what she needs to do
>    herself. The technical record is already in the commits; this is the part
>    she actually reads.
