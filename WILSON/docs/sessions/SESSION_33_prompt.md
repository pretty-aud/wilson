# SESSION 33 launch prompt — THE GUARD FIX, AND THE READ EVENT

> **Unit 0 + 1c** of `docs/NETWORK_STORAGE_DESIGN.md`. Both small, neither
> touches UI, both close or prevent a real defect. **This is the session that
> unblocks every other network-storage session.**

> **STATE AFTER S31 — re-measure anyway, this block decays.** Migrations
> **0000–0046** on all three envs, next free **0047**. pgTAP **57 suites / 902
> assertions**, next free suite **58**. Vitest **909 cases / 43 files**. HEAD
> **`f704a17`**. CLI linked to `wilson-dev`.
> 🚨 **The suite list in `.github/workflows/rls.yml` is hand-maintained and the
> git root is the PARENT `wilson/`, one level ABOVE `WILSON/`.**

---

## Part 1 — the containment guard fails closed on a root path

**MEASURED 2026-08-05 by executing the guard, not by reading it.**
`resolveContainedFilePath` (`electron/main.cjs:1330-1337`) is the guard every
file read, write and unlink passes through.

`path.resolve` appends a trailing separator to anything it treats as a **root**,
and a two-component UNC path is a root:

```
path.resolve('\\\\srv\\share')           -> '\\\\srv\\share\\'      ← trailing sep
path.resolve('\\\\FILESERVER\\Projects') -> '\\\\fileserver\\projects\\'
path.resolve('C:\\')                     -> 'C:\\'
path.resolve('\\\\srv\\share\\Projects') -> '\\\\srv\\share\\Projects'   ← none
```

The guard then tests `a.startsWith(b + path.sep)`, which becomes a **doubled
separator** no real path matches:

```
guard('C:\',                  'a.mov')  ->  null    ← every file rejected
guard('\\srv\share',          'a.mov')  ->  null    ← every file rejected
guard('\\srv\share\Projects', 'a.mov')  ->  '...\a.mov'   ← fine
```

**Consequences once such a root is configured:** download returns `400 invalid
storage path` (`:2035`); delete skips the `unlink` (`:2066`) and orphans the
body while writing an honest `blob_removed: false` certificate; relink refuses
folders genuinely inside the root, because `isUserAuthorizedRelinkDir`
(`:1354-1357`) uses the same comparison.

**Nobody is hitting it today** — Audrey's root is
`C:\Users\Audrey\Documents\My_Work`, three levels deep. It is reachable **now**
via Settings → Files & Storage → Change by picking a drive root, and it becomes
the *normal* case the moment network paths land, because `\\server\share` is how
people name a share.

### 🚨 The risk is in the FIX, not the current behaviour

The guard currently fails **CLOSED** — it refuses everything, which is safe.
A normalisation that trims separators from **both** sides, or a switch to a
plain `startsWith` without the separator boundary, turns fail-closed into
**fail-open** and re-opens the arbitrary-path `unlink` that S14 closed
deliberately. `TPN-NET-013` exists to make this a reviewed security edit rather
than a typo fix.

**Ship these as tests, asserting `null` AFTER the fix, against BOTH a
trailing-separator root and a normal one** — measured working today, they must
keep working:

| base | relPath | must be |
|---|---|---|
| `\\fileserver\Projects\Hero_FILES` | `..\..\..\..\..\secret.txt` | `null` |
| `\\fileserver\Projects\Hero_FILES` | `\\attacker\share\x` | `null` |
| `\\fileserver\Projects\Hero_FILES` | `//attacker/share/x` | `null` |
| `\\fileserver\Projects\Hero_FILES` | `C:\Windows\win.ini` | `null` |
| `\\srv\share` | `a.mov` | **`\\srv\share\a.mov`** (the fix) |
| `C:\` | `a.mov` | **`C:\a.mov`** (the fix) |

🚨 **Guard the CALL SITE, not only the helper.** A unit test over
`resolveContainedFilePath` alone would pass today while downloads 400. Prove a
download and a delete work against a share-root-shaped base.

Also fix the same comparison in `isUserAuthorizedRelinkDir` (`:1354-1357`) —
same bug, second location, and it is the one a helper-only test misses.

---

## Part 2 — content has no read event, and a shared root makes that matter

**MEASURED.** `file_events` vocabulary
(`supabase/migrations/0027_file_lifecycle.sql:85-86`):

```sql
event TEXT NOT NULL CHECK (event IN
  ('uploaded', 'moved', 'relinked', 'trashed', 'restored', 'purged')),
```

**There is no `downloaded` or `viewed` event on either backend**, and the local
download route (`electron/main.cjs:2028-2039`) calls no logger at all —
`rabbitLogFileEvent` has four call sites and none is a read.

This is already `TPN-CONT-008` / `TPN-LOG-002` (both open HIGH). **Do not mint a
new finding ID.** What changes is the blast radius: today the content sits in one
person's home directory, so *"who read this file"* has one plausible answer. **A
shared root removes that answer.** AS-2.9 requires logging every view and
download with timestamp, user and source.

**Why it belongs HERE and not later:** the TPN design review made it a condition
of Phase 1 — *"add a `downloaded` event as part of Phase 1, not later"*. Shipping
the shared root without it is the one place the safest option still moves a
finding backwards. Lifecycle terms are never retrofitted once a feature ships
working (see `TPN-CONT-011`).

**Scope:** a `CHECK` constraint change (migration **0047**, re-measure the
number) plus one call site per backend. Extend pgTAP `33_file_lifecycle`.

---

## Standing traps

- 🚨 **Never `supabase config push`.** Auth email templates are staging-only and
  live only in the dashboard.
- 🚨 **`git add -A` sweeps untracked files into a PUBLIC repo.** There is
  currently an untracked `docs/messed up handbook.pdf`. Add files by name.
- 🚨 **Never build a shell command by interpolating content**, and never pipe
  file content through PowerShell to rewrite it (PS 5.1 reads BOM-less UTF-8 as
  ANSI and double-encodes silently).
- **A migration's text does not tell you the database's state — query it.**
  Read `supabase/.temp/linked-project.json` before anything that writes.
- **`supabase db query --file` returns only the LAST result set** — one query
  per file. `-o json` does **not** return `RAISE NOTICE`.
- **After editing any long markdown doc, count the `<!--` / `-->` markers.**
  An unclosed comment is a silent delete (S30 lost 227 lines that way).

## Close-out ritual

1. Update `docs/OUTSTANDING.md` — **delete** the drive-root entry when fixed,
   citing the commit. Adding nothing new is a valid outcome.
2. Update the sequence table in `MASTER_PLAN_S19_ONWARD.md`.
3. Verify migration **by query on dev, staging AND prod** — not by the CLI's
   success line.
4. Run `tap-all` (planned == passed) and the full vitest suite.
5. **Close out in the chat** with the remaining-session list and a plain-English
   breakdown. Never let a diagnosis read as a fix.
