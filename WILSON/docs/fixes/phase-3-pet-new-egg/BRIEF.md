# PHASE 3 — "CREATE EGG" DOES NOTHING AFTER A PET DIES

> **Audrey, 2026-08-10, verbatim:**
> *"pet issue - for audrey, the pet, tomithy, died. i went to the systems
> settings page to create a new egg. i pressed the button, i got the
> confirmation pop up, i confirmed, and nothing happened. please make sure to
> allow the user to do this in any computer on either the web app or desktop
> app. remember all functionality should be the same in both versions of the
> app. please make sure this button is working please"*
>
> ✅ **No open questions. This phase can start immediately.**
> ✅ **No migration.**

---

## Root cause — two faults stacked

Both are confirmed in code. Either one alone would produce the reported symptom;
together they guarantee it.

### Fault 1 — the ghost check reads the wrong source of truth

`newPetEgg()` in `src/lib/localData.js`:

```js
export async function newPetEgg() {
  if (hasLocalServer()) {
    const res = await fetch('/api/pet/new-egg', { method: 'POST' })
    if (!res.ok) throw new Error('Pet must be a ghost to create new egg')
    return res.json()
  }
  const old = readLocal(PET_KEY, null)
  if (!old || old.form !== 'ghost') {
    throw new Error('Pet must be a ghost to create new egg')
  }
  ...
}
```

Both branches read a **per-device** store — `localStorage` on the web, the
in-app Express server on desktop.

But **Session 31 made the pet follow the person.** There is one pet row per
person, on the account. Tomithy is a ghost **on Audrey's account**. The device
copy is either absent (a machine she has not used before, or one where
localStorage was cleared) or stale (a snapshot from before he died).

So `old` is `null`, or `old.form !== 'ghost'`, and it throws. Every time, on
every machine whose local copy has drifted.

Note the comment already on `handleNewPet` in `src/App.jsx`, which describes the
intended flow: *"newPetEgg writes to the per-device store; the new egg is then
promoted to the account by savePet."* Writing per-device and promoting is fine.
**Gating** per-device is the bug.

⚠️ **`hasLocalServer()` gates on `window.electronAPI`:**

```js
export function hasLocalServer() {
  return typeof window !== 'undefined' && !!window.electronAPI
}
```

🚨 This is the trap the repo has already recorded: **never gate on
`window.electronAPI` to pick a store — it is true whenever WILSON is a desktop
app, *including cloud mode*.** So the desktop app in cloud mode asks the local
Express server about a pet that lives in Supabase.

### Fault 2 — the error was raised where Audrey could not see it

`handleNewPet` does report the failure:

```js
} catch (err) {
  setPetSaveError(err?.message || 'A new egg could not be created.');
}
```

But `petSaveError` is consumed in exactly one place — `src/components/PetCompanion.jsx`,
inside the pet chat panel. **Nothing on the System Settings page renders it.**

Audrey pressed "Create Egg" on Settings, the throw fired, the message was set
into state that no visible component reads, and the dialog closed. That is the
"nothing happened".

⚠️ There is a live test at `src/lib/userStateWiring.test.js` asserting
*"creating a new egg after a death is not a silent no-op"* by matching
`/A new egg could not be created/` in `App.jsx`. **It passes.** The string is
there. The test pins the string's existence, not that a user can ever see it.
Do not treat its green as coverage.

---

## What to change

### 1. Gate on the account pet, not the device pet

`handleNewPet` in `App.jsx` already holds the authoritative pet in `petData` —
that is what renders the ghost Audrey is looking at. The ghost check belongs
there, against `petData.form`, before `newPetEgg()` is called.

`newPetEgg()` should then mint and persist the egg without re-deciding
eligibility from a store it should not be consulting. Keep the account promotion
(`savePet`) exactly as it is — that half works.

🚨 **Preserve the carry-over.** The current implementation copies `difficulty`,
`feedback`, `totalThumbsUp` and `totalThumbsDown` from the old pet onto the new
egg. Audrey's feedback history is the pet's memory of her; losing it is a
regression she will notice immediately. Carry it from the **account** pet, since
that is now the source.

### 2. Make the failure visible on the Settings page

Whatever the outcome, pressing "Create Egg" must produce a visible result. Add
an error surface to `SettingsPage.jsx` near the pet controls, fed by the same
`petSaveError`.

⚠️ **Do not simply move the error out of `PetCompanion.jsx`** — it is doing real
work there for the save path. Both surfaces need it.

### 3. Verify desktop and web behave identically

This is the explicit ask. The same button, on the same account, must work on:

- the web app (beta), on a machine that has never held this pet locally
- the desktop app in cloud mode
- the desktop app in local mode

🚨 **Check `POST /api/pet/new-egg` actually exists** in `electron/` and behaves
consistently. Related: `POST /api/pet/reset` is on the repo's no-caller list —
while you are in here, **enumerate the pet routes and grep each for a caller.**

---

## What NOT to change

- ❌ Do not re-introduce the 30-second pet save timer. It was deleted
  deliberately in S31 — on a shared per-user row it *was* the clobber, and
  Audrey's hunger visibly jittered between two values because of it. The comment
  above `petMaterialSignature` in `App.jsx` explains why at length.
- ❌ Do not change `petMaterialSignature` or the material-change save effect.
- ❌ Do not change the death/decay rules. Tomithy dying was correct behaviour.
- ❌ Do not remove the ghost requirement. A new egg is meant to require a death.

---

## Risks — what this could break

- 🚨 **The multi-device egg race.** S31's comment warns: *"hatch on the laptop,
  and the desktop still holding an egg writes it back within 30 seconds, so the
  adult is gone and the next hatch rolls a different breed."* Moving the source
  of truth to the account is the right direction, but check the new egg cannot
  be written back over a pet another device has already hatched. **Audrey runs
  two accounts in two browsers at once** — this will get exercised.
- **`petPersistedSigRef`.** `handleNewPet` sets it before `savePet`. If the
  ghost check moves, make sure that ref is still primed in the right order, or
  the material-change effect will either double-save or never save.
- **The local-mode path.** If `newPetEgg()` stops consulting the Express server,
  confirm local-only desktop users still get a working egg.
- ⚠️ Adding an error surface to Settings means a *previously silent* failure now
  shows a message. If the underlying fix is incomplete, Audrey will see the error
  text rather than nothing — that is an improvement, but say so in the close-out
  so it is not mistaken for a new bug.

---

## Definition of done

- [ ] With a ghost pet, "Create Egg" on System Settings produces a new egg
- [ ] The new egg persists across a reload and appears on her other machine
- [ ] `difficulty` and the full feedback history carry over from the dead pet
- [ ] A failure shows a visible message **on the Settings page**
- [ ] Works on: web app, desktop in cloud mode, desktop in local mode
- [ ] Pet routes enumerated and each confirmed to have a caller
- [ ] No pet save timer reintroduced

---

## Test plan (Audrey)

Tomithy is currently a ghost, which is exactly the state this needs.

1. **On the beta**, go to System Settings → press **Create Egg** → confirm.
   You should get an egg, immediately and visibly.
2. **Reload the page.** The egg should still be there.
3. **Open the desktop app** and check the same egg is there — the pet follows
   you, so it should not be a different pet.
4. **Pet the egg** 2–4 times until it hatches, and check the hatch modal lets
   you name it.
5. **Check the feedback carried over** — your thumbs up/down totals from
   Tomithy should still be counted, not reset to zero.
6. **If anything fails, it must now TELL you.** A silent nothing is itself a bug
   worth reporting, even if the egg eventually appears.

⚠️ If you have both browsers open with two accounts, do this in **one** of them
first and tell me which — the multi-device path is the risky one and I want to
know it worked in isolation before you exercise the race.
