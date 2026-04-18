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
