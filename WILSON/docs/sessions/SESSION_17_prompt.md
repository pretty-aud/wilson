# SESSION 17 launch prompt — release (v1.0.0)

> Paste into a new Claude Code conversation from the WILSON repo.
> **Master plan: `docs/MASTER_PLAN.md` — read §2–§6 and §10 BEFORE anything.**
> **First tool call** per standing rule: `git status` on `feat/multi-user-v1`.

> **This is the LAST session of the three-session tail** (locked #19 as amended
> 2026-07-30): S15 operator console + TPN ✅ · S16 systems documentation &
> design pack ✅ · **S17 = this, the release.**

---

## What S16 handed you

Two new documents, both committed and drift-reviewed:

- **`docs/SYSTEMS_HANDBOOK.md`** — the v1.0.0 release gate. Every system, what
  it does, what it talks to, written from the code. **Read §17 first** — it is
  the consolidated list of known limits, and most of your §6 work is there.
- **`docs/SYSTEMS_DESIGN_PACK.md`** — 24 mermaid diagrams, short by
  requirement. Audrey drives her own design session off this; you do not need
  to touch it unless a diagram is factually wrong.

The handbook's whole-system read **was** the final audit. It filed gaps
**#44–#58** in MASTER_PLAN §6. Those are your input.

---

## Block A — Fix what S16 surfaced

S16 was frozen-code, so nothing it found was fixed. Triage §6 #44–#58 into
fix-now / defer / accept. **These four are release-gating and should be fixed:**

1. **#42 — privilege changes are unaudited** (TPN-LOG-005, an open CRITICAL).
   Role promotions, rate-card grants and deactivations go from the browser
   straight into `workspace_members` and nothing captures them. One migration
   closes it: a DEFINER capture trigger on the 0027 `fn_file_events_capture`
   shape. The copy-paste prompt is `TPN_AUDIT/REMEDIATION_PLAN.md` Phase 0b.
   **This is the audit trail for the product's own security boundary** — it is
   not a backlog item.
2. **#44 — `custom_access_token_hook` is executable by `authenticated` and
   `anon`.** 0001/0003 revoke it; 0011's blanket
   `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public` silently re-grants it, and
   0011's re-lock pass covers only two other functions. The hook reads its
   target user id from the caller-supplied `event` argument, not `auth.uid()`,
   so any signed-in caller can compute another user's claim set. One-line
   REVOKE in a new migration + a pgTAP probe. **Check the same blanket grant
   for other functions that were meant to be locked down** — that is the real
   lesson, and `ALTER DEFAULT PRIVILEGES` in 0011 means new functions inherit
   it too.
3. **#45 — `managed-files` arbitrary-path delete.** The PATCH route merges
   `req.body` with no field stripping, so `folder_path`/`stored_name` are
   client-writable; the hard-delete branch then `path.join`s them onto the
   project root and `unlinkSync`s with **no `resolveContainedFilePath` call** —
   unlike the sibling `files` routes, which were hardened for exactly this in
   S14. Fix is symmetric with the `files` routes: strip the fields on PATCH,
   contain the path on delete. (The *audit* half — managed files emit no
   `file_events` — is TPN-CONT-006 and can stay deferred.)
4. **#46 — `invite-member` has no MFA step-up** and can create an
   `app_role: 'admin'` member. Its sibling `admin-create-user` goes through
   `requireWorkspaceAdmin` and is blocked at aal1 for any enrolled admin, so
   locked #9 ("MFA for all admin tiers") is not actually upheld on this path.
   Fix is to route it through `adminGuard` like every other admin function.

**Also worth fixing, cheap and user-visible:**

- **#47 — R.A.B.B.I.T. milestones are dropped on project load.** Both
  `localServerAdapter.loadProject` and `googleDriveAdapter.loadProject` omit
  the `milestones` key while the routes and list methods exist, so a milestone
  reverts to nothing on the next reload or project switch. Real data loss on a
  feature Timeline and Tasks both render.
- **#51 — `HelpPage.jsx` documents the password panel S15 deleted**, including
  rules that never applied to a Supabase password ("up to 12 characters",
  "case-insensitive", "protects the application on launch"). Users following
  in-app help look for a control that does not exist.
- **#48 / #49** — `addManagedFile` throws in cloud/Drive mode (no adapter-mode
  guard, error swallowed); `googleDriveAdapter.listRateCards` is wired to the
  read-only throw stub but the rate-card hook calls it unconditionally on
  mount, giving a permanent error banner in Drive mode.

**Judgement call, yours to make:** #50 (O.T.T.E.R.'s ungated global Space
keydown fires from every page) is a one-line `currentPage` gate and the correct
pattern is three hundred lines above it in the same file. Cheap. Do it if
Block A is otherwise going well.

**Do NOT attempt #31** (D.O.G. cloud attachments). S15's recon and S16's read
both concluded it is a migration plus five wiring changes with seven catalogued
traps — that is a session, not a release-day fix. Re-own it to post-1.0.

---

## Block B — Final §6 disposition

Every still-open gap gets exactly one of: **CLOSED** (with the commit), **RE-OWNED
to post-1.0** (with a reason), or **ACCEPTED for v1.0.0** (with a reason and,
where relevant, its TPN finding id). No gap may remain in an undecided state
after this session — that disposition table is the release artifact.

Gaps already carrying an S15/S16 disposition (#35 accepted as TPN-CONT-010, #36
accepted, #30 accepted, #39/#43 deliberate) just need confirming, not
re-litigating.

---

## Block C — The release gates

1. **Handbook exists and is drift-reviewed** ✅ (S16). If Block A changes
   behaviour the handbook describes, **update the handbook in the same commit**
   — it is a release gate, and a stale gate is worse than none. §17 is the
   section most likely to need edits.
2. **CI green, all four jobs.**
3. **Migrations and Edge Functions deployed to all three envs** (dev → staging
   → prod, dry-run before each), then re-link the CLI to `wilson-dev`.
4. **pgTAP** — every new migration gets a suite; `collected` must equal
   `planned` (`python scripts/tap-hosted.py`, no Docker on this machine).
5. **Vitest green.**

---

## Block D — Cut v1.0.0

- `package.json` → `1.0.0` (currently `0.6.3`). Tool versions stay as they are.
- Write `CHANGELOG.md` — there isn't one yet. It covers Sessions 1–17: the
  multi-user migration end to end, not a per-session diary.
- Tag `v1.0.0` on `feat/multi-user-v1`.
- **Ask Audrey before merging to `main`** — the branch is Vercel's production
  branch, so a merge changes what beta serves.

---

## 🚨 Audrey's owed items — check before tagging

These are hers, not yours, but the release should not ship silently past them:

- **`OWED_AUDREY.md` §0 — rotate the `smoke_admin` password.** It was published
  in the PUBLIC repo and is in git history permanently. Still an open CRITICAL
  (TPN-SDLC-007).
- **§9 — enrol TOTP and seed `platform_operators`**, or nobody can sign in to
  the operator console at all.
- Beta workspace + tester invites (§6/§7).

---

## Traps & discipline

- Token discipline: hard cap 15 agents; finders paste excerpts; never resume
  nondeterministic fan-out pipelines. **S16's lesson: size the review to the
  work.** A documentation pass does not need a build-session review, and a
  four-finder drift review on a docs commit was more than the job required.
- **Permissive RLS policies OR together** — adding a narrow policy beside a
  broad `FOR ALL` one changes nothing; the old one must be DROPPED.
- Ordering rules: a manual re-run of 0022 must be followed by 0025 AND 0026; a
  manual re-run of 0002 must be followed by 0029.
- The wilson-app skill and MEMORY.md are SNAPSHOTS — the code is the authority.

## Close-out ritual

Feature commit → CI green → deploy dev → staging → prod → re-link CLI →
update `docs/MASTER_PLAN.md` (§4 ledger row 17, §5, §6 final disposition, §7,
§10) → update the handbook if behaviour changed → update the Claude auto-memory
→ tag → docs commit + push → list anything still owed.
