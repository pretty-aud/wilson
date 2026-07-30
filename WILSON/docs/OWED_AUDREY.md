# Owed by Audrey — setup tasks the agent cannot do

These need logins the agent doesn't have. Tick them off here as they're done.

**Never paste any of these keys into a Claude conversation.** They go straight
from the source site into GitHub's secrets box.

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

## 5. Anthropic API key as a Supabase secret — needed before S12 Block A deploys

Session 12 moves every AI call behind one Edge Function (`ai-proxy`) so the key
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

### B. Supabase auth URLs — ✅ DONE for staging (2026-07-29), and the
### `ANTHROPIC_API_KEY` secret is set on staging too

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

## 8. Nice to have

`gh auth login` on the dev machine. CI turned out to be readable anyway (the
repo is public), but an authenticated `gh` would let Claude open PRs and read
private repos directly instead of handing you URLs.
