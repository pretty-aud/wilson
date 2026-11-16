# 97 — M.O.T.H. SESSION 4

A project can now have boards: a page you draw on, with shapes, lines between them, frames, a pen, words and sticky
notes, and with pictures and files laid on it. A board opens from the map in one panel that can be a small frame, fill
the view or fill the whole window, and it goes back to the map with a button or with Escape. Several people can be on
one board at once: each sees the others' changes and pointers, and only one person writes in a sticky at a time. This
file says how to see it, step by step, what was checked for you, what it does not do yet, and what is still to settle
with you.

None of this is on staging or production. The database changes are on your test copy, and the code is on its own
branch until it is merged into the integration branch.

## Before you start

- **With no server and no risk:** a dev build with the pretend company on, M.O.T.H. open. Choose *Everything by
  folders* if it asks *What do you want to map?*, then the project *Salt Hours*. Everything the pictures show was done
  this way. The pretend company is one person in one window, so it cannot show a second person, and it cannot delete a
  file, so it cannot show the stop sign of step 5.3 either.
- **On the test copy with real people:** two accounts of one company, in two browsers (or a browser and a private
  window). Pick a project that has folders: a project with none is refused a board for now, in the words *You cannot
  make a board here. The folder may have moved, or you may not change it.* (that is on the list to fix).

## What to do

### 1. Three panel sizes, button/Escape back, pull-away small frame.

1. In M.O.T.H., open a project and press the three dots (*More for this project*) at the top of the list on the right.
   It offers **New board** (a folder's menu offers it too, for a board inside that folder). *Picture 02.*
2. Press **New board**, give it a name, and press **Make the board**. The board opens in a small frame over the map,
   with the drawing tools down its left side and the sizes at the top right. *Picture 03.*
3. Press the second size button (*Fill the view*): the board fills the space under M.O.T.H.'s own bar. *Picture 08.*
   Press the third (*Maximise*): it covers everything below WILSON's top bar. *Picture 05.* Press the first (*Show in
   a frame*): it is the small frame again.
4. Press **Back to the map**: the board closes and the map is where you left it. Open the board again (press its name
   in the list, then **Open board**) and press Escape: the same. If something is open on the board, such as the shape
   list, the words you are typing or something selected, Escape lets go of that first, and the next Escape goes back to
   the map.
5. On the map, the board is a dot of its own colour beside the project's folders. *Picture 01.*
6. With the board in its small frame, take hold of its right edge and pull it out, away from the board. Pulled far
   enough, the frame shrinks and says **Let go to close**; let go and it closes into its dot. *Picture 13.* Pulled only
   a little and let go, it stays open as it was. Pull-away is only on the small frame: when the board fills the view or
   is maximised, its edges do nothing.

### 2. Corners resize; edges only close via pull-away.

1. With the board in its small frame, take hold of a corner (the small bracket at each corner) and drag it in or out:
   the frame changes size and stays open. *Picture 12.*
2. An edge never resizes: dragging an edge is only the pull-away of step 1.6.

### 3. Full shapes/connectors/frames/pen/text/stickies; connected lines follow shapes.

1. Press the little arrow beside the shape button (*Choose a shape*): a grid of nineteen shapes, from a rectangle to
   the flowchart shapes. Pick one and drag on the board to draw it. *Picture 04.*
2. Draw two shapes, choose the connector (*Connector*, or the key L), and drag from one shape to the other: a line joins
   them. In the panel on the right, *Path* gives straight, curved or square turns; you can also choose dashes, the line's
   width and what each end has (none, an arrow, an open arrow, a dot or a diamond). Double-press a line to write on it,
   for example *then*. *Picture 05.*
3. Double-press a shape to write in it. Select it: the panel on the right changes its kind, its fill, its line, its
   line's width and style, the words' colour and size, how see-through it is and its corners, and puts it in front of
   or behind others. *Picture 06.*
4. Drag a shape that has a line to it: the line follows, and stays joined. *Picture 07.*
5. Draw a **Frame** around some shapes: it has a name above it, and moving the frame moves what is inside. Draw with the
   **Pen**, write with **Text** (key T), and put a **Sticky note** (key N) with words on it. *Picture 05.*
6. Undo and redo are at the bottom left with the zoom, and Control+Z works too.

### 3a. A board's background: dotted grid, blank or lined grid.

1. A new board opens on a dotted grid: small grey dots, evenly spaced, behind everything you draw. *Picture 16.*
2. At the bottom left, in the bar with undo and the zoom, press the last button (its tip says *Background*). A short
   list opens: **Dotted grid**, **Blank** and **Lined grid**, with the one in use marked. *Picture 17.*
3. Press **Lined grid**: the board turns to squared paper. *Picture 18.* Open the list again and press **Blank**: no
   grid at all. *Picture 19.* The list closes when you choose, when you press Escape, or when you press anywhere else.
4. Zoom in and out, and move around the board: the grid moves and grows with what you drew. Zoomed far out, it has
   fewer dots or lines, so it stays light.
5. The background belongs to the board, not to you. Anyone who opens the board sees the same one, and anyone who may
   change the board may change it. Someone who may only look at the board has no **Background** button. *No picture
   of a second person: the pretend company is one person in one window. That the change reaches the other person
   without reloading is checked by the automated test that opens one board in two windows on the test copy. On its
   first run, the second window turned to the lined grid by itself, without reloading.*

### 3b. Frames that group things, as in Figma.

1. The Frame tool (the # sign on the left, or the key F) still draws an empty frame: drag on the board. Its name,
   *Frame*, sits above its top left corner. *Picture 20.*
2. Select two or three things: drag a rectangle round them, starting on an empty part of the board. The panel on the
   right has an *Arrange* row at the top. In it, the button with the # sign (its tip says *Frame selection (Ctrl+G)*)
   puts a frame round them. *Picture 21.* Press it, or press Ctrl+G: a frame named *Frame* appears round them, a little
   larger than they are, and it is selected. *Picture 22.*
3. Drag the frame by its name, its edge or its white middle: everything it holds moves with it, and lines joined to
   them follow. *Picture 23.* The arrow keys nudge it the same way.
4. A frame holds a thing when the thing's middle is inside the frame and the thing is not bigger than the frame.
5. Drag something over a frame: while you hold it, it stays in sight on top, and the frame is outlined in blue, to
   show it would take it. *Picture 24.* Let go: it sits on top of the frame, and now moves with it. *Picture 25.*
   A line drawn on its own, joined to nothing, belongs to a frame like anything else when it is inside it.
6. Drag it out of the frame and let go: it no longer belongs to the frame. Move the frame, and it stays where you left
   it. *Picture 26.*
7. To pick things inside a frame without moving the frame, hold Ctrl and drag from inside the frame: it draws a
   selection rectangle instead.
8. Select a frame and press Delete: the frame goes with everything it holds, and the board says *The frame was removed
   with what it held. Undo brings it all back.* A line between two things in the frame goes too. A line from a thing
   in the frame to something outside it stays, loose at the end that lost its thing. *Picture 27.* One undo (Control+Z) brings it all back. *Picture 28.*
9. To take away only the frame and keep what it held, select the frame and press the button beside the # sign (its tip
   says *Remove the frame only (Ctrl+Shift+G)*), or press Ctrl+Shift+G.
10. **Bring to front** on a frame brings what it holds forward with it, so a frame never covers its own things.
11. Someone who may only look at the board sees no frame buttons, and cannot move or delete anything.

### 4. Dropped media appears in Files; reference embed adds no copy.

1. Press **Picture or file** (key I) and choose a picture: it lands on the board as a tile. Drag pictures or files from
   your computer onto the board: it says *Drop to add to the board* while you hold them over it, and each lands as a
   tile. *Picture 10.* (The pretend company shows each picture as a tile with its name; on the test copy the picture
   itself is drawn.)
2. Press **Embed a file** (key E): a list of the project's own files. *Picture 09.* Pick one: it shows on the board too,
   but nothing is copied. It is a window onto that file where it already is. *Picture 10.*
3. Go back to the map and press the board's name in the list. The board has its own folder, which lists the pictures and
   files you added and a file for each sticky, but not the embedded file, which stays in its own folder. The same files
   are in Files. *Picture 11.*
4. Taking a picture or a file off the board never deletes the file itself; deleting the file is done in Files or in
   M.O.T.H., and it asks you first.

### 5. Moved/deleted source yields stop-sign tile without private filename.

1. Embed a file from another folder, as in step 4.2. Go back to the map and put that file in the trash.
2. Open the board again.
3. Where the file was, the board shows a stop sign with the words *This file is missing — it may have been moved or
   deleted*, and it does not name the file. Someone who may not see that file sees the same tile, so a private file's
   name never shows. *No picture: the pretend company cannot delete a file, so this needs the test copy.*

### 6. Two-browser independent edits/cursors/sticky contention/disconnect recovery.

Two accounts, A and B, on the same board in two browsers. *No picture: the pretend company is one person in one window.*

1. At the top of the board each of you sees the other's name, with a dot of their colour.
2. A draws a shape while B moves another: each sees the other's change straight away, and neither change undoes the
   other.
3. Move your pointer over the board: the other sees it, with your name, and it stops when you stop.
4. A opens a sticky to write in it. When B tries the same sticky, B is told *A's name is writing on this sticky.* and
   cannot type in it; when A is done, B can.
5. Turn B's network off for half a minute or more: the board says *Not connected to the others on this board just
   now. WILSON keeps trying.* A short break of a few seconds may show nothing, because the board only learns the
   network has gone when its next check goes unanswered, and those checks come every 25 seconds. Turn it back on:
   within a few seconds, B has everything A did meanwhile.
6. As an admin, take B off the company while B has the board open: B's board closes at once, and M.O.T.H. says *This
   board is not open to you any more. It may have gone to the trash or moved.*

### 7. Desktop-only board is solo, without channels/cursors.

1. In the desktop app, open a project kept only on this computer, and press its three dots. It offers no **New board**;
   it says instead *A board needs this project in the cloud.* M.O.T.H.'s settings say *Boards need the project in the
   cloud.* *Seen on the desktop app, with a copy of your saved test project LEGEND ROAD: the three dots offer no
   **New board** and say* A board needs this project in the cloud., *and M.O.T.H. says* History is not recorded for
   projects kept only on this computer. *The settings' sentence was not seen there; automated tests check it.*

### 8. Full walkthrough, both approved projects, verified current plan/cap enabled/remaining usage and measured messages.

1. Do steps 1 to 6 on the test copy, on the debug sample project and on LEGEND ROAD.
2. Before and after, look at the test copy's usage page in Supabase: the plan's name, the live messages left this month,
   the most connections at once, and that the spend cap is on. Write the numbers down: the difference is what the
   walkthrough cost.
3. For the trash: on the board, press the bin (*Put in the trash*). It asks *Put this board in the trash? Its notes and
   pictures go with it. You can bring it back from Moth's trash for 30 days.* with **Keep it** and **Put it in the
   trash**. *Picture 14.* Say yes: the board closes, and M.O.T.H. says *The board is in the trash. You can bring it back
   from Moth's trash for 30 days.* In the list on the right, go up to *Everything* and press **Trash**: the board is
   under *Folders and boards*, with how many files it holds and who put it there, and **Bring back**. *Picture 15.*

## What was checked for you

- **In a real browser**, on the pretend company: every shape, the three kinds of line with their ends, dashes and a
  label, lines following a moved or turned shape, frames, the pen, words and stickies, the three sizes, the corners,
  the pull-away, Escape's order, pictures and files dropped and chosen, an embed with no copy in the board's folder, and
  the trash with **Bring back**. Six faults that only showed this way were found and fixed (among them: words could
  not be typed with a mouse, the small frame's bottom right corner lay under WILSON's pet, a board's stickies and
  files did not show in its folder after it closed, and each person was "Someone" to the others).
- **End to end on the test copy**, with one account in two windows: a board made and opened twice, each window seeing
  the other's shapes and sticky words, the sticky's turn refused with the writer's name and then taken, a forged save
  thrown away, a picture drawn from its file, the background chosen in one window showing in the other, and the trash
  closing both windows.
- **Between two and five pretend people** on a temporary copy that was thrown away afterwards: each named the others,
  every pointer reached exactly the others, and nothing was sent while nobody moved.
- **The numbers:** a pointer sends at most ten times a second, and nothing while it is still. Every send reaches each
  other person on the board, so five people moving without a pause cost about 900,000 messages an hour of board time,
  and two people about 144,000. A window that lost its connection caught up about a second after it came back. A person
  taken off the company while the board was open had it closed for them at once (in 49 thousandths of a second).
- **The map** stays as quick with a board open as without one, on the debug sample.
- **On the desktop app**, with a copy of LEGEND ROAD (never your own app's data): the map by folders showed 7 dots and
  5 lines, and with every kind of item 30 dots and 46 lines. In both, 95 pictures in 100 came within 16.8
  thousandths of a second of the one before, the screen's usual pace of about 60 a second, and drawing the map took
  at most 0.6 thousandths of a second for 95 pictures in 100, against a limit of 20.
- **The Supabase plan**, read on 12 November from Supabase's own pages after you signed in (nothing was changed):
  the Pro plan, with the spend cap on. One allowance covers the test copy, staging and production together. In the
  month from 17 October to 17 November, 1,057 live messages were used of 5,000,000, and at most 8 connections were
  open at once, of 500. Two people moving on a board without a pause for an hour would use about 2.9% of a month's
  messages; five people, about 18%.
- **The background and frames**, in a real browser on the pretend company: the three backgrounds and their list, the
  grid while zooming and moving, a frame put round a selection by its button and by Ctrl+G, a frame dragged and nudged
  with what it holds, a sticky dragged in and out, Ctrl and a drag inside a frame, *Remove the frame only*, and Delete
  with what it held followed by one undo.

## What is not there yet

- Moving a board, or a folder, from one project to another.
- Boards for a project kept only on one computer: such a project offers no board and says why.
- Changing where a connector's bends are: its path is straight, curved or square, chosen in the panel.
- Playing a video on the board: a video shows its first frame and does not play.
- A board's place in the looking-back record: looking back shows its folder as a plain folder, and a board is not in
  the company's takeout yet.
- A project with no folders cannot have a board yet (see *Before you start*).
- Sticky notes for a company that keeps its files in its own storage, rather than WILSON's. Such a company can make a
  board and put a sticky note on it, but as soon as you type, the sticky says *A sticky's words cannot be saved on
  the company's own storage yet.*, with a **Close** button, and takes no more typing. The sticky stays empty, for
  you and for everyone, and each new one leaves an empty note file in the board's folder.

## How the background and frames work now

These are choices made while building, not your words. Each is how it works now; tell me if you want it otherwise.

- The background belongs to the board, not to each person: everyone on the board sees the same one.
- A new board starts on the dotted grid.
- *Lined grid* is squared paper: lines across and down, like graph paper.
- A thing belongs to a frame by where its middle is: its middle inside the frame, and the thing no bigger than the
  frame.
- Delete on a frame takes what it holds too, as Figma does. *Remove the frame only* keeps them.
- The board has no copy, no duplicate and no right-click menu yet, so frames have none of those either.

## Still to confirm with you

- **The check with two real accounts on staging**: steps 5 and 6 with two people, before boards reach anyone. The
  release checklist's section *§W. Boards and live editing* walks it.
- **The desktop app**: step 7's words and the map on LEGEND ROAD were seen there (see *What was checked for you*).
  Only M.O.T.H.'s settings sentence, *Boards need the project in the cloud.*, has not been seen on the desktop app.

## Pictures

In the folder *97_moth_session_4 pictures* beside this file, all from the pretend company:

- **01 the map, a board as a dot of its own colour.jpg:** the board *Mood wall* as a coral dot (*Mood wall · 4*)
  beside the white folders, its files in the list.
- **02 the project menu, New board.jpg:** the project's three dots, pressed.
- **03 a new board in its frame.jpg:** a new board, empty, in its small frame.
- **04 the shape grid.jpg:** the nineteen shapes.
- **05 shapes, lines, a frame, pen, text and a sticky (maximised).jpg:** the board maximised: a frame, three lines
  (straight with *then*, curved and dashed, square turns), the pen, words and a sticky.
- **06 a shape selected, its style panel.jpg:** a shape selected, with its panel.
- **07 the line follows a moved shape.jpg:** a shape dragged down; its line came with it.
- **08 the board filling the view.jpg:** the middle size.
- **09 the list of files to embed.jpg:** **Embed a file**'s list.
- **10 a chosen picture, a dropped picture and file, and an embed.jpg:** the four tiles: *harbour.png* chosen, the
  embedded *Boards_sc04_sh010.png* in the middle, *lantern.png* and *call sheet notes.txt* dropped.
- **11 the board folder after it closes.jpg:** the board's folder: the pictures, the file and the sticky, no embed.
- **12 a corner pulled in, the frame smaller.jpg:** a corner resizing the frame.
- **13 an edge pulled away, Let go to close.jpg:** the right edge pulled away.
- **14 the trash question.jpg** and **15 Moth trash, with Bring back.jpg:** the trash.
- **16 a board on the dotted grid.jpg:** the board *Harbour scenes*, maximised: a heading, two scenes, a question
  joined by a line, and a sticky, on the dotted grid a new board starts with.
- **17 the Background list, open.jpg:** the list at the bottom left, with *Dotted grid* marked.
- **18 the same board on the lined grid.jpg** and **19 the same board, blank.jpg:** the other two backgrounds.
- **20 an empty frame drawn with the Frame tool.jpg:** a frame drawn by hand, named *Frame*.
- **21 two scenes selected, Frame selection in the panel.jpg:** the two scenes selected; the # button in the panel's
  *Arrange* row is *Frame selection*.
- **22 the frame made around them.jpg:** the new frame round them, selected.
- **23 the frame dragged down, its scenes with it.jpg:** the frame moved down; the scenes came with it and the line
  followed.
- **24 a sticky dragged over the frame, the frame outlined.jpg:** the sticky held over the frame, in sight on top,
  the frame outlined in blue.
- **25 the sticky dropped in, moving with the frame.jpg:** the sticky let go between the scenes; the frame moved, and
  the sticky with it.
- **26 the sticky dragged out stays behind when the frame moves.jpg:** the sticky dragged out; the frame moved up
  without it.
- **27 Delete on the frame, and what the board says.jpg:** the frame and the two scenes gone; the line to
  *Boat or road?*, which is outside the frame, stays with a loose end; the words at the bottom.
- **28 one undo brings it all back.jpg:** after one undo.

## Questions

None in this file. You answered the Supabase plan question on 12 November, and its numbers are under *What was
checked for you*.
