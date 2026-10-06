# SESSION 37 launch prompt — S3-COMPATIBLE STORAGE (THE FIRST BYO PROVIDER)

> **§4a2 + §4a2b of `docs/NETWORK_STORAGE_DESIGN.md`.** The second member of
> the BYO storage family, after `network` (the NAS, S34). One adapter covers
> **AWS S3, Backblaze B2, Wasabi, Hetzner, Cloudflare R2 and MinIO** — they
> all speak the same API.

> 🚨 **BLOCKED BY S36** (the provider registry). S36 builds
> `workspace_storage.provider`, the JSONB config column, the conditional
> CHECKs and the four-function interface. Building this first would hardcode
> S3 beside `network` and force Drive to fork it — exactly what §4a2b was
> written to prevent.
>
> ⭐ **THIS IS THE FIRST PROVIDER ON PURPOSE, AND IT INVERTS THE OBVIOUS
> ORDER.** Google Drive is the one that gets asked for; S3 is the one that is
> cheaper to build. **No OAuth consent screen, no Google app verification, no
> restricted-scope assessment, no calendar dependency on a third party** —
> just endpoint, region, bucket, prefix, key and secret. It also covers six
> providers at once. Ship the cheap one first and learn the shape on it.
>
> ⚠️ **ADDITIVE ONLY.** The NAS path must behave identically afterwards.

> **STATE — re-measure, do not trust this block.** After **S36**
> (2026-08-07): migrations **0000–0050** on all three envs, next free
> **0051**. pgTAP **60 suites / 1013 assertions**, next suite **61**. Vitest
> **1048 / 48 files**. 🚨 **Read the working tree** — a design written mid-S31
> cited "0046, next free" and was wrong within the hour.
>
> ⭐ **S36 SHIPPED THE REGISTRY THIS SESSION PLUGS INTO. Read its outcome
> block in `MASTER_PLAN_S19_ONWARD.md` before this brief.** What is already
> built, so S37 must NOT rebuild it:
> - `workspace_storage.provider` (TEXT + CHECK) and `provider_config` (ONE
>   JSONB). **S37 adds `'s3'` to `workspace_storage_provider_chk` in its OWN
>   migration, alongside the adapter** — suite 60 currently asserts `'s3'` is
>   REFUSED, so that probe MUST be inverted in the same commit that makes it
>   resolvable. That inversion is the deliberate tripwire, not a test failure.
> - The four-function contract (`put`/`get`/`del`/`exists` + `describe`) in
>   `src/tools/rabbit_v0.1.0/storage/`. `registerStorageProvider()` refuses an
>   implementation missing any of them. **A provider is those functions —
>   never a fork of the 116-method backend adapter.**
> - `fileProviderFor()` is the ONE mapping from a workspace provider to a
>   `files.storage_provider` value, **and it pins financial files to
>   `'supabase'` unconditionally.** Its vitest is table-driven over every
>   provider value, so adding `'s3'` without thinking about money fails there.
> - `files_money_provider_chk` (0050) enforces the same rule in the database
>   on both axes. **Do not add a second money gate** — 0042's one-definition
>   rule.
> - `supabaseAdapter.uploadFile` passes `WORKSPACE_PROVIDERS.PETAL` as a
>   CONSTANT today. **S37's job includes replacing that one argument with the
>   workspace's configured provider** — it is the seam, and it is deliberately
>   the only line that needs to change there.
> - 🚨 `workspace_storage_root_provider_path_chk` refuses a `root_path` under
>   any provider but `'network'`. An S3 workspace stores its endpoint/bucket
>   in `provider_config`, **never** in `root_path`.
>
> 🚨 **THREE TRAPS S36'S REVIEW FOUND AND LEFT FOR THIS SESSION. Read these
> before writing the migration.**
> 1. **`provider_config_chk` PERMITS a config, it does not REQUIRE one.**
>    Widening `workspace_storage_provider_chk` to `'s3'` and stopping there
>    leaves `provider='s3'` + `provider_config` NULL legal — "looks
>    configured, resolves nowhere", the exact failure the registry exists to
>    prevent, reproduced one provider later. **S37 must add its own
>    required-direction arm**, e.g.
>    `CHECK (provider <> 's3' OR provider_config ? 'bucket')`, plus a probe and
>    a breaker for it.
> 2. **Replacing `uploadFile`'s constant is not quite one line.**
>    `fileProviderFor('network')` returns `'local_server'`, which the registry
>    deliberately does NOT register — a browser cannot write to a NAS, and that
>    path runs through `localServerAdapter`/Express instead. A cloud-mode
>    workspace configured as `network` must be **refused with a sentence**, not
>    routed. Decide that behaviour explicitly.
> 3. **Deploy order is load-bearing.** `fetchWorkspaceStorage`'s select list is
>    the de-facto read allowlist; adding a column to it makes the renderer
>    hard-depend on the migration, and App.jsx's catch SWALLOWS a failed read
>    (S34's "a failed read pushes nothing"), so every desktop would silently
>    fall back to its local disk. **Migration to all three envs BEFORE the git
>    push**, as S36 did.
>
> ⚠️ **`files.storage_provider` is a NAMED ENUM** (`public.storage_provider`,
> 0000), unlike `workspace_storage.provider` which is TEXT+CHECK. If S3 bodies
> need a new enum value, remember **`ALTER TYPE … ADD VALUE` cannot USE the new
> value in the same transaction** — the value-add and anything that writes it
> are two migrations, not one. Measure whether a new value is needed at all
> before adding one: the enum's `google_drive` label already has zero writers.

## Start ritual (before touching anything)

1. **Load the `wilson-app` skill** and skim its `versioning.md`.
2. **Re-measure the STATE block**: `git log --oneline -3`, `git status
   --short`, `ls supabase/migrations | tail`, `ls supabase/tests/rls | tail`,
   and `supabase/.temp/linked-project.json` **and** `project-ref` (both must
   say wilson-dev before anything writes).
3. **Read `docs/OUTSTANDING.md`** and **`docs/SYSTEMS_HANDBOOK.md` §12.7 +
   §17**.
4. **Read `NETWORK_STORAGE_DESIGN.md` §4a2 + §4a2b** and the **S36 outcome
   block** — the interface this implements is defined there, not here.
5. **Re-verify every `file:line` citation in this brief by SYMBOL.**

---

## Why this exists

A customer with no office server and no appetite for a VPN still wants their
own storage. §4a2 measured why that row is strictly better than the office
server for them: **their bucket is already internet-reachable and already
authenticated, by their own provider, at no cost to Petal.** It may remove
the need for the file gateway entirely — which is why the design says to
evaluate this *before* committing 3–5 sessions to one.

The handbook already carries the locked decision (§12.1): *"S3-compatible
providers (AWS, Hetzner) come post-1.0 **through one adapter**."* This is
that adapter.

## What this needs

### 1. The config shape (into S36's `provider_config` JSONB)

```
{ endpoint, region, bucket, prefix, accessKeyId, secretRef, forcePathStyle }
```

- **`endpoint` is what makes it six providers, not one.** AWS is the default;
  B2/Wasabi/Hetzner/R2/MinIO are the same API at a different host.
- **`forcePathStyle`** — MinIO and some self-hosted gateways need path-style
  addressing rather than virtual-host style. Getting this wrong presents as a
  DNS failure, which reads as "the bucket does not exist". Put it in the
  config and say so in the error.
- **`prefix`** is the tenant's chosen root inside the bucket, and it is the
  analogue of S34's `root_path`. **Apply the same discipline**: no leading
  slash, no trailing slash, canonical form enforced by a CHECK, because the
  same drift that broke every file under a trailing-separator root (§3.2,
  measured) applies verbatim to a key prefix.

### 2. 🚨 The secret must never reach the browser

**This is the design decision of the session.** A bucket secret in the
renderer is a bucket secret in devtools, in a heap snapshot, and in any
extension the user has installed.

**Use the 0028 precedent exactly.** `workspace_ai_keys` stores a per-company
Anthropic key as **AES-256-GCM ciphertext** — `base64(iv ‖ ciphertext ‖
tag)`, the key living in an **Edge Function secret** (`WILSON_AI_KEY_SECRET`)
and **never in Postgres**, written by one Edge Function, read by another,
both `service_role`, and *"no client reads a key back; the console sees
`key_hint` only."* That is this session's model, with a storage-shaped twin
of `_shared/aiKeyCrypto.ts`.

**Then the transfer itself: presigned URLs.**

- An Edge Function decrypts the secret server-side and mints a **short-lived
  presigned PUT/GET** for one object key.
- The client uploads/downloads **direct to the customer's bucket** — Petal
  never proxies the bytes, so there is no egress cost and no size ceiling of
  our making.
- ⚠️ **The presign endpoint is an authorisation boundary, not a formality.**
  It must check the caller may write that project *before* minting, or it
  becomes a signing oracle for any authenticated user. Mirror S33's RPC
  lesson: **a function that replicates a policy must replicate ALL of it**,
  and `COALESCE(..., false)` when a policy predicate moves into procedural
  code, because NULL fails CLOSED in a policy and OPEN in an `IF`.

### 3. CORS is a setup requirement, not a bug report

A browser PUT to a customer bucket needs a CORS rule on **their** bucket
(`PUT`, `GET`, the app origins, `ETag` exposed). Without it the upload fails
with an opaque network error and no server log — the single most likely
support call this feature will generate.

- The config-time probe (S34's pattern: probe at CONFIGURATION time, with a
  sentence a person can act on) must **actually attempt a small round trip**
  and report CORS specifically when that is what failed.
- The setup guidance goes in **`SYSTEMS_HANDBOOK.md` §12.7**, beside the NAS
  and VPN material, with the exact JSON rule to paste.
- Desktop uploads do not hit CORS. **Say that plainly** rather than letting a
  customer conclude the desktop app is "the one that works".

### 4. Lifecycle parity — the part that is easy to forget

- **Purge deletes at the provider AND writes the certificate**
  (`TPN-CONT-002`). A file whose body outlives its deletion record is the
  failure this project has already documented twice.
- **A thumbnail dies with its source** (S36's rule) wherever both live.
- **`downloaded` logging is advisory here by construction** — a presigned GET
  is served by the customer's provider and WILSON never sees it. That is
  already the stated limit for cloud (S33); repeat it in the brief's outcome
  block rather than discovering it in an audit.
- 🚨 **Resolve a file's provider FROM THE FILE ROW**, never from the
  workspace's current setting. A workspace that switches provider must not
  orphan what it already wrote (S36 pins this; do not regress it).

### 5. Money stays home

**Financial files pin `storage_provider = 'supabase'` regardless of the
workspace's provider** — S36's invariant, enforced at the `uploadFile`
`scope.financial` branch. An S3 bucket policy cannot express "managers of
this project only". Do not attempt it. **Test it here too**, because this is
the first session where the temptation is real.

### 6. Suite + proof

New pgTAP suite, registered in **BOTH** rls.yml lists. Plus vitest over the
pure parts (key building, prefix canonicalisation, endpoint/path-style
resolution) and a **wiring test** that the presign Edge Function is actually
called by the upload path — six features in this repo have shipped complete
with no caller.

Probes: presign refused for a non-member; refused for a project the caller
cannot write; **a financial upload lands on Supabase even with S3
configured** (the invariant); prefix canonical-form refusals; and a breaker
per arm.

## Standing traps

Never `supabase config push`. `git add -A` sweeps untracked files into a
PUBLIC repo. Never interpolate content into a shell command. Query the
database rather than trusting migration text; read
`supabase/.temp/linked-project.json` first. One query per `--file`. Count
`<!--`/`-->` after editing long markdown. Deploy order: dev → staging → prod
BEFORE the git push; re-link to wilson-dev after.

🚨 **Never print a bucket secret into a transcript.** The `service_role`
incident (S19) started as a filter that assumed line-per-key JSON. Select the
one field; never dump the config object.

🚨 **Run the adversarial review before deploying.** A credential path and a
signing endpoint are exactly where the last three reviews found their highs.

## Close-out ritual

1. `docs/OUTSTANDING.md` — delete what is fixed, cite the commit.
2. Sequence table + an S37 outcome block in `MASTER_PLAN_S19_ONWARD.md`.
3. Migration verified **by query on dev, staging AND prod**.
4. `tap-all` clean + full vitest + new suite in BOTH rls.yml lists + CI green
   on the pushed head, Playwright included.
5. **`SYSTEMS_HANDBOOK.md` §12.7 gains the bucket setup guidance** (CORS rule,
   the six providers, what desktop vs browser changes).
6. Refresh the STATE block of `SESSION_38_prompt.md`; update the Claude
   auto-memory in the same pass.
7. Close out in the chat with the remaining-session list and a plain-English
   breakdown. Never let a diagnosis read as a fix.
