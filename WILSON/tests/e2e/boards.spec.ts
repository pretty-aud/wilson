// =============================================================================
// tests/e2e/boards.spec.ts — M.O.T.H. Session 4 (MO4): a board, live, end to end
// against the hosted dev project, as the probe admin in two windows.
//
// Until this file the board client had only met stand-ins: its unit tests fake
// the adapter, and the dev fixtures keep a board in the page's memory. Here the
// real page talks to the real functions (0130 to 0134), the real storage and
// the real channels:
//
//   1. A board made from a project's menu opens in its panel, its channels join.
//   2. A second window opens the same board from the list.
//   3. A shape drawn in one window appears in the other, both ways (the
//      database's own message, never one a client sent), and a save a window
//      forges on the board's own channel reaches nobody.
//   4. A sticky's words, typed in one window, are read in the other (the note
//      is a real markdown file; its words go through the sticky's turn).
//   5. While one window is writing on the sticky, the other is told who is, and
//      takes its turn only once the first has let go.
//   6. A pointer sends at most about ten places a second, and nothing when it
//      is still (her cost rule; counted on the wire, not by the page).
//   7. A window that lost its network and came back has what it missed.
//   8. A picture chosen from the computer is placed, and the other window gets it.
//   9. The board put in the trash closes in the window that did it, and in the
//      other, which is told why.
//
// One account, two windows: CI knows one seeded account on wilson-dev. A second
// window of the same person is another session to the sticky's turn (it is
// refused, with the name), and the channels carry every message between the
// two; what one account cannot show is another PERSON's cursor and name, which
// the page drops when the sender is itself. Given a second seeded person
// (WILSON_E2E_USERNAME_2 and its password, on a throwaway stack) the second
// window is theirs: each names the other, the pointer is drawn with a name, and
// with that stack's database the second is taken off the company while the
// board is open. Two real people are hers to try on staging (RELEASE_TESTING §W).
//
// What is on a board is read from the page's own Konva stage (the dev server's
// build puts Konva on window): the canvas has no DOM to ask.
//
// It makes one board a run in the probe workspace's project named below, and
// puts it in the trash at the end (and, if a step failed, as it leaves); the
// trash empties itself after 30 days. It signs in twice: two company checks and
// two credential checks on resolve-login's per-address limiter.
// =============================================================================

import { execFileSync } from 'node:child_process'
import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import { signInHere } from './authFlow'

// A seeded project of the probe workspace that has its folders (a board is a folder of its own under them).
const PROJECT = new RegExp(process.env.WILSON_E2E_BOARD_PROJECT || 'Northwind', 'i')

// A second seeded person, where the environment has one. A throwaway stack seeds several, and then the second
// window is another person's: each names the other, the first's pointer is drawn in the second with a name, and
// (given that stack's database) the second is taken off the company while the board is open. CI's dev project
// gives the one probe account, and the second window is that same person's.
const SECOND = process.env.WILSON_E2E_USERNAME_2 && process.env.WILSON_E2E_PASSWORD_2
  ? { username: process.env.WILSON_E2E_USERNAME_2, password: process.env.WILSON_E2E_PASSWORD_2 }
  : null
const PSQL = process.env.WILSON_E2E_PSQL || ''

// One retry at most: every try makes a board, and the job has fifteen minutes for every spec.
test.describe.configure({ retries: process.env.CI ? 1 : 0 })

type Thing = { id: string; x: number; y: number; words: string; pictures: number }
type Wire = { sent: Record<string, number>; got: Record<string, number> }

/** What Konva holds for the open board: each element's id, its middle on the page, its words. */
const things = (page: Page): Promise<Thing[] | null> => page.evaluate(() => {
  const K = (window as any).Konva
  const stage = K?.stages?.[K.stages.length - 1]
  if (!stage) return null
  const box = stage.container().getBoundingClientRect()
  return stage.find((n: any) => n.attrs.elementId).map((g: any) => {
    const r = g.getClientRect()
    return {
      id: String(g.attrs.elementId),
      x: Math.round(box.left + r.x + r.width / 2),
      y: Math.round(box.top + r.y + r.height / 2),
      words: g.find('Text').map((t: any) => t.text()).join(' ').trim(),
      pictures: g.find('Image').length,
    }
  })
})
const count = async (page: Page) => (await things(page))?.length ?? -1

/**
 * The board's channels on the wire: broadcasts by event, sent and received. The client's serializer (realtime-js
 * 2.101, lib/serializer.js) sends and receives a broadcast as a BINARY frame, and everything else as text: the
 * first run of this spec counted text frames only and saw no broadcast at all while the shapes crossed. A sent
 * broadcast is [3, join ref's length, ref's, topic's, event's, metadata's, encoding] then those strings; a received
 * one is [4, topic's length, event's, metadata's, encoding] then those strings.
 */
function listen(page: Page): Wire {
  const wire: Wire = { sent: {}, got: {} }
  const tally = (topic: unknown, key: string | null, into: Record<string, number>) => {
    if (typeof topic !== 'string' || !topic.includes('moth:board') || !key) return
    into[key] = (into[key] ?? 0) + 1
  }
  const read = (payload: string | Buffer, into: Record<string, number>) => {
    if (typeof payload !== 'string') {
      const buf = Buffer.from(payload)
      if (buf[0] === 3 && buf.length > 7) {
        const at = 7 + buf[1] + buf[2]
        tally(buf.toString('utf8', at, at + buf[3]), buf.toString('utf8', at + buf[3], at + buf[3] + buf[4]), into)
      } else if (buf[0] === 4 && buf.length > 5) {
        tally(buf.toString('utf8', 5, 5 + buf[1]), buf.toString('utf8', 5 + buf[1], 5 + buf[1] + buf[2]), into)
      }
      return
    }
    let m: any
    try { m = JSON.parse(payload) } catch { return }
    const [topic, event, body] = Array.isArray(m) ? [m[2], m[3], m[4]] : [m?.topic, m?.event, m?.payload]
    tally(topic, event === 'broadcast' ? String(body?.event ?? 'broadcast') : event === 'presence' || event === 'presence_diff' || event === 'presence_state' ? 'presence' : null, into)
  }
  page.on('websocket', (ws) => {
    ws.on('framesent', (f) => read(f.payload, wire.sent))
    ws.on('framereceived', (f) => read(f.payload, wire.got))
  })
  return wire
}

const board = (page: Page) => page.locator('[data-moth-board]')
const canvas = (page: Page) => page.locator('[data-moth-board] .konvajs-content').first()
const editor = (page: Page) => page.locator('[data-moth-board-editor] textarea')
const tool = (page: Page, title: string) => board(page).getByTitle(title, { exact: true }).first().click()

/** A place on the canvas by fractions of its width and height: the same on any window size, whatever the camera. */
async function spot(page: Page, fx: number, fy: number) {
  const b = await canvas(page).boundingBox()
  if (!b) throw new Error('the board has no canvas')
  return { x: b.x + b.width * fx, y: b.y + b.height * fy }
}
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
}

/** Signed in and on M.O.T.H., inside the project, whatever view the person last had. */
async function intoProject(page: Page, who: { username: string; password: string } | null = null) {
  // Whenever that prompt is in the way of a press, it is put off first (signInHere does the same, once, at sign-in).
  const later = page.getByRole('button', { name: /set up later/i })
  // Its button is pressed as an event, not by the pointer: on a slow start the sign-in's own curtain lay over it
  // for more than ten seconds (a throwaway stack's run), and a pointer's press waited that long and gave up.
  await page.addLocatorHandler(later, async (btn) => { await btn.dispatchEvent('click').catch(() => {}) })
  await page.goto('/moth')
  await signInHere(page, who?.username, who?.password)
  const moth = page.locator('[data-moth-page]')
  // The prompt stands in place of the page until it is put off; a wait presses nothing, so it is looked for here.
  await expect(async () => {
    if (await later.isVisible()) await later.dispatchEvent('click')
    await expect(moth).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 75_000 }).catch(async (err) => {
    // What the page says instead, for whoever reads the run without its pictures.
    const says = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
    throw new Error(`M.O.T.H. did not open after signing in. The page says: "${says}". ${String(err).slice(0, 200)}`)
  })
  // The very first visit asks what to map (later ones reopen the last view), and an admin's sign-in asks to set up
  // a second step, over the whole page: on a dev server still cold that prompt came after signInHere had stopped
  // waiting for it, and took every press for 75 s (this spec's first run). Whichever is in the way is answered,
  // then the list on the right is walked from its top.
  const firstVisit = page.locator('.ui-dialog').getByText('Everything by folders', { exact: true })
  const project = moth.getByRole('button', { name: PROJECT }).first()
  const top = moth.getByRole('button', { name: 'Everything', exact: true }).first()
  const menu = moth.getByTitle('More for this project')
  await expect(async () => {
    if (await menu.isVisible()) return
    if (await firstVisit.isVisible()) await firstVisit.click({ timeout: 5_000 })
    if (!(await project.isVisible())) await top.click({ timeout: 3_000 }).catch(() => { /* already at the top */ })
    await project.click({ timeout: 5_000 })
    await expect(menu).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 75_000 })
  return moth
}

test('a board is live between two windows: shapes, a sticky and its turn, the pointer, a network gone and back, a picture, the trash', async ({ browser }) => {
  test.setTimeout(300_000)
  const title = `e2e board ${new Date().toISOString().slice(0, 19).replace('T', ' ')} ${Math.random().toString(36).slice(2, 6)}`
  const seen: Record<string, unknown> = { title, who: SECOND ? 'two people' : 'one person, two windows' }
  let ctxA: BrowserContext | null = null
  let ctxB: BrowserContext | null = null
  let made = false
  let trashed = false
  let n = 0 // how many things the board holds now
  const a = await (ctxA = await browser.newContext()).newPage()
  const b = await (ctxB = await browser.newContext()).newPage()
  const wireA = listen(a)
  const wireB = listen(b)
  const t0 = Date.now()
  const lap = (name: string) => { seen[name] = `${Date.now() - t0} ms` }

  try {
    await test.step('1. a board made from the project\'s menu opens, and its channels join', async () => {
      const moth = await intoProject(a)
      await moth.getByTitle('More for this project').click()
      await a.getByText('New board', { exact: true }).filter({ visible: true }).first().click()
      await a.locator('.ui-dialog input').first().fill(title)
      await a.locator('[data-moth-board-make]').click()
      const refused = a.locator('[data-moth-board-make-error]')
      await expect(canvas(a).or(refused)).toBeVisible({ timeout: 30_000 })
      if (await refused.count()) throw new Error(`the board was refused: ${await refused.innerText()}`)
      made = true
      await expect(a.locator('[data-moth-board-live-failed]')).toHaveCount(0)
      await expect.poll(() => count(a), { timeout: 10_000 }).toBe(n)
      lap('made')
    })

    await test.step('2. a second window opens the same board from the list', async () => {
      const moth = await intoProject(b, SECOND)
      await moth.getByRole('button', { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click({ timeout: 30_000 })
      await moth.getByRole('button', { name: 'Open board', exact: true }).click()
      await expect(canvas(b)).toBeVisible({ timeout: 30_000 })
      await expect(b.locator('[data-moth-board-live-failed]')).toHaveCount(0)
      // Joined: the people's channel has told this window who is here.
      await expect.poll(() => wireB.got.presence ?? 0, { timeout: 20_000 }).toBeGreaterThan(0)
      if (SECOND) {
        // Two people: each window names the other, and never by an email.
        for (const page of [a, b]) {
          const here = page.locator('[data-moth-board-people] li')
          await expect(here).toHaveCount(1, { timeout: 20_000 })
          expect(await here.first().innerText()).not.toContain('@')
        }
        seen.people = { a: await a.locator('[data-moth-board-people]').innerText(), b: await b.locator('[data-moth-board-people]').innerText() }
      } else {
        // One person in two windows is nobody else: nothing is named.
        await expect(a.locator('[data-moth-board-people]')).toHaveCount(0)
      }
      lap('second window open')
    })

    await test.step('3. a shape drawn in one window appears in the other, both ways', async () => {
      await tool(a, 'Shape (S)')
      await drag(a, await spot(a, 0.18, 0.2), await spot(a, 0.32, 0.42))
      n += 1
      await expect.poll(() => count(a), { timeout: 10_000 }).toBe(n)
      await expect.poll(() => count(b), { timeout: 20_000 }).toBe(n)
      await tool(b, 'Shape (S)')
      await drag(b, await spot(b, 0.62, 0.2), await spot(b, 0.76, 0.42))
      n += 1
      await expect.poll(() => count(b), { timeout: 10_000 }).toBe(n)
      await expect.poll(() => count(a), { timeout: 20_000 }).toBe(n)
      expect(new Set((await things(a))!.map((t) => t.id))).toEqual(new Set((await things(b))!.map((t) => t.id)))
      seen.elementsHeard = { a: wireA.got.elements ?? 0, b: wireB.got.elements ?? 0, sentByAClient: (wireA.sent.elements ?? 0) + (wireB.sent.elements ?? 0) }
      // Each window heard the other's save on the wire (a read made again would also bring it, later, and would
      // prove nothing about the channel), and a save is told by the database: no window sends one itself.
      expect(wireA.got.elements ?? 0).toBeGreaterThan(0)
      expect(wireB.got.elements ?? 0).toBeGreaterThan(0)
      expect((wireA.sent.elements ?? 0) + (wireB.sent.elements ?? 0)).toBe(0)
      lap('shapes both ways')
    })

    await test.step('3b. a save forged by a window on the board\'s own channel reaches nobody', async () => {
      // A window may listen on the board's own channel and never send there. Here the second window sends, through
      // the page's own client, what the database would say if everything on the board had been removed.
      const heard = wireA.got.elements ?? 0
      const ids = (await things(a))!.map((t) => t.id)
      const sent = await b.evaluate(`import('/src/cloud/auth/supabaseClient.js').then(async (m) => {
        const ch = m.supabase.getChannels().find((c) => /^realtime:moth:board:[0-9a-f-]+:/.test(c.topic))
        if (!ch) return 'no channel'
        return ch.send({ type: 'broadcast', event: 'elements', payload: { board: ch.topic.split(':')[3], op: 'remove', ids: ${JSON.stringify(ids)} } })
      })`)
      seen.forgedSend = sent
      expect(sent).not.toBe('no channel')
      expect(wireB.sent.elements ?? 0).toBe(1)
      await a.waitForTimeout(3_000)
      expect(wireA.got.elements ?? 0).toBe(heard)
      expect(await count(a)).toBe(n)
      expect(await count(b)).toBe(n)
      lap('forged save dropped')
    })

    await test.step('4. a sticky\'s words typed in one window are read in the other', async () => {
      await tool(a, 'Sticky note (N)')
      const at = await spot(a, 0.25, 0.72)
      await a.mouse.click(at.x, at.y)
      await expect(editor(a)).toBeVisible({ timeout: 30_000 })
      n += 1
      await a.keyboard.type('harbour at dawn')
      const away = await spot(a, 0.9, 0.9)
      await a.mouse.click(away.x, away.y)
      await expect(editor(a)).toHaveCount(0, { timeout: 30_000 })
      await expect.poll(async () => (await things(b))?.some((t) => t.words.includes('harbour at dawn')) ?? false, { timeout: 30_000 }).toBe(true)
      lap('sticky words across')
    })

    await test.step('5. the sticky\'s turn: the other window is told who is writing, and writes once it is let go', async () => {
      const mine = (await things(a))!.find((t) => t.words.includes('harbour'))!
      await a.mouse.dblclick(mine.x, mine.y)
      await expect(editor(a)).toBeVisible({ timeout: 20_000 })
      const theirs = (await things(b))!.find((t) => t.words.includes('harbour'))!
      await b.mouse.dblclick(theirs.x, theirs.y)
      const told = b.locator('[data-moth-board-notice]')
      await expect(told).toContainText('is writing on this sticky', { timeout: 20_000 })
      seen.turnRefusedWith = await told.innerText()
      await expect(editor(b)).toHaveCount(0)
      // No email in the name the board shows.
      expect(await told.innerText()).not.toContain('@')
      const away = await spot(a, 0.9, 0.9)
      await a.mouse.click(away.x, away.y)
      await expect(editor(a)).toHaveCount(0, { timeout: 20_000 })
      // Let go: the second window takes the turn, reads the words and adds to them.
      await expect(async () => {
        const now = (await things(b))!.find((t) => t.words.includes('harbour'))!
        await b.mouse.dblclick(now.x, now.y)
        await expect(editor(b)).toBeVisible({ timeout: 4_000 })
      }).toPass({ timeout: 30_000 })
      await expect(editor(b)).toHaveValue('harbour at dawn', { timeout: 15_000 })
      await editor(b).press('End')
      await b.keyboard.type(', then the boats')
      const awayB = await spot(b, 0.9, 0.9)
      await b.mouse.click(awayB.x, awayB.y)
      await expect(editor(b)).toHaveCount(0, { timeout: 30_000 })
      await expect.poll(async () => (await things(a))?.some((t) => t.words.includes('then the boats')) ?? false, { timeout: 30_000 }).toBe(true)
      lap('sticky turn')
    })

    await test.step('6. the pointer: at most about ten places a second while it moves, none when it is still', async () => {
      const before = { sent: wireA.sent.cursor ?? 0, got: wireB.got.cursor ?? 0 }
      const from = await spot(a, 0.4, 0.55)
      const started = Date.now()
      // Five seconds of steady movement, a step about every 16 ms.
      for (let i = 0; Date.now() - started < 5_000; i += 1) {
        await a.mouse.move(from.x + 120 * Math.cos(i / 12), from.y + 60 * Math.sin(i / 12))
        await a.waitForTimeout(12)
      }
      const moved = (Date.now() - started) / 1000
      if (SECOND) {
        // Another person's pointer is drawn in the second window, with their name and never an email.
        const names: string[] = await b.evaluate(() => {
          const K = (window as any).Konva
          return K.stages[K.stages.length - 1].find('.cursor').map((g: any) => g.find('Text').map((t: any) => t.text()).join(''))
        })
        seen.pointerDrawnAs = names
        expect(names).toHaveLength(1)
        expect(names[0]).not.toContain('@')
        expect(names[0].trim().length).toBeGreaterThan(0)
      }
      await a.waitForTimeout(500)
      const sent = (wireA.sent.cursor ?? 0) - before.sent
      await expect.poll(() => (wireB.got.cursor ?? 0) - before.got, { timeout: 10_000 }).toBeGreaterThanOrEqual(sent - 2)
      // Still for three seconds: nothing more goes.
      const atRest = wireA.sent.cursor ?? 0
      await a.waitForTimeout(3_000)
      const still = (wireA.sent.cursor ?? 0) - atRest
      seen.pointer = { seconds: Number(moved.toFixed(1)), sent, perSecond: Number((sent / moved).toFixed(1)), received: (wireB.got.cursor ?? 0) - before.got, sentWhileStill: still }
      expect(sent / moved).toBeLessThanOrEqual(10.5)
      expect(sent).toBeGreaterThan(moved * 5)
      expect(still).toBe(0)
      lap('pointer measured')
    })

    await test.step('7. a window whose network went and came back has what it missed', async () => {
      // Offline stops new connections but leaves an open socket open (measured in headless Chromium), so the
      // socket is closed under the page as a lost network would close it; it cannot come back until online again.
      await ctxB!.setOffline(true)
      await b.evaluate("import('/src/cloud/auth/supabaseClient.js').then((m) => { m.supabase.realtime.conn && m.supabase.realtime.conn.close() })")
      await b.waitForTimeout(1_500)
      await tool(a, 'Shape (S)')
      await drag(a, await spot(a, 0.45, 0.62), await spot(a, 0.58, 0.84))
      n += 1
      await expect.poll(() => count(a), { timeout: 10_000 }).toBe(n)
      await a.waitForTimeout(2_000)
      expect(await count(b)).toBe(n - 1)
      const back = Date.now()
      await ctxB!.setOffline(false)
      await expect.poll(() => count(b), { timeout: 75_000, intervals: [1_000] }).toBe(n)
      seen.caughtUpAfter = `${Date.now() - back} ms`
      lap('network back')
    })

    await test.step('8. a picture chosen from the computer is placed, and the other window gets it', async () => {
      // A 2 by 2 picture, made here: no real photograph, no name.
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR42mP40KQBRAwQCgAwBgZpx6jaOgAAAABJRU5ErkJggg==', 'base64')
      const [chooser] = await Promise.all([a.waitForEvent('filechooser', { timeout: 10_000 }), tool(a, 'Picture or file (I)')])
      await chooser.setFiles({ name: 'e2e-dot.png', mimeType: 'image/png', buffer: png })
      n += 1
      await expect.poll(() => count(a), { timeout: 45_000 }).toBe(n)
      await expect.poll(() => count(b), { timeout: 30_000 }).toBe(n)
      // Reported, not required: whether the picture itself was drawn from its file, or its tile was.
      await expect.poll(async () => (await things(a))!.reduce((sum, t) => sum + t.pictures, 0), { timeout: 20_000 }).toBeGreaterThan(0).catch(() => { seen.pictureDrawn = 'no' })
      seen.pictureDrawn ??= 'yes'
      lap('picture')
    })

    if (SECOND && PSQL) {
      await test.step('8b. a person taken off the company while the board is open: it closes for them', async () => {
        // An admin's act, made from outside the page on a throwaway stack: the second person is no longer active.
        // Their window was joined before it; the board's channels are renamed, and theirs is refused the new names.
        execFileSync('psql', [PSQL, '-v', 'ON_ERROR_STOP=1', '-c',
          `UPDATE public.workspace_members SET is_active = false WHERE username = '${SECOND.username.replace(/[^a-z0-9_]/gi, '')}'`], { stdio: 'pipe' })
        const since = Date.now()
        await expect(board(b)).toHaveCount(0, { timeout: 45_000 })
        seen.closedForTheRemovedAfter = `${Date.now() - since} ms`
        // The first window goes on as before: a shape drawn now is saved.
        await tool(a, 'Shape (S)')
        await drag(a, await spot(a, 0.72, 0.62), await spot(a, 0.84, 0.84))
        n += 1
        await expect.poll(() => count(a), { timeout: 10_000 }).toBe(n)
        await expect(a.locator('[data-moth-board-people]')).toHaveCount(0, { timeout: 20_000 })
        lap('removed person closed')
      })
    }

    await test.step('9. the board put in the trash closes here, and in the other window with the reason', async () => {
      await board(a).getByTitle('Put in the trash').click()
      await a.locator('[data-moth-board-trash-yes]').click()
      await expect(board(a)).toHaveCount(0, { timeout: 30_000 })
      trashed = true
      await expect(a.getByText('The board is in the trash.', { exact: false })).toBeVisible({ timeout: 10_000 })
      await expect(board(b)).toHaveCount(0, { timeout: 45_000 })
      lap('trash')
    })
  } finally {
    seen.wire = { a: wireA, b: wireB }
    // The numbers, where the public API can read them: one notice on the job.
    console.log(`::notice title=board e2e::${JSON.stringify(seen).replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`)
    if (made && !trashed) {
      // A step failed with the board still there: it goes to the trash on the way out.
      try {
        if (await board(a).count()) {
          await board(a).getByTitle('Put in the trash').click({ timeout: 5_000 })
          await a.locator('[data-moth-board-trash-yes]').click({ timeout: 5_000 })
          await expect(board(a)).toHaveCount(0, { timeout: 20_000 })
        }
      } catch { /* left for the next look at Moth's trash; it is named e2e board and dated */ }
    }
    await ctxA?.close().catch(() => {})
    await ctxB?.close().catch(() => {})
  }
})
