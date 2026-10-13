// =============================================================================
// container.test.mjs — what the image and the CI job promise, read from their
// files (the image itself is built and run in CI: gateway.yml's container job;
// Docker is not installed on the computer GW2 was built on).
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
    // GW4: pinned by digest (GW2's "For GW4"), the tag kept for the reader.
    expect(instructions.find((l) => l.startsWith('FROM '))).toMatch(/^FROM gcr\.io\/distroless\/nodejs24-debian12:nonroot@sha256:[0-9a-f]{64}$/);
    expect(instructions.filter((l) => l.startsWith('FROM '))).toHaveLength(1);
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
    const grep = /has "([^"]+)" \|\| fail 'no bridge sentence'/.exec(workflow);
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

// FX5 (2026-10-12): the container job failed at 3a17a5ec with nothing public
// but "exit code 1". Under `set -o pipefail`, `docker logs … | grep -q X`
// fails when grep exits at its first match while docker logs is still
// writing (SIGPIPE, 141), and the check's bare `exit 1` skipped the ERR trap;
// on the runner that check said a line in the log was missing 2 times in 200.
describe('the container job\'s checks (test/e2e/containerChecks.sh, FX5)', () => {
  const helperPath = path.join(GW, 'test', 'e2e', 'containerChecks.sh');
  const helper = read(helperPath);
  const job = workflow.slice(workflow.indexOf('\n  container:\n'), workflow.indexOf('\n  acme:\n'));

  // The commands, not the comments that quote the old ones. A pipe is one `|`
  // (or `|&`); `||` is not one. A reader that stops early: grep with -q, -l or
  // -m (in any cluster, anywhere among its options), head, sed q, awk's exit.
  const commands = (text) => text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const PIPE = String.raw`(?<!\|)\|&?(?!\|)`;
  const stopsEarly = [
    new RegExp(String.raw`docker\s+(?:container\s+)?logs\b[^\n|]*${PIPE}`),
    new RegExp(String.raw`${PIPE}\s*grep\b[^|\n]*\s(?:-[A-Za-z]*[qlm][A-Za-z]*|--quiet|--silent|--max-count\S*|--files-with\S*)(?=\s|$)`),
    new RegExp(String.raw`${PIPE}\s*head\b`),
    new RegExp(String.raw`${PIPE}\s*sed\b[^|\n]*\bq\b`),
    new RegExp(String.raw`${PIPE}\s*awk\b[^|\n]*\bexit\b`),
  ];
  const caught = (text) => stopsEarly.filter((r) => r.test(text)).length;
  // An exit statement, not the word in a sentence ("curl exit $?").
  const exitStatement = /(?:^\s*|[;{]\s*|\bthen\s+|&&\s*|\|\|\s*)exit\b/m;

  it('no check reads a log through a pipe, and no pipe in the workflow or the helper ends in a reader that stops early', () => {
    expect(job).toContain("has 'outside_open' || fail 'the outside door did not open'"); // the check that failed
    expect(caught(commands(workflow))).toBe(0);
    expect(caught(commands(helper))).toBe(0);
    expect(helper).toMatch(/^has\(\) \{ docker logs "\$gw_name" > "\$gw_log" 2>&1 && grep -q -- "\$1" "\$gw_log"; \}$/m);
    // The guards' controls: each shape caught, and the pipes the job does use left alone.
    for (const bad of ['docker logs gw-host 2>&1 | grep -q x', 'docker container logs gw |& grep -E -i -q x', 'ls | grep -l x', 'x | grep --max-count=1 y',
      'curl -sk x | head -c 400', 'docker logs gw 2>&1 | sed q', "x | awk '/y/ { exit }'"]) expect(caught(bad), bad).toBeGreaterThan(0);
    for (const ok of ['docker logs pebble > /tmp/pebble.log 2>&1 || true', "hostname -I | awk '{print $1}'", "grep 'outside_closed' /tmp/gw-host.log | tail -1",
      "tail -10 \"$RUNNER_TEMP/npm.log\" | sed 's/^/::error::npm ci: /'", 'has x || grep -q y f']) expect(caught(ok), ok).toBe(0);
  });

  it('every step of the job sources the helper under `set -euo pipefail`, and no failure is a bare exit', () => {
    const runs = job.split('\n      - ').filter((s) => s.includes('run: |'));
    expect(runs).toHaveLength(3); // the build, the bridge, the host
    for (const r of runs) expect(r).toMatch(/run: \|\n\s+set -euo pipefail\n\s+\. WILSON\/gateway\/test\/e2e\/containerChecks\.sh \S+/);
    expect(commands(job)).not.toMatch(exitStatement);
    for (const bad of ["|| { echo 'x'; exit 1; }", 'exit "$s"', 'then exit 2; fi']) expect(bad).toMatch(exitStatement);
    expect('echo "refused (curl exit $?)"').not.toMatch(exitStatement);
    expect(job).not.toMatch(/FX5 (probe|proof)/); // the session's measurements, removed once read
    expect(helper).toMatch(/^set -E$/m);
    expect(helper).toMatch(/^trap 'gw_report \$\?' EXIT$/m);
  });

  it('the switch-off wait waits for the close the switch makes, not any close', () => {
    expect(job).toContain(`has 'outside_closed {"reason":"closed_switch_off"' || fail`);
  });

  it('the tests job\'s npm echo can run: `shell: bash` is -eo pipefail, so the failure is caught by `||`', () => {
    expect(workflow).toContain('s=0; npm ci --ignore-scripts 2>&1 | tee "$RUNNER_TEMP/npm.log" || s=${PIPESTATUS[0]}');
    expect(workflow).not.toMatch(/tee "\$RUNNER_TEMP\/npm\.log"; s=\$\{PIPESTATUS\[0\]\}/);
  });

  describe.runIf(process.platform !== 'win32')('run by bash, with a stand-in for `docker logs` (POSIX; CI\'s Ubuntu)', () => {
    let tmp;
    let n = 0;
    const logs = []; // the helper keeps a container's log in /tmp/<name>.log, as the job does
    beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fx5-')); });
    afterAll(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
      for (const f of logs) fs.rmSync(f, { force: true });
    });
    // A running gateway's log goes on after the line a check looks for; this
    // one goes on for more than a pipe holds, so a reader that stops at its
    // first match always leaves the writer writing into a closed pipe.
    const standIn = "docker() { echo 'Certificate fingerprint (SHA-256): AA:BB'; echo 'outside_open {\"port\":8444}'; seq 1 100000; }";
    const bash = (body, { cloud = '' } = {}) => {
      const name = `fx5-${process.pid}-${(n += 1)}`;
      logs.push(`/tmp/${name}.log`);
      const r = spawnSync('bash', ['-c', `${standIn}\nset -euo pipefail\n. '${helperPath}' check ${name} ${cloud}\n${body}`], { encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: tmp }, timeout: 30_000 });
      return { status: r.status, out: r.stdout, name };
    };

    it('the old check says a line in the log is missing (141, SIGPIPE); `has` reads the log from a file and finds it', () => {
      const old = spawnSync('bash', ['-c', `${standIn}\nset -uo pipefail\ndocker logs gw 2>&1 | grep -q outside_open\necho "status $?"`], { encoding: 'utf8', timeout: 30_000 });
      expect(old.stdout.trim()).toBe('status 141');
      const now = bash("has 'outside_open' && echo found");
      expect(now.status).toBe(0);
      expect(now.out).toContain('found');
      expect(now.out).not.toContain('::error');
    });

    it('a failed check leaves annotations: its sentence, the step\'s last lines, the container\'s last 40, the fake cloud\'s, each one annotation', () => {
      const cloud = path.join(tmp, 'fc');
      fs.mkdirSync(cloud);
      fs.writeFileSync(path.join(cloud, 'out.json'), '{"url":"https://127.0.0.1:9443/functions/v1"}\n');
      const r = bash("echo 'a line before the check'\nhas 'not in this log' || fail 'the outside door did not open'\necho never", { cloud });
      expect(r.status).toBe(1);
      const errors = r.out.split('\n').filter((l) => l.startsWith('::error '));
      expect(errors[0]).toBe('::error title=check failed::the outside door did not open');
      expect(errors[1]).toBe('::error title=check step (last 25 lines)::a line before the check');
      expect(errors[2]).toBe(`::error title=${r.name} log (last 40 lines)::${Array.from({ length: 40 }, (_, i) => 99961 + i).join('%0A')}`);
      expect(errors[3]).toBe('::error title=fake cloud (last 10 lines)::{"url":"https://127.0.0.1:9443/functions/v1"}');
      expect(errors).toHaveLength(4);
      expect(r.out).not.toContain('never');
    });

    it('a command that fails under set -e, in a function too, is named with its line; %, CR and LF are escaped', () => {
      const r = bash("f() { printf 'a 100%% line\\rand on\\n'; false; }\nf\necho never");
      expect(r.status).toBe(1);
      const errors = r.out.split('\n').filter((l) => l.startsWith('::error '));
      expect(errors[0]).toMatch(/^::error title=check failed::line \d+: false \(exit 1\)$/);
      expect(errors[1]).toBe('::error title=check step (last 25 lines)::a 100%25 line%0Dand on');
      expect(r.out).not.toContain('never');
    });

    it('an annotation keeps the NEWEST 4,000 characters, cut at a line (the runner keeps a message\'s first 4,096), and its title is escaped', () => {
      const r = bash("seq 1 2000 | annotate 'a: b, c'");
      expect(r.status).toBe(0);
      const line = r.out.split('\n').find((l) => l.startsWith('::error '));
      const prefix = '::error title=a%3A b%2C c::';
      expect(line.startsWith(prefix)).toBe(true);
      const message = line.slice(prefix.length).replace(/%0D/g, '\r').replace(/%0A/g, '\n').replace(/%25/g, '%');
      expect(message.length).toBeLessThanOrEqual(4096);
      const lines = message.split('\n');
      expect(lines[0]).toBe('[earlier lines cut: the runner keeps 4,096 characters]');
      const numbers = lines.slice(1).map(Number);
      expect(numbers.at(-1)).toBe(2000);
      expect(numbers.every((x, i) => x === numbers[0] + i)).toBe(true); // whole lines, none cut in two
      expect(numbers[0]).toBeGreaterThan(1);
    });
  });
});
