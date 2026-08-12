// =============================================================================
// userStateWiring.test.js — Session 31.
//
// 🚨 THE ONLY TEST HERE THAT COULD HAVE CAUGHT THE LAST FIVE DEFECTS OF ITS KIND.
//
// Five features in this repo have shipped complete and been called by nothing:
// the folder tree (S27), task templates (S28), quiz history (S30),
// `setOtterAdapterMode` (still dead), and `POST /api/pet/reset`. Quiz history is
// the one worth remembering — it had a column, two adapter ops, a route mapping
// AND A PASSING UNIT TEST, for twenty sessions, over a path nothing reached.
//
// `userState.test.js` next door is a behaviour test of the mechanism. It would
// pass in full with App.jsx never importing the module. This file is the other
// half: it asserts the CALL SITES exist.
//
// A source scan is the fallback, not the first choice — but the code being
// guarded is welded into a 2,000-line component with a live Supabase client and
// four timers, so driving it is not on offer. Every assertion below therefore
// names the exact symbol it needs, so a rename fails loudly rather than
// silently passing over a moved target.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = readFileSync(join(SRC, 'App.jsx'), 'utf8')
const settingsPage = readFileSync(join(SRC, 'components/SettingsPage.jsx'), 'utf8')
const otter = readFileSync(join(SRC, 'tools/otter_v0.3.1/Otter.jsx'), 'utf8')
// Phase 3: the Create Egg path spans the renderer, the local-data layer and the
// Electron main process, and the defect lived in the seams between them.
const localData = readFileSync(join(SRC, 'lib/localData.js'), 'utf8')
const userState = readFileSync(join(SRC, 'lib/userState.js'), 'utf8')
const mainCjs = readFileSync(join(SRC, '../electron/main.cjs'), 'utf8')

describe('the per-user pet is actually reached from App.jsx', () => {
  it('imports the cloud module', () => {
    expect(app).toMatch(/import\s*\{[^}]*resolveUserPet[^}]*\}\s*from\s*'\.\/lib\/userState'/)
  })

  it('🚨 CALLS resolveUserPet — a store nothing reads looks identical to one that works', () => {
    expect(app).toMatch(/await\s+resolveUserPet\(\)/)
  })

  it('🚨 keys the cloud load on perms.userId, NOT on `authed`', () => {
    // `authed` is a boolean: it does not change when the identity under it
    // does, so an account switch would be invisible. And the pet's mount effect
    // wins the race against authentication, so a cloud read there gets nothing.
    expect(app).toMatch(/\},\s*\[perms\.ready,\s*perms\.userId\]\)/)
  })

  it('🚨 tears the pet down on sign-out', () => {
    // Without this, S31's own Sign out button is a regression: the previous
    // person's pet stays in state, keeps decaying, keeps saving, and reappears
    // for whoever signs in next.
    expect(app).toMatch(/if\s*\(!userId\)\s*\{\s*setPetData\(null\)/)
  })

  it('routes a save on whether there is a USER, not on whether this is Electron', () => {
    // window.electronAPI is true for the desktop app in cloud mode too, so
    // hasLocalServer() cannot answer "which backend" — the standing rule.
    expect(app).toMatch(/if\s*\(petUserIdRef\.current\)\s*\{[\s\S]{0,400}saveCloudPet\(/)
    expect(app).not.toMatch(/hasLocalServer\(\)[\s\S]{0,200}saveCloudPet/)
  })
})

describe('🚨 the SETTINGS half is reached too — it was DEAD on first pass', () => {
  // This block exists because the settings functions were written, unit-tested
  // and called by NOTHING, and that survived until a deliberate grep for
  // callers. Sixth instance of the shape in this repo, in the session whose own
  // brief warned about it five times, and the pet half was already guarded —
  // which is exactly why a per-feature guard is not optional.

  it('the account fills the per-device cache on sign-in', () => {
    expect(app).toMatch(/await\s+resolveUserSettings\(\)/)
    expect(app).toMatch(/await\s+mirrorSettingsToCache\(settings\)/)
  })

  it('the module is told who is signed in', () => {
    // pushSettingsToCloud no-ops on a null owner, so without this the writers
    // below would be silently inert — dead code wearing a call site.
    expect(app).toMatch(/setUserStateOwner\(userId\)/)
  })

  it('Otter.jsx pushes prompts up — it is the only writer of `prompts`', () => {
    expect(otter).toMatch(/import\s*\{\s*pushSettingsToCloud\s*\}\s*from\s*'\.\.\/\.\.\/lib\/userState'/)
    expect(otter).toMatch(/await\s+saveOtterSettings\(newSettings\);[\s\S]{0,600}await\s+pushSettingsToCloud\(\)/)
  })

  it('SettingsPage pushes agent prompt overrides up — the only writer of those', () => {
    expect(settingsPage).toMatch(/import\s*\{\s*pushSettingsToCloud\s*\}\s*from\s*'\.\.\/lib\/userState'/)
    expect(settingsPage).toMatch(/await\s+saveAgentSkills\(next\)[\s\S]{0,400}await\s+pushSettingsToCloud\(\)/)
  })
})

describe('the 30-second whole-object auto-save is gone', () => {
  it('🚨 no live setInterval re-saves the whole pet', () => {
    // It is the clobber itself: two signed-in computers each running it
    // overwrite one another every half minute, which is the jitter Audrey
    // asked to have removed. The commented-out corpse in the source is
    // deliberate documentation — this asserts no LIVE one came back.
    const live = app
      .split('\n')
      .filter(l => !l.trimStart().startsWith('//'))
      .join('\n')
    expect(live).not.toMatch(/petSaveTimerRef\.current\s*=\s*setInterval/)
    expect(live).not.toMatch(/setInterval\([\s\S]{0,120}savePet\(p\)/)
  })

  it('material transitions persist instead', () => {
    expect(app).toMatch(/petMaterialSignature\(/)
    expect(app).toMatch(/petPersistedSigRef/)
  })

  it('🚨 BOTH load paths prime the signature rather than saving — asserted by COUNT', () => {
    // Otherwise opening the app is a write again — the exact behaviour that
    // made "open WILSON on the second computer" a clobbering event.
    //
    // ⚠️ THIS ASSERTION WAS WEAKER AND A BREAKER RUN CAUGHT IT. It used to be a
    // bare `toMatch`, which passes as long as ONE priming site survives — so
    // swapping the mount effect's prime for `savePet(fresh)` left the guard
    // green while restoring the clobber. There are exactly two load paths (the
    // cached mount read and the cloud resolve) and BOTH must prime, so the
    // count is the property, not the presence.
    const primes = app.match(/petPersistedSigRef\.current\s*=\s*petMaterialSignature\(fresh\)/g) || []
    expect(primes).toHaveLength(2)
    expect(app).not.toMatch(/savePet\(fresh\)/)
  })

  it('🚨 the mount effect no longer stamps a fresh lastUpdatedAt', () => {
    // That line destroyed the decay anchor on every launch, which is also why
    // lastUpdatedAt could never order two devices' pets.
    expect(app).not.toMatch(/pet\.lastUpdatedAt\s*=\s*new Date\(\)\.toISOString\(\)/)
  })
})

describe('sign-out', () => {
  it('🚨 is scoped to this device', () => {
    // Unscoped signOut() is a GLOBAL revoke of every refresh token the person
    // holds. Audrey is a platform operator AND a workspace admin running two
    // accounts in two browsers; an unscoped sign-out from Settings would drop
    // her operator console minutes later with nothing connecting the two.
    expect(app).toMatch(/supabase\.auth\.signOut\(\{\s*scope:\s*'local'\s*\}\)/)
  })

  it('🚨 has a reachable control in Settings, not just a window function', () => {
    // `window.wilsonSignOut` has existed since S30 with exactly one caller —
    // the MFA enrolment gate, reachable only by an admin without 2FA.
    expect(settingsPage).toMatch(/import\s+SessionSection\s+from\s+'\.\/settings\/SessionSection'/)
    expect(settingsPage).toMatch(/<SessionSection\s*\/>/)
  })

  it('the control lives on the identity tab beside password and 2FA', () => {
    expect(settingsPage).toMatch(/<MfaSecuritySection\s*\/>[\s\S]{0,400}<SessionSection\s*\/>/)
  })
})

describe('failures are representable', () => {
  it('a failed pet LOAD is reported, not swallowed', () => {
    // loadPet was the one localData function S30 left with neither a res.ok
    // check nor a reported catch. A failed load renders as "the pet is gone".
    expect(app).not.toMatch(/catch\s*\{\s*\/\*\s*silent — server may not be ready yet\s*\*\/\s*\}/)
  })

  // 🚨 REMOVED, Phase 3 2026-08-12: `it('creating a new egg after a death is
  // not a silent no-op')`, whose whole body was
  //     expect(app).toMatch(/A new egg could not be created/)
  //
  // It was GREEN throughout the outage it was written to prevent. The string
  // was in the file; the message had no renderer on the page that hosts the
  // button, and the throw that produced it fired on a per-device store the
  // account had never written. A literal's presence is not a behaviour.
  //
  // The behaviour is now tested for real in petLifecycle.test.js (executable,
  // with failing controls). What remains HERE is what only a source scan can
  // see: that App.jsx and SettingsPage are wired to it.
})

describe('Phase 3 — Create Egg is decided by the ACCOUNT pet and reported on Settings', () => {
  it('🚨 no longer imports newPetEgg — the per-device gate is gone for good', () => {
    // This is the regression that matters most: newPetEgg() asked localStorage
    // or the Express pet.json whether the pet was a ghost. Both are per-device,
    // and an offline death is written to NEITHER.
    // Matched as an IMPORT and as a CALL, not as a bare word — the comment in
    // handleNewPet names it deliberately, to say why it is gone.
    expect(app).not.toMatch(/import[^\n]*\bnewPetEgg\b/)
    expect(app).not.toMatch(/(?:await\s+|=\s*)newPetEgg\s*\(/)
    expect(localData).not.toMatch(/export\s+async\s+function\s+newPetEgg/)
  })

  it('🚨 gates on the pure predicate, not on a store read', () => {
    expect(app).toMatch(/import\s*\{[^}]*canCreateNewEgg[^}]*\}\s*from\s*'\.\/lib\/petLifecycle'/)
    expect(app).toMatch(/if\s*\(!canCreateNewEgg\(current\)\)/)
  })

  it('🚨 mints the egg from the pet in state, so the carry-over comes from the account', () => {
    expect(app).toMatch(/const\s+current\s*=\s*petData/)
    expect(app).toMatch(/mintEggFrom\(current\)/)
  })

  it('🚨 the outcome reaches SettingsPage — the page the button is on', () => {
    // The old error went to `petSaveError`, whose ONLY renderer is the
    // companion chat panel, which navigateTo force-closes on every page change.
    expect(app).toMatch(/<SettingsPageWithAgent[\s\S]{0,900}newPetStatus=\{newPetStatus\}/)
    expect(settingsPage).toMatch(/newPetStatus/)
  })

  it('🚨 SettingsPage actually RENDERS the message, not just receives it', () => {
    // A prop that is destructured and never used is the shape of every
    // no-caller defect in this repo.
    expect(settingsPage).toMatch(/newPetStatus\.message/)
  })

  it('reports success too, so "nothing happened" is never the success case either', () => {
    expect(app).toMatch(/setNewPetStatus\(\s*saved/)
  })

  it('cannot be fired twice while a save is in flight', () => {
    // ⚠️ This asserted `disabled={newPetPending}` on the button, and BOTH that
    // and a guard on the `newPetPending` STATE were vacuous: the batch that
    // sets pending also installs the egg, so isGhost goes false and the button
    // unmounts, and a second click dispatched before the re-render reads the
    // same stale `false` from the closure. The ref is the only real guard.
    expect(app).toMatch(/if\s*\(newPetPendingRef\.current\)\s*return/)
    expect(app).toMatch(/newPetPendingRef\.current\s*=\s*true/)
    expect(settingsPage).not.toMatch(/disabled=\{newPetPending\}/)
  })

  it('🚨 the save QUEUE is the tested module, not hand-rolled in this file again', () => {
    // Two hand-rolled versions of the in-flight guard shipped in one session and
    // both reported success for a write that had not happened. The behaviour now
    // lives in lib/coalescingSave.js and is covered by real tests there —
    // WHICH caller gets WHICH result is not observable in source text, which is
    // exactly why both defects survived a regex.
    expect(app).toMatch(/import\s*\{\s*createCoalescingSave\s*\}\s*from\s*'\.\/lib\/coalescingSave'/)
    expect(app).toMatch(/createCoalescingSave\(/)
    // Matched as USE (`.current`), not as a bare word — the comment in App.jsx
    // names both deliberately, to say where they went.
    expect(app).not.toMatch(/petSavingRef\.current/)
    expect(app).not.toMatch(/petPendingRef\.current/)
  })

  it('🚨 the epoch guard does not abandon the settings half of the sign-in effect', () => {
    // Returning early on a stale epoch skipped resolveUserSettings and
    // mirrorSettingsToCache, and the effect is keyed [perms.ready,
    // perms.userId] so there is no second chance for that session.
    expect(app).toMatch(/const\s+stillCurrent\s*=\s*!cancelled\s*&&\s*pet\s*&&\s*epoch\s*===\s*petEpochRef\.current/)
    expect(app).toMatch(/if\s*\(stillCurrent\)\s*\{[\s\S]{0,1400}\}\s*[\s\S]{0,400}await\s+resolveUserSettings\(\)/)
  })

  it('🚨 the cache mirror stays gated on `adopted`', () => {
    // Making it unconditional wrote applyOfflineDecay's decayed hunger against
    // the ORIGINAL lastUpdatedAt, so the next launch decayed the same interval
    // again and the pet drifted dead-ward on every sign-in.
    expect(app).toMatch(/if\s*\(adopted\)\s*await\s+mirrorPetToCache\(fresh\)/)
  })

  it('the Create Egg result is cleared on navigation', () => {
    expect(app).toMatch(/transitionRef\.current\s*=\s*true;[\s\S]{0,400}setNewPetStatus\(null\)/)
  })

  it('🚨 the desktop route that arbitrated an account decision is gone', () => {
    // A per-device Express route must not answer an account-scoped question.
    expect(mainCjs).not.toMatch(/'\/api\/pet\/new-egg'/)
    // ...and while we were here: /api/pet/reset never had a caller at all.
    expect(mainCjs).not.toMatch(/'\/api\/pet\/reset'/)
    // The cache routes stay — loadPet/savePetData still use them.
    expect(mainCjs).toMatch(/'\/api\/pet'/)
  })

  it('🚨 a deliberate new egg is REAL, so a device cache cannot overwrite it', () => {
    // isRealPet() called every egg "not real", so another computer's stale dead
    // pet was uploaded over the egg Audrey had just created.
    //
    // ⚠️ TWO WRONG FIXES WERE TRIED FIRST, both by reordering resolveUserPet to
    // let ANY existing cloud row win. That is false: savePet writes whatever it
    // is handed, and five ordinary controls — the Pet Mode toggle, difficulty,
    // Reset History, a companion thumbs-up, and PETTING THE EGG — run while the
    // pet is still a blank egg. One click on a second computer would have
    // permanently shadowed the real pet on the first.
    //
    // The distinction belongs in isRealPet, where "is this nothing yet?" is
    // already decided: a deliberate egg carries the dead pet's history.
    expect(userState).toMatch(/pet\.feedback\)\s*&&\s*pet\.feedback\.length\s*>\s*0/)
    expect(userState).toMatch(/pet\.totalThumbsUp\s*\|\|\s*0\)\s*>\s*0/)
    // The ORDER stays S31's: a real cloud pet first, then local adoption.
    expect(userState).toMatch(/if\s*\(isRealPet\(cloud\)\)\s*return[\s\S]{0,900}if\s*\(isRealPet\(local\)\)/)
  })

  it('🚨 the BUTTON and the ACTION ask the same question — the original drift', () => {
    // The bug in one line: SettingsPage showed the control for `ghost ||
    // corpse` while newPetEgg() demanded `form === 'ghost'` exactly. Two
    // hand-written copies of one rule, drifted apart, so a corpse was offered a
    // button that could only refuse. Both sides now call canCreateNewEgg.
    expect(settingsPage).toMatch(/import\s*\{\s*canCreateNewEgg\s*\}\s*from\s*'\.\.\/lib\/petLifecycle'/)
    // ⚠️ This is asserted POSITIVELY on purpose. A `not.toMatch` on the old
    // inlined form list fails against the COMMENT that explains why the list is
    // gone — the third time in this session a negative source assertion matched
    // its own documentation. Pin what the code must SAY, not what it must not
    // mention: if anyone re-inlines the list, this equality stops holding.
    expect(settingsPage).toMatch(/const\s+isGhost\s*=\s*canCreateNewEgg\(petData\)/)
    expect(app).toMatch(/if\s*\(!canCreateNewEgg\(current\)\)/)
  })

  it('an egg is never labelled starving', () => {
    // Every egg is minted with hunger 0, and the hunger ladder rendered that in
    // RED as "STARVING" — so a brand-new egg announced that it was dying, to
    // the one person whose pet had just died.
    expect(app).toMatch(/if\s*\(pet\.form\s*===\s*'egg'\)\s*return\s*'content'/)
  })

  it('🚨 a pristine local egg is never seeded into the account', () => {
    // Every blank row seeded was one more not-real state to misread.
    expect(userState).not.toMatch(/if\s*\(local\)\s*\{\s*await\s+saveCloudPet\(local\)/)
    expect(userState).toMatch(/if\s*\(local\)\s*return\s*\{\s*pet:\s*local/)
  })
})
