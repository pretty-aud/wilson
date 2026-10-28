/** @vitest-environment jsdom */
// =============================================================================
// SecretsSection.test.jsx — P8 (TPN-ENC-015, night 5, 2026-10-28).
//
// The operator console's "Secrets" section, MOUNTED against a stubbed
// operatorApi: the names and counts it shows, that the re-seal needs the
// stated confirm (which names the readers to redeploy first), that nothing
// happens when every row is already under the current version or no secret
// is set, the counts shown after, and that the only thing sent is the domain.
// =============================================================================

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

vi.mock('../cloud/auth/supabaseClient', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }))
const secretsStatus = vi.fn()
const resealSecret = vi.fn()
vi.mock('./operatorApi', () => ({
  secretsStatus: (...a) => secretsStatus(...a),
  resealSecret: (...a) => resealSecret(...a),
  isMissingFunction: (r) => r?.status === 404 && !r?.data?.error,
}))
const { default: SecretsSection, READERS, rowsBehind, rowsByVersionText } = await import('./SecretsSection.jsx')

const domain = (over = {}) => ({
  current: 2, versions_present: [1, 2], names_present: ['WILSON_AI_KEY_SECRET', 'WILSON_AI_KEY_SECRET_V2'],
  rows: 4, rows_by_version: { 1: 3, 2: 1 }, ...over,
})
const status = (ai = {}, storage = {}) => ({
  ok: true, status: 200,
  data: {
    ai: domain(ai),
    storage: domain({ names_present: ['WILSON_STORAGE_KEY_SECRET', 'WILSON_STORAGE_KEY_SECRET_V2'], rows: 2, rows_by_version: { 2: 2 }, ...storage }),
  },
})

beforeEach(() => { secretsStatus.mockReset(); resealSecret.mockReset() })
afterEach(cleanup)

describe('the helpers', () => {
  it('rows behind the current version, and the text by version', () => {
    expect(rowsBehind(domain())).toBe(3)
    expect(rowsBehind(domain({ rows_by_version: { 2: 4 } }))).toBe(0)
    expect(rowsBehind(domain({ current: null }))).toBe(4)
    expect(rowsBehind(null)).toBe(0)
    expect(rowsByVersionText({ 2: 1, 1: 3 })).toBe('v1: 3 · v2: 1')
    expect(rowsByVersionText({})).toBe('none')
  })
  it('the readers to redeploy are the functions that open each secret', () => {
    expect(READERS.ai).toEqual(['ai-proxy', 'ai-files', 'operator-ai-keys'])
    expect(READERS.storage).toEqual(['storage-presign', 'storage-gc', 'storage-read-urls', 'storage-secret', 'operator-ai-keys'])
  })
})

describe('the section', () => {
  it('shows the names, the current version and the rows by version for both secrets; nothing it renders is a value', async () => {
    secretsStatus.mockResolvedValue(status())
    render(<SecretsSection isActive />)
    expect((await screen.findByTestId('ai-versions')).textContent).toBe('WILSON_AI_KEY_SECRET, WILSON_AI_KEY_SECRET_V2')
    expect(screen.getByTestId('ai-current').textContent).toBe('version 2 (WILSON_AI_KEY_SECRET_V2)')
    expect(screen.getByTestId('ai-rows').textContent).toBe('v1: 3 · v2: 1')
    expect(screen.getByTestId('storage-rows').textContent).toBe('v2: 2')
    expect(screen.getByTestId('ai-reseal').textContent).toBe('Re-seal 3 rows under version 2')
    expect(screen.getByTestId('ai-reseal').disabled).toBe(false)
    expect(screen.getByTestId('storage-reseal').textContent).toBe('Nothing to re-seal')
    expect(screen.getByTestId('storage-reseal').disabled).toBe(true)
    expect(secretsStatus).toHaveBeenCalledTimes(1)
    expect(secretsStatus).toHaveBeenCalledWith()
  })
  it('the re-seal needs the confirm, which names the readers; then the domain alone is sent, the counts are shown and the status reloaded', async () => {
    secretsStatus.mockResolvedValue(status())
    resealSecret.mockResolvedValue({ ok: true, status: 200, data: { secret: 'ai', to_version: 2, resealed: 3, skipped: 1, failed: 0, from_versions: { 1: 3 }, rows: 4 } })
    render(<SecretsSection isActive />)
    fireEvent.click(await screen.findByTestId('ai-reseal'))
    expect(resealSecret).not.toHaveBeenCalled()
    const confirm = screen.getByTestId('ai-confirm')
    expect(confirm.textContent).toContain('every reader of WILSON_AI_KEY_SECRET must have been redeployed on this environment: ai-proxy, ai-files, operator-ai-keys')
    fireEvent.click(screen.getByTestId('ai-reseal-confirm'))
    expect((await screen.findByTestId('secrets-notice')).textContent).toBe('Company AI keys: 3 re-sealed under version 2, 1 already there, 0 failed.')
    expect(resealSecret).toHaveBeenCalledTimes(1)
    expect(resealSecret).toHaveBeenCalledWith('ai')
    expect(secretsStatus).toHaveBeenCalledTimes(2)
  })
  it('"Not yet" closes the confirm without sending anything', async () => {
    secretsStatus.mockResolvedValue(status())
    render(<SecretsSection isActive />)
    fireEvent.click(await screen.findByTestId('ai-reseal'))
    fireEvent.click(screen.getByText('Not yet'))
    expect(screen.queryByTestId('ai-confirm')).toBeNull()
    expect(resealSecret).not.toHaveBeenCalled()
  })
  it('no secret set: the current line says so and the button is disabled', async () => {
    secretsStatus.mockResolvedValue(status({ current: null, versions_present: [], names_present: [] }))
    render(<SecretsSection isActive />)
    expect((await screen.findByTestId('ai-current')).textContent).toBe('nothing (not configured on this environment)')
    expect(screen.getByTestId('ai-versions').textContent).toBe('none')
    expect(screen.getByTestId('ai-reseal').textContent).toBe('Not configured')
    expect(screen.getByTestId('ai-reseal').disabled).toBe(true)
  })
  it('a failed re-seal shows the sentence and reloads; a function not deployed says so', async () => {
    secretsStatus.mockResolvedValue(status())
    resealSecret.mockResolvedValue({ ok: false, status: 501, data: { error: 'key_crypto_not_configured', friendly: 'WILSON_AI_KEY_SECRET is not configured on this environment.' } })
    render(<SecretsSection isActive />)
    fireEvent.click(await screen.findByTestId('ai-reseal'))
    fireEvent.click(screen.getByTestId('ai-reseal-confirm'))
    expect((await screen.findByTestId('secrets-error')).textContent).toBe('WILSON_AI_KEY_SECRET is not configured on this environment.')
    expect(secretsStatus).toHaveBeenCalledTimes(2)
    cleanup()
    secretsStatus.mockReset()
    secretsStatus.mockResolvedValue({ ok: false, status: 404, data: {} })
    render(<SecretsSection isActive />)
    expect((await screen.findByTestId('secrets-missing')).textContent).toContain('not deployed')
  })
  it('does not load until it is the active section', () => {
    secretsStatus.mockResolvedValue(status())
    render(<SecretsSection isActive={false} />)
    expect(secretsStatus).not.toHaveBeenCalled()
  })
})
