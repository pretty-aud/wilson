-- =============================================================================
-- 0117_network_share_catalogue.sql — M.O.T.H. Session 1 (MO1): the office server's files
-- as ordinary file rows, and the desktop as their file manager (docs/design/MOTH_DESIGN.md
-- §1.4 "0117", §1.5, §1.6, §2.2 PS-7, §2.4).
--
-- Her answer 5, "it acts like a file manager": moving a row moves the real file, deleting
-- moves it into a bin folder on the server, and restore brings it back. Her answer 3,
-- "Yes, say so": a personal space in an office-server company keeps its files on that
-- server, in a folder the person is told about. No body ever reaches the cloud: a row holds
-- a locator, 'nas:' and a path relative to the company's drive, with forward slashes.
--
-- WHAT IS NEW
-- -----------
--   §1  network_share_locator_ok and network_share_bin_ok (IMMUTABLE), what a locator may
--       be; network_share_space_folder and network_share_claims (DEFINER, closed to
--       clients), the one answer to "which folder is this project's", and to "which
--       folders are taken".
--   §2  fn_projects_owner_guard, restated from 0114 with two arms: a folder that overlaps
--       another project's or space's is refused, and only an admin or a manager changes a
--       folder_slug. projects_folder_slug_shape_chk keeps a slug to one segment.
--   §3  files: three CHECKs and two indexes, and fn_files_network_share_delete_guard. 0114's
--       guard judges an UPDATE only (its note (g)), so a client's hard delete of an
--       office-server row is this file's to refuse.
--   §4  network_share_checks, "last checked", one row per space, with its own thin
--       broadcast. Clients read it through the project hop and write nothing.
--   §5  network_share_ops, the journal: no policies, no client grants. A purge at 04:50.
--   §6  network_share_catalogue_apply, what a walk of the folder found.
--   §7  The file manager's calls. Each writes first, journals, and leaves the desktop to
--       move the real file and settle: network_share_record_added, network_share_trash,
--       network_share_restore, network_share_settle, network_share_pending_mine. The move
--       and adopt cores are closed to clients and wait for 0118's fn_moth_apply_moves.
--   §8  COMMENTs; §9 post-conditions.
--
-- THE MARKER
-- ----------
-- wilson.network_share_writer is 'check:<project>' during an apply and 'op:<file>' around a
-- file operation's row write, reset to '' before return. It is what 0114's guard admits, so
-- every other writer of an office-server row fails closed. It never admits a project change:
-- that is the move journal's, and arrives with 0118.
--
-- WHAT THIS CHANGES FOR A RUNNING BUILD
-- -------------------------------------
-- Nothing until a client calls these functions; no build does yet. Two things reach every
-- build. A folder_slug containing a slash or a backslash, or text no folder could carry, is
-- refused. And in an office-server company a project whose folder overlaps another's is
-- refused: a desktop-to-cloud migration of a second project with the same folder name there
-- stops at that project with the sentence below. Outside such a company nothing reads a
-- claim, so nothing is refused.
--
-- BEFORE IT RUNS (PRODUCTION_RUNBOOK.md (b), this file's row)
-- -----------------------------------------------------------
-- One transaction, no enum added (0112 committed the label), re-runnable. It refuses without
-- 0112, 0108's edit_history arm, 0110, 0113, 0114 or 0116, when the running role does not
-- bypass row security, when a restated or named body is not what it was lifted from, and,
-- on the first run, when any row holds a 'nas:' path or says network_share.
-- =============================================================================

-- ALTER TABLE on projects and files needs ACCESS EXCLUSIVE: refuse rather than queue every
-- writer behind a long reader. A refusal here is safe; run it again.
SET LOCAL lock_timeout = '15s';

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
DECLARE
  v_md5 TEXT;
  v_n   BIGINT;
BEGIN
  -- Inside this block: the CLI that builds a fresh stack runs a file's statements one by one, and
  -- a bare LOCK TABLE there refuses ("can only be used in transaction blocks").
  LOCK TABLE public.projects IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.files IN SHARE ROW EXCLUSIVE MODE;

  IF NOT EXISTS (SELECT 1 FROM pg_enum e
                   JOIN pg_type t ON t.oid = e.enumtypid
                   JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'public' AND t.typname = 'storage_provider' AND e.enumlabel = 'network_share') THEN
    RAISE EXCEPTION '0117 refused: storage_provider has no network_share label; 0112 must be applied and committed first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'personal_owner_id') THEN
    RAISE EXCEPTION '0117 refused: projects.personal_owner_id is missing; 0110 must be applied first';
  END IF;
  IF to_regprocedure('public.edit_history_value_at(text,uuid,text,timestamptz,bigint)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_policies
                     WHERE schemaname = 'public' AND tablename = 'edit_history'
                       AND policyname = 'edit_history_select' AND qual LIKE '%captured_private%') THEN
    RAISE EXCEPTION '0117 refused: 0108''s edit_history privacy arm is not live, and a catalogue writes history';
  END IF;
  IF to_regprocedure('public.fn_checked_move_admits(uuid,uuid,uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION '0117 refused: 0113 must be applied first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'files' AND column_name = 'share_bin_path') THEN
    RAISE EXCEPTION '0117 refused: files.share_bin_path is missing; 0114 must be applied first';
  END IF;
  -- The definers below read and write tables with row security forced (0069's lesson).
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0117 refused: % does not bypass row security', current_user;
  END IF;

  -- What is restated below is what it was lifted from, or this file's. The others are named
  -- because this file rests on what they do.
  SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = 'public.purge_soft_deleted(interval)'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'a8dda2f3dc0b04eca7c216e6a4fcc8bf' AND v_md5 IS DISTINCT FROM 'f554aba88a2fbb933674b20ceb782486' THEN
    RAISE EXCEPTION '0117 refused: purge_soft_deleted is neither 0067''s body nor this file''s (md5 %)', v_md5;
  END IF;
  SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = 'public.fn_projects_owner_guard()'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'ba4ac337fa62d309793dfd99af6f99c8' AND v_md5 IS DISTINCT FROM '49ebe6b9f996f75682982dfbe1c842e4' THEN
    RAISE EXCEPTION '0117 refused: fn_projects_owner_guard is neither 0114''s body nor this file''s (md5 %)', v_md5;
  END IF;
  SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = 'public.fn_files_body_guard()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '41f85b1e0054ed178b314c09cb316d84' THEN
    RAISE EXCEPTION '0117 refused: fn_files_body_guard is not 0114''s body (md5 %)', v_md5;
  END IF;
  SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = 'public.fn_file_events_capture()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '8d0f8dbbc83b7efbbf5bd3d63f71b453' THEN
    RAISE EXCEPTION '0117 refused: fn_file_events_capture is not 0116''s body (md5 %)', v_md5;
  END IF;
  SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = 'public.fn_realtime_broadcast()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '34686e6bbb9ba89ecf012e003856e6da' THEN
    RAISE EXCEPTION '0117 refused: fn_realtime_broadcast is not 0116''s body (md5 %)', v_md5;
  END IF;

  -- Only a first run counts: once the CHECKs of §3 are on, they hold the rows. A client could
  -- write network_share between 0112 and 0114, and a 'nas:' path until now.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.files'::regclass AND conname = 'files_network_share_namespace_chk') THEN
    SELECT count(*) INTO v_n FROM public.files WHERE storage_provider::text = 'network_share';
    IF v_n <> 0 THEN
      RAISE EXCEPTION '0117 refused: % file row(s) already say network_share, which nothing has written; clear them by hand first', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM public.files WHERE storage_path LIKE 'nas:%';
    IF v_n <> 0 THEN
      RAISE EXCEPTION '0117 refused: % file row(s) hold a nas: path under another provider; clear them by hand first', v_n;
    END IF;
  END IF;
END $$;


-- §1 What a locator may be, and whose folder is whose ---------------------------
-- plpgsql, not SQL: these run once per row in the CHECKs and the apply (0111's trap, a
-- SQL-language helper with a pinned search_path is planned again on every call).

-- The shape alone, with no list of names. A project's folder_slug is held to this, because a
-- slug is a folder name the desktop chose and "Finance" is a fair title for a project.
CREATE OR REPLACE FUNCTION public.network_share_path_shape_ok(p text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  -- Never NULL: a CHECK admits NULL.
  RETURN p IS NOT NULL
    AND p <> ''
    AND length(p) <= 1024
    -- The unique index holds bytes, and a btree refuses a row over about 2,700 of them.
    AND octet_length(p) <= 2000
    AND p IS NFC NORMALIZED
    -- A leading or trailing slash, or an empty segment.
    AND p !~ '^/|/$|//'
    -- A backslash, a stream or drive colon, what Windows refuses in a name, the C0 and C1
    -- controls, and what makes a name read as something else: bidi marks, zero-width marks,
    -- the BOM, variation selectors and TAG code points.
    AND p !~ '[\\:*?"<>|\u0001-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufe00-\ufe0f\ufeff\U000e0000-\U000e007f\U000e0100-\U000e01ef]'
    -- A dot-led segment, so '..' and '.wilson-bin' are never a locator.
    AND p !~ '(^|/)\.'
    -- A segment ending in a dot or a space, which Windows would quietly drop.
    AND p !~ '[. ](/|$)'
    -- A short name: Windows and Samba can answer to '_WILSO~1' for a longer folder, and every
    -- name test here would read it as some other folder. A real file called this is not listed.
    AND p !~* '(^|/)[^./~]{1,6}~[0-9a-z]{1,3}([.][^./]{0,3})?(/|$)';
END;
$$;

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
       OR lower(seg) ~ '_(receipts&invoices|crewinvoices|talentinvoices|databases)$' THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

-- '<space folder>/.wilson-bin/<file id>/<leaf>'.
CREATE OR REPLACE FUNCTION public.network_share_bin_ok(p text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text[];
BEGIN
  v := regexp_match(p, '^(.+)/\.wilson-bin/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([^/]+)$');
  RETURN v IS NOT NULL
    AND public.network_share_locator_ok(v[1])
    AND public.network_share_locator_ok(v[3]);
END;
$$;

-- The CHECKs of §3 run as whoever writes the row, and a CHECK asks for EXECUTE as that role.
REVOKE ALL ON FUNCTION public.network_share_path_shape_ok(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.network_share_locator_ok(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.network_share_bin_ok(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_share_path_shape_ok(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.network_share_locator_ok(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.network_share_bin_ok(text) TO authenticated, service_role;

-- A walk's modified time: an ISO timestamp from 1980 to tomorrow, else NULL. The regex comes
-- before the cast and the handler catches what a regex cannot, such as the 31st of February.
CREATE OR REPLACE FUNCTION public._network_share_mtime(p text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v timestamptz;
BEGIN
  IF p IS NULL OR p !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$' THEN
    RETURN NULL;
  END IF;
  v := p::timestamptz;
  IF v < timestamptz '1980-01-01 00:00:00+00' OR v > now() + interval '1 day' THEN
    RETURN NULL;
  END IF;
  RETURN v;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
  RETURN NULL;
END;
$$;

-- The company's drive, only when its storage is an office server's: byos, network, UNC. A
-- local root is a different folder on every computer. Only mode = 'byos' makes the provider
-- active: a company back on Petal keeps its old row (0113's review).
CREATE OR REPLACE FUNCTION public._network_share_drive(p_ws uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v text;
BEGIN
  SELECT ws.root_path INTO v
    FROM public.workspace_storage ws
   WHERE ws.workspace_id = p_ws
     AND ws.mode = 'byos'
     AND ws.provider = 'network'
     AND ws.root_kind = 'unc';
  RETURN v;
END;
$$;

-- A stored folder_root, relative to the drive with forward slashes, or NULL when it does not
-- sit strictly inside: 0049's own test, because 0049 never looks again after the drive moves.
CREATE OR REPLACE FUNCTION public._network_share_inside(p_root text, p_folder_root text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_root IS NULL OR p_folder_root IS NULL
     OR lower(left(p_folder_root, length(p_root) + 1)) <> lower(p_root) || chr(92) THEN
    RETURN NULL;
  END IF;
  RETURN replace(substr(p_folder_root, length(p_root) + 2), chr(92), '/');
END;
$$;

CREATE OR REPLACE FUNCTION public._network_share_placed(p_root text, p_folder_root text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text := public._network_share_inside(p_root, p_folder_root);
BEGIN
  IF public.network_share_locator_ok(v) THEN
    RETURN v;
  END IF;
  RETURN NULL;
END;
$$;

-- Equal, inside or containing, by whole segments and whatever the case. starts_with, because
-- LIKE would read the underscores of _WILSON_PERSONAL as wildcards.
CREATE OR REPLACE FUNCTION public._network_share_overlaps(a text, b text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  la text := lower(a);
  lb text := lower(b);
BEGIN
  RETURN COALESCE(la = lb OR starts_with(la, lb || '/') OR starts_with(lb, la || '/'), false);
END;
$$;

-- A space's folder, relative to the drive: a personal space's fixed folder, or a folder_root
-- placed inside the drive, or NULL, which means not listed. Never a slug or a title (NS-SEC-01:
-- a member can write those). §1.2 item e: computed only here.
CREATE OR REPLACE FUNCTION public.network_share_space_folder(p_project uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_ws    uuid;
  v_owner uuid;
  v_fr    text;
  v_root  text;
BEGIN
  SELECT p.workspace_id, p.personal_owner_id, p.folder_root INTO v_ws, v_owner, v_fr
    FROM public.projects p WHERE p.id = p_project;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_root := public._network_share_drive(v_ws);
  IF v_root IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_owner IS NOT NULL THEN
    RETURN '_WILSON_PERSONAL/' || v_owner::text;
  END IF;
  RETURN public._network_share_placed(v_root, v_fr);
END;
$$;

-- Every folder taken in a company, by every project in any state, and the reserved parent
-- under no project. A folder_root that no longer sits inside the drive is an unplaced claim:
-- nobody can say what it overlaps, so an apply refuses rather than skips. One inside the drive
-- under a name no catalogue may hold still claims its path: its own project reads no_folder and
-- nobody else is stopped. A slug claims its
-- segment only where there is no folder_root, and only if it could be a locator at all.
-- The nesting arm and the apply read only this.
CREATE OR REPLACE FUNCTION public.network_share_claims(p_ws uuid)
RETURNS TABLE (project_id uuid, prefix text, placed boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_root text := public._network_share_drive(p_ws);
BEGIN
  RETURN QUERY
    SELECT NULL::uuid, '_WILSON_PERSONAL'::text, true
    UNION ALL
    SELECT c.id, c.prefix, c.prefix IS NOT NULL
      FROM (
        SELECT p.id,
               CASE WHEN p.personal_owner_id IS NOT NULL THEN '_WILSON_PERSONAL/' || p.personal_owner_id::text
                    WHEN p.folder_root IS NOT NULL THEN public._network_share_inside(v_root, p.folder_root)
                    ELSE p.folder_slug
               END AS prefix
          FROM public.projects p
         WHERE p.workspace_id = p_ws
           AND (p.personal_owner_id IS NOT NULL
                OR p.folder_root IS NOT NULL
                OR public.network_share_locator_ok(p.folder_slug))
      ) c;
END;
$$;

-- Would this folder overlap a claim of another project or space? Asked only where the company
-- is on an office server: nothing elsewhere reads a claim, and two desktops' projects may
-- share a folder name in a company whose files are in the cloud.
CREATE OR REPLACE FUNCTION public._network_share_claim_taken(
  p_ws uuid, p_project uuid, p_folder_root text, p_folder_slug text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_root   text := public._network_share_drive(p_ws);
  v_prefix text;
BEGIN
  IF v_root IS NULL THEN
    RETURN false;
  END IF;
  IF p_folder_root IS NOT NULL THEN
    v_prefix := public._network_share_inside(v_root, p_folder_root);
  ELSIF public.network_share_locator_ok(p_folder_slug) THEN
    v_prefix := p_folder_slug;
  END IF;
  IF v_prefix IS NULL THEN
    RETURN false;
  END IF;
  -- A project that has left a folder can still have rows, or an unsettled operation, there. Those
  -- files are not a new tenant's yet: its trash or its walk would meet them.
  RETURN EXISTS (SELECT 1 FROM public.network_share_claims(p_ws) c
                  WHERE c.project_id IS DISTINCT FROM p_project
                    AND c.placed
                    AND public._network_share_overlaps(c.prefix, v_prefix))
      OR EXISTS (SELECT 1 FROM public.files h
                  WHERE h.workspace_id = p_ws
                    AND h.storage_provider = 'network_share'
                    AND h.deleted_at IS NULL
                    AND h.project_id IS DISTINCT FROM p_project
                    AND starts_with(lower(h.storage_path), 'nas:' || lower(v_prefix) || '/'))
      OR EXISTS (SELECT 1 FROM public.network_share_ops o
                  WHERE o.workspace_id = p_ws
                    AND o.state = 'pending'
                    AND o.project_id IS DISTINCT FROM p_project
                    AND (starts_with(lower(o.from_locator), lower(v_prefix) || '/')
                         OR starts_with(lower(o.to_locator), lower(v_prefix) || '/')));
END;
$$;

-- Inside the company's drive, and under a name no catalogue may hold: its own root, a money or
-- Legal name, a dot-led folder, a short name. It would never come up, so it is refused when it is
-- set, where the person can still choose another.
CREATE OR REPLACE FUNCTION public._network_share_folder_refused(p_ws uuid, p_folder_root text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_root text := public._network_share_drive(p_ws);
  v_rel  text;
BEGIN
  IF v_root IS NULL OR p_folder_root IS NULL THEN
    RETURN false;
  END IF;
  IF lower(p_folder_root) = lower(v_root) THEN
    RETURN true;
  END IF;
  v_rel := public._network_share_inside(v_root, p_folder_root);
  RETURN v_rel IS NOT NULL AND NOT public.network_share_locator_ok(v_rel);
END;
$$;

-- This space's folder is its own: no claim nobody can place, and none over or under it. Every
-- definer that names a real file asks this, not only the apply, because a desktop acts on what it
-- returns. The reserved parent holds every personal folder by design, so it counts against
-- everyone else.
CREATE OR REPLACE FUNCTION public._network_share_assert_folder(p_ws uuid, p_project uuid, p_folder text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT p.personal_owner_id INTO v_owner FROM public.projects p WHERE p.id = p_project;
  IF EXISTS (SELECT 1 FROM public.network_share_claims(p_ws) c WHERE NOT c.placed) THEN
    RAISE EXCEPTION 'network_share: folders_unplaced';
  END IF;
  IF EXISTS (SELECT 1 FROM public.network_share_claims(p_ws) c
              WHERE c.project_id IS DISTINCT FROM p_project
                AND public._network_share_overlaps(c.prefix, p_folder)
                AND NOT (v_owner IS NOT NULL AND c.project_id IS NULL)) THEN
    RAISE EXCEPTION 'network_share: folder_shared';
  END IF;
END;
$$;

-- NS-D9, the two seats. Both answer for the caller in the caller's company, on a live project,
-- and never NULL. A check publishes file names to everyone on the project, so it needs the
-- roster seat (her rule until NS-Q1, I-10); a personal space's owner holds both, and an admin
-- holds neither there.
CREATE OR REPLACE FUNCTION public._network_share_may_check(p_project uuid)
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
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT COALESCE(public.has_active_membership(v_ws), false) THEN
    RETURN false;
  END IF;
  SELECT p.personal_owner_id INTO v_owner
    FROM public.projects p
   WHERE p.id = p_project AND p.workspace_id = v_ws AND p.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_owner IS NOT NULL THEN
    RETURN v_owner = auth.uid();
  END IF;
  RETURN COALESCE(public.can_manage_project_roster(p_project) AND public.passes_project_privacy(p_project), false);
END;
$$;

CREATE OR REPLACE FUNCTION public._network_share_may_write(p_project uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_ws uuid := public.current_workspace_id();
BEGIN
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT COALESCE(public.has_active_membership(v_ws), false) THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects p
                  WHERE p.id = p_project AND p.workspace_id = v_ws AND p.deleted_at IS NULL) THEN
    RETURN false;
  END IF;
  -- can_write_project is owner-only on a personal space (0110).
  RETURN COALESCE(public.can_write_project(p_project) AND public.passes_project_privacy(p_project), false);
END;
$$;

-- In order, so two calls over the same projects cannot deadlock. An apply takes the same lock,
-- so a walk never reads the journal while an operation it should skip is being written.
CREATE OR REPLACE FUNCTION public._network_share_lock_projects(p_projects uuid[])
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v uuid;
BEGIN
  FOR v IN SELECT DISTINCT x FROM unnest(p_projects) x WHERE x IS NOT NULL ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('network_share:' || v::text, 0));
  END LOOP;
END;
$$;


-- §2 The projects guard, restated from 0114, and the slug's shape --------------------
CREATE OR REPLACE FUNCTION public.fn_projects_owner_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- A client caller: PostgREST's role, unchanged inside a client-called
  -- definer RPC (soft_delete_row, ensure_personal_space). The migration runner
  -- and service_role are not bound.
  v_bound BOOLEAN := COALESCE(current_setting('role', true), '') IN ('authenticated', 'anon');
  v_ws    UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_bound THEN
      NEW.created_by := auth.uid();
      NEW.topic_epoch := 0;
      -- 0110: an id this company has already had, held by no row now. Its
      -- history, file events and comments still name it, and would open to
      -- whoever created it again (the 0108 review). A live row's id still
      -- answers the primary key's 23505, as before. This guard sorts before
      -- trg_projects_populate_workspace, hence the COALESCE. Judged only for a
      -- caller projects_insert would admit in this company (an active admin
      -- or manager): for anyone else RLS answers, so the refusal tells nobody
      -- else that an id was ever used (review round 1).
      v_ws := COALESCE(NEW.workspace_id, public.current_workspace_id());
      IF v_ws = public.current_workspace_id()
         AND public.has_active_membership(v_ws)
         AND public.current_app_role() IN ('admin', 'manager')
         AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.id)
         AND (EXISTS (SELECT 1 FROM public.edit_history h
                       WHERE h.entity_type = 'projects' AND h.entity_id = NEW.id AND h.workspace_id = v_ws)
              OR EXISTS (SELECT 1 FROM public.file_events fe
                          WHERE fe.project_id = NEW.id AND fe.workspace_id = v_ws)
              OR EXISTS (SELECT 1 FROM public.comments c
                          WHERE c.entity_type = 'project' AND c.entity_id = NEW.id AND c.workspace_id = v_ws)) THEN
        RAISE EXCEPTION 'That project was deleted for good, and its id cannot be used again. Make a new project.'
          USING ERRCODE = '42501';
      END IF;
      -- 0114: an id another company's keys or file events name (SB-18). Judged for the
      -- same callers as the arm above, so nobody else learns that the id exists.
      IF v_ws = public.current_workspace_id()
         AND public.has_active_membership(v_ws)
         AND public.current_app_role() IN ('admin', 'manager')
         AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.id)
         AND rabbit_private.project_id_tied_elsewhere(NEW.id, v_ws) THEN
        RAISE EXCEPTION 'This project cannot be brought in under that id. Make a new project.'
          USING ERRCODE = '42501';
      END IF;
      -- 0117: a folder on the company server is one project's or space's. Judged for the
      -- same callers again. ensure_personal_space sets neither column, and its folder is
      -- computed under the reserved parent, which no other claim may touch.
      IF v_ws = public.current_workspace_id()
         AND public.has_active_membership(v_ws)
         AND public.current_app_role() IN ('admin', 'manager')
         AND public._network_share_claim_taken(v_ws, NEW.id, NEW.folder_root, NEW.folder_slug) THEN
        RAISE EXCEPTION 'This folder is already used by another project or space on the company server.'
          USING ERRCODE = '42501';
      END IF;
      IF v_ws = public.current_workspace_id()
         AND public.has_active_membership(v_ws)
         AND public.current_app_role() IN ('admin', 'manager')
         AND public._network_share_folder_refused(v_ws, NEW.folder_root) THEN
        RAISE EXCEPTION 'WILSON cannot keep a project''s files in this folder on the company server. Choose another.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF v_bound THEN
    -- 0110: a project keeps its id. A changed id would take over a deleted
    -- project's leftovers as surely as an INSERT of it (review round 1); no
    -- client flow changes one (0108's re-key trigger serves the service).
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'A project keeps its id.'
        USING ERRCODE = '42501';
    END IF;
    NEW.created_by := OLD.created_by;
    NEW.topic_epoch := OLD.topic_epoch;
    -- 0110: a personal space keeps its owner, stays private, never goes in
    -- the bin and keeps its folder, for every client, admins included.
    IF NEW.personal_owner_id IS DISTINCT FROM OLD.personal_owner_id THEN
      RAISE EXCEPTION 'A personal space keeps its owner.'
        USING ERRCODE = '42501';
    END IF;
    IF OLD.personal_owner_id IS NOT NULL
       AND (NEW.is_private IS DISTINCT FROM OLD.is_private
            OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
            OR NEW.folder_slug IS DISTINCT FROM OLD.folder_slug
            OR NEW.folder_root IS DISTINCT FROM OLD.folder_root) THEN
      RAISE EXCEPTION 'A personal space cannot be shared, put in the bin or moved to another folder. Its files can.'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.is_private IS DISTINCT FROM OLD.is_private
       AND NOT (OLD.created_by = auth.uid() OR public.current_app_role() = 'admin') THEN
      RAISE EXCEPTION 'Only the person who made this project, or an admin, can change who can see it.'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.producer_id IS DISTINCT FROM OLD.producer_id AND NEW.producer_id IS NOT NULL
       AND NOT COALESCE(public.can_manage_project_roster(OLD.id), false) THEN
      RAISE EXCEPTION 'Only someone who manages this project''s team can choose its producer.'
        USING ERRCODE = '42501';
    END IF;
    -- 0117 (NS-SEC-01): projects_update admits every member of an unstaffed project, and 0049
    -- looks at folder_root alone. COALESCE, because a NULL role would read as allowed.
    IF NEW.folder_slug IS DISTINCT FROM OLD.folder_slug
       AND NOT COALESCE(public.current_app_role() IN ('admin', 'manager'), false) THEN
      RAISE EXCEPTION 'Only an admin or a manager can change a project''s folder.'
        USING ERRCODE = '42501';
    END IF;
    -- 0117 (NS-SEC-06): as at INSERT. The sentence names only a folder the person setting it
    -- can see on the share already.
    IF (NEW.folder_root IS DISTINCT FROM OLD.folder_root OR NEW.folder_slug IS DISTINCT FROM OLD.folder_slug)
       AND public._network_share_claim_taken(NEW.workspace_id, NEW.id, NEW.folder_root, NEW.folder_slug) THEN
      RAISE EXCEPTION 'This folder is already used by another project or space on the company server.'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.folder_root IS DISTINCT FROM OLD.folder_root
       AND public._network_share_folder_refused(NEW.workspace_id, NEW.folder_root) THEN
      RAISE EXCEPTION 'WILSON cannot keep a project''s files in this folder on the company server. Choose another.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Every caller: a narrowing of the audience moves the project to a new topic.
  IF (OLD.is_private IS NOT TRUE AND NEW.is_private IS TRUE)
     OR (NEW.is_private IS TRUE AND NEW.created_by IS DISTINCT FROM OLD.created_by) THEN
    NEW.topic_epoch := OLD.topic_epoch + 1;
  END IF;
  RETURN NEW;
END;
$$;

-- One segment, in the shape a folder could have. An empty slug is what the desktop's
-- fileSlugify makes of a title with no letters, and it claims nothing. Money and Legal names
-- pass here on purpose: a slug is a claim and never a catalogue folder, and a project called
-- Finance must still come up from the desktop.
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_folder_slug_shape_chk;
ALTER TABLE public.projects ADD CONSTRAINT projects_folder_slug_shape_chk
  CHECK (folder_slug IS NULL
         OR folder_slug = ''
         OR (folder_slug !~ '[/\\]' AND public.network_share_path_shape_ok(folder_slug)))
  NOT VALID;

DO $$
DECLARE
  v_n BIGINT;
BEGIN
  SELECT count(*) INTO v_n FROM public.projects
   WHERE NOT (folder_slug IS NULL
              OR folder_slug = ''
              OR (folder_slug !~ '[/\\]' AND public.network_share_path_shape_ok(folder_slug)));
  IF v_n = 0 THEN
    ALTER TABLE public.projects VALIDATE CONSTRAINT projects_folder_slug_shape_chk;
  ELSE
    -- Left NOT VALID: such a row refuses every later UPDATE until its slug is cleared by hand.
    RAISE NOTICE '0117: % project(s) hold a folder_slug that is not one segment; the CHECK stays NOT VALID', v_n;
  END IF;
END $$;


-- §3 files: the shape, the identity, and no hard delete by a client --------------------
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_network_share_shape_chk;
ALTER TABLE public.files ADD CONSTRAINT files_network_share_shape_chk
  CHECK (storage_provider <> 'network_share'
         OR (left(storage_path, 4) = 'nas:'
             AND public.network_share_locator_ok(substr(storage_path, 5))
             AND thumbnail_url IS NULL
             AND NOT COALESCE(is_financial, false)
             AND NOT ('legal' = ANY (COALESCE(tags, '{}'::text[])))));

-- A 'nas:' path never reaches the bodies' index, and a 'projects/' key never this one's.
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_network_share_namespace_chk;
ALTER TABLE public.files ADD CONSTRAINT files_network_share_namespace_chk
  CHECK ((storage_provider = 'network_share') = (left(storage_path, 4) = 'nas:'));

ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_network_share_extra_chk;
ALTER TABLE public.files ADD CONSTRAINT files_network_share_extra_chk
  CHECK ((share_missing_since IS NULL AND share_bin_path IS NULL)
         OR (storage_provider = 'network_share'
             AND (share_bin_path IS NULL OR public.network_share_bin_ok(share_bin_path))));

-- NS-D4: live rows only, so a new file can be listed at a trashed file's old name. A trashed
-- row keeps its storage_path and says where it is in share_bin_path.
CREATE UNIQUE INDEX IF NOT EXISTS files_network_share_locator_key
  ON public.files (workspace_id, lower(storage_path))
  WHERE storage_provider = 'network_share' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS files_network_share_project_idx
  ON public.files (project_id, lower(storage_path))
  WHERE storage_provider = 'network_share';

-- 0114's note (g). BEFORE DELETE at depth 1 is a statement of the caller's own: a foreign
-- key's cascade from a project's delete fires this at depth 2 and passes, and so do the
-- purge (cron), and service-side teardown, which are not bound. A guarded DELETE must RETURN
-- OLD: RETURN NEW would silently skip it.
CREATE OR REPLACE FUNCTION public.fn_files_network_share_delete_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.storage_provider::text = 'network_share'
     AND COALESCE(current_setting('role', true), '') IN ('authenticated', 'anon')
     AND pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'A file on your office server changes only through the desktop app.'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_files_network_share_delete_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_files_network_share_delete_guard ON public.files;
CREATE TRIGGER trg_files_network_share_delete_guard
  BEFORE DELETE ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.fn_files_network_share_delete_guard();


-- §4 network_share_checks: last checked, one row per space -----------------------------
CREATE TABLE IF NOT EXISTS public.network_share_checks (
  project_id        uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  folder_locator    text NOT NULL,
  -- A check's own clock (NS-X13): now() is the transaction's start.
  last_checked_at   timestamptz,
  last_checked_by   uuid,
  complete          boolean NOT NULL DEFAULT false,
  dirs_checked      integer NOT NULL DEFAULT 0,
  files_seen        integer NOT NULL DEFAULT 0,
  missing_count     integer NOT NULL DEFAULT 0,
  -- Where a capped walk starts next time (NS-X07).
  next_start        text,
  -- A walk is several calls: until the final one, the counts above are that walk's so far.
  run_open          boolean NOT NULL DEFAULT false,
  -- The rate limit (NS-SEC-11), counted under the advisory lock.
  window_started_at timestamptz,
  calls_in_window   integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  CONSTRAINT network_share_checks_folder_chk CHECK (public.network_share_locator_ok(folder_locator)),
  CONSTRAINT network_share_checks_next_chk CHECK (next_start IS NULL OR public.network_share_locator_ok(next_start)),
  CONSTRAINT network_share_checks_counts_chk CHECK (dirs_checked >= 0 AND files_seen >= 0 AND missing_count >= 0 AND calls_in_window >= 0)
);

CREATE INDEX IF NOT EXISTS network_share_checks_workspace_idx ON public.network_share_checks (workspace_id);

ALTER TABLE public.network_share_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.network_share_checks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.network_share_checks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.network_share_checks TO authenticated;
GRANT ALL ON public.network_share_checks TO service_role;

-- The hop reads projects as the caller, so 0072's privacy follows, and a personal space is its
-- owner's and the admins'. A trashed project's row reads as gone, even to an admin.
DROP POLICY IF EXISTS network_share_checks_select ON public.network_share_checks;
CREATE POLICY network_share_checks_select ON public.network_share_checks
  FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id()
         AND public.has_active_membership(workspace_id)
         AND EXISTS (SELECT 1 FROM public.projects p
                      WHERE p.id = network_share_checks.project_id
                        AND p.deleted_at IS NULL));

DROP TRIGGER IF EXISTS trg_network_share_checks_populate_workspace ON public.network_share_checks;
CREATE TRIGGER trg_network_share_checks_populate_workspace
  BEFORE INSERT ON public.network_share_checks
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();
DROP TRIGGER IF EXISTS trg_network_share_checks_audit ON public.network_share_checks;
CREATE TRIGGER trg_network_share_checks_audit
  BEFORE INSERT OR UPDATE ON public.network_share_checks
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();

-- 0101's shape, and the project's id alone: NS-D10, one signal for a check instead of a row
-- broadcast per file. The 18-table trigger pins stay true because this is its own function.
-- A walk's earlier calls say nothing: only the final one moves last_checked_at.
CREATE OR REPLACE FUNCTION public.fn_network_share_checks_broadcast()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project UUID;
  v_topic   TEXT;
BEGIN
  -- A stack without realtime.send (CI's) skips. The EXCEPTION guard below is the backstop.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'realtime' AND p.proname = 'send'
  ) THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.last_checked_at IS NOT DISTINCT FROM OLD.last_checked_at THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.last_checked_at IS NULL THEN
    RETURN NULL;
  END IF;
  v_project := CASE WHEN TG_OP = 'DELETE' THEN OLD.project_id ELSE NEW.project_id END;
  v_topic := public.project_topic(v_project);
  IF v_topic IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM realtime.send(
    jsonb_build_object('table', TG_TABLE_NAME, 'schema', TG_TABLE_SCHEMA, 'operation', TG_OP,
                       'record', jsonb_build_object('id', v_project, 'project_id', v_project)),
    TG_OP,
    v_topic,
    true
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Live sync must never break the write. A missed event degrades to the next load.
  RAISE WARNING 'network_share_checks broadcast failed (%): %', TG_OP, SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_network_share_checks_broadcast() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_network_share_checks_broadcast ON public.network_share_checks;
CREATE TRIGGER trg_network_share_checks_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON public.network_share_checks
  FOR EACH ROW EXECUTE FUNCTION public.fn_network_share_checks_broadcast();


-- §5 network_share_ops: the journal -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.network_share_ops (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Goes with its row, so nothing here outlives a file whose id may be sent again.
  file_id         uuid NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL,
  dest_project_id uuid,
  op              text NOT NULL,
  -- Locators without 'nas:': what the desktop renames. No from_locator on an adopt, whose body
  -- is on a computer, and none on an add.
  from_locator    text,
  to_locator      text NOT NULL,
  -- What 'not_moved' puts back.
  origin          jsonb NOT NULL DEFAULT '{}'::jsonb,
  state           text NOT NULL DEFAULT 'pending',
  created_by      uuid NOT NULL DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  settled_at      timestamptz,
  CONSTRAINT network_share_ops_op_chk CHECK (op IN ('trash', 'restore', 'move', 'add', 'adopt')),
  CONSTRAINT network_share_ops_state_chk CHECK (state IN ('pending', 'done', 'reverted')),
  CONSTRAINT network_share_ops_settled_chk CHECK ((state = 'pending') = (settled_at IS NULL)),
  CONSTRAINT network_share_ops_origin_chk CHECK (octet_length(origin::text) <= 4000)
);

CREATE UNIQUE INDEX IF NOT EXISTS network_share_ops_one_pending_uidx
  ON public.network_share_ops (file_id) WHERE state = 'pending';
-- The partial index above cannot serve the foreign key's cascade for settled rows.
CREATE INDEX IF NOT EXISTS network_share_ops_file_idx
  ON public.network_share_ops (file_id);
CREATE INDEX IF NOT EXISTS network_share_ops_from_idx
  ON public.network_share_ops (workspace_id, lower(from_locator)) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS network_share_ops_to_idx
  ON public.network_share_ops (workspace_id, lower(to_locator)) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS network_share_ops_mine_idx
  ON public.network_share_ops (created_by) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS network_share_ops_settled_idx
  ON public.network_share_ops (settled_at) WHERE state <> 'pending';

ALTER TABLE public.network_share_ops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.network_share_ops FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.network_share_ops FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.network_share_ops TO service_role;

CREATE OR REPLACE FUNCTION public.purge_network_share_ops(p_retention interval DEFAULT interval '90 days')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_n INT;
BEGIN
  IF p_retention IS NULL OR p_retention < interval '1 day' THEN
    RAISE EXCEPTION 'purge_network_share_ops: the retention must be at least a day';
  END IF;
  -- A pending operation stays however old it is: it is the only record of where a file went.
  DELETE FROM public.network_share_ops
   WHERE state <> 'pending' AND settled_at < now() - p_retention;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_network_share_ops(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_network_share_ops(interval) TO service_role;

-- Restated from 0067, one arm. A trashed row whose operation has not settled stays past its 30
-- days: its journal is the only record of where the file went, and a purge would certify a bin the
-- file never reached, and the next walk would list the file again as new. It is purged the night
-- after the operation settles. Its grants and its nightly job stand.
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
  -- Parents first so cascades do the bulk of the work; the remaining loops
  -- catch individually soft-deleted children.
  FOREACH t IN ARRAY ARRAY['projects','assets','tasks','phases','files',
                           'comments','rate_cards','milestones']
  LOOP
    IF t = 'files' THEN
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

-- cron.schedule() upserts by job name, so a re-run is idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule(
      'wilson-purge-network-share-ops',
      '50 4 * * *',
      $job$ SELECT public.purge_network_share_ops(); $job$
    );
  ELSE
    RAISE NOTICE 'pg_cron unavailable — the network_share_ops purge is not scheduled (expected in CI local stack)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'could not schedule the network_share_ops purge via pg_cron: %', SQLERRM;
END $$;


-- §6 What a walk of the folder found ----------------------------------------------------
-- p_dirs: [{d, complete, subdirs: [name], files: [{n, s, m, t}]}], whole directories, so each
-- call speaks for itself and a walk split across calls stays correct (NS-X05). n is one
-- segment; s the size as digits; m an ISO time and t a mime type, either of which a walk may
-- leave out, so a file dated before 1980 is still listed. An entry that sends them badly is
-- dropped (NS-X20). p_bin: the file ids found in the space's .wilson-bin.
--
-- No temp table (NS-X02): a suite runs as one transaction. The call is parsed once, into
-- arrays, and each step reads those.
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
     WHERE (u.i = u.depth - 1 AND s.lp IS NULL)
        OR (u.i < u.depth - 1 AND k.key IS NULL)
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
      FROM public.files f
      LEFT JOIN unnest(v_hit) g(id) ON g.id = f.id
      LEFT JOIN unnest(v_seen) s(lp) ON 'nas:' || s.lp = lower(f.storage_path)
     WHERE f.project_id = p_project_id
       AND f.storage_provider = 'network_share'
       AND f.deleted_at IS NULL
       AND f.source_modified_at IS NOT NULL
       AND s.lp IS NULL
       AND (g.id IS NOT NULL OR f.share_missing_since IS NOT NULL)
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

  SELECT COALESCE(jsonb_agg(jsonb_build_object('op_id', o.id, 'op', o.op, 'from', o.from_locator, 'to', o.to_locator)), '[]'::jsonb)
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
REVOKE ALL ON FUNCTION public.network_share_catalogue_apply(uuid, text, text, jsonb, jsonb, boolean, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_share_catalogue_apply(uuid, text, text, jsonb, jsonb, boolean, text, boolean) TO authenticated;


-- §7 The file manager -------------------------------------------------------------------
-- NS-D12. Each writes the row's target state and the journal first; the desktop then moves the
-- real file, refusing to overwrite, and settles. A crash never duplicates or loses a row, and a
-- walk during the window skips what the journal names. Every row is judged before any is
-- written, and any refusal rolls the whole batch back.

-- Where a file lands in a destination: the space's folder, the folder's path, the leaf. Refuses
-- what cannot hold it, and a name a live row or an unsettled operation holds. p_self is the file
-- being moved, whose own locator is not in its way.
CREATE OR REPLACE FUNCTION public._network_share_target(
  p_ws uuid, p_dest_project uuid, p_dest_folder uuid, p_leaf text, p_self uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_folder text;
  v_path   text;
  v_to     text;
BEGIN
  IF public._network_share_drive(p_ws) IS NULL THEN
    RAISE EXCEPTION 'network_share: drive_changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects p
                  WHERE p.id = p_dest_project AND p.workspace_id = p_ws AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'network_share: no_folder';
  END IF;
  v_folder := public.network_share_space_folder(p_dest_project);
  IF v_folder IS NULL THEN
    RAISE EXCEPTION 'network_share: no_folder';
  END IF;
  PERFORM public._network_share_assert_folder(p_ws, p_dest_project, v_folder);
  IF p_dest_folder IS NOT NULL THEN
    SELECT fo.path INTO v_path FROM public.folders fo
     WHERE fo.id = p_dest_folder AND fo.project_id = p_dest_project;
    IF NOT FOUND OR public.moth_folder_chain_locked(p_ws, p_dest_folder) THEN
      RAISE EXCEPTION 'network_share: no_folder';
    END IF;
  END IF;
  v_to := v_folder || CASE WHEN COALESCE(v_path, '') = '' THEN '' ELSE '/' || v_path END || '/' || p_leaf;
  IF position('/' IN COALESCE(p_leaf, '/')) > 0 OR NOT public.network_share_locator_ok(v_to) THEN
    RAISE EXCEPTION 'network_share: bad_name';
  END IF;
  IF EXISTS (SELECT 1 FROM public.files h
              WHERE h.workspace_id = p_ws
                AND h.storage_provider = 'network_share'
                AND h.deleted_at IS NULL
                AND lower(h.storage_path) = 'nas:' || lower(v_to)
                AND h.id IS DISTINCT FROM p_self)
     OR EXISTS (SELECT 1 FROM public.network_share_ops o
                 WHERE o.workspace_id = p_ws AND o.state = 'pending' AND lower(o.to_locator) = lower(v_to))
     OR EXISTS (SELECT 1 FROM public.network_share_ops o
                 WHERE o.workspace_id = p_ws AND o.state = 'pending' AND lower(o.from_locator) = lower(v_to)) THEN
    RAISE EXCEPTION 'network_share: occupied';
  END IF;
  RETURN v_to;
END;
$$;

-- Add: the desktop has copied the file already, so there is nothing to settle and the journal
-- says done. 0114's guard does not judge a definer's INSERT (its note (f)): this judges its own
-- rows, by the same rules: its own project's folder, a locator, no picture, no flag.
CREATE OR REPLACE FUNCTION public.network_share_record_added(
  p_project   uuid,
  p_root      text,
  p_folder_id uuid,
  p_entries   jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_ws    uuid := public.current_workspace_id();
  v_root  text;
  v_e     jsonb;
  v_locs  text[] := '{}';
  v_sizes bigint[] := '{}';
  v_times timestamptz[] := '{}';
  v_mimes text[] := '{}';
  v_names text[] := '{}';
  v_to    text;
  v_m     timestamptz;
  v_t     text;
  v_id    uuid;
  v_op    uuid;
  v_i     integer;
  v_out   jsonb := '[]'::jsonb;
BEGIN
  IF NOT public._network_share_may_write(p_project) THEN
    RAISE EXCEPTION 'network_share: not allowed' USING ERRCODE = '42501';
  END IF;
  v_root := public._network_share_drive(v_ws);
  IF v_root IS NULL OR lower(btrim(p_root)) IS DISTINCT FROM lower(v_root) THEN
    RAISE EXCEPTION 'network_share: drive_changed';
  END IF;
  IF jsonb_typeof(p_entries) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_entries) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'network_share: bad_request';
  END IF;

  PERFORM public._network_share_lock_projects(ARRAY[p_project]);

  -- Every entry first.
  FOR v_e IN SELECT e FROM jsonb_array_elements(p_entries) e LOOP
    IF jsonb_typeof(v_e) <> 'object' OR v_e ->> 'n' IS NULL
       OR COALESCE(v_e ->> 's', '') !~ '^[0-9]{1,15}$' THEN
      RAISE EXCEPTION 'network_share: bad_entry';
    END IF;
    v_m := public._network_share_mtime(v_e ->> 'm');
    IF v_e ->> 'm' IS NOT NULL AND v_m IS NULL THEN
      RAISE EXCEPTION 'network_share: bad_entry';
    END IF;
    v_t := v_e ->> 't';
    IF v_t IS NOT NULL AND NOT (length(v_t) <= 255 AND v_t ~ '^[a-z0-9][a-z0-9.+-]*/[A-Za-z0-9][A-Za-z0-9.+_-]*$') THEN
      RAISE EXCEPTION 'network_share: bad_entry';
    END IF;
    v_to := public._network_share_target(v_ws, p_project, p_folder_id, v_e ->> 'n', NULL);
    IF lower(v_to) = ANY (SELECT lower(x) FROM unnest(v_locs) x) THEN
      RAISE EXCEPTION 'network_share: occupied';
    END IF;
    v_locs := v_locs || v_to;
    v_names := v_names || (v_e ->> 'n');
    v_sizes := v_sizes || (v_e ->> 's')::bigint;
    v_times := v_times || v_m;
    v_mimes := v_mimes || v_t;
  END LOOP;

  IF (SELECT count(*) FROM public.files f
       WHERE f.project_id = p_project AND f.storage_provider = 'network_share') + cardinality(v_locs) > 50000 THEN
    RAISE EXCEPTION 'network_share: too_many';
  END IF;

  FOR v_i IN 1 .. cardinality(v_locs) LOOP
    v_id := gen_random_uuid();
    PERFORM set_config('wilson.network_share_writer', 'op:' || v_id::text, true);
    INSERT INTO public.files
      (id, workspace_id, project_id, folder_id, name, mime_type, size_bytes,
       storage_provider, storage_path, source_modified_at, kind)
    VALUES
      (v_id, v_ws, p_project, p_folder_id, v_names[v_i], v_mimes[v_i], v_sizes[v_i],
       'network_share', 'nas:' || v_locs[v_i], v_times[v_i], 'source');
    INSERT INTO public.network_share_ops
      (workspace_id, file_id, project_id, op, to_locator, state, created_by, settled_at)
    VALUES
      (v_ws, v_id, p_project, 'add', v_locs[v_i], 'done', auth.uid(), clock_timestamp())
    RETURNING id INTO v_op;
    v_out := v_out || jsonb_build_object('op_id', v_op, 'id', v_id, 'to', v_locs[v_i]);
  END LOOP;

  PERFORM set_config('wilson.network_share_writer', '', true);
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.network_share_record_added(uuid, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_share_record_added(uuid, text, uuid, jsonb) TO authenticated;

-- Delete: the row goes in the trash through soft_delete_row, so fn_trash_authz still decides, and
-- says where its file is going. Returns what the desktop renames.
CREATE OR REPLACE FUNCTION public.network_share_trash(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_ws     uuid := public.current_workspace_id();
  v_ids    uuid[] := ARRAY(SELECT DISTINCT x FROM unnest(p_ids) x WHERE x IS NOT NULL ORDER BY 1);
  r        record;
  v_folder text;
  v_from   text;
  v_bin    text;
  v_op     uuid;
  v_seen   uuid;
  v_out    jsonb := '[]'::jsonb;
BEGIN
  IF cardinality(v_ids) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'network_share: bad_request';
  END IF;
  -- Who, before any lock: a missing, hidden, trashed or other kind of row reads the same.
  IF (SELECT count(*) FROM public.files f
       WHERE f.id = ANY (v_ids)
         AND f.workspace_id = v_ws
         AND f.storage_provider = 'network_share'
         AND f.deleted_at IS NULL
         AND public._network_share_may_write(f.project_id)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'network_share: not allowed' USING ERRCODE = '42501';
  END IF;
  IF public._network_share_drive(v_ws) IS NULL THEN
    RAISE EXCEPTION 'network_share: drive_changed';
  END IF;

  PERFORM public._network_share_lock_projects(ARRAY(SELECT f.project_id FROM public.files f WHERE f.id = ANY (v_ids)));

  -- Every row first, under the locks.
  FOR r IN SELECT f.id, f.project_id, f.storage_path, f.deleted_at
             FROM public.files f WHERE f.id = ANY (v_ids) ORDER BY f.id FOR UPDATE LOOP
    IF r.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'network_share: not allowed' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.network_share_ops o WHERE o.file_id = r.id AND o.state = 'pending') THEN
      RAISE EXCEPTION 'network_share: pending';
    END IF;
    v_folder := public.network_share_space_folder(r.project_id);
    IF v_folder IS NULL THEN
      RAISE EXCEPTION 'network_share: no_folder';
    END IF;
    -- A desktop moves what this returns. A row its folder has left names a file that may be
    -- somebody else's by now, and a folder inside another's holds that other project's files.
    IF NOT starts_with(lower(substr(r.storage_path, 5)), lower(v_folder) || '/') THEN
      RAISE EXCEPTION 'network_share: no_folder';
    END IF;
    IF r.project_id IS DISTINCT FROM v_seen THEN
      PERFORM public._network_share_assert_folder(v_ws, r.project_id, v_folder);
      v_seen := r.project_id;
    END IF;
    IF NOT public.network_share_bin_ok(v_folder || '/.wilson-bin/' || r.id::text || '/' || regexp_replace(r.storage_path, '^.*/', '')) THEN
      RAISE EXCEPTION 'network_share: bad_name';
    END IF;
  END LOOP;

  FOR r IN SELECT f.id, f.project_id, f.workspace_id, f.storage_path
             FROM public.files f WHERE f.id = ANY (v_ids) ORDER BY f.id LOOP
    v_from := substr(r.storage_path, 5);
    v_bin := public.network_share_space_folder(r.project_id) || '/.wilson-bin/' || r.id::text || '/' || regexp_replace(r.storage_path, '^.*/', '');
    PERFORM set_config('wilson.network_share_writer', 'op:' || r.id::text, true);
    IF NOT public.soft_delete_row('files', r.id) THEN
      RAISE EXCEPTION 'network_share: not allowed' USING ERRCODE = '42501';
    END IF;
    UPDATE public.files SET share_bin_path = v_bin WHERE id = r.id;
    INSERT INTO public.network_share_ops
      (workspace_id, file_id, project_id, op, from_locator, to_locator, created_by)
    VALUES
      (r.workspace_id, r.id, r.project_id, 'trash', v_from, v_bin, auth.uid())
    RETURNING id INTO v_op;
    v_out := v_out || jsonb_build_object('op_id', v_op, 'id', r.id, 'from', v_from, 'to', v_bin);
  END LOOP;

  PERFORM set_config('wilson.network_share_writer', '', true);
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.network_share_trash(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_share_trash(uuid[]) TO authenticated;

-- Restore: refused when a live row or an unsettled operation has the name now. The bin path stays
-- on the row until settle says the file is back. The row's own delete stamps go in the journal, so
-- 'not_moved' puts them back and the 30 days do not start again.
CREATE OR REPLACE FUNCTION public.network_share_restore(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_ws   uuid := public.current_workspace_id();
  v_ids  uuid[] := ARRAY(SELECT DISTINCT x FROM unnest(p_ids) x WHERE x IS NOT NULL ORDER BY 1);
  r      record;
  v_to   text;
  v_op   uuid;
  v_lf   text;
  v_seen uuid;
  v_out  jsonb := '[]'::jsonb;
BEGIN
  IF cardinality(v_ids) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'network_share: bad_request';
  END IF;
  IF (SELECT count(*) FROM public.files f
       WHERE f.id = ANY (v_ids)
         AND f.workspace_id = v_ws
         AND f.storage_provider = 'network_share'
         AND f.deleted_at IS NOT NULL
         AND f.share_bin_path IS NOT NULL
         AND public._network_share_may_write(f.project_id)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'network_share: not allowed' USING ERRCODE = '42501';
  END IF;
  IF public._network_share_drive(v_ws) IS NULL THEN
    RAISE EXCEPTION 'network_share: drive_changed';
  END IF;

  PERFORM public._network_share_lock_projects(ARRAY(SELECT f.project_id FROM public.files f WHERE f.id = ANY (v_ids)));

  FOR r IN SELECT f.id, f.project_id, f.workspace_id, f.storage_path, f.share_bin_path, f.deleted_at, f.deleted_by
             FROM public.files f WHERE f.id = ANY (v_ids) ORDER BY f.id FOR UPDATE LOOP
    IF r.deleted_at IS NULL THEN
      RAISE EXCEPTION 'network_share: not allowed' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.network_share_ops o WHERE o.file_id = r.id AND o.state = 'pending') THEN
      RAISE EXCEPTION 'network_share: pending';
    END IF;
    v_to := substr(r.storage_path, 5);
    -- As in trash: both ends must be this space's, and the space's folder its own.
    v_lf := lower(public.network_share_space_folder(r.project_id));
    IF v_lf IS NULL
       OR NOT starts_with(lower(v_to), v_lf || '/')
       OR NOT starts_with(lower(r.share_bin_path), v_lf || '/') THEN
      RAISE EXCEPTION 'network_share: no_folder';
    END IF;
    IF r.project_id IS DISTINCT FROM v_seen THEN
      PERFORM public._network_share_assert_folder(r.workspace_id, r.project_id, public.network_share_space_folder(r.project_id));
      v_seen := r.project_id;
    END IF;
    -- The batch's own earlier rows count: each is live by the time the next is read.
    IF EXISTS (SELECT 1 FROM public.files h
                WHERE h.workspace_id = r.workspace_id
                  AND h.storage_provider = 'network_share'
                  AND h.deleted_at IS NULL
                  AND lower(h.storage_path) = lower(r.storage_path))
       OR EXISTS (SELECT 1 FROM public.network_share_ops o
                   WHERE o.workspace_id = r.workspace_id AND o.state = 'pending' AND lower(o.to_locator) = lower(v_to))
       OR EXISTS (SELECT 1 FROM public.network_share_ops o
                   WHERE o.workspace_id = r.workspace_id AND o.state = 'pending' AND lower(o.from_locator) = lower(v_to)) THEN
      RAISE EXCEPTION 'network_share: occupied';
    END IF;
    PERFORM set_config('wilson.network_share_writer', 'op:' || r.id::text, true);
    IF NOT public.restore_soft_deleted('files', r.id) THEN
      RAISE EXCEPTION 'network_share: not allowed' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.network_share_ops
      (workspace_id, file_id, project_id, op, from_locator, to_locator, origin, created_by)
    VALUES
      (r.workspace_id, r.id, r.project_id, 'restore', r.share_bin_path, v_to,
       jsonb_build_object('deleted_at', r.deleted_at, 'deleted_by', r.deleted_by), auth.uid())
    RETURNING id INTO v_op;
    v_out := v_out || jsonb_build_object('op_id', v_op, 'id', r.id, 'from', r.share_bin_path, 'to', v_to);
  END LOOP;

  PERFORM set_config('wilson.network_share_writer', '', true);
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.network_share_restore(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_share_restore(uuid[]) TO authenticated;

-- A move or an adopt that did not happen goes back through fn_moth_apply_moves, under the move
-- journal, because no office-server marker ever admits a project change (§1.5). That is 0118's,
-- which replaces this body. Until then nothing can write such an operation, so nothing reaches
-- here but a suite.
CREATE OR REPLACE FUNCTION public._network_share_replay_origin(p_op uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  RAISE EXCEPTION 'network_share: moves_not_ready';
END;
$$;

-- The desktop's report. For whoever began the operation while they can still write the row; after
-- 24 hours, for anyone who could check the folder both locators sit in, so a laptop that never
-- comes back does not hold a file for ever (NS-D12). A cross-project operation stays with its
-- creator (the design's residual: if that laptop never returns, service_role settles it).
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
  FOR r IN SELECT o.id, o.created_by, o.created_at, o.from_locator, o.to_locator, f.project_id AS file_project
             FROM public.network_share_ops o
             JOIN public.files f ON f.id = o.file_id
            WHERE o.id = ANY (v_ids) AND o.workspace_id = v_ws AND o.state = 'pending' LOOP
    v_n := v_n + 1;
    IF r.created_by = v_uid AND public._network_share_may_write(r.file_project) THEN
      CONTINUE;
    END IF;
    v_lf := lower(public.network_share_space_folder(r.file_project));
    IF NOT (r.created_at < now() - interval '24 hours'
            AND r.from_locator IS NOT NULL
            AND COALESCE(starts_with(lower(r.from_locator), v_lf || '/'), false)
            AND COALESCE(starts_with(lower(r.to_locator), v_lf || '/'), false)
            AND public._network_share_may_check(r.file_project)) THEN
      RAISE EXCEPTION 'network_share: not allowed' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  IF v_n <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'network_share: not allowed' USING ERRCODE = '42501';
  END IF;

  PERFORM public._network_share_lock_projects(ARRAY(
    SELECT f.project_id FROM public.network_share_ops o JOIN public.files f ON f.id = o.file_id WHERE o.id = ANY (v_ids)));

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
REVOKE ALL ON FUNCTION public.network_share_settle(uuid[], text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_share_settle(uuid[], text, jsonb) TO authenticated;

-- What this person began and has not finished, so a desktop can finish it after a crash. Only rows
-- they can still write, and only their own locators.
CREATE OR REPLACE FUNCTION public.network_share_pending_mine()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'network_share: not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('op_id', x.id, 'op', x.op, 'from', x.from_locator, 'to', x.to_locator)), '[]'::jsonb)
    INTO v_out
    FROM (SELECT o.id, o.op, o.from_locator, o.to_locator
            FROM public.network_share_ops o
            JOIN public.files f ON f.id = o.file_id
           WHERE o.created_by = auth.uid()
             AND o.state = 'pending'
             AND o.workspace_id = public.current_workspace_id()
             AND public._network_share_may_write(f.project_id)
           ORDER BY o.created_at, o.id
           LIMIT 500) x;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.network_share_pending_mine() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_share_pending_mine() TO authenticated;

-- The two cores 0118's fn_moth_apply_moves calls. They judge the row and the destination and
-- journal the operation; they write no file row. That is fn_moth_apply_moves' one UPDATE, under the
-- move journal's marker, which is what admits a project change. p_write false is its plan phase.
-- Authority is the caller's: these are closed to clients. They take the projects' advisory locks,
-- so fn_moth_apply_moves must take _network_share_lock_projects over every source and the
-- destination before any file row lock, or it deadlocks against a walk, which locks the other way.
CREATE OR REPLACE FUNCTION public._network_share_move_core(
  p_file uuid, p_dest_project uuid, p_dest_folder uuid, p_origin jsonb, p_write boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  r      record;
  v_from text;
  v_src  text;
  v_to   text;
  v_op   uuid;
BEGIN
  SELECT f.id, f.workspace_id, f.project_id, f.storage_provider::text AS provider, f.storage_path, f.deleted_at INTO r
    FROM public.files f WHERE f.id = p_file;
  IF NOT FOUND OR r.provider <> 'network_share' OR r.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'network_share: not allowed' USING ERRCODE = '42501';
  END IF;
  PERFORM public._network_share_lock_projects(ARRAY[r.project_id, p_dest_project]);
  IF EXISTS (SELECT 1 FROM public.network_share_ops o WHERE o.file_id = p_file AND o.state = 'pending') THEN
    RAISE EXCEPTION 'network_share: pending';
  END IF;
  v_from := substr(r.storage_path, 5);
  v_src := public.network_share_space_folder(r.project_id);
  IF v_src IS NULL OR NOT starts_with(lower(v_from), lower(v_src) || '/') THEN
    RAISE EXCEPTION 'network_share: no_folder';
  END IF;
  PERFORM public._network_share_assert_folder(r.workspace_id, r.project_id, v_src);
  v_to := public._network_share_target(r.workspace_id, p_dest_project, p_dest_folder, regexp_replace(v_from, '^.*/', ''), p_file);
  IF NOT COALESCE(p_write, false) THEN
    RETURN jsonb_build_object('id', p_file, 'from', v_from, 'to', v_to);
  END IF;
  INSERT INTO public.network_share_ops
    (workspace_id, file_id, project_id, dest_project_id, op, from_locator, to_locator, origin, created_by)
  VALUES
    (r.workspace_id, p_file, r.project_id, p_dest_project, 'move', v_from, v_to, COALESCE(p_origin, '{}'::jsonb), auth.uid())
  RETURNING id INTO v_op;
  RETURN jsonb_build_object('op_id', v_op, 'id', p_file, 'from', v_from, 'to', v_to);
END;
$$;

CREATE OR REPLACE FUNCTION public._network_share_adopt_core(
  p_file uuid, p_dest_project uuid, p_dest_folder uuid, p_origin jsonb, p_write boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  r    record;
  v_to text;
  v_op uuid;
BEGIN
  SELECT f.id, f.workspace_id, f.project_id, f.storage_provider::text AS provider, f.name, f.deleted_at INTO r
    FROM public.files f WHERE f.id = p_file;
  IF NOT FOUND OR r.provider <> 'local_server' OR r.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'network_share: not allowed' USING ERRCODE = '42501';
  END IF;
  PERFORM public._network_share_lock_projects(ARRAY[r.project_id, p_dest_project]);
  IF EXISTS (SELECT 1 FROM public.network_share_ops o WHERE o.file_id = p_file AND o.state = 'pending') THEN
    RAISE EXCEPTION 'network_share: pending';
  END IF;
  v_to := public._network_share_target(r.workspace_id, p_dest_project, p_dest_folder, r.name, p_file);
  IF NOT COALESCE(p_write, false) THEN
    RETURN jsonb_build_object('id', p_file, 'to', v_to);
  END IF;
  INSERT INTO public.network_share_ops
    (workspace_id, file_id, project_id, dest_project_id, op, to_locator, origin, created_by)
  VALUES
    (r.workspace_id, p_file, r.project_id, p_dest_project, 'adopt', v_to, COALESCE(p_origin, '{}'::jsonb), auth.uid())
  RETURNING id INTO v_op;
  RETURN jsonb_build_object('op_id', v_op, 'id', p_file, 'to', v_to);
END;
$$;

-- Closed to clients: definer callers only.
REVOKE ALL ON FUNCTION public.network_share_space_folder(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.network_share_claims(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._network_share_mtime(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._network_share_drive(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._network_share_inside(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._network_share_placed(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._network_share_folder_refused(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._network_share_assert_folder(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._network_share_overlaps(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._network_share_claim_taken(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._network_share_may_check(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._network_share_may_write(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._network_share_lock_projects(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._network_share_target(uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._network_share_replay_origin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._network_share_move_core(uuid, uuid, uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._network_share_adopt_core(uuid, uuid, uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;


-- §8 COMMENTs ---------------------------------------------------------------------------
COMMENT ON TABLE public.network_share_checks IS
  'When a space''s folder on the company server was last checked, by whom, and how complete it was. One row per project. Clients read it through the project hop; only network_share_catalogue_apply writes it.';
COMMENT ON TABLE public.network_share_ops IS
  'The office-server journal. The row changes first, then the desktop moves the real file, then network_share_settle closes this. No client grants: only definers read or write it.';
COMMENT ON FUNCTION public.network_share_locator_ok(text) IS
  'Whether a path can be an office-server locator: the shape, and no money, Legal or _DATABASES segment at any depth.';
COMMENT ON FUNCTION public.network_share_path_shape_ok(text) IS
  'The shape of a locator alone, with no list of names. A folder_slug is held to this.';
COMMENT ON FUNCTION public.network_share_bin_ok(text) IS
  'Whether a path is <space folder>/.wilson-bin/<file id>/<leaf>.';
COMMENT ON FUNCTION public.network_share_space_folder(uuid) IS
  'A space''s folder relative to the drive, or NULL. The only place it is computed. Never a slug or a title.';
COMMENT ON FUNCTION public.network_share_claims(uuid) IS
  'Every folder taken in a company, by every project in any state, and the reserved personal parent. A folder_root outside the drive is an unplaced claim.';
COMMENT ON FUNCTION public.fn_files_network_share_delete_guard() IS
  'A client never hard-deletes an office-server row: its real file would be left behind with no bin path. 0114''s guard judges updates only.';
COMMENT ON FUNCTION public.network_share_catalogue_apply(uuid, text, text, jsonb, jsonb, boolean, text, boolean) IS
  'What a walk of a space''s folder found. Needs the roster seat, or to be the owner of a personal space. Writes under the check: marker, so one signal goes out and the events say catalogued.';
COMMENT ON FUNCTION public.network_share_record_added(uuid, text, uuid, jsonb) IS
  'A file the desktop has copied into a space''s folder. Judges its own rows: 0114''s guard does not judge a definer''s INSERT.';
COMMENT ON FUNCTION public.network_share_trash(uuid[]) IS
  'Puts office-server rows in the trash and returns what the desktop moves into the bin. Settled by network_share_settle.';
COMMENT ON FUNCTION public.network_share_restore(uuid[]) IS
  'Brings office-server rows back and returns what the desktop moves out of the bin. Refused when the name is taken. Settled by network_share_settle.';
COMMENT ON FUNCTION public.network_share_settle(uuid[], text, jsonb) IS
  'The desktop reports done or not_moved. not_moved puts the row back as the journal says.';
COMMENT ON FUNCTION public.network_share_pending_mine() IS
  'The caller''s unfinished office-server operations, on rows they can still write.';
COMMENT ON FUNCTION public._network_share_move_core(uuid, uuid, uuid, jsonb, boolean) IS
  'For fn_moth_apply_moves (0118): judges a move of an office-server row and journals it. Writes no file row.';
COMMENT ON FUNCTION public._network_share_adopt_core(uuid, uuid, uuid, jsonb, boolean) IS
  'For fn_moth_apply_moves (0118): judges a copy-up of a local file onto the office server and journals it. Writes no file row.';


-- §9 Post-conditions --------------------------------------------------------------------
DO $$
DECLARE
  v_name  text;
  v_body  text;
  v_def   text;
  v_bs    text := chr(92);
BEGIN
  -- The CHECKs, by name, and the index.
  FOREACH v_name IN ARRAY ARRAY['files_network_share_shape_chk', 'files_network_share_namespace_chk', 'files_network_share_extra_chk'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.files'::regclass AND conname = v_name AND contype = 'c' AND convalidated) THEN
      RAISE EXCEPTION '0117 post-condition: % is not on files', v_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                  WHERE c.relname = 'files_network_share_locator_key' AND i.indisunique
                    AND pg_get_expr(i.indpred, i.indrelid) LIKE '%deleted_at IS NULL%') THEN
    RAISE EXCEPTION '0117 post-condition: the locator key is not unique over live rows';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.projects'::regclass AND conname = 'projects_folder_slug_shape_chk') THEN
    RAISE EXCEPTION '0117 post-condition: the slug CHECK is missing';
  END IF;

  -- Every guard still attached, the one owner guard with every earlier arm.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.files'::regclass AND tgname = 'trg_files_network_share_delete_guard' AND tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.files'::regclass AND tgname = 'trg_files_body_guard' AND tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.projects'::regclass AND tgname = 'trg_projects_owner_guard' AND tgenabled = 'O') THEN
    RAISE EXCEPTION '0117 post-condition: a guard is not attached';
  END IF;
  -- 0054's own post-condition only proves the trigger is there; a suite proves what it does.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.files'::regclass AND tgname = 'trg_files_gc_enqueue') THEN
    RAISE EXCEPTION '0117 post-condition: trg_files_gc_enqueue is gone';
  END IF;
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_body FROM pg_proc WHERE oid = 'public.fn_projects_owner_guard()'::regprocedure;
  FOREACH v_name IN ARRAY ARRAY['That project was deleted for good', 'project_id_tied_elsewhere', 'A project keeps its id',
                                'A personal space keeps its owner', 'A personal space cannot be shared',
                                'can change who can see it', 'choose its producer', 'topic_epoch := OLD.topic_epoch + 1',
                                '_network_share_claim_taken', 'Only an admin or a manager can change a project'] LOOP
    IF position(v_name IN v_body) = 0 THEN
      RAISE EXCEPTION '0117 post-condition: fn_projects_owner_guard has lost %', v_name;
    END IF;
  END LOOP;
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.purge_soft_deleted(interval)'::regprocedure)
     IS DISTINCT FROM 'f554aba88a2fbb933674b20ceb782486' THEN
    RAISE EXCEPTION '0117 post-condition: purge_soft_deleted is not this file''s body';
  END IF;
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.fn_projects_owner_guard()'::regprocedure)
     IS DISTINCT FROM '49ebe6b9f996f75682982dfbe1c842e4' THEN
    RAISE EXCEPTION '0117 post-condition: fn_projects_owner_guard is not this file''s body';
  END IF;

  -- The tables: forced, one SELECT policy on checks and none on the journal, and what a client holds.
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.network_share_checks'::regclass)
     OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.network_share_ops'::regclass) THEN
    RAISE EXCEPTION '0117 post-condition: row security is not on and forced on both tables';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.network_share_checks'::regclass) <> 1
     OR (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.network_share_checks'::regclass AND polcmd = 'r') <> 1
     OR (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.network_share_ops'::regclass) <> 0 THEN
    RAISE EXCEPTION '0117 post-condition: the policies are not one SELECT and none';
  END IF;
  IF has_table_privilege('authenticated', 'public.network_share_checks', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR NOT has_table_privilege('authenticated', 'public.network_share_checks', 'SELECT')
     OR has_table_privilege('anon', 'public.network_share_checks', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', 'public.network_share_ops', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('anon', 'public.network_share_ops', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION '0117 post-condition: a client holds the wrong privilege on a table';
  END IF;

  -- Every definer: a pinned search path, an owner who bypasses row security, and no anon.
  FOR v_def IN
    SELECT p.oid::regprocedure::text
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.prosecdef
       AND (p.proname LIKE 'network\_share\_%' OR p.proname LIKE '\_network\_share\_%'
            OR p.proname IN ('purge_network_share_ops', 'fn_network_share_checks_broadcast'))
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_def::regprocedure
                    AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search\_path=%'))
       OR NOT (SELECT r.rolbypassrls FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.oid = v_def::regprocedure)
       OR has_function_privilege('anon', v_def, 'EXECUTE') THEN
      RAISE EXCEPTION '0117 post-condition: the definer % is not closed as it must be', v_def;
    END IF;
  END LOOP;
  FOREACH v_def IN ARRAY ARRAY[
    'public.network_share_catalogue_apply(uuid,text,text,jsonb,jsonb,boolean,text,boolean)',
    'public.network_share_record_added(uuid,text,uuid,jsonb)',
    'public.network_share_trash(uuid[])',
    'public.network_share_restore(uuid[])',
    'public.network_share_settle(uuid[],text,jsonb)',
    'public.network_share_pending_mine()'] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_def::regprocedure)
       OR NOT has_function_privilege('authenticated', v_def, 'EXECUTE') THEN
      RAISE EXCEPTION '0117 post-condition: % is not a definer a client may call', v_def;
    END IF;
  END LOOP;
  FOREACH v_def IN ARRAY ARRAY[
    'public.network_share_space_folder(uuid)', 'public.network_share_claims(uuid)',
    'public._network_share_mtime(text)', 'public._network_share_drive(uuid)',
    'public._network_share_inside(text,text)', 'public._network_share_placed(text,text)',
    'public._network_share_folder_refused(uuid,text)', 'public._network_share_assert_folder(uuid,uuid,text)',
    'public._network_share_overlaps(text,text)',
    'public._network_share_claim_taken(uuid,uuid,text,text)',
    'public._network_share_may_check(uuid)', 'public._network_share_may_write(uuid)',
    'public._network_share_lock_projects(uuid[])', 'public._network_share_target(uuid,uuid,uuid,text,uuid)',
    'public._network_share_replay_origin(uuid)', 'public._network_share_move_core(uuid,uuid,uuid,jsonb,boolean)',
    'public._network_share_adopt_core(uuid,uuid,uuid,jsonb,boolean)', 'public.purge_network_share_ops(interval)',
    'public.fn_files_network_share_delete_guard()', 'public.fn_network_share_checks_broadcast()'] LOOP
    IF has_function_privilege('authenticated', v_def, 'EXECUTE') OR has_function_privilege('anon', v_def, 'EXECUTE') THEN
      RAISE EXCEPTION '0117 post-condition: a client may call %', v_def;
    END IF;
  END LOOP;
  -- A CHECK asks for EXECUTE as whoever writes the row.
  FOREACH v_def IN ARRAY ARRAY['public.network_share_path_shape_ok(text)', 'public.network_share_locator_ok(text)', 'public.network_share_bin_ok(text)'] LOOP
    IF NOT has_function_privilege('authenticated', v_def, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_def, 'EXECUTE')
       OR has_function_privilege('anon', v_def, 'EXECUTE')
       OR (SELECT provolatile FROM pg_proc WHERE oid = v_def::regprocedure) <> 'i' THEN
      RAISE EXCEPTION '0117 post-condition: % is not what a CHECK needs', v_def;
    END IF;
  END LOOP;

  -- The marker: who names it, and that every writer resets it.
  IF (SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p
       WHERE p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
         AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g') LIKE '%wilson.network_share_writer%')
     IS DISTINCT FROM ARRAY['fn_file_events_capture', 'fn_files_body_guard', 'fn_realtime_broadcast',
                            'network_share_catalogue_apply', 'network_share_record_added', 'network_share_restore',
                            'network_share_settle', 'network_share_trash'] THEN
    RAISE EXCEPTION '0117 post-condition: the marker is named by something else';
  END IF;
  FOREACH v_def IN ARRAY ARRAY[
    'public.network_share_catalogue_apply(uuid,text,text,jsonb,jsonb,boolean,text,boolean)',
    'public.network_share_record_added(uuid,text,uuid,jsonb)',
    'public.network_share_trash(uuid[])', 'public.network_share_restore(uuid[])',
    'public.network_share_settle(uuid[],text,jsonb)'] LOOP
    SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_body FROM pg_proc WHERE oid = v_def::regprocedure;
    IF position($q$set_config('wilson.network_share_writer', '', true)$q$ IN v_body) = 0 THEN
      RAISE EXCEPTION '0117 post-condition: % does not reset the marker', v_def;
    END IF;
  END LOOP;

  -- NS-D14: a catalogue row never authorizes the gateway.
  FOREACH v_name IN ARRAY ARRAY['gateway_clips_for_tickets', 'gateway_sync_apply'] LOOP
    FOR v_body IN SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') FROM pg_proc
                   WHERE pronamespace = 'public'::regnamespace AND proname = v_name LOOP
      IF v_body LIKE '%public.files%' OR v_body LIKE '%network_share%' THEN
        RAISE EXCEPTION '0117 post-condition: % reads files or network_share', v_name;
      END IF;
    END LOOP;
  END LOOP;

  -- The locator's refusals and what it admits. Built with chr(): a backslash path and these code
  -- points stay out of the file itself.
  FOREACH v_name IN ARRAY ARRAY[
    'a/INVOICES/x', 'a/invoices/x', 'a/FINANCE/x', 'a/LEGAL/x', 'a/P_DATABASES/b', 'a/P_RECEIPTS&INVOICES/b',
    'a/P_CREWINVOICES/b', 'a/P_TALENTINVOICES/b', 'a/.wilson/x', 'a/../b', '../b', 'a/..', 'a' || v_bs || 'b', 'C:/x',
    'a//b', '/a', 'a/', 'a/b.', 'a/b ', 'a' || chr(8238) || 'b', 'e' || chr(769), 'a' || chr(8203) || 'b', 'a' || chr(1) || 'b',
    'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', ''] LOOP
    IF public.network_share_locator_ok(v_name) THEN
      RAISE EXCEPTION '0117 post-condition: the locator test admits %', v_name;
    END IF;
  END LOOP;
  IF public.network_share_locator_ok(NULL) IS NOT FALSE
     OR public.network_share_bin_ok(NULL) IS NOT FALSE
     OR public.network_share_path_shape_ok(NULL) IS NOT FALSE THEN
    RAISE EXCEPTION '0117 post-condition: a test answers NULL, and a CHECK would admit it';
  END IF;
  IF NOT public.network_share_locator_ok('Salt-Hours/rushes/A001.mov')
     OR NOT public.network_share_locator_ok('_WILSON_PERSONAL/00000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION '0117 post-condition: the locator test refuses a good path';
  END IF;
  IF NOT public.network_share_bin_ok('a/b/.wilson-bin/00000000-0000-0000-0000-000000000001/x.mov')
     OR public.network_share_bin_ok('a/b/.wilson-bin/1/x.mov')
     OR public.network_share_bin_ok('a/INVOICES/.wilson-bin/00000000-0000-0000-0000-000000000001/x.mov')
     OR public.network_share_bin_ok('a/b/.wilson-bin/00000000-0000-0000-0000-000000000001/x/y.mov')
     OR public.network_share_bin_ok('.wilson-bin/00000000-0000-0000-0000-000000000001/x.mov') THEN
    RAISE EXCEPTION '0117 post-condition: the bin test is wrong';
  END IF;

  RAISE NOTICE '0117 OK: the catalogue, its journal, the file manager''s calls and the guards.';
END $$;
