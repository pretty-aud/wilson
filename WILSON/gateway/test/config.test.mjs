// =============================================================================
// config.test.mjs — config.json's checks (config.mjs) and the command's
// enrolment end to end (cli.mjs, a child process against the fake cloud over
// HTTPS on loopback), the package's own shape.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseConfig, declaredProxyOf, inStateDir, DEFAULT_CONFIG } from '../src/config.mjs';
import { platformName } from '../src/version.mjs';
import { createFakeCloud, serveFakeCloud } from './fakeCloud.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'src', 'cli.mjs');

describe('config.json (config.mjs)', () => {
  it('the defaults: 8443 inside, 8444 outside, no proxy, the gateway\'s own certificates', () => {
    const { config, problems } = parseConfig('');
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(config.inside.port).toBe(8443);
    expect(config.outside.port).toBe(8444);
    expect(config.outside.behind_local_proxy).toBe(false);
    expect(problems).toEqual([]);
  });
  it('not JSON: the defaults, and the problem named', () => {
    const { config, problems } = parseConfig('{ nope');
    expect(config.inside.port).toBe(8443);
    expect(problems).toEqual(['config.json is not JSON: the defaults are used']);
  });
  it('each setting is taken only in its shape; the rest is named, never half-applied', () => {
    const { config, problems } = parseConfig(JSON.stringify({
      cloud_url: 'http://insecure.example/functions/v1', name: '  Studio NAS  ',
      inside: { port: 70000, addresses: ['192.168.1.10', 7], certificate: { cert: '../../etc/x.pem', key: 'k.pem' } },
      outside: { port: 9444, behind_local_proxy: 'yes', declared_proxy: { addresses: ['not-an-ip'], name: 'Tunnel' }, certificate: { cert: 'out.pem', key: 'out-key.pem' } },
      limits: { perPersonStreams: 0, connections: 500 },
    }));
    expect(config.cloud_url).toBeNull();
    expect(config.name).toBe('Studio NAS');
    expect(config.inside.port).toBe(8443);
    expect(config.inside.addresses).toBeNull();
    expect(config.inside.certificate).toBeNull();
    expect(config.outside.port).toBe(9444);
    expect(config.outside.behind_local_proxy).toBe(false);
    expect(config.outside.declared_proxy).toBeNull();
    expect(config.outside.certificate).toEqual({ cert: 'out.pem', key: 'out-key.pem' });
    expect(problems).toEqual([
      'cloud_url (an https:// address)',
      'inside.port',
      'inside.addresses (a list of addresses)',
      'inside.certificate (two file names in the state folder: { "cert": "…pem", "key": "…pem" })',
      'outside.behind_local_proxy',
      'outside.declared_proxy ({ "addresses": ["…"], "name": "…" })',
      'limits.perPersonStreams',
    ]);
  });
  it('limits: config.json may lower a limit, never past its floor (review round 2, R2-2: a planted "connections": 1 shut the doors)', () => {
    const { limits, problems } = parseConfig(JSON.stringify({ limits: { connections: 1, streams: 3, authFailuresPerConnection: 0, requestsPerConnection: 5, perPersonRequestsPerMinute: 120, outside: { newConnectionsPerMinutePerPeer: 1 } } }));
    expect(limits.connections).toBe(400);
    expect(limits.streams).toBe(200);
    expect(limits.authFailuresPerConnection).toBe(10);
    expect(limits.requestsPerConnection).toBe(1000);
    expect(limits.perPersonRequestsPerMinute).toBe(120); // above its floor: taken
    expect(limits.outside.newConnectionsPerMinutePerPeer).toBe(60);
    expect(problems).toEqual(['limits.connections (at least 16)', 'limits.streams (at least 8)', 'limits.authFailuresPerConnection', 'limits.requestsPerConnection (at least 10)', 'limits.outside.newConnectionsPerMinutePerPeer (at least 4)']);
  });
  it('connect_without_login: server names only (lower-cased, at most 16); anything else named and not applied', () => {
    expect(parseConfig(JSON.stringify({ connect_without_login: ['NAS01', 'nas.corp.example.com', 'nas01'] })).config.connect_without_login).toEqual(['nas01', 'nas.corp.example.com']);
    for (const bad of [['evil.example.com@SSL@443'], ['?'], ['nas', 7], 'nas', ['\\\\nas'], Array.from({ length: 17 }, (_, i) => `nas${i}`)]) {
      const { config, problems } = parseConfig(JSON.stringify({ connect_without_login: bad }));
      expect(config.connect_without_login, JSON.stringify(bad)).toEqual([]);
      expect(problems[0], JSON.stringify(bad)).toMatch(/^connect_without_login \(a list of at most 16 server names/);
    }
  });
  it('behind_local_proxy exists for the OUTSIDE door only (§4): asking it of the inside door is refused by name', () => {
    const { config, problems } = parseConfig(JSON.stringify({ inside: { behind_local_proxy: true } }));
    expect(config.inside).not.toHaveProperty('behind_local_proxy');
    expect(problems[0]).toMatch(/inside\.behind_local_proxy does not exist/);
  });
  it('the declared proxy: loopback for the NAS\'s reverse proxy, else the tunnel\'s own addresses and name', () => {
    expect(declaredProxyOf(parseConfig(JSON.stringify({ outside: { behind_local_proxy: true } })).config)).toEqual({ addresses: ['127.0.0.1', '::1'], name: 'local_proxy' });
    expect(declaredProxyOf(parseConfig(JSON.stringify({ outside: { declared_proxy: { addresses: ['127.0.0.1', '::ffff:10.0.0.9'], name: ' Cloudflare Tunnel ' } } })).config)).toEqual({ addresses: ['127.0.0.1', '10.0.0.9'], name: 'Cloudflare Tunnel' });
    expect(declaredProxyOf(parseConfig('').config)).toBeNull();
  });
  it('a valid https cloud address is kept without a trailing slash; ports 0–65535; at most sixteen pinned addresses; a name of at most 80', () => {
    const { config } = parseConfig(JSON.stringify({ cloud_url: 'https://x.supabase.co/functions/v1/', inside: { port: 0, addresses: Array.from({ length: 20 }, (_, i) => `10.0.0.${i + 1}`) }, name: 'n'.repeat(100) }));
    expect(config.cloud_url).toBe('https://x.supabase.co/functions/v1');
    expect(config.inside.port).toBe(0);
    expect(config.inside.addresses).toHaveLength(16);
    expect(config.name).toHaveLength(80);
  });
  it('a certificate file is a name inside the state folder, never a path out of it', () => {
    const dir = path.join(os.tmpdir(), 'gw2-state-x');
    expect(inStateDir(dir, 'inside.pem')).toBe(path.join(dir, 'inside.pem'));
    expect(inStateDir(dir, '../outside.pem')).toBeNull();
    expect(inStateDir(dir, path.resolve('/etc/passwd'))).toBeNull();
  });
  it('the platform the gateway reports: container in the image, windows on Windows, container elsewhere', () => {
    expect(platformName({ WILSON_GATEWAY_IMAGE: '1' }, 'win32')).toBe('container');
    expect(platformName({}, 'win32')).toBe('windows');
    expect(platformName({}, 'linux')).toBe('container');
  });
});

describe('the command enrols, end to end (cli.mjs against the fake cloud over HTTPS)', () => {
  let fc;
  let cloud;
  let tmp;
  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-cli-'));
    cloud = createFakeCloud();
    fc = await serveFakeCloud(cloud, { dir: path.join(tmp, 'fc') });
  });
  afterAll(async () => { await fc.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  const run = (args, env) => new Promise((resolve) => {
    const c = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, NODE_EXTRA_CA_CERTS: fc.caFile, ...env } });
    let out = ''; let err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => resolve({ code, out, err }));
  });
  it('enrol <token> --cloud <url>: enrolled, the fingerprint printed to type in WILSON, the token spent; again: refused', async () => {
    const state = path.join(tmp, 'state1');
    const token = cloud.newToken();
    const r = await run(['enrol', token, '--cloud', fc.url], { WILSON_GATEWAY_STATE_DIR: state });
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^Enrolled in Salt Hours Studio \(gateway [0-9a-f-]{36}\)\.$/m);
    expect(r.out).toMatch(/^Certificate fingerprint \(SHA-256\): ([0-9A-F]{2}:){31}[0-9A-F]{2}$/m);
    expect(r.out).toMatch(/Type or paste this fingerprint in WILSON/);
    expect(JSON.parse(fs.readFileSync(path.join(state, 'state.json'), 'utf8')).cloud_url).toBe(fc.url);
    const again = await run(['enrol', token, '--cloud', fc.url], { WILSON_GATEWAY_STATE_DIR: path.join(tmp, 'state2') });
    expect(again.code).toBe(1);
    expect(again.err).toMatch(/used already or is older than 24 hours/);
  }, 60_000);
  it('a cloud that is not https is refused before any call', async () => {
    const r = await run(['enrol', cloud.newToken(), '--cloud', 'http://127.0.0.1:1/functions/v1'], { WILSON_GATEWAY_STATE_DIR: path.join(tmp, 'state3') });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/https/);
  }, 60_000);
});
