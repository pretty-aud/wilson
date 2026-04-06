// ============================================================
// Rate Card — page (stub for Commit 1; real shell in Commit 2)
// ============================================================
// This file is replaced in Commit 2 with the full importer + table.
// For Commit 1 it just provides a registered route so the Home
// submenu has somewhere to navigate to without breaking the build.

import { DollarSign } from 'lucide-react'

export default function RateCardPage() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="flex items-center gap-3 text-stone-900">
        <DollarSign className="w-6 h-6" />
        <span className="font-bold text-sm tracking-widest uppercase">Rate Card</span>
      </div>
    </div>
  )
}
