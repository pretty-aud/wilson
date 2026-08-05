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

> **STATE AFTER S30 (2026-08-05, `2d8b658` + `c3317d4`) — do not re-measure
> it:** migrations **0000–0045** on all three envs, next free **0046**. pgTAP
> **55 suites / 854 assertions**, next free suite **56**. Vitest **834 cases /
> 38 files**. All four CI jobs green on `c3317d4`, Playwright included. CLI
> linked to `wilson-dev`.

> Paste into a new Claude Code conversation. **Start from `WILSON/`.**
> **First tool calls**, in order and before any code:
> 1. `git status` on `feat/multi-user-v1`
> 2. read **`docs/OUTSTANDING.md`**
> 3. read `docs/sessions/MASTER_PLAN_S19_ONWARD.md`
> 4. `cat supabase/.temp/linked-project.json` — **read it, do not recall it.**

---

## 🚨 THREE THINGS S30 LEARNED THE HARD WAY THAT APPLY DIRECTLY HERE

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
  says so explicitly *so that you do not copy it*. The count is now: of 45
  policied tables, `auth_attempt_log` remains the only purely per-user one.
  `user_model_overrides` was trap one, `otter_progress` trap two, this is
  trap three.
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

✅ **But this is WIRING, not building — measured 2026-08-05, and it changes the
size of the job.** `App.jsx:373-381` already defines `window.wilsonSignOut`: it
calls `supabase.auth.signOut()`, clears the session, sets `authed` false and
re-shows the overlay. Its own comment at `:371-372` says *"Exposed on window
for the next-session Settings panel to wire up; doesn't affect the UI yet."*
So a previous session built the mechanism and deliberately left the control.

🚨 **That makes it the FOURTH instance of the built-with-no-caller shape** —
the folder tree (S27), task templates (S28) and O.T.T.E.R.'s quiz history
(S30) are the others. Check what exists before building; the answer here is
"a button".

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
- 🚨 **A FEATURE WITH NO CALLER HAS NO SYMPTOM — three instances so far**
  (folder tree S27, task templates S28, quiz history S30). The check is a
  census in the environment the user is in, plus watching it work. **This
  session is especially exposed to it**, because a settings store that nothing
  reads looks identical to one that works.
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
