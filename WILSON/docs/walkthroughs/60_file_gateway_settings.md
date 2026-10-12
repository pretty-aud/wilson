# 60 — THE FILE GATEWAY'S SETTINGS CARD, and who viewed what from outside (App settings → Storage → File gateway; R.A.B.B.I.T. → Bins, the inspector)

1. **The footage never moves, and WILSON never relays a byte** (your G3).
   The file gateway is a small WILSON program on a computer in the office
   (a container on the NAS, or a service on a Windows PC) that hands a
   browser the clip from the share it already reads. In the office the clip
   never leaves the network; for people outside it leaves through one door
   the company opens itself.
2. **Viewing from outside happens only while the switch is on, and every
   viewing through the outside door is written down** (G6): who, which clip,
   when, how much, from where. Viewing on the office network or the
   company's VPN is not written down (review round 2, R9), and the switch's
   card now says so.
3. **Only a workspace admin adds, changes or reads the gateway's audit**, as
   for the switch; the database checks the person's live membership row,
   not the role in their sign-in token (D23), so an admin demoted an hour
   ago cannot act on a stale token.
4. **The gateway's certificate is offered only after the admin who made its
   token confirms its fingerprint** (D25), so a gateway nobody installed
   gets no certificate, no address and no ticket.

**What this is.** GW1, the cloud's half of the file gateway (your G1–G9 and
the design's GW1 brief): migration 0093 (the gateways, their enrolment
tokens and signing keys, the ticket log, the company's audit, the switch's
live-admin check, `viewed_remote` in the file history), the five cloud
functions the gateway and the web app call (`gateway-enrol`, `-sync`,
`-events`, `-ticket`, `-reach`), and the screens: **App settings → Storage →
File gateway**, the **File activity** drawer's *Viewed from outside*, and one
line in the **Bins inspector** for admins. The gateway program itself is
GW2's and playing a clip in the browser is GW3's, so today no real gateway
exists: the card is shown on the development copy's test data, and on
wilson-dev it lists the probe gateway this session enrolled with a stub.

Written 2026-10-10 against `feat/post-overhaul-edit-versioning` (GW1,
`po/gw1-gateway-cloud`). Migration 0093 is applied on **wilson-dev only**;
staging's commands are in the hand-off (`docs/sessions/handoffs/po-gw1-2026-10-10.md`,
"Waiting on Audrey").

## 1. Step by step

**A. Before the first gateway** (the development copy on port 5288, the test
data: `/settings?gateways=empty`, the **Storage** tab; you are Mara, an admin)

| # | Do | You should see |
|---|----|----------------|
| 1 | Scroll to **File gateway**, between Footage locations and *Viewing from outside the office network* | One sentence on what it is, then *None yet: No gateway yet. Add one to play clips in the browser, in the office and, if the company allows it, outside.* and ONE button, **Add a gateway** (Hick's law). Nothing else to press. (`po-gw1-01-empty-one-button`) |
| 2 | **Add a gateway** | *Waiting for the gateway*, then the **enrolment token** (`wgt_` and 32 letters and digits, large, in the mono) with **Copy**, *This token is shown once and works once, for 24 hours…*; **WILSON cloud**, the address the gateway talks to (`https://…supabase.co/functions/v1`) with **Copy**; and two tabs, **On a NAS** (chosen) and **On a Windows PC**, each the design's install story word for word. (`po-gw1-02-token-cloud-nas-story`) |
| 3 | Read the NAS story's step 3, *Volumes* | Under it, already written out for this company: *Footage NAS (`\\salthours-nas\footage`): the share's folder on the NAS → `/locations/salthours-nas/footage`, read-only* — one line per footage location, nobody types it (Tesler's law). Under the stories, the certificate paragraph of the design's §3. (`po-gw1-03-nas-story-mount-line`) |
| 4 | **On a Windows PC** | The six Windows steps (the installer, the fingerprint, the share's login, …) and what the installer does not do. (`po-gw1-04-windows-story`) |
| 5 | Wait about six seconds (the test data acts out a gateway starting with the token) | The token disappears; the gateway appears as **salthours-nas** with its health line, *“salthours-nas” appeared just now, and the token is spent.* (a name the gateway chose is quoted in a sentence), and the **Certificate fingerprint** box: *Type or paste the fingerprint the installer or the container's log printed…* No **Download certificate** yet. (`po-gw1-05-appeared-fingerprint-box`) |
| 6 | Type `B1:16` and **Confirm** | *A certificate fingerprint is 64 letters and digits (0–9 and a–f), with or without colons between the pairs.* Nothing is sent. |
| 7 | Paste the test gateway's fingerprint, `9E:8D:7C:6B:5A:49:38:27:16:F5:E4:D3:C2:B1:A0:99:88:77:66:55:44:33:22:11:FF:EE:DD:CC:BB:AA:00:11` (with or without the colons, either case), **Confirm** | *Confirmed: this is your gateway. Download certificate is ready.* and the **Download certificate** button. (`po-gw1-06-confirmed-download-certificate`) |
| 8 | **Download certificate** | A file, *salthours-nas root certificate.crt*, and *Downloaded. Install it on each office computer as a trusted root…*. On the test data the file only says that it is not a certificate. |

**B. The company's gateway** (`/settings`, **Storage**: the test data's NAS
gateway, enrolled a fortnight ago; the company tried viewing from outside for
two weeks and turned it off yesterday)

| # | Do | You should see |
|---|----|----------------|
| 9 | Read **Salt Hours NAS** | The design's health line: *1.0.0 · seen just now* (or *seen 8 s ago*: a gateway checks in every ten seconds) *· office door open (192.168.10.20:8443) · outside door closed (the switch is off) · Footage NAS: reachable · certificate: renews itself (leaf until 2027-11-08; root until 2036-09-24) · up to date*, and under it **Download certificate**, **Check reach**, **Rename**, **Forget**; then *Outside address: none* **Set** and *Office ranges: none besides its own network* **Change**. (`po-gw1-07-health-line`) |
| 10 | **Set**, paste `192.168.1.5`, **Save** | *An outside address is a public name like gateway.yourcompany.com, or a public address, with its port: never a name or address inside the office.* Nothing is saved. |
| 11 | Paste `https://Gateway.LanternAsh.com:443/` instead, **Save** | Saved as `gateway.lanternash.com:443` (Postel's law: the address as you have it, stored as the cloud keeps it). |
| 12 | **Check reach** | At once, on the click: *Checking… WILSON hands the gateway a code at its next check-in (within ten seconds), then knocks from the internet.* (Doherty: the wait is said.) (`po-gw1-08-checking`) Then, the switch being off: *The switch is off, so the outside door is closed; the check confirms nothing answers from outside (good). Turn the switch on to open it.* (`po-gw1-09-reach-switch-off`) |
| 13 | Turn on **Allow files to be viewed from outside the office network** (below the card), then **Check reach** | *Reachable from the internet at gateway.lanternash.com:443 (checked just now, certificate OK, 143 ms). People outside the office can play clips while the switch is on.* and, the first time, ***It works: play a clip from outside.*** The health line now reads *outside door open on 443, reachable from the internet (checked just now)*. (`po-gw1-10-reach-it-works`) |
| 14 | **Change** the address to `inside.lanternash.com:8444`, **Save**, **Check reach** | FIRST, in the page's error form (heavier edge, bold): *Your inside door (port 8443) answers from the internet. Remove that forward: only port 8444 should be open.* — the one red thing on this card — then the reach sentence; no *It works* beside an error. (`po-gw1-11-reach-inside-door-error`) The test data answers the other §4 sentences by the address's first word: `timeout.…` (*nothing answered … Is port 8444 forwarded…*), `refused.…`, `other.…` (*not your gateway*), `selfsigned.…` (*browsers will not trust the certificate*), and `tunnel.…:443` (behind a tunnel: *reached*, and after it, plain, never the error form, *Something else answers on port 8443 at that address, not the gateway's office door (a tunnel's own edge does). Nothing to change unless you forwarded that port yourself.*; *It works* still shows the first time: `po-gw1-19-reach-tunnel-edge`). |
| 15 | **Change** the office ranges, type `192.168.20.7/24, 10.8.0.0/16`, **Save** | Saved as `192.168.20.0/24, 10.8.0.0/16` (the host bits cleared). `8.8.8.0/24` instead: *Office ranges are private ranges only (10.x, 172.16–31.x, 192.168.x or fc00::/7), at most eight, none wider than a /16 (a /48 for IPv6).* (`po-gw1-12-office-ranges`) |
| 16 | Scroll to **Viewed from outside the office** | Every viewing through the outside door in the last 30 days, newest first, 25 a page: when; who (*Priya Raman (no matching ticket on record: the gateway's word)* where the cloud found no ticket for it, R4); the clip and its project; how much (*1.5 GB of 1.6 GB (97%) · read in full*, or *started; how much is unknown (the gateway restarted), at least 48.0 MB*); from where (*203.0.113.7 via Cloudflare Tunnel · one link played from 2 addresses* when a link was shared; a tunnel the gateway names that WILSON does not know reads *via a tunnel or proxy*) and *through Salt Hours NAS*. (`po-gw1-13-viewed-from-outside`) |
| 17 | **Changes**, under it | The last twenty, newest first, each a sentence, the gateway's name in quotation marks (the gateway chose it): *Mara Okonkwo set the office ranges of “Salt Hours NAS” to 192.168.20.0/24, 10.8.0.0/16*, *… checked whether “Salt Hours NAS” is reachable from outside: reached; the inside door answered*, *… turned viewing from outside the office on*, … back to the token she made. (`po-gw1-14-changes`) |
| 18 | **Forget** | The question: *Forget “Salt Hours NAS”? It stops at once: no ticket is made for it again, its addresses are taken out of every browser, and its next check-in is refused. You can undo this for one minute…* **Esc** leaves it alone. (`po-gw1-15-forget-question`) |
| 19 | **Forget** in the question | The row says *Forgotten: no ticket is made for it, and its next check-in is refused.* with **Undo (60 s)** counting down. **Undo** brings it back as it was. (`po-gw1-16-forgotten-undo`) |
| 20 | **Rename**, type a name, **Save** | The new name; an empty one is refused with *A gateway's name is 1 to 80 characters.* |
| 21 | **Ticket keys**, under the gateway: **Rotate the ticket keys** | The question: *Rotate the ticket keys? New tickets are signed with a new key at once. The old key is honoured for ten more minutes, so nobody's playback stops.* (`po-gw1-20-rotate-question`) **Rotate**: *Rotated: new tickets are signed with a new key, and the old one stops working in ten minutes.* (`po-gw1-21-ticket-keys-rotated`), and **Changes** gains *Mara Okonkwo rotated the ticket keys: new tickets are signed with a new key*. This is the design's answer to a key thought stolen (§10 row 21); **Cancel** runs nothing. A member has no such row. |

**C. Everyone else** (`/settings?fixtures=member`, Storage)

| # | Do | You should see |
|---|----|----------------|
| 22 | Scroll to **File gateway** | The gateway's name, version and when it was last seen, and *Only a workspace admin can add or change the file gateway.* No button, no health line, no viewings, no changes. (`po-gw1-17-member-view`) |

**D. The audit beside the clip** (`/rabbit`, Salt Hours, **Bins**, as Mara)

| # | Do | You should see |
|---|----|----------------|
| 23 | Click **A001_C001_0921AB**, then the inspector's **File** section | Under *Added by*: *Viewed from outside twice, last by Priya on 8 Oct* (the date moves with today's: the test data's viewings are a few days old). A clip with a viewing no ticket on record matched says so after it (*A001_C004_0921AB*: *Viewed from outside once, last by Priya on 27 Sept; no ticket on record matches it (the gateway's word)*). A clip never viewed from outside shows nothing. As a member (`?fixtures=member`) the line never appears and nothing is asked. (`po-gw1-18-bins-inspector-line`) |
| 24 | **R.A.B.B.I.T. → Files**, a file's **File activity** button | Unchanged for files. A viewing from outside, when bins and files share this drawer, reads *Viewed from outside* in the same quiet tone as *Downloaded*, with *Through Salt Hours NAS, from 203.0.113.7 via Cloudflare Tunnel · 920 MB of 1000 MB (92%) · read in full* under it, and *· no matching ticket on record: the gateway's word* after a viewing no ticket matched (pinned by the tests; no file has one today). |

**E. On the real cloud** (wilson-dev; the beta signed in as the smoke users'
admin, once you choose to look)

| # | Do | You should see |
|---|----|----------------|
| 25 | **App settings → Storage → File gateway**, Smoke Workspace | **GW1 probe gateway** · 0.0.1 · *not seen for N days* (the stub that enrolled it was a scratch program, stopped and deleted), confirmed, no outside address; the trail of the session's enrolment, its reach check and the switch. The forgotten probe gateway does not show (forgotten long ago, so no Undo). |

## 2. How to check it

- The tests: `npx vitest run src/components/settings src/cloud/gatewayApi.test.js src/cloud/gatewayEdge.test.js src/cloud/gatewayTicket.test.js src/dev/fixtures src/tools/rabbit_v0.1.0/views/bins src/tools/rabbit_v0.1.0/rabbitBinsHelp.test.jsx src/permissions` — among them `gatewayWords.test.js` (the card's words held to the design's §3, §4, §8 and §11 text; every address, range and fingerprint rule against 0093's), `gatewaySettings.test.jsx` (the card mounted: one button, the token once, the fingerprint box, Checking… on the click, It works the first time only, the error form only for the inside door, every refusal before any request, Forget and Undo, the table, the trail, a member's view), `gatewayApi.test.js` (as the caller; `res.ok` before any body), `gatewayFixtures.test.js`, `binsRemoteViews.test.jsx` and `binsView.test.jsx` (the inspector's line, admins only), `rabbitOverlaysRender.test.jsx` (the drawer's *Viewed from outside*), `footageSettings.test.jsx` (the switch's new sentence, verbatim).
- The database: suite 96 (`supabase/tests/rls/96_gateways.sql`, 161 probes) runs on every push in CI's pgTAP job.
- The development copy: the `gw1-worktree` launch entry, port 5288; `scripts/gateway-settings-shots.mjs 5288 --out <dir>` walks §1 A–D and photographs it.

## 3. What was rehearsed, and how

- **The card, §1 A–D**, every step, in Playwright's Chromium at 1440x900 and
  1280x700 on the test data (`scripts/gateway-settings-shots.mjs`; the
  pictures are `docs/sessions/handoffs/img/po-gw1-01` to `-21`). Steps 6, 8,
  10, 15's refusal and 20 are pinned by the tests.
- **The cloud, on wilson-dev**: a 40-line stub gateway in the session's
  scratchpad (deleted after) enrolled with a real token, synced, posted a
  batch of viewings that landed as `viewed_remote` rows, and had its reach
  checked against a public echo service from the cloud; a ticket was minted
  for a clip the smoke admin may see and refused for a private project's
  clip and for a forgotten gateway; the members' view of gateways hid the
  outside address while the switch was off. Suite 96 ran against dev's real
  data, rolled back, and runs green in CI.
- **Signed in as a person**: CI's smoke job signs in as the smoke admin and
  asks `gateway-ticket` for tickets (one clip it may see, two it may not, a
  forgotten gateway, no sign-in), on every push. **Not run in a browser
  signed in to wilson-dev**: the smoke users' password is a GitHub secret
  (BC2 §4), so §1 E is yours.

## 4. Still not right, and not this session's to change

- **There is no gateway program yet** (GW2), and **nothing plays in a
  browser through one yet** (GW3): the card, the cloud and the audit are
  ready for them.
- **Check reach can take up to about 25 seconds on the real cloud**: the
  check waits for the gateway's next check-in (every ten seconds) to hand it
  the code it must answer with its proof (the design's R16; GW1's review
  rounds 1 and 2), then knocks for five seconds.
  The card says so while it waits; the brief's "under five seconds" holds
  for the knock alone.
- **The health line's *not mounted* names the container's side only**
  (*mount the share's folder at /locations/nas/archive*): the cloud cannot
  know the NAS's own folder for a share; the install story shows both sides.
- **A location's *not reachable* has no "since 09:14"**: the gateway reports
  four words per location, no time. GW2/GW3 can add it to the report.
- **"This version must be updated before it can serve"** (the design's hard
  minimum) is not on the line: the gateway reports only whether it is above
  the ordinary minimum. The cloud already refuses tickets below the hard one.
- **The viewings table cannot yet be filtered to one clip from the
  inspector** (the design's §6 mentions it): the inspector shows the count;
  the filtered table is GW3's, with the rest of the inspector.
- **On the test data, the gateway's start and the knock are acted out**
  (six seconds; the address's first word picks the answer).

## 5. Questions, when you test

1. **One line per gateway, its four actions under it**, and the outside
   address and the office ranges as two short lines below, each edited in
   place. Right, or should those two live behind one *Settings* disclosure?
2. **The token's panel closes with Done** and the token stays valid until a
   gateway spends it or 24 hours pass; it is listed under *Unused tokens*
   (never shown again) with **Cancel**. Right?
3. **Warnings are set in bold, and only the inside door reached from the
   internet takes the error form** (this page has one ink, so "red" is the
   heavier edge and bold). Is that loud enough for the one thing that must
   not be missed?
4. **A clip never viewed from outside shows nothing in the inspector**,
   rather than *Never viewed from outside*. Keep it quiet?
5. **The viewings table: 30 days, 25 a page, newest first**, with the
   gateway under *From where*. Right window and page size?
6. **Check now (for an update) only on a Windows gateway**: a container
   does not update itself, and its health line says *pull the image*. Keep?
7. **Forget's Undo stays in the gateway's own row for its minute** (where
   the gateway was), not in a toast at the bottom. Right?
8. **Before the first gateway the card is the one button**: the viewings
   table and the trail appear once a gateway has been added. Right?
9. **Rotate the ticket keys sits in its own quiet row under the
   gateways**, with a question before it acts. Is that where you would look
   for it after a key you think was stolen, or should it live under
   Security?
