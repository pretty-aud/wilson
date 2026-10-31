# Walkthrough 05 — a company's lifecycle in the operator console (S15, OWED_AUDREY §9D)

**What this checks.** `OWED_AUDREY.md` §9D items 1–7, owed since S15:
session isolation between the app and the console, the non-operator refusal,
create → sign in, suspend and restore, the per-company AI key, teardown with a
surviving certificate, and the password panel in Settings. Run it after
walkthrough 02, which created the two throwaway companies this one tears
down.

**Where and who.** **Browser 1 = you**, signed in to the beta
https://beta.petalstudios.co/wilson AND to the console
https://admin.petalstudios.co/wilsonadmin in the same browser (that is the
point of item 1). **Browser 2 = the private window** signed in as the
throwaway company's admin (walkthrough 02 step 9), and later `tester`.

## Steps

1. **Session isolation. Browser 1:** with the beta tab signed in as you, open
   the console in a new tab.
   - **Expect:** the console shows its own sign-in (`Email`, `Password`,
     `Sign in`, then `Authenticator code`, `Verify`); it does not inherit the
     app session. Sign in there, then switch back to the beta tab and reload.
   - **Expect:** still signed in as you in the app.
   - **If instead** either tab picked up the other's session, or signed out:
     record which.
2. **Non-operator refusal. Browser 2:** sign out of the beta, open the
   console, sign in as `tester`.
   - **Expect:** a screen headed `Not a platform operator` with a `Sign out`
     button, not a broken console.
   - **If instead** the console opens, or the screen is blank: record it.
     Then `Sign out`.
3. **Create and sign in:** done in walkthrough 02 steps 2 and 9 (the
   show-once dialog `Company created`, then `COMPANY` + `USERNAME` +
   `PASSWORD`). Record here only if either failed there.
4. **Rename. Browser 1 (console):** open the throwaway company's panel,
   change the name, click `Rename`.
   - **Expect:** "Renamed." and the note "The slug is permanent — it is part
     of sign-in." (the slug did not change).
5. **Suspend. Browser 1:** `Suspend company`.
   - **Expect:** "Suspended." and the line "Members lose access immediately.
     Nothing is deleted, and it can be undone."; the row shows `Suspended`.
   - **Browser 2 (the throwaway admin):** reload the beta.
   - **Expect:** no access to the company. Record exactly what the screen
     says; it should not be a blank page.
   - **Browser 1:** `Restore company` → "Restored." **Browser 2:** reload →
     back in.
   - **If instead** the member kept access while suspended, or could not get
     back in after the restore: record it.
6. **Per-company AI key (optional; needs a spare Anthropic key). Browser 1:**
   in the panel's AI key field paste a WRONG key first.
   - **Expect:** "Anthropic rejected that key — check it and try again."
     Then paste a good key.
   - **Expect:** stored, showing only its last four characters, with no way
     to reveal it.
   - **If instead** a bad key is accepted, or the full key is shown: record
     it.
7. **Storage plan. Browser 1:** in the panel enter a quota in GB →
   `Set quota` → "Quota saved."; then `Suspend uploads`. **Browser 2**
   (throwaway admin, in RABBIT): try to add a file.
   - **Expect:** the upload is refused; record the exact message. **Browser
     1:** `Restore uploads`; **Browser 2:** the upload works again.
8. **Tear down. Browser 1:** `Tear down company…` → type the slug exactly →
   `Tear down`.
   - **Expect:** a receipt with blob counts (found, removed, missing), then
     the company leaves the list. Open `Audit`, filter `Teardown`.
   - **Expect:** the `workspace.teardown` row is there and still names the
     company (name and slug in the Company column) even though the company is
     gone.
   - **If instead** the row is missing or shows a bare id: record it. That
     row surviving is the whole point of the separate audit table.
9. Tear down the no-email company from walkthrough 02 step 12 the same way.
10. **Password panel. Browser 1 (the beta):** Settings → `General`.
    - **Expect:** the change-password panel reads "Your password is managed
      by your workspace account. Use “Forgot password” on the sign-in screen
      to reset it, or ask a workspace admin." with no local password form.
      Then check the same in the desktop app while signed in.
    - **If instead** you see the old local-password form, or the panel sits
      under a different tab: record which platform and which tab.

## Report (paste back)

```
Walkthrough 05 — company lifecycle — date:
1 sessions isolated both ways: Y/N
2 tester refused with Not a platform operator: Y/N
3 create + sign-in (from 02): OK / failed at:
4 rename OK, slug unchanged: Y/N
5 suspend: member locked out? Y/N (screen text:)   restore: back in? Y/N
6 AI key: bad key refused Y/N, good key masked Y/N   (skipped? Y/N)
7 quota saved Y/N, uploads refused while suspended Y/N (text:), restored Y/N
8 teardown receipt shown Y/N, Audit row survives naming the company Y/N
9 no-email company torn down: Y/N
10 password panel text correct on web Y/N, desktop Y/N   tab:
Anything odd (exact text):
```
