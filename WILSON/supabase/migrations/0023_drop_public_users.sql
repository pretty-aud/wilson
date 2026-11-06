-- =============================================================================
-- 0023_drop_public_users.sql — Session 10 (closes MASTER_PLAN §6 gap #9)
--
-- Drops the vestigial public.users table. NOT auth.users — that is Supabase's
-- own identity table and MUST stay.
--
-- History: public.users was created by 0000_rabbit_base_schema.sql:109-114
-- (id / email / display_name / created_at) for standalone RABBIT, before the
-- workspace model existed. 0007_drop_public_users_fks.sql already removed the
-- three FK clauses that pointed at it. Since then it has had ZERO dependents:
-- no view, function, trigger, policy, pgTAP probe, Edge Function, or client
-- query references it (`.from('users')` appears nowhere in src/ or electron/).
-- workspace_members has been the roster of record since 0010.
--
-- Why it is worth removing rather than leaving inert:
--   0011_role_grants.sql:21 does `GRANT ALL ON ALL TABLES IN SCHEMA public TO
--   anon, authenticated, service_role`, and public.users is the ONLY table in
--   the schema that never had RLS enabled. supabase/config.toml exposes the
--   public schema through PostgREST. So today it is an unauthenticated
--   READ and WRITE endpoint. It is empty, so nothing has leaked — but it is a
--   standing anonymous insert surface, and the cheapest fix is to delete it.
--
-- Safety: this migration REFUSES to run if the table has rows. The "empty
-- everywhere" claim originates in 0007's header as a Session-3 observation,
-- not a guarantee, so the drop asserts it rather than trusting it. If a
-- deploy fails here, inspect the rows before forcing anything — do not
-- weaken this check to get a push through.
--
-- DROP ... RESTRICT (the default) is deliberate: an unexpected dependent —
-- a view or policy created by hand in the Supabase Studio, outside the
-- migration chain — should fail the deploy loudly rather than be cascaded away.
--
-- Companion change (same session, not SQL): src/tools/rabbit_v0.1.0/db/
-- schema.sql and seed.sql are deleted. Audrey confirmed 2026-07-28 that
-- "standalone RABBIT against your own Supabase project" is no longer a
-- supported deployment — it has been unreachable since Session 2 removed the
-- per-project supabase.json credential fallback, and schema.sql does not even
-- create edit_history / project_members / notes / note_subjects, which current
-- app code queries. The migrations are now the only description of the schema.
--
-- Idempotent: safe to re-run (no-op once the table is gone).
-- =============================================================================

DO $$
DECLARE
  v_rows BIGINT;
  v_deps TEXT;
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE NOTICE '0023: public.users already absent — nothing to do.';
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM public.users' INTO v_rows;
  IF v_rows > 0 THEN
    RAISE EXCEPTION
      '0023 refused: public.users holds % row(s). Inspect and migrate them to workspace_members before dropping.',
      v_rows;
  END IF;

  -- Surface any dependent object by name before the DROP does it less legibly.
  SELECT string_agg(DISTINCT dependent.relname, ', ')
    INTO v_deps
    FROM pg_depend d
    JOIN pg_rewrite r    ON r.oid = d.objid
    JOIN pg_class dependent ON dependent.oid = r.ev_class
   WHERE d.refobjid = 'public.users'::regclass
     AND dependent.relname <> 'users';
  IF v_deps IS NOT NULL THEN
    RAISE EXCEPTION
      '0023 refused: public.users still has dependent object(s): %. Resolve them first.', v_deps;
  END IF;

  EXECUTE 'DROP TABLE public.users';
  RAISE NOTICE '0023: dropped vestigial public.users (empty, no dependents).';
END $$;

-- ── Post-condition ───────────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    RAISE EXCEPTION '0023 post-condition failed: public.users still exists';
  END IF;
  -- auth.users must be untouched.
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION '0023 post-condition failed: auth.users is missing — this migration must never touch it';
  END IF;
END $$;
