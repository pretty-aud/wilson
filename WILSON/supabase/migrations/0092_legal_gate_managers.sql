-- =============================================================================
-- 0092_legal_gate_managers.sql — post-overhaul S4d: Legal files get a gate of
-- their own. Workspace managers see them without taking a project's manager
-- seat; money (invoices, FINANCE, budgets, rates) does NOT widen; and a deleted
-- file's record follows the file's own gate — a Legal file's and an invoice's
-- alike — so members and reviewers see neither.
--
-- AUDREY'S RULINGS (docs/design/POST_OVERHAUL_ANSWERS.md), verbatim:
--   2026-10-01: who sees a Legal file — "same as money files for now." ("for
--     now" ends here.)
--   2026-10-02: "workspace managers can have access to the files that is okay.
--     inherently workspace manager may need to access a folder to review
--     things."
--   2026-10-08, asked who else should see Legal files besides workspace admins
--     and the project's managers: "Also workspace managers, without taking a
--     seat." The LEGAL folder stays hidden from members entirely.
--   2026-10-09 (Legal 1): "keep legal docs and invoices hidden from members
--     and reviewers. admins and managers should have the ability to see it."
--     The controller's reading: a deleted file's record (the `purged`
--     certificate in File activity) follows the file's own gate for BOTH
--     kinds. This narrows ruling 22 (2026-09-04: "deletion records stay
--     visible"), under which every project member saw an invoice's.
--   D8 (2026-09-29): "only project admins can access the budget and versioning
--     of the budget and the timeline" — money does not widen. A workspace
--     manager still reaches invoices and the budget only by taking the
--     project's manager seat (S4b-05, accepted 2026-10-02).
--
-- WHAT THIS DOES
-- --------------
-- 1. ONE Legal predicate, public.can_access_project_legal(project_id) =
--    can_access_project_money(project_id) OR (current_app_role() = 'manager'
--    with 0037's workspace hop — the project is in the caller's own workspace
--    and the caller holds a live membership — and 0072's privacy arm, through
--    0082's one definer-side restatement passes_project_privacy). Never NULL.
--    A workspace manager of ANOTHER workspace is not a manager here (the hop);
--    a workspace manager who is not the creator of a PRIVATE project does not
--    see it at all (0072), so does not see its Legal files either. The
--    privacy arm is on the MANAGER leg: the money half is the money gate,
--    called as it is, with whatever reach it has (a project_members manager
--    seat on a private project reaches that project's money and so its Legal
--    files too — OUTSTANDING S4d-01, older than this file). Copied with the
--    hop are its two known limits: no deleted_at test (a trashed project's
--    LEGAL keys answer to the Legal audience as its INVOICES keys answer to
--    the money audience), and app_role read from the JWT claim (a demoted
--    manager keeps the gate until the token refreshes; the membership row is
--    read live, so a DEACTIVATED one loses it at once).
-- 2. Three classifiers that tell a Legal thing from a money thing, each a
--    SUBSET of its 0088 / 0074 twin so a Legal key is always still LOCKED:
--    file_row_is_legal(flag, path) (a row: not flagged, under LEGAL),
--    rabbit_legal_key(obj) (an object key under projects/{id}/LEGAL/…) and
--    file_event_is_legal(old, new) (an event: either path a Legal key).
-- 3. A Legal file is never an invoice: files_legal_not_financial_chk. Without
--    it a row could be BOTH (the flag and the folder), and the row's gate
--    (the flag: money) and its object's (the folder: Legal) would disagree.
--    The client has refused Legal + financial since S4b; the database now does.
-- 4. Every place 0088 made a LEGAL decision through the money gate now asks
--    the Legal predicate for a LEGAL row, key or event — and the money gate,
--    unchanged, for everything else. S4b's hand-off §3 lists the closures;
--    each is re-pointed here or stated unchanged:
--      a. the four files policies (§3): the arm gains
--         `OR (file_row_is_legal(…) AND can_access_project_legal(project_id))`;
--      b. the sixteen storage policies (§4): the eight money ones on BOTH
--         buckets gain `OR (rabbit_legal_segment(seg) AND
--         can_access_project_legal(project))`; the eight base ones are not
--         restated (LEGAL stays in rabbit_money_segment, so they still refuse
--         every LEGAL key — the AUDIENCE of the segment changes, not the lock);
--      c. log_file_downloaded (§5), reserve_upload_bytes (§5b) and
--         fn_trash_authz (§6): a Legal key or row admits the Legal audience,
--         in the same refusal, with the same words and code;
--      d. edit_history (§8): rows snapshot is_legal beside is_financial — by
--         a verdict function of its own, edit_history_file_is_legal, beside
--         0088's classifier, which keeps its signature so 0088 stays
--         replayable — and edit_history_select admits the Legal audience to
--         a Legal file's history;
--      e. file_events_select (§9): a Legal file's events — the hourly sweep's
--         upload_abandoned certificate included — are the Legal audience's;
--         and Legal 1: the `purged` exception (ruling 22) is GONE. An
--         invoice's certificate is the money audience's, a Legal file's the
--         Legal audience's; a member or reviewer sees neither;
--      f. UNCHANGED, and said so: fn_realtime_broadcast still broadcasts no
--         money row (a Legal row included) — rabbit:project:{id} is one topic
--         for every project reader, so no per-recipient Legal arm is possible;
--         a workspace manager's other window sees a Legal file on its next
--         refresh, as a project manager's does. trg_file_events_money
--         (0088 §9b) still flags every event under a locked folder; the
--         reserved-bytes meter (0088 §5c) still sets aside only the caller's
--         own reservation — neither consults a gate. The quota exemption and
--         files_money_provider_chk ride rabbit_money_segment: a Legal body is
--         still pinned to Supabase and still exempt to 0078's bound.
-- 5. The money predicate is NOT touched: post-condition 12 pins
--    can_access_project_money's body to 0037's (no app-manager leg), and a
--    workspace manager still has no way to an INVOICES or FINANCE key, row,
--    event, history row, reservation or trash RPC — suite 95 probes each.
--
-- MEASURED BEFORE THIS FILE WAS WRITTEN (wilson-dev, 2026-10-09, read-only):
-- 16 files rows (1 invoice), ZERO rows / objects / file_events under LEGAL,
-- zero rows both flagged and under LEGAL, 1 money edit_history row (the
-- invoice's), zero private projects, zero workspace managers. Nothing stored
-- changes gate on apply; the CHECK adds with no violator.
--
-- ORDERING — depends on 0037 (can_access_project_money, called), 0072
-- (projects.is_private — §0 refuses without it), 0082 (passes_project_privacy,
-- called) and 0088 (§0 refuses without it), and restates, from its latest
-- body, something every one of these last defined: 0012 (edit_history_select),
-- 0014 / 0067 / 0082 (fn_trash_authz), 0027 / 0074 (file_events_select), 0038
-- / 0083 / 0088 (the four files policies), 0042 / 0053 (the eight money
-- storage policies), 0047 / 0074 / 0083 / 0088 (log_file_downloaded), 0073 /
-- 0078 / 0083 / 0088 (reserve_upload_bytes), 0088 (the edit-history snapshot
-- trigger and its function). 🚨 After a replay of ANY of them, re-run 0092;
-- its post-conditions are the tripwire for each. What each replay does
-- meanwhile:
--   * 0042 or 0053: the eight money storage policies lose the Legal arm
--     (0042 ALSO drops LEGAL from rabbit_money_segment — every project member
--     can then read every Legal object and row through the base policies,
--     0088's own replay note; re-run 0088, then 0092).
--   * 0027 or 0038: ALSO recreate the rabbit-files BASE storage policies with
--     no LEGAL (or FINANCE) exclusion — every member reads every Legal
--     object; re-run 0042 and 0053 FIRST, then 0088, then 0092 (0088's
--     post-condition 8 and 0092's post-condition 5 refuse meanwhile). 0038
--     and 0083 also put the four files policies back on the flag-only arm (a
--     Legal row opens to every reader — 0088's note).
--   * 0012: edit_history_select loses BOTH arms — every workspace manager
--     reads every invoice's history (money widens; re-run 0088, then 0092).
--   * 0027 or 0074: file_events_select regains ruling 22's purged exception
--     WITHOUT 0088's LEGAL carve-out — a member reads a deleted invoice's AND
--     a deleted Legal file's record again (0027: every event of every
--     invoice and Legal file); 0074 also puts log_file_downloaded back on the
--     flag-only arm (a Legal file's read can be logged by anyone who can
--     read the project); re-run 0074, 0088, then 0092.
--   * 0088: the files policies, the three definer bodies, edit_history_select
--     and file_events_select go back to the money gate — a workspace manager
--     loses the Legal ROWS, history, events, reservations and trash (nothing
--     opens to the wrong person) while keeping the Legal OBJECTS (0088
--     restates no storage policy, so the eight money policies keep 0092's
--     Legal arm); the snapshot trigger stops setting is_legal (fails
--     closed); and file_events_select regains 0088's arm: a deleted
--     INVOICE's record is every member's again while a deleted Legal file's
--     stays hidden. 0088 is replayable after 0092 because 0092 does not
--     change the signature of anything 0088 defines (§8b).
--   * 0014, 0047, 0067, 0073, 0078, 0082: one definer body each goes back to
--     a pre-0088 shape (0088's notes); re-run 0088, then 0092.
--   * 0037: can_access_project_money is restated as itself (post-condition 12
--     pins exactly that); 0072 / 0082: the arm this predicate calls.
--
-- Idempotent: CREATE OR REPLACE / DROP-then-CREATE / ADD COLUMN IF NOT EXISTS
-- / DROP CONSTRAINT IF EXISTS-then-ADD throughout; the is_legal backfill only
-- ever SETS the flag. Apply with
-- `supabase db query --linked --file supabase/migrations/0092_legal_gate_managers.sql`
-- AFTER 0088, never `db push`. pgTAP: 95_legal_gate_managers.sql (new); 90
-- and 78 updated (their workspace-manager and ruling-22 probes flip).
-- =============================================================================


-- =============================================================================
-- 0. GUARDS — before anything changes
-- =============================================================================

DO $$
DECLARE
  v_n INT;
BEGIN
  -- 0a. The counts below read FORCE-RLS tables (0076's guard, kept).
  IF row_security_active('public.files')
     OR row_security_active('public.file_events')
     OR row_security_active('public.edit_history')
     OR row_security_active('storage.objects') THEN
    RAISE EXCEPTION '0092 refused: row security is ACTIVE for role % on a table this migration counts or rewrites; apply as a role that bypasses RLS', current_user;
  END IF;

  -- 0b. 0088 is the premise: LEGAL locked, the classifiers, the fixed-at-add
  --     trigger, the edit-history snapshot and the file_events flagger.
  IF to_regprocedure('public.rabbit_legal_segment(text)') IS NULL
     OR to_regprocedure('public.file_row_is_money(boolean, text)') IS NULL
     OR to_regprocedure('public.edit_history_file_class(uuid, jsonb)') IS NULL
     OR NOT public.rabbit_money_segment('LEGAL')
     -- …and ENABLED: a disabled trg_files_legal_fixed exists and lets a
     -- Legal row be moved out of LEGAL in one UPDATE (review round 2).
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.files'::regclass AND tgname = 'trg_files_legal_fixed' AND tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.edit_history'::regclass AND tgname = 'trg_edit_history_money')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.file_events'::regclass AND tgname = 'trg_file_events_money')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.files'::regclass AND conname = 'files_legal_folder_chk')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'edit_history' AND column_name = 'is_financial') THEN
    RAISE EXCEPTION '0092 refused: 0088_legal_files.sql is not in place (LEGAL not locked, or a 0088 classifier, trigger, CHECK or column is missing) — apply 0088 first';
  END IF;

  -- 0c. 0072's arm and 0082's restatement of it: the privacy hop this
  --     predicate carries must exist to be copied.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'is_private')
     OR NOT EXISTS (SELECT 1 FROM pg_policies
                     WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'projects_select'
                       AND position('is_private' IN qual) > 0)
     OR to_regprocedure('public.passes_project_privacy(uuid)') IS NULL THEN
    RAISE EXCEPTION '0092 refused: 0072 (projects.is_private, the privacy arm of projects_select) or 0082 (passes_project_privacy) is not in place';
  END IF;

  -- 0d. files_legal_not_financial_chk's precondition: no row is BOTH an
  --     invoice (the flag) and Legal (the tag or the folder). Refused by name
  --     rather than by a bare ADD CONSTRAINT failure.
  SELECT count(*) INTO v_n FROM public.files
   WHERE COALESCE(is_financial, false)
     AND (COALESCE(tags @> ARRAY['legal']::text[], false)
          OR public.rabbit_legal_segment(split_part(storage_path, '/', 3)));
  IF v_n > 0 THEN
    RAISE EXCEPTION '0092 refused: % files row(s) are both flagged is_financial and Legal (the legal tag or a LEGAL path). A Legal file is never an invoice; clear the flag or re-add the file first.', v_n;
  END IF;

  -- 0e. Said, not assumed: what this apply will re-point.
  SELECT count(*) INTO v_n FROM public.files
   WHERE public.rabbit_legal_segment(split_part(storage_path, '/', 3));
  RAISE NOTICE '0092: % Legal files row(s) move to the Legal audience (workspace managers included)', v_n;
  SELECT count(*) INTO v_n FROM public.file_events
   WHERE public.rabbit_money_key(old_path) AND public.rabbit_legal_segment((storage.foldername(old_path))[3])
      OR public.rabbit_money_key(new_path) AND public.rabbit_legal_segment((storage.foldername(new_path))[3]);
  RAISE NOTICE '0092: % file_events row(s) name a LEGAL key (now the Legal audience''s)', v_n;
END $$;


-- =============================================================================
-- 1. THE LEGAL PREDICATE, AND THE THREE CLASSIFIERS
-- =============================================================================

-- 1a. Who sees a Legal file. The money gate, OR a workspace manager — with
--     0037's hop copied whole (the project is in the caller's OWN workspace,
--     by the projects row, not the claim; the caller holds a LIVE membership)
--     and 0072's arm through passes_project_privacy (0082: the one restatement
--     of projects_select's privacy arm for SECURITY DEFINER bodies, which
--     bypass RLS and cannot delegate to the policy). 🚨 Never NULL: both halves
--     are COALESCEd, because a NULL from a predicate DENIES in a policy and
--     PASSES in an `IF NOT` (0047's lesson); every definer body below still
--     COALESCEs it again, as 0088 does the money gate (the discipline is the
--     body's). No unstaffed-project opening, like money: Legal fails CLOSED.
CREATE OR REPLACE FUNCTION public.can_access_project_legal(p_project UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(public.can_access_project_money(p_project), false)
      OR COALESCE(
           public.current_app_role() = 'manager'
           AND EXISTS (
                 SELECT 1 FROM public.projects p
                  WHERE p.id = p_project
                    AND p.workspace_id = public.current_workspace_id()
                    AND public.has_active_membership(p.workspace_id)
               )
           AND public.passes_project_privacy(p_project),
           false);
$$;

COMMENT ON FUNCTION public.can_access_project_legal(UUID) IS
  '0092 (post-overhaul S4d) — the Legal gate: TRUE for everyone the money gate admits (a workspace admin of the project''s own workspace, or a project_members row with project_role = manager — can_access_project_money, 0037, called as it is) and ALSO for a workspace-level MANAGER of the project''s own workspace holding a live membership, without a seat (Audrey, 2026-10-08: "Also workspace managers, without taking a seat"); that manager leg carries 0072''s privacy arm (passes_project_privacy, 0082), so a workspace manager who did not create a private project is refused it (the money half has the money gate''s own reach — OUTSTANDING S4d-01). Never NULL. No unstaffed-project opening. Guards a LEGAL files row, object, thumbnail, event, history row, reservation and trash RPC; INVOICES / FINANCE and every money table stay on can_access_project_money.';

REVOKE ALL ON FUNCTION public.can_access_project_legal(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_project_legal(UUID) TO authenticated, service_role;

-- 1b. A LEGAL files row, on both axes: under the LEGAL folder (0088's
--     rabbit_legal_segment, 0050's split_part extractor) and NOT flagged.
--     files_legal_not_financial_chk (§2) makes the second half redundant for
--     every row that can exist; it is here so the classifier fails to the
--     STRICTER gate if that CHECK were ever dropped. A subset of
--     file_row_is_money (post-condition 2). Never NULL.
CREATE OR REPLACE FUNCTION public.file_row_is_legal(p_flag boolean, p_path text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NOT COALESCE(p_flag, false)
     AND public.rabbit_legal_segment(split_part(COALESCE(p_path, ''), '/', 3));
$$;

COMMENT ON FUNCTION public.file_row_is_legal(boolean, text) IS
  '0092: the ONE definition of a Legal-gated files row — the storage path''s third segment is LEGAL (rabbit_legal_segment) and the row is NOT is_financial (a Legal file is never an invoice; files_legal_not_financial_chk). A subset of file_row_is_money, so a Legal row is still a locked one: the four files policies, log_file_downloaded, fn_trash_authz and the edit-history classifier ask it to pick the Legal audience over the money audience. Never NULL.';

REVOKE ALL ON FUNCTION public.file_row_is_legal(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.file_row_is_legal(boolean, text) TO authenticated, service_role;

-- 1c. A LEGAL object key: 0074's rabbit_money_key with the segment narrowed —
--     a row-shaped projects/{id}/LEGAL/… key. A subset of rabbit_money_key.
CREATE OR REPLACE FUNCTION public.rabbit_legal_key(obj_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT COALESCE(
    (storage.foldername(obj_name))[1] = 'projects'
    AND public.rabbit_legal_segment((storage.foldername(obj_name))[3]),
    false);
$$;

COMMENT ON FUNCTION public.rabbit_legal_key(TEXT) IS
  '0092: true when obj_name is a row-shaped Petal key under the LEGAL locked folder (projects/{id}/LEGAL/…, any case). A subset of rabbit_money_key (0074). False — never NULL — for anything else. Read by reserve_upload_bytes and file_event_is_legal.';

REVOKE ALL ON FUNCTION public.rabbit_legal_key(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rabbit_legal_key(TEXT) TO authenticated, service_role;

-- 1d. A LEGAL file event: either path a Legal key (0074's file_event_is_financial
--     shape, without the flag — an event''s flag says money, never which kind).
CREATE OR REPLACE FUNCTION public.file_event_is_legal(p_path_a TEXT, p_path_b TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT public.rabbit_legal_key(p_path_a) OR public.rabbit_legal_key(p_path_b);
$$;

COMMENT ON FUNCTION public.file_event_is_legal(TEXT, TEXT) IS
  '0092: the one definition of a Legal file event — either path a Legal key (rabbit_legal_key). Read by file_events_select to hand a Legal file''s events, its purged certificate and the sweep''s upload_abandoned certificate to the Legal audience. Never NULL.';

REVOKE ALL ON FUNCTION public.file_event_is_legal(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.file_event_is_legal(TEXT, TEXT) TO authenticated, service_role;


-- =============================================================================
-- 2. A LEGAL FILE IS NEVER AN INVOICE
-- =============================================================================
-- Keyed on the tag OR the folder (0088 §3b's belt and braces), with 0050's
-- COALESCE on the flag: a CHECK passes on NULL. DROP then ADD (0085's idiom):
-- a re-run re-validates every row.

ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_legal_not_financial_chk;
ALTER TABLE public.files
  ADD CONSTRAINT files_legal_not_financial_chk
    CHECK (NOT (COALESCE(is_financial, false)
                AND (COALESCE(tags @> ARRAY['legal']::text[], false)
                     OR public.rabbit_legal_segment(split_part(storage_path, '/', 3)))));

COMMENT ON CONSTRAINT files_legal_not_financial_chk ON public.files IS
  '0092: a Legal file (the legal tag, or a LEGAL third path segment) is never is_financial. Since 0092 a Legal row is the Legal audience''s (workspace managers included) and an invoice the money audience''s; a row that was both would be gated one way as a row and the other as an object. The client has refused Legal + financial since S4b; this is the database saying it.';


-- =============================================================================
-- 3. THE FOUR files POLICIES — DROP + CREATE, each from 0088's body
-- =============================================================================
-- 0088's four, word for word, with ONE change in the money arm on all five
-- clauses: `OR (public.file_row_is_legal(is_financial, storage_path) AND
-- public.can_access_project_legal(project_id))`. A row that is money but not
-- Legal (an invoice, a FINANCE mirror) is unchanged: file_row_is_legal is
-- false and only the money gate admits. Never a policy added beside
-- (permissive policies OR together — the S15 CRITICAL).

DROP POLICY IF EXISTS files_select ON public.files;
CREATE POLICY files_select ON public.files
  FOR SELECT USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = files.project_id)
    AND (NOT public.file_row_is_money(is_financial, storage_path)
         OR public.can_access_project_money(project_id)
         OR (public.file_row_is_legal(is_financial, storage_path)
             AND public.can_access_project_legal(project_id)))
  );

DROP POLICY IF EXISTS files_insert ON public.files;
CREATE POLICY files_insert ON public.files
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND (NOT public.file_row_is_money(is_financial, storage_path)
         OR public.can_access_project_money(project_id)
         OR (public.file_row_is_legal(is_financial, storage_path)
             AND public.can_access_project_legal(project_id)))
    -- 0083: the parent must be one the caller can SELECT (projects_select's
    -- four arms, privacy included) — a leaked id is a name, not a write.
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = files.project_id)
  );

DROP POLICY IF EXISTS files_update ON public.files;
CREATE POLICY files_update ON public.files
  FOR UPDATE
  USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND (NOT public.file_row_is_money(is_financial, storage_path)
         OR public.can_access_project_money(project_id)
         OR (public.file_row_is_legal(is_financial, storage_path)
             AND public.can_access_project_legal(project_id)))
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.can_write_project(project_id)
    AND (NOT public.file_row_is_money(is_financial, storage_path)
         OR public.can_access_project_money(project_id)
         OR (public.file_row_is_legal(is_financial, storage_path)
             AND public.can_access_project_legal(project_id)))
    -- 0083: gate the NEW row's parent too (the column-free UPDATE's only gate).
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = files.project_id)
  );

DROP POLICY IF EXISTS files_delete ON public.files;
CREATE POLICY files_delete ON public.files
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND (NOT public.file_row_is_money(is_financial, storage_path)
         OR public.can_access_project_money(project_id)
         OR (public.file_row_is_legal(is_financial, storage_path)
             AND public.can_access_project_legal(project_id)))
  );


-- =============================================================================
-- 4. THE EIGHT MONEY STORAGE POLICIES — DROP + CREATE, from 0042 / 0053
-- =============================================================================
-- Both buckets, the same change: the gate becomes `(can_access_project_money
-- OR (rabbit_legal_segment(seg) AND can_access_project_legal))`. The segment
-- test stays rabbit_money_segment, so LEGAL is as locked as it was and the
-- eight base policies (NOT rabbit_money_segment) are untouched — a Legal
-- object and its thumbnail still move behind ONE lock; what changes is who
-- the lock opens for. 0042's and 0053's own post-conditions still hold:
-- every one of the sixteen names rabbit_money_segment, the eight money ones
-- name can_access_project_money, both UPDATE arms carry WITH CHECK. Names
-- unchanged, so a re-run cannot leave two sets live.

-- 4a. rabbit-files (0042:216-271).
DROP POLICY IF EXISTS rabbit_files_money_select ON storage.objects;
CREATE POLICY rabbit_files_money_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND public.rabbit_money_segment((storage.foldername(name))[3])
    AND (public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
         OR (public.rabbit_legal_segment((storage.foldername(name))[3])
             AND public.can_access_project_legal(public.fn_try_uuid((storage.foldername(name))[2]))))
  );

DROP POLICY IF EXISTS rabbit_files_money_insert ON storage.objects;
CREATE POLICY rabbit_files_money_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND public.rabbit_money_segment((storage.foldername(name))[3])
    AND (public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
         OR (public.rabbit_legal_segment((storage.foldername(name))[3])
             AND public.can_access_project_legal(public.fn_try_uuid((storage.foldername(name))[2]))))
  );

DROP POLICY IF EXISTS rabbit_files_money_update ON storage.objects;
CREATE POLICY rabbit_files_money_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND public.rabbit_money_segment((storage.foldername(name))[3])
    AND (public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
         OR (public.rabbit_legal_segment((storage.foldername(name))[3])
             AND public.can_access_project_legal(public.fn_try_uuid((storage.foldername(name))[2]))))
  )
  WITH CHECK (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND public.rabbit_money_segment((storage.foldername(name))[3])
    AND (public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
         OR (public.rabbit_legal_segment((storage.foldername(name))[3])
             AND public.can_access_project_legal(public.fn_try_uuid((storage.foldername(name))[2]))))
  );

DROP POLICY IF EXISTS rabbit_files_money_delete ON storage.objects;
CREATE POLICY rabbit_files_money_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND public.rabbit_money_segment((storage.foldername(name))[3])
    AND (public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
         OR (public.rabbit_legal_segment((storage.foldername(name))[3])
             AND public.can_access_project_legal(public.fn_try_uuid((storage.foldername(name))[2]))))
  );

-- 4b. rabbit-thumbnails (0053:179-228). An invoice's thumbnail is a legible
--     picture of the invoice; a Legal file's is a legible picture of the page.
DROP POLICY IF EXISTS rabbit_thumbnails_money_select ON storage.objects;
CREATE POLICY rabbit_thumbnails_money_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'rabbit-thumbnails'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND public.rabbit_money_segment((storage.foldername(name))[3])
    AND (public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
         OR (public.rabbit_legal_segment((storage.foldername(name))[3])
             AND public.can_access_project_legal(public.fn_try_uuid((storage.foldername(name))[2]))))
  );

DROP POLICY IF EXISTS rabbit_thumbnails_money_insert ON storage.objects;
CREATE POLICY rabbit_thumbnails_money_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'rabbit-thumbnails'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND public.rabbit_money_segment((storage.foldername(name))[3])
    AND (public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
         OR (public.rabbit_legal_segment((storage.foldername(name))[3])
             AND public.can_access_project_legal(public.fn_try_uuid((storage.foldername(name))[2]))))
  );

DROP POLICY IF EXISTS rabbit_thumbnails_money_update ON storage.objects;
CREATE POLICY rabbit_thumbnails_money_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'rabbit-thumbnails'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND public.rabbit_money_segment((storage.foldername(name))[3])
    AND (public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
         OR (public.rabbit_legal_segment((storage.foldername(name))[3])
             AND public.can_access_project_legal(public.fn_try_uuid((storage.foldername(name))[2]))))
  )
  WITH CHECK (
    bucket_id = 'rabbit-thumbnails'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND public.rabbit_money_segment((storage.foldername(name))[3])
    AND (public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
         OR (public.rabbit_legal_segment((storage.foldername(name))[3])
             AND public.can_access_project_legal(public.fn_try_uuid((storage.foldername(name))[2]))))
  );

DROP POLICY IF EXISTS rabbit_thumbnails_money_delete ON storage.objects;
CREATE POLICY rabbit_thumbnails_money_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'rabbit-thumbnails'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND public.rabbit_money_segment((storage.foldername(name))[3])
    AND (public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
         OR (public.rabbit_legal_segment((storage.foldername(name))[3])
             AND public.can_access_project_legal(public.fn_try_uuid((storage.foldername(name))[2]))))
  );


-- =============================================================================
-- 5. log_file_downloaded — a Legal row admits the Legal audience (0088's body)
-- =============================================================================
-- 0088's body word for word; the money arm of the one refusal gains the Legal
-- clause. Same message for every shape, so existence still does not leak.

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
     -- 0083: the fourth arm of projects_select (0072) — the project must be
     -- one this caller can SEE, through 0082's one definer-side restatement.
     OR NOT COALESCE(public.passes_project_privacy(v_file.project_id), false)
     -- The 0038 money arm, replicated: files_select hides money rows from
     -- non-money members, so this RPC must refuse them too. 0088: on BOTH
     -- axes (file_row_is_money). 0092: a LEGAL row (file_row_is_legal) is
     -- the Legal audience's — a workspace manager without a seat logs a read
     -- of a Legal file and is still refused an invoice.
     -- 🚨 The COALESCEs are load-bearing (0074's probe 29): for a claim-less
     -- non-manager a gate is NULL, and an `IF` over NULL fails OPEN.
     OR (public.file_row_is_money(v_file.is_financial, v_file.storage_path)
         AND NOT (COALESCE(public.file_row_is_legal(v_file.is_financial, v_file.storage_path), false)
                  AND COALESCE(public.can_access_project_legal(v_file.project_id), false))
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
     event, old_path, size_bytes, actor_user_id, actor_label, is_financial)
  VALUES
    (v_file.workspace_id, v_file.project_id, v_file.id, v_file.name,
     v_file.storage_provider::text, 'downloaded', v_file.storage_path,
     v_file.size_bytes, v_actor, v_label,
     -- Track C / 0074: a read of a money file is money history (a LEGAL key
     -- is flagged by its path through rabbit_money_key).
     public.file_event_is_financial(v_file.is_financial, v_file.storage_path, NULL));

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_file_downloaded(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.log_file_downloaded(UUID) TO authenticated;

COMMENT ON FUNCTION public.log_file_downloaded(UUID) IS
  'S33 (TPN-CONT-008/TPN-LOG-002, AS-2.9): appends a downloaded event to file_events for a file the caller can read (explicit workspace + membership + live-project + money-arm checks, the private-project arm of projects_select (0072) via passes_project_privacy (0082, since 0083), the money arm on BOTH axes via file_row_is_money (0088), and since 0092 the Legal audience for a Legal row via file_row_is_legal + can_access_project_legal, so a workspace manager logs a read of a Legal file and is still refused an invoice; DEFINER so the table stays append-only). Track C / 0074 flags the event is_financial. Called best-effort by supabaseAdapter.downloadFile; the Local Server twin logs bundle-side in the Express download route.';


-- =============================================================================
-- 5b. reserve_upload_bytes — a LEGAL key admits the Legal audience (0088's body)
-- =============================================================================
-- 0088's body word for word; the first refusal's money arm gains the Legal
-- clause, still before the exemption, same words, same code — so the answer
-- never depends on whether the key exists. An INVOICES / FINANCE key is
-- unchanged: rabbit_legal_key is false and only the money gate admits.

CREATE OR REPLACE FUNCTION public.reserve_upload_bytes(p_path TEXT, p_bytes BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_project  UUID;
  v_ws       UUID;
  v_status   TEXT;
  v_quota    BIGINT;
  v_used     BIGINT;
  v_id       BIGINT;
  v_leaf     TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'reserve_upload_bytes: not signed in'
      USING ERRCODE = '42501';
  END IF;

  IF p_bytes IS NULL OR p_bytes <= 0 THEN
    RAISE EXCEPTION 'reserve_upload_bytes: bytes must be a positive count'
      USING ERRCODE = '22023';
  END IF;

  IF p_path IS NULL
     OR (storage.foldername(p_path))[1] IS DISTINCT FROM 'projects'
     OR char_length(p_path) > 1024 THEN
    RAISE EXCEPTION 'reserve_upload_bytes: not a project object path'
      USING ERRCODE = '22023';
  END IF;

  v_project := public.fn_try_uuid((storage.foldername(p_path))[2]);
  SELECT p.workspace_id INTO v_ws FROM public.projects p WHERE p.id = v_project;

  -- The caller must be a member of the workspace their claim names, and the
  -- project must be in it. Same shape as rabbit_files_insert (0042). 🚨 0047's
  -- RPC lesson: a NULL from a predicate DENIES in a policy and PASSES in an
  -- `IF NOT`, so every predicate here is COALESCEd to false.
  -- 0083: and the project must be one this caller can SEE — 0072's private-
  -- project arm, restated for definer bodies by passes_project_privacy
  -- (0082). Same message, same code: a private project's existence is not
  -- confirmed by the shape of the refusal.
  -- 0088 (review round 1, S1-SEC-02): and a key under a LOCKED folder
  -- (INVOICES / FINANCE / LEGAL, rabbit_money_key) needs the money gate —
  -- here, in the first refusal, before the exemption, so the answer is the
  -- same whether or not the key exists. 0092: a LEGAL key (rabbit_legal_key)
  -- is admitted by the Legal gate instead; a money key that is not Legal
  -- still needs the money gate alone.
  IF v_ws IS NULL
     OR v_ws IS DISTINCT FROM public.current_workspace_id()
     OR NOT COALESCE(public.has_active_membership(v_ws), false)
     OR NOT COALESCE(public.passes_project_privacy(v_project), false)
     OR (public.rabbit_money_key(p_path)
         AND NOT (COALESCE(public.rabbit_legal_key(p_path), false)
                  AND COALESCE(public.can_access_project_legal(v_project), false))
         AND NOT COALESCE(public.can_access_project_money(v_project), false)) THEN
    RAISE EXCEPTION 'reserve_upload_bytes: you cannot write to this project'
      USING ERRCODE = '42501';
  END IF;

  -- Money paths and the manifest are exempt from the quota (0055) UP TO
  -- rabbit_quota_exempt_max_bytes() (0078), so they are reservation-exempt on
  -- the same bound: nothing to weigh, nothing to write. Over the bound this
  -- falls through and is weighed like ordinary media. The object itself is
  -- still gated by rabbit_files_money_insert at commit either way.
  IF public.rabbit_quota_exempt_bytes(p_path, p_bytes) THEN
    RETURN NULL;
  END IF;

  IF NOT COALESCE(public.can_write_project(v_project), false) THEN
    RAISE EXCEPTION 'reserve_upload_bytes: you cannot write to this project'
      USING ERRCODE = '42501';
  END IF;

  -- Serialise reservations per workspace: two reserves racing through the
  -- check below would otherwise both pass, which is the hole one layer up.
  PERFORM pg_advisory_xact_lock(hashtext('upload_reservations:' || v_ws::text));

  SELECT COALESCE(pl.status, 'active'),
         COALESCE(pl.quota_bytes, public.storage_free_tier_bytes())
    INTO v_status, v_quota
    FROM public.workspace_storage_plans pl
   WHERE pl.workspace_id = v_ws;
  IF v_status IS NULL THEN
    v_status := 'active';
    v_quota  := public.storage_free_tier_bytes();
  END IF;

  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'Petal cloud storage for this company is suspended — contact Petal.'
      USING ERRCODE = 'PT402';
  END IF;

  -- THE ONE PREDICATE. The policy will re-evaluate exactly this at creation and
  -- at completion; a reservation that lapses cannot admit an over-quota object.
  IF NOT public.rabbit_petal_storage_ok(v_project, p_bytes, p_path) THEN
    v_used := public.workspace_petal_committed_bytes(v_ws)
            + public.workspace_upload_reserved_bytes(v_ws, p_path);
    v_leaf := regexp_replace(p_path, '^.*/', '');
    -- 🚨 NEVER TELL THEM TO DELETE FILES: a cloud delete is soft and the object
    -- holds quota for 30 days (uploadNotices.js says the same, for the same
    -- reason). Two facts, two sentences, as classifyUpload does.
    IF v_used >= v_quota THEN
      RAISE EXCEPTION 'This company has used all % of its Petal cloud storage (uploads in progress count). Contact Petal to raise the plan — deleting files does not free space straight away, because deleted files stay recoverable for 30 days.',
        pg_size_pretty(v_quota)
        USING ERRCODE = 'PT402';
    ELSE
      RAISE EXCEPTION 'Not enough Petal cloud storage for "%": it needs %, but only % of this company''s % is left once uploads already in progress are counted. Add a smaller file, or contact Petal to raise the plan — deleting files does not free space straight away, because deleted files stay recoverable for 30 days.',
        v_leaf, pg_size_pretty(p_bytes), pg_size_pretty(v_quota - v_used), pg_size_pretty(v_quota)
        USING ERRCODE = 'PT402';
    END IF;
  END IF;

  INSERT INTO public.upload_reservations
    (workspace_id, project_id, storage_path, bytes, created_by)
  VALUES
    (v_ws, v_project, p_path, p_bytes, v_uid)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.reserve_upload_bytes(TEXT, BIGINT) IS
  'Session C1 (0073) / Track C 2026-09-09 (0078) / merge review 2026-09-30 (0083) / S4b (0088) / S4d (0092): '
  'reserve quota for an upload before the bytes move. Quota-exempt paths return '
  'NULL and write no row — but only up to rabbit_quota_exempt_max_bytes(); over '
  'that bound a money path is weighed like ordinary media. The first refusal '
  'carries the private-project arm (0083) and, since 0088, the money gate for a '
  'key under a locked folder (INVOICES / FINANCE / LEGAL), so a reservation can '
  'never test whether a money key exists; since 0092 a LEGAL key is admitted by '
  'the Legal gate (can_access_project_legal) instead, in the same refusal.';


-- =============================================================================
-- 6. fn_trash_authz — a Legal row admits the Legal audience (0088's body)
-- =============================================================================
-- 0088's body word for word; the files money arm gains the Legal clause. One
-- refusal, the one an unknown id already gets.

CREATE OR REPLACE FUNCTION public.fn_trash_authz(p_table TEXT, p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws      UUID;
  v_project UUID;
  v_allowed BOOLEAN;
  v_flag    BOOLEAN;
  v_path    TEXT;
BEGIN
  IF p_table NOT IN ('projects','phases','assets','tasks','files',
                     'comments','rate_cards','milestones') THEN
    RAISE EXCEPTION 'not a soft-delete table: %', p_table;
  END IF;

  -- Resolve the row's workspace and (where applicable) project for the
  -- authorization check. rate_cards are workspace-level → no project gate.
  EXECUTE format(
    'SELECT %s, %s FROM public.%I WHERE id = $1',
    CASE WHEN p_table = 'phases'
         THEN '(SELECT p.workspace_id FROM public.projects p WHERE p.id = project_id)'
         ELSE 'workspace_id' END,
    CASE p_table
      WHEN 'projects'   THEN 'id'
      WHEN 'rate_cards' THEN 'NULL::uuid'
      WHEN 'comments'   THEN 'public.fn_comment_project_id(entity_type, entity_id)'
      ELSE 'project_id' END,
    p_table)
    INTO v_ws, v_project
    USING p_id;

  v_allowed := CASE
    WHEN p_table = 'comments' THEN public.can_comment_project(v_project)
    WHEN v_project IS NULL    THEN true  -- rate_cards / dead-end walks
    ELSE public.can_write_project(v_project)
  END;

  -- 0082: the write gates above predate private projects (0072) and know
  -- nothing of them; can_write_project is true for every admin and manager
  -- and for every member of an unstaffed project. A row under a private
  -- project is the creator's and an admin's to trash or restore, and nobody
  -- else's — the same three arms projects_select applies to reading it.
  IF v_project IS NOT NULL AND NOT public.passes_project_privacy(v_project) THEN
    v_allowed := false;
  END IF;

  -- 0088: a money files row (an invoice, a receipt, a Legal file — the flag
  -- or the locked folder) is for the people who can see money. Measured
  -- before this: a plain member trashed and restored an invoice by its id.
  -- 0092: a LEGAL row (file_row_is_legal) is the Legal audience's instead —
  -- a workspace manager trashes and restores a Legal file by id, and is still
  -- refused an invoice.
  IF p_table = 'files' THEN
    SELECT f.is_financial, f.storage_path INTO v_flag, v_path
      FROM public.files f WHERE f.id = p_id;
    IF public.file_row_is_money(v_flag, v_path)
       AND NOT (COALESCE(public.file_row_is_legal(v_flag, v_path), false)
                AND COALESCE(public.can_access_project_legal(v_project), false))
       AND NOT COALESCE(public.can_access_project_money(v_project), false) THEN
      v_allowed := false;
    END IF;
  END IF;

  IF v_ws IS NULL
     OR v_ws IS DISTINCT FROM public.current_workspace_id()
     OR NOT public.has_active_membership(v_ws)
     OR NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'not allowed to soft-delete or restore this row';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_trash_authz(TEXT, UUID)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_trash_authz IS
  'Authorizes a soft-delete or restore for one of the eight soft-delete RABBIT tables (0014''s seven plus milestones, 0067): workspace match, active membership and the project gate — the comment gate for comments, none for workspace-level rate_cards — and, since 0082, the private-project arm of projects_select (0072) for every project-scoped row; since 0088 a money files row (file_row_is_money: invoices, receipts, rates, Legal files) also needs can_access_project_money — and since 0092 a LEGAL row (file_row_is_legal) needs can_access_project_legal instead, so a workspace manager trashes a Legal file and is still refused an invoice. For the projects row itself this gate admits the creator and 0014''s fn_soft_delete_stamp, which runs after it, admits only an admin.';


-- =============================================================================
-- 7. fn_realtime_broadcast — UNCHANGED. Said, not assumed.
-- =============================================================================
-- 0088 §7's files arm returns before broadcasting any money row, a Legal row
-- included, because rabbit:project:{id} is one topic whose join gate is every
-- project reader and a broadcast has no per-recipient filter. The Legal
-- audience is wider than the money audience but still narrower than the
-- topic's, so a Legal row stays off the channel: a workspace manager's other
-- window sees a Legal file on its next load or Refresh, as a project
-- manager's does (OUTSTANDING S4b-03). Post-condition 9 re-asserts 0088's
-- shape so a replay of 0016 / 0061 / 0077 is caught here too.


-- =============================================================================
-- 8. edit_history — a Legal file's history is the Legal audience's
-- =============================================================================

-- 8a. The snapshot column beside 0088's is_financial. NOT NULL DEFAULT false
--     is the truth for every non-files row and every money row that is not
--     Legal.
ALTER TABLE public.edit_history
  ADD COLUMN IF NOT EXISTS is_legal BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.edit_history.is_legal IS
  '0092: for entity_type ''files'', true when the file was a LEGAL row (file_row_is_legal: under the LEGAL folder, not is_financial) at the time of the change, or by every old / new value the diff carries — snapshotted at capture by fn_edit_history_money_snapshot beside is_financial, so it survives the file''s deletion. A flagged row that is also is_legal is read by the Legal audience (can_access_project_legal: workspace managers included); a flagged row that is not is_legal (an invoice) stays the money audience''s. False for every other entity type.';

-- 8b. The Legal verdict — a function of its OWN beside 0088's classifier.
--     edit_history_file_class(uuid, jsonb) keeps 0088's signature (OUT
--     is_money, project_id) and is not restated here: an OUT column cannot
--     be added under CREATE OR REPLACE, and dropping the function to grow it
--     would make 0088 UN-REPLAYABLE after 0092 (its CREATE OR REPLACE would
--     refuse to change the return type), which breaks every replay remedy in
--     the handbook that ends "re-run 0088" (review round 1, finding 1).
--     A 0088 replay after 0092 therefore still runs; it restates the trigger
--     function WITHOUT the line below, so new history rows carry is_legal =
--     false (fails closed: the Legal audience loses history until 0092 is
--     re-run; post-condition 10 is the tripwire).
--
--     The verdict (review round 1, finding 2): a history entry is Legal only
--     when EVERY (flag, path) pair it carries — the file's current row if it
--     still exists, the diff's whole old / new row, and the diff's
--     column-wise is_financial / storage_path values — passes
--     file_row_is_legal (a LEGAL path, no flag), and at least one path was
--     seen. "Any LEGAL path seen" would have called the history of an
--     unflagged FINANCE or INVOICES row Legal, and the Legal arm of
--     edit_history_select would have handed it to every workspace manager.
--     A pair with no path and no true flag (a note-only diff) says nothing
--     and is left out of the vote. DEFINER (it reads files with RLS
--     bypassed: the row may be one the capture's caller cannot see). Fails
--     CLOSED: anything that raises answers NOT Legal, which hides the row
--     from everyone below the money gate.
CREATE OR REPLACE FUNCTION public.edit_history_file_is_legal(p_entity_id UUID, p_diff JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flag      BOOLEAN;
  v_path      TEXT;
  v_found     BOOLEAN;
  v_all_legal BOOLEAN;
  v_any_path  BOOLEAN;
BEGIN
  SELECT f.is_financial, f.storage_path
    INTO v_flag, v_path
    FROM public.files f WHERE f.id = p_entity_id;
  v_found := FOUND;

  SELECT bool_and(public.file_row_is_legal(t.f, t.p)) FILTER (WHERE t.p IS NOT NULL OR COALESCE(t.f, false)),
         bool_or(t.p IS NOT NULL)
    INTO v_all_legal, v_any_path
    FROM (VALUES
      (CASE WHEN v_found THEN v_flag END, CASE WHEN v_found THEN v_path END),
      ((p_diff -> 'new' ->> 'is_financial')::boolean, p_diff -> 'new' ->> 'storage_path'),
      ((p_diff -> 'old' ->> 'is_financial')::boolean, p_diff -> 'old' ->> 'storage_path'),
      ((p_diff -> 'is_financial' ->> 'new')::boolean, p_diff -> 'storage_path' ->> 'new'),
      ((p_diff -> 'is_financial' ->> 'old')::boolean, p_diff -> 'storage_path' ->> 'old')
    ) AS t(f, p);

  RETURN COALESCE(v_all_legal, false) AND COALESCE(v_any_path, false);
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.edit_history_file_is_legal(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edit_history_file_is_legal(UUID, JSONB) TO service_role;

COMMENT ON FUNCTION public.edit_history_file_is_legal(UUID, JSONB) IS
  '0092: whether one files history entry is a LEGAL file''s — every (is_financial, storage_path) pair it carries (the file''s current row, the diff''s old / new rows, the diff''s column-wise values) passes file_row_is_legal and at least one path was seen; false on any error (fails closed). A subset of edit_history_file_class''s is_money (0088), which is NOT restated by 0092 so that 0088 stays replayable. Used by trg_edit_history_money and the 0092 backfill. DEFINER; no client role executes it.';

-- 8c. The snapshot, at capture — 0088's trigger function word for word, plus
--     TWO lines for the Legal column (the verdict, and false in the handler
--     that fails closed). The trigger itself (BEFORE INSERT, WHEN entity_type
--     = 'files') is re-created so a replay of 0088 cannot leave a stale one;
--     post-condition 10 pins its definition whole and the table's trigger
--     list exactly.
CREATE OR REPLACE FUNCTION public.fn_edit_history_money_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.entity_type IS DISTINCT FROM 'files' THEN
    RETURN NEW;
  END IF;
  SELECT c.is_money, c.project_id
    INTO NEW.is_financial, NEW.project_id
    FROM public.edit_history_file_class(NEW.entity_id, NEW.diff) c;
  NEW.is_financial := COALESCE(NEW.is_financial, true);
  NEW.is_legal := COALESCE(public.edit_history_file_is_legal(NEW.entity_id, NEW.diff), false);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  NEW.is_financial := true;
  NEW.is_legal := false;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_edit_history_money_snapshot() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_edit_history_money ON public.edit_history;
CREATE TRIGGER trg_edit_history_money
  BEFORE INSERT ON public.edit_history
  FOR EACH ROW
  WHEN (NEW.entity_type = 'files')
  EXECUTE FUNCTION public.fn_edit_history_money_snapshot();

-- 8d. The history already written: is_legal SET where the verdict says
--     Legal (monotone, like 0088's flag — a Legal path never changes after
--     the row is added, trg_files_legal_fixed); and 0088's own backfill
--     replayed through 0088's classifier, in case a money row was written
--     between the two applies by a writer that bypassed the trigger.
--     🚨 The CURRENT files row votes only for history written at or after
--     its own creation (review round 2, finding 2): a files id is chosen by
--     the client, and a purged invoice's id reused for a Legal row would
--     otherwise let the new row re-label the old invoice's note-only
--     history as Legal. A history row older than the row that now holds the
--     id is judged on its own diff alone.
UPDATE public.edit_history eh
   SET is_financial = eh.is_financial OR c.is_money,
       is_legal     = eh.is_legal OR c.is_legal,
       project_id   = COALESCE(eh.project_id, c.project_id)
  FROM (SELECT x.id, cls.is_money, cls.project_id,
               public.edit_history_file_is_legal(
                 CASE WHEN EXISTS (SELECT 1 FROM public.files f
                                    WHERE f.id = x.entity_id AND f.created_at <= x.created_at)
                      THEN x.entity_id END,
                 x.diff) AS is_legal
          FROM public.edit_history x
         CROSS JOIN LATERAL public.edit_history_file_class(x.entity_id, x.diff) cls
         WHERE x.entity_type = 'files') c
 WHERE c.id = eh.id
   AND (   (c.is_money AND NOT eh.is_financial)
        OR (c.is_legal AND NOT eh.is_legal)
        OR (eh.project_id IS NULL AND c.project_id IS NOT NULL));

-- 8e. The policy: 0012's three arms and 0088's money arm verbatim, then the
--     Legal arm. A flagged row that is Legal is read by a workspace admin,
--     the project's managers, or — through can_access_project_legal — a
--     workspace manager; an invoice's history stays the money audience's.
DROP POLICY IF EXISTS edit_history_select ON public.edit_history;
CREATE POLICY edit_history_select ON public.edit_history
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() IN ('admin', 'manager')
    AND public.has_active_membership(workspace_id)
    -- 0088: the money arm. COALESCE: NULL would deny anyway; say so.
    -- 0092: and the Legal arm, for rows snapshotted is_legal.
    AND (NOT is_financial
         OR public.current_app_role() = 'admin'
         OR COALESCE(public.can_access_project_money(project_id), false)
         OR (is_legal AND COALESCE(public.can_access_project_legal(project_id), false)))
  );

COMMENT ON POLICY edit_history_select ON public.edit_history IS
  '0012 restated by 0088 and 0092: workspace admins and managers read their workspace''s edit history; a files row flagged is_financial (an invoice, receipt or Legal file, snapshotted at capture) is read only by a workspace admin or the project''s managers (can_access_project_money) — or, when it is also is_legal (a Legal file, 0092), by the Legal audience (can_access_project_legal: workspace managers included). Re-run 0092 after any replay of 0012 or 0088.';


-- =============================================================================
-- 9. file_events_select — a Legal file's events are the Legal audience's, and
--    a deleted file's record follows the file's gate (Legal 1)
-- =============================================================================
-- 0074's policy, every arm restated as 0088 did, with TWO changes in the money
-- arm: the Legal arm (file_event_is_legal + can_access_project_legal), and the
-- `purged` exception GONE. Audrey, 2026-10-09: "keep legal docs and invoices
-- hidden from members and reviewers. admins and managers should have the
-- ability to see it." An invoice's deletion certificate is now the money
-- audience's like the invoice's other events (ruling 22 narrowed); a Legal
-- file's is the Legal audience's; a member or reviewer reads neither. The
-- hourly sweep's upload_abandoned certificate for a LEGAL key (a surrogate
-- file_id, new_path under LEGAL) follows the same arm.

DROP POLICY IF EXISTS file_events_select ON public.file_events;
CREATE POLICY file_events_select ON public.file_events
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (
      -- Anyone who can read the project can read its files' history.
      public.can_read_project_topic(project_id)
      -- Admin arm: proof-of-deletion must stay readable after the project
      -- is purged (can_read_project_topic is false once the row is gone).
      OR public.current_app_role() = 'admin'
    )
    -- Track C / 0074 — the money arm. 0092 (Legal 1): a financial row — its
    -- purged certificate included — is for a workspace admin, the project's
    -- managers (can_access_project_money), or, for a Legal file's, the Legal
    -- audience (can_access_project_legal). No other reader, no event.
    AND (
      NOT is_financial
      OR public.current_app_role() = 'admin'
      OR COALESCE(public.can_access_project_money(project_id), false)
      OR (public.file_event_is_legal(old_path, new_path)
          AND COALESCE(public.can_access_project_legal(project_id), false))
    )
  );

COMMENT ON POLICY file_events_select ON public.file_events IS
  'Track C / 0074 restating 0027, then 0088 and 0092: project readers and workspace admins read the stream; a financial row (is_financial — an invoice, receipt or Legal file), its purged certificate INCLUDED (Audrey, 2026-10-09, narrowing ruling 22), is read only by a workspace admin, the project''s managers (can_access_project_money) or — for a Legal file''s (file_event_is_legal) — the Legal audience (can_access_project_legal). Every arm is in this one definition — re-run 0092 after any replay of 0027, 0074 or 0088.';


-- =============================================================================
-- 10. COMMENTS that are now false
-- =============================================================================

COMMENT ON FUNCTION public.rabbit_money_segment(text) IS
  'True when a rabbit-files / rabbit-thumbnails third path segment is a LOCKED folder: INVOICES (invoices and receipts), FINANCE (project rate overrides) and, since 0088, LEGAL (legal documents). The SINGLE source of truth for the reserved-segment list: the eight base storage policies negate it, the eight money policies assert it beside the gate — can_access_project_money, or since 0092 for the LEGAL segment can_access_project_legal (workspace managers see Legal files without a seat; money does not widen) — files_money_provider_chk (0050) pins those bodies to Supabase, rabbit_quota_exempt_path (0055) exempts them up to 0078''s bound, and file_row_is_money (0088) extends it to files ROWS. Case-insensitive and NULL-safe — a path with no third segment (projects/<id>/PROJECT.json) is NOT locked.';

COMMENT ON FUNCTION public.file_row_is_money(boolean, text) IS
  '0088: the ONE definition of a money-gated files row — the is_financial flag OR the storage path''s third segment a locked folder (rabbit_money_segment: INVOICES, FINANCE, LEGAL). Both axes, as 0050''s files_money_provider_chk reads them, because either alone is a way in. Read by the four files policies, log_file_downloaded, fn_trash_authz, fn_realtime_broadcast and the edit-history snapshot; since 0092 each of those asks file_row_is_legal beside it to pick the Legal audience for a Legal row. Never NULL.';

COMMENT ON COLUMN public.files.is_financial IS
  'Marks a file as financial (an invoice or receipt). The ROW is gated by file_row_is_money (0088) — this flag OR a locked third path segment (INVOICES, FINANCE, LEGAL) — in the four files_* policies: readable and writable by can_access_project_money(project_id), or for a LEGAL row (file_row_is_legal, 0092) by can_access_project_legal(project_id). The blob is gated separately by the rabbit_files_money_* storage policies keyed on the same segment (0042, the same two gates since 0092). A Legal file carries false here, and must (files_legal_not_financial_chk, 0092): its folder is its gate.';

COMMENT ON COLUMN public.files.tags IS
  '0085 — the file''s categories, any of nine: Production, Creative, Legal, '
  'Finance, Reference, Assets, Code, Shots, Documentation (stored lower case; '
  'files_tags_known_chk). Several per file, beside document_kind. Finance is '
  'shown from is_financial and never written by the client. Since 0088 Legal '
  'is set when the file is added and never after: the legal tag and a LEGAL '
  'third path segment go together (files_legal_folder_chk), and such a row is '
  'locked (file_row_is_money) — for the Legal audience since 0092 '
  '(can_access_project_legal; never is_financial, files_legal_not_financial_chk). '
  'Starts empty on every row (no backfill).';

COMMENT ON COLUMN public.edit_history.is_financial IS
  '0088: for entity_type ''files'', true when the file was money-gated (file_row_is_money: invoices, receipts, rates, Legal files) at the time of the change, or by any old or new value the diff carries — snapshotted at capture by fn_edit_history_money_snapshot, so it survives the file''s deletion. Non-money readers do not see flagged rows — except, since 0092, the Legal audience for rows also snapshotted is_legal. False for every other entity type.';

COMMENT ON FUNCTION public.passes_project_privacy(UUID) IS
  '0082: the privacy arm of projects_select (0072) — the project is not private, or the caller created it, or the caller is a workspace admin — restated for SECURITY DEFINER bodies, which bypass RLS and cannot delegate to the policy (a SECURITY INVOKER helper called from a definer body runs as the owner). Callers: milestones_trash_index, fn_trash_authz (0082); reserve_upload_bytes, log_file_downloaded (0083); can_access_project_legal (0092). Keep it word-for-word with the policy; suites 82, 83 and 95 and those migrations'' post-conditions pin it. No client role executes it.';


-- =============================================================================
-- 11. POST-CONDITIONS — assert, do not assume
-- =============================================================================
-- Policy and CHECK predicates are compared WHOLE, as Postgres prints them (S4a
-- trap 16: a LIKE lets `OR true` through); deparse- and order-sensitive by
-- design. The two predicates' bodies are compared WHOLE on the RAW source
-- with whitespace collapsed — no comment stripping, which a `/*` inside a
-- string literal can turn into a scalpel (review round 2, finding 4); every
-- must-NOT-contain check below runs on the raw definition for the same
-- reason, and the presence checks on the comment-stripped one (0077 §3c).

DO $$
DECLARE
  t         TEXT;
  v         TEXT;
  v_body    TEXT;
  v_raw     TEXT;
  v_hits    INT;
  v_n       INT;
  v_tgtype  SMALLINT;
  -- The row arm as it prints inside every files policy clause.
  c_arm CONSTANT TEXT := '((NOT file_row_is_money(is_financial, storage_path)) OR can_access_project_money(project_id) OR (file_row_is_legal(is_financial, storage_path) AND can_access_project_legal(project_id)))';
  c_hop CONSTANT TEXT := '(EXISTS ( SELECT 1' || chr(10) || '   FROM projects p' || chr(10) || '  WHERE (p.id = files.project_id)))';
  -- The object gate as it prints inside every money storage policy clause.
  c_obj CONSTANT TEXT := '(can_access_project_money(fn_try_uuid((storage.foldername(name))[2])) OR (rabbit_legal_segment((storage.foldername(name))[3]) AND can_access_project_legal(fn_try_uuid((storage.foldername(name))[2]))))';
  c_seg CONSTANT TEXT := 'rabbit_money_segment((storage.foldername(name))[3])';
BEGIN
  -- 1. The predicate: present, STABLE DEFINER, search_path pinned, callable by
  --    authenticated and not by anon, and its body WHOLE (whitespace
  --    collapsed — a pin by pieces lets an additive leg through; review
  --    round 1, finding 3): the money gate called once, the manager leg with
  --    0037's hop, 0082's privacy restatement, both halves COALESCEd.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.can_access_project_legal(uuid)'::regprocedure
                  AND prosecdef AND provolatile = 's' AND proconfig @> ARRAY['search_path=public']) THEN
    RAISE EXCEPTION '0092 post-condition 1 failed: can_access_project_legal is missing, not SECURITY DEFINER, not STABLE, or its search_path is not pinned';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.can_access_project_legal(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.can_access_project_legal(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0092 post-condition 1 failed: can_access_project_legal must be executable by authenticated and not by anon (and so not PUBLIC)';
  END IF;
  SELECT btrim(regexp_replace(prosrc, '\s+', ' ', 'g'))
    INTO v_body FROM pg_proc WHERE oid = 'public.can_access_project_legal(uuid)'::regprocedure;
  IF v_body IS DISTINCT FROM 'SELECT COALESCE(public.can_access_project_money(p_project), false) OR COALESCE( public.current_app_role() = ''manager'' AND EXISTS ( SELECT 1 FROM public.projects p WHERE p.id = p_project AND p.workspace_id = public.current_workspace_id() AND public.has_active_membership(p.workspace_id) ) AND public.passes_project_privacy(p_project), false);' THEN
    RAISE EXCEPTION '0092 post-condition 1 failed: can_access_project_legal''s body is not the one 0092 wrote — it reads %', v_body;
  END IF;

  -- 2. The classifiers on known inputs, never NULL, each a SUBSET of its twin.
  --    IS NOT TRUE / IS NOT FALSE throughout: `IF NOT f(...)` over a NULL
  --    fails OPEN (0047's lesson; review round 1, finding 3).
  IF public.file_row_is_legal(false, 'projects/p/LEGAL/x/1-a.pdf') IS NOT TRUE
     OR public.file_row_is_legal(false, 'projects/p/legal/x/1-a.pdf') IS NOT TRUE
     OR public.file_row_is_legal(NULL, 'projects/p/LEGAL/x/1-a.pdf') IS NOT TRUE
     OR public.file_row_is_legal(true, 'projects/p/LEGAL/x/1-a.pdf') IS NOT FALSE
     OR public.file_row_is_legal(false, 'projects/p/INVOICES/x/1-a.pdf') IS NOT FALSE
     OR public.file_row_is_legal(false, 'projects/p/FINANCE/RATES.json') IS NOT FALSE
     OR public.file_row_is_legal(true, 'projects/p/project/x/1-a.pdf') IS NOT FALSE
     OR public.file_row_is_legal(false, 'projects/p/ASSETS/x/1-a.pdf') IS NOT FALSE
     OR public.file_row_is_legal(false, 'a-local-file.pdf') IS NOT FALSE
     OR public.file_row_is_legal(NULL, NULL) IS NOT FALSE THEN
    RAISE EXCEPTION '0092 post-condition 2 failed: file_row_is_legal does not read both axes, or returns NULL';
  END IF;
  IF public.rabbit_legal_key('projects/00000000-0000-0000-0000-000000000001/LEGAL/x/1-a.pdf') IS NOT TRUE
     OR public.rabbit_legal_key('projects/00000000-0000-0000-0000-000000000001/legal/x/1-a.pdf') IS NOT TRUE
     OR public.rabbit_legal_key('projects/00000000-0000-0000-0000-000000000001/INVOICES/x/1-a.pdf') IS NOT FALSE
     OR public.rabbit_legal_key('LEGAL/x/1-a.pdf') IS NOT FALSE
     OR public.rabbit_legal_key('files/p/LEGAL/x/1-a.pdf') IS NOT FALSE
     OR public.rabbit_legal_key(NULL) IS NOT FALSE
     OR public.file_event_is_legal(NULL, 'projects/p/LEGAL/x/1-a.pdf') IS NOT TRUE
     OR public.file_event_is_legal('projects/p/LEGAL/x/1-a.pdf', NULL) IS NOT TRUE
     OR public.file_event_is_legal('projects/p/INVOICES/x/1-a.pdf', NULL) IS NOT FALSE
     OR public.file_event_is_legal(NULL, NULL) IS NOT FALSE THEN
    RAISE EXCEPTION '0092 post-condition 2 failed: rabbit_legal_key / file_event_is_legal do not classify the known inputs, or return NULL';
  END IF;
  FOREACH t IN ARRAY ARRAY['projects/p/LEGAL/x/1-a.pdf', 'projects/p/legal/x/1-a.pdf', 'projects/p/Legal/x/1-a.pdf'] LOOP
    IF (public.file_row_is_legal(false, t) IS TRUE AND public.file_row_is_money(false, t) IS NOT TRUE)
       OR (public.rabbit_legal_key(t) IS TRUE AND public.rabbit_money_key(t) IS NOT TRUE) THEN
      RAISE EXCEPTION '0092 post-condition 2 failed: % is Legal but not locked — a Legal key would be readable by every project member', t;
    END IF;
  END LOOP;

  -- 3. The CHECK, whole, and no row breaks it (the ADD would have refused).
  SELECT pg_get_constraintdef(oid) INTO v FROM pg_constraint
   WHERE conrelid = 'public.files'::regclass AND contype = 'c' AND conname = 'files_legal_not_financial_chk';
  IF v IS DISTINCT FROM 'CHECK ((NOT (COALESCE(is_financial, false) AND (COALESCE((tags @> ARRAY[''legal''::text]), false) OR rabbit_legal_segment(split_part(storage_path, ''/''::text, 3))))))' THEN
    RAISE EXCEPTION '0092 post-condition 3 failed: files_legal_not_financial_chk reads %', v;
  END IF;
  -- …and 0088's three CHECKs are still whole (a replay of 0085 drops them).
  SELECT pg_get_constraintdef(oid) INTO v FROM pg_constraint
   WHERE conrelid = 'public.files'::regclass AND contype = 'c' AND conname = 'files_legal_folder_chk';
  IF v IS DISTINCT FROM 'CHECK ((COALESCE((tags @> ARRAY[''legal''::text]), false) = rabbit_legal_segment(split_part(storage_path, ''/''::text, 3))))' THEN
    RAISE EXCEPTION '0092 post-condition 3 failed: files_legal_folder_chk (0088) reads %', v;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v FROM pg_constraint
   WHERE conrelid = 'public.files'::regclass AND contype = 'c' AND conname = 'files_legal_not_core_chk';
  IF v IS DISTINCT FROM 'CHECK ((NOT (is_core_definer AND (COALESCE((tags @> ARRAY[''legal''::text]), false) OR rabbit_legal_segment(split_part(storage_path, ''/''::text, 3))))))' THEN
    RAISE EXCEPTION '0092 post-condition 3 failed: files_legal_not_core_chk (0088) reads %', v;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v FROM pg_constraint
   WHERE conrelid = 'public.files'::regclass AND contype = 'c' AND conname = 'files_money_key_chk';
  IF v IS DISTINCT FROM 'CHECK (((NOT rabbit_money_segment(split_part(storage_path, ''/''::text, 3))) OR rabbit_money_key(storage_path)))' THEN
    RAISE EXCEPTION '0092 post-condition 3 failed: files_money_key_chk (0088) reads %', v;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v FROM pg_constraint
   WHERE conrelid = 'public.files'::regclass AND contype = 'c' AND conname = 'files_money_provider_chk';
  IF v IS DISTINCT FROM 'CHECK (((storage_provider = ''supabase''::storage_provider) OR (NOT (COALESCE(is_financial, false) OR rabbit_money_segment(split_part(storage_path, ''/''::text, 3))))))' THEN
    RAISE EXCEPTION '0092 post-condition 3 failed: files_money_provider_chk (0050) reads % — Legal bodies would no longer be pinned to Supabase', v;
  END IF;

  -- 4. The four files policies: exactly these four, permissive, each clause
  --    WHOLE, the Legal arm on all five clauses; RLS still forced.
  IF (SELECT array_agg(policyname::TEXT ORDER BY policyname) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'files')
     IS DISTINCT FROM ARRAY['files_delete','files_insert','files_select','files_update']::TEXT[] THEN
    RAISE EXCEPTION '0092 post-condition 4 failed: public.files does not have exactly its four policies';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files'
              AND permissive <> 'PERMISSIVE') THEN
    RAISE EXCEPTION '0092 post-condition 4 failed: a files policy is not PERMISSIVE';
  END IF;
  SELECT qual INTO v FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_select';
  IF v IS DISTINCT FROM '((deleted_at IS NULL) AND (workspace_id = current_workspace_id()) AND ' || c_hop || ' AND ' || c_arm || ')' THEN
    RAISE EXCEPTION '0092 post-condition 4 failed: files_select reads %', v;
  END IF;
  SELECT with_check INTO v FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_insert';
  IF v IS DISTINCT FROM '((workspace_id = current_workspace_id()) AND has_active_membership(workspace_id) AND can_write_project(project_id) AND ' || c_arm || ' AND ' || c_hop || ')' THEN
    RAISE EXCEPTION '0092 post-condition 4 failed: files_insert reads %', v;
  END IF;
  SELECT qual INTO v FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_update';
  IF v IS DISTINCT FROM '((workspace_id = current_workspace_id()) AND has_active_membership(workspace_id) AND can_write_project(project_id) AND ' || c_arm || ')' THEN
    RAISE EXCEPTION '0092 post-condition 4 failed: files_update USING reads %', v;
  END IF;
  SELECT with_check INTO v FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_update';
  IF v IS DISTINCT FROM '((workspace_id = current_workspace_id()) AND can_write_project(project_id) AND ' || c_arm || ' AND ' || c_hop || ')' THEN
    RAISE EXCEPTION '0092 post-condition 4 failed: files_update WITH CHECK reads %', v;
  END IF;
  SELECT qual INTO v FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_delete';
  IF v IS DISTINCT FROM '((workspace_id = current_workspace_id()) AND has_active_membership(workspace_id) AND can_write_project(project_id) AND ' || c_arm || ')' THEN
    RAISE EXCEPTION '0092 post-condition 4 failed: files_delete reads %', v;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.files'::regclass
                  AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION '0092 post-condition 4 failed: RLS is no longer enabled and forced on public.files';
  END IF;

  -- 5. The sixteen storage policies: eight per bucket, every one naming
  --    rabbit_money_segment; the eight money ones WHOLE, on both clauses of
  --    the UPDATE ones; the eight base ones unchanged in shape — the segment
  --    negated, no Legal gate, the parent hop; the restrictive quota policy
  --    still restrictive.
  FOREACH t IN ARRAY ARRAY['rabbit\_files%', 'rabbit\_thumbnails%'] LOOP
    SELECT count(*)::int INTO v_n FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE t;
    IF v_n <> 8 THEN
      RAISE EXCEPTION '0092 post-condition 5 failed: % storage policies named %, expected 8', v_n, t;
    END IF;
    SELECT count(*)::int INTO v_n FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE t
       AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%' || c_seg || '%';
    IF v_n <> 8 THEN
      RAISE EXCEPTION '0092 post-condition 5 failed: only % of the 8 % policies read rabbit_money_segment', v_n, t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['rabbit-files', 'rabbit-thumbnails'] LOOP
    v := CASE t WHEN 'rabbit-files' THEN 'rabbit_files' ELSE 'rabbit_thumbnails' END;
    -- select
    IF (SELECT qual FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = v || '_money_select' AND cmd = 'SELECT')
       IS DISTINCT FROM '((bucket_id = ''' || t || '''::text) AND (auth.role() = ''authenticated''::text) AND ((storage.foldername(name))[1] = ''projects''::text) AND ' || c_seg || ' AND ' || c_obj || ')' THEN
      RAISE EXCEPTION '0092 post-condition 5 failed: %_money_select reads %', v,
        (SELECT qual FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = v || '_money_select');
    END IF;
    -- insert
    IF (SELECT with_check FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = v || '_money_insert' AND cmd = 'INSERT')
       IS DISTINCT FROM '((bucket_id = ''' || t || '''::text) AND (auth.role() = ''authenticated''::text) AND ((storage.foldername(name))[1] = ''projects''::text) AND ' || c_seg || ' AND ' || c_obj || ')' THEN
      RAISE EXCEPTION '0092 post-condition 5 failed: %_money_insert reads %', v,
        (SELECT with_check FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = v || '_money_insert');
    END IF;
    -- update, both clauses
    IF (SELECT qual FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = v || '_money_update' AND cmd = 'UPDATE')
       IS DISTINCT FROM '((bucket_id = ''' || t || '''::text) AND (auth.role() = ''authenticated''::text) AND ((storage.foldername(name))[1] = ''projects''::text) AND ' || c_seg || ' AND ' || c_obj || ')'
       OR (SELECT with_check FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = v || '_money_update' AND cmd = 'UPDATE')
       IS DISTINCT FROM '((bucket_id = ''' || t || '''::text) AND (auth.role() = ''authenticated''::text) AND ((storage.foldername(name))[1] = ''projects''::text) AND ' || c_seg || ' AND ' || c_obj || ')' THEN
      RAISE EXCEPTION '0092 post-condition 5 failed: %_money_update reads USING % / WITH CHECK %', v,
        (SELECT qual FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = v || '_money_update'),
        (SELECT with_check FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = v || '_money_update');
    END IF;
    -- delete
    IF (SELECT qual FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = v || '_money_delete' AND cmd = 'DELETE')
       IS DISTINCT FROM '((bucket_id = ''' || t || '''::text) AND (auth.role() = ''authenticated''::text) AND ((storage.foldername(name))[1] = ''projects''::text) AND ' || c_seg || ' AND ' || c_obj || ')' THEN
      RAISE EXCEPTION '0092 post-condition 5 failed: %_money_delete reads %', v,
        (SELECT qual FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = v || '_money_delete');
    END IF;
  END LOOP;
  -- The eight base ones: the segment NEGATED, the parent hop, no gate of
  -- either kind — a base policy that named a gate would be one that opened
  -- a LEGAL key to the gate's audience through the wrong lock.
  SELECT count(*)::int INTO v_n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (policyname LIKE 'rabbit\_files\_%' OR policyname LIKE 'rabbit\_thumbnails\_%')
     AND policyname NOT LIKE '%\_money\_%'
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%(NOT ' || c_seg || ')%'
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%FROM projects p%'
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) NOT LIKE '%can_access_project_%';
  IF v_n <> 8 THEN
    RAISE EXCEPTION '0092 post-condition 5 failed: only % of the eight base storage policies negate rabbit_money_segment, hop to projects and name no gate', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                  AND policyname = 'petal_storage_quota_insert' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION '0092 post-condition 5 failed: petal_storage_quota_insert is missing or no longer RESTRICTIVE';
  END IF;
  -- No OTHER policy on storage.objects names Legal, a Legal classifier or
  -- either gate, and every PERMISSIVE one outside the sixteen that reads a
  -- key's third segment at all NEGATES the locked list the way the base
  -- policies do (0091's bin-poster policies pin the segment to bin_files and
  -- carry that negation; the restrictive ones only narrow): permissive
  -- policies OR together, so one added beside the sixteen under any other
  -- name would be a new door (review round 1, planted fault D10; round 2:
  -- one that selects LEGAL by the segment without the word).
  SELECT string_agg(policyname, ', ') INTO v FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname NOT LIKE 'rabbit\_files\_%'
     AND policyname NOT LIKE 'rabbit\_thumbnails\_%'
     AND (COALESCE(qual, '') || COALESCE(with_check, ''))
         ~* 'legal|rabbit_money_key|can_access_project_money';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION '0092 post-condition 5 failed: a storage.objects policy outside the sixteen names Legal, a Legal classifier or a gate: %', v;
  END IF;
  SELECT string_agg(policyname, ', ') INTO v FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname NOT LIKE 'rabbit\_files\_%'
     AND policyname NOT LIKE 'rabbit\_thumbnails\_%'
     AND permissive = 'PERMISSIVE'
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) ~* 'foldername\(name\)\)\[3\]|split_part\(name'
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) NOT LIKE '%(NOT rabbit_money_segment((storage.foldername(name))[3]))%';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION '0092 post-condition 5 failed: a permissive storage.objects policy outside the sixteen reads a key''s third segment without negating the locked list: %', v;
  END IF;
  SELECT string_agg(policyname, ', ') INTO v FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (policyname LIKE 'rabbit\_files\_%' OR policyname LIKE 'rabbit\_thumbnails\_%')
     AND policyname NOT LIKE '%\_money\_%'
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) ~* 'legal';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION '0092 post-condition 5 failed: a base storage policy names Legal: %', v;
  END IF;

  -- 6. log_file_downloaded: the Legal clause beside 0088's both-axes arm, and
  --    everything 0083 / 0088 pinned. Presence on the comment-stripped body;
  --    the must-not-contain on the RAW one.
  v_raw  := pg_get_functiondef('public.log_file_downloaded(uuid)'::regprocedure);
  v_body := regexp_replace(regexp_replace(v_raw, '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g');
  IF strpos(v_body, 'public.file_row_is_money(v_file.is_financial, v_file.storage_path)') = 0
     OR strpos(v_body, 'AND NOT (COALESCE(public.file_row_is_legal(v_file.is_financial, v_file.storage_path), false)') = 0
     OR strpos(v_body, 'AND COALESCE(public.can_access_project_legal(v_file.project_id), false))') = 0
     OR strpos(v_body, 'NOT COALESCE(public.can_access_project_money(v_file.project_id), false)') = 0
     OR strpos(v_body, 'file_event_is_financial(') = 0
     OR strpos(v_body, 'public.has_active_membership(v_file.workspace_id)') = 0
     OR strpos(v_body, 'p.deleted_at IS NULL') = 0
     OR strpos(v_body, 'file not found or not readable') = 0 THEN
    RAISE EXCEPTION '0092 post-condition 6 failed: log_file_downloaded lost the Legal clause, 0088''s both-axes money arm or one of 0083''s arms';
  END IF;
  IF v_raw ~ 'OR \(v_file\.is_financial\s+AND' THEN
    RAISE EXCEPTION '0092 post-condition 6 failed: log_file_downloaded still carries the flag-only money arm';
  END IF;
  v_hits := (length(v_body) - length(replace(v_body, 'passes_project_privacy(', ''))) / length('passes_project_privacy(');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION '0092 post-condition 6 failed: log_file_downloaded names passes_project_privacy % times (expected 1)', v_hits;
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.log_file_downloaded(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.log_file_downloaded(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0092 post-condition 6 failed: log_file_downloaded grants moved';
  END IF;

  -- 7. fn_trash_authz: 0067's allowlist, 0082's arms, 0088's money arm and the
  --    Legal clause; closed to clients.
  v_raw := pg_get_functiondef('public.fn_trash_authz(text,uuid)'::regprocedure);
  v := substring(v_raw from 'p_table NOT IN \(([^)]*)\)');
  IF v IS NULL OR array_length(string_to_array(v, ','), 1) <> 8 THEN
    RAISE EXCEPTION '0092 post-condition 7 failed: fn_trash_authz''s allowlist is not the eight tables (it reads %)', v;
  END IF;
  v_body := regexp_replace(regexp_replace(v_raw, '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g');
  IF strpos(v_body, 'public.can_write_project(v_project)') = 0
     OR strpos(v_body, 'public.can_comment_project(v_project)') = 0
     OR strpos(v_body, 'public.has_active_membership(v_ws)') = 0
     OR strpos(v_body, 'public.current_workspace_id()') = 0
     OR strpos(v_body, 'public.file_row_is_money(v_flag, v_path)') = 0
     OR strpos(v_body, 'AND NOT (COALESCE(public.file_row_is_legal(v_flag, v_path), false)') = 0
     OR strpos(v_body, 'AND COALESCE(public.can_access_project_legal(v_project), false))') = 0
     OR strpos(v_body, 'NOT COALESCE(public.can_access_project_money(v_project), false)') = 0
     -- Nothing in the body ever GRANTS: v_allowed is set by the CASE and then
     -- only ever lowered (review round 1, planted fault D11) — checked on the
     -- RAW definition, where a literal cannot hide it (round 2, finding 4).
     OR strpos(v_raw, 'v_allowed := true') > 0 THEN
    RAISE EXCEPTION '0092 post-condition 7 failed: fn_trash_authz lost a gate, the files money arm or the Legal clause — or grants where it should only refuse';
  END IF;
  v_hits := (length(v_body) - length(replace(v_body, 'passes_project_privacy(', ''))) / length('passes_project_privacy(');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION '0092 post-condition 7 failed: fn_trash_authz names passes_project_privacy % times (expected 1)', v_hits;
  END IF;
  IF has_function_privilege('anon', 'public.fn_trash_authz(text, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_trash_authz(text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0092 post-condition 7 failed: a client role can execute fn_trash_authz';
  END IF;

  -- 8. reserve_upload_bytes: the Legal clause inside the first refusal's
  --    money arm, before the exemption — and everything 0083 / 0088 pinned.
  v_raw  := pg_get_functiondef('public.reserve_upload_bytes(text, bigint)'::regprocedure);
  v_body := regexp_replace(regexp_replace(v_raw, '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g');
  IF strpos(v_body, 'OR (public.rabbit_money_key(p_path)') = 0
     OR strpos(v_body, 'AND NOT (COALESCE(public.rabbit_legal_key(p_path), false)') = 0
     OR strpos(v_body, 'AND COALESCE(public.can_access_project_legal(v_project), false))') = 0
     OR strpos(v_body, 'AND NOT COALESCE(public.can_access_project_money(v_project), false)) THEN') = 0
     OR strpos(v_body, 'public.rabbit_money_key(p_path)') > strpos(v_body, 'public.rabbit_quota_exempt_bytes(p_path, p_bytes)')
     OR strpos(v_body, 'public.rabbit_legal_key(p_path)') > strpos(v_body, 'public.rabbit_quota_exempt_bytes(p_path, p_bytes)') THEN
    RAISE EXCEPTION '0092 post-condition 8 failed: reserve_upload_bytes lost the money arm or the Legal clause of its first refusal, or they no longer come before the exemption';
  END IF;
  IF strpos(v_body, '42501') = 0 OR strpos(v_body, '22023') = 0 OR strpos(v_body, 'PT402') = 0
     OR strpos(v_raw, 'rabbit_quota_exempt_path(p_path)') > 0
     OR v_body NOT LIKE '%public.can_write_project(v_project)%'
     OR v_body NOT LIKE '%public.has_active_membership(v_ws)%'
     OR v_body NOT LIKE '%public.current_workspace_id()%'
     OR v_body NOT LIKE '%public.passes_project_privacy(v_project)%'
     OR v_body NOT LIKE '%pg_advisory_xact_lock(%'
     OR v_body NOT LIKE '%public.rabbit_petal_storage_ok(v_project, p_bytes, p_path)%'
     OR v_body NOT LIKE '%INSERT INTO public.upload_reservations%'
     OR v_body NOT LIKE '%uploads in progress count%'
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.reserve_upload_bytes(text, bigint)'::regprocedure
                     AND prosecdef AND proconfig @> ARRAY['search_path=public']) THEN
    RAISE EXCEPTION '0092 post-condition 8 failed: reserve_upload_bytes lost something 0083 pinned (a gate, the bounded exemption, its lock, its quota predicate, its row, its sentence, SECURITY DEFINER or its search_path)';
  END IF;
  v_hits := (length(v_body) - length(replace(v_body, 'passes_project_privacy(', ''))) / length('passes_project_privacy(');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION '0092 post-condition 8 failed: reserve_upload_bytes names passes_project_privacy % times (expected 1)', v_hits;
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.reserve_upload_bytes(text, bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.reserve_upload_bytes(text, bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION '0092 post-condition 8 failed: reserve_upload_bytes grants moved';
  END IF;

  -- 9. fn_realtime_broadcast, unchanged: 0088 post-condition 11's shape — the
  --    files arm tests NEW and OLD for money before broadcasting, every table
  --    named once, the twelve triggers standing — and the files arm pinned
  --    WHOLE on the raw text (review round 2, finding 3: an arm that exempted
  --    LEGAL rows from the skip would have passed the pieces). A replay of
  --    0016 / 0061 / 0077 would broadcast a Legal row whole to every project
  --    reader.
  v_raw  := pg_get_functiondef('public.fn_realtime_broadcast()'::regprocedure);
  v := btrim(regexp_replace(substring(v_raw from 'WHEN ''files'' THEN.*?v_project := \(v_row ->> ''project_id''\)::uuid;'), '\s+', ' ', 'g'));
  IF v IS DISTINCT FROM 'WHEN ''files'' THEN IF public.file_row_is_money((to_jsonb(NEW) ->> ''is_financial'')::boolean, to_jsonb(NEW) ->> ''storage_path'') OR public.file_row_is_money((to_jsonb(OLD) ->> ''is_financial'')::boolean, to_jsonb(OLD) ->> ''storage_path'') THEN RETURN NULL; END IF; v_project := (v_row ->> ''project_id'')::uuid;' THEN
    RAISE EXCEPTION '0092 post-condition 9 failed: the files arm of fn_realtime_broadcast is not 0088''s — it reads %', v;
  END IF;
  IF strpos(v_raw, 'can_access_project_legal') > 0 OR strpos(v_raw, 'rabbit_legal_segment') > 0 OR strpos(v_raw, 'file_row_is_legal') > 0 THEN
    RAISE EXCEPTION '0092 post-condition 9 failed: fn_realtime_broadcast has grown a Legal arm (a broadcast has no per-recipient filter)';
  END IF;
  v_body := regexp_replace(regexp_replace(v_raw, '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g');
  FOREACH t IN ARRAY ARRAY['projects','phases','assets','tasks','files','comments',
                           'task_dependencies','phase_dependencies','task_links',
                           'asset_versions','project_members','milestones'] LOOP
    v_hits := (length(v_body) - length(replace(v_body, '''' || t || '''', ''))) / length('''' || t || '''');
    IF v_hits <> 1 THEN
      RAISE EXCEPTION '0092 post-condition 9 failed: fn_realtime_broadcast names % % times (expected exactly 1)', t, v_hits;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
                    WHERE tg.tgrelid = ('public.' || quote_ident(t))::regclass
                      AND tg.tgname = 'trg_' || t || '_realtime'
                      AND p.proname = 'fn_realtime_broadcast') THEN
      RAISE EXCEPTION '0092 post-condition 9 failed: trg_%_realtime is not attached to fn_realtime_broadcast', t;
    END IF;
  END LOOP;
  v_hits := (length(v_body) - length(replace(v_body, 'public.file_row_is_money(', ''))) / length('public.file_row_is_money(');
  IF v_hits <> 2
     OR v_body !~ 'WHEN ''files'' THEN\s+IF public\.file_row_is_money\(\(to_jsonb\(NEW\)'
     OR strpos(v_body, 'to_jsonb(OLD) ->> ''storage_path''') = 0 THEN
    RAISE EXCEPTION '0092 post-condition 9 failed: the files arm of fn_realtime_broadcast does not test both NEW and OLD for money before broadcasting';
  END IF;

  -- 10. edit_history: both snapshot columns; 0088's classifier UNCHANGED in
  --     shape (so 0088 stays replayable) and the Legal verdict beside it,
  --     both closed to clients; the verdict on synthetic diffs (review round
  --     1, finding 2: an unflagged FINANCE or INVOICES row is never Legal,
  --     nor a diff that mixes a LEGAL path with a money one); the trigger
  --     DEFINITION whole and its function's two snapshot lines; the policy
  --     whole; exactly one policy; and no files history row of a Legal file
  --     left without is_legal, nor one of a non-Legal file carrying it.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                  AND table_name = 'edit_history' AND column_name = 'is_financial'
                  AND is_nullable = 'NO' AND column_default = 'false')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                     AND table_name = 'edit_history' AND column_name = 'is_legal'
                     AND is_nullable = 'NO' AND column_default = 'false')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                     AND table_name = 'edit_history' AND column_name = 'project_id' AND data_type = 'uuid') THEN
    RAISE EXCEPTION '0092 post-condition 10 failed: edit_history.is_financial / is_legal / project_id are missing or mis-shaped';
  END IF;
  IF (SELECT proargnames FROM pg_proc WHERE oid = 'public.edit_history_file_class(uuid, jsonb)'::regprocedure)
     IS DISTINCT FROM ARRAY['p_entity_id', 'p_diff', 'is_money', 'project_id']::text[]
     OR has_function_privilege('anon', 'public.edit_history_file_class(uuid, jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.edit_history_file_class(uuid, jsonb)', 'EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.edit_history_file_class(uuid, jsonb)'::regprocedure
                     AND prosecdef AND proconfig @> ARRAY['search_path=public']) THEN
    RAISE EXCEPTION '0092 post-condition 10 failed: edit_history_file_class is not 0088''s (is_money, project_id), or is open to a client role, or lost SECURITY DEFINER / its search_path';
  END IF;
  IF to_regprocedure('public.edit_history_file_is_legal(uuid, jsonb)') IS NULL
     OR has_function_privilege('anon', 'public.edit_history_file_is_legal(uuid, jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.edit_history_file_is_legal(uuid, jsonb)', 'EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.edit_history_file_is_legal(uuid, jsonb)'::regprocedure
                     AND prosecdef AND provolatile = 's' AND proconfig @> ARRAY['search_path=public']) THEN
    RAISE EXCEPTION '0092 post-condition 10 failed: edit_history_file_is_legal is missing, open to a client role, not STABLE, or lost SECURITY DEFINER / its search_path';
  END IF;
  -- The verdict and 0088's classifier on synthetic diffs, with a NULL entity
  -- id so only the diff speaks (🚨 never a fixed uuid: a files id is the
  -- client's to choose, and a row planted at it would make the check raise
  -- on every re-run — review round 2, finding 1): Legal exactly for the pure
  -- LEGAL shapes; money for every locked path; never NULL.
  IF public.edit_history_file_is_legal(NULL, '{"new": {"storage_path": "projects/p/LEGAL/x/1-a.pdf", "is_financial": false}}') IS NOT TRUE
     OR public.edit_history_file_is_legal(NULL, '{"old": {"storage_path": "projects/p/legal/x/1-a.pdf", "is_financial": false}}') IS NOT TRUE
     OR public.edit_history_file_is_legal(NULL, '{"storage_path": {"old": "projects/p/LEGAL/x/1-a.pdf", "new": "projects/p/LEGAL/x/2-a.pdf"}}') IS NOT TRUE
     OR public.edit_history_file_is_legal(NULL, '{"new": {"storage_path": "projects/p/FINANCE/RATES.json", "is_financial": false}}') IS NOT FALSE
     OR public.edit_history_file_is_legal(NULL, '{"new": {"storage_path": "projects/p/INVOICES/x/1-a.pdf", "is_financial": false}}') IS NOT FALSE
     OR public.edit_history_file_is_legal(NULL, '{"old": {"storage_path": "projects/p/LEGAL/x/1-a.pdf", "is_financial": true}}') IS NOT FALSE
     OR public.edit_history_file_is_legal(NULL, '{"storage_path": {"old": "projects/p/INVOICES/x/1-a.pdf", "new": "projects/p/LEGAL/x/1-a.pdf"}}') IS NOT FALSE
     OR public.edit_history_file_is_legal(NULL, '{"storage_path": {"old": "projects/p/LEGAL/x/1-a.pdf"}, "is_financial": {"new": true}}') IS NOT FALSE
     OR public.edit_history_file_is_legal(NULL, '{"description": {"old": "a", "new": "b"}}') IS NOT FALSE
     OR public.edit_history_file_is_legal(NULL, '{"new": {"storage_path": "projects/p/project/x/1-a.pdf", "is_financial": false}}') IS NOT FALSE
     OR public.edit_history_file_is_legal(NULL, NULL) IS NOT FALSE THEN
    RAISE EXCEPTION '0092 post-condition 10 failed: edit_history_file_is_legal does not call exactly the pure-LEGAL shapes Legal (an unflagged FINANCE or INVOICES row, a flagged row, a mixed diff, a bare flag and a note-only diff must all be false)';
  END IF;
  IF (SELECT c.is_money FROM public.edit_history_file_class(NULL, '{"new": {"storage_path": "projects/p/FINANCE/RATES.json", "is_financial": false}}') c) IS NOT TRUE
     OR (SELECT c.is_money FROM public.edit_history_file_class(NULL, '{"new": {"storage_path": "projects/p/LEGAL/x/1-a.pdf", "is_financial": false}}') c) IS NOT TRUE
     OR (SELECT c.is_money FROM public.edit_history_file_class(NULL, '{"new": {"storage_path": "projects/p/project/x/1-a.pdf", "is_financial": false}}') c) IS NOT FALSE THEN
    RAISE EXCEPTION '0092 post-condition 10 failed: edit_history_file_class (0088) no longer calls a locked path money, or calls a plain one money';
  END IF;
  IF (SELECT pg_get_triggerdef(tg.oid) FROM pg_trigger tg
       WHERE tg.tgrelid = 'public.edit_history'::regclass AND tg.tgname = 'trg_edit_history_money' AND tg.tgenabled = 'O')
     IS DISTINCT FROM 'CREATE TRIGGER trg_edit_history_money BEFORE INSERT ON public.edit_history FOR EACH ROW WHEN ((new.entity_type = ''files''::text)) EXECUTE FUNCTION fn_edit_history_money_snapshot()' THEN
    RAISE EXCEPTION '0092 post-condition 10 failed: trg_edit_history_money is missing, disabled, or not the BEFORE INSERT FOR EACH ROW WHEN entity_type = files trigger on fn_edit_history_money_snapshot (reads %)',
      (SELECT pg_get_triggerdef(tg.oid) FROM pg_trigger tg WHERE tg.tgrelid = 'public.edit_history'::regclass AND tg.tgname = 'trg_edit_history_money');
  END IF;
  -- …and it is the ONLY trigger on the table: a second BEFORE INSERT trigger
  -- firing after it could re-label a row (review round 2, finding 5).
  IF (SELECT string_agg(tgname, ', ' ORDER BY tgname) FROM pg_trigger
       WHERE tgrelid = 'public.edit_history'::regclass AND NOT tgisinternal)
     IS DISTINCT FROM 'trg_edit_history_money' THEN
    RAISE EXCEPTION '0092 post-condition 10 failed: edit_history carries triggers other than trg_edit_history_money: %',
      (SELECT string_agg(tgname, ', ' ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'public.edit_history'::regclass AND NOT tgisinternal);
  END IF;
  v_body := regexp_replace(regexp_replace(
              pg_get_functiondef('public.fn_edit_history_money_snapshot()'::regprocedure),
              '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g');
  IF strpos(v_body, 'SELECT c.is_money, c.project_id') = 0
     OR strpos(v_body, 'INTO NEW.is_financial, NEW.project_id') = 0
     OR strpos(v_body, 'NEW.is_financial := COALESCE(NEW.is_financial, true);') = 0
     OR strpos(v_body, 'NEW.is_legal := COALESCE(public.edit_history_file_is_legal(NEW.entity_id, NEW.diff), false);') = 0
     OR has_function_privilege('authenticated', 'public.fn_edit_history_money_snapshot()', 'EXECUTE') THEN
    RAISE EXCEPTION '0092 post-condition 10 failed: fn_edit_history_money_snapshot does not snapshot is_financial from 0088''s classifier and is_legal from the Legal verdict, or is open to a client role';
  END IF;
  SELECT qual INTO v FROM pg_policies WHERE schemaname = 'public' AND tablename = 'edit_history' AND policyname = 'edit_history_select';
  IF v IS DISTINCT FROM '((workspace_id = current_workspace_id()) AND (current_app_role() = ANY (ARRAY[''admin''::text, ''manager''::text])) AND has_active_membership(workspace_id) AND ((NOT is_financial) OR (current_app_role() = ''admin''::text) OR COALESCE(can_access_project_money(project_id), false) OR (is_legal AND COALESCE(can_access_project_legal(project_id), false))))' THEN
    RAISE EXCEPTION '0092 post-condition 10 failed: edit_history_select reads %', v;
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'edit_history') <> 1 THEN
    RAISE EXCEPTION '0092 post-condition 10 failed: edit_history must keep exactly one policy (SELECT); clients write nothing';
  END IF;
  -- The live table, for history written at or after the current row's
  -- creation (an older row of a reused id belongs to another file — §8d).
  IF EXISTS (SELECT 1 FROM public.edit_history eh JOIN public.files f ON f.id = eh.entity_id AND f.created_at <= eh.created_at
              WHERE eh.entity_type = 'files'
                AND public.file_row_is_legal(f.is_financial, f.storage_path)
                AND NOT (eh.is_financial AND eh.is_legal)) THEN
    RAISE EXCEPTION '0092 post-condition 10 failed: a Legal file still has history not flagged is_financial and is_legal';
  END IF;
  IF EXISTS (SELECT 1 FROM public.edit_history eh JOIN public.files f ON f.id = eh.entity_id AND f.created_at <= eh.created_at
              WHERE eh.entity_type = 'files' AND eh.is_legal
                AND NOT public.rabbit_legal_segment(split_part(f.storage_path, '/', 3))) THEN
    RAISE EXCEPTION '0092 post-condition 10 failed: a file not under LEGAL has history flagged is_legal — the Legal audience would read an invoice''s history';
  END IF;
  IF EXISTS (SELECT 1 FROM public.edit_history WHERE is_legal AND NOT is_financial) THEN
    RAISE EXCEPTION '0092 post-condition 10 failed: an edit_history row is is_legal but not is_financial — is_legal must be a subset of the money flag';
  END IF;

  -- 11. file_events_select, whole — Legal 1: no `purged` arm; still the one
  --     policy, SELECT only; trg_file_events_money standing (0088 §9b).
  SELECT qual INTO v FROM pg_policies WHERE schemaname = 'public' AND tablename = 'file_events' AND policyname = 'file_events_select';
  IF v IS DISTINCT FROM '((workspace_id = current_workspace_id()) AND has_active_membership(workspace_id) AND (can_read_project_topic(project_id) OR (current_app_role() = ''admin''::text)) AND ((NOT is_financial) OR (current_app_role() = ''admin''::text) OR COALESCE(can_access_project_money(project_id), false) OR (file_event_is_legal(old_path, new_path) AND COALESCE(can_access_project_legal(project_id), false))))' THEN
    RAISE EXCEPTION '0092 post-condition 11 failed: file_events_select reads %', v;
  END IF;
  IF v LIKE '%purged%' THEN
    RAISE EXCEPTION '0092 post-condition 11 failed: file_events_select still carries a purged exception — a deleted invoice''s record would be every member''s again';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'file_events') <> 1
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'file_events' AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION '0092 post-condition 11 failed: file_events must keep exactly one policy, SELECT only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
                  WHERE tg.tgrelid = 'public.file_events'::regclass AND tg.tgname = 'trg_file_events_money'
                    AND p.proname = 'fn_file_events_money_snapshot' AND tg.tgenabled = 'O') THEN
    RAISE EXCEPTION '0092 post-condition 11 failed: trg_file_events_money (0088) is missing or disabled — the sweep''s Legal certificate would be unflagged';
  END IF;
  IF (SELECT string_agg(tgname, ', ' ORDER BY tgname) FROM pg_trigger
       WHERE tgrelid = 'public.file_events'::regclass AND NOT tgisinternal)
     IS DISTINCT FROM 'trg_file_events_money' THEN
    RAISE EXCEPTION '0092 post-condition 11 failed: file_events carries triggers other than trg_file_events_money (one firing after it could clear the flag): %',
      (SELECT string_agg(tgname, ', ' ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'public.file_events'::regclass AND NOT tgisinternal);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.files'::regclass AND tgname = 'trg_files_legal_fixed' AND tgenabled = 'O') THEN
    RAISE EXCEPTION '0092 post-condition 11 failed: trg_files_legal_fixed (0088) is missing or DISABLED — a Legal row could be moved out of LEGAL in one UPDATE';
  END IF;
  -- Enabled, as 0027 / 0012 left them (neither table is FORCE RLS: the
  -- owner's DEFINER writers are the only writers; clients hold SELECT alone).
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.file_events'::regclass AND relrowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.edit_history'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION '0092 post-condition 11 failed: RLS is no longer enabled on file_events or edit_history';
  END IF;

  -- 12. 🚨 MONEY DOES NOT WIDEN. can_access_project_money is 0037's body
  --     WHOLE (comments stripped, whitespace collapsed — a pin by pieces lets
  --     an additive leg through; review round 1, finding 3): the admin leg
  --     and the project-manager leg, 0037's hop, nothing else. A planted
  --     fault that admits a workspace manager to INVOICES through the money
  --     gate fails here.
  SELECT btrim(regexp_replace(prosrc, '\s+', ' ', 'g'))
    INTO v_body FROM pg_proc WHERE oid = 'public.can_access_project_money(uuid)'::regprocedure;
  IF v_body IS DISTINCT FROM 'SELECT EXISTS ( SELECT 1 FROM public.projects p WHERE p.id = p_project AND p.workspace_id = public.current_workspace_id() AND public.has_active_membership(p.workspace_id) ) AND ( public.current_app_role() = ''admin'' OR public.project_role_for(p_project) = ''manager'' );'
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.can_access_project_money(uuid)'::regprocedure
                     AND prosecdef AND provolatile = 's' AND proconfig @> ARRAY['search_path=public']) THEN
    RAISE EXCEPTION '0092 post-condition 12 failed: can_access_project_money is not 0037''s body — a workspace manager must reach money only through the project''s manager seat (it reads %)', v_body;
  END IF;
  -- …and no money table policy names the Legal predicate.
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO v FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('budget_lines', 'budget_actuals', 'budget_versions', 'expenses', 'project_rate_overrides',
                       'budget_version_items', 'budget_snapshots', 'rate_cards')
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%can_access_project_legal%';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION '0092 post-condition 12 failed: a money table policy asks the Legal gate: %', v;
  END IF;
  -- …and the INVOICES / FINANCE segments are not Legal to any classifier
  -- (IS NOT FALSE: a NULL here must fail too, round 2 finding 12).
  IF public.rabbit_legal_segment('INVOICES') IS NOT FALSE OR public.rabbit_legal_segment('FINANCE') IS NOT FALSE
     OR public.rabbit_legal_key('projects/p/INVOICES/x/1-a.pdf') IS NOT FALSE OR public.rabbit_legal_key('projects/p/FINANCE/RATES.json') IS NOT FALSE
     OR public.file_row_is_legal(false, 'projects/p/FINANCE/RATES.json') IS NOT FALSE
     OR public.file_event_is_legal('projects/p/INVOICES/x/1-a.pdf', 'projects/p/FINANCE/RATES.json') IS NOT FALSE THEN
    RAISE EXCEPTION '0092 post-condition 12 failed: a money segment classifies as Legal, or a classifier answered NULL';
  END IF;

  -- 13. Grants on the three classifiers: authenticated yes, anon no.
  FOREACH t IN ARRAY ARRAY['public.file_row_is_legal(boolean, text)', 'public.rabbit_legal_key(text)',
                           'public.file_event_is_legal(text, text)'] LOOP
    IF NOT has_function_privilege('authenticated', t, 'EXECUTE')
       OR has_function_privilege('anon', t, 'EXECUTE') THEN
      RAISE EXCEPTION '0092 post-condition 13 failed: % must be executable by authenticated and not by anon (and so not PUBLIC)', t;
    END IF;
  END LOOP;

  RAISE NOTICE '0092 OK: can_access_project_legal (money OR a workspace manager, with 0037''s hop and 0072''s arm); four files policies and eight money storage policies on both gates; a Legal file is never an invoice; the download log, reservations, trash, edit history and file events re-pointed; the purged exception gone (Legal 1); money unchanged.';
END $$;
