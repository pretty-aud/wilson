# SESSION 22 launch prompt — storage, connections, and the privilege sweep

> Paste into a new Claude Code conversation. **Start from `WILSON/`, not
> `Claude_Work/`.**
> **First tool calls**, in order and before any code:
> 1. `git status` on `feat/multi-user-v1`
> 2. read **`docs/OUTSTANDING.md`** — everything currently broken
> 3. read `docs/sessions/MASTER_PLAN_S19_ONWARD.md` (S22 section + standing rules)
> 4. `cat supabase/.temp/linked-project.json` — **read it, do not recall it.**
>    S21 left it on `wilson-dev` (`eqjzmnvkrakroyqxfsvw`).

---

## 🚨 THE RULE THAT OVERRIDES EVERYTHING

**Do not write code, ship a fix, or state a conclusion from an unproven
theory. Measure first.** (`feedback_prove_before_acting.md`.)

S21 is the fourth session running where this paid before any code was written,
and it paid in a new way: **reasoning correctly about a migration was not a
substitute for querying the database.**

Two independent investigators each concluded that 0032 needed no REVOKE block.
Their reasoning was sound — `ALTER TABLE ADD COLUMN` creates no new object, so
it does not trip migration 0011's `ALTER DEFAULT PRIVILEGES` trap. Both were
wrong, because neither checked what `anon` *already* held. One test assertion,
written only because the house convention says to write it, failed and exposed
26 tables.

S21 also killed four avatar hypotheses and three migration-design choices by
measurement before writing anything. **Every hypothesis that felt obvious was
false.** Budget for that.

**Label everything MEASURED / INFERRED / GUESSED.** Audrey reads these as claims
and acts on them.

---

## Where S21 left things

**All four S21 items landed** (`10fcd29`), and prod finally caught up.

| Verified | |
|---|---|
| pgTAP | **42/42 suites, 629 assertions**, `collected == planned` in every one |
| vitest | **482** (was 475) |
| builds | both entries clean |
| CI | **all four jobs green** — success, not skipped |
| migrations | **0031 AND 0032 applied and verified on dev, staging and prod** |
| Edge Functions | `operator-models` now on all three projects |

Verified by query, not by the CLI's success line: on every environment
`rate_cards.type` is NOT NULL with default `'general'`, `rc_type_chk` exists,
zero NULL types, `anon` grants 0, and `authenticated` kept SELECT/INSERT but
lost TRUNCATE.

### 🚨 Still owed by Audrey — unchanged, and still blocking the tag

1. **Rotate `smoke_admin`** — published in the PUBLIC repo, permanent in git
   history. `OWED_AUDREY.md` §0, TPN-SDLC-007. The one open CRITICAL.
2. **Rotate `wilson-staging`'s legacy `service_role` key** (S19 exposure).
3. **Complete `docs/RELEASE_TESTING.md`.**
4. **v1.0.0 is prepared, NOT tagged, NOT merged to `main`.** Ask before
   tagging, and ask **again** before merging to `main` (Vercel's production
   branch).
5. ~~Confirm the tuning fields survive at runtime.~~ ✅ **DONE — CONFIRMED
   2026-08-03 against staging.** `node scripts/probes/ai-models.mjs --staging`,
   cases 7a/7b: thinking omitted → `thinking=1, out=551`; thinking disabled →
   `thinking=0, out=453`. The `thinking` field is the **only** difference
   between those two requests, so it reached Anthropic. `ai-proxy` forwards it
   end to end, on source byte-identical across all three envs.

   Two notes for whoever runs this next. **The probe's own footer asserted the
   opposite** — "ai-proxy … drops `thinking` silently, so 7a and 7b sent
   identical requests" — text written before S19 taught it to forward. Taking
   the legend at face value would have recorded the wrong conclusion from a
   correct measurement; the *numbers* refuted it. The legend is now fixed and
   branches on whether 7a and 7b actually differ. And **passwords are
   per-project**: `audrey` resolves to `admin@petalstudios.co` on dev but
   `audrey@petalstudios.co` on staging, so use `--staging`.

---

## S22 — Storage, connections, and the privilege sweep

### A. The `anon` privilege spread — 25 tables (MEASURED, S21)

`anon` holds DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE on **26 of
36** public tables. 0032 closed `rate_cards`; 25 remain. Nothing leaks today —
RLS is enabled and forced on all of them — but that leaves RLS as the only
barrier, and TRUNCATE is not subject to RLS at all.

Get the current list with this, as a **file**, never an interpolated command:

```sql
select t.table_name,
       (select string_agg(distinct g.privilege_type, ', ')
          from information_schema.role_table_grants g
         where g.table_schema='public' and g.grantee='anon'
           and g.table_name=t.table_name) as anon_privs
  from information_schema.tables t
 where t.table_schema='public' and t.table_type='BASE TABLE'
   and exists (select 1 from information_schema.role_table_grants g
                where g.table_schema='public' and g.grantee='anon'
                  and g.table_name=t.table_name)
 order by 1;
```

→ Migration **0033**. **Do NOT blanket-revoke.** Each table needs its
legitimate `authenticated` grants preserved — the 0031 shape is
`REVOKE ALL … FROM anon` plus a narrow `REVOKE` from `authenticated` of only
TRUNCATE/REFERENCES/TRIGGER, keeping the DML the policies scope. Before
revoking any table, check nothing reads it pre-auth (S21's check for
`rate_cards` was: both access points require a `workspace_id`, and the caller
early-returns without one). Extend each table's existing suite with the
`ok(NOT has_table_privilege('anon', …))` probe — do not add new suite files,
and no `rls.yml` edit is needed for tables already in `RLS_TABLES`.

### B. Storage tab: every backend button is disabled on the web (MEASURED, S18)

`RabbitProvider.jsx:312` forces `'supabase'` when `window.electronAPI` is
absent; `SettingsPage.jsx:595` then disables each button when
`active || unavailableOnWeb`. Supabase is *active* (disabled) and the other two
are *unavailableOnWeb* (disabled). All three disabled **by construction**, not
a broken handler — it reads as "storage is broken" when Supabase is working.
→ Honest copy, or an enabled state that means something.

### C. R.A.B.B.I.T. task management (REPORTED, still undiagnosed)

**Budget diagnosis time, not fix time.** Not yet reproduced.
- New-task button in Tasks does nothing.
- Board view: typing a task and pressing Enter makes it vanish.
- Assignee dropdown does not populate. Partial lead:
  `ProjectTasksView.jsx:159` filters the roster to `project_members` when
  `projectIsStaffed` and falls back to the whole roster when not — so either
  staffing rows are missing or the roster is empty. **Query both before
  touching code.**

### D. The avatar, if it recurs

S21 made every failure mode loud (a zero-row UPDATE now raises; a failed save
drops the preview). **Root cause is still unproven.** The one candidate not
excluded: whether the Storage API populates `request.jwt.claims` with
`app_metadata`. If it does not, `current_workspace_id()` is NULL inside
`user_avatars_insert_own` and every upload is refused everywhere. One devtools
Network capture of `POST /storage/v1/object/user-avatars/…` settles it. Do not
write migration 0033-for-storage-policies until that capture exists.

---

## Traps

- 🚨 **NEVER run `supabase config push`, and never build a shell command by
  interpolating content into it.** One rule, because they were one incident:
  bash evaluated backticks inside a double-quoted `node -e "…"` and ran
  `config push` against wilson-dev — twice, `[Y/n]` defaulting to yes on absent
  stdin. The same session printed a `service_role` key into a transcript via a
  `grep -v` that assumed line-per-key JSON. **Write scripts to a file and run
  the file.** Select fields rather than filtering output whose shape you have
  not seen.
- **`git add -A` sweeps untracked files into a PUBLIC commit.** Stage explicit
  paths. `docs/messed up handbook.pdf` is still untracked and must stay that way.
- **A migration's text does not tell you the database's state.** S21's whole
  lesson. Query the catalog.
- **`ADD COLUMN … NOT NULL DEFAULT x` is DDL and fires no row triggers; a
  nullable column plus an `UPDATE` backfill is DML and fires all of them.** On
  `rate_cards` that difference was `fn_audit_touch` NULLing `updated_by` on
  every existing row (auth.uid() is NULL under the CLI) plus one `edit_history`
  row per card. Prefer the default.
- **Adding a uniqueness constraint to backfilled data aborts the migration
  wherever real data exists** — and only there, which is the worst place to
  find out.
- **`withTimeout` races, it does not abort.** An abandoned `getSession()` still
  holds auth-js's global per-`storageKey` lock, and everything after it queues
  in `pendingInLock` with no acquire timeout. Bounding a call site fixes that
  site's UI, not the app. See `OUTSTANDING.md`.
- **A timeout must not be reported as "signed out".** Different causes, different
  remedies (`modelSources.js:233`, `aiProxy.js` `session_stalled`).
- **`.select()` + a null-data check, or the write is unobserved.** An
  RLS-refused UPDATE returns 200 with a null body and no error.
- **Permissive RLS policies OR together.** A narrow policy beside a broad
  `FOR ALL` one changes nothing — the old one must be DROPPED.
- **Ordering rules for manual re-runs:** 0022 → 0025 AND 0026 · 0028 → 0031 ·
  0002 → 0029 · 0011 → 0030 · **0009 → 0020** (new, S21: re-running 0009
  restores the weaker `fn_ws_members_prevent_self_role_change` body, re-opening
  self-reactivation and self-granting of rate-card access that 0020 closes).
- **Run the whole pgTAP set before pushing a migration**, one suite per
  transaction, never concatenated. `collected` MUST equal `planned` — a
  shortfall means the shim lacks a function the suite calls and the run is
  lying about coverage. The shim has NO `has_index`, `col_type_is`,
  `col_default_is`, `col_not_null`, `results_eq` or `matches`. Its `throws_ok`
  matches the **message text**, not a SQLSTATE.
- **`.github/workflows/rls.yml` is at the GIT ROOT**, not under `WILSON/`.
- **`docs/SYSTEMS_HANDBOOK.md` is a gate, not an oracle.** S21 corrected its
  table/suite counts (26/19 → 30/29) and its assertion count. Check the code.
- Vitest is at **482**, pgTAP **42** suites / **629** assertions. If any moves,
  say why.

## Close-out ritual

Feature commit(s) → CI green (**all four jobs**, not just the badge — a skip is
not green) → deploy migrations dev → staging → prod (dry-run each, verify each
**by query**) → re-link CLI to `wilson-dev` → write
`docs/sessions/SESSION_23_prompt.md` → update `docs/MASTER_PLAN.md` (§4 ledger,
§6 gaps) and `MASTER_PLAN_S19_ONWARD.md` → update `docs/SYSTEMS_HANDBOOK.md` if
behaviour changed → **update `docs/OUTSTANDING.md`** → update the Claude
auto-memory → docs commit + push.

> **On `docs/OUTSTANDING.md`:** add only what is **broken and not yet fixed**,
> including anything this session breaks; delete what it fixes, citing the
> commit; tag MEASURED / REPORTED / INFERRED. **Adding nothing is a correct
> outcome.** Do not pad it to look thorough — padding buries the real entries.
