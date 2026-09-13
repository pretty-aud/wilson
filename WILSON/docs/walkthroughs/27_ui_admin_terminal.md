# 27 — Admin Terminal (UI overhaul, lane C, sessions C3 and C3b)

**Status: part one of two.** This session landed the groundwork and two real
fixes. The visual conversion — the part you will actually recognise as "the
overhaul" — is the next session's, and this file says exactly where the line
is so you are not looking for something that is not there yet.

Branch `ui/c3-admin`, integrated into `feat/ui-overhaul`.

---

## What to look at

Sign in, open **RESOURCES → Admin terminal** (it only appears if you are a
workspace admin).

### 1. The page has about 190px more room

The orange bars above and below this page were 200px and 150px. They are now
120 and 80, the same as Projects, Rate card, Dashboard, Team members, App
settings and Help. This was the last page in the app still on the old pair.

It matters most here because this is the only light page that runs two
scrolling tables and a 360px side panel at once. Before, on a 900px-tall
window, the roster and its toolbar shared about 348px between them — roughly
eight rows — while the Logs section fetches a hundred events. You should now
see roughly twice as many rows before scrolling, on both Users and Logs.

The bars still animate exactly as they did. Only the resting heights changed.

### 2. Two lines of text that have never been visible

Click **ADD PEOPLE**. The menu has two items, and under each one there is now
a grey line of explanation:

- Invite by email… — *They set their own password*
- Create with password… — *You hand over the credentials*

Those two lines have been in the code since the menu shipped, painted black
on a black panel. Measured contrast 1.00:1 — literally invisible, and not
much better on hover. They are now 8.49:1.

They are the only thing that tells the two ways of adding a person apart, so
please read them and tell me if either is wrong or misleading. They have
never been reviewed by anyone, because nobody has ever seen them.

### 3. Everything else should look **identical**

> Part one only. Part two below is the session that changed how the page
> looks, so this section describes what was true in September's first pass,
> not what is on your screen now.

This is the part worth checking carefully, because it is the claim most
likely to be wrong. The largest commit here moved every hover, selected,
active, disabled and confirmation state out of the JavaScript and into a
stylesheet, without changing a single value. If it was done correctly you
cannot tell it happened.

So the ask is the opposite of the usual one: **please try to find something
that stopped working.** In particular:

- Click along the seven left-nav items. The orange bar and tint should follow
  your selection, and the label should not shift by a pixel as it does.
- On **Users**: hover a row, click a row to open the side panel, click a
  different row, use the All / Active / Deactivated filter, toggle the two
  rate-card switches in the panel, press Escape to close it.
- On **Logs**: switch System / Activity, hover a row, click a row to expand
  its JSON block, use both filter dropdowns, press Refresh.
- On **Requests**: switch the tabs and check the count beside "Open".
- On **Company**: press the copy button beside the Workspace ID — it should
  flash green — and remove a department chip.
- On **Storage**: click between the two storage modes and the two providers.
  The chosen one takes an orange edge and an orange icon.
- On **Models**: a row the company has overridden carries a faint orange
  wash. Set one and reset it.
- On **Diagnostics**: press Copy diagnostics; the tick should flash green.

Anything that used to light up and now does not is a bug I introduced, and I
want to know about it.

---

## What was deliberately NOT done in part one

(Part two below is that list, done.)

Everything in the screenshots still looks the way it always has, and that is
expected. Still to come in the next session:

- the page moves onto the dark ground, like Files, Projects, Rate card,
  Dashboard and Team members already have
- the page title stops being drawn twice
- one type scale instead of nine sizes, sentence case instead of 91
  UPPERCASE runs, and the 9px and 10px text goes
- the four tables become the one shared table, with column widths that hold
- the four dialogs become the one shared dialog
- one button instead of nine hand-written copies of the same button
- the toolbar rows get one control height instead of three
- error and success messages become one component each, legible instead of
  the current 2.1:1

---

## Screenshots

`docs/sessions/handoffs/img/c3-before-admin-terminal-1440x900.png` and
`…-1280x700.png` are the "before" reference, captured after the bar change so
the only difference from the next set will be the conversion itself.

## Nothing is asked of you here

No decision is waiting on you for this session. If you have five minutes, the
two things genuinely worth your eyes are the ADD PEOPLE menu copy (§2) and
anything in §3 that stopped responding.

---

# Part two — the conversion (session C3b, 2026-09-12)

The list above said what was still to come. This is that, done. The Admin
terminal now looks like Team members, Files, Projects, Rate card and the
Dashboard, because it is built out of the same pieces they are.

## The one change you will notice first

**The page is dark.** It was the last of the six data pages still on the
orange ground. Home, App settings and Help stay orange — those are for
reading and filling in forms, where one ink is enough. The six pages that
hold tables and status and live data are on the same dark surface the three
tools use, which is the split you approved as Option A.

The orange frame is untouched. The page transition is untouched.

## What else moved

- **The title is drawn once.** It was in the orange bar and again in black
  twenty pixels below it. Only the bar keeps it.
- **More of the page is page.** The last session gave back the height, by
  shrinking the orange bars. This one gives back the rest: the duplicate
  title and its icon are gone, and the page's own margin, which sat inside
  the one the app already applies, is gone with it. Three separate margins
  used to stack between the window edge and the first row; now there is one.
- **All seven sections now open with a heading.** Five of them had none at
  all, and the two that did disagreed about what size a heading is.
- **The left strip is grouped.** Two faint dividing lines split the seven
  items into people, the company's settings, and what the system is doing.
  Nothing is hidden and nothing moved: all seven are still one click away.
- **The four tables are one table.** Same columns, same order, same data —
  but the columns now have declared widths, so the header and the rows line
  up and a long name no longer shoves the grid sideways. The error-code list
  in Diagnostics finally has a header row saying what its two columns are.
- **The four pop-ups are one pop-up.** The credentials hand-off, create user,
  invite by email, and the confirm boxes. They all trap focus now, which
  means Tab stays inside the dialog instead of wandering behind it, and when
  you close one your place on the page comes back.
- **Nine different hand-made buttons became one button**, so a Cancel is the
  same size and shape wherever you meet it.
- **Error messages are legible.** They were dark red on a pale red patch on
  orange, which measured about 2.1 to 1 — under half what is readable. You
  can see that in the "before" Logs screenshot; compare it with the "after".

## The one thing that behaves differently, and why

The **credentials pop-up** — the show-once screen with a new password on it —
used to have no X and no way out with the Escape key. That was deliberate: it
made you click the same button twice if you tried to leave without copying
anything.

It now has an X and answers Escape, because every dialog in WILSON does since
you said yes to that. **The two-step gate still holds on all three of them.**
Until you have copied the password, the X, Escape and the button all do the
same thing: ask "Close without copying?" once, and only leave if you do it
again within three seconds.

The gate is keyed to the **password** specifically, which matters more than it
sounds. For a few hours during this session it opened as soon as you copied
*anything* — and the username is the top row, so copying it first and pressing
Escape once lost the password for good. That is fixed, and there are now three
tests whose only job is to keep it fixed.

Everything else does exactly what it did.

## What is still on the old type

The **Storage** section and **Change requests** are owned by two of the paused
branches, so this session was only allowed to change their colours and swap
in shared components — not to rewrite their layout. Their headings and body
text are on the new colours but still on their old sizes, and Storage's card
titles are still capitals. That is the last thing the next session picks up.

## Screenshots

Side by side, at both window sizes:

| | Before | After |
|---|---|---|
| Users | `img/c3-before-admin-terminal-1440x900.png` | `img/c3b-after-admin-terminal-1440x900.png` |
| Storage | `img/c3-before-storage-1440x900.png` | `img/c3b-after-storage-1440x900.png` |
| Logs | `img/c3-before-logs-1440x900.png` | `img/c3b-after-logs-1440x900.png` |
| Change requests | `img/c3-before-requests-1440x900.png` | `img/c3b-after-requests-1440x900.png` |

The `1280x700` pair of each is beside it, which is the smallest window the app
allows.

🚨 **The people in these pictures are not real.** The screenshots were taken
with the dev fixture switched on, so the roster is eight invented members.
Logs and Storage show a permission refusal rather than data, because the
fixture signs in without a real admin session — that refusal is genuine, and
it is also the clearest before-and-after for the error-message change.

## Two things worth your eyes, if you have ten minutes

1. **The Users roster.** Click a row, then another. Exactly one row should be
   marked at a time, and a deactivated member should read as quieter rather
   than faded out. This is the one thing that was actually broken mid-session
   — every row was drawing itself as selected — so it is the thing most worth
   a second pair of eyes.
2. **The credentials pop-up**, with a throwaway user. It is show-once: once
   it closes there is no way to open it again and look at it, so if the
   two-step gate feels wrong, that is the moment to say so.

## Still nothing is asked of you

No decision is waiting. The two questions from part one are still open and
still not blocking: whether the ADD PEOPLE menu wording is right now that it
is visible, and whether anything on the seven sections stopped responding.

---

# Part three — the type pass finished (session C3c, 2026-09-13)

Part two ended with a caveat. It said:

> The **Storage** section and **Change requests** are owned by two of the
> paused branches, so this session was only allowed to change their colours
> and swap in shared components — not to rewrite their layout. Their headings
> and body text are on the new colours but still on their old sizes, and
> Storage's card titles are still capitals.

That is done. **There is no caveat left.** The Admin terminal is now built out
of the same pieces as Team members, Files, Projects, Rate card and the
Dashboard, and it is also now *set* the same way they are.

## What you will notice

**Storage stopped shouting.** Every card on it used to open with a heading in
small bold capitals — STORAGE MODE, WHAT YOU OWN, PETAL CLOUD PLAN, STORAGE
ROOT, BUCKET — and so did the two names inside each picker, PETAL CLOUD and
YOUR OWN STORAGE. All seven are ordinary sentence case now, and bigger. The
only capitals left on the whole section are the five field labels above the
bucket form (ENDPOINT, REGION, BUCKET, PREFIX, ACCESS KEY ID), which is the
one job capitals have here: naming the box underneath them.

**And it got readable.** The explanations — what each storage mode means, what
happens when you change a bucket, why deleting files does not free space
straight away — were all at the *smallest size in the app*, the one meant for
column headers. There were 52 of them. They are two steps larger now, which is
the same size the rest of WILSON uses for a sentence. Nothing was reworded;
the words are just no longer in the small print.

Compare `img/c3b-after-storage-1440x900.png` with
`img/c3c-after-storage-1440x900.png` — same page, same data, same day apart.

**Change requests reads as a list of requests.** Each row's course name is now
a title rather than another line of body text, the proposer and date under it
have stepped back to the size WILSON uses for timestamps everywhere, and the
proposal itself — the paragraph the person wrote explaining what they changed
— is at reading size instead of label size. The status word on the right
(OPEN, APPROVED, CHANGES REQUESTED) keeps its capitals, because that is a
badge and badges are where capitals belong.

**Twelve icons were the wrong size and nobody could have seen why.** Eleven
were 12px and one was 10px, against a house rule of three sizes — 14, 16, 24.
They sat inside buttons that had *already* been told to draw their icons at
14px; the instruction on the icon itself was simply winning. They are all
14px now, which is why the Refresh, Approve and Decline buttons look slightly
less cramped than they did.

**And two buttons finally match the ones beside them.** The Cancel next to
"Continue" and the one next to "Set folder", in the two-step warning you get
when you point storage at a folder on your own computer, were the last two
hand-made buttons in the console. They are the shared button now, at the same
height and in the same case as the button they sit next to.

## One thing that went wrong mid-session, and how it was caught

Making the explanations bigger made the picker titles above them *smaller than
the text they were titling* — "Petal cloud" at label size sitting on top of a
full-size sentence. Every test stayed green, because each change was correct
on its own line; it was only wrong as a pair. It was found by opening the page
and looking at it, and it is fixed: the picker titles are card titles now,
same treatment as the five card headings around them.

That is the second time on this page that the only thing which found a real
defect was looking at it. Worth knowing.

## What is still not done here, and why

- **The S3 card is still one long card.** The plan wants it in three labelled
  blocks — Connection, Credentials, Verify. That moves things around on the
  page rather than restyling them, and this section belongs to a branch that
  has thirty-seven commits of unmerged work sitting on it. It waits for that
  merge.
- **One small misalignment on that same card.** "PREFIX (optional folder
  inside the bucket)" is too long for its column, so it wraps onto two lines
  and its box sits about fifteen pixels lower than Region's and Bucket's. That
  was true before this session too — it is not new — and straightening it
  means moving the label, which is the same blocked change as above.

## Screenshots

| | Before (C3b) | After (C3c) |
|---|---|---|
| Storage | `img/c3b-after-storage-1440x900.png` | `img/c3c-after-storage-1440x900.png` |
| Change requests | `img/c3b-after-requests-1440x900.png` | `img/c3c-after-requests-1440x900.png` |

The `1280x700` pair of each is beside it, which is the smallest window the app
allows.

🚨 **The Change requests pair shows an empty page, and you should know that
before you open it.** Nobody has ever filed a change request in the dev
fixture, so both the before and the after show "Nothing waiting on you" — the
only difference visible in that pair is the Refresh button's icon, which you
would have to zoom in to see. Everything this session did to that section
happens on a *row*, and there are no rows.

So there is a third image: `img/c3c-after-requests-seeded-1440x900.png`, with
four invented requests put into the page by hand so the work can be looked at.
**None of it is real** — not the courses, not the people, not the dates. It
exists only so the row title, the timestamp line, the status badge, the
proposer's paragraph and the two decision panels can be seen at all.

🚨 **The people and the courses in these pictures are not real** — the dev
fixture again. On the Storage shots the section shows a permission refusal
rather than real settings, because the fixture signs in without a real admin
session; that refusal is genuine, and it is the same state part two
photographed, so the before and after are comparable.

## Still nothing is asked of you

No decision is waiting. If you have five minutes, the useful look is the
**Storage** section side by side with its "before" — that is the whole point
of this session in one image. The two questions from part one are still open
and still not blocking.
