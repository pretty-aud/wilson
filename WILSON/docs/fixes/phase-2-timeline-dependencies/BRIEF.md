# PHASE 2 — TIMELINE DEPENDENCIES CANNOT BE CREATED

> **Audrey, 2026-08-10, verbatim:**
> *"when i tried to connect one task to another in the timeline to create a
> dependency, the connection did not happen. i was able to grab the line from
> the dependency task but i could not attach it to another this is crucial to
> work."*
> *"for the timeline in the rabbit tool, i am not seeing the blank line below
> the existing tasks for a user to place a new task. look at the original build
> from main. in each phase, there was a way to create a new task in a blank row
> below the current existing tasks in the phase. lets make sure to still have
> this"*
>
> 🚨 **THIS PHASE NEEDS MIGRATION 0059.** It is the only phase in the pass that
> touches schema. Read the working tree for the next free number — it was
> **0059** at `158172c`, and pgTAP's next free suite was **67**.

---

## Part A — the dependency write is rejected by PostgREST

### Root cause, confirmed

`linkTasks` in `src/tools/rabbit_v0.1.0/state/RabbitProvider.jsx` builds:

```js
const row = {
  id,
  predecessor_id: predecessorId,
  successor_id:   successorId,
  kind:           'task',
  type,
  lag_days:       lagDays,
  project_id:     activeProjectId,
};
```

`public.task_dependencies`, created in `supabase/migrations/0000_rabbit_base_schema.sql`,
has exactly these columns:

| Column | Source |
|---|---|
| `id`, `predecessor_id`, `successor_id`, `type`, `lag_days` | 0000 |
| `last_updated_by`, `last_updated_at`, `deleted_at`, `deleted_by` | 0000's backfill loop |

**There is no `kind` column and no `project_id` column.**

The adapter does nothing to stop them. `supabaseAdapter.js`:

```js
async upsertDependency(dep) {
  const client = await requireClient();
  const row = sanitize(dep, []);
  return unwrap(await client.from('task_dependencies').upsert(row).select().single());
},
```

`sanitize(obj, drop)` is a **denylist**, and it is called with an **empty drop
list**, so both unknown keys go straight through. PostgREST rejects the **whole
request** with `PGRST204`. `optimistic()` rolls the edge back and the line
vanishes from the chart.

### Why Audrey saw no error

`src/tools/rabbit_v0.1.0/views/TimelineView.jsx`:

```js
onLinkTasks={(predId, succId) => ctx.linkTasks(predId, succId).catch(() => {})}
onLinkPhases={(predId, succId) => ctx.linkPhases(predId, succId).catch(() => {})}
onUnlinkDependency={(depId) => ctx.unlinkDependency(depId).catch(() => {})}
```

Three swallowed rejections on the three dependency writes.

🚨 **This is a recurrence of a defect class this repo has already documented.**
`supabaseAdapter.js` carries a long comment headed *"Session 23: column
ALLOWLISTS"* that describes exactly this failure, and ends:

> *"Every one of those rejections was swallowed by a caller with no catch, which
> is why it looked like 'nothing happens'."*

The allowlist that S23 introduced was never extended to dependencies.

### Why it may work on the desktop app

`localServerAdapter.js` POSTs the whole `dep` object to the in-app Express
server, which stores it as JSON and does not care about unknown keys. So this
is a **cloud-mode-only** failure. That is exactly the desktop/web divergence
Audrey has ruled out: *"all functionality should be the same in both versions."*

### Part A2 — `linkPhases` is structurally impossible today

Both foreign keys point at `tasks(id)`:

```sql
predecessor_id uuid not null references tasks(id) on delete cascade,
successor_id   uuid not null references tasks(id) on delete cascade,
```

A phase→phase edge stores **phase** ids in those columns. Even once `kind`
exists, every `linkPhases` call will violate the FK. **Adding `kind` alone fixes
task dependencies and leaves phase dependencies just as broken, with a new and
more confusing error.**

⚠️ There is also a `unique (predecessor_id, successor_id)` constraint. Once one
table holds both kinds, that pair is no longer unique on its own — it must
become `(kind, predecessor_id, successor_id)` or a task edge and a phase edge
sharing ids will collide.

---

## Part B — the missing "+ New task" row

### What is actually true

The drop-zone row **is built**, for every phase, in every grouping mode
(`buildRows`, `buildRowsByTeam`, `buildRowsByAsset`, `buildRowsByScene`,
`buildRowsByLevel`, `buildRowsByExperience` — all push a `kind: 'drop-zone'`
row labelled `'+ New task'`). It is **not** missing from the code.

Diffed against `main`, the sole behavioural change is Session 29's permission
gate:

```js
// main
opacity: isDzHover || isReparentHoverDz ? 1 : 0.4

// current
opacity: canWrite ? (isDzHover || isReparentHoverDz ? 1 : 0.4) : 0.4
```

When `canWrite` is false the row sits permanently at 0.4, never lights on hover,
carries `cursor-not-allowed`, and its `onClick` returns immediately. It reads as
decoration rather than a control — which is indistinguishable from "not there".

### ✅ ANSWERED — the target, from Audrey's own screenshot

Audrey supplied a screenshot of the original `main` build on 2026-08-10, with:

> *"this is how it looked in the original build. this is how i want it. nothing
> in the body of the row. it has the faint + new task in the left side table
> with timeline item titles. when the user hovers over the blank timeline line
> with no item, it shows a preview of where the item would be placed."*
>
> *"again i just what full functionality and look of the original main single
> user previous build"*

**The target has three parts, and all three must be present:**

1. **Left label gutter** — a faint, italic `+ New task…` row sitting directly
   under the last task of each phase.
2. **Chart row body — EMPTY at rest.** Her words: *"nothing in the body of the
   row."* No placeholder bar, no dashed outline, nothing until hover.
3. **On hover over the blank chart row** — a ghost preview bar appears **at the
   cursor's X position**, showing where the task would land if clicked.

✅ **All three already exist in the current code.** The gutter row is built by
every `buildRows*` function; the chart-side hover ghost is the `isDzHover` /
`ghostWidth` / `mouseXInChart` block. **Nothing needs to be rebuilt — this is a
restoration of behaviour, not of code.**

### ❌ RULED OUT — the ARCHIVED project status

Her screenshot shows `LEGEND ROAD [ARCHIVED]`. Audrey, 2026-08-10:
*"ignore this. it was a test of the status."*

Measured anyway, and it is a dead end regardless: `archived` is a **cosmetic
status label only**. It appears in no RLS policy in any migration, and
`useProjectAccess` builds `canWrite` from `appRole`, `projectRole`, `isStaffed`
and `ready` — **archived is not in the gate.** An archived project is fully
writable.

### What remains

The **only** behavioural delta from `main` is the S29 `canWrite` gate quoted
above. So the diagnosis reduces to: **why is `canWrite` false for Audrey on her
own project?**

Work it in this order:

1. 🚨 **Check `ready` first.** `useProjectAccess`'s own header:
   *"`ready` is the field that gets forgotten, and forgetting it is silent…
   That is the S23 bug, and it cost four sessions to find."* A false `ready`
   during load makes every gate read as denied, and if `getSession()` never
   settles it never recovers. 🚨 Related known issue: **`withTimeout` races but
   never aborts**, and an abandoned `getSession()` holds auth-js's global lock.
2. **Then `isStaffed` and `projectRole`.** `useProjectAccess` defaults
   `isStaffed` to `false` and `projectRole` to `null` when the context has not
   resolved. Check what `canOnProject` does with that combination for a
   workspace **admin** — Audrey is one, and an admin being refused write on her
   own project would be the bug.
3. **If `canWrite` turns out TRUE**, then this is contrast, not permission:
   0.4 opacity on `#78716c` is genuinely faint. Raise the resting state to match
   what the screenshot shows.

⚠️ **Do not "fix" this by deleting the S29 gate.** It exists because this view
was the only task-creating surface in R.A.B.B.I.T. with no permission check, and
reviewers were being offered a dozen ways to create a task only to get
`new row violates row-level security policy for table "tasks"` back.

---

## What to change

### 1. Migration `0059` — read the working tree for the real number

- Add `kind TEXT NOT NULL DEFAULT 'task'` to `task_dependencies`, with a CHECK
  constraining it to `('task','phase')`. The default is what keeps legacy rows
  working — `RabbitProvider` already treats missing `kind` as `'task'`.
- Make phase edges legal. The FKs to `tasks(id)` must go, since one column now
  references one of two tables depending on `kind`. **Preserving referential
  integrity is the design decision of this phase** — options are a trigger-based
  check, or splitting phase edges into their own table. Decide deliberately and
  write the reasoning into the migration.
- Replace `unique (predecessor_id, successor_id)` with a uniqueness rule that
  includes `kind`.
- ⚠️ **Do NOT add `project_id`** unless the query patterns actually need it.
  S23's rule: *"a column for a feature with no implementation is schema debt"*.
  The client sends it, but nothing reads it — strip it at the adapter instead.
  🚨 If you decide it IS needed, it arrives WITH the thing that reads it.
- 🚨 **A wrapped `ADD CONSTRAINT` cannot WIDEN one — it is a silent no-op.** Use
  explicit `DROP` + `ADD` and read the definition back.
- 🚨 **Postgres reports a CHECK violation by the ALPHABETICALLY FIRST constraint
  name**, and pgTAP's `throws_ok` matches `SQLERRM` exactly.

### 2. pgTAP suite 67 — read the working tree for the real number

Cover: a task edge inserts; a phase edge inserts; the `kind` CHECK refuses a
third value; the uniqueness rule permits a task edge and a phase edge with the
same id pair; RLS still gates both by project membership.

🚨 **Add the new suite to `.github/workflows/rls.yml`.** That file lives in the
**PARENT git root**, one level above `WILSON/`, so `git status` inside `WILSON/`
reads clean while the replay list rots. S42 was bitten by exactly this.

### 3. Give `task_dependencies` a real column allowlist

Add it alongside the other S23 allowlists in `supabaseAdapter.js` and use it in
`upsertDependency` in place of `sanitize(dep, [])`. 🚨 **Assert the executable
form in any test, never a bare phrase** — S37 tripped this twice with a
`not.toContain` that matched the comment explaining why the form was wrong.

### 4. Unswallow the three catches

`TimelineView.jsx` — `onLinkTasks`, `onLinkPhases`, `onUnlinkDependency` must
surface failure to the user. The view already has a pattern for this; do not
invent a second one.

### 5. `deleteDependency` argument mismatch

`RabbitProvider` calls `adapterRef.current.deleteDependency(dependencyId, activeProjectId)`.
`supabaseAdapter`'s signature is `deleteDependency(id)` — the second argument is
silently ignored. Harmless today because the delete is keyed on the id alone,
but it is a trap. Align the signatures.

---

## What NOT to change

- ❌ Do not remove the S29 `canWrite` gate.
- ❌ Do not make `upsertDependency` a passthrough.
- ❌ Do not change `optimistic()` or the undo/redo history. The rollback
  behaved correctly — it rolled back a write that genuinely failed.
- ❌ Do not renumber existing migrations. **Move rows, not numbers.**

---

## Risks — what this could break

- **The undo/redo stack.** `linkTasks` pushes `undoOps`/`redoOps` that call
  `unlinkTasks(id)`. If the allowlist strips a field the redo path depends on,
  undo will appear to work and redo will not. Test undo *and* redo.
- **Realtime merge.** `src/tools/rabbit_v0.1.0/state/realtimeMerge.js` merges
  rows arriving over the wire. A new `kind` column changes the row shape that
  other clients receive. Check it handles a row whose `kind` it did not send.
- **The critical-path engine.** Its current correctness relies on an accident:
  phase-kind rows are filtered out *because their ids are not in the task lookup
  table*. Once phase edges genuinely insert, that accident is load-bearing —
  verify `buildSchedule` still excludes them deliberately.
- 🚨 **The migration runs on three environments.** Dev, staging and prod are all
  at 0058. Verify by query after each, not by exit code.

---

## Definition of done

- [ ] Dragging from one task bar to another creates a visible, persisted dependency
- [ ] It survives a page reload
- [ ] A failed dependency write shows the user an error
- [ ] Phase→phase links either work, or are withheld with a clear reason
- [ ] A faint italic `+ New task…` row sits under the last task of every phase,
      in the **left label gutter**
- [ ] The chart-side row body is **empty at rest** — nothing until hover
- [ ] Hovering the blank chart row shows a ghost preview bar **at the cursor's
      X position**
- [ ] Clicking either side opens the task editor prefilled with that phase
- [ ] Migration 0059 applied and verified **by query** on dev, staging and prod
- [ ] pgTAP suite 67 passing and registered in the parent-root `rls.yml`
- [ ] Undo and redo both work on a new dependency
- [ ] Behaviour identical on desktop and web

---

## Test plan (Audrey)

Do this on the **beta** first, then the **desktop app** — Part A was a
cloud-only failure, so the two are not interchangeable here.

1. **Connect two tasks.** Open a project timeline, drag from the dot on the
   right edge of one task bar onto another task bar. A dependency arrow should
   appear and stay.
2. **Reload the page.** The arrow must still be there. If it vanishes on reload,
   the write failed and the UI lied — tell me.
3. **Undo it** (then redo it). Both should work.
4. **Try connecting two phases** the same way. Tell me whether it works, or
   refuses with a clear message — either is an acceptable outcome this phase,
   silence is not.
5. **Look under the last task in each phase.** There should be a `New task…`
   row. Hover it — it should brighten. Click it — a task editor should open.
6. **Deliberately break one:** if you have a project where you only have view
   access, try the same drag. It should refuse and tell you why.
