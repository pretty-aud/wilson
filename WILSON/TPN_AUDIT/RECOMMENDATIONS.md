# TPN Compliance — Recommendations

Grouped by theme. Each `RECO-*` section is the canonical remediation pattern for the findings that reference it in their `recommendation_ref` field.

---

## RECO-ENC-HASH — Hash passwords with argon2id; remove plaintext storage

**Applies to:** TPN-ENC-003.

### What TPN requires
Passwords hashed and salted with argon2id (preferred), bcrypt, scrypt, or PBKDF2. Plaintext storage banned. Hash comparison must be constant-time.

### Recommended change pattern

```js
// electron/main.cjs
const argon2 = require('argon2');

async function setPassword(newPw) {
  const hash = await argon2.hash(newPw, { type: argon2.argon2id, memoryCost: 1 << 16 });
  writeJSON(getPasswordFile(), { hash, updated_at: Date.now() });
}

async function verifyPassword(input) {
  const data = readJSON(getPasswordFile(), null);
  if (!data?.hash) return false;
  try { return await argon2.verify(data.hash, input); } catch { return false; }
}
```

### Side effects / interface preservation
- Existing wilson-auth.json files need a one-shot migration: on first verify, accept the plaintext comparison, then rehash on success.
- The `length > 12` and `[a-zA-Z0-9]+` constraints and the `toUpperCase()` fold must all be removed; see RECO-AUTH-MFA.

### Verification
`grep -n "password" electron/main.cjs` returns no plaintext compare. Test: set password "Hello!", restart app, login succeeds; manually editing the hash in wilson-auth.json rejects the previously-correct password.

---

## RECO-ENC-AES — Encrypt data at rest (IndexedDB, on-disk JSON)

**Applies to:** TPN-ENC-002 (on-disk JSON), TPN-ENC-004 (IndexedDB), and the storage layer in general.

### What TPN requires
AES-256-GCM for data at rest. Key stored in the OS keystore (DPAPI on Windows, Keychain on macOS, libsecret on Linux), not alongside the ciphertext.

### Recommended change pattern

```js
// electron/secureStore.cjs  (new)
const { safeStorage } = require('electron');
const fs = require('fs');

function writeEncrypted(filePath, obj) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS keystore unavailable');
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const ciphertext = safeStorage.encryptString(plaintext.toString('utf8'));
  fs.writeFileSync(filePath, ciphertext);
}

function readEncrypted(filePath) {
  const buf = fs.readFileSync(filePath);
  return JSON.parse(safeStorage.decryptString(buf));
}
```

- For IndexedDB: wrap `saveProjects` / `loadProjects` (`src/storage.js`) with an AES-256-GCM pass using a key provisioned at first run via the main process (`safeStorage.encryptString` returns an opaque blob the main process alone can decrypt).
- Never include the key material in the renderer. Move `storage.js` into an IPC-backed facade.

### Side effects / interface preservation
- Existing unencrypted IndexedDB rows and JSON files must be migrated at next launch (detect magic bytes, migrate, delete originals).
- `safeStorage` is per-user per-machine — cross-machine backup restore requires re-auth and rekey.

### Verification
- Start app, exit, `hexdump %APPDATA%/WILSON/otter-data/pet.json` → binary, not JSON.
- Export IndexedDB with Chrome devtools → rows are ciphertext.
- Key never touches the renderer (grep `safeStorage` returns only main-process hits).

---

## RECO-ENC-TLS — Not applicable to local traffic; keep TLS 1.2+ floor on external fetches

**Applies to:** all outbound fetch() sites (Anthropic, Supabase, Google APIs). Currently no TLS downgrades or `rejectUnauthorized: false` — keep it that way.

### What TPN requires
TLS 1.2 minimum (TLS 1.3 preferred) on all outbound content/auth traffic. No wildcard certs.

### Side effects / interface preservation
- Add a lint rule / CI check that forbids `rejectUnauthorized: false` and `http://` URLs outside of `localhost|127\.0\.0\.1`.

### Verification
Grep must stay clean. `curl --tls-max 1.1` against any provider fails — it already does because providers enforce 1.2+.

---

## RECO-ENC-KEYS — Move secrets to OS keystore + document KMS plan

**Applies to:** TPN-ENC-001, TPN-ENC-002, TPN-ENC-006.

### What TPN requires
Centralized key storage in Vault / KMS / HSM or platform keychain for desktop. Per-tenant / per-project keys. Rotation every 1–3 yr. Documented compromise procedure.

### Recommended change pattern
- **Desktop credentials** (Anthropic API key, Supabase anon + service_role, Google OAuth refresh token): stop using localStorage/JSON; write through `safeStorage` (RECO-ENC-AES). The renderer gets a handle, not the material.
- **Document** a `KEY_MANAGEMENT.md` covering custodians, rotation cadence, compromise playbook, emergency-rotate steps for each secret type.
- **Future cloud posture:** if the Supabase project is shared, introduce per-project CMK (Supabase → configure a CMK on the storage bucket).

### Verification
- `rg -n "localStorage.*api-key|localStorage.*secret"` → no hits.
- Restart app, yank wilson-auth.json, app prompts for re-provision without leaking plaintext.

---

## RECO-ENC-WATERMARK — Add a forensic watermark service on the download path

**Applies to:** TPN-ENC-005, TPN-CONT-005.

### What TPN requires
Session-based invisible forensic watermarking on streamed AND downloaded content. Each viewer gets a uniquely-marked copy. Payload persisted for post-leak trace.

### Recommended change pattern
- Introduce a small watermarking service wrapping the download route. MVP: append a steganographic tag derived from `(userId, sessionId, assetId, now)` to image/video outputs via ffmpeg filter or an image-only steg for v0.1.
- Persist `watermarks` table: `(id, user_id, session_id, asset_id, payload, issued_at)`.
- Hook both `/api/rabbit/projects/:projectId/files/:id/download` and the Drive/Supabase Storage upload paths.

```ts
async function deliverAsset(userId, sessionId, assetId, readStream, res) {
  const payload = crypto.randomUUID();
  await wmStore.record({ userId, sessionId, assetId, payload });
  wm.embed(readStream, { payload }).pipe(res);
}
```

### Side effects / interface preservation
- Streaming cost increases per delivery. Cache per-viewer watermarked copies for high-traffic assets.
- Downstream CDN must not transcode the watermark away.

### Verification
- Deliver the same asset to two simulated viewers; extract payloads — differ.
- Audit log ties a payload → viewer. Leaked file passed through the extractor returns the original viewer.

### Migration
- Watermarking is irreversible — document a viewer notice in Help.
- Feature-flag on rollout; dual-path for 30 days so a broken extractor does not block delivery.

---

## RECO-AUTH-MFA — Move to SSO + MFA; fix password policy as interim

**Applies to:** TPN-AUTH-002, TPN-AUTH-003.

### What TPN requires
MFA on remote access, VPN, admin/privileged, content transfer, client portals, surveillance. Option A (Additional Rec) — MFA on every account — is the cleanest path.

### Recommended change pattern
- Short term: upgrade password policy.
  - Remove the 12-char ceiling; require 12-char minimum, full ASCII, no case-fold.
  - Add 10-attempt lockout with 1-min auto-unlock and an audit event per failure.
  - Remove `DILLYDALLY` and `MUTINY` literals — see RECO-SDLC-SECRETS.
- Medium term: bind the app to an SSO/IDP (OKTA, Microsoft Entra, Auth0, WorkOS). Require TOTP or WebAuthn at login. Require step-up MFA on admin routes (password change, Supabase/Drive cred rewrite).

### Side effects / interface preservation
- Users with short passwords must rotate on next login. Communicate in release notes.
- SSO integration changes the PasswordScreen UX — allow a local-auth fallback for offline use but gate the admin routes to IDP-only.

### Verification
- 10 bad attempts → 429 + locked 60 s.
- Admin route tests fail without an MFA claim present in the session.

---

## RECO-AUTH-SESSION — Real sessions with Secure/HttpOnly cookies, 30-min idle, rotation, single-session

**Applies to:** TPN-AUTH-004, TPN-NET-003.

### What TPN requires
AS-3.8: 30-min idle timeout; forced re-auth after 4 hr; 5–10 failure lockout; no concurrent sessions per user; session IDs cryptographically random; rotated on privilege change; cookies `Secure` + `HttpOnly` + non-persistent.

### Recommended change pattern

```js
const session = require('express-session');
expressApp.set('trust proxy', 1);
expressApp.use(session({
  name: 'wsid',
  secret: await getOrCreateSessionSecret(), // stored via safeStorage
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: true,         // served over HTTPS even in the localhost bridge (self-signed OK)
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 30 * 60 * 1000,
  },
  genid: () => crypto.randomBytes(32).toString('hex'),
}));
```

- Store `{ userId, sid }` in an in-memory Map; on new login for the same userId, invalidate prior sids.
- Rotate sid on `/api/auth/change` (privilege change) and on admin step-up.

### Side effects / interface preservation
- PasswordScreen continues to call `/api/auth/verify`; server replies with `Set-Cookie`. All subsequent fetches must include `credentials: 'include'`.
- Existing `last_auth_at` file becomes unused — delete after migration.

### Verification
- 30 min idle → session invalid.
- Two logins from two "devices" → earlier one 401s.
- Brute force 10 times → lockout.

---

## RECO-AUTH-RBAC — Introduce an identity model with roles

**Applies to:** TPN-AUTH-005.

### What TPN requires
TS-1.7: RBAC + ABAC. Unique usernames. Server-side enforcement. Quarterly access reviews.

### Recommended change pattern
- Add a `users` record (with username, hashed password, role ∈ {viewer, editor, admin}), delivered via SSO once adopted.
- Centralize permission checks in middleware:

```js
function requireRole(role) {
  return (req, res, next) => {
    if (!req.session?.user) return res.status(401).json({ error: 'unauth' });
    if (!roleAtLeast(req.session.user.role, role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}
expressApp.post('/api/auth/change', requireRole('admin'), /* handler */);
expressApp.post('/api/rabbit/projects/:projectId/files', requireRole('editor'), /* handler */);
```

### Side effects / interface preservation
- PasswordScreen becomes a full login. Tools require a non-null `session.user`.
- Backfill: the single-user migration creates one `admin` account on first run.

### Verification
Integration test: viewer cannot POST to password-change, editor cannot rewrite Supabase config, admin can do both.

---

## RECO-NET-SEG — Lock down CORS, add allow-listed fetch proxy, add rate limiting

**Applies to:** TPN-NET-001, TPN-NET-002, TPN-NET-003.

### What TPN requires
TS-2: default-deny on boundaries. No arbitrary internet egress from content systems. Rate limiting on auth.

### Recommended change pattern

```js
// CORS: bind to the Electron-loaded origin only
expressApp.use(cors({
  origin: (origin, cb) => {
    if (!origin || /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return cb(null, true);
    return cb(new Error('origin not allowed'));
  },
  credentials: true,
}));

// Rate limit auth + destructive routes
const rateLimit = require('express-rate-limit');
expressApp.use('/api/auth/', rateLimit({ windowMs: 60_000, max: 10 }));

// Fetch URL allow-list (or drop if unused)
const ALLOWED_HOSTS = new Set(['docs.google.com', 'raw.githubusercontent.com' /* ... */]);
function assertAllowed(u) {
  const url = new URL(u);
  if (!/^https?:$/.test(url.protocol)) throw new Error('bad proto');
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)/.test(url.hostname)) throw new Error('private range');
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error('host not allow-listed');
}
```

- Add a `csurf`-style CSRF token to state-changing routes; serve it via a GET the renderer reads at startup.

### Side effects / interface preservation
- If the Electron renderer loads the app from a different port each run, expand the regex to accept the full 127.0.0.1:* range.
- The `/api/fetch-*` routes may need to stay — narrow the allow-list to what the Rate Card and intake actually need.

### Verification
- A browser tab on `https://evil.example` cannot fetch WILSON APIs (CORS rejects).
- `curl -X POST /api/fetch-url -d '{"url":"http://169.254.169.254/latest/meta-data/"}'` → 400.
- 11th auth attempt in 60 s → 429.

---

## RECO-LOG-SIEM — Structured logger + log shipper

**Applies to:** TPN-LOG-001, TPN-LOG-003, TPN-LOG-004, TPN-SDLC-006.

### What TPN requires
TS-1.5: SIEM with centralized real-time logging. Auth + admin + config + content events captured with structured fields. Retention ≥ 1 year. Dual authorization to delete.

### Recommended change pattern
- Adopt `pino` in the main process. Write to a rotating file (`electron-log` or `pino.destination` + rotation). Optionally ship to the user-configured SIEM (Splunk HEC / Sentinel DCR / Datadog / Elastic) via a background agent.
- Standardize an event schema:

```ts
type WilsonEvent = {
  ts: string; kind: 'auth' | 'admin' | 'content' | 'config' | 'ai';
  action: string; result: 'success' | 'failure' | 'blocked';
  userId?: string; sessionId?: string; ip?: string;
  assetId?: string; path?: string;
  meta?: Record<string, unknown>;
};
```

- Replace all 64 `console.*` calls in src/ with the `pino`-backed logger exposed via preload.

### Side effects / interface preservation
- Log volume may spike — tune levels (DEBUG stays local, INFO+ ships).
- Log file location must be added to `wilsonapp` data export paths and to disposal routines (RECO-CONT-LIFECYCLE).

### Verification
- Kill the app mid-operation; log is complete on disk to the last flushed event.
- Auth success visible in SIEM within 60 s (when shipping enabled).

---

## RECO-LOG-SCHEMA — Content-event schema on upload/download/delete

**Applies to:** TPN-LOG-002.

### What TPN requires
AS-2.9: every upload/download/view/share/delete emits an event with timestamp, userId, sessionId, action, result, ipAddress, macAddress (thick clients), geolocation (if available), assetId, path, per-user-per-asset download count.

### Recommended change pattern

```js
function emitContentEvent(req, e) {
  logger.info({
    ts: new Date().toISOString(),
    kind: 'content',
    action: e.action,
    result: e.result,
    userId: req.session?.user?.id,
    sessionId: req.sessionID,
    ip: req.ip,
    assetId: e.assetId,
    path: e.path,
    perUserPerAssetCount: incCounter(req.session?.user?.id, e.assetId, e.action),
  });
}

expressApp.post('/api/rabbit/projects/:projectId/files', (req, res) => {
  ...
  emitContentEvent(req, { action: 'upload', result: 'success', assetId: fileId, path: diskName });
  res.json(row);
});
```

- Outbound transfer route (Drive upload, Supabase Storage) additionally triggers an owner-notification event and email.

### Verification
- Integration test: POST/GET/DELETE produce three events with required fields.
- `perUserPerAssetCount` increments and resets on rotation (daily).

---

## RECO-CONT-LIFECYCLE — Formal content lifecycle state machine + certified disposal

**Applies to:** TPN-CONT-002, TPN-CONT-004, TPN-AI-003.

### What TPN requires
AS-3.15: receipt/creation → WIP → delivery → archival → certified disposal. Chain-of-custody, versioning, confirmation receipts, retention, proof-of-deletion including backups and caches.

### Recommended change pattern
- Add `state` + `state_history` to the `files` and `managedFiles` records.
- Reject invalid transitions at the API layer.
- Disposal is an async job that purges primary, thumbnail cache, IndexedDB copies, Supabase Storage object, Drive file, and agent/chat references. Returns a signed cert-of-deletion (log event with SHA-256 of removed bytes).
- Retention: configurable per project, default 365 days in archival, 30 days in thumbnail cache.

### Side effects / interface preservation
- Delete becomes async (returns jobId; poll). UI must reflect "deleting" state.
- AI responses (TPN-AI-003) get tagged with originating `assetId` and follow the same lifecycle.

### Verification
- Happy-path test transitions through every state; skip attempts → 409.
- Disposal job produces a cert; filesystem and Supabase Storage inspections confirm purge; thumbnails dir is swept.

---

## RECO-CONT-LINKS — Expiring, single-use, rate-limited download tokens

**Applies to:** TPN-CONT-001, TPN-CONT-003.

### What TPN requires
External links auto-expire (24-hr default); per-user download/stream caps; Cache-Control: no-store + Pragma: no-cache on sensitive responses.

### Recommended change pattern

```js
async function createDownloadToken({ userId, projectId, fileId, ttlSec = 300, maxUses = 1 }) {
  const token = crypto.randomBytes(32).toString('base64url');
  await store.put(`dl:${token}`, { userId, projectId, fileId, exp: Date.now() + ttlSec*1000, usesLeft: maxUses });
  return token;
}

expressApp.get('/api/rabbit/projects/:projectId/files/:id/download', requireSession, rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
  const t = req.query.t;
  const ok = await consumeToken(t, req.params.projectId, req.params.id);
  if (!ok) return res.status(410).json({ error: 'link expired or already used' });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  ...
});
```

### Verification
Replay → 410. Wait past TTL → 410. 31st request in a minute → 429.

---

## RECO-SDLC-SECRETS — Remove hardcoded secrets; adopt a secret-resolver pattern

**Applies to:** TPN-SDLC-001, TPN-SDLC-002, TPN-ENC-001, TPN-AUTH-001.

### What TPN requires
No secrets in code or config-in-VCS. Dedicated secrets manager. All credentials rotate.

### Recommended change pattern
- Delete `ADMIN_PASSWORD` and `DEFAULT_PASSWORD` constants. First-run flow asks the user to set a password (argon2-hashed via RECO-ENC-HASH).
- Delete the `MUTINY` fallback in `PasswordScreen.jsx:20`; on network failure, show an error, do not offer offline access.
- Build a single `getSecret(name)` helper that:
  - Reads from `safeStorage`-encrypted files for Anthropic/Supabase/Drive tokens.
  - Never logs the value; log only the fact of a resolution.
- Update `.gitignore`:

```
.env*
*.pem
*.key
*.p12
*.pfx
TPN_AUDIT/secrets.*
**/gdrive-tokens.json
**/supabase.json
**/wilson-auth.json
```

- Add `.env.example` (empty placeholders) so the shape is still discoverable.
- Rotate every credential that has ever been hardcoded.
- Add `gitleaks` pre-commit via husky.

### Verification
- `gitleaks detect --redact -s .` returns zero.
- `grep -E "DILLYDALLY|MUTINY" -r src electron` returns zero.
- Old wilson-auth.json files are migrated on first run.

---

## RECO-SDLC-CI — SAST / SCA / DAST / container / IaC in CI

**Applies to:** TPN-SDLC-003, TPN-SDLC-004, TPN-SDLC-005, TPN-3P-001, TPN-3P-002.

### What TPN requires
SAST per commit/PR, SCA per build, DAST per release, container scan per image, IaC scan per infra change. Critical vulns plan within 48 hr. External vuln scan monthly, internal quarterly.

### Recommended change pattern (GitHub Actions)

```yaml
# .github/workflows/security.yml
name: security
on:
  pull_request:
  schedule: [{ cron: '0 6 * * 1' }]
jobs:
  sast:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: returntocorp/semgrep-action@v1
        with: { config: p/owasp-top-ten p/react p/nodejs }
  sca:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm audit --omit=dev --audit-level=high
      - uses: snyk/actions/node@master
        env: { SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }} }
  secrets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2
```

- Add a prod-only guard that disables `/api/fetch-url` and `/api/fetch-raw` unless a `WILSON_ALLOW_FETCH_PROXY=1` env var is set (TPN-SDLC-004).
- In 500 handlers, strip `e.message`; log the real error, return a generic body with a correlation id (TPN-SDLC-005).

### Verification
- Known-vulnerable PR (bump `xlsx` back to 0.18.0) → CI fails.
- `/api/fetch-url` returns 503 in prod without the env flag.

---

## RECO-SDLC-HARDEN — Publish HARDENING.md

**Applies to:** TPN-DOC-002.

### What TPN requires
Software providers publish hardening guidelines documenting security measures and configuration best practices on TPN+.

### Recommended change pattern
Create `HARDENING.md` at repo root covering (one section each):

1. Supported OS + minimum versions.
2. Full-disk encryption requirement (BitLocker / FileVault / LUKS).
3. MDM profile recommendations.
4. Network posture (outbound-only, firewall rules, no inbound).
5. Secrets handling — how WILSON resolves secrets, rotation cadence, compromise procedure.
6. Logging — what is logged, retention, SIEM integration.
7. Supabase / Drive configuration — RLS on, per-project CMK, bucket policies.
8. Update / patch cadence.
9. Versioning header + "Last reviewed: YYYY-MM-DD".

### Verification
Reviewer can point to a line in HARDENING.md for every audit control.

---

## RECO-IR-PLAN — Create INCIDENT_RESPONSE.md and run a tabletop

**Applies to:** TPN-IR-001, TPN-IR-003.

### What TPN requires
OR-1.1: documented plan covering detection → activation → recovery → reconstitution. Named roles, escalation chain, notification SLA (24–72 hr typical; GDPR 72 hr).

### Recommended change pattern
Create `INCIDENT_RESPONSE.md` with sections: Purpose, Scope, Roles & Contacts, Severity Matrix, Detection, Activation & Notification (SLA = 24 hr content impact / 72 hr other), Recovery, Reconstitution (RCA, lessons learned), Notification Templates. Append the first tabletop's after-action report.

### Verification
Tabletop completed; AAR appended; on-call roster committed.

---

## RECO-IR-BCP — Create BCP.md + run a restore drill

**Applies to:** TPN-IR-002.

### What TPN requires
OR-1.2: BCP enumerating threats, RTO/RPO targets, restore procedures. OR-3.4: third-party BCP/DR contracts.

### Recommended change pattern
Create `BCP.md`. For WILSON the critical-asset list is: user's IndexedDB / wilson-projects blob, rabbit-data JSON bundles, Supabase project, Drive folder tree, local thumbnail cache. Document RTO (4 hr), RPO (24 hr), and a quarterly restore drill.

### Verification
Drill report appended; RTO met.

---

## RECO-AI-POLICY — AI gateway + AI_POLICY.md

**Applies to:** TPN-AI-001, TPN-AI-002, TPN-AI-003.

### What TPN requires
OR-5.0: formal AI/ML security policy. Only internally-managed sandboxed LLMs. No content to public AI services without explicit studio approval. Data-source review. Client approval. AI-specific training.

### Recommended change pattern
- Add an `aiGateway` module that every model call must go through. Enforce:
  - Per-client allow-list (off by default).
  - Redaction of known content signals (asset titles, release dates, cast names) when the caller does not have a documented content-AI approval.
  - Structured logging (see RECO-LOG-SIEM, kind:'ai').
  - Model allow-list + default endpoint of a self-hosted proxy (Claude through AWS Bedrock or an organization-owned gateway) for any content-bearing flow.
- Remove `anthropic-dangerous-direct-browser-access: 'true'`. Move Anthropic fetches into the main process behind the gateway. The renderer gets a `sendPrompt()` IPC with no API-key handling.
- Add `AI_POLICY.md` listing: allowed models, allowed use cases, approval workflow, redaction rules, retention of prompts/responses (tie to RECO-CONT-LIFECYCLE).
- Add an ESLint custom rule that bans direct imports of `@anthropic-ai/sdk`, `openai`, `@google/generative-ai`, etc. outside `src/agent/aiGateway`.

### Side effects / interface preservation
- Renderer no longer sees the API key. Feature flags for existing pages (D.O.G., Otter, Rabbit intake, pet companion) must switch to the IPC path.
- Behavior for users with no content-AI approval: model call refuses rather than runs. Communicate in release notes.

### Verification
- `rg -n "x-api-key|anthropic-dangerous-direct-browser-access"` in `src/` → zero.
- Integration test: intake PDF whose text contains a tagged release-date pattern → blocked on disallowed endpoint.

---

## RECO-CLOUD-KMS — Turn on Supabase RLS by default + document CMK plan

**Applies to:** TPN-CLOUD-001, TPN-CLOUD-002.

### What TPN requires
CS-1.13: AES-256 on all cloud-stored content (provider default acceptable). Keys separate from data. Per-tenant/per-project keys as Additional Rec. Multi-tenancy isolation.

### Recommended change pattern
- Ship a SQL migration (or Supabase CLI snippet) in `src/tools/rabbit_v0.1.0/db/` that enables RLS on every table with `auth.uid()` rules. Flip the adapter README to require RLS on.
- Document the CMK path in `KEY_MANAGEMENT.md` — when studios require a per-project CMK, how WILSON provisions and consumes it.
- Remove the permissive "service role key is optional — RLS off is fine" guidance.

### Verification
- Fresh Supabase project bootstrapped with the migration → attempting to read another user's project rows with the anon key fails.

---

## RECO-DOC-FILES — Author the missing policy docs

**Applies to:** TPN-DOC-001, TPN-DOC-003, TPN-3P-003, TPN-IR-003.

### What TPN requires
Evidence-ready documentation. TPN's #1 deficiency finding is lack of documentation even when practices are informally followed.

### Recommended change pattern
Create (at repo root, dated header, annual-review cadence):

- `SECURITY.md` — disclosure policy, supported versions, contact.
- `HARDENING.md` — per RECO-SDLC-HARDEN.
- `INCIDENT_RESPONSE.md` — per RECO-IR-PLAN.
- `BCP.md` — per RECO-IR-BCP.
- `AI_POLICY.md` — per RECO-AI-POLICY.
- `ACCESS_CONTROL.md` — roles, review cadence, revocation.
- `KEY_MANAGEMENT.md` — per RECO-ENC-KEYS.
- `LOGGING_AND_RETENTION.md` — per RECO-LOG-SIEM.
- `VENDOR_RISK.md` — Anthropic, Supabase, Google, SheetJS, plus DPA references.
- `RISK_ASSESSMENT.md` — annual risk register.

### Verification
All files exist with a `Last reviewed: YYYY-MM-DD` line ≤ 12 months old.

---

## RECO-3P-CVE — Dependency triage + SBOM + `xlsx` mitigation

**Applies to:** TPN-3P-001, TPN-3P-002.

### What TPN requires
SCA per build. Critical vulns: remediation plan within 48 hr. SBOM recommended.

### Recommended change pattern
- Replace `xlsx@0.18.5` with `@sheet/core` or pin SheetJS Pro (commercial with active maintenance) or isolate parsing to a sandboxed worker with a hardened prototype.
- Add `cyclonedx-npm` in CI to emit `sbom.json`.
- Enable `npm audit --audit-level=high` as a gate in CI (RECO-SDLC-CI).
- Subscribe to GHSA advisories for every direct dep; triage in ≤ 48 hr.

### Verification
- `npm audit --omit=dev` clean of high/critical.
- SBOM published with each release.

---

## Universal interface-preservation rules

Any change that touches these contracts requires a migration plan in the implementation prompt:

- `electron/preload.cjs` — IPC surface consumed by renderer (all `electronAPI.*`).
- `/api/*` REST surface consumed by renderer.
- On-disk JSON shapes: `pet.json`, `wilson-auth.json`, `supabase.json`, `gdrive-config.json`, `gdrive-tokens.json`, `files-config.json`, `rabbit` project bundles.
- IndexedDB `wilson-db`/`projects` store.
- Exported markdown formats (DOG: `DECKOUTLINE.md`, `VIS_DECKOUTLINE.md`, `IMG_PROMPTS.md`).

For each, the implementation skill must propose dual-read, cutover window, and rollback before executing the change.
