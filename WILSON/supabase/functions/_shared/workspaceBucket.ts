// =============================================================================
// _shared/workspaceBucket.ts — F8 (wave 2, 2026-11-13): a company's own S3
// bucket, loaded once.
//
// storage-presign, storage-read-urls and storage-secret's probe each read the
// workspace's bucket configuration (workspace_storage), then its sealed secret
// (workspace_storage_secrets), opened it, and refused in the same order with
// their own sentences: four copies of the same twenty lines (storage-gc holds
// the fourth; it moves onto this file with the second merger, F8-02). This is
// those lines once. What it keeps, and must keep:
//
//   * BOTH READS ARE THE SERVICE ROLE'S, keyed by the workspace id the caller's
//     GUARD verified (ctx.workspaceId), never by anything a request body says:
//     the workspace is this function's second argument and every caller passes
//     ctx.workspaceId.
//   * EVERY WAY IT CAN FAIL IS A CODE, never a Response. Each function words
//     its own status and sentence from the code, exactly as it did before (the
//     probe's sentences are not storage-presign's, and are not made to match).
//   * THE ORDER OF REFUSALS IS TODAY'S: the configuration read failing, not
//     S3, not the active choice (only when asked), no master key (only when
//     asked), the secret read failing, no secret, a secret that will not open.
//     So a put on a retained configuration with no master key is still "on
//     Petal cloud right now", and an empty-string ciphertext is still "no
//     bucket secret", never "cannot be decrypted".
//
// THE TWO READS ARE STARTED AT ONCE, the configuration's first, and judged in
// the order above. Before, when the configuration refused, the secret row was
// never read; now it is read and not looked at (its ciphertext is never opened
// and never answered). The configuration is AWAITED FIRST and refuses at once
// (review round 1, S1): its four refusals (the read failing, not S3, not
// active, no master key) never wait for the secret's answer, as they never did.
// The secret's promise is given a no-op catch the moment it is made, so a
// secret read that fails after one of those was answered (or while the
// configuration is still awaited) is never an unhandled rejection; it is
// awaited, and a throw from it passed on, only once the configuration has
// passed. So a throwing secret read beside a company with no S3 configuration
// is still the 409. Not Promise.all, and not allSettled: all would meet the
// secret's throw before the configuration's refusal, allSettled would make
// every refusal wait for the secret.
//
// ONE QUERY IS POSSIBLE AND IS NOT USED: the two tables have no foreign key
// between them, so one statement would go through `workspaces` and embed both
// children, which would merge storage_read_failed and secret_read_failed into
// one failure (one of the two answers could never be given again).
//
// The column list of the configuration read is each caller's own, as it was:
// `mode, provider, provider_config` for storage-presign (it asks the active
// choice of a put or a look), `provider, provider_config` for storage-read-urls
// and storage-secret. `withMode` says which; asking `requireByos` reads it too.
//
// WHY A NEW FILE. It joins two tables' reads, the bucket secret's crypto and
// the signer's target type. storageSecretCrypto.ts is pure crypto that vitest
// imports with no client; s3Presign.ts promises no imports; s3Reach.ts is the
// network; adminGuard.ts is the callers. None can take a database read
// without breaking what its header promises.
//
// No caching: the secret is read and opened on every load. An opened bucket
// secret kept in the isolate would outlive a `clear` or a re-save.
// =============================================================================

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { decryptStorageSecret, storageSecretCryptoConfigured } from './storageSecretCrypto.ts'
import type { S3Target } from './s3Presign.ts'

/** workspace_storage.provider_config for provider 's3' (0051's CHECK holds its shape; the secret is never in it). */
export type S3Config = {
  endpoint?: string
  region: string
  bucket: string
  prefix?: string
  accessKeyId: string
  forcePathStyle?: boolean
}

/** What the signer takes from a configuration. */
export function s3TargetOf(config: S3Config): S3Target {
  return { endpoint: config.endpoint, region: config.region, bucket: config.bucket, forcePathStyle: config.forcePathStyle }
}

export type BucketConfigRead =
  | { ok: true; s3: true; mode: string | null; config: S3Config; target: S3Target }
  /** Read, and this company has no S3 configuration (no row, another provider, or no provider_config). */
  | { ok: true; s3: false; mode: string | null }
  | { ok: false; code: 'storage_read_failed'; message: string }

/**
 * The configuration half alone: storage-secret's `set` vets the endpoint
 * before there is a secret to read, and a company with no S3 configuration is
 * NOT refused there (the secret is saved). `mode` is null unless `withMode`.
 */
export async function readWorkspaceBucketConfig(
  admin: SupabaseClient, workspaceId: string, opts: { withMode?: boolean } = {},
): Promise<BucketConfigRead> {
  return configOf(await configQuery(admin, workspaceId, opts.withMode === true))
}

/**
 * The bucket, loaded: the configuration's own six fields at the top level
 * (built field by field, never a spread of the row), what the signer takes,
 * the secret opened, and the mode. The prefix is applied by the CALLER,
 * server-side; a client never supplies it.
 */
export type WorkspaceBucket = S3Config & {
  target: S3Target
  /** The bucket secret, opened. Never logged, never answered. */
  secret: string
  /** workspace_storage.mode ('byos' while the bucket is the active choice); null when not read. */
  mode: string | null
}

export type BucketRefusal =
  | { ok: false; code: 'storage_read_failed'; message: string }
  /** No S3 configuration. */
  | { ok: false; code: 'not_s3' }
  /** `requireByos`, and the company is on Petal cloud: the configuration is retained, not active. */
  | { ok: false; code: 'not_active' }
  /** `preflightCrypto`, and no bucket-secret master key of any version is set on this environment. */
  | { ok: false; code: 'crypto_unavailable' }
  | { ok: false; code: 'secret_read_failed'; message: string }
  /** No secret row, or an empty ciphertext. */
  | { ok: false; code: 'no_secret' }
  /** The stored secret did not open; `message` is the decrypt's own words. */
  | { ok: false; code: 'secret_unusable'; message: string }

export type LoadBucketOptions = {
  /** Refuse (`not_active`) unless mode is 'byos': a write needs the ACTIVE choice; a read of what was written does not. */
  requireByos: boolean
  /**
   * Ask whether the master key is set BEFORE the secret row is judged (default
   * true: storage-presign and storage-read-urls answer 503 crypto_unavailable
   * there). storage-secret's probe never asked: an unset key surfaces from the
   * decrypt, as secret_unusable naming the secret, or not at all when no
   * secret is stored. It passes false. Do not "tidy" the two into one.
   */
  preflightCrypto?: boolean
  /** Select `mode` with the configuration (storage-presign's column list). Implied by requireByos. */
  withMode?: boolean
}

export async function loadWorkspaceBucket(
  admin: SupabaseClient, workspaceId: string, opts: LoadBucketOptions,
): Promise<({ ok: true } & WorkspaceBucket) | BucketRefusal> {
  const withMode = opts.withMode === true || opts.requireByos
  // Both started at once, the configuration's first (the statement order).
  const cfgRead = configQuery(admin, workspaceId, withMode)
  const secRead = secretQuery(admin, workspaceId)
  // Never unhandled: met below once the configuration has passed, or never looked at.
  secRead.catch(() => {})
  // The configuration alone decides these four, at once (a throw: passed on at once).
  const cfg = configOf(await cfgRead)
  if (!cfg.ok) return cfg
  if (!cfg.s3) return { ok: false, code: 'not_s3' }
  if (opts.requireByos && cfg.mode !== 'byos') return { ok: false, code: 'not_active' }
  if (opts.preflightCrypto !== false && !storageSecretCryptoConfigured()) return { ok: false, code: 'crypto_unavailable' }
  // Only now the secret: its throw, if it threw, is passed on here.
  const { data: sec, error: secErr } = await secRead
  if (secErr) return { ok: false, code: 'secret_read_failed', message: secErr.message }
  const ciphertext = (sec as { secret_ciphertext?: unknown } | null)?.secret_ciphertext
  if (!ciphertext) return { ok: false, code: 'no_secret' }
  let secret: string
  try {
    secret = await decryptStorageSecret(ciphertext as string)
  } catch (err) {
    // Fail CLOSED: there is no platform fallback for a customer's bucket.
    return { ok: false, code: 'secret_unusable', message: err instanceof Error ? err.message : String(err) }
  }
  const c = cfg.config
  // Field by field, never a spread of what the row holds.
  return {
    ok: true,
    endpoint: c.endpoint,
    region: c.region,
    bucket: c.bucket,
    prefix: c.prefix,
    accessKeyId: c.accessKeyId,
    forcePathStyle: c.forcePathStyle,
    target: cfg.target,
    secret,
    mode: cfg.mode,
  }
}

type Read = { data: unknown; error: { message: string } | null }

async function configQuery(admin: SupabaseClient, workspaceId: string, withMode: boolean): Promise<Read> {
  return await admin
    .from('workspace_storage')
    .select(withMode ? 'mode, provider, provider_config' : 'provider, provider_config')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
}

async function secretQuery(admin: SupabaseClient, workspaceId: string): Promise<Read> {
  return await admin
    .from('workspace_storage_secrets')
    .select('secret_ciphertext')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
}

function configOf({ data, error }: Read): BucketConfigRead {
  if (error) return { ok: false, code: 'storage_read_failed', message: error.message }
  const ws = data as { mode?: string | null; provider?: string | null; provider_config?: unknown } | null
  const mode = ws?.mode ?? null
  if (ws?.provider !== 's3' || !ws.provider_config) return { ok: true, s3: false, mode }
  const config = ws.provider_config as S3Config
  return { ok: true, s3: true, mode, config, target: s3TargetOf(config) }
}
