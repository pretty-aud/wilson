# Server side and file gateway: redundancy and efficiency review

Read-only review of the worktree `post-overhaul-merge`, done 2026-10-31. It started at `0d33b17f`; HEAD moved to `ef415b47` during the review, a commit that touches only `docs/sessions/`, so every path below reads the same at both. Scope: the Edge Functions in `WILSON/supabase/functions/` (23 functions and `_shared`), the LIVE definitions in `WILSON/supabase/migrations/` (the last definition of each function, the current policies, indexes and triggers), the pgTAP suites in `WILSON/supabase/tests/`, and the file gateway in `WILSON/gateway/` (the brief's `ROOT\gateway` is `ROOT\WILSON\gateway`). Nothing was edited, run, deployed or connected to; no database was queried.

Paths below are relative to `ROOT\WILSON\` (`ROOT` = `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\post-overhaul-merge`). **MEASURED** = counted or read in the files. **INFERRED** = reasoned from the code without a query plan or a run. Every finding was checked against `docs/OUTSTANDING.md`; the ones already there say so. The handbook's cloud and security sections and §17, `docs/design/GATEWAY_DESIGN.md` and `docs/NETWORK_STORAGE_DESIGN.md` were read first, and nothing that removes a deliberate layer is reported as a redundancy (see the last section).

---

## Found while reviewing: a live defect (not a redundancy, not in OUTSTANDING)

**`operator-workspaces` uses `PAGE`, which nothing defines any more.**
- Severity: **High**.
- Locations: `supabase/functions/operator-workspaces/index.ts:73-76` (the import from `teardownCollect.ts` takes `BUCKET`, `THUMBNAIL_BUCKET`, `AVATAR_BUCKET` and the two collectors, not `PAGE`), `:230-237` (`action: 'list'`), `:655-667` (teardown step 1d); `supabase/functions/_shared/teardownCollect.ts:50` (where `PAGE` lives now). Introduced by commit `9bff662a` (P8, 2026-10-28), which moved the constant out of `index.ts` and left these two uses behind; its message says it was deployed to wilson-dev.
- What happens: the operator console's company list throws `ReferenceError: PAGE is not defined` outside any `try`, so the function answers a bare 500 with no CORS headers and the console shows a network error. In teardown the same error is caught at `:674`, so step 1d silently skips reading the company's whole `upload_abandoned` record, certifies only the paths the sweep returned, and stamps `truncated: true`. Nothing caught it: no CI job type-checks Edge Functions (`.github/workflows/` has no `deno check`), and the vitest suites read this file as text.
- Fix shape: add `PAGE` to the import from `../_shared/teardownCollect.ts`, and add a `deno check` of every function to CI.
- INFERRED from the code and the commit's diff (confirm with one `list` call on wilson-dev).

---

## Measured facts

- **Edge Functions:** 23 functions + 26 shared modules = 49 `.ts` files, 11,369 lines (5,233 of them in `_shared`). Largest: `operator-workspaces/index.ts` 1,063; `ai-files/index.ts` 649; `storage-gc/index.ts` 633; `_shared/gatewayReach.ts` 522; `_shared/aiFileStore.ts` 499; `_shared/gatewayShapes.ts` 441.
- **Function callers:** all 23 have a caller (20 in the client, `gateway-enrol`/`-sync`/`-events` in `gateway/src/cloud/client.mjs`).
- **Repeated plumbing in the functions:** `createClient(` in 10 files (per request); `auth.getUser(` 6 times in 4 files; `mfa.listFactors` 3; a `corsHeaders` object defined 3 times; unbounded `await req.json()` in 14 functions; `workspace_storage_secrets` read at 7 sites in 4 functions; `ANTHROPIC_VERSION` defined 5 times. Rate limiting is NOT duplicated: one implementation (`_shared/rateLimit.ts`), 20 call sites in 17 files.
- **Migrations:** 101 files, 45,104 lines. Largest: `0093_file_gateway.sql` 2,586; `0091_bins_on_the_cloud.sql` 2,229; `0092_legal_gate_managers.sql` 1,662; `0088_legal_files.sql` 1,575; `0100_otter_subject_shares.sql` 1,544.
- **Live SQL:** 216 live function names (217 ever created, `purge_abandoned_uploads` dropped by 0058; overloads counted once); 38 of them were redefined more than once in history (`fn_realtime_broadcast` 7 times; history, not redundancy). 236 live policies on 65 tables. 174 live indexes made by `CREATE INDEX` (constraint indexes not counted). At least 139 live triggers created statically (0004's and 0012's `format()` loops add more). Callers: 103 functions referenced by client code, 28 by Edge Functions, 95 only by other SQL (policies, triggers, functions, cron), 2 only by GoTrue (the Auth hooks).
- **pgTAP:** 103 suites, 39,485 lines. Largest: `103_otter_subject_shares.sql` 2,049; `96_gateways.sql` 1,621; `95_legal_gate_managers.sql` 1,567.
- **Gateway:** `src` 49 `.mjs` files, 7,676 lines (largest `runtime.mjs` 862, `doors/clips.mjs` 321, `acme/manager.mjs` 307, `cli.mjs` 284, `certs/store.mjs` 270); `test` 31 `.mjs` + 2 JSON vector files + 1 shell script, 8,661 lines; `pipeline` 3 files (574 lines); `updater/updater.mjs` 152; `windows` + `container` 7 files.
- **Findings below:** A 9, B 5, C 7, D 2 (23), plus the defect above.

---

## A. Near-duplicate functions

### A1. The S3 bucket's config and secret are loaded and decrypted in four places
- Severity: **Medium**.
- Locations: `supabase/functions/storage-presign/index.ts:72-79, 151-209`; `storage-read-urls/index.ts:29-36, 89-145`; `storage-gc/index.ts:242-297`; `storage-secret/index.ts:46-53, 105-123, 170-205`. The `S3Config` type is declared three times (and inline at `storage-gc/index.ts:254-257`); `new URL(Deno.env.get('SUPABASE_URL') ?? 'https://invalid').hostname` is written three times for `vetS3Host` (`storage-gc:287`, `storage-secret:119, 220`) although `_shared/gatewayReachRun.ts:46-52` already exports `supabaseHost()`.
- What: each copy reads `workspace_storage`, then `workspace_storage_secrets`, checks the crypto secret is set, decrypts, builds the `S3Target` and applies the prefix: about 40 lines each, the same error codes, near-identical sentences.
- Fix shape: one `_shared/workspaceBucket.ts` `loadWorkspaceBucket(admin, workspaceId, { requireByos })` returning the target, key id, secret and prefix or a coded refusal that each caller words itself (about 120 lines saved).
- MEASURED.

### A2. The AI-key and bucket-secret crypto modules are the same file twice; the ticket-key module is a third copy
- Severity: **Medium**.
- Locations: `_shared/aiKeyCrypto.ts:51-130` and `_shared/storageSecretCrypto.ts:47-127` (identical bodies: `b64encode`, `b64decode`, `importKey(version)`, encrypt, decrypt and the last-four hint; they differ only in the secret's name, the error class and one noun); `_shared/gatewayKeyCrypto.ts:43-107` (the same envelope plus AAD, without P8's versioning). The base64 pair is written three times although `_shared/gatewayWire.ts:71-83` exports `toBase64`/`fromBase64`. `operator-ai-keys/index.ts:117-126` already treats the first two as one interface (`domains`).
- What: about 110 duplicated lines across three security modules; a change to one has to be repeated by hand (P8's versioning reached two of the three).
- Fix shape: one `makeEnvelopeCrypto(secretBaseName, label, { aad })` factory that each of the three modules instantiates, keeping the three master secrets separate.
- MEASURED.

### A3. `gatewayReach.ts` and `s3Reach.ts` carry the same raw-HTTP transport twice
- Severity: **Medium**.
- Locations: `withDeadline` `_shared/gatewayReach.ts:226-243` = `_shared/s3Reach.ts:119-136`; `readUpTo` `gatewayReach.ts:245-261` = `s3Reach.ts:139-155` (string vs bytes); the HTTP/1.x answer parser with chunked decoding `gatewayReach.ts:136-164` and `s3Reach.ts:158-201`; the capped fetch-fallback body reader `gatewayReach.ts:350-371` = `s3Reach.ts:270-290`; the literal-address TLS exchange `gatewayReach.ts:308-339` and `s3Reach.ts:227-258`; the host rules of `checkOutsideAddress` (`gatewayReach.ts:103-119`) restated inline in `vetS3Host` (`s3Reach.ts:65-106`), already drifted (a name that is not a DNS name is `malformed` in one and `local_name` in the other).
- What: about 110 lines of SSRF-guard transport in two copies; `s3Reach.ts`'s header says it is "built from its pieces and nothing new of its own", but it re-implements them.
- Fix shape: export the deadline, the reader, the parser, the capped body read and the host check from one module (`gatewayReach.ts` or a new `_shared/rawHttp.ts`) and have `s3Reach.ts` call them.
- MEASURED.

### A4. The change-request and nomination review triggers are one state machine written twice
- Severity: **Medium**.
- Locations: `supabase/migrations/0025_otter_cr_apply.sql:296-440` (`fn_otter_cr_review`) and `0064_otter_course_nominations.sql:513-641` (`fn_otter_nomination_review`); the read windows `otter_has_open_review_access` (`0025:151`) and `otter_has_open_nomination_access` (`0064:282`); the live-role helpers `is_live_workspace_admin` (`0093_file_gateway.sql:200`) and `bins_caller_may_vet` (`0104_bins_vetted_and_gateway_names.sql:152`), which differ only in the role list and are inlined again in both triggers.
- What: both triggers implement the same transition table (approve only through the apply RPC's GUC; reject; changes requested with a required note; withdraw; resubmit with a revision bump; accept a decline; settled rows frozen; provenance pinned). They differ in the approver test, the GUC's name and three column names. The S13 anti-forgery pins exist in both because they were copied; the next fix has to be made twice too.
- Fix shape: in a future migration, one transition helper over the shared columns called by both triggers, and `has_live_workspace_role(ws, roles text[])` for the role checks; the SECURITY DEFINER apply RPCs and the GUC arm stay exactly as they are.
- MEASURED (6-token shingle containment 0.81; then read line by line).

### A5. Four upload-reservation closers repeat the "did it land?" test and the certificate
- Severity: **Low**.
- Locations: `0073_upload_reservations.sql:585-659` (`sweep_abandoned_uploads`), `0074_file_events_money_arm.sql:381-465` (`abandon_upload_reservation`), `:483-520` (`release_stale_upload_reservations`), `:539-615` (`sweep_open_uploads`). The landed test (EXISTS on `storage.objects` OR on `files.storage_path`) is written four times (`0073:612-618`, `0074:415-421, 504-507, 566-572`); the `upload_abandoned` insert-then-close block three times.
- What: `sweep_open_uploads` is `sweep_abandoned_uploads` without the expiry filter, with FOR UPDATE instead of SKIP LOCKED, returning the paths. The copies have drifted once already: 0073's sweep wrote `is_financial` false until 0088 added the BEFORE INSERT trigger `trg_file_events_money` (`0088_legal_files.sql:1150-1172`), which now sets the flag for every row, so the two 0074 closers' own `file_event_is_financial(false, path, NULL)` (`0074:457, 600`) compute it twice.
- Fix shape: `upload_reservation_landed(path)` and `certify_abandoned_upload(...)` helpers that all four call (a migration night).
- MEASURED.

### A6. Three readers of the company's AI key
- Severity: **Low**.
- Locations: `supabase/functions/ai-proxy/index.ts:55-79` (falls back to the platform key), `ai-files/index.ts:104-115` with `_shared/aiFilesKey.ts:40-89` (refuses), `ai-files/index.ts:181-198` (`keyForSource`, null on failure).
- What: the same `workspace_ai_keys` select plus `decryptAiKey` three times. The three failure postures are deliberate (P8, TPN-AI-011); the read is not.
- Fix shape: one `readWorkspaceAiKey(admin, ws)` answering `none | read_failed | unusable | ok(key)`, each caller keeping its own posture.
- MEASURED.

### A7. Making a member is validated and seated twice
- Severity: **Low**.
- Locations: `admin-create-user/index.ts:27-29, 60-73, 102-115` and `invite-member/index.ts:39-41, 72-86, 129-140` (same regexes, same field checks, same username pre-check, same membership insert with orphan-user cleanup); `USERNAME_RE` again at `operator-workspaces/index.ts:128` and, case-insensitive, `resolve-login/index.ts:107-109`.
- What: the two routes to one outcome drifted before (handbook §6 #46: invite-member had no MFA step-up) and still drift (only admin-create-user writes `logAdminEvent`).
- Fix shape: `_shared/members.ts` with `validateNewMember(body)` and `seatMember(admin, ws, user, fields)` used by both.
- MEASURED.

### A8. Two smaller SQL pairs
- Severity: **Low**.
- Locations: `0014_soft_delete.sql:165-200` (`soft_delete_row`, `restore_soft_deleted`) and `0022_otter_content.sql:1001-1039` (`otter_soft_delete_row`, `otter_restore_row`), each pair with its own authorisation function (`fn_trash_authz`, live at `0092_legal_gate_managers.sql:770`; `fn_otter_trash_authz`, `0022:940`). `replace_shot_list_items` (`0084_shot_lists_and_edits.sql:1089-1132`) restates the upsert of `upsert_shot_list_items` (`0084:1156-1207`; lines `1113-1125` = `1192-1205`).
- What: the two trash pairs are the same dynamic UPDATE (the O.T.T.E.R. pair also stamps `deleted_by`); replace is "delete the unnamed rows, then the same upsert".
- Fix shape: let `fn_trash_authz` dispatch the two O.T.T.E.R. tables so one RPC pair serves both (the old names as one-line wrappers while older apps call them); have `replace_shot_list_items` call `upsert_shot_list_items` after its DELETE.
- MEASURED.

### A9. Test scaffolding is hand-rolled instead of shared
- Severity: **Medium** (about 2,000 lines; no runtime cost).
- Locations: pgTAP: `tests.login_as` (`supabase/migrations/0005_test_helpers.sql:82-95`) sets no `app_role` and no `aal`, so 85 of the 103 suites hand-roll `set_config('request.jwt.claims', json_build_object(...))`: 1,190 calls (for example `supabase/tests/rls/96_gateways.sql:183-187`), against 239 `tests.login_as` calls in 43 suites; 69 suites re-insert `auth.users` with the same row template (for example `96_gateways.sql:63-75`); 48 suites use `SET LOCAL ROLE` 380 times. Gateway: a raw `https.request` helper is written again in 7 places (`gateway/test/acme.test.mjs:509`, `doorsOutside.test.mjs:253, 478, 526`, `runtime.test.mjs:77`, `fakeCloud.mjs:238`, `e2e/localProof.mjs:110`) beside `gateway/test/harness.mjs:136`.
- Fix shape: a tests-schema migration adding `tests.login_as(user, ws, role, aal)` and `tests.add_user(id, ws, role, active)` for new suites (old suites need not change), and one exported `request()` in `harness.mjs`.
- MEASURED.

---

## B. Redundant systems (two mechanisms for one job)

### B1. Three timestamp triggers fire on every UPDATE of projects, phases, assets and tasks
- Severity: **Low**.
- Locations: `0000_rabbit_base_schema.sql:318-326` (`touch_updated_at` sets `updated_at`), `:350-359` (`touch_last_updated` sets `last_updated_at`), `0004_rls_rabbit.sql:202-217` (`fn_audit_touch` sets `updated_at` and `updated_by`; its loop includes the same four tables). None of the three was ever dropped.
- What: `touch_updated_at` repeats `fn_audit_touch`'s `updated_at := now()`; `touch_last_updated` maintains `last_updated_at`, which migration 0030 (`0030_privilege_audit_and_hook_lockdown.sql:187-201`) documents as read by nothing. Two of the three PL/pgSQL calls per updated row on the four busiest R.A.B.B.I.T. tables do no useful work.
- Fix shape: drop the two 0000 triggers on those four tables (post-1.0, the `last_updated_*` columns too, trigger first, as 0030 warns).
- Recorded? 0030's own comment records `last_updated_*` as unused ("post-1.0 work"); the `touch_updated_at` overlap is not recorded anywhere.
- MEASURED (triggers) / INFERRED (cost).

### B2. Three guards and `issue-session` re-implement one caller check; responses and CORS come in three families
- Severity: **Medium**.
- Locations: bearer, service client, `getUser`, claims: `_shared/adminGuard.ts:64-107`, `_shared/memberGuard.ts:30-68`, `_shared/operatorGuard.ts:57-89`, `issue-session/index.ts:49-71`. Verified-TOTP check: `adminGuard.ts:125-139`, `operatorGuard.ts:94-112`, `admin-user-security/index.ts:37-44`. `corsHeaders` copied at `resolve-login/index.ts:143-147` and `issue-session/index.ts:25-29` (issue-session builds six JSON responses by hand). Response families: `reply` (`adminGuard.ts:36-41`), `answer`/`refusal` (`gatewayGuard.ts:29-44`), resolve-login's timed `reply`; guard results re-worded twice (`gatewayGuard.ts:50-58`, `gateway-reach/index.ts:50-69`). The caller-JWT client is built four times (`storage-presign/index.ts:129-134`, `storage-read-urls/index.ts:42-47`, `gateway-reach/index.ts:94-98`, `gateway-ticket/index.ts:82-86`); `bearerOf` (`gatewayWire.ts:228-231`) is not used by the guards. Only the gateway functions' clients pass `persistSession: false, autoRefreshToken: false`.
- What: about 150 lines of security plumbing that has drifted before (invite-member, §6 #46). It also costs requests: `ai-files/index.ts:407` then `:429` runs the member guard and then the admin guard for a sweep (two GoTrue calls, two membership reads), and `:532` re-reads the membership row the member guard just read (`isLiveAdmin`).
- Fix shape: one `authenticate(req)` (bearer, client, `getUser`, decoded claims) and one `liveMembership(admin, ws, user)` returning the role, composed by the three guards with their own rules (the three differences in operatorGuard's header stay), plus `callerClient(req)` and `hasVerifiedTotp(admin, user)`.
- MEASURED.

### B3. Three ways to read a request body
- Severity: **Low**.
- Locations: unbounded `await req.json()` in 14 functions (for example `storage-presign/index.ts:112-116`, `ai-proxy/index.ts:195`, every `admin-*` and most `operator-*`); `readJsonLimited` (`_shared/gatewayWire.ts:197-225`); `readSmallJson` (`_shared/aiFileStore.ts:466-492`), the same streaming cap plus an object check.
- What: two copies of the bounded reader, while most functions still read unbounded.
- Fix shape: `readSmallJson` as `readJsonLimited` plus the object check, and the 14 JSON functions on the bounded reader with a per-function cap (ai-proxy's large).
- Recorded? OSP-08 (closed) names the two readers side by side; the duplication is not recorded.
- MEASURED.

### B4. Two S3 read signers with different authority
- Severity: **Low**.
- Locations: `storage-presign/index.ts:135-146, 199-230` (GET/HEAD for any row-shaped path under a readable project) and `storage-read-urls` with `_shared/readUrls.ts:194-210` (GET only when a live row the caller can see owns the key).
- What: two GET signers for the same objects; the older signs by path, the newer by row.
- Fix shape: route storage-presign's `get`/`head` through `readUrls.ts`'s row check, keeping its one-key bound and its limiter.
- **Already recorded as OSP-01** (and OSP-07 for a writer's reach).
- MEASURED.

### B5. The gateway has three HTTPS clients and a handful of copied helpers
- Severity: **Low**.
- Locations: `gateway/src/cloud/client.mjs:143-196` (fetch with `readCapped`), `gateway/src/update/releaseFetch.mjs:44-73` (`requestOnce`, node:https), `gateway/src/acme/client.mjs:49-86` (`request`, node:https); the last two are the same promise, idle timeout, whole-request deadline, refusal-tracking and byte-cap machinery. Also `serial()` and `algorithm()` in `gateway/src/acme/certs.mjs:39, 53` and `gateway/src/certs/x509.mjs:63, 71`; AES-256-GCM seal/open in `gateway/src/platform/pipe.mjs:53-62` and `gateway/src/platform/secrets.mjs:126-140`; `readJson` in `gateway/src/cli.mjs:35`, `gateway/src/installer.mjs:47`, `gateway/src/update/swap.mjs:61`; `maskBytes` in `gateway/src/certs/x509.mjs:77` and `gateway/src/rules/ip.mjs:113`.
- What: about 100 lines; the two node:https copies must be kept in step for any change to the timeout rules.
- Fix shape: one `src/net/httpsRequest.mjs` (method, body, cap, idle timeout, deadline, optional streaming, the test transport) used by the release fetch and the ACME client; move the small helpers into the modules that already own them.
- MEASURED.

---

## C. Inefficiencies

### C1. Every RLS read calls `has_active_membership` once per row
- Severity: **High**.
- Locations: `0008_fix_rls_recursion.sql:48-61` (`has_active_membership`: SQL, STABLE, SECURITY DEFINER, which the planner cannot inline); for example `0072_private_projects.sql:48-57` (`projects_select`) and `0097_no_main_item.sql:221-226` (`tasks_select`, whose EXISTS on `projects` applies `projects_select` once per task row).
- What: live policies make 179 per-row calls `has_active_membership(<row>.workspace_id)`. 155 policies on 54 tables pass the row's `workspace_id` while also requiring `workspace_id = current_workspace_id()`, so the answer is the same for every row they return; 25 more call it on a joined parent's `workspace_id`. A list of N rows pays N definer calls, each an index probe on `workspace_members`, and child tables pay again through the parent's policy.
- Fix shape: in a migration, restate each such policy whole from its live text (the 0059 lesson) with `(SELECT public.has_active_membership(public.current_workspace_id()))` beside the unchanged `workspace_id = public.current_workspace_id()` conjunct, so the live-row check runs once per statement as an initplan; prove it with EXPLAIN on dev and move the post-conditions and suites that pin policy text. The live-row check itself stays.
- Not recorded.
- MEASURED (counts) / INFERRED (cost; no plan was run).

### C2. The quota meter sums every Petal object of every company on each upload
- Severity: **Medium** (rises with the platform's size).
- Locations: `0073_upload_reservations.sql:235-249` (`workspace_petal_committed_bytes`: `storage.objects` joined to `projects` on `fn_try_uuid((storage.foldername(name))[2])`, filtered to the workspace only after the join), reached through `rabbit_petal_storage_ok` (`0073:290-324`) from the RESTRICTIVE policy `petal_storage_quota_insert` (`0078_quota_exemption_bounded_by_size.sql:341-352`, evaluated at the TUS trial insert and again at completion), from `reserve_upload_bytes` (`0092_legal_gate_managers.sql:628`, call at `:725`), from `workspace_storage_usage()` (`0055_petal_cloud_storage_plans.sql:453`; client `src/cloud/workspaceStorage.js:153`) and from the operator summary once per company.
- What: the join key is computed from each object's name, so no index narrows `storage.objects` to one workspace: every rabbit-files upload reads every object in rabbit-files and rabbit-thumbnails across all tenants and computes `foldername` and `fn_try_uuid` for each.
- Fix shape: keep reading `storage.objects` (the meter's rule) but scan each of the workspace's projects by key prefix (`name LIKE 'projects/<id>/%'`, which the storage schema's name indexes can serve) instead of deriving the project from every name; confirm the plan with EXPLAIN on dev.
- Partly recorded: OUTSTANDING's S41 row and handbook §17 state that the operator summary scans both buckets once per company; the per-upload cost through the policy is not recorded.
- INFERRED.

### C3. Lookups by `files.storage_path` have no index; storage-gc works one row and one object at a time
- Severity: **Medium**.
- Locations: no index on `files.storage_path` or `files.thumbnail_url` (the `files` indexes are `0000:237-238`, `0004:114`, `0014:294`, `0038:56-57`, `0043:97-101`, `0085:101-102`; storage-gc's own comment at `storage-gc/index.ts:194-196` says "storage_path has none"). Scanning callers: the queue drain (`storage-gc/index.ts:365-369`: one lookup per queue row, up to 500, no workspace filter, and a miss, the normal case, reads the whole table), `referencedPaths` (`:182-190`), and the four reservation landed tests (`0073:612-618`, `0074:415-421, 504-507, 566-572`; the hourly cron among them). storage-gc then writes one queue UPDATE per row (`:332-334, 381-389, 401-403, 429-447, 461-474`), removes orphans one object per `remove()` (`:543, :583`) with one certificate insert each (`:546, :586`), and reads `projects` (and `file_events`) once per project folder (`:487-494`).
- What: up to about 500 full scans of `files` plus about 1,500 sequential statements per Storage Cleanup click, inside the Edge deadline.
- Fix shape: a migration adding an index on `files(storage_path)` and a partial one on `files(thumbnail_url) WHERE thumbnail_url IS NOT NULL`; in storage-gc, check restorability with `.in()` per chunk as `referencedPaths` does, group the status updates by outcome, and remove and certify orphans per 100.
- Not recorded.
- MEASURED (code) / INFERRED (plans).

### C4. ai-files reads `app_events` by JSON path with no index, across every company, and lists the store twice per sweep
- Severity: **Medium**.
- Locations: `_shared/aiFilesUpstream.ts:187-206` (`readUploadRowsNaming`: `code = 'WIL-6001' AND context->>'tool' = 'ai-files' AND context->>'file_id' IN (...)` with no workspace filter) and `:170-184` (`readUploadRows`: a workspace's 90 days of events filtered by JSON path; with `null`, every company's, as `operator-ai-files/index.ts:93` calls it). The only `app_events` indexes are `0021_app_events.sql:51-54` (workspace + time; workspace + type + time). `ai-files/index.ts:459` and `:491` call `storedForWorkspace` twice per sweep (each: three `app_events` reads, a key decrypt per key source, Anthropic Files lookups, another `app_events` read); `operator-ai-files/index.ts:119` and `:149` do the same with `read()`.
- What: every member delete, list and sweep reads the whole `app_events` table (every AI call of every company writes a WIL-6001 row there), and each sweep repeats its Anthropic lookups, which share the org-wide file limit the code itself guards.
- Fix shape: an expression index on `app_events ((context->>'file_id')) WHERE context->>'tool' = 'ai-files'` (or a small `ai_file_uploads` table), and the after-sweep totals computed from the first listing minus the ids deleted.
- Not recorded.
- MEASURED (code) / INFERRED (plans).

### C5. Secrets are unsealed and keys re-derived on every call; independent round trips run one after another
- Severity: **Low**.
- Locations: `_shared/aiKeyCrypto.ts:73-90`, `_shared/storageSecretCrypto.ts:70-87`, `_shared/gatewayKeyCrypto.ts:60-71` (the master key re-read, base64-decoded and imported on every encrypt and decrypt); `ai-proxy/index.ts:190` then `:259` (the limiter RPC and the key read are independent but sequential, then an AES decrypt, before every AI call); `storage-presign/index.ts:151-197` (two reads by the same workspace id and a decrypt per presign; an s3 image upload presigns twice); `_shared/s3Presign.ts:199-205` (the four-HMAC signing-key chain recomputed per URL, up to 100 times per `storage-read-urls` call, `_shared/readUrls.ts:300-316`); `_shared/gatewaySigning.ts:42-55` (an RPC, an AES open and a PKCS#8 import on every `gateway-ticket` call, every 75 s per playing clip).
- What: a few milliseconds and one database round trip per request on the busiest functions.
- Fix shape: memoise each imported master `CryptoKey` per version at module scope; run the limiter and the key read with `Promise.all` in ai-proxy; read `workspace_storage` and `workspace_storage_secrets` in one query; derive the SigV4 signing key once per batch; cache the imported ticket key per workspace, kid and ciphertext per isolate (the DB read still confirms the current kid).
- INFERRED.

### C6. Overlapping indexes
- Severity: **Low**.
- Locations: an index whose columns lead another non-partial index on the same table: `bin_files_location_idx` (`0091_bins_on_the_cloud.sql:461`) under `bin_files_location_path_idx` (`:466`); `budget_lines_project_idx` (`0037_budget_system.sql:216`) under `budget_lines_project_sheet_idx` (`:218`); `folders_project_idx` (`0041_folders.sql:233`) under `folders_project_path_uniq` (`:210`); `scenes_project_idx` (`0040_scenes_shots_levels_experiences.sql:170`) under `scenes_project_number_idx` (`:171`); `tasks_project_idx` (`0000:197`) under `tasks_project_phase_idx` (`0034_tasks_without_assets.sql:90`); `otter_courses_ws_owner_idx` (`0022:159`) under `otter_courses_owner_slug_uidx` (`0022:146`, same predicate). Full and partial indexes on one column: `workspace_id` on projects (`0000:135` + `0014:291`), assets (`0004:112` + `0014:292`), tasks (`0004:113` + `0014:293`), files (`0004:114` + `0014:294`); `project_id` on milestones (`0067:124` + `:129`).
- What: six indexes the wider ones already serve, and five pairs where the partial index differs only by the small soft-deleted share (30-day purge); each is maintained on every write.
- Fix shape: drop the six; measure the five pairs on dev (`pg_stat_user_indexes`) and keep one of each.
- MEASURED (definitions) / INFERRED (use).

### C7. Small costs on the gateway's side
- Severity: **Low**.
- Locations: `supabase/functions/_shared/gatewayGuard.ts:86-96` reads the `gateways` row and checks `revoked_at`; `gateway_sync_apply` reads it again FOR UPDATE and re-checks (`0104_bins_vetted_and_gateway_names.sql:793-796`), as does `gateway_events_apply` (`0095_gateway_next_root_viewing_fraction.sql:529-531`): one extra round trip per heartbeat (every 10 s per gateway) and per events post. `gateway-reach/index.ts:121-132` polls the row every 0.5 s for up to 15 s. In the program: one `setInterval` per streaming response (`gateway/src/doors/clips.mjs:257`) although the runtime's 1 s tick already sweeps streams (`gateway/src/runtime.mjs:739-745`); `Coverage.add` copies the whole interval array for every 256 KiB chunk (`gateway/src/doors/viewings.mjs:26-44`, called at `clips.mjs:248`); the status file is rewritten every 5 s and the enrol file polled every 3 s for the life of the process (`runtime.mjs:93, 322-329, 823`).
- Fix shape: let the guard map the credential to the gateway id only and take revocation and the workspace from the apply RPC's answer; poll gateway-reach every 1-2 s; cut lapsed responses from the tick; extend the last interval when a chunk continues it; write the status only when it changes and stop the enrol poll once enrolled.
- MEASURED (code) / INFERRED (cost).

---

## D. No caller

### D1. Database functions no current code calls
- Severity: **Low**.
- Locations: `reorder_task_items` (`0096_task_items.sql:340-376`, granted to authenticated; the client says it stays "for the older apps that still call it", `src/tools/rabbit_v0.1.0/adapters/supabaseAdapter.js:3101-3104` and `src/tools/rabbit_v0.1.0/adapters/index.js:161-162`); the 1- and 2-argument `rabbit_petal_storage_ok` shims (`0057_cloud_multi_gb.sql:322`, `0073_upload_reservations.sql:342-352`), kept only because post-conditions and suites 65, 66 and 77 name them.
- What: callable surface kept for old builds and test pins.
- Fix shape: drop them once no shipped build calls them and the pins move to the three-argument form.
- MEASURED. All 216 live function names were searched in `src/`, `electron/` and `supabase/functions/`; every other one has a client, Edge or SQL caller. The two Auth hooks (`hook_password_verification_attempt`, `hook_mfa_verification_attempt`, 0070) are called by GoTrue once enabled (`docs/PRODUCTION_RUNBOOK.md:349-350`), so they are not orphans.

### D2. Shared-module exports nothing in production imports
- Severity: **Low**.
- Locations: unused anywhere: `gatewayKeyCryptoConfigured` (`_shared/gatewayKeyCrypto.ts:73`), `PREVIOUS_KEY_GRACE_SECONDS` (`_shared/gatewayTicket.ts:47`; the grace lives in SQL). Used by tests only: `verifyTicket` (`gatewayTicket.ts:181-223`, the cloud's reference verifier, kept on purpose for the vectors), `importSigningPublicKey` (`:250-254`), `PUBLIC_KEY_B64_RE` (`:257`), `fileMetadata` (`_shared/aiFilesUpstream.ts:131-142`), `makeEnrolmentToken` (`_shared/gatewayWire.ts:109-111`; tokens are made in SQL).
- What: dead code in every bundle that imports these modules (263 exports checked).
- Fix shape: delete the two unused exports; move the test-only ones into a test helper, or mark them vectors-only.
- MEASURED. (No Edge Function lacks a caller: 23 of 23 are called.)

---

## Not redundant, by design

1. The money gate on both the row (the `files` policies, `file_row_is_money`) and the blob (four base plus four money policies on rabbit-files, the same eight on rabbit-thumbnails): two enforcement points of one rule.
2. The RESTRICTIVE `petal_storage_quota_insert` and `reserve_upload_bytes`: the quota and its size-bounded exemption enforced at both sites (0078). C2 changes how the meter reads, not that it runs at both.
3. The SECURITY DEFINER approval paths (`otter_cr_apply`, `otter_nomination_apply`) and the GUC arm in each review trigger. A4 shares the transition table, never the arm.
4. Three master secrets (AI keys, bucket secrets, ticket keys), each rotating alone. A2 shares code, not keys.
5. ai-proxy's fail-soft key and ai-files' fail-closed key (P8, TPN-AI-011). A6 shares only the row read.
6. `getUser` in every guard plus the live membership row (ES256, `verify_jwt = false`): verifying the JWT locally would save a GoTrue call but give up session revocation until the token expires.
7. One durable limiter with two postures: fail-open after authentication, fail-closed before it and for gateway-events (D27).
8. `platform_audit` beside `app_events` (it must outlive the CASCADE); `file_events` as certificates; `workspace_audit` (outlives the company, read by a live admin).
9. `storage-read-urls` as its own function (own limiter bucket, own expiries, storage-presign's one-key bound kept); only the overlap of the two GET paths is a finding (B4, OSP-01).
10. Copies across runtime boundaries pinned by tests or vectors: `moneySegments.ts` vs `rabbit_money_segment`; `reservedObjects.ts` and `shotKeys.ts` vs the renderer; the ticket wire in `_shared/gatewayTicket.ts` vs `gateway/src/wire/ticket.mjs`; IP parsing in `_shared/gatewayShapes.ts` vs `gateway/src/rules/ip.mjs`; the media allow-list in the gateway vs `bins/gatewayMedia.js`; `clientAddress` in `gatewayShapes.ts` vs `clientIp` in resolve-login (copied on purpose across bundles; worth one shared module only if both deploy together).
11. Teardown's three sources (files, the queue, the reserved objects) plus the listed avatars and posters: each covers another's blind spot.
12. Two realtime triggers on `task_items` (project topic and workspace topic) and `fn_budget_versions_broadcast`: separate channels.
13. `has_active_membership` in both USING and WITH CHECK of the UPDATE policies: the old row and the new row.
14. Partial indexes on booleans (`files_core_idx`, `files_project_financial_idx`) beside `files_project_idx`: small and serving their own predicates.
15. resolve-login's response-time floor and uniform body; the edge functions' live-row re-check even though RLS also checks (the staleness rule).
