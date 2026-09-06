# Walkthrough 03 — course nominations (Phase 5b, migration 0064)

**What this checks.** Anyone can put a course forward to become the company
standard; admins and managers decide; approving demotes the incumbent
standard with the same slug to `Shared`; submitting opens a read-only review
window for the deciders that closes when they decide. Built as Phase 5b
(`a7d87c5`..`3f4d638`), live on the beta, never exercised by a human.

**Where and who.** The beta https://beta.petalstudios.co/wilson.
**Browser 1 = you (admin).** **Browser 2 = `tester`**, a plain member at the
start, made a `Manager` for steps 10–13 and put back at the end (Home →
`Team Members` → tester's row → the `Role` column).

**Course names matter.** The standard for a topic is keyed by the course's
slug, which is frozen from its name at creation. Two courses compete for the
same spot only if they were CREATED with the same name.

## Steps

1. **Browser 2 (tester):** create a personal course with `New Course`, named
   exactly **Nomination test A** (one lesson is enough). Its badge should read
   `Yours`.
   - **Expect:** the course card shows a three-dots menu button that is
     visible without hunting (Phase 5 fixed its contrast and size).
   - **If instead** you had to hunt for it: record it; that was the original
     complaint.
2. **Browser 2:** three-dots menu → `Share or submit…`.
   - **Expect:** a dialog headed `Share or submit` with a `Who can see this`
     section and a `Put it forward` control.
   - **If instead** the menu shows only `Make my own copy`: record it (that is
     the menu for courses you do not own).
3. **Browser 2:** `Put it forward`, answer "Why should this be the company's
   official course on this topic?", submit.
   - **Expect:** "Put forward. An admin or a manager will review it."
   - **If instead:** record the error text.
4. **Browser 2:** top nav → `Requests` → `My nominations`.
   - **Expect:** Nomination test A listed as open.
5. **Browser 1 (you, admin):** O.T.T.E.R. → `Admin` tab → the
   `Put forward as company standard` section.
   - **Expect:** the nomination, with `Open their course`. Click it: tester's
     course opens and is readable. This is the review window; tester did not
     share the course.
   - **If instead** you see "Their course is not readable right now — refresh
     to see its current state." or a 404: record it.
6. **Browser 1:** back in `Admin`, click `Approve` on the nomination.
   - **Expect:** a confirmation that begins "This makes “Nomination test A”
     the company standard, live for everyone immediately" and says that any
     course currently holding that spot stands down. Click
     `Make it the standard`.
   - **Expect:** the row shows Approved.
   - **If instead:** record the error text.
7. **Browser 1:** go to the library.
   - **Expect:** Nomination test A now carries the `Standard` badge and is in
     your library too (standards are company-wide).
   - **Browser 2 (tester):** `Requests` → `My nominations` shows Approved,
     and the course badge reads `Standard`.
8. **The window closes on decision. Browser 2 (tester):** create a second
   personal course named **Nomination test B** and put it forward (steps
   2–3). **Browser 1 (you):** `Admin` → `Open their course` (readable) →
   `Decline`, write a note, confirm.
   - **Expect:** the nomination row now reads "Their course is not readable
     right now — refresh to see its current state.", and Nomination test B is
     gone from YOUR library.
   - **If instead** you can still open it: record it.
9. **Browser 2 (tester):** `Requests` → `My nominations`.
   - **Expect:** Nomination test B shows the decline with your note.
10. **Approve as a manager, and the incumbent stands down. Browser 1 (you):**
    Home → `Team Members` → tester's row → `Role` → `Manager`. Then in
    O.T.T.E.R. create a personal course of your own named exactly
    **Nomination test A** (the same name as the current standard) and put it
    forward (three-dots menu → `Share or submit…` → `Put it forward`).
11. **Browser 2 (tester, now a manager):** top nav → `Requests` (for a
    manager the tab still reads `Requests`, not `Admin`) →
    `Put forward as company standard` → `Open their course`.
    - **Expect:** your course is readable; the window opens for managers too.
    - **If instead** the section is missing or the course is not readable:
      record it.
12. **Browser 2 (tester, manager):** `Approve` → `Make it the standard`.
    - **Expect:** Approved. In both browsers' libraries YOUR Nomination test
      A is now `Standard`, and tester's Nomination test A dropped to `Shared`
      (it stood down); nothing was deleted.
    - **If instead:** "Only an admin can set or clear the company standard.",
      or both courses show `Standard`, or the old one vanished: record it.
13. **Browser 2 (tester, manager):** open the three-dots menu on YOUR
    standard course.
    - **Expect:** only `Make my own copy` and no `Share or submit…`; you
      cannot nominate a course you do not own.
14. Put tester back to a plain member (Home → `Team Members` → `Role`).
15. Time O.T.T.E.R. opening: close and reopen the tool twice.
    - **Expect:** no slower than before Phase 5.

## Report (paste back)

```
Walkthrough 03 — course nominations — date:
1 menu easy to find: Y/N
2 Share or submit dialog: Y/N
3 submitted, confirmation shown: Y/N
4 My nominations lists it: Y/N
5 Open their course readable (admin): Y/N
6 approve confirm mentioned stand-down, then Approved: Y/N
7 Standard badge in both libraries: Y/N
8 after Decline: not readable and gone from my library: Y/N
9 tester sees the decline note: Y/N
10 manager set, my same-name course put forward: Y/N
11 manager can open it: Y/N
12 manager approved; old standard now Shared: Y/N
13 non-owner sees only Make my own copy: Y/N
14 tester back to member: Y/N
15 launch time OK: Y/N
Anything odd (exact text):
```
