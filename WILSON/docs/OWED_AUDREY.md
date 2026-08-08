# Owed by Audrey — setup tasks the agent cannot do

These need logins the agent doesn't have. Tick them off here as they're done.

**Never paste any of these keys into a Claude conversation.** They go straight
from the source site into GitHub's secrets box.

---

## 0b. Purge `messed up handbook.pdf` from public history — PARKED, not urgent

**Audrey, 2026-08-05: *"lets just move on... i can deal with this pdf later."***
Parked deliberately. **She has read it and confirmed it is trash**, so there is
nothing to rotate and no disclosure to chase — this is cleanup, not security.

**What happened.** `e3c3fc5` (30 Jul) swept a **12.8 MB** PDF into a commit via
`git add -A` and pushed it to the **public** repo. `85b021b`, two minutes later,
ran `git rm --cached` — which removes it from the working tree but **not from
history**. It is still fetchable from GitHub.

| | |
|---|---|
| Repo path | `WILSON/docs/messed up handbook.pdf` |
| Blob | `782e271354932a9677d92c15188a6e6209fbf652` |
| Size | 13,466,523 bytes |
| Reachable from | **only `feat/multi-user-v1`** (local + origin). `main` is clean, no tags affected |
| Local file | **deleted from disk 2026-08-05** |

**The rewrite was rehearsed and verified in a throwaway clone** (not pushed):
`git filter-repo --path "WILSON/docs/messed up handbook.pdf" --invert-paths`
→ PDF gone from all commits, **repo 15 MB → 4.5 MB**, and **the file tree at
HEAD byte-identical — all 479 files, same blob hashes.** Only two side effects,
both consequences of the removal: the `chore: untrack …pdf` commit is pruned
(it becomes empty), and one commit message's stale SHA reference is updated.

**Risk assessment, measured:** only contributor in the rewritten range is
`audrey`; no tags; `main` unaffected; no other branch contains it. **The real
risks are that it force-pushes a public repo and triggers a Vercel redeploy of
the live beta** (`feat/multi-user-v1` is the production branch).

→ **When you want it done:** rerun the filter-repo command above on a fresh
clone, then `git push --force-with-lease origin feat/multi-user-v1`, then reset
the working repo to match. ⚠️ **Also add a `*.pdf` rule to `.gitignore`** —
there is still none, so the identical accident can recur on the next
`git add -A`.

---

## 0. 🚨 ROTATE THE CI PROBE PASSWORD — do this before anything else

**Found by the Session 15 TPN re-audit (TPN-SDLC-007) and verified against the
live database.**

`smoke_admin` is an **active, `admin`-role account on the hosted wilson-dev
project**, and its password was written in plain text in this repo — which is
**public** — in two session checklists and, worse, as a hardcoded fallback in
two tracked Playwright specs. The anon key needed to complete a sign-in is
public by design and ships in the web bundle, so the published pair was
directly usable against the real endpoint by anyone. It is not a local
fixture. The account signed in as recently as the last CI run.

**What Session 15 already did (no credential handling — the agent never
touches these):**

- removed the hardcoded password from `tests/e2e/auth.spec.ts` and
  `tests/e2e/web-path.spec.ts`; both now fail loudly if
  `WILSON_E2E_PASSWORD` is unset, and CI already supplies it from the
  `DEV_PROBE_PASSWORD` secret, so nothing breaks;
- redacted every occurrence from the tracked docs;
- **rewrote the instructions that told you to rotate the password *back* to
  the published literal** — that step is why it stayed valid for eleven
  sessions. The GitHub secret now follows the password, not the reverse.

**What only you can do — and the code changes above do NOT fix this, because
the value is still in git history and on GitHub forever:**

1. Sign in to Supabase → **wilson-dev** → Authentication → Users → find
   `smoke_admin`.
2. Reset its password to a fresh random value (your password manager, not
   something memorable — nothing about this account is typed by a human).
3. Update the **`DEV_PROBE_PASSWORD`** GitHub Actions secret to the new value.
4. Re-run the CI workflow and confirm the Playwright job goes green.

**Then consider the exposure window.** The credential was readable publicly
from Session 3 (2026-04-18) until now. wilson-dev holds no customer content,
which is the saving grace, but check
`SELECT * FROM auth_attempt_log ORDER BY created_at DESC` and the
`app_events` auth stream for sign-ins you do not recognise before you close
this out.

**Worth deciding while you are here:** whether the CI probe needs `admin` at
all. It signs in, checks a project list, and follows an invite — a `user`-role
account would prove the same things with far less to lose. That is a
five-minute change to the seed and would retire the whole class of problem.

---

## 1. B2 backup secrets — **do this first**

**Status: ✅ DONE (2026-07-29).** Bucket `petal-wilson-backups` created in
`us-east-005` with SSE-B2 encryption and Object Lock enabled (no retention rule
set). All six secrets configured. `chore/enable-db-backups` merged to `main`.
Workflow run manually — **both prod and staging jobs green, dumps verified
present in the bucket.** 90-day lifecycle rule in place (`db/` · hide 90 ·
delete 1).

**One thing still outstanding: prove a restore works** — see the end of this
section. Until a dump has actually been restored once, this is an untested
backup.

The setup steps below are kept for reference (rebuilding, or a fourth
environment).

> **Correction (2026-07-29).** An earlier version of this file said there were
> "no database backups at all". The Supabase org is on **Pro**, which includes
> **daily backups with 7-day retention** as standard — so there is very likely
> already a same-platform safety net. Confirm it in the dashboard.
>
> The B2 job is still worth finishing, for the two things Supabase's own
> backups cannot do: it is **off-platform** (a suspended account, billing lapse
> or compromise takes the database *and* its backups together) and it keeps
> **longer retention** (7 days catches "we broke something on Tuesday"; it does
> not catch corruption noticed a month later). Important, not urgent.

Point-in-time recovery was permanently deferred as too expensive (locked
decision #11, ~$100/mo). The replacement is a nightly `pg_dump` to Backblaze B2
— `.github/workflows/backups.yml`, 08:15 UTC, prod + staging. It's written and
committed, but it needs six secrets that were never added, so it exits with an
error every night and has done since Session 9.

### Part A — Backblaze (4 of the 6 secrets)

1. **Account:** [backblaze.com](https://www.backblaze.com) → B2 Cloud Storage.
   Free tier is 10 GB; the dumps are a few MB, so this costs pennies or nothing.

2. **Create the bucket.** B2 → Buckets → Create a Bucket.
   - Name: `wilson-backups` — **bucket names are globally unique across all of
     Backblaze**, so if it's taken try `petal-wilson-backups`.
   - Files in Bucket: **Private**
   - Default Encryption: **Enable** — SSE-B2, Backblaze-managed key. Entirely
     transparent (no workflow change, uploads and downloads behave the same),
     costs nothing, and satisfies "backups encrypted at rest" for the S14
     TPN pass.
   - Object Lock: **Enable**, but set **no default retention rule**.

   → that name is **`B2_BACKUP_BUCKET`**

   **Why Object Lock on, retention off.** Enabling it only makes immutability
   *available*; with no retention configured, files upload and delete exactly
   as normal and the lifecycle rule in step 10 is unaffected. What it buys is
   the option later: Object Lock is WORM, so a retained object cannot be
   deleted or altered by anyone — including you, including someone holding your
   keys. That is a stronger version of the concern already written into
   `backups.yml` ("a compromised CI key with delete rights could otherwise
   purge history"): a lifecycle rule stops the CI key, Object Lock stops
   everyone. Enable at creation because **once on it can never be turned off**,
   so it is free optionality now and friction later.

   > ⚠️ **If you ever do set a retention period, it must be comfortably SHORTER
   > than the lifecycle window in step 10.** Retention 30 days against a 30-day
   > lifecycle rule race each other: the delete fails on anything still locked,
   > files accumulate, and you pay for storage you are not permitted to remove.
   > 7-day retention with a 30-day lifecycle is a sane pairing.
   >
   > B2 offers *Governance* mode (a privileged user can override a lock) and
   > *Compliance* mode (nobody can, ever, no support ticket). Only choose
   > Compliance if you are certain.

3. **Endpoint.** Click the bucket; the details panel shows an **Endpoint** like
   `s3.us-west-004.backblazeb2.com`.

   → **`B2_S3_ENDPOINT`** = that with `https://` in front, e.g.
   `https://s3.us-west-004.backblazeb2.com`

   It must be the real endpoint for your bucket — the job derives its AWS
   region by parsing this hostname.

4. **Application key.** B2 → Application Keys → **Add a New Application Key**.

   > ⚠️ **Do NOT use the Master Application Key** at the top of that page.
   > Master keys do not work with Backblaze's S3-compatible API, which is what
   > this job uses, and the failure is a cryptic auth error. Use the
   > *Add a New Application Key* button below it.

   - Name: `wilson-ci-backups`
   - Allow access to: **just your backup bucket** (not all buckets)
   - Access: **Read and Write**
   - Leave file-prefix and duration empty

   → **`B2_KEY_ID`** = keyID
   → **`B2_APP_KEY`** = applicationKey — **shown once**; copy it before
     navigating away or you'll have to make a new key.

### Part B — Supabase (the other 2)

Do this twice: once for **wilson-prod**, once for **wilson-staging**.

5. Click **`Connect`** in the top bar (next to the branch/environment chip).
   Supabase moved connection strings there — there is no longer a
   Settings → Database page in the dashboard nav.
6. Choose **Session pooler** (not Direct connection, not Transaction pooler),
   port **5432**, and take the **URI** form. The workflow specifically wants
   the session pooler.
7. Copy it. It looks like:
   `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-us-west-1.pooler.supabase.com:5432/postgres`

   **Replace the `[YOUR-PASSWORD]` placeholder with the real database
   password.** Supabase shows a placeholder, not the actual value. If you don't
   have it, reset it on that same page — but note a reset affects anything else
   connecting directly.

   → prod = **`BACKUP_PROD_DB_URL`** · staging = **`BACKUP_STAGING_DB_URL`**

### Part C — GitHub

8. https://github.com/pretty-aud/wilson/settings/secrets/actions
   → **New repository secret**, six times. Names are case-sensitive:

   ```
   B2_KEY_ID
   B2_APP_KEY
   B2_BACKUP_BUCKET
   B2_S3_ENDPOINT
   BACKUP_PROD_DB_URL
   BACKUP_STAGING_DB_URL
   ```

   GitHub will never show the values again after saving. That's expected.

### Part D — Test it immediately

9. **First, merge the workflow onto `main`.** Until then there is nothing to
   run: GitHub fires `schedule` workflows *only* from the default branch, and
   only shows the `workflow_dispatch` "Run workflow" button for workflows
   present there. `backups.yml` shipped in Session 9 onto `feat/multi-user-v1`
   only, so the nightly job has never executed and would not have executed even
   with the secrets set — the missing secrets were only half the reason.
   (`rls.yml` is unaffected: it triggers on `push`/`pull_request`, which run
   from the branch where the event happened. That is why CI works and backups
   did not.)

   PR branch `chore/enable-db-backups` is pushed and contains that one file and
   nothing else:
   https://github.com/pretty-aud/wilson/pull/new/chore/enable-db-backups

   Then https://github.com/pretty-aud/wilson/actions → **db-backups** in the
   left sidebar → **Run workflow** (run it from `main`). Don't wait for
   tonight.

   **Success looks like:** each job ends with
   `uploaded db/prod/wilson-prod-20260729-143000.dump.gz (2.1M)`
   and the bucket shows `db/prod/` and `db/staging/` folders with a
   `.dump.gz` in each. Prod and staging run independently, so one can pass
   while the other fails.

   **If it's red,** paste the failing step's log to Claude. The two usual
   causes are the master key (step 4) and a leftover `[YOUR-PASSWORD]`
   placeholder (step 7).

### Part E — Retention (don't skip)

10. B2 → bucket → **Lifecycle Settings** → **Use custom lifecycle rules** →
    **Add Lifecycle Rules**:

    | Field | Value |
    |---|---|
    | File Path (`fileNamePrefix`) | `db/` |
    | Days Till Hide (`daysFromUploadingToHiding`) | `90` |
    | Days Till Delete (`daysFromHidingToDeleting`) | `1` |

    **Custom rules are required — the simple radio options cannot work here.**
    B2's lifecycle model is version-based: "keep only the last version" and
    "keep prior versions for N days" both act on *older versions of the same
    filename*. Every backup this job writes has a unique timestamped name
    (`wilson-prod-20260729-143000.dump.gz`), so no file ever has a second
    version, nothing is ever superseded, and those options would keep
    everything **forever**.

    The custom rule sidesteps that: hide 90 days after upload, purge a day
    later — roughly 91 days total. B2 requires at least one of the two fields
    and rejects `0`, so `1` is the floor for the second stage. `File Path` is a
    prefix, so `db/` covers both `db/prod/` and `db/staging/`.

    **Why 90 and not 30** (Audrey, 2026-07-29 — "stick to using B2 for longer
    retention"): Supabase Pro already keeps 7 days of daily backups on-platform,
    so B2's job is the retention window Supabase does *not* cover. Thirty days
    barely extends it. The cost of going further is negligible — a compressed
    dump is single-digit MB, so two environments × 365 days lands around 7 GB,
    inside B2's 10 GB free tier. Raise it further if you like; unlike Object
    Lock, lifecycle rules can be changed at any time.

    The workflow deliberately doesn't delete old files itself: if the CI key
    were ever stolen, a key with delete rights could wipe the whole backup
    history. Lifecycle rules run on Backblaze's side, out of reach of that key.

### The restore drill (repeatable — run it quarterly, and after any change to
### the backup path)

> **Status: DEFERRED (Audrey, 2026-07-29) — not blocking S11.** The workflow is
> written and pushed but **not yet merged**; it sits on branch
> `chore/restore-drill`, PR not opened:
> https://github.com/pretty-aud/wilson/pull/new/chore/restore-drill
>
> Until it is merged and run, the B2 backups remain **unverified** — green
> upload jobs prove a file was written, not that it comes back. That is a
> known, accepted gap, not an oversight.

`.github/workflows/restore-drill.yml` does this end to end: pulls the newest
dump from B2, restores it into a scratch database, and verifies the result.
Manual trigger only, and it must be merged to `main` before the Run workflow
button appears (§6 #24).

**The scratch project and its secret are THROWAWAY. Everything else is
permanent.**

| Thing | Lifetime |
|---|---|
| `B2_*` secrets (4) · `BACKUP_*_DB_URL` (2) | permanent |
| `RESTORE_TARGET_DB_URL` | **delete after each drill** |
| the scratch Supabase project | **delete after each drill** |
| `restore-drill.yml` | permanent, inert without the secret |

**To run one:**

1. Create a free-tier Supabase project (`wilson-restore-test` or similar).
2. Add its session-pooler URI as `RESTORE_TARGET_DB_URL`.
3. Actions → **db-restore-drill** → Run workflow ·
   `source_env` = **staging** · `confirm` = **RESTORE**.
4. Green means: the archive parsed completely, the public schema restored,
   row counts came back, and `otter_courses` still has FORCE RLS.
5. **Delete the project and the secret.**

**Why throwaway rather than a standing target.** Free-tier projects pause after
roughly a week idle, so a kept one would be paused every time you returned to
it — no friction is actually saved. And it would be sitting on a restored copy
of real staging data indefinitely, which is the kind of sprawl the S14 TPN pass
will ask about. Deleting the secret also leaves the drill safely disarmed
between runs: the job checks for it up front and stops with a clear message.

**It defaults to the STAGING dump on purpose** — identical schema, so it tests
the mechanism just as well, without duplicating production data into an
unmanaged project.

### Manual restore, if you ever need one for real

A backup you've never restored isn't a backup. Once it's running, download one
dump and restore it somewhere scratch:

```bash
gunzip -c wilson-prod-20260729-143000.dump.gz | pg_restore -d "postgres://...scratch..." --no-owner
```

They're `pg_dump -Fc` custom format, so `pg_restore` can also extract a single
table if you ever need just one thing back. RLS policies, functions and cron
metadata all ride along.

---

## 2. CI checks — **nothing owed, this is now automatic**

**`31586d5` (S10): ✅ all four jobs green.**
**`5707895` (S11): ✅ all four jobs green** — pgTAP, issue-session smoke, Vitest
and Playwright auth, verified at the S11 close-out. Migrations `0000`–`0024`
apply cleanly to an **empty** database in order.

`gh` still isn't authenticated here, but the repo is **public**, so CI runs can
be read straight from the GitHub REST API without any login — Claude did that
for `5707895` and can do it every session from now on. **You no longer need to
check CI by hand.**

Kept below for the rare case where a run needs eyeballing.

1. https://github.com/pretty-aud/wilson/actions
2. Find the run for **`31586d5`** — *"feat(otter): Session 10 — O.T.T.E.R.
   cloud content model"*.
3. Four jobs should be green: **pgTAP**, **issue-session smoke**, **Vitest**,
   **Playwright auth**.
4. Green → nothing to do. Red → paste the failing job's log to Claude.

**Why it still matters, given everything was tested:** the S10 work was
verified against `wilson-dev`, a database that *already had* migrations
0000–0021 applied. CI builds an **empty database and applies all 24 migrations
from scratch, in order** — which catches a migration that only works because of
leftover state. It also runs the Playwright browser test, which the agent
couldn't run locally. A failure is more likely environmental than logical, but
it's worth knowing either way.

---

## 3. Browser eyeball checks still owed (older sessions)

The agent never signs in, so these were left for you:

- **S7:** two-window live sync, presence chips, edit-history drawer revert,
  Ctrl+Z undo
- **S6:** asset delete → undo toast, TeamView roster panel, RateCardPage viewed
  as a plain member
- **S9:** show-once credentials popup on user creation

---

## 4. Browser eyeball checks — Session 11 (the O.T.T.E.R. UI)

Everything here was built and unit/pgTAP-tested, but **no part of the O.T.T.E.R.
UI has ever been seen running**, because it only comes alive when signed in to a
workspace and the agent never signs in. Worth an hour with two accounts (one
admin, one plain member) if you can.

**Highest value first — these are the ones most likely to be wrong:**

1. **Give someone edit access.** Course row → ⋯ → Sharing… → "Who can edit it" →
   pick a colleague → Add. This path was **completely broken** until the review
   caught it (the insert was missing `workspace_id`), so it is the single least
   proven thing in the session. It should now succeed and list them.
2. **Change a course's tier and watch what comes back.** Sharing… → "Just for
   me" ⇄ "Share with the company". The database silently reverts changes it
   won't allow, so the dialog re-reads the row — if you ever see a tier change
   *appear* to work and then come back wrong on reload, that is a real bug.
3. **Delete a course, then restore it.** ⋯ → Move to trash → "Recently deleted"
   chip → Restore. This is the whole point of migration 0024. Also try
   restoring after creating a *new* course with the same name — you should get
   "You already have a course with this name", not a raw error.
4. **Collapse the sidebar** (the chevron at its top, or `Ctrl + \`). Check it
   stays collapsed across an app restart, that the main pane widens rather than
   letterboxing in the **study** view, and that `Ctrl + \` does **nothing** when
   you're on RABBIT or Settings.

**Then the rest:**

5. Filter chips: Made for me / Shared with me / Shared by me / Company standard.
   As an admin you also get "Others' personal" — those rows should be visible
   but **not openable**, and you must not be able to read their contents.
6. As an **admin**, mark a shared course "Company standard". Then, as a **plain
   member**, start a new course and type that exact name — you should get the
   inline "Your company already has a course for this" offer, and taking it
   should give you your own editable copy.
7. From that copy: ⋯ → Suggest a change… → write a note → send. Then as an admin,
   **Admin Terminal → Requests** → approve or reject. Note that approving records
   a decision only; it does **not** copy their changes in (MASTER_PLAN §6 #26 —
   tell me if you want it to).
8. Open a course someone else shared with you: the generate/edit/delete buttons
   should be **absent**, with "Read only" shown and a "Make my own copy" button
   in their place.
9. **Settings → the new "Migrate O.T.T.E.R. courses to cloud" panel.** Dry-run
   first. It reads courses from your local disk, so it only appears in the
   desktop app.

**Sanity check that nothing regressed:** sign OUT and use O.T.T.E.R. as before.
All the sharing controls should vanish entirely and it should behave exactly
like the old single-user tool.

---

## 5. Anthropic API key as a Supabase secret — ✅ DONE (2026-07-30, S17)

> **Verified 2026-07-30 by `supabase secrets list` on each project:
> `ANTHROPIC_API_KEY` and `WILSON_AI_KEY_SECRET` are set on all three, and
> the digests match across dev, staging and prod.** The matching digest on
> `WILSON_AI_KEY_SECRET` is the part worth having checked: a company key
> encrypted on one environment can now be decrypted on the others, where
> differing values would have failed per-environment and confusingly.
> No redeploy was needed — Edge Functions read secrets on next invocation.
>
> **Keep the history below.** It cost a session to untangle and the trap is
> re-armable: for eleven sessions this file and MASTER_PLAN both claimed
> staging already had the key, and neither had been re-checked. It was on
> none of the three. **Assertions about deployed state need a date and a
> command, or they rot into folklore.**
>
> **The key HAD been added — to the wrong store.** It was a **GitHub
> repository secret** (Settings → Secrets and variables → Actions). That store
> is readable only by GitHub Actions workflows, through
> `${{ secrets.ANTHROPIC_API_KEY }}` — and a grep of `.github/workflows/`
> shows **no workflow references it at all**, so today nothing reads it
> anywhere. It cannot reach `ai-proxy`: Edge Functions run in Supabase's Deno
> runtime and read Supabase's own secret store via
> `Deno.env.get('ANTHROPIC_API_KEY')` (`ai-proxy/index.ts:77`).
>
> **There are three separate things called "secrets" in this project and they
> do not talk to each other:**
>
> | Store | Read by | Set via |
> |---|---|---|
> | GitHub repository secrets | Actions workflows only | GitHub → Settings → Secrets |
> | **Supabase Edge Function secrets** | **`ai-proxy` and every other function** | **`supabase secrets set`, or the dashboard** |
> | Vercel environment variables | the web build at build time | Vercel → Project → Settings |
>
> The one `ai-proxy` needs is the middle row. Setting it is §5's command below.
>
> A second, older trap worth knowing since it has the same symptom: before S12
> the key lived on each machine in `localStorage['wilson-api-key']` behind a
> Settings field. S12 deleted that field and now *purges both legacy slots on
> every launch* (`src/App.jsx:231-234`, locked #21), so an old machine-local
> key is gone too.
>
> `WILSON_AI_KEY_SECRET` (§9C) is likewise unset on all three projects.

Session 12 moved every AI call behind one Edge Function (`ai-proxy`) so the key
stops living on each user's machine (locked #21). For that to work, **one key
needs to exist server-side on each of the three environments.**

**Claude must never see or handle this key** — same rule as the B2 secrets.

Either from the dashboard: **Supabase → your project → Edge Functions →
Secrets → Add new secret**, name `ANTHROPIC_API_KEY`, value the key. Repeat for
`wilson-dev`, `wilson-staging`, `wilson-prod`.

Or from a terminal, once per project:

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref eqjzmnvkrakroyqxfsvw
```

(`eqjzmnvkrakroyqxfsvw` = dev, `rzkirvkotslbovzbsdfh` = staging,
`rqyriuyldhovirbuievt` = prod.)

**One key is enough for now** — it becomes the platform fallback. Per-company
keys, administered in the operator console, land in S14; the S12 work builds the
seam for them so nothing has to be rewritten.

**A side benefit worth knowing:** once this is in, your users no longer paste
their own key into WILSON at all. The Settings key field goes away and the stored
`wilson-api-key` is deleted from their machines. Every call is attributed to the
company key, and usage lands in the Admin Terminal logs with token counts.

---

## 6. Session 12 — light up the web test host

The web build is pushed and waiting; these make it reachable.

### A. Host it on Vercel — ✅ DONE (2026-07-29)

**Live at `https://beta.petalstudios.co/wilson`** (staging-backed; the bare
subdomain redirects there). `WILSON_SITE_URL` on staging already re-pointed
at it. Remaining for beta testing: **B below (staging!), the
`ANTHROPIC_API_KEY` secret (§5/6C), and a staging workspace + invites for
your testers.** Setup steps kept for reference:

### A-setup (reference)

The repo already carries `WILSON/vercel.json`, so this is import-and-click:

1. Vercel dashboard → **Add New → Project** → import `pretty-aud/wilson`.
2. Set **Root Directory = `WILSON`**. Leave build/output alone —
   `vercel.json` supplies them.
3. Add two **environment variables** (they're baked in at build time):
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, copied from the
   Supabase dashboard (Settings → API) of the env beta testers should use —
   **staging recommended** (dev churns every session; prod stays clean for
   v1.0). Swapping envs later = edit the two vars + Redeploy.
4. Deploy once, then **Settings → Git → Production Branch →
   `feat/multi-user-v1`** and redeploy. This matters twice over: `main`
   doesn't contain the web build, and only *production* deployments are
   publicly reachable — Vercel's *preview* URLs default to team-member-only
   authentication, which beta testers can't pass.
5. Optional but nice: **Settings → Domains** → add `beta.petalstudios.co`,
   then in Squarespace DNS add the CNAME Vercel shows you
   (host `beta` → `cname.vercel-dns.com`). Testers get
   `https://beta.petalstudios.co/wilson`.
6. **Tell Claude the final URL** so the `WILSON_SITE_URL` secret can be
   re-pointed at it (it currently points at the GitHub Pages URL).

**Worth knowing:** the deployed bundle embeds the chosen env's project URL
and **anon key**. That's by design — anon keys are public in every deployed
web app and RLS is the actual security boundary (sign-ups are off, every
table is FORCE RLS and pgTAP-pinned). Beta testers still need an invited
account to see anything.

### A-alt. GitHub Pages (fallback, already pushed)

If Vercel ever misbehaves: https://github.com/pretty-aud/wilson/settings/pages
→ **Source: Deploy from a branch** → `gh-pages` / root → app at
`https://pretty-aud.github.io/wilson/`. Same anon-key note applies.

### B. Supabase auth URLs — ✅ DONE for staging (2026-07-29). The
### `ANTHROPIC_API_KEY` claim that used to sit here was WRONG — see §5

What remains for beta: **a staging workspace + tester invites** (the "New
company?" flow on the beta site, then invite from the Admin Terminal), and
the §7 browser checks. Dev/prod auth URLs stay for whenever those envs need
a web surface. Original steps kept for reference:

### B-setup (reference)

Dashboard → Authentication → **URL Configuration**, for whichever env the
Vercel project points at (and the others when you want their invite/recovery
emails landing on the web build) — using your final web URL from 6A:

- **Site URL:** `https://<your-host>/wilson`
  (e.g. `https://beta.petalstudios.co/wilson`)
- **Additional redirect URLs:** add `https://<your-host>/wilson/**`

(Claude deliberately did NOT push this via `supabase config push` — that
command would also push the local SMTP block and break Resend email. The
`WILSON_SITE_URL` secret the Edge Functions use for email links IS already set
on all three envs.)

### C. The `ANTHROPIC_API_KEY` secret — section 5 above, still owed

Until it's set, every AI feature (on desktop AND web) answers
*"AI is not configured for this workspace yet — ask your admin."* That message
appearing is correct behavior, not a bug.

---

## 7. Browser eyeball checks — Session 12

The agent verified the web build signed-out (Playwright: deep links, URL sync,
back button, login screens) and the sign-in flow via the seeded smoke fixture.
Still owed, because they need your real account and/or the key:

1. **After setting the API key secret (5/6C):** in the DESKTOP app, generate
   something in each tool — an O.T.T.E.R. subject (the long one — it now
   streams through the proxy), a D.O.G. page outline, a RABBIT intake, one pet
   chat message, one Validator run. Then check **Admin Terminal → Logs** for
   `WIL-6001 AI request completed` lines with token counts — that's the new
   spend telemetry.
2. **On the web** (after 6A/6B): sign in at `pretty-aud.github.io/wilson`,
   check the O.T.T.E.R. library loads (the S10 gap #21 fix), navigate around
   and use the back button, deep-link straight to
   `/wilson/otter`, and run one generation there too.
3. **Settings on the web:** RABBIT tab should show Local Server / Google Drive
   as "Available in the desktop app only"; the API-key field is gone everywhere
   (replaced by "AI features are included with your workspace sign-in").
4. **Recovery email on the web:** after 6B, run "Forgot password" and confirm
   the email link lands on the web build's reset screen.

---

## 8. Browser eyeball checks — Session 13 (change-request approval)

Migration 0025 is deployed and pgTAP-pinned on all three envs; what's owed is
the human pass over the two dialogs. You need **both accounts** — the admin
and a plain member — and a company-standard course the member has forked
(fork it via "Use the company standard" if none exists).

1. **The review window.** As the member, open the fork's "Suggest a change"
   dialog, write a summary, submit. As the admin, Admin Terminal → Requests:
   the request is in Open, and **"Open their course" works** — it jumps to
   O.T.T.E.R. with the member's fork readable. Decide the request (either
   way), then confirm the fork **disappears** from your O.T.T.E.R. library
   again — the window must close on settle.
2. **Approve applies.** Have the member's fork differ three ways: one subject
   edited, one brand-new subject added, one subject deleted from the fork.
   Approve as the admin — the confirm should state the add/update counts and
   the archive. Then check the standard course: the edit landed, the new
   subject is there, and the subject the member deleted is **still present**
   (additive only). Check your own library for the archive copy —
   `<name> (before change #1)` — and that it holds the OLD content.
3. **The decline conversation.** Decline a request — the note field should
   refuse to send empty. As the member, reopen the fork's dialog: the note is
   shown, "Accept the decision" closes it for good, and (on a fresh decline)
   "Resubmit with changes" puts it back in the admin's Open tab showing
   **round 2**. Confirm a settled request shows its final state in the
   Decided tab.
4. **The in-Otter Requests tab (added 2026-07-30).** As the admin, O.T.T.E.R.
   now has an **"Admin"** tab in the top nav — same queue, same Approve /
   Decline, plus "Open their course" jumping straight to the fork in the
   library. As the member, the tab reads **"Requests"** and shows the
   requests they sent with the admin's note; "Review & respond" opens the
   dialog. Confirm the tab is absent in local (signed-out desktop) mode.
5. **The manager tier (needs a third account, or temporarily set your plain
   member to Manager in Team Members).** A manager's "Requests" tab lists the
   whole open queue **read-only** — no Approve/Decline buttons, and the
   proposer's fork must NOT appear in their O.T.T.E.R. library (the review
   window is deciders-only). Flip the role back afterwards if you borrowed
   the member account.

---

## 9. Session 15 — the operator console (/wilsonadmin)

Four things, and the first two are **blocking**: without them the console
signs you in and then refuses every action.

### A. Enrol TOTP on your account — BLOCKING

The operator console requires two-factor authentication outright. This is not
the S9 admin behaviour (which only challenges people who already enrolled) —
`_shared/operatorGuard.ts` refuses any operator with no verified factor, and
any session below `aal2`. The console can destroy a company, so it is the one
surface where MFA is not optional.

Enrol in the normal app: **WILSON → Settings → Security → add an
authenticator**, scan the QR, confirm the six-digit code. Then sign in to
`/wilsonadmin` with **email + password + code**.

> Note the console uses your **email**, not the username-first login. A
> platform operator has no company for `resolve-login` to resolve against —
> that is what the tier means.

### B. Make yourself a platform operator — BLOCKING

There is deliberately **no UI for this**, on any surface. Granting the platform
tier is SQL-only, so the highest privilege in the system cannot be escalated
from a web session — not even by another operator. It is a break-glass
property, and it is worth keeping.

Run this once per environment you want console access on, in the Supabase
dashboard SQL editor (replace the email):

```sql
INSERT INTO public.platform_operators (user_id)
SELECT id FROM auth.users WHERE email = 'you@example.com'
ON CONFLICT (user_id) DO NOTHING;
```

Check it took:

```sql
SELECT u.email, po.granted_at
  FROM public.platform_operators po
  JOIN auth.users u ON u.id = po.user_id;
```

### C. `WILSON_AI_KEY_SECRET` — needed before per-company keys work

Per-company Anthropic keys are stored as AES-256-GCM ciphertext. The key that
encrypts them lives in an Edge Function secret and never touches Postgres —
which is the point, because the nightly `pg_dump` goes off-platform to B2
(§1). Without this secret the console refuses to store a company key with a
clear message, and every company keeps billing to the platform key.

**Claude must never see or handle this value** — same rule as §1 and §5.

Generate 32 random bytes, base64-encoded:

```bash
openssl rand -base64 32
```

Then set it on each project (dev `eqjzmnvkrakroyqxfsvw`, staging
`rzkirvkotslbovzbsdfh`, prod `rqyriuyldhovirbuievt`):

```bash
supabase secrets set WILSON_AI_KEY_SECRET=<the-base64-value> --project-ref eqjzmnvkrakroyqxfsvw
```

> ⚠️ **Rotating this secret orphans every stored company key.** The
> ciphertext becomes undecryptable, `ai-proxy` fails soft to the platform
> key, and the console still shows the old hint. If you ever rotate it, clear
> and re-enter each company's key from the console afterwards.

### C2. `WILSON_STORAGE_KEY_SECRET` — needed before S3 storage works (S37)

**BLOCKING for the S3-compatible storage feature, and only for it.** Nothing
else changes if it is missing: WILSON keeps working exactly as it does
today, and a company that tries to configure a bucket gets a clear
`WILSON_STORAGE_KEY_SECRET is not configured on this environment` rather
than a mystery.

Same shape and same rules as §C above — a company's bucket secret is stored
as AES-256-GCM ciphertext, and the key that opens it lives in an Edge
Function secret so the nightly B2 dump carries an archive it cannot read.

🚨 **It is a SEPARATE secret from `WILSON_AI_KEY_SECRET`, deliberately.**
Two credential domains that rotate independently: rotating the AI key must
not cut every company off from its own media, and vice versa. Generate a
second, different value — do not reuse the first.

**Claude must never see or handle this value** — same rule as §1, §5 and §C.

```bash
openssl rand -base64 32
```

Then set it on each project (dev `eqjzmnvkrakroyqxfsvw`, staging
`rzkirvkotslbovzbsdfh`, prod `rqyriuyldhovirbuievt`):

```bash
supabase secrets set WILSON_STORAGE_KEY_SECRET=<the-base64-value> --project-ref eqjzmnvkrakroyqxfsvw
```

> ⚠️ **Rotating this one orphans every stored bucket secret**, and the
> consequence is heavier than §C's: `storage-presign` fails CLOSED (there is
> no platform fallback for a customer's bucket — there must not be), so that
> company's media becomes unreachable until an admin re-enters the secret in
> **Admin Terminal → Storage**. If you rotate it, tell the affected
> companies first.

### D. Browser eyeball checks — Session 15

The agent never signs in, so these are yours. On the dev environment first.

1. **Session isolation.** Sign in to `/wilson` as normal. In the SAME browser,
   open `/wilsonadmin`. It must show its own sign-in screen and NOT inherit
   your app session. Then sign in to the console, go back to the `/wilson`
   tab, and confirm you are still signed in there as the ordinary user.
   (Verified at build time — the two bundles ship different storage keys —
   but this is the check that proves it end to end.)
2. **Non-operator refusal.** Sign in to `/wilsonadmin` with an account that is
   NOT in `platform_operators`. Expect the "Not a platform operator" screen,
   not a broken console.
3. **Create a company.** Use a throwaway slug. Confirm the show-once password
   dialog appears, copy it, then confirm you can sign in to `/wilson` as that
   new admin with company-slug + username + password.
4. **Suspend and restore it.** While suspended, confirm the new admin can no
   longer reach the workspace; after restore, confirm they can again.
5. **Per-company key.** Paste a real Anthropic key into the throwaway company.
   A wrong key must be REFUSED (the function calls Anthropic before storing).
   A good key stores and shows only the last four characters — there is no
   reveal, by design.
6. **Tear the throwaway company down.** Type the slug to confirm. Check the
   result summary reports the blob counts, then open **Audit** and confirm a
   `workspace.teardown` row is there *and still names the company* — that row
   surviving the deletion is the whole point of the separate audit table.
7. **Settings → General** in the normal app: the Change Password panel should
   now say your password is managed by your workspace account, on BOTH
   Electron and web (the legacy local-password form is gone).

---

## 10. Nice to have

`gh auth login` on the dev machine. CI turned out to be readable anyway (the
repo is public), but an authenticated `gh` would let Claude open PRs and read
private repos directly instead of handing you URLs.

---

## 11. 🚨 Operator console go-live — three things, and one is a real decision

**Added 2026-07-30 (Audrey): "enrol totp and seed for the operator system. i
want it to be hosted on petalstudios.co/wilsonadmin".**

The console is built, deployed and tested by pgTAP — but **no human has ever
signed in to it**, because all three of these are outstanding. Nothing here is
something the agent can do for you: two involve credentials, one is a domain
decision.

### A. Enrol TOTP — BLOCKING

Already written up in **§9A**. In short: WILSON → Settings → Security → add an
authenticator, scan, confirm. The console refuses any operator with no verified
factor *and* any session below `aal2` — this is the one surface where MFA is
not optional, because it can destroy a company.

### B. Seed `platform_operators` — BLOCKING

Already written up in **§9B**, with the exact SQL. Run it once per environment
you want console access on. There is deliberately no UI for this, on any
surface — that is what stops the platform tier being escalated from a web
session, even by someone who already holds it.

**Do A and B together.** Either one alone leaves you signed in and refused.

### C. Console hosting — ✅ DECIDED 2026-07-30: `admin.petalstudios.co/wilsonadmin`

> **Audrey chose option 1 (subdomain).** Final URL:
> **`https://admin.petalstudios.co/wilsonadmin`**.
>
> **Zero repo changes.** Nothing in the codebase hardcodes a host — the only
> two `beta.petalstudios.co` strings under `src/` are explanatory comments.
> `vercel.json` already builds both surfaces and rewrites `/wilsonadmin*` →
> `/wilsonadmin/admin.html`, and it routes on **path**, so it works unchanged
> on any domain attached to the project.
>
> **Setup — two steps:**
>
> 1. Vercel → project `petal-studios/wilson` → **Settings → Domains** → add
>    `admin.petalstudios.co`.
> 2. Squarespace DNS → add the CNAME **Vercel shows you on that screen**
>    (host `admin`; the value for `beta` was `cname.vercel-dns.com`, but read
>    it off the screen rather than assuming — Vercel changes it). Wait for the
>    certificate to issue.
>
> **What this does and does not change.** Every domain on a Vercel project
> serves the *same deployment*, and rewrites match on path only — there is no
> host-based routing here. So `admin.petalstudios.co` serves **both** surfaces,
> exactly as `beta.` does: `/wilsonadmin` is the console and `/wilson` is the
> product app. `beta.petalstudios.co` keeps working unchanged. Nothing is
> removed; a domain is added.
>
> ⚠️ **One real consequence: use the product app on `beta.`, not on `admin.`**
> `ForgotPasswordWizard` builds its recovery link from `window.location.origin`
> at runtime (`ForgotPasswordWizard.jsx:33-37`). A new origin is not in
> staging's `additional_redirect_urls`, so forgot-password started from
> `admin.petalstudios.co/wilson` produces a redirect Supabase will **reject**.
> Either treat `admin.` as console-only (recommended — it is what the subdomain
> is *for*), or add `https://admin.petalstudios.co/wilson/**` to the staging
> project's Authentication → URL Configuration. Invite and admin-reset mails
> are unaffected: those build from the server-side `WILSON_SITE_URL` secret,
> not the browser origin.
>
> **A security bonus that comes free with this choice**, and the reason it was
> recommended over the apex on more than convenience grounds: a different
> subdomain is a different **origin**, so the browser now enforces the
> separation between the console's session and the app's. Today that
> separation rests entirely on a build-time key string
> (`wilson.operator.session` vs `wilson.dev.session`) because both surfaces
> share one origin — and any future code reading a session without going
> through `sessionStorage.js` would silently defeat it. On a separate origin
> there is no shared store to leak through in the first place.
>
> **The apex remains post-1.0** and needs no further decision now. If you ever
> want `petalstudios.co/wilsonadmin` itself, the options and their real costs
> are preserved below — and note the landmine recorded there: `vercel.json`'s
> `/` → `/wilson` redirect would capture your marketing homepage if the apex
> were pointed at Vercel without a proxy in front.

---

### C-original. Hosting at `petalstudios.co/wilsonadmin` — the apex options (kept for reference)

**Where it lives today:** `https://beta.petalstudios.co/wilsonadmin`, served by
the Vercel project `petal-studios/wilson`. `vercel.json` already builds both
surfaces and rewrites `/wilsonadmin*` → `/wilsonadmin/admin.html`, so **the
path shape you want already works** — it is the *domain* that differs
(`beta.petalstudios.co` vs the apex `petalstudios.co`).

**Why this is not just a Vercel setting.** The apex `petalstudios.co` is
currently served by Squarespace — your actual website. Putting
`petalstudios.co/wilsonadmin` on Vercel means the apex domain's traffic has to
reach Vercel, and Squarespace cannot route a single path elsewhere. This is
exactly the constraint locked decision #18 flagged and §10 relaxed ("the
production domain cutover is post-v1.0"). Three ways out:

| Option | What it means | Cost |
|---|---|---|
| **1. Keep a subdomain** — e.g. `admin.petalstudios.co/wilsonadmin`, or leave it on `beta.` | Add the domain in Vercel, add one CNAME at Squarespace. Works today. | ~10 minutes. Not the apex. |
| **2. Put Cloudflare in front of the apex** | Move `petalstudios.co`'s DNS to Cloudflare, proxy `/wilson*` and `/wilsonadmin*` to Vercel, everything else to Squarespace. Gets you the exact URL you asked for. | Half a day, plus a DNS migration with real downtime risk to your live site. |
| **3. Move the whole apex to Vercel** | The marketing site moves too, or gets redirected. | Largest change; only worth it if you were leaving Squarespace anyway. |

**Recommendation: option 1 for v1.0, option 2 after.** The operator console is
an internal tool used by you and eventually one or two colleagues — the URL
being `admin.petalstudios.co/wilsonadmin` instead of
`petalstudios.co/wilsonadmin` costs nothing operationally, and it does not put
a DNS migration of your live website on the critical path to shipping. Nothing
in the codebase cares which of the three you pick: the path shape is already
correct and `vercel.json` needs no change.

> One property worth knowing before you choose. `/wilson` and `/wilsonadmin`
> being on the **same origin** is what makes session isolation depend entirely
> on a build-time key string (`wilson.dev.session` vs
> `wilson.operator.session`). Putting the console on a **different** subdomain
> would give you a second, stronger, browser-enforced separation for free —
> different origin, different localStorage, no shared store at all. That is a
> mild argument for option 1 on security grounds, not just convenience.

**What to tell the agent once you decide:** just the final URL. If it is a new
domain, add it in Vercel (Project → Settings → Domains) and add the CNAME at
Squarespace; if the console moves off the current origin, the Supabase auth
`site_url` / `additional_redirect_urls` may need that origin added too — worth
a quick check on the sign-in flow afterwards.

---

## 12. 🚀 Getting into the operator console for the first time — the runbook

**Written 2026-07-30 (S17), verified against the code.** §11A and §11B say
*what* is owed; this says *in what order*, because the dependencies are not
obvious and getting them wrong wastes an hour.

**The console sign-in is `Email` + `Password` + `Authenticator code`.** No
username, no company field — an operator has no company, which is the
definition of the tier (`src/admin/OperatorLogin.jsx:163-192`).

**The dependency that catches people: there is no TOTP enrolment anywhere in
the console.** A repo-wide search of `src/admin/` finds no enroll/factor UI.
Enrolment happens in the *product app*, which means you need a workspace
account before you can become an operator — even though operators have no
workspace. That inversion is the whole trap.

**And it must all be on the same environment as the console you will use.**
`admin.petalstudios.co` and `beta.petalstudios.co` are both **staging**-backed
(§11C). An account, a TOTP factor and a `platform_operators` row on
**wilson-dev** will not let you into a staging-backed console. Staging ref:
`rzkirvkotslbovzbsdfh`.

### Step 1 — Create a company on staging

`https://beta.petalstudios.co/wilson` → **`New company?`**

- **Company step:** name (1–80 chars) and slug (`^[a-z0-9][a-z0-9-]{1,62}$`,
  auto-derived from the name until you edit it).
- **Profile step:** username, **a real email you can read** — this is what you
  will type into the console — display name, and a password of at least 10
  characters.
- **Team step:** `skip — just me for now`. Do invites deliberately afterwards;
  everything sent from this step is `app_role: 'user'` anyway.

You are the first admin. **You do not invite yourself** — the wizard creates
your account directly. Invites are for your second and third users.

The wizard deliberately does **not** sign you in. It hands `{username, slug}`
back so the login screen opens pre-filled. Every session in the product goes
through `signInWithPassword`; there is no second way in.

> `provision-workspace` rate-limits to **3 provisions per hour per IP**. If you
> re-run this while testing, a fourth attempt returns
> `TOO MANY REQUESTS. TRY AGAIN LATER.` — that is the limiter, not a fault.

### Step 2 — Sign in and enrol TOTP

Sign in at `/wilson` with the **username** (not the email) and password.

Because you are an admin with no verified factor, the app meets you with a
full-screen overlay headed **`SECURE YOUR ADMIN ACCOUNT`** before you reach
anything else (`App.jsx:296-310`, `MfaSection.jsx:224`). Enrol from there.

If you deferred it with `Set up later`, the same control is at
**`SYSTEM SETTINGS` → `PROFILE` tab → "Two-Factor Authentication" → `Set up`**.

> §9A says "Settings → Security". That is stale — the card is on the
> **Profile** tab.

Scan the QR, enter the six digits, confirm. It should read `Enabled`, and as
an admin you will see "Admins must keep MFA on." with no Disable button.

### Step 3 — Grant yourself the platform tier (SQL only, on staging)

Run the `INSERT` **and** the verification `SELECT` from **§9B**, exactly as
written, in the Supabase SQL editor for **wilson-staging**.

There is deliberately no UI for this on any surface. The console can destroy
companies, so the one thing it must not be able to do is mint more operators —
this keeps the highest privilege in the system un-escalatable from a web
session, even by someone who already holds it. The cost is one `INSERT` per
environment when bootstrapping.

### Step 4 — Sign in to the console

`https://admin.petalstudios.co/wilsonadmin` → **Email** + **Password** →
**Authenticator code**.

**Three screens are possible after a correct password, and they mean different
things** (`src/admin/OperatorApp.jsx:111-155`):

| What you see | What it means | What to do |
|---|---|---|
| The console (Companies / Audit) | Working. | — |
| **"Not a platform operator"** | Step 3 did not take, or ran on the wrong environment. | Sign out, fix, retry. |
| **"Could not verify operator status"** | The check could not reach the database. **Not** a revocation. | Click **Retry**. Do *not* sign out. |

> Expect to be asked for your authenticator code **before** being told you are
> not an operator: the `platform_operators` check runs in the app after
> sign-in completes, not in the login form. That ordering is deliberate — the
> console never reveals operator status to an unauthenticated caller.

### If the console signs you in and then refuses every action

That is the §11A/§11B pair coming apart, and `_shared/operatorGuard.ts` tells
you which half. Read the error string in the browser network tab:

| Error | HTTP | Meaning |
|---|---|---|
| `forbidden` | 403 | No `platform_operators` row. Step 3, wrong env. |
| `mfa_enrollment_required` | 403 | No verified TOTP factor on this account. Step 2. |
| `mfa_required` | 403 | Enrolled, but this session is below `aal2`. Sign out and back in *with the code*. |
| `mfa_check_failed` | 503 | Factor lookup failed. Transient — retry. Fails closed on purpose. |
| `operator_check_failed` | 503 | Operator lookup failed. Transient — retry. |

The operator-row check runs **before** both MFA checks, so a non-operator
always gets `forbidden` regardless of their MFA state.

---

## 13. ⏳ Google OAuth verification for Drive storage (S38) — START EARLY

**Why this is here and not in the session brief:** every other item in the
S36–S43 plan is work WILSON can do on its own schedule. This one is **a review
by Google, on Google's schedule**, and it can idle for weeks. If it is
discovered at the start of S38 the session stalls. **File it whenever you
like — it costs nothing to have it approved early and unused.**

If Drive is dropped (S37's S3-compatible adapter covers AWS, Backblaze B2,
Wasabi, Hetzner, Cloudflare R2 and MinIO with no OAuth at all), **skip this
entire section.**

### 🚨 The one decision that sets the cost

| Scope | Tier | What it costs |
|---|---|---|
| `https://www.googleapis.com/auth/drive` | **RESTRICTED** | An independent security assessment (CASA), **repeated annually**, at real expense |
| **`https://www.googleapis.com/auth/drive.file`** | **not restricted** | Consent-screen verification only — no assessment |

**Request `drive.file` and nothing else.** It grants access to files the app
itself created, which is exactly what WILSON needs, because WILSON creates
every file it stores. ⚠️ **If anyone widens this to full `drive` later, the
annual assessment starts applying** — it is a commercial decision, not a
technical one.

⚠️ **Google moves these goalposts.** Re-read their current scope policy when
you file; the tiers above were measured 2026-08-07.

### The checklist

1. **Google Cloud Console → create a project** (or reuse a Petal one). Name it
   for Petal Studios, not for a person.
2. **Enable the Google Drive API** on that project.
3. **OAuth consent screen → External**, publishing status **In production**
   (Testing mode caps you at 100 users and expires refresh tokens in 7 days —
   that would look exactly like the "my files vanished" bug the brief warns
   about).
4. **App information** — these are the fields that get rejected most often, so
   get them right first time:
   - App name + support email
   - **App logo** (120×120 PNG). ⚠️ Uploading a logo is what *triggers* brand
     verification. It is still worth doing — an unbranded consent screen looks
     untrustworthy to a customer's IT department.
   - **Application home page** — must be a live public page on a domain you own
   - **Privacy policy URL** — must be live, public, and must actually mention
     what you do with Drive data
   - **Terms of service URL**
5. **Authorised domains** — `petalstudios.co`. Every URL above must sit on it.
6. **Scopes** — add **only** `drive.file`. The console will show it as
   non-sensitive; if it shows anything as *restricted*, stop and re-check.
7. **Credentials → OAuth client IDs**, two of them:
   - **Web application** — for the beta. Authorised redirect URI on the beta
     origin.
   - **Desktop app** — for the Electron build. Uses a loopback redirect and
     **PKCE**; a secret shipped in an installer is not a secret, and Google's
     installed-app guidance says so.
8. **Domain verification** — Search Console ownership of `petalstudios.co`,
   under the same Google account.
9. **Submit for verification.** Expect Google to ask *why* you need the scope;
   the honest answer is short: *"The app stores and retrieves the customer's
   own production media in a folder they choose. It only touches files it
   created."*
10. **Record the client IDs** in the repo's config the way other credentials
    are handled. 🚨 **Never paste a client secret into a Claude conversation**
    — same rule as every other key in this document.

### What to expect

- Brand/consent verification is typically **days to a few weeks**. It is not
  the multi-month restricted-scope review, *because* you asked for
  `drive.file`.
- Rejections are usually about the privacy policy or an unreachable homepage,
  not about the scope. Both are fixable and resubmittable.
- **Until it is approved**, the consent screen shows an "unverified app"
  warning. Fine for your own testing; not something to put in front of a
  customer.

### One product decision the brief flags, worth knowing now

`drive.file` means **WILSON cannot see files a person drops into the Drive
folder by hand** — it is a store WILSON writes and reads, not a folder WILSON
browses. That is correct for media storage and it is what keeps the cost down,
but the UI must never imply "sync my existing Drive folder". If that turns out
to be what a customer actually wants, it is a different (and much more
expensive) product.
