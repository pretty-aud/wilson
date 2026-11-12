// =============================================================================
// _shared/keyVersions.ts — P8 (TPN-ENC-015), night 5, 2026-10-28
//
// The two master secrets that seal every company's bucket credential
// (WILSON_STORAGE_KEY_SECRET, storageSecretCrypto.ts) and Anthropic key
// (WILSON_AI_KEY_SECRET, aiKeyCrypto.ts) were ONE value on dev, staging and
// production, so that a ciphertext from one environment opened on the others
// — and so that deploy rights on a lower environment opened production's
// rows, from any nightly dump. Each environment now holds its own value, and
// a value can be rotated without orphaning a row:
//
//   * VERSIONS. Version 1 is the unsuffixed name; version n (2 to 9) is
//     <NAME>_V<n>. The CURRENT version is the highest present: a new row is
//     sealed under it. A row is opened under the version its envelope names,
//     so every version a row was sealed under stays set until the re-seal
//     below has moved every row off it.
//   * ENVELOPES. Version 1 keeps the format every row has today:
//     base64( iv ‖ ciphertext ‖ tag ). Version n ≥ 2 is `v<n>.` followed by
//     the same base64 (a bare envelope can never begin with `v2.`: base64 has
//     no dot). A reader that does not know the prefix — one deployed before
//     P8 — fails at atob on it, which is why the procedure redeploys every
//     reader of a secret BEFORE any row is re-sealed (PRODUCTION_RUNBOOK (d),
//     "TPN-ENC-015").
//   * THE RE-SEAL. operator-ai-keys `action: 'reseal'` opens every row under
//     the version its envelope names and seals it again under the current
//     one, and writes the counts to platform_audit (secret.resealed, 0106);
//     never a value. The console's Secrets section is its face.
//
// Pure: no Deno, no WebCrypto, so the vitest suite (src/cloud/keyVersions.
// test.js) proves it and, through readEnv, the two crypto modules too.
// =============================================================================

export const MAX_KEY_VERSION = 9

/** Version 1 is the unsuffixed name; 2 to 9 are <NAME>_V<n>. */
export function secretNameFor(base: string, version: number): string {
  if (!Number.isInteger(version) || version < 1 || version > MAX_KEY_VERSION) {
    throw new Error(`key version ${version} is out of range (1 to ${MAX_KEY_VERSION})`)
  }
  return version === 1 ? base : `${base}_V${version}`
}

/** The environment: Deno's (the functions) or Node's (the tests); '' when unset. */
export function readEnv(name: string): string {
  const g = globalThis as unknown as {
    Deno?: { env?: { get?: (n: string) => string | undefined } }
    process?: { env?: Record<string, string | undefined> }
  }
  try {
    if (g.Deno?.env?.get) return g.Deno.env.get(name) ?? ''
  } catch {
    // a permission refused reads as unset
  }
  return g.process?.env?.[name] ?? ''
}

/** Every version with a non-empty value, ascending. */
export function keyVersionsPresent(base: string, getEnv: (name: string) => string = readEnv): number[] {
  const out: number[] = []
  for (let v = 1; v <= MAX_KEY_VERSION; v++) {
    if ((getEnv(secretNameFor(base, v)) ?? '').trim()) out.push(v)
  }
  return out
}

/** The highest version present (what a new row is sealed under), or null when none is set. */
export function currentKeyVersion(base: string, getEnv: (name: string) => string = readEnv): number | null {
  const present = keyVersionsPresent(base, getEnv)
  return present.length ? present[present.length - 1] : null
}

const PREFIX_RE = /^v([2-9])\.([\s\S]*)$/

/** The version an envelope names: `v<n>.` for n ≥ 2, else 1 (today's bare base64). */
export function envelopeVersion(envelope: string): { version: number; body: string } {
  const m = PREFIX_RE.exec(envelope)
  return m ? { version: Number(m[1]), body: m[2] } : { version: 1, body: envelope }
}

/** The envelope for a version: bare for 1, `v<n>.` before the body for n ≥ 2. */
export function wrapEnvelope(body: string, version: number): string {
  secretNameFor('x', version) // the range check
  return version === 1 ? body : `v${version}.${body}`
}
