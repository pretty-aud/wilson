-- =========================================================================
-- 72_milestone_realtime.sql — Track A, migration 0077.
--
-- Key dates live-sync between windows (Audrey, 2026-09-07). 20_realtime.sql
-- already proves the shared machinery — the function exists, the channel
-- authorization mirrors projects_select, a broadcast never aborts a write.
-- This suite proves the two things that are specific to THIS change and that
-- suite 20 structurally cannot:
--
--   1. THE MILESTONES ARM ACTUALLY RESOLVES A PROJECT. Suite 20's last probe
--      counts rows on `rabbit:project:%` from any table, so it would stay
--      green with the milestones arm missing entirely: the trigger would fire,
--      v_project would come back NULL, fn_realtime_broadcast would RETURN NULL
--      before broadcasting, and nothing anywhere would raise. Probe 20 counts
--      rows whose payload names `milestones`, on ONE project's topic.
--
--   2. THE RULING'S OTHER HALF. Scenes, shots, levels and experiences keep the
--      reload limit BY CHOICE ("recorded in the handbook as a conscious
--      difference, not an oversight"). Probes 11-14 assert none of them has
--      acquired a broadcast trigger. This is the only place that choice is
--      machine-checked; 0077 deliberately does not assert it, because a
--      post-condition that fails on a legitimate future widening is the
--      guarded-narrowing trap, whereas a test is meant to be changed on
--      purpose and with a diff.
--
-- 🚨 THE INSTRUMENT HAS A CONTROL BUILT INTO IT, and that is the point.
-- pg_temp.milestone_broadcast_status() answers 'instrument-broken' when it
-- cannot find the ASSETS broadcast it just caused — assets have been on this
-- topic since 0016, so if the predicate cannot see one, the predicate is
-- wrong (a realtime version whose payload key is not `table`, a different
-- messages layout) and a 'missed' verdict would be meaningless. Without that
-- arm, "no milestone rows" and "this query cannot see any rows" are the same
-- answer, which is the exact shape of the four wrong instruments the A3
-- session recorded.
--
-- Environment tolerance is suite 20's, for its reasons: a db-only CI stack
-- has no realtime schema, and a hosted project whose Realtime tenant has
-- never woken has no partition for today, in which case realtime.send()
-- silently drops the row. Both are reported honestly rather than counted as
-- passes-by-accident: an UNMEASURED run is not a green one.
-- =========================================================================
BEGIN;

SELECT plan(20);

SELECT * FROM tests.rls_setup();

-- Fixture ids, all inside project_a in workspace_a.
--   72710000-…-0001  the key date whose whole lifecycle is exercised
--   the asset below is the CONTROL's subject.

-- Environment-tolerant inspector. Status values:
--   'no-schema'         — realtime.messages / broadcast_changes absent
--   'no-partition'      — no partition covers now(); realtime.send swallows
--                         the insert with a warning (detected EMPIRICALLY,
--                         because pg_inherits alone counts stale historical
--                         partitions as routable)
--   'instrument-broken' — the infrastructure is present and routable and this
--                         query cannot even see the ASSETS broadcast, so a
--                         verdict about milestones would be worthless
--   'missed'            — assets landed, milestones did not: a REAL failure,
--                         and the one this suite exists for
--   'landed'            — milestone rows are on the project's topic
CREATE FUNCTION pg_temp.milestone_broadcast_status()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  n     BIGINT;
  topic TEXT := 'rabbit:project:aaaa1111-0000-0000-0000-000000000001';
BEGIN
  IF to_regclass('realtime.messages') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'realtime' AND p.proname = 'broadcast_changes'
  ) THEN
    RETURN 'no-schema';
  END IF;

  -- Guarded (R1): realtime.send swallows a missing partition on the images
  -- seen here, but that is a property of one version's internals, not a
  -- contract. If it ever raises, this must answer 'no-partition' rather than
  -- abort the whole suite file.
  BEGIN
    PERFORM realtime.send('{"probe":true}'::jsonb, 'PGTAP-PROBE',
                          'rabbit:pgtap:milestone-partition-probe', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN 'no-partition';
  END;
  EXECUTE 'SELECT count(*) FROM realtime.messages
            WHERE topic = ''rabbit:pgtap:milestone-partition-probe'''
    INTO n;
  IF n = 0 THEN
    RETURN 'no-partition';
  END IF;

  -- THE CONTROL. Assets have broadcast to this topic since 0016.
  EXECUTE format(
    'SELECT count(*) FROM realtime.messages
      WHERE topic = %L AND extension = ''broadcast''
        AND payload ->> ''table'' = ''assets''', topic)
    INTO n;
  IF n = 0 THEN
    RETURN 'instrument-broken';
  END IF;

  EXECUTE format(
    'SELECT count(*) FROM realtime.messages
      WHERE topic = %L AND extension = ''broadcast''
        AND payload ->> ''table'' = ''milestones''', topic)
    INTO n;
  RETURN CASE WHEN n > 0 THEN 'landed' ELSE 'missed' END;
END;
$$;


-- ── probes 1-9: the trigger is there, and it is the RIGHT trigger ─────────

SELECT has_function('public', 'fn_realtime_broadcast',
  'fn_realtime_broadcast() exists');

SELECT has_trigger('public', 'milestones', 'trg_milestones_realtime',
  'milestones carries a broadcast trigger (0077)');

-- has_trigger checks the NAME. A trigger of that name pointed at any other
-- function would satisfy it and broadcast nothing.
SELECT is(
  (SELECT p.proname::text
     FROM pg_trigger tg
     JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE tg.tgrelid = 'public.milestones'::regclass
      AND tg.tgname  = 'trg_milestones_realtime'),
  'fn_realtime_broadcast',
  'trg_milestones_realtime runs fn_realtime_broadcast, not something else');

-- pg_trigger.tgtype bits: 1 = ROW, 2 = BEFORE, 4 = INSERT, 8 = DELETE,
-- 16 = UPDATE. Each is checked separately so a failure names the operation.
SELECT is(
  (SELECT (tgtype & 1)::int FROM pg_trigger
    WHERE tgrelid = 'public.milestones'::regclass
      AND tgname  = 'trg_milestones_realtime'),
  1, 'the trigger is FOR EACH ROW');

SELECT is(
  (SELECT (tgtype & 2)::int FROM pg_trigger
    WHERE tgrelid = 'public.milestones'::regclass
      AND tgname  = 'trg_milestones_realtime'),
  0, 'the trigger is AFTER, not BEFORE');

SELECT is(
  (SELECT (tgtype & 4)::int FROM pg_trigger
    WHERE tgrelid = 'public.milestones'::regclass
      AND tgname  = 'trg_milestones_realtime'),
  4, 'the trigger fires on INSERT — a colleague''s new key date appears');

-- UPDATE is the operation ruling 38's trash rides on: a soft delete and a
-- restore are both UPDATEs of deleted_at, and 0016 chose broadcast over
-- postgres_changes precisely so those two deliver.
SELECT is(
  (SELECT (tgtype & 16)::int FROM pg_trigger
    WHERE tgrelid = 'public.milestones'::regclass
      AND tgname  = 'trg_milestones_realtime'),
  16, 'the trigger fires on UPDATE — retitle, date move, trash and restore');

SELECT is(
  (SELECT (tgtype & 8)::int FROM pg_trigger
    WHERE tgrelid = 'public.milestones'::regclass
      AND tgname  = 'trg_milestones_realtime'),
  8, 'the trigger fires on DELETE — ?purge=1 and the undo of a create');

-- The arm, in the branch that resolves through project_id. Attached-but-
-- ignorant is the silent failure 0077 §3c also guards.
--
-- 🚨 COMMENTS STRIPPED FIRST, and the arm COUNTED. pg_get_functiondef returns
-- the source with its comments, so a `-- WHEN 'project_members', 'milestones'`
-- line satisfied the first version of this probe with the arm deleted; and
-- PL/pgSQL CASE takes the first match, so an earlier `WHEN 'milestones' THEN
-- v_project := NULL` would shadow the real arm while the LIKE still matched.
-- Both were R1's.
SELECT ok(
  regexp_replace(pg_get_functiondef('public.fn_realtime_broadcast()'::regprocedure),
                 '--[^' || chr(10) || ']*', '', 'g')
    LIKE '%''project_members'', ''milestones''%',
  'the project_id branch of fn_realtime_broadcast names milestones (comments stripped)');


-- ── probe 10: the trigger is on the twelve tables it should be on ────────
-- 🚨 A SET, NOT A COUNT. The first version asserted `count(*) = 12`, which R1
-- pointed out cannot see a trigger MOVED to the wrong table: detach
-- trg_files_realtime, attach one to some other table, and the count is still
-- 12. Naming the tables costs nothing and says what is actually meant.
SELECT is(
  (SELECT string_agg(c.relname::text, ',' ORDER BY c.relname::text)
     FROM pg_trigger tg
     JOIN pg_proc  p ON p.oid = tg.tgfoid
     JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE p.proname = 'fn_realtime_broadcast'
      AND NOT tg.tgisinternal),
  'asset_versions,assets,comments,files,milestones,phase_dependencies,phases,'
  || 'project_members,projects,task_dependencies,task_links,tasks',
  'the broadcast trigger is on exactly the twelve project-scoped tables');


-- ── probes 11-14: KEY DATES ONLY — Audrey's ruling, machine-checked ───────
-- Matched by FUNCTION rather than by trigger name: a trigger called anything
-- at all that runs fn_realtime_broadcast would put one of these four on the
-- topic, and the ruling is about the behaviour, not the name.
SELECT is((SELECT count(*)::int FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
            WHERE tg.tgrelid = 'public.scenes'::regclass AND p.proname = 'fn_realtime_broadcast'),
  0, 'scenes are NOT broadcast — the reload limit is her explicit choice');

SELECT is((SELECT count(*)::int FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
            WHERE tg.tgrelid = 'public.shots'::regclass AND p.proname = 'fn_realtime_broadcast'),
  0, 'shots are NOT broadcast');

SELECT is((SELECT count(*)::int FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
            WHERE tg.tgrelid = 'public.levels'::regclass AND p.proname = 'fn_realtime_broadcast'),
  0, 'levels are NOT broadcast');

SELECT is((SELECT count(*)::int FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
            WHERE tg.tgrelid = 'public.experiences'::regclass AND p.proname = 'fn_realtime_broadcast'),
  0, 'experiences are NOT broadcast');


-- ── probes 15-19: every write path still succeeds with the trigger on ─────
-- The load-bearing invariant of the whole realtime design. Run as a real
-- member: the workspace stamp reads the JWT, and fn_trash_authz rejects a
-- claimless caller.

SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

-- The CONTROL's subject: an assets write on the same topic. Named here rather
-- than relied on from the fixture, so the control cannot pass on a row some
-- other part of rls_setup() happened to make.
SELECT lives_ok(
  $$INSERT INTO public.assets (id, project_id, name)
    VALUES ('72720000-0000-0000-0000-000000000001',
            'aaaa1111-0000-0000-0000-000000000001', 'Broadcast control')$$,
  'the control asset writes with the trigger attached');

SELECT lives_ok(
  $$INSERT INTO public.milestones (id, project_id, title, date)
    VALUES ('72710000-0000-0000-0000-000000000001',
            'aaaa1111-0000-0000-0000-000000000001', 'Lock picture', '2026-10-01')$$,
  'a key date INSERTs with the broadcast trigger attached');

SELECT lives_ok(
  $$UPDATE public.milestones SET date = '2026-10-08'
     WHERE id = '72710000-0000-0000-0000-000000000001'$$,
  'moving a key date''s date succeeds');

SELECT lives_ok(
  $$SELECT public.soft_delete_row('milestones',
      '72710000-0000-0000-0000-000000000001')$$,
  'the trash RPC succeeds — the UPDATE the trash event rides on');

SELECT lives_ok(
  $$SELECT public.restore_soft_deleted('milestones',
      '72710000-0000-0000-0000-000000000001')$$,
  'the restore RPC succeeds');


-- ── probe 20: the events actually landed on THIS project's topic ──────────
-- Reading realtime.messages needs the runner, not a persona.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- 🚨 THE STATUS LEADS THE DESCRIPTION so it is greppable in any log, and so a
-- reader cannot mistake a tolerated skip for a measurement. `no-schema` and
-- `no-partition` both mean UNMEASURED, and in CI one of them is the answer
-- every time: rls.yml starts the stack with `--exclude realtime`, so this
-- probe is a catalog check there and nothing more. The behavioural
-- measurement is a HAND RUN against dev, and the session that adds an arm
-- here is the one that has to do it — 0077's was `landed`, four milestone
-- rows (insert, date move, trash, restore) plus the one assets control, on
-- 2026-09-07.
SELECT ok(
  pg_temp.milestone_broadcast_status() IN ('landed', 'no-schema', 'no-partition'),
  'broadcast status=' || pg_temp.milestone_broadcast_status()
  || ' — milestone writes land on rabbit:project:{id} wherever realtime is present');

SELECT * FROM finish();
ROLLBACK;
