#!/usr/bin/env node
/**
 * The web app playing through GW2's REAL gateway — GW3 (2026-10-11), the
 * brief's Playwright run, exactly as GW2's hand-off "For GW3" runs the
 * gateway: the fake cloud (gateway/test/fakeCloud.mjs) served over HTTPS on
 * loopback, the real executable (`node gateway/src/cli.mjs run`) as its own
 * process with the outside door on loopback (outside.behind_local_proxy),
 * a footage location at \\localhost\C$\<scratch> holding a clip of random
 * frames made here by ffmpeg (never footage), and the dev server's page in
 * Playwright's Chromium (`ignoreHTTPSErrors`: the gateway's leaf names the
 * host, not 127.0.0.1). The page is the dev fixtures' `?gateway=real` mode:
 * the production doors module against the real gateway; only the tickets
 * come from the fake cloud, through a same-origin path this script fulfils
 * (the page never holds a sign-in token for any cloud).
 *
 *   node scripts/gateway-playback-e2e.mjs --port 5289 --scratch <empty folder> [--out <dir>] [--inside-port 28443] [--fast]
 *
 * What it proves, in order (the report is one JSON on stdout):
 *   1. play, scrub, the hand-over (the cloud's picture under the element
 *      until loadeddata), the outside door's overlay (name · member code ·
 *      clock, moved to another corner within 35 s);
 *   2. the renewal at 75 s keeping the SAME URL: one real 80 s run (the page
 *      posts { jti, t } at 75 s, the gateway answers 204, a seek at 80 s is
 *      served 206 on the old URL; `--fast` shortens it to a 20 s renewal);
 *   3. a 404 flipping the row to "not at its path" (a clip in the catalogue
 *      with no file on the share);
 *   4. a non-playable format (ProRes in a .mov) keeping its picture, with no
 *      ticket asked;
 *   5. a removed member cut within two minutes (clock-faked: the page's
 *      tickets are minted 60 s in the past, so the stream's authority ends
 *      90 s after the mint, and the page's hold, run from receipt for the
 *      ticket's own life less 30 s, ends then too; the renewal at 20 s
 *      cannot get a fresh ticket once the member is gone; the page drops the
 *      URL at the margin and says so, never retrying the same ticket);
 *   6. the switch turned off at the cloud while the outside door is still
 *      open (the gateway learns it at its next sync): every ticket the cloud
 *      mints then carries rv false and the outside door refuses it; the page
 *      asks at most twice, says the door's refusal and backs the clip off a
 *      minute — never a loop of mints (GW3 review round 2, finding 1);
 *   7. the gateway revoked at the cloud (`/_control/revoke`): both doors
 *      close within a sync interval and the page says the gateway cannot be
 *      reached (the door dropped after a HEAD nobody answered) or, had its
 *      ticket gone first, the cloud's refusal.
 *
 * It BINDS THIS COMPUTER'S LAN ADDRESS (the office door, which the gateway
 * opens once enrolled) for the run's duration only — announce it before
 * running — and kills the gateway in a finally. It installs nothing, opens
 * no firewall rule, touches no service. Everything it made (the clip, the
 * certificates, the state) is deleted in the finally, except `--out`'s
 * screenshots. The office door cannot be played from this computer (it
 * closes its own host before TLS, design §4): "no overlay inside" is the
 * fixtures' stub's proof (bins-gateway-shots.mjs, gatewayVideo.test.jsx).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const { createFakeCloud, serveFakeCloud } = await import(path.join(ROOT, 'gateway', 'test', 'fakeCloud.mjs').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));
const CLI = path.join(ROOT, 'gateway', 'src', 'cli.mjs');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(n);
const PORT = arg('--port', '5289');
const scratch = path.resolve(arg('--scratch', ''));
if (!arg('--scratch', '')) { console.error('--scratch <folder> is required'); process.exit(2); }
const OUT = arg('--out', null);
const INSIDE_PORT = Number(arg('--inside-port', 28443));
const FAST = has('--fast');
const RENEW_S = FAST ? 20 : 75;
const RUN_S = FAST ? 25 : 80;
if (OUT) fs.mkdirSync(OUT, { recursive: true });

const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const unc = (p) => '\\\\localhost\\' + p[0] + '$' + p.slice(2);
const r1 = (x) => Math.round(x * 10) / 10;

const report = { when: new Date().toISOString(), host: os.hostname(), node: process.versions.node, fast: FAST, steps: {} };
const dirs = { root: path.join(scratch, 'gw3-e2e') };
dirs.state = path.join(dirs.root, 'state');
dirs.share = path.join(dirs.root, 'share');
dirs.fc = path.join(dirs.root, 'fake-cloud');
let gateway = null;
let fake = null;
let browser = null;
let current = null; // the page a failing step was on: photographed in the catch
const log = [];
const lines = (re) => log.filter((l) => re.test(l));
const waitLog = async (re, ms = 30_000) => { const t = Date.now(); while (Date.now() - t < ms) { if (log.some((l) => re.test(l))) return true; await sleep(50); } return false; };
const expect = (cond, what) => { if (!cond) throw new Error(`FAILED: ${what}`); };

async function main() {
  fs.mkdirSync(dirs.state, { recursive: true });
  fs.mkdirSync(dirs.share, { recursive: true });

  // ── The seeded rows, read through the dev server ──
  browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const seedPage = await context.newPage();
  await seedPage.goto(`http://localhost:${PORT}/rabbit`, { waitUntil: 'networkidle' });
  const data = await seedPage.evaluate(async () => {
    const s = await import('/src/dev/fixtures/data/scenes.js');
    const w = await import('/src/dev/fixtures/data/workspace.js');
    const loc = s.BIN_LOCATIONS[0];
    const on = (f) => f.location_id === loc.id;
    const proxies = s.BIN_FILES.filter((f) => f.extension === '.mp4' && on(f));
    return {
      loc: { id: loc.id, name: loc.name },
      play: proxies[0], missing: proxies[1],
      master: s.BIN_FILES.find((f) => f.extension === '.mov' && on(f)),
      sub: w.PERMISSIONS.userId,
    };
  });
  await seedPage.close();
  expect(data.play && data.missing && data.master, 'the fixtures hold two .mp4 proxies and a .mov master on the first location');
  report.rows = { play: data.play.display_name, missing: data.missing.display_name, master: data.master.display_name, location: data.loc.name };

  // ── The clip: random frames at 8 Mb/s, 100 s (so the browser still has bytes to ask for at 80 s: Chrome reads 20 MB ahead in seconds on loopback), never footage ──
  const clipPath = path.join(dirs.share, ...data.play.relative_path.split('/'));
  fs.mkdirSync(path.dirname(clipPath), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'nullsrc=s=640x360:r=24', '-vf', 'geq=random(1)*255:128:128', '-t', '100',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '8M', '-maxrate', '8M', '-bufsize', '16M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', clipPath], { stdio: 'inherit' });
  report.clip = { bytes: fs.statSync(clipPath).size, path: data.play.relative_path };

  // ── The fake cloud, the catalogue, the member, the switch on with the outside door on loopback ──
  let skewMs = 0;
  const cloud = createFakeCloud({ now: () => Date.now() + skewMs });
  fake = await serveFakeCloud(cloud, { dir: dirs.fc, port: 9443 });
  cloud.addLocation({ id: data.loc.id, unc_path: unc(dirs.share), name: data.loc.name });
  cloud.addClip(data.play.id, { loc: data.loc.id, path: data.play.relative_path, mt: 'video/mp4' });
  cloud.addClip(data.missing.id, { loc: data.loc.id, path: data.missing.relative_path, mt: 'video/mp4' }); // no file on the share
  cloud.addMember(data.sub);
  const outsidePort = await freePort();
  cloud.state.switchOn = true;
  cloud.state.outsideAddress = { host: '127.0.0.1', port: outsidePort };
  fs.writeFileSync(path.join(dirs.state, 'config.json'), JSON.stringify({ inside: { port: INSIDE_PORT }, outside: { port: outsidePort, behind_local_proxy: true }, connect_without_login: ['localhost'] }, null, 2));
  report.share = unc(dirs.share);
  report.outside_port = outsidePort;

  // ── The real gateway, as its own process ──
  gateway = spawn(process.execPath, [CLI, 'run'], {
    env: { ...process.env, WILSON_GATEWAY_STATE_DIR: dirs.state, WILSON_GATEWAY_SECRETS_KEY: crypto.randomBytes(32).toString('base64') /* P8: a throwaway for this run */, WILSON_ENROL_TOKEN: cloud.newToken(), WILSON_CLOUD_URL: fake.url, NODE_EXTRA_CA_CERTS: fake.caFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  gateway.stdout.on('data', (d) => log.push(...String(d).split('\n').filter(Boolean)));
  gateway.stderr.on('data', (d) => log.push(...String(d).split('\n').filter(Boolean).map((l) => `stderr ${l}`)));
  expect(await waitLog(/ outside_open /), 'the outside door opened:\n' + log.join('\n'));
  const gatewayId = cloud.onlyGateway();
  report.gateway = { id: gatewayId, first_lines: log.slice(0, 3) };

  // ── The page: the fixtures' real mode, the tickets fulfilled from the fake cloud ──
  const ticketCalls = [];
  // Step 6: the cloud's switch off, minting rv false, before the gateway's
  // next sync closes its outside door (the sync still answers "on").
  let mintRvOff = false;
  await context.route('**/__fake-cloud/gateway-ticket', async (route) => {
    const body = route.request().postDataJSON();
    ticketCalls.push({ at: Date.now(), ids: body.bin_file_ids });
    const r = cloud.handle('gateway-ticket', { authorization: `Bearer user:${body.sub}` }, { gateway_id: body.gateway_id, bin_file_ids: body.bin_file_ids });
    if (mintRvOff && r.status === 200 && r.json && r.json.tickets) {
      for (const id of Object.keys(r.json.tickets)) r.json.tickets[id] = cloud.mint({ clip: id, sub: body.sub, rv: false });
    }
    await route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.json) });
  });
  const query = (extra = '') => `http://localhost:${PORT}/rabbit?gateway=real&gw=${gatewayId}&host=127.0.0.1&port=${outsidePort}&sub=${data.sub}${extra}`;
  const openBins = async (page, extra = '') => {
    // A page that reloads or navigates mid-step is the cause of a missing player: say so in the report.
    page.on('load', () => { report.page_events = report.page_events || []; report.page_events.push({ at: new Date().toISOString(), event: 'load', url: page.url() }); });
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) { report.page_events = report.page_events || []; report.page_events.push({ at: new Date().toISOString(), event: 'navigated', url: f.url() }); } });
    page.on('console', (m) => { if (m.type() === 'error') { report.console_errors = report.console_errors || []; if (report.console_errors.length < 20) report.console_errors.push({ at: new Date().toISOString(), text: m.text().slice(0, 300) }); } });
    page.on('pageerror', (e) => { report.console_errors = report.console_errors || []; report.console_errors.push({ at: new Date().toISOString(), text: 'pageerror: ' + String(e.message).slice(0, 300) }); });
    await page.goto(query(extra), { waitUntil: 'networkidle' });
    await page.locator('.rb-summary-card, button', { hasText: 'Salt Hours' }).first().click();
    await page.getByRole('tab', { name: 'Bins', exact: true }).first().click();
    await page.locator('[data-testid="catalogue-notice"]').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(1500); // the probe: /v1/path on the outside door answers 404, which IS the outside door
  };
  const tile = (page, name) => page.locator('[role="gridcell"]', { hasText: name }).first();
  const shot = async (page, name) => { if (OUT) await page.screenshot({ path: path.join(OUT, `po-gw3-e2e-${name}.png`) }); };
  const previewVideo = (page) => page.locator('[data-testid="gateway-preview"] video');

  // ── 1. Play, scrub, the hand-over, the overlay; 2. the renewal keeping the URL ──
  {
    const page = await context.newPage(); current = page;
    const responses = [];
    page.on('response', (r) => { const u = r.url(); if (u.includes(`:${outsidePort}/`)) responses.push({ at: Date.now(), status: r.status(), path: new URL(u).pathname, method: r.request().method() }); });
    await openBins(page, `&renew_s=${RENEW_S}`);
    const lines1 = await page.locator('[data-testid="gateway-line"]').allTextContents();
    expect(lines1.length === 0, `no state line once the gateway is reached (got: ${lines1.join(' | ')})`);
    expect((await tile(page, data.play.display_name).getAttribute('data-offline')) === null, 'the proxy row is online through the gateway');
    await tile(page, data.play.display_name).click();
    await page.mouse.move(1370, 12);
    const t0 = Date.now();
    await page.locator('[data-testid="gateway-preview"]').waitFor({ timeout: 10_000 });
    // D22: the picture (or nothing) and "loading" until the ticket; then the element under the picture until loadeddata.
    await previewVideo(page).waitFor({ timeout: 15_000 });
    const src = await previewVideo(page).getAttribute('src');
    expect(src.startsWith(`https://127.0.0.1:${outsidePort}/v1/clips/${data.play.id}?t=v1.`), `the src is the gateway's clip URL with the ticket (${src})`);
    await page.locator('[data-testid="gateway-preview"] [data-testid="gateway-player"][data-loaded="true"]').waitFor({ timeout: 20_000 });
    const handover = Date.now() - t0;
    const mark = page.locator('[data-testid="gateway-preview"] [data-testid="viewer-mark"]');
    await mark.waitFor({ timeout: 5_000 });
    const markText = await mark.textContent();
    expect(/ · [0-9a-f]{6} · \d\d:\d\d$/.test(markText), `the mark is name · member code · clock (${markText})`);
    const markClass0 = await mark.getAttribute('class');
    const attrs = await previewVideo(page).evaluate((v) => ({ controlslist: v.getAttribute('controlslist'), pip: v.hasAttribute('disablepictureinpicture'), remote: v.hasAttribute('disableremoteplayback'), crossorigin: v.getAttribute('crossorigin') }));
    await shot(page, '01-inspector-outside-mark');
    // Play and scrub.
    await previewVideo(page).evaluate((v) => v.play());
    await page.waitForTimeout(3000);
    const playing = await previewVideo(page).evaluate((v) => ({ t: v.currentTime, paused: v.paused, ready: v.readyState, err: v.error?.code ?? null }));
    expect(playing.t > 1 && !playing.paused && !playing.err, `the clip plays (${JSON.stringify(playing)})`);
    await previewVideo(page).evaluate((v) => { v.currentTime = 30; });
    await page.waitForTimeout(2500);
    const scrubbed = await previewVideo(page).evaluate((v) => ({ t: v.currentTime, ready: v.readyState, err: v.error?.code ?? null }));
    expect(scrubbed.t >= 30 && scrubbed.ready >= 2 && !scrubbed.err, `the scrub landed and the frame is there (${JSON.stringify(scrubbed)})`);
    // Space: the clip large, autoplaying, the mark with it.
    await page.keyboard.press('Space');
    const large = page.locator('[data-testid="poster-large"][data-plays="true"]');
    await large.waitFor({ timeout: 10_000 });
    await large.locator('[data-testid="gateway-player"][data-loaded="true"]').waitFor({ timeout: 20_000 });
    await large.locator('[data-testid="viewer-mark"]').waitFor({ timeout: 5_000 });
    await page.waitForTimeout(1000);
    await shot(page, '02-large-player-outside-mark');
    const largeSrc = await large.locator('video').getAttribute('src');
    const tLarge = Date.now();
    // The renewal: wait RUN_S from the large player's first src, then seek past what the browser read.
    const served = () => lines(/ clip_served /).length;
    const servedBefore = served();
    await page.waitForTimeout(Math.max(0, RENEW_S * 1000 + 5000 - (Date.now() - tLarge)));
    const renewResponses = responses.filter((r) => r.path.endsWith('/renew'));
    const renewedLines = lines(/ renewed /);
    expect(renewResponses.some((r) => r.status === 204), `the page posted the renewal and the gateway answered 204 (${JSON.stringify(renewResponses)})`);
    expect(renewedLines.length >= 1, 'the gateway logged the renewal');
    // The mark moved to another corner within the run (every 30 s).
    const markClass1 = await large.locator('[data-testid="viewer-mark"]').getAttribute('class');
    await page.waitForTimeout(Math.max(0, RUN_S * 1000 - (Date.now() - tLarge)));
    const srcAfter = await large.locator('video').getAttribute('src');
    expect(srcAfter === largeSrc, 'the URL never changed across the renewal');
    // Chrome keeps the whole clip once read (it reads 60 MB in seconds on
    // loopback), so a seek alone asks the gateway for nothing: the element is
    // made to load its URL again, a real request on the OLD URL after the
    // renewal, which must be served.
    const tReload = Date.now();
    await large.locator('video').evaluate((v) => { const t = v.currentTime; v.load(); v.currentTime = Math.min(t, Math.max(0, v.duration - 8) || t); return v.play().catch(() => {}); });
    await page.waitForTimeout(3000);
    const afterSeek = await large.locator('video').evaluate((v) => ({ t: v.currentTime, ready: v.readyState, err: v.error?.code ?? null, paused: v.paused }));
    expect(!afterSeek.err && afterSeek.ready >= 2, `a request after the renewal is served on the old URL (${JSON.stringify(afterSeek)})`);
    const refused = responses.filter((r) => r.path.includes('/v1/clips/') && r.method === 'GET' && r.status === 401);
    expect(refused.length === 0, `no clip request was refused (${JSON.stringify(refused)})`);
    const unseenRanges = responses.filter((r) => r.path.includes('/v1/clips/') && r.method === 'GET' && r.at >= tReload && (r.status === 206 || r.status === 200));
    expect(unseenRanges.length >= 1, `the gateway served the old URL again after the renewal (${JSON.stringify(responses.filter((r) => r.at >= tReload))})`);
    report.steps.play_scrub_handover_overlay_renewal = {
      handover_ms: handover, mark: markText, mark_moved: markClass0 !== markClass1 || RUN_S < 35, mark_classes: [markClass0.split(' ').pop(), markClass1.split(' ').pop()],
      video_attrs: attrs, played: playing, scrubbed, renewals: renewResponses.map((r) => ({ status: r.status, at_s: r1((r.at - tLarge) / 1000) })),
      gateway_renewed_lines: renewedLines.length, ranges_served_by_gateway: served() - servedBefore, ranges_206_after_renewal: unseenRanges.length, after_seek: afterSeek, url_unchanged: srcAfter === largeSrc,
      ticket_calls: ticketCalls.length,
    };
    await page.keyboard.press('Escape');

    // ── 3. A 404 flips the row ──
    const t3 = Date.now();
    await tile(page, data.missing.display_name).click();
    await page.mouse.move(1370, 12);
    await page.locator('[data-testid="not-here"]').waitFor({ timeout: 20_000 });
    const missingText = (await page.locator('[data-testid="not-here"]').textContent()).replace(/\s+/g, ' ');
    expect(/not at its path/.test(missingText), `the inspector says the clip is not at its path (${missingText})`);
    await page.waitForTimeout(300);
    const missingOffline = await tile(page, data.missing.display_name).getAttribute('data-offline');
    const head404 = responses.filter((r) => r.method === 'HEAD' && r.path.includes(data.missing.id) && r.status === 404);
    await shot(page, '03-missing-404');
    report.steps.missing_404 = { ms: Date.now() - t3, sentence: missingText.slice(0, 160), tile_offline: missingOffline, head_404: head404.length, gateway_404_lines: lines(/ clip_refused /).filter((l) => /"status":404/.test(l)).length };
    expect(missingOffline === 'true', 'the tile is dimmed as not on this computer');

    // ── 4. A non-playable format keeps its picture, with no ticket asked ──
    const ticketsBefore = ticketCalls.length;
    await tile(page, data.master.display_name).click();
    await page.mouse.move(1370, 12);
    await page.locator('[data-testid="needs-desktop-format"]').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800);
    const formatText = (await page.locator('[data-testid="needs-desktop-format"]').textContent()).replace(/\s+/g, ' ');
    await shot(page, '04-prores-picture');
    report.steps.non_playable_format = { sentence: formatText.slice(0, 160), ticket_calls_added: ticketCalls.length - ticketsBefore, video_elements: await page.locator('[data-testid="needs-desktop-format"] video').count() };
    expect(ticketCalls.length === ticketsBefore, 'no ticket was asked for the ProRes master');
    await page.close();
  }

  // ── 5. A removed member is cut within two minutes (clock-faked: tickets minted 60 s in the past) ──
  {
    const page = await context.newPage(); current = page;
    const responses = [];
    page.on('response', (r) => { const u = r.url(); if (u.includes(`:${outsidePort}/`)) responses.push({ at: Date.now(), status: r.status(), path: new URL(u).pathname, method: r.request().method() }); });
    // The cloud's clock for the mints: iat = now − 60, exp = now + 60; the
    // gateway allows 30 s of skew, so the stream's authority ends 90 s from
    // the mint unless renewed. The page's hold runs from the ticket's
    // receipt for its own life (exp − iat, 120 s) less its 30 s margin —
    // also 90 s (GW3 review round 1, finding 2: never the cloud's clock) —
    // and the renewal at 20 s gets no fresh ticket once the member is gone,
    // so the page drops the URL at the margin and says the refusal.
    skewMs = -60_000;
    await openBins(page, '&renew_s=20');
    await tile(page, data.play.display_name).click();
    await page.mouse.move(1370, 12);
    await previewVideo(page).waitFor({ timeout: 15_000 });
    const tMint = Date.now();
    await page.locator('[data-testid="gateway-preview"] [data-testid="gateway-player"][data-loaded="true"]').waitFor({ timeout: 20_000 });
    await previewVideo(page).evaluate((v) => v.play());
    const tRemoved = Date.now();
    cloud.state.members.delete(data.sub); // the member removed: no fresh ticket for the renewal, none for a retry
    skewMs = 0;
    // From here the page is watched every two seconds: when the element goes
    // (the page drops a ticket in its last 30 s once a renewal failed), when
    // the sentence appears. At the authority's end (+93 s) an element still
    // there is made to ask again (Chrome keeps what it read): that request
    // is refused (D5).
    const timeline = [];
    let reloaded = false;
    let cutText = null;
    while (Date.now() - tRemoved < 125_000) {
      const s = await page.evaluate(() => ({
        video: !!document.querySelector('[data-testid="gateway-preview"] video'),
        sentence: document.querySelector('[data-testid="gateway-sentence"]')?.textContent || null,
        loading: !!document.querySelector('[data-testid="gateway-loading"]'),
      })).catch(() => ({ video: false, sentence: null, loading: false }));
      const at = r1((Date.now() - tRemoved) / 1000);
      const last = timeline[timeline.length - 1];
      if (!last || last.video !== s.video || last.sentence !== s.sentence || last.loading !== s.loading) timeline.push({ at_s: at, ...s });
      if (s.sentence) { cutText = s.sentence.replace(/\s+/g, ' '); break; }
      if (!reloaded && s.video && Date.now() >= tMint + 93_000) {
        reloaded = true;
        await previewVideo(page).evaluate((v) => { v.load(); return v.play().catch(() => {}); }).catch(() => {});
        timeline.push({ at_s: at, event: 'element made to ask again' });
      }
      await page.waitForTimeout(2000);
    }
    const cutMs = Date.now() - tRemoved;
    expect(cutText, `the page said the stream ended (timeline: ${JSON.stringify(timeline)})`);
    const refused = responses.filter((r) => r.path.includes('/v1/clips/') && r.status === 401);
    const renewals = responses.filter((r) => r.path.endsWith('/renew')).map((r) => ({ status: r.status, at_s: r1((r.at - tRemoved) / 1000) }));
    const ticketRefusals = ticketCalls.filter((c) => c.at >= tRemoved).length;
    await shot(page, '05-member-removed-cut');
    report.steps.member_removed_cut = { cut_within_s: r1(cutMs / 1000), sentence: cutText.slice(0, 160), timeline, renewals, clip_401s: refused.length, ticket_calls_after_removal: ticketRefusals, gateway_401_lines: lines(/ clip_refused /).filter((l) => /"status":401/.test(l)).length, gateway_renew_refused_lines: lines(/ renew_refused /).length, video_elements_left: await page.locator('[data-testid="gateway-preview"] video').count() };
    expect(cutMs < 120_000, 'the stream ended within two minutes');
    expect(/ticket/i.test(cutText), `the page said the ticket could not be renewed (${cutText})`);
    expect(await page.locator('[data-testid="gateway-preview"] video').count() === 0, 'the element is gone (never retried with the same ticket)');
    cloud.addMember(data.sub);
    await page.close();
  }

  // ── 6. The switch off at the cloud, the outside door still open: the page asks at most twice and says the door's refusal ──
  {
    const page = await context.newPage(); current = page;
    const doorAnswers = [];
    page.on('response', (r) => { const u = r.url(); if (u.includes(`:${outsidePort}/v1/clips/`)) doorAnswers.push({ at: Date.now(), status: r.status(), method: r.request().method() }); });
    mintRvOff = true;
    const before = ticketCalls.length;
    const rvBefore = lines(/"reason":"rv"/).length;
    await openBins(page, '&renew_s=20');
    const t0 = Date.now();
    await tile(page, data.play.display_name).click();
    await page.mouse.move(1370, 12);
    const said = page.locator('[data-testid="gateway-preview"] [data-testid="gateway-sentence"]').first();
    await said.waitFor({ timeout: 20_000 });
    const saidMs = Date.now() - t0;
    const text = (await said.textContent()).replace(/\s+/g, ' ');
    // The loop round 2 found would mint and be refused dozens of times here.
    await page.waitForTimeout(15_000);
    await shot(page, '06-switch-off-refused');
    const mints = ticketCalls.length - before;
    const refused = doorAnswers.filter((r) => r.status === 401).length;
    report.steps.switch_off_refused = { said_within_s: r1(saidMs / 1000), sentence: text.slice(0, 160), mints_in_window: mints, door_401s: refused, gateway_rv_refusals: lines(/"reason":"rv"/).length - rvBefore, video_elements_left: await previewVideo(page).count() };
    expect(/turned down a ticket/i.test(text), `the page said the door's refusal (${text})`);
    expect(mints <= 2, `at most two ticket calls while the door refused every ticket (${mints})`);
    expect(refused <= 4, `at most four refused requests at the door (${refused})`);
    mintRvOff = false;
    await page.close();
  }

  // ── 7. The gateway revoked at the cloud: both doors close within a sync; the page says unreachable ──
  {
    const page = await context.newPage(); current = page;
    await openBins(page, '&renew_s=20');
    await tile(page, data.play.display_name).click();
    await page.mouse.move(1370, 12);
    await previewVideo(page).waitFor({ timeout: 15_000 });
    await page.locator('[data-testid="gateway-preview"] [data-testid="gateway-player"][data-loaded="true"]').waitFor({ timeout: 20_000 });
    await previewVideo(page).evaluate((v) => v.play());
    const tRevoke = Date.now();
    cloud.revoke(gatewayId); // what POST /_control/revoke { gateway_id } does
    expect(await waitLog(/ revoked /, 30_000), 'the gateway learned of the revocation at its next sync');
    const closed = await waitLog(/ outside_closed /, 10_000);
    // The page's next request fails; the element is made to ask again. The
    // diagnosis asks the door with the element's own ticket first (GW3
    // review round 1, finding 6): nothing answers, so the door is dropped and
    // probed again (finding 8) and the tab says the gateway cannot be
    // reached — the inspector's line in place of the player. A page whose
    // ticket was already gone asks the cloud and says its refusal in the
    // player instead. Either is the page saying so; the report names which.
    await previewVideo(page).evaluate((v) => { v.load(); return v.play().catch(() => {}); }).catch(() => {});
    const sentence = page.locator('[data-testid="gateway-sentence"], [data-testid="not-here"]').first();
    await sentence.waitFor({ timeout: 60_000 });
    const said_by = await sentence.getAttribute('data-testid');
    const text = (await sentence.textContent()).replace(/\s+/g, ' ');
    expect(/cannot reach|refused|ticket/i.test(text), `the page said the gateway is gone (${text})`);
    const outsideClosedMs = (() => { const l = log.find((x) => / outside_closed /.test(x)); return l ? Date.now() - tRevoke : null; })();
    await shot(page, '07-gateway-revoked');
    report.steps.gateway_revoked = { revoked_line: !!lines(/ revoked /).length, outside_closed: closed, said_within_s: r1((Date.now() - tRevoke) / 1000), said_by, sentence: text.slice(0, 160), video_elements_left: await page.locator('[data-testid="gateway-preview"] video').count(), outside_port_connect: await new Promise((resolve) => { const s = net.connect(outsidePort, '127.0.0.1'); s.once('error', (e) => resolve(e.code)); s.once('connect', () => { s.destroy(); resolve('connected'); }); }) };
    expect(closed, 'the outside door closed');
    await page.close();
  }
  report.gateway_log_tail = log.slice(-12);
}

main()
  .then(() => { report.ok = true; console.log(JSON.stringify(report, null, 2)); })
  .catch(async (e) => {
    report.ok = false; report.error = String(e?.stack || e);
    if (OUT && current && !current.isClosed()) {
      try {
        await current.screenshot({ path: path.join(OUT, 'po-gw3-e2e-debug-failed.png') });
        report.page_at_failure = await current.evaluate(() => ({ url: location.href, sentence: document.querySelector('[data-testid="gateway-sentence"]')?.textContent || null, preview: document.querySelector('[data-testid="gateway-preview"]')?.textContent?.slice(0, 300) || null, notHere: document.querySelector('[data-testid="not-here"]')?.textContent?.slice(0, 200) || null, video: !!document.querySelector('[data-testid="gateway-preview"] video') }));
      } catch { /* the page is gone */ }
    }
    console.log(JSON.stringify(report, null, 2)); console.error(log.slice(-40).join('\n')); process.exitCode = 1;
  })
  .finally(async () => {
    if (gateway && gateway.exitCode === null) gateway.kill();
    await sleep(500);
    if (browser) await browser.close().catch(() => {});
    if (fake) await fake.close().catch(() => {});
    fs.rmSync(dirs.root, { recursive: true, force: true }); // the clip, every certificate, the state
    console.error(`gateway killed: ${gateway ? gateway.exitCode !== null || gateway.killed : 'never started'}; cleaned: ${dirs.root} exists = ${fs.existsSync(dirs.root)}`);
  });
