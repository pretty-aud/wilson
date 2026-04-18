-- =============================================================================
-- 0001_workspaces_and_users.sql
-- Session 1 — foundation tables for multi-tenancy and admin tiers.
-- Idempotent: uses IF NOT EXISTS / CREATE OR REPLACE throughout so this file
-- can be re-run safely against a fresh project or a partially-migrated one.
-- =============================================================================

-- Required extensions.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- workspaces (companies / studios). One row per tenant.
-- storage_mode drives the hybrid storage decision: 'central' keeps everything
-- in Supabase Storage; 'byos' offloads artwork/masters/exports to the tenant's
-- own bucket (config shape validated in Session 9).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspaces (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  slug         TEXT UNIQUE NOT NULL
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  storage_mode TEXT NOT NULL DEFAULT 'central'
    CHECK (storage_mode IN ('central', 'byos')),
  storage_config JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID,
  deleted_at   TIMESTAMPTZ,
  deleted_by   UUID
);

CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON public.workspaces (slug)
  WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- workspace_members: join between auth.users and workspaces, with per-tenant
-- username (scoped to workspace; the platform does not require globally-unique
-- usernames) and app-level role.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspace_members (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_role     TEXT NOT NULL
    CHECK (app_role IN ('admin', 'manager', 'user')),
  username     TEXT NOT NULL
    CHECK (username ~ '^[a-z0-9][a-z0-9._-]{1,31}$'),
  display_name TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  UNIQUE (workspace_id, username)
);

-- Fast lookup by user (for "which workspaces can I see").
CREATE INDEX IF NOT EXISTS idx_ws_members_user
  ON public.workspace_members (user_id)
  WHERE is_active;

-- Fast lookup by username within a workspace (used by resolve-login).
CREATE INDEX IF NOT EXISTS idx_ws_members_username
  ON public.workspace_members (workspace_id, lower(username))
  WHERE is_active;

-- -----------------------------------------------------------------------------
-- platform_operators: super-admins who see every workspace. Only used by the
-- Platform Operator Console (Session 10). Kept intentionally small.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_operators (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by  UUID
);

-- -----------------------------------------------------------------------------
-- auth_attempt_log: lightweight audit trail for resolve-login. Populated by
-- the Edge Function; readable only by platform_operators (RLS in 0002).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auth_attempt_log (
  id             BIGSERIAL PRIMARY KEY,
  workspace_id   UUID,
  username_tried TEXT,
  ip_address     INET,
  outcome        TEXT NOT NULL
    CHECK (outcome IN ('resolved', 'not_found', 'rate_limited', 'error')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_log_created_at
  ON public.auth_attempt_log (created_at DESC);

-- -----------------------------------------------------------------------------
-- Custom Access Token hook — bakes workspace context into the JWT at issuance.
-- Supabase Auth calls this on every access token mint. Shape is frozen by the
-- cross-session conventions in curried-cooking-unicorn.md.
--
-- Returns the event object (possibly with `claims` patched). Supabase merges
-- the returned claims into the issued JWT.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims          JSONB;
  user_id         UUID;
  active_ws       UUID;
  ws_ids          UUID[];
  active_role     TEXT;
  is_operator     BOOLEAN;
BEGIN
  claims := event->'claims';
  user_id := (event->>'user_id')::UUID;

  -- Collect all active workspace memberships.
  SELECT COALESCE(ARRAY_AGG(workspace_id ORDER BY created_at), ARRAY[]::UUID[])
    INTO ws_ids
    FROM public.workspace_members
   WHERE user_id = custom_access_token_hook.user_id
     AND is_active;

  -- Active workspace: prefer the value already on app_metadata (set when the
  -- user switches workspaces), otherwise the oldest membership, otherwise null.
  active_ws := NULLIF(claims->'app_metadata'->>'workspace_id', '')::UUID;
  IF active_ws IS NULL OR NOT (active_ws = ANY(ws_ids)) THEN
    active_ws := (SELECT ws_ids[1]);
  END IF;

  -- Role for the active workspace.
  SELECT app_role
    INTO active_role
    FROM public.workspace_members
   WHERE user_id = custom_access_token_hook.user_id
     AND workspace_id = active_ws
     AND is_active;

  -- Platform operator flag.
  SELECT EXISTS (
    SELECT 1 FROM public.platform_operators po
     WHERE po.user_id = custom_access_token_hook.user_id
  ) INTO is_operator;

  -- Patch app_metadata.
  claims := jsonb_set(
    claims,
    '{app_metadata}',
    COALESCE(claims->'app_metadata', '{}'::JSONB)
      || jsonb_build_object(
           'workspace_id',          active_ws,
           'workspace_ids',         to_jsonb(ws_ids),
           'app_role',              COALESCE(active_role, 'user'),
           'is_platform_operator',  COALESCE(is_operator, false)
         ),
    true
  );

  RETURN jsonb_set(event, '{claims}', claims, true);
END;
$$;

-- Supabase Auth needs to call this function. Grant as required by the
-- Custom Access Token hook setup (see Supabase docs).
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) FROM authenticated, anon, public;

-- -----------------------------------------------------------------------------
-- Audit trigger — generic, reused by every mutable table. Sets updated_at
-- and updated_by on every UPDATE, and created_by on INSERT when not present.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_audit_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
    IF NEW.updated_by IS NULL THEN NEW.updated_by := auth.uid(); END IF;
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := COALESCE(NEW.updated_at, now());
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

-- Attach audit trigger to workspaces.
DROP TRIGGER IF EXISTS trg_workspaces_audit ON public.workspaces;
CREATE TRIGGER trg_workspaces_audit
  BEFORE INSERT OR UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();

-- -----------------------------------------------------------------------------
-- Helper used by future RLS policies: gets the active workspace_id from the JWT.
-- STABLE so Postgres can cache within a statement. Returns NULL when the JWT
-- is missing the claim (e.g. during service_role calls from Edge Functions).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_workspace_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    COALESCE(
      current_setting('request.jwt.claims', true)::JSONB
        #>> '{app_metadata,workspace_id}',
      ''
    ),
    ''
  )::UUID;
$$;

COMMENT ON FUNCTION public.current_workspace_id IS
  'Returns the active workspace_id from the caller''s JWT app_metadata, or NULL.';
