# SESSION 11 launch prompt — O.T.T.E.R. UI

> **Re-planned 2026-07-29 (Audrey).** This session was originally "O.T.T.E.R. UI
> + web build". The web build is now **Session 12** — S11 was double-booked with
> two full sessions of work, which is how S10 ended up delivering half its scope.
> Four sessions remain: **S11 O.T.T.E.R. UI · S12 web build · S13 file lifecycle
> & data stewardship · S14 operator console + TPN + v1.0.0.**

> Paste into a new Claude Code conversation from the WILSON repo.
> **Master plan: `docs/MASTER_PLAN.md` — read §2–§6 and §10 BEFORE any code.**
> **First tool call** per standing rule: `git status` on `feat/multi-user-v1`.

---

## Context recap — where Session 10 left the repo

- Branch **`feat/multi-user-v1`**. S10 feature commit `31586d5`, pushed.
  Migrations **0000–0023 deployed to dev + staging + prod. No backlog.**
  pgTAP suites 01–30. Vitest 256/256. vite build green.
- **⚠️ CI was NOT confirmed green for `31586d5`** — `gh` is not authenticated
  on this machine, so the agent could not read the run. **First thing to do
  after `git status`: check the Actions run for `31586d5` and fix anything red.**
  Everything was verified directly against Postgres 17 on `wilson-dev`
  (all 94 pgTAP probes, plan counts exact) so a failure is most likely
  environmental (CI local stack) rather than logical.

### Session 10 delivered — the O.T.T.E.R. cloud SERVER model (db/README §19)

- **Migration 0022** — five tables: `otter_courses`, `otter_subjects`,
  `otter_progress`, `otter_course_editors`, `otter_change_requests`.
  Three visibility tiers `personal | shared | company_standard`, live-row
  SECURITY DEFINER helpers, identity-pin triggers, O.T.T.E.R.-specific trash
  RPCs + 30-day purge cron (04:55 UTC), `otter_fork_course()`,
  `otter_course_index()` (metadata-only admin view).
- **Migration 0023** — `public.users` dropped; `schema.sql`/`seed.sql` deleted.
  **§6 gap #9 CLOSED.**
- **Client seam** — `src/tools/otter_v0.3.1/adapters/`: `otterFetch()` routes
  O.T.T.E.R.'s own `/api/software/...` paths to Supabase or the local Express
  server. 85 call sites swapped; no component rewrite.
- **Migration tool** — `src/cloud/migrate/runOtterMigration.js`.
- Adversarial review: 15 findings, all fixed (see the commit body).

## Session 11 goal — the O.T.T.E.R. UI (carried from S10, NOT started)

Everything below is **server-complete and pgTAP-pinned**; none of it is on
screen. This is Audrey's explicitly requested feature set (2026-07-28) and
should land BEFORE the web build, because the web build just re-hosts it.

1. **Tier picker at course creation.** New courses are born `personal`
   (`otter_courses_insert` enforces it). Offer "just for me" vs "share with
   the company" at creation and on the course card.
   Wire: `course.create` accepts `visibility`; `course.update` accepts a
   `visibility` patch. Only an **admin** may reach `company_standard`, and
   `fn_otter_pin_course_identity` **silently reverts** a disallowed tier change
   — so always re-read the row from the response and render what came back,
   never what you sent.
2. **Filters — "made just for you" vs "made to share".** `otter_course_index()`
   already returns everything needed per course: `visibility`, `is_own`,
   `owner_label`, `can_read_content`, `can_write`, `source_course_id`,
   `subject_count`. `toCourseWire` already forwards them all. Suggested chips:
   Mine · Shared with me · Shared by me · Company standard · (admin) All.
   Apply to **both** courses and subjects.
3. **Share / unshare + editor grants.** `otter_course_editors` — owner or admin
   grants; grantee can hand it back; a grantee cannot recruit further editors.
   **An admin cannot grant on a `personal` course** (that was the critical
   review finding — do not "fix" it).
4. **Company-standard designation** (admin only) + the **"use this instead of
   generating"** offer. When a user starts a course whose name matches a
   company-standard one (`Otter.jsx` matches courses by `name.toLowerCase()`),
   offer `otter_fork_course(course_id)` instead of burning API spend.
5. **Change requests.** Submit from a forked course (summary = the user's own
   words on what they changed and why) + an admin review queue
   (approve/reject with a note). A settled request can never be reopened;
   only admins/target-course-owners decide; the proposer may refine while open
   or withdraw.
6. **Trash + restore UI.** `otter_soft_delete_row` / `otter_restore_row` exist
   and are wired into `course.delete`, but **there is no trash list and no
   restore path in the client** — a trashed course currently disappears with no
   way back, and the 30-day purge then destroys it. Needs a "Recently deleted"
   view. *(This is §6 #20 — treat it as part of Block A, not optional.)*
7. **Gate the edit affordances on `can_write`.** `Otter.jsx` currently offers
   every generate/edit control on any course the user can open; the adapter now
   returns a clean 403 instead of a fake success, but the button should not be
   there at all. `grep can_write src/tools/otter_v0.3.1` returns nothing today.
8. **Mount the O.T.T.E.R. migration panel.** `runOtterMigration.js` exists but
   nothing calls it — add it beside the RABBIT one in
   `SettingsPage.jsx:757` (`MigrationPanel.jsx` is the pattern).

Apply the **laws-of-ux skill** (≥5 named laws, as S9's Admin Terminal did).

## What moved OUT of this session

- **Web build + hosting/routing** → **S12** (MASTER_PLAN §5). Do not start it
  here; finishing the UI properly is this session's whole job.
- Note while you work: §6 #21 (O.T.T.E.R. renders an empty library on the web,
  because `loadSoftwareList()` only runs inside the
  `fetch('/api/otter-settings')` success chain) is an **S12** fix. Don't
  restructure the mount effect for it now unless you are already in that code.

## Traps & discipline (inherited — full list in MASTER_PLAN §8)

- **No Docker on this machine.** pgTAP cannot run locally. The S10 workaround
  works well and is worth reusing: `supabase db query --linked --file X.sql`
  accepts multi-statement `BEGIN; … ROLLBACK;`, and `pgtap` can be
  `CREATE EXTENSION`-ed *inside* that transaction. Rewrite each
  `SELECT is(...)` as `INSERT INTO tap_out SELECT is(...)` and select the
  failures at the end — that is how all 94 probes were verified against real
  Postgres. Script: see the S10 transcript (`run_suite.sh`).
- **`NOT (… OR current_app_role() = 'admin' OR …)` is a trap.**
  `current_app_role()` is NULL for plain members, so the whole predicate is
  NULL and plpgsql treats `IF NULL` as false — the guard silently does nothing.
  RLS policies survive it (NULL = deny); anything that INVERTS it must
  `COALESCE(…, false)`. This bit twice in S10.
- **`.upsert()` cannot infer a PARTIAL unique index** — supabase-js emits a bare
  `ON CONFLICT (cols)` and Postgres raises 42P10. All the O.T.T.E.R. subject
  uniqueness is partial (`WHERE deleted_at IS NULL`). Use explicit
  read-then-insert/update, as `subject.save` now does.
- **A refused UPDATE returns 204 with no error.** Always
  `.select('id').maybeSingle()` on writes and throw on 0 rows, or RLS denials
  read as success.
- **No O.T.T.E.R. call site checks `res.ok`** — a silent adapter failure shows
  as a successful UI update that vanishes on reload.
- pgTAP: `throws_ok` message-form only; **de-auth before every
  `tests.login_as`** (`tests` is runner-only — this bit once in S10);
  role-gated probes build claims by hand (`login_as` sets NO app_role);
  edited-applied migration on dev = `supabase migration repair --status
  reverted NNNN` + `db push --include-all`.
- CI stack: NO realtime schema, NO pg_cron (guard both). It also **excludes
  the storage-api container** (`rls.yml:80`) — the storage *schema* is present,
  so SQL-level probes work, but nothing needing the Storage HTTP API will run.
- `window.prompt` does NOT exist in Electron renderers.
- All-pages-rendered pattern: gate expensive page hooks behind role/adapter
  checks in an inner component (AdminTerminalBody pattern).
- Token discipline: hard cap 15 agents; finders paste excerpts; adversarial
  review before the feature commit (3 finders worked well again in S10 — they
  caught 2 criticals the author's own probes missed).
- The agent NEVER enters credentials — browser eyeballs owed by Audrey.

## Non-goals (S11)

- **Web build, base-path routing, web sessions, deploy** (**S12**).
- **CSV export, file audit, storage relink, `rabbit-files` bucket, blob GC**
  (**S13** — file lifecycle & data stewardship).
- Operator console (`/wilsonadmin`), final TPN hardening, v1.0.0 (**S14**).
- Field-level cell presence (stretch since S8 — earliest S14).
- Durable Edge-Function rate limiting (S14 TPN).
- Realtime for O.T.T.E.R. content (deliberately excluded — db/README §19).

## Close-out ritual (MASTER_PLAN §8 — do ALL of it)

Feature commit → CI green → deploy any new migrations to staging + prod
(dry-run each) → deploy any new/edited Edge Functions → re-link CLI to
`wilson-dev` → write `docs/sessions/SESSION_12_prompt.md` (**web build**, scope
in MASTER_PLAN §5) → update `docs/MASTER_PLAN.md` (§4 ledger, §5 scope, §6 gaps,
§7 statuses, §10) → update the Claude auto-memory → docs commit + push → list
Audrey's owed browser checks.
