# SESSION 12 launch prompt — the web build

> Paste into a new Claude Code conversation from the WILSON repo.
> **Master plan: `docs/MASTER_PLAN.md` — read §2–§6 and §10 BEFORE any code.**
> **First tool call** per standing rule: `git status` on `feat/multi-user-v1`.

> Three sessions remain after this one: **S12 web build · S13 file lifecycle &
> data stewardship · S14 operator console + TPN + v1.0.0.**

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

## Session 12 goal — the web build + hosting/routing (all three tools)

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
4. **Web D.O.G.** (locked #17) — an Edge-Function Anthropic proxy so the API key
   never ships to a browser; generates off the open project's cloud files.
   **Note:** `Otter.jsx` still calls `https://api.anthropic.com` directly with
   `anthropic-dangerous-direct-browser-access` and the user's key
   (`callAnthropicAPI`). On the web that ships the key to the browser. O.T.T.E.R.
   needs the same proxy treatment as D.O.G., or generation must be disabled on
   the web build. **Decide this explicitly — do not let it ship by omission.**
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

- **CSV export, file audit, storage relink, `rabbit-files` bucket, blob GC**
  (**S13** — file lifecycle & data stewardship).
- Operator console (`/wilsonadmin`), final TPN hardening, v1.0.0 (**S14**).
- Field-level cell presence (stretch since S8 — earliest S14).
- Durable Edge-Function rate limiting (S14 TPN).
- Realtime for O.T.T.E.R. content (deliberately excluded — db/README §19).

## Close-out ritual (MASTER_PLAN §8 — do ALL of it)

Feature commit → CI green → deploy any new migrations to staging + prod (dry-run
each) → deploy any new/edited Edge Functions → re-link CLI to `wilson-dev` →
write `docs/sessions/SESSION_13_prompt.md` (**file lifecycle & data
stewardship**, scope in MASTER_PLAN §5) → update `docs/MASTER_PLAN.md` (§4
ledger, §5 scope, §6 gaps, §7 statuses, §10) → update the Claude auto-memory →
docs commit + push → list Audrey's owed browser checks.
