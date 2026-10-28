# TPN Compliance Audit — Summary

- **Project:** WILSON (Petal Studios)
- **Repo path:** `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON`
- **Audit date:** 2026-07-30 — **re-audit**; baseline 2026-04-15, committed at `1ce18ec`
- **Auditor:** Claude (tpn-compliance-audit skill, version 1)
- **MPA CSBP version:** 5.3 / 5.3.1
- **Audit mode:** standard (the nine code-bearing domain passes re-run in full;
  Physical remains a permanent scope exclusion, and Incident Response and
  Documentation are policy-only with no code to re-resolve)

## Release gate — the scoped re-audit of 2026-10-28

**0 Critical and 11 High open in the four areas** (the file gateway, bins, own storage, the AI file store). This is the line
`docs/sessions/PLAN_TO_1_0.md` §0 item 4 reads; the item, verbatim: "4. The release steps in §6 are done: hers in the browser, then
the controller's on production, after the TPN re-audit reports nothing High." Walkthrough 85 Q1 and Q2 propose to Audrey that her
ruling on each finding below (fixed before 1.0, or accepted for 1.0 with the reason written into the finding) stand for "nothing
High"; that is R2's proposal, not the plan's text, and until she rules the controller's production steps wait.

**Q1 ruled on 2026-10-28** (Audrey, in chat, verbatim): *"(a) — one session fixes the other seven before the release (Phase 8),
and I accept TPN-AI-009 for the start of the production steps, since it closes at the runbook's (c) and (g) 17 before 9 November."*
So items 1 to 7 below are fixed before the release by one session on Phase 8 of `REMEDIATION_PLAN.md`, which the controller names
(`docs/sessions/PLAN_TO_1_0.md` §5 rule 8), and item 8 is accepted for the start of the production steps, her reason in its block.
No severity changes: the seven stay open until that session's fixes are verified, and TPN-AI-009 until the runbook's steps close it.
**Q2 ruled the same day** (in chat, multiple choice, verbatim: *"(a) Count and fix them"*): items 9 to 11 stay counted and are fixed
by the same session, so it fixes ten and item 8 is the one accepted. When its ten fixes are verified, the only High left open in
the four areas is TPN-AI-009. She named neither near case below, so both stay uncounted unless she says otherwise.

*The areas' own defects (8):*

1. **[TPN-AUTH-012]** The file gateway serves any path a member catalogues, so a catalogue write reads the share —
   `supabase/migrations/0091_bins_on_the_cloud.sql:750-757` (with `:667-690`, `:758-771`; the check at
   `0095_gateway_next_root_viewing_fraction.sql:347-351`)
2. **[TPN-NET-016]** Edge Functions fetch an admin's S3 endpoint with no private-address refusal, following redirects —
   `supabase/functions/_shared/s3Presign.ts:103-118`; `supabase/functions/storage-secret/index.ts:186`
3. **[TPN-ENC-015]** The bucket-secret and AI-key master secrets are identical on dev, staging and production —
   `supabase/functions/_shared/storageSecretCrypto.ts:27`; `docs/OWED_AUDREY.md` §9 C2
4. **[TPN-ENC-014]** The gateway keeps its credentials and keys in plaintext in the container and after a DPAPI failure —
   `gateway/src/platform/secrets.mjs:72,82,86`
5. **[TPN-CONT-018]** Workspace teardown never collects bin posters: frames of the tenant's footage stay, unrecorded —
   `supabase/functions/operator-workspaces/index.ts:364-428, 1254-1263`; `supabase/migrations/0091_bins_on_the_cloud.sql:582-622`
6. **[TPN-ENC-013]** The gateway's office-door certificates name private (RFC 1918 / unique-local) addresses —
   `gateway/src/certs/x509.mjs:170-171`
7. **[TPN-ENC-016]** The gateway's root key lives ten years on its host, and its release key has no successor —
   `gateway/src/certs/x509.mjs:47`; `gateway/src/update/manifest.mjs:52`
8. **[TPN-AI-009]** Pre-FX12 AI-file uploads on staging and production never expire and soon cannot be attributed —
   `docs/OUTSTANDING.md` FX12-01; production lacks `ai-files`' and `operator-ai-files`' FX12 copies. It closes by the release's
   own steps (`docs/PRODUCTION_RUNBOOK.md` (c) and (g) 17) and her sweep on staging, so it cannot be fixed before the production
   steps start: walkthrough 85 Q1 asked her to accept it for their start, and she did on 2026-10-28.

*The areas' own instances of this pack's open classes (3),* each a choice in the areas' own code, where the same areas do more next
door, and rated as its class is:

9. **[TPN-AUTH-013]** The outside switch, the gateway's admin calls and the bucket settings skip the two-factor step-up
   (TPN-AUTH-003's class; `storage-secret` and `storage-gc` in the same areas take it) —
   `supabase/migrations/0093_file_gateway.sql:591-603`; `0048_workspace_storage.sql:137-163`
10. **[TPN-CONT-019]** The desktop's bin clip streams are served with no Cache-Control: no-store (TPN-CONT-003; the gateway's own
    responses carry it) — `electron/rabbitBins.cjs:1057, 2327`
11. **[TPN-AI-011]** ai-files falls back to the platform key, silently, whenever a company's own key fails to open (TPN-AI-005's
    class; `storage-presign` in the same areas fails closed) — `supabase/functions/ai-files/index.ts:102-121`

- **Scope.** The four areas' own code, read at `51e5a0d7` on 2026-10-28 (R2, night 4, report only, her answer of 2026-10-27): the
  file gateway (`gateway/`, the five `gateway-*` functions, 0093, 0095, `docs/gateway/HARDENING.md`); bins (0091, `views/bins/`,
  `adapters/gatewayBins.js`, `electron/rabbitBins.cjs`, the posters); own storage (`storage/`, `storage-presign`,
  `storage-secret`, `storage-gc`, 0048 to 0054, `StorageConnections.jsx`, `StorageSection.jsx`); the AI file store (`ai-files`,
  `operator-ai-files`). The twelve passes ran on them; Physical is N/A, and AI/ML is N/A for the gateway and bins.
- **Not in the snapshot.** P1's `storage-read-urls` and `_shared/readUrls.ts`, own storage's GET-only batch signer for an s3
  workspace's previews, merged at `d9f1981e`, after `51e5a0d7`, and were not audited. A read of their imports finds no
  server-side fetch to a company's host (they sign GET URLs for the browser), so TPN-NET-016's class does not reach them; the rest
  is the next audit's, and this gate's count does not cover them.
- **The rule for what the gate counts.** A gap is the areas' own when it is a choice in their own code: the eight above, and the three
  instances, where the areas did less than the same areas do next door (the step-up storage-secret takes, the no-store the gateway
  sends, storage-presign's refusal to re-route). Product-wide controls the areas only inherit keep this pack's single findings and
  ratings and are not counted here: TPN-LOG-001 (no SIEM), TPN-ENC-005 and TPN-CONT-005 (no forensic watermark; the gateway draws a
  visible name), TPN-3P-004 and TPN-3P-007 (`supabase-js` from esm.sh, the gateway's `_shared/gatewayGuard.ts` included),
  TPN-SDLC-003 and TPN-3P-001 (no SAST, SCA, image scan or SBOM in any workflow, the gateway's two included), TPN-NET-009 (`*`
  CORS), TPN-CLOUD-002 (no per-tenant key), TPN-AUTH-002 (two-factor enrolment optional), TPN-AUTH-004 (revocation), TPN-CONT-001
  (the desktop's stable download path; in the areas, S3 presigns live 300 s and 900 s, poster URLs an hour, and a gateway clip URL
  two minutes, renewed for up to four hours), TPN-ENC-002's Drive half.
- **Her rulings.** Two gaps in the areas are hers, filed INFO by the rubric's rule for an intentional, documented exception, and
  still blocking Gold: TPN-LOG-012 (office reads are not logged, her G6 of 2026-10-09) and TPN-SDLC-014 (the gateway's MSI ships
  unsigned, her D14 of 2026-10-11). Neither is in the gate.
- **Considered and not counted** (walkthrough 85 Q2 let her overrule either; she named neither): storage-presign signs reads and writes and keeps no
  record of its own, where gateway-ticket records each mint; the product's record of a direct-served read is the client's
  `downloaded` event, advisory by a documented limit (`docs/SYSTEMS_HANDBOOK.md` §17: "`downloaded` is advisory for every
  direct-served provider"), so it stays TPN-LOG-002's. And the desktop's bin streams write no `downloaded` event where the
  desktop's file stream does (`electron/main.cjs`, the S40 throttle): a play inside the office, close to her G6.
- **Also found there:** 8 MEDIUM (TPN-AUTH-010, TPN-CONT-016, TPN-CONT-020, TPN-SDLC-013, TPN-AI-008, TPN-AI-010, TPN-DOC-004,
  TPN-DOC-005), 1 LOW (TPN-SDLC-012), 4 INFO (TPN-NET-012, the gateway's four conditions built and its residual disclosed;
  TPN-NET-014, a credit; TPN-LOG-012 and TPN-SDLC-014, her rulings) and 7 RESOLVED (TPN-AUTH-011, TPN-NET-013, TPN-NET-015,
  TPN-CONT-017, TPN-CLOUD-007, TPN-CLOUD-008, TPN-3P-010), all from the 2026-08-05 design review. Its TPN-AUTH-008 and TPN-AUTH-009
  collided with this pack's and are TPN-AUTH-010 and TPN-AUTH-011.
- **Rated after two adversarial review rounds** (read-only, both on Opus 5.5: round 1's Fable calls were refused, out of usage
  credits, and round 2 went to Opus directly). Round 2 moved TPN-LOG-012 to INFO (her G6), TPN-SDLC-013 and TPN-DOC-004 to
  MEDIUM and TPN-ENC-016 to HIGH, widened TPN-AUTH-013 to the bucket settings, and opened TPN-AI-011.
- **The pack outside the four areas was not re-verified.** Read across everything it counts 3 Critical and 54 High, and three of
  those open entries are said fixed in their own prose or by later work: TPN-LOG-005 (CRITICAL) by 0030 (S17), TPN-NET-001 by Track
  B's B3, TPN-NET-004 by Track B's B1. A full re-audit would close them; this one does not re-rate outside its areas, so this file's
  sections below are the 2026-07-30 audit's.
- **Credits** worth carrying into a studio conversation: the gateway's TLS floor and headers (no-store, HSTS, nosniff), its signed
  two-minute one-clip tickets, its signed updates, its least-privilege service account and distroless container, the outside switch
  off by default with its TPN sentence at the control, and the outside door's viewing record; storage-presign as an authorisation
  boundary (a live member, a rate limit, row-shaped paths, money and Legal never signed, the caller's own RLS); AES-256-GCM bucket
  secrets in a table no client reaches; the AI file store's delete routes, sweeps and neutral file names.


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
| HIGH | 54 |
| MEDIUM | 39 |
| LOW | 9 |
| INFO | 5 |
| RESOLVED | 13 |
| N/A | 1 |

**Total: 124 on 2026-10-28** (the release gate above). At the 2026-07-30 re-audit it was 92 — 44 carried from the baseline, 48 opened by that re-audit. A
further 5 re-audit findings were merged into an existing ID as the same defect
seen from a second domain pass.

> **Recount, 2026-10-28.** Track B added TPN-AUTH-009 (LOW, 2026-09-06) without updating this table, so `FINDINGS.md` held 93
> before the scoped re-audit, which opened twenty and merged the 2026-08-05 design review's eleven. The table is recounted from
> `FINDINGS.md`, the source of truth; outside the four areas its ratings are the 2026-07-30 audit's.

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

*(2026-10-28: no colour changes. The scoped re-audit's eleven HIGHs land in Encryption, Authentication, Network, Content and
AI/ML, which were yellow or red already, and it opened no CRITICAL.)*

## Blocking Controls for Gold Shield

Every Best Practice control carrying an open CRITICAL or HIGH:

1. **TS-1.14** (secure development / secrets) — TPN-SDLC-007, -008, -009
2. **TS-1.5** (logging & monitoring) — TPN-LOG-001 … -007, TPN-LOG-012 (2026-10-28, her G6)
3. **TS-1.6** (authentication & MFA) — TPN-AUTH-002, TPN-AUTH-003, TPN-AUTH-013 (2026-10-28)
4. **TS-2** (network security) — TPN-NET-001, -002, -004, -016 (2026-10-28)
5. **TS-4.0** (third-party / supply chain) — TPN-3P-001, -003, -004, -005,
   TPN-SDLC-003, TPN-SDLC-014 (2026-10-28, her D14)
6. **AS-2.5** (key management) — TPN-ENC-002, TPN-ENC-014, TPN-ENC-015, TPN-ENC-016 (2026-10-28)
7. **AS-3.6** (encryption at rest) — TPN-ENC-002, TPN-ENC-014 (2026-10-28)
8. **AS-3.7** (content transfer / links) — TPN-CONT-001, TPN-CONT-003, TPN-ENC-013, TPN-CONT-019 (2026-10-28)
9. **AS-3.8** (session & access control) — TPN-AUTH-004, TPN-NET-004
10. **AS-3.14** (forensic watermarking) — TPN-ENC-005, TPN-CONT-005
11. **AS-3.15** (content lifecycle) — TPN-CONT-006, -007, -008, -009, -011, -018 (2026-10-28)
12. **CS-1.13** (cloud configuration) — TPN-CLOUD-004 (TPN-CLOUD-003 closed 2026-07-30)
13. **OR-1.1 / OR-1.2** (incident response, BCP/DR) — TPN-IR-001, TPN-IR-002
14. **OR-3.4** (vendor risk) — TPN-3P-003
15. **OR-5.0** (AI/ML) — TPN-AI-001, TPN-AI-004, TPN-AI-005, TPN-AI-009, TPN-AI-011 (2026-10-28)
16. **Documentation set** — TPN-DOC-001, -002, -003
17. **TS-1.7** (RBAC on content, 2026-10-28) — TPN-AUTH-012

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
