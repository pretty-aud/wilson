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
   is rebuilt. About 590 lines; **about 8 hours**, because its setup runs once on each database.
3. **`CHANGELOG.md`**'s 1.0.0 entry is rewritten from the session log, every line with its source, dated *Unreleased*: the
   controller dates it on release day, before the deploys (the runbook's (g) 8).
4. **The TPN re-audit** of the file gateway, bins, your own storage and the AI file store, report only: **0 Critical, 11 High open
   in those four areas** (`TPN_AUDIT/SUMMARY.md`, first section). The plan's words are "after the TPN re-audit reports nothing
   High"; R2 proposes that your ruling on each of the eleven (fixed before 1.0, or accepted for 1.0 with the reason written into
   it) count as that, so Q1 and Q2 are yours. Two of your rulings are filed as yours, not counted: G6 (office viewing is not
   written down) and D14 (the gateway's installer ships unsigned). The 2026-08-05 network-storage review is merged in, and seven of
   its findings are closed by what was built.

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
  - **TPN-ENC-014:** in a NAS container the gateway keeps its keys and its WILSON sign-in unencrypted; on Windows, after one
    encryption failure, the share's password too.
  - **TPN-CONT-018:** deleting a company leaves its clips' pictures behind, with nothing left that knows they exist.
  - **TPN-ENC-013:** the office certificates name private addresses, which TPN lists as banned.
  - **TPN-ENC-016:** the gateway's own certificate authority lasts ten years where TPN asks for one to three, and the key that signs
    its updates has no replacement ready.
  - **TPN-AI-009:** old AI uploads on staging and production never expire. Only the release's own steps close it: the deploy and
    the sweep before 9 November.

  (a) One session fixes the other seven before the release, about three days, Phase 8 in `TPN_AUDIT/REMEDIATION_PLAN.md`, and you
  accept TPN-AI-009 for the start of the production steps, since it closes at the runbook's (c) and (g) 17 before 9 November
  (Recommended: three of them let a person reach or keep what they should not, and none needs more than a day). ENC-015 is cheapest at
  release: production can take its own keys while it holds none. (b) Fix AUTH-012, NET-016 and ENC-015 before 1.0; accept the
  others for 1.0, with the reasons written into the findings. (c) Accept all eight for 1.0 and fix them in 1.1.
- **Q2. The three High that are older gaps showing up in this new code.** Someone with an admin's password but not their
  authenticator code can turn on the outside switch, use the gateway's admin calls, or point the company's bucket at their own
  server so that the next uploads go there: the bucket's secret already asks for the code, its settings do not. The desktop's clip
  streams go without the no-cache header the gateway sends. And the AI file store quietly uses Petal's own AI key when a company's
  own key fails, where your own storage refuses instead. The same gaps are open elsewhere in the app, but here these areas did less
  than they do next door, so R2 counted them. (a) Count them in the gate and fix them with Q1's session; each is small
  (Recommended). (b) Let them follow their older findings to after 1.0, with that written into each.

  R2 did not count two near cases; say if you want either counted: the own-storage signer keeps no record of the downloads it signs
  (the app's own download record stands in, as wherever a provider serves the file itself); and the desktop's bin streams record no
  viewing where its file streams do, which is close to your G6.
- **Q3. Where 1.0.0's web app lives.** No document describes one on the production database, and production needs one for the
  operator console and for invite links as well as the app. The one Vercel project builds the beta, on staging. (a) A second Vercel
  project on production at its own address, the beta staying on staging (Recommended: the beta stays your test bench, and
  production gets its own keys and sign-in links). (b) Point the existing project at production: the beta becomes production, and
  staging loses its web app. (c) No web app on production in 1.0: then production has no operator console and no address for
  invite emails, so (a) or (b) is needed anyway.
- **Q4. The first operator on production.** On 2026-09-07 production held no company, no project and no user. Two-factor is set
  up only inside a company, the operator tier needs it, and since S43 only an operator can create a company, so nothing written
  says how you get in. (a) The controller writes a one-time first company for you by SQL, through the same function the console's
  **New company** uses, rehearsed rolled back first (the runbook's (g) 13 has the five steps); then you enrol two-factor in the
  production app and take the operator tier as usual (Recommended: no app change). (b) A small session lets the operator console
  enrol two-factor itself.
- **Q5. Migration numbers 0094 and 0102.** 0094 was reserved to tighten bins' share-address check (BC3's deferral), and 0102 for
  the avatars policy; neither was written. Written later, each would sort before files already applied (0094 before 0095–0101,
  applied on dev and staging; 0102 before 0103 once M2 lands), which is why 0079 and 0080 were retired. (a) Retire both on paper;
  either change, if ever needed, takes the next free number (Recommended). (b) Keep them reserved.
