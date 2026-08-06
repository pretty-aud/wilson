# SESSION 34 launch prompt — THE STORAGE ROOT

> **Unit 1a** of `docs/NETWORK_STORAGE_DESIGN.md` — the session that makes a NAS
> work. **Read §3, §4c, §5, §5a2 and §5b of that document first; it is the
> authority and it carries measurements this brief only summarises.**

> **BLOCKED ON S33.** The containment guard must be fixed before a share root
> can be configured at all — `\\server\share` is exactly the shape that breaks
> today.

> **STATE — re-measure, do not trust this block.** After S31: migrations
> **0000–0046** on all three envs, next free **0047** (S33 may take it). pgTAP
> **57 suites**, next free **58**. Vitest **909 / 43**. HEAD `f704a17`.
> 🚨 **A design written mid-S31 said "0046, next free" and was wrong within the
> hour. Read the working tree, never memory or a doc.**

---

## Why this exists

Two facts, both measured:

1. `getFilesConfigPath()` (`electron/main.cjs:89`) stores `{ defaultRootDir }`
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
- **Refuse a drive root or bare share root** (`C:\`, `\\srv\share`) — S33 fixes
  the guard, but a root still hands WILSON an entire disk or share. Ask for a
  subfolder.
- **Reachability probe before saving:** exists, readable, writable, round-trip
  time. A share that is unreachable must fail **at configuration time** with a
  sentence a person can act on — not at the first download, six screens away.
- `dialog.showOpenDialog` with `openDirectory` (`main.cjs:2983`) already accepts
  and returns UNC paths on Windows. **The picker needs no work.**

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
trusts `readFilesConfig()?.defaultRootDir` (`:1352`). If the root moves to the
database and that lookup does not move with it, relink starts refusing folders
inside the configured root. Related: `userAuthorizedDirs` is an in-memory `Set`
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

## Close-out ritual

1. `docs/OUTSTANDING.md` — delete what is fixed, cite the commit.
2. Sequence table in `MASTER_PLAN_S19_ONWARD.md`.
3. Migration verified **by query on dev, staging AND prod**.
4. `tap-all` clean (planned == passed) + full vitest + the new suite registered
   in CI.
5. **Close out in the chat** with the remaining-session list and a plain-English
   breakdown. Never let a diagnosis read as a fix.
