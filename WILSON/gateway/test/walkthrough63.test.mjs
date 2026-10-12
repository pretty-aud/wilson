// =============================================================================
// walkthrough63.test.mjs — walkthrough 63 (GW4) held to the code's own words,
// as docs.test.mjs holds walkthrough 61: the secret, the environment, the
// workflow's job names, the release's name and files, the installer's last
// page, the health line's phrases, Check reach's sentence, the browser's
// sentences, and the rehearsal's one-line break, which must leave every test
// of the release workflow passing (or the broken build could not be built).
// =============================================================================

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { composeHealthLine, outsideCertificatePhrase } from '../src/rules/health.mjs';
import { RELEASE_KEYS_WIRE } from '../src/update/manifest.mjs';
import { planRelease, msiName, artefactName, MANIFEST_NAME, SIGNATURE_NAME } from '../pipeline/lib.mjs';
import { SMARTSCREEN_SUMMARY } from '../src/installer.mjs';
import { FIREWALL_RULE } from '../updater/updater.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WILSON = path.join(HERE, '..', '..');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8').replace(/\r\n/g, '\n');
const wt = read(WILSON, 'docs', 'walkthroughs', '63_file_gateway_release_and_rehearsal.md');
const readme = read(WILSON, 'docs', 'walkthroughs', 'README.md');
const workflow = read(WILSON, '..', '.github', 'workflows', 'gateway-release.yml');
const wxs = read(WILSON, 'gateway', 'windows', 'wix', 'Package.wxs');
const cli = read(WILSON, 'gateway', 'src', 'cli.mjs');
const swap = read(WILSON, 'gateway', 'src', 'update', 'swap.mjs');
const card = read(WILSON, 'src', 'components', 'settings', 'GatewaySettings.jsx');
const W = await import(pathToFileURL(path.join(WILSON, 'src', 'components', 'settings', 'gatewayWords.js')).href);
const B = await import(pathToFileURL(path.join(WILSON, 'src', 'tools', 'rabbit_v0.1.0', 'bins', 'binLocations.js')).href);

describe('walkthrough 63 (the releases and the rehearsal)', () => {
  it('is in the walkthroughs\' index, after 62', () => {
    expect(readme).toMatch(/^\| 63 \| \[63_file_gateway_release_and_rehearsal\.md\]\(63_file_gateway_release_and_rehearsal\.md\) \| GW4: /m);
    expect(readme.indexOf('| 63 |')).toBeGreaterThan(readme.indexOf('| 62 |'));
  });
  it('the key\'s secret, its environment and its kid are the workflow\'s and the gateway\'s', () => {
    expect(workflow).toContain('GATEWAY_RELEASE_SIGNING_KEY: ${{ secrets.GATEWAY_RELEASE_SIGNING_KEY }}');
    expect(wt).toContain('`GATEWAY_RELEASE_SIGNING_KEY`');
    expect(workflow).toContain('environment: gateway-release');
    expect(wt).toContain('`gateway-release`');
    expect(wt).toContain(`\`kid: ${RELEASE_KEYS_WIRE[0].kid}\``);
    expect(wt).toContain('`00_GATEWAY_RELEASE_KEY.txt`');
    expect(wt).toContain('Delete `00_GATEWAY_RELEASE_KEY.txt`');
  });
  it('the workflow and its jobs, by the names the Actions page shows', () => {
    expect(workflow).toMatch(/^name: Gateway release$/m);
    expect(wt).toContain('**Gateway release**');
    for (const job of ['Plan', 'Windows (the MSI and the update artefact)', 'Container (amd64 and arm64)', 'Sign (the release key)', 'Release (a draft, read back, then published if real)']) {
      expect(workflow, job).toContain(`name: ${job}`);
      expect(wt, job).toContain(`**${job}**`);
    }
    expect(workflow).toContain('name: Gateway tests (${{ matrix.os }})');
  });
  it('the release\'s name and its five files, as the pipeline makes them', () => {
    const p = planRelease({ event: 'push', refType: 'tag', refName: 'gateway-v0.1.0', dryRunInput: '', runId: '1', packageVersion: '0.1.0' });
    expect(wt).toContain(`**${p.releaseName}**`);
    for (const f of [msiName('0.1.0'), artefactName('0.1.0'), MANIFEST_NAME, SIGNATURE_NAME, 'SHA256SUMS']) expect(wt, f).toContain(`\`${f}\``);
    expect(read(WILSON, 'gateway', 'pipeline', 'cli.mjs')).toContain("files.set('SHA256SUMS'");
    expect(wt).toContain('**gateway-dry-run-38189270049**');
    expect(wt).toContain('`ghcr.io/pretty-aud/wilson-gateway@sha256:…`');
  });
  it('the installer\'s pages and its last sentence, as the MSI and installer.mjs write them', () => {
    for (const name of ['Enrol this gateway with WILSON', 'Show the office addresses and the certificate fingerprint']) {
      expect(wt, name).toContain(name);
      expect(wxs, name).toContain(name);
    }
    expect(wt).toContain(`*${SMARTSCREEN_SUMMARY}*`);
    expect(wt).toContain('**Windows protected your PC** (SmartScreen). Click **More info → Run anyway**');
    // D14: never "is signed", except in the sentence that promises exactly that.
    expect(wt).toContain('WILSON never says the gateway is signed until it is.');
    expect(wt.replace('WILSON never says the gateway is signed until it is.', '')).not.toMatch(/\bis signed\b|signed by Petal/i);
  });
  it('the health line\'s phrases, as the gateway composes them', () => {
    const now = Date.parse('2026-10-11T12:00:00Z');
    const failed = composeHealthLine({ now, name: 'PC', version: '0.1.0', lastSyncAt: now, inside: { state: 'open', addresses: [{ address: '192.168.1.173', port: 8443 }] }, outside: { state: 'closed_switch_off' }, locations: [], certificate: null, update: { state: 'failed', version: '0.1.1', reason: 'the new version did not report healthy within 90 s', running: '0.1.0' } }).text;
    expect(failed).toContain('update to 0.1.1 failed (the new version did not report healthy within 90 s); running 0.1.0');
    expect(wt).toContain('*update to 0.1.1 failed (the new version did not report healthy within 90 s); running 0.1.0*');
    expect(swap).toContain("reason: 'the new version did not report healthy within 90 s'");
    const updating = composeHealthLine({ now, name: 'PC', version: '0.1.0', lastSyncAt: now, inside: { state: 'open', addresses: [] }, outside: {}, locations: [], certificate: null, update: { state: 'updating', version: '0.1.1' } }).text;
    expect(updating).toContain('updating to 0.1.1');
    expect(wt).toContain('*updating to 0.1.1*');
    const acme = outsideCertificatePhrase({ kind: 'acme', name: 'gateway.petalstudios.co', state: 'valid', notAfter: now + 90 * 86_400_000 }, now).text;
    expect(acme).toMatch(/^outside certificate: Let’s Encrypt for gateway\.petalstudios\.co, renews itself \(until /);
    expect(wt).toContain("*outside certificate: Let's Encrypt for gateway.petalstudios.co, renews itself (until …)*".replace("Let's", 'Let\'s'));
    for (const phrase of ['office door open (', 'outside door closed (the switch is off)', 'up to date']) expect(wt, phrase).toContain(phrase);
  });
  it('Check reach\'s sentence, It works, the card\'s Updates and its viewings, as the card says them', () => {
    const r = W.reachSentence({ outside: { detail: 'reached', ms: 40 } }, { outside_address: { host: 'gateway.petalstudios.co', port: 443 } });
    expect(r.text).toContain('Reachable from the internet at gateway.petalstudios.co:443 (checked just now, certificate OK');
    expect(wt).toContain('*Reachable from the internet at gateway.petalstudios.co:443 (checked just now, certificate OK, … ms).*');
    expect(wt).toContain(`*${W.IT_WORKS}*`);
    expect(card).toContain("{busy === 'update' ? 'Asking…' : 'Check now'}");
    expect(card).toContain('<dt className="s-label">Updates</dt>');
    expect(wt).toContain('**Updates** → **Check now**');
    expect(card).toContain('<Group label="Viewed from outside the office">');
    expect(wt).toContain('**Viewed from outside the office**');
  });
  it('the browser\'s sentences are the Bins tab\'s, and the firewall rule is the updater\'s', () => {
    expect(wt).toContain(`*${B.CHROME_LOCAL_NETWORK_SENTENCE}*`);
    expect(wt).toContain(`*${B.GATEWAY_OWN_COMPUTER_LINE}*`);
    expect(wt).toContain(`*${FIREWALL_RULE}*`);
  });
  it('the rehearsal\'s one-line break: the line exists once, in `run`, after the state folder\'s check (so the release\'s tests still pass)', () => {
    const line = 'await gw.updates.readFailure();';
    expect(cli.split(line)).toHaveLength(2);
    const run = cli.indexOf('async function run()');
    const probe = cli.indexOf('cannot write its folder', run);
    const at = cli.indexOf(line, run);
    expect(run).toBeGreaterThan(-1);
    expect(probe).toBeGreaterThan(run);
    expect(at).toBeGreaterThan(probe);
    expect(at).toBeLessThan(cli.indexOf('\n}', run));
    expect(wt).toContain(`.Replace('${line}', 'process.exit(97); // rehearsal: this build never reports healthy')`);
    // The release's own tests start `run` only with an unwritable state folder (platform.test.mjs), which fails before that line.
    const platform = read(WILSON, 'gateway', 'test', 'platform.test.mjs');
    expect((platform.match(/\[CLI, 'run'\]/g) || []).length).toBe(1);
    expect(platform).toContain('WILSON_GATEWAY_STATE_DIR: notADir');
  });
  it('every mention of a release, the workflow and its environment is spelled as the pipeline spells it', () => {
    const names = [...wt.matchAll(/\*\*WILSON [^*]*?(\d+\.\d+\.\d+)\*\*/g)];
    expect(names.length).toBeGreaterThanOrEqual(4);
    for (const [said, version] of names) {
      const p = planRelease({ event: 'push', refType: 'tag', refName: `gateway-v${version}`, dryRunInput: '', runId: '1', packageVersion: version });
      expect(said).toBe(`**${p.releaseName}**`);
    }
    const workflowName = /^name: (.+)$/m.exec(workflow)[1];
    const bold = [...wt.matchAll(/\*\*(Gateway release[^*]*)\*\*/g)].map((m) => m[1]);
    expect(bold.length).toBeGreaterThanOrEqual(2);
    for (const b of bold) expect(b).toBe(workflowName);
    const env = /^\s+environment: (\S+)$/m.exec(workflow)[1];
    const ticked = [...wt.matchAll(/`([^`\s]*gateway-release[^`\s]*)`/g)].map((m) => m[1]);
    expect(ticked.filter((t) => t === env).length).toBeGreaterThanOrEqual(2);
    for (const t of ticked) expect([env, '.github/workflows/gateway-release.yml', 'po/gw4-gateway-release']).toContain(t);
  });
  it('says what this computer did not do', () => {
    expect(wt).toMatch(/\*\*Not done here, by rule:\*\*\s+installing the MSI or either service, adding or changing a firewall rule,\s+clicking a Windows dialog, a public name or port 443 on this PC, and any\s+real release: steps 1 to 32 are yours\./);
    expect((wt.match(/<!--/g) || []).length).toBe(0);
  });
});
