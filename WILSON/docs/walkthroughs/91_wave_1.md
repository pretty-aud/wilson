# 91 — WAVE 1 (the week of 2026-11-04)

One file for the wave (`docs/sessions/PLAN_WEEK_2026-11-04.md`;
`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one section per session: **F1**
(the operator console's company list, and a type check in CI) and **F3** (the
desktop's project file). Each section stands on its own; answer its questions
by their numbers.

## F1 — The operator console's company list, and a type check in CI

Your ruling of 2026-10-31 on the code review's REV-01: *"Record it, fix at the
release steps"*. Fixed, checked in CI, and reviewed twice on Opus (your Fable
allowance was used up, and you chose Opus). It reaches the beta only when the
controller deploys the function to dev and staging, on your go.

1. **After that deploy, the operator console's Companies tab lists your
   companies again** (on the beta, `/wilsonadmin`, signed in as the
   operator). Since 2026-10-28 it has shown an error instead of the list; by
   the code that error reads *"Network error — check your connection."*,
   though your connection is fine. The same fix makes a company's teardown
   keep its full record of abandoned uploads again (in the Audit tab); since
   2026-10-28 that record held only the run's own and was marked cut short.
   Nothing else on the console changes.
2. **Nothing to answer.** Every push now type-checks every Edge Function, so a
   function that uses a name it never brought in (this one) turns CI red as
   soon as it is pushed (CI cannot stop a deploy by itself; the controller
   reads it first). The check also found 28 older typing slips, in seven
   functions and three shared files, that break nothing; they are written
   down (`docs/OUTSTANDING.md` F1-01) and counted, so CI fails if one is
   added.

## F3 — The desktop's project file: kept in memory, saved whole

From the code review of 2026-10-31 (its REV-06 and REV-07). Measured on the
desktop app with the test project *Salt Hours* before and after, the design
checked once and the build reviewed twice, on Opus (your answer of
2026-10-31, *"Use Opus for reviews (Recommended)"*, when Fable's allowance had
run out). Nothing in how WILSON looks changes.

1. **The desktop no longer reads a project's whole file on every click.** On
   the desktop without the cloud (your own computer, or a demo folder), each
   project is one file. Every R.A.B.B.I.T. request used to read that whole
   file from the disk and check it over; one picture in a gallery read the
   whole project to find it. Now the desktop keeps the file in memory after
   the first read and only checks that nothing changed it on the disk; when
   something did (you edited it, or copied a folder over it), it reads it
   again.
2. **A project can no longer drop out of the list after a crash.** Saving
   used to write straight over the file, so a crash half-way left half a
   file, which the app read as nothing, and the project vanished from the
   Projects list. Now every save writes a whole new copy and swaps it in,
   trying again for a moment while Windows (an antivirus or the indexer)
   holds the file. The same for everything else the desktop saves: courses,
   rate cards, team, settings, the demo folder's own files.
3. **Opening O.T.T.E.R. no longer rewrites your lessons.** Listing a course's
   subjects rewrote every subject file each time (at launch, and again for
   the quiz picker); now it only reads them. The order you see is the same:
   it is kept when a subject is added, changed or removed instead. A lesson
   file that cannot be read is listed by its name and never written over
   (before, it could be overwritten with a blank).
4. **The readable copies in each project's `_DATABASES` folder** are written
   only when what they hold changes: editing a task rewrites two of the six
   files, not all six.
5. **What it measured** (the test project in the desktop app, each request 15
   times, before → after):

   | | Disk calls | Read from disk | Written | Time |
   |---|---|---|---|---|
   | Editing a task | 22 → 17 | 379 KB → none | 648 KB → 472 KB | 9.8 → 10.0 ms |
   | One picture in a gallery | 18 → 12 | 379 KB → none | none | 5.0 → 3.7 ms |
   | The Projects list | 14 → 8 | 379 KB → none | none | 4.2 → 3.1 ms |
   | A course's six subjects | 19 → 10 | 18 KB | 18 KB → none | 4.4 → 2.5 ms |

   An edit takes the same time as before: writing a whole new copy and
   swapping it in costs a little more than writing over the file, and that
   is what makes a crash safe. Everything that only reads is quicker.
6. **To try** (the desktop, signed out, with your own projects or a demo
   folder): edit a task, close WILSON and open it again: the edit is there.
   Open O.T.T.E.R.: each course's subjects are in the same order as before.
   Make a subject from a prompt: it takes its place in the course, not the
   end.

**Q1.** In a demo folder, the pictures R.A.B.B.I.T. makes for assets, scenes
and shots do not show: the desktop answers an error for them (measured for a
picture already made, before this change and after; a new one fails the same
way, by reading the code). It is one setting on six places in the code. (a)
Fix it with the planned clean-up of how the desktop sends files, in wave 3
(Recommended). (b) Fix it sooner, in a small session of its own.
