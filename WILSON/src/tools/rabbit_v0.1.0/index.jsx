// RABBIT v0.1.0 — barrel export.
// Session 1 scaffold: Rabbit.jsx is an empty placeholder; real shell lands in Session 3.
//
// F4 (2026-11-13): the shell under React.memo; it was a bare re-export. App
// renders for reasons of its own (a hover on the nav strip, the six steps of a
// page transition, a notice) and handed the shell to React each time. It hands
// it three props: `onNavigate` (one function for as long as the page on screen
// is the same), `isActive` and the page's name. With the same three, the shell
// is not run again by App. (What the shell reads from its provider still runs
// it: that is the provider's value, not App.) App.rerender.test.jsx holds the
// count.
import { memo } from 'react';
import Rabbit from './Rabbit.jsx';

export default memo(Rabbit);
