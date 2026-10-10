// =============================================================================
// docs.test.mjs — walkthrough 61 and the GW2 hand-off held to the code's own
// words: a sentence the walkthrough quotes must be the sentence the program
// prints, a name it gives must be the name the installer, the workflow or
// the command uses. (This repository's pattern: Help is held to its words.)
// =============================================================================

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeHealthLine } from '../src/rules/health.mjs';
import { BASE_HEADERS, EXPOSED_HEADERS } from '../src/doors/http.mjs';
import { NEVER_CONFIRMED_SENTENCE } from '../src/cloud/catalogue.mjs';
import { PROXY_HEADERS } from '../src/rules/peers.mjs';
import { DEFAULT_LIMITS } from '../src/rules/limits.mjs';
import { CHANNEL_URL, RELEASE_KEYS_WIRE } from '../src/update/manifest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WILSON = path.join(HERE, '..', '..');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8').replace(/\r\n/g, '\n');
const walkthrough = read(WILSON, 'docs', 'walkthroughs', '61_file_gateway_install_windows.md');
const readme = read(WILSON, 'docs', 'walkthroughs', 'README.md');
const wxs = read(WILSON, 'gateway', 'windows', 'wix', 'Package.wxs');
const workflow = read(WILSON, '..', '.github', 'workflows', 'gateway.yml');
const cli = read(WILSON, 'gateway', 'src', 'cli.mjs');
const installer = read(WILSON, 'gateway', 'src', 'installer.mjs');

describe('walkthrough 61 (the install on a Windows PC)', () => {
  it('is in the walkthroughs\' index', () => {
    expect(readme).toMatch(/^\| 61 \| \[61_file_gateway_install_windows\.md\]\(61_file_gateway_install_windows\.md\) \| GW2: /m);
  });
  it('names SmartScreen\'s warning and the way past it (the installer is unsigned: D14 is GW4\'s)', () => {
    expect(walkthrough).toContain('**Windows protected your PC** (SmartScreen)');
    expect(walkthrough).toContain('**More info → Run anyway**');
    expect(installer).toContain('SmartScreen');
  });
  it('runs against the beta\'s cloud, whose functions base is staging\'s', () => {
    expect(walkthrough).toContain('`https://rzkirvkotslbovzbsdfh.supabase.co/functions/v1` (the beta\'s)');
  });
  it('the installer\'s names are the MSI\'s: the services, the account, the summary file, the page title', () => {
    for (const name of ['WilsonGateway', 'WilsonGatewayUpdater', 'NT SERVICE\\WilsonGateway', 'install-summary.txt', 'Enrol this gateway with WILSON', 'Show the office addresses and the certificate fingerprint']) {
      expect(walkthrough, name).toContain(name);
      expect(wxs, name).toContain(name);
    }
  });
  it('the artifact it downloads is the one the workflow uploads', () => {
    expect(workflow).toContain('name: wilson-gateway-msi-unsigned');
    expect(walkthrough).toContain('**Artifacts → wilson-gateway-msi-unsigned**');
    expect(workflow).toContain('retention-days: 7');
    expect(walkthrough).toContain('kept seven days');
  });
  it('the command\'s words, as the command prints them', () => {
    expect(walkthrough).toContain('`wilson-gateway doctor`');
    expect(walkthrough).toContain('`wilson-gateway share-login \\\\SUSAN-FAIRCHILD\\footage`');
    for (const said of ['Kept: the gateway reads', 'Run this in an administrator prompt', 'User name for', 'Password (not shown)', 'Refused peers on the office door:']) {
      expect(walkthrough, said).toContain(said);
      expect(cli, said).toContain(said);
    }
  });
  it('the health line\'s phrases, as the gateway composes them', () => {
    const now = Date.now();
    const line = composeHealthLine({ now, name: 'PC', version: '0.1.0', lastSyncAt: now, inside: { state: 'open', addresses: [{ address: '192.168.1.173', port: 8443 }] }, outside: { state: 'closed_switch_off' }, locations: [{ name: 'Footage', state: 'not_connected' }], certificate: null, update: { state: 'disabled' } }).text;
    for (const phrase of ['office door open (192.168.1.173:8443)', 'outside door closed (the switch is off)', 'Footage: not connected (run share-login)', 'updates off until a release key is set']) {
      expect(line, phrase).toContain(phrase);
      expect(walkthrough, phrase).toContain(phrase);
    }
  });
  it('says the office door refuses its own computer, by design, and checks the outside door from a phone on mobile data', () => {
    expect(walkthrough).toMatch(/It does not load\. \*\*That is by design\*\*/);
    expect(walkthrough).toMatch(/[Yy]our phone on \*\*mobile data\*\* \(Wi-Fi off\)/);
    expect(walkthrough).toContain('nothing listens on 8444');
  });
  it('never asks for real footage, and says what this computer could not do', () => {
    expect(walkthrough).toContain('No real footage: any short MP4.');
    expect(walkthrough).toMatch(/\*\*Not done here, by\s+rule:\*\* installing the MSI or either service, adding or changing a firewall\s+rule, clicking a Windows dialog\./);
  });
});

describe('the GW2 hand-off (docs/sessions/handoffs/po-gw2-2026-10-10.md), held to the code', () => {
  const handoff = read(WILSON, 'docs', 'sessions', 'handoffs', 'po-gw2-2026-10-10.md');
  const design = read(WILSON, 'docs', 'design', 'GATEWAY_DESIGN.md');
  const outstanding = read(WILSON, 'docs', 'OUTSTANDING.md');
  const http = read(WILSON, 'gateway', 'src', 'doors', 'http.mjs');
  const fakeCloud = read(WILSON, 'gateway', 'test', 'fakeCloud.mjs');
  const dockerfile = read(WILSON, 'gateway', 'container', 'Dockerfile');
  const tools = read(WILSON, 'gateway', '.config', 'dotnet-tools.json');

  it('is in the protocol\'s order (§4), with "For GW3", "For GW4", "For GW5", "Deferred" and "Known limits" after §3, as the post-overhaul hand-offs place them', () => {
    const heads = [...handoff.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(heads).toEqual([
      '1. Where you are', '2. State, measured, not remembered', '3. Done and verified',
      'For GW3 (the web app)', 'For GW4 (the release and the install stories)', 'For GW5 (what GW2 could not attack here)', 'Deferred', 'Known limits',
      '4. In flight', '5. Traps hit', '6. Waiting on Audrey', '7. Next session\'s first three steps', '8. Auto-memory: none.',
    ]);
    expect(handoff).not.toMatch(/\{\{[A-Z0-9_]+\}\}/); // no placeholder left
  });
  it('the headers every answer carries, and CORS, as http.mjs sends them', () => {
    for (const [k, v] of Object.entries(BASE_HEADERS)) expect(handoff, k).toContain(`\`${k}: ${v}\``);
    expect(handoff).toContain(`\`Access-Control-Expose-Headers: ${EXPOSED_HEADERS}\``);
    for (const said of ["'Access-Control-Allow-Methods': 'GET, HEAD, POST'", "'Access-Control-Allow-Headers': 'Range, Content-Type'", "'Access-Control-Max-Age': '600'"]) expect(http, said).toContain(said);
    for (const said of ['`Access-Control-Allow-Methods: GET, HEAD, POST`', '`Access-Control-Allow-Headers: Range, Content-Type`', '`Access-Control-Max-Age: 600`']) expect(handoff, said).toContain(said);
  });
  it('the statuses\' numbers are the limits\' and the sentence is the catalogue\'s', () => {
    expect(handoff).toContain(`\`${NEVER_CONFIRMED_SENTENCE}\``);
    expect(handoff).toContain(`the ${PROXY_HEADERS.length} in \`gateway/src/rules/peers.mjs\` \`PROXY_HEADERS\``);
    expect(handoff).toContain(`the ${DEFAULT_LIMITS.authFailuresPerConnection}th on one connection is answered with \`Connection: close\``);
    expect(handoff).toContain(`${DEFAULT_LIMITS.outside.newConnectionsPerMinutePerPeer} new connections a minute per address outside, ${DEFAULT_LIMITS.inside.newConnectionsPerMinutePerPeer} inside`);
    expect(handoff).toContain(`One connection serves at most ${DEFAULT_LIMITS.requestsPerConnection.toLocaleString('en-US')} requests`);
    expect(handoff).toContain(`${DEFAULT_LIMITS.perPersonRequestsPerMinute} requests a minute per person`);
    expect(handoff).toContain(`${DEFAULT_LIMITS.perPersonStreams} concurrent responses per person`);
    expect(handoff).toContain(`${DEFAULT_LIMITS.outsideBytesPerHourPerPerson / 1e9} GB an hour`);
    expect(handoff).toContain(`413 when the body is over ${DEFAULT_LIMITS.bodyBytes / 1024} KB`);
  });
  it('the fake cloud\'s control routes it names are the fake\'s', () => {
    const named = [...handoff.matchAll(/`(?:GET |POST )?\/_control\/([a-z]+)/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThanOrEqual(10);
    for (const a of new Set(named)) expect(fakeCloud, a).toContain(`action === '${a}'`);
    expect(handoff).toContain('`node WILSON/gateway/test/fakeCloud.mjs --port 9443 --dir <scratch>/fc`');
    expect(fakeCloud).toContain("arg('--port'");
  });
  it('For GW4: the release key slots empty, the channel, WiX, the base image, the install\'s order', () => {
    expect(RELEASE_KEYS_WIRE).toEqual([]);
    expect(handoff).toContain(`(\`${CHANNEL_URL}\``);
    expect(JSON.parse(tools).tools.wix.version).toBe('5.0.2');
    expect(handoff).toContain('pinned to 5.0.2');
    expect(dockerfile).toMatch(/^FROM gcr\.io\/distroless\/nodejs24-debian12:nonroot$/m);
    expect(handoff).toContain('`gcr.io/distroless/nodejs24-debian12:nonroot`');
    let at = -1;
    for (const action of ['SetStateOwner', 'SetStateAcl', 'FreshPipeKey', 'WriteEnrolFile']) {
      expect(wxs, action).toContain(`<Custom Action="${action}"`);
      const i = handoff.indexOf(`(\`${action}\``);
      expect(i, action).toBeGreaterThan(at);
      at = i;
    }
  });
  it('the design\'s review history has GW2\'s dated lines, and no comment marker crept into the long documents', () => {
    expect(design).toContain('### GW2, the gateway program (2026-10-10): where the built program no longer matches the text above');
    expect((design.match(/<!--/g) || []).length).toBe(0);
    expect((outstanding.match(/<!--/g) || []).length).toBe(4);
    expect((readme.match(/<!--/g) || []).length).toBe(0);
  });
  it('OUTSTANDING\'s session log has GW2\'s row at the top', () => {
    const log = outstanding.slice(outstanding.indexOf('## Session log'));
    const firstRow = log.split('\n').find((l) => l.startsWith('| Post-overhaul') || l.startsWith('| Track') || l.startsWith('| UI'));
    expect(firstRow).toMatch(/^\| Post-overhaul GW2 \(2026-10-10; `po\/gw2-gateway-service` into `feat\/post-overhaul-edit-versioning`\)/);
  });
});
