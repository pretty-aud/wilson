# Audrey's answers to the question list — A through E (2026-09-29, late evening)

Verbatim from chat. F and G to follow in the morning. Her instruction: "this answers up to e. ill f and g in the morning so get started based off of this".

a1. lets merge the overhaul first.
a2. call this one post overhaul and edit versioning
a3. lets do 3 at a time
a4. go with order you suggest. you understand what needs to be first before starting the next step.
a5. just keep using the system youve been using. just keep memory of what each migration is. not fully understand how this is important.
a6. correct we can make changes but very strategic of how you move things around. we still want to keep things relatively the same. try to add things where they make sense.
a7. dont stop for walkthroughs just keep making the updates. ill test later if thats what you mean.
a8. yes
a9. remember. the local one was just for testing. we will need this for testing this week but i need the system to work the same if im using a cloud based solution or a NAS server. whether its NAS or cloud based both should have same functionality as much as physically possible. when we merge. lets make sure to merge the bin system as long with the overhaul.
a10 no we can push it with the rest of the work of the 5 sessions

b1 c
b2 - (B) now; (C) offered as its own later session if you want a week to read as a cell.
b3 it was a bar in the main gantt. i didnt test mini map. i just need it to land where i place it. so if i place it on a day. put it on that day. if im in east coast that is fine. because the project will be run from the timezone the timeline is made in. you are overthinking this one.
b4 no just fix the problem. the current items in the databases are just for testing. just stop it going forward.
b5 yes
b6 yes to all
b7 yes
b8 a.fix now. b.fix now.
b9 correct.

c1 the top tool bar. the one right under the the orange header bar. the bar with import/export history for outlines.
c2 correct lets move on from this one. this is not needed. skip.
c3 option c. numbers two. leave circle color it is right now. i meant context. leave it
c4 66-character ceiling, cap dropped, both pages, 14px, centred; screenshots at 1440 and 1280 before the number is final.
c5 yes
c6 yes to all
c7 yes
c8 everything you listed sounds correct. Course library; cap text in both tables; both card titles + icons; edges unchanged; the design notes record these as your exceptions so a later reviewer does not "correct" them back.
c9 background color is fine. its more the color of the text. correct just the text in the example blocks to identify what are different components/elements of the script. see image attached of code. not those exact colors or anything but see how string, etc has different color. think how VS colors text.
c10 map the common languages, unknown = plain text; fix the merger; your files untouched.
c11 yes
c12 lets fix it. make shift the new hotkey for the pet. the shift key works normally when in a text box selected and typing

d1 a. but remember some shot lists may use the same scene/shot. for example one new shot list could just be an edit with a lot of the same scenes from before and just some changes here and there.
d2 yes
d3 links stay connect to old list. lets have a way to have scenes and shots be reused in a different shotlist not duplicate. in the backend a shot or scene can be related to multiple shotlists. so have the ability to link them. also lets have a way for users to add shots from previous shot list to other shot lists.
d4 Clear = empty the current unsaved working copy after a confirm; saved lists are never cleared; archive instead of delete.
d5 yes
d6 yes except edits can work on unactive shot lists
d7 c toolbar left as built
d8 reviewers and leads can make new edits and shot lists. one note. only project admins can access the budget and versioning of the budget and the timeline. reviewers in projects can make and edit shotlists and edits.
d9 yes.
d10 the active list everywhere; only the Scenes tab shows the viewed list; every scene/shot name gains its list in a tooltip ("SC001 · Storyboard pass v3")
d11 yes; no edit is created. dont worry about current projects they are just for testing.
d12 all five exits ask; three buttons.
d13 yes
d14 yes
d15 the pulse
d16 yes
d17 yes
d18 yes
d19 yes in that order
d20 yes
d21 yes, yes, yes
d22 no i need to be able to see all takes and files related to scenes and shots.

note to S4 facts about files. lets make sure the files page is not read only. i need to be able to view, download, and edit the files database. so edit notes, tags, etc.
dont have the cloud silently throw away kind and description. lets update the databases on supabase.

e1 both go; those three controls move to the Files tab; the project-folder controls stay in the Control Panel.
e2 Description IS the note; Core = the existing flag, its description rewritten to your definition.
e3 several; beside Kind; remove the notes tag option; monochrome.
e4 (c) now, (a) later, restricted tags settable only by people who pass the gate.
e5 yes
e6 remove 3d files viewing for now. we can do that later.
e7 disregard.
e8 ye
e9 as stated
e10 yes
e11 yes
e12 start empty. yes.
e13 yes
e14 yes

## Readings the controller took from the ambiguous ones (correct me if wrong)

- a2: branch `feat/post-overhaul-edit-versioning` (git-safe form of "post overhaul and edit versioning").
- a9: NAS and cloud must behave the same; the desktop Local Server mode is a test rig this week, not a product target. "Merge the bin system with the overhaul" — the bins already sit inside the overhaul branch (the overhaul was cut from the demo branch's tip), so one merge carries both.
- c1: the "Deck outline" bar at the top of the left column (Undo/Redo delete, Import/export history, Clear history) becomes the full-width strip.
- c3: title text orange that reverts to white on hover (option c); the step NUMERALS orange too; the circle's ring unchanged; the copy stays "deck context".
- c9: keep the code-well background; colour the TEXT of the code blocks (example blocks, and the signature block since it is code too) the way an editor does: strings, keywords, functions, numbers in distinct colours. The image did not arrive; the reading is "VS Code-like token colouring, not those exact colours".
- c12: the pet's toggle moves from Enter to a bare Shift tap (Shift pressed and released with no other key in between), never while typing in a field; Enter presses whatever is focused. Shift+Tab and Shift+letter must not toggle it.
- d1 + d3: shot lists are memberships, not copies. A scene/shot row can belong to many lists (a link table with per-list order); "new list from the current one" links the same rows; a picker lets you add shots from any earlier list. Consequence to state in the brief: editing a shared shot's fields changes it in every list that contains it (only order and membership are per list).
- d6: edits may be created on any shot list, active or not.
- d8: shot lists and edits: project managers ("leads"), members AND reviewers may create and edit (reviewers are comment-only in the database today, so this is a new gate). Budget, budget versions and the timeline's budget-version picker: project managers/admins only.
- d22: with shared rows, a shot's takes and files show from every list that contains it (her requirement). The `scenes.json` mirror in the desktop's readable database folder: kept (harmless). No EDL/CSV export in v1.
- e3: nine tags (Notes removed): Production, Creative, Legal, Finance, Reference, Assets, Code, Shots, Documentation.
- e6: no FBX/3D viewer; the file shows an icon and Download.
- E-note: Kind and Description must persist in the cloud, which is Track C's migration 0075 — another reason the track merge comes first.

## 2026-10-01 — the Legal gate (E4a), in chat with the controller

Asked: (1) who can see a file tagged Legal — the same people as money files (workspace admins and the project's managers), or wider as first written (plus project reviewers and workspace-level managers); (2) whether "Legal only when the file is added" is acceptable, since the protection is the file's storage folder, fixed at upload.

Her answers, verbatim:

1. same as money files for now.
2. thats fine. yes that makes sense that its just the folder that is locked.

Built by bundle S4b (`docs/sessions/briefs/po-s4b-legal-gate.md`).
