# Walkthrough 29 — Settings: the four confirmations, and shorter bars

UI overhaul bundle D1b, the follow-up to walkthrough 22. Branch
`ui/d1b-confirms-bars`, merged into `feat/ui-overhaul`. Nothing here reaches
the beta: `feat/multi-user-v1` is untouched.

**To look at it yourself**

```bash
git checkout feat/ui-overhaul && git pull --ff-only
```

then `cd WILSON && npm run dev` and open `/settings` (Teams and Storage tabs),
`/help` and `/team-members`. If you would rather just look, the screenshots are
in `docs/sessions/handoffs/img/ui-d1b-*.png`: before and after for Settings and
Help at both window sizes, after for Team Members (F2's
`ui-f2-after-team-members-*.png` are its before), one of each of the four new
confirmation dialogs, and one of the reset dialog in its locked, working state.

---

## What you ruled, and where it landed

> *W9 — "convert"* the four native confirm pop-ups on Settings.
> *W10 — "if already said yes then yes"* to the shorter bars.

Both are done. Two rulings, two changes, one commit plus two rounds of review
fixes.

---

## 1. The four confirmations are WILSON's own dialog now

These four used the operating system's grey box: removing a department,
disconnecting Google Drive, closing the demo folder, resetting the demo folder.
They are the same dark dialog that "Reset pet history" and "New pet" already
use on this page, at the same 400px width.

**What is the same.** The words. Every sentence is the old sentence, verbatim:
*Remove department "QA"?* — *Disconnect Google Drive? Cached tokens are removed
from this machine.* — *Close the demo folder "Friday"? Nothing is deleted.
WILSON goes back to the projects in this computer's app data until you open a
folder again.* — and the reset text that names the folder and both subtrees it
deletes. And the outcome: Cancel does nothing, the action button does exactly
what OK did.

**What is new, and only this.** Escape closes the dialog (the OS box had that
too, so nothing lost). While the action runs — closing or resetting a folder,
clearing the Drive tokens — the dialog locks: Cancel, the action button and the
X all disable until the desktop answers, so you cannot click twice. The mouse
cannot reach anything behind the dialog, and on the Storage tab the card
underneath is switched off for the keyboard as well while its dialog is up;
the rest of the page behind a dialog is still reachable with the Tab key, which
is the one gap left (see "Three things I did not do"). If closing or resetting
fails, the reason appears in the dialog's footer, where you are looking; when
you dismiss the dialog the card shows it too, as it did before.

**Two of the four are red.** The action button is the filled orange for
"Disconnect" and "Close folder" (nothing is lost; the Drive reconnects, the
folder reopens) and the red outline for "Remove" and "Reset folder" (a
department is gone; two folders are deleted). That is the same rule the pet
dialogs use: red when it cannot be undone.

The dialog is dark on purpose. It floats over its own backdrop, so the
white-on-dark ink is the readable choice there even though the page behind it
is orange; walkthrough 22 §8 explains the same decision for the pet dialogs.

## 2. The orange bars on Settings, Help and Team Members are shorter

They were 200px over 150px on Settings and Team Members, and 140 over 100 on
Help, the one page that was different for no reason. All three are **120 over
80** now, measured in the browser and from the screenshots. On your 14-inch
window (900px tall) that is 150px more room for the page; in a browser on the
same machine (about 860px tall) it is 120px; at the smallest window the app
allows (700px tall) the bars give way in proportion, to 96 over 64, the same
total the old bars collapsed to, so the page never loses room it had before.

**One thing you may see on the General tab because of this.** The "Change
password" block was always there, but on a 900px-tall window the old bars
pushed it below the fold of the tab's own scroll area, so the page looked as if
it ended at the version line. The shorter bars move that fold 150px. In the
screenshots (taken signed out, where the block is two lines) it is on screen
without scrolling from about 850px tall; signed in to your workspace the block
is the full change-password form, which is taller, so on your 900px window you
will still scroll to it, 150px less than before.

**Home is untouched** at 268/268: it is not a resource page, and its six
buttons need the room. **The five data pages** — Projects, Rate Card, Files,
Dashboard, Admin Terminal — are still at 200/150 for now: each moves in the
commit that converts that page onto the dark ground (lane C), so it changes
once, not twice.

Two things move with the bars. **The pet** sits on the bottom bar, so it now
sits 70px lower on Settings and Team Members and 20px lower on Help. That is
expected (plan Q12) and it is the same pet; nothing about it changed. And the
page transition's bars travel a little further on these three pages in the
same 600ms, because they open to a shorter rest; the timing is untouched (C2).

---

## Three things I did not do

- **I did not touch the other native confirms** elsewhere in the app: about
  twenty calls across fifteen files still use the OS box. Your W9 ruling
  extends to all of them, and each lane converts its own as it passes; this
  session's four were the Settings ones.
- **I did not give the dialog a focus trap.** Q17 said Escape, the stack and
  the busy lock "and nothing else", so the shared dialog still lets a keyboard
  user Tab to the page behind it: on Settings that reaches the tab bar and the
  storage-backend switch, and pressing Enter there acts while the dialog is
  still open. The mouse is blocked everywhere; this is keyboard only. On the
  Storage card itself it is closed off; on the Teams tab the department dialog
  lives inside its row and cannot do the same. The proper fix is one change in
  the shared dialog for every dialog in the app, and it is your call because
  of Q17 — see "What I need from you".
- **I did not change the words on the buttons beyond naming the action.** The
  OS box only had OK and Cancel; the dialogs say "Remove", "Disconnect", "Close
  folder", "Reset folder". If you would rather they said something else, it is
  one word each.

---

## What I need from you

1. **Walk the Storage tab in the packaged build.** In the browser there is no
   desktop bridge, so the three Storage confirmations were photographed with a
   stand-in bridge that answers like the real one. What I could not see: a
   real close and a real reset, with the window reload that follows, and what
   a real failure message looks like in the footer.
2. **The bar heights, in the app, on your own screens.** 1440x900 and 1280x700
   are in the screenshots; 125% and 150% Windows scaling are yours.
3. **Should every dialog trap focus?** Today a keyboard user can Tab behind
   any WILSON dialog (the pet ones, Team Members' invite, Bins' dialogs, these
   four). Q17 ruled the dialog minimal, so adding a trap is your decision; if
   yes, it is one change in the shared dialog and every caller gets it.
4. **One colour question.** On the Storage card the "Disconnect" button is
   red-outlined, but the confirmation it opens has an orange "Disconnect"
   (because disconnecting is undone by reconnecting). Say if you would rather
   both were red, or both orange; it is one word.
5. **The button words** (above) — say if any should change.

## Known rough edges

- **The two Profile-tab panels** walkthrough 22 mentions (the workspace
  switcher and the two-factor block) are still D2's; nothing here changed
  them.
- **The `.s-data` mono class is light-page ink**, so a path inside a dark
  dialog cannot use it. The reset dialog shows its two paths in the dialog's
  own ink instead of the card's monospace; the words are the same.
- **Toasts** anchor 24px off the window bottom, not off the bar, so a stack
  of two now straddles the bar's top edge on these three pages (one toast
  still sits inside it). Nothing is hidden; it is a note for the session that
  unifies the toast systems.
