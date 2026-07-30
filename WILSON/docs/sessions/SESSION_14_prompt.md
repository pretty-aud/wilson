# SESSION 14 launch prompt — file lifecycle & data stewardship

> Paste into a new Claude Code conversation from the WILSON repo.
> **Master plan: `docs/MASTER_PLAN.md` — read §2–§6 and §10 BEFORE any code.**
> **First tool call** per standing rule: `git status` on `feat/multi-user-v1`.

> One session remains after this one: **S15 operator console + TPN + v1.0.0.**

> **Why this session exists.** Everything about what happens to files and data
> over time. Roughly 60% of it is TPN work in friendlier clothing — the
> `TPN_AUDIT/FINDINGS.md` entries on audit trails, retention and
> proof-of-deletion (TPN-LOG-004, and the "delete is an unlink with no
> certificate, no checksum, no audit trail" finding) land here rather than in
> S15. The other 40% is the reason Audrey asked for it: **storage relink**, the
> ShotGrid/Blender "find missing files" feature — real studios move folders,
> and today a moved folder means every `files` row under it dangles forever.

---

## Context recap

- Branch **`feat/multi-user-v1`**. S13 (change-request approval that applies)
  landed as `89b84bc`, plus the same-session follow-up `54d5225` (the
  in-Otter Requests view + the manager read arm) — see MASTER_PLAN §4 rows
  13/13b. **Migrations are 0000–0026, deployed to all three envs; 0027 is
  free.** No migration backlog.
- **S13 state that matters here:**
  - Approving an O.T.T.E.R. change request now APPLIES it via
    `otter_cr_apply()` (archive → additive subject copy → settle). The
    review-window read arm rides `otter_has_open_review_access()` inside
    `otter_courses_select`. If S14 touches `otter_courses` policies, keep that
    arm intact, and NEVER inline `current_app_role()` into a SELECT policy on
    `otter_courses`/`otter_progress` — 0022's re-run post-condition raises on
    it.
  - pgTAP is now suites 01–32 (**184 O.T.T.E.R. probes** across 26–32). The
    `BEGIN; … ROLLBACK;` harness with the `tap_out` collector remains the
    local verification method (no Docker on this machine — MASTER_PLAN §8).
  - Change requests now surface INSIDE O.T.T.E.R. (`RequestsView.jsx`, a
    cloud-only nav tab) with the three-tier mapping admin = decide,
    manager = view (0026), user = own requests. The Admin Terminal section
    remains.
- **CI is readable without `gh`.** `pretty-aud/wilson` is public:
  `curl https://api.github.com/repos/pretty-aud/wilson/actions/runs?head_sha=<sha>`.
- **Web host:** beta at `https://beta.petalstudios.co/wilson` (Vercel,
  staging-backed, auto-deploys on push to `feat/multi-user-v1` —
  `docs/WEB_DEPLOY.md`). Anything S14 adds to RABBIT's file surfaces must
  degrade honestly on the web where the local server does not exist (the S12
  rule; see `src/lib/localData.js` and the `/api/fetch-url` precedent).
- **Carry-forward gaps this session owns:** #6 (blob GC), #31 (cloud project
  file attachments have no home — the `rabbit-files` decision unlocks it).
  Check §6 for anything new S13 added.

---

## The scope (MASTER_PLAN §5, Session 14)

### Block A — Storage relink (the headline feature)

The ShotGrid/Blender "find missing files" model, decided by Audrey
(2026-07-29): **find + preview + apply**, not merely detect.

- Point WILSON at a moved folder; it walks the tree, matches dangling `files`
  rows by **filename** (size + mime as tiebreak), shows a **preview table** of
  proposed remaps, and applies them on confirm.
- **`local_server` first** — the case where folders actually move — with the
  matcher written provider-agnostically so `google_drive` can follow.
- Backstory: `files` already carries `storage_provider` + a *relative*
  `storage_path`, so a DB restore plus reconnected storage already resolves.
  Relink is for when identifiers **drift** (a folder moves; a Drive file
  deleted and re-uploaded gets a new id).
- The apply step is a bulk UPDATE of `storage_path` on matched rows — decide
  and document whether it rides the existing edit-history capture (0012 covers
  `files`) and emit storage-lifecycle events (Block C) for it.

### Block B — CSV / spreadsheet export, both tiers

- **Per-page export buttons now** (this project's tasks, this rate card, this
  roster) *and* a **full workspace takeout** as a zip of one CSV per table.
- `xlsx` is already a dependency (rate-card importers) — this is mostly wiring.
- **O.T.T.E.R. is EXCLUDED from the company takeout** (locked #20 + §10,
  2026-07-29): personal courses are private even from admins, so a company
  takeout that swept them in would be an admin backdoor into exactly the
  content 0022 made unreadable. The existing per-user `/api/export-all` stays.
- Rate-card and budget data are role-gated in the UI — the takeout must not
  become a bypass: export only what the REQUESTING USER can already read
  (build it on RLS-scoped reads, never on a DEFINER sweep).

### Block C — File audit (Notion-style)

- Mostly UI over data already captured: `files` is in 0012's edit-history
  entity CHECK, and `app_events` (0021) carries the system stream.
- Add **storage-lifecycle events** (uploaded, moved, relinked, trashed,
  purged) and a per-file "who touched this, when" view.
- This is TPN-LOG-004's remediation in product clothing — say so in the
  close-out so the S15 TPN re-audit can tick it.

### Block D — The `rabbit-files` bucket decision

- Referenced at `supabaseAdapter.js:371` but never created by any migration,
  so the Supabase-Storage option for project files is half-wired. **Decide
  explicitly**: create it with path-scoped policies (0009 `user-avatars`
  pattern), or drop Supabase Storage as a project-files option. Creating it is
  what unlocks gap #31 (cloud project file attachments) — weigh that.

### Block E — Blob GC (§6 #6)

- File rows soft-delete but blobs persist forever; removed-avatar orphans join
  them when the best-effort delete fails. Sweep deliberately, provider-aware,
  and emit the Block C lifecycle events as proof-of-deletion (the TPN
  "certificate" finding).

---

## HOW to build it

- **Sequence that de-risks it:** Block D's decision first (it shapes A/C/E's
  provider matrix) → any migration (0026: lifecycle events table or app_events
  extension, bucket + policies if created) verified via the pgTAP harness →
  relink matcher as a pure module with unit tests (it is exactly the kind of
  logic Vitest is for) → UI last.
- **The relink preview is the safety surface.** Applying remaps rewrites
  `storage_path` in bulk; a wrong match corrupts pointers at scale. The
  preview table must show old path → new path per row, and the confirm must
  state the count (the S13 approve-dialog pattern: say exactly what will
  happen, with numbers, before writing).
- Invoke the **`laws-of-ux` skill** before designing the relink preview, the
  export surfaces and the audit view; name ≥5 laws applied in each file
  header and again at close-out.
- UI restraint: per-page export = one button beside existing toolbars; the
  audit view attaches to the existing file row/detail surfaces. No new nav
  items without Audrey's say-so.

## Traps & discipline (inherited — full list in MASTER_PLAN §8)

- **No Docker** → pgTAP via `supabase db query --linked --file` with the
  `BEGIN; … ROLLBACK;` + `tap_out` harness. Keep `SELECT plan(N)`; rewrite
  EVERY pgTAP function the suite uses; compare collected rows against
  `max(test number)`. `GRANT ALL ON tap_out TO PUBLIC`. Run the CLI from
  `WILSON/`.
- **`NOT (… current_app_role() …)` needs COALESCE** — NULL for plain members.
- **`.upsert()` cannot target a partial unique index** (42P10).
- **A refused UPDATE returns 204 with no error** — `.select().maybeSingle()`
  and throw on 0 rows.
- **BEFORE triggers still fire under SECURITY DEFINER.**
- **PostgREST `update({})` is a silent 200 no-op** — never strip a patch down
  to nothing (S12 lesson, §10).
- **GitHub `schedule` workflows only run from the DEFAULT branch** (§6 #24) —
  relevant if blob GC becomes a GitHub Actions cron; pg_cron inside Postgres
  is unaffected.
- Token discipline: hard cap 15 agents; finders paste excerpts; **adversarial
  review before the feature commit** — it has caught real defects in every
  session, including S13's.
- The agent NEVER enters credentials — browser eyeballs owed by Audrey.

## Non-goals (S14)

- Operator console, per-company API-key admin UI, TPN re-audit, v1.0.0
  (**S15**).
- AWS S3 / Hetzner storage adapters (post-1.0, locked #14).
- O.T.T.E.R. subject-level diff view (§6 #28) and reference-document merge on
  approval (§6 #29) — still deliberate exclusions.
- Google Drive relink (matcher stays provider-agnostic, but only
  `local_server` ships).

## Close-out ritual (MASTER_PLAN §8 — do ALL of it)

Feature commit → CI green (public REST API) → deploy any migration to
staging + prod (dry-run each) → re-link CLI to `wilson-dev` → write
`docs/sessions/SESSION_15_prompt.md` (**operator console + TPN + v1.0.0**,
scope in MASTER_PLAN §5) → update `docs/MASTER_PLAN.md` (§4 ledger, §5 scope,
§6 gaps, §7 statuses, §10) → update the Claude auto-memory → docs commit +
push → list Audrey's owed browser checks.
