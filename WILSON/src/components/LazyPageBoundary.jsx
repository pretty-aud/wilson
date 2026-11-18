// LazyPageBoundary.jsx — MO1 (whole-session review round 1): a lazily loaded page that cannot load, or that throws
// while drawing, says so in its own place. Suspense handles only the wait: with nothing here a window open across
// a deploy, whose old chunk now answers 404, loses every tool and any unsaved work with it.
//
// F11 (the review's shared-client C3): LazyPart, below, is the same shape for a PART of a page that loads on its
// first open (the migration panels in Settings, the Admin terminal's sections, the Notes editor). The pages stay
// mounted at once (handbook §13.4); only these parts wait for their first open. On a light page the sentence takes
// the kit's light treatment (`surface="light"`); everywhere else it is drawn exactly as before.
import { Component, Suspense, lazy, useMemo, useState } from 'react'
import { Banner, Button } from '../ui'

export default class LazyPageBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    // A ghost button on a light ground hovers to a pale ink (MfaSection's R2 note), so a light page takes the
    // secondary variant; a dark one keeps what it had.
    const light = this.props.surface === 'light'
    const onLight = light ? { surface: 'light' } : {}
    const variant = light ? 'secondary' : 'ghost'
    return (
      <Banner tone="danger" data-lazy-page-failed {...onLight}>
        <p>{this.props.title} could not open.</p>
        <Button variant={variant} size="sm" {...onLight} onClick={this.props.onRetry}>Try again</Button>
        {/* After a deploy this window's page names a chunk that has gone, and only a reload learns the new name. */}
        <Button variant={variant} size="sm" {...onLight} onClick={this.props.onReload ?? (() => window.location.reload())}>Reload the page</Button>
      </Banner>
    )
  }
}

// What each loader answered, once it has (keyed by the loader function itself).
const loadedParts = new WeakMap()

/**
 * A part of a page loaded on its first draw, held by the boundary above: MothSurface's shape (App.jsx), once.
 *
 * @param {object} props
 * @param {() => Promise<any>} props.load  the dynamic import(s): one module, or Promise.all of several. Read
 *   again only on Try again (lazy() remembers a failed load, so a retry takes a new one).
 * @param {string} props.title    the part's name in "<title> could not open."
 * @param {string} props.waiting  the one line drawn in its place while it loads
 * @param {'light'|'dark'} [props.surface]  the page's ground, for the sentence's treatment
 * @param {(loaded: any) => import('react').ReactNode} props.children  draws the part from what loaded
 */
export function LazyPart({ load, title, waiting, surface, children }) {
  const [attempt, setAttempt] = useState(0)
  // `load` is read once per attempt: a call site's inline arrow is a new function at every draw, and a new lazy()
  // per draw would load again and lose the part's state.
  const Loaded = useMemo(() => lazy(() => Promise.resolve().then(load).then((loaded) => {
    loadedParts.set(load, loaded)
    return { default: function LazyPartLoaded({ draw }) { return draw(loaded) } }
  })), [attempt]) // eslint-disable-line react-hooks/exhaustive-deps
  // Review round 1 (1B): a part drawn again after it has loaded once (Settings mounts its Storage tab's body anew at
  // each visit) is drawn at once from what loaded, with no waiting line; the loaders are module-level functions.
  // Decided once, when this part is first drawn: switching paths later would remount it and lose its state.
  const [already] = useState(() => loadedParts.get(load))
  if (already && attempt === 0) {
    return (
      <LazyPageBoundary key={attempt} title={title} surface={surface} onRetry={() => setAttempt((n) => n + 1)}>
        {children(already)}
      </LazyPageBoundary>
    )
  }
  return (
    <LazyPageBoundary key={attempt} title={title} surface={surface} onRetry={() => setAttempt((n) => n + 1)}>
      <Suspense fallback={<p data-lazy-part-waiting>{waiting}</p>}>
        <Loaded draw={children} />
      </Suspense>
    </LazyPageBoundary>
  )
}
