# SESSION 12 launch prompt — `ai-proxy` + the web build (+ change-request apply)

> Paste into a new Claude Code conversation from the WILSON repo.
> **Master plan: `docs/MASTER_PLAN.md` — read §2–§6 and §10 BEFORE any code.**
> **First tool call** per standing rule: `git status` on `feat/multi-user-v1`.

> Two sessions remain after this one: **S13 file lifecycle & data stewardship ·
> S14 operator console + TPN + v1.0.0.**
>
> **Three new locked decisions came in after S11 closed** (Audrey, 2026-07-29) —
> read locked **#21** (no API key on any client, one `ai-proxy` for both hosts)
> and **#22** (approving a change request APPLIES it, additive-only, with an
> auto-archive) before planning. They are Blocks A and C below.

---

## Context recap — where Session 11 left the repo

- Branch **`feat/multi-user-v1`**. S11 feature commit `5707895`, docs close-out
  `80f9072`, both pushed. **CI green on `5707895`** (all four jobs).
- Migrations **0000–0024**, all deployed to dev + staging + prod at the S11
  close-out (0024 was new; dry-run before each env, then verified present with
  `authenticated` EXECUTE and `anon` denied on all three). **No backlog.**
- **CI is readable without `gh`.** `pretty-aud/wilson` is a public repo, so
  `curl https://api.github.com/repos/pretty-aud/wilson/actions/runs?head_sha=<sha>`
  returns the conclusion, and `.../actions/runs/<id>/jobs` returns per-step
  results. Do this rather than asking Audrey to check Actions by hand.
- pgTAP suites 01–31. Vitest **290/290**. `vite build` green.
- S11 delivered the whole O.T.T.E.R. UI: visibility tiers, filter chips, share +
  editor grants, company-standard designation, the fork offer, change-request
  submit (O.T.T.E.R.) and review (Admin Terminal), the trash/restore surface,
  `can_write` gating, the collapsible Sidebar 1, and the O.T.T.E.R. migration
  panel in Settings.

### The one thing S11 added to the SERVER

**Migration 0024 — `otter_trash_index()`.** S11's brief asserted the trash was
"server-complete and pgTAP-pinned". It was not: every read path filters
`deleted_at IS NULL` (`otter_courses_select`, `otter_subjects_select`, and
`otter_course_index()`), so `otter_restore_row()` had no obtainable argument and
a trashed course was unrecoverable by any client. 0024 is the metadata-only read
side; see `db/README.md` §20 and pgTAP `31_otter_trash.sql`.

---

## Session 12 scope — THREE blocks, in this order

**Read this ordering note before planning.** Audrey asked for the change-request
work (Block C) to be specced into this session. It is specced in full below. But
S12 now carries the web build, a new Edge Function and a new migration, and
double-booking a session is exactly what cost S10 and S11 half their scope.

> **Blocks A and B are one job and must land. If the session runs long, Block C
> slides to S13 — say so early rather than half-finishing all three.**

- **Block A — `ai-proxy`** (locked #21). The Anthropic key must stop reaching
  clients. This is a hard prerequisite for web D.O.G. *and* web O.T.T.E.R., so
  it comes first.
- **Block B — the web build + hosting/routing** (locked #18), including gap #21.
- **Block C — change-request approval that actually applies** (locked #22),
  migration 0025.

---

## Block A — `ai-proxy`: no API key on any client, either host

**The problem, measured.** `api.anthropic.com` is called directly from **six
files, 13+ call sites**, all with `anthropic-dangerous-direct-browser-access`:

| File | Sites |
|---|---|
| `src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx` | 8 |
| `src/tools/otter_v0.3.1/Otter.jsx` | 1 (`callAnthropicAPI`) |
| `src/tools/otter_v0.3.1/Validator.jsx` | 1 |
| `src/agent/AgentProvider.jsx` | 1 |
| `src/App.jsx` | 1 (the pet chat) |
| `src/tools/rabbit_v0.1.0/intake/pipeline.js` | 1 |

The key is pasted by each user into `localStorage` as `wilson-api-key`
(`App.jsx:195-209`) and passed down as an `apiKey` prop. On the desktop that is
a credential on disk; on the web it is a credential in the browser.

**Build it as one authenticated Edge Function.**

1. `supabase/functions/ai-proxy/index.ts` — accepts the body the clients already
   build (`model`, `max_tokens`, `system`, `messages`, `tools`, plus a `betas`
   string that becomes the `anthropic-beta` header) and returns Anthropic's
   response. **`verify_jwt=false` + claims from the TOKEN payload + a LIVE
   `workspace_members` membership check**, exactly like the S9 admin functions
   (`_shared/adminGuard.ts` is the model) — a deactivated member must not be
   able to spend money.
2. **Key resolution: per-workspace → platform fallback.** Ship with a single
   platform key in Supabase secrets (`ANTHROPIC_API_KEY`). Leave the seam for
   `workspace_ai_keys` (encrypted via Supabase Vault, written by the S14
   operator console, show-once and never readable back per locked #8). This is
   the whole point of the design: admin-portal key management later becomes a
   config change, not a rewrite.
3. **Electron uses the proxy too.** Do NOT keep the direct path as a desktop
   fallback — a second code path is how gap #21 happened.
4. **Log usage to `app_events`** (0021) with model and
   `usage.input_tokens`/`output_tokens`. Nearly-free spend visibility for the
   Admin Terminal and the numbers the operator console will need. Use a
   non-reserved stream (the 'admin' type and WIL-41xx codes are server-reserved).
5. **Delete the old credential.** Remove the Settings API-key field and
   `localStorage.removeItem('wilson-api-key')` on upgrade, so a user's key does
   not linger on disk. Also drop the legacy
   `deck-outline-generator-api-key` migration path in `App.jsx`.

### The constraint that shapes the implementation — do not skip this

Supabase Edge Functions must **respond within 150s**; the worker wall clock is
150s free / **400s on paid plans**
(https://supabase.com/docs/guides/functions/limits). O.T.T.E.R.'s subject
generation already prints "Still working…" at 45s, retries up to 21s on
overload (`RETRY_DELAYS = [3000, 6000, 12000]`), and runs up to three
`web_search_20250305` calls. A plain synchronous proxy will occasionally 504 and
**lose an entire generation**.

**Fix: stream the upstream leg.** Have the proxy request `stream: true` from
Anthropic and forward the SSE to the client. First byte is immediate, so the
150s response deadline never bites, and the 400s wall clock governs instead —
comfortable for these jobs.

Then add ONE client helper that reassembles the SSE into the same final message
object the code already expects, and point the **six** `callAnthropicAPI`-style
helpers at it. The 13 call sites keep their current shape. **Nothing streams
today**, so there is no existing behaviour to preserve — this is purely a
transport change.

Watch for: `stop_reason: 'max_tokens'` (Otter and D.O.G. both branch on it) and
`web_search_tool_result` content blocks (`Otter.jsx`'s
`extractTextAndCitations` reads them for sources) must survive reassembly
intact. Unit-test the reassembler against a recorded SSE fixture — it is pure
and cheap to pin, and it is the one new component every AI feature depends on.

---

## Block B — the web build + hosting/routing (all three tools)

Path-based hosting per locked #18. Scope, kept deliberately small:

1. **Web vite target** — a `base: '/wilson/'` build variant; the Electron build
   keeps `./`. Feature-detect the browser: no `electronAPI` means the updater
   panel degrades, the local/Drive storage cards inform rather than offer, and
   there is no `safeStorage` bridge (see the `supabaseClient` comment for the
   web session strategy).
2. **URL ↔ page sync** — map the existing `currentPage` state onto
   `/wilson/{dog,otter,rabbit,dashboard,settings,project-manager,rate-card,
   team-members,admin-terminal,help}` with the history API. **The
   all-pages-rendered shell stays** — this is not a router rewrite. Deep links
   plus SPA fallback rewrites.
3. **Auth on the web** — `WILSON_SITE_URL` → the test host on all three envs;
   Supabase `site_url` / `additional_redirect_urls` updated; recovery and invite
   emails land on `/wilson/#/recovery`; browser session persistence (the locked
   follow-up from Session 2's `persistSession:false` note).
4. **Web D.O.G.** (locked #17) — generates off the open project's cloud files.
   Its Anthropic access comes from **Block A**, which covers all three tools at
   once rather than per-tool.
5. **Deploy target** — a TEST host (any static host with SPA rewrites) serving
   the locked path shape: `<test-host>/wilson` + `<test-host>/wilsonadmin`.
   Audrey needs it reachable for post-session testing. The `petalstudios.co`
   cutover is post-v1.0 work.
6. **Smoke** — O.T.T.E.R. and RABBIT pass on the web; a Playwright web-path lane.

### Gap #21 — O.T.T.E.R. renders an empty library on the web. FIX IT HERE.

This is the single highest-value item in the session and was explicitly deferred
out of S11. `Otter.jsx`'s mount effect calls `loadSoftwareList()` **only inside
the `fetch('/api/otter-settings')` success chain**. That route is correctly not
an adapter route, so in a browser it 404s, the outer `.catch(() => {})` swallows
it, and the course list never loads at all. The same mount effect also gates
`/api/migration-needed` and `/api/migrate`.

Also affected and not adapter-routed: `/api/agent-skills`, `/api/fetch-url`
(reference-URL scraping), and `/api/otter-settings` writes (`saveSettings`).
Decide per route: proxy it, degrade it, or disable the affordance. `otterFetch`
already answers a clean **501** for the S11 cloud-only surfaces and **401** for
content routes when signed out on the web — extend that honesty to these.

**Do not restructure that mount effect for any other reason** — it is load-bearing
for the Electron path.

---

## Block C — change-request approval that actually applies (migration 0025)

**Audrey, 2026-07-29, verbatim:** *"yes we need to make sure the approval
automatically updates the course. the admin should be able to review. and approve
or they should be able to decline for the end user be able to review the decision
and either accept or do changes the admin is asking for. that said the admin
should be able to add a note/explanation for the decline that can be shared with
the user"* and *"we need to allow the admin to review the update. and decide to
accept it or not. when the user submits the change that should allow the admin to
see the course now"*.

Two follow-up decisions she made when asked (locked #22):

- **Additive only.** Approval adds new subjects and updates changed ones, and
  **never deletes**. One approval must not silently strip lessons from
  everyone's official course. Consequence to state in the UI: a proposer cannot
  propose a removal — they say so in the summary and the admin deletes by hand.
- **Auto-archive before every apply.** O.T.T.E.R. is deliberately not
  edit-history captured (db/README §19), so overwriting lesson text is otherwise
  unrecoverable. Each approval first snapshots the target to a private copy
  owned by the approving admin.

### The status flow

```
open ──approve──►  approved   (terminal, and APPLIES)
  │
  └──decline───►  changes_requested   (note REQUIRED)
                        │
                        ├── proposer: "Accept the decision" ──► rejected + acknowledged_at
                        └── proposer: revise + resubmit ──────► open  (revision + 1)

open ──proposer withdraws──► withdrawn   (terminal)
```

`rejected` stays reachable directly for a flat no. `approved` and `rejected` are
terminal; nothing else may transition out of them.

### 0025 — what to write

**This is the part that needs care: 0022 actively forbids the flow today.**
`fn_otter_cr_review` raises `'change request already % — reopen is not
permitted'` on ANY status change out of a non-`open` state, so the
revise-and-resubmit loop is impossible until that function is rewritten.

1. **Status CHECK** += `'changes_requested'`.
2. **New columns:** `applied_at TIMESTAMPTZ`, `applied_by UUID`,
   `archive_course_id UUID`, `revision INTEGER NOT NULL DEFAULT 1`,
   `acknowledged_at TIMESTAMPTZ`. Keep `review_note` (already there, and 0022's
   trigger already stops a proposer forging it — preserve that).
3. **Rewrite `fn_otter_cr_review`** for the flow above. Preserve everything it
   already gets right: reviewer stamped server-side from `auth.uid()`, immutable
   `proposed_by`/`target_course_id`/`workspace_id`, and the rule that a proposer
   can never write review fields. Add: a decline **requires** a non-empty
   `review_note`; `changes_requested → open` bumps `revision` and clears
   `reviewed_by`/`reviewed_at`; only the proposer may set `acknowledged_at`.
4. **Review-window read access — must go through a DEFINER helper.**
   `otter_has_open_review_access(p_course_id UUID)` SECURITY DEFINER: true when
   the caller is a workspace admin or the target course's owner, AND a change
   request exists with `source_course_id = p_course_id` and
   `status IN ('open','changes_requested')`. Add `OR
   public.otter_has_open_review_access(id)` to `otter_courses_select`.
   > **Do NOT inline `current_app_role()` into that policy.** 0022 ships a
   > post-condition that RAISES if any SELECT policy on `otter_courses` or
   > `otter_progress` mentions `current_app_role`, and 0022 is documented as
   > safe to re-run. Wrapping the role check inside the helper keeps that true
   > and puts the consented exception in one auditable place.
   Subjects come along for free — `otter_subjects_select`'s live-parent `EXISTS`
   runs under the caller's own RLS. Read only: add no write arm, so a reviewer
   can read a fork but never edit it.
5. **`otter_cr_apply(p_cr_id UUID) RETURNS UUID`** SECURITY DEFINER, returns the
   archive course id. One transaction, and the only path in:
   - re-check the caller is an admin or the target's owner; the request is
     `open`; the target is still `company_standard`; the source still exists;
   - **archive** the target (reuse `otter_fork_course`'s copy logic) into a
     `personal` course owned by the caller, named
     `<name> (before change #<revision>)`, and record `archive_course_id`;
   - **apply additively**: for each live subject in the source, match the target
     by `slug` — INSERT when absent, UPDATE content columns when present.
     **Never delete.** Do not touch the target's `owner_id`, `workspace_id`,
     `slug`, `visibility`. Note the BEFORE triggers still fire under DEFINER, so
     check `fn_otter_pin_subject_identity` does not block a legitimate insert;
   - stamp `status='approved'`, reviewer, `applied_at`, `applied_by`.
   - **Subjects only** (§6 #29): the five reference documents have merge
     semantics that live in client JS (`otterRoutes.js`), and reimplementing
     them in plpgsql would duplicate load-bearing logic while overwriting them
     would break additive-only. Say so in the approve dialog.
6. **pgTAP `32_otter_cr_apply.sql`.** Pin at minimum: every legal transition and
   every illegal one; a decline without a note is refused; the review window
   opens on submit and **closes on settle**; an admin still cannot read an
   unrelated personal course; apply is additive (a subject deleted in the source
   survives in the target); the archive exists and is owned by the approver;
   apply is refused on a non-`open` request and on a non-standard target.

### UI

- **Admin Terminal → Requests**: an "Open their course" affordance (it is
  readable now), Approve (state plainly that it will add/update but not delete,
  that reference documents are untouched, and that an archive is kept), and
  Decline with a **required** note.
- **O.T.T.E.R.'s `ChangeRequestDialog`**: show the decision state — the admin's
  note, plus "Accept the decision" and "Make the changes and resubmit".
- **Remove the "also share my copy with the company" checkbox.** Submitting now
  grants review access automatically, so the checkbox is obsolete and its
  presence would imply sharing is still required.
- Not in scope, deliberately (§6 #28): a subject-level **diff** view. Reviewers
  compare by eye in v1. Flag it to Audrey as the obvious follow-on.

---

## HOW to build it

### The S11 constraint still applies where it applies

S11's "change the existing O.T.T.E.R. UI as little as possible" was about
O.T.T.E.R.'s layout, and that layout is now settled — leave it alone. The web
build should change **hosting and wiring**, not screens. If a screen genuinely
cannot work in a browser, degrade it visibly (a disabled control with a reason)
rather than hiding it, so the desktop and web builds stay recognisably the same
product.

Invoke the **`laws-of-ux` skill** for any new surface, and name ≥5 laws applied.

### Two web-specific traps already known

- **`window.prompt` does not exist in Electron renderers** — but it *does* in a
  browser. Anything that was written around that absence may behave differently
  on the web. Check before assuming parity.
- **`localStorage` is the S11 persistence choice for UI state** (the Sidebar 1
  collapse) precisely because `otter-settings.json` is served by a local-server
  route that has no web equivalent. Keep new UI state on `localStorage`.

---

## Traps & discipline (inherited — full list in MASTER_PLAN §8)

- **No Docker on this machine.** pgTAP cannot run locally. The working method:
  `supabase db query --linked --file X.sql` accepts a multi-statement
  `BEGIN; … ROLLBACK;`, and `pgtap` can be `CREATE EXTENSION`-ed *inside* it.
  Rewrite each assertion as `INSERT INTO tap_out SELECT is(...)` and select the
  failures at the end.
  **Two corrections learned in S11 — the harness lies without them:**
  1. Keep `SELECT plan(N);` in the script. Removing it makes pgTAP raise
     *"You tried to run a test without a plan"* on the first assertion.
  2. The rewrite must cover **every** pgTAP function the suite uses, including
     `has_table`. A missed one still RUNS and still counts toward pgTAP's
     internal numbering, but never lands in `tap_out` — so it silently vanishes
     from the pass count and a failure in it would be invisible. Always compare
     the collected row count against `max(test number)` and treat a mismatch as
     a broken harness, not as a clean run.
  Also: `GRANT ALL ON tap_out TO PUBLIC` — suites switch into the `authenticated`
  role partway through and cannot otherwise insert. Run the CLI from `WILSON/`,
  which is where `supabase/config.toml` and the link live; the git root has no
  Supabase project and must not gain one.
- **`NOT (… OR current_app_role() = 'admin' OR …)` is a trap.**
  `current_app_role()` is NULL for plain members, so the predicate is NULL and
  plpgsql treats `IF NULL` as false. RLS survives it (NULL = deny); anything that
  INVERTS it must `COALESCE(…, false)`.
- **`.upsert()` cannot infer a PARTIAL unique index** — 42P10. All O.T.T.E.R.
  subject uniqueness is partial (`WHERE deleted_at IS NULL`).
- **A refused UPDATE returns 204 with no error.** Always
  `.select(...).maybeSingle()` on writes and throw on 0 rows.
- **`fn_otter_pin_course_identity` silently REVERTS a disallowed visibility
  change.** Always render the row that came back, never the value you sent.
- pgTAP: `throws_ok` message-form only; de-auth before every `tests.login_as`;
  role-gated probes build claims by hand; edited-applied migration on dev =
  `supabase migration repair --status reverted NNNN` + `db push --include-all`.
- CI stack: NO realtime schema, NO pg_cron, and NO storage-api container
  (`rls.yml:80`) — the storage *schema* is present so SQL probes work, but
  nothing needing the Storage HTTP API will run.
- Token discipline: hard cap 15 agents; finders paste excerpts; adversarial
  review before the feature commit.
- The agent NEVER enters credentials — browser eyeballs owed by Audrey.

## Non-goals (S12)

- **Per-workspace API keys and the admin UI for them.** Block A ships the
  *resolution seam* (per-workspace → platform fallback) and a single platform
  key. The `workspace_ai_keys` table, Vault encryption and the admin screen land
  with the operator console in **S14** (locked #21).
- **A subject-level diff view** for change-request review (§6 #28) — reviewers
  compare by eye in v1.
- **Merging the five reference documents** on approval (§6 #29) — subjects only.
- **CSV export, file audit, storage relink, `rabbit-files` bucket, blob GC**
  (**S13** — file lifecycle & data stewardship).
- Operator console (`/wilsonadmin`), final TPN hardening, v1.0.0 (**S14**).
- Field-level cell presence (stretch since S8 — earliest S14).
- Durable Edge-Function rate limiting (S14 TPN). **But note:** `ai-proxy` is a
  spend endpoint, so if per-workspace limiting is cheap to add while you are in
  there, it is worth more here than anywhere else.
- Realtime for O.T.T.E.R. content (deliberately excluded — db/README §19).

## Close-out ritual (MASTER_PLAN §8 — do ALL of it)

Feature commit → CI green (**read it from the public REST API — no `gh` auth
needed**) → deploy any new migrations to staging + prod (dry-run each) → deploy
`ai-proxy` and any other new/edited Edge Functions **to all three envs**, and set
`ANTHROPIC_API_KEY` as a secret on each → re-link CLI to `wilson-dev` → write
`docs/sessions/SESSION_13_prompt.md` (**file lifecycle & data stewardship**, plus
Block C if it slid) → update `docs/MASTER_PLAN.md` (§4 ledger, §5 scope, §6 gaps,
§7 statuses, §10) → update the Claude auto-memory → docs commit + push → list
Audrey's owed browser checks.

**Audrey owes one thing before Block A can be deployed:** an Anthropic API key
set as the `ANTHROPIC_API_KEY` secret on wilson-dev/staging/prod. She can do that
from the Supabase dashboard (Edge Functions → Secrets) or with
`supabase secrets set`. **The agent must never handle the key** — add it to
`docs/OWED_AUDREY.md` and stop there.
