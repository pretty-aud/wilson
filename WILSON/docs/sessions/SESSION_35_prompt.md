# SESSION 35 launch prompt — THE MANAGER HALF, AND THE SETUP GUIDANCE

> **Units 1b + 2** of `docs/NETWORK_STORAGE_DESIGN.md` (§5a2, §4c).
> **BLOCKED ON S34** — the workspace root must exist before anything can be
> contained *within* it.

> ✅ **UNBLOCKED — S34 SHIPPED (2026-08-07, `79b6220`).** The storage root
> lives in `public.workspace_storage` (0048, all three envs, verified by
> query). Read the **S34 outcome block** in `MASTER_PLAN_S19_ONWARD.md`
> before starting.

> **STATE — re-measure, do not trust this block.** After S34: migrations
> **0000–0048** on all three envs (verified by query), next free **0049**.
> pgTAP **58 suites / 951 assertions**, next free suite **59**. Vitest
> **972 / 46 files**. HEAD `79b6220` (+ a docs postscript after it), CLI
> linked to wilson-dev.
> 🚨 **A design written mid-S31 said "0046, next free" and was wrong within
> the hour. Read the working tree, never memory or a doc.**

> **What S34 hands this session, beyond the brief below:**
> - **The boundary check has its pieces waiting.** The workspace root
>   reaches `electron/main.cjs` as `workspaceRootDir` (pushed over
>   `rabbit:set-workspace-root`), and `isPathInside` from
>   `electron/pathContainment.cjs` is the one comparison — containing
>   `folder_root` inside the root is a call, not a design.
> - **`resolveConfiguredRootDir()` (main.cjs) is the ONE definition of the
>   machine's effective root**; a wiring test
>   (`src/lib/workspaceRootWiring.test.js`) fails if a resolver re-derives
>   it. Extend that test when the Control Panel gate lands.
> - **`classifyRoot`/`canonicalizeRoot` (`src/lib/storageRoot.js`) already
>   refuse mapped drives, bare roots, dot segments and device paths** — the
>   Control Panel folder picker should ride the same module, not re-derive.
> - ⚠️ **S34's review found the folder_root write path exactly as the
>   design measured it**: `main.cjs` create/patch still take
>   `req.body.folder_root` verbatim, and `ProjectSummaryView`'s two
>   `pickDirectory` writers are unvalidated. That containment is THIS
>   session's substance.
> - ⚠️ **Two S34 stated limits touch S35's docs half:** a changed root
>   reaches other machines only at next launch/sign-in, and the web
>   terminal cannot probe reachability — both belong in the VPN/NAS setup
>   guidance so a customer is told, not surprised. §4c's five-minute check
>   (does Audrey's NAS's remote-access mode preserve the UNC form?) is
>   still owed.


## Start ritual (before touching anything)

1. **Load the `wilson-app` skill** and skim its `versioning.md`.
2. **Re-measure the STATE block**: `git log --oneline -3`, `git status
   --short`, `ls supabase/migrations | tail`, `ls supabase/tests/rls | tail`,
   and `supabase/.temp/linked-project.json` **and** `project-ref` (both must
   say wilson-dev before anything writes).
3. **Read `docs/OUTSTANDING.md`** (what is broken) and
   **`docs/SYSTEMS_HANDBOOK.md` §17** (limits by design — a gate, not an
   oracle).
4. **Read the design sections this brief names in its header.**
5. **Re-verify every `file:line` citation in this brief by SYMBOL before using
   it** — sessions between its writing and now have moved them. The session
   that edits a file is the one that breaks its own citations.

---

## Part 1 — managers set project folders, inside the admin's drive

**Audrey, verbatim (2026-08-05):**

> *"admins can set server/drive. managers can set folders within set drive. this
> stops anyone from breaking it. it only allows the admin to choose the drive.
> the admins can set the drive in the admin terminal. the managers set the
> project folder in the drive in the project control panel."*

The split is by **what is being set**, and it maps onto a distinction the code
already has:

| Setting | Who | Where | Column |
|---|---|---|---|
| the drive / server | **admin only** | Admin Terminal | `workspace_storage.root_path` (S34) |
| a project's folder inside it | **admin or manager** | **Project Control Panel** | `projects.folder_root` |
| nothing | `user`, reviewer | — | — |

`electron/main.cjs:1438` already resolves `project.folder_root ||
cfg.defaultRootDir`, and `ProjectSummaryView.jsx:370` — the Control Panel — is
already where `folder_root` is displayed. **This is an existing concept that
needs an owner and a boundary, not a new one.**

### 🚨 The boundary does not exist — this is the substance of the session

*"this stops anyone from breaking it"* only holds if a manager's project folder
must sit **inside** the admin's drive. Today it need not:

```js
// electron/main.cjs:1431 — create
folder_root: req.body.folder_root || null,
// electron/main.cjs:1455 — patch
bundle.project = { ...bundle.project, ...req.body, id: bundle.project.id };
```

**`folder_root` is taken straight from the request body and validated against
nothing** (`TPN-NET-015`, HIGH). A project can be pointed at any absolute path
the process can reach, whereupon `ensureProjectFolders` builds a tree there and
uploads write into it. Reachable by any caller of the local API, which is
**unauthenticated**.

The codebase already knows this is dangerous one function away:
`isUserAuthorizedRelinkDir` (`:1345`) exists precisely because *"a body-picked
baseDir would let a drive-by request point a project's files at, say, the user's
Documents and read/unlink there"* (S14). **That reasoning applies verbatim here
and this route never got the guard.**

**Fix:** containment-check `folder_root` against `workspace_storage.root_path`
using the same resolver that guards individual files, one level up. Both routes
— create and patch.

### The role seat

`current_app_role() IN ('admin','manager')` — the pattern already used by
migrations 0012 and 0013. Enforced in RLS; mirrored in the Control Panel UI.

🚨 **`project.settings.open` is the ONLY action where a reviewer outranks a
member**, and `project.entity.write` is the exact inverse. `canSeeProjectMoney`
admits neither. **There is no house default here — do not copy a neighbouring
gate without checking.** Handle `ready`, or a real manager sees the control
disabled while their role resolves.

---

## Part 2 — write down how remote access actually works

Documentation, no code. Into `docs/SYSTEMS_HANDBOOK.md`, and it closes the
customer-facing loop for S34.

**The content (design §4c):**

- **A NAS is the always-on server WILSON does not have.** It presents as
  `\\nas\projects` — the same UNC share S34 supports. On the LAN nothing extra
  is needed.
- **Remote access is the customer's, not WILSON's.** Either a corporate VPN, or
  the NAS's own built-in VPN server / vendor relay (Synology, QNAP, TrueNAS all
  ship these as configuration rather than a project). **WILSON cannot tell the
  difference** — it still resolves the same path.
- **TPN:** MPA CSBP TS-2 names *"Bastion host model only. VPN with AES-256"* as
  **the** remote-access control. A VPN is not a fallback here, it is the named
  control — which is why the cheapest route is also the compliant one.
- ⚠️ **State the performance truth plainly.** *"Accessible 24/7"* is true;
  *"usable for multi-GB video over the internet"* is not the same claim. SMB is
  chatty and latency-sensitive. Browsing, metadata and documents are fine
  remotely; **copy down / work local / copy back** is the workflow that works;
  scrubbing multi-GB media in place over a WAN link is slow and will feel
  broken. **Better to set the expectation than to have a customer conclude
  WILSON is slow when the physics is the share.**
- ⚠️ **Requires the UNC form.** Some vendor sync clients only surface the share
  as a mapped drive letter, which S34 refuses by design (per-machine).
  **Confirm against whichever NAS Audrey actually has before promising this** —
  five minutes with a real box, much cheaper now than in support.
- **State the SMB requirement** (`TPN-CONT-016`): SMB 3.x with signing and
  encryption; refuse SMB1. WILSON cannot enforce the server's config, but the
  requirement belongs in the setup guidance — a default share moves pre-release
  content unsigned and unencrypted across the office LAN.
- **State the desktop/browser split once, properly** (design §5f): professional
  formats and very large files want the desktop app.

---

## Standing traps

Never `supabase config push`. `git add -A` sweeps untracked files into a PUBLIC
repo. Never interpolate content into a shell command. Query the database rather
than reading migration text; read `supabase/.temp/linked-project.json` first.
One query per `--file`. Count `<!--` / `-->` after editing long markdown —
`SYSTEMS_HANDBOOK.md` and `OUTSTANDING.md` are both long.

⚠️ **Deploy order: dev → staging → prod BEFORE the git push** — `feat/multi-user-v1` auto-deploys the STAGING-backed beta, so a push before the staging migration means the beta runs new code against an old schema. **Re-link the CLI to `wilson-dev`** when the last env is verified.

## Close-out ritual

1. `docs/OUTSTANDING.md` — delete what is fixed, cite the commit.
2. Sequence table in `MASTER_PLAN_S19_ONWARD.md`.
3. Any migration verified **by query on dev, staging AND prod**.
4. `tap-all` clean + full vitest.
5. **Refresh the STATE block of the next session's brief** (`SESSION_36_prompt.md`) with the numbers you leave behind — that block decays the moment you commit. Update the Claude auto-memory in the same pass.
6. **Close out in the chat** with the remaining-session list and a plain-English
   breakdown. Never let a diagnosis read as a fix.
