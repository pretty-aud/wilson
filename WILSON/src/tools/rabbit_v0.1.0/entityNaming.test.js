// entityNaming.test.js — Session 25.
//
// These pin the naming BEHAVIOUR that was extracted from ScenesView.jsx, not
// the extraction itself. The reason they matter: the produced string is
// PERSISTED as scenes.name, so a change here does not merely re-render — it
// makes every future scene disagree with every existing one, and S26 will
// name folders from the same strings.
//
// Written against the pre-extraction behaviour deliberately, so that if the
// refactor changed anything the tests fail rather than ratifying the change.

import { describe, it, expect } from 'vitest'
import {
  formatSceneCode, formatShotCode,
  nextSceneNumber, nextShotNumber,
  fileSlugify,
} from './entityNaming'

describe('formatSceneCode', () => {
  it('builds CODE{sep}SC{padded}', () => {
    expect(formatSceneCode({ project_code: 'WLSN' }, 1)).toBe('WLSN_SC001')
    expect(formatSceneCode({ project_code: 'WLSN' }, 42)).toBe('WLSN_SC042')
  })

  it('falls back to PROJ when no code is set', () => {
    // A blank code must not produce "_SC001".
    expect(formatSceneCode({}, 1)).toBe('PROJ_SC001')
    expect(formatSceneCode({ project_code: '' }, 1)).toBe('PROJ_SC001')
    expect(formatSceneCode(null, 1)).toBe('PROJ_SC001')
  })

  it('honours the separator and digit settings', () => {
    expect(formatSceneCode(
      { project_code: 'AB', scene_separator: '-', scene_digits: 2 }, 7,
    )).toBe('AB-SC07')
  })

  it('treats scene_digits of 0 as a real choice, not as unset', () => {
    // `??` not `||`. With `||` this would silently pad to 3 and the setting
    // would appear to do nothing.
    expect(formatSceneCode({ project_code: 'AB', scene_digits: 0 }, 7))
      .toBe('AB_SC7')
  })

  it('does not truncate a number wider than the padding', () => {
    expect(formatSceneCode({ project_code: 'AB', scene_digits: 2 }, 1234))
      .toBe('AB_SC1234')
  })
})

describe('formatShotCode', () => {
  it('builds CODE{sep}SC{n}{sep}SH{n} with independent digit settings', () => {
    expect(formatShotCode({ project_code: 'WLSN' }, 1, 1))
      .toBe('WLSN_SC001_SH0001')
    expect(formatShotCode(
      { project_code: 'AB', scene_digits: 2, shot_digits: 3 }, 5, 9,
    )).toBe('AB_SC05_SH009')
  })

  it('uses the same separator in both positions', () => {
    expect(formatShotCode({ project_code: 'AB', scene_separator: '.' }, 1, 2))
      .toBe('AB.SC001.SH0002')
  })
})

describe('nextSceneNumber', () => {
  it('starts at the project start number when there are no scenes', () => {
    expect(nextSceneNumber([], {})).toBe(1)
    expect(nextSceneNumber([], { scene_start_number: 10 })).toBe(10)
    expect(nextSceneNumber(undefined, { scene_start_number: 0 })).toBe(0)
  })

  it('takes max + 1, not count + 1', () => {
    // The distinction that matters: deleting a middle scene must not make the
    // next one collide with an existing scene.
    const scenes = [{ scene_number: 1 }, { scene_number: 2 }, { scene_number: 5 }]
    expect(nextSceneNumber(scenes, {})).toBe(6)
  })

  it('ignores scenes with no number', () => {
    const scenes = [{ scene_number: 3 }, { scene_number: null }, { name: 'x' }]
    expect(nextSceneNumber(scenes, {})).toBe(4)
  })

  it('falls back to the start number when no scene carries a number', () => {
    expect(nextSceneNumber([{ scene_number: null }], { scene_start_number: 7 }))
      .toBe(7)
  })
})

describe('nextShotNumber', () => {
  it('numbers per scene, from the shots passed in', () => {
    expect(nextShotNumber([{ shot_number: 1 }, { shot_number: 4 }], {})).toBe(5)
  })

  it('seeds from scene_start_number — there is no shot_start_number', () => {
    // Pinned deliberately. If a shot-specific start setting is ever added,
    // this test fails and forces the decision to be made explicitly rather
    // than silently renumbering every project's shots.
    expect(nextShotNumber([], { scene_start_number: 100 })).toBe(100)
  })
})

describe('fileSlugify', () => {
  it('title-cases and hyphenates', () => {
    expect(fileSlugify('opening sequence')).toBe('Opening-Sequence')
    expect(fileSlugify('THE BIG ONE')).toBe('The-Big-One')
  })

  it('strips punctuation rather than encoding it', () => {
    expect(fileSlugify('Scene #3: "the fall"')).toBe('Scene-3-The-Fall')
  })

  it('collapses whitespace and trims', () => {
    expect(fileSlugify('  a   b  ')).toBe('A-B')
  })

  it('survives null and empty input', () => {
    // main.cjs passes `scene?.name || 'Untitled-Scene'`, but the renderer copy
    // was reached with undefined; returning '' beats throwing inside a render.
    expect(fileSlugify(null)).toBe('')
    expect(fileSlugify('')).toBe('')
    expect(fileSlugify('!!!')).toBe('')
  })
})
