# Walkthrough 08 — O.T.T.E.R.: the library switch, self-approval, and documents that travel

**What this checks.** Track A bundle A4 (`601756a`, `088dba8`, `93c199e`,
`dfe666e`; 2026-09-07). Five of your decisions, in one tool:

1. **Decision 2 — the "Suggest a change…" dead end.** Your fix branch is
   merged. The item disappears once the course it was copied from stops being
   the company standard, instead of opening a form whose Send always failed.
2. **Decision 3 — the local library is reachable again.** Signing in on the
   desktop used to hide the six courses saved on this computer with no way
   back. There is now a switch, and a notice on the library screen that carries
   the way back with it.
3. **Decision 28b — the dead field is gone.** O.T.T.E.R.'s own Settings had a
   "Storage Location" box that wrote a value nothing has ever read. Removed; the
   Library switch is in its place. **The project-files folder in WILSON's own
   General settings is a different thing and is untouched.**
4. **Decision 36 — self-approval is allowed, and now recorded.** A manager can
   still approve their own nomination. It now writes an audit line
   (`WIL-4108`) that an admin can read in the Logs.
5. **Decision 37 — approving a change request moves the reference documents.**
   Hotkeys, functions, nodes and reference links now travel with the subjects.

**Where and who.**

- **Steps 1–7: the DESKTOP APP**, signed in. This is the only place a local
  library exists, so it is the only place the switch appears.
- **Steps 8–12: the BETA, in a browser.** You need **two accounts in two
  browsers**; I will call them **MANAGER** (a manager or admin) and
  **MEMBER** (an ordinary member). Keep each in its own browser window.
- **Steps 13–17: the BETA**, MEMBER and MANAGER again, plus the Admin Terminal
  as an **ADMIN**.

🚨 **Two things to know before you start.**

- **Steps 13–17 need an ADMIN, not just a manager.** Approving a *change
  request* happens in the Admin Terminal, which only an admin can open. A
  manager can approve a *nomination* (steps 8–12) but not a change request.
  If your MANAGER account is an admin, one account covers both.
- **`corrections` deliberately do NOT travel** in step 17, and that is my
  judgement call, not your decision — see the question at the end. Four
  documents move; corrections stay with the proposer.

---

## Steps

### The library switch — desktop only

1. **Open WILSON on the desktop and sign in.** Go into **O.T.T.E.R.**
   - **Expect:** the library shows your **company's** courses.
   - **If instead** you see your six local courses (Blender and friends) while
     signed in: record that — the switch may already be pinned from an earlier
     run, and step 3 will tell us.

2. **Look at the top of the library list, above `Course Library`.**
   - **Expect:** a notice reading *"You are signed in, so this is your company
     library. Courses saved on this computer are hidden."* with a link under it
     reading **`Show the courses on this computer`**, and a grey line saying
     *"You can also change this in Settings under Library."*
   - **If instead** there is no notice: record it and skip to step 4 — the
     Settings control is the other way in and step 4 tests it directly.

3. **Click `Show the courses on this computer`.**
   - **Expect:** the library reloads and shows the courses saved on this
     machine — six of them, Blender among them. The notice changes to *"This is
     the library on this computer. Your company courses are hidden."* with a
     link reading **`Show the company library`**.
   - **Expect also:** the `Requests` (or `Admin`) button at the top of O.T.T.E.R.
     disappears while you are on the local library, and comes back when you
     switch back. That is correct — change requests only exist in a company.
   - **If instead** the list does not change, or shows a mixture: stop and
     record what it shows, with a screenshot. That is the important failure.

4. **Open the menu and choose `SETTINGS`, then the `Tool Settings` tab.**
   - **Expect:** a section headed **`Library`** with two choices,
     **`Company (signed in)`** and **`This computer`**, and the second one is
     highlighted because of step 3. Under them a line reading
     *"Showing now: the courses on this computer."*
   - **Expect:** there is **no** "Storage Location" box anywhere on this tab.
     That is decision 28b.
   - **If instead** you still see "Storage Location": record it — the removal
     did not take.

5. **Note the padlock.** The bar above the settings content reads `Locked` and
   `Read Only` by default.
   - **Expect:** while it says `Locked`, the two Library choices are dimmed and
     do nothing. Click the padlock so it reads `Unlocked` / `Editable`, and they
     work.
   - **If instead** they work while locked, or never work: record which.
   - *(This is why the notice in step 2 carries its own link — so you are never
     stuck behind a padlock to get your courses back.)*

6. **Set it back to `Company (signed in)`, close Settings, then quit WILSON
   completely and reopen it.**
   - **Expect:** your company library. Now flip to `This computer` again, quit,
     and reopen: **the local library is still showing.** The choice is
     remembered for this computer.
   - **If instead** it forgets after a restart: record it.

7. **With `This computer` still selected, ask the pet a Blender question** —
   something you know is only in your local Blender course, e.g. *"what's the
   shortcut to extrude in Blender?"*
   - **Expect:** it answers from your local course.
   - **Then switch to `Company (signed in)` and ask the SAME question again.**
   - **Expect:** the answer now comes from the company library — and if the
     company has no Blender course, it says it could not find anything rather
     than repeating the local answer.
   - **If instead** the second answer is identical and clearly still from the
     local course: **record it, this is the one I most want to know about.**
     It would mean the pet's memory of your courses is not following the
     switch.

### The "Suggest a change…" dead end — the beta, two accounts

8. **As MANAGER, on the beta**, open O.T.T.E.R. and make sure there is a course
   whose tier is **`Company standard`**. As MEMBER, open that course's row menu
   and choose **`Make my own copy`**.
   - **Expect:** MEMBER now owns a copy.
   - **If instead** the copy fails: record the message; steps 9–10 cannot run.

9. **As MEMBER, open the row menu on your copy.**
   - **Expect:** the menu contains **`Suggest a change…`**.
   - **If instead** it is missing already: record it — that is the opposite
     failure and would mean the gate is too tight.

10. **As MANAGER, demote the standard.** Open the standard course's menu →
    **`Share or submit…`** → change its tier from `Company standard` to
    **`Share with the company`** and confirm.
    - **Expect:** it succeeds and the course is no longer the standard.
    - **If instead** you cannot change it: record it — an admin may be needed.

11. **Back in MEMBER's browser, reload the page, and open the row menu on your
    copy again.**
    - **Expect:** **`Suggest a change…` is gone.** `Share or submit…` and
      `Make my own copy` are still there.
    - **If instead** it is still offered: click it, click Send, and record the
      exact error — that is the original dead end, unfixed.

12. **If MEMBER already had a change request open on that course before step
    10**, open it from the `Requests` view.
    - **Expect:** the form is gone, replaced by a line saying the course it was
      copied from *"is no longer the company standard"* — but you can still
      **close or withdraw** the request. You are not stranded with something you
      cannot get rid of.
    - **If instead** the whole dialog is empty or the withdraw button is gone:
      record it.

### Self-approval, recorded — the beta

13. **As MANAGER, on a course you OWN that is not already the standard**, open
    its menu → **`Share or submit…`** → submit it to become the company
    standard.
    - **Expect:** a nomination is created.
    - **If instead** there is no submit option: your account may not own the
      course. Record it.

14. **Still as MANAGER, go to the `Requests` view** (it reads `Admin` instead of
    `Requests` if this account is an admin) and find your own nomination.
    - **Expect:** you can see it, and there is an **`Approve`** button on it.
    - **If instead** the Approve button is hidden on your own row: record it —
      that is the UI half that decision 36 says should now let you through.

15. **Click `Approve`.**
    - **Expect:** it succeeds. Your course becomes the company standard, and any
      previous standard for the same topic stands down to shared.
    - **If instead** it refuses with something about approving your own: record
      the exact wording — decision 36 says this must be allowed, not blocked.

16. **As an ADMIN, open the Admin Terminal → `Logs`.**
    - **Expect:** a row with the code **`WIL-4108`**, severity **warning**, the
      message *"A nomination was approved by the person who raised it"*, naming
      the MANAGER account. Hovering the code shows *"Nomination approved by its
      own proposer"*.
    - **Expect also:** filtering the event type to `admin` still shows it.
    - **If instead** there is no such row: record it, and say whether other rows
      appear at all (if the Logs view is empty entirely, that is a different
      problem). **If the code shows as "Unknown error code" on hover**, record
      that separately.

### Reference documents travel — the beta, needs an ADMIN

17. **Set up:** as MEMBER, take a copy of a company standard course that has
    some **hotkeys** on it (`Make my own copy`). In your copy, add a hotkey the
    standard does not have, and add a reference link. Then open the row menu →
    **`Suggest a change…`**, write a summary and send it.
    - **Expect:** the request appears for the admin.
    - **If instead** sending fails: record the error and stop here.

18. **As ADMIN, open the Admin Terminal → `Requests`, find it, and click
    `Approve`.** Read the confirmation panel **before** you confirm.
    - **Expect:** it says *"Their hotkeys, functions, nodes and reference links
      are merged in as well — additively, so anything only the standard has is
      kept. Corrections stay with them: those are agent memory, not content."*
      and that a snapshot of the standard *"as it is now, documents included"*
      is kept first.
    - **If instead** it still says reference documents *"are untouched"*: record
      it — the copy did not update, even if the behaviour did.

19. **Confirm the approval.**
    - **Expect:** a green banner saying it applied, and that *"Their hotkeys,
      functions, nodes and reference links were merged in as well."*
    - **If instead** the banner says some documents *"could NOT be updated"*:
      record exactly which ones it names. That is a real result, not a crash —
      it means the account lacked permission to edit the standard's documents.

20. **Open the company standard course and look at its hotkeys and reference
    links.**
    - **Expect:** MEMBER's new hotkey and new link are there, **and** everything
      the standard already had is still there. Nothing was replaced.
    - **If instead** the standard's own entries have disappeared: **stop and
      record it with a screenshot.** That is the worst outcome this change could
      have and it is the one I would most want to hear about immediately.

21. **Open your own O.T.T.E.R. library and find the archive copy**, named
    *"<the standard's name> (before change #1)"*.
    - **Expect:** it holds the standard's hotkeys and links **as they were
      before** step 19 — MEMBER's additions are **not** in it.
    - **If instead** the archive already contains MEMBER's additions: record it.
      That would mean the snapshot was taken too late.

22. **Last one.** In MEMBER's copy, **delete** one of the hotkeys that the
    standard has, then send another change request and approve it as ADMIN.
    - **Expect:** the hotkey is **still on the standard**. Deleting from your
      copy never deletes from the standard.
    - **If instead** it disappeared from the standard: record it — additivity is
      the rule this whole flow is built on.

---

## What I could not test for you

- **Nothing here has run against staging.** The permission wall in my session
  has blocked `supabase link` against staging for four sessions running, so
  migrations `0068`, `0069` and `0077` are on **dev only**. If the beta has not
  had `0069` applied, **step 16 will find no `WIL-4108` row no matter what** —
  that is the migration missing, not the feature. The commands are in the
  hand-off for you or a session that is allowed to run them.
- **Steps 1–7 have never been run in a real desktop app by anyone.** They are
  covered by 40 automated tests and 32 deliberate breakages, but no human has
  clicked the switch.

## A question for you

**Should `corrections` move too?** Your decision 37 said "move the reference
documents", and there are five of them. I moved four. The fifth, `corrections`,
is the record of corrections you have given the agent about a course — and when
someone takes a copy of a course, the code deliberately **blanks** it, with the
reason written in it: *"Corrections are the original author's agent memory, not
content."* So pushing a proposer's corrections onto the company standard would
publish one person's private agent history to everyone, against a rule the code
already states. I left them behind. **If you want all five, say so — it is one
line.**

---

## Report template — paste this back

```
WALKTHROUGH 08 — O.T.T.E.R.
Date:
Desktop app version / beta:
Accounts used (MANAGER role, MEMBER role, ADMIN yes/no):
Was migration 0069 applied to staging before I started?  yes / no / don't know

THE LIBRARY SWITCH (desktop)
 1 signed in, company library shown          PASS / FAIL / DIDN'T GET THERE — notes:
 2 notice above Course Library               PASS / FAIL — exact wording seen:
 3 "Show the courses on this computer" works PASS / FAIL — how many courses:
   Requests button disappeared on local      YES / NO
 4 Settings > Tool Settings > Library        PASS / FAIL
   "Storage Location" is GONE                YES / STILL THERE
 5 padlock gates the choices                 PASS / FAIL
 6 choice survives a full restart            PASS / FAIL
 7 pet answers from the CHOSEN library       PASS / FAIL
   question I asked:
   answer on "This computer":
   answer on "Company (signed in)":

SUGGEST A CHANGE (beta)
 8 copy made                                 PASS / FAIL
 9 "Suggest a change…" present before demote PASS / FAIL
10 standard demoted                          PASS / FAIL
11 "Suggest a change…" GONE after demote     PASS / FAIL
12 an open request can still be withdrawn    PASS / FAIL / N/A

SELF-APPROVAL (beta)
13 nomination submitted                      PASS / FAIL
14 Approve offered on my OWN nomination      PASS / FAIL
15 approval succeeded                        PASS / FAIL — message if not:
16 WIL-4108 row in Admin Terminal > Logs     PASS / FAIL
   severity shown:                warning / other:
   hover text:                    "Nomination approved by its own proposer" / "Unknown error code" / other:

REFERENCE DOCUMENTS (beta, admin)
17 change request sent                       PASS / FAIL
18 confirm panel mentions hotkeys etc.       PASS / FAIL — wording seen:
19 green banner says documents merged        PASS / FAIL — any named as failed:
20 standard has BOTH sets of entries         PASS / FAIL
21 archive holds the OLD documents           PASS / FAIL
22 deleting on the copy did NOT delete on
   the standard                              PASS / FAIL

MY ANSWER ON corrections: move all five / leave it as four

ANYTHING ELSE (crashes, odd wording, slowness, anything that felt wrong):
```
