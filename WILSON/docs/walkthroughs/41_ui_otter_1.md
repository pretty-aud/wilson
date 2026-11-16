# Walkthrough 41 — A3: O.T.T.E.R., part 1

Audrey — this is the first of the two O.T.T.E.R. sessions. It did everything
you see in O.T.T.E.R. before you open a window: the strip of views along the
top, the two side columns, the course library and a course's own page, the
lesson page you read on, the form that generates a course, and the Hotkeys,
Functions, Nodes and Sources pages. It also removed the made-up progress
percentage you ruled on (Q22).

The windows O.T.T.E.R. opens — Search, Help, the settings slide-out, Import,
the delete / clear / duplicate confirmations, Share and Suggest a change — and
the Validator, Requests / Admin, Trash and the quiz are the next session's
(A4). They still look the way they did.

You asked for no questions until the end (W14), so **the questions are parked
at the bottom**. Nothing here waits on them.

(Walkthroughs 35 to 38 and 40 were taken and 39 is B2's, so this is 41.)

**What I could and could not see.** I worked against the development copy of
the app with its test data: one course ("DaVinci Resolve 19", four subjects,
all written, no outlines waiting), no node systems and no coding-language
course. Your six real courses live in the desktop app's Local Server mode,
which these sessions cannot reach. So anything about how the columns feel with
your whole library — how many courses fit, how long lesson titles wrap — is
for your pass on the packaged build, and I say so where it matters. For the
parts the test data cannot show (long headings, code, tables, node cards), the
reviewers fed the app made-up lessons and nodes and measured the result.

The screenshots are in `docs/sessions/handoffs/img/`, named
`a3-otter-<screen>-before-…` and `…-after-…`, at 1440x900 and 1280x700.

**How it was checked.** Two rounds of independent review, three reviewers
each, measured the running app at three window sizes. Everything they found
wrong is fixed. The second round re-measured the first round's fixes and
found more, mostly on the lesson page, and those are fixed too.

---

## 1. The lesson page (the one that matters most)

Open a course, then a subject, then any lesson. Compare the `lesson` pair.

- **Line length.** A line of lesson text now holds about 63 characters. It
  held about 95 (and about 112 before the type pass in September). Long lines
  are where the eye loses its place going back to the start of the next line;
  60 to 66 characters is the classic reading width. The text column is
  narrower, and that is the point.
- **One right edge.** Everything on the page stops at the same right edge:
  the path at the top (course › subject › section › lesson), the lesson's
  title, every heading, the text, the Key takeaways and Practice exercise
  boxes, and the row of buttons at the bottom. Before, the title and the
  headings ran well past the text, and the boxes ran the full width. Tables
  and code are the exception: they can use the whole column.
- **The page sits in the middle** of the space beside the lesson list, the
  same as Sources and a subject's outline page, so moving between them no
  longer jumps the text sideways.
- **Headings.** Headings are white, bold, and larger than the text under
  them; the text is a soft grey. Before, the headings were three different
  oranges and the smallest heading was the brightest thing on the page, with
  bold phrases in a fourth colour (yellow) brighter still. Now bold words are
  simply bold, in the colour of whatever they sit in: grey in the text, white
  inside a heading or a table's header row. Italic is no longer dimmer than
  the text around it.
- **The lesson's own title** is the one large line at the top. A heading
  inside a lesson that happened to be the same size as the title (so the page
  looked like it started over) is now one size smaller.
- **Key takeaways and Practice exercise** line up with the text above them
  (this was the ragged right edge from the September walkthrough). They lost
  their orange border; they are plain boxes.
- **Bullet lists** show their bullets again (they had silently lost them, so
  a list looked like indented paragraphs).
- **Code** sits in one dark well in the app's monospace font; before, a code
  block drew a cool blue-grey box, and for a moment in this session drew a
  box inside a box. Comments inside code (the `// …` lines) are now a
  readable grey; they were very faint.
- **Tables** are as wide as their contents need: a two-column list of
  shortcuts is a compact table, not stretched across the page. A table too
  wide for the column scrolls sideways inside itself instead of pushing the
  whole page sideways.
- **Very long words** (a long file path, a setting name with no spaces)
  wrap instead of running off the edge.
- **The buttons at the bottom.** "Next" is the app's main button (deep
  orange, white text). "Mark complete" no longer turns into a green button
  when done; it reads "Completed" with a green tick. On a small window they
  wrap onto two rows instead of running off the edge.
- The lesson text stays at 14px, as the September pass set it. If you want it
  larger, it is one line (question 2).

**Try:** read a long lesson top to bottom; mark a lesson complete and undo it;
step with Previous and Next; open Sources at the bottom of the lesson list and
come back.

## 2. The strip along the top

Compare the `library` pair (the strip is at the top of every O.T.T.E.R. page).

- It is now drawn exactly like R.A.B.B.I.T.'s strip: the same height, the
  same grey labels, and the current page marked by one orange underline and
  bold text — no filled orange tab.
- **Edit** and **Search** look like the others but are not pages: Edit opens
  the app's standard menu (Undo delete, Redo delete, Import subjects, Export
  all), Search opens the search window. Each keeps its underline while its
  menu or window is open, as before. Opening Search closes the Edit menu.
- **Validate** is still on the far right.

**Try:** open Edit and click Edit again (it closes); open it and press Escape;
click through every page along the strip.

## 3. The two side columns

- **Courses (left).** It has a small "COURSES" header with the hide-column
  arrow in it. "+ New" is the deep orange button. The filters (All, Made for
  me, …) are the app's standard filter chips: all seven are still there and
  still wrap. They are a little taller than before, so the course list starts
  a little lower (question 4). The chosen filter keeps its orange tint when
  you point at it.
- **Course names read as you typed them** ("DaVinci Resolve 19", not
  "DAVINCI RESOLVE 19"), in the same size as the rest of the column. The open
  course is white and bold.
- **Subjects** under a course: the open one has a soft orange wash and an
  orange edge on the left — the app's one "selected" look. Their numbers
  ("00", "01") are in the monospace font, quietly grey, and brighten when you
  point at the row so they stay readable.
- The delete button beside a subject still appears when you hover the row,
  and now also when you move to it with the Tab key (it was mouse-only). The
  outline the Tab key draws round a row is drawn inside the row now, so the
  column's edge no longer cuts it off.
- **The lesson column (right of it)** is 20px wider so lesson titles cut off
  less, and it sits on the same dark ground with a thin line between, instead
  of its own slightly different brown.
- **Hide the courses column** with the arrow or Ctrl + \\ : the arrow on the
  thin rail is at the same height as the one in the header, so it does not
  jump.

**Try:** collapse and reopen the courses column; open each filter chip; open
the "⋯" menu on a course (it is the app's standard menu now; nothing in it
changed); press Tab through the columns.

## 4. The library and a course's page

Compare the `library` and `course` pairs.

- The page titles ("Course library", the course's name) are one style across
  O.T.T.E.R. now, in white, where each page had its own orange or grey title.
  The buttons on the right sit level with the title's line.
- The cards lost their heavy offset shadow and orange hover; hovering lifts
  the card's outline instead.
- The little labels on a course (**Standard**, **Shared by you**, **From
  <name>**, **Yours**, **Private**, **Read only**) are now all the same grey
  label with their own icon. They used to be four colours, two of them blues
  and purples the app's colour rules do not allow. The icon and the word still
  tell them apart (question 3).
- "Import", "Add subject", "New course", "Generate all outlines" are the
  app's standard buttons.

## 5. The generate form

Click "+ New". Compare the `prompt` pair.

- The form's labels are the app's small capitals; the boxes are the app's
  standard fields, spaced the way every other form in the app is. The two
  "Mode" cards and the two "Who is this for?" cards mark the chosen one with
  the soft orange wash and orange edge instead of white text on orange.
- The skill level is a row of the app's filter chips.
- **When you type the name of a course your company already has**, the offer
  to start from the company's copy appears as a boxed notice inside the form,
  its icon beside its heading and all its text readable.
- **Q22 — the percentage is gone.** While a course generates, the bar no
  longer fills to a made-up percentage (it used to count up on a timer to 92
  percent whatever was actually happening). The bar stays and sweeps to say
  "working"; the step it is on ("Designing curriculum outline…") and the
  timer, which were always true, stay. An outline's own page had a bar stuck
  at 100 percent while it worked; it uses the same sweeping bar now.
- The small "Generating" list that appears while subjects generate now sits
  in the bottom-left corner of the page area, so it moves with the columns.
  It used to be pinned to a fixed spot that was only right when both columns
  were open.

## 6. Hotkeys, Functions, Nodes and Sources

Compare the `hotkeys` pair if you like.

- Each group of shortcuts is the app's standard table, so every heading now
  sits exactly over its column (Windows and Mac were 9px off). Keys look like
  key caps in the monospace font instead of orange text.
- Titles match the other pages. Function and node cards are the plain card,
  with even space above and below, and long text wraps inside them.
- **Node cards** line their inputs and outputs up in three columns (name,
  type, description), so every description in a card starts at the same
  place.
- **Node type colours are kept** (Float blue, Vector purple, …) because they
  are assumed to match Blender's own socket colours — your Q9 ruling as
  written. The coloured word is a touch lighter than the colour itself, so
  all fifteen are readable (Integer's indigo was just under the line). The
  test data has no nodes, so I could not see them in a real course; please
  look at one in your pass.

---

## Questions — parked, not asked (W14)

1. **Line length (the biggest judgement call).** The plan says "60 to 66ch".
   In the app's font, "ch" (the width of a zero) is much wider than an
   average letter, so 60–66ch actually gives 86–95 letters a line — the
   problem, not the fix. I set lessons by measured letters: about 63 a line.
   If you would rather follow the plan to the letter, it is one number. Help
   and Settings still use the old 66ch (about 95 letters); moving them is for
   the closing session.
2. **Lesson text size.** It stays at 14px (the September type pass). 16px is
   one line if you prefer it for reading.
3. **The course labels lost their colours.** Standard / Shared by you / From
   someone / Yours are one grey now, told apart by icon and word. Is that
   enough, or should Standard stand out?
4. **The filter chips.** The app's standard chip is in small capitals and is
   28px tall, so the seven chips take six rows (about 205px, up from about
   175px) above your course list. Your earlier ruling says chips should be in
   sentence case, and the shared chip is in capitals — one of the two should
   change, for every tool at once.
5. **Course names in the sidebar** are no longer in capitals. Fine?
6. **The lesson column** is 240px (was 220px), the app's standard medium
   column.
7. **Library card titles** are the app's card-title size (14px) where they
   were 20px. Too small?
8. **The progress bars** (lessons completed, and the sweeping generation bar)
   are grey, not orange: orange is kept for "selected" and "current".
9. **Links in lessons** are white and underlined rather than orange.
10. **Node colours (Q9)** are kept as written; if they do not match the host
    application's sockets, they can become one warm family.
11. **The ● / ○ marks** on the form's choice cards still draw in a Windows
    font (the app's font file does not include them — V1's open question).
12. **Two things in O.T.T.E.R. that are not this session's to change**, for
    the closing session: pressing Space with a button focused opens Search
    instead of pressing the button, and Enter toggles the pet (the app's
    Enter shortcut) rather than pressing the button.
13. **Two heading levels look the same inside a lesson.** A lesson's first
    and second heading levels are now the same size (the lesson's own title
    is the big one). A lesson that uses both cannot tell them apart. Fine,
    or should every heading inside a lesson move one size down instead?
14. **Tables at their own width.** A small table is now compact rather than
    stretched across the page. Fine?
15. **The page no longer shifts sideways** by a few pixels between a long
    page and a short one in O.T.T.E.R. (the space for the scrollbar is kept
    either way). The other tools still shift. Make it the same everywhere?
16. **The company-standard offer is read out** by a screen reader when it
    appears (the app's standard notice does that); the old one was silent.
    It appears once when the name matches, not repeatedly.
17. **Very long node type names** (none of the fifteen in the map; only an
    unusual generated one) are cut short with "…" so the other columns keep
    their place.
