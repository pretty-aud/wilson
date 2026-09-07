# TPN Design Review — Network & remote storage access

- **Project:** WILSON (Petal Studios)
- **Repo path:** `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON`
- **Review date:** 2026-08-05
- **Auditor:** Claude (tpn-compliance-audit skill, version 1)
- **MPA CSBP version:** 5.3 / 5.3.1
- **Audit mode:** scoped — **design review, not a re-audit**
- **Subject:** `docs/NETWORK_STORAGE_DESIGN.md` (Options A–E, Phases 0–2)
- **Passes run:** Network, Content Handling, Authentication, Cloud, Third-Party

> **This file deliberately does NOT follow the six-file output contract.**
> `TPN_AUDIT/` already holds the full 2026-07-30 re-audit (92 findings, the
> baseline the remediation programme is built on). Writing `SUMMARY.md`,
> `FINDINGS.md` et al. for a five-pass design review would have destroyed it.
> New finding IDs below continue the existing sequences and are safe to merge
> into `FINDINGS.md` at the next full re-audit. `LEARNINGS.md` has been appended
> to, per the contract's append-only rule.

---

## Verdict

**The recommended path (Phase 0 → Phase 1 / Option B → Option C) is the only one
of the five that TPN's remote-access control actually endorses.** That is not a
close call and it is not a matter of effort — see TPN-NET-012.

Options B and C add **zero** internet-facing surface, and framework §7 says to
give credit for exactly that. Options D and E each open a new content path, and
Option E opens one through infrastructure Petal Studios would operate.

Nothing in the design is approved to build. Six new findings, five escalations.

## Finding counts (this review only)

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 6 |
| MEDIUM | 4 |
| INFO | 1 |

Zero CRITICALs because most of this is unbuilt — **but two HIGHs are live in the
shipped product today**, not conditional on any build decision:

- **TPN-AUTH-009** — the storage-root control has no permission gate at all.
  Blast radius is currently small because the setting is per-machine; Phase 1
  widens it to the whole tenant if the gate does not ship alongside.
- **TPN-NET-015** — `projects.folder_root` is written straight from the request
  body with no containment check, on an unauthenticated local API.

Both were surfaced by Audrey specifying a permission model, not by the passes
looking for them — a reminder that "who is allowed to set this" is a question
worth asking of every configuration surface, not only the obvious ones.

Every other HIGH is conditional on a build decision, which is the point of
reviewing before implementation.

---

## Option-by-option assessment

| Option | External surface added | TPN posture | Verdict |
|---|---|---|---|
| **A** — cloud mode | none (already assessed) | 🟢 strongest available | ⚠️ Needs a raised cap + resumable uploads to carry multi-GB. Fixable, and **required** — a cloud customer has no fallback |
| **B** — UNC + workspace root, LAN only | **none** | 🟢 neutral-to-positive | ✅ **Recommended.** Prerequisite for C and D |
| **C** — VPN | none in WILSON | 🟢 **this is the named control** | ✅ **Recommended** wherever the customer will run one |
| **D** — WILSON File Gateway | new internet-facing content service | 🟡 bounded — see amended TPN-NET-012 | ⚠️ **Probably unnecessary — see design §4c.** Only for a customer who has refused NAS, VPN, own-cloud and Petal cloud |
| **F** — customer's **NAS** ⭐ | none in WILSON | 🟢 **best available for the remote case** | ✅ **Recommended.** The NAS is the always-on server; its own VPN/relay handles remote. Phase 1 covers it entirely |
| **E** — reverse tunnel / hosted relay | new content-bearing sub-processor | 🔴 worst available | ❌ **Rejected** |

> **Amended 2026-08-05.** Audrey confirmed multi-GB media and that a VPN is not
> universally available (putting D in scope). D does not become a TPN violation
> — her requirement scoped it to *"a company that does NOT need TPN compliance"*
> from the first sentence. See the amendment under TPN-NET-012.
>
> ⭐ **Third amendment, same day — the NAS route (F), and it is the best outcome
> for this review.** Audrey: *"as long as the end user company has their own NAS
> drive it can be accessed 24/7."* A NAS presents as the same UNC share Phase 1
> already supports, and prosumer NAS boxes ship a **built-in VPN server** and a
> vendor relay as configuration rather than a project. So the customer who
> *"won't set up a VPN"* can still reach content over a VPN their NAS provides —
> which lands them back on the control TS-2 actually names. **The route with the
> best TPN posture and the route requiring the least work are now the same
> route**, and Option D loses most of its justification. The gateway should not
> be built without a named customer who has refused all four alternatives.
>
> ⚠️ Two conditions on F: the root must be stored as a **UNC path**, not a mapped
> drive letter (§3.3) — some vendor sync clients only surface a drive letter, so
> confirm against a real box first — and a **vendor relay** (QuickConnect,
> myQNAPcloud) puts the NAS vendor in the content path. That is the customer's
> own sub-processor decision to disclose in their assessment, **not Petal's** —
> materially unlike Option E, where the relay would be Petal's.
>
> ⚠️ **Second amendment, same day — a correction.** This review initially recorded
> A as "cannot carry multi-GB at any cap". That was wrong: it generalised a
> **Local Server** measurement to the **Supabase** adapter, which is different
> code and hands the `File` straight to Storage
> (`supabaseAdapter.js:970-975`). Cloud's ceiling is the bucket's
> `file_size_limit`, which is raisable. Audrey found it by asking what a
> cloud-only customer is supposed to do.
>
> **This has a security consequence, which is why it is recorded here and not
> only in the design.** Raising the cap and adding resumable uploads changes the
> content path: chunked uploads land partial objects, and a resumed or abandoned
> upload leaves fragments the lifecycle vocabulary
> (`uploaded/moved/relinked/trashed/restored/purged`) cannot describe. See
> **TPN-CONT-017**.

---

## New findings

### TPN-NET-012 — A bespoke internet-facing file gateway (Option D) contradicts the bastion-only remote-access control

```yaml
id: TPN-NET-012
severity: HIGH
control: TS-2
domain: network
title: Option D's internet-facing gateway conflicts with the bastion/VPN-only remote access control
location: docs/NETWORK_STORAGE_DESIGN.md (structural — Option D)
evidence: |
  Design, Option D: "A headless service the company installs on their server:
  terminates TLS, verifies a Supabase Auth JWT, maps workspace membership onto
  filesystem access, serves ranged reads out of the UNC root."
required: |
  MPA CSBP v5.3, remote access under TS-2: "Bastion host model only. VPN with
  AES-256. No split tunneling. VNC is explicitly banned. Only Citrix or RDP via
  gateway." TS-2.x additionally requires that production/content networks carry
  no internet access, and TS-2 requires default-deny at every boundary.
gap: |
  Option D publishes an HTTP service that reads directly from the content store
  on the content network. That is neither a bastion host nor a VPN; it is a
  direct external path to content, which is the specific arrangement the control
  exists to forbid. Option C (VPN into the LAN, WILSON unchanged) satisfies the
  same user requirement and IS the named control.
effort: XL
blocks_tier: Gold
recommendation_ref: RECO-NET-BASTION
```

**Notes.** This finding is the reason the design recommends C over D, and it
should be quoted verbatim if a **TPN-track** customer ever pushes for D. "We
built our own gateway instead of using a VPN" is a finding an assessor will
write up; "remote users reach content over the corporate VPN" is the answer the
framework asks for.

> ⚠️ **AMENDED 2026-08-05, after Audrey's answers.** She confirmed a VPN is not
> universally available — *"some may not want to setup a VPN"* — so Option D is
> **in scope**, and this finding is **re-scoped rather than withdrawn**.
>
> It does not become a violation, because the gateway was correctly bounded in
> her original requirement: *"a company that does **NOT** need TPN compliance."*
> TS-2 is breached by a Gold-seeking customer enabling external access, not by
> the capability existing. The finding therefore converts from a prohibition
> into **four conditions**, all of which are now design requirements (see
> `docs/NETWORK_STORAGE_DESIGN.md` §4b):
>
> 1. `external_access_enabled` defaults to **false**; an untouched workspace is
>    on the compliant path.
> 2. **The toggle is the compliance boundary and must say so at the control** —
>    enabling it is the moment the workspace leaves Gold eligibility. Surfacing
>    that in the UI is now the finding's primary remediation.
> 3. The gateway is never documented or sold as TPN-compliant; a TPN-track
>    customer is steered to VPN or single-computer.
> 4. A workspace with the toggle **off** must be provably identical to one where
>    the gateway does not exist — the LAN path may not be weakened to support it.
>
> Severity stays HIGH: these conditions are unbuilt, and if the gateway shipped
> without condition 2 the product would be quietly selling a non-compliant
> configuration to customers who may not know they need compliance.

### TPN-3P-010 — A hosted relay (Option E) makes Petal Studios a content-bearing sub-processor in the audit's weakest domain

```yaml
id: TPN-3P-010
severity: HIGH
control: OR-3.4
domain: third_party
title: Option E routes pre-release content through Petal-operated relay infrastructure
location: docs/NETWORK_STORAGE_DESIGN.md (structural — Option E)
evidence: |
  Design, Option E: "WILSON dials out to a relay; remote clients reach the
  relay." Pre-release content transits that relay in both directions.
required: |
  OR-3.4 requires vendor-risk management and BCP/DR provisions in third-party
  contracts. Any party that content transits is a sub-processor and must be
  disclosed, risk-assessed and contracted. CS-1.13 requires AES-256 on stored
  content and key/data separation.
gap: |
  Third-Party is already the weakest domain in the 2026-07-30 baseline: 🔴 red,
  all three baseline findings fully open, and the only domain that moved
  BACKWARDS. Option E would add Petal Studios itself to every customer's
  sub-processor list for their pre-release content, plus the relay's own
  hosting provider — creating disclosure, contractual and DR obligations that
  do not exist today, against the domain least able to absorb them.
effort: XL
blocks_tier: Gold
recommendation_ref: RECO-3P-CVE
```

**Notes.** Recommend recording Option E as **rejected on TPN grounds** in the
design so it is not rediscovered as a clever idea in a later session.

### TPN-AUTH-008 — A JWT-trusting gateway inherits the existing unrevocable-session gap

```yaml
id: TPN-AUTH-008
severity: HIGH
control: AS-3.8
domain: authentication
title: Option D's JWT verification would let a demoted or removed user keep file-server access until token expiry
location: docs/NETWORK_STORAGE_DESIGN.md (structural — Option D) + TPN-AUTH-004
evidence: |
  Design, Option D: "verifies a Supabase Auth JWT, maps workspace membership
  onto filesystem access."
  Baseline SUMMARY.md, Authentication: "two revocation paths (admin demotion,
  workspace suspension) do not take effect until a token expires."
required: |
  AS-3.8: sessions must re-authenticate after 4 hours, rotate session IDs on
  privilege change, and support immediate revocation. Access removal must take
  effect on the content path when it takes effect anywhere.
gap: |
  Today that gap is bounded: revocation lag applies to a Postgres session whose
  every read is still re-checked by RLS at query time, so a demoted user loses
  row access immediately even while holding a valid token. A filesystem gateway
  has no RLS. If it authorizes from claims inside the JWT, a user removed from
  the workspace keeps reading content off the share until the token expires —
  converting a bounded gap into unsupervised content access.
  Any gateway must therefore re-check membership against the database per
  request, not trust the token's claims.
effort: L
blocks_tier: Gold
recommendation_ref: RECO-AUTH-SESSION
```

### TPN-AUTH-009 — The storage-root control has no permission gate; any member can repoint it

```yaml
id: TPN-AUTH-009
severity: HIGH
control: TS-1.7
domain: authentication
title: StorageConnections imports usePermissions but never gates on role — any user can set the content root
location: src/components/settings/StorageConnections.jsx:46,104,106
evidence: |
  15: import { usePermissions } from '../../permissions'
  46: const perms = usePermissions()
  104: <Card icon={Cloud} title="Supabase (company cloud)" connected={!!perms.workspaceId}>
  106:   {perms.workspaceId
  // perms is read exactly twice, both for a display label. No role check
  // anywhere; the "Choose folder" / "Change" buttons that write
  // defaultRootDir are reachable by a `user`-role member.
required: |
  TS-1.7 requires RBAC/ABAC enforcement on privileged configuration. Deciding
  where a workspace's content is stored is privileged configuration: it selects
  the location of every asset the tenant owns.
gap: |
  The permission hook is imported, which makes the file read as gated on a
  skim, and nothing is gated — the same shape as the ungated TimelineView
  closed in S29. Impact is currently limited because the root is per-machine
  (files-config.json), so a member repointing it affects only their own
  computer. Phase 1 of the design makes the root workspace-wide, at which point
  the identical ungated button lets any member repoint the entire company's
  media — including onto a path the rest of the team cannot reach.
  Audrey specified the fix before this review found the cause:
  "do not let a base user have access to setup paths only managers."
effort: S
blocks_tier: Gold
recommendation_ref: RECO-AUTH-RBAC
```

**Notes.** Gate in RLS on `workspace_storage` (`current_app_role() IN
('admin','manager')`, the pattern already used by 0012/0013), mirrored in the UI.
**The gate must ship in the same phase as the shared root** — shipping the shared
root first would widen this finding from per-machine to per-tenant. Handle
`ready`, or a real manager sees the control disabled while their role resolves.

### TPN-NET-015 — `projects.folder_root` is written from the request body and validated against nothing

```yaml
id: TPN-NET-015
severity: HIGH
control: AS-2.3
domain: network
title: A project's storage root is taken from the request body with no containment check
location: electron/main.cjs:1431,1455
evidence: |
  // create
  folder_root: req.body.folder_root || null,
  // patch
  bundle.project = { ...bundle.project, ...req.body, id: bundle.project.id };
required: |
  AS-2.3 requires applications to operate within their intended privilege and
  path boundary. A per-project storage root selects where that project's
  content is written and read; it must be constrained to the storage area the
  workspace administrator configured.
gap: |
  Both routes accept an arbitrary absolute path. The project's content root can
  therefore be pointed anywhere the WILSON process can reach — outside the
  configured storage area, at another project's folder, or at an unrelated
  system directory, whereupon ensureProjectFolders creates a tree there and
  uploads write into it.
  The codebase already knows this is dangerous one function away:
  isUserAuthorizedRelinkDir (main.cjs:1345) exists precisely because "a
  body-picked baseDir would let a drive-by request point a project's files at,
  say, the user's Documents and read/unlink there" (S14). That reasoning applies
  verbatim here, and this route never got the guard.
  Reachable today by any caller of the local API, which is unauthenticated
  (TPN-NET-001).
effort: S
blocks_tier: Gold
recommendation_ref: RECO-NET-SEG
```

**Notes.** Audrey's permission model depends on closing this. She specified
*"admins can set server/drive. managers can set folders within set drive. this
stops anyone from breaking it."* The "within" is not enforceable while
`folder_root` accepts any absolute path — a manager, or anything that can reach
the local API, could set a project root outside the admin's drive and the
admin's choice would be advisory. **Containment-check `folder_root` against
`workspace_storage.root_path` using the same resolver that guards individual
files, one level up.** Fix alongside Phase 0's guard repair — they are the same
bug class at two scopes.

### TPN-CONT-017 — Resumable uploads will create partial objects the lifecycle vocabulary cannot describe

```yaml
id: TPN-CONT-017
severity: MEDIUM
control: AS-3.15
domain: content
title: Phase 2b's chunked/resumable uploads leave fragments outside the content lifecycle
location: supabase/migrations/0027_file_lifecycle.sql:85-86 (structural)
evidence: |
  event TEXT NOT NULL CHECK (event IN
    ('uploaded', 'moved', 'relinked', 'trashed', 'restored', 'purged')),
required: |
  AS-3.15 requires a formal content lifecycle with chain-of-custody covering
  receipt/creation through certified disposal. Every object holding content
  must be accounted for, including incomplete ones.
gap: |
  Raising the bucket cap for multi-GB media (design Phase 2b) requires
  resumable/TUS uploads. A resumable upload that is abandoned, interrupted or
  superseded leaves partial objects in the bucket. The vocabulary above has no
  term for them: they were never 'uploaded', so nothing certifies their
  disposal, and the storage_gc_queue is fed from files-row deletions that a
  fragment never had. A multi-GB abandoned upload is both a content fragment
  and a recurring bill.
effort: M
blocks_tier: Gold Star
recommendation_ref: RECO-CONT-LIFECYCLE
```

**Notes.** Cheapest correct answer: give the bucket a TTL sweep for incomplete
uploads and add an event term for the abandoned case, designed **with** Phase 2b
rather than after it. This is the same lesson as the `downloaded` event below —
lifecycle terms are almost never retrofitted once a feature ships working.

**Status (2026-09-06, Track C / migration 0073) — addressed on the
certification axis.** S42's first attempt (0057) metered a table WILSON's TUS
path never writes and was withdrawn by 0058 in the same session. 0073 replaces
it with a record WILSON does own: `public.upload_reservations` is written by
the client before every resumable upload starts, and
`sweep_abandoned_uploads()` writes one `file_events` `upload_abandoned` row per
reservation that expired (24 h, Supabase's own TUS URL expiry) unreleased with
no object landed — invoked by `storage-gc` per workspace on every cleanup and
by pg_cron hourly across all workspaces. The vocabulary term is back with a
writer (pgTAP suite 77, 53 probes, seven breakers; suite 66 probe 27 asserts
term and writer land together). **Stated limit, so the pack does not
overclaim:** the partial object itself remains un-enumerable from WILSON and is
disposed of by the platform's 24 h TUS expiry, so the certificate records that
the upload was *abandoned*, not that bytes were *destroyed* — the TPN pack
should state partial-upload disposal as the platform's control (AS-3.15,
chain-of-custody satisfied for receipt-through-abandonment; disposal
inherited). The same reservation row is what closes the concurrency hole in
the quota gate (`petal_storage_quota_insert` now weighs active reservations).
**Coverage limit (review round 1, 2026-09-06):** the certificate covers uploads
that never reached the client's release — a closed tab, a crash, the app quit
mid-upload — not an upload that failed with an error and released on the way
out; those rows stay queryable (`upload_reservations.outcome = 'released'` with
no object at the path) but carry no certificate. Whether a failed upload should
be certified at once is a ruling owed by Audrey (hand-off C1 §6); the pack
should describe the certificate's scope as "abandoned by the client without
release" until then.

### TPN-CLOUD-008 — A thumbnail bucket repeats TPN-CLOUD-004 if it is public or its policies are partially ported

```yaml
id: TPN-CLOUD-008
severity: HIGH
control: CS-1.13
domain: cloud
title: New rabbit-thumbnails bucket must be private and must port the invoice gate, or it leaks content frames
location: docs/NETWORK_STORAGE_DESIGN.md §5d.1 (structural) + supabase/migrations/0027_file_lifecycle.sql:283-340
evidence: |
  -- The pattern to copy, and the one to not get wrong:
  INSERT INTO storage.buckets (id, name, public, file_size_limit)
  VALUES ('rabbit-files', 'rabbit-files', false, 52428800)
  -- plus FOUR policies: three base + rabbit_files_invoices_select,
  -- which the adapter documents as a pair where "changing either
  -- without the other opens a hole" (supabaseAdapter.js:909-940).
required: |
  CS-1.13 requires multi-tenancy isolation at every layer and access controls on
  all cloud-stored content. A thumbnail of pre-release footage IS content — a
  recognisable frame of an unreleased title is precisely what the framework
  protects.
gap: |
  Two failure modes, both easy and both plausible:
  1. PUBLIC BUCKET. The instinct that thumbnails are small and harmless, so the
     bucket can be public for load speed. That is TPN-CLOUD-004 verbatim — the
     still-open CRITICAL where user-avatars is public with an unconditional
     SELECT policy, enumerable with the public anon key. Repeating it for
     content frames rather than avatars would be materially worse.
  2. PARTIAL POLICY PORT. Copying the three base policies and forgetting
     rabbit_files_invoices_select leaves invoice thumbnails readable by every
     project member — the money gate defeated by its own derived image, in the
     place nobody thinks to audit.
  Neither is a defect in the design as written; both are what happens if the
  bucket is created without reading 0027 first.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-CLOUD-PUBLIC
```

**Notes.** `public = false`, identical path layout to `rabbit-files` so all four
policies port by changing `bucket_id` alone, `file_size_limit` at 256 KB, and
pgTAP coverage mirroring `05_files` — including a probe that a non-manager
cannot read an invoice **thumbnail**. The separate bucket is the right call
(a bucket has one size limit, and media needs a large one), but a new bucket is
a new tenancy boundary and inherits nothing automatically.

### TPN-CONT-016 — The design does not specify SMB signing or encryption for the share

```yaml
id: TPN-CONT-016
severity: MEDIUM
control: AS-3.7
domain: content
title: UNC storage root is specified without a minimum SMB version, signing or encryption requirement
location: docs/NETWORK_STORAGE_DESIGN.md §5 Phase 1 (structural)
evidence: |
  Design, Phase 1: "A classifyRoot(p) helper returning local | unc | mapped"
  and a reachability probe. Neither states a transport requirement for the
  share itself.
required: |
  AS-3.7 requires TLS 1.2+ for data in transit; the equivalent guarantee for a
  Windows share is SMB 3.x with encryption enabled and signing required.
  SMB1 is a legacy protocol with no integrity guarantee and must be refused.
gap: |
  "Point WILSON at \\\\server\\share" says nothing about how the bytes cross the
  wire. On a default-configured share, pre-release content moves unencrypted
  and unsigned across the office LAN, which is precisely the plaintext-content-
  on-the-wire case the transit control addresses. WILSON cannot enforce the
  server's SMB configuration, but it can detect and warn, and the requirement
  must appear in the hardening guidance either way.
effort: S
blocks_tier: Gold Star
recommendation_ref: RECO-CONT-TRANSFER
```

**Notes.** Cheap to address: state SMB3 + encryption + signing as a documented
prerequisite in the storage setup guidance, and have the Phase 1 reachability
probe surface the negotiated dialect where Windows exposes it. Do not silently
accept SMB1.

### TPN-CLOUD-007 — `workspaces.storage_mode` is client-writable, unvalidated and unread, so a future reader inherits unvetted values

```yaml
id: TPN-CLOUD-007
severity: MEDIUM
control: TS-1.7
domain: cloud
title: storage_mode is admin-writable today with no reader and no guard, and would become live on first read
location: supabase/migrations/0001_workspaces_and_users.sql:29 + 0020_admin_grants_and_alignment.sql:438
evidence: |
  ALTER TABLE public.workspaces
    ADD COLUMN IF NOT EXISTS storage_mode   TEXT NOT NULL DEFAULT 'central',
    ADD COLUMN IF NOT EXISTS storage_config JSONB,
  -- workspaces_admin_update is FOR UPDATE over the whole row; the client guard
  -- fn_workspaces_client_guard protects only slug, id, created_at, deleted_at.
required: |
  TS-1.7 requires that authorization state be explicit and validated.
  Configuration that selects where content is stored is security-relevant and
  must not be settable through a path that performs no validation.
gap: |
  Measured on wilson-dev: all 4 workspaces are 'central', 0 rows have
  storage_config set, and grep across src/, electron/, supabase/functions/ and
  scripts/ finds ZERO readers. The column is nonetheless admin-writable and
  unguarded. Adding the first reader retroactively activates any value written
  before validation existed. This is the same class as the four "shipped with
  no caller" features already recorded for this codebase, with the added twist
  that this one is writable.
effort: XS
blocks_tier: Gold Star
recommendation_ref: RECO-CLOUD-PUBLIC
```

**Notes.** The design already declines to revive these columns and proposes a
new `workspace_storage` table instead — the correct call. Finish the job: either
drop both columns or extend `fn_workspaces_client_guard` to reject client writes
to them, so the dead column cannot become a live one by accident.

### TPN-NET-013 — Phase 0 edits the containment guard for a correctness reason

```yaml
id: TPN-NET-013
severity: MEDIUM
control: AS-2.3
domain: network
title: The Phase 0 trailing-separator fix modifies the guard that prevents arbitrary-path filesystem access
location: electron/main.cjs:1330-1337
evidence: |
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, String(relPath || ''));
  const a = resolved.toLowerCase();
  const b = base.toLowerCase();
  if (a !== b && !a.startsWith(b + path.sep)) return null;
required: |
  Path containment on a content store is a security boundary. Changes to it
  require adversarial test coverage, not just the coverage that proves the
  new happy path works.
gap: |
  Current behaviour with a root ending in a separator is to fail CLOSED (every
  path rejected) — measured, and not itself a vulnerability. The risk is
  entirely in the FIX: a careless normalisation that strips separators from
  BOTH sides, or that switches to a plain startsWith without the separator
  boundary, converts fail-closed into fail-open and re-opens the arbitrary-path
  unlink that Session 14 closed. This finding exists so the change is reviewed
  as a security edit rather than a typo fix.
effort: XS
blocks_tier: Gold Star
recommendation_ref: RECO-NET-SEG
```

**Notes.** The Phase 0 change must ship together with the escape cases already
measured in `docs/NETWORK_STORAGE_DESIGN.md §3.2` — `..\..\..`, a foreign UNC
root, a `//host/share` form, and an absolute drive path — asserted as `null`
**after** the fix, against both a trailing-separator root and a normal one.
A test that only proves `\\srv\share` now works is the failure mode here.

### TPN-NET-014 — Positive observation: Options B and C add no external attack surface

```yaml
id: TPN-NET-014
severity: INFO
control: TS-2
domain: network
title: The recommended path introduces no new internet-facing surface (credit, not a finding)
location: docs/NETWORK_STORAGE_DESIGN.md §4 Options B and C
evidence: |
  Design §4 Option B: "No internet exposure whatsoever."
  Design §4 Option C: "Zero WILSON code beyond Option B."
required: |
  Framework §7 directs the auditor to give credit where a design avoids
  creating new exposure.
gap: |
  Not a gap. Recorded so a future re-audit does not mistake the network work
  for an expansion of attack surface. The Express server remains bound to
  127.0.0.1 on an ephemeral port under both options; the only change is which
  directory it reads from.
effort: XS
blocks_tier: none
```

---

## Escalations of existing findings

These are **not new**. Each is an existing baseline finding whose severity or
urgency changes if the design proceeds. IDs are reused deliberately.

| Existing ID | Today | If Phase 1 (LAN share) ships | If Option D/E ships |
|---|---|---|---|
| **TPN-NET-001** — bare `cors()` over unauthenticated content routes | HIGH | HIGH, unchanged (still loopback) | **CRITICAL — blocking prerequisite** |
| **TPN-NET-002** — `/api/fetch-url`, `/api/fetch-raw` unrestricted SSRF | HIGH | HIGH, unchanged | **CRITICAL — publishes an open proxy into the studio LAN** |
| **TPN-CONT-008** — no read side to the lifecycle; no record of who obtained a copy | HIGH | **escalates** — see below | escalates further |
| **TPN-LOG-002** — content routes emit no audit event (AS-2.9) | HIGH | **escalates** — see below | escalates further |
| **TPN-CONT-005** — no forensic watermark on outbound transfers | HIGH | unchanged | escalates (AS-3.14 applies to downloaded content) |
| **TPN-AUTH-004** — session/revocation gap | HIGH | unchanged | escalates → **TPN-AUTH-008** |

**Why TPN-CONT-008 and TPN-LOG-002 escalate on Phase 1 alone.** Verified: the
`file_events` vocabulary is `CHECK (event IN ('uploaded','moved','relinked',
'trashed','restored','purged'))` (`0027_file_lifecycle.sql:85-86`) — there is
**no `downloaded` or `viewed` event on either backend** — and the local download
route (`electron/main.cjs:2028-2039`) calls no logger at all.

Today that gap is small in practice because the content sits in one person's
`C:\Users\Audrey\Documents\My_Work`: "who read this file" has one plausible
answer. **A shared network root removes that answer.** Once several people
resolve the same UNC path, AS-2.9's requirement — log every view/download with
timestamp, user, source address, and a per-user-per-asset count — stops being
theoretical and starts being the difference between "we know who took the
unreleased cut" and "we do not."

This is the one place where the recommended, lowest-risk option still moves a
finding in the wrong direction, and it should be said plainly rather than lost
in the credit for adding no external surface.

**Recommendation:** add a `downloaded` event to the vocabulary as part of Phase
1, not later. It is a `CHECK` constraint change plus one call site on each
backend — genuinely small while the design is open, and it is the kind of thing
that never gets retrofitted once the feature ships working.

---

## Control coverage for this review

| Control | Verdict |
|---|---|
| **TS-2** (network segmentation, bastion-only remote access) | 🟡 — satisfied by B/C; violated by D, and by E |
| **TS-2.x** (no internet on content systems) | 🟡 — satisfied by B/C; violated by D/E |
| **AS-3.7** (transit encryption) | 🟡 — SMB requirement unstated (TPN-CONT-016) |
| **AS-3.8** (session & revocation) | 🟡 — bounded today; unbounded under D (TPN-AUTH-008) |
| **AS-2.9** (per-access content logging) | 🔴 — no read event exists; escalated by Phase 1 |
| **AS-3.14** (forensic watermarking) | 🔴 — unchanged, still absent |
| **AS-3.15** (content lifecycle) | 🟡 — lifecycle exists; read side missing |
| **CS-1.13** (cloud config) | 🟡 — TPN-CLOUD-007 |
| **OR-3.4** (vendor risk) | 🔴 — unchanged under B/C; materially worsened by E |
| **TS-1.7** (RBAC/ABAC) | 🟡 — admin-only RLS on the new table is the right shape |

## Conditions on proceeding

1. **Phase 0 and Phase 1 may proceed** on TPN grounds, subject to (2) and (3).
2. **Add `downloaded` to the `file_events` vocabulary in the same phase** as the
   shared root. Non-negotiable — see the escalation note above.
3. **State the SMB3 + signing + encryption requirement** in the storage setup
   guidance (TPN-CONT-016).
4. **Option E is rejected** on OR-3.4 grounds. Record it as rejected.
5. **Option D requires a separate design review before any code.** If it is
   built, membership must be re-checked per request against the database
   (TPN-AUTH-008), the four conditions under the amended TPN-NET-012 must all
   hold, and **TPN-NET-001 and TPN-NET-002 must be closed first** — they become
   CRITICAL the moment anything external can reach that server.
6. **Do not ship `external_access_enabled`** until the thing it gates exists.
   This restates the design's own §6 conclusion; an assessor reading a toggle
   labelled "external access" will ask what it does, and "nothing" is a bad
   answer. When it does ship it renders **only in `byos` mode** and carries the
   Gold-eligibility warning at the control.
7. **Media rides the managed-files plane, not `files`.** Measured
   (`NETWORK_STORAGE_DESIGN.md` §3.6): the `files` path base64s whole files
   through a JSON body after buffering in renderer memory, so it caps at ~37 MB
   regardless of configuration. Any future attempt to raise `express.json`'s
   `'50mb'` limit to "support big files" is treating a rewrite as a config
   change — and would meanwhile let a 50 MB base64 body be buffered per request
   on an unauthenticated endpoint.
