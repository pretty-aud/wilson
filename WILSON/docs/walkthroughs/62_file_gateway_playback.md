# 62 — PLAYING CLIPS IN THE BROWSER THROUGH THE FILE GATEWAY (R.A.B.B.I.T. → Bins; App settings → Storage → File gateway)

1. **The footage never moves, and WILSON never relays a byte** (your G3).
   A browser plays a clip straight from the company's gateway: in the office
   from the gateway's own address, outside through the one door the company
   opens itself. The cloud only hands out tickets.
2. **A clip plays on a two-minute ticket, renewed while it plays** (D1, D5).
   The browser asks the cloud for a ticket when a clip is hovered or chosen,
   never for the whole catalogue; the gateway's URL carries the ticket and
   never changes while the clip plays; a stream that is not renewed ends
   within two minutes of a viewer's removal or the switch going off. A ticket
   refused is never retried: a fresh one is asked for, once.
3. **Outside the office the viewer is written on the picture** (D9): their
   name, the first six characters of their member id (which they cannot
   change) and the clock, moved to another corner every thirty seconds, over
   every player and in fullscreen. On the office network nothing is drawn
   and nothing is written down (G6, G8).
4. **Only formats a browser decodes play** (G7, D8): MP4/M4V, WebM, a .mov
   whose codec the browser has, the audio formats, the stills. A ProRes
   master keeps its picture and says the desktop app plays it; nothing is
   transcoded anywhere.

**What this is.** GW3, the web app's half of the file gateway (your G1–G9,
D1–D25 and the design's GW3 brief): the Bins tab in a **browser** now plays
a clip through the company's gateway where one answers, in the inspector
and large on **Space**, with the overlay through the outside door, the
sentences for every state the gateway can be in (none enrolled, silent,
unreachable from this browser, a location it cannot read, a clip not at its
path), one clip's viewings from outside opened from the inspector's line
(admins), and the Settings card's lines for a gateway's new root
certificate. It also reconciles the two halves built before it (GW1's
cloud, GW2's program): the workspace id in the enrol and sync answers, the
reach PROOF instead of an echo, a new root certificate landing at sync, a
viewing's fraction as the gateway's coverage — migration **0095** and its
suite **98**.

Written 2026-10-11 against `feat/post-overhaul-edit-versioning` (GW3,
`po/gw3-gateway-web`). Migration 0095 is applied on **wilson-dev only**;
staging's commands are in the hand-off (`docs/sessions/handoffs/po-gw3-2026-10-11.md`,
"Waiting on Audrey"). No real gateway is installed anywhere yet (GW4 writes
the install stories): on the development copy the gateway is acted out in
the page, and the real program was driven on this computer by a script
(§3).

## 1. Step by step

**A. The office door** (the development copy on port 5289, `/rabbit`, the
test data; the gateway is acted out in the page, answering as the office
door)

| # | Do | You should see |
|---|----|----------------|
| 1 | **R.A.B.B.I.T. → Salt Hours → Bins** | The catalogue as before (walkthrough 58), with ONE notice at the top that now reads *This is the catalogue: every bin and clip, with its picture where the company allows one, its logging, its marks and its takes. **Clips play here through the company's file gateway; adding clips still needs the desktop app on a computer that can reach the footage.*** No clip is greyed out. The toolbar's button is still **New bin**. (`po-gw3-01-bins-gateway-notice`) |
| 2 | Click **A001_C001_0921AB_proxy** (an H.264 MP4) | The inspector's preview is the clip itself, with the browser's controls, within a blink of the click: its picture first, then the clip under it the moment the first frame is decoded (D22: nothing but *loading* while the ticket is fetched). No name on the picture. Below: *Space plays the clip large. Hover a tile in the grid to scrub.* (`po-gw3-02-bins-inspector-player-inside`) |
| 3 | Press **Space** | The clip, large, playing, over the files pane — the header with its name, its marks and *Space or Esc closes · arrows move · S, R, U mark*, the footer with *00:03 · 1280×720 · 24 fps · H.264*, a fullscreen button at the top right of the picture (fullscreen takes the whole frame, so the overlay in B goes with it). **Esc** closes it. (`po-gw3-03-bins-player-large-space`) |
| 4 | Move the mouse across the proxy's tile | It scrubs, as on the desktop, from the gateway. The first hover asks the cloud for the clip's ticket; moving across other tiles asks for theirs, one call each, never for the whole grid. |
| 5 | Click **A001_C001_0921AB** (the ProRes master) | The picture, and under it *This clip's format does not play in a browser; the desktop app plays it. (ProRes 422 HQ is not one this browser decodes.)* and *Space shows the picture large*. No ticket is asked for. **Space** shows the picture large with the same sentence. (`po-gw3-04-bins-inspector-needs-desktop-format`, `po-gw3-05-bins-picture-large-prores`) |
| 6 | Right-click the proxy's player | Nothing (the browser's menu with *Save video as* is suppressed); the controls carry no download and no picture-in-picture. These are courtesy, not security: the URL in the page is a two-minute ticket to one clip for one person (D1), and the design says so. |
| 7 | Select the proxy and **A002_C007_0925AB_proxy** together, then press **Space** | Both tickets were asked for in one call when the selection grew (R12); the first plays large. |

**B. The outside door** (`/rabbit?gateway=outside`: the acted gateway
answers as the outside door, as it does when a viewer is on the internet
and the switch is on)

| # | Do | You should see |
|---|----|----------------|
| 8 | **Bins → A001_C001_0921AB_proxy** | The same player, with **MARA OKONKWO · F1C700 · 15:27** written over the picture's top-left corner, small, half-transparent, no blur: the viewer's display name, the first six characters of their member id, the clock. It cannot be turned off. (`po-gw3-06-bins-inspector-player-outside-mark`) |
| 9 | Wait thirty seconds | The mark is in another corner (top-left, top-right, bottom-right, bottom-left, the centre, in turn), so a still frame cannot be cropped free of it. |
| 10 | Press **Space** | The clip large, the mark over it; the fullscreen button takes the frame WITH the mark. (`po-gw3-07-bins-player-large-outside-mark`) |
| 11 | Hover the proxy's tile | The scrub picture carries the mark too. |

**C. No gateway, a silent gateway, an unreachable one** (the §2 table of
sentences)

| # | Do | You should see |
|---|----|----------------|
| 12 | `/rabbit?gateway=none` → Bins (as the test data's admin) | The notice is walkthrough 58's (*Adding clips and playing them need the desktop app…*), with one more line for an admin: *A file gateway lets browsers play clips from the company's server: Settings, Storage.* A member sees no second line. A clip's inspector says *No file gateway is enrolled, so the clip cannot be played in a browser; the desktop app on a computer that reaches the share plays it. It can still be logged, flagged and assigned to a shot.* (`po-gw3-08-bins-notice-no-gateway-admin-line`, `-09-bins-inspector-no-gateway`) |
| 13 | `/rabbit?gateway=unseen` → Bins | *The company's gateway "Salt Hours NAS" has not answered WILSON for 4 minutes, so clips cannot play here. Everything else works; someone on the office network can check it.* Every clip is *not on this computer*. (`po-gw3-10-bins-notice-gateway-unseen`) |
| 14 | `/rabbit?gateway=unreachable` → Bins | *WILSON can see the gateway "Salt Hours NAS" but this browser cannot reach it at 192.168.10.20:8443. On the office network, the gateway's certificate must be installed on this computer (Settings, Storage). From outside, the switch is off or the outside door is not open.* and, under it, *On the gateway's own computer the office door does not answer its own host: use another computer on the office network, or the outside door while the switch is on.* (`po-gw3-11-bins-notice-gateway-unreachable`) |
| 15 | Put the notice away with its × | The two lines stay, in their own strip, until the gateway answers: a silent or unreachable gateway is not something a dismissed notice should hide. The tab asks again every 60 s while it is on screen. (`po-gw3-12-bins-strip-after-dismiss`) |
| 16 | While the first probe runs (the first second after the tab opens) | *Chrome will ask whether WILSON may reach devices on your network; allow it once.* above the notice. In Chrome on a real office network the prompt appears the first time the web app reaches the gateway's address; allowed once, it is remembered for the site. |
| 17 | A clip on a location the gateway reports as not mounted (the test data's Archive) | *"Archive" is not mounted on the gateway, so the clip cannot be played here. It can still be logged, flagged and assigned to a shot.* The other words the gateway can report read the same way: *not connected on the gateway yet (run share-login on the gateway)*, *not reachable through the gateway*, and for an address the gateway refuses, *The gateway cannot use the address of "…"*. |

**D. A clip the gateway cannot find** (`/rabbit?gateway=inside&missing=<the
proxy's id>`: the acted gateway answers 404 for it)

| # | Do | You should see |
|---|----|----------------|
| 18 | **Bins → A001_C001_0921AB_proxy** | The player tries, the gateway answers 404, and the row flips: the tile dims, the toolbar counts *1 not on this computer*, the inspector says *The clip is not at its path on "Footage NAS": the gateway looked and found nothing there. It can still be logged, flagged and assigned to a shot.* The count is a count (no relink dialog in a browser). (`po-gw3-13-bins-inspector-clip-missing-404`) |

**E. One clip's viewings from outside** (item 5; `/rabbit`, as the test
data's admin)

| # | Do | You should see |
|---|----|----------------|
| 19 | **Bins → A001_C001_0921AB** (the master; the test data holds two viewings of it) | The inspector's line *Viewed from outside twice, last by Priya on 9 Oct* is a button. |
| 20 | Click it | *Viewed from outside the office: A001_C001_0921AB* — the Settings card's table, filtered to this clip: when, who, the clip and its project, how much (*1.5 GB of 1.6 GB (97% covered) · read in full*), from where and through which gateway; 25 a page, newest first, **Newer**/**Older** under it when there are more. A member has the line as text and no table (the database answers nobody but an admin). (`po-gw3-14-bins-clip-viewings-table`) |

**F. A gateway's new root certificate** (`/settings?gateways=nextroot`,
Storage; item 0.3)

| # | Do | You should see |
|---|----|----------------|
| 21 | Scroll to **File gateway** | Under the gateway's line, *A new certificate is ready: confirm its fingerprint, then download it*, with a fingerprint box and **Download the new certificate** unlocked only by the fingerprint the gateway printed; the old certificate's download stays beside it until the new root is in use. The trail says *new certificate received* / *confirmed* / *root certificate replaced*. (`po-gw3-15-settings-gateway-next-root`) |

**G. On the real cloud** (wilson-dev, the beta signed in as the smoke
users' admin when you choose)

| # | Do | You should see |
|---|----|----------------|
| 22 | **R.A.B.B.I.T. → a project → Bins** | The notice names the gateway GW1 enrolled with its stub (*GW1 probe gateway*) as silent: *…has not answered WILSON for N hours (or days)…*. Nothing plays, nothing is greyed by a reach report, and every clip's inspector carries the silent-gateway sentence. With a real gateway enrolled (GW4's install stories), the rows play. |

## 2. How to check it

- The tests: `npx vitest run src/tools/rabbit_v0.1.0/adapters/gatewayBins.test.js src/tools/rabbit_v0.1.0/bins src/tools/rabbit_v0.1.0/views/bins src/tools/rabbit_v0.1.0/state/binsProvider.test.jsx src/dev/fixtures src/cloud/gatewayApi.test.js src/components/settings src/tools/rabbit_v0.1.0/rabbitBinsHelp.test.jsx` — among them `gatewayBins.test.js` (the composite: the doors, the four states, tickets on request and in batches of fifty, a ticket within 30 s of its end never reused, the renewal keeping the URL, a 401 never retried, the diagnosis), `gatewayDoors.test.js` (the probe's order, the URLs, the renewal's body, `res.ok` before any body), `gatewayMedia.test.js` (the allow-list word for word, the codec strings), `gatewayVideo.test.jsx` (the hand-over, the mark only through the outside door and its five positions, the renewal at 75 s, one fresh src, the cosmetic measures, fullscreen on the container), `binsViewGateway.test.jsx` (the tab: the sentences per state, the counts, tickets on hover and for a selection, Space as the player, the 60 s re-read, the viewings table for admins), `binsProvider.test.jsx` (the composite through the real provider), `gatewayDoors.test.js` under `src/dev/fixtures` (the acted gateway answers in the real doors' shapes), `rabbitBinsHelp.test.jsx` (Help held to the words). The gateway's side: `npx vitest run gateway` (`doorsOutside.test.mjs` and `runtime.test.mjs` prove the reach PROOF with the design's `proof_vector`, `docs.test.mjs` the hand-off pins).
- The database: suite 98 (`supabase/tests/rls/98_gateway_next_root_viewing_fraction.sql`, 48 probes) runs on every push in CI's pgTAP job after 0095.
- The development copy: the `gw3-worktree` launch entry, port 5289; `scripts/bins-gateway-shots.mjs 5289 --out <dir>` walks §1 A–F and photographs it.
- The real gateway on this computer: `node scripts/gateway-playback-e2e.mjs --port 5289 --scratch <empty folder> [--fast]` (§3). It binds this computer's LAN address for its duration; say so before running it.

## 3. What was rehearsed, and how

- **The tab, §1 A–F**, every step, in Playwright's Chromium at 1440x900 and
  1280x700 on the test data (`scripts/bins-gateway-shots.mjs`; the pictures
  are `docs/sessions/handoffs/img/po-gw3-01` to `-15`, at both sizes). Steps
  2, 4, 5, 7, 9, 12–18 and 20 are pinned by the tests.
- **The real gateway (GW2's executable) with the fake cloud on loopback**,
  driven by `scripts/gateway-playback-e2e.mjs` exactly as GW2's hand-off
  runs it: the gateway enrolled against the fake cloud and opened its
  office door on this computer's LAN address and its outside door on
  loopback; the page (the test data's `?gateway=real` mode, the production
  doors module, tickets from the fake cloud through a path the script
  fulfils) found the outside door, played a 100-second clip of random
  frames from `\\localhost\C$\…`, scrubbed it, handed over from the picture
  within 100 ms of the first frame, drew the mark and moved it, posted the
  renewal at 75 s (the gateway answered 204) and was served again on the
  same URL at 80 s; a clip in the catalogue with no file on the share was
  answered 404 and the row flipped; the ProRes master asked for no ticket;
  a viewer removed at the cloud lost the stream within two minutes (the
  renewal got no fresh ticket, the page dropped the URL at its ticket's
  margin and said the cloud's refusal, never retrying the same ticket);
  the gateway revoked at the cloud closed both doors within one sync and
  the page said it could not reach the gateway. The numbers are in the
  hand-off's §3.
- **The office door was not played from this computer**: it closes its own
  host before TLS, by design (§4), so the browser on the gateway's computer
  never reaches it. "No overlay inside" and the office sentences are
  proven with the acted gateway (§1 A) and `gatewayVideo.test.jsx`.
- **Chrome's local-network prompt** cannot be automated; on this computer
  the loopback address asked nothing. The sentence above the first probe
  is pinned by the tests.
- **Signed in as a person on wilson-dev**: not in a browser (the smoke
  users' password is a GitHub secret, BC2 §4); CI's probe signs in as the
  smoke admin and asks `gateway-ticket` on every push, and suite 98 ran
  against dev's real data, rolled back, before 0095 was applied there. §1 G
  is yours.

## 4. Still not right, and not this session's to change

- **No install story tells a browser's user what to expect** (GW4): the root
  certificate to trust on the office network, Chrome's one-time prompt, and
  that the gateway's own computer cannot play through the office door.
- **A viewer's name on the picture is a deterrent, not a lock** (D9, G8):
  a determined person can film a screen. The design says so.
- **The player's download and picture-in-picture measures are cosmetic**
  (the design's own word): the ticket, not the control strip, is the
  security. Firefox and Safari ignore the control list and draw their own
  fullscreen button: through the outside door, fullscreen or
  picture-in-picture of the bare clip pauses it, undoes itself and says
  *Use the frame's own fullscreen button, top right: it keeps your name on
  the picture.* Measured in Chromium only
  (`scripts/gateway-fullscreen-guard.mjs`, which takes `--browser firefox`
  or `webkit` where Playwright has them; GW3's run had Chromium alone);
  on iOS the native player is undone the same way, unmeasured.
- **The hover scrub through the outside door starts only once the tile's
  ticket has arrived** (one round trip the first time); a desktop's scrub
  starts at once.
- **The viewings table's fraction on rows written before 0095** reads
  *bytes / size* as before; rows after it carry the gateway's coverage.
- **The renewal interval is fixed at 75 s** and the ticket's life at two
  minutes (D1, D5); a clip is renewed only while it plays. A paused or
  never-played clip lets its ticket lapse, and pressing play again costs
  one fresh ticket (the clip goes on from the same moment). A failed
  renewal is tried again in 10 s; one the cloud refuses (a viewer removed,
  the switch off) ends the clip at its ticket's margin, with the cloud's
  sentence.

## 5. Questions, when you test

1. **The mark reads NAME · CODE · CLOCK in capitals at the kit's label
   size, white at 55% over a dark backing** — legible on a bright frame,
   quiet on a dark one. Louder, or is this the right weight for something
   that is on every frame?
2. **The silent and unreachable sentences stay in a strip after the notice
   is dismissed.** Right, or should a dismissed notice take them with it
   for the session?
3. **A ProRes master shows its picture and the one sentence**, with no
   button to the desktop app (there is nothing a browser can launch). Keep
   it that plain?
4. **A clip the gateway answers 404 for stays flipped until its rows are
   read again** (the project opened again, or a reload): the gateway's
   reach report is per location and cannot vouch for one clip. Should a
   click on the row try again at once?
5. **The viewings dialog is the Settings table, 960 px wide, 25 a page.**
   Would you rather it opened the Settings card scrolled to the table with
   the clip filtered?
