import { getPage } from './pages';

// One page wrapper for all twelve pages (F2). The scroll class and the focus
// / caret / selection scope both come from the registry's `surface`, so the
// scroll classes stop doing double duty as the surface scope (F1 hand-off §7)
// and a page cannot be dark in one and light in the other.
//
// 🚨 Module level, NOT inside App. A component declared inside a render is a
// new type on every render, so React unmounts and remounts its subtree — and
// the entire reason every page is rendered at once is to PRESERVE that state.
// (It lived in App.jsx until FX15 moved it here, beside the registry, so a
// test can render the shell's own wrapper; App renders it as before.)
//
// The page's main region (post-overhaul FX15, OUTSTANDING FX14-03). Before
// FX15 only D.O.G. and O.T.T.E.R. drew a <main>, so on every other page a
// screen reader's landmark list had no main, and the kit toast's focus return
// (src/ui/Toast.jsx, `toastFocusReturn`) had nowhere to put focus once the
// element it came from was gone: Chromium put it on <body>, measured on
// R.A.B.B.I.T. and Team members (scripts/fx15-landmarks-names.mjs). Now the
// wrapper IS the main region, except on a page whose tool draws its own (the
// registry's `ownMain`: D.O.G.'s `.dog-main`, O.T.T.E.R.'s column), where it
// stays a div so the page holds exactly one. A page not on screen is hidden
// by display, as before, and carries the `hidden` attribute too: the landmark
// list never counts it (display: none already keeps it out of the
// accessibility tree), and the document holds one main without `hidden`, as
// HTML asks. The two tools mark their own the same way (`hidden` off their
// page). The region wears the kit's focus ring when focus is given to it,
// on every page (Audrey, 2026-10-27: "Keep it everywhere"); since DG3 it is
// drawn inside the region's own box (index.css, `main:focus-visible`), where
// no page's `overflow: hidden` cuts it (OUTSTANDING FX15-03).
export default function PageSurface({ id, currentPage, overflow = 'auto', children }) {
  const page = getPage(id);
  const Region = page.ownMain ? 'div' : 'main';
  return (
    <Region
      className={page.surface === 'dark' ? 'wilson-dark-scroll' : 'wilson-light-scroll'}
      data-surface={page.surface}
      hidden={currentPage !== id}
      style={{ display: currentPage === id ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow }}
    >
      {children}
    </Region>
  );
}
