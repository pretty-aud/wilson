# TPN Compliance Audit — Findings

> Every finding below has been assigned an ID. The companion skill `tpn-compliance-implementation`
> reads this file to build a work queue. Do not renumber existing IDs on re-audit — append.

---

## TPN-ENC-001 — Application secrets (Anthropic API key) stored in browser localStorage

```yaml
id: TPN-ENC-001
severity: CRITICAL
control: AS-2.5
domain: encryption
title: Anthropic API key stored in plaintext browser localStorage
location: src/App.jsx:163
evidence: |
  try { localStorage.setItem('wilson-api-key', anthropicApiKey); } catch {}
required: |
  AS-2.5: keys/credentials stored in a centralized vault/HSM, separated from the
  host that uses them, with rotation and segregation of duties. Secrets must
  never sit in browser-accessible storage where any renderer script or
  dependency can exfiltrate them.
gap: |
  The user's Anthropic API key is written to and read from localStorage. In
  Electron that maps to the Chromium profile on disk (unencrypted on Windows
  by default), is readable by every renderer script (including any
  npm-supply-chain compromise), and has no rotation, no scoping, and no
  key-custodian separation.
effort: M
blocks_tier: Silver
recommendation_ref: RECO-SDLC-SECRETS
```

---

## TPN-ENC-002 — Third-party credentials (Supabase keys, Google OAuth tokens) stored plaintext on disk

```yaml
id: TPN-ENC-002
severity: CRITICAL
control: AS-2.5
domain: encryption
title: Supabase anon/service-role key and Google refresh token written plaintext to userData
location: electron/main.cjs:1855
evidence: |
  writeJSON(path.join(getRabbitDataDir(), 'supabase.json'), cfg);
  // File shape: { url, anon_key, service_role_key? }
  // also: gdrive-tokens.json { accessToken, refreshToken, expiresAt }
required: |
  AS-2.5 / AS-3.6: credentials at rest must be encrypted (AES-256) and the
  decryption key must live separately from the ciphertext (OS keychain,
  DPAPI, Keychain Access, libsecret, or a cloud KMS).
gap: |
  Both files are written as plaintext JSON in %APPDATA%/WILSON/rabbit-data/.
  Anyone with filesystem access (malware, backup snapshot, shared laptop) can
  lift the Supabase service_role key (if present, it bypasses RLS) and the
  long-lived Google Drive refresh token. No OS-level keystore is used.
effort: M
blocks_tier: Silver
recommendation_ref: RECO-ENC-KEYS
```

---

## TPN-ENC-003 — Passwords stored plaintext (no hash, no salt)

```yaml
id: TPN-ENC-003
severity: CRITICAL
control: AS-3.6
domain: encryption
title: Shared password persisted to disk without hashing or salting
location: electron/main.cjs:625
evidence: |
  writeJSON(getPasswordFile(), { password: np.toUpperCase() });
  // verifyPassword compares stored value as plaintext:
  const valid = input === stored || input === ADMIN_PASSWORD;
required: |
  MPA CSBP: passwords must be hashed and salted using argon2id (preferred),
  bcrypt, scrypt, or PBKDF2. Plaintext password storage is explicitly banned.
gap: |
  wilson-auth.json stores the literal uppercase password string. Compare at
  electron/main.cjs:605 is a plaintext equality check. There is no salt,
  no KDF, and forcing uppercase silently cuts entropy.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-ENC-HASH
```

---

## TPN-ENC-004 — IndexedDB project store (WILSON content) is unencrypted

```yaml
id: TPN-ENC-004
severity: HIGH
control: AS-3.6
domain: encryption
title: Project data (including any client-supplied intake docs) stored unencrypted in IndexedDB
location: src/storage.js:81
evidence: |
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  // saves full projects blob including intake-uploaded content
required: |
  AS-3.6 / CS-1.13: AES-256 at rest for ALL content — workstation storage,
  app-level data stores, caches, backups. Decryption key separate from the
  device.
gap: |
  WILSON persists PDF/DOCX/PPTX intake documents, project metadata, and
  RABBIT bundles to IndexedDB and on-disk JSON with no application-layer
  encryption. Full-disk encryption (BitLocker/FileVault) is the user's
  responsibility and is not asserted anywhere in the app or its docs.
effort: L
blocks_tier: Gold
recommendation_ref: RECO-ENC-AES
```

---

## TPN-ENC-005 — No forensic watermarking on content download endpoint

```yaml
id: TPN-ENC-005
severity: HIGH
control: AS-3.14
domain: encryption
title: Managed-file download path serves raw asset with no session-bound forensic watermark
location: electron/main.cjs:1255
evidence: |
  expressApp.get('/api/rabbit/projects/:projectId/files/:id/download', (req, res) => {
    ...
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.sendFile(diskPath);
  });
required: |
  AS-3.14: session-based invisible forensic watermarking on all streamed AND
  downloaded content. Each viewer/session gets a uniquely traceable copy.
gap: |
  The download route streams the stored file as-is. No watermark hook, no
  viewer/session id binding, no embed step. If WILSON is to store pre-release
  assets, leakage is un-attributable.
effort: XL
blocks_tier: Gold
recommendation_ref: RECO-ENC-WATERMARK
```

---

## TPN-ENC-006 — No key rotation policy or documented compromise procedure

```yaml
id: TPN-ENC-006
severity: MEDIUM
control: AS-2.5
domain: encryption
title: No KMS/Vault integration, no rotation cadence, no compromise runbook
location: repo-wide
evidence: |
  No references to AWS KMS, Azure Key Vault, GCP KMS, HashiCorp Vault,
  DPAPI, or OS keychain anywhere in /electron or /src.
required: |
  AS-2.5: centralized key mgmt with per-project keys, rotation every 1–3 yr,
  segregation of duties, documented compromise response.
gap: |
  All sensitive material (password file, Supabase keys, Google tokens,
  Anthropic API key) is file/localStorage persisted with no rotation story.
effort: L
blocks_tier: Gold Star
recommendation_ref: RECO-ENC-KEYS
```

---

## TPN-AUTH-001 — Hardcoded admin backdoor password

```yaml
id: TPN-AUTH-001
severity: CRITICAL
control: TS-1.6
domain: authentication
title: Hardcoded ADMIN_PASSWORD = 'DILLYDALLY' provides an unchangeable backdoor
location: electron/main.cjs:585
evidence: |
  const ADMIN_PASSWORD = 'DILLYDALLY';
  const DEFAULT_PASSWORD = 'MUTINY';
  ...
  const valid = input === stored || input === ADMIN_PASSWORD;
required: |
  Authentication must not contain a universal override credential compiled
  into the binary. Every account must be uniquely attributable and
  revocable (OR-3.x). Secrets in code are explicitly banned.
gap: |
  Anyone who types "DILLYDALLY" on the password screen bypasses the user's
  chosen password — permanently, with no audit trail, no MFA, and no way for
  the operator to disable it without a rebuild. Additionally, the fallback
  DEFAULT_PASSWORD 'MUTINY' is also in source and also in the renderer
  (src/components/PasswordScreen.jsx:20) as a catch handler.
effort: S
blocks_tier: Silver
recommendation_ref: RECO-SDLC-SECRETS
```

---

## TPN-AUTH-002 — Password policy far below TPN minimum

```yaml
id: TPN-AUTH-002
severity: HIGH
control: TS-1.6
domain: authentication
title: Password policy allows 1-char, ≤12-char, alphanumeric-only, no lockout, no history, case-folded
location: electron/main.cjs:621
evidence: |
  if (np.length === 0) return res.json({ ok: false, error: 'New password cannot be empty' });
  if (np.length > 12) return res.json({ ok: false, error: 'Password must be 12 characters or fewer' });
  if (!/^[a-zA-Z0-9]+$/.test(np)) return res.json({ ok: false, error: 'Password must contain only letters and numbers' });
  // input === stored.toUpperCase() — case folded
required: |
  One of three paths (MPA CSBP): A) MFA everywhere; B) NIST 800-63b — 12-char
  minimum, dictionary blacklist, 5-try lockout with 1-min auto-unlock,
  quarterly crack test; C) traditional — 12-char min + 3-of-4 complexity,
  365-day max age, 10-entry history, 3–5 lockout with manual unlock.
gap: |
  - Minimum length is effectively 1, not 12.
  - Maximum length 12 caps entropy far below any of the three paths.
  - Alphanumeric-only removes symbols from the space.
  - toUpperCase() folds case, halving the effective alphabet.
  - No lockout, no rate limit, no history, no expiry, no dictionary check.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-AUTH-MFA
```

---

## TPN-AUTH-003 — No MFA on any path (app, admin, content download)

```yaml
id: TPN-AUTH-003
severity: CRITICAL
control: TS-1.6
domain: authentication
title: Single shared password is the only authentication factor
location: electron/main.cjs:602
evidence: |
  expressApp.post('/api/auth/verify', (req, res) => {
    const input = (req.body.password || '').toUpperCase();
    const stored = getStoredPassword().toUpperCase();
    const valid = input === stored || input === ADMIN_PASSWORD;
    ...
  });
required: |
  MFA is a Best Practice on remote access, VPN, all admin/privileged access,
  content transfer, client portals. Additional Recommendation: MFA on every
  account (TS-1.6 Option A).
gap: |
  WILSON has no MFA. The same password unlocks the app, Rabbit project
  management, Supabase connection settings, Google Drive OAuth setup, and
  the AI agent that can call Anthropic on the user's behalf. No TOTP, no
  WebAuthn, no push, no step-up auth on admin actions.
effort: L
blocks_tier: Gold
recommendation_ref: RECO-AUTH-MFA
```

---

## TPN-AUTH-004 — No session management: no session ID, no idle timeout, no rotation, no single-session enforcement

```yaml
id: TPN-AUTH-004
severity: HIGH
control: AS-3.8
domain: authentication
title: "Session" is a single last_auth_at timestamp with fixed 1-hour lifetime
location: electron/main.cjs:594
evidence: |
  expressApp.get('/api/auth/session', (req, res) => {
    const data = readJSON(getPasswordFile(), null);
    if (!data || !data.last_auth_at) return res.json({ valid: false });
    const elapsed = Date.now() - data.last_auth_at;
    const valid = elapsed < 60 * 60 * 1000; // 1 hour
    res.json({ valid });
  });
required: |
  AS-3.8: 30-min idle timeout; forced re-auth after 4 hr; 5–10 failure
  lockout; NO concurrent sessions per user; session IDs cryptographically
  random and rotated on privilege change; cookies Secure + HttpOnly +
  non-persistent.
gap: |
  - No session ID is minted; there is no cookie to rotate.
  - Timeout is fixed at 60 min from last auth, not 30 min idle.
  - No failure lockout — the verify endpoint accepts unlimited attempts.
  - No concurrent-session control (N/A without session IDs).
  - Auth state is shared globally on the host (single wilson-auth.json file).
effort: M
blocks_tier: Gold
recommendation_ref: RECO-AUTH-SESSION
```

---

## TPN-AUTH-005 — No RBAC; every authenticated user has full privilege

```yaml
id: TPN-AUTH-005
severity: HIGH
control: TS-1.7
domain: authentication
title: Single shared password grants full admin privilege — no role model
location: electron/main.cjs:602
evidence: |
  // The verify endpoint returns only { valid: true }. No role, no user
  // identity, no ABAC attributes are attached. Every subsequent API call
  // (software, agent-skills, rabbit/projects/*, files upload/download/delete,
  // auth/change, gdrive config) runs with full privilege.
required: |
  TS-1.7: RBAC + ABAC, SSO, unique usernames, least privilege, immediate
  revocation on termination. Apps run at user privilege never system/admin
  (AS-2.3).
gap: |
  WILSON has no user identity at all. There is no concept of a viewer,
  editor, or admin. Any successful auth unlocks every route, including
  password change and Supabase/Drive credential rewrite.
effort: L
blocks_tier: Gold
recommendation_ref: RECO-AUTH-RBAC
```

---

## TPN-NET-001 — CORS wildcard-open on local Express server

```yaml
id: TPN-NET-001
severity: HIGH
control: TS-2
domain: network
title: Express server mounts cors() with default (origin: '*') — any origin can hit local API
location: electron/main.cjs:115
evidence: |
  expressApp.use(cors());
  expressApp.use(express.json({ limit: '50mb' }));
required: |
  TS-2: default-deny on all network boundaries. Content-service APIs must
  only accept the intended caller.
gap: |
  The embedded Express server binds on localhost but serves `Access-Control-
  Allow-Origin: *`. Any web page the user visits while WILSON is running can
  fetch the WILSON API cross-origin and read/modify project data, change the
  password, extract uploaded files, or rewrite Supabase/Drive credentials.
  (Preflight is granted; no cookies are required because there is no session
  cookie, so CSRF-via-CORS is a live vector.)
effort: S
blocks_tier: Gold
recommendation_ref: RECO-NET-SEG
```

---

## TPN-NET-002 — Open URL proxies (`/api/fetch-url`, `/api/fetch-raw`) with no allow-list

```yaml
id: TPN-NET-002
severity: HIGH
control: TS-2
domain: network
title: Server-side fetch endpoints accept arbitrary URLs with no SSRF protection
location: electron/main.cjs:630
evidence: |
  expressApp.post('/api/fetch-url', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    ...
    const response = await fetch(url, ...);
  });
  // also /api/fetch-raw at main.cjs:667
required: |
  TS-2: no internet egress from content-processing systems without explicit
  allow-list. No user-supplied URL should be proxied without host filtering
  and private-range blocking.
gap: |
  Both endpoints accept any URL, including http://169.254.169.254 (cloud
  metadata), http://127.0.0.1:<port>, and intranet RFC-1918 ranges. Combined
  with TPN-NET-001 (CORS *), a browser page can make WILSON exfiltrate data
  from the user's private network.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-NET-SEG
```

---

## TPN-NET-003 — No rate limiting on any endpoint (including /api/auth/verify)

```yaml
id: TPN-NET-003
severity: HIGH
control: AS-3.8
domain: network
title: /api/auth/verify accepts unlimited password attempts; no rate limit elsewhere
location: electron/main.cjs:602
evidence: |
  No `express-rate-limit`, `slow-down`, or equivalent middleware is mounted.
  verify endpoint has no attempt counter, no delay, no lockout.
required: |
  AS-3.8: 5–10 failed attempt lockout. Rate limiting on all public-facing
  endpoints.
gap: |
  A process on the same machine can brute-force the 12-char alphanumeric
  (case-folded) password in seconds without any server-side friction.
effort: XS
blocks_tier: Gold
recommendation_ref: RECO-AUTH-SESSION
```

---

## TPN-LOG-001 — No SIEM / centralized logging / log aggregation

```yaml
id: TPN-LOG-001
severity: CRITICAL
control: TS-1.5
domain: logging
title: No structured logger, no log shipper, no central aggregation
location: repo-wide
evidence: |
  No winston/pino/bunyan/log4j/serilog/slog. No splunk/sentinel/datadog/
  fluent/otel imports. The codebase uses console.log only (64 occurrences
  across 10 files in src/).
required: |
  TS-1.5 (Best Practice, required for Gold): SIEM with centralized real-time
  logging. Sources include auth, file transfer, DBs, servers, API gateway,
  key mgmt. Alerting on auth events, admin access, config changes.
gap: |
  Every security-relevant event (auth success/failure, password change,
  file upload/download/delete, Supabase config change, gdrive token write)
  is silent or console-only. No tamper-evident trail, no retention, no
  alerting.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-LOG-SIEM
```

---

## TPN-LOG-002 — Content upload/download/delete routes emit no audit event (AS-2.9)

```yaml
id: TPN-LOG-002
severity: CRITICAL
control: AS-2.9
domain: logging
title: RABBIT file routes perform I/O with no per-event log (user, action, asset, IP, timestamp, geo, counter)
location: electron/main.cjs:1223
evidence: |
  expressApp.post('/api/rabbit/projects/:projectId/files', (req, res) => {
    ...
    fs.writeFileSync(path.join(filesDir, diskName), Buffer.from(base64, 'base64'));
    ...
    res.json(row);
  });
  // matching DELETE at 1276 and GET at 1255 also emit nothing
required: |
  AS-2.9: every upload, download, view, share, and delete must emit an event
  with timestamp, userId, sessionId, action, result, ipAddress, macAddress,
  geolocation, assetId, path, per-user-per-asset counter. Outbound transfers
  must notify the content owner.
gap: |
  None of the required fields are captured. The file row records an
  uploaded_at timestamp but no actor (uploaded_by is nullable and unset),
  no IP, no session. Downloads and deletes record nothing at all.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-LOG-SCHEMA
```

---

## TPN-LOG-003 — No auth event logging (success, failure, password change, admin-override use)

```yaml
id: TPN-LOG-003
severity: HIGH
control: TS-1.5
domain: logging
title: /api/auth/verify, /api/auth/change, and ADMIN_PASSWORD override usage are unlogged
location: electron/main.cjs:602
evidence: |
  No logger.info/warn/error or equivalent in verify/change/session handlers.
  The ADMIN_PASSWORD branch at line 605 is indistinguishable from a normal
  login on the server side.
required: |
  TS-1.5: auth successes, auth failures, admin access, and config changes
  must be logged with source IP, user, action, result, timestamp.
gap: |
  Brute-force attempts, successful logins, backdoor-password use, and
  password rotations are all invisible.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-LOG-SIEM
```

---

## TPN-LOG-004 — No retention policy on any log/event stream

```yaml
id: TPN-LOG-004
severity: HIGH
control: TS-1.5
domain: logging
title: No stated retention for any audit data
location: repo-wide
evidence: |
  No `retention`, `TTL`, `expireAfter`, or equivalent in code or docs.
required: |
  Logs ≥ 1 year; camera footage ≥ 90 days; terminated-personnel records
  ≥ 5 years. Dual authorization to move/delete.
gap: |
  Because no log stream exists, no retention is defined. Once logging is
  introduced this must be specified at the same time.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-LOG-SIEM
```

---

## TPN-CONT-001 — Download links have no expiration and no scope token

```yaml
id: TPN-CONT-001
severity: HIGH
control: AS-3.7
domain: content
title: GET /api/rabbit/projects/:projectId/files/:id/download requires only a valid session
location: electron/main.cjs:1255
evidence: |
  expressApp.get('/api/rabbit/projects/:projectId/files/:id/download', (req, res) => {
    const bundle = readRabbitBundle(req.params.projectId);
    ...
    res.sendFile(diskPath);
  });
required: |
  AS-3.7 / AS-3.8: external links auto-expire (24-hr default); per-user
  download/stream caps; session-scoped tokens; no sensitive data in URLs
  that can be bookmarked/copied.
gap: |
  URL is a stable resource path. Knowing projectId + fileId is sufficient
  for anyone with a session to fetch the raw file, forever, with no
  per-viewer cap and no link expiration.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-CONT-LINKS
```

---

## TPN-CONT-002 — No content lifecycle state machine or certified disposal

```yaml
id: TPN-CONT-002
severity: HIGH
control: AS-3.15
domain: content
title: Files are created, overwritten, and deleted with no lifecycle states, no proof-of-deletion
location: electron/main.cjs:1276
evidence: |
  expressApp.delete('/api/rabbit/projects/:projectId/files/:id', (req, res) => {
    ...
    if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
    rabbitRemoveFrom(bundle.files, req.params.id);
    ...
    res.json({ ok: true });
  });
required: |
  AS-3.15: formal lifecycle — receipt/creation → WIP → delivery → archival →
  certified disposal. Chain-of-custody logs, version control, confirmation
  receipts, retention periods, proof-of-deletion across backups and caches.
gap: |
  - No lifecycle state field on file records.
  - Delete is an unlink with no certificate, no checksum, no audit trail,
    no secondary-storage purge (thumbnails directory is not swept).
  - No archival path — records can only be "current" or missing.
effort: L
blocks_tier: Gold
recommendation_ref: RECO-CONT-LIFECYCLE
```

---

## TPN-CONT-003 — No `Cache-Control: no-store` on sensitive content responses

```yaml
id: TPN-CONT-003
severity: HIGH
control: AS-3.7
domain: content
title: File download route does not set Cache-Control / Pragma no-cache
location: electron/main.cjs:1262
evidence: |
  res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
  res.sendFile(diskPath);
required: |
  AS-3.7 / AS-3.8: `Cache-Control: no-store` and `Pragma: no-cache` on all
  sensitive responses. Session IDs never cached.
gap: |
  Default Express response headers permit intermediate caching. For a
  desktop-local server this is mostly moot, but when the Rabbit adapter
  runs against remote Supabase Storage the same discipline is absent.
effort: XS
blocks_tier: Gold
recommendation_ref: RECO-CONT-LINKS
```

---

## TPN-CONT-004 — Thumbnail cache and intake-doc working directory have no purge policy

```yaml
id: TPN-CONT-004
severity: MEDIUM
control: AS-3.15
domain: content
title: {userData}/rabbit-data/thumbnails grows forever with no TTL or owner-signal purge
location: electron/main.cjs:82
evidence: |
  function getThumbCacheDir() {
    const dir = path.join(getRabbitDataDir(), 'thumbnails');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
required: |
  Temp/cache directories purge within 24–48 hr. Delete of the source asset
  must trigger purge of derived thumbs and any intermediate products.
gap: |
  No periodic sweep, no TTL. Thumb files for deleted assets remain
  indefinitely; there is only a per-asset clear IPC that the renderer has
  to remember to call.
effort: S
blocks_tier: Gold Star
recommendation_ref: RECO-CONT-LIFECYCLE
```

---

## TPN-CONT-005 — No forensic watermark/chain-of-custody for outbound transfers

```yaml
id: TPN-CONT-005
severity: HIGH
control: AS-3.14
domain: content
title: Outbound transfers (Drive upload, Supabase Storage upload) carry no viewer-bound mark
location: src/tools/rabbit_v0.1.0/adapters/googleDriveAdapter.js:1
evidence: |
  Drive and Supabase Storage adapters stream the same bytes produced by the
  uploader; no pre-send watermark step exists.
required: |
  AS-3.14: session-based invisible forensic watermarking on streamed AND
  downloaded content. See also TPN-ENC-005.
gap: |
  Paired finding with TPN-ENC-005 at the transfer boundary.
effort: XL
blocks_tier: Gold
recommendation_ref: RECO-ENC-WATERMARK
```

---

## TPN-SDLC-001 — Hardcoded passwords in source (backdoor + default)

```yaml
id: TPN-SDLC-001
severity: CRITICAL
control: TS-1.14
domain: sdlc
title: ADMIN_PASSWORD and DEFAULT_PASSWORD are string literals in repo HEAD
location: electron/main.cjs:585
evidence: |
  const ADMIN_PASSWORD = 'DILLYDALLY';
  const DEFAULT_PASSWORD = 'MUTINY';
  // Also in renderer fallback:
  src/components/PasswordScreen.jsx:20
    return input.toUpperCase() === 'MUTINY';
required: |
  No secrets in code. No universal override credential. Secrets resolve from
  a secrets manager at runtime (Vault / AWS Secrets Manager / Azure Key Vault
  / GCP Secret Manager / OS keychain for desktop).
gap: |
  Both values are compiled into every packaged build, visible to anyone with
  the repo or a decompiled binary. Rotation requires a release.
effort: S
blocks_tier: Silver
recommendation_ref: RECO-SDLC-SECRETS
```

---

## TPN-SDLC-002 — .gitignore does not exclude .env, keys, or credential files

```yaml
id: TPN-SDLC-002
severity: HIGH
control: TS-1.14
domain: sdlc
title: .gitignore omits .env*, *.pem, *.key, *.p12, supabase.json, gdrive-*.json
location: .gitignore:1
evidence: |
  node_modules/
  dist/
  out/
  *.exe
required: |
  VCS must not accept .env files, private keys, or credential blobs. Standard
  ignore patterns are expected.
gap: |
  Nothing blocks a future contributor from committing a local .env, a
  supabase.json dump, or a pem. Combined with no pre-commit secret scanner,
  a single slip ships credentials to the remote.
effort: XS
blocks_tier: Gold
recommendation_ref: RECO-SDLC-SECRETS
```

---

## TPN-SDLC-003 — No CI/CD: SAST / SCA / DAST / container / IaC scans absent

```yaml
id: TPN-SDLC-003
severity: HIGH
control: TS-4.0
domain: sdlc
title: No .github/workflows/, no Jenkinsfile, no equivalent pipeline
location: repo-wide
evidence: |
  `find .github -type f` yields nothing. No sonar/semgrep/snyk/codeql/trivy/
  grype/dependabot/checkov/tfsec references anywhere.
required: |
  SAST per commit/PR, SCA per build, DAST per release, container scan per
  image, IaC scan per infra change. Critical vulns remediated or plan within
  48 hr. External scan monthly, internal quarterly.
gap: |
  There is no automated scanning at all. Vulnerabilities in the 40+ transitive
  deps and in the 7000-line DOG / 4000-line Otter files will drift unchecked.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-SDLC-CI
```

---

## TPN-SDLC-004 — No environment separation (dev / test / prod config)

```yaml
id: TPN-SDLC-004
severity: MEDIUM
control: AS-1.0
domain: sdlc
title: Single code path; no NODE_ENV gating, no prod hardening flag
location: electron/main.cjs:1
evidence: |
  process.env is never read; __APP_VERSION__ is the only build-time flag.
  Dev behavior (vite dev server on port 5203) and prod behavior (bundled
  dist) share all of electron/main.cjs.
required: |
  AS-1.0: strict dev / test / prod separation. No prod data in lower envs.
  Debug code removed from prod builds.
gap: |
  There is no build-time switch to disable the /api/fetch-url and
  /api/fetch-raw proxies in prod, strip the console.log statements, or
  shorten the session timeout.
effort: S
blocks_tier: Gold Star
recommendation_ref: RECO-SDLC-CI
```

---

## TPN-SDLC-005 — Exception details leaked in API responses

```yaml
id: TPN-SDLC-005
severity: MEDIUM
control: AS-1.0
domain: sdlc
title: 500-response bodies include raw error message from upstream
location: electron/main.cjs:658
evidence: |
  res.status(500).json({ error: e.message || 'Failed to fetch URL' });
  // Similar pattern in /api/fetch-raw and several rabbit routes
required: |
  Exception handlers must not leak internals (no stack traces / connection
  strings to end users).
gap: |
  A malformed URL to /api/fetch-url echoes back the node error (including
  sometimes resolved IPs, DNS failure codes). Not catastrophic locally but
  becomes HIGH once any of these routes are exposed off-machine.
effort: XS
blocks_tier: Gold Star
recommendation_ref: RECO-SDLC-CI
```

---

## TPN-SDLC-006 — 64 console.log / console.error / console.warn statements in src/

```yaml
id: TPN-SDLC-006
severity: LOW
control: AS-1.0
domain: sdlc
title: Debug logging to console throughout renderer code
location: repo-wide
evidence: |
  rg -c "console\.(log|error|warn)" src — 64 hits across 10 files, including
  src/storage.js, src/tools/otter_v0.3.1/Otter.jsx (6), and
  src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx (36).
required: |
  Dead / debug code removed from prod bundles. Logs ship to SIEM, not the
  devtools console.
gap: |
  Minor — most are genuine error handlers. Replace with the structured
  logger once TPN-LOG-001 lands.
effort: S
blocks_tier: none
recommendation_ref: RECO-LOG-SIEM
```

---

## TPN-IR-001 — No documented incident-response plan

```yaml
id: TPN-IR-001
severity: CRITICAL
control: OR-1.1
domain: incident_response
title: No INCIDENT_RESPONSE.md / IR runbook / on-call path
location: N/A — policy
evidence: |
  Repo root contains zero `.md` files (only a minimal README is referenced
  in packaged output via tool READMEs). `docs/`, `security/`, `runbooks/`
  directories do not exist.
required: |
  OR-1.1: documented IR plan covering detection → activation/notification →
  recovery → reconstitution. Named roles, escalation, notification SLA
  (24–72 hr, GDPR 72 hr for breaches).
gap: |
  A vendor cannot pass a Gold assessment without this document. TPN
  assessors cite missing documentation as the #1 deficiency finding.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-IR-PLAN
```

---

## TPN-IR-002 — No BCP / DR plan

```yaml
id: TPN-IR-002
severity: HIGH
control: OR-1.2
domain: incident_response
title: No BCP.md / disaster recovery procedure / RTO-RPO targets
location: N/A — policy
evidence: |
  No BCP / DR artifacts in the repo.
required: |
  OR-1.2: BCP covering threats to critical assets, power, systems failure,
  disasters, pandemics, breaches. Tabletop exercises. RTO/RPO targets.
  Third-party contracts include BCP/DR clauses.
gap: |
  No stated recovery-time or recovery-point objectives for the local data
  store, the Supabase-hosted project bundles, or the Google-Drive-backed
  files. No restore drill evidence.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-IR-BCP
```

---

## TPN-IR-003 — No documented security-awareness training program

```yaml
id: TPN-IR-003
severity: MEDIUM
control: OR-3.3
domain: incident_response
title: No reference to annual security training, phishing simulation, etc.
location: N/A — policy
evidence: |
  No `docs/security-training.md`, training records, or policy reference.
required: |
  OR-3.3: awareness training on hire + annually; covers BEC, social
  engineering, ransomware, malware, phishing. Periodic phishing campaigns.
gap: |
  Policy-level gap; file as DOC finding alongside IR.
effort: S
blocks_tier: Gold Star
recommendation_ref: RECO-IR-PLAN
```

---

## TPN-AI-001 — Client content reaches public Anthropic endpoint with no policy gate, redaction, or approval check

```yaml
id: TPN-AI-001
severity: CRITICAL
control: OR-5.0
domain: ai_ml
title: Direct-browser calls to api.anthropic.com carry project titles, scripts, intake docs
location: src/App.jsx:649
evidence: |
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    ...
    headers: {
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    ...
  });
  // Same pattern: src/agent/AgentProvider.jsx:367,
  // src/tools/rabbit_v0.1.0/intake/pipeline.js:273 and :357
required: |
  OR-5.0 (NEW in v5.3): only internally-managed, sandboxed LLMs for
  pre-release content. No public AI without explicit studio approval.
  Data-source integrity review. Per-client AI-use approval. AI-specific
  training.
gap: |
  - No per-client gate — any WILSON user's content is sent to a public
    endpoint as soon as they paste an API key.
  - No redaction/minimization layer; titles, scripts, asset metadata, and
    full intake PDFs flow verbatim (RABBIT intake pipeline forwards
    document text).
  - "Dangerous direct browser access" is documented by Anthropic as a
    development affordance — production deployments are told to route
    through a server-side gateway that can enforce policy and rotate keys.
  - There is no AI_POLICY.md or aiGateway; the lint rule that would block
    direct SDK usage does not exist.
effort: L
blocks_tier: Silver
recommendation_ref: RECO-AI-POLICY
```

---

## TPN-AI-002 — No AI/ML security policy document

```yaml
id: TPN-AI-002
severity: HIGH
control: OR-5.0
domain: ai_ml
title: No AI_POLICY.md / docs/ai-usage-policy.md
location: N/A — policy
evidence: |
  No AI-policy file in the repo.
required: |
  OR-5.0: formal AI/ML security policy listing allowed models, use cases,
  data-handling rules, client-approval workflow.
gap: |
  Paired documentation finding to TPN-AI-001.
effort: XS
blocks_tier: Gold
recommendation_ref: RECO-AI-POLICY
```

---

## TPN-AI-003 — AI responses are not lifecycle-tracked

```yaml
id: TPN-AI-003
severity: HIGH
control: OR-5.0
domain: ai_ml
title: Anthropic responses are stored in chat/agent state with no retention, no purge, no content-lifecycle binding
location: src/agent/AgentProvider.jsx:367
evidence: |
  Agent and chat responses are appended to component state and persisted
  via the regular projects blob (IndexedDB) with no TTL and no content-
  lifecycle association.
required: |
  Model responses that can contain pre-release content must be covered by
  the content-lifecycle policy (AS-3.15) with a defined retention and
  certified-disposal path.
gap: |
  If an intake PDF contained a shooting schedule, the model's summary is now
  a permanent unencrypted copy of the same data with no link back to the
  originating asset's lifecycle state.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-CONT-LIFECYCLE
```

---

## TPN-CLOUD-001 — Supabase project shipped with RLS disabled per in-repo guidance

```yaml
id: TPN-CLOUD-001
severity: HIGH
control: CS-1.13
domain: cloud
title: Adapter README directs users to run RABBIT against Supabase with RLS off
location: src/tools/rabbit_v0.1.0/adapters/supabaseAdapter.js:13
evidence: |
  // Service role key is optional in v0.1 — single-user mode runs fine
  // against the anon key alone with RLS disabled. db/README.md
  // documents the v0.2 plan to flip RLS on with auth.uid() rules.
required: |
  CS-1.13: multi-tenancy isolation at every layer. AES-256 on all cloud-
  stored content (provider default is OK if CMK is layered). Access via
  VPN / private connectivity, not public endpoints.
gap: |
  RLS-off means the anon key can read/write every row in every tenant's
  tables on that Supabase project. If more than one WILSON install ever
  shares a Supabase backend, TPN multi-tenancy isolation is violated. Even
  in single-user mode this is an assessor-visible config-by-default issue.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-CLOUD-KMS
```

---

## TPN-CLOUD-002 — No Customer-Managed Key (CMK) guidance for Supabase Storage bucket

```yaml
id: TPN-CLOUD-002
severity: MEDIUM
control: CS-1.13
domain: cloud
title: `rabbit-files` bucket relies on Supabase provider-managed keys, no CMK
location: src/tools/rabbit_v0.1.0/adapters/supabaseAdapter.js:16
evidence: |
  // Storage bucket: 'rabbit-files' (must exist; see db/README.md §3).
  //   Upload key pattern: projects/{project_id}/{entity}/{id}/{filename}
required: |
  CS-1.13 Additional Rec: per-tenant CMK, keys stored separately from data.
gap: |
  Best Practice (AES-256 at rest via Supabase default) is likely met; the
  Additional Recommendation for a CMK per-project is not addressed.
effort: L
blocks_tier: Gold Star
recommendation_ref: RECO-CLOUD-KMS
```

---

## TPN-PHYS-000 — No findings in this domain

```yaml
id: TPN-PHYS-000
severity: N/A
control: TPN-general
domain: physical
title: N/A — WILSON does not control physical systems
location: N/A — out of scope
evidence: |
  The app does not integrate with badge readers, NVR/DVR, camera systems,
  or visitor kiosks.
required: |
  Physical controls (server room, visitor log, camera retention) are
  evaluated at the facility layer of the parent organization's TPN
  assessment, not in software audit.
gap: |
  N/A — out of scope for software audit. Record the decision so the
  implementation skill does not try to open physical findings.
effort: XS
blocks_tier: none
recommendation_ref: none
```

---

## TPN-DOC-001 — Missing SECURITY.md

```yaml
id: TPN-DOC-001
severity: HIGH
control: OR-3.x
domain: documentation
title: No SECURITY.md at repo root (vuln disclosure, supported versions, contact)
location: N/A — policy
evidence: File does not exist.
required: |
  Standard expectation for a software provider. Sets the channel for
  coordinated vulnerability disclosure.
gap: Paired with GitHub's security tab being empty; no contact method.
effort: XS
blocks_tier: Gold
recommendation_ref: RECO-DOC-FILES
```

---

## TPN-DOC-002 — Missing HARDENING.md (required for software providers, CSBP v5.2+)

```yaml
id: TPN-DOC-002
severity: HIGH
control: OR-3.x
domain: documentation
title: No HARDENING.md published
location: N/A — policy
evidence: File does not exist; no equivalent in the tool READMEs.
required: |
  Since MPA CSBP v5.2 (Aug 2023), software providers must publish hardening
  guidelines (supported TLS, required cipher suites, default-deny network
  posture, minimum OS hardening, MDM profile, monitoring expectations,
  backup frequency, log retention) on TPN+.
gap: |
  TPN assessors treat a missing hardening guide as an automatic finding
  for any software vendor.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-SDLC-HARDEN
```

---

## TPN-DOC-003 — Missing ACCESS_CONTROL, KEY_MANAGEMENT, LOGGING_AND_RETENTION, VENDOR_RISK, RISK_ASSESSMENT

```yaml
id: TPN-DOC-003
severity: HIGH
control: OR-3.x
domain: documentation
title: Five core policy docs absent
location: N/A — policy
evidence: |
  ACCESS_CONTROL.md, KEY_MANAGEMENT.md, LOGGING_AND_RETENTION.md,
  VENDOR_RISK.md, RISK_ASSESSMENT.md all do not exist.
required: |
  Evidence-ready documentation for each audit topic. Assessors cannot infer
  controls from code alone.
gap: |
  Even where a control is partially present in code (e.g., session timeout),
  the absence of the policy doc means an assessor cannot attest that the
  control is intentional and reviewed.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-DOC-FILES
```

---

## TPN-3P-001 — No SBOM / no SCA scan in CI

```yaml
id: TPN-3P-001
severity: HIGH
control: TS-4.0
domain: third_party
title: No sbom.json / bom.xml / sbom.spdx.json; no npm-audit gate in pipeline
location: repo-wide
evidence: |
  No SBOM file in the repo. No CI configured (see TPN-SDLC-003). Dependencies
  ship at their latest install-time versions with no ongoing triage.
required: |
  SCA per build. SBOM recommended. Critical vulns: plan within 48 hr.
gap: |
  `@supabase/supabase-js`, `xlsx@0.18.5`, `pdf-parse@2.4.5`, `express@5.2.1`,
  `sharp@0.34.5`, `mammoth@1.12.0` are all exposure points that need
  continuous scanning; none is in place.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-3P-CVE
```

---

## TPN-3P-002 — xlsx library with known prototype-pollution class vulnerabilities

```yaml
id: TPN-3P-002
severity: HIGH
control: TS-4.0
domain: third_party
title: xlsx@0.18.5 — historical prototype-pollution and ReDoS advisories
location: package.json:40
evidence: |
  "xlsx": "0.18.5"
  // Used in src/components/RateCard and RABBIT intake to parse
  // user-supplied spreadsheets.
required: |
  Known-vulnerable deps with a mitigation path must be upgraded or replaced.
gap: |
  SheetJS has published CVE-2023-30533 and CVE-2024-22363 advisories against
  this version family. Since WILSON parses spreadsheets the user imports
  (including ones that may have been emailed), this is an active risk.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-3P-CVE
```

---

## TPN-3P-003 — Third-party AI vendor lacks formal TPN engagement reference

```yaml
id: TPN-3P-003
severity: MEDIUM
control: OR-3.4
domain: third_party
title: No VENDOR_RISK.md covering Anthropic, Supabase, Google Drive, SheetJS
location: N/A — policy
evidence: |
  No vendor list, DPA reference, or sub-processor register is maintained.
required: |
  OR-3.4: third parties handling content must be documented, reviewed
  annually, and covered by contractual BCP/DR clauses.
gap: |
  WILSON's data flow touches at least four external providers. None is
  documented or risk-rated in repo.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-DOC-FILES
```
