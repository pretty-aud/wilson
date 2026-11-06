# SESSION 21 launch prompt — data correctness and the reliability sweep

> Paste into a new Claude Code conversation. **Start from `WILSON/`, not
> `Claude_Work/`.**
> **First tool calls**, in order and before any code:
> 1. `git status` on `feat/multi-user-v1`
> 2. read **`docs/OUTSTANDING.md`** — everything currently broken
> 3. read `docs/sessions/MASTER_PLAN_S19_ONWARD.md` (S21 section + standing rules)

---

## 🚨 THE RULE THAT OVERRIDES EVERYTHING

**Do not write code, ship a fix, or state a conclusion from an unproven
theory. Measure first.** (`feedback_prove_before_acting.md`.)

S20 is the third session running where this paid for itself before any code was
written. Its own launch prompt was wrong in five places — the migration number,
the number of tables, the number of pgTAP suites, the validation polarity, and a
named precedent that contradicted the sentence it was in. All five were caught
by reading the files rather than trusting the plan, and none of them cost more
than the reading.

Two instruments also lied during S20, and both were caught only because the
*shape* of the answer was wrong rather than the value:

- a JSON extractor read one level too high and reported "no findings" for a
  report that was full of them;
- an error probe returned a duplicate-key violation where a foreign-key one was
  expected, because an earlier probe in the same transaction had already
  inserted that row.

**Check that your instrument can see what you think it sees.** Label everything
**MEASURED / INFERRED / GUESSED**. Audrey reads these as claims and acts on them.

---

## Where S20 left things

**The model control plane is built** (`6e422d2`). Audrey approves a model in the
operator console and it appears in every company's picker; an admin's override
beats the platform default, a user's beats the admin's.

| Verified | |
|---|---|
| pgTAP | **42/42 suites**, `collected == planned` in every one |
| vitest | **472** (was 454) |
| builds | both entries (`npm run build`, `npm run build:admin`) clean |
| D4 | an unapproved model is refused by a **foreign key**, not just by the dropdown |
| D5 | **even a platform operator** cannot write the catalogue directly |

### 🚨 Do these first

1. **Apply migration 0031 to PROD.** dev and staging are done and verified
   (2026-08-02). Dry-run first; `db push` has no `--project-ref`, so prod needs
   `supabase link --project-ref rqyriuyldhovirbuievt` and a re-link back to dev
   afterwards. Verify with a query, not the CLI's success line.
2. **Deploy `operator-models` to prod.** It is on dev and staging.
3. **Rotate `smoke_admin`** — the one open CRITICAL, still blocking the tag.
   `OWED_AUDREY.md` §0. Audrey only.
4. **Rotate `wilson-staging`'s legacy `service_role` key** (S19 exposure).
   Audrey only.

---

## S21 — Data correctness and the reliability sweep

**Goal: the settings and rate-card surfaces stop lying.**

### A. `rate_cards.type` does not exist — MEASURED (S18)

Staging's columns are `id, workspace_id, name, source_file_id, is_default,
created_at, last_updated_by, last_updated_at, deleted_at, deleted_by,
created_by, updated_by, updated_at`. `useRateCard.js` reads and writes
`c.type === 'general' | 'internal'`, so the whole internal-vs-general feature
keys on a column that was never added. **One root cause behind two of Audrey's
reports** (the "type column" error, and being unable to reach the internal
card). `rate_card_entries` is fine.

→ Migration **0032**: add `type`, backfill existing rows to `'general'`, pgTAP.
Note the numbering — S20 took 0031, keeping the chain contiguous.

### B. The unbounded `getSession()` class — INFERRED

18 call sites; only 4 files use `withTimeout`, all of them the auth screens S17
fixed. `ProfileSection.jsx:66` awaits `getSession()` inside a `Promise.all` with
no ceiling — if it never resolves, `setLoading(false)` never runs. That matches
"loading profile and then never loads anything".

> **Settle it before fixing it.** Open the stuck Profile panel, devtools →
> Network. If a `workspace_members` request returns 200 while the UI still says
> loading, the fault is after the await and this is confirmed. `aiProxy.js:65`
> is on the same list and sits on the path of every AI call.

### C. Avatar not persisting — likely the same effect as B; re-check after.

### D. Restore password change in `SYSTEM SETTINGS`. S15 deleted the panel
because it drove a dead local-credential route (§6 #32); the copy now tells
users to go to the sign-in screen. Wire it to Supabase properly.

---

## Traps

- 🚨 **NEVER run `supabase config push`, and never build a shell command by
  interpolating content into it.** One rule, because they were one incident
  (2026-08-02): bash evaluated backticks inside a double-quoted `node -e "…"`
  and ran `config push` against wilson-dev — twice, `[Y/n]` defaulting to yes on
  absent stdin. The same session printed a `service_role` key into a transcript
  via a `grep -v` that assumed line-per-key JSON. **Write scripts to a file and
  run the file.** Select fields rather than filtering output whose shape you have
  not seen.
- **`git add -A` sweeps untracked files into a PUBLIC commit.** Stage explicit
  paths. `docs/messed up handbook.pdf` is still untracked and must stay that way.
- **The `ai-proxy` body whitelist drops unknown fields silently.** A new request
  parameter does nothing until the Edge Function is taught it too, with no error.
- **Permissive RLS policies OR together.** A narrow policy beside a broad
  `FOR ALL` one changes nothing — the old one must be DROPPED.
- **0011's `ALTER DEFAULT PRIVILEGES` grants `anon` and `authenticated` ALL on
  every table a later migration creates**, and EXECUTE on every function. Each
  new object needs its own REVOKE **in the migration itself**. A pgTAP suite that
  asserts only the policy passes while the privilege hole is wide open — assert
  `ok(NOT has_table_privilege(...))` too.
- **CI's coverage guard globs `supabase/tests/rls/*_<table>.sql`.** One new table
  = one new suite file whose name ENDS with `_<table>.sql`, added to `RLS_TABLES`
  **and** to the hardcoded failure-replay list at `rls.yml:112`.
- **Run the whole pgTAP set before pushing a migration**, not just the new suite:
  `bash` a loop over `supabase/tests/rls/*.sql` through
  `python scripts/tap-hosted.py out.sql <migration.sql> <suite.sql>` then
  `supabase db query --linked --file out.sql`. **`collected` MUST equal
  `planned`.** Do not concatenate all suites into one transaction — a suite that
  ends as `authenticated` breaks the next one's fixture call, and the failures
  are artefacts of the batching.
- **`docs/SYSTEMS_HANDBOOK.md` is a gate, not an oracle.** S20 found the memory
  claiming the CLI was linked to staging (it was dev), `aiModels.js` inert (seven
  files import it), and vitest at 441 (it was 454). Check the code.
- Vitest is at **472**, pgTAP **42** suites. If either moves, say why.

---

## Close-out ritual

Feature commit(s) → CI green (**all four jobs**, not just the badge) → deploy
migrations dev → staging → prod (dry-run each) → re-link CLI to `wilson-dev` →
write `docs/sessions/SESSION_22_prompt.md` → update `docs/MASTER_PLAN.md`
(§4 ledger, §6 gaps) and `MASTER_PLAN_S19_ONWARD.md` → update
`docs/SYSTEMS_HANDBOOK.md` if behaviour changed → **update
`docs/OUTSTANDING.md`** → update the Claude auto-memory → docs commit + push.

> **On `docs/OUTSTANDING.md`:** add only what is **broken and not yet fixed**,
> including anything this session breaks; delete what it fixes, citing the
> commit; tag MEASURED / REPORTED / INFERRED. **Adding nothing is a correct
> outcome.** Do not pad it to look thorough — padding buries the real entries.

## Still owed by Audrey

- 🚨 Rotate `smoke_admin` (blocks the tag) and the staging `service_role` key.
- Apply 0031 and deploy `operator-models` beyond dev (above).
- Confirm dev's `ai-proxy` really forwards the tuning fields:
  `node scripts/probes/ai-models.mjs --dev`. S20 deployed it but could not
  verify — the probe needs credentials.
- Complete `docs/RELEASE_TESTING.md`.
- **v1.0.0 is prepared, NOT tagged, NOT merged to `main`.** `smoke_admin` and
  the testing pass are what remain. **Ask before tagging, and ask again before
  merging to `main`** (Vercel's production branch).
