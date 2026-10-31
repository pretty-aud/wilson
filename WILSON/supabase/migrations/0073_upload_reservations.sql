-- =============================================================================
-- 0073_upload_reservations.sql — Track C, bundle C1 (reservation half).
-- Audrey's decision 32 (2026-09-04): "reserve space when an upload starts."
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
--
-- Two resumable uploads started together can exceed a company's Petal quota.
-- The RESTRICTIVE policy petal_storage_quota_insert (0055, weighed since 0057)
-- sees only COMMITTED objects, and a TUS upload has no storage.objects row until
-- it completes — so N uploads each pass a creation check that is blind to the
-- other N-1. 0057 tried to close this by metering
-- storage.s3_multipart_uploads.in_progress_size, and the premise was FALSE:
-- WILSON uploads over TUS (/storage/v1/upload/resumable), whose state
-- storage-api keeps in S3 `.info` objects; that table is written only by the
-- S3-compatible protocol handler WILSON never calls. 0058 removed the arm, and
-- suite 66 probe 13 asserts the meter does NOT move on that table. Read 0058's
-- header before touching the meter: it is the record of a green fix that fixed
-- nothing.
--
-- A second gap rode on the same fact (TPN-CONT-017): an abandoned resumable
-- upload leaves a partial in Supabase's own S3 bucket that WILSON cannot
-- enumerate, count or certify. Supabase expires it at 24 h, so the bytes do go —
-- but WILSON has no evidence that they did. A certification gap, not a disposal
-- gap.
--
-- ── WHAT THIS FILE BUILDS ────────────────────────────────────────────────────
--
-- A WILSON-side RESERVATION, written by the client BEFORE tus.Upload.start()
-- and released when the upload finishes, that the quota policy can see:
--
--   1. public.upload_reservations — one row per in-flight resumable upload:
--      workspace, project, the intended storage_path, bytes, expires_at (24 h,
--      matching Supabase's TUS URL expiry: an upload that has not completed by
--      then CANNOT complete, because storage-api refuses further PATCHes), and
--      released_at / swept_at / outcome for the bookkeeping.
--   2. reserve_upload_bytes(path, bytes) — SECURITY DEFINER, callable by
--      authenticated: checks the caller may write the project, serialises per
--      workspace with an advisory lock (two racing reserves cannot both pass),
--      evaluates THE SAME predicate the policy uses, and inserts. Money paths and
--      the manifest are quota-exempt (0055) and so are reservation-exempt: they
--      return NULL and write nothing, because reserving for a body the policy
--      never weighs could only refuse an upload the policy would admit.
--   3. release_upload_reservation(path) — the caller's own active reservation is
--      closed. Idempotent: a second call returns false.
--   4. workspace_upload_reserved_bytes(ws, except_path) — the SUM of ACTIVE
--      reservations (released_at IS NULL AND expires_at > now()) EXCLUDING two
--      things: the reservation for `except_path` (so an upload's own reservation
--      is never weighed against its own body), and any reservation whose object
--      has ALREADY LANDED in rabbit-files (so the committed object and its own
--      reservation are never both in `used` for the same instant). That second
--      exclusion is what makes "release first, then the object is counted" true
--      BY CONSTRUCTION rather than by client timing — a client that crashes
--      after completion leaves a row that stops counting the moment its object
--      exists.
--   5. workspace_petal_bytes(ws) = committed bytes (0058's body, now
--      workspace_petal_committed_bytes) + active reservations. So the RESTRICTIVE
--      policy, workspace_storage_usage() and operator_storage_plan_summary() all
--      see reserved space as used space — which it is.
--   6. rabbit_petal_storage_ok(project, incoming, path) — a third argument, the
--      object's own key, so the gate excludes that key's reservation from the
--      total it weighs the incoming body against. The 2-arg form becomes a shim
--      (NULL path: every reservation counts, the conservative reading) and the
--      1-arg form stays for 0056's post-condition. The policy is re-pointed at
--      the 3-arg form; its first two arms are restated verbatim.
--   7. sweep_abandoned_uploads(workspace) — service_role only: every expired,
--      unreleased reservation is classified. If its object landed (or a files row
--      names the path) it is closed as 'completed' with no certificate. Otherwise
--      it is closed as 'abandoned' and ONE file_events 'upload_abandoned' row is
--      written — the 0057 term that 0058 removed for having no writer; now it has
--      one. storage-gc calls this per workspace on every admin-invoked cleanup,
--      and pg_cron runs it hourly across all workspaces (it destroys nothing, so
--      TS-1.5's dual-authorisation argument for keeping the GC admin-invoked does
--      not apply to it).
--
-- ── 🚨 NULL-SAFETY, TWICE ────────────────────────────────────────────────────
--
-- SUM() over zero rows is NULL, `NULL <= quota` is NULL, and a NULL DENIES under
-- a RESTRICTIVE policy — so a dropped COALESCE means no workspace can upload its
-- FIRST FILE EVER, with a symptom indistinguishable from the quota working.
-- 0055's outer COALESCE on the committed meter survives (suite 66 probe 10 and
-- 0058 post-condition 4 pin it); this file adds the TWIN on the reservation arm
-- (post-condition 3, suite 77) and keeps an outer COALESCE on the sum of the two.
--
-- ── STATED LIMITS ────────────────────────────────────────────────────────────
--
--   * Only the RESUMABLE path reserves (bodies above 50 MiB, resumableUpload.js).
--     A standard PUT lands in one request and is weighed as it lands; the hole
--     this closes is the one that lasts minutes to hours.
--   * The certificate says the reservation EXPIRED UNCOMPLETED. It does not say
--     bytes were destroyed: the partial lives in Supabase's own bucket and is
--     reaped by the platform's 24 h TUS expiry, which SQL cannot observe. Same
--     honesty rule as S37's GC and 0057's withdrawn sweep.
--   * The file_events row carries a SURROGATE file_id (a fragment never had a
--     files row), so the per-FILE audit drawer never shows it; the workspace
--     takeout, the file_events table and the WIL-3003 cleanup certificate do.
--   * A reservation that outlives its 24 h while the upload is still running
--     stops counting; the object is then weighed at completion against whatever
--     else landed meanwhile. That is the brief's "a reservation that lapses
--     cannot admit an over-quota object", and because Supabase refuses the
--     PATCHes past 24 h as well, such an upload cannot complete anyway.
--
-- Ordering: 0055 → 0056 → 0057 → 0058 → 0073. A replay of 0058 after this file
-- would put the meter back to committed-only and reports success while doing
-- it; post-condition 4 here is the tripwire, and the pair is recorded in the
-- migration-rules memory.
-- =============================================================================

-- ── 1. The table ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.upload_reservations (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- No FK on project_id, deliberately (the 0027 file_events convention): an
  -- expired reservation must still be certifiable after its project is deleted,
  -- and the sweep's certificate is what outlives the subject. Validated against
  -- a live project at reserve time instead.
  project_id    UUID NOT NULL,
  -- Row-shaped, like files.storage_path: the Petal bucket has no prefix and the
  -- key is compared byte-for-byte with storage.objects.name.
  storage_path  TEXT NOT NULL,
  bytes         BIGINT NOT NULL,
  -- No FK on the actor (0007/0012 convention).
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 24 h = Supabase's TUS upload-URL expiry. Past it the upload cannot complete.
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  released_at   TIMESTAMPTZ,
  swept_at      TIMESTAMPTZ,
  outcome       TEXT,
  CONSTRAINT upload_reservations_bytes_chk
    CHECK (bytes > 0),
  CONSTRAINT upload_reservations_path_chk
    CHECK (storage_path ~ '^projects/[^/]+/.+' AND char_length(storage_path) <= 1024),
  CONSTRAINT upload_reservations_expiry_chk
    CHECK (expires_at > created_at),
  CONSTRAINT upload_reservations_outcome_chk
    CHECK (outcome IS NULL OR outcome IN ('released', 'completed', 'abandoned')),
  -- A closed row has an outcome and an open row has none; a swept row was
  -- closed by the sweep, never by the client.
  CONSTRAINT upload_reservations_closed_chk
    CHECK ((released_at IS NULL) = (outcome IS NULL)),
  CONSTRAINT upload_reservations_swept_chk
    CHECK (swept_at IS NULL OR outcome IN ('completed', 'abandoned'))
);

-- The meter's scan and the sweep's scan: active rows per workspace.
CREATE INDEX IF NOT EXISTS upload_reservations_active_idx
  ON public.upload_reservations (workspace_id, expires_at)
  WHERE released_at IS NULL;

-- One ACTIVE reservation per key. uploadFile mints a unique key per attempt
-- (Date.now()-<name>), so a second active row for the same key is a client
-- defect, and this is what makes release_upload_reservation(path) exact.
CREATE UNIQUE INDEX IF NOT EXISTS upload_reservations_active_path_uniq
  ON public.upload_reservations (storage_path)
  WHERE released_at IS NULL;

COMMENT ON TABLE public.upload_reservations IS
  'Track C / 0073: space reserved for a resumable upload before it starts, so '
  'the quota policy can see bytes that have no storage.objects row yet. Written '
  'only by reserve_upload_bytes / release_upload_reservation / '
  'sweep_abandoned_uploads; clients read their own rows and write nothing '
  'directly. An expired, unreleased row whose object never landed is the '
  'WILSON-side record of a partial upload (TPN-CONT-017).';

ALTER TABLE public.upload_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_reservations FORCE ROW LEVEL SECURITY;

-- One read policy, zero write policies (the 0031/0055 shape). A member sees the
-- reservations they made in the workspace their claim names; no admin arm yet
-- (the Admin Terminal reads the total through workspace_storage_usage()).
DROP POLICY IF EXISTS upload_reservations_select ON public.upload_reservations;
CREATE POLICY upload_reservations_select ON public.upload_reservations
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND created_by = auth.uid()
  );

REVOKE ALL ON public.upload_reservations FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.upload_reservations FROM authenticated;
GRANT  SELECT ON public.upload_reservations TO authenticated;
GRANT  ALL    ON public.upload_reservations TO service_role;

-- ── 2. The reservation arm of the meter ─────────────────────────────────────
--
-- 🚨 THE OUTER COALESCE IS LOAD-BEARING: this is called from inside the
-- RESTRICTIVE policy's predicate, and SUM() over zero rows is NULL.

CREATE OR REPLACE FUNCTION public.workspace_upload_reserved_bytes(
  ws            UUID,
  p_except_path TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(r.bytes), 0)::bigint
    FROM public.upload_reservations r
   WHERE r.workspace_id = ws
     AND r.released_at IS NULL
     AND r.expires_at > now()
     -- The reservation for the object being weighed is not counted against
     -- that object: NULL-safe because storage_path is NOT NULL.
     AND (p_except_path IS NULL OR r.storage_path <> p_except_path)
     -- 🚨 A reservation whose object has landed stops counting THAT INSTANT, so
     -- the committed object and its own reservation are never both in `used`.
     -- storage.objects has a unique index on (bucket_id, name); this is an
     -- index probe per active reservation.
     AND NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'rabbit-files'
          AND o.name = r.storage_path
     );
$$;

REVOKE ALL ON FUNCTION public.workspace_upload_reserved_bytes(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_upload_reserved_bytes(UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.workspace_upload_reserved_bytes(UUID, TEXT) IS
  'Track C / 0073: bytes reserved by ACTIVE upload reservations in this '
  'workspace (unreleased, unexpired, and whose object has not yet landed in '
  'rabbit-files), excluding the reservation for p_except_path. COALESCEd to 0: '
  'a NULL here denies every upload under the RESTRICTIVE policy. Takes an '
  'arbitrary workspace id, so like workspace_petal_bytes it is service_role '
  'only.';

-- ── 3. The meter: committed + reserved ──────────────────────────────────────

-- 0058's body, under its own name. Unchanged in substance.
CREATE OR REPLACE FUNCTION public.workspace_petal_committed_bytes(ws UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(COALESCE(public.rabbit_object_incoming_bytes(o.metadata), 0)), 0)::bigint
    FROM storage.objects o
    JOIN public.projects p
      ON p.id = public.fn_try_uuid((storage.foldername(o.name))[2])
   WHERE o.bucket_id IN ('rabbit-files', 'rabbit-thumbnails')
     AND (storage.foldername(o.name))[1] = 'projects'
     AND p.workspace_id = ws;
$$;

REVOKE ALL ON FUNCTION public.workspace_petal_committed_bytes(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_petal_committed_bytes(UUID) TO service_role;

COMMENT ON FUNCTION public.workspace_petal_committed_bytes(UUID) IS
  'Track C / 0073: bytes this workspace holds as COMMITTED objects in '
  'rabbit-files + rabbit-thumbnails — 0058''s workspace_petal_bytes body under '
  'its own name, so the gate can add the reservation arm with an exclusion. '
  'service_role only (0056).';

CREATE OR REPLACE FUNCTION public.workspace_petal_bytes(ws UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Both arms COALESCE internally; the outer one is the belt to their braces.
  SELECT COALESCE(
           COALESCE(public.workspace_petal_committed_bytes(ws), 0)
         + COALESCE(public.workspace_upload_reserved_bytes(ws, NULL), 0),
         0)::bigint;
$$;

-- 0056 closed this to client roles and that must hold (restated because CREATE
-- OR REPLACE re-touches the function).
REVOKE ALL ON FUNCTION public.workspace_petal_bytes(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_petal_bytes(UUID) TO service_role;

COMMENT ON FUNCTION public.workspace_petal_bytes(UUID) IS
  'Track C / 0073: bytes this workspace holds in Petal storage — COMMITTED '
  'objects (rabbit-files + rabbit-thumbnails) PLUS space reserved by resumable '
  'uploads in progress (upload_reservations, active and not yet landed). What '
  'the RESTRICTIVE policy, workspace_storage_usage() and the operator summary '
  'all read, so reserved space shows as used space. 🚨 NOT EXECUTABLE BY A '
  'CLIENT ROLE (0056).';

-- ── 4. The gate, now excluding the object''s own reservation ────────────────

CREATE OR REPLACE FUNCTION public.rabbit_petal_storage_ok(
  p_project_id UUID,
  p_incoming   BIGINT,
  p_path       TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Fails CLOSED on an unresolvable project (outer COALESCE), which costs
  -- nothing because the permissive policies' EXISTS already refuses such a key.
  SELECT COALESCE((
    SELECT COALESCE(pl.status, 'active') = 'active'
       AND CASE
             -- 🚨 UNKNOWN SIZE MUST NOT DENY (0057): fall back to the unweighed
             -- test rather than refuse every upload in the product.
             WHEN p_incoming IS NULL THEN
               public.workspace_petal_committed_bytes(p.workspace_id)
                 + public.workspace_upload_reserved_bytes(p.workspace_id, p_path)
                 <  COALESCE(pl.quota_bytes, public.storage_free_tier_bytes())
             -- `<=`: used + incoming IS the total after this write.
             ELSE
               public.workspace_petal_committed_bytes(p.workspace_id)
                 + public.workspace_upload_reserved_bytes(p.workspace_id, p_path)
                 + p_incoming
                 <= COALESCE(pl.quota_bytes, public.storage_free_tier_bytes())
           END
      FROM public.projects p
      LEFT JOIN public.workspace_storage_plans pl
        ON pl.workspace_id = p.workspace_id
     WHERE p.id = p_project_id
  ), false);
$$;

REVOKE ALL ON FUNCTION public.rabbit_petal_storage_ok(UUID, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rabbit_petal_storage_ok(UUID, BIGINT, TEXT)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.rabbit_petal_storage_ok(UUID, BIGINT, TEXT) IS
  'Track C / 0073: may this project''s workspace accept an object of p_incoming '
  'bytes at p_path? committed + reserved-by-OTHER-uploads + incoming <= quota '
  '(or committed + reserved < quota when the size is unknown). The object''s '
  'own reservation is excluded so an upload is never weighed against itself, '
  'at creation (the tus trial insert) or at completion. The ONE predicate: '
  'reserve_upload_bytes evaluates it too, so the reservation check and the '
  'policy cannot drift.';

-- The 2-arg form becomes a shim with an unknown path: every active reservation
-- counts, which is the conservative reading for a caller that cannot name the
-- key (suite 66 probe 24, 0057's post-condition).
CREATE OR REPLACE FUNCTION public.rabbit_petal_storage_ok(
  p_project_id UUID,
  p_incoming   BIGINT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT public.rabbit_petal_storage_ok(p_project_id, p_incoming, NULL::text);
$$;

REVOKE ALL ON FUNCTION public.rabbit_petal_storage_ok(UUID, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rabbit_petal_storage_ok(UUID, BIGINT)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.rabbit_petal_storage_ok(UUID, BIGINT) IS
  'Track C / 0073: shim over rabbit_petal_storage_ok(uuid, bigint, text) with '
  'an unknown path, so every active reservation counts. Kept because 0057''s '
  'post-condition and suite 66 name this signature. Not SECURITY DEFINER: the '
  'function it calls is.';

-- The 1-arg shim (0057) is untouched: it delegates to the 2-arg form, which now
-- delegates here. 0056's post-condition names it; it must survive.

-- ── 4b. Re-point the restrictive policy at the 3-arg form ───────────────────
-- Same name, same RESTRICTIVE, same first two arms VERBATIM (the 0059 lesson:
-- restate every arm, never "the one that changed"). 0055 post-conditions 4/6,
-- 0058 post-condition 5 and suite 63's bare rabbit_files% count of 8 all stay
-- true.

DROP POLICY IF EXISTS petal_storage_quota_insert ON storage.objects;
CREATE POLICY petal_storage_quota_insert ON storage.objects
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    -- Self-limiting FIRST: a restrictive policy is evaluated for EVERY insert
    -- into storage.objects, and three buckets share that table.
    bucket_id <> 'rabbit-files'
    OR public.rabbit_quota_exempt_path(name)
    OR public.rabbit_petal_storage_ok(
         public.fn_try_uuid((storage.foldername(name))[2]),
         public.rabbit_object_incoming_bytes(metadata),
         name)
  );

COMMENT ON POLICY petal_storage_quota_insert ON storage.objects IS
  'Track C / 0073: the Petal-cloud quota and suspension gate, weighing the '
  'incoming body against committed objects PLUS active upload reservations, '
  'minus this key''s own reservation. RESTRICTIVE because rabbit-files INSERT '
  'has two permissive arms and permissive policies OR together (0055). Binds to '
  'resumable uploads because completeUpload upserts and uploadFile mints a '
  'unique key, so the INSERT arm is taken (0057).';

-- ── 5. Reserve ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reserve_upload_bytes(
  p_path  TEXT,
  p_bytes BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  IF v_ws IS NULL
     OR v_ws IS DISTINCT FROM public.current_workspace_id()
     OR NOT COALESCE(public.has_active_membership(v_ws), false) THEN
    RAISE EXCEPTION 'reserve_upload_bytes: you cannot write to this project'
      USING ERRCODE = '42501';
  END IF;

  -- Money paths and the manifest are exempt from the quota (0055), so they are
  -- exempt from reservation: nothing to weigh, nothing to write. The object
  -- itself is still gated by rabbit_files_money_insert at commit.
  IF public.rabbit_quota_exempt_path(p_path) THEN
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

REVOKE ALL ON FUNCTION public.reserve_upload_bytes(TEXT, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_upload_bytes(TEXT, BIGINT) TO authenticated, service_role;

COMMENT ON FUNCTION public.reserve_upload_bytes(TEXT, BIGINT) IS
  'Track C / 0073: reserve p_bytes of Petal quota for a resumable upload to '
  'p_path BEFORE it starts. Returns the reservation id, or NULL for a '
  'quota-exempt path (money segments, the manifest) where nothing is reserved. '
  'Raises PT402 (HTTP 402 through PostgREST) with the standing over-quota '
  'sentence when it does not fit, 42501 when the caller cannot write the '
  'project, 22023 for a malformed request. Serialised per workspace with an '
  'advisory lock; evaluates the SAME predicate as petal_storage_quota_insert.';

-- ── 6. Release ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.release_upload_reservation(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_n   INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'release_upload_reservation: not signed in'
      USING ERRCODE = '42501';
  END IF;
  UPDATE public.upload_reservations
     SET released_at = now(), outcome = 'released'
   WHERE storage_path = p_path
     AND released_at IS NULL
     AND created_by = v_uid
     AND workspace_id = public.current_workspace_id();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.release_upload_reservation(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_upload_reservation(TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.release_upload_reservation(TEXT) IS
  'Track C / 0073: close the caller''s own active reservation for p_path. '
  'Idempotent — true when a row was closed, false when there was none. The '
  'meter already stopped counting the reservation the instant its object '
  'landed, so the timing of this call never double-counts.';

-- ── 7. The vocabulary: ''upload_abandoned'' returns, WITH a writer ──────────
-- Discovery-based drop, the 0047/0057/0058 pattern: drop ANY check constraint
-- on file_events whose definition mentions 'uploaded'. MEASURED before this
-- file was written (2026-09-06): zero rows carry the value on dev, staging or
-- prod, so the widening cannot fail on data; the ADD keeps every existing term.

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.file_events'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%uploaded%'
  LOOP
    EXECUTE format('ALTER TABLE public.file_events DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.file_events
  ADD CONSTRAINT file_events_event_check CHECK (event IN
    ('uploaded', 'downloaded', 'moved', 'relinked', 'trashed', 'restored',
     'purged',
     -- Track C / 0073: written by sweep_abandoned_uploads, and only by it.
     'upload_abandoned'));

-- ── 8. The sweep ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sweep_abandoned_uploads(
  p_workspace_id UUID DEFAULT NULL
)
RETURNS TABLE (abandoned INTEGER, completed INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r           RECORD;
  v_abandoned INTEGER := 0;
  v_completed INTEGER := 0;
  v_landed    BOOLEAN;
BEGIN
  FOR r IN
    SELECT ur.id, ur.workspace_id, ur.project_id, ur.storage_path, ur.bytes,
           ur.created_by, ur.created_at, ur.expires_at
      FROM public.upload_reservations ur
     WHERE ur.released_at IS NULL
       AND ur.expires_at <= now()
       AND (p_workspace_id IS NULL OR ur.workspace_id = p_workspace_id)
     ORDER BY ur.id
       FOR UPDATE SKIP LOCKED
  LOOP
    -- Did the upload actually finish? Either the object is in the bucket or a
    -- files row names the path (the row can outlive a purged object for its
    -- trash window, and either is proof the bytes arrived).
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

    -- 🚨 file_id IS A SURROGATE AND SAYS SO (0057's reasoning, kept): a
    -- fragment never had a files row, so a fresh uuid stands in and the real
    -- identity is in new_path + details. The per-FILE drawer never shows this;
    -- the workspace takeout and the WIL-3003 certificate do. actor is NULL: a
    -- system write (0027 convention); the person who started the upload is in
    -- details.started_by.
    INSERT INTO public.file_events (
      workspace_id, project_id, file_id, file_name, storage_provider,
      event, new_path, size_bytes, actor_user_id, actor_label, details
    ) VALUES (
      r.workspace_id, r.project_id, gen_random_uuid(),
      regexp_replace(r.storage_path, '^.*/', ''), 'supabase',
      'upload_abandoned', r.storage_path, r.bytes, NULL, 'system',
      jsonb_build_object(
        'reservation_id', r.id,
        'started_by',     r.created_by,
        'reserved_at',    r.created_at,
        'expired_at',     r.expires_at,
        'note',           'the resumable upload never completed; its reservation expired and was not released. Any partial is expired by Supabase Storage at 24 h and is not enumerable from WILSON, so this certifies the abandonment, not the disposal of bytes')
    );

    UPDATE public.upload_reservations
       SET released_at = now(), swept_at = now(), outcome = 'abandoned'
     WHERE id = r.id;
    v_abandoned := v_abandoned + 1;
  END LOOP;

  abandoned := v_abandoned;
  completed := v_completed;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_abandoned_uploads(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_abandoned_uploads(UUID) TO service_role;

COMMENT ON FUNCTION public.sweep_abandoned_uploads(UUID) IS
  'Track C / 0073 (TPN-CONT-017): close every expired, unreleased upload '
  'reservation — as ''completed'' when its object landed, otherwise as '
  '''abandoned'' with one file_events ''upload_abandoned'' row per reservation. '
  'Certifies that the upload never completed; the partial itself is reaped by '
  'Supabase''s 24 h TUS expiry, which SQL cannot see. Destroys nothing. '
  'service_role only: storage-gc calls it per workspace on every cleanup, '
  'pg_cron hourly across all workspaces as wilson-sweep-abandoned-uploads.';

-- Hourly, so a reservation that expired at 15:00 is certified by 15:39 rather
-- than at the next nightly slot. Guarded like 0012/0014/0057: the CI local
-- stack ships without pg_cron and a scheduling hiccup must never fail the
-- migration. cron.schedule() upserts by job name, so a re-run is idempotent.
-- (0058 unscheduled 0057's nightly job under its OLD name; this is a new one.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule(
      'wilson-sweep-abandoned-uploads',
      '39 * * * *',
      $job$ SELECT * FROM public.sweep_abandoned_uploads(); $job$
    );
  ELSE
    RAISE NOTICE 'pg_cron unavailable — abandoned-upload sweep not scheduled (expected in CI local stack)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'could not schedule abandoned-upload sweep via pg_cron: %', SQLERRM;
END $$;

-- ── 9. Post-conditions ──────────────────────────────────────────────────────

DO $$
DECLARE
  n      INT;
  v_lim  BIGINT;
  v_free BIGINT;
  v_rls  RECORD;
BEGIN
  -- 1. The table: RLS enabled AND forced, exactly one policy and it is SELECT,
  --    zero write policies, nothing held by anon or PUBLIC, authenticated
  --    holds SELECT and nothing else.
  SELECT relrowsecurity, relforcerowsecurity INTO v_rls
    FROM pg_class WHERE oid = 'public.upload_reservations'::regclass;
  IF NOT (v_rls.relrowsecurity AND v_rls.relforcerowsecurity) THEN
    RAISE EXCEPTION '0073 post-condition failed: upload_reservations lacks ENABLE+FORCE RLS';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'upload_reservations';
  IF n <> 1 THEN
    RAISE EXCEPTION '0073 post-condition failed: upload_reservations must have exactly 1 policy, found %', n;
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'upload_reservations'
     AND cmd <> 'SELECT';
  IF n <> 0 THEN
    RAISE EXCEPTION '0073 post-condition failed: % write policies on upload_reservations; writes go through the RPCs only', n;
  END IF;

  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'upload_reservations'
     AND grantee IN ('anon', 'PUBLIC');
  IF n <> 0 THEN
    RAISE EXCEPTION '0073 post-condition failed: anon or PUBLIC holds a privilege on upload_reservations';
  END IF;

  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'upload_reservations'
     AND grantee = 'authenticated' AND privilege_type <> 'SELECT';
  IF n <> 0 THEN
    RAISE EXCEPTION '0073 post-condition failed: authenticated holds a write privilege on upload_reservations';
  END IF;

  -- 2. Function privileges: the RPCs are callable by authenticated and not by
  --    anon; the aggregates and the sweep are service_role only.
  IF NOT has_function_privilege('authenticated', 'public.reserve_upload_bytes(text,bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.release_upload_reservation(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.reserve_upload_bytes(text,bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.release_upload_reservation(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '0073 post-condition failed: reserve/release privileges are wrong';
  END IF;

  IF has_function_privilege('authenticated', 'public.workspace_upload_reserved_bytes(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.workspace_upload_reserved_bytes(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.workspace_petal_committed_bytes(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.workspace_petal_bytes(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.workspace_petal_bytes(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.sweep_abandoned_uploads(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.sweep_abandoned_uploads(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0073 post-condition failed: an aggregate or the sweep is executable by a client role';
  END IF;

  -- 3. 🚨 NULL-SAFETY, BOTH ARMS. A NULL from either denies every first upload.
  IF public.workspace_upload_reserved_bytes('00000000-0000-0000-0000-0000000000ff', NULL)
     IS DISTINCT FROM 0::bigint THEN
    RAISE EXCEPTION '0073 post-condition failed: workspace_upload_reserved_bytes is not 0 for a workspace with no reservations — a NULL here refuses every upload';
  END IF;
  IF public.workspace_petal_bytes('00000000-0000-0000-0000-0000000000ff')
     IS DISTINCT FROM 0::bigint THEN
    RAISE EXCEPTION '0073 post-condition failed: workspace_petal_bytes is not 0 for an empty workspace';
  END IF;

  -- 4. The policy: present, RESTRICTIVE, INSERT, weighs the body AND passes the
  --    key to the 3-arg gate. This is the tripwire for a replay of 0058.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'petal_storage_quota_insert'
       AND permissive = 'RESTRICTIVE' AND cmd = 'INSERT'
       AND with_check LIKE '%rabbit_object_incoming_bytes(metadata), name)%'
  ) THEN
    RAISE EXCEPTION '0073 post-condition failed: the quota policy is missing, no longer RESTRICTIVE, or does not pass the object key to the 3-arg gate';
  END IF;

  -- ...and the meter's reservation arm is wired in (a replay of 0058 would
  -- silently drop it and report success).
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'workspace_petal_bytes'
       AND pg_get_functiondef(p.oid) LIKE '%workspace_upload_reserved_bytes%'
  ) THEN
    RAISE EXCEPTION '0073 post-condition failed: workspace_petal_bytes no longer adds the reservation arm — 0058 replayed after 0073?';
  END IF;

  -- 5. Three overloads of the gate, and the older two still callable by
  --    authenticated (0056 and 0057 post-conditions name them).
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'rabbit_petal_storage_ok';
  IF n <> 3 THEN
    RAISE EXCEPTION '0073 post-condition failed: % rabbit_petal_storage_ok overloads, expected 3', n;
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.rabbit_petal_storage_ok(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rabbit_petal_storage_ok(uuid,bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rabbit_petal_storage_ok(uuid,bigint,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rabbit_object_incoming_bytes(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '0073 post-condition failed: a policy predicate is not executable by authenticated — every upload would be refused';
  END IF;

  -- 6. Exactly ONE vocabulary constraint; it carries the new term and lost none
  --    of the old ones.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.file_events'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%uploaded%';
  IF n <> 1 THEN
    RAISE EXCEPTION '0073 post-condition failed: % vocabulary constraints on file_events, expected exactly 1', n;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'file_events_event_check'
       AND pg_get_constraintdef(oid) LIKE '%upload_abandoned%'
       AND pg_get_constraintdef(oid) LIKE '%downloaded%'
       AND pg_get_constraintdef(oid) LIKE '%purged%'
       AND pg_get_constraintdef(oid) LIKE '%relinked%'
  ) THEN
    RAISE EXCEPTION '0073 post-condition failed: the vocabulary is missing upload_abandoned or lost an existing value';
  END IF;

  -- 7. 🚨 NOTHING IN public REFERENCES storage.s3_multipart_uploads (0058's CI
  --    guard, kept: CI starts without storage-api). prokind = 'f' is required —
  --    pg_get_functiondef RAISES for aggregates.
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.prokind = 'f'
     AND pg_get_functiondef(p.oid) LIKE '%s3_multipart_uploads%';
  IF n <> 0 THEN
    RAISE EXCEPTION '0073 post-condition failed: % public function(s) reference storage.s3_multipart_uploads', n;
  END IF;

  -- 8. 0057's good half survives this file (the S44 lesson, restated from 0058).
  SELECT file_size_limit INTO v_lim FROM storage.buckets WHERE id = 'rabbit-files';
  IF v_lim IS DISTINCT FROM 53687091200::bigint THEN
    RAISE EXCEPTION '0073 post-condition failed: rabbit-files cap is %, expected 53687091200', v_lim;
  END IF;
  SELECT public.storage_free_tier_bytes() INTO v_free;
  IF v_free IS DISTINCT FROM 5368709120::bigint THEN
    RAISE EXCEPTION '0073 post-condition failed: free tier is %, expected 5368709120', v_free;
  END IF;

  -- 9. The neighbour counts 0053 and suite 63 pin: still exactly 8 rabbit_files%
  --    policies (this file adds none under that prefix).
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'rabbit_files%';
  IF n <> 8 THEN
    RAISE EXCEPTION '0073 post-condition failed: % policies named rabbit_files*, expected 8', n;
  END IF;

  -- 10. The schedule exists wherever pg_cron does, under the NEW name; the old
  --     0057 name stays gone.
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT count(*) INTO n FROM cron.job WHERE jobname = 'wilson-sweep-abandoned-uploads';
    IF n <> 1 THEN
      RAISE EXCEPTION '0073 post-condition failed: wilson-sweep-abandoned-uploads is not scheduled (found %)', n;
    END IF;
    SELECT count(*) INTO n FROM cron.job WHERE jobname = 'wilson-purge-abandoned-uploads';
    IF n <> 0 THEN
      RAISE EXCEPTION '0073 post-condition failed: 0057''s old sweep is scheduled again';
    END IF;
  END IF;

  -- 11. The withdrawn 0057 sweep stays withdrawn.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
              WHERE ns.nspname = 'public' AND p.proname = 'purge_abandoned_uploads') THEN
    RAISE EXCEPTION '0073 post-condition failed: purge_abandoned_uploads exists again';
  END IF;

  RAISE NOTICE '0073 post-conditions passed';
END $$;
