-- =============================================================================
-- 0129_moth_history_s3.sql — M.O.T.H. Session 3 (MO3): the record of workspace notes, typed tags, their assignments
-- and links. (docs/design/MOTH_DESIGN.md §2.5 H11 and SEC-09; docs/sessions/PLAN_MOTH.md §5 Session 3.)
--
-- WHAT THIS CHANGES
-- -----------------
--   §1  0128's three checks validated (entity, class, peers): a scan that writes wait for no longer than a moment.
--   §2  _moth_history_end(kind, id): whose a thing is, for an end of an assignment or a link (a note's own tier, or
--       its project's class by 0119's _moth_history_audience); _moth_history_s3_side(table, image): one side of a
--       note (personal: its owner's; shared or standard: the company's), a typed tag (the same), a tag's assignment
--       (the thing tagged, with the assignment's own tier as its peer: a person's own is theirs alone) and a link
--       (where it starts, with where it ends as its peer).
--   §3  moth_history_project and moth_history_projection_ok restated from 0124's bodies: a note's title, tier and
--       trash (never its body or its preview); a tag's label, type, tier, what it stands for, whether retired; an
--       assignment's tag, thing and tier; a link's two ends, its words and how it came.
--   §4  fn_moth_history_capture restated from 0119's body: the four tables take their sides from §2, with their peers.
--   §5  _moth_history_entity_visible, moth_history_read and moth_history_window restated from 0119's bodies: a side
--       shows when its own audience passes and its peer's does too (with no project, as the company's or as its
--       owner's; with one, by Moth's gate); a note by Moth's gate, a tag to the company or its owner, an assignment
--       by its tier and its thing's gate, a link by both ends' gates; the window names the four.
--   §6  The four tables' triggers: their rows as they are made and removed, and the columns stored or classified as
--       they change (a note's body is no part of it).
--   §7  When recording began for the four; §8 post-conditions.
--
-- CREATE TRIGGER takes SHARE ROW EXCLUSIVE on notes and the three new tables (writes to them wait a moment); the
-- VALIDATEs take SHARE UPDATE EXCLUSIVE on moth_history (writes go on). One transaction, re-runnable. Suite
-- 121_moth_history.sql (and 133_moth_history_s3.sql).
-- =============================================================================

SET LOCAL lock_timeout = '15s';

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
DECLARE
  v_md5 TEXT;
  v_fn  RECORD;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'moth_history' AND column_name ~ '_peer_') <> 6
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.moth_history'::regclass AND conname = 'moth_history_g_peer_chk') THEN
    RAISE EXCEPTION '0129 refused: 0128 must be applied first';
  END IF;
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public.fn_moth_history_capture()', '837ea748d9f13341311cd9ef826b8aa3', 'c7ad57ac2c1a9b46528b7e98a6dc44ec'),
      ('public.moth_history_project(text,jsonb)', '74316c0e37e3e54363454b5f179494e0', '7009ba0e9014e99e4545dc713dedc333'),
      ('public.moth_history_projection_ok(jsonb)', 'd9ae6159d8cd5dc4c81bc50e2f4cf11e', '63de72c284cc1745453e4a11e3738db9'),
      ('public._moth_history_entity_visible(uuid,text,uuid)', '43fe2d001ef171e5a9f37304b2a03944', 'e8f5e5f573df3ce80877c9fb7777518d'),
      ('public.moth_history_read(uuid,timestamptz,uuid,integer)', '3ee642733d7b88dfbde02f4d7d3a80a8', 'e1ef26552d81dd2eb102aaf87c1f9425'),
      ('public.moth_history_window(uuid)', '64ab04665fd89ac027896dae65f337a8', '91807b644a8f10ab1e9807f9842eefe3'),
      ('public._moth_history_audience(text,jsonb,uuid)', '5e34a198622ba1a0cbd78c080ed16619', '5e34a198622ba1a0cbd78c080ed16619'),
      ('rabbit_private.moth_target_project(text,uuid)', '92d4ccab0e850e9fcf5b5bff0b669e23', '92d4ccab0e850e9fcf5b5bff0b669e23')
    ) AS t(sig, was, now_is)
  LOOP
    SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure(v_fn.sig);
    IF v_md5 IS DISTINCT FROM v_fn.was AND v_md5 IS DISTINCT FROM v_fn.now_is THEN
      RAISE EXCEPTION '0129 refused: % is not the body this file was built on (md5 %)', v_fn.sig, v_md5;
    END IF;
  END LOOP;
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public._moth_history_end(text,uuid)', 'dbbd4a0eacb608b1fba6de16b2b703a8'),
      ('public._moth_history_s3_side(text,jsonb)', '0e3e4f9f2eb642dfcc2e3cb3ca8e5aeb')
    ) AS t(sig, now_is)
  LOOP
    IF to_regprocedure(v_fn.sig) IS NOT NULL
       AND (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure(v_fn.sig)) IS DISTINCT FROM v_fn.now_is THEN
      RAISE EXCEPTION '0129 refused: % is here and is not this file''s', v_fn.sig;
    END IF;
  END LOOP;
END $$;

-- §1 0128's checks, validated ------------------------------------------------------------------
ALTER TABLE public.moth_history VALIDATE CONSTRAINT moth_history_b_entity_chk;
ALTER TABLE public.moth_history VALIDATE CONSTRAINT moth_history_c_class_chk;
ALTER TABLE public.moth_history VALIDATE CONSTRAINT moth_history_g_peer_chk;

-- §2 Whose a Session 3 row is ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._moth_history_end(
  p_kind text, p_id uuid, OUT o_project uuid, OUT o_class text, OUT o_owner uuid)
RETURNS record
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_tier  text;
  v_owner uuid;
BEGIN
  -- Whose a thing is, for one end of a tag's assignment or a link: a note's own tier (no project), or its
  -- project's class by 0119's rule. A thing that cannot be found has no audience: no one reads that side.
  IF p_kind IS NULL OR p_id IS NULL THEN
    RETURN;
  END IF;
  BEGIN
    IF p_kind = 'note' THEN
      SELECT n.tier, n.owner_id INTO v_tier, v_owner FROM public.notes n WHERE n.id = p_id;
      IF v_tier = 'personal' THEN
        o_class := 'personal';
        o_owner := v_owner;
      ELSIF v_tier IS NOT NULL THEN
        o_class := 'workspace';
      END IF;
      RETURN;
    END IF;
    o_project := rabbit_private.moth_target_project(p_kind, p_id);
    IF o_project IS NULL THEN
      RETURN;
    END IF;
    SELECT a.o_class, a.o_owner INTO o_class, o_owner
      FROM public._moth_history_audience(CASE WHEN p_kind = 'project' THEN 'phases' ELSE p_kind END, '{}'::jsonb, o_project) a;
    IF o_class IS NULL THEN
      o_project := NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    o_project := NULL;
    o_class := NULL;
    o_owner := NULL;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public._moth_history_end(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._moth_history_s3_side(
  p_table text, p_image jsonb,
  OUT o_project uuid, OUT o_class text, OUT o_owner uuid,
  OUT o_peer_project uuid, OUT o_peer_class text, OUT o_peer_owner uuid)
RETURNS record
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  e record;
BEGIN
  -- One side of a Session 3 row, as it was: its audience, and its peer's where the row joins two things.
  IF p_image IS NULL THEN
    RETURN;
  END IF;
  BEGIN
    IF p_table IN ('notes', 'moth_tags') THEN
      -- No project: a person's own (personal, with its owner), or the company's (every active member's).
      IF p_image ->> 'tier' = 'personal' THEN
        o_class := 'personal';
        o_owner := (p_image ->> 'owner_id')::uuid;
      ELSIF p_image ->> 'tier' IS NOT NULL THEN
        o_class := 'workspace';
      END IF;
    ELSIF p_table = 'moth_tag_assignments' THEN
      -- The thing tagged is the side; the assignment's own tier its peer: a person's own is theirs alone.
      SELECT x.o_project, x.o_class, x.o_owner INTO e
        FROM public._moth_history_end(p_image ->> 'target_type', (p_image ->> 'target_id')::uuid) x;
      o_project := e.o_project;
      o_class := e.o_class;
      o_owner := e.o_owner;
      IF p_image ->> 'tier' = 'personal' THEN
        o_peer_class := 'personal';
        o_peer_owner := (p_image ->> 'owner_id')::uuid;
      ELSE
        o_peer_class := 'workspace';
      END IF;
    ELSIF p_table = 'moth_relationships' THEN
      -- Where a link starts is the side; where it ends, its peer.
      SELECT x.o_project, x.o_class, x.o_owner INTO e
        FROM public._moth_history_end(p_image ->> 'source_type', (p_image ->> 'source_id')::uuid) x;
      o_project := e.o_project;
      o_class := e.o_class;
      o_owner := e.o_owner;
      SELECT x.o_project, x.o_class, x.o_owner INTO e
        FROM public._moth_history_end(p_image ->> 'dest_type', (p_image ->> 'dest_id')::uuid) x;
      o_peer_project := e.o_project;
      o_peer_class := e.o_class;
      o_peer_owner := e.o_owner;
      -- An end that cannot be found leaves the side to no one, never to the other end's audience alone.
      IF o_peer_class IS NULL THEN
        o_project := NULL;
        o_class := NULL;
        o_owner := NULL;
      END IF;
    END IF;
    -- A side with no audience has no peer either.
    IF o_class IS NULL THEN
      o_project := NULL;
      o_owner := NULL;
      o_peer_project := NULL;
      o_peer_class := NULL;
      o_peer_owner := NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    o_project := NULL;
    o_class := NULL;
    o_owner := NULL;
    o_peer_project := NULL;
    o_peer_class := NULL;
    o_peer_owner := NULL;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public._moth_history_s3_side(text, jsonb) FROM PUBLIC, anon, authenticated;

-- §3 What may be stored ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.moth_history_projection_ok(p jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN CASE
    WHEN p IS NULL OR jsonb_typeof(p) <> 'object' THEN false
    WHEN octet_length(p::text) > 4096 THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_each(p) e
       WHERE NOT e.key = ANY (ARRAY['name', 'title', 'slug', 'kind', 'type', 'type_label', 'status', 'document_kind', 'mime_type',
                                    'size_bytes', 'categories', 'is_core_definer', 'missing', 'number', 'parent_id', 'parent_phase_id',
                                    'folder_id', 'phase_id', 'asset_id', 'task_id', 'scene_id', 'shot_id', 'level_id', 'experience_id',
                                    'scene_ids', 'shot_ids', 'level_ids', 'experience_ids', 'item_type', 'item_id', 'position',
                                    'sort_order', 'truncated', 'in_trash',
                                    -- 0129 (MO3): a note's, a typed tag's, an assignment's and a link's.
                                    'tier', 'label', 'type_id', 'canonical_id', 'retired', 'tag_id', 'target_type',
                                    'target_id', 'source_type', 'source_id', 'dest_type', 'dest_id', 'origin'])
          OR jsonb_typeof(e.value) = 'object'
          OR (jsonb_typeof(e.value) = 'string' AND length(e.value #>> '{}') > 300)
          OR CASE WHEN jsonb_typeof(e.value) = 'array'
                  THEN jsonb_array_length(e.value) > 200
                       OR EXISTS (SELECT 1 FROM jsonb_array_elements(e.value) x WHERE jsonb_typeof(x) IN ('object', 'array'))
                  ELSE false END
    )
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.moth_history_projection_ok(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.moth_history_project(p_table text, p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  r     jsonb;
  v_out jsonb := '{}'::jsonb;
  e     record;
  v     jsonb;
  n     integer;
  v_cut boolean := false;
BEGIN
  IF p_row IS NULL THEN
    RETURN NULL;
  END IF;
  -- 0124 (MO2-18): a row in the trash says so; a live row's projection is as it was (a NULL is stripped). So the
  -- prior side of a purge says the row was in the trash, and looking back does not bring it back for that time.
  r := CASE p_table
    WHEN 'projects' THEN jsonb_build_object('title', p_row -> 'title', 'status', p_row -> 'status', 'type', p_row -> 'project_type',
                                            'in_trash', CASE WHEN jsonb_typeof(p_row -> 'deleted_at') = 'string' THEN 'true'::jsonb END)
    WHEN 'phases' THEN jsonb_build_object('name', p_row -> 'name', 'status', p_row -> 'status', 'parent_phase_id', p_row -> 'parent_phase_id', 'sort_order', p_row -> 'sort_order',
                                          'in_trash', CASE WHEN jsonb_typeof(p_row -> 'deleted_at') = 'string' THEN 'true'::jsonb END)
    WHEN 'assets' THEN jsonb_build_object('name', p_row -> 'name', 'type', p_row -> 'type', 'type_label', p_row -> 'type_label', 'status', p_row -> 'status',
                                          'phase_id', p_row -> 'phase_id', 'sort_order', p_row -> 'sort_order', 'scene_ids', p_row -> 'scene_ids',
                                          'shot_ids', p_row -> 'shot_ids', 'level_ids', p_row -> 'level_ids', 'experience_ids', p_row -> 'experience_ids',
                                          'in_trash', CASE WHEN jsonb_typeof(p_row -> 'deleted_at') = 'string' THEN 'true'::jsonb END)
    WHEN 'tasks' THEN jsonb_build_object('title', p_row -> 'title', 'status', p_row -> 'status', 'phase_id', p_row -> 'phase_id', 'asset_id', p_row -> 'asset_id',
                                         'scene_id', p_row -> 'scene_id', 'shot_id', p_row -> 'shot_id',
                                         'in_trash', CASE WHEN jsonb_typeof(p_row -> 'deleted_at') = 'string' THEN 'true'::jsonb END)
    WHEN 'files' THEN jsonb_build_object('name', p_row -> 'name', 'kind', p_row -> 'kind', 'mime_type', p_row -> 'mime_type', 'size_bytes', p_row -> 'size_bytes',
                                         'document_kind', p_row -> 'document_kind', 'categories', p_row -> 'tags', 'is_core_definer', p_row -> 'is_core_definer',
                                         'folder_id', p_row -> 'folder_id', 'phase_id', p_row -> 'phase_id', 'asset_id', p_row -> 'asset_id', 'task_id', p_row -> 'task_id',
                                         'scene_id', p_row -> 'scene_id', 'shot_id', p_row -> 'shot_id', 'level_id', p_row -> 'level_id', 'experience_id', p_row -> 'experience_id',
                                         'missing', to_jsonb(jsonb_typeof(p_row -> 'share_missing_since') = 'string'),
                                         'in_trash', CASE WHEN jsonb_typeof(p_row -> 'deleted_at') = 'string' THEN 'true'::jsonb END)
    WHEN 'folders' THEN jsonb_build_object('name', COALESCE(NULLIF(p_row -> 'label', 'null'::jsonb), p_row -> 'slug'), 'slug', p_row -> 'slug', 'kind', p_row -> 'kind',
                                           'item_type', p_row -> 'entity_type', 'parent_id', p_row -> 'parent_id', 'sort_order', p_row -> 'sort_order',
                                           'asset_id', p_row -> 'asset_id', 'scene_id', p_row -> 'scene_id', 'shot_id', p_row -> 'shot_id',
                                           'level_id', p_row -> 'level_id', 'experience_id', p_row -> 'experience_id')
    WHEN 'scenes' THEN jsonb_build_object('name', p_row -> 'name', 'number', p_row -> 'scene_number', 'status', p_row -> 'status', 'sort_order', p_row -> 'sort_order')
    WHEN 'shots' THEN jsonb_build_object('name', p_row -> 'name', 'number', p_row -> 'shot_number', 'scene_id', p_row -> 'scene_id', 'status', p_row -> 'status', 'sort_order', p_row -> 'sort_order')
    WHEN 'levels' THEN jsonb_build_object('name', p_row -> 'name', 'status', p_row -> 'status', 'sort_order', p_row -> 'sort_order')
    WHEN 'experiences' THEN jsonb_build_object('name', p_row -> 'name', 'status', p_row -> 'status', 'sort_order', p_row -> 'sort_order')
    WHEN 'task_items' THEN jsonb_build_object('task_id', p_row -> 'task_id', 'item_type', p_row -> 'entity_type', 'item_id', p_row -> 'entity_id', 'position', p_row -> 'position')
    -- 0129 (MO3): a note's title, tier and trash, never its body or its preview; a typed tag's words, type, tier, what it
    -- stands for and whether retired; an assignment's tag, thing and tier; a link's two ends, its words and how it came.
    WHEN 'notes' THEN jsonb_build_object('title', p_row -> 'title', 'tier', p_row -> 'tier',
                                         'in_trash', CASE WHEN jsonb_typeof(p_row -> 'deleted_at') = 'string' THEN 'true'::jsonb END)
    WHEN 'moth_tags' THEN jsonb_build_object('label', p_row -> 'label', 'type_id', p_row -> 'type_id', 'tier', p_row -> 'tier',
                                             'canonical_id', p_row -> 'canonical_id',
                                             'retired', CASE WHEN jsonb_typeof(p_row -> 'retired_at') = 'string' THEN 'true'::jsonb END)
    WHEN 'moth_tag_assignments' THEN jsonb_build_object('tag_id', p_row -> 'tag_id', 'target_type', p_row -> 'target_type',
                                                        'target_id', p_row -> 'target_id', 'tier', p_row -> 'tier')
    WHEN 'moth_relationships' THEN jsonb_build_object('source_type', p_row -> 'source_type', 'source_id', p_row -> 'source_id',
                                                      'dest_type', p_row -> 'dest_type', 'dest_id', p_row -> 'dest_id',
                                                      'label', p_row -> 'label', 'origin', p_row -> 'origin')
  END;
  IF r IS NULL THEN
    RAISE EXCEPTION 'moth_history_project: no map for %', p_table;
  END IF;
  FOR e IN SELECT x.key, x.value FROM jsonb_each(jsonb_strip_nulls(r)) x LOOP
    v := e.value;
    IF jsonb_typeof(v) = 'string' AND length(v #>> '{}') > 300 THEN
      v := to_jsonb(left(v #>> '{}', 300));
      v_cut := true;
    ELSIF jsonb_typeof(v) = 'array' AND jsonb_array_length(v) > 200 THEN
      v := (SELECT jsonb_agg(a.x ORDER BY a.o) FROM jsonb_array_elements(v) WITH ORDINALITY a(x, o) WHERE a.o <= 200);
      v_cut := true;
    END IF;
    v_out := v_out || jsonb_build_object(e.key, v);
  END LOOP;
  -- Each pass cuts harder, and the last leaves nothing that can be too long.
  FOREACH n IN ARRAY ARRAY[20, 5, 0] LOOP
    EXIT WHEN octet_length(v_out::text) <= 4000;
    v_cut := true;
    FOR e IN SELECT x.key, x.value FROM jsonb_each(v_out) x LOOP
      IF jsonb_typeof(e.value) = 'array' AND jsonb_array_length(e.value) > n THEN
        v_out := CASE WHEN n = 0 THEN v_out - e.key ELSE v_out || jsonb_build_object(e.key,
          (SELECT jsonb_agg(a.x ORDER BY a.o) FROM jsonb_array_elements(e.value) WITH ORDINALITY a(x, o) WHERE a.o <= n)) END;
      ELSIF jsonb_typeof(e.value) = 'string' AND n < 20 AND e.key !~ '_id$' AND length(e.value #>> '{}') > GREATEST(n * 8, 8) THEN
        v_out := v_out || jsonb_build_object(e.key, left(e.value #>> '{}', GREATEST(n * 8, 8)));
      END IF;
    END LOOP;
  END LOOP;
  IF v_cut THEN
    v_out := v_out || '{"truncated": true}'::jsonb;
  END IF;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.moth_history_project(text, jsonb) FROM PUBLIC, anon, authenticated;

-- §4 The capture -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_moth_history_capture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_t      text := TG_TABLE_NAME;
  v_old    jsonb;
  v_new    jsonb;
  v_ws     uuid;
  v_id     uuid;
  v_pp     uuid;
  v_sp     uuid;
  v_pc     text;
  v_sc     text;
  v_po     uuid;
  v_so     uuid;
  v_prior  jsonb;
  v_state  jsonb;
  v_action text;
  v_locked boolean := false;
  v_gone   boolean := false;
  v_keys   text[];
  -- 0129 (MO3): a Session 3 row's sides come from _moth_history_s3_side, with their peers.
  v_s3     boolean := false;
  v_ppp    uuid;
  v_ppc    text;
  v_ppo    uuid;
  v_spp    uuid;
  v_spc    text;
  v_spo    uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old := to_jsonb(OLD);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new := to_jsonb(NEW);
  END IF;
  v_id := (COALESCE(v_new, v_old) ->> 'id')::uuid;
  IF v_t IN ('notes', 'moth_tags', 'moth_tag_assignments', 'moth_relationships') THEN
    v_s3 := true;
  ELSIF v_t = 'projects' THEN
    v_pp := (v_old ->> 'id')::uuid;
    v_sp := (v_new ->> 'id')::uuid;
  ELSE
    v_pp := (v_old ->> 'project_id')::uuid;
    v_sp := (v_new ->> 'project_id')::uuid;
  END IF;

  -- A child of a project that has gone: nobody can ever read a new row about it, because a side needs
  -- its project to pass the gate, so writing one is only cost (a purge of 50,000 files). And a phase
  -- would need a company from the caller's claims, which may name another or not parse at all. A file
  -- or a folder still goes through the lock below: it may have older rows on a side in another project.
  IF TG_OP = 'DELETE' AND NOT v_s3 AND v_t <> 'projects' AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = v_pp) THEN
    IF v_t NOT IN ('files', 'folders') THEN
      RETURN NULL;
    END IF;
    v_gone := true;
  END IF;
  -- Phases have no workspace of their own. Never the caller's: a row belongs to its project's company.
  v_ws := (COALESCE(v_new, v_old) ->> 'workspace_id')::uuid;
  IF v_ws IS NULL THEN
    SELECT p.workspace_id INTO v_ws FROM public.projects p WHERE p.id = COALESCE(v_sp, v_pp);
  END IF;
  -- A company being deleted: its rows go with it, and nothing is left to record against.
  IF v_ws IS NULL OR NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = v_ws) THEN
    RETURN NULL;
  END IF;

  IF v_s3 THEN
    SELECT s.o_project, s.o_class, s.o_owner, s.o_peer_project, s.o_peer_class, s.o_peer_owner
      INTO v_pp, v_pc, v_po, v_ppp, v_ppc, v_ppo FROM public._moth_history_s3_side(v_t, v_old) s;
    SELECT s.o_project, s.o_class, s.o_owner, s.o_peer_project, s.o_peer_class, s.o_peer_owner
      INTO v_sp, v_sc, v_so, v_spp, v_spc, v_spo FROM public._moth_history_s3_side(v_t, v_new) s;
  ELSE
    SELECT a.o_class, a.o_owner INTO v_pc, v_po FROM public._moth_history_audience(v_t, v_old, v_pp) a;
    SELECT a.o_class, a.o_owner INTO v_sc, v_so FROM public._moth_history_audience(v_t, v_new, v_sp) a;
  END IF;

  BEGIN
    -- Money and Legal stay out of Moth for every role, even after a trash or a purge. A locked side
    -- writes nothing, and every earlier row of the entity goes blank. Money-ness only grows.
    IF v_t = 'files' THEN
      IF v_old IS NOT NULL THEN
        v_locked := v_locked OR COALESCE(public.moth_file_row_locked(v_ws, v_pp, v_id, (v_old ->> 'is_financial')::boolean, v_old ->> 'storage_path',
          CASE WHEN jsonb_typeof(v_old -> 'tags') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(v_old -> 'tags')) END,
          (v_old ->> 'folder_id')::uuid), false);
      END IF;
      IF v_new IS NOT NULL THEN
        v_locked := v_locked OR COALESCE(public.moth_file_row_locked(v_ws, v_sp, v_id, (v_new ->> 'is_financial')::boolean, v_new ->> 'storage_path',
          CASE WHEN jsonb_typeof(v_new -> 'tags') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(v_new -> 'tags')) END,
          (v_new ->> 'folder_id')::uuid), false);
      END IF;
    ELSIF v_t = 'folders' THEN
      v_locked := public._moth_history_folder_locked(v_ws, v_old) OR public._moth_history_folder_locked(v_ws, v_new);
    END IF;
    IF v_locked THEN
      UPDATE public.moth_history h
         SET prior = NULL, state = NULL, locked = true
       WHERE h.workspace_id = v_ws AND h.entity_type = v_t AND h.entity_id = v_id AND NOT h.locked
         AND h.action <> 'mark_recording';
      RETURN NULL;
    END IF;
    IF v_gone THEN
      RETURN NULL;
    END IF;

    v_prior := public.moth_history_project(v_t, v_old);
    v_state := public.moth_history_project(v_t, v_new);

    v_keys := CASE v_t
      WHEN 'files' THEN ARRAY['project_id', 'folder_id']
      WHEN 'folders' THEN ARRAY['project_id', 'parent_id']
      WHEN 'phases' THEN ARRAY['parent_phase_id']
      WHEN 'assets' THEN ARRAY['phase_id']
      WHEN 'tasks' THEN ARRAY['phase_id', 'asset_id']
      WHEN 'shots' THEN ARRAY['scene_id']
      -- 0129: a fold or a merge moves an assignment to another tag, and a tag to the one it now stands for.
      WHEN 'moth_tag_assignments' THEN ARRAY['tag_id']
      WHEN 'moth_tags' THEN ARRAY['canonical_id']
      ELSE '{}'::text[]
    END;
    v_action := CASE
      WHEN TG_OP = 'INSERT' THEN 'create'
      WHEN TG_OP = 'DELETE' THEN 'delete'
      WHEN v_old ->> 'deleted_at' IS NULL AND v_new ->> 'deleted_at' IS NOT NULL THEN 'trash'
      WHEN v_old ->> 'deleted_at' IS NOT NULL AND v_new ->> 'deleted_at' IS NULL THEN 'restore'
      WHEN EXISTS (SELECT 1 FROM unnest(v_keys) k WHERE v_old -> k IS DISTINCT FROM v_new -> k) THEN 'move'
      ELSE 'update'
    END;

    -- The WHEN lists hold what classification needs as well as what is stored, so an update can
    -- come here with nothing to say. Only an update: a trash, a restore and a move always speak.
    IF v_action = 'update'
       AND v_prior IS NOT DISTINCT FROM v_state
       AND NOT COALESCE(v_state ? 'truncated', false)
       AND v_pp IS NOT DISTINCT FROM v_sp
       AND v_pc IS NOT DISTINCT FROM v_sc
       AND v_po IS NOT DISTINCT FROM v_so
       AND v_ppp IS NOT DISTINCT FROM v_spp
       AND v_ppc IS NOT DISTINCT FROM v_spc
       AND v_ppo IS NOT DISTINCT FROM v_spo THEN
      RETURN NULL;
    END IF;

    INSERT INTO public.moth_history
      (workspace_id, entity_type, entity_id, action, actor_user_id,
       prior_project_id, prior_class, prior_owner_id, prior,
       state_project_id, state_class, state_owner_id, state,
       prior_peer_project_id, prior_peer_class, prior_peer_owner_id,
       state_peer_project_id, state_peer_class, state_peer_owner_id)
    VALUES
      (v_ws, v_t, v_id, v_action, auth.uid(),
       v_pp, v_pc, v_po, v_prior,
       v_sp, v_sc, v_so, v_state,
       v_ppp, v_ppc, v_ppo,
       v_spp, v_spc, v_spo);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'moth_history capture failed on % %: %', v_t, v_id, SQLERRM;
    BEGIN
      INSERT INTO public.moth_history
        (workspace_id, entity_type, entity_id, action, mark_kind,
         prior_project_id, prior_class, prior_owner_id,
         state_project_id, state_class, state_owner_id)
      VALUES
        (v_ws, v_t, v_ws, 'mark_recording', 'capture_failed',
         v_pp, v_pc, v_po,
         v_sp, v_sc, v_so);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'moth_history could not mark the restart: %', SQLERRM;
    END;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_moth_history_capture() FROM PUBLIC, anon, authenticated;

-- §5 Reading -----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._moth_history_entity_visible(p_ws uuid, p_type text, p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_project uuid;
  v_found   boolean;
  v_row     record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.moth_history h
              WHERE h.workspace_id = p_ws AND h.entity_type = p_type AND h.entity_id = p_id AND h.locked) THEN
    RETURN false;
  END IF;
  IF p_type = 'projects' THEN
    IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_id) THEN
      RETURN true;
    END IF;
    RETURN COALESCE(public._moth_target_eligible('project', p_id, false), false);
  ELSIF p_type = 'files' THEN
    IF NOT EXISTS (SELECT 1 FROM public.files f WHERE f.id = p_id) THEN
      RETURN true;
    END IF;
    RETURN COALESCE(public._moth_target_eligible('file', p_id, true), false);
  ELSIF p_type = 'folders' THEN
    IF NOT EXISTS (SELECT 1 FROM public.folders fo WHERE fo.id = p_id) THEN
      RETURN true;
    END IF;
    RETURN COALESCE(public._moth_target_eligible('folder', p_id, true), false);
  -- 0129 (MO3): a note by Moth's gate (in the trash too); a typed tag to the company or its owner (a folded one
  -- too, which the gate no longer draws); an assignment by its tier and its thing's gate; a link by both ends'.
  ELSIF p_type = 'notes' THEN
    IF NOT EXISTS (SELECT 1 FROM public.notes n WHERE n.id = p_id) THEN
      RETURN true;
    END IF;
    RETURN COALESCE(public._moth_target_eligible('note', p_id, true), false);
  ELSIF p_type = 'moth_tags' THEN
    SELECT t.tier, t.owner_id, t.workspace_id INTO v_row FROM public.moth_tags t WHERE t.id = p_id;
    IF NOT FOUND THEN
      RETURN true;
    END IF;
    RETURN v_row.workspace_id = p_ws AND (v_row.tier = 'company' OR v_row.owner_id = auth.uid());
  ELSIF p_type = 'moth_tag_assignments' THEN
    SELECT a.tier, a.owner_id, a.target_type, a.target_id INTO v_row FROM public.moth_tag_assignments a WHERE a.id = p_id;
    IF NOT FOUND THEN
      RETURN true;
    END IF;
    RETURN (v_row.tier = 'company' OR v_row.owner_id = auth.uid())
       AND COALESCE(public._moth_target_eligible(v_row.target_type, v_row.target_id, false), false);
  ELSIF p_type = 'moth_relationships' THEN
    SELECT r.source_type, r.source_id, r.dest_type, r.dest_id INTO v_row FROM public.moth_relationships r WHERE r.id = p_id;
    IF NOT FOUND THEN
      RETURN true;
    END IF;
    RETURN COALESCE(public._moth_target_eligible(v_row.source_type, v_row.source_id, false), false)
       AND COALESCE(public._moth_target_eligible(v_row.dest_type, v_row.dest_id, false), false);
  END IF;
  EXECUTE format('SELECT x.project_id, true FROM public.%I x WHERE x.id = $1', p_type) INTO v_project, v_found USING p_id;
  IF NOT COALESCE(v_found, false) THEN
    RETURN true;
  END IF;
  RETURN COALESCE(public._moth_target_eligible('project', v_project, false), false);
END;
$$;
REVOKE ALL ON FUNCTION public._moth_history_entity_visible(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.moth_history_read(
  p_scope_project uuid DEFAULT NULL,
  p_since         timestamptz DEFAULT NULL,
  p_after         uuid DEFAULT NULL,
  p_limit         integer DEFAULT 1000)
RETURNS TABLE (
  row_key uuid, entity_type text, entity_id uuid, action text, observed_at timestamptz, actor_user_id uuid,
  prior_project_id uuid, prior jsonb, state_project_id uuid, state jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
#variable_conflict use_column
DECLARE
  v_uid      uuid := auth.uid();
  v_ws       uuid := public.current_workspace_id();
  v_admin    boolean := public.current_app_role() = 'admin';
  v_limit    integer := LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 5000);
  v_since    timestamptz := GREATEST(COALESCE(p_since, '-infinity'::timestamptz), now() - interval '90 days');
  v_after_at timestamptz;
  v_after_id bigint;
  v_batch    CONSTANT integer := 2000;
  v_ids      bigint[];
  v_got      integer;
BEGIN
  IF v_uid IS NULL OR v_ws IS NULL OR NOT COALESCE(public.has_active_membership(v_ws), false) THEN
    RAISE EXCEPTION 'that history is not available' USING ERRCODE = '42501';
  END IF;
  IF p_scope_project IS NOT NULL AND NOT COALESCE(public._moth_target_eligible('project', p_scope_project, false), false) THEN
    RAISE EXCEPTION 'that history is not available' USING ERRCODE = '42501';
  END IF;
  IF p_after IS NOT NULL THEN
    SELECT h.observed_at, h.id INTO v_after_at, v_after_id FROM public.moth_history h WHERE h.workspace_id = v_ws AND h.row_key = p_after;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'that history is not available' USING ERRCODE = '42501';
    END IF;
  END IF;

  LOOP
  v_ids := ARRAY(
    SELECT h.id
      FROM public.moth_history h
     WHERE h.workspace_id = v_ws
       AND h.action <> 'mark_recording'
       AND NOT h.locked
       AND h.observed_at >= v_since
       AND (v_after_id IS NULL OR (h.observed_at, h.id) < (v_after_at, v_after_id))
       AND (p_scope_project IS NULL OR h.prior_project_id = p_scope_project OR h.state_project_id = p_scope_project)
     ORDER BY h.observed_at DESC, h.id DESC
     LIMIT v_batch);
  EXIT WHEN cardinality(v_ids) = 0;

  RETURN QUERY
  WITH cand AS MATERIALIZED (
    SELECT h.* FROM public.moth_history h WHERE h.id = ANY (v_ids)
  ), proj AS MATERIALIZED (
    SELECT x.p, COALESCE(public._moth_target_eligible('project', x.p, false), false) AS ok
      FROM (SELECT c.prior_project_id AS p FROM cand c WHERE c.prior_project_id IS NOT NULL
            UNION
            SELECT c.state_project_id FROM cand c WHERE c.state_project_id IS NOT NULL
            -- 0129 (MO3): and the peers' projects, each asked once.
            UNION
            SELECT c.prior_peer_project_id FROM cand c WHERE c.prior_peer_project_id IS NOT NULL
            UNION
            SELECT c.state_peer_project_id FROM cand c WHERE c.state_peer_project_id IS NOT NULL) x
  ), ent AS MATERIALIZED (
    SELECT e.entity_type AS et, e.entity_id AS eid, public._moth_history_entity_visible(v_ws, e.entity_type, e.entity_id) AS ok
      FROM (SELECT DISTINCT c.entity_type, c.entity_id FROM cand c) e
  ), sided AS (
    SELECT c.*,
           -- 0129 (MO3): a side shows when its audience passes and its peer's does too. A side with no project is the
           -- company's ('workspace': every active member's, and the read is theirs only) or one person's ('personal');
           -- a side with one asks Moth's gate of it, as before.
           ((CASE WHEN c.prior_project_id IS NULL THEN c.prior_class IN ('workspace', 'personal') ELSE COALESCE(pp.ok, false) END AND CASE c.prior_class
              WHEN 'shared' THEN true
              WHEN 'private' THEN c.prior_owner_id = v_uid OR v_admin
              WHEN 'personal' THEN c.prior_owner_id = v_uid
              WHEN 'workspace' THEN true
              ELSE false END)
            AND (c.prior_peer_class IS NULL OR (CASE WHEN c.prior_peer_project_id IS NULL THEN c.prior_peer_class IN ('workspace', 'personal') ELSE COALESCE(ppp.ok, false) END AND CASE c.prior_peer_class
              WHEN 'shared' THEN true
              WHEN 'private' THEN c.prior_peer_owner_id = v_uid OR v_admin
              WHEN 'personal' THEN c.prior_peer_owner_id = v_uid
              WHEN 'workspace' THEN true
              ELSE false END))) IS TRUE AS prior_ok,
           ((CASE WHEN c.state_project_id IS NULL THEN c.state_class IN ('workspace', 'personal') ELSE COALESCE(sp.ok, false) END AND CASE c.state_class
              WHEN 'shared' THEN true
              WHEN 'private' THEN c.state_owner_id = v_uid OR v_admin
              WHEN 'personal' THEN c.state_owner_id = v_uid
              WHEN 'workspace' THEN true
              ELSE false END)
            AND (c.state_peer_class IS NULL OR (CASE WHEN c.state_peer_project_id IS NULL THEN c.state_peer_class IN ('workspace', 'personal') ELSE COALESCE(spp.ok, false) END AND CASE c.state_peer_class
              WHEN 'shared' THEN true
              WHEN 'private' THEN c.state_peer_owner_id = v_uid OR v_admin
              WHEN 'personal' THEN c.state_peer_owner_id = v_uid
              WHEN 'workspace' THEN true
              ELSE false END))) IS TRUE AS state_ok
      FROM cand c
      JOIN ent e ON e.et = c.entity_type AND e.eid = c.entity_id AND e.ok
      LEFT JOIN proj pp ON pp.p = c.prior_project_id
      LEFT JOIN proj sp ON sp.p = c.state_project_id
      LEFT JOIN proj ppp ON ppp.p = c.prior_peer_project_id
      LEFT JOIN proj spp ON spp.p = c.state_peer_project_id
  )
  SELECT s.row_key, s.entity_type, s.entity_id,
         CASE
           WHEN s.prior_ok AND s.state_ok THEN CASE s.action
             WHEN 'update' THEN 'changed' WHEN 'move' THEN 'moved' WHEN 'trash' THEN 'trashed' WHEN 'restore' THEN 'restored' END
           WHEN s.state_ok THEN 'added'
           ELSE 'removed'
         END,
         s.observed_at, s.actor_user_id,
         CASE WHEN s.prior_ok THEN s.prior_project_id END,
         CASE WHEN s.prior_ok THEN s.prior END,
         CASE WHEN s.state_ok THEN s.state_project_id END,
         CASE WHEN s.state_ok THEN s.state END
    FROM sided s
   WHERE s.prior_ok OR s.state_ok
   ORDER BY s.observed_at DESC, s.id DESC
   LIMIT v_limit;
  GET DIAGNOSTICS v_got = ROW_COUNT;
  v_limit := v_limit - v_got;
  EXIT WHEN v_limit <= 0 OR cardinality(v_ids) < v_batch;
  v_after_id := v_ids[v_batch];
  SELECT h.observed_at INTO v_after_at FROM public.moth_history h WHERE h.id = v_after_id;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.moth_history_read(uuid, timestamptz, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moth_history_read(uuid, timestamptz, uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.moth_history_window(p_scope_project uuid DEFAULT NULL)
RETURNS TABLE (entity_type text, project_id uuid, recording_since timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
#variable_conflict use_column
DECLARE
  v_uid     uuid := auth.uid();
  v_ws      uuid := public.current_workspace_id();
  v_admin   boolean := public.current_app_role() = 'admin';
  v_created timestamptz;
BEGIN
  IF v_uid IS NULL OR v_ws IS NULL OR NOT COALESCE(public.has_active_membership(v_ws), false) THEN
    RAISE EXCEPTION 'that history is not available' USING ERRCODE = '42501';
  END IF;
  IF p_scope_project IS NOT NULL AND NOT COALESCE(public._moth_target_eligible('project', p_scope_project, false), false) THEN
    RAISE EXCEPTION 'that history is not available' USING ERRCODE = '42501';
  END IF;
  SELECT w.created_at INTO v_created FROM public.workspaces w WHERE w.id = v_ws;

  RETURN QUERY
  WITH types AS (
    -- 0129 (MO3): and the four Session 3 tables, recorded from this file (a company made later from its own day).
    SELECT t.t FROM unnest(ARRAY['projects', 'phases', 'assets', 'tasks', 'files', 'folders', 'scenes', 'shots', 'levels', 'experiences', 'task_items',
                                 'notes', 'moth_tags', 'moth_tag_assignments', 'moth_relationships']) AS t(t)
    UNION
    SELECT h.entity_type FROM public.moth_history h WHERE h.workspace_id = v_ws AND h.action = 'mark_recording' AND h.mark_kind = 'baseline'
  ), base AS (
    SELECT ty.t,
           GREATEST((SELECT max(h.observed_at) FROM public.moth_history h
                      WHERE h.workspace_id = v_ws AND h.entity_type = ty.t AND h.action = 'mark_recording' AND h.mark_kind IN ('baseline', 'suspended')),
                    v_created, now() - interval '90 days') AS since
      FROM types ty
  ), restarts AS (
    SELECT h.entity_type AS t, s.project, max(h.observed_at) AS at
      FROM public.moth_history h,
           LATERAL (VALUES (h.prior_project_id, h.prior_class, h.prior_owner_id),
                           (h.state_project_id, h.state_class, h.state_owner_id)) AS s(project, class, owner)
     WHERE h.workspace_id = v_ws
       AND h.action = 'mark_recording'
       AND h.mark_kind = 'capture_failed'
       AND s.project IS NOT NULL
       AND (p_scope_project IS NULL OR s.project = p_scope_project)
       AND (CASE s.class
              WHEN 'shared' THEN true
              WHEN 'private' THEN s.owner = v_uid OR v_admin
              WHEN 'personal' THEN s.owner = v_uid
              ELSE false END) IS TRUE
       AND COALESCE(public._moth_target_eligible('project', s.project, false), false)
     GROUP BY 1, 2
  )
  SELECT b.t, NULL::uuid, b.since FROM base b
  UNION ALL
  SELECT r.t, r.project, r.at FROM restarts r JOIN base b ON b.t = r.t WHERE r.at > b.since
  ORDER BY 1, 2 NULLS FIRST;
END;
$$;
REVOKE ALL ON FUNCTION public.moth_history_window(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moth_history_window(uuid) TO authenticated, service_role;

-- §6 The four tables' triggers -----------------------------------------------------------------
CREATE OR REPLACE TRIGGER trg_notes_moth_history
  AFTER INSERT OR DELETE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_notes_moth_history_upd
  AFTER UPDATE ON public.notes
  FOR EACH ROW
  WHEN (ROW(OLD.title, OLD.tier, OLD.owner_id, OLD.deleted_at) IS DISTINCT FROM ROW(NEW.title, NEW.tier, NEW.owner_id, NEW.deleted_at))
  EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_moth_tags_moth_history
  AFTER INSERT OR DELETE ON public.moth_tags
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_moth_tags_moth_history_upd
  AFTER UPDATE ON public.moth_tags
  FOR EACH ROW
  WHEN (ROW(OLD.label, OLD.type_id, OLD.tier, OLD.owner_id, OLD.canonical_id, OLD.retired_at)
        IS DISTINCT FROM ROW(NEW.label, NEW.type_id, NEW.tier, NEW.owner_id, NEW.canonical_id, NEW.retired_at))
  EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_moth_tag_assignments_moth_history
  AFTER INSERT OR DELETE ON public.moth_tag_assignments
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_moth_tag_assignments_moth_history_upd
  AFTER UPDATE ON public.moth_tag_assignments
  FOR EACH ROW
  WHEN (OLD.tag_id IS DISTINCT FROM NEW.tag_id)
  EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_moth_relationships_moth_history
  AFTER INSERT OR DELETE ON public.moth_relationships
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_moth_relationships_moth_history_upd
  AFTER UPDATE ON public.moth_relationships
  FOR EACH ROW
  WHEN (OLD.label IS DISTINCT FROM NEW.label)
  EXECUTE FUNCTION public.fn_moth_history_capture();

-- §7 When recording began, for the four ---------------------------------------------------------
INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, mark_kind)
SELECT w.id, t.t, w.id, 'mark_recording', 'baseline'
  FROM public.workspaces w
  CROSS JOIN unnest(ARRAY['notes', 'moth_tags', 'moth_tag_assignments', 'moth_relationships']) AS t(t)
 WHERE NOT EXISTS (SELECT 1 FROM public.moth_history m
                    WHERE m.workspace_id = w.id AND m.entity_type = t.t AND m.action = 'mark_recording' AND m.mark_kind = 'baseline');

COMMENT ON FUNCTION public._moth_history_s3_side(text, jsonb) IS
  '0129 (MO3): one side of a note, a typed tag, a tag''s assignment or a link as moth_history keeps it: its audience (personal with its owner, the company''s as workspace, or a project''s class) and, for an assignment or a link, its peer''s.';

-- §8 Post-conditions ---------------------------------------------------------------
DO $$
DECLARE
  v_fn RECORD;
  v_t  TEXT;
BEGIN
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public._moth_history_end(text,uuid)', 'dbbd4a0eacb608b1fba6de16b2b703a8'),
      ('public._moth_history_s3_side(text,jsonb)', '0e3e4f9f2eb642dfcc2e3cb3ca8e5aeb'),
      ('public.moth_history_projection_ok(jsonb)', '63de72c284cc1745453e4a11e3738db9'),
      ('public.moth_history_project(text,jsonb)', '7009ba0e9014e99e4545dc713dedc333'),
      ('public.fn_moth_history_capture()', 'c7ad57ac2c1a9b46528b7e98a6dc44ec'),
      ('public._moth_history_entity_visible(uuid,text,uuid)', 'e8f5e5f573df3ce80877c9fb7777518d'),
      ('public.moth_history_read(uuid,timestamptz,uuid,integer)', 'e1ef26552d81dd2eb102aaf87c1f9425'),
      ('public.moth_history_window(uuid)', '91807b644a8f10ab1e9807f9842eefe3')
    ) AS t(sig, now_is)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn.sig::regprocedure AND md5(replace(prosrc, chr(13), '')) = v_fn.now_is) THEN
      RAISE EXCEPTION '0129 post-condition: % is not this file''s', v_fn.sig;
    END IF;
  END LOOP;
  -- The definers keep 0119's settings: their path, and row security off.
  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE oid IN ('public._moth_history_end(text,uuid)'::regprocedure, 'public._moth_history_s3_side(text,jsonb)'::regprocedure,
                            'public.fn_moth_history_capture()'::regprocedure, 'public._moth_history_entity_visible(uuid,text,uuid)'::regprocedure,
                            'public.moth_history_read(uuid,timestamptz,uuid,integer)'::regprocedure,
                            'public.moth_history_window(uuid)'::regprocedure)
                AND (NOT prosecdef OR proconfig::text IS DISTINCT FROM '{"search_path=public, pg_temp",row_security=off}')) THEN
    RAISE EXCEPTION '0129 post-condition: a definer of the record runs as the wrong role or path';
  END IF;
  IF has_function_privilege('authenticated', 'public._moth_history_s3_side(text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._moth_history_end(text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.moth_history_read(uuid,timestamptz,uuid,integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.moth_history_read(uuid,timestamptz,uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '0129 post-condition: the record''s functions have the wrong grants';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.moth_history'::regclass AND contype = 'c' AND convalidated) <> 7 THEN
    RAISE EXCEPTION '0129 post-condition: moth_history''s seven checks are not all validated';
  END IF;
  FOREACH v_t IN ARRAY ARRAY['notes', 'moth_tags', 'moth_tag_assignments', 'moth_relationships'] LOOP
    IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = ('public.' || v_t)::regclass AND tgname IN ('trg_' || v_t || '_moth_history', 'trg_' || v_t || '_moth_history_upd')
          AND tgfoid = 'public.fn_moth_history_capture()'::regprocedure AND tgenabled = 'O') <> 2 THEN
      RAISE EXCEPTION '0129 post-condition: % is not recorded', v_t;
    END IF;
    IF EXISTS (SELECT 1 FROM public.workspaces w
                WHERE NOT EXISTS (SELECT 1 FROM public.moth_history m
                                   WHERE m.workspace_id = w.id AND m.entity_type = v_t AND m.action = 'mark_recording' AND m.mark_kind = 'baseline')) THEN
      RAISE EXCEPTION '0129 post-condition: a company has no mark for %', v_t;
    END IF;
  END LOOP;
  -- What a note's record may hold: its title, tier and trash, never its body.
  IF public.moth_history_project('notes', '{"title": "t", "tier": "shared", "ydoc_state": "x", "body_preview": "y"}'::jsonb)
       IS DISTINCT FROM '{"title": "t", "tier": "shared"}'::jsonb THEN
    RAISE EXCEPTION '0129 post-condition: a note''s record holds more than its title and tier';
  END IF;
  RAISE NOTICE '0129 OK';
END $$;
