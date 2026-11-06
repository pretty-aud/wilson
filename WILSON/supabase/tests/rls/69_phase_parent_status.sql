-- =============================================================================
-- 69_phase_parent_status.sql — 0063.
--
-- Covers the two columns the New Phase dialog has always written and the
-- database never had: phases.parent_phase_id and phases.status.
--
-- Audrey, 2026-08-12, creating a phase called "pre pro":
--   [supabase] Could not find the 'parent_phase_id' column of 'phases'
--   in the schema cache
--
-- 🚨 REGISTERED BY HAND IN .github/workflows/rls.yml. Like 53/59/63/64/66, this
-- suite covers COLUMNS on an existing table rather than a table of its own, so
-- the RLS_TABLES coverage guard cannot demand it — `phases` is already
-- satisfied by 02_phases.sql. The replay list in rls.yml is its only
-- registration, and forgetting that is how a failure here becomes unreadable.
--
-- ⚠️ Named _phase_parent_status, not _phases: the guard globs *_<table>.sql, so
-- a file ending _phases.sql would satisfy `phases` coverage while testing
-- something else.
--
-- These are SCHEMA assertions and deliberately run as the suite's default role,
-- not through tests.login_as — RLS on phases is 02_phases.sql's job.
-- =============================================================================

BEGIN;
SELECT plan(10);
SELECT * FROM tests.rls_setup();

-- Workspace-A project, the standard fixture used across this suite family.
-- \set is not available through the hosted shim, so the id is written out.

-- ── The columns exist at all — the literal bug ──────────────────────────────
SELECT has_column('public', 'phases', 'parent_phase_id',
                  'phases.parent_phase_id exists');
SELECT has_column('public', 'phases', 'status',
                  'phases.status exists');

-- 🚨 BOTH, not just the one PostgREST happened to name. PostgREST reports only
-- the first missing column, so adding parent_phase_id alone would have failed
-- identically on `status` at the very next attempt.

-- ── The exact payload the New Phase dialog sends ────────────────────────────
SELECT lives_ok(
  $$INSERT INTO public.phases (id, project_id, name, description,
                               start_date, end_date, parent_phase_id, status)
    VALUES ('cccc3333-0000-0000-0000-000000000c01',
            'aaaa1111-0000-0000-0000-000000000001',
            'pre pro', '', '2026-08-12', '2026-09-11', NULL, 'not_started')$$,
  'the New Phase payload inserts (Audrey''s "pre pro")');

-- ── status defaults, and is deliberately NOT constrained ────────────────────
INSERT INTO public.phases (id, project_id, name)
VALUES ('cccc3333-0000-0000-0000-000000000c02',
        'aaaa1111-0000-0000-0000-000000000001', 'defaulted');

SELECT is((SELECT status FROM public.phases
            WHERE id = 'cccc3333-0000-0000-0000-000000000c02'),
          'not_started',
          'status defaults to not_started');

-- Unconstrained on purpose, matching assets.status. If anyone later adds a
-- CHECK, this is where that decision gets re-opened rather than silently made.
SELECT lives_ok(
  $$UPDATE public.phases SET status = 'a_status_the_ui_adds_later'
     WHERE id = 'cccc3333-0000-0000-0000-000000000c02'$$,
  'status is plain text — a new UI option is not refused by the database');

-- ── The tree ────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$INSERT INTO public.phases (id, project_id, name, parent_phase_id)
    VALUES ('cccc3333-0000-0000-0000-000000000c03',
            'aaaa1111-0000-0000-0000-000000000001', 'child',
            'cccc3333-0000-0000-0000-000000000c01')$$,
  'a phase can be nested under a parent');

-- 🚨 The one cycle the dropdown can actually produce.
SELECT throws_ok(
  $$UPDATE public.phases
       SET parent_phase_id = 'cccc3333-0000-0000-0000-000000000c01'
     WHERE id = 'cccc3333-0000-0000-0000-000000000c01'$$,
  '23514',
  NULL,
  'a phase cannot be its own parent');

-- CONTROL: the child really is nested before the delete below, so the two
-- assertions after it cannot pass against a row that was never a child.
SELECT is((SELECT parent_phase_id FROM public.phases
            WHERE id = 'cccc3333-0000-0000-0000-000000000c03'),
          'cccc3333-0000-0000-0000-000000000c01'::uuid,
          'CONTROL: the child is nested before its parent is deleted');

-- ── ON DELETE SET NULL — Audrey's decision, and the one that risks data ─────
DELETE FROM public.phases WHERE id = 'cccc3333-0000-0000-0000-000000000c01';

SELECT is((SELECT count(*)::int FROM public.phases
            WHERE id = 'cccc3333-0000-0000-0000-000000000c03'),
          1,
          '🚨 deleting a parent does NOT delete its children');

SELECT is((SELECT parent_phase_id FROM public.phases
            WHERE id = 'cccc3333-0000-0000-0000-000000000c03'),
          NULL,
          'the orphaned child is promoted to top level');

SELECT * FROM finish();
ROLLBACK;
