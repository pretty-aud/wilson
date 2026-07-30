# SESSION 3 → 4 handoff checklist

Everything the human needs to do before Session 4 can verify end-to-end. Work top-down; later items depend on earlier ones.

Environment: Windows + Git Bash. All shell commands assume PATH includes node + supabase-cli. If `supabase` isn't on PATH, use the full shim path: `/c/Users/Audrey/scoop/shims/supabase.exe`.

Repo root for git: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson`
App root: `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON`

Status legend: `⏳` to do · `✅` done · `⚠️` blocking · `💡` nice-to-have

---

## 0. Push the Session 3 commits ⏳ — 2 min

Prerequisite for everything else (the CI guard + branch backup).

```bash
cd "/c/Users/Audrey/Documents/My_Work/Dev_Work/wilson"
git log --oneline -4
# Expect to see:
#   3344889 feat(auth): Session 3b — Resend SMTP + invite flow + forgot/reset wizards + Playwright
#   4ed1d9c feat(auth): Session 3a — fix issue-session ES256 401, permissions framework, atomic provisioning RPC
#   62f12d7 docs(sessions): update Session 3 prompt with smoke-test learnings
#   ce4487e fix(auth): UI polish + wire auth flow end-to-end for smoke test

git push origin feat/multi-user-v1
```

Verify: `git status` shows "Your branch is up to date with 'origin/feat/multi-user-v1'".

---

## 1. Add GitHub repo secrets for the issue-session CI job ⚠️ — 5 min

Without these, the `issue-session-smoke` CI job skips silently. The `rls.yml` pgTAP job runs regardless.

1. Open <https://github.com/> → your `wilson` repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Add exactly these four secrets (case-sensitive names):

| Name | Value |
|---|---|
| `DEV_SUPABASE_URL` | `https://eqjzmnvkrakroyqxfsvw.supabase.co` |
| `DEV_SUPABASE_ANON_KEY` | (paste from `WILSON/.env.development` — the `VITE_SUPABASE_ANON_KEY` line) |
| `DEV_PROBE_USERNAME` | `smoke_admin` |
| `DEV_PROBE_PASSWORD` | `<DEV_PROBE_PASSWORD>` |

**Verify:** after the push from §0, open the Actions tab. The `RLS tests` workflow should run; click into `issue-session smoke (wilson-dev)` — expect ✅ **"Probe issue-session"** step green with the final line `PASS issue-session smoke probe`.

If it reports `has_secrets=false`, one of the four names is wrong.

---

## 2. Apply Session 3 deploys to wilson-staging + wilson-prod ⚠️ — 15 min

Only wilson-dev has migration 0009 + the three Edge Function updates. wilson-staging and wilson-prod are behind by one session. Do them both now so Session 4 doesn't trip the same ES256 issue twice.

### 2a. Link + apply to wilson-staging

```bash
cd "/c/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON"
export PATH="/c/Users/Audrey/scoop/shims:/c/Program Files/nodejs:$PATH"

# Link to staging.
supabase link --project-ref rzkirvkotslbovzbsdfh
# Password prompt: paste the wilson-staging DB password from your password manager.

# Apply every migration not yet on staging (0000 through 0009).
supabase db push --linked --include-all
# Expect: "Applying migration 0000_rabbit_base_schema.sql ... 0009_perms_and_provisioning.sql"

# Deploy all four Edge Functions. --no-verify-jwt is load-bearing (see §7 in
# docs/sessions/SESSION_03_prompt.md and config.toml comments).
supabase functions deploy resolve-login       --no-verify-jwt
supabase functions deploy issue-session       --no-verify-jwt
supabase functions deploy provision-workspace --no-verify-jwt
supabase functions deploy invite-member       --no-verify-jwt
```

### 2b. Link + apply to wilson-prod

Same commands, different ref. Do NOT run `db push` on prod until you've verified staging is healthy in §6 below.

```bash
cd "/c/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON"
supabase link --project-ref rqyriuyldhovirbuievt
supabase db push --linked --include-all
supabase functions deploy resolve-login       --no-verify-jwt
supabase functions deploy issue-session       --no-verify-jwt
supabase functions deploy provision-workspace --no-verify-jwt
supabase functions deploy invite-member       --no-verify-jwt

# Re-link back to wilson-dev as the default so Session 4 work lands there.
supabase link --project-ref eqjzmnvkrakroyqxfsvw
```

**Verify linked project:** `supabase projects list` shows `●` next to `wilson-dev`.

---

## 3. Toggle custom_access_token_hook on wilson-staging + wilson-prod ⚠️ — 5 min

The hook function was CREATEd in migration 0001/0003 but Supabase Auth needs a Dashboard toggle to actually call it. Session 1's checklist did this for wilson-dev only.

For **each of wilson-staging and wilson-prod**:

1. Open the Supabase Dashboard → pick the project.
2. **Authentication** → **Hooks** (in the left rail; may be under "More").
3. Find **Custom Access Token Hook** → **Enable hook**.
4. Select the PostgreSQL function: schema `public`, function `custom_access_token_hook`.
5. Save.

**Verify:** sign into the project's Dashboard → **Authentication** → **Users** → create a temp user → run `supabase auth decode <access_token>` in the CLI or paste the token into <https://jwt.io>. The decoded payload should contain `app_metadata.workspace_id` and `app_metadata.app_role`. If those are missing, the hook isn't wired.

---

## 4. Resend account + per-env SMTP setup ⚠️ — 30 min first time, 10 min per env thereafter

Without this, invites and password resets never deliver. Covered in depth in `WILSON/src/tools/rabbit_v0.1.0/db/README.md §6`; summarized here.

### 4a. One-time: create the Resend account + verify the domain

1. Sign up at <https://resend.com>. Free tier (3k/month) is plenty for now.
2. **Domains** → **Add Domain**. Use `mail.wilsonapp.com` (or whatever sub-domain you own). Resend gives you three DNS records to add at your registrar (Namecheap, Cloudflare, Route 53, etc.):

   | Type | Host | Value (Resend will show yours exactly; shape only) |
   |---|---|---|
   | `TXT` | `mail` | `v=spf1 include:amazonses.com ~all` |
   | `TXT` | `resend._domainkey.mail` | `p=MIGfMA0GCSqGSIb3DQE...` (long DKIM key) |
   | `TXT` | `_dmarc.mail` | `v=DMARC1; p=none; rua=mailto:postmaster@wilsonapp.com` |

3. Wait 5–15 minutes for propagation. Resend's domain page turns green when it verifies.
4. **API Keys** → **Create SMTP credential** (not "API key" — you want the SMTP-specific one). Copy the password *immediately* — Resend shows it once.

### 4b. Per-env: paste into Supabase Dashboard

For **each of wilson-dev, wilson-staging, wilson-prod**:

1. Supabase Dashboard → **Auth** → **Email Settings** (or "SMTP Settings" on newer UIs).
2. Toggle **Enable custom SMTP**.
3. Fill in:
   - **Host:** `smtp.resend.com`
   - **Port:** `465`
   - **Username:** `resend`
   - **Password:** (the SMTP credential from §4a step 4)
   - **Sender email:** `wilson@mail.wilsonapp.com`
   - **Sender name:** `WILSON`
4. Save.

### 4c. Per-env: upload the three email templates

For **each env**:

1. Dashboard → **Auth** → **Email Templates**.
2. For each of **Invite user**, **Reset password**, **Change email address**:
   - Set the **Subject** to match `supabase/config.toml` (`You're invited to {{ .Data.company_name }} on WILSON` / `Reset your WILSON password` / `Confirm your new email for WILSON`).
   - **Message body:** paste the full HTML from the matching file under `WILSON/supabase/templates/` (`invite.html`, `recovery.html`, `email_change.html`).
   - Save.

### 4d. Verify delivery

Quick end-to-end smoke against **wilson-dev** — do this once the smoke_admin user's email is set to an inbox you control (or swap in a Gmail address temporarily via the Dashboard → Auth → Users panel).

```bash
cd "/c/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON"
export PATH="/c/Users/Audrey/scoop/shims:/c/Program Files/nodejs:$PATH"

# Launch the renderer so the wizard can open.
npm run dev
# In another terminal: open http://localhost:5203 in the browser,
# click "forgot password?", enter smoke_admin, submit.
```

Expect: a WILSON-branded reset email in the inbox within 30 seconds. Click through; the ResetPasswordWizard should load at `/#/recovery` and let you set a new password. Set a new password, then **update the `DEV_PROBE_PASSWORD` GitHub secret to match it** so the CI probe keeps working. (Session 15 correction: this step used to say "rotate it back" to a fixed literal. That pinned the probe account's password to a value published in this public repo — see TPN-SDLC-007. The secret follows the password now, not the other way round.)

If the email never arrives:
- Resend Dashboard → **Logs** shows every send. A failed send lists the SMTP error.
- Supabase Dashboard → **Logs** → **Auth** shows template render errors.

---

## 5. Install Playwright locally 💡 — 5 min

Session 3 wrote the spec at `tests/e2e/auth.spec.ts` but didn't install. Session 4 needs this.

```bash
cd "/c/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON"
export PATH="/c/Users/Audrey/scoop/shims:/c/Program Files/nodejs:$PATH"

# Installs the test runner + types.
npm install -D @playwright/test

# Downloads the Chromium binary (~200 MB). We only run Chromium in CI for
# now; Session 10 adds WebKit for the web build.
npx playwright install chromium
```

**Verify:**

```bash
npx playwright --version
# Expect: "Version 1.XX.X"

# Run the spec against the local dev server. Start the dev server in a
# separate terminal first:
npm run dev

# Then, in a fresh terminal from the same dir:
npx playwright test
# The forgot-password + invite scenarios will SKIP unless mailpit is
# reachable at localhost:54324 — they're opt-in via PLAYWRIGHT_SKIP_EMAIL.
# Expect the "valid sign-in" scenario to pass against a seeded smoke_admin.
```

If you see the tests starting but failing to find elements, the AuthShell intro animation may still be in flight — bump the timeout in the failing test's `toBeVisible({ timeout: … })` or add a pre-test `waitForLoadState('networkidle')`.

---

## 6. Local verification of migration 0009 💡 — 10 min

Proves the new pgTAP tests (14_ws_members_self, 15_provision_rpc) are actually green before Session 4 builds on them.

**Requires Docker Desktop running** because `supabase start` boots a local Postgres stack in containers. On Windows: open Docker Desktop from the Start menu and wait for the whale icon to stop animating.

```bash
cd "/c/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON"
export PATH="/c/Users/Audrey/scoop/shims:/c/Program Files/nodejs:$PATH"

# Boot local Supabase with mailpit (for Playwright email tests) but skip
# edge-runtime/studio to keep it snappy.
supabase start --exclude edge-runtime,studio,imgproxy

# Runs every *.sql file in supabase/tests/rls/ against the local DB.
supabase test db
# Expect 15/15 files all PASS. The new ones are:
#   14_ws_members_self.sql  (7 assertions)
#   15_provision_rpc.sql    (5 assertions)

# When done:
supabase stop --no-backup
```

If 14 or 15 fails, the output tells you which assertion # — cross-reference the test file line numbers.

---

## 7. Manual smoke tests of the new flows 💡 — 15 min

Once §4d passes, run these end-to-end against wilson-dev to catch anything the automated tests miss (especially the Electron-specific paths).

### 7a. Admin invite → first-login welcome

1. Start the app: `npm run electron:dev` (or `npm run dev` for the browser path).
2. Sign in as `smoke_admin` / `<DEV_PROBE_PASSWORD>`.
3. Go to **Team Members** (nav strip → Resources → Team Members).
4. Click **Invite User** (orange button, only shows because you're admin).
5. Fill: email = a throwaway you control, username = `playtest_01`, role = `User`. Send.
6. Check the invitee inbox → click the "Set my password" link.
7. Browser should land at `http://localhost:5203/#/recovery#access_token=...`. ResetPasswordWizard loads, you set a password (min 10 chars), click **Set password**.
8. After "Password updated" → click Continue → LoginScreen reappears.
9. Sign in as `playtest_01` with the new password. NewUserWelcome should fire (display name / pronouns / title / avatar).
10. Fill it in, submit. App reveals to Home.
11. Cleanup: Dashboard → Auth → Users → delete the `playtest_01` user (cascade deletes the workspace_member row).

### 7b. Forgot password round-trip

1. From LoginScreen (logged out), click **Forgot password?**.
2. Enter `smoke_admin`. Submit. Expect the generic "if an account matches, a reset link is on its way" message.
3. Inbox → click the reset link.
4. Set a temp password → Continue.
5. Sign in with the temp password → lands on Home.
6. Repeat the forgot-password flow, then update the `DEV_PROBE_PASSWORD` GitHub secret to the new value so the CI probe keeps working. Never rotate the account back to a previously published value.

### 7c. issue-session probe against wilson-dev (sanity)

```bash
cd "/c/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON"

# One-time: install jq if you haven't already. CI has it; local Git Bash doesn't.
#   scoop install jq
# (or skip jq and use the inline Python version at the top of this file's §0 history)

SUPABASE_URL="https://eqjzmnvkrakroyqxfsvw.supabase.co" \
SUPABASE_ANON_KEY="$(grep VITE_SUPABASE_ANON_KEY .env.development | cut -d= -f2)" \
PROBE_USERNAME="smoke_admin" \
PROBE_PASSWORD="$DEV_PROBE_PASSWORD" \
./scripts/probes/issue-session.sh
```

Expect three green `OK` lines ending with `PASS issue-session smoke probe`.

### 7d. Storage upload via NewUserWelcome avatar

Part of §7a step 9 above — upload any PNG < 2 MB as the avatar and confirm it renders in the circle preview. The file lands at `user-avatars/{workspace_id}/{user_id}/{timestamp}-{filename}` in the Storage bucket (Dashboard → Storage → user-avatars to verify).

If upload fails with `row-level security`, the storage policies in migration 0009 didn't apply cleanly — re-run `supabase db push --linked --include-all` with wilson-dev linked.

---

## 8. Clean up Session 3 breadcrumbs 💡 — 5 min

Optional but makes the Session 4 start cleaner.

### 8a. Re-run the smoke fixture if the smoke_admin password drifted

If §4d or §7b changed the probe password, update the `DEV_PROBE_PASSWORD` GitHub secret to match. Do not re-seed the account back to an older password.

### 8b. Spot-check that no .env* leaked into commits

```bash
cd "/c/Users/Audrey/Documents/My_Work/Dev_Work/wilson"
git log --all --full-history -- '*.env*'
# Expect: no results except .env.example (which is safe).
```

### 8c. Confirm wilson-staging + wilson-prod Auth → SMTP is enabled

Dashboard visual check for each env. Session 4 shouldn't have to think about email plumbing.

---

## 9. What you can skip

- **Vitest install.** Session 3 noted a placeholder comment in `roleMatrix.js`; Session 4 will install + write the first unit suite. No action needed now.
- **Merging to main.** The plan merges at the end of Session 10. Keep pushing to `feat/multi-user-v1`.
- **Playwright CI job.** Session 4 adds this (needs the `@playwright/test` install to be in `package.json` first).

---

## Summary of blocking items

Before Session 4 can claim the Session 3 exit criteria are fully met, you must complete **§1, §2, §3, §4**. Everything else is strongly recommended but won't block the next round of code.

| Block | Time | Dependency |
|---|---|---|
| §0 push commits | 2 min | — |
| §1 GitHub secrets | 5 min | §0 |
| §2 staging + prod deploy | 15 min | — |
| §3 hook toggle on staging + prod | 5 min | §2 |
| §4 Resend setup (all three envs) | 30 min + 10×2 | — (can run in parallel with §1–3) |
| §5 Playwright install | 5 min | — |
| §6 local pgTAP run | 10 min | Docker Desktop |
| §7 manual smokes | 15 min | §4 |
| §8 cleanup | 5 min | §7 |

Roughly **45 min of critical-path work** plus optional verification.
