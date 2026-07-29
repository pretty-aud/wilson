# Owed by Audrey — setup tasks the agent cannot do

These need logins the agent doesn't have. Tick them off here as they're done.

**Never paste any of these keys into a Claude conversation.** They go straight
from the source site into GitHub's secrets box.

---

## 1. B2 backup secrets — **do this first**

**Status: NOT DONE. There are currently no database backups at all.**

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
   - Files in Bucket: **Private**.
   - Leave encryption / object-lock at defaults.

   → that name is **`B2_BACKUP_BUCKET`**

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

5. Project → Settings → **Database** → connection string section.
6. Choose **Session pooler** (not Direct connection, not Transaction pooler),
   port **5432**. The workflow specifically wants the session pooler.
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

9. https://github.com/pretty-aud/wilson/actions → **db-backups** in the left
   sidebar → **Run workflow**. Don't wait for tonight.

   **Success looks like:** each job ends with
   `uploaded db/prod/wilson-prod-20260729-143000.dump.gz (2.1M)`
   and the bucket shows `db/prod/` and `db/staging/` folders with a
   `.dump.gz` in each. Prod and staging run independently, so one can pass
   while the other fails.

   **If it's red,** paste the failing step's log to Claude. The two usual
   causes are the master key (step 4) and a leftover `[YOUR-PASSWORD]`
   placeholder (step 7).

### Part E — Retention (don't skip)

10. B2 → bucket → **Lifecycle Settings** → custom rule:
    - File path prefix: `db/`
    - Keep only the last version, delete after **30** days

    The workflow deliberately doesn't delete old files itself: if the CI key
    were ever stolen, a key with delete rights could wipe the whole backup
    history. Lifecycle rules run on Backblaze's side, out of reach of that key.

### Afterwards — prove a restore works

A backup you've never restored isn't a backup. Once it's running, download one
dump and restore it somewhere scratch:

```bash
gunzip -c wilson-prod-20260729-143000.dump.gz | pg_restore -d "postgres://...scratch..." --no-owner
```

They're `pg_dump -Fc` custom format, so `pg_restore` can also extract a single
table if you ever need just one thing back. RLS policies, functions and cron
metadata all ride along.

---

## 2. CI check for commit `31586d5`

**Status: NOT CHECKED.** The `gh` CLI isn't authenticated on the dev machine,
so the Session 10 agent could not read the run.

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

## 4. Heads-up, not a task

Until the S11 trash UI ships, **deleting an O.T.T.E.R. course in-app hides it
with no way back**, and the 30-day purge then removes it permanently. The
restore function exists and is tested — there's just no button yet
(MASTER_PLAN §6 #20).
