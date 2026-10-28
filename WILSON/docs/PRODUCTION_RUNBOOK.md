# WILSON 1.0.0 — the production runbook

The controller's ordered procedure for putting WILSON 1.0.0 on production (`wilson-prod`, project ref
`rqyriuyldhovirbuievt`). Written 2026-10-28 by R2 (night 4 of `docs/sessions/PLAN_TO_1_0.md`) from the repository and its
documents only: **no session read staging or production to write it.** Every statement below about what an environment holds is a
document's, with its source and date; step (a) is where the controller replaces them with measurements. Each step is a command or
a dashboard action, then its proof. **Stop at the first proof that does not read as written**, put what came back in the hand-off,
and ask. **Release day runs in the order of (g)**, not in the order of the sections.

Not in this file, on purpose: Audrey's own setup tasks (`docs/OWED_AUDREY.md`), staging's checklist of 2026-10-05
(`docs/sessions/BETA_CHECKLIST_2026-10-05.md`), the web host's setup (`docs/WEB_DEPLOY.md`), the release test
(`docs/RELEASE_TESTING.md`). Release day cites them.

Sources, by key: **[P]** `docs/sessions/PLAN_TO_1_0.md`; **[K]** the controller's kit,
`C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\00_HOW_TO_APPLY.md`; **[B1]**
`docs/sessions/handoffs/po-b1-2026-10-27.md` §4–§5; **[OWED]** `docs/OWED_AUDREY.md`; **[HB]** `docs/SYSTEMS_HANDBOOK.md`;
**[OUT]** `docs/OUTSTANDING.md`; **[BC]** `docs/sessions/BETA_CHECKLIST_2026-10-05.md`; **[WD]** `docs/WEB_DEPLOY.md`; **[HP]**
`docs/sessions/HANDOFF_PROTOCOL.md`; **[C2]** `docs/sessions/handoffs/track-c-C2-2026-09-07.md`.

---

## 0. The gate, the release commit, and the rules for every step

**The gate.** [P] §0 item 4, verbatim: "4. The release steps in §6 are done: hers in the browser, then the controller's on
production, after the TPN re-audit reports nothing High." So the controller's production steps start only after her browser steps
((g) 1–7) and when the first section of `TPN_AUDIT/SUMMARY.md`, *Release gate*, reads **0 Critical and 0 High open in the four
areas**. On 2026-10-28 it reads **11 High**. Walkthrough 85 Q1 and Q2 propose that her ruling on each (fixed before 1.0, or accepted
for 1.0 with the reason written into the finding) count as nothing High; that is R2's proposal, not the plan's text, and until she
answers, (g) 8 does not pass. **Q1 was answered on 2026-10-28** ((a); her words in `TPN_AUDIT/SUMMARY.md` and in each finding):
the seven of the areas' own other than TPN-AI-009 are fixed before the release by one session on Phase 8 of
`TPN_AUDIT/REMEDIATION_PLAN.md`, so its merge comes before (g) 8 and the release commit carries it; TPN-AI-009 is accepted for the
start of the production steps and closes at (c) and (g) 17, which must run before 2026-11-09 for her reason to hold. **Q2 was
answered the same day** ((a)): TPN-AUTH-013, TPN-CONT-019 and TPN-AI-011 are fixed by the same session, so (g) 8 waits for its
merge, its ten fixes checked against Phase 8's exit criteria.

**The release commit** is `feat/multi-user-v1`'s tip after the last beta merge and after (g) 8 has dated `CHANGELOG.md`'s 1.0.0
heading there. Every deploy, every md5, the web build and the installer come from it, and the tag goes on PR #4's merge of it, so
that `git diff <release commit> v1.0.0 -- WILSON/` is empty ((g) 20). **Nothing else lands on `feat/multi-user-v1` from (g) 8 to
(g) 20**: the controller's hand-off, FX12-01's removal from OUTSTANDING (`po-fx12-2026-10-25.md` §7, step 3) and any fix wait
for the tag.

**The rules.**

1. **No value of a secret, key or token** goes into this file, a transcript, a chat or a shell history. Secrets are set in the
   dashboard (Edge Functions → Secrets), typed by her, or generated and set without being shown ((d)). `supabase secrets list`
   prints a name and a digest, never a value. Never filter the output of `supabase projects api-keys`; select the one field ([OUT]
   security entry, S19).
2. **Never `supabase db push`** (it would apply files out of the house method) and **never `supabase config push`** (it overwrites
   the hosted Auth and SMTP settings) ([K]; [WD]; [OWED] §14).
3. **One `db query` per call** ([HP] §2). Every read names its database: `inet_server_addr()` and a workspace count in the query.
4. **Work from a release worktree linked to production.** The canonical checkout stays linked to wilson-dev.
   `scripts/tap-all.mjs` runs against whatever the checkout is linked to, so (b)'s suites need the release worktree's own link.
5. **Nothing else talks to a database from this machine** from (a) to the end of (b): no other `supabase db query` and no
   `tap-all`, against any project. The CLI's temporary login role is per login, not per project, and two runs race ([HP] §6).
6. **A file the controller writes for the database is written by a script that reads the git blob as bytes**, never by shell
   interpolation and never through a PowerShell pipe (which re-encodes text and adds CRLF) ([B1] §4), and it carries LF line ends.
   The one exception is what `scripts/tap-hosted.py` writes for (b)'s rehearsals: it reads the working tree, CRLF here, and writes
   CRLF; those files are rolled back and never recorded, so no md5 depends on them.

---

## (a) Read first: production as it is

**Setup, once.**

```
git fetch origin
git worktree add ..\wilson-release <the release commit>
cd ..\wilson-release\WILSON
npm install --ignore-scripts
git checkout -- package-lock.json
supabase link --project-ref rqyriuyldhovirbuievt
```

The link asks for production's database password; she types it. Proof: `supabase\.temp\project-ref` reads
`rqyriuyldhovirbuievt`. Make an empty scratch folder `<W>` outside the repository for the files of (b) and (c).

**The reads.** Each is one command; each answer goes in the hand-off.

| # | Command (from the release worktree's `WILSON\`) | The documents expect |
|---|---|---|
| a1 | `supabase db query --linked "select inet_server_addr() as host, current_user as role, (select rolbypassrls from pg_roles where rolname = current_user) as bypassrls, (select count(*) from public.workspaces) as workspaces"` | `bypassrls` true: 0076, 0088 and 0092 refuse a role that row security binds, 0100 refuses one without BYPASSRLS, and 0069 refuses unless 0064's `otter_nomination_apply` is owned by a BYPASSRLS role (on hosted projects the Management API's `postgres` has it: 0076's header, measured 2026-09-09; [B1] §5) |
| a2 | `supabase db query --linked "select inet_server_addr() as host, max(version) as last, string_agg(version, ' ' order by version) filter (where version >= '0055') as recent, (select count(*) from public.workspaces) as workspaces from supabase_migrations.schema_migrations"` | last `0063` ([P] §1, 2026-10-27; [K], 2026-10-26). Anything from 0064 on already present: (b) starts at the first absent file, and each present one is checked by step 5's md5 first |
| a3 | `supabase db query --linked "select inet_server_addr() as host, string_agg(extname || ' ' || extversion || ' in ' || extnamespace::regnamespace::text, ', ' order by extname) as ext, (select count(*) from public.workspaces) as workspaces from pg_extension where extname in ('pg_cron', 'pgcrypto', 'pg_net')"` | `pg_cron` present; `pgcrypto in extensions` (0093 calls `extensions.gen_random_bytes`) |
| a4 | `supabase db query --linked "select inet_server_addr() as host, count(*) as jobs, string_agg(coalesce(jobname, '(unnamed)') || ' ' || schedule || case when active then '' else ' (inactive)' end, ', ' order by jobname) as list, (select count(*) from public.workspaces) as workspaces from cron.job"` | five jobs ([HB] §4.8): `wilson-purge-edit-history` (0012, 04:43), `wilson-purge-soft-deleted` (0014, 04:47), `wilson-purge-app-events` (0021, 04:51), `wilson-purge-otter-trash` (0022, 04:55), `wilson-purge-rate-limits` (0028, 04:59), and **no `wilson-purge-abandoned-uploads`** (0057's, which 0058 unscheduled). That one present: stop, 0073's post-condition 10 refuses it. No `cron` schema: stop, 0073 and 0093 create pg_cron only where it is available |
| a5 | `supabase db query --linked "select inet_server_addr() as host, string_agg(id || ' public=' || public || ' limit=' || coalesce(file_size_limit::text, 'none'), ', ' order by id) as buckets, (select count(*) from public.workspaces) as workspaces from storage.buckets"` | `rabbit-files public=false limit=53687091200, rabbit-thumbnails public=false limit=262144, user-avatars public=true limit=2097152` (0027 and 0057, 0053, 0009). **`rabbit-thumbnails` must be `false`**; if not, stop (TPN-CLOUD-008). `user-avatars` public is the known TPN-CLOUD-004 |
| a6 | `supabase db query --linked "select inet_server_addr() as host, (select count(*) from public.workspaces) as workspaces, (select count(*) from public.projects) as projects, (select count(*) from auth.users) as users, (select count(*) from public.platform_operators) as operators"` | `0 / 0 / 0` and no operator ([C2] §2, measured 2026-09-07). Nothing in (b) to (d) needs a company. With no company she belongs to, the first operator is (g) 13 (walkthrough 85, Q4) |
| a7 | `supabase db query --linked "select inet_server_addr() as host, (select count(*) from public.workspace_storage_secrets) as bucket_secrets, (select count(*) from public.workspace_ai_keys) as ai_keys, (select count(*) from public.app_events where code = 'WIL-6001' and context->>'tool' = 'ai-files' and message = 'AI file upload completed') as ai_uploads, (select count(*) from public.workspaces) as workspaces"` | all 0 on an empty production: an `app_events` row needs a company (`workspace_id NOT NULL`, 0021), so with a6 at 0 there is nothing to sweep, and (g) 17 says so. If a6 reads a company and `ai_uploads` is above 0, (c)'s two FX12 functions and (g) 17's sweep come before 2026-11-09, when the 90-day purge takes the attribution ([OUT] FX12-01) |
| a8 | `supabase functions list --project-ref rqyriuyldhovirbuievt` | the deployed set; (c) compares it with the 23 in the tree |
| a9 | `supabase secrets list --project-ref rqyriuyldhovirbuievt`, then the same with `rzkirvkotslbovzbsdfh` (staging) | names and digests only; (d) says which match |
| a10 | Dashboard → wilson-prod → Authentication: **Hooks**, **Sessions**, **Email Templates**, **SMTP Settings**, **URL Configuration** | Hooks: **exactly one, Custom Access Token → `public.custom_access_token_hook`, enabled** (`docs/sessions/SESSION_04_prompt.md`: "enabled on both", staging and prod), and neither of 0070's two; the token hook absent: stop, every tenant policy reads the claims it mints ([HB] §4.3). Templates: **not uploaded** (`docs/RELEASE_TESTING.md` as of 2026-09-30: "Staging templates are uploaded; dev and prod are not"; [HB] §9 says all three: the read settles it). SMTP: Resend. Sessions: note the time-box and inactivity timeout. URLs: none yet for the host of (f) |
| a11 | GitHub → Actions → **db-backups**: last night's run green, or **Run workflow** and wait for green; and Dashboard → wilson-prod → Database → **Backups**: today's daily backup listed | a fresh `db/prod/…` dump in B2 ([HB] §8) **and** the platform's own. The B2 dumps have never been restored (the drill is deferred, [OWED] §1), so the platform's backup is the one to trust. Neither present: stop and ask her |

---

## (b) The migrations, by file, in order

**What production lacks** ([P] §1, [K]): every file from 0064 to the last merged. On 2026-10-28 that is the 34 files below: the
33 through **0101**, and **0103**, which M2 merged (night 4; P1 merged with none, `po-p1-2026-10-28.md` §2). Dev and staging are at
0101 ([P] night 3, 2026-10-28 05:05 UTC), and dev also holds 0103 (`po-m2-2026-10-28.md`, by query). From night 5 dev also holds **0104, 0105 and 0106** (P8,
`po-p8-2026-10-28.md` §2, by query), so production lacks 37 files and staging owes those three with suites 107 to 109.

**The house method, per file** ([B1] §4; [K]). For file `NNNN_name.sql`:

1. **Drift.** `supabase db query --linked "select inet_server_addr() as host, string_agg(version, ' ' order by version desc) as last3, (select count(*) from public.workspaces) as workspaces from (select version from supabase_migrations.schema_migrations order by version desc limit 3) v"` → the previous file is first.
2. **Rehearsal, rolled back.** `<W>\rehearse-NNNN.sql` holds `BEGIN;`, the file's LF text and `ROLLBACK;` (rule 6).
   `supabase db query --linked --file <W>\rehearse-NNNN.sql` → no error, and step 1 reads the same. A file's preflight fires
   here, where it costs nothing. No file in the range holds a top-level `BEGIN;`, `COMMIT;` or `ROLLBACK;`, or any `CONCURRENTLY`,
   `VACUUM` or `ADD VALUE` (grep, 2026-10-28; the `BEGIN`s inside function bodies are plpgsql's), so the wrapper is safe for all 33.
3. **The statements.** `supabase db query --linked --file <W>\NNNN.lf.sql` (an LF copy of the blob, rule 6). `db query` drops
   `RAISE NOTICE`, so a file's "OK" line never shows ([B1] §5); an error is what matters.
4. **The history row.** `<W>\hist-NNNN.sql` holds
   `INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('NNNN', 'name', ARRAY[$m$<the LF file>$m$]) ON CONFLICT (version) DO NOTHING;`
   with `name` the file name without its `NNNN_` and `.sql` ([K]'s shape; no file contains `$m$`).
   `supabase db query --linked --file <W>\hist-NNNN.sql`. [OWED] §14 recorded 0071 on dev with `supabase migration repair`, which
   may not record the statements, so step 5 could not check it: use the row.
5. **The md5.** `supabase db query --linked "select inet_server_addr() as host, version, md5(statements[1]) as md5, (select count(*) from public.workspaces) as workspaces from supabase_migrations.schema_migrations where version = 'NNNN'"`
   → the table's value, the md5 of the file's git blob (LF). Recompute it from the release commit **in Git Bash**
   (`git show <release commit>:WILSON/supabase/migrations/<file> | md5sum`; never in PowerShell, rule 6) and stop if it differs
   from the table (measured at `51e5a0d7`).
6. **The file's own probe**, where the table gives one.

**Before step 3 of the first file, the whole chain once, rolled back** (recommended). `<W>\chain.sql` holds `BEGIN;`, the 33
files' LF text in order and `ROLLBACK;` (rule 6); `supabase db query --linked --file <W>\chain.sql` → no error, and step 1 reads the
same. It proves the 33 apply in order on production as it is, before anything commits. Untried at this size (about 1.6 MB of SQL in
one call): if the Management API refuses it, rely on each file's own rehearsal (step 2). **To test the final schema the same way**,
one suite per call. The suites cannot share a transaction (`tests.rls_setup()` runs as its caller and inserts into `auth.users`,
and suite 01 leaves the role `authenticated`), which is why `scripts/tap-all.mjs` runs one suite per transaction. For a suite N of
the list below: `python scripts/tap-hosted.py <W>\chain-N.sql`, then the 33 files in order and `supabase\tests\rls\N_<name>.sql`
as its arguments, then `supabase db query --linked --file <W>\chain-N.sql` → its one verdict row reads `collected = planned`
and no failure.

**After the last file, the suites** (step 7): `node scripts/tap-all.mjs` from the release worktree → every suite `collected =
planned`, no failure. On a production nobody has signed in to, suite 74 reads 35/35; on any database with real rows, suite 74's
#34 and #35 and suite 25's #13 count every row and fail, which is the healthy reading ([OWED] §14; [B1] §2). **Why not one suite
per file, as on staging:** production catches up 33 files at once, and the suites at the release commit test the final schema.
These were extended by a later file and fail if run before it: 01, 03, 04 and 45 (0084), 19 and 23 (0097), 57 (0098), 66 (0073),
70 (0069), 72 (0091, 0096, 0098), 74 (0071), 77 (0078, 0088), 78 (0076, 0092), 83 (0088), 87 (0088), 90 (0092), 95 (0093), 99 (0097,
0098), 100 (0098). **0103** (M2) is the exception the other way: it adds enum values, and a value cannot be used in the
transaction that adds it, so suite 106 cannot share its rehearsal. Rehearse 0103 alone (step 2), apply and record it, then run
suite 106.

| File | Special step beside it (from its header unless marked) | Suite | md5 of the LF blob |
|---|---|---|---|
| `0064_otter_course_nominations` | none. If it is ever replayed, replay 0069 straight after it | 70 | `a8ea19f4c1eab73a040bfe1646646465` |
| `0066_platform_audit_invite_sent` | one vocabulary in four places with `_shared/operatorGuard.ts` and `operator-workspaces`: deploy `operator-workspaces` after it, (c) | 35 | `049db9424c9001c2c101560d24192b20` |
| `0067_milestones` | relies on 0014's job `wilson-purge-soft-deleted` (a4) | 71 | `9c237f0c1c63404400724bf3d310bed7` |
| `0068_user_pets_stale_write_guard` | none | 56 | `aa336889d11452f24126720c6938678b` |
| `0069_otter_nomination_self_approval_audit` | `db query --file`, never `db push`; refuses unless 0064's `otter_nomination_apply` is deployed and owned by a BYPASSRLS role, and `app_events` exists | 70 | `c03a60d9e22c33be10200f65dba3263c` |
| `0070_auth_events` | the two Auth hooks are a dashboard step: (e), after 0071 | 74, 35 | `34e0447aea3edd823efd036d76d47b9b` |
| `0071_auth_events_admin_scope` | the history row as in step 4 | 74 | `38ada0146d542eb3d0ebfde94f75de54` |
| `0072_private_projects` | none | 80 | `d9ab44ec6ccba9fae162f2e04ef4f129` |
| `0073_upload_reservations` | needs `rabbit-files` at 53687091200 and `storage_free_tier_bytes()` 5368709120 (0057); creates pg_cron where available and schedules `wilson-sweep-abandoned-uploads` (`39 * * * *`); its post-condition 10 refuses the file if 0057's old job is scheduled or, where pg_cron exists, the new one is missing; `storage-gc` calls its `sweep_abandoned_uploads`: deploy it after, (c). Probe: `select jobname, schedule from cron.job where jobname = 'wilson-sweep-abandoned-uploads'` → one row | 77 | `0b422b764e8b00b2487cefc7f2e4cd76` |
| `0074_file_events_money_arm` | `operator-workspaces` calls its `sweep_open_uploads`: deploy it after, (c) | 78 | `5068e6c9f1c2ee2403927e07c70ec14e` |
| `0075_file_document_kind_and_description` | none | 79 | `4c576832e3a36df84168fbf17af697a4` |
| `0076_receipts_are_money` | opens no transaction of its own and is applied through the CLI; its first statement refuses a role that row security binds; its counts are `RAISE NOTICE`s, which `db query` drops | 78 | `fd0dc1ac2c2dfcd2566fde4eac817ccb` |
| `0077_milestones_realtime` | none | 72 | `33d973fc5cacba0c0fad95a653ff7b75` |
| `0078_quota_exemption_bounded_by_size` | none | 77, 65 | `56277f68cccf8285571e77a96f145d12` |
| `0081_file_media_metadata` | none | 81 | `26a1160d86976d66558cdef6ba9b868e` |
| `0082_private_project_definers` | refuses without 0072 | 82 | `e3ce7cc3d831c4fc1da5f3bf3969f672` |
| `0083_private_project_file_gates` | refuses without 0072 | 83 | `d5333755cb2922c6dfa31a0ac20e2265` |
| `0084_shot_lists_and_edits` | refuses without 0082; backfills *Shot list 1 · v1* for every project with scenes or shots. Probe ([BC] §1): `select count(*) as lists, (select count(*) from public.shot_list_items) as items from public.shot_lists` | 84, 85, 86 | `99354e421d51cef758c77abcd5b86110` |
| `0085_file_tags` | `db query --file`, never `db push` | 87 | `570cdbd41d4014f23884aec83f2628fa` |
| `0086_shot_list_withdraw` | refuses without 0084 | 88 | `6e6184501a1aef4aa1f7d43ae230d666` |
| `0088_legal_files` | `db query --file` after 0085, never `db push`; refuses a role that row security binds, a database without `files.tags`, a path that already has `LEGAL` as its third segment, and a files row with a locked third segment on a key not shaped `projects/{id}/{SEGMENT}/…`. Deploy `storage-presign` after it ([K]; [OUT] S4b-02). Probe: `select public.rabbit_money_segment('LEGAL')` → `true` | 90 | `a0f9c14118f3a1884fde46a1aa830707` |
| `0089_budget_versions_open` | refuses without 0084 or 0037 | 91 | `f03f8281403d5c4275ef9880b88aea2a` |
| `0090_schedule_set_aside` | refuses without 0089 or 0067 | 92 | `57a1974cd745461d80f0a10c3370ec27` |
| `0091_bins_on_the_cloud` | needs 0084, 0082, 0072, 0042, 0054, 0088 and the `rabbit-thumbnails` bucket (0053, a5); the outside-viewing switch is created off | 93, 94 | `121ea797883ec075a88169b4053ac076` |
| `0092_legal_gate_managers` | `db query --file` after 0088, never `db push`; refuses a role that row security binds, and a file that is both financial and Legal. Probe ([K]): `select public.can_access_project_legal('00000000-0000-0000-0000-000000000000')` → `false` | 95 | `aca34de796588cf4add27e707562f683` |
| `0093_file_gateway` | needs `pgcrypto` in `extensions` (a3) and `file_events_select` as 0092 wrote it; creates pg_cron where available and schedules `wilson-gateway-sweep` (`*/5 * * * *`), with no post-condition of its own on it. Probe: `select jobname, schedule from cron.job where jobname = 'wilson-gateway-sweep'` → one row. Its five functions and their secret: (c), (d) | 96 | `24608d40a8ef6d4ef735ad67912c4eb8` |
| `0095_gateway_next_root_viewing_fraction` | needs 0093 in its final shape; `gateway-enrol`, `gateway-sync` and `gateway-events` changed with it ([K]) | 98 | `28c15280beb722cca533fa0cb9285fec` |
| `0096_task_items` | refuses if a later version is recorded; checks `fn_realtime_broadcast` by md5 (0091's `87af1ac50c6f007bf7b45566ba3cbe16` or its own `2e8cc917144b17b674af3ca03fa76055`) | 99 | `9e0125b552a6281f5f87d8a13b344a43` |
| `0097_no_main_item` | refuses if a later version is recorded, and unless `tasks_select` is 0034's or its own; [K]'s probe takes the counts first | 100 | `6b7690a18e68469136c5de213a3347fe` |
| `0098_table_views` | refuses if a later version is recorded; the broadcast body's md5 must be 0096's or its own `e5abdcf2b8abce914416acb148144971` | 101 | `70aea652223ac14baae5b9a4c90f06be` |
| `0099_asset_level_links` | refuses without 0098 or 0084 | 102 | `3999b0c5a43a8d8e941ace2650bb181b` |
| `0100_otter_subject_shares` | refuses unless the applying role has BYPASSRLS (a1) | 103 | `19491dd13c1a118dbc0627bc5e6a7146` |
| `0101_versions_and_items_realtime` | needs 0096, 0072, 0037, 0016 and 0018. Probe ([K]): triggers `trg_budget_versions_realtime:O, trg_task_items_ws_realtime:O`, and `md5(replace(prosrc, chr(13), ''))` of `public.fn_realtime_broadcast()` still `e5abdcf2b8abce914416acb148144971` | 104 | `d87f3daed0de606a12f42970f89aedc0` |
| `0103_project_status_desktop_values` (M2) | three `ALTER TYPE public.project_status ADD VALUE IF NOT EXISTS` and nothing else, since a value cannot be used in the transaction that adds it; applied as its header says, the statements in one call and the history row in a second; rehearse it alone (step 2), and run suite 106 only after it commits, never in one transaction with it. **An enum value cannot be removed** (h) | 106 | `1426f7c5501dd8000b25e903975d9cf7` (at `4953cf64`, as M2 recorded it) |
| `0104_bins_vetted_and_gateway_names` (P8) | needs 0093 and 0095 in their final shape (restates `gateway_enrol_apply`, `gateway_sync_apply`, `gateways_visible` and `gateway_clips_for_tickets` whole, the header diffing each). **No backfill**: every existing `bin_files` and `bin_locations` row starts unchecked, and the gateway serves none of them until an admin or manager marks it (the Bins tab's **Mark as checked**); write the counts at the apply (dev's: 2 clips, 2 locations, all unchecked, `po-p8-2026-10-28.md` §2). `gateway-enrol`, `gateway-sync` and `gateway-reach` after it, (c). Its §3b restates `copy_bin_files` and `restore_bin_files` (a copy or an undo is no check) and a check or a withdrawal by hand is of the file (an AFTER trigger), build rounds 1 and 2's corrections: dev holds the corrected file (its §3 and §3b re-applied as statements, the history row's statements replaced); staging applies the file as committed | 107 | `8d9e3c61a8b6fd370fa6111cd01dc9fc` |
| `0105_two_factor_step_up` (P8) | needs 0093, 0048 and 0104; `two_factor_satisfied()` reads `auth.mfa_factors` (the applying role must, a1). An admin signed in without their authenticator code can no longer flip the switch, manage the gateway or change the storage settings (the app's sign-in gives aal2). `gateway-reach` after it, (c) | 108 | `600918749bd670dc076f402d7f3f1267` |
| `0106_s3_endpoint_public_hosts` (P8) | restates 0052's `workspace_storage_s3_config_chk` with the public-host arm (its pre-flight counts the rows the arm would refuse and stops with the count, none on dev) and 0066's `platform_audit_action_check` with `secret.resealed`; `storage-secret`, `storage-gc` and `operator-ai-keys` after it, (c) | 109 | `50f8f796ef8c309047a3824f65b35474` |

**The numbers with no file, so nobody looks for them:** **0065** (the subject-shares draft of 2026-08-12, applied on no
environment, removed by B1; 0100 replaced it); **0079** and **0080** (reserved on paper for bins and assemblies, retired by 0091:
they would sort before files already applied everywhere, and edits superseded assemblies); **0087** (held for S3b, never used);
**0094** (reserved, with suite 97, for aligning 0091's `unc_path` CHECK, BC3's deferral; `po-gw5-2026-10-12.md` leaves it to the
controller); **0102** (reserved, with suite 105, for the avatars bucket's policy, `po-b1-2026-10-27.md` §6). 0094 already sorts
before files applied on dev and staging (0095 to 0101), and 0102 does on dev, where M2 applied 0103, the reason 0079 was retired:
walkthrough 85, Q5.

---

## (c) The Edge Functions

**Deploy all 23 from the release worktree, whatever (a8) shows.** Production's copies, where it has any, predate shared modules
that every function bundles (`_shared/adminGuard.ts` reaches 21 of the 23; a change to a shared module is a redeploy of every
function that bundles it), and the documents disagree about what is there (below). A version number counts per project and proves
nothing across them: *"Diff the source, never the version"* (`docs/MASTER_PLAN.md`).

**P8 (night 5, 2026-10-28) redeployed these on wilson-dev; staging owes each, and production deploys all 23 anyway:**
`storage-secret` and `storage-gc` (TPN-NET-016, TPN-ENC-015), `operator-workspaces` (TPN-CONT-018), `ai-files` (TPN-AI-011,
TPN-ENC-015), `gateway-reach` (TPN-AUTH-013), `gateway-enrol` and `gateway-sync` (TPN-ENC-013; after 0104), `operator-ai-keys`,
`storage-presign` and `storage-read-urls` (TPN-ENC-015). `ai-proxy` was not redeployed (outside the four areas) and must be before
any AI-key re-seal, (d). Deploy the ten after 0104, 0105 and 0106 are applied and recorded, (b).

**First, the rollback copies.** Production's current functions came from several commits, so the only copy of each is the deployed
one. A download writes `supabase\functions\<name>\` and the `_shared` files it bundles under its workdir, overwriting what is
there, so it goes into a scratch folder of its own and never into a repository (`docs/sessions/TRACK_C_storage_files_prompt.md`;
`track-c-C1-2026-09-06-part2.md`). For each name (a8) lists: `supabase functions download <name> --project-ref
rqyriuyldhovirbuievt --workdir <W>\before\<name>`. Proof: each `<W>\before\<name>\supabase\functions\<name>\` exists, and
`git status --short` in the release worktree is empty.

**Then the deploys**, one command per name in the table, from the release worktree's `WILSON\` (the CLI reads
`supabase\config.toml`, which gives all 23 `verify_jwt = false`: the platform's own check accepts only HS256 and this project signs
ES256, the file's own comment; `--no-verify-jwt`, as the gateway hand-offs write it, is the same):

```
supabase functions deploy <name> --project-ref rqyriuyldhovirbuievt
```

**When:** after (b), in the same sitting; eight have a migration they need first (the table's third column), and an old copy runs
against the new schema in between (harmlessly, by each file's header, but there is no reason to leave the window open). A function
reads its secrets on its next call, so (d)'s settings may follow ([OWED] §5).

| Function | Reads (secrets by name; † optional, the code has a default) | Needs first | Production per the documents |
|---|---|---|---|
| `admin-create-user`, `admin-reset-password`, `admin-user-security` | platform keys; `WILSON_REQUIRE_ADMIN_MFA`† | — | the July set ([HB] §4.6) |
| `admin-set-active` | platform keys; `WILSON_REQUIRE_ADMIN_MFA`† | — | the July set |
| `ai-files` | `ANTHROPIC_API_KEY`, `WILSON_AI_KEY_SECRET`; `AI_FILES_RPM`†, `AI_FILES_MANAGE_RPM`†, `AI_FILES_LIST_RPM`† | — (FX12: no migration) | **v1, the upload-only copy of 2026-08-11** (commit `6d4ac65e`); FX12's is not there ([K], 2026-10-26: *"Production: not touched"*) |
| `ai-proxy` | `ANTHROPIC_API_KEY`, `WILSON_AI_KEY_SECRET`; `AI_PROXY_RPM`† | — | byte-identical on all three on 2026-08-03 (`docs/MASTER_PLAN.md`) |
| `gateway-enrol`, `gateway-sync` | `WILSON_GATEWAY_KEY_SECRET`, `WILSON_SITE_URL`; `WILSON_GATEWAY_WEB_ORIGINS`†, `WILSON_GATEWAY_MINIMUM_VERSION`†, `WILSON_GATEWAY_HARD_MINIMUM_VERSION`†; `GATEWAY_ENROL_PER_MINUTE`†, `GATEWAY_SYNC_PER_MINUTE`† | 0093, 0095 | **absent** (`po-gw1-2026-10-10.md` §6: *"Prod … when the gateway ships"*) |
| `gateway-events` | the version floors†; `GATEWAY_EVENTS_PER_MINUTE`† | 0093, 0095 | **absent** |
| `gateway-ticket` | **`WILSON_GATEWAY_KEY_SECRET` (required: without it a play answers 503 `crypto_unavailable`)**; the floors†; `GATEWAY_TICKET_PER_MINUTE`† | 0091, 0093 | **absent** |
| `gateway-reach` | `GATEWAY_REACH_PER_MINUTE`† | 0093 | **absent** |
| `invite-member` | `WILSON_SITE_URL` (it builds the email's link) | — | the July set |
| `issue-session` | platform keys | — | the July set |
| `operator-ai-files` | `ANTHROPIC_API_KEY`; `OPERATOR_WRITE_RPM`† | — | **absent** ([K]) |
| `operator-ai-keys` | `WILSON_AI_KEY_SECRET`; `OPERATOR_WRITE_RPM`† | — | the July set |
| `operator-models` | `ANTHROPIC_API_KEY`; `OPERATOR_WRITE_RPM`† | — | reached production in S21 (`docs/MASTER_PLAN.md`) |
| `operator-storage-plans` | `OPERATOR_STORAGE_RPM`† | — | not stated anywhere |
| `operator-workspaces` | `WILSON_SITE_URL`; `OPERATOR_READ_RPM`†, `OPERATOR_WRITE_RPM`† | 0066, 0074 | **v9 of 2026-08-08**, before 0064 and 0066 ([C2]; `track-a-A1-2026-09-06.md`) |
| `resolve-login` | `RESOLVE_LOGIN_COMPANY_RPM`†, `RESOLVE_LOGIN_USER_RPM`† | — | **v8**, before B1's durable limiter of 2026-09-06 ([C2]) |
| `storage-gc` | `WILSON_STORAGE_KEY_SECRET` | 0073 | **v8** (`track-c-C1-2026-09-06-part2.md`) |
| `storage-presign` | `WILSON_STORAGE_KEY_SECRET`; `STORAGE_PRESIGN_RPM`† | 0088 | **v3**, without 0088's `LEGAL` ([C2]; [OUT] S4b-02) |
| `storage-read-urls` | `WILSON_STORAGE_KEY_SECRET` (required: without it a read answers 503 `crypto_unavailable`); `STORAGE_READ_URLS_RPM`† | — (P1: no migration) | **absent**: new in P1 (night 4), on dev only (`po-p1-2026-10-28.md` §2) |
| `storage-secret` | `WILSON_STORAGE_KEY_SECRET`; `STORAGE_SECRET_RPM`† | — | deployed to all three in S37 (commit `bf908586`) |

*Platform keys* are `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, which the platform provides to every
function and nobody sets.

**Where the documents disagree** (a8 settles each one):

1. **How many, where.** [HB] §4.1 said every function is on all three environments, and §4.6 twelve (both corrected 2026-10-28);
   [P] §1 (2026-10-27) says 22 on dev and staging and that production lacks the ones since July. Yet the hand-offs record
   post-July functions on production (`operator-models` in S21, `storage-presign` v3, `ai-files` v1, `storage-secret` in S37).
2. **The AI file store on staging.** [OUT] FX12-01 and walkthrough 76 (2026-10-25) say `ai-files` and `operator-ai-files` are on
   dev only; [K] and the merge `402b6ed5` (2026-10-26 15:00 UTC) record `ai-files` v3 and `operator-ai-files` v1 on staging.
   Production lacks both FX12 copies by every account.
3. **`storage-presign`.** [K] records dev v4 on 2026-10-02 and staging on 2026-10-05; P1 downloaded both on 2026-10-28 and found dev v5 and staging v5, the repository's copy byte for byte ([OUT] S4b-02, closed for both). Production holds v3.
4. **`storage-gc`.** [OUT] S4c-10 is open; [K] records staging v12 on 2026-10-12. Production is owed either way.
5. **`operator-workspaces`.** [OUT]'s setup-link note (2026-09-06) says production has *"neither 0064, 0066 nor the function"*;
   [C2] the next day records production at v9.

**Proof, per function.** The source: `supabase functions download <name> --project-ref rqyriuyldhovirbuievt --workdir
<W>\after\<name>`, and the files under its `supabase\functions\` (the function and the `_shared` files it bundles) identical to the
release commit's. `supabase functions list --project-ref rqyriuyldhovirbuievt` shows all 23. Two answers tell FX12's copies from
the old ones, in Git Bash (in Windows PowerShell 5.1 `curl` is `Invoke-WebRequest`, and the quoting below is bash's): an
unauthenticated `curl -s -o /dev/null -w '%{http_code}\n' -X DELETE https://rqyriuyldhovirbuievt.supabase.co/functions/v1/ai-files`
prints 401 (the old copy 405, `po-fx12-2026-10-25.md` §6), and `curl -s -o /dev/null -w '%{http_code}\n' -X POST -d
'{"action":"summary"}' https://rqyriuyldhovirbuievt.supabase.co/functions/v1/operator-ai-files` prints 401. For every other
function the source comparison is the proof.

---

## (d) The secrets

**Names only, here and everywhere.** Edge Function secrets live in each project's own store (dashboard → Edge Functions →
Secrets, or `supabase secrets set`). They are not GitHub's repository secrets and not Vercel's environment variables: three stores
that do not talk to each other ([OWED] §5's table).

| Secret | Read by | Held, per the documents | Across environments |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | `ai-proxy`, `ai-files`, `operator-ai-files`, `operator-models` | all three, digests matching, 2026-07-30 ([OWED] §5) | one platform key behind all three ([HB] §13.1), so one AI file store (TPN-AI-010) |
| `WILSON_AI_KEY_SECRET` | `ai-proxy`, `ai-files`, `operator-ai-keys` | all three, digests matching, 2026-07-30 ([OWED] §5) | **identical today, so that a company key stored on one opens on the others.** A new value orphans every stored company key, and `ai-proxy` falls back to the platform key quietly ([OWED] §9C; TPN-ENC-011). The sameness itself is TPN-ENC-015 |
| `WILSON_STORAGE_KEY_SECRET` | `storage-gc`, `storage-presign`, `storage-read-urls`, `storage-secret` | all three, identical, set in the dashboard, 2026-08-08 ([OWED] §9 C2) | **identical today**, for the same reason; a new value orphans every bucket secret and `storage-presign` then fails closed. The sameness is TPN-ENC-015 |
| `WILSON_GATEWAY_KEY_SECRET` | `gateway-ticket` (required), `gateway-enrol`, `gateway-sync` | dev, 2026-10-10 (`po-gw1-2026-10-10.md` §2); staging, 2026-10-12 ([K]; merge `708e93be`). **Not production** (`po-gw1` §6) | **a fresh value per environment**, as dev and staging have; no document asks them to match |
| `WILSON_SITE_URL` | `invite-member`, `operator-workspaces`, `gateway-enrol`, `gateway-sync` | *"already set on all three"* ([OWED] §6); production's value is not recorded | per environment: production's must be the web host of (f), or invite and setup-link emails link elsewhere |
| `WILSON_REQUIRE_ADMIN_MFA` | every function bundling `adminGuard` | unset anywhere, by the documents; off by default ([HB] §4.6; TPN-AUTH-003) | her call, not this runbook's |
| the rate-limit and gateway-floor names in (c)'s table | their functions | unset anywhere, by the documents | optional: the code's defaults apply |

**TPN-ENC-015, at release.** The two encryption secrets are the same on all three environments, so a lower environment's value
opens production's company keys and bucket secrets, in every nightly dump that leaves for B2. She ruled it among the seven fixed
before the release (walkthrough 85 Q1, (a), 2026-10-28), and production is the cheapest place to start: while a7 reads 0 bucket
secrets and 0 AI keys, a fresh value there orphans nothing. The value is made and set as the gateway's is below. Phase 8's session
plans the other two environments with the controller (`TPN_AUDIT/REMEDIATION_PLAN.md`: a re-seal where ciphertexts exist).

**The re-seal on dev and staging** (P8, night 5, 2026-10-28; the code reads a secret by version: the unsuffixed name is version 1,
`_V2` to `_V9` the rest, the highest present seals new rows, and a row is opened under the version its envelope names). Each
secret separately, dev first, then staging, and nothing on production (it gets a fresh version-1 value above, with no rows to
move): (1) `supabase secrets list --project-ref <ref>` and note the digest beside the name; (2) make and set the NEXT version
without showing it — the two lines of *Setting what production lacks* with the name `WILSON_AI_KEY_SECRET_V2` (then
`WILSON_STORAGE_KEY_SECRET_V2`); (3) redeploy every reader of that secret on that environment and wait for each deploy
CONFIRMED before going on — the AI key's: `ai-proxy`, `ai-files`, `operator-ai-keys`; the bucket secret's: `storage-presign`,
`storage-gc`, `storage-read-urls`, `storage-secret`, `operator-ai-keys`. A reader built before P8 fails at `atob` on a `v2.`
envelope, and `ai-proxy`'s own catch would then route every company to the platform key; (4) `/wilsonadmin` → **Secrets**: the
card shows the versions set and the rows under each; press **Re-seal** and confirm: every row is opened under the version its
envelope names and sealed again under `_V2`, and one `platform_audit` row, `secret.resealed` (WIL-7013), carries the counts;
(5) verify by query, never by the card alone (its read is paged; the query is the truth): `supabase db query --linked "select
count(*) filter (where key_ciphertext like 'v2.%') as v2, count(*) as rows from public.workspace_ai_keys"` (for the bucket
secret, `secret_ciphertext` in `public.workspace_storage_secrets`) reads `v2` equal to `rows`; then one working proof as in the
digest procedure above (a company key used by a generation; a bucket secret's **Test**); (6) `supabase secrets unset WILSON_AI_KEY_SECRET --project-ref <ref>` (then the
storage name): the readers take the store's names at call time, so nothing is redeployed; (7) `supabase secrets list` on each
environment: the digest beside `_V2` differs between dev and staging, production holds its own version-1 value, and the old name
is gone from dev and staging. A later rotation is the same with `_V3`.

**The digest procedure** ([OWED] §5, §9 C2). `supabase secrets list --project-ref <ref>` prints each name with a digest of its
value, never the value. Run it for production and for staging and compare the digest beside each name. **A matching digest proves
the value is the same, not that it works** ([OWED] §9 C2), so each secret gets its working proof once a signed-in person exists
((g) 16): `WILSON_AI_KEY_SECRET`, a company key saved with the console's **Set key** and **Store key** on a test company;
`WILSON_STORAGE_KEY_SECRET`, the first bucket secret saved in Admin terminal → **Storage** (a malformed key fails there by name,
*"must decode to exactly 32 bytes"*); `WILSON_GATEWAY_KEY_SECRET`, after the first gateway enrolment, `supabase db query --linked
"select inet_server_addr() as host, count(*) as keys, (select count(*) from public.workspaces) as workspaces from
public.gateway_signing_keys"` → 1 (a key is stored only when the secret seals it; `gateway-enrol` enrols without one and says
nothing, `gateway-enrol/index.ts`), and the first clip played through a confirmed gateway answers a ticket, never 503
`crypto_unavailable`.

**Setting what production lacks.** A value that must match another environment's is pasted by her into production's dashboard
from where she keeps it; the CLI never reads a value back. A fresh value (`WILSON_GATEWAY_KEY_SECRET`, or either encryption secret
under TPN-ENC-015) is made and set without ever being shown, as `po-gw1` §6 does it, in Git Bash:

```
V="$(openssl rand -base64 32)" && supabase secrets set "WILSON_GATEWAY_KEY_SECRET=$V" --project-ref rqyriuyldhovirbuievt
printf '%s' "$V" | sha256sum | cut -c1-8; unset V
```

The second line prints an eight-character fingerprint for the hand-off.

---

## (e) The two Auth hooks and the session time-box

After 0070 and 0071 are applied and recorded, and once production has an app to sign in to ((g) 12). Dashboard steps ([OWED] §14;
[BC] §5); on production they are hers to click unless she hands the controller the dashboard.

1. Dashboard → wilson-prod → Authentication → **Hooks** → **Add hook** → *Password verification attempt*: hook type
   **Postgres**, schema `public`, function `hook_password_verification_attempt`. Enable.
2. Same page → **Add hook** → *MFA verification attempt*: Postgres, `public`, `hook_mfa_verification_attempt`. Enable.
3. Authentication → **Sessions**: *time-box user sessions* at 4 hours or more and *inactivity timeout* at 30 minutes or more, so
   the server never signs someone out before the app's own 25/30-minute idle warning and 4-hour cap say why ([OWED] §14; AS-3.8).

**Proof.** She signs in to the production app once with a wrong password, then correctly, then completes two-factor. Then
`supabase db query --linked --file scripts/probes/auth-events-recent.sql` → a `sign_in / failure`, a `sign_in / success` and an
`mfa_verify / success` row, **each with `source = gotrue_hook`**. The client writes its own `sign_in / success` row on every
sign-in, hooks or not (`source = client`, 0070), so only the hook's rows prove a hook. Nothing here can lock anyone out: both
functions answer *continue* on every path, including when their own insert fails ([OWED] §14).

Staging and dev need the same three steps; [OWED] §14 and [BC] §5 record them as hers and no document records them done
(2026-10-28). That is (g) 3.

---

## (f) The builds

**The web.** [WD] describes one Vercel project, `petal-studios/wilson`: production branch `feat/multi-user-v1`, built against
**wilson-staging**, at `https://beta.petalstudios.co/wilson`; the same deployment serves the operator console at
`/wilsonadmin` on `beta.` and on `https://admin.petalstudios.co` ([OWED] §11C, §12). **No document describes a web deployment
against wilson-prod**, and production needs one for more than the app: the operator console is web-only (`vite.config.js` keeps it
out of the installer), and invite and recovery links need a web address ([HB] §9). Where it lives is her question (walkthrough 85,
Q3). Whichever she picks, it is built by `vercel.json`'s `npm run build:vercel && npm run build:vercel:admin` (both surfaces), and
needs, per [WD]: the build-time `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` of production (the anon key is publishable; RLS
is the boundary), `WILSON_SITE_URL` on production's Edge Functions ((d)), and production's Authentication → URL Configuration naming
the host. Proof: the deployed bundle carries `rqyriuyldhovirbuievt` and neither `rzkirvkotslbovzbsdfh` nor `eqjzmnvkrakroyqxfsvw`
(fetch `<host>/wilson/`, then the `index-*.js` it names, and search it), and both `/wilson` and `/wilsonadmin` answer with their
sign-in.

**The desktop.** Only `npm run dist` ships (electron-builder, NSIS, `package.json` `build`, written to **`release\`**);
`forge.config.cjs` makes no updatable artefact ([HB] §11). The renderer's Supabase settings are compiled in by Vite at build time,
and `userData/env.json` cannot change them (`electron/env.cjs`, its header); `.env.local` on her machine points at **wilson-dev**
([WD] *Builds*; TPN-SDLC-008). So:

1. Build from a clean checkout of the release commit with **no `.env.local`**, in a shell where **no `VITE_*` variable is set**
   (a shell variable outranks every `.env` file), and a `WILSON\.env.production` (ignored by `.env.*` in `.gitignore`) holding
   production's `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and `VITE_SENTRY_*` if the renderer should report (names from
   `.env.example`; values typed by her). The packaged main process reads its own settings from `{userData}\env.json`, where
   `WILSON_ENV` defaults to production (`electron/env.cjs`).
2. **ffmpeg.** A clean checkout carries none: `resources/ffmpeg/` holds only its README (which asks for an LGPL build) and a
   `.gitignore`. Either put that `ffmpeg.exe` there before the build, or ship without it and keep OUTSTANDING's *Professional
   codecs have no preview* entry as the limit: her choice, recorded in the hand-off. Proof: `release\win-unpacked\resources\ffmpeg\`
   holds what was chosen.
3. `npm run dist`. Proof: `findstr /s /m rqyriuyldhovirbuievt dist\assets\*.js` names a file; the same search for
   `eqjzmnvkrakroyqxfsvw` and for `rzkirvkotslbovzbsdfh` names none; `release\` holds the installer, its `.blockmap` and
   `latest.yml`.
4. After (g) 13, since production holds no company before it: install it on a clean Windows account and sign in once (hers) to
   her company: the company step answers against production.
5. **Publish by hand.** The feed is `package.json`'s only publish entry, the `generic` provider at
   `https://updates.petalstudios.co/wilson` (B2 behind it, [HB] §8); electron-builder has no uploader for a generic feed, so
   `npm run dist:publish` uploads nothing. Upload `release\latest.yml`, the installer and its `.blockmap` to the feed's bucket. Proof:
   `curl -s https://updates.petalstudios.co/wilson/latest.yml` names `version: 1.0.0` and that installer.

**The file gateway** ships on its own pipeline (`.github/workflows/gateway-release.yml`, a `gateway-v*` tag; walkthrough 63), not
with the app's tag. Its compiled-in cloud is production (`gateway/src/cloud/client.mjs`), so a gateway release works only once (c)
has put the five `gateway-*` functions there.

---

## (g) Release day, in order, with her steps between

| # | Who | Step | Proof |
|---|---|---|---|
| 1 | Audrey | Rotate `smoke_admin` on wilson-dev, update the `DEV_PROBE_PASSWORD` GitHub secret, re-run CI ([OWED] §0; TPN-SDLC-007) | CI's Playwright job green on the re-run |
| 2 | Audrey | Roll staging's legacy `service_role` key: dashboard → wilson-staging → Settings → API → Legacy API keys ([OUT] security entry, S19) | the dashboard shows the new key; the functions take it from the platform with no redeploy (`docs/sessions/MASTER_PLAN_S19_ONWARD.md`), and the beta still signs in. If the dashboard says the roll also replaces the **anon** key, stop first: the beta's build carries it (`VITE_SUPABASE_ANON_KEY` in Vercel, [WD]) and would need it and a redeploy |
| 3 | Audrey | The two Auth hooks and the session settings on staging and dev, (e) 1–3 ([OWED] §14) | (e)'s probe on each |
| 4 | Audrey | The gateway's GitHub setup (the release signing key as a repository secret, once) and the Windows installer rehearsal (walkthrough 63). **And the successor release key** (P8, TPN-ENC-016): `node gateway/pipeline/cli.mjs make-key --out <a folder outside the repository>` once, the private half kept with the first key (never in the repository or a chat), the printed slot line pasted into `RELEASE_KEYS_WIRE` and the one-key pins moved (`docs/gateway/HARDENING.md` §10, *Rotating the release key*, steps 1 and 2), landed before (g) 8: every 1.0.0 install then trusts both keys, so the first rotation needs no MSI reinstall | the rehearsal's own checks in 63; `RELEASE_KEYS_WIRE` with two entries and `npx vitest run gateway` green |
| 5 | Audrey | `docs/RELEASE_TESTING.md` worked and ticked, every `[BLOCKING]` passed or knowingly waived | the ticked file |
| 6 | Audrey | PR #4's title and body pasted (the draft below) | the PR page |
| 7 | Audrey | Her answers to walkthrough 85 (the gate's findings fixed or ruled; production's web host; the first operator; 0094 and 0102) | the answers in the chat |
| 8 | Controller | The gate in §0; then the release commit: `CHANGELOG.md`'s 1.0.0 heading dated with the day planned for (g) 20, landed on `feat/multi-user-v1` through the integration branch's beta merge, and its hash recorded. From here nothing else lands there until (g) 20 (§0) | the *Release gate* line, or her rulings; the hash in the hand-off, its `CHANGELOG.md` heading dated |
| 9 | Controller | (a) a1–a11 | every read in the hand-off |
| 10 | Controller | (b): the chain rehearsal, every file, then the suites | (b)'s proofs |
| 11 | Controller | (c), the rollback copies first; (d)'s settings | (c)'s source comparison; (d)'s digests |
| 12 | Controller, with her | (f) the web: production's web app and console per Q3, the Auth URL Configuration, `WILSON_SITE_URL`; (f) the desktop: steps 1–3 (built; not yet installed or published) | (f)'s proofs |
| 13 | Controller, with her | The first operator, if a6 read no company of hers, as Q4 decides: by Q4(a), the five steps under this table; then (f) the desktop, step 4 | she signs in to production's `/wilsonadmin` and sees **Companies**; the installed desktop signs in to her company |
| 14 | Audrey | (e) on production | (e)'s probe, rows from `gotrue_hook` |
| 15 | Audrey | The invite and recovery templates uploaded to production (`supabase/templates/invite.html`, `recovery.html`; Authentication → Email Templates) and SMTP confirmed as Resend ([OWED] §12; S18) | an invite sent to an address with no production account (not the one (g) 13 used, which answers *That email is already associated with a WILSON account.*) stays unspent for minutes, then opens *Welcome to WILSON* with **Continue** first (`docs/RELEASE_TESTING.md` §B) |
| 16 | Controller, with her | (d)'s working proofs: **Set key** on a test company; a bucket secret if she has a test bucket; the gateway's after its first enrolment | each proof as (d) says |
| 17 | Controller, with her | The operator console's **AI files** on production: read *Tied to a company of this environment*, sweep, read again, **before 2026-11-09** ([OUT] FX12-01; walkthrough 76 part C). With a7's `ai_uploads` at 0 there is nothing to sweep: say so | the before and after counts |
| 18 | Controller | (f) the desktop, step 5: the feed | `latest.yml` names 1.0.0 |
| 19 | Controller, on her go | PR #4 merged into `main` through GitHub's merge button, **with a merge commit, never a squash** (`main` takes no direct push, [HB] §7.1; the rule is [HP] §6 and `docs/sessions/FIX_PLAN_2026-09-04.md`, "Release last") | `main`'s head is a merge commit with two parents |
| 20 | Controller, on her go | The tag `v1.0.0` on that merge commit, pushed | `git ls-remote --tags origin v1.0.0` names it, and `git diff <release commit> v1.0.0 -- WILSON/` is empty |

**(g) 13 by Q4(a): the first company, by SQL.** S43 removed self-serve companies and only an operator makes one, so the first
operator starts from a company written by hand, through the function the console's own **New company** calls
(`operator-workspaces`' create action calls `public.provision_workspace_and_admin`, 0009; service role only, and `db query` runs as
`postgres`). If Q4 is (b), the session that builds it replaces these five steps.

1. **Hers:** Dashboard → wilson-prod → Authentication → Users → **Add user** → **Create new user**: the address she will type into
   the console (not the one (g) 15 invites), a password she types, **Auto Confirm User** on. Proof: the user is listed.
2. **The controller:** `<W>\first-company.sql` holds one statement, `select * from public.provision_workspace_and_admin('<company
   name>', '<slug>', (select id from auth.users), '<username>', '<display name>');`: production holds that one user (a6 read 0), so
   the subquery fails safe if it does not. Its guards: a name of 1 to 80 characters, a slug of `^[a-z0-9][a-z0-9-]{1,62}$`, a
   username of `^[a-z0-9][a-z0-9._-]{1,31}$`. Rehearse it inside `BEGIN;` and `ROLLBACK;` ((b) step 2) → one row; then run it →
   one row, the company's id and slug. Proof: `supabase db query --linked "select inet_server_addr() as host, (select count(*) from
   public.workspaces) as workspaces, (select count(*) from public.workspace_members where app_role = 'admin' and is_active) as
   admins"` → 1 and 1.
3. **Hers:** production's app ((g) 12's web) → the company, the username, the password → **Secure your admin account** → enrol
   ([OWED] §12, step 2).
4. **The controller:** [OWED] §9B's `INSERT` with her address, by `db query`, then its check `SELECT` with `inet_server_addr()`
   added (rule 3) → her row and its `granted_at`.
5. **Hers:** production's `/wilsonadmin` → **Email**, **Password**, **Authenticator code** → **Companies**, (g) 13's proof.

**PR #4, as it stands** (read through the public API on 2026-10-28): open, `feat/multi-user-v1` into `main`, title *Feat/multi
user v1*, no body. A draft for her to paste or change:

> **Title:** WILSON 1.0.0 — multi-tenant cloud, the web app and the post-overhaul features
>
> **Body:** Merges `feat/multi-user-v1` into `main` for the 1.0.0 tag. What ships is `CHANGELOG.md`'s 1.0.0 entry; how it was
> tested is `docs/RELEASE_TESTING.md`; how production was brought up is `docs/PRODUCTION_RUNBOOK.md`; the security posture is
> `TPN_AUDIT/`. Merge with a merge commit, never a squash: the branch's history is the record the hand-offs cite by hash.

---

## (h) What can be rolled back, and what cannot

**Can be rolled back.**

- **An Edge Function**: `supabase functions deploy <name> --project-ref rqyriuyldhovirbuievt --workdir <W>\before\<name>
  --no-verify-jwt` (outside the repository there is no `config.toml`, so the flag is what keeps `verify_jwt` off; this is the
  first release, so there is no earlier release commit to deploy from), then compare sources as (c) does. A function production did
  not have before the release (a8: the five `gateway-*`, `operator-ai-files` and `storage-read-urls`, by the documents) rolls
  back by `supabase functions delete <name> --project-ref rqyriuyldhovirbuievt`.
- **The Auth hooks and session settings**: switch them off or back in the dashboard. The hooks answer *continue* on every path,
  so turning one off loses only its rows.
- **A web deployment**: Vercel → the project → Deployments → promote the previous one.
- **A pg_cron job**: `select cron.unschedule('<jobname>')`.
- **A secret** whose old value she still holds. `WILSON_AI_KEY_SECRET` and `WILSON_STORAGE_KEY_SECRET` are the exception: a new
  value orphans every stored company key or bucket secret, and only the old value undoes that ([OWED] §9C, §9 C2).
- **The update feed**: putting the previous `latest.yml` back stops the clients that have not yet updated.

**Cannot be rolled back, or only forward.**

- **A migration.** The repository has no down-migrations; the only reverse is a new, reviewed file. Deleting its history row
  (`supabase migration repair --status reverted NNNN --linked`) changes the record, not the schema, and leaves the two disagreeing.
- **A backfill** (0084's shot lists, 0076's receipts flagged as money): the rows written are data from then on.
- **An enum value added** (0103's three `project_status` values): Postgres has no `DROP VALUE`; removing one means rebuilding the
  type, and rows already holding it block that.
- **Anything users write after the release**: a restore of a backup also discards it, and the B2 dumps have never been restored
  (the drill is deferred, [OWED] §1); the platform's daily backup is the one to trust.
- **A desktop release once installed**: electron-updater does not downgrade, so a bad installer is followed by a newer one.
- **The merge into `main` and the pushed tag**: a revert commit, never a rewrite; a deleted tag may already have been fetched.
- **Emails sent** by invite-member or recovery while the templates or the URLs were wrong.
