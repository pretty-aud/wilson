# TPN Audit — Learnings

Notes that should inform the NEXT audit of this codebase. Treat this file as append-only; do not delete prior entries.

## 2026-04-15 — first audit

### Architecture shape (orient fast on re-audit)
- WILSON is an Electron desktop app with an embedded Express server (`electron/main.cjs`) that the renderer talks to over loopback. This is unusual — most Electron apps use IPC only. The Express layer is where most auth/content routes live.
- Three in-app tools: D.O.G. (deck outline generator, `src/tools/deck-outline-generator_v0.514`), O.T.T.E.R. (`src/tools/otter_v0.3.1`), RABBIT (`src/tools/rabbit_v0.1.0`). RABBIT is the one that carries content-security risk — it has the intake pipeline, project bundles, Supabase + Drive adapters, and the file upload/download routes.
- Data stores, in rough order of sensitivity: Supabase `rabbit-files` bucket + Postgres tables; Google Drive folder tree; `%APPDATA%/WILSON/rabbit-data/*.json`; `%APPDATA%/WILSON/otter-data/*.json`; IndexedDB `wilson-db.projects.all`; localStorage `wilson-api-key` + project mirrors.

### Good patterns — keep, build on
- **Electron shell is hardened**: `nodeIntegration: false`, `contextIsolation: true`, `preload.cjs` exposes a narrow IPC surface, and external links route through `shell.openExternal` via `setWindowOpenHandler`. Re-audits should start from the assumption the shell is OK unless it changed.
- **HTTPS-only external fetches**: no `http://` URL to a real service anywhere. Kept clean on re-audit.
- **Streaming file copy in main process** for multi-GB support (`electron/main.cjs:1924`). Good foundation for the watermarking pipeline in Phase 5.

### Intentional design that looks bad but isn't
- `http://localhost:19854/api/rabbit` in `src/tools/rabbit_v0.1.0/views/budget/TalentTab.jsx:17` and `CrewTeamTab.jsx:17`: this is the loopback to the embedded server, not a real plaintext connection. Flagged INFO in the next audit, not HIGH.
- `Math.random()` use in `electron/main.cjs:97`, `:101` (pet gender, egg hatch threshold): non-security RNG, keep marked LOW-INFO.
- SVG data URIs using `xmlns='http://www.w3.org/2000/svg'` are W3C namespace references, not network calls.

### Booby-traps found on this audit
- `ADMIN_PASSWORD = 'DILLYDALLY'` at `electron/main.cjs:585` is a universal override. The remediation plan removes it in Phase 1; on re-audit, **confirm deletion** — assume nothing.
- `anthropic-dangerous-direct-browser-access: 'true'` appears in FOUR places: `src/App.jsx:655`, `src/agent/AgentProvider.jsx:373`, `src/tools/rabbit_v0.1.0/intake/pipeline.js:279` and `:363`. Grep before trusting that one was fixed.
- RABBIT Supabase adapter comments tell users to run with RLS off (`src/tools/rabbit_v0.1.0/adapters/supabaseAdapter.js:13`). Comment is documentation; real fix requires a SQL migration and an adapter guard.

### Scope decisions
- **Physical controls: N/A.** WILSON does not integrate with badge readers, cameras, or NVRs. Recorded under `TPN-PHYS-000`. Do not open physical findings on re-audit unless a new integration ships.
- **The `public/extensions/Code.gs` + `Sidebar.html`** files are Google Apps Script extensions the user has directed us not to edit. They were not audited against TPN controls. If audited, flag as a separate third-party-boundary concern — the GAS environment enforces its own sandbox and is out of our patch path.

### Things the user may accept risk on (do not auto-escalate without new evidence)
- Hardcoded fallback `MUTINY` in `src/components/PasswordScreen.jsx:20` is a **network-failure fallback** the user shipped intentionally for offline single-user use. It is still a CRITICAL per TPN, but it is not a surprise; treat it as "known, will be removed in Phase 1."
- The 12-character password cap appears to be driven by the PASSWORD screen's UI animation (12-slot typing display, `MAX_INPUT_LENGTH = 12` in `PasswordScreen.jsx:7`). The UI constraint is a design choice. Remediation requires a UX decision — either drop the cap and adjust the animation, or keep the cap and go MFA-only. Do not assume which the user will pick.

### Re-audit checklist (quick)
1. `rg -n "DILLYDALLY|MUTINY"` — must return zero hits outside this LEARNINGS file.
2. `rg -n "anthropic-dangerous-direct-browser-access"` — must return zero.
3. `rg -n "localStorage\\.setItem\\(['\"]wilson-api-key"` — must return zero.
4. Confirm `.github/workflows/security.yml` exists and its last successful run is recent.
5. Confirm `HARDENING.md` + `INCIDENT_RESPONSE.md` exist with a "Last reviewed" line in the past 12 months.
6. `rg -n "expressApp\\.use\\(cors\\(\\)\\)"` should return zero (the cors() call has been parameterized).
7. `rg -n "password\\s*===" electron/main.cjs` should return zero (argon2.verify replaced the plaintext compare).
8. Supabase adapter comment about RLS-off default must be gone.

---

## Re-audit 2026-07-30 (Session 15) — appended, nothing above was changed

### Checklist results from the list above

| # | Check | Result |
|---|---|---|
| 1 | `DILLYDALLY\|MUTINY` outside this file | ✅ zero — the whole legacy auth module and `PasswordScreen.jsx` were deleted in S15 |
| 2 | `anthropic-dangerous-direct-browser-access` | ✅ zero — all four sites went with the S12 `ai-proxy` migration |
| 3 | `localStorage.setItem('wilson-api-key'` | ✅ zero — and the inverse now exists: `src/App.jsx` *removes* the key on boot |
| 4 | `.github/workflows/security.yml` | ❌ does not exist. CI runs pgTAP, Vitest and Playwright — no SAST, SCA, secret-scan or DAST |
| 5 | `HARDENING.md` + `INCIDENT_RESPONSE.md` | ❌ neither exists; no policy document of any kind exists in the repo |
| 6 | `expressApp.use(cors())` | ❌ still present and still unparameterized |
| 7 | `password ===` in `electron/main.cjs` | ✅ zero — no password comparison remains in application code at all |
| 8 | Supabase adapter RLS-off comment | 🟡 the directive is gone; the domain is now genuinely RLS-first, but bucket policies still sit outside the CI gate |

### The meta-lesson of this re-audit: verify the CONTROL, not the ARTIFACT

Most of the baseline's remediations arrived by a different route than
`REMEDIATION_PLAN.md` prescribed, because the product was rebuilt around them
in the meantime:

| The plan prescribed | What actually satisfies the control |
|---|---|
| `src/agent/aiGateway.ts` | the `ai-proxy` Supabase Edge Function (and it covers BOTH hosts, which the plan's Electron-IPC design would not have) |
| local RBAC middleware | Postgres RLS + workspace roles, pgTAP-gated in CI |
| pino + a SIEM shipper | `app_events`, `edit_history`, `file_events`, `platform_audit` — four RLS-enforced append-only streams |
| `safeStorage`-backed key IPC | no key on the client at all |

Grepping for the prescribed filenames would have reported four false "still
open" verdicts. **On any future re-audit, resolve the control first and the
artifact second.**

### Booby-traps found on THIS audit

- **A live credential was hiding in documentation, not in code.** `smoke_admin` /
  its password sat in two session checklists and as a hardcoded fallback in two
  Playwright specs, in a PUBLIC repo, for eleven sessions. Three things kept it
  invisible: it lived mostly in `docs/`, which reads as prose rather than
  source; it looked like a test fixture; and the checklist actively instructed
  operators to **rotate the password back to the published literal** whenever a
  flow changed it. Audit `docs/` and `tests/` for credentials with the same
  seriousness as `src/`, and treat any instruction that pins a secret to a
  known value as a finding in its own right.
- **The strongest new controls have the narrowest scope.** S14/S15's content
  lifecycle is genuinely good — append-only events, real deletion certificates,
  a disposal ledger, certificates that outlive the tenant — but it is driven by
  triggers on ONE table (`public.files`). The Electron tier's production media
  path (managed files), derived intake text, and the local `.trash` folder all
  sit outside it. When a control is implemented as a database trigger, always
  ask which writes do not go through that table.
- **Two audit streams cascade with their tenant.** `app_events` and
  `file_events` both carry `workspace_id ... ON DELETE CASCADE`, so a workspace
  teardown destroys the evidence of itself. S15 solved this for operator
  actions by adding `platform_audit` with no FK and text snapshots of the
  slug/name. The general shape is worth remembering: **an audit row must not be
  a child of the thing it audits.**
- **Read-side blindness.** Four write-side audit streams exist and there is
  still no record anywhere of who ever *downloaded* an asset. Write auditing is
  easy to add with triggers; read auditing needs an application decision, and
  its absence is easy to miss precisely because the write side looks complete.

### Things the user may accept risk on (do not auto-escalate without new evidence)

- The two entries above from the 2026-04-15 audit (the intentional offline
  password fallback, and the 12-character cap driven by the password screen's
  typing animation) are now **moot** — all the code carrying them was deleted
  in S15. They are retained above as history only.
- **Session tokens in `localStorage` on the web** was decided deliberately in
  Session 12: a static host has no server to set an httpOnly cookie, and this
  is what supabase-js's own `persistSession` does. `TPN-ENC-008` records it
  honestly for the operator console, but do not treat it as an oversight.
- **The durable rate limiter fails open** (`_shared/rateLimit.ts`) with a
  stated reason: a limiter is an abuse control, and authorization has already
  run above it, so a database hiccup must not take every tenant's AI features
  offline. Recorded as `TPN-NET-011` at INFO. The sibling `operatorGuard` fails
  *closed*, which is the correct contrast.
- **Granting platform-operator status is SQL-only, with no UI on any surface.**
  This looks like a missing feature and is a deliberate control: the highest
  privilege in the system cannot be escalated from a web session.

### Scope decisions (unchanged)

- Physical remains N/A — `TPN-PHYS-000`. Not re-opened.
- `public/extensions/Code.gs` + `Sidebar.html` remain outside audit scope by
  user direction. Still not audited, still not edited.

### Re-audit checklist for NEXT time (supersedes the list above)

1. `rg -n "SmokeTest|smoke_admin"` across `docs/`, `tests/` and `src/` — the
   password must be absent and the account should ideally no longer be `admin`.
2. Confirm an audit trigger exists on `public.workspace_members` (TPN-LOG-005).
3. `rg -n "expressApp\.use\(cors\(\)\)"` — still expected to be zero one day.
4. Confirm `.github/workflows/` contains a security-scanning job.
5. Confirm the policy document set exists with a "Last reviewed" line.
6. Check `storage.buckets` for `user-avatars.public` — it should be `false`.
7. Confirm `workspaces_write_operator` is no longer `FOR ALL`.
8. Re-check that `x-api-key` appears nowhere under `src/` or `electron/`.

## 2026-08-05 — scoped design review (network & remote storage)

Not a re-audit. Five passes (Network, Content, Auth, Cloud, Third-Party) run
against `docs/NETWORK_STORAGE_DESIGN.md` **before** implementation, at Audrey's
explicit instruction. Result: `TPN_AUDIT/DESIGN_REVIEW_network_storage.md`.

- **The six-file output contract was deliberately NOT followed.** Writing
  `SUMMARY.md` / `FINDINGS.md` for a scoped design review would have destroyed
  the 92-finding baseline. Scoped reviews go in their own file and continue the
  existing ID sequences. **Do this again next time** — the contract assumes a
  full audit and does not describe the scoped case.
- New IDs issued: `TPN-NET-012`, `TPN-NET-013`, `TPN-NET-014` (INFO/credit),
  `TPN-AUTH-008`, `TPN-CONT-016`, `TPN-3P-010`, `TPN-CLOUD-007`. Merge into
  `FINDINGS.md` at the next full re-audit. Highest IDs before this review were
  NET-011, AUTH-007, CONT-015, 3P-009, CLOUD-006.
- **The framework settled the architecture question outright.** TS-2's remote
  access text — *"Bastion host model only. VPN with AES-256"* — means a bespoke
  internet-facing gateway is not a harder-to-pass option, it is the arrangement
  the control forbids. VPN is not a fallback here; it is the named control.
  Quote TS-2 verbatim if this is ever reopened.
- **`file_events` has no read side and this is now load-bearing.** The CHECK is
  `('uploaded','moved','relinked','trashed','restored','purged')`
  (`0027_file_lifecycle.sql:85-86`); the local download route
  (`electron/main.cjs:2028-2039`) logs nothing. Already filed as TPN-CONT-008 /
  TPN-LOG-002 — **do not mint a new ID for it.** What changed is the blast
  radius: it is survivable while content sits on one laptop and is not once a
  shared root exists.
- Measured and worth keeping: the containment guard at
  `electron/main.cjs:1330-1337` **holds against UNC escapes** — `path.resolve`
  clamps at the share root, and `..`, foreign UNC roots, `//host/share` and
  absolute drive paths all return `null`. It fails *closed* on a root that
  resolves with a trailing separator (`\\srv\share`, `C:\`). Not a
  vulnerability; the risk is in fixing it carelessly (TPN-NET-013).
- `workspaces.storage_mode` / `storage_config` are admin-writable, unvalidated
  and have **zero readers** anywhere outside migrations (TPN-CLOUD-007). Dead
  columns that are also writable are worse than dead.
