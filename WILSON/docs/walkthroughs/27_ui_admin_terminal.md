# 27 — Admin Terminal (UI overhaul, lane C, session C3)

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

## What is deliberately NOT done yet

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
