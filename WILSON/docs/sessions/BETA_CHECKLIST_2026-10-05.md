# Before the beta takes this branch — the checklist (2026-10-05)

> **Done, 2026-10-05 evening.** Steps 1–4 were carried out by the controller at Audrey's word ("push all migrations as well" / "run them"): staging migrated through 0090 and checked, `storage-presign` deployed, the CLI re-linked to dev, the merge commit `cb7cf9d8` pushed to `feat/multi-user-v1`, and the beta verified serving `index-CRVCLYfk.js` with the new code. Section 5 remains hers.

Every bundle of the post-overhaul plan is built, reviewed twice and on `feat/post-overhaul-edit-versioning` (tip `bd7f4b72`, 272 test files / 6,591 tests, CI green). The beta (`https://beta.petalstudios.co/wilson`, Vercel, backed by the STAGING database) deploys whatever is on `feat/multi-user-v1`. Nothing below is started by Claude without your word; the merge is the last step and it is Claude's.

**The order matters:** the database first, the app after. The S4b and S5 screens need 0088, 0089 and 0090 on staging before they run there, and 0084 should not sit on staging for days before the new app arrives (a scene made by the old app in between would belong to no shot list). So steps 1–3 and step 4 go in one sitting.

## 1. Staging's database — thirteen migrations, in this order

From `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON` in PowerShell, one line at a time. Each migration is TWO lines: the file, then its history row. Every file is a byte-for-byte copy from the branch, and each refuses to run on a database in the wrong state rather than half-apply: **if any line stops with an error, stop there and paste the message to Claude.** Staging takes its own password at the link.

```
supabase link --project-ref rzkirvkotslbovzbsdfh
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\0068_user_pets_stale_write_guard.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\hist-0068.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\0069_otter_nomination_self_approval_audit.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\hist-0069.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\0072_private_projects.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\hist-0072.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\0077_milestones_realtime.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\hist-0077.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\0081_file_media_metadata.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\hist-0081.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\0082_private_project_definers.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\hist-0082.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\0083_private_project_file_gates.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\hist-0083.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\0084_shot_lists_and_edits.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\hist-0084.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\0085_file_tags.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\hist-0085.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\0086_shot_list_withdraw.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\hist-0086.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\0088_legal_files.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\hist-0088.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\0089_budget_versions_open.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\hist-0089.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\0090_schedule_set_aside.sql"
supabase db query --linked --file "C:\Users\Audrey\Desktop\WILSON walkthroughs\Post-overhaul\migrations-to-apply\hist-0090.sql"
```

Then three checks:

```
supabase db query --linked "select string_agg(version, ' ' order by version) from supabase_migrations.schema_migrations where version >= '0064'"
supabase db query --linked "select public.rabbit_money_segment('LEGAL') as legal_locked"
supabase db query --linked "select count(*) as lists, (select count(*) from public.shot_list_items) as items from public.shot_lists"
```

The first should read `0064 0066 0067 0068 0069 0070 0071 0072 0073 0074 0075 0076 0077 0078 0081 0082 0083 0084 0085 0086 0088 0089 0090`; `legal_locked` should be `true`; the third shows one shot list per project that has scenes or shots (0084's backfill) with every scene and shot in it.

## 2. The `storage-presign` function on staging

The branch's copy of the function keeps Legal files out of the signing path. Deploy it from the folder that holds the branch's tip (it stays there until the merge):

```
supabase --workdir "C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\post-overhaul-merge\WILSON" functions deploy storage-presign --project-ref rzkirvkotslbovzbsdfh
```

## 3. Re-link to dev

```
supabase link --project-ref eqjzmnvkrakroyqxfsvw --password ""
```

## 4. Tell Claude "go"

Claude merges `feat/post-overhaul-edit-versioning` into `feat/multi-user-v1` with a merge commit (never a squash), Vercel deploys the beta from that push, and Claude probes the deployed bundle for the new code (never a timestamp) before saying it is up.

## 5. Not blocking the beta, still yours

- **The two sign-in logging hooks** (`docs/OWED_AUDREY.md` §14): Dashboard → Authentication → Hooks → add *Password verification attempt* (Postgres, `public`, `hook_password_verification_attempt`) and *MFA verification attempt* (`hook_mfa_verification_attempt`), on wilson-dev and wilson-staging. Nothing locks anyone out without them; the server just writes no sign-in rows until they are on.
- **Remove the permission line** `Bash(supabase db query --linked --file:*)` from `Claude_Work\.claude\settings.local.json` once step 1 is done (Claude no longer needs it; the dev applies are over).
- **The walkthroughs** on your Desktop under `WILSON walkthroughs\Post-overhaul\`: 48 (§6, weekends), 49, 50 (§5), 51 (eight questions), 52, 53 (seventeen), 54 (the Legal keep / change questions), 55 (twenty-four, both halves). The desktop ones test now against dev; the cloud ones test on the beta after the merge.
- **The Bins-on-the-cloud answers** (`00_BINS_ON_THE_CLOUD_QUESTIONS.md`, thirteen questions with an answer block to copy).
- **Rulings the sessions recorded for you**, each in `docs/OUTSTANDING.md`: with weekends hidden, a bar dragged across a weekend keeps the same number of working days or the same calendar length? (P1-32a); which shot list a viewed version's scenes come from (S5d-03); a version whose chart starts after the date you were on (S5d-06); no Ctrl+Z on the Budget, Undo is the toast (S5c-01); the test bids' plain rates (S5c-02); `budget_total` / `budget_currency` editable by anyone who may edit the project (S5b-01); bid versions not broadcast to other windows (S5b-02); and the older S4b-06/07/09/10/11.
