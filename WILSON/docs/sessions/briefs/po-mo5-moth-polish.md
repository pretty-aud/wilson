# Brief — MO5 · M.O.T.H. polish from her first use of it on the beta

The controller's chip was this session's whole brief. The four sections below are four of its sections, word for word.

## HER WORDS

HER WORDS, typed in the controller's chat on 2026-11-16 at 04:47:11 UTC with three pictures, verbatim:

things are looking good but few things need update:

1. See image attached the window at the bottom is not showing and is getting cut in half. i want to see this full. it can take more space. and lets make sure its dynamic sizing. lets actually allow the user be able to grab the edge and stretch it or shrink by dragging and dropping to desired size. but no matter what this shouldnt be cut off like that
2. see second image. lets do a design pass on this. i rather it be more of a bar with options than a window with options stacked on top of each other. lets use icons where possible to make it cleaner
3. I need a button somewhere in the interface to allow the user to create board. when the user presses this, they should be met with a pop up window asking the user the name of the board and the place they want the file to be. default to the current selected folder.  one thing to make sure boards can be left in almost any folder type (assets, projects, etc.)
4. Board issues:
   1. corners slider is not working for all shapes and only working on rectangle. hide slider in things like oval, circle etc.
   2. when i use the test option in the board, the properties widget doesnt show till after typing. when the user is starting to type for the first type it should show up.
   3. create better controls for the lines. if i create a shape i should be able to pull a connected line from the shape (see how figjam works and how it has a dot appear to allow the user to pull one.
   4. when a user places a line connection to a shape i cant control the shape of the line. i need to be able to control thew curve and overall shape. see how figjam manages making lines and controlling the lines, how they snap to each other etc.
   5. when the user makes the board window small they should be able to move around the file viewer/web. so they should be able to make it smaller and start moving around
5. i want to add some animation to the files in the visual web. like if i grab it and move it maybe have it like have some momentum. making them more like objects in a space. allow the user to toggle this off in settings
6. right now the user when they move a file around in the space the ones linked to the file do not move with it and stay where they were. the lines can get confusing. lets have a setting the user can toggle on or off in the tool bar. this toggle turns on if connected items in the viewer move with the parent item.
7. see third image attached. i should be able to edit the title of the board in the window and edit it in there.
8. I want to be able to right click and have options like rename the folders (folders like ASSETS, SCENES, etc. that are infrastructural folders cannot be renamed, only direct assets etc.)

## THE PICTURES

THE PICTURES, described (reproduce each on a running build before you change anything, and keep a before picture). First: bottom left of M.O.T.H., a small panel with the heading ASSETS and one row "tester >", a horizontal scrollbar under it, its lower part cut off by the bottom edge of the window. Second: the map's control panel as one tall card, top to bottom: a menu reading "Everything by folders"; New; Save as..., Reset, Lay out again; a field "Find and fly to..."; "What shows"; a button Focus here; a menu "One step"; LOOK BACK with a slider and "Now. Not recorded before Nov 12, 2026."; Move to... and Delete (greyed); Undo, Redo. Third: the top left of the board window, its title "Board" above the dotted canvas and the tool rail.

## HOW THE CONTROLLER READS EACH ITEM

HOW THE CONTROLLER READS EACH ITEM. Her words win over this reading; ask her in your own chat only what you cannot settle, one question at a time, in plain words, as multiple choice with the recommended answer first and a real picture sent first.
1. The list panel is never clipped: it sizes itself to the room there is, scrolls inside, opens larger than today, and she can drag its edges to resize it; the size is remembered.
2. The control panel becomes a bar: one row of controls with icons (each with a name a screen reader and a tooltip can say), menus for what does not fit, nothing lost from the list above. Before you finish it, send her ONE real screenshot of the working bar and ask one question (keep it, or what to change); go on with other items while you wait.
3. A New board button that is always in sight. It opens a dialog asking the board's name and where it goes, a folder picker that starts on the folder now selected. A board can live in almost any kind of folder (a project, its ASSETS and other folders, an asset's folder). Measure how a board is stored today and what it may be attached to; if this needs the database to change, it is ONE migration with its pgTAP suite (0138 and 140 at this writing: measure both). Where a board cannot be made, the button or the dialog says why.
4. (4.1) The Corners slider shows only for shapes that have corners to round. (4.2) With the text tool (her "test option"), the properties panel appears as soon as she starts typing the first time. (4.3 and 4.4) Connectors like FigJam's: a shape shows connection dots when hovered or selected; dragging from a dot draws a line attached to that side; dropping on another shape attaches the other end, with the target side highlighted and snapped to; attached lines follow their shapes; a line can be straight, elbowed or curved, with handles to bend it and to move or re-attach each end. Do not copy FigJam's look. (4.5) The board window can be made small, and then the map behind it still pans, zooms and selects.
5. Dragged items on the map carry a little momentum and settle like objects in space. A switch in Settings turns it off, and it is off when the system asks for reduced motion.
6. A toggle on the bar: when on, dragging an item moves what is joined to it (what a drawn line connects one step out, and for a folder everything inside it). Remembered per person.
7. The board's title is edited in place in the board window (Enter keeps, Escape cancels), under the same rights as renaming it elsewhere, and others on the board see the new name.
8. Right-click opens a menu on items of the map and the list with what the three-dots menu offers there, and Rename. The fixed folders the app itself makes (ASSETS, SCENES and their kind) cannot be renamed: the entry is greyed with its reason.

## HOW TO WORK

HOW TO WORK. Measure first. A short design round, then build in this order so that a stop leaves finished work: 1, 3, 7, 8, 4.1, 4.2, 4.5, 2, 6, 5, then 4.3 and 4.4. One commit per item with its tests (failing controls), pushed as you go. The permission gates, the keyboard and the screen-reader names hold for everything new. Walkthrough docs/walkthroughs/99_moth_polish.md with a before and an after picture per item, and its row in the walkthroughs README; OUTSTANDING ids MO5-NN, its comment markers four and four before and after; the hand-off docs/sessions/handoffs/po-mo5-2026-11-16.md with the built bundle's size before and after. docs/sessions/PLAN_TO_1_0.md and PLAN_WEEK_2026-11-04.md are the controller's: do not edit them.
