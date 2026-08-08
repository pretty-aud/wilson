# SESSION 38 launch prompt — GOOGLE DRIVE (THE THIRD BYO PROVIDER)

> **§4a2 + §4a2b of `docs/NETWORK_STORAGE_DESIGN.md`.** The third member of
> the BYO storage family, after `network` (NAS, S34) and `s3` (S37). For the
> customer with no office server and no bucket, but a Google Workspace they
> already pay for.

> 🚨 **BLOCKED BY S36** (the provider registry) **and SEQUENCED AFTER S37.**
> S37 is not a technical dependency — it is the cheaper provider, so it
> proves the registry's shape without a third-party approval in the critical
> path. If S37 found the interface wanting, fix it there, not here.
>
> ⚠️ **ADDITIVE ONLY.** NAS and S3 must behave identically afterwards
> (Audrey, 2026-08-07: *"dont remove other options"*).

> ⏳ **THIS SESSION HAS A CALENDAR DEPENDENCY NOTHING ELSE IN THE PLAN HAS.**
> Google's OAuth consent-screen verification is a review by another company on
> their schedule. **The submission checklist is `docs/OWED_AUDREY.md` §13** —
> written 2026-08-07 so it can be filed early and idle. **Check it is done
> before starting this session**; if it is not, file it and run another
> session while it clears. Everything else here is ordinary work.

> **STATE — re-measure, do not trust this block.** After **S37**
> (2026-08-08): migrations **0000–0052** on all three envs, next free
> **0053**. pgTAP **62 suites / 1077 assertions**, next suite **63**. Vitest
> **1159 / 53 files**. 🚨 **Read the working tree** — this block has been
> stale within the hour before, and it was stale again inside S37 itself:
> 0052 landed after the review, from the review.
>
> ⭐ **S37 SETTLED THE SHAPE THIS SESSION COPIES. Read its outcome block in
> `MASTER_PLAN_S19_ONWARD.md` before this brief.** What gdrive inherits:
> - **The recipe is now exercised twice**: one registry entry + one enum
>   value + widen `workspace_storage_provider_chk` (EXPLICIT DROP + re-ADD —
>   a wrapped ADD is a silent replay no-op) + gdrive's OWN required-config
>   arm, alphabetically AFTER every existing constraint name.
> - **Suite 60's "gdrive is refused" probe MUST be inverted in the same
>   commit** — S37's inversion of its s3 twin (same INSERT, new expected
>   constraint) is the exact template, and suite 61 asserts gdrive is STILL
>   refused, so that probe moves too.
> - 🚨 **The pre-apply shim cannot test a migration whose enum value the
>   suite USES** (one transaction; a new enum value is unusable in it).
>   Apply to dev first, then suites, then breakers via explicit
>   DROP/replace — S37's seven-breaker matrix is the template.
> - **The credential pattern is built**: `workspace_storage_secrets` +
>   `_shared/storageSecretCrypto.ts` hold ONE secret slot per workspace.
>   Drive's refresh token either shares that slot (a workspace has one BYO
>   provider at a time — measure whether that holds) or motivates the named
>   slot S37 deliberately did not build (`secretRef` — see its correction 3).
> - **storageRegistry.test.js + storagePresignBoundary.test.js pin the
>   vocabulary and the wiring as text** — they will fail, deliberately, the
>   moment gdrive is added to one side and not the other.
> - 🚨 **CORS is not browser-only** (S37 measured the brief wrong): the
>   desktop renderer enforces it too. Drive's upload path (resumable
>   sessions to googleapis.com) must be checked for the same class of
>   failure on BOTH surfaces before promising anything.
> - `googleDriveAdapter.js` (57 readOnly() stubs) is still the shape to
>   AVOID: gdrive is five functions in `storage/`, not that file finished.

## Start ritual (before touching anything)

1. **Load the `wilson-app` skill** and skim its `versioning.md`.
2. **Re-measure the STATE block** (`git log`, `git status --short`,
   `ls supabase/migrations | tail`, `ls supabase/tests/rls | tail`, and
   `supabase/.temp/linked-project.json` **and** `project-ref` — both must say
   wilson-dev before anything writes).
3. **Read `docs/OUTSTANDING.md`** and **`docs/SYSTEMS_HANDBOOK.md` §12.1 +
   §12.7 + §17**.
4. **Read `NETWORK_STORAGE_DESIGN.md` §4a2 + §4a2b**, and the **S36 and S37
   outcome blocks** — the interface and the credential pattern are settled
   there.
5. **Re-verify every `file:line` citation in this brief by SYMBOL.**

---

## Why this exists

Google Drive is the BYO option customers *ask for by name*, because they
already have it. It is deliberately **third**: it is the most expensive of
the three to build, and the only one whose timeline depends on somebody
outside Petal.

## 🚨 1. The scope decision — this is the whole cost of the session

Google tiers Drive scopes, and the tier decides whether this is a normal
session or a five-figure annual commitment:

| Scope | Tier | What it costs |
|---|---|---|
| `drive` (full) | **RESTRICTED** | Independent security assessment (CASA), **annually**, at real expense |
| `drive.file` | **not restricted** | Consent-screen verification only |

**`drive.file` grants access to files the app itself created** — which is
exactly and only what WILSON needs, because WILSON creates every file it
stores. **Design for `drive.file` and never widen it.**

⚠️ **Confirm against Google's current policy before committing** — they move
these goalposts, and the last measurement here was 2026-08-07.

⚠️ **The trade-off `drive.file` brings, and it must be said to the customer,
not discovered:** WILSON cannot see files a person drops into the Drive
folder by hand. It is a *store WILSON writes and reads*, not a folder WILSON
browses. For media storage that is correct; as a "sync my existing folder"
feature it is not, and nobody should imply otherwise in the UI copy.

**Petal ships ONE OAuth client.** Today the code expects the *customer* to
supply `clientId` and `clientSecret` in a JSON file
(`googleDriveAdapter.js` header) — no production company will create a Google
Cloud project to use WILSON. That is a developer affordance, not a product.

## 2. What NOT to build

🚨 **Do not finish `googleDriveAdapter.js`.** It is **57 `readOnly()` stubs
against a ~122-method backend interface**, modelled on one Drive folder per
project holding a `project.json` bundle, with the Drive folder ID as the
project's primary key. **It predates workspaces, RLS, `public.files`, the
folder tree (0041), the manifest and the money gate (0042).** Completing it
means reimplementing WILSON's multi-user data layer against a store with no
RLS — a rewrite that forks the security model.

This session implements **S36's four functions** (`put`/`get`/`del`/`exists`)
and nothing else. Decide explicitly what happens to the legacy adapter —
recommended: **leave it untouched and mark it legacy read-only in §12.1**,
because it is reachable today and deleting it is its own change.

## 3. The OAuth flow

- **Desktop**: loopback redirect + **PKCE** (a client secret in a shipped
  binary is not a secret; Google's installed-app guidance says so).
- **Web**: standard redirect on the beta origin.
- **The refresh token is the credential** — store it exactly as S37 stores
  the bucket secret and as `workspace_ai_keys` (0028) stores the Anthropic
  key: **AES-256-GCM ciphertext, `base64(iv ‖ ciphertext ‖ tag)`, key in an
  Edge Function secret, never in Postgres, service_role only, no client ever
  reads it back.**
- ⚠️ **Refresh tokens expire in ways bucket keys do not** — revocation,
  password change, 6-month inactivity, or the app losing verification. **Model
  "the connection died" as a first-class state** with a visible reconnect
  path. A silent failure here presents as "my files vanished".
- ⚠️ **Shared drives vs My Drive.** A company folder should live in a **shared
  drive**, or the files belong to whichever employee connected it and leave
  with them. Ask for a shared drive in the setup guidance and say why.

## 4. Drive has no paths — and that is a real consequence

`files.storage_path` holds a **Drive file ID**, not a path (§12.1 already
says this for the legacy adapter). Two things follow:

- The **folder/manifest model does not map.** Drive's own folders exist, but
  WILSON's tree is computed client-side in `folderPaths.js` and is
  authoritative in Postgres. Keep Postgres authoritative; Drive is a bag of
  bodies addressed by ID. **Do not try to mirror the tree into Drive** —
  renames would become "move every object", the problem §17 already records
  for slug-following folders.
- 🚨 **The money gate cannot be expressed in Drive at all.** No path segment,
  no RLS, and Drive's sharing model cannot say "managers of this project".
  **Financial files pin `storage_provider = 'supabase'`** — S36's invariant,
  enforced at `uploadFile`'s `scope.financial` branch. Non-negotiable, and
  tested here again.

## 5. TPN posture — say it once, clearly

Same shape as the NAS conversation (§12.7): **it is the customer's storage
and their compliance call.** Consumer Drive will not pass for pre-release
content; Google **Workspace** with enterprise controls can, but the studio
approves it per-vendor. **Support it; never market it as TPN-compliant.**
Mirror the gateway boundary Audrey already set — the label on the switch is
the useful control.

## 6. Suite + proof

- Vitest over the pure parts (ID handling, the connection-state machine,
  token-expiry classification) and a **wiring test** that the connect flow
  and the four functions have real callers.
- pgTAP for anything schema-side (the `storage_provider` value, the
  provider-config CHECK), registered in **BOTH** rls.yml lists.
- **The invariant probe**: a financial upload lands on Supabase with Drive
  configured.
- ⏳ **What tests cannot cover**: nobody in this repo can complete a Google
  OAuth consent flow in CI. **Say so in the outcome block** and give Audrey a
  numbered checklist — the S34/S35 pattern, and per those sessions'
  experience, hand it over at the START.

## Standing traps

Never `supabase config push`. `git add -A` sweeps untracked files into a
PUBLIC repo. Never interpolate content into a shell command. Query the
database rather than trusting migration text; read
`supabase/.temp/linked-project.json` first. One query per `--file`. Count
`<!--`/`-->` after editing long markdown. Deploy order: dev → staging → prod
BEFORE the git push; re-link to wilson-dev after.

🚨 **Never print a token into a transcript** (the S19 `service_role` lesson).

🚨 **Run the adversarial review before deploying.** An OAuth flow plus a
credential store is the highest-risk surface in the whole storage family.

## Close-out ritual

1. `docs/OUTSTANDING.md` — delete what is fixed, cite the commit.
2. Sequence table + an S38 outcome block in `MASTER_PLAN_S19_ONWARD.md`.
3. Any migration verified **by query on dev, staging AND prod**.
4. `tap-all` clean + full vitest + any new suite in BOTH rls.yml lists + CI
   green on the pushed head, Playwright included.
5. **`SYSTEMS_HANDBOOK.md` §12.1 and §12.7** updated: Drive as a provider vs
   the legacy read-only adapter, the shared-drive requirement, the
   `drive.file` trade-off, and the TPN posture.
6. Refresh the STATE block of `SESSION_39_prompt.md`; update the Claude
   auto-memory in the same pass.
7. Close out in the chat with the remaining-session list and a plain-English
   breakdown. Never let a diagnosis read as a fix.
