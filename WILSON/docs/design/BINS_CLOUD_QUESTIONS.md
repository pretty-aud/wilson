# Bins on the cloud — the questions before the plan (2026-10-05)

Written by the controller at Audrey's word ("do 2 and 5", 2026-10-05). Thirteen questions, each in plain words with the choices and the answer I would pick. An answer block to copy is at the end: change any line, paste it back, and the plan and briefs are written from it.

## Why this is needed

Your rule (A9): *"i need the system to work the same if im using a cloud based solution or a NAS server."* Today Bins do not: bins, the takes on a shot and "Show in Bins" work only in the desktop app when nobody is signed in (its Local Server mode). On the beta, or signed in to a company, the Bins tab is there but holds only a notice saying Bins need the desktop app in Local Server mode.

## How Bins work today (so the questions make sense)

- A bin is a list of clips, stills, audio, sequences and documents. **WILSON never copies the footage.** It remembers where each file is on your computer or drive, and reads it from there (your answer of 2026-09-10: "reference in place").
- For each clip WILSON makes a small picture and reads its length, size and frame rate, using the copy of ffmpeg on your computer.
- If a drive is unplugged the clip shows as offline, and WILSON finds it again when the drive comes back or you point at the folder.
- Everything you log — names, slate, take, camera, notes, select / reject, colours, circled takes, which takes belong to which shot — is saved inside the project file on your computer.

Moving Bins to the cloud means moving that last part, the **logging and the lists**, into the shared database so the whole team sees it. The questions are about everything around that.

---

## The questions

**B1. Where does the footage itself live?**
Raw footage is huge, so this is the big one.
- (a) **The footage stays where it is** — on your drives or the NAS. Only the lists and the logging go to the cloud. Nothing uploads, nothing costs storage. A person plays a clip only on a computer that can reach the file.
- (b) **The footage uploads to cloud storage.** Everyone can play everything from anywhere, but uploads take hours and fill paid storage fast.
- (c) (a), plus later an optional "upload a small preview of this clip" for the few clips a remote person must watch.

My pick: **(a) now, (c) later.** It matches how Bins already work and how editors work off a shared NAS.

**B2. The same drive has a different address on every computer.**
The NAS might be `Z:\Footage` on your PC and something else on an editor's. My proposal: every footage location gets a **name** ("Footage NAS", "Shoot drive 2"). The first time someone opens the project on a computer, WILSON asks once: "Where is 'Footage NAS' on this computer?" They point at the folder, WILSON remembers it for that computer, and every clip under it is found from then on.

My pick: **yes.**

**B3. What does a teammate see for a clip their computer cannot reach?**
Their drive is unplugged, or they are working from home. My proposal: the clip still shows in the bin with its picture, name, notes, flags and length, marked "not on this computer". They can still log it, flag it and assign it to a shot. They cannot play it.

My pick: **yes.**

**B4. One small picture per clip goes to the cloud.**
For B3 to work, WILSON uploads one small still picture of each clip (a few kilobytes) when the clip is added, so teammates can see what it is. No video is uploaded. Scrubbing by hovering still works only where the file is present.

My pick: **yes.**

**B5. In a web browser.**
A browser cannot read files on your drives at all. My proposal: in the browser the Bins tab shows every bin and clip and lets people log, flag and assign takes to shots — but adding files and playing them needs the desktop app, and the page says so plainly.

My pick: **yes.**

**B6. Who may do what.**
My proposal, matching your shot-list ruling (reviewers may make and edit shot lists and edits):
- **Managers and members:** everything — make and remove bins, add and remove clips, log, flag, assign takes.
- **Reviewers:** flag (select / reject), colour, circle, write notes, and assign takes to shots. They cannot add or remove clips or bins.

My pick: **yes.** (The other choices: reviewers read-only, or reviewers the same as members.)

**B7. Live updates.**
When one person flags a take or assigns it to a shot, everyone else sees it without reloading, the way the rest of the project updates.

My pick: **yes.**

**B8. Two people add the same clip.**
If a clip is already in the project (same named location, same file), WILSON says "already in this project" and offers Skip or Add anyway — the same question you get today.

My pick: **yes.**

**B9. Your existing desktop projects.**
When a desktop project moves to the cloud, its bins, logging, flags and takes move with it. WILSON asks you to name each footage location once (B2) and uploads the small pictures (B4).

My pick: **yes.**

**B10. Removing a clip or a bin.**
Same as today: removing a clip from a bin never touches the file on disk. On the cloud it disappears for everyone, with undo for the person who did it. Removing a bin that still has clips asks whether to move them or remove them too.

My pick: **yes.**

**B11. Footage that only one person has.**
A clip on someone's own drive that is never shared will read "not on this computer" for everybody else, for good. My proposal: that is fine — the clip shows who added it and the name of the location it came from, so people know whom to ask.

My pick: **yes.** (The other choice: a location can be marked private, and its clips are hidden from everyone else.)

**B12. The desktop with nobody signed in.**
It stays exactly as it is today: bins saved in the project file on that computer, nothing uploaded.

My pick: **yes.**

**B13. When, and in how many pieces.**
Three sessions, one after another: (1) the database and the plumbing; (2) the desktop app signed in — adding clips, the pictures, the named locations, finding files again; (3) the browser's Bins tab, and moving desktop projects over. They can start once the budget-versions session is in, and do not have to wait for the beta.

My pick: **yes, in that order, starting after the budget-versions session.**

---

## Things I decided without asking (say if any is wrong)

- "Assemblies" (the idea from the demo plan) stays dropped: edits replaced it in your D6 answer.
- No previews, proxies or converted copies in this round (your 2026-09-10 answer); B1 (c) is the door for later.
- WILSON never deletes footage from a drive, in any mode.
- A clip's length, size and frame rate are read on the computer that adds it and saved with the clip, so people who cannot reach the file still see them.
- Private projects stay private here too: a bin in a private project is visible only to the people on that project.
- Bins hold footage, not money or legal papers: the money and Legal locks do not apply to them.

---

## The answer block (copy, change what you disagree with, paste back)

```
b1 the footage stays where it is. only the lists and the logging go to the cloud. an optional small preview upload for chosen clips can come later.
b2 yes. every footage location gets a name, and each computer is asked once where that location is.
b3 yes. a clip my computer cannot reach still shows with its picture and details, marked not on this computer, and i can still log it, flag it and assign it to a shot.
b4 yes. one small picture per clip is uploaded. no video.
b5 yes. in the browser i can see, log, flag and assign takes. adding and playing files needs the desktop app.
b6 yes. managers and members do everything. reviewers can flag, colour, circle, write notes and assign takes, but cannot add or remove clips or bins.
b7 yes
b8 yes
b9 yes
b10 yes
b11 yes. the clip shows who added it and which location it came from.
b12 yes
b13 yes, three sessions in that order, starting after the budget-versions session.
decided-without-asking all good
```
