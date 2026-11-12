// =============================================================================
// workspaceSlug — the one definition of a workspace slug's shape, plus the
// lenient reader that turns whatever a person types into one.
//
// A slug is part of sign-in and is immutable once created (0020's trigger),
// so both halves matter: SLUG_RE is what the server will accept, and
// slugifyWorkspace is what lets someone type "Acme Studios" on the login
// screen and still reach `acme-studios`.
//
// ⚠️ `src/admin/CompaniesSection.jsx` still carries its own inline copy of
// both. It was left alone deliberately in Session 43 — that is the operator
// console, and this session's scope was the app's auth surface. Point it here
// the next time the console is touched, rather than adding a third copy.
// =============================================================================

// Mirrors the server: supabase/functions/resolve-login/index.ts isValidSlug
// and operator-workspaces/index.ts SLUG_RE. 2–63 chars, starts alphanumeric.
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/

// Postel's Law: liberal in what we accept, conservative in what we send.
// Applied on SUBMIT, never on every keystroke — slugifying as the user types
// turns "Acme " into "acme-" under their cursor and fights them.
// ⚠️ The NFKD pass matters: without it this and the operator console's inline
// derivation disagree on any non-ASCII name. The console does
// `.normalize('NFKD').replace(/[^\w\s-]/g, '')`, which folds "Björn" to
// "bjorn"; a bare `[^a-z0-9]+ -> '-'` gives "bj-rn". A company created with
// every default accepted would then be unreachable from the login screen.
// Stripping the combining marks here makes both derivations agree.
export function slugifyWorkspace(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}
