-- =============================================================================
-- 0121_moth_repairs.sql — M.O.T.H. Session 1 (MO1), what the whole-session review found.
-- (docs/design/MOTH_DESIGN.md section 0, integration answers 2 and 3; the note after §1.10.)
-- 0120 is the number the S3 change holds, and it waits for the new storage-presign. This file does not
-- depend on it, or it on this.
--
-- HER TWO ANSWERS, NEVER BUILT UNTIL NOW
-- --------------------------------------
--   §1 to §3  "Yes, once they've left": an admin may move a former member's personal files into a
--             project, only after that person is no longer an active member, through the same checked
--             move, recorded in the admin activity list. Money and Legal stay where they are, and Moth's
--             own reads still show no admin anyone else's space. A file in that person's folder on the
--             office server is not moved: only its owner's token opens that folder (networkShareOps.cjs).
--   §4        "Full or nearly full": members see only that. The figures are an admin's to read.
--
-- WHAT COULD NOT BE REPAIRED FROM THE CLIENT
-- ------------------------------------------
--   §5  network_share_pending_mine: one refused project holds back that project only.
--       network_share_settle and network_share_stale_moves: an admin may call off what a person who
--       has left began in their own space, and only say it did not happen. An adopt's old picture is
--       queued once it can no longer come back.
--       purge_soft_deleted: an operation left past the retention no longer holds a row or a project in
--       the bin for ever.
--   §6  moth_project_files says a file was not found on the server at the last check.
--   §7  network_share_locator_ok refuses a device name. network_share_catalogue_apply no longer calls the
--       rows under a folder that has turned all-numbered missing, and does not add back a file a move has
--       just taken from a path. network_share_pending_mine says a file's size and an operation's age.
--
-- No table changes. Every statement replaces a function, but for one policy on workspace_storage_plans, a
-- small table read by definers. Suite 122_moth_repairs.sql.
-- =============================================================================

SET LOCAL lock_timeout = '15s';

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
DECLARE
  v_md5 TEXT;
  v_fn  RECORD;
BEGIN
  IF to_regprocedure('public.moth_history_read(uuid,timestamp with time zone,uuid,integer)') IS NULL THEN
    RAISE EXCEPTION '0121 refused: 0119 must be applied first';
  END IF;
  IF to_regnamespace('rabbit_private') IS NULL OR to_regprocedure('rabbit_private.files_body_retire(uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION '0121 refused: 0114''s private helpers are missing';
  END IF;
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0121 refused: % does not bypass row security', current_user;
  END IF;
  -- The bodies this restates, or this file's own on a second run.
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public._moth_target_eligible(text,uuid,boolean)', '06ce9d801842872e467b9dcc119cb063', 'f879ef0b2c71a21731ca355fe1a022c2'),
      ('public.moth_can_write_target(text,uuid)', 'c629ec6cafb9487b4af470ec0091900a', 'f48c7ad84e94772bfb7bddd0a974cfdc'),
      ('public.moth_project_files(uuid,uuid,integer)', '3a473342a8a071d12a04c5190191fd8a', '0a8eaecced067d9eea6d116aba495fb4'),
      ('public.reserve_upload_bytes(text,bigint)', '87b382a7fbd48eb15f3738328d88a8e6', 'cbd585a061cf9a4c93d5a7cacea25500'),
      ('public.network_share_pending_mine()', '904d7ca754ffaeee3ea3de7b567574de', '5f22500ca9211c196313d54d603564c8'),
      ('public.network_share_settle(uuid[],text,jsonb)', '3a4e5d614de881b5c80662304603bf05', 'a82cd773542ac0d92d88a01ad558aded'),
      ('public.network_share_stale_moves()', '857e424840d5ea966ea042454c2208ff', '2eccf1aac110922f0d1a8d348d4f97a9'),
      ('public.purge_soft_deleted(interval)', '65f3322262d48afa923ccd5f40c69a4c', '4f659fad4e1fd978f0cd220c6a628eb4'),
      ('public.network_share_locator_ok(text)', 'f210a014f699421a9361ace3fa63958d', '19c62fa6840888629a68b14e46463a37'),
      ('public.network_share_catalogue_apply(uuid,text,text,jsonb,jsonb,boolean,text,boolean)', '6c5bc7b6874e0e7348b2b3fcfbc5389f', '9ee5d8f7dcca2f567c553a56babc9deb')
    ) AS t(sig, was, now_is)
  LOOP
    SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = v_fn.sig::regprocedure;
    IF v_md5 IS DISTINCT FROM v_fn.was AND v_md5 IS DISTINCT FROM v_fn.now_is THEN
      RAISE EXCEPTION '0121 refused: % is not the body this file was built on (md5 %)', v_fn.sig, v_md5;
    END IF;
  END LOOP;
END $$;

-- §1 Who has left ---------------------------------------------------------------
-- The caller is an admin of this company, and the space's owner is someone else who is not an active
-- member of it. Asked of the person each time, never of a value the client could have sent.
CREATE OR REPLACE FUNCTION rabbit_private.personal_space_of_a_leaver(p_project uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_ws    uuid := public.current_workspace_id();
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT COALESCE(public.has_active_membership(v_ws), false)
     OR public.current_app_role() IS DISTINCT FROM 'admin' THEN
    RETURN false;
  END IF;
  SELECT p.personal_owner_id INTO v_owner
    FROM public.projects p
   WHERE p.id = p_project AND p.workspace_id = v_ws AND p.deleted_at IS NULL;
  IF v_owner IS NULL OR v_owner = auth.uid() THEN
    RETURN false;
  END IF;
  RETURN NOT EXISTS (SELECT 1 FROM public.workspace_members wm
                      WHERE wm.workspace_id = v_ws AND wm.user_id = v_owner AND wm.is_active);
END;
$$;
REVOKE ALL ON FUNCTION rabbit_private.personal_space_of_a_leaver(uuid) FROM PUBLIC, anon, authenticated;

-- §2 The two gates a move asks ----------------------------------------------------
CREATE OR REPLACE FUNCTION public._moth_target_eligible(p_kind text, p_id uuid, p_allow_trashed boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws       UUID := public.current_workspace_id();
  v_project  UUID;
  v_deleted  TIMESTAMPTZ;
  v_flag     BOOLEAN;
  v_path     TEXT;
  v_tags     TEXT[];
  v_folder   UUID;
BEGIN
  IF p_id IS NULL OR auth.uid() IS NULL OR v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RETURN false;
  END IF;

  IF p_kind = 'project' THEN
    v_project := p_id;
  ELSIF p_kind = 'folder' THEN
    SELECT fo.project_id INTO v_project
      FROM public.folders fo
     WHERE fo.id = p_id AND fo.workspace_id = v_ws;
    IF v_project IS NULL OR public.moth_folder_chain_locked(v_ws, p_id) THEN
      RETURN false;
    END IF;
  ELSIF p_kind = 'file' THEN
    SELECT f.project_id, f.deleted_at, f.is_financial, f.storage_path, f.tags, f.folder_id
      INTO v_project, v_deleted, v_flag, v_path, v_tags, v_folder
      FROM public.files f
     WHERE f.id = p_id AND f.workspace_id = v_ws;
    IF v_project IS NULL
       OR (v_deleted IS NOT NULL AND NOT COALESCE(p_allow_trashed, false))
       OR public.moth_file_row_locked(v_ws, v_project, p_id, v_flag, v_path, v_tags, v_folder) THEN
      RETURN false;
    END IF;
  ELSE
    RETURN false;
  END IF;

  -- The personal arm has no admin leg: this is what keeps a personal space out
  -- of every Moth surface for an admin, who reaches it from Files only.
  RETURN EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.id = v_project
       AND p.workspace_id = v_ws
       AND p.deleted_at IS NULL
       AND public.passes_project_privacy(p.id)
       AND (p.personal_owner_id IS NULL OR p.personal_owner_id = auth.uid()
            -- 0121: her answer. Only inside moth_move_leaver_files, which sets this, and asked of the
            -- person again: no admin reaches a space through Moth's reads.
            OR (COALESCE(current_setting('wilson.moth_leaver_move', true), '') = 'on'
                AND rabbit_private.personal_space_of_a_leaver(p.id)))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.moth_can_write_target(p_kind text, p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project UUID;
BEGIN
  IF NOT public._moth_target_eligible(p_kind, p_id, false) THEN
    RETURN false;
  END IF;
  v_project := CASE p_kind
    WHEN 'project' THEN p_id
    WHEN 'folder'  THEN (SELECT fo.project_id FROM public.folders fo WHERE fo.id = p_id)
    WHEN 'file'    THEN (SELECT f.project_id FROM public.files f WHERE f.id = p_id)
  END;
  RETURN COALESCE(public.can_write_project(v_project), false)
      OR (COALESCE(current_setting('wilson.moth_leaver_move', true), '') = 'on'
          AND rabbit_private.personal_space_of_a_leaver(v_project));
END;
$$;

-- §3 Moving a former member's files -------------------------------------------------
-- What may move: what an admin could read in Files, less money and Legal, and less what could never go: a body
-- on that person's computer or in their office-server folder, in a company's own bucket, a version of an asset, or
-- a file read into its project. One of those would sink a whole batch, unnamed. An owner still active, or anyone
-- but an admin, gets nothing, which is also how the page knows to offer nothing. The gate runs after the sort and
-- only as far as the limit (0111's fence): it costs a folder walk per row.
CREATE OR REPLACE FUNCTION public.moth_leaver_files(p_project uuid)
RETURNS TABLE (
  id uuid, name text, mime_type text, size_bytes bigint, storage_provider text,
  storage_path text, thumbnail_url text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
#variable_conflict use_column
DECLARE
  v_ws uuid := public.current_workspace_id();
BEGIN
  IF NOT rabbit_private.personal_space_of_a_leaver(p_project) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT f.id, f.name, f.mime_type, f.size_bytes, f.storage_provider::text, f.storage_path, f.thumbnail_url
      FROM (SELECT x.*
              FROM public.files x
             WHERE x.project_id = p_project
               AND x.workspace_id = v_ws
               AND x.deleted_at IS NULL
               AND x.storage_provider::text = 'supabase'
               AND NOT EXISTS (SELECT 1 FROM public.asset_versions av WHERE av.file_id = x.id)
               AND NOT EXISTS (SELECT 1 FROM public.ingestion_chunks c WHERE c.file_id = x.id)
             ORDER BY x.name, x.id
            OFFSET 0) f
     WHERE NOT public.moth_file_row_locked(v_ws, f.project_id, f.id, f.is_financial, f.storage_path, f.tags, f.folder_id)
     LIMIT 500;
END;
$$;
REVOKE ALL ON FUNCTION public.moth_leaver_files(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moth_leaver_files(uuid) TO authenticated;

-- The same checked move, with the one question it asks of the source answered by §1. Every file is in
-- such a space or the whole call reads as not there. A plan writes nothing and records nothing.
CREATE OR REPLACE FUNCTION public.moth_move_leaver_files(
  p_file_ids uuid[],
  p_dest_project uuid,
  p_dest_folder uuid DEFAULT NULL,
  p_plan_only boolean DEFAULT false,
  p_bodies jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_ws    uuid := public.current_workspace_id();
  v_ids   uuid[] := ARRAY(SELECT DISTINCT x FROM unnest(p_file_ids) x WHERE x IS NOT NULL ORDER BY 1);
  v_space uuid;
  v_out   jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT COALESCE(public.has_active_membership(v_ws), false) THEN
    RAISE EXCEPTION 'moth_move:not_a_workspace_member' USING ERRCODE = 'P0001';
  END IF;
  IF cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'moth_move:empty' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.files f WHERE f.id = ANY (v_ids) AND f.workspace_id = v_ws) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'moth_move:not_found' USING ERRCODE = 'P0001';
  END IF;
  FOR v_space IN SELECT DISTINCT f.project_id FROM public.files f WHERE f.id = ANY (v_ids) LOOP
    IF NOT rabbit_private.personal_space_of_a_leaver(v_space) THEN
      RAISE EXCEPTION 'moth_move:not_found' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- That person's folder on the office server opens to their own token only.
  IF EXISTS (SELECT 1 FROM public.files f WHERE f.id = ANY (v_ids) AND f.storage_provider::text = 'network_share') THEN
    RAISE EXCEPTION 'moth_move:in_their_server_folder' USING ERRCODE = 'P0001';
  END IF;
  -- Nor a body on that person's computer. On an office-server company the plan would adopt it with nothing to
  -- copy, and the row would name a file that never arrives.
  IF EXISTS (SELECT 1 FROM public.files f WHERE f.id = ANY (v_ids) AND f.storage_provider::text = 'local_server') THEN
    RAISE EXCEPTION 'moth_move:on_their_computer' USING ERRCODE = 'P0001';
  END IF;
  -- Into a project, as her answer says, and no other person's space, or the admin's own.
  IF EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_dest_project AND p.personal_owner_id IS NOT NULL) THEN
    RAISE EXCEPTION 'moth_move:not_allowed_destination' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('wilson.moth_leaver_move', 'on', true);
  v_out := public.moth_move_items(v_ids, p_dest_project, p_dest_folder, p_plan_only, p_bodies);
  PERFORM set_config('wilson.moth_leaver_move', '', true);

  -- Ids only (TPN): who moved what out of whose space is the record, never its contents. How many, under the
  -- move's id: file_moves holds which, and 0021's CHECK stops a context at 8,000 characters, about 195 ids.
  IF NOT COALESCE(p_plan_only, false) THEN
    INSERT INTO public.app_events (workspace_id, actor_user_id, event_type, code, severity, message, context)
    SELECT v_ws, auth.uid(), 'admin', 'WIL-4115', 'info',
           'An admin moved a former member''s personal files into a project',
           jsonb_build_object('project_id', s.project_id, 'owner_user_id', p.personal_owner_id,
                              'dest_project_id', p_dest_project, 'move_id', v_out ->> 'move_id', 'file_count', s.n)
      FROM (SELECT (e ->> 'from_project')::uuid AS project_id, count(*) AS n
              FROM public.file_moves m, jsonb_array_elements(m.items) e
             WHERE m.id = (v_out ->> 'move_id')::uuid
             GROUP BY 1) s
      JOIN public.projects p ON p.id = s.project_id;
  END IF;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.moth_move_leaver_files(uuid[], uuid, uuid, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moth_move_leaver_files(uuid[], uuid, uuid, boolean, jsonb) TO authenticated;

-- §4 The storage notice -----------------------------------------------------------
-- A new column, so the function is dropped and made again: a build reading it by name is unaffected.
-- Only an admin reads the figures. Nearly full is nine parts in ten. OFFSET 0 so the meter runs once: without it the
-- planner would put its call at each mention of the figure, about 3 s each at a large bucket, against an 8 s limit.
DROP FUNCTION IF EXISTS public.workspace_storage_usage();
CREATE FUNCTION public.workspace_storage_usage()
RETURNS TABLE (
  used_bytes  BIGINT,
  quota_bytes BIGINT,
  status      TEXT,
  has_plan    BOOLEAN,
  fullness    TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN public.current_app_role() = 'admin' THEN u.used END,
         CASE WHEN public.current_app_role() = 'admin' THEN u.quota END,
         u.status,
         u.has_plan,
         CASE WHEN u.used >= u.quota THEN 'full'
              WHEN u.used >= u.quota * 0.9 THEN 'nearly_full'
              ELSE 'ok' END
    FROM (SELECT public.workspace_petal_bytes(w.id) AS used,
                 COALESCE(pl.quota_bytes, public.storage_free_tier_bytes()) AS quota,
                 COALESCE(pl.status, 'active') AS status,
                 (pl.workspace_id IS NOT NULL) AS has_plan
            FROM public.workspaces w
            LEFT JOIN public.workspace_storage_plans pl ON pl.workspace_id = w.id
           WHERE w.id = public.current_workspace_id()
             AND public.has_active_membership(w.id)
          OFFSET 0) u;
$$;
REVOKE ALL ON FUNCTION public.workspace_storage_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_storage_usage() TO authenticated, service_role;

-- A member told only full or nearly full could otherwise read the plan's size off the table itself, and have
-- a bound on the figures. The app reads it through the function above, and definers are not asked this policy.
DROP POLICY IF EXISTS workspace_storage_plans_select ON public.workspace_storage_plans;
CREATE POLICY workspace_storage_plans_select ON public.workspace_storage_plans
  FOR SELECT
  USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.current_app_role() = 'admin'
  );

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
  -- 0088 (review round 1, S1-SEC-02): and a key under a LOCKED folder
  -- (INVOICES / FINANCE / LEGAL, rabbit_money_key) needs the money gate —
  -- here, in the first refusal, before the exemption, so the answer is the
  -- same whether or not the key exists. 0092: a LEGAL key (rabbit_legal_key)
  -- is admitted by the Legal gate instead; a money key that is not Legal
  -- still needs the money gate alone.
  IF v_ws IS NULL
     OR v_ws IS DISTINCT FROM public.current_workspace_id()
     OR NOT COALESCE(public.has_active_membership(v_ws), false)
     OR NOT COALESCE(public.passes_project_privacy(v_project), false)
     OR (public.rabbit_money_key(p_path)
         AND NOT (COALESCE(public.rabbit_legal_key(p_path), false)
                  AND COALESCE(public.can_access_project_legal(v_project), false))
         AND NOT COALESCE(public.can_access_project_money(v_project), false)) THEN
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
    -- 0121: her answer, full or nearly full and no amounts for anyone but an admin: the total now holds
    -- people's personal files. The numbers are an admin's to read.
    IF public.current_app_role() IS DISTINCT FROM 'admin' THEN
      IF v_used >= v_quota THEN
        RAISE EXCEPTION 'This company''s Petal cloud storage is full (uploads in progress count). Contact an admin to raise the plan — deleting files does not free space straight away, because deleted files stay recoverable for 30 days.'
          USING ERRCODE = 'PT402';
      END IF;
      RAISE EXCEPTION 'There is not enough Petal cloud storage left for "%". Add a smaller file, or contact an admin to raise the plan — deleting files does not free space straight away, because deleted files stay recoverable for 30 days.',
        v_leaf
        USING ERRCODE = 'PT402';
    END IF;
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

-- §5 What is left unfinished -------------------------------------------------------
-- Whoever could check this folder, or an admin once its owner has left. Only ever for saying a thing
-- did not happen: only its own computer can say it did.
CREATE OR REPLACE FUNCTION public._network_share_may_call_off(p_project uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  RETURN COALESCE(public._network_share_may_check(p_project), false)
      OR COALESCE(rabbit_private.personal_space_of_a_leaver(p_project), false);
END;
$$;
REVOKE ALL ON FUNCTION public._network_share_may_call_off(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.network_share_pending_mine()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_out     jsonb;
  v_ws      uuid := public.current_workspace_id();
  v_project uuid;
  v_folder  text;
  v_refused uuid[] := '{}';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'network_share: not allowed' USING ERRCODE = '42501';
  END IF;
  -- A desktop recovering from a crash renames what this returns, so it asks what the call that
  -- journalled it asked: the server may have changed since, or the folder stopped being its own.
  FOR v_project IN
    SELECT DISTINCT f.project_id
      FROM public.network_share_ops o
      JOIN public.files f ON f.id = o.file_id
     WHERE o.created_by = auth.uid()
       AND o.state = 'pending'
       AND o.workspace_id = v_ws
       AND public._network_share_may_write(f.project_id)
  LOOP
    -- 0121: one project refused holds back that project's only. The rest still have files to finish.
    BEGIN
      IF public._network_share_drive(v_ws) IS NULL THEN
        RAISE EXCEPTION 'network_share: drive_changed';
      END IF;
      v_folder := public.network_share_space_folder(v_project);
      IF v_folder IS NULL THEN
        RAISE EXCEPTION 'network_share: no_folder';
      END IF;
      PERFORM public._network_share_assert_folder(v_ws, v_project, v_folder);
    EXCEPTION WHEN raise_exception THEN
      v_refused := v_refused || v_project;
    END;
  END LOOP;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('op_id', x.id, 'op', x.op, 'from', x.from_locator, 'to', x.to_locator, 'size', x.size_bytes, 'created_at', x.created_at)), '[]'::jsonb)
    INTO v_out
    FROM (SELECT o.id, o.op, o.from_locator, o.to_locator, f.size_bytes, o.created_at
            FROM public.network_share_ops o
            JOIN public.files f ON f.id = o.file_id
           WHERE o.created_by = auth.uid()
             AND o.state = 'pending'
             AND o.workspace_id = public.current_workspace_id()
             AND public._network_share_may_write(f.project_id)
             AND NOT f.project_id = ANY (v_refused)
           ORDER BY o.created_at, o.id
           LIMIT 500) x;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.network_share_settle(
  p_op_ids  uuid[],
  p_outcome text,
  p_facts   jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_ws    uuid := public.current_workspace_id();
  v_ids   uuid[] := ARRAY(SELECT DISTINCT x FROM unnest(p_op_ids) x WHERE x IS NOT NULL ORDER BY 1);
  r       record;
  v_lf    text;
  v_fact  jsonb;
  v_m     timestamptz;
  v_n     integer := 0;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('done', 'not_moved') OR cardinality(v_ids) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'network_share: bad_request';
  END IF;

  -- Who, before any lock. One sentence for all of it, and an operation already settled reads the
  -- same as one that was never there.
  FOR r IN SELECT o.id, o.created_by, o.created_at, o.op, o.project_id, o.dest_project_id, o.from_locator, o.to_locator, f.project_id AS file_project
             FROM public.network_share_ops o
             JOIN public.files f ON f.id = o.file_id
            WHERE o.id = ANY (v_ids) AND o.workspace_id = v_ws AND o.state = 'pending' LOOP
    v_n := v_n + 1;
    IF r.created_by = v_uid AND public._network_share_may_write(r.file_project) THEN
      CONTINUE;
    END IF;
    -- 0118: a move between projects nobody settled, after the same 24 hours. Whoever could check both
    -- folders may say it did not happen, and only that: only its own computer can say it did. It
    -- needs a person, because the journal row of the way back names who.
    IF p_outcome = 'not_moved'
       AND r.op IN ('move', 'adopt')
       AND r.dest_project_id IS NOT NULL
       AND r.project_id IS DISTINCT FROM r.dest_project_id
       AND r.created_at < now() - interval '24 hours'
       AND public._network_share_may_call_off(r.project_id)
       AND public._network_share_may_call_off(r.dest_project_id) THEN
      CONTINUE;
    END IF;
    v_lf := lower(public.network_share_space_folder(r.file_project));
    IF NOT (r.created_at < now() - interval '24 hours'
            AND r.from_locator IS NOT NULL
            AND COALESCE(starts_with(lower(r.from_locator), v_lf || '/'), false)
            AND COALESCE(starts_with(lower(r.to_locator), v_lf || '/'), false)
            AND (public._network_share_may_check(r.file_project)
                 OR (p_outcome = 'not_moved' AND rabbit_private.personal_space_of_a_leaver(r.file_project)))) THEN
      RAISE EXCEPTION 'network_share: not allowed' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  IF v_n <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'network_share: not allowed' USING ERRCODE = '42501';
  END IF;

  -- 0118: a way back reaches both ends of a move, so both locks come now, in order, with no row
  -- held. Taken one project at a time they could cross a walk's, which locks the other way.
  PERFORM public._network_share_lock_projects(ARRAY(
    SELECT x FROM public.network_share_ops o JOIN public.files f ON f.id = o.file_id,
           LATERAL unnest(ARRAY[f.project_id, o.project_id, o.dest_project_id]) x
     WHERE o.id = ANY (v_ids)));

  FOR r IN SELECT o.* FROM public.network_share_ops o WHERE o.id = ANY (v_ids) ORDER BY o.id FOR UPDATE LOOP
    IF r.state <> 'pending' THEN
      RAISE EXCEPTION 'network_share: not allowed' USING ERRCODE = '42501';
    END IF;

    IF p_outcome = 'done' THEN
      IF r.op = 'restore' THEN
        PERFORM set_config('wilson.network_share_writer', 'op:' || r.file_id::text, true);
        UPDATE public.files SET share_bin_path = NULL WHERE id = r.file_id;
      ELSIF r.op = 'adopt' THEN
        -- The desktop has verified its copy. What it read off the server goes on the row.
        v_fact := p_facts -> r.id::text;
        -- The size must be good. A time this cannot store (a file dated before 1980, a server's
        -- clock ahead) leaves the row's own: the copy is verified, and refusing would strand it.
        v_m := public._network_share_mtime(v_fact ->> 'm');
        IF COALESCE(v_fact ->> 's', '') !~ '^[0-9]{1,15}$' THEN
          RAISE EXCEPTION 'network_share: bad_facts';
        END IF;
        PERFORM set_config('wilson.network_share_writer', 'op:' || r.file_id::text, true);
        UPDATE public.files
           SET size_bytes = (v_fact ->> 's')::bigint, source_modified_at = COALESCE(v_m, source_modified_at)
         WHERE id = r.file_id;
        -- 0121: the row stopped naming its picture at the commit, and only now can it not come back.
        -- Unclaimed, the policies fall back to the key's own project, so it goes.
        IF btrim(COALESCE(r.origin ->> 'from_thumb', '')) <> '' THEN
          PERFORM rabbit_private.files_body_retire(r.file_id, jsonb_build_array(jsonb_build_object(
            'bucket', 'rabbit-thumbnails', 'path', r.origin ->> 'from_thumb', 'provider', 'supabase', 'kind', 'thumbnail')));
        END IF;
      END IF;
      UPDATE public.network_share_ops SET state = 'done', settled_at = clock_timestamp() WHERE id = r.id;

    ELSE
      IF r.op = 'trash' THEN
        -- The file never left, so the row comes back as it was. Its name may not have been taken
        -- meanwhile: an apply skips what the journal names.
        IF EXISTS (SELECT 1 FROM public.files h
                    WHERE h.workspace_id = r.workspace_id
                      AND h.storage_provider = 'network_share'
                      AND h.deleted_at IS NULL
                      AND lower(h.storage_path) = 'nas:' || lower(r.from_locator)
                      AND h.id <> r.file_id) THEN
          RAISE EXCEPTION 'network_share: occupied';
        END IF;
        PERFORM set_config('wilson.network_share_writer', 'op:' || r.file_id::text, true);
        UPDATE public.files
           SET deleted_at = NULL, deleted_by = NULL, share_bin_path = NULL
         WHERE id = r.file_id;
      ELSIF r.op = 'restore' THEN
        -- The file is still in the bin, so the row goes back to the trash, with its own dates.
        PERFORM set_config('wilson.network_share_writer', 'op:' || r.file_id::text, true);
        UPDATE public.files
           SET deleted_at = COALESCE((r.origin ->> 'deleted_at')::timestamptz, now()),
               deleted_by = (r.origin ->> 'deleted_by')::uuid
         WHERE id = r.file_id;
      ELSE
        PERFORM public._network_share_replay_origin(r.id);
      END IF;
      UPDATE public.network_share_ops SET state = 'reverted', settled_at = clock_timestamp() WHERE id = r.id;
    END IF;
  END LOOP;

  PERFORM set_config('wilson.network_share_writer', '', true);
  RETURN jsonb_build_object('settled', cardinality(v_ids), 'outcome', p_outcome);
END;
$$;

CREATE OR REPLACE FUNCTION public.network_share_stale_moves()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_ws  uuid := public.current_workspace_id();
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT COALESCE(public.has_active_membership(v_ws), false) THEN
    RAISE EXCEPTION 'network_share: not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('op_id', x.id, 'file_id', x.file_id, 'op', x.op, 'from', x.from_locator, 'to', x.to_locator)), '[]'::jsonb)
    INTO v_out
    FROM (SELECT o.id, o.file_id, o.op, o.from_locator, o.to_locator
            FROM public.network_share_ops o
           WHERE o.workspace_id = v_ws
             AND o.state = 'pending'
             AND o.created_at < now() - interval '24 hours'
             AND ((o.op IN ('move', 'adopt')
                   AND o.dest_project_id IS NOT NULL
                   AND o.project_id IS DISTINCT FROM o.dest_project_id
                   AND public._network_share_may_call_off(o.project_id)
                   AND public._network_share_may_call_off(o.dest_project_id))
                  -- 0121: an operation that person left in their own space, which nobody else can walk.
                  OR (o.from_locator IS NOT NULL
                      AND o.dest_project_id IS NULL
                      AND rabbit_private.personal_space_of_a_leaver(o.project_id)))
           ORDER BY o.created_at, o.id
           LIMIT 500) x;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_soft_deleted(
  p_retention INTERVAL DEFAULT INTERVAL '30 days'
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t TEXT;
  v_count BIGINT;
  v_total BIGINT := 0;
BEGIN
  -- 0121: an unfinished office-server operation holds a row or a project from the purge, but not for
  -- ever. Its laptop may never come back, and nobody can settle under a binned project: 'until restored'
  -- would keep it, and its folder's claim, with nothing in any list to restore it from. Past the same
  -- retention the operation is closed, and the certificate says what stayed on the server.
  UPDATE public.network_share_ops o
     SET state = 'reverted', settled_at = clock_timestamp()
    FROM public.files f
    LEFT JOIN public.projects p ON p.id = f.project_id
   WHERE f.id = o.file_id
     AND o.state = 'pending'
     AND o.created_at < now() - p_retention
     AND (f.deleted_at < now() - p_retention
          OR p.deleted_at < now() - p_retention
          OR EXISTS (SELECT 1 FROM public.projects q WHERE q.id = o.project_id AND q.deleted_at < now() - p_retention));

  -- Parents first so cascades do the bulk of the work; the remaining loops
  -- catch individually soft-deleted children.
  FOREACH t IN ARRAY ARRAY['projects','assets','tasks','phases','files',
                           'comments','rate_cards','milestones']
  LOOP
    IF t = 'projects' THEN
      DELETE FROM public.projects p
       WHERE p.deleted_at < now() - p_retention
         AND NOT EXISTS (SELECT 1 FROM public.network_share_ops o
                           JOIN public.files f ON f.id = o.file_id
                          WHERE o.state = 'pending' AND (f.project_id = p.id OR o.project_id = p.id));
    ELSIF t = 'files' THEN
      DELETE FROM public.files f
       WHERE f.deleted_at < now() - p_retention
         AND NOT EXISTS (SELECT 1 FROM public.network_share_ops o
                          WHERE o.file_id = f.id AND o.state = 'pending');
    ELSE
      EXECUTE format(
        'DELETE FROM public.%I WHERE deleted_at < now() - $1', t)
        USING p_retention;
    END IF;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_total := v_total + v_count;
  END LOOP;
  RETURN v_total;
END;
$$;

-- §6 The read path says what the last check did not find ------------------------------
DROP FUNCTION IF EXISTS public.moth_project_files(uuid, uuid, integer);
CREATE FUNCTION public.moth_project_files(p_project uuid, p_after uuid DEFAULT NULL, p_limit integer DEFAULT 500)
RETURNS TABLE (
  id uuid, project_id uuid, folder_id uuid, name text, mime_type text, size_bytes bigint,
  kind text, document_kind text, description text, tags text[], storage_provider text,
  storage_path text, thumbnail_url text, duration_sec numeric, source_modified_at timestamptz,
  uploaded_at timestamptz, updated_at timestamptz, share_missing_since timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT f.id,
         f.project_id,
         CASE WHEN EXISTS (SELECT 1 FROM public.folders fo
                            WHERE fo.id = f.folder_id AND fo.project_id = f.project_id)
              THEN f.folder_id END,
         f.name,
         f.mime_type,
         f.size_bytes,
         f.kind::text,
         f.document_kind::text,
         f.description,
         f.tags,
         f.storage_provider::text,
         f.storage_path,
         f.thumbnail_url,
         f.duration_sec,
         f.source_modified_at,
         f.uploaded_at,
         f.updated_at,
         f.share_missing_since
    FROM (
      -- The candidates in id order, and the gate only after them. The fence
      -- (OFFSET 0) keeps the planner from running the gate over every row of the
      -- project before its sort, which made a page of 500 cost a whole project:
      -- measured on dev, 3.7 s for 3,000 files.
      SELECT c.*
        FROM public.files c
       WHERE c.project_id = p_project
         AND (p_after IS NULL OR c.id > p_after)
       ORDER BY c.id
      OFFSET 0
    ) f
   WHERE public.moth_can_read_target('file', f.id)
   ORDER BY f.id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);
$$;
REVOKE EXECUTE ON FUNCTION public.moth_project_files(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_project_files(uuid, uuid, integer) TO authenticated;

-- §7 The office server's locators and its catalogue ------------------------------------
CREATE OR REPLACE FUNCTION public.network_share_locator_ok(p text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  seg text;
BEGIN
  IF NOT public.network_share_path_shape_ok(p) THEN
    RETURN false;
  END IF;
  -- Money and Legal never come through here, at any depth, and a project's _DATABASES folder
  -- holds money JSON (mirrorProjectDatabases). electron/networkShare.cjs carries these lists
  -- as SHARE_REFUSED_EXACT and SHARE_REFUSED_SUFFIX, and a test holds the two equal.
  FOREACH seg IN ARRAY string_to_array(p, '/') LOOP
    IF public.rabbit_money_segment(seg)
       OR lower(seg) ~ '_(receipts&invoices|crewinvoices|talentinvoices|databases)$'
       -- 0121: Windows opens these as devices, and Node's long-path form would hand one to the server as a name.
       OR lower(seg) ~ '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)' THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.network_share_catalogue_apply(
  p_project_id uuid,
  p_root       text,
  p_folder     text,
  p_dirs       jsonb,
  p_bin        jsonb DEFAULT '[]'::jsonb,
  p_final      boolean DEFAULT true,
  p_stopped_at text DEFAULT NULL,
  p_first      boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_ws       uuid := public.current_workspace_id();
  v_final    boolean := COALESCE(p_final, false);
  v_now      timestamptz := clock_timestamp();
  v_root     text;
  v_folder   text;
  v_lf       text;
  v_n        bigint;
  v_check    public.network_share_checks;
  v_run_open boolean;
  v_win_at   timestamptz;
  v_win_n    integer;
  -- The call, parsed.
  v_complete text[];
  v_valid_d  bigint;
  v_subkeys  text[];
  v_pending  text[];
  v_just_left text[];
  v_seen     text[];
  v_loc      text[];
  v_size     bigint[];
  v_mtime    timestamptz[];
  v_mime     text[];
  v_bin      uuid[];
  -- What has gone, and how many of those one call marks: each row costs about 2 ms under its
  -- triggers, and a call has 8 s. A call that could not mark them all is sent again.
  v_hit      uuid[];
  v_moved    uuid[];
  v_todo     uuid[];
  v_cap      CONSTANT integer := 1500;
  v_room     integer;
  v_more     boolean := false;
  -- The counts.
  v_found    bigint;
  v_updated  bigint;
  v_renamed  bigint;
  v_added    bigint;
  v_missing  bigint;
  v_extra    bigint;
  v_total    bigint;
  v_all_done boolean;
  v_run_d    bigint;
  v_run_f    bigint;
  v_next     text;
  v_purge    jsonb;
  v_back     jsonb;
  v_stale    jsonb;
BEGIN
  -- (1) Who. One sentence for every failure, in any company, on any project.
  IF NOT public._network_share_may_check(p_project_id) THEN
    RAISE EXCEPTION 'network_share: not allowed' USING ERRCODE = '42501';
  END IF;

  -- (2) Which drive. A laptop with an old root must not re-list a company's server.
  v_root := public._network_share_drive(v_ws);
  IF v_root IS NULL OR lower(btrim(p_root)) IS DISTINCT FROM lower(v_root) THEN
    RAISE EXCEPTION 'network_share: drive_changed';
  END IF;

  -- (3) Which folder, and that nobody else's overlaps it.
  v_folder := public.network_share_space_folder(p_project_id);
  IF v_folder IS NULL OR p_folder IS DISTINCT FROM v_folder THEN
    RAISE EXCEPTION 'network_share: no_folder';
  END IF;
  v_lf := lower(v_folder);
  PERFORM public._network_share_assert_folder(v_ws, p_project_id, v_folder);

  -- (4) How much. Sizes first, before any lock.
  IF jsonb_typeof(p_dirs) IS DISTINCT FROM 'array'
     OR jsonb_typeof(COALESCE(p_bin, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'network_share: bad_request';
  END IF;
  IF jsonb_array_length(p_dirs) > 2000 OR jsonb_array_length(COALESCE(p_bin, '[]'::jsonb)) > 500 THEN
    RAISE EXCEPTION 'network_share: too_large';
  END IF;
  SELECT COALESCE(sum(CASE WHEN jsonb_typeof(e -> 'files') = 'array' THEN jsonb_array_length(e -> 'files') ELSE 0 END), 0),
         COALESCE(sum(CASE WHEN jsonb_typeof(e -> 'subdirs') = 'array' THEN jsonb_array_length(e -> 'subdirs') ELSE 0 END), 0)
    INTO v_n, v_extra
    FROM jsonb_array_elements(p_dirs) e
   WHERE jsonb_typeof(e) = 'object';
  IF v_n > 5000 OR v_extra > 20000 THEN
    RAISE EXCEPTION 'network_share: too_large';
  END IF;

  -- (5) One at a time on a project, and no more often than this.
  PERFORM public._network_share_lock_projects(ARRAY[p_project_id]);
  SELECT * INTO v_check FROM public.network_share_checks c WHERE c.project_id = p_project_id;
  -- A walk's first call starts a new run, whatever a walk that stopped half way left open.
  v_run_open := COALESCE(v_check.run_open, false) AND NOT COALESCE(p_first, false);
  IF v_check.window_started_at IS NULL OR v_now - v_check.window_started_at >= interval '10 minutes' THEN
    v_win_at := v_now;
    v_win_n := 1;
  ELSE
    v_win_at := v_check.window_started_at;
    v_win_n := v_check.calls_in_window + 1;
    IF v_win_n > 60 THEN
      RAISE EXCEPTION 'network_share: too_soon';
    END IF;
  END IF;

  PERFORM set_config('wilson.network_share_writer', 'check:' || p_project_id::text, true);

  -- (6) Parse. Read as text and judged before any cast. A directory outside the folder, or one
  -- that could not be a locator, is dropped with everything in it.
  WITH dirs AS (
    SELECT lower(e ->> 'd') AS dir, bool_and(COALESCE(e -> 'complete' = 'true'::jsonb, false)) AS complete
      FROM jsonb_array_elements(p_dirs) e
     WHERE jsonb_typeof(e) = 'object'
       AND public.network_share_locator_ok(e ->> 'd')
       AND (lower(e ->> 'd') = v_lf OR starts_with(lower(e ->> 'd'), v_lf || '/'))
     GROUP BY 1
  )
  SELECT COALESCE(array_agg(d.dir) FILTER (WHERE d.complete), '{}'::text[]), count(*)
    INTO v_complete, v_valid_d
    FROM dirs d;

  -- A complete directory's subfolders, as '<dir>/<name>'. A row under one that is not here sits
  -- in a folder that has gone.
  SELECT COALESCE(array_agg(DISTINCT lower(e ->> 'd') || '/' || lower(s)), '{}'::text[])
    INTO v_subkeys
    FROM jsonb_array_elements(p_dirs) e
   CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(e -> 'subdirs') = 'array' THEN e -> 'subdirs' ELSE '[]'::jsonb END) s
   WHERE jsonb_typeof(e) = 'object'
     AND lower(e ->> 'd') = ANY (v_complete);

  -- 0121: a frame folder is one entry in its parent, and the rows under it are not rows of a folder that has
  -- gone. Two numbered stills moved into a folder make it read as a series, and their rows were called missing.
  v_subkeys := v_subkeys || ARRAY(
    SELECT DISTINCT lower(e ->> 'd') || '/' || lower(f ->> 'n')
      FROM jsonb_array_elements(p_dirs) e
     CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e -> 'files') = 'array' THEN e -> 'files' ELSE '[]'::jsonb END) f
     WHERE jsonb_typeof(e) = 'object'
       AND jsonb_typeof(f) = 'object'
       AND f ->> 't' = 'inode/x-frame-sequence'
       AND lower(e ->> 'd') = ANY (v_complete));

  -- 0121: what a move has just taken from a path. A walk's listing can be older than a move that settled during
  -- it, and would add the moved file back at its old place. Past this, the name is free for a new file. Not a
  -- delete: its row knows it is in the bin, and a new file at that name must list at once.
  SELECT COALESCE(array_agg(DISTINCT lower(o.from_locator)), '{}'::text[])
    INTO v_just_left
    FROM public.network_share_ops o
   WHERE o.workspace_id = v_ws
     AND o.state <> 'pending'
     AND o.state = 'done'
     AND o.op = 'move'
     AND o.settled_at > now() - interval '10 minutes'
     AND o.from_locator IS NOT NULL;

  -- What an unsettled operation names stays as it is until it settles (I-5, NS-X04).
  SELECT COALESCE(array_agg(DISTINCT lower(x)), '{}'::text[])
    INTO v_pending
    FROM public.network_share_ops o
   CROSS JOIN LATERAL unnest(ARRAY[o.from_locator, o.to_locator]) x
   WHERE o.workspace_id = v_ws AND o.state = 'pending' AND x IS NOT NULL;

  WITH raw AS (
    SELECT (e ->> 'd') || '/' || (f ->> 'n') AS loc, f ->> 's' AS s, f ->> 'm' AS m, f ->> 't' AS t
      FROM jsonb_array_elements(p_dirs) e
     CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e -> 'files') = 'array' THEN e -> 'files' ELSE '[]'::jsonb END) f
     WHERE jsonb_typeof(e) = 'object'
       AND jsonb_typeof(f) = 'object'
       AND public.network_share_locator_ok(e ->> 'd')
       AND (lower(e ->> 'd') = v_lf OR starts_with(lower(e ->> 'd'), v_lf || '/'))
       AND f ->> 'n' IS NOT NULL
       AND position('/' IN f ->> 'n') = 0
  ), named AS (
    SELECT DISTINCT ON (lower(r.loc)) r.loc, lower(r.loc) AS lp, r.s, r.m, r.t
      FROM raw r
     WHERE public.network_share_locator_ok(r.loc)
     ORDER BY lower(r.loc), r.loc
  ), judged AS (
    SELECT n.loc, n.lp,
           CASE WHEN n.s ~ '^[0-9]{1,15}$' THEN n.s::bigint END AS size,
           public._network_share_mtime(n.m) AS mtime,
           n.m IS NOT NULL AS has_m,
           CASE WHEN length(n.t) <= 255 AND n.t ~ '^[a-z0-9][a-z0-9.+-]*/[A-Za-z0-9][A-Za-z0-9.+_-]*$' THEN n.t END AS mime,
           n.t IS NOT NULL AS has_t
      FROM named n
  ), taken AS (
    -- A file another project's live row holds is not this project's to list.
    SELECT j.*,
           j.size IS NOT NULL
           AND (j.mtime IS NOT NULL OR NOT j.has_m)
           AND (j.mime IS NOT NULL OR NOT j.has_t)
           AND NOT (j.lp = ANY (v_pending))
           AND NOT (j.lp = ANY (v_just_left))
           -- 0121: a frame folder with live rows under it stays those rows, and gets no row of its own beside them.
           AND (j.mime IS DISTINCT FROM 'inode/x-frame-sequence'
                OR NOT EXISTS (SELECT 1 FROM public.files u
                                WHERE u.project_id = p_project_id
                                  AND u.storage_provider = 'network_share'
                                  AND u.deleted_at IS NULL
                                  AND starts_with(lower(u.storage_path), 'nas:' || j.lp || '/')))
           AND NOT EXISTS (SELECT 1 FROM public.files h
                            WHERE h.workspace_id = v_ws
                              AND h.storage_provider = 'network_share'
                              AND h.deleted_at IS NULL
                              AND lower(h.storage_path) = 'nas:' || j.lp
                              AND h.project_id <> p_project_id) AS good
      FROM judged j
  )
  -- Seen means the walk found it, whatever else was wrong with the entry: a row is not missing
  -- because its entry was dropped.
  SELECT COALESCE(array_agg(t.lp), '{}'::text[]),
         COALESCE(array_agg(t.loc) FILTER (WHERE t.good), '{}'::text[]),
         COALESCE(array_agg(t.size) FILTER (WHERE t.good), '{}'::bigint[]),
         COALESCE(array_agg(t.mtime) FILTER (WHERE t.good), '{}'::timestamptz[]),
         COALESCE(array_agg(t.mime) FILTER (WHERE t.good), '{}'::text[])
    INTO v_seen, v_loc, v_size, v_mtime, v_mime
    FROM taken t;

  -- (7) What is still there: a row seen again, and a row whose facts changed. Live rows of this
  -- project only: a trashed row is left exactly as it is.
  UPDATE public.files f
     SET share_missing_since = NULL
    FROM unnest(v_seen) s(lp)
   WHERE f.project_id = p_project_id
     AND f.storage_provider = 'network_share'
     AND f.deleted_at IS NULL
     AND f.share_missing_since IS NOT NULL
     AND lower(f.storage_path) = 'nas:' || s.lp
     AND NOT EXISTS (SELECT 1 FROM public.network_share_ops o WHERE o.file_id = f.id AND o.state = 'pending');
  GET DIAGNOSTICS v_found = ROW_COUNT;

  UPDATE public.files f
     SET storage_path = 'nas:' || e.loc,
         size_bytes = e.size,
         source_modified_at = COALESCE(e.mtime, f.source_modified_at),
         mime_type = COALESCE(e.mime, f.mime_type)
    FROM unnest(v_loc, v_size, v_mtime, v_mime) e(loc, size, mtime, mime)
   WHERE f.project_id = p_project_id
     AND f.storage_provider = 'network_share'
     AND f.deleted_at IS NULL
     AND lower(f.storage_path) = 'nas:' || lower(e.loc)
     AND (f.storage_path IS DISTINCT FROM 'nas:' || e.loc
          OR f.size_bytes IS DISTINCT FROM e.size
          OR (e.mtime IS NOT NULL AND f.source_modified_at IS DISTINCT FROM e.mtime)
          OR (e.mime IS NOT NULL AND f.mime_type IS DISTINCT FROM e.mime));
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- (8) What has gone: a row directly in a complete directory and not seen, or under a subfolder
  -- that directory no longer has. A row an unsettled operation holds has not gone (NS-D5). Each
  -- ancestor is looked up rather than each directory walked, because a project may hold 50,000
  -- rows and a call 2,000 directories.
  WITH live AS (
    SELECT f.id,
           lower(substr(f.storage_path, 5)) AS lp,
           string_to_array(lower(substr(f.storage_path, 5)), '/') AS segs
      FROM public.files f
     WHERE f.project_id = p_project_id
       AND f.storage_provider = 'network_share'
       AND f.deleted_at IS NULL
       AND f.share_missing_since IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.network_share_ops o WHERE o.file_id = f.id AND o.state = 'pending')
  ), up AS (
    SELECT l.id, l.lp, cardinality(l.segs) AS depth, i,
           array_to_string(l.segs[1:i], '/') AS dir,
           array_to_string(l.segs[1:i + 1], '/') AS next
      FROM live l
     CROSS JOIN LATERAL generate_series(1, cardinality(l.segs) - 1) i
  ), hit AS (
    SELECT u.id
      FROM up u
      JOIN unnest(v_complete) c(dir) ON c.dir = u.dir
      LEFT JOIN unnest(v_seen) s(lp) ON s.lp = u.lp
      LEFT JOIN unnest(v_subkeys) k(key) ON k.key = u.next
     WHERE s.lp IS NULL
       AND (u.i = u.depth - 1 OR k.key IS NULL)
  )
  SELECT COALESCE(array_agg(DISTINCT h.id), '{}'::uuid[]) INTO v_hit FROM hit h;

  -- A rename: a row that has gone, or that an earlier call of the walk marked (a folder's rows can
  -- go in one call and come up in the next), and an entry nobody holds, with the same name, size
  -- and time, each the only one of its kind. The row keeps its id.
  WITH gone AS (
    SELECT f.id,
           lower(regexp_replace(f.storage_path, '^.*/', '')) AS leaf,
           f.size_bytes AS size,
           f.source_modified_at AS mtime
      FROM unnest(v_hit) g(id)
      JOIN public.files f ON f.id = g.id
     WHERE f.source_modified_at IS NOT NULL
    UNION ALL
    -- Step (7) has cleared every marked row this call saw, an operation's aside.
    SELECT f.id,
           lower(regexp_replace(f.storage_path, '^.*/', '')),
           f.size_bytes,
           f.source_modified_at
      FROM public.files f
     WHERE f.project_id = p_project_id
       AND f.storage_provider = 'network_share'
       AND f.deleted_at IS NULL
       AND f.share_missing_since IS NOT NULL
       AND f.source_modified_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.network_share_ops o WHERE o.file_id = f.id AND o.state = 'pending')
  ), free AS (
    SELECT e.loc,
           lower(regexp_replace(e.loc, '^.*/', '')) AS leaf,
           e.size,
           e.mtime
      FROM unnest(v_loc, v_size, v_mtime) e(loc, size, mtime)
     WHERE e.mtime IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.files h
                        WHERE h.workspace_id = v_ws
                          AND h.storage_provider = 'network_share'
                          AND h.deleted_at IS NULL
                          AND lower(h.storage_path) = 'nas:' || lower(e.loc))
  ), pair AS (
    SELECT a.id, b.loc
      FROM (SELECT g.*, count(*) OVER (PARTITION BY g.leaf, g.size, g.mtime) AS n FROM gone g) a
      JOIN (SELECT r.*, count(*) OVER (PARTITION BY r.leaf, r.size, r.mtime) AS n FROM free r) b
        ON a.leaf = b.leaf AND a.size = b.size AND a.mtime = b.mtime
     WHERE a.n = 1 AND b.n = 1
  ), fo AS (
    SELECT lower(x.path) AS lp, (array_agg(x.id ORDER BY x.id))[1] AS id
      FROM public.folders x WHERE x.project_id = p_project_id GROUP BY 1
  ), moved AS (
    UPDATE public.files f
       SET storage_path = 'nas:' || p.loc,
           folder_id = fo.id,
           share_missing_since = NULL
      FROM pair p
      LEFT JOIN fo ON fo.lp = NULLIF(substr(lower(regexp_replace(p.loc, '/?[^/]*$', '')), length(v_lf) + 2), '')
     WHERE f.id = p.id
    RETURNING f.id
  )
  SELECT count(*), COALESCE(array_agg(m.id), '{}'::uuid[]) INTO v_renamed, v_moved FROM moved m;

  -- (9) New files. Local Server's '<uuid>-' prefix comes off the name. NS-X15: a folder is found
  -- by its path. ON CONFLICT: a racing writer's row stands.
  WITH fo AS (
    SELECT lower(x.path) AS lp, (array_agg(x.id ORDER BY x.id))[1] AS id
      FROM public.folders x WHERE x.project_id = p_project_id GROUP BY 1
  )
  INSERT INTO public.files
    (workspace_id, project_id, folder_id, name, mime_type, size_bytes,
     storage_provider, storage_path, source_modified_at, kind)
  SELECT v_ws, p_project_id, fo.id,
         COALESCE(NULLIF(regexp_replace(regexp_replace(e.loc, '^.*/', ''),
                                        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-', ''), ''),
                  regexp_replace(e.loc, '^.*/', '')),
         e.mime, e.size, 'network_share', 'nas:' || e.loc, e.mtime, 'source'
    FROM unnest(v_loc, v_size, v_mtime, v_mime) e(loc, size, mtime, mime)
    LEFT JOIN fo ON fo.lp = NULLIF(substr(lower(regexp_replace(e.loc, '/?[^/]*$', '')), length(v_lf) + 2), '')
   WHERE NOT EXISTS (SELECT 1 FROM public.files h
                      WHERE h.workspace_id = v_ws
                        AND h.storage_provider = 'network_share'
                        AND h.deleted_at IS NULL
                        AND lower(h.storage_path) = 'nas:' || lower(e.loc))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  SELECT count(*) INTO v_total
    FROM public.files f
   WHERE f.project_id = p_project_id AND f.storage_provider = 'network_share';
  IF v_total > 50000 THEN
    RAISE EXCEPTION 'network_share: too_many';
  END IF;

  -- (10) Mark what has gone and was not renamed. Nothing is deleted by a check. No more than the
  -- cap in a call: the rest are marked when the desktop sends the call again.
  v_todo := ARRAY(SELECT x.id
                    FROM (SELECT unnest(v_hit) AS id EXCEPT SELECT unnest(v_moved)) x
                   ORDER BY x.id);
  v_more := cardinality(v_todo) > v_cap;
  UPDATE public.files f
     SET share_missing_since = now()
   WHERE f.id = ANY (v_todo[1:v_cap]);
  GET DIAGNOSTICS v_missing = ROW_COUNT;

  -- A row its folder has left behind: folder_root was pointed elsewhere after it was listed. It
  -- cannot be walked from here, so it reads as not found rather than as there. Seen again if the
  -- folder comes back.
  IF v_final THEN
    v_room := v_cap - v_missing;
    v_todo := ARRAY(SELECT f.id
                      FROM public.files f
                     WHERE f.project_id = p_project_id
                       AND f.storage_provider = 'network_share'
                       AND f.deleted_at IS NULL
                       AND f.share_missing_since IS NULL
                       AND NOT starts_with(lower(substr(f.storage_path, 5)), v_lf || '/')
                       AND NOT EXISTS (SELECT 1 FROM public.network_share_ops o WHERE o.file_id = f.id AND o.state = 'pending')
                     ORDER BY f.id
                     LIMIT v_room + 1);
    v_more := v_more OR cardinality(v_todo) > v_room;
    UPDATE public.files f
       SET share_missing_since = now()
     WHERE f.id = ANY (v_todo[1:v_room]);
    GET DIAGNOSTICS v_extra = ROW_COUNT;
    v_missing := v_missing + v_extra;
  END IF;

  -- (11) The check's row. Only the final call of a walk moves "last checked". A call with more to
  -- mark is sent again, so it adds nothing to the run until the send that finishes.
  v_all_done := v_valid_d = jsonb_array_length(p_dirs)
    AND cardinality(v_complete) = v_valid_d
    AND p_stopped_at IS NULL;
  IF v_run_open THEN
    v_all_done := v_all_done AND v_check.complete;
  ELSE
    -- A walk that sent no directory has checked nothing.
    v_all_done := v_all_done AND v_valid_d > 0;
  END IF;
  IF v_run_open THEN
    v_run_d := v_check.dirs_checked + v_valid_d;
    v_run_f := v_check.files_seen + cardinality(v_seen);
  ELSE
    v_run_d := v_valid_d;
    v_run_f := cardinality(v_seen);
  END IF;
  IF p_stopped_at IS NOT NULL AND public.network_share_locator_ok(p_stopped_at)
     AND (lower(p_stopped_at) = v_lf OR starts_with(lower(p_stopped_at), v_lf || '/')) THEN
    v_next := p_stopped_at;
  END IF;

  INSERT INTO public.network_share_checks AS c
    (project_id, workspace_id, folder_locator, last_checked_at, last_checked_by, complete,
     dirs_checked, files_seen, missing_count, next_start, run_open, window_started_at, calls_in_window)
  VALUES
    (p_project_id, v_ws, v_folder,
     CASE WHEN v_final AND NOT v_more THEN clock_timestamp() END,
     CASE WHEN v_final AND NOT v_more THEN v_uid END,
     v_all_done AND NOT v_more,
     CASE WHEN v_more THEN 0 ELSE v_run_d END,
     CASE WHEN v_more THEN 0 ELSE v_run_f END,
     (SELECT count(*) FROM public.files f
       WHERE f.project_id = p_project_id AND f.storage_provider = 'network_share'
         AND f.deleted_at IS NULL AND f.share_missing_since IS NOT NULL),
     v_next, NOT v_final AND NOT v_more, v_win_at, v_win_n)
  ON CONFLICT (project_id) DO UPDATE
    SET folder_locator = EXCLUDED.folder_locator,
        last_checked_at = CASE WHEN v_final AND NOT v_more THEN EXCLUDED.last_checked_at ELSE c.last_checked_at END,
        last_checked_by = CASE WHEN v_final AND NOT v_more THEN EXCLUDED.last_checked_by ELSE c.last_checked_by END,
        complete = CASE WHEN v_more THEN c.complete ELSE EXCLUDED.complete END,
        dirs_checked = CASE WHEN v_more THEN c.dirs_checked ELSE EXCLUDED.dirs_checked END,
        files_seen = CASE WHEN v_more THEN c.files_seen ELSE EXCLUDED.files_seen END,
        missing_count = EXCLUDED.missing_count,
        next_start = CASE WHEN v_final AND NOT v_more THEN EXCLUDED.next_start ELSE c.next_start END,
        run_open = CASE WHEN v_more THEN c.run_open ELSE EXCLUDED.run_open END,
        window_started_at = EXCLUDED.window_started_at,
        calls_in_window = EXCLUDED.calls_in_window;

  -- (12) The bin: what the cloud's purge has certified, for the desktop to remove for good; a
  -- live row whose file is still in the bin, to move back; and what somebody else left unsettled.
  SELECT COALESCE(array_agg(DISTINCT x::uuid), '{}'::uuid[]) INTO v_bin
    FROM jsonb_array_elements_text(COALESCE(p_bin, '[]'::jsonb)) x
   WHERE x ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  SELECT COALESCE(jsonb_agg(b.id), '[]'::jsonb) INTO v_purge
    FROM unnest(v_bin) b(id)
   WHERE EXISTS (SELECT 1 FROM public.file_events fe
                  WHERE fe.file_id = b.id
                    AND fe.project_id = p_project_id
                    AND fe.workspace_id = v_ws
                    AND fe.event = 'purged'
                    AND fe.storage_provider = 'network_share')
     AND NOT EXISTS (SELECT 1 FROM public.files f WHERE f.id = b.id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', f.id, 'to', substr(f.storage_path, 5))), '[]'::jsonb) INTO v_back
    FROM public.files f
   WHERE f.id = ANY (v_bin)
     AND f.project_id = p_project_id
     AND f.storage_provider = 'network_share'
     AND f.deleted_at IS NULL
     AND starts_with(lower(substr(f.storage_path, 5)), v_lf || '/')
     AND NOT EXISTS (SELECT 1 FROM public.network_share_ops o WHERE o.file_id = f.id AND o.state = 'pending');

  SELECT COALESCE(jsonb_agg(jsonb_build_object('op_id', o.id, 'op', o.op, 'from', o.from_locator, 'to', o.to_locator,
                                               'size', (SELECT sf.size_bytes FROM public.files sf WHERE sf.id = o.file_id))), '[]'::jsonb)
    INTO v_stale
    FROM public.network_share_ops o
   WHERE o.workspace_id = v_ws
     AND o.state = 'pending'
     AND o.created_at < now() - interval '24 hours'
     AND o.from_locator IS NOT NULL
     AND starts_with(lower(o.from_locator), v_lf || '/')
     AND starts_with(lower(o.to_locator), v_lf || '/');

  -- (13)
  PERFORM set_config('wilson.network_share_writer', '', true);

  RETURN jsonb_build_object(
    'added', v_added,
    'updated', v_updated,
    'renamed', v_renamed,
    'found_again', v_found,
    'newly_missing', v_missing,
    'more_missing', v_more,
    'purge_ok', v_purge,
    'restore_back', v_back,
    'stale', v_stale,
    'checked_at', v_now);
END;
$$;

-- §8 COMMENTs ----------------------------------------------------------------------
COMMENT ON FUNCTION rabbit_private.personal_space_of_a_leaver(uuid) IS
  '0121 (MO1, her integration answer 2): the caller is an admin of this company and this personal space''s owner is someone else who is no longer an active member of it.';
COMMENT ON FUNCTION public.moth_leaver_files(uuid) IS
  '0121: the files of a former member''s personal space an admin may move: no money and no Legal. Empty for anyone else, and while the owner is active.';
COMMENT ON FUNCTION public.moth_move_leaver_files(uuid[], uuid, uuid, boolean, jsonb) IS
  '0121: moth_move_items for an admin on a former member''s personal space, into a project, recorded as WIL-4115. Not a file in that person''s folder on the office server.';
COMMENT ON FUNCTION public.workspace_storage_usage() IS
  'Session 41; 0121 (her integration answer 3): the plan''s status and whether it is full, nearly full or neither. The figures are an admin''s alone, because the total holds people''s personal files.';
COMMENT ON FUNCTION public._network_share_may_call_off(uuid) IS
  '0121: whoever could check this folder, or an admin once a personal space''s owner has left. Only for saying an operation did not happen.';
COMMENT ON FUNCTION public.moth_project_files(uuid, uuid, integer) IS
  'A page of a project''s files the caller may see in Moth, keyed on id. A hidden or missing project gives no rows. 0121: share_missing_since, when the last check did not find a file on the office server.';

-- §9 Post-conditions ---------------------------------------------------------------
DO $$
DECLARE
  v_fn   RECORD;
  v_body TEXT;
BEGIN
  -- Every restated body is this file's.
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public._moth_target_eligible(text,uuid,boolean)', '06ce9d801842872e467b9dcc119cb063', 'f879ef0b2c71a21731ca355fe1a022c2'),
      ('public.moth_can_write_target(text,uuid)', 'c629ec6cafb9487b4af470ec0091900a', 'f48c7ad84e94772bfb7bddd0a974cfdc'),
      ('public.moth_project_files(uuid,uuid,integer)', '3a473342a8a071d12a04c5190191fd8a', '0a8eaecced067d9eea6d116aba495fb4'),
      ('public.reserve_upload_bytes(text,bigint)', '87b382a7fbd48eb15f3738328d88a8e6', 'cbd585a061cf9a4c93d5a7cacea25500'),
      ('public.network_share_pending_mine()', '904d7ca754ffaeee3ea3de7b567574de', '5f22500ca9211c196313d54d603564c8'),
      ('public.network_share_settle(uuid[],text,jsonb)', '3a4e5d614de881b5c80662304603bf05', 'a82cd773542ac0d92d88a01ad558aded'),
      ('public.network_share_stale_moves()', '857e424840d5ea966ea042454c2208ff', '2eccf1aac110922f0d1a8d348d4f97a9'),
      ('public.purge_soft_deleted(interval)', '65f3322262d48afa923ccd5f40c69a4c', '4f659fad4e1fd978f0cd220c6a628eb4'),
      ('public.network_share_locator_ok(text)', 'f210a014f699421a9361ace3fa63958d', '19c62fa6840888629a68b14e46463a37'),
      ('public.network_share_catalogue_apply(uuid,text,text,jsonb,jsonb,boolean,text,boolean)', '6c5bc7b6874e0e7348b2b3fcfbc5389f', '9ee5d8f7dcca2f567c553a56babc9deb')
    ) AS t(sig, was, now_is)
  LOOP
    IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = v_fn.sig::regprocedure) IS DISTINCT FROM v_fn.now_is THEN
      RAISE EXCEPTION '0121 post-condition: % is not this file''s body', v_fn.sig;
    END IF;
  END LOOP;

  -- Who may call what.
  FOR v_fn IN SELECT * FROM (VALUES
      ('public.moth_leaver_files(uuid)', true),
      ('public.moth_move_leaver_files(uuid[],uuid,uuid,boolean,jsonb)', true),
      ('public.workspace_storage_usage()', true),
      ('public.moth_project_files(uuid,uuid,integer)', true),
      ('public.network_share_pending_mine()', true),
      ('public.network_share_settle(uuid[],text,jsonb)', true),
      ('public.network_share_stale_moves()', true),
      ('public._network_share_may_call_off(uuid)', false),
      ('rabbit_private.personal_space_of_a_leaver(uuid)', false)
    ) AS t(sig, open)
  LOOP
    IF has_function_privilege('anon', v_fn.sig::regprocedure, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn.sig::regprocedure, 'EXECUTE') IS DISTINCT FROM v_fn.open THEN
      RAISE EXCEPTION '0121 post-condition: % has the wrong grants', v_fn.sig;
    END IF;
  END LOOP;

  -- The move goes through the one core, under the marker, and clears it.
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_body FROM pg_proc
   WHERE oid = 'public.moth_move_leaver_files(uuid[],uuid,uuid,boolean,jsonb)'::regprocedure;
  IF position('public.moth_move_items(' IN v_body) = 0
     OR position('''wilson.moth_leaver_move'', ''on''' IN v_body) = 0
     OR position('''wilson.moth_leaver_move'', ''''' IN v_body) = 0
     OR position('WIL-4115' IN v_body) = 0
     OR position('moth_move:on_their_computer' IN v_body) = 0
     OR position('moth_move:in_their_server_folder' IN v_body) = 0 THEN
    RAISE EXCEPTION '0121 post-condition: moth_move_leaver_files lost a step';
  END IF;
  IF position('''file_ids''' IN v_body) > 0 THEN
    RAISE EXCEPTION '0121 post-condition: the record of a move names its ids, and a large move would not fit';
  END IF;

  -- The read path's fence (0111, the hand-off's trap on ORDER BY over a filter).
  SELECT prosrc INTO v_body FROM pg_proc WHERE oid = 'public.moth_project_files(uuid,uuid,integer)'::regprocedure;
  IF position('OFFSET 0' IN v_body) = 0 THEN
    RAISE EXCEPTION '0121 post-condition: moth_project_files lost its fence';
  END IF;
  SELECT prosrc INTO v_body FROM pg_proc WHERE oid = 'public.moth_leaver_files(uuid)'::regprocedure;
  IF position('OFFSET 0' IN v_body) = 0 OR position('''supabase''' IN v_body) = 0 THEN
    RAISE EXCEPTION '0121 post-condition: moth_leaver_files lost its fence or what it leaves out';
  END IF;
  SELECT prosrc INTO v_body FROM pg_proc WHERE oid = 'public.workspace_storage_usage()'::regprocedure;
  IF position('OFFSET 0' IN v_body) = 0 THEN
    RAISE EXCEPTION '0121 post-condition: workspace_storage_usage runs its meter more than once';
  END IF;

  -- The plan's size is an admin's, and it is still the one policy, on reads alone.
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workspace_storage_plans') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workspace_storage_plans'
                     AND cmd = 'SELECT' AND qual LIKE '%current_app_role%') THEN
    RAISE EXCEPTION '0121 post-condition: workspace_storage_plans is not an admin''s to read';
  END IF;

  -- A project called Con keeps its folder_slug: only the locator refuses the name.
  IF NOT public.network_share_path_shape_ok('Con') OR public.network_share_locator_ok('a/Con') THEN
    RAISE EXCEPTION '0121 post-condition: a device name is refused in the wrong place';
  END IF;

  RAISE NOTICE '0121 OK';
END $$;
