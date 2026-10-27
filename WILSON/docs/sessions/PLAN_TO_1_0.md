# WILSON — the plan to 1.0 (2026-10-27)

Written by the controller after Audrey read `00_WHAT_IS_STILL_MISSING.md` and said: *"lets make a plan for kicking off 3-4 overnight sessions all in parallel. ask questions up front. I want you to think about the overall system and really think about what is needed and what youre doing. we dont want to make the app code bloated. see what has been done lately and what is missing and i want you to come up with a plan first. right now you are just doing session after session with no directed end."*

Her answers (2026-10-27, verbatim, two batches of four): the finish line **"Feature-complete first, then 1.0"**; the subtract session **"Hygiene only (Recommended)"**; Phase 5c **"Build it before 1.0"**; overnight **"3 sessions; you set the model and start them (Recommended)"**; the big items, all four: **"Reconnect after a hung sign-in (Recommended), Offline launch past the sign-in screen, Desktop to cloud migration carries everything, Browser previews for own-storage workspaces"**; tonight **"Yes: N1 Subtract, N2 shares design, N3 D.O.G. list (Recommended)"**; the defects gate **"Yes, the nine as listed (Recommended)"**; the TPN audit **"Yes, on the release night, report only (Recommended)"**.

---

## 0. The end, stated once

**v1.0.0 is tagged when all four hold:**

1. The feature list in §2 is built, merged and on the beta.
2. The closed defects list in §3 is fixed. Nothing is added to that list from now on.
3. Audrey's testing passes: the walkthroughs in §6 reported, `docs/RELEASE_TESTING.md` ticked.
4. The release steps in §6 are done: hers in the browser, then the controller's on production, after the TPN re-audit reports nothing High.

Nothing else goes in before the tag. Every review finding from here on is written in `docs/OUTSTANDING.md` and waits for 1.1 unless it is a security defect or it breaks one of the four above.

---

## 1. Where the system is (measured 2026-10-27)

| | Figure |
|---|---|
| Source (the app, no tests) | 170,374 lines in 442 files, plus 13,311 in Electron's main process |
| Tests | 132,051 lines in 384 files; 406 Vitest files, 9,981 tests passing |
| The five biggest files | R.A.B.B.I.T. provider 8,833; Timeline 8,084; O.T.T.E.R. 5,842; the Supabase adapter 5,758; D.O.G. 5,471 |
| Built web bundle | 4.8 MB main chunk |
| Since the overhaul merged (2026-09-30) | 501 commits; source +35,839 / −5,552 lines; tests +42,752; docs +38,493 across 1,025 files; scripts +8,863 |
| Repo weight that is not the app | 17 one-off screenshot scripts in `scripts/`; 33 per-session entries in the tracked `.claude/launch.json`; `OUTSTANDING.md` 3,512 lines (about 170 open entries); 126 hand-offs; 47 briefs; 81 walkthroughs |
| Database | 96 migration files through 0099; dev and staging at 0099; production at 0063; 0065 (subject shares) applied nowhere |
| Edge Functions | 22 on dev and staging; production lacks the ones since July |

What the last month built: the post-overhaul bundles (settings, O.T.T.E.R. functions lesson, files UI and explorer, the Legal gate, shot lists, edits, budget versions and weekends), footage bins on desktop and web, the file gateway (GW1 to GW5, with its release pipeline), custom table views (VW1 to VW1m), D.O.G.'s references and the AI file store, and fifteen fix bundles. Every one of those was a plan item or her ask. What had no end was the tail: FX13 → FX14 → FX15 → DG3, each fixing the last one's review findings.

**The diagnosis.** The product is feature-complete against its plan except Phase 5c and four reliability gaps she has now chosen. The code is not bloated by features; it is heavy in five files that predate this plan, and the repo is heavy with per-session scaffolding and documents. The sessions have been correct and careful, and undirected.

---

## 2. What 1.0 contains (her answers)

**Features:**
- Everything on the beta today.
- **Subject shares in O.T.T.E.R.** (Phase 5c): a live link to one subject, accepted first, each person's own progression. Migration 0065 holds the schema draft and her quotes of 2026-08-12. Design on night 1, then two build nights. **Added by her on morning 1 (2026-10-27):** a whole course to one person (a batch of subject shares behind one button; later subjects do not follow, a reminder asks) and the receiver passing a subject on (a chain that falls with its first link). Of the six things N2 had left out she kept out: seeing their progress, expiry or a cooldown, sharing outside the company, a share that copies. Written into the design by N2b, a Fable day session, before B1.
- **Reconnect after a hung sign-in.** One stuck session check pins every cloud call; a banner says so and nothing recovers. A design, then a build.
- **Offline launch past the sign-in screen** with a fresh saved sign-in; cloud calls then fail honestly. A policy decision then a small build; the fix shape is in `OUTSTANDING.md`.
- **The desktop → cloud migration carries everything**: shot lists, edits, folders, comments, milestones, budgets, expenses, levels, experiences; and a second run does not resurrect rows a teammate deleted. Two build nights.
- **Browser previews for a workspace on its own storage** (S3, a NAS). One build night.

**Small, in unless she says otherwise (no ruling needed):**
- Levels and Experiences get the write gate Scenes has (a seat that cannot write sees a live Delete and rename today; `ScenesView.jsx` reads the gate 148 times, `LevelsView.jsx` and `ExperiencesView.jsx` zero).
- A dependency rewire links before it deletes (today a failed link loses the dependency).
- A failed pet sync is retried without a relaunch.
- Avatars persist (a bucket and a policy, beside the 5c schema on night 2).

**Explicitly 1.1:** the pet syncing live between machines; professional codecs without ffmpeg (an accepted limit); the ~160 polish entries in `OUTSTANDING.md` (named, dated, waiting; the file is the record, not the backlog).

---

## 3. The closed defects list (the 1.0 gate; confirmed)

Nine entries, chosen because a person would meet them. Each has a measured cause already. **Closed on 2026-10-27**: nothing is added.

| # | Where | What | Night |
|---|---|---|---|
| DG2-02 | D.O.G. | Typing in the deck context box, then clicking **Generate full deck outline**, does nothing: the box shrinks under the press | 1 |
| DG2-01 | D.O.G. | **Choose file** cannot be reached with Tab | 1 |
| DG3-01 | D.O.G. | Card 1's field label reads **Choose a project** (her words) | 1 |
| DG3-02 | shell | R.A.B.B.I.T. shows the main area's focus ring like every other page (her "Keep it everywhere") | 1 |
| S5-02 | R.A.B.B.I.T. | A new bid version is not broadcast to teammates until they reload | 2 |
| DG1-01 | cloud | D.O.G.'s project lists stop at the cloud's first 1,000 files | 2 |
| P1-29 / P1-30 | R.A.B.B.I.T. | Team members and Rate card are wider than a 1280 window | 2 |
| (Broken features) | sign-in | The two-factor enrolment screen overflows the sign-in shell at laptop heights | 2 |
| (Broken features) | R.A.B.B.I.T. | The Dashboard shows a task's assets as of its last load; the Tasks CSV export leaves out the asset and the bid | 2 |

Not on the list, deliberately: every screen-reader name, Tab-stop and landmark entry (FX15-02, -05, -06, -07, -08), the 13 test files that could fail on a slow runner (FX15-04: the subtract session folds their scaffolding into one helper, which closes the class), dates in six forms (a design decision), the pet over page content (hers to rule on).

---

## 4. The nights

Three sessions a night, on disjoint files, needing nothing from Audrey until morning. Each session has a brief with a closed list, two adversarial review rounds whose findings are written and not fixed, a hand-off, a merge, CI green. The controller merges the integration branch to the beta each morning on her go and writes one morning note.

### Night 1 (tonight, 2026-10-27)

| Session | Model | Scope (closed) | Done when |
|---|---|---|---|
| **N1 Subtract** | Opus | The 17 one-off scripts out of `scripts/` (two general tools stay); the 33 session launch entries replaced by three fixed ones (`session-a/b/c`, ports 5301 to 5303); exports nothing calls, removed with their tests; the R.A.B.B.I.T. test mounts into one shared gap-safe helper (FX15-04's 13 files, FX15's four, FX14's one); `OUTSTANDING.md`'s struck-through and closed sections moved to `docs/archive/`; nothing else | The built bundle's chunk names identical before and after, or smaller with every change named; every removal lists the grep that found no caller; tests green; the counts in the hand-off |
| **N2 Subject shares, the design** | Fable | Reads 0065, her quotes, the O.T.T.E.R. code and the share/submit flows already built (Phases 5 and 6); writes `docs/design/OTTER_SUBJECT_SHARES_DESIGN.md`: the schema as 0100 (0065 retired), the RLS and the consent helper, the client model (`link:<subject_id>` keys in progress), the screens, the pet's reading of a linked subject, the pgTAP suite plan, and **her questions as multiple choice** for the morning; no app code, no migration file | The design, a two-night build plan with file lists, and a questions block she can answer in ten minutes |
| **N3 (DG3) D.O.G.'s closed list** | Opus | DG2-02, DG2-01, DG3-01, DG3-02; nothing else in D.O.G. | Each measured before and after in Chromium at 1280 and 1440; the harness pins each; walkthrough 81 (the night's one file) |

Files: N1 touches `scripts/`, `.claude/launch.json`, `docs/OUTSTANDING.md`, `docs/archive/`, dead exports and the named R.A.B.B.I.T. test files. N2 touches `docs/design/` only. N3 touches D.O.G.'s component, `dog.css`, `ReferencesCard.jsx`, the kit's focus-ring rule and `PageSurface`, their tests, walkthrough 81. No overlap except `OUTSTANDING.md` (N1 archives closed sections; N3 deletes four open entries: N3 merges the integration branch before pushing).

### Morning 1
Audrey answers N2's questions (multiple choice). The controller merges to the beta. Walkthrough 81 is hers when she has time; it does not block night 2. **B1 cannot start until N2's questions are answered.**

### Day 1 (2026-10-27, between the nights)
| Session | Model | Scope |
|---|---|---|
| **N2b Whole-course and onward shares, the design** | Fable | Her ruling of the morning written into `OTTER_SUBJECT_SHARES_DESIGN.md` and its Appendix A in place: the batch (`batch_id`, `otter_subject_share_course`), the chain (`via_share_id`, `subject_owner_id`, the helper's walk, the cascading revoke), suite 103 extended, B1's and B2's lists updated; two review rounds; brief `po-n2b-course-and-onward-shares.md`. B1's brief follows its merge. |

Also that day: the ninth beta merge (`69546e1d`); the RLS workflow pinned to `ubuntu-24.04` (`2f6a9f61`) after GitHub's move of `ubuntu-latest` to Ubuntu 26.04 broke Playwright 1.59's Chromium install; the R1 and S1 briefs; DG3-04 accepted as built.

### Night 2
| Session | Scope |
|---|---|
| **B1 Subject shares, the server** | Migration 0100 (the schema from the design with the batch and the chain N2b added; 0065 removed), RLS, the consent RPC, pgTAP suite 103, the adapter calls, avatars' bucket and policy beside it; applied to dev by the session, to staging by the controller |
| **R1 R.A.B.B.I.T. robustness** | The Levels/Experiences write gate; the dependency rewire; S5-02; DG1-01; the Dashboard's stale assets and the CSV export; P1-29/30 |
| **S1 Reconnect** | The design of reconnecting after a hung sign-in (the auth library's per-key lock, the abandoned session check, what a fresh client costs) in the first half; the build in the second, or design only with her questions if the reviewers say the build needs a ruling; the 2FA overflow beside it |

### Night 3
| Session | Scope |
|---|---|
| **B2 Subject shares, the client** | The share, accept and revoke screens; a linked subject read live inside the receiver's course; per-user progress; the pet reads it; the batch card in Requests, *Share this course with…*, *Pass on…*, the reminder when a subject is added to a course shared whole; the night's walkthrough |
| **M1 Migration, part 1** | An inventory of what the desktop holds against what the migration carries, then shot lists, edits, folders, comments and milestones carried, pinned by a round trip on the fixtures |
| **S2 Offline launch** | The policy (a saved, unexpired sign-in opens the shell offline; which cards say what), the build, the pet retry beside it |

### Night 4
| Session | Scope |
|---|---|
| **M2 Migration, part 2** | Budgets, expenses, levels, experiences carried; a second run idempotent (no resurrection of rows a teammate deleted) |
| **P1 Own-storage previews** | Thumbnails shown in the browser for S3 and NAS workspaces, within the rule that money-gated files never leave Supabase |
| **R2 Release readiness** | `RELEASE_TESTING.md` rewritten against the app as it is now; the 1.0.0 changelog from the session log; the production runbook for the controller (functions to deploy, migrations by file in order, the Auth hooks, the secret digests); the read-only TPN re-audit of the gateway, bins, own storage and the AI file store, findings with file and line, nothing changed |

### After night 4
Her testing (walkthroughs and `RELEASE_TESTING.md`), her browser steps, the controller's production steps, the tag. If a night's session stalls (the usage limit, a CI outage), its brief carries to the next night; nothing new is added in its place. Four nights is the estimate, not a promise: a design that needs her ruling waits a morning.

---

## 5. Rules for every session from tonight (the anti-bloat set)

1. **The brief's list is the scope.** A finding outside it is written in `OUTSTANDING.md` with its measurement and left. The reviewers write; they do not widen.
2. **Subtract before add.** A new file needs a sentence in the hand-off saying why no existing file could hold it. No new script under `scripts/` (the two general tools are enough; measure with them). No new launch entry (three fixed ones). No new screenshot script per session.
3. **One walkthrough per night**, sections per session, not one file per session.
4. **Tests pin behaviour; they do not duplicate scaffolding.** New R.A.B.B.I.T. mounts use the shared helper N1 leaves.
5. **The bundle is a number.** Every hand-off states the built bundle's size before and after and accounts for a growth over 20 KB.
6. **Hand-offs in protocol order, at most 200 lines.** History lives in git.
7. **Two review rounds stay.** They have caught a privilege escalation, an inert guard and a focus loss that turned Enter into "make a deck". Their findings are recorded, not fixed, unless they are security or break the four conditions in §0.
8. **Nothing the controller does not name becomes a session.** No "leftovers" sessions.

---

## 6. What stays hers

- The walkthroughs 48 to 55 and 72 to 81 (one report each, "fine" counts).
- The answer blocks: Bins on the cloud (13), custom views (batch 18), the DG1b design's §9, and each morning's block (the 5c design first).
- The release steps in the browser: rotate `smoke_admin`; roll staging's legacy `service_role` key; the two Auth hooks on staging; PR #4's title and body; the gateway's GitHub setup and the Windows installer rehearsal; `RELEASE_TESTING.md`.
- The operator console's AI-files sweep on the beta before 2026-11-09 (walkthrough 76 part C).

## 7. The overnight routine

1. She clicks three chips. Each session comes up on Fable 5.1 and stops on its brief's first line if the brief wants Opus; the controller switches it and sends "go". She can walk away.
2. Each session works to its brief, merges with `--no-ff`, pushes, reads CI, writes its hand-off, detaches.
3. The controller reads the hand-offs, merges the integration branch to the beta on her "go", and writes **one morning note**: what landed, what to test, the questions to answer (multiple choice), what stalled.
4. A stalled session gets "continue" in the morning, not a new session.
