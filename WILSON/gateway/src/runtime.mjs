// =============================================================================
// The gateway, running (`wilson-gateway run`): config, certificates, the two
// doors, the cloud, the journal, the timers. The switch's lifecycle is here
// (design §9 point 4):
//
//   the OUTSIDE door is bound only while the switch reads on AND an outside
//   address is set AND the cloud was seen within 60 s (D15) AND this version is
//   at or above minimum_version; when any of those stops being true it is
//   closed at once: closeAllConnections(), every socket tracked at the TCP
//   level destroyed, the port unbound, and the close measured;
//   the INSIDE door is bound per chosen address (interfaces.mjs) once the
//   gateway is enrolled, and closes with the outside door on a 401 (the
//   cloud forgot this gateway).
//
// Platform hooks (Windows' adapters, Linux's /sys, the secrets, the firewall
// request, the update) are injected, so the tests run the real wiring.
// =============================================================================

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { VERSION, platformName } from './version.mjs';
import { parseConfig, declaredProxyOf, inStateDir } from './config.mjs';
import { stateDirFor, FILES } from './platform/state.mjs';
import { makeSecrets } from './platform/secrets.mjs';
import { chooseInsideAddresses } from './rules/interfaces.mjs';
import { validateOfficeRanges } from './rules/peers.mjs';
import { peerLimiters } from './rules/limits.mjs';
import { composeHealthLine } from './rules/health.mjs';
import { CertStore, loadOwnCertificate } from './certs/store.mjs';
import { hostNames, displayFingerprint } from './certs/x509.mjs';
import { Journal } from './journal/journal.mjs';
import { createDoorServer } from './doors/server.mjs';
import { makeHandler } from './doors/handler.mjs';
import { makeDoorContext } from './doors/context.mjs';
import { makeInsideGate, makeOutsideGate, makeCounters } from './doors/gates.mjs';
import { CloudClient, DEFAULT_CLOUD_URL, normalizeCloudUrl, cleanEnrolAnswer, cleanSyncAnswer } from './cloud/client.mjs';
import { SyncLoop } from './cloud/sync.mjs';
import { Catalogue } from './cloud/catalogue.mjs';
import { ReachChecker } from './cloud/reach.mjs';
import { isEnrolToken } from './wire/formats.mjs';
import { compareVersions } from './update/manifest.mjs';
import { containerRootFor } from './rules/mountRule.mjs';

export const NO_CLOUD_MS = 60_000;
const SECOND = 1_000;

const ENROL_SENTENCES = {
  token: 'That is not an enrolment token: it starts wgt_ and has 32 letters and digits after it.',
  cloud: 'The cloud’s address must be an https:// address.',
  refused: 'WILSON refused the token: it was used already or is older than 24 hours. Make a new one in Settings, Storage, File gateway.',
  unreachable: (u) => `WILSON’s cloud could not be reached at ${u}. Check this computer’s internet connection and the address.`,
  answer: 'WILSON’s answer could not be understood; nothing was kept. Make a new token and try again.',
  keep: 'Enrolled, but the credential could not be kept on this computer; the token is spent. Make a new token and try again.',
  already: 'This gateway is already enrolled. To enrol it in another workspace, Forget it in Settings first.',
};

export class Gateway {
  constructor(o = {}) {
    this.env = o.env || process.env;
    this.osPlatform = o.platform || process.platform;
    this.platform = platformName(this.env, this.osPlatform); // 'windows' | 'container'
    this.inImage = this.env.WILSON_GATEWAY_IMAGE === '1';
    this.stateDir = o.stateDir || stateDirFor({ platform: this.osPlatform, env: this.env });
    this.now = o.now || Date.now;
    this.hostname = o.hostname || os.hostname();
    this.fetchImpl = o.fetchImpl || globalThis.fetch;
    this.netInterfaces = o.netInterfaces || (() => os.networkInterfaces());
    this.adapters = o.adapters || (async () => null);
    this.linuxFacts = o.linuxFacts || (async () => null);
    this.secrets = o.secrets || makeSecrets({ platform: this.osPlatform });
    this.firewall = o.firewall || { open: async () => ({ ok: false, reason: 'not a service' }), close: async () => ({ ok: false, reason: 'not a service' }) };
    this.shareLogins = o.shareLogins || { has: () => false, list: () => [], dialects: async () => [] };
    this.updates = o.updates || { state: () => ({ state: 'disabled' }), check: async () => {} };
    this.print = o.print || ((line) => process.stdout.write(line + '\n'));
    // Tests only, by constructor: where a location's root is on this machine.
    // Not reachable from config.json, the environment or the command line.
    this.rootFor = o.locationRootFor || ((unc) => (this.platform === 'container' ? containerRootFor(unc) : unc));
    this.intervals = { tick: o.tickMs ?? SECOND, addresses: o.addressMs ?? 30 * SECOND, events: o.eventsMs ?? 60 * SECOND, status: o.statusMs ?? 5 * SECOND, enrolPoll: o.enrolPollMs ?? 3 * SECOND };
    this.timers = [];
    this.enrolOnly = o.enrolOnly === true;
    this.started = false;
    this.revoked = false;
    this.enrolment = null;
    this.credential = null;
    this.keys = new Map();
    this.origins = [];
    this.locations = new Map();
    this.remote = { switchOn: false, outsideAddress: null, minimumVersion: null, hardMinimumVersion: null, reachNonce: null, reach: null };
    this.officeRanges = { applied: [], refused: [] };
    this.choice = null;
    this.inside = { servers: new Map(), closed: 'not_enrolled' };
    this.outside = { servers: [], state: 'closed_not_enrolled', lastCloseMs: null, opening: false };
    this.counters = makeCounters();
    this.healthyWritten = false;
    this.lastSeenAt = null;
    this.rootPemSent = null;
    this.problems = [];
  }

  log(event, detail = {}) {
    this.print(`${new Date(this.now()).toISOString()} ${event} ${JSON.stringify(detail)}`);
  }

  #file(name) { return path.join(this.stateDir, FILES[name] || name); }

  async #readJson(name) {
    try { return JSON.parse(await fs.promises.readFile(this.#file(name), 'utf8')); } catch { return null; }
  }

  async #writeJson(name, value, mode = 0o600) {
    const p = this.#file(name);
    const tmp = `${p}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(value, null, 2), { mode });
    await fs.promises.rename(tmp, p);
  }

  // ── start and stop ─────────────────────────────────────────────────────────
  async start() {
    await fs.promises.mkdir(this.stateDir, { recursive: true });
    const { config, limits, problems } = parseConfig(await fs.promises.readFile(this.#file('config'), 'utf8').catch(() => ''));
    this.config = config;
    this.limits = limits;
    this.problems = problems;
    for (const p of problems) this.log('config_ignored', { setting: p });
    this.cloudUrl = normalizeCloudUrl(config.cloud_url || this.env.WILSON_CLOUD_URL || '') || DEFAULT_CLOUD_URL;

    await this.#chooseAddresses();
    this.certs = new CertStore({ dir: path.join(this.stateDir, FILES.certs), secrets: this.secrets, hostname: this.hostname, now: this.now });
    await this.certs.load();
    const made = await this.certs.ensure({ insideAddresses: this.choice.addresses.map((a) => a.address) });
    this.#noteCertChange(made);

    this.journal = new Journal({ file: this.#file('journal') });
    const recovered = await this.journal.open();
    if (recovered.recovered) this.log('journal_recovered', recovered);

    this.catalogue = new Catalogue({ now: this.now, confirm: (items) => this.sync ? this.sync.confirm(items) : Promise.resolve({ reached: false }) });
    this.reach = new ReachChecker({ platform: this.platform, hasShareLogin: (h) => this.shareLogins.has(h), now: this.now, rootFor: this.rootFor });
    this.#buildDoorContext();

    this.enrolment = await this.#readJson('state');
    if (this.enrolment?.gateway_id) {
      try {
        const blob = await fs.promises.readFile(this.#file('credential'));
        this.credential = (await this.secrets.unprotect(blob)).toString('utf8');
      } catch (e) {
        this.log('credential_unreadable', { reason: String(e.message).slice(0, 120) });
        this.enrolment = null;
      }
    }
    // The container's first-run token; the installer's or the command's one-shot file.
    if (!this.enrolment && this.env.WILSON_ENROL_TOKEN) {
      const r = await this.enrol(this.env.WILSON_ENROL_TOKEN.trim(), null);
      this.log(r.ok ? 'enrolled' : 'enrol_failed', r.ok ? { gateway_id: r.gatewayId, workspace: r.workspaceName } : { reason: r.error });
    } else if (this.enrolment && this.env.WILSON_ENROL_TOKEN) {
      this.log('enrol_token_ignored', { reason: 'already enrolled' });
    }
    await this.#pollEnrolFile();

    this.started = true;
    this.#announce();
    // `enrolOnly` (the command's one-shot enrolment): no door, no sync, no timer.
    if (this.enrolOnly) return this;
    if (this.enrolment) await this.#begin();
    this.#every(this.intervals.tick, () => this.#tick());
    this.#every(this.intervals.addresses, () => this.#watchAddresses());
    this.#every(this.intervals.events, () => this.#postEvents());
    this.#every(this.intervals.status, () => this.#writeStatus());
    this.#every(this.intervals.enrolPoll, () => this.#pollEnrolFile());
    await this.#writeStatus();
    return this;
  }

  /** The first lines a container's log and the service's log show (§11 A step 4). */
  #announce() {
    const fp = this.certs.state().rootFingerprint;
    this.log('gateway', { version: VERSION, platform: this.platform, node: process.versions.node, state: this.stateDir, cloud: this.cloudUrl });
    this.print(`Certificate fingerprint (SHA-256): ${fp ? displayFingerprint(fp) : 'not made'}`);
    if (!this.enrolment) this.print('Not enrolled yet: give this gateway an enrolment token (WILSON_ENROL_TOKEN, the installer, or `wilson-gateway enrol <token>`).');
    if (this.choice.sentence) this.print(this.choice.sentence);
  }

  async #begin() {
    this.revoked = false;
    this.client = new CloudClient({ baseUrl: this.enrolment.cloud_url || this.cloudUrl, credential: () => this.credential, fetchImpl: this.fetchImpl });
    this.sync = new SyncLoop({
      call: (body) => this.client.sync(body),
      report: () => this.#report(),
      onResult: (r) => this.#onSync(r),
      intervalMs: () => (this.enrolment?.sync_interval_s || 10) * SECOND,
      now: this.now,
    });
    await this.#openInside();
    await this.#evaluateOutside(); // until the cloud says otherwise, the switch is off
    this.sync.start();
  }

  async stop() {
    this.stopping = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    clearTimeout(this.eventsSoon);
    this.eventsSoon = null;
    this.sync?.stop();
    await this.postingNow?.catch(() => {});
    await this.#closeOutside('stopping');
    await this.#closeInside('stopping');
    this.doorCtx?.viewings.endAll();
    await this.journal?.flush();
    await fs.promises.rm(this.#file('healthy'), { force: true });
    this.started = false;
  }

  #every(ms, fn) {
    const t = setInterval(() => { Promise.resolve().then(fn).catch((e) => this.log('timer_error', { message: String(e?.message || e).slice(0, 200) })); }, ms);
    t.unref?.();
    this.timers.push(t);
  }

  // ── enrolment ──────────────────────────────────────────────────────────────
  async enrol(token, cloudUrl) {
    if (!isEnrolToken(token)) return { ok: false, error: ENROL_SENTENCES.token };
    if (this.enrolment && !this.revoked) return { ok: false, error: ENROL_SENTENCES.already };
    const url = normalizeCloudUrl(cloudUrl || this.config?.cloud_url || this.env.WILSON_CLOUD_URL || '') || (cloudUrl ? null : DEFAULT_CLOUD_URL);
    if (!url) return { ok: false, error: ENROL_SENTENCES.cloud };
    const st = this.certs.state();
    const client = new CloudClient({ baseUrl: url, fetchImpl: this.fetchImpl });
    const res = await client.enrol(token, {
      name: this.config?.name || this.hostname,
      hostname: this.hostname,
      platform: this.platform,
      version: VERSION,
      root_cert_pem: st.rootPem,
      root_fingerprint: st.rootFingerprint,
      inside_addresses: this.choice.addresses.map((a) => ({ host: a.address, port: this.config.inside.port })),
      inside_names: hostNames(this.hostname),
    });
    if (!res.ok) return { ok: false, error: res.status === 401 || res.status === 403 || res.status === 404 || res.status === 410 ? ENROL_SENTENCES.refused : res.unreachable ? ENROL_SENTENCES.unreachable(url) : (res.error || ENROL_SENTENCES.refused) };
    const clean = cleanEnrolAnswer(res.data);
    if (!clean.ok) return { ok: false, error: ENROL_SENTENCES.answer };
    const a = clean.value;
    try {
      await fs.promises.writeFile(this.#file('credential'), await this.secrets.protect(Buffer.from(a.credential, 'utf8')), { mode: 0o600 });
      await this.#writeJson('state', { gateway_id: a.gatewayId, workspace_id: a.workspaceId, workspace_name: a.workspaceName, cloud_url: url, enrolled_at: new Date(this.now()).toISOString(), sync_interval_s: a.syncIntervalS });
      const cfgPath = this.#file('config');
      const raw = JSON.parse(await fs.promises.readFile(cfgPath, 'utf8').catch(() => '{}') || '{}');
      raw.cloud_url = url;
      await fs.promises.writeFile(cfgPath, JSON.stringify(raw, null, 2), { mode: 0o600 });
    } catch (e) {
      this.log('enrol_keep_failed', { reason: String(e.message).slice(0, 160) });
      return { ok: false, error: ENROL_SENTENCES.keep };
    }
    this.enrolment = { gateway_id: a.gatewayId, workspace_id: a.workspaceId, workspace_name: a.workspaceName, cloud_url: url, sync_interval_s: a.syncIntervalS };
    this.credential = a.credential;
    this.cloudUrl = url;
    this.keys = new Map(a.signingKeys.map((k) => [k.kid, k.key]));
    this.origins = a.origins;
    if (!a.workspaceId) this.log('workspace_id_missing', { effect: 'every ticket is refused until the cloud names the workspace' });
    if (this.started && !this.enrolOnly) { this.sync?.stop(); await this.#begin(); }
    return { ok: true, gatewayId: a.gatewayId, workspaceName: a.workspaceName, fingerprint: st.rootFingerprint };
  }

  /** The installer's and the command's one-shot file: { token, cloud }. */
  async #pollEnrolFile() {
    const req = await this.#readJson('enrol');
    if (!req) return;
    await fs.promises.rm(this.#file('enrol'), { force: true });
    const r = await this.enrol(String(req.token || ''), req.cloud || null);
    await this.#writeJson('enrolResult', { ...r, fingerprint_display: r.fingerprint ? displayFingerprint(r.fingerprint) : null, at: new Date(this.now()).toISOString() });
    this.log(r.ok ? 'enrolled' : 'enrol_failed', r.ok ? { gateway_id: r.gatewayId, workspace: r.workspaceName } : { reason: r.error });
  }

  // ── addresses and certificates ─────────────────────────────────────────────
  async #chooseAddresses() {
    const [adapters, linuxFacts] = await Promise.all([this.adapters().catch(() => null), this.linuxFacts().catch(() => null)]);
    this.choice = chooseInsideAddresses({ interfaces: this.netInterfaces(), platform: this.osPlatform, adapters, linuxFacts, inImage: this.inImage, pinned: this.config?.inside.addresses });
    return this.choice;
  }

  #noteCertChange(made) {
    if (made.rootReplacedFor) this.rootReplacedFor = made.rootReplacedFor;
    if (made.rootMade || made.leafMade || made.nextRootPromoted) this.log('certificates', made);
  }

  async #watchAddresses() {
    const before = (this.choice?.addresses || []).map((a) => a.address).sort().join(',');
    await this.#chooseAddresses();
    const after = this.choice.addresses.map((a) => a.address).sort().join(',');
    const made = await this.certs.ensure({ insideAddresses: this.choice.addresses.map((a) => a.address) });
    this.#noteCertChange(made);
    if (before !== after || made.leafMade || made.rootMade) {
      this.log('addresses', { before, after });
      if (this.enrolment && !this.revoked) { await this.#closeInside('addresses changed'); await this.#openInside(); }
      for (const s of this.outside.servers) s.setCertificate(await this.#outsideTls());
    }
  }

  async #insideTls() {
    if (this.config.inside.certificate) {
      try {
        const own = await loadOwnCertificate({ certFile: inStateDir(this.stateDir, this.config.inside.certificate.cert), keyFile: inStateDir(this.stateDir, this.config.inside.certificate.key) });
        this.ownInside = own;
        return { cert: own.certPem, key: own.keyPem };
      } catch (e) { this.log('own_certificate_unusable', { door: 'inside', reason: String(e.message).slice(0, 120) }); }
    }
    const st = this.certs.state();
    return st.leafPem ? { cert: st.leafPem, key: st.leafKeyPem } : null;
  }

  async #outsideTls() {
    if (this.config.outside.certificate) {
      try {
        const own = await loadOwnCertificate({ certFile: inStateDir(this.stateDir, this.config.outside.certificate.cert), keyFile: inStateDir(this.stateDir, this.config.outside.certificate.key) });
        this.ownOutside = own;
        return { cert: own.certPem, key: own.keyPem };
      } catch (e) { this.log('own_certificate_unusable', { door: 'outside', reason: String(e.message).slice(0, 120) }); }
    }
    const st = this.certs.state();
    return st.leafPem ? { cert: st.leafPem, key: st.leafKeyPem } : null;
  }

  // ── the doors ──────────────────────────────────────────────────────────────
  #buildDoorContext() {
    const ownAndNets = () => ({ ownAddresses: this.choice.ownAddresses, coLocatedNets: this.choice.coLocatedNets, officeRanges: this.officeRanges.applied });
    this.limiters = peerLimiters(this.limits, this.now);
    this.doorCtx = makeDoorContext({
      ids: () => ({ gatewayId: this.enrolment?.gateway_id || null, workspaceId: this.enrolment?.workspace_id || null }),
      keyFor: (kid) => this.keys.get(kid) || null,
      syncForUnknownKid: () => this.#syncForUnknownKid(),
      location: (id) => this.locations.get(id) || null,
      catalogue: this.catalogue,
      journal: this.journal,
      now: this.now,
      log: (event, detail) => this.log(event, detail),
      limits: this.limits,
      origins: () => this.origins,
      host: () => ({ names: hostNames(this.hostname), addresses: this.choice.addresses.map((a) => a.address), port: this.config.inside.port }),
      health: () => this.health(),
      healthLine: () => this.healthLine(),
      fingerprint: () => this.certs.state().rootFingerprint,
      reachNonce: () => this.remote.reachNonce,
      version: VERSION,
      declaredProxy: () => declaredProxyOf(this.config),
      locationSlow: (id) => { const l = this.locations.get(id); if (l) { l.state = 'not_reachable'; l.since = l.since || this.now(); } },
      onViewingEnded: () => this.#soonPostEvents(),
    });
    this.insideGate = makeInsideGate({ peers: ownAndNets, limiters: this.limiters.inside, pools: this.doorCtx.pools, counters: this.counters });
    this.outsideGate = makeOutsideGate({ limiters: this.limiters.outside, pools: this.doorCtx.pools, counters: this.counters });
  }

  async #syncForUnknownKid() {
    const t = this.now();
    if (this.lastKidSyncAt && t - this.lastKidSyncAt < 5 * SECOND) return; // one extra sync, not a storm
    this.lastKidSyncAt = t;
    if (this.sync) await Promise.race([this.sync.requestNow(), new Promise((r) => setTimeout(r, 5 * SECOND))]);
  }

  async #openInside() {
    if (!this.enrolment) { this.inside.closed = 'not_enrolled'; return; }
    if (this.revoked) { this.inside.closed = 'revoked'; return; }
    if (this.choice.closed) { this.inside.closed = this.choice.closed; return; }
    const tls = await this.#insideTls();
    if (!tls) { this.inside.closed = 'no_address'; return; }
    for (const a of this.choice.addresses) {
      if (this.inside.servers.has(a.address)) continue;
      const s = createDoorServer({ door: 'inside', host: a.address, port: this.config.inside.port, tls, limits: this.limits, gate: this.insideGate, handler: makeHandler(this.doorCtx, 'inside'), onEvent: (e, d) => { if (d.reason !== 'loopback' && d.reason !== 'own_address') this.log(`inside_${e}`, d); } });
      try {
        await s.listen();
        this.inside.servers.set(a.address, s);
        this.log('inside_open', { address: a.address, port: s.port });
      } catch (e) {
        this.log('inside_bind_failed', { address: a.address, code: e.code });
      }
    }
    this.inside.closed = this.inside.servers.size ? null : 'bind_failed';
  }

  async #closeInside(reason) {
    const servers = [...this.inside.servers.values()];
    this.inside.servers.clear();
    const ms = await Promise.all(servers.map((s) => s.close()));
    if (servers.length) this.log('inside_closed', { reason, ms: Math.max(...ms) });
    this.doorCtx?.streams.dropDoor('inside');
  }

  #outsideWanted() {
    if (!this.enrolment) return 'closed_not_enrolled';
    if (this.revoked) return 'closed_revoked';
    if (!this.remote.switchOn) return 'closed_switch_off';
    if (!this.remote.outsideAddress) return 'closed_no_address';
    if (this.lastSeenAt === null || this.now() - this.lastSeenAt > NO_CLOUD_MS) return 'closed_no_cloud';
    if (this.remote.minimumVersion && compareVersions(VERSION, this.remote.minimumVersion) < 0) return 'closed_minimum_version';
    return 'open';
  }

  async #evaluateOutside() {
    const want = this.#outsideWanted();
    if (want === 'open') {
      if (this.outside.servers.length || this.outside.opening) return;
      this.outside.opening = true;
      try { await this.#openOutside(); } finally { this.outside.opening = false; }
      return;
    }
    if (this.outside.servers.length) await this.#closeOutside(want);
    this.outside.state = want;
  }

  async #openOutside() {
    const tls = await this.#outsideTls();
    if (!tls) { this.outside.state = 'closed_no_certificate'; return; }
    const hosts = this.config.outside.behind_local_proxy ? ['127.0.0.1', '::1'] : ['::'];
    const opened = [];
    for (const host of hosts) {
      const s = createDoorServer({ door: 'outside', host, port: this.config.outside.port, tls, limits: this.limits, gate: this.outsideGate, handler: makeHandler(this.doorCtx, 'outside'), onEvent: (e, d) => this.log(`outside_${e}`, d) });
      try {
        await s.listen();
        opened.push(s);
      } catch (e) {
        if (host === '::' && (e.code === 'EAFNOSUPPORT' || e.code === 'EADDRNOTAVAIL')) {
          const v4 = createDoorServer({ door: 'outside', host: '0.0.0.0', port: this.config.outside.port, tls, limits: this.limits, gate: this.outsideGate, handler: makeHandler(this.doorCtx, 'outside'), onEvent: (ev, d) => this.log(`outside_${ev}`, d) });
          try { await v4.listen(); opened.push(v4); continue; } catch { /* fall through */ }
        }
        if (host === '::1' && opened.length) continue; // no IPv6 loopback: IPv4's is enough
        this.log('outside_bind_failed', { host, port: this.config.outside.port, code: e.code });
      }
    }
    if (!opened.length) { this.outside.state = 'closed_bind_failed'; return; }
    this.outside.servers = opened;
    this.outside.state = 'open';
    this.outside.port = opened[0].port;
    this.log('outside_open', { port: this.outside.port, hosts: opened.map((s) => s.host) });
    this.firewall.open(this.config.outside.port).then((r) => { if (!r.ok) this.log('firewall_not_opened', { reason: r.reason }); });
  }

  async #closeOutside(reason) {
    const servers = this.outside.servers;
    this.outside.servers = [];
    if (!servers.length) return;
    const ms = await Promise.all(servers.map((s) => s.close()));
    this.outside.lastCloseMs = Math.max(...ms);
    this.doorCtx.streams.dropDoor('outside');
    this.doorCtx.viewings.endAll();
    this.#soonPostEvents();
    this.log('outside_closed', { reason, ms: this.outside.lastCloseMs });
    this.firewall.close(this.config.outside.port).then((r) => { if (!r.ok) this.log('firewall_not_closed', { reason: r.reason }); });
  }

  // ── the cloud ──────────────────────────────────────────────────────────────
  #report() {
    const st = this.certs.state();
    const body = {
      version: VERSION,
      platform: this.platform,
      hostname: this.hostname,
      inside_addresses: this.choice.addresses.map((a) => ({ host: a.address, port: this.config.inside.port })),
      inside_names: hostNames(this.hostname),
      root_fingerprint: st.rootFingerprint,
      certificate: {
        kind: this.config.inside.certificate ? 'own' : 'gateway',
        leaf_until: st.leafNotAfter ? new Date(st.leafNotAfter).toISOString() : null,
        root_until: st.rootNotAfter ? new Date(st.rootNotAfter).toISOString() : null,
        outside: this.config.outside.certificate ? 'own' : 'gateway',
      },
      reach: Object.fromEntries([...this.locations.values()].map((l) => [l.id, l.state])),
      doors: {
        inside: this.inside.servers.size ? 'open' : `closed_${this.inside.closed || 'unknown'}`,
        outside: this.outside.state === 'open' ? `open:${this.config.outside.port}` : this.outside.state,
        inside_refused_public: this.counters.sinceSync.public,
        relay: this.doorCtx.relay.worst(),
      },
      update: this.#updateWord(),
      office_ranges_applied: this.officeRanges.applied,
      office_ranges_refused: this.officeRanges.refused,
      health_line: this.healthLine().text,
    };
    if (this.rootPemSent !== st.rootFingerprint) body.root_cert_pem = st.rootPem;
    if (st.nextRootPem) body.next_root_cert_pem = st.nextRootPem;
    return body;
  }

  #updateWord() {
    const u = this.updates.state();
    if (u.state === 'available') return `available:${u.version}`;
    if (u.state === 'failed') return `failed:${u.version}:${u.reason}`;
    return u.state === 'disabled' ? 'disabled' : 'up_to_date';
  }

  #onSync(r) {
    if (!r.ok) {
      if (r.revoked) {
        if (!this.revoked) this.log('revoked', { status: 401 });
        this.revoked = true;
        this.catalogue.clear();
        this.#closeInside('revoked').then(() => { this.inside.closed = 'revoked'; });
        this.#evaluateOutside();
      } else {
        this.log('sync_failed', { status: r.status, error: r.error });
      }
      return;
    }
    const clean = cleanSyncAnswer(r.data);
    if (!clean.ok) { this.log('sync_answer_refused', { reason: clean.reason }); return; }
    const a = clean.value;
    if (clean.dropped.length) this.log('sync_fields_dropped', { fields: [...new Set(clean.dropped)] });
    this.lastSeenAt = this.now();
    this.counters.sinceSync.public = 0;
    this.rootPemSent = this.certs.state().rootFingerprint;
    if (this.revoked) { this.revoked = false; this.log('unrevoked', {}); this.#openInside(); }
    if (a.workspaceId && !this.enrolment.workspace_id) { this.enrolment.workspace_id = a.workspaceId; this.#writeJson('state', this.enrolment); }
    if (a.workspaceId && this.enrolment.workspace_id && a.workspaceId !== this.enrolment.workspace_id) this.log('workspace_mismatch', { kept: this.enrolment.workspace_id });
    if (a.keysPresent) this.keys = new Map(a.signingKeys.map((k) => [k.kid, k.key]));
    this.origins = a.origins;
    this.officeRanges = validateOfficeRanges(a.officeRanges);
    this.remote = { switchOn: a.remoteViewing, outsideAddress: a.outsideAddress, minimumVersion: a.minimumVersion, hardMinimumVersion: a.hardMinimumVersion, reachNonce: a.reachNonce, reach: a.reach };
    if (a.renamed) this.displayName = a.renamed;
    this.#applyLocations(a.locations);
    this.#evaluateOutside();
    if (a.checkUpdateNow) this.updates.check('cloud asked').catch(() => {});
    if (a.checkReachNow) this.#checkReach().then(() => this.sync?.requestNow());
    else this.#checkReach();
    this.#maybeHealthy();
  }

  #applyLocations(list) {
    const next = new Map();
    for (const l of list) {
      const prev = this.locations.get(l.id);
      const root = this.rootFor(l.unc);
      next.set(l.id, { id: l.id, unc: l.unc, name: l.name, root, state: prev && prev.unc === l.unc ? prev.state : 'unknown', since: prev?.since ?? null });
    }
    this.locations = next;
  }

  async #checkReach() {
    const list = [...this.locations.values()];
    if (!list.length) return;
    const results = await this.reach.check(list.map((l) => ({ id: l.id, unc: l.unc })));
    for (const [id, r] of results) {
      const l = this.locations.get(id);
      if (l) { l.state = r.state; l.since = r.since; }
    }
  }

  async #maybeHealthy() {
    if (this.healthyWritten || !this.inside.servers.size) return;
    this.healthyWritten = true;
    await this.#writeJson('healthy', { version: VERSION, pid: process.pid, at: new Date(this.now()).toISOString() }, 0o644).catch(() => { this.healthyWritten = false; });
  }

  #soonPostEvents() {
    if (this.eventsSoon) return;
    this.eventsSoon = setTimeout(() => { this.eventsSoon = null; this.#postEvents(); }, 2 * SECOND);
    this.eventsSoon.unref?.();
  }

  #postEvents() {
    if (!this.client || this.revoked || this.posting || this.stopping) return undefined;
    this.postingNow = this.#postEventsOnce();
    return this.postingNow;
  }

  async #postEventsOnce() {
    const rows = this.journal.pending(200);
    if (!rows.length) return;
    this.posting = true;
    try {
      const r = await this.client.events(rows);
      if (!r.ok) { if (r.revoked) this.#onSync(r); else this.log('events_failed', { status: r.status }); return; }
      const accepted = Array.isArray(r.data?.accepted) ? r.data.accepted.filter((x) => typeof x === 'string') : [];
      const rejected = Array.isArray(r.data?.rejected) ? r.data.rejected.filter((x) => x && typeof x.viewing_id === 'string') : [];
      for (const x of rejected) this.log('event_rejected', { viewing_id: x.viewing_id, reason: String(x.reason || '').slice(0, 120) });
      const n = await this.journal.ack([...accepted, ...rejected.map((x) => x.viewing_id)]);
      if (n) this.log('events_acknowledged', { rows: n });
    } finally {
      this.posting = false;
    }
  }

  // ── the timers ─────────────────────────────────────────────────────────────
  async #tick() {
    await this.#evaluateOutside();
    this.doorCtx.viewings.tick();
    if (!this.lastSweep || this.now() - this.lastSweep > 30 * SECOND) {
      this.lastSweep = this.now();
      this.doorCtx.streams.sweep();
      this.limiters.inside.connections.prune(); this.limiters.inside.handshakes.prune();
      this.limiters.outside.connections.prune(); this.limiters.outside.handshakes.prune();
      this.doorCtx.perPersonRequests.prune();
    }
  }

  // ── what the gateway says about itself ─────────────────────────────────────
  healthState() {
    const st = this.certs.state();
    const insideOpen = this.inside.servers.size > 0;
    return {
      now: this.now(),
      name: this.displayName || this.config?.name || this.hostname,
      version: VERSION,
      platform: this.platform,
      lastSyncAt: this.lastSeenAt,
      inside: {
        state: insideOpen ? 'open' : 'closed',
        closed: this.inside.closed,
        addresses: [...this.inside.servers.values()].map((s) => ({ address: s.host, port: s.port })),
        port: this.config?.inside.port,
        refusedPublic: this.counters.sinceSync.public,
        relay: this.doorCtx?.relay.worst() || null,
        sentence: this.choice?.sentence || null,
      },
      outside: { state: this.outside.state, port: this.config?.outside.port, noCloudForMs: this.lastSeenAt ? this.now() - this.lastSeenAt : null, minimumVersion: this.remote.minimumVersion, reachOk: this.remote.reach?.ok, reachCheckedAt: this.remote.reach?.checkedAt },
      locations: [...this.locations.values()].map((l) => ({ name: l.name, unc: l.unc, state: l.state === 'unknown' ? null : l.state, since: l.since, mountAt: containerRootFor(l.unc) })),
      certificate: this.ownInside ? { kind: 'own', ownUntil: this.ownInside.notAfter } : st.leafNotAfter ? { kind: 'gateway', leafUntil: st.leafNotAfter, rootUntil: st.rootNotAfter, rootExpiryNotice: st.rootExpiryNotice, rootReplaced: this.rootReplacedFor || null } : null,
      update: (() => { const u = this.updates.state(); return { ...u, running: VERSION }; })(),
      hardMinimum: !!(this.remote.hardMinimumVersion && compareVersions(VERSION, this.remote.hardMinimumVersion) < 0),
      revoked: this.revoked,
      notEnrolled: !this.enrolment,
      secrets: this.secrets.status(),
      smb: this.smbDialects || [],
    };
  }

  healthLine() { return composeHealthLine(this.healthState()); }

  health() {
    const line = this.healthLine();
    const st = this.certs.state();
    return {
      name: this.displayName || this.config?.name || this.hostname,
      version: VERSION,
      doors: {
        inside: { state: this.inside.servers.size ? 'open' : `closed_${this.inside.closed}`, addresses: [...this.inside.servers.values()].map((s) => `${s.host.includes(':') ? `[${s.host}]` : s.host}:${s.port}`) },
        outside: { state: this.outside.state === 'open' ? `open:${this.config.outside.port}` : this.outside.state },
      },
      reach: Object.fromEntries([...this.locations.values()].map((l) => [l.id, l.state])),
      certificate: { fingerprint: st.rootFingerprint, root_until: st.rootNotAfter ? new Date(st.rootNotAfter).toISOString() : null, leaf_until: st.leafNotAfter ? new Date(st.leafNotAfter).toISOString() : null },
      line: line.text,
      warnings: line.warnings.map((w) => w.text),
    };
  }

  /** status.json, for `wilson-gateway doctor` (the inside door refuses this very computer). */
  async #writeStatus() {
    const st = this.certs?.state();
    const line = this.healthLine();
    const status = {
      at: new Date(this.now()).toISOString(),
      pid: process.pid,
      version: VERSION,
      node: process.versions.node,
      openssl: process.versions.openssl,
      platform: this.platform,
      state_dir: this.stateDir,
      cloud: this.enrolment?.cloud_url || this.cloudUrl,
      enrolled: !!this.enrolment,
      gateway_id: this.enrolment?.gateway_id || null,
      workspace: this.enrolment?.workspace_name || null,
      fingerprint: st?.rootFingerprint || null,
      health_line: line.text,
      warnings: line.warnings.map((w) => w.text),
      doors: {
        inside: { open: [...this.inside.servers.values()].map((s) => ({ address: s.host, port: s.port })), closed: this.inside.closed, chosen: this.choice?.addresses || [], refused: this.choice?.refused || [] },
        outside: { state: this.outside.state, port: this.config?.outside.port, last_close_ms: this.outside.lastCloseMs },
      },
      refused_peers: { ...this.counters, sinceSync: undefined },
      secrets: this.secrets.status(),
      config_problems: this.problems,
    };
    await this.#writeJson('status', status, 0o644).catch(() => {});
    return status;
  }

  // For the tests: a clean way to run one tick or one sync now.
  async tickNow() { await this.#tick(); }
  async syncNow() { if (this.sync) await this.sync.requestNow(); }
  get outsideState() { return this.outside.state; }
  get insideServers() { return this.inside.servers; }
  get outsidePort() { return this.outside.servers[0]?.port ?? null; }
}

/** A random minute of the day, for the daily update check (§8). */
export function randomMinuteMs() { return crypto.randomInt(0, 24 * 60) * 60 * 1000; }
