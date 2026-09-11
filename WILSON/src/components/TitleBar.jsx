import { useEffect } from 'react';

export default function TitleBar() {
  const isElectron = !!window.electronAPI;

  // Add class to <html> so CSS can offset fixed overlays below the title bar
  useEffect(() => {
    if (isElectron) {
      document.documentElement.classList.add('electron-app');
    }
  }, [isElectron]);

  if (!isElectron) return null;

  const btnBase = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '46px',
    height: '32px',
    border: 'none',
    background: 'transparent',
    color: '#fff',
    cursor: 'pointer',
    WebkitAppRegion: 'no-drag',
  };

  return (
    <div className="wilson-chrome" style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: '32px',
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      WebkitAppRegion: 'drag',
    }}>
      {/* Minimize */}
      <button
        style={btnBase}
        onClick={() => window.electronAPI.minimize()}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <svg width="10" height="1" viewBox="0 0 10 1">
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </button>

      {/* Maximize / Restore */}
      <button
        style={btnBase}
        onClick={() => window.electronAPI.maximize()}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>

      {/* Close */}
      <button
        style={{ ...btnBase, borderRadius: '0' }}
        onClick={() => window.electronAPI.close()}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#e81123'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
          <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}
