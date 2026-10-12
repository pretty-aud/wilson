# The WILSON file gateway: the hardening guide

For the administrator who installs the WILSON file gateway, and for anyone who audits that install. It is the published hardening guidance the MPA's Content Security Best Practices ask a software provider for (TPN, since v5.2), written for the gateway as it is built: version 0.1 and later, the Windows service and the container. Petal Studios keeps it beside the code (`WILSON/docs/gateway/HARDENING.md`) and changes it with the code.

The two install stories (Help: *File gateway on a NAS*, *File gateway on Windows*; the same steps under App settings, Storage, File gateway, Add a gateway) say how to install. This guide says what makes an install safe, what must never be done to it, what to do when something goes wrong, and what the gateway cannot promise.

---

## 1. What the gateway is, in one paragraph

A small program the company installs on one computer that stays on inside its network: a NAS (a container) or a Windows PC (a service). A browser running the WILSON web app asks it for a clip; the gateway checks a two-minute ticket WILSON's cloud signed for that one clip and that one person, reads the clip from the company's share, and sends it to the browser in pieces. It has two doors: the **office door** (TCP 8443, the office network only) and the **outside door** (TCP 8444), which exists only while an admin's switch, *Allow files to be viewed from outside the office network*, is on. It never copies, converts or caches footage, never relays through Petal, and never reads anything but the bin clips the cloud names.

## 2. The switch, and TPN

The switch is where this product meets TPN. The four conditions it was built to, word for word from the storage design (`docs/NETWORK_STORAGE_DESIGN.md` §4b):

> 1. **Off by default.** A workspace that never touches the setting is on the compliant path.
> 2. **The admin toggle IS the compliance boundary.** Turning on external access is the moment a workspace leaves Gold eligibility. The UI must say that, in those words, at the point of the switch — not in a manual. This is the single most useful thing the toggle can do, and it is a better answer than the read-only status panel the first draft proposed.
> 3. **Never marketed or documented as TPN-compliant.** A TPN-track customer asking for it gets steered to VPN or single-computer.
> 4. **The gateway does not weaken the LAN path.** A workspace with the toggle off must be provably identical to one where the gateway does not exist.

How the built gateway keeps them: the switch is off until an admin turns it on; the switch's own card says what turning it on means; this guide and every page Petal writes say what condition 3 says; with the switch off nothing listens on the outside port, so a connection to it is refused at the TCP level exactly as if no gateway existed (proven on every change by the gateway's CI: *switch off: the outside port refuses*).

What the gateway cannot promise, and what a company must be told before it turns the switch on (word for word from the gateway's design, `docs/design/GATEWAY_DESIGN.md` §10):

> A person who may view a clip can save what they view, as with every streaming system; WILSON writes down who viewed what from outside, when, and how much, and shows a name over the picture, but it does not forensically watermark the frames. The gateway runs on your computer and reads your share with the account you give it; if that computer or that account is compromised, so is what it can read. Turning the switch on is the moment this workspace leaves TPN Gold Shield eligibility; a studio that needs TPN certification keeps it off and works over its VPN or on one computer, and WILSON never sells or documents the gateway as TPN-compliant. A tunnel or a NAS relay carries your footage through that vendor's servers, which is your choice; Petal's servers never carry a frame.

---

## 3. Least privilege, as installed

| What | As installed | Check it |
|---|---|---|
| The gateway's identity on Windows | `NT SERVICE\WilsonGateway`, a virtual service account: no password, no interactive logon, not an administrator. On the network it is the computer's own account | `sc.exe qc WilsonGateway` shows `SERVICE_START_NAME : NT SERVICE\WilsonGateway` |
| The updater on Windows | `WilsonGatewayUpdater` as LocalSystem, for three things only: swapping a verified release into `C:\Program Files\WILSON Gateway`, restarting the gateway, adding or removing the outside door's firewall rule. It takes one authenticated message at a time from the gateway, over a pipe keyed by a secret the installer writes as SYSTEM | `sc.exe qc WilsonGatewayUpdater` |
| The gateway's identity in a container | the image's own non-root user, uid 65532, in a distroless image (no shell, no package manager) | `docker inspect` shows `"User": "65532:65532"` |
| The share | read-only, through an account made for the gateway alone (Windows: the share login given once with `wilson-gateway share-login`; the container: the share's folder mounted read-only) | the share user has read on the footage share and nothing else; every container mount of footage ends in `:ro` |
| The state folder | Windows: `C:\ProgramData\WILSON Gateway`, owned by Administrators, its ACL SYSTEM (full), Administrators (full), `NT SERVICE\WilsonGateway` (modify), inheritance removed; the container: the folder mounted at `/data`, owned by uid 65532, every secret in it mode 600 | `icacls "C:\ProgramData\WILSON Gateway"` |
| The program folder | `C:\Program Files\WILSON Gateway`: writable by Administrators and SYSTEM only, so no other account can plant a file where the updater swaps from | `icacls "C:\Program Files\WILSON Gateway"` |
| Secrets at rest | the gateway's credential, its certificates' private keys, the free certificate's account key and the share logins: protected with Windows DPAPI for the service's own identity; in the container, files readable by uid 65532 alone. If Windows data protection is unavailable the health line says so in amber | `wilson-gateway doctor` |

What the gateway holds, and who could read it: its WILSON credential (revoked by *Forget*), the private keys of its own certificates, the share login (read-only), and a journal of the outside door's viewings still to be sent to the cloud. **A local administrator of the gateway's computer, or the owner of the NAS's `/data` folder, can read all of it**: least privilege protects the gateway from the other accounts on that computer, not from its administrators (§8).

## 4. What the gateway's computer must do

1. **SMB 3, with signing and encryption, and SMB 1 off**, on the server that holds the footage (and on the Windows gateway, which reads the share over SMB). On Windows: `Get-SmbServerConfiguration | Select EnableSMB1Protocol, RequireSecuritySignature, EncryptData`, then `Set-SmbServerConfiguration -EnableSMB1Protocol $false -RequireSecuritySignature $true -EncryptData $true`. On a Synology: Control Panel, File Services, SMB, Advanced: minimum SMB 3, signing and encryption on. The Windows gateway reads the dialect each share was opened with and warns on the health line when it is below 3.
2. **The folder ACLs above**, unchanged. Re-run the installer (*Repair*) if they were changed: it puts them back, and it refuses a state folder that is a link or holds an item another account made.
3. **The firewall's two rules, and no others.** The installer adds *WILSON Gateway office door*: inbound TCP 8443, local subnet only, for the gateway's own `node.exe`. The updater adds *WILSON Gateway outside door* (inbound TCP on the outside port, 8444 by default, for the same program) when the switch is on and an outside address is set, and removes it when the switch goes off. A NAS: allow 8443 from the office network only, and 8444 only from the router's forward.
4. **A fixed address on the office network** (a DHCP reservation on the router), so the office door's certificate and the router's forward keep pointing at it.
5. **The correct time** (Windows Time or NTP on): a ticket is checked to the second, with 30 seconds of skew allowed.
6. **Stay on, awake and patched**: the operating system's and the NAS's own updates, as for any server. The gateway updates itself on Windows (§6); a container is updated by pulling the new image.
7. **Outbound HTTPS to these hosts, and nothing else the gateway needs**, for a network that denies by default: WILSON's cloud (the address the install shows, `*.supabase.co`), GitHub's release hosts for updates on Windows (`github.com`, `release-assets.githubusercontent.com`, `objects.githubusercontent.com`), and, only with the free certificate, Let's Encrypt (`acme-v02.api.letsencrypt.org`). The gateway refuses to follow a release download anywhere else.
8. **Each office computer trusts the gateway's own root certificate, and nothing more.** The root may certify only the gateway's host name, `<host>.local` and the /24 (IPv6: /64) around each of its office addresses; install it as a trusted root on the office computers that play clips (or once by Group Policy), never on a computer outside the office. When the gateway makes a new root (a year before the old one ends, or when its office address moves to another network), install the new one and remove the old one from the same store.

## 5. What an administrator must never do

- **Never put anything in front of port 8443**: no reverse proxy, no tunnel, no router forward from the internet, no port-forwarding program. The office door judges every connection by the address it comes from; anything in front of it makes every outside visitor look like an office computer. The gateway closes what looks like a proxy, counts public addresses reaching 8443, and turns the health line red, but the rule is yours to keep.
- **Never run a relay on another office computer** that forwards connections to the gateway's 8443 (a second gateway, a TCP forwarder, a VPN appliance's port mapping aimed at it). From the office door's side, a relay on the LAN is an office computer; it cannot be told apart.
- **Never use a tunnel or the NAS vendor's relay without knowing that its company becomes a sub-processor**: Cloudflare Tunnel, Tailscale Funnel, ngrok, a NAS's QuickConnect-style relay all carry your footage, and every request's URL (a two-minute ticket included), through their servers. If you choose one, record the choice and declare it to the gateway (§7), so every viewing through it is written down *via* that company.
- **Never give the gateway more than read access**, and never a domain administrator's account or a personal account for its share login: make a user for it, read-only on the footage share, nothing else.
- **Never confirm a fingerprint nobody printed.** *Download certificate* unlocks only when the admin who made the enrolment token types the fingerprint the installer or the container's log showed. A gateway nobody installed, appearing on the card, is *Forget*-ed, not confirmed.
- **Never share an enrolment token** beyond the person installing the gateway; it works once, for 24 hours, and *Cancel* withdraws it before use.
- **Never install a gateway from anywhere but the WILSON file gateway releases** (`github.com/pretty-aud/wilson/releases`), and check what you downloaded against that release's `SHA256SUMS` (`Get-FileHash <file> -Algorithm SHA256` on Windows; `sha256sum` elsewhere): that proves the download whole and the file the release holds, not who made the release. Who made it rests on where you took it from: only Petal publishes on that page, and its version list (`stable.json`, signed with Petal's release key, which every gateway checks before an update) names the installer's SHA-256 too. The installer is not signed yet: Windows SmartScreen warns, and *More info*, then *Run anyway*, gets past it; a signed build will stop that warning later.
- **Never turn the switch on in a workspace that needs TPN certification** (§2).

## 6. Updates and the release channel

- **Windows updates itself**, once a day at a random minute, at start, and when an admin presses *Check now*. It fetches `stable.json` and `stable.json.sig` from the latest release of `github.com/pretty-aud/wilson` (HTTPS only, at most three redirects, every one to GitHub's own hosts), accepts the version list only when its Ed25519 signature verifies with a release key built into the gateway, its date is not older than the last one accepted, and it names a release asset of that same repository; then downloads the artefact, checks its size and SHA-256 as it arrives, and hands it to the updater, which copies it into the program folder, checks the signature and the hash again on its own copy, swaps it in, and waits 90 seconds for the new version to report healthy. If it does not, the previous version is put back and the health line says the update failed. An administrator can always install a newer MSI over the running one, and `wilson-gateway rollback` puts the previous version back.
- **A container does not update itself.** The card says when a new version is available; pull it by the digest the release names (`ghcr.io/pretty-aud/wilson-gateway@sha256:…`) and recreate the container with the same settings (`/data` keeps its identity). A container cannot prove its own digest from inside, so for a container the trust rests on GitHub's registry over TLS, on Petal's release process, and on the version floors.
- **The version floors.** Each release's version list may carry a minimum and a hard minimum version, and WILSON's cloud has its own. A gateway below a minimum keeps serving the office and closes its outside door; below a hard minimum the line says it must be updated before it can serve, and the cloud stops giving tickets for it. They are floors for honest gateways: a gateway that has been tampered with can report any version it likes, which is why *Forget* exists. The release pipeline publishes a version only above the latest release, so the floors a release sets stay in force until a higher release replaces them.

## 7. Outside the office: the three ways in

Turn the switch on, then pick one. **Every way in points at the outside door, 8444, never at 8443.**

| Way | What the company does | Settings in the gateway's `config.json` |
|---|---|---|
| **The router forward, with the free certificate** (offered first: nobody stands in the path) | Forward public TCP 443 to the gateway's 8444; give the outside address on the card as a DNS name pointing at the office's public address, port 443. When the switch first comes on the gateway asks Let's Encrypt for a certificate for that name, proving it on that port (TLS-ALPN-01), and renews it by itself a third of its life before it ends. Asking means accepting Let's Encrypt's Subscriber Agreement; the account is made with no contact details | none |
| **The router forward, with your own certificate** | Forward public TCP 8444 (or 443) to the gateway's 8444; put the certificate and key for the public name in the gateway's folder. The health line warns 30 days before it ends, and turns red at 7 | `"outside": { "certificate": { "cert": "outside.pem", "key": "outside-key.pem" } }` |
| **The NAS's reverse proxy** (only one that can check the certificate of what is behind it) | The proxy holds the public certificate and forwards to `https://127.0.0.1:8444`, checking the gateway's certificate against the gateway's own root (*Download certificate*) under the NAS's host name, and keeping its connections open (the gateway counts the proxy as one visitor) | `"outside": { "behind_local_proxy": true }`: the outside door listens on loopback only |
| **A tunnel** (Cloudflare Tunnel, Tailscale Funnel, ngrok) on the gateway's computer | The tunnel's company holds the public certificate and carries the footage (§5); its daemon forwards to `https://127.0.0.1:8444`, checking the gateway's certificate as above | `"outside": { "declared_proxy": { "addresses": ["127.0.0.1"], "name": "cloudflare" } }` (the name is `cloudflare`, `tailscale` or `ngrok`, as the tunnel is) |

Then press *Check reach* on the card: WILSON's cloud knocks on the outside address and says, in words, what answered. People's browsers are given the address only once the check has found this gateway there.

A domain's computer account: a Windows gateway contacts a share's server only after an administrator gave it that server's share login, or listed the server in `"connect_without_login": ["nas"]` (at most 16 servers), when the computer's own domain account reads the share.

## 8. What is written down

- **Every viewing through the outside door**: who, which clip, when, how much of it, and from which address (with the tunnel's name when one is declared), sent to WILSON's cloud and shown to the workspace's admins (*Viewed from outside the office*). The gateway keeps a journal of rows not yet sent, so a cloud outage loses nothing.
- **Viewing on the office network is not written down** (Audrey's decision G6). A company that needs every view logged (TPN AS-2.9) does not get that from the office door.
- **The gateway's own log**: on Windows `C:\ProgramData\WILSON Gateway\logs\WilsonGateway.log` and `WilsonGatewayUpdater.log` (the current file and five earlier ones of 5 MB each); in a container, its standard output (`docker logs`). `wilson-gateway doctor` prints the health line, the doors, the refused peers and the warnings. Forward these logs to the company's SIEM if it has one: the gateway does not.
- **Every enrolment, rename, confirmed fingerprint, Forget and switch change** is in the workspace's own audit, in WILSON.

## 9. The incident procedure

| What happened | What the company does | What WILSON does |
|---|---|---|
| A gateway, or its computer, is no longer trusted (a stolen PC, a compromised NAS, an administrator who left) | **Forget** it on the card at once: its credential is refused at its next check-in, no ticket is made for it again, its addresses leave every browser (*Undo* works for one minute). Then reinstall on a clean computer with a new token, and on each office computer remove the old root certificate and install the new one. Rotate the ticket keys on the card if the gateway's computer was in hostile hands | refuses the forgotten credential everywhere; the audit names the gateway in every row it wrote |
| An enrolment token was seen by someone else | **Cancel** it on the card before it is used. If a gateway enrolled with it that nobody installed, **Forget** it and never confirm its fingerprint | offers that gateway's root for download only after the token's maker confirms a fingerprint the installer printed |
| A person should no longer see the footage | Remove them from the project or the workspace | stops making tickets for them at once; a clip they are playing stops within two minutes |
| A clip's URL was copied out of a page | Nothing beyond the above: it works for at most two minutes (and 30 seconds of clock skew), for that one clip, that one person and that one gateway | the viewing is written down against the person the ticket was made for |
| A gateway release is bad, or the release key may have been stolen | Let the gateway update (within a day), or install the fixed MSI by hand; a container: pull the fixed image by digest | publishes a fixed release whose version list sets the minimum and hard minimum above the bad version, sets the cloud's own floors so the bad version gets no tickets, says so on every gateway's health line, and, for a stolen key, ships a new release key inside a release signed by the old one and asks each company to reinstall the MSI, which carries the updater (the second slot is empty today, §10); a specific gateway is stopped with *Forget* |
| The free certificate stopped renewing | Read the reason on the health line (the forward to 443 was removed, the name no longer points here, a rate limit) and fix it; it renews within a minute of the cause going away while the switch is on | warns from 30 days before the end, red from 7 |

## 10. The limits, said plainly

- **A local administrator of the gateway's computer** (or whoever owns the NAS's `/data`) can read everything the gateway can: the share, the share login, its keys and its journal. The gateway cannot protect a share, or its own files, from that computer's administrators.
- **A leaked clip URL works for up to two minutes**, for one clip, from anywhere the door it names is reachable.
- **The name over the picture is a deterrent, not a watermark.** It is drawn by the browser over the player, outside the video; the browser's own tools remove it and a recording keeps it only where it was drawn. The frames are not forensically watermarked (TPN AS-3.14 asks for that, and the gateway does not do it).
- **The office door's certificate names private addresses.** TPN's list of prohibited signals includes private (RFC 1918) addresses in certificates; that rule is about certificates public authorities issue. The gateway's office certificate is issued by the company's own root, which is constrained to the gateway's names and the /24 around its addresses and is trusted only by the office computers the company chose. A company that wants no address in any certificate can give the office door its own internal CA's certificate instead (`"inside": { "certificate": { "cert": "…", "key": "…" } }`).
- **The installer and the program are not signed yet** (Petal's decision of 2026-10-11): Windows SmartScreen warns, and on a computer with no gateway yet nothing proves who made an installer: `SHA256SUMS` proves a download whole, not its origin, and the signed version list that names the installer is checked by a gateway for its own updates, not by Windows. Petal will not describe the gateway as signed until it is.
- **Office viewing is not written down** (§8), and the gateway keeps no log beyond its own files: a SIEM is the company's.
- **One release key is built in today.** The second slot is empty, so if that key were ever stolen, the replacement reaches installed gateways with a release signed by the old key or with an MSI installed by hand. And the updater, which only the MSI installs, keeps the keys it was installed with: a release signed only with a new key is refused at its swap until that gateway's MSI is reinstalled, so a rotation keeps signing with the old key until then.
- **The container cannot check its own image's signature**: its trust is GitHub's registry, Petal's release process and the version floors (§6).

## 11. The TPN controls this touches

| Control | What the gateway does | What remains the company's |
|---|---|---|
| TS-2 (segmentation, default deny) | the office door accepts the office's own networks only (and the ranges an admin adds), closes loopback, its own addresses and public addresses before TLS; the outside door exists only while the switch is on | the network's own segmentation and firewall; §4's two rules; §5 |
| AS-3.7 (encryption in transit) | TLS 1.2 minimum, TLS 1.3 preferred, AEAD ciphers only, HSTS, `Cache-Control: no-store`, no compression, on both doors; tickets never carry a sign-in token | SMB 3 with signing and encryption to the share (§4.1) |
| AS-2.3 (least privilege) | a virtual service account; a non-root container user; read-only share access | keep it that way (§3, §5) |
| AS-2.5 (keys) | DPAPI or mode 600 for every private key; ticket keys rotated from the card; a documented compromise procedure (§9) | who may sign in to the gateway's computer |
| TS-1.5, AS-2.9 (logging) | every outside viewing written down with who, what, when, how much and from where; a local log on the gateway | a SIEM; office viewing is not logged (§8) |
| AS-3.14 (forensic watermarking) | none: a visible name over remote playback, as a deterrent (§10) | a studio that requires it keeps the switch off |
| AS-1.0, TS-4.0 (SDLC, vulnerability management) | the gateway is tested on every change (both platforms, the installer's tables, the container on two networks, the free certificate against Let's Encrypt's test server); releases are built by a public workflow from a tagged commit and their version lists signed | the operating system's and the NAS's own patches |
| OR-1.1 (incident response) | §9 | the company's own incident plan, naming this procedure |
| OR-3.4 (third parties) | Petal's servers never carry a frame; a declared tunnel is named in every viewing row | the choice of a tunnel or relay, recorded (§5) |
