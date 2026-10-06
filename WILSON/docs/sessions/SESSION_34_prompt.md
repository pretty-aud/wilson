# SESSION 34 launch prompt — THE STORAGE ROOT

> **Unit 1a** of `docs/NETWORK_STORAGE_DESIGN.md` — the session that makes a NAS
> work. **Read §3, §4c, §5, §5a2 and §5b of that document first; it is the
> authority and it carries measurements this brief only summarises.**

> ✅ **UNBLOCKED — S33 SHIPPED (2026-08-07, `ed85072` + `439f702` + `ca4f252`).**
> The containment guard accepts drive/share roots and lives in
> **`electron/pathContainment.cjs`** now (extracted so it is unit-testable;
> `main.cjs` requires it). Migration **0047** added the `downloaded` event +
> `log_file_downloaded`. Read the **S33 outcome block** in
> `MASTER_PLAN_S19_ONWARD.md` before starting — three of its lessons land
> directly on this session (see "What S33 hands this session" below).

> **STATE — re-measure, do not trust this block.** After S33: migrations
> **0000–0047** on all three envs (verified by query), next free **0048**.
> pgTAP **57 suites / 920 assertions**, next free suite **58**. Vitest
> **940 / 44**. HEAD `ca4f252`, all five CI checks green.
> 🚨 **A design written mid-S31 said "0046, next free" and was wrong within the
> hour. Read the working tree, never memory or a doc.**

## Start ritual (before touching anything)

1. **Load the `wilson-app` skill** and skim its `versioning.md`.
2. **Re-measure the STATE block**: `git log --oneline -3`, `git status
   --short`, `ls supabase/migrations | tail`, `ls supabase/tests/rls | tail`,
   and `supabase/.temp/linked-project.json` **and** `project-ref` (both must
   say wilson-dev before anything writes).
3. **Read `docs/OUTSTANDING.md`** (what is broken) and **`docs/SYSTEMS_HANDBOOK.md`
   §17** (limits by design — a gate, not an oracle).
4. **Read the design sections this brief names** (§3, §4c, §5, §5a2, §5b of
   `docs/NETWORK_STORAGE_DESIGN.md`).
5. **Re-verify every `file:line` citation in this brief by SYMBOL before using
   it** — sessions between its writing and now have moved them (S33 alone
   shifted `main.cjs` by ~30 lines). The session that edits a file is the one
   that breaks its own citations.

---

## What S33 hands this session

- **The guard is fixed and MOVED.** Containment semantics live in
  `electron/pathContainment.cjs` (`resolveContainedFilePath` + `isPathInside`),
  unit-tested in `src/tools/rabbit_v0.1.0/pathContainment.test.js` with the
  escape cases pinned. **Add the database root to the `roots` array in
  `isUserAuthorizedRelinkDir` — never re-derive a path comparison**; the
  module is the one definition and a source-scan wiring test refuses local
  redefinitions.
- 🚨 **A policy predicate moved into procedural SQL flips its failure
  direction** (S33 measured it: `can_access_project_money` returns NULL for a
  claim-less non-manager — refusal in a policy, silent PASS in an `IF`).
  S34 edits `fn_workspaces_client_guard` (trigger, procedural): use NULL-safe
  operators (`IS DISTINCT FROM`) or `COALESCE`, and write a breaker with a
  claim-less caller to prove the refusal actually fires.
- 🚨 **Dev now carries REAL user data** (`user_pets` at least — the S31
  feature getting used). A postgres-side probe in suite 58 must **bring its
  own WHERE**; an unscoped `count(*)` decays the day the feature is used
  (S33's `439f702` fixed exactly that in suites 56/57).
- 🚨 **A refusal probe pins ONE check only if every other check waves its
  caller through.** S34's admin-only policies need the discriminating caller
  shapes: a non-admin WITH membership (pins the role arm), an admin claim
  over a DEACTIVATED membership (pins the membership arm), and a
  dual-workspace member signed into the other workspace (pins the claim arm).
  Prove each by deleting the check and watching exactly one probe fail.

## Why this exists

Two facts, both measured:

1. `getFilesConfigPath()` (`electron/main.cjs:90`) stores `{ defaultRootDir }`
   at `{userData}/rabbit-data/files-config.json` — **per machine**. A second
   computer has never written that file and sees nothing.
2. Audrey's saved value is a **local disk path**,
   `C:\Users\Audrey\Documents\My_Work`. Carrying it to another computer resolves
   against *that* machine's identically-named folder — pointing at the wrong
   content rather than sharing it.

**The target:** a company points WILSON at their NAS (`\\nas\projects`), every
computer in the office resolves the same share, and remote access is the
customer's VPN or their NAS's own — WILSON cannot tell the difference (§4c).

---

## What this needs

### 1. The table (migration 0047+, re-measure the number)

```sql
CREATE TABLE public.workspace_storage (
  workspace_id  UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  mode          TEXT CHECK (mode IN ('central','byos')),
  root_path     TEXT,        -- canonical UNC, NO trailing separator
  root_kind     TEXT CHECK (root_kind IN ('unc','local')),
  -- audit columns per house pattern
  created_at, created_by, updated_at, updated_by
);
```

**RLS — admin only for the root** (§5a2). Mirror `workspaces_admin_update`'s
shape: `current_workspace_id()` + `current_app_role() = 'admin'` +
`has_active_membership(id)`. Members SELECT. New pgTAP suite (**58+**), and
**register it in `.github/workflows/rls.yml` by hand** — that list is not
derived and the CI comment says so.

🚨 **Do NOT read `workspaces.storage_mode` / `storage_config`.** Measured: zero
readers anywhere, **but admin-writable today** via `workspaces_admin_update`
because `fn_workspaces_client_guard` protects only `slug`/`id`/`created_at`/
`deleted_at`. A future reader would inherit values written before validation
existed (`TPN-CLOUD-007`). **Guard both columns in this same migration** — one
`IF` each in that trigger — and start from a new table with a known state.

### 2. Path handling

- `classifyRoot(p)` → `local | unc | mapped`.
- **Refuse mapped drives.** Measured (§3.3): `Z:\Projects`,
  `\\FILESERVER\Projects`, `\\fileserver.corp.local\Projects` and
  `\\192.168.1.5\Projects` are four strings for one folder. Case folds; host vs
  FQDN vs IP does not; a drive letter is per-machine. Moving the root into the
  database **spreads** that problem rather than fixing it. Show the
  `\\server\share\...` form and ask for it.
- **Refuse a drive root or bare share root** (`C:\`, `\\srv\share`) — S33
  FIXED the guard (roots resolve correctly now), so this refusal is pure
  product judgment, not a workaround: a root hands WILSON an entire disk or
  share, and containment under `C:\` contains the whole drive. Ask for a
  subfolder.
- **Reachability probe before saving:** exists, readable, writable, round-trip
  time. A share that is unreachable must fail **at configuration time** with a
  sentence a person can act on — not at the first download, six screens away.
- `dialog.showOpenDialog` with `openDirectory` (`main.cjs:3008`, re-verify by
  symbol) already accepts and returns UNC paths on Windows. **The picker needs
  no work.**

### 3. The admin gate + two-step confirm (§5a2)

**Audrey, verbatim:** *"admins can set server/drive... the admins can set the
drive in the admin terminal."*

🚨 **There is no permission gate on this control today — MEASURED.**
`StorageConnections.jsx` **imports `usePermissions` and never gates on it**:
`perms` is read at `:104` and `:106`, both times for a **display label**. Any
`user`-role member can change it. Low impact only because the setting is
per-machine; **this session makes it workspace-wide, so the gate must ship in the
same commit** (`TPN-AUTH-009`).

The drive control lives in the **Admin Terminal**
(`src/components/AdminTerminal/`), alongside Users/Company/Models — not in
`src/admin/`, which is the platform-operator console.

**Two-step confirm, on path kind — not on every save:**

| Picked | Behaviour |
|---|---|
| **Local folder** | **Step 1 explains** (not a question): this folder is on *this computer only*; nobody else on the team will open these files and you will not see them from another machine; use `\\server\share\...` if you have a team. **Step 2 confirms:** "Set this computer's folder anyway?" |
| **Network path** | No single-user warning. Probe, then save. |
| **Mapped drive** | Refuse, explain, show the UNC form. |
| **Drive/share root** | Refuse, ask for a subfolder. |

Splitting the two steps is the point: a single "Are you sure?" gets clicked
through; being told *what will happen* and then asked separately does not.

### 4. Resolution order + the relink lookup

Project `folder_root` → workspace `root_path` → machine `defaultRootDir` →
internal rabbit-data. **A per-machine fallback must remain** — Local Server mode
has to work for a solo user before sign-in.

⚠️ **`isUserAuthorizedRelinkDir` must learn about the new root.** It currently
trusts `readFilesConfig()?.defaultRootDir` (`main.cjs:1353`; the comparison
itself rides `isPathInside` from `pathContainment.cjs` since S33 — extend the
`roots` array, do not touch the comparison). If the root moves to the database
and that lookup does not move with it, relink starts refusing folders inside
the configured root. Related: `userAuthorizedDirs` is an in-memory `Set`
rebuilt every launch, so a database-sourced root is in nobody's authorized set
on a fresh machine.

### 5. Permission-gate rules that have cost sessions before

- **`ready` is the field everyone forgets** — a real admin sees the control
  disabled while their role resolves.
- **A gated create button ≠ a gated screen.**
- RLS is the enforcement; the greyed control is the courtesy.

---

## Standing traps

Never `supabase config push`. `git add -A` sweeps untracked files into a PUBLIC
repo (there is an untracked `docs/messed up handbook.pdf`). Never interpolate
content into a shell command. A migration's text is not the database's state —
query it, and read `supabase/.temp/linked-project.json` first. One query per
`--file`. Count `<!--` / `-->` after editing long markdown.

⚠️ **Deploy order: dev → staging → prod BEFORE the git push** — `feat/multi-user-v1` auto-deploys the STAGING-backed beta, so a push before the staging migration means the beta runs new code against an old schema. **Re-link the CLI to `wilson-dev`** when the last env is verified.

## Close-out ritual

1. `docs/OUTSTANDING.md` — delete what is fixed, cite the commit.
2. Sequence table in `MASTER_PLAN_S19_ONWARD.md` + an outcome block (S31/S33
   shape: what shipped, what the breakers taught, what was left open and why).
3. Migration verified **by query on dev, staging AND prod**.
4. `tap-all` clean (planned == passed) + full vitest + the new suite registered
   in CI (BOTH rls.yml lists — the allowlist fails loud, the replay list fails
   SILENT), + CI green on the pushed head, Playwright included.
5. **Refresh the STATE block of the next session's brief** with the numbers
   you leave behind (migrations, suites/assertions, vitest, HEAD) — that block
   decays the moment you commit, and the next session starts by trusting it
   less but reading it first. Update the Claude auto-memory in the same pass.
6. **Close out in the chat** with the remaining-session list and a plain-English
   breakdown. Never let a diagnosis read as a fix.
