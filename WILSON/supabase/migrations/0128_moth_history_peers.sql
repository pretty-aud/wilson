-- =============================================================================
-- 0128_moth_history_peers.sql — M.O.T.H. Session 3 (MO3): room in the record for Session 3's rows, checked later.
-- (docs/design/MOTH_DESIGN.md §2.5 H11 and SEC-09; docs/sessions/PLAN_MOTH.md §5 Session 3.)
--
-- 0119's moth_history records each change with an audience for each side: the project, its class (shared, private,
-- personal) and an owner. A workspace note and a company tag belong to no project, and a tag's assignment or a link
-- joins two things, each with its own audience. Before any of them is recorded (0129), the record needs:
--
--   §1  six nullable columns, the peer of each side (prior_peer_project_id, prior_peer_class, prior_peer_owner_id,
--       and the same for state): a side shows only when its own audience and its peer's both pass. Metadata only:
--       no default, no rewrite.
--   §2  the entity CHECK widened by the four tables 0129 records (notes, moth_tags, moth_tag_assignments,
--       moth_relationships); the class CHECK widened by 'workspace' (every active member's, with no project and no
--       owner); and a CHECK of the peers' shape. Each added NOT VALID: no scan here, so the lock is held for a moment;
--       0129 validates them while writes go on.
--
-- Every R.A.B.B.I.T. write appends to moth_history, so each ALTER waits behind an open writer and the writes behind
-- it: the lock_timeout below refuses rather than let them pile up. A refusal is safe; run it again. Nothing reads the
-- new columns until 0129. One transaction, re-runnable until 0129 validates the checks (after which a check's printed
-- definition no longer says NOT VALID, and this file refuses). Suite 121_moth_history.sql.
-- =============================================================================

SET LOCAL lock_timeout = '5s';

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
DECLARE
  v_b TEXT := (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                WHERE conrelid = 'public.moth_history'::regclass AND conname = 'moth_history_b_entity_chk');
  v_c TEXT := (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                WHERE conrelid = 'public.moth_history'::regclass AND conname = 'moth_history_c_class_chk');
  v_g TEXT := (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                WHERE conrelid = 'public.moth_history'::regclass AND conname = 'moth_history_g_peer_chk');
BEGIN
  IF to_regclass('public.moth_relationships') IS NULL OR to_regprocedure('public.note_trash_list()') IS NULL
     OR to_regclass('public.moth_tag_assignments') IS NULL THEN
    RAISE EXCEPTION '0128 refused: 0125 to 0127 must be applied first';
  END IF;
  -- The record's two checks as 0119 made them (their definitions' md5), or as this file leaves them, not yet
  -- validated (a second run).
  IF v_b IS NULL OR v_c IS NULL
     OR NOT (md5(v_b) = '5d4e89bf28ebdc9f00928c23cc8cb554'
          OR (position('moth_relationships' IN v_b) > 0 AND v_b LIKE '% NOT VALID'))
     OR NOT (md5(v_c) = '66ea9c046664bf6e9001dfa766a76b88'
             OR (position('workspace' IN v_c) > 0 AND v_c LIKE '% NOT VALID')) THEN
    RAISE EXCEPTION '0128 refused: moth_history''s entity or class check is not 0119''s, nor this file''s waiting to be validated';
  END IF;
  IF v_g IS NOT NULL AND NOT (position('prior_peer_class' IN v_g) > 0 AND v_g LIKE '% NOT VALID') THEN
    RAISE EXCEPTION '0128 refused: a moth_history_g_peer_chk is here that is not this file''s';
  END IF;
  -- A peer column already there is this file's, of its type, or the file is not to run.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'moth_history' AND column_name ~ '_peer_'
                AND (column_name NOT IN ('prior_peer_project_id', 'prior_peer_class', 'prior_peer_owner_id',
                                         'state_peer_project_id', 'state_peer_class', 'state_peer_owner_id')
                     OR data_type <> CASE WHEN column_name ~ 'class$' THEN 'text' ELSE 'uuid' END
                     OR column_default IS NOT NULL)) THEN
    RAISE EXCEPTION '0128 refused: a peer column is here that is not this file''s';
  END IF;
END $$;

-- §1 The peers ------------------------------------------------------------------
ALTER TABLE public.moth_history
  ADD COLUMN IF NOT EXISTS prior_peer_project_id uuid,
  ADD COLUMN IF NOT EXISTS prior_peer_class      text,
  ADD COLUMN IF NOT EXISTS prior_peer_owner_id   uuid,
  ADD COLUMN IF NOT EXISTS state_peer_project_id uuid,
  ADD COLUMN IF NOT EXISTS state_peer_class      text,
  ADD COLUMN IF NOT EXISTS state_peer_owner_id   uuid;

-- §2 The checks, NOT VALID: 0129 validates them ------------------------------------------------
ALTER TABLE public.moth_history DROP CONSTRAINT IF EXISTS moth_history_b_entity_chk;
ALTER TABLE public.moth_history ADD CONSTRAINT moth_history_b_entity_chk
  CHECK ((action = 'mark_recording' AND entity_type ~ '^[a-z_]{1,63}$')
         OR entity_type IN ('projects', 'phases', 'assets', 'tasks', 'files', 'folders', 'scenes', 'shots', 'levels',
                            'experiences', 'task_items', 'notes', 'moth_tags', 'moth_tag_assignments', 'moth_relationships'))
  NOT VALID;

ALTER TABLE public.moth_history DROP CONSTRAINT IF EXISTS moth_history_c_class_chk;
ALTER TABLE public.moth_history ADD CONSTRAINT moth_history_c_class_chk
  CHECK ((prior_class IS NULL OR prior_class IN ('shared', 'private', 'personal', 'workspace'))
         AND (state_class IS NULL OR state_class IN ('shared', 'private', 'personal', 'workspace'))
         AND (prior_class IS DISTINCT FROM 'personal' OR prior_owner_id IS NOT NULL)
         AND (state_class IS DISTINCT FROM 'personal' OR state_owner_id IS NOT NULL)
         AND (prior_class IS DISTINCT FROM 'shared' OR prior_owner_id IS NULL)
         AND (state_class IS DISTINCT FROM 'shared' OR state_owner_id IS NULL)
         AND (prior_class IS DISTINCT FROM 'workspace' OR (prior_owner_id IS NULL AND prior_project_id IS NULL))
         AND (state_class IS DISTINCT FROM 'workspace' OR (state_owner_id IS NULL AND state_project_id IS NULL)))
  NOT VALID;

-- A peer is a side's second audience: none at all, or one of the four, of the same shape as a side's; never on the
-- missing side of a create or a delete, nor on a mark but a failure's (it keeps the peers of the row that failed,
-- so the window tells that restart only to those the row was for).
ALTER TABLE public.moth_history DROP CONSTRAINT IF EXISTS moth_history_g_peer_chk;
ALTER TABLE public.moth_history ADD CONSTRAINT moth_history_g_peer_chk
  CHECK ((prior_peer_class IS NULL OR prior_peer_class IN ('shared', 'private', 'personal', 'workspace'))
         AND (state_peer_class IS NULL OR state_peer_class IN ('shared', 'private', 'personal', 'workspace'))
         AND (prior_peer_class IS NOT NULL OR (prior_peer_project_id IS NULL AND prior_peer_owner_id IS NULL))
         AND (state_peer_class IS NOT NULL OR (state_peer_project_id IS NULL AND state_peer_owner_id IS NULL))
         AND (prior_peer_class IS DISTINCT FROM 'personal' OR prior_peer_owner_id IS NOT NULL)
         AND (state_peer_class IS DISTINCT FROM 'personal' OR state_peer_owner_id IS NOT NULL)
         AND (prior_peer_class IS DISTINCT FROM 'shared' OR prior_peer_owner_id IS NULL)
         AND (state_peer_class IS DISTINCT FROM 'shared' OR state_peer_owner_id IS NULL)
         AND (prior_peer_class IS DISTINCT FROM 'workspace' OR (prior_peer_owner_id IS NULL AND prior_peer_project_id IS NULL))
         AND (state_peer_class IS DISTINCT FROM 'workspace' OR (state_peer_owner_id IS NULL AND state_peer_project_id IS NULL))
         AND (action <> 'create' OR prior_peer_class IS NULL)
         AND (action <> 'delete' OR state_peer_class IS NULL)
         AND (action <> 'mark_recording' OR mark_kind = 'capture_failed' OR (prior_peer_class IS NULL AND state_peer_class IS NULL)))
  NOT VALID;

COMMENT ON COLUMN public.moth_history.prior_peer_class IS
  '0128 (MO3): the prior side''s second audience (shared, private, personal or workspace), for a row that joins two things or belongs to no project (a tag''s assignment, a link). The side shows only when its own audience and this one both pass (0129''s moth_history_read).';
COMMENT ON COLUMN public.moth_history.state_peer_class IS
  '0128 (MO3): the state side''s second audience, as prior_peer_class.';

-- §3 Post-conditions --------------------------------------------------------------
DO $$
DECLARE
  v_b TEXT := (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                WHERE conrelid = 'public.moth_history'::regclass AND conname = 'moth_history_b_entity_chk');
  v_c TEXT := (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                WHERE conrelid = 'public.moth_history'::regclass AND conname = 'moth_history_c_class_chk');
  v_g TEXT := (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                WHERE conrelid = 'public.moth_history'::regclass AND conname = 'moth_history_g_peer_chk');
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'moth_history'
         AND column_name IN ('prior_peer_project_id', 'prior_peer_class', 'prior_peer_owner_id',
                             'state_peer_project_id', 'state_peer_class', 'state_peer_owner_id')
         AND is_nullable = 'YES' AND column_default IS NULL) <> 6 THEN
    RAISE EXCEPTION '0128 post-condition: the six peer columns are not this file''s';
  END IF;
  IF NOT (position('''notes''' IN v_b) > 0 AND position('''moth_tags''' IN v_b) > 0 AND position('''moth_tag_assignments''' IN v_b) > 0
          AND position('''moth_relationships''' IN v_b) > 0 AND position('''task_items''' IN v_b) > 0)
     OR position('''workspace''' IN v_c) = 0 OR position('prior_owner_id IS NULL' IN v_c) = 0
     OR position('prior_peer_class' IN v_g) = 0 OR position('mark_recording' IN v_g) = 0 OR position('capture_failed' IN v_g) = 0
     OR (SELECT count(*) FROM pg_constraint
          WHERE conrelid = 'public.moth_history'::regclass AND NOT convalidated
            AND conname IN ('moth_history_b_entity_chk', 'moth_history_c_class_chk', 'moth_history_g_peer_chk')) <> 3 THEN
    RAISE EXCEPTION '0128 post-condition: the record''s checks are not this file''s, waiting to be validated';
  END IF;
  -- 0119's other checks as they were, and nothing else.
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.moth_history'::regclass AND contype = 'c') <> 7 THEN
    RAISE EXCEPTION '0128 post-condition: moth_history does not hold its seven checks';
  END IF;
  RAISE NOTICE '0128 OK';
END $$;
