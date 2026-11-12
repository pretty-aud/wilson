# TRACK C launch prompt — STORAGE AND FILES (quota reservation + own-bucket previews, money + teardown, D.O.G. cloud attachments)

> **One of three tracks that run at the same time.** The plan and Audrey's
> rulings are in `FIX_PLAN_2026-09-04.md`; this brief is Track C. Tracks A
> (product logic) and B (sign-in and security) run in their own worktrees.
> **This track owns** `supabase/functions/storage-*`, `storage-gc`, the
> TEARDOWN region of `supabase/functions/operator-workspaces/index.ts` (Track A
> deploys that function in its bundle A1 — coordinate: A1 deploys first, this
> track edits and redeploys after), the storage policies and `file_events`,
> `src/tools/rabbit_v0.1.0/storage/**` (`s3Provider.js`, `supabaseProvider.js`,
> `index.js`), `src/cloud/storageApi.js`, `FileManager.jsx`, `FileThumbnail`,
> the upload path in `supabaseAdapter.js` (`uploadFile`, the resumable branch),
> and for bundle C3 `src/components/Projects/ProjectsPage.jsx` plus the two
> D.O.G. readers (`DeckOutlineGenerator.jsx`, `LayoutVisualizer.jsx`).
> Additions to `RLS_TABLES` in `.github/workflows/rls.yml` from any track go
> through this one to avoid three-way conflicts on one line.

> **Numbers reserved for this track:** migrations **0073, 0074, 0075**; pgTAP
> suites **77, 78, 79**. Gaps are fine; collisions are not.

> **STATE — re-measure, do not trust this block.** At `606f91d` (2026-09-04):
> migrations `0000`–`0066` in the tree; dev and staging carry 0059–0064 and
> 0066 with 0065 skipped; prod at 0063. pgTAP 70 suites. Vitest 1706 / 71
> files. **Exposure facts this track depends on, last measured 2026-08-08 and
> due for re-measurement:** zero `s3` workspaces on any environment (staging's
> one `byos` workspace is provider `network` with 0 `files` rows); dev and prod
> all-zero. **Audrey will create an S3-compatible test bucket for bundle C1**
> (her Backblaze account speaks S3). Do not start C1's display half until that
> workspace exists on dev.

## Start ritual (before touching anything)

1. **Load the `wilson-app` skill.** Read `docs/fixes/README.md` "Rules that
   apply to every phase", `FIX_PLAN_2026-09-04.md` "Rules for running tracks in
   tandem", `docs/NETWORK_STORAGE_DESIGN.md` §4a3 and §12 (the handbook's
   §12.1a, §12.4, §12.7a–c), and the auto-memory `wilson_network_storage_design`
   (the BYO-provider rules: a provider is FIVE functions; money-gated files
   never leave Supabase; `rabbit-files` has EIGHT storage policies, not four).
2. **Read `HANDOFF_PROTOCOL.md` and do its fresh-worktree setup.** You start
   inside a worktree the desktop app made for this session (a `claude/…`
   branch cut from `feat/multi-user-v1`): rename it `track-c-storage` (or check
   out that branch if a hand-off says it exists), `npm install`, copy
   `.env.local` from the canonical checkout, and `supabase link` to wilson-dev
   from `WILSON/` inside the worktree — `supabase/.temp/` is gitignored, so
   the worktree is UNLINKED until you do. Check `linked-project.json` and
   `project-ref` say wilson-dev before anything writes. **One bundle per
   session; hand off at the boundary as the protocol says.**
3. **Re-measure the STATE and EXPOSURE blocks by query on all three
   environments** with the throwaway-workdir recipe (config.toml + templates/
   in a scratch dir, `link --password ""`, `db query --linked --workdir`, and
   `inet_server_addr()` + a workspace count in every query as the
   discriminator). If any s3 `files` row exists that predates 0054, **stop and
   re-scope**: the S44 reversal note in `OUTSTANDING.md` says why.
4. **Read the `OUTSTANDING.md` entries** for: concurrent resumable uploads;
   TUS partial objects (TPN-CONT-017); the BYO thumbnail display deferral (and
   S40's matching video deferral inside it); `file_events` has no money arm;
   `user-avatars` survives teardown; the teardown sweep is row-derived.
5. **Bundle order is C1 → C2 → C3**, but C1's display half waits on the test
   bucket; if it is not there yet, do C1's reservation half, then C2, then
   return.

---

## Bundle C1 — quota reservation and own-bucket previews (1–2 sessions)

### What is wrong

- **Two uploads started together can exceed a company's Petal quota.** Each
  in-flight resumable upload is invisible to the others until it lands; the
  RESTRICTIVE policy `petal_storage_quota_insert` (0055, weighed since 0057)
  sees only committed objects. S42 tried to close this by metering
  `storage.s3_multipart_uploads.in_progress_size` and **the fix was built on a
  false premise**: WILSON uploads over TUS, whose state storage-api keeps in
  S3 `.info` objects; that table is written only by the S3-protocol handler
  WILSON never calls. 0058 removed it; suite 66 probe 13 now asserts the meter
  does NOT move on that table.
- **Abandoned partial uploads have no WILSON-side record** (TPN-CONT-017).
  Supabase expires them at 24 h; WILSON cannot count, enumerate or certify
  them. A certification gap, not a disposal gap.
- **A workspace on its own S3 bucket gets file-type icons instead of
  previews** (web AND desktop — `FileThumbnail`'s Express branch is gated on
  `file.extension`, which cloud rows lack), and **s3 video longer than five
  minutes dies mid-playback** because `storage-presign`'s GET expiry is
  300 s against the Supabase arm's 3600 s. `signedThumbnailUrls` signs only
  Petal's bucket; `FileManager` filters to `storage_provider === 'supabase'`
  so the gap is stated rather than silent. `storage/index.js`'s `REQUIRED` is
  `['put','get','del','exists','describe']`; `getUrl` is optional and
  `s3Provider` does not implement it.

### Audrey's decisions

32: *reserve space when an upload starts.* 33: *build it now; "why is
building risky? if its just the blind and no test, dont worry i plan on
testing everything."* — and she creates the test bucket.

### What to build

**Reservation half.**

1. Migration **0073**: `public.upload_reservations` (workspace_id, the
   intended `storage_path`, `bytes`, `created_at`, `expires_at` = 24 h to
   match the TUS expiry, `released_at`), RLS enabled and forced, workspace
   scoped, no `FOR ALL`, nothing for `anon`/`PUBLIC`; a SECURITY DEFINER
   `reserve_upload_bytes(path, bytes)` that checks `used + active reservations
   + bytes <= quota` and inserts, and `release_upload_reservation(path)`.
   `workspace_petal_bytes()` (0056/0057) adds the SUM of ACTIVE reservations
   (`released_at IS NULL AND expires_at > now()`), so the RESTRICTIVE policy
   sees them. 🚨 **A NULL under a RESTRICTIVE policy DENIES** — `SUM()` over
   zero rows is NULL; the `COALESCE` is load-bearing (suite 66 probe 18 pins
   the existing one; add the twin for reservations).
2. The client: `supabaseAdapter.uploadFile`'s resumable branch calls the
   reservation BEFORE `tus.Upload.start()` and releases it in the completion
   handler and on abort; the storage policy re-checks at commit, so a
   reservation that lapses cannot admit an over-quota object. 🚨 **Do not
   double-count at completion**: the committed object and its own reservation
   must not both be in `used` for the same instant — release first, then the
   object is counted, and prove the order with a probe.
3. TPN-CONT-017: a reservation that expires unreleased is the WILSON-side
   record of a partial upload. `storage-gc` gains a sweep that writes an
   `upload_abandoned` `file_events` row for each (the 0057 term that 0058
   removed for having no writer — now it has one) and marks the reservation
   swept. Suite **77**: the quota refuses when reservations fill it (with an
   accepting control just under the line), a reservation releases, an expired
   one is swept and certified, and the s3_multipart meter still does not move
   (keep 66/13 green). Breakers for each.

**Display half (after the test bucket exists as an s3 workspace on dev).**

4. A GET-only batch signer, `storage-thumbnails`: authorises EVERY key,
   groups by `shape.projectId` and evaluates `can_presign_project_read` once
   per project, bounds the batch (state the number), returns `{urls, refused}`
   keyed by the input string. `FileThumbnail`'s per-URL error memory
   (`erroredSrc`) already repairs a tile when a fresh URL arrives, so the
   component needs no change; `FileManager` drops the provider filter.
5. Media playback: `storage-presign` gets a `purpose: 'media'` arm with a
   longer expiry (state it; 4 h covers a feature-length clip), `s3Provider`
   implements `getUrl` through it, and `getUrl` moves into `REQUIRED` once both
   providers honour it (the registry would otherwise refuse s3 outright —
   measured in S40, which is why it was left optional).
6. Rate limits: `STORAGE_PRESIGN_RPM` is 240; a 50-file grid through the
   batch signer is one call, not fifty. Assert that in the test.

### Traps

- 🚨 **`rabbit-files` has EIGHT storage policies (0042).** A brief once said
  four; porting "the four" ships a bucket with NO money gate. Read the
  catalogue before adding any policy.
- 🚨 **Money-gated files NEVER leave Supabase** — only RLS enforces
  `rabbit_money_segment`. The batch signer must refuse a money-gated path for
  a non-money caller exactly as `storage-presign` does; add the probe.
- 🚨 **S3 answers 204 for a missing key**, and a 404 means the BUCKET is
  missing; the GC learned this in S37. Do not count either as a disposal.
- The 5 GB single-PUT ceiling on s3 stands; multipart to a customer bucket is
  not in scope. `AllowedOrigins: ["*"]` on the customer bucket is required
  because the desktop origin carries a dynamic port; say so in the setup copy.
- `storage.buckets.file_size_limit` is capped by a PROJECT-LEVEL dashboard
  setting SQL cannot see (S42); a migration can be green and change nothing.
- Every new probe proven by breaking it; every absence check paired with a
  presence control.

### Definition of done

0073 + suite 77 on dev and staging by query, breakers red; reservation on the
resumable path with the no-double-count probe; abandoned sweep with
certificates; batch signer + `getUrl` + `REQUIRED`; previews and a >5-minute
video verified against her test bucket on dev; `tap-all` and vitest green;
CI green on the pushed head; walkthrough `13_uploads_own_bucket.md`.
`OUTSTANDING.md`: delete the concurrent-uploads, TUS-lifecycle and
BYO-display entries (and S40's video deferral inside the last), session-log
row; handbook §12.7b/§12.7c and §17 rewritten to what shipped, limits in both
directions; TPN-CONT-017 annotated.

### Test plan (Audrey)

On the beta, a company at a small quota: start two uploads that together
exceed it — the second is refused at start, not after ten minutes. Cancel an
upload halfway; next day the audit shows it as abandoned. On the test-bucket
company: upload images and a ten-minute video; previews appear in the grid,
the video plays to the end.

---

## Bundle C2 — money on the activity stream, avatars at teardown (1 session)

### What is wrong

- **Invoice lifecycle metadata is readable by every project reader.**
  `file_events_select` (0027) admits any project reader with no
  `is_financial` arm, and the capture trigger snapshots every event; a member
  who cannot see an invoice's `files` row (0038's money arm) reads its name,
  path and size from its `uploaded`/`moved`/`trashed` events. S33 contained
  the write side (the 0047 money gate on minting); the read side is
  pre-existing. The fix was deferred because a purged invoice's event is the
  only surviving record and carries no `is_financial` (the row is gone).
- **`user-avatars` survives workspace teardown, uncounted and permanently
  undrainable.** Three buckets, teardown sweeps two (`rabbit-files` and
  `THUMBNAIL_BUCKET = 'rabbit-thumbnails'` in `operator-workspaces`); after
  the CASCADE `storage-gc`'s avatar arm can never run for that tenant again.
  Avatars are photographs of identifiable people, so `WIL-7005` certifying
  "torn down" with them resident is a personal-data statement.

### Audrey's decisions

22: *hide invoice activity from non-managers; deletion records stay
visible.* 24: *sweep avatars at teardown and count them in the record.*

### What to build

1. Migration **0074**: `file_events.is_financial boolean NOT NULL DEFAULT
   false`, filled by the capture trigger from `files.is_financial` at capture
   time (so the flag survives the row's deletion), backfilled by join for
   existing rows; `file_events_select` gains the arm: non-money readers see
   rows where `NOT is_financial OR action = 'purged'` (her ruling: certificates
   stay visible to everyone who could read the project; everything else about
   an invoice is manager-only via `can_access_project_money`). DROP + CREATE
   the policy, restating every existing arm (the 0059 lesson); post-condition
   asserts the arm's presence. Suite **78** (or extend `33_file_lifecycle`,
   one suite per table): a member reads a plain file's upload event, cannot
   read an invoice's upload/move/trash event, CAN read its purge certificate;
   a manager reads all; breakers for each arm.
2. Teardown avatars: in `operator-workspaces`' teardown, mirror the thumbnail
   block — recursive `list('user-avatars', workspaceId)` → `remove()` in
   batches → `avatars_removed` on the `WIL-7005` certificate, counting
   `remove()`'s RETURNED array, never the batch (the S15 review found a
   certificate claiming a destruction that never happened). The certificate
   `context` has an 8000-char CHECK reported on supabase-js's error channel;
   keep it bounded. Redeploy on dev and staging AFTER Track A's A1 deploy has
   landed (coordinate on the version numbers in `functions list`).
3. While there: the row-derived sweep's stated limit gets a certificate field
   (`thumbnails_note` or a `list()` of `rabbit-thumbnails/projects/{id}` per
   owned project) so the omission is legible — the `byo_*` counts exist for
   exactly this reason.

### Traps

- 🚨 **Permissive policies OR together.** A base arm that forgets the new
  condition serves the row regardless of how correct the money arm is — 0038
  inverted the invoice gate exactly this way. One definition, negated in the
  base arm, asserted in the money arm.
- `is_financial` snapshotting means a file that becomes financial LATER has
  earlier events unflagged; state that limit in §17 rather than backfilling on
  every change.
- `operator-workspaces` teardown order is the design: snapshot → typed
  confirm → page blobs → delete + certificate per batch → queue rows → the row.
  Insert the avatar sweep where the thumbnail sweep sits, not at the end.
- `supabase functions download` into a SCRATCH directory only; from the repo
  root it overwrites source.

### Definition of done

0074 + suite 78 on dev and staging by query; policy restated in full with the
post-condition; avatar sweep with counted certificate, redeployed on dev and
staging and hash-verified; `OUTSTANDING.md`: delete both entries, narrow the
row-derived-sweep entry to what the new field does not cover; handbook §12.4,
§17 and the certificate table in Appendix B updated; walkthrough
`14_invoice_privacy_and_teardown.md`.

### Test plan (Audrey)

As a plain member on a project with an invoice: Files activity shows no trace
of it; as the manager it shows upload and move. Tear down a throwaway company
whose admin had an avatar: the certificate's avatar count is 1, and the image
URL no longer loads.

---

## Bundle C3 — D.O.G. cloud attachments (1 session)

### What is wrong

`project.documents` / `visualAssets` are base64 data-URLs on the project row,
written only on Local Server; the cloud adapter REFUSES a create or update
carrying them (S15's `ATTACHMENTS_MSG` in `supabaseAdapter.js` and
`ProjectsPage.jsx`) rather than dropping them silently. So on the beta the
Resources drop zone shows an honest error and goes nowhere, and D.O.G.
(`DeckOutlineGenerator.jsx`, `LayoutVisualizer.jsx`) reads attachments that can
never exist in cloud mode. `MASTER_PLAN.md` §6 #31 carries the re-homing plan
and **seven catalogued traps**, of which *"the `isCore` polarity flip alone
would change generation output"* is the one named in the disposition.

### Audrey's decision

27: *build it now.* And her parity rule (2026-08-10): *"all functionality
should be the same in both versions of the app."*

### What to build

1. **Read §6 #31 in full first** (the numbered entry under "Filed by Session
   16", not only the disposition row) and list the seven traps in the commit
   message with how each was handled. Do not start from this brief's summary.
2. Route the Resources drop zone and D.O.G.'s attachment picker through
   `adapter.uploadFile` — files rows in `public.files` + `rabbit-files`
   objects — with the document kind carried as a column (`document_kind`) so
   `isCore` is derived from data, not defaulted TRUE. `uploadFile` already
   works on the web, the desktop, Supabase and Local Server (S24's
   `InvoiceAttachment` rides it), so the same path gives parity for free:
   Local Server stops writing the legacy arrays for NEW attachments and keeps
   reading them for old projects until a one-time migration in the existing
   Settings migration tool moves them (dry run first, counts reported).
3. D.O.G. reads its attachments from `files` (filtered by project and kind)
   on every backend, through the adapter, never through the project row. The
   readers must not change generation output for an existing local project:
   snapshot a deck generated from a legacy-array project BEFORE the change,
   regenerate after with the same inputs, diff the outline — that is the
   polarity trap made measurable.
4. Money and quota apply as to any file: attachments count toward the Petal
   meter and are never money-gated unless someone puts them under a reserved
   segment — assert they cannot be.

### Traps

- 🚨 The seven traps in §6 #31 are the brief. Anything this section says that
  contradicts them is wrong.
- `project.documents` may be large base64; the migration tool must stream
  rather than hold every project's blobs in memory, and must report a size
  ceiling per file (the 50 GiB bucket cap is not the concern; the row's
  8-MB-class JSON was).
- `toColumns()` returns the object untouched when a table has no allowlist
  entry; a new column on `files` needs `FILE_COLUMNS` and
  `columnAllowlist.test.js`.
- Cloud deletes are soft; an attachment removed from a deck must not purge the
  object until the 30-day window — say so in the UI copy.

### Definition of done

Attachments upload, list and open on the beta and on the desktop in both
modes; D.O.G. generates from them; the polarity diff recorded in the commit
with zero unexplained differences; legacy projects migrate with counts;
vitest green; CI green; walkthrough `15_dog_attachments.md`. `OUTSTANDING.md`
gains nothing; `MASTER_PLAN.md` §6 #31 marked CLOSED with the commit;
`RELEASE_TESTING.md` "Known not to work" #1 removed; handbook §17 "Files"
and "Product gaps" rewritten.

### Test plan (Audrey)

On the beta: drop a brief PDF and two reference images on a project's
Resources, then generate a deck in D.O.G. and confirm it used them. On the
desktop, Local Server: open an old project that had attachments, run the
migration dry run, then for real, and regenerate its deck — same outline as
before.

---

## Standing traps

Never `supabase config push`. `git add -A` sweeps untracked files into a
PUBLIC repo. Never interpolate content into a shell command; write scripts to
files. Query the database rather than trusting migration text or commit
messages. One query per `--file`. Count `<!--` / `-->` after editing long
markdown. `fetch` resolves for EVERY status. Never gate on
`window.electronAPI` to pick a store; use `ctx.supportsManagedFiles`. The
meter reads `storage.objects.metadata->>'size'`, never `files.size_bytes`.
Deleting files does not free space for 30 days, and every over-quota message
must keep saying so. Cite symbols, not line numbers.

⚠️ **Deploy order: dev → staging BEFORE the git push**; Edge Functions deploy
by hand and nothing in the repo records what is deployed — `functions list`
per project is the only truth. Never `db push` while 0065 is unapplied. Prod
waits for the release session.

🚨 **Two review rounds before every merge; R2 reviews R1's corrections.** The
storage arc's reviews confirmed 5, 8, 12, 17 and 20 findings in code that was
already green.

## Close-out ritual (per bundle, then once for the track)

1. `docs/OUTSTANDING.md`: delete what is fixed citing the commit, narrow what
   remains, session-log row.
2. Migration verified by query on dev AND staging; CLI re-linked to wilson-dev;
   `tap-all` clean; full vitest; new suites in both `rls.yml` lists (this
   track owns those edits for all three tracks — batch them).
3. Merge `feat/multi-user-v1` into the track branch first, resolve, re-test;
   then merge the bundle in with a merge commit and push; CI green on the
   pushed head, Playwright included.
4. `docs/NETWORK_STORAGE_DESIGN.md` and `SYSTEMS_HANDBOOK.md` §12 / §17
   rewritten to what shipped, limits stated in both directions.
5. Update the auto-memory (`wilson_migration_rules`,
   `wilson_network_storage_design`, `wilson_session_history`).
6. **Close out in the chat**: remaining bundles, plain-English breakdown,
   fixed / diagnosed / hers to do.
