// =============================================================================
// DependencyRewireModal — Track A bundle A2 (2026-09-06), Audrey's ruling 7.
//
// The "are you sure" before a dependency re-wire on the timeline. Mounted by
// TimelineView's DetailPane, which owns the gesture and decides when to show
// it (the same ownership shape as AssetStatusWarningModal / ProjectAssetsView
// and PhaseExtendModal / DetailBar).
//
// It states which edge is being replaced and by what, and says plainly that
// the old link is removed before the new one is saved — that is the loss the
// confirm does NOT prevent (docs/OUTSTANDING.md keeps the atomicity entry),
// and hiding it would make the modal a false promise.
//
// Merged over the UI overhaul (2026-09-29): the kit Dialog at the confirm
// width, on lane B4's warning anatomy (`rb-warn-`, rabbitFiles.css — the
// sibling AssetStatusWarningModal's), portalled into <body> as that one is
// (the kit Dialog does not portal, and `position: fixed` inside the
// timeline's scroll container is at the mercy of any transformed ancestor —
// R1 of Track A A2). The kit brings the backdrop, Escape and the focus trap on
// the modal stack; closing by any of them is "Keep old link", which writes
// nothing. Every word and both buttons are unchanged.
// =============================================================================

import { createPortal } from 'react-dom'
import { AlertTriangle, ArrowRight, Undo2, Link2 } from 'lucide-react'
import { Dialog, Button } from '../../../ui'
import '../views/rabbitFiles.css'

// The timeline listens for mousedown to start drags, and React events bubble
// through a portal to the React ancestors: a press on this dialog's backdrop
// must not reach the gantt (the A2 session 1 lesson).
const stop = (e) => e.stopPropagation()

export default function DependencyRewireModal({ description, onConfirm, onCancel }) {
  if (!description) return null
  const { kindLabel, predName, oldName, newName } = description
  const node = (
    <div onMouseDown={stop} onClick={stop}>
      <Dialog
        width="confirm"
        aria-label="Replace this dependency?"
        title={(
          <span className="rb-warn-title">
            <AlertTriangle className="rb-warn-icon" aria-hidden="true" />
            Replace this dependency?
          </span>
        )}
        dismissOnBackdrop
        onClose={onCancel}
        footer={(
          <>
            <Button Icon={Undo2} onClick={onCancel}>
              Keep old link
            </Button>
            <Button variant="primary" Icon={Link2} onClick={onConfirm}>
              Replace link
            </Button>
          </>
        )}
      >
        <div className="rb-warn-body">
          <p className="rb-warn-msg">
            The {kindLabel} link from <span className="rb-warn-name">{predName}</span> will move from
          </p>
          <div className="rb-warn-tasks">
            <div className="rb-warn-list">
              <div className="rb-warn-task">
                <span className="rb-warn-task-title">
                  <s>{predName}</s> <ArrowRight className="w-3 h-3" aria-hidden="true" /> <s>{oldName}</s>
                </span>
                <StatusWord>Old</StatusWord>
              </div>
              <div className="rb-warn-task">
                <span className="rb-warn-task-title">
                  <span className="rb-warn-name">{predName}</span> <ArrowRight className="w-3 h-3" aria-hidden="true" /> <span className="rb-warn-name">{newName}</span>
                </span>
                <StatusWord>New</StatusWord>
              </div>
            </div>
          </div>
          <p className="rb-warn-msg">
            The old link is removed before the new one is saved. If the new link is refused
            — for instance because it already exists — the old one is already gone, and the
            timeline's "Not saved" strip will say so.
          </p>
        </div>
      </Dialog>
    </div>
  )
  return typeof document === 'undefined' ? node : createPortal(node, document.body)
}

// The row's tag, on the Label step in the third ink as the list's own header
// is (rb-warn-tasks-head), without that class's box: the sheet's rb-warn-tag
// (merge review round 1, A-R1-03 — this file is registered in the lane's
// guard, rabbitFilesCss.test.js, and writes no style).
function StatusWord({ children }) {
  return <span className="rb-warn-tag">{children}</span>
}
