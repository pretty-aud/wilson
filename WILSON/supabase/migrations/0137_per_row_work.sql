-- =============================================================================
-- 0137_per_row_work.sql, F7 (wave 2 of the week of 2026-11-04): the database does less work per row.
--
-- Nothing a person sees changes. Four kinds of work the database repeated for every row it looked at are done once,
-- or against an index, with every answer the same as before.
--
-- WHAT THIS CHANGES
-- -----------------
--   §5  186 of the 189 policies that call has_active_membership (0008) restated by ONE substitution: the call
--       becomes `(SELECT public.has_active_membership(public.current_workspace_id()))`. The function is a SECURITY
--       DEFINER (never inlined), so a bare call runs once per row the policy looks at; inside `(SELECT ...)` the
--       planner runs it once per statement (an InitPlan). It is made for the bare form, has_active_membership(
--       current_workspace_id()), always (13 calls: 12 on storage.objects), and for the row's column, has_active_
--       membership(X), only where the same expression pins X = current_workspace_id() at an AND that is the call's
--       parent or one of its ancestors, with nothing but AND, OR and an EXISTS's WHERE between (207 calls, 27 of them
--       inside an EXISTS on a parent row, and notes_select's, whose pin is at the outer AND).
--       WHY IT IS THE SAME POLICY. A policy only asks "is it TRUE" (USING hides a row that is FALSE or NULL; WITH CHECK
--       refuses one). Where the pin is TRUE, X and current_workspace_id() are equal and not null, so the two calls are
--       the same value. Where the pin is not TRUE, the AND holding it is not TRUE either way. AND, OR and EXISTS are
--       TRUE exactly when their inputs say so, so the policy's answer is unchanged. (has_active_membership is not
--       strict: of NULL it answers FALSE, so the AND holding the pin can be FALSE in one form and NULL in the other; no
--       NOT, CASE, COALESCE, IS or comparison sits on any call's path, so that never shows.) The argument also takes
--       the claim to stay one value through a statement: PostgREST, storage and Realtime set request.jwt.claims
--       between statements, never within one, and the per-row form read it per row where the sub-select reads it once.
--       THREE ARE LEFT, each clause's text pinned here. auth_events_insert has no pin at all (`workspace_id IS NULL OR
--       has_active_membership(workspace_id)`): substituting would change which company a member may name.
--       ws_members_select and ws_members_admin_write, workspace_members' read-side policies: ws_members_self_update
--       checks a member's own row by a sub-query over workspace_members, and the row-security rewriter refuses to
--       expand a table's policies a second time on one path once any of them holds a sub-query ("infinite recursion
--       detected in policy"); a sub-select in these two would make every update of a member row fail. A company's
--       members are few rows; they keep the call per row. §7 proves, on whatever database this runs, that no table's
--       policies recurse for a client's statement of any kind.
--       ALTER POLICY, not drop-and-create: the name, the command, the roles and permissive-or-restrictive cannot
--       change, the policy keeps its oid, and a clause the file does not name keeps its live text.
--   §2  The proof that nothing else changed, carried by this file on whatever database it runs on: every policy is
--       read at the start (schema, table, name, command, permissive, roles, USING, WITH CHECK, as the catalog
--       deparses them under an empty search_path); every listed clause must hold exactly one call, of the argument
--       the list names; every other clause that calls the function must be the exception, with the exception's exact
--       text; at the end the count is equal and every policy's text is the start's text with exactly that one
--       substitution in exactly the listed clauses (the substitution's own text is taken from the server, by a probe
--       policy on a temporary table). The expected text comes from the LIVE start, not from this file: a database whose
--       live text is not dev's fails here and is not changed.
--   §3  workspace_petal_committed_bytes (0073, restated by 0115): 0115's first arm computed fn_try_uuid (plpgsql with an
--       exception block: a sub-transaction) on every object of both buckets, every company's, on every upload. It is
--       split in two, and the count is the same: 1a, each of the workspace's projects' objects by the canonical key
--       prefix as a byte range on storage's own index; 1b, 0115's arm verbatim behind a cheap test that keeps out what
--       1a counts, for a key whose second segment is spelled another way (the storage INSERT policies admit any
--       spelling that parses to the project, so dropping 1b would stop counting those: a quota bypass). The second arm
--       is unchanged; storage.objects.metadata stays the only size source. The new body is installed under a
--       candidate's name first, and the old and the new must answer the same for every workspace in one statement
--       before the real function is replaced. The RESTRICTIVE petal_storage_quota_insert is not touched.
--   §4  Two indexes for ai-files' reads of app_events (they read the AI file rows by a JSON path, and the table had
--       only 0021's two indexes): one by the file id (every row: partial on the AI rows, the planner took it for the
--       predicate alone and made readAbsentNoted 30 times slower in the rehearsal), one by workspace in id order for
--       the AI file rows; statistics on the JSON `tool` value, and app_events analysed, so the planner knows how
--       common an AI row is.
--   §6  The six indexes that are the leading part of a wider index on the same table, non-unique, with the same
--       predicate where they have one, dropped: bin_files_location_idx (0091), budget_lines_project_idx (0037),
--       folders_project_idx (0041), scenes_project_idx (0040), tasks_project_idx (0000), otter_courses_ws_owner_idx
--       (0022). Nothing names them; no constraint, key or conflict target uses them.
--
-- LOCKS, in the file's order. §3, the meter's check, reads every workspace's objects twice under ACCESS SHARE (no
-- one waits). §4 takes SHARE on app_events (its inserts wait) while two indexes are built and the table is analysed:
-- both read the whole table, so their time grows with it. Then §5's ALTER POLICY takes ACCESS EXCLUSIVE on each of the
-- 64 tables (storage.objects and app_events among them) and §6's DROP INDEX on five of the same and on budget_lines;
-- those are catalog changes of milliseconds, but every lock is held to the commit, so reads and writes of all of them
-- wait from that moment to the end. A 5 s lock_timeout: a busy moment refuses rather than queues everyone behind it;
-- run it again.
--
-- One transaction, re-runnable, no enum, no CONCURRENTLY. The search_path is the caller's again at the end.
-- Suite 139_per_row_work.sql.
-- =============================================================================

SET LOCAL lock_timeout = '5s';
SELECT pg_catalog.set_config('f7.caller_search_path', pg_catalog.current_setting('search_path'), true);
SELECT pg_catalog.set_config('search_path', '', true);

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  IF NOT (SELECT rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0137 refused: % does not bypass row security', current_user;
  END IF;
  -- The equivalence argument is about THESE two functions: 0008's membership check (STABLE, a definer, not strict,
  -- an EXISTS over the live membership row) and 0001's reader of the claim.
  IF (SELECT pg_catalog.md5(pg_catalog.replace(prosrc, chr(13), '')) FROM pg_catalog.pg_proc
       WHERE oid = 'public.has_active_membership(uuid)'::pg_catalog.regprocedure) IS DISTINCT FROM 'c44bb8a3a7e1782a6899d405f9e2af0a'
     OR (SELECT provolatile <> 's' OR proisstrict OR NOT prosecdef FROM pg_catalog.pg_proc
          WHERE oid = 'public.has_active_membership(uuid)'::pg_catalog.regprocedure) THEN
    RAISE EXCEPTION '0137 refused: has_active_membership is not 0008''s';
  END IF;
  IF (SELECT pg_catalog.md5(pg_catalog.replace(prosrc, chr(13), '')) FROM pg_catalog.pg_proc
       WHERE oid = 'public.current_workspace_id()'::pg_catalog.regprocedure) IS DISTINCT FROM '18a72d5309e2b29e2a4a86ef5fbad92a' THEN
    RAISE EXCEPTION '0137 refused: current_workspace_id is not the claim reader this file was built on';
  END IF;
  -- The meter is 0115's body or already this file's.
  IF (SELECT pg_catalog.md5(pg_catalog.replace(prosrc, chr(13), '')) FROM pg_catalog.pg_proc
       WHERE oid = 'public.workspace_petal_committed_bytes(uuid)'::pg_catalog.regprocedure)
     NOT IN ('96b8fb43380056a2e9925fc28a09c458', '67bd041258c73fecae5b4031357e42d2') THEN
    RAISE EXCEPTION '0137 refused: workspace_petal_committed_bytes is neither 0115''s body nor this file''s';
  END IF;
  -- Each wider index is here, valid and ready, as dev has it; each narrow one is absent or exactly as dev has it.
  FOR r IN
    SELECT * FROM (VALUES
      ('bin_files_location_idx', 'CREATE INDEX bin_files_location_idx ON public.bin_files USING btree (location_id)',
       'bin_files_location_path_idx', 'CREATE INDEX bin_files_location_path_idx ON public.bin_files USING btree (location_id, lower(relative_path))'),
      ('budget_lines_project_idx', 'CREATE INDEX budget_lines_project_idx ON public.budget_lines USING btree (project_id)',
       'budget_lines_project_sheet_idx', 'CREATE INDEX budget_lines_project_sheet_idx ON public.budget_lines USING btree (project_id, sheet)'),
      ('folders_project_idx', 'CREATE INDEX folders_project_idx ON public.folders USING btree (project_id)',
       'folders_project_path_uniq', 'CREATE UNIQUE INDEX folders_project_path_uniq ON public.folders USING btree (project_id, path)'),
      ('scenes_project_idx', 'CREATE INDEX scenes_project_idx ON public.scenes USING btree (project_id)',
       'scenes_project_number_idx', 'CREATE INDEX scenes_project_number_idx ON public.scenes USING btree (project_id, scene_number)'),
      ('tasks_project_idx', 'CREATE INDEX tasks_project_idx ON public.tasks USING btree (project_id)',
       'tasks_project_phase_idx', 'CREATE INDEX tasks_project_phase_idx ON public.tasks USING btree (project_id, phase_id)'),
      ('otter_courses_ws_owner_idx', 'CREATE INDEX otter_courses_ws_owner_idx ON public.otter_courses USING btree (workspace_id, owner_id) WHERE (deleted_at IS NULL)',
       'otter_courses_owner_slug_uidx', 'CREATE UNIQUE INDEX otter_courses_owner_slug_uidx ON public.otter_courses USING btree (workspace_id, owner_id, slug) WHERE (deleted_at IS NULL)')
    ) AS t(narrow, narrow_def, wide, wide_def)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i
                    WHERE i.indexrelid = pg_catalog.to_regclass('public.' || r.wide)
                      AND i.indisvalid AND i.indisready
                      AND pg_catalog.pg_get_indexdef(i.indexrelid) = r.wide_def) THEN
      RAISE EXCEPTION '0137 refused: % is not here, valid and as this file was built on, so % stays', r.wide, r.narrow;
    END IF;
    IF pg_catalog.to_regclass('public.' || r.narrow) IS NOT NULL
       AND pg_catalog.pg_get_indexdef(pg_catalog.to_regclass('public.' || r.narrow)) IS DISTINCT FROM r.narrow_def THEN
      RAISE EXCEPTION '0137 refused: an index named % is here that is not the one this file drops', r.narrow;
    END IF;
  END LOOP;
  -- The two new indexes are absent or exactly this file's.
  IF pg_catalog.to_regclass('public.app_events_file_id_idx') IS NOT NULL
     AND pg_catalog.pg_get_indexdef(pg_catalog.to_regclass('public.app_events_file_id_idx')) IS DISTINCT FROM 'CREATE INDEX app_events_file_id_idx ON public.app_events USING btree (((context ->> ''file_id''::text)))' THEN
    RAISE EXCEPTION '0137 refused: an index app_events_file_id_idx is here that this file did not make';
  END IF;
  IF pg_catalog.to_regclass('public.app_events_ai_files_ws_id_idx') IS NOT NULL
     AND pg_catalog.pg_get_indexdef(pg_catalog.to_regclass('public.app_events_ai_files_ws_id_idx')) IS DISTINCT FROM 'CREATE INDEX app_events_ai_files_ws_id_idx ON public.app_events USING btree (workspace_id, id) WHERE ((code = ''WIL-6001''::text) AND ((context ->> ''tool''::text) = ''ai-files''::text))' THEN
    RAISE EXCEPTION '0137 refused: an index app_events_ai_files_ws_id_idx is here that this file did not make';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_statistic_ext s WHERE s.stxname = 'app_events_context_tool_stats'
               AND pg_catalog.pg_get_statisticsobjdef(s.oid) IS DISTINCT FROM 'CREATE STATISTICS public.app_events_context_tool_stats ON (context ->> ''tool''::text) FROM public.app_events') THEN
    RAISE EXCEPTION '0137 refused: statistics app_events_context_tool_stats are here that this file did not make';
  END IF;
  -- An index entry has a size limit (about 2.7 kB), and a member can write any JSON into an event of their own
  -- company (0021). No writer of this product names a file id longer than 100 characters; a row naming one over
  -- 1,000 bytes is not the product's, and could stop the index from being built: brought to the controller, not
  -- built over.
  IF EXISTS (SELECT 1 FROM public.app_events WHERE pg_catalog.octet_length(context ->> 'file_id') > 1000) THEN
    RAISE EXCEPTION '0137 refused: % app_events rows name a file id over 1,000 bytes long; none is one this product writes',
      (SELECT count(*) FROM public.app_events WHERE pg_catalog.octet_length(context ->> 'file_id') > 1000);
  END IF;
END
$$;

-- §1 Every policy, as the catalog deparses it, before -------------------------------
CREATE TEMP TABLE _f7_pol_before ON COMMIT DROP AS
  SELECT n.nspname::text AS sch, c.relname::text AS tbl, p.polname::text AS pol,
         p.polcmd::text AS cmd, p.polpermissive AS permissive,
         (SELECT pg_catalog.array_agg(x.role ORDER BY x.role)
            FROM (SELECT CASE WHEN r = 0 THEN 'public' ELSE pg_catalog.pg_get_userbyid(r)::text END AS role
                    FROM pg_catalog.unnest(p.polroles) AS r) AS x) AS roles,
         pg_catalog.replace(pg_catalog.pg_get_expr(p.polqual, p.polrelid), chr(13), '') AS qual,
         pg_catalog.replace(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), chr(13), '') AS with_check
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname !~ '^pg_(toast_)?temp_';

-- The substitution's text as THIS server deparses it: a probe policy on a temporary table, read back, dropped.
CREATE TEMP TABLE _f7_probe (x int) ON COMMIT DROP;
CREATE POLICY f7_probe ON pg_temp._f7_probe USING ((SELECT public.has_active_membership(public.current_workspace_id())));
CREATE TEMP TABLE _f7_sub ON COMMIT DROP AS
  SELECT pg_catalog.pg_get_expr(polqual, polrelid) AS t FROM pg_catalog.pg_policy
   WHERE polrelid = 'pg_temp._f7_probe'::pg_catalog.regclass;
DROP TABLE pg_temp._f7_probe;

-- §2 The list this file restates, and the one exception ------------------------------
-- (schema, table, policy, clause, the call's argument as deparsed). 186 policies, 218 clauses, one call each.
CREATE TEMP TABLE _f7_list (sch text, tbl text, pol text, clause text, arg text) ON COMMIT DROP;
INSERT INTO _f7_list (sch, tbl, pol, clause, arg) VALUES
  ('public', 'app_events', 'app_events_insert', 'with_check', 'workspace_id'),
  ('public', 'app_events', 'app_events_select', 'qual', 'workspace_id'),
  ('public', 'asset_versions', 'asset_versions_delete', 'qual', 'a.workspace_id'),
  ('public', 'asset_versions', 'asset_versions_insert', 'with_check', 'a.workspace_id'),
  ('public', 'asset_versions', 'asset_versions_update', 'qual', 'a.workspace_id'),
  ('public', 'assets', 'assets_delete', 'qual', 'workspace_id'),
  ('public', 'assets', 'assets_insert', 'with_check', 'workspace_id'),
  ('public', 'assets', 'assets_update', 'qual', 'workspace_id'),
  ('public', 'auth_events', 'auth_events_select', 'qual', 'public.current_workspace_id()'),
  ('public', 'bin_files', 'bin_files_delete', 'qual', 'workspace_id'),
  ('public', 'bin_files', 'bin_files_insert', 'with_check', 'workspace_id'),
  ('public', 'bin_files', 'bin_files_update', 'qual', 'workspace_id'),
  ('public', 'bin_files', 'bin_files_update', 'with_check', 'workspace_id'),
  ('public', 'bin_locations', 'bin_locations_delete', 'qual', 'workspace_id'),
  ('public', 'bin_locations', 'bin_locations_insert', 'with_check', 'workspace_id'),
  ('public', 'bin_locations', 'bin_locations_select', 'qual', 'workspace_id'),
  ('public', 'bin_locations', 'bin_locations_update', 'qual', 'workspace_id'),
  ('public', 'bin_locations', 'bin_locations_update', 'with_check', 'workspace_id'),
  ('public', 'bins', 'bins_delete', 'qual', 'workspace_id'),
  ('public', 'bins', 'bins_insert', 'with_check', 'workspace_id'),
  ('public', 'bins', 'bins_update', 'qual', 'workspace_id'),
  ('public', 'bins', 'bins_update', 'with_check', 'workspace_id'),
  ('public', 'comments', 'comments_delete', 'qual', 'workspace_id'),
  ('public', 'comments', 'comments_insert', 'with_check', 'workspace_id'),
  ('public', 'comments', 'comments_update', 'qual', 'workspace_id'),
  ('public', 'edit_history', 'edit_history_select', 'qual', 'workspace_id'),
  ('public', 'edits', 'edits_insert', 'with_check', 'workspace_id'),
  ('public', 'edits', 'edits_update', 'qual', 'workspace_id'),
  ('public', 'edits', 'edits_update', 'with_check', 'workspace_id'),
  ('public', 'experiences', 'experiences_delete', 'qual', 'workspace_id'),
  ('public', 'experiences', 'experiences_insert', 'with_check', 'workspace_id'),
  ('public', 'experiences', 'experiences_update', 'qual', 'workspace_id'),
  ('public', 'file_events', 'file_events_select', 'qual', 'workspace_id'),
  ('public', 'files', 'files_delete', 'qual', 'workspace_id'),
  ('public', 'files', 'files_insert', 'with_check', 'workspace_id'),
  ('public', 'files', 'files_update', 'qual', 'workspace_id'),
  ('public', 'folders', 'folders_delete', 'qual', 'workspace_id'),
  ('public', 'folders', 'folders_insert', 'with_check', 'workspace_id'),
  ('public', 'folders', 'folders_update', 'qual', 'workspace_id'),
  ('public', 'gateway_enrolment_tokens', 'gateway_enrolment_tokens_delete', 'qual', 'workspace_id'),
  ('public', 'gateway_enrolment_tokens', 'gateway_enrolment_tokens_select', 'qual', 'workspace_id'),
  ('public', 'gateways', 'gateways_select', 'qual', 'workspace_id'),
  ('public', 'gateways', 'gateways_update', 'qual', 'workspace_id'),
  ('public', 'gateways', 'gateways_update', 'with_check', 'workspace_id'),
  ('public', 'ingestion_chunks', 'ingestion_chunks_delete', 'qual', 'p.workspace_id'),
  ('public', 'ingestion_chunks', 'ingestion_chunks_insert', 'with_check', 'p.workspace_id'),
  ('public', 'ingestion_chunks', 'ingestion_chunks_update', 'qual', 'p.workspace_id'),
  ('public', 'ingestion_runs', 'ingestion_runs_delete', 'qual', 'p.workspace_id'),
  ('public', 'ingestion_runs', 'ingestion_runs_insert', 'with_check', 'p.workspace_id'),
  ('public', 'ingestion_runs', 'ingestion_runs_update', 'qual', 'p.workspace_id'),
  ('public', 'item_groupings', 'item_groupings_delete', 'qual', 'workspace_id'),
  ('public', 'item_groupings', 'item_groupings_insert', 'with_check', 'workspace_id'),
  ('public', 'item_groupings', 'item_groupings_select', 'qual', 'workspace_id'),
  ('public', 'item_groupings', 'item_groupings_update', 'qual', 'workspace_id'),
  ('public', 'item_groupings', 'item_groupings_update', 'with_check', 'workspace_id'),
  ('public', 'levels', 'levels_delete', 'qual', 'workspace_id'),
  ('public', 'levels', 'levels_insert', 'with_check', 'workspace_id'),
  ('public', 'levels', 'levels_update', 'qual', 'workspace_id'),
  ('public', 'milestones', 'milestones_delete', 'qual', 'workspace_id'),
  ('public', 'milestones', 'milestones_insert', 'with_check', 'workspace_id'),
  ('public', 'milestones', 'milestones_update', 'qual', 'workspace_id'),
  ('public', 'moth_layout_positions', 'moth_layout_positions_select', 'qual', 'workspace_id'),
  ('public', 'moth_relationships', 'moth_relationships_delete', 'qual', 'workspace_id'),
  ('public', 'moth_relationships', 'moth_relationships_insert', 'with_check', 'workspace_id'),
  ('public', 'moth_relationships', 'moth_relationships_select', 'qual', 'workspace_id'),
  ('public', 'moth_relationships', 'moth_relationships_update', 'qual', 'workspace_id'),
  ('public', 'moth_relationships', 'moth_relationships_update', 'with_check', 'workspace_id'),
  ('public', 'moth_tag_assignments', 'moth_tag_assignments_delete', 'qual', 'workspace_id'),
  ('public', 'moth_tag_assignments', 'moth_tag_assignments_insert', 'with_check', 'workspace_id'),
  ('public', 'moth_tag_assignments', 'moth_tag_assignments_select', 'qual', 'workspace_id'),
  ('public', 'moth_tag_nominations', 'moth_tag_nominations_select', 'qual', 'workspace_id'),
  ('public', 'moth_tag_types', 'moth_tag_types_delete', 'qual', 'workspace_id'),
  ('public', 'moth_tag_types', 'moth_tag_types_insert', 'with_check', 'workspace_id'),
  ('public', 'moth_tag_types', 'moth_tag_types_select', 'qual', 'workspace_id'),
  ('public', 'moth_tag_types', 'moth_tag_types_update', 'qual', 'workspace_id'),
  ('public', 'moth_tag_types', 'moth_tag_types_update', 'with_check', 'workspace_id'),
  ('public', 'moth_tags', 'moth_tags_delete', 'qual', 'workspace_id'),
  ('public', 'moth_tags', 'moth_tags_insert', 'with_check', 'workspace_id'),
  ('public', 'moth_tags', 'moth_tags_select', 'qual', 'workspace_id'),
  ('public', 'moth_tags', 'moth_tags_update', 'qual', 'workspace_id'),
  ('public', 'moth_tags', 'moth_tags_update', 'with_check', 'workspace_id'),
  ('public', 'moth_views', 'moth_views_delete', 'qual', 'workspace_id'),
  ('public', 'moth_views', 'moth_views_insert', 'with_check', 'workspace_id'),
  ('public', 'moth_views', 'moth_views_select', 'qual', 'workspace_id'),
  ('public', 'moth_views', 'moth_views_update', 'qual', 'workspace_id'),
  ('public', 'moth_views', 'moth_views_update', 'with_check', 'workspace_id'),
  ('public', 'network_share_checks', 'network_share_checks_select', 'qual', 'workspace_id'),
  ('public', 'note_subjects', 'note_subjects_delete', 'qual', 'workspace_id'),
  ('public', 'note_subjects', 'note_subjects_insert', 'with_check', 'workspace_id'),
  ('public', 'note_subjects', 'note_subjects_update', 'qual', 'workspace_id'),
  ('public', 'note_subjects', 'note_subjects_update', 'with_check', 'workspace_id'),
  ('public', 'notes', 'notes_insert', 'with_check', 'workspace_id'),
  ('public', 'notes', 'notes_select', 'qual', 'workspace_id'),
  ('public', 'notes', 'notes_update', 'qual', 'workspace_id'),
  ('public', 'notes', 'notes_update', 'with_check', 'workspace_id'),
  ('public', 'otter_change_requests', 'otter_cr_insert', 'with_check', 'workspace_id'),
  ('public', 'otter_change_requests', 'otter_cr_select', 'qual', 'workspace_id'),
  ('public', 'otter_change_requests', 'otter_cr_update', 'qual', 'workspace_id'),
  ('public', 'otter_change_requests', 'otter_cr_update', 'with_check', 'workspace_id'),
  ('public', 'otter_course_editors', 'otter_course_editors_delete', 'qual', 'workspace_id'),
  ('public', 'otter_course_editors', 'otter_course_editors_insert', 'with_check', 'workspace_id'),
  ('public', 'otter_course_editors', 'otter_course_editors_select', 'qual', 'workspace_id'),
  ('public', 'otter_course_nominations', 'otter_nom_insert', 'with_check', 'workspace_id'),
  ('public', 'otter_course_nominations', 'otter_nom_select', 'qual', 'workspace_id'),
  ('public', 'otter_course_nominations', 'otter_nom_update', 'qual', 'workspace_id'),
  ('public', 'otter_course_nominations', 'otter_nom_update', 'with_check', 'workspace_id'),
  ('public', 'otter_courses', 'otter_courses_delete', 'qual', 'workspace_id'),
  ('public', 'otter_courses', 'otter_courses_insert', 'with_check', 'workspace_id'),
  ('public', 'otter_courses', 'otter_courses_select', 'qual', 'workspace_id'),
  ('public', 'otter_courses', 'otter_courses_update', 'qual', 'workspace_id'),
  ('public', 'otter_courses', 'otter_courses_update', 'with_check', 'workspace_id'),
  ('public', 'otter_progress', 'otter_progress_delete', 'qual', 'workspace_id'),
  ('public', 'otter_progress', 'otter_progress_insert', 'with_check', 'workspace_id'),
  ('public', 'otter_progress', 'otter_progress_select', 'qual', 'workspace_id'),
  ('public', 'otter_progress', 'otter_progress_update', 'qual', 'workspace_id'),
  ('public', 'otter_progress', 'otter_progress_update', 'with_check', 'workspace_id'),
  ('public', 'otter_quiz_attempts', 'otter_quiz_attempts_delete', 'qual', 'workspace_id'),
  ('public', 'otter_quiz_attempts', 'otter_quiz_attempts_insert', 'with_check', 'workspace_id'),
  ('public', 'otter_quiz_attempts', 'otter_quiz_attempts_select', 'qual', 'workspace_id'),
  ('public', 'otter_subject_shares', 'otter_subject_share_select', 'qual', 'workspace_id'),
  ('public', 'otter_subjects', 'otter_subjects_delete', 'qual', 'workspace_id'),
  ('public', 'otter_subjects', 'otter_subjects_insert', 'with_check', 'workspace_id'),
  ('public', 'otter_subjects', 'otter_subjects_select', 'qual', 'workspace_id'),
  ('public', 'otter_subjects', 'otter_subjects_update', 'qual', 'workspace_id'),
  ('public', 'otter_subjects', 'otter_subjects_update', 'with_check', 'workspace_id'),
  ('public', 'phase_dependencies', 'phase_deps_delete', 'qual', 'pp.workspace_id'),
  ('public', 'phase_dependencies', 'phase_deps_insert', 'with_check', 'pp.workspace_id'),
  ('public', 'phase_dependencies', 'phase_deps_update', 'qual', 'pp.workspace_id'),
  ('public', 'phase_dependencies', 'phase_deps_update', 'with_check', 'pp.workspace_id'),
  ('public', 'phases', 'phases_delete', 'qual', 'p.workspace_id'),
  ('public', 'phases', 'phases_insert', 'with_check', 'p.workspace_id'),
  ('public', 'phases', 'phases_update', 'qual', 'p.workspace_id'),
  ('public', 'project_members', 'project_members_delete', 'qual', 'workspace_id'),
  ('public', 'project_members', 'project_members_insert', 'with_check', 'workspace_id'),
  ('public', 'project_members', 'project_members_select', 'qual', 'workspace_id'),
  ('public', 'project_members', 'project_members_update', 'qual', 'workspace_id'),
  ('public', 'project_members', 'project_members_update', 'with_check', 'workspace_id'),
  ('public', 'projects', 'projects_delete', 'qual', 'workspace_id'),
  ('public', 'projects', 'projects_insert', 'with_check', 'workspace_id'),
  ('public', 'projects', 'projects_select', 'qual', 'workspace_id'),
  ('public', 'projects', 'projects_update', 'qual', 'workspace_id'),
  ('public', 'rate_card_entries', 'rce_delete', 'qual', 'rc.workspace_id'),
  ('public', 'rate_card_entries', 'rce_insert', 'with_check', 'rc.workspace_id'),
  ('public', 'rate_card_entries', 'rce_select', 'qual', 'rc.workspace_id'),
  ('public', 'rate_card_entries', 'rce_update', 'qual', 'rc.workspace_id'),
  ('public', 'rate_cards', 'rate_cards_delete', 'qual', 'workspace_id'),
  ('public', 'rate_cards', 'rate_cards_insert', 'with_check', 'workspace_id'),
  ('public', 'rate_cards', 'rate_cards_select', 'qual', 'workspace_id'),
  ('public', 'rate_cards', 'rate_cards_update', 'qual', 'workspace_id'),
  ('public', 'scenes', 'scenes_delete', 'qual', 'workspace_id'),
  ('public', 'scenes', 'scenes_insert', 'with_check', 'workspace_id'),
  ('public', 'scenes', 'scenes_update', 'qual', 'workspace_id'),
  ('public', 'shot_list_items', 'shot_list_items_delete', 'qual', 'workspace_id'),
  ('public', 'shot_list_items', 'shot_list_items_insert', 'with_check', 'workspace_id'),
  ('public', 'shot_list_items', 'shot_list_items_update', 'qual', 'workspace_id'),
  ('public', 'shot_list_items', 'shot_list_items_update', 'with_check', 'workspace_id'),
  ('public', 'shot_lists', 'shot_lists_insert', 'with_check', 'workspace_id'),
  ('public', 'shot_lists', 'shot_lists_update', 'qual', 'workspace_id'),
  ('public', 'shot_lists', 'shot_lists_update', 'with_check', 'workspace_id'),
  ('public', 'shot_takes', 'shot_takes_delete', 'qual', 'workspace_id'),
  ('public', 'shot_takes', 'shot_takes_insert', 'with_check', 'workspace_id'),
  ('public', 'shot_takes', 'shot_takes_update', 'qual', 'workspace_id'),
  ('public', 'shot_takes', 'shot_takes_update', 'with_check', 'workspace_id'),
  ('public', 'shots', 'shots_delete', 'qual', 'workspace_id'),
  ('public', 'shots', 'shots_insert', 'with_check', 'workspace_id'),
  ('public', 'shots', 'shots_update', 'qual', 'workspace_id'),
  ('public', 'table_views', 'table_views_delete', 'qual', 'workspace_id'),
  ('public', 'table_views', 'table_views_insert', 'with_check', 'workspace_id'),
  ('public', 'table_views', 'table_views_select', 'qual', 'workspace_id'),
  ('public', 'table_views', 'table_views_update', 'qual', 'workspace_id'),
  ('public', 'table_views', 'table_views_update', 'with_check', 'workspace_id'),
  ('public', 'task_dependencies', 'task_deps_delete', 'qual', 'pre.workspace_id'),
  ('public', 'task_dependencies', 'task_deps_insert', 'with_check', 'pre.workspace_id'),
  ('public', 'task_dependencies', 'task_deps_update', 'qual', 'pre.workspace_id'),
  ('public', 'task_dependencies', 'task_deps_update', 'with_check', 'pre.workspace_id'),
  ('public', 'task_items', 'task_items_delete', 'qual', 'workspace_id'),
  ('public', 'task_items', 'task_items_insert', 'with_check', 'workspace_id'),
  ('public', 'task_items', 'task_items_update', 'qual', 'workspace_id'),
  ('public', 'task_items', 'task_items_update', 'with_check', 'workspace_id'),
  ('public', 'task_links', 'task_links_delete', 'qual', 't.workspace_id'),
  ('public', 'task_links', 'task_links_insert', 'with_check', 't.workspace_id'),
  ('public', 'task_links', 'task_links_update', 'qual', 't.workspace_id'),
  ('public', 'task_templates', 'task_templates_select', 'qual', 'workspace_id'),
  ('public', 'tasks', 'tasks_delete', 'qual', 'workspace_id'),
  ('public', 'tasks', 'tasks_insert', 'with_check', 'workspace_id'),
  ('public', 'tasks', 'tasks_update', 'qual', 'workspace_id'),
  ('public', 'upload_reservations', 'upload_reservations_select', 'qual', 'workspace_id'),
  ('public', 'user_model_overrides', 'user_model_overrides_delete', 'qual', 'workspace_id'),
  ('public', 'user_model_overrides', 'user_model_overrides_insert', 'with_check', 'workspace_id'),
  ('public', 'user_model_overrides', 'user_model_overrides_select', 'qual', 'workspace_id'),
  ('public', 'user_model_overrides', 'user_model_overrides_update', 'qual', 'workspace_id'),
  ('public', 'user_model_overrides', 'user_model_overrides_update', 'with_check', 'workspace_id'),
  ('public', 'workspace_audit', 'workspace_audit_select', 'qual', 'workspace_id'),
  ('public', 'workspace_model_overrides', 'workspace_model_overrides_admin_delete', 'qual', 'workspace_id'),
  ('public', 'workspace_model_overrides', 'workspace_model_overrides_admin_insert', 'with_check', 'workspace_id'),
  ('public', 'workspace_model_overrides', 'workspace_model_overrides_admin_update', 'qual', 'workspace_id'),
  ('public', 'workspace_model_overrides', 'workspace_model_overrides_admin_update', 'with_check', 'workspace_id'),
  ('public', 'workspace_model_overrides', 'workspace_model_overrides_select', 'qual', 'workspace_id'),
  ('public', 'workspace_storage', 'workspace_storage_delete', 'qual', 'workspace_id'),
  ('public', 'workspace_storage', 'workspace_storage_insert', 'with_check', 'workspace_id'),
  ('public', 'workspace_storage', 'workspace_storage_select', 'qual', 'workspace_id'),
  ('public', 'workspace_storage', 'workspace_storage_update', 'qual', 'workspace_id'),
  ('public', 'workspace_storage', 'workspace_storage_update', 'with_check', 'workspace_id'),
  ('public', 'workspace_storage_plans', 'workspace_storage_plans_select', 'qual', 'workspace_id'),
  ('public', 'workspaces', 'workspaces_admin_update', 'qual', 'id'),
  ('public', 'workspaces', 'workspaces_admin_update', 'with_check', 'id'),
  ('storage', 'objects', 'petal_bin_posters_delete_own', 'qual', 'public.current_workspace_id()'),
  ('storage', 'objects', 'petal_bin_posters_insert', 'with_check', 'public.current_workspace_id()'),
  ('storage', 'objects', 'petal_bin_posters_update', 'qual', 'public.current_workspace_id()'),
  ('storage', 'objects', 'petal_bin_posters_update', 'with_check', 'public.current_workspace_id()'),
  ('storage', 'objects', 'rabbit_files_delete_own', 'qual', 'public.current_workspace_id()'),
  ('storage', 'objects', 'rabbit_files_insert', 'with_check', 'public.current_workspace_id()'),
  ('storage', 'objects', 'rabbit_files_update', 'qual', 'public.current_workspace_id()'),
  ('storage', 'objects', 'rabbit_files_update', 'with_check', 'public.current_workspace_id()'),
  ('storage', 'objects', 'rabbit_thumbnails_delete_own', 'qual', 'public.current_workspace_id()'),
  ('storage', 'objects', 'rabbit_thumbnails_insert', 'with_check', 'public.current_workspace_id()'),
  ('storage', 'objects', 'rabbit_thumbnails_update', 'qual', 'public.current_workspace_id()'),
  ('storage', 'objects', 'rabbit_thumbnails_update', 'with_check', 'public.current_workspace_id()');

CREATE TEMP TABLE _f7_exception (sch text, tbl text, pol text, clause text, txt text) ON COMMIT DROP;
INSERT INTO _f7_exception (sch, tbl, pol, clause, txt) VALUES
  ('public', 'auth_events', 'auth_events_insert', 'with_check', '((source = ''client''::text) AND (user_id = auth.uid()) AND (kind = ANY (ARRAY[''sign_in''::text, ''sign_out''::text, ''idle_timeout''::text, ''session_cap''::text])) AND (outcome = ''success''::text) AND ((workspace_id IS NULL) OR public.has_active_membership(workspace_id)))'),
  ('public', 'workspace_members', 'ws_members_admin_write', 'qual', '((workspace_id = public.current_workspace_id()) AND (public.current_app_role() = ''admin''::text) AND public.has_active_membership(workspace_id))'),
  ('public', 'workspace_members', 'ws_members_admin_write', 'with_check', '((workspace_id = public.current_workspace_id()) AND (public.current_app_role() = ''admin''::text) AND public.has_active_membership(workspace_id))'),
  ('public', 'workspace_members', 'ws_members_select', 'qual', '((user_id = auth.uid()) OR ((workspace_id = public.current_workspace_id()) AND public.has_active_membership(workspace_id)))');

DO $$
DECLARE
  r        RECORD;
  v_sub    text := (SELECT t FROM _f7_sub);
  v_text   text;
  v_calls  int;
  v_subs   int;
BEGIN
  IF v_sub IS NULL OR pg_catalog.strpos(v_sub, 'public.has_active_membership(public.current_workspace_id())') = 0 THEN
    RAISE EXCEPTION '0137 refused: the probe did not deparse the sub-select (%)', v_sub;
  END IF;
  IF (SELECT count(*) FROM _f7_list) <> 218 OR (SELECT count(DISTINCT (sch, tbl, pol)) FROM _f7_list) <> 186
     OR (SELECT count(*) FROM _f7_exception) <> 4 THEN
    RAISE EXCEPTION '0137 refused: the list is not 186 policies and 218 clauses, with four clauses left';
  END IF;
  -- Every clause that calls the function is listed or is the exception.
  FOR r IN
    SELECT b.sch, b.tbl, b.pol, x.clause, x.txt
      FROM _f7_pol_before b
      CROSS JOIN LATERAL (VALUES ('qual', b.qual), ('with_check', b.with_check)) AS x(clause, txt)
     WHERE x.txt LIKE '%has_active_membership(%'
  LOOP
    IF NOT EXISTS (SELECT 1 FROM _f7_list l WHERE (l.sch, l.tbl, l.pol, l.clause) = (r.sch, r.tbl, r.pol, r.clause))
       AND NOT EXISTS (SELECT 1 FROM _f7_exception e WHERE (e.sch, e.tbl, e.pol, e.clause) = (r.sch, r.tbl, r.pol, r.clause)) THEN
      RAISE EXCEPTION '0137 refused: %.%.% (%) calls has_active_membership and this file did not classify it', r.sch, r.tbl, r.pol, r.clause;
    END IF;
  END LOOP;
  -- Every listed clause is here and holds exactly one call: per row, of the argument listed, or already the sub-select.
  FOR r IN SELECT l.*, b.qual, b.with_check, b.pol AS found FROM _f7_list l
             LEFT JOIN _f7_pol_before b ON (b.sch, b.tbl, b.pol) = (l.sch, l.tbl, l.pol)
  LOOP
    v_text := CASE r.clause WHEN 'qual' THEN r.qual ELSE r.with_check END;
    IF r.found IS NULL OR v_text IS NULL THEN
      RAISE EXCEPTION '0137 refused: %.%.% has no % to restate', r.sch, r.tbl, r.pol, r.clause;
    END IF;
    v_calls := (length(v_text) - length(replace(v_text, 'has_active_membership(', ''))) / length('has_active_membership(');
    v_subs  := (length(v_text) - length(replace(v_text, v_sub, ''))) / length(v_sub);
    IF NOT (v_calls = 1 AND (v_subs = 1 OR (v_subs = 0 AND pg_catalog.strpos(v_text, 'public.has_active_membership(' || r.arg || ')') > 0))) THEN
      RAISE EXCEPTION '0137 refused: %.%.% (%) is not one call of has_active_membership(%) as this file was built on',
        r.sch, r.tbl, r.pol, r.clause, r.arg;
    END IF;
  END LOOP;
  -- Each clause left alone is exactly dev's.
  FOR r IN SELECT e.*, CASE e.clause WHEN 'qual' THEN b.qual ELSE b.with_check END AS live
             FROM _f7_exception e LEFT JOIN _f7_pol_before b ON (b.sch, b.tbl, b.pol) = (e.sch, e.tbl, e.pol)
  LOOP
    IF r.live IS DISTINCT FROM r.txt THEN
      RAISE EXCEPTION '0137 refused: %.%.% (%) is not the text this file leaves alone', r.sch, r.tbl, r.pol, r.clause;
    END IF;
  END LOOP;
END
$$;

-- §3 The meter --------------------------------------------------------------------
-- The new body, first under a candidate's name. Then, in ONE statement (one snapshot), the old function and the
-- candidate for every workspace, for NULL and for an id no workspace has: any difference refuses the file.
CREATE OR REPLACE FUNCTION public._f7_meter_candidate(ws UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(c.bytes), 0)::bigint
    FROM (
      -- 1a. Under one of this workspace's projects by the key's canonical prefix, `projects/<id>/`, read as a byte range
      --     ('/' is 0x2F, '0' is 0x30): no function per object, and storage's (bucket_id, name COLLATE "C") index serves it.
      SELECT COALESCE(public.rabbit_object_incoming_bytes(o.metadata), 0) AS bytes
        FROM public.projects p
        JOIN storage.objects o
          ON o.bucket_id IN ('rabbit-files', 'rabbit-thumbnails')
         AND o.name COLLATE "C" >= ('projects/' || p.id::text || '/')
         AND o.name COLLATE "C" <  ('projects/' || p.id::text || '0')
       WHERE p.workspace_id = ws
      UNION ALL
      -- 1b. 0115's first arm verbatim, for a key whose second segment is NOT the canonical spelling (upper case, braces,
      --     missing or extra hyphens still name the project through fn_try_uuid). The cheap test keeps out exactly what
      --     1a counts, so fn_try_uuid runs only on what is left.
      SELECT COALESCE(public.rabbit_object_incoming_bytes(o.metadata), 0)
        FROM storage.objects o
        JOIN public.projects p
          ON p.id = public.fn_try_uuid((storage.foldername(o.name))[2])
       WHERE o.bucket_id IN ('rabbit-files', 'rabbit-thumbnails')
         AND split_part(o.name, '/', 2) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND (storage.foldername(o.name))[1] = 'projects'
         AND p.workspace_id = ws
      UNION ALL
      -- 2. 0115's second arm, unchanged: the copies this workspace's files name whose key names no project any more.
      SELECT COALESCE(public.rabbit_object_incoming_bytes(o.metadata), 0)
        FROM (
          SELECT 'rabbit-files'::text AS bucket, f.storage_path AS key
            FROM public.files f
           WHERE f.workspace_id = ws
             AND f.storage_provider = 'supabase'
             AND lower(split_part(f.storage_path, '/', 2)) <> f.project_id::text
          UNION
          SELECT 'rabbit-thumbnails'::text, f.thumbnail_url
            FROM public.files f
           WHERE f.workspace_id = ws
             AND f.storage_provider = 'supabase'
             AND lower(split_part(f.storage_path, '/', 2)) <> f.project_id::text
        ) m
        JOIN storage.objects o ON o.bucket_id = m.bucket AND o.name = m.key
       WHERE NOT EXISTS (SELECT 1 FROM public.projects p
                          WHERE p.id = public.fn_try_uuid((storage.foldername(o.name))[2]))
    ) c;
$$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT k.id, public.workspace_petal_committed_bytes(k.id) AS before_bytes, public._f7_meter_candidate(k.id) AS after_bytes
      FROM (SELECT w.id FROM public.workspaces w
            UNION ALL SELECT NULL::uuid
            UNION ALL SELECT 'f7f7f7f7-0000-4000-8000-000000000137'::uuid) AS k
  LOOP
    IF r.before_bytes IS DISTINCT FROM r.after_bytes THEN
      RAISE EXCEPTION '0137 refused: the new meter says % bytes for workspace %, the old one %', r.after_bytes, r.id, r.before_bytes;
    END IF;
  END LOOP;
END
$$;

DROP FUNCTION public._f7_meter_candidate(UUID);

CREATE OR REPLACE FUNCTION public.workspace_petal_committed_bytes(ws UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(c.bytes), 0)::bigint
    FROM (
      -- 1a. Under one of this workspace's projects by the key's canonical prefix, `projects/<id>/`, read as a byte range
      --     ('/' is 0x2F, '0' is 0x30): no function per object, and storage's (bucket_id, name COLLATE "C") index serves it.
      SELECT COALESCE(public.rabbit_object_incoming_bytes(o.metadata), 0) AS bytes
        FROM public.projects p
        JOIN storage.objects o
          ON o.bucket_id IN ('rabbit-files', 'rabbit-thumbnails')
         AND o.name COLLATE "C" >= ('projects/' || p.id::text || '/')
         AND o.name COLLATE "C" <  ('projects/' || p.id::text || '0')
       WHERE p.workspace_id = ws
      UNION ALL
      -- 1b. 0115's first arm verbatim, for a key whose second segment is NOT the canonical spelling (upper case, braces,
      --     missing or extra hyphens still name the project through fn_try_uuid). The cheap test keeps out exactly what
      --     1a counts, so fn_try_uuid runs only on what is left.
      SELECT COALESCE(public.rabbit_object_incoming_bytes(o.metadata), 0)
        FROM storage.objects o
        JOIN public.projects p
          ON p.id = public.fn_try_uuid((storage.foldername(o.name))[2])
       WHERE o.bucket_id IN ('rabbit-files', 'rabbit-thumbnails')
         AND split_part(o.name, '/', 2) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND (storage.foldername(o.name))[1] = 'projects'
         AND p.workspace_id = ws
      UNION ALL
      -- 2. 0115's second arm, unchanged: the copies this workspace's files name whose key names no project any more.
      SELECT COALESCE(public.rabbit_object_incoming_bytes(o.metadata), 0)
        FROM (
          SELECT 'rabbit-files'::text AS bucket, f.storage_path AS key
            FROM public.files f
           WHERE f.workspace_id = ws
             AND f.storage_provider = 'supabase'
             AND lower(split_part(f.storage_path, '/', 2)) <> f.project_id::text
          UNION
          SELECT 'rabbit-thumbnails'::text, f.thumbnail_url
            FROM public.files f
           WHERE f.workspace_id = ws
             AND f.storage_provider = 'supabase'
             AND lower(split_part(f.storage_path, '/', 2)) <> f.project_id::text
        ) m
        JOIN storage.objects o ON o.bucket_id = m.bucket AND o.name = m.key
       WHERE NOT EXISTS (SELECT 1 FROM public.projects p
                          WHERE p.id = public.fn_try_uuid((storage.foldername(o.name))[2]))
    ) c;
$$;
REVOKE ALL ON FUNCTION public.workspace_petal_committed_bytes(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_petal_committed_bytes(UUID) TO service_role;
COMMENT ON FUNCTION public.workspace_petal_committed_bytes(UUID) IS
  'Track C / 0073, restated by 0115 and 0137: bytes this workspace holds as COMMITTED objects in rabbit-files + rabbit-thumbnails. Every object under one of its projects (0137: by the canonical key prefix on storage''s index, and by 0115''s rule for any other spelling of the project''s id), plus the copies its files name whose key''s second segment names no project any more: a copy moved out of a project still counts after that project is purged. service_role only (0056).';

-- §4 ai-files' reads of app_events (before any ACCESS EXCLUSIVE lock: both builds and the analyse read the whole table)
-- readUploadRowsNaming and readCertifiedGone(ids): the rows naming these file ids. Every row, not only the AI ones:
-- partial on `tool`, the planner used it for that predicate alone in readAbsentNoted (2.4 ms became 78 ms on dev's
-- rehearsal); whole, it serves only a query that names file ids, and ANALYZE keeps statistics on its expression.
CREATE INDEX IF NOT EXISTS app_events_file_id_idx ON public.app_events ((context ->> 'file_id'));
-- readUploadRows(ws), the hottest: one workspace's AI file rows in id order, the order it pages in.
CREATE INDEX IF NOT EXISTS app_events_ai_files_ws_id_idx ON public.app_events (workspace_id, id)
  WHERE code = 'WIL-6001' AND (context ->> 'tool') = 'ai-files';
-- How common an AI row is: without these statistics the planner takes `tool = 'ai-files'` for 0.5% of the table (it is
-- 20% on dev) and misjudges both indexes.
CREATE STATISTICS IF NOT EXISTS public.app_events_context_tool_stats ON ((context ->> 'tool')) FROM public.app_events;
ANALYZE public.app_events;

-- §5 The 186 policies, restated --------------------------------------------------------
ALTER POLICY app_events_insert ON public.app_events
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (event_type <> 'admin'::text) AND ((code IS NULL) OR (code !~ '^WIL-41'::text))));

ALTER POLICY app_events_select ON public.app_events
  USING (((workspace_id = public.current_workspace_id()) AND (public.current_app_role() = 'admin'::text) AND (SELECT public.has_active_membership(public.current_workspace_id()))));

ALTER POLICY asset_versions_delete ON public.asset_versions
  USING ((EXISTS ( SELECT 1
   FROM public.assets a
  WHERE ((a.id = asset_versions.asset_id) AND (a.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(a.project_id)))));

ALTER POLICY asset_versions_insert ON public.asset_versions
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.assets a
  WHERE ((a.id = asset_versions.asset_id) AND (a.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(a.project_id)))));

ALTER POLICY asset_versions_update ON public.asset_versions
  USING ((EXISTS ( SELECT 1
   FROM public.assets a
  WHERE ((a.id = asset_versions.asset_id) AND (a.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(a.project_id)))));

ALTER POLICY assets_delete ON public.assets
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = assets.project_id)))));

ALTER POLICY assets_insert ON public.assets
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = assets.project_id)))));

ALTER POLICY assets_update ON public.assets
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = assets.project_id)))));

ALTER POLICY auth_events_select ON public.auth_events
  USING ((public.is_platform_operator() OR (user_id = auth.uid()) OR ((public.current_app_role() = 'admin'::text) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((workspace_id = public.current_workspace_id()) OR ((workspace_id IS NULL) AND public.is_member_of_current_workspace(user_id))))));

ALTER POLICY bin_files_delete ON public.bin_files
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = bin_files.project_id)))));

ALTER POLICY bin_files_insert ON public.bin_files
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = bin_files.project_id)))));

ALTER POLICY bin_files_update ON public.bin_files
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = bin_files.project_id)))))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = bin_files.project_id)))));

ALTER POLICY bin_locations_delete ON public.bin_locations
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.workspace_id = bin_locations.workspace_id) AND public.can_edit_shot_lists(p.id))))));

ALTER POLICY bin_locations_insert ON public.bin_locations
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.workspace_id = bin_locations.workspace_id) AND public.can_edit_shot_lists(p.id))))));

ALTER POLICY bin_locations_select ON public.bin_locations
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))));

ALTER POLICY bin_locations_update ON public.bin_locations
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.workspace_id = bin_locations.workspace_id) AND public.can_edit_shot_lists(p.id))))))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.workspace_id = bin_locations.workspace_id) AND public.can_edit_shot_lists(p.id))))));

ALTER POLICY bins_delete ON public.bins
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = bins.project_id)))));

ALTER POLICY bins_insert ON public.bins
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = bins.project_id)))));

ALTER POLICY bins_update ON public.bins
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = bins.project_id)))))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = bins.project_id)))));

ALTER POLICY comments_delete ON public.comments
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_comment_project(public.fn_comment_project_id(entity_type, entity_id)) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = public.fn_comment_project_id(comments.entity_type, comments.entity_id))))));

ALTER POLICY comments_insert ON public.comments
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_comment_project(public.fn_comment_project_id(entity_type, entity_id)) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = public.fn_comment_project_id(comments.entity_type, comments.entity_id))))));

ALTER POLICY comments_update ON public.comments
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_comment_project(public.fn_comment_project_id(entity_type, entity_id)) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = public.fn_comment_project_id(comments.entity_type, comments.entity_id))))));

ALTER POLICY edit_history_select ON public.edit_history
  USING (((workspace_id = public.current_workspace_id()) AND (public.current_app_role() = ANY (ARRAY['admin'::text, 'manager'::text])) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((NOT is_financial) OR (public.current_app_role() = 'admin'::text) OR COALESCE(public.can_access_project_money(project_id), false) OR (is_legal AND COALESCE(public.can_access_project_legal(project_id), false))) AND ((entity_type = ANY (ARRAY['rate_cards'::text, 'rate_card_entries'::text])) OR (public.current_app_role() = 'admin'::text) OR (public.can_read_project_topic(project_id) AND ((NOT captured_private) OR (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = edit_history.project_id) AND (p.created_by = auth.uid())))))))));

ALTER POLICY edits_insert ON public.edits
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = edits.project_id)))));

ALTER POLICY edits_update ON public.edits
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = edits.project_id)))))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = edits.project_id)))));

ALTER POLICY experiences_delete ON public.experiences
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = experiences.project_id)))));

ALTER POLICY experiences_insert ON public.experiences
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = experiences.project_id)))));

ALTER POLICY experiences_update ON public.experiences
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = experiences.project_id)))));

ALTER POLICY file_events_select ON public.file_events
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (public.can_read_project_topic(project_id) OR (public.current_app_role() = 'admin'::text)) AND ((NOT is_financial) OR (public.current_app_role() = 'admin'::text) OR COALESCE(public.can_access_project_money(project_id), false) OR (public.file_event_is_legal(old_path, new_path) AND COALESCE(public.can_access_project_legal(project_id), false))) AND ((event <> 'viewed_remote'::text) OR public.is_live_workspace_admin(workspace_id)) AND ((NOT captured_private) OR (public.current_app_role() = 'admin'::text) OR (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = file_events.project_id) AND (p.created_by = auth.uid())))))));

ALTER POLICY files_delete ON public.files
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND ((NOT public.file_row_is_money(is_financial, storage_path)) OR public.can_access_project_money(project_id) OR (public.file_row_is_legal(is_financial, storage_path) AND public.can_access_project_legal(project_id))) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = files.project_id)))));

ALTER POLICY files_insert ON public.files
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND ((NOT public.file_row_is_money(is_financial, storage_path)) OR public.can_access_project_money(project_id) OR (public.file_row_is_legal(is_financial, storage_path) AND public.can_access_project_legal(project_id))) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = files.project_id)))));

ALTER POLICY files_update ON public.files
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND ((NOT public.file_row_is_money(is_financial, storage_path)) OR public.can_access_project_money(project_id) OR (public.file_row_is_legal(is_financial, storage_path) AND public.can_access_project_legal(project_id))) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = files.project_id)))));

ALTER POLICY folders_delete ON public.folders
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = folders.project_id)))));

ALTER POLICY folders_insert ON public.folders
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = folders.project_id)))));

ALTER POLICY folders_update ON public.folders
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = folders.project_id)))));

ALTER POLICY gateway_enrolment_tokens_delete ON public.gateway_enrolment_tokens
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.is_live_workspace_admin(workspace_id) AND (used_at IS NULL) AND public.two_factor_satisfied()));

ALTER POLICY gateway_enrolment_tokens_select ON public.gateway_enrolment_tokens
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.is_live_workspace_admin(workspace_id)));

ALTER POLICY gateways_select ON public.gateways
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.is_live_workspace_admin(workspace_id)));

ALTER POLICY gateways_update ON public.gateways
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.is_live_workspace_admin(workspace_id) AND public.two_factor_satisfied()))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.is_live_workspace_admin(workspace_id) AND public.two_factor_satisfied()));

ALTER POLICY ingestion_chunks_delete ON public.ingestion_chunks
  USING ((EXISTS ( SELECT 1
   FROM (public.ingestion_runs r
     JOIN public.projects p ON ((p.id = r.project_id)))
  WHERE ((r.id = ingestion_chunks.run_id) AND (p.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(r.project_id)))));

ALTER POLICY ingestion_chunks_insert ON public.ingestion_chunks
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.ingestion_runs r
     JOIN public.projects p ON ((p.id = r.project_id)))
  WHERE ((r.id = ingestion_chunks.run_id) AND (p.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(r.project_id)))));

ALTER POLICY ingestion_chunks_update ON public.ingestion_chunks
  USING ((EXISTS ( SELECT 1
   FROM (public.ingestion_runs r
     JOIN public.projects p ON ((p.id = r.project_id)))
  WHERE ((r.id = ingestion_chunks.run_id) AND (p.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(r.project_id)))));

ALTER POLICY ingestion_runs_delete ON public.ingestion_runs
  USING (((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = ingestion_runs.project_id) AND (p.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))))) AND public.can_write_project(project_id)));

ALTER POLICY ingestion_runs_insert ON public.ingestion_runs
  WITH CHECK (((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = ingestion_runs.project_id) AND (p.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))))) AND public.can_write_project(project_id)));

ALTER POLICY ingestion_runs_update ON public.ingestion_runs
  USING (((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = ingestion_runs.project_id) AND (p.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))))) AND public.can_write_project(project_id)));

ALTER POLICY item_groupings_delete ON public.item_groupings
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = item_groupings.project_id)))));

ALTER POLICY item_groupings_insert ON public.item_groupings
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = item_groupings.project_id)))));

ALTER POLICY item_groupings_select ON public.item_groupings
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = item_groupings.project_id)))));

ALTER POLICY item_groupings_update ON public.item_groupings
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = item_groupings.project_id)))))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = item_groupings.project_id)))));

ALTER POLICY levels_delete ON public.levels
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = levels.project_id)))));

ALTER POLICY levels_insert ON public.levels
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = levels.project_id)))));

ALTER POLICY levels_update ON public.levels
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = levels.project_id)))));

ALTER POLICY milestones_delete ON public.milestones
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = milestones.project_id)))));

ALTER POLICY milestones_insert ON public.milestones
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = milestones.project_id)))));

ALTER POLICY milestones_update ON public.milestones
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = milestones.project_id)))));

ALTER POLICY moth_layout_positions_select ON public.moth_layout_positions
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (EXISTS ( SELECT 1
   FROM public.moth_views v
  WHERE ((v.id = moth_layout_positions.view_id) AND (v.workspace_id = moth_layout_positions.workspace_id)))) AND ((owner_id IS NULL) OR (owner_id = auth.uid())) AND ((target_type = 'tag'::text) OR public.moth_can_read_target(target_type, target_id))));

ALTER POLICY moth_relationships_delete ON public.moth_relationships
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (origin = 'manual'::text) AND public.moth_can_write_target(source_type, source_id)));

ALTER POLICY moth_relationships_insert ON public.moth_relationships
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (origin = 'manual'::text) AND public.moth_can_write_target(source_type, source_id) AND public.moth_can_read_target(dest_type, dest_id)));

ALTER POLICY moth_relationships_select ON public.moth_relationships
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.moth_can_read_target(source_type, source_id) AND public.moth_can_read_target(dest_type, dest_id)));

ALTER POLICY moth_relationships_update ON public.moth_relationships
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (origin = 'manual'::text) AND public.moth_can_write_target(source_type, source_id)))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (origin = 'manual'::text) AND public.moth_can_write_target(source_type, source_id) AND public.moth_can_read_target(dest_type, dest_id)));

ALTER POLICY moth_tag_assignments_delete ON public.moth_tag_assignments
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (((tier = 'company'::text) AND public.moth_can_write_target(target_type, target_id)) OR ((tier = 'personal'::text) AND (owner_id = auth.uid())))));

ALTER POLICY moth_tag_assignments_insert ON public.moth_tag_assignments
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (((tier = 'company'::text) AND (owner_id IS NULL) AND public.moth_can_write_target(target_type, target_id)) OR ((tier = 'personal'::text) AND (owner_id = auth.uid()) AND public.moth_can_read_target(target_type, target_id)))));

ALTER POLICY moth_tag_assignments_select ON public.moth_tag_assignments
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((tier = 'company'::text) OR (owner_id = auth.uid())) AND (EXISTS ( SELECT 1
   FROM public.moth_tags t
  WHERE ((t.id = moth_tag_assignments.tag_id) AND (t.workspace_id = moth_tag_assignments.workspace_id)))) AND public.moth_can_read_target(target_type, target_id)));

ALTER POLICY moth_tag_nominations_select ON public.moth_tag_nominations
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((proposer_id = auth.uid()) OR public.is_live_workspace_admin(workspace_id))));

ALTER POLICY moth_tag_types_delete ON public.moth_tag_types
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (tier = 'personal'::text) AND (owner_id = auth.uid())));

ALTER POLICY moth_tag_types_insert ON public.moth_tag_types
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (((tier = 'company'::text) AND public.is_live_workspace_admin(workspace_id)) OR ((tier = 'personal'::text) AND (owner_id = auth.uid())))));

ALTER POLICY moth_tag_types_select ON public.moth_tag_types
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((tier = 'company'::text) OR (owner_id = auth.uid()))));

ALTER POLICY moth_tag_types_update ON public.moth_tag_types
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (((tier = 'company'::text) AND public.is_live_workspace_admin(workspace_id)) OR ((tier = 'personal'::text) AND (owner_id = auth.uid())))))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (((tier = 'company'::text) AND public.is_live_workspace_admin(workspace_id)) OR ((tier = 'personal'::text) AND (owner_id = auth.uid())))));

ALTER POLICY moth_tags_delete ON public.moth_tags
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (tier = 'personal'::text) AND (owner_id = auth.uid())));

ALTER POLICY moth_tags_insert ON public.moth_tags
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (((tier = 'company'::text) AND public.is_live_workspace_admin(workspace_id)) OR ((tier = 'personal'::text) AND (owner_id = auth.uid())))));

ALTER POLICY moth_tags_select ON public.moth_tags
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((tier = 'company'::text) OR (owner_id = auth.uid()))));

ALTER POLICY moth_tags_update ON public.moth_tags
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (((tier = 'company'::text) AND public.is_live_workspace_admin(workspace_id)) OR ((tier = 'personal'::text) AND (owner_id = auth.uid())))))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (((tier = 'company'::text) AND public.is_live_workspace_admin(workspace_id)) OR ((tier = 'personal'::text) AND (owner_id = auth.uid())))));

ALTER POLICY moth_views_delete ON public.moth_views
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (((scope_kind = 'project'::text) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = moth_views.project_id) AND (p.workspace_id = moth_views.workspace_id)))) AND public.moth_can_write_target('project'::text, project_id)) OR ((scope_kind = 'aggregate'::text) AND (owner_id = auth.uid())))));

ALTER POLICY moth_views_insert ON public.moth_views
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (((scope_kind = 'project'::text) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = moth_views.project_id) AND (p.workspace_id = moth_views.workspace_id)))) AND public.moth_can_write_target('project'::text, project_id)) OR ((scope_kind = 'aggregate'::text) AND (owner_id = auth.uid())))));

ALTER POLICY moth_views_select ON public.moth_views
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (((scope_kind = 'project'::text) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = moth_views.project_id) AND (p.workspace_id = moth_views.workspace_id)))) AND public.moth_can_read_target('project'::text, project_id)) OR ((scope_kind = 'aggregate'::text) AND (owner_id = auth.uid())))));

ALTER POLICY moth_views_update ON public.moth_views
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (((scope_kind = 'project'::text) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = moth_views.project_id) AND (p.workspace_id = moth_views.workspace_id)))) AND public.moth_can_write_target('project'::text, project_id)) OR ((scope_kind = 'aggregate'::text) AND (owner_id = auth.uid())))))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (((scope_kind = 'project'::text) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = moth_views.project_id) AND (p.workspace_id = moth_views.workspace_id)))) AND public.moth_can_write_target('project'::text, project_id)) OR ((scope_kind = 'aggregate'::text) AND (owner_id = auth.uid())))));

ALTER POLICY network_share_checks_select ON public.network_share_checks
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = network_share_checks.project_id) AND (p.deleted_at IS NULL))))));

ALTER POLICY note_subjects_delete ON public.note_subjects
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (owner_id = auth.uid())));

ALTER POLICY note_subjects_insert ON public.note_subjects
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (owner_id = auth.uid())));

ALTER POLICY note_subjects_update ON public.note_subjects
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (owner_id = auth.uid())))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (owner_id = auth.uid())));

ALTER POLICY notes_insert ON public.notes
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (owner_id = auth.uid())));

ALTER POLICY notes_select ON public.notes
  USING (((workspace_id = public.current_workspace_id()) AND (deleted_at IS NULL) AND ((owner_id = auth.uid()) OR ((tier <> 'personal'::text) AND (SELECT public.has_active_membership(public.current_workspace_id()))))));

ALTER POLICY notes_update ON public.notes
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((owner_id = auth.uid()) OR ((tier <> 'personal'::text) AND public.is_live_workspace_admin(workspace_id)))))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((owner_id = auth.uid()) OR ((tier <> 'personal'::text) AND public.is_live_workspace_admin(workspace_id)))));

ALTER POLICY otter_cr_insert ON public.otter_change_requests
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (proposed_by = auth.uid()) AND (status = 'open'::text) AND (reviewed_by IS NULL) AND (reviewed_at IS NULL) AND (review_note IS NULL) AND (revision = 1) AND (applied_at IS NULL) AND (applied_by IS NULL) AND (archive_course_id IS NULL) AND (acknowledged_at IS NULL) AND (public.otter_course_visibility(target_course_id) = 'company_standard'::text) AND (EXISTS ( SELECT 1
   FROM public.otter_courses c
  WHERE (c.id = otter_change_requests.target_course_id))) AND ((source_course_id IS NULL) OR public.otter_is_course_owner(source_course_id))));

ALTER POLICY otter_cr_select ON public.otter_change_requests
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((proposed_by = auth.uid()) OR (public.current_app_role() = ANY (ARRAY['admin'::text, 'manager'::text])) OR public.otter_is_course_owner(target_course_id))));

ALTER POLICY otter_cr_update ON public.otter_change_requests
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((proposed_by = auth.uid()) OR (public.current_app_role() = 'admin'::text) OR public.otter_is_course_owner(target_course_id))))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((public.current_app_role() = 'admin'::text) OR public.otter_is_course_owner(target_course_id) OR ((proposed_by = auth.uid()) AND (status = ANY (ARRAY['open'::text, 'withdrawn'::text, 'rejected'::text]))))));

ALTER POLICY otter_course_editors_delete ON public.otter_course_editors
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (public.otter_is_course_owner(course_id) OR (public.current_app_role() = 'admin'::text) OR (user_id = auth.uid()))));

ALTER POLICY otter_course_editors_insert ON public.otter_course_editors
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (public.otter_is_course_owner(course_id) OR ((public.current_app_role() = 'admin'::text) AND (public.otter_course_visibility(course_id) <> 'personal'::text)))));

ALTER POLICY otter_course_editors_select ON public.otter_course_editors
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((user_id = auth.uid()) OR public.otter_is_course_owner(course_id) OR (public.current_app_role() = 'admin'::text))));

ALTER POLICY otter_nom_insert ON public.otter_course_nominations
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (proposed_by = auth.uid()) AND (status = 'open'::text) AND (revision = 1) AND (reviewed_by IS NULL) AND (reviewed_at IS NULL) AND (review_note IS NULL) AND (applied_at IS NULL) AND (applied_by IS NULL) AND (superseded_course_id IS NULL) AND (acknowledged_at IS NULL) AND public.otter_is_course_owner(course_id) AND (public.otter_course_visibility(course_id) <> 'company_standard'::text) AND (EXISTS ( SELECT 1
   FROM public.otter_courses c
  WHERE (c.id = otter_course_nominations.course_id)))));

ALTER POLICY otter_nom_select ON public.otter_course_nominations
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((proposed_by = auth.uid()) OR (public.current_app_role() = ANY (ARRAY['admin'::text, 'manager'::text])))));

ALTER POLICY otter_nom_update ON public.otter_course_nominations
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((proposed_by = auth.uid()) OR (public.current_app_role() = ANY (ARRAY['admin'::text, 'manager'::text])))))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((public.current_app_role() = ANY (ARRAY['admin'::text, 'manager'::text])) OR ((proposed_by = auth.uid()) AND (status = ANY (ARRAY['open'::text, 'withdrawn'::text, 'rejected'::text]))))));

ALTER POLICY otter_courses_delete ON public.otter_courses
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((owner_id = auth.uid()) OR (public.current_app_role() = 'admin'::text))));

ALTER POLICY otter_courses_insert ON public.otter_courses
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (owner_id = auth.uid()) AND (deleted_at IS NULL) AND ((visibility <> 'company_standard'::text) OR (public.current_app_role() = 'admin'::text))));

ALTER POLICY otter_courses_select ON public.otter_courses
  USING (((deleted_at IS NULL) AND (workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((owner_id = auth.uid()) OR (visibility = ANY (ARRAY['shared'::text, 'company_standard'::text])) OR public.otter_has_editor_grant(id) OR public.otter_has_open_review_access(id) OR public.otter_has_open_nomination_access(id))));

ALTER POLICY otter_courses_update ON public.otter_courses
  USING (((deleted_at IS NULL) AND (workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.otter_can_write_course(id)))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.otter_can_write_course(id) AND (deleted_at IS NULL) AND ((visibility <> 'company_standard'::text) OR (public.current_app_role() = 'admin'::text))));

ALTER POLICY otter_progress_delete ON public.otter_progress
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (user_id = auth.uid())));

ALTER POLICY otter_progress_insert ON public.otter_progress
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.otter_courses c
  WHERE (c.id = otter_progress.course_id)))));

ALTER POLICY otter_progress_select ON public.otter_progress
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (user_id = auth.uid())));

ALTER POLICY otter_progress_update ON public.otter_progress
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (user_id = auth.uid())))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (user_id = auth.uid())));

ALTER POLICY otter_quiz_attempts_delete ON public.otter_quiz_attempts
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (user_id = auth.uid())));

ALTER POLICY otter_quiz_attempts_insert ON public.otter_quiz_attempts
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (user_id = auth.uid())));

ALTER POLICY otter_quiz_attempts_select ON public.otter_quiz_attempts
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (user_id = auth.uid()) AND (taken_at >= (now() - '30 days'::interval))));

ALTER POLICY otter_subject_share_select ON public.otter_subject_shares
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((shared_by = auth.uid()) OR (shared_with = auth.uid()) OR (subject_owner_id = auth.uid()))));

ALTER POLICY otter_subjects_delete ON public.otter_subjects
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.otter_can_write_course(course_id)));

ALTER POLICY otter_subjects_insert ON public.otter_subjects
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (deleted_at IS NULL) AND public.otter_can_write_course(course_id)));

ALTER POLICY otter_subjects_select ON public.otter_subjects
  USING (((deleted_at IS NULL) AND (workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((EXISTS ( SELECT 1
   FROM public.otter_courses c
  WHERE (c.id = otter_subjects.course_id))) OR public.otter_has_accepted_subject_share(id))));

ALTER POLICY otter_subjects_update ON public.otter_subjects
  USING (((deleted_at IS NULL) AND (workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.otter_can_write_course(course_id)))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.otter_can_write_course(course_id) AND (deleted_at IS NULL)));

ALTER POLICY phase_deps_delete ON public.phase_dependencies
  USING ((EXISTS ( SELECT 1
   FROM (public.phases pre
     JOIN public.projects pp ON ((pp.id = pre.project_id)))
  WHERE ((pre.id = phase_dependencies.predecessor_id) AND (pp.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(pp.id)))));

ALTER POLICY phase_deps_insert ON public.phase_dependencies
  WITH CHECK (((EXISTS ( SELECT 1
   FROM (public.phases pre
     JOIN public.projects pp ON ((pp.id = pre.project_id)))
  WHERE ((pre.id = phase_dependencies.predecessor_id) AND (pp.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(pp.id)))) AND (EXISTS ( SELECT 1
   FROM (public.phases suc
     JOIN public.projects sp ON ((sp.id = suc.project_id)))
  WHERE ((suc.id = phase_dependencies.successor_id) AND (sp.workspace_id = public.current_workspace_id()))))));

ALTER POLICY phase_deps_update ON public.phase_dependencies
  USING ((EXISTS ( SELECT 1
   FROM (public.phases pre
     JOIN public.projects pp ON ((pp.id = pre.project_id)))
  WHERE ((pre.id = phase_dependencies.predecessor_id) AND (pp.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(pp.id)))))
  WITH CHECK (((EXISTS ( SELECT 1
   FROM (public.phases pre
     JOIN public.projects pp ON ((pp.id = pre.project_id)))
  WHERE ((pre.id = phase_dependencies.predecessor_id) AND (pp.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(pp.id)))) AND (EXISTS ( SELECT 1
   FROM (public.phases suc
     JOIN public.projects sp ON ((sp.id = suc.project_id)))
  WHERE ((suc.id = phase_dependencies.successor_id) AND (sp.workspace_id = public.current_workspace_id()))))));

ALTER POLICY phases_delete ON public.phases
  USING (((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = phases.project_id) AND (p.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))))) AND public.can_write_project(project_id)));

ALTER POLICY phases_insert ON public.phases
  WITH CHECK (((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = phases.project_id) AND (p.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))))) AND public.can_write_project(project_id)));

ALTER POLICY phases_update ON public.phases
  USING (((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = phases.project_id) AND (p.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))))) AND public.can_write_project(project_id)));

ALTER POLICY project_members_delete ON public.project_members
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_manage_project_roster(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = project_members.project_id)))));

ALTER POLICY project_members_insert ON public.project_members
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_manage_project_roster(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = project_members.project_id)))));

ALTER POLICY project_members_select ON public.project_members
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = project_members.project_id)))));

ALTER POLICY project_members_update ON public.project_members
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_manage_project_roster(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = project_members.project_id)))))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_manage_project_roster(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = project_members.project_id)))));

ALTER POLICY projects_delete ON public.projects
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (public.current_app_role() = 'admin'::text) AND (personal_owner_id IS NULL)));

ALTER POLICY projects_insert ON public.projects
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (public.current_app_role() = ANY (ARRAY['admin'::text, 'manager'::text])) AND (personal_owner_id IS NULL)));

ALTER POLICY projects_select ON public.projects
  USING (((deleted_at IS NULL) AND (workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((NOT is_private) OR (created_by = auth.uid()) OR (public.current_app_role() = 'admin'::text))));

ALTER POLICY projects_update ON public.projects
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(id) AND ((NOT is_private) OR (created_by = auth.uid()) OR (public.current_app_role() = 'admin'::text)) AND ((personal_owner_id IS NULL) OR (personal_owner_id = auth.uid()))));

ALTER POLICY rce_delete ON public.rate_card_entries
  USING (((EXISTS ( SELECT 1
   FROM public.rate_cards rc
  WHERE ((rc.id = rate_card_entries.rate_card_id) AND (rc.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))))) AND ((public.current_app_role() = 'admin'::text) OR public.has_rate_card_grant('edit'::text))));

ALTER POLICY rce_insert ON public.rate_card_entries
  WITH CHECK (((EXISTS ( SELECT 1
   FROM public.rate_cards rc
  WHERE ((rc.id = rate_card_entries.rate_card_id) AND (rc.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))))) AND ((public.current_app_role() = 'admin'::text) OR public.has_rate_card_grant('edit'::text))));

ALTER POLICY rce_select ON public.rate_card_entries
  USING (((EXISTS ( SELECT 1
   FROM public.rate_cards rc
  WHERE ((rc.id = rate_card_entries.rate_card_id) AND (rc.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))))) AND ((public.current_app_role() = ANY (ARRAY['admin'::text, 'manager'::text])) OR public.has_rate_card_grant('view'::text))));

ALTER POLICY rce_update ON public.rate_card_entries
  USING (((EXISTS ( SELECT 1
   FROM public.rate_cards rc
  WHERE ((rc.id = rate_card_entries.rate_card_id) AND (rc.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))))) AND ((public.current_app_role() = 'admin'::text) OR public.has_rate_card_grant('edit'::text))));

ALTER POLICY rate_cards_delete ON public.rate_cards
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))));

ALTER POLICY rate_cards_insert ON public.rate_cards
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))));

ALTER POLICY rate_cards_select ON public.rate_cards
  USING (((deleted_at IS NULL) AND (workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))));

ALTER POLICY rate_cards_update ON public.rate_cards
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))));

ALTER POLICY scenes_delete ON public.scenes
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = scenes.project_id)))));

ALTER POLICY scenes_insert ON public.scenes
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = scenes.project_id)))));

ALTER POLICY scenes_update ON public.scenes
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = scenes.project_id)))));

ALTER POLICY shot_list_items_delete ON public.shot_list_items
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = shot_list_items.project_id)))));

ALTER POLICY shot_list_items_insert ON public.shot_list_items
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = shot_list_items.project_id)))));

ALTER POLICY shot_list_items_update ON public.shot_list_items
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = shot_list_items.project_id)))))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = shot_list_items.project_id)))));

ALTER POLICY shot_lists_insert ON public.shot_lists
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = shot_lists.project_id)))));

ALTER POLICY shot_lists_update ON public.shot_lists
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = shot_lists.project_id)))))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = shot_lists.project_id)))));

ALTER POLICY shot_takes_delete ON public.shot_takes
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = shot_takes.project_id)))));

ALTER POLICY shot_takes_insert ON public.shot_takes
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = shot_takes.project_id)))));

ALTER POLICY shot_takes_update ON public.shot_takes
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = shot_takes.project_id)))))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = shot_takes.project_id)))));

ALTER POLICY shots_delete ON public.shots
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = shots.project_id)))));

ALTER POLICY shots_insert ON public.shots
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = shots.project_id)))));

ALTER POLICY shots_update ON public.shots
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = shots.project_id)))));

ALTER POLICY table_views_delete ON public.table_views
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = table_views.project_id)))));

ALTER POLICY table_views_insert ON public.table_views
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = table_views.project_id)))));

ALTER POLICY table_views_select ON public.table_views
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = table_views.project_id)))));

ALTER POLICY table_views_update ON public.table_views
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = table_views.project_id)))))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = table_views.project_id)))));

ALTER POLICY task_deps_delete ON public.task_dependencies
  USING ((EXISTS ( SELECT 1
   FROM public.tasks pre
  WHERE ((pre.id = task_dependencies.predecessor_id) AND (pre.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(pre.project_id)))));

ALTER POLICY task_deps_insert ON public.task_dependencies
  WITH CHECK (((EXISTS ( SELECT 1
   FROM public.tasks pre
  WHERE ((pre.id = task_dependencies.predecessor_id) AND (pre.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(pre.project_id)))) AND (EXISTS ( SELECT 1
   FROM public.tasks suc
  WHERE ((suc.id = task_dependencies.successor_id) AND (suc.workspace_id = public.current_workspace_id()))))));

ALTER POLICY task_deps_update ON public.task_dependencies
  USING ((EXISTS ( SELECT 1
   FROM public.tasks pre
  WHERE ((pre.id = task_dependencies.predecessor_id) AND (pre.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(pre.project_id)))))
  WITH CHECK (((EXISTS ( SELECT 1
   FROM public.tasks pre
  WHERE ((pre.id = task_dependencies.predecessor_id) AND (pre.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(pre.project_id)))) AND (EXISTS ( SELECT 1
   FROM public.tasks suc
  WHERE ((suc.id = task_dependencies.successor_id) AND (suc.workspace_id = public.current_workspace_id()))))));

ALTER POLICY task_items_delete ON public.task_items
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = task_items.project_id))) AND (EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE (t.id = task_items.task_id)))));

ALTER POLICY task_items_insert ON public.task_items
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = task_items.project_id))) AND (EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE (t.id = task_items.task_id)))));

ALTER POLICY task_items_update ON public.task_items
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = task_items.project_id))) AND (EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE (t.id = task_items.task_id)))))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = task_items.project_id))) AND (EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE (t.id = task_items.task_id)))));

ALTER POLICY task_links_delete ON public.task_links
  USING ((EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE ((t.id = task_links.task_id) AND (t.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(t.project_id)))));

ALTER POLICY task_links_insert ON public.task_links
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE ((t.id = task_links.task_id) AND (t.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(t.project_id)))));

ALTER POLICY task_links_update ON public.task_links
  USING ((EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE ((t.id = task_links.task_id) AND (t.workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(t.project_id)))));

ALTER POLICY task_templates_select ON public.task_templates
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((project_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = task_templates.project_id))))));

ALTER POLICY tasks_delete ON public.tasks
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = tasks.project_id)))));

ALTER POLICY tasks_insert ON public.tasks
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = tasks.project_id)))));

ALTER POLICY tasks_update ON public.tasks
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(project_id) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = tasks.project_id)))));

ALTER POLICY upload_reservations_select ON public.upload_reservations
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (created_by = auth.uid())));

ALTER POLICY user_model_overrides_delete ON public.user_model_overrides
  USING (((user_id = auth.uid()) AND (workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))));

ALTER POLICY user_model_overrides_insert ON public.user_model_overrides
  WITH CHECK (((user_id = auth.uid()) AND (workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))));

ALTER POLICY user_model_overrides_select ON public.user_model_overrides
  USING (((user_id = auth.uid()) AND (workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))));

ALTER POLICY user_model_overrides_update ON public.user_model_overrides
  USING (((user_id = auth.uid()) AND (workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))))
  WITH CHECK (((user_id = auth.uid()) AND (workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))));

ALTER POLICY workspace_audit_select ON public.workspace_audit
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.is_live_workspace_admin(workspace_id)));

ALTER POLICY workspace_model_overrides_admin_delete ON public.workspace_model_overrides
  USING (((workspace_id = public.current_workspace_id()) AND (public.current_app_role() = 'admin'::text) AND (SELECT public.has_active_membership(public.current_workspace_id()))));

ALTER POLICY workspace_model_overrides_admin_insert ON public.workspace_model_overrides
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (public.current_app_role() = 'admin'::text) AND (SELECT public.has_active_membership(public.current_workspace_id()))));

ALTER POLICY workspace_model_overrides_admin_update ON public.workspace_model_overrides
  USING (((workspace_id = public.current_workspace_id()) AND (public.current_app_role() = 'admin'::text) AND (SELECT public.has_active_membership(public.current_workspace_id()))))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (public.current_app_role() = 'admin'::text) AND (SELECT public.has_active_membership(public.current_workspace_id()))));

ALTER POLICY workspace_model_overrides_select ON public.workspace_model_overrides
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))));

ALTER POLICY workspace_storage_delete ON public.workspace_storage
  USING (((workspace_id = public.current_workspace_id()) AND (public.current_app_role() = 'admin'::text) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.two_factor_satisfied()));

ALTER POLICY workspace_storage_insert ON public.workspace_storage
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (public.current_app_role() = 'admin'::text) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.two_factor_satisfied()));

ALTER POLICY workspace_storage_select ON public.workspace_storage
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id()))));

ALTER POLICY workspace_storage_update ON public.workspace_storage
  USING (((workspace_id = public.current_workspace_id()) AND (public.current_app_role() = 'admin'::text) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.two_factor_satisfied()))
  WITH CHECK (((workspace_id = public.current_workspace_id()) AND (public.current_app_role() = 'admin'::text) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.two_factor_satisfied()));

ALTER POLICY workspace_storage_plans_select ON public.workspace_storage_plans
  USING (((workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND (public.current_app_role() = 'admin'::text)));

ALTER POLICY workspaces_admin_update ON public.workspaces
  USING (((id = public.current_workspace_id()) AND (public.current_app_role() = 'admin'::text) AND (SELECT public.has_active_membership(public.current_workspace_id()))))
  WITH CHECK (((id = public.current_workspace_id()) AND (public.current_app_role() = 'admin'::text) AND (SELECT public.has_active_membership(public.current_workspace_id()))));

ALTER POLICY petal_bin_posters_delete_own ON storage.objects
  USING (((bucket_id = 'rabbit-thumbnails'::text) AND (owner_id = (auth.uid())::text) AND ((storage.foldername(name))[1] = 'projects'::text) AND ((storage.foldername(name))[3] = 'bin_files'::text) AND (NOT public.rabbit_money_segment((storage.foldername(name))[3])) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = public.fn_try_uuid((storage.foldername(objects.name))[2])))) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(public.fn_try_uuid((storage.foldername(name))[2])) AND (created_at > (now() - '01:00:00'::interval))));

ALTER POLICY petal_bin_posters_insert ON storage.objects
  WITH CHECK (((bucket_id = 'rabbit-thumbnails'::text) AND (auth.role() = 'authenticated'::text) AND ((storage.foldername(name))[1] = 'projects'::text) AND ((storage.foldername(name))[3] = 'bin_files'::text) AND (NOT public.rabbit_money_segment((storage.foldername(name))[3])) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = public.fn_try_uuid((storage.foldername(objects.name))[2])))) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(public.fn_try_uuid((storage.foldername(name))[2]))));

ALTER POLICY petal_bin_posters_update ON storage.objects
  USING (((bucket_id = 'rabbit-thumbnails'::text) AND (auth.role() = 'authenticated'::text) AND ((storage.foldername(name))[1] = 'projects'::text) AND ((storage.foldername(name))[3] = 'bin_files'::text) AND (NOT public.rabbit_money_segment((storage.foldername(name))[3])) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = public.fn_try_uuid((storage.foldername(objects.name))[2])))) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(public.fn_try_uuid((storage.foldername(name))[2]))))
  WITH CHECK (((bucket_id = 'rabbit-thumbnails'::text) AND (auth.role() = 'authenticated'::text) AND ((storage.foldername(name))[1] = 'projects'::text) AND ((storage.foldername(name))[3] = 'bin_files'::text) AND (NOT public.rabbit_money_segment((storage.foldername(name))[3])) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id = public.fn_try_uuid((storage.foldername(objects.name))[2])))) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_edit_shot_lists(public.fn_try_uuid((storage.foldername(name))[2]))));

ALTER POLICY rabbit_files_delete_own ON storage.objects
  USING (((bucket_id = 'rabbit-files'::text) AND (owner_id = (auth.uid())::text) AND ((storage.foldername(name))[1] = 'projects'::text) AND (NOT public.rabbit_money_segment((storage.foldername(name))[3])) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id =
        CASE
            WHEN rabbit_private.storage_object_claimed(objects.bucket_id, objects.name) THEN rabbit_private.storage_object_current_project(objects.bucket_id, objects.name)
            ELSE public.fn_try_uuid((storage.foldername(objects.name))[2])
        END))) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(
CASE
    WHEN rabbit_private.storage_object_claimed(bucket_id, name) THEN rabbit_private.storage_object_current_project(bucket_id, name)
    ELSE public.fn_try_uuid((storage.foldername(name))[2])
END) AND (created_at > (now() - '01:00:00'::interval)) AND (NOT rabbit_private.storage_object_claimed(bucket_id, name))));

ALTER POLICY rabbit_files_insert ON storage.objects
  WITH CHECK (((bucket_id = 'rabbit-files'::text) AND (auth.role() = 'authenticated'::text) AND ((storage.foldername(name))[1] = 'projects'::text) AND (NOT public.rabbit_money_segment((storage.foldername(name))[3])) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id =
        CASE
            WHEN rabbit_private.storage_object_claimed(objects.bucket_id, objects.name) THEN rabbit_private.storage_object_current_project(objects.bucket_id, objects.name)
            ELSE public.fn_try_uuid((storage.foldername(objects.name))[2])
        END))) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(
CASE
    WHEN rabbit_private.storage_object_claimed(bucket_id, name) THEN rabbit_private.storage_object_current_project(bucket_id, name)
    ELSE public.fn_try_uuid((storage.foldername(name))[2])
END)));

ALTER POLICY rabbit_files_update ON storage.objects
  USING (((bucket_id = 'rabbit-files'::text) AND (auth.role() = 'authenticated'::text) AND ((storage.foldername(name))[1] = 'projects'::text) AND (NOT public.rabbit_money_segment((storage.foldername(name))[3])) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id =
        CASE
            WHEN rabbit_private.storage_object_claimed(objects.bucket_id, objects.name) THEN rabbit_private.storage_object_current_project(objects.bucket_id, objects.name)
            ELSE public.fn_try_uuid((storage.foldername(objects.name))[2])
        END))) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(
CASE
    WHEN rabbit_private.storage_object_claimed(bucket_id, name) THEN rabbit_private.storage_object_current_project(bucket_id, name)
    ELSE public.fn_try_uuid((storage.foldername(name))[2])
END)))
  WITH CHECK (((bucket_id = 'rabbit-files'::text) AND (auth.role() = 'authenticated'::text) AND ((storage.foldername(name))[1] = 'projects'::text) AND (NOT public.rabbit_money_segment((storage.foldername(name))[3])) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id =
        CASE
            WHEN rabbit_private.storage_object_claimed(objects.bucket_id, objects.name) THEN rabbit_private.storage_object_current_project(objects.bucket_id, objects.name)
            ELSE public.fn_try_uuid((storage.foldername(objects.name))[2])
        END))) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(
CASE
    WHEN rabbit_private.storage_object_claimed(bucket_id, name) THEN rabbit_private.storage_object_current_project(bucket_id, name)
    ELSE public.fn_try_uuid((storage.foldername(name))[2])
END)));

ALTER POLICY rabbit_thumbnails_delete_own ON storage.objects
  USING (((bucket_id = 'rabbit-thumbnails'::text) AND (owner_id = (auth.uid())::text) AND ((storage.foldername(name))[1] = 'projects'::text) AND (NOT public.rabbit_money_segment((storage.foldername(name))[3])) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id =
        CASE
            WHEN rabbit_private.storage_object_claimed(objects.bucket_id, objects.name) THEN rabbit_private.storage_object_current_project(objects.bucket_id, objects.name)
            ELSE public.fn_try_uuid((storage.foldername(objects.name))[2])
        END))) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(
CASE
    WHEN rabbit_private.storage_object_claimed(bucket_id, name) THEN rabbit_private.storage_object_current_project(bucket_id, name)
    ELSE public.fn_try_uuid((storage.foldername(name))[2])
END) AND (created_at > (now() - '01:00:00'::interval))));

ALTER POLICY rabbit_thumbnails_insert ON storage.objects
  WITH CHECK (((bucket_id = 'rabbit-thumbnails'::text) AND (auth.role() = 'authenticated'::text) AND ((storage.foldername(name))[1] = 'projects'::text) AND (NOT public.rabbit_money_segment((storage.foldername(name))[3])) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id =
        CASE
            WHEN rabbit_private.storage_object_claimed(objects.bucket_id, objects.name) THEN rabbit_private.storage_object_current_project(objects.bucket_id, objects.name)
            ELSE public.fn_try_uuid((storage.foldername(objects.name))[2])
        END))) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(
CASE
    WHEN rabbit_private.storage_object_claimed(bucket_id, name) THEN rabbit_private.storage_object_current_project(bucket_id, name)
    ELSE public.fn_try_uuid((storage.foldername(name))[2])
END)));

ALTER POLICY rabbit_thumbnails_update ON storage.objects
  USING (((bucket_id = 'rabbit-thumbnails'::text) AND (auth.role() = 'authenticated'::text) AND ((storage.foldername(name))[1] = 'projects'::text) AND (NOT public.rabbit_money_segment((storage.foldername(name))[3])) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id =
        CASE
            WHEN rabbit_private.storage_object_claimed(objects.bucket_id, objects.name) THEN rabbit_private.storage_object_current_project(objects.bucket_id, objects.name)
            ELSE public.fn_try_uuid((storage.foldername(objects.name))[2])
        END))) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(
CASE
    WHEN rabbit_private.storage_object_claimed(bucket_id, name) THEN rabbit_private.storage_object_current_project(bucket_id, name)
    ELSE public.fn_try_uuid((storage.foldername(name))[2])
END)))
  WITH CHECK (((bucket_id = 'rabbit-thumbnails'::text) AND (auth.role() = 'authenticated'::text) AND ((storage.foldername(name))[1] = 'projects'::text) AND (NOT public.rabbit_money_segment((storage.foldername(name))[3])) AND (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE (p.id =
        CASE
            WHEN rabbit_private.storage_object_claimed(objects.bucket_id, objects.name) THEN rabbit_private.storage_object_current_project(objects.bucket_id, objects.name)
            ELSE public.fn_try_uuid((storage.foldername(objects.name))[2])
        END))) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND public.can_write_project(
CASE
    WHEN rabbit_private.storage_object_claimed(bucket_id, name) THEN rabbit_private.storage_object_current_project(bucket_id, name)
    ELSE public.fn_try_uuid((storage.foldername(name))[2])
END)));

-- §6 The six narrow indexes --------------------------------------------------------------
DROP INDEX IF EXISTS public.bin_files_location_idx;
DROP INDEX IF EXISTS public.budget_lines_project_idx;
DROP INDEX IF EXISTS public.folders_project_idx;
DROP INDEX IF EXISTS public.scenes_project_idx;
DROP INDEX IF EXISTS public.tasks_project_idx;
DROP INDEX IF EXISTS public.otter_courses_ws_owner_idx;

-- §7 Post-conditions ------------------------------------------------------------------------
CREATE TEMP TABLE _f7_pol_after ON COMMIT DROP AS
  SELECT n.nspname::text AS sch, c.relname::text AS tbl, p.polname::text AS pol,
         p.polcmd::text AS cmd, p.polpermissive AS permissive,
         (SELECT pg_catalog.array_agg(x.role ORDER BY x.role)
            FROM (SELECT CASE WHEN r = 0 THEN 'public' ELSE pg_catalog.pg_get_userbyid(r)::text END AS role
                    FROM pg_catalog.unnest(p.polroles) AS r) AS x) AS roles,
         pg_catalog.replace(pg_catalog.pg_get_expr(p.polqual, p.polrelid), chr(13), '') AS qual,
         pg_catalog.replace(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), chr(13), '') AS with_check
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname !~ '^pg_(toast_)?temp_';

-- What the start's text becomes under exactly the one substitution, in exactly the listed clauses.
CREATE TEMP TABLE _f7_pol_expected ON COMMIT DROP AS
  SELECT b.sch, b.tbl, b.pol, b.cmd, b.permissive, b.roles,
         CASE WHEN lq.arg IS NULL OR pg_catalog.strpos(b.qual, s.t) > 0 THEN b.qual
              ELSE pg_catalog.replace(b.qual, 'public.has_active_membership(' || lq.arg || ')', s.t) END AS qual,
         CASE WHEN lc.arg IS NULL OR pg_catalog.strpos(b.with_check, s.t) > 0 THEN b.with_check
              ELSE pg_catalog.replace(b.with_check, 'public.has_active_membership(' || lc.arg || ')', s.t) END AS with_check
    FROM _f7_pol_before b
    CROSS JOIN _f7_sub s
    LEFT JOIN _f7_list lq ON (lq.sch, lq.tbl, lq.pol, lq.clause) = (b.sch, b.tbl, b.pol, 'qual')
    LEFT JOIN _f7_list lc ON (lc.sch, lc.tbl, lc.pol, lc.clause) = (b.sch, b.tbl, b.pol, 'with_check');

DO $$
DECLARE
  r      RECORD;
  v_sub  text := (SELECT t FROM _f7_sub);
  v_bad  text;
BEGIN
  IF (SELECT count(*) FROM _f7_pol_after) <> (SELECT count(*) FROM _f7_pol_before) THEN
    RAISE EXCEPTION '0137 post-condition: % policies before, % after',
      (SELECT count(*) FROM _f7_pol_before), (SELECT count(*) FROM _f7_pol_after);
  END IF;
  SELECT string_agg(DISTINCT x.sch || '.' || x.tbl || '.' || x.pol, ', ') INTO v_bad
    FROM ((SELECT * FROM _f7_pol_expected EXCEPT SELECT * FROM _f7_pol_after)
          UNION
          (SELECT * FROM _f7_pol_after EXCEPT SELECT * FROM _f7_pol_expected)) x;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '0137 post-condition: these policies differ from their text before by more than the one substitution: %', v_bad;
  END IF;
  -- No per-row call left outside the exception: every call is inside the sub-select.
  FOR r IN
    SELECT a.sch, a.tbl, a.pol, x.clause, x.txt
      FROM _f7_pol_after a
      CROSS JOIN LATERAL (VALUES ('qual', a.qual), ('with_check', a.with_check)) AS x(clause, txt)
     WHERE x.txt LIKE '%has_active_membership(%'
       AND NOT EXISTS (SELECT 1 FROM _f7_exception e WHERE (e.sch, e.tbl, e.pol, e.clause) = (a.sch, a.tbl, a.pol, x.clause))
  LOOP
    IF (length(r.txt) - length(replace(r.txt, 'has_active_membership(', ''))) / length('has_active_membership(')
       <> (length(r.txt) - length(replace(r.txt, v_sub, ''))) / length(v_sub) THEN
      RAISE EXCEPTION '0137 post-condition: %.%.% (%) still calls has_active_membership per row', r.sch, r.tbl, r.pol, r.clause;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM _f7_pol_after a
       WHERE pg_catalog.strpos(COALESCE(a.qual, '') || COALESCE(a.with_check, ''), v_sub) > 0) <> 186 THEN
    RAISE EXCEPTION '0137 post-condition: the sub-select is not in exactly 186 policies';
  END IF;
  FOR r IN SELECT e.*, CASE e.clause WHEN 'qual' THEN a.qual ELSE a.with_check END AS live
             FROM _f7_exception e LEFT JOIN _f7_pol_after a ON (a.sch, a.tbl, a.pol) = (e.sch, e.tbl, e.pol)
  LOOP
    IF r.live IS DISTINCT FROM r.txt THEN
      RAISE EXCEPTION '0137 post-condition: %.%.% (%) is not the text this file leaves alone', r.sch, r.tbl, r.pol, r.clause;
    END IF;
  END LOOP;

  -- The meter: this file's body, a definer whose owner bypasses row security, its search_path, its grants.
  IF (SELECT pg_catalog.md5(pg_catalog.replace(prosrc, chr(13), '')) FROM pg_catalog.pg_proc
       WHERE oid = 'public.workspace_petal_committed_bytes(uuid)'::pg_catalog.regprocedure) IS DISTINCT FROM '67bd041258c73fecae5b4031357e42d2' THEN
    RAISE EXCEPTION '0137 post-condition: workspace_petal_committed_bytes is not this file''s body';
  END IF;
  IF NOT (SELECT p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=public'] AND r2.rolbypassrls
            FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles r2 ON r2.oid = p.proowner
           WHERE p.oid = 'public.workspace_petal_committed_bytes(uuid)'::pg_catalog.regprocedure) THEN
    RAISE EXCEPTION '0137 post-condition: the meter is not a STABLE definer with search_path=public whose owner bypasses row security';
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.workspace_petal_committed_bytes(uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.workspace_petal_committed_bytes(uuid)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.workspace_petal_committed_bytes(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0137 post-condition: the meter has the wrong grants';
  END IF;
  IF pg_catalog.to_regprocedure('public._f7_meter_candidate(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '0137 post-condition: the candidate meter was left behind';
  END IF;

  -- The six are gone, the six wider ones stay valid; the two new ones are here, valid and exactly this file's.
  IF pg_catalog.to_regclass('public.bin_files_location_idx') IS NOT NULL OR pg_catalog.to_regclass('public.budget_lines_project_idx') IS NOT NULL
     OR pg_catalog.to_regclass('public.folders_project_idx') IS NOT NULL OR pg_catalog.to_regclass('public.scenes_project_idx') IS NOT NULL
     OR pg_catalog.to_regclass('public.tasks_project_idx') IS NOT NULL OR pg_catalog.to_regclass('public.otter_courses_ws_owner_idx') IS NOT NULL THEN
    RAISE EXCEPTION '0137 post-condition: a narrow index is still here';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_index i
       WHERE i.indexrelid IN (pg_catalog.to_regclass('public.bin_files_location_path_idx'), pg_catalog.to_regclass('public.budget_lines_project_sheet_idx'),
                              pg_catalog.to_regclass('public.folders_project_path_uniq'), pg_catalog.to_regclass('public.scenes_project_number_idx'),
                              pg_catalog.to_regclass('public.tasks_project_phase_idx'), pg_catalog.to_regclass('public.otter_courses_owner_slug_uidx'))
         AND i.indisvalid AND i.indisready) <> 6 THEN
    RAISE EXCEPTION '0137 post-condition: a wider index is missing or not valid';
  END IF;
  IF pg_catalog.pg_get_indexdef(pg_catalog.to_regclass('public.app_events_file_id_idx')) IS DISTINCT FROM 'CREATE INDEX app_events_file_id_idx ON public.app_events USING btree (((context ->> ''file_id''::text)))'
     OR pg_catalog.pg_get_indexdef(pg_catalog.to_regclass('public.app_events_ai_files_ws_id_idx')) IS DISTINCT FROM 'CREATE INDEX app_events_ai_files_ws_id_idx ON public.app_events USING btree (workspace_id, id) WHERE ((code = ''WIL-6001''::text) AND ((context ->> ''tool''::text) = ''ai-files''::text))'
     OR (SELECT count(*) FROM pg_catalog.pg_index i
          WHERE i.indexrelid IN (pg_catalog.to_regclass('public.app_events_file_id_idx'), pg_catalog.to_regclass('public.app_events_ai_files_ws_id_idx'))
            AND i.indisvalid AND i.indisready) <> 2 THEN
    RAISE EXCEPTION '0137 post-condition: the ai-files indexes are not this file''s';
  END IF;
  IF (SELECT pg_catalog.pg_get_statisticsobjdef(s.oid) FROM pg_catalog.pg_statistic_ext s
       WHERE s.stxname = 'app_events_context_tool_stats') IS DISTINCT FROM 'CREATE STATISTICS public.app_events_context_tool_stats ON (context ->> ''tool''::text) FROM public.app_events' THEN
    RAISE EXCEPTION '0137 post-condition: the statistics on app_events'' tool are not this file''s';
  END IF;
END
$$;

-- No table's policies recurse, for a client's statement of any kind. The rewriter refuses with 42P17 ("infinite
-- recursion detected in policy") when it meets a table's policies a second time on one path and any of them holds a
-- sub-query; a sub-select added where a policy's own sub-query leads back to its table would fail every such statement.
-- PREPARE parses and rewrites without planning or running anything (it takes the statement's ordinary lock on each
-- table, which writes do not wait for). Each table, as authenticated and as anon (this file's own role bypasses row
-- security, so it would expand no policy at all): a read, a read FOR UPDATE, an UPDATE, a DELETE and an INSERT, each
-- with a WHERE or a RETURNING so the read policies are collected too (an upsert's policies are the union of the
-- INSERT's and the UPDATE's). The read and the UPDATE of every protected table in public must be rewritten as
-- authenticated; a lock that could not be had refuses rather than passes. The caller's role is set back after.
DO $$
DECLARE
  r      RECORD;
  v_role text := current_user;
  v_col  text;
  v_bad  text := '';
  v_miss text := '';
  q      text;
  k      text;
  who    text;
  ok     boolean;
BEGIN
  BEGIN
    EXECUTE 'DEALLOCATE f7_rls_probe';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  FOREACH who IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    PERFORM pg_catalog.set_config('role', who, true);
    FOR r IN
      SELECT n.nspname, c.relname, c.oid
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p') AND c.relrowsecurity
         AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
       ORDER BY 1, 2
    LOOP
      SELECT pg_catalog.quote_ident(a.attname) INTO v_col FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' AND a.attidentity = ''
       ORDER BY a.attnum LIMIT 1;
      FOREACH k IN ARRAY ARRAY['SELECT', 'FOR UPDATE', 'UPDATE', 'DELETE', 'INSERT'] LOOP
        q := CASE k
          WHEN 'SELECT' THEN pg_catalog.format('SELECT 1 FROM %I.%I', r.nspname, r.relname)
          WHEN 'FOR UPDATE' THEN pg_catalog.format('SELECT 1 FROM %I.%I FOR UPDATE', r.nspname, r.relname)
          WHEN 'UPDATE' THEN pg_catalog.format('UPDATE %I.%I SET %s = %s WHERE true RETURNING 1', r.nspname, r.relname, v_col, v_col)
          WHEN 'DELETE' THEN pg_catalog.format('DELETE FROM %I.%I WHERE true RETURNING 1', r.nspname, r.relname)
          ELSE pg_catalog.format('INSERT INTO %I.%I DEFAULT VALUES RETURNING 1', r.nspname, r.relname)
        END;
        ok := false;
        BEGIN
          IF q IS NOT NULL THEN
            EXECUTE 'PREPARE f7_rls_probe AS ' || q;
            EXECUTE 'DEALLOCATE f7_rls_probe';
            ok := true;
          END IF;
        EXCEPTION
          WHEN SQLSTATE '42P17' THEN
            v_bad := v_bad || r.nspname || '.' || r.relname || ' (' || k || ', ' || who || ') ';
          WHEN lock_not_available OR query_canceled THEN
            RAISE;
          WHEN OTHERS THEN
            NULL; -- a statement this role may not even name (a schema it cannot use) cannot recurse for it either
        END;
        IF NOT ok AND who = 'authenticated' AND r.nspname = 'public' AND k IN ('SELECT', 'UPDATE')
           AND NOT pg_catalog.strpos(v_bad, r.nspname || '.' || r.relname || ' (' || k || ', ') > 0 THEN
          v_miss := v_miss || r.relname || ' (' || k || ') ';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  EXECUTE pg_catalog.format('SET LOCAL ROLE %I', v_role);
  IF v_bad <> '' THEN
    RAISE EXCEPTION '0137 post-condition: a client''s statement would recurse in row security on %', v_bad;
  END IF;
  IF v_miss <> '' THEN
    RAISE EXCEPTION '0137 post-condition: the row-security probe could not rewrite %', v_miss;
  END IF;
END
$$;

-- The caller's search_path again, for whatever follows in this transaction.
SELECT pg_catalog.set_config('search_path', pg_catalog.current_setting('f7.caller_search_path'), true);
