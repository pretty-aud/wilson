# Outstanding problems

Everything currently known to be **broken and not yet fixed**. Live document —
updated at the end of every session.

## The rule for this file

**Only add something if it is broken and unfixed.** Not "could be improved",
not "worth watching", not "we should probably". If it is fixed in the same
session it is not an entry, it is a commit message.

Three things follow from that:

- **An empty session adds nothing.** A session that fixes things and breaks
  nothing leaves this file untouched. That is a good outcome, not a gap to
  fill. Padding it with hedges makes the real entries harder to see, and a list
  nobody trusts is a list nobody reads.
- **Delete entries when they are fixed.** Cite the commit in the session
  close-out, then remove the entry. This file is the present state, not a
  history — `git log` is the history.
- **Say how you know.** Every entry is tagged, because the difference decides
  whether the next session starts by fixing or by diagnosing:
  - **MEASURED** — observed failing. Says what was run and what came back.
  - **REPORTED** — Audrey hit it; not yet reproduced or diagnosed.
  - **INFERRED** — code reading says it must break, not yet seen failing.
    Names what would settle it.

Anything that is merely unverified, interim, or planned belongs in
`MASTER_PLAN_S19_ONWARD.md`, not here.

---

## 🚨 Security — blocks the v1.0.0 tag

### `smoke_admin` password is in public git history
**MEASURED.** The repo `pretty-aud/wilson` is public and the password was
committed. Rotating the account does not remove it from history.
→ `OWED_AUDREY.md` §0, TPN-SDLC-007. **Audrey's action.**

### `wilson-staging` legacy `service_role` key was exposed
**MEASURED.** S19 (2026-08-02): `supabase projects api-keys` returns every key
in a single JSON line, and a `grep -v service_role` filter that assumed
line-per-key printed all of them into a session transcript. The key bypasses
RLS.
→ Rotate: dashboard → wilson-staging → Settings → API → Legacy API keys → roll
`service_role`. The `anon` key beside it is publishable and needs nothing.
**Audrey's action.** Never filter that command's output; select the one field.

---

## Broken features

### wilson-dev auth config was overwritten by an accidental `config push`
**MEASURED.** S19 (2026-08-02). A `node -e "…"` command written with double
quotes contained escaped backticks; bash evaluated them anyway and executed
`supabase config push` against **wilson-dev**, twice. The `[Y/n]` prompts got
no stdin and defaulted to yes.

Confirmed applied: on the second run the auth diff had shrunk to one line, so
everything in the first diff was already written.

| Setting | Was (restore to this) | Now |
|---|---|---|
| `site_url` | `http://localhost:3000` | `http://localhost:5203` |
| `additional_redirect_urls` | `[]` | `["http://localhost:5203"]` |
| `enable_signup` | `true` | `false` |
| `mfa.totp.enroll_enabled` | `true` | `false` |
| `mfa.totp.verify_enabled` | `true` | `false` |
| `email.enable_signup` | `true` | `false` |
| `email.enable_confirmations` | `true` | `false` |
| `email.max_frequency` | `1m0s` | `1s` |
| `email.otp_length` | `8` | `6` |

**`smtp.enabled` was NOT applied** — it still showed `true → false` as a
pending diff on the second run, so hosted Resend email on dev is intact. That
was the specific catastrophe the "never config push" warning exists to prevent,
and it did not happen.

The three email templates were overwritten with **byte-identical content**
(CRLF vs LF only), so nothing was lost there.

**Only wilson-dev.** Staging and prod were never targeted.

→ Restore by hand at
`https://supabase.com/dashboard/project/eqjzmnvkrakroyqxfsvw/auth/providers`
and the URL-configuration page. `site_url` matters most: the invite and
recovery templates build their links from `{{ .SiteURL }}`.
**Do not fix this with the CLI** — that means running the command that caused
it. **Audrey's action.**

### `rate_cards.type` does not exist in the cloud schema
**MEASURED (S18).** Queried staging — the column is absent. `useRateCard.js`
reads and writes `c.type === 'general' | 'internal'`, so the whole
internal-vs-general rate card feature keys on a column that was never added.
One root cause behind two of Audrey's reports (the "type column" error, and
being unable to reach the internal card). `rate_card_entries` is fine.
→ Migration 0033 + backfill to `'general'` + pgTAP. Planned for S21.

### R.A.B.B.I.T. task management
**REPORTED.** Not yet reproduced or diagnosed — budget diagnosis time, not
just fix time.
- New-task button in Tasks does nothing.
- Board view: typing a task and pressing Enter makes it vanish.
- Assignee dropdown does not populate. Partial lead: `ProjectTasksView.jsx:159`
  filters the roster to `project_members` when `projectIsStaffed`, and falls
  back to the whole roster when not — so either staffing rows are missing or
  the roster is empty. **Query both before touching code.**

### Scenes / levels / experiences are unavailable on cloud projects
**MEASURED.** Local-only by design — the Supabase adapter throws (Known #5).
Audrey calls these crucial, so the current behaviour is a silent throw where
there should at least be honest copy.
→ Decision pending: make them cloud-capable (migration + RLS + adapter + suite,
a session of its own) or keep local and say so in the UI.

### Storage tab: every backend button is disabled on the web
**MEASURED (S18).** `RabbitProvider.jsx:312` forces `'supabase'` when
`window.electronAPI` is absent; `SettingsPage.jsx:595` then disables each button
when `active || unavailableOnWeb`. Supabase is *active* (disabled) and the other
two are *unavailableOnWeb* (disabled). All three disabled by construction, not
a broken handler. Reads as "storage is broken" when Supabase is in fact working.
→ S22.

### Profile panel can spin forever
**INFERRED.** `ProfileSection.jsx:66` awaits `getSession()` inside a
`Promise.all` with no timeout; if it never resolves, `setLoading(false)` never
runs. Matches Audrey's "loading profile and then never loads anything". 18
`getSession()` call sites are unbounded; only the 4 auth screens S17 fixed use
`withTimeout`. `aiProxy.js:65` is on the same list and sits on the path of
every AI call.
→ **Settle before fixing:** open the stuck panel, devtools → Network. If a
`workspace_members` request returns 200 while the UI still says loading, the
fault is after the await and this is confirmed.

### Avatar does not persist
**REPORTED.** Possibly the same root cause as the Profile panel above; re-check
after that one is settled.

### Password change is missing from SYSTEM SETTINGS
**MEASURED.** S15 deleted the panel because it drove a dead local-credential
route (§6 #32). The copy now sends users to the sign-in screen instead. There
is no in-app way to change a password.
→ Wire it to Supabase properly. S21.

### O.T.T.E.R. validator findings and quiz scores are not saved
**MEASURED.** Known #2. Both generate correctly and neither result is
persisted, so the work is lost on navigation.

### Welcome page has a phantom cursor
**REPORTED.** A black cursor blinks permanently, unattached to any input, and
keeps blinking on the right while typing elsewhere. Likely the shared
`AuthCursor` from `AuthShell.jsx` — **that is a guess, confirm in the DOM
first.**
→ S25.

---

## Session log

Kept so the file's own history is visible without `git log`.

| Session | Added | Removed |
|---|---|---|
| S19 (2026-08-02) | staging `service_role` exposure; **wilson-dev auth config overwritten** by an accidental `config push` | **email templates** — confirmed by Audrey on all three projects, both invite and recovery. The entry was seeded from a stale S18 note; dev was already correct when this file was written. |

Both S19 additions are the same root cause: **a shell command built by string
interpolation, where the content was not safe for the shell.** The first
printed a `service_role` key into a transcript because a `grep -v` filter
assumed line-per-key JSON; the second ran `supabase config push` because bash
evaluated backticks inside a double-quoted `node -e`. Neither was a reasoning
error — both were quoting. See the standing rule in `MASTER_PLAN.md`.
