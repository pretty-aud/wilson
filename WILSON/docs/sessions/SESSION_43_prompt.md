# SESSION 43 launch prompt — THE DESIGN PASS

> 🚨 **THIS BRIEF KEEPS MOVING, AND THAT IS THE RULE WORKING.** Written as
> S29, then S32 → S39 → S40 → **now S43**. **The design pass is LAST, always**
> — running a visual pass before the sessions of new UI would mean redoing it
> immediately. **Add another UI session and this one moves again.** The
> renumbering ledger in `MASTER_PLAN_S19_ONWARD.md` is the record; its
> sequence table is the authority.
>
> **Everything below was written when this was the NEXT session.** Large parts
> of it are stale. **Re-read `MASTER_PLAN_S19_ONWARD.md`'s sequence table and
> re-measure the app before trusting any specific claim here** — treat this as
> a list of intentions, not a description of the product.
>
> ✅ **Sessions that now sit in front of it, all with their own briefs:**
> S29 (Timeline gate), S30 (O.T.T.E.R.), S31 (per-user settings + pet +
> logout), **S33 (guard fix + `downloaded` event)**, **S34 (workspace storage
> root)**, **S35 (project folder guard + NAS/VPN guidance)** — **all six
> DONE** — then **S36 → S37 → S38**, the BYO storage provider family
> (registry, then S3-compatible, then Google Drive); **S39 → S40**,
> thumbnails and video; and **S41 → S42**, Petal cloud's quota plane and the
> multi-GB cap raise. All designed in `docs/NETWORK_STORAGE_DESIGN.md`.
>
> 🚨 **Its surface now also includes the storage PROVIDER PICKER and the
> per-provider config forms (S36–S38)** — an S3 bucket form and a Google
> Drive connect flow are both new UI this pass must cover.
>
> 🚨 **Six sessions of NEW SURFACE land before this one and are not described
> below.** At minimum the design pass must cover: the storage-mode selector and
> drive control (Admin Terminal), the project-folder control (Project Control
> Panel), the two-step local-drive confirmation, the reachability status line,
> thumbnails in every file view, the video preview surface, and the inline
> desktop-app notices. **Read those six briefs before scoping this one.**
>
> ⚠️ **The verification sweep referenced below moved to S29 and is closed.**
> Do not re-run it.
>
> ⚠️ **One item below is already ANSWERED.** This brief lists "a R.A.B.B.I.T.
> settings tab for project currency, rate card and task templates" — task
> templates shipped in S28 **with a permission gate**, and the manager surface
> is deliberately read-only for a member. Do not re-expose it ungated while
> rearranging tabs.

> **STATE — re-measure; this block decays** (last refreshed after **S42**,
> 2026-08-10): migrations **0000–0058** (next free **0059**); pgTAP **66 suites
> / 1180 assertions** (next suite **67**); vitest **1408 / 58 files**.
> 🚨 **Read the working tree, never this block and never memory.**
>
> ⚠️ **0057 and 0058 are applied to DEV ONLY at the time of writing** — staging
> and prod were still on 0056. Check `supabase migration list` per environment
> before assuming anything about the schema you are looking at.
>
> 🚨 **FOUR S42 FACTS THAT LAND ON A DESIGN SESSION'S SURFACE:**
>
> 1. **The Petal cap is 50 GiB and the free tier is 5 GiB.** Any copy, tooltip
>    or empty state quoting "50 MB" or "1 GB" is now wrong. The numbers live in
>    SQL only — `storage_free_tier_bytes()` and the bucket row — and the client
>    reads the resolved figure back from `workspace_storage_usage()`.
> 2. **There is now a real upload progress bar on the cloud path**, feeding the
>    same `copyProgress` surface the Local Server path uses. It only appears
>    above 50 MiB, because only the resumable transport reports. A design pass
>    that unifies those two surfaces should keep that asymmetry visible rather
>    than faking a bar for small uploads.
> 3. **Downloads no longer buffer into a Blob** — they hand off to the browser's
>    download manager via a signed URL. There is no in-app progress for a
>    download and no cancel; the browser owns it.
> 4. ⚠️ **`StorageSection`'s used/quota card was written for a 1 GiB tier.** Its
>    "files and their previews" caption and its bar are both worth re-reading at
>    a 5 GiB tier with 50 GiB objects — nothing warns before the ceiling, and
>    under the weighing predicate the bar is no longer a predictor of whether
>    the next upload will be accepted.
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
> **Start ritual** (S34+ standard), in order and before any code:
> 1. **Load the `wilson-app` skill** and skim its `versioning.md`.
> 2. `git status` + `git log --oneline -3` on `feat/multi-user-v1`, and
>    `ls supabase/migrations | tail` + `ls supabase/tests/rls | tail` — the
>    working tree, not this brief, says which numbers are free.
> 3. read **`docs/OUTSTANDING.md`** (faults) and **`docs/SYSTEMS_HANDBOOK.md`
>    §17** (limits by design — a gate, not an oracle)
> 4. read `docs/sessions/MASTER_PLAN_S19_ONWARD.md` — the sequence table is
>    the authority, and the S33+ outcome blocks are the recent history
> 5. `cat supabase/.temp/linked-project.json` — **read it, do not recall it.**
>    ⚠️ **The CLI actually reads `supabase/.temp/project-ref`**, a plain-text
>    file beside it. Both exist and have agreed so far. If they ever disagree
>    the CLI follows `project-ref` while the standing rule points at the JSON —
>    check both.
> 6. **Re-verify every `file:line` citation in this brief by SYMBOL** — six
>    sessions land between its writing and its running.

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
- **Ordering rules for manual re-runs:** 0022 → 0025 AND 0026 · 0028 → 0031 →
  **0055** · 0002 → 0029 · 0011 → 0030 · 0009 → 0020 · 0011 → 0033 · **0027 →
  0038 → 0039 → 0042** · 0040 → 0041 → **0043** · **0027 → 0057** · **0057 →
  0058**. 0044 depends on 0004, 0008, 0013 and 0020 and nothing depends on it.
  **Replay forwards only.**
  🚨 **0027 → 0057 is the dangerous new one.** 0027 sets the `rabbit-files`
  bucket with `INSERT ... ON CONFLICT DO UPDATE SET file_size_limit` and the
  value 52428800, so replaying it silently RESETS the cap from 50 GiB to 50 MB —
  green migration, no error, and multi-GB cloud storage quietly stops working.
- 🚨 **TWO WAYS CI FAILS WHILE EVERY LOCAL CHECK IS GREEN. S42 hit BOTH, in
  consecutive pushes, and neither was visible to any command run locally.**
  - **The local npm is a major version ahead of the runner's.** This machine has
    npm 11 (Node 24); CI uses npm 10 (Node 20). npm 11 omits an *optional*
    transitive dependency from the lockfile that npm 10 considers mandatory, so
    `npm install` here can produce a lockfile that fails `npm ci` there with
    `EUSAGE ... Missing: <pkg> from lock file`. `npm ci` locally PASSES — twice,
    including a genuine clean install — because it is the same npm that wrote
    it. **After any dependency change, verify with `npx --yes npm@10 ci`.**
  - **Vitest runs in mode `test`, and this repo has no `.env`, `.env.test` or
    `.env.test.local`.** Anything reading `import.meta.env.VITE_*` gets its
    value from a developer's gitignored `.env.local` and gets NOTHING on the
    runner. **A module-level `const X = import.meta.env.Y` cannot be stubbed
    after import** — read env at call time, and stub it in the test rather than
    inheriting it. To reproduce CI: hide `.env.development`, `.env.local` and
    `.env.staging`, then run the suite.
- **`node scripts/tap-all.mjs` runs the WHOLE pgTAP set** in one command.
  `collected` MUST equal `planned`. ⚠️ It runs against the LINKED project, so
  running it against **staging** rather than dev is what surfaced suite 35's
  unscoped counts (see `OUTSTANDING.md`) — dev is the environment least likely
  to show a decay-with-use defect, because nothing has used it.
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
