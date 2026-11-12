// =============================================================================
// inlineSafeBlob.test.js — merge review C-R2-02.
//
// The helper is the whole fix: a receipt or invoice body reaches the page as a
// Blob whose type the uploader's browser chose, and a blob: URL of it runs on
// WILSON's origin. Executable, not a source pin — the bytes are read back so
// a "safe" copy that dropped the body would fail here, not in a tab.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { toInlineSafeBlob } from './inlineSafeBlob'

const INERT = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/avif', 'application/pdf']

// Everything a browser will execute, or sniff into markup when it is handed a
// type it half-recognises. Empty is the type an unknown extension uploads as.
const RUNNABLE = [
  'text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/xml',
  'application/xml', 'text/javascript', 'application/javascript',
  'text/plain', 'application/octet-stream', 'application/pdf+xml', '',
]

describe('toInlineSafeBlob', () => {
  it('passes an inert image or PDF body through as the same object', () => {
    for (const type of INERT) {
      const blob = new Blob(['x'], { type })
      expect(toInlineSafeBlob(blob), type).toBe(blob)
    }
  })

  it('re-types anything a browser could run or sniff into markup', () => {
    for (const type of RUNNABLE) {
      const out = toInlineSafeBlob(new Blob(['<script>1</script>'], { type }))
      expect(out.type, JSON.stringify(type)).toBe('application/octet-stream')
    }
  })

  it('keeps the bytes it re-types', async () => {
    const out = toInlineSafeBlob(new Blob(['<svg onload="1"/>'], { type: 'image/svg+xml' }))
    expect(await out.text()).toBe('<svg onload="1"/>')
    expect(out.size).toBe('<svg onload="1"/>'.length)
  })

  it('matches on the media type alone — parameters and case do not open the door', () => {
    // The Blob constructor lowercases the type it stores but keeps parameters,
    // so `TEXT/HTML; charset=utf-8` arrives as `text/html; charset=utf-8`.
    expect(toInlineSafeBlob(new Blob(['x'], { type: 'TEXT/HTML; charset=utf-8' })).type).toBe('application/octet-stream')
    expect(toInlineSafeBlob(new Blob(['x'], { type: 'image/svg+xml; charset=utf-8' })).type).toBe('application/octet-stream')
    // …and a parameter on an inert type does not close it.
    const pdf = new Blob(['%PDF'], { type: 'application/pdf; charset=binary' })
    expect(toInlineSafeBlob(pdf)).toBe(pdf)
  })

  it('does not turn a missing body into a nine-byte download', () => {
    // downloadFile returning nothing used to reach createObjectURL and throw a
    // TypeError the caller reports; `new Blob([undefined])` would instead
    // download the text "undefined". The helper leaves a missing body alone.
    expect(toInlineSafeBlob(undefined)).toBeUndefined()
    expect(toInlineSafeBlob(null)).toBeNull()
  })

  it('never lets the two scriptable image types through, whatever the list says', () => {
    // The one rule the list must keep even if it grows: SVG scripts, and
    // XHTML is HTML with an XML face.
    expect(toInlineSafeBlob(new Blob(['x'], { type: 'image/svg+xml' })).type).toBe('application/octet-stream')
    expect(toInlineSafeBlob(new Blob(['x'], { type: 'application/xhtml+xml' })).type).toBe('application/octet-stream')
  })
})
