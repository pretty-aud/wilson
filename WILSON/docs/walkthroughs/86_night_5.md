# 86 — NIGHT 5

One file for the night (`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one
section per session: **P8** (the four areas' High findings fixed). Each
section stands on its own; answer its questions by their numbers.

## P8 — The four areas' High findings fixed

Phase 8 of `TPN_AUDIT/REMEDIATION_PLAN.md`, your rulings of 2026-10-28
(walkthrough 85, R2 Q1 (a) and Q2 (a)): the ten High findings of the scoped
re-audit, fixed before the release. Nothing of this touched staging or
production; wilson-dev holds the three migrations and the redeployed
functions; the gateway's changes are code and tests for its next release.
The release gate (`TPN_AUDIT/SUMMARY.md`) now reads 0 Critical, 1 High: the
one you accepted (TPN-AI-009).

1. **A clip is served only once someone responsible has checked it**
   (TPN-AUTH-012). Until tonight a reviewer or a member could add a clip to
   a bin, or re-point one, and the file gateway would serve whatever path the
   row named on the share. Now every clip and every footage location carries
   a *checked* mark that only an admin or manager can give: a clip an admin
   or manager adds is checked as it lands; one a reviewer or member adds is
   not (unless the same file at the same location is already checked in that
   project, in which case it inherits the mark); re-pointing a clip clears
   it; the gateway confirms, sends and serves checked clips at checked
   locations only. In the Bins tab an unchecked clip says *added by a
   reviewer or member and not yet checked by an admin or manager*, and an
   admin or manager has **Mark as checked** on the clip (in the inspector)
   and on each location (in the locations list); the check can be withdrawn
   the same way. Every clip and location that existed before tonight starts
   unchecked (dev: 2 clips and 2 locations), so on an environment with
   footage in bins an admin or manager checks them once.

2. **The bucket endpoint is vetted and reached at one address**
   (TPN-NET-016). The Storage section's **Test** and the storage sweep used to
   fetch an admin's S3 endpoint as given, following redirects, so a name
   that pointed inside the platform's own network, or a redirect to one,
   would have been followed. Now the endpoint is resolved and refused if any
   answer is a private, loopback, link-local or reserved address, or a local
   or Supabase name — at save (the row's rule and the form's sentence), when
   the secret is stored, and at every use — and the request goes to the
   address that was checked, with no redirect followed (a redirect is a
   refusal with its sentence). A real bucket host is unaffected.

3. **A teardown takes the bin posters with it** (TPN-CONT-018): the frames
   the desktop uploaded for a torn-down company's clips were left behind the
   teardown's certificate. They are listed by prefix now and removed with the
   company's other blobs, and the certificate counts them.

4. **The desktop's bin streams are not cached** (TPN-CONT-019): both clip
   stream routes send `Cache-Control: no-store`, as the gateway's already did.

5. **ai-files refuses rather than quietly spending the platform key**
   (TPN-AI-011): an upload for a company whose own Anthropic key will not
   open is refused with a sentence that says so (and that the file was not
   sent anywhere), where before it fell back to the platform key without a
   word.

6. **The switch, the gateway and the storage settings need the
   authenticator code** (TPN-AUTH-013): an admin signed in without it (an
   old session, or a sign-in that skipped the code) can no longer flip
   remote viewing, add or change a gateway, cancel a token, or change the
   storage settings; the database refuses each with a sentence that names
   the authenticator, and the reach check's function does the same. Your
   sign-in already gives the code, so you will not notice it.

7. **The gateway never writes a plaintext secret** (TPN-ENC-014). On
   Windows, when data protection refuses, the write is refused and the
   health line is red (it used to fall back to a plain file with an amber
   line). In the container the gateway's sign-in and its certificates' keys
   are sealed under a key the NAS's operator provides —
   `WILSON_GATEWAY_SECRETS_KEY`, or a Docker secret named by
   `WILSON_GATEWAY_SECRETS_KEY_FILE` — set before the enrolment token (the
   install story on the card says so); without it the gateway refuses to
   enrol and the token stays unspent. An install made before tonight seals
   its existing files at its next start.

8. **The office certificate names the host, not its addresses**
   (TPN-ENC-013). A new gateway's certificate names `<host>` and
   `<host>.local` and no address, and a member's browser tries those names
   before any address. The addresses go back in three cases, each said on
   the health line in amber: `inside.ip_sans: true` in the gateway's
   `config.json`; a gateway installed before tonight, which keeps them until
   that option is set false; a host whose name is no DNS label. What must
   resolve the name (mDNS for `.local`, the office DNS for the bare name) is
   in HARDENING §4.

9. **A three-year root, and a successor for the release key**
   (TPN-ENC-016). A new gateway root lives three years instead of ten (its
   successor is still made a year ahead and the office's trust step comes
   round every three years). The release key that signs gateway updates can
   now be rotated: `make-key` makes the successor with its private half in
   one file you name, outside the repository, and HARDENING §10 has the five
   steps; the runbook's (g) 4 asks you to make it before 1.0.0, so every
   install trusts both keys from the start and the first rotation needs no
   reinstall.

10. **The two master secrets are versioned per environment, with a re-seal**
    (TPN-ENC-015). The secret that seals every company's bucket credential
    and the one that seals every company's Anthropic key were the same value
    on dev, staging and production. Each can now be set per environment and
    rotated by version (`_V2`, `_V3`, …): new rows are sealed under the
    newest, old rows still open under theirs, and the console's new
    **Secrets** section shows which versions each environment holds and how
    many rows sit under each, with a **Re-seal** that moves every row to the
    newest version behind a confirm naming the functions to redeploy first.
    Nothing has been rotated: production gets fresh values at the release
    (it holds no rows), and the controller runs the dev and staging re-seals
    by the runbook's (d) when you say so.

**Questions.**

**Q1 — Where the check lives (item 1).** The mark that lets the gateway
serve a clip is given today in two places: on a clip, in the Bins tab's
inspector, and on a location, in the locations list; both only for an admin
or manager. (a) **Keep it there (Recommended)**: the person who vouches for a
path does so where they see the path. (b) Add a bulk control too: *Check
every clip in this bin*, for a bin a reviewer filled from a known folder. (c)
Somewhere else you name. The gateway's rule does not change with the answer.

**Q2 — Existing gateways and their addresses (item 8).** A gateway
installed before tonight keeps the addresses in its certificate until its
`config.json` says `inside.ip_sans: false`, so nothing it serves today stops
serving. (a) **Keep it so (Recommended)**: the switch is the administrator's,
after they have checked the office resolves the name. (b) Drop the addresses
for every gateway at its next certificate renewal (within a year), with the
amber line warning first. (c) Keep addresses on by default everywhere, names
only where an administrator asks. No gateway of a customer exists yet, so the
answer costs nothing now and shapes the install story later.

**Q3 — Where the container's sealing key goes (item 7).** The gateway
accepts the key as an environment variable (`WILSON_GATEWAY_SECRETS_KEY`,
what Synology's Container Manager offers) or as a Docker secret file
(`WILSON_GATEWAY_SECRETS_KEY_FILE`, or the default path
`/run/secrets/wilson_gateway_secrets_key`, what a compose file offers). (a)
**Keep both, the install story leading with the variable (Recommended)**: the
card's steps are Container Manager's, and the secret file is documented for
a compose user. (b) The secret file only, the story rewritten for compose.
(c) The variable only. Either way the key never goes into `/data` or the
image (HARDENING §5), and losing it means enrolling again.
