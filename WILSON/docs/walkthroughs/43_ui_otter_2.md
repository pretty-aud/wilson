# Walkthrough 43 — A4: O.T.T.E.R., part 2

Audrey — this is the second and last O.T.T.E.R. session, and it closes lane A
(D.O.G. and O.T.T.E.R.). It did every window O.T.T.E.R. opens and the four
workbenches behind its tabs:

- the settings slide-out, Help, Import and Search;
- the five confirmations: delete a course, delete a subject, clear
  everything, duplicate found, and leave the quiz;
- Share or submit, and Suggest a change;
- the Validator, the Requests / Admin page and Recently deleted;
- the quiz, from the course picker to the results and the coding challenges.

You asked for no questions until the end (W14), so **the questions are parked
at the bottom**. Nothing here waits on them.

(Walkthrough 41 is A3's and 42 the Timeline's, so this is 43.)

**What I could and could not see.** I worked against the development copy of
the app with its test data. That data has one course, no change requests, no
nominations, an empty trash and no coding-language course, and its quiz needs
a call to the model. For everything the test data cannot show, the checks fed
the app made-up data in flight: a quiz answered with canned questions, a
validation with canned grades and findings, a trash with three items, and a
Requests page with one request of every kind. None of that touched your data
or called the model. The duplicate-found window cannot be opened at all (see
the questions), so it was forced open to be photographed.

The screenshots are in `docs/sessions/handoffs/img/`, named
`a4-otter-<screen>-before-…` and `…-after-…`, at 1440x900 and 1280x700.

**How it was checked.** Two rounds of independent review, three reviewers
each, measured the running app at 1440x900 and 1280x700:

- one reviewer worked every window with the keyboard and the mouse;
- one measured every surface's colours, sizes and spacing;
- one tried to break the automatic checks on purpose, making hundreds of
  small wrong edits to see which the tests caught.

Everything the first round found was fixed, and the second round re-measured
each fix with every window opened. The second round found smaller things: a
focus ring cut off at the edge of a list, a first Escape lost in Search, and
the settings rows not lining up with D.O.G.'s. Those are fixed and measured
too. It also found that the automatic checks let too much through; they now
catch every one of its wrong edits and pass every legitimate change.

---

## 1. The windows (all nine are now the app's one window)

Every O.T.T.E.R. window was its own box, with three kinds of backdrop, nine
different widths, hard offset shadows and orange titles. None of the
confirmations answered the Escape key. They are now the same window the rest
of WILSON uses:

- **One look.** A title at the top in the one ink, the content, and the
  buttons at the bottom right: Cancel first, the action last. The destructive
  actions (Move to trash, Delete subject, Clear everything) use the
  red-outline "danger" button; the others use the orange primary.
- **Four widths only.** Confirmations 400, forms 560 (Import, Share, Suggest a
  change), Help 720 (the same as D.O.G.'s Help), Search 960.
- **Escape closes the window on top, and only that one** (your Q17 ruling).
  Help opened from the settings slide-out closes on its own; the next Escape
  closes the slide-out.
- **A window that is saving cannot be closed half way** (the "busy lock",
  Q17). While a delete, a clear or a share change is talking to the server,
  its button shows a spinner, and Escape, the backdrop and a second click all
  wait. If the server refuses, the window stays open, as it always did.
- **Clicking outside** still closes the windows that closed that way before,
  and still does nothing on the three that didn't (clear everything,
  duplicate, leave the quiz). A stray click there no longer loses the
  keyboard's place.
- **The six small windows now have a ✕ in their header:** Import and the five
  confirmations. The app's window always has one. See the questions.

**The settings slide-out** is now the same panel as D.O.G.'s: the two halves
of the tab strip, the lock bar with its switch, the seven prompt editors,
Storage location and Data management. The switch now has a name, "Editable",
so a screen reader can find it. The prompt rows run edge to edge with their
names on the same line as the panel's title, as D.O.G.'s do.

**The lock is no longer a faded panel**: locked editors and buttons show the
"disabled" grey and the not-allowed cursor, as D.O.G.'s do. The panel still
clears WILSON's title bar in the desktop app. The old panel pushed itself
down 32px by hand; the new one uses the one title-bar setting every panel
shares. It measured 32px in the desktop build and 0 in the browser.

**Search** keeps its field at the top, its results on the left and the preview
on the right:

- The hotkeys preview is now the Hotkeys page's own table; before, it was a
  copy with its own colours.
- The functions and nodes previews use the same cards as their pages.
- A lesson's text shows at the lesson's reading size instead of small grey
  type.
- Matching rows stay bright and the others go quiet.
- Escape closes Search at once, even straight after using the arrow keys.

## 2. The Validator

The Validator had twelve different button styles on one page, and its two
main buttons got lighter under the pointer where every other orange button in
O.T.T.E.R. gets darker (review O12). "Validate all (17)" was white text on
orange at a size your orange rule forbids (it was a filed V1 failure). Now:

- **The page title** is the one every O.T.T.E.R. page has worn since A3
  ("Lesson validator"). It stays at the top while the lesson tree scrolls,
  with the scope picker and the Validate button beside it.
- **One primary button**: white on the darker button orange, which passes
  (5.18:1). Every button darkens under the pointer.
- **The lesson tree** is one card per course, with the rows on thin lines and
  each level indented the same step. The grey bands between levels are gone,
  and the checkboxes are the ordinary kind in the app's orange.
- **Grades** are small badges: A and B green, C amber, D and F red (review
  O24). B used to be the only blue in O.T.T.E.R. and C the brand orange. The
  big coloured square at the top of an audit is now a badge beside the
  accuracy line; this is one of the questions below.
- **Findings** are plain cards. A wrong claim has a red edge and a red badge,
  and one that cannot be checked has an amber edge and badge. The whole card
  used to be washed red or yellow.
- **Fixes** show the current and proposed text side by side, still marked red
  and green on their edges, with "Decline fix" and "Accept fix" at the bottom.
  An applied fix shows a green notice. A declined one goes quiet grey; it used
  to fade out, which made it hard to read.
- **The queue** keeps its heading above the list, so when you tab into the
  list its whole focus ring shows. Moving up the list of finished audits with
  the keyboard no longer tucks the row under the heading.

## 3. Requests / Admin, Share or submit, Suggest a change

**Requests / Admin** is now laid out like the other O.T.T.E.R. pages, with the
same title and the same reading width. Each request is a card with its status
as a small badge. The statuses use the same five words and colours as the
Admin Terminal's Requests page:

- **Open** in the brand orange (it is waiting on an admin);
- **Changes requested** in amber (waiting on the person who asked);
- **Approved** in green, **Rejected** in red and **Withdrawn** in grey.

The page used to have its own five colours that existed nowhere else in
WILSON (review O24).

The buttons are the app's:

- Approve, "Archive, then apply", "Make it the standard" and "Send it back"
  are the orange primary. Some were green, and "Send it back" was a lighter
  orange.
- Cancel and Decline are the plain kind.
- The empty-list lines were grey italic you could barely read; they are plain
  and readable.
- The notices at the top (applied, promoted, errors) are the app's banners,
  and a screen reader now reads them out.

**Share or submit** keeps its three sections as three cards in the app's
window: who can see the course, who can edit it, and putting it forward as
the company standard.

- The three visibility options use the same option card as the "New course"
  form (A3), with the chosen one tinted orange.
- Adding an editor uses the app's dropdown and button. Removing one uses a
  named bin icon.

**Suggest a change** is the same window at the same width (560), with its
buttons where they were: Withdraw or Accept the decision on the left, Close
and the send button on the right. If a request fails, the message now appears
at the bottom of the window, on a line of its own above those buttons.

## 4. Recently deleted

The page and the list in the left column are both redone:

- The page wears the same title as the other pages.
- Its cards sit on the library's grid and keep their dashed edge, because a
  deleted thing should not look live.
- Each card shows the days left in grey, turning red in the last week.
- **Restore** is the orange primary button. Before, it was white on bright
  orange at a size your rule forbids.

## 5. The quiz

**Choosing what to quiz** is laid out like the "New course" form:

- the page title, "Quiz center";
- a card for each course, with its subjects under it;
- a "Quiz type" card holding the question types as the same small toggle
  chips the skill level uses;
- then the Generate button.

A chosen course or subject is tinted orange instead of filled. **The course
and subject rows can now be reached with the keyboard**; they were click-only
before (one of the questions below).

**The quiz itself:**

- the question sets are the app's tabs;
- the difficulty is a small badge: easy green, medium amber, hard red;
- the answers are cards that tint orange when you pick one, and turn green
  or red when the answer shows;
- code sits in the same dark well the lessons use.

The results keep their green / amber / red score. The coding challenge's
hints, "Show solution" (with its "are you sure?") and Previous / Next are the
app's buttons.

## 6. What was checked

- **Every screen the automatic walk can open** (20 O.T.T.E.R. screens,
  including five new ones for Help, the delete confirmations, Share and
  Recently deleted) is clean at both sizes:
  - no errors, overflow or off-scale type;
  - no unnamed control;
  - no text on orange below the size your rule allows;
  - no colour pair under the reading minimum, except the Help pages' own
    prose (see the questions).
- **The states the walk cannot reach** were measured with the made-up data
  above, all clean: the quiz questions and results, the coding challenges,
  the Validator's results and fixes, Requests with one of everything, and a
  full trash.
- **The keyboard and the pointer.** Every window was worked both ways:
  - Tab order and Escape;
  - the busy lock, and the error paths (the test data refuses writes, which
    is how every failure message was seen);
  - where focus goes when a window closes;
  - what the pointer does on every button.
- **Your rules, re-measured by the second review at both sizes:**
  - no text on orange below 19px bold, except the button orange, which
    passes;
  - one type scale, with nothing under 11px;
  - no white surfaces;
  - sentence case outside the small labels;
  - the title bar.
- **The pets and the page transition** were not touched.

## Questions for your final pass (W14)

A3's eighteen questions (walkthrough 41) are still open. These are A4's:

1. **The confirmations' buttons** moved to the bottom right, Cancel first and
   the action last, where they used to be two equal halves of a row. This is
   the app's one window. Do the halves read better?
2. **Four widths.** Help 720 (it was 850; D.O.G.'s is 720), Import 560 (480),
   Search 960 (900), Share 560 (520), and the confirmations 400.
3. **Escape and the busy lock on every O.T.T.E.R. window** (as you ruled in
   Q17). Suggest a change's Close now also waits while a request is sending.
4. **The settings slide-out's title** is the small uppercase "SETTINGS", as
   D.O.G.'s is, not the orange heading. It is still 40% of the window wide.
5. **Grades are small badges** instead of the coloured square, with B green
   and C amber (it was blue and orange).
6. **A wrong finding shows its colour on the card's edge**, not across the
   whole card.
7. **Request statuses use the Admin Terminal's colours**: "Open" is orange
   (it was amber), and "Changes requested" is amber.
8. **Errors in Share and Suggest a change** appear at the bottom of the
   window, not in a red box in the middle.
9. **Three controls the keyboard can now reach:** Import's "Choose file" and
   the quiz's course and subject rows. The same click does the same thing.
10. **The quiz's "some subjects chosen" box** shows a dash where it showed a
    paler tick.
11. **Restore** in Recently deleted is the darker button orange, which passes
    your rule; before, it was white on bright orange.
12. **The Search field shows its focus ring**, because it has focus whenever
    Search opens.
13. **The Validator's lesson tree** steps 20px a level. A lesson's row steps
    22px so its name sits under its section's.
14. **The duplicate-found window can never open:** nothing in the app asks
    for it. It is restyled anyway. Delete it, or have the import use it?
15. **"Import failed: …" is still the browser's own alert box.** Your W9 rule
    named the confirm boxes only. Should it become the app's window too?
16. **The ●/○ marks in Share's visibility options** draw in the system font
    (the same open question as the prompt form's cards, V1).
17. **The six small windows now have a ✕** in their header: Import and the
    five confirmations. The app's window always shows one. Keep it?
18. **Space and Enter cannot press a focused button in O.T.T.E.R.** Space
    opens Search, and Enter is taken by the pet's shortcut. Everything the
    keyboard can reach is still pressed with the mouse until the closing
    session rules on those two keys.
19. **The home page's arrow and Enter keys work on every page.** In
    O.T.T.E.R.'s Search they could take you to D.O.G. or R.A.B.B.I.T. That is
    the closing session's too.
