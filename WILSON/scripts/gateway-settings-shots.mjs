#!/usr/bin/env node
/**
 * The file gateway's Settings card, photographed — GW1 (2026-10-10).
 *
 *   node scripts/gateway-settings-shots.mjs <port> --out <dir> [--size 1440x900] [--prefix po-gw1-]
 *
 * Walks walkthrough 60 on the dev fixtures' in-memory gateway cloud
 * (src/dev/fixtures/gatewayFixtures.js). First the company before its first
 * gateway (`?gateways=empty`): the one button; Add a gateway — the token once,
 * the cloud's address, the NAS story with the mount line computed, the
 * Windows story; the gateway appearing as its token is spent; the
 * fingerprint confirmed. Then the company with its NAS gateway: the health
 * line; an outside address pasted as a URL; Check reach with the switch off,
 * then on (It works), then aimed at the inside door (the one error); the
 * office ranges; the viewings from outside; the trail; Forget and its Undo.
 * Then a member's view (`?fixtures=member`), and the Bins inspector's line.
 * Each file is `<prefix><nn>-<state>-<W>x<H>.png`.
 *
 * Needs the worktree's own dev server with VITE_DEV_AUTOLOGIN=tester and
 * VITE_DEV_FIXTURES=1 (the gw1-worktree launch entry). Changes nothing that
 * outlives the page: the fixture store is in memory and the browser context
 * is fresh; no request leaves the page (the fixtures contact nothing).
 * Animations are off and the caret transparent, in this page only. A state
 * whose control is not found stops the run and says which.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const PORT = args.find((a, i) => !a.startsWith('-') && !['--out', '--size', '--prefix'].includes(args[i - 1])) || '5288';
const OUT = flag('--out');
if (!OUT) { console.error('usage: gateway-settings-shots.mjs <port> --out <dir> [--size WxH] [--prefix p]'); process.exit(1); }
const [W, H] = (flag('--size') || '1440x900').split('x').map(Number);
const PREFIX = flag('--prefix') || 'po-gw1-';
mkdirSync(OUT, { recursive: true });

// The fixture gateway's root, as its container log would print it.
const NEW_FP = '9e8d7c6b5a49382716f5e4d3c2b1a0998877665544332211ffeeddccbbaa0011'.toUpperCase().match(/../g).join(':');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
  const quiet = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  const sleep = (ms) => page.waitForTimeout(ms);
  let n = 0;
  const shot = async (state) => {
    n += 1;
    await page.mouse.move(W - 70, 12);
    await sleep(250);
    const file = `${PREFIX}${String(n).padStart(2, '0')}-${state}-${W}x${H}.png`;
    await page.screenshot({ path: join(OUT, file) });
    console.log(`  ${file}`);
  };
  const must = async (loc, what) => {
    try { await loc.waitFor({ state: 'visible', timeout: 10000 }); } catch {
      await page.screenshot({ path: join(OUT, `debug-not-found-${W}x${H}.png`) });
      throw new Error(`not found: ${what} (the screen then: debug-not-found-${W}x${H}.png)`);
    }
    return loc;
  };
  const click = async (loc, what) => { await (await must(loc, what)).click(); };
  const card = () => page.locator('section', { has: page.getByRole('heading', { name: 'File gateway', exact: true }) });
  const row = () => card().locator('[data-gateway-row]').first();
  const button = (name, scope = card()) => scope.getByRole('button', { name, exact: true }).first();
  // Scroll so the element's top sits under the page's own top bar.
  const top = async (loc) => {
    await (await must(loc, 'scroll target')).evaluate((el) => {
      const y = el.getBoundingClientRect().top + window.scrollY - 140;
      window.scrollTo(0, Math.max(0, y));
      const scroller = el.closest('[class*="overflow-y-auto"], [class*="overflow-auto"]');
      if (scroller) scroller.scrollTop += el.getBoundingClientRect().top - 140;
    });
    await sleep(200);
  };

  const openSettings = async (query = '') => {
    await page.goto(`http://localhost:${PORT}/settings${query}`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: quiet });
    await click(page.getByRole('tab', { name: 'Storage', exact: true }).first(), 'the Storage tab');
    await must(card(), 'the File gateway card');
    await top(card().getByRole('heading', { name: 'File gateway', exact: true }));
  };

  // ── A. Before the first gateway ─────────────────────────────────────────
  await openSettings('?gateways=empty');
  await must(card().getByTestId('gateway-empty'), 'the empty state');
  await shot('empty-one-button');

  await click(button('Add a gateway'), 'Add a gateway');
  await must(card().getByTestId('gateway-token'), 'the token panel');
  await shot('token-cloud-nas-story');
  await top(card().getByRole('list', { name: 'Your footage locations, mounted' }));
  await shot('nas-story-mount-line');
  await click(card().getByRole('tab', { name: 'On a Windows PC', exact: true }), 'the Windows tab');
  await top(card().getByRole('tab', { name: 'On a Windows PC', exact: true }));
  await shot('windows-story');

  // The fixture spends the token six seconds after it was made.
  await must(card().getByText('appeared just now, and the token is spent.'), 'the gateway appearing');
  await top(row());
  await shot('appeared-fingerprint-box');

  await card().getByLabel('Certificate fingerprint').fill(NEW_FP);
  await click(button('Confirm'), 'Confirm');
  await must(button('Download certificate'), 'Download certificate');
  await top(row());
  await shot('confirmed-download-certificate');

  // ── B. The company's NAS gateway ────────────────────────────────────────
  await openSettings();
  await top(row());
  await shot('health-line');

  await click(button('Set', row()), 'Set the outside address');
  await row().getByLabel('Outside address').fill('https://Gateway.LanternAsh.com:443/');
  await click(button('Save', row()), 'Save the address');
  await must(row().getByText('gateway.lanternash.com:443', { exact: true }), 'the saved address');
  await click(button('Check reach', row()), 'Check reach');
  await must(row().getByRole('status').filter({ hasText: /^Checking…/ }), 'Checking…');
  await shot('checking');
  await must(row().getByText(/^The switch is off, so the outside door is closed/), 'the switch-off sentence');
  await top(row());
  await shot('reach-switch-off');

  // The company's switch, below the card.
  const sw = page.getByRole('switch', { name: 'Allow files to be viewed from outside the office network' });
  await sw.scrollIntoViewIfNeeded();
  await click(sw, 'the switch');
  await sleep(400);
  await top(row());
  await click(button('Check reach', row()), 'Check reach again');
  await must(row().getByText('It works: play a clip from outside.'), 'It works');
  await shot('reach-it-works');

  await click(button('Change', row()), 'Change the address');
  await row().getByLabel('Outside address').fill('inside.lanternash.com:8444');
  await click(button('Save', row()), 'Save the address');
  await click(button('Check reach', row()), 'Check reach, the inside door');
  await must(row().getByText(/^Your inside door \(port 8443\) answers from the internet/), 'the inside-door error');
  await top(row());
  await shot('reach-inside-door-error');

  await click(row().getByRole('button', { name: 'Change', exact: true }).nth(1), 'Change the office ranges');
  await row().getByLabel('Office ranges').fill('192.168.20.7/24, 10.8.0.0/16');
  await click(button('Save', row()), 'Save the ranges');
  await must(row().getByText('192.168.20.0/24, 10.8.0.0/16', { exact: true }), 'the saved ranges');
  await top(row());
  await shot('office-ranges');

  await top(card().getByTestId('gateway-viewings'));
  await shot('viewed-from-outside');
  await top(card().getByTestId('gateway-audit'));
  await shot('changes');

  await top(row());
  await click(button('Forget', row()), 'Forget');
  await must(page.getByRole('dialog', { name: 'Forget this gateway' }), 'the Forget question');
  await shot('forget-question');
  await click(page.getByRole('dialog').getByRole('button', { name: 'Forget', exact: true }), 'Forget, in the dialog');
  await must(card().getByRole('button', { name: /^Undo \(\d+ s\)$/ }), 'Undo');
  await shot('forgotten-undo');
  await click(card().getByRole('button', { name: /^Undo \(\d+ s\)$/ }), 'Undo');
  await must(button('Check reach', row()), 'the gateway back');

  // ── C. A member's view ──────────────────────────────────────────────────
  await openSettings('?fixtures=member');
  await must(card().getByText('Only a workspace admin can add or change the file gateway.').first(), 'the admin-only sentence');
  await shot('member-view');

  // ── D. The Bins inspector's one line (an admin) ─────────────────────────
  await page.goto(`http://localhost:${PORT}/rabbit`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: quiet });
  await click(page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first(), 'Salt Hours');
  await sleep(500);
  await click(page.getByRole('tab', { name: 'Bins', exact: true }).first(), 'the Bins tab');
  await click(page.locator('[role="gridcell"]', { hasText: 'A001_C001_0921AB' }).first(), 'the clip A001_C001_0921AB');
  await must(page.getByTestId('bin-remote-views'), 'the inspector line');
  await page.getByTestId('bin-remote-views').scrollIntoViewIfNeeded();
  await shot('bins-inspector-line');

  // ── B again, after GW1's review round 2: a tunnel's edge on the inside
  //    port, and Rotate the ticket keys. Last, so the earlier pictures keep
  //    their numbers. (A fresh page: the switch is off again.)
  await openSettings();
  const sw2 = page.getByRole('switch', { name: 'Allow files to be viewed from outside the office network' });
  await sw2.scrollIntoViewIfNeeded();
  await click(sw2, 'the switch');
  await sleep(400);
  await top(row());
  await click(button('Set', row()), 'Set the outside address');
  await row().getByLabel('Outside address').fill('tunnel.lanternash.com:443');
  await click(button('Save', row()), 'Save the address');
  await click(button('Check reach', row()), 'Check reach, behind a tunnel');
  await must(row().getByText(/^Something else answers on port 8443 at that address/), 'the tunnel edge line');
  await must(row().getByText('It works: play a clip from outside.'), 'It works, beside it');
  await top(row());
  await shot('reach-tunnel-edge');

  await click(button('Rotate the ticket keys'), 'Rotate the ticket keys');
  await must(page.getByRole('dialog', { name: 'Rotate the ticket keys' }), 'the Rotate question');
  await shot('rotate-question');
  await click(page.getByRole('dialog').getByRole('button', { name: 'Rotate', exact: true }), 'Rotate, in the dialog');
  await must(card().getByText(/^Rotated: new tickets are signed with a new key/), 'the rotated line');
  await top(card().getByText('Ticket keys', { exact: true }));
  await shot('ticket-keys-rotated');
} finally {
  await browser.close();
}
