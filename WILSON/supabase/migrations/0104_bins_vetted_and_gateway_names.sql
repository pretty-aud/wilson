-- =============================================================================
-- 0104_bins_vetted_and_gateway_names.sql — P8, night 5 of
-- docs/sessions/PLAN_TO_1_0.md (2026-10-28): Phase 8 of
-- TPN_AUDIT/REMEDIATION_PLAN.md, two findings' database halves.
--
-- TPN-AUTH-012 — the file gateway served any path a member catalogued.
--   0091 lets anyone past can_edit_shot_lists (admins, managers, and every
--   member and REVIEWER seated on the project, B6) insert a bin_files row
--   naming any relative path under any of the company's locations, and name
--   a location (D8); the gateway then opened the file with its own service
--   account, through the office door or (switch on) the outside door, past
--   every folder permission on the share. Her ruling of 2026-10-28 (Q1 (a)):
--   fixed before the release. B6 and D8 are her design picks (suite 93 pins a
--   reviewer adding a clip and naming a location, lives_ok), so the writes
--   stay and gain A MARK the gateway requires:
--
--   * bin_files.vetted_at / vetted_by and bin_locations.vetted_at / vetted_by
--     ("checked for the file gateway"). A CLIENT never chooses the mark: the
--     BEFORE triggers below decide it. A row a workspace ADMIN or MANAGER
--     (the LIVE workspace_members row, never the token's claim) inserts or
--     re-points is stamped; a row anyone else inserts or re-points inherits
--     the mark of a TWIN (the same project, the same location, the byte-equal
--     path: the same file, already checked, in a project the caller can see —
--     the lookup runs under the caller's own RLS) or has none. A mark set by
--     hand (an UPDATE of vetted_at) is a vetter's act: stamped now() and
--     auth.uid(), NULL withdraws it; anyone else is refused, 42501, with one
--     sentence. A non-client (postgres, the service role: a fixture, a future
--     operator tool) keeps what it supplies.
--   * gateway_sync_apply (0095 A3, restated whole; the diff is three places,
--     each marked "0104"): the D22 catalogue check confirms a clip only when
--     the row AND its location carry the mark, and the bin_locations list the
--     gateway is handed holds vetted locations only. Nothing else in the body
--     changed: the next root's slot and promotion, `gateway.root_replaced`,
--     `replaced_confirmed`, the reach check, the update check are 0095's, and
--     the post-conditions below demand their text again (the 0059 → 0062
--     lesson: a CREATE OR REPLACE that drops a guard is a privilege
--     escalation shipped by accident).
--   * gateway_clips_for_tickets (0093 §11, restated whole, still SECURITY
--     INVOKER): returns vetted rows at vetted locations only, so no ticket is
--     minted for an unchecked path and the mint log never names one.
--   NO BACKFILL (the plan's Fable round): `added_by` is client-suppliable
--   (fn_bin_files_touch fills it only when NULL; restore_bin_files keeps it,
--   B11), so a pre-existing reviewer's row could carry an admin's uuid.
--   Every existing row starts unchecked; an admin or manager marks the ones
--   that are theirs (the hand-off and the walkthrough say how many, where).
--   The gateway needs no change: a clip whose mark is withdrawn is refused
--   when its ten-minute confirmation expires (24 hours on the inside door
--   while the cloud is unreachable — catalogue.mjs's grace; HARDENING §5).
--   BUILD ROUND 1 (two findings, both in §3 and §3b): a vetter's COPY of a
--   reviewer's unchecked clip (copy_bin_files) or UNDO of its removal
--   (restore_bin_files) stamped the new row, nobody having looked at the
--   path — both now run with wilson.bins_mark = 'inherit', under which the
--   trigger treats a vetter's INSERT like anyone's (a checked twin's mark, or
--   none); and withdrawing a check withdraws it from EVERY row at that file
--   in the project (the twins that inherited, the copies), not the one row.
--
-- TPN-ENC-013 — the office-door certificate names private addresses.
--   The gateway's fix (names-only leaves) needs the browser to reach the
--   door BY NAME, and today nothing stores the names the gateway sends at
--   enrolment and at every sync (`inside_names`: its host name and that
--   name under .local). This file's half: gateways.inside_names, the
--   [{ host, port }] shape under gateway_inside_names_ok (0093's
--   gateway_inside_addresses_ok, and never a literal), cleaned by
--   gateway_clean_inside_names, stored by gateway_enrol_apply (0093 §14a,
--   restated whole; one line added) and gateway_sync_apply, exposed to a
--   member's browser by gateways_visible (0093 §12, restated; the new column
--   LAST, as CREATE OR REPLACE VIEW requires) and to an admin by the column
--   grant. An office FQDN (gw01.studio.lan) is not an inside name:
--   gateway_inside_host_ok admits one label, or that label under .local.
--
-- HOW IT IS APPLIED (the house way, never `supabase db push`): this file's
-- statements by `supabase db query --linked --file` from an LF copy, then,
-- in a second call, the history row (INSERT INTO
-- supabase_migrations.schema_migrations (version, name, statements) SELECT
-- '0104', 'bins_vetted_and_gateway_names', ARRAY[<this whole file>] WHERE NOT
-- EXISTS (… version = '0104')); md5(statements[1]) is the LF file's md5.
--
-- ORDERING — depends on: 0091 (the tables), 0093 (the gateway RPCs and the
-- view), 0095 (gateway_sync_apply's current body). Numbers: 0104 / suite 107
-- (0102 and suite 105 stay reserved for the avatars policy). Idempotent:
-- IF NOT EXISTS / OR REPLACE throughout; the CHECK is added under a
-- duplicate_object guard.
--
-- ROLLBACK (a reviewed reverse file, never by hand): drop trg_bin_files_vet,
-- trg_bin_locations_vet, fn_bin_files_vet, fn_bin_locations_vet,
-- bins_caller_may_vet and the four columns; restate gateway_sync_apply from
-- 0095 A3, gateway_enrol_apply from 0093 §14a, gateway_clips_for_tickets from
-- 0093 §11 and gateways_visible from 0093 §12 (the view must be DROPped and
-- re-created to lose a column); drop gateways.inside_names and its two
-- functions.
-- =============================================================================


-- =============================================================================
-- 0. PRE-FLIGHT — refuse to run on a target that lacks what this file restates
-- =============================================================================
DO $$
BEGIN
  IF to_regclass('public.bin_files') IS NULL OR to_regclass('public.bin_locations') IS NULL THEN
    RAISE EXCEPTION '0104 pre-flight failed: bin_files or bin_locations is missing — apply 0091 first';
  END IF;
  IF to_regprocedure('public.gateway_sync_apply(uuid,jsonb,inet,jsonb)') IS NULL
     OR pg_get_functiondef('public.gateway_sync_apply(uuid,jsonb,inet,jsonb)'::regprocedure) NOT LIKE '%replaced_confirmed%' THEN
    RAISE EXCEPTION '0104 pre-flight failed: gateway_sync_apply is not 0095''s body — apply 0095 first';
  END IF;
  IF to_regprocedure('public.gateway_enrol_apply(text,text,jsonb,inet,text)') IS NULL
     OR to_regprocedure('public.gateway_clips_for_tickets(uuid[])') IS NULL
     OR to_regprocedure('public.gateway_clean_inside_addresses(jsonb)') IS NULL
     OR to_regprocedure('public.gateway_inside_addresses_ok(jsonb)') IS NULL
     OR to_regclass('public.gateways_visible') IS NULL THEN
    RAISE EXCEPTION '0104 pre-flight failed: 0093''s gateway RPCs or view are missing — apply 0093 first';
  END IF;
END $$;


-- =============================================================================
-- 1. THE MARK — four columns
-- =============================================================================
ALTER TABLE public.bin_files
  ADD COLUMN IF NOT EXISTS vetted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vetted_by UUID;
ALTER TABLE public.bin_locations
  ADD COLUMN IF NOT EXISTS vetted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vetted_by UUID;

COMMENT ON COLUMN public.bin_files.vetted_at IS
  '0104 (TPN-AUTH-012): when a workspace admin or manager checked this row''s path for the file gateway, or NULL. Decided by trg_bin_files_vet, never by a client''s value: stamped for a vetter''s insert or re-point, inherited from a checked twin (same project, same location, the same path) otherwise, cleared when anyone else re-points the row; an UPDATE of this column by hand is a vetter''s mark (now()) or withdrawal (NULL) and is refused for anyone else. The gateway confirms and serves a clip only with it (gateway_sync_apply, gateway_clips_for_tickets).';
COMMENT ON COLUMN public.bin_files.vetted_by IS
  '0104: the admin or manager whose act set vetted_at (auth.uid()), or the twin''s; NULL with vetted_at.';
COMMENT ON COLUMN public.bin_locations.vetted_at IS
  '0104 (TPN-AUTH-012): when a workspace admin or manager checked this location for the file gateway, or NULL. Decided by trg_bin_locations_vet as bin_files.vetted_at is (stamped for a vetter''s insert or change of unc_path, cleared for anyone else''s; set or withdrawn by hand by a vetter only). The gateway is told vetted locations only.';
COMMENT ON COLUMN public.bin_locations.vetted_by IS
  '0104: the admin or manager whose act set vetted_at (auth.uid()); NULL with vetted_at.';


-- =============================================================================
-- 2. WHO MAY VET — the live row, never the token (0093 §1's shape)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.bins_caller_may_vet(p_workspace UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_workspace IS NOT NULL AND auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.workspace_id = p_workspace
       AND wm.user_id = auth.uid()
       AND wm.is_active
       AND wm.app_role IN ('admin', 'manager')
  );
$$;

REVOKE ALL ON FUNCTION public.bins_caller_may_vet(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bins_caller_may_vet(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.bins_caller_may_vet(UUID) IS
  '0104 (TPN-AUTH-012): true when the CALLER has a live, active workspace_members row as admin or manager of p_workspace — the row, never the token''s claim (0093 §1''s rule), so a demoted manager stops vetting at once. SECURITY DEFINER so the triggers can ask it whatever the caller may read; it answers only about the caller.';


-- =============================================================================
-- 3. THE TRIGGERS — the mark is decided here, by whoever writes the address
-- =============================================================================
-- Trigger order on each table is alphabetical: trg_bin_files_populate_workspace
-- (workspace_id from the project), trg_bin_files_touch (added_by, the
-- stamps), then trg_bin_files_vet — so NEW.workspace_id is set when this
-- runs. SECURITY INVOKER on purpose: the twin lookup runs under the caller's
-- own RLS (bin_files_select hops to the projects they can see), so a path
-- checked in a project the caller cannot see is never a twin.
-- The client test is the switch trigger's (0093 §4): a sign-in, or the
-- authenticated or anon role; anything else is postgres, the service role or
-- a migration and keeps what it supplies.

CREATE OR REPLACE FUNCTION public.fn_bin_files_vet()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_client  BOOLEAN := auth.uid() IS NOT NULL OR COALESCE(current_setting('role', true), '') IN ('authenticated', 'anon');
  v_may     BOOLEAN;
  v_moved   BOOLEAN;
  v_twin_at TIMESTAMPTZ;
  v_twin_by UUID;
  -- Round 1 (finding 1): 'inherit' while copy_bin_files or restore_bin_files
  -- runs (their SET clause, §3b): a vetter's INSERT there is no check.
  v_mode    TEXT := COALESCE(current_setting('wilson.bins_mark', true), '');
BEGIN
  IF NOT v_client THEN
    RETURN NEW;
  END IF;
  v_may := public.bins_caller_may_vet(NEW.workspace_id);
  v_moved := TG_OP = 'INSERT'
             OR NEW.location_id IS DISTINCT FROM OLD.location_id
             OR NEW.relative_path IS DISTINCT FROM OLD.relative_path;
  IF v_moved THEN
    -- A new address: decided afresh, whatever the client sent for the mark.
    -- A copy or an undo (v_mode 'inherit') takes a checked twin's mark or
    -- none, whoever makes it: nobody looked at the path.
    IF v_may AND v_mode <> 'inherit' THEN
      NEW.vetted_at := now();
      NEW.vetted_by := auth.uid();
    ELSE
      SELECT f.vetted_at, f.vetted_by INTO v_twin_at, v_twin_by
        FROM public.bin_files f
       WHERE f.project_id = NEW.project_id
         AND f.location_id = NEW.location_id
         AND f.relative_path = NEW.relative_path
         AND f.vetted_at IS NOT NULL
         AND f.id <> NEW.id
       ORDER BY f.vetted_at, f.id
       LIMIT 1;
      NEW.vetted_at := v_twin_at;  -- NULL when there is no checked twin
      NEW.vetted_by := v_twin_by;
    END IF;
    RETURN NEW;
  END IF;
  -- The address is unchanged: the mark changes only by a vetter's hand.
  IF NEW.vetted_at IS DISTINCT FROM OLD.vetted_at OR NEW.vetted_by IS DISTINCT FROM OLD.vetted_by THEN
    IF NOT v_may THEN
      RAISE EXCEPTION 'Only a workspace admin or manager can mark a clip as checked for the file gateway.'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.vetted_at IS NULL THEN
      NEW.vetted_by := NULL;
      -- Round 1 (finding 2): a check is withdrawn from the FILE, not the row:
      -- every other row at the same address in the same project (a twin that
      -- inherited, a copy) loses the mark with it, under the caller's own RLS.
      -- The transaction-local flag keeps the cascade from re-entering itself.
      IF OLD.vetted_at IS NOT NULL AND COALESCE(current_setting('wilson.bins_withdrawing', true), '') <> '1' THEN
        PERFORM set_config('wilson.bins_withdrawing', '1', true);
        UPDATE public.bin_files f
           SET vetted_at = NULL, vetted_by = NULL
         WHERE f.project_id = NEW.project_id
           AND f.location_id = NEW.location_id
           AND f.relative_path = NEW.relative_path
           AND f.id <> NEW.id
           AND f.vetted_at IS NOT NULL;
        PERFORM set_config('wilson.bins_withdrawing', '', true);
      END IF;
    ELSE
      NEW.vetted_at := now();
      NEW.vetted_by := auth.uid();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_bin_files_vet() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bin_files_vet ON public.bin_files;
CREATE TRIGGER trg_bin_files_vet
  BEFORE INSERT OR UPDATE ON public.bin_files
  FOR EACH ROW EXECUTE FUNCTION public.fn_bin_files_vet();

CREATE OR REPLACE FUNCTION public.fn_bin_locations_vet()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_client BOOLEAN := auth.uid() IS NOT NULL OR COALESCE(current_setting('role', true), '') IN ('authenticated', 'anon');
  v_may    BOOLEAN;
  v_moved  BOOLEAN;
BEGIN
  IF NOT v_client THEN
    RETURN NEW;
  END IF;
  v_may := public.bins_caller_may_vet(NEW.workspace_id);
  v_moved := TG_OP = 'INSERT' OR NEW.unc_path IS DISTINCT FROM OLD.unc_path;
  IF v_moved THEN
    -- A location has no twin: its address is unique per workspace (0091).
    IF v_may THEN
      NEW.vetted_at := now();
      NEW.vetted_by := auth.uid();
    ELSE
      NEW.vetted_at := NULL;
      NEW.vetted_by := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.vetted_at IS DISTINCT FROM OLD.vetted_at OR NEW.vetted_by IS DISTINCT FROM OLD.vetted_by THEN
    IF NOT v_may THEN
      RAISE EXCEPTION 'Only a workspace admin or manager can mark a footage location as checked for the file gateway.'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.vetted_at IS NULL THEN
      NEW.vetted_by := NULL;
    ELSE
      NEW.vetted_at := now();
      NEW.vetted_by := auth.uid();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_bin_locations_vet() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bin_locations_vet ON public.bin_locations;
CREATE TRIGGER trg_bin_locations_vet
  BEFORE INSERT OR UPDATE ON public.bin_locations
  FOR EACH ROW EXECUTE FUNCTION public.fn_bin_locations_vet();

COMMENT ON FUNCTION public.fn_bin_files_vet() IS
  '0104 (TPN-AUTH-012): BEFORE INSERT OR UPDATE on bin_files — decides vetted_at/vetted_by for a client''s write (a vetter''s insert or re-point is stamped; anyone else''s inherits a checked twin in the same project at the same location and byte-equal path, under the caller''s RLS, or has none; a hand-set mark is a vetter''s alone, 42501 otherwise). A non-client (postgres, the service role) keeps what it supplies.';
COMMENT ON FUNCTION public.fn_bin_locations_vet() IS
  '0104 (TPN-AUTH-012): BEFORE INSERT OR UPDATE on bin_locations — the same rule for a location (stamped for a vetter''s insert or change of unc_path, cleared for anyone else''s; a hand-set mark is a vetter''s alone).';


-- =============================================================================
-- 3b. copy_bin_files and restore_bin_files — restated whole (0091 §10m, §10n):
--     a copy is not a check, nor is an undo (build round 1, finding 1)
-- =============================================================================
-- A manager's copy of a reviewer's unchecked clip (a plain INSERT as the
-- caller) and an admin's undo of a removal used to STAMP the new row: the
-- vetter wrote the address, but nobody looked at the path. Each body below is
-- 0091's verbatim but for two lines, marked "0104 §3b": wilson.bins_mark set
-- to 'inherit' for the transaction before its loop and cleared after it,
-- under which fn_bin_files_vet (§3) treats a vetter's INSERT like anyone's —
-- a checked twin's mark at the same address in the same project, or none. A
-- client cannot set it: PostgREST runs one statement per transaction and
-- exposes no SET. (A SET clause on the function would be cleaner; the hosted
-- `postgres` role may not ALTER FUNCTION ... SET a custom parameter, as the
-- rehearsal on dev found.) The post-condition and suite 107 pin the line in
-- both bodies; a later restatement of either function must carry it.

-- ── 10m. copy_bin_files — an INSTANCE: a new row, same reference, its own
--         logging; it keeps its sibling's poster key (same project) ──────────
CREATE OR REPLACE FUNCTION public.copy_bin_files(p_ids UUID[], p_bin UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_order   INT;
  v_id      UUID;
  v_new     UUID;
  v_created UUID[] := '{}';
  src       public.bin_files%ROWTYPE;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RAISE EXCEPTION 'ids required' USING ERRCODE = '22023';
  END IF;
  IF p_bin IS NULL OR NOT EXISTS (SELECT 1 FROM public.bins b WHERE b.id = p_bin) THEN
    RAISE EXCEPTION 'bin not found' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(max(f.sort_order), -1) + 1 INTO v_order FROM public.bin_files f WHERE f.bin_id = p_bin;
  PERFORM set_config('wilson.bins_mark', 'inherit', true);  -- 0104 §3b: not a check
  FOREACH v_id IN ARRAY p_ids LOOP
    SELECT * INTO src FROM public.bin_files f WHERE f.id = v_id;
    IF src.id IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.bin_files (
      project_id, bin_id, location_id, relative_path, display_name, original_name, extension, mime_type,
      is_sequence, sequence_pattern, frame_count, size_bytes, mtime, media_type, tags,
      scene_id, shot_id, slate, take_number, take_modifier, camera, roll, shoot_day,
      description, notes, review_flag, circled, color,
      duration_sec, width, height, fps, codec, timecode_start, probe_status, sort_order, poster_path)
    VALUES (
      src.project_id, p_bin, src.location_id, src.relative_path, src.display_name, src.original_name, src.extension, src.mime_type,
      src.is_sequence, src.sequence_pattern, src.frame_count, src.size_bytes, src.mtime, src.media_type, src.tags,
      src.scene_id, src.shot_id, src.slate, src.take_number, src.take_modifier, src.camera, src.roll, src.shoot_day,
      src.description, src.notes, src.review_flag, src.circled, src.color,
      src.duration_sec, src.width, src.height, src.fps, src.codec, src.timecode_start, src.probe_status, v_order, src.poster_path)
    RETURNING id INTO v_new;
    v_created := array_append(v_created, v_new);
    v_order := v_order + 1;
    src := NULL;
  END LOOP;
  PERFORM set_config('wilson.bins_mark', '', true);  -- 0104 §3b
  RETURN jsonb_build_object('created', COALESCE((
    SELECT jsonb_agg(to_jsonb(f) ORDER BY array_position(v_created, f.id)) FROM public.bin_files f WHERE f.id = ANY(v_created)), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.copy_bin_files(UUID[], UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copy_bin_files(UUID[], UUID) TO authenticated, service_role;

-- ── 10n. restore_bin_files — the undo of a removal: the rows go back verbatim
--         (ids kept; who added them kept, B11). A row whose bin is gone is
--         REPORTED (bin_gone), as is one without an address (invalid) ────────
CREATE OR REPLACE FUNCTION public.restore_bin_files(p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  e          JSONB;
  v_id       UUID;
  v_bin      public.bins%ROWTYPE;
  v_loc      UUID;
  v_rel      TEXT;
  v_row      public.bin_files%ROWTYPE;
  v_restored JSONB := '[]'::jsonb;
  v_skipped  JSONB := '[]'::jsonb;
  v_tags     TEXT[];
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'rows required' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('wilson.bins_mark', 'inherit', true);  -- 0104 §3b: not a check
  FOR e IN SELECT x FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS y(x, ord) ORDER BY ord LOOP
    v_id := public.fn_bins_json_uuid(e -> 'id');
    v_loc := public.fn_bins_json_uuid(e -> 'location_id');
    v_rel := NULLIF(btrim(COALESCE(e ->> 'relative_path', '')), '');
    IF jsonb_typeof(e) <> 'object' OR v_id IS NULL OR v_loc IS NULL OR v_rel IS NULL
       OR NULLIF(btrim(COALESCE(e ->> 'display_name', '')), '') IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object('id', e ->> 'id', 'reason', 'invalid');
      CONTINUE;
    END IF;
    v_bin := NULL;
    SELECT * INTO v_bin FROM public.bins b WHERE b.id = public.fn_bins_json_uuid(e -> 'bin_id');
    IF v_bin.id IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'bin_gone');
      CONTINUE;
    END IF;
    SELECT COALESCE(array_agg(btrim(t)) FILTER (WHERE btrim(t) <> ''), '{}')
      INTO v_tags
      FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(e -> 'tags') = 'array' THEN e -> 'tags' ELSE '[]'::jsonb END) AS t;
    INSERT INTO public.bin_files AS f (
      id, project_id, bin_id, location_id, relative_path, display_name, original_name, extension, mime_type,
      is_sequence, sequence_pattern, frame_count, size_bytes, mtime, media_type, tags,
      scene_id, shot_id, slate, take_number, take_modifier, camera, roll, shoot_day,
      description, notes, review_flag, circled, color,
      duration_sec, width, height, fps, codec, timecode_start, probe_status, sort_order, poster_path,
      added_by, added_at)
    VALUES (
      v_id, v_bin.project_id, v_bin.id, v_loc, v_rel,
      btrim(e ->> 'display_name'),
      COALESCE(NULLIF(e ->> 'original_name', ''), regexp_replace(v_rel, '^.*/', '')),
      lower(COALESCE(e ->> 'extension', '')), NULLIF(e ->> 'mime_type', ''),
      COALESCE((e ->> 'is_sequence')::boolean, false), NULLIF(e ->> 'sequence_pattern', ''),
      public.fn_bins_json_number(e -> 'frame_count')::int,
      public.fn_bins_json_number(e -> 'size_bytes')::bigint,
      public.fn_bins_json_timestamp(e -> 'mtime'),
      CASE WHEN (e ->> 'media_type') IN ('video', 'still', 'sequence', 'audio', 'graphic', 'vfx', 'document', 'other')
           THEN e ->> 'media_type' ELSE 'other' END,
      v_tags[1:50],
      public.fn_bins_json_uuid(e -> 'scene_id'), public.fn_bins_json_uuid(e -> 'shot_id'),
      NULLIF(e ->> 'slate', ''),
      CASE WHEN public.fn_bins_json_number(e -> 'take_number') > 0 THEN floor(public.fn_bins_json_number(e -> 'take_number'))::int ELSE NULL END,
      NULLIF(e ->> 'take_modifier', ''), NULLIF(e ->> 'camera', ''), NULLIF(e ->> 'roll', ''),
      CASE WHEN (e ->> 'shoot_day') ~ '^\d{4}-\d{2}-\d{2}$' THEN (e ->> 'shoot_day')::date ELSE NULL END,
      COALESCE(e ->> 'description', ''), COALESCE(e ->> 'notes', ''),
      CASE WHEN (e ->> 'review_flag') IN ('unflagged', 'select', 'reject') THEN e ->> 'review_flag' ELSE 'unflagged' END,
      COALESCE((e ->> 'circled')::boolean, false),
      CASE WHEN (e ->> 'color') IN ('red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink') THEN e ->> 'color' ELSE NULL END,
      CASE WHEN public.fn_bins_json_number(e -> 'duration_sec') > 0 THEN public.fn_bins_json_number(e -> 'duration_sec')::double precision ELSE NULL END,
      CASE WHEN public.fn_bins_json_number(e -> 'width') > 0 THEN floor(public.fn_bins_json_number(e -> 'width'))::int ELSE NULL END,
      CASE WHEN public.fn_bins_json_number(e -> 'height') > 0 THEN floor(public.fn_bins_json_number(e -> 'height'))::int ELSE NULL END,
      CASE WHEN public.fn_bins_json_number(e -> 'fps') > 0 THEN public.fn_bins_json_number(e -> 'fps')::double precision ELSE NULL END,
      NULLIF(e ->> 'codec', ''), NULLIF(e ->> 'timecode_start', ''),
      CASE WHEN (e ->> 'probe_status') IN ('pending', 'done', 'failed', 'unavailable') THEN e ->> 'probe_status' ELSE 'pending' END,
      COALESCE(floor(public.fn_bins_json_number(e -> 'sort_order'))::int, 0),
      NULLIF(e ->> 'poster_path', ''),
      public.fn_bins_json_uuid(e -> 'added_by'),
      COALESCE(public.fn_bins_json_timestamp(e -> 'added_at'), now()))
    ON CONFLICT (id) DO UPDATE
      SET bin_id = EXCLUDED.bin_id, sort_order = EXCLUDED.sort_order,
          display_name = EXCLUDED.display_name, tags = EXCLUDED.tags,
          scene_id = EXCLUDED.scene_id, shot_id = EXCLUDED.shot_id, slate = EXCLUDED.slate,
          take_number = EXCLUDED.take_number, take_modifier = EXCLUDED.take_modifier,
          camera = EXCLUDED.camera, roll = EXCLUDED.roll, shoot_day = EXCLUDED.shoot_day,
          description = EXCLUDED.description, notes = EXCLUDED.notes,
          review_flag = EXCLUDED.review_flag, circled = EXCLUDED.circled, color = EXCLUDED.color
      WHERE f.project_id = EXCLUDED.project_id
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'invalid');
      CONTINUE;
    END IF;
    v_restored := v_restored || to_jsonb(v_row);
    v_row := NULL;
  END LOOP;
  PERFORM set_config('wilson.bins_mark', '', true);  -- 0104 §3b
  RETURN jsonb_build_object('restored', v_restored, 'skipped', v_skipped,
                            'affectedShotIds', '[]'::jsonb, 'shotTakes', '[]'::jsonb, 'orphanTakes', '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.restore_bin_files(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_bin_files(JSONB) TO authenticated, service_role;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname IN ('copy_bin_files', 'restore_bin_files')
         AND p.prosrc LIKE '%set_config(''wilson.bins_mark'', ''inherit'', true)%') <> 2 THEN
    RAISE EXCEPTION '0104 post-condition failed: copy_bin_files and restore_bin_files must set wilson.bins_mark = inherit';
  END IF;
END $$;


-- =============================================================================
-- 4. gateway_clips_for_tickets — restated whole (0093 §11): vetted rows only
-- =============================================================================
-- Still SECURITY INVOKER (the S33 rule; suite 96 pins prosecdef false), the
-- same columns, the same caps; one conjunct per table added to the WHERE.

CREATE OR REPLACE FUNCTION public.gateway_clips_for_tickets(p_ids UUID[])
RETURNS TABLE (bin_file_id UUID, project_id UUID, workspace_id UUID, location_id UUID, unc_path TEXT,
               relative_path TEXT, is_sequence BOOLEAN, extension TEXT, mime_type TEXT, file_name TEXT,
               remote_viewing BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(p_ids) > 100 THEN
    RAISE EXCEPTION 'At most 100 clips can be asked for at once.' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT f.id, f.project_id, f.workspace_id, f.location_id, l.unc_path, f.relative_path, f.is_sequence,
         f.extension, f.mime_type, f.display_name, public.rabbit_remote_viewing_enabled(f.project_id)
    FROM public.bin_files f
    JOIN public.bin_locations l ON l.id = f.location_id AND l.workspace_id = f.workspace_id
   WHERE f.id = ANY (p_ids)
     -- 0104 (TPN-AUTH-012): an unchecked clip, or one at an unchecked
     -- location, is absent exactly as an invisible one is — no ticket.
     AND f.vetted_at IS NOT NULL
     AND l.vetted_at IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_clips_for_tickets(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gateway_clips_for_tickets(UUID[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.gateway_clips_for_tickets(UUID[]) IS
  '0093 (G4, G5; the S33 rule), restated by 0104 (TPN-AUTH-012): the clips of p_ids the CALLER may read — SECURITY INVOKER over bin_files'' and bin_locations'' RLS — AND that carry the vetted mark at a vetted location; an invisible or unchecked clip is absent exactly as a missing one is. With each: the location''s unc_path, the relative path, whether it is a sequence, the extension and media type, its name, and the switch (remote_viewing). At most 100 ids. gateway-ticket calls it with the caller''s own token.';


-- =============================================================================
-- 5. gateways.inside_names — the names a member's browser may probe (TPN-ENC-013)
-- =============================================================================
ALTER TABLE public.gateways
  ADD COLUMN IF NOT EXISTS inside_names JSONB NOT NULL DEFAULT '[]'::jsonb;

-- The addresses' shape (0093 §2e) and never a literal: a name is one label or
-- that label under .local, as gateway_inside_host_ok admits.
CREATE OR REPLACE FUNCTION public.gateway_inside_names_ok(p_names JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE
  v_elem JSONB;
BEGIN
  IF NOT public.gateway_inside_addresses_ok(p_names) THEN
    RETURN false;
  END IF;
  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_names) LOOP
    IF (v_elem ->> 'host') ~ '^[0-9a-f:.]+$' AND (v_elem ->> 'host') ~ '[:.]' THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

-- The same, as a filter: what the gateway reports, cleaned as the addresses
-- are (lower-cased, ports 1–65535, no duplicates, sixteen at most), the
-- literals dropped.
CREATE OR REPLACE FUNCTION public.gateway_clean_inside_names(p_names JSONB)
RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE
  v_elem JSONB;
  v_out  JSONB := '[]'::jsonb;
BEGIN
  FOR v_elem IN SELECT value FROM jsonb_array_elements(public.gateway_clean_inside_addresses(p_names)) LOOP
    CONTINUE WHEN (v_elem ->> 'host') ~ '^[0-9a-f:.]+$' AND (v_elem ->> 'host') ~ '[:.]';
    v_out := v_out || jsonb_build_array(v_elem);
  END LOOP;
  RETURN v_out;
END;
$$;

DO $$
BEGIN
  ALTER TABLE public.gateways
    ADD CONSTRAINT gateways_inside_names_chk CHECK (public.gateway_inside_names_ok(inside_names));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

REVOKE ALL ON FUNCTION public.gateway_inside_names_ok(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gateway_clean_inside_names(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_inside_names_ok(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gateway_clean_inside_names(JSONB) TO service_role;

-- An admin reads the column beside the addresses (0093 §5's column grant);
-- fn_gateways_client_guard keeps every column but name, outside_address and
-- office_ranges from a client's UPDATE, this one included.
GRANT SELECT (inside_names) ON public.gateways TO authenticated;

COMMENT ON COLUMN public.gateways.inside_names IS
  '0104 (TPN-ENC-013): [{ host, port }] — the names the gateway''s office door answers to (its host name, and that name under .local), reported at enrolment and every sync; never a literal (gateway_inside_names_ok). A member''s browser probes these BEFORE the addresses, so an office-door certificate that names no address still opens.';
COMMENT ON FUNCTION public.gateway_inside_names_ok(JSONB) IS
  '0104: gateway_inside_addresses_ok and no literal host. The CHECK on gateways.inside_names.';
COMMENT ON FUNCTION public.gateway_clean_inside_names(JSONB) IS
  '0104: the names a gateway reported, cleaned as gateway_clean_inside_addresses cleans addresses, the literals dropped. Used by gateway_enrol_apply and gateway_sync_apply.';


-- =============================================================================
-- 6. gateway_enrol_apply — restated whole (0093 §14a): inside_names stored
-- =============================================================================
-- The diff against 0093 §14a is ONE column and ONE value in the INSERT (both
-- marked "0104"). The signature, the token's single-statement spend (F14),
-- the ten-gateway cap under its lock, the audit row and the answer are
-- 0093's; the earlier 4-argument signature 0093 dropped stays dropped.

CREATE OR REPLACE FUNCTION public.gateway_enrol_apply(
  p_token_hash TEXT, p_credential_hash TEXT, p_gateway JSONB, p_source INET, p_reach_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tok     RECORD;
  v_id      UUID;
  v_name    TEXT;
  v_label   TEXT;
  v_ws_name TEXT;
  v_pem     TEXT := p_gateway ->> 'root_cert_pem';
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_credential_hash !~ '^[0-9a-f]{64}$'
     OR p_reach_key IS NULL OR p_reach_key !~ '^[0-9a-f]{64}$' OR p_reach_key = p_credential_hash
     OR p_gateway IS NULL OR jsonb_typeof(p_gateway) <> 'object' THEN
    RAISE EXCEPTION 'gateway_enrol_apply: malformed arguments' USING ERRCODE = '22023';
  END IF;
  -- THE spend: one UPDATE … RETURNING is the token's only check (F14), so
  -- two calls racing on one token enrol one gateway, not two — the row lock
  -- makes the second wait and then find used_at set.
  UPDATE public.gateway_enrolment_tokens t
     SET used_at = now()
   WHERE t.token_hash = p_token_hash AND t.used_at IS NULL AND t.expires_at > now()
  RETURNING t.id, t.workspace_id, t.created_by INTO v_tok;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'token');
  END IF;
  -- Ten live gateways per company at most (D17 allows several). RAISED, not
  -- returned, so the transaction — the spend with it — rolls back and the
  -- token stays usable once one is forgotten. Counted under one lock per
  -- company (GW1 review round 1, note 7), so two enrolments racing on two
  -- tokens cannot both see nine.
  PERFORM pg_advisory_xact_lock(hashtextextended('gateway_enrol:' || v_tok.workspace_id::text, 0));
  IF (SELECT count(*) FROM public.gateways g WHERE g.workspace_id = v_tok.workspace_id AND g.revoked_at IS NULL) >= 10 THEN
    RAISE EXCEPTION 'This company already has ten gateways. Forget one before enrolling another.'
      USING ERRCODE = '54000';
  END IF;
  v_name := public.gateway_clean_name(p_gateway ->> 'name');
  IF v_name = '' THEN v_name := 'Gateway'; END IF;
  INSERT INTO public.gateways (workspace_id, name, platform, version, hostname, inside_addresses,
                               inside_names,  -- 0104 (TPN-ENC-013)
                               root_cert_pem, root_fingerprint, created_by, last_seen_at, last_sync_source)
  VALUES (v_tok.workspace_id, v_name, p_gateway ->> 'platform', p_gateway ->> 'version',
          left(p_gateway ->> 'hostname', 255),
          public.gateway_clean_inside_addresses(p_gateway -> 'inside_addresses'),
          public.gateway_clean_inside_names(p_gateway -> 'inside_names'),  -- 0104
          v_pem, public.gateway_pem_fingerprint(v_pem),
          v_tok.created_by, now(), p_source)
  RETURNING public.gateways.id INTO v_id;
  UPDATE public.gateway_enrolment_tokens SET gateway_id = v_id WHERE public.gateway_enrolment_tokens.id = v_tok.id;
  INSERT INTO public.gateway_secrets (gateway_id, credential_hash, reach_key) VALUES (v_id, p_credential_hash, p_reach_key);
  SELECT COALESCE(wm.display_name, wm.username) INTO v_label
    FROM public.workspace_members wm WHERE wm.workspace_id = v_tok.workspace_id AND wm.user_id = v_tok.created_by;
  INSERT INTO public.workspace_audit (workspace_id, action, actor_user_id, actor_label, gateway_id, details)
  VALUES (v_tok.workspace_id, 'gateway.enrolled', v_tok.created_by, left(v_label, 200), v_id,
          jsonb_build_object('name', v_name, 'platform', p_gateway ->> 'platform',
                             'version', left(p_gateway ->> 'version', 64),
                             'hostname', left(p_gateway ->> 'hostname', 255),
                             'fingerprint', public.gateway_pem_fingerprint(v_pem),
                             'source', host(p_source), 'token_id', v_tok.id));
  SELECT w.name INTO v_ws_name FROM public.workspaces w WHERE w.id = v_tok.workspace_id;
  RETURN jsonb_build_object('ok', true, 'gateway_id', v_id, 'workspace_id', v_tok.workspace_id,
                            'workspace_name', v_ws_name);
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_enrol_apply(TEXT, TEXT, JSONB, INET, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_enrol_apply(TEXT, TEXT, JSONB, INET, TEXT) TO service_role;


-- =============================================================================
-- 7. gateway_sync_apply — restated whole (0095 A3): the vetted D22 check,
--    the vetted locations, the names
-- =============================================================================
-- The diff against 0095 A3, exactly: (1) `v_names` declared, read from the
-- report through gateway_clean_inside_names and written to inside_names;
-- (2) the D22 join demands f.vetted_at and joins the location with its
-- vetted_at; (3) the bin_locations list is filtered to vetted locations.
-- Every other line is 0095's, the post-conditions below hold it to them.

CREATE OR REPLACE FUNCTION public.gateway_sync_apply(
  p_gateway UUID, p_report JSONB, p_source INET, p_confirm JSONB)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g             public.gateways%ROWTYPE;
  v_switch      BOOLEAN;
  v_changed     BOOLEAN := false;
  v_running     BOOLEAN;
  v_throttled   BOOLEAN;
  v_check       JSONB := NULL;
  v_nonce       TEXT;
  v_check_id    UUID;
  v_confirmed   JSONB := '[]'::jsonb;
  v_update_now  BOOLEAN := false;
  v_reach       JSONB;
  v_inside      JSONB;
  -- 0104 (TPN-ENC-013): the names the gateway's office door answers to.
  v_names       JSONB;
  v_health      JSONB;
  v_old_update  TEXT;
  v_new_update  TEXT;
  v_port        INT;
  -- 0095 (A): the roots the gateway reports.
  v_root_pem    TEXT := p_report ->> 'root_cert_pem';
  v_next_pem    TEXT := p_report ->> 'next_root_cert_pem';
  v_root_fp     TEXT;
  v_next_fp     TEXT;
  v_cand_pem    TEXT := NULL;
  v_cand_fp     TEXT := NULL;
  v_prev_fp     TEXT;
  v_kept        BOOLEAN;
  v_in_use      BOOLEAN;
  v_dropped     TEXT;
BEGIN
  IF p_report IS NULL OR jsonb_typeof(p_report) <> 'object' THEN
    RAISE EXCEPTION 'gateway_sync_apply: the report must be an object' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO g FROM public.gateways WHERE public.gateways.id = p_gateway FOR UPDATE;
  IF NOT FOUND OR g.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('revoked', true);
  END IF;
  SELECT w.remote_viewing_enabled INTO v_switch FROM public.workspaces w WHERE w.id = g.workspace_id;

  -- Reach per location: this company's locations only, the four words only.
  SELECT COALESCE(jsonb_object_agg(l.id::text, p_report -> 'reach' ->> l.id::text), '{}'::jsonb)
    INTO v_reach
    FROM public.bin_locations l
   WHERE l.workspace_id = g.workspace_id
     AND jsonb_typeof(p_report -> 'reach') = 'object'
     AND (p_report -> 'reach' ->> l.id::text) IN ('reachable', 'not_reachable', 'not_mounted', 'not_connected');
  v_inside := CASE WHEN p_report ? 'inside_addresses'
                   THEN public.gateway_clean_inside_addresses(p_report -> 'inside_addresses')
                   ELSE g.inside_addresses END;
  v_names := CASE WHEN p_report ? 'inside_names'
                  THEN public.gateway_clean_inside_names(p_report -> 'inside_names')
                  ELSE g.inside_names END;
  v_health := CASE WHEN jsonb_typeof(p_report -> 'health') = 'object'
                        AND char_length((p_report -> 'health')::text) <= 15000
                   THEN (p_report -> 'health') || jsonb_build_object('reported_at', now())
                   ELSE g.health END;

  -- R6: a sync from another public address withdraws the published address
  -- until a check passes again, and queues that check (below).
  IF p_source IS NOT NULL AND g.last_sync_source IS NOT NULL AND p_source IS DISTINCT FROM g.last_sync_source THEN
    v_changed := true;
  END IF;

  v_old_update := g.health ->> 'update';
  v_new_update := left(v_health ->> 'update', 128);

  UPDATE public.gateways SET
    last_seen_at     = now(),
    version          = CASE WHEN (p_report ->> 'version') ~ '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.+-]{1,40})?$'
                                 AND char_length(p_report ->> 'version') <= 64
                            THEN p_report ->> 'version' ELSE public.gateways.version END,
    hostname         = COALESCE(left(p_report ->> 'hostname', 255), public.gateways.hostname),
    inside_addresses = v_inside,
    inside_names     = v_names,
    outside_open     = COALESCE((v_health -> 'doors' ->> 'outside') LIKE 'open:%', false),
    reach            = v_reach,
    health           = v_health,
    last_sync_source = COALESCE(p_source, public.gateways.last_sync_source),
    reach_ok         = CASE WHEN v_changed THEN NULL ELSE public.gateways.reach_ok END,
    reach_detail     = CASE WHEN v_changed THEN 'source_changed' ELSE public.gateways.reach_detail END
  WHERE public.gateways.id = g.id
  RETURNING * INTO g;

  IF v_new_update LIKE 'failed:%' AND v_new_update IS DISTINCT FROM v_old_update THEN
    INSERT INTO public.workspace_audit (workspace_id, action, gateway_id, details)
    VALUES (g.workspace_id, 'gateway.update_failed', g.id, jsonb_build_object('update', v_new_update));
  END IF;

  -- 0095 (A): a root the cloud has not confirmed, reported at sync.
  --   root_cert_pem is the root the gateway signs its leaves with NOW. After
  --   a start it is the enrolment's (nothing changes); after a replacement
  --   (an inside address left the root's /24s, §3) or a promotion (a month
  --   before the old root's end) it is a root browsers must trust before
  --   anything plays, and D25 asks the admin for its fingerprint again before
  --   it is offered: it lands in the next-root slot until confirmed, and a
  --   confirmed next root reported in use is promoted into the root's place.
  --   next_root_cert_pem is the root the gateway made a year before the old
  --   one's end and will switch to: offered beside the old one, confirmed the
  --   same way, promoted when the gateway reports it in use. A root that is
  --   no certificate (a key, a fragment) fingerprints as NULL and is ignored;
  --   the confirmed root itself, reported again, changes nothing.
  v_root_fp := public.gateway_pem_fingerprint(v_root_pem);
  v_next_fp := public.gateway_pem_fingerprint(v_next_pem);
  IF v_root_fp IS NOT NULL AND v_root_fp IS DISTINCT FROM g.root_fingerprint THEN
    IF v_root_fp = g.next_root_fingerprint AND g.next_root_confirmed_at IS NOT NULL THEN
      -- The confirmed next root is in use: promote it, and say so.
      v_prev_fp := g.root_fingerprint;
      UPDATE public.gateways SET
        root_cert_pem = public.gateways.next_root_cert_pem,
        root_fingerprint = public.gateways.next_root_fingerprint,
        root_confirmed_at = public.gateways.next_root_confirmed_at,
        root_confirmed_by = public.gateways.next_root_confirmed_by,
        next_root_cert_pem = NULL, next_root_fingerprint = NULL, next_root_seen_at = NULL,
        next_root_confirmed_at = NULL, next_root_confirmed_by = NULL
      WHERE public.gateways.id = g.id
      RETURNING * INTO g;
      INSERT INTO public.workspace_audit (workspace_id, action, gateway_id, details)
      VALUES (g.workspace_id, 'gateway.root_replaced', g.id,
              jsonb_build_object('fingerprint', g.root_fingerprint, 'previous', v_prev_fp));
    ELSIF v_root_fp IS DISTINCT FROM g.next_root_fingerprint THEN
      v_cand_pem := v_root_pem;
      v_cand_fp := v_root_fp;
    END IF;
  ELSIF v_next_fp IS NOT NULL AND v_next_fp IS DISTINCT FROM g.root_fingerprint
        AND v_next_fp IS DISTINCT FROM g.next_root_fingerprint THEN
    v_cand_pem := v_next_pem;
    v_cand_fp := v_next_fp;
  END IF;
  -- GW3 review round 1, finding 9: a CONFIRMED next root is never replaced
  -- from a sync by a FUTURE root (next_root_cert_pem). A gateway alternating
  -- future roots (a bug, or a stolen credential) would otherwise clear the
  -- admin's confirmation at every sync and keep the new certificate's
  -- download locked for ever; another future root while one is confirmed is
  -- written down and kept out of the slot (`kept_confirmed`).
  -- Review round 2, finding 2: a root the gateway reports IN USE
  -- (root_cert_pem: it signs its leaves with it now) takes the slot even over
  -- a confirmed next root. GW2's gateway makes a new root at once when an
  -- inside address leaves the root's /24s, and drops the next root it had
  -- made; kept out, that root would leave Settings offering two certificates
  -- the gateway no longer signs with, every office browser failing on TLS
  -- until Forget. The confirmation it replaces is named in the trail
  -- (`replaced_confirmed`). A credential alternating IN-USE roots is §10
  -- row 2's (Forget is its answer); the trail stays bounded below.
  -- Each fingerprint is written down once per outcome (landed in the slot,
  -- or kept out of it): alternating roots cannot flood the trail Settings
  -- reads newest first, and a root first kept out that lands later is
  -- written again, once.
  IF v_cand_fp IS NOT NULL THEN
    -- Never NULL: a report with no root in use (a future root alone) is not in use.
    v_in_use := v_root_fp IS NOT NULL AND v_cand_fp = v_root_fp;
    v_kept := g.next_root_confirmed_at IS NOT NULL AND NOT v_in_use;
    v_dropped := CASE WHEN NOT v_kept AND g.next_root_confirmed_at IS NOT NULL THEN g.next_root_fingerprint END;
    IF NOT v_kept THEN
      UPDATE public.gateways SET
        next_root_cert_pem = v_cand_pem, next_root_fingerprint = v_cand_fp, next_root_seen_at = now(),
        next_root_confirmed_at = NULL, next_root_confirmed_by = NULL
      WHERE public.gateways.id = g.id
      RETURNING * INTO g;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.workspace_audit a
                    WHERE a.gateway_id = g.id AND a.action = 'gateway.next_root_received'
                      AND a.details ->> 'fingerprint' = v_cand_fp
                      AND coalesce((a.details ->> 'kept_confirmed')::boolean, false) = v_kept) THEN
      INSERT INTO public.workspace_audit (workspace_id, action, gateway_id, details)
      VALUES (g.workspace_id, 'gateway.next_root_received', g.id,
              jsonb_build_object('fingerprint', v_cand_fp, 'in_use', v_in_use, 'kept_confirmed', v_kept)
              || CASE WHEN v_dropped IS NOT NULL THEN jsonb_build_object('replaced_confirmed', v_dropped) ELSE '{}'::jsonb END);
    END IF;
  END IF;

  -- The reach check (§4; R16: one at a time). A waiting nonce is handed over
  -- now (and at every sync while the check runs); otherwise a check is begun
  -- HERE when one is due, its nonce in this very answer. An automatic check
  -- is knocked on at the NEXT sync, not this one (GW1 review round 2,
  -- finding 8): by then the gateway has had this answer, so one answer lost
  -- on the way cannot read as "not your gateway" and withdraw the address.
  v_running := g.reach_check_id IS NOT NULL AND g.reach_nonce_at > now() - interval '2 minutes';
  v_throttled := g.reach_nonce_at IS NOT NULL AND g.reach_nonce_at > now() - interval '10 minutes';
  IF v_running THEN
    IF g.reach_nonce_delivered_at IS NULL THEN
      UPDATE public.gateways SET reach_nonce_delivered_at = now() WHERE public.gateways.id = g.id
      RETURNING * INTO g;
      IF g.reach_check_auto THEN
        SELECT COALESCE(min((e ->> 'port')::int), 8443) INTO v_port
          FROM jsonb_array_elements(g.inside_addresses) AS e;
        v_check := jsonb_build_object('check_id', g.reach_check_id, 'nonce', g.reach_nonce,
                                      'address', g.outside_address, 'remote_viewing', COALESCE(v_switch, false),
                                      'inside_port', v_port);
      END IF;
    END IF;
  ELSIF g.outside_address IS NOT NULL AND (
           -- R6: a changed source withdrew the address above, at once, and is
           -- owed a check — begun at most every two minutes (GW1 review
           -- round 1, finding 3), so a source that flaps at every sync (two
           -- internet lines balanced per connection, or a forged header
           -- where the platform stamps none) cannot turn the cloud into a
           -- prober every ten seconds. The mark carries the debt, so the
           -- check comes two minutes on even if the source then holds still.
           (g.reach_detail = 'source_changed'
             AND (g.reach_nonce_at IS NULL OR g.reach_nonce_at < now() - interval '2 minutes'))
        OR (NOT v_throttled AND (
                g.reach_checked_at IS NULL
             OR g.reach_checked_at < now() - interval '24 hours'
             OR (COALESCE(v_switch, false) AND g.outside_open AND g.reach_ok IS NOT TRUE)))) THEN
    v_nonce := encode(extensions.gen_random_bytes(16), 'hex');
    v_check_id := gen_random_uuid();
    UPDATE public.gateways
       SET reach_check_id = v_check_id, reach_nonce = v_nonce,
           reach_nonce_at = now(), reach_nonce_delivered_at = NULL, reach_check_auto = true
     WHERE public.gateways.id = g.id
    RETURNING * INTO g;
  END IF;

  -- D22, the catalogue check: the row exists, is this company's, and sits
  -- at that location and path. Answered from the database as the service
  -- role — the one read Appendix C gives it here.
  -- 0104 (TPN-AUTH-012): and the row AND its location carry the vetted mark
  -- (an admin's or manager's), so a path a reviewer or member wrote is never
  -- confirmed and never served.
  IF jsonb_typeof(p_confirm) = 'array' AND jsonb_array_length(p_confirm) BETWEEN 1 AND 100 THEN
    SELECT COALESCE(jsonb_agg(DISTINCT f.id), '[]'::jsonb) INTO v_confirmed
      FROM jsonb_array_elements(p_confirm) AS c
      JOIN public.bin_files f
        ON f.id = public.fn_try_uuid(c ->> 'clip')
       AND f.location_id = public.fn_try_uuid(c ->> 'loc')
       AND f.relative_path = (c ->> 'path')
       AND f.vetted_at IS NOT NULL
      JOIN public.bin_locations l
        ON l.id = f.location_id
       AND l.workspace_id = f.workspace_id
       AND l.vetted_at IS NOT NULL
     WHERE f.workspace_id = g.workspace_id;
  END IF;

  IF g.update_check_requested_at IS NOT NULL
     AND g.update_check_requested_at > COALESCE(g.update_check_delivered_at, '-infinity'::timestamptz) THEN
    v_update_now := true;
    UPDATE public.gateways SET update_check_delivered_at = now() WHERE public.gateways.id = g.id;
  END IF;

  RETURN jsonb_build_object(
    'revoked', false,
    'gateway_id', g.id,
    'workspace_id', g.workspace_id,
    'name', g.name,
    'remote_viewing', COALESCE(v_switch, false),
    'outside_address', g.outside_address,
    'office_ranges', g.office_ranges,
    'signing_keys', (SELECT COALESCE(jsonb_agg(jsonb_build_object('kid', k.kid, 'public_key', k.public_key)
                                               ORDER BY k.created_at DESC), '[]'::jsonb)
                       FROM public.gateway_signing_keys k
                      WHERE k.workspace_id = g.workspace_id
                        AND (k.retired_at IS NULL OR k.retired_at > now() - interval '10 minutes')),
    -- 0104 (TPN-AUTH-012): the gateway is told the VETTED locations only; a
    -- location a member named is unknown to it until an admin or manager
    -- marks it, and a clip there is refused (unknown_location).
    'bin_locations', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', l.id, 'unc_path', l.unc_path)
                                                ORDER BY l.created_at, l.id), '[]'::jsonb)
                        FROM public.bin_locations l
                       WHERE l.workspace_id = g.workspace_id AND l.vetted_at IS NOT NULL),
    'confirmed', v_confirmed,
    'check_update_now', v_update_now,
    'check_reach_now', g.reach_nonce IS NOT NULL,
    'reach_nonce', g.reach_nonce,
    'background_check', v_check
  );
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_sync_apply(UUID, JSONB, INET, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_sync_apply(UUID, JSONB, INET, JSONB) TO service_role;

COMMENT ON FUNCTION public.gateway_sync_apply(UUID, JSONB, INET, JSONB) IS
  '0093 (§14b), restated by 0095 (the next root) and 0104: applies a gateway''s sync report (the version, the host name, the inside addresses AND NAMES, the reach per location, the health), compares the source address (R6), begins or hands over a reach check, takes a reported root into the next-root slot or promotes a confirmed one in use, confirms the clips of p_confirm that are this company''s at that location and path AND CHECKED (vetted_at on the row and its location, TPN-AUTH-012), and answers the switch, the outside address, the office ranges, the live signing keys and the VETTED locations. Service role only.';


-- =============================================================================
-- 8. gateways_visible — restated (0093 §12): inside_names, last
-- =============================================================================
-- CREATE OR REPLACE VIEW may add a column only at the END, so inside_names
-- follows outside_address. The filters and masks are 0093's, to the letter;
-- the post-conditions below demand them again.

CREATE OR REPLACE VIEW public.gateways_visible
WITH (security_invoker = false, security_barrier = true)
AS
  SELECT g.id, g.workspace_id, g.name, g.platform, g.version, g.inside_addresses, g.reach,
         g.last_seen_at, g.root_fingerprint,
         CASE WHEN w.remote_viewing_enabled
                   AND g.outside_open
                   AND g.reach_ok IS TRUE
                   AND g.last_seen_at > now() - interval '60 seconds'
              THEN g.outside_address END AS outside_address,
         g.inside_names
    FROM public.gateways g
    JOIN public.workspaces w ON w.id = g.workspace_id
   WHERE g.revoked_at IS NULL
     AND g.root_confirmed_at IS NOT NULL
     AND g.workspace_id = public.current_workspace_id()
     AND public.has_active_membership(g.workspace_id);

REVOKE ALL ON public.gateways_visible FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gateways_visible TO authenticated, service_role;

COMMENT ON VIEW public.gateways_visible IS
  '0093 (§2, §9 point 6, F4), restated by 0104 (TPN-ENC-013): the gateways a member''s browser may probe — of the caller''s workspace, live, fingerprint confirmed — with their inside addresses AND NAMES, and the outside address only while the switch is on, the outside door is reported open, the last reach check found this gateway there and it synced within 60 s. A definer view with its own membership filter and security_barrier; the table behind it is admins only.';


-- =============================================================================
-- 9. POST-CONDITIONS — scan the catalogue, do not assume (S22)
-- =============================================================================
DO $$
DECLARE
  v_def TEXT;
BEGIN
  -- 1. The four columns.
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'bin_files' AND column_name IN ('vetted_at', 'vetted_by'))
           OR (table_name = 'bin_locations' AND column_name IN ('vetted_at', 'vetted_by')))) <> 4 THEN
    RAISE EXCEPTION '0104 post-condition failed: the four vetted columns are not all there';
  END IF;
  -- 2. The two triggers, enabled, BEFORE INSERT OR UPDATE.
  IF (SELECT count(*) FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
       WHERE tg.tgname IN ('trg_bin_files_vet', 'trg_bin_locations_vet')
         AND p.proname IN ('fn_bin_files_vet', 'fn_bin_locations_vet')
         AND tg.tgenabled = 'O'
         AND (tg.tgtype & 2) = 2 AND (tg.tgtype & 4) = 4 AND (tg.tgtype & 16) = 16) <> 2 THEN
    RAISE EXCEPTION '0104 post-condition failed: the two vet triggers are not both enabled as BEFORE INSERT OR UPDATE';
  END IF;
  -- 3. The vetter test is the live row, SECURITY DEFINER, executable by authenticated and not anon.
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.bins_caller_may_vet(uuid)'::regprocedure)
     OR position('wm.is_active' IN pg_get_functiondef('public.bins_caller_may_vet(uuid)'::regprocedure)) = 0
     OR NOT has_function_privilege('authenticated', 'public.bins_caller_may_vet(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.bins_caller_may_vet(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0104 post-condition failed: bins_caller_may_vet is not the live-row definer authenticated may call';
  END IF;
  -- 4. gateway_sync_apply: 0104's three changes AND 0095's guards, all present.
  v_def := pg_get_functiondef('public.gateway_sync_apply(uuid,jsonb,inet,jsonb)'::regprocedure);
  IF position('f.vetted_at IS NOT NULL' IN v_def) = 0
     OR position('l.vetted_at IS NOT NULL' IN v_def) = 0
     OR position('gateway_clean_inside_names' IN v_def) = 0
     OR position('inside_names     = v_names' IN v_def) = 0 THEN
    RAISE EXCEPTION '0104 post-condition failed: gateway_sync_apply lacks the vetted check, the vetted locations or the names';
  END IF;
  IF position('next_root_cert_pem' IN v_def) = 0
     OR position('gateway.root_replaced' IN v_def) = 0
     OR position('replaced_confirmed' IN v_def) = 0
     OR position('kept_confirmed' IN v_def) = 0
     OR position('source_changed' IN v_def) = 0
     OR position('update_check_delivered_at' IN v_def) = 0 THEN
    RAISE EXCEPTION '0104 post-condition failed: gateway_sync_apply lost one of 0095''s guards in the restatement';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.gateway_sync_apply(uuid,jsonb,inet,jsonb)'::regprocedure)
     OR has_function_privilege('authenticated', 'public.gateway_sync_apply(uuid,jsonb,inet,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.gateway_sync_apply(uuid,jsonb,inet,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '0104 post-condition failed: gateway_sync_apply must be SECURITY DEFINER, the service role''s alone';
  END IF;
  -- 5. gateway_enrol_apply stores the names; still the service role's alone.
  v_def := pg_get_functiondef('public.gateway_enrol_apply(text,text,jsonb,inet,text)'::regprocedure);
  IF position('gateway_clean_inside_names' IN v_def) = 0
     OR position('pg_advisory_xact_lock' IN v_def) = 0
     OR position('t.used_at IS NULL AND t.expires_at > now()' IN v_def) = 0 THEN
    RAISE EXCEPTION '0104 post-condition failed: gateway_enrol_apply lacks the names, or lost the token spend or the cap''s lock';
  END IF;
  IF has_function_privilege('authenticated', 'public.gateway_enrol_apply(text,text,jsonb,inet,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '0104 post-condition failed: gateway_enrol_apply must not be callable by authenticated';
  END IF;
  -- 6. gateway_clips_for_tickets: vetted only, still as the caller.
  v_def := pg_get_functiondef('public.gateway_clips_for_tickets(uuid[])'::regprocedure);
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.gateway_clips_for_tickets(uuid[])'::regprocedure)
     OR position('f.vetted_at IS NOT NULL' IN v_def) = 0
     OR position('l.vetted_at IS NOT NULL' IN v_def) = 0
     OR position('rabbit_remote_viewing_enabled' IN v_def) = 0 THEN
    RAISE EXCEPTION '0104 post-condition failed: gateway_clips_for_tickets must stay SECURITY INVOKER and demand both marks';
  END IF;
  -- 7. The view: inside_names exposed, 0093's filters and masks intact, the grants right.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'gateways_visible' AND column_name = 'inside_names') THEN
    RAISE EXCEPTION '0104 post-condition failed: gateways_visible does not expose inside_names';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.gateways_visible'::regclass
              AND COALESCE(reloptions, '{}') @> ARRAY['security_invoker=true'])
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.gateways_visible'::regclass
                     AND COALESCE(reloptions, '{}') @> ARRAY['security_barrier=true']) THEN
    RAISE EXCEPTION '0104 post-condition failed: gateways_visible must stay a definer view with security_barrier';
  END IF;
  v_def := pg_get_viewdef('public.gateways_visible'::regclass, true);
  IF position('has_active_membership(g.workspace_id)' IN v_def) = 0
     OR position('current_workspace_id()' IN v_def) = 0
     OR position('revoked_at IS NULL' IN v_def) = 0
     OR position('root_confirmed_at IS NOT NULL' IN v_def) = 0
     OR position('remote_viewing_enabled' IN v_def) = 0
     OR position('outside_open' IN v_def) = 0
     OR position('reach_ok IS TRUE' IN v_def) = 0
     OR position('last_seen_at >' IN v_def) = 0 THEN
    RAISE EXCEPTION '0104 post-condition failed: gateways_visible lost a filter or a mask: %', v_def;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'gateways_visible'
              AND column_name IN ('office_ranges', 'root_cert_pem', 'reach_nonce', 'last_sync_source', 'health', 'created_by', 'hostname')) THEN
    RAISE EXCEPTION '0104 post-condition failed: gateways_visible exposes a column that is an admin''s alone';
  END IF;
  IF has_table_privilege('anon', 'public.gateways_visible', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.gateways_visible', 'SELECT')
     OR has_table_privilege('authenticated', 'public.gateways_visible', 'INSERT') THEN
    RAISE EXCEPTION '0104 post-condition failed: gateways_visible grants are wrong (authenticated SELECT only)';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.gateways', 'inside_names', 'SELECT')
     OR has_column_privilege('authenticated', 'public.gateways', 'inside_names', 'UPDATE') THEN
    RAISE EXCEPTION '0104 post-condition failed: an admin must read gateways.inside_names and never write it';
  END IF;
  -- 8. The names' validators, by example.
  IF NOT public.gateway_inside_names_ok('[{"host": "studio-nas", "port": 8443}, {"host": "studio-nas.local", "port": 8443}]'::jsonb)
     OR public.gateway_inside_names_ok('[{"host": "192.168.1.10", "port": 8443}]'::jsonb)
     OR public.gateway_inside_names_ok('[{"host": "fd00::1", "port": 8443}]'::jsonb)
     OR public.gateway_inside_names_ok('[{"host": "evil.example.com", "port": 8443}]'::jsonb)
     OR public.gateway_inside_names_ok('"studio-nas"'::jsonb) THEN
    RAISE EXCEPTION '0104 post-condition failed: gateway_inside_names_ok admits a literal, a public name or a non-array, or refuses the host''s names';
  END IF;
  IF public.gateway_clean_inside_names('[{"host": "8.8.8.8", "port": 8443}, {"host": "192.168.1.10", "port": 8443}, {"host": "Studio-NAS", "port": 8443}, {"host": "studio-nas.local", "port": 8443}, "x"]'::jsonb)
     <> '[{"host": "studio-nas", "port": 8443}, {"host": "studio-nas.local", "port": 8443}]'::jsonb
     OR public.gateway_clean_inside_names(NULL) <> '[]'::jsonb THEN
    RAISE EXCEPTION '0104 post-condition failed: gateway_clean_inside_names must keep the host''s names, lower-cased, and drop every literal and odd entry';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.gateways'::regclass AND conname = 'gateways_inside_names_chk') THEN
    RAISE EXCEPTION '0104 post-condition failed: gateways_inside_names_chk is missing';
  END IF;
  RAISE NOTICE '0104 OK: vetted_at/vetted_by on bin_files and bin_locations, decided by trg_bin_files_vet and trg_bin_locations_vet for a client''s write (bins_caller_may_vet, the live row); gateway_sync_apply restated from 0095 with the vetted D22 check, the vetted locations and inside_names; gateway_enrol_apply stores inside_names; gateway_clips_for_tickets vetted only, as the caller; gateways_visible exposes inside_names last; gateway_inside_names_ok and gateway_clean_inside_names';
END $$;
