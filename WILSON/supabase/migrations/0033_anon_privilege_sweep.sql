-- =============================================================================
-- 0033_anon_privilege_sweep.sql  (Session 22)
--
-- Closes migration 0011's privilege spread: the 25 remaining public tables on
-- which `anon` still holds every table privilege, the seven SECURITY DEFINER
-- functions `anon` can still execute, and — the part that matters most — the
-- ALTER DEFAULT PRIVILEGES that keeps re-arming the trap for every new object.
--
-- 0032 closed exactly one table (rate_cards) and said the other 25 were "a
-- sweep of its own". This is that sweep.
--
-- -----------------------------------------------------------------------------
-- WHAT WAS MEASURED FIRST (wilson-dev, 2026-08-03) — none of this is inferred
-- -----------------------------------------------------------------------------
--
-- 1. THE SPREAD. 36 public BASE TABLEs; 25 carry anon grants, 11 are clean.
--    It is not uniform, and a blanket script would have been wrong:
--      * 23 tables  — all seven privileges (arwdDxtm; `m` is PG17 MAINTAIN,
--                     which information_schema does not surface at all).
--      * platform_operators — REFERENCES, SELECT, TRIGGER only.
--      * workspaces         — REFERENCES, SELECT, TRIGGER *and UPDATE*.
--
-- 2. REVOKING IS BEHAVIOUR-PRESERVING — proven, not assumed. Two measurements,
--    because the S21 lesson is that reasoning about a migration is not the same
--    as querying the database:
--
--    (a) Policy analysis. Every WILSON policy is TO PUBLIC (the Supabase
--        default), so the role column proves nothing; what decides it is
--        whether the expression depends on auth state. Exactly TWO policies in
--        the whole schema have an expression an anon caller could satisfy —
--        platform_approved_models_read and platform_model_defaults_read, both
--        USING (true) — and both of those tables already carry ZERO anon
--        grants. Every other policy dereferences current_workspace_id() /
--        has_active_membership() / auth.uid(), all NULL without a JWT.
--
--    (b) An empirical probe. SET ROLE anon with no JWT — precisely what
--        PostgREST does for an unauthenticated request — then SELECT from all
--        25. Result: 25 probed, 0 readable. 17 denied silently (RLS returned
--        no rows), 8 raised (their policies call helper functions anon cannot
--        execute). So no anon caller reads any of these tables TODAY, and
--        removing the grants cannot turn a working request into a 42501.
--
-- 3. THE GRANTS ARE ON `anon`, NOT ON `PUBLIC`. Checked, because a REVOKE that
--    names the wrong grantee is a silent no-op — which is exactly the trap the
--    functions below DO fall into. Zero of the 36 tables grant to PUBLIC, so
--    `REVOKE ... FROM anon` is sufficient for tables. The seven functions all
--    carry a bare `=X/postgres` aclitem — PUBLIC holding EXECUTE — so for them
--    the revoke MUST name PUBLIC too. 0011:42 already knew this
--    (`REVOKE ... FROM PUBLIC, anon` on workspace_directory); it is easy to
--    forget and impossible to see afterwards without re-querying.
--
-- 4. auth_attempt_log is safe to revoke even though it is written while nobody
--    is signed in: resolve-login/index.ts creates its client with SERVICE_ROLE
--    on all four insert paths (:96, :119, :130), and service_role is untouched
--    here. Login-failure logging keeps working.
--
-- -----------------------------------------------------------------------------
-- THE SECURITY DEFINER FUNCTIONS — the one genuinely LIVE hole
-- -----------------------------------------------------------------------------
--
-- Everything above is latent: RLS already denies anon, and the grants are a
-- second line that should never have been the only one. This part is not
-- latent. 0011:23 did `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO
-- anon`, and seven of those functions are SECURITY DEFINER — they run as their
-- owner (postgres) and bypass RLS by construction. PostgREST exposes them at
-- /rest/v1/rpc/<name>, reachable with only the publishable anon key.
--
-- Five are caller-predicates that collapse to false with a NULL auth.uid()
-- (can_comment_project, can_manage_project_roster, can_write_project,
-- has_active_membership, project_role_for). Two answer questions about DATA
-- rather than about the caller, and those are the actual leak:
--
--   * project_is_staffed(uuid)  — 0013:106-113, literally
--       SELECT EXISTS (SELECT 1 FROM project_members WHERE project_id = $1)
--     No caller dependency at all. A pre-auth existence oracle over
--     project_members.
--   * fn_comment_project_id(text, uuid) — maps an entity to its project id,
--     bypassing RLS.
--
-- Practical severity is bounded by needing to guess a v4 UUID to ask about, so
-- this is a hardening fix rather than an emergency. It is still a pre-auth RLS
-- bypass and should never have been reachable.
--
-- authenticated and service_role keep EXECUTE, so nothing legitimate changes:
-- RLS policies that call these are evaluated as the querying role, and after
-- section 1 an anon caller cannot reach a policy on these tables anyway.
--
-- -----------------------------------------------------------------------------
-- THE ROOT CAUSE, AND THE LIMIT OF WHAT THIS MIGRATION CAN DO
-- -----------------------------------------------------------------------------
--
-- Revoking 25 tables fixes 25 tables. It does not stop table 37 being born
-- exposed, which is how we got here: 0011:26-31 armed ALTER DEFAULT PRIVILEGES
-- so every object `postgres` creates in `public` is granted to anon
-- automatically. Section 3 disarms it.
--
-- MEASURED LIMIT, stated rather than glossed: pg_default_acl holds TWO armed
-- entries per object type in `public` — one granted by `postgres` and one by
-- `supabase_admin`. pg_has_role(current_user, 'supabase_admin', 'MEMBER') is
-- FALSE, so a migration cannot disarm the supabase_admin one. That entry
-- applies only to objects created BY supabase_admin (Supabase's own internal
-- tooling); every WILSON migration runs as `postgres` (verified: current_user
-- and session_user are both `postgres`). So this closes it for everything we
-- create, and not for anything else. The pgTAP assertions added in this
-- session are the real backstop: they fail on ANY table or SECURITY DEFINER
-- function that becomes anon-reachable, whoever created it.
--
-- NOTE FOR CI. 0011's own header records that newer local-stack images do not
-- ship these default privileges at all, so section 3 is a no-op there. That is
-- why nothing in the test suites asserts on pg_default_acl — such an assertion
-- would pass on hosted and fail in CI, or vice versa. The suites assert only
-- on per-object privileges, which are identical in both.
--
-- This does NOT touch RLS, policies, or `authenticated`'s DML. `authenticated`
-- loses only TRUNCATE / REFERENCES / TRIGGER — the three privileges no
-- PostgREST call can issue and that RLS does not constrain. Same shape as
-- 0031 and 0032. Nothing here is a schema change.
--
-- Idempotent: REVOKE and GRANT are no-ops when already in the target state.
-- =============================================================================


-- ── 1. the 25 tables ─────────────────────────────────────────────────────────
-- Explicit rather than a loop, so the diff is reviewable. The post-condition
-- in section 4 scans EVERY public table, so an omission here fails loudly
-- instead of silently shipping 24 of 25.

REVOKE ALL ON public.app_events             FROM anon;
REVOKE ALL ON public.asset_versions         FROM anon;
REVOKE ALL ON public.assets                 FROM anon;
REVOKE ALL ON public.auth_attempt_log       FROM anon;
REVOKE ALL ON public.comments               FROM anon;
REVOKE ALL ON public.files                  FROM anon;
REVOKE ALL ON public.ingestion_chunks       FROM anon;
REVOKE ALL ON public.ingestion_runs         FROM anon;
REVOKE ALL ON public.note_subjects          FROM anon;
REVOKE ALL ON public.notes                  FROM anon;
REVOKE ALL ON public.otter_change_requests  FROM anon;
REVOKE ALL ON public.otter_course_editors   FROM anon;
REVOKE ALL ON public.otter_courses          FROM anon;
REVOKE ALL ON public.otter_progress         FROM anon;
REVOKE ALL ON public.otter_subjects         FROM anon;
REVOKE ALL ON public.phases                 FROM anon;
REVOKE ALL ON public.platform_operators     FROM anon;
REVOKE ALL ON public.project_members        FROM anon;
REVOKE ALL ON public.projects               FROM anon;
REVOKE ALL ON public.rate_card_entries      FROM anon;
REVOKE ALL ON public.task_dependencies      FROM anon;
REVOKE ALL ON public.task_links             FROM anon;
REVOKE ALL ON public.tasks                  FROM anon;
REVOKE ALL ON public.workspace_members      FROM anon;
REVOKE ALL ON public.workspaces             FROM anon;

-- `authenticated` keeps every DML privilege its policies scope and loses only
-- the three that no PostgREST request can use. Revoking a privilege the role
-- does not hold is a no-op, so this is uniform across all 25 even though
-- platform_operators and workspaces never held TRUNCATE. No GRANT-back is
-- needed: these are pre-existing tables and the remaining privileges are
-- untouched (0032 set the same precedent; 0031's GRANT-back existed only
-- because those tables were new in that migration).

REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.app_events            FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.asset_versions        FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.assets                FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.auth_attempt_log      FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.comments              FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.files                 FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.ingestion_chunks      FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.ingestion_runs        FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.note_subjects         FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.notes                 FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.otter_change_requests FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.otter_course_editors  FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.otter_courses         FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.otter_progress        FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.otter_subjects        FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.phases                FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.platform_operators    FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.project_members       FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.projects              FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.rate_card_entries     FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.task_dependencies     FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.task_links            FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.tasks                 FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.workspace_members     FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.workspaces            FROM authenticated;


-- ── 2. the seven anon-executable SECURITY DEFINER functions ──────────────────
-- FROM PUBLIC, anon — naming only anon would be a no-op, because every one of
-- these carries a bare `=X/postgres` aclitem. Measured, not assumed.
-- The GRANT-back is the 0011:42-43 / 0030:45-47 pattern: state the intended
-- grantees explicitly so a future reader does not have to diff two ACLs.

REVOKE EXECUTE ON FUNCTION public.can_comment_project(UUID)          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_comment_project(UUID)          TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.can_manage_project_roster(UUID)    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_manage_project_roster(UUID)    TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.can_write_project(UUID)            FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_write_project(UUID)            TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_comment_project_id(TEXT, UUID)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_comment_project_id(TEXT, UUID)  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.has_active_membership(UUID)        FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_active_membership(UUID)        TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.project_is_staffed(UUID)           FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.project_is_staffed(UUID)           TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.project_role_for(UUID)             FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.project_role_for(UUID)             TO authenticated, service_role;


-- ── 3. disarm 0011's ALTER DEFAULT PRIVILEGES ────────────────────────────────
-- Without this, sections 1 and 2 are a one-off cleanup and the next CREATE
-- TABLE re-opens the hole. Applies to objects created by `postgres`, which is
-- every WILSON migration. See the header for the supabase_admin entry we
-- cannot reach. No-op on the CI local stack, which never armed it.

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL     ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL     ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- Keep future tables consistent with what section 1 just did to existing ones.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;


-- ── 4. post-conditions ───────────────────────────────────────────────────────
-- These scan every object rather than the 25 named above, so a table missing
-- from section 1 — or a new one that slips through — aborts the migration
-- instead of shipping a partial sweep that reads as complete.

DO $$
DECLARE
  leftover TEXT;
BEGIN
  -- 4a. No public table may grant anything to anon.
  SELECT string_agg(DISTINCT g.table_name, ', ' ORDER BY g.table_name)
    INTO leftover
    FROM information_schema.role_table_grants g
   WHERE g.table_schema = 'public' AND g.grantee = 'anon';

  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION
      '0033 post-condition failed: anon still holds table privileges on: %',
      leftover;
  END IF;

  -- 4b. No SECURITY DEFINER function in public may be anon-executable. These
  --     bypass RLS by construction, so this is the assertion that matters
  --     most. Catches a revoke that named the wrong grantee (see header §3).
  SELECT string_agg(p.proname::text, ', ' ORDER BY p.proname::text)
    INTO leftover
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prokind = 'f'
     AND p.prosecdef
     AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION
      '0033 post-condition failed: anon can still execute SECURITY DEFINER function(s): %',
      leftover;
  END IF;

  -- 4c. Prove we did not over-revoke. `authenticated` must keep the DML its
  --     policies scope — an over-broad REVOKE would break the whole app, and
  --     4a/4b would still have passed.
  IF NOT (
        has_table_privilege('authenticated', 'public.tasks',    'SELECT')
    AND has_table_privilege('authenticated', 'public.tasks',    'INSERT')
    AND has_table_privilege('authenticated', 'public.tasks',    'UPDATE')
    AND has_table_privilege('authenticated', 'public.tasks',    'DELETE')
    AND has_table_privilege('authenticated', 'public.projects', 'SELECT')
    AND has_table_privilege('authenticated', 'public.workspaces','SELECT')
    AND has_table_privilege('authenticated', 'public.workspaces','UPDATE')
  ) THEN
    RAISE EXCEPTION
      '0033 post-condition failed: authenticated lost DML it needs (over-revoked)';
  END IF;

  -- 4d. And that the helper functions still work for signed-in callers.
  IF NOT (
        has_function_privilege('authenticated', 'public.has_active_membership(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.can_write_project(uuid)',     'EXECUTE')
    AND has_function_privilege('service_role',  'public.has_active_membership(uuid)', 'EXECUTE')
  ) THEN
    RAISE EXCEPTION
      '0033 post-condition failed: authenticated/service_role lost EXECUTE on a policy helper';
  END IF;
END $$;
