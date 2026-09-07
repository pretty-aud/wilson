-- =============================================================================
-- 0074_file_events_money_arm.sql — Track C, bundle C2: money on the activity
-- stream, and three ways an upload reservation closes.
--
-- Audrey's rulings that land here (FIX_PLAN_2026-09-04.md, the C2 row):
--
--   22 (2026-09-04). "hide invoice activity from non-managers; deletion records
--      stay visible."  file_events_select (0027) admitted every project reader
--      to every event, so a member who cannot see an invoice's files row
--      (0038's money arm) still read its name, path and size from the invoice's
--      uploaded / moved / trashed / downloaded events. Pre-existing since 0027,
--      measured by S33's adversarial review, deferred because a purged
--      invoice's certificate is the only surviving record and carried no
--      is_financial. Now:
--        * file_events.is_financial, NOT NULL DEFAULT false, filled at capture
--          time by ONE definition, file_event_is_financial(): the files row's
--          is_financial flag OR a row-shaped Petal key under a money segment
--          (INVOICES / FINANCE — 0042's rabbit_money_segment). Snapshotted, so
--          it survives the row's deletion; backfilled for existing rows from
--          both sources.
--        * the policy gains the money arm: a non-money reader sees a row only
--          when NOT is_financial OR event = 'purged' — the deletion certificate
--          stays visible to everyone who could read the project. A workspace
--          admin, or a project manager (can_access_project_money, 0037), sees
--          everything. DROP + CREATE restating EVERY arm (the 0059 lesson);
--          post-condition 3 asserts the arm is present.
--        * fn_file_events_capture (0027) and log_file_downloaded (0047) are
--          restated IN FULL with the new column. sweep_abandoned_uploads (0073)
--          is untouched: a reservation never exists for a money path
--          (reserve_upload_bytes returns NULL for quota-exempt keys), so its
--          certificates are never financial. The new writers below still run
--          the definition rather than assume it.
--
--   C1 ruling 1 (2026-09-07). A server-answered upload failure is RECORDED, not
--      silently released. abandon_upload_reservation(path, reason) closes the
--      caller's own open row as 'abandoned' and writes the upload_abandoned
--      certificate at once, carrying the client's reason. A network drop cannot
--      reach it and stays certified by the sweep at 24 h, as before.
--   C1 ruling 2. A person's own STALE reservations are auto-released when they
--      next open Files. release_stale_upload_reservations(keep[]) closes the
--      caller's own open rows except the keys their client is still uploading;
--      those rows close 'released' (or 'completed' when the object landed) and
--      get NO certificate — the handbook §17 says so.
--   C1 ruling 3. NO per-person cap on active reservations; the 24 h expiry is
--      the bound. Nothing to build; recorded as an accepted limit.
--   Controller amendment (2026-09-06). The teardown sweep: sweep_open_uploads
--      (workspace) closes EVERY open reservation of one tenant regardless of
--      expiry — 'completed' when the object landed, otherwise 'abandoned' with a
--      certificate — and returns the abandoned paths so operator-workspaces can
--      certify them in platform_audit BEFORE the CASCADE takes the tenant's
--      file_events with it. service_role only; refuses a NULL workspace.
--
-- The NULL rules (0047's lesson): in a policy NULL DENIES, in an IF it PASSES.
-- can_access_project_money() is NULL for a claim-less non-manager; the arm
-- COALESCEs it to false — the policy would deny either way, and the text says
-- so. rabbit_money_key() and file_event_is_financial() never return NULL: the
-- arm NEGATES the flag, and a NULL there would hide every plain row.
--
-- 🚨 REPLAY TRAPS. A replay of 0027 after this file recreates the policy
-- WITHOUT the money arm and the capture trigger WITHOUT is_financial; a replay
-- of 0047 restates log_file_downloaded without it. Post-conditions 3, 4 and 5
-- are the tripwires — re-run 0074 after any such replay. Recorded beside the
-- 0058 → 0073 pair in the migration rules.
--
-- Idempotent: safe to re-run (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE,
-- DROP POLICY IF EXISTS, backfill guarded by NOT is_financial).
-- pgTAP: 78_file_events_money.sql (new). Suites 33 (0027/0047) and 77 (0073)
-- read nothing this file changes and must stay green.
-- =============================================================================

-- ── 1. The column ───────────────────────────────────────────────────────────

ALTER TABLE public.file_events
  ADD COLUMN IF NOT EXISTS is_financial BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.file_events.is_financial IS
  'Track C / 0074: snapshotted at capture time by file_event_is_financial() — '
  'the files row''s is_financial flag OR a row-shaped key under a money segment. '
  'Survives the row''s deletion. A file that becomes financial LATER has its '
  'earlier events unflagged (stated limit, handbook §17). Non-money readers see '
  'a flagged row only when event = ''purged''.';

-- ── 2. The ONE definition ───────────────────────────────────────────────────

-- A row-shaped Petal key (projects/{project}/{segment}/...) whose third segment
-- is a money segment. Anything else — NULL, a local path, a Drive id, a key
-- outside projects/ — is false, never NULL. The 0042 storage policies gate
-- exactly these keys, so for Petal objects the path and the row flag agree; the
-- path arm exists so a purged invoice's history (whose files row is gone) can
-- still be classified by its key.
CREATE OR REPLACE FUNCTION public.rabbit_money_key(obj_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT COALESCE(
    (storage.foldername(obj_name))[1] = 'projects'
    AND public.rabbit_money_segment((storage.foldername(obj_name))[3]),
    false);
$$;

COMMENT ON FUNCTION public.rabbit_money_key(TEXT) IS
  'Track C / 0074: true when obj_name is a row-shaped Petal key under a money '
  'segment (INVOICES / FINANCE, per rabbit_money_segment). False — never NULL — '
  'for anything else.';

CREATE OR REPLACE FUNCTION public.file_event_is_financial(
  p_flag   BOOLEAN,
  p_path_a TEXT,
  p_path_b TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT COALESCE(p_flag, false)
      OR public.rabbit_money_key(p_path_a)
      OR public.rabbit_money_key(p_path_b);
$$;

COMMENT ON FUNCTION public.file_event_is_financial(BOOLEAN, TEXT, TEXT) IS
  'Track C / 0074: the one definition of a financial file event — the files '
  'row''s flag, or either path under a money segment. Used by the capture '
  'trigger, log_file_downloaded, abandon_upload_reservation, sweep_open_uploads '
  'and the 0074 backfill. Never NULL.';

-- ── 3. Backfill, from both sources ──────────────────────────────────────────
-- Rows whose files row still exists take its flag; rows whose subject is gone
-- (a purged invoice's history) are classified by their key. A purged invoice
-- that lived OUTSIDE a money segment before 0042 stays unclassified — stated
-- in §17. MEASURED before this file was written (2026-09-07): zero file_events
-- rows on dev, staging and prod, so both statements are no-ops today and exist
-- for the environments that come later.

UPDATE public.file_events fe
   SET is_financial = true
  FROM public.files f
 WHERE f.id = fe.file_id
   AND f.is_financial
   AND NOT fe.is_financial;

UPDATE public.file_events fe
   SET is_financial = true
 WHERE NOT fe.is_financial
   AND public.file_event_is_financial(false, fe.old_path, fe.new_path);

-- ── 4. The capture trigger, restated in full (0027 + is_financial) ──────────
-- Every line of 0027's body is here; the only additions are the is_financial
-- column and its value in each of the five INSERTs.

CREATE OR REPLACE FUNCTION public.fn_file_events_capture()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_label TEXT;
  v_row   public.files;
BEGIN
  v_row := COALESCE(NEW, OLD);
  v_actor := auth.uid();
  IF v_actor IS NOT NULL THEN
    SELECT COALESCE(wm.display_name, wm.username) INTO v_label
      FROM public.workspace_members wm
     WHERE wm.workspace_id = v_row.workspace_id
       AND wm.user_id = v_actor;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.file_events
      (workspace_id, project_id, file_id, file_name, storage_provider,
       event, new_path, size_bytes, actor_user_id, actor_label, is_financial)
    VALUES
      (NEW.workspace_id, NEW.project_id, NEW.id, NEW.name, NEW.storage_provider::text,
       'uploaded', NEW.storage_path, NEW.size_bytes, v_actor, v_label,
       public.file_event_is_financial(NEW.is_financial, NEW.storage_path, NULL));

  ELSIF TG_OP = 'UPDATE' THEN
    -- Trash transitions and path changes are independent facts; an UPDATE
    -- carrying both emits both events.
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      INSERT INTO public.file_events
        (workspace_id, project_id, file_id, file_name, storage_provider,
         event, old_path, size_bytes, actor_user_id, actor_label, is_financial)
      VALUES
        (NEW.workspace_id, NEW.project_id, NEW.id, NEW.name, NEW.storage_provider::text,
         'trashed', NEW.storage_path, NEW.size_bytes, v_actor, v_label,
         public.file_event_is_financial(NEW.is_financial, NEW.storage_path, NULL));
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      INSERT INTO public.file_events
        (workspace_id, project_id, file_id, file_name, storage_provider,
         event, new_path, size_bytes, actor_user_id, actor_label, is_financial)
      VALUES
        (NEW.workspace_id, NEW.project_id, NEW.id, NEW.name, NEW.storage_provider::text,
         'restored', NEW.storage_path, NEW.size_bytes, v_actor, v_label,
         public.file_event_is_financial(NEW.is_financial, NEW.storage_path, NULL));
    END IF;

    IF OLD.storage_path IS DISTINCT FROM NEW.storage_path THEN
      INSERT INTO public.file_events
        (workspace_id, project_id, file_id, file_name, storage_provider,
         event, old_path, new_path, size_bytes, actor_user_id, actor_label, is_financial)
      VALUES
        (NEW.workspace_id, NEW.project_id, NEW.id, NEW.name, NEW.storage_provider::text,
         'moved', OLD.storage_path, NEW.storage_path, NEW.size_bytes, v_actor, v_label,
         -- Either side of a move under a money segment classifies the event:
         -- an invoice moved OUT of INVOICES/ is still an invoice's history.
         public.file_event_is_financial(NEW.is_financial, OLD.storage_path, NEW.storage_path));
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    -- The deletion certificate (TPN-CONT-002): what was purged, from where,
    -- how big, by whom (NULL actor = the nightly purge / a cascade).
    INSERT INTO public.file_events
      (workspace_id, project_id, file_id, file_name, storage_provider,
       event, old_path, size_bytes, actor_user_id, actor_label, details, is_financial)
    VALUES
      (OLD.workspace_id, OLD.project_id, OLD.id, OLD.name, OLD.storage_provider::text,
       'purged', OLD.storage_path, OLD.size_bytes, v_actor, v_label,
       -- left(): mime_type is unconstrained client-writable TEXT — an
       -- oversized value would trip the details CHECK inside this trigger,
       -- get swallowed by the handler below, and silently void the
       -- certificate (adversarial review, S14). Truncation keeps the
       -- certificate write infallible for client-reachable inputs.
       jsonb_build_object('mime_type', left(OLD.mime_type, 256), 'kind', OLD.kind::text,
                          'was_trashed', OLD.deleted_at IS NOT NULL),
       -- Flagged even though every reader may see a certificate: the flag is a
       -- fact about the file, the visibility rule is the policy's.
       public.file_event_is_financial(OLD.is_financial, OLD.storage_path, NULL));
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- An audit failure must never abort the write it audits (0012 idiom).
  -- This also swallows the expected FK failure during workspace CASCADE
  -- teardown, where the parent workspaces row is already gone.
  RAISE WARNING 'file_events capture failed for % on files: %', TG_OP, SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_file_events_capture() FROM PUBLIC, anon, authenticated;

-- ── 5. log_file_downloaded, restated in full (0047 + is_financial) ──────────

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

REVOKE EXECUTE ON FUNCTION public.log_file_downloaded(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.log_file_downloaded(UUID) TO authenticated;

-- ── 6. The policy — DROP + CREATE, every arm restated ───────────────────────
-- 0027's two arms verbatim, then the money arm as a conjunct. 🚨 Permissive
-- policies OR together (0038 inverted the invoice gate exactly this way), so
-- the money rule is ONE clause AND-ed onto the whole, never a second policy
-- and never a condition one arm remembers and the other forgets.

DROP POLICY IF EXISTS file_events_select ON public.file_events;
CREATE POLICY file_events_select ON public.file_events
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (
      -- Anyone who can read the project can read its files' history
      -- (files themselves are project-scoped reads — 0014 files_select).
      public.can_read_project_topic(project_id)
      -- Admin arm: proof-of-deletion must stay readable after the project
      -- is purged (can_read_project_topic is false once the row is gone).
      -- JWT role is fine for a read-only listing (0026 rationale).
      OR public.current_app_role() = 'admin'
    )
    -- Track C / 0074 — the money arm (Audrey, ruling 22). A financial row is
    -- visible to a non-money reader ONLY as its deletion certificate; every
    -- other event of an invoice is for those who can read the invoice itself
    -- (0038: workspace admins and project managers, via
    -- can_access_project_money). COALESCE: NULL would deny anyway; say so.
    AND (
      NOT is_financial
      OR event = 'purged'
      OR public.current_app_role() = 'admin'
      OR COALESCE(public.can_access_project_money(project_id), false)
    )
  );

COMMENT ON POLICY file_events_select ON public.file_events IS
  'Track C / 0074 restating 0027: project readers and workspace admins read the '
  'stream; a financial row (is_financial) is hidden from non-money readers '
  'except its purged certificate. Every arm is in this one definition — re-run '
  '0074 after any replay of 0027.';

-- ── 7. abandon_upload_reservation — the client''s failure path ───────────────
-- Ruling 1. Mirrors release_upload_reservation's scoping exactly (own row, own
-- workspace, still open) and sweep_abandoned_uploads' certificate exactly, with
-- the client's reason added. The landed check keeps it honest: a "failure"
-- reported after the object arrived closes the row 'completed' and certifies
-- nothing — the bytes are there.

CREATE OR REPLACE FUNCTION public.abandon_upload_reservation(
  p_path   TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_label  TEXT;
  v_landed BOOLEAN;
  r        RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'abandon_upload_reservation: not signed in'
      USING ERRCODE = '42501';
  END IF;

  SELECT ur.id, ur.workspace_id, ur.project_id, ur.storage_path, ur.bytes,
         ur.created_by, ur.created_at, ur.expires_at
    INTO r
    FROM public.upload_reservations ur
   WHERE ur.storage_path = p_path
     AND ur.released_at IS NULL
     AND ur.created_by = v_uid
     AND ur.workspace_id = public.current_workspace_id()
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Did the upload actually finish? (The sweep's test, 0073.)
  SELECT EXISTS (
           SELECT 1 FROM storage.objects o
            WHERE o.bucket_id = 'rabbit-files' AND o.name = r.storage_path)
      OR EXISTS (
           SELECT 1 FROM public.files f
            WHERE f.storage_path = r.storage_path)
    INTO v_landed;

  IF v_landed THEN
    UPDATE public.upload_reservations
       SET released_at = now(), outcome = 'completed'
     WHERE id = r.id;
    RETURN true;
  END IF;

  SELECT COALESCE(wm.display_name, wm.username) INTO v_label
    FROM public.workspace_members wm
   WHERE wm.workspace_id = r.workspace_id
     AND wm.user_id = v_uid;

  -- 🚨 file_id IS A SURROGATE AND SAYS SO (0057's reasoning, kept by 0073): a
  -- fragment never had a files row. Unlike the sweep's certificate this one has
  -- an actor — the person whose client reported the failure — and a reason.
  INSERT INTO public.file_events (
    workspace_id, project_id, file_id, file_name, storage_provider,
    event, new_path, size_bytes, actor_user_id, actor_label, details, is_financial
  ) VALUES (
    r.workspace_id, r.project_id, gen_random_uuid(),
    regexp_replace(r.storage_path, '^.*/', ''), 'supabase',
    'upload_abandoned', r.storage_path, r.bytes, v_uid, v_label,
    jsonb_build_object(
      'reservation_id', r.id,
      'started_by',     r.created_by,
      'reserved_at',    r.created_at,
      'abandoned_at',   now(),
      'reported_by',    'client',
      -- Client-supplied text, bounded: the details CHECK is 4000 chars and a
      -- refused certificate is worse than a shortened reason.
      'reason',         left(p_reason, 500),
      'note',           'the resumable upload failed with an error its server answered, and the client reported it at once. Any partial is expired by Supabase Storage at 24 h and is not enumerable from WILSON, so this certifies the abandonment, not the disposal of bytes'),
    -- Always false in practice (a money path is never reserved); computed, not
    -- assumed.
    public.file_event_is_financial(false, r.storage_path, NULL)
  );

  UPDATE public.upload_reservations
     SET released_at = now(), outcome = 'abandoned'
   WHERE id = r.id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.abandon_upload_reservation(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abandon_upload_reservation(TEXT, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.abandon_upload_reservation(TEXT, TEXT) IS
  'Track C / 0074 (ruling 1, TPN-CONT-017): the client''s failure path. Closes '
  'the caller''s own open reservation for p_path as ''abandoned'' and writes the '
  'upload_abandoned certificate at once, with p_reason (bounded to 500 chars). '
  'If the object had in fact landed the row closes ''completed'' and nothing is '
  'certified. Idempotent: true when a row was closed, false when there was none. '
  'A network drop never reaches this; the hourly sweep certifies it at 24 h.';

-- ── 8. release_stale_upload_reservations — opening Files ────────────────────
-- Ruling 2. The caller's own open rows, minus the keys their client is still
-- uploading (p_keep), close without a certificate. Scoped exactly like
-- release_upload_reservation; touches nobody else's rows.

CREATE OR REPLACE FUNCTION public.release_stale_upload_reservations(
  p_keep TEXT[] DEFAULT '{}'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_n   INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'release_stale_upload_reservations: not signed in'
      USING ERRCODE = '42501';
  END IF;

  WITH closed AS (
    UPDATE public.upload_reservations ur
       SET released_at = now(),
           outcome = CASE
             WHEN EXISTS (SELECT 1 FROM storage.objects o
                           WHERE o.bucket_id = 'rabbit-files' AND o.name = ur.storage_path)
               OR EXISTS (SELECT 1 FROM public.files f
                           WHERE f.storage_path = ur.storage_path)
             THEN 'completed'
             ELSE 'released'
           END
     WHERE ur.released_at IS NULL
       AND ur.created_by = v_uid
       AND ur.workspace_id = public.current_workspace_id()
       AND NOT (ur.storage_path = ANY (COALESCE(p_keep, '{}'::text[])))
    RETURNING ur.id
  )
  SELECT count(*)::integer INTO v_n FROM closed;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.release_stale_upload_reservations(TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_stale_upload_reservations(TEXT[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.release_stale_upload_reservations(TEXT[]) IS
  'Track C / 0074 (ruling 2): called when a person opens Files. Closes their '
  'own open reservations in the current workspace EXCEPT the keys in p_keep '
  '(what their client is still uploading) — ''completed'' where the object '
  'landed, otherwise ''released''. Writes NO certificate: these rows lose theirs '
  'by Audrey''s ruling (handbook §17). Returns the number of rows closed.';

-- ── 9. sweep_open_uploads — the teardown sweep ──────────────────────────────
-- Every OPEN row of ONE tenant, expired or not: at teardown an in-flight upload
-- is abandoned by definition (its project is about to be destroyed). Plain FOR
-- UPDATE, not SKIP LOCKED — a row skipped here would be CASCADEd away
-- uncertified, which is the gap this function closes. Returns the abandoned
-- paths so the caller can certify them where the CASCADE cannot reach.

CREATE OR REPLACE FUNCTION public.sweep_open_uploads(p_workspace_id UUID)
RETURNS TABLE (abandoned INTEGER, completed INTEGER, abandoned_paths TEXT[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r           RECORD;
  v_abandoned INTEGER := 0;
  v_completed INTEGER := 0;
  v_paths     TEXT[]  := '{}';
  v_landed    BOOLEAN;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'sweep_open_uploads: a workspace id is required — this closes every open reservation of ONE tenant'
      USING ERRCODE = '22023';
  END IF;

  FOR r IN
    SELECT ur.id, ur.workspace_id, ur.project_id, ur.storage_path, ur.bytes,
           ur.created_by, ur.created_at, ur.expires_at
      FROM public.upload_reservations ur
     WHERE ur.released_at IS NULL
       AND ur.workspace_id = p_workspace_id
     ORDER BY ur.id
       FOR UPDATE
  LOOP
    SELECT EXISTS (
             SELECT 1 FROM storage.objects o
              WHERE o.bucket_id = 'rabbit-files' AND o.name = r.storage_path)
        OR EXISTS (
             SELECT 1 FROM public.files f
              WHERE f.storage_path = r.storage_path)
      INTO v_landed;

    IF v_landed THEN
      UPDATE public.upload_reservations
         SET released_at = now(), swept_at = now(), outcome = 'completed'
       WHERE id = r.id;
      v_completed := v_completed + 1;
      CONTINUE;
    END IF;

    -- The same certificate the hourly sweep writes (0073), plus who closed it.
    -- It leaves with the tenant's file_events at the CASCADE; the surviving
    -- record is what the caller writes to platform_audit from the returned
    -- paths (WIL-7009) and the counts on WIL-7005.
    INSERT INTO public.file_events (
      workspace_id, project_id, file_id, file_name, storage_provider,
      event, new_path, size_bytes, actor_user_id, actor_label, details, is_financial
    ) VALUES (
      r.workspace_id, r.project_id, gen_random_uuid(),
      regexp_replace(r.storage_path, '^.*/', ''), 'supabase',
      'upload_abandoned', r.storage_path, r.bytes, NULL, 'system',
      jsonb_build_object(
        'reservation_id', r.id,
        'started_by',     r.created_by,
        'reserved_at',    r.created_at,
        'expires_at',     r.expires_at,
        'closed_by',      'teardown',
        'note',           'the upload was still open when the company was torn down. Any partial is expired by Supabase Storage at 24 h and is not enumerable from WILSON, so this certifies the abandonment, not the disposal of bytes'),
      public.file_event_is_financial(false, r.storage_path, NULL)
    );

    UPDATE public.upload_reservations
       SET released_at = now(), swept_at = now(), outcome = 'abandoned'
     WHERE id = r.id;
    v_abandoned := v_abandoned + 1;
    v_paths := v_paths || r.storage_path;
  END LOOP;

  abandoned       := v_abandoned;
  completed       := v_completed;
  abandoned_paths := v_paths;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_open_uploads(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_open_uploads(UUID) TO service_role;

COMMENT ON FUNCTION public.sweep_open_uploads(UUID) IS
  'Track C / 0074 (teardown, TPN-CONT-017): close EVERY open upload reservation '
  'of one workspace regardless of expiry — ''completed'' when its object landed, '
  'otherwise ''abandoned'' with one upload_abandoned certificate — and return '
  'the abandoned paths. Called by operator-workspaces BEFORE the teardown '
  'CASCADE; the certificates it writes leave with the tenant, the counts and '
  'paths it returns go to platform_audit. service_role only; a NULL workspace '
  'is refused (22023).';

-- ── 10. Post-conditions ─────────────────────────────────────────────────────

DO $$
DECLARE
  n     INT;
  q     TEXT;
  d     TEXT;
BEGIN
  -- 1. The column: present, NOT NULL, default false.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'file_events'
       AND column_name = 'is_financial' AND is_nullable = 'NO'
       AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION '0074 post-condition failed: file_events.is_financial missing, nullable, or without DEFAULT false';
  END IF;

  -- 2. 0027's invariant survives: exactly ONE policy on file_events, SELECT only.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'file_events';
  IF n <> 1 THEN
    RAISE EXCEPTION '0074 post-condition failed: file_events must have exactly 1 policy, found %', n;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'file_events'
       AND cmd <> 'SELECT'
  ) THEN
    RAISE EXCEPTION '0074 post-condition failed: file_events must stay append-only (client writes denied)';
  END IF;

  -- 3. The policy carries the money arm AND both original arms.
  SELECT qual INTO q FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'file_events'
     AND policyname = 'file_events_select';
  IF q IS NULL
     OR q NOT LIKE '%is_financial%'
     OR q NOT LIKE '%purged%'
     OR q NOT LIKE '%can_access_project_money%'
     OR q NOT LIKE '%can_read_project_topic%'
     OR q NOT LIKE '%current_app_role%'
     OR q NOT LIKE '%has_active_membership%' THEN
    RAISE EXCEPTION '0074 post-condition failed: file_events_select does not carry every arm (money + 0027''s two): %', COALESCE(q, '<missing>');
  END IF;

  -- 4. The capture trigger snapshots the flag (a 0027 replay would drop this).
  SELECT pg_get_functiondef('public.fn_file_events_capture()'::regprocedure) INTO d;
  IF d NOT LIKE '%file_event_is_financial%' THEN
    RAISE EXCEPTION '0074 post-condition failed: fn_file_events_capture does not set is_financial';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_files_lifecycle'
       AND tgrelid = 'public.files'::regclass
  ) THEN
    RAISE EXCEPTION '0074 post-condition failed: trg_files_lifecycle missing';
  END IF;

  -- 5. The download logger snapshots it too (a 0047 replay would drop this).
  SELECT pg_get_functiondef('public.log_file_downloaded(uuid)'::regprocedure) INTO d;
  IF d NOT LIKE '%file_event_is_financial%' THEN
    RAISE EXCEPTION '0074 post-condition failed: log_file_downloaded does not set is_financial';
  END IF;

  -- 6. The definition itself, on known inputs — never NULL.
  IF public.rabbit_money_key('projects/00000000-0000-0000-0000-000000000001/INVOICES/1-a.pdf') IS NOT TRUE
     OR public.rabbit_money_key('projects/00000000-0000-0000-0000-000000000001/finance/RATES.json') IS NOT TRUE
     OR public.rabbit_money_key('projects/00000000-0000-0000-0000-000000000001/ASSETS/a1/1-a.mov') IS NOT FALSE
     OR public.rabbit_money_key('INVOICES/1-a.pdf') IS NOT FALSE
     OR public.rabbit_money_key(NULL) IS NOT FALSE
     OR public.file_event_is_financial(true, NULL, NULL) IS NOT TRUE
     OR public.file_event_is_financial(NULL, NULL, NULL) IS NOT FALSE
     OR public.file_event_is_financial(false, NULL, 'projects/x/INVOICES/1-a.pdf') IS NOT TRUE THEN
    RAISE EXCEPTION '0074 post-condition failed: rabbit_money_key / file_event_is_financial do not classify the known inputs';
  END IF;

  -- 7. The backfill left no live financial file with an unflagged event.
  IF EXISTS (
    SELECT 1 FROM public.file_events fe
      JOIN public.files f ON f.id = fe.file_id
     WHERE f.is_financial AND NOT fe.is_financial
  ) THEN
    RAISE EXCEPTION '0074 post-condition failed: a financial file still has an unflagged event';
  END IF;

  -- 8. The three RPCs exist with the intended grants. has_function_privilege,
  --    not role_table_grants (which cannot see PUBLIC — the 0073 lesson):
  --    anon inherits PUBLIC, so asking what anon can do covers both.
  IF to_regprocedure('public.abandon_upload_reservation(text, text)') IS NULL
     OR to_regprocedure('public.release_stale_upload_reservations(text[])') IS NULL
     OR to_regprocedure('public.sweep_open_uploads(uuid)') IS NULL THEN
    RAISE EXCEPTION '0074 post-condition failed: a reservation RPC is missing';
  END IF;
  IF has_function_privilege('anon', 'public.abandon_upload_reservation(text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.release_stale_upload_reservations(text[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.sweep_open_uploads(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0074 post-condition failed: anon (and so PUBLIC) can execute a reservation RPC';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.abandon_upload_reservation(text, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.release_stale_upload_reservations(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION '0074 post-condition failed: authenticated cannot execute the client RPCs';
  END IF;
  IF has_function_privilege('authenticated', 'public.sweep_open_uploads(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.sweep_open_uploads(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0074 post-condition failed: sweep_open_uploads must be service_role only';
  END IF;

  -- 9. The vocabulary is exactly as 0073 left it: one constraint, admitting
  --    upload_abandoned (the two new writers depend on it).
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.file_events'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%uploaded%';
  IF n <> 1 THEN
    RAISE EXCEPTION '0074 post-condition failed: % vocabulary constraints on file_events, expected exactly 1', n;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.file_events'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%upload_abandoned%'
  ) THEN
    RAISE EXCEPTION '0074 post-condition failed: the vocabulary no longer admits upload_abandoned';
  END IF;
END $$;
