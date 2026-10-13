# TPN Compliance Audit — Summary

- **Project:** WILSON (Petal Studios)
- **Repo path:** `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON`
- **Audit date:** 2026-07-30 — **re-audit**; baseline 2026-04-15, committed at `1ce18ec`
- **Auditor:** Claude (tpn-compliance-audit skill, version 1)
- **MPA CSBP version:** 5.3 / 5.3.1
- **Audit mode:** standard (the nine code-bearing domain passes re-run in full;
  Physical remains a permanent scope exclusion, and Incident Response and
  Documentation are policy-only with no code to re-resolve)

## 🚨 Immediate Action Required

- **A live workspace-admin credential for the hosted `wilson-dev` project is
  published in this PUBLIC repository.** `smoke_admin` is an active,
  `admin`-role account; its password sat in two tracked session checklists
  *and* as a hardcoded fallback in two tracked Playwright specs. The anon key
  needed to complete the sign-in is public by design and ships in the web
  bundle, so the published pair was directly usable against the real endpoint —
  this was never a local fixture. The account was confirmed live against the
  database during this audit; it had signed in that morning. Session 15 removed
  every occurrence from the working tree and rewrote the documentation that
  instructed rotating the password *back* to that literal, **but the value
  remains in git history and on GitHub permanently, so the credential itself
  must be ROTATED.** See `FINDINGS.md#TPN-SDLC-007` and
  `docs/OWED_AUDREY.md` §0.
- **Every privilege change in the product is unaudited.** Role promotions,
  rate-card grants and deactivations are written to `workspace_members`
  straight from the browser under a `FOR ALL` policy, and nothing captures
  them: `edit_history`'s entity CHECK deliberately excludes the table, the only
  triggers on it are guards rather than capture, and no `app_events` line is
  written on that path. After an incident there is no way to establish who
  granted admin to whom, or when. See `FINDINGS.md#TPN-LOG-005`.

## Overall Posture

**Current Shield tier eligibility:** **None** — but for the first time the
blockers are countable rather than structural.

This re-audit found a materially different product from the one assessed in
April. All three of the baseline's immediate-action items are closed. The
Anthropic key is out of client storage entirely and `ai-proxy` is verifiably
the only path to the model on both hosts (`x-api-key` appears nowhere under
`src/` or `electron/`). The hardcoded admin backdoor, the default password and
the plaintext credential file were deleted outright in Session 15, with a
boot-time unlink so existing installs lose the file too. Per-tenant AI keys are
stored as correctly-implemented AES-256-GCM ciphertext — 32-byte key check,
per-record random IV, no plaintext column — in a table pgTAP proves no client
role can reach.

Authentication moved from a single shared password to Supabase Auth with TOTP,
a four-tier role model and RLS-enforced RBAC pinned by 36 pgTAP suites gated in
CI. Content lifecycle went from nothing to an append-only per-file event stream
with real deletion certificates that outlive the workspace they belonged to.
Five baseline findings are RESOLVED outright and nineteen are materially
reduced.

What keeps the tier at None is narrower and more fixable than before. Two
CRITICALs are open — one a published live credential, one an audit blind spot
over the privilege model itself. Below them, the strongest domains are Cloud
and Content, where table-layer tenancy is now genuinely solid; the weakest are
Third-Party and Documentation, neither of which has moved since April. Logging
is red not because the streams are bad — four exist, all RLS-enforced and
append-only — but because there is no aggregation, no alerting, sign-in and
operator-console access are unlogged, and two streams purge at 90 days against
a 1-year requirement.

The honest framing for a studio conversation: the **technical** controls have
improved enormously and are close to defensible; the **organizational** ones —
policies, vendor risk, incident response, supply chain — are essentially
untouched, and those are where a Silver or Gold assessment spends most of its
time.

## Finding Counts

| Severity | Count |
|---|---|
| CRITICAL | 3 |
| HIGH | 43 |
| MEDIUM | 31 |
| LOW | 7 |
| INFO | 1 |
| RESOLVED | 6 |
| N/A | 1 |

**Total: 92** — 44 carried from the baseline, 48 opened by this re-audit. A
further 5 re-audit findings were merged into an existing ID as the same defect
seen from a second domain pass.

> **Correction to the baseline's own arithmetic.** The 2026-04-15
> `AUDIT_INDEX.md` frontmatter and `SUMMARY.md` both reported 40 findings
> (9 CRITICAL / 21 HIGH / 8 MEDIUM). `FINDINGS.md` actually contained 44
> (10 CRITICAL / 25 HIGH / 7 MEDIUM / 1 LOW / 1 N/A) — four findings had been
> uncounted since April. Everything above is recomputed from `FINDINGS.md`,
> which is the source of truth.

## Top 5 Most Critical

1. **[TPN-SDLC-007]** Live workspace-admin credential for the hosted
   `wilson-dev` project published in the public repo —
   `docs/sessions/SESSION_03_TO_04_CHECKLIST.md:46`
2. **[TPN-LOG-005]** Privilege and grant changes on `workspace_members` are
   written directly by the client and audited by nothing —
   `src/components/TeamMembers/useWorkspaceMembers.js:111`
3. **[TPN-CLOUD-004]** `user-avatars` bucket is public *and* its SELECT policy
   is unconditional — the public anon key can enumerate every tenant's members
   — `supabase/migrations/0009_perms_and_provisioning.sql`
4. **[TPN-NET-001]** The local Express server still mounts bare `cors()` over
   its unauthenticated content routes — `electron/main.cjs:115`
5. **[TPN-NET-002]** `/api/fetch-url` and `/api/fetch-raw` accept any URL with
   no allow-list or SSRF protection — `electron/main.cjs:657`

> **[TPN-CLOUD-003] was in this list and is already fixed.**
> `workspaces_write_operator` was `FOR ALL`, so an operator's ordinary aal1
> browser session could `DELETE FROM workspaces` directly — bypassing the
> console's MFA, its typed confirmation, its blob sweep and its audit
> certificate. Migration `0029_operator_write_lockdown.sql` narrowed the
> policy, revoked the privilege and added a delete guard; pgTAP suite 37 pins
> all three. The pre-commit adversarial review found it independently and also
> rated it CRITICAL.

## Domain Scores

- **Encryption:** 🟡 yellow — all three baseline CRITICALs closed or materially
  reduced; the open HIGHs are plaintext Google OAuth secrets and refresh tokens
  on disk (despite `safeStorage` being correctly wired for the session), no
  forensic watermarking on either download path, and no transport-security
  headers on the public web host.
- **Authentication:** 🟡 yellow — Supabase Auth + TOTP + RLS-enforced RBAC
  replaced the shared password and two baseline CRITICALs are closed; admin MFA
  enrolment is still optional and indefinitely deferrable, and two revocation
  paths (admin demotion, workspace suspension) do not take effect until a token
  expires.
- **Network:** 🟡 yellow — the cloud tier gained a well-built durable rate
  limiter and strong per-function guards; both baseline HIGHs (bare CORS, open
  URL proxies) are untouched, and `resolve-login`'s pre-auth throttle is
  bypassable via a spoofed `X-Forwarded-For`.
- **Logging & SIEM:** 🔴 red — four real audit streams now exist where there
  were none, but there is no SIEM, shipper, cross-environment aggregation or
  alerting; sign-in, MFA and operator-console access are unlogged; and
  privilege changes are captured by nothing.
- **Content Handling:** 🟡 yellow — a genuine cloud lifecycle with certified
  disposal and certificates that outlive their subject, undercut by no
  watermarking, no `no-store` on content responses, no record of who ever
  downloaded an asset, and the Electron production media path sitting outside
  the lifecycle machine entirely.
- **Secure SDLC:** 🔴 red — the backdoor and default passwords are genuinely
  gone with the whole legacy auth module and `.gitignore` now covers every
  credential class actually present, but CI runs zero security scans and a live
  credential is in the public tree.
- **Incident Response:** 🔴 red — unchanged since baseline. No IR plan, no
  BCP/DR, no RTO/RPO, no security-awareness programme.
- **AI/ML:** 🟡 yellow — the baseline CRITICAL is genuinely fixed, no client
  holds a key, and the gateway logs zero prompt content; but OR-5.0's
  substantive controls (a written AI policy, per-client approval, redaction,
  bounded egress scope) remain unimplemented, so pre-release content still
  reaches a public model endpoint by default with no approval artifact.
- **Cloud:** 🟡 yellow — table-layer tenancy is now strong: RLS on every table,
  FORCE on 28 of them, pgTAP suites 01–36 gated in CI, and migration 0028's
  cross-tenant reader locked to `service_role` with privilege assertions inside
  the migration's own post-conditions. The gaps are a public avatars bucket and
  an over-broad operator policy that bypasses the guarded teardown path.
- **Physical:** 🟢 green (N/A) — permanent scope exclusion; WILSON controls no
  physical systems. Deliberately not re-opened.
- **Documentation:** 🔴 red — none of SECURITY.md, HARDENING.md,
  ACCESS_CONTROL.md, KEY_MANAGEMENT.md, LOGGING_AND_RETENTION.md,
  VENDOR_RISK.md or RISK_ASSESSMENT.md exists anywhere in the repo. Session
  16's planned systems handbook covers part of HARDENING's ground but is not a
  substitute for the set.
- **Third-Party:** 🔴 red — the weakest domain, and the only one that moved
  backwards. All three baseline findings are fully open, while fifteen sessions
  of rebuild tripled the sub-processor count and added a second, entirely
  unscanned Deno/esm.sh dependency universe.

## Blocking Controls for Gold Shield

Every Best Practice control carrying an open CRITICAL or HIGH:

1. **TS-1.14** (secure development / secrets) — TPN-SDLC-007, -008, -009
2. **TS-1.5** (logging & monitoring) — TPN-LOG-001 … -007
3. **TS-1.6** (authentication & MFA) — TPN-AUTH-002, TPN-AUTH-003
4. **TS-2** (network security) — TPN-NET-001, -002, -004
5. **TS-4.0** (third-party / supply chain) — TPN-3P-001, -003, -004, -005,
   TPN-SDLC-003
6. **AS-2.5** (key management) — TPN-ENC-002
7. **AS-3.6** (encryption at rest) — TPN-ENC-002
8. **AS-3.7** (content transfer / links) — TPN-CONT-001, TPN-CONT-003
9. **AS-3.8** (session & access control) — TPN-AUTH-004, TPN-NET-004
10. **AS-3.14** (forensic watermarking) — TPN-ENC-005, TPN-CONT-005
11. **AS-3.15** (content lifecycle) — TPN-CONT-006, -007, -008, -009, -011
12. **CS-1.13** (cloud configuration) — TPN-CLOUD-004 (TPN-CLOUD-003 closed 2026-07-30)
13. **OR-1.1 / OR-1.2** (incident response, BCP/DR) — TPN-IR-001, TPN-IR-002
14. **OR-3.4** (vendor risk) — TPN-3P-003
15. **OR-5.0** (AI/ML) — TPN-AI-001, TPN-AI-004, TPN-AI-005
16. **Documentation set** — TPN-DOC-001, -002, -003

## Path Forward

Two things before anything else, and neither is a feature:

1. **Rotate the `smoke_admin` password** and update the `DEV_PROBE_PASSWORD`
   secret (`docs/OWED_AUDREY.md` §0). While you are there, decide whether the
   CI probe needs `admin` at all — a `user`-role probe proves the same things
   and retires the whole class of problem.
2. **Add an audit trigger to `workspace_members`.** One migration, and it
   closes the second CRITICAL.

After that, the highest-leverage work is organizational rather than technical.
The six policy documents and a dependency-scanning step in CI would move three
red domains at once, and neither depends on product code — which makes them
well suited to the documentation session that follows this one.

> To apply fixes, invoke the `tpn-compliance-implementation` skill and point it
> at `TPN_AUDIT/REMEDIATION_PLAN.md`.
