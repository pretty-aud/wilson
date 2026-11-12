# Walkthrough 02 — the setup link (S43b), end to end

**What this checks.** The operator console can email a company's founding
admin a link to set their own password, instead of you reading a show-once
password down the phone. Built by S43b (`186fa63` + `df257d0`),
second-reviewed and deployed by Track A bundle A1. Migration 0066 and the
function are on staging (the beta) and dev; prod has neither.

**Where and who.**

- **Browser 1 = you**, at the operator console
  https://admin.petalstudios.co/wilsonadmin (staging-backed). Console
  sign-in is `Email` + `Password` → `Sign in`, then `Authenticator code` →
  `Verify`. If you meet `Not a platform operator` or
  `Could not verify operator status`, record which and stop;
  `OWED_AUDREY.md` §12 explains both.
- **Browser 2 = a private window**, nobody signed in. It becomes the
  throwaway company's admin.
- **A mailbox you can read** that is NOT the address of any existing WILSON
  account on staging. If your operator account is name@gmail.com, use
  name+throwaway@gmail.com: Gmail delivers it to the same inbox and WILSON
  treats it as a different person. An address that already has an account is
  refused with "That email already has an account."

**Timing matters in step 6.** The recovery email says the link is valid for 1
hour, but the real lifetime is a per-project dashboard setting nobody has
measured. Note the time the email arrives and the time you click it.

## Steps

1. **Browser 1:** sign in to the console.
   - **Expect:** the `Companies` tab.
   - **If instead:** record the screen you got (`Not a platform operator`,
     or `Could not verify operator status` with its `Retry` button) and the
     exact text.
2. **Browser 1:** `New company`. Fill `Company name` (for example Throwaway
   0906), `Slug (part of sign-in, permanent)` (for example throwaway-0906),
   `Admin username` (for example throwadmin), and `Admin email (optional)` =
   the mailbox above. Click `Create company`.
   - **Expect:** a dialog headed `Company created` with the show-once
     password. Click `Copy all`, paste the three lines into a note, then
     `Done`.
   - **If instead:** record the error text shown under the form.
3. **Browser 1:** click the new company's row to open its panel. Under
   `Setup link`, click `Send setup link`.
   - **Expect:** "Looking up the admin…" for a moment, then "Goes to
     <your throwaway address> (throwadmin). Type it below to confirm." and an
     empty email field.
   - **If instead:** "This company has no real email on file…",
     "Could not look up this company’s admin. Try again in a moment.",
     "Network error — check your connection." or "Request failed (…)":
     record the exact text.
4. **Browser 1:** type a WRONG address (put an x before the @) and click
   `Send link`.
   - **Expect:** "That does not match the address on file for this company."
     and no email.
   - **If instead** it says "Setup link sent.": record it and watch the inbox.
     A link sent to an unconfirmed address is a real defect.
5. **Browser 1:** type the exact address and click `Send link`. Note the time.
   - **Expect:** "Setup link sent." and the field closes.
   - **If instead:** "The email could not be sent. Nothing was changed — try
     again." or any other text: record it verbatim, with the time.
6. Check the inbox, and the spam folder. Note the arrival time.
   - **Expect:** an email saying "A password reset was requested for
     <address>" with a button, and the line "This link is valid for 1 hour."
   - **If instead** nothing arrives within 10 minutes: record it. Steps 7–9
     cannot proceed; still do steps 10–13.
7. **Browser 2 (private window):** open the link from the email. Note the
   time.
   - **Expect:** the beta opens on a screen headed `NEW PASSWORD` (you may
     briefly see `VERIFYING LINK…`, and it may ask you to `Continue` first).
   - **If instead** it lands on `LOGIN` with no password screen, or shows an
     error: record the full URL you landed on and the text.
8. **Browser 2:** enter a password (10 to 128 characters) twice and click
   `Set password`.
   - **Expect:** "Password updated. Sign in with your new password."
   - **If instead:** record the error text. "Password must be 10–128
     characters." and "Passwords do not match." are the form's own checks;
     anything else is the point.
9. **Browser 2:** on `LOGIN`, `COMPANY` = the slug → `Continue`; then
   `USERNAME` = throwadmin and `PASSWORD` = the new password → `Sign in`.
   - **Expect:** you land inside the throwaway company as its admin (Home
     offers `Admin Terminal`).
   - **If instead:** "Sign-in failed. Check your details and try again." —
     record it, then also try the show-once password from step 2 and record
     whether THAT still works.
10. **Browser 1:** console → `Audit` tab. In the action filter (it starts on
    `All actions`) choose `Setup link sent`.
    - **Expect:** one row for the send: the action reads INVITE_SENT,
      Company shows your throwaway's name and slug, Detail reads "Setup link
      sent for <name> (<slug>)". Click the row: the expanded detail shows
      "sent_to": "<address>" and "admin_username": "throwadmin". The
      certificate code `WIL-7009` is stored on the row; the table does not
      display codes, by design.
    - **If instead** there is no row, or the detail has no sent_to: record
      what the row shows.
11. **Browser 1:** send the link a second time to the same company (steps 3
    and 5 again).
    - **Expect:** a second email and a second Audit row. Nothing stops a
      resend today.
    - **Record your call:** should a second send stay allowed as-is, need a
      confirmation, or be blocked for a while? This is S43b's open question 6.
12. **No-email company. Browser 1:** `New company` with
    `Admin email (optional)` left EMPTY.
    - **Expect:** `Company created`, the show-once password, and the extra
      line "No real email was given, so <username>.<slug>@wilson.invalid was
      synthesised. Password resets for this admin are operator/admin-only."
      Open that company's panel and click `Send setup link`.
    - **Expect:** "This company has no real email on file (<that address>),
      so there is nowhere to send a link. Hand over the password instead."
      with the field and `Send link` greyed out.
    - **If instead** the field is enabled, or a link "sends": record it.
13. **Suspended company. Browser 1:** on the throwaway from step 2 click
    `Suspend company`.
    - **Expect:** "Suspended.", and the `Send setup link` button greyed out
      with the tooltip "Restore this company first." Click `Restore company`
      → "Restored." and the button is back.
    - **If instead** the button stays enabled while suspended: record it.
14. Leave both companies in place: walkthrough 05 uses them and tears them
    down.

## Report (paste back)

```
Walkthrough 02 — setup link — date:
1 console sign-in: OK / screen seen:
2 company created, password copied: Y/N
3 address shown before typing: Y/N   text:
4 wrong address refused: Y/N
5 sent at (time):          message:
6 email arrived at (time):          subject line:
7 link opened NEW PASSWORD at (time):   Y/N   landed on:
8 password set: Y/N
9 signed in as the new admin: Y/N   (old show-once password still works? Y/N)
10 Audit row present with sent_to: Y/N
11 second send worked: Y/N   my call on resends:
12 no-email company refused with the greyed field: Y/N
13 suspended company greyed with tooltip: Y/N
Anything odd (exact text):
```
