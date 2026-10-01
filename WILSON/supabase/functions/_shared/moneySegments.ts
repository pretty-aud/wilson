// =============================================================================
// _shared/moneySegments.ts — Session 37
//
// The Deno-side copy of the locked-folder vocabulary, for the
// storage-presign function's refusal-in-depth. The ONE definition is
// public.rabbit_money_segment (migration 0042; LEGAL joined it in 0088,
// post-overhaul S4b — legal documents, "same as money files"):
//
//   SELECT coalesce(upper(seg) IN ('INVOICES', 'FINANCE', 'LEGAL'), false);
//
// Deno cannot call into a SQL function without a round trip per presign, so
// this is the reservedObjects.ts treatment: a deliberate REDEFINITION across
// the boundary, pinned by src/tools/rabbit_v0.1.0's vitest both cross-copy
// (this list === the segments in the LATEST migration that defines the
// function — 0088 today) and literally (=== the three strings, so two
// identical wrong copies still fail). Case-insensitive
// because rabbit_money_segment is upper()-folded — a presign gate that
// recognised only one casing would sign exactly the request 0039 closed.
//
// Do not edit alone: the migration, this file, and the pinning test move together.
// Deploying storage-presign after a change here is Audrey's step (sessions never deploy).
// =============================================================================

/** `public.rabbit_money_segment`'s vocabulary (0042 + 0088). Pinned — do not edit alone. */
export const MONEY_SEGMENTS = ['INVOICES', 'FINANCE', 'LEGAL'] as const

export function isMoneySegment(seg: string | undefined | null): boolean {
  if (typeof seg !== 'string' || seg.length === 0) return false
  const u = seg.toUpperCase()
  return (MONEY_SEGMENTS as readonly string[]).includes(u)
}
