// MothPersonalPanel.jsx — MO1 (MOTH_DESIGN §1.10, her answer 3, verbatim "Yes, say so"): adding files to your own
// personal space. Petal and own-bucket companies upload as Files does. On an office server the desktop copies
// the file to your folder there, then tells the catalogue, and the dialog says that is where it goes.
import { useRef, useState } from 'react'
import { Banner, Button } from '../../../ui'
import GatedAction from '../../../permissions/GatedAction'

export const OFFICE_SERVER_SENTENCE = 'In this company, your personal space keeps its files on the office server.'
export const FROM_THE_DESKTOP_SENTENCE = 'Add files to your personal space from the desktop app'
export const NOT_ON_THIS_STORAGE_SENTENCE = 'This company keeps its files in a folder on one computer, so a personal space cannot hold files here.'

export default function MothPersonalPanel({ island, gate, onDesktop, onOfficeServer, cannotHoldFiles = false, onAdd }) {
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refused = (onOfficeServer && !onDesktop) || cannotHoldFiles
  const reason = cannotHoldFiles ? NOT_ON_THIS_STORAGE_SENTENCE : FROM_THE_DESKTOP_SENTENCE

  const add = async (event) => {
    const picked = [...(event.target.files || [])]
    event.target.value = ''
    if (picked.length === 0) return
    setBusy(true)
    setError('')
    try {
      await onAdd(island, picked)
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="moth-personal" data-moth-personal>
      {(onOfficeServer || cannotHoldFiles) && <p className="moth-quiet" data-moth-office-sentence>{refused ? reason : OFFICE_SERVER_SENTENCE}</p>}
      {error && <Banner tone="danger">{error}</Banner>}
      <input ref={input} type="file" multiple hidden onChange={add} data-moth-add-input />
      <GatedAction allowed={gate.allowed && !refused} reason={refused ? reason : gate.reason}>
        <Button onClick={() => input.current?.click()} loading={busy} loadingLabel="Adding…" disabled={!gate.allowed || refused}>Add files</Button>
      </GatedAction>
    </div>
  )
}
