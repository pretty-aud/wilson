# 85 — NIGHT 4

One file for the night (`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one section per session: **M2** (the desktop → cloud
migration, part 2), **P1** (previews for a workspace on its own storage), **D1** (the desktop keeps its stored state across a
relaunch) and **R2** (release readiness). Each section stands on its own; answer its questions by their numbers.

## R2 — Release readiness

Nothing in the app changed. R2 wrote three documents and one audit, read only the repository, and touched no environment.

1. **`docs/PRODUCTION_RUNBOOK.md`** (new) is the controller's procedure for putting 1.0.0 on production, in order, each step a
   command or a dashboard click with the proof that it worked: read production first; the 33 migrations from 0064 by the house
   method; all 22 functions; the secrets by name and digest (never a value); the two sign-in hooks; the builds; then release day,
   with your steps between the controller's, and what can and cannot be undone.
2. **`docs/RELEASE_TESTING.md`** is rewritten against the app as it is today. Every label in it was found in the code, the
   features it never covered are in (bins and the gateway, shot lists and edits, Legal, bid versions, custom views, D.O.G.'s
   references, the AI file store, subject shares, your own storage, reconnect and the offline launch), and its *Known not to work*
   list is rebuilt. About 630 lines; **about 7 hours**.
3. **`CHANGELOG.md`**'s 1.0.0 entry is rewritten from the session log, every line with its source, dated *Unreleased* (the
   controller dates it at the tag).
4. **The TPN re-audit** of the file gateway, bins, your own storage and the AI file store, report only: **0 Critical, 4 High
   open in those four areas** (`TPN_AUDIT/SUMMARY.md`, first section). The plan holds production until that reads 0, so Q1 is
   yours. The 2026-08-05 network-storage review is now merged in: eight of its findings are closed by what was built.

**What you do with `RELEASE_TESTING.md`, after night 5.** Once M3 has merged and the controller has written in the checks of
tonight's three sessions (its §S) and merged the beta, run it top to bottom, in one long day or two halves. Tick each
`[BLOCKING]` check or write why you waive it, note any failure by its section and bullet, and skip what its *Known not to work*
list names. It is condition 3 of the plan's §0.

### Questions

- **Q1. The four High in the re-audit.** The four:
  - **TPN-AUTH-012:** anyone who can edit shot lists can make the file gateway play any file on the company's share, past private
    projects and the share's own folder permissions.
  - **TPN-NET-016:** a company admin can point the bucket test at addresses inside Petal's own servers.
  - **TPN-CONT-018:** deleting a company leaves its clips' pictures behind, though the certificate says it was destroyed.
  - **TPN-ENC-013:** the gateway's office certificates name private addresses, which TPN lists as banned.

  (a) One session fixes all four before the release: about a day, each a single module, Phase 8 in `TPN_AUDIT/REMEDIATION_PLAN.md`
  (Recommended: the first two let a person reach what they should not). (b) Fix AUTH-012 and NET-016; accept CONT-018 and ENC-013
  for 1.0, with the reasons written into the findings. (c) Accept all four for 1.0 and fix them in 1.1.
- **Q2. What the gate counts.** The plan holds production until "the TPN re-audit reports nothing High". R2 counted the four areas'
  own findings. Older findings that cover the whole app (no central log, no watermark, no security scans in CI and others) also
  reach these areas; they keep the full audit's ratings, so across everything the pack reads 3 Critical and 47 High. (a) The four
  areas' own, as the plan words it; the rest stay the full audit's list for after 1.0 (Recommended). (b) Everything: 1.0 waits for
  every Critical and High.
- **Q3. Where 1.0.0's web app lives.** No document describes one on the production database. The one Vercel project builds the
  beta, on staging. (a) A second Vercel project on production at its own address, the beta staying on staging (Recommended: the
  beta stays your test bench, and production gets its own keys and sign-in links). (b) Point the existing project at production:
  the beta becomes production, and staging loses its web app. (c) No web app on production in 1.0, the desktop only.
- **Q4. The first operator on production.** If production holds no company you belong to, nothing written says how you get in.
  Two-factor is set up only inside a company, the operator tier needs it, and since S43 only an operator can create a company.
  The controller's first read (a6) says whether this matters. (a) If it does, the controller writes a one-time first company for
  you by SQL, rehearsed rolled back first, then you enrol two-factor and take the operator tier as usual (Recommended: no app
  change). (b) A small session lets the operator console enrol two-factor itself.
- **Q5. Migration number 0094.** It was reserved to tighten bins' share-address check (BC3's deferral) and never written.
  Written now, it would sort before 0095–0101, which are applied everywhere, the reason 0079 and 0080 were retired. (a) Retire it
  on paper like them; the check, if ever needed, takes the next free number (Recommended). (b) Keep it reserved.
