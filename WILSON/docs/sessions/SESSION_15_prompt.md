# SESSION 15 launch prompt — operator console + final TPN hardening + v1.0.0

> Paste into a new Claude Code conversation from the WILSON repo.
> **Master plan: `docs/MASTER_PLAN.md` — read §2–§6 and §10 BEFORE any code.**
> **First tool call** per standing rule: `git status` on `feat/multi-user-v1`.

> **This is the LAST session of the multi-user migration.** It ends with the
> v1.0.0 version cut. Anything discovered that does not block v1.0.0 gets a
> §6 gap entry, not scope.

---

## Context recap

- Branch **`feat/multi-user-v1`**. S14 (file lifecycle & data stewardship)
  landed as `b109bd2` — see MASTER_PLAN §4 row 14. **Migrations are
  0000–0027, deployed to all three envs; 0028 is free.** pgTAP is suites
  01–33 (33 = file lifecycle, 26 probes). Vitest 329/329.
- **S14 state that matters here:**
  - The **`rabbit-files` bucket exists** (private, path-scoped policies keyed
    on `projects/{project_id}/…`; delete-own limited to a 1-hour
    failed-insert cleanup window). Cloud file uploads through
    `supabaseAdapter.uploadFile` now work end to end — **gap #31 is
    UNBLOCKED but not closed**: D.O.G./ProjectsPage attachments still throw
    on attachments-only patches instead of riding `uploadFile`/files rows.
  - **`file_events`** (0027) is the per-file lifecycle stream — trigger-fed,
    append-only, admin arm keeps 'purged' certificates readable after
    project purge. **No purge job by design** (TPN-LOG-004: logs ≥ 1 year).
    The S15 TPN re-audit should tick TPN-CONT-002 + TPN-LOG-004 against it.
  - **`storage-gc`** Edge Function (adminGuard, all three envs) drains
    `storage_gc_queue` + orphan-scans both buckets, workspace-scoped,
    certificates every deletion. Admin-invoked deliberately (dual
    authorization; also the gap-#24 schedule-branch trap).
  - **Storage relink** shipped local_server-only; the matcher
    (`components/relinkMatcher.js`) is pure and provider-agnostic for a
    future google_drive pass.
- **CI is readable without `gh`:**
  `curl https://api.github.com/repos/pretty-aud/wilson/actions/runs?head_sha=<sha>`.
- **Web host:** beta at `https://beta.petalstudios.co/wilson` (Vercel,
  staging-backed, auto-deploys on push — `docs/WEB_DEPLOY.md`).

---

## The scope (MASTER_PLAN §5, Session 15)

### Block A — Platform Operator Console (`/wilsonadmin`)

- Separate surface at `petalstudios.co/wilsonadmin` (locked #18): operator
  tier (`is_platform_operator` claim), **session isolation from /wilson**
  (separate storage scope; operator sign-in only).
- Create/manage companies (workspaces) — the GUC escape in the last-admin
  guard (0020) was left for exactly this tooling.
- **Per-company Claude API keys**: the `workspace_ai_keys` table + admin UI.
  The `ai-proxy` seam (S12, locked #21) already resolves
  per-workspace → platform fallback; this is the config surface for it.
- Cross-company session/usage logs (WIL-6001/6002 telemetry is already in
  app_events), build-links management.
- **Workspace teardown belongs here** — and S14 left it a named limitation:
  deleting a workspace strands its rabbit-files blobs (queue rows no admin
  can drain; certificates CASCADE away). Teardown must include a
  service-role storage sweep (see 0027's fn_files_gc_enqueue comment).

### Block B — Final TPN hardening

- Re-run **`tpn-compliance-audit`** against the `TPN_AUDIT/` baseline
  (committed at `1ce18ec`). S14 pre-paid the content-lifecycle findings —
  claim them explicitly: TPN-CONT-002 (lifecycle events + certificates +
  certified disposal via storage-gc), TPN-LOG-004 (file_events retention
  stance), and the main.cjs path-containment guards.
- Close the remaining named items: durable Edge-Function rate limiting
  (§6 #16), the hard no-deferral admin MFA gate once the CI probe admin is
  enrolled (§6 #17).
- The S14 review left two documented edges to disposition in the audit:
  GC scan-window starvation on very large buckets (persisted cursor is the
  fix if it matters), and the census existsSync sweep being synchronous on
  the Electron main process (an unreachable SMB share can block; async
  fs.promises.access with bounded concurrency is the fix).

### Block C — Remaining deferrals sweep + v1.0.0

- Walk §6 end to end; every still-open gap gets closed, re-owned to
  post-1.0, or explicitly accepted with a reason.
- Candidates that likely close cheap: #32 (legacy local password panel in
  Electron — delete it), #31 (wire D.O.G./ProjectsPage attachments through
  uploadFile now that the bucket exists — this also retires the
  updateProject attachments throw).
- Version cut: package.json → 1.0.0, changelog, tag.

## HOW to build it

- **Sequence:** operator console schema/claims first (any migration = 0028,
  pgTAP harness verify) → console surface (a sibling build target, not a
  page in /wilson) → TPN re-audit → deferrals sweep → version cut.
- The operator console is OUTWARD-FACING INFRA — smallest possible surface,
  `laws-of-ux` invoked for whatever UI it does grow (≥5 laws named per
  file header + close-out).
- **Adversarial review before the feature commit** — it has caught real
  defects in every session including S14 (20 findings, 18 fixed; among them
  three criticals: an unbounded storage delete-own policy, a body-supplied
  relink baseDir, and a takeout that could never produce an archive).

## Traps & discipline (inherited — full list in MASTER_PLAN §8)

- **No Docker** → pgTAP via `supabase db query --linked --file` with the
  `BEGIN; … ROLLBACK;` + `tap_out` harness. Keep `SELECT plan(N)`; rewrite
  EVERY pgTAP function the suite uses; compare collected rows against
  `max(test number)`. `GRANT ALL ON tap_out TO PUBLIC`. Run the CLI from
  `WILSON/`. De-auth with claims-reset + `RESET ROLE` (the `tests` schema
  is runner-only). Inside one transaction `now()` is frozen — purge probes
  need a NEGATIVE retention interval (S14 lesson).
- **Direct SQL DELETE on storage.objects is blocked** by
  `storage.protect_delete()` on hosted — storage policies get pg_policies
  pins + API-path probes, not SQL delete probes (S14 lesson).
- **PostgREST caps un-ranged reads at max_rows (1000) even for
  service_role** — every Edge-Function table read that can exceed it must
  page with `.range()` (S14's avatar-scan bug).
- **`NOT (… current_app_role() …)` needs COALESCE** — NULL for plain members.
- **A refused UPDATE returns 204 with no error** — `.select().maybeSingle()`
  and throw on 0 rows.
- **PostgREST `update({})` is a silent 200 no-op.**
- **GitHub `schedule` workflows only run from the DEFAULT branch** (§6 #24).
- Token discipline: hard cap 15 agents; finders paste excerpts; adversarial
  review pre-commit; never resume nondeterministic fan-out pipelines.
- The agent NEVER enters credentials — browser eyeballs owed by Audrey.

## Non-goals (S15)

- AWS S3 / Hetzner storage adapters (post-1.0, locked #14).
- Google Drive relink; O.T.T.E.R. subject-level diff (§6 #28); reference-doc
  merge on approval (§6 #29).
- Any new R.A.B.B.I.T./O.T.T.E.R. feature work — this session ships the
  console, the audit, and the cut.

## Close-out ritual (MASTER_PLAN §8 — do ALL of it)

Feature commit → CI green (public REST API) → deploy any migration
dev → staging → prod (dry-run each) → deploy any Edge Function to all three
envs → re-link CLI to `wilson-dev` → update `docs/MASTER_PLAN.md` (§4
ledger, §5 scope, §6 gaps, §7 statuses, §10) → update the Claude
auto-memory → docs commit + push → list Audrey's owed browser checks →
**v1.0.0 tag**.
