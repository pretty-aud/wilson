// desktopFileOps.js — MO1 (MOTH_DESIGN §1.9): thin calls to the desktop's own routes for a company's
// office server and a retired local copy (electron/networkShareWalk.cjs, networkShareOps.cjs, networkShare.cjs,
// localMedia.cjs). Off the desktop each says so, in the sentence a person can act on. An answer that is not
// a success throws its sentence, with the route's code on the error.
import { hasLocalServer } from '../../../lib/localData.js'
import { localFetch } from '../../../lib/localServerFetch.js'

export const DESKTOP_PREVIEW_SENTENCE = 'Preview available on the desktop app'
export const DESKTOP_ACTION_SENTENCE = 'Do this from the WILSON desktop app'

// Who is calling, for a write in a personal folder, which the routes check with the auth server
// (authCheck.cjs). No session is no header, and those routes refuse.
async function sessionToken() {
  try {
    // Asked here, not at load: these calls exist on a build and in tests with no cloud configured.
    const { supabase } = await import('../../../cloud/auth/supabaseClient')
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token ?? null
  } catch {
    return null
  }
}

export function createDesktopFileOps({ available = hasLocalServer, fetchImpl = localFetch, getAccessToken = sessionToken } = {}) {
  const here = () => { if (!available()) throw new Error(DESKTOP_ACTION_SENTENCE) }
  async function answered(res) {
    const body = await res.json().catch(() => ({}))
    if (res.ok) return body
    const err = new Error(body.error || 'The desktop app could not do that.')
    err.code = body.code ?? null
    err.status = res.status
    throw err
  }
  const post = async (route, body) => {
    here()
    const token = await getAccessToken()
    return answered(await fetchImpl(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }))
  }
  return {
    available,
    // Asked before anything is written: an answer of 'unreachable' throws its sentence.
    reachable: async () => {
      here()
      return answered(await fetchImpl('/api/network-share/reachable'))
    },
    // { dirs, bin, stopped_at, counts }: network_share_catalogue_apply's p_dirs and p_bin.
    walkFolder: (folder, start = null) => post('/api/network-share/walk', { folder, start }),
    // { results: [{ from, to, ok, code?, already? }] }, each pair for itself. A pair may say the size it expects.
    rename: (pairs) => post('/api/network-share/op', { pairs }),
    // { results: [{ path, there, size } | { path, code }] }: a bin's path too, which statFile cannot ask.
    look: (paths) => post('/api/network-share/look', { paths }),
    // from: { picked: <path from rabbit:pick-files> } or { media_key }
    put: (to, from) => post('/api/network-share/put', { to, from }),
    purgeBin: (paths) => post('/api/network-share/purge', { paths }),
    // What is at a locator now, or null: { size, modified_at }. Throws when the server cannot be asked.
    statFile: async (locator) => {
      here()
      const res = await fetchImpl(`/api/rabbit/network-share/file/${locator.split('/').map(encodeURIComponent).join('/')}`, { method: 'HEAD' })
      if (res.status === 404) return null
      if (!res.ok) await answered(res)
      const modified = Date.parse(res.headers?.get?.('last-modified') ?? '')
      return { size: Number(res.headers?.get?.('content-length') ?? 0), modified_at: Number.isFinite(modified) ? new Date(modified).toISOString() : undefined }
    },
    retireLocalMedia: (key, op) => post('/api/rabbit/local-media/retire', { key, op }),
    // The bearer token is who is calling, as the route checks it with the auth server (authCheck.cjs).
    async addToPersonalSpace({ root, folder, file, accessToken }) {
      here()
      const query = new URLSearchParams({ root, folder, name: file.name, sizeBytes: String(file.size) })
      return answered(await fetchImpl(`/api/network-share/personal-space/files?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${accessToken}` },
        body: file,
      }))
    },
  }
}

export const desktopFileOps = createDesktopFileOps()
