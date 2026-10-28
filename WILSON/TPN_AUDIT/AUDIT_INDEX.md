---
project: WILSON
repo_path: C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON
audit_date: 2026-07-30
scoped_reaudit_date: 2026-10-28
baseline_audit_date: 2026-04-15
baseline_commit: 1ce18ec
csbp_version: 5.3.1
mode: standard
schema_version: 1
shield_eligibility: None
total_findings: 114
critical: 3
high: 47
medium: 38
low: 9
info: 2
resolved: 14
not_applicable: 1
total_phases: 9
---

# Audit Index

| File | Purpose |
|---|---|
| SUMMARY.md | Narrative summary + posture |
| FINDINGS.md | All findings with YAML frontmatter per finding |
| RECOMMENDATIONS.md | Remediation patterns grouped by theme |
| REMEDIATION_PLAN.md | Phased plan — main input to tpn-compliance-implementation |
| LEARNINGS.md | Takeaways Claude should remember across audits |

> **Re-audit note (2026-07-30).** The 2026-04-15 counts in this file were
> wrong: the frontmatter said 40 findings / 9 CRITICAL / 21 HIGH / 8 MEDIUM
> while `FINDINGS.md` held 44 / 10 / 25 / 7 / 1 LOW / 1 N/A. The counts above
> are recomputed from `FINDINGS.md`, which is the source of truth. Baseline IDs
> were neither renumbered nor removed; closed ones carry `severity: RESOLVED`
> plus a `resolved_date`, and every baseline finding gained a re-audit verdict
> in the prose block beneath its YAML.

## Phase quick-view

| Phase | Title | Findings | Effort | Status |
|---|---|---|---|---|
| 0 | 🚨 Credential rotation + privilege audit | TPN-SDLC-007, TPN-LOG-005 | S | not started |
| 1 | Foundations: secrets, logger, CI | TPN-SDLC-001..006, TPN-LOG-001, TPN-LOG-003, TPN-LOG-004, TPN-ENC-001, TPN-ENC-002, TPN-3P-001 | M | in progress — ENC-001 and SDLC-001 complete; logger and CI scanning outstanding |
| 2 | Encryption hardening | TPN-ENC-003, -004, -006, -007, -010, -011 | L | in progress — ENC-003 complete; Google-token storage and transport headers outstanding |
| 3 | Auth, session, RBAC | TPN-AUTH-001..007, TPN-NET-003 | L | in progress — AUTH-001 and AUTH-005 complete; MFA enforcement and revocation latency outstanding |
| 4 | Network boundary + Cloud | TPN-NET-001, -002, -004..011, TPN-CLOUD-001..006 | M | not started |
| 5 | Content lifecycle + watermarking + AS-2.9 | TPN-CONT-001..015, TPN-ENC-005, TPN-LOG-002 | XL | in progress — cloud lifecycle and certified disposal complete; watermarking, read-side audit and the Electron media path outstanding |
| 6 | AI/ML controls | TPN-AI-001..007 | L | in progress — the gateway exists; policy, approval and redaction outstanding |
| 7 | Docs + policies | TPN-DOC-001..003, TPN-IR-001..003, TPN-3P-003 | M | not started |
| 8 | The four areas: gateway, bins, own storage, AI file store (scoped re-audit 2026-10-28) | TPN-AUTH-012, TPN-NET-016, TPN-CONT-018, TPN-ENC-013 (the release gate's four HIGHs); TPN-AUTH-010, TPN-ENC-014, TPN-CONT-016, TPN-AI-008..010, TPN-DOC-004, TPN-SDLC-012 | M | not started |
| X | 3P / CVE triage (continuous) | TPN-3P-001, -002, -004..009 | M | not started |

## Status legend

`not started` | `in progress` | `blocked` | `complete` | `deferred`

The implementation skill updates the Status column as work proceeds. Do not delete this table.

## What changed at the 2026-07-30 re-audit

Sessions 1–15 rebuilt WILSON from an offline single-user Electron app into a
cloud-first multi-tenant platform. The re-audit re-resolved every baseline
location before adjudicating, because most line references had gone stale and
several controls turned out to be satisfied by a **different mechanism** than
`REMEDIATION_PLAN.md` prescribed — an `ai-proxy` Edge Function rather than a
local `aiGateway.ts`, Supabase RLS and workspace roles rather than local RBAC
middleware, `app_events`/`file_events` rather than pino plus a SIEM shipper.
Grepping for the plan's prescribed artifact names would have produced false
"still open" verdicts throughout.

| Verdict | Count |
|---|---|
| RESOLVED | 6 |
| PARTIALLY REMEDIATED | 19 |
| STILL OPEN | 13 |
| Not re-assessed (policy-only: IR ×3, DOC ×3) | 6 |
| N/A (permanent Physical exclusion) | 1 |
| **New findings opened** | **48** (one, TPN-CLOUD-003, fixed before the session ended) |

## What changed at the 2026-10-28 scoped re-audit

Four areas only, report only: the file gateway, bins, own storage, the AI file store (`SUMMARY.md`, *Release gate*). Counts are
recounted from `FINDINGS.md`: 93 before (the frontmatter said 92; Track B's TPN-AUTH-009 of 2026-09-06 was never counted), 114
after.

| Verdict | Count | IDs |
|---|---|---|
| Opened | 10 | TPN-AUTH-012, TPN-NET-016, TPN-CONT-018, TPN-ENC-013 (HIGH); TPN-ENC-014, TPN-AI-008, -009, -010, TPN-DOC-004 (MEDIUM); TPN-SDLC-012 (LOW) |
| Merged from `DESIGN_REVIEW_network_storage.md`, still open | 3 | TPN-AUTH-010 (was the review's TPN-AUTH-008), TPN-CONT-016 (MEDIUM); TPN-NET-014 (INFO) |
| Merged from the review, RESOLVED | 8 | TPN-NET-012, -013, -015, TPN-3P-010, TPN-AUTH-011 (was the review's TPN-AUTH-009), TPN-CONT-017, TPN-CLOUD-007, -008 |
| Re-rated outside the four areas | 0 | — |
