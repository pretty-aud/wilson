-- =============================================================================
-- 0062_restore_grant_flag_guards.sql — 2026-08-12
--
-- 🚨 SECURITY FIX. 0059 SILENTLY DELETED TWO PRIVILEGE GUARDS, AND THE HOLE IS
-- LIVE ON EVERY ENVIRONMENT (0059 is applied to dev, staging and prod).
--
-- WHAT HAPPENED
--
-- 0020 gave fn_ws_members_prevent_self_role_change two clauses protecting the
-- rate-card grant flags:
--
--   * the SELF branch refused any change to grant_rate_card_view /
--     grant_rate_card_edit  -> 'self-grant change not allowed'
--   * the MANAGER denylist included both columns
--     -> 'managers may only edit title and department'
--
-- 0059 needed to add `is_full_time` to the same trigger. It did that by
-- rewriting the whole body with CREATE OR REPLACE — and the rewrite dropped
-- both grant clauses. Nothing about a CREATE OR REPLACE says which clauses the
-- previous body had, so the deletion was invisible in review: the diff reads as
-- "a new function", not "two protections removed".
--
-- THE CONSEQUENCE, on every environment since 0059:
--
--   * ANY member can grant THEMSELVES rate-card view AND edit. That is the
--     money gate — `grant_rate_card_edit` is what lets a user rewrite day
--     rates, which every budget in RABBIT is computed from.
--   * ANY manager can flip those flags for ANYONE.
--
-- Both are privilege escalation by a plain UPDATE against a table members are
-- already allowed to update (they may edit their own title and department).
--
-- WHY IT WENT UNNOTICED FOR A DAY
--
-- Suite 24 CAUGHT IT IMMEDIATELY — probes 11, 12 and 31 have been failing in CI
-- since the hour 0059 landed. Nobody could see it: the workflow step whose job
-- is explaining a pgTAP failure replayed the suites through psql WITHOUT -t -A,
-- so its `^not ok` grep could never match psql's padded output, and the raw log
-- needs repo-admin rights. Eighteen consecutive red runs, zero annotations.
-- Fixed separately in .github/workflows/rls.yml.
--
-- 🚨 THE RULE THIS COST: NEVER REWRITE A GUARD FUNCTION FROM SCRATCH TO ADD ONE
-- COLUMN. Read the deployed body first (pg_get_functiondef) and ADD to it, or
-- diff the new body against the old one clause by clause. A denylist trigger is
-- a security boundary, and CREATE OR REPLACE deletes silently.
--
-- Probe 31 is worth understanding too, because its name lies: it is
-- `ok(d.grant_rate_card_edit)`, which asserts the FLAG'S VALUE, not that the
-- column exists. It failed as a knock-on — probes 11 and 12 stopped throwing,
-- so their UPDATEs succeeded and set that member's flag to false inside the
-- test transaction. One cause, three red tests.
--
-- This migration restores both clauses and KEEPS everything 0059 added. It is
-- the union of the two bodies, not a revert: `is_full_time` stays protected in
-- both branches.
--
-- Idempotent: CREATE OR REPLACE of a function body, no DDL on tables, no data
-- change. Safe to apply twice and safe to apply to an environment that somehow
-- never got 0059.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_ws_members_prevent_self_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Workspace admins are trusted inside their own workspace, exactly as before.
  IF public.current_app_role() = 'admin'
     AND NEW.workspace_id = public.current_workspace_id() THEN
    RETURN NEW;
  END IF;

  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id = auth.uid() THEN
    IF NEW.app_role IS DISTINCT FROM OLD.app_role THEN
      RAISE EXCEPTION 'self-role change not allowed';
    END IF;
    IF NEW.username IS DISTINCT FROM OLD.username THEN
      RAISE EXCEPTION 'self-username change not allowed';
    END IF;
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
      RAISE EXCEPTION 'workspace move not allowed on self-update';
    END IF;
    -- Added by 0059. Kept.
    IF NEW.is_full_time IS DISTINCT FROM OLD.is_full_time THEN
      RAISE EXCEPTION 'self full-time change not allowed';
    END IF;
    IF NEW.is_active AND NOT OLD.is_active THEN
      RAISE EXCEPTION 'self-reactivation not allowed';
    END IF;
    -- 🚨 RESTORED (0020 -> lost in 0059). Without this a member grants
    -- themselves the money gate. Suite 24 probe 11.
    IF NEW.grant_rate_card_view IS DISTINCT FROM OLD.grant_rate_card_view
       OR NEW.grant_rate_card_edit IS DISTINCT FROM OLD.grant_rate_card_edit THEN
      RAISE EXCEPTION 'self-grant change not allowed';
    END IF;

  ELSIF public.current_app_role() = 'manager' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_members me
       WHERE me.workspace_id = NEW.workspace_id
         AND me.user_id = auth.uid()
         AND me.is_active
    ) THEN
      RAISE EXCEPTION 'inactive members may not edit the roster';
    END IF;
    -- A manager may edit ONLY title and department. Everything else on the row
    -- is on this denylist.
    --
    -- 🚨 THIS IS A DENYLIST: a column added to workspace_members is
    -- manager-editable until it appears here. `is_full_time` was added by 0059;
    -- the two grant columns are RESTORED here after 0059 dropped them.
    -- Suite 24 probe 12.
    IF NEW.app_role      IS DISTINCT FROM OLD.app_role
       OR NEW.username     IS DISTINCT FROM OLD.username
       OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       OR NEW.user_id      IS DISTINCT FROM OLD.user_id
       OR NEW.display_name IS DISTINCT FROM OLD.display_name
       OR NEW.pronouns     IS DISTINCT FROM OLD.pronouns
       OR NEW.avatar_url   IS DISTINCT FROM OLD.avatar_url
       OR NEW.onboarded_at IS DISTINCT FROM OLD.onboarded_at
       OR NEW.is_active    IS DISTINCT FROM OLD.is_active
       OR NEW.is_full_time IS DISTINCT FROM OLD.is_full_time
       OR NEW.created_at   IS DISTINCT FROM OLD.created_at
       OR NEW.grant_rate_card_view IS DISTINCT FROM OLD.grant_rate_card_view
       OR NEW.grant_rate_card_edit IS DISTINCT FROM OLD.grant_rate_card_edit THEN
      RAISE EXCEPTION 'managers may only edit title and department';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
