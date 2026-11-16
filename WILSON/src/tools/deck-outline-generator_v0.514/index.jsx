// F4 (2026-11-13): D.O.G.'s root under React.memo; it was a bare re-export.
// App renders for reasons of its own (a hover on the nav strip, the six steps
// of a page transition, a notice) and handed D.O.G. to React each time. It
// hands D.O.G. three props: `onNavigate` (one function for as long as the page
// on screen is the same), the page's name and the zoom level. With the same
// three, D.O.G. is not run again. App.rerender.test.jsx holds the count.
import { memo } from 'react'
import DeckOutlineGenerator from './DeckOutlineGenerator'

export default memo(DeckOutlineGenerator)
