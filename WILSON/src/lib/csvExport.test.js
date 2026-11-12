import { describe, it, expect } from 'vitest'
import { csvCell, toCsv, exportDateStamp } from './csvExport'

describe('csvCell', () => {
  it('passes plain values through', () => {
    expect(csvCell('hello')).toBe('hello')
    expect(csvCell(42)).toBe('42')
    expect(csvCell(true)).toBe('true')
  })

  it('renders null/undefined as empty', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('quotes fields with commas, quotes and newlines (RFC 4180)', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
  })

  it('guards spreadsheet formula injection in strings', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"')
    expect(csvCell('+SUM(A1)')).toBe("'+SUM(A1)")
    expect(csvCell('@cmd')).toBe("'@cmd")
    expect(csvCell('-2+3')).toBe("'-2+3")
  })

  it('leaves numeric values and numeric-looking strings intact', () => {
    expect(csvCell(-5)).toBe('-5')
    expect(csvCell('-5')).toBe('-5')
    expect(csvCell('-5.25')).toBe('-5.25')
  })

  it('serializes objects as JSON', () => {
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"')
  })

  it('serializes Date as a bare ISO string (no embedded quotes)', () => {
    expect(csvCell(new Date('2026-07-30T00:00:00.000Z'))).toBe('2026-07-30T00:00:00.000Z')
  })
})

describe('toCsv', () => {
  it('uses the column spec: headers, order, mappers', () => {
    const csv = toCsv(
      [{ id: 1, name: 'A', role: { slug: 'artist' } }],
      [
        { key: 'name', header: 'Name' },
        { key: 'role', header: 'Role', map: (r) => r.role?.slug },
      ],
    )
    expect(csv).toBe('﻿Name,Role\r\nA,artist\r\n')
  })

  it('infers the column union in first-seen order when no spec given', () => {
    const csv = toCsv([{ a: 1 }, { b: 2, a: 3 }])
    expect(csv).toBe('﻿a,b\r\n1,\r\n3,2\r\n')
  })

  it('emits a header-only file for zero rows', () => {
    expect(toCsv([], [{ key: 'x' }])).toBe('﻿x\r\n')
  })
})

describe('exportDateStamp', () => {
  it('formats YYYY-MM-DD with padding', () => {
    expect(exportDateStamp(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
