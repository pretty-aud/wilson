# SESSION 16 launch prompt — systems documentation & design pack

> Paste into a new Claude Code conversation from the WILSON repo.
> **Master plan: `docs/MASTER_PLAN.md` — read §2–§6 and §10 BEFORE anything.**
> **First tool call** per standing rule: `git status` on `feat/multi-user-v1`.

> **Three-session tail** (locked #19 as amended 2026-07-30, Audrey):
> S15 operator console + TPN (must be DONE before this session — check the
> §4 ledger) · **S16 = this** · S17 release, v1.0.0.
>
> **This is a DOCUMENTATION session — no product code.** The whole point of
> running it after S15 and before S17 is that the codebase is FROZEN: what
> gets documented is what ships. If the documentation pass surfaces a bug,
> a drifted comment, or an inconsistency, it goes into MASTER_PLAN §6 as a
> gap for S17 to fix before the tag — it does NOT get fixed here (the one
> exception: typos in comments/docs may be corrected inline). Audrey's
> sizing expectation: fairly quick relative to a build session — no
> migrations, no deploys, no review-fix loops — but the drift review and
> the diagram set are still real work; do not rush them.

---

## Why this session exists (Audrey, 2026-07-30)

Two deliverables, in order:

1. A **systems handbook** — the in-length, plain-text "how the whole thing
   works, what talks to what" document. Private in the operational sense:
   Audrey hands it to future team members manually. Dual audience by
   design: humans onboarding onto WILSON, AND other Claude accounts that
   will receive this document as seed material for Claude projects,
   skills, and CLAUDE.md files — so it must be fully self-contained,
   factual, and excerptable.
2. A **design-doc source pack** — wireframes/dataflows of how every system
   connects and how each tool and each load-bearing function works, as
   mermaid. Audrey then drives a separate Claude design session that turns
   it into the final infographic/wireframe design document.

The handbook is a **v1.0.0 release gate** (S17 checks it exists and is
drift-reviewed before tagging).

---

## Block A — `docs/SYSTEMS_HANDBOOK.md`

**List EVERY system, what it does, and what it talks to.** At minimum:

- **The Electron desktop app** — main process, the ~2000-line Express
  local server on 127.0.0.1 (what route families exist, what data lives in
  `otter-data/` / `rabbit-data/`), the React renderer, IPC surface, and
  which of the three tools uses which path.
- **The web build** — Vercel (`beta.petalstudios.co/wilson`, prod branch
  `feat/multi-user-v1`, STAGING-backed, auto-deploys on push; GH Pages =
  dormant fallback), what degrades on the web and why (no local server).
- **Supabase, per concern**: the three environments and which client
  talks to which; Auth (username-first resolver flow, ES256
  issue-session, the frozen JWT claim shape, MFA); Postgres + RLS as THE
  security boundary (app roles vs project roles, FORCE RLS, the helper
  family); Realtime (broadcast-from-database, the two channel topics,
  why not postgres_changes); every **Edge Function** by name with its
  caller, its guard, and its job (resolve-login, issue-session,
  provision-workspace, invite-member, admin-create-user,
  admin-reset-password, admin-set-active, admin-user-security, ai-proxy,
  storage-gc, + whatever S15 added); Storage (user-avatars + rabbit-files
  buckets, path layouts, policy model); pg_cron jobs (all four purges +
  retention windows).
- **The operator console** (S15) — the /wilsonadmin surface, its session
  isolation from /wilson, the operator tier, workspace lifecycle
  (create/manage/teardown + the storage sweep), per-company API keys
  (workspace_ai_keys → the ai-proxy seam). Check S15's "what S16 must
  document" note at the bottom of this file.
- **Anthropic** — every AI feature rides the `ai-proxy` Edge Function on
  both hosts (locked #21): per-workspace→platform key seam, streaming
  transport, usage telemetry codes. NO client ever holds a key.
- **GitHub** — the public repo, what CI runs on push (`rls.yml` jobs and
  what each proves), `backups.yml` on `main` (why the default branch
  matters), which secrets live in Actions.
- **Backblaze B2** — nightly pg_dump backups (which envs, retention,
  Object Lock) + auto-update installers. NEVER customer content
  (locked #20), and why a database-only backup is sufficient (relative
  storage_path model).
- **Resend** — invite/recovery/email-change mail, `mail.petalstudios.co`,
  DNS at Squarespace.
- **Sentry** — what reports from where, per-env.
- **electron-updater** — NSIS channel, B2 feed, the login-time
  update/skip flow.
- **Company storage providers** — local/local_server, Supabase Storage,
  Google Drive (read-only v0.1): storage_path semantics per provider,
  the relink model, blob GC + the certificate/ledger trail, file_events.
- **The three tools + the agent system** — D.O.G., O.T.T.E.R.,
  R.A.B.B.I.T. at a functional level: what each does, where its data
  lives in each mode, and the cross-tool surfaces (Dashboard, Admin
  Terminal, pet/agent system with per-tool actions and the DiffView
  approval gate).
- A **"who talks to whom" section**: every arrow in the system spelled
  out in prose (renderer → localhost Express; renderer → Supabase
  directly; Electron main ↔ renderer IPC; ai-proxy → Anthropic; CI →
  wilson-dev; Vercel build → staging env vars; GH Actions → B2; …).

**Rules:**

- **Written FROM the code, not from memory** — verify every route name,
  function name, bucket, cron time and claim shape against the repo
  before writing it down; it will be trusted verbatim by people and
  Claudes who cannot check.
- **NO secrets, keys, tokens, or passwords of any kind** — the repo is
  PUBLIC, so the handbook is "private" in the sense that Audrey hands it
  out manually, not that the file is hidden. (Project refs, hostnames and
  architecture are already public in this repo's docs.)
- State facts with their invariants ("the JWT claim shape is FROZEN
  because…") so a Claude reading it can act safely.
- Version-stamp it (v1.0.0, date). It supersedes nothing — MASTER_PLAN
  stays the migration's living history; the handbook is the timeless
  "how it works now".
- **Drift review before commit**: adversarial finders check the handbook
  against the code the same way code gets checked against intent — every
  named route/function/table/cron probed for existence and accuracy.
  Findings = handbook fixes now; CODE findings = §6 gaps for S17.

## Block B — `docs/SYSTEMS_DESIGN_PACK.md`

Produced AFTER and FROM the handbook (it is the source of truth). All
diagrams as **mermaid** (renders natively in artifact/markdown viewers,
unambiguous source for a design tool):

1. **The system map** — one diagram with every external system as a node
   (Electron app, web build/Vercel, Supabase ×3 envs, Edge Functions,
   Anthropic, GitHub/CI, B2, Resend, Sentry, Google Drive, company local
   storage, /wilsonadmin) and EVERY connection as a labelled arrow (what
   protocol/what data). One overview + one per-environment variant if the
   overview gets crowded.
2. **Per-tool wireframes/flows** — for EACH tool (D.O.G., O.T.T.E.R.,
   R.A.B.B.I.T.) and each shared surface (Dashboard, Admin Terminal,
   Settings, Team Members, Rate Card, operator console): a screen-level
   wireframe sketch (layout blocks, navigation) plus the tool's primary
   dataflow (e.g. D.O.G. brief → generation pipeline → outline → exports;
   O.T.T.E.R. course generation / quiz / validator / change-request
   lifecycle; R.A.B.B.I.T. intake → phases/assets/tasks → views, budget,
   files/relink).
3. **Per-function dataflows** — one small diagram per load-bearing
   function: login (resolve → password → MFA → session), invite +
   onboarding, realtime sync (broadcast path), soft-delete → trash →
   restore → purge → GC certificate, storage relink (scan → match →
   preview → apply), CSV exports + takeout, the ai-proxy call path,
   change-request submit → review → apply, auto-update, backups,
   workspace provision + teardown.
4. An **inventory table** at the top (diagram id → what it shows →
   which handbook section it illustrates) so Audrey's design session can
   be driven diagram-by-diagram.

Keep the mermaid semantically honest (real route names, real table
names) — these are engineering wireframes, not decoration; the pretty
pass happens in Audrey's design session afterwards.

## Traps & discipline

- Token discipline: hard cap 15 agents; finders paste excerpts; never
  resume nondeterministic fan-out pipelines. A recon fan-out (one reader
  per subsystem, S14-style) is the right way to gather source material —
  but every fact still gets verified before it lands in the handbook.
- The wilson-app skill and MEMORY.md are SNAPSHOTS — the code is the
  authority. (The skill's API-key rule, for instance, predates S12's
  ai-proxy.)
- No product code changes (see header). No new nav, no refactors, no
  "while I'm here" fixes.

## Close-out ritual

Docs commit + push (handbook + design pack + any prompt/plan updates) →
CI green (docs-only, should be trivial) → **write
`docs/sessions/SESSION_17_prompt.md`** (release: final §6 disposition,
fixes surfaced by this session's read, changelog, package.json → 1.0.0,
tag; scope in MASTER_PLAN §5) → update `docs/MASTER_PLAN.md` (§4 ledger,
§5, §6 for anything the drift review surfaced, §10) → update the Claude
auto-memory → list Audrey's owed items (read the handbook end to end
before sharing it — she is the final reviewer of the hand-out document;
then run her Claude design session off the design pack).

---

## What S16 must document (appended by S15's close-out)

*(S15 appends here: everything it added that the handbook must cover —
the /wilsonadmin surface + session isolation, workspace_ai_keys, teardown
+ storage sweep, the durable rate limiter, and anything else.)*
