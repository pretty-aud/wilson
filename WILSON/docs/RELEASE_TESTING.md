# WILSON 1.0.0 — Release testing

The one pass Audrey makes before the tag (`docs/sessions/PLAN_TO_1_0.md` §0, condition 3): what to click and what must happen. How
each part works is in `docs/SYSTEMS_HANDBOOK.md`; each section names the walkthrough that covers its feature step by step.
**Rewritten 2026-10-28 (R2, night 4) against the code at `51e5a0d7`**: every label and message below was found by its identifier in
the source, not copied from a walkthrough, so where a walkthrough's words differ, this file's are the app's.

**Length and time.** About 590 lines; about **8 hours**, a full day or two halves: an hour and a half of setup (Part 1, done once on
each database) and about six and a half hours of checks (Part 2), plus about 30 minutes for §S once night 4's sessions are written
in. The `[NOTE]` checks are about an hour of that. **Start the two slow clocks first.** §A's 4-hour cap: a browser profile of its
own on the beta, signed in as `testmgr` (no check signs it out or resets it), touched at least every 20 minutes or answered **Stay
signed in**, because 30 idle minutes sign it out; §A's idle check runs in a profile of its own. §O's offline launch: on the desktop,
sign in and quit at once; relaunch offline before the 4 hours are up, quit again, and relaunch offline after them. Then Part 2 in
order; note a failure by its section and bullet and carry on, never stop to fix.

**Legend**
- `[BLOCKING]` must work to ship 1.0.0, or be waived knowingly. `[NOTE]` note it and move on.
- `[Cloud]` signed in on the Supabase backend (the web, or the desktop on **Supabase**). `[Local]` the desktop on **Local Server**.
  Unmarked: either.
- `[Desktop]`, `[Web]`: that build only. `[Pair]`: the desktop app and a browser on one database (Step 1). `[Gateway]`: needs the
  file gateway's Windows service installed (walkthroughs 61, 63).
- Strings are quoted as the code writes them. The CSS shows some in capitals (sign-in fields, card titles); they are quoted as
  written.

---

# PART 1 — Setup (about an hour and a half)

## Step 0. In place first (hers; `docs/OWED_AUDREY.md`)

| # | What | Where it stands | Without it |
|---|---|---|---|
| 0.1 | `smoke_admin` rotated on wilson-dev, `DEV_PROBE_PASSWORD` updated, CI re-run | §0, open (TPN-SDLC-007) | nothing in this pass; it blocks the tag |
| 0.2 | `ANTHROPIC_API_KEY` as an **Edge Function** secret | §5: all three, 2026-07-30 | every AI feature fails alike (`ai-proxy` 501 `ai_not_configured`): a missing secret, not a broken tool |
| 0.3 | `WILSON_AI_KEY_SECRET` | §5, §9C: all three, 2026-07-30 | §D's **Set key** refuses: *Key storage is not configured for this environment (WILSON_AI_KEY_SECRET is unset).* AI itself still works, on the platform key |
| 0.4 | `WILSON_STORAGE_KEY_SECRET` | §9 C2: all three, 2026-08-08 | §L's bucket secret refuses to save, by name |
| 0.5 | `WILSON_GATEWAY_KEY_SECRET` | dev 2026-10-10, staging 2026-10-12 (`po-gw1` §2; the controller's kit) | §K's playback: every ticket refused (`crypto_unavailable`) |
| 0.6 | The two sign-in logging hooks on dev and staging | §14, open | §A's server rows (*Sign-in failed*) never appear |
| 0.7 | The invite and recovery templates carrying `{{ .TokenHash }}`, uploaded by hand per project | uploaded on staging (2026-08-01) | §B's links fail; use **Create with password…** |

## Step 1. Where to test, and why Part 1 runs twice

- **The desktop app talks to wilson-dev**: `.env.local` on this machine points every desktop build there. Dev is disposable.
- **The web is the beta, `https://beta.petalstudios.co/wilson`, on wilson-staging**, and so is the hosted operator console, at
  `/wilsonadmin` on `beta.` and on `https://admin.petalstudios.co`.
- **A company made on one database does not exist on the other**, so Steps 3–7 run on staging (the hosted console) and again on dev
  (`npm run dev:admin`), about 45 minutes each. `[Web]` checks use staging's; `[Desktop]`, `[Local]` and `[Pair]` checks use dev's.
- **`[Pair]` checks run on dev**: the desktop app plus the browser build against dev (`npm run dev`: plain Vite, no desktop server),
  with `VITE_DEV_AUTOLOGIN` and `VITE_DEV_FIXTURES` unset in `.env.local` (no **DEV · FIXTURES** pill), or it signs in for you and
  serves pretend data.
- **Never production.** At `51e5a0d7` dev and staging carry every migration through 0101 and the same 22 functions (plan §1,
  night 3); production is at 0063.
- Dev's Auth URLs were never pointed at a web host (`OWED_AUDREY.md` §6B did staging only), so invite and recovery emails from dev
  lead nowhere useful: run those checks on the beta.

## Step 2. Launch

```
cd C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON
npm run electron:dev
```

(or a built installer). `npm run dev` is the browser dev server: no `window.electronAPI`, so no Local Server or Google Drive backend
(Settings says *Desktop app only — needs the local server or Drive bridge*), no saved desktop sign-in, no updates, no relink. Use it
for `[Pair]` checks only.

The sign-in has two steps: `COMPANY` and **Continue** (*Checking…* while it looks), then `USERNAME`, `PASSWORD` and **Sign in**,
with the company echoed above and **Change company** · **Forgot password?** below. There is no *New company?*: S43 removed
self-serve company creation, and companies are made in the operator console.

## Step 3. Two-factor and the operator tier, on the database whose console you use

1. Sign in to the app with your admin account on that database (on dev, never `smoke_admin`: CI's Playwright signs in as it and
   clicks **Set up later**, `tests/e2e/authFlow.ts`, so enrolling it turns CI red). An admin with no factor meets **Secure your
   admin account** first; otherwise `App settings` → `Profile` → **Two-factor authentication** → **Set up** → **Activate MFA**. It
   ends on **Enabled** and *Admins must keep MFA on.*, with no Disable.
2. Sign out and back in with the code: every admin action now needs a two-factor session.
3. Run the `INSERT` and the check `SELECT` of `OWED_AUDREY.md` §9B in that project's SQL editor. There is no screen for this
   anywhere, by design.

(`OWED_AUDREY.md` §12 still starts from the removed wizard and names `SYSTEM SETTINGS`; its order holds.)

## Step 4. Create the test companies in the operator console

The hosted console for staging; for dev, `npm run dev:admin` → `/admin.html` (do not sign in at `/` in that mode). **Email**,
**Password**, then **Authenticator code** → **Verify**.

`Companies` → **New company**: **Company name**, **Slug (part of sign-in, permanent)** (`^[a-z0-9][a-z0-9-]{1,62}$`), **Admin
username**, **Admin display name (optional)**, **Admin email (optional)** → **Create company** → *Company created*, a password shown
once (*This password is shown once and is not stored anywhere…*), **Copy all**, **Done**. Make two:

- `Release Test Co` / `release-test` (a date after it if taken), with a real inbox for its admin, or that account's **Forgot
  password?** can never work;
- `Throwaway Co` / `throwaway`, for §D's suspend and tear-down. Never tear down the test company.

## Step 5. The new company's admin

Sign in as Release Test Co's admin (the company, the username, the password shown once) in a **second browser profile first**, and
choose **Set up later**: keep that profile signed in for §A's second-device check, answering **Still there?** with **Stay signed
in**. Then sign in as the same admin in your main profile and enrol two-factor as in Step 3.1, then sign out and back in with the
code. That browser remembers the company; `/wilson?company=<slug>` pre-fills it anywhere.

## Step 6. A manager and a user

`Resources` → `Admin terminal` → `Users` → **Add people** ▾:
- **Invite by email…**: they set their own password from the link (staging only, Step 1).
- **Create with password…**: **Username**, **Display name**, **Role**, **Email (optional)**, **Rate-card access** (**Can view rate
  card** / **Can edit rate card**) → **Create user** → the password shown once. A blank email makes a synthesised address nobody
  receives: that account's password is reset only by an admin.

Make `testmgr` (Manager, **Can view rate card**, and an **Email** of yours, a `+testmgr` alias of your inbox for instance: §D signs
in to the console by email, and a blank one is synthesised), `testmgr2` (Manager, no rate-card grant, never seated on a project:
§J's manager with no seat) and `testuser` (User), and sign in as each once. In Throwaway Co, also make a `testuser` (blank email):
§A's "one username in two companies".

## Step 7. Something to test against

1. `Resources` → `Rate card`: three or four roles with day rates.
2. R.A.B.B.I.T. → `Summary` → **New project**. In its **Control panel** turn on **Scenes and shots**, **Levels** and
   **Experiences** (their tabs show only then). Two phases and four tasks, some for `testuser`; a **Key date** on `Timeline`; a
   `Crew/team` and a `Talent` row in `Budget`.
3. R.A.B.B.I.T. → `Team`: seat `testmgr` as **Manager** and `testuser` as **Reviewer**, and leave `testmgr2` off (the gates in
   §G to §J read the seats).
4. One file with **Core project file** ticked (`Files`, its window).
5. O.T.T.E.R.: a course with two subjects; as the admin, **Share or submit…** → make it the company standard.
6. `Dashboard` → `Notes`: two notes (cloud only).
7. D.O.G.: a small deck outline.
8. `[Local]` A desktop project on **Local Server** holding a phase, an asset, a task, a scene with a shot, a key date, a comment, a
   shot list with an edit, a file in a folder, and a bin with a clip: §R carries it.

The backend decides what you see: `App settings` → `Storage` → **Storage backend** (**Supabase** / **Local Server** / **Google
Drive**). The desktop starts on Local Server. Switching moves no data: build it where you test it.

---

# PART 2 — What to test

## §A. Sign-in and sessions (30 min · walkthroughs 10, 11, 59, 83)

No automated test covers the two-factor path end to end: re-run the first three after any change to `LoginScreen.jsx`,
`MfaSection.jsx`, `OperatorLogin.jsx` or `AuthShell.jsx`.

- From **Secure your admin account**: **Activate MFA** → *Activating…* → **MFA active ✓**, closing within about 4 s; never stuck on
  *Activating…*, never an orange screen with nothing to click; at 1280 × 824 the screen sits clear of both bars. `[BLOCKING]`
- Sign out, sign in with the code → Home. `[BLOCKING]`
- From Step 5's second profile, signed in before you enrolled: invite from it (**Add people** → **Invite by email…**) → *This
  action needs a fresh MFA sign-in. Sign out and back in with your authenticator code.*; after signing in there with the code it
  sends. Enrolling upgrades the enrolling session itself, so it must be another device; run it before **Forgot password?** below,
  which signs out every device. `[BLOCKING]`
- A wrong code → *Code rejected. Try again.*, the field cleared, the button usable. `[BLOCKING]`
- A stalled network (not the browser's Offline switch, which fails at once and reads as a rejected code) → *The server did not
  respond. Check your connection and try again.* within 15 s. `[NOTE]`
- A company that does not exist → *Company not found.* and no username field; a suspended one (§D) → the same words. `[BLOCKING]`
- A wrong password → *Sign-in failed. Check company, username and password.*; an unknown username → the same words, as fast.
  `[BLOCKING]`
- `testuser` in Release Test Co and in Throwaway Co → each signs in to its own. `[BLOCKING]`
- 21 company checks inside one minute window (the window is fixed) → *Too many attempts. Wait a minute and try again.* `[NOTE]`
- `Admin terminal` → `Logs` → **Sign-ins**: your **Signed in** row (Where *app*), and with Step 0.6 done the server's **Sign-in
  failed** row for the wrong password. `[BLOCKING]`
- Idle, in its own profile: **Still there?** (**Stay signed in**) at 25 minutes, then *Signed out after 30 minutes without
  activity.*; Sign-ins shows **Signed out (idle)**. `[BLOCKING]`
- The 4-hour clock: a toast with only **OK** five minutes before, then *Signed out: sessions end after 4 hours. Sign in again to
  continue.* `[NOTE]`
- One person in two companies: the picker (arrows, Enter), and `App settings` → `General` → **Active workspace** switching roster,
  projects and rate card together. No screen puts one account in two companies (an invite of an existing email answers *That email
  is already associated with a WILSON account.*), so it needs a `workspace_members` row added in the SQL editor; the controller
  writes it if she wants this check. `[NOTE]`
- `[Desktop]` Signed in, quit, relaunch → still signed in; signed out, relaunch → the sign-in. `[BLOCKING]`
- `App settings` → `General`, the **Change password** card: change your own password → *Password changed.*; sign out, sign in with
  the new one. `[BLOCKING]`
- `[Web]` **Forgot password?** on a real inbox → the email → *Confirm below to continue resetting your password.* and **Continue**
  first, then **NEW PASSWORD**, **CONFIRM**, **Set password**, with *You will be signed out on every device.* beforehand and
  *Password updated. You have been signed out on every device — sign in again with your new password.* after; a console tab open
  meanwhile is signed out too. `[BLOCKING]`

## §B. People and invites (20 min · walkthroughs 02, 10)

- `[Web]` Invite a Gmail address. Before clicking, on staging:
  `select email, invited_at, email_confirmed_at, last_sign_in_at from auth.users where invited_at is not null order by invited_at desc limit 5;`
  → `email_confirmed_at` and `last_sign_in_at` still empty minutes later. `[BLOCKING]`
- The link → *Welcome to WILSON. Confirm below to activate your account and choose a password.* and **Continue** first, then the
  password form, the welcome, the app in the right company; the same link again → *This link has already been used, or it has
  expired.* `[BLOCKING]`
- **Create with password…** → the password once, the roster row with no refresh, and no way to see the password again; a taken
  username → *That username is already taken in this workspace.* `[BLOCKING]`
- `testuser`'s **Role**, then **Can view rate card**, then both back → `Logs` shows a **WIL-4105** *Member privileges changed* row
  for each of the four, naming you. **Deactivate**, then **Reactivate** → **WIL-4103** *Deactivated "testuser"* and **WIL-4104**
  *Reactivated "testuser"*, naming you, each beside a WIL-4105 row whose actor is *system* (the function writes as the service role).
  A display-name or avatar edit writes none. `[BLOCKING]` A created user writes **WIL-4106** *Membership created*. `[NOTE]`
- The rate card follows the grants: `testmgr` (view) sees `Rate card` and cannot change it; `testuser` (no grant) does not see the
  rates. `[BLOCKING]`

## §C. Admin terminal (20 min · walkthrough 27)

`Resources` → `Admin terminal`: **Users**, **Company**, **Models**, **Storage**, **Requests**, **Logs**, **Diagnostics**.

- As `testmgr` or `testuser`: no `Admin terminal` in Resources (its page says *Admins only*). `[BLOCKING]`
- **Users**: *Search username, name, email…* and **All** / **Active** / **Deactivated** filter as you type `[NOTE]`; your own
  detail shows your role as text, *Ask another admin to change your role.* `[BLOCKING]`; **Reset password** on `testuser` shows a
  new one once `[BLOCKING]`; **Deactivate** stops `testuser`'s sign-in and **Reactivate** restores it `[BLOCKING]`. Never
  `testmgr`, whose profile holds the 4-hour clock.
- **Company**: **Download takeout (.zip)** → a CSV per table and *Exported N rows across M tables.*, with no O.T.T.E.R. or Notes
  content (excluded by design) `[BLOCKING]`; the **Teams** card adds and removes departments, kept on this computer only `[NOTE]`.
- **Models**: *Which model each function uses for everyone in this company. …*; with nothing set, *Nothing overridden — every
  function follows the platform default.* `[NOTE]`
- **Logs**: **All types** / **All severities** filter at once `[NOTE]`; after an AI call, a **WIL-6001** row with its token counts
  `[BLOCKING]`.
- **Diagnostics**: **Run storage cleanup** → *Permanently delete unreferenced blobs?* → **Yes, clean up** → a count line; without a
  fresh two-factor session, *This action needs a fresh MFA-verified session.* `[BLOCKING]` **Send test event** → *Sent — check the
  Logs tab.* `[NOTE]` The card **The AI’s file store** is §E's last check.
- **Storage** is §L; **Requests** is §F.

## §D. Operator console (25 min · walkthroughs 02, 05, 76)

- `[Web]` Signed in at `https://beta.petalstudios.co/wilson`, open `https://beta.petalstudios.co/wilsonadmin` in the same browser
  (the same origin) → its own sign-in; signing in there leaves `/wilson` as it was. `[BLOCKING]` (`admin.petalstudios.co` is
  another origin and proves nothing here; `npm run dev:admin` cannot show it)
- `testmgr` (no factor; the email Step 6 gave it) → *The operator console requires two-factor authentication. Enrol an
  authenticator in WILSON → Settings → Profile, then sign in here again.*; Release Test Co's admin (a factor, not an operator) →
  *Not a platform operator*. `[BLOCKING]`
- **New company** with a slug in use → *That slug is already in use by another company.* `[BLOCKING]` No admin email → the warning
  that it is synthesised and reset by an admin only. `[NOTE]`
- Release Test Co's panel → **Send setup link** → *Goes to <email>… Type it below to confirm.* → **Send link** → *Setup link sent.*;
  the email's link sets a password. A company with no real email: *This company has no real email on file … Hand over the password
  instead.* `[BLOCKING]`
- Throwaway Co → **Suspend company** → its admin is refused at sign-in, and **Send setup link** is greyed; **Restore company** →
  back. `[BLOCKING]`
- **Set key** → **Store key** with a wrong Anthropic key → *Anthropic rejected that key — check it and try again.*; a good one
  shows only its last four and **Replace key**; **Clear** → *Key cleared — back to the platform key.* `[BLOCKING]`
- Petal cloud storage on a company: **Set quota**; **Suspend uploads** (an upload is then refused), **Restore uploads**; **Clear
  plan**. `[NOTE]`
- Throwaway Co → **Tear down company…** → *Type <slug> to confirm* → **Tear down** → counts of blobs purged; **Audit**, filter
  **Teardown**, still names the company. `[BLOCKING]`
- **Sign-ins** lists the console's own sign-ins. `[NOTE]`
- **AI files**: *In the store (every environment)*, *Tied to a company of this environment*, *No receipt here (another
  environment’s): left alone*, *A receipt that does not match its file: left alone*. The sweep asks *Permanently delete N files
  older than 24 hours, across every company of this environment?* and answers *Deleted N file(s) across M companies.*, with a
  `blob.purged` row in Audit. **On the beta before 2026-11-09** (OUTSTANDING FX12-01; walkthrough 76 part C). `[BLOCKING]`

## §E. D.O.G. (25 min · walkthroughs 75, 76, 77, 80, 81, 84)

- No project: card **1 Project and references** reads *None chosen* and *What goes to the AI: what is listed here and the project’s
  title and description, with what you write below.*; `Uploads (0)` with **Choose file**, which Tab reaches; **Core files only**
  off, *Core files come from a project: choose one above.* `[BLOCKING]`
- **Choose a project** → **Add references** (*From <project>, and your notes*) → an item, a file and a note → **Done** → listed in
  groups; the meter *Less than 1% of what D.O.G. can read for one deck* (or *About N% …*); two or more give **Remove all
  references**, with Undo. `[BLOCKING]`
- **Core files only** → the rows become the project's Core files (Step 7.4) and **Add references** greys: *Your N chosen references
  are set aside while this is ticked; they come back when you clear it.*; clearing it brings them back. `[BLOCKING]`
- Card **2 Generate outline** has exactly **Place visual** and **Theme generator**, in both modes. `[BLOCKING]`
- Full deck, the context box empty, Enter → nothing made, the box focused, *Write in the deck context box first*; with words, Enter
  makes a deck (Shift+Enter is a new line); **Generate full deck outline** works with the box empty, and clicked straight after
  typing it lands. `[BLOCKING]`
- A generation streams, then a **WIL-6001** row with token counts. `[BLOCKING]`
- Export → `<deck title>_DECKOUTLINE.md` (and `_VIS_DECKOUTLINE.md`, `_IMG_PROMPTS.md` when on), the format unchanged. `[BLOCKING]`
- A 21st upload → *Maximum 20 files allowed*; a PSD is greyed, *D.O.G. cannot read this kind of file*. `[NOTE]`
- **The AI’s file store** (`Admin terminal` → `Diagnostics`): upload a small PDF, make a single page, **Check again** → **Files** 1,
  **Oldest** *under an hour*; make it again → still 1; remove the PDF with × → 0; upload again and close WILSON (desktop) or sign
  out (web), reopen → 0; `Logs`, **WIL-6001**: *AI file deleted* rows, `tool: ai-files`, `via: member`, no file name. `[BLOCKING]`

## §F. O.T.T.E.R. (35 min · walkthroughs 03, 08, 84)

- A course and a generated subject survive a reload. `[BLOCKING]`
- Course **⋯** → **Share or submit…** → *Who can edit it*: add `testmgr` → listed. **Just for me** ⇄ **Share with the company**,
  close, reopen → as you set it. `[BLOCKING]`
- **Move to trash** → **Recently deleted** → restore → back with its subjects. `[BLOCKING]` A new course of the same name first →
  *You already have a course with this name. Rename that one first, then restore.* `[NOTE]`
- The company standard (Step 7.5); `testuser` starts a course of that name → *Your company already has a course for this* → an
  editable copy. A course shared with you: *Read only — study it, or make your own copy.* `[BLOCKING]`
- `testuser` → **Suggest a change…**; the admin's tab reads **Admin** (others see **Requests**) → approve → the counts, the
  standard updated additively, an archive *<name> (before change #1)*, and the reference documents (hotkeys, functions, nodes,
  links) moved too; corrections stay. An empty decline note cannot be sent; `testmgr` sees the queue read-only. `[BLOCKING]`
- Quiz scores survive a reload; the Validator's findings do not, by her decision. `[NOTE]`
- **Subject shares** `[Cloud]`, people A, B and C in one company:
  - A: **⋯** → **Share a subject…** → **Subject**, **With**, **A note for them** → **Share** → *Shared with B. It is waiting for
    them to accept.* `[BLOCKING]`
  - B: the count on the tab, **Accept** → *«Subject» is now in your <course> course, linked live from A. It stays read-only; your
    progress is your own.*; the subject shows **Linked** and *Linked from A's <course> · read only · you see their edits as they make
    them*, with **Pass on…** and **Remove from my course**; **Mark complete** ticks B's progress only. `[BLOCKING]`
  - A, **Shared by you**: *B · accepted* → **Withdraw** → *B will lose the link. Their own progress stays theirs.* → B reads
    *«Subject» is no longer shared with you.* `[BLOCKING]`
  - B → **Pass on…** to C → A's list *C via B (waiting)*; withdrawing B's ends C's. `[BLOCKING]`
  - **Share this course with…** → *Shared your course with B: N subjects, waiting for them to accept.*; B has one card, **Accept
    all** / **Decline all**; A adds a subject → *Share the new subject too?* (**Share** / **Not now**). `[BLOCKING]`

## §G. R.A.B.B.I.T.: projects, tasks, items, views (35 min · walkthroughs 65, 70, 72, 74, 81, 82)

- `Intake` → **New project** (or `Resources` → `Projects` → **New project**) → it persists; **Switch** ▾ swaps projects with nothing
  left of the last. `[BLOCKING]`
- `[Desktop]` `[Cloud]` A private project (the box shows only on the desktop, signed in): `Resources` → `Projects` → **New
  project**, *Private project.* → `testuser` cannot see it, an admin can. `[BLOCKING]`
- `Intake` on a script (needs the AI) → assets and scenes parsed out. `[BLOCKING]`
- `[Cloud]` Tasks given to `testuser` show on their `Dashboard` → **My tasks**; one completed there shows in R.A.B.B.I.T. (on Local
  Server **My tasks** is empty by design). `[BLOCKING]`
- A task's page icon (*Open <title>*) → **Items (n)**: **+** (*Add an item*) adds a scene; removing the last item asks *Remove “X”?
  It is this task's only item: …*; an asset deleted on `Assets` → *Deleted asset "X". Its tasks stay.* `[BLOCKING]`
- **Views** (Tasks; the same on Assets, Levels, Experiences and Scenes, Shots its own): **+ New view** `Shoot week` → *Shoot week
  saved for everyone*; **Filters** → **Add filter** (left empty, nothing changes) → Status, two values → the bar *Shoot week:
  changed for now* with **Reset**, **Save as new view**, **Save** → **Save** → *Shoot week saved*; reload → it opens on that view.
  `[BLOCKING]`
- `[Cloud]` In a second browser profile a teammate's save arrives at once; with a change of their own, *<name> changed Shoot week.
  Your changes are still on screen.*, and their **Save** asks *Save over the newer Shoot week?* `[BLOCKING]`
- **Group: Asset** → **Create grouping** → two assets → **Create** → an empty group; the same two again → *That grouping already
  exists.*; a task dragged in → *Moved "<task>" to <group>*. `[BLOCKING]`
- As `testuser` (a reviewer): *<name>: changed for now. Only the project's editors can save views.*, no New view. `[NOTE]`
- Levels and Experiences grey every write control for a seat that cannot write, with the reason on hover. `[BLOCKING]`
- `Budget` uses the rate card's rates; **By asset** splits a two-item task in half and the rows add up. `[BLOCKING]`
- At 1280 wide, `Team members` and `Rate card` scroll no sideways (P1-29/30); Tab into R.A.B.B.I.T.'s main area and its focus ring
  shows as on every other page (DG3-02): two of plan §3's nine defects. `[BLOCKING]` D.O.G. reading past a project's first 1,000
  cloud files rests on walkthrough 82.
- The corner dot: green when the database and the files' home answer, amber when only the database does, red offline. `[NOTE]`

## §H. Scenes, shot lists and edits (20 min · walkthroughs 51, 53, 67)

Scenes, shots, levels, experiences and key dates work on both backends.

- The bar under **Shot list**: the list, its **Active** badge, and *Never saved*, *Not saved since changes* or *Saved <date>*. **New
  shot list** (**Title**, **Same title, next version**, **Summary**, **Start from**) → **Create shot list** → the new list, not
  active, with **Set active**. `[BLOCKING]`
- Its maker, on an untouched list: **⋯** → **Withdraw** → *Withdraw this list?* → **Withdraw** → *Recently removed: <list>* with
  **Open** and **Restore**. `[BLOCKING]`
- Row **⋯** → **Remove from this list**: the scene stays in the project; out of the active list, its tasks show on the Timeline (by
  scene) under *No scene in the active list*. `[BLOCKING]`
- Drag a scene by its grip → *Make a new edit from this list?* → **Start new edit** → *… · vN (not saved)* and a pulsing **Save
  edit** → saved, no window. `[BLOCKING]`
- On a saved edit, row **⋯** → **Move down**: nothing asks; **Save edit** keeps its name, no new version; **Save as…** → **Save as a
  new version** → **Save new version**. `[BLOCKING]`
- To `Timeline` with changes → *Save the edit before leaving?* (**Keep editing** focused, **Discard changes**, **Save edit**).
  `[BLOCKING]`
- `[Cloud]` As `testuser` (a reviewer): lists and edits save; **Set active** and **Archive** say *managers only*. `[NOTE]`
- A **Key date** deleted → **Undo**; later, **Deleted** → *Recently deleted key dates*. `[BLOCKING]`

## §I. Budget and bid versions (20 min · walkthroughs 48 §6, 55, 69, 82)

`Budget` → `Summary`. On the cloud, members and reviewers (`testuser`) see no Budget tab.

- *No version is open.* → **Save as new version…** (**Name**, **Note**, *Based on the shot list “…”.*) → the open version and the
  **Selected bid**; change a task → *Unsaved changes* → **Save** keeps its name. `[BLOCKING]`
- **Selected bid** → another → **Edit this version** → *Edit “X”?* → *N tasks left the Timeline: editing “X”* with Undo; editing a
  version that holds them brings them back with their comments. `[BLOCKING]`
- **Set budget active** → *Set “X” active?* → the banner, *Locked “X” as the budget in production*; **Edit this version** greyed
  (*… Reset to bidding first.*); **Reset to bidding** → *Back to bidding: “X” unlocked*. `[BLOCKING]`
- Timeline **Bid ver.**: **Current**, a **Bid versions** group, **Manage versions…**; a saved one → *Viewing bid version: …*,
  **Read-only**, with **+ Task**, **+ Phase** and **Key date** greyed; **Current** returns, nothing written. `[BLOCKING]`
- `[Cloud]` Two windows: a version saved or deleted in one shows in the other within a second, no reload. `[BLOCKING]`
- Timeline gear → **Editable** on → **Show weekends** off → Day: Week → Day → Week keeps the left-edge date. `[NOTE]`
- `Budget` → `Crew/team` or `Talent` (Step 7.2's rows) → **Attach invoice**: uploaded, any error shown in place. `[BLOCKING]`

## §J. Files, Legal and tags (15 min · walkthroughs 52, 54, 56)

R.A.B.B.I.T. → **Files** (or `Resources` → `Files`).

- **Table** / **Columns**; one folder at a time (*Up to <folder> (Backspace)*); a search over the whole project (*No files match
  “…” in this project*). The file window: **Notes**, **Core project file**, **Kind**, **Tags**, **Preview**, **Download** (desktop:
  **Show in folder**, **Open in default app**). `[BLOCKING]`
- **File activity**: **Uploaded**, **Downloaded**, **Moved**, **Relinked** (`[Local]`), **Trashed**, **Restored**, **Purged**, each
  with who. `[BLOCKING]`
- An admin or project manager: **Add as Legal** (*Only project managers, workspace managers and workspace admins will see these
  files.*) → *Add these 2 files as Legal?* → **Add 2 as Legal** → a **LEGAL** folder; the file reads *Added as Legal. To change
  this, add the file again.* and its **Core project file** is disabled. `[BLOCKING]`
- `testuser` (a reviewer): no **Add as Legal**, no LEGAL folder; Legal files absent from the counts, **File activity** and D.O.G.'s
  project files. `[BLOCKING]`
- `testmgr2`, a workspace manager with no seat on the project: the LEGAL folder and **Add as Legal**, while money stays shut
  (**INVOICES** empty, no Budget tab, no **Bid ver.**). `[BLOCKING]`
- `[Local]` Move the project's folder on disk → the Files tab's *N file(s) can’t be found on disk — the folder may have moved.* →
  **Relink…** → matches proposed, applied, the banner gone. `[BLOCKING]`

## §K. Bins and the file gateway (30 min, 15 more with the service · walkthroughs 57, 58, 60–63)

Bins shows only with the project's **Scenes and shots** on.

- `[Web]` One notice: *This is the catalogue: every bin and clip, with its picture where the company allows one, its logging, its
  marks and its takes. Adding clips and playing them need the desktop app on a computer that can reach the footage.*; **New bin**
  where Add would be. `[BLOCKING]`
- `[Desktop]` `[Cloud]` `App settings` → `Storage` → **Footage locations** → **Add a location**, `\\server\share` → **Add location**
  → *Reachable from this computer*; `Z:\footage` is refused: *A footage location is written as its network address, like
  \\server\footage — …* `[BLOCKING]`
- `[Desktop]` `[Cloud]` **Add** → **Files…** → `Add to "<bin>"` (*… referenced in place*) → *Reading 1 of 2 on the share…* → the
  rows; one plays (Space); **Open** and **Reveal** work; a file outside every location is set aside: *This file is not inside any of
  the company's footage locations. …* `[BLOCKING]`
- `[Pair]` In the browser, a clip's inspector: **Not on this computer** and why; **S**, **R**, **U**, **C** mark it Select, Reject,
  Unflag, Circle; **A** assigns it to a shot; **Delete** with Undo; each change reaches the desktop window with no reload.
  `[BLOCKING]`
- `[Pair]` The admin switch **Allow files to be viewed from outside the office network** off → the browser shows each clip's kind
  icon, never a broken picture. On (the sentence under it says the workspace then leaves TPN Gold Shield eligibility) → *Viewing
  from outside the office turned on* with Undo → the desktop offers **Upload pictures for N clips** → the browser shows them.
  Others see **On**/**Off** and *Only a workspace admin can change whether files may be viewed from outside the office network.*
  `[BLOCKING]`
- `[Cloud]` **File gateway** → **Add a gateway** → a token (*This token is shown once and works once, for 24 hours…*), the **WILSON
  cloud** address, **On a NAS** / **On a Windows PC**; unused, it waits under **Unused tokens** with **Cancel**. Others read *Only a
  workspace admin can add or change the file gateway.* `[BLOCKING]`
- `[Gateway]` After the install the row says the token is spent; the fingerprint pasted → *Confirmed: this is your gateway.
  Download certificate is ready.*; the certificate installed on **another** office computer, whose browser then gets the gateway
  sentence and plays the clip (Space: *Space plays the clip large.*); a ProRes clip: *This clip's format does not play in a browser;
  the desktop app plays it.* `[BLOCKING]`
- `[Gateway]` **Check reach** with the switch off → *The switch is off, so the outside door is closed; the check confirms nothing
  answers from outside (good). Turn the switch on to open it.* (about 25 s). `[NOTE]`
- `[Gateway]` From outside: the viewer's name, code and the clock over the picture; an admin's inspector line *Viewed from outside N
  times, last by … on …* opens the list. **Forget** → *Forget this gateway* → **Forget** → *Forgotten: …* with **Undo (60 s)**.
  `[NOTE]`
- `[Local]` Signed out, bins work as before: clips offline, relink by this computer's folders, **Import a folder…**. `[NOTE]`

## §L. Storage: the backends and the company's own (20 min · walkthroughs 12, 13, 73)

- **Storage backend**: **Supabase** ⇄ **Local Server** → **Connected**, each with its own data; on the web Local Server and Google
  Drive read *Desktop app only — needs the local server or Drive bridge*. `[BLOCKING]`
- Google Drive, with a Drive connected: reads; a write refuses (read-only in 1.0); the rate card is empty, no red banner. `[NOTE]`
- `Admin terminal` → **Storage** → **Storage mode** → **Your own storage** → *Storage mode saved. Configure your server or bucket
  below.* `[BLOCKING]`
- An S3-compatible test bucket: **S3-compatible bucket**, then **Endpoint**, **Region**, **Bucket**, **Prefix**, **Access key ID** →
  **Save bucket**; the secret → **Save secret** → *Secret stored, encrypted. Only its last characters are ever shown again.*; **Test
  connection** → *Bucket reachable · server ✓ · this app ✓ · N ms* (without handbook §12.7a's CORS rule the second half fails).
  Uploads and downloads work; an invoice or Legal file stays on Petal's storage; in the browser a preview reads *Preview isn't
  available yet for files stored in your own bucket. Download it to view it.* (until §S's P1). `[BLOCKING]` with a bucket,
  otherwise waived
- `[Desktop]` **Server / NAS** → **Storage root** `\\server\share\Projects` → **Save root** → *Reachable · read ✓ · write ✓ · N ms*; a
  drive letter is refused; on the cloud backend, in the browser and on the desktop alike, an upload is refused (*… add files from the
  desktop app in Local Server mode; …*). `[BLOCKING]` with a share, otherwise waived
- Then **Storage mode** → **Petal cloud** again, before §R: with a **Server / NAS** set, a cloud upload is refused, and §R uploads
  (a setup step, not a check).
- `[Desktop]` `[Local]` Thumbnails, a video, an invoice attach and O.T.T.E.R.'s library on this computer all work: each goes through
  the loopback API, which refuses a request without the per-launch token, so an empty grid here is an auth failure (walkthrough 12).
  `[BLOCKING]`

## §M. Two windows (10 min) `[Cloud]`

The admin in one browser profile, `testuser` in another (or a private window): two tabs of one profile share one sign-in.

- A task edited in one appears in the other with no refresh; both show who is there. `[BLOCKING]`
- The second window's edit-history drawer shows the first's edit with its name; a revert there reaches the first; **Ctrl+Z** in the
  first undoes cleanly. `[BLOCKING]`

## §N. Delete and restore, exports, the Dashboard (15 min)

- Delete an asset → **Undo**; let the toast go and restore from the trash. Deleting a project says what goes with it. `[BLOCKING]`
- `Rate card` → **Export CSV**; `Team members` → **Export** (the view's rows and columns); `Tasks` → **Export** (the filtered view,
  its asset and bid columns as the table shows them); `Timeline` gear → **Editable** on → *Holidays / blocked days* → **Export CSV**
  (`rabbit-holidays.csv`). `[BLOCKING]`
- `[Cloud]` `Dashboard` → **Notes**: create, edit, group → after a reload still there; two devices editing one note merge rather
  than overwrite. `[BLOCKING]`
- `Dashboard` → **Profile**: a new name and avatar show in the roster and on presence. `[BLOCKING]` (the avatar: Known 26)

## §O. Reconnect and the offline launch (20 min · walkthroughs 83, 84) `[Cloud]`

- A silent hang (online, nothing answering: a captive portal, or a VPN dropped under you; the browser's Offline switch fails at once
  instead): at 20 s *Connection lost — reconnecting…* with **Reload**, the dot amber (*Database: reconnecting…*); the network back,
  the strip goes by itself within about 10 s. `[BLOCKING]` Left dead, after about 80 s *Connection lost — reload to continue.*, and
  it still recovers. `[NOTE]`
- `[Desktop]` Signed in, quit, Wi-Fi off, relaunch within 4 hours → past the sign-in, the strip reconnecting from the first paint;
  each screen says one sentence and offers no New or Create: *Could not reach the database — your projects appear when the
  connection returns.* (R.A.B.B.I.T., Projects, D.O.G.'s card 1; *tasks* or *notes* on the Dashboard), and O.T.T.E.R. opens this
  computer's library. Wi-Fi back → the lists fill within about 10 s, and O.T.T.E.R. moves to the company library. `[BLOCKING]`
- `[Desktop]` Offline more than 4 hours after the sign-in → the sign-in. `[BLOCKING]`
- A pet change offline → *Your pet could not be reached in your account, so this change was not saved. Reopen WILSON to try
  again.*; a failed sync retries by itself. `[NOTE]`

## §P. The desktop app (10 min · walkthrough 12)

- A second launch from the Start menu → the running window to the front, no second copy. `[BLOCKING]`
- `App settings` → `General` → **Version and updates** (an installed build only): a definite answer; **Download update** →
  *Downloading… N%* → **Restart and install** needs a newer release on the feed; no feed → *Update check failed: …*, not a crash.
  `[NOTE]`
- **Close WILSON** with an unsaved edit → **Save edit and close** offered. `[NOTE]`

## §Q. The web build (10 min)

- Signed out, `/wilson` → the sign-in; a deep link to `/wilson/otter` → the sign-in, then O.T.T.E.R. `[BLOCKING]`
- The address follows the page: `/wilson` (Home), `/wilson/dog`, `/wilson/otter`, `/wilson/rabbit`, `/wilson/dashboard`,
  `/wilson/settings`, `/wilson/project-manager`, `/wilson/rate-card`, `/wilson/team-members`, `/wilson/project-files`,
  `/wilson/admin-terminal`, `/wilson/help`; an unknown path → Home; Back stays in the app; a hard refresh on a deep link answers 200
  with the same page. `[BLOCKING]`
- An AI generation on the web matches the desktop's. `[BLOCKING]` The console is clean on load. `[NOTE]`

## §R. The desktop → cloud migration (15 min · walkthroughs 58, 84)

- `[Desktop]` `[Cloud]` `App settings` → `Storage` → **Migrate to cloud** (Storage mode on Petal cloud, §L): **Dry-run** → the
  counts; **Migrate** → Step 7.8's project arrives with its phases, assets, tasks and links, key dates, comments, shot lists (the
  active one set) and edits, folders with their files, scenes, shots, bins, clips and takes, task items, saved views and
  groupings. Under the table: *Stays on this computer for now (part 2 of the migration carries it): …* `[BLOCKING]`
- After a clean run **Migrate** greys, its hover *Done. Running it again skips every row already in the cloud…*; **Dry-run** again,
  then **Migrate**: nothing new arrives. `[BLOCKING]`
- In a browser the counts are 0; signed out it reads *Sign in to enable cloud migration for your R.A.B.B.I.T. data.* `[NOTE]`

## §S. Night 4's three sessions (for the controller to complete)

Written from their briefs before they merged. When each merges, the controller replaces its line with the checks its hand-off
gives and deletes the Known entry it closes.

- **M2, the migration part 2** (`docs/sessions/briefs/po-m2-migration-part-2.md`): budgets, expenses, levels and experiences
  carried; a second run brings back nothing a teammate deleted; **Draft**, **Wrapped** and **Inactive** save in the browser (0103);
  a cleared Director or Producer saves. *For the controller to complete.*
- **P1, own-storage previews** (`po-p1-own-storage-previews.md`): on an S3 workspace in the browser, thumbnails, the preview and a
  video play; money files never take that path; the NAS as its design decided. *For the controller to complete.*
- **D1, the desktop keeps its state across a relaunch** (`po-d1-desktop-storage-across-relaunch.md`): quit and relaunch, and the
  4-hour limit counts from the real sign-in while the Timeline's settings, the saved views and the crash copies of unsaved edits
  survive. *For the controller to complete.*

---

# Known not to work at v1.0.0

Skip these: each is recorded, and finding one means you found the known thing. Faults are in `docs/OUTSTANDING.md` (tag in
brackets), limits by design in `docs/SYSTEMS_HANDBOOK.md` §17.

**Sign-in and the desktop**
1. On the desktop the 4-hour cap restarts at every launch, and what the app keeps in the browser's storage starts empty at each
   launch: the Timeline's settings and collapsed phases, holidays, Budget's and Team's saved views, the Scenes tab's remembered shot
   list, the task window's item Sort, the update prompt's skipped version, the crash copies of unsaved edits (S2-01, MEASURED; *On
   the desktop, the browser's own storage…*, INFERRED). D1 closes it.
2. Two tabs of `/wilson` share one stored session, and each renews it on its own (S1-01, INFERRED).
3. Failed sign-ins and two-factor checks are logged only where the hooks are on (Step 0.6); refusals by the functions' guards are
   logged nowhere; the console's sign-ins are in **Sign-ins**, not **Audit**.
4. **WIL-1001** and **WIL-1003** are listed in Diagnostics and never sent; **WIL-3005**, **-3006** and **-3007** show as *Unknown
   error code* in Logs (*Three storage event codes…*, MEASURED).

**R.A.B.B.I.T.**
5. The Summary's Budget tile is always zero (handbook §17).
6. Scenes, shots, levels and experiences do not reach a second window live; key dates do (her ruling).
7. Grouping Tasks by Phase or Assignee drops a task whose value is not in the project's list (INFERRED); a status or priority
   outside the lists shows the list's first option (R1-L4, MEASURED).
8. Budget's Expenses: the **Linked task** filter calls every task "Untitled", and its saved views go stale after a project switch
   (INFERRED).
9. Holding a number field's arrow fills the undo history; the Tasks table's **Bid days** field hides a figure's first characters
   behind the arrows (both MEASURED).
10. A manager's second window shows a new invoice or Legal file only after a reload (S4b-03, MEASURED).
11. A bar dragged across hidden weekends may land two days short (P1-32a, INFERRED); the Budget's version steps have no Ctrl+Z, Undo
    is the toast (S5c-01).
12. The workspace takeout holds 23 tables, and none of: scenes, shots, levels, experiences, key dates, budgets, expenses, folders,
    task templates, shot lists, edits, bins (R2-01, MEASURED from the code).

**Bins, the gateway, storage**
13. Professional codecs have no preview until an ffmpeg binary is installed (MEASURED); a managed video added before then keeps its
    icon until it is added again.
14. Signed out, the desktop's Bins freeze the window on a share whose server does not answer (MEASURED); adding a big folder from a
    share walks it on the main thread (INFERRED).
15. A company's own S3 bucket or NAS has no previews in the browser: icons, *Preview isn't available yet…* (handbook §12.7b,
    deliberate). P1 brings S3's. A network-provider workspace never has cloud previews.
16. The cloud keeps no sample rate or channel count on a clip (INFERRED).
17. Google Drive is read-only; its Bins tab says *Bins live on the desktop*, with an out-of-date line (*In cloud mode there is
    nothing to show here yet.*).

**The migration**
18. It does not carry budgets, expenses, levels, experiences, the team or task links yet (part 2, INFERRED); a second run brings back
    rows a teammate deleted (INFERRED); the browser offers Draft, Wrapped and Inactive, which the cloud refuses (M1-L4, MEASURED). M2
    closes all of these but the team, which is night 5's M3, with asset versions, the desktop's own file store, rate cards, team
    members and task templates (M1-L1, M1-L2).

**O.T.T.E.R., the pet, D.O.G.**
19. The Validator's findings are not stored (her decision); quiz scores are.
20. In the company library a subject's delete says "permanently", and it is the 30-day trash (MEASURED, by reading).
21. While a linked subject is open the pet has no lesson to read and is not told it is read-only (MEASURED, by reading).
22. On the cloud an O.T.T.E.R. import of a lesson, or of a local-mode export, saves nothing (INFERRED).
23. The pet does not sync live between machines (1.1, plan §2); two web tabs overwrite each other's O.T.T.E.R. settings and agent
    skills.
24. R.A.B.B.I.T.'s agent is unreachable and the **Agent skills** checkboxes gate nothing.
25. A click on a D.O.G. checkbox's words does nothing; only its box ticks it (DG4-01, MEASURED).

**Everywhere**
26. A new avatar may not last (*Avatar does not persist*, REPORTED, cause unproven; 0102 is reserved for its policy).
27. Screen-reader names, Tab stops, landmarks, forced colours and minimum font sizes, and about 160 polish entries, wait for 1.1
    (plan §2, §3).

---

# Before you tag

Plan §0, the four conditions, as boxes:

- [ ] **The features** (plan §2) built, merged and on the beta: night 4's M2, P1, D1 and R2 and night 5's M3 merged, the
      controller's morning beta merge after each night, and the small item *Avatars persist* done or moved to 1.1 by her ruling.
- [ ] **The nine defects** (plan §3) closed: DG2-02, DG2-01, DG3-01 and DG3-02 (night 1, walkthrough 81); S5-02, DG1-01, P1-29/30,
      the two-factor screen's overflow, and the Dashboard's stale items with the Tasks CSV (night 2, walkthroughs 82 and 83). §A, §E,
      §G, §I and §N re-check them; DG1-01 rests on walkthrough 82.
- [ ] **Her testing**: the walkthroughs of plan §6 reported (48 to 55, 72 to 81, and each night's, 82 to 86); every `[BLOCKING]`
      above passed or knowingly waived.
- [ ] **Her browser steps** (plan §6): `smoke_admin` rotated and CI green; staging's legacy `service_role` key rolled; the two Auth
      hooks on staging; PR #4's title and body; the gateway's GitHub setup and the installer rehearsal; the AI-files sweep on the
      beta before 2026-11-09.
- [ ] **The TPN re-audit** (plan §0 item 4: "after the TPN re-audit reports nothing High"): `TPN_AUDIT/SUMMARY.md`'s *Release gate*
      reads 0 Critical and 0 High open in the four areas. On 2026-10-28 it reads 11 High; walkthrough 85 Q1 and Q2 propose that her
      ruling on each count as nothing High. Q1 was ruled the same day: seven fixed before the release (Phase 8), TPN-AI-009
      accepted for the start of the production steps; Q2 too: the three instances are fixed in that session, ten in all.
- [ ] **The controller's production steps**: `docs/PRODUCTION_RUNBOOK.md` in the order of its (g), her steps and the controller's
      interleaved, production's AI-files sweep before 2026-11-09 among them.
- [ ] **The release**: `package.json` at `1.0.0` (it is); `CHANGELOG.md`'s 1.0.0 entry dated in the release commit; PR #4
      (`feat/multi-user-v1` into `main`) merged with a merge commit, never a squash; the tag `v1.0.0` on that merge commit, pushed.
      Vercel's production branch is `feat/multi-user-v1` (`docs/WEB_DEPLOY.md`), so merging into `main` deploys nothing on the
      beta; where 1.0.0's web app lives is her question in walkthrough 85.
