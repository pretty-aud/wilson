-- =============================================================================
-- 0100_otter_subject_shares.sql — B1 (designed 2026-10-27 by N2; revised the
-- same day by N2b after her ruling, design §10: a whole course to one person
-- as a BATCH of rows, and a receiver PASSING a subject on, the chain falling
-- with its first link)
--
-- SHARE ONE SUBJECT WITH ONE PERSON, AS A LIVE LINK THEY ACCEPT FIRST.
--
-- Retires 0065 (the 2026-08-12 draft; applied on no environment; its file
-- leaves the tree in this commit). Audrey, 2026-08-12, verbatim:
--   "so if the receiver doesnt have the course in their library of the subject.
--    you would add the new course and then place the subject in there. if the
--    user already has that software/ language course, you add the new subject
--    shared to that course."
--   LIVE LINK. ACCEPT FIRST.
--   "each user should have their own progression of subjects. dont make it a
--    universal one"
-- and 2026-10-27: "Build it before 1.0"; and, the same day, on sharing a whole
-- course and passing a subject on: "it is needed for 1.0".
--
-- The design is docs/design/OTTER_SUBJECT_SHARES_DESIGN.md. In short:
--   * a share is a ROW ABOUT TWO PEOPLE AND A SUBJECT, not a property of the
--     subject. otter_subjects has no visibility column and its SELECT policy
--     stays pure inheritance (0022) plus ONE arm,
--     otter_has_accepted_subject_share(id), which opens one subject to one
--     person and nothing of the course.
--   * every write goes through SECURITY DEFINER functions: five a client may
--     call (share, share_course, accept, decline, revoke) and one internal
--     row-maker (share_make) that the first two call, so a batch row and a
--     single row are made by one path. `authenticated` holds SELECT on the
--     table and nothing else; there is no INSERT, UPDATE or DELETE policy. A
--     guard trigger refuses any write not armed by a transaction-local GUC,
--     from any role.
--   * a WHOLE COURSE to one person is a batch of rows, one per live subject,
--     made in one transaction and grouped by batch_id; each row is accepted,
--     declined and revoked on its own.
--   * a receiver who accepted may PASS THE SUBJECT ON, one subject at a time:
--     the new row names the accepted row it hangs from (via_share_id) and the
--     owner of the subject's course (subject_owner_id). The consent helper
--     walks the chain to its root and is false at the first link that is not
--     accepted; ending any link revokes every link below it (the cascade in
--     otter_subject_share_revoke). The owner reads and may end every row of
--     their subject.
--   * one index function serves everyone's lists: live titles while a share
--     is pending or accepted (the owner always), the snapshots taken at share
--     time once it is settled, and nothing of a course in another workspace.
--   * a share names a subject of its own workspace and the owner of that
--     subject's course: the guard trigger refuses any other, armed or not, and
--     the helper and the index carry the same predicates as belts.
--   * one app_events line per transition, ids only (WIL-4110 .. WIL-4113).
--   * progress for a linked subject is keyed 'link:<subject_id>' BY THE CLIENT
--     on the receiver's own progress row for their host course. Nothing here
--     enforces that; the design's §1.3 and its test do.
--
-- 🚨 ORDERING RULE: this file redefines otter_subjects_select (0022). A by-hand
--    replay of 0022 must be followed by 0100 (handbook §4.9).
-- pgTAP: supabase/tests/rls/103_otter_subject_shares.sql.
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP+CREATE throughout.
-- =============================================================================

-- ── 0. Preflight: the functions' owner must bypass RLS ───────────────────────
-- The functions write a table on which `authenticated` has no INSERT or UPDATE
-- and no policy for either. They can write only because they run as their
-- owner, and only if that owner bypasses RLS (0069's preflight, for the same
-- reason: app_events_insert refuses the admin stream to everyone else). The
-- role running this file is the role that will own the functions it creates
-- (`postgres` on every Supabase project and in CI, which bypasses RLS); the
-- post-conditions at the foot check the OWNER's attribute once the functions
-- exist, as 0069 does.
DO $$
BEGIN
  IF NOT COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user), false) THEN
    RAISE EXCEPTION '0100 preflight failed: % does not bypass RLS, so the share functions could not write their own table', current_user;
  END IF;
END $$;

-- ── 1. The table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.otter_subject_shares (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Defaults matter: the functions pass neither, so a sharer cannot file as
  -- someone else or into another workspace.
  workspace_id   UUID NOT NULL DEFAULT public.current_workspace_id()
                 REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- The LIVE source. CASCADE is the feature: "it disappears if I delete it".
  subject_id     UUID NOT NULL REFERENCES public.otter_subjects(id) ON DELETE CASCADE,
  shared_by      UUID NOT NULL DEFAULT auth.uid(),
  shared_with    UUID NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  message        TEXT,
  -- What the subject and its course were called when it was offered. A settled
  -- share (declined, revoked) shows its ex-receiver these and never the live
  -- values (0045's precedent: a quiz attempt keeps its courses' names).
  subject_title  TEXT NOT NULL,
  course_name    TEXT NOT NULL,
  -- The RECEIVER'S course the subject is shown inside. NULL until accepted;
  -- kept after a revoke as history. FK-less on purpose (archive_course_id's
  -- precedent): a pointer that outlives the course it names.
  host_course_id UUID,
  responded_at   TIMESTAMPTZ,
  -- Who ended it: the owner withdrew, the sharer withdrew what they passed on,
  -- the receiver removed it, or a link above it ended (the cascade).
  ended_by       UUID,
  -- A whole course shared to one person is a BATCH of rows, one per subject,
  -- made in one transaction by otter_subject_share_course() and grouped by
  -- this id for the two lists. NULL for a share made one subject at a time.
  batch_id       UUID,
  -- Passing it on. An onward share names the ACCEPTED row its sharer holds
  -- for this subject; NULL for a row the owner made. The chain falls with
  -- its first link: CASCADE here says a child row never outlives its parent
  -- row, and otter_subject_share_revoke ends every live descendant.
  via_share_id   UUID,
  -- The owner of the subject's course when the row was made. Ownership never
  -- transfers (0022's identity pins), so it never goes stale. It is on the
  -- row so the SELECT policy can name the owner without a join: a policy that
  -- reads its own table recurses at run time. The guard asserts it against
  -- the live course at insert.
  subject_owner_id UUID NOT NULL,
  -- 1 for a row the owner made; the sharer's own depth plus one for an onward
  -- row. Both walks (up in the helper, down in the cascade) step this by
  -- exactly one, so they end by construction and a forged cycle cannot loop.
  chain_depth    SMALLINT NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID,
  CONSTRAINT otter_subject_share_via_fkey FOREIGN KEY (via_share_id)
    REFERENCES public.otter_subject_shares(id) ON DELETE CASCADE
);

ALTER TABLE public.otter_subject_shares ADD COLUMN IF NOT EXISTS ended_by         UUID;
ALTER TABLE public.otter_subject_shares ADD COLUMN IF NOT EXISTS subject_title    TEXT;
ALTER TABLE public.otter_subject_shares ADD COLUMN IF NOT EXISTS course_name      TEXT;
ALTER TABLE public.otter_subject_shares ADD COLUMN IF NOT EXISTS batch_id         UUID;
ALTER TABLE public.otter_subject_shares ADD COLUMN IF NOT EXISTS via_share_id     UUID;
ALTER TABLE public.otter_subject_shares ADD COLUMN IF NOT EXISTS subject_owner_id UUID;
ALTER TABLE public.otter_subject_shares ADD COLUMN IF NOT EXISTS chain_depth      SMALLINT;
-- On a table 0065 made (no rows anywhere: CI only), the columns above were
-- just added nullable; make them what the CREATE says.
ALTER TABLE public.otter_subject_shares ALTER COLUMN subject_title    SET NOT NULL;
ALTER TABLE public.otter_subject_shares ALTER COLUMN course_name      SET NOT NULL;
ALTER TABLE public.otter_subject_shares ALTER COLUMN subject_owner_id SET NOT NULL;
ALTER TABLE public.otter_subject_shares ALTER COLUMN chain_depth      SET DEFAULT 1;
ALTER TABLE public.otter_subject_shares ALTER COLUMN chain_depth      SET NOT NULL;
ALTER TABLE public.otter_subject_shares
  ALTER COLUMN workspace_id SET DEFAULT public.current_workspace_id();
ALTER TABLE public.otter_subject_shares
  ALTER COLUMN shared_by    SET DEFAULT auth.uid();

-- 0065's shapes, if a database ever carried them (none does outside a CI run
-- made before this file). The names that stay (the helper, the accept
-- function) are CREATE OR REPLACE'd below with the same signatures.
DROP TRIGGER  IF EXISTS trg_otter_subject_share_respond ON public.otter_subject_shares;
DROP FUNCTION IF EXISTS public.fn_otter_subject_share_respond();
ALTER TABLE public.otter_subject_shares DROP CONSTRAINT IF EXISTS otter_subject_share_host_chk;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_via_fkey') THEN
    ALTER TABLE public.otter_subject_shares ADD CONSTRAINT otter_subject_share_via_fkey
      FOREIGN KEY (via_share_id) REFERENCES public.otter_subject_shares(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_status_chk') THEN
    ALTER TABLE public.otter_subject_shares ADD CONSTRAINT otter_subject_share_status_chk
      CHECK (status IN ('pending', 'accepted', 'declined', 'revoked'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_not_self_chk') THEN
    ALTER TABLE public.otter_subject_shares ADD CONSTRAINT otter_subject_share_not_self_chk
      CHECK (shared_with <> shared_by);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_message_chk') THEN
    ALTER TABLE public.otter_subject_shares ADD CONSTRAINT otter_subject_share_message_chk
      CHECK (message IS NULL OR char_length(message) <= 2000);
  END IF;

  -- The snapshots stay within the source columns' own bounds (0022).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_snapshot_chk') THEN
    ALTER TABLE public.otter_subject_shares ADD CONSTRAINT otter_subject_share_snapshot_chk
      CHECK (char_length(subject_title) BETWEEN 1 AND 300
         AND char_length(course_name)   BETWEEN 1 AND 200);
  END IF;

  -- An accepted share has a host; a pending or declined one has none; a
  -- revoked one keeps whatever it had (history).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_host_state_chk') THEN
    ALTER TABLE public.otter_subject_shares ADD CONSTRAINT otter_subject_share_host_state_chk
      CHECK ((status <> 'accepted' OR host_course_id IS NOT NULL)
         AND (status NOT IN ('pending', 'declined') OR host_course_id IS NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_ended_chk') THEN
    ALTER TABLE public.otter_subject_shares ADD CONSTRAINT otter_subject_share_ended_chk
      CHECK ((status = 'revoked') = (ended_by IS NOT NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_responded_chk') THEN
    ALTER TABLE public.otter_subject_shares ADD CONSTRAINT otter_subject_share_responded_chk
      CHECK ((status = 'pending') = (responded_at IS NULL));
  END IF;

  -- The chain's shape, row by row (the guard checks what crosses rows): a row
  -- the owner made is the first link and hangs from nothing; an onward row
  -- hangs from a link and is deeper than one; a chain is at most eight links
  -- long; a batch is the owner's, so an onward row carries none; nobody is
  -- passed their own subject.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_chain_chk') THEN
    ALTER TABLE public.otter_subject_shares ADD CONSTRAINT otter_subject_share_chain_chk
      CHECK (chain_depth BETWEEN 1 AND 8
         AND ((via_share_id IS NULL) = (shared_by = subject_owner_id))
         AND ((via_share_id IS NULL) = (chain_depth = 1))
         AND (batch_id IS NULL OR via_share_id IS NULL)
         AND shared_with <> subject_owner_id);
  END IF;
END $$;

-- One LIVE share of a subject to a person. Re-sharing after a decline or a
-- revoke is allowed; queueing five copies is not. It is also what stops a
-- chain circling back (a person holds one live link per subject, whoever
-- made it) and why a batch SKIPS a subject already shared rather than raising.
CREATE UNIQUE INDEX IF NOT EXISTS otter_subject_share_live_uidx
  ON public.otter_subject_shares (subject_id, shared_with)
  WHERE status IN ('pending', 'accepted');

CREATE INDEX IF NOT EXISTS otter_subject_share_recipient_idx
  ON public.otter_subject_shares (shared_with, status);
CREATE INDEX IF NOT EXISTS otter_subject_share_sender_idx
  ON public.otter_subject_shares (shared_by, status);
CREATE INDEX IF NOT EXISTS otter_subject_share_owner_idx
  ON public.otter_subject_shares (subject_owner_id, status);
CREATE INDEX IF NOT EXISTS otter_subject_share_host_idx
  ON public.otter_subject_shares (host_course_id) WHERE host_course_id IS NOT NULL;
-- The two walks and the two groupings.
CREATE INDEX IF NOT EXISTS otter_subject_share_via_idx
  ON public.otter_subject_shares (via_share_id) WHERE via_share_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS otter_subject_share_batch_idx
  ON public.otter_subject_shares (batch_id) WHERE batch_id IS NOT NULL;

ALTER TABLE public.otter_subject_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otter_subject_shares FORCE  ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_otter_subject_share_audit ON public.otter_subject_shares;
CREATE TRIGGER trg_otter_subject_share_audit
  BEFORE INSERT OR UPDATE ON public.otter_subject_shares
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();

-- SELECT and nothing else for a signed-in person. The functions below are the
-- only writers; they run as their owner. PUBLIC is named: 0011's default
-- privileges re-arm it otherwise.
REVOKE ALL    ON public.otter_subject_shares FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.otter_subject_shares TO authenticated;
GRANT  ALL    ON public.otter_subject_shares TO service_role;

COMMENT ON TABLE public.otter_subject_shares IS
  '0100: a live link of ONE subject to ONE person, accepted before it appears. The receiver reads the owner''s subject inside their own host course; they never own or edit it; it stops when the source is trashed, ends when the share is revoked, and goes when the source is purged. A whole course shared to one person is a batch of these rows (batch_id); a receiver who accepted may pass the subject on (via_share_id names the link it hangs from), and the chain falls with any link above it. Written only by otter_subject_share / _share_course / _accept / _decline / _revoke, through otter_subject_share_make.';
COMMENT ON COLUMN public.otter_subject_shares.host_course_id IS
  '0100: the RECEIVER''S course the linked subject is shown inside, found by slug or made at accept. FK-less on purpose; kept after a revoke.';
COMMENT ON COLUMN public.otter_subject_shares.batch_id IS
  '0100: the batch this row was made in when a whole course was shared to one person (otter_subject_share_course); NULL for a single share. Groups rows in the two lists; every row is still accepted, declined and revoked on its own.';
COMMENT ON COLUMN public.otter_subject_shares.via_share_id IS
  '0100: for an onward share, the ACCEPTED row the sharer holds for this subject; NULL for a row the owner made. The consent helper walks this to the root and is false at the first link not accepted; otter_subject_share_revoke revokes every live descendant of the row it ends.';
COMMENT ON COLUMN public.otter_subject_shares.subject_owner_id IS
  '0100: the owner of the subject''s course when the row was made (ownership never transfers: 0022). Lets the SELECT policy admit the owner to every row of their subject without a join; asserted against the live course by the guard at insert.';
COMMENT ON COLUMN public.otter_subject_shares.chain_depth IS
  '0100: 1 for a row the owner made, the sharer''s depth plus one for an onward row, at most 8. The helper''s walk up and the cascade''s walk down step it by exactly one, so both end by construction.';

-- Policies on this table: SELECT only. The two parties of a share can see it,
-- and so can the OWNER of the subject it names, whoever made the row (her
-- ruling: "Your list shows every link"). Nobody else, including admins: a
-- share is between people, not workspace business. No INSERT/UPDATE/DELETE
-- policy: RLS default-denies them, and the grants above refuse them a step
-- earlier. The owner's arm reads the row's own column and never a subquery on
-- this table (a policy that reads its own table recurses at run time); the
-- guard asserts the column against the live course at insert, and the index
-- function re-reads the live owner before it discloses anything.
DROP POLICY IF EXISTS otter_subject_share_select ON public.otter_subject_shares;
DROP POLICY IF EXISTS otter_subject_share_insert ON public.otter_subject_shares;
DROP POLICY IF EXISTS otter_subject_share_update ON public.otter_subject_shares;
CREATE POLICY otter_subject_share_select ON public.otter_subject_shares
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (shared_by = auth.uid() OR shared_with = auth.uid() OR subject_owner_id = auth.uid())
  );

-- ── 2. The guard trigger: armed writes only, and the transition table ────────
-- Two GUCs, two id spaces (0064's lesson): the INSERT arm carries the SUBJECT
-- id, the UPDATE arm the SHARE id. Triggers fire for every role, so this binds
-- the service role and the test runner as well as the functions below.

CREATE OR REPLACE FUNCTION public.fn_otter_subject_share_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_insert_arm TEXT := current_setting('wilson.otter_subject_share_insert', true);
  v_update_arm TEXT := current_setting('wilson.otter_subject_share_update', true);
  v_sub_ws     UUID;
  v_owner      UUID;
  v_via        public.otter_subject_shares%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(v_insert_arm, '') <> NEW.subject_id::text THEN
      RAISE EXCEPTION 'a subject share is made by otter_subject_share(), not by inserting a row';
    END IF;
    -- A share names a subject of its own workspace, and the owner of that
    -- subject's course: the invariants fn_otter_editor_grant_workspace asserts
    -- for grants, here for shares. Read as definer; refused armed or not, from
    -- any role. The owner column is what the SELECT policy trusts.
    SELECT sub.workspace_id, src.owner_id INTO v_sub_ws, v_owner
      FROM public.otter_subjects sub
      JOIN public.otter_courses  src ON src.id = sub.course_id
     WHERE sub.id = NEW.subject_id;
    IF v_sub_ws IS NULL OR v_sub_ws IS DISTINCT FROM NEW.workspace_id THEN
      RAISE EXCEPTION 'a subject share names a subject of its own workspace';
    END IF;
    IF v_owner IS NULL OR NEW.subject_owner_id IS DISTINCT FROM v_owner THEN
      RAISE EXCEPTION 'a subject share names the owner of its subject''s course';
    END IF;
    -- An onward row hangs from the accepted row its sharer holds for this
    -- subject, in this workspace, one link deeper. The CHECK gives each row
    -- its own shape; this is the fact that crosses rows.
    IF NEW.via_share_id IS NOT NULL THEN
      SELECT * INTO v_via FROM public.otter_subject_shares WHERE id = NEW.via_share_id;
      IF v_via.id IS NULL
         OR v_via.status <> 'accepted'
         OR v_via.subject_id   IS DISTINCT FROM NEW.subject_id
         OR v_via.workspace_id IS DISTINCT FROM NEW.workspace_id
         OR v_via.shared_with  IS DISTINCT FROM NEW.shared_by
         OR v_via.chain_depth  <> NEW.chain_depth - 1 THEN
        RAISE EXCEPTION 'an onward share links to the accepted share its sharer holds';
      END IF;
    END IF;
    IF NEW.status <> 'pending' OR NEW.host_course_id IS NOT NULL
       OR NEW.responded_at IS NOT NULL OR NEW.ended_by IS NOT NULL THEN
      RAISE EXCEPTION 'a new subject share starts pending, with nothing decided';
    END IF;
    RETURN NEW;
  END IF;

  IF COALESCE(v_update_arm, '') <> OLD.id::text THEN
    RAISE EXCEPTION 'a subject share changes through accept, decline or revoke, not by updating a row';
  END IF;

  -- Immutable provenance: re-pointing any of these would move a consented read
  -- onto a different subject, a different person, a different owner, or a
  -- different link in the chain.
  NEW.id               := OLD.id;
  NEW.workspace_id     := OLD.workspace_id;
  NEW.subject_id       := OLD.subject_id;
  NEW.shared_by        := OLD.shared_by;
  NEW.shared_with      := OLD.shared_with;
  NEW.message          := OLD.message;
  NEW.subject_title    := OLD.subject_title;
  NEW.course_name      := OLD.course_name;
  NEW.batch_id         := OLD.batch_id;
  NEW.via_share_id     := OLD.via_share_id;
  NEW.subject_owner_id := OLD.subject_owner_id;
  NEW.chain_depth      := OLD.chain_depth;
  NEW.created_at       := OLD.created_at;
  NEW.created_by       := OLD.created_by;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'pending' AND NEW.status IN ('accepted', 'declined', 'revoked') THEN
      NULL;
    ELSIF OLD.status = 'accepted' AND NEW.status = 'revoked' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'a subject share cannot move from % to %', OLD.status, NEW.status;
    END IF;

    NEW.responded_at := COALESCE(OLD.responded_at, now());

    IF NEW.status = 'revoked' THEN
      IF NEW.ended_by IS NULL THEN
        RAISE EXCEPTION 'a revoked share records who ended it';
      END IF;
      -- host_course_id is kept as it was: history of where it lived.
      NEW.host_course_id := OLD.host_course_id;
    ELSE
      NEW.ended_by := NULL;
    END IF;

    IF NEW.status = 'accepted' AND NEW.host_course_id IS NULL THEN
      RAISE EXCEPTION 'accepting places the subject in a course';
    END IF;
    IF NEW.status = 'declined' THEN
      NEW.host_course_id := NULL;
    END IF;
  ELSE
    -- No transition: nothing else may move.
    NEW.host_course_id := OLD.host_course_id;
    NEW.responded_at   := OLD.responded_at;
    NEW.ended_by       := OLD.ended_by;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_otter_subject_share_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_otter_subject_share_guard ON public.otter_subject_shares;
CREATE TRIGGER trg_otter_subject_share_guard
  BEFORE INSERT OR UPDATE ON public.otter_subject_shares
  FOR EACH ROW EXECUTE FUNCTION public.fn_otter_subject_share_guard();

-- ── 3. The consent helper ────────────────────────────────────────────────────
-- True when the caller may read p_subject_id BECAUSE it was shared with them
-- and they accepted, and every link between their row and the owner is still
-- accepted. plpgsql SECURITY DEFINER, not sql: it must not inline into the
-- calling policy's qual. It reads no role: a share names one person.
--
-- The walk starts at the caller's own accepted row for the subject (at most
-- one: the live index) and follows via_share_id upwards, one accepted link at
-- a time, each link one depth shallower than the last (so the recursion ends
-- by construction and a forged cycle cannot loop); it must reach a row with no
-- link above it, made by the course's LIVE owner. One bad link and it is false.

CREATE OR REPLACE FUNCTION public.otter_has_accepted_subject_share(p_subject_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ws  UUID := public.current_workspace_id();
BEGIN
  IF v_uid IS NULL OR v_ws IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    WITH RECURSIVE chain AS (
      SELECT s.id, s.via_share_id, s.shared_by, s.subject_id, s.workspace_id, s.chain_depth
        FROM public.otter_subject_shares s
       WHERE s.subject_id = p_subject_id
         AND s.workspace_id = v_ws
         AND s.shared_with = v_uid
         AND s.status = 'accepted'
      UNION ALL
      SELECT p.id, p.via_share_id, p.shared_by, p.subject_id, p.workspace_id, p.chain_depth
        FROM chain c
        JOIN public.otter_subject_shares p ON p.id = c.via_share_id
       WHERE p.status = 'accepted'
         AND p.subject_id   = c.subject_id
         AND p.workspace_id = c.workspace_id
         -- the link: the row above was shared WITH the person who passed it on
         AND p.shared_with  = c.shared_by
         AND p.chain_depth  = c.chain_depth - 1
    )
    SELECT 1
      FROM chain root
      JOIN public.otter_subjects sub ON sub.id = root.subject_id
      JOIN public.otter_courses  src ON src.id = sub.course_id
     WHERE root.via_share_id IS NULL
       AND root.chain_depth = 1
       -- Belt: a row that names a subject of another workspace opens nothing,
       -- before the policy's own workspace predicate refuses it too.
       AND sub.workspace_id = root.workspace_id
       AND sub.deleted_at IS NULL
       AND src.deleted_at IS NULL
       -- Consent re-check: the root of the chain was made by the course's
       -- live owner, and only the subject named opens. Also enforced by
       -- otter_subject_share_make() and the guard.
       AND src.owner_id = root.shared_by
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_has_accepted_subject_share(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_has_accepted_subject_share(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_has_accepted_subject_share IS
  '0100: consented read on ONE linked subject. True when p_subject_id was shared with the caller, in the caller''s active workspace, they accepted, and every link between their row and the owner''s own share is still accepted (the chain is walked to its root, which must be the course''s live owner). Grants nothing on the parent course.';

-- ── 4. The read reaches the subject, and only the subject ────────────────────
-- 0022 verbatim plus the link arm. A subject of a course you can read is still
-- readable through the EXISTS; the arm adds exactly one more way in, one row at
-- a time. The UPDATE policy is untouched (a post-condition says so).

DROP POLICY IF EXISTS otter_subjects_select ON public.otter_subjects;
CREATE POLICY otter_subjects_select ON public.otter_subjects
  FOR SELECT USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (
      EXISTS (
        SELECT 1 FROM public.otter_courses c WHERE c.id = otter_subjects.course_id
      )
      OR public.otter_has_accepted_subject_share(id)
    )
  );

-- ── 5. otter_subject_share_make() — the one path to a share row ──────────────
-- Internal: no client role may execute it (the guard trigger function's
-- shape). otter_subject_share() and otter_subject_share_course() call it, so
-- a batch row and a single row are made by one body: the same checks, the
-- same snapshots, the same arm, the same audit line (0059's and 0069's
-- lesson: two copies of an arm drift). p_batch_id is NULL for a single share.

CREATE OR REPLACE FUNCTION public.otter_subject_share_make(
  p_subject_id  UUID,
  p_shared_with UUID,
  p_message     TEXT,
  p_batch_id    UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_ws      UUID := public.current_workspace_id();
  v_sub     public.otter_subjects%ROWTYPE;
  v_src     public.otter_courses%ROWTYPE;
  v_via     public.otter_subject_shares%ROWTYPE;
  v_chain   UUID[];
  v_link    UUID;
  v_depth   SMALLINT := 1;
  v_message TEXT := NULLIF(btrim(p_message), '');
  v_id      UUID;
BEGIN
  IF v_uid IS NULL OR v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;
  IF p_shared_with IS NULL OR p_shared_with = v_uid THEN
    RAISE EXCEPTION 'choose a colleague to share it with';
  END IF;

  SELECT * INTO v_sub FROM public.otter_subjects
   WHERE id = p_subject_id AND deleted_at IS NULL;
  IF v_sub.id IS NULL OR v_sub.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'subject not found in this workspace';
  END IF;

  SELECT * INTO v_src FROM public.otter_courses
   WHERE id = v_sub.course_id AND deleted_at IS NULL;
  IF v_src.id IS NULL OR v_src.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'the course that subject belongs to no longer exists';
  END IF;
  -- Who may make the row. The OWNER of the course (S1: not an admin, not a
  -- granted editor; consent is not transferable). Or a colleague who ACCEPTED
  -- a share of this subject and is passing it on (her ruling of 2026-10-27):
  -- consent is passed along a chain the owner can see whole and end at any
  -- link. A whole course (a batch) is the owner's alone. Standing is settled
  -- before anything about the subject's owner is said (N2b round 1, note).
  IF v_src.owner_id = v_uid THEN
    v_depth := 1;
  ELSE
    IF p_batch_id IS NOT NULL THEN
      RAISE EXCEPTION 'only the owner of a course may share it whole';
    END IF;
    -- The link this row will hang from: the caller's own accepted row for the
    -- subject (at most one: the live index).
    SELECT * INTO v_via FROM public.otter_subject_shares s
     WHERE s.subject_id = p_subject_id
       AND s.workspace_id = v_ws
       AND s.shared_with = v_uid
       AND s.status = 'accepted';
    IF v_via.id IS NULL THEN
      RAISE EXCEPTION 'only the owner of a course, or someone who accepted a share of this subject, may share it';
    END IF;
    -- The bound before the walk, so that one row at depth 8 probes it.
    IF v_via.chain_depth >= 8 THEN
      RAISE EXCEPTION 'this subject has been passed on as far as it can go';
    END IF;
    -- Lock the WHOLE chain above the new row, root first, each link re-read
    -- as still accepted under its lock (N2b round 1, finding 1). A revoke
    -- anywhere above takes FOR UPDATE on its row before it opens its cascade,
    -- so either it waits here for this insert to commit and its cascade then
    -- sees the new row, or it commits first and the re-read under the lock
    -- finds the link no longer accepted. Locking only the parent left a hole:
    -- a revoke two links up had opened its cascade before the new row existed.
    -- Root first is the order the cascade locks in (depth ascending), so the
    -- two cannot deadlock. The walk steps chain_depth by one, so it ends.
    SELECT array_agg(q.id ORDER BY q.chain_depth) INTO v_chain
      FROM (
        WITH RECURSIVE up AS (
          SELECT s.id, s.via_share_id, s.chain_depth
            FROM public.otter_subject_shares s
           WHERE s.id = v_via.id
          UNION ALL
          SELECT p.id, p.via_share_id, p.chain_depth
            FROM up u
            JOIN public.otter_subject_shares p ON p.id = u.via_share_id
           WHERE p.chain_depth = u.chain_depth - 1
        )
        SELECT up.id, up.chain_depth FROM up
      ) q;
    IF v_chain IS NULL THEN
      -- The anchor row went between the read above and the walk (a purge in
      -- the same instant): the same sentence, not a null-array error.
      RAISE EXCEPTION 'this subject is no longer shared with you';
    END IF;
    FOREACH v_link IN ARRAY v_chain LOOP
      PERFORM 1 FROM public.otter_subject_shares s
        WHERE s.id = v_link AND s.status = 'accepted'
        FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'this subject is no longer shared with you';
      END IF;
    END LOOP;
    -- The whole chain as the caller sees it: the helper is the belt (the
    -- link condition, the depths, the root's owner, the trash).
    IF NOT public.otter_has_accepted_subject_share(p_subject_id) THEN
      RAISE EXCEPTION 'this subject is no longer shared with you';
    END IF;
    v_depth := v_via.chain_depth + 1;
  END IF;

  IF p_shared_with = v_src.owner_id THEN
    RAISE EXCEPTION 'that is their own subject';
  END IF;

  -- A live member of THIS workspace. A share to a deactivated account would
  -- wait forever in a queue nobody reads; one to another workspace cannot be.
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members wm
                  WHERE wm.workspace_id = v_ws
                    AND wm.user_id = p_shared_with
                    AND wm.is_active) THEN
    RAISE EXCEPTION 'that person is not an active member of this workspace';
  END IF;

  IF v_message IS NOT NULL AND char_length(v_message) > 2000 THEN
    RAISE EXCEPTION 'the note is longer than 2000 characters';
  END IF;

  -- A sentence instead of a bare 23505; the partial unique index catches the
  -- race between two concurrent offers. It is also what refuses a chain
  -- circling back: a person holds one live link per subject, whoever made it.
  IF EXISTS (SELECT 1 FROM public.otter_subject_shares s
              WHERE s.subject_id = p_subject_id
                AND s.shared_with = p_shared_with
                AND s.status IN ('pending', 'accepted')) THEN
    RAISE EXCEPTION 'this subject is already shared with that person';
  END IF;

  PERFORM set_config('wilson.otter_subject_share_insert', p_subject_id::text, true);
  INSERT INTO public.otter_subject_shares
    (workspace_id, subject_id, shared_by, shared_with, message, subject_title, course_name,
     batch_id, via_share_id, subject_owner_id, chain_depth)
  VALUES
    (v_ws, p_subject_id, v_uid, p_shared_with, v_message,
     left(v_sub.title, 300), left(v_src.name, 200),
     p_batch_id, v_via.id, v_src.owner_id, v_depth)
  RETURNING id INTO v_id;
  PERFORM set_config('wilson.otter_subject_share_insert', '', true);

  -- Ids only: admins read this stream, and a title would tell them what the
  -- course index deliberately does not. The batch and the link are ids too.
  INSERT INTO public.app_events
    (workspace_id, actor_user_id, event_type, code, severity, message, context)
  VALUES (v_ws, v_uid, 'admin', 'WIL-4110', 'info',
          'A subject was shared with a colleague',
          jsonb_build_object('share_id', v_id, 'subject_id', p_subject_id,
                             'course_id', v_src.id, 'shared_by', v_uid,
                             'shared_with', p_shared_with,
                             'subject_owner_id', v_src.owner_id,
                             'via_share_id', v_via.id, 'batch_id', p_batch_id,
                             'chain_depth', v_depth));

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_subject_share_make(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.otter_subject_share_make IS
  '0100: INTERNAL, executable by no client role. The one path to a share row: the checks, the snapshots, the armed insert and the WIL-4110 line, for a single share (p_batch_id NULL) and for every row of a whole-course batch. The owner of a course shares its subjects; a colleague who accepted a share of a subject passes it on (via_share_id = their accepted row); nobody else.';

-- ── 6. otter_subject_share() — one subject to one person ─────────────────────
-- The owner offers a subject of their course; a colleague who accepted it
-- passes it on. A thin SECURITY DEFINER wrapper: the body is _make.

CREATE OR REPLACE FUNCTION public.otter_subject_share(
  p_subject_id  UUID,
  p_shared_with UUID,
  p_message     TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.otter_subject_share_make(p_subject_id, p_shared_with, p_message, NULL);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_subject_share(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_subject_share(UUID, UUID, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_subject_share IS
  '0100: the owner of a course offers ONE of its subjects to ONE active member of the same workspace, or a colleague who accepted a share of that subject passes it on to one. Starts pending. Returns the share id.';

-- ── 7. otter_subject_share_course() — a whole course to one person ───────────
-- Her ruling of 2026-10-27: "A whole course to one person." Not a fourth
-- visibility (0064 refused to add one): a BATCH of subject rows, one per live
-- subject of the course, stubs included (an outline that fills live), made in
-- one transaction and grouped by one batch id. Each row is then accepted,
-- declined and revoked on its own, by the functions below; the client offers
-- "Accept all", "Decline all" and "Withdraw all" as loops over the rows. A
-- subject already live-shared with the person is SKIPPED, not refused (the
-- live index would otherwise raise mid-batch and roll the whole offer back);
-- an offer that would make no row is refused in words. Subjects added to the
-- course later do NOT follow (her ruling): the client reminds the owner.

CREATE OR REPLACE FUNCTION public.otter_subject_share_course(
  p_course_id   UUID,
  p_shared_with UUID,
  p_message     TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_ws    UUID := public.current_workspace_id();
  v_src   public.otter_courses%ROWTYPE;
  v_batch UUID := gen_random_uuid();
  v_total INTEGER := 0;
  v_made  INTEGER := 0;
  r       RECORD;
BEGIN
  IF v_uid IS NULL OR v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;
  IF p_shared_with IS NULL OR p_shared_with = v_uid THEN
    RAISE EXCEPTION 'choose a colleague to share it with';
  END IF;

  SELECT * INTO v_src FROM public.otter_courses
   WHERE id = p_course_id AND deleted_at IS NULL;
  IF v_src.id IS NULL OR v_src.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'course not found in this workspace';
  END IF;
  -- A whole course is the owner's to share (S1). A received batch is not
  -- passed on whole (design §7); a receiver passes one subject at a time.
  IF v_src.owner_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'only the owner of a course may share it whole';
  END IF;
  -- Checked per row by _make as well; checked once here so that an empty
  -- course, or one already shared whole, is not reported after a membership
  -- refusal that belongs to the person and not to the course.
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members wm
                  WHERE wm.workspace_id = v_ws
                    AND wm.user_id = p_shared_with
                    AND wm.is_active) THEN
    RAISE EXCEPTION 'that person is not an active member of this workspace';
  END IF;

  -- One row per LIVE subject, in the course's own order. The rows share one
  -- transaction and therefore one created_at; the client orders a batch's
  -- rows by title.
  FOR r IN
    SELECT sub.id,
           EXISTS (SELECT 1 FROM public.otter_subject_shares s
                    WHERE s.subject_id = sub.id
                      AND s.shared_with = p_shared_with
                      AND s.status IN ('pending', 'accepted')) AS already
      FROM public.otter_subjects sub
     WHERE sub.course_id = v_src.id
       AND sub.deleted_at IS NULL
     ORDER BY sub.subject_order, sub.created_at, sub.id
  LOOP
    v_total := v_total + 1;
    IF r.already THEN
      CONTINUE;
    END IF;
    PERFORM public.otter_subject_share_make(r.id, p_shared_with, p_message, v_batch);
    v_made := v_made + 1;
  END LOOP;

  -- Both refusals leave nothing behind: no row was made in either case.
  IF v_total = 0 THEN
    RAISE EXCEPTION 'this course has no subjects';
  END IF;
  IF v_made = 0 THEN
    RAISE EXCEPTION 'every subject of this course is already shared with that person';
  END IF;

  RETURN v_batch;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_subject_share_course(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_subject_share_course(UUID, UUID, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_subject_share_course IS
  '0100: the owner of a course offers ALL of its live subjects to ONE active member of the same workspace, as a batch of pending share rows made in one transaction (one WIL-4110 line each, the batch id in every context). Skips a subject already shared with that person; refuses a course with no subjects or nothing left to share. Returns the batch id. Each row is accepted, declined and revoked on its own.';

-- ── 8. otter_subject_share_accept() — the only path to 'accepted' ────────────
-- SECURITY DEFINER because the receiver must read the SOURCE course's slug,
-- name and type to find or make their own copy, and that course may be
-- personal to the owner. The INSERT into otter_courses runs the audit trigger
-- and no pin trigger (those are BEFORE UPDATE), so there is no silent-revert
-- hazard of the kind 0064 had to work around. An onward receiver's host is
-- found exactly as any receiver's: by the OWNER'S course slug, so every link
-- of a chain and every row of a batch lands in the same host course.

CREATE OR REPLACE FUNCTION public.otter_subject_share_accept(p_share_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_ws    UUID := public.current_workspace_id();
  v_share public.otter_subject_shares%ROWTYPE;
  v_sub   public.otter_subjects%ROWTYPE;
  v_src   public.otter_courses%ROWTYPE;
  v_host  UUID;
BEGIN
  IF v_uid IS NULL OR v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;

  SELECT * INTO v_share FROM public.otter_subject_shares
   WHERE id = p_share_id FOR UPDATE;
  IF v_share.id IS NULL OR v_share.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'share not found in this workspace';
  END IF;
  IF v_share.shared_with IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'only the person it was shared with may accept it';
  END IF;
  IF v_share.status <> 'pending' THEN
    RAISE EXCEPTION 'this share is % — only a pending share can be accepted', v_share.status;
  END IF;

  SELECT * INTO v_sub FROM public.otter_subjects
   WHERE id = v_share.subject_id AND deleted_at IS NULL;
  IF v_sub.id IS NULL THEN
    RAISE EXCEPTION 'that subject no longer exists';
  END IF;
  -- The guard refuses a cross-workspace row at insert; this is the belt.
  IF v_sub.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'subject not found in this workspace';
  END IF;
  SELECT * INTO v_src FROM public.otter_courses
   WHERE id = v_sub.course_id AND deleted_at IS NULL;
  IF v_src.id IS NULL THEN
    RAISE EXCEPTION 'the course that subject belongs to no longer exists';
  END IF;
  -- Ownership never transfers (0022's pins), so this is a belt on the column
  -- the SELECT policy trusts.
  IF v_src.owner_id IS DISTINCT FROM v_share.subject_owner_id THEN
    RAISE EXCEPTION 'that subject has changed hands since it was shared';
  END IF;
  -- An onward offer stands only while the link it hangs from does. The
  -- cascade revokes a pending descendant with its parent, so this is the belt
  -- (a forged row, or a parent ended in the same instant).
  IF v_share.via_share_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.otter_subject_shares p
        WHERE p.id = v_share.via_share_id AND p.status = 'accepted') THEN
    RAISE EXCEPTION 'the person who passed this on no longer has it';
  END IF;

  -- "if the user already has that software/language course, you add the new
  --  subject shared to that course" — matched on the KEY (slug), which is what
  -- "the same course" means structurally: frozen at creation, inherited by
  -- forks, unaffected by either person renaming their copy. Never the name.
  SELECT c.id INTO v_host
    FROM public.otter_courses c
   WHERE c.workspace_id = v_ws
     AND c.owner_id = v_uid
     AND c.slug = v_src.slug
     AND c.deleted_at IS NULL
   LIMIT 1;

  -- "if the receiver doesnt have the course ... you would add the new course
  --  and then place the subject in there." A personal course of the source's
  -- identity, with no documents: a share is one subject, not a copy.
  IF v_host IS NULL THEN
    INSERT INTO public.otter_courses
      (workspace_id, owner_id, slug, name, course_type, skill_level, visibility, created_by, updated_by)
    VALUES
      (v_ws, v_uid, v_src.slug, v_src.name, v_src.course_type, v_src.skill_level, 'personal', v_uid, v_uid)
    RETURNING id INTO v_host;
  END IF;

  PERFORM set_config('wilson.otter_subject_share_update', v_share.id::text, true);
  UPDATE public.otter_subject_shares
     SET status = 'accepted', host_course_id = v_host
   WHERE id = v_share.id;
  PERFORM set_config('wilson.otter_subject_share_update', '', true);

  INSERT INTO public.app_events
    (workspace_id, actor_user_id, event_type, code, severity, message, context)
  VALUES (v_ws, v_uid, 'admin', 'WIL-4111', 'info',
          'A shared subject was accepted',
          jsonb_build_object('share_id', v_share.id, 'subject_id', v_share.subject_id,
                             'course_id', v_src.id, 'shared_by', v_share.shared_by,
                             'shared_with', v_uid, 'host_course_id', v_host,
                             'subject_owner_id', v_share.subject_owner_id,
                             'via_share_id', v_share.via_share_id,
                             'batch_id', v_share.batch_id));

  RETURN v_host;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_subject_share_accept(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_subject_share_accept(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_subject_share_accept IS
  '0100: the receiver accepts a pending share. Finds their live course with the owner''s course slug, or makes a personal one, and links the subject into it. Returns the host course id. The only path to status=accepted. A batch is accepted one row at a time; an onward offer only while the link it hangs from is accepted.';

-- ── 9. otter_subject_share_decline() ─────────────────────────────────────────
-- No cascade: an onward share hangs from an ACCEPTED row, so a pending row has
-- no descendants to fall.

CREATE OR REPLACE FUNCTION public.otter_subject_share_decline(p_share_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_ws     UUID := public.current_workspace_id();
  v_share  public.otter_subject_shares%ROWTYPE;
  v_course UUID;
BEGIN
  IF v_uid IS NULL OR v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;

  SELECT * INTO v_share FROM public.otter_subject_shares
   WHERE id = p_share_id FOR UPDATE;
  IF v_share.id IS NULL OR v_share.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'share not found in this workspace';
  END IF;
  IF v_share.shared_with IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'only the person it was shared with may decline it';
  END IF;
  IF v_share.status <> 'pending' THEN
    RAISE EXCEPTION 'this share is % — only a pending share can be declined', v_share.status;
  END IF;
  -- For the audit line only: every code's context names the course (N2b
  -- round 2, finding 6). The decline reads nothing else of the subject, so a
  -- subject in the trash can still be declined.
  SELECT sub.course_id INTO v_course
    FROM public.otter_subjects sub WHERE sub.id = v_share.subject_id;

  PERFORM set_config('wilson.otter_subject_share_update', v_share.id::text, true);
  UPDATE public.otter_subject_shares SET status = 'declined' WHERE id = v_share.id;
  PERFORM set_config('wilson.otter_subject_share_update', '', true);

  INSERT INTO public.app_events
    (workspace_id, actor_user_id, event_type, code, severity, message, context)
  VALUES (v_ws, v_uid, 'admin', 'WIL-4112', 'info',
          'A shared subject was declined',
          jsonb_build_object('share_id', v_share.id, 'subject_id', v_share.subject_id,
                             'course_id', v_course,
                             'shared_by', v_share.shared_by, 'shared_with', v_uid,
                             'subject_owner_id', v_share.subject_owner_id,
                             'via_share_id', v_share.via_share_id,
                             'batch_id', v_share.batch_id));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_subject_share_decline(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_subject_share_decline(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_subject_share_decline IS
  '0100: the receiver declines a pending share. A record both can read; nothing was opened. A batch is declined one row at a time.';

-- ── 10. otter_subject_share_revoke() — any party ends it, and the chain falls ─
-- Three hands may end a row: the OWNER of the subject's course, any row of
-- their subject, pending or accepted, whoever made it ("Your list shows every
-- link, and you can also withdraw any single one of them directly"); the
-- SHARER of an onward row, withdrawing what they passed on; the RECEIVER,
-- removing an accepted row from their course (S3; a pending offer is declined,
-- not removed). All reach the same terminal state: the link stops resolving on
-- the next statement. The receiver's progress row is theirs and is not touched.
--
-- THE CHAIN FALLS (her ruling of 2026-10-27, "They lose it too"): every row
-- still pending or accepted below the row ended is revoked with it, by the same
-- hand, each with its own WIL-4113 line (role 'upstream', naming the row that
-- fell). Her subject is never readable through a link she, or anyone above,
-- ended.

CREATE OR REPLACE FUNCTION public.otter_subject_share_revoke(p_share_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_ws      UUID := public.current_workspace_id();
  v_share   public.otter_subject_shares%ROWTYPE;
  v_owner   UUID;
  v_course  UUID;
  v_role    TEXT;
  v_desc_id UUID;
  v_desc    public.otter_subject_shares%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;

  SELECT * INTO v_share FROM public.otter_subject_shares
   WHERE id = p_share_id FOR UPDATE;
  IF v_share.id IS NULL OR v_share.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'share not found in this workspace';
  END IF;

  -- Who is ending it. The owner is read from the LIVE course, not from the
  -- row's own column: the column is the SELECT policy's concern and the
  -- guard's, and a row that misnames its owner is still the live owner's to
  -- end, as the index lists it to them (N2b round 1, finding 6).
  SELECT src.owner_id, src.id INTO v_owner, v_course
    FROM public.otter_subjects sub
    JOIN public.otter_courses  src ON src.id = sub.course_id
   WHERE sub.id = v_share.subject_id;
  IF v_owner = v_uid THEN
    v_role := 'owner';
  ELSIF v_share.shared_by = v_uid THEN
    v_role := 'sharer';
  ELSIF v_share.shared_with = v_uid THEN
    v_role := 'receiver';
  ELSE
    RAISE EXCEPTION 'only the owner of the subject, the person who shared it, or the person it was shared with may end this share';
  END IF;
  IF v_share.status NOT IN ('pending', 'accepted') THEN
    RAISE EXCEPTION 'this share is already % — there is nothing to end', v_share.status;
  END IF;
  -- A receiver removes what they hold; an offer they have not accepted is
  -- declined, not removed (S3).
  IF v_role = 'receiver' AND v_share.status <> 'accepted' THEN
    RAISE EXCEPTION 'this share is still waiting for your answer — decline it instead';
  END IF;

  PERFORM set_config('wilson.otter_subject_share_update', v_share.id::text, true);
  UPDATE public.otter_subject_shares
     SET status = 'revoked', ended_by = v_uid
   WHERE id = v_share.id;
  PERFORM set_config('wilson.otter_subject_share_update', '', true);

  INSERT INTO public.app_events
    (workspace_id, actor_user_id, event_type, code, severity, message, context)
  VALUES (v_ws, v_uid, 'admin', 'WIL-4113', 'info',
          'A shared subject was revoked',
          jsonb_build_object('share_id', v_share.id, 'subject_id', v_share.subject_id,
                             'course_id', v_course,
                             'shared_by', v_share.shared_by, 'shared_with', v_share.shared_with,
                             'subject_owner_id', v_share.subject_owner_id,
                             'via_share_id', v_share.via_share_id,
                             'batch_id', v_share.batch_id,
                             'ended_by_role', v_role));

  -- The cascade. The walk down follows via_share_id whatever each row's status
  -- (a settled middle row still has its children walked), stepping chain_depth
  -- by exactly one so it ends by construction; each live descendant is then
  -- locked, re-read and ended on its own, because the guard checks the update
  -- arm against OLD.id one row at a time. A descendant settled by its own party
  -- in the same instant is left as they settled it.
  FOR v_desc_id IN
    SELECT d.id
      FROM (
        WITH RECURSIVE down AS (
          SELECT s.id, s.chain_depth
            FROM public.otter_subject_shares s
           WHERE s.via_share_id = v_share.id
             AND s.chain_depth = v_share.chain_depth + 1
          UNION ALL
          SELECT s.id, s.chain_depth
            FROM down x
            JOIN public.otter_subject_shares s ON s.via_share_id = x.id
           WHERE s.chain_depth = x.chain_depth + 1
        )
        SELECT down.id, down.chain_depth FROM down
      ) d
     ORDER BY d.chain_depth, d.id
  LOOP
    SELECT * INTO v_desc FROM public.otter_subject_shares
     WHERE id = v_desc_id FOR UPDATE;
    IF v_desc.status NOT IN ('pending', 'accepted') THEN
      CONTINUE;
    END IF;

    PERFORM set_config('wilson.otter_subject_share_update', v_desc.id::text, true);
    UPDATE public.otter_subject_shares
       SET status = 'revoked', ended_by = v_uid
     WHERE id = v_desc.id;
    PERFORM set_config('wilson.otter_subject_share_update', '', true);

    INSERT INTO public.app_events
      (workspace_id, actor_user_id, event_type, code, severity, message, context)
    VALUES (v_ws, v_uid, 'admin', 'WIL-4113', 'info',
            'A shared subject was revoked',
            jsonb_build_object('share_id', v_desc.id, 'subject_id', v_desc.subject_id,
                               'course_id', v_course,
                               'shared_by', v_desc.shared_by, 'shared_with', v_desc.shared_with,
                               'subject_owner_id', v_desc.subject_owner_id,
                               'via_share_id', v_desc.via_share_id,
                               'batch_id', v_desc.batch_id,
                               'ended_by_role', 'upstream',
                               'cascaded_from', v_share.id));
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_subject_share_revoke(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_subject_share_revoke(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_subject_share_revoke IS
  '0100: ends a pending or accepted share: the owner of the subject''s course may end any row of their subject, the sharer of an onward row what they passed on, the receiver an accepted row they hold (a pending offer is declined, not removed). Every live row below the one ended is revoked with it (the chain falls), each with its own WIL-4113 line. Records who ended it; keeps the host pointer as history.';

-- ── 11. otter_subject_shares_index() — everyone's lists ──────────────────────
-- The receiver of a PENDING share may not read the subject yet (not accepted),
-- so its title comes from here: the owner's consented disclosure, the minimum
-- to decide on. What each side may learn is decided HERE, per row:
--   * the OWNER of the subject (read from the live course, not from the
--     row): every row of their subject, whoever made it, the live columns
--     always (it is their subject), with the chain (via_share_id, both labels)
--     and the batch;
--   * the sharer of an onward row and the receiver, pending: the title,
--     is_stub, the course's NAME, the owner's and the sharer's labels and the
--     note; no course id, slug, type or level;
--   * the receiver, accepted: the live columns, plus the host pointer and
--     whether the host is live (nobody else gets those two);
--   * anyone but the owner, declined or revoked: the two snapshots and
--     nothing live.
-- A row whose subject or course sits in another workspace is not listed at
-- all (the helper's belt, repeated here). A pending or accepted onward row
-- whose link above is not whole, by the helper's own test (accepted, the same
-- subject, shared with this row's sharer, exactly one depth shallower), is a
-- row the functions could not have made (the cascade ends descendants with
-- their parent; the guard refuses a bad link at insert): it is listed to the
-- owner only, as `gone`, and to nobody it names (N2b round 2, finding 5).

DROP FUNCTION IF EXISTS public.otter_subject_shares_index();

CREATE FUNCTION public.otter_subject_shares_index()
RETURNS TABLE (
  id               UUID,
  subject_id       UUID,
  subject_title    TEXT,
  subject_is_stub  BOOLEAN,
  course_id        UUID,
  course_name      TEXT,
  course_slug      TEXT,
  course_type      TEXT,
  skill_level      TEXT,
  shared_by        UUID,
  sharer_label     TEXT,
  shared_with      UUID,
  receiver_label   TEXT,
  subject_owner_id UUID,
  owner_label      TEXT,
  batch_id         UUID,
  via_share_id     UUID,
  chain_depth      SMALLINT,
  status           TEXT,
  state            TEXT,
  message          TEXT,
  host_course_id   UUID,
  host_live        BOOLEAN,
  created_at       TIMESTAMPTZ,
  responded_at     TIMESTAMPTZ,
  ended_by         UUID,
  is_mine          BOOLEAN,
  is_owner         BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ws  UUID := public.current_workspace_id();
BEGIN
  -- Membership from the LIVE row (definer bypasses RLS, so the function
  -- re-checks itself: the 0010/0021 convention).
  IF v_uid IS NULL OR v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;

  RETURN QUERY
  SELECT s.id,
         s.subject_id,
         -- live while the share is live, or for the subject's owner; the
         -- snapshot after
         CASE WHEN src.owner_id = v_uid OR s.status IN ('pending', 'accepted')
              THEN sub.title ELSE s.subject_title END,
         CASE WHEN src.owner_id = v_uid OR s.status IN ('pending', 'accepted')
              THEN sub.is_stub ELSE NULL END,
         -- the course's identity: the owner's, or the receiver's once accepted
         CASE WHEN src.owner_id = v_uid OR s.status = 'accepted'
              THEN src.id ELSE NULL END,
         CASE WHEN src.owner_id = v_uid OR s.status IN ('pending', 'accepted')
              THEN src.name ELSE s.course_name END,
         CASE WHEN src.owner_id = v_uid OR s.status = 'accepted'
              THEN src.slug ELSE NULL END,
         CASE WHEN src.owner_id = v_uid OR s.status = 'accepted'
              THEN src.course_type ELSE NULL END,
         CASE WHEN src.owner_id = v_uid OR s.status = 'accepted'
              THEN src.skill_level ELSE NULL END,
         s.shared_by,
         COALESCE(wb.display_name, wb.username),
         s.shared_with,
         COALESCE(ww.display_name, ww.username),
         s.subject_owner_id,
         COALESCE(wo.display_name, wo.username),
         s.batch_id,
         s.via_share_id,
         s.chain_depth,
         s.status,
         CASE
           WHEN s.status IN ('pending', 'accepted')
                AND (sub.deleted_at IS NOT NULL
                     OR src.deleted_at IS NOT NULL
                     OR src.owner_id IS DISTINCT FROM s.subject_owner_id
                     OR (s.via_share_id IS NOT NULL
                         AND NOT COALESCE(par.status = 'accepted'
                                          AND par.subject_id  = s.subject_id
                                          AND par.shared_with = s.shared_by
                                          AND par.chain_depth = s.chain_depth - 1, false)))
             THEN 'gone'
           ELSE s.status
         END,
         s.message,
         -- the receiver's course is theirs: nobody else gets these two
         CASE WHEN s.shared_with = v_uid THEN s.host_course_id ELSE NULL END,
         CASE WHEN s.shared_with = v_uid
              THEN (s.host_course_id IS NOT NULL AND EXISTS (
                      SELECT 1 FROM public.otter_courses h
                       WHERE h.id = s.host_course_id AND h.deleted_at IS NULL))
              ELSE NULL END,
         s.created_at,
         s.responded_at,
         s.ended_by,
         (s.shared_by = v_uid),
         (src.owner_id = v_uid)
    FROM public.otter_subject_shares s
    JOIN public.otter_subjects sub ON sub.id = s.subject_id
    JOIN public.otter_courses  src ON src.id = sub.course_id
    LEFT JOIN public.otter_subject_shares par
           ON par.id = s.via_share_id
    LEFT JOIN public.workspace_members wb
           ON wb.workspace_id = s.workspace_id AND wb.user_id = s.shared_by
    LEFT JOIN public.workspace_members ww
           ON ww.workspace_id = s.workspace_id AND ww.user_id = s.shared_with
    LEFT JOIN public.workspace_members wo
           ON wo.workspace_id = s.workspace_id AND wo.user_id = s.subject_owner_id
   WHERE s.workspace_id = v_ws
     -- the belt: nothing of another workspace is listed, whatever the row says
     AND sub.workspace_id = s.workspace_id
     AND src.workspace_id = s.workspace_id
     AND (
       -- the owner of the subject, read live: every row of their subject
       src.owner_id = v_uid
       -- a party to the row: their own rows, unless the row is a live onward
       -- row under a link that is not accepted (a row the functions could not
       -- have made)
       OR ((s.shared_by = v_uid OR s.shared_with = v_uid)
           AND (s.via_share_id IS NULL
                OR s.status IN ('declined', 'revoked')
                OR (par.status = 'accepted'
                    AND par.subject_id  = s.subject_id
                    AND par.shared_with = s.shared_by
                    AND par.chain_depth = s.chain_depth - 1)))
     )
   ORDER BY s.created_at DESC, s.chain_depth, s.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_subject_shares_index() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_subject_shares_index() TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_subject_shares_index IS
  '0100: every subject share the caller made, received, or owns the subject of, in their active workspace: the live subject title and course identity while it is pending or accepted (the owner always), the snapshots taken at share time once it is settled, the three labels (sharer, receiver, owner), the batch and the link above (batch_id, via_share_id, chain_depth), the derived state (gone when the source is trashed, changed hands, or the link above is not accepted) and, for the receiver, whether their host course is live. Nothing of another workspace. Backs the Requests view, the linked rows, the owner''s chain line and the pet''s index.';

-- ── 12. Post-conditions ──────────────────────────────────────────────────────

DO $$
DECLARE
  t    TEXT;
  n    INTEGER;
  body TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class
                  WHERE oid = 'public.otter_subject_shares'::regclass
                    AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION '0100 post-condition failed: RLS must be enabled AND forced on otter_subject_shares';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'otter_subject_shares';
  IF n <> 1 THEN
    RAISE EXCEPTION '0100 post-condition failed: expected exactly 1 policy (SELECT), found %', n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'otter_subject_shares'
                AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION '0100 post-condition failed: the share table admits a write policy; writes go through the functions';
  END IF;
  -- The owner's arm is in the policy, and it reads the row's column, never a
  -- subquery on the table itself (which would recurse at run time).
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'otter_subject_shares'
                    AND qual LIKE '%subject_owner_id%'
                    AND qual NOT LIKE '%otter_subject_shares%') THEN
    RAISE EXCEPTION '0100 post-condition failed: otter_subject_share_select must admit the subject''s owner by column and never read its own table';
  END IF;

  IF has_table_privilege('anon', 'public.otter_subject_shares', 'SELECT')
     OR has_table_privilege('anon', 'public.otter_subject_shares', 'INSERT')
     OR has_table_privilege('anon', 'public.otter_subject_shares', 'UPDATE')
     OR has_table_privilege('anon', 'public.otter_subject_shares', 'DELETE') THEN
    RAISE EXCEPTION '0100 post-condition failed: anon holds a privilege on otter_subject_shares';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.otter_subject_shares', 'SELECT')
     OR has_table_privilege('authenticated', 'public.otter_subject_shares', 'INSERT')
     OR has_table_privilege('authenticated', 'public.otter_subject_shares', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.otter_subject_shares', 'DELETE') THEN
    RAISE EXCEPTION '0100 post-condition failed: authenticated must hold SELECT and nothing else on otter_subject_shares';
  END IF;

  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema='public' AND table_name='otter_subject_shares'
         AND column_name='workspace_id') IS DISTINCT FROM 'current_workspace_id()' THEN
    RAISE EXCEPTION '0100 post-condition failed: workspace_id must default to current_workspace_id()';
  END IF;
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema='public' AND table_name='otter_subject_shares'
         AND column_name='shared_by') IS DISTINCT FROM 'auth.uid()' THEN
    RAISE EXCEPTION '0100 post-condition failed: shared_by must default to auth.uid()';
  END IF;

  -- The chain's columns, its CHECK and its FK (a child row never outlives its
  -- parent row: confdeltype c is CASCADE).
  FOREACH t IN ARRAY ARRAY['batch_id', 'via_share_id', 'subject_owner_id', 'chain_depth']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='otter_subject_shares'
                      AND column_name = t) THEN
      RAISE EXCEPTION '0100 post-condition failed: column % missing', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_chain_chk' AND contype = 'c') THEN
    RAISE EXCEPTION '0100 post-condition failed: otter_subject_share_chain_chk missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_via_fkey'
                    AND contype = 'f' AND confdeltype = 'c') THEN
    RAISE EXCEPTION '0100 post-condition failed: otter_subject_share_via_fkey missing or not ON DELETE CASCADE';
  END IF;

  -- The link arm landed AND 0022's inheritance rule survived it.
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='otter_subjects' AND cmd='SELECT'
                    AND qual LIKE '%otter_has_accepted_subject_share%') THEN
    RAISE EXCEPTION '0100 post-condition failed: the subject-link arm is missing from otter_subjects_select';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='otter_subjects' AND cmd='SELECT'
                    AND qual LIKE '%otter_courses%') THEN
    RAISE EXCEPTION '0100 post-condition failed: 0022 course inheritance was dropped from otter_subjects_select';
  END IF;
  -- A linked subject must stay READ-only: the update policy is untouched.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='public' AND tablename='otter_subjects' AND cmd='UPDATE'
                AND (qual LIKE '%otter_has_accepted_subject_share%'
                     OR with_check LIKE '%otter_has_accepted_subject_share%')) THEN
    RAISE EXCEPTION '0100 post-condition failed: the link arm leaked into otter_subjects_update';
  END IF;
  -- The admin-bypass rule 0022/0025/0026/0064 all defend, now on three tables.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='public'
                AND tablename IN ('otter_courses','otter_subjects','otter_progress')
                AND cmd='SELECT' AND qual LIKE '%current_app_role%') THEN
    RAISE EXCEPTION '0100 post-condition failed: admin bypass leaked into a personal-content SELECT policy';
  END IF;

  FOREACH t IN ARRAY ARRAY['otter_subject_share(uuid,uuid,text)',
                           'otter_subject_share_course(uuid,uuid,text)',
                           'otter_subject_share_make(uuid,uuid,text,uuid)',
                           'otter_subject_share_accept(uuid)',
                           'otter_subject_share_decline(uuid)',
                           'otter_subject_share_revoke(uuid)',
                           'otter_subject_shares_index()',
                           'otter_has_accepted_subject_share(uuid)',
                           'fn_otter_subject_share_guard()']
  LOOP
    IF to_regprocedure('public.' || t) IS NULL THEN
      RAISE EXCEPTION '0100 post-condition failed: function % missing', t;
    END IF;
    -- anon is a member of PUBLIC, so a PUBLIC grant shows here too.
    IF has_function_privilege('anon', 'public.' || t, 'EXECUTE') THEN
      RAISE EXCEPTION '0100 post-condition failed: % is executable by anon or PUBLIC', t;
    END IF;
  END LOOP;
  -- The two internal functions are executable by no client role.
  FOREACH t IN ARRAY ARRAY['fn_otter_subject_share_guard()',
                           'otter_subject_share_make(uuid,uuid,text,uuid)']
  LOOP
    IF has_function_privilege('authenticated', 'public.' || t, 'EXECUTE') THEN
      RAISE EXCEPTION '0100 post-condition failed: % is executable by authenticated', t;
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['trg_otter_subject_share_audit', 'trg_otter_subject_share_guard']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.otter_subject_shares'::regclass
                      AND tgname = t AND NOT tgisinternal) THEN
      RAISE EXCEPTION '0100 post-condition failed: trigger % missing', t;
    END IF;
  END LOOP;

  -- The guard is BEFORE, FOR EACH ROW, for INSERT and for UPDATE: tgtype bits
  -- 1 (row), 2 (before), 4 (insert), 16 (update). Its name alone proves none.
  SELECT tgtype INTO n FROM pg_trigger
   WHERE tgrelid = 'public.otter_subject_shares'::regclass
     AND tgname = 'trg_otter_subject_share_guard';
  IF n IS NULL OR (n & 23) <> 23 THEN
    RAISE EXCEPTION '0100 post-condition failed: trg_otter_subject_share_guard is not BEFORE INSERT OR UPDATE FOR EACH ROW (tgtype %)', n;
  END IF;

  -- The policy kept its own guards, not only the new arm.
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='otter_subjects' AND cmd='SELECT'
                    AND qual LIKE '%has_active_membership%'
                    AND qual LIKE '%deleted_at IS NULL%') THEN
    RAISE EXCEPTION '0100 post-condition failed: otter_subjects_select lost has_active_membership or deleted_at IS NULL';
  END IF;

  -- One LIVE share per subject and person: the partial unique index, with its
  -- predicate (a plain unique index would refuse every re-share after a decline).
  SELECT indexdef INTO body FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'otter_subject_share_live_uidx';
  IF body IS NULL OR body NOT LIKE 'CREATE UNIQUE INDEX%' OR body NOT LIKE '%WHERE%'
     OR body NOT LIKE '%pending%' OR body NOT LIKE '%accepted%' THEN
    RAISE EXCEPTION '0100 post-condition failed: otter_subject_share_live_uidx is missing, not unique, or lost its predicate';
  END IF;

  -- The arms are in the bodies, with the comments stripped first: a LIKE on
  -- pg_get_functiondef is satisfied by a commented-out arm (0069's lesson).
  -- Block comments first, then line comments, as 0069 does. The markers are
  -- built from chr() so this file holds none inside a string: chr(47) chr(42)
  -- are the slash and the star, chr(45) the dash, chr(10) the newline.
  body := pg_get_functiondef('public.fn_otter_subject_share_guard()'::regprocedure);
  body := regexp_replace(body,
            chr(47) || '[' || chr(42) || '].*?[' || chr(42) || ']' || chr(47), '', 'g');
  body := regexp_replace(body,
            chr(45) || chr(45) || '[^' || chr(10) || ']*', '', 'g');
  IF body NOT LIKE '%wilson.otter_subject_share_insert%'
     OR body NOT LIKE '%wilson.otter_subject_share_update%'
     OR body NOT LIKE '%names a subject of its own workspace%'
     OR body NOT LIKE '%names the owner of its subject%'
     OR body NOT LIKE '%links to the accepted share its sharer holds%'
     OR body !~ 'NEW[.]via_share_id\s*:=\s*OLD[.]via_share_id'
     OR body !~ 'NEW[.]subject_owner_id\s*:=\s*OLD[.]subject_owner_id' THEN
    RAISE EXCEPTION '0100 post-condition failed: the guard trigger lost one of its arms or pins';
  END IF;

  -- The helper walks the chain (the recursion and the root's owner check are
  -- live, not commented out).
  body := pg_get_functiondef('public.otter_has_accepted_subject_share(uuid)'::regprocedure);
  body := regexp_replace(body,
            chr(47) || '[' || chr(42) || '].*?[' || chr(42) || ']' || chr(47), '', 'g');
  body := regexp_replace(body,
            chr(45) || chr(45) || '[^' || chr(10) || ']*', '', 'g');
  IF body NOT LIKE '%WITH RECURSIVE%'
     OR body !~ 'p[.]shared_with\s*=\s*c[.]shared_by'
     OR body !~ 'src[.]owner_id\s*=\s*root[.]shared_by' THEN
    RAISE EXCEPTION '0100 post-condition failed: otter_has_accepted_subject_share lost the chain walk or the root owner check';
  END IF;

  -- The revoke cascades (the walk down and the upstream line are live).
  body := pg_get_functiondef('public.otter_subject_share_revoke(uuid)'::regprocedure);
  body := regexp_replace(body,
            chr(47) || '[' || chr(42) || '].*?[' || chr(42) || ']' || chr(47), '', 'g');
  body := regexp_replace(body,
            chr(45) || chr(45) || '[^' || chr(10) || ']*', '', 'g');
  SELECT count(*) INTO n FROM regexp_matches(body, 'FOR UPDATE', 'g');
  IF n <> 2
     OR body NOT LIKE '%WITH RECURSIVE%'
     OR body NOT LIKE '%upstream%'
     OR body NOT LIKE '%cascaded_from%' THEN
    RAISE EXCEPTION '0100 post-condition failed: otter_subject_share_revoke lost the cascade or a lock (expected exactly 2 live FOR UPDATE locks, found %)', n;
  END IF;

  -- The row-maker locks the whole chain above a new onward row and walks it
  -- (the lock discipline that closes the pass-on / withdraw race; N2b round 1,
  -- finding 1), and keeps the helper as its belt.
  body := pg_get_functiondef('public.otter_subject_share_make(uuid,uuid,text,uuid)'::regprocedure);
  body := regexp_replace(body,
            chr(47) || '[' || chr(42) || '].*?[' || chr(42) || ']' || chr(47), '', 'g');
  body := regexp_replace(body,
            chr(45) || chr(45) || '[^' || chr(10) || ']*', '', 'g');
  SELECT count(*) INTO n FROM regexp_matches(body, 'FOR SHARE', 'g');
  IF n <> 1
     OR body NOT LIKE '%WITH RECURSIVE%'
     OR body NOT LIKE '%otter_has_accepted_subject_share%' THEN
    RAISE EXCEPTION '0100 post-condition failed: otter_subject_share_make lost the chain lock (expected exactly 1 live FOR SHARE, found %), its walk or the helper belt', n;
  END IF;

  -- The functions' owner bypasses RLS (else they could not write the table).
  IF NOT COALESCE((SELECT r.rolbypassrls
                     FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
                    WHERE p.oid = 'public.otter_subject_share_make(uuid,uuid,text,uuid)'::regprocedure), false) THEN
    RAISE EXCEPTION '0100 post-condition failed: otter_subject_share_make is not owned by a BYPASSRLS role';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
