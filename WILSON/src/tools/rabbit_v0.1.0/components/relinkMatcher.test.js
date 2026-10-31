import { describe, it, expect } from 'vitest'
import { matchMissingFiles, sanitizeFileName, pathBasename } from './relinkMatcher'

const row = (over = {}) => ({
  id: 'f1',
  name: 'Shot 01.png',
  storage_path: 'abc123-Shot_01.png',
  size_bytes: 1000,
  mime_type: 'image/png',
  ...over,
})

describe('sanitizeFileName', () => {
  it('mirrors the upload-side sanitizer', () => {
    expect(sanitizeFileName('Shot 01 (final)!.png')).toBe('Shot_01_final_.png')
    expect(sanitizeFileName('')).toBe('file')
    expect(sanitizeFileName(null)).toBe('file')
  })
})

describe('pathBasename', () => {
  it('handles both separators and bare names', () => {
    expect(pathBasename('a/b/c.txt')).toBe('c.txt')
    expect(pathBasename('a\\b\\c.txt')).toBe('c.txt')
    expect(pathBasename('c.txt')).toBe('c.txt')
    expect(pathBasename('')).toBe('')
  })
})

describe('matchMissingFiles', () => {
  it('matches a moved-but-unrenamed file by exact disk name', () => {
    const res = matchMissingFiles(
      [row()],
      [{ relPath: 'renders/abc123-Shot_01.png', name: 'abc123-Shot_01.png', size: 1000 }],
    )
    expect(res.proposals).toEqual([
      {
        id: 'f1',
        name: 'Shot 01.png',
        oldPath: 'abc123-Shot_01.png',
        newPath: 'renders/abc123-Shot_01.png',
        confidence: 'exact',
      },
    ])
    expect(res.ambiguous).toEqual([])
    expect(res.unmatched).toEqual([])
  })

  it('is case-insensitive (Windows filesystems)', () => {
    const res = matchMissingFiles(
      [row()],
      [{ relPath: 'ABC123-SHOT_01.PNG', name: 'ABC123-SHOT_01.PNG', size: 1000 }],
    )
    expect(res.proposals).toHaveLength(1)
    expect(res.proposals[0].confidence).toBe('exact')
  })

  it('falls back to display name + size for a re-created file', () => {
    const res = matchMissingFiles(
      [row()],
      [
        { relPath: 'Shot_01.png', name: 'Shot_01.png', size: 1000 },
        { relPath: 'other/Shot_02.png', name: 'Shot_02.png', size: 900 },
      ],
    )
    expect(res.proposals).toEqual([
      expect.objectContaining({ id: 'f1', newPath: 'Shot_01.png', confidence: 'strong' }),
    ])
  })

  it('uses size to break a same-name tie', () => {
    const res = matchMissingFiles(
      [row()],
      [
        { relPath: 'v1/Shot_01.png', name: 'Shot_01.png', size: 555 },
        { relPath: 'v2/Shot_01.png', name: 'Shot_01.png', size: 1000 },
      ],
    )
    expect(res.proposals).toEqual([
      expect.objectContaining({ newPath: 'v2/Shot_01.png', confidence: 'strong' }),
    ])
  })

  it('accepts a unique name match without a size match', () => {
    const res = matchMissingFiles(
      [row({ size_bytes: null })],
      [{ relPath: 'x/Shot_01.png', name: 'Shot_01.png', size: 42 }],
    )
    expect(res.proposals).toEqual([
      expect.objectContaining({ newPath: 'x/Shot_01.png', confidence: 'name' }),
    ])
  })

  it('a size-mismatched row cannot steal a later row\'s name+size match', () => {
    const res = matchMissingFiles(
      [
        row({ id: 'A', storage_path: 'aaa-notes.md', name: 'notes.md', size_bytes: 100 }),
        row({ id: 'B', storage_path: 'bbb-notes.md', name: 'notes.md', size_bytes: 200 }),
      ],
      [{ relPath: 'notes.md', name: 'notes.md', size: 200 }],
    )
    expect(res.proposals).toEqual([
      expect.objectContaining({ id: 'B', newPath: 'notes.md', confidence: 'strong' }),
    ])
    expect(res.unmatched).toEqual([expect.objectContaining({ id: 'A' })])
  })

  it('reports unresolvable same-name duplicates as ambiguous, never guesses', () => {
    const res = matchMissingFiles(
      [row({ size_bytes: null })],
      [
        { relPath: 'v1/Shot_01.png', name: 'Shot_01.png', size: 555 },
        { relPath: 'v2/Shot_01.png', name: 'Shot_01.png', size: 777 },
      ],
    )
    expect(res.proposals).toEqual([])
    expect(res.ambiguous).toHaveLength(1)
    expect(res.ambiguous[0].candidates).toHaveLength(2)
  })

  it('reports duplicate exact disk names as ambiguous when sizes cannot settle it', () => {
    const res = matchMissingFiles(
      [row({ size_bytes: null })],
      [
        { relPath: 'a/abc123-Shot_01.png', name: 'abc123-Shot_01.png', size: 1 },
        { relPath: 'b/abc123-Shot_01.png', name: 'abc123-Shot_01.png', size: 2 },
      ],
    )
    expect(res.proposals).toEqual([])
    expect(res.ambiguous).toHaveLength(1)
  })

  it('never claims one candidate for two rows', () => {
    const res = matchMissingFiles(
      [
        row({ id: 'f1', storage_path: 'aaa-Shot_01.png' }),
        row({ id: 'f2', storage_path: 'bbb-Shot_01.png', name: 'Shot 01.png' }),
      ],
      [{ relPath: 'aaa-Shot_01.png', name: 'aaa-Shot_01.png', size: 1000 }],
    )
    expect(res.proposals).toEqual([
      expect.objectContaining({ id: 'f1', confidence: 'exact' }),
    ])
    // f2 must NOT get f1's candidate via the name rung (sanitized display
    // name 'Shot_01.png' ≠ candidate basename 'aaa-Shot_01.png' anyway, and
    // the candidate is claimed).
    expect(res.unmatched).toEqual([
      expect.objectContaining({ id: 'f2' }),
    ])
  })

  it('lists rows with no candidate at all as unmatched', () => {
    const res = matchMissingFiles([row()], [])
    expect(res.proposals).toEqual([])
    expect(res.unmatched).toEqual([
      { id: 'f1', name: 'Shot 01.png', oldPath: 'abc123-Shot_01.png' },
    ])
  })

  it('handles empty inputs', () => {
    expect(matchMissingFiles([], [])).toEqual({ proposals: [], ambiguous: [], unmatched: [] })
    expect(matchMissingFiles(undefined, undefined)).toEqual({
      proposals: [], ambiguous: [], unmatched: [],
    })
  })

  it('keeps subfolder relPaths verbatim in proposals', () => {
    const res = matchMissingFiles(
      [row()],
      [{ relPath: 'archive/2026/abc123-Shot_01.png', name: 'abc123-Shot_01.png', size: 1000 }],
    )
    expect(res.proposals[0].newPath).toBe('archive/2026/abc123-Shot_01.png')
  })
})
