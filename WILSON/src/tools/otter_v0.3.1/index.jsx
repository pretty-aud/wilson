// F4 (2026-11-13): O.T.T.E.R.'s root under React.memo; it was a bare re-export.
// App renders for reasons of its own (a hover on the nav strip, the six steps
// of a page transition, a notice) and handed O.T.T.E.R. to React each time. It
// hands O.T.T.E.R. three props: `onNavigate` (one function for as long as the
// page on screen is the same), the page's name and `onContextChange` (a state
// setter). With the same three, O.T.T.E.R. is not run again.
// App.rerender.test.jsx holds the count.
import { memo } from 'react'
import Otter from './Otter'

export default memo(Otter)
