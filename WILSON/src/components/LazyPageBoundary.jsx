// LazyPageBoundary.jsx — MO1 (whole-session review round 1): a lazily loaded page that cannot load, or that throws
// while drawing, says so in its own place. Suspense handles only the wait: with nothing here a window open across
// a deploy, whose old chunk now answers 404, loses every tool and any unsaved work with it.
import { Component } from 'react'
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
    return (
      <Banner tone="danger" data-lazy-page-failed>
        <p>{this.props.title} could not open.</p>
        <Button variant="ghost" size="sm" onClick={this.props.onRetry}>Try again</Button>
        {/* After a deploy this window's page names a chunk that has gone, and only a reload learns the new name. */}
        <Button variant="ghost" size="sm" onClick={this.props.onReload ?? (() => window.location.reload())}>Reload the page</Button>
      </Banner>
    )
  }
}
