-- =============================================================================
-- 0069_otter_nomination_self_approval_audit.sql
--
-- Track A, bundle A4. Audrey's decision 36: *allow self-approval, with an audit
-- line saying they approved their own.*
--
-- A manager may nominate their own course and approve it in the same sitting.
-- otter_nomination_apply (0064) checks the caller's ROLE, never authorship, and
-- the UI only hides the decide controls on your own row — the route was always
-- open. Audrey has ruled that this stays open: a manager already holds the
-- authority to promote a course by hand, so refusing here would move the work
-- rather than prevent it. What was missing is the RECORD.
--
-- So this migration changes no authorisation. It adds one thing: when the
-- nominator is the caller, an `app_events` row with the new code **WIL-4108**.
--
-- ⚠️ THE AUDIT WRITE IS NOT BEST-EFFORT. It is inside the same transaction as
--    the promotion and deliberately allowed to raise. A self-promotion whose
--    record failed to write is precisely the outcome this decision exists to
--    prevent, so the promotion rolls back with it. This is the opposite of the
--    swallow-and-continue used for telemetry elsewhere, and it is a choice.
--
-- 🚨 RE-RUN ORDER. This file REPLACES an object created by
--    0064_otter_course_nominations.sql. The version-ordered runner is safe
--    (0064 then 0069). A BY-HAND replay of 0064 after this file silently
--    reverts the audit line while both files' post-conditions still pass. The
--    same warning is written into 0064's header. (The trap 0022/0025 set.)
--
-- 🚨 WHY THE WHOLE BODY IS RESTATED. 0059 became a live privilege escalation by
--    dropping arms during a CREATE OR REPLACE. There is no partial edit of a
--    plpgsql function: the body given here is the whole function. It was not
--    retyped — it was generated from 0064's own text, and the preflight below
--    refuses to run if what is deployed is not the shape this file expects.
--
-- Applied by hand (never `db push`; 0065 is deliberately unapplied):
--   supabase db query --linked --file supabase/migrations/0069_...sql
--
-- pgTAP: 70_otter_course_nominations.sql (extended, not a new suite — one suite
-- per table, and nominations already have 70). Suite 73 stays free.
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── 1. Preflight: refuse to overwrite a shape we do not recognise ────────────
--
-- Counted, not merely present. A commented-out arm still appears in
-- pg_get_functiondef, so the counts below are taken AFTER stripping both
-- comment forms — a block comment hiding an arm satisfies a naive LIKE, which
-- is how two real arms were deleted on dev with every instrument green.

DO $preflight$
DECLARE
  def   TEXT;
  bare  TEXT;
  n     INTEGER;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'otter_nomination_apply';

  IF def IS NULL THEN
    RAISE EXCEPTION '0069 preflight failed: otter_nomination_apply is not deployed — apply 0064 first';
  END IF;

  -- Strip /* */ first, then line comments, so a `--` inside a block comment
  -- cannot leave a dangling fragment.
  bare := regexp_replace(def,  '/\*.*?\*/', '', 'gs');
  bare := regexp_replace(bare, '--[^\n]*',  '', 'g');

  IF bare LIKE '%WIL-4108%' THEN
    RAISE NOTICE '0069: WIL-4108 already present — this is a re-run, continuing';
  END IF;

  SELECT count(*) INTO n FROM regexp_matches(bare, 'RAISE EXCEPTION', 'g');
  IF n < 11 THEN
    RAISE EXCEPTION '0069 preflight failed: expected at least 11 live RAISE arms in otter_nomination_apply, found % — refusing to replace an unrecognised body', n;
  END IF;

  SELECT count(*) INTO n FROM regexp_matches(bare, 'FOR UPDATE', 'g');
  IF n <> 3 THEN
    RAISE EXCEPTION '0069 preflight failed: expected 3 live FOR UPDATE locks, found %', n;
  END IF;

  SELECT count(*) INTO n FROM regexp_matches(bare, 'set_config', 'g');
  IF n <> 5 THEN
    RAISE EXCEPTION '0069 preflight failed: expected 5 live set_config calls, found %', n;
  END IF;

  -- The two GUCs are what authorise a visibility change; losing either turns
  -- the promotion into a silent no-op via the pin trigger.
  IF bare NOT LIKE '%wilson.otter_nomination_promote%'
     OR bare NOT LIKE '%wilson.otter_nomination_apply%' THEN
    RAISE EXCEPTION '0069 preflight failed: a promotion GUC is missing from the deployed body';
  END IF;

  -- app_events must be able to take the row. The insert below runs as the
  -- function owner; if that owner does not hold BYPASSRLS, app_events_insert
  -- refuses event_type='admin' and every self-approval would fail closed.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_roles r ON r.oid = p.proowner
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'otter_nomination_apply'
       AND r.rolbypassrls
  ) THEN
    RAISE EXCEPTION '0069 preflight failed: otter_nomination_apply is not owned by a BYPASSRLS role, so the WIL-4108 insert would be refused by app_events_insert';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='app_events') THEN
    RAISE EXCEPTION '0069 preflight failed: app_events missing — apply 0021 first';
  END IF;
END
$preflight$;

-- ── 2. The function, whole ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.otter_nomination_apply(p_nomination_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_ws         UUID := public.current_workspace_id();
  v_role       TEXT;
  v_nom        public.otter_course_nominations%ROWTYPE;
  v_course     public.otter_courses%ROWTYPE;
  v_incumbent  public.otter_courses%ROWTYPE;
  v_clash      TEXT;
  v_after      TEXT;
BEGIN
  SELECT wm.app_role INTO v_role
    FROM public.workspace_members wm
   WHERE wm.workspace_id = v_ws
     AND wm.user_id = v_uid
     AND wm.is_active;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;
  IF v_role NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'only an admin or a manager may approve a nomination';
  END IF;

  -- Lock the nomination: two approvers acting concurrently must serialize, and
  -- the loser must see a settled nomination rather than double-apply.
  SELECT * INTO v_nom
    FROM public.otter_course_nominations
   WHERE id = p_nomination_id
     FOR UPDATE;

  IF v_nom.id IS NULL OR v_nom.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'nomination not found in this workspace';
  END IF;
  IF v_nom.status <> 'open' THEN
    RAISE EXCEPTION 'nomination is % — only an open nomination can be approved', v_nom.status;
  END IF;

  -- Lock the course too: the incumbent search and the promotion must not race
  -- another approval for the same slug.
  SELECT * INTO v_course
    FROM public.otter_courses c
   WHERE c.id = v_nom.course_id
     AND c.deleted_at IS NULL
     FOR UPDATE;
  IF v_course.id IS NULL THEN
    RAISE EXCEPTION 'the nominated course no longer exists';
  END IF;
  IF v_course.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'the nominated course is not in this workspace';
  END IF;
  IF v_course.owner_id IS DISTINCT FROM v_nom.proposed_by THEN
    RAISE EXCEPTION 'the nominated course is no longer owned by the proposer';
  END IF;
  IF v_course.visibility = 'company_standard' THEN
    RAISE EXCEPTION 'this course is already the company standard';
  END IF;

  -- ⚠️ The slug is not the topic. A same-NAME standard on a DIFFERENT slug will
  -- not collide with the unique index, so approving would silently produce two
  -- live standards for one topic. Refuse loudly instead — see the header.
  SELECT c.name INTO v_clash
    FROM public.otter_courses c
   WHERE c.workspace_id = v_ws
     AND c.deleted_at IS NULL
     AND c.visibility = 'company_standard'
     AND c.slug <> v_course.slug
     AND lower(c.name) = lower(v_course.name)
   LIMIT 1;
  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'there is already a company standard called "%" under a different identifier — rename one of them, or approve a copy forked from the existing standard', v_clash;
  END IF;

  -- Demote the incumbent for this slug, if any. Demote, never trash: trashing
  -- CASCADEs away every change request ever approved against it.
  SELECT * INTO v_incumbent
    FROM public.otter_courses c
   WHERE c.workspace_id = v_ws
     AND c.slug = v_course.slug
     AND c.visibility = 'company_standard'
     AND c.deleted_at IS NULL
     AND c.id <> v_course.id
     FOR UPDATE;

  IF v_incumbent.id IS NOT NULL THEN
    PERFORM set_config('wilson.otter_nomination_promote', v_incumbent.id::text, true);
    UPDATE public.otter_courses SET visibility = 'shared' WHERE id = v_incumbent.id;

    -- The pin trigger reverts silently rather than raising, so a failed demote
    -- would leave the promotion below to die on 23505 — or worse, succeed
    -- against a stale read. Verify.
    SELECT visibility INTO v_after FROM public.otter_courses WHERE id = v_incumbent.id;
    IF v_after <> 'shared' THEN
      RAISE EXCEPTION 'could not stand down the current standard course — nothing has been changed';
    END IF;
  END IF;

  PERFORM set_config('wilson.otter_nomination_promote', v_course.id::text, true);
  UPDATE public.otter_courses SET visibility = 'company_standard' WHERE id = v_course.id;

  SELECT visibility INTO v_after FROM public.otter_courses WHERE id = v_course.id;
  IF v_after <> 'company_standard' THEN
    RAISE EXCEPTION 'the promotion did not take effect — nothing has been changed';
  END IF;

  -- Clear it before settling the nomination row: this GUC authorises a
  -- visibility change and must not still be live for any later statement in
  -- the caller's transaction.
  PERFORM set_config('wilson.otter_nomination_promote', '', true);

  PERFORM set_config('wilson.otter_nomination_apply', v_nom.id::text, true);
  UPDATE public.otter_course_nominations
     SET status               = 'approved',
         applied_at           = now(),
         applied_by           = v_uid,
         superseded_course_id = v_incumbent.id
   WHERE id = v_nom.id;
  PERFORM set_config('wilson.otter_nomination_apply', '', true);

  -- ── 0069: the self-approval record (Audrey's decision 36) ─────────────────
  --
  -- Placed AFTER the nomination row is settled, so the event exists only for an
  -- approval that actually completed. It is in the same transaction, and it is
  -- allowed to raise: an unrecorded self-promotion is the thing this decision
  -- exists to prevent, so if the record cannot be written the promotion goes
  -- with it.
  --
  -- The row reaches app_events because this function is SECURITY DEFINER owned
  -- by a BYPASSRLS role (asserted in the preflight). app_events_insert refuses
  -- event_type='admin' and WIL-41xx to every client, which is what stops a
  -- member minting audit lines by hand; that policy is not bypassed for anyone
  -- else by this change.
  --
  -- ⚠️ `actor_user_id` is set here AND overwritten by fn_app_events_stamp with
  --    auth.uid(). Same value — v_uid IS auth.uid() — but stated rather than
  --    relied on, because the stamp is the authority and a future caller
  --    reading only this INSERT would otherwise think it were client-supplied.
  --
  -- ⚠️ course_name is bounded. It is the one client-derived field here, the
  --    context CHECK is 8000 characters, and supabase-js reports a CHECK
  --    violation on the error channel rather than throwing — the S15 shape
  --    where an oversized value produces no certificate at all.
  IF v_nom.proposed_by = v_uid THEN
    INSERT INTO public.app_events
      (workspace_id, actor_user_id, event_type, code, severity, message, context)
    VALUES (
      v_ws,
      v_uid,
      'admin',
      'WIL-4108',
      'warning',
      'A nomination was approved by the person who raised it',
      jsonb_build_object(
        'nomination_id',        v_nom.id,
        'course_id',            v_course.id,
        'course_slug',          left(v_course.slug, 200),
        'course_name',          left(v_course.name, 200),
        'approver_app_role',    v_role,
        'superseded_course_id', v_incumbent.id
      )
    );
  END IF;

  RETURN v_course.id;
END;
$$;

-- Restated rather than assumed. CREATE OR REPLACE does preserve grants, but
-- these two lines are the whole access story for this function and a reader
-- should not have to open 0064 to learn it.
REVOKE EXECUTE ON FUNCTION public.otter_nomination_apply(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_nomination_apply(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_nomination_apply IS
  '0064, extended by 0069: approves an open nomination by PROMOTING the course to company_standard, demoting the incumbent standard for that slug to shared first. Refuses when a same-named standard exists under a different slug. Returns the promoted course id. The only path to status=approved. 0069: when the approver is also the nominator the approval is ALLOWED (Audrey, 2026-09-07) and writes a WIL-4108 app_events row in the same transaction.';

-- One line of housekeeping that belongs to A4 rather than to this migration’s own
-- subject. 0025’s COMMENT on otter_cr_apply still ended "reference documents are
-- untouched". That is strictly true OF THE RPC — the merge is client-side, by
-- MASTER_PLAN §6 #29’s design — but it is the first description a reader finds,
-- and read alone it now says the opposite of what the product does.
COMMENT ON FUNCTION public.otter_cr_apply IS
  'Session 13: approves an open change request by APPLYING it (locked #22). Archives the target to a personal copy owned by the approver, then copies the proposer''s live subjects into the target additively (update by slug, insert when absent, never delete), and settles the request. THE RPC ITSELF STILL TOUCHES NO REFERENCE DOCUMENT — but since A4 (2026-09-07, Audrey''s decision 37) the CLIENT merges the fork''s hotkeys, functions, nodes and reference_urls into the standard immediately after this call, reading them BEFORE it because the review window closes on decision. See supabaseOtterAdapter cr.approve and MASTER_PLAN §6 #29. corrections deliberately do not move.';

-- ── 3. Post-conditions ───────────────────────────────────────────────────────
--
-- 🚨 EVERY CHECK HERE IS AGAINST THE COMMENT-STRIPPED BODY, AND COUNTS RATHER
--    THAN MERELY LOOKS. pg_get_functiondef returns the comments, so a naive
--    LIKE is satisfied by an arm that has been commented out — and a presence
--    check is satisfied by a SHADOWING earlier copy, because plpgsql takes the
--    first match. Both mistakes have been made in this repo, one of them twice.

DO $postcheck$
DECLARE
  def   TEXT;
  bare  TEXT;
  n     INTEGER;
  arm   TEXT;
  -- The arms that carry authorisation or atomicity. Losing any one of these is
  -- the 0059 failure: a CREATE OR REPLACE that silently widened access.
  arms  TEXT[] := ARRAY[
    'not_a_workspace_member',
    'only an admin or a manager may approve a nomination',
    'nomination not found in this workspace',
    'only an open nomination can be approved',
    'the nominated course no longer exists',
    'the nominated course is not in this workspace',
    'the nominated course is no longer owned by the proposer',
    'this course is already the company standard',
    'could not stand down the current standard course',
    'the promotion did not take effect'
  ];
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'otter_nomination_apply';

  IF def IS NULL THEN
    RAISE EXCEPTION '0069 post-condition failed: otter_nomination_apply vanished';
  END IF;

  bare := regexp_replace(def,  '/\*.*?\*/', '', 'gs');
  bare := regexp_replace(bare, '--[^\n]*',  '', 'g');

  -- Each arm exactly once: twice means a shadowing copy, and the first match
  -- is the one plpgsql runs.
  FOREACH arm IN ARRAY arms LOOP
    SELECT count(*) INTO n
      FROM regexp_matches(bare, regexp_replace(arm, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'), 'g');
    IF n <> 1 THEN
      RAISE EXCEPTION '0069 post-condition failed: arm "%" appears % times in the live body (expected exactly 1)', arm, n;
    END IF;
  END LOOP;

  SELECT count(*) INTO n FROM regexp_matches(bare, 'FOR UPDATE', 'g');
  IF n <> 3 THEN
    RAISE EXCEPTION '0069 post-condition failed: expected 3 live FOR UPDATE locks, found %', n;
  END IF;

  SELECT count(*) INTO n FROM regexp_matches(bare, 'set_config', 'g');
  IF n <> 5 THEN
    RAISE EXCEPTION '0069 post-condition failed: expected 5 live set_config calls, found %', n;
  END IF;

  -- The new behaviour, also counted once.
  SELECT count(*) INTO n FROM regexp_matches(bare, 'WIL-4108', 'g');
  IF n <> 1 THEN
    RAISE EXCEPTION '0069 post-condition failed: expected exactly 1 live WIL-4108 write, found %', n;
  END IF;

  SELECT count(*) INTO n FROM regexp_matches(bare, 'v_nom\.proposed_by = v_uid', 'g');
  IF n <> 1 THEN
    RAISE EXCEPTION '0069 post-condition failed: the self-approval condition is not in the live body (found %)', n;
  END IF;

  -- 🚨 Decision 36 ALLOWS self-approval. A future edit that "hardens" this into
  --    a refusal would be a behaviour change Audrey did not ask for, and it
  --    would be invisible in a diff of the audit line alone.
  IF bare ~ 'RAISE EXCEPTION[^;]*own nomination' THEN
    RAISE EXCEPTION '0069 post-condition failed: something now REFUSES self-approval — decision 36 allows it and records it';
  END IF;

  -- Still SECURITY DEFINER, still search_path-pinned, still not executable by
  -- anon. A CREATE OR REPLACE that dropped any of these would be the 0059 shape.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname='public' AND p.proname='otter_nomination_apply'
       AND p.prosecdef
       AND p.proconfig @> ARRAY['search_path=public']
  ) THEN
    RAISE EXCEPTION '0069 post-condition failed: otter_nomination_apply must stay SECURITY DEFINER with search_path=public';
  END IF;

  IF has_function_privilege('anon', 'public.otter_nomination_apply(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0069 post-condition failed: anon must not hold EXECUTE';
  END IF;

  -- The reserved-stream policy that makes WIL-4108 trustworthy must still be
  -- there: if a client could write it, the audit line would prove nothing.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='app_events' AND policyname='app_events_insert'
       AND with_check LIKE '%event_type <> ''admin''%'
  ) THEN
    RAISE EXCEPTION '0069 post-condition failed: app_events_insert no longer reserves the admin stream, so WIL-4108 could be forged';
  END IF;
END
$postcheck$;
