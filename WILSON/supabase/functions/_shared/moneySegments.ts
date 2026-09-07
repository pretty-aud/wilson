// =============================================================================
// _shared/moneySegments.ts — Session 37
//
// The Deno-side copy of 0042's money-segment vocabulary, for the
// storage-presign function's refusal-in-depth. The ONE definition is
// public.rabbit_money_segment (migration 0042):
//
//   SELECT coalesce(upper(seg) IN ('INVOICES', 'FINANCE'), false);
//
// Deno cannot call into a SQL function without a round trip per presign, so
// this is the reservedObjects.ts treatment: a deliberate REDEFINITION across
// the boundary, pinned by src/tools/rabbit_v0.1.0's vitest both cross-copy
// (this list === the segments in 0042's SQL text) and literally (=== the two
// strings, so two identical wrong copies still fail). Case-insensitive
// because rabbit_money_segment is upper()-folded — a presign gate that
// recognised only one casing would sign exactly the request 0039 closed.
//
// Do not edit alone: 0042, this file, and the pinning test move together.
// =============================================================================

/** `public.rabbit_money_segment`'s vocabulary (0042). Pinned — do not edit alone. */
export const MONEY_SEGMENTS = ['INVOICES', 'FINANCE'] as const

export function isMoneySegment(seg: string | undefined | null): boolean {
  if (typeof seg !== 'string' || seg.length === 0) return false
  const u = seg.toUpperCase()
  return (MONEY_SEGMENTS as readonly string[]).includes(u)
}
