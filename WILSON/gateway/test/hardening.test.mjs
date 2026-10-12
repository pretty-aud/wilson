// =============================================================================
// hardening.test.mjs — GW4 item 5 (and item 4's facts): the hardening guide
// (docs/gateway/HARDENING.md) and the two install stories (gatewayWords.js)
// held to the gateway's own code and to the designs they quote, as GW2's
// docs.test.mjs holds walkthrough 61: a sentence quoted must be the sentence,
// a config line given must parse to what it says, a name must be the name the
// installer, the updater, the workflow or the image uses.
// =============================================================================

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseConfig, DEFAULT_CONFIG } from '../src/config.mjs';
import { FIREWALL_RULE } from '../updater/updater.mjs';
import { RELEASE_HOSTS } from '../src/update/releaseFetch.mjs';
import { LETS_ENCRYPT_DIRECTORY } from '../src/acme/client.mjs';
import { renewAt } from '../src/acme/manager.mjs';
import { outsideCertificateWarning } from '../src/rules/health.mjs';
import { CONTAINER_IMAGE, RELEASE_REPOSITORY } from '../src/update/manifest.mjs';
import { SKEW_S } from '../src/wire/ticket.mjs';
import { SMARTSCREEN_SUMMARY } from '../src/installer.mjs';
import { msiName } from '../pipeline/lib.mjs';
import { containerRootFor } from '../src/rules/mountRule.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WILSON = path.join(HERE, '..', '..');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8').replace(/\r\n/g, '\n');
const flat = (s) => s.replace(/^>\s?/gm, '').replace(/\s+/g, ' ').trim();
const guide = read(WILSON, 'docs', 'gateway', 'HARDENING.md');
const design = read(WILSON, 'docs', 'design', 'GATEWAY_DESIGN.md');
const storage = read(WILSON, 'docs', 'NETWORK_STORAGE_DESIGN.md');
const wxs = read(WILSON, 'gateway', 'windows', 'wix', 'Package.wxs');
const host = read(WILSON, 'gateway', 'windows', 'host', 'WilsonGatewayHost.cs');
const dockerfile = read(WILSON, 'gateway', 'container', 'Dockerfile');
const pipeline = read(WILSON, 'gateway', 'pipeline', 'cli.mjs');
const W = await import(pathToFileURL(path.join(WILSON, 'src', 'components', 'settings', 'gatewayWords.js')).href);
const story = (s) => [s.intro, ...s.steps.flatMap((st) => [`${st.lead} ${st.text}`, ...(st.items || []).map((i) => `${i.lead} ${i.text}`)]), ...s.after.map((a) => `${a.lead} ${a.text}`)].join(' ');
const nas = story(W.NAS_STORY);
const win = story(W.WINDOWS_STORY);

describe('the hardening guide quotes its sources word for word', () => {
  it('the design\'s closing sentence block (§10), verbatim', () => {
    const block = design.split('\n').find((l) => l.startsWith('> A person who may view a clip can save what they view'));
    expect(block).toBeTruthy();
    expect(guide).toContain(block);
  });
  it('the four TS-2 conditions of the storage design (§4b), verbatim', () => {
    const at = storage.indexOf('1. **Off by default.**');
    const conditions = storage.slice(at, storage.indexOf('Recording it this way', at)).trim();
    const quoted = guide.slice(guide.indexOf('> 1. **Off by default.**'), guide.indexOf('How the built gateway keeps them'));
    expect(flat(quoted)).toBe(flat(conditions));
    expect(flat(conditions)).toMatch(/^1\. \*\*Off by default\.\*\*.+4\. \*\*The gateway does not weaken the LAN path\.\*\*.+does not exist\.$/);
  });
  it('is the page Help links to, and it names itself as the published hardening guidance TPN asks for', () => {
    expect(guide.split('\n')[0]).toBe('# The WILSON file gateway: the hardening guide');
    expect(W.HARDENING_GUIDE_URL).toBe(`https://github.com/${RELEASE_REPOSITORY}/blob/main/WILSON/docs/gateway/HARDENING.md`);
    expect(guide).toContain('published hardening guidance');
    expect((guide.match(/<!--/g) || []).length).toBe(0);
  });
});

describe('every setting it gives parses to what it says (config.mjs)', () => {
  const lines = [...guide.matchAll(/`(\{? ?"(?:outside|inside|connect_without_login)"[^`]*)`/g)].map((m) => m[1]);
  it('finds the five lines', () => {
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });
  const parse = (line) => parseConfig(line.startsWith('{') ? line : `{ ${line} }`);
  it('the NAS\'s reverse proxy: the outside door on loopback, and the free certificate off behind it', () => {
    const r = parse(lines.find((l) => l.includes('behind_local_proxy')));
    expect(r.problems).toEqual([]);
    expect(r.config.outside.behind_local_proxy).toBe(true);
  });
  it('a tunnel: the declared proxy, by one of the names the cloud keeps', () => {
    const r = parse(lines.find((l) => l.includes('declared_proxy')));
    expect(r.problems).toEqual([]);
    expect(r.config.outside.declared_proxy).toEqual({ addresses: ['127.0.0.1'], name: 'cloudflare' });
    const sql = read(WILSON, 'supabase', 'migrations', fs.readdirSync(path.join(WILSON, 'supabase', 'migrations')).find((f) => f.startsWith('0093_')));
    for (const name of ['cloudflare', 'tailscale', 'ngrok']) { expect(sql, name).toContain(`'${name}'`); expect(guide).toContain(`\`${name}\``); }
  });
  it('the company\'s own certificate for either door, and a domain\'s servers', () => {
    expect(parse(lines.find((l) => l.startsWith('"outside": { "certificate"'))).config.outside.certificate).toEqual({ cert: 'outside.pem', key: 'outside-key.pem' });
    const inside = parse(lines.find((l) => l.startsWith('"inside"')).replace(/…/g, 'x.pem'));
    expect(inside.config.inside.certificate).toEqual({ cert: 'x.pem', key: 'x.pem' });
    const domain = parse(lines.find((l) => l.startsWith('"connect_without_login"')));
    expect(domain.problems).toEqual([]);
    expect(domain.config.connect_without_login).toEqual(['nas']);
    expect(guide).toContain('at most 16 servers');
    expect(parseConfig(JSON.stringify({ connect_without_login: Array.from({ length: 17 }, (_, i) => `s${i}`) })).problems.join()).toContain('at most 16');
  });
  it('the doors\' ports are the defaults', () => {
    expect(DEFAULT_CONFIG.inside.port).toBe(8443);
    expect(DEFAULT_CONFIG.outside.port).toBe(8444);
  });
});

describe('every name it gives is the code\'s', () => {
  it('the services, their accounts, the firewall\'s two rules, the logs', () => {
    expect(wxs).toContain('Account="NT SERVICE\\WilsonGateway"');
    expect(wxs).toContain('Name="WilsonGatewayUpdater"');
    expect(wxs).toContain('Account="LocalSystem"');
    expect(wxs).toContain('Name="WILSON Gateway office door" Port="8443" Protocol="tcp" Scope="localSubnet"');
    expect(guide).toContain('*WILSON Gateway office door*: inbound TCP 8443, local subnet only');
    expect(FIREWALL_RULE).toBe('WILSON Gateway outside door');
    expect(guide).toContain(`*${FIREWALL_RULE}*`);
    expect(host).toContain('Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "WILSON Gateway", "logs")');
    expect(host).toContain('ServiceName + ".log"');
    expect(host).toContain('for (int i = 4; i >= 1; i--)');
    expect(guide).toContain('`C:\\ProgramData\\WILSON Gateway\\logs\\WilsonGateway.log` and `WilsonGatewayUpdater.log` (the current file and five earlier ones of 5 MB each)');
  });
  it('the container\'s user and image, and the mount rule\'s worked example', () => {
    expect(dockerfile).toMatch(/^USER 65532:65532$/m);
    expect(guide).toContain('uid 65532');
    expect(nas).toContain('uid 65532');
    expect(guide).toContain(`${CONTAINER_IMAGE}@sha256:`);
    expect(containerRootFor('\\\\nas\\footage')).toBe('/locations/nas/footage');
    expect(nas).toContain('/volume1/footage → /locations/nas/footage');
  });
  it('the release hosts, the free certificate\'s host, the releases page and its SHA256SUMS', () => {
    for (const h of RELEASE_HOSTS) expect(guide, h).toContain(`\`${h}\``);
    expect(guide).toContain(`\`${new URL(LETS_ENCRYPT_DIRECTORY).hostname}\``);
    expect(guide).toContain(`github.com/${RELEASE_REPOSITORY}/releases`);
    expect(pipeline).toContain("files.set('SHA256SUMS'");
    expect(guide).toContain('`SHA256SUMS`');
  });
  it('the numbers: 30 s of skew, the free certificate renewed a third of its life before its end, the warnings from 30 days and red from 7', () => {
    expect(SKEW_S).toBe(30);
    expect(guide).toContain('with 30 seconds of skew allowed');
    expect(renewAt({ notBefore: 0, notAfter: 90 })).toBe(60);
    expect(guide).toContain('renews it by itself a third of its life before it ends');
    const now = Date.parse('2026-10-11T00:00:00Z');
    const own = (d) => outsideCertificateWarning({ kind: 'own', until: now + d * 86_400_000 }, now);
    expect(own(31)).toBeNull();
    expect(own(30).tone).toBe('amber');
    expect(own(7).tone).toBe('red');
    expect(guide).toContain('warns 30 days before it ends, and turns red at 7');
  });
});

describe('the install stories say what the code does (GW4 item 4)', () => {
  it('the MSI\'s name is the pipeline\'s, and the summary\'s SmartScreen sentence agrees with the story\'s', () => {
    expect(msiName('<version>')).toBe('WILSON-Gateway-Setup-<version>.msi');
    expect(win).toContain(msiName('<version>'));
    expect(SMARTSCREEN_SUMMARY).toContain('More info, then Run anyway');
    expect(win).toContain('choose More info, then Run anyway');
    expect(SMARTSCREEN_SUMMARY).toContain('a signed build will stop the warning later');
    expect(win).toContain('A signed build will stop that warning later.');
    // D14: Petal never says the gateway is signed until it is.
    for (const text of [guide, win, nas, SMARTSCREEN_SUMMARY]) expect(text).not.toMatch(/\bis signed\b|signed by Petal/i);
  });
  it('the commands it names exist (cli.mjs), and the reverse proxy and tunnel point at the outside door on loopback', () => {
    const cli = read(WILSON, 'gateway', 'src', 'cli.mjs');
    for (const c of ['share-login', 'doctor', 'rollback']) { expect(cli, c).toContain(`case '${c}'`); expect(win, c).toContain(`wilson-gateway ${c}`); }
    expect(nas).toContain('https://127.0.0.1:8444');
    expect(guide).toContain('`https://127.0.0.1:8444`');
  });
  it('the environment the container is given is the names the gateway reads', () => {
    const runtime = read(WILSON, 'gateway', 'src', 'runtime.mjs');
    for (const v of ['WILSON_ENROL_TOKEN', 'WILSON_CLOUD_URL']) { expect(runtime, v).toContain(`env.${v}`); expect(nas, v).toContain(v); }
  });
});
