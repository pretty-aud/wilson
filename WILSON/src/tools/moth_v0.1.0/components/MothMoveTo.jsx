// MothMoveTo.jsx — MO1 (MOTH_DESIGN §1.10): where a move goes. It offers only places the caller may write, read
// from the islands; the server asks again at the commit, and its sentence is what a refusal shows.
import { useEffect, useState } from 'react'
import { Banner, Button, Dialog } from '../../../ui'

export default function MothMoveTo({ adapter, islands, files, fromProject, onMove, onClose }) {
  const places = islands.filter((row) => row.can_write)
  const [dest, setDest] = useState('')
  const [query, setQuery] = useState('')
  const [folders, setFolders] = useState([])
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setFolder('')
    setFolders([])
    if (dest) {
      Promise.resolve(adapter.listMothFolders(dest))
        .then((rows) => { if (live) setFolders(rows || []) })
        .catch(() => { if (live) setFolders([]) })
    }
    return () => { live = false }
  }, [adapter, dest])

  const go = async () => {
    setBusy(true)
    setError('')
    try {
      await onMove(files, fromProject, dest, folder || null)
      onClose()
    } catch (err) {
      setError(err?.message || String(err))
      setBusy(false)
    }
  }

  return (
    <Dialog
      width="confirm"
      title={files.length === 1 ? `Move "${files[0].name}"` : `Move ${files.length} files`}
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={go} disabled={!dest} loading={busy} loadingLabel="Moving…">Move</Button>
        </>
      )}
    >
      {error && <Banner tone="danger">{error}</Banner>}
      <label className="moth-field">
        Find a project
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a name" data-moth-dest-search />
      </label>
      <label className="moth-field">
        To
        <select value={dest} onChange={(e) => setDest(e.target.value)} data-moth-dest>
          <option value="">Choose a project…</option>
          {places.filter((row) => row.id === dest || !query.trim()
            || (row.is_mine ? 'My personal space' : String(row.title ?? '')).toLowerCase().includes(query.trim().toLowerCase())).map((row) => (
            <option key={row.id} value={row.id}>{row.is_mine ? 'My personal space' : row.title}</option>
          ))}
        </select>
      </label>
      {folders.length > 0 && (
        <label className="moth-field">
          Folder
          <select value={folder} onChange={(e) => setFolder(e.target.value)} data-moth-folder>
            <option value="">Top of the project</option>
            {folders.map((row) => <option key={row.id} value={row.id}>{row.label || row.slug}</option>)}
          </select>
        </label>
      )}
    </Dialog>
  )
}
