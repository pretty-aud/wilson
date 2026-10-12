# 63 — THE FILE GATEWAY'S RELEASES, AND THE REHEARSAL ON THIS PC (GitHub → Releases; App settings → Storage → File gateway)

1. **A gateway release is a tag you push, and nothing else.** Pushing
   `gateway-v0.1.0` to GitHub makes the workflow **Gateway release** build
   the Windows installer, the update the installed gateways take, and the
   NAS image, sign the version list with the release key, and publish them
   together on the repository's **Releases** page as the latest release.
2. **Installed gateways trust one key, and only you hold it** (your
   D13): the private half is the one secret GW4 made, sitting on your
   Desktop until you paste it into GitHub. A version list nobody signed with
   it is refused, and so is any download that leaves GitHub's own servers.
3. **The installer is not signed yet** (your answer of 2026-10-11, D14):
   Windows SmartScreen warns, and **More info → Run anyway** gets past it.
   WILSON never says the gateway is signed until it is.
4. **Outside the office, the gateway can get its own free certificate**
   (D4): a name that points at the office, port 443 forwarded to the
   gateway, the switch on; about a minute later remote browsers trust it
   without anything installed on them.

**What this is.** GW4, the gateway's release pipeline and its install
stories. Once: the release key goes into GitHub (A). Then the first real
release (B), the install on this PC from that release, continuing
walkthrough 61 (C), a phone on mobile data playing a clip through the
outside door (D), and the self-update the gateway does by itself, with the
rollback forced once by a release that is broken on purpose (E). The two
install stories are now Help pages too (R.A.B.B.I.T. Help → **File gateway
on a NAS**, **File gateway on Windows**), and the hardening guide is
`docs/gateway/HARDENING.md`.

Written 2026-10-11 against `feat/post-overhaul-edit-versioning` (GW4,
`po/gw4-gateway-release`), for the beta **as it will be** after the beta
merge (which waits for GW5, your answer of 2026-10-11). Nothing in it has
been run: the first real release, the install and the rehearsal are yours.
Run it against the **beta's** cloud, as walkthrough 61.

**Before you start.**

- The file `00_GATEWAY_RELEASE_KEY.txt` in `Desktop\WILSON walkthroughs\Post-overhaul\`.
- GitHub open in a browser, signed in as you (the repository's owner).
- This PC, walkthrough 61's shared `footage` folder and its read-only
  `wilson-gateway` account, a second computer on the office network, and
  your phone with mobile data. No real footage: any short MP4.
- A PowerShell window **as administrator**, in a clone of the repository
  (`git -C <your clone> fetch origin` works).

---

## 1. Step by step

**A. The release key (once)**

| # | Do | You should see |
|---|----|----------------|
| 1 | Open `00_GATEWAY_RELEASE_KEY.txt` | Its instructions, the public key (`kid: rel2026a`) and ONE line between `-----BEGIN GATEWAY_RELEASE_SIGNING_KEY-----` and `-----END GATEWAY_RELEASE_SIGNING_KEY-----` |
| 2 | github.com/pretty-aud/wilson → **Settings** → **Environments** → **New environment**: `gateway-release` → **Configure environment**: tick **Required reviewers** and add yourself; **Deployment branches and tags** → **Selected branches and tags** → **Add deployment branch or tag rule** → *Ref type: Tag*, `gateway-v*` | The environment `gateway-release`, with you as its reviewer. Every real release will now wait for your **Approve and deploy** before the key is used (the hardening guide's advice; the workflow already names this environment) |
| 3 | In the same environment: **Environment secrets** → **Add environment secret**: name `GATEWAY_RELEASE_SIGNING_KEY`, value: the one line from step 1, exactly | The secret listed, its value never shown again. Here, as the environment's secret, and nowhere else: the key file's own note says Settings → Secrets and variables → Actions, which would make it a repository secret that every workflow in the repository can read; as the environment's, only the job that waits for your approval reads it |
| 4 | Delete `00_GATEWAY_RELEASE_KEY.txt`, then empty the Recycle Bin | The key now exists only in GitHub |

**B. The first real release**

| # | Do | You should see |
|---|----|----------------|
| 5 | `git fetch origin` then `git tag gateway-v0.1.0 origin/feat/multi-user-v1` then `git push origin gateway-v0.1.0` (the commit the beta runs) | `* [new tag] gateway-v0.1.0 -> gateway-v0.1.0` |
| 6 | GitHub → **Actions** → **Gateway release** → the run for `gateway-v0.1.0` | **Plan**, the two **Gateway tests**, **Windows (the MSI and the update artefact)**, **Container (amd64 and arm64)**, then **Sign (the release key)** waiting: **Review deployments** → `gateway-release` → **Approve and deploy** |
| 7 | Wait for **Release (a draft, read back, then published if real)** to go green (about fifteen minutes in all) | GitHub → **Releases**: **WILSON file gateway 0.1.0**, marked **Latest**, with five files: `WILSON-Gateway-Setup-0.1.0.msi`, `wilson-gateway-0.1.0-windows-x64.tar.gz`, `stable.json`, `stable.json.sig`, `SHA256SUMS`; its notes name the NAS image `ghcr.io/pretty-aud/wilson-gateway@sha256:…` |
| 8 | GitHub → your profile → **Packages** → **wilson-gateway** → **Package settings** → **Change visibility** → **Public** | A NAS can pull the image without signing in (a new package starts private) |
| 9 | Releases → **gateway-dry-run-38189270049** (a draft, GW4's one dry run) → **Delete** | It is gone; it was signed with a throwaway key no gateway trusts |

**C. The install on this PC, from the release** (walkthrough 61, with the release's installer)

| # | Do | You should see |
|---|----|----------------|
| 10 | If walkthrough 61's install is on this PC: Settings → Apps → **WILSON Gateway** → **Uninstall** | Removed; its enrolment, certificates and share login stay in `C:\ProgramData\WILSON Gateway` and come back with the new install |
| 11 | From the release, download `WILSON-Gateway-Setup-0.1.0.msi` and `SHA256SUMS`; `Get-FileHash .\WILSON-Gateway-Setup-0.1.0.msi -Algorithm SHA256` | The same 64 characters as the MSI's line in `SHA256SUMS` (lower case there, upper case here): the download is whole and is the file the release holds. It is not proof of who made it (the installer is not signed yet): that rests on the page being github.com/pretty-aud/wilson/releases |
| 12 | Double-click the MSI | **Windows protected your PC** (SmartScreen). Click **More info → Run anyway**, then **Yes** to UAC |
| 13 | The page **Enrol this gateway with WILSON**: a new token from the beta (Settings → Storage → **File gateway** → **Add a gateway**), the beta's cloud address beside it; **Next**, **Install**, **Finish** with *Show the office addresses and the certificate fingerprint* ticked | `install-summary.txt`: the fingerprint, this PC's office address, and *Windows SmartScreen warned about this installer because it is not signed yet (More info, then Run anyway, is the way past it); a signed build will stop the warning later.* |
| 14 | In the beta, beside the gateway, type or paste the fingerprint | **Download certificate** appears |
| 15 | Administrator PowerShell: `wilson-gateway share-login \\SUSAN-FAIRCHILD\footage` (the account from walkthrough 61), then `wilson-gateway doctor` | *Kept: …*; the health line: *0.1.0 · seen … ago · office door open (…:8443) · outside door closed (the switch is off) · Footage: reachable · certificate: renews itself (…) · up to date* |
| 16 | On the **second computer**: **Download certificate** → open it → **Install Certificate** → **Local Machine** → *Place all certificates in the following store* → **Trusted Root Certification Authorities**. Then the beta in Chrome → R.A.B.B.I.T. → a project → **Bins** | The tab says *Chrome will ask whether WILSON may reach devices on your network; allow it once.* Chrome asks: **Allow** |
| 17 | Select a clip and press **Space** | It plays large, straight from this PC's share; nothing is drawn over the picture (the office door) |
| 18 | On **this PC** itself, the same clip in the beta | *On the gateway's own computer the office door does not answer its own host: use another computer on the office network, or the outside door while the switch is on.* That is by design |

**D. Outside the office, from a phone, with the free certificate**

A remote browser plays only through a certificate it already trusts, and
WILSON gives people's browsers the outside address only after **Check
reach** finds the gateway there with one. The free certificate is the way
that puts nobody in the path: a name on your domain, port 443.

| # | Do | You should see |
|---|----|----------------|
| 19 | On the router: a DHCP reservation for this PC. At your domain's DNS host: an **A** record, for example `gateway.petalstudios.co`, pointing at the office's public address (the router's status page shows it) | The name resolves to the public address (`Resolve-DnsName gateway.petalstudios.co`) |
| 20 | On the router, forward **TCP 443** to this PC's **8444**. In the beta: turn on **Allow files to be viewed from outside the office network**; the gateway's outside address: `gateway.petalstudios.co`, port `443` | Within ten seconds the outside door opens; Windows Firewall gets *WILSON Gateway outside door* (the updater adds it) |
| 21 | Wait a minute, then `wilson-gateway doctor` | The health line: *outside certificate: Let's Encrypt for gateway.petalstudios.co, renews itself (until …)*, about 90 days out. (Asking for it means accepting Let's Encrypt's Subscriber Agreement.) If the line says *none yet* with a reason (*could not connect … on port 443*, *could not be found in DNS*), fix that; it asks again within a minute of the cause going away, and backs off if it keeps failing |
| 22 | In the beta: **Check reach** | *Reachable from the internet at gateway.petalstudios.co:443 (checked just now, certificate OK, … ms).* and *It works: play a clip from outside.* |
| 23 | The phone on **mobile data** (Wi-Fi off), signed in to the beta: Bins → a clip → play | It plays, with no certificate warning; over the picture, your name, a six-character member code and the clock, moving every half minute |
| 24 | In the beta: Settings → Storage → File gateway → **Viewed from outside the office** | One row: you, the clip, when, how much, and the phone's address |
| 25 | Turn the switch **off** | Within ten seconds the outside door closes and the firewall rule goes; the phone cannot connect. The certificate stays on this PC and renews itself the next time the switch is on |
| 26 | Remove the router's forward (and the DNS record, if it was only for this) | |

**E. The self-update, and one rollback forced on purpose**

Release 0.1.1 is built to fail: it exits as soon as it starts, so it never reports healthy, and the updater must put 0.1.0 back. Release 0.1.2 is the same code as 0.1.0 under a newer number, and must go in cleanly. Do E before any customer has a gateway, and delete 0.1.1 afterwards.

| # | Do | You should see |
|---|----|----------------|
| 27 | In the clone (a plain PowerShell): `git switch -c rehearsal/gateway-0.1.1-broken gateway-v0.1.0`, then `$f = (Resolve-Path WILSON\gateway\src\cli.mjs).Path; [IO.File]::WriteAllText($f, [IO.File]::ReadAllText($f).Replace('await gw.updates.readFailure();', 'process.exit(97); // rehearsal: this build never reports healthy'))`, then `git commit -am "rehearsal: a gateway build that never reports healthy (walkthrough 63; never merge)"`, `git push origin rehearsal/gateway-0.1.1-broken`, `git tag gateway-v0.1.1`, `git push origin gateway-v0.1.1` | The **Gateway release** run for `gateway-v0.1.1`; approve it as in step 6. Releases: **WILSON file gateway 0.1.1**, Latest |
| 28 | In the beta, beside this PC's gateway: **Updates** → **Check now** (or wait for the daily check) | Within a few seconds the line says *updating to 0.1.1*; the gateway stops for about a minute and a half |
| 29 | `wilson-gateway doctor` | *update to 0.1.1 failed (the new version did not report healthy within 90 s); running 0.1.0*, and every door as before. The next daily check does not try 0.1.1 again |
| 30 | `git tag gateway-v0.1.2 gateway-v0.1.0` then `git push origin gateway-v0.1.2`; approve the run | **WILSON file gateway 0.1.2**, Latest |
| 31 | **Check now** again, then after two minutes `wilson-gateway doctor` | *0.1.2 · … · up to date*; `C:\Program Files\WILSON Gateway\previous` holds 0.1.0 |
| 32 | Releases → **WILSON file gateway 0.1.1** → **Delete**; `git push origin --delete gateway-v0.1.1` and `git push origin --delete rehearsal/gateway-0.1.1-broken` | Latest is 0.1.2; the broken build is gone |

---

## 2. How to check it

- The tests: `npx vitest run gateway` from `WILSON/` (GW4 added the release
  channel on a GitHub-shaped server on loopback, the pipeline's rules, the
  free certificate against a fake CA that validates the real door, the
  install stories and the hardening guide held to the code).
- CI on every change (`.github/workflows/gateway.yml`): the tests on Windows
  and Ubuntu, the MSI's tables, the container on two networks, and **ACME
  against Pebble** (Let's Encrypt's own test server): issued, renewed on a
  90-second lifetime, refused for a name pointed where nothing answers and
  for a blocked name.
- The release pipeline (`.github/workflows/gateway-release.yml`): GW4's one
  dry run (`gateway-v0.0.0-dryrun`, run 38189270049) built everything,
  signed with a throwaway key, and published only a draft, read back through
  GitHub's API (§3).

## 3. The numbers, measured (the dry run, 2026-10-12)

| What | Measured |
|---|---|
| The MSI | 29,679,616 bytes |
| The update artefact (node.exe and the app, ustar, gzip) | 35,098,185 bytes, 59 entries, read back by the gateway's own tar reader |
| The image | amd64 and arm64, built from the base pinned by digest; not pushed (a dry run) |
| The version list | 634 bytes; its signature verified, as GitHub served it, with the dry run's throwaway key, and refused with the real one (as it must be) |
| The redirect chain a gateway follows (measured on GitHub, 2026-10-11) | `github.com/…/latest/download/…` → `github.com/…/download/<tag>/…` → `release-assets.githubusercontent.com` |

## 4. Still not right, and not this session's to change

- **Not signed** (D14): SmartScreen warns on every install. The workflow's
  signing steps are in place and skipped; adding a certificate
  (`GATEWAY_AUTHENTICODE_PFX` and `GATEWAY_AUTHENTICODE_PASSWORD`) turns
  them on.
- **One release key.** The second slot is empty: if the key were ever
  stolen, its replacement reaches installed gateways only with a release
  signed by the old key, or an MSI installed by hand.
- **Help's link to the hardening guide** points at `main`; it opens once the
  integration branch has reached `main`.
- **A NAS's Container Manager pulls by tag** in its own screens; pulling by
  digest is over SSH (Help, *File gateway on a NAS*, step 1).

## 5. Questions, when you test

1. Did the secret go in without trouble, and did step 6 wait for your
   **Approve and deploy**?
2. Did the Releases page show **WILSON file gateway 0.1.0** with its five
   files, marked Latest, and did the MSI's hash match `SHA256SUMS`?
3. Did SmartScreen say *Windows protected your PC*, and did **More info →
   Run anyway** get you through?
4. Did the second computer play after the certificate, with Chrome asking
   once, and did this PC itself say the office door does not answer it?
5. Did the phone on mobile data play with no warning and your name over the
   picture, and did the row appear under **Viewed from outside the office**?
6. Did the free certificate arrive within a minute (step 21), and did Check
   reach then say *certificate OK*?
7. Did 0.1.1 fail and come back to 0.1.0 with the words in step 29, and did
   0.1.2 go in cleanly? Paste `wilson-gateway doctor` after step 29 and
   after step 31.

## What was checked, and what was not

Checked by GW4: everything in §2 and §3. **Not done here, by rule:**
installing the MSI or either service, adding or changing a firewall rule,
clicking a Windows dialog, a public name or port 443 on this PC, and any
real release: steps 1 to 32 are yours.
