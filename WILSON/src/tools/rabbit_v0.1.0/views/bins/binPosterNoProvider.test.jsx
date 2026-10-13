/** @vitest-environment jsdom */
// binPosterNoProvider.test.jsx — drawing a clip's tile never imports the
// provider (BC2, found in CI).
//
// BC2 item 4 had BinPoster import useRabbit from RabbitProvider.jsx, whose
// import chain builds the cloud client — and that throws "supabaseUrl is
// required" where no Supabase address is configured. CI has none, so five
// bins test files that draw tiles failed there from 3149b046 on, while they
// passed here (.env.local has the address). What this pins, with the address
// blanked as in CI: the tile and the views that draw it load; the provider
// module itself still throws (the control: the blanking reproduces CI).
import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

const blank = () => {
  vi.stubEnv('VITE_SUPABASE_URL', '')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
  vi.resetModules()
}

describe('with no Supabase address (as in CI)', () => {
  it('the control: the provider module cannot load', async () => {
    blank()
    await expect(import('../../state/RabbitProvider')).rejects.toThrow(/supabaseUrl is required/)
  })

  it('BinPoster, and the grid, table, take chips and dialogs that draw it, load', async () => {
    blank()
    for (const m of [
      () => import('./BinPoster'),
      () => import('./BinFileGrid'),
      () => import('./BinFileTable'),
      () => import('./ShotTakeChips'),
      () => import('./ShotTakesPanel'),
      () => import('./TakePickerDialog'),
      () => import('./AssignToShotDialog'),
    ]) {
      await expect(m()).resolves.toBeTruthy()
    }
  })
})
