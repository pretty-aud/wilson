-- =============================================================================
-- 0083_private_project_file_gates.sql — the merge of Track C over the UI
-- overhaul, review round 1, finding C-R1-01 (2026-09-30).
--
-- WHAT WENT WRONG, AND WHY NEITHER PARENT SAW IT
-- ---------------------------------------------
-- The same class 0082 closed for Track A, met again in Track C's files. 0072
-- (the overhaul's demo work) gave projects_select a fourth arm — `NOT
-- is_private OR created_by = auth.uid() OR current_app_role() = 'admin'` —
-- and every POLICY follows it through the live-parent hop. A SECURITY DEFINER
-- body does not: it reads projects with RLS bypassed and has to spell the
-- read predicate out itself, and a WRITE policy with no hop through projects
-- never consults projects_select at all. Track C was written on the
-- pre-overhaul code, where no project was private, so its gates check project
-- access the pre-0072 way:
--
--   1. reserve_upload_bytes (0073, restated in full by 0078). Refuses only on
--      workspace + membership (its first refusal) and then can_write_project —
--      true for every admin and manager and for EVERY member of an unstaffed
--      project (0013), with no privacy arm. So a second manager, or a plain
--      member of an unstaffed private project, who holds the project's id can
--      reserve against `projects/<private-id>/…`; abandon_upload_reservation
--      (0074) and the hourly sweep (0073) then certify the abandonment into
--      that project's file_events with r.project_id — a forged certificate in
--      a private project's history. The id leaks through the workspace
--      channel (docs/OUTSTANDING.md, the Track A entry).
--   2. log_file_downloaded (0047, restated in full by 0074). Keeps 0047's
--      pre-0072 check — workspace + membership + live project + the 0038
--      money arm — so the same callers can write a 'downloaded' event for a
--      private project's file and use the RPC as an existence oracle for its
--      file ids. This one PRE-EXISTS on the overhaul parent (0074 is Track
--      C's, but 0047's gate had the gap the day 0072 landed); 0082 did not
--      list it.
--   3. files_insert and files_update (0038, Track C's own table). Their WITH
--      CHECK is workspace + membership + can_write_project + the money arm,
--      with no hop through projects — the hop only files_select carries. So
--      the same callers can put a files row INTO a private project
--      (supabase-js's .insert() without .select() sends Prefer:
--      return=minimal, so no SELECT policy is ever consulted) and can
--      rewrite one already there with an UPDATE that reads no column (no
--      WHERE, no RETURNING: only files_update's own USING and WITH CHECK
--      judge it) — 0082 §3b's finding, on `files`. 🚨 NOT a filtered move:
--      an UPDATE with a WHERE reads a column, so Postgres requires SELECT
--      and applies files_select's USING — hop included — to the NEW row as
--      a WITH CHECK (rowsecurity.c), and `SET project_id = <private> WHERE
--      id = …` was refused before this file. Round 2 (C-R2-01) corrected
--      round 1's wording here: on files_update the hop is the only gate for
--      the column-free shape and defence in depth for every other.
--
-- Reads were already safe: 0074's file_events_select uses
-- can_read_project_topic, SECURITY INVOKER over projects_select, and
-- files_select (0038) hops to projects. The merge (fc2aee8) was textually
-- clean, so nothing flagged any of this; suite 82 pins only the two bodies
-- 0082 fixed, so CI could not catch it either. Suite 83 does.
--
-- 🚨 WHY THE FIX IS SPELLED OUT AND NOT DELEGATED — 0082's reasoning, kept.
-- A SECURITY INVOKER helper called from a SECURITY DEFINER body runs as the
-- owner and bypasses RLS, so the definer bodies call passes_project_privacy
-- (0082 §1), the ONE definer-side restatement of the arm, and the policies
-- take the hop, which a policy evaluates as the caller under projects_select.
-- The two spellings, one per execution context, exactly as 0082 laid out.
-- Every body and policy here is otherwise reproduced word for word from the
-- file that last defined it — 0078, 0074, 0038 — and the post-conditions
-- assert, comments stripped, that nothing was lost in the retype (the 0059
-- lesson: a CREATE OR REPLACE that drops arms is a privilege escalation).
--
-- WHAT IS DELIBERATELY NOT CHANGED
-- --------------------------------
-- * The messages and error codes. reserve_upload_bytes refuses with the same
--   42501 sentence its first refusal already raises ('you cannot write to this
--   project'), and log_file_downloaded with 0047's one refusal ('file not
--   found or not readable'): a privacy refusal reads exactly as a workspace
--   refusal does, so the caller is not told that a project they cannot see
--   exists. 0078's post-condition 9e and suite 77 key on the codes; both hold.
-- * abandon_upload_reservation, release_upload_reservation,
--   release_stale_upload_reservations and the sweeps. Every one of them acts
--   on a reservation ROW, and after this file no reservation can be made
--   against a project the caller cannot see, so the certificate they write
--   carries a project_id the reservation's maker was entitled to name. A
--   project flipped to private AFTER a reservation was made still receives
--   that reservation's certificate — it is that project's own history, and
--   file_events_select hides it from everyone the arm hides the project from.
-- * The order of reserve_upload_bytes's checks. The arm joins the FIRST
--   refusal, before the quota exemption, so an exempt (money) path is refused
--   for a private project too — a reservation-exempt call writes no row, but
--   it must not answer "exempt" for a project the caller cannot see.
-- * files_select and files_delete (0038). files_select already hops.
--   files_delete does not, and is left alone: a DELETE with a WHERE reads a
--   column, so it runs under files_select's USING as well and cannot reach
--   a row in a private project the caller cannot see; the app's own delete
--   is 0014's soft delete through fn_trash_authz, which 0082 armed. What
--   that does NOT close (round 2, C-R2-01): `DELETE FROM public.files` with
--   no WHERE reads no column, runs under files_delete's USING alone, and
--   authenticated still holds DELETE on files (0033 revokes only TRUNCATE /
--   REFERENCES / TRIGGER) — a second manager could hard-delete a private
--   project's rows with one, purge certificates and all. PRE-EXISTING on the
--   overhaul parent (0038 met 0072 there); recorded in docs/OUTSTANDING.md
--   beside the tasks / assets policies that wait for the same hop.
-- * fn_workspace_realtime_broadcast (0018) and the tasks / assets policies
--   (0013): PRE-EXISTING, recorded in docs/OUTSTANDING.md, not this file's.
--
-- ORDERING: depends on 0013 (can_write_project), 0037
-- (can_access_project_money), 0038 (the four files policies this retypes two
-- of; the money arm every body keeps), 0047 / 0074 (log_file_downloaded's
-- shape and the file_event_is_financial flag 0074's post-condition pins),
-- 0073 / 0078 (reserve_upload_bytes's shape, the bounded exemption 0078's
-- post-conditions 9a/9b pin, upload_reservations), 0072 (projects.is_private
-- and the arm this restates — post-condition 1 refuses to run without it) and
-- 0082 (passes_project_privacy, which this file calls and does not redefine).
-- Nothing depends on this one yet.
--
-- Number: 0083 was the next unused number across every local and remote ref
-- when this round took it (0082's header and docs/OUTSTANDING.md both
-- measured it free on 2026-09-30). 🚨 The post-overhaul plan (2026-09-29)
-- still names 0082 / suite 82 as its first free numbers, and OUTSTANDING's
-- Track A entry corrected that to 0083 / 83: BOTH are now stale. The next
-- free numbers are 0084 / suite 84. Audrey's plan needs the renumbering
-- before any feature session starts.
-- pgTAP: supabase/tests/rls/83_private_project_file_gates.sql.
-- Idempotent: CREATE OR REPLACE / DROP-then-CREATE throughout. Safe to re-run.
-- No table DDL. Two policies retyped (§3: files_insert and files_update, each
-- 0038's body plus the parent hop).
-- =============================================================================


-- =============================================================================
-- 1. reserve_upload_bytes — the first refusal gains the arm
-- =============================================================================
--
-- 0078's body, reproduced, with ONE change: the first refusal — the one that
-- runs before the quota exemption — also refuses when the project is not the
-- caller's to see. COALESCEd like every other predicate in this body (0047's
-- RPC lesson: a NULL PASSES an `IF NOT`); passes_project_privacy is an EXISTS
-- and never NULL, but the discipline is the body's, not the helper's.
-- CREATE OR REPLACE keeps 0073's grants (authenticated, service_role) and
-- 0078's comment, which is re-applied below with this arm named.

CREATE OR REPLACE FUNCTION public.reserve_upload_bytes(p_path TEXT, p_bytes BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_project  UUID;
  v_ws       UUID;
  v_status   TEXT;
  v_quota    BIGINT;
  v_used     BIGINT;
  v_id       BIGINT;
  v_leaf     TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'reserve_upload_bytes: not signed in'
      USING ERRCODE = '42501';
  END IF;

  IF p_bytes IS NULL OR p_bytes <= 0 THEN
    RAISE EXCEPTION 'reserve_upload_bytes: bytes must be a positive count'
      USING ERRCODE = '22023';
  END IF;

  IF p_path IS NULL
     OR (storage.foldername(p_path))[1] IS DISTINCT FROM 'projects'
     OR char_length(p_path) > 1024 THEN
    RAISE EXCEPTION 'reserve_upload_bytes: not a project object path'
      USING ERRCODE = '22023';
  END IF;

  v_project := public.fn_try_uuid((storage.foldername(p_path))[2]);
  SELECT p.workspace_id INTO v_ws FROM public.projects p WHERE p.id = v_project;

  -- The caller must be a member of the workspace their claim names, and the
  -- project must be in it. Same shape as rabbit_files_insert (0042). 🚨 0047's
  -- RPC lesson: a NULL from a predicate DENIES in a policy and PASSES in an
  -- `IF NOT`, so every predicate here is COALESCEd to false.
  -- 0083: and the project must be one this caller can SEE — 0072's private-
  -- project arm, restated for definer bodies by passes_project_privacy
  -- (0082). Same message, same code: a private project's existence is not
  -- confirmed by the shape of the refusal.
  IF v_ws IS NULL
     OR v_ws IS DISTINCT FROM public.current_workspace_id()
     OR NOT COALESCE(public.has_active_membership(v_ws), false)
     OR NOT COALESCE(public.passes_project_privacy(v_project), false) THEN
    RAISE EXCEPTION 'reserve_upload_bytes: you cannot write to this project'
      USING ERRCODE = '42501';
  END IF;

  -- Money paths and the manifest are exempt from the quota (0055) UP TO
  -- rabbit_quota_exempt_max_bytes() (0078), so they are reservation-exempt on
  -- the same bound: nothing to weigh, nothing to write. Over the bound this
  -- falls through and is weighed like ordinary media. The object itself is
  -- still gated by rabbit_files_money_insert at commit either way.
  IF public.rabbit_quota_exempt_bytes(p_path, p_bytes) THEN
    RETURN NULL;
  END IF;

  IF NOT COALESCE(public.can_write_project(v_project), false) THEN
    RAISE EXCEPTION 'reserve_upload_bytes: you cannot write to this project'
      USING ERRCODE = '42501';
  END IF;

  -- Serialise reservations per workspace: two reserves racing through the
  -- check below would otherwise both pass, which is the hole one layer up.
  PERFORM pg_advisory_xact_lock(hashtext('upload_reservations:' || v_ws::text));

  SELECT COALESCE(pl.status, 'active'),
         COALESCE(pl.quota_bytes, public.storage_free_tier_bytes())
    INTO v_status, v_quota
    FROM public.workspace_storage_plans pl
   WHERE pl.workspace_id = v_ws;
  IF v_status IS NULL THEN
    v_status := 'active';
    v_quota  := public.storage_free_tier_bytes();
  END IF;

  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'Petal cloud storage for this company is suspended — contact Petal.'
      USING ERRCODE = 'PT402';
  END IF;

  -- THE ONE PREDICATE. The policy will re-evaluate exactly this at creation and
  -- at completion; a reservation that lapses cannot admit an over-quota object.
  IF NOT public.rabbit_petal_storage_ok(v_project, p_bytes, p_path) THEN
    v_used := public.workspace_petal_committed_bytes(v_ws)
            + public.workspace_upload_reserved_bytes(v_ws, p_path);
    v_leaf := regexp_replace(p_path, '^.*/', '');
    -- 🚨 NEVER TELL THEM TO DELETE FILES: a cloud delete is soft and the object
    -- holds quota for 30 days (uploadNotices.js says the same, for the same
    -- reason). Two facts, two sentences, as classifyUpload does.
    IF v_used >= v_quota THEN
      RAISE EXCEPTION 'This company has used all % of its Petal cloud storage (uploads in progress count). Contact Petal to raise the plan — deleting files does not free space straight away, because deleted files stay recoverable for 30 days.',
        pg_size_pretty(v_quota)
        USING ERRCODE = 'PT402';
    ELSE
      RAISE EXCEPTION 'Not enough Petal cloud storage for "%": it needs %, but only % of this company''s % is left once uploads already in progress are counted. Add a smaller file, or contact Petal to raise the plan — deleting files does not free space straight away, because deleted files stay recoverable for 30 days.',
        v_leaf, pg_size_pretty(p_bytes), pg_size_pretty(v_quota - v_used), pg_size_pretty(v_quota)
        USING ERRCODE = 'PT402';
    END IF;
  END IF;

  INSERT INTO public.upload_reservations
    (workspace_id, project_id, storage_path, bytes, created_by)
  VALUES
    (v_ws, v_project, p_path, p_bytes, v_uid)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.reserve_upload_bytes(TEXT, BIGINT) IS
  'Session C1 (0073) / Track C 2026-09-09 (0078) / merge review 2026-09-30 (0083): '
  'reserve quota for an upload before the bytes move. Quota-exempt paths return '
  'NULL and write no row — but only up to rabbit_quota_exempt_max_bytes(); over '
  'that bound a money path is weighed like ordinary media. The refusal happens '
  'at start rather than after the transfer ONLY for bodies over 50 MiB, which '
  'are the only ones that reach this function (RESUMABLE_THRESHOLD_BYTES, '
  'resumableUpload.js); between the bound and 50 MiB the refusal comes from '
  'petal_storage_quota_insert at commit. See 0078''s TRAP 1. Since 0083 the '
  'first refusal also carries the private-project arm of projects_select '
  '(0072) via passes_project_privacy (0082): a project the caller cannot see '
  'cannot be reserved against, exempt path or not.';


-- =============================================================================
-- 2. log_file_downloaded — the one refusal gains the arm
-- =============================================================================
--
-- 0074's body, reproduced, with ONE change: the OR chain that produces 0047's
-- single refusal also refuses when the file's project is not the caller's to
-- see. It sits after the live-project hop, which is where the read gate's
-- other three arms already are; same message, so existence still does not
-- leak. CREATE OR REPLACE keeps 0047's grants (authenticated) and its
-- comment, which is re-applied below with this arm named.

CREATE OR REPLACE FUNCTION public.log_file_downloaded(p_file_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_label TEXT;
  v_file  public.files;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'log_file_downloaded: not signed in';
  END IF;

  SELECT * INTO v_file FROM public.files WHERE id = p_file_id;

  -- One refusal for every shape — existence must not leak to a caller who
  -- cannot read the file (same reasoning as RLS returning empty, not error).
  IF v_file.id IS NULL
     OR v_file.workspace_id IS DISTINCT FROM public.current_workspace_id()
     OR NOT public.has_active_membership(v_file.workspace_id)
     OR NOT EXISTS (
          SELECT 1 FROM public.projects p
           WHERE p.id = v_file.project_id
             AND p.workspace_id = v_file.workspace_id
             AND p.deleted_at IS NULL)
     -- 0083: the fourth arm of projects_select (0072) — the project must be
     -- one this caller can SEE. files_select hops to projects and so carries
     -- it; this DEFINER body bypasses that hop and has to say it itself,
     -- through 0082's one definer-side restatement. COALESCEd for the same
     -- reason the money arm below is (it never returns NULL, but an `IF NOT`
     -- over a NULL fails OPEN, and the discipline is the body's).
     OR NOT COALESCE(public.passes_project_privacy(v_file.project_id), false)
     -- The 0038 money arm, replicated: files_select hides financial rows
     -- from non-money members, so this RPC must refuse them too — without
     -- it, a plain member gets an existence oracle for invoice ids, can
     -- mint invoice metadata (name, path, size) into file_events, and can
     -- forge an audit record of a read the storage policies would refuse.
     -- Found by the S33 adversarial review; can_access_project_money
     -- (0037) is SECURITY DEFINER with JWT-based internals, so it is safe
     -- to call from inside this DEFINER function.
     -- 🚨 The COALESCE is load-bearing (the 0042 lesson, inverted). For a
     -- claim-less non-manager the gate returns NULL, not false: both of
     -- its arms are `NULL = 'admin'` / `NULL = 'manager'`. In files_select
     -- that NULL fails CLOSED (a NULL policy expression denies the row);
     -- in this IF it fails OPEN — `true AND NOT NULL` is NULL, the OR
     -- chain goes NULL, and the refusal silently does not fire. MEASURED:
     -- probe 29 caught exactly this on the first rehearsal of the fix.
     OR (v_file.is_financial
         AND NOT COALESCE(public.can_access_project_money(v_file.project_id), false))
  THEN
    RAISE EXCEPTION 'log_file_downloaded: file not found or not readable';
  END IF;

  SELECT COALESCE(wm.display_name, wm.username) INTO v_label
    FROM public.workspace_members wm
   WHERE wm.workspace_id = v_file.workspace_id
     AND wm.user_id = v_actor;

  -- old_path carries the path that was read — the 'trashed'/'purged'
  -- convention ("the path at event time"); nothing arrived anywhere.
  INSERT INTO public.file_events
    (workspace_id, project_id, file_id, file_name, storage_provider,
     event, old_path, size_bytes, actor_user_id, actor_label, is_financial)
  VALUES
    (v_file.workspace_id, v_file.project_id, v_file.id, v_file.name,
     v_file.storage_provider::text, 'downloaded', v_file.storage_path,
     v_file.size_bytes, v_actor, v_label,
     -- Track C / 0074: a read of an invoice is invoice history. Without this
     -- the download event of an invoice would be the one row every project
     -- reader could still see.
     public.file_event_is_financial(v_file.is_financial, v_file.storage_path, NULL));

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.log_file_downloaded(UUID) IS
  'S33 (TPN-CONT-008/TPN-LOG-002, AS-2.9): appends a downloaded event to file_events for a file the caller can read (explicit workspace + membership + live-project + 0038 money-arm checks, and since 0083 the private-project arm of projects_select (0072) via passes_project_privacy (0082); DEFINER so the table stays append-only). Track C / 0074 flags the event is_financial. Called best-effort by supabaseAdapter.downloadFile; the Local Server twin logs bundle-side in the Express download route.';


-- =============================================================================
-- 3. files_insert / files_update — the WRITE policies hop to the parent
-- =============================================================================
--
-- 0038's two write policies, reproduced word for word, plus the hop
-- files_select (0038) already carries: `EXISTS (SELECT 1 FROM public.projects
-- p WHERE p.id = files.project_id)`. A POLICY runs as the caller, so the
-- subquery is evaluated under projects_select and carries all four of its
-- arms — workspace, live, membership and privacy — with no EXECUTE needed on
-- passes_project_privacy (0082 §3b's reasoning). The money arm stays where
-- 0038 put it, in USING and WITH CHECK both: suite 79 probes 24-25 pin it and
-- post-condition 6 below reads it back by name. files_select and files_delete
-- are untouched, so the table still has exactly its four policies (suite 79
-- probe 20).

DROP POLICY IF EXISTS files_insert ON public.files;
CREATE POLICY files_insert ON public.files
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND (NOT is_financial OR public.can_access_project_money(project_id))
    -- 0083: the parent must be one the caller can SELECT (projects_select's
    -- four arms, privacy included) — a leaked id is a name, not a write.
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = files.project_id)
  );

-- USING guards the OLD row, WITH CHECK the NEW one, and BOTH carry the
-- financial clause. That is what stops a team member clearing is_financial
-- on someone else's invoice and then reading it: the UPDATE cannot see the
-- row in the first place.
DROP POLICY IF EXISTS files_update ON public.files;
CREATE POLICY files_update ON public.files
  FOR UPDATE
  USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND (NOT is_financial OR public.can_access_project_money(project_id))
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.can_write_project(project_id)
    AND (NOT is_financial OR public.can_access_project_money(project_id))
    -- 0083: gate the NEW row's parent too. A filtered UPDATE already meets
    -- files_select's hop on its new row (Postgres applies the SELECT policies
    -- as WITH CHECK whenever SELECT is required); this is the only gate for
    -- an UPDATE that reads no column, and defence in depth for the rest
    -- (0013's own reasoning for assets_update's WITH CHECK; suite 83 probe
    -- 20 is the failing control, probe 18 the filtered move).
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = files.project_id)
  );


-- =============================================================================
-- 4. passes_project_privacy — its comment names its callers, now four
-- =============================================================================
--
-- The body is 0082's and is NOT redefined here (post-condition 2 asserts it
-- is still there, still SECURITY DEFINER and still closed to clients). Only
-- the roll-call in its comment changes, so the next reader of \df+ sees every
-- gate that depends on it.

COMMENT ON FUNCTION public.passes_project_privacy(UUID) IS
  '0082: the privacy arm of projects_select (0072) — the project is not private, or the caller created it, or the caller is a workspace admin — restated for SECURITY DEFINER bodies, which bypass RLS and cannot delegate to the policy (a SECURITY INVOKER helper called from a definer body runs as the owner). Callers: milestones_trash_index, fn_trash_authz (0082); reserve_upload_bytes, log_file_downloaded (0083). Keep it word-for-word with the policy; suites 82 and 83 and both migrations'' post-conditions pin it. No client role executes it.';


-- =============================================================================
-- 5. POST-CONDITIONS — assert, do not assume (comments stripped first)
-- =============================================================================

DO $$
DECLARE
  t       TEXT;
  v_body  TEXT;
  v_hits  INT;
  v_qual  TEXT;
  v_conf  TEXT[];
BEGIN
  -- 1. The policy this restates still carries its arm — the premise of the
  --    whole file. If 0072 were rolled back, this migration would be pinning
  --    a predicate the policy no longer has.
  SELECT qual INTO v_qual FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'projects_select';
  IF v_qual IS NULL OR position('is_private' IN v_qual) = 0 THEN
    RAISE EXCEPTION '0083 post-condition 1 failed: projects_select does not read is_private — 0072 is not in place';
  END IF;

  -- 2. The helper this file calls is 0082's, unchanged: present, SECURITY
  --    DEFINER, all three arms, and closed to every client role.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'passes_project_privacy' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION '0083 post-condition 2 failed: passes_project_privacy (0082) is missing or no longer SECURITY DEFINER';
  END IF;
  v_body := pg_get_functiondef('public.passes_project_privacy(uuid)'::regprocedure);
  v_body := regexp_replace(v_body, '/\*.*?\*/', '', 'gs');
  v_body := regexp_replace(v_body, '--[^' || chr(10) || ']*', '', 'g');
  IF v_body NOT LIKE '%NOT p.is_private%'
     OR v_body NOT LIKE '%p.created_by = auth.uid()%'
     OR v_body NOT LIKE '%public.current_app_role() = ''admin''%' THEN
    RAISE EXCEPTION '0083 post-condition 2 failed: passes_project_privacy does not restate all three arms of projects_select';
  END IF;
  IF has_function_privilege('anon', 'public.passes_project_privacy(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.passes_project_privacy(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0083 post-condition 2 failed: a client role holds EXECUTE on passes_project_privacy';
  END IF;

  -- 3. Each of the two bodies calls the helper — exactly once, so a second
  --    mention cannot be a commented-out or shadowed copy — with comments
  --    stripped first (0077 §3c: a `-- passes_project_privacy` line satisfied
  --    a presence check in R1 of that file with the arm deleted). Both are
  --    still SECURITY DEFINER with search_path pinned to public (0078's 9c/9d,
  --    for both: a dropped search_path is the classic definer hijack).
  FOREACH t IN ARRAY ARRAY['public.reserve_upload_bytes(text, bigint)',
                           'public.log_file_downloaded(uuid)']
  LOOP
    v_body := pg_get_functiondef(t::regprocedure);
    v_body := regexp_replace(v_body, '/\*.*?\*/', '', 'gs');
    v_body := regexp_replace(v_body, '--[^' || chr(10) || ']*', '', 'g');
    v_hits := (length(v_body) - length(replace(v_body, 'passes_project_privacy(', '')))
              / length('passes_project_privacy(');
    IF v_hits <> 1 THEN
      RAISE EXCEPTION '0083 post-condition 3 failed: % names passes_project_privacy % times in its comment-stripped body (expected 1)', t, v_hits;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = t::regprocedure AND prosecdef) THEN
      RAISE EXCEPTION '0083 post-condition 3 failed: % is no longer SECURITY DEFINER', t;
    END IF;
    SELECT proconfig INTO v_conf FROM pg_proc WHERE oid = t::regprocedure;
    IF v_conf IS NULL OR NOT (v_conf @> ARRAY['search_path=public']) THEN
      RAISE EXCEPTION '0083 post-condition 3 failed: % lost its pinned search_path; proconfig is %', t, v_conf;
    END IF;
  END LOOP;

  -- 4. reserve_upload_bytes lost nothing it had (the 0059 lesson; 0078's
  --    9a/9b/9e replayed here because this file retypes the body they pin,
  --    and they would otherwise be true only of the file that was written).
  v_body := regexp_replace(regexp_replace(
              pg_get_functiondef('public.reserve_upload_bytes(text, bigint)'::regprocedure),
              '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g');
  IF strpos(v_body, '42501') = 0 OR strpos(v_body, '22023') = 0 OR strpos(v_body, 'PT402') = 0 THEN
    RAISE EXCEPTION '0083 post-condition 4 failed: reserve_upload_bytes no longer raises all three of 42501 / 22023 / PT402';
  END IF;
  IF strpos(v_body, 'public.rabbit_quota_exempt_bytes(p_path, p_bytes)') = 0 THEN
    RAISE EXCEPTION '0083 post-condition 4 failed: reserve_upload_bytes lost 0078''s bounded exemption';
  END IF;
  IF strpos(v_body, 'rabbit_quota_exempt_path(p_path)') > 0 THEN
    RAISE EXCEPTION '0083 post-condition 4 failed: reserve_upload_bytes carries the UNBOUNDED early return again';
  END IF;
  IF v_body NOT LIKE '%public.can_write_project(v_project)%'
     OR v_body NOT LIKE '%public.has_active_membership(v_ws)%'
     OR v_body NOT LIKE '%public.current_workspace_id()%' THEN
    RAISE EXCEPTION '0083 post-condition 4 failed: reserve_upload_bytes lost its write, membership or workspace gate';
  END IF;
  IF v_body NOT LIKE '%pg_advisory_xact_lock(%'
     OR v_body NOT LIKE '%public.rabbit_petal_storage_ok(v_project, p_bytes, p_path)%'
     OR v_body NOT LIKE '%INSERT INTO public.upload_reservations%'
     OR v_body NOT LIKE '%uploads in progress count%' THEN
    RAISE EXCEPTION '0083 post-condition 4 failed: reserve_upload_bytes lost its lock, its quota predicate, its row or its refusal sentence';
  END IF;

  -- 5. log_file_downloaded lost nothing it had: 0074's is_financial flag (its
  --    post-condition 5), the 0038 money arm WITH its load-bearing COALESCE,
  --    0047's three original arms and its one refusal.
  v_body := regexp_replace(regexp_replace(
              pg_get_functiondef('public.log_file_downloaded(uuid)'::regprocedure),
              '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g');
  IF v_body NOT LIKE '%file_event_is_financial(%' THEN
    RAISE EXCEPTION '0083 post-condition 5 failed: log_file_downloaded no longer sets is_financial (0074)';
  END IF;
  IF v_body NOT LIKE '%NOT COALESCE(public.can_access_project_money(v_file.project_id), false)%' THEN
    RAISE EXCEPTION '0083 post-condition 5 failed: log_file_downloaded lost the 0038 money arm or its COALESCE';
  END IF;
  IF v_body NOT LIKE '%public.has_active_membership(v_file.workspace_id)%'
     OR v_body NOT LIKE '%public.current_workspace_id()%'
     OR v_body NOT LIKE '%p.deleted_at IS NULL%' THEN
    RAISE EXCEPTION '0083 post-condition 5 failed: log_file_downloaded lost its membership, workspace or live-project arm';
  END IF;
  IF v_body NOT LIKE '%file not found or not readable%'
     OR v_body NOT LIKE '%''downloaded''%' THEN
    RAISE EXCEPTION '0083 post-condition 5 failed: log_file_downloaded lost its refusal or its event name';
  END IF;

  -- 6. The two write policies carry the parent hop in their WITH CHECK, and
  --    neither lost a gate while it was retyped: workspace, write gate and the
  --    money arm in both WITH CHECKs; membership in files_insert; all four of
  --    0038's gates in files_update's USING. pg_policies deparses the
  --    expressions, so the checks are by name. And `files` still has exactly
  --    its four policies (suite 79 probe 20's pin).
  FOREACH t IN ARRAY ARRAY['files_insert', 'files_update']
  LOOP
    SELECT with_check INTO v_qual FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'files' AND policyname = t;
    IF v_qual IS NULL
       OR position('projects' IN v_qual) = 0
       OR position('can_write_project' IN v_qual) = 0
       OR position('current_workspace_id' IN v_qual) = 0
       OR position('can_access_project_money' IN v_qual) = 0 THEN
      RAISE EXCEPTION '0083 post-condition 6 failed: %''s WITH CHECK does not hop to projects, or lost its workspace, write or money gate', t;
    END IF;
  END LOOP;
  SELECT with_check INTO v_qual FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_insert';
  IF position('has_active_membership' IN v_qual) = 0 THEN
    RAISE EXCEPTION '0083 post-condition 6 failed: files_insert lost its membership gate';
  END IF;
  SELECT qual INTO v_qual FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_update';
  IF v_qual IS NULL
     OR position('can_write_project' IN v_qual) = 0
     OR position('has_active_membership' IN v_qual) = 0
     OR position('current_workspace_id' IN v_qual) = 0
     OR position('can_access_project_money' IN v_qual) = 0 THEN
    RAISE EXCEPTION '0083 post-condition 6 failed: files_update''s USING lost one of 0038''s four gates';
  END IF;
  IF (SELECT array_agg(policyname::TEXT ORDER BY policyname) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'files')
     IS DISTINCT FROM ARRAY['files_delete','files_insert','files_select','files_update']::TEXT[] THEN
    RAISE EXCEPTION '0083 post-condition 6 failed: public.files no longer has exactly its four policies';
  END IF;

  -- 7. Privileges as before: the client calls both RPCs over PostgREST, so
  --    authenticated keeps EXECUTE on each; anon holds neither.
  IF NOT has_function_privilege('authenticated', 'public.reserve_upload_bytes(text, bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.log_file_downloaded(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0083 post-condition 7 failed: authenticated lost EXECUTE on reserve_upload_bytes or log_file_downloaded';
  END IF;
  IF has_function_privilege('anon', 'public.reserve_upload_bytes(text, bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.log_file_downloaded(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0083 post-condition 7 failed: anon can execute reserve_upload_bytes or log_file_downloaded';
  END IF;

  RAISE NOTICE '0083: private-project arm on reserve_upload_bytes and log_file_downloaded (passes_project_privacy, once each); parent hop on files_insert / files_update WITH CHECK; files still has its four policies';
END $$;
