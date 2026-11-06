-- =============================================================================
-- 0027_file_lifecycle.sql — Session 14 (file lifecycle & data stewardship)
--
-- Three things land here, all in service of "what happens to files and data
-- over time" (MASTER_PLAN §5 S14; TPN_AUDIT remediation for TPN-CONT-002
-- "files are created, overwritten, and deleted with no lifecycle states, no
-- proof-of-deletion" and TPN-LOG-004 "no stated retention"):
--
--   1. public.file_events — an append-only per-file lifecycle stream
--      (uploaded / moved / relinked / trashed / restored / purged), written
--      ONLY by DB triggers on public.files, readable by anyone who can read
--      the file's project (plus a workspace-admin arm so proof-of-deletion
--      stays readable after the project itself is purged). This is the
--      "who touched this file, when" data the Block C audit view renders,
--      and the 'purged' rows are the deletion certificates TPN-CONT-002
--      asks for. RETENTION (TPN-LOG-004): deliberately NO purge job —
--      audit logs must be kept ≥ 1 year; rows are tiny. Revisit at the
--      S15 TPN re-audit before v1.0.0.
--
--   2. The 'rabbit-files' storage bucket + path-scoped policies — the
--      Block D decision (Session 14, 2026-07-30): CREATE it. Rationale:
--      locked #14 names Supabase Storage a v1.0 project-file provider;
--      supabaseAdapter.uploadFile/downloadFile have been written against
--      this bucket since S1; the S2 migration tool already rewrites
--      migrated file rows to storage_provider='supabase' pointing INTO it;
--      and creating it is what unlocks gap #31 (cloud project attachments
--      have no home on either host). Dropping Supabase Storage instead
--      would have stranded all three. PRIVATE (unlike user-avatars: project
--      files are pre-release studio content — TPN), 50 MB object cap
--      (parity with the local Express 50mb JSON limit), any mime type.
--      Key layout (supabaseAdapter.js): projects/{project_id}/{entity}/{entity_id}/{ts}-{name}
--      so (storage.foldername(name))[2] is the project id and read/write
--      rides the SAME helpers as the files-table policies (0013/0014).
--      NOTE: can_write_project(NULL) is TRUE for members (unstaffed-open
--      arm) — the EXISTS-under-RLS projects probe in each policy is the
--      guard that makes a garbage path segment fail closed.
--
--   3. public.storage_gc_queue — Block E's durable work list. Hard-deleting
--      a files row (the 0014 purge, or a CASCADE) enqueues its supabase
--      blob for disposal; the storage-gc Edge Function (admin-invoked,
--      Session 14) drains the queue, deletes orphans, and stamps each row —
--      so blob disposal is deliberate, provider-aware, and leaves a
--      certificate trail (file_events 'purged' + app_events WIL-3003).
--      Service-role only; clients never see it.
--
-- Design notes:
--   - fn_file_events_capture follows fn_edit_history_capture (0012) exactly:
--     SECURITY DEFINER, catch-all EXCEPTION → RAISE WARNING (an audit
--     hiccup must never abort the write it audits — including workspace
--     CASCADE teardowns, where the FK insert fails and is swallowed).
--   - file_events.file_id / project_id carry NO FK: the 'purged' certificate
--     must survive the file row (and its project) disappearing. workspace_id
--     keeps the FK CASCADE (0012/0021 convention — tenant teardown sweeps).
--   - RLS is ENABLED but NOT forced (0012 idiom): the DEFINER trigger is the
--     only writer and needs to insert as table owner. No client write
--     policies exist; write privileges are also REVOKEd, belt and braces.
--   - The SELECT policy's project arm rides can_read_project_topic (0016,
--     SECURITY INVOKER ≡ projects_select). The admin arm follows the 0026
--     rationale: read-only listings may use the JWT role; every path that
--     ACTS stays live-row.
--   - 'relinked' is in the event vocabulary for parity with the local
--     (Electron/local_server) relink feature, which logs bundle-side events
--     with the same names. Cloud path changes emit 'moved' (no cloud relink
--     UI ships in S14 — matcher is provider-agnostic, per the brief).
--
-- Idempotent: safe to re-run. No ordering rule: this file only creates new
-- objects and new triggers on public.files — it overwrites nothing from any
-- earlier migration.
-- pgTAP: 33_file_lifecycle.sql (new).
-- =============================================================================

-- ── 1. file_events table + indexes ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.file_events (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id      UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- No FK on project_id/file_id: 'purged' rows are deletion certificates and
  -- must survive their subject (0012 entity_id / 0021 actor convention).
  project_id        UUID NOT NULL,
  file_id           UUID NOT NULL,
  -- Snapshots captured at write time so the trail stays readable after the
  -- file row is gone.
  file_name         TEXT,
  storage_provider  TEXT,
  event             TEXT NOT NULL CHECK (event IN
                      ('uploaded', 'moved', 'relinked', 'trashed', 'restored', 'purged')),
  old_path          TEXT,
  new_path          TEXT,
  size_bytes        BIGINT,
  -- No FK on actor (0007/0012 convention): NULL for system/service writes
  -- (the nightly purge), and rows survive the actor's auth row disappearing.
  actor_user_id     UUID,
  actor_label       TEXT,
  details           JSONB NOT NULL DEFAULT '{}'::jsonb
                      CHECK (char_length(details::text) <= 4000),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit-drawer query: newest-first stream for one file.
CREATE INDEX IF NOT EXISTS idx_file_events_file
  ON public.file_events (workspace_id, file_id, created_at DESC);

-- Per-project stream (missing-files banner, project-level audit).
CREATE INDEX IF NOT EXISTS idx_file_events_project
  ON public.file_events (workspace_id, project_id, created_at DESC);

-- ── 2. RLS + grants ──────────────────────────────────────────────────────────

ALTER TABLE public.file_events ENABLE ROW LEVEL SECURITY;
-- NOT forced (0012 idiom) — the DEFINER capture trigger is the only writer.
-- Do not add FORCE without giving the capture path an INSERT policy first.

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
  );
-- No INSERT/UPDATE/DELETE policies: with RLS enabled and no matching policy,
-- every client write is denied regardless of grants.

REVOKE ALL ON public.file_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.file_events FROM authenticated;
GRANT SELECT ON public.file_events TO authenticated;

-- ── 3. capture trigger ───────────────────────────────────────────────────────

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
       event, new_path, size_bytes, actor_user_id, actor_label)
    VALUES
      (NEW.workspace_id, NEW.project_id, NEW.id, NEW.name, NEW.storage_provider::text,
       'uploaded', NEW.storage_path, NEW.size_bytes, v_actor, v_label);

  ELSIF TG_OP = 'UPDATE' THEN
    -- Trash transitions and path changes are independent facts; an UPDATE
    -- carrying both emits both events.
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      INSERT INTO public.file_events
        (workspace_id, project_id, file_id, file_name, storage_provider,
         event, old_path, size_bytes, actor_user_id, actor_label)
      VALUES
        (NEW.workspace_id, NEW.project_id, NEW.id, NEW.name, NEW.storage_provider::text,
         'trashed', NEW.storage_path, NEW.size_bytes, v_actor, v_label);
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      INSERT INTO public.file_events
        (workspace_id, project_id, file_id, file_name, storage_provider,
         event, new_path, size_bytes, actor_user_id, actor_label)
      VALUES
        (NEW.workspace_id, NEW.project_id, NEW.id, NEW.name, NEW.storage_provider::text,
         'restored', NEW.storage_path, NEW.size_bytes, v_actor, v_label);
    END IF;

    IF OLD.storage_path IS DISTINCT FROM NEW.storage_path THEN
      INSERT INTO public.file_events
        (workspace_id, project_id, file_id, file_name, storage_provider,
         event, old_path, new_path, size_bytes, actor_user_id, actor_label)
      VALUES
        (NEW.workspace_id, NEW.project_id, NEW.id, NEW.name, NEW.storage_provider::text,
         'moved', OLD.storage_path, NEW.storage_path, NEW.size_bytes, v_actor, v_label);
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    -- The deletion certificate (TPN-CONT-002): what was purged, from where,
    -- how big, by whom (NULL actor = the nightly purge / a cascade).
    INSERT INTO public.file_events
      (workspace_id, project_id, file_id, file_name, storage_provider,
       event, old_path, size_bytes, actor_user_id, actor_label, details)
    VALUES
      (OLD.workspace_id, OLD.project_id, OLD.id, OLD.name, OLD.storage_provider::text,
       'purged', OLD.storage_path, OLD.size_bytes, v_actor, v_label,
       -- left(): mime_type is unconstrained client-writable TEXT — an
       -- oversized value would trip the details CHECK inside this trigger,
       -- get swallowed by the handler below, and silently void the
       -- certificate (adversarial review, S14). Truncation keeps the
       -- certificate write infallible for client-reachable inputs.
       jsonb_build_object('mime_type', left(OLD.mime_type, 256), 'kind', OLD.kind::text,
                          'was_trashed', OLD.deleted_at IS NOT NULL));
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

DROP TRIGGER IF EXISTS trg_files_lifecycle ON public.files;
CREATE TRIGGER trg_files_lifecycle
  AFTER INSERT OR UPDATE OR DELETE ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.fn_file_events_capture();

-- ── 4. storage_gc_queue + enqueue trigger ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.storage_gc_queue (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket_id     TEXT NOT NULL,
  object_path   TEXT NOT NULL,
  workspace_id  UUID,
  file_id       UUID,
  reason        TEXT NOT NULL CHECK (reason IN ('file-purged', 'orphan-scan', 'avatar-orphan')),
  enqueued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
                  ('pending', 'deleted', 'missing', 'failed', 'skipped')),
  detail        TEXT
);

CREATE INDEX IF NOT EXISTS idx_storage_gc_pending
  ON public.storage_gc_queue (bucket_id, enqueued_at) WHERE status = 'pending';

-- Service-role only: RLS on with zero policies denies every client role;
-- privileges are also revoked. service_role has BYPASSRLS.
ALTER TABLE public.storage_gc_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storage_gc_queue FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_files_gc_enqueue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.storage_gc_queue (bucket_id, object_path, workspace_id, file_id, reason)
  VALUES ('rabbit-files', OLD.storage_path, OLD.workspace_id, OLD.id, 'file-purged');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- A failed enqueue orphans one blob; the Edge Function's orphan scan is
  -- the backstop for blobs whose PROJECT still resolves to a workspace.
  -- KNOWN LIMIT (S15): a full workspace hard-delete (operator console)
  -- leaves queue rows no admin can drain and certificates that CASCADE
  -- away — tenant teardown needs its own service-role storage sweep.
  RAISE WARNING 'storage_gc enqueue failed for file %: %', OLD.id, SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_files_gc_enqueue() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_files_gc_enqueue ON public.files;
CREATE TRIGGER trg_files_gc_enqueue
  AFTER DELETE ON public.files
  FOR EACH ROW
  WHEN (OLD.storage_provider = 'supabase')
  EXECUTE FUNCTION public.fn_files_gc_enqueue();

-- ── 5. rabbit-files bucket + storage policies ────────────────────────────────
-- PRIVATE bucket (project files are pre-release content); 50 MB cap; any mime.
-- ON CONFLICT DO UPDATE re-asserts the settings on re-run (0009 pattern).

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('rabbit-files', 'rabbit-files', false, 52428800)
ON CONFLICT (id) DO UPDATE
  SET public          = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;

-- Key layout: projects/{project_id}/{entity}/{entity_id}/{ts}-{filename}
-- (storage.foldername(name))[1] = 'projects', [2] = project_id.
-- The EXISTS probes run under the CALLER's RLS (policy expressions are
-- SECURITY INVOKER), so projects_select — workspace match + live row — IS
-- the read check, exactly like can_read_project_topic (0016). fn_try_uuid
-- (0016) makes a malformed segment NULL, the EXISTS fails, and the policy
-- fails CLOSED (can_write_project alone would fail OPEN on NULL — see header).

DROP POLICY IF EXISTS rabbit_files_select ON storage.objects;
CREATE POLICY rabbit_files_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = public.fn_try_uuid((storage.foldername(name))[2])
    )
  );

DROP POLICY IF EXISTS rabbit_files_insert ON storage.objects;
CREATE POLICY rabbit_files_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = public.fn_try_uuid((storage.foldername(name))[2])
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_write_project(public.fn_try_uuid((storage.foldername(name))[2]))
  );

-- Uploader-only DELETE: exists for exactly ONE flow — uploadFile removing
-- its own just-uploaded object when the files-row insert is refused. So it
-- carries every INSERT-side guard (an ex-member or demoted uploader may
-- not reach back in), and a ONE-HOUR freshness bound: without it, any past
-- uploader could destroy (or delete-then-replace) live project blobs
-- forever, unaudited — file_events triggers watch public.files, not the
-- bucket (adversarial review, S14). All other blob deletion is the GC
-- Edge Function (service_role, BYPASSRLS). No UPDATE policy: objects are
-- immutable (upsert:false in the adapter).
DROP POLICY IF EXISTS rabbit_files_delete_own ON storage.objects;
CREATE POLICY rabbit_files_delete_own ON storage.objects
  FOR DELETE USING (
    bucket_id = 'rabbit-files'
    AND owner_id = auth.uid()::text
    AND (storage.foldername(name))[1] = 'projects'
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = public.fn_try_uuid((storage.foldername(name))[2])
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_write_project(public.fn_try_uuid((storage.foldername(name))[2]))
    AND created_at > now() - interval '1 hour'
  );

-- ── 6. Post-conditions ───────────────────────────────────────────────────────

DO $$
DECLARE
  n INT;
BEGIN
  -- file_events: RLS on, exactly one SELECT policy, zero write policies.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'file_events' AND relrowsecurity
  ) THEN
    RAISE EXCEPTION '0027 post-condition failed: file_events RLS not enabled';
  END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'file_events';
  IF n <> 1 THEN
    RAISE EXCEPTION '0027 post-condition failed: file_events must have exactly 1 policy (select), found %', n;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'file_events'
       AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION '0027 post-condition failed: file_events must stay append-only (client writes denied)';
  END IF;

  -- storage_gc_queue: RLS on, zero policies (service_role only).
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'storage_gc_queue' AND relrowsecurity
  ) THEN
    RAISE EXCEPTION '0027 post-condition failed: storage_gc_queue RLS not enabled';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'storage_gc_queue'
  ) THEN
    RAISE EXCEPTION '0027 post-condition failed: storage_gc_queue must have no client policies';
  END IF;

  -- Triggers present on files.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_files_lifecycle'
       AND tgrelid = 'public.files'::regclass
  ) THEN
    RAISE EXCEPTION '0027 post-condition failed: trg_files_lifecycle missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_files_gc_enqueue'
       AND tgrelid = 'public.files'::regclass
  ) THEN
    RAISE EXCEPTION '0027 post-condition failed: trg_files_gc_enqueue missing';
  END IF;

  -- Bucket exists and is PRIVATE.
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'rabbit-files' AND public = false
  ) THEN
    RAISE EXCEPTION '0027 post-condition failed: rabbit-files bucket missing or public';
  END IF;

  -- The three storage policies exist.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('rabbit_files_select', 'rabbit_files_insert', 'rabbit_files_delete_own');
  IF n <> 3 THEN
    RAISE EXCEPTION '0027 post-condition failed: expected 3 rabbit-files storage policies, found %', n;
  END IF;

  -- Functions exist.
  IF to_regprocedure('public.fn_file_events_capture()') IS NULL
     OR to_regprocedure('public.fn_files_gc_enqueue()') IS NULL THEN
    RAISE EXCEPTION '0027 post-condition failed: capture/enqueue function missing';
  END IF;
END $$;

COMMENT ON TABLE public.file_events IS
  'Append-only per-file lifecycle stream (Session 14, TPN-CONT-002/TPN-LOG-004): uploaded/moved/relinked/trashed/restored/purged, written only by trg_files_lifecycle. Readable by project readers + workspace admins. purged rows are deletion certificates. NO purge job — audit retention >= 1 year, revisit at the S15 TPN re-audit.';
COMMENT ON TABLE public.storage_gc_queue IS
  'Durable blob-disposal work list (Session 14, Block E). Enqueued by trg_files_gc_enqueue when a supabase-provider files row hard-deletes; drained by the storage-gc Edge Function (admin-invoked), which stamps status + detail. service_role only.';
