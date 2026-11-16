// =============================================================================
// aiFileStoreFixture — the development copy's AI file store (FX12, 2026-10-25)
//
// The real store is reached only signed in to the cloud (the platform key
// lives in ai-files), so on the test data the Admin Terminal's "The AI's file
// store" card answers from here: ids, times and sizes in exactly ai-files' GET
// and sweep shapes, never a filename (there are none to have). The sweep
// deletes this company's files older than 24 hours from the fixture.
//
// `?aiFiles=empty` starts with nothing stored; `?aiFiles=error` answers the
// list with the function's refusal (`list_failed`), as a store that could not
// be read does.
// =============================================================================

const H = 3600 * 1000
const AGE_HOURS = 24

export function aiFilesFixtureMode() {
  try {
    const v = new URLSearchParams(globalThis.location?.search || '').get('aiFiles')
    return v === 'empty' || v === 'error' ? v : null
  } catch {
    return null
  }
}

/** A fixture store; `now` is a clock seam for the tests. */
export function createAIFileStoreFixture({ mode = null, now = () => Date.now() } = {}) {
  const t0 = now()
  let files = mode === 'empty' ? [] : [
    { id: 'file_011DevFixtureStored0001', created_at: new Date(t0 - 52 * H).toISOString(), size_bytes: 2_412_544, expires_at: null },
    { id: 'file_011DevFixtureStored0002', created_at: new Date(t0 - 30 * H).toISOString(), size_bytes: 318_902, expires_at: null },
    { id: 'file_011DevFixtureStored0003', created_at: new Date(t0 - 2 * H).toISOString(), size_bytes: 96_211, expires_at: new Date(t0 + 22 * H).toISOString() },
  ]

  const old = (f) => now() - Date.parse(f.created_at) > AGE_HOURS * H
  const summary = () => {
    const sorted = [...files].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    return {
      count: files.length,
      total_bytes: files.reduce((n, f) => n + f.size_bytes, 0),
      oldest: sorted[0]?.created_at ?? null,
      sweepable: files.filter(old).length,
    }
  }
  const refusal = (code, status) => Object.assign(new Error(code), { code, status })

  return {
    async list() {
      if (mode === 'error') throw refusal('list_failed', 502)
      return {
        scope: 'workspace',
        older_than_hours: AGE_HOURS,
        ...summary(),
        unreachable: 0,
        files: files.map(f => ({ ...f, expired: false })),
      }
    },
    async sweep() {
      const take = files.filter(old)
      files = files.filter(f => !old(f))
      return {
        ok: true,
        counts: {
          deleted: take.length, gone: 0, failed: 0, skipped_recent: files.length,
          unreachable: 0, certify_failed: 0, truncated: false, older_than_hours: AGE_HOURS,
        },
        after: summary(),
      }
    },
  }
}
