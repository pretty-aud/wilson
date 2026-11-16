# 99 — M.O.T.H. POLISH (MO5)

Your eight asks of 2026-11-16 about M.O.T.H., each built and shown here with a picture from before and after. The
folder cards no longer cut off and can be sized; the map's controls are one bar of icons; *New board* is always in
sight and a board can go in almost any folder; on a board, *Corners* shows only for shapes with corners, the style
panel stays while you type, lines come out of dots on a shape and can be bent, and the small board leaves the map
working round it; a dot flung on the map glides a little; a switch on the bar makes a drag take what is joined to the
dot; a board's name is renamed where it is shown; and a right-click gives each dot and row its menu, *Rename* included.

None of this is on staging or production. The database change is on your test copy (wilson-dev), and the code is on
its own branch until it is merged into the integration branch.

## Before you start

- **With no server and no risk:** a dev build with the pretend company on, M.O.T.H. open. Choose *Everything by
  folders* if it asks *What do you want to map?*, then the project *Salt Hours*. Every picture was taken this way.
- **On the test copy:** an account that may change a project, and one that may only read it, to see what is greyed.

## What to do

### 1. The folder cards at the bottom left are never cut off, and you can size them

1. Open a folder from the list or the map: its card opens at the bottom left. Open a few. The cards sit side by side
   and wrap to a second row when there is no more room; nothing is hidden under a scroll bar, and none runs under the
   bar or the list. *Pictures 1 before and 1 after.*
2. Drag the top edge of a card, its right edge, or its top-right corner: every card takes the new size, never larger
   than the room there is. With the keyboard, Tab to an edge (it is called *Height of the folder cards* or *Width of
   the folder cards*) and use the arrow keys. Escape while dragging puts the size back.
3. Close M.O.T.H. and come back: the cards keep your size. It is kept on this computer, for you in this company.

### 2. The map's controls are one bar of icons

1. Along the top of the map, from its left edge to the list: the view and its menu (*New view*, *Save*, *Rename*,
   *Delete view*, *Reset*, *Lay out again*), *Save as*, *Find and fly to*, *What shows*, *Focus here* and how far it
   reaches, *Look back* with its slider, then *Move to*, *Delete* and *Open in its tool* for what is ticked, *Undo*
   and *Redo*. Rest the mouse on an icon to read its name. *Pictures 2 before and 2 after.*
2. *What shows* opens below the bar; Escape closes it. On a narrower window the Look back sentence is cut shorter (all
   of it is in its tooltip), *Find* gets shorter, and where the controls still do not fit in one row (the app's
   narrowest window, 1,024 pixels, for one) the bar takes a second row: nothing is ever drawn over anything else.

I sent you the bar's picture with one question, keep it or change something; your answer is still to come.

### 3. New board is always in sight, and a board can go in almost any folder

1. *New board…* is at the top right of M.O.T.H., beside Help. It opens a small window: the board's name, its project,
   and *Where it goes*, which starts on the folder you have selected (a file's folder; for a board, the folder that
   holds it), or else on the folder the list is in, or the project's top. *Pictures 3 before and 3 after.*
2. A board can now go in an asset's, a scene's or a shot's folder, as in any folder you made. When such a thing is
   deleted in R.A.B.B.I.T., its boards are not lost: they move to the top of the project.
3. Where a board cannot be made, it says why: *New board…* is greyed, with its reason, for a project kept only on
   this computer (boards need the cloud) and while looking back in time; in the window, a project you may only read
   is greyed in the list; a board's own folder is simply not offered (a board does not go inside a board).
4. One knock-on, said where it happens: a shot whose folder holds a board cannot be filed under another scene for now.
   R.A.B.B.I.T. says *this shot's folder holds a board, so it stays where it is for now*.

### 4.1 Corners only for shapes that have corners

Select an oval or a circle: there is no *Corners* slider. Select a rectangle, a triangle, a star, a speech bubble or
any shape with corners: *Corners* rounds them, and starts at the corner the shape is drawn with. *Pictures 4.1.*

### 4.2 The style panel shows as soon as you start typing

Pick the text tool (*T*) and press on the board: the style panel is there at once, while you type the first words.
Change the words' colour or size as you type; the typing carries on. *Pictures 4.2.*

### 4.3 Lines come out of a shape's dots

1. Point at a shape: a small dot shows beyond the middle of each side. A shape you have selected shows them too.
   *Pictures 4.3 before and 4.3 after, the dots.*
2. Drag from a dot: a line comes out of that side. Bring it over another shape: the side it would land on is lit and
   the end snaps to its middle. Let go: the line is tied to both shapes, and moves with them. *Pictures 4.3 after.*
3. Dragging an end of a selected line onto a shape lights and snaps the same way, so a line can be tied again.

### 4.4 Lines can be bent

Select a line. *Path* in the style panel says *Straight*, *Curved* or *Square turns*.

- **Straight:** a hollow handle sits in the middle of each stretch; drag it to add a bend there. Each bend is a handle
  of its own.
- **Curved:** one handle sits on the curve; drag it and the curve passes through where you let go. *Pictures 4.4.*
- **Square turns:** the middle stretch has a handle and slides (when both ends leave the same way).
- Choosing another path lets the bends go, and so does the arrow beside *Path* (*Straighten*).
- A bent line tied to two shapes you move together moves whole, bends and all.

### 4.5 A small board leaves the map working

Open a board in its small frame. Around it the map still pans, zooms and selects, and the whole bar and the list work;
the map is dimmed a little, never blurred. Once you have used the map round it, *Back to the map* leaves the map where
you put it, and Ctrl+Z undoes on the map while you are working there. Moving the Look back slider closes the board
and says why (a board is always as it is now). For now the map's notices sit under the frame. *Pictures 4.5.*

### 5. A dot flung on the map glides a little

Drag a dot and let go with a flick: it carries on a little the way it was going and slows to a stop (about half a
second, never far). Placed slowly, it stays where you put it. *Settings* has *Moving dots*: *Dots glide a little when
you let go of them*, on at first. When your computer asks for less motion it is off and says so. *Pictures 5.*

### 6. A switch on the bar moves what is joined along

The magnet at the end of the bar, *Move what is joined along*. On, dragging a folder takes everything drawn inside
it, and dragging any dot takes what a line joins to it, one step out. What it lives in stays where it is, and a tag's
hub stays (it joins many things) unless the tag is what you drag. Let go and everything stays where you left it. The
switch is kept on this computer, for you. *Pictures 6* (in the radial tree, where nothing followed before).

### 7. A board's name is renamed where it is shown

Click the board's name at the top of its frame (or press F2 there). Type; Enter keeps the name, Escape puts it back,
and clicking away keeps it. Anyone who may change the project may rename its boards, as anywhere else; someone who
may only read sees the name as words. The others on the board see the new name at once; the map's list and dot show
it once the board closes. *Pictures 7.*

### 8. A right-click menu on the map and the list

Right-click a dot on the map or a row of the list (or press Shift+F10 or the menu key on a row). The menu holds what
you could do with it from the list and the bar: *Open* (*Open board* on a board, *Show in the list* on a file),
*New board here…*, *Move to…* and *Delete…* on a file, *Open in its tool* — and *Rename…* (*Rename board…*):

- a folder you made, or a board: renamed here, in a small window.
- a project: greyed, *A project is renamed in R.A.B.B.I.T., from its settings.*; an asset's, a scene's or a shot's
  own folder: greyed, *This folder is named after its asset. Rename the asset in R.A.B.B.I.T.* (and so on); a file:
  greyed, *Rename this in R.A.B.B.I.T.*
- a folder WILSON made (*ASSETS*, *SCENES* and their kind): greyed, *WILSON made this folder, so its name stays.*

*Pictures 8.* There is no "before" picture of a right-click: before, it opened only the browser's own menu, which a
picture of the page cannot show.

## What was checked for you

- **Each item has its own tests**, first run on the code before the item, where they fail (so they test the change,
  not something that was already true; the few that pass there pin what was kept). All of M.O.T.H.'s tests pass: 1,236 of them, with the
  board's; with R.A.B.B.I.T.'s adapters, 1,900.
- **Every picture** was taken in the running app with the pretend company; the "before" ones on the code as it was.
- **The database change (0138)** was rehearsed and undone on the test copy, then applied there by the house method on
  2026-11-16 at 07:18:48 UTC, its stored copy read back equal to the file. Its own tests (53 checks) and the board
  tests around it pass there, 311 of 311; the whole set, 7,354 of 7,356 (the two that do not are an old count of the
  test copy's own sign-ins, failing before this session).
- **Two rounds of review** read everything, eleven reviewers in all. Nothing was a security problem. What broke
  something that worked, or kept an item from doing what it says, was fixed and tested; among those, the bar drawing
  the Look back slider over Move to and Delete at narrower windows (your "its overlapping" again), the bar's Save as
  window cut off, a sticky's last words lost when Arrange was reached while typing, and dragging with the magnet on
  pulling the folder's own project along. The rest is written down to fix later (`docs/OUTSTANDING.md`, MO5-01 to
  MO5-35).
- **Size:** M.O.T.H.'s own part of the app grew by 28.7 KB (the new windows, the menu, the bar, the cards' edges and
  the map's carry and glide), the board's by 13.1 KB, the rest of the app by 1 KB.

## What is not there yet

- **Lines on a board are drawn and bent with a mouse, a pen or a finger only** (no keys yet), as the board's other
  drawing is.
- **Your sizes and switches** stay on the computer you set them on (see below).
- **A board renamed in its window** shows its new name in the map's list once it closes.
- **Round a framed board, the map's notices** are under the frame.
- **Square turns that make an L** (one end sideways, the other up or down) have nothing to slide.
- **A bent line with only one end moving** keeps its bends where they are.
- **A shot whose folder holds a board** cannot be filed under another scene for now (R.A.B.B.I.T. says so).

## Still to settle with you

- **The bar (item 2):** keep it as it is, or change something. Asked with its picture; your answer will be applied.
- **What "joined" means (item 6):** read as above: a folder's contents, and one step out along a drawn line; never its
  own folders; a tag's hub only when the tag itself is dragged. Say if you meant something else.
- **What Rename covers (item 8):** read as folders you made and boards; projects, assets, scenes and files stay
  renamed in R.A.B.B.I.T. Say if you want any of those renamed from M.O.T.H. too.
- **Where your sizes and switches are kept (items 1, 5, 6):** on this computer, for you in each company, so they do not
  follow you to another computer. Keeping them with your account needs a small database change; say if you want it.

## Pictures

In the folder *99_moth_polish pictures* beside this file, all from the pretend company, named by item: *1 before…*,
*1 after…*, and so on to *8 after…*. Item 6's first picture is the radial tree before any drag; item 5's *let go
here* and *glided on to here* were taken a second apart.

## Questions

Only the bar's, asked already with its picture.
