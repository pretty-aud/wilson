# SESSION 41 launch prompt — PETAL CLOUD AS A PAID, OPERATOR-MANAGED PRODUCT

> **§4a3 of `docs/NETWORK_STORAGE_DESIGN.md`** — read it first; it carries
> Audrey's requirement verbatim and the three decisions this brief builds on.
> Created 2026-08-07, immediately after S34 shipped the storage-mode selector
> (Audrey: *"lets make session 39 for making the operator terminal
> solution"*). ⚠️ **This brief has been renumbered twice** — the master
> plan's renumbering ledger is the record; its sequence table is the
> authority.

> 🚨 **THIS SESSION BLOCKS S42.** S42 raises the 50 MB bucket cap and adds
> resumable multi-GB uploads. Doing that before this session exists would
> turn an unmetered free tier into an unmetered *multi-gigabyte* free tier —
> quota plane first, floodgates second. S42's brief carries the matching
> warning. **The sequence table's order and the session numbers agree** — but
> the blocked-by column is the authority if they ever drift again.

> **STATE — re-measure, do not trust this block.** After **S40**
> (2026-08-09): migrations **0000–0054** on all three envs, next free
> **0055**. pgTAP **64 suites**, next free suite **65**. Vitest **1347 / 55
> files**. 🚨 **Read the working tree, never memory or a doc — a design written
> mid-S31 cited "0046, next free" and was wrong within the hour, and this very
> block was stale by six vitest assertions when S40 measured it.**
>
> **S40 added NO migration and NO pgTAP suite** — it was all application code —
> so the SQL numbers are unchanged since S44. The vitest count moved a lot
> (1234 → 1347).
>
> ⚠️ **Two things S40 leaves that touch S41's surface:**
> - **`STORAGE_PRESIGN_RPM` is 240** (S44 raised it from 120). S40 added no new
>   presign per upload, but a future s3 video-still display would.
> - **The deferred s3 trio is one session, not three**: a batch GET signer, a
>   longer media GET expiry than `storage-presign`'s **300 s**, and moving
>   `getUrl` from optional into the registry's `REQUIRED` list once both
>   providers can honour it. It is **not** S41's work, but S41's quota plane is
>   the first thing that will want to know how much a customer's bucket holds.

## Start ritual (before touching anything)

1. **Load the `wilson-app` skill** and skim its `versioning.md`.
2. **Re-measure the STATE block**: `git log --oneline -3`, `git status
   --short`, `ls supabase/migrations | tail`, `ls supabase/tests/rls | tail`,
   and `supabase/.temp/linked-project.json` **and** `project-ref` (both must
   say wilson-dev before anything writes).
3. **Read `docs/OUTSTANDING.md`** (what is broken) and
   **`docs/SYSTEMS_HANDBOOK.md` §17** (limits by design — a gate, not an
   oracle).
4. **Read `NETWORK_STORAGE_DESIGN.md` §4a2 + §4a3** and the **S34 outcome
   block** in `MASTER_PLAN_S19_ONWARD.md`.
5. **Re-verify every `file:line` citation in this brief by SYMBOL before
   using it** — sessions between its writing and now have moved them.

---

## Why this exists

**Audrey, 2026-08-07, verbatim:**

> *"if the storage selection is petal cloud and it does store media on petal
> cloud, please make sure to set it up management of that in the operator
> terminal. so if the company selected the petal cloud option, the operator
> terminal should have control to partition server space for that company and
> approve access. so basically if users do want to use the petal offered
> storage they need to be paying the monthly payments for access. it needs to
> be controlled and managed by the operator terminal for when their are
> multiple companies using the tool"*

And the standing rule from the same conversation: *"all databases for tasks,
etc all of it should be saved in supabase databases. its only media etc that
is saved on the selected storage solution"* — already true by construction
(the storage mode touches file BODIES only); this session must keep it true.

**The measured gap (S34):** every workspace defaults to `central` (no
`workspace_storage` row = Petal cloud), uploads have gone to the shared
`rabbit-files` bucket since S14 with a 50 MB per-file cap and **no metering,
no quota, no approval, no payment linkage**. Harmless with one tenant; wrong
the day company #2 signs in.

## The three decisions — settled by Audrey 2026-08-07, do not re-ask

| Question | Decision |
|---|---|
| What does "no plan" mean? | **A small free allowance (1 GB), then a plan is required.** Zero-allowance would make the first-day experience feel broken; a free tier is a funnel, not a cost. |
| Hide "Petal cloud" from non-payers? | **Visible but inert** — selectable state shows "not yet active — contact Petal". Hiding it makes the product look like it lacks the feature. |
| Billing automation in v1? | **Manual.** The operator flips a company active/suspended when payments start/stop. A payment-provider hook is its own later session. |

## What this needs

### 1. The plan table (migration 0049+, re-measure the number)

Operator-owned, following the **model control plane precedent (0031)** —
platform-level tables the operator console curates, workspace-readable:

- `workspace_storage_plans`: workspace_id PK→workspaces, status
  (`active`|`suspended`), `quota_bytes`, notes, audit columns. **Absence of a
  row = the 1 GB free tier** — the default must work with zero rows, because
  every existing workspace has zero rows.
- **Writes ride the operator path** (mirror how the operator console writes
  today — check whether Companies edits go through Edge Functions with
  `adminGuard.ts` or operator RLS, and follow that). Every change writes
  `platform_audit` (⚠️ 0028's closed CHECK on `platform_audit.action` — the
  0028 → 0031 ordering trap; a new action value needs the CHECK extended).
- Workspace members SELECT their own row (the Admin Terminal shows "your
  plan"); **admins must NOT be able to write it** — this is the inverse of
  0048's shape, and the suite needs the discriminating caller (a workspace
  ADMIN who is not an operator) to prove it.

### 2. Enforcement at the upload — restrictive, not advisory

- **Usage metering**: a per-workspace usage figure over `rabbit-files`
  objects. Decide counter-table-with-trigger vs computed view by measuring
  the object-key → workspace join first (keys are project-scoped; project →
  workspace). ⚠️ A trigger on `storage.objects` is a dependency on a table
  Supabase owns — check the house's existing 0027/0042 policies on it for
  precedent before choosing.
- **The gate is a RESTRICTIVE policy** on `rabbit-files` INSERT (quota not
  exceeded AND status not suspended, with the rowless free tier passing).
  🚨 **Not another permissive policy** — permissive policies OR together
  (the 0038 inversion), a RESTRICTIVE one ANDs over the existing set. This
  is the first restrictive policy in the schema; suite probes must prove it
  composes with 0042's money-segment policies rather than replacing them.
- 🚨 **NULL-safety**: the quota comparison runs over an aggregate that is
  NULL for a workspace with no uploads. The S33/0047 lesson both ways —
  decide the failure direction per clause and COALESCE deliberately.
- Client-side checks (greyed upload, usage bar) are the courtesy; per S33's
  measurement, a direct storage REST call bypasses the adapter, so **only
  the policy is the enforcement**.

### 3. Operator console (src/admin — NOT the Admin Terminal)

The platform-operator console is a separate build target
(`vite --mode admin`, `src/admin/`). CompaniesSection gains a storage panel
per company: plan status toggle (approve / suspend), quota input, live usage
readout, audit trail. It copies "the AdminTerminal section contract"
(`src/admin/CompaniesSection.jsx` says so itself) — mountedRef/loadedRef/
seqRef.

### 4. Company side (Admin Terminal → Storage, from S34)

- `central` selected + no plan → the visible-but-inert state with the free-
  tier figure and "contact Petal to activate more".
- `central` + active plan → usage vs quota, plainly.
- The S34 wiring test (`src/lib/workspaceRootWiring.test.js`) pins the
  section's call sites — extend it, don't fork it.

### 5. Suite + proof

New pgTAP suite (**59+**), registered in **BOTH** rls.yml lists (the
allowlist fails loud, the replay list fails SILENT). Discriminating callers:
operator writes ✓, workspace ADMIN write refused (the inverse-of-0048
probe), member reads own row, cross-workspace reads nothing, upload-over-
quota refused server-side with a presence control proving an under-quota
upload lands. **Prove each arm by deleting it — a breaker per check, S33's
rule.** Postgres-side counts bring their own WHERE (dev carries real rows).

## Standing traps

Never `supabase config push`. `git add -A` sweeps untracked files into a
PUBLIC repo. Never interpolate content into a shell command. A migration's
text is not the database's state — query it, and read
`supabase/.temp/linked-project.json` first. One query per `--file`. Count
`<!--`/`-->` after editing long markdown. Deploy order: dev → staging → prod
BEFORE the git push; re-link to wilson-dev after.

## Close-out ritual

1. `docs/OUTSTANDING.md` — delete what is fixed, cite the commit.
2. Sequence table + an S41 outcome block in `MASTER_PLAN_S19_ONWARD.md`;
   **unblock S42's brief** (its blocked-by note points here).
3. Migration verified **by query on dev, staging AND prod**.
4. `tap-all` clean + full vitest + new suite in BOTH rls.yml lists + CI
   green on the pushed head, Playwright included.
5. Refresh the STATE block of the next session's brief
   (`SESSION_42_prompt.md`); update the Claude auto-memory in the same pass.
6. Close out in the chat with the remaining-session list and a plain-English
   breakdown. Never let a diagnosis read as a fix.
