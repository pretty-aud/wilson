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

## 2026-10-02 — five answers to the controller's status list, in chat

Asked (the controller's "Waiting on you", 2026-10-01 evening): (1) S4b-05 — a workspace manager can give themselves a manager seat on any project and then see its Legal files, invoices and budget; fix it, or keep it? (2) dev needs 0085, then 0088, and `storage-presign` redeployed; (3) walkthrough 51 Q8 — should Clear be allowed on the active shot list? (4) the F answers; (5) the smaller items (the CI CLI pin, the permission line, walkthroughs 48–54).

Her answers, verbatim:

1. workspace managers can have access to the files that is okay. inherently workspace manager may need to access a folder to review things.
2. can you apply them yourself?
3. lets not allow a clear without giving the user a warning and asking them to confirm they want to clear and let them know it will clear things. but also. i want it that if a shot list is removed. dont delete the budget and timeline. just disconnect the projects tasks and phases from be assigned to shots and scenes instead of straight up deleting the timelines
4. i will get to this today
5. ill look into this later

The controller's readings (correct me if wrong):

- **1 — S4b-05 is ACCEPTED; no fix.** A workspace manager may reach a project's Legal and money files. The gate itself is unchanged (workspace admins and the project's managers): a workspace manager gets there by holding a manager seat on that project, which they can give themselves. Nothing records that step; no audit line was asked for. Seeing Legal folders WITHOUT taking the seat would be a change to the money gate (and to d8's "only project admins can access the budget"), and was not asked for.
- **2 — done by the controller on 2026-10-02**, at her request: 0085 then 0088 on wilson-dev, each rehearsed first in a rolled-back run (suite 87 30/30; suite 90 108/108), each with its history row; both suites pass against the applied database; `storage-presign` redeployed there (version 3 → 4; it boots and refuses an unsigned caller). Staging is untouched and still waits for the beta sitting.
- **3a — walkthrough 51 Q8: Clear stays available on the active list, behind its confirm**, which says what it clears. (As built by S3b's round 2.)
- **3b — a new rule: removing a shot list never removes the Timeline or the Budget.** Checked on the branch: it never did in the data — Clear only takes scenes and shots out of a list; no task, phase, key date or budget line is deleted by Clear, Archive, Withdraw, Set active, or by deleting a scene or shot (a deleted scene or shot clears the link on its tasks; phases have no scene or shot link). The fault is on screen: the Timeline's group-by-scene draws only the active list's scenes, so a task assigned to a scene or shot outside it vanishes from that view, and the Budget's By scene / By shot call it "Unknown scene". **Rule for S3c (step 1):** no task ever drops out of the Timeline or the Budget because of what the active list holds; such a task reads as not assigned to a scene (the "No Scene" group, the "No scene" / "No shot" rows); the stored link is KEPT, so the task is under its scene again if the scene returns to the active list, and its tooltip and the task popup say what it points at; the Clear / Set active / Archive / Withdraw questions say this instead of "will no longer show them". Sent to the running S3c session the same day.
- **4, 5** — S5 stays unbriefed until F arrives; the smaller items stay open.

## 2026-10-05 — F and G, pasted in chat (after the controller explained F2, F3, F4, F9, F11, F12, F13 and G in plain words)

Her answers, verbatim:

```
f1 yes

f2 viewing a version is read-only. to edit a version press "Edit this version": WILSON asks once to confirm, then loads that version into the live Timeline and Budget and it becomes the open version. while a version is open, Save writes the changes back INTO that version (for example v2 "mid ROM" stays v2 as i keep working on it), and the page shows when the open version has unsaved changes. a new version is only made on purpose with "Save as new version", which asks for a name. if i open a different version while the open one has unsaved changes, ask me to save them, discard them, or cancel. the locked (active) budget version can't be edited in place, only saved as a new version.

f3 yes

f4 open it. im just using this for testing. its only me on this pc

f5 S5 adopts the shot-list picker, it exists now

f6 yes

f7 yes but to confirm i need to see the total with agency total. i need to see both. both but the total with the agency % is important to be defined as the overall total. 

f8 both; column.

f9 disabled. while the budget is active the Timeline dropdown is greyed out with the reason shown, and the locked bid can't be opened for editing. i still edit the live Timeline during production as normal. but during production i can still save the current schedule as a new version on purpose (Save as new version, with a name like "revision after week 2") so i have a record of production changes. those production versions stay out of the lock: the active budget stays the frozen bid i locked, and the variance keeps measuring against it.

f10 yes

f11 yes

f12 yes

f13 yes

g all good
```

What led to F2 (her words in the chat, 2026-10-04): *"i need to be able to edit a version when its selected but have someway of asking me to confirm if i want to edit it before i do."* and *"we cant have f2 always create new versions. i need to be able to save different versions. for example one version can be called v2 and specifically be a mid ROM version. im going to keep editing that version and want it saved to that version. not create a new one. it should be more intentional when creating a new one"*. The F2, F9 lines above were drafted by the controller from those words and pasted back by her unchanged.

The controller's readings (correct me if wrong):

- **F2 → a bid version is a living document**, with three per-project states: OPEN (its data is in the live Timeline and Budget; Save writes back into it; "unsaved changes" shown), SELECTED (the variance baseline — today's `is_active` column, to be called "selected" in words), LOCKED (the active budget: not openable, Timeline dropdown disabled, live Timeline still editable, Save as new version allowed and unlocked, variance against the locked one). Opening a version also selects it, except while a budget is active. No leave guard: nothing is lost on leaving.
- **F4** opens the money gate on the signed-out desktop Local Server only; the database gates are untouched.
- **F7** the overall total is the one WITH the agency fee when it is on; the before-agency total is stored and shown beside it.
- **F9** adds "Save as new version" during production; those versions are unlocked and do not move the variance.
- **G** stands, with the controller spawning the chips; S5 loads both design skills.

Built by bundle S5 (`docs/sessions/briefs/po-s5-budget-versions.md`).

## 2026-10-05 — the open-version ruling (after S5's first two steps), in chat

Asked by the controller, from S5's review round 1 (R1-05): *When you open "Mid ROM v2", what should happen to tasks that are on the Timeline right now but are not part of v2 — for example the extra tasks you added for "High ROM v3"? (a) They leave the Timeline while v2 is open, and come back when you open v3 again. Each version shows exactly its own schedule. (b) They stay on the Timeline. v2 would say "unsaved changes" straight away, and pressing Save would add those tasks to v2.* The controller's pick was (a), and it told her that what S5 had built so far did (b) from a sentence of the controller's own draft, not from her F2.

Her answer, verbatim:

```
to answer you a
```

The controller's readings:

- **A version shows exactly its own schedule.** Opening a version makes the live Timeline and Budget equal to it; rows that are not part of it are SET ASIDE (hidden everywhere, nothing on them lost, never in Recently deleted, never purged) and return, the same rows, when a version that holds them is opened.
- The S5 brief's sentence "Tasks added after the version was saved stay as they are (her F2)" is withdrawn: it was the controller's draft wording; her F2 says "loads that version into the live Timeline and Budget".
- Promised to her in the same message: nothing attached to a set-aside task is dropped (comments, files, logged time), and WILSON asks before setting aside a task that has logged time.
- Told to her and not objected to: locking now freezes the version as saved; while a budget is active Save as new version only records a copy; versions saved before S5 cannot be opened for editing; and the next session closes S5-01 (a project member changing the budget's settings directly in the database) under her D8 ruling.

Built by the S5 continuation (`docs/sessions/briefs/po-s5b-budget-versions-screens.md`).
