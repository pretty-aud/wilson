# SESSION 17 launch prompt — consolidate, trim, prepare for release

> Paste into a new Claude Code conversation from the WILSON repo.
> **Read `docs/SYSTEMS_HANDBOOK.md` FIRST — all of it — then
> `docs/MASTER_PLAN.md` §2–§6 and §10.**
> **First tool call** per standing rule: `git status` on `feat/multi-user-v1`.

> **Last session of the three-session tail** (locked #19 as amended
> 2026-07-30): S15 operator console + TPN ✅ · S16 documentation & design pack
> ✅ · **S17 = this.**
>
> **Scope changed 2026-07-30 (Audrey), after reading S16's output.** S17 is no
> longer "fix and tag". It is: absorb what the handbook taught, **trim the fat
> and kill redundancies across the whole system**, fix what is genuinely
> broken, write the test plan — and then **stop**. Audrey reviews everything
> before the tag. See Block G.

---

## 🚨 THE RULE THAT OVERRIDES EVERYTHING IN THIS SESSION

**Do not change what the app does or how it looks.**

No behaviour changes. No layout changes. No styling, spacing, colour,
typography or component-structure changes. No renamed props, no moved files
that something imports, no "while I'm here" improvements, no reorganising a
component because it would be tidier.

Audrey's words: *"remember to not affect any functions or tools or visual
layout/design. at times refactors break layouts and systems lets make sure to
only fix when necessary."*

That is a hard constraint, not a preference. WILSON has a large amount of
hand-tuned layout — the D.O.G. layout visualiser, O.T.T.E.R.'s two-sidebar
shell, RABBIT's Timeline and 13-tab Budget — and a refactor that "should be
safe" is exactly how those break silently. A screenshot-identical app with a
smaller codebase is the goal. If you cannot delete something without touching
a live code path, **do not delete it** — file it instead.

**The test for every change in Block C:** *if this is wrong, does the user see
it?* If yes, it is not a cleanup — it is a change, and it needs a reason from
Block B.

---

## Block A — Read, then correct the plan

1. Read `docs/SYSTEMS_HANDBOOK.md` end to end. **§17 is the consolidated
   known-limits list and is most of your input** — do not re-derive it.
2. Read `docs/MASTER_PLAN.md` §3 (locked decisions), §6 (gaps, especially the
   new #44–#58) and §10 (decisions log).
3. **Update the plan from what the handbook taught.** S16 was written from the
   code, so where the plan and the handbook disagree, the plan is stale.
   Specifically:
   - Any §2 architecture claim the handbook contradicts.
   - Any locked decision in §3 that the code no longer matches, or that is now
     moot. Do not relitigate a decision — record that reality diverged, and
     say which is right.
   - §7's brief→status traceability table, which has not been touched in
     several sessions.
   - §9's infra registry.

   This is a real block, not a formality. The handbook is now the accurate
   document; the plan should stop contradicting it.

---

## Block B — Fix what is genuinely broken

These four are **release-gating**. Everything else in §6 is triage.

1. **#42 — privilege changes are unaudited** (TPN-LOG-005, an open CRITICAL).
   Role promotions, rate-card grants and deactivations go from the browser
   straight into `workspace_members` and nothing captures them. One migration:
   a DEFINER capture trigger on the 0027 `fn_file_events_capture` shape. The
   copy-paste prompt is `TPN_AUDIT/REMEDIATION_PLAN.md` Phase 0b. **This is
   the audit trail for the product's own security boundary.**
2. **#44 — `custom_access_token_hook` is executable by `authenticated` and
   `anon`.** 0001/0003 revoke it; `0011_role_grants.sql:23`'s blanket
   `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public` re-grants it, and 0011's
   re-lock pass (`:33-43`) covers only two other functions. The hook reads its
   target user id from the caller-supplied `event` argument, not `auth.uid()`,
   so any signed-in caller can compute another user's claim set. One REVOKE in
   a new migration + a pgTAP probe.
   **Then do the wider sweep, which is the actual finding:** 0011 also sets
   `ALTER DEFAULT PRIVILEGES … GRANT EXECUTE ON FUNCTIONS`, so **every**
   function created by a later migration inherits the blanket grant. Enumerate
   every SECURITY DEFINER function in `public` and check which ones a client
   role can execute that shouldn't. Expect more than one.
3. **#45 — `managed-files` arbitrary-path delete.** `PATCH` merges `req.body`
   with no field stripping (`electron/main.cjs:1665-1670`), so `folder_path`
   and `stored_name` are client-writable; the `?hard=true` DELETE branch
   (`:1684-1690`) `path.join`s them onto the project root and `unlinkSync`s
   with **no `resolveContainedFilePath` call**. Fix symmetrically with the
   `files` routes S14 already hardened. The thumbnail GET (`:1724`) builds its
   path the same way.
4. **#46 — `invite-member` has no MFA step-up** and can create an
   `app_role: 'admin'` member, while `admin-create-user` — the other path to
   the same outcome — is blocked at aal1 by `requireWorkspaceAdmin`. Route it
   through `adminGuard`.

**Also fix (cheap, user-visible, low risk):**

- **#47 — RABBIT milestones dropped on project load.** `loadProject` in both
  `localServerAdapter` and `googleDriveAdapter` omits the `milestones` key
  while the routes and list methods exist. Adding one line to each return
  object is not a refactor. Real data loss today.
- **#51 — `HelpPage.jsx` documents the deleted password panel** (12-char cap,
  case-insensitive, "protects the application on launch"). Text-only edit.
- **#50 — O.T.T.E.R.'s global Space shortcut fires from every page.** One
  `currentPage` gate; the correct pattern is in the same file.
- **#48 / #49** — `addManagedFile` throws in cloud/Drive mode (needs an
  adapter-mode guard, not a rewrite); `googleDriveAdapter.listRateCards` is a
  throw stub the rate-card hook calls unconditionally on mount.

**Do NOT attempt #31** (D.O.G. cloud attachments). Migration + five wiring
changes + seven catalogued traps. Re-own it to post-1.0.

---

## Block C — Trim the fat, kill redundancies

Audrey's ask: *"look at the whole systems of the wilson app and see where there
is fat to trim, where to kill redundancies."*

**Work in three tiers, strictly in this order. Do not start a tier until the
previous one is committed and green.**

### Tier 1 — Provably dead code (delete)

Something qualifies only if a repo-wide search proves **zero** importers or
callers. S16 already found these; verify each yourself before deleting:

| Candidate | Evidence from S16 |
|---|---|
| `src/storage.js` | IndexedDB `wilson-db` project store; zero import sites anywhere |
| `src/components/PageShell.jsx` | Unreferenced — `App.jsx` reimplements the bar inline |
| `src/components/ToolShell.jsx` | Explicit pass-through stub, no chrome |
| `views/intake/IntakeUploader.jsx`, `IntakeClassifier.jsx`, `IntakeCoreDefiner.jsx` | Superseded by `IntakePrepare.jsx`; no importers |
| `src/tools/rabbit_v0.1.0/components/.SCAFFOLD.md` | Session-1 planning marker naming components never built |
| `WIL-1001` / `WIL-1002` / `WIL-1003` | Declared in `errorCodes.js` with zero call sites — **either wire them (they are sign-in failure / session expiry / MFA failure, which TPN-LOG-006 wants) or delete them.** Wiring is the better answer; decide explicitly. |

Sweep for more of the same shape — orphaned components, unused exports, dead
branches — but **only delete on proof**, never on suspicion.

### Tier 2 — Redundancies (consolidate ONLY where it cannot change behaviour)

These are duplications the handbook surfaced. Each needs a judgement call, and
**"leave it and document it" is an acceptable outcome** — often the right one:

- **Two "project root" helpers that disagree.** `resolveProjectFolder`
  (returns `null` if the path doesn't exist) vs `resolveProjectFolderRoot`
  (returns it unconditionally). Which answer a route gets depends on which
  near-identically-named helper it happened to call. Do not unify them blindly
  — audit each call site and decide whether the existence check was intended.
- **Two budget rollup paths coexist**: `selectors.js`'s task-day-rate rollup
  (still backing the Summary card) and the `useBudgetLines` spreadsheet model.
  **Very likely leave both** — the Summary card is live UI. Document the split
  in the handbook instead.
- **Dead database columns**: `last_updated_by` / `last_updated_at` on 13
  tables, never written by any trigger or client. Dropping them is a migration
  and therefore a risk; **a comment in the schema is probably the right call
  for v1.0.** Decide and record.
- **Unwired RABBIT agent surface**: `rabbitAgentTools.js` + its 8 actions +
  `createRabbitAgentTools()` — zero call sites, and `handleAgentAction` has no
  case for any of them. Either wire it (out of scope this session) or stop
  advertising it in the prompt and the Agent Skills UI. **Least-risk option:
  leave the code, correct the UI copy so it doesn't promise what it can't do.**
- **`googleDriveAdapter` list methods wired to the write-only throw stub** —
  fixing `listRateCards` is Block B; check whether the others are genuinely
  unreachable before touching them.
- **Legacy `useTeamMembers`** still used by Timeline/Scenes/Levels/
  Experiences/Budget/Intake (gaps #8/#19). **This is a migration of a live
  data source across six views — explicitly OUT of scope.** Re-own to
  post-1.0.

### Tier 3 — Documentation and config fat (§6 #58)

Zero-risk, do all of it: `db/README.md` stale migration range and missing
0028/0029 sections; `env.cjs`'s non-existent `wilsonEnv` bridge comment; the
intake 5-step-vs-3-step drift; `backups.yml`'s 30-vs-90-day comment;
`main.cjs`'s stale `WILSON/0.5.5` and `WILSON/0.6` User-Agent strings.

### After every tier

`npm test` and `npm run build` must pass, and **the app must still render
identically**. If you cannot verify a surface visually, say so in the close-out
rather than assuming.

---

## Block D — Final §6 disposition

Every still-open gap gets exactly one of **CLOSED** (with the commit),
**RE-OWNED to post-1.0** (with a reason), or **ACCEPTED for v1.0.0** (with a
reason and its TPN id where relevant). No gap may remain undecided. Gaps
already carrying an S15/S16 disposition need confirming, not relitigating.

---

## Block E — Write `docs/RELEASE_TESTING.md`

Audrey's ask, verbatim: *"a document that is concise explaining what systems
need to be tested. and on this here document, lets also have details of how to
setup the first company for testing."*

**Concise. This is the opposite of the handbook.** She is going to work through
it by hand, on a real machine, and find what is broken. Optimise for someone
holding a keyboard, not someone learning the architecture.

Two parts:

**Part 1 — First company setup, as a numbered runbook.** Everything needed to
go from nothing to a usable company, in order, with the exact clicks and the
exact SQL. Cover: which environment and host to use; creating the company
(NewCompanyWizard vs the operator console — say which and why); the first
admin; enrolling TOTP; becoming a platform operator (the SQL is in
`OWED_AUDREY.md` §9B — reference it, don't fork it); inviting a second and
third user at different roles so permissions can actually be exercised; and
what has to be set server-side before AI features work at all
(`ANTHROPIC_API_KEY`, `WILSON_AI_KEY_SECRET`). Flag anything that will fail
confusingly if skipped.

**Part 2 — What to test, as a checklist grouped by system.** One line per
check, in the form "do X → expect Y". Cover every system in the handbook's §14
that a human can reach: login (username-first, MFA, workspace switch, forgot
password), invite + onboarding, each of the three tools' primary flow, the
Dashboard and Notes, Admin Terminal (all five sections), Team Members and
grants, Rate Card, the operator console (all of §9's checks), storage
providers and relink, exports and takeout, realtime with two windows open,
soft delete → undo → restore, auto-update, and the web build's deep links.

Mark each check **[BLOCKING]** (must work to ship) or **[NOTE]** (log it and
move on). Include a short "known not to work" section drawn from the final §6
disposition, so she doesn't spend time re-finding things we already know about
— that section will save her the most time of anything in the document.

---

## Block F — Release gates

1. **The handbook stays true.** If Block B or C changes anything the handbook
   describes, update the handbook **in the same commit**. It is a release gate;
   a stale gate is worse than none. §17 will need the most edits as gaps close.
2. **CI green, all four jobs.**
3. **Migrations + Edge Functions deployed** dev → staging → prod, dry-run
   before each; then re-link the CLI to `wilson-dev`.
4. **pgTAP** — every new migration gets a suite; `collected` must equal
   `planned` (`python scripts/tap-hosted.py`; no Docker on this machine).
5. **Vitest green.** Add cases for anything Block B fixed that had no coverage.

---

## Block G — Prepare the release, then STOP

`package.json` → `1.0.0`, and write `CHANGELOG.md` (there isn't one) covering
Sessions 1–17 as one migration story, not a per-session diary.

**Then stop. Do not tag, and do not merge to `main`.**

Audrey reviews the whole app against `RELEASE_TESTING.md` first — her words:
*"after session 17 i am reviewing all work you have done and see what needs
fixing or is not working at all."* The tag is hers to authorise once that pass
is done, and `main` is Vercel's production branch, so merging changes what beta
serves.

Leave the close-out with a clear statement of what is ready and what is
waiting on her.

---

## 🚨 Still owed by Audrey — check before claiming release-ready

- **`OWED_AUDREY.md` §0 — rotate the `smoke_admin` password.** Published in
  the public repo, permanent in git history, still an open CRITICAL
  (TPN-SDLC-007).
- **§9A/§9B — enrol TOTP and seed `platform_operators`**, or the operator
  console signs you in and refuses everything.
- **§11 — host the operator console at `petalstudios.co/wilsonadmin`.** This
  is a DNS/hosting decision, not a setting; see that section.

---

## Traps & discipline

- **Size the review to the work** (S16's lesson). This session touches
  security-relevant code, so Block B gets a real adversarial review. Block C
  deletions do not need one — they need proof of zero references and a green
  build.
- Token discipline: hard cap 15 agents; finders paste excerpts; never resume
  nondeterministic fan-out pipelines.
- **Permissive RLS policies OR together** — a narrow policy beside a broad
  `FOR ALL` one changes nothing; the old one must be DROPPED.
- Ordering rules: a manual re-run of 0022 must be followed by 0025 AND 0026; a
  manual re-run of 0002 must be followed by 0029.
- The wilson-app skill and MEMORY.md are SNAPSHOTS — the code is the authority.

## Close-out ritual

Feature commit(s) → CI green → deploy dev → staging → prod → re-link CLI →
update `docs/MASTER_PLAN.md` (§2, §3, §4 ledger row 17, §5, §6 final
disposition, §7, §9, §10) → update `docs/SYSTEMS_HANDBOOK.md` for anything that
changed → update the Claude auto-memory → docs commit + push → **hand Audrey
`RELEASE_TESTING.md` and the list of what is waiting on her.**
