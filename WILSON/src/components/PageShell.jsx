import { ArrowLeft } from 'lucide-react'

// PageShell provides the orange-bar sandwich for non-DOG pages.
// transitionState drives the compress/expand animation directly on the bars.

export default function PageShell({ children, onBack, transitionState, transitionTitle }) {
  const isCompressed = transitionState === 'compressing' || transitionState === 'title-hold';
  const isAnimating = transitionState && transitionState !== 'idle';
  const contentFaded = transitionState === 'compressing' || transitionState === 'title-hold' || transitionState === 'expanding';

  const ease = 'cubic-bezier(0.4,0,0.2,1)';

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top orange bar — squeezes down when compressed */}
      <div style={{
        backgroundColor: '#ea580c',
        height: isCompressed ? 'calc(50vh - 20px)' : undefined,
        flex: isCompressed ? undefined : 1,
        flexShrink: 0,
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-end',
        minHeight: '120px',
        transition: `all 600ms ${ease}`,
      }}>
        {onBack && (
          <button
            onClick={onBack}
            className="absolute left-6 bottom-4 flex items-center gap-1.5 text-white/70 hover:text-white transition-colors"
            title="Back to Home"
            style={{ opacity: contentFaded ? 0 : 1, transition: 'opacity 250ms ease', pointerEvents: contentFaded ? 'none' : 'auto' }}
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-wide">Home</span>
          </button>
        )}
      </div>

      {/* Middle content area with spacers */}
      <div style={{
        backgroundColor: '#f4a261',
        height: isCompressed ? '40px' : undefined,
        flex: isCompressed ? undefined : undefined,
        flexShrink: isCompressed ? 0 : 0,
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        transition: `height 600ms ${ease}`,
      }}>
        {/* Title — visible when bars are compressed */}
        <span style={{
          position: 'absolute',
          color: '#fff',
          fontWeight: 'bold',
          fontSize: '14px',
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
          opacity: transitionState === 'title-hold' ? 1 : 0,
          transition: 'opacity 200ms ease',
          zIndex: 2,
        }}>
          {transitionTitle || ''}
        </span>

        {/* Page content */}
        <div style={{
          opacity: contentFaded ? 0 : 1,
          transition: 'opacity 250ms ease',
          width: '100%',
          padding: '3vh 0',
          maxHeight: '70vh',
          overflow: 'auto',
        }}>
          {children}
        </div>
      </div>

      {/* Bottom orange bar — squeezes up when compressed */}
      <div style={{
        backgroundColor: '#ea580c',
        height: isCompressed ? 'calc(50vh - 20px)' : undefined,
        flex: isCompressed ? undefined : 1,
        flexShrink: 0,
        minHeight: '120px',
        transition: `all 600ms ${ease}`,
      }} />
    </div>
  )
}
