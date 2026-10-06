-- =============================================================================
-- 0017_notes.sql  (Session 8)
--
-- Per-user private Notes — the Dashboard's rich-text notes (TipTap + Yjs).
--
--   1. public.notes: owner-only rows. The body is a Yjs document snapshot
--      (base64 text in ydoc_state) plus a derived plain-text body_preview for
--      list rendering/search. `version` is an optimistic-concurrency counter:
--      the client saves with UPDATE ... WHERE version = expected; a 0-row
--      result means another device won the race — it then merges the remote
--      snapshot into its local Y.Doc (Yjs updates are commutative and
--      idempotent) and retries. That is the whole multi-device story: no Yjs
--      server, no realtime requirement, no clobber.
--   2. public.note_subjects: the user-defined options for the note subject
--      dropdown. Owner-only like notes.
--   3. Owner-only RLS on both tables — deliberately NO app-role bypass:
--      notes are private even from workspace admins. All four verbs require
--      workspace match AND owner_id = auth.uid().
--
-- Deliberate exclusions (documented in db/README.md §16):
--   * NOT captured by edit history (0012's entity CHECK stays locked to the
--     13 RABBIT tables — same precedent as project_members).
--   * NOT broadcast on any realtime topic (note content is private; the
--     0018 workspace channel carries projects/roster/task events only).
--   * Hard delete + client-side confirm in v1 (no deleted_at column). If
--     trash is wanted later, follow the 0014 RPC pattern — remember the
--     SELECT-policies-see-both-sides-of-UPDATE lesson.
--   * Yjs is used ONLY here (locked decision #6) — never for RABBIT entity
--     fields, which stay LWW-per-field.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── 1. notes ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL DEFAULT public.current_workspace_id()
                REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_id      UUID NOT NULL DEFAULT auth.uid(),
  title         TEXT NOT NULL DEFAULT '',
  subject       TEXT,
  note_date     DATE,
  -- Yjs snapshot (Y.encodeStateAsUpdate, base64). NULL = empty document.
  -- base64-in-text over bytea: supabase-js/PostgREST bytea needs \x-hex both
  -- directions and doubles payload size.
  ydoc_state    TEXT,
  -- Derived plain text for the notes list + search. The editor recomputes it
  -- on every save; it is never the source of truth.
  body_preview  TEXT NOT NULL DEFAULT '',
  -- Optimistic-concurrency counter for ydoc_state saves (see header).
  version       BIGINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,
  CONSTRAINT notes_title_len_chk    CHECK (char_length(title) <= 200),
  CONSTRAINT notes_subject_len_chk  CHECK (subject IS NULL OR char_length(subject) <= 80),
  CONSTRAINT notes_preview_len_chk  CHECK (char_length(body_preview) <= 500)
);

CREATE INDEX IF NOT EXISTS notes_owner_idx ON public.notes (workspace_id, owner_id);
CREATE INDEX IF NOT EXISTS notes_date_idx  ON public.notes (note_date);

DROP TRIGGER IF EXISTS trg_notes_audit ON public.notes;
CREATE TRIGGER trg_notes_audit
  BEFORE INSERT OR UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notes_select ON public.notes;
DROP POLICY IF EXISTS notes_insert ON public.notes;
DROP POLICY IF EXISTS notes_update ON public.notes;
DROP POLICY IF EXISTS notes_delete ON public.notes;

-- Owner-only on every verb. No app-role bypass on purpose: a workspace
-- admin cannot read another member's notes.
CREATE POLICY notes_select ON public.notes
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND owner_id = auth.uid()
  );

CREATE POLICY notes_insert ON public.notes
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND owner_id = auth.uid()
  );

-- WITH CHECK repeats owner_id = auth.uid() on the NEW row: an owner can
-- never re-point a note at someone else (or another workspace).
CREATE POLICY notes_update ON public.notes
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND owner_id = auth.uid()
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND owner_id = auth.uid()
  );

CREATE POLICY notes_delete ON public.notes
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND owner_id = auth.uid()
  );

COMMENT ON TABLE public.notes IS
  'Session 8: per-user private rich-text notes (TipTap + Yjs). ydoc_state is a base64 Yjs snapshot; version is the optimistic-concurrency counter for multi-device merge-on-conflict saves. Owner-only RLS, no admin bypass.';

-- ── 2. note_subjects ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.note_subjects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL DEFAULT public.current_workspace_id()
                REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_id      UUID NOT NULL DEFAULT auth.uid(),
  label         TEXT NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,
  CONSTRAINT note_subjects_label_len_chk CHECK (
    char_length(label) BETWEEN 1 AND 80
  )
);

-- One label per user (case-insensitive) — duplicate options are UI noise.
CREATE UNIQUE INDEX IF NOT EXISTS note_subjects_owner_label_uidx
  ON public.note_subjects (workspace_id, owner_id, lower(label));

DROP TRIGGER IF EXISTS trg_note_subjects_audit ON public.note_subjects;
CREATE TRIGGER trg_note_subjects_audit
  BEFORE INSERT OR UPDATE ON public.note_subjects
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();

ALTER TABLE public.note_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_subjects FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS note_subjects_select ON public.note_subjects;
DROP POLICY IF EXISTS note_subjects_insert ON public.note_subjects;
DROP POLICY IF EXISTS note_subjects_update ON public.note_subjects;
DROP POLICY IF EXISTS note_subjects_delete ON public.note_subjects;

CREATE POLICY note_subjects_select ON public.note_subjects
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND owner_id = auth.uid()
  );

CREATE POLICY note_subjects_insert ON public.note_subjects
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND owner_id = auth.uid()
  );

CREATE POLICY note_subjects_update ON public.note_subjects
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND owner_id = auth.uid()
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND owner_id = auth.uid()
  );

CREATE POLICY note_subjects_delete ON public.note_subjects
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND owner_id = auth.uid()
  );

COMMENT ON TABLE public.note_subjects IS
  'Session 8: user-defined subject options for the Notes subject dropdown. Owner-only RLS like notes.';

-- ── 3. Workspace FK for environments that created the tables before the
--       REFERENCES clause landed (review finding: every workspace-scoped
--       sibling cascades on workspace hard-delete; owner_id stays FK-less
--       per the 0007 convention). ─────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notes_workspace_id_fkey'
  ) THEN
    ALTER TABLE public.notes
      ADD CONSTRAINT notes_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'note_subjects_workspace_id_fkey'
  ) THEN
    ALTER TABLE public.note_subjects
      ADD CONSTRAINT note_subjects_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 4. RLS post-conditions ──────────────────────────────────────────────────

DO $$
DECLARE
  t TEXT;
  has_rls BOOLEAN;
  is_forced BOOLEAN;
BEGIN
  FOREACH t IN ARRAY ARRAY['notes', 'note_subjects']
  LOOP
    EXECUTE format(
      'SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = %L::regclass',
      'public.' || t)
      INTO has_rls, is_forced;
    IF NOT has_rls OR NOT is_forced THEN
      RAISE EXCEPTION 'RLS post-condition failed for %: rowsecurity=%, force=%',
        t, has_rls, is_forced;
    END IF;
  END LOOP;
END $$;
