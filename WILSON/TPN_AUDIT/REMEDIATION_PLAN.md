# TPN Compliance — Remediation Plan

- **Project:** WILSON (Petal Studios)
- **Repo path:** `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON`
- **Generated:** 2026-04-15; **revised at the 2026-07-30 re-audit**
- **Total findings to address:** 92 (44 baseline + 48 opened by the re-audit; 5 are RESOLVED)
- **Total phases:** 8 (Phase 0 added by the re-audit, plus a parallel CVE-triage track)
- **Non-negotiable rule for the implementation skill:** Preserve public IPC shapes, REST surface, on-disk JSON shapes, IndexedDB `wilson-db` schema, and exported markdown formats unless a finding explicitly requires a change. Any interface change must be flagged and approved by the user before execution.

## Phase dependency graph

```
Phase 0 (URGENT: credential rotation + privilege audit) ─► everything else
Phase 1 (Foundations) ─► Phase 2 (Encryption) ─► Phase 3 (Auth) ─► Phase 4 (Network/Cloud)
                                                                         │
Phase 5 (Content)  ◄────────────────────────────────────────────────────┘
Phase 6 (AI/ML)    ─► parallel after Phase 2 (needs safeStorage + structured logger)
Phase 7 (Docs)     ─► parallel after Phase 1 (policy docs trail the code)
Phase X (3P / CVE) ─► continuous, kicked off with Phase 1's CI bootstrap
```

---

## Phase 0 — 🚨 URGENT: rotate the published credential, audit privilege changes

> **Added by the 2026-07-30 re-audit.** Both items are CRITICAL and neither
> depends on any other phase. Phase 0 is not a refactor — it is two discrete
> actions, one of which cannot be performed by an agent at all.

**Why first:** one of these is a working credential for a hosted project that
has been publicly readable for eleven sessions, and the other means the
product cannot answer "who granted this person admin?" for any incident that
has already happened. Everything else in this plan can wait a day; these
cannot.

**Findings addressed:** TPN-SDLC-007, TPN-LOG-005

**Entry criteria:** none.

**Exit criteria:**
- `smoke_admin`'s password has been rotated, the `DEV_PROBE_PASSWORD` GitHub
  secret updated, and the CI Playwright job re-run green.
- `rg -n "SmokeTest"` returns zero hits across the working tree (already true
  as of Session 15 — verify it stayed true).
- A capture trigger exists on `public.workspace_members` and a pgTAP probe
  asserts that a role change writes an audit row.
- The `auth_attempt_log` and `app_events` auth streams have been reviewed for
  unrecognised sign-ins during the exposure window.

### 0a — Credential rotation (HUMAN ONLY — do not attempt this in an agent)

The agent must never handle credentials. The steps are written out for the
operator in `docs/OWED_AUDREY.md` §0. Session 15 already did the parts that do
not touch the secret: removed the literal from `tests/e2e/auth.spec.ts` and
`tests/e2e/web-path.spec.ts` (both now throw if `WILSON_E2E_PASSWORD` is
unset, and CI supplies it from `DEV_PROBE_PASSWORD`), redacted it from the
tracked docs, and rewrote the instructions that told operators to rotate the
password *back* to the published value.

**Note that the code changes do NOT remediate the finding.** The value is in
git history and on GitHub permanently. Only rotation closes it.

While rotating, decide whether the CI probe needs `admin` at all — it signs
in, reads a project list and follows an invite, all of which a `user`-role
account proves equally well.

### 0b — Audit privilege changes (implementation skill CAN do this)

**Prompt for implementation skill (copy/paste):**

```
Close TPN-LOG-005. Privilege changes on public.workspace_members are written
directly from the browser (src/components/TeamMembers/useWorkspaceMembers.js
issues a raw .update() under the FOR ALL ws_members_admin_write policy) and
nothing records them: edit_history's entity_type CHECK deliberately excludes
workspace_members, the only triggers on the table are guards, and no
app_events line is written on that path.

Add a migration (next free number) that:
  1. creates a SECURITY DEFINER capture trigger on public.workspace_members
     firing AFTER INSERT OR UPDATE OR DELETE, writing one app_events row per
     change with event_type 'admin' and a new WIL-41xx code, recording the
     actor (auth.uid(), or NULL for service_role writes), the target user, and
     the before/after values of app_role, is_active, grant_rate_card_view and
     grant_rate_card_edit;
  2. follows the fn_file_events_capture (0027) shape exactly — SECURITY
     DEFINER with a catch-all EXCEPTION -> RAISE WARNING, so an audit hiccup
     can never abort the write it audits, including workspace CASCADE
     teardowns;
  3. does NOT add FORCE to app_events' existing settings and does not alter
     its policies — the 'admin' event_type is already service-role-reserved by
     the 0021 INSERT policy, and a DEFINER trigger inserts as the table owner.

Then add pgTAP probes to a new suite asserting: a role promotion writes
exactly one audit row; the row names the acting user; a plain member cannot
write that row directly; and the trigger does not abort a workspace delete.

Verify with scripts/tap-hosted.py against wilson-dev before pushing, and add
the table to the per-table coverage gate in .github/workflows/rls.yml at the
git root if a new suite file is created.
```

**Expected effort:** S (0a is minutes of dashboard work; 0b is one migration
plus a pgTAP suite).

**Rollback notes:** 0b is additive — dropping the trigger restores current
behaviour exactly. 0a has no rollback and needs none.


## Phase 1 — Foundations: secrets manager, structured logger, CI pipeline

**Why first:** Every later phase needs (a) a way to resolve secrets without typing literals into code and (b) a structured log sink to emit audit events. Without these, the encryption/auth/content phases would be re-touched when logging lands.

**Findings addressed:**
- TPN-SDLC-001, TPN-SDLC-002, TPN-SDLC-003, TPN-SDLC-004, TPN-SDLC-005, TPN-SDLC-006
- TPN-LOG-001, TPN-LOG-003, TPN-LOG-004
- TPN-ENC-001, TPN-ENC-002 (on-disk JSON encryption layer introduced here; consumed in Phase 2)
- TPN-3P-001 (SBOM + npm-audit gate) — also continuous

**Entry criteria:**
- User has approved: Electron `safeStorage` for desktop secret encryption; `pino` as the logger; GitHub Actions as CI; `gitleaks` + `semgrep` + `npm audit` as minimum scans.

**Exit criteria:**
- `ADMIN_PASSWORD` / `DEFAULT_PASSWORD` constants deleted; first-run password flow in place (plaintext compare can remain for one more phase — migrated to argon2 in Phase 2).
- `safeStorage`-backed `secureStore.cjs` created and exercised by `wilson-auth.json`, `supabase.json`, `gdrive-config.json`, `gdrive-tokens.json` (read + write).
- `pino` logger shipped via IPC; every console.* in auth/change/verify/file routes replaced with structured events; retention policy in `LOGGING_AND_RETENTION.md`.
- `.github/workflows/security.yml` with `semgrep`, `gitleaks`, `npm audit`, `cyclonedx-npm` SBOM.
- `.gitignore` updated per RECO-SDLC-SECRETS.
- `WILSON_ALLOW_FETCH_PROXY` env flag gates `/api/fetch-url` + `/api/fetch-raw` in packaged builds.

**Prompt for implementation skill (copy/paste):**

```
Use the tpn-compliance-implementation skill. Load TPN_AUDIT/REMEDIATION_PLAN.md.
Execute Phase 1 only ("Foundations: secrets manager, structured logger, CI pipeline").

Before changing any code, present a plan that covers:
1. Exact signature of electron/secureStore.cjs and the migration path for existing
   unencrypted wilson-auth.json / supabase.json / gdrive-*.json files.
2. The pino config (levels, rotation, file path) and the IPC bridge the renderer
   will use to log.
3. The CI workflow file and the gating rules (fail on CRITICAL SCA, fail on new
   gitleaks finding, fail on semgrep ERROR).
4. Exact list of files that will change with a one-line reason for each.
5. Rollback path — safeStorage failures must fall back to a documented
   "re-provision on next launch" flow, not silent plaintext.

Do NOT execute until I approve the plan. After Phase 1 is complete, re-read this
plan and produce the Phase 2 prompt, pausing so I can adjust it before Phase 2
begins.
```

**Expected effort:** M (2–3 days)

**Rollback notes:** If `safeStorage` cannot initialize on a user's machine, leave the old JSON write path but flag a HIGH event and block admin routes until remediated. CI workflow can be disabled without rolling back the app.

---

## Phase 2 — Encryption hardening

**Why next:** With the secure store and logger in place, we can swap the plaintext password file, encrypt IndexedDB-backed content, and remove the direct-browser AI key handling.

**Findings addressed:**
- TPN-ENC-003 (argon2id for passwords)
- TPN-ENC-001 (Anthropic key out of localStorage → safeStorage via IPC)
- TPN-ENC-002 (Supabase + Drive creds already moved in Phase 1; verify)
- TPN-ENC-004 (IndexedDB at-rest encryption)
- TPN-ENC-006 (KMS/rotation doc landing in `KEY_MANAGEMENT.md`)

**Entry criteria:**
- Phase 1 complete.
- User has exported any currently-important wilson-auth.json (we will migrate in-place on first launch).

**Exit criteria:**
- Password store is argon2id hashes; plaintext compare removed; migration tested on an existing 0.6.3 install.
- `src/storage.js` reads/writes ciphertext; a fresh IndexedDB dump shows no plaintext project data.
- `wilson-api-key` no longer exists in localStorage; the renderer calls `window.electronAPI.ai.sendPrompt()` which resolves the key inside main via `safeStorage`.
- `KEY_MANAGEMENT.md` committed with rotation cadence and compromise runbook.
- Forensic watermark service stubbed but not yet on the download path (see Phase 5).

**Prompt for implementation skill:**

```
Use the tpn-compliance-implementation skill. Load TPN_AUDIT/REMEDIATION_PLAN.md.
Execute Phase 2 only ("Encryption hardening"). Phase 1 must be complete.

Present a plan covering:
1. Argon2 params (memoryCost, timeCost, parallelism) and the one-shot migration
   that upgrades wilson-auth.json from plaintext to argon2 on first successful
   verify.
2. IndexedDB ciphertext format (header magic, IV placement, auth tag) and the
   first-launch migration from plaintext rows. Include a fallback for rows that
   fail to decrypt (quarantine, do not delete).
3. The IPC contract that replaces renderer-side localStorage API key handling.
   Enumerate every caller of anthropicApiKey in src/ and the replacement.
4. Rollback: if migration fails mid-way, how to recover the user's projects.

Pause for approval before executing. After completion, produce Phase 3's prompt.
```

**Expected effort:** L (5–7 days)

**Rollback notes:** Keep the old plaintext reader behind a versioned schema marker for one minor release. If ciphertext migration corrupts a project blob, restore from the `*.bak` written at migration start.

---

## Phase 3 — Authentication, session, policy, RBAC

**Why next:** With secrets and crypto in place, we can tighten the actual auth surface without re-touching the crypto layer.

**Findings addressed:**
- TPN-AUTH-001 (already removed in Phase 1; confirm)
- TPN-AUTH-002 (password policy 12-char min, symbols, no case-fold)
- TPN-AUTH-003 (MFA — interim: local TOTP; adopt SSO later)
- TPN-AUTH-004 (real session cookies, 30-min idle, rotation, single-session)
- TPN-AUTH-005 (RBAC middleware, viewer/editor/admin)
- TPN-NET-003 (rate limit on auth routes)
- TPN-LOG-003 (auth event logging — already from Phase 1; verify coverage)

**Entry criteria:**
- Phase 2 complete.
- User has decided between (a) self-hosted TOTP only or (b) OIDC/SSO integration for MFA.

**Exit criteria:**
- Password policy enforced at /api/auth/change and at first-run setup.
- `express-session` with cookie flags per RECO-AUTH-SESSION; 30-min idle; rotation on /api/auth/change; single-session.
- Route middleware: every destructive or credential route requires role ≥ admin and step-up TOTP within last 5 min.
- `express-rate-limit` mounted on /api/auth/*; 10/min lockout tested.
- `ACCESS_CONTROL.md` committed.

**Prompt for implementation skill:**

```
Use the tpn-compliance-implementation skill. Execute Phase 3 only ("Auth, session,
RBAC"). Phase 2 must be complete.

Plan must cover:
1. Exact migration from the single-user timestamp file to a multi-user table
   (even if only one user exists day one). Tables/files schema.
2. Session cookie story — the renderer currently talks to 127.0.0.1:<port>; the
   cookie domain and Secure flag need thought. Document the self-signed-HTTPS
   localhost plan OR an alternative that satisfies AS-3.8.
3. Step-up TOTP flow: enrollment, QR, backup codes, forced re-enroll after 10
   consecutive failures.
4. RBAC middleware — list every /api route and the role required.
5. Interface preservation: PasswordScreen.jsx changes — do we keep the
   "PASSWORD" typing animation? Flag for UI review before commit.

Pause for approval before executing. After completion, produce Phase 4's prompt.
```

**Expected effort:** L (5–7 days)

**Rollback notes:** Keep the legacy /api/auth/verify shape for one release with a feature flag; the renderer can flip back if session rollout fails.

---

## Phase 4 — Network boundary + Cloud posture

**Why next:** CORS, CSRF, fetch-proxy hardening, and Supabase RLS are now the biggest remaining surface. Auth and logging must already be in place so lockout + audit trails are credible.

**Findings addressed:**
- TPN-NET-001 (CORS tightening)
- TPN-NET-002 (fetch-proxy allow-list + SSRF filter)
- TPN-CLOUD-001 (RLS-on default, SQL migration, adapter README flip)
- TPN-CLOUD-002 (CMK plan documented; implementation deferred to studio request)

**Entry criteria:**
- Phase 3 complete.
- Supabase project owner (user) has scheduled a short maintenance window for RLS flip.

**Exit criteria:**
- Origin allow-list regex applied; remote-origin requests rejected in a test.
- `/api/fetch-url` + `/api/fetch-raw` enforce an allow-list and block RFC-1918 / link-local / metadata hosts.
- CSRF tokens mounted on state-changing routes.
- Supabase migration committed; adapter refuses to connect to an RLS-off project unless an explicit `allow_rls_off=true` is set in supabase.json (dev-only).
- `VENDOR_RISK.md` updated to include Supabase posture.

**Prompt for implementation skill:**

```
Use the tpn-compliance-implementation skill. Execute Phase 4 only ("Network/Cloud").
Phase 3 must be complete.

Plan must cover:
1. The exact origin regex and how it interacts with Electron's dynamic port.
2. The fetch-proxy allow-list — enumerate the hosts that intake.pipeline.js,
   RateCard, and /api/fetch-* currently hit. Propose the minimum viable list.
3. Supabase RLS migration SQL; rollback script.
4. CSRF token plumbing; include a note on the existing PasswordScreen's direct
   fetch and how it will acquire the token.

Pause for approval. After completion, produce Phase 5's prompt.
```

**Expected effort:** M (3–4 days)

**Rollback notes:** Feature-flag the origin allow-list; if a legitimate user flow breaks, widen the regex rather than disabling. RLS migration ships with a tested down-migration.

---

## Phase 5 — Content handling: lifecycle, expiring links, watermarking, AS-2.9 event schema

**Why this order:** Heaviest phase; safest to run after auth/RBAC and logging are mature so the new events have a correct actor.

**Findings addressed:**
- TPN-CONT-001, TPN-CONT-002, TPN-CONT-003, TPN-CONT-004
- TPN-CONT-005, TPN-ENC-005 (forensic watermark)
- TPN-LOG-002 (AS-2.9 event schema)

**Entry criteria:**
- Phase 4 complete.
- User has approved a watermarking vendor/technique (MVP: open-source image/video steg for PoC; production: contracted vendor).

**Exit criteria:**
- `files` + `managedFiles` rows have `state`, `state_history`, `retention_until`.
- Disposal is async with proof-of-deletion cert, purges thumbnails + Supabase Storage + Drive.
- Download route requires a short-TTL token, emits an `AS-2.9`-compliant event per access, sets `Cache-Control: no-store`.
- Forensic watermark embedded on the download response and outbound Drive/Supabase uploads; payload recorded.

**Prompt for implementation skill:**

```
Use the tpn-compliance-implementation skill. Execute Phase 5 only
("Content lifecycle + watermarking + AS-2.9"). Phases 1–4 must be complete.

Plan must cover:
1. Backward-compatible schema upgrade for `files` and `managedFiles` — how
   existing rows get default state = 'wip'.
2. Download-token service: storage (in-memory kv is fine for desktop), TTL,
   single-use semantics. Renderer call-site audit — every UI that opens a
   download link.
3. Watermark embedder MVP — approved filter chain. Identify media types that
   cannot be watermarked today (e.g., PDFs) and the policy for those.
4. The disposal job — ordering across primary FS, Supabase Storage, Drive,
   thumbnails, IndexedDB.

Pause for approval. After completion, produce Phase 6's prompt.
```

**Expected effort:** XL (8–12 days)

**Rollback notes:** Watermarking is the most invasive change — feature-flag end-to-end, dual-stream (watermarked + raw) for 30 days with A/B extraction tests before cutting over.

---

## Phase 6 — AI/ML controls (parallelizable after Phase 2)

**Why this order:** Can proceed in parallel with Phase 3 onward once Phase 2 is live (gateway depends on safeStorage + structured logger from Phases 1–2).

**Findings addressed:**
- TPN-AI-001, TPN-AI-002, TPN-AI-003

**Entry criteria:**
- Phase 2 complete.
- User has decided on the model endpoint for content-bearing flows (Bedrock-hosted Claude, Azure OpenAI, self-hosted proxy, etc.).

**Exit criteria:**
- `src/agent/aiGateway.ts` exists; every call to Anthropic / other model SDK routes through it.
- ESLint custom rule blocks direct SDK imports outside the gateway.
- `anthropic-dangerous-direct-browser-access` string removed from the codebase.
- AI responses tagged with originating asset id and inherit its lifecycle state.
- `AI_POLICY.md` committed; training reference linked.

**Prompt for implementation skill:**

```
Use the tpn-compliance-implementation skill. Execute Phase 6 only ("AI/ML policy
and gateway"). Phase 2 must be complete.

Plan must cover:
1. IPC contract for sendPrompt (request/response shape, streaming semantics for
   agent use).
2. Redaction ruleset — regex list for content signals (title, release date,
   cast names) and the per-client approval model.
3. Custom ESLint rule implementation.
4. Migration for every existing caller of api.anthropic.com — enumerate files
   and line numbers.

Pause for approval. After completion, produce Phase 7's prompt.
```

**Expected effort:** L (5–7 days)

**Rollback notes:** Gateway can proxy transparently for one release — functional parity before policy enforcement flips on.

---

## Phase 7 — Documentation & policies

**Why last (but can run in parallel with Phases 3–6):** The policy docs reference concrete implementations from earlier phases. Authoring them after code lands means the text describes reality, not intent.

**Findings addressed:**
- TPN-DOC-001, TPN-DOC-002, TPN-DOC-003
- TPN-IR-001, TPN-IR-002, TPN-IR-003
- TPN-3P-003

**Entry criteria:**
- Phases 1–6 substantially complete (≥ 80% of findings resolved).

**Exit criteria:**
- Ten policy docs present at repo root with a "Last reviewed: YYYY-MM-DD" header:
  `SECURITY.md`, `HARDENING.md`, `INCIDENT_RESPONSE.md`, `BCP.md`, `AI_POLICY.md`,
  `ACCESS_CONTROL.md`, `KEY_MANAGEMENT.md`, `LOGGING_AND_RETENTION.md`,
  `VENDOR_RISK.md`, `RISK_ASSESSMENT.md`.
- First tabletop exercise and restore drill completed, AAR appended to IR/BCP.

**Prompt for implementation skill:**

```
Use the tpn-compliance-implementation skill. Execute Phase 7 only ("Docs + policies").
Phases 1–6 must be substantially complete.

Plan must cover:
1. For each of the ten docs, the outline and the specific code references it
   will cite.
2. The annual-review automation (GitHub Action that fails PRs touching policy
   files if the "Last reviewed" line is > 12 months old).

Pause for approval. After completion, the project is ready to file a Blue
self-attestation on TPN+ and schedule a Silver third-party assessment.
```

**Expected effort:** M (3–4 days)

**Rollback notes:** Documentation is append-only; no technical rollback. Prior drafts are preserved in git history.

---

## Continuous — Phase X: Third-party / CVE triage

Runs continuously from Phase 1 onward once CI is live. Not gated.

**Findings addressed:**
- TPN-3P-001, TPN-3P-002

**Steps:**
- Gate `npm audit --audit-level=high` in CI.
- Replace `xlsx@0.18.5` — see RECO-3P-CVE.
- Subscribe to GHSA for every direct dep.
- Publish `sbom.json` with each release.
- Monthly triage meeting referenced in `VENDOR_RISK.md`.

**Prompt for implementation skill (can run any time after Phase 1):**

```
Use the tpn-compliance-implementation skill. Execute the continuous Phase X
("Third-party / CVE triage"). Phase 1 must be complete.

Plan must cover:
1. Concrete xlsx replacement strategy and test plan for every consumer
   (RateCard importer, RABBIT intake spreadsheet path).
2. SBOM publication in electron-forge release artifacts.

Pause for approval. After completion, re-open the audit index and mark the
TPN-3P findings resolved with a resolved_date entry.
```

**Expected effort:** M (ongoing)

**Rollback notes:** xlsx replacement must keep exported spreadsheet shape. Dual-read / feature flag during transition.
