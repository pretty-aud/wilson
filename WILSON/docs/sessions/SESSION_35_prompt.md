# SESSION 35 launch prompt — THE MANAGER HALF, AND THE SETUP GUIDANCE

> **Units 1b + 2** of `docs/NETWORK_STORAGE_DESIGN.md` (§5a2, §4c).
> **BLOCKED ON S34** — the workspace root must exist before anything can be
> contained *within* it.

> **STATE — re-measure.** After S34 the storage root lives in
> `public.workspace_storage`. Confirm the migration number, suite count and
> HEAD from the working tree, not from this block.

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

## Close-out ritual

1. `docs/OUTSTANDING.md` — delete what is fixed, cite the commit.
2. Sequence table in `MASTER_PLAN_S19_ONWARD.md`.
3. Any migration verified **by query on dev, staging AND prod**.
4. `tap-all` clean + full vitest.
5. **Close out in the chat** with the remaining-session list and a plain-English
   breakdown. Never let a diagnosis read as a fix.
