# Walkthrough 12 — Desktop, Local Server mode, after the lock

**Track B, bundle B3 (2026-09-07).** What this proves: the desktop app's own
Express server now demands a **per-launch token** on every request, and
**nothing you use went dark because of it** — thumbnails, video previews,
invoices and the O.T.T.E.R. local library all still work. And that launching
WILSON a second time brings the running window to the front instead of opening
a second copy.

**Where:** the **desktop app only**. None of this exists on the web — there is
no local server there. You do not need to be signed in for most of it; Local
Server mode is the signed-out / solo backend.

**Why you are being asked to click through this rather than trust the tests.**
The change puts a gate in front of ~94 routes, and `fetch` in a browser
**resolves for every status** — a refused request does not throw, it comes back
as a 401 that an unchecked caller renders as *an empty list, a missing
thumbnail, a video that never starts*. That failure is silent by construction.
The harness proves the gate refuses strangers; only your eyes prove it still
lets the app in. **So the thing to watch for throughout is emptiness where
there should be content** — a blank thumbnail grid, a course list with nothing
in it, a video that spins. Any of those is the finding, and worth reporting
even if you are not sure.

Every label quoted below was grep-verified against `src/` on the day this was
written.

---

## Step 0 — Get into Local Server mode

1. Open the desktop app.
2. **Settings → Storage** (the tab is called `Storage`, not RABBIT).
3. Under the heading **`Storage Backend`**, choose **`Local Server`**. Its hint
   reads *"In-app Express server (desktop only — single user)"*.
   - **Expect:** the button becomes the active one.
   - ⚠️ Switching backends **does not move any data** — the panel says so. You
     are looking at whatever already lives in the local backend, which may be
     an older or emptier set of projects than your cloud one. That is normal
     and is not what this walkthrough is hunting.

---

## Step 1 — Thumbnails

1. Open **Projects**, open a project, go to its **Files**.
2. Look at the file grid.
   - **Expect:** image and video files show **picture previews**, not
     generic file-type icons.
   - 🚨 **The finding to report:** every tile showing a grey icon where it used
     to show a picture. Thumbnails are `<img>` loads against the local server —
     the exact thing the new cookie has to carry.
3. Open **Scenes**, **Assets**, **Levels** or **Experiences** in the same
   project — anywhere with a thumbnail beside a row.
   - **Expect:** the same pictures you saw before.
   - (These are a *different* kind of request from the Files ones, so they are
     worth a separate look even though they look the same on screen.)

## Step 2 — Video preview

1. Click a video file to preview it.
   - **Expect:** it plays. Scrub to the middle and to the end.
   - **Expect:** scrubbing works — the player jumps rather than re-downloading
     from the start.
2. **Expect:** a still frame appears on the video's tile in the grid, if it did
   not already have one.
   - ⚠️ If the video is a professional format (ProRes, DNxHD, MXF, R3D, BRAW)
     and you have never installed the optional ffmpeg binary, a **file-type
     icon is the correct result** — that is the pre-existing install step
     recorded in `OUTSTANDING.md`, not this bundle. Ordinary `.mp4` / `.mov` /
     `.webm` files must show a frame.

## Step 3 — Invoices

1. **Budget → Crew** (or **Talent**). On an actuals cell, use **Attach** and
   pick any PDF.
   - **Expect:** it attaches, with no error.
2. Click it again to **open** it.
   - **Expect:** the PDF opens and is the file you attached.

## Step 4 — O.T.T.E.R., locally

1. Open **O.T.T.E.R.** while in Local Server mode.
   - **Expect:** your local course list appears.
   - 🚨 **The finding to report:** an empty course list where you know courses
     exist on this machine.
2. Open a course, open a subject, open a lesson.
   - **Expect:** the content loads.
3. Change something small — mark a lesson complete, or add a reference URL.
   Close the course and re-open it.
   - **Expect:** the change stuck. (Writes go through the same gate as reads.)

## Step 5 — The pet, and the app's own settings

1. Look at the companion on the Home screen.
   - **Expect:** it is there and it is the pet you had, not a fresh egg.
2. **Settings → General**, change something and come back to it.
   - **Expect:** it stuck.

## Step 6 — One copy at a time 🚨

1. Leave WILSON **running**.
2. Launch it again from the Start Menu (or the desktop shortcut) — the way you
   normally would if you forgot it was open.
   - **Expect:** the window you already had **comes to the front**. No second
     window, no splash, no second copy in the taskbar.
3. **Minimise** WILSON, then launch it from the Start Menu again.
   - **Expect:** it **restores** and comes to the front.
4. Now quit WILSON properly and start it once more.
   - **Expect:** it starts normally. (A lock that leaks would refuse to start
     the *next* time — this step is the one that catches that.)

## Step 7 — Restart, and check nothing was remembered that should not be

1. Quit WILSON completely and start it again.
2. Repeat **Step 1** and **Step 2** quickly — one thumbnail, one video.
   - **Expect:** both still work.
   - *Why this step exists:* the token is new on every launch, so a stale one
     left over from the previous run must not be trusted. If the app worked
     before the restart and is empty after it, that is exactly the bug this
     step is for, and it is worth reporting immediately.

---

## What to send back

For each step: **worked** / **did not work**, and for anything that did not, a
screenshot plus which project and file it was. Emptiness is the signal — a
blank grid, an empty list, a stalled video — so please report those even when
they look like "nothing happened".

Two things are **known and not this bundle's fault**, so no need to report
them:

- Professional codecs with no preview until the optional ffmpeg binary is
  installed (Step 2's warning).
- Local Server mode showing a different set of projects from cloud mode —
  the backends are separate stores and nothing migrates between them.

## What I already checked, so you do not have to

Run by hand on this machine against a real 12 MB `.mp4` before this was
written: the video streamed with working seeks, `<video>` decoded a frame to a
canvas, the cached preview came back as an `<img>`, an invoice round-tripped
its bytes, and O.T.T.E.R. create / read / update / delete all answered
normally. From a process **outside** WILSON, the same routes answer `401` with
an empty body — before this bundle, one of them returned the full project list.
A second launch exited immediately and raised the running window.

What I could **not** check by hand, and why your pass matters: every screen was
exercised through the app's data layer rather than by clicking, and no
professional-codec footage or real invoice PDF was available on this machine.
