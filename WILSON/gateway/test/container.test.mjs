// =============================================================================
// container.test.mjs — what the image and the CI job promise, read from their
// files (the image itself is built and run in CI: gateway.yml's container job;
// Docker is not installed on the computer GW2 was built on).
// =============================================================================

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SENTENCES } from '../src/rules/interfaces.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GW = path.join(HERE, '..');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8').replace(/\r\n/g, '\n');
const dockerfile = read(GW, 'container', 'Dockerfile');
const ignore = read(GW, '.dockerignore').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
const workflow = read(GW, '..', '..', '.github', 'workflows', 'gateway.yml');
const instructions = dockerfile.split('\n').filter((l) => /^[A-Z]+\s/.test(l));

describe('the image (container/Dockerfile)', () => {
  it('a minimal Node 24 base with no shell, run as its non-root user, never root', () => {
    expect(instructions.find((l) => l.startsWith('FROM '))).toBe('FROM gcr.io/distroless/nodejs24-debian12:nonroot');
    const users = instructions.filter((l) => l.startsWith('USER '));
    expect(users).toEqual(['USER 65532:65532']);
  });
  it('says it is the image (the bridge rule needs to know), and sizes the pool for a stalling share', () => {
    expect(dockerfile).toMatch(/ENV WILSON_GATEWAY_IMAGE=1 \\/);
    expect(dockerfile).toMatch(/UV_THREADPOOL_SIZE=32/);
  });
  it('carries the gateway\'s own files only: package.json, src, updater; no tests, no Windows pieces', () => {
    const copies = instructions.filter((l) => l.startsWith('COPY '));
    expect(copies).toEqual(['COPY --chown=0:0 package.json /app/package.json', 'COPY --chown=0:0 src /app/src', 'COPY --chown=0:0 updater /app/updater']);
    for (const x of ['test', 'windows', '.wix', '.config']) expect(ignore).toContain(x);
  });
  it('/data is its state; the command is `run`; the health check is the doctor', () => {
    expect(dockerfile).toMatch(/^VOLUME \["\/data"\]$/m);
    expect(dockerfile).toMatch(/^ENTRYPOINT \["\/nodejs\/bin\/node", "\/app\/src\/cli\.mjs"\]$/m);
    expect(dockerfile).toMatch(/^CMD \["run"\]$/m);
    expect(dockerfile).toMatch(/^HEALTHCHECK .*"doctor"\]$/m);
  });
});

describe('the CI job (gateway.yml)', () => {
  it('runs the gateway\'s tests on Windows and Ubuntu', () => {
    expect(workflow).toMatch(/os: \[windows-latest, ubuntu-latest\]/);
    expect(workflow).toMatch(/npx vitest run gateway/);
  });
  it('the bridge run looks for the code\'s own sentence', () => {
    const grep = /grep -q "([^"]+)" \|\| \{ echo 'no bridge sentence'/.exec(workflow);
    expect(grep).not.toBeNull();
    expect(SENTENCES.bridge).toContain(grep[1].replace(/\\u2019/g, '’'));
  });
  it('the serving run is on the host\'s network, with the share mounted read-only by the mount rule, and checks the real peer address', () => {
    expect(workflow).toMatch(/docker run -d --name gw-host --network host/);
    expect(workflow).toMatch(/-v \/tmp\/share:\/locations\/nas\/footage:ro/);
    expect(workflow).toMatch(/grep -q "\\"peer\\":\\"\$LAN\\""/);
    expect(workflow).toMatch(/the office door closed this host's own address before TLS/);
    expect(workflow).toMatch(/switch off: the outside port refuses/);
  });
  it('builds the MSI and asserts the virtual service account, the order of the custom actions and the office door\'s rule', () => {
    expect(workflow).toMatch(/WilsonGateway\|NT SERVICE\\WilsonGateway\|WilsonGateway/);
    expect(workflow).toMatch(/custom actions out of order/);
    expect(workflow).toMatch(/WILSON Gateway office door\|LocalSubnet\|8443\|6/);
  });
});
