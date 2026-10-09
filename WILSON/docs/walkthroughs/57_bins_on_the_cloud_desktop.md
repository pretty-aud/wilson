# 57 — BINS ON THE CLOUD: the desktop app signed in (R.A.B.B.I.T. → BINS; App settings → Storage)

1. **The footage never moves.** A cloud clip is a footage LOCATION (the
   company's share, saved once by its network address, `\\server\footage`,
   and named) plus a path inside it; WILSON records where the file is and
   reads it from there on a computer that can reach it. Nothing uploads,
   nothing costs footage storage (B1, B2).
2. **A clip's small picture goes to the cloud only while the company's admin
   has turned "Allow files to be viewed from outside the office network" on**
   (B4, B5a). The database refuses the upload while it is off; the client
   asks the switch first so a person reads a sentence, not a storage error.
   A teammate on the office network makes their own picture from the file.
3. **Reviewers may do everything members may in bins** (B6): the gate for all
   four tables is `can_edit_shot_lists()`, and `project.bins.write` in the
   client matrix mirrors it. Removing a clip or a bin removes rows, never a
   byte on the server (B10), and the undo puts the rows and their takes back.

**What this is.** The Bins tab working on the cloud from the desktop app.
The company names its shares once (App settings → Storage → **Footage
locations**); anyone in the company then adds clips from those shares on any
desktop that can reach them, and everyone sees the same bins. A clip plays
and scrubs straight off the share. A computer that cannot reach a share says
so, by the share's name, and still lets you log, flag and assign the clip. A
computer that sees the share as a drive letter is asked once where it is.
The admin's switch decides whether the small pictures may leave the office.

**One thing new since the plan: Connect.** Anyone in the company can name a
location, so each computer connects to a location's address only once **its
own person agrees**: **Connect…** asks Windows to confirm the address first
(Cancel is the default). Until then that computer never touches the address
and its clips read *Not connected on this computer*. Picking files on the
share in the desktop's own file dialog counts as agreeing. (The reviewers'
reason: otherwise one person's location row would make every teammate's
computer contact a server of that person's choosing, with their Windows
sign-in.)

Written 2026-10-09 against `feat/post-overhaul-edit-versioning` (BC2,
`po/bc2-bins-desktop`). No database migration: BC1's 0091 holds everything.
The signed-out desktop (the Local Server) is unchanged: its bins, its
"offline" and its relink work as before.

**Before you start.** You need the desktop app signed in to the cloud, and a
share on the office network with some footage on it, written as its network
address (`\\server\share`, never `Z:`). On the development copy's test data,
the company already has one location, **Footage NAS**
(`\\salthours-nas\footage`), which no computer can reach: it is where its
sixteen clips "are", so it shows what "not connected" and "not on this
computer" look like.

---

## 1. Step by step

**A. Name the company's share (once, for everyone)**

| # | Do | You should see |
|---|----|----------------|
| 1 | **App settings → Storage**, scroll to **Footage locations** | The company's list: each location's name, its address in mono, *Added by …* and, on the desktop, what THIS computer can do: *Not connected on this computer* (with **Connect…**), *Reachable from this computer*, *Not reachable from this computer*, or *On this computer at Z:\footage*. Under the list, **Add a location**: a name, an address and **Add location**. |
| 2 | Type a name (*Office share*) and your share's address, click **Add location** | Windows asks at once: *Connect this computer to \\server\footage?* with **Connect** and **Cancel** (Cancel is the default). Click **Connect**: the location joins the list with *Reachable from this computer*. Typed with forward slashes or a trailing backslash, the address is tidied for you. |
| 3 | Try `Z:\footage`, `\\localhost\C$` or `\\localhost@8080\x` | Refused before it is sent, with the sentence: *A footage location is written as its network address, like \\server\footage — never a drive letter, never this computer (localhost), never an administrative share like C$ …* |
| 4 | Add a location whose server is off (an old NAS) | After Connect, about two seconds, then *Not reachable from this computer*. The window never freezes while it waits (before this session a dead address held the whole app for up to 42 seconds). **Remove** it again: refused only while clips use it. |

**B. Add clips from it**

| # | Do | You should see |
|---|----|----------------|
| 5 | **R.A.B.B.I.T. → a project → Bins**, pick a bin, **Add → Files…** | The Windows file dialog opens **at the company's share** (the first location this computer reaches). Pick two clips. |
| 6 | Read the add dialog | *Add to "Day 1"*, the clips with what WILSON read from their names (slate, take, camera, roll, day) and their sizes, *referenced in place*. Nothing is copied. |
| 7 | **Add 2 items** | *Reading 1 of 2 on the share…* while it reads each clip's length, size and codec, then the rows, with a picture made on this computer. Each clip is read once. |
| 8 | **Add → Folder…**, pick a folder holding a frame sequence | The sequence is **one item** (*SEQ*); its folder becomes a nested bin, as on the signed-out desktop. |
| 9 | Add a file from a share the company has not named yet | The dialog asks: *N files are on \\server\share, which is not one of the company's footage locations yet. Which location is this? Name it to add them.* — with the share's own name to start from and **Add as a footage location**. (You picked on that share yourself, so no Connect question follows.) |
| 10 | Add a file from your own disk (`C:\…`) | It is set aside: *This file is not inside any of the company's footage locations. Add it from the share's network address, or name the share as a location first.* |
| 11 | Add the same clip again | It arrives unticked, marked *already in "Day 1"* (the same location, the same path): leave it unticked to skip it, or tick it to add it anyway, as the signed-out desktop has always done. |

**C. A second computer sees the same clips**

| # | Do | You should see |
|---|----|----------------|
| 12 | Sign in on a second computer (the desktop app) that reaches the share | The same bins, clips and logging. The share reads *not connected on this computer yet* until you click **Connect…** there (once per computer); then each clip plays there from the share, with its picture made there (or shown from the cloud while the switch is on). |
| 13 | Open the same project in a browser | The clips and their logging; pictures only if the switch is on. **Add** is greyed: *Adding clips needs the desktop app on a computer that can reach the footage.* (The browser's own Bins work is BC3.) |

**D. A clip this computer cannot reach**

| # | Do | You should see |
|---|----|----------------|
| 14 | Open a project whose clips are on a location this computer has not connected to (on the test data: any clip on **Footage NAS**) | One notice: *"Footage NAS" (\\salthours-nas\footage) is not connected on this computer yet, so its clips cannot be played here. Connect only to a share you recognise.* with **Connect…**. The toolbar, the filter chip and the bin tree's footer say *16 not on this computer*. The tiles keep their pictures. |
| 15 | Click **Connect…**, then **Connect** in Windows' question | On a share this computer cannot reach: about two seconds, then *"Footage NAS" is not reachable from this computer, so their clips cannot be played here.* with **Where is it on this computer?** |
| 16 | Select one of those clips | The preview says **Not on this computer** and why (*not connected on this computer yet*, or *not reachable from this computer*), and that *it can still be logged, flagged and assigned to a shot*. Select, Reject, Circle, colours, the logging fields and **Assign to shot** all work; **Open with the default app** is greyed. The file section shows *Location*, *Path* (inside the location) and *Added by*. |

**E. The company's switch**

| # | Do | You should see |
|---|----|----------------|
| 17 | **App settings → Storage → Viewing from outside the office network** (as a workspace admin) | Off by default. The switch's own label, *Allow files to be viewed from outside the office network*, and directly under it the TPN sentence: *Turning on external access is the moment this workspace leaves TPN Gold Shield eligibility …* |
| 18 | With it **off**, add clips (steps 5–7) | Pictures are made and kept on this computer; **none goes to the cloud**. A teammate who cannot reach the share sees only names. |
| 19 | Turn it **on** | *Viewing from outside the office turned on* with **Undo**. Back in Bins: *3 clips this computer reaches have no picture in the cloud yet, so teammates who cannot reach the share see only their names.* with **Upload pictures for 3 clips**. |
| 20 | Click **Upload pictures for 3 clips** | *Uploading…*, then the banner goes (a clip whose picture cannot be made on this computer is said, and not offered again). Turn the switch off again: nothing is deleted (the section says so); pictures already up stay until their clips are removed. |
| 21 | As a member who is not an admin | The state (*On* / *Off*) and *Only a workspace admin can change whether files may be viewed from outside the office network.* — no switch. |

**F. Play and scrub on the network path**

| # | Do | You should see |
|---|----|----------------|
| 22 | Select a clip on a share this computer reaches | The preview plays it straight off the share (*Space plays · hover a tile in the grid to scrub*). Scrubbing the timeline answers at once. |
| 23 | Hover across a tile in the grid | It scrubs through the clip. |
| 24 | **Open with the default app** / **Reveal** | The clip opens in Windows' player, or Explorer opens at it. A file that is not a picture, video, audio, document or 3D file is refused (a share holds whatever its folders hold). |

**G. Where a location is on this computer (the relink)**

| # | Do | You should see |
|---|----|----------------|
| 25 | On a computer that sees a share only as a drive letter, click **Where is it on this computer?** (on the Bins notice, by the location in Settings, or in the relink dialog) | A folder dialog titled *Where is \\salthours-nas\footage on this computer?*. Pick the drive or folder. |
| 26 | After picking | *"Footage NAS" is set for this computer.* Its clips found in that folder come back at once; the notice goes. Only this computer keeps the answer. In Settings: *On this computer at …* and **Forget this computer's folder**. |
| 27 | Click the toolbar's *N not on this computer* | **Clips not on this computer**: per location, **Connect…** (where not connected) and **Where is it on this computer?**. A clip missing inside a location this computer DOES reach is not relinked by its path: *These N clips are not at their paths on a share this computer reaches. A clip keeps its path for everyone, so it cannot be relinked from here: put the file back where it was on the share, or remove the clip from its bin.* |

**H. Help**

| # | Do | You should see |
|---|----|----------------|
| 28 | R.A.B.B.I.T.'s **Help (?)** → **Bins** | *Footage locations* (with Connect), *Adding clips*, *Not on this computer*, *Play and scrub*, *Pictures and the company's switch*. |

**What the words mean.** A **footage location** is the company's name for a
share (*Office share* = `\\server\footage`). **Connect** is this computer's
own agreement to contact that address. **Not on this computer** means this
computer cannot reach the clip's location right now (or has not connected
to it); it is a fact about this computer, not about the clip. **The switch**
is the company's: it decides whether pictures may leave the office.

---

## 2. How to check it

- The tests: `npx vitest run src/tools/rabbit_v0.1.0/bins src/tools/rabbit_v0.1.0/adapters src/components/settings src/tools/rabbit_v0.1.0/state src/dev/fixtures` — among them `rabbitCloudBinsDesktop.routes.test.js` (the desktop's routes over real files), `rabbitCloudBinsDeadShare.routes.test.js` (a server that never answers, one that answers late, an address nobody agreed to, Connect), `rabbitCloudBinsRootCap.routes.test.js`, `desktopCloudBins.test.js` (the composite), `binsDesktopProvider.test.jsx` (the provider), `footageSettings.test.jsx`, `binsViewCloud.test.jsx`, `addFilesCloud.test.jsx`, `binPosterCloud.test.jsx`, `binPosterNoProvider.test.jsx`, `deleteShotTakes.test.jsx`.
- In the development copy (port 5285, the test data): App settings → Storage shows **Footage locations** and the switch; the Bins tab shows *16 not on this computer*.
- The real thing: the desktop app signed in, a share on the office network. §5's checklist.

## 3. The numbers, measured

On a real UNC path: `\\SUSAN-FAIRCHILD@8765\footage`, a read-only share stood
up for the test and reached through Windows' own network redirector (WebDAV),
on this computer. Not SMB across a LAN (no administrator rights to make an
SMB share), so these are a lower bound for an office network. Clips: two
H.264 MP4s of 2.0 and 1.7 MB (6 s), a 12-frame PNG sequence, a WAV, a JPEG.
The desktop's real routes ran on Express; the renderer ran in Chromium at both
sizes (the final runs, after both review rounds).

| Step | 1440x900 | 1280x700 |
|---|---|---|
| Add the share as a location (and Connect) → *Reachable* | 0.18 s | 0.24 s |
| Add a location on an address nothing answers → *Not reachable* | 2.2 s | 2.4 s |
| **Connect…** on the test data's NAS (a name that does not resolve) → *not reachable* | 2.3 s | 2.3 s |
| **Files…** → the dialog lists 2 clips | 0.07 s | 0.07 s |
| **Add 2 items** → rows, read by ffmpeg on the share | 0.70 s | 0.32 s |
| **Folder…** → the sequence found | 0.13 s | 0.15 s |
| Select a clip → first frame playable | 0.11 s | 0.11 s |
| Scrub to 25 / 60 / 90 % | 79 / 93 / 116 ms | 86 / 110 / 117 ms |
| Turn the switch on | 0.46 s | 0.46 s |
| Catch-up, 3 pictures | 0.29 s | 0.35 s |
| **Where is it on this computer?** → clips back | 0.26 s | 0.24 s |

A server that does not answer, before and after this session:

| What | Before | Now |
|---|---|---|
| First check of a name that does not resolve | 5.0 s, window frozen | at most 2 s, window free |
| First check of an address nothing answers | 42.1 s, window frozen | at most 2 s, window free |
| The app's own files while six such checks are held (the desktop app itself) | — | 2 ms |

## 4. Still not right, and not this session's to change

- **Not run in the desktop app signed in to wilson-dev.** The smoke users'
  password is a GitHub secret, not in the repository, and making an account
  or reusing an old password was not allowed. What ran instead: (1) the
  desktop's real routes (`electron/rabbitBins.cjs`, mounted as the app mounts
  them) over the real UNC path with the real renderer, on the test data as
  the cloud, every screen in §1 (the OS file dialog's and the Connect
  question's answers queued, Open/Reveal recorded, not performed); (2) the
  desktop app itself, signed out, three short runs reading the share from
  its own main process: registration, resolve, a 64 KB Range read (206) in
  51–54 ms, ffmpeg's probe in 60 ms, a poster in 151 ms; an address not
  agreed to never touched, Cancel changing nothing, Connect kept on disk;
  six dead locations held while the app's own file answered in 2 ms and the
  share's clip resolved in 13 ms.
- **Adding a big folder walks it on the window's own thread** (as the
  signed-out desktop always has): thousands of files on a slow share can
  hold the window for seconds while the add dialog fills.
- **The signed-out desktop still checks a dead share on the window's thread**
  (its own routes, B12: untouched). A Local Server project whose drive is a
  dead network address can still freeze its window for seconds.
- **The browser's Bins** (adding nothing, playing nothing, pictures only
  while the switch is on) is BC3.

## 5. Questions, when you test

1. **Connect, once per computer.** Anyone in the company can name a
   location, so each computer asks its own person before it contacts the
   address (Windows' question, naming the address, Cancel by default). Keep
   that, or should only admins be able to add or re-address locations (a
   database change), with every computer then trusting the list?
2. **Where the locations live.** App settings → Storage, under the backend
   choice, shown only on the cloud. Right place, or a company page?
3. **Who may add, rename and remove locations.** Anyone past the Bins gate
   (members and reviewers, B6), as the database allows. Keep, or admins only?
4. **The switch flips at once, with Undo** (no "Are you sure?"), the TPN
   sentence directly under its label. Enough, or a confirmation on turning it on?
5. **"Where is it on this computer?"** appears where this computer cannot
   reach the location (and *Forget this computer's folder* once one is
   saved). Should it be offered on every location, always?
6. **Pictures upload by themselves after an add while the switch is on;** after
   turning it on, the older clips wait for **Upload pictures for N clips**.
   Should turning it on upload them at once instead?
7. **A folder becomes a nested bin** (VFX plates › VFX), as on the signed-out
   desktop. Keep on the cloud?
8. **Two seconds** before a silent share is called *Not reachable*; a share
   found off is asked again a minute later (fifteen seconds when only one
   clip was slow). Right for your office?
9. **The words.** *Not on this computer* and *Not connected on this computer*
   for a company's clips; *offline* stays for the signed-out desktop's. Right?

**Checklist for the real thing** (desktop app, signed in, office share):
add the share and Connect; add two clips and a folder; play and scrub one; a
second computer sees them after its own Connect; switch off → no picture for
a teammate off the network, on → **Upload pictures**; unplug the network →
*not on this computer* by the share's name, logging still works; plug it
back → they come back on the next refresh. If after Connect nothing changes
on the Bins tab, reload the tab and tell me (§4 of the hand-off: an
intermittent stall seen in the rehearsal, never in the desktop app).

---

## What was checked, and what was not

Checked: every step in §1 except 12, 13, 21 and 24's real Windows player
(the shell was recorded) at 1440x900 and 1280x700 on the test data, with the
desktop's real routes over a real UNC path (screenshots
`docs/sessions/handoffs/img/po-bc2-*`); the desktop app itself, signed out,
reading the share from its main process (§4); the tests in §2; the full
suite. Not checked: the desktop app signed in to wilson-dev or the beta (see
§4), SMB across a LAN, a second physical computer, a large clip (only small
test clips), a Mac.
