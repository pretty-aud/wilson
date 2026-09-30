-- =============================================================================
-- 0082_private_project_definers.sql — the merge of Track A over the UI
-- overhaul, review round 1, finding A-R1-01 (2026-09-30).
--
-- WHAT WENT WRONG, AND WHY NEITHER PARENT SAW IT
-- ---------------------------------------------
-- 0072 (the overhaul's demo work) made a project PRIVATE-able: projects_select
-- gained a fourth arm — `NOT is_private OR created_by = auth.uid() OR
-- current_app_role() = 'admin'` — and every child table follows through the
-- live-parent hop in its own SELECT policy. That is true of every POLICY. It
-- is not true of a SECURITY DEFINER body, which reads projects with RLS
-- bypassed and has to spell the read predicate out itself. Two such bodies
-- were written before 0072 existed:
--
--   1. milestones_trash_index (0067, Track A). Its read gate copies the
--      PRE-0072 projects_select (workspace + live + membership), so any active
--      member who has a private project's id can list its deleted key dates:
--      title, date, colour, description, who deleted it.
--   2. fn_trash_authz (0014, extended by 0067). soft_delete_row and
--      restore_soft_deleted authorise through it, and its project gate is
--      can_write_project — true for every admin and manager, and for EVERY
--      member on an unstaffed project — with no privacy arm. So the ids the
--      trash index hands out can be restored into (or trashed out of) someone
--      else's private project, for the seven project-scoped child tables. For
--      the projects row itself the gate ADMITTED a non-admin and 0014's
--      admin-only trigger then refused the UPDATE — a refusal from a later
--      guard, with a different message, after the gate had said yes (merge
--      review round 2, A-R2-01, corrected this paragraph: round 1 said a
--      manager could soft-delete a private project whole, which the trigger
--      never allowed).
--   3. milestones_insert and milestones_update (0067). Their WITH CHECK is
--      workspace + membership + can_write_project, with no hop through
--      projects — the hop only milestones_select carries. So a manager, or
--      any member of an unstaffed private project, who holds the id can put a
--      key date INTO it (supabase-js's .insert() without .select() sends
--      Prefer: return=minimal, so no SELECT policy is ever consulted) or move
--      an existing one into it (merge review round 2, A-R2-03). §3b.
--
-- The overhaul parent (60a8981) has 0072 and no milestones_trash_index; the
-- track parent (f1a432e) has milestones_trash_index and no is_private. The
-- merge (1936c8a) was textually clean, so nothing flagged it; suite 80
-- (private projects) was written before milestones existed and never
-- mentions them. Suite 82 does.
--
-- 🚨 WHY THE FIX IS SPELLED OUT AND NOT DELEGATED. The obvious repair — call
-- can_read_project_topic (0016, SECURITY INVOKER over projects_select) from
-- inside these bodies — does nothing: a SECURITY INVOKER function called from
-- a SECURITY DEFINER body runs as the DEFINER's owner, and the owner bypasses
-- RLS — which is 0067's own statement of why its gate is "spelled out rather
-- than delegated". The predicate has to be restated on the definer side. It
-- is restated ONCE, in passes_project_privacy() below, and both bodies call
-- that, so 0072's fourth arm lives in exactly two places from now on: the
-- policy, and this helper. The post-conditions pin both, comments stripped
-- (the 0077 lesson: pg_get_functiondef returns comments, and a commented-out
-- arm has passed a body check before).
--
-- WHAT IS DELIBERATELY NOT CHANGED
-- --------------------------------
-- * The messages. Suite 71 pins 'not_a_workspace_member' and 'not allowed to
--   read this project''s trash' in that order, and suite 19 pins 'not allowed
--   to soft-delete or restore this row'; a privacy refusal reads exactly as a
--   workspace refusal does, which is also the right answer — the caller is
--   not told that a project they cannot see exists.
-- * fn_trash_authz still authorises a restore under a TRASHED parent (0067's
--   stated behaviour: the restored row is re-hidden by the child SELECT policy
--   until the parent comes back). The privacy arm does not require the project
--   to be live, only to be the caller's to see — an admin restoring a trashed
--   private project through restore_soft_deleted('projects', …) is the case
--   that would otherwise break, and suite 82 probes 27-30 keep it. The
--   projects row itself is the ADMIN's alone to trash or restore: 0014's
--   fn_soft_delete_stamp refuses every non-admin, creator included, and does
--   so AFTER this gate — suite 82 probe 26 pins the creator's refusal by the
--   trigger's message, which is the proof that the arm admitted them first.
-- * 0014's trigger. This file adds an arm to the gate that runs BEFORE it and
--   takes nothing from it (0067's post-condition still asserts the guard).
-- * fn_workspace_realtime_broadcast (0018). It publishes whole projects rows
--   (and tasks / assets / project_members) to every active member on
--   rabbit:workspace:{ws} with no privacy check, which is how a private
--   project's id reaches a member who cannot SELECT it (the merge review's
--   A-R1-04). That is PRE-EXISTING on the overhaul parent, is a product
--   decision about what the workspace channel carries (a project flipped to
--   private would vanish from the other members' index only on their next
--   refetch), and is NOT this migration's: docs/OUTSTANDING.md records it for
--   its own number. With this file a leaked id opens neither the trash index
--   nor the trash RPCs, and (§3b) neither of the milestone write policies —
--   so for milestones the leak is a name, not access. It is NOT "opens
--   nothing" across the schema (round 1 said so, and round 2's A-R2-03
--   corrected it): tasks_insert and assets_insert (0013) have the same
--   can_write_project-only WITH CHECK, pre-existing on the overhaul parent,
--   and are recorded beside the broadcast in docs/OUTSTANDING.md.
--
-- ORDERING: depends on 0013 (can_write_project, can_comment_project), 0014
-- (fn_trash_authz's shape; soft_delete_row / restore_soft_deleted call it;
-- fn_soft_delete_stamp's projects guard, which runs after the gate), 0067
-- (public.milestones, milestones_trash_index, the eight-name allowlist, and
-- milestones_insert / milestones_update, which §3b retypes) and 0072
-- (projects.is_private and the arm this restates — post-condition 4a refuses
-- to run without it). Nothing depends on this one yet.
--
-- Number: 0082 was the next unused number across every branch when round 1
-- took it (0076 C4, 0077 A, 0078 C, 0079 bins, 0080 assemblies, 0081 file
-- metadata). 🚨 The post-overhaul plan (2026-09-29) names 0082 / suite 82 as
-- the FIRST FREE numbers for its five feature sessions — that is stale: this
-- merge holds both, and the next free numbers are 0083 / suite 83 (measured
-- across every local and remote ref, 2026-09-30). Audrey's plan needs the
-- renumbering before any feature session starts.
-- pgTAP: supabase/tests/rls/82_private_project_definers.sql.
-- Idempotent: CREATE OR REPLACE / DROP-then-CREATE throughout. Safe to re-run.
-- No table DDL. Two policies retyped (§3b: milestones_insert and
-- milestones_update, each 0067's body plus the parent hop).
-- =============================================================================


-- =============================================================================
-- 1. THE PRIVACY ARM, ONCE — the definer-side restatement of 0072's fourth arm
-- =============================================================================
--
-- SECURITY DEFINER like the 0013 helpers it sits beside (project_is_staffed,
-- can_write_project): it reads projects with RLS bypassed ON PURPOSE, because
-- the callers are definer bodies that need the answer for a row the caller may
-- not be able to SELECT. auth.uid() and current_app_role() both read the
-- request's JWT claims from the session GUC, which a definer body still sees
-- as the real caller's (0008's reasoning), so the three arms evaluate exactly
-- as they do in projects_select.
--
-- A project id that resolves to no row answers FALSE, never NULL (EXISTS), so
-- a caller can never pass a gate by naming a project that is not there.
--
-- No client role may execute it: it is reached only from the two definer
-- bodies below, which run as the owner. A plain client must not be able to
-- probe "is this id a private project I cannot see?" by calling it directly.

CREATE OR REPLACE FUNCTION public.passes_project_privacy(p_project UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.id = p_project
       AND (
         NOT p.is_private
         OR p.created_by = auth.uid()
         OR public.current_app_role() = 'admin'
       )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.passes_project_privacy(UUID)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.passes_project_privacy(UUID) IS
  '0082: the privacy arm of projects_select (0072) — the project is not private, or the caller created it, or the caller is a workspace admin — restated for SECURITY DEFINER bodies, which bypass RLS and cannot delegate to the policy (a SECURITY INVOKER helper called from a definer body runs as the owner). Callers: milestones_trash_index, fn_trash_authz. Keep it word-for-word with the policy; suite 82 and this migration''s post-conditions pin both. No client role executes it.';


-- =============================================================================
-- 2. milestones_trash_index — the read gate gains the arm
-- =============================================================================
--
-- 0067's body, reproduced, with ONE change: the read gate's EXISTS carries
-- passes_project_privacy(). DROP-then-CREATE as 0067 did (a RETURNS TABLE
-- signature cannot be edited under CREATE OR REPLACE if a column ever moves),
-- and the grants and the comment are re-applied because DROP takes them.
-- The two messages and their order are 0067's: suite 71 pins them.

DROP FUNCTION IF EXISTS public.milestones_trash_index(UUID);

CREATE FUNCTION public.milestones_trash_index(p_project_id UUID)
RETURNS TABLE (
  id               UUID,
  project_id       UUID,
  phase_id         UUID,
  title            TEXT,
  date             DATE,
  color            TEXT,
  description      TEXT,
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID,
  deleted_by_label TEXT,
  purges_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws UUID := public.current_workspace_id();
  -- Must track purge_soft_deleted()'s p_retention default and the pg_cron job
  -- 'wilson-purge-soft-deleted' (04:47 UTC, 0014 section 4). It drives a
  -- "purges in N days" countdown only; nothing is deleted on this path.
  v_keep INTERVAL := INTERVAL '30 days';
BEGIN
  IF v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;
  -- The READ gate: the project must be one this caller can see. Spelled out
  -- rather than delegated, because this function is SECURITY DEFINER and
  -- therefore does NOT get projects_select applied for it — all FOUR of its
  -- arms since 0082: workspace, live, membership (above), and privacy
  -- (passes_project_privacy, the 0072 arm this gate lacked).
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.id = p_project_id
       AND p.workspace_id = v_ws
       AND p.deleted_at IS NULL
       AND public.passes_project_privacy(p.id)
  ) THEN
    RAISE EXCEPTION 'not allowed to read this project''s trash';
  END IF;

  RETURN QUERY
  SELECT m.id,
         m.project_id,
         m.phase_id,
         m.title,
         m.date,
         m.color,
         m.description,
         m.deleted_at,
         m.deleted_by,
         COALESCE(dm.display_name, dm.username) AS deleted_by_label,
         (m.deleted_at + v_keep)                AS purges_at
    FROM public.milestones m
    LEFT JOIN public.workspace_members dm
           ON dm.workspace_id = m.workspace_id AND dm.user_id = m.deleted_by
   WHERE m.project_id   = p_project_id
     AND m.workspace_id = v_ws
     AND m.deleted_at IS NOT NULL
   -- No per-row parent check: every row here shares p_project_id, and the
   -- gate above already proved that project is live, in this workspace and
   -- the caller's to see.
   ORDER BY m.deleted_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.milestones_trash_index(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.milestones_trash_index(UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.milestones_trash_index IS
  'Trashed milestones for one live project, newest first, with a purges_at countdown. SECURITY DEFINER because milestones_select hides trashed rows by design. Gated on READ (active membership + a live project in the caller''s workspace + the private-project arm, i.e. projects_select as of 0072 — the arm added by 0082), NOT on can_write_project: a reviewer can read the project''s live key dates and may read its deleted ones. Restore is gated separately, client-side by GatedAction and server-side by fn_trash_authz (0067, ruling 38).';


-- =============================================================================
-- 3. fn_trash_authz — the project gate gains the arm, for all eight tables
-- =============================================================================
--
-- 0067's body, reproduced, with ONE change: v_allowed also requires
-- passes_project_privacy(v_project) wherever a project was resolved. Every
-- project-scoped table goes through this — projects, phases, assets, tasks,
-- files, comments, milestones — so a private project's rows can be trashed
-- and restored only by their creator and by an admin, which is who can SELECT
-- them. rate_cards are workspace-level and still carry no project gate.

CREATE OR REPLACE FUNCTION public.fn_trash_authz(p_table TEXT, p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws      UUID;
  v_project UUID;
  v_allowed BOOLEAN;
BEGIN
  IF p_table NOT IN ('projects','phases','assets','tasks','files',
                     'comments','rate_cards','milestones') THEN
    RAISE EXCEPTION 'not a soft-delete table: %', p_table;
  END IF;

  -- Resolve the row's workspace and (where applicable) project for the
  -- authorization check. rate_cards are workspace-level → no project gate.
  EXECUTE format(
    'SELECT %s, %s FROM public.%I WHERE id = $1',
    CASE WHEN p_table = 'phases'
         THEN '(SELECT p.workspace_id FROM public.projects p WHERE p.id = project_id)'
         ELSE 'workspace_id' END,
    CASE p_table
      WHEN 'projects'   THEN 'id'
      WHEN 'rate_cards' THEN 'NULL::uuid'
      WHEN 'comments'   THEN 'public.fn_comment_project_id(entity_type, entity_id)'
      ELSE 'project_id' END,
    p_table)
    INTO v_ws, v_project
    USING p_id;

  v_allowed := CASE
    WHEN p_table = 'comments' THEN public.can_comment_project(v_project)
    WHEN v_project IS NULL    THEN true  -- rate_cards / dead-end walks
    ELSE public.can_write_project(v_project)
  END;

  -- 0082: the write gates above predate private projects (0072) and know
  -- nothing of them; can_write_project is true for every admin and manager
  -- and for every member of an unstaffed project. A row under a private
  -- project is the creator's and an admin's to trash or restore, and nobody
  -- else's — the same three arms projects_select applies to reading it.
  IF v_project IS NOT NULL AND NOT public.passes_project_privacy(v_project) THEN
    v_allowed := false;
  END IF;

  IF v_ws IS NULL
     OR v_ws IS DISTINCT FROM public.current_workspace_id()
     OR NOT public.has_active_membership(v_ws)
     OR NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'not allowed to soft-delete or restore this row';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_trash_authz(TEXT, UUID)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_trash_authz IS
  'Authorizes a soft-delete or restore for one of the eight soft-delete RABBIT tables (0014''s seven plus milestones, 0067): workspace match, active membership and the project gate — the comment gate for comments, none for workspace-level rate_cards — and, since 0082, the private-project arm of projects_select (0072) for every project-scoped row: a private project''s rows are the creator''s and an admin''s to trash or restore. For the projects row itself this gate admits the creator and 0014''s fn_soft_delete_stamp, which runs after it, admits only an admin.';


-- =============================================================================
-- 3b. milestones_insert / milestones_update — the WRITE policies hop to the
--     parent (merge review round 2, A-R2-03)
-- =============================================================================
--
-- 0067's two write policies gate on can_write_project alone, with no hop
-- through projects: a manager, or any member of an unstaffed private project,
-- who holds the project's id could INSERT a key date into it — supabase-js's
-- .insert() without .select() sends Prefer: return=minimal, so no SELECT
-- policy is ever consulted — or move an existing one INTO it through UPDATE's
-- WITH CHECK. §2 and §3 above refuse that id on the trash paths; the plain
-- write path did not, and the header's "opens nothing" was false for it.
--
-- The hop is the one milestones_select (0067) already carries. A POLICY runs
-- as the caller, so the subquery is evaluated under projects_select and
-- carries all four of its arms — workspace, live, membership and privacy —
-- with no EXECUTE needed on passes_project_privacy and no second restatement
-- of the arm: the policy hop and the definer helper are the two spellings,
-- one per execution context. 0067's bodies are otherwise reproduced word for
-- word; milestones_delete and milestones_select are untouched.
--
-- (tasks_insert / assets_insert / assets_update / tasks_update in 0013 have
-- the same shape and the same gap, PRE-EXISTING on the overhaul parent —
-- docs/OUTSTANDING.md, beside the workspace broadcast, for its own number.)

DROP POLICY IF EXISTS milestones_insert ON public.milestones;
CREATE POLICY milestones_insert ON public.milestones
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    -- 0082: the parent must be one the caller can SELECT (projects_select's
    -- four arms, privacy included) — a leaked id is a name, not a write.
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = milestones.project_id)
  );

DROP POLICY IF EXISTS milestones_update ON public.milestones;
CREATE POLICY milestones_update ON public.milestones
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.can_write_project(project_id)
    -- 0082: gate the NEW row's parent too, or a key date could be moved INTO
    -- a private project (0013's own reasoning for assets_update's WITH CHECK).
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = milestones.project_id)
  );


-- =============================================================================
-- 4. POST-CONDITIONS — assert, do not assume (comments stripped first)
-- =============================================================================

DO $$
DECLARE
  t       TEXT;
  v_body  TEXT;
  v_hits  INT;
  v_qual  TEXT;
BEGIN
  -- 4a. The policy this restates still carries its arm — the premise of the
  --     whole file. If 0072 were rolled back, this migration would be pinning
  --     a predicate the policy no longer has.
  SELECT qual INTO v_qual FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'projects_select';
  IF v_qual IS NULL OR position('is_private' IN v_qual) = 0 THEN
    RAISE EXCEPTION '0082 post-condition failed: projects_select does not read is_private — 0072 is not in place';
  END IF;

  -- 4b. The helper names all three arms, comments stripped (both forms), and
  --     is SECURITY DEFINER (it reads projects for callers who cannot).
  v_body := pg_get_functiondef('public.passes_project_privacy(uuid)'::regprocedure);
  v_body := regexp_replace(v_body, '/\*.*?\*/', '', 'gs');
  v_body := regexp_replace(v_body, '--[^' || chr(10) || ']*', '', 'g');
  IF v_body NOT LIKE '%NOT p.is_private%'
     OR v_body NOT LIKE '%p.created_by = auth.uid()%'
     OR v_body NOT LIKE '%public.current_app_role() = ''admin''%' THEN
    RAISE EXCEPTION '0082 post-condition failed: passes_project_privacy does not restate all three arms of projects_select';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'passes_project_privacy' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION '0082 post-condition failed: passes_project_privacy must be SECURITY DEFINER';
  END IF;

  -- 4c. Each of the two bodies calls the helper — exactly once, so a second
  --     mention cannot be a commented-out or shadowed copy — with comments
  --     stripped first (0077 §3c: a `-- passes_project_privacy` line satisfied
  --     a presence check in R1 of that file with the arm deleted).
  FOREACH t IN ARRAY ARRAY['public.milestones_trash_index(uuid)',
                           'public.fn_trash_authz(text, uuid)']
  LOOP
    v_body := pg_get_functiondef(t::regprocedure);
    v_body := regexp_replace(v_body, '/\*.*?\*/', '', 'gs');
    v_body := regexp_replace(v_body, '--[^' || chr(10) || ']*', '', 'g');
    v_hits := (length(v_body) - length(replace(v_body, 'passes_project_privacy(', '')))
              / length('passes_project_privacy(');
    IF v_hits <> 1 THEN
      RAISE EXCEPTION '0082 post-condition failed: % names passes_project_privacy % times in its comment-stripped body (expected 1)', t, v_hits;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = t::regprocedure AND prosecdef) THEN
      RAISE EXCEPTION '0082 post-condition failed: % is no longer SECURITY DEFINER', t;
    END IF;
  END LOOP;

  -- 4d. The retyped bodies lost nothing they had (the 0059 lesson: a CREATE
  --     OR REPLACE that drops arms is a privilege escalation). The trash index
  --     still raises both of 0067's messages; fn_trash_authz still names all
  --     eight tables and both write gates.
  v_body := regexp_replace(regexp_replace(
              pg_get_functiondef('public.milestones_trash_index(uuid)'::regprocedure),
              '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g');
  IF v_body NOT LIKE '%not_a_workspace_member%'
     OR v_body NOT LIKE '%not allowed to read this project''''s trash%' THEN
    RAISE EXCEPTION '0082 post-condition failed: milestones_trash_index lost one of 0067''s two refusals';
  END IF;
  IF v_body NOT LIKE '%p.deleted_at IS NULL%' OR v_body NOT LIKE '%p.workspace_id = v_ws%' THEN
    RAISE EXCEPTION '0082 post-condition failed: milestones_trash_index lost its live-project or workspace arm';
  END IF;

  v_body := regexp_replace(regexp_replace(
              pg_get_functiondef('public.fn_trash_authz(text, uuid)'::regprocedure),
              '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g');
  FOREACH t IN ARRAY ARRAY['projects','phases','assets','tasks','files',
                           'comments','rate_cards','milestones']
  LOOP
    IF v_body NOT LIKE '%''' || t || '''%' THEN
      RAISE EXCEPTION '0082 post-condition failed: fn_trash_authz no longer names % — an arm was lost while the body was retyped', t;
    END IF;
  END LOOP;
  IF v_body NOT LIKE '%public.can_write_project(v_project)%'
     OR v_body NOT LIKE '%public.can_comment_project(v_project)%' THEN
    RAISE EXCEPTION '0082 post-condition failed: fn_trash_authz lost one of its two write gates';
  END IF;
  IF v_body NOT LIKE '%public.has_active_membership(v_ws)%'
     OR v_body NOT LIKE '%public.current_workspace_id()%' THEN
    RAISE EXCEPTION '0082 post-condition failed: fn_trash_authz lost its workspace or membership check';
  END IF;

  -- 4e. Privileges as before, plus the helper's: no client role holds EXECUTE
  --     on the two gates or the helper; authenticated keeps the trash index
  --     (the panel calls it over PostgREST).
  IF has_function_privilege('anon', 'public.passes_project_privacy(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.passes_project_privacy(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.milestones_trash_index(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_trash_authz(text, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_trash_authz(text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0082 post-condition failed: a client role holds EXECUTE it must not';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.milestones_trash_index(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0082 post-condition failed: authenticated lost EXECUTE on milestones_trash_index (the panel calls it over PostgREST)';
  END IF;

  -- 4f. The two write policies carry the parent hop in their WITH CHECK, and
  --     neither lost its write gate while it was retyped; milestones_update's
  --     USING still carries all three of 0067's gates (the 0059 lesson, for a
  --     policy: DROP + CREATE with a clause missing is the same escalation).
  --     pg_policies deparses the expressions, so the checks are by name.
  FOREACH t IN ARRAY ARRAY['milestones_insert', 'milestones_update']
  LOOP
    SELECT with_check INTO v_qual FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'milestones' AND policyname = t;
    IF v_qual IS NULL
       OR position('projects' IN v_qual) = 0
       OR position('can_write_project' IN v_qual) = 0
       OR position('current_workspace_id' IN v_qual) = 0 THEN
      RAISE EXCEPTION '0082 post-condition failed: %''s WITH CHECK does not hop to projects, or lost its workspace or write gate', t;
    END IF;
  END LOOP;
  SELECT qual INTO v_qual FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'milestones' AND policyname = 'milestones_update';
  IF v_qual IS NULL
     OR position('can_write_project' IN v_qual) = 0
     OR position('has_active_membership' IN v_qual) = 0
     OR position('current_workspace_id' IN v_qual) = 0 THEN
    RAISE EXCEPTION '0082 post-condition failed: milestones_update''s USING lost one of 0067''s three gates';
  END IF;
  SELECT with_check INTO v_qual FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'milestones' AND policyname = 'milestones_insert';
  IF position('has_active_membership' IN v_qual) = 0 THEN
    RAISE EXCEPTION '0082 post-condition failed: milestones_insert lost its membership gate';
  END IF;

  RAISE NOTICE '0082: private-project arm on milestones_trash_index and fn_trash_authz (passes_project_privacy, no client EXECUTE); parent hop on milestones_insert / milestones_update WITH CHECK';
END $$;
