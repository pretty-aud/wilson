# Walkthrough 07 — the pet: two computers, Pet Mode, and dying properly

**What this checks.** Track A bundle A3 (`5add1d4`, `700588e`; 2026-09-07).
Seven `OUTSTANDING.md` entries about the pet, all of them written down as
*inferred* in August and none of them measured until now. Four things:

1. **A stale window can no longer overwrite your pet** (your ruling 4). If one
   computer has moved the pet on, the other one's save is refused by the
   database, and that computer re-reads and tells you. It does **not** retry.
   This is not live sync — you did not choose that — so the second computer
   still will not *notice* a change until it tries to write.
2. **The pet is cloud-only, and now says so** (your ruling 5). The old brief
   claimed it worked offline on the desktop. It never did. Settings and the
   companion's failure message both say so now.
3. **The three death oddities** (your ruling 6): a pet stuck as a corpse now
   becomes a ghost; Pet Mode off actually protects it while the app is closed;
   sleep ends and a baby grows up while the app is shut.
4. **A shared computer cannot lift one person's pet into another's account.**
   The cached copy is now filed under the account that owns it, and signing
   out deletes it.

**Where and who.**

- **Two computers, or one computer and one other browser, signed in to the
  SAME account.** Steps 1–8. I will call them **A** and **B**.
- **One computer** for steps 9–14.
- Everything is on the **beta**. Steps 12–14 are the desktop app.

🚨 **Before you start, read this — it changes what step 5 asks you to do.**
Petting a ghost writes nothing at all. `handlePetAction` only acts on an egg, a
baby or an adult, so "on B, pet it" (your original test note) would not have
produced a save, a refusal, or a notice — nothing would have happened and that
would have looked like a failure. The steps below use a gesture that really
does write.

**Set-up.** On computer A, go to `Settings` → the `General` tab → the
`Companion` section, and check what state your pet is in. Note down the name
and the `Hunger` number.

🚨 **Steps 2–3 must be an action that MOVES the pet on, and which one depends
on whether yours is alive.** The refusal compares timestamps: it fires when A's
copy is genuinely newer, and only an action that changes hunger or happiness
makes it so. Changing the difficulty on a dead pet does not — both computers
would still be holding the same copy, both saves are accepted, and B would
win with no notice, which would look exactly like a failure. The steps below
name the right action for each case.

---

## Steps

### The stale copy — two computers, one account

1. **Open WILSON on both A and B**, signed in to the same account, and leave
   both on `Settings` → `General` → `Companion`.
   - **Expect:** both show the same pet, the same name, the same state.
   - **If instead** they differ: stop and record both, with a screenshot. That
     is a different problem from the one this walkthrough is testing.

2. **On A only, move the pet on.**
   - If your pet is **alive** (a baby or an adult): click the food button on
     the companion twice, so `Hunger` visibly rises.
   - If your pet is **dead** (a ghost or a corpse): press `New Pet`, then
     `Create Egg` on the modal headed `New Pet`.
   - **Expect:** the pet changes on A — a higher `Hunger`, or an egg.
   - **If instead** nothing happens: record it and stop; steps 3–8 depend on
     this having worked.

3. **On A, click a `Difficulty` button** that is not currently selected
   (`low`, `medium` or `high`). This is not what makes A newer — step 2 did
   that — it just gives A a second write to be sure.
   - **Expect:** the button highlights. Nothing else visible.

4. **On B — which has not been touched and still shows the old pet — click
   `Pet Mode`** to toggle it (`ON` → `OFF`, or `OFF` → `ON`).
   - **Expect:** a dark notice near the bottom of the screen reading
     **`Your pet changed on another device — refreshed.`**, and the pet card
     updating to show what A did in step 2. The same sentence also appears on
     the Settings page just ABOVE the `Companion` heading, and stays there
     after the bottom notice fades.
   - **If instead** nothing appears and B's copy silently overwrites A's:
     reload both and record what each shows. That is the bug this step exists
     to catch.
   - **If instead** you see a red message about the pet not being saved:
     record its exact text — that is a different failure and I want the words.

5. **On B, click `Pet Mode` again.**
   - **Expect:** it works normally now — no new notice at the bottom of the
     screen. B is holding A's copy, so it is no longer stale. (The sentence on
     the Settings page stays until the next save succeeds, which this one is,
     so it should disappear.)
   - **If instead** you get the bottom notice a second time: record it. Two in
     a row would mean the re-read is not landing, which is a real defect.

6. **On A, reload the page.**
   - **Expect:** A shows B's Pet Mode setting. (A was the stale one this time,
     but a *reload* reads the account, so it simply gets the current pet.)

7. **On B, press `New Pet` if your pet is dead** — or skip to 8 if it is alive.
   The confirmation modal is headed `New Pet` and says
   `Create a new egg? Your current ghost will be released.` Press `Create Egg`.
   - **Expect:** `A new egg is on its way. Pet it a few times to hatch it.`
   - **If instead** you get the refresh notice here: that is CORRECT if A had
     written since B loaded — but record it anyway, because the egg should then
     be creatable on a second press.

8. **On A, reload, and confirm the egg is there.**
   - **Expect:** the egg, not the old pet.
   - **If instead** the old pet is back on A: that is the original bug and I
     need to know. Record what B shows at the same moment.

### Pet Mode off, with the app closed

9. **On one computer, note the `Hunger` number** in the `Companion` section,
   then set `Pet Mode` to `OFF` and **quit WILSON completely.**
   - This only means anything for a pet that is alive (a baby or an adult).
     An egg and a ghost never decay anyway.

10. **Leave it closed for at least an hour**, then reopen it and go back to
    `Settings` → `General` → `Companion`.
    - **Expect:** `Hunger` is the SAME number you wrote down. Not lower.
    - **If instead** it has dropped, or the pet is dead: record the before and
      after numbers and how long it was closed. That is the entry this step
      exists to close.

11. **Turn `Pet Mode` back to `ON`, quit, wait ten minutes, reopen.**
    - **Expect:** `Hunger` HAS dropped. This is the control — if it did not
      drop, Pet Mode off is not protecting anything, it has simply stopped the
      pet living at all, which is a different bug and a worse one.

### Dying properly

12. **Let a pet die and close the app within five seconds.** The practical way:
    set `Difficulty` to `high`, leave the app open and unattended until the
    pet's state reads `dead` and the sprite becomes a corpse, then quit WILSON
    **immediately** — within about five seconds of it happening.
    - This is fiddly and it is fine to fail to catch the window; if you cannot,
      say so and skip to 13.

13. **Reopen WILSON.**
    - **Expect:** a **ghost**, not a corpse. And the `New Pet` button is
      offered.
    - **If instead** it is still a corpse: record it — that is the state that
      used to be permanent.

14. **Press `New Pet` → `Create Egg`.**
    - **Expect:** `A new egg is on its way. Pet it a few times to hatch it.`,
      and an egg on screen.

### A shared computer

15. **On the desktop app, sign out**: `Settings` → the `Profile` tab →
    `Sign out` → confirm on `Sign out of WILSON on this device?` with the
    second `Sign out`.
    - **Expect:** you land back at the sign-in screen and no pet is on screen.

16. **Sign in as your OTHER account** (the second one you keep for testing) on
    the same computer.
    - **Expect:** whatever pet THAT account has — or the offer of a new one if
      it has never had a pet. **You must not see the first account's pet**, not
      even for a moment.
    - **If instead** the first account's pet appears at all, even briefly:
      record it with a screenshot and say how long it was on screen. This is
      the step that matters most on this page.

17. **Sign back in as your first account.**
    - **Expect:** your own pet, unchanged. Nothing was destroyed by any of
      this — the account row is the authority and the local copy is only a
      cache.

### The offline message

18. **Turn off your network** (wifi off is enough), then in `Settings` →
    `General` → `Companion`, click `Pet Mode`.
    - **Expect:** a red message saying the pet is not being saved, which now
      also says the pet lives in your account and the change is not stored
      anywhere until the connection comes back. The `Companion` section's own
      text above the pet card says the same thing before anything goes wrong.
    - **If instead** it claims the change was saved: record it.

19. **Turn the network back on and click `Pet Mode` again.**
    - **Expect:** it saves, and the red message goes.

---

## What is deliberately NOT fixed

Say if any of these surprises you; each is a decision rather than an oversight.

- **There is still no live sync.** B does not learn about A's change until B
  tries to write. You chose the smaller option (ruling 4); the bigger one is
  its own piece of work.
- **The refusal needs the other computer to have DONE something.** A save is
  refused only when the copy it carries is genuinely older than what is stored,
  which means the other computer has to have moved the pet on — created an egg,
  fed it, petted it, hatched it, woken it, let it decay, or turned Pet Mode back
  on. Your reported case (an egg on A while B sits on the old ghost) is exactly
  that, which is why step 4 should show you the notice. But if NEITHER computer
  has moved the pet on, both are holding the same copy, both saves are accepted,
  and the second one still wins. And a window showing a live pet with Pet Mode
  ON is advancing its own copy every thirty seconds, so its save is accepted
  too.
- **A computer whose clock is wrong is handled badly but not fatally.** The
  comparison is a timestamp your computer supplies, so a fast clock always wins
  and a slow one gets the refresh notice more often than it should — it then
  picks up the account's copy and can save normally. If you see the refresh
  notice on a machine where nothing else is running, tell me: that is a clock
  problem, not a pet problem.
- **A sleeping pet with Pet Mode OFF stays asleep while the app is closed.**
  That mirrors what happens with the app open, where the tick does nothing at
  all while Pet Mode is off.
- **The pet's chat feedback now keeps only the first 500 characters** of each
  message and reply. Nothing displays them — the only thing that reads them
  uses 60 characters — and the full text was putting the stored pet at 84% of
  the size the database will accept.

---

## Report template

Copy this back with your answers. "As expected" is a complete answer.

```
WALKTHROUGH 07 — the pet
Date:
Computers used (A / B):

1  both show the same pet ..............
2  difficulty change on A ..............
3  second difficulty change on A .......
4  Pet Mode on B → refresh notice ......   <-- the most important line
   exact text of the notice, if different:
5  Pet Mode on B again, no notice ......
6  A reloaded, shows B's setting .......
7  New Pet on B (or skipped) ...........
8  A reloaded, egg is there ............

9  hunger before closing, Pet Mode off ..
10 hunger after an hour closed .........   <-- the second most important
   hours actually closed:
11 control: hunger DID drop with Pet Mode on ......

12 caught the five-second window? (yes/no/skipped) ....
13 reopened: ghost or corpse? .........
14 New Pet worked ....................

15 signed out on the desktop ..........
16 second account: did the first account's pet appear at ANY point? ......
17 first account's pet came back intact ......

18 offline message text ...............
19 saved again when the network came back ......

Anything else that looked wrong, in your own words:
```
