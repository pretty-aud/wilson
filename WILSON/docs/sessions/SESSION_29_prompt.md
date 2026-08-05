# SESSION 29 launch prompt — THE DESIGN PASS, and the verification debt it inherits

> **STATE AFTER S28 (2026-08-04, `06bf564`), so you do not re-measure it:**
> migrations run **0000–0044** on dev, staging and prod (next free number is
> **0045**); pgTAP is **54 suites / 832 assertions**; vitest is **35 files /
> 698 cases**. All four CI jobs green, Playwright included.
>
> ✅ **Task templates work in cloud.** `public.task_templates` (JSONB `tasks`,
> optional project pin), five adapter methods, `assets.task_template_id`, and a
> permission gate Audrey specified directly. **This was the oldest open item on
> the list and it is closed.**
>
> ✅ **The `role_slug` defect is fixed at both sites.** Applying a template
> used to create tasks with **no role**, silently, because `toColumns` dropped
> an unknown key with only a console warning. Every bid built from those tasks
> priced at nothing.
>
> 🚨 **`public.can_write_task_template(uuid)` is the ONE definition of who may
> write a template**, mirrored on the client by `canWriteTaskTemplate()`.
> Audrey, 2026-08-04: *workspace admins and managers globally; project managers
> additionally for templates pinned to their own project.* Note this differs
> from BOTH neighbours — money admits a project manager but not a workspace
> manager; the control panel admits reviewers but not members. **There is still
> no house default. Keep asking.**

> Paste into a new Claude Code conversation. **Start from `WILSON/`, not
> `Claude_Work/`.**
> **First tool calls**, in order and before any code:
> 1. `git status` on `feat/multi-user-v1`
> 2. read **`docs/OUTSTANDING.md`**
> 3. read `docs/sessions/MASTER_PLAN_S19_ONWARD.md` — the sequence table is
>    the authority
> 4. `cat supabase/.temp/linked-project.json` — **read it, do not recall it.**
>    S28 left it on `wilson-dev` (`eqjzmnvkrakroyqxfsvw`).
>    ⚠️ **The CLI actually reads `supabase/.temp/project-ref`**, a plain-text
>    file beside it. Both exist and currently agree. If they ever disagree the
>    CLI follows `project-ref` while the standing rule points at the JSON —
>    check both.

---

## 🚨 THE RULE THAT OVERRIDES EVERYTHING

**Do not write code, ship a fix, or state a conclusion from an unproven
theory. Measure first.** (`feedback_prove_before_acting.md`.)

**S28's addition, and it is about the sentences you write, not the code.**

S27 established that a feature with no caller has no symptom. S28 applied that
*before* the fact for the first time — it measured that task templates had
never produced a row on **any** backend (the Local Server directory exists and
is empty) and therefore treated "the table exists" as proving nothing.

What S28 added is smaller and sharper: **write the breakers you expect to
PASS, not only the ones you expect to fail.** Six ran against 0044. Two did
not fire, and both of those corrected a **comment** rather than the code:

- Removing `WITH CHECK` from an UPDATE policy changes nothing — Postgres
  reuses `USING` as the new-row check. The migration's first draft asserted
  the opposite, confidently, with a plausible mechanism.
- Removing a `COALESCE` changed nothing either — which is exactly what that
  function's own header claimed, so the breaker *confirmed* a stated claim
  instead of refuting it.

> **A comment in a migration is a claim about the database, and it decays
> exactly like a plan document does.** The only difference is that nobody ever
> re-reads it. A breaker you expect to pass is how you check one.

**Label everything MEASURED / INFERRED / GUESSED.**

---

## 🚨 CITE SYMBOLS, NOT LINE NUMBERS

S27 wrote `main.cjs:2088-2131` into the S28 brief from a doc that had been
correct in S23; S27 had itself inserted ~70 lines into that file. **Grep for
the symbol and read the number off the result. Re-verify any line number at
the moment you write it into a document.**

Line numbers in THIS document that S28 verified at the moment of writing:
`ProjectAssetsView.jsx:1427` and `:1730` (the two template-application task
creates), `SettingsPage.jsx:739` (the Manage Task Templates button),
`electron/main.cjs:2610-2656` (the local template routes).

---

## 🚨 THE VERIFICATION DEBT — FOUR SESSIONS OLD, AND IT IS NOT A CODE PROBLEM

**S25, S26, S27 and now S28 have each been asked to close these and none
could.** Nothing in this repo automates a signed-in session against staging.
It is roughly five minutes of one person looking at one browser.

S28 changed the approach: instead of a general request, Audrey was given a
numbered checklist naming the screen, the click and what a pass looks like.
The observations had not come back before the work was committed. **Ask again,
with that same checklist, at the START of the session rather than the end.**

1. **The two assignee dropdowns.** Cause removed at CODE level in S24; nobody
   has watched them populate. Timeline → open a task → Assignee. Then Assets →
   open an asset → its task rows. **Grep `teamAssignments`; do not trust any
   line number for these.**
2. **Files in cloud — all of S27 is unobserved.** Upload one file to an asset
   on the beta; it should appear, download, and show up in Resources →
   PROJECTS → that project. Change a project rate and confirm a
   `FINANCE/RATES.json` object appears.
3. **The `canWrite` gate.** Read `OUTSTANDING.md`'s entry IN FULL first.
   Exactly one theory is refuted (on code); the other rests on testimony.
   🚨 **Audrey runs two accounts in two browsers at the same time.** Never ask
   "which account are you on" in general — pin it to the specific browser AND
   the specific moment. An account assumption has derailed this investigation
   twice, from opposite directions. **Do not write a fix.**

**And now a fourth, because S28 shipped it unobserved:** create a task
template in Settings → RABBIT → Manage Task Templates, then apply it to an
asset and confirm the created tasks **carry their roles**. The database chain
is proven (`scripts/probes/task-templates-e2e.sql`, 6/6 on dev and staging);
the React path is not.

---

## S29 — the design pass

The last scheduled session. Audrey's original list, unchanged since S18:

- **Welcome page phantom cursor.** REPORTED. A black cursor blinks
  permanently, unattached to any input, and keeps blinking on the right while
  you type elsewhere. Likely the shared `AuthCursor` in `AuthShell.jsx` —
  **that is a GUESS. Confirm it in the DOM before touching anything.**
- **Login and welcome lost the original aesthetic.** Audrey: *"the only
  password entry with no username input was a lot cleaner."*
- **A R.A.B.B.I.T. settings tab** for project currency, rate card and task
  templates. ⚠️ Task templates now have a real permission gate — the manager
  surface is read-only for a member and says so. Do not re-expose it ungated
  while rearranging tabs.

> ⚠️ **This is the first session in the sequence that is mostly VISUAL, and
> the repo's verification tools are almost all textual.** vitest mounts no
> React, and there is no `@testing-library`. Playwright is the only job that
> renders anything. Plan to look at the running app rather than to reason
> about the JSX — and see the trap below, which is specifically about design
> work.

🚨 **THE TRAP FOR A DESIGN SESSION**, from `feedback_preview_pane_hygiene.md`:
reset the viewport after any `resize_window`, and never let scaffolding
impersonate the design. Audrey reads artefacts in the preview pane as broken
code, so a stray debug border costs more than it saves.

---

## Carried, and NOT to be guessed at

- **O.T.T.E.R. validator findings and quiz scores are not saved.** MEASURED,
  known #2, untouched for many sessions. Both generate correctly and neither
  persists, so the work is lost on navigation. **This is the largest genuinely
  broken thing left on the list.**
- **One hung `getSession()` pins the whole app's auth**, and `withTimeout`
  races without aborting. Bounding N call sites fixes N UIs, **not the app**.
  The real fix needs an app-level circuit-breaker or forced re-hydrate.
  **Design it before writing it.**
- **Avatar does not persist.** Four hypotheses falsified by measurement; the
  success-masking is fixed so a failure is now loud. If it recurs, capture the
  message. The one candidate not excluded is whether the Storage API populates
  `request.jwt.claims` with `app_metadata` at all.

---

## Standing traps

- 🚨 **NEVER run `supabase config push`**, and never build a shell command by
  interpolating content into it.
- 🚨 **NEVER pipe a file through PowerShell to rewrite it.** PS 5.1 reads
  BOM-less UTF-8 as ANSI and silently double-encodes — S28 did this to its own
  probe script and turned every `─` into `â”€` in one command. Use the Write
  tool for any file another program will parse.
- **`git add -A` sweeps untracked files into a PUBLIC commit.** Stage explicit
  paths. `docs/messed up handbook.pdf` must stay untracked.
- **A migration's text does not tell you the database's state.** Query it.
- **Check the GRANTEE, not just the grant** (S22).
- **`supabase db query --file` returns only the LAST result set.** One query
  per file.
- ⚠️ **`supabase db query -o json` does NOT return `RAISE NOTICE` output.** A
  `DO` block that logs its progress with NOTICE comes back as `"rows": []` —
  indistinguishable from one that never ran. Have probes write to a temp table
  and SELECT it (and `GRANT` on that table if the block drops to
  `authenticated`, or the first insert 42501s).
- **`sanitize()` is a denylist; `toColumns()` is the allowlist.** Any new table
  written from the client needs a `COLUMN_ALLOWLIST` entry. 🚨 **Three failure
  shapes, do not conflate them:** an un-allowlisted TABLE PGRST204s the whole
  save (loud); a dropped KEY on an allowlisted table loses ONE FIELD and only
  warns (quiet — this was S28's `role_slug`); and a key that is *legitimate*
  inside a jsonb column is never seen by `toColumns` at all.
- **Ordering rules for manual re-runs:** 0022 → 0025 AND 0026 · 0028 → 0031 ·
  0002 → 0029 · 0011 → 0030 · 0009 → 0020 · 0011 → 0033 · **0027 → 0038 →
  0039 → 0042** · 0040 → 0041 → **0043**. 0044 depends on 0004, 0008, 0013 and
  0020 and nothing depends on it. **Replay forwards only.**
- **`node scripts/tap-all.mjs` runs the WHOLE pgTAP set** in one command.
  `collected` MUST equal `planned`.
- **`scripts/tap-hosted.py` can run an UNAPPLIED migration together with its
  suite** in one rolled-back transaction — pass the migration first, then the
  suite. The shim has NO `has_index`, `col_type_is`, `col_default_is`,
  `col_not_null`, `hasnt_column`, `results_eq` or `matches`; `throws_ok`
  matches message text **exactly** (`got = $2`), not as a substring.
- 🚨 **Prove a new suite by BREAKING it** — including breakers you expect to
  pass. See the rule at the top.
- **Permissive RLS policies OR together** — DROP + CREATE, never add a
  narrower policy beside a broader one. And on UPDATE, **a `WITH CHECK` weaker
  than its `USING` is the hole**; omitting `WITH CHECK` entirely is safe.
- 🚨 **THREE GREEN CI JOBS CAN MEAN NOTHING. Playwright is the only one that
  proves the app RENDERS.** Nothing in vitest mounts `RabbitProvider`, a TDZ
  error bundles fine, and there is no eslint config. If Playwright fails, check
  `document.getElementById('root').children.length` against the dev server.
- **`docs/SYSTEMS_HANDBOOK.md` §17 is a gate, not an oracle.** S21, S22, S24,
  S25, S26, S27 and S28 each corrected it. Check the code.

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

1. Apply migrations to **dev**, verify **by query**, run `tap-all`.
2. Feature commit(s).
3. Apply to **staging**, then **prod** — dry-run each, verify each **by
   query**. ⚠️ **Staging goes BEFORE the push**: `feat/multi-user-v1`
   auto-deploys the STAGING-backed beta.
4. Push → **CI green on all four jobs** (a skip is not green).
5. Re-link the CLI to `wilson-dev`.
6. Write the next brief → update `docs/MASTER_PLAN.md` and
   `MASTER_PLAN_S19_ONWARD.md` → update `docs/SYSTEMS_HANDBOOK.md` if
   behaviour changed → **update `docs/OUTSTANDING.md`** → update the Claude
   auto-memory → docs commit + push.

> **THEN, FINALLY, IN THE CHAT — both required, after everything is pushed:**
>
> 1. **List the remaining sessions**, one line each, a few words only, marking
>    any that are done. If the order changed, say so.
> 2. **A layman's breakdown of what this session accomplished**, in bullet
>    points, plain English. **No jargon, no table names, no migration numbers,
>    no file paths.** Write what CHANGED FOR AUDREY, not what was done to the
>    code. Say plainly what is fixed, what is only diagnosed, and what she
>    needs to do herself.
