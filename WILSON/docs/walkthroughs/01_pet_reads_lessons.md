# Walkthrough 01 — the pet reads the O.T.T.E.R. lessons (Phase 6)

**What this checks.** Phase 6 (`8894fd2` + `605dbeb`) lets the pet answer
from your O.T.T.E.R. courses instead of telling you to look it up. Nobody has
exercised it by hand. This script follows the Phase 6 test plan plus your four
rulings of 2026-08-14: a topic with no course gets a BRIEF answer and a nudge
towards the `New Course` button; a colleague's personal course is readable only
while a review window is open; being an admin is not a window; the window
closes on the decision.

**Where and who.**

- **Part A — the WILSON desktop app**, in the mode where O.T.T.E.R. lists your
  six courses (Blender, Premiere Pro, Python, TouchDesigner, Unity 6, Unreal
  Engine 5). That is Local Server, NOT signed in to a company: signing in on
  the desktop hides the local library today (a known problem; bundle A4 fixes
  it).
- **Part B — the beta** at https://beta.petalstudios.co/wilson, two browsers:
  **Browser 1 = you (admin)**, **Browser 2 = `tester` (a plain member)**.

**Record for every step:** the exact question you typed and the pet's full
reply (copy the text; a screenshot is fine too).

**How to open the pet's chat:** press Enter on any page when no text box has
focus (Enter closes it again). The input's placeholder reads "Ask <pet name>
anything...". If your pet is still an egg it cannot chat — hatch it first, or
record that you could not.

## Part A — desktop app, your own library

1. Open O.T.T.E.R. and look at the library.
   - **Expect:** your courses are listed, Blender among them.
   - **If instead** the library is empty or shows only company courses: you
     are signed in to a company. Sign out and reopen O.T.T.E.R.; if the six
     courses still do not show, stop here and record it.
2. Go back to Home and press Enter.
   - **Expect:** the pet's chat popup opens with its input.
   - **If instead** nothing opens: record whether the pet is an egg and
     whether `Pet Mode` is on (Settings → `General`).
3. Ask: **how do I scale something in blender**
   - **Expect:** an answer drawn from your Blender course that names the
     course and the part it read (something like "that's from your Blender
     course, under Object Mode").
   - **If instead** it tells you to look it up, or answers without naming a
     course: record the full reply.
4. Ask something that exists only inside a lesson body. Open O.T.T.E.R., pick
   a subject you know, open a lesson, take one specific sentence from its
   body, then ask the pet about exactly that point.
   - **Expect:** an answer from that lesson, naming the subject and lesson.
   - **If instead** the answer is generic: record the question, the reply,
     and the subject and lesson you took the sentence from.
5. Ask about a course you do not have: **how do I set up a Nuke comp?**
   - **Expect, in this order:** (1) it says plainly it could not find this in
     your courses; (2) a BRIEF answer, two or three sentences, clearly marked
     as its own knowledge rather than a course; (3) a suggestion to make an
     O.T.T.E.R. course for it with the `New Course` button.
   - **If instead** it invents a course, refuses without the brief answer,
     leaves out the New Course suggestion, or tells you to look it up
     elsewhere: record which beat was missing and the full reply.
6. Edit a lesson, then ask about the edit. In O.T.T.E.R. open a lesson. Open
   the pet's chat and click the toggle in its header titled `Switch to Agent`
   (the input now reads "Tell <pet name> what to fix..."). Ask it to add the
   sentence "The secret word is PINEAPPLE." to that lesson. A diff appears
   with the panes `Original` and `Proposed`; click `Apply Changes`. Click
   `Switch to Chat`, then ask: **what is the secret word in <lesson name>?**
   - **Expect:** PINEAPPLE, naming the lesson. The read is live, not a
     snapshot.
   - **If instead** the pet answers from the old text: record it. If the
     agent flow itself fails, record where: no diff, `Apply Changes` did
     nothing, or an error.
   - Afterwards remove the sentence the same way, or leave it; it is your
     library.
7. Just chat: **how's your day?**
   - **Expect:** a normal reply in Tomithy's voice, no line about searching
     your courses, and no noticeable delay compared with before.
   - **If instead** it announces a search, or is noticeably slower than it
     used to be: record it.

## Part B — beta, two browsers, the consent rulings

**Setup, Browser 2 (tester):** make sure tester has a personal course with
the badge `Yours` that has NOT been shared (make one with `New Course` if
needed). Give one lesson a distinctive fact, for example "The password for the
vault is TANGERINE".

8. **Browser 1 (you, admin):** ask the pet: **what is the password for the
   vault?**
   - **Expect:** it cannot find it (the three beats from step 5). You are an
     admin, and admin is not a window.
   - **If instead** it answers TANGERINE: record it; that is a leak.
9. **Browser 2 (tester):** on that course's card open the three-dots menu →
   `Share or submit…`. In the dialog headed `Share or submit`, click
   `Put it forward`, answer "Why should this be the company's official course
   on this topic?", and submit.
   - **Expect:** "Put forward. An admin or a manager will review it."
   - **If instead:** record the error text.
10. **Browser 1 (you, admin):** ask the same question again.
    - **Expect:** TANGERINE, naming tester's course. The nomination opened a
      review window and the pet follows it.
    - **If instead** it still cannot find it: record it.
11. **Browser 1 (you, admin):** O.T.T.E.R. → `Admin` tab → under
    `Put forward as company standard` find the nomination → `Decline`, write
    a note, confirm. Then ask the question a third time.
    - **Expect:** it cannot find it again. The window closed on the decision.
    - **If instead** it still answers TANGERINE: record it.
12. **Browser 2 (tester):** ask the pet about a fact that exists only in one
    of YOUR personal, unshared courses.
    - **Expect:** it cannot find it.
    - **If instead** it answers from your course: record it; that is a leak.

## Report (paste back)

```
Walkthrough 01 — pet reads lessons — date:
Part A (desktop, Local Server)   pet name:          hatched? Y/N
1 library listed my courses: Y/N
2 chat opened with Enter: Y/N
3 Blender scaling — named the course and part? Y/N   reply:
4 lesson-body question — named subject and lesson? Y/N   reply:
5 Nuke — beat 1 (could not find) Y/N, beat 2 (brief, labelled) Y/N, beat 3 (New Course) Y/N   reply:
6 edited lesson — answered PINEAPPLE? Y/N   agent flow worked? Y/N
7 chit-chat normal and no slower: Y/N
Part B (beta)
8 admin, no window — refused? Y/N
9 nomination submitted — confirmation shown? Y/N
10 window open — answered? Y/N
11 after Decline — refused again? Y/N
12 tester vs my personal course — refused? Y/N
Anything odd (exact text):
```
