// networkShareProvider.js — MO1 (MOTH_DESIGN §1.9, NS-D13): the registry's six functions for a file on a
// company's office server. A row's storage_path is 'nas:' + the path under the drive (NS-D2). Reads go
// through the desktop's own route; a browser says where to do this instead. A put copies a picked file or a
// local media key; a del empties a bin entry: a live row is deleted through the trash, server first (NS-D12).
import { hasLocalServer } from '../../../lib/localData.js'
import { localFetch } from '../../../lib/localServerFetch.js'
import { createDesktopFileOps, DESKTOP_ACTION_SENTENCE, DESKTOP_PREVIEW_SENTENCE } from './desktopFileOps.js'

const FILE_BASE = '/api/rabbit/network-share/file'
const BIN_ENTRY = /\/\.wilson-bin\/[0-9a-f-]{36}$/

const locatorOf = (key) => (String(key).startsWith('nas:') ? String(key).slice(4) : String(key))

function networkShareUrl(key, { download } = {}) {
  const path = locatorOf(key).split('/').map(encodeURIComponent).join('/')
  return `${FILE_BASE}/${path}${download ? '?download=1' : ''}`
}

export function createNetworkShareStorageProvider({ available = hasLocalServer, fetchImpl = localFetch } = {}) {
  const ops = createDesktopFileOps({ available, fetchImpl })
  const canRead = () => { if (!available()) throw new Error(DESKTOP_PREVIEW_SENTENCE) }
  const canWrite = () => { if (!available()) throw new Error(DESKTOP_ACTION_SENTENCE) }
  return {
    async put(key, _body, opts = {}) {
      canWrite()
      if (!opts.from) throw new Error('A file reaches the office server from Files or M.O.T.H. on the desktop.')
      return ops.put(locatorOf(key), opts.from)
    },
    async get(key) {
      canRead()
      const res = await fetchImpl(networkShareUrl(key))
      if (!res.ok) throw new Error('This file could not be read from the office server.')
      return res.blob()
    },
    async del(key) {
      canWrite()
      const locator = locatorOf(key)
      if (!BIN_ENTRY.test(locator)) throw new Error('A file on the office server is deleted through Files or M.O.T.H.')
      return ops.purgeBin([locator])
    },
    // Only a 404 says the file is not there: a server that is off is not an empty folder.
    async exists(key) {
      canRead()
      const res = await fetchImpl(networkShareUrl(key), { method: 'HEAD' })
      if (res.status === 404) return false
      if (!res.ok) throw new Error('The office server cannot be reached from this computer.')
      return true
    },
    async getUrl(key, _expiresIn, opts = {}) {
      canRead()
      return networkShareUrl(key, opts)
    },
    async describe() {
      return { provider: 'network_share', label: 'Company server', reachable: available() }
    },
  }
}
