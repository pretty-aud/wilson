// =============================================================================
// _shared/s3Look.ts — MO1 (0120): the server's look at one object in a company's
// own bucket, and what it tells the database.
//
// Why it exists: a move that makes a new copy queues the old one for deletion.
// In Petal's storage the database can see the new copy for itself. A bucket it
// cannot reach, so the key would be taken on the caller's word and the only body
// queued (MOTH_DESIGN.md, 0118's note and 0120's entry). So Petal's server makes
// a signed HEAD, as the storage-gc drain makes its signed DELETEs, and on a 200
// it records the look; files_body_follow spends that record at the commit.
//
// A HEAD carries no bytes, so §4a2's "Petal never proxies the body" stands. Only
// a 200 is a sighting: a redirect is followed nowhere and a refusal is not read
// as "absent", because what this protects is a body about to be queued.
//
// The steps are injected and nothing here touches the world, so vitest imports
// this exact file and runs every answer (src/cloud/s3Look.test.js). The signer,
// the vetted request and the database's real shape are in storage-presign and
// pinned by storagePresignBoundary.test.js and suite 123.
// =============================================================================

export type LookAnswer = { status: number; body: Record<string, unknown> }

export type LookSteps<V> = {
  /** The host the signer will name. May throw on a config it cannot use. */
  host: () => string
  /** s3Reach's vet of that host: nothing is contacted unless every answer is public. */
  vet: (host: string) => Promise<({ ok: true } & V) | { ok: false; reason?: string; detail: string }>
  /** A signed HEAD for the key, the company's prefix applied. */
  sign: () => Promise<string>
  /** One request to the vetted address. */
  request: (url: string, vetted: { ok: true } & V) => Promise<{ status: number; redirect: boolean }>
  /** public.s3_body_look_record, which answers true when it wrote the look. */
  record: () => PromiseLike<{ data: unknown; error: unknown }>
}

const failed = (detail: string): LookAnswer => ({ status: 502, body: { error: 'look_failed', detail } })

export async function lookAtObject<V>(steps: LookSteps<V>): Promise<LookAnswer> {
  let vetted: ({ ok: true } & V) | { ok: false; reason?: string; detail: string }
  try {
    vetted = await steps.vet(steps.host())
  } catch (err) {
    return failed(`the bucket's address could not be checked (${err instanceof Error ? err.message : String(err)})`)
  }
  // A name that did not resolve just now is a fault, which may pass. The rest are the endpoint's own.
  if (!vetted.ok) {
    return vetted.reason === 'dns' ? failed(vetted.detail) : { status: 409, body: { error: 'refused', detail: vetted.detail } }
  }

  let answer: { status: number; redirect: boolean }
  try {
    answer = await steps.request(await steps.sign(), vetted)
  } catch (err) {
    return failed(`the bucket could not be reached (${err instanceof Error ? err.message : String(err)})`)
  }
  if (answer.redirect) return failed('the bucket answered with a redirect, which is not followed')
  if (answer.status === 404) return { status: 200, body: { ok: true, seen: false } }
  if (answer.status === 403) {
    return { status: 409, body: { error: 'refused', detail: 'your company\'s bucket refused WILSON\'s server a look at the new copy, so nothing moved. An admin can check the bucket\'s access rules' } }
  }
  if (answer.status !== 200) return failed(`the bucket answered ${answer.status}`)

  const { data, error } = await steps.record()
  if (error) return { status: 500, body: { error: 'look_not_recorded', detail: 'WILSON could not check the new copy in your company\'s bucket just now, so nothing moved' } }
  if (data !== true) return { status: 409, body: { error: 'refused', detail: 'this copy is not one this company can move a file to' } }
  return { status: 200, body: { ok: true, seen: true } }
}
