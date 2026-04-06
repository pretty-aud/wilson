// ============================================================
// RABBIT v0.1 — top-level shell (stub for Commit 1)
// ============================================================
// Commit 1 only registers RABBIT in App.jsx so the Home menu has
// a destination. The real RabbitPage shell (header + ProjectPicker
// + ViewTabs + view router + activeTool wiring) lands in Commit 6.

import { ListChecks } from 'lucide-react'

export default function Rabbit() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="flex items-center gap-3 text-stone-900">
        <ListChecks className="w-6 h-6" />
        <span className="font-bold text-sm tracking-widest uppercase">R.A.B.B.I.T.</span>
      </div>
    </div>
  )
}
