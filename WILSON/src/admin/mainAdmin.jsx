// =============================================================================
// mainAdmin.jsx — Session 15: entry point for the Platform Operator Console
// (/wilsonadmin, locked #18).
//
// A SEPARATE React root from src/main.jsx, deliberately. src/App.jsx mounts
// every WILSON page at once and syncs the URL against its own route table —
// under /wilsonadmin/ that table would happily map /wilsonadmin/dog and
// /wilsonadmin/otter to the tools. The console is a different audience, a
// different tier and a different session; it gets its own tree.
//
// No Sentry init here: the console is operator-only infrastructure with no
// end users to report for, and every consequential action it takes already
// certificates itself into public.platform_audit.
// =============================================================================

import React from 'react'
import ReactDOM from 'react-dom/client'
import OperatorApp from './OperatorApp'
import '../index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <OperatorApp />
  </React.StrictMode>,
)
