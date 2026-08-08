# SESSION 38 launch prompt — GOOGLE DRIVE (THE THIRD BYO PROVIDER)

> **§4a2 + §4a2b of `docs/NETWORK_STORAGE_DESIGN.md`.** The third member of
> the BYO storage family, after `network` (NAS, S34) and `s3` (S37). For the
> customer with no office server and no bucket, but a Google Workspace they
> already pay for.

> ✅ **UNBLOCKED. S36 (the registry) and S37 (S3-compatible) are both DONE,
> and the interface held** — S37 added a provider as one registry entry, one
> enum value and one widened CHECK, with no fork and no branch in
> `uploadFile`. The question this sequencing existed to answer ("does the
> registry's shape survive a real second provider?") came back yes, so
> gdrive follows the same recipe rather than re-opening it.
>
> ⚠️ **ADDITIVE ONLY.** NAS and S3 must behave identically afterwards
> (Audrey, 2026-08-07: *"dont remove other options"*). Suites 60, 61 and 62
> are what notice if either narrows.

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
>   DROP/replace — S37's **eight**-breaker matrix is the template.
> - **The credential pattern is built**: `workspace_storage_secrets` +
>   `_shared/storageSecretCrypto.ts` hold ONE secret slot per workspace
>   (PK is `workspace_id`), encrypted under `WILSON_STORAGE_KEY_SECRET` —
>   which Drive should SHARE, since it is one credential domain and a second
>   Edge secret is a second thing to set per environment and orphan on
>   rotation. Drive's refresh token either fits that slot (`provider` is
>   single-valued, so a workspace has one BYO provider at a time — confirm
>   that still holds) or motivates the named slot S37 deliberately did not
>   build (`secretRef` — see its correction 3).
> - ⚠️ **A provider switch does NOT clear the old secret.** S37 wired a
>   manual "Remove secret" button but deliberately did not fire it on switch,
>   so a workspace moving s3 → gdrive still holds its bucket secret until the
>   new one overwrites the row. Decide explicitly whether connecting Drive
>   should clear first; leaving a dead tenant credential at rest is the kind
>   of thing a TPN re-audit asks about.
> - **storageRegistry.test.js + storagePresignBoundary.test.js pin the
>   vocabulary and the wiring as text** — they will fail, deliberately, the
>   moment gdrive is added to one side and not the other.
> - 🚨 **CORS is not browser-only** (S37 measured the brief wrong): the
>   desktop renderer enforces it too. Drive's upload path (resumable
>   sessions to googleapis.com) must be checked for the same class of
>   failure on BOTH surfaces before promising anything.
> - `googleDriveAdapter.js` (57 readOnly() stubs) is still the shape to
>   AVOID: gdrive is five functions in `storage/`, not that file finished.
> - 🚨 **The presign boundary does NOT transfer to Drive unchanged, and §7
>   below is new because of it.** S37's gate derives the project id FROM THE
>   PATH (`projects/<uuid>/…`). A Drive `storage_path` is an opaque file ID
>   that names no project, so the whole authorisation shape has to be
>   rebuilt around a row lookup. Read §4c before designing anything.
> - **`uploadFile` needs NO new branch for gdrive** — S37 replaced the Petal
>   constant with `activeWorkspaceProvider(storageChoice)`, so a new provider
>   flows through the registry automatically. The ONE existing branch is the
>   `network` refusal (a browser cannot write to a NAS). If gdrive tempts you
>   to add a second branch, the registry entry is wrong, not the seam.

## Start ritual (before touching anything)

1. **Load the `wilson-app` skill** and skim its `versioning.md`.
2. **Re-measure the STATE block** (`git log`, `git status --short`,
   `ls supabase/migrations | tail`, `ls supabase/tests/rls | tail`, and
   `supabase/.temp/linked-project.json` **and** `project-ref` — both must say
   wilson-dev before anything writes).
3. **Read `docs/OUTSTANDING.md`** and **`docs/SYSTEMS_HANDBOOK.md` §12.1 +
   §12.1a + §12.7 + §12.7a + §17**. (§12.1a is the add-a-provider recipe;
   §12.7a is S37's bucket setup section and the template for Drive's.)
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

🚨 **Do not finish `googleDriveAdapter.js`.** It is **57 `readOnly('…')`
stubs** (re-measured 2026-08-08 — the figure is exact) across its own ~68
methods, modelled on one Drive folder per project holding a `project.json`
bundle, with the Drive folder ID as the project's primary key. **It predates
workspaces, RLS, `public.files`, the folder tree (0041), the manifest and the
money gate (0042).** Completing it means reimplementing WILSON's multi-user
data layer against a store with no RLS — a rewrite that forks the security
model.

⚠️ **This paragraph used to say "against a ~122-method backend interface".
That figure is wrong and S36 corrected it** — measured: `supabaseAdapter` 116
methods, `localServerAdapter` 104, `googleDriveAdapter` 68, union 133, and
**there is no declared interface at all** (a 93-property JSDoc typedef,
unenforced and already short). Kept as a caution: a number repeated across
briefs is not a measurement.

This session implements **S36's FIVE registry functions** —
`put`/`get`/`del`/`exists` **plus `describe()`**, which
`registerStorageProvider` requires (`REQUIRED` in `storage/index.js`) — and
nothing else. Earlier drafts of this brief and of §4a2b said "four"; the
contract has been five since S36 shipped it. Decide explicitly what happens
to the legacy adapter — recommended: **leave it untouched and mark it legacy
read-only in §12.1**, because it is reachable today and deleting it is its
own change.

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

## 🚨 4b. Petal must not carry the bytes — and Drive's version of that is not obvious

§4a2's whole economic argument is that transfers go **direct**: if a byte
crosses infrastructure Petal rents, Petal pays for it, monthly, forever, for
every customer — *and* becomes a content-bearing sub-processor (§7). S37
satisfied this with presigned URLs: the Edge Function mints authority for one
object and the client talks straight to the bucket.

**Drive has no presigned URL.** The equivalents, and they are not equivalent
to each other:

- **Upload:** initiate a *resumable upload session* server-side (authenticated
  with the workspace's token) and hand the client the returned **session
  URI**, which is a capability for that one upload. This is the closest
  analogue to a presigned PUT and is the shape to aim for.
- **Download:** `files/{id}?alt=media` needs an `Authorization: Bearer`
  header — a URL alone is not authority. So either the client gets a
  **short-lived access token** (never the refresh token), or WILSON proxies
  the bytes. 🚨 **Proxying is the thing §4a2 exists to forbid** — if the
  design ends up there, stop and say so in the outcome block rather than
  shipping it quietly, because it changes Petal's cost model and its
  sub-processor status, and that is Audrey's decision and not this session's.

⚠️ **A short-lived access token in the renderer is a real trade-off, not a
formality.** It is `drive.file`-scoped, so its blast radius is files WILSON
created — bounded, but it is still a credential reaching the client, which
every other provider avoided. Decide it deliberately and write down which way
and why.

## 🚨 4c. The authorisation boundary does NOT transfer from S37 — Drive has no path to gate on

**This is the design decision of the session, and it is why Drive is not "S37
with a different `put`".**

`storage-presign` authorises like this: `checkRowShapedPath` proves the path
is `projects/<uuid>/…`, **derives the project id from the second segment**,
and evaluates `can_presign_project_write/read` for it. Every refusal hangs off
that derivation.

**A Drive `storage_path` is an opaque file ID.** It names no project, no
workspace and no path segment. So, in order:

1. **The project id must come from the `files` ROW, not the identifier.** Look
   up `files` by id (or by `storage_path`) → `project_id` → evaluate the same
   predicates. The predicates themselves (`can_presign_project_write/read`,
   0051, SECURITY INVOKER) are reusable **as-is** — that part does transfer,
   and it should, because they evaluate the real policy rather than
   paraphrasing it.
2. 🚨 **The money gate loses its cheap check.** S37 refuses money-segment keys
   at the shape gate, before authorisation, because the path says
   `INVOICES`/`FINANCE`. A Drive ID says nothing, so the refusal must read
   `is_financial` **and** the row's own `storage_path` from the database. The
   invariant is unchanged — money never leaves Supabase, so a money file
   should never HAVE a Drive id — but the enforcement point moves, and
   `files_money_provider_chk` (0050/0051) is what makes that safe to rely on.
3. 🚨 **An UPLOAD has no row yet.** S37's PUT authorises a path the client
   proposes; a Drive upload creates the object *first* and gets its ID back,
   so there is no row to look up at authorisation time. The client must
   therefore assert the project id, and **that assertion is now the thing
   being trusted** — it must be validated against the predicate directly, and
   the resulting `files` row must be written with the SAME project id that was
   authorised. Getting this wrong is a cross-project write, so it is worth a
   probe of its own.
4. **Do not invent a synthetic path to reuse the S37 gate.** Encoding
   `projects/<uuid>/…` into a Drive field to make the old check work would be
   two sources of truth for one fact — and S37's most expensive finding was
   exactly that: two gates over one value, disagreeing.

**Take the lesson, not the code.** The reusable part is the *pattern* —
evaluate the policy as the caller, refuse in depth, fail closed — not
`checkRowShapedPath`.

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
  and all five registry functions have real callers. 🚨 **S37 shipped its
  ninth no-caller feature and the review caught it** (`storageSecretClear` —
  the export, the Edge branch and its event code all existed with nothing
  calling any of them). **Enumerate every new export and grep each one.**
- pgTAP for anything schema-side (the `storage_provider` value, the
  provider-config CHECK), registered in `.github/workflows/rls.yml`.
  ⚠️ **"BOTH lists" does not mean two files — measured S37.** There is exactly
  ONE `rls.yml`, at the git root (`wilson/.github/`, one level ABOVE
  `WILSON/`), containing two lists that behave differently:
  1. **`RLS_TABLES`** — a coverage guard keyed by TABLE name, satisfied by the
     glob `supabase/tests/rls/*_<table>.sql`. **A suite named for a concept
     rather than a table cannot be seen by it** (`61_workspace_storage_s3.sql`
     is invisible to it; `62_workspace_storage_secrets.sql` is not, because a
     table of that name exists). Add an entry here ONLY if the session adds a
     TABLE, and name the suite to match it.
  2. **the replay file list** (the "Capture logs on failure" step) — an
     exhaustive, hand-maintained, space-separated list of every suite path.
     **Every new suite goes here, always.** It is not derived, and nothing
     fails if you forget — the suite simply never replays on failure.
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
5. **`SYSTEMS_HANDBOOK.md` §12.1 and a new §12.7b** — Drive as a provider vs
   the legacy read-only adapter, the shared-drive requirement, the
   `drive.file` trade-off (WILSON cannot see hand-dropped files), the
   reconnect path when a refresh token dies, and the TPN posture.
   **§12.7a (S37's bucket setup) is the template**: a section an admin can be
   handed, with the exact steps and the failure each one prevents. §12.7
   stays the NAS/VPN section.
6. Refresh the STATE block of `SESSION_39_prompt.md`; update the Claude
   auto-memory in the same pass.
7. Close out in the chat with the remaining-session list and a plain-English
   breakdown. Never let a diagnosis read as a fix.
