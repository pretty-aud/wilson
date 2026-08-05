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

  it('creating a new egg after a death is not a silent no-op', () => {
    // handleNewPet was `catch { /* silent */ }` — a green tick over a write
    // that may not have happened, taken by somebody whose pet has just died.
    expect(app).toMatch(/A new egg could not be created/)
  })
})
