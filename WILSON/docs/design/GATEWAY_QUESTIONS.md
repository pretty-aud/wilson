# The file gateway (BC4) — the questions before the design (2026-10-09)

Your choice on 2026-10-06 ("okay lets go with option a"): a small WILSON service installed on the company's server lets the web app play and scrub clips that stay on the server. The three Bins sessions are done; the browser now shows the catalogue and says playing needs the desktop. Before anyone designs the gateway, ten questions in plain words, each with the answer I would pick. The storage design (`docs/NETWORK_STORAGE_DESIGN.md` §4 Option D, §4b, §4c) and BC3's hand-off ("For the gateway") are what these stand on.

**What the gateway is, in one paragraph.** A program the company installs on a computer that stays on inside their network (the NAS itself, or any always-on PC). The web app asks it for a clip; it checks the person's WILSON sign-in, checks that the clip is one of the company's bin clips (never any other file), reads it from the share and sends it to the browser in pieces so it can scrub, and writes a line to the cloud saying who watched what, when, from inside or outside the network. Inside the office network it works as soon as it is installed. From outside it works only while the admin's switch is on — and the switch says at the control what that means for a studio that needs TPN certification. WILSON never relays the bytes through Petal's own servers (the storage design ruled that out for TPN).

## The questions

**G1. Where does it run?**
- (a) **On the NAS itself** (a package or container; Synology, QNAP, TrueNAS and the like can run one).
- (b) **On a Windows PC that stays on** (an installer, runs as a service).
- (c) **Either**, the company picks. My pick: **(c)** — one program, two ways to install it.

**G2. How does a browser inside the office reach it?**
- (a) By a name the company gives it on their network (`https://wilson-gateway.local`), with a certificate the gateway makes for itself the first time it runs and the admin installs once per computer — or a proper certificate if they have one.
- (b) The gateway registers itself with the WILSON cloud when it starts, and the web app learns its address from there, so nobody types an address. My pick: **(b), with (a)'s certificate story underneath** — the browser still needs to trust it.

**G3. How does a browser outside the office reach it (switch on)?**
- (a) The company's IT opens it to the internet themselves (a port on their router or a tunnel they run); WILSON tells them exactly what to open and checks it is reachable.
- (b) The NAS vendor's own remote-access relay, where the NAS has one. My pick: **(a), with (b) noted as a way to do (a)** — either way the company exposes it, never Petal.

**G4. Who may be served?** Anyone signed in to WILSON who is on the project and past the Bins gate (members, managers, reviewers — your B6), checked on every single read with their sign-in token. My pick: **yes.**

**G5. What may it read?** Only clips that are in a bin of a project the person is on, by the location and path the cloud holds — never a path the browser sends. My pick: **yes, nothing else, ever.**

**G6. What is written down?** Every read: who, which clip, when, inside or outside the network, and how much of it — visible to workspace admins in the file activity, kept with the other file events. My pick: **yes.**

**G7. What plays?**
- (a) Only what a browser can play as it is (H.264 / AAC MP4, WebM); a clip in a professional codec shows its picture and "needs the desktop app", as today.
- (b) The gateway converts other formats on the fly (needs a strong machine; slow on a NAS). My pick: **(a) now; (b) only if a named customer needs it.**

**G8. A viewer's name over remote playback.** Studios often expect a visible name on content viewed from outside. (a) The player draws the viewer's name over the picture when the clip is served from outside the network (not burned into the file, so it costs nothing on the server); (b) nothing. My pick: **(a).**

**G9. Updates.** (a) The gateway checks for a new version from Petal and updates itself, showing its version in the company's settings; (b) the company updates it by hand. My pick: **(a), with (b) possible.**

**G10. The order of work.** (a) A design session first (the install story, the certificate story, the exact checks, the audit; its own short list of what it found), then the build in three to five sessions; (b) build straight away. My pick: **(a)** — this is the one piece that runs on customers' hardware.

## Things I decided without asking (say if any is wrong)

- The gateway never copies, converts or caches footage on its own disk; it reads the share and streams.
- The switch stays the only thing that opens the gateway to the outside; off by default; its sentence at the control as the storage design §4b prescribes; turning it on is never sold as TPN-compliant.
- A gateway that is installed but switched off answers inside the network only, and from outside answers nothing — provably the same as no gateway at all.
- The desktop app signed in keeps reading files directly (BC2); the gateway is for browsers.

## The answer block (copy, change what you disagree with, paste back)

```
g1 either, the company picks
g2 the gateway registers itself with the cloud and the web app learns its address from there, with a certificate the admin installs once per computer
g3 the company exposes it themselves (a port or a tunnel they run, or the NAS vendor's relay), WILSON tells them what to open and checks it
g4 yes
g5 yes, only bin clips of projects the person is on, never a path the browser sends
g6 yes, every read written down, visible to admins
g7 only what a browser can play as it is; other formats show the picture and need the desktop
g8 the viewer's name drawn over the picture when served from outside
g9 it updates itself and shows its version; by hand also possible
g10 a design session first, then the build
decided-without-asking all good
```
