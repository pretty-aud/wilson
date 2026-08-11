# PHASE 5 — NO WAY TO SUBMIT A COURSE COMPANY-WIDE

> **Audrey, 2026-08-10, verbatim:**
> *"in otter, how does a user submit a course to be part of the company wide
> otter tool? i cant see anywau to submit it"*
>
> ✅ **No open questions. No migration.**
> ✅ **The answer to her question is: there is no way. She was not missing it.**

---

## Root cause — the dialog exists and nothing can open it

`ShareCourseDialog` is fully built, fully wired, and **unreachable**.

In `src/tools/otter_v0.3.1/Otter.jsx`:

```js
const [shareDialogCourse, setShareDialogCourse] = useState(null);   // initial: null
```

`setShareDialogCourse` is called in exactly two places:

| Where | Call | Effect |
|---|---|---|
| `handleCourseChanged` | `setShareDialogCourse(prev => (prev && prev.slug === row.slug ? { ...prev, ...row } : prev))` | Only mutates when the dialog is **already open** |
| The render | `onClose={() => setShareDialogCourse(null)}` | **Closes** it |

The first is guarded on `prev` being truthy, so it can never open the dialog from
`null`. The second only ever sets `null`.

**Nothing anywhere sets `shareDialogCourse` to a course.** The render is gated on
`{shareDialogCourse && (<ShareCourseDialog ... />)}`, so it never mounts.

🚨 **This is the tenth feature in this repo to ship with no caller**, after the
folder tree (S27), task templates (S28), quiz history (S30), `setOtterAdapterMode`,
`workspaces.storage_mode`, `POST /api/pet/reset`, S31's settings half, and S37's
`storageSecretClear`. The house rule exists precisely for this: **enumerate the
exports and grep each for callers before committing.**

---

## What already works, and must be reused

Do not build a new sharing mechanism. The whole thing is there below the dialog.

### The data model

`otter_courses.visibility` is `TEXT NOT NULL DEFAULT 'personal'` with:

```sql
CHECK (visibility IN ('personal', 'shared', 'company_standard'))
```

`company_standard` is the company-wide tier Audrey is asking about.

### The adapter

`supabaseOtterAdapter` already implements `course.update`, `course.fork`,
`editors.list`, `editors.add`, `editors.remove`, and the change-request trio
`cr.list` / `cr.create` / `cr.update`.

### The pattern to copy

`ChangeRequestDialog` — its immediate sibling — has a working opener. In
`Otter.jsx`, a child component receives:

```js
onOpenDialog={(sourceSlug) => {
  const course = softwareList.find(sw => sw.slug === sourceSlug);
  if (!course) return false;
  selectSoftware(sourceSlug);
  setCrDialogCourse(course);
  return true;
}}
```

**Model the share opener on this exactly.** Same lookup, same guard, same shape.

---

## What to change

### 1. Add the affordance

A course owner needs a visible way to submit their course. It belongs where a
user already acts on a course — the course row or its menu in the library, next
to the existing change-request entry.

Requirements:

- **Discoverable without being told.** Audrey looked for this and could not find
  it. A menu item buried three levels deep fails the same test again.
- **Its label should say what it does.** "Submit to company library" reads
  better than "Share" — `shared` and `company_standard` are different tiers and
  the word "share" already means the middle one.
- **Only offered to someone who can actually do it.** `role={appRole}` and
  `userId={perms.userId}` are already passed to the dialog; the affordance itself
  needs the same gate. 🚨 **A gated create button is not a gated screen** —
  withhold the action, do not grey a control that then does nothing.

### 2. Do not regress the launch-cost guard

🚨 There is a live comment immediately above the render:

> *"ShareCourseDialog mounts useWorkspaceMembers, which fires a
> `workspace_directory` RPC — that must not run for every user on every launch
> (the AdminTerminalBody lesson)."*

The dialog must stay **lazily mounted**, only when a course is selected. Do not
hoist it, do not render it hidden, do not preload the roster.

### 3. Confirm the round trip

`handleCourseChanged` merges what the server actually returned — *"NEVER what we
sent"* — and re-reads the list so `otter_course_index`'s capability flags stay
correct. Verify submitting a course flows through it, so the library reflects the
new visibility without a manual refresh.

### 4. Answer Audrey's actual question in the product

She asked *how* a user submits a course. Once the affordance exists, the flow
should be self-explanatory: what tier the course is now, who reviews it, and what
happens next. If approval is manual, say so in the dialog rather than leaving the
user wondering whether it worked.

⚠️ **If the review/approval side turns out not to exist either, stop and say so.**
Shipping a submit button with nothing on the other end would be the same defect
one layer up. Check `cr.*` and the change-request flow before assuming.

---

## What NOT to change

- ❌ Do not add a `visibility` value. The three tiers are settled schema.
- ❌ Do not modify `ShareCourseDialog` itself until you have opened it and seen
  what it actually does. It is fully written; assume it works until proven
  otherwise.
- ❌ Do not build a parallel sharing path. `course.update` and the editor/CR
  adapters are the mechanism.
- ❌ Do not eagerly mount the dialog.
- ❌ No migration. The schema is complete.

---

## Risks — what this could break

- **The roster RPC.** The single documented reason this dialog is lazily mounted.
  Getting this wrong makes every O.T.T.E.R. launch slower for every user, and it
  will not be obvious in testing with one account.
- **`handleCourseChanged` has three consumers** — `softwareList`,
  `shareDialogCourse` and `crDialogCourse` — plus the `softwareCacheRef` and
  `activeSoftware`. It was written on the assumption the share dialog is rarely
  open. Re-read it once the dialog can actually be open.
- **The change-request dialog holds its own snapshot** taken from `softwareList`
  when its menu item fired, and branches on `course.visibility` to decide whether
  to offer "also share my copy". A course whose visibility changes while both
  dialogs are reachable can desync. The existing code already patches this for
  `crDialogCourse` — verify it still holds.
- 🚨 **RLS.** Promoting a course to `company_standard` changes who can read it.
  Confirm the policy actually permits the promotion for the roles you offer the
  button to, and that a refused promotion surfaces an error rather than silently
  doing nothing. **`otterFetch` resolves for every status** — an RLS 403 will
  look like success unless the status is checked.

---

## Definition of done

- [ ] A course owner can find and use a submit affordance without being told
      where it is
- [ ] Submitting moves the course to `company_standard` and the library reflects it
- [ ] The affordance is withheld from users who cannot perform the action
- [ ] A refused or failed submission shows a real error
- [ ] `workspace_directory` still does **not** fire on O.T.T.E.R. launch
- [ ] The approval/review side is confirmed to exist, or its absence is reported
- [ ] Works identically on desktop and web
- [ ] Every new export grepped for a caller

---

## Test plan (Audrey)

1. **Open O.T.T.E.R. and look at one of your own courses.** There should now be
   a visible way to submit it to the company library. Tell me if you had to hunt
   for it — that is the whole point of this phase.
2. **Submit one.** It should confirm what happened and what comes next.
3. **Check the library.** The course should show as company-wide.
4. **Sign in as `tester` in your other browser** and confirm the submitted course
   is visible to them, and that a course you have *not* submitted is not.
5. **Try submitting as `tester`** on a course they do not own. It should either
   be unavailable or refuse with a clear reason — not fail silently.
6. **Time the O.T.T.E.R. launch.** If it feels slower to open than before this
   phase, tell me — that is the specific regression I am watching for.

⚠️ If it turns out there is nowhere for a submitted course to *go* — no review
queue, no approval step — I will report that rather than shipping a button into
a void. That answer would be part of this phase's outcome.
