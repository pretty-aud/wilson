// MothFirstVisit.jsx — MO2: "What do you want to map?" (her ruling, the brief §12a.3): on the very first visit,
// and whenever the new-view button is pressed. Simple: two quick starts across every project the person can see,
// projects as islands, or a view built from what shows as dots and which lines join them.
import { useState } from 'react'
import { Button, Chip, Dialog } from '../../../ui'
import { DOT_CHOICES, LINE_CHOICES } from '../state/mothViewState.js'

export default function MothFirstVisit({ first, onChoose, onClose }) {
  const [building, setBuilding] = useState(false)
  const [dots, setDots] = useState(['project', 'folder', 'file'])
  const [lines, setLines] = useState(['lives_in'])
  const toggle = (list, k) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k])
  return (
    <Dialog
      title="What do you want to map?"
      width="form"
      onClose={onClose}
      footer={building ? (
        <>
          <Button variant="ghost" onClick={() => setBuilding(false)}>Back</Button>
          <Button onClick={() => onChoose('unsaved', { nodeKinds: dots, edgeKinds: lines, layout: 'force' })} disabled={dots.length === 0} data-moth-start-build>Map it</Button>
        </>
      ) : (
        <Button variant="ghost" onClick={onClose}>{first ? 'Not now' : 'Cancel'}</Button>
      )}
    >
      {!building && (
        <div className="moth-starts" data-moth-starts>
          <button type="button" className="moth-start" onClick={() => onChoose('q:tags')} data-moth-start="q:tags">
            <span className="moth-start-title">Everything by tags</span>
            <span className="moth-quiet">Every file you can see, gathered around its tags.</span>
          </button>
          <button type="button" className="moth-start" onClick={() => onChoose('q:folders')} data-moth-start="q:folders">
            <span className="moth-start-title">Everything by folders</span>
            <span className="moth-quiet">Each project an island, its folders branching out.</span>
          </button>
          <button type="button" className="moth-start" onClick={() => setBuilding(true)} data-moth-start="build">
            <span className="moth-start-title">Build your own</span>
            <span className="moth-quiet">Choose what shows as dots and which lines join them.</span>
          </button>
        </div>
      )}
      {building && (
        <div className="moth-view-show">
          <p className="moth-label">Dots</p>
          <div className="moth-chips">
            {DOT_CHOICES.map(([k, words]) => {
              // Tags show with their files (MO2a R1-13): without Files there is no tag to draw.
              const needsFiles = k === 'tag' && !dots.includes('file')
              return (
                <Chip key={k} active={dots.includes(k) && !needsFiles} disabled={needsFiles}
                  title={needsFiles ? 'Tags show with their files.' : undefined}
                  onClick={() => setDots((was) => { const next = toggle(was, k); return k === 'file' && !next.includes('file') ? next.filter((x) => x !== 'tag') : next })}>
                  {words}
                </Chip>
              )
            })}
          </div>
          <p className="moth-label">Lines</p>
          <div className="moth-chips">
            {LINE_CHOICES.map(([k, words]) => <Chip key={k} active={lines.includes(k)} onClick={() => setLines(toggle(lines, k))}>{words}</Chip>)}
          </div>
        </div>
      )}
    </Dialog>
  )
}
