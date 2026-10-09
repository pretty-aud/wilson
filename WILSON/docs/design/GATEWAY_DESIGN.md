# The WILSON file gateway: the design (BC4, 2026-10-09)

Track post-overhaul (`po/**`), bundle BC4: design first, no product code. Written on Claude Fable 5.1 (`claude-fable-5-1`): the brief named Opus 5.5, the session stated its model and stopped on line one, and Audrey ruled "use fable". It stands on her ten answers of 2026-10-09 (`docs/design/GATEWAY_QUESTIONS.md`, the rulings G1 to G10), on the Bins plan's B4, B5, B5a and B6, on A9, and on the four TS-2 conditions of `docs/NETWORK_STORAGE_DESIGN.md` §4b (off by default; the switch is the compliance boundary and says so at the control; never sold as TPN-compliant; switch-off provably identical to no gateway from outside). The brief is `docs/sessions/briefs/po-bc4-gateway-design.md`; its twelve sections are below in its order, then the spike's measurements (Appendix A), the migration as a proposal (Appendix B), the API surface (Appendix C) and the two review rounds' findings and corrections (the review history at the end).

**One departure from the literal wording of G4, said first.** G4 reads "checked on every single read with their sign-in token". Every read IS checked against the person's sign-in, but the sign-in token itself never reaches the gateway. Two reasons, both measured in §5: a `<video>` element cannot send a header, so the token could only travel in a URL; and a gateway that received sign-in tokens would turn a rogue gateway (one stolen enrolment token away, §2) into a harvester of every viewer's account. Instead the cloud, which already knows who may read which clip (the Bins tables' RLS), verifies the sign-in token and mints a two-minute, single-clip **ticket** signed with a key only the cloud holds; the gateway checks that signature on every request and the player renews the ticket while it plays. A revoked person stops within the ticket's life. This is decision D1; every decision the design made for her is marked **[Dn]** and asked as a question in the hand-off's "Waiting on Audrey".

Decisions are numbered D1 to D21 and gathered at the end of §12.

---

## 1. The thing, in one page

**What it is.** A small program, the WILSON file gateway (`wilson-gateway`), that the company installs on one computer that stays on inside its network. A browser running the WILSON web app asks it for a clip; the gateway reads the clip from the company's share and sends it to the browser in pieces, so the player can play and scrub; it serves nothing else. Inside the office it works as soon as it is enrolled and the office computers trust its certificate. From outside the office it works only while the admin's switch ("Allow files to be viewed from outside the office network", B5a) is on, through one door the company opens itself. The bytes go share → gateway → browser and nowhere else.

**Where it runs (G1): two installs, one program.**

| Shape | For | How it reads the share | Updates |
|---|---|---|---|
| A **container image** (`wilson-gateway`) | a NAS (Synology Container Manager, QNAP Container Station, TrueNAS Apps) or any Docker host | the share's folder is bind-mounted read-only into the container at a path the design fixes (§11) | the admin pulls the new image; the health line says when one exists (§8) |
| A **Windows service** (an MSI) | any Windows PC or server that stays on | the service's own account opens the location's network address (`\\server\share`) with a read-only share login the admin gives it once | checks Petal daily and updates itself, with rollback (§8) |

The same code in both: Node (the current LTS at build time), shipped as a single executable for Windows and as an image for the NAS, in this repository under `gateway/` **[D19]**. It shares no code with the desktop app's Express server; it copies the desktop's rules (the media allow-list, the path rules) as pure modules with tests, because the desktop's server is loopback-only, unauthenticated and not the gateway (storage design §3.5).

**What it talks to.**

| Party | Direction | What passes |
|---|---|---|
| WILSON's cloud (Supabase Edge Functions, §Appendix C) | the gateway dials out, HTTPS, with its own credential | enrolment once; a sync every 10 s (its addresses, version, reach per location, the doors' state; back: the switch, the ticket-signing public keys, the web app's origins, the office ranges, the minimum version, revocation); the audit rows (§6). Petal's cloud calls the gateway exactly once per admin's request: the reach check (§4), which reads a health line and never a clip |
| The company's share | read-only, as the gateway's own account | bytes of bin clips, by a path the cloud holds |
| Browsers running the WILSON web app | inbound HTTPS on two doors (§2, §4) | tickets in, clip bytes out; the web app's origins only (CORS) |
| Petal's release channel | the gateway dials out, HTTPS, daily | a signed manifest and the download (§8) |

**What it never does.**

- Relay through Petal. No clip byte transits Petal's servers (storage design §4 Option E, rejected on TPN grounds: TPN-3P-010). The cloud sees ids, names, counts and addresses; never a frame.
- Read outside bin clips. The browser sends an id and a ticket; the path comes inside the ticket, from `bin_locations.unc_path` + `bin_files.relative_path`, signed by the cloud (G5). A request can name no path.
- Copy, convert or cache footage. No transcoding (G7), no thumbnails, no temp files, `Cache-Control: no-store` on every response. Its disk holds its config, its certificates, its credential, its logs and its audit journal; never a frame.
- Serve anything from outside while the switch is off. The outside door is not bound; a connection to it is refused at the TCP level, as with no gateway (§9).
- Hold a sign-in token (D1), run as an administrator or root, write to a share, listen on the inside door for the world (a public address reaching the inside door is closed before the TLS handshake, §4).

**The picture.**

```
 office network                                      outside
 ┌────────────────────────────────────────────┐
 │  share  \\nas\footage  (read-only account)  │
 │     ▲                                      │
 │     │ bytes                                │
 │  ┌──┴───────────────┐  inside door :8443   │       outside door :8444 (bound only while the switch is on)
 │  │  wilson-gateway  │◄──── office browsers │◄──────── remote browsers (the company's forward / tunnel)
 │  └──┬───────────────┘                      │
 └─────┼──────────────────────────────────────┘
       │ enrol · sync (10 s) · audit rows          (outbound HTTPS, the gateway's credential)
       ▼
   WILSON cloud (Supabase): the switch, the Bins tables, the tickets' signing key, the audit
       ▲
       │ sign-in · tickets (2 min, one clip each)
   the web app in a browser
```

---

## 2. Registration and discovery (G2)

**Enrolment: how the gateway proves it belongs to THIS workspace.**

1. In WILSON, Settings → Storage → **File gateway** → *Add a gateway* (workspace admins only; the control follows the switch's rule: `usePermissions().role === 'admin'`, and the database says so). The cloud makes an **enrolment token**: `wgt_` + 32 characters of base32 (160 bits of randomness), stores only its SHA-256 in `gateway_enrolment_tokens` (Appendix B) with a 24-hour expiry and the admin who made it, shows it ONCE with a copy button and the two install stories (§11), and writes a `workspace_audit` row (`gateway.token_made`).
2. The admin gives the token to the gateway: the MSI's prompt, the container's `WILSON_ENROL_TOKEN` environment variable, or `wilson-gateway enrol <token>` on the command line.
3. The gateway, on first run, makes its own certificates (§3) and calls `gateway-enrol` with the token, its hostname, platform and version, its root certificate (public part only), its inside addresses and the inside port. The function hashes the token, finds an unused, unexpired row, marks it used, creates the `gateways` row and a **gateway credential**: 32 random bytes, stored in `gateway_secrets` as a SHA-256, returned once in the response. The token is spent whether or not the gateway keeps the answer, so a token seen twice is a token stolen.
4. The gateway stores the credential where only it can read it: on Windows, DPAPI-protected (`CryptProtectData`, scoped to the service account) in `C:\ProgramData\WILSON Gateway\credential.bin`; in the container, `/data/credential` with mode 600 on the NAS's volume (the volume's encryption is the NAS's, named in §10). From then on every call to the cloud carries `Authorization: Bearer <credential>`, looked up by hash; the functions rate-limit per gateway (the durable fixed window, `fn_rate_limit_hit`).

**A stolen token, and how it is revoked.** Before it is used: *Cancel* on the pending token in Settings deletes the row; a token is also dead at 24 hours. After it is used by someone else: the rogue gateway appears in the list (its name, host, platform, inside addresses, first seen), which is loud by design (the list shows a notice when a gateway appears that no admin of this browser enrolled in this session); *Forget* sets `revoked_at` and deletes the `gateway_secrets` row; the rogue's next sync is 401 and it closes both doors. What a rogue gateway can do meanwhile is bounded by D1: it holds no sign-in tokens, it can mint nothing (tickets are the cloud's, signed with a key it never sees), it receives only tickets browsers chose to send it, each for one clip, and it has no share access unless the attacker already had it. The threat model (§10, row 3) says what it CAN do: serve wrong bytes to a viewer who picked it, and learn which clips are viewed.

**What it registers** (at enrolment and at every sync, 10 s **[D15]**):

| Field | Content |
|---|---|
| name | the hostname at enrolment; renamed in Settings |
| platform, version | `windows` / `container`; the running version (§8) |
| inside addresses | every private, non-loopback address it is bound on (IPv4 and IPv6), the hostname, and `<hostname>.local` where mDNS answers; the inside port (8443 by default) |
| outside address | the public name or address and port the admin set in Settings (the cloud tells the gateway; the gateway binds the outside port it is told); only while the switch is on (§4) |
| root certificate | the PEM and its SHA-256 fingerprint, for the download in Settings (§3); the leaf's expiry; which certificate the outside door uses |
| reach per location | for every `bin_locations` row of the workspace: `reachable`, `not_reachable`, `not_mounted` (container), `not_connected` (Windows: no share login yet), checked every sync by one time-limited `stat` of the root (2 s, in a worker thread, the lesson of BC2's hand-off §3) |
| doors | the inside door's state; the outside door's: `closed_switch_off`, `closed_no_address`, `closed_no_cloud`, `open:<port>`; the count of public addresses refused on the inside door since the last sync (§4) |
| update | `up_to_date`, `available:<version>`, `failed:<version>:<reason>` |
| office ranges | echoed back as received, so the health line shows what the gateway is applying |

**How the web app learns the address.** A view `gateways_visible` (Appendix B), readable by every active member of the workspace: id, name, inside addresses and port, outside address (NULL unless the switch is on AND the gateway reports its outside door open), reach per location, last seen, version, root fingerprint. The web app's gateway adapter reads it when a project's bins load and every 60 s while the Bins tab is open (no realtime broadcast: `bin_locations` is not broadcast either, and the workspace channel's id leak in OUTSTANDING argues against adding one). Then it probes: `GET https://<inside address>:8443/v1/path` for each inside address in parallel with a 1.5 s limit; the first answer wins and is kept for the page session. If none answers and an outside address is published, `GET https://<outside address>/v1/path`. The answer `{ gateway_id, path: 'inside' | 'outside', version }` names the door in use, which decides the viewer's name overlay (§7). With more than one gateway enrolled **[D17]** (two offices), the browser probes all and plays a clip through a gateway that reports its location reachable.

**The first probe in Chrome asks a permission.** Since Chrome 142 (late 2025) a public site reaching a private address, a `.local` name or loopback triggers Chrome's *Local Network Access* prompt ("… wants to look for and connect to devices on your local network"), and subresources such as a `<video>` are covered. The page says so above the probe the first time (*Chrome will ask whether WILSON may reach devices on your network; allow it once*), and the install story gives Windows domains the `LocalNetworkAccessAllowedForUrls` policy with the web app's origin, which skips the prompt. The gateway answers the preflight with `Access-Control-Allow-Private-Network: true`. GW3 verifies the exact behaviour on the browsers of the day (§12).

**What the browser sees when the gateway is not running**, each a sentence from a pure module, in the Bins tab's one notice (BC3's shape):

| Case | What the cloud knows | The sentence |
|---|---|---|
| no gateway enrolled | no row | today's `CATALOGUE_SENTENCE`; for an admin, one more line: *A file gateway lets browsers play clips from the company's server: Settings, Storage.* |
| enrolled, not seen for over 30 s | `last_seen_at` old | *The company's gateway Studio NAS has not answered WILSON for 4 minutes, so clips cannot play here. Everything else works; someone on the office network can check it.* |
| seen, but this browser's probes fail | `last_seen_at` fresh | *WILSON can see the gateway but this browser cannot reach it at 192.168.1.10:8443. On the office network, the gateway's certificate must be installed on this computer (Settings, Storage). From outside, the switch is off or the outside door is not open.* |
| seen, reached, a location not reachable | reach per location | per clip: *not reachable through the gateway (Archive)*, the desktop's `notHereSentence` shape |

---

## 3. The certificate story (G2)

**For the admin, in plain words** (this paragraph is the Settings card's help text, verbatim):

> The gateway talks to browsers over HTTPS, as every website does. A website buys a certificate from a company browsers already trust. Your gateway lives inside your office, where no such company can vouch for it, so the first time it runs it makes its own: a *root* that says "trust certificates for the gateway's names", and a certificate for its names signed by that root. Browsers do not trust the root until you tell them to, once per computer: download it from this page (it comes from WILSON's cloud, so you never click past a warning) and install it as a trusted root. That is two minutes per computer, or one Group Policy for a Windows domain. From then on every browser on that computer trusts the gateway, and the gateway renews its own certificate for years without you. People outside the office use a different, public certificate (below), so nothing is installed on their computers.

**What the gateway makes on first run** **[D3]**:

| Certificate | Key | Life | Content |
|---|---|---|---|
| the root, "WILSON Gateway Root for <company>" | ECDSA P-256, kept on the gateway's disk only (DPAPI / mode 600), used only to sign leaves | 10 years | `basicConstraints` CA with path length 0; **name constraints, critical**: permitted DNS names = the gateway's hostname, `<hostname>.local`; permitted IP ranges = the subnets of its inside addresses (the interface masks, widened to the containing /16 for IPv4 so a DHCP move inside the office needs no new root). Everything outside the permitted set is forbidden by the extension's own rule |
| the leaf | ECDSA P-256 | 397 days, renewed by the gateway 30 days before expiry and whenever its addresses change | SAN = the hostname, the `.local` name, every inside address; `serverAuth`; signed by the root |

The spike (Appendix A) made both in 115 ms with OpenSSL 3.5 and proved the constraint: a leaf for `bank.example.com` signed by the same root fails verification ("permitted subtree violation"). Why a root and a leaf rather than one self-signed certificate: Apple limits a TLS server certificate to 825 days, and browsers follow the leaf's dates, so a single certificate would need re-installing on every computer every two years; a root lives ten, and the leaf renews itself. The price is the root's key on the box, answered three ways in §10 (row 4): the name constraints (enforced by Windows, macOS and Firefox; Chrome on Linux historically ignored constraints on user-added roots, which the install story says), the key's protection, and the alternative she can choose instead: a self-signed leaf re-installed every two years.

**The trust step, per office computer.** Settings → Storage → File gateway → *Download certificate* serves the root from the cloud (a public key; the fingerprint is shown beside the button and on the gateway's own status page, so an admin can compare). Windows: double-click → Install → Local Machine → *Trusted Root Certification Authorities* (or Group Policy: Computer Configuration → Windows Settings → Security Settings → Public Key Policies → Trusted Root Certification Authorities, once for the domain). macOS: Keychain Access → System → import → *Always Trust* for SSL. Firefox: it reads the OS store when `security.enterprise_roots.enabled` is on (the default in enterprise builds; the story says where to flip it). A browser that does not trust the root fails the `<video>` silently (no click-through exists for a subresource), which is why the Bins notice names the certificate (§2's third row) and why the probe (`/v1/path`) runs before any player mounts.

**The outside door needs a public certificate**, because the one computer nobody can install a root on is a remote reviewer's own laptop, and nobody should ask them to. Three ways, in the order the setup offers them:

1. **Built in: a free certificate from Let's Encrypt (ACME, TLS-ALPN-01)** **[D4]**: the admin gives the gateway its public name (`gateway.example.com`) and forwards public port 443 to the outside door; the gateway proves the name on that port and renews every 60 days by itself. No files, no renewals to remember. GW4 builds it (§12).
2. **The company's own certificate**: PEM files for the outside name placed in the gateway's config folder (never uploaded anywhere; the private key stays on the box); the health line warns 30, 14 and 7 days before it expires.
3. **A tunnel or the NAS vendor's reverse proxy that holds the public certificate** (§4): the hop from the tunnel daemon to the gateway's outside door is on the same computer and uses the gateway's own leaf, which the daemon is told to trust by its root file.

A company with its own internal CA points the inside door at a CA-issued leaf and key instead of the private root; the download button then reads *Your company's own certificate is in use: nothing to install.*

**The day it expires.** The leaf's day never comes while the gateway runs: it renews at 30 days out, and on start an expired leaf is renewed at once from the root (a gateway switched off for a year starts clean). The root's day is announced twelve months out in the health line (*the gateway's root certificate expires on 2036-10-09; a new one will need installing on each office computer*); at twelve months out the gateway also makes the next root and offers it for download beside the old; at one month out it switches its leaf to the new root and says which computers lose trust when (it cannot count installs; it says the date). The company's own certificate: the three warnings, then at expiry the outside door keeps serving with the expired certificate (browsers refuse it, the health line is red) rather than closing, because closing would hide the cause. ACME: renewal failures are warned from 30 days out with the reason (port 443 no longer forwarded, the name no longer resolves here).

---

## 4. Reach from outside (G3)

**Exactly what the company opens: one port, HTTPS only.** The gateway's **outside door**, TCP 8444 by default **[D2]**, forwarded on the router from the public address to the gateway's LAN address (`public:8444 → 192.168.1.10:8444`, or `public:443 → 192.168.1.10:8444` for the free certificate). Nothing else: not 8443 (the inside door), not 445 (the share), not the NAS's admin ports. No UDP. IPv6 the same port when the provider gives a public address. The gateway never opens a port itself (no UPnP, no NAT-PMP). The LAN address should be a DHCP reservation, said in the install story, because a forward points at an address.

**Two doors, and why.** One listener cannot tell an office browser from a tunnel daemon on the same computer: both arrive from a private address. So the gateway has two doors, and the DOOR decides (§6): everything arriving on the outside door is outside, whatever its address; everything on the inside door from a private address is inside; a public address on the inside door is closed before the TLS handshake. The company forwards only the outside door, and the reach check tests that they did (below). The outside door exists only while the switch is on (§9); while it is off the port is not bound, which the spike measured as a refused connection in 3.4 ms.

**Three ways to expose it, all the company's, none Petal's.**

| Way | What the company does | Who sees the bytes | The gateway's settings |
|---|---|---|---|
| **A router forward** (the plain way) | forward one port; give the gateway its public name or address in Settings | nobody between the browser and the gateway (TLS end to end) | the outside address; the free certificate or their own |
| **A tunnel** (Cloudflare Tunnel, Tailscale Funnel, ngrok and the like) | run the vendor's daemon on the gateway's computer; it dials out, so no port is forwarded; the vendor gives a public name and terminates TLS at its edge | **the vendor**: the bytes are plaintext at its edge, so it is a sub-processor for the company's footage, chosen by the company and named in every audit row (`via`) | the daemon's address as the *declared proxy* (so the audit records the real viewer's address from the forwarded header); the outside door reached by the daemon over TLS with the gateway's root trusted |
| **The NAS vendor's reverse proxy or relay** (DSM's reverse proxy with its Let's Encrypt certificate; QuickConnect's relay) | the NAS fronts the container on 443 with the NAS's certificate and forwards to the container's outside door on the NAS's own bridge network | the NAS (the same computer); in relay mode, **the vendor's servers**: a sub-processor, as above | `outside.behind_local_proxy`: the outside door listens on the container's bridge address for the proxy's address only, and every request on it is outside |

The honest sentence beside the tunnel and relay rows, in the setup card: *A tunnel or relay carries your footage through that company's servers. That is your choice, and WILSON writes which one carried each remote viewing.* The NAS answer of storage design §4c still stands beside all three: a VPN is the way TPN prescribes, and a company that runs one needs none of this.

**The reachability check WILSON runs.** Settings → File gateway → *Check reach* (admins; six per minute per workspace). The web app calls `gateway-reach`; the function connects FROM Petal's cloud to the gateway's registered outside address: it resolves the name first and refuses to connect unless every resolved address is public (no loopback, link-local, private, multicast, no Supabase host; the SSRF guard of §10 row 16), then opens TLS to the resolved address with the name as SNI and ordinary public verification (so an untrusted certificate is a named failure), `GET /v1/health`, 5 s, 4 KB, no redirects. It also tries the INSIDE port on the same public address and expects a refusal or a timeout. The result and its time go on the gateway row and into `workspace_audit`. The words:

| Result | The line in Settings |
|---|---|
| reached | *Reachable from the internet at gateway.example.com:8444 (checked just now, certificate OK, 143 ms). People outside the office can play clips while the switch is on.* |
| timed out | *Not reachable: nothing answered at gateway.example.com:8444. Is port 8444 forwarded to 192.168.1.10 on your router? The gateway itself is fine (seen 3 s ago).* |
| refused | *Not reachable: the connection was refused. The outside door is closed on the gateway: the switch is off, or the gateway has no outside address yet.* |
| certificate | *Reached, but browsers will not trust the certificate (self-signed, or for another name). Use the free certificate (forward port 443) or install your own.* |
| inside door answered | **red:** *Your inside door (port 8443) answers from the internet. Remove that forward: only port 8444 should be open.* |
| switch off | *The switch is off, so the outside door is closed; the check confirms nothing answers from outside (good). Turn the switch on to open it.* |

The last row is the §4b proof made visible: the check runs with the switch off too, and a refused connection is the expected, recorded answer.

**What the gateway refuses from outside while the switch is off: everything, because nothing listens.** The outside port is not bound (no socket; `netstat -an` shows nothing on 8444; a scan reads closed, exactly as with no gateway). If someone forwarded the inside door by mistake, a public address connecting to it is closed on the `connection` event, before TLS, so no certificate, no name and no byte leaves; a scanner sees a port that accepts and closes, which is the only visible difference from absence, and the gateway counts it and the health line says in red where the forward points. Tickets cannot help an outsider on the inside door, because the door's address rule runs before any ticket is read.

---

## 5. Every read's checks (G4, G5)

**The flow, numbered.**

1. **The browser asks the cloud for tickets.** `POST gateway-ticket { gateway_id, bin_file_ids: [ … up to 50 ] }` with the person's sign-in token in `Authorization`.
2. **The cloud verifies the sign-in token** the way every Edge Function here does (`memberGuard.ts`): GoTrue validates the ES256 token (`auth.getUser`), then the live `workspace_members` row must be active (not the token's claim alone: TPN-AUTH-008). The gateway must belong to that workspace and not be revoked. Rate limit: 60 calls per minute per person (durable, `fn_rate_limit_hit`).
3. **The Bins gate, evaluated as the caller (the S33 rule, as `storage-presign` does).** With a client carrying the caller's own token, the function calls `gateway_clips_for_tickets(p_ids)`: a SECURITY INVOKER function (Appendix B) that selects from `bin_files` joined to `bin_locations` under RLS. `bin_files_select` is project visibility, private projects included through the `projects` hop (0072), so a reviewer seated on the project sees the row and an outsider does not; a row the caller cannot see is simply absent and is answered as "not found", the same as a row that does not exist (no oracle). Reading a clip is exactly being able to read its catalogue row; writing stays `can_edit_shot_lists()`. The function also answers `rabbit_remote_viewing_enabled(project)` per row as `rv`.
4. **Mint.** Per visible row, an Ed25519 signature over `{ v: 1, kid, gw, ws, sub, clip, loc, path, seq, mt, rv, iat, exp = iat + 120 s, jti }` with the workspace's current signing key (`gateway_signing_keys`, the private half encrypted at rest under the Edge secret as `workspace_storage_secrets` are; the public half goes to the gateway at sync). 273 bytes in the spike; 26 µs to mint. Answer: `{ tickets: { <bin_file_id>: <ticket> }, missing: [ids], expires_at }`.
5. **The browser plays.** `video.src = https://<door>/v1/clips/<bin_file_id>?t=<ticket>`. A `<video>` cannot send a header, so the ticket rides the URL, with the limits §10 row 13 names (two minutes, one clip, `Referrer-Policy: no-referrer`, no third-party resources on the page, the gateway logs the ticket's id and never the ticket).
6. **The gateway checks every request, in this order, and answers one way for every failure (401, no body) except where a different status is the browser's cue:** parse (`v1.<payload>.<signature>`); signature against the cloud's public key for `kid` (unknown `kid` → one extra sync, then refuse); `nbf` and `exp`; `gw` is this gateway and `ws` its workspace; on the outside door, `rv` must be true (§9); the door's address rule (§6). Then the clip: `loc` must be a location of the workspace known from the last sync (the gateway caches the `bin_locations` list; a ticket cannot name an address the cloud does not hold); the root is the location's `unc_path` on Windows, or `/locations/<host>/<share>` in the container (§11); `path` is re-validated in code against the cloud's own CHECK (forward slashes, no empty, `.` or `..` segment, no backslash, no colon, no trailing dot or space in a segment, at most 1024 characters), joined under the root and the result must stay under the root; then `realpath` of both and the containment checked again, so a symlink or junction inside the share cannot point outside it (§10 row 8); a sequence (`seq`) resolves to its middle frame by the desktop's `detectSequence` rule and the frame must itself be an allow-listed still; `stat` must be a file (else 404); the media type `mt` must be allow-listed AND agree with the file's extension (else 415). Range: `bytes=a-b`, `bytes=a-`, `bytes=-n` → 206 with `Content-Range`; a multi-range request → 416 (no multipart bodies); a request without `Range` → 200, the whole file, counted like any other; an unsatisfiable range → 416. No `ETag`, no `Last-Modified`, no `If-Range`: nothing is cacheable. Response headers: `Content-Type`, `Accept-Ranges: bytes`, `Content-Length`, `Content-Range`, `Cache-Control: no-store`, `Pragma: no-cache`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: cross-origin`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security: max-age=31536000`, `Wilson-Gateway-Path: inside|outside`. The bytes stream with backpressure from the share to the socket (`createReadStream(start, end)`), never buffered whole, and each viewing's bytes are counted (§6).
7. **Renewal.** At 75 s the player fetches a fresh ticket from the cloud (step 1, the same checks) and posts it to `POST /v1/clips/<id>/renew` with the first ticket's `jti`; the gateway extends that stream's life to the new `exp` so the `<video>`'s URL never changes. Without a renewal, the first request after `exp` is 401 and the player recovers by fetching a ticket and setting a new `src` at the same `currentTime` (a visible hiccup, which the renewal exists to avoid).

**How often the membership may be cached, and the longest a revoked person can still play.** The cloud caches nothing: membership and visibility are evaluated at every mint. The gateway caches nothing about people: its check is the signature and the dates. So a person removed from the project, demoted, deactivated or whose project went private stops at the next renewal (every 75 s) or at the ticket's end (120 s), and no new clip opens. The bound **[D5]**: the ticket's remaining life (at most two minutes) plus what the player had already buffered (typically under a minute); under three minutes in all. That is the gateway's equivalent of RLS cutting a demoted member's reads at once while their sign-in token stays valid for an hour (TPN-AUTH-008's gap, closed). A faster bound (60 s tickets) doubles the cloud's calls per playing clip; two minutes is the pick.

**The share, mounted read-only by the gateway's own account** **[D11]**. Windows: the installer creates a local, non-administrator user `WilsonGateway` with a random password, "Log on as a service" and no interactive logon; the service runs as it; the admin gives it the share's login once (`wilson-gateway share-login \\nas\footage`, which stores the read-only share account under that user with `cmdkey`); the gateway opens every file for reading only and never writes to a location. The NAS side is a read-only user for the footage share only. Container: `:ro` bind mounts and a non-root user inside the image. SMB from a Windows gateway to the NAS must be SMB 3 with signing and encryption on, and SMB 1 refused (TPN-CONT-016): the install story says where that is set on the NAS, and the gateway reads the negotiated dialect where Windows exposes it and warns in the health line when it is below 3.

**Allow-listed media types (G7), narrower than the desktop's `safeMediaContentType`** **[D8]**: `video/mp4` (.mp4, .m4v), `video/quicktime` (.mov: the container decides nothing about the codec; Safari plays H.264 inside it, Chrome usually does, and the player's `canPlayType` plus the decode error show the picture where it does not), `video/webm` (.webm), `audio/mpeg` (.mp3), `audio/mp4` (.m4a), `audio/wav` (.wav, .bwf), `audio/flac`, `audio/ogg`, `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/avif`. Not served: `.mxf`, `.mkv`, `.avi`, `.wmv`, `.mts`, `.r3d`, `.braw`, ProRes in any container that is not `.mov`, `.exr`, `.dpx`, `.tif`, `.psd`, `.svg` (scriptable) and everything else: the clip shows its picture and *needs the desktop app*, as today. No sniffing: `nosniff` and the allow-list; a file whose bytes are not what its name says simply fails to decode in the browser.

**Rate limits** **[D12]** (per gateway, in its config, with these defaults): per person 8 concurrent streams and 600 requests a minute; on the outside door a bytes budget of 30 GB an hour per person (a 50 Mb/s clip played continuously is 22 GB an hour) and, per peer address, 60 new connections a minute and 20 TLS handshakes a second; in all 400 open connections and 200 open streams; header timeout 10 s, handshake timeout 10 s (the spike's lesson, Appendix A), 60 s without a read closes a stream; request bodies at most 8 KB (only `renew` has one). Over a limit: 429 with `Retry-After`; the inside door applies the per-person limits only.

**The `online` and reach-per-location answers BC3 needs.** The gateway adapter (GW3, §12) composes over the cloud adapter as BC2's `composeDesktopCloudBins` composes over the desktop: its capability object answers `stream: true` once a door answered the probe and `resolveFiles: true`; each row's `online` is true when the clip's location is reported reachable by a gateway the browser reached (from `gateways_visible.reach`), else false with the location's word (*not reachable through the gateway*, *not mounted on the gateway*); the per-clip truth comes at play time: a 404 flips the row to the desktop's "missing at its location" shape through the provider's `markLoadedBinFiles`. No per-clip `stat` round trip before play; a grid of a thousand clips costs the gateway nothing until one is opened.

**Measured** (Appendix A): a 64 KB Range read through `\\localhost\C$\…` over TLS answered in 2.3 ms at the median and 4.0 ms at the 95th percentile (the same reads by the local path: 1.0 ms and 1.8 ms, so the redirector costs about a millisecond); 256 MB in 4 MB ranges at 337 MB/s over loopback; an open-ended `bytes=0-` stopped by the client after 32 MB in 84 ms, the server having streamed no further; Ed25519 verification 71 µs; a forged ticket, an expired ticket, a missing ticket (401), a traversal path (404), a non-allow-listed type (415) and an unsatisfiable range (416) each refused as designed.

---

## 6. The audit (G6)

**What "inside the network" means, precisely.** Three facts the gateway has and no browser can change: which door the request arrived on, the peer address of the TCP connection, and the admin's declared office ranges. A request is **inside** when it arrived on the inside door AND its peer address is loopback, link-local, private (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7, fe80::/10) or inside a declared range. A request is **outside** when it arrived on the outside door, whatever its address: a tunnel daemon on the same computer, a NAS reverse proxy, a NAT hairpin from the office to the public name, all outside. A request on the inside door from any other address is refused before TLS (§4). The declared ranges **[D21]** (Settings, admins; at most eight, each private and no wider than a /16; echoed in the health line and written to `workspace_audit`) exist for a VPN pool or an office on unusual addressing; they can only add inside ranges to the inside door, never make the outside door's requests inside. A person on the company's VPN is inside, which is the way TPN prescribes remote work, and their reads are not logged, as the office's are not. The web app probes the inside door first (§2), so an office browser only ever reaches the outside door when the inside door is unreachable from it.

When the outside door sits behind a declared proxy (a tunnel daemon, the NAS's reverse proxy), the source address recorded is the one the proxy forwards (`X-Forwarded-For`'s last hop, `CF-Connecting-IP`), taken only when the connection's peer IS the declared proxy; otherwise the peer address, and `via` says which.

**What is written, per remote read** **[D7]**: one `file_events` row per **viewing**: one person, one clip, one gateway, the outside door; it starts at the first byte served and ends after 60 s without a request, or at 5 minutes of activity, after which a new row starts (so a long play writes a row every five minutes and a scrub writes one). The row, in `file_events`' own columns (Appendix B adds `subject` and `external_id`):

| Column | Value |
|---|---|
| `event` | `viewed_remote` |
| `subject` | `bin_file` (so the drawer and the admin surfaces know what `file_id` names) |
| `file_id` | the `bin_files` id (no FK, as 0027: the row outlives the clip) |
| `project_id`, `workspace_id` | the clip's |
| `file_name` | the clip's display name at the time (a snapshot) |
| `size_bytes` | the bytes served in this viewing |
| `actor_user_id`, `actor_label` | the viewer; the label is resolved by `gateway-events` from `sub` at write time (the gateway never holds a name) |
| `created_at` | the viewing's start |
| `details` | `{ viewing_id, gateway_id, gateway_name, started_at, ended_at, bytes, clip_bytes, fraction, read_in_full (fraction ≥ 0.9), ranges, source_address, via, user_agent ("Chrome 142 on Windows", the family only), ticket_jti, incomplete }`, within the 4000-character CHECK |
| `external_id` | `viewing_id`, unique: a retried batch writes nothing twice |

**How it reaches the cloud.** The gateway appends a line to a local journal at the viewing's start and at its end (`/data/journal` or `C:\ProgramData\WILSON Gateway\journal`), posts batches to `gateway-events` (its credential; up to 200 rows; every minute and at every viewing's end), and deletes journal lines the cloud acknowledged. A crash loses nothing acknowledged; a started line with no end is flushed on restart with `incomplete: true` and `ended_at` null, so the admin reads *viewing started at 14:02, how much is unknown (the gateway restarted)* rather than nothing. The journal holds no bytes of footage and no tickets.

**Who sees them** **[D6]**: workspace admins, as she said. `file_events_select` (0074) gains one conjunct, `(event <> 'viewed_remote' OR current_app_role() = 'admin')`, so a member's or manager's file activity never shows them. Where:

- Settings → Storage → File gateway → **Viewed from outside the office** (last 30 days, paged, newest first): when, who, clip and project, how much (bytes and the fraction of the clip; *read in full* in words), from where (address and `via`), through which gateway. The same table filtered to one clip opens from the Bins inspector for an admin, as a one-line count beside the clip's details (*Viewed from outside 3 times, last by Priya on 9 Oct*).
- The per-file audit drawer (`FileAuditDrawer`) gains the `viewed_remote` label and tone (*Viewed from outside*, the read tone the `downloaded` row uses) for the day bins and files share a drawer; it reads `subject` to know what the id names.

**Office reads are not logged** (G6, her answer). The TPN note that belongs beside that choice, for the customer who asks: AS-2.9 asks for every view logged with user, time and address; this design logs every view that leaves the network and none that stays inside, by the company's own ruling, and a TPN-track customer keeps the switch off anyway (§9). A per-workspace option to log inside reads too is a later question **[D16]**, not v1.

**The switch's own audit row** (BC1 deferred it): migration 0093 adds `workspace_audit` (Appendix B), readable by workspace admins, written by a trigger on `workspaces.remote_viewing_enabled` (`remote_viewing.on` / `.off` with `auth.uid()`) and by the gateway functions (`gateway.enrolled`, `.renamed`, `.forgotten`, `.revoked`, `.token_made`, `.token_cancelled`, `.reach_checked` with the result, `.office_ranges_changed`, `.update_failed`). Settings shows the last twenty under the gateway list.

---

## 7. Playback (G7, G8)

**What plays, what shows the picture.** A clip plays when its extension is allow-listed (§5), its location is reachable through a gateway the browser reached, the browser's `canPlayType` does not answer the empty string for the type (with the probe's codec where BC2 recorded one: `video/mp4; codecs="avc1.64001f"`), and the first bytes decode. Anything else shows the cloud picture (where the switch allowed one) or the clip's icon, with one sentence: the format (*This clip's format does not play in a browser; the desktop app plays it*, `NEEDS_DESKTOP_FORMAT`), the location (*not reachable through the gateway (Archive)*), or the gateway (§2's table). No transcoding anywhere (G7); a named customer who needs ProRes in a browser is a different product decision.

**The poster → stream hand-over** (BC3 left the seam). `BinPoster` keeps showing the cloud picture, signed per read, until a `<video>` with the gateway's `src` fires `loadeddata`; then the picture goes under the video. The inspector's `Preview` takes the `<video>` path from `streamUrlFor` once `binsModeOf(caps).canStream` is true; `PosterLarge` (Space) becomes the player on the same overlay, Esc still closing it first; hover-scrub on the grid returns through `streamUrlFor` (a muted `<video preload="metadata">` seeking on the pointer, as the desktop's does), with tickets fetched in one batch for the visible rows when the grid mounts and on scroll, and refreshed on hover when older than 90 s. `binFileStreamUrl` answers the gateway's URL with the ticket; `nothingReachable` returns to false and the dim and the counts return with it. The words: `CATALOGUE_SENTENCE` keyed on `canPick` alone (adding still needs the desktop), `PLAY_NEEDS_DESKTOP` retired, `browserClipSentence` replaced by a reach sentence per location, Help's "In a browser" card and the Space row rewritten (`rabbitBinsHelp.test.jsx` holds Help to the words).

**The viewer's name over remote playback (G8)** **[D9]**. The player asks which door it reached (`GET /v1/path`, once per page session per door; every clip response also carries `Wilson-Gateway-Path`). When the door is `outside`, the player draws over the picture: the viewer's display name (the email's local part when the profile has none) and the clock time, in the kit's small label step at 55% white on a soft dark backing, no blur (the kit bans it), in one of five positions (the four corners and the centre) moved every 30 s so a cropped recording still carries it part of the time. It is drawn on the inspector's player, on `PosterLarge`'s player and on hover-scrub previews. Fullscreen goes through the player's wrapper (`requestFullscreen` on the container, not the `<video>`), so the overlay stays; picture-in-picture is disabled (it would show the bare element); `controlsList="nodownload noremoteplayback"` and a suppressed context menu are cosmetic and the design says so. Inside the office: no overlay (G8 names remote playback). The large cloud picture: no overlay (a still the switch already allowed out). What the overlay is not: forensic watermarking (TPN AS-3.14 asks for an invisible, session-bound mark in the content); it is a visible deterrent and an attribution a determined viewer can remove with the browser's tools, and the audit row (§6) is the durable record. §10's closing paragraph says that to the customer.

---

## 8. Updates and health (G9)

**The release channel** **[D13]**: `https://releases.petalstudios.com/wilson-gateway/stable.json` (the host is hers, **[D14]**): `{ version, published_at, minimum_version, hard_minimum_version, artefacts: { "windows-x64": { url, sha256, size }, "container": { image, digest } }, notes }`, with a detached Ed25519 signature `stable.json.sig`. The signing public key is compiled into the gateway (two keys, so one can be rotated); the private key lives in the release workflow's secret, rotated yearly, with the compromise procedure in §10 row 14. The gateway accepts a manifest only when the signature verifies, the version is newer than its own and the artefact's hash matches after download.

**Windows: self-update with rollback.** The service checks once a day at a random minute, at start, and when the admin presses *Check now* in Settings (delivered at the next sync). It downloads to `updates\staged\`, verifies, then starts the updater (`wilson-gateway-updater.exe`, installed beside the service, run detached) which: stops the service; renames `current` → `previous` and `staged` → `current`; starts the service; waits up to 90 s for `current\healthy`, which the new version writes only after it has read its config, bound the inside door and completed one sync; on failure stops the service, renames back, starts the previous version and writes `update-failed.json`, reported at the next sync as *update to 1.3.0 failed (the inside door could not bind); running 1.2.4*. A crash in the middle: the updater writes `swap.json` with the step reached before each rename, and the service's start always runs the updater first, which completes or reverts an unfinished swap before the service runs. One previous version is kept; `wilson-gateway rollback` is the manual way back. The MSI installs over a running install for a manual update (G9's (b)); enrolment, config and certificates live in `C:\ProgramData\WILSON Gateway\` and survive it.

**The container does not update itself** (a process cannot replace its own image). The health line says *1.3.0 is available: pull the image* with the exact steps per NAS; Synology's and QNAP's container managers can pull on a schedule if the admin wants. Image tags: `1.3.0`, `1.3`, `stable` (rolling); the running version is in the image and reported at sync.

**A version below `minimum_version`** keeps serving the office but closes its outside door and says why; below `hard_minimum_version` the cloud refuses to mint tickets for it at all (the kill switch for a version with a hole), and the health line says *this version must be updated before it can serve*.

**The version shown.** `gateways.version` from every sync, in the Settings line and on the gateway's own status page (its inside door's `/`, which shows the health line and nothing else: no addresses of other things, no paths, no controls; every control is in WILSON Settings behind the admin's sign-in, so the gateway has no admin page to break into).

**The health line the admin sees** (one per gateway in Settings → Storage → File gateway; the same text on the status page):

> **Studio NAS** · 1.2.4 · seen 6 s ago · office door open (192.168.1.10:8443) · outside door closed (the switch is off) · Footage: reachable · Archive: **not mounted** (mount /volume1/archive at /locations/nas/archive) · certificate: renews itself (leaf until 2027-11-01; root until 2036-10-09) · up to date

Each phrase has its states: *seen 6 s ago* / *not seen for 4 minutes* (amber from 30 s, red from 5 minutes); per location *reachable* / *not reachable since 09:14* / *not mounted (…)* / *not connected (run share-login)*; the outside door *closed (the switch is off)* / *closed (no outside address yet)* / *closed (no cloud for 70 s)* / *open on 8444, reachable from the internet (checked 2 h ago)* / *open on 8444, not reached yet: Check reach*; a red line when the inside door is being reached from public addresses (§4); the certificate's three warnings (§3); the update's three states (§8). Under the line: *Download certificate*, *Check reach*, *Rename*, *Forget*.

---

## 9. The switch's enforcement, end to end

The column is one; the places that read it are seven, and each is enough on its own.

1. **The database.** `workspaces.remote_viewing_enabled BOOLEAN NOT NULL DEFAULT false` (0091); only a workspace admin's UPDATE lands (0020's `workspaces_admin_update`, proved by suite 93). Migration 0093 adds the trigger that writes the `workspace_audit` row on every change.
2. **The poster policies** (0091, B4): no picture leaves the server while it is off.
3. **The cloud's ticket mint** stamps `rv` from `rabbit_remote_viewing_enabled(project)` into every ticket, and a ticket lives two minutes.
4. **The gateway's sync** answers the switch every 10 s; the gateway binds the outside door only while it reads `on` AND an outside address is set; on `off` it calls `closeAllConnections()`, destroys every raw socket it tracked at the TCP level (the spike measured 0.4 ms; without the raw tracking, a half-open TLS connection held the close for 120 s) and unbinds the port. No cloud for 60 s closes the outside door too: *no cloud, no outside* **[D15]**.
5. **The outside door refuses any ticket whose `rv` is false**, so even a gateway whose sync died serves nothing from outside beyond the two minutes already minted.
6. **The web app** reads `gateways_visible`, whose `outside_address` is NULL while the switch is off (the view, Appendix B), so no browser is told an outside address to try.
7. **The control** (BC2's `RemoteViewingSection`): `REMOTE_VIEWING_LABEL` unchanged, `REMOTE_VIEWING_TPN_SENTENCE` unchanged and first under the label (storage design §4b's second condition), and the card's description changes from *Playing footage from outside the office comes with the WILSON file gateway, later* to *While it is on, the gateway's outside door is open and remote viewing is written down (who, which clip, when, how much); while it is off the door is closed and nothing answers from outside.*

**The proof that switch-off is identical to no gateway, from outside** (the fourth TS-2 condition):

- Nothing listens on the outside port: the socket is not bound, so a connection is refused by the operating system, exactly as on a computer with no gateway (the spike: `ECONNREFUSED` in 3.4 ms). The cloud's reach check records that refusal when run with the switch off (§4's last row).
- The inside door answers no public address: the connection is closed before TLS, so no certificate, no name, no version and no byte leaves (§4). The one visible difference from absence, an accepted-then-closed connection on a forwarded inside port, is a misconfiguration the health line names in red.
- A ticket minted while the switch is off carries `rv: false` and is useless on the outside door; and there is no outside door.
- A stream in flight when the switch turns off ends within 10 s (the sync) plus the time to destroy its socket.
- Tests, where each lives: suite 96 (the view hides the outside address; the trigger writes the row; a member's flip changes nothing); the gateway's own tests (the door's lifecycle; the pre-TLS refusal; the `rv` refusal); GW2's rehearsal with a phone on cellular data (§12).

The LAN path is not weakened (the fourth condition's other half): the desktop app signed in keeps reading files directly (BC2) and never through the gateway **[D20]**; nothing in the Bins tables changes; a workspace that never enrols a gateway has no new row, no new door and no new code path on any read.

---

## 10. The threat model

The reviewer's rule in the brief applies to this table too: a reader who finds no row missing has not looked. Each row: the threat, what it gets, the control that answers it, the TPN v5.3 control it maps to, and what is left.

| # | Threat | What it would get | The control | TPN | Residual |
|---|---|---|---|---|---|
| 1 | **A stolen enrolment token** (pasted in chat, screenshotted) | enrolling a gateway into the company | single use, 24 h, shown once, admins only; *Cancel* before use; a used token enrols a gateway that appears in the list with its addresses and first-seen time; *Forget* revokes; `workspace_audit` rows for both | TS-1.7 (RBAC), AS-2.1 (device enrolment) | the window between the rogue's enrolment and an admin noticing; bounded by row 3 |
| 2 | **A stolen gateway credential** (read off the box) | syncing and posting audit rows as that gateway | DPAPI / mode 600, never shown; *Forget* kills it; it cannot mint tickets (the cloud signs them), cannot read the switch to any effect, cannot read the share; forged audit rows carry the gateway's id and are revoked with it | AS-2.5 (keys), TS-1.5 (logging) | rows forged before revocation stand in the audit, marked by gateway id; the host's own compromise is row 18 |
| 3 | **A rogue gateway** (enrolled with row 1) | receiving tickets browsers chose to send it; learning which clips are viewed (ids, names, paths); serving wrong bytes to those viewers | D1: it holds no sign-in tokens and no signing key; it serves only what it can read, and it has no share access unless the attacker already had it; the list makes a new gateway loud; the browser prefers the gateway that reaches the clip's location, which a rogue must claim to; *Forget* | TS-1.7, OR-1.1 (incident) | substitution of content and a view log for the attacker until revoked; a viewer's name never reaches it (the overlay is the browser's own) |
| 4 | **A stolen certificate key** | the root's key: minting certificates for the gateway's own names (name constraints) and, on a browser that ignores constraints on user roots (Chrome on Linux historically), for any site; the leaf's key: impersonating the gateway on the LAN | the root is name-constrained (critical) and its key is used only at renewal, DPAPI / mode 600; a stolen root is replaced (a new root, re-installed per computer; the old one removed by the same route); the alternative she can pick, a self-signed leaf re-installed every two years, removes the root entirely; the outside door's certificate is public (ACME) and revocable with the CA | AS-2.5, AS-3.7 | the install story says plainly that a user-installed root is as safe as the computer it lives on; impersonation on the LAN still needs the share (row 18) |
| 5 | **A malicious browser or script on the LAN without a sign-in** | reading clips, listing them, finding the gateway | every clip request needs a cloud-signed ticket (401 otherwise, no body); no listing endpoint exists; the status page shows the health line only; CORS answers the web app's origins only; per-address connection limits | TS-2 (default deny), AS-3.8 | the gateway's presence and version are visible on the LAN (the status page), by design |
| 6 | **A signed-in person's browser abused by a hostile page** (CSRF, DNS rebinding, a page that reaches the inside door through Chrome's local-network permission the person granted to the web app) | playing a clip through the person's standing | no cookies and no stored authority at the gateway: a request without a ticket is nothing, and a ticket is minted only to a page that holds the person's sign-in token (the web app's origin); DNS rebinding is refused because the gateway checks the `Host` header against its own names and addresses; the local-network permission is per site, and the hostile page is not the web app | AS-3.8, TS-2 | a compromised web-app origin (XSS in WILSON itself) is a WILSON incident, not a gateway one |
| 7 | **A renderer that lies about its location** ("I am inside") | an unlogged, switch-free read | nothing in a request says where it comes from: the door and the TCP peer decide (§6); `X-Forwarded-For` is read only when the peer IS the declared proxy; office ranges are private-only and admin-set | AS-2.9 | none for the classification; a company that declares a VPN pool inside has chosen not to log it |
| 8 | **A share path with traversal**, a symlink or junction inside the share, a sequence folder that is a link | reading outside the location | the path is the cloud's, in a signed ticket, CHECK-constrained at insert (0091) and re-validated in code; joined under the root and contained; `realpath` of both and contained again; sequences resolve to a file that must be an allow-listed still; the container's mounts are `:ro` and only the share folders; Windows reads with a read-only share login | TS-2, AS-3.15 | a link the NAS resolves on its own side is invisible to SMB clients and lands inside the share's own tree by the server's rules; a NAS admin who links the share to the system is the host's own misconfiguration (row 18) |
| 9 | **A huge file, an open-ended range, a downloader** | pulling a whole clip, or many | Range reads with backpressure (a 32 MB open-ended read stopped by the client in 84 ms with nothing further streamed); the per-person stream and request caps; the outside bytes budget (30 GB an hour); every viewing's bytes written down with the fraction of the clip, *read in full* called out | AS-3.8 (caps), AS-2.9 | a person allowed to view can save what they view, as with any streaming (the closing paragraph) |
| 10 | **A flood** (connections, handshakes, slow headers, slow readers) | denying the office or outside viewers | per-address connection and handshake limits on the outside door; global connection and stream caps; 10 s header and handshake timeouts; 60 s idle close; 8 KB body cap; the inside door shares the process but has its own caps; the audit journal is append-only and bounded by viewings, not requests | TS-2, OR-1.2 | a volumetric attack on the company's line is the company's router's problem; the gateway stays up but the line is full |
| 11 | **A revoked member mid-stream** | finishing the clip, opening others | the two-minute ticket and the 75 s renewal: the cloud re-evaluates membership and visibility at every mint; no new clip opens; the bound is under three minutes with the buffer | AS-3.8 (revocation) | the buffered seconds already in the browser |
| 12 | **A NAS relay or tunnel that terminates TLS** | the vendor's edge sees plaintext footage; the gateway sees the daemon's address, not the viewer's | the design names the vendor a sub-processor in the setup card and in every audit row (`via`); the daemon-to-gateway hop is TLS with the gateway's root; the forwarded address is taken only from the declared proxy; the router forward with the free certificate is offered first | OR-3.4 (vendor risk), AS-3.7 | the company's choice, recorded; Petal is never in the path |
| 13 | **A forged, replayed or leaked ticket** (a URL in a screen share, a log, a history) | one clip, for the ticket's life | Ed25519 with the cloud's key (a forged ticket is 401 in 71 µs); 120 s; one clip; the gateway's id and workspace inside; `rv` inside; `Referrer-Policy: no-referrer` and no third-party resource on the player; the gateway logs the `jti`, never the ticket; a `<video>` `src` is not browser history | AS-3.7 (no sensitive data in URLs, answered by the life and the scope) | a ticket shared within two minutes plays one clip for whoever has it, which the viewer could have shown them anyway |
| 14 | **A compromised release channel or a bad update** | running Petal-signed malware on the company's server; a broken gateway | a detached Ed25519 signature with a pinned key, the hash checked after download, HTTPS to Petal's host; the updater's health wait and rollback; the previous version kept; `hard_minimum_version` as the kill switch for a known-bad version; the compromise procedure: rotate to the second pinned key, publish a manifest signed by it that sets `hard_minimum_version` above the bad version, and tell every customer by the health line | AS-1.0 (SDLC), TS-4.0, OR-1.1 | a compromised signing key before rotation is Petal's incident, disclosed as such |
| 15 | **Forged or lost audit rows** | an audit that lies or has holes | rows are written only by `gateway-events` with a gateway credential and carry the gateway's id; `external_id` makes retries idempotent; the local journal survives a crash and writes `incomplete` rows rather than none; `file_events` has no client UPDATE or DELETE policy; the table outlives its subjects (0027) | AS-2.9, TS-1.5 (log integrity) | a stolen credential's forgeries until revoked (row 2) |
| 16 | **The cloud's reach probe as an SSRF vector** (an Edge Function that connects to an address a gateway registered) | reaching Petal's internal services or the customer's LAN through Petal | only the registered outside address, set by an admin; resolved first and every address must be public; connect to the resolved address with the name as SNI; `/v1/health` only, 5 s, 4 KB, no redirects, no body sent; rate-limited; the answer is parsed as JSON and only four known fields are kept | TS-2, AS-1.0 | a public address the admin points at something else answers a health probe and nothing more |
| 17 | **A too-wide office range** (0.0.0.0/0 declared) | every address inside, nothing logged, and a forwarded inside door open to the world | ranges must be private and no wider than a /16, at most eight; the inside door's rule still closes public peers; the ranges are shown in the health line and written to the audit | AS-2.9, TS-2 | a VPN pool declared inside is unlogged by the company's choice |
| 18 | **The gateway's host itself compromised** (the NAS, the PC) | everything the gateway can read: the share (read-only), its credential, its certificate keys, its journal (ids, names, addresses) | least privilege: a non-administrator service account, a non-root container user, read-only mounts, no secrets beyond its own; the credential and keys revocable from Settings; the hardening guide (TPN's published-hardening-guidelines requirement) ships with the install story | AS-2.3 (user privilege), TS-4.0 | the host is the company's; the gateway cannot protect a share from its own server |
| 19 | **Enumeration and timing** (guessing clip ids, telling "no such clip" from "not yours") | a map of the company's footage | ids are UUIDs; the mint answers `missing` for both cases from one RLS-filtered query; the gateway answers 401 for every ticket failure and 404 for every clip failure with no body and no difference in words; constant-time credential comparison | TS-2 | timing differences inside Postgres for visible and invisible rows are below what a network attacker can read |
| 20 | **Plaintext on the wire** (SMB from a Windows gateway to the NAS; TLS versions) | footage readable on the office LAN | TLS 1.2 minimum, 1.3 preferred, no compression, HSTS, modern ciphers only, on both doors; SMB 3 with signing and encryption required of the share (TPN-CONT-016), SMB 1 refused, the dialect read and warned on; the container reads a local folder, so no SMB at all | AS-3.7 | the NAS's SMB configuration is the company's |

**What the design cannot promise, and must say to a customer** (the sentence block for the sales conversation and the hardening guide):

> A person who may view a clip can save what they view, as with every streaming system; WILSON writes down who viewed what from outside, when, and how much, and shows a name over the picture, but it does not forensically watermark the frames. The gateway runs on your computer and reads your share with the account you give it; if that computer or that account is compromised, so is what it can read. Turning the switch on is the moment this workspace leaves TPN Gold Shield eligibility; a studio that needs TPN certification keeps it off and works over its VPN or on one computer, and WILSON never sells or documents the gateway as TPN-compliant. A tunnel or a NAS relay carries your footage through that vendor's servers, which is your choice; Petal's servers never carry a frame.

---

## 11. The install story, written twice

### A. On a NAS (a container)

*Read as the admin reads it, on the Settings card after "Add a gateway" with the NAS tab chosen. Synology DSM 7.2 with Container Manager is the worked example; QNAP's Container Station and TrueNAS Apps have the same five steps with their own names.*

1. **Get the image.** Container Manager → Registry → search `wilson-gateway` → download the `stable` tag. (About a minute.)
2. **Make the folders.** File Station → `docker` → new folder `wilson-gateway`. That is where the gateway keeps its settings, its certificates and its journal; nothing of your footage goes there.
3. **Create the container.** Container Manager → Container → Create → the image → *Advanced settings*:
   - **Volumes**: your footage share's folder, read-only, at the path WILSON tells you. For the location **Footage** (`\\nas\footage`) that is `/volume1/footage` → `/locations/nas/footage`, read-only. One line per footage location; the health line names any that is missing. And `docker/wilson-gateway` → `/data`.
   - **Ports**: 8443 → 8443 (the office door) and 8444 → 8444 (the outside door; it stays closed until you turn the switch on).
   - **Environment**: `WILSON_ENROL_TOKEN` = the token on this page (it works once, for 24 hours).
   - **Restart policy**: always.
4. **Start it.** Within ten seconds the gateway appears on this page with its name and *seen just now*; the token on this page disappears. If it does not appear, the container's log says why in one line (the token was used or expired; `/data` is not writable; a location is not mounted).
5. **Trust it, once per office computer.** *Download certificate* here, then on each computer: Windows: open the file → Install Certificate → Local Machine → Place all certificates in the following store → *Trusted Root Certification Authorities*. macOS: open it in Keychain Access → System → double-click → Trust → *Always Trust*. A Windows domain does it once with Group Policy (the path in §3). Then open WILSON in that computer's browser, allow Chrome's local-network question once, and press Space on a clip.

**For viewing from outside the office** (only if you want it): turn on *Allow files to be viewed from outside the office network* on this page and read the sentence under it. Then either forward port 8444 on your router to the NAS and type your public name or address here, or forward port 443 to 8444 and type a name that points at your public address to get a free certificate, or run a tunnel and declare it here. Press *Check reach*. The line tells you what it found, in words.

**The NAS side of the share**: the container reads the folder directly, so no share login is needed. Keep SMB at 3 with signing and encryption on for the office computers that read the same share (Control Panel → File Services → SMB → Advanced), and leave SMB 1 off.

What it costs the NAS: one small process; no transcoding; the bytes it serves are the bytes it reads, so a NAS that can serve the share can serve the gateway. Measured on a laptop (Appendix A): 337 MB/s over TLS, which is the NAS's disk and link, not the gateway.

### B. On a Windows PC (a service)

*Read as the admin reads it, with the Windows tab chosen.*

1. **Run the installer** (`WILSON Gateway Setup.msi`, signed by Petal Studios) as an administrator. It installs the service, makes a local account `WilsonGateway` that can only run as a service (no desktop, no administrator rights), and asks for the enrolment token on this page. (Two minutes.)
2. **Give it the share's login.** The gateway reads your footage at its network address, as any computer does, with an account you choose. Make a read-only user for it on the server (on a Synology: Control Panel → User → create `wilson-gateway`, read-only on the footage share, nothing else), then in an administrator prompt: `wilson-gateway share-login \\nas\footage`, which asks for that user's name and password once and keeps them where only the gateway's account can read them. One line per server.
3. **See it appear.** Within ten seconds the gateway appears on this page with its name, *seen just now*, and each footage location's reach. *Not connected* beside a location means step 2 is still owed for that server.
4. **Trust it, once per office computer**, exactly as the NAS story's step 5.
5. **Keep the PC on and awake** (Power settings: never sleep when plugged in). The gateway updates itself; this page shows its version and *up to date*; if an update fails it says so and keeps the old version running.

**For viewing from outside the office**: as the NAS story, with the forward pointing at this PC's address (give it a DHCP reservation on the router first).

**What the installer does not do**: it does not open any port in the Windows firewall for the outside door (it opens 8443 for the local network only); the outside door's firewall rule is added when you turn the switch on and set an outside address, and removed when you turn it off, and the page says so.

---

## 12. The build plan

Four sessions, a fifth that is an attack. Each on Opus 5.5 by the plan's rule (or the model Audrey names on line one), `po/<name>` branches from `origin/feat/post-overhaul-edit-versioning`, two adversarial review rounds each, hand-offs in protocol §4 order, no chips (the controller spawns them). The numbers **[D18]**: migration **0093 / suite 96** for GW1 (the brief names them the next free; BC3's hand-off also wants a number for aligning 0091's CHECK, which is the controller's to give: 0094 / suite 97 is reserved here for either), walkthroughs **60** (GW1), **61** (GW2), **62** (GW3), **63** (GW4) (59 is S6a's), dev ports **5288** (GW1) and **5289** (GW3) (5287 is S4d's; GW2 and GW4 use the gateway's own 8443/8444 locally and no Vite port).

| Session | Branch | What it builds | Files it owns | Proves before the next starts |
|---|---|---|---|---|
| **GW1: the cloud side** | `po/gw1-gateway-cloud` (port 5288, walkthrough 60) | migration 0093 + suite 96 (Appendix B); the five Edge Functions (`gateway-enrol`, `gateway-sync`, `gateway-events`, `gateway-ticket`, `gateway-reach`) with `verify_jwt = false` and in-function validation as every function here; Settings → Storage → **File gateway** (the token flow, the list with the health lines, *Download certificate*, *Check reach*, *Rename*, *Forget*, the office ranges, the *Viewed from outside* table, the last twenty audit rows); the switch card's new description; the `FileAuditDrawer` label | `supabase/migrations/0093_*`, `supabase/tests/rls/*96*`, `.github/workflows/rls.yml` (`RLS_TABLES`), `supabase/functions/gateway-*`, `supabase/config.toml`, `src/components/settings/GatewaySettings.jsx` (new) and `FootageSettings.jsx` (the description only), `src/cloud/gatewayApi.js` (new), `src/tools/rabbit_v0.1.0/components/FileAuditDrawer.jsx`, `src/dev/fixtures` (a gateways fixture), Help | on wilson-dev: an enrolment round trip with a 40-line stub gateway in the scratchpad (enrol, sync, a reach check against a public echo, an events batch landing as `viewed_remote` rows); a ticket minted for a clip the caller may see and refused (`missing`) for a private project's clip and for a revoked gateway; `gateways_visible` hiding the outside address while the switch is off; suite 96 green on CI; the walkthrough on the dev-backed beta |
| **GW2: the gateway program** | `po/gw2-gateway-service` (walkthrough 61: the install story on this computer) | `gateway/` in this repository: the two doors and the address rule; TLS (the name-constrained root and leaf, the company's certificate option); tickets; Range serving with the allow-list and the path rules (pure modules with the desktop's parity tests); the inside/outside classification and the declared proxy; the limits; sync, the switch's lifecycle, the raw-socket close; the audit journal and batches; the status page; the Windows service (an MSI with WiX, the `WilsonGateway` account, `share-login`, the updater with rollback) and the container image (a CI job builds and runs it); its own vitest suite in the repo's run | `gateway/**`, `.github/workflows/gateway.yml` (new) | on this computer: the real executable serving a Range read of a 256 MB file through `\\localhost\C$\…` with the spike's numbers matched; the outside port closed with the switch off (`netstat`) and refused from a phone on cellular data when a forward is set for the rehearsal; a forged ticket, an expired one, one for another gateway, a traversal path and a non-allow-listed type each refused; the service installed, stopped, updated with a deliberately broken build and rolled back by the updater; the container image built and started in CI with a mounted folder |
| **GW3: the web app** | `po/gw3-gateway-web` (port 5289, walkthrough 62) | the gateway adapter composed over the cloud adapter (the capability object: `stream`, `resolveFiles`); `binsModeOf` and every branch BC3 left for `canStream`; `binFileStreamUrl` through the ticket batch; the player (`Preview`, `PosterLarge`, hover-scrub) with the poster → stream hand-over; `/v1/path` and the name overlay; the sentences (§2's table, `NEEDS_DESKTOP_FORMAT`, the reach sentence); Help's "In a browser" card; screenshots | `src/tools/rabbit_v0.1.0/adapters/gatewayBins.js` (new), `bins/browserCatalogue.js`, `bins/binLocations.js`, `views/bins/*`, `views/BinsView.jsx`, `state/RabbitProvider.jsx` (the bins block), `src/dev/fixtures` (a gateway stub answering tickets and bytes in the page), Help, `scripts/bins-gateway-shots.mjs` | Playwright against GW2's real executable on this computer with the dev fixtures as the cloud: play, scrub, the hand-over, the overlay on the outside door and none on the inside door, a revoked member cut within two minutes, Chrome's local-network prompt handled on the browsers of the day; the Help words pinned |
| **GW4: the release and the install stories** | `po/gw4-gateway-release` (walkthrough 63) | the release pipeline (build, sign the MSI with the code-signing certificate **[D14]**, sign the manifest, publish to the release host); ACME on the outside door **[D4]**; the two install stories as Help pages and the hardening guide (TPN's published-hardening-guidelines requirement); the rehearsal on Audrey's NAS (which one is hers to say) | `gateway/**` (ACME, the updater's channel), `.github/workflows/gateway-release.yml`, Help | a real NAS running the container, a real office computer trusting the root, a real phone outside playing a clip with the overlay and the audit row landing; a self-update from a published manifest with the rollback exercised once on purpose |
| **GW5: the attack** (optional, recommended) | `po/gw5-gateway-attack` | nothing new: a session that only attacks the running gateway and the functions (the ticket parser fuzzed, the path rules fuzzed with the Unicode set BC3 refused, slowloris and handshake floods, `testssl` on both doors, the SSRF guard probed) and closes what it finds | fixes only | every finding closed with a test and a planted fault |

**Shared files and ownership.** GW1 and GW2 run in tandem (no file overlaps: the cloud and `gateway/`); GW3 starts when both are integrated; GW4 after GW3. `FootageSettings.jsx` is GW1's for one string; `binsModeOf` and the Bins views are GW3's; `RLS_TABLES` takes GW1's entries with suite 96 in the same commit.

**Decisions this design made for her** (each a question in the hand-off, multiple choice, with the pick): D1 tickets rather than sign-in tokens at the gateway · D2 two doors, 8443 and 8444, forward only the outside · D3 a name-constrained private root (ten years) and a 397-day leaf, or a self-signed leaf re-installed every two years · D4 the free certificate built in (ACME) · D5 two-minute tickets renewed at 75 s · D6 admins only see the remote-viewing rows · D7 one audit row per viewing (60 s idle, five minutes), not per Range · D8 `.mov` in the allow-list, no transcoding · D9 the overlay: name and time, five positions, 30 s · D10 a container for the NAS, no native package in v1, the `/locations/<host>/<share>` mount rule · D11 a dedicated local service account and `share-login` on Windows · D12 the limits (8 streams, 600 requests a minute, 30 GB an hour outside) · D13 daily update checks, a signed manifest, an updater with rollback; containers pull · D14 the release host and a code-signing certificate (purchases) · D15 a 10 s sync; no cloud for 60 s closes the outside door · D16 office reads not logged (her G6), with the TPN note; a later option · D17 several gateways per company · D18 the numbers (0093 / 96, walkthroughs 60 to 63, ports 5288 and 5289) · D19 Node, a single executable and an image, in `gateway/` in this repository · D20 the desktop app signed in does not use the gateway in v1 · D21 office ranges: private, at most eight, no wider than a /16.

### GW1's brief, in draft

> # Brief: GW1 · the file gateway's cloud side (migration 0093 / suite 96, the five functions, the Settings card)
>
> **Model: Claude Opus 5.5.** State it on line one; stop if the picker shows anything else.
> Read first: `docs/design/GATEWAY_DESIGN.md` (the design; §2, §4, §5, §6, §8, §9 and Appendix B and C are yours), its review history, `docs/sessions/handoffs/po-bc4-2026-10-09.md` (what Audrey answered in "Waiting on Audrey": her answers change this brief where they differ from the design's picks), `supabase/functions/_shared/memberGuard.ts` and `storage-presign/index.ts` (the caller check and the S33 rule, which every gateway function follows), `rateLimit.ts`, `storageSecretCrypto.ts` (the signing keys' private halves are encrypted the way bucket secrets are), migration 0091 (the Bins tables and the switch) and 0074 (`file_events_select`, every arm restated), `docs/sessions/HANDOFF_PROTOCOL.md`, `docs/design/POST_OVERHAUL_PLAN.md` §4. Load `laws-of-ux` and `design-direction` before the Settings card.
>
> Branch `po/gw1-gateway-cloud` from `origin/feat/post-overhaul-edit-versioning` (then `git branch --unset-upstream`); port 5288; walkthrough 60; `.env.local` copied in; `supabase link` to wilson-dev. Migration **0093 / suite 96** (confirm with the controller that 0093 is still free), applied to dev by query, rehearsed rolled back first, with the exact staging command in "Waiting on Audrey". Never `db push`; never deploy to staging or prod; `gateway-*` functions deployed to dev only.
>
> ## Items
> 1. **Migration 0093 + suite 96**: Appendix B as written, every post-condition in the migration's own DO block, the `RLS_TABLES` entries in the same commit; suite 96 proves: a member cannot read `gateway_secrets` or `gateway_signing_keys`; `gateways_visible` hides `outside_address` while the switch is off and shows it when on and the door is open; `gateway_clips_for_tickets` answers a seated reviewer's clip and not a private project's clip the caller cannot see (a second manager, the plain member, the creator, the admin, a public-project control beside each, 0083's shape); the trigger writes `remote_viewing.on` / `.off` with the actor; `file_events_select` hides `viewed_remote` from a manager and shows it to an admin; `external_id` refuses a duplicate.
> 2. **The five functions**, each with the caller or gateway check first, the rate limit second, the shape checks third, the predicate as the caller fourth (the S33 rule), and a sentence for every refusal. `gateway-reach`'s SSRF guard is a pure module with its own test (loopback, link-local, private, multicast, the Supabase host, a name that resolves to a private address, a redirect).
> 3. **Settings → Storage → File gateway** (`GatewaySettings.jsx`, between Footage locations and the switch): the empty state with one button; the token shown once with the two install stories; the list with §8's health line per gateway; *Download certificate*, *Check reach* with §4's words, *Rename*, *Forget* (confirm, undoable for a minute); the office ranges; the *Viewed from outside* table; the last twenty audit rows; the switch card's new description. Laws: Tesler (the mount rule is computed and shown, never configured), Hick (one button in the empty state), Selective attention (one line per gateway, the red word only for the inside-door forward), Jakob (the same chrome as the Footage locations card beside it), Doherty (*Checking…* at once, the result in under five seconds), Peak-end (*It works: play a clip from outside* when the check first succeeds).
> 4. **The audit surfaces**: the `FileAuditDrawer` label and `subject`; the Bins inspector's one-line count for admins (GW3 owns the rest of the inspector; this is one line behind `can` and the role).
> 5. Help → Settings → File gateway (the certificate paragraph of §3 verbatim); walkthrough 60; screenshots; OUTSTANDING; the hand-off.
>
> ## Verification
> The stub gateway (40 lines, scratchpad, deleted): enrol → sync → events → a reach check against a public echo service (not the stub); the dev queries in the hand-off; 25 planted faults per item; two adversarial review rounds (security); `npx vitest run` count stated; the walkthrough on the dev-backed beta signed in as the smoke users.

---

## Appendix A. The spike, measured

A throwaway Node script in the session's scratchpad, run twice on this computer (Windows 11, Node v24.13.0, OpenSSL 3.5.5 from Git for Windows), then deleted with its certificates and its test file. It proved what §3, §5 and §9 assert.

| What | Measured |
|---|---|
| A name-constrained root (ECDSA P-256, 10 years, `nameConstraints` critical) and a 397-day leaf made with OpenSSL | 115 ms for both |
| The constraint enforced | a leaf for `bank.example.com` signed by the same root: `openssl verify` fails, "permitted subtree violation"; the gateway's own leaf verifies |
| The trust step is real | a client without the root: `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; with the root in `ca`: served |
| The file through a UNC path | a 256 MB file written locally and read as `\\localhost\C$\Users\…\clip.bin` (the administrative share, which a location refuses by design; the spike is about the redirector, not the address): `stat` 10.9 ms; size correct |
| Ed25519 tickets (273 bytes) | mint 26 µs, verify 71 µs (20,000 of each); a forged and an expired ticket refused |
| The server (TLS 1.2 minimum): `HEAD` | 200, `Content-Length: 268435456`, `Accept-Ranges: bytes` |
| Refusals | no ticket 401; forged 401; a ticket whose path is `../../Windows/win.ini` 404 (contained); `application/mxf` 415; a range past the end 416 |
| Fifty 64 KB Range reads at random offsets, keep-alive (what scrubbing does) | first (cold TLS) 4.0 ms; then median 2.3 ms, 95th percentile 4.0 ms, worst 5.4 ms |
| The same fifty by the local path | median 1.0 ms, 95th percentile 1.8 ms (the redirector adds about a millisecond) |
| 256 MB in 4 MB ranges (sustained playback) | 0.76 s, 337 MB/s over loopback TLS |
| An open-ended `bytes=0-` as a browser's first request | 206; the client stopped after 32 MB at 84 ms; the server streamed no further (backpressure) |
| The outside door while "on" | a connection accepted in 4.2 ms |
| Closing the outside door, run 1 (`closeAllConnections()` + `close()`) | **120,002 ms**: a raw TCP connection that never finished its TLS handshake is not an HTTP connection, so `closeAllConnections()` skipped it and `close()` waited out Node's 120 s `handshakeTimeout` |
| Closing it, run 2 (every socket tracked on the `connection` event, destroyed on close; `handshakeTimeout` 10 s) | **0.4 ms**; the held connection ended; the next connection refused (`ECONNREFUSED`) in 3.4 ms |

The last two rows are the design change the spike bought: §9's step 4 and §5's handshake timeout exist because of run 1.

## Appendix B. Migration 0093 / suite 96, as a proposal (not a file)

Written in the house style of 0091 (every object commented, a DO block of post-conditions at the end); the DDL below is the shape, for GW1 to write and prove. `RLS_TABLES` gains `gateways`, `gateway_secrets`, `gateway_enrolment_tokens`, `gateway_signing_keys`, `workspace_audit`.

```sql
-- 0093_file_gateway.sql (proposal, BC4 2026-10-09): the file gateway's cloud side.

-- 1. gateways: one row per enrolled gateway. No secret column.
CREATE TABLE public.gateways (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name               TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  platform           TEXT NOT NULL CHECK (platform IN ('windows', 'container')),
  version            TEXT NOT NULL CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+'),
  hostname           TEXT,
  inside_addresses   JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [{ "host": "192.168.1.10", "port": 8443 }, …]
  outside_address    JSONB,                                   -- { "host": "gateway.example.com", "port": 8444 } | NULL; set by an admin
  outside_open       BOOLEAN NOT NULL DEFAULT false,          -- what the gateway reported at its last sync
  root_cert_pem      TEXT,                                    -- the private root's PUBLIC certificate, for the download
  root_fingerprint   TEXT,
  reach              JSONB NOT NULL DEFAULT '{}'::jsonb,      -- { "<location_id>": "reachable" | "not_reachable" | "not_mounted" | "not_connected" }
  health             JSONB NOT NULL DEFAULT '{}'::jsonb,      -- the last sync's report (doors, update, certificate dates, refused public peers)
  office_ranges      JSONB NOT NULL DEFAULT '[]'::jsonb,      -- admin-set; private CIDRs only, ≤ 8, each ≤ /16 (the CHECK is a function)
  reach_checked_at   TIMESTAMPTZ, reach_ok BOOLEAN, reach_detail TEXT,
  created_by         UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at       TIMESTAMPTZ, revoked_at TIMESTAMPTZ
);
-- RLS: SELECT for active members of the workspace (the addresses are what a browser needs); UPDATE of
-- name, outside_address and office_ranges by a workspace admin only (a trigger pins every other column);
-- no client INSERT or DELETE (the functions, service role).

-- 2. gateway_secrets: the credential's hash, service role only (the workspace_storage_secrets shape).
CREATE TABLE public.gateway_secrets (
  gateway_id       UUID PRIMARY KEY REFERENCES public.gateways(id) ON DELETE CASCADE,
  credential_hash  TEXT NOT NULL,                             -- SHA-256, hex
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- RLS enabled, no client policy, no client grant.

-- 3. gateway_enrolment_tokens: 24 h, single use, admins make and cancel them.
CREATE TABLE public.gateway_enrolment_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  created_by    UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
  used_at       TIMESTAMPTZ, gateway_id UUID REFERENCES public.gateways(id) ON DELETE SET NULL
);
-- RLS: SELECT and DELETE by a workspace admin (the pending list and Cancel); INSERT by the function only
-- (the token itself is never stored). The CHECK that the hash is 64 hex characters.

-- 4. gateway_signing_keys: the cloud's ticket keys, per workspace; the private half encrypted at rest.
CREATE TABLE public.gateway_signing_keys (
  workspace_id            UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kid                     TEXT NOT NULL,
  public_key              TEXT NOT NULL,                      -- Ed25519, base64url raw
  private_key_ciphertext  TEXT NOT NULL,                      -- AES-256-GCM under WILSON_GATEWAY_KEY_SECRET (the storage-secret pattern)
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(), retired_at TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, kid)
);
-- RLS enabled, no client policy. The gateway receives public keys through gateway-sync only.

-- 5. workspace_audit: the switch's own row (BC1 deferred it) and the gateway's lifecycle.
CREATE TABLE public.workspace_audit (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id   UUID NOT NULL,                               -- no FK: rows outlive the workspace (0028's reasoning)
  action         TEXT NOT NULL CHECK (action IN (
                   'remote_viewing.on', 'remote_viewing.off',
                   'gateway.enrolled', 'gateway.renamed', 'gateway.forgotten', 'gateway.revoked',
                   'gateway.token_made', 'gateway.token_cancelled', 'gateway.reach_checked',
                   'gateway.office_ranges_changed', 'gateway.update_failed')),
  actor_user_id  UUID, actor_label TEXT,
  gateway_id     UUID,
  details        JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (char_length(details::text) <= 4000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- RLS: SELECT by a workspace admin of that workspace; writes by the trigger and the functions only.
-- The trigger on workspaces (remote_viewing_enabled changed) writes remote_viewing.on / .off with auth.uid().

-- 6. file_events: the remote-viewing row.
ALTER TABLE public.file_events
  ADD COLUMN subject TEXT NOT NULL DEFAULT 'file' CHECK (subject IN ('file', 'bin_file')),
  ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX file_events_external_id_key ON public.file_events (external_id) WHERE external_id IS NOT NULL;
-- The vocabulary CHECK is dropped by name and by definition (0057's lesson) and recreated with 'viewed_remote'
-- added to 0073's list. file_events_select is DROP + CREATE with 0074's arms restated verbatim and one
-- conjunct added: (event <> 'viewed_remote' OR public.current_app_role() = 'admin').

-- 7. The read gate, evaluated as the caller (SECURITY INVOKER; the S33 rule).
CREATE FUNCTION public.gateway_clips_for_tickets(p_ids UUID[])
RETURNS TABLE (bin_file_id UUID, project_id UUID, workspace_id UUID, location_id UUID, unc_path TEXT,
               relative_path TEXT, is_sequence BOOLEAN, extension TEXT, mime_type TEXT,
               remote_viewing BOOLEAN)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT f.id, f.project_id, f.workspace_id, f.location_id, l.unc_path, f.relative_path, f.is_sequence,
         f.extension, f.mime_type, public.rabbit_remote_viewing_enabled(f.project_id)
    FROM public.bin_files f
    JOIN public.bin_locations l ON l.id = f.location_id AND l.workspace_id = f.workspace_id
   WHERE f.id = ANY (p_ids);            -- RLS on both tables does the gating: an invisible row is absent
$$;
-- REVOKE from PUBLIC and anon; GRANT to authenticated and service_role.

-- 8. The view a browser reads.
CREATE VIEW public.gateways_visible WITH (security_invoker = true) AS
  SELECT g.id, g.workspace_id, g.name, g.platform, g.version, g.inside_addresses, g.reach, g.last_seen_at,
         g.root_fingerprint, g.office_ranges,
         CASE WHEN w.remote_viewing_enabled AND g.outside_open THEN g.outside_address END AS outside_address
    FROM public.gateways g JOIN public.workspaces w ON w.id = g.workspace_id
   WHERE g.revoked_at IS NULL;

-- 9. Post-conditions: the five tables under RLS with the policies named; gateway_secrets and
-- gateway_signing_keys with no client policy; the view security_invoker; the function SECURITY INVOKER,
-- not executable by anon; the vocabulary CHECK containing 'viewed_remote' exactly once; file_events_select
-- containing the admin conjunct; the trigger present on workspaces.
```

Suite 96's probes are listed in GW1's brief (§12). Nothing above is applied anywhere by this session.

## Appendix C. The API surface

**The Edge Functions** (all `verify_jwt = false` with in-function validation, as every function in `supabase/config.toml`; refusals are sentences with a code, as `storage-presign` answers):

| Function | Caller | Checks, in order | Answers |
|---|---|---|---|
| `gateway-enrol` | the gateway, with an enrolment token | token hash → unused, unexpired row; rate limit per address (pre-authentication: `failOpen: false`); the body's shape (name, platform, version, root PEM, inside addresses) | `{ gateway_id, credential, workspace_name, signing_keys: [{ kid, public_key }], web_app_origins, sync_interval_s }` once |
| `gateway-sync` | the gateway, with its credential | credential hash → live gateway (`revoked_at` null); rate limit; the report's shape | `{ remote_viewing, outside_address, office_ranges, signing_keys, web_app_origins, bin_locations: [{ id, unc_path }], minimum_version, hard_minimum_version, check_update_now, renamed: name }` |
| `gateway-events` | the gateway, with its credential | as sync; ≤ 200 rows; each row's shape; `external_id` present; the viewer resolved to a label server-side | `{ accepted: [external_id], rejected: [{ external_id, reason }] }` |
| `gateway-ticket` | the web app, with the person's token | `requireActiveMember` (GoTrue + the live row); the gateway is the caller's workspace's and live and at or above `hard_minimum_version`; rate limit 60/min per person; ≤ 50 ids; `gateway_clips_for_tickets` AS THE CALLER; mint | `{ tickets: { id: ticket }, missing: [id], expires_at }` |
| `gateway-reach` | the web app, a workspace admin | `requireActiveMember` + `app_role = admin`; rate limit 6/min per workspace; the gateway's registered outside address only; the SSRF guard (§10 row 16); the two probes (outside port; inside port on the same address) | `{ outside: { ok, detail, ms, certificate }, inside_answered: boolean, checked_at }`, stored on the row and in `workspace_audit` |

**The gateway's HTTP surface** (both doors; CORS for the web app's origins only; every response `Cache-Control: no-store`):

| Route | Door | Auth | Answers |
|---|---|---|---|
| `GET /v1/health` | both | none | `{ name, version, doors, reach, certificate }` (the health line's data; the status page renders it) |
| `GET /v1/path` | both | none | `{ gateway_id, path: 'inside' \| 'outside', version }` for the door and address the request arrived on |
| `GET`/`HEAD /v1/clips/{bin_file_id}?t=<ticket>` | both (outside: `rv` must be true) | the ticket | 200/206 the bytes; 401 (any ticket failure), 404 (any clip failure), 415 (type), 416 (range), 429 (limits) |
| `POST /v1/clips/{bin_file_id}/renew` | both | the first ticket's `jti` and a fresh ticket in the body | 204; 401 |
| `GET /` | inside | none | the status page: the health line and the fingerprint, nothing else |
| the preflight (`OPTIONS`) | both | none | the CORS answer for the web app's origins, with `Access-Control-Allow-Private-Network: true` |

---

## Review history

The design is reviewed as code is: two adversarial rounds, each a security attack on the design, one reviewer each, the second attacking the first's corrections. Findings and corrections are recorded here as they were made; the sections above carry the corrected text.

### Round 1

(To be written by the session after the first review.)

### Round 2

(To be written by the session after the second review.)
