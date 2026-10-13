// =============================================================================
// _shared/s3Presign.ts — Session 37
//
// AWS Signature Version 4 QUERY presigning (and nothing else) for
// S3-compatible object storage. One implementation covers AWS S3, Backblaze
// B2, Wasabi, Hetzner, Cloudflare R2 and MinIO — they all speak this exact
// protocol; only the endpoint host differs (§4a2b sequencing note).
//
// Used by storage-presign (minting short-lived PUT/GET/DELETE/HEAD URLs the
// client fetches DIRECTLY against the customer's bucket — Petal never
// proxies the bytes, §4a2's "direct" condition) and by storage-gc (signing
// its own DELETEs when draining s3 queue rows server-side).
//
// DELIBERATELY DEPENDENCY-FREE AND RUNTIME-AGNOSTIC: Web Crypto + URL only,
// no Deno.* APIs, no imports — so src/tools/rabbit_v0.1.0's vitest can
// import this exact file across the Deno/Node boundary and pin it against
// AWS's published SigV4 example (the reservedObjects.ts precedent: the
// Edge-side copy is the one under test, not a re-implementation).
//
// The clock is a PARAMETER (`now`), never Date.now() read internally —
// signatures are time-derived, and an injectable clock is what makes the
// AWS documented example reproducible in a test.
//
// ADDRESSING (the forcePathStyle story, brief §1):
//   * virtual-host style — https://{bucket}.{host}/{key}   (AWS default)
//   * path style        — https://{host}/{bucket}/{key}    (MinIO, some
//     self-hosted gateways; getting this wrong presents as a DNS failure on
//     the bucket subdomain, which reads as "the bucket does not exist")
//   When forcePathStyle is not set: a CUSTOM endpoint defaults to
//   path-style (the shape every MinIO quickstart assumes and every major
//   S3-compatible accepts); bare AWS defaults to virtual-host (AWS has
//   deprecated path-style for new buckets). The config can force either.
// =============================================================================

export type S3Target = {
  /** Custom endpoint origin, e.g. "https://s3.us-west-004.backblazeb2.com". Absent = AWS. */
  endpoint?: string | null
  region: string
  bucket: string
  forcePathStyle?: boolean | null
}

export type PresignInput = {
  target: S3Target
  accessKeyId: string
  secretAccessKey: string
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD'
  /** The FULL object key inside the bucket — any workspace prefix already applied. */
  key: string
  expiresSeconds: number
  /** Injectable clock — see header. */
  now: Date
}

// AWS's uri-encode: unreserved characters A-Za-z0-9-_.~ stay literal,
// everything else (including the characters encodeURIComponent leaves bare:
// ! ' ( ) *) is %XX upper-case.
function awsEncode(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  )
}

// Encode an object key as a canonical URI path: per-segment, '/' preserved.
function encodeKeyPath(key: string): string {
  return key.split('/').map(awsEncode).join('/')
}

function hexOf(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256Hex(s: string): Promise<string> {
  return hexOf(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
}

async function hmac(keyBytes: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes instanceof Uint8Array ? (keyBytes.buffer as ArrayBuffer).slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) : keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
}

/** Resolve host + URL path for a target/key — exported for the unit tests. */
export function s3HostAndPath(target: S3Target, key: string): { host: string; path: string } {
  const endpoint = (target.endpoint ?? '').trim()
  let host: string
  let pathStyle: boolean
  if (endpoint) {
    let u: URL
    try {
      u = new URL(endpoint)
    } catch {
      throw new Error(`the S3 endpoint is not a valid URL: ${endpoint}`)
    }
    if (u.protocol !== 'https:') {
      throw new Error('the S3 endpoint must be https:// — pre-release content does not cross the wire in the clear')
    }
    // 🚨 HOST ONLY. This resolver builds the URL path itself, so anything in
    // the endpoint's own path would be SILENTLY DROPPED — a reverse-proxied
    // MinIO at `https://storage.example.com/minio` would sign requests
    // against `https://storage.example.com/<bucket>/<key>`, hitting the wrong
    // origin path with a signature computed over a canonical URI the gateway
    // never sees. Refused with a sentence rather than dropped, because the
    // failure otherwise surfaces as "bucket does not exist" and sends the
    // admin to check the one field that was right. Found by S37's review.
    if ((u.pathname && u.pathname !== '/') || u.search || u.username) {
      throw new Error(
        `the S3 endpoint must be a host only (https://host or https://host:port) — remove "${u.pathname}${u.search}" from it`,
      )
    }
    host = u.host
    pathStyle = target.forcePathStyle ?? true
  } else {
    host = `s3.${target.region}.amazonaws.com`
    pathStyle = target.forcePathStyle ?? false
  }
  if (pathStyle) {
    return { host, path: `/${awsEncode(target.bucket)}/${encodeKeyPath(key)}` }
  }
  return { host: `${target.bucket}.${host}`, path: `/${encodeKeyPath(key)}` }
}

function amzTimestamp(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return { amzDate: iso, dateStamp: iso.slice(0, 8) }
}

/**
 * Produce a presigned URL for one request against one object key.
 *
 * SigV4 query presigning, X-Amz-SignedHeaders=host only and
 * UNSIGNED-PAYLOAD, which is the standard presigned-S3 shape: the caller
 * may send any body and any content-type — authority is scoped by METHOD +
 * KEY + EXPIRY, which is exactly what the storage-presign function
 * authorises. The signature is validated by the provider when the request
 * STARTS, so an upload may keep streaming past the expiry.
 */
export async function presignS3Request(input: PresignInput): Promise<string> {
  const { target, accessKeyId, secretAccessKey, method, key, expiresSeconds, now } = input
  // 🚨 SEGMENT-WISE, not a substring test — and the difference is a real
  // outage. A doubled dot INSIDE a segment is an ordinary S3 key character
  // sequence, and `uploadFile`'s sanitiser preserves dots, so a file called
  // `render..v2.mov` produces a perfectly legal key. A `key.includes('..')`
  // guard refused it here while `checkRowShapedPath` had already accepted it
  // — two gates disagreeing about a path the product itself writes, which
  // made that file permanently untransferable (and a prefix like
  // `wilson..media`, which the CHECK accepts, broke EVERY presign in the
  // workspace). Only a segment that IS `.` or `..` is path traversal, and
  // only that normalises in a URL path. Found by S37's adversarial review.
  const segments = key.split('/')
  if (!key || key.startsWith('/') || segments.some(s => s === '.' || s === '..')) {
    throw new Error(`refusing to presign a non-canonical key: ${key}`)
  }
  if (!Number.isFinite(expiresSeconds) || expiresSeconds <= 0 || expiresSeconds > 604800) {
    throw new Error(`presign expiry out of range: ${expiresSeconds}`)
  }

  const { host, path } = s3HostAndPath(target, key)
  const { amzDate, dateStamp } = amzTimestamp(now)
  const scope = `${dateStamp}/${target.region}/s3/aws4_request`

  const params: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresSeconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ]
  const canonicalQuery = params
    .map(([k, v]) => [awsEncode(k), awsEncode(v)] as [string, string])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')

  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n')

  // The HMAC key derivation chain: AWS4+secret → date → region → service →
  // "aws4_request".
  const kDate = await hmac(new TextEncoder().encode(`AWS4${secretAccessKey}`), dateStamp)
  const kRegion = await hmac(kDate, target.region)
  const kService = await hmac(kRegion, 's3')
  const kSigning = await hmac(kService, 'aws4_request')
  const signature = hexOf(await hmac(kSigning, stringToSign))

  return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`
}
