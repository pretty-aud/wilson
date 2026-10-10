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
