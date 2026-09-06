# TPN Compliance Audit — Findings

> Every finding below has been assigned an ID. The companion skill `tpn-compliance-implementation`
> reads this file to build a work queue. Do not renumber existing IDs on re-audit — append.

---

## TPN-ENC-001 — Application secrets (Anthropic API key) stored in browser localStorage

```yaml
id: TPN-ENC-001
severity: RESOLVED
resolved_date: 2026-07-30
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

**Re-audit 2026-07-30 — RESOLVED.**

Current location: `n/a - code deleted; purge stub now at src/App.jsx:231-235`

The baseline evidence line (`localStorage.setItem('wilson-api-key', ...)` at src/App.jsx:163) no longer exists. The only surviving reference is the inverse: src/App.jsx:232-233 runs `localStorage.removeItem('wilson-api-key')` and `localStorage.removeItem('deck-outline-generator-api-key')` in a mount effect, purging the credential on upgrade. Verified the control, not the artifact: `rg -n "x-api-key" src/ electron/` returns ZERO, and `rg -n "anthropic-dangerous-direct-browser-access"` returns zero outside TPN_AUDIT/ and docs/ prose (LEARNINGS.md re-audit checklist items 2 and 3 both pass). The key now exists only server-side — supabase/functions/ai-proxy/index.ts:238 sets `'x-api-key': resolved.key` inside the Edge Function, sourced from the ANTHROPIC_API_KEY secret (ai-proxy/index.ts:77) or from AES-256-GCM ciphertext in public.workspace_ai_keys (ai-proxy/index.ts:67-75). Note the remediation used a different mechanism than REMEDIATION_PLAN.md §90 prescribed (ai-proxy Edge Function rather than a safeStorage-backed `window.electronAPI.ai.sendPrompt()` IPC); the control (no key in browser-accessible storage) is nonetheless satisfied, and it is satisfied on BOTH hosts rather than Electron only.

---

## TPN-ENC-002 — Third-party credentials (Supabase keys, Google OAuth tokens) stored plaintext on disk

```yaml
id: TPN-ENC-002
severity: HIGH
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

**Re-audit 2026-07-30 — PARTIALLY REMEDIATED.**

Current location: `electron/main.cjs:2193 (gdrive-config.json) and electron/main.cjs:2201 (gdrive-tokens.json)`

Severity revised to **HIGH**.

The Supabase half is RESOLVED. The baseline's `writeJSON(path.join(getRabbitDataDir(), 'supabase.json'), cfg)` is gone; electron/main.cjs:2162-2167 now defines cleanupLegacySupabaseConfig(), which unlinks rabbit-data/supabase.json, and it is called on every boot at electron/main.cjs:2474. The service_role key that carried the RLS-bypass blast radius is therefore no longer written or retained anywhere on disk. The Google half is STILL OPEN and unchanged in substance. electron/main.cjs:2191-2195 writes gdrive-config.json — documented at :2184 as `{ clientId, clientSecret, redirectUri, rootFolderId }` — through the plain `writeJSON` helper (electron/main.cjs:67-69: `fs.writeFileSync(filePath, JSON.stringify(data, null, 2))`), and electron/main.cjs:2199-2203 writes gdrive-tokens.json, documented at :2185 as `{ accessToken, refreshToken, expiresAt }`, the same way. No OS keystore is applied to either. This is not a capability gap: `safeStorage` is imported at electron/main.cjs:1 and is used correctly for the Supabase session at electron/main.cjs:2419-2451 (encryptString to userData/session.enc, and it REFUSES to persist rather than falling back to plaintext when isEncryptionAvailable() is false, :2421). The gdrive path simply never adopted it. The path is live, not dead code: src/tools/rabbit_v0.1.0/adapters/googleDriveAdapter.js:62 reads the tokens back through the preload bridge (electron/preload.cjs:53-57), and `google_drive` remains a registered storage adapter at src/tools/rabbit_v0.1.0/adapters/index.js:199. Severity reduced CRITICAL -> HIGH: what remains at rest is one OAuth client secret plus a long-lived Google refresh token scoped to a single workstation's Drive tree, with no cross-tenant reach — materially smaller than the service_role key the baseline was rating.

---

## TPN-ENC-003 — Passwords stored plaintext (no hash, no salt)

```yaml
id: TPN-ENC-003
severity: RESOLVED
resolved_date: 2026-07-30
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

**Re-audit 2026-07-30 — RESOLVED.**

Current location: `n/a - code deleted; tombstone at electron/main.cjs:612-637, cleanup at electron/main.cjs:2176-2181`

The entire legacy local password module is gone. electron/main.cjs:612-637 is an explanatory tombstone where /api/auth/session, /api/auth/verify and /api/auth/change used to be; the baseline's `writeJSON(getPasswordFile(), { password: np.toUpperCase() })` and the `input === stored || input === ADMIN_PASSWORD` compare no longer exist. `ls src/components/PasswordScreen.jsx` -> No such file or directory, so the client that would have fallen through to a hardcoded compare on a 404 is deleted too (the comment at :624-627 shows this coupling was understood — deleting the routes alone would have been a fail-OPEN regression). LEARNINGS.md re-audit checklist item 1 passes: `rg -n "DILLYDALLY|MUTINY"` returns zero hits outside TPN_AUDIT/. Item 7 passes: no `password ===` compare remains in electron/main.cjs. Critically, deleting code is not deleting data, and that was handled: electron/main.cjs:2176-2181 defines cleanupLegacyAuthFile(), which unlinks getDataDir()/wilson-auth.json, wired into app.whenReady() at electron/main.cjs:2475 — so an existing install's plaintext uppercase credential is removed at rest on next launch. Password hashing is now entirely GoTrue's server-side bcrypt; no application code in this repo stores or compares a password. Both LEARNINGS.md risk-acceptances (the MUTINY offline fallback, the 12-char cap from the PasswordScreen typing animation) are moot because the code carrying them was deleted, exactly as the brief anticipated.

---

## TPN-ENC-004 — IndexedDB project store (WILSON content) is unencrypted

```yaml
id: TPN-ENC-004
severity: MEDIUM
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

**Re-audit 2026-07-30 — PARTIALLY REMEDIATED.**

Current location: `src/storage.js:83 (baseline :81 — the store is now ORPHANED); the live control moved to electron/main.cjs:67-69 and electron/main.cjs:2297`

Severity revised to **MEDIUM**.

The named location is now dead code. src/storage.js still exists (109 lines; the baseline's transaction block re-resolves to :83-89) but has ZERO importers — `rg -n "from '\./storage'|from '\.\./storage'|saveProjects|loadProjects"` across the repo matches only src/storage.js itself, and `rg -ln indexedDB` over the whole repo returns exactly one file, src/storage.js. So the IndexedDB `wilson-db.projects.all` store the baseline rated is no longer written by anything. The CONTROL is only partly satisfied, which is why this is PARTIAL and not RESOLVED. Primary content storage moved to Supabase Postgres plus the private `rabbit-files` bucket (src/tools/rabbit_v0.1.0/adapters/supabaseAdapter.js:413, :454) — provider-side AES-256 at rest, which meets AS-3.6 with provider-managed keys, and no `getPublicUrl` call exists anywhere. But `local_server` and `google_drive` remain registered storage modes (src/tools/rabbit_v0.1.0/adapters/index.js:198-200), and in those modes content still lands on the workstation as plaintext: project bundles via the unencrypted `writeJSON` helper at electron/main.cjs:67-69, and file bodies via the streaming copy at electron/main.cjs:2297 (`fs.createReadStream(sourcePath)`). There is no application-layer encryption on that path and no assertion anywhere in the repo that full-disk encryption is a prerequisite — `rg -i "bitlocker|filevault|full-disk|disk encryption"` returns zero hits in code or docs/. Severity reduced HIGH -> MEDIUM: the multi-tenant default is now provider-encrypted, and the residue is a per-workstation, opt-in storage mode. Housekeeping note (not filed separately): src/storage.js should be deleted — it is unreferenced and still contains a localStorage read/write fallback (:69-72, :104-108) that would silently reintroduce the baseline behaviour if anything ever imported it again.

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

**Re-audit 2026-07-30 — STILL OPEN.**

Current location: `electron/main.cjs:1351 (baseline :1255) and src/tools/rabbit_v0.1.0/adapters/supabaseAdapter.js:454`

No watermarking exists anywhere. `rg -n "watermark|forensicMark|embedWatermark"` over the entire repo (excluding node_modules/dist/TPN_AUDIT) returns ZERO hits — not a helper, not a stub, not a TODO. The baseline route re-resolves from electron/main.cjs:1255 to :1341-1352; the handler body still ends `res.setHeader('Content-Type', file.mime_type || 'application/octet-stream'); res.sendFile(diskPath);` at :1350-1351 with no session binding and no embed step. Sessions 13-14 touched this exact function — a path-containment guard was added at :1346-1348 (`resolveContainedFilePath`) and a 410 for a missing body at :1349 — so the code was actively worked on without the watermark hook landing; this is not an oversight of scope, it is unremediated. The cloud era added a SECOND unwatermarked egress the baseline could not have seen: src/tools/rabbit_v0.1.0/adapters/supabaseAdapter.js:452-457, `client.storage.from('rabbit-files').download(file.storage_path)` returns the raw Blob to the renderer. Any remediation must now cover both paths. Severity HIGH unchanged; still blocks Gold. Effort remains XL — this is the one baseline ENC finding that is genuinely a build, not a config change.

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

**Re-audit 2026-07-30 — PARTIALLY REMEDIATED.**

Current location: `repo-wide; positive evidence at electron/main.cjs:2419-2451 and supabase/functions/_shared/aiKeyCrypto.ts:62-78`

Severity revised to **MEDIUM**.

The baseline's evidence statement is now factually false and must be restated. It read: 'No references to AWS KMS, Azure Key Vault, GCP KMS, HashiCorp Vault, DPAPI, or OS keychain anywhere in /electron or /src.' There now are. electron/main.cjs:2410-2411 and :2419-2451 use Electron `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret on Linux) for the Supabase session, and supabase/functions/_shared/aiKeyCrypto.ts:62-78 implements an application-layer envelope scheme with a DEK held in the WILSON_AI_KEY_SECRET Edge-Function secret, deliberately outside Postgres so the nightly pg_dump cannot carry it. aiKeyCrypto.ts:71-73 hard-refuses any secret that does not decode to exactly 32 bytes rather than stretching or padding it, and :87 draws a fresh 12-byte random IV per encrypt — the crypto itself is correct and I found no defect in it. A rotation MECHANISM also now exists for tenant credentials (operator-ai-keys `set`/`clear`, supabase/functions/operator-ai-keys/index.ts:112-165). What remains open is the POLICY half the finding is actually about. `rg -i "rotat"` across the repo returns only Playwright test helpers (tests/e2e/auth.spec.ts:161-169), a Supabase refresh-token note (docs/WEB_DEPLOY.md:105) and an ai-proxy code comment — no cadence, no custodian, no compromise runbook. docs/ contains only MASTER_PLAN.md, ORIGINAL_BRIEF_multiuser.md, OWED_AUDREY.md, WEB_DEPLOY.md and sessions/; there is no HARDENING.md and no INCIDENT_RESPONSE.md, so LEARNINGS.md re-audit checklist item 5 FAILS. No KMS or Vault is used for the DEK itself (aiKeyCrypto.ts:16-23 documents why Supabase Vault was rejected — the no-Docker CI constraint — which is a reasoned trade, not an oversight). Severity MEDIUM unchanged; still blocks Gold Star. See new TPN-ENC-011 for the concrete operational consequence of the missing rotation path.

---

## TPN-ENC-007 — No HSTS on the public web host, and no Content-Security-Policy on any surface

```yaml
id: TPN-ENC-007
severity: HIGH
control: AS-3.7
domain: encryption
title: No HSTS on the public web host, and no Content-Security-Policy on any surface
location: vercel.json:14-24
evidence: |
  vercel.json's only `headers` block is scoped to `"source": "/wilsonadmin/:path*"` and sets exactly four headers — X-Robots-Tag, Referrer-Policy, X-Frame-Options, X-Content-Type-Options. There is no `Strict-Transport-Security` entry on any path, and `/wilson` (the tenant application, the surface every customer uses) receives no security headers at all. Repo-wide `rg -i "strict-transport|hsts|content-security-policy"` returns ZERO matches. index.html carries no CSP meta (its only meta tags are charset at :4 and viewport at :6); admin.html likewise (charset, viewport, robots only). The Electron shell sets none either — electron/main.cjs:2111-2118 configures webPreferences with nodeIntegration:false and contextIsolation:true but no session.defaultSession.webRequest.onHeadersReceived CSP injection.
required: |
  AS-3.7: data in transit protected by TLS 1.2+ with the downgrade path closed. For a public web application that means an HSTS response header so a first-request or coffee-shop downgrade to plaintext cannot occur. MPA CSBP additionally expects a browser-enforced content policy on any surface that handles pre-release material.
gap: |
  beta.petalstudios.co is a custom domain on Vercel. Vercel emits HSTS by default only for *.vercel.app deployment URLs; custom domains must declare it in the headers config, and this one does not. An attacker on the network path can strip TLS on the initial navigation. The absence of CSP is what makes TPN-ENC-008 exploitable rather than theoretical — with no script-src restriction, a single injected or compromised script on the tenant surface can read the operator session out of shared localStorage. The fix is four lines in the file that already exists.
effort: S
blocks_tier: Silver
recommendation_ref: RECO-ENC-TLS
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-ENC-008 — Platform-operator session tokens persist in origin-shared localStorage; key-name separation is not a security boundary

```yaml
id: TPN-ENC-008
severity: HIGH
control: AS-2.5
domain: encryption
title: Platform-operator session tokens persist in origin-shared localStorage; key-name separation is not a security boundary
location: src/cloud/auth/sessionStorage.js:39-40
evidence: |
  const STORAGE_KEY = SURFACE === 'admin' ? 'wilson.operator.session' : 'wilson.dev.session'  — and at :60, localStorage.setItem(STORAGE_KEY, JSON.stringify(session)), which persists the WHOLE session object including both access_token and refresh_token. The file's own header comment at :17-24 states the position plainly: 'localStorage is scoped per ORIGIN, not per path — on beta.petalstudios.co both bundles read the same store. So the operator bundle uses a DIFFERENT KEY, and that key string is the entire isolation mechanism.'
required: |
  AS-2.5: credentials must be stored separated from the host that consumes them, with segregation of duties between privilege tiers. A privileged-tier credential must not be readable by lower-tier code sharing the same execution context.
gap: |
  A localStorage key name is a namespace, not an access control. Every script running on the beta.petalstudios.co origin — including everything served under /wilson, and every npm dependency in that bundle — can call localStorage.getItem('wilson.operator.session') and read the platform operator's tokens. The privilege delta is the whole system: operator-workspaces can create, rename, suspend and irreversibly tear down any tenant. The hard-MFA control does not stop a replay — supabase/functions/_shared/operatorGuard.ts:110 authorizes on `decodeJwtPayload(token).aal !== 'aal2'`, so a stolen aal2 access token satisfies it, and the stored refresh token renews that session indefinitely without a second factor. With no CSP in place (TPN-ENC-007) there is no compensating control in the path. The Electron build is not affected — sessionStorage.js:48-51 routes to the safeStorage bridge and excludes the admin surface from it — so this is web-host-specific. Remediation is a separate origin (an operator subdomain) rather than a separate key; the same file's comment at :42-47 already acknowledges the one-slot Electron constraint that makes key-splitting inadequate.
effort: M
blocks_tier: Silver
recommendation_ref: RECO-AUTH-SESSION
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-ENC-010 — Nightly pg_dump lands in Backblaze B2 under provider-held keys only, with no client-side encryption and no in-job assertion that the bucket is encrypted

```yaml
id: TPN-ENC-010
severity: MEDIUM
control: AS-3.6
domain: encryption
title: Nightly pg_dump lands in Backblaze B2 under provider-held keys only, with no client-side encryption and no in-job assertion that the bucket is encrypted
location: .github/workflows/backups.yml:94-95
evidence: |
  aws s3 cp "/tmp/${FILE}" "s3://${B2_BACKUP_BUCKET}/${KEY}" --endpoint-url "${B2_S3_ENDPOINT}"  — no --sse, no --sse-c, no --sse-kms-key-id, and no gpg/age/openssl step anywhere in the job. The dump itself is produced at :91 as `pg_dump "${DB_URL}" -Fc --no-owner | gzip -6`, and the comment at :88-90 states it 'Excludes nothing: RLS, functions, cron metadata all ride along.' The verification step at :99-102 confirms only that the object is PRESENT, never that it is encrypted. The sole encryption is a manual console setting: docs/OWED_AUDREY.md:52-55 instructs 'Default Encryption: Enable — SSE-B2, Backblaze-managed key ... satisfies "backups encrypted at rest" for the S14 TPN pass.'
required: |
  AS-3.6 / AS-2.5: AES-256 at rest for all content INCLUDING backups, with the decryption key held separately from the data — a different custodian from the one storing the ciphertext.
gap: |
  SSE-B2 means Backblaze holds the ciphertext and Backblaze holds the key. That is one custodian for both halves, so AS-2.5's separation requirement is not met — the same standard the codebase applies correctly to workspace_ai_keys, where supabase/functions/_shared/aiKeyCrypto.ts:9-14 explicitly reasons that the pg_dump goes off-platform and therefore the key must not travel with it. The AI keys are protected against this archive; nothing else is. Because the dump excludes nothing, it carries every tenant's O.T.T.E.R. course content, notes, projects, edit_history and the auth schema off-platform nightly. Compounding it, the encryption is a console toggle no code asserts: if the bucket default is ever switched off, the job still exits 0 and the '90-day lifecycle' retention window keeps 90 nights of cleartext dumps. Adding a `gpg --symmetric` or `age` step before upload — with the passphrase in a GitHub secret the storage provider never sees — makes the key custodian distinct from the data custodian and is a few lines in a file that already handles secrets correctly.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-ENC-KEYS
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-ENC-011 — No re-wrap path for the AI-key DEK; rotating WILSON_AI_KEY_SECRET silently downgrades every tenant to the platform key

```yaml
id: TPN-ENC-011
severity: MEDIUM
control: AS-2.5
domain: encryption
title: No re-wrap path for the AI-key DEK; rotating WILSON_AI_KEY_SECRET silently downgrades every tenant to the platform key
location: supabase/functions/_shared/aiKeyCrypto.ts:62-78
evidence: |
  importKey() reads exactly one secret — `const raw = Deno.env.get(SECRET_ENV) ?? ''` at :63 — and there is no previous-key slot, no key-id lookup and no re-encrypt routine anywhere in the module (its full export surface is aiKeyCryptoConfigured, encryptAiKey, decryptAiKey, keyHint). The versioning hook exists but is inert: migration 0028_operator_console.sql:147 defines `key_version SMALLINT NOT NULL DEFAULT 1`, supabase/functions/ai-proxy/index.ts:69 selects it (`.select('key_ciphertext, key_version')`), and nothing ever reads the returned value; supabase/functions/operator-ai-keys/index.ts:162 hardcodes `key_version: 1` on every write. decryptAiKey (aiKeyCrypto.ts:101-109) takes only the envelope and never branches on version.
required: |
  AS-2.5: centralized key management with a defined rotation cadence, and a rotation procedure that is operationally safe — a key roll must not destroy access to data encrypted under the prior key, and any degradation must be visible.
gap: |
  Rotating WILSON_AI_KEY_SECRET makes every stored envelope permanently unopenable, because no code path can reach the old key. The failure is then swallowed: ai-proxy/index.ts:76 wraps the whole resolution in `catch { /* fall through to platform key */ }`, so decryption failure is indistinguishable from 'no tenant key configured' and every workspace silently begins billing the PLATFORM key. Nothing surfaces it — the operator console still reports the tenant as configured, because has_ai_key and ai_key_hint are computed from row existence, not from a successful decrypt (0028_operator_console.sql:270-272), and the WIL-6001 telemetry that would record key_source='platform' (ai-proxy/index.ts:118) lands in workspace-scoped app_events, which the platform console does not read. The fail-soft is itself deliberate and well-reasoned for the intended case (ai-proxy/index.ts:61-66: an operator rotating a secret must not take a company offline) — the defect is that it was designed as a graceful degradation with no accompanying signal and no way to complete the rotation. Fix: accept a comma-separated or versioned secret list keyed on key_version, add a re-wrap pass, and distinguish decrypt-failure from no-row so the console can flag it.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-ENC-KEYS
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-AUTH-001 — Hardcoded admin backdoor password

```yaml
id: TPN-AUTH-001
severity: RESOLVED
resolved_date: 2026-07-30
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

**Re-audit 2026-07-30 — RESOLVED.**

Current location: `C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON/electron/main.cjs:612 (tombstone comment where the module was)`

The hardcoded override is gone, verified three independent ways. (1) `rg -n "DILLYDALLY|MUTINY"` across the repo returns hits ONLY in docs/sessions/SESSION_02_TO_03_CHECKLIST.md:366,367,409 — historical prose in a test checklist, no code, no string comparison. Zero hits in electron/, src/, supabase/. (2) electron/main.cjs:612-637 is now a comment block explicitly recording the deletion of /api/auth/session, /api/auth/verify, /api/auth/change and both constants; `rg -n "api/auth"` finds no route registration anywhere in electron/main.cjs. (3) The renderer consumer src/components/PasswordScreen.jsx does not exist (ls → No such file), so the fail-open fallback the baseline flagged at PasswordScreen.jsx:20 is gone with it. Residual on-disk credentials are cleaned: cleanupLegacyAuthFile() is defined at electron/main.cjs:2176-2181 and CALLED at electron/main.cjs:2475, unlinking {userData}/otter-data/wilson-auth.json at boot. Authentication is now entirely Supabase Auth (ES256, username-first via resolve-login). No universal override credential exists on any path.

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

**Re-audit 2026-07-30 — PARTIALLY REMEDIATED.**

Current location: `C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON/supabase/functions/provision-workspace/index.ts:193 and C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON/src/cloud/auth/ResetPasswordWizard.jsx:96`

Severity revised to **HIGH**.

The specific defects the baseline named are gone with the module: no 1-char minimum, no 12-char cap, no /^[a-zA-Z0-9]+$/ restriction, no toUpperCase() case-folding. The LEARNINGS.md risk-acceptance on the 12-char cap (driven by PasswordScreen's MAX_INPUT_LENGTH) is moot — the code carrying it was deleted. But the CONTROL (TS-1.6 password policy) is still not met by the replacement. Evidence: (a) the only server-side length check in the entire codebase is provision-workspace/index.ts:193 — `if (password.length < 10 || password.length > 128)` — a 10-char floor, below the 12-char minimum required by every one of MPA's three paths, and it guards the self-serve path that mints a company's FIRST ADMIN. (b) The self-service change path is client-side only: ResetPasswordWizard.jsx:96 checks `password.length < 10` in the browser, then calls `supabase.auth.updateUser({ password })` at ResetPasswordWizard.jsx:107, which goes straight to GoTrue — a direct API call bypasses the check entirely. (c) supabase/config.toml's [auth] block (lines 23-30) sets jwt_expiry and enable_signup but contains no `minimum_password_length` and no `password_requirements` key (grep -i password over config.toml returns only template subjects and a function name), so GoTrue's default 6-char floor is the real enforced minimum. (d) No dictionary/breach check, no complexity requirement, no password history, no max age, and no failed-attempt lockout anywhere (`rg -ni "lockout|failed_attempt|locked_out"` over src/ and supabase/ returns only admin-set-active's GoTrue ban_duration at supabase/functions/admin-set-active/index.ts:98, which is deactivation tooling, not a brute-force lockout). Admin-issued credentials ARE strong — generatePassword() in _shared/adminGuard.ts:157-171 emits 20 chars from a 56-char rejection-sampled charset via crypto.getRandomValues — but user-chosen passwords are unconstrained below 10 (or 6).

---

## TPN-AUTH-003 — No MFA on any path (app, admin, content download)

```yaml
id: TPN-AUTH-003
severity: HIGH
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

**Re-audit 2026-07-30 — PARTIALLY REMEDIATED.**

Current location: `C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON/supabase/functions/_shared/adminGuard.ts:148 and C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON/src/cloud/auth/MfaSection.jsx:232`

Severity revised to **HIGH**.

Down from CRITICAL — a real TOTP MFA stack now exists end to end, and the S15 fail-open fix is confirmed. Enrollment: MfaSection.jsx:61 (mfa.enroll), :94-96 (challenge+verify). Sign-in challenge for enrolled users: LoginScreen.jsx:172-186 forces stage='mfa' when getAuthenticatorAssuranceLevel() reports nextLevel aal2. Admin step-up: _shared/adminGuard.ts:136-138 returns 403 mfa_required when an enrolled admin presents an aal1 token, and the S15 fail-CLOSED fix is present and correct at adminGuard.ts:123-135 — `if (factorErr) throw factorErr` inside the try, catch returning 503 mfa_check_failed, which closes the supabase-js `error`-channel hole. Platform tier: _shared/operatorGuard.ts:107-112 hard-requires BOTH a verified factor and aal2, and OperatorLogin.jsx:83-88 signs the user out client-side rather than handing back an aal1 operator session. WHAT IS STILL OPEN: admin MFA ENROLLMENT is optional. adminGuard.ts:148 gates the stronger check behind `Deno.env.get('WILSON_REQUIRE_ADMIN_MFA') === '1'`, which is off by default and set NOWHERE in the repo (only references are adminGuard.ts itself, docs/MASTER_PLAN.md and docs/sessions/SESSION_16_prompt.md — no .env, no CI, no deploy script). The only pressure to enrol is a client-side modal: src/App.jsx:296-310 sets pendingMfaEnroll for admin-tier users, rendered at src/App.jsx:1509-1513 — and MfaSection.jsx:232-242 gives it a 'Set up later' button wired to onDefer, which App.jsx:1512 handles by simply dismissing the gate. An admin can defer forever, and can self-unenroll at MfaSection.jsx:293; once hasVerified goes false, adminGuard.ts:136 stops demanding aal2 at all, so the admin tier silently degrades to password-only. Members have no MFA requirement by design (_shared/memberGuard.ts:12-14), and members hold read/write on all workspace content.

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

**Re-audit 2026-07-30 — PARTIALLY REMEDIATED.**

Current location: `C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON/supabase/config.toml:27 and C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON/src/cloud/auth/sessionStorage.js:60`

Severity revised to **HIGH**.

The last_auth_at pseudo-session is gone with the module (electron/main.cjs:612-637). Real session management now exists: Supabase mints cryptographically random ES256 JWTs, access-token lifetime is 3600s (supabase/config.toml:27 jwt_expiry), the SDK rotates refresh tokens (src/cloud/auth/supabaseClient.js:39-46, autoRefreshToken:true, persistSession:false) and re-persists on TOKEN_REFRESHED (supabaseClient.js:51-55). Electron stores the session encrypted through the safeStorage/OS-keychain preload bridge (sessionStorage.js:55-57). Surface isolation between /wilson and /wilsonadmin is build-time and correct (sessionStorage.js:39-51, supabaseClient.js:44). STILL OPEN against AS-3.8: (1) NO idle timeout of any kind — `rg -ni "idle|inactivit|auto.?logout|sessionTimeout"` over src/ and electron/ returns only UI animation states (App.jsx:206, AuthShell.jsx:42, RelinkDialog.jsx:47 etc.); nothing tracks user inactivity, so the required 30-minute idle expiry does not exist. (2) NO absolute session cap — refresh rotation is unbounded, so there is no forced re-auth at 4 hours; config.toml sets no session time-box and Supabase's inactivity/time-box settings are not asserted anywhere in repo config. (3) NO concurrent-session control — `rg -ni "concurrent.session|single.session"` returns zero hits; nothing calls auth.admin.signOut() anywhere in supabase/functions/. (4) NO failed-attempt lockout (see TPN-AUTH-002 rationale (d)). (5) On the S12 web build (beta.petalstudios.co/wilson) the rotating refresh token is written to localStorage in cleartext — sessionStorage.js:60 `localStorage.setItem(STORAGE_KEY, JSON.stringify(session))`, read back at :69 — not an httpOnly, Secure, non-persistent cookie. The code comment at sessionStorage.js:6-11 argues this is unavoidable on a static host and that 'the token is a short-lived JWT + rotating refresh token, not a credential'; that is a reasonable engineering call but it is not a TPN-satisfying one, and it is NOT one of the risk-acceptances recorded in LEARNINGS.md, so it stays open.

---

## TPN-AUTH-005 — No RBAC; every authenticated user has full privilege

```yaml
id: TPN-AUTH-005
severity: RESOLVED
resolved_date: 2026-07-30
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

**Re-audit 2026-07-30 — RESOLVED.**

Current location: `C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON/src/permissions/roleMatrix.js:51 and C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON/supabase/migrations/0002_rls_workspaces.sql:11`

The baseline finding as written — 'WILSON has no user identity at all... no concept of a viewer, editor, or admin' — is comprehensively false against current code. Remediation was by a DIFFERENT mechanism than REMEDIATION_PLAN.md's local requireRole() middleware, so verifying the CONTROL rather than the artifact: (1) Unique per-workspace identity exists (workspace_members.username, resolved pre-auth by supabase/functions/resolve-login/index.ts). (2) A three-tier app role model admin/manager/user is minted into the JWT by custom_access_token_hook (supabase/migrations/0003_fix_access_token_hook.sql:45-52) and expressed as an explicit capability matrix at src/permissions/roleMatrix.js:33-79, with a second project-scoped matrix at src/permissions/projectRoleMatrix.js:63-88 kept in lockstep with the DB helpers; both are unit-pinned (roleMatrix.test.js, projectRoleMatrix.test.js). (3) The REAL gate is Postgres RLS with ENABLE + FORCE ROW LEVEL SECURITY on every table (0002, 0004, 0013, 0017, 0021, 0022, 0028) and pgTAP suites 01-36. (4) Least privilege is enforced downward: the highest-value tables have ZERO client policies and are service-role only — workspace_ai_keys (0028:157-159, with a migration post-condition at 0028:401-413 that RAISEs if any client policy ever appears) and edge_rate_limits (0028:301-303). (5) Self-escalation is blocked by a BEFORE UPDATE trigger (0020:67-100, trg at 0020:362-364) plus last-admin protection. (6) A fourth, higher tier exists (platform_operators) with no grant/revoke endpoint at all — operator status is SQL-only, so the platform tier cannot be escalated from any web session. The baseline gap is closed. The REVOCATION half of TS-1.7 ('immediate revocation') is not met, but that is a distinct defect in code that did not exist at baseline — filed as TPN-AUTH-006 rather than kept open here.

---

## TPN-AUTH-006 — RLS authorises writes on the JWT app_role claim, so a demoted admin keeps admin privilege for the token TTL and can permanently re-promote themselves

```yaml
id: TPN-AUTH-006
severity: HIGH
control: TS-1.7
domain: authentication
title: RLS authorises writes on the JWT app_role claim, so a demoted admin keeps admin privilege for the token TTL and can permanently re-promote themselves
location: supabase/migrations/0020_admin_grants_and_alignment.sql:283
evidence: |
  ws_members_admin_write (0020:279-290):
    USING (
      workspace_id = public.current_workspace_id()
      AND public.current_app_role() = 'admin'
      AND public.has_active_membership(workspace_id)
    )
  current_app_role() reads ONLY the token (0008_fix_rls_recursion.sql:32-42):
    SELECT NULLIF(current_setting('request.jwt.claims', true)::JSONB #>> '{app_metadata,app_role}', '');
  has_active_membership() checks is_active and NEVER app_role (0008:48-61):
    SELECT EXISTS (SELECT 1 FROM public.workspace_members wm
      WHERE wm.user_id = auth.uid() AND wm.workspace_id = ws AND wm.is_active);
  The self-escalation guard bypasses on the same claim (0020:74):
    IF public.current_app_role() = 'admin' AND NEW.workspace_id = public.current_workspace_id() THEN RETURN NEW;
  The client writes straight to PostgREST, no Edge Function in the path (src/components/TeamMembers/useWorkspaceMembers.js:111-116):
    await supabase.from('workspace_members').update(patch).eq('workspace_id', workspaceId).eq('user_id', userId)
    // setRole() at :134 passes patch = { app_role }
required: |
  TS-1.7: RBAC/ABAC with least privilege and IMMEDIATE revocation of access on role change or termination. A privilege decision must be made against authoritative state, not against a bearer assertion the subject already holds.
gap: |
  Every Edge Function tier does a live-row role check — _shared/adminGuard.ts:99-107, _shared/operatorGuard.ts:77-89, invite-member/index.ts:100-108 — but the direct PostgREST/RLS path, which is how the Team Members UI actually writes, does not. has_active_membership() closes the DEACTIVATION lag only; the DEMOTION lag is wide open for up to jwt_expiry = 3600s (supabase/config.toml:27). Worse than a lag: it is self-healing for the attacker. Nothing in the codebase revokes sessions on role change — `rg -n "signOut|invalidate|revoke" supabase/functions/` finds no auth.admin.signOut() call anywhere — so the window is never cut short.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-AUTH-RBAC
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-AUTH-007 — Operator workspace suspension does not revoke content access for any already-issued session — only the workspaces row disappears

```yaml
id: TPN-AUTH-007
severity: HIGH
control: TS-1.7
domain: authentication
title: Operator workspace suspension does not revoke content access for any already-issued session — only the workspaces row disappears
location: supabase/migrations/0004_rls_rabbit.sql:251
evidence: |
  Suspend = soft-delete of the parent row only (supabase/functions/operator-workspaces/index.ts:330-334):
    .update({ deleted_at: suspending ? new Date().toISOString() : null, deleted_by: ... })
  The function's own comment claims this revokes member visibility (operator-workspaces/index.ts:321-323):
    // Soft delete. workspaces_select filters `deleted_at IS NULL`, so a
    // suspended company vanishes for its own members while staying fully intact
  That is true of the PARENT policy (0002_rls_workspaces.sql:15-25 does filter deleted_at) but of no CHILD policy. projects_select (0004_rls_rabbit.sql:251-255):
    FOR SELECT USING (deleted_at IS NULL AND workspace_id = public.current_workspace_id());
    -- projects.deleted_at, not workspaces.deleted_at; no join to workspaces at all
  And the token hook keeps re-minting the claim on every refresh (0003_fix_access_token_hook.sql:31-36):
    SELECT ... INTO ws_ids FROM public.workspace_members wm
     WHERE wm.user_id = uid AND wm.is_active;   -- never joins public.workspaces
required: |
  TS-1.7 / AS-2.1: access must be revocable, and revocation must take effect on the content itself, not only on a directory listing. An operator-initiated suspension is a containment control (non-payment, contract termination, incident response) and must actually stop access to pre-release content.
gap: |
  Suspending a workspace hides one row (the company name) and leaves every content table reachable. current_workspace_id() (0001_workspaces_and_users.sql:230-240) reads the JWT claim; the hook re-issues that claim indefinitely because it filters on workspace_members.is_active and never joins workspaces; and no child-table policy — projects, assets, notes, otter content, rate cards, files — tests the parent's deleted_at. A member with an open tab or a stored refresh token retains full read/write on all workspace content after suspension, indefinitely. _shared/memberGuard.ts (memberGuard.ts:60-68) has the same shape, so a suspended tenant also keeps calling ai-proxy and spending on the platform Anthropic key. The gap is not visible from the operator console, which reports the suspension as successful.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-AUTH-RBAC
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-AUTH-009 — The company step of sign-in is a company-existence oracle (accepted, rate-limited)

```yaml
id: TPN-AUTH-009
severity: LOW
control: AS-3.8
domain: auth
title: The company step of sign-in is a company-existence oracle (accepted, rate-limited)
location: supabase/functions/resolve-login/index.ts (the company branch); src/cloud/auth/LoginScreen.jsx handleCompanySubmit
evidence: |
  // resolve-login/index.ts — the company branch answers, in constant time,
  //   { exists: boolean, slug: string | null, v: 2 }
  // to any caller holding the anon key, which the web app ships.
required: |
  AS-3.8: a pre-authentication endpoint discloses no more than the workflow needs, and what it does disclose is rate-limited and logged.
gap: |
  Recording an ACCEPTED disclosure, not a defect owed a fix.

  Audrey's ruling (2026-08-10, reaffirmed 2026-09-04 as fix-plan answer 34): "the system should confirm the company listed first exists and is real, after it makes sure the company exists THEN it should pull from that companies list." The alternative — a company step that verifies nothing — shipped for one S43 commit and signed people into the wrong company; she chose the oracle with the trade-off on the table.

  What it discloses: whether a typed name (display name or slug) is an existing, non-suspended workspace — at most 20 answers per minute per client address (`resolve-login:company`, durable, fail-closed, keyed on `cf-connecting-ip`), each answered in ~180 ms regardless of outcome, each logged to auth_attempt_log with that address.

  What it does NOT disclose: status (a suspended, soft-deleted workspace answers exactly like a name that never existed — one wording on screen, `COMPANY NOT FOUND.`), members, counts, the display name behind a slug or the slug behind a name beyond the one the caller typed, or anything about a person. The username path's defence — one generic wording, a fake-email sign-in so an unknown username costs the same as a known one, constant time — is untouched, and tests/e2e/auth.spec.ts scenario 4 pins the wording.

  Residual: an actor with many addresses can enumerate customer names faster than 20 per minute. Accepted. Revisit if the customer list ever becomes commercially sensitive; the step could then accept only the slug (an identifier the company hands out) and stop matching display names, at the cost of every user having to know it.
effort: none
blocks_tier: none
recommendation_ref: RECO-NET-SEG
opened: 2026-09-06
```

**Opened by Track B bundle B1 (2026-09-06)** to record a product decision, as the B1 brief required: "record the residual risk … in the TPN pack as an accepted, rate-limited disclosure." (`TPN-AUTH-008` was merged into TPN-NET-005 during the 2026-07-30 re-audit, hence the gap in numbering.)

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

**Re-audit 2026-07-30 — STILL OPEN.**

Current location: `electron/main.cjs:143`

Severity revised to **HIGH**.

Unchanged. `expressApp.use(cors());` is still the first middleware on the embedded Express server (electron/main.cjs:143) — bare cors() = `Access-Control-Allow-Origin: *`, preflight granted for every origin. LEARNINGS.md re-audit checklist item 6 (`rg -n "expressApp\.use\(cors\(\)\)" should return zero`) FAILS. The remediation prescribed by RECO-NET-SEG (parameterized origin) was never applied by any mechanism — I checked for equivalents and found none: no Origin/Referer check, no shared-secret header, no auth middleware anywhere in the 2497-line file (grep for `req.headers`/`authorization` returns only Google Drive token IPC and body fields, not a guard).

What DID change, and why it does not resolve the finding: (a) the server binds loopback + an EPHEMERAL port (`expressApp.listen(0, '127.0.0.1')`, main.cjs:2079), so it is not LAN-reachable and the port is not fixed; (b) the auth routes the baseline named as the CORS payload (/api/auth/session|verify|change) were deleted in S15 (main.cjs:612-637 is the tombstone comment). Both narrow the blast radius; neither restores default-deny.

Residual exposure is still HIGH because ~80 unauthenticated routes remain and several are content-bearing or destructive: file download `/api/rabbit/projects/:projectId/files/:id/download` (main.cjs:1341), file delete (:1368), project delete (:1078), managed-file import-folder (:1806), relink-apply (:1500), full `/api/export-all` (:553). Because ACAO is `*`, a page the user visits can READ every response, which makes port discovery a straightforward loop over the ephemeral range rather than a blind write — the wildcard is what turns the random port from a secret into a speed bump. The S14 authors themselves rely on this being true: main.cjs:929 reasons about relink safety with the words "the Express server answers any local origin (cors())".

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

**Re-audit 2026-07-30 — STILL OPEN.**

Current location: `electron/main.cjs:640 (/api/fetch-url), electron/main.cjs:677 (/api/fetch-raw)`

Severity revised to **HIGH**.

Unchanged, and slightly worse than the baseline described. Both handlers still take `const { url } = req.body` and pass it straight to `fetch()` with no scheme check, no host allow-list, and no RFC-1918 / 127.0.0.0/8 / 169.254.169.254 / ::1 blocking. Baseline line 630 re-resolved to 640; the second endpoint re-resolved from 667 to 677. Bodies are still returned to the caller in full (`res.json({ title, text, url })` at :666; `res.json({ body, contentType, finalUrl, status })` at :701), so these are complete READ-SSRF primitives, not blind ones.

Two aggravators visible in the current code that the baseline did not record: (1) `/api/fetch-raw` accepts a client-controlled `redirect` mode (`const { url, redirect = 'follow' } = req.body`, :678) which it forwards to fetch, so even a future host allow-list applied to the initial URL would be bypassable by a 302 unless it is re-checked on `response.url`; (2) the advertised 5 MB cap is enforced AFTER the whole body is buffered (`const buf = await response.arrayBuffer()` at :696, size check at :697), so it bounds the response to the renderer but not main-process memory.

Callers confirmed live: src/tools/otter_v0.3.1/Otter.jsx:880 (/api/fetch-url) and src/components/RateCard/importers/googleSheetImporter.js:91 (/api/fetch-raw). Combined with TPN-NET-001 still open, the baseline's stated chain — hostile web page -> WILSON -> user's private network -> data back to the page — is intact end to end.

---

## TPN-NET-003 — No rate limiting on any endpoint (including /api/auth/verify)

```yaml
id: TPN-NET-003
severity: MEDIUM
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

**Re-audit 2026-07-30 — PARTIALLY REMEDIATED.**

Current location: `Original endpoint deleted (tombstone at electron/main.cjs:612-637). Residual: electron/main.cjs:140-144 (no limiter on the local server); supabase/functions/admin-reset-password/index.ts:17-25, admin-create-user, admin-set-active, admin-user-security, invite-member, issue-session, storage-gc/index.ts:127-132 (no limiter at all); supabase/functions/resolve-login/index.ts:29-38 and provision-workspace/index.ts:39-47 (non-durable limiter).`

Severity revised to **MEDIUM**.

Genuinely half-closed; the half that closed is the half the title named.

RESOLVED portion: `/api/auth/verify` no longer exists. electron/main.cjs:612-637 is an explicit tombstone for the deleted /api/auth/session|verify|change block, and it names "the /api/auth/verify half of TPN-NET-003" as closed. src/components/PasswordScreen.jsx is gone (no file references it). The unlimited-password-attempt vector is therefore genuinely eliminated, not relocated — I searched for a replacement local credential check and there is none.

OPEN portion — "no rate limit elsewhere" is still substantially true, remediated only on 3 of 12 Edge Functions and 0 of ~80 local routes:
  * DONE: the durable limiter (public.fn_rate_limit_hit, supabase/migrations/0028_operator_console.sql:305-344, atomic upsert under a row lock, service_role-only EXECUTE at :346-348, nightly purge at :355-388) is wired into ai-proxy/index.ts:190 (60/min per workspace), operator-workspaces/index.ts:173-179 (120 read / 20 write per min per operator) and operator-ai-keys/index.ts:92-95. This is a real, well-built control and it closes the AI-spend abuse case.
  * NOT DONE: the local Express server has no limiter of any kind on any route — no express-rate-limit, no slow-down, no counter (confirmed by grep across electron/ and package.json deps).
  * NOT DONE: admin-create-user, admin-reset-password, admin-set-active, admin-user-security, invite-member, issue-session and storage-gc call their guard and proceed with zero throttling. admin-reset-password is a privileged destructive endpoint (rotates any member's password) with `verify_jwt = false` at the gateway (supabase/config.toml), so every request costs a service-role auth.getUser + DB reads with no ceiling.
  * PARTLY DONE: resolve-login and provision-workspace kept the pre-S15 per-isolate in-memory buckets — see new findings TPN-NET-004 / TPN-NET-005.
  * Also absent: any AS-3.8 account lockout. supabase/config.toml has no [auth.rate_limit] block, so the actual credential-guessing surface (GoTrue's password grant) runs on Supabase platform defaults only, with no 5-10 failed-attempt lockout.

Downgraded HIGH -> MEDIUM: the named brute-force target is gone and the money-losing endpoint is durably throttled; what remains is breadth, not a sharp exploit.

---

## TPN-NET-004 — resolve-login's per-IP throttle is bypassable — first X-Forwarded-For entry is attacker-supplied

```yaml
id: TPN-NET-004
severity: HIGH
control: AS-3.8
domain: network
title: resolve-login's per-IP throttle is bypassable — first X-Forwarded-For entry is attacker-supplied
location: supabase/functions/resolve-login/index.ts:42
evidence: |
  // resolve-login/index.ts:40-46
  function clientIp(req: Request): string {
    return (
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
      req.headers.get('x-real-ip') ??
      'unknown'
    )
  }
  // ...and the sibling function, which was FIXED for exactly this:
  // provision-workspace/index.ts:50-59
  function clientIp(req: Request): string {
    // Trust the LAST x-forwarded-for entry: the platform proxy APPENDS the
    // real peer, while the first entry is client-supplied and trivially
    // spoofable (Session 9 review finding).
    const xff = req.headers.get('x-forwarded-for')
    if (xff) {
      const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
      if (parts.length > 0) return parts[parts.length - 1]
    }
    return req.headers.get('x-real-ip') ?? 'unknown'
  }
required: |
  AS-3.8: rate limiting on all public-facing endpoints, with a failed-attempt threshold. A throttle keyed on client-controllable input is not a throttle. TS-2: default-deny at the network boundary — pre-auth endpoints are the boundary.
gap: |
  resolve-login is the pre-authentication username -> email oracle (`verify_jwt = false` in supabase/config.toml) and is publicly reachable on all three hosted envs. Its ONLY abuse control is the 5-req/minute per-IP bucket at resolve-login/index.ts:25-38, keyed on `clientIp()`.
  
  That key is the FIRST comma-separated X-Forwarded-For entry, which a caller sets simply by sending the header — the platform proxy appends the real peer rather than replacing the list, so the attacker's value stays in front. Sending a fresh random value per request gives every request its own bucket and the limit never fires. The project already knows this: provision-workspace/index.ts:51-53 carries a Session 9 review comment saying the first entry is "trivially spoofable" and takes the last entry instead. The fix was applied to one of the two call sites and never back-ported to the other.
  
  Consequence: unbounded enumeration of valid usernames and workspace slugs across every tenant. The ~180 ms constant-time floor (:21, :48-51) and the uniform response body defeat timing/shape oracles but do nothing about volume, and the auth_attempt_log rows written at :94-102 record the spoofed IP, so the audit trail attributes the campaign to whatever address the attacker typed. Independently, the bucket is also per-isolate (see TPN-NET-005) — two separate bypasses stacked on the same control.
effort: XS
blocks_tier: Gold
recommendation_ref: RECO-NET-SEG
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

**✅ FIXED, and this finding's own remedy corrected — Track B bundle B1 (2026-09-06).** Measured with a throwaway header-echo function on wilson-dev (deployed, called, deleted within the minute): a request to `<ref>.supabase.co` reaches the function with `x-forwarded-for` = `<client via Cloudflare>, <client via the AWS balancer>, <13.248.0.0/14 relay>`. A caller-supplied `x-forwarded-for` or `x-real-ip` is **stripped** before the function sees it, and a caller-supplied `cf-connecting-ip` is refused by Cloudflare with a 403. So on today's platform the first hop was not attacker-supplied after all — but the remedy prescribed above, "take the last hop as `provision-workspace` did", is **wrong**: the last hop is Supabase's own relay and varies per request. Deployed that way for eleven minutes (wilson-dev v7), 22 company checks from one machine spread across ten limiter rows of 1–4 hits and nothing was refused; at scale a relay's pooled counter would refuse every customer behind it at once. `clientIp()` now takes `cf-connecting-ip`, falling back to the hop *before* the relay. Wilson-dev v8: the 21st consecutive company check in a minute answers 429 and the credentials bucket stays open; `auth_attempt_log` records that address. **Do not copy the `provision-workspace` recipe quoted in the evidence anywhere.**

---

## TPN-NET-005 — Both pre-auth Edge Functions still use the per-isolate in-memory limiter S15 replaced everywhere else

```yaml
id: TPN-NET-005
severity: MEDIUM
control: AS-3.8
domain: network
title: Both pre-auth Edge Functions still use the per-isolate in-memory limiter S15 replaced everywhere else
location: supabase/functions/provision-workspace/index.ts:35-47
evidence: |
  // provision-workspace/index.ts:34-47 — verbatim
  const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1_000
  const RATE_LIMIT_MAX = 3
  const rateBuckets = new Map<string, { count: number; resetAt: number }>()
  
  // resolve-login/index.ts:23-27
  // Per-IP rate limit bucket. In-memory; resets on function cold start which is
  // acceptable for v1. Swap to durable KV in Session 3.
  const RATE_LIMIT_WINDOW_MS = 60_000
  const RATE_LIMIT_MAX = 5
  const rateBuckets = new Map<string, { count: number; resetAt: number }>()
  
  // _shared/rateLimit.ts:6-11 — the S15 diagnosis, applied only to ai-proxy/operator-*
  // "`const windows = new Map()` inside an Edge Function counts requests for ONE
  //  Deno isolate. The platform runs as many isolates as it likes and recycles
  //  them on cold starts, so a \"60 per minute\" limit was really \"60 per minute
  //  per isolate, resetting at unpredictable intervals\" — an unknowable number"
required: |
  AS-3.8: rate limiting on all public-facing endpoints. The stated limit must be the enforced limit.
gap: |
  S15 built the durable limiter (public.fn_rate_limit_hit, migration 0028:305) precisely because per-isolate Maps do not count, then wired it into only the three authenticated functions (ai-proxy:190, operator-workspaces:173, operator-ai-keys:92). The two functions that run BEFORE authentication — where an abuse control matters most, since no guard has run yet — were left on the old mechanism.
  
  Actual enforced limits: provision-workspace's "3 per hour" (:36) becomes 3 per hour per warm isolate, resetting on every cold start, on an endpoint that creates a durable tenant plus an auth.users row (:258-265) and calls the atomic provisioning RPC. That is unbounded workspace/identity spam bounded only by Supabase's isolate churn. resolve-login's "5 per minute" (:26) degrades the same way, on top of the key-spoofing bypass in TPN-NET-004.
  
  Both files still carry stale TODO comments promising a Session 3 fix (resolve-login:9, :24; provision-workspace:35) — Session 15 shipped the replacement and did not land it here.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-NET-SEG
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

Merged into this finding during the re-audit (same defect, reported from another domain pass): `TPN-AUTH-008`.

**✅ FIXED for `resolve-login` — Track B bundle B1 (2026-09-06).** The per-isolate Map and its "Session 3" TODOs are gone; the function calls `isRateLimited()` (`fn_rate_limit_hit`, migration 0028) with `{ failOpen: false }` in two buckets — `resolve-login:company` (20/min per client address, `RESOLVE_LOGIN_COMPANY_RPM`) and `resolve-login:user` (30/min, `RESOLVE_LOGIN_USER_RPM`) — keyed as TPN-NET-004's annotation describes. Measured on wilson-dev v8: the 21st company check inside a minute answers 429 with the same body shape (the client says `TOO MANY ATTEMPTS. WAIT A MINUTE AND TRY AGAIN.`); the user bucket is untouched by a company burst. The other half of this finding, `provision-workspace`, left the source tree in S43 and closes when the per-environment `functions delete` in `OUTSTANDING.md` runs.

---

## TPN-NET-006 — No Content-Security-Policy on either host; the /wilson product surface gets no security headers at all

```yaml
id: TPN-NET-006
severity: MEDIUM
control: TS-2
domain: network
title: No Content-Security-Policy on either host; the /wilson product surface gets no security headers at all
location: vercel.json:14-23
evidence: |
  // vercel.json:14-24 — the ONLY headers block; source matches /wilsonadmin only
  "headers": [
    {
      "source": "/wilsonadmin/:path*",
      "headers": [
        { "key": "X-Robots-Tag", "value": "noindex, nofollow" },
        { "key": "Referrer-Policy", "value": "no-referrer" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" }
      ]
    }
  ]
  
  // index.html:3-8 — no CSP meta on the product entry point
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="/logo.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WILSON</title>
  </head>
  
  // repo-wide grep for Content-Security-Policy across *.html *.js *.jsx *.cjs *.ts *.json
  // (excluding node_modules) returns ZERO hits — no meta tag, no vercel header,
  // no session.defaultSession.webRequest.onHeadersReceived in electron/main.cjs.
required: |
  TS-2: defence in depth at the application network boundary. Content-handling web surfaces must constrain script sources and egress destinations, and must not be framable by third parties.
gap: |
  Two distinct gaps, one root cause (headers were added for the operator console and nowhere else):
  
  1. No CSP anywhere. Neither host constrains `script-src`, `connect-src` or `frame-ancestors`. In the Electron renderer this means any injected script — e.g. via the un-sanitised HTML that /api/fetch-url scrapes and feeds into O.T.T.E.R. (main.cjs:652-663, Otter.jsx:880) — has unrestricted egress to any origin, and the loopback API sits on the same origin with no auth. On the web host it means the same for anything reflected into the React tree. CSP is the control that turns an XSS into a contained failure rather than a full content-exfiltration channel.
  
  2. The `/wilson/:path*` product surface receives NO headers. `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy` are scoped to `/wilsonadmin/:path*` only, so beta.petalstudios.co/wilson is framable by any site (clickjacking against an authenticated WILSON session) and leaks full referrers off-site. The main app handles the studio content; the console does not.
  
  Note also that vercel.json declares `/wilsonadmin` and `/wilsonadmin/:path*` as SEPARATE rewrites (:11-12) but only the latter form in the headers block — if that asymmetry reflects the author's belief that the bare path does not match `:path*`, the console's own headers are missing on its canonical entry URL. Worth confirming against a deployed response rather than assuming either way.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-SDLC-HARDEN
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-NET-007 — Auto-update feed URL is read unvalidated from a user-writable env.json and overrides the HTTPS default

```yaml
id: TPN-NET-007
severity: MEDIUM
control: TS-2
domain: network
title: Auto-update feed URL is read unvalidated from a user-writable env.json and overrides the HTTPS default
location: electron/updater.cjs:41
evidence: |
  // electron/updater.cjs:41 and :61-69
  const feedUrl = process.env.WILSON_UPDATE_URL || null;
  ...
  if (feedUrl) {
    try {
      autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
    } catch (err) { ... }
  }
  
  // electron/env.cjs:40-48 — where that value comes from in packaged builds
  function loadPackaged(userDataDir) {
    const file = path.join(userDataDir, 'env.json');
    if (!fs.existsSync(file)) return {};
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      return {};
    }
  }
  
  // package.json:101-106 — the baked-in default this silently overrides
  "publish": [ { "provider": "generic", "url": "https://updates.petalstudios.co/wilson" } ]
required: |
  TS-2: no egress from a content-processing system to an unvetted destination. Software update channels must be integrity-protected and pinned to an authenticated transport; the update path is the highest-value ingress on an artist workstation.
gap: |
  `%APPDATA%/WILSON/env.json` is an ordinary user-writable file with no signature, no schema and no permissions hardening (env.cjs:40-48 JSON.parses it and env.cjs:62-64 injects every key into process.env). `WILSON_UPDATE_URL` taken from it is handed to electron-updater's generic provider verbatim at updater.cjs:63 — there is no `https:` scheme check, no host allow-list, and no comparison against the compiled-in `https://updates.petalstudios.co/wilson`.
  
  So any process running as the user, or anything that can write one JSON file (a sync client, a misconfigured backup restore, a phishing 'config fix'), can repoint the updater at `http://attacker/` and have the next accepted update install an arbitrary NSIS payload. Downgrading to plaintext HTTP additionally re-opens on-path tampering, which the packaged HTTPS default rules out. autoDownload is false (updater.cjs:59) so the user must click Update — a prompt that looks completely legitimate, since the version metadata comes from the attacker's feed.
  
  Smallest honest fix is a scheme+host guard at updater.cjs:61 (reject anything that is not https and not on an allow-listed host, fall back to the packaged default). The complementary control — Authenticode signing so electron-updater's publisherName check has something to verify — sits in the SDLC domain; I have not assessed signing here.
effort: XS
blocks_tier: Gold
recommendation_ref: RECO-NET-SEG
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

Merged into this finding during the re-audit (same defect, reported from another domain pass): `TPN-ENC-009`.

---

## TPN-NET-008 — RABBIT budget tabs POST to a fixed loopback port nothing binds, then write a user file to the reply's path

```yaml
id: TPN-NET-008
severity: MEDIUM
control: TS-2
domain: network
title: RABBIT budget tabs POST to a fixed loopback port nothing binds, then write a user file to the reply's path
location: src/tools/rabbit_v0.1.0/views/budget/TalentTab.jsx:17
evidence: |
  // TalentTab.jsx:17 (identical at CrewTeamTab.jsx:17)
  const BASE_URL = 'http://localhost:19854/api/rabbit'
  
  // TalentTab.jsx:92-99 (CrewTeamTab.jsx:80-87 is the same shape)
  const res = await fetch(`${BASE_URL}/projects/${projectId}/invoice-folder`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'talent', memberName: lineName }),
  })
  const { folderPath } = await res.json()
  const srcPath = files[0]
  const fileName = srcPath.split(/[\\/]/).pop()
  await api.copyFile({ sourcePath: srcPath, destDir: folderPath, destFileName: fileName })
  
  // electron/main.cjs:2288-2291 — the sink, with no containment guard
  ipcMain.handle('rabbit:copy-file', async (event, { sourcePath, destDir, destFileName }) => {
    if (!fs.existsSync(sourcePath)) throw new Error('source file does not exist');
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const finalPath = path.join(destDir, destFileName);
  
  // electron/main.cjs:2079 — what WILSON actually binds
  const server = expressApp.listen(0, '127.0.0.1', () => {
required: |
  TS-2: a content-handling client must not take instructions from an unauthenticated network peer, and must not write content to a destination named by one. File-write sinks reached from the renderer need the same path-containment guard applied elsewhere in this file.
gap: |
  NEW EVIDENCE that invalidates the LEARNINGS.md carve-out. LEARNINGS.md:18 tells the re-auditor that `http://localhost:19854/api/rabbit` in these two files "is the loopback to the embedded server" and should be INFO. It is not. `startLocalServer` binds port 0 — an ephemeral port (main.cjs:2079) — and `git log -S 19854 -- electron/main.cjs` returns nothing, so WILSON has never bound 19854. These two call sites point at a port that belongs to whoever claims it first.
  
  In normal operation the fetch simply fails and is swallowed (`catch { console.error('attach invoice failed:', err) }`), which is why nobody noticed. If any local process binds 19854, it becomes the authority on where WILSON writes the user's invoice: the reply's `folderPath` goes straight into `rabbit:copy-file`, whose `destDir` is not run through `resolveContainedFilePath()` (the guard S14 added at main.cjs:920-927 for exactly this class of bug) and is `mkdirSync(..., { recursive: true })`-ed if absent. A returned UNC path such as `\\\\attacker-host\\share` turns a local squat into off-machine exfiltration of a document the user just picked.
  
  Two independent fixes: route these through the same relative `/api/rabbit` origin every other RABBIT call uses (adapters/index.js), and apply a containment guard to `destDir` at main.cjs:2288 so no caller — loopback-fed or not — can steer a copy outside the project's own roots.
effort: S
blocks_tier: none
recommendation_ref: RECO-NET-SEG
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-NET-009 — Every Edge Function serves Access-Control-Allow-Origin: * from five duplicated definitions

```yaml
id: TPN-NET-009
severity: LOW
control: TS-2
domain: network
title: Every Edge Function serves Access-Control-Allow-Origin: * from five duplicated definitions
location: supabase/functions/_shared/adminGuard.ts:30-34
evidence: |
  // _shared/adminGuard.ts:30-34 — re-exported by memberGuard.ts:18 and operatorGuard.ts:43-45
  export const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization, apikey',
  }
  
  // Four byte-identical private copies:
  //   issue-session/index.ts:25-29
  //   resolve-login/index.ts:62-66
  //   provision-workspace/index.ts:27-31
  //   invite-member/index.ts:37-41
required: |
  TS-2: default-deny on network boundaries — an API should name the origins allowed to read its responses rather than allow all.
gap: |
  Scoped LOW deliberately, because the usual CORS consequence does not apply here: these functions authenticate from a bearer `Authorization` header, not an ambient cookie, and `Access-Control-Allow-Origin: *` is incompatible with credentialed mode — so a hostile page cannot ride a logged-in user's session. The exposure that remains is that any origin can invoke and READ the responses of every function including the platform-operator tier (operator-workspaces can tear a company down), gated solely by possession of a token.
  
  The structural problem is the duplication: the value is defined five times, and `_shared/adminGuard.ts` is only three of the eight call paths. Tightening to an allow-list (the two Vercel origins plus a `http://127.0.0.1:<ephemeral>` pattern for the Electron renderer) requires editing five files, and any future hardening that touches only the shared module will silently leave issue-session, resolve-login, provision-workspace and invite-member — the four PRE-AUTH functions — wide open. Consolidating first is most of the fix.
effort: S
blocks_tier: none
recommendation_ref: RECO-NET-SEG
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-NET-010 — Platform operator console is reachable from the public internet with no network-layer restriction

```yaml
id: TPN-NET-010
severity: LOW
control: TS-2
domain: network
title: Platform operator console is reachable from the public internet with no network-layer restriction
location: vercel.json:11-12
evidence: |
  // vercel.json:3, :11-12 — built and served from the public beta host
  "buildCommand": "npm run build:vercel && npm run build:vercel:admin",
  ...
  { "source": "/wilsonadmin", "destination": "/wilsonadmin/admin.html" },
  { "source": "/wilsonadmin/:path*", "destination": "/wilsonadmin/admin.html" }
  
  // The only access control at the edge is discoverability:
  // vercel.json:18  { "key": "X-Robots-Tag", "value": "noindex, nofollow" }
  // admin.html:7    <meta name="robots" content="noindex, nofollow" />
required: |
  TS-2 / TS-1.6: privileged management interfaces should be restricted at the network layer (VPN, bastion, or IP allow-list) in addition to strong authentication, not published on the same public hostname as the product.
gap: |
  `https://beta.petalstudios.co/wilsonadmin` is the highest-privilege surface in the system — operator-workspaces can suspend, restore and tear down any tenant including its rabbit-files blobs — and the only thing separating it from the open internet is a noindex hint, which is a search-engine courtesy, not a control.
  
  Rated LOW rather than higher because the in-function controls are genuinely strong and I verified them: _shared/operatorGuard.ts requires a live `public.platform_operators` row (not just a JWT claim, per its own reasoning at :17-25), enforces MFA as a HARD requirement in both directions including refusing when MFA state cannot be established (:26-34), and there is deliberately no grant-operator endpoint anywhere, so the tier cannot be escalated from a web session at all (:36-39). The console also has build-time session isolation from the product bundle.
  
  So this is a defence-in-depth gap, not an exploitable one — but it is a question a TPN assessor asks directly, and answering it with "MFA and a live row check" rather than "it is not reachable" is a weaker answer than the architecture deserves. A Vercel edge IP allow-list or moving the console to a separate, unlisted hostname closes it.
effort: S
blocks_tier: none
recommendation_ref: RECO-NET-SEG
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-NET-011 — Durable limiter fails open by design — correct today, becomes a defect if reused for a pre-auth path

```yaml
id: TPN-NET-011
severity: INFO
control: AS-3.8
domain: network
title: Durable limiter fails open by design — correct today, becomes a defect if reused for a pre-auth path
location: supabase/functions/_shared/rateLimit.ts:55-68
evidence: |
  // _shared/rateLimit.ts:55-68
  if (error) {
    console.error(`rate-limit RPC failed (${bucket}): ${error.message}`)
    return false
  }
  return data === true
  } catch (err) {
    console.error(`rate-limit RPC threw (${bucket}): ${String(...)}`)
    return false
  }
  
  // The stated rationale, rateLimit.ts:16-24:
  // "this helper fails OPEN if the RPC itself errors, and that is a deliberate,
  //  narrow choice. The limiter is an abuse control, not an authorization
  //  control — authorization already ran in the guard above it."
required: |
  AS-3.8: a failed-attempt threshold must hold when its backing store is unavailable. Abuse controls layered under an authorization decision may fail open; controls that ARE the authorization backstop may not.
gap: |
  Recording a judgement, not a live defect — no fix owed today.
  
  The fail-open is correct as currently deployed. All three consumers sit BEHIND an authorization guard (ai-proxy behind requireActiveMember at ai-proxy/index.ts:186 before the limiter at :190; operator-workspaces and operator-ai-keys behind requirePlatformOperator at :159 / :80 before their limiters at :173 / :92). For those buckets the limiter governs spend and abuse volume, not access, so a Postgres hiccup taking every tenant's AI features offline is the worse failure. The implementation is otherwise sound: the RPC counts atomically under a row lock (migration 0028:336-340), refuses rather than allows on a nonsensical limit (0028:320-326), is service_role-only (0028:346-348), and the failure is logged loudly. The fixed-window doubling at window edges is documented and accepted (0028:351).
  
  The constraint worth writing down: the natural remediation for TPN-NET-004 and TPN-NET-005 is to move resolve-login and provision-workspace onto `isRateLimited()`. Doing that verbatim would place a fail-open helper in front of the two PRE-AUTH endpoints, where nothing has authorized the caller and the limiter IS the only control — converting a database error into unlimited username enumeration and unlimited tenant creation. Those call sites need a fail-CLOSED variant (or an explicit `failOpen: false` parameter), matching the call operatorGuard already makes for its own unknowns.
effort: XS
blocks_tier: none
recommendation_ref: RECO-NET-SEG
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

**Applied — Track B bundle B1 (2026-09-06).** `isRateLimited()` gained `opts: { failOpen?: boolean }`, default `true`, so the eight authenticated callers are unchanged and were not redeployed. `resolve-login` passes `{ failOpen: false }`: if `fn_rate_limit_hit` errors or throws, the pre-auth caller is refused with 429, and the same `console.error` line names the bucket — a broken limiter now shows up as "everyone throttled", which gets noticed, rather than "nobody throttled", which does not.

---

## TPN-LOG-001 — No SIEM / centralized logging / log aggregation

```yaml
id: TPN-LOG-001
severity: HIGH
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

**Re-audit 2026-07-30 — PARTIALLY REMEDIATED.**

Current location: `repo-wide; src/cloud/sentry.js:12, supabase/functions/_shared/rateLimit.ts:61`

Severity revised to **HIGH**.

Materially improved but NOT closed, and remediated by a different mechanism than RECO-LOG-SIEM prescribed. What now exists: four append-only, RLS-enforced in-DB streams — app_events (supabase/migrations/0021_app_events.sql:32, admin-read, no UPDATE/DELETE policies), edit_history (0012_edit_history.sql:36), file_events (0027_file_lifecycle.sql:74), platform_audit (0028_operator_console.sql:166) — plus auth_attempt_log (0001_workspaces_and_users.sql:107, operator-read). So the baseline claim 'every security-relevant event is silent or console-only' is now false. What is still absent, verified by grep across src/, electron/, supabase/, scripts/, docs/, package.json and .github/: ZERO structured logger (no winston/pino/bunyan/slog) and ZERO shipper or aggregator (no splunk/sentinel/datadog/elastic/fluent/syslog/otel/logstash). Sentry is the only external sink (src/cloud/sentry.js:12) and it is (a) errors-only — reportAppEvent forwards only severity error|critical (src/cloud/errorCodes.js:89), (b) not a security log, and (c) DSN-gated: set only in .env.development:10, empty in .env.local:11, absent from both CI workflows (.github/workflows/backups.yml, rls.yml). There is no cross-environment aggregation (three hosted Supabase projects + Electron + Edge Functions each log in isolation), no correlation, and no alert rule anywhere (grep for pagerduty|opsgenie|alert|webhook returns nothing outside UX prose). Edge-Function diagnostics are console.error into Supabase's ephemeral function logs, unshipped and unalerted — supabase/functions/_shared/rateLimit.ts:61 and :66 explicitly note that this line is 'the only signal that durable rate limiting has quietly become no rate limiting at all'. Per severity-and-shield-mapping.md, CRITICAL requires 'no SIEM AND no aggregation'; in-DB aggregation exists, so this drops to HIGH ('Best Practice partially met, material gap'). Still blocks Gold.

---

## TPN-LOG-002 — Content upload/download/delete routes emit no audit event (AS-2.9)

```yaml
id: TPN-LOG-002
severity: HIGH
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

**Re-audit 2026-07-30 — PARTIALLY REMEDIATED.**

Current location: `electron/main.cjs:1341 (download); src/tools/rabbit_v0.1.0/adapters/supabaseAdapter.js:452 (download); supabase/migrations/0027_file_lifecycle.sql:85 (event vocabulary)`

Severity revised to **HIGH**.

Baseline location electron/main.cjs:1223 is stale — the POST is now :1300, GET download :1341, DELETE :1368. UPLOAD and DELETE are now audited on BOTH paths: cloud via the trg_files_lifecycle trigger (0027_file_lifecycle.sql:224) writing uploaded/trashed/restored/moved/purged with actor_user_id, actor_label, path, size and timestamp, plus 'purged' deletion certificates (0027:197); local via rabbitLogFileEvent (electron/main.cjs:1328 upload, :1384 delete). DOWNLOAD AND VIEW REMAIN COMPLETELY UNLOGGED on both paths and cannot be logged without a migration: the cloud download is a bare storage read (supabaseAdapter.js:452-457, no event write, no files-row touch so no trigger fires); the local download is res.sendFile with nothing before it (electron/main.cjs:1341-1352); and the file_events event CHECK constraint (0027_file_lifecycle.sql:85-86) enumerates only ('uploaded','moved','relinked','trashed','restored','purged') — there is no 'downloaded' or 'viewed' value. Egress of pre-release studio content out of the private rabbit-files bucket is therefore invisible. Required-field coverage is also still short: file_events has NO ipAddress, NO macAddress, NO geolocation, NO sessionId and NO per-user-per-asset counter columns (schema at 0027:74-97). AS-2.9's 'outbound transfers must notify the content owner' has no implementation anywhere. Missing >=3 required fields plus a whole missing event class = HIGH per code-signals.md; the CRITICAL rating drops because upload/delete now carry actor+timestamp+path+size and certified disposal exists.

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

**Re-audit 2026-07-30 — PARTIALLY REMEDIATED.**

Current location: `src/cloud/auth/LoginScreen.jsx:162; src/admin/OperatorLogin.jsx:57; src/cloud/auth/ResetPasswordWizard.jsx:107; src/cloud/errorCodes.js:23`

Severity revised to **HIGH**.

The baseline ARTIFACT is gone but the CONTROL is still unmet. Deletion confirmed: electron/main.cjs:612-636 is the tombstone for /api/auth/session, /api/auth/verify and /api/auth/change; the hardcoded master-override and default constants are gone; src/components/PasswordScreen.jsx no longer exists; cleanupLegacyAuthFile() at electron/main.cjs:2176 is invoked at boot (:2475). So the 'admin-override use' half is SUPERSEDED. The rest is STILL OPEN under the new architecture. auth_attempt_log (0001:107) is NOT an authentication log — resolve-login writes it before any password is checked (supabase/functions/resolve-login/index.ts:97, :120, :156, :176), so outcome='resolved' means 'this username exists', not 'this person authenticated'. In app_events, the ONLY event_type='auth' rows ever written in the entire codebase are MFA ENROLMENT FAILURES (src/cloud/auth/MfaSection.jsx:72 and :111) — verified by grepping every reportAppEvent call site. Unlogged: sign-in success (LoginScreen.jsx:162 signInWithPassword, success path falls through to :188-196 with no event), sign-in failure (LoginScreen.jsx:163-166 sets a generic string and returns), MFA challenge failure (LoginScreen.jsx:224), sign-out (src/App.jsx:334), session expiry, and self-service password change (ResetPasswordWizard.jsx:107 supabase.auth.updateUser({password}) — no event, no admin notification). Codes WIL-1001 'Sign-in failed', WIL-1002 'Session expired' and WIL-1003 'Multi-factor challenge failed' are declared at src/cloud/errorCodes.js:23-25 with ZERO call sites — the registry documents a control that was never wired. Partial credit: workspace-admin actions ARE audited (logAdminEvent, supabase/functions/_shared/adminGuard.ts:175, WIL-4101/4102/4103/4104) and operator ACTIONS reach platform_audit — but see new finding TPN-LOG-007 for operator ACCESS. Effort remains S.

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

**Re-audit 2026-07-30 — PARTIALLY REMEDIATED.**

Current location: `supabase/migrations/0021_app_events.sql:122; supabase/migrations/0012_edit_history.sql:258; .github/workflows/backups.yml:18`

Severity revised to **HIGH**.

EXPLICIT JUDGEMENT AS REQUESTED: the S14/S15 claim that TPN-LOG-004 is closed is TRUE FOR TWO STREAMS AND FALSE FOR THE OTHER TWO. Retention now exists and is test-pinned, but at a value TPN forbids for the two oldest and busiest streams. app_events purges at 90 DAYS (purge_app_events default INTERVAL '90 days', 0021_app_events.sql:122; nightly pg_cron 'wilson-purge-app-events' at 0021:148; pinned by supabase/tests/rls/25_app_events.sql:172-173 'purge_app_events sweeps rows older than 90 days'). edit_history purges at 90 DAYS (0012_edit_history.sql:258; cron at 0012:288; pinned by supabase/tests/rls/17_edit_history.sql:339-341). TPN TS-1.5 requires logs >= 1 YEAR. This is the stream that carries the WIL-41xx admin-action audit lines (adminGuard.ts:180) — i.e. the admin audit trail itself is destroyed at 90 days by a scheduled job. Genuinely compliant: file_events has NO purge job and 0027:16-18 states the reason ('audit logs must be kept >= 1 year'); platform_audit has NO purge job (0028:47-49); auth_attempt_log has no purge. edge_rate_limits purges at 1 day (0028:355) which is correct — operational counters, not audit. Two further problems: (1) NO WRITTEN RETENTION POLICY exists — docs/ contains only MASTER_PLAN.md, ORIGINAL_BRIEF_multiuser.md, OWED_AUDREY.md and WEB_DEPLOY.md; there is no DATA_RETENTION.md or HARDENING.md, and per severity-and-shield-mapping.md checklist item 6 a documentation gap is a finding in its own right because assessors cannot infer policy from a SQL default. (2) The off-platform copy does not rescue it and is self-contradictory: .github/workflows/backups.yml:18-21 instructs a B2 lifecycle rule of 'keep only the last 30 days', while docs/MASTER_PLAN.md:1329 states '90-day retention' for the same bucket — both are far under a year. (3) No dual authorization on log deletion anywhere: purge_app_events/purge_edit_history are SECURITY DEFINER granted to service_role (0021:139, 0012:277) and any holder of the service-role key can run either on demand with no second approval and no record.

---

## TPN-LOG-005 — Privilege and grant changes on workspace_members are written directly by the client and audited by nothing

```yaml
id: TPN-LOG-005
severity: CRITICAL
control: TS-1.5
domain: logging
title: Privilege and grant changes on workspace_members are written directly by the client and audited by nothing
location: src/components/TeamMembers/useWorkspaceMembers.js:111
evidence: |
  The RLS policy ws_members_admin_write (supabase/migrations/0020_admin_grants_and_alignment.sql:279) is FOR ALL, so any workspace admin can UPDATE workspace_members straight from the browser with the anon key. The client does exactly that: useWorkspaceMembers.js:111-116 issues `.from('workspace_members').update(patch)` with an arbitrary patch — app_role, grant_rate_card_view, grant_rate_card_edit, is_active. Nothing captures it. edit_history's entity_type CHECK (supabase/migrations/0012_edit_history.sql:41-45) enumerates thirteen RABBIT tables and deliberately excludes workspace_members ('workspace_members et al. are Session 9 territory' — a comment, not an implementation). The only triggers on workspace_members are guards, not capture: trg_ws_members_self_guard (0009:84, 0010:126) and trg_ws_members_last_admin_guard (0020:363). No app_events write exists on this path (logAdminEvent is only reachable from the four admin-* Edge Functions, adminGuard.ts:175). Result: promoting a standard user to 'admin' — the single highest-value configuration change in a tenant, and the one that unlocks the Admin Terminal, app_events reads, WorkspaceTakeout and storage-gc — produces zero rows in app_events, edit_history, file_events or platform_audit. Demotion, rate-card grant toggles and client-side deactivation are equally invisible. Only deactivation performed through admin-set-active is logged (WIL-4103/4104), and the client is not required to use it.
required: |
  TS-1.5 (Best Practice, required for Gold): admin access and CONFIG CHANGES must be logged with source IP, user, action, result and timestamp, and must be alertable. code-signals.md: 'No admin/config-change audit log -> CRITICAL'.
gap: |
  The privilege model is the security boundary of the whole multi-tenant product, and every change to it is unrecorded. After an incident there is no way to establish who granted admin to whom, or when — the roster shows only the end state. This also defeats the last-admin guard's forensic value: the guard prevents removing the final admin but records nothing about the ones added.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-LOG-SIEM
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-LOG-006 — Every audit write ignores the supabase-js error channel, so a failed audit insert is indistinguishable from a successful one

```yaml
id: TPN-LOG-006
severity: HIGH
control: TS-1.5
domain: logging
title: Every audit write ignores the supabase-js error channel, so a failed audit insert is indistinguishable from a successful one
location: supabase/functions/_shared/operatorGuard.ts:161
evidence: |
  All four audit writers wrap `await client.from(TABLE).insert(...)` in try/catch and check nothing else: logPlatformEvent (operatorGuard.ts:160-179), logAdminEvent (supabase/functions/_shared/adminGuard.ts:179-191), logUsage (supabase/functions/ai-proxy/index.ts:102-121) and reportAppEvent (src/cloud/errorCodes.js:72-87). A PostgREST builder resolves with { data, error } — it does not reject — and `grep -rn throwOnError src supabase` returns ZERO hits, so none of these clients is configured to throw. The try/catch therefore fires only on a network-layer exception; a CHECK violation, an RLS refusal, a column-length rejection or a PostgREST error is swallowed silently and the caller proceeds as if the audit landed. The consequence is worst exactly where the code claims to be most careful: operatorGuard.ts:166-169 comments that 'a certificate write must be infallible... a rejected insert here would mean a destruction with no record of it', then leaves the error channel unread. operator-workspaces/index.ts:433 writes the workspace.teardown certificate through this path — if that insert fails, the function still returns 200 with blob counts and a company is destroyed with no surviving record. The same silence covers the WIL-41xx admin audit lines and all AI-spend telemetry.
required: |
  TS-1.5: the audit trail must be reliable and its failures detectable. Logging that can fail silently is not an audit trail.
gap: |
  There is no detection, no retry, no fallback sink and no metric. A permanently broken audit write (e.g. a CHECK constraint tightened by a later migration, or a revoked grant) would look identical to a quiet system. This is the same failure class recorded in the project's own supabase-js trap notes, applied to the audit layer.
effort: XS
blocks_tier: Gold
recommendation_ref: RECO-LOG-SIEM
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-LOG-007 — Platform Operator Console access — the highest-privilege surface in the system — is entirely unlogged, and platform_audit cannot express a session event

```yaml
id: TPN-LOG-007
severity: HIGH
control: TS-1.5
domain: logging
title: Platform Operator Console access — the highest-privilege surface in the system — is entirely unlogged, and platform_audit cannot express a session event
location: src/admin/OperatorLogin.jsx:57
evidence: |
  OperatorLogin.handlePassword (src/admin/OperatorLogin.jsx:57) calls signInWithPassword and handleCode (:107-113) completes the TOTP challenge; neither success (:127-128 saveSession/onSignedIn) nor failure (:61-65, :114-119) writes to platform_audit, app_events or auth_attempt_log. auth_attempt_log is not reachable here either — the operator flow is email-first and deliberately bypasses resolve-login (header comment, OperatorLogin.jsx:4-9), which is the only writer of that table. Guard-side refusals are equally silent: requirePlatformOperator returns 401 unauthorized (operatorGuard.ts:65, :73), 403 forbidden for a non-operator (:88), 403 mfa_enrollment_required (:108), 403 mfa_required (:111) and 503 operator_check_failed (:85) with no event on any branch. The schema forecloses the fix: platform_audit's action CHECK (supabase/migrations/0028_operator_console.sql:172-182) enumerates ten values, all of them state changes ('workspace.created' … 'operator.revoked') — there is no 'operator.signin', 'operator.signin_failed' or 'operator.denied' value, so a login could not be recorded without a migration. logPlatformEvent's own TypeScript union (operatorGuard.ts:138-146) narrows further, omitting even operator.granted/operator.revoked. Sign-out (src/admin/OperatorApp.jsx:90) is also unrecorded.
required: |
  TS-1.5: authentication successes and failures, and all ADMIN ACCESS, must be logged with source IP, user, action, result and timestamp, and must be alertable. This tier can read every tenant's roll-up (operator_workspace_summary) and irreversibly destroy any company (operator-workspaces action 'teardown').
gap: |
  A credential-stuffing campaign against /wilsonadmin, a successful compromise of an operator account, or repeated forbidden/mfa_required refusals from a stolen token all leave no trace in any stream the product owns. platform_audit records what an operator DID but never that they arrived, so an actioned event has no preceding session to correlate against — and repeated failed attempts, the highest-signal detection there is at this tier, produce nothing at all.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-LOG-SIEM
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-LOG-008 — No source IP or session identifier on any admin or operator audit event, despite the Request being in scope

```yaml
id: TPN-LOG-008
severity: MEDIUM
control: TS-1.5
domain: logging
title: No source IP or session identifier on any admin or operator audit event, despite the Request being in scope
location: supabase/functions/_shared/adminGuard.ts:180
evidence: |
  app_events (supabase/migrations/0021_app_events.sql:32-49), file_events (0027_file_lifecycle.sql:74-97), platform_audit (0028_operator_console.sql:166-196) and edit_history (0012_edit_history.sql:36-58) all lack any ip_address, session_id, user_agent or host column. auth_attempt_log (0001_workspaces_and_users.sql:111) is the ONLY table in the system with an ip_address column, and resolve-login/index.ts:40-46 already demonstrates the extraction (x-forwarded-for then x-real-ip). Both privileged guards hold the Request object when they log and discard it: requireWorkspaceAdmin(req) then logAdminEvent(ctx, ...) (adminGuard.ts:64, :175 — ctx is { admin, callerId, workspaceId }, no request metadata), and requirePlatformOperator(req) then logPlatformEvent(ctx, ...) (operatorGuard.ts:57, :156 — ctx is { admin, callerId, callerLabel }). So admin user creation, password reset, deactivation, AI-key set/clear and workspace teardown are all attributed to a user id with no network origin.
required: |
  TS-1.5: auth successes, auth failures, admin access and config changes must be logged with SOURCE IP, user, action, result and timestamp.
gap: |
  Events cannot be correlated to a network origin, geography or device, so 'the admin account did this' can never be separated from 'someone holding the admin account's token did this'. Combined with TPN-LOG-007 (no session events at all) there is no way to reconstruct an access path during an incident. The fix is small — thread a clientIp(req) through both guard contexts and add one column to each stream.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-LOG-SCHEMA
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-LOG-009 — app_events is client-writable with no throttle and the only in-product log viewer reads the newest 100 rows, so the audit view can be flooded blind

```yaml
id: TPN-LOG-009
severity: MEDIUM
control: TS-1.5
domain: logging
title: app_events is client-writable with no throttle and the only in-product log viewer reads the newest 100 rows, so the audit view can be flooded blind
location: supabase/migrations/0021_app_events.sql:99
evidence: |
  The app_events_insert policy (0021_app_events.sql:99-108) admits any active member of the workspace, restricting only event_type <> 'admin' and code !~ '^WIL-41'. Everything else is free: a member may insert unlimited rows with event_type 'auth', 'error', 'system', 'storage', 'realtime' or 'update', any severity including 'critical', any 2000-char message and any 8000-char context. There is no rate limit on this path — fn_rate_limit_hit (0028:305) is service_role-only and applies to Edge Functions, not to a direct PostgREST insert from a signed-in member. The only reader is LogsSection, which fetches `.limit(100)` newest-first (src/components/AdminTerminal/LogsSection.jsx:85-90) and then filters PURELY CLIENT-SIDE over that fetched page (:172-174 visibleEvents), with no pagination, no date range and no server-side predicate. Roughly 100 injected rows therefore push every prior event — including WIL-41xx admin audit lines — out of the only view the product offers, and selecting severity='critical' searches only the injected page.
required: |
  TS-1.5: the audit trail must be usable and tamper-resistant; log integrity controls must prevent an ordinary user from degrading the record.
gap: |
  The rows are not deleted, so this is anti-forensics rather than destruction — but with no SIEM (TPN-LOG-001) and no export other than the admin-only WorkspaceTakeout, the Admin Terminal is the only practical reader, and it is blindable by any member in one scripted loop. It is also an unbounded-growth vector against a table that carries a 90-day purge and a nightly off-platform dump.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-LOG-SIEM
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-LOG-010 — O.T.T.E.R. content, Notes and project roles have no change history — the triggers named '_audit' only stamp authorship columns

```yaml
id: TPN-LOG-010
severity: MEDIUM
control: TS-1.5
domain: logging
title: O.T.T.E.R. content, Notes and project roles have no change history — the triggers named '_audit' only stamp authorship columns
location: supabase/migrations/0022_otter_content.sql:168
evidence: |
  The trigger names read like audit capture and are not. trg_otter_courses_audit (0022_otter_content.sql:168-170), trg_otter_subjects_audit (:236), trg_otter_progress_audit (:283), trg_otter_cr_audit (:361), trg_notes_audit (supabase/migrations/0017_notes.sql:66-68) and trg_note_subjects_audit (0017:139) all execute public.fn_audit_touch(), which stamps created_by/updated_by/updated_at on the row — it writes no history row anywhere. The real capture function, fn_edit_history_capture, is attached only to the thirteen tables looped at 0012_edit_history.sql:241-243, and edit_history's entity_type CHECK (0012:41-45) rejects anything else, so an OTTER or Notes history row could not be inserted even if a trigger tried. project_members is likewise uncovered (already recorded as gap #7 in docs/MASTER_PLAN.md §6, still open). Net: O.T.T.E.R. course/subject content edits, Notes edits, and project-level role assignments leave only a last-writer stamp.
required: |
  TS-1.5: application changes to content and to access grants must be logged. AS-2.9 by extension for anything holding pre-release material.
gap: |
  For O.T.T.E.R. the change-request workflow records DECISIONS (otter_change_requests) but not the edits that land, and 0025's apply RPC mutates content with no per-field record — so 'what changed in this course and who changed it' is unanswerable. For project_members, a user being added to or removed from a project (which is what governs file visibility under can_read_project_topic, 0027:121) is unrecorded, meaning content-access grants are unauditable. The misleading '_audit' trigger names actively obscure this during review.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-LOG-SIEM
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-LOG-011 — The local (Electron) file_events twin has no actor, is rewritten in place by the same process that reads it, and trims non-purged events

```yaml
id: TPN-LOG-011
severity: MEDIUM
control: AS-2.9
domain: logging
title: The local (Electron) file_events twin has no actor, is rewritten in place by the same process that reads it, and trims non-purged events
location: electron/main.cjs:953
evidence: |
  rabbitLogFileEvent (electron/main.cjs:953-970) pushes events onto bundle.fileEvents, an array inside the project's plaintext JSON bundle under %APPDATA%. The event object carries id, created_at and the caller's fields only — there is NO actor_user_id and NO actor_label, unlike its cloud twin (supabase/migrations/0027_file_lifecycle.sql:151-156 resolves auth.uid() to a label). There cannot be one: the embedded Express server has no authentication middleware at all after the Session 15 deletion — electron/main.cjs:143 is `expressApp.use(cors())` with no allow-list and no auth, and the legacy /api/auth/* routes were removed (tombstone at :612-636). The whole stream is then rewritten on every mutation by writeRabbitBundle (e.g. electron/main.cjs:1337, :1396), so it is a mutable file, not an append-only store — anything with filesystem access, including a drive-by request to the open CORS server, can rewrite or truncate history. Finally the 2000-event cap at :963-969 evicts the oldest non-'purged' events, so uploaded/moved/relinked records are silently dropped on busy projects ('purged' certificates are correctly exempted). docs/MASTER_PLAN.md §6 #37 already records that nothing renders this stream.
required: |
  AS-2.9: content events must carry user, action, result, timestamp, IP and asset identity, and the trail must be tamper-evident. TS-1.5: audit records must not be modifiable by the systems they audit.
gap: |
  On the Electron/local_server storage path — the default for desktop projects — the file lifecycle record names no actor at all, is stored where the audited process can rewrite it, and discards non-deletion events under load. The cloud path gets an actor because Postgres knows who is calling; the local path has no identity to record, so the record is unattributable by construction rather than by oversight.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-LOG-SCHEMA
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

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

**Re-audit 2026-07-30 — PARTIALLY REMEDIATED.**

Current location: `electron/main.cjs:1341 (was electron/main.cjs:1255); cloud arm at src/tools/rabbit_v0.1.0/adapters/supabaseAdapter.js:452`

Severity revised to **HIGH**.

CLOUD ARM RESOLVED BY A DIFFERENT MECHANISM: there are no download links at all. `grep -rn 'createSignedUrl|getPublicUrl'` over src/supabase/electron returns exactly two hits, both for user-avatars — zero for project content. supabaseAdapter.js:452-457 `downloadFile` calls `client.storage.from('rabbit-files').download(file.storage_path)` — an authenticated fetch carrying a live JWT, gated by the rabbit_files_select policy (0027_file_lifecycle.sql:301-311). The bucket is PRIVATE (0027:287-291, `public=false`), post-condition-asserted at 0027:404-408 and pgTAP-pinned at supabase/tests/rls/33_file_lifecycle.sql:279-280. A URL that cannot be bookmarked or copied needs no expiry, so AS-3.7's link-expiration requirement is satisfied more strongly than the plan prescribed. LOCAL EXPRESS ARM STILL OPEN, AND WEAKER THAN AT BASELINE: electron/main.cjs:1341-1352 is byte-for-byte the same stable resource path (`/api/rabbit/projects/:projectId/files/:id/download` -> `res.sendFile(diskPath)`); the baseline's 'requires only a valid session' no longer holds because S15 deleted the only auth code in the server (main.cjs:612-637 is now a tombstone comment) — the route now requires NOTHING. `expressApp.use(cors())` at main.cjs:143 is still bare (LEARNINGS.md re-audit checklist item 6 expects zero hits; it has one), so any origin can read the response body cross-origin. The only remaining mitigation is the ephemeral loopback bind at main.cjs:2079 (`expressApp.listen(0, '127.0.0.1')`), which is port-scan-defeatable from JS. Neither arm has a per-user-per-asset download cap. Severity held at HIGH.

---

## TPN-CONT-002 — No content lifecycle state machine or certified disposal

```yaml
id: TPN-CONT-002
severity: MEDIUM
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

**Re-audit 2026-07-30 — PARTIALLY REMEDIATED.**

Current location: `supabase/migrations/0027_file_lifecycle.sql:74 / :138 / :231; supabase/functions/storage-gc/index.ts:1; supabase/functions/operator-workspaces/index.ts:355 (baseline electron/main.cjs:1276 is now main.cjs:1368)`

Severity revised to **MEDIUM**.

EXPLICIT JUDGEMENT AS REQUESTED — S14/S15 substantially deliver this, and the claim mostly holds. VERIFIED PRESENT: (1) the lifecycle vocabulary is real and constrained, not decorative — 0027:85-86 `CHECK (event IN ('uploaded','moved','relinked','trashed','restored','purged'))`, driven by the DEFINER capture trigger at 0027:138-227 (INSERT->uploaded 0027:158; deleted_at NULL->NOT NULL ->trashed 0027:169; NOT NULL->NULL ->restored 0027:176; storage_path change ->moved 0027:185; both facts on one UPDATE emit both events). (2) THE 'purged' ROWS REALLY ARE DELETION CERTIFICATES: written by the DELETE arm at 0027:194-209, carrying old_path, size_bytes, actor, and a details JSONB of mime/kind/was_trashed; project_id and file_id deliberately carry NO FK (0027:77-79) so the row outlives its subject; the `left(OLD.mime_type,256)` truncation at 0027:208 keeps the certificate write infallible against a client-writable oversized mime that would otherwise trip the details CHECK and get swallowed by the EXCEPTION handler. Append-onlyness is enforced three ways — zero write policies (0027:128), REVOKE INSERT/UPDATE/DELETE (0027:132-133), and migration post-conditions at 0027:357-374 — and pgTAP 33_file_lifecycle.sql:123-138 proves clients cannot INSERT/UPDATE/DELETE. Certificates stay readable after the project is purged via the admin arm of file_events_select (0027:125). (3) CERTIFIED DISPOSAL EXISTS: storage_gc_queue (0027:231-243) + trg_files_gc_enqueue (0027:253-281) + the storage-gc Edge Function, which drains the queue and stamps every row deleted/missing/failed/skipped (storage-gc/index.ts:153-182), refuses to touch any path a live OR trashed files row still references (index.ts:156-163), and writes its own terminal-status ledger rows for orphan and avatar deletions (index.ts:115-125). (4) ARCHIVAL/RETENTION STATE EXISTS: 0014_soft_delete.sql:299-355 gives 30-day trash + a nightly pg_cron purge. (5) S15 CLOSED THE TENANT-TEARDOWN HOLE the 0027 header itself flagged at 0027:266-268: platform_audit (0028_operator_console.sql:166-221) carries NO workspaces FK and is FORCE-RLS append-only, and operator-workspaces/index.ts:365-446 collects every blob path from BOTH files and storage_gc_queue BEFORE the CASCADE, deletes them, certificates each batch as WIL-7006 with the literal paths (index.ts:388-404) and the run as WIL-7005 (index.ts:433-446). (6) There is a real product surface — FileAuditDrawer.jsx renders the stream. WHAT KEEPS THIS FROM RESOLVED: the state machine covers `public.files` only. On the Electron tier the PRODUCTION media path (`bundle.managedFiles`) emits nothing at all — `rabbitLogFileEvent` is called at exactly four sites (main.cjs:1328, 1384, 1557, 1572), none of them managed-files (see TPN-CONT-006); local project delete destroys content and certificates together (TPN-CONT-007); there is no read/receipt event anywhere in the vocabulary (TPN-CONT-008); disposal only ever runs when a human clicks (TPN-CONT-010); and derived intake text outlives its source file (TPN-CONT-011). Downgraded HIGH -> MEDIUM: the machine exists and is well built; the gaps are coverage, not absence.

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

**Re-audit 2026-07-30 — STILL OPEN.**

Current location: `electron/main.cjs:1350 (was electron/main.cjs:1262); aggravated at electron/main.cjs:1751, :1762, :1786, :1796 and src/tools/rabbit_v0.1.0/adapters/supabaseAdapter.js:415`

Severity revised to **HIGH**.

Not remediated, and the codebase now moves in the wrong direction. `grep -rn 'Cache-Control|no-store|Pragma' src supabase electron` returns FOUR hits in the entire repository and every one of them is `res.setHeader('Cache-Control', 'public, max-age=60')` on a thumbnail route (main.cjs:1751 and :1762 asset thumbs, :1786 and :1796 scene/shot/level/experience thumbs). Those are 512px renditions of pre-release studio imagery being explicitly declared PUBLICLY cacheable. The string `no-store` does not appear anywhere in src/, supabase/ or electron/. The download route itself (main.cjs:1350-1351) still sets only Content-Type before `res.sendFile`, exactly as at baseline. The baseline gap text anticipated the cloud tier — that prediction is now confirmed in code: supabaseAdapter.js:414-418 uploads every project blob with `cacheControl: '3600'`, which becomes the object's Cache-Control metadata on every Supabase Storage response, so a downloaded pre-release asset is retained in the viewer's HTTP cache for an hour and survives sign-out. No `Pragma: no-cache` anywhere. Severity held at HIGH.

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

**Re-audit 2026-07-30 — STILL OPEN.**

Current location: `electron/main.cjs:110 (was electron/main.cjs:82)`

Severity revised to **MEDIUM**.

`getThumbCacheDir()` is unchanged in substance at main.cjs:110-114 ({userData}/rabbit-data/thumbnails). There is still no TTL, no periodic sweep and no scheduled purge — the only wholesale removal in the tree is `fs.rmSync(thumbsDir, ...)` inside `rabbit:archive-local-data` (main.cjs:2246), which fires once, on cloud migration. Owner-signal purge is still incomplete and in two places got worse than the baseline described: asset DELETE (main.cjs:1199-1226) moves the ASSETS folder to .trash and soft-deletes the managed files, but never unlinks `asset-{id}.jpg` from the thumb cache — so a 512px rendition of the deleted asset survives the asset itself; and managed-file SOFT delete (main.cjs:1696-1700) leaves `{mf.id}.jpg` in place (only the `?hard=true` branch at main.cjs:1692-1693 clears it). Entity thumbs still depend on renderer-initiated IPC (`rabbit:clear-asset-thumbnail` main.cjs:2377, `rabbit:clear-entity-thumbnail` main.cjs:2394) that nothing forces the renderer to call. The intake half of this finding has MOVED rather than closed: there is no temp/working directory any more (`grep -n 'os.tmpdir|mkdtemp'` over electron/ and rabbit/ returns zero), because extracted document text now lands in a database table instead — where it has a worse retention story, filed separately as TPN-CONT-011. Severity held at MEDIUM.

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

**Re-audit 2026-07-30 — STILL OPEN.**

Current location: `src/tools/rabbit_v0.1.0/adapters/supabaseAdapter.js:400 and :452; electron/main.cjs:1300 and :1341 (baseline pointed at src/tools/rabbit_v0.1.0/adapters/googleDriveAdapter.js:1)`

Severity revised to **HIGH**.

Zero remediation. `grep -rni 'watermark|forensic|chain.of.custody'` across src/, supabase/, electron/, docs/ and scripts/ returns exactly one hit — a prose comment in FileAuditDrawer.jsx:10 describing the audit drawer as 'TPN-CONT-002's chain-of-custody surface'. No `watermark`, `embedWatermark` or `forensicMark` function exists on any path. The baseline location has partly evaporated: googleDriveAdapter.js:253 now reads `uploadFile: readOnly('uploadFile')`, so the Drive write boundary is gone. The boundary did not disappear, it moved: supabaseAdapter.js:400-445 streams raw bytes into rabbit-files with no pre-send mark, supabaseAdapter.js:452-457 returns the raw Blob to the renderer with no viewer-bound mark, and the Electron tier does the same at main.cjs:1300-1339 (upload) and main.cjs:1341-1352 (download). Paired with TPN-ENC-005. Severity held at HIGH; effort remains XL and this is the single largest remaining Gold blocker in this domain.

---

## TPN-CONT-006 — Managed files — the Electron tier's PRODUCTION media path — emit no lifecycle events and no deletion certificate

```yaml
id: TPN-CONT-006
severity: HIGH
control: AS-3.15
domain: content
title: Managed files — the Electron tier's PRODUCTION media path — emit no lifecycle events and no deletion certificate
location: electron/main.cjs:1675 (hard delete) and electron/main.cjs:1602 (create)
evidence: |
  main.cjs:1591-1594 labels these 'the production file management routes'. The hard-delete branch at main.cjs:1680-1694 does `if (fs.existsSync(diskPath)) try { fs.unlinkSync(diskPath); } catch {}` on the physical media, then unlinks its thumbnail, then `rabbitRemoveFrom(bundle.managedFiles, ...)` — with no call to `rabbitLogFileEvent`. The POST at main.cjs:1602-1657 pushes the row and writes the bundle with no event either. `grep -n 'rabbitLogFileEvent' electron/main.cjs` returns the definition (:953) and exactly four call sites — :1328, :1384, :1557, :1572 — every one of them on `bundle.files`, none on `bundle.managedFiles`.
required: |
  AS-3.15: a formal lifecycle across receipt/creation -> WIP -> archival -> certified disposal, with chain-of-custody logs and proof-of-deletion, applied to the content itself.
gap: |
  The S14 lifecycle stream was wired to the attachment table (`bundle.files`) and never to `bundle.managedFiles`, which is the array that holds the versioned production media under ASSETS/, SCENES/ and SHOTS/. Destroying real project media on the desktop tier is therefore still exactly the baseline behaviour TPN-CONT-002 described: an unlink with no certificate, no checksum and no audit row. The FileAuditDrawer will show an empty history for every one of these files.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-CONT-LIFECYCLE
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-CONT-007 — Local project delete recursively destroys the content AND every deletion certificate for it, silently

```yaml
id: TPN-CONT-007
severity: HIGH
control: AS-3.15
domain: content
title: Local project delete recursively destroys the content AND every deletion certificate for it, silently
location: electron/main.cjs:1078
evidence: |
  expressApp.delete('/api/rabbit/projects/:id', (req, res) => {
    const dir = path.join(getRabbitProjectsDir(), req.params.id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    res.json({ ok: true });
  });
  That directory is `{userData}/rabbit-data/projects/{id}` (main.cjs:718-726). It contains BOTH the content bytes — `getRabbitFilesDir()` is `{projectDir}/files` (main.cjs:728-732), the default target of `resolveProjectFilesDir` (main.cjs:909-910) — and `project.json` (main.cjs:733-735), which is the sole store of `bundle.fileEvents`, i.e. every 'purged' certificate the project ever accumulated.
required: |
  AS-3.15: certified disposal with proof-of-deletion; TS-1.5 dual authorization on destruction. A deletion certificate must survive the thing it certifies.
gap: |
  One unauthenticated HTTP DELETE erases an entire project's pre-release content and simultaneously erases the audit trail that would prove what was destroyed. No confirmation, no event emitted for the project or for any of its files, no certificate, no counterpart to the S15 operator teardown sweep that does exactly this correctly on the cloud tier. The 0027 design goes to real lengths to keep certificates FK-free so they outlive their subject (0027:77-79); the local tier discards them with an `rm -rf`.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-CONT-LIFECYCLE
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-CONT-008 — The content lifecycle vocabulary has no read side — no record of who obtained a copy of an asset

```yaml
id: TPN-CONT-008
severity: HIGH
control: AS-3.15
domain: content
title: The content lifecycle vocabulary has no read side — no record of who obtained a copy of an asset
location: supabase/migrations/0027_file_lifecycle.sql:85
evidence: |
  event TEXT NOT NULL CHECK (event IN
    ('uploaded', 'moved', 'relinked', 'trashed', 'restored', 'purged')),
  No 'downloaded', 'accessed', 'viewed' or 'delivered' member. The trigger that populates the table fires on INSERT/UPDATE/DELETE of public.files only (0027:225-227), so a read can never produce a row by construction. The download paths confirm it: supabaseAdapter.js:452-457 returns the Blob with no event write, and electron/main.cjs:1341-1352 `res.sendFile`s with no event write.
required: |
  AS-3.15 chain-of-custody: confirmation receipts, 'who received what when'. AS-3.7/AS-3.8: per-user-per-asset download counters and caps.
gap: |
  Every write-side transition is captured immaculately and no read is captured at all. For pre-release content the read side is the one that matters in an incident — after a leak there is no way to answer which users pulled a copy of an asset, how many times, or when. This also removes the substrate a per-user-per-asset download cap would need, which is the unremediated half of TPN-CONT-001. Note the CHECK constraint means adding the event later is a migration, not a code change.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-CONT-LIFECYCLE
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-CONT-009 — Workspace takeout and per-page CSV exports egress bulk content metadata with zero audit trail

```yaml
id: TPN-CONT-009
severity: HIGH
control: AS-3.15
domain: content
title: Workspace takeout and per-page CSV exports egress bulk content metadata with zero audit trail
location: src/components/AdminTerminal/WorkspaceTakeout.jsx:115
evidence: |
  `downloadBlob(\`wilson-takeout-${slug || 'workspace'}-${exportDateStamp()}.zip\`, blob)` at WorkspaceTakeout.jsx:115 is the end of a loop (WorkspaceTakeout.jsx:104-113) that pages every row of 19 tables — including projects, assets, tasks, files and file_events — into a zip. There is no `reportAppEvent` import in the file and no insert into app_events, edit_history or file_events anywhere in it. The facility exists and is used freely elsewhere (`src/cloud/errorCodes.js:62` exports `reportAppEvent`; called from adminApi.js:63/65/71, MfaSection.jsx:72/111, updates.js:32/43, DiagnosticsSection.jsx:87) — its absence here is an omission, not a limitation. Same pattern in the per-page exporters: RateCardPage.jsx:265, TeamMembersPage.jsx:270, ProjectTasksView.jsx:277, all calling `downloadCsv` (src/lib/csvExport.js:80) with no event.
required: |
  AS-3.15 chain-of-custody and DS-1.2: outbound transfers of content or content metadata are recorded — who exported, what scope, when — and the content owner is notified.
gap: |
  An admin can extract the complete metadata surface of every project in the tenant (asset names, task names, file names and storage paths, crew roster, rate cards) to a local zip, and nothing anywhere records that it happened. The manifest written into the archive (WorkspaceTakeout.jsx:90-101) documents the export to the person doing the exporting, which is the wrong direction. The RLS-scoped-reads discipline (no DEFINER sweep) correctly bounds WHAT can leave, but nothing observes THAT it left.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-CONT-LIFECYCLE
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-CONT-011 — Derived intake text (raw extracted client briefs, GDDs, decks) survives purge of the source file, orphaned and uncertificated

```yaml
id: TPN-CONT-011
severity: HIGH
control: AS-3.15
domain: content
title: Derived intake text (raw extracted client briefs, GDDs, decks) survives purge of the source file, orphaned and uncertificated
location: supabase/migrations/0000_rabbit_base_schema.sql:308
evidence: |
  create table if not exists ingestion_chunks (
    ...
    file_id     uuid references files(id) on delete set null,
    ...
    raw_text    text,
  That `on delete set null` is the whole finding: when the 30-day sweep hard-deletes the files row, the chunk survives with a NULL file_id. `raw_text` holds the verbatim extracted content — src/tools/rabbit_v0.1.0/intake/chunkers/brief.js:36 `raw_text: text` (whole brief), gdd.js:39 (whole GDD), deck.js:52, lookbook.js:46, notes.js:22. ingestion_chunks is NOT in the soft-delete table list (0014_soft_delete.sql:86) and NOT in the purge sweep list (0014:319-321), so purge_soft_deleted never touches it. Nothing emits a lifecycle event for it: the 0027 trigger watches public.files only (0027:225-227).
required: |
  AS-3.15: deletion of a source asset must purge derived and intermediate products; proof-of-deletion across caches and derivatives.
gap: |
  This is TPN-CONT-004's derived-artefact problem reborn in the cloud model, and larger — a thumbnail is a 512px rendition, a chunk is the full text of the client's brief or game design document. Deleting the uploaded file produces a 'purged' certificate that asserts the content was destroyed while the most sensitive derivative of it stays in Postgres indefinitely, reachable by any project reader and swept into every workspace takeout (WorkspaceTakeout.jsx:38 lists 'ingestion_runs','ingestion_chunks') and every nightly pg_dump. Only a project or run cascade ever removes it.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-CONT-LIFECYCLE
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-CONT-010 — Certified disposal never executes unless a human clicks; no queue-depth signal, no SLA, no fallback

```yaml
id: TPN-CONT-010
severity: MEDIUM
control: AS-3.15
domain: content
title: Certified disposal never executes unless a human clicks; no queue-depth signal, no SLA, no fallback
location: supabase/functions/storage-gc/index.ts:131
evidence: |
  `const guard = await requireWorkspaceAdmin(req)` at storage-gc/index.ts:131-133 — the function has no scheduled invoker anywhere. `grep -rn 'cron.schedule' supabase/migrations/*.sql` returns six jobs (0012, 0014, 0021, 0022, 0028) and none of them calls storage-gc. Its only caller is the manual button at src/components/AdminTerminal/StorageCleanupCard.jsx:132-141. Meanwhile the row side IS automated: purge_soft_deleted runs nightly (0014_soft_delete.sql:342-346) and hard-deletes files rows, which fires trg_files_gc_enqueue (0027:277-281) and parks a pending queue row. StorageCleanupCard renders no pending count — it has no read of storage_gc_queue at all, and could not have one (0027:250-251 gives the table RLS-on/zero-policies and revokes it from authenticated).
required: |
  AS-3.15: certified disposal within the stated retention period, with proof of deletion. TS-1.5: dual authorization on destruction.
gap: |
  The 30-day retention promise is met for the database row and not for the blob. Between the nightly purge and the next admin click, the content bytes of a file the system has already certified as 'purged' are still sitting in the bucket — indefinitely, if no admin ever clicks. The admin gets no signal that undisposed content is waiting, because the queue is deliberately invisible to every client role. The TS-1.5 dual-authorization rationale in the function header (index.ts:18-21) is sound; the failure is that there is no ceiling on the delay and no alert when the backlog grows.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-CONT-LIFECYCLE
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-CONT-012 — Asset delete moves content to an on-disk .trash folder that nothing ever sweeps, with no TTL and no certificate

```yaml
id: TPN-CONT-012
severity: MEDIUM
control: AS-3.15
domain: content
title: Asset delete moves content to an on-disk .trash folder that nothing ever sweeps, with no TTL and no certificate
location: electron/main.cjs:1210
evidence: |
  const trashDir = path.join(root, '.trash');
  if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });
  const ts = Date.now();
  try { fs.renameSync(folderPath, path.join(trashDir, `${slug}_${ts}`)); } catch (e) { ... }
  `grep -rn '\.trash' electron/main.cjs src` returns this creation site and nothing else in the Electron/local path — no reader, no sweeper, no TTL, no restore route. The route emits no lifecycle event either.
required: |
  AS-3.15: stated retention with certified disposal at expiry. Temp/quarantine areas purge on a defined schedule; TPN-LOG-004 requires a stated retention for anything that persists.
gap: |
  Every deleted asset's entire media folder is renamed under `{project_root}/.trash/` and left there permanently, invisible in the UI. Unlike the cloud tier's 30-day trash — which has a stated retention and an automated purge (0014:299-355) — this has neither, so the desktop tier accumulates an unbounded, unlisted, uncertificated shadow copy of every asset the user believes they deleted. If the project root is a user-chosen folder on a shared drive, the copies land there.
effort: S
blocks_tier: Gold Star
recommendation_ref: RECO-CONT-LIFECYCLE
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-CONT-014 — Teardown blob sweep cannot see orphaned uploads, and its certificate reports a completeness it does not have

```yaml
id: TPN-CONT-014
severity: MEDIUM
control: AS-3.15
domain: content
title: Teardown blob sweep cannot see orphaned uploads, and its certificate reports a completeness it does not have
location: supabase/functions/operator-workspaces/index.ts:115
evidence: |
  `collectBlobPaths` (index.ts:115-152) derives the sweep set from exactly two sources: public.files rows and storage_gc_queue rows. Neither contains a blob whose files-row insert was refused after the upload succeeded — supabaseAdapter.js:437-443 handles that case with a best-effort `storage.remove`, and trg_files_gc_enqueue (0027:277-281) only fires `AFTER DELETE ON public.files`, so no row ever existed to enqueue. Past the one-hour freshness bound on rabbit_files_delete_own (0027:348) the uploader cannot remove it either. After teardown, storage-gc's orphan scan resolves such a folder through projects then file_events (storage-gc/index.ts:193-201), both CASCADEd away, and correctly fails closed — index.ts:48-49 of operator-workspaces states this outcome outright. The teardown certificate then reports `blobs_found: paths.length` (index.ts:442) as if it were the full inventory. Separately, `removed += batch.length` (index.ts:385) counts a whole batch as removed on a non-error return without checking which objects actually existed.
required: |
  AS-3.15: proof of deletion must be accurate; certified disposal must be complete or the shortfall must be stated.
gap: |
  Orphaned pre-release blobs become permanently undisposable and permanently unattributable at the exact moment the platform certifies the tenant destroyed. The WIL-7005 certificate (index.ts:433-446) asserts a count with no qualifier, so the audit record reads as complete disposal when it is disposal of the discoverable subset. Note also that teardown proceeds to delete the workspace row even when `failed` is non-empty (index.ts:382-383 collects failures, index.ts:414 deletes regardless) — recoverable only because WIL-7006 preserved the literal paths.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-CONT-LIFECYCLE
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-CONT-015 — Purged content persists in nightly pg_dump backups; backup retention is an unenforced manual bucket setting

```yaml
id: TPN-CONT-015
severity: MEDIUM
control: AS-3.15
domain: content
title: Purged content persists in nightly pg_dump backups; backup retention is an unenforced manual bucket setting
location: C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/.github/workflows/backups.yml:18
evidence: |
  # Retention: configure a B2 lifecycle rule on the bucket ("keep only the
  # last 30 days" on prefix db/) rather than deleting from CI — lifecycle
  # rules survive repo/CI outages and a compromised CI key with delete rights
  # could otherwise purge history.
  The dump itself is unfiltered — backups.yml:88-91, `pg_dump "${DB_URL}" -Fc --no-owner | gzip`, with the comment 'Excludes nothing'. So every nightly object contains the ingestion_chunks.raw_text of client documents (see TPN-CONT-011) and the full metadata of files that have since been certified 'purged'.
required: |
  AS-3.15: proof-of-deletion must extend across backups and caches; retention periods stated and enforced.
gap: |
  The 'purged' certificate asserts destruction of content that demonstrably still exists in up to 30 nightly dumps on Backblaze B2. Nothing reconciles the two, and the retention that bounds the window is a console setting outside the repository — it cannot be verified from code, was not observable during this audit, and if it was never applied the dumps accumulate without limit. The reasoning for keeping deletion out of CI is sound; what is missing is a stated, verifiable backup retention that the disposal certificate can reference.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-CONT-LIFECYCLE
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-SDLC-001 — Hardcoded passwords in source (backdoor + default)

```yaml
id: TPN-SDLC-001
severity: RESOLVED
resolved_date: 2026-07-30
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

**Re-audit 2026-07-30 — RESOLVED.**

Current location: `n/a - code deleted; tombstone at C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON/electron/main.cjs:612-637`

Both literals are gone from all source. `git grep -nE "DILLYDALLY|MUTINY"` across the whole repo returns hits ONLY in TPN_AUDIT/{FINDINGS,SUMMARY,LEARNINGS,RECOMMENDATIONS}.md and in two historical UI-walkthrough rows of docs/sessions/SESSION_02_TO_03_CHECKLIST.md:366-367 that describe the now-deleted gate as a past UI state, not as a live credential. electron/main.cjs:612-637 is an explanatory tombstone that deliberately does NOT repeat the strings. src/components/PasswordScreen.jsx no longer exists (`ls` -> No such file). The on-disk artefact is also swept: cleanupLegacyAuthFile() at electron/main.cjs:2176 unlinks {userData}/otter-data/wilson-auth.json and is invoked at boot from electron/main.cjs:2475. The renderer fallback compare that the baseline cited is gone with the file. LEARNINGS.md's risk-accepted `MUTINY` offline fallback is therefore moot - the code carrying it was deleted.

---

## TPN-SDLC-002 — .gitignore does not exclude .env, keys, or credential files

```yaml
id: TPN-SDLC-002
severity: LOW
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

**Re-audit 2026-07-30 — PARTIALLY REMEDIATED.**

Current location: `C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON/.gitignore:6-9`

Severity revised to **LOW**.

Largely fixed. .gitignore:6-9 is now `# Env files - never commit. Only .env.example is tracked.` / `.env` / `.env.*` / `!.env.example`, plus `.supabase-access-token` at :16 and `.supabase/` + `supabase/.temp/` at :12-13. Verified empirically, not by reading: `git ls-files | grep -Ei '(^|/)\.env|\.pem$|\.key$|\.p12$|\.pfx$|supabase\.json|gdrive'` returns exactly one path, WILSON/.env.example; `git check-ignore -v WILSON/.env.local WILSON/.env.development` resolves both to .gitignore:8; `git log --oneline --all -- WILSON/.env.development WILSON/.env.local WILSON/.env` is empty, so no env file was ever committed. Residual gap: the baseline also named `*.pem`, `*.key`, `*.p12`, and there is still no compensating control - no pre-commit hook (`.git/hooks` contains only .sample files), no gitleaks/trufflehog job in either workflow, and no linter config at all (`git ls-files | grep -iE 'eslint|biome'` is empty). The exact slip this finding predicted has already happened, in a file class no ignore pattern could ever catch - a live admin password committed inside a tracked .md - see new TPN-SDLC-007. Severity drops HIGH->LOW because the mechanism (ignore rules) is now correct for every credential class actually present in the repo; the uncovered patterns match zero files.

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

**Re-audit 2026-07-30 — PARTIALLY REMEDIATED.**

Current location: `C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/.github/workflows/rls.yml:1 (and backups.yml:1)`

Severity revised to **HIGH**.

The 'no pipeline' half is resolved; the 'no scanning' half - which is the actual TS-4.0 control - is 100% open. CI now exists at the GIT ROOT: .github/workflows/rls.yml runs four jobs (pgTAP over supabase/tests/rls with a per-table coverage guard at rls.yml:56-84, an issue-session smoke probe against wilson-dev, Vitest at rls.yml:262-281, Playwright auth e2e), and backups.yml runs a nightly pg_dump to Backblaze B2. `find .github -type f` returns ONLY those two files - there is no dependabot.yml, no codeql.yml, no security.yml (LEARNINGS.md re-audit item #4 asks for .github/workflows/security.yml; it does not exist). Grepping both workflows for sonar|semgrep|checkmarx|snyk|codeql|trivy|grype|dependabot|checkov|tfsec|gitleaks|trufflehog|npm audit returns zero. So: no SAST, no SCA, no secret scanning, no DAST, no IaC scan - 5 of 5 categories absent. There is not even a linter (no ESLint/Biome config tracked), so nothing statically analyses the 7000-line DOG and 4000-line Otter files the baseline called out. Concrete live impact: running `npm audit` in WILSON/ right now reports **91 vulnerabilities (6 low, 27 moderate, 57 high, 1 critical)**, including xlsx prototype-pollution + ReDoS (GHSA-4r6h-8v6p-xvw6 / GHSA-5pgg-2g8v-p4x9, 'No fix available'), ws uninitialized-memory disclosure (GHSA-58qx-3vcg-4xpx), and Vite arbitrary-file-read (GHSA-p9ff-h696-f583). None of that is gated by anything. Effort now drops to XS-S because the workflow scaffolding exists - a CodeQL job and an `npm audit --audit-level=high` step are a few lines each.

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

**Re-audit 2026-07-30 — PARTIALLY REMEDIATED.**

Current location: `C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON/electron/env.cjs:52-67`

Severity revised to **MEDIUM**.

Real progress, but the baseline's own listed gaps are untouched and a new one opened. RESOLVED parts: three hosted Supabase projects (dev/staging/prod); a WILSON_ENV concept with a documented tri-state at .env.example:9 (`One of: development | staging | production`); electron/env.cjs:52-67 loadEnv() splitting packaged (userData/env.json) from dev (.env.development); surface separation at build time in vite.config.js:26-58 (`--mode admin` picks admin.html and stamps __WILSON_SURFACE__ so /wilson and /wilsonadmin cannot share a session key). STILL OPEN, verbatim from the baseline's gap text: (a) 'no build-time switch to disable the /api/fetch-url and /api/fetch-raw proxies in prod' - both are still mounted unconditionally at electron/main.cjs:640 and electron/main.cjs:677 with no isPackaged / WILSON_ENV guard; (b) 'strip the console.log statements' - vite.config.js has no `esbuild: { drop: ['console','debugger'] }` and no terser drop_console, so all 106 renderer console calls ship in prod bundles. Also note WILSON_ENV is load-bearing in name only: `grep -rn WILSON_ENV src electron supabase scripts` returns exactly ONE hit, electron/env.cjs:59, which merely defaults it - nothing in the app ever branches on it. The (c) part - production artefacts silently inheriting the developer's dev env - is materially new since baseline (there was no cloud backend in April) and is filed separately as TPN-SDLC-008.

---

## TPN-SDLC-005 — Exception details leaked in API responses

```yaml
id: TPN-SDLC-005
severity: LOW
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

**Re-audit 2026-07-30 — STILL OPEN.**

Current location: `C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON/electron/main.cjs:668 (baseline cited :658)`

Severity revised to **LOW**.

The exact pattern survives, at three sites, re-resolved: electron/main.cjs:668 `res.status(500).json({ error: e.message || 'Failed to fetch URL' });` (/api/fetch-url), electron/main.cjs:703 the identical line in /api/fetch-raw, and a third the baseline did not have, electron/main.cjs:2069 `res.status(500).json({ error: err.message || 'extract-pdf failed' });`. Partly improved: the three thumbnail routes now return a fixed string and keep the detail server-side (electron/main.cjs:1731-1732, :1765-1766, :1799-1800 log `err.message` to console and reply `{ error: 'thumbnail generation failed' }`). Downgraded MEDIUM->LOW on exposure, not on code: the baseline's escalation trigger was 'becomes HIGH once any of these routes are exposed off-machine', and that has NOT fired - electron/main.cjs:2079 now binds `expressApp.listen(0, '127.0.0.1', ...)`, i.e. loopback-only on an OS-assigned ephemeral port, and the network-facing Edge Functions on the unauthenticated path return opaque codes instead (supabase/functions/issue-session/index.ts:54,:67,:113 -> 'unauthorized'/'update_failed'; resolve-login/index.ts:103,:127,:148,:163,:171 -> a uniform `{ exists:false, email:null }` that does not even distinguish failure modes). Caveat carried, not re-filed: `expressApp.use(cors())` is still unparameterized at electron/main.cjs:143, which is TPN-NET-001's territory - if that is fixed the residual reachability here is nil, and if it is not, these three lines are the payload.

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

**Re-audit 2026-07-30 — STILL OPEN.**

Current location: `C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON/src/tools/deck-outline-generator_v0.514/LayoutVisualizer.jsx:67`

Severity revised to **LOW**.

Regressed in volume. Baseline counted 64 console.(log|error|warn) across 10 files in src/; the count is now **106 across 25 files** in src/, plus 10 in electron/ and 2 in supabase/functions/. The same file still dominates - src/tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx at 33 (was 36) - with src/tools/rabbit_v0.1.0/views/TeamView.jsx and ScenesView.jsx at 8 each. Nothing strips them: vite.config.js declares no esbuild.drop, so every one of these ships in dist/, dist-web/ and dist-vercel/. Severity stays LOW because the credential-hygiene check comes back clean - grepping every console call for token|key|secret|password|session|auth|jwt|credential|cipher yields only four hits, and all four log an `err.message` string rather than material (src/cloud/auth/LoginScreen.jsx:137, src/cloud/auth/supabaseClient.js:26 and :66). The one call that is content-bearing rather than error-bearing is the anchor above: LayoutVisualizer.jsx:67 `console.log('LayoutVisualizer - Raw:', rawLayoutType, '| Normalized:', layoutType, '| Key:', layoutKey, '| Title:', parsed.title);` - it prints a parsed deck slide title, i.e. potential client content, to the devtools console on every render of a production build. The baseline's remedy note ('replace with the structured logger once TPN-LOG-001 lands') is now actionable: app_events (migration 0021) and file_events (0027) exist, so there is somewhere for these to go.

---

## TPN-SDLC-007 — Live workspace-admin credential for the hosted wilson-dev project is published in the PUBLIC GitHub repo (docs + test-code fallback)

```yaml
id: TPN-SDLC-007
severity: CRITICAL
control: TS-1.14
domain: sdlc
title: Live workspace-admin credential for the hosted wilson-dev project is published in the PUBLIC GitHub repo (docs + test-code fallback)
location: WILSON/docs/sessions/SESSION_03_TO_04_CHECKLIST.md:46
evidence: |
  SESSION_03_TO_04_CHECKLIST.md:45-46 (a table of GitHub Actions secrets and their VALUES):
    | `DEV_PROBE_USERNAME` | `smoke_admin` |
    | `DEV_PROBE_PASSWORD` | `SmokeTest2026!` |
  
  Same file :285-286, next to the project URL:
    SUPABASE_URL="https://eqjzmnvkrakroyqxfsvw.supabase.co" \
    PROBE_USERNAME="smoke_admin" \
    PROBE_PASSWORD="SmokeTest2026!" \
  
  And hardcoded as a fallback in tracked test code:
    WILSON/tests/e2e/auth.spec.ts:33      const PASSWORD = process.env.WILSON_E2E_PASSWORD ?? 'SmokeTest2026!'
    WILSON/tests/e2e/web-path.spec.ts:22  const PASSWORD = process.env.WILSON_E2E_PASSWORD ?? 'SmokeTest2026!'
  
  The account's privilege is seeded in the same doc set:
    WILSON/docs/sessions/SESSION_02_TO_03_CHECKLIST.md:318  'admin', 'smoke_admin', 'Smoke Admin', true, now())
  
  Further occurrences: SESSION_03_TO_04_CHECKLIST.md:174, :254, :272, :306; SESSION_02_TO_03_CHECKLIST.md:298, :370.
  
  Repo is public and these paths are tracked and pushed:
    git remote -v            -> origin https://github.com/pretty-aud/wilson.git
    git ls-files --error-unmatch <all four paths> -> all four resolve
    git status -sb           -> ## feat/multi-user-v1...origin/feat/multi-user-v1
required: |
  TS-1.14: no secrets in source. Credentials must resolve at runtime from a secrets manager (the repo already does this correctly for CI - .github/workflows/rls.yml:147-148 reads ${{ secrets.DEV_PROBE_* }}). Every account must be uniquely attributable and revocable (OR-3.x). AS-1.0 additionally forbids shared credentials across environments.
gap: |
  `smoke_admin` / `SmokeTest2026!` is a LIVE, non-expiring, workspace-`admin` account on the hosted wilson-dev Supabase project (https://eqjzmnvkrakroyqxfsvw.supabase.co), and both halves are readable by anyone on the internet. The anon key needed to complete the sign-in is public by design and ships in the web bundle, so the published pair is directly usable against the real endpoint - this is not a local fixture. Worse, the documentation actively prevents rotation: SESSION_03_TO_04_CHECKLIST.md:174 and :272 instruct the operator to 'rotate it back to `SmokeTest2026!` so the CI probe keeps working', and :306 tells them to re-seed it if it drifted. So the secret is deliberately pinned. The GitHub Actions secrets (DEV_PROBE_USERNAME/DEV_PROBE_PASSWORD) exist and are wired correctly, which makes the plaintext copy in the docs pure, avoidable exposure. Two aggravating couplings: (1) the e2e specs fall back to the literal when WILSON_E2E_PASSWORD is unset, so the value is in code, not only prose; (2) per TPN-SDLC-008 the desktop production build points at this same wilson-dev project, so a shipped installer's data would sit in an environment whose admin password is published. Note this is exactly the residual risk TPN-SDLC-002 predicted, realised in a file class (.md) that no .gitignore pattern can catch - only a secret scanner (TPN-SDLC-003) would have.
effort: S
blocks_tier: Silver
recommendation_ref: RECO-SDLC-SECRETS
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

Merged into this finding during the re-audit (same defect, reported from another domain pass): `TPN-ENC-012`.

---

## TPN-SDLC-008 — Production desktop build silently inherits the developer's DEV environment - no .env.production, and the runtime env.json override cannot repoint the renderer

```yaml
id: TPN-SDLC-008
severity: HIGH
control: AS-1.0
domain: sdlc
title: Production desktop build silently inherits the developer's DEV environment - no .env.production, and the runtime env.json override cannot repoint the renderer
location: WILSON/package.json:19
evidence: |
  package.json:19  "build": "vite build",
  package.json:30-33
    "package":      "npm run build && electron-forge package",
    "make":         "npm run build && electron-forge make",
    "dist":         "npm run build && electron-builder --win nsis",
    "dist:publish": "npm run build && electron-builder --win nsis --publish always"
  
  `vite build` with no --mode runs mode=production, whose env-file precedence is
  .env.production.local > .env.local > .env.production > .env. On disk (`ls -la .env*`):
    .env.development   present (dev)
    .env.example       present (template)
    .env.local         present  <-- the ONLY file production mode will find
    .env.production    ABSENT (`ls .env.production` -> No such file or directory)
  
  .env.local:4  WILSON_ENV=development
  .env.local:6  # wilson-dev (project ref: eqjzmnvkrakroyqxfsvw)
  .env.local:7  VITE_SUPABASE_URL=https://eqjzmnvkrakroyqxfsvw.supabase.co
  
  The values are compile-time-substituted and cannot be overridden later:
    src/cloud/auth/supabaseClient.js:21-22
      const url  = import.meta.env.VITE_SUPABASE_URL
      const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
    electron/preload.cjs:47-49 (comment, correct)
      // src/cloud/auth/supabaseClient.js is configured by VITE_SUPABASE_URL
      // + VITE_SUPABASE_ANON_KEY at build time
  
  ...which contradicts the runtime-swap claim the env loader advertises:
    electron/env.cjs:6-7   // Packaged: reads app.getPath('userData')/env.json so operators can swap
                           //           envs without a rebuild.
    electron/env.cjs:59    if (!env.WILSON_ENV) env.WILSON_ENV = isPackaged ? 'production' : 'development';
  
  The behaviour is already documented as known:
    docs/WEB_DEPLOY.md:21-23  "The build embeds VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from the
     usual env files - `.env.local` on this machine points at **wilson-dev**, so the test host talks to dev."
required: |
  AS-1.0: strict dev / test / prod separation; no production data in lower environments; production builds must be reproducible and provably targeted at the production backend. A release artefact's backend binding must be an explicit, verified build input - not whatever happens to be left in a developer's working tree.
gap: |
  There is no .env.production and nothing asserts one. Because `npm run dist` / `dist:publish` chain through the bare `vite build`, the Windows NSIS installer that gets published to https://updates.petalstudios.co/wilson is compiled against whatever .env.local holds on the build machine - today, wilson-dev (project ref eqjzmnvkrakroyqxfsvw), the same environment whose admin password is public per TPN-SDLC-007. Every end user's WILSON content would be written into the development Supabase project. env.cjs's userData/env.json escape hatch does not help: it only populates process.env in the MAIN process, while the renderer's Supabase URL/anon key are frozen into the bundle by Vite at build time (preload.cjs:47-49 states this plainly), so the advertised 'swap envs without a rebuild' is false for the entire data plane. The failure is silent in both directions - if .env.local were deleted instead, the build would produce a bundle with no Supabase URL at all and only a console.error at boot (supabaseClient.js:24-27). Nothing in package.json, vite.config.js, forge.config.cjs or vercel.json validates WILSON_ENV before packaging. (The Vercel web path is not affected: .env.local is gitignored so it is absent from the Vercel checkout, and VITE_* values are injected as build-time project env vars per docs/WEB_DEPLOY.md - which is precisely the pattern the desktop build lacks.)
effort: S
blocks_tier: Gold
recommendation_ref: RECO-SDLC-CI
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-SDLC-009 — Release artefacts are unsigned and the auto-update feed is repointable from a user-writable file, so downloaded updates have no integrity anchor

```yaml
id: TPN-SDLC-009
severity: HIGH
control: TS-4.0
domain: sdlc
title: Release artefacts are unsigned and the auto-update feed is repointable from a user-writable file, so downloaded updates have no integrity anchor
location: WILSON/package.json:90
evidence: |
  package.json:90-105 - the entire Windows build + publish config, with no signing key of any kind:
      "win": {
        "target": [ "nsis" ],
        "icon": "public/logo.ico"
      },
      "nsis": { "oneClick": true, "perMachine": false, "deleteAppDataOnUninstall": false },
      "publish": [ { "provider": "generic", "url": "https://updates.petalstudios.co/wilson" } ]
  
  Grepping package.json, forge.config.cjs, electron/ and docs/*.md for
  certificateFile|CSC_LINK|signtool|windowsSign|osxSign|publisherName|verifyUpdateCodeSignature|codesign
  returns ZERO hits.
  
  The feed is then overridable at runtime from a plain file in userData:
    electron/updater.cjs:41  const feedUrl = process.env.WILSON_UPDATE_URL || null;
    electron/updater.cjs:61-63
      if (feedUrl) {
        try { autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
    electron/updater.cjs:60  autoUpdater.autoInstallOnAppQuit = true;
  
  WILSON_UPDATE_URL is sourced from an unauthenticated JSON file the user (or any
  process running as the user) can edit:
    electron/env.cjs:40-48  loadPackaged() -> JSON.parse(fs.readFileSync(path.join(userDataDir,'env.json')))
    electron/env.cjs:62-64  for (const [k,v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;
required: |
  TS-4.0 / AS-1.0: build and release integrity. Distributed binaries must be code-signed, and an auto-update channel must verify the publisher signature of the payload before execution. A software provider shipping to studio endpoints must be able to attest that the running binary is the one it built.
gap: |
  Two defects that compound into an arbitrary-code-execution path. (1) Nothing signs the NSIS installer - electron-builder's win block has no certificateFile/signtoolOptions and no CSC_* is referenced anywhere in the repo or its docs, so `npm run dist:publish` emits an unsigned .exe. electron-updater's Windows publisher check (verifyUpdateCodeSignature) only has something to compare against when the installed app is itself signed; on an unsigned app it is skipped, leaving the generic provider's sha512-in-latest.yml as the sole integrity check - and latest.yml is fetched from the same host as the payload, so it is not an independent anchor. (2) The feed host is not pinned: updater.cjs:41 reads WILSON_UPDATE_URL out of process.env, which env.cjs:40-64 populates from {userData}/env.json - a file with ordinary user write permissions and no signature or schema validation. Anyone who can write one JSON key in the user's profile (malware, a shared machine, a restored backup) repoints the update channel to a host they control; updater.cjs:60 has autoInstallOnAppQuit = true, so the substituted installer runs at next quit. The intent is documented as an operator convenience (updater.cjs:5-8) but no operator-vs-attacker distinction is enforced. This is a supply-chain surface that did not exist at baseline - electron-updater landed in S9, after the April audit.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-SDLC-CI
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-SDLC-010 — Raw Postgres/GoTrue exception text returned as a `detail` field by internet-facing Edge Functions

```yaml
id: TPN-SDLC-010
severity: MEDIUM
control: AS-1.0
domain: sdlc
title: Raw Postgres/GoTrue exception text returned as a `detail` field by internet-facing Edge Functions
location: WILSON/supabase/functions/admin-create-user/index.ts:114
evidence: |
  supabase/functions/admin-create-user/index.ts:114
    return reply({ error: 'membership_create_failed', detail: memErr.message }, 500)
  supabase/functions/admin-reset-password/index.ts:44
    if (updErr) return reply({ error: 'reset_failed', detail: updErr.message }, 502)
  supabase/functions/admin-set-active/index.ts:82
    return reply({ error: 'update_failed', detail: updErr.message }, 500)
  supabase/functions/invite-member/index.ts:188
    return reply({ error: 'membership_create_failed', detail: memErr.message }, 500)
  supabase/functions/operator-workspaces/index.ts:186, :246, :305, :338, :371, :427-429
    return reply({ error: 'list_failed',     detail: error.message }, 500)
    return reply({ error: 'teardown_failed', detail: delErr.message, blobs_removed: removed }, 500)
  supabase/functions/operator-ai-keys/index.ts:117, :153, :166
    return reply({ error: 'encrypt_failed', detail: String((err as Error).message ?? err) }, 500)
  supabase/functions/provision-workspace/index.ts:265
    return reply({ error: taken ? 'email_taken' : 'user_create_failed', detail: userErr?.message ?? 'unknown' }, taken ? 409 : 500)
required: |
  AS-1.0: exception handlers must not return internals to callers. Error responses carry a stable machine code; the diagnostic text belongs in the server-side event stream (app_events / platform_audit already exist for exactly this).
gap: |
  Twelve-plus handlers across seven Edge Functions append the upstream driver's raw message to the HTTP body. Unlike the Express sites in TPN-SDLC-005, these endpoints are on the public internet (https://<ref>.supabase.co/functions/v1/...). Postgres errors carry schema, table, column and constraint names plus SQLSTATE, and GoTrue admin errors describe account state - so a caller who can reach the endpoint can map the data model and probe account existence one failed call at a time, which is a much better oracle than the intentionally uniform responses the pre-auth functions were built with (resolve-login/index.ts returns an identical `{ exists:false, email:null }` on five distinct failure paths precisely to avoid this). Mitigating and why this is MEDIUM not HIGH: every one of these sites sits behind adminGuard (workspace admin + aal2) or operatorGuard (platform tier + hard MFA), so the caller is already privileged and the leak is post-authentication; and the same functions already log richer context server-side, so the client copy is redundant rather than necessary. Fix is mechanical - drop `detail` from the response and keep it in the audit write that is usually already on the adjacent line (e.g. operator-workspaces/index.ts:427 logs `context: { error: delErr.message }` immediately before returning it at :429).
effort: XS
blocks_tier: Gold Star
recommendation_ref: RECO-SDLC-CI
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

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

**Re-audit 2026-07-30 — NOT RE-ASSESSED.** This is a policy/process finding with no code location; the re-audit covered the nine code-bearing domains. It remains open.

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

**Re-audit 2026-07-30 — NOT RE-ASSESSED.** This is a policy/process finding with no code location; the re-audit covered the nine code-bearing domains. It remains open.

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

**Re-audit 2026-07-30 — NOT RE-ASSESSED.** This is a policy/process finding with no code location; the re-audit covered the nine code-bearing domains. It remains open.

---

## TPN-AI-001 — Client content reaches public Anthropic endpoint with no policy gate, redaction, or approval check

```yaml
id: TPN-AI-001
severity: HIGH
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

**Re-audit 2026-07-30 — PARTIALLY REMEDIATED.**

Current location: `supabase/functions/ai-proxy/index.ts:46 (was src/App.jsx:649)`

Severity revised to **HIGH**.

The DELIVERY MECHANISM is genuinely fixed; the OR-5.0 CONTROL is not.

RESOLVED half — verified by direct search, not by trusting the changelog:
- `anthropic-dangerous-direct-browser-access` returns ZERO hits in code repo-wide (only historical prose in WILSON/docs/sessions/SESSION_12_prompt.md:68). LEARNINGS.md re-audit check #2 passes.
- `api.anthropic.com` appears in exactly TWO files, both server-side Deno Edge Functions: supabase/functions/ai-proxy/index.ts:46 and supabase/functions/operator-ai-keys/index.ts:37. No renderer, no Electron main file, no adapter reaches Anthropic — `rg -ni "anthropic|claude-|callAI" electron/` returns zero.
- No client holds a key. src/App.jsx:233-234 actively PURGES the legacy credential (`localStorage.removeItem('wilson-api-key')` + `'deck-outline-generator-api-key'`) on every boot; no `setItem` of any api-key exists anywhere. LEARNINGS check #3 passes.
- All 15 model call sites (DeckOutlineGenerator.jsx x8, Otter.jsx:797, Validator.jsx:24, AgentProvider.jsx:373, App.jsx:803, pipeline.js:275/:365) route through the single helper src/cloud/aiProxy.js:62 `callAI()`, which attaches only the user's Supabase session JWT. aiProxy.js:20 states there is no direct fallback on either host.
- The gateway is a real policy enforcement point: requireActiveMember (memberGuard.ts:30, live workspace_members row check, not just the token claim), durable cross-isolate rate limit (index.ts:190), and an upstream-body WHITELIST at index.ts:218-225 so a client cannot smuggle arbitrary fields or a key.
- Prompt content is NOT logged. logUsage (index.ts:103-120) writes only model, tool, input_tokens, output_tokens, stop_reason, key_source into app_events.context. Verified by reading the whole insert — no message, system, or messages field reaches any log sink.

STILL-OPEN half — OR-5.0 asks for more than key custody:
1. NO REDACTION / MINIMIZATION. src/tools/rabbit_v0.1.0/intake/pipeline.js:357 sends production documents verbatim: `const userMessage = \`Chunk text:\n\n${chunk.raw_text}\``. `rg -ni "redact|minimi[sz]ation"` across the repo returns zero hits outside package-lock noise. A shooting schedule or script still leaves the boundary in full.
2. NO PER-CLIENT AI-USE APPROVAL. There is no ai_enabled / ai_approved / consent column anywhere — `rg -ni "ai_enabled|ai_approved|allow_ai|ai_consent" supabase/migrations/` returns zero, and public.workspaces (0001_workspaces_and_users.sql:17-35) has no such field. ai-proxy/index.ts:77-78 falls back to the platform ANTHROPIC_API_KEY for ANY workspace, so AI egress is ON BY DEFAULT for every tenant with no approval artifact.
3. THE ENDPOINT IS STILL PUBLIC. OR-5.0's Best Practice is an internally-managed, sandboxed model for pre-release content. api.anthropic.com is a public multi-tenant endpoint; no zero-retention / no-training contractual reference exists in-repo.

CRITICAL -> HIGH: the exfiltration-grade defect (a key in localStorage plus browser-origin calls any renderer script could hijack) is gone, and the gateway makes the remaining fixes config-level. What remains is a policy and scope gap, not an uncontrolled credential.

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

**Re-audit 2026-07-30 — STILL OPEN.**

Current location: `n/a - policy artifact absent (repo root + WILSON/docs/)`

No AI policy document exists. Enumerated the filesystem rather than grepping for a name: git root C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/ contains exactly ONE file, README.md (2316 bytes, unmodified since 2026-04-14 — i.e. predates every cloud session). WILSON/ root has zero .md files. WILSON/docs/ contains only MASTER_PLAN.md, ORIGINAL_BRIEF_multiuser.md, OWED_AUDREY.md, WEB_DEPLOY.md, plus docs/sessions/. `rg -li "AI_POLICY|ai-usage-policy|OR-5.0"` repo-wide returns zero.

I checked for the control rather than the prescribed filename (per the trap note), and there is no substitute artifact either: nothing states the allowed models, the permitted use cases, the data-handling rules, the client-approval workflow, or the developer AI-training requirement. The allowed-model set is effectively defined by scattered string literals (claude-sonnet-4-20250514 in AgentProvider.jsx:374 and Otter.jsx:1210; claude-haiku-4-5-20251001 in pipeline.js:275 and operator-ai-keys/index.ts:40) with no server-side model allowlist in ai-proxy — index.ts:199 accepts any client-supplied model string, slicing it to 100 chars purely to satisfy an app_events CHECK constraint.

Severity unchanged at HIGH. This is now the single largest blocker in the AI domain, because the gateway built in S12/S15 is the enforcement point that a written policy would finally have something to enforce against.

---

## TPN-AI-003 — AI responses are not lifecycle-tracked

```yaml
id: TPN-AI-003
severity: MEDIUM
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

**Re-audit 2026-07-30 — PARTIALLY REMEDIATED.**

Current location: `supabase/migrations/0022_otter_content.sql:124,206 + 0014_soft_delete.sql:304,342 (was src/agent/AgentProvider.jsx:367)`

Severity revised to **MEDIUM**.

Substantially remediated by a DIFFERENT mechanism than the plan named — model output now inherits the general content lifecycle instead of getting an AI-specific TTL.

What changed (verified in code, not assumed):
- The baseline's stated harm was 'a permanent unencrypted copy in IndexedDB with no lifecycle'. That store is now DEAD: src/storage.js still exists but has ZERO importers — `rg -n "from './storage'|from '../storage'"` across src/ returns nothing, and App.jsx contains no saveProjects/loadProjects call. AI output no longer lands there.
- Agent chat responses are ephemeral React state only. AgentProvider.jsx:58 holds them in useState; there is no localStorage/IndexedDB/adapter write in that file (the only persistence hit is a comment at line 70). History is additionally capped at MAX_HISTORY=30 / MAX_MSG_CHARS=3000 (AgentProvider.jsx:355-357).
- O.T.T.E.R. generated content persists to public.otter_courses / public.otter_subjects, which DO carry lifecycle: deleted_at columns at 0022_otter_content.sql:124 and :206, partial trash indexes at :164 and :232 explicitly commented 'Supports the 30-day purge sweep', and the hard-delete sweep public.purge_soft_deleted() at 0014_soft_delete.sql:304 scheduled nightly as 'wilson-purge-soft-deleted' at 0014:342. RABBIT intake output materializes into the same soft-delete family. So retention and certified disposal now exist, backed by file_events (0027) deletion certificates.
- Usage telemetry rows are content-free (ai-proxy/index.ts:112-119), so the app_events 90-day purge (0021:147) disposes of no content.

What is STILL open — the specific binding the finding named:
- NO AI PROVENANCE. `rg -ni "ai_generated|generated_by|is_ai|source_model|provenance" supabase/migrations/` returns only fork-lineage hits (0022:113, 0022:791, 0025:92, 0025:426). Nothing records that a row is model output, so no query can enumerate AI-derived content for a takedown.
- NO SOURCE-ASSET BINDING. The baseline's exact scenario is unfixed: an intake PDF analysed at pipeline.js:357 produces entities that carry no link back to the originating file's id, so hard-deleting the source asset (and issuing its file_events deletion certificate) does not reach, flag, or purge the model's derived copy of the same material.

HIGH -> MEDIUM: the data now sits inside a governed, RLS-enforced, purge-swept store instead of an unencrypted browser DB. The residue is a traceability gap (provenance + lineage), not an unbounded retention gap.

---

## TPN-AI-004 — ai-proxy forwards client-supplied `tools` and `betas` verbatim — WILSON content reaches a fourth-party search provider via Anthropic server-side web_search

```yaml
id: TPN-AI-004
severity: HIGH
control: OR-5.0
domain: ai_ml
title: ai-proxy forwards client-supplied `tools` and `betas` verbatim — WILSON content reaches a fourth-party search provider via Anthropic server-side web_search
location: supabase/functions/ai-proxy/index.ts:225
evidence: |
  ai-proxy/index.ts:218-225 whitelists the upstream body but passes the tools array through unfiltered:
    const upstreamBody: Record<string, unknown> = { model, max_tokens: maxTokens, messages, stream: true }
    if (body.system != null) upstreamBody.system = body.system
    if (Array.isArray(body.tools) && body.tools.length > 0) upstreamBody.tools = body.tools
  and index.ts:213 + :241 relay any client string as the beta header:
    const betas = typeof body.betas === 'string' ? body.betas : null
    if (betas) upstreamHeaders['anthropic-beta'] = betas
  
  This is not hypothetical — four live call sites enable Anthropic's SERVER-SIDE web-search tool:
    src/tools/otter_v0.3.1/Validator.jsx:305  tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }]
    src/tools/otter_v0.3.1/Otter.jsx:1215/:1447/:1675  same tool, betas: 'web-search-2025-03-05'
  Validator.jsx:302 builds the user message from workspace content verbatim:
    const userMessage = `Validate the following lesson:\n\nTitle: ${lesson.title}\n\nContent:\n${lesson.content}...`
  and Otter.jsx:1199-1203 appends user-supplied reference text before the same call.
required: |
  OR-5.0: pre-release content may only reach internally-managed, sandboxed models; any public-AI use needs explicit studio approval and a data-source integrity review. OR-3.4: every third party that handles content must be enumerated, risk-rated and contractually covered — that includes sub-processors reached transitively.
gap: |
  A server-side tool is not a local function call: the model formulates queries from the prompt content and Anthropic executes them against an external search index, so lesson bodies, titles and user-supplied reference material generate a SECOND egress hop to a provider that appears nowhere in WILSON's data-flow story. The gateway built in S12 to be the one controllable boundary hands that decision to the client. Three compounding problems: (1) no allowlist — a rogue or compromised member client can declare any Anthropic server-side tool (code execution, future connectors) and ai-proxy will forward it; (2) no per-workspace toggle, so a tenant cannot refuse the search hop while keeping AI; (3) app_events records model/tokens (index.ts:112-119) but never that a tool was invoked, so the search egress is invisible to the audit stream and to the operator console's spend view. There is no sub-processor register naming the search provider (TPN-3P-003 is still open).
effort: S
blocks_tier: Gold
recommendation_ref: RECO-AI-POLICY
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-AI-005 — Per-workspace key resolution fails soft to the platform key — a tenant's content silently re-routes onto the platform's Anthropic account

```yaml
id: TPN-AI-005
severity: HIGH
control: OR-5.0
domain: ai_ml
title: Per-workspace key resolution fails soft to the platform key — a tenant's content silently re-routes onto the platform's Anthropic account
location: supabase/functions/ai-proxy/index.ts:76
evidence: |
  resolveAnthropicKey (ai-proxy/index.ts:55-79) wraps the entire per-workspace lookup in a bare catch and then unconditionally falls back:
    } catch { /* fall through to platform key */ }
    const platform = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
    return platform ? { key: platform, source: 'platform' } : null
  The soft-fail is also taken on the non-throwing paths: line 72 requires `!error && data?.key_ciphertext`, and line 74 requires decryptAiKey to return truthy, so a rotated/absent WILSON_AI_KEY_SECRET (aiKeyCrypto.ts:64 throws AiKeyCryptoUnavailable) or an envelope this build cannot open lands in the same fallback. The code comment at index.ts:60-66 states the intent explicitly: 'a tenant key is a billing preference, not an authorization boundary'.
  
  The operator-side code disagrees with that framing. operator-ai-keys/index.ts:18-21 calls out this exact path as 'the expensive failure mode' — 'with ai-proxy's fail-soft quietly spending the PLATFORM key in the meantime'.
required: |
  OR-5.0: per-client AI-use approval. Where a client has approved a specific AI relationship, content must flow only under that relationship. The approved processor, its retention terms and its DPA are properties of the client's approval, not a billing preference.
gap: |
  A workspace that provisions its own Anthropic key is asserting a content-processing boundary — its own Anthropic account, its own zero-retention/no-training terms, its own DPA and its own logs. When the lookup soft-fails, the same pre-release content is transparently processed under the PLATFORM's Anthropic account instead, with no error, no user-visible signal, and no admin alert. The only trace is a key_source:'platform' value buried in app_events.context (index.ts:118) that no code alerts on. A single operator secret rotation therefore moves every tenant's content across a contractual boundary at once. Compounding it, there is no ai_enabled/ai_approved flag anywhere (verified absent from public.workspaces, 0001_workspaces_and_users.sql:17-35), so the platform key is not a fallback for approved tenants — it is the DEFAULT for every tenant that never made an AI decision at all.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-AI-POLICY
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-AI-006 — No token ceiling or request-size bound on the AI gateway; the only abuse control fails open

```yaml
id: TPN-AI-006
severity: MEDIUM
control: AS-3.8
domain: ai_ml
title: No token ceiling or request-size bound on the AI gateway; the only abuse control fails open
location: supabase/functions/ai-proxy/index.ts:200
evidence: |
  ai-proxy/index.ts:200-208 validates that max_tokens is a number and is not below 1, but sets no upper bound and applies no cap to the messages payload:
    const maxTokens = typeof body.max_tokens === 'number' ? body.max_tokens : 0
    const messages = Array.isArray(body.messages) ? body.messages : null
    if (!model || !maxTokens || maxTokens < 1 || !messages || messages.length === 0) { ... 400 }
  Contrast the disciplined caps applied to the fields that touch a DB CHECK — model is sliced to 100 (index.ts:199) and tool to 40 (index.ts:213) — while the two fields that determine the bill are unbounded. The model string itself is unconstrained, so any Anthropic model can be selected regardless of cost tier.
  
  The sole remaining control is the 60/min per-workspace fixed window (index.ts:52, :190), and _shared/rateLimit.ts:57-66 fails OPEN by design:
    console.error(`rate-limit RPC failed (${bucket}): ${error.message}`)
    return false
required: |
  AS-3.8: rate limiting and abuse controls on public-facing endpoints. OR-5.0: AI use must be bounded and monitored, not open-ended, on any surface where content processing is billed and where volume itself is a signal of misuse.
gap: |
  One authenticated member of any workspace can request the largest max_tokens the chosen model permits, with an arbitrarily large messages array, 60 times a minute, on a key they never see — billed to the platform. Beyond cost, an unbounded messages payload is the cheapest possible bulk-exfiltration channel: pushing an entire content library through the model in a handful of oversized requests looks identical to normal use in app_events, which records only token counts. rateLimit.ts's fail-open choice is well argued for an availability tradeoff (and correctly contrasted with operatorGuard's fail-closed), but it means a persistently failing RPC silently removes the ONLY quantitative bound on this endpoint — the header comment concedes the console.error line is the sole signal. There is no per-workspace daily/monthly spend cap and no alerting rule on WIL-6001 volume.
effort: XS
blocks_tier: Gold Star
recommendation_ref: RECO-AI-POLICY
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-AI-007 — No data-source integrity review: untrusted document and URL text enters prompts that can drive automated writes to workspace content

```yaml
id: TPN-AI-007
severity: MEDIUM
control: OR-5.0
domain: ai_ml
title: No data-source integrity review: untrusted document and URL text enters prompts that can drive automated writes to workspace content
location: src/tools/rabbit_v0.1.0/intake/pipeline.js:357
evidence: |
  Three untrusted inputs reach the model with no provenance handling or instruction/data separation:
    1. src/tools/rabbit_v0.1.0/intake/pipeline.js:357 — arbitrary uploaded production documents (PDF/DOCX/PPTX), verbatim:
         const userMessage = `Chunk text:\n\n${chunk.raw_text}`
       whose JSON response is parsed at pipeline.js:326 and materialized into RABBIT entities.
    2. src/tools/otter_v0.3.1/Otter.jsx:1199-1203 (repeated at :1434-1438 and :1662-1666) — text fetched from user-supplied URLs, injected with an explicit trust instruction:
         userMessage += `\n\n--- REFERENCE MATERIAL (from user-provided URLs) ---\n`;
         ...
         userMessage += `\nUse the above reference material as primary sources. Cite them where relevant.\n`;
    3. src/agent/AgentProvider.jsx:214 — model-proposed edits applied with no human review once the operator opts in:
         if (autoApprove === 'all' || (autoApprove === 'minor' && totalChars < 20)) { applyEdit(action); return }
       reached from handleAgentAction(parsed.action) at AgentProvider.jsx:398.
required: |
  OR-5.0 explicitly requires a DATA-SOURCE INTEGRITY REVIEW for AI/ML use — the provenance and trustworthiness of everything entering a model must be assessed, particularly where model output drives changes to managed content.
gap: |
  Text lifted from an emailed document or a fetched web page is concatenated into the same channel as WILSON's own instructions, then the model's structured reply is executed. With autoApprove='all' the loop closes: attacker-controlled text inside an ingested file or a referenced page can steer edits that are written to workspace content without a human ever seeing them, and the resulting change is attributed in edit_history to the member who ran the agent. Nothing marks any of these inputs as untrusted, and the Otter path actively elevates them ('use as primary sources'). Mitigating and why this is MEDIUM not HIGH: the default is safe — AgentProvider.jsx:58 initialises autoApprove to 'always_ask', SettingsPage.jsx:849 gates a warning on the 'all' setting, edits are reversible via the undo stack (AgentProvider.jsx:409) and edit_history, and the JSON envelope parser (pipeline.js:326) constrains the intake response shape. The finding is the missing REVIEW and the missing trust boundary, not a live unauthenticated exploit.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-AI-POLICY
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-CLOUD-001 — Supabase project shipped with RLS disabled per in-repo guidance

```yaml
id: TPN-CLOUD-001
severity: LOW
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

**Re-audit 2026-07-30 — PARTIALLY REMEDIATED.**

Current location: `src/tools/rabbit_v0.1.0/db/README.md:53, :56, :58 (original location src/tools/rabbit_v0.1.0/adapters/supabaseAdapter.js:13 no longer contains the comment)`

Severity revised to **LOW**.

The TECHNICAL control is fully remediated — verify the control, not the artifact. (a) The flagged adapter comment is GONE: supabaseAdapter.js:1-45 now documents build-time VITE_* creds, a shared authed client, and 'every query now carries the user's JWT and is scoped by RLS (see supabase/migrations/0004_rls_rabbit.sql)'. There is no adapter-owned credential state and no service-role key on the client path. (b) RLS is genuinely on everywhere: every table created in migrations 0000/0001/0009-0028 has ALTER TABLE ... ENABLE ROW LEVEL SECURITY (61 statements; I diffed CREATE TABLE against ENABLE and the difference set is empty — public.users, the one table that never had RLS, was DROPped in 0023). 28 of them additionally carry FORCE ROW LEVEL SECURITY; the four that do not (edit_history, file_events, storage_gc_queue, auth_attempt_log) are deliberate — 0027:110-111 and 0028:155-156 state FORCE would break the SECURITY DEFINER capture triggers that are the only writers, and storage_gc_queue/edge_rate_limits have RLS on with ZERO policies plus REVOKE ALL FROM anon, authenticated. (c) Tenancy is pinned by tests: supabase/tests/rls/01..36 and .github/workflows/rls.yml:50-77 fail CI if a table in 0004 has no matching test file. (d) Migrations 0027:395-489 and 0028:397-489 end in DO $$ post-condition blocks that RAISE if RLS/FORCE/policy-count/privilege invariants did not land — including 0028:481-484 asserting the cross-tenant reader is service_role-only. RESIDUAL, documentation only: src/tools/rabbit_v0.1.0/db/README.md still ships the RLS-off instruction the finding named — line 53 'this works fine with anon-only auth as long as RLS is left disabled (see §4)', line 56 heading '## 4. Row-level security (v0.1: disabled)', line 58 'RABBIT v0.1 ships with **RLS disabled** for single-user simplicity. The service-role key is NOT required and an anon key alone is enough.' A blockquote at :63-66 supersedes it, and README §2 (:20-34) records that the standalone-Supabase deployment path is unreachable (creds are build-time), so nobody can act on the instruction — but LEARNINGS.md re-audit item 8 ('Supabase adapter comment about RLS-off default must be gone') is satisfied only for the adapter, not the README, and an assessor reading §3/§4 sees a heading that says RLS is off. Downgraded HIGH -> LOW: assessor-visible stale guidance, no exploitable path.

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

**Re-audit 2026-07-30 — STILL OPEN.**

Current location: `supabase/migrations/0027_file_lifecycle.sql:287-291 (rabbit-files bucket creation, no encryption config) and supabase/migrations/0009_perms_and_provisioning.sql:92-103 (user-avatars); no docs/KEY_MANAGEMENT.md exists anywhere in the repo`

No CMK, and no CMK guidance, for either storage bucket. rabbit-files is created at 0027:287-291 with only (id, name, public, file_size_limit) — no encryption configuration of any kind, so it rides Supabase's provider-managed AES-256 default; user-avatars at 0009:92-103 is the same. Grepping the whole repo for CMK/customer-managed/KMS returns hits ONLY inside TPN_AUDIT/*.md (the baseline's own text). There is no docs/KEY_MANAGEMENT.md, no SECURITY.md and no HARDENING.md — find -maxdepth 3 -iname '*.md' returns docs/MASTER_PLAN.md, ORIGINAL_BRIEF_multiuser.md, OWED_AUDREY.md, WEB_DEPLOY.md, docs/sessions/*, TPN_AUDIT/* and nothing else. RECOMMENDATIONS.md:595 asked for exactly that file and it was never written. ADJACENT PROGRESS that does NOT close this finding: S15 added real key separation for ONE column — supabase/functions/_shared/aiKeyCrypto.ts:62-99 does AES-256-GCM with the DEK held in the WILSON_AI_KEY_SECRET Edge-Function secret and never in Postgres (0028:20-29 gives the driver: the nightly pg_dump ships to Backblaze B2, so a plaintext key column would export every tenant's Anthropic credential off-platform). That is genuine data/key separation, but it (i) covers workspace_ai_keys only, not the blob store this finding is about, (ii) is ONE platform-wide DEK shared by all tenants rather than a per-tenant CMK, and (iii) is not KMS/HSM-backed and has no documented rotation runbook (key_version exists at 0028:147 but nothing rotates it). Severity unchanged at MEDIUM: the Best Practice (AES-256 at rest) is met by the provider default; the CS-1.13 Additional Recommendation (per-tenant CMK, keys stored separately from data) is still unaddressed and still undocumented.

---

## TPN-CLOUD-003 — workspaces_write_operator is FOR ALL — a platform operator can hard-delete any tenant straight from PostgREST, bypassing the operator guard, MFA, the blob sweep and the platform_audit certificate

```yaml
id: TPN-CLOUD-003
severity: RESOLVED
resolved_date: 2026-07-30
control: CS-1.13
domain: cloud
title: workspaces_write_operator is FOR ALL — a platform operator can hard-delete any tenant straight from PostgREST, bypassing the operator guard, MFA, the blob sweep and the platform_audit certificate
location: supabase/migrations/0002_rls_workspaces.sql:29-43
evidence: |
  CREATE POLICY workspaces_write_operator ON public.workspaces
    FOR ALL
    USING (EXISTS (SELECT 1 FROM public.platform_operators po WHERE po.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.platform_operators po WHERE po.user_id = auth.uid()));
  
  FOR ALL covers DELETE. Supporting facts, each verified: (1) 0011_role_grants.sql:21 does GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role and 0011:26-27 sets the same as a DEFAULT PRIVILEGE, so the authenticated role holds DELETE on public.workspaces and RLS is the only boundary — the file says so at :11 ('Grants are NOT the security boundary — RLS is'). (2) The only trigger guarding this table for clients, fn_workspaces_client_guard, is installed BEFORE UPDATE ONLY — 0020_admin_grants_and_alignment.sql:474-478 — and it blocks slug/id/created_at/deleted_at, i.e. it stops a client-side suspend but nothing else; `name` is unguarded, so an off-console rename is also possible. (3) grep -rn 'BEFORE DELETE' over supabase/migrations/ returns zero hits — there is no DELETE guard on public.workspaces anywhere. (4) FORCE ROW LEVEL SECURITY (0002:12) does not help; it constrains the table owner, not authenticated. (5) Nothing in 0028 narrows this policy — 0028:77-81 explicitly states 'No policy from any earlier migration is redefined here', and its header at :51-61 accounts for the READ arm of this policy but not its WRITE arm.
required: |
  CS-1.13 multi-tenancy isolation at every layer; TS-1.6 MFA on all privileged/admin access; TS-1.5 dual authorization on destructive operations; AS-2.9 every destructive content action emits an audit event.
gap: |
  The entire S15 operator design assumes cross-tenant writes are reachable only through service-role Edge Functions behind _shared/operatorGuard.ts. That guard is strong — live platform_operators row (operatorGuard.ts:77-89), HARD MFA that refuses both an unenrolled operator and a failed listFactors call (operatorGuard.ts:94-112), a typed-slug confirmation (operator-workspaces/index.ts:360-363), a blob sweep before the row is dropped (index.ts:365-411), and a platform_audit certificate that survives the CASCADE (index.ts:433-446, 0028:164-221). This RLS policy is a second, ungated door to the same act. Any user holding a platform_operators row can, from an ordinary WILSON browser session with the public anon key at aal1, issue DELETE /rest/v1/workspaces?id=eq.<any-workspace-uuid> and destroy an arbitrary tenant: the CASCADE takes workspace_members, projects and everything under them, notes, otter_*, workspace_ai_keys, app_events, and file_events — destroying the TPN-CONT-002 deletion certificates too, the exact failure 0028:40-49 was written to prevent. It leaves every rabbit-files blob for that tenant orphaned and permanently unreclaimable, because storage-gc/index.ts:193-201 resolves a project folder to a workspace via public.projects then public.file_events and both are now gone, so it fails closed and reports those blobs forever. And it writes no platform_audit row, so there is no record the company existed or was destroyed. Net effect: MFA on the highest-privilege surface in the system is optional in practice, destruction has no second factor, and a cross-tenant destructive act is unauditable — a stolen or borrowed aal1 operator session is total, silent platform destruction. Fix is small: narrow the policy to FOR SELECT (the only arm the console needs, since reads already go through the service_role operator_workspace_summary()), or keep FOR ALL and add a BEFORE DELETE/UPDATE guard trigger that rejects any non-service_role writer the way fn_workspaces_client_guard already does for UPDATE.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-CLOUD-TENANCY
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

**Closed in the same session by migration `0029_operator_write_lockdown.sql`.** The pre-commit adversarial review found this independently and rated it CRITICAL, because it is a complete bypass of the operator console's MFA requirement, typed confirmation, storage sweep and audit certificate — an operator's ordinary aal1 browser session could `DELETE FROM workspaces` directly. 0029 drops the `FOR ALL` policy in favour of read+update arms, revokes INSERT/DELETE/TRUNCATE from `anon` and `authenticated`, and adds `trg_workspaces_delete_guard` as a second layer. pgTAP suite 37 pins all three: the direct delete now raises `permission denied for table workspaces` for an operator session, while rename still works and cross-tenant read is preserved.

---

## TPN-CLOUD-004 — user-avatars bucket is public AND its SELECT policy is unconditional — unauthenticated read plus anon-key cross-tenant enumeration of every workspace's members

```yaml
id: TPN-CLOUD-004
severity: HIGH
control: CS-1.13
domain: cloud
title: user-avatars bucket is public AND its SELECT policy is unconditional — unauthenticated read plus anon-key cross-tenant enumeration of every workspace's members
location: supabase/migrations/0009_perms_and_provisioning.sql:92-110
evidence: |
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('user-avatars', 'user-avatars',
    true,  -- public-read (RLS below still gates write)
    ...)
  ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, ...;
  
  CREATE POLICY user_avatars_select ON storage.objects
    FOR SELECT
    USING (bucket_id = 'user-avatars');
  
  The policy has no TO authenticated, no auth.role() test and no workspace predicate — it is permissive for PUBLIC, i.e. for the anon role. Contrast the same file's own write policies at :112-141, which correctly pin (storage.foldername(name))[1] = public.current_workspace_id() and [2] = auth.uid(), and contrast rabbit_files_select at 0027_file_lifecycle.sql:300-310, which the S14 author explicitly hardened with auth.role() = 'authenticated' plus an EXISTS-under-RLS projects probe. The avatar read policy was never back-fixed to match. The app depends on the public path: src/components/TeamMembers/useWorkspaceMembers.js:32 builds ${SUPABASE_URL}/storage/v1/object/public/user-avatars/, and src/cloud/onboarding/NewUserWelcome.jsx:112 and src/components/settings/ProfileSection.jsx:147 both call getPublicUrl(); createSignedUrl appears nowhere in src/. Amplifier: supabase/config.toml:9 sets schemas = ["public", "storage", "graphql_public"], exposing the storage schema over PostgREST too (a widening of the stock template, which omits "storage"); with the policy above, GET /rest/v1/objects?bucket_id=eq.user-avatars with the public anon key returns every avatar row across every tenant. The bucket is also the only storage surface with no pgTAP coverage — supabase/tests/rls/33_file_lifecycle.sql:277-340 asserts rabbit-files is private and has exactly its three policies, while grep for user_avatars across supabase/tests/rls/ returns nothing.
required: |
  CS-1.13: multi-tenancy isolation at every layer, including object storage; tenant data must not be reachable from public endpoints without authentication.
gap: |
  Two independent exposures. (a) public = true means Supabase serves /storage/v1/object/public/user-avatars/{workspace_id}/{user_id}/{ts}-{name} with NO credential at all — any URL that leaks (screenshot, exported CSV, shared link, referrer) is world-readable forever. (b) The unconditional SELECT policy means the storage list API and, given config.toml:9, PostgREST itself will enumerate the bucket for the anon role: an attacker holding only the public anon key (which ships in the web bundle by design) can list every object and harvest the complete set of workspace UUIDs, the user UUIDs inside each, and every member's photograph — a full cross-tenant customer and staff roster for the platform. For a vendor whose tenants are studios, 'which companies use WILSON and who works there' is exactly the tenancy metadata a TPN assessor expects behind auth. The path prefix carries the tenant id but nothing in the read path enforces it, which is the textbook 'multi-tenant data in a single bucket with no tenant isolation on read'. Remediation: flip the bucket to public = false, replace user_avatars_select with the rabbit_files_select shape (auth.role() = 'authenticated' AND (storage.foldername(name))[1] = public.current_workspace_id()::text), and move the three call sites (NewUserWelcome.jsx:112, ProfileSection.jsx:147, useWorkspaceMembers.js:32) from getPublicUrl to createSignedUrl.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-CLOUD-BUCKET-PRIVATE
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-CLOUD-005 — Workspace teardown sweeps only rabbit-files — the destroyed tenant's avatar objects are stranded in a public bucket with no certificate and no reachable cleaner

```yaml
id: TPN-CLOUD-005
severity: MEDIUM
control: CS-1.13
domain: cloud
title: Workspace teardown sweeps only rabbit-files — the destroyed tenant's avatar objects are stranded in a public bucket with no certificate and no reachable cleaner
location: supabase/functions/operator-workspaces/index.ts:78 (BUCKET = 'rabbit-files'), :115-152 (collectBlobPaths), :379-404 (the sweep)
evidence: |
  const BUCKET = 'rabbit-files'   // index.ts:78 — the only bucket teardown knows about
  
  collectBlobPaths() (:115-152) reads exactly two sources: public.files filtered on storage_provider = 'supabase', and public.storage_gc_queue filtered on .eq('bucket_id', BUCKET). Neither can ever yield a user-avatars path — avatar objects have no public.files row, and 0027's trg_files_gc_enqueue (0027:275-280) fires only on DELETE of public.files. The teardown sweep at :379-387 then calls ctx.admin.storage.from(BUCKET).remove(batch), rabbit-files only, and the workspace row is deleted at :414-417 immediately afterwards. The only code in the system that disposes of avatar orphans is storage-gc/index.ts:217-255, which is admin-invoked (requireWorkspaceAdmin, storage-gc/index.ts:131) and scoped to ctx.workspaceId — after teardown there is no admin, no membership row and no workspace, so that path is unreachable by construction. The function's own header at operator-workspaces/index.ts:25-49 reasons carefully about exactly this class of bug for rabbit-files ('after the CASCADE there is no way to discover which blobs belonged to this tenant') and stops one bucket short.
required: |
  CS-1.13 tenant data isolation and complete tenant offboarding; AS-3.x certified disposal — destruction must be complete and evidenced.
gap: |
  A torn-down company leaves user-avatars/{workspace_id}/{user_id}/* in place indefinitely. Because that bucket is public (TPN-CLOUD-004), those are world-readable photographs of the staff of a company whose contract has ended, sitting in the vendor's storage with no owner, no retention clock and no route to deletion. The platform_audit teardown certificate at :433-446 reports blobs_found/blobs_removed/blobs_failed computed purely from the rabbit-files sweep, so it affirmatively states a complete disposal that did not happen — worse than silence for an assessor. Fix: add a second collection pass over user-avatars/{workspace_id} (the same paged listFolder shape storage-gc already uses at storage-gc/index.ts:67-77) before step 4, remove those objects in the same batched loop, and include their count in the WIL-7005 certificate.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-CLOUD-TENANCY
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

Merged into this finding during the re-audit (same defect, reported from another domain pass): `TPN-CONT-013`.

---

## TPN-CLOUD-006 — Storage-bucket policies sit outside the CI RLS gate — the avatar policies have no pgTAP test and storage-api is excluded from the local stack

```yaml
id: TPN-CLOUD-006
severity: LOW
control: CS-1.13
domain: cloud
title: Storage-bucket policies sit outside the CI RLS gate — the avatar policies have no pgTAP test and storage-api is excluded from the local stack
location: .github/workflows/rls.yml:50-77 (the RLS_TABLES gate) and .github/workflows/rls.yml:83 (supabase start --exclude ... storage-api ...)
evidence: |
  rls.yml:83 — supabase start --exclude realtime,storage-api,imgproxy,edge-runtime,studio,mailpit. The RLS_TABLES guard at rls.yml:50-77 enforces one supabase/tests/rls/NN_<table>.sql per table added to migration 0004, i.e. it covers public.* only; storage.objects is not in its vocabulary. rabbit-files got voluntary coverage — supabase/tests/rls/33_file_lifecycle.sql:277-281 asserts the bucket is private, :285-289 asserts its three policies exist, :298-330 exercises the insert/delete arms — but grepping supabase/tests/rls/ for user_avatars or the 0009 policy names returns zero files. So the exact defects in TPN-CLOUD-004 (public = true, an unconditional SELECT policy) are invisible to CI, and nothing stops a future migration re-running 0009's ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public (0009:100-103), or flipping rabbit-files back to public, without a red build.
required: |
  CS-1.13 read as a verifiable control — tenancy isolation must be continuously evidenced, not asserted once; the repo's own convention (rls.yml:50-77) is that every RLS surface is pinned by a test that fails CI.
gap: |
  Bucket privacy and storage.objects policies are the one part of the tenancy boundary with no automated regression gate. The pattern to copy already exists in-repo: 33_file_lifecycle.sql:277-289 proves you can assert SELECT public FROM storage.buckets and a policy inventory from pgTAP without booting storage-api. Add an equivalent block for user-avatars (bucket privacy, exact policy inventory, and a negative test that the SELECT policy is not reachable by anon), and extend the rls.yml gate so a new storage.objects policy without a test file fails the build the way a new public table does.
effort: S
blocks_tier: none
recommendation_ref: RECO-CLOUD-TENANCY
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

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
```

**Re-audit 2026-07-30 — NOT RE-ASSESSED.** This is a policy/process finding with no code location; the re-audit covered the nine code-bearing domains. It remains open.

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

**Re-audit 2026-07-30 — NOT RE-ASSESSED.** This is a policy/process finding with no code location; the re-audit covered the nine code-bearing domains. It remains open.

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

**Re-audit 2026-07-30 — NOT RE-ASSESSED.** This is a policy/process finding with no code location; the re-audit covered the nine code-bearing domains. It remains open.

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

**Re-audit 2026-07-30 — NOT RE-ASSESSED.** This is a policy/process finding with no code location; the re-audit covered the nine code-bearing domains. It remains open.

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

**Re-audit 2026-07-30 — STILL OPEN.**

Current location: `C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/.github/workflows/rls.yml (4 jobs) and .github/workflows/backups.yml — neither contains an SCA/SBOM step`

Severity revised to **HIGH**.

The premise the baseline leaned on ("No CI configured") is now FALSE — CI exists (rls.yml: pgtap, issue-session-smoke, unit/Vitest, e2e-auth; backups.yml: nightly pg_dump). But the CONTROL is still absent. `grep -n -i 'audit|sbom|cyclonedx|snyk|dependabot|trivy|grype|osv|codeql|semgrep' .github/workflows/*.yml` returns a single false hit (rls.yml:67, the string `platform_audit` in an RLS table allowlist). No `.github/dependabot.yml`. Repo-wide `find` for sbom.json / bom.xml / *.spdx.json / *cyclonedx* returns nothing. No SBOM is generated for the Electron installer, the Vercel web bundle, or the 12 Edge Functions. I ran the missing gate manually: `npm audit --omit=dev` in WILSON/ = 30 advisories in the PRODUCTION tree (1 low, 24 moderate, 5 high); full tree = 91 (6 low, 27 moderate, 57 high, 1 critical). Two deps the baseline named have since gone clean (pdf-parse@2.4.5, mammoth@1.12.0 — no advisories), which is luck, not process. Detail of what the missing gate would have caught is filed as TPN-3P-005/006. Note the baseline gap text is now understated: since S1-S15 the tree also gained @supabase/supabase-js, @sentry/electron, @monaco-editor/react, yjs/y-protocols, electron-updater, and a whole second (Deno/esm.sh) dependency universe that npm audit cannot see at all.

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

**Re-audit 2026-07-30 — STILL OPEN.**

Current location: `C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON/package.json:60 (baseline said :40 — stale); resolved version at package-lock.json:16451; live parse site at src/components/RateCard/importers/xlsxImporter.js:25`

Unchanged in substance. package.json:60 is now `"xlsx": "^0.18.5"` (baseline recorded the exact pin `"0.18.5"`), but the caret buys nothing: 0.18.5 is the last release SheetJS ever published to the npm registry (0.19+ ship only from cdn.sheetjs.com), so `^0.18.5` resolves to 0.18.5 forever. package-lock.json:16451-16453 confirms `"version": "0.18.5"`, resolved from registry.npmjs.org. `npm audit --omit=dev` reports `xlsx *  Severity: high — Prototype Pollution in sheetJS (GHSA-4r6h-8v6p-xvw6 = CVE-2023-30533), SheetJS ReDoS (GHSA-5pgg-2g8v-p4x9 = CVE-2024-22363). No fix available.` The exploit path is still live and now WIDER than at baseline: src/components/RateCard/importers/xlsxImporter.js:25 calls `XLSX.read(buffer, { type: 'array' })` straight on a user-picked File with no pre-validation, no size cap, no sanitisation, and RateCardPage.jsx:449 accepts `.xlsx,.xls` from a file input — and since S12 that code also ships in the Vite web build served from beta.petalstudios.co/wilson, so the parser now runs in every tester's browser session, not just one desktop. The source comment at xlsxImporter.js:6-8 still advertises `xlsx@0.18.5` as chosen because it is "available on npm", which is precisely the reason it is stuck on the vulnerable line. No mitigation was added anywhere in S1-S15.

---

## TPN-3P-003 — Third-party AI vendor lacks formal TPN engagement reference

```yaml
id: TPN-3P-003
severity: HIGH
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

**Re-audit 2026-07-30 — STILL OPEN.**

Current location: `N/A — policy. Nearest existing artifact: C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON/docs/MASTER_PLAN.md:829-849 (§9 infrastructure table)`

Severity revised to **HIGH**.

No VENDOR_RISK.md, SECURITY.md, or HARDENING.md exists anywhere in the repo or under WILSON/docs/ (only MASTER_PLAN.md, ORIGINAL_BRIEF_multiuser.md, OWED_AUDREY.md, WEB_DEPLOY.md). MASTER_PLAN.md §9 (:829-849) is an operational cheat-sheet — Supabase project refs, 'Email | Resend SMTP, domain mail.petalstudios.co, DNS at Squarespace', 'Backups workflow ... needs B2_* secrets' — with no DPA reference, no data classification per vendor, no risk rating, no annual-review date, and no BCP/DR clause, i.e. none of OR-3.4's required elements. MASTER_PLAN.md:543 shows a vendor list is only PLANNED, as prose inside the not-yet-written docs/SYSTEMS_HANDBOOK.md (S16). I am escalating MEDIUM->HIGH because the sub-processor set roughly tripled since baseline and now includes parties that hold or receive content: (1) Anthropic — api.anthropic.com/v1/messages via supabase/functions/ai-proxy/index.ts:46 and operator-ai-keys/index.ts:37, receives deck/course/project content in prompts; (2) Supabase — Postgres, Auth, Storage rabbit-files bucket, Realtime, 12 Edge Functions, the primary content store; (3) Backblaze B2 — .github/workflows/backups.yml:91-95 uploads a nightly `pg_dump -Fc` of BOTH prod and staging, i.e. a complete off-platform copy of the content database, plus it hosts the update binaries (electron/updater.cjs:3); (4) Resend — transactional auth email (src/cloud/auth/ForgotPasswordWizard.jsx:7, InviteMemberDialog.jsx:5); (5) Sentry — error telemetry via @sentry/electron (src/cloud/sentry.js:22; sendDefaultPii:false at :30, which is the right default but is a code fact, not an attested vendor control); (6) Vercel — hosts the beta web build and the /wilsonadmin operator console (vercel.json); (7) Google Drive + Google OAuth — src/tools/rabbit_v0.1.0/adapters/googleDriveAdapter.js:41-43, a BYO content store; (8) GitHub / GitHub Actions — CI that holds BACKUP_PROD_DB_URL and B2 write keys; (9) esm.sh — an unlisted CDN that injects executable code into every privileged Edge Function (see TPN-3P-004); (10) npm registry; (11) AWS (awscli.amazonaws.com, CI); (12) SheetJS. Per the Pass 12 signal 'Third-party handling content without a documented TPN assessment -> HIGH', items 1, 2, 3, 6, 7 and 9 each independently qualify. Note public/extensions/Code.gs + Sidebar.html (Google Apps Script) remain the LEARNINGS.md scope carve-out and are excluded here.

---

## TPN-3P-004 — Every privileged Edge Function loads supabase-js from the esm.sh community CDN with no integrity pin and no Deno lockfile

```yaml
id: TPN-3P-004
severity: HIGH
control: TS-4.0
domain: third_party
title: Every privileged Edge Function loads supabase-js from the esm.sh community CDN with no integrity pin and no Deno lockfile
location: WILSON/supabase/functions/_shared/adminGuard.ts:28 (also memberGuard.ts:17, operatorGuard.ts:42, rateLimit.ts:27, issue-session/index.ts:19, resolve-login/index.ts:15, invite-member/index.ts:27, provision-workspace/index.ts:22)
evidence: |
  adminGuard.ts:28 — `import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'`. Eight identical remote imports across supabase/functions/. `find . -maxdepth 4 \( -iname deno.lock -o -iname 'deno.json*' -o -iname import_map.json \)` returns NOTHING repo-wide, and supabase/config.toml declares no import map. The URL carries a version tag but no subresource-integrity hash, so the bytes are re-fetched from esm.sh on every `supabase functions deploy` with no way to detect substitution. This module is the transitive root of the entire server-side trust boundary: adminGuard.ts backs admin-create-user / admin-reset-password / admin-set-active / admin-user-security; operatorGuard.ts backs the /wilsonadmin operator console (platform tier, hard MFA); memberGuard.ts + rateLimit.ts + the service-role client back ai-proxy, which decrypts per-workspace Anthropic keys via _shared/aiKeyCrypto.ts. All of these run with SUPABASE_SERVICE_ROLE_KEY and WILSON_AI_KEY_SECRET in scope.
required: |
  TS-4.0 / supply chain: build and runtime dependencies must come from a controlled source with verifiable integrity (lockfile with hashes, registry the org trusts, or vendored). Code executing with privileged credentials must not be fetched unverified from a third-party host at deploy time.
gap: |
  esm.sh is a community-operated CDN that is neither Supabase-owned nor npm-owned and is not listed as a sub-processor anywhere (see TPN-3P-003). A compromise, account takeover, or DNS hijack of esm.sh silently injects attacker code into the exact functions that hold the service-role key, the AES-256-GCM AI-key decryption secret, and the operator MFA guard — bypassing RLS entirely, since service-role is above it. There is no lockfile to detect the substitution and no CI step that would notice. Deno's `npm:@supabase/supabase-js@2.x` specifier plus a committed deno.lock removes the fourth party and adds hash verification.
effort: M
blocks_tier: Silver
recommendation_ref: RECO-3P-PIN
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-3P-005 — sharp@0.34.5 (libvips advisory GHSA-f88m-g3jw-g9cj) decodes user-supplied images in the unsandboxed Electron main process

```yaml
id: TPN-3P-005
severity: HIGH
control: TS-4.0
domain: third_party
title: sharp@0.34.5 (libvips advisory GHSA-f88m-g3jw-g9cj) decodes user-supplied images in the unsandboxed Electron main process
location: WILSON/electron/main.cjs:6 (require) and :1727, :1760, :1794, :2372, :2390 (call sites); pin at package.json:58
evidence: |
  electron/main.cjs:6 — `const sharp = require('sharp');`. electron/main.cjs:1727 — `await sharp(srcPath).resize(256).jpeg({ quality: 80 }).toFile(thumbPath);` and four sibling calls, all thumbnailing files a user has just imported into RABBIT. package.json:58 pins `"sharp": "^0.34.5"`; package-lock.json resolves 0.34.5. `npm audit --omit=dev`: `sharp <0.35.0  Severity: high — sharp inherited vulnerabilities in libvips: CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591 (GHSA-f88m-g3jw-g9cj). fix available via npm audit fix --force. Will install sharp@0.35.3, which is a breaking change.`
required: |
  Known-vulnerable dependencies on a content-processing path must be upgraded, replaced, or compensated. Untrusted-input parsers should not run at full host privilege.
gap: |
  libvips is a native C image decoder. These are memory-safety class defects reachable purely by feeding it a crafted image. In WILSON that image is exactly the ingested production asset TPN exists to protect, and the decode happens in the Electron MAIN process — full Node, no contextIsolation, no sandbox, direct fs access to every workspace folder and to %APPDATA%/WILSON. This is the highest-privilege untrusted-input parser in the desktop build and it sits one minor version below the fixed line. `npm audit fix --force` names the remedy (sharp@0.35.3); only five call sites use the trivial resize/jpeg/toFile API, so the breaking-change surface is small.
effort: S
blocks_tier: Silver
recommendation_ref: RECO-3P-CVE
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-3P-006 — Production dependency tree carries 30 untriaged advisories beyond xlsx and sharp, including three on live content/collaboration paths

```yaml
id: TPN-3P-006
severity: MEDIUM
control: TS-4.0
domain: third_party
title: Production dependency tree carries 30 untriaged advisories beyond xlsx and sharp, including three on live content/collaboration paths
location: WILSON/package.json:35-63 (dependencies block)
evidence: |
  `npm audit --omit=dev` in WILSON/ = "30 vulnerabilities (1 low, 24 moderate, 5 high)". Traced against package-lock.json: ws@8.20.0 HIGH (GHSA-58qx-3vcg-4xpx uninitialized memory disclosure, GHSA-96hv-2xvq-fx4p memory-exhaustion DoS) reached via node_modules/@supabase/realtime-js -> ws ^8.18.2, i.e. the S7 realtime-broadcast path (package.json:38); path-to-regexp@8.3.0 HIGH (GHSA-j3q9-mxjg-w52f, GHSA-27v5-c462-wpq7 ReDoS) and qs@6.15.0 MODERATE (GHSA-q8mj-m7cp-5q26) reached via express@5.2.1 -> router (package.json:48), the embedded loopback API server; dompurify@3.2.7 MODERATE x4 (GHSA-h8r8-wccr-v5f2 mutation-XSS, GHSA-cj63-jhhr-wcxv prototype pollution, +2) reached via monaco-editor@0.55.1, which is loaded by src/tools/otter_v0.3.1/Otter.jsx:6 (`import Editor from '@monaco-editor/react'`, package.json:36); uuid@13.0.0 MODERATE (GHSA-w5hq-g745-h8pq, package.json:59); @sentry/electron@5.12.0 -> @sentry/node -> @opentelemetry/core MODERATE (GHSA-8988-4f7v-96qf, package.json:37). All say "fix available via npm audit fix" except the sentry chain (--force, breaking).
required: |
  SCA per build with triage: each advisory either patched, or risk-accepted in writing with a reachability argument. Critical vulns need a plan within 48 hours.
gap: |
  None of these has been looked at, because there is no SCA gate (TPN-3P-001). Most are one `npm audit fix` away. Reachability is genuinely mixed — ws is likely unreachable in the Electron renderer and the browser build (both use the platform WebSocket, not the Node shim), uuid's bug needs the `buf` argument to v3/v5/v6 which WILSON does not pass, and Express is loopback-only — but that argument has never been made or recorded, so an assessor sees 30 open advisories in a shipped product. The dompurify chain is the least dismissible: it is a sanitiser defect inside an editor that renders workspace-authored O.T.T.E.R. content.
effort: M
blocks_tier: Gold
recommendation_ref: RECO-3P-CVE
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-3P-007 — Server-side supabase-js frozen at 2.45.4 while the client ships ^2.101.1 — ~56 minor versions of untriaged SDK drift on the privileged path

```yaml
id: TPN-3P-007
severity: MEDIUM
control: TS-4.0
domain: third_party
title: Server-side supabase-js frozen at 2.45.4 while the client ships ^2.101.1 — ~56 minor versions of untriaged SDK drift on the privileged path
location: WILSON/supabase/functions/issue-session/index.ts:19 (and the seven sibling esm.sh imports listed in TPN-3P-004); client pin at WILSON/package.json:38
evidence: |
  All eight Edge-Function imports read `https://esm.sh/@supabase/supabase-js@2.45.4`. package.json:38 declares `"@supabase/supabase-js": "^2.101.1"` for the renderer. The Edge version is hand-typed into eight separate source files with no single source of truth, so a bump means eight edits plus 12 function redeploys across dev/staging/prod.
required: |
  Dependency currency must be tracked on all runtimes, not just the ones a package manager happens to see. Security fixes in a vendor SDK must reach the privileged tier at least as fast as the unprivileged one.
gap: |
  npm audit is blind to this entire runtime — it only reads package.json/package-lock.json, so no existing or proposed CI gate covers the Edge Functions. 2.45.4 predates the client pin by roughly a year of releases; any auth, GoTrue, or PostgREST client fix published since then is present in the browser but absent in the functions that carry the service-role key. The duplicated literal across eight files also makes drift the default outcome. Consolidating onto one `_shared/deps.ts` re-export (or a deno.json imports map, which TPN-3P-004 needs anyway) reduces this to a one-line bump.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-3P-PIN
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

## TPN-3P-008 — Vercel production build uses `npm install`, not `npm ci` — the deployed beta bundle is not guaranteed to match the CI-tested dependency tree

```yaml
id: TPN-3P-008
severity: MEDIUM
control: TS-4.0
domain: third_party
title: Vercel production build uses `npm install`, not `npm ci` — the deployed beta bundle is not guaranteed to match the CI-tested dependency tree
location: WILSON/vercel.json:5
evidence: |
  vercel.json:5 — `"installCommand": "npm install --ignore-scripts"`. The same file's buildCommand (:3) produces BOTH public surfaces: `npm run build:vercel && npm run build:vercel:admin`, i.e. the beta.petalstudios.co/wilson tester app and the /wilsonadmin operator console. By contrast .github/workflows/rls.yml:194 and :244 (the jobs that actually run Vitest and Playwright) use `npm ci`. Every runtime dependency in package.json:36-62 is a caret range, so the two commands can legitimately resolve different trees.
required: |
  Reproducible builds: the artifact that reaches users must be built from the same pinned dependency set that was tested and scanned.
gap: |
  `npm ci` fails hard when package-lock.json and package.json disagree and installs the lockfile exactly; `npm install` tolerates the mismatch and will resolve newer in-range versions, silently rewriting the lock in the build sandbox. With 26 caret-ranged runtime deps, the bundle Vercel serves to testers can therefore contain code that no CI job, no test run, and no future SCA gate ever saw — which also defeats the point of adding SBOM/SCA under TPN-3P-001, since the SBOM would describe a different tree than the one deployed. Fix is a one-token edit to vercel.json:5. Credit where due: `--ignore-scripts` is a correct and deliberate hardening choice (it blocks the postinstall-script class of supply-chain attack) and should be kept alongside `npm ci`.
effort: XS
blocks_tier: Gold
recommendation_ref: RECO-3P-BUILD
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

Merged into this finding during the re-audit (same defect, reported from another domain pass): `TPN-SDLC-011`.

---

## TPN-3P-009 — CI executes unverified third-party binaries and references third-party actions by mutable tags, including in the job that holds production DB credentials

```yaml
id: TPN-3P-009
severity: MEDIUM
control: TS-4.0
domain: third_party
title: CI executes unverified third-party binaries and references third-party actions by mutable tags, including in the job that holds production DB credentials
location: C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/.github/workflows/backups.yml:50-52; .github/workflows/rls.yml:44-46
evidence: |
  backups.yml:50-52 — `curl -sSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscli.zip` then `unzip -q /tmp/awscli.zip -d /tmp` then `/tmp/aws/install`, with no checksum and no GPG signature check, even though AWS publishes a detached .sig for that exact artifact. That step runs inside the job whose env (backups.yml:55-59) carries BACKUP_PROD_DB_URL, BACKUP_STAGING_DB_URL, B2_KEY_ID and B2_APP_KEY. Separately, rls.yml:44-46 — `uses: supabase/setup-cli@v1` with `version: latest`, i.e. a third-party action at a mutable tag installing whatever CLI build exists at run time; rls.yml:41/140/185/217 use `actions/checkout@v4`, :187/:235 `actions/setup-node@v4`, :262 `actions/upload-artifact@v4`, all mutable major tags rather than commit SHAs.
required: |
  Build-pipeline integrity: third-party executables and actions pulled into CI must be integrity-verified (checksum/signature) or SHA-pinned, especially in jobs holding production credentials.
gap: |
  The backups job is the single highest-value credential holder in the whole pipeline — it can read every row of prod and staging and write to the backup bucket. Any tampering with the AWS CLI archive it downloads and executes exfiltrates the full content database. HTTPS to an AWS-owned domain makes this unlikely rather than impossible, and TPN asks for verification, not likelihood. Cheapest fixes: verify the published signature (or drop the download entirely — `pip install awscli` is not needed either, since `aws s3 cp` here could be replaced by a plain curl+SigV4 or by keeping the CLI in the container image), and repin `supabase/setup-cli` to a release SHA with an explicit CLI version instead of `latest`. The actions/* references are lower risk (GitHub-owned) but SHA-pinning them is the same one-line change and is what an assessor will ask for.
effort: S
blocks_tier: Gold
recommendation_ref: RECO-3P-BUILD
opened: 2026-07-30
```

**Opened by the 2026-07-30 re-audit.** This finding did not exist at the 2026-04-15 baseline — it is either new code or newly reachable code.

---

