// LeaverFilesDialog.jsx — MO1 (her integration answer 2, verbatim "Yes, once they've left"): an admin moves a former
// member's personal files into a project. The list is the server's (moth_leaver_files), so nothing here decides
// what may move, or who has left: no money, no Legal, and nothing while the person is an active member. It is the
// same checked move as M.O.T.H.'s, recorded in the admin activity list.
//
// A copy is made first, and removed if the commit refuses, so a file is never without a body. A commit whose answer
// is lost is not a refusal: the row may name that copy already, so it stays.
import { useState } from 'react'
import { Banner, Button, Dialog } from '../../ui'

export const CANNOT_MOVE_FROM_HERE = 'One of these files cannot be moved from here, so nothing moved.'

export default function LeaverFilesDialog({ adapter, files, projects, onClose, onMoved }) {
  const [picked, setPicked] = useState(() => new Set())
  const [dest, setDest] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const toggle = (id) => setPicked((was) => {
    const next = new Set(was)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  async function move() {
    if (busy) return
    setBusy(true)
    setError('')
    const ids = files.filter((f) => picked.has(f.id)).map((f) => f.id)
    const made = []
    const removeCopies = async () => { for (const item of made) await adapter.removeMoveCopy?.(item) }
    try {
      const plan = await adapter.planLeaverMove(ids, dest)
      // Only what this dialog can carry out. Anything else would be recorded as moved with the file left behind.
      if ((plan?.items ?? []).some((i) => i.how !== 'rehome' && i.how !== 'metadata' && i.how !== 'none')) {
        throw new Error(CANNOT_MOVE_FROM_HERE)
      }
      const bodies = []
      try {
        for (const item of (plan?.items ?? []).filter((i) => i.how === 'rehome')) {
          bodies.push(await adapter.copyBodyForMove(files.find((f) => f.id === item.id), item))
          made.push(item)
        }
      } catch (err) {
        await removeCopies()
        throw err
      }
      try {
        await adapter.moveLeaverFiles(ids, dest, bodies.length ? bodies : null)
      } catch (err) {
        if (err?.code) {
          await removeCopies()
          throw err
        }
        onMoved()
        setError('WILSON could not tell whether these moved. Look in the project before trying again.')
        setBusy(false)
        return
      }
      onMoved()
      onClose()
    } catch (err) {
      setError(err?.message || String(err))
      setBusy(false)
    }
  }

  return (
    <Dialog
      width="confirm"
      title="Move files to a project"
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={move} disabled={!dest || picked.size === 0} loading={busy} loadingLabel="Moving…">Move</Button>
        </>
      )}
    >
      {error && <Banner tone="danger">{error}</Banner>}
      <p>This person has left the company. A move is recorded in the admin activity list. Invoices and Legal files stay where they are, and so does anything only on their computer or in their folder on the office server.</p>
      <label>
        To{' '}
        <select value={dest} onChange={(e) => setDest(e.target.value)}>
          <option value="">Choose a project…</option>
          {projects.map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}
        </select>
      </label>
      <ul>
        {files.map((file) => (
          <li key={file.id}>
            <label>
              <input type="checkbox" checked={picked.has(file.id)} onChange={() => toggle(file.id)} />
              {' '}{file.name}
            </label>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
