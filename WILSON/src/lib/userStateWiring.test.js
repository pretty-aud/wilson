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
    // A3: it takes the owner now, because the cache it consults to decide
    // whether to ADOPT is keyed by account. Calling it with nothing would read
    // the unattributed store and put the shared-computer leak straight back.
    expect(app).toMatch(/await\s+resolveUserPet\(userId\)/)
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
    // A3 reads the ref into `owner` first, because the same value now has to
    // reach mirrorPetToCache as the cache key. The property is unchanged: the
    // branch is "is there a signed-in user", never "is this Electron".
    expect(app).toMatch(/const\s+owner\s*=\s*petUserIdRef\.current;[\s\S]{0,200}if\s*\(owner\)\s*\{[\s\S]{0,400}saveCloudPet\(/)
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

describe('A3 — the anchor travels with the values it describes', () => {
  it('🚨 performPetSave no longer stamps a fresh anchor on every save', () => {
    // It used to write `{ ...data, lastUpdatedAt: new Date().toISOString() }`,
    // so a Pet Mode toggle from a window sitting on a week-old copy still
    // claimed its hunger was true AT THAT INSTANT. That makes migration 0068's
    // stale-write guard INERT — the stale window's anchor is always the
    // fresher one, so it always wins. A guard that can never fire is worse
    // than no guard, because it reads like protection.
    //
    // The property is that the stamp is CONDITIONAL. `const next = { ...data,
    // lastUpdatedAt: now }` is the unconditional shape that has to be gone; the
    // same literal survives as the ternary's fallback arm, for a pet object
    // that somehow carries no anchor at all (a hand-edited cache).
    expect(app).not.toMatch(/const\s+next\s*=\s*\{\s*\.\.\.data,\s*lastUpdatedAt:/)
    expect(app).toMatch(/const\s+next\s*=\s*data\.lastUpdatedAt\s*\n?\s*\?\s*data\s*\n?\s*:\s*\{\s*\.\.\.data,\s*lastUpdatedAt:/)
  })

  it('🚨 and every mutation that MOVES hunger or happiness stamps one', () => {
    // The other half. If the save stops stamping and the handlers do not start,
    // decay is written against an anchor that never advances and every cold
    // start re-applies the same interval — the pet drifts dead-ward.
    //
    // Counted, not merely present: feeding, hatching, waking and petting are
    // four separate object literals and one of them losing the field is exactly
    // the kind of edit a `toMatch` cannot see.
    //
    // 🚨 R1: THE COUNT WAS BLIND TO THE ONE SITE IT NAMED. It matched the
    // colon form only, so hatching — which is an ASSIGNMENT,
    // `next.lastUpdatedAt = …` — was never counted, and two of the five
    // matches were a comment and performPetSave's fallback arm. Deleting the
    // hatch stamp left every assertion in this block green (measured). Comment
    // lines are stripped, both forms are counted, and hatching gets its own
    // anchored assertion like the other three.
    const live = app
      .split('\n')
      .filter(l => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
      .join('\n')
    const stamps = live.match(/lastUpdatedAt(:| =) new Date\(\)\.toISOString\(\)/g) || []
    expect(stamps.length).toBeGreaterThanOrEqual(6)
    expect(live).toMatch(/hunger: Math\.min\(100, prev\.hunger \+ 25\)[\s\S]{0,200}lastUpdatedAt: new Date\(\)/)
    expect(live).toMatch(/happiness: Math\.min\(100, prev\.happiness \+ 20\)[\s\S]{0,200}lastUpdatedAt: new Date\(\)/)
    expect(live).toMatch(/sleepingSince: null[\s\S]{0,200}lastUpdatedAt: new Date\(\)/)
    // Hatching: the site the count could not see.
    expect(live).toMatch(/next\.hunger = 80;[\s\S]{0,300}next\.lastUpdatedAt = new Date\(\)\.toISOString\(\);/)
    // And the resume transition, which R1 found defeats ruling 6 without it.
    expect(live).toMatch(/if\s*\(enabled\s*&&\s*prev\.petMode\s*===\s*false\)\s*\{\s*\n\s*next\.lastUpdatedAt = new Date\(\)\.toISOString\(\);/)
  })

  it('🚨 a thumbs-DOWN does not move the anchor', () => {
    // It changes the feedback array and no number, so it re-sends the anchor it
    // holds and 0068 accepts it as an equal. Stamping there would let a rating
    // from a stale window count as "this copy is newer" — the clobber wearing a
    // different hat.
    //
    // 🚨 R1: "within 400 characters AFTER the +5 line" is not "inside the
    // block". Moving the stamp OUT of the `if (rating === 'up' …)` arm — the
    // exact defect this names — left the assertion true (measured). The
    // property is containment, so the block is sliced out and asserted on.
    const from = app.indexOf("if (rating === 'up' && prev.petMode")
    expect(from).toBeGreaterThan(-1)
    const rest = app.slice(from)
    const block = rest.slice(0, rest.indexOf('\n      }') + 8)
    expect(block).toMatch(/next\.lastUpdatedAt = new Date\(\)\.toISOString\(\);/)
    // ...and the statement immediately after the block is not one.
    expect(rest.slice(block.length, block.length + 200))
      .not.toMatch(/next\.lastUpdatedAt = new Date\(\)/)
  })
})

describe('A3 — 0068\'s refusal is a re-read, never a retry', () => {
  it('🚨 recognises the refusal through the shared predicate', () => {
    // Matching the message text here instead would rot the moment the message
    // is reworded, and the failure mode is silent: the refusal would be
    // reported as an ordinary save failure and the stale copy left on screen.
    expect(app).toMatch(/import\s*\{[^}]*isStalePetWrite[^}]*\}\s*from\s*'\.\/lib\/userState'/)
    expect(app).toMatch(/if\s*\(isStalePetWrite\(err\)\)/)
  })

  it('🚨 re-reads the account instead of retrying the write', () => {
    expect(app).toMatch(/isStalePetWrite\(err\)[\s\S]{0,900}await\s+fetchCloudPet\(\)/)
    // The failing control: no retry of the save that was just refused.
    expect(app).not.toMatch(/isStalePetWrite\(err\)[\s\S]{0,600}saveCloudPet\(/)
  })

  it('🚨 says so on a surface that does not need the pet to be rendering', () => {
    // The existing banner lives inside PetCompanion's chat popup, and App
    // renders PetCompanion as `{petData && …}` — so it is invisible in exactly
    // the two cases that need it: a stale copy being replaced, and a failed
    // LOAD, which unmounts the only renderer of its own error message.
    expect(app).toMatch(/announcePetNotice\(\{\s*\n?\s*kind: 'info'/)
    expect(app).toMatch(/<PetNotice\s+notice=\{petNotice\}/)
    // Mounted OUTSIDE every petData gate — beside UndoToast at the root.
    expect(app).toMatch(/<UndoToast \/>[\s\S]{0,600}<PetNotice/)
    expect(app).not.toMatch(/petData && [\s\S]{0,200}<PetNotice/)
  })

  it('the load failure reaches it too — the entry that had nowhere to show itself', () => {
    expect(app).toMatch(/announcePetNotice\(\{ kind: 'error', message \}\)/)
  })
})

describe('A3 — a failed cloud read must not re-point the writes', () => {
  it('🚨 petUserIdRef is CLEARED on an identity change, not SET', () => {
    // It used to be set unconditionally, before the async read. If
    // resolveUserPet() then threw, the catch kept rendering the stale device
    // pet while savePet had already been re-pointed at the account — so any
    // interaction wrote that stale pet over the account row, with no adoption
    // decision and no staleness check. A transient Supabase blip on the second
    // computer was enough to overwrite the first computer's pet.
    expect(app).toMatch(/if\s*\(petUserIdRef\.current\s*!==\s*userId\)\s*\{/)
    expect(app).toMatch(/const\s+previousOwner\s*=\s*petUserIdRef\.current;\s*\n\s*petUserIdRef\.current\s*=\s*null;/)
    // The failing control: the unconditional assignment must be gone from the
    // effect's synchronous head.
    expect(app).not.toMatch(/const userId = perms\.userId \|\| null;\s*\n\s*petUserIdRef\.current = userId;/)
  })

  it('🚨 and is SET only after the read has landed', () => {
    // R1: gated on `pet` as well, so a resolve that yields nothing cannot
    // re-point writes at an account whose pet is not on screen.
    expect(app).toMatch(/await\s+resolveUserPet\(userId\);[\s\S]{0,300}if\s*\(!cancelled\s*&&\s*pet\)\s*petUserIdRef\.current\s*=\s*userId;/)
  })
})

describe('A3/R1 — the corrections round 1 found', () => {
  it('🚨 a signed-in user is never told a save landed when it went nowhere', () => {
    // The failed-cloud-read state leaves petUserIdRef null on purpose. The
    // first version then fell through to savePetData(next, null), writing the
    // UNATTRIBUTED store — which the account arm of loadPet never reads again
    // — and returned true. Silently discarded, reported as saved, and left on
    // a shared computer for the next signed-out launcher.
    expect(app).toMatch(/\}\s*else if\s*\(getUserStateOwner\(\)\)\s*\{/)
    expect(app).toMatch(/import\s*\{[^}]*getUserStateOwner[^}]*\}\s*from\s*'\.\/lib\/userState'/)
    // The local branch survives for the genuinely signed-out case.
    expect(app).toMatch(/\}\s*else\s*\{\s*\n\s*await savePetData\(next, owner\);/)
  })

  it('🚨 an identity change clears the PET, not only the routing', () => {
    // petData was blanked only when userId was falsy, so an A → B switch with
    // no signed-out state in between left A's pet on screen with B's routing.
    expect(app).toMatch(/if\s*\(previousOwner\)\s*setPetData\(null\);/)
  })

  it('🚨 the sticky Settings notice is a SECOND state, not the toast\'s', () => {
    // One state rendered twice meant dismissing the toast erased the durable
    // surface at the same instant, and the prop comment said the opposite.
    expect(app).toMatch(/const \[petNoticeSticky, setPetNoticeSticky\] = useState\(null\)/)
    expect(app).toMatch(/petNotice=\{petNoticeSticky\}/)
    expect(app).toMatch(/<PetNotice notice=\{petNotice\}/)
    // Cleared on sign-out and on a later successful save, and nowhere else.
    expect(app).toMatch(/setPetNoticeSticky\(null\);/)
    expect(app).toMatch(/setPetNoticeSticky\(n => \(n && n\.kind === 'error' \? null : n\)\)/)
  })

  it('🚨 the notice is cleared on sign-out, like the two channels beside it', () => {
    const signOut = app.slice(app.indexOf('window.wilsonSignOut = async'))
    const body = signOut.slice(0, signOut.indexOf('welcomePlayedRef.current = false'))
    expect(body).toMatch(/setPetNotice\(null\);/)
    expect(body).toMatch(/setPetNoticeSticky\(null\);/)
  })

  it('🚨 the toast\'s dismiss handler is STABLE across renders', () => {
    // PetNotice lists onDismiss in its timer's dependency array. A fresh arrow
    // restarted the ten-second timer on every App render, and the dream-cloud
    // effect re-renders App every few seconds — so the documented dismissal
    // only landed when a gap happened to exceed ten seconds.
    expect(app).toMatch(/const dismissPetNotice = useCallback\(\(\) => setPetNotice\(null\), \[\]\)/)
    expect(app).not.toMatch(/onDismiss=\{\(\) => setPetNotice\(null\)\}/)
  })

  it('🚨 the live tick and applyOfflineDecay read petMode the SAME way', () => {
    // `!prev.petMode` vs `pet.petMode === false` disagree for undefined: frozen
    // while the app is open, decaying while it is closed. The commit claimed
    // they mirrored each other.
    expect(app).toMatch(/if\s*\(prev\.petMode === false\) return prev;/)
    expect(app).not.toMatch(/if\s*\(!prev\.petMode\) return prev;/)
  })

  it('🚨 the Settings notice renders OUTSIDE the petData gate', () => {
    // It sat inside `{petData && (`, so on a failed LOAD — the one condition
    // this surface is credited with closing — it rendered nothing at all.
    const noticeAt = settingsPage.indexOf('{petNotice && (')
    const gateAt = settingsPage.indexOf('{/* Companion Section */}')
    expect(noticeAt).toBeGreaterThan(-1)
    expect(gateAt).toBeGreaterThan(-1)
    expect(noticeAt).toBeLessThan(gateAt)
  })

  it('🚨 a new account gets a pet — minted in userState, not by the cache', () => {
    // Keying the cache by account made the account arm answer null for every
    // first sign-in, and for one commit nothing replaced the mint the
    // unattributed store used to provide.
    expect(userState).toMatch(/import\s*\{\s*defaultPet\s*\}\s*from\s*'\.\/petLifecycle'/)
    expect(userState).toMatch(/return \{ pet: defaultPet\(\), source: 'new', adopted: false \}/)
  })
})

describe('A3 — the cached pet leaves with the person', () => {
  it('🚨 sign-out clears the account\'s cache', () => {
    // clearSession() clears the auth blob and nothing else; the pet cache
    // survived deliberately, and resolveUserPet READ it to decide adoption.
    expect(app).toMatch(/import\s*\{[^}]*clearPetCache[^}]*\}\s*from\s*'\.\/lib\/localData'/)
    expect(app).toMatch(/await\s+clearPetCache\(leavingUserId\)/)
  })

  it('🚨 and captures the owner BEFORE the teardown nulls the ref', () => {
    // Reading petUserIdRef.current after `petUserIdRef.current = null` clears
    // nothing at all, and looks completely correct.
    const signOut = app.slice(app.indexOf('window.wilsonSignOut = async'))
    const capture = signOut.indexOf('const leavingUserId = petUserIdRef.current')
    const teardown = signOut.indexOf('petUserIdRef.current = null')
    expect(capture).toBeGreaterThan(-1)
    expect(teardown).toBeGreaterThan(-1)
    expect(capture).toBeLessThan(teardown)
  })

  it('the pre-auth cache read is attributed', () => {
    // The mount effect runs before usePermissions resolves, so it reads the
    // owner out of the stored session's JWT. Without this the cache is keyed by
    // account and then read with no key, which returns nothing on every launch.
    expect(app).toMatch(/const owner = await storedSessionUserId\(\);\s*\n\s*const stored = await loadPet\(owner\);/)
  })
})

describe('A3 — the corpse promotion window is shared', () => {
  it('🚨 the live tick and the load path read ONE constant', () => {
    // The tick's setTimeout was the only thing that promoted a corpse, and the
    // load path had no idea the number existed — which is the whole of the
    // "a pet saved as a corpse never becomes a ghost" entry.
    expect(app).toMatch(/\}, CORPSE_TO_GHOST_MS\);/)
    expect(app).not.toMatch(/\}, 10000\);/)
  })
})

describe('A3 — what is stored in feedback is bounded', () => {
  it('🚨 both fields are sliced before they go into the array', () => {
    // MEASURED on wilson-dev 2026-09-07: fifty entries at the reply ceiling are
    // 219,807 bytes against user_pets' 262,144-byte CHECK, and userMsg was not
    // bounded at all. Create Egg carries the whole array into the new pet, so
    // the write most likely to trip the cap is the one taken by somebody whose
    // pet has just died.
    expect(app).toMatch(/userMsg: \(lastUser\?\.content \|\| ''\)\.slice\(0, FEEDBACK_SNIPPET_CHARS\)/)
    expect(app).toMatch(/botResponse: \(lastAssistant\.content \|\| ''\)\.slice\(0, FEEDBACK_SNIPPET_CHARS\)/)
    expect(app).toMatch(/const FEEDBACK_SNIPPET_CHARS = \d+;/)
  })

  it('🚨 and the bound leaves the fifty-entry array clear of the cap', () => {
    // The arithmetic, not a promise about it: 50 entries of two bounded strings
    // plus ~60 bytes of keys and timestamp must stay well under 262144.
    const chars = Number(app.match(/const FEEDBACK_SNIPPET_CHARS = (\d+);/)[1])
    expect(50 * (2 * chars + 80)).toBeLessThan(262144 / 2)
    // ...and it must still be comfortably more than the 60 characters the one
    // consumer actually reads, or the bound is a behaviour change in disguise.
    expect(chars).toBeGreaterThanOrEqual(240)
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
    expect(app).toMatch(/if\s*\(adopted\)\s*await\s+mirrorPetToCache\(fresh,\s*userId\)/)
  })

  it('🚨 A3 — EVERY mirror call names the account, asserted by COUNT', () => {
    // mirrorPetToCache(pet) with no owner writes the unattributed store, which
    // the account arm of loadPet() never reads again — so a dropped argument is
    // a cache that is silently never used, and the "renders instantly" promise
    // quietly stops being true. A bare toMatch would pass while one of the
    // three call sites lost its owner, so the property is the count.
    const calls = app.match(/mirrorPetToCache\(/g) || []
    const owned = app.match(/mirrorPetToCache\([A-Za-z]+,\s*[A-Za-z.]+\)/g) || []
    expect(calls.length).toBeGreaterThan(0)
    expect(owned).toHaveLength(calls.length)
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

  it('an egg is never labelled starving — the assertion MOVED, it did not go', () => {
    // 🚨 A3: derivePetState and applyOfflineDecay left App.jsx for
    // src/lib/petLifecycle.js, so this can finally be a real call instead of a
    // regex over a 2000-line component — petLifecycle.test.js now asserts
    // derivePetState({ form: 'egg', hunger: 0 }) === 'content' directly.
    //
    // What is left here is the WIRING half a behaviour test cannot see: that
    // App.jsx still gets its rules from that module rather than growing a
    // second copy. A private helper would drift from the tested one in silence.
    expect(app).toMatch(/import\s*\{[^}]*derivePetState[^}]*\}\s*from\s*'\.\/lib\/petLifecycle'/)
    expect(app).not.toMatch(/function\s+derivePetState\s*\(/)
    expect(app).not.toMatch(/function\s+applyOfflineDecay\s*\(/)
    expect(app).not.toMatch(/const\s+DECAY_RATES\s*=/)
  })

  it('🚨 a pristine local egg is never seeded into the account', () => {
    // Every blank row seeded was one more not-real state to misread.
    expect(userState).not.toMatch(/if\s*\(local\)\s*\{\s*await\s+saveCloudPet\(local\)/)
    expect(userState).toMatch(/if\s*\(local\)\s*return\s*\{\s*pet:\s*local/)
  })
})
