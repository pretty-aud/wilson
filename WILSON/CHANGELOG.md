# Changelog

All notable changes to WILSON are recorded here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file starts at 1.0.0. Everything before it shipped as the 0.x single-user desktop app and was never changelogged.

---

## [1.0.0] — Unreleased

*The controller dates this heading on release day, before the deploys (`docs/PRODUCTION_RUNBOOK.md` (g) 8). Rewritten 2026-10-28 (R2, night 4 of `docs/sessions/PLAN_TO_1_0.md`) from `docs/OUTSTANDING.md`'s Session log, the hand-offs in `docs/sessions/handoffs/` and `docs/MASTER_PLAN.md` §4, and checked against the tree at `51e5a0d7`. Each line ends with its source: a session, a merge or commit, or a file. What night 4 and night 5 merge after that commit, the controller adds.*

### The 1.0.0 story

0.6.3 was a single-user Electron app: one shared password checked against a hardcoded string, every user's data on their own disk, and an Anthropic API key sitting in `localStorage` on every client.

1.0.0 is a multi-tenant platform. A company is a **workspace**, and **Postgres Row-Level Security is the security boundary**, not the client and not the Edge Functions. Sign-in is company-first; two-factor is challenged at sign-in once enrolled, required for the operator console, and a step-up on the admin Edge Functions for an admin who has enrolled (not yet on admin writes made through RLS, and enrolment itself is not yet required); and the Anthropic key never reaches a client. The whole product runs on the web as well as the desktop, after a UI overhaul that gave every page one kit and one type scale. Behind the three tools sit a budget with living bid versions, shot lists and edits, footage bins with a file gateway that plays office footage in a browser, a company's own storage (its NAS or an S3-compatible bucket), custom table views, and an O.T.T.E.R. that shares one subject live with a colleague.

**The build, measured at `51e5a0d7`:** the app `1.0.0` (`package.json`); D.O.G. 0.514, O.T.T.E.R. 0.3.1 and R.A.B.B.I.T. 0.1.0 (their folders under `src/tools/`); the file gateway 0.1.0 (`gateway/package.json`). The database: **97 migration files, 0000 to 0101** (no file for 0065, 0079, 0080, 0087 or 0094). **22 Edge Functions** (`supabase/functions/`, `_shared` aside). **99 pgTAP suites** (`supabase/tests/rls/`). Vitest: 417 files, 10,404 passing (DG4's tip).

---

### Added

**Tenancy and authority**

- **Workspaces.** A workspace is a company; membership is a `workspace_members` row with a per-workspace username, an app role and rate-card grants; a person can belong to several and switch. (S1–S15; `docs/SYSTEMS_HANDBOOK.md` §4)
- **Four tiers:** `user` → `manager` → `admin` → **platform operator**, and **project roles** in R.A.B.B.I.T. (`manager`, `reviewer`, `member`). (S9–S15; handbook §4.4)
- **RLS on every tenant table**: every read and write needs the token's workspace and a live, active membership row, and a write that needs a role reads it from the token (TPN-AUTH-006); pinned by pgTAP in CI. (handbook §4.4; `.github/workflows/rls.yml`)
- **Private projects:** seen by their creator and the admins, their media kept on the creator's computer. (0072, `4c103875`; 0082, 0083)

**Accounts, sign-in and sessions**

- **Company-first sign-in.** The company is checked first and only its people sign in; the same username can live in two companies; the company is remembered on the device and `?company=` fills it. (S43 `bec91852`, `158172ce`; Track B B1 `397afef3`)
- **Two-factor (TOTP)** in App settings → Profile, a challenge once a factor is verified, required for the operator console, and a step-up on the admin Edge Functions for an admin who has enrolled (not on admin writes made through RLS: TPN-AUTH-003, TPN-AUTH-013); enrolment stays optional (`WILSON_REQUIRE_ADMIN_MFA` is off by default, TPN-AUTH-002). (S9–S17; handbook §4.2, §4.6)
- **Show-once credentials** at creation and at an admin's reset; **invite, forgot-password and reset** flows mailed through Resend, with links a mail scanner cannot spend. (S9; S18 `28dec647`)
- **A setup link** the operator can email a new company's first admin. (S43b `186fa636`, 0066; Track A A1 `5dcff986`)
- **Sign-ins in the logs, and session limits.** Sign-in, two-factor, sign-out, idle and cap rows in Admin terminal → Logs → **Sign-ins** and in the console's **Sign-ins**; a warning at 25 idle minutes, a sign-out at 30, a cap at 4 hours, each saying why. (Track B B2: 0070 `cd8dfb8d`, 0071, `aafc488a`)
- **Reconnect after a hung session check:** *Connection lost — reconnecting…* while the client retries on its own, **Reload** after a minute. (S1 `dda71387`; `docs/design/RECONNECT_DESIGN.md`)
- **The offline launch:** a saved sign-in less than four hours old opens the desktop's shell offline, one sentence on each screen and nothing that would create. (S2 `6076ea47`; her rulings of 2026-10-27)
- **A password change in App settings** and a **Log out**. (S21 `10fcd29b`; S31 `272fb832`)
- **One desktop copy at a time**, and a per-launch token on every request to the desktop's local server. (Track B B3 `15312107`)

**The Admin terminal** (admins only): **Users**, **Company**, **Models**, **Storage**, **Requests**, **Logs** (System, Activity, Sign-ins) and **Diagnostics** (with storage cleanup and the AI file store's card). (`src/components/AdminTerminal/AdminTerminalPage.jsx`; S9, S20, S34, B2, FX12)

**The operator console** (`/wilsonadmin`, its own build): **Companies** (create, rename, suspend, restore, tear down with certificates, the setup link), **Models**, **AI files**, **Audit** and **Sign-ins**; per-company Anthropic keys, validated and stored as AES-256-GCM ciphertext; Petal cloud storage plans. Granting the operator tier stays SQL-only. (S15; S20; S41 `operator-storage-plans`; FX12; `src/admin/OperatorApp.jsx`)

**AI**

- **Every model call through one registry** and an operator-approved model catalogue at platform, company and user level (operator Models, Admin terminal Models, App settings Models). (S19 `8a73d446`; S20 `6e422d22`, 0031)
- **D.O.G.'s documents go to the AI provider's file store** through `ai-files`, under a neutral name, expiring in 24 hours, deleted when a file leaves the deck, at sign-out and when the desktop closes, with an admin's and an operator's sweep. (`6d4ac65e`, 2026-08-11; FX12 `07f30a4f`)

**R.A.B.B.I.T.**

- **Everything in the cloud:** budgets with bids, actuals, expenses and per-project rates (S24, 0036–0039); scenes, shots, levels and experiences (S25, 0040); folders and files with a rewritable manifest (S26–S27, 0041–0043); task templates (S28, 0044); key dates with trash and undo, live between windows (Track A A2, 0067, 0077); dependencies and the phase tree (0061, 0063).
- **Shot lists and edits.** Lists in the Scenes tab; edits, the saved cuts of a list, with Save edit, Save as…, drag and drop and a guard on leaving; a change to a saved edit saves into it. (0084 `bd67360f`, 0086; FX4 `ba0f6c9c`; walkthroughs 51, 53, 67)
- **Files.** The Files tab and the file window; tags (0085); an explorer with one folder at a time and shot folders inside their scenes (S4a, S4c); a file's duration and source date (0081). (walkthroughs 52, 56)
- **The Legal gate.** A file added as Legal is seen by project managers, workspace managers and admins only. (0088 `a9eac592`; 0092 `7b388e1a`; walkthrough 54)
- **Bid versions as living documents.** An open version that shows exactly its own schedule, set-aside rows never lost, the versions block, the Timeline's **Bid ver.** bar, a read-only view and a lock, broadcast live to other windows. (0089, 0090; S5–S5d; 0101 R1; walkthrough 55)
- **The Timeline** with weekends hidden and readable week labels. (S5p; post-overhaul S1)
- **A task relates to many items** (assets, scenes, shots, levels, experiences), and there is no "main" one: deleting an asset never deletes a task. (0096 FX2; 0097 VW1m `de3eefae`; walkthroughs 65, 74)
- **Custom table views** on Tasks, Assets, Levels, Experiences, Scenes and Shots: filters, sorts, groups, groupings, fields, shared per project, the last one used kept per person. (0098, 0099; VW1–VW1e; `docs/design/CUSTOM_VIEWS_DESIGN.md`; walkthrough 72)
- **R1's robustness set:** Levels and Experiences take the Scenes write gate; a dependency's Replace link is one undoable step; D.O.G. reads past a project's first 1,000 cloud files; the Dashboard shows a task's items live; the Tasks CSV exports what the table shows. (R1 `d75e04de`; walkthrough 82)
- **The desktop → cloud migration, part 1:** the project, key dates, comments, shot lists with their edits, folders with their files, scenes, shots, bins and the views, dry-run first, again without duplicates. (M1 `7a9668a8`; walkthrough 84)
- **One connection dot** in each tab's corner for the database and the files' home. (FX11 `7ecfcbc7`; walkthrough 73)

**Storage, previews and footage**

- **Petal cloud plans:** metered and operator-managed, 50 GiB per file, 5 GiB free, resumable uploads, reservations so concurrent uploads cannot pass the quota, receipts and invoices exempt up to 25 MiB. (S41 0055/0056; S42 0057/0058; Track C 0073, 0078)
- **A company's own storage:** its server or NAS as the workspace root, managers placing project folders inside it, and S3-compatible buckets (AWS S3, B2, Wasabi, Hetzner, R2, MinIO). (S34 0048; S35 0049; S36 0050; S37 0051/0052, `storage-presign`, `storage-secret`)
- **Thumbnails and video:** thumbnails on both hosts in a private bucket, each kept where its source is; video preview and still frames. (S39 0053; S44 0054; S40 `4e53c341`)
- **Footage bins:** ingest, review, logging, marks and takes, on the desktop and, as a catalogue, in the browser; locations named by network address; an admin switch, off by default, for viewing from outside the office. (demo bins; BC1 0091 `0b38077c`; BC2; BC3; walkthroughs 57, 58)
- **The file gateway:** a small WILSON program in the office (a Windows service or a NAS container) that plays a company's footage in the browser, through an office door and, with the switch on, an outside door, on signed two-minute tickets, with a signed release channel and a hardening guide. (BC4 `docs/design/GATEWAY_DESIGN.md`; GW1–GW5; 0093, 0095; five `gateway-*` functions; `docs/gateway/HARDENING.md`; walkthroughs 60–63)

**O.T.T.E.R.**

- **Subject shares:** one subject or a whole course shared live and read-only, accepted first, passed on in a chain, each person keeping their own progress. (0100; N2/N2b design; B1 `41e1171f`; B2 `d0a83cc1`; walkthrough 84)
- **Course nominations** with badges for where a course came from; quiz history kept; the Validator's Accept saves. (0064 `a7d87c56`; S30 0045)
- **A Library switch,** the company's or this computer's; the function library in editor colours and the lesson at 66 characters. (Track A A4 `088dba82`; S2b; S2c)
- **The cloud content model** from 0.x's July build: personal, shared and company-standard courses, editor grants, fork on use, the change-request loop and its review window. (S10–S13; handbook §13.2)

**D.O.G.**

- **References:** the project's items, files and personal notes chosen as sources, the uploads among them, in one card, **1 Project and references**, with **Core files only**; **Place visual** and **Theme generator** the only two options. (DG1 `9c21bd05`; DG1b `e90d6b86`; DG2 `247c090d`; DG4 `9a4dfe77`; walkthroughs 75, 80, 84)
- **Cloud project attachments**, listed, downloaded and read like local ones. (Track C C3, 0075 `2a4924f2`)
- **Keyboard:** Enter makes a full deck only with words in the context box; the cards fold from the keyboard. (FX13 `6db22a9b`; FX14 `566c6a8a`; FX15 `687667a3`; DG3 `10426db8`)

**The pet** follows its owner between computers and reads O.T.T.E.R.'s lessons; a failed sync retries by itself. (0046 S31; `8894fd23`; 0068 A3; S2)

**Look and feel:** the UI overhaul, with Geist and Geist Mono self-hosted, one type scale, a shared kit with one dialog, dark working pages and sentence case; each tool's Help and Settings at its strip's right end. (merged `60a8981e`, 2026-09-29; `docs/design/UI_OVERHAUL_PLAN.md`; S2a; S6a; walkthrough 47)

**Operations:** the web app at `https://beta.petalstudios.co/wilson` (staging, from `feat/multi-user-v1`); auto-update over an NSIS feed; nightly `pg_dump` backups to B2; Sentry; WIL-#### event codes; CI of four jobs on every session branch, plus the gateway's own workflows. (S9–S12; `docs/WEB_DEPLOY.md`; `.github/workflows/`)

---

### Changed

- **No self-serve company creation.** The operator creates companies; people join by invite or are created by an admin. (S43 `bec91852`)
- **App settings' R.A.B.B.I.T. tab is now Storage**, and *Tool settings* left the nav strip. (S22 `8709b1ed`; S2a)
- **Money is for managers:** the Budget tab is hidden from others; the internal rate card holds full-time staff only. (S24; 0059 `cfe2cbdc`)
- **The pet and personal settings live with the person in the cloud**, not on the machine. (S31; Track A A3)
- **A change-request approval moves the reference documents too** (hotkeys, functions, nodes, links); corrections stay with the proposer. (Track A A4 `dfe666e8`)
- **Anyone may nominate a course as the company's standard**; admins and managers decide. (0064)
- **D.O.G. sends documents as file ids**, not inline. (`6d4ac65e`)
- **R.A.B.B.I.T.:** the LIVE pill became the connection dot; no main item; an edit changes in place. (FX11; VW1m; FX4)
- **Edit history covers fourteen tables** and **the workspace takeout 23**. (0061; `WorkspaceTakeout.jsx`, `TAKEOUT_TABLES`)
- **A lost connection reconnects by itself** before it asks for a reload. (S1)

---

### Security

- **The `anon` role was swept:** 25 tables and seven SECURITY DEFINER functions closed to it, and the default privilege that would reopen them disarmed. (0033, S22 `494a13d6`)
- **A live rate-card escalation was closed on every environment** (after 0059 any member could grant themselves the rate card). (0062 `5c907e82`)
- **The pre-sign-in endpoint that made admins is gone.** (`provision-workspace`, S43)
- **Sign-in's limiter is durable and fails closed**, keyed on the address the edge sets, not a header the client sends. (Track B B1; TPN-NET-004, TPN-NET-005)
- **Sign-ins are logged**, the operator console's included, and an admin no longer reads a shared member's rows from another company. (Track B B2, 0070, 0071; TPN-LOG-003, TPN-LOG-007)
- **The desktop's local server takes a per-launch token**, narrowed CORS and one running copy. (Track B B3; TPN-NET-001)
- **Storage configuration is admin-only and contained:** the storage root, a project's folder inside it, and the paths a request may name. (S33–S35, 0048, 0049; TPN-AUTH-011, TPN-NET-013, TPN-NET-015, TPN-CLOUD-007)
- **Thumbnails are private and money-gated**, and follow their source's storage. (S39 0053; S44 0054; TPN-CLOUD-008)
- **Company bucket secrets** are AES-256-GCM ciphertext in a table no client reaches, under a key apart from the AI keys' (the same on all three environments: TPN-ENC-015). (S37 0051; `docs/OWED_AUDREY.md` §9 C2)
- **Uploads that never complete are certified**, at once, hourly and at teardown; receipts are money. (Track C 0073, 0074, 0076; TPN-CONT-017)
- **A manager approving their own nomination is allowed and audited** (WIL-4108). (0069 `93c199e6`)
- **The file gateway was attacked before release** and its findings fixed (a per-peer connection cap; `CF-Connecting-IP` honoured only behind a declared proxy). (GW5, `docs/sessions/handoffs/po-gw5-2026-10-12.md`)
- **Viewing from outside the office is off by default**, enforced in the database, and the switch says it leaves TPN Gold eligibility. (0091; TPN-NET-012)
- **Earlier July work stands:** RLS as the boundary, privilege changes audited (WIL-4105/4106/4107), operator writes narrowed, MFA guards that fail closed, the Anthropic key never on a client, path containment on managed files, four append-only audit streams. (S15–S17; `TPN_AUDIT/FINDINGS.md`)

---

### Fixed

The defects that people testing the beta met; defects inside new work are described by the features above.

- **Invites** spent by mail scanners before anyone clicked; two-factor sign-in deadlocking; `/wilsonadmin/` with a trailing slash. (S18 `28dec647`; 2026-07-31 `920a2f73`, `8222ea19`, `a776907a`)
- **AI features failing on a retired model id**, and the Validator's continuation. (S19; `dab90463`)
- **Nothing could be created in cloud mode**; rate cards could not be created. (S23 `2727328`; S21, 0032)
- **Budget** percentages not saving, four budget tabs never rendering, Client View printing "Project". (S24; S25)
- **O.T.T.E.R.:** a course outline that failed to parse, lessons emptied by an empty save, the pet's saves failing silently. (`a9054713`; `9b56bec1`; `73828c75`)
- **Every cloud upload broken** by a file list emptied in place; D.O.G. generating nothing (HTTP 546). (S40; `6d4ac65e`)
- **Signing in on the desktop hid O.T.T.E.R.'s local courses.** (Track A A4 `088dba82`)
- **The Crew and Talent invoice attach** now uploads and shows its errors. (S24 `dfdf3867`)
- **The closed defects list for 1.0** (`docs/sessions/PLAN_TO_1_0.md` §3): D.O.G.'s Generate after typing and its Choose file, card 1's label, the focus ring on R.A.B.B.I.T. (DG3 `10426db8`); bid versions not broadcast, D.O.G.'s 1,000-file limit, Team members and Rate card wider than 1280, the Dashboard's stale items and the Tasks CSV (R1 `d75e04de`); the two-factor screen's overflow (S1 `dda71387`).

---

### Removed

- **`provision-workspace`, the New company wizard and the *New company?* link.** (S43 `bec91852`)
- **O.T.T.E.R.'s Storage Location field**, which nothing read. (Track A A4 `088dba82`)
- **The LIVE pill, the adapter dot, the main item, *Use project assets***, and the browser's old saved views. (FX11; VW1m; DG4; VW1d, VW1e)
- **Migration 0065**, the subject-shares draft, replaced by 0100. (B1)
- **One-off scripts, session launch entries and dead exports**, the built bundle byte-identical before and after. (N1 `13543f14`; `docs/sessions/handoffs/po-n1-2026-10-27.md`)
- From the July build: the local password screen and its routes, the Settings API-key field, the legacy `public.users` table, and 1,840 lines of unreachable code. (S12–S17)

---

### Known limitations

The tester's list is `docs/RELEASE_TESTING.md`, *Known not to work at v1.0.0*; faults are `docs/OUTSTANDING.md`; limits by design are the handbook's §17; the security posture is `TPN_AUDIT/`.

**Security**

- **The TPN re-audit of 2026-10-28 reports 11 High open** in the file gateway, bins, own storage and the AI file store (`TPN_AUDIT/SUMMARY.md`, *Release gate*): eight of the areas' own (TPN-AUTH-012, TPN-NET-016, TPN-ENC-015, TPN-ENC-014, TPN-CONT-018, TPN-ENC-013, TPN-ENC-016, TPN-AI-009) and three instances of open classes (TPN-AUTH-013, TPN-CONT-019, TPN-AI-011). The plan holds the controller's production steps until the re-audit reports nothing High; walkthrough 85 asked her to rule on each. Her Q1 answer (2026-10-28): the seven of the areas' own other than TPN-AI-009 are fixed before the release (Phase 8), and TPN-AI-009 is accepted for the start of the production steps. Her Q2 answer, the same day: the three instances are fixed with them, ten in all.
- **The `smoke_admin` password is in public git history** until it is rotated. (TPN-SDLC-007; `docs/OWED_AUDREY.md` §0)
- **Staging's legacy `service_role` key was exposed** and is owed a roll. (`docs/OUTSTANDING.md`, S19)
- **A private project's rows reach every member's workspace channel**, and the `tasks` and `assets` write policies lack the project hop. (OUTSTANDING A-R1-04, A-R2-03)
- **The `user-avatars` bucket is public, and a new avatar may not last** (the cause unproven; 0102 is reserved). (TPN-CLOUD-004; OUTSTANDING *Avatar does not persist*)
- **Seven Edge Functions have no rate limiter** (the four `admin-*`, `invite-member`, `issue-session`, `storage-gc`). (the tree)
- **Failed sign-ins are logged only once each project's two Auth hooks are on**; guard refusals are logged nowhere; `app_events` and `edit_history` purge at 90 days. (`docs/OWED_AUDREY.md` §14; TPN-LOG-004)
- **The AI provider's store still holds staging's and production's uploads from before FX12** until the sweep, and from 2026-11-09 nothing can say whose they are. (OUTSTANDING FX12-01; TPN-AI-009)
- **On the desktop the four-hour cap restarts at each launch.** (OUTSTANDING S2-01; night 4's D1)

**Product**

- **The migration does not yet carry** budgets, expenses, levels, experiences, the team or task links, and a second run brings back rows a teammate deleted (night 4's M2); no night yet carries asset versions, the desktop's own file store, rate cards, team members or task templates (night 5's M3). (OUTSTANDING M1-L1, M1-L2)
- **Scenes, shots, levels and experiences do not reach a second window live**; key dates do. (her ruling, Track A)
- **A company's own bucket or NAS has no browser previews** (night 4's P1 for S3); professional codecs need ffmpeg. (handbook §12.7b; OUTSTANDING)
- **The pet does not sync live between machines** (1.1); an O.T.T.E.R. lesson imported in the cloud saves nothing. (`docs/sessions/PLAN_TO_1_0.md` §2; OUTSTANDING)
- **The Summary's Budget tile is zero; the Agent skills checkboxes gate nothing; R.A.B.B.I.T.'s agent is unreachable; Google Drive is read-only.** (handbook §17)
- **The workspace takeout holds 23 tables, and none of the scenes, shots, levels, experiences, key dates, budgets, expenses, folders, task templates, shot lists, edits or bins.** (OUTSTANDING R2-01)
- **About 160 accessibility and polish entries** wait for 1.1. (`docs/sessions/PLAN_TO_1_0.md` §2)

---

### Deployment notes

Production is brought up by `docs/PRODUCTION_RUNBOOK.md`, in its order: the reads first, the migrations from 0064 by file by the house method, every Edge Function, the secrets by name and digest, the two Auth hooks and the session time-box, the builds, then PR #4 merged into `main` with a merge commit and the tag.

- **Before the tag,** `docs/sessions/PLAN_TO_1_0.md` §0's four conditions: the features merged and on the beta, the nine defects closed, her testing (`docs/RELEASE_TESTING.md` and the walkthroughs), and the release steps, hers in the browser and the controller's on production after the TPN re-audit reports nothing High.
- **Hers, in the browser** (plan §6): rotate `smoke_admin`; roll staging's legacy `service_role` key; the two Auth hooks on staging; PR #4's title and body; the gateway's GitHub setup and the installer rehearsal; the AI-files sweep before 2026-11-09.
- **Secrets are Edge Function secrets,** not GitHub's or Vercel's. `WILSON_AI_KEY_SECRET` and `WILSON_STORAGE_KEY_SECRET` are identical on every environment today, so that a key stored on one opens on the others; that sameness is TPN-ENC-015, and production can take fresh values while it holds no stored key; `WILSON_GATEWAY_KEY_SECRET` is set per environment (dev and staging have one, production not yet). (`docs/OWED_AUDREY.md` §5, §9; `docs/sessions/handoffs/po-gw1-2026-10-10.md` §2)
- **The desktop installer** is built with `npm run dist` only, from a checkout whose build-time Supabase settings name production; the renderer's are compiled in. (`docs/PRODUCTION_RUNBOOK.md` (f); TPN-SDLC-008)
- **The web app** is the Vercel project whose production branch is `feat/multi-user-v1`, on staging; where 1.0.0's production web app lives is her decision. (`docs/WEB_DEPLOY.md`)
- **There is no migration path from 0.6.x data** other than the in-app tools: App settings → Storage holds the R.A.B.B.I.T., O.T.T.E.R. and deck-attachment migrations. Run them dry first; *Archive and clear local* is never automatic.

[1.0.0]: https://github.com/pretty-aud/wilson/releases/tag/v1.0.0
