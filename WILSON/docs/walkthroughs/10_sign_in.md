# Walkthrough 10 — Sign in, company first

**Track B, bundle B1 (2026-09-06).** What this proves: the first screen every
person sees asks for the **company** before the credentials; a username can
exist in two companies and each signs in to its own; a company that does not
exist and a company that is suspended are refused with the **same** words; a
wrong password and a wrong username are refused with the **same** words at the
same speed; a password reset says it signs you out everywhere and does.

**Where:** the beta (`beta.petalstudios.co/wilson`), which is backed by
**staging**. The operator console is `admin.petalstudios.co/wilsonadmin`.

**Accounts:** two companies on staging with the **same username** in both. If
you do not have that yet, Step 0 makes it. You run two browsers; each step says
which one.

Every label below was grep-verified against `src/` on the day this was written.

---

## Step 0 — Make the second company (operator console, Browser A)

1. Browser A: sign in to the operator console (`Email` + `Password` +
   `Authenticator code`).
2. Create a second company (the setup link flow you tested in walkthrough 02).
   Name it something you will recognise — this walkthrough calls it
   **Company B**; your existing one is **Company A**.
3. In Company B, create a user whose username is **identical** to one you
   already have in Company A (this walkthrough calls it `sameuser`). Give it a
   password you can type.
   - **Expect:** it is accepted. The username only has to be unique inside
     Company B.
   - **If instead** you see `username_taken` or a "taken" message: record the
     exact text — that would mean uniqueness is being checked across
     companies, which is the bug this bundle says is gone.

## Step 1 — The company step (Browser B, signed out)

1. Browser B: open the beta. You land on the terminal-style screen headed
   `LOGIN` with one field, `COMPANY`, and a `Continue` button.
   - **Expect:** if you have signed in from this browser before, the field is
     **already filled** with the last company you used here. Otherwise it is
     empty.
   - **If instead** the field shows a company you have never used in this
     browser: record what it shows.
2. Type the display name of Company A exactly as it appears in the operator
   console (capitalisation does not matter), press `Continue`.
   - **Expect:** the button reads `Checking…` briefly, then the screen changes
     to `USERNAME` and `PASSWORD`, with the company name you typed echoed
     above them and `Change company` · `Forgot password?` beneath.
   - **If instead** you see `COMPANY NOT FOUND.` for a company that exists:
     record the exact name you typed and the exact name in the console.
3. Press `Change company`. Type a company that does not exist
   (`Zebra Toast Ltd`), `Continue`.
   - **Expect:** `COMPANY NOT FOUND.` and you stay on the company step — no
     username field appears.
4. Still on the company step: type Company A's name minus its last letter,
   then a star (for `Petal Studios`, `Petal Studio*`), `Continue`.
   - **Expect:** `COMPANY NOT FOUND.` A star is not a search. (The review
     rounds after B1 found that it was one — `Petal Studio*` went through as
     Petal Studios — and fixed it; this step proves the fix on the beta. The
     name minus one letter is the form that matters: a short prefix would be
     refused even by a resolver with the fix removed.)
   - **If instead** the username field appears: record exactly what you typed.

## Step 2 — Suspended reads exactly like missing (Browser A, then B)

1. Browser A (operator console): suspend Company B.
2. Browser B: `Change company` if needed, type Company B's name, `Continue`.
   - **Expect:** `COMPANY NOT FOUND.` — **the identical words** as Step 1.3.
     Nothing on screen says "suspended". That is deliberate: the company
     step confirms a company exists (your ruling) but never reveals its
     status.
   - **If instead** the wording differs in any way: paste both messages.
3. Browser A: restore Company B.

## Step 3 — Same username, two companies (Browser B)

1. Browser B: type Company A, `Continue`; username `sameuser`, its Company A
   password, `Sign in`.
   - **Expect:** the app opens in **Company A** (`SYSTEM SETTINGS` → `GENERAL`
     shows Company A's name).
2. Sign out (`SYSTEM SETTINGS` → `GENERAL` → `Sign out`). Back on `LOGIN`,
   the company field is pre-filled with Company A. Change it to Company B,
   `Continue`; username `sameuser`, its **Company B** password, `Sign in`.
   - **Expect:** the app opens in **Company B**.
   - **If instead** either sign-in fails with
     `SIGN-IN FAILED. CHECK COMPANY, USERNAME AND PASSWORD.`: record which
     company, and whether the two accounts really have different passwords
     (the Company A password will not work in Company B — that is correct).
3. Sign out. Type Company A, `Continue`; username `sameuser`, the **Company
   B** password, `Sign in`.
   - **Expect:** `SIGN-IN FAILED. CHECK COMPANY, USERNAME AND PASSWORD.` — the
     company you name decides which account is tried, so the other company's
     password is simply wrong here.

## Step 4 — Wrong password and wrong username look and feel the same (Browser B)

1. Company A, `Continue`; a real username, a **wrong** password, `Sign in`.
   - **Expect:** `SIGN-IN FAILED. CHECK COMPANY, USERNAME AND PASSWORD.` after
     about half a second.
2. Same company; username `nobody-here-99`, any password, `Sign in`.
   - **Expect:** the **same** words, at about the same speed. Different
     wording, or a visibly faster refusal, is a username-enumeration leak —
     record it.
   - **Measured on wilson-dev the day this shipped:** the resolver answers in
     a constant ~300 ms either way; Supabase's own password check adds
     ~170 ms for a real account and ~85 ms for a fake one. Not visible to a
     person; noted so nobody mistakes it for a regression.

## Step 5 — Too many attempts (Browser B, optional)

1. Press `Change company`, then `Continue` twenty-one times inside one minute
   with any company name.
   - **Expect:** the 21st answers `TOO MANY ATTEMPTS. WAIT A MINUTE AND TRY
     AGAIN.` A minute later, `Continue` works again.
   - This is per address and per minute; it will never fire on a normal
     sign-in.

## Step 6 — Password reset signs you out everywhere (Browser A and B)

1. Browser A: sign in to the **operator console** and leave it open.
2. Browser B: Company A, `Continue`, `Forgot password?`; enter the username of
   an account whose email you can read; `Send reset link`. Open the email,
   follow the link, `Continue`.
   - **Expect:** the `NEW PASSWORD` form, and beneath its `Set password`
     button the line `YOU WILL BE SIGNED OUT ON EVERY DEVICE.`
3. Set a new password.
   - **Expect:** "Password updated. You have been signed out on every device
     — sign in again with your new password."
4. Browser A: click anything in the operator console.
   - **Expect:** it is signed out and shows its own sign-in screen. That is
     your ruling (answer 12): a reset revokes every session the person
     holds, and now the screen says so before and after.
   - **If instead** the console stays signed in: record how long after the
     reset you clicked.

## Step 7 — The remembered company and a link (Browser B)

1. Sign out. Close the tab. Open the beta again.
   - **Expect:** the `COMPANY` field is already filled with the last company
     you signed in to from this browser.
2. Open `beta.petalstudios.co/wilson?company=Company%20A` (use the real
   name).
   - **Expect:** the field is filled with what the link said, and you still
     have to press `Continue` — a link never skips the check.

---

## Report back (paste and fill in)

```
Walkthrough 10 — sign in, company first — <date>
Step 0 same username in two companies: accepted / refused (text: …)
Step 1 remembered company: yes / no / wrong (…); real company: went through / COMPANY NOT FOUND
Step 1.3 missing company wording: …
Step 1.4 star (Petal Studio*): COMPANY NOT FOUND / went through (typed: …)
Step 2 suspended company wording: … (identical to 1.3? yes / no)
Step 3 sameuser → Company A: ok / failed; → Company B: ok / failed; cross-password refused: yes / no
Step 4 wrong password wording: …; unknown username wording: …; felt the same speed: yes / no
Step 5 (optional) 21st attempt: TOO MANY ATTEMPTS / still 200 / other (…)
Step 6 reset form line seen: yes / no; done message: …; operator console signed out: yes / no (after … s)
Step 7 remembered after reopening: yes / no; ?company= link pre-filled: yes / no
Anything else: …
```
