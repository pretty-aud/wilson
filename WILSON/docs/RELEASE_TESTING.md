# WILSON v1.0.0 — Release Testing

Companion to `docs/SYSTEMS_HANDBOOK.md`. The handbook explains *how* things work; this
explains *what to click* and *what should happen*. Nothing is re-explained — where a check
needs background, follow the reference.

**Do Part 1 once. Then work Part 2 top to bottom.** Part 2 is ~2–3 hours if nothing is
broken. Log failures somewhere you can paste back; don't stop the pass to fix them.

**Legend**
- `[BLOCKING]` — must work to ship v1.0.0.
- `[NOTE]` — log it, move on. Not a release gate.
- `[Supabase]` / `[Local Server]` — RABBIT's **Storage Backend** must be set to that one for
  the check to be possible at all (`SYSTEM SETTINGS` → `RABBIT` → `Storage Backend`).
  Unlabelled checks work on either.

---

# PART 1 — First company setup

## Step 0. Clear the blockers first (30 min, all of it is yours)

Skipping any of these makes the app look broken rather than unconfigured. All are written up
in `docs/OWED_AUDREY.md`.

| # | Thing | Ref | What breaks without it |
|---|---|---|---|
| 0.1 | Rotate the `smoke_admin` password on **wilson-dev**, update the `DEV_PROBE_PASSWORD` GitHub secret, re-run CI | §0 | Open CRITICAL (TPN-SDLC-007). Not a test blocker, but it must close before the tag. |
| 0.2 | ✅ `ANTHROPIC_API_KEY` + `WILSON_AI_KEY_SECRET` as **Supabase Edge Function secrets** — DONE 2026-07-30 on all three, digests verified matching | §5 | Nothing. If AI ever returns 501 `ai_not_configured`, this is the first thing to re-check — and check the *Supabase Edge* store, not GitHub repository secrets or Vercel env vars, which are separate and cannot reach `ai-proxy`. |
| 0.3 | `WILSON_AI_KEY_SECRET` on each env you test | §9C | Per-company AI keys refuse to store; the console shows a clear error. Platform key still works. |

**Read before testing anything AI:** with no key, D.O.G. generation, O.T.T.E.R.
subject/quiz/validator generation, RABBIT intake and the pet companion all fail identically.
That is a missing secret, not a broken tool — set it, or skip every AI check knowingly.

TOTP enrolment (§9A) and `platform_operators` seeding (§9B) come later — Steps 5 and 6 —
because they need an account to exist first.

## Step 1. Pick the environment and the host

**Test on `wilson-dev`, via the desktop app.** `.env.local` on this machine points the
Electron build at dev, so `npm run electron:dev` and a locally built installer both land
there. Dev is disposable; break it freely. **Do not test on prod.**

⚠️ **`beta.petalstudios.co` is backed by STAGING, not dev.** A company you create in the
desktop app on dev does not exist on beta, and vice versa. Any web check (§O) is a second,
separate company on staging — accept that, or run the whole pass on staging. Do not mix.

Two consequences of choosing dev:
- Dev's Supabase auth URLs were never pointed at a web host (§6B did staging only), so
  **invite and recovery emails on dev link nowhere useful.** Use "Create with password…"
  (Step 7), or run the invite checks on staging/beta.
- Dev carries eleven sessions of leftover state. A fresh slug avoids collisions.

## Step 2. Launch and reach the login screen

```
cd C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON
npm run electron:dev        # build:dev + electron — or run the built installer
```

> ⚠️ **`npm run dev` is the browser dev server, not the app.** It is plain `vite`: no
> `window.electronAPI`, so `hasLocalServer()` is false. That silently removes the Local
> Server and Google Drive backends (Settings shows "available in the desktop app only"),
> safeStorage session persistence (§B), auto-update (§N), relink and managed files (§J), and
> it forces RABBIT onto the Supabase adapter. Use it for web-parity checks only.

You land on the terminal-style login screen. It is **two steps** (S43, finished in Track B
bundle B1): first `COMPANY` with a `Continue` button; once the company is verified,
`USERNAME`, `PASSWORD` and `Sign in`, with `Change company` · `Forgot password?` beneath and
the company you typed echoed above the fields. There is no `New company?` link any more —
companies are created from the operator console (S43; `OWED_AUDREY.md` §12 Step 1).

## Step 3. Create the company — use the wizard

Click **`New company?`** (`src/cloud/onboarding/NewCompanyWizard.jsx`). That is the
self-serve path a real customer takes, and it is what you want to exercise here. The
operator console also creates companies; it gets tested separately in §I.

**Step "company"**
- `COMPANY NAME` — 1–80 chars.
- `SLUG` — auto-derived from the name; editable, and editing stops the auto-derive. Must
  match `^[a-z0-9][a-z0-9-]{1,62}$`.
- **`CONTINUE`** (disabled until both validate). `back to sign in` aborts.

Suggested: name `Release Test Co`, slug `release-test` — add a date suffix if dev has it.

**Step "profile"** — this is the first admin.
- `USERNAME` — `^[a-z0-9][a-z0-9._-]{1,31}$`, lowercase.
- `EMAIL` — **required here** (unlike admin-created users later). Use a real inbox; password
  recovery for this account depends on it.
- `DISPLAY NAME` — optional, defaults to the username.
- `PASSWORD · MIN 10` + `CONFIRM PASSWORD` — 10–128 chars, must match.
- **`CREATE COMPANY`**.

**Step "team"** — optional initial invites. Emails parse on commas, spaces and newlines;
**cap is 19 per batch**; everything sent here is `app_role: 'user'`.
**Recommended: `skip — just me for now`** and do the invite paths deliberately in Step 7.

> ⚠️ **`provision-workspace` rate-limits to 3 provisions per hour per IP.** Step 3, §C's
> duplicate-slug re-run and §I's `New company` all count against it. A fourth attempt returns
> `TOO MANY REQUESTS. TRY AGAIN LATER.` — that is the limiter, not a failure.

Failures surface as caps-lock strings (`WORKSPACE SLUG ALREADY IN USE.` and siblings) and
drop you back on the profile step with the fields intact.

> **The wizard deliberately does not sign you in** — it returns you to the login screen with
> the username pre-filled. Every session goes through `signInWithPassword`. Not a bug.

## Step 4. Sign in as the first admin

Type the company, `Continue`; then the username and password, `Sign in`. One workspace →
straight into the app. More than one → a workspace picker (arrow keys, Enter). Usernames are
unique **within a company only** (B1): the same username can exist in two companies, and the
company you typed decides which account signs in. Next time, that browser starts with the
company already filled in.

## Step 5. Enrol TOTP — do it now

**`SYSTEM SETTINGS` → `PROFILE` tab → "Two-Factor Authentication" → `Set up`.**
(`OWED_AUDREY.md` §9A says "Settings → Security" — stale; the card is on **Profile**.)

Scan the QR, enter the 6-digit code, confirm. It should read `Enabled`, and as an admin you
get "Admins must keep MFA on." with no Disable button.

Enrolling changes two things, both intended: the operator console (Step 6) will now accept
you, and **every admin action behind `_shared/adminGuard` now needs an `aal2` session** —
which since S17 includes `invite-member`. An aal1 session gets *"This action needs a fresh
MFA sign-in. Sign out and back in with your authenticator code."*

➡️ **Sign out and sign back in with your code now,** before Step 7. Every path in Step 7 goes
through that guard, and this is the single most likely thing to look like a regression.

## Step 6. Become a platform operator

Run the INSERT **and** the verification SELECT from `docs/OWED_AUDREY.md` §9B exactly as
written, in the Supabase SQL editor, **on the environment whose console you will use**:

- Hosted console `https://admin.petalstudios.co/wilsonadmin` (or the older
  `https://beta.petalstudios.co/wilsonadmin` — same deployment, both work) → run it on
  **wilson-staging**. Both domains are staging-backed. You need an account *on staging*
  with TOTP enrolled *there*, so redo Steps 3–5 on staging if you want the hosted console.
  Full runbook: `OWED_AUDREY.md` §12.
- Local `npm run dev:admin` → `/admin.html` → run it on whatever `.env.local` points at
  (wilson-dev). See §I for what this mode cannot prove.

There is no UI for this anywhere, on purpose — the platform tier is break-glass and cannot be
granted from a web session. Handbook §5, OWED §11B.

Steps 5 and 6 are a pair: either alone gets you signed in to the console and refused
everything.

## Step 7. Add a manager and a user

**`RESOURCES` → `ADMIN TERMINAL` → `Users` → `Add people ▾`.** Two paths:

**A. `Invite by email…`** — they set their own password from a GoTrue invite link.
→ **On dev the link lands nowhere useful** (Step 1). Use it on staging/beta, or just to
confirm the dialog and the MFA guard behave.
→ **Needs the S18 templates uploaded to that project first** — see §C's banner.

**B. `Create with password…`** — you hand over the credentials. Fields: `Username`,
`Display name`, `Role`, `Email (optional)`, `Rate-card access` → `Can view rate card` /
`Can edit rate card`. A **show-once credentials popup** appears — copy the password *then*.

> ⚠️ **Leaving Email blank synthesizes a non-deliverable address**
> (`wilson.<workspace-prefix>.<username>@mail.petalstudios.co`). The account works, but
> "Forgot password?" can never work for it — resets are admin-only from then on.

Create `testmgr` (Manager, `Can view rate card` on) and `testuser` (User, no grants). Sign in
as each once so they have profiles and appear in the roster.

## Step 8. Give yourself something to test against

> **Pick your backend first.** `SYSTEM SETTINGS` → `RABBIT` → `Storage Backend`. Desktop
> default is **Local Server**. **Switching does not migrate** — everything below exists only
> in the backend you built it in. §F/§G/§L need Supabase; §J's relink and file checks and the
> milestone checks need Local Server. Either build this twice, or plan two passes.

1. `RESOURCES` → `RATE CARD` → add 3–4 roles with day rates.
2. `R.A.B.B.I.T.` → `Summary` → create a project, a couple of phases, 3–4 tasks, some
   assigned to `testuser`. Add one milestone on `Timeline` (Local Server only).
3. `O.T.T.E.R.` → one course with one subject.
4. `DASHBOARD` → `Notes` → two notes.
5. `D.O.G.` → one small deck outline.

---

# PART 2 — What to test

## §A. S17 / S18 regression pass — do these first

Newest code, so most likely to be wrong. §A0 is S17's MFA cluster; the S18
invite work is exercised in **§C0**, which needs the templates uploaded first.

### A0. The MFA cluster — found by this document's own first run

Three defects lived here, all on the first screen a new admin sees, all
invisible to CI. **Re-run these after any change to `LoginScreen.jsx`,
`MfaSection.jsx`, `OperatorLogin.jsx` or `AuthShell.jsx`** — there is still no
automated coverage of this path (§6 #68).

- Enrol TOTP from the `SECURE YOUR ADMIN ACCOUNT` overlay → on success the
  button reads **`MFA ACTIVE ✓`** and the overlay closes within ~5 s. It must
  never sit on "Activating…". `[BLOCKING]`
- After enrolling, you land in the app — **not** on a bare orange screen with
  nothing clickable. An orange screen means the gate's overlay outlived its
  contents (§6 #70). `[BLOCKING]`
- Sign out, sign back in, enter your code → you reach Home. **This is the one
  that was fully broken**: `getSession()` deadlocked against the lock
  `mfa.verify()` still held, so sign-in with MFA enabled was impossible
  (§6 #71). `[BLOCKING]`
- Same three checks on the operator console at `/wilsonadmin`. `[BLOCKING]`
- Enter a **wrong** code → `CODE REJECTED. TRY AGAIN.`, field cleared, button
  usable again. `[BLOCKING]`
- Go offline (devtools → Network → Offline), enter any code → within ~15 s you
  get **`THE SERVER DID NOT RESPOND…`**, not an endless spinner. A stalled
  network must never be reported as a rejected code. `[NOTE]`

> If sign-in ever hangs again, **check the server before theorising about the
> client** — the operation usually succeeded:
> `SELECT count(*) FILTER (WHERE verified_at IS NULL) AS unverified,
> count(*) AS total FROM auth.mfa_challenges;`
> Challenges verified but the UI stuck means the client is blocked after
> `verify()`, not that MFA is failing.

- Change `testuser`'s Role in Admin Terminal → Users → member detail → then `Logs` → expect a
  **`WIL-4105 Member privileges changed`** row naming you as actor. `[BLOCKING]`
- Toggle `Can view rate card` on `testuser` → expect **another WIL-4105 row**. `[BLOCKING]`
- Deactivate then reactivate a member → expect **a WIL-4105 row for each transition**.
  `[BLOCKING]`
- Edit only a display name / avatar → expect **no WIL-4105 row**. A stream that fires on
  profile edits is a stream nobody reads. `[BLOCKING]`
- Create a user via `Create with password…` → expect a **`WIL-4106 Membership created`** row.
  `[NOTE]`
- From an aal1 session (one created before you enrolled), send an `Invite by email…` → expect
  *"This action needs a fresh MFA sign-in…"*; sign out, back in with the code, retry → expect
  success. `[BLOCKING]` — intended new behaviour, not a bug.
- `[Local Server]` R.A.B.B.I.T. → add a milestone on `Timeline` → switch projects → switch
  back (or restart) → expect **the milestone still there**. Before S17 this was silent data
  loss. On Supabase the adapter throws by design (Known #5) — do not file that. `[BLOCKING]`
- Desktop only: switch Storage Backend to Google Drive → open `RATE CARD` → expect an **empty
  rate card, no red error banner**. `[BLOCKING]`
- On any page other than O.T.T.E.R., press **Space** in a text field or with nothing focused →
  expect **no O.T.T.E.R. shortcut to fire**. `[BLOCKING]`
- `RESOURCES` → `HELP` → the password section → expect it to describe the **current**
  workspace-account flow, with no reference to a Settings panel that no longer exists.
  `[NOTE]`

## §B. Sign-in and identity

- A company that does not exist → expect `COMPANY NOT FOUND.` and **no username field**.
  `[BLOCKING]`
- A company that exists but is **suspended** (suspend one from the operator console) →
  expect **the identical `COMPANY NOT FOUND.`** — step 1 reveals existence only, never
  status. `[BLOCKING]`
- Correct username + wrong password → expect
  `SIGN-IN FAILED. CHECK COMPANY, USERNAME AND PASSWORD.` `[BLOCKING]`
- A username that does not exist → expect **the identical error at a similar speed**.
  Different wording or a visibly faster failure is a username-enumeration leak. `[BLOCKING]`
  (pinned by `tests/e2e/auth.spec.ts` scenario 4 since B1)
- The same username in **two** companies → sign in as each by naming the company first;
  each lands in its own company. `[BLOCKING]`
- Twenty-one company checks inside one minute from one machine → expect
  `TOO MANY ATTEMPTS. WAIT A MINUTE AND TRY AGAIN.` on the 21st; a minute later it works
  again. `[NOTE]`
- Sign in as the MFA-enrolled admin → expect a **6-digit code challenge**; a wrong code →
  refusal and retry, never a half-signed-in state. `[BLOCKING]`
- Admin Terminal → Logs → **Sign-ins** → expect your own **Signed in** row (`Where` = `app`,
  with an address) and, with the two Auth hooks enabled (OWED §14), the server's
  **Sign-in failed** row for the wrong password you typed above. `[BLOCKING]` (B2; walkthrough 11)
- Leave a signed-in tab alone → **STILL THERE?** at 25 minutes, the login screen at 30 with
  `SIGNED OUT AFTER 30 MINUTES WITHOUT ACTIVITY.`; sign back in and Sign-ins shows
  **Signed out (idle)**. `[BLOCKING]`
- Drop the modem (not Wi-Fi) mid-use and open a page that reads → **Connection lost — reload to
  continue.** within about 20 s; **RELOAD** recovers. A long upload never shows it. `[NOTE]`
- Add your admin to a second workspace → expect the **workspace picker** (arrows, Enter), and
  `SYSTEM SETTINGS` → `GENERAL` → workspace switcher to change roster, projects and rate card
  together. `[BLOCKING]`
- `Forgot password?` on a real-email account **on staging/beta** → expect the email, the reset
  screen, and the new password to work. `[BLOCKING]` (on dev `[NOTE]` — auth URLs unset)
- On that reset screen → expect `YOU WILL BE SIGNED OUT ON EVERY DEVICE.` under the button
  before you submit, and after it "Password updated. You have been signed out on every
  device". Have the operator console open in another tab first: it must be signed out too
  (B1, Audrey's answer 12 — a reset revokes every session on purpose). `[BLOCKING]`
- `Forgot password?` on a synthesized-email account → expect it to go nowhere. Intended.
  `[NOTE]`
- Sign out, relaunch → expect the login screen, not a restored session. `[BLOCKING]`
- Sign in, quit, relaunch → expect the session to **persist** (safeStorage; desktop only).
  `[BLOCKING]`

## §C. Invite and onboarding

> ⚠️ **Do the template upload first, or every check here fails for the same
> reason.** S18 changed `invite.html` and `recovery.html` to carry
> `{{ .TokenHash }}` instead of `{{ .ConfirmationURL }}` (§6 #73/#74). They are
> uploaded **by hand**, in each project's dashboard → Authentication → Email
> Templates, on **all three** projects. Never `supabase config push` — it would
> push the local `[auth]` block, whose `smtp.enabled = false` kills hosted
> Resend email. Until they are uploaded, use `Create with password…`.

**C0. The invite link survives being fetched** — the whole point of S18.

> ✅ **PASSED on staging 2026-08-01.** Real invite to a Gmail address:
> unspent at +11 m 37 s, then redeemed at **+12 m 48 s by the click** —
> against 12.04 s unclicked for the same provider the day before. The
> Continue screen appeared before the password form, the password was set,
> and sign-in worked. **Staging templates are uploaded; dev and prod are
> not** (see the banner above).

- Send an invite to a **Gmail** address on staging/beta. Before clicking
  anything, run against that project:
  ```sql
  select email, invited_at, email_confirmed_at, last_sign_in_at
  from auth.users where invited_at is not null order by invited_at desc limit 5;
  ```
  Expect `email_confirmed_at` and `last_sign_in_at` **still NULL** minutes
  later. Before S18 both were set within ~12 s of sending, by something that
  was not the recipient. `[BLOCKING]`
- Now click the link → expect a **"Welcome to WILSON… Continue"** screen
  *first*, not a password form. That button is what spends the token; a page
  that goes straight to the password fields means the old template is still
  installed. `[BLOCKING]`
- Click `Continue` → the password form → set a password. `[BLOCKING]`
- Click the **same link a second time** → expect *"This link has already been
  used, or it has expired."* Single-use is still correct and intended; S18
  moved *when* it is used, not *how often*. `[NOTE]`
- `Forgot password?` on staging/beta → the same two-step shape (Continue, then
  the form). Recovery uses the identical mechanism. `[BLOCKING]`

- Email invite on staging/beta → open the link → set a password → expect the **NewUserWelcome**
  flow, then the app in the right company. `[BLOCKING]`
- Create a user with a password → expect the **show-once popup** and the roster row appearing
  without a manual refresh; reopen the member → expect **no way to see the password again**.
  `[BLOCKING]`
- Duplicate username in the workspace → expect a clean "already taken", not a raw error.
  `[NOTE]`
- Re-run the wizard with the same slug → expect `WORKSPACE SLUG ALREADY IN USE.` (watch the
  3/hour limiter — Step 3). `[BLOCKING]`
- Wizard team step, 25 addresses → expect `MAX 19 INVITES PER BATCH — TRIM THE LIST.` and
  **nothing sent**. `[NOTE]`

## §D. D.O.G.

- Build a deck outline end to end → expect it to render, and to survive a reload. `[BLOCKING]`
- Generate with AI → expect streamed output, then a **`WIL-6001` row with token counts** in
  Logs. `[BLOCKING]`
- Export → expect `DECKOUTLINE.md` (+ `VIS_DECKOUTLINE.md` / `IMG_PROMPTS.md` if enabled) with
  **unchanged format**. `[BLOCKING]`
- New project dialog on a **cloud** project → expect the file pickers to be **replaced by
  explanatory copy** ("File attachments on cloud projects arrive with the storage work…"),
  not a picker that fails. Known #1. `[NOTE]`

## §E. O.T.T.E.R.

- Create a course, add a subject, generate → expect it to save and survive a reload.
  `[BLOCKING]`
- Course row `⋯` → `Share or submit…` → "Who can edit it" → add `testmgr` → expect success and
  `testmgr` listed. Completely broken once; least-proven thing here. `[BLOCKING]`
- `Share or submit…` tier flip "Just for me" ⇄ "Share with the company" → **close and reopen** → expect
  the tier you set (the database silently reverts what it won't allow). OWED §4. `[BLOCKING]`
- `Move to trash` → `Recently deleted` → `Restore` → expect the course back with its subjects.
  OWED §4. `[BLOCKING]`
- Delete a course, make a new one with the same name, restore the old → expect *"You already
  have a course with this name"*, not a raw error. `[NOTE]`
- Mark a shared course "Company standard" as admin; as `testuser` start a course with that
  exact name → expect the inline "Your company already has a course for this" offer, and
  taking it to produce an **editable copy**. `[BLOCKING]`
- Open a course shared with you → expect **no generate/edit/delete**, "Read only", and "Make my
  own copy". `[BLOCKING]`
- As `testuser`, `⋯` → `Suggest a change…` → submit. As admin, the **`Admin`** tab → approve →
  expect the stated add/update counts, the standard course updated additively, and an archive
  copy `<name> (before change #1)` in your library. **Reference documents are not moved by an
  approval** — Known #16. OWED §8. `[BLOCKING]`
- Decline with an empty note → expect it to refuse to send. `[NOTE]`
- As `testmgr` the tab reads **`Requests`** and is **read-only** — no Approve/Decline, and the
  proposer's fork must not appear in the manager's library. `[BLOCKING]`
- Filter chips (Made for me / Shared with me / Shared by me / Company standard, plus
  **Others' personal** as admin) → expect others' personal rows visible but not openable.
  OWED §4. `[BLOCKING]`
- Sidebar collapse (chevron or `Ctrl + \`) → persists across restart, widens the study pane,
  and `Ctrl + \` does nothing on RABBIT or Settings. OWED §4. `[NOTE]`
- Quiz scores and Validator findings after a reload → gone. Known #2. `[NOTE]`

## §F. R.A.B.B.I.T.

- Create a project from `Summary` → expect it to appear and persist. `[BLOCKING]`
- `Intake` wizard on a script (needs the API key) → expect assets/scenes parsed out.
  `[BLOCKING]`
- `[Supabase]` Add phases and tasks, assign to `testuser` → expect them on that user's
  Dashboard → `My Tasks`. On Local Server the hook returns empty by design — see §G.
  `[BLOCKING]`
- `Budget` → expect Rate Card role rates to apply. `[BLOCKING]`
- Switch projects via `Switch ▾` → expect a clean swap with no bleed from the previous
  project. `[BLOCKING]`
- Server-status dot (bottom-left) → green on a working adapter, red when the backend is down.
  `[NOTE]`
- `Summary`'s Budget **tile** is structurally always zero. Known #12. `[NOTE]`
- Scenes / Levels / Experiences tabs in cloud mode → these throw; local-only. Known #5.
  `[NOTE]`

## §G. Dashboard and Notes

- `[Supabase]` `DASHBOARD` → `My Tasks` → expect only tasks assigned to you, across projects,
  and completing one from the Dashboard to reflect in RABBIT. **On Local Server `My Tasks`
  renders empty by design** — not a failure. `[BLOCKING]`
- `Notes` → create, edit, group → expect persistence across a reload. `[BLOCKING]`
- `Profile` tab → change display name and avatar → expect it in the roster and on presence
  chips. `[BLOCKING]`
- Two web tabs editing notes simultaneously → last writer wins. Known #10. `[NOTE]`

## §H. Admin Terminal (admin only)

`RESOURCES` → `ADMIN TERMINAL`. Five sections.

- As `testmgr` and as `testuser`, open `RESOURCES` → expect **no ADMIN TERMINAL entry** for
  either. `[BLOCKING]`

**Users**
- Search by username / name / email, and the status filter → expect live filtering. `[NOTE]`
- Change a role from the member detail `Role` select → expect it to stick **and** a WIL-4105
  row (§A). `[BLOCKING]`
- Open your **own** member detail → expect Role rendered as **read-only text** with "Ask
  another admin to change your role." — there is no select to try. `[BLOCKING]`
- Reset a member's password → expect a show-once value. `[BLOCKING]`
- Deactivate a member, have them try to sign in → expect refusal; reactivate → access back.
  `[BLOCKING]`

**Company**
- **Add and remove** departments → expect them offered in RABBIT and Team Members. There is no
  rename here — that lives on `SYSTEM SETTINGS` → `Teams`. Departments are stored on this
  machine, so this is desktop-only. `[NOTE]`
- `Workspace takeout` → `Download takeout (.zip)` → expect one CSV per table, a row/table count
  in the result line, and **no O.T.T.E.R. or Notes content** (excluded by design). `[BLOCKING]`

**Requests** — covered in §E.

**Logs**
- Filter by event type and severity → instant client-side filtering. `[NOTE]`
- After an AI call, look for `WIL-6001` with token counts. `[BLOCKING]`
- `WIL-1001/1002/1003` are listed but nothing emits them. Known #14. `[NOTE]`

**Diagnostics**
- `Run storage cleanup` → expect a count line ("Removed N blob(s) — X purged-file, Y orphaned,
  Z avatar") and a certificate row. On an aal1 session expect *"This action needs a fresh
  MFA-verified session."* `[BLOCKING]`
- Send a test log line → "Sent — check the Logs tab." and the row there. `[NOTE]`
- Sentry test exception → "Test exception sent." (or the not-available note in a dev build).
  `[NOTE]`

## §I. Operator console (`/wilsonadmin`)

Needs Step 5 **and** Step 6, on the same environment. The console is a separate build target
excluded from the Electron installer, so it lives in exactly two places:

- **`https://admin.petalstudios.co/wilsonadmin`** — the chosen home (§11C option 1), and
  **`https://beta.petalstudios.co/wilsonadmin`** — the same deployment on the older domain.
  Both **staging-backed**; every domain on the Vercel project serves both surfaces, because
  `vercel.json` routes on path, not host.
- **`npm run dev:admin` → `/admin.html`** locally. In this mode Vite builds *both* entries with
  `__WILSON_SURFACE__='admin'`, so `/` gets the operator session key too — **do not sign in at
  `/` under this mode**, and treat the first check below as unprovable here.

(`OWED_AUDREY.md` §9D#3 says to sign in with "company-slug + username + password" — stale.
`LoginScreen` never passes a workspace slug, and the console takes email + password + code.)

- **On deployed beta only:** signed in to `/wilson`, open `/wilsonadmin` in the same browser →
  expect **its own sign-in screen**, not an inherited session; sign in to the console, return
  to the `/wilson` tab → expect **still signed in there** as the ordinary user. `[BLOCKING]`
- Sign in with **email + password + code** — an operator has no company to resolve against.
  `[BLOCKING]`
- Sign in as an account **not** in `platform_operators` → expect the "Not a platform operator"
  screen, not a broken console. `[BLOCKING]`
- Sign in as an operator with **no verified TOTP factor** → expect refusal. `[BLOCKING]`
- `Companies` → **`New company`** with a throwaway slug → expect the show-once password dialog;
  then sign in to `/wilson` as that admin. `[BLOCKING]`
- Leave the email blank on creation → expect the "synthesised, admin-reset-only" warning.
  `[NOTE]`
- `Suspend company` → that admin locked out; `Restore company` → access back. `[BLOCKING]`
- `Set key` with a **wrong** Anthropic key → expect **refusal** (validated against Anthropic
  before storing). `[BLOCKING]`
- `Set key` with a good key → stored showing **only the last four**, no reveal; `Clear` → the
  company falls back to the platform key. `[BLOCKING]`
- `Tear down company…` → type the slug → expect a result summary with blob counts; then
  `Audit` → expect a `workspace.teardown` row that **still names the deleted company**. That
  row outliving the workspace is the point of the separate audit table. `[BLOCKING]`
- Sign in and out of the console → **no audit row anywhere**. Known #13. `[NOTE]`

## §J. Storage providers, managed files, relink

- `SYSTEM SETTINGS` → `RABBIT` → `Storage Backend` → switch **Supabase ⇄ Local Server** →
  expect `Connected`, and each backend to show its own data. **Switching does not migrate** —
  your Step 8 data does not follow you. `[BLOCKING]`
- On the **web**, that tab → expect Local Server and Google Drive shown as "available in the
  desktop app only". `[BLOCKING]`
- Google Drive: read a project → works; any write → throws. Known #8. `[NOTE]`
- `[Local Server]` Attach files to a project → expect them listed in `Summary`. `[BLOCKING]`
- `[Local Server]` Move the project folder on disk, return to `Summary` → expect the banner
  **"N files can't be found on disk — the folder may have moved."** → `Relink…` → pick the new
  folder → expect matches proposed, applied, banner gone. `[BLOCKING]`
- After a relink, `Files folder (set by relink)` shows the new path; the clear button restores
  resolution from the project folder. `[NOTE]`
- Open a file's activity → `FileAuditDrawer` → expect an event stream using exactly
  **Uploaded / Moved / Relinked / Trashed / Restored / Purged**, with actors. `[BLOCKING]`
- Managed files (the ASSETS/SCENES/SHOTS mirror) in cloud mode → local_server only. Known #6.
  `[NOTE]`
- Thumbnails: `ASSETS/` resolves; `SCENES/` and `SHOTS/` 410. Known #11. `[NOTE]`

## §K. Exports

- `RATE CARD` → `Export CSV` → a dated file with the visible columns. `[BLOCKING]`
- `TEAM MEMBERS` → `Export` → the **current view's** rows and columns. `[BLOCKING]`
- RABBIT `Tasks` → `Export` → the current filtered view only. `[BLOCKING]`
- RABBIT `Timeline` → `Export CSV`. `[BLOCKING]`
- Company takeout — §H. `[BLOCKING]`

## §L. Realtime (two windows) `[Supabase]`

Sign in as admin in one window and `testuser` in another, both on the same project. **All of
this is gated on the Supabase backend** — on Local Server realtime, presence and edit history
early-return as no-ops. That is by design, not a failure; do not run §L there.

- Edit a task in window A → expect it in window B **without a refresh**. `[BLOCKING]`
- Expect **presence chips** for both users on the project. `[BLOCKING]`
- Open the edit-history drawer in B after A's edit → expect the entry with the right actor,
  and a revert from the drawer to propagate to A. `[BLOCKING]`
- `Ctrl+Z` in A → a clean undo, not a divergence between the windows. `[BLOCKING]`
- Change a role in A's Admin Terminal → expect B's permissions to follow on B's next session
  refresh. `[NOTE]`

## §M. Soft delete → undo → restore

- Delete a RABBIT asset → expect an **undo toast** with `Undo`; click it → the asset is back.
  `[BLOCKING]`
- Delete, let the toast expire, restore from trash → expect it recoverable. `[BLOCKING]`
- O.T.T.E.R. course trash → §E. `[BLOCKING]`
- Delete a project → expect the confirm to be explicit about what goes with it. `[BLOCKING]`
- Milestones have no undo and no trash — deletion is immediate. Known #17. `[NOTE]`

## §N. Auto-update (desktop only)

- `SYSTEM SETTINGS` → `GENERAL` → `Check for updates` → expect a definite answer, never a
  silent no-op. **The button only renders where `window.electronAPI.updates` exists** — an
  installed NSIS build. Under `electron:dev` there is nothing to click, which is correct.
  `[NOTE]`
- `Download update` → percentage → `Restart & install`: needs a newer published release on the
  feed, which you cannot manufacture. Verify on a real release or waive. `[NOTE]`
- With no update feed reachable → a graceful message, not a crash. `[NOTE]`
- Two copies of the desktop app share one userData directory. Known #9. `[NOTE]`

## §O. Web build (on beta = staging)

- `https://beta.petalstudios.co/wilson` signed out → the login screen. `[BLOCKING]`
- Deep-link to `/wilson/otter` while signed out → the login screen, then land on **O.T.T.E.R.**
  after signing in. `[BLOCKING]`
- Navigate between pages → the URL tracks: `/wilson/dog`, `/wilson/otter`, `/wilson/rabbit`,
  `/wilson/dashboard`, `/wilson/project-manager`, `/wilson/rate-card`, `/wilson/team-members`,
  `/wilson/admin-terminal`, `/wilson/settings`, `/wilson/help`. `[BLOCKING]`
- Browser **Back** navigates the app, not out of it; hard-refresh on a deep link gives a real
  200 and the same page. `[BLOCKING]`
- Console clean of errors on load. `[NOTE]`
- One AI generation on the web → identical to desktop. `[BLOCKING]`
- Settings → RABBIT tab on the web → §J. `[BLOCKING]`

---

# Known not to work at v1.0.0

**Skip these.** They are recorded and dispositioned in `docs/MASTER_PLAN.md` §6; consolidated
limits in `docs/SYSTEMS_HANDBOOK.md` §17. Finding one means you found the thing we know about.

1. D.O.G. cloud projects have no attachment surface — the picker is replaced by explanatory
   copy. Local mode works. §6 #31.
2. Quiz scores and Validator findings are never persisted — React state only.
3. O.T.T.E.R. → SETTINGS → Tools → "Storage Location" — the Tools tab is padlocked by default,
   so it reads as *disabled*; unlocked, the field still has no effect.
4. R.A.B.B.I.T.'s agent integration is prompt-only and unreachable; the Agent Skills
   checkboxes gate nothing.
5. Scenes / shots / levels / experiences / milestones are local-only — the Supabase adapter
   methods throw.
6. Managed files (the ASSETS/SCENES/SHOTS mirror) are local_server only.
7. ~~A username colliding across two workspaces makes sign-in unreachable — no company field.~~
   Closed by S43 + Track B bundle B1: sign-in is company-first and usernames are unique per
   company.
8. Google Drive is read-only in v0.1; every write throws.
9. No single-instance lock — two desktop copies share one userData directory.
10. Web multi-tab is last-writer-wins on pet / otter-settings / agent-skills.
11. Managed-file thumbnails resolve only for `ASSETS/`; `SCENES/` and `SHOTS/` always 410.
12. The RABBIT Summary Budget tile is structurally always zero (rollup called with no rates).
13. Operator sign-in / sign-out and guard refusals write no audit row anywhere.
14. `WIL-1001/1002/1003` are in the Diagnostics error-code table but nothing emits them.
15. **The Attach button on the Crew and Talent tabs appears to do nothing** — the invoice-folder
    response's `res.ok` is never checked. §6 #63. The most findable item on this list.
16. Approving a change request moves subjects but **not the five reference documents**. §6 #29.
17. Milestones have no undo path — deletion is immediate, no toast, no trash. §6 #10.

---

# Before you tag

- [ ] Every `[BLOCKING]` check passes, or is knowingly waived.
- [ ] `OWED_AUDREY.md` §0 closed — `smoke_admin` rotated, `DEV_PROBE_PASSWORD` updated, CI green.
- [ ] §5 / §9C secrets set on every env you are shipping.
- [ ] §11C decided (operator console hosting — post-1.0 is an acceptable answer).
- [ ] `package.json` confirmed at `1.0.0`, CHANGELOG written, tag cut.
- [ ] **Ask before merging to `main`** — that is Vercel's production branch.
