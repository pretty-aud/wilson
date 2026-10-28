# 86 — NIGHT 5

One file for the night (`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one
section per session: **M3** (the desktop → cloud migration, part 3) and
**P8** (the four areas' ten High findings fixed). Each section stands on its
own; answer its questions by their numbers.

## M3 — The migration carries the team, the rate cards, the templates and your files

1. **Your desktop team arrives, matched by email.** Each desktop team
   member whose email is a company account's is that account in the cloud
   (your ruling of 2026-10-28: *"Match by email, leave the rest here"*).
   Only a workspace admin or manager can make the match — the cloud shows
   emails to nobody else — so run it as one. Anyone without a WILSON account
   is named in the report, by name, and stays on this computer: their seats,
   crew lines, rates and tasks arrive without the person until they join. No
   email is sent to anyone.
2. **The project's roster, and every person on every row.** Team
   assignments become the project's roster, with the role as the desktop
   says and the member's job title. A crew line priced for a team member, a
   rate set for one, a task's assignee and reviewer, the project's producer
   and director: all name the account now. A crew line an earlier run
   carried without its person gets the person on this run (walkthrough 85,
   Q1), as do tasks and the project a run before tonight's build carried
   with a name nobody could read.
3. **The files kept with your assets, scenes, shots, levels and
   experiences go up, with their contents.** Each becomes a file in the
   cloud with its own name, in its folder, linked to its row, where the
   company keeps its media. A large file goes up in pieces, never held whole
   in memory. A company that keeps its media on its own server keeps these
   files there (your ruling the same evening); the browser says where they
   are.
4. **The company's rate cards and task templates go once.** Each desktop
   card arrives beside the cloud's own General and Internal pair, with its
   entries (a workspace admin, or someone with the rate card edit grant);
   each template with its tasks (a workspace admin or manager), and an asset
   made from one is linked to it again.
5. **A receipt an earlier run left open is behind the money gate now.** If
   you moved a project with night 3's build and it had a receipt kept
   before receipts became money, this run moves it — its picture, its file,
   its row — so only managers and admins see it.
6. **Archive and clear local keeps its promise.** The team members, rate
   cards and task templates on this computer are archived and cleared with
   the projects.

**What this is.** M3 of night 5 (`docs/sessions/briefs/po-m3-migration-part-3.md`),
your three rulings of 2026-10-28 (*"A night after part 2"*; *"Match by
email, leave the rest here"*; *"Stay on the server for 1.0"*). Every row
shape was tried on wilson-dev first and rolled back; a design round on Fable
came before any code. No migration: staging owes nothing from M3.

**Before you start.** The desktop app, signed in to the beta's company as a
**workspace admin**, on a desktop project with a team (Team tab: a few
people assigned, one of them a manager), a budget with a crew line priced
for one of them, and a file or two added to an asset in its folder (Files →
the asset). On the desktop's Team Members page, one person should have an
email that matches their WILSON account, and one should have none (or an
email nobody has an account for). A second browser window signed in as
yourself helps for steps 5 and 6.

1. **Dry-run.** Settings → Storage → *Migrate to cloud* → **Dry-run**. The
   table has new rows: **roster seats** right after *projects*, **files kept
   with rows** after *files*, and **rate cards**, **rate card entries** and
   **task templates** at the end. *Would insert* counts what will go.
2. **Read the people lines under the table.** They come first:
   - *N of M desktop team members matched a company account by email.*
   - *K desktop team members not matched to a company account (no WILSON
     account yet: …; no email on this computer: …): their seats, crew lines,
     rates and tasks arrive without the person until they join (no email is
     sent).* The names are your desktop team's; no email is shown anywhere.
   - *N people seated as a project's manager — as on this computer, or as
     its producer, whom the cloud seats so: in the cloud a project manager
     sees its budget and sets its roster (make them members in the browser if
     that is too much): …* — Q1 below.
   - *N files kept with assets, scenes, shots, levels and experiences (X MB)
     will upload to the company's storage.* The total is said before
     anything moves.
   - If a receipt an earlier run left open is there: *N receipts an earlier
     run carried as ordinary files will be put behind the money gate.*
   - If you are not a workspace admin or manager, one line instead: *the
     team stays on this computer: in the cloud only a workspace admin or
     manager may read the company's emails, which the migration matches your
     desktop team by (ask one to run it)* — and Migrate will not say Done
     until an admin runs it.
3. **Migrate.** Press **Migrate**. The log streams; the files' line reads
   *… uploaded to the company's storage* when they are in. When it ends,
   hover **Migrate** and read: *Done. Running it again writes nothing already
   in the cloud and brings back nothing a teammate removed there since: this
   computer keeps a record of every row the migration carried.* If a file's
   body was not on this computer (a drive not mounted), the line *N files …
   have no body on this computer right now …* appears and Migrate is not
   Done: make the folder reachable and Migrate again.
4. **Check it in the browser.** Open the project on the beta:
   - **Team**: the roster shows your desktop team's people who had accounts,
     with their roles and job titles; the person without an account is not
     there (they arrive when they join and you run again).
   - **Budget → Crew**: the crew line priced for a team member now shows the
     person, and their actuals sit under them (walkthrough 85's Q1 is
     answered by this run).
   - **Rate card** (Admin Terminal or the Rate card page): the company's
     General and Internal cards as before, and your desktop's cards beside
     them with their entries; an entry for a person without an account is
     not there.
   - **Files**: a file you kept with an asset is in the asset's folder,
     named as on the desktop; its preview opens. A second version of the
     same file is a second row whose description starts with its label
     (*v002*) — Q2 below.
   - **New asset → Task template**: your desktop's templates are in the
     list, and an asset you made from one shows it.
5. **Run it again at once.** **Dry-run**, then **Migrate**: nothing is
   inserted, no file is uploaded again, and no line says anything was
   removed.
6. **A teammate removes a seat.** In the browser, remove one person from the
   project's roster (Team). On the desktop, **Dry-run**: the first line under
   the table reads *Removed in the cloud since an earlier run, so not carried
   again: 1 roster seat*, with the person's name below it. **Migrate**: the
   seat does not come back.

**Questions**

- **Q1.** A desktop team member assigned as a *manager*, and anyone named
  as the project's *producer*, is seated as the project's **manager** in the
  cloud — which there means they see the budget and set the roster. The
  report names them. Keep it (Recommended: the desktop said manager, and the
  cloud seats a producer so itself), or seat everyone as a plain member and
  promote by hand in the browser?
- **Q2.** A file kept with an asset in two versions on the desktop (v001,
  v002) arrives as two files of the same name; the second's description
  starts with *v002* so you can tell them apart. Keep that (Recommended),
  or put the label into the file's name (*plate (v002).png*)?
- **Q3.** For a company whose media is in its own S3 bucket, a file past
  5 GiB is left on this computer and counted: the bucket takes a file in one
  piece. Fine for 1.0 (Recommended), or should the migration wait for a
  multipart upload before carrying such a company's files at all?
- **Q4.** A desktop team member with no email on this computer can never be
  matched. Should the morning note ask you to add emails on the desktop's
  Team Members page before migrating (Recommended), or should a later build
  match by name as well (not recommended: two people can share a name)?

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
   locations only. In the Bins tab an unchecked clip says *this clip has not
   been checked by a workspace admin or manager yet*, and an admin or
   manager has, in the clip's inspector, **Mark as checked** on the clip
   (**Withdraw the check** once it is) and **Mark the location as checked**
   beside its location while that is unchecked (a location's check, once
   given, stays: withdrawing it is not in the UI tonight). A check given or
   withdrawn by hand is of the file: every row at that file in the project
   takes or loses it. A copy, or an undo of a removal, is not a check: the
   new row takes a checked twin's mark, or none (so an undo of your own
   checked clip comes back unchecked when no other row at that file is
   checked; one click re-checks it). Every clip and location that existed
   before tonight starts unchecked, so on an environment with footage in
   bins an admin or manager checks them once (dev's two fixture clips and
   two locations were stamped the migration's way after the apply, so CI's
   probe keeps its clip).

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
serve a clip is given today in the Bins tab's inspector: on the clip, and on
its location while that is unchecked; both only for an admin or manager. (a) **Keep it there (Recommended)**: the person who vouches for a
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
