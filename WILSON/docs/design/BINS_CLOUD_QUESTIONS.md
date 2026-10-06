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

**B2. How a footage location is written down.**
*(Revised 2026-10-06 after your answer that the footage lives on the server, on the local network.)* A location on the server is saved as its **network address** (`\\server\footage`), which is the same from every computer on the network — never as a drive letter like `Z:`, which means something different on each machine (the storage design refused drive letters for that reason). Each location also gets a **name** ("Footage NAS"). Only when a computer can see the location just as a drive letter does WILSON ask, once, where it is on that computer.

My pick: **yes** — network addresses, names for people, the per-computer question only as the fallback.

**B3. What does a teammate see for a clip their computer cannot reach?**
Their drive is unplugged, or they are working from home. My proposal: the clip still shows in the bin with its picture, name, notes, flags and length, marked "not on this computer". They can still log it, flag it and assign it to a shot. They cannot play it.

My pick: **yes.**

**B4. One small picture per clip goes to the cloud.**
For B3 to work, WILSON uploads one small still picture of each clip (a few kilobytes) when the clip is added, so teammates can see what it is. No video is uploaded. Scrubbing by hovering still works only where the file is present.

My pick: **yes.**

**B5. In a web browser — and for people working remotely.**
*(Revised 2026-10-06 after your answers: remote people and people who prefer the web app must be able to play and scrub, the footage stays on the server, and the company admin decides whether files may be viewed remotely.)*

A browser cannot read a file on the server by itself, so for a browser to play a clip that stays on the server, **something on the server's side has to send it over the web**. The honest choices:

- (a) **A small WILSON service installed on the company's server** (the "file gateway" the storage design describes). It checks who is asking (their WILSON sign-in), reads the clip from the server, sends it to the browser in pieces so it can scrub, and logs every read. On the office network it just works; **for remote people it works only when the company admin turns remote viewing on** — that switch is the admin's choice you asked for, it is off by default, and it says at the switch what turning it on means for a studio that needs TPN certification (remote access to content then runs outside the TPN-prescribed VPN model). This is the real answer to your requirement; it is also a real piece of software — roughly three to five sessions, installed and updated on the company's server.
- (b) **Small preview copies uploaded to the cloud** for the clips remote people need. Nothing on the server is exposed, but it is a copy, and it costs storage.
- (c) **The browser shows the catalogue only** (everything but playback), and playing stays in the desktop app — the earlier draft of this question.

Two things to know either way: the desktop app, for remote people, works over the company's VPN or the NAS's own remote access with no WILSON work; and scrubbing multi-GB footage over a home internet link is slow by physics, whichever route carries it — a note for the setup guide, not a defect.

My pick: **(a), built after the first three sessions, with (c) as what the browser shows until then.** (b) stays available for a company that cannot install anything on its server.

**B5a. The remote-viewing switch.** Per company, set by the admin, off by default: "Allow files to be viewed from outside the office network." When off, the gateway answers only inside the network. My pick: **yes, exactly that.**

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

## What you told me on 2026-10-06, in chat (recorded verbatim; it shapes B1, B2, B5 and B5a)

> *"one thing i want to confirm, for bins. if i have them in a local server. i need to be able to view them and access them in the local app and if possible in the webapp. at the very least i need to view them for the local server WITHOUT having to download them to the local pc drive. i need to access and view them without needing to download to my local drive. for context for editing and animation, i am accessing the files where they are, im not downloading them and making a local copy."*
>
> 1. *"the footage would live in the server. so the user is going to just pull the path in the server not the actual files themselves and save them locally. but in a Locally accessed network."*
> 2. *"people working remotely and people who prefer to view the project as a webapp instead of the local app. to confirm the company admin should have the ability to choose if people can view files remotely or not."*
> 3. *"yes play and scrub"*

What is already true: the desktop app never copies footage — a bin records where the file is and streams it from there; only a small poster image per clip is kept on the computer. What is not yet true: Bins while signed in to a company (B1–B13), and any playback in a browser (B5).

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
b2 yes. a location is saved as its network address with a name. a computer is asked where it is only when it can see it as a drive letter.
b3 yes. a clip my computer cannot reach still shows with its picture and details, marked not on this computer, and i can still log it, flag it and assign it to a shot.
b4 yes. one small picture per clip is uploaded. no video.
b5 build the small WILSON service on the company server so the web app can play and scrub clips that stay on the server, after the first three sessions. until then the browser shows the catalogue only. preview copies in the cloud stay as the option for a company that cannot install anything on its server.
b5a yes. the admin's switch, per company, off by default: allow files to be viewed from outside the office network.
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
