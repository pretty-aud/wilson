// =============================================================================
// inlineSafeBlob — re-type a downloaded body before a blob: URL is made of it.
//
// 🚨 A blob: URL inherits the origin of the page that creates it, and the
// Blob's type is whatever was stored at upload: supabaseProvider writes
// `file.type` — the uploader's browser's guess, client-chosen — as the
// object's Content-Type, rabbit-files has no allowed_mime_types, and the
// receipt and invoice pickers take any file. So a receipt uploaded as
// text/html or image/svg+xml, opened with URL.createObjectURL + window.open,
// ran as script on WILSON's origin in the next money reader's tab (merge
// review C-R2-02) — on the web, beside the Supabase session in localStorage.
//
// The Local Server routes already refuse this class server-side
// (safeMediaContentType in electron/main.cjs); this is the renderer-side twin
// for the cloud path, where the body reaches the page as a Blob with no
// server in between. The list is deliberately short — what a receipt or an
// invoice actually is, and nothing a browser can execute or sniff into markup.
// Anything else is re-typed to application/octet-stream, which every browser
// downloads instead of rendering. SVG is scriptable and stays out.
//
// Callers: BudgetView.openFile (the receipt control) and
// InvoiceAttachment.handleOpen (the invoice row). receiptsAreMoney.test.js
// pins both; inlineSafeBlob.test.js pins the list.
// =============================================================================

const INLINE_SAFE_TYPE_RE = /^(image\/(png|jpe?g|gif|webp|avif)|application\/pdf)$/

/**
 * Returns `blob` unchanged when its type is one a browser renders inertly,
 * otherwise a copy of the same bytes typed application/octet-stream. A
 * missing body is returned as it came, so the caller's createObjectURL
 * throws the same TypeError it always did rather than downloading the word
 * "undefined". Parameters (`; charset=…`) are ignored when matching; case
 * is too, though the Blob constructor already lowercases what it stores.
 * @param {Blob | null | undefined} blob
 * @returns {Blob | null | undefined}
 */
export function toInlineSafeBlob(blob) {
  if (blob == null) return blob
  const type = String(blob.type || '').split(';')[0].trim().toLowerCase()
  if (INLINE_SAFE_TYPE_RE.test(type)) return blob
  return new Blob([blob], { type: 'application/octet-stream' })
}
