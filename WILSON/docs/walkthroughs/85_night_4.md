# 85 — NIGHT 4

One file for the night (`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one section per session: **M2** (the desktop → cloud
migration, part 2), **P1** (previews for a workspace on its own storage), **D1** (the desktop keeps its stored state across a
relaunch) and **R2** (release readiness). Each section stands on its own; answer its questions by their numbers.

## R2 — Release readiness

Nothing in the app changed. R2 wrote three documents and one audit, read only the repository, and touched no environment.

1. **`docs/PRODUCTION_RUNBOOK.md`** (new) is the controller's procedure for putting 1.0.0 on production, in order, each step a
   command or a dashboard click with the proof that it worked. It reads production first, applies the 33 migrations from 0064 by
   the house method, deploys all 22 functions, and sets the secrets by name and digest (never a value). Then the two sign-in hooks
   and the builds, and release day with your steps between the controller's, ending in the merge and the tag, and what can and
   cannot be undone.
2. **`docs/RELEASE_TESTING.md`** is rewritten against the app as it is today, and every label in it was found in the code. It now
   covers the features it never did: bins and the gateway, shot lists and edits, Legal, bid versions, custom views, D.O.G.'s
   references, the AI file store, subject shares, your own storage, reconnect and the offline launch. Its *Known not to work* list
   is rebuilt. About 570 lines; **about 8 hours**, because its setup runs once on each database.
3. **`CHANGELOG.md`**'s 1.0.0 entry is rewritten from the session log, every line with its source, dated *Unreleased* (the
   controller dates it at the tag).
4. **The TPN re-audit** of the file gateway, bins, your own storage and the AI file store, report only: **0 Critical, 12 High open
   in those four areas** (`TPN_AUDIT/SUMMARY.md`, first section). The plan holds production until that reads 0 or you rule on each,
   so Q1 and Q2 are yours. The 2026-08-05 network-storage review is merged in, and seven of its findings are closed by what was
   built.

**What you do with `RELEASE_TESTING.md`, after night 5.** First M3 merges, the controller writes in the checks of tonight's three
sessions (its §S), and the beta is merged. Then run it top to bottom, in one full day or two halves, starting the two four-hour
clocks first. Tick each `[BLOCKING]` check or write why you waive it, note any failure by its section and bullet, and skip what its
*Known not to work* list names. It is condition 3 of the plan's §0.

### Questions

- **Q1. The re-audit's eight High of the four areas' own.** In plain words:
  - **TPN-AUTH-012:** anyone who can edit shot lists can make the gateway play any file on the company's share, past private projects
    and the share's own folder permissions, and can swap a clip under the people watching it.
  - **TPN-NET-016:** a company admin can point the bucket test at addresses inside Petal's servers, and a redirect carries it further.
  - **TPN-ENC-015:** the keys that lock companies' bucket secrets and AI keys are the same on dev, staging and production.
  - **TPN-ENC-014:** the gateway in a NAS container keeps its passwords and keys unencrypted.
  - **TPN-CONT-018:** deleting a company leaves its clips' pictures behind, with nothing left that knows they exist.
  - **TPN-ENC-013:** the office certificates name private addresses, which TPN lists as banned.
  - **TPN-DOC-004:** the gateway's hardening guide says Petal never holds a frame; Petal holds every clip's picture.
  - **TPN-AI-009:** old AI uploads on staging and production never expire. The release's own steps close it (a deploy and the
    sweep before 9 November), so it does not hold production up.

  (a) One session fixes the seven code and text ones before the release, about two days, Phase 8 in
  `TPN_AUDIT/REMEDIATION_PLAN.md` (Recommended: three of them let a person reach or keep what they should not, and the rest are
  small). ENC-015 is cheapest at release: production can take its own keys while it holds none. (b) Fix AUTH-012, NET-016 and ENC-015
  before 1.0; accept the others for 1.0, with the reasons written into the findings. (c) Accept all eight for 1.0 and fix them in
  1.1.
- **Q2. The four High that are older gaps showing up in this new code.** These are the gateway's admin calls and the outside switch
  without a two-factor step-up, the office door not writing down who watched, the desktop's clip streams without a no-cache header,
  and the gateway's release without its supply-chain checks. The same gaps are open elsewhere in the app, but here these areas did
  less than they do next door, so R2 counted them. (a) Count them in the gate and fix them with Q1's session; each is small
  (Recommended). (b) Let them follow their older findings to after 1.0, with that written into each.
- **Q3. Where 1.0.0's web app lives.** No document describes one on the production database, and production needs one for the
  operator console and for invite links as well as the app. The one Vercel project builds the beta, on staging. (a) A second Vercel
  project on production at its own address, the beta staying on staging (Recommended: the beta stays your test bench, and
  production gets its own keys and sign-in links). (b) Point the existing project at production: the beta becomes production, and
  staging loses its web app. (c) No web app on production in 1.0: then production has no operator console and no address for
  invite emails, so (a) or (b) is needed anyway.
- **Q4. The first operator on production.** On 2026-09-07 production held no company, no project and no user. Two-factor is set
  up only inside a company, the operator tier needs it, and since S43 only an operator can create a company, so nothing written
  says how you get in. (a) The controller writes a one-time first company for you by SQL, rehearsed rolled back first; then you
  enrol two-factor in the production app and take the operator tier as usual (Recommended: no app change). (b) A small session
  lets the operator console enrol two-factor itself.
- **Q5. Migration numbers 0094 and 0102.** 0094 was reserved to tighten bins' share-address check (BC3's deferral), and 0102 for
  the avatars policy; neither was written. Written later, each would sort before files already applied (0095–0101 now, and 0103
  once M2 lands), which is why 0079 and 0080 were retired. (a) Retire both on paper; either change, if ever needed, takes the next
  free number (Recommended). (b) Keep them reserved.
