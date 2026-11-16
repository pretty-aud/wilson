// =============================================================================
// gw4Docs.test.mjs — GW4's documents held to the code, as GW2's docs.test.mjs
// holds GW2's: the design's §8 (changed in place by GW4) and its GW4 dated
// lines (the channel, the hops, the hosts, the renewal's numbers, the empty
// second key slot), and walkthrough 61's note that sends its reader to 63.
// =============================================================================

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANNEL_URL, CONTAINER_IMAGE, RELEASE_KEYS_WIRE, RELEASE_KEY_SLOTS } from '../src/update/manifest.mjs';
import { RELEASE_HOSTS, MAX_REDIRECTS } from '../src/update/releaseFetch.mjs';
import { RENEW_BEFORE_MAX_MS, BACKOFF_MS, MAX_ATTEMPTS_PER_HOUR, MAX_RETRY_AFTER_MS } from '../src/acme/manager.mjs';
import { REQUEST_DEADLINE_MS } from '../src/acme/client.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WILSON = path.join(HERE, '..', '..');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8').replace(/\r\n/g, '\n');
const design = read(WILSON, 'docs', 'design', 'GATEWAY_DESIGN.md');
const WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
const hosts = RELEASE_HOSTS.map((h) => `\`${h}\``).join(', ');
const GW4_HEADING = '### GW4, the release and the install stories (2026-10-11): where the built release no longer matches the text above';

describe('the design after GW4: §8 changed in place', () => {
  const s8 = design.split('\n').find((l) => l.startsWith('**The release channel** **[D13]**'));
  it('names the channel, the image, and the redirect rule as releaseFetch keeps it', () => {
    expect(s8).toBeTruthy();
    expect(s8).toContain(`\`${CHANNEL_URL}\``);
    expect(s8).toContain(`\`${CONTAINER_IMAGE}\``);
    expect(s8).toContain(`HTTPS only, at most ${WORD[MAX_REDIRECTS]} hops, and every hop's host exactly one of GitHub's (${hosts})`);
    expect(s8).toContain('the signature is fetched from the release the manifest came from (GW4)');
  });
});

describe('the design\'s GW4 dated lines', () => {
  const at = design.indexOf(GW4_HEADING);
  const gw4 = design.slice(at);
  it('the heading follows GW3\'s, once, and names the hand-off', () => {
    expect(at).toBeGreaterThan(design.indexOf('### GW3'));
    expect(design.split(GW4_HEADING)).toHaveLength(2);
    expect(gw4).toContain('its hand-off is `docs/sessions/handoffs/po-gw4-2026-10-11.md`');
  });
  it('fourteen numbered lines, each opening with the section it departs from', () => {
    const lines = [...gw4.matchAll(/^(\d+)\. \*\*(§|D)/gm)].map((m) => Number(m[1]));
    expect(lines).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });
  it('the redirect rule and the renewal\'s numbers are the code\'s', () => {
    expect(gw4).toContain(`(HTTPS only, at most ${WORD[MAX_REDIRECTS]} hops, every hop's host one of ${hosts})`);
    expect(RENEW_BEFORE_MAX_MS).toBe(30 * 86_400_000);
    expect(gw4).toContain('Renewal is a third of the certificate\'s life before its end, at most 30 days');
    expect(BACKOFF_MS).toEqual([60_000, 600_000, 3_600_000, 21_600_000]);
    expect(MAX_ATTEMPTS_PER_HOUR).toBe(6);
    expect(gw4).toContain(`failures back off 1 minute, 10 minutes, an hour, then 6 hours, at most ${WORD[MAX_ATTEMPTS_PER_HOUR]} attempts an hour`);
  });
  it('row 14\'s "second pinned key" against the slots as built: one key, the second slot empty', () => {
    expect(RELEASE_KEY_SLOTS).toBe(2);
    expect(RELEASE_KEYS_WIRE).toHaveLength(1);
    expect(gw4).toMatch(/^12\. \*\*§10 row 14, the compromise procedure:\*\* /m);
    expect(gw4).toContain('the second slot is empty');
    expect(gw4).toContain('a release that compiles it in, signed by the old key, or with an MSI installed by hand');
  });
  it('round 1\'s corrections are in the lines: the floors, the installer, the key\'s place, the CA\'s pace, the updater\'s keys', () => {
    expect(gw4).toContain('and (review rounds 1 and 2) a release that is not above every published gateway release');
    expect(gw4).toContain('the signed version list also names the installer (`installer: { url, sha256, size }`, which gateways ignore), and the read-back holds the MSI to it');
    expect(gw4).toContain('the key being that environment\'s secret and never a repository secret, which every workflow could read');
    expect(MAX_RETRY_AFTER_MS).toBe(7 * 86_400_000);
    expect(REQUEST_DEADLINE_MS).toBe(120_000);
    expect(gw4).toContain('(honoured for at most seven days, the longest of Let\'s Encrypt\'s windows: review round 1), and no request to the CA lasts more than two minutes');
    expect(gw4).toContain('And the updater, which only the MSI installs, keeps the keys it was installed with');
  });
  it('round 2\'s corrections are in the lines: the lower list, the checks, the installer, the image\'s tag, the updater\'s pipe, the channel', () => {
    expect(gw4).toContain('And it never takes a list whose version is below the last one it took, whatever its date');
    expect(gw4).toContain('asked in the plan job before anything is built or pushed, again before the key is read, before the publish and after it');
    expect(gw4).toContain('nothing proves a first install\'s origin until the installer carries a signature');
    expect(gw4).toContain('no moving `stable` tag');
    expect(gw4).toMatch(/^13\. \*\*§8, the updater's pipe and rollback:\*\*/m);
    expect(gw4).toMatch(/^14\. \*\*§8, the channel and the repository's Latest:\*\*/m);
    const updater = read(WILSON, 'gateway', 'updater', 'updater.mjs');
    for (const c of ['swap', 'rollback', 'firewall_open', 'firewall_close', 'smb_dialects']) {
      expect(updater, c).toContain(`case '${c}':`);
      expect(gw4, c).toContain(`\`${c}\``);
    }
  });
  it('no comment marker in the design', () => {
    expect((design.match(/<!--/g) || []).length).toBe(0);
  });
});

describe('walkthrough 61\'s GW4 note', () => {
  const wt61 = read(WILSON, 'docs', 'walkthroughs', '61_file_gateway_install_windows.md');
  const wt63 = read(WILSON, 'docs', 'walkthroughs', '63_file_gateway_release_and_rehearsal.md');
  const health = read(WILSON, 'gateway', 'src', 'rules', 'health.mjs');
  it('sends its reader to walkthrough 63\'s install steps, before its own text', () => {
    expect(wt61).toMatch(/\*\*Since GW4 \(2026-10-11\)\.\*\* Install from the Releases page rather than\s+the Actions artifact: walkthrough 63, steps 10 to 15, does it/);
    expect(wt61.indexOf('**Since GW4')).toBeLessThan(wt61.indexOf('Written 2026-10-10'));
    expect(wt63).toMatch(/^\| 10 \| If walkthrough 61's install is on this PC/m);
    expect(wt63).toMatch(/^\| 15 \| Administrator PowerShell: `wilson-gateway share-login/m);
  });
  it('the health line\'s ending it names is the code\'s, now that a key is built in', () => {
    expect(RELEASE_KEYS_WIRE.length).toBeGreaterThan(0);
    expect(health).toContain("text: 'updates off until a release key is set'");
    expect(wt61).toMatch(/ends \*up to date\*, not \*updates off\s+until a release key is set\*/);
  });
});

describe('the GW4 hand-off (docs/sessions/handoffs/po-gw4-2026-10-11.md), held to the code', () => {
  const handoff = read(WILSON, 'docs', 'sessions', 'handoffs', 'po-gw4-2026-10-11.md');
  const outstanding = read(WILSON, 'docs', 'OUTSTANDING.md');
  const wt63 = read(WILSON, 'docs', 'walkthroughs', '63_file_gateway_release_and_rehearsal.md');
  const guide = read(WILSON, 'docs', 'gateway', 'HARDENING.md');
  it('is in the protocol\'s order (§4), with "For GW5", "Deferred" and "Known limits" after §3, as the post-overhaul hand-offs place them', () => {
    const heads = [...handoff.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(heads).toEqual([
      '1. Where you are', '2. State, measured, not remembered', '3. Done and verified',
      'For GW5 (what to attack in the release path)', 'Deferred', 'Known limits',
      '4. In flight', '5. Traps hit', '6. Waiting on Audrey', '7. Next session\'s first three steps', '8. Auto-memory: none.',
    ]);
    expect(handoff).not.toMatch(/\{\{[A-Z0-9_]+\}\}/); // no placeholder left
    expect((handoff.match(/<!--/g) || []).length).toBe(0);
  });
  it('says which model ran the session and its two review rounds', () => {
    expect(handoff).toContain('Claude Opus 5.5 (`claude-opus-5-5`)');
    expect(handoff).toContain('**The two reviewer subagents ran on `model: "opus"` (Opus 5.5), not Fable**');
    expect(handoff).toMatch(/### Review round 1 \(one reviewer on `model: "opus"`/);
    expect(handoff).toMatch(/### Review round 2 \(one reviewer on `model: "opus"`/);
  });
  it('names the release key\'s FILE and its public half, and no document carries a private key', () => {
    // Named where the state is told (§2) and where Audrey is asked (§6).
    for (const [from, to] of [['## 2. State', '## 3. Done'], ['## 6. Waiting on Audrey', '## 7. ']]) {
      expect(handoff.slice(handoff.indexOf(from), handoff.indexOf(to)), from).toContain('`C:\\Users\\Audrey\\Desktop\\WILSON walkthroughs\\Post-overhaul\\00_GATEWAY_RELEASE_KEY.txt`');
    }
    expect(handoff).toContain(`**kid \`${RELEASE_KEYS_WIRE[0].kid}\`, public key \`${RELEASE_KEYS_WIRE[0].public_key}\`**`);
    // An Ed25519 private key as PKCS#8 in base64 always begins so; none in anything GW4 wrote.
    for (const [name, text] of Object.entries({ handoff, wt63, guide, design, outstanding })) expect(text, name).not.toMatch(/MC4CAQAwBQYDK2VwBCIEI[A-Za-z0-9+/]{10}/);
  });
  it('the dry run it reports is the walkthrough\'s, and its throwaway key is the job\'s public half only', () => {
    for (const [from, to] of [['## 2. State', '## 3. Done'], ['## 6. Waiting on Audrey', '## 7. ']]) {
      expect(handoff.slice(handoff.indexOf(from), handoff.indexOf(to)), from).toContain('**gateway-dry-run-38189270049**');
    }
    expect(wt63).toContain('**gateway-dry-run-38189270049**');
    expect(handoff).toContain('`x3oa92MEtCDdCAd4XFj+M/LA9sF8jYQ3dz6zB7xcuLo=`');
  });
  // Post-overhaul FX3 (2026-10-12) loosened "on top" to "in the log, right
  // above GW3's": the log takes new rows at the top, so a later session's row
  // sits above this one (as GW3 loosened GW2's pin).
  it('OUTSTANDING\'s session log has GW4\'s row, right above GW3\'s, and the comment markers stay four', () => {
    const log = outstanding.slice(outstanding.indexOf('## Session log'));
    const rows = log.split('\n').filter((l) => l.startsWith('| Post-overhaul') || l.startsWith('| Track') || l.startsWith('| UI'));
    const i = rows.findIndex((l) => /^\| Post-overhaul GW4 \(2026-10-11; `po\/gw4-gateway-release` into `feat\/post-overhaul-edit-versioning`\)/.test(l));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(rows[i + 1]).toMatch(/^\| Post-overhaul GW3 /);
    expect((outstanding.match(/<!--/g) || []).length).toBe(4);
  });
});
