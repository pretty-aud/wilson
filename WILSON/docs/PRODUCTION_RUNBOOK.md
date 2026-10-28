# WILSON 1.0.0 — the production runbook

The controller's ordered procedure for putting WILSON 1.0.0 on production
(`wilson-prod`, project ref `rqyriuyldhovirbuievt`). Written 2026-10-28 by R2 (night 4 of
`docs/sessions/PLAN_TO_1_0.md`) from the repository and its documents only: **no session read
staging or production to write it.** Every statement below about what an environment holds is a
document's, with its source and date; step (a) is where the controller replaces them with
measurements. Each step is a command or a dashboard action, then its proof. **Stop at the first
proof that does not read as written**, put what came back in the hand-off, and ask.

Not in this file, on purpose: Audrey's own setup tasks (`docs/OWED_AUDREY.md`), staging's
checklist of 2026-10-05 (`docs/sessions/BETA_CHECKLIST_2026-10-05.md`), the web host's setup
(`docs/WEB_DEPLOY.md`), the release test (`docs/RELEASE_TESTING.md`). Release day cites them.

Sources, by key: **[P]** `docs/sessions/PLAN_TO_1_0.md`; **[K]** the controller's kit,
`C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\00_HOW_TO_APPLY.md`;
**[B1]** `docs/sessions/handoffs/po-b1-2026-10-27.md` §4–§5; **[OWED]** `docs/OWED_AUDREY.md`;
**[HB]** `docs/SYSTEMS_HANDBOOK.md`; **[OUT]** `docs/OUTSTANDING.md`; **[BC]**
`docs/sessions/BETA_CHECKLIST_2026-10-05.md`; **[WD]** `docs/WEB_DEPLOY.md`; **[HP]**
`docs/sessions/HANDOFF_PROTOCOL.md`.

---

## 0. The gate, and the rules for every step

**The gate** ([P] §0 item 4): the controller's production steps start only after (1) her browser
steps in (g) 1–6 are done and (2) the first section of `TPN_AUDIT/SUMMARY.md`, *Release gate*,
reads **0 Critical and 0 High open in the four areas**. If it does not, nothing below runs until
she has ruled on each one it names.

**The rules.**

1. **No value of a secret, key or token** goes into this file, a transcript, a chat or a shell
   history. Secrets are set in the dashboard (Edge Functions → Secrets) or typed by her.
   `supabase secrets list` prints a name and a SHA-256 digest, never a value. Never filter the
   output of `supabase projects api-keys`; select the one field ([OUT] security entry, S19).
2. **Never `supabase db push`** (it would apply files out of the house method) and **never
   `supabase config push`** (it overwrites the hosted Auth and SMTP settings) ([K]; [WD]; [OWED] §14).
3. **One `db query` per call** ([HP] §2). Every read names its database: `inet_server_addr()`
   and a workspace count in the same query.
4. **Work from a release worktree linked to production.** The canonical checkout stays linked to
   wilson-dev. `scripts/tap-all.mjs` runs against whatever the checkout is linked to, so the suites
   in (b) need the release worktree's own link.
5. **One `tap-all` run at a time, against one project at a time** ([HP] §6: the CLI's temporary
   login role is per login, and two runs race).
6. **A file the controller writes for the database is written by a script, never by shell
   interpolation** ([B1] §5), and carries LF line ends.

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

The link asks for production's database password; she types it. Proof:
`supabase\.temp\project-ref` reads `rqyriuyldhovirbuievt`. Make an empty scratch folder `<W>`
outside the repository for the files of (b).

**The reads.** Each is one command; each answer goes in the hand-off.

| # | Command (from the release worktree's `WILSON\`) | The documents expect |
|---|---|---|
| a1 | `supabase db query --linked "select inet_server_addr() as host, current_user as role, (select rolbypassrls from pg_roles where rolname = current_user) as bypassrls, (select count(*) from public.workspaces) as workspaces"` | `bypassrls` true: 0069, 0076, 0088, 0092 and 0100 refuse a role that row security binds (measured on dev and staging, 0076's header, 2026-09-09; [B1] §5) |
| a2 | `supabase db query --linked "select inet_server_addr() as host, max(version) as last, string_agg(version, ' ' order by version) filter (where version >= '0055') as recent, (select count(*) from public.workspaces) as workspaces from supabase_migrations.schema_migrations"` | last `0063` ([P] §1, 2026-10-27; [K], 2026-10-26). Anything from 0064 on already present: (b) starts at the first absent file, and each present one is checked by step 5's md5 first |
| a3 | `supabase db query --linked "select inet_server_addr() as host, string_agg(extname || ' ' || extversion || ' in ' || extnamespace::regnamespace::text, ', ' order by extname) as ext from pg_extension where extname in ('pg_cron', 'pgcrypto', 'pg_net')"` | `pg_cron` present (0012, 0014 and 0057 scheduled jobs on every environment, [HB] §4.8); `pgcrypto in extensions` (0093 calls `extensions.gen_random_bytes`) |
| a4 | `supabase db query --linked "select inet_server_addr() as host, string_agg(jobname || ' ' || schedule || case when active then '' else ' (inactive)' end, ', ' order by jobname) as jobs from cron.job"` | the jobs of 0012/0014/0057/0058 (among them `wilson-purge-soft-deleted`, which 0067 relies on). If `cron` does not exist, stop: 0073's and 0093's jobs would not be scheduled, and they only warn |
| a5 | `supabase db query --linked "select inet_server_addr() as host, string_agg(id || ' public=' || public || ' limit=' || coalesce(file_size_limit::text, 'none'), ', ' order by id) as buckets from storage.buckets"` | `rabbit-files public=false limit=53687091200, rabbit-thumbnails public=false limit=262144, user-avatars public=true limit=2097152` (0027 and 0057, 0053, 0009). **`rabbit-thumbnails` must be `false`**; if it is not, stop (TPN-CLOUD-008). `user-avatars` public is the known TPN-CLOUD-004 |
| a6 | `supabase db query --linked "select inet_server_addr() as host, (select count(*) from public.platform_operators) as operators, (select count(*) from public.workspaces) as workspaces"` | at least one operator once she has enrolled two-factor and granted herself the tier on production ([OWED] §9A–B; fix plan answer 14). **If production holds no company she belongs to, stop:** two-factor is enrolled only in the product app (Settings → Profile; `src/admin/OperatorLogin.jsx` sends an unenrolled operator there), the operator tier needs it, and since S43 only an operator creates a company ([OWED] §12 Step 1 still names the removed *New company?* wizard). No document gives the first operator's way in on an empty environment: her question in walkthrough 85 |
| a7 | `supabase functions list --project-ref rqyriuyldhovirbuievt` | the deployed set; (c) compares it with the 22 in the tree |
| a8 | `supabase secrets list --project-ref rqyriuyldhovirbuievt`, then the same with `rzkirvkotslbovzbsdfh` (staging) | names and digests only; (d) says which must match |
| a9 | Dashboard → wilson-prod → Authentication: **Hooks**, **Sessions**, **Email Templates**, **URL Configuration** | Hooks: none (0070 is not on production, [OWED] §14). Sessions: note the time-box and the inactivity timeout. Templates: invite and recovery carry `{{ .TokenHash }}` (S18; uploaded by hand on staging only, `docs/RELEASE_TESTING.md` §C as of 2026-08-01). URLs: the site URL names the production web host of (f) |
| a10 | GitHub → Actions → **db-backups**: last night's run green, or **Run workflow** and wait for green | a fresh `db/prod/…` dump in B2 ([HB] §8; `.github/workflows/backups.yml`). No fresh dump: stop and ask her |

---

## (b) The migrations, by file, in order

**What production lacks** ([P] §1, [K]): every file from 0064 to the last merged. On
2026-10-28 that is the 33 files below, through **0101**; **0103** follows if M2 has merged
(night 4), and **0104** if P1's design needed one. Dev and staging are at 0101 ([P] night 3,
2026-10-28 05:05 UTC).

**The house method, per file** ([B1] §4; [K]). For file `NNNN` with name `N`:

1. **Drift.** `supabase db query --linked "select version from supabase_migrations.schema_migrations order by version desc limit 3"` → the previous file is last.
2. **Rehearsal, rolled back.** `<W>\rehearse-NNNN.sql` holds `BEGIN;`, the file's LF text and
   `ROLLBACK;`. `supabase db query --linked --file <W>\rehearse-NNNN.sql` → no error, and step 1
   reads the same. A file's preflight fires here, where it costs nothing. (No file in the range
   opens a transaction of its own; 0076's header says so for all of them.)
3. **The statements.** `supabase db query --linked --file <W>\NNNN.lf.sql` (an LF copy of the file).
4. **The history row.** `<W>\hist-NNNN.sql` holds
   `INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('NNNN', 'N', ARRAY[$m$<the LF file>$m$]) ON CONFLICT (version) DO NOTHING;`
   ([K]'s shape; no file contains `$m$`). `supabase db query --linked --file <W>\hist-NNNN.sql`.
   [OWED] §14 recorded 0071 on dev with `supabase migration repair --status applied 0071 --linked`;
   that writes no statements, so step 5 could not check it. Use the row.
5. **The md5.** `supabase db query --linked "select version, md5(statements[1]) from supabase_migrations.schema_migrations where version = 'NNNN'"`
   → the table's value, the md5 of the file's git blob (LF). Recompute it from the release commit
   (`git show <commit>:WILSON/supabase/migrations/<file> | md5sum`) and stop if it differs from
   the table (the table was measured at `51e5a0d7`).
6. **The file's own probe**, where the table gives one.

**The suites, after the last file** (step 7): `node scripts/tap-all.mjs` from the release
worktree, linked to production → every suite reads `collected = planned` and no failure, except
suite 74's #34 and #35, which count every `auth_events` row and so read 33/35 on any database
with real sign-ins: that is the healthy reading ([OWED] §14). **Why not one suite per file here,
as on staging:** production catches up 33 files at once, and the suites at the release commit test
the final schema. Several were extended by a later file (suite 70 by 0069, 74 by 0071, 78 by 0076
and 0092, 87 by 0088, 90 by 0092, and 01, 03, 04 and 45 by 0084), so run after an earlier file
they fail on probes whose migration has not landed. A one-file migration that comes later (0103)
takes its suite as staging did: rehearsed with it, then run after it.

| File | Special step beside it (from its header unless marked) | Suite | md5 of the LF blob |
|---|---|---|---|
| `0064_otter_course_nominations` | none. If it is ever replayed, replay 0069 straight after it | 70 | `a8ea19f4c1eab73a040bfe1646646465` |
| `0066_platform_audit_invite_sent` | one vocabulary in four places with `_shared/operatorGuard.ts` and `operator-workspaces`: deploy `operator-workspaces` after it, (c) | 35 | `049db9424c9001c2c101560d24192b20` |
| `0067_milestones` | relies on 0014's cron job `wilson-purge-soft-deleted`, not rescheduled here (a4) | 71 | `9c237f0c1c63404400724bf3d310bed7` |
| `0068_user_pets_stale_write_guard` | none | 56 | `aa336889d11452f24126720c6938678b` |
| `0069_otter_nomination_self_approval_audit` | applied by `db query --file`, never `db push`; refuses unless 0064's `otter_nomination_apply` is deployed and owned by a BYPASSRLS role and `app_events` exists | 70 | `c03a60d9e22c33be10200f65dba3263c` |
| `0070_auth_events` | the two Auth hooks are a dashboard step: (e), after 0071 | 74, 35 | `34e0447aea3edd823efd036d76d47b9b` |
| `0071_auth_events_admin_scope` | the history row as in step 4 | 74 | `38ada0146d542eb3d0ebfde94f75de54` |
| `0072_private_projects` | none | 80 | `d9ab44ec6ccba9fae162f2e04ef4f129` |
| `0073_upload_reservations` | needs `rabbit-files` at 53687091200 and `storage_free_tier_bytes()` 5368709120 (0057); schedules `wilson-sweep-abandoned-uploads` (`39 * * * *`) only where pg_cron exists, and a failure is a warning. Probe: `select jobname, schedule from cron.job where jobname = 'wilson-sweep-abandoned-uploads'` → one row | 77 | `0b422b764e8b00b2487cefc7f2e4cd76` |
| `0074_file_events_money_arm` | `storage-gc` and `operator-workspaces` call its functions: deploy them after, (c) | 78 | `5068e6c9f1c2ee2403927e07c70ec14e` |
| `0075_file_document_kind_and_description` | none | 79 | `4c576832e3a36df84168fbf17af697a4` |
| `0076_receipts_are_money` | opens no transaction of its own and is applied through the CLI; its first statement refuses a role that row security binds; its counts are `RAISE NOTICE`s, which `db query` drops ([B1] §5) | 78 | `fd0dc1ac2c2dfcd2566fde4eac817ccb` |
| `0077_milestones_realtime` | none | 72 | `33d973fc5cacba0c0fad95a653ff7b75` |
| `0078_quota_exemption_bounded_by_size` | none | 77, 65 | `56277f68cccf8285571e77a96f145d12` |
| `0081_file_media_metadata` | none | 81 | `26a1160d86976d66558cdef6ba9b868e` |
| `0082_private_project_definers` | refuses without 0072 | 82 | `e3ce7cc3d831c4fc1da5f3bf3969f672` |
| `0083_private_project_file_gates` | refuses without 0072 | 83 | `d5333755cb2922c6dfa31a0ac20e2265` |
| `0084_shot_lists_and_edits` | refuses without 0082; backfills *Shot list 1 · v1* for every project with scenes or shots. Probe ([BC] §1): `select count(*) as lists, (select count(*) from public.shot_list_items) as items from public.shot_lists` | 84, 85, 86 | `99354e421d51cef758c77abcd5b86110` |
| `0085_file_tags` | `db query --file`, never `db push` | 87 | `570cdbd41d4014f23884aec83f2628fa` |
| `0086_shot_list_withdraw` | refuses without 0084 | 88 | `6e6184501a1aef4aa1f7d43ae230d666` |
| `0088_legal_files` | `db query --file` after 0085, never `db push`; refuses a role that row security binds, a database without `files.tags`, or one where a path already has `LEGAL` as its third segment. Deploy `storage-presign` right after it ([K]; [OUT] S4b-02). Probe: `select public.rabbit_money_segment('LEGAL')` → `true` | 90 | `a0f9c14118f3a1884fde46a1aa830707` |
| `0089_budget_versions_open` | none | 91 | `f03f8281403d5c4275ef9880b88aea2a` |
| `0090_schedule_set_aside` | none | 92 | `57a1974cd745461d80f0a10c3370ec27` |
| `0091_bins_on_the_cloud` | needs the `rabbit-thumbnails` bucket (0053, a5); the outside-viewing switch is created off | 93, 94 | `121ea797883ec075a88169b4053ac076` |
| `0092_legal_gate_managers` | `db query --file` after 0088, never `db push`. Probe ([K]): `select public.can_access_project_legal('00000000-0000-0000-0000-000000000000')` → `false` | 95 | `aca34de796588cf4add27e707562f683` |
| `0093_file_gateway` | needs `pgcrypto` in `extensions` (a3); schedules `wilson-gateway-sweep` (`*/5 * * * *`) only where pg_cron exists, with no post-condition of its own. Probe: `select jobname, schedule from cron.job where jobname = 'wilson-gateway-sweep'` → one row. Its five functions and their secret: (c), (d) | 96 | `24608d40a8ef6d4ef735ad67912c4eb8` |
| `0095_gateway_next_root_viewing_fraction` | needs 0093 in its final shape; `gateway-enrol`, `gateway-sync` and `gateway-events` changed with it ([K]) | 98 | `28c15280beb722cca533fa0cb9285fec` |
| `0096_task_items` | refuses if a later version is recorded; checks `fn_realtime_broadcast` by md5 (0091's `87af1ac50c6f007bf7b45566ba3cbe16` or its own `2e8cc917144b17b674af3ca03fa76055`) | 99 | `9e0125b552a6281f5f87d8a13b344a43` |
| `0097_no_main_item` | refuses if a later version is recorded; [K]'s probe takes the counts first | 100 | `6b7690a18e68469136c5de213a3347fe` |
| `0098_table_views` | refuses if a later version is recorded; the broadcast body's md5 must be 0096's or its own `e5abdcf2b8abce914416acb148144971` | 101 | `70aea652223ac14baae5b9a4c90f06be` |
| `0099_asset_level_links` | none | 102 | `3999b0c5a43a8d8e941ace2650bb181b` |
| `0100_otter_subject_shares` | refuses unless the applying role has BYPASSRLS (a1) | 103 | `19491dd13c1a118dbc0627bc5e6a7146` |
| `0101_versions_and_items_realtime` | Probe ([K]): triggers `trg_budget_versions_realtime:O, trg_task_items_ws_realtime:O`, and `md5(replace(prosrc, chr(13), ''))` of `public.fn_realtime_broadcast()` still `e5abdcf2b8abce914416acb148144971` | 104 | `d87f3daed0de606a12f42970f89aedc0` |
| `0103_project_status_desktop_values` (M2, if merged) | adds three `project_status` values with `ALTER TYPE … ADD VALUE`; a value cannot be used in the transaction that adds it, so the file adds and does nothing else; read its header for how it is applied. **An enum value cannot be removed** (h) | 106 | from the release commit |

**The numbers with no file, so nobody looks for them:** **0065** (the subject-shares draft of
2026-08-12, applied on no environment, removed by B1; 0100 replaced it); **0079** and **0080**
(reserved on paper for bins and assemblies, retired by 0091: they would sort before files already
applied everywhere, and edits superseded assemblies); **0087** (held for S3b, never used);
**0094** (reserved, with suite 97, for aligning 0091's `unc_path` CHECK, BC3's deferral;
`po-gw5-2026-10-12.md` leaves it to the controller. Written now it would sort before 0095–0101,
which is the reason 0079 was retired: her question in walkthrough 85); **0102** (reserved, with
suite 105, for the avatars bucket's policy, written only if the avatar upload's refusal is proven to
be the policy: `po-b1-2026-10-27.md` §6).

---

## (c) The Edge Functions

**Deploy all 22 from the release worktree, whatever (a7) shows.** Production's copies, where it
has any, predate shared modules that every function bundles (`_shared/adminGuard.ts` reaches 20
of the 22; a change to a shared module is a redeploy of every function that bundles it), and the
documents disagree about what is there (below). A version number counts per project and proves
nothing across them: *"Diff the source, never the version"* (`docs/MASTER_PLAN.md`). The one
command, for each name in the table:

```
supabase functions deploy <name> --project-ref rqyriuyldhovirbuievt
```

run from the release worktree's `WILSON\`, so the CLI reads `supabase\config.toml`, which gives
all 22 `verify_jwt = false` (the platform's own check accepts only HS256 and this project signs
ES256: the file's own comment). `--no-verify-jwt`, as the gateway hand-offs write it, is the same.
The FX12 and checklist form `supabase --workdir "<checkout>\WILSON" functions deploy <name>
--project-ref <ref>` ([BC] §2; `po-fx12-2026-10-25.md` §6) is the same command from elsewhere.

**When:** after (b), in the same sitting. Five depend on a migration being there first, and an
old copy runs against the new schema in between (harmlessly, by each file's header, but there is
no reason to leave the window open). Set (d)'s missing secrets before or after: a function reads
its secrets on its next call, no redeploy needed ([OWED] §5).

| Function | Reads (secrets by name; † optional, the code has a default) | Needs first | Production per the documents |
|---|---|---|---|
| `admin-create-user`, `admin-reset-password`, `admin-user-security` | platform keys; `WILSON_REQUIRE_ADMIN_MFA`† | — | the July set ([HB] §4.6) |
| `admin-set-active` | platform keys; `WILSON_REQUIRE_ADMIN_MFA`† | — | the July set |
| `ai-files` | `ANTHROPIC_API_KEY`, `WILSON_AI_KEY_SECRET`; `AI_FILES_RPM`†, `AI_FILES_MANAGE_RPM`†, `AI_FILES_LIST_RPM`† | — (FX12: no migration) | **v1, the upload-only copy of 2026-08-11** (commit `6d4ac65e`); FX12's version is not there ([K], 2026-10-26: *"Production: not touched"*) |
| `ai-proxy` | `ANTHROPIC_API_KEY`, `WILSON_AI_KEY_SECRET`; `AI_PROXY_RPM`† | — | byte-identical on all three on 2026-08-03 (`docs/MASTER_PLAN.md`) |
| `gateway-enrol`, `gateway-sync` | `WILSON_GATEWAY_KEY_SECRET`, `WILSON_SITE_URL`; `WILSON_GATEWAY_WEB_ORIGINS`†, `WILSON_GATEWAY_MINIMUM_VERSION`†, `WILSON_GATEWAY_HARD_MINIMUM_VERSION`†; `GATEWAY_ENROL_PER_MINUTE`†, `GATEWAY_SYNC_PER_MINUTE`† | 0093, 0095 | **absent** (`po-gw1-2026-10-10.md` §6: *"Prod … when the gateway ships"*) |
| `gateway-events` | the version floors†; `GATEWAY_EVENTS_PER_MINUTE`† | 0093, 0095 | **absent** |
| `gateway-ticket` | **`WILSON_GATEWAY_KEY_SECRET` (required: without it every play answers 503 `crypto_unavailable`)**; the floors†; `GATEWAY_TICKET_PER_MINUTE`† | 0091, 0093 | **absent** |
| `gateway-reach` | `GATEWAY_REACH_PER_MINUTE`† | 0093 | **absent** |
| `invite-member` | `WILSON_SITE_URL` (it builds the email's link) | — | the July set |
| `issue-session` | platform keys | — | the July set |
| `operator-ai-files` | `ANTHROPIC_API_KEY`; `OPERATOR_WRITE_RPM`† | — | **absent** ([K]) |
| `operator-ai-keys` | `WILSON_AI_KEY_SECRET`; `OPERATOR_WRITE_RPM`† | — | the July set |
| `operator-models` | `ANTHROPIC_API_KEY`; `OPERATOR_WRITE_RPM`† | — | reached production in S21 (`docs/MASTER_PLAN.md`) |
| `operator-storage-plans` | `OPERATOR_STORAGE_RPM`† | — | not stated anywhere |
| `operator-workspaces` | `WILSON_SITE_URL`; `OPERATOR_READ_RPM`†, `OPERATOR_WRITE_RPM`† | 0066, 0074 | **v9 of 2026-08-08**, before 0064 and 0066 (`track-c-C2-2026-09-07.md`; `track-a-A1-2026-09-06.md`) |
| `resolve-login` | `RESOLVE_LOGIN_COMPANY_RPM`†, `RESOLVE_LOGIN_USER_RPM`† | — | **v8**, before B1's durable limiter of 2026-09-06 (`track-c-C2-2026-09-07.md`) |
| `storage-gc` | `WILSON_STORAGE_KEY_SECRET` | 0073 | **v8** (`track-c-C1-2026-09-06-part2.md`) |
| `storage-presign` | `WILSON_STORAGE_KEY_SECRET`; `STORAGE_PRESIGN_RPM`† | 0088 | **v3**, without 0088's `LEGAL` (`track-c-C2-2026-09-07.md`; [OUT] S4b-02) |
| `storage-secret` | `WILSON_STORAGE_KEY_SECRET`; `STORAGE_SECRET_RPM`† | — | deployed to all three in S37 (commit `bf908586`) |

*Platform keys* are `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, which the
platform provides to every function and nobody sets.

**Where the documents disagree** (the read in (a7) settles each one):

1. **How many, where.** [HB] §4.1 says every function is on all three environments, and §4.6
   says twelve; [P] §1 (2026-10-27) says 22 on dev and staging and that production lacks the ones
   since July. Yet the hand-offs record post-July functions on production (`operator-models` in
   S21, `storage-presign` v3, `ai-files` v1, `storage-secret` in S37).
2. **The AI file store on staging.** [OUT] FX12-01 and walkthrough 76 (2026-10-25) say `ai-files`
   and `operator-ai-files` are on dev only; [K] and the merge `402b6ed5` (2026-10-26 15:00 UTC)
   record `ai-files` v3 and `operator-ai-files` v1 on staging. Production lacks both FX12 copies
   by every account.
3. **`storage-presign`.** [OUT] S4b-02 says it is not redeployed (owner: Audrey, dev then
   staging); [K] records dev v4 on 2026-10-02 and staging on 2026-10-05.
4. **`storage-gc`.** [OUT] S4c-10 is open (*"on staging, then prod, by Audrey"*); [K] records
   staging v12 on 2026-10-12. Production is owed either way.
5. **`operator-workspaces`.** [OUT]'s setup-link note (2026-09-06) says production has *"neither
   0064, 0066 nor the function"*; `track-c-C2` the next day records production at v9.

**Proof, per function.** `supabase functions download <name> --project-ref rqyriuyldhovirbuievt
--workdir <W>` and compare `<W>\supabase\functions\<name>` (and its `_shared` files) with the
release tree: identical. Then `supabase functions list --project-ref rqyriuyldhovirbuievt` shows
all 22. A function guarded by a sign-in answers an unauthenticated
`curl -s -X POST https://rqyriuyldhovirbuievt.supabase.co/functions/v1/<name>` with its own
refusal (`{"error":"unauthorized"}`, 401, as `ai-files` and `operator-ai-files` did on staging,
[K]); a gateway function answers 401 too, with its own sentence (`_shared/gatewayGuard.ts`).
`resolve-login` is public before sign-in and answers every request in one uniform shape on
purpose (`resolve-login/index.ts`), so its proof is the source comparison alone.

---

## (d) The secrets

**Names only, here and everywhere.** Edge Function secrets live in each project's own store
(dashboard → Edge Functions → Secrets, or `supabase secrets set`). They are not GitHub's
repository secrets and not Vercel's environment variables: three stores that do not talk to each
other ([OWED] §5's table).

| Secret | Read by | Held, per the documents | Across environments |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | `ai-proxy`, `ai-files`, `operator-ai-files`, `operator-models` | all three, digests matching, 2026-07-30 ([OWED] §5) | one platform key behind all three ([HB] §13.1), so one AI file store: each sweep acts only on files whose upload record is in its own environment |
| `WILSON_AI_KEY_SECRET` | `ai-proxy`, `ai-files`, `operator-ai-keys` | all three, digests matching, 2026-07-30 ([OWED] §5) | **must be identical.** A company key encrypted on one is opened on the others; a new value orphans every stored company key, and `ai-proxy` falls back to the platform key quietly ([OWED] §9C; TPN-ENC-011) |
| `WILSON_STORAGE_KEY_SECRET` | `storage-gc`, `storage-presign`, `storage-secret` | all three, identical, set in the dashboard, 2026-08-08 ([OWED] §9 C2) | **must be identical.** A new value orphans every bucket secret, and `storage-presign` then fails closed: the company's media is unreachable until an admin enters its secret again |
| `WILSON_GATEWAY_KEY_SECRET` | `gateway-ticket` (required), `gateway-enrol`, `gateway-sync` | dev, 2026-10-10 (`po-gw1-2026-10-10.md` §2); staging, 2026-10-12 ([K]; merge `708e93be`). **Not production** (`po-gw1` §6) | **a fresh value per environment**, as dev and staging have; no document asks them to match (a key that will not open is replaced once, at once: `_shared/gatewaySigning.ts`) |
| `WILSON_SITE_URL` | `invite-member`, `operator-workspaces`, `gateway-enrol`, `gateway-sync` | *"already set on all three"* ([OWED] §6); production's value is not recorded | per environment: production's must be the production web host of (f), or invite and setup-link emails link elsewhere |
| `WILSON_REQUIRE_ADMIN_MFA` | every function bundling `adminGuard` | unset anywhere, by the documents; off by default ([HB] §4.6; TPN-AUTH-003) | her call, not this runbook's |
| the rate-limit and gateway-floor names in (c)'s table | their functions | unset anywhere, by the documents | optional: the code's defaults apply |

**The digest procedure** ([OWED] §5, §9 C2). `supabase secrets list --project-ref <ref>` prints
each name with a digest of its value, never the value. Run it for production and for staging and
compare the digest beside each name. **A matching digest proves the value is the same, not that
it works** ([OWED] §9 C2), so each shared secret also gets its working proof once:
`WILSON_AI_KEY_SECRET`, a company key saved in the operator console's **Set key** (a test
company); `WILSON_STORAGE_KEY_SECRET`, the first bucket secret saved in Admin terminal →
**Storage** (a malformed key fails there by name, *"must decode to exactly 32 bytes"*);
`WILSON_GATEWAY_KEY_SECRET`, a ticket minted (`gateway-ticket` answers tickets, not
`crypto_unavailable`).

**Setting what production lacks.** The two that must match are pasted by her into production's
dashboard from where she keeps them; the CLI can never read a value back, so no command copies
one. A fresh `WILSON_GATEWAY_KEY_SECRET` is made and set without the value ever being shown, as
`po-gw1` §6 does it (bash):

```
V="$(openssl rand -base64 32)" && supabase secrets set "WILSON_GATEWAY_KEY_SECRET=$V" --project-ref rqyriuyldhovirbuievt
printf '%s' "$V" | sha256sum | cut -c1-8; unset V
```

The second line prints an eight-character fingerprint for the hand-off. Rotating any of the three
encryption secrets later is not a release step; [OWED] §9C and §9 C2 say what each breaks.

---

## (e) The two Auth hooks and the session time-box

After 0070 and 0071 are applied and recorded. Dashboard steps, per project ([OWED] §14; [BC] §5);
on production they are hers to click unless she hands the controller the dashboard.

1. Dashboard → wilson-prod → Authentication → **Hooks** → **Add hook** → *Password verification
   attempt*: hook type **Postgres**, schema `public`, function `hook_password_verification_attempt`.
   Enable.
2. Same page → **Add hook** → *MFA verification attempt*: Postgres, `public`,
   `hook_mfa_verification_attempt`. Enable.
3. Authentication → **Sessions**: *time-box user sessions* at 4 hours or more and *inactivity
   timeout* at 30 minutes or more, so the server never signs someone out before the app's own
   25/30-minute idle warning and 4-hour cap say why ([OWED] §14; TPN AS-3.8).

**Proof.** She signs in to the production app once with a wrong password, then correctly, then
completes two-factor. Then `supabase db query --linked --file scripts/probes/auth-events-recent.sql`
→ a `sign_in / failure`, a `sign_in / success` and an `mfa_verify / success` row with those times.
A missing row means that hook is off. Nothing here can lock anyone out: both functions answer
*continue* on every path, including when their own insert fails ([OWED] §14).

Staging and dev need the same three steps; [OWED] §14 and [BC] §5 record them as hers and no
document records them done (2026-10-28). That is release-day step (g) 3.

---

## (f) The builds

**The web.** [WD] describes one Vercel project, `petal-studios/wilson`: production branch
`feat/multi-user-v1`, built against **wilson-staging**, served at
`https://beta.petalstudios.co/wilson` and `https://admin.petalstudios.co/wilsonadmin`, every push
to the branch a deploy. **No document describes a web deployment against wilson-prod**, so where
1.0.0's web app lives, and on what address, is her question (walkthrough 85). Whichever she picks,
it needs, per [WD]: the build-time `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` of the
database it serves (the anon key is publishable; RLS is the boundary), `WILSON_SITE_URL` set on
that database's Edge Functions, and that database's Authentication → URL Configuration naming the
host, or invite and recovery emails land nowhere. Proof: the deployed bundle carries that
project's ref and no other (`curl -s <host>/wilson/ | ` the `index-*.js` it names, searched for
`rqyriuyldhovirbuievt`, `rzkirvkotslbovzbsdfh` and `eqjzmnvkrakroyqxfsvw`), and the sign-in page
answers.

**The desktop.** Only `npm run dist` ships (electron-builder, NSIS: `package.json` `build`);
`forge.config.cjs` makes no updatable artefact ([HB] §11). The renderer's Supabase URL and anon
key are compiled in by Vite at build time, and `userData/env.json` cannot change them
(`electron/env.cjs`, its header); `.env.local` on her machine points at **wilson-dev** ([WD]
*Builds*; TPN-SDLC-008). So:

1. Build from a clean checkout of the release commit with **no `.env.local`**, and a
   `WILSON\.env.production` (ignored by `.env.*` in `.gitignore`) holding `WILSON_ENV=production`
   and production's `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_SENTRY_*` (names from
   `.env.example`; values typed by her from the dashboard).
2. `npm run dist`. Proof: `findstr /s /m rqyriuyldhovirbuievt dist\assets\*.js` names a file;
   the same search for `eqjzmnvkrakroyqxfsvw` and for `rzkirvkotslbovzbsdfh` names none.
3. Install it on a clean Windows account and sign in once (hers); the login screen's company step
   answers against production.
4. `npm run dist:publish` (the same build with `--publish always`; the feed is the `generic`
   provider at `https://updates.petalstudios.co/wilson`, B2 behind it, [HB] §8, §11). No document
   records a `dist:publish` run (2026-10-28), so the proof is the feed itself:
   `curl -s https://updates.petalstudios.co/wilson/latest.yml` names `version: 1.0.0` and the
   installer `dist` produced. If it does not, the files in `dist\` (`latest.yml`, the installer,
   its `.blockmap`) go to the feed's bucket by hand, and the hand-off says so.

The file gateway ships on its own pipeline (`.github/workflows/gateway-release.yml`, a
`gateway-v*` tag; walkthrough 63), not with the app's tag.

---

## (g) Release day, in order, with her steps between

| # | Who | Step | Proof |
|---|---|---|---|
| 1 | Audrey | Rotate `smoke_admin` on wilson-dev, update the `DEV_PROBE_PASSWORD` GitHub secret, re-run CI ([OWED] §0; TPN-SDLC-007) | CI's Playwright job green on the re-run |
| 2 | Audrey | Roll staging's legacy `service_role` key: dashboard → wilson-staging → Settings → API → Legacy API keys ([OUT] security entry, S19) | the dashboard shows the new key; the functions take it from the platform with no redeploy (`docs/sessions/MASTER_PLAN_S19_ONWARD.md`), and the beta still signs in afterwards. If the dashboard says the roll also replaces the **anon** key, stop first: the beta's build carries the anon key (`VITE_SUPABASE_ANON_KEY` in Vercel, [WD]) and would need it and a redeploy |
| 3 | Audrey | The two Auth hooks and the session settings on staging and dev, (e) 1–3 ([OWED] §14) | (e)'s probe on each |
| 4 | Audrey | The gateway's GitHub setup (the release signing key as a repository secret, once) and the Windows installer rehearsal (walkthrough 63) | the rehearsal's own checks in 63 |
| 5 | Audrey | `docs/RELEASE_TESTING.md` worked and ticked, every `[BLOCKING]` passed or knowingly waived | the ticked file |
| 6 | Audrey | PR #4's title and body pasted (the draft below) | the PR page |
| 7 | Controller | The gate in §0: `TPN_AUDIT/SUMMARY.md` *Release gate* reads 0 and 0 | the line |
| 8 | Controller | (a) a1–a10 | every read in the hand-off |
| 9 | Controller | (b), every file, then the suites | (b)'s proofs |
| 10 | Controller | (c) and (d) | (c)'s and (d)'s proofs |
| 11 | Audrey | (e) on production | (e)'s probe |
| 12 | Controller, with her | The operator console's **AI files** on production: read *Tied to a company of this environment*, sweep, read again, **before 2026-11-09** ([OUT] FX12-01; walkthrough 76 part C) | the before and after counts |
| 13 | Controller, with her | (f): the web per her answer, then the desktop build and its publish | (f)'s proofs |
| 14 | Controller, on her go | PR #4 merged into `main` **with a merge commit, never a squash** ([P] §6; fix plan "Release last") | `main`'s head is a merge commit with two parents |
| 15 | Controller, on her go | `CHANGELOG.md`'s 1.0.0 heading dated, committed on `main`; the tag `v1.0.0` on that commit, pushed | `git ls-remote --tags origin v1.0.0` |

**PR #4, as it stands** (read through the public API on 2026-10-28): open, `feat/multi-user-v1`
into `main`, title *Feat/multi user v1*, no body. A draft for her to paste or change:

> **Title:** WILSON 1.0.0 — multi-tenant cloud, the web app and the post-overhaul features
>
> **Body:** Merges `feat/multi-user-v1` into `main` for the 1.0.0 tag. What ships is
> `CHANGELOG.md`'s 1.0.0 entry; how it was tested is `docs/RELEASE_TESTING.md`; how production
> was brought up is `docs/PRODUCTION_RUNBOOK.md`; the security posture is `TPN_AUDIT/`. Merge with
> a merge commit, never a squash: the branch's history is the record the hand-offs cite by hash.

---

## (h) What can be rolled back, and what cannot

**Can be rolled back.**

- **An Edge Function**: deploy the previous source again (the previous release commit's checkout,
  the same command). `functions list` shows the version that answers.
- **The Auth hooks and session settings**: switch them off or back in the dashboard. The hooks
  answer *continue* on every path, so turning one off loses only its rows.
- **A web deployment**: Vercel → the project → Deployments → promote the previous one.
- **A pg_cron job**: `select cron.unschedule('<jobname>')`.
- **A secret** whose old value she still holds. `WILSON_AI_KEY_SECRET` and
  `WILSON_STORAGE_KEY_SECRET` are the exception: a new value orphans every stored company key or
  bucket secret, and only the old value undoes that ([OWED] §9C–C2).

**Cannot be rolled back, or only forward.**

- **A migration.** The repository has no down-migrations; the only reverse is a new, reviewed file.
  Deleting its history row (`supabase migration repair --status reverted NNNN --linked`) changes the
  record, not the schema, and leaves the two disagreeing.
- **A backfill** (0084's shot lists, 0076's receipts flagged as money): the rows written are data
  from then on.
- **An enum value added** (0103's three `project_status` values): Postgres has no `DROP VALUE`;
  removing one means rebuilding the type, and rows already holding it block that.
- **Anything users write after the release**: a restore of the backup in (a) a10 also discards it.
  The restore drill is [OWED] §1.
- **A desktop release once published**: electron-updater does not downgrade, so a bad installer
  is followed by a newer one, never withdrawn by an older one.
- **The merge into `main` and the pushed tag**: a revert commit, never a rewrite; a deleted tag may
  already have been fetched.
- **Emails sent** by invite-member or recovery while the URLs were wrong.
