// =============================================================================
// s3Presign.test.js — Session 37.
//
// Pins supabase/functions/_shared/s3Presign.ts ACROSS the Deno/Node boundary
// (the storageGcReserved.test.js arrangement: the Edge-side file is the one
// under test, imported directly — it is deliberately runtime-agnostic).
//
// 🚨 THE ANCHOR IS AWS'S OWN PUBLISHED EXAMPLE ("Authenticating Requests:
// Using Query Parameters (AWS Signature Version 4)"): the documented
// examplebucket GET presign, whose canonical-request hash and final
// signature are fixed constants. Reproducing a published vector is what
// separates "signs consistently" from "signs correctly" — a self-consistent
// wrong implementation passes every round-trip test and fails against the
// one number it did not produce itself. Verified independently against a
// node:crypto implementation during S37; both agree with the constant.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  presignS3Request, s3HostAndPath,
} from '../../../../supabase/functions/_shared/s3Presign.ts'

// The AWS documented example, verbatim.
const AWS_EXAMPLE = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  bucket: 'examplebucket',
  key: 'test.txt',
  now: new Date('2013-05-24T00:00:00Z'),
  expiresSeconds: 86400,
  signature: 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
}

describe('the AWS published example is reproduced exactly', () => {
  it('signs the documented examplebucket GET to the documented signature', async () => {
    const url = await presignS3Request({
      // The example uses the legacy global endpoint host s3.amazonaws.com
      // with virtual-host addressing.
      target: { endpoint: 'https://s3.amazonaws.com', region: AWS_EXAMPLE.region, bucket: AWS_EXAMPLE.bucket, forcePathStyle: false },
      accessKeyId: AWS_EXAMPLE.accessKeyId,
      secretAccessKey: AWS_EXAMPLE.secretAccessKey,
      method: 'GET',
      key: AWS_EXAMPLE.key,
      expiresSeconds: AWS_EXAMPLE.expiresSeconds,
      now: AWS_EXAMPLE.now,
    })
    const u = new URL(url)
    expect(u.host).toBe('examplebucket.s3.amazonaws.com')
    expect(u.pathname).toBe('/test.txt')
    expect(u.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(u.searchParams.get('X-Amz-Credential'))
      .toBe('AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request')
    expect(u.searchParams.get('X-Amz-Date')).toBe('20130524T000000Z')
    expect(u.searchParams.get('X-Amz-Expires')).toBe('86400')
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
    expect(u.searchParams.get('X-Amz-Signature')).toBe(AWS_EXAMPLE.signature)
  })

  it('a one-byte change to the secret changes the signature (no constant path)', async () => {
    const url = await presignS3Request({
      target: { endpoint: 'https://s3.amazonaws.com', region: AWS_EXAMPLE.region, bucket: AWS_EXAMPLE.bucket, forcePathStyle: false },
      accessKeyId: AWS_EXAMPLE.accessKeyId,
      secretAccessKey: AWS_EXAMPLE.secretAccessKey + 'x',
      method: 'GET',
      key: AWS_EXAMPLE.key,
      expiresSeconds: AWS_EXAMPLE.expiresSeconds,
      now: AWS_EXAMPLE.now,
    })
    expect(new URL(url).searchParams.get('X-Amz-Signature')).not.toBe(AWS_EXAMPLE.signature)
  })
})

describe('addressing: virtual-host vs path style (the forcePathStyle story)', () => {
  it('bare AWS defaults to virtual-host', () => {
    const { host, path } = s3HostAndPath({ region: 'eu-central-1', bucket: 'b' }, 'k/x.mov')
    expect(host).toBe('b.s3.eu-central-1.amazonaws.com')
    expect(path).toBe('/k/x.mov')
  })

  it('a custom endpoint defaults to path-style (the MinIO quickstart shape)', () => {
    const { host, path } = s3HostAndPath(
      { endpoint: 'https://minio.example.com:9000', region: 'us-east-1', bucket: 'b' }, 'k/x.mov',
    )
    expect(host).toBe('minio.example.com:9000')
    expect(path).toBe('/b/k/x.mov')
  })

  it('forcePathStyle forces each direction explicitly', () => {
    expect(s3HostAndPath(
      { endpoint: 'https://s3.us-west-004.backblazeb2.com', region: 'us-west-004', bucket: 'b', forcePathStyle: false }, 'k',
    ).host).toBe('b.s3.us-west-004.backblazeb2.com')
    expect(s3HostAndPath(
      { region: 'us-east-1', bucket: 'b', forcePathStyle: true }, 'k',
    ).path).toBe('/b/k')
  })

  it('refuses a non-https endpoint — media does not cross the wire in the clear', () => {
    expect(() => s3HostAndPath({ endpoint: 'http://minio.local', region: 'r', bucket: 'b' }, 'k'))
      .toThrow(/https/)
  })

  // S37 review: the resolver builds the URL path itself, so a mount point in
  // the endpoint would be SILENTLY DROPPED and every signature computed over
  // a canonical URI the gateway never sees — surfacing as a 404 that blames
  // the bucket. Refused in three layers; this is the signer's.
  it.each([
    ['a path (reverse-proxied MinIO)', 'https://storage.example.com/minio'],
    ['a bare trailing path', 'https://storage.example.com/s3'],
    ['a query', 'https://storage.example.com?x=1'],
    ['userinfo', 'https://user@storage.example.com'],
  ])('refuses an endpoint carrying %s', (_label, endpoint) => {
    expect(() => s3HostAndPath({ endpoint, region: 'r', bucket: 'b' }, 'k'))
      .toThrow(/host only/)
  })

  it('still accepts host and host:port — the rule bounds the path, not the port', () => {
    expect(s3HostAndPath({ endpoint: 'https://minio.example.com:9000', region: 'r', bucket: 'b' }, 'k').host)
      .toBe('minio.example.com:9000')
    // A bare trailing slash is the same origin, not a path — accepted, and
    // the DB CHECK refuses it earlier for canonical-form reasons anyway.
    expect(s3HostAndPath({ endpoint: 'https://minio.example.com/', region: 'r', bucket: 'b' }, 'k').host)
      .toBe('minio.example.com')
  })

  it('encodes key segments the AWS way (parentheses, spaces, plus)', () => {
    const { path } = s3HostAndPath(
      { region: 'us-east-1', bucket: 'b' }, 'projects/p/asset (final)+v2/f x.mov',
    )
    expect(path).toBe('/projects/p/asset%20%28final%29%2Bv2/f%20x.mov')
  })
})

describe('refusals', () => {
  const base = {
    target: { region: 'us-east-1', bucket: 'b' },
    accessKeyId: 'A', secretAccessKey: 'S', method: 'GET',
    expiresSeconds: 300, now: new Date('2026-01-01T00:00:00Z'),
  }

  it('refuses a leading-slash or traversal key', async () => {
    await expect(presignS3Request({ ...base, key: '/etc/x' })).rejects.toThrow(/non-canonical/)
    await expect(presignS3Request({ ...base, key: 'a/../b' })).rejects.toThrow(/non-canonical/)
    await expect(presignS3Request({ ...base, key: 'a/./b' })).rejects.toThrow(/non-canonical/)
  })

  // 🚨 THE GATES MUST AGREE. This guard was a substring test (`includes('..')`)
  // while checkRowShapedPath rejects only a segment that IS a dot run — so a
  // file the product itself writes, `render..v2.mov` (uploadFile's sanitiser
  // preserves dots), passed the shape gate and then 500ed here, permanently
  // and only on this provider. A doubled dot inside a segment is an ordinary
  // S3 key: only a standalone `..` segment is traversal, and only that
  // normalises in a URL path. Found by S37's adversarial review.
  it('accepts a doubled dot INSIDE a segment — a legal key the uploader writes', async () => {
    const url = await presignS3Request({
      ...base, key: 'projects/p/assets/a/1754612345678-render..v2.mov',
    })
    expect(new URL(url).pathname).toContain('render..v2.mov')
  })

  it('accepts a doubled dot in a prefix segment, for the same reason', async () => {
    const url = await presignS3Request({ ...base, key: 'wilson..media/projects/p/a/f.mov' })
    expect(new URL(url).pathname).toContain('wilson..media')
  })

  it('refuses an out-of-range expiry', async () => {
    await expect(presignS3Request({ ...base, key: 'k', expiresSeconds: 0 })).rejects.toThrow(/expiry/)
    await expect(presignS3Request({ ...base, key: 'k', expiresSeconds: 700000 })).rejects.toThrow(/expiry/)
  })
})
