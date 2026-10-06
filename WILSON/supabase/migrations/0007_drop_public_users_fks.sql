-- =============================================================================
-- 0007_drop_public_users_fks.sql
--
-- The RABBIT base schema (0000) created a standalone `public.users` table
-- from the pre-cloud single-user days, and put foreign keys on three
-- columns targeting it:
--
--   projects.created_by       -> public.users(id)
--   tasks.assigned_user_id    -> public.users(id)
--   comments.author_user_id   -> public.users(id)
--
-- In the multi-user world, `auth.users` is the source of truth for user
-- identities. fn_audit_touch (migration 0001) sets NEW.created_by := auth.uid()
-- on every INSERT, which writes an auth.users.id into projects.created_by.
-- The FK check then fails because that id is not in public.users.
--
-- Dropping the three FKs. created_by / assigned_user_id / author_user_id
-- stay as nullable UUIDs — the application joins to auth.users (or the
-- workspace_members table) when it needs the user record. A formal
-- team-members view lands in Session 4.
--
-- public.users itself is NOT dropped here because:
--   (a) it's harmlessly empty on every environment we've touched
--   (b) any existing standalone RABBIT install might still rely on it
-- If/when standalone RABBIT is retired, a follow-up migration can drop it.
-- =============================================================================

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_created_by_fkey;
ALTER TABLE public.tasks    DROP CONSTRAINT IF EXISTS tasks_assigned_user_id_fkey;
ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_author_user_id_fkey;
