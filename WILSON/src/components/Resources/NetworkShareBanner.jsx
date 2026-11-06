// NetworkShareBanner.jsx — MO1 (MOTH_DESIGN §1.9, NS-D6, NS-D9): a project whose files are listed from the company's
// office server says how old that list is and who last looked. Looking takes the desktop and the project's
// roster seat (or the owner, for a personal space); the server asks again. On opening a project the desktop
// looks by itself, at most every ten minutes.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Banner, Button } from '../../ui'
import GatedAction from '../../permissions/GatedAction'
import { fetchWorkspaceStorage } from '../../cloud/workspaceStorage'
import { createNetworkShareCatalogue, spaceFolderOf, CANNOT_READ_WHOLE } from '../../tools/rabbit_v0.1.0/state/networkShareCatalogue'
import { desktopFileOps } from '../../tools/rabbit_v0.1.0/storage/desktopFileOps'

export const FROM_THE_DESKTOP = 'Refresh from the desktop app'

export default function NetworkShareBanner({ adapter, project, canCheck, deniedReason, nameOf = () => null, onChanged = () => {} }) {
  const [root, setRoot] = useState(null)
  const [check, setCheck] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const onDesktop = desktopFileOps.available()
  const catalogue = useMemo(() => (adapter ? createNetworkShareCatalogue({ adapter }) : null), [adapter])

  useEffect(() => {
    let live = true
    Promise.resolve().then(() => fetchWorkspaceStorage()).then((row) => {
      if (live) setRoot(row?.mode === 'byos' && row?.provider === 'network' && row?.root_kind === 'unc' ? row.root_path : null)
    }).catch(() => { if (live) setRoot(null) })
    return () => { live = false }
  }, [])

  const folder = root ? spaceFolderOf(project, root) : null
  const read = useCallback(async () => {
    if (!folder || !adapter?.getNetworkShareCheck) return
    setCheck(await adapter.getNetworkShareCheck(project.id).catch(() => null))
  }, [adapter, folder, project?.id])
  useEffect(() => { read() }, [read])

  useEffect(() => {
    if (!folder || !canCheck || !onDesktop || !catalogue) return undefined
    let live = true
    catalogue.refreshOnOpen(project, { root }).then((out) => {
      if (live && !out?.skipped) { read(); onChanged() }
    })
    return () => { live = false }
    // Once per project: a refresh's own answer must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, canCheck, onDesktop, catalogue, project?.id])

  if (!folder) return null

  const refresh = async () => {
    setBusy(true)
    setNote('')
    try {
      const out = await catalogue.refreshNow(project, { root })
      setNote(out.tooBig ? CANNOT_READ_WHOLE : '')
      await read()
      onChanged()
    } catch (err) {
      setNote(err?.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  const when = check?.last_checked_at ? new Date(check.last_checked_at).toLocaleString() : null
  const who = check?.last_checked_by ? nameOf(check.last_checked_by) : null
  const allowed = canCheck && onDesktop

  return (
    <Banner tone="info" live={false} data-network-share-banner>
      Listed from the company server.{' '}
      {when ? `Last checked ${when}${who ? ` by ${who}` : ''}.` : 'Not checked yet.'}{' '}
      {note}{' '}
      <GatedAction allowed={allowed} reason={onDesktop ? deniedReason : FROM_THE_DESKTOP}>
        <Button variant="ghost" size="sm" onClick={refresh} disabled={!allowed} loading={busy} loadingLabel="Checking…">
          {onDesktop ? 'Refresh' : FROM_THE_DESKTOP}
        </Button>
      </GatedAction>
    </Banner>
  )
}
