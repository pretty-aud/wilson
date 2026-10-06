-- =============================================================================
-- 0048_workspace_storage.sql — Session 34 (the storage root)
--
-- WHY THIS EXISTS
-- ---------------
-- Two measured facts (NETWORK_STORAGE_DESIGN.md §3.1):
--   * The RABBIT storage root lives in {userData}/rabbit-data/files-config.json
--     — PER MACHINE. A second computer has never written that file and sees
--     nothing.
--   * Audrey's saved value is a LOCAL DISK path. Carried to another computer it
--     resolves against that machine's identically-named folder — pointing at
--     the wrong content rather than sharing it.
-- The target: a company points WILSON at their NAS (\\nas\projects) ONCE, and
-- every computer in the office resolves the same share (§4c). That needs the
-- root to live with the WORKSPACE, i.e. here.
--
-- WHO MAY WRITE IT — Audrey, 2026-08-05, verbatim in substance:
--   "admins can set server/drive... the admins can set the drive in the admin
--    terminal. the managers set the project folder in the drive in the project
--    control panel."
-- So: members SELECT (every desktop must resolve the root); ADMIN-ONLY writes,
-- mirroring workspaces_admin_update's exact shape (0020:438-449). The manager
-- half (projects.folder_root containment) is Session 35.
--
-- 🚨 WHY A NEW TABLE AND NOT workspaces.storage_mode / storage_config
-- -------------------------------------------------------------------
-- Those columns (0001:29-30) were designed for exactly this and have ZERO
-- readers anywhere — but they are admin-WRITABLE today via
-- workspaces_admin_update, because fn_workspaces_client_guard protects only
-- slug/id/created_at/deleted_at. A future reader would inherit values written
-- before any validation existed (TPN-CLOUD-007: "live-wire dead"). This
-- migration (a) starts from a table whose rows can only ever have been written
-- by validated code, and (b) closes the live wire by teaching the guard to
-- refuse client writes to both legacy columns. The operator view (0028:236,257)
-- keeps reading a column that can no longer drift.
--
-- CANONICAL FORM (§3.2 / §3.3, both measured)
-- -------------------------------------------
--   * root_path carries NO trailing separator — path.resolve() gives a bare
--     root a trailing sep and every deeper path none, and the pre-S33 guard
--     refused every file under a root configured with one. The client
--     canonicalises; the CHECK makes drift impossible.
--   * root_kind is 'unc' | 'local'. Mapped drive letters are REFUSED by the
--     client before save (Z: names a different folder on every machine) and
--     have no kind here on purpose: a row that says 'mapped' would be a row
--     that should not exist.
--   * mode is 'central' (Petal cloud) | 'byos' (their own server/NAS) — the
--     vocabulary 0001 declared and never built (§5b). A 'byos' workspace may
--     carry root_path NULL while the admin is mid-setup; a root, when present,
--     survives a switch back to 'central' so re-enabling does not mean
--     retyping.
--
-- Idempotent: safe to re-run.
-- ORDERING: depends on 0001 (workspaces, fn_audit_touch), 0008/0020 (policy
--   helpers), 0020 (fn_workspaces_client_guard baseline). 🚨 A manual re-run of
--   0020 recreates fn_workspaces_client_guard WITHOUT the storage arms added
--   here — if 0020 is ever replayed, replay THIS file after it (same trap
--   shape as 0027 → 0038 and 0002 → 0029).
-- pgTAP: 58_workspace_storage.sql (new).
-- =============================================================================

-- ── 1. The table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.workspace_storage (
  workspace_id  UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL DEFAULT 'central',
  root_path     TEXT,
  root_kind     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,
  CONSTRAINT workspace_storage_mode_chk
    CHECK (mode IN ('central','byos')),
  CONSTRAINT workspace_storage_kind_chk
    CHECK (root_kind IS NULL OR root_kind IN ('unc','local')),
  -- A path travels with its kind: one without the other is a half-written
  -- config no resolver can act on safely.
  CONSTRAINT workspace_storage_root_pair_chk
    CHECK ((root_path IS NULL) = (root_kind IS NULL)),
  -- §3.2: canonical form has no trailing separator, no surrounding
  -- whitespace, and '' is not a path.
  CONSTRAINT workspace_storage_root_canon_chk
    CHECK (root_path IS NULL OR (root_path <> ''
           AND root_path = btrim(root_path)
           AND root_path !~ '[\\/]$')),
  -- The kind must match the path's actual shape: a row claiming 'unc' over
  -- C:\Projects (or 'local' over \\nas\projects) would make every consumer
  -- of root_kind — the §3.1 apply-only-where-it-exists rule included —
  -- reason from a lie (S34 review).
  CONSTRAINT workspace_storage_kind_shape_chk
    CHECK (root_path IS NULL OR ((root_kind = 'unc') = (left(root_path, 2) = '\\')))
);

COMMENT ON TABLE public.workspace_storage IS
  'Session 34: the workspace-wide storage root (NETWORK_STORAGE_DESIGN.md §5). One row per workspace. Members read (every desktop resolves the root); admins write (Audrey 2026-08-05: "admins can set server/drive"). Supersedes the never-read workspaces.storage_mode/storage_config, which fn_workspaces_client_guard now refuses.';
COMMENT ON COLUMN public.workspace_storage.root_path IS
  'Canonical UNC (\\server\share\folder) or local absolute path. NO trailing separator (0048 CHECK; §3.2 measured why). Mapped drive letters are refused before save and never stored.';
COMMENT ON COLUMN public.workspace_storage.mode IS
  '''central'' = Petal cloud storage, ''byos'' = the customer''s own server/NAS (§5b). A root_path may persist while mode is central so switching back does not mean retyping.';

-- ── 2. Audit stamping ────────────────────────────────────────────────────────
-- fn_audit_touch (0001) — the workspace-table pattern (0013's project_members),
-- NOT 0046's touch_updated_at, which exists for per-user tables where
-- created_by could only ever repeat the primary key. It is LANGUAGE plpgsql and
-- NOT SECURITY DEFINER — the precondition for FORCE ROW LEVEL SECURITY
-- (0031:142-143).

DROP TRIGGER IF EXISTS trg_workspace_storage_audit ON public.workspace_storage;
CREATE TRIGGER trg_workspace_storage_audit
  BEFORE INSERT OR UPDATE ON public.workspace_storage
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();

-- ── 3. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.workspace_storage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_storage FORCE  ROW LEVEL SECURITY;

-- One policy per verb, never FOR ALL (0029: a broad FOR ALL arm ORs with every
-- narrow arm beside it and silently wins).

-- Members read: every signed-in desktop has to resolve the root, and the value
-- is not a secret from the team that uses it (contrast FINANCE/RATES.json).
DROP POLICY IF EXISTS workspace_storage_select ON public.workspace_storage;
CREATE POLICY workspace_storage_select ON public.workspace_storage
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

-- Admin-only writes — the exact workspaces_admin_update shape (0020:438-449):
-- claim-bound workspace + claim-bound role + LIVE membership row. All three
-- arms are load-bearing and suite 58 pins each with a caller that passes the
-- other two (the S33 lesson: a refusal probe pins ONE check only if every
-- other check waves its caller through).
DROP POLICY IF EXISTS workspace_storage_insert ON public.workspace_storage;
CREATE POLICY workspace_storage_insert ON public.workspace_storage
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() = 'admin'
    AND public.has_active_membership(workspace_id)
  );

DROP POLICY IF EXISTS workspace_storage_update ON public.workspace_storage;
CREATE POLICY workspace_storage_update ON public.workspace_storage
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() = 'admin'
    AND public.has_active_membership(workspace_id)
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() = 'admin'
    AND public.has_active_membership(workspace_id)
  );

DROP POLICY IF EXISTS workspace_storage_delete ON public.workspace_storage;
CREATE POLICY workspace_storage_delete ON public.workspace_storage
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() = 'admin'
    AND public.has_active_membership(workspace_id)
  );

-- ── 4. Privileges ────────────────────────────────────────────────────────────
-- PUBLIC named alongside anon: an object can carry a bare =X/postgres aclitem,
-- and a REVOKE that names only anon is then a silent no-op (S22).

REVOKE ALL ON public.workspace_storage FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_storage TO authenticated;
GRANT ALL ON public.workspace_storage TO service_role;

-- ── 5. Close the legacy live wire ────────────────────────────────────────────
-- workspaces.storage_mode / storage_config: zero readers, admin-writable today
-- (§3.4). Reproduces 0020:452-470 verbatim and adds the two storage arms.
-- IS DISTINCT FROM throughout — this is procedural SQL, where a NULL
-- comparison silently skips the refusal instead of enforcing it (the 0047
-- lesson: a policy predicate moved into an IF flips its failure direction).

CREATE OR REPLACE FUNCTION public.fn_workspaces_client_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'workspace slug is immutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'workspace column is not client-editable';
  END IF;
  -- Session 34: the legacy storage columns are frozen against client writes.
  -- Nothing reads them (measured, §3.4); the live store is workspace_storage.
  -- ⚠️ These dereferences bind this guard to the columns' EXISTENCE: if
  -- storage_mode/storage_config are ever DROPPED, the same migration must
  -- CREATE OR REPLACE this guard without these arms, or every client UPDATE
  -- of workspaces raises 'record "new" has no field' (plpgsql resolves
  -- record fields at execution).
  IF NEW.storage_mode IS DISTINCT FROM OLD.storage_mode
     OR NEW.storage_config IS DISTINCT FROM OLD.storage_config THEN
    RAISE EXCEPTION 'workspace storage settings are not client-editable — the live store is workspace_storage (0048)';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_workspaces_client_guard() FROM PUBLIC, anon, authenticated;

-- The trigger attachment (0020:474-478) survives CREATE OR REPLACE; re-assert
-- anyway so this file alone leaves the guard wired even on a fresh database.
DROP TRIGGER IF EXISTS trg_workspaces_client_guard ON public.workspaces;
CREATE TRIGGER trg_workspaces_client_guard
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_workspaces_client_guard();

-- ── 6. Post-conditions ───────────────────────────────────────────────────────
-- The only check in this change that runs against dev, staging AND prod.

DO $post$
DECLARE
  v_count INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.workspace_storage'::regclass
       AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION '0048 post-condition failed: workspace_storage RLS not enabled+forced';
  END IF;

  SELECT count(*) INTO v_count FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'workspace_storage';
  IF v_count <> 4 THEN
    RAISE EXCEPTION '0048 post-condition failed: expected 4 policies, found %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'workspace_storage' AND cmd = 'ALL';
  IF v_count <> 0 THEN
    RAISE EXCEPTION '0048 post-condition failed: a FOR ALL policy arm exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'workspace_storage'
       AND grantee IN ('anon', 'PUBLIC')
  ) THEN
    RAISE EXCEPTION '0048 post-condition failed: anon/PUBLIC hold privileges on workspace_storage';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_workspace_storage_audit'
       AND tgrelid = 'public.workspace_storage'::regclass
  ) THEN
    RAISE EXCEPTION '0048 post-condition failed: audit trigger missing';
  END IF;

  -- The guard must carry BOTH storage arms — a 0020 replay would strip them
  -- and report success (see ORDERING).
  IF position('storage_mode' IN pg_get_functiondef('public.fn_workspaces_client_guard()'::regprocedure)) = 0
     OR position('storage_config' IN pg_get_functiondef('public.fn_workspaces_client_guard()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0048 post-condition failed: fn_workspaces_client_guard lacks the storage arms (0020 replayed after 0048?)';
  END IF;

  SELECT count(*) INTO v_count FROM pg_constraint
   WHERE conrelid = 'public.workspace_storage'::regclass
     AND contype = 'c';
  IF v_count < 5 THEN
    RAISE EXCEPTION '0048 post-condition failed: expected 5 CHECK constraints, found %', v_count;
  END IF;
END
$post$;
