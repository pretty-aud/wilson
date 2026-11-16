// =============================================================================
// The Range header (design §5 step 6): `bytes=a-b`, `bytes=a-`, `bytes=-n` →
// 206 with Content-Range; a multi-range request → 416 (no multipart bodies);
// no Range → 200, the whole file, counted like any other; an unsatisfiable
// range → 416. No ETag, no Last-Modified, no If-Range: nothing is cacheable,
// so a conditional range never arises.
//
// GW2's reading for what the design does not list: a Range header that is
// present but is not exactly one well-formed `bytes=` range (another unit,
// letters, a missing dash, numbers past 2^53) is a 416 too. RFC 9110 lets a
// server ignore such a header and send 200; a browser never sends one, and
// answering garbage with the whole file is the costlier choice.
// =============================================================================

const DIGITS = /^\d{1,16}$/;

/**
 * @param {string|undefined} header the request's Range header
 * @param {number} size the file's size in bytes
 * @returns {{ status: 200, start: 0, end: number, length: number }
 *         | { status: 206, start: number, end: number, length: number }
 *         | { status: 416, reason: string }}
 *   end is inclusive; for an empty file a 200 has end -1 and length 0.
 */
export function planRange(header, size) {
  if (!Number.isSafeInteger(size) || size < 0) return { status: 416, reason: 'size' };
  if (header === undefined || header === null) return { status: 200, start: 0, end: size - 1, length: size };
  if (typeof header !== 'string') return { status: 416, reason: 'malformed' };
  const h = header.trim();
  if (!h.toLowerCase().startsWith('bytes=')) return { status: 416, reason: 'unit' };
  const spec = h.slice(6).trim();
  if (spec.includes(',')) return { status: 416, reason: 'multi' };
  const dash = spec.indexOf('-');
  if (dash < 0 || spec.indexOf('-', dash + 1) >= 0) return { status: 416, reason: 'malformed' };
  const a = spec.slice(0, dash).trim();
  const b = spec.slice(dash + 1).trim();
  if (a === '' && b === '') return { status: 416, reason: 'malformed' };
  if ((a !== '' && !DIGITS.test(a)) || (b !== '' && !DIGITS.test(b))) return { status: 416, reason: 'malformed' };
  if (a === '') {
    // bytes=-n: the last n bytes
    const n = Number(b);
    if (n === 0 || size === 0) return { status: 416, reason: 'unsatisfiable' };
    const start = Math.max(0, size - n);
    return { status: 206, start, end: size - 1, length: size - start };
  }
  const start = Number(a);
  if (start >= size) return { status: 416, reason: 'unsatisfiable' };
  if (b === '') return { status: 206, start, end: size - 1, length: size - start };
  const last = Number(b);
  if (last < start) return { status: 416, reason: 'malformed' };
  const end = Math.min(last, size - 1);
  return { status: 206, start, end, length: end - start + 1 };
}

/** `bytes a-b/size` for a 206; `bytes *\/size` for a 416. */
export function contentRange(plan, size) {
  return plan.status === 206 ? `bytes ${plan.start}-${plan.end}/${size}` : `bytes */${size}`;
}
