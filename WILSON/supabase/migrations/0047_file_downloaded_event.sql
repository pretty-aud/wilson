-- =============================================================================
-- 0047_file_downloaded_event.sql — Session 33 (network storage, Unit 1c)
--
-- Content had no READ event: file_events' vocabulary (0027) was
-- uploaded/moved/relinked/trashed/restored/purged, all writes. TPN-CONT-008 /
-- TPN-LOG-002 (both open HIGH) name the gap, and MPA CSBP AS-2.9 requires
-- logging every view and download with timestamp, user and source. The TPN
-- design review made this a condition of the shared-storage work's Phase 1:
-- once a storage root is shared, "who read this file" stops having one
-- plausible answer, and lifecycle vocabularies are never retrofitted after a
-- feature ships working (TPN-CONT-011).
--
-- Two things land here:
--
--   1. 'downloaded' joins the event CHECK. The constraint is dropped by
--      DISCOVERY (any CHECK on file_events whose definition mentions
--      'uploaded'), not only by name — the name was measured as
--      file_events_event_check on wilson-dev (2026-08-07), but a name-only
--      drop that misses would leave TWO vocabulary constraints and the old
--      one would still refuse 'downloaded'; the post-condition asserts
--      exactly one survives, containing 'downloaded'.
--
--   2. public.log_file_downloaded(p_file_id) — a SECURITY DEFINER RPC, the
--      cloud write path for the new event. It is an RPC and NOT an INSERT
--      policy for two reasons:
--        - file_events stays append-only exactly as 0027 built it: client
--          INSERT stays revoked, zero write policies. 0027's own
--          post-condition asserts "exactly 1 policy" — an INSERT policy here
--          would make any future 0027 re-run fail, a new ordering trap.
--        - The function, not the client, decides the event value — nobody
--          can forge a 'purged' certificate through the download logger.
--      Its permission checks are EXPLICIT (workspace match + active
--      membership + live project + the 0038 money arm), NOT
--      can_read_project_topic: that helper is SECURITY INVOKER by design,
--      so inside a DEFINER function its EXISTS would run as table owner
--      and check nothing. The checks replicate what files_select actually
--      requires of a reader: projects_select's terms (0020 — deleted_at IS
--      NULL + workspace = current_workspace_id() + has_active_membership,
--      0008, itself DEFINER-safe: it reads auth.uid(), not RLS) PLUS
--      0038's is_financial gate — the first draft replicated only
--      projects_select, and the adversarial review measured the
--      consequence: a plain member could log "downloads" of invoices
--      files_select hides from them.
--      A TRASHED file still logs: the blob stays readable while the row
--      sits in trash, and a read of trashed content is exactly what an
--      auditor wants recorded. A purged file refuses — there is nothing to
--      snapshot and nothing to read.
--      Unlike fn_file_events_capture, this function does NOT swallow errors:
--      the 0027 idiom protects the write being audited, and here there is no
--      such write — the RPC IS the audit. The CALLER (supabaseAdapter.js
--      downloadFile) best-efforts it so a logging hiccup cannot take the
--      read down with it.
--
-- The Local Server twin needs no migration: the Express download route
-- appends the same event to bundle.fileEvents (electron/main.cjs, S33).
--
-- Ordering: none new. 0027 re-run is safe on both sides: CREATE TABLE IF NOT
-- EXISTS cannot resurrect the six-value CHECK, and this file adds no policy
-- 0027's post-conditions would count. 0011 re-run remains governed by
-- 0011 → 0033; its blanket function GRANT would hand anon EXECUTE here, but
-- the auth.uid() IS NULL refusal keeps even that inert.
--
-- Idempotent: safe to re-run (discovery-drop + re-add; CREATE OR REPLACE).
-- pgTAP: 33_file_lifecycle.sql (extended, plan 26 → 38). Probe 24 exists
-- because breaker B measured that WITHOUT it, deleting the workspace check
-- from this RPC leaves every probe green — a plain other-workspace caller
-- is refused by the membership check alone; only a dual-workspace member
-- signed into the other workspace tells the two checks apart.
-- =============================================================================

-- ── 1. 'downloaded' joins the event vocabulary ───────────────────────────────

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.file_events'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%uploaded%'
  LOOP
    EXECUTE format('ALTER TABLE public.file_events DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.file_events
  ADD CONSTRAINT file_events_event_check CHECK (event IN
    ('uploaded', 'downloaded', 'moved', 'relinked', 'trashed', 'restored', 'purged'));

-- ── 2. the download logger ───────────────────────────────────────────────────

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
     event, old_path, size_bytes, actor_user_id, actor_label)
  VALUES
    (v_file.workspace_id, v_file.project_id, v_file.id, v_file.name,
     v_file.storage_provider::text, 'downloaded', v_file.storage_path,
     v_file.size_bytes, v_actor, v_label);

  RETURN true;
END;
$$;

-- The REVOKE is the load-bearing statement here; the GRANT is belt and
-- braces. MEASURED on wilson-dev (2026-08-07, breaker A + pg_default_acl):
-- functions created by postgres in public get authenticated=X from the
-- 0033-disarmed default ACL (anon deliberately absent from it), so a
-- missing GRANT changes nothing on a healthy env — but the default ACL is
-- per-env state, not something this migration controls, so both statements
-- stay. The grantee lesson (0033) still applies to the REVOKE: an
-- anon-only revoke can be a silent no-op when the aclitem names PUBLIC.
REVOKE EXECUTE ON FUNCTION public.log_file_downloaded(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.log_file_downloaded(UUID) TO authenticated;

-- ── 3. Post-conditions ───────────────────────────────────────────────────────

DO $$
DECLARE
  n INT;
BEGIN
  -- Exactly ONE event-vocabulary constraint, and it admits 'downloaded'.
  -- Two would mean the discovery-drop missed one and the old CHECK still
  -- refuses the new event while this migration reports success.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.file_events'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%uploaded%';
  IF n <> 1 THEN
    RAISE EXCEPTION '0047 post-condition failed: expected exactly 1 event vocabulary constraint, found %', n;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.file_events'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%downloaded%'
  ) THEN
    RAISE EXCEPTION '0047 post-condition failed: event constraint does not admit downloaded';
  END IF;

  -- The RPC exists, authenticated can call it, anon and PUBLIC cannot.
  IF to_regprocedure('public.log_file_downloaded(uuid)') IS NULL THEN
    RAISE EXCEPTION '0047 post-condition failed: log_file_downloaded missing';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.log_file_downloaded(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0047 post-condition failed: authenticated cannot execute log_file_downloaded';
  END IF;
  IF has_function_privilege('anon', 'public.log_file_downloaded(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0047 post-condition failed: anon can execute log_file_downloaded';
  END IF;

  -- file_events stays append-only: RLS on, still zero client write policies
  -- (the 0027 invariant this migration must not have loosened).
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'file_events' AND relrowsecurity
  ) THEN
    RAISE EXCEPTION '0047 post-condition failed: file_events RLS not enabled';
  END IF;
  -- 'ALL' included: a FOR ALL policy carries write arms too, and a cmd
  -- list without it would wave one through (adversarial review, S33 —
  -- 0027's own post-condition has this blind spot).
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'file_events'
       AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION '0047 post-condition failed: file_events must stay append-only';
  END IF;
END $$;

COMMENT ON FUNCTION public.log_file_downloaded(UUID) IS
  'S33 (TPN-CONT-008/TPN-LOG-002, AS-2.9): appends a downloaded event to file_events for a file the caller can read (explicit workspace + membership + live-project + 0038 money-arm checks; DEFINER so the table stays append-only). Called best-effort by supabaseAdapter.downloadFile; the Local Server twin logs bundle-side in the Express download route.';
