-- =============================================================================
-- 0088_legal_files.sql — post-overhaul S4b: the Legal gate. A Legal file is
-- seen only by the people who can see money, and Legal is chosen when the file
-- is ADDED, because "its just the folder that is locked".
--
-- AUDREY'S RULINGS (docs/design/POST_OVERHAUL_ANSWERS.md, 2026-10-01, in chat
-- with the controller), verbatim:
--   1. Who may see a Legal file — "same as money files for now."
--      = workspace admins and the project's managers, exactly
--      public.can_access_project_money(project_id) (0037). Project reviewers,
--      project members and workspace-level managers holding only a member
--      seat do NOT.
--   2. Legal only when the file is added — "thats fine. yes that makes sense
--      that its just the folder that is locked."
-- E3 / E4 (2026-09-29): nine tags; Finance and Legal are the restricted two;
-- Legal shipped in S4a as a label ("Not restricted yet"). A9: the cloud and
-- the NAS behave the same as far as physically possible (the Local Server has
-- no roles; electron/ files its Legal files in a LEGAL folder beside INVOICES
-- and says it cannot enforce the restriction itself).
--
-- WHAT THIS DOES
-- --------------
-- 1. LEGAL joins the ONE list of locked folders, public.rabbit_money_segment
--    (0042) — one function body. The sixteen storage policies on rabbit-files
--    (0042) and rabbit-thumbnails (0053) are not restated: the eight base ones
--    negate the function and the eight money ones assert it beside
--    can_access_project_money, so a Legal object and its thumbnail move behind
--    the money gate with the list (I1). 0050's files_money_provider_chk and
--    0055/0078's quota exemption read the same function, so Legal bodies are
--    pinned to Supabase (I4) and inherit the bounded exemption (I6) by
--    construction. 0074's file_event_is_financial reads it through
--    rabbit_money_key, so every event of a Legal file is flagged at capture.
-- 2. ONE definition of "a money files row", public.file_row_is_money(flag,
--    path) = the is_financial flag OR the third path segment is a locked
--    folder — 0050's two axes ("either alone is a way in"), with 0050's
--    split_part extractor. The four files policies (I2), log_file_downloaded,
--    fn_trash_authz, the realtime broadcast and the edit-history snapshot all
--    call it, so the folder is the truth for rows too and a money-path row
--    with a false flag stops being a way in. The brief recommended the
--    expression inline; a helper is used because nine call sites would
--    otherwise carry nine copies, which is the drift 0042 exists to end.
-- 3. The legal TAG and the LEGAL FOLDER can never disagree (I3):
--    files_legal_folder_chk ties `tags @> {legal}` to the third segment being
--    LEGAL (any case, rabbit_legal_segment). So tagging an existing file
--    Legal fails, un-tagging a Legal file fails, and moving a path across the
--    boundary without the tag fails; moving it WITH the tag lands the row
--    under the gate (only a money-cleared caller can write such a row).
--    Stray legal tags from S4a's label-only period are stripped first and
--    counted (expected: none — 0085 is on no database yet).
-- 4. A Legal file is never Core (I5): files_legal_not_core_chk. Core files are
--    read as the project's context by Intake and D.O.G.; a Legal file's text
--    must not reach a deck or an ingestion chunk every member can read.
-- 5. THREE PRE-EXISTING PATHS THAT NAMED AN INVOICE TO THE WRONG PERSON,
--    measured on wilson-dev in rolled-back transactions on 2026-10-01 and
--    closed here for invoices and Legal files alike (I5):
--    a. REALTIME. fn_realtime_broadcast (0016/0061/0077) sends the WHOLE old
--       and new files row to rabbit:project:{id}, whose join gate is
--       can_read_project_topic — every project reader. Measured: a plain
--       member who cannot SELECT an invoice row read its name, note and
--       storage path off the topic. Money rows are no longer broadcast;
--       another window of a manager sees them on its next load or refresh.
--    b. EDIT HISTORY. edit_history_select (0012) admits any workspace admin
--       or manager to every row's history. Measured: a workspace-level
--       manager holding a member seat read an invoice's name and note there.
--       edit_history gains is_financial + project_id, snapshotted at capture
--       for files rows by a BEFORE INSERT trigger (the capture function, which
--       fourteen tables share, is NOT restated), and the policy gains the
--       money arm: a flagged row is for workspace admins and the project's
--       managers only.
--    c. TRASH. fn_trash_authz (0014/0067/0082) authorises soft_delete_row and
--       restore_soft_deleted on files with can_write_project alone. Measured:
--       a plain member trashed and restored an invoice by its id (true, true;
--       an unknown id raises) — a write past the money gate and an existence
--       oracle. A money files row now needs can_access_project_money too.
--    And two that would have named a LEGAL file:
--    d. log_file_downloaded (0047/0074/0083) refused non-money callers on the
--       FLAG only; a Legal file is not is_financial. It now asks
--       file_row_is_money.
--    e. file_events_select (0027/0074) shows a money row's 'purged'
--       certificate to every project reader (Audrey's ruling 22, for
--       invoices). A Legal file's certificate names it, and the controller's
--       instruction for this bundle is that nothing — file events included —
--       names a Legal file to a member or reviewer. So a purged certificate
--       whose path was under LEGAL is hidden from non-money readers; an
--       invoice's stays visible exactly as before. (Put to Audrey in the S4b
--       hand-off: reversible by deleting one arm.)
--
-- I6, THE QUOTA, DECIDED: Legal inherits 0078's bounded exemption unchanged.
-- Legal bodies must live in Supabase whatever storage the workspace chose
-- (I4) — the same reason invoices are exempt, so a company on its own NAS or
-- bucket that pays for no Petal storage can still file a contract. A
-- contract, release, permit or NDA is a PDF of single-digit MB, well under
-- rabbit_quota_exempt_max_bytes() (25 MiB); a larger one is weighed like
-- ordinary media and uploads whenever there is room (0078's "bounded, not
-- capped"). No different rule is needed; post-condition 14 pins it.
--
-- ORDERING — this file depends on, and must be re-run after a replay of:
--   0037 (can_access_project_money), 0038 (files.is_financial and the four
--   files policies), 0042 (rabbit_money_segment and the eight rabbit-files
--   policies), 0050 (files_money_provider_chk), 0053 (the eight
--   rabbit-thumbnails policies), 0055 (rabbit_quota_exempt_path), 0074
--   (file_events.is_financial, rabbit_money_key, file_events_select), 0078
--   (the bounded exemption), 0082 (fn_trash_authz, passes_project_privacy),
--   0083 (files_insert / files_update / log_file_downloaded — their latest
--   bodies) and 0085 (files.tags — §0 refuses to run without it).
--   Replay pairs: re-running 0042 reverts the segment list (LEGAL objects
--   would fall to the base policies — every project member could read them);
--   0012 reverts edit_history_select; 0016 / 0061 / 0077 revert the realtime
--   skip; 0014 / 0067 / 0082 revert fn_trash_authz; 0038 / 0083 revert the
--   files policies to the flag-only arm; 0047 / 0074 / 0083 revert
--   log_file_downloaded; 0027 / 0074 revert file_events_select. After ANY of
--   those, re-run 0088. Its post-conditions are the tripwire for each.
--
-- WHAT IT DELIBERATELY DOES NOT DO
-- --------------------------------
-- * No storage policy is created, dropped or restated (the sixteen ride the
--   function; post-condition 8 re-counts them).
-- * No byte moves. An object's key is its S3 key; a file becomes Legal only
--   by being uploaded under LEGAL/. §0 proves no key or row under a third
--   segment LEGAL exists before the list changes, so nothing already stored
--   changes gate.
-- * fn_edit_history_capture (0012/0061), shared by fourteen tables, is not
--   restated; the snapshot is a separate BEFORE INSERT trigger on
--   edit_history, scoped to entity_type 'files'.
-- * reserve_upload_bytes is unchanged: a small Legal key is reservation-
--   exempt exactly like an invoice (no row written, nothing answered but
--   NULL), a large one is weighed; upload_reservations is readable by its
--   maker only.
-- * The Edge Function storage-presign carries its own copy of the list
--   (_shared/moneySegments.ts); it gains LEGAL in the same commit and is
--   deployed by Audrey (refusal in depth: the client never presigns a money
--   key, and files_money_provider_chk refuses an s3 row under LEGAL).
--
-- MEASURED BEFORE THIS FILE WAS WRITTEN (wilson-dev …9d59…, 4 workspaces,
-- 2026-10-01, read-only): 16 files rows (1 financial, all supabase), 23
-- storage objects; ZERO files rows, thumbnails, storage objects, file_events
-- paths or upload reservations with a third segment LEGAL in any case; zero
-- rows with a money path and a false flag; zero core money rows; 0085 not
-- applied (files.tags absent). 21 dependents of rabbit_money_segment: the 16
-- storage policies (two of them twice, USING and WITH CHECK) and
-- files_money_provider_chk — no index.
--
-- Idempotent: §0's no-LEGAL proof runs only while LEGAL is not yet locked;
-- CREATE OR REPLACE / DROP-then-CREATE / ADD COLUMN IF NOT EXISTS / DROP
-- CONSTRAINT IF EXISTS-then-ADD throughout; the edit-history backfill only
-- ever sets the flag, never clears it. Apply with
-- `supabase db query --linked --file supabase/migrations/0088_legal_files.sql`
-- AFTER 0085, never `db push`. pgTAP: 90_legal_files.sql (new); 87 updated.
-- =============================================================================


-- =============================================================================
-- 0. GUARDS — before anything changes
-- =============================================================================

DO $$
DECLARE
  v_files    INT;
  v_thumbs   INT;
  v_objects  INT;
  v_events   INT;
  v_reserve  INT;
  v_gc       INT;
BEGIN
  -- 0a. Every count below reads FORCE-RLS tables. A role that does not
  --     bypass RLS would count nothing and pass (0076's guard, kept).
  IF row_security_active('public.files')
     OR row_security_active('public.file_events')
     OR row_security_active('public.edit_history')
     OR row_security_active('public.upload_reservations')
     OR row_security_active('storage.objects') THEN
    RAISE EXCEPTION '0088 refused: row security is ACTIVE for role % on a table this migration counts or rewrites; apply as a role that bypasses RLS', current_user;
  END IF;

  -- 0b. The tag half of I3 needs files.tags (0085).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'files' AND column_name = 'tags'
  ) THEN
    RAISE EXCEPTION '0088 refused: public.files has no tags column — apply 0085_file_tags.sql first';
  END IF;

  -- 0c. I1's precondition: nothing is ALREADY stored under LEGAL. Changing the
  --     list moves every such key behind the money gate at once; a key that
  --     exists today was written under the base policies by anyone who could
  --     write the project, and its row has no legal tag. Run only while LEGAL
  --     is not yet locked — after the first apply, LEGAL rows are the gated,
  --     tagged files this migration exists for, and a re-run must not refuse.
  IF NOT public.rabbit_money_segment('LEGAL') THEN
    SELECT count(*) INTO v_files FROM public.files
     WHERE upper(split_part(storage_path, '/', 3)) = 'LEGAL'
        OR upper((storage.foldername(storage_path))[3]) = 'LEGAL';
    SELECT count(*) INTO v_thumbs FROM public.files
     WHERE upper(split_part(COALESCE(thumbnail_url, ''), '/', 3)) = 'LEGAL';
    SELECT count(*) INTO v_objects FROM storage.objects
     WHERE upper(split_part(name, '/', 3)) = 'LEGAL'
        OR upper((storage.foldername(name))[3]) = 'LEGAL';
    SELECT count(*) INTO v_events FROM public.file_events
     WHERE upper(split_part(COALESCE(old_path, ''), '/', 3)) = 'LEGAL'
        OR upper(split_part(COALESCE(new_path, ''), '/', 3)) = 'LEGAL';
    SELECT count(*) INTO v_reserve FROM public.upload_reservations
     WHERE upper(split_part(storage_path, '/', 3)) = 'LEGAL';
    SELECT count(*) INTO v_gc FROM public.storage_gc_queue
     WHERE upper(split_part(object_path, '/', 3)) = 'LEGAL';
    IF v_files + v_thumbs + v_objects + v_events + v_reserve + v_gc > 0 THEN
      RAISE EXCEPTION '0088 refused: keys already sit under a third segment LEGAL (files rows %, thumbnails %, storage objects %, file_events %, upload reservations %, gc queue %). They were written as ordinary files; locking the folder would hide them from the people who added them. Move or rename them first.',
        v_files, v_thumbs, v_objects, v_events, v_reserve, v_gc;
    END IF;
  END IF;
END $$;


-- =============================================================================
-- 1. THE LIST, AND THE TWO CLASSIFIERS BUILT ON IT
-- =============================================================================

-- 1a. LEGAL joins the one list. The body is 0042's with one word added; the
--     coalesce is 0042's load-bearing NULL-safety (PROJECT.json has no third
--     segment and must stay readable and writable by every project member).
CREATE OR REPLACE FUNCTION public.rabbit_money_segment(seg text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  -- coalesce, NOT a bare IN: a path with no third segment yields NULL, and a
  -- NULL here propagates through `NOT (...)` and fails the base policies —
  -- which would lock every project member out of PROJECT.json. See 0042.
  -- 0088: LEGAL — legal documents, Audrey 2026-10-01: "same as money files".
  SELECT coalesce(upper(seg) IN ('INVOICES', 'FINANCE', 'LEGAL'), false);
$$;

COMMENT ON FUNCTION public.rabbit_money_segment(text) IS
  'True when a rabbit-files / rabbit-thumbnails third path segment is a LOCKED folder: INVOICES (invoices and receipts), FINANCE (project rate overrides) and, since 0088, LEGAL (legal documents — Audrey 2026-10-01, "same as money files for now"). The SINGLE source of truth for the reserved-segment list: the eight base storage policies negate it, the eight money policies assert it beside can_access_project_money, files_money_provider_chk (0050) pins those bodies to Supabase, rabbit_quota_exempt_path (0055) exempts them up to 0078''s bound, and file_row_is_money (0088) extends it to files ROWS. Case-insensitive and NULL-safe — a path with no third segment (projects/<id>/PROJECT.json) is NOT locked.';

REVOKE ALL ON FUNCTION public.rabbit_money_segment(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rabbit_money_segment(text) TO authenticated, service_role;

-- 1b. Which locked folder is the LEGAL one. The tag CHECK, the core CHECK and
--     the certificate arm need to tell Legal from invoices; this is the one
--     place that says so. Post-condition 2 asserts it is a SUBSET of the list
--     above in every case, so the two cannot disagree about whether a Legal
--     key is gated.
CREATE OR REPLACE FUNCTION public.rabbit_legal_segment(seg text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(upper(seg) = 'LEGAL', false);
$$;

COMMENT ON FUNCTION public.rabbit_legal_segment(text) IS
  '0088: true when a path''s third segment is the LEGAL locked folder, in any case; false — never NULL — for anything else. A subset of rabbit_money_segment (post-condition 2 of 0088). Read by files_legal_folder_chk, files_legal_not_core_chk and file_events_select''s certificate arm.';

REVOKE ALL ON FUNCTION public.rabbit_legal_segment(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rabbit_legal_segment(text) TO authenticated, service_role;

-- 1c. A money files ROW, on both axes (0050's rule and extractor). split_part
--     keeps the filename, so it reads one segment deeper than foldername at
--     depth three: the stricter of the two, which is the safe direction for a
--     gate (0050's own note). Never NULL: a NULL here would be negated by the
--     policies and hide every plain row.
CREATE OR REPLACE FUNCTION public.file_row_is_money(p_flag boolean, p_path text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(p_flag, false)
      OR public.rabbit_money_segment(split_part(COALESCE(p_path, ''), '/', 3));
$$;

COMMENT ON FUNCTION public.file_row_is_money(boolean, text) IS
  '0088: the ONE definition of a money-gated files row — the is_financial flag OR the storage path''s third segment a locked folder (rabbit_money_segment: INVOICES, FINANCE, LEGAL). Both axes, as 0050''s files_money_provider_chk reads them, because either alone is a way in. Read by the four files policies, log_file_downloaded, fn_trash_authz, fn_realtime_broadcast and the edit-history snapshot. Never NULL.';

REVOKE ALL ON FUNCTION public.file_row_is_money(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.file_row_is_money(boolean, text) TO authenticated, service_role;


-- =============================================================================
-- 2. STRAY LEGAL TAGS (S4a's label-only period) — stripped, and counted
-- =============================================================================
-- Before the CHECK below can be added, no row may carry 'legal' outside the
-- LEGAL folder. S4a let money-cleared people tick Legal as a label; such a
-- file is an ordinary file under an ordinary folder, readable by its team, so
-- the honest repair is to remove the label, not to hide the file. Expected
-- zero everywhere: 0085 (the column) is on no database yet.

DO $$
DECLARE
  v_stripped INT;
BEGIN
  UPDATE public.files
     SET tags = array_remove(tags, 'legal')
   WHERE 'legal' = ANY (tags)
     AND NOT public.rabbit_legal_segment(split_part(storage_path, '/', 3));
  GET DIAGNOSTICS v_stripped = ROW_COUNT;
  RAISE NOTICE '0088: stripped a stray legal tag from % files row(s) whose path is not under LEGAL', v_stripped;
END $$;


-- =============================================================================
-- 3. THE TWO CHECKS
-- =============================================================================
-- DROP then ADD (0085's idiom): a re-run re-validates every row against the
-- definition below instead of keeping a stale one.

-- 3a. I3 — the tag and the folder are created together and never disagree.
--     COALESCE although tags is NOT NULL (0085): a CHECK passes on NULL, so a
--     NULL here would wave a row through.
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_legal_folder_chk;
ALTER TABLE public.files
  ADD CONSTRAINT files_legal_folder_chk
    CHECK (COALESCE(tags @> ARRAY['legal']::text[], false)
           = public.rabbit_legal_segment(split_part(storage_path, '/', 3)));

COMMENT ON CONSTRAINT files_legal_folder_chk ON public.files IS
  '0088 (I3): a row carries the legal tag exactly when its storage path''s third segment is LEGAL (any case). Legal is chosen when the file is added — "its just the folder that is locked" (Audrey, 2026-10-01): an existing file cannot be tagged or un-tagged Legal, and its path cannot cross the boundary without the tag.';

-- 3b. A Legal file is never Core. Keyed on the tag OR the folder, so it holds
--     even if 3a were ever weakened.
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_legal_not_core_chk;
ALTER TABLE public.files
  ADD CONSTRAINT files_legal_not_core_chk
    CHECK (NOT (is_core_definer
                AND (COALESCE(tags @> ARRAY['legal']::text[], false)
                     OR public.rabbit_legal_segment(split_part(storage_path, '/', 3)))));

COMMENT ON CONSTRAINT files_legal_not_core_chk ON public.files IS
  '0088 (I5): a Legal file cannot be a core project file. Intake and D.O.G. read core files as the project''s context, and a Legal file''s text must not reach an ingestion chunk or a deck that the whole project can read.';


-- =============================================================================
-- 4. THE FOUR files POLICIES — DROP + CREATE, each from its LATEST body
-- =============================================================================
-- files_select and files_delete are 0038's; files_insert and files_update are
-- 0083's. Each is reproduced word for word with ONE change: the money arm
-- `(NOT is_financial OR …)` becomes `(NOT file_row_is_money(is_financial,
-- storage_path) OR …)`. Never a policy added beside: permissive policies OR
-- together (the S15 CRITICAL, 0038's inversion). USING and WITH CHECK both
-- carry it, as 0038 put it: USING guards the OLD row, WITH CHECK the NEW one.

DROP POLICY IF EXISTS files_select ON public.files;
CREATE POLICY files_select ON public.files
  FOR SELECT USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = files.project_id)
    AND (NOT public.file_row_is_money(is_financial, storage_path)
         OR public.can_access_project_money(project_id))
  );

DROP POLICY IF EXISTS files_insert ON public.files;
CREATE POLICY files_insert ON public.files
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND (NOT public.file_row_is_money(is_financial, storage_path)
         OR public.can_access_project_money(project_id))
    -- 0083: the parent must be one the caller can SELECT (projects_select's
    -- four arms, privacy included) — a leaked id is a name, not a write.
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = files.project_id)
  );

DROP POLICY IF EXISTS files_update ON public.files;
CREATE POLICY files_update ON public.files
  FOR UPDATE
  USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND (NOT public.file_row_is_money(is_financial, storage_path)
         OR public.can_access_project_money(project_id))
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.can_write_project(project_id)
    AND (NOT public.file_row_is_money(is_financial, storage_path)
         OR public.can_access_project_money(project_id))
    -- 0083: gate the NEW row's parent too (the column-free UPDATE's only gate).
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = files.project_id)
  );

DROP POLICY IF EXISTS files_delete ON public.files;
CREATE POLICY files_delete ON public.files
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND (NOT public.file_row_is_money(is_financial, storage_path)
         OR public.can_access_project_money(project_id))
  );


-- =============================================================================
-- 5. log_file_downloaded — the money refusal reads both axes (0083's body)
-- =============================================================================
-- Reproduced from 0083 with ONE change: the money arm asks file_row_is_money
-- instead of the flag. Without it a member holding a Legal file's id could
-- mint its name, path and size into file_events and use the RPC as an
-- existence oracle (true for a Legal file, the one refusal for nothing).

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
     -- one this caller can SEE, through 0082's one definer-side restatement.
     OR NOT COALESCE(public.passes_project_privacy(v_file.project_id), false)
     -- The 0038 money arm, replicated: files_select hides money rows from
     -- non-money members, so this RPC must refuse them too. 0088: on BOTH
     -- axes (file_row_is_money), as files_select now reads them — a Legal
     -- file carries no is_financial flag; its folder is its gate.
     -- 🚨 The COALESCE is load-bearing (0074's probe 29): for a claim-less
     -- non-manager the gate is NULL, and an `IF` over NULL fails OPEN.
     OR (public.file_row_is_money(v_file.is_financial, v_file.storage_path)
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
     -- Track C / 0074: a read of a money file is money history (a LEGAL key
     -- is flagged by its path through rabbit_money_key).
     public.file_event_is_financial(v_file.is_financial, v_file.storage_path, NULL));

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_file_downloaded(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.log_file_downloaded(UUID) TO authenticated;

COMMENT ON FUNCTION public.log_file_downloaded(UUID) IS
  'S33 (TPN-CONT-008/TPN-LOG-002, AS-2.9): appends a downloaded event to file_events for a file the caller can read (explicit workspace + membership + live-project + money-arm checks, the private-project arm of projects_select (0072) via passes_project_privacy (0082, since 0083), and since 0088 the money arm on BOTH axes via file_row_is_money, so a Legal file is refused like an invoice; DEFINER so the table stays append-only). Track C / 0074 flags the event is_financial. Called best-effort by supabaseAdapter.downloadFile; the Local Server twin logs bundle-side in the Express download route.';


-- =============================================================================
-- 6. fn_trash_authz — a money files row needs the money gate (0082's body)
-- =============================================================================
-- Reproduced from 0082 with ONE addition, for p_table = 'files' only: a money
-- row (file_row_is_money) needs can_access_project_money as well as the write
-- gate. soft_delete_row and restore_soft_deleted both call this first, so the
-- one refusal covers trash and restore, and its message is the one an
-- unknown id already gets — the answer no longer tells a member that a money
-- file with that id exists.

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
  v_flag    BOOLEAN;
  v_path    TEXT;
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

  -- 0088: a money files row (an invoice, a receipt, a Legal file — the flag
  -- or the locked folder) is for the people who can see money. Measured
  -- before this: a plain member trashed and restored an invoice by its id.
  IF p_table = 'files' THEN
    SELECT f.is_financial, f.storage_path INTO v_flag, v_path
      FROM public.files f WHERE f.id = p_id;
    IF public.file_row_is_money(v_flag, v_path)
       AND NOT COALESCE(public.can_access_project_money(v_project), false) THEN
      v_allowed := false;
    END IF;
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
  'Authorizes a soft-delete or restore for one of the eight soft-delete RABBIT tables (0014''s seven plus milestones, 0067): workspace match, active membership and the project gate — the comment gate for comments, none for workspace-level rate_cards — and, since 0082, the private-project arm of projects_select (0072) for every project-scoped row; since 0088 a money files row (file_row_is_money: invoices, receipts, rates, Legal files) also needs can_access_project_money. For the projects row itself this gate admits the creator and 0014''s fn_soft_delete_stamp, which runs after it, admits only an admin.';


-- =============================================================================
-- 7. fn_realtime_broadcast — money files rows stay off the project channel
-- =============================================================================
-- 0077's body, reproduced, with ONE change: 'files' leaves the shared
-- project_id arm for an arm of its own that returns before broadcasting when
-- the NEW or the OLD row is money. broadcast_changes publishes both rows in
-- full, bypassing RLS (0016's reason for choosing it), to every subscriber of
-- rabbit:project:{id} — every project reader. 0077's header said "everyone who
-- can hear the topic can already read every … file"; that was false for
-- invoices (0038) and is the leak this closes. Every table is still named
-- exactly once (0077's §3d invariant: CASE takes the first match).
-- The price: a manager's OTHER window sees a money file change on its next
-- load or Refresh, not live — the reload limit scenes and shots already carry.

CREATE OR REPLACE FUNCTION public.fn_realtime_broadcast()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     JSONB;
  v_project UUID;
BEGIN
  -- Environments without the realtime schema (db-only CI stack) skip
  -- silently. Probes for the FUNCTION, not just the schema — a stack carrying
  -- the schema without broadcast_changes would pass a schema-only check and
  -- then raise a WARNING on every single write.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'realtime' AND p.proname = 'broadcast_changes'
  ) THEN
    RETURN NULL;
  END IF;

  -- PG14+: the unassigned side of NEW/OLD reads as NULL in row triggers.
  v_row := COALESCE(to_jsonb(NEW), to_jsonb(OLD));

  CASE TG_TABLE_NAME
    WHEN 'projects' THEN
      v_project := (v_row ->> 'id')::uuid;
    -- 0077: milestones joins this arm. It has its own project_id (0067).
    WHEN 'phases', 'assets', 'tasks', 'project_members', 'milestones' THEN
      v_project := (v_row ->> 'project_id')::uuid;
    -- 0088: files has its own arm. A money row — the flag or a locked folder,
    -- on either side of the write — is never put on the project channel.
    WHEN 'files' THEN
      IF public.file_row_is_money((to_jsonb(NEW) ->> 'is_financial')::boolean,
                                  to_jsonb(NEW) ->> 'storage_path')
         OR public.file_row_is_money((to_jsonb(OLD) ->> 'is_financial')::boolean,
                                     to_jsonb(OLD) ->> 'storage_path') THEN
        RETURN NULL;
      END IF;
      v_project := (v_row ->> 'project_id')::uuid;
    WHEN 'comments' THEN
      v_project := public.fn_comment_project_id(
        v_row ->> 'entity_type', (v_row ->> 'entity_id')::uuid);
    WHEN 'task_dependencies' THEN
      SELECT t.project_id INTO v_project FROM public.tasks t
       WHERE t.id = (v_row ->> 'predecessor_id')::uuid;
    -- 0061: the phase sibling. Resolves through phases, not tasks.
    WHEN 'phase_dependencies' THEN
      SELECT ph.project_id INTO v_project FROM public.phases ph
       WHERE ph.id = (v_row ->> 'predecessor_id')::uuid;
    WHEN 'task_links' THEN
      SELECT t.project_id INTO v_project FROM public.tasks t
       WHERE t.id = (v_row ->> 'task_id')::uuid;
    WHEN 'asset_versions' THEN
      SELECT a.project_id INTO v_project FROM public.assets a
       WHERE a.id = (v_row ->> 'asset_id')::uuid;
    ELSE
      v_project := NULL;
  END CASE;

  -- Unroutable (cascade delete with the parent already gone, dead-end comment
  -- walk): skip. The subtree's own parent event already told clients
  -- everything they need.
  IF v_project IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM realtime.broadcast_changes(
    'rabbit:project:' || v_project::text,
    TG_OP, TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD
  );

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Same resilience contract as fn_edit_history_capture (0012): a broadcast
  -- failure NEVER aborts the user's write. A missed event degrades to the
  -- reconnect refetch path on the client. (And a money test that raises
  -- broadcasts nothing: the arm above fails closed.)
  RAISE WARNING 'realtime broadcast failed for %.% (%): %',
    TG_TABLE_NAME, v_row ->> 'id', TG_OP, SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_realtime_broadcast() FROM PUBLIC, anon, authenticated;


-- =============================================================================
-- 8. edit_history — a money file's history is for the people who see money
-- =============================================================================

-- 8a. The snapshot columns. NOT NULL DEFAULT false is the truth for every
--     non-files row; project_id is filled for files rows only (no FK, like
--     file_events: history outlives its subject).
ALTER TABLE public.edit_history
  ADD COLUMN IF NOT EXISTS is_financial BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.edit_history
  ADD COLUMN IF NOT EXISTS project_id UUID;

COMMENT ON COLUMN public.edit_history.is_financial IS
  '0088: for entity_type ''files'', true when the file was money-gated (file_row_is_money: invoices, receipts, rates, Legal files) at the time of the change, or by any old or new value the diff carries — snapshotted at capture by fn_edit_history_money_snapshot, so it survives the file''s deletion. Non-money readers (workspace managers without the project''s money gate) do not see flagged rows. False for every other entity type.';
COMMENT ON COLUMN public.edit_history.project_id IS
  '0088: the file''s project, for files rows only — what edit_history_select hands can_access_project_money. NULL for every other entity type.';

-- 8b. The classifier. ONE definition, used by the trigger and the backfill.
--     DEFINER: it reads files with RLS bypassed — the row a history entry is
--     about may be one the CALLER of the capture can no longer see (a delete).
--     The files row's CURRENT state, plus every old/new value the diff
--     carries: a delete's diff holds the old row, a create's the new one, an
--     update's only the changed columns. Fails CLOSED: anything that raises
--     answers "money", which hides the row from non-money readers.
CREATE OR REPLACE FUNCTION public.edit_history_file_class(
  p_entity_id UUID,
  p_diff      JSONB,
  OUT is_money   BOOLEAN,
  OUT project_id UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flag  BOOLEAN;
  v_path  TEXT;
  v_proj  UUID;
  v_found BOOLEAN;
BEGIN
  is_money := true;  -- fail closed until proven otherwise
  SELECT f.is_financial, f.storage_path, f.project_id
    INTO v_flag, v_path, v_proj
    FROM public.files f WHERE f.id = p_entity_id;
  v_found := FOUND;

  project_id := COALESCE(
    v_proj,
    public.fn_try_uuid(p_diff -> 'old' ->> 'project_id'),
    public.fn_try_uuid(p_diff -> 'new' ->> 'project_id'),
    public.fn_try_uuid(p_diff -> 'project_id' ->> 'new'),
    public.fn_try_uuid(p_diff -> 'project_id' ->> 'old'));

  is_money :=
       (v_found AND public.file_row_is_money(v_flag, v_path))
    OR public.file_row_is_money((p_diff -> 'new' ->> 'is_financial')::boolean,
                                p_diff -> 'new' ->> 'storage_path')
    OR public.file_row_is_money((p_diff -> 'old' ->> 'is_financial')::boolean,
                                p_diff -> 'old' ->> 'storage_path')
    OR public.file_row_is_money((p_diff -> 'is_financial' ->> 'new')::boolean,
                                p_diff -> 'storage_path' ->> 'new')
    OR public.file_row_is_money((p_diff -> 'is_financial' ->> 'old')::boolean,
                                p_diff -> 'storage_path' ->> 'old');
EXCEPTION WHEN OTHERS THEN
  is_money := true;
END;
$$;

REVOKE ALL ON FUNCTION public.edit_history_file_class(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edit_history_file_class(UUID, JSONB) TO service_role;

COMMENT ON FUNCTION public.edit_history_file_class(UUID, JSONB) IS
  '0088: classifies one files history entry — is_money (file_row_is_money over the file''s current row and every old/new value in the diff; true on any error, i.e. fails closed) and project_id. Used by trg_edit_history_money and 0088''s backfill. DEFINER; no client role executes it.';

-- 8c. The snapshot, at capture. A separate BEFORE INSERT trigger on
--     edit_history itself: fn_edit_history_capture (fourteen tables) stays as
--     0012/0061 wrote it. The only writer is that DEFINER capture (clients
--     hold SELECT alone, 0012), so a client cannot forge the flag.
CREATE OR REPLACE FUNCTION public.fn_edit_history_money_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.entity_type IS DISTINCT FROM 'files' THEN
    RETURN NEW;
  END IF;
  SELECT c.is_money, c.project_id
    INTO NEW.is_financial, NEW.project_id
    FROM public.edit_history_file_class(NEW.entity_id, NEW.diff) c;
  NEW.is_financial := COALESCE(NEW.is_financial, true);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  NEW.is_financial := true;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_edit_history_money_snapshot() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_edit_history_money ON public.edit_history;
CREATE TRIGGER trg_edit_history_money
  BEFORE INSERT ON public.edit_history
  FOR EACH ROW
  WHEN (NEW.entity_type = 'files')
  EXECUTE FUNCTION public.fn_edit_history_money_snapshot();

-- 8d. The history already written. Monotone: a flag is only ever SET, never
--     cleared, so a re-run cannot un-hide the history of a file that was
--     money when it was edited and is not now.
UPDATE public.edit_history eh
   SET is_financial = eh.is_financial OR c.is_money,
       project_id   = COALESCE(eh.project_id, c.project_id)
  FROM (SELECT x.id, cls.is_money, cls.project_id
          FROM public.edit_history x
         CROSS JOIN LATERAL public.edit_history_file_class(x.entity_id, x.diff) cls
         WHERE x.entity_type = 'files') c
 WHERE c.id = eh.id
   AND (   (c.is_money AND NOT eh.is_financial)
        OR (eh.project_id IS NULL AND c.project_id IS NOT NULL));

-- 8e. The policy: 0012's three arms verbatim, then the money arm. A flagged
--     row is for a workspace admin (proof outlives the project, the 0027 /
--     0074 admin arm) or the project's managers (can_access_project_money).
DROP POLICY IF EXISTS edit_history_select ON public.edit_history;
CREATE POLICY edit_history_select ON public.edit_history
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() IN ('admin', 'manager')
    AND public.has_active_membership(workspace_id)
    -- 0088: the money arm. COALESCE: NULL would deny anyway; say so.
    AND (NOT is_financial
         OR public.current_app_role() = 'admin'
         OR COALESCE(public.can_access_project_money(project_id), false))
  );

COMMENT ON POLICY edit_history_select ON public.edit_history IS
  '0012 restated by 0088: workspace admins and managers read their workspace''s edit history; a files row flagged is_financial (an invoice, receipt or Legal file, snapshotted at capture) is read only by a workspace admin or the project''s managers (can_access_project_money). Re-run 0088 after any replay of 0012.';


-- =============================================================================
-- 9. file_events_select — a Legal file's certificate is not every reader's
-- =============================================================================
-- 0074's policy, every arm restated, with ONE change in the money arm: the
-- 'purged' exception (ruling 22, invoices) no longer covers a certificate
-- whose path was under LEGAL. Every other event of a Legal file is already
-- flagged (its key is a money key) and hidden from non-money readers.

DROP POLICY IF EXISTS file_events_select ON public.file_events;
CREATE POLICY file_events_select ON public.file_events
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (
      -- Anyone who can read the project can read its files' history.
      public.can_read_project_topic(project_id)
      -- Admin arm: proof-of-deletion must stay readable after the project
      -- is purged (can_read_project_topic is false once the row is gone).
      OR public.current_app_role() = 'admin'
    )
    -- Track C / 0074 — the money arm (Audrey, ruling 22): a financial row is
    -- visible to a non-money reader ONLY as its deletion certificate.
    -- 0088: and not even then when the certificate names a Legal file.
    AND (
      NOT is_financial
      OR (event = 'purged'
          AND NOT public.rabbit_legal_segment(split_part(COALESCE(old_path, ''), '/', 3)))
      OR public.current_app_role() = 'admin'
      OR COALESCE(public.can_access_project_money(project_id), false)
    )
  );

COMMENT ON POLICY file_events_select ON public.file_events IS
  'Track C / 0074 restating 0027, and 0088: project readers and workspace admins read the stream; a financial row (is_financial — an invoice, receipt or Legal file) is hidden from non-money readers except an invoice''s purged certificate (ruling 22); a Legal file''s certificate is hidden too (0088). Every arm is in this one definition — re-run 0088 after any replay of 0027 or 0074.';


-- =============================================================================
-- 10. COMMENTS that are now false
-- =============================================================================

COMMENT ON COLUMN public.files.tags IS
  '0085 — the file''s categories, any of nine: Production, Creative, Legal, '
  'Finance, Reference, Assets, Code, Shots, Documentation (stored lower case; '
  'files_tags_known_chk). Several per file, beside document_kind. Finance is '
  'shown from is_financial and never written by the client. Since 0088 Legal '
  'is set when the file is added and never after: the legal tag and a LEGAL '
  'third path segment go together (files_legal_folder_chk), and such a row is '
  'money-gated (file_row_is_money). Starts empty on every row (no backfill).';

COMMENT ON COLUMN public.files.is_financial IS
  'Marks a file as financial (an invoice or receipt). The ROW is gated by file_row_is_money (0088) — this flag OR a locked third path segment (INVOICES, FINANCE, LEGAL) — in the four files_* policies: readable and writable only by can_access_project_money(project_id). The blob is gated separately by the rabbit_files_money_* storage policies keyed on the same segment (0042). A Legal file carries false here: its folder is its gate.';


-- =============================================================================
-- 11. POST-CONDITIONS — assert, do not assume
-- =============================================================================
-- Policy and CHECK predicates are compared WHOLE, as Postgres prints them (S4a
-- trap 16: a LIKE lets `OR true` through). ⚠️ That makes them deparse- and
-- order-sensitive by design (0078 §6's trade): a session whose search_path
-- lacks public would print schema-qualified names and fail a correct body.
-- Function bodies are checked with comments stripped (0077 §3c).

DO $$
DECLARE
  t         TEXT;
  v         TEXT;
  v_body    TEXT;
  v_hits    INT;
  v_n       INT;
  v_tgtype  SMALLINT;
  v_conf    TEXT[];
  -- The money arm as it prints inside every files policy clause.
  c_arm CONSTANT TEXT := '((NOT file_row_is_money(is_financial, storage_path)) OR can_access_project_money(project_id))';
  c_hop CONSTANT TEXT := '(EXISTS ( SELECT 1' || chr(10) || '   FROM projects p' || chr(10) || '  WHERE (p.id = files.project_id)))';
BEGIN
  -- 1. The list: LEGAL in any case, the two it had, nothing ordinary, never NULL.
  IF NOT public.rabbit_money_segment('LEGAL') OR NOT public.rabbit_money_segment('legal')
     OR NOT public.rabbit_money_segment('Legal') OR NOT public.rabbit_money_segment('INVOICES')
     OR NOT public.rabbit_money_segment('invoices') OR NOT public.rabbit_money_segment('FINANCE')
     OR public.rabbit_money_segment('ASSETS') OR public.rabbit_money_segment('project')
     OR public.rabbit_money_segment('LEGALS') OR public.rabbit_money_segment('')
     OR public.rabbit_money_segment(NULL) IS DISTINCT FROM false THEN
    RAISE EXCEPTION '0088 post-condition 1 failed: rabbit_money_segment does not classify LEGAL / INVOICES / FINANCE / ordinary / NULL correctly';
  END IF;

  -- 2. The Legal classifier, and that it is a SUBSET of the list.
  IF NOT public.rabbit_legal_segment('LEGAL') OR NOT public.rabbit_legal_segment('legal')
     OR public.rabbit_legal_segment('INVOICES') OR public.rabbit_legal_segment('FINANCE')
     OR public.rabbit_legal_segment('ASSETS') OR public.rabbit_legal_segment(NULL) IS DISTINCT FROM false THEN
    RAISE EXCEPTION '0088 post-condition 2 failed: rabbit_legal_segment does not classify correctly';
  END IF;
  FOREACH t IN ARRAY ARRAY['LEGAL', 'legal', 'Legal', 'lEgAl'] LOOP
    IF public.rabbit_legal_segment(t) AND NOT public.rabbit_money_segment(t) THEN
      RAISE EXCEPTION '0088 post-condition 2 failed: % is Legal but not locked — a Legal key would be readable by every project member', t;
    END IF;
  END LOOP;

  -- 3. The row classifier, both axes, never NULL.
  IF NOT public.file_row_is_money(true, 'projects/p/project/x/1-a.pdf')
     OR NOT public.file_row_is_money(false, 'projects/p/LEGAL/x/1-a.pdf')
     OR NOT public.file_row_is_money(false, 'projects/p/legal/x/1-a.pdf')
     OR NOT public.file_row_is_money(false, 'projects/p/INVOICES/x/1-a.pdf')
     OR NOT public.file_row_is_money(NULL, 'projects/p/FINANCE/RATES.json')
     OR public.file_row_is_money(false, 'projects/p/ASSETS/x/1-a.pdf')
     OR public.file_row_is_money(false, 'a-local-file.pdf')
     OR public.file_row_is_money(NULL, NULL) IS DISTINCT FROM false THEN
    RAISE EXCEPTION '0088 post-condition 3 failed: file_row_is_money does not read both axes, or returns NULL';
  END IF;

  -- 4. Grants: the three helpers are callable by authenticated (policies run
  --    as the invoker) and by nobody pre-auth; the DEFINER pieces by no client.
  FOREACH t IN ARRAY ARRAY['public.rabbit_money_segment(text)', 'public.rabbit_legal_segment(text)',
                           'public.file_row_is_money(boolean, text)'] LOOP
    IF NOT has_function_privilege('authenticated', t, 'EXECUTE')
       OR has_function_privilege('anon', t, 'EXECUTE') THEN
      RAISE EXCEPTION '0088 post-condition 4 failed: % must be executable by authenticated and not by anon (and so not PUBLIC)', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['public.edit_history_file_class(uuid, jsonb)', 'public.fn_edit_history_money_snapshot()',
                           'public.fn_trash_authz(text, uuid)', 'public.fn_realtime_broadcast()'] LOOP
    IF has_function_privilege('anon', t, 'EXECUTE') OR has_function_privilege('authenticated', t, 'EXECUTE') THEN
      RAISE EXCEPTION '0088 post-condition 4 failed: a client role can execute %', t;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', 'public.log_file_downloaded(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.log_file_downloaded(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0088 post-condition 4 failed: log_file_downloaded grants moved';
  END IF;

  -- 5. The four files policies: exactly these four, permissive, each clause
  --    WHOLE. The money arm is on all five clauses.
  IF (SELECT array_agg(policyname::TEXT ORDER BY policyname) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'files')
     IS DISTINCT FROM ARRAY['files_delete','files_insert','files_select','files_update']::TEXT[] THEN
    RAISE EXCEPTION '0088 post-condition 5 failed: public.files does not have exactly its four policies';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files'
              AND permissive <> 'PERMISSIVE') THEN
    RAISE EXCEPTION '0088 post-condition 5 failed: a files policy is not PERMISSIVE';
  END IF;
  SELECT qual INTO v FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_select';
  IF v IS DISTINCT FROM '((deleted_at IS NULL) AND (workspace_id = current_workspace_id()) AND ' || c_hop || ' AND ' || c_arm || ')' THEN
    RAISE EXCEPTION '0088 post-condition 5 failed: files_select reads %', v;
  END IF;
  SELECT with_check INTO v FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_insert';
  IF v IS DISTINCT FROM '((workspace_id = current_workspace_id()) AND has_active_membership(workspace_id) AND can_write_project(project_id) AND ' || c_arm || ' AND ' || c_hop || ')' THEN
    RAISE EXCEPTION '0088 post-condition 5 failed: files_insert reads %', v;
  END IF;
  SELECT qual INTO v FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_update';
  IF v IS DISTINCT FROM '((workspace_id = current_workspace_id()) AND has_active_membership(workspace_id) AND can_write_project(project_id) AND ' || c_arm || ')' THEN
    RAISE EXCEPTION '0088 post-condition 5 failed: files_update USING reads %', v;
  END IF;
  SELECT with_check INTO v FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_update';
  IF v IS DISTINCT FROM '((workspace_id = current_workspace_id()) AND can_write_project(project_id) AND ' || c_arm || ' AND ' || c_hop || ')' THEN
    RAISE EXCEPTION '0088 post-condition 5 failed: files_update WITH CHECK reads %', v;
  END IF;
  SELECT qual INTO v FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_delete';
  IF v IS DISTINCT FROM '((workspace_id = current_workspace_id()) AND has_active_membership(workspace_id) AND can_write_project(project_id) AND ' || c_arm || ')' THEN
    RAISE EXCEPTION '0088 post-condition 5 failed: files_delete reads %', v;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.files'::regclass
                  AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION '0088 post-condition 5 failed: RLS is no longer enabled and forced on public.files';
  END IF;

  -- 6. The CHECKs, whole: the two new ones, and 0050's money pin unchanged.
  SELECT pg_get_constraintdef(oid) INTO v FROM pg_constraint
   WHERE conrelid = 'public.files'::regclass AND contype = 'c' AND conname = 'files_legal_folder_chk';
  IF v IS DISTINCT FROM 'CHECK ((COALESCE((tags @> ARRAY[''legal''::text]), false) = rabbit_legal_segment(split_part(storage_path, ''/''::text, 3))))' THEN
    RAISE EXCEPTION '0088 post-condition 6 failed: files_legal_folder_chk reads %', v;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v FROM pg_constraint
   WHERE conrelid = 'public.files'::regclass AND contype = 'c' AND conname = 'files_legal_not_core_chk';
  IF v IS DISTINCT FROM 'CHECK ((NOT (is_core_definer AND (COALESCE((tags @> ARRAY[''legal''::text]), false) OR rabbit_legal_segment(split_part(storage_path, ''/''::text, 3))))))' THEN
    RAISE EXCEPTION '0088 post-condition 6 failed: files_legal_not_core_chk reads %', v;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v FROM pg_constraint
   WHERE conrelid = 'public.files'::regclass AND contype = 'c' AND conname = 'files_money_provider_chk';
  IF v IS DISTINCT FROM 'CHECK (((storage_provider = ''supabase''::storage_provider) OR (NOT (COALESCE(is_financial, false) OR rabbit_money_segment(split_part(storage_path, ''/''::text, 3))))))' THEN
    RAISE EXCEPTION '0088 post-condition 6 failed: files_money_provider_chk (0050) reads % — Legal bodies would no longer be pinned to Supabase', v;
  END IF;

  -- 7. The CHECK holds over the live table: as many rows carry the tag as sit
  --    under LEGAL, and none of them is core.
  IF (SELECT count(*) FROM public.files WHERE tags @> ARRAY['legal']::text[])
     <> (SELECT count(*) FROM public.files WHERE public.rabbit_legal_segment(split_part(storage_path, '/', 3)))
     OR EXISTS (SELECT 1 FROM public.files WHERE is_core_definer AND tags @> ARRAY['legal']::text[]) THEN
    RAISE EXCEPTION '0088 post-condition 7 failed: a files row has the legal tag without the LEGAL folder (or the reverse), or a Legal row is core';
  END IF;

  -- 8. The sixteen storage policies ride the list unchanged: eight per bucket,
  --    every one naming rabbit_money_segment, four per bucket naming the money
  --    gate; and the restrictive quota policy is still restrictive.
  FOREACH t IN ARRAY ARRAY['rabbit\_files%', 'rabbit\_thumbnails%'] LOOP
    SELECT count(*)::int INTO v_n FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE t;
    IF v_n <> 8 THEN
      RAISE EXCEPTION '0088 post-condition 8 failed: % storage policies named %, expected 8', v_n, t;
    END IF;
    SELECT count(*)::int INTO v_n FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE t
       AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%rabbit_money_segment(%';
    IF v_n <> 8 THEN
      RAISE EXCEPTION '0088 post-condition 8 failed: only % of the 8 % policies read rabbit_money_segment', v_n, t;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname LIKE 'rabbit\_%\_money\_%'
        AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%can_access_project_money(%') <> 8 THEN
    RAISE EXCEPTION '0088 post-condition 8 failed: the eight money storage policies do not all carry can_access_project_money';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                  AND policyname = 'petal_storage_quota_insert' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION '0088 post-condition 8 failed: petal_storage_quota_insert is missing or no longer RESTRICTIVE';
  END IF;

  -- 9. log_file_downloaded: the both-axes arm, and everything 0083 pinned.
  v_body := regexp_replace(regexp_replace(
              pg_get_functiondef('public.log_file_downloaded(uuid)'::regprocedure),
              '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g');
  IF strpos(v_body, 'public.file_row_is_money(v_file.is_financial, v_file.storage_path)') = 0
     OR strpos(v_body, 'NOT COALESCE(public.can_access_project_money(v_file.project_id), false)') = 0
     OR strpos(v_body, 'file_event_is_financial(') = 0
     OR strpos(v_body, 'public.has_active_membership(v_file.workspace_id)') = 0
     OR strpos(v_body, 'p.deleted_at IS NULL') = 0
     OR strpos(v_body, 'file not found or not readable') = 0 THEN
    RAISE EXCEPTION '0088 post-condition 9 failed: log_file_downloaded lost its both-axes money arm or one of 0083''s arms';
  END IF;
  -- The flag-only arm must be GONE, or a Legal file (no flag) slips through it.
  IF v_body ~ 'OR \(v_file\.is_financial\s+AND' THEN
    RAISE EXCEPTION '0088 post-condition 9 failed: log_file_downloaded still carries the flag-only money arm';
  END IF;
  v_hits := (length(v_body) - length(replace(v_body, 'passes_project_privacy(', ''))) / length('passes_project_privacy(');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION '0088 post-condition 9 failed: log_file_downloaded names passes_project_privacy % times (expected 1)', v_hits;
  END IF;

  -- 10. fn_trash_authz: 0067's allowlist (extracted, eight), 0082's arms, and
  --     the money arm for files.
  v_body := pg_get_functiondef('public.fn_trash_authz(text,uuid)'::regprocedure);
  v := substring(v_body from 'p_table NOT IN \(([^)]*)\)');
  IF v IS NULL OR array_length(string_to_array(v, ','), 1) <> 8 THEN
    RAISE EXCEPTION '0088 post-condition 10 failed: fn_trash_authz''s allowlist is not the eight tables (it reads %)', v;
  END IF;
  v_body := regexp_replace(regexp_replace(v_body, '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g');
  IF strpos(v_body, 'public.can_write_project(v_project)') = 0
     OR strpos(v_body, 'public.can_comment_project(v_project)') = 0
     OR strpos(v_body, 'public.has_active_membership(v_ws)') = 0
     OR strpos(v_body, 'public.current_workspace_id()') = 0
     OR strpos(v_body, 'public.file_row_is_money(v_flag, v_path)') = 0
     OR strpos(v_body, 'NOT COALESCE(public.can_access_project_money(v_project), false)') = 0 THEN
    RAISE EXCEPTION '0088 post-condition 10 failed: fn_trash_authz lost a gate or the files money arm';
  END IF;
  v_hits := (length(v_body) - length(replace(v_body, 'passes_project_privacy(', ''))) / length('passes_project_privacy(');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION '0088 post-condition 10 failed: fn_trash_authz names passes_project_privacy % times (expected 1)', v_hits;
  END IF;

  -- 11. fn_realtime_broadcast: every one of the twelve tables named exactly
  --     once (0077 §3d), the files arm returns before broadcasting a money
  --     row on either side, and the twelve triggers stand.
  v_body := regexp_replace(regexp_replace(
              pg_get_functiondef('public.fn_realtime_broadcast()'::regprocedure),
              '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g');
  FOREACH t IN ARRAY ARRAY['projects','phases','assets','tasks','files','comments',
                           'task_dependencies','phase_dependencies','task_links',
                           'asset_versions','project_members','milestones'] LOOP
    v_hits := (length(v_body) - length(replace(v_body, '''' || t || '''', ''))) / length('''' || t || '''');
    IF v_hits <> 1 THEN
      RAISE EXCEPTION '0088 post-condition 11 failed: fn_realtime_broadcast names % % times (expected exactly 1)', t, v_hits;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
                    WHERE tg.tgrelid = ('public.' || quote_ident(t))::regclass
                      AND tg.tgname = 'trg_' || t || '_realtime'
                      AND p.proname = 'fn_realtime_broadcast') THEN
      RAISE EXCEPTION '0088 post-condition 11 failed: trg_%_realtime is not attached to fn_realtime_broadcast', t;
    END IF;
  END LOOP;
  v_hits := (length(v_body) - length(replace(v_body, 'public.file_row_is_money(', ''))) / length('public.file_row_is_money(');
  IF v_hits <> 2
     OR v_body !~ 'WHEN ''files'' THEN\s+IF public\.file_row_is_money\(\(to_jsonb\(NEW\)'
     OR strpos(v_body, 'to_jsonb(OLD) ->> ''storage_path''') = 0 THEN
    RAISE EXCEPTION '0088 post-condition 11 failed: the files arm of fn_realtime_broadcast does not test both NEW and OLD for money before broadcasting';
  END IF;
  IF strpos(v_body, '''project_members'', ''milestones''') = 0 THEN
    RAISE EXCEPTION '0088 post-condition 11 failed: the project_id arm lost project_members/milestones (suite 72 probe 9)';
  END IF;

  -- 12. edit_history: the two columns, the trigger (BEFORE INSERT, FOR EACH
  --     ROW, the right function), the policy whole, and no files history row
  --     left unflagged for a file that is money now.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                  AND table_name = 'edit_history' AND column_name = 'is_financial'
                  AND is_nullable = 'NO' AND column_default = 'false')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                     AND table_name = 'edit_history' AND column_name = 'project_id' AND data_type = 'uuid') THEN
    RAISE EXCEPTION '0088 post-condition 12 failed: edit_history.is_financial / project_id are missing or mis-shaped';
  END IF;
  SELECT tg.tgtype INTO v_tgtype FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
   WHERE tg.tgrelid = 'public.edit_history'::regclass AND tg.tgname = 'trg_edit_history_money'
     AND p.proname = 'fn_edit_history_money_snapshot';
  IF v_tgtype IS NULL OR (v_tgtype & 1) = 0 OR (v_tgtype & 2) = 0 OR (v_tgtype & 4) = 0 THEN
    RAISE EXCEPTION '0088 post-condition 12 failed: trg_edit_history_money is missing, or not BEFORE INSERT FOR EACH ROW (tgtype %)', v_tgtype;
  END IF;
  SELECT qual INTO v FROM pg_policies WHERE schemaname = 'public' AND tablename = 'edit_history' AND policyname = 'edit_history_select';
  IF v IS DISTINCT FROM '((workspace_id = current_workspace_id()) AND (current_app_role() = ANY (ARRAY[''admin''::text, ''manager''::text])) AND has_active_membership(workspace_id) AND ((NOT is_financial) OR (current_app_role() = ''admin''::text) OR COALESCE(can_access_project_money(project_id), false)))' THEN
    RAISE EXCEPTION '0088 post-condition 12 failed: edit_history_select reads %', v;
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'edit_history') <> 1 THEN
    RAISE EXCEPTION '0088 post-condition 12 failed: edit_history must keep exactly one policy (SELECT); clients write nothing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.edit_history eh JOIN public.files f ON f.id = eh.entity_id
              WHERE eh.entity_type = 'files' AND NOT eh.is_financial
                AND public.file_row_is_money(f.is_financial, f.storage_path)) THEN
    RAISE EXCEPTION '0088 post-condition 12 failed: a money file still has unflagged edit history';
  END IF;

  -- 13. file_events_select, whole; still the one policy, SELECT only.
  SELECT qual INTO v FROM pg_policies WHERE schemaname = 'public' AND tablename = 'file_events' AND policyname = 'file_events_select';
  IF v IS DISTINCT FROM '((workspace_id = current_workspace_id()) AND has_active_membership(workspace_id) AND (can_read_project_topic(project_id) OR (current_app_role() = ''admin''::text)) AND ((NOT is_financial) OR ((event = ''purged''::text) AND (NOT rabbit_legal_segment(split_part(COALESCE(old_path, ''''::text), ''/''::text, 3)))) OR (current_app_role() = ''admin''::text) OR COALESCE(can_access_project_money(project_id), false)))' THEN
    RAISE EXCEPTION '0088 post-condition 13 failed: file_events_select reads %', v;
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'file_events') <> 1
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'file_events' AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION '0088 post-condition 13 failed: file_events must keep exactly one policy, SELECT only';
  END IF;

  -- 14. I6: Legal inherits 0078's bounded exemption, through the one list.
  IF NOT public.rabbit_quota_exempt_path('projects/x/LEGAL/x/1-contract.pdf')
     OR NOT public.rabbit_quota_exempt_bytes('projects/x/LEGAL/x/1-contract.pdf', 4000)
     OR public.rabbit_quota_exempt_bytes('projects/x/LEGAL/x/1-contract.pdf', public.rabbit_quota_exempt_max_bytes() + 1)
     OR NOT public.rabbit_money_key('projects/x/LEGAL/x/1-contract.pdf')
     OR NOT public.file_event_is_financial(false, 'projects/x/LEGAL/x/1-contract.pdf', NULL) THEN
    RAISE EXCEPTION '0088 post-condition 14 failed: a LEGAL key is not quota-exempt up to the bound, not weighed above it, or not a money key for file_events';
  END IF;

  RAISE NOTICE '0088 OK: LEGAL locked; four files policies on file_row_is_money; tag and folder tied, never core; realtime, edit history, trash, download log and certificates gated.';
END $$;
