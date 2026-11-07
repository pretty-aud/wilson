# 95 — M.O.T.H. SESSION 2

M.O.T.H. now draws what you can see as a map: your projects as islands of light, their folders, files, tags and
production items as dots, and how they relate as lines. This file says what is there, how to see it, what it does not
do yet, and what was checked. One thing waits on you, under **Questions**.

None of this is on staging or production. The two database changes are on your test database, and the code is on its
own branch until it is merged into the integration branch.

## What you see now

- **A first question, once.** The first time you open M.O.T.H. it asks *What do you want to map?*: everything by
  folders, everything by tags, or a map you build yourself by choosing what shows as dots and which lines join them.
  After that it opens the view you used last.
- **The map.** Each project is an island; open it and its folders branch out, each with a count of what is inside.
  The light behind grows with everything you can see across all your projects, not with where you happen to be.
  Drag empty space to move around, scroll or pinch to zoom, click a dot to select it, Shift-click to select more,
  and double-click a folder to open it.
- **Production items too.** Phases, assets, tasks, scenes, shots, levels and experiences can be dots, with lines for
  how they relate: a task and what it is about, an asset and where it is used, a file and what it is filed against.
- **Moving by dragging.** Drag a file onto a folder: the folder opens wider and the words *move into* follow the
  pointer. Let go and the file moves, exactly as **Move to…** would, and **Undo** puts it back. Press Escape during a
  drag and nothing changes. Dragging near another dot would link the two, but **links come with the next session**:
  for now the dot goes back where it was, and the page says nothing was linked.
- **A preview.** Rest the mouse on a dot for half a second: an image, a short silent video, or the first lines of a
  text file appear beside it. It goes the moment you press or move away. Files kept on the office server or on one
  computer are not previewed from a browser, and it says why.
- **Views.** The panel on the left picks the view, saves it (for you alone, or for everyone on a project if you may
  change that project), renames or deletes it (with Undo straight after), resets it, or lays it out again. In a saved
  view, a dot you move, a folder you open or close and the focus are kept a moment later, each in the view you changed
  it in; only what you changed is written, so two people arranging one shared view each keep what they moved. Reset
  goes back to the view as last saved and clears nothing for anyone else. *Lay out again* rearranges the picture for
  this visit; what you then move is kept. A project's reviewer can look at its shared view, and cannot rearrange it; nothing of
  it is saved.
- **The list on the right** does everything from the keyboard, with breadcrumbs to step back up.
- **Folder cards.** Select a folder and a small card lists what is in it, bottom left. Pin up to five; a sixth is
  refused with a sentence. The clock icon there lists the folders you opened last, and shows nothing until you press
  it.
- **Opening a thing in its own tool.** Select a task, an asset or any production item and press **Open in
  R.A.B.B.I.T.**; select a file and press **Open in Files**. Each asks first whether to leave M.O.T.H.
- **Looking back.** The **Look back** slider shows your projects as they were, for up to 90 days, from when M.O.T.H.
  began recording. It shows names and places, not old copies of files, and changes nothing.
- **Settings and Help.** The cog at the top right opens M.O.T.H.'s settings in a drawer: the light's colour, what sizes
  a dot (what is inside it, or how recently it changed), what colours it (what it is, its type, its tag, who last changed
  it) and a lighter mode for older computers. Help sits beside it. Your settings follow you, a company at a time.
- **Pen and touch.** Touch the screen or use a pen and the controls grow; move a real mouse and they shrink again. A
  computer that asks for less motion gets a light that holds still.
- **What never appears.** Invoices, finance and Legal files, a private project you are not on, and anyone else's
  personal space: not as a dot, a line, a search result, a card or a preview, for any role.

## What to do

1. **See it, with no server and no risk.** In a dev build, open M.O.T.H. with the dev fixtures on: the pretend company
   and its film *Salt Hours*. The first visit asks what to map.
2. **See it under load.** Add `?mothReplay=1000` to the address in a dev build: the map draws a made-up catalogue of a
   thousand dots. `?mothFrames=1` shows how long each frame takes. Neither works in a released build.
3. **Answer the question below**, when you can, so your saved test project can be measured too.

## Worth knowing

- **Above a thousand dots, nearby dots gather into clusters** that open as you zoom in, so the picture stays smooth.
- **A view's places belong to the view.** Reset goes back to them as last saved; *Lay out again* keeps only what you
  pinned by hand.
- **Where views and settings cannot be kept (a project kept only on this computer, signed out), they last until
  WILSON closes**, and the first question is asked again the next time. There is no table for them
  until the project moves to the cloud: *Save as…* is greyed there, and the panel says the view lasts for this visit.
- **Looking back reads the record from your test database.** A project's history starts when M.O.T.H. began
  recording it; before that the slider says it was not recorded.

## Not built yet

- Saving links between things, and notes and courses as dots: Session 3.
- The timings on your saved test project (the question below), and on the desktop app itself: the measurements here
  are in Chrome.

## What was checked

- **Tests:** every new part has its own tests. The whole suite is run again on the final code before the merge; its
  count is in the session's close-out.
- **The database changes** were rehearsed on your test database and undone, run under every database test (120
  suites), and checked with 208 planted mistakes on a throwaway test server: 172 were caught, and each of the 36 that were not is covered by another rule, named in the design document, or too large to plant on a small database. Then
  they were put on your test database on 2026-11-07 at 22:17 UTC, and their tests passed again there (1,674 of 1,674).
- **Speed, on your PC** (Intel Core i9-13900K, RTX 4080, 64 GB; Chrome, headless):

| What was drawn | Frame time, typical / 95 in 100 | Goal |
|---|---|---|
| *Salt Hours*, by folders (6 dots) | 0.2 ms / 0.4 ms | 20 ms |
| *Salt Hours*, by tags (39 dots, 50 lines) | 0.2 ms / 0.5 ms | 20 ms |
| A thousand made-up dots (778 drawn, 803 lines) | 0.6 ms / 11 to 15 ms | 20 ms |
| Ten thousand made-up dots (in clusters) | 14 ms / 17 ms, once 33 ms | not a goal |

  The page itself loads M.O.T.H.'s part in 121 kB (43 kB compressed), and its layout in 26 kB more.

## Pictures

In the folder *95_moth_session_2 pictures* beside this file, all from the pretend company:

- **first visit.jpg:** the question the first time you open M.O.T.H.
- **everything by folders.jpg:** the islands and their folders, with the light.
- **inside a project.jpg:** *Salt Hours* open, its folders and items in the list.
- **a pinned folder card.jpg:** a folder's card pinned bottom left, and the breadcrumbs.
- **the leave question.jpg:** *Leave M.O.T.H.?* before a file opens in Files.
- **save a view.jpg:** saving a view, for you alone.
- **everything by tags.jpg:** files gathered around their tags.
- **settings.jpg:** the light's colour, size, colour and lighter mode.
- **help.jpg:** Help, beside Settings.
- **a thousand made-up dots.jpg:** the made-up catalogue, with the frame readout.

## Your acceptance list

Tick each when you have seen it work; anything that does not is a note for the next session.

- [ ] The first visit asks what to map, once, and later visits open your last view.
- [ ] The map shows your projects, their folders and files; the light grows with what you can see.
- [ ] Moving around, zooming, selecting and opening a folder feel smooth.
- [ ] Dragging a file onto a folder moves it, Undo puts it back, and Escape cancels.
- [ ] Resting on a dot shows a preview, and it goes when you move.
- [ ] A saved view keeps where you put things; a reviewer cannot save a project's shared view.
- [ ] Five folder cards pin, and a sixth is refused.
- [ ] Open in R.A.B.B.I.T. and Open in Files ask first, and open the right thing.
- [ ] Look back shows the past and changes nothing.
- [ ] Settings change the light and the dots, and are kept.
- [ ] Invoices, Legal files, others' private projects and personal spaces never appear.
- [ ] Pen and touch make the controls larger, and a mouse makes them small again.
- [ ] A file deleted in M.O.T.H. is in its Trash with its days left, and Undo brings it back.
- [ ] The clock icon bottom left lists the folders you opened last.
- [ ] What M.O.T.H. shows of a project agrees with Files: the same folders and files.

## Questions

- **Your saved test project.** The plan asks for the timings on "the saved test project" in your local WILSON. It lives
  in your own app data, which this session was told never to read. The question is asked in this session's chat.
