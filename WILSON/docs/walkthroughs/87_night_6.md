# 87 — NIGHT 6

One file for the night (`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one
section per session: **D2** (the desktop's two fixes before 1.0, and the
migration report's list of actuals left without their invoice). Each section
stands on its own; answer its questions by their numbers.

## D2 — A dropped file stays outside, a sleep is judged, the report names the actuals left without their invoice

Your ruling of 2026-10-29, *"2. a"*: everything open in walkthroughs 85 and
86 takes its recommended answer. For this session that meant walkthrough
85's D1 Q1 and Q2, both *before 1.0*, and M2 Q3, *yes, list them*. M2 Q2 is
settled in words, nothing built: **a project you delete in the cloud stays
deleted**, and there is no *Carry everything again* in 1.0. Measured first,
designed, the design reviewed on Fable (nothing in it needed you), built,
reviewed twice more.

1. **WILSON's window shows WILSON and nothing else.** If anything tries to
   send the window to another page — a link, a script, a dropped file — it
   is refused. A link to a website opens in your own browser instead, as
   links always did. The print window and the receipt and invoice windows
   still open.
2. **A correction to walkthrough 85.** It said a file dropped outside Bins
   opened as a page inside WILSON. That was worked out from the code, not
   seen: tested properly tonight, a dropped file never left WILSON's page,
   even before this fix (the desktop's own setting already refused it). What
   could leave the page, taking your saved sign-in and the local key with
   it, was the window being sent to another website by a link or a script.
   No link in WILSON does that today, so it needed something to have gone
   wrong first; it is closed all the same, and the dropped-file case now has
   two locks of its own.
3. **A sleep is judged before the first key counts.** If the computer
   sleeps with WILSON open and you come back more than 30 minutes later, the
   first key or click signs you out with the usual line, instead of carrying
   on. Same on the web. Nothing else about the half hour or the four hours
   changes.
4. **The migration report names the actuals whose invoice stayed behind.**
   An invoice attached the old way (a file's place on one computer) still
   cannot travel. The report now lists each actual that arrives in the cloud
   without its invoice, the way the budget names it: the project, the tab,
   the person or line, and the period. It never shows the file's name or
   where it was. Once you attach the invoice again in the browser, the next
   run stops listing that actual.

### What to do on the desktop

1. Sign in. Open **R.A.B.B.I.T.** → a project's **Timeline** (or Home).
   Drag any file from File Explorer onto the window and let go. **Nothing
   happens**: the cursor shows a "no" sign while you hold it, and WILSON
   stays as it was.
2. Open the project's **Bins** and drop a file there: it is added to the
   bin, as before.
3. Open **Budget** → **Client view** → **Print**: the print window opens.
   Open an expense's receipt: it opens in its own window, as before.
4. **The sleep.** With WILSON open and in front, put the computer to sleep
   (Start → Power → Sleep) and leave it for **more than 30 minutes**. Wake
   it and press any key or click in WILSON. You are signed out, and the
   sign-in screen says *Signed out after 30 minutes without activity.* If
   you cannot wait that long: the tests show it for 31 minutes and for two
   hours asleep (signed out) and for 29 minutes (still signed in), and the
   same before the fix carried on.

### What you see in the migration report

On the desktop, on a project with an actual whose invoice was attached the
old way: Settings → Storage → *Migrate to cloud* → **Dry-run**. Under the
line that begins *Stays on this computer (the migration does not carry
it)*, which counts the invoice, a new line reads:

> *1 actual arrives in the cloud without its invoice (attached by a path on
> this computer, which the migration does not carry): attach it again in the
> browser, on the project's Budget.*

and below it, for example, *Salt Hours · Crew/team · Jonah Beck / P2
10/19*. In the browser: open that project's **Budget** → **Crew/team**, find
the row (Jonah Beck) and the period column (P2 10/19), click the cell and
attach the invoice. Run the migration again: that actual is no longer
listed. An actual whose line you removed on the desktop is not listed,
because it does not go to the cloud.

### How it was checked

The desktop app was driven off-screen with a scratch folder and a made-up
sign-in (nothing signed in anywhere). Before the fix, a page that sent the
window to another website landed there, and that page could read the saved
sign-in and the local key; after it, the window stayed on WILSON and the
address went to the browser instead (stood in, so nothing really opened).
With the desktop's drop setting deliberately switched on, each of the two
new locks kept the page on its own. The print and receipt windows open and
show their contents. The tests: 425 files, 10,814 passing; every new test
was shown to fail on purpose against the old code.

### What is left as it is

- **The report names clips left behind by their names** (OUTSTANDING D2-01):
  a clip's name is its file's name. Asked below.
- **A second layer for the sign-in bridge** (OUTSTANDING D2-02): WILSON
  could also make the bridge refuse any page but its own. With the window
  locked to its own page this is a spare lock, not a gap. Asked below.
- **The operator console** (`/wilsonadmin`, in a browser) does not swallow a
  dropped file: it opens in the tab, as on any website. It holds no saved
  sign-in bridge. Left as it is.

### Questions

**Q1. The clips' names in the migration report.** When the migration
leaves clips behind (their footage location not named yet), the report lists
each clip by its name, which is its file's name, so you know which footage
to locate. Your rule is that a file's name is content; it stays on your own
screen, in no record and no log.

- (a) **Keep listing the clips by name: you need it to find the footage,
  and it never leaves your screen (Recommended).**
- (b) List only how many clips stayed behind, with no names: you would look
  them up in Bins yourself.

**Q2. A spare lock on the sign-in bridge.** WILSON's window now only ever
shows WILSON, which closes the gap. As a second lock, the bridge that hands
WILSON its saved sign-in could also refuse any page that is not WILSON's
own, so a future mistake in the first lock would still not hand anything
over.

- (a) **After 1.0, as its own small piece of work (Recommended).**
- (b) Before 1.0, as one more session.
