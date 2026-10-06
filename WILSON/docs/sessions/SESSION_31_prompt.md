# SESSION 31 launch prompt — YOUR ACCOUNT FOLLOWS YOU BETWEEN COMPUTERS

> **Scheduled by Audrey on 2026-08-04**, from a real observation: she signed
> into the **same account** (`audrey`, admin) on a second computer and was
> asked to **create a new pet**. The name, state, hunger and content levels did
> not travel.
>
> Her requirement, verbatim in substance: *"each user should have their
> personal settings saved along with the pet details and status. if i log on
> one computer and i see a pet that is hungry on another computer i should see
> the same pet at the same state and hunger and content levels."*
>
> ✅ **SCOPE ALREADY SETTLED (Audrey, 2026-08-04): ONE pet and ONE set of
> settings PER PERSON, everywhere — not per workspace.** She chose this over a
> per-workspace pet and over a split model. **Do not re-open it.**

> **STATE AFTER S30 — and this block has now been corrected TWICE, which is
> itself the lesson: a brief is a claim about the code and it decays while you
> are writing it.** Migrations **0000–0045** on all three envs, next free
> **0046**. pgTAP **55 suites / 854 assertions**, next free suite **56**.
> Vitest **864 cases / 41 files** (this block first said 834 / 38, then
> 855 / 40). HEAD is **`73828c7`**, the pet-save fix, all four CI jobs green.
> CLI linked to `wilson-dev`. **Re-measure anyway.**
>
> ⚠️ **S30 ran long past its own close-out** because Audrey tested the beta and
> found three defects in a row. Its outcome section in
> `MASTER_PLAN_S19_ONWARD.md` has **three postscripts**; read them, they are
> where the session's real findings are.

> Paste into a new Claude Code conversation. **Start from `WILSON/`.**
> **First tool calls**, in order and before any code:
> 1. `git status` on `feat/multi-user-v1`
> 2. read **`docs/OUTSTANDING.md`**
> 3. read `docs/sessions/MASTER_PLAN_S19_ONWARD.md`
> 4. `cat supabase/.temp/linked-project.json` — **read it, do not recall it.**

---

## 🚨 SIX THINGS S30 LEARNED THE HARD WAY THAT APPLY DIRECTLY HERE

> Items 4–6 were added after this brief was first written, because S30 did not
> stop at its close-out — Audrey tested the beta and found three more defects.

**1. A retention window inside a SELECT policy makes the rows undeletable.**
0045 put `taken_at >= now() - INTERVAL '30 days'` in the SELECT policy so the
promise was a database guarantee. Its pgTAP suite failed on the first run:
**PostgreSQL applies SELECT policies to an UPDATE or DELETE whenever the
statement reads rows for its WHERE clause**, so the window hid the expired
rows from the statement meant to prune them. If the pet or settings ever grow
a retention or archive rule, that is the trap, and the answer was a tiny
`SECURITY DEFINER` function taking no arguments.

**2. Measure whether the feature has ever run, not whether it is built.**
Quiz history had a column, two adapter ops, a route mapping and a **passing
unit test** for twenty sessions, and nothing ever called the writer. That is
the fourth such feature in four sessions. **The pet is the opposite case — it
has a real writer and real data on Audrey's machine — so the risk here is the
mirror image: a migration that adopts a blank instead of her existing pet.**

**3. Check `res.ok`.** `otterFetch` and `fetch` resolve for every status.
`applyFix` did not check, so an HTTP 404 rendered as a green "Fix applied".
Any new save path for the pet or settings must check, and must show the user
when it fails.

**4. 🚨 THE SCREEN MUST SAY *WHY*, AND THIS IS THE ONE THAT KEPT RECURRING.**
Three separate instances in `Validator.jsx` alone: a green tick over a save
that never happened; a silent `return` when the text had already changed; and a
red dot in the audit queue whose reason went only to `console.error`. Each time
the UI showed a STATE and withheld the thing that explained it. **A pet that
fails to sync is invisible in exactly this way** — the old one is still on
screen and looks right. Every failure path needs a sentence the user can read.

**5. 🚨 DATABASE-PROVEN IS NOT APP-PROVEN.** S30 closed with 55 pgTAP suites,
834 unit tests, a 9-step end-to-end database probe and four green CI jobs — and
O.T.T.E.R. could not generate a single course. **All three defects were found
by Audrey using it; none by anything in the repo.** Nothing here mounts React
and nothing here runs the app. Plan for her to test, and give her the numbered
checklist **in the first message**, not at close-out.

**6. Check the ones that WRITE; accept her word on the ones that only READ.**
She reported "all three work"; querying staging gave two confirmed and one that
had never happened. A dropdown populating leaves no trace and never can — her
eyes are the only instrument, and per S23 a user action that requires a
precondition outranks any reasoning about it. A saved pet, by contrast, is a
row you can go and look at. **Do both, and know which is which.**

---

## 🚨 THERE IS NOTHING TO SYNC — THAT IS THE POINT

This is not a sync bug. MEASURED 2026-08-04: `src/lib/localData.js` is
**per-device by construction**, and it says so in its own header:

```
pet.json            → /api/pet*            → localStorage 'wilson.pet'
otter-settings.json → /api/otter-settings  → localStorage 'wilson.otter-settings'
agent-skills.json   → /api/agent-skills    → localStorage 'wilson.agent-skills'
```

Express-backed storage inside Electron, `localStorage` on the web. Line 13
states the design decision outright — *"Per-browser localStorage is the right
web home for all three"* — and **that is the assumption Audrey's requirement
overturns.** A second machine has no pet to find, so it correctly offers to
create one. Nothing is malfunctioning; the store is in the wrong place.

Readers to check before designing (grep, do not trust these):
`PetCompanion.jsx`, `SettingsPage.jsx`, `App.jsx`.

---

## What this needs

A **per-user** store in the database, and it is a real feature, not a patch:

- A table keyed by user, with RLS that lets a person read and write **only
  their own row** — no workspace scoping, per Audrey's decision.

  🚨 **THE SCHEMA WILL FIGHT YOU ON THIS, AND AN EARLIER DRAFT OF THIS BRIEF
  GOT IT WRONG.** That draft named `user_model_overrides` (0031) as "the
  nearest shape". **It is not** — MEASURED 2026-08-04, all four of its policies
  are `user_id = auth.uid() AND workspace_id = public.current_workspace_id()
  AND has_active_membership(workspace_id)`. Copying it builds precisely the
  per-workspace pet Audrey rejected.

  A census of wilson-dev, same day: **44 tables carry policies, 39 of them
  scope by `current_workspace_id()`, and exactly ONE is purely per-user —
  `auth_attempt_log`.** So this table would be the **second**, in a schema
  where every instinct, every copy-paste and every reviewer will push toward
  adding workspace scoping. **Write down in the migration header WHY it is
  absent**, or a later session will "fix" it.
- Its own pgTAP suite — **next free is `56_`, and the next free migration is
  `0046`** (S30 took `0045` and `55_otter_quiz_attempts`; verified 2026-08-05,
  and re-check anyway). Plus `.github/workflows/rls.yml` in **two** places:
  `RLS_TABLES` (fails loudly) and the failure-replay list (fails **silently**
  — S30 had to add suite 55 to it by hand).

  🚨 **S30 CREATED A TABLE THAT LOOKS LIKE YOUR PRECEDENT AND IS NOT — the
  third one.** `otter_quiz_attempts` (0045) is keyed `user_id = auth.uid()`
  with no admin bypass, which is exactly the shape you want — **and it is
  ALSO `workspace_id = current_workspace_id()`**, deliberately, because a quiz
  attempt is about courses and courses are workspace-scoped. 0045's header
  says so explicitly *so that you do not copy it*. `user_model_overrides` was
  trap one, `otter_progress` trap two, this is trap three.

  ✅ **AND THE CENSUS THIS BRIEF USED TO QUOTE WAS WRONG — re-measured
  2026-08-05 against wilson-dev.** It said "44 policied tables, 39 workspace-
  scoped, exactly one (`auth_attempt_log`) purely per-user". The real numbers
  are **45 policied, 40 workspace-scoped, and TWO purely per-user:
  `auth_attempt_log` and `platform_operators`.** Three more
  (`platform_approved_models`, `platform_audit`, `platform_model_defaults`)
  scope by neither. So a per-user precedent does exist — `platform_operators`
  — and it is worth reading before you invent one. **Re-run the census; do not
  trust this paragraph either.**
- Adapter methods, and a `COLUMN_ALLOWLIST` entry if it is written through
  R.A.B.B.I.T.'s adapter.
- A decision on what "settings" covers. `localData.js` names three stores; the
  pet is one of them. **Ask which of the other two travel with the person** —
  agent skills probably do, O.T.T.E.R. settings may not.

### 🚨 THE PET AUTO-SAVES EVERY 30 SECONDS, AND WRITES ARE LAST-WRITER-WINS

**Found on the review pass, 2026-08-04, and it changes the design.**
`localData.js:20-25` carries a KNOWN GAP note that was written for the
single-device world and becomes the central problem in a synced one:

> *"these are full-object last-writer-wins overwrites with no cross-tab sync.
> Two web tabs both running the pet's 30s decay/auto-save timers will clobber
> each other's writes — same class as the pre-existing Electron two-window
> case. **The app is a one-window product**; a 'storage'-event merge is
> deliberate future work, not an oversight."*

That assumption is exactly what Audrey's request retires. Consequences to
design for **before** writing the table:

- **A decay timer on every open client means a write every 30 seconds, per
  device, forever.** Two computers signed in at once will each overwrite the
  other's whole pet object continuously, and the loser is whoever wrote second.
  Hunger would visibly jitter between two values — the exact symptom she asked
  to eliminate.
- **A whole-object overwrite is the wrong write for a value that DECAYS.**
  Hunger is a function of elapsed time, so it may be better stored as
  `last_fed_at` and computed on read, rather than written repeatedly as a
  number. That removes most of the conflict instead of resolving it.
- **Decide what the timer does when the tab is in the background**, and whether
  a device that has been closed for a week should push its stale numbers up on
  reconnect. It must not.

→ **Settle this before the migration.** A synced pet built on a 30-second
whole-object overwrite would be worse than the per-device one it replaces.

### ✅ READ THE PET CODE BEFORE DESIGNING FOR IT — three of the above already exist

**MEASURED 2026-08-05, and this is the S24 lesson in advance: the budget UI
turned out to be complete and the session was scoped as if it needed building.
Same risk here.** All of this is in `App.jsx`:

| the brief proposes | what the code already does |
|---|---|
| "prefer the one with the later timestamp" | **`lastUpdatedAt` is written on EVERY save** (`:472`) — the field exists |
| "store `last_fed_at` and compute on read" | **offline decay is already computed from elapsed time on mount** (`:486-499`): hunger and happiness are recalculated from `lastUpdatedAt`, and the pet becomes a ghost if hunger hit 0 while away |
| "a whole-object 30s auto-save" | confirmed — a decay tick at `:515-583` and a **separate save timer at `:591-593`**, both `30000`ms, the second writing the whole object |

**So the pattern is not missing; the AUTHORITY is.** The read path is already
elapsed-time based, which is most of the hard part.

🚨 **TWO THINGS THE CODE DOES THAT WILL BREAK A NAIVE SYNC, neither previously
written down:**

1. **The mount effect SAVES immediately** — `savePet(pet)` at **`:506`**, right
   after computing offline decay. So opening the app on the second computer
   would push that computer's decayed state upward before the user touches
   anything. The brief says a week-old device "must not push its stale numbers
   up on reconnect"; **as written, it does exactly that, unconditionally.**
2. ✅ **`savePet` used to swallow every failure — FIXED before this session
   starts (`73828c7`), because Audrey asked for it directly once the brief
   surfaced it.** Recorded rather than deleted, because the SHAPE is the thing
   S31 must not reintroduce, and because the obvious fix was the wrong one:
   - `App.jsx` had `catch { /* silent */ }` **on top of two functions that
     could not throw** — `savePetData` never checked `res.ok` on its Express
     POST, and `writeLocal` swallowed every localStorage exception (quota
     exhausted, Safari private mode, enterprise policy). Fixing only the
     visible catch would have changed nothing at all.
   - `savePet` also **dropped** an update whenever a save was in flight, so a
     30-second decay tick colliding with a slow write was discarded and the pet
     aged backwards on the next load. It now queues the newest state.
   - `petSaving` moved from state to a ref: it sat in `savePet`'s dependency
     list, so `savePet`'s identity changed on every save and rebuilt the
     30-second interval each time. **Check that when you add a cloud write.**
   - `PetCompanion` takes a `petSaveError` prop and shows *"<name> isn't being
     saved"* with the reason.

   🚨 **THE PART THAT MATTERS FOR S31:** `saveOtterSettings` and
   `saveAgentSkills` now **reject** where they always resolved before, so every
   caller was audited. `Otter.jsx`'s `saveSettings` had no catch and two of its
   call sites are `onChange`/`onClick` handlers that drop the promise — a
   refused write would have become an unhandled rejection. **A cloud pet adds
   more callers to exactly this surface. Audit them the same way.**
   `localData.test.js` covers the behaviour (quota, blocked storage, 404, a
   server message, a non-JSON body, and the control that reads still degrade).

### 🚨 THE MIGRATION IS THE DANGEROUS PART

Audrey **already has a pet on this machine**, with a name and a state she
cares about. A naive "read from cloud on load" wipes it the first time the app
starts, because the cloud row does not exist yet and the blank default wins.

The first cloud save must **adopt the existing local pet**, not overwrite it —
and the direction has to be decided explicitly and written down:

- local exists, cloud empty → **upload the local one** (this is Audrey's case)
- cloud exists, local empty → download
- **both exist and differ** → this is the one that needs a rule. Last-writer-
  wins silently discards a pet. Prefer the one with the later timestamp and
  say so in the code, or ask.

⚠️ **Prove the adoption path by running it, not by reading it.** The failure
mode is silent and it destroys something she likes.

---

## Also in this session — small, and **this session definitively owns it**

> ⚠️ **RESOLVED 2026-08-05. This used to say "check S30 did not take it", and
> the S30 brief said the mirror image — each deferred to the other, which is
> how a thing gets built twice or never.** The logout is **S31's**, because
> this is the settings session and Audrey's own name for it is "per-user
> settings + pet + logout". It has been removed from `SESSION_30_prompt.md`.

**There is no way to log out.** MEASURED 2026-08-04, re-verified 2026-08-05:
`SettingsPage.jsx` has **zero** occurrences of `signOut`, `logout` or
`log out`.

✅ **But this is WIRING, not building — and the size of the job is "a button".**
`App.jsx:375-381` defines `window.wilsonSignOut`: it calls
`supabase.auth.signOut()`, clears the session, sets `authed` false and re-shows
the overlay. Its comment just above says *"Exposed on window for the
next-session Settings panel to wire up; doesn't affect the UI yet."*

> 🚨 **THIS BRIEF SAID `App.jsx:373-381` AND THAT IT HAD NO CALLER. BOTH WERE
> WRONG — corrected 2026-08-05 by grepping instead of re-reading.**
>
> - The line is **`:375`**, not `:373`. It moved when S30 added an import to
>   `App.jsx`. A line number in a brief decays the moment anyone edits above it.
> - **`window.wilsonSignOut` HAS a caller: `MfaSection.jsx:281`**, a sign-out
>   button on the MFA enrolment gate — the escape hatch for someone who will
>   not set up two-factor. So this is **NOT** a fourth instance of the
>   built-with-no-caller shape, and calling it one would have had S31 hunting a
>   dead path that is alive.
>
> **The accurate statement:** the mechanism exists and is reachable from
> exactly one screen, the MFA gate. What is missing is a control in
> `SettingsPage.jsx` — which genuinely has **zero** occurrences of `signOut`,
> `logout` or `log out` (re-verified 2026-08-05).
>
> This is the same correction the S30 brief needed about `quiz.get` — "zero
> callers" was wrong there too; it had exactly one, and the one mattered.
> **Before writing "nothing calls this", grep for it.**

⚠️ `supabaseClient.js:44` uses **different session storage keys per surface**
(`sb-wilson-operator` vs `sb-wilson-app`), so a sign-out control must be
explicit about which session it ends — signing out of the product app must not
silently take the operator console with it, or the reverse.

---

## Standing traps

- 🚨 **NEVER run `supabase config push`**, and never build a shell command by
  interpolating content into it.
- 🚨 **NEVER pipe a file through PowerShell to rewrite it** — PS 5.1 reads
  BOM-less UTF-8 as ANSI and silently double-encodes. Use the Write tool.
- **`git add -A` sweeps untracked files into a PUBLIC commit.** Stage explicit
  paths; `docs/messed up handbook.pdf` stays untracked.
- **A migration's text does not tell you the database's state.** Query it.
- **Check the GRANTEE, not just the grant** — an object can carry a bare
  `=X/postgres` aclitem, so revoking from `anon` alone can be a silent no-op.
- **Permissive RLS policies OR together** — DROP + CREATE, never add a narrow
  policy beside a broad one. On UPDATE, a `WITH CHECK` **weaker** than its
  `USING` is the hole; omitting `WITH CHECK` entirely is safe (Postgres reuses
  `USING`).
- **`supabase db query --file` returns only the LAST result set.**
- ⚠️ **`supabase db query -o json` does NOT return `RAISE NOTICE`.**
- 💡 **To READ another environment without re-linking**, use a throwaway
  `--workdir` with a minimal `config.toml` (`project_id` only).
- **`node scripts/tap-all.mjs` runs the WHOLE pgTAP set.** `collected` MUST
  equal `planned`.
- 🚨 **Prove a new suite by BREAKING it**, including breakers you expect to
  pass.
- 🚨 **A FEATURE WITH NO CALLER HAS NO SYMPTOM — FOUR instances** (folder tree
  S27, task templates S28, quiz history S30, and O.T.T.E.R.'s
  `setOtterAdapterMode`, which is STILL dead: zero callers anywhere in the
  repo, while two separate comments describe it as "the Settings override").
  This list previously said three in one place and four in another; the logout
  is **not** one of them (see above). The check is a census in the environment
  the user is in, plus watching it work. **This session is especially exposed**,
  because a settings store that nothing reads looks identical to one that works.
  ⚠️ **`setOtterAdapterMode` is arguably S31's to fix** — it is the missing
  Settings control for which backend O.T.T.E.R. uses, and this is the settings
  session. Audrey has de-prioritised the content it affects, not the silence.
- 🚨 **QUIZ HISTORY IS WIRED AND HAS STILL NEVER RECORDED A ROW** — 0 on dev,
  staging and the local disk, confirmed 2026-08-05. Audrey confirmed she has
  not finished a quiz, so this is *unexercised*, not broken. Do not read a zero
  there as a defect, and do not read it as proof either.
- 🚨 **Playwright is the only CI job that proves the app RENDERS.** Nothing in
  vitest mounts React.
- **`docs/SYSTEMS_HANDBOOK.md` is a gate, not an oracle.**

---

## Close-out ritual

1. Apply migrations to **dev**, verify **by query**, run `tap-all`.
2. Feature commit(s).
3. Apply to **staging**, then **prod** — dry-run and verify each **by query**.
   ⚠️ **Staging BEFORE the push.**
4. Push → **CI green on all four jobs.**
5. Re-link the CLI to `wilson-dev`.
6. Write `SESSION_32_prompt.md`'s revisions if needed (the design-pass brief
   already exists) → update the plan documents → the handbook → **
   `docs/OUTSTANDING.md`** → the Claude auto-memory → docs commit + push.

> **THEN, FINALLY, IN THE CHAT:** the remaining-session list, and a layman's
> breakdown in plain English — no jargon, no table names, no migration numbers,
> no file paths. What CHANGED FOR AUDREY, and what she still has to do herself.
