# TPN Compliance Audit — Summary

- **Project:** WILSON (Petal Studios)
- **Repo path:** `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON`
- **Audit date:** 2026-04-15
- **Auditor:** Claude (tpn-compliance-audit skill, version 1)
- **MPA CSBP version:** 5.3 / 5.3.1
- **Audit mode:** standard (all 12 passes)

## 🚨 Immediate Action Required

Three issues are severe enough that a credible self-attestation (Blue Shield) cannot be filed until they are stabilized:

- **Hardcoded admin backdoor password (`DILLYDALLY`)** compiled into every build — see `FINDINGS.md#TPN-AUTH-001` / `TPN-SDLC-001` (`electron/main.cjs:585`).
- **Pre-release client content flows to a public Anthropic endpoint with no policy gate, no redaction, and the "dangerous direct browser access" flag set** — see `FINDINGS.md#TPN-AI-001` (`src/App.jsx:649`, `src/agent/AgentProvider.jsx:367`, `src/tools/rabbit_v0.1.0/intake/pipeline.js:273`).
- **Anthropic API key, Supabase keys, and Google OAuth refresh tokens all stored unencrypted** (localStorage + `%APPDATA%/WILSON/rabbit-data/*.json`) — see `FINDINGS.md#TPN-ENC-001` and `TPN-ENC-002`.

Delete the admin backdoor, move secrets behind Electron `safeStorage`, and proxy AI calls through a server-side gateway before anything else ships.

## Overall Posture

**Current Shield tier eligibility:** **None** — cannot credibly self-attest Blue until the immediate-action CRITICALs are closed.

WILSON is an Electron desktop app that touches pre-release-sensitive material (project scripts, asset libraries, scheduled release dates, intake PDFs/DOCX/PPTX forwarded into RABBIT). The Electron shell itself is set up correctly (`nodeIntegration: false`, `contextIsolation: true`, external links routed through `shell.openExternal`). Below that, however, almost every control topic TPN audits is either absent or materially weak. The strongest domain is the sandboxed renderer process; the weakest are encryption-at-rest, AI/ML handling, logging/SIEM, and documentation — none of them exist in any form. Nine of the ten expected policy docs are missing, and there is no CI/CD scanning at all.

## Finding Counts

| Severity | Count |
|---|---|
| CRITICAL | 9 |
| HIGH | 21 |
| MEDIUM | 8 |
| LOW | 1 |
| INFO | 0 |
| N/A | 1 |

## Top 5 Most Critical

1. **[TPN-AUTH-001]** Hardcoded admin backdoor password `DILLYDALLY` — `electron/main.cjs:585`
2. **[TPN-AI-001]** Pre-release content sent to public Anthropic endpoint with `anthropic-dangerous-direct-browser-access: true` and no redaction/gateway — `src/App.jsx:649`
3. **[TPN-ENC-001]** Anthropic API key stored in browser localStorage — `src/App.jsx:163`
4. **[TPN-ENC-002]** Supabase keys + Google refresh tokens stored as plaintext JSON in userData — `electron/main.cjs:1855`
5. **[TPN-LOG-001]** No SIEM / centralized logging / structured logger anywhere — repo-wide (TS-1.5 Best Practice unmet)

## Domain Scores

- **Encryption:** 🔴 red — plaintext secrets on disk and in localStorage; plaintext passwords; IndexedDB unencrypted; no watermarking.
- **Authentication:** 🔴 red — hardcoded admin backdoor, case-folded ≤12-char alphanumeric password, no MFA, no real sessions, no RBAC, no rate limit.
- **Network:** 🟡 yellow — Electron renderer locked down correctly, but CORS is `*`, open URL proxies accept RFC-1918 targets, no rate limit on auth.
- **Logging & SIEM:** 🔴 red — no logger, no shipper, no content-event schema, no retention.
- **Content Handling:** 🟡 yellow — no lifecycle, no expiring links, no `Cache-Control: no-store`, no watermarking, thumbnail cache never purged.
- **Secure SDLC:** 🔴 red — secrets in source, `.gitignore` does not exclude `.env`/keys, no CI, no SAST/SCA/DAST/container/IaC scans, no env separation.
- **Incident Response:** 🔴 red — no IR plan, no BCP, no training reference.
- **AI/ML:** 🔴 red — client content reaches public AI with dangerous-browser flag; no gateway; no policy doc; no redaction; responses not lifecycle-tracked.
- **Cloud:** 🟡 yellow — Supabase adapter README instructs RLS-off and anon-key-only as default posture.
- **Physical:** 🟢 green — N/A (no physical systems controlled).
- **Documentation:** 🔴 red — nine of ten expected policy docs missing (SECURITY, HARDENING, IR, BCP, AI_POLICY, ACCESS_CONTROL, KEY_MANAGEMENT, LOGGING_AND_RETENTION, VENDOR_RISK, RISK_ASSESSMENT).
- **Third-Party:** 🟡 yellow — `xlsx@0.18.5` prototype-pollution/ReDoS family; no SBOM; no SCA; no vendor risk register.

## Blocking Controls for Gold Shield

Every Best-Practice control below currently has at least one CRITICAL or HIGH finding open and blocks Gold until remediated.

1. **AS-2.5** (Key management) — TPN-ENC-001, TPN-ENC-002, TPN-ENC-006
2. **AS-3.6** (Encryption at rest) — TPN-ENC-003, TPN-ENC-004
3. **AS-3.7 / AS-3.8** (Transit + session + cache) — TPN-AUTH-004, TPN-CONT-001, TPN-CONT-003, TPN-NET-003
4. **AS-3.14** (Forensic watermarking) — TPN-ENC-005, TPN-CONT-005
5. **AS-3.15** (Content lifecycle) — TPN-CONT-002, TPN-CONT-004, TPN-AI-003
6. **AS-2.9** (Content event logging) — TPN-LOG-002
7. **TS-1.5** (SIEM / centralized logging) — TPN-LOG-001, TPN-LOG-003, TPN-LOG-004
8. **TS-1.6** (MFA + password policy) — TPN-AUTH-001, TPN-AUTH-002, TPN-AUTH-003
9. **TS-1.7** (RBAC + SSO) — TPN-AUTH-005
10. **TS-1.14** (Secrets not in VCS) — TPN-SDLC-001, TPN-SDLC-002
11. **TS-2** (Network segmentation / default-deny) — TPN-NET-001, TPN-NET-002
12. **TS-4.0** (Vuln scanning + SDLC) — TPN-SDLC-003, TPN-3P-001, TPN-3P-002
13. **OR-1.1 / OR-1.2** (IR + BCP) — TPN-IR-001, TPN-IR-002
14. **OR-5.0** (AI/ML policy) — TPN-AI-001, TPN-AI-002, TPN-AI-003
15. **CS-1.13** (Cloud content protection) — TPN-CLOUD-001
16. **OR-3.x** (Documentation) — TPN-DOC-001, TPN-DOC-002, TPN-DOC-003

## Path Forward

The six reports in `TPN_AUDIT/` form a complete record. The remediation plan sequences 40 findings across 7 phases (plus a continuous CVE track), front-loading the secrets/logging/CI foundations so the later encryption, auth, and content phases can build on them without re-touching the same files.

> To apply fixes, invoke the `tpn-compliance-implementation` skill and point it at `TPN_AUDIT/REMEDIATION_PLAN.md`. Start with Phase 1.
