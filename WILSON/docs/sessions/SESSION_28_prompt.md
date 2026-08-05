# SESSION 28 launch prompt — TASK TEMPLATES IN CLOUD + the verification sweep

> **STATE AFTER S27 (2026-08-04, `5384d4e`), so you do not re-measure it:**
> migrations run **0000–0043** on dev, staging and prod (next free number is
> **0044**); pgTAP is **53 suites / 808 assertions**; vitest is **680**.
> `public.files` has **29 columns**. `public.projects` has 50. All four CI
> jobs green, Playwright included.
>
> ✅ **The manifest can be rewritten.** 0042 added the UPDATE arm the
> `rabbit-files` bucket had never had. Before it, `PROJECT.json` was written
> ONCE per project and every later write was refused in silence.
>
> ✅ **Project rates travel with the project folder.** `FINANCE/RATES.json`,
> gated by `can_access_project_money` exactly as `INVOICES` is. Audrey chose
> this over leaving rates app-only (2026-08-04).
>
> 🚨 **`public.rabbit_money_segment(text)` IS THE ONLY DEFINITION of a
> money-gated path segment.** The three base storage policies negate it, the
> four money policies assert it. Adding a third reserved segment is a one-line
> change to that function — **do not** add a parallel set of policies, which is
> how 0038 inverted the invoice gate. It is NULL-safe on purpose: a path with
> no third segment (i.e. `PROJECT.json`) must classify as NOT money-gated, or
> the manifest becomes unreachable for everyone.
>
> ✅ **The folder tree now reconciles on load.** It had produced **zero rows on
> every environment** because its only caller was `createProject`.

> Paste into a new Claude Code conversation. **Start from `WILSON/`, not
> `Claude_Work/`.**
> **First tool calls**, in order and before any code:
> 1. `git status` on `feat/multi-user-v1`
> 2. read **`docs/OUTSTANDING.md`**
> 3. read `docs/sessions/MASTER_PLAN_S19_ONWARD.md` — the sequence table is
>    the authority
> 4. `cat supabase/.temp/linked-project.json` — **read it, do not recall it.**
>    S27 left it on `wilson-dev` (`eqjzmnvkrakroyqxfsvw`).
>    ⚠️ **The CLI actually reads `supabase/.temp/project-ref`**, a plain-text
>    file beside it. Both exist and currently agree. If they ever disagree the
>    CLI follows `project-ref` while the standing rule points you at the JSON —
>    check both.

---

## 🚨 THE RULE THAT OVERRIDES EVERYTHING

**Do not write code, ship a fix, or state a conclusion from an unproven
theory. Measure first.** (`feedback_prove_before_acting.md`.)

**S27's addition to the standing corollary — and it is a new failure mode, not
a repeat.**

S20 named the wrong migration number. S24 named `margin` when the column was
`budget_margin_pct`. S25 named `code` when the writer was `project_code`. S26
was given a *correct* citation for `files_dir` and the right answer was still
to add nothing, because the writer could not run on that backend.

S27 found something none of those would have caught: **a feature with no
caller has no symptom.** The 0041 folder tree was correct, verified by query,
covered by a 22-assertion pgTAP suite and green in CI — and it had produced
**zero rows on dev, staging and prod**, because `ensureProjectFoldersFor` was
only ever called by `createProject` and every project predates it. Nothing was
wrong. Nothing had run.

> **So the question is now three questions.** Who WRITES this field, CAN that
> writer run on this backend, and **is anything actually calling it?**

The cheap check is a census, not a code read: `SELECT count(*)` on the table
the feature populates, in the environment the user is in. It takes one query
and it is the only thing that distinguishes "built" from "working".

**Label everything MEASURED / INFERRED / GUESSED.**

---

## 🚨 THE VERIFICATION DEBT — do this FIRST, it is small and it is overdue

Three separate items have now been carried for multiple sessions purely
because **nothing in this repo automates a signed-in session against
staging.** They are all closable by one person looking at one browser for
about five minutes. S25, S26 and S27 were each asked and none could.

**Do this before writing any code**, because two of the three might already be
fixed and you would otherwise build on top of an unknown.

1. **The two assignee dropdowns** (`TimelineView.jsx:4228`,
   `ProjectAssetsView.jsx:2108`). The stated cause was removed at CODE level in
   S24. Nobody has watched them populate. **One look at the Timeline task
   editor on the beta closes it.**
2. **Files in cloud mode.** S27 rebuilt FileManager to serve `public.files`
   when the backend has no managed-file store, added the Resources drop zone
   and the folder/manifest panel, and wired the rates mirror. All of it is
   code-complete and **none of it has been exercised by a signed-in user.**
   Upload one file to an asset on the beta; it should appear, download, and
   show up in Resources → PROJECTS → that project.
3. **The `canWrite` gate.** Read `OUTSTANDING.md`'s entry IN FULL before
   touching it. Exactly one theory is refuted (on code); the other rests on
   testimony. 🚨 **Audrey runs two accounts in two browsers at the same time.**
   Never ask "which account are you on" in general — pin it to the specific
   browser AND the specific moment. An account assumption has derailed this
   one investigation twice, from opposite directions. **Do not write a fix.**

---

## S28 — task templates in cloud

**The oldest open item on the list.** Deferred by S25 and S26 because those
sessions ran out of room, and by S27 because Audrey was asked directly and
chose to finish the file layer instead. It is not a missing adapter method.

### The measured starting position — do not re-derive it

- On Local Server, templates are **individual JSON files in their own
  directory** (`electron/main.cjs:2088-2131`), workspace-scoped with a
  project-scoped read.
- `listProjectTaskTemplates` / `listTaskTemplates` have **zero occurrences** in
  `supabaseAdapter.js`, so `useTaskTemplates` returns `[]` and the New Asset
  dialog's Task Template dropdown is permanently empty in cloud.
- The template branch (`ProjectAssetsView.jsx:1378-1419`) is **dead code**
  there, which also makes its `role_slug` bug unreachable — the real column is
  `assigned_role_slug`. Fix that when the branch comes alive, not before.
- `task_template_id` is deliberately **dropped by the adapter allowlist**
  rather than given a column, because a column for a feature with no cloud
  implementation is schema debt. It arrives WITH the feature.

### What it needs — size it as its own block

A table, its own RLS, its own pgTAP suite (54), five adapter methods, and a
`COLUMN_ALLOWLIST` entry. Plus **two** places in `.github/workflows/rls.yml`:
`RLS_TABLES` (fails loudly) and the failure-replay list (fails **silently**).

🚨 **Templates are workspace-scoped with a project-scoped read.** That is not
the shape of any existing RABBIT table — `can_write_project` is the wrong gate
because a template is not project content, and the workspace-admin-only shape
is wrong because ordinary users create templates. **Decide the gate
deliberately and write the pgTAP probes for a NON-manager first.**

---

## Carried, and NOT to be guessed at

- **O.T.T.E.R. validator findings and quiz scores are not saved.** MEASURED,
  known #2, untouched for many sessions. Both generate correctly and neither
  persists, so the work is lost on navigation.
- **One hung `getSession()` pins the whole app's auth**, and `withTimeout`
  races without aborting. Bounding N call sites fixes N UIs, **not the app**.
  The real fix is probably an app-level circuit-breaker or forced re-hydrate.
  **Design it before writing it.**
- **Avatar does not persist.** Four hypotheses falsified by measurement; the
  success-masking is fixed so a failure is now loud. If it recurs, capture the
  message. The one candidate not excluded is whether the Storage API populates
  `request.jwt.claims` with `app_metadata` at all.
- **Welcome page phantom cursor.** REPORTED. Likely `AuthCursor` in
  `AuthShell.jsx` — **that is a guess, confirm in the DOM first.**

---

## Standing traps

- 🚨 **NEVER run `supabase config push`**, and never build a shell command by
  interpolating content into it. Write scripts to a file and run the file.
- 🚨 **`Set-Content -Encoding utf8` in PowerShell 5.1 writes a BOM.** S27 lost
  time to a CLI refusing a BOM'd config file it had written itself. Use the
  Write tool for files another program will parse.
- **`git add -A` sweeps untracked files into a PUBLIC commit.** Stage explicit
  paths. `docs/messed up handbook.pdf` must stay untracked.
- **A migration's text does not tell you the database's state.** Query it.
- **Check the GRANTEE, not just the grant** (S22).
- **`supabase db query --file` returns only the LAST result set.** One query
  per file.
- **`sanitize()` is a denylist; `toColumns()` is the allowlist.** Any new table
  written from the client needs a `COLUMN_ALLOWLIST` entry.
- **Ordering rules for manual re-runs:** 0022 → 0025 AND 0026 · 0028 → 0031 ·
  0002 → 0029 · 0011 → 0030 · 0009 → 0020 · 0011 → 0033 · **0027 → 0038 →
  0039 → 0042** · 0040 → 0041 → **0043**. **Replay forwards only.**
- **`node scripts/tap-all.mjs` runs the WHOLE pgTAP set** in one command.
  `collected` MUST equal `planned`.
- **`scripts/tap-hosted.py` can run an UNAPPLIED migration together with its
  suite** in one rolled-back transaction — the safe way to iterate. The shim
  has NO `has_index`, `col_type_is`, `col_default_is`, `col_not_null`,
  `results_eq` or `matches`; `throws_ok` matches **message text**.
- 🚨 **Prove a new suite by BREAKING it.** S27 ran three deliberate breakers
  against 0042 (drop the UPDATE policy; gate INVOICES but forget FINANCE; drop
  the coalesce) and a fourth against 0043 (CASCADE instead of SET NULL). Each
  failed exactly the probe it should. A suite that has only ever passed is a
  suite you have not tested.
- **Permissive RLS policies OR together** — DROP + CREATE, never add a
  narrower policy beside a broader one.
- 🚨 **THREE GREEN CI JOBS CAN MEAN NOTHING. Playwright is the only one that
  proves the app RENDERS.** Nothing in vitest mounts `RabbitProvider`, a TDZ
  error bundles fine, and there is no eslint config. A dependency array is
  evaluated DURING RENDER — declaring a `useCallback` below something that
  names it in its deps blanks the whole app. If Playwright fails, check
  `document.getElementById('root').children.length` against the dev server.
  **`RabbitProvider` wraps the entire tree including the unauthenticated
  branch, so the login screen rendering IS evidence it did not throw.**
- **`docs/SYSTEMS_HANDBOOK.md` is a gate, not an oracle.** S21, S22, S24, S25,
  S26 and S27 each corrected it. Check the code.

---

## Still owed by Audrey — blocking the v1.0.0 tag

1. **Rotate `smoke_admin`** — published in the PUBLIC repo, permanent in git
   history. `OWED_AUDREY.md` §0, TPN-SDLC-007. The one open CRITICAL.
2. **Rotate `wilson-staging`'s legacy `service_role` key** (S19 exposure).
   `supabase projects api-keys` returns all keys as ONE JSON line — never
   filter it, select the one field.
3. **Complete `docs/RELEASE_TESTING.md`.**
4. **v1.0.0 is prepared, NOT tagged, NOT merged.** Ask before tagging, and ask
   **again** before merging to `main` (Vercel's production branch).

---

## Close-out ritual

Feature commit(s) → CI green (**all four jobs** — a skip is not green, and
neither is three-out-of-four) → deploy migrations dev → staging → prod
(dry-run each, verify each **by query**) → re-link CLI to `wilson-dev` → write
`docs/sessions/SESSION_29_prompt.md` → update `docs/MASTER_PLAN.md` and
`MASTER_PLAN_S19_ONWARD.md` → update `docs/SYSTEMS_HANDBOOK.md` if behaviour
changed → **update `docs/OUTSTANDING.md`** → update the Claude auto-memory →
docs commit + push.

> ⚠️ **Deploy migrations to STAGING BEFORE pushing code.** `feat/multi-user-v1`
> auto-deploys the STAGING-backed beta host, so code that needs a migration
> will hit a beta that does not have it yet.

> **THEN, FINALLY, IN THE CHAT — both required, after everything is pushed:**
>
> 1. **List the remaining sessions**, one line each, a few words only, marking
>    any that are done. If the order changed, say so.
> 2. **A layman's breakdown of what this session accomplished**, in bullet
>    points, plain English. **No jargon, no table names, no migration numbers,
>    no file paths.** Write what CHANGED FOR AUDREY, not what was done to the
>    code. Say plainly what is fixed, what is only diagnosed, and what she
>    needs to do herself.
