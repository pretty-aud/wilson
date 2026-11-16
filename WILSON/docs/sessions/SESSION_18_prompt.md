# SESSION 18 launch prompt — finish the release testing pass, then tag

> Paste into a new Claude Code conversation. **Start the session from
> `WILSON/`, not `Claude_Work/`** — S17 lost time to relative paths resolving
> against the wrong repo.
> **First tool call** per standing rule: `git status` on `feat/multi-user-v1`.
> Then read `docs/RELEASE_TESTING.md` §A0 and `docs/MASTER_PLAN.md` §6
> entries **#68–#72** — that is the whole context for what follows.

---

## 🚨 THE RULE THAT OVERRIDES EVERYTHING

**Do not write code, ship a fix, or state a conclusion from an unproven
theory. Measure first.**

Audrey's words, 2026-07-31: *"stop doing work off of theories until they are
proven. please remember this."* It is in the auto-memory as
`feedback_prove_before_acting.md`.

This is not generic caution — it cost her over an hour in S17. Five successive
theories about one sign-in hang were all wrong, **two were shipped as fixes**,
and two were "disproved" by measurements that could not work (comparing bundle
hashes across builds with different `VITE_*` values will always differ; that
was presented as proof of a stale deployment). What actually found it:

1. `SELECT count(*) FILTER (WHERE verified_at IS NULL), count(*) FROM auth.mfa_challenges;`
   → 7 challenges, 0 unverified. The server was healthy; the fault was after
   `verify`.
2. A browser Network capture → `verify` returned **200 in 113 ms** and **no
   request followed it**. A hang with no request is not a network problem.
3. Reading `GoTrueClient._verify`, then grepping the four `onAuthStateChange`
   subscribers.

**Ask for the one decisive artifact early.** Say "I don't know yet, here is
what would tell us" instead of narrating a plausible cause. Label what is
*measured*, *inferred*, and *guessed* — Audrey reads these as claims and acts
on them.

Second standing rule from S17: **do not change what the app does or how it
looks** beyond the fixes explicitly scoped below. The release is prepared and
Audrey is mid-review.

---

## Where the release actually is

**v1.0.0 is PREPARED, NOT TAGGED, NOT MERGED to `main`.** `package.json` is
`1.0.0`; `main` is Vercel's production branch and merging changes what beta
serves. The tag is Audrey's call once she finishes the testing pass.

- Branch `feat/multi-user-v1`, CI green, migrations `0000`–`0030` on all three
  envs, all twelve Edge Functions deployed, CLI linked to `wilson-dev`.
- Vitest **353**. pgTAP **38 suites / 605 assertions**.
- Beta web: `https://beta.petalstudios.co/wilson` and — **new in S17** —
  `https://admin.petalstudios.co/wilsonadmin`. **Both are STAGING-backed**
  (`rzkirvkotslbovzbsdfh`). Every domain on the Vercel project serves BOTH
  surfaces, because `vercel.json` routes on path, not host.
- Audrey **is now in the operator console**: TOTP enrolled and a
  `platform_operators` row on staging. That took most of S17 — see below.

### S17's post-commit run of auth fixes (all deployed)

| Commit | What |
|---|---|
| `a776907` | `/wilsonadmin/` 404'd on a trailing slash |
| `8222ea1` | auth awaits unbounded → infinite spinner; `withTimeout` + 8 tests |
| `8222ea1` | success path with no terminal state → invisible full-screen overlay (the "blank orange screen") |
| `037fd13` | same ceilings on the operator console |
| `669a870` | uses `mfa.verify()`'s returned session — **honest note: this fixed nothing**, `_verify` releases its lock before resolving. Shipped on an unproven theory. Harmless, saves a round trip. |
| `920a2f7` | **THE deadlock** — an `async` `onAuthStateChange` callback in `RabbitProvider.jsx` awaited Supabase queries while auth-js held the auth lock. Self-deadlock; MFA sign-in was impossible. Guarded by `src/cloud/auth/authStateCallbacks.test.js`, which fails the build if any subscriber is ever `async` again. |
| `432687a` | a recovery/invite link clicked **while signed in** was silently discarded — the overlay that mounts `ResetPasswordWizard` was hidden by the existing session |

---

## Block A — the invite flow (the one real piece of unfinished work)

**Problem, measured on staging.** Two invites were sent. Both were redeemed
**12 and 16 seconds** after sending — one to a corporate domain
(`zerospace.co`), one to **Gmail** — with `email_confirmed_at` and
`last_sign_in_at` set and both tokens cleared. Neither recipient ever saw a
password form. Supabase invite/recovery links are **single-use**, and mail
providers open them automatically to scan for malware, which spends the link
before the human clicks.

`432687a` made this *visible* (the wizard now mounts and explains itself) but
did not fix it. **Fix it properly:**

1. **Templates** — `supabase/templates/invite.html` and `recovery.html`
   currently use `{{ .ConfirmationURL }}`, which is a direct
   `/auth/v1/verify?token=…` link that any GET redeems. Change to carry
   `{{ .TokenHash }}` to a page in the app, e.g.
   `{{ .SiteURL }}/#/recovery?token_hash={{ .TokenHash }}&type=invite`.
2. **App** — on that route render a "Set your password" button and call
   `supabase.auth.verifyOtp({ token_hash, type })` **only on the click**, then
   proceed into the existing `ResetPasswordWizard` form. A scanner issuing a
   GET no longer redeems anything.
3. Keep the existing fragment-token path working — old links in flight, and
   `ResetPasswordWizard.parseRecoveryFragment()` already handles both shapes.
4. **Audrey must re-upload the templates** to all three projects via the
   dashboard. `supabase config push` is deliberately never used — it would
   push the local `[auth]` block whose `smtp.enabled = false` would disable
   hosted Resend email.
5. Verify by sending a real invite to a Gmail address and confirming the
   token survives until clicked.

**Until this ships, tell Audrey to use Admin Terminal → Users →
`Add people ▾` → "Create with password…"**, which has no email link and cannot
be pre-consumed.

---

## Block B — finish `docs/RELEASE_TESTING.md`

Audrey got through Part 1 and stalled in §A on the auth bugs. Resume at **§A0**
(the MFA regression block, which exists because of them), then Part 2 top to
bottom. Log failures; do not stop the pass to fix them unless blocking.

Not yet exercised at all: invite + onboarding as a second user, the three
tools' primary flows, Dashboard/Notes, Admin Terminal's five sections, Team
Members and grants, Rate Card, the operator console's own checks, storage
providers and relink, exports and takeout, realtime with two windows, soft
delete → undo → restore, auto-update, and the web build's deep links.

---

## Block C — §6 triage of anything Block B finds

Every new finding gets CLOSED / RE-OWNED / ACCEPTED with a reason, appended to
§6's FINAL DISPOSITION. Do not leave anything undecided.

---

## Block D — the tag, only if Audrey says so

`package.json` is already `1.0.0` and `CHANGELOG.md` is written. When she
authorises it: tag `v1.0.0`, then ask again before merging to `main`.

---

## 🚨 Still owed by Audrey — check before claiming release-ready

- **`OWED_AUDREY.md` §0 — rotate the `smoke_admin` password.** Published in the
  public repo, permanent in git history, **the one remaining open CRITICAL**
  (TPN-SDLC-007). Also worth deciding: the CI probe does not need `admin`.
- §11C is DECIDED and DONE (`admin.petalstudios.co/wilsonadmin`, option 1).
- §5 / §9C are DONE — `ANTHROPIC_API_KEY` and `WILSON_AI_KEY_SECRET` are set on
  all three envs with matching digests (verified 2026-07-30).
- Anything the Block B pass turns up.

---

## Traps that cost S17 real time

- **`scripts/tap-hosted.py` runs ONE suite; CI runs all 38 against ONE
  database.** A migration that adds a writer changes other suites' counts —
  0030's audit trigger broke `25_app_events`. Run the whole set before pushing.
- **"replay produced no ERROR lines" never means "this file passed."** A
  failing pgTAP *assertion* is not a SQL error.
- **The handbook is a gate, not an oracle.** Its Vitest count was stale where
  MASTER_PLAN's was right. Never sync one doc to the other mechanically.
- **Never make an `onAuthStateChange` callback `async`.** There is now a test
  that fails the build for it.
- **Vercel builds with staging `VITE_*` values**; a local build's bundle hash
  will never match production's. Compare **byte sizes**, not hashes.
- Both hosted domains are **staging**-backed. An account, TOTP factor or
  `platform_operators` row on *dev* will not let you into the hosted console.
- The operator console signs in with **email**, not username.
- `git add -A` in this repo will sweep untracked files into a **public**
  commit. Stage explicit paths. (S17 pushed a 13 MB PDF this way; it is
  untracked again but remains in history at `e3c3fc5` — **ask Audrey whether
  she wants that commit rewritten**, it is still unresolved.)

## Close-out ritual

Feature commit(s) → CI green → deploy dev → staging → prod → re-link CLI →
update `docs/MASTER_PLAN.md` (§4 ledger, §6 disposition, §9) → update
`docs/SYSTEMS_HANDBOOK.md` for anything that changed → update the Claude
auto-memory → docs commit + push.
