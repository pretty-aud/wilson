# 61 — THE FILE GATEWAY ON A WINDOWS PC: install, enrol, the share, the doors (GW2)

1. **The gateway is a small program the company installs on one computer that
   stays on.** It reads the company's share with an account the admin gives
   it, and serves a clip to the WILSON web app only to someone the cloud has
   just given a two-minute ticket for that one clip. It has two doors: the
   **office door** (port 8443, the office network only) and the **outside
   door** (port 8444), which exists only while WILSON's switch *Allow files to
   be viewed from outside the office network* is on.
2. **With the switch off, from outside it is exactly as if there were no
   gateway**: nothing listens on the outside port. Every read through the
   outside door is written down (who, which clip, when, how much); the office
   door writes nothing down (your G6).
3. **This is the gateway program and its installer.** Playing a clip in the
   browser is GW3's (the web app's player); the Settings card that makes the
   token and shows the gateway is GW1's. This walkthrough is the install on
   your PC and what the gateway itself says; when GW1 and GW3 are merged it
   is also the gateway the browser plays through.

**What this is.** `WILSON Gateway Setup.msi` installs two Windows services: the
gateway, which runs as a Windows-managed account with no password and no
administrator rights (`NT SERVICE\WilsonGateway`), and a small updater that
swaps in new versions and opens or closes the outside door's firewall rule.
It asks for the enrolment token and WILSON's cloud address, and at the end
shows which of this PC's addresses the office door uses and the certificate
fingerprint you confirm in WILSON. Then you give it the share's login once,
and `wilson-gateway doctor` tells you, in one block you paste back to me,
what it is doing.

Written 2026-10-10 against `feat/post-overhaul-edit-versioning` (GW2,
`po/gw2-gateway-service`). Run it after the next beta merge, against the
**beta's** cloud (staging). Nothing here touches the desktop app.

**Before you start.**

- This PC (or any Windows 10 or 11 PC that stays on), on the office network
  by cable or Wi-Fi, and an administrator account (you will see two UAC
  prompts).
- The beta open in a browser, signed in as a **workspace admin**, with GW1's
  **Settings → Storage → File gateway** card on it.
- A folder of a few test clips shared on the network. You have no NAS: share
  a folder on this PC itself. Make a local read-only account for the gateway
  first (Settings → Accounts → Other users → Add someone → *I don't have this
  person's sign-in information* → *Add a user without a Microsoft account*:
  `wilson-gateway`, a password you keep for step D). Then the folder →
  Properties → Sharing → Advanced Sharing → Share this folder, share name
  `footage` → Permissions: remove Everyone, add `wilson-gateway` with
  **Read** only. Its network address is `\\<this PC's name>\footage`
  (`\\SUSAN-FAIRCHILD\footage`). Add it in the beta as a footage location
  (Settings → Storage → Footage locations) and add one or two clips from it
  with the desktop app, as in walkthrough 57. No real footage: any short MP4.
- The installer: GitHub → Actions → **Gateway** → the run for the merge →
  **Artifacts → wilson-gateway-msi-unsigned** → download and unzip. It is
  kept seven days; an older run's is gone (run the workflow again from the
  same page: *Run workflow*).

---

## 1. Step by step

**A. The token (in the beta)**

| # | Do | You should see |
|---|----|----------------|
| 1 | Settings → Storage → **File gateway** → **Add a gateway** | A token starting `wgt_`, shown once, and beside it WILSON's cloud address: `https://rzkirvkotslbovzbsdfh.supabase.co/functions/v1` (the beta's) |
| 2 | Copy both into Notepad | The token works once, for 24 hours |

**B. The install**

| # | Do | You should see |
|---|----|----------------|
| 3 | Double-click `WILSON Gateway Setup.msi` | **Windows protected your PC** (SmartScreen): the installer is not signed yet (D14, the signing certificate, is GW4's question). Click **More info → Run anyway** |
| 4 | The welcome page: tick the licence box, **Install** | A UAC prompt: **Yes** |
| 5 | The page **Enrol this gateway with WILSON**: paste the token; replace the cloud address with the beta's from step 1; **Next** | The installer works for under a minute |
| 6 | The last page: keep *Show the office addresses and the certificate fingerprint* ticked, **Finish** | Notepad opens `install-summary.txt`: *The gateway's certificate fingerprint (SHA-256):* and 32 pairs like `EF:70:D0:…`; *The office door is open on: 192.168.1.173:8443* (this PC's own address); any adapter it did not use and why (a VPN, a virtual adapter) |
| 7 | In the beta, beside the new gateway, type or paste the fingerprint | **Download certificate** appears (GW1's card) |
| 8 | **Download certificate**, open it → **Install Certificate** → **Local Machine** → *Place all certificates in the following store* → **Trusted Root Certification Authorities** | Windows says the import was successful |

**C. Is it running?**

| # | Do | You should see |
|---|----|----------------|
| 9 | Start → type `PowerShell` → **Run as administrator** → `wilson-gateway doctor` | The block below. Its first line names the gateway, Node and OpenSSL; then the health line: *seen … ago · office door open (192.168.1.173:8443) · outside door closed (the switch is off) · Footage: not connected (run share-login) · certificate: renews itself (…) · updates off until a release key is set* |
| 10 | `Get-Service Wilson*` | **WilsonGateway** and **WilsonGatewayUpdater**, both *Running* |

**D. The share's login**

| # | Do | You should see |
|---|----|----------------|
| 11 | In the same administrator PowerShell: `wilson-gateway share-login \\SUSAN-FAIRCHILD\footage` | It asks *User name for …*: `SUSAN-FAIRCHILD\wilson-gateway`; then *Password (not shown)* |
| 12 | Enter them | *Kept: the gateway reads \\SUSAN-FAIRCHILD\footage with that login, in its own session.* |
| 13 | Within ten seconds, `wilson-gateway doctor` again | *Footage: reachable*. In the beta the gateway's line says the same |
| 14 | In a PowerShell that is **not** run as administrator: `wilson-gateway share-login \\SUSAN-FAIRCHILD\footage` | Refused: *Run this in an administrator prompt* (only administrators may hand the gateway a login) |

**E. The office door (from another device on the office Wi-Fi)**

| # | Do | You should see |
|---|----|----------------|
| 15 | On your phone, on the office **Wi-Fi**, open `https://192.168.1.173:8443/` (this PC's address from step 6) | A certificate warning (the phone does not trust the gateway's certificate: only the office computers you install it on do). Continue: the status page: the health line and the fingerprint, nothing else |
| 16 | On **this PC** itself, open the same address | It does not load. **That is by design**: the office door closes any connection from the gateway's own computer before a single byte, so a program on the gateway's own computer can never pass itself off as an office browser. `wilson-gateway doctor` counts it: *Refused peers on the office door: own_address 1* |

**F. The outside door (only if you want to try it; it needs your router)**

| # | Do | You should see |
|---|----|----------------|
| 17 | With the switch **off**: on the router, forward **TCP 8444** to this PC's address (give the PC a DHCP reservation first). Your phone on **mobile data** (Wi-Fi off): open `https://<your public address>:8444/v1/health` | It cannot connect (refused, or it times out): nothing listens on 8444. `wilson-gateway doctor`: *Outside door: closed_switch_off* |
| 18 | In the beta, turn the switch **on**; set the gateway's outside address to `<your public address>` port `8444` (GW1's card) | Within ten seconds `doctor` shows *Outside door: open (port 8444)*; Windows Firewall gets the rule *WILSON Gateway outside door* (the updater adds it) |
| 19 | The phone, still on mobile data: the same address | A certificate warning (a public certificate is GW4's ACME), then `{"ok":true}` and nothing else |
| 20 | Turn the switch **off** in the beta | Within ten seconds: `doctor` shows *Outside door: closed_switch_off; last closed in … ms*, the firewall rule is gone, and the phone cannot connect again |
| 21 | Remove the router's forward | |

**G. A reinstall keeps everything**

| # | Do | You should see |
|---|----|----------------|
| 22 | Run the installer again (*Repair*, or a newer build over it) | No new token asked for (leave it empty if asked); afterwards `doctor` shows the same gateway, the same fingerprint, the share still reachable |

---

## 2. How to check it

- The tests: `npx vitest run gateway` from `WILSON/` (every module, the two
  doors over real TLS on loopback, the runtime against the fake cloud, the
  updater's swap over a fake file system, the MSI's and the image's promises
  read from their files).
- CI (`.github/workflows/gateway.yml`): the tests on Windows and Ubuntu; the
  MSI built from the pinned Node and its tables read back; the image run on a
  bridge (office door closed, the sentence in its log) and on the host's
  network (a Range read from the runner's own LAN address, served, with that
  address in the log; the switch turned off and the port refusing).
- The local proof with the real program: `node gateway/test/e2e/localProof.mjs
  --scratch <folder>` (it binds this PC's LAN address for its run; announce
  it).

## 3. The numbers, measured (this PC, 2026-10-10, before this walkthrough)

The real program, run as a separate process against the fake cloud, reading
a 256 MB file of random bytes through `\\localhost\C$\…` (as the design's
spike did) through the outside door on loopback:

| What | Measured | The spike (design, Appendix A) |
|---|---|---|
| 64 KB Range reads at random offsets | median 1.95 ms, 95th percentile 3.61 ms, worst 4.89 ms | 2.3 / 4.0 / 5.4 ms |
| 256 MB in 4 MB ranges | 344 MB/s | 337 MB/s |
| An open-ended `bytes=0-` stopped by the client at 32 MB | 33.25 MB streamed of 256, then nothing | 32 MB in 84 ms, nothing further |
| The switch off → the outside door closed | 0.95 ms | 0.4 ms |
| A connection to the outside port after that | refused in 4.2 ms | 3.4 ms |

## 4. Still not right, and not this session's to change

- **The installer is not signed** (D14 is GW4's): SmartScreen warns, step 3.
- **No update can be installed yet**: the release keys are GW4's; the line
  says *updates off until a release key is set*. `wilson-gateway rollback`
  works only after a first update.
- **The browser cannot play yet**: the player is GW3's.
- **Not measured here** (no NAS, no second computer, no installed service):
  SMB between two computers and its dialect (the gateway asks the updater,
  which can read it as an administrator; whether it sees the gateway's own
  sessions is yours to see in `doctor` after step 13), a NAS's container, the
  service's own DPAPI (measured as you, not as the service account).

## 5. Questions, when you test

1. Did SmartScreen show *Windows protected your PC*, and did *More info → Run
   anyway* get you through?
2. Did the summary at the end list this PC's address, and only it?
3. Did the fingerprint you typed in the beta unlock *Download certificate*?
4. Did step 14 (a non-administrator share-login) refuse?
5. Did step 16 (the office door from this PC) fail, and step 15 (the phone on
   Wi-Fi) show the status page?
6. If you tried F: did the phone on mobile data fail to connect with the switch
   off, get `{"ok":true}` with it on, and fail again after?
7. Paste `wilson-gateway doctor`'s whole output after step 13 (and after step
   20 if you did F).

## What was checked, and what was not

Checked on this PC: everything in §2 and §3, and the MSI built here once from
a hand-staged layout with its tables read back (the services' accounts, the
order of its steps, the office door's firewall rule). **Not done here, by
rule:** installing the MSI or either service, adding or changing a firewall
rule, clicking a Windows dialog. Steps 3 to 22 are yours.
