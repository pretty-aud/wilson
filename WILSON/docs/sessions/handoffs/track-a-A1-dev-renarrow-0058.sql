-- Track A, bundle A1 (2026-09-06) — DEV ONLY, an environment repair, NOT a migration.
--
-- Measured 2026-09-06 on wilson-dev (inet_server_addr …9d59…, 4 workspaces):
-- file_events_event_check admits 'upload_abandoned' — 0057's eight-value list —
-- although 0058 is recorded as applied and every other artefact 0058 governs is
-- in the 0058 state (purge_abandoned_uploads gone, no function references
-- storage.s3_multipart_uploads, no cron job, exactly one vocabulary constraint,
-- zero rows with that event). Staging has the seven-value list. Cause unknown;
-- not a 0057 replay. Effect: pgTAP 66_cloud_multi_gb.sql probe 27 is red on
-- dev and green on staging. Nothing in the product writes the value.
--
-- This re-applies ONLY 0058's vocabulary block, with 0058's own post-conditions,
-- in one transaction: any miss raises and nothing changes. The Track A session
-- could not run it — the desktop app's permission classifier refused the DDL
-- write against dev. Run from WILSON/ with the CLI linked to wilson-dev
-- (check supabase/.temp/project-ref first):
--
--     supabase db query --linked --file docs/sessions/handoffs/track-a-A1-dev-renarrow-0058.sql
--
-- then prove it:  node scripts/tap-all.mjs 66   → 30/30.
BEGIN;
DO $$
DECLARE r RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM public.file_events WHERE event = 'upload_abandoned') THEN
    RAISE EXCEPTION 'refusing: file_events holds upload_abandoned rows';
  END IF;
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.file_events'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%uploaded%'
  LOOP
    EXECUTE format('ALTER TABLE public.file_events DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE public.file_events
  ADD CONSTRAINT file_events_event_check CHECK (event IN
    ('uploaded', 'downloaded', 'moved', 'relinked', 'trashed', 'restored',
     'purged'));
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.file_events'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%uploaded%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'post-condition failed: % vocabulary constraints, expected 1', n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'file_events_event_check'
               AND pg_get_constraintdef(oid) LIKE '%upload_abandoned%') THEN
    RAISE EXCEPTION 'post-condition failed: upload_abandoned still admitted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'file_events_event_check'
                   AND pg_get_constraintdef(oid) LIKE '%downloaded%'
                   AND pg_get_constraintdef(oid) LIKE '%purged%'
                   AND pg_get_constraintdef(oid) LIKE '%relinked%') THEN
    RAISE EXCEPTION 'post-condition failed: an existing value was dropped';
  END IF;
END $$;
COMMIT;
SELECT inet_server_addr()::text AS addr,
       (SELECT pg_get_constraintdef(oid) FROM pg_constraint
         WHERE conname = 'file_events_event_check') AS file_events_event_check;
