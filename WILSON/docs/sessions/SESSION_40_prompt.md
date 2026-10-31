# SESSION 40 launch prompt — VIDEO PREVIEW AND VIDEO THUMBNAILS

> **Unit 2d** of `docs/NETWORK_STORAGE_DESIGN.md` (§5d.1b, §5d.2, §5e-pre, §5e,
> §5f). **DEPENDS ON S39** (thumbnails) — this reuses its bucket, its canvas
> pipeline and its `thumbnail_url` writer.
>
> ⚠️ **Sized 1–2 sessions.** ffmpeg packaging alone is fiddly. If it splits,
> split at "browser-decodable formats work" → "ffmpeg for professional codecs".

> **STATE — re-measure, do not trust this block.** After **S44**
> (2026-08-08): migrations **0000–0054** on all three envs, next free
> **0055**. pgTAP **64 suites / 1110 assertions**, next suite **65**. Vitest
> **1228 / 54 files**. CLI re-linked to wilson-dev.
>
> ## 🚨 S44 MOVED THE THUMBNAIL PATH UNDER YOU — READ THIS BEFORE §5f
>
> **A thumbnail lives where its source lives, and dies with it** (Audrey,
> 2026-08-08). A video still is a thumbnail, so this is your path too.
>
> **What changed, concretely:**
> - **Write with `putThumbnailTo(fileProvider, key, blob, { client })`, NOT
>   `putThumbnail(client, …)`.** The old signature is now the Supabase-only arm
>   and calling it directly re-pins previews to Petal — the exact defect S44
>   existed to remove. Pass the **same `storageProvider` variable the body was
>   written with**; never re-derive it.
> - **`storage_gc_queue` has a `kind` column** (`body` | `thumbnail`, 0054).
>   Anything you enqueue must tag it. `storage-gc` picks its restorability
>   column from `kind`, and an untagged thumbnail is checked against
>   `files.storage_path`, reads as unreferenced, and **gets deleted and
>   certified disposed.**
> - **The thumbnail enqueue arm is NOT `OLD.storage_provider`.** It maps
>   `s3 → ('byo-s3','s3')` and **everything else** → `('rabbit-thumbnails','supabase')`.
>   Mirroring the body arm enqueues a `local_server` preview as provider
>   `local_server`, which the CHECK refuses and the trigger's `EXCEPTION`
>   handler swallows — disposing of nothing at all.
> - **Teardown excludes `s3` and only `s3`** (`.neq('storage_provider','s3')`),
>   mirroring that same mapping. `WIL-7005` now carries `byo_thumbnails_left`
>   beside `byo_bodies_left`.
> - **`STORAGE_PRESIGN_RPM` default is now 240**, not 120 — an s3 image upload
>   costs two presigns (body, then preview). A video still on an s3 workspace
>   will cost a third; check the arithmetic before you add one.
>
> ⚠️ **BROWSER DISPLAY FOR s3 ROWS IS DELIBERATELY NOT BUILT.** `FileManager`
> filters to `storage_provider === 'supabase'`, so an s3 workspace's previews are
> written correctly and shown as file-type icons. Audrey scoped it out: it needs
> a batch presign that does not exist, and **no S3 workspace exists on any
> environment to verify one against.** **The same question is yours for video
> stills — do not build a display path for them in isolation**, and if you want
> one, it is the same deferred endpoint. See `OUTSTANDING.md` and handbook
> §12.7b.
>
> ⭐ **Generation is the one-way door, display is not.** Generate the still even
> if you cannot display it: a preview that exists becomes displayable later by a
> pure client change, while one never generated can only be made by downloading
> the whole video.
> 🚨 **Read the working tree** — this block has been stale within the hour
> before now.
>
> ⏸️ **S38 (Google Drive) is MOVED TO LAST, out of the first build** (Audrey,
> 2026-08-08). The sequence is now **S40 → S41 → S42 → S43, then S38**. Its
> brief is untouched and correct; it simply is not next.
>
> ---
>
> ## 🚨 THE FIVE THINGS THAT WILL COST THIS SESSION IF MISSED
>
> *Measured 2026-08-08 by a pre-session audit of this brief against the code.
> Each of these contradicts something written below; where they conflict,
> **these win** — the sections were written before S37 shipped.*
>
> **1. `forge.config.cjs` IS NOT THE PACKAGER THAT SHIPS.** Part 3 says to add
> ffmpeg as an unpacked extra resource in `forge.config.cjs`
> (`packagerConfig`). That file drives `npm run package` / `npm run make`
> (electron-forge). **The installer users actually receive is built by
> `npm run dist`, which runs electron-builder, configured under the `build`
> key in `package.json`** (appId `co.petalstudios.wilson`, output `release/`,
> nsis, publish → `https://updates.petalstudios.co/wilson`, consumed by
> `electron/updater.cjs`). The electron-builder knobs are
> **`build.extraResources`** and **`build.asarUnpack`** — `packagerConfig.extraResource`
> does nothing there, **and the two packagers have OPPOSITE asar defaults.**
> Implement it in the wrong file and `npm run package` "verifies" while
> `npm run dist` silently ships an ffmpeg-less app.
>
> **2. THE PROVIDER CONTRACT CANNOT SERVE A VIDEO, AND THIS IS THE LARGEST
> UNPLANNED WORK IN THE SESSION.** `REQUIRED = ['put','get','del','exists','describe']`
> (`storage/index.js`) has **no URL-minting function**, and `get()` returns a
> whole **Blob** (`b.download(key)` for Supabase, `await res.blob()` for s3).
> `downloadFile` pulls the entire body into memory. **A `<video>` needs a URL,
> and a 5 GB master cannot be a Blob.** Either add a sixth contract function
> (`getUrl`/`getStreamUrl`, registered for BOTH providers — note
> `registerStorageProvider` REFUSES an incomplete implementation, which is the
> safe direction) or bypass the registry deliberately and say why.
>
> **3. A PRESIGNED GET EXPIRES IN 300 SECONDS.** `EXPIRES` in
> `supabase/functions/storage-presign/index.ts` is
> `{ put: 900, get: 300, del: 300, head: 300 }`. The comment explains why a PUT
> survives a long upload (the signature is checked when the request STARTS) —
> **that reasoning does not rescue a `<video>`, which issues a NEW Range
> request per seek and per buffer refill.** A clip over five minutes stops
> mid-playback with a 403; scrubbing a 40-minute dailies file fails for most of
> its runtime; and the element surfaces it as a stall, not an auth error.
> Design for it: re-presign on error (and **do not** hold a sticky error
> boolean over an expiring URL — that was S39's own review finding), a longer
> media GET expiry, or route s3 through a serve path too.
>
> **4. 🚨 TAINTED CANVAS — the silent, total failure of Part 2.** The pipeline
> `<video> → drawImage → toBlob('image/jpeg')` taints the canvas whenever the
> video source is cross-origin, and `toBlob` then throws `SecurityError` —
> which S39's best-effort contract **swallows as `null`**. So every video
> silently gets no thumbnail, with no error anywhere. It bites TWICE:
> - **desktop**, because the renderer's origin and the loopback Express
>   server's origin differ (`expressApp.use(cors())` already sends `ACAO: *`,
>   so the server half is done);
> - **s3**, because a presigned URL is cross-origin.
>
> Both need `crossorigin="anonymous"` **on the `<video>` element**, and s3
> additionally needs the bucket CORS rule. ⚠️ §12.7a's published CORS JSON
> exposes only `ETag`; whether a cross-origin ranged media element also needs
> `Accept-Ranges`/`Content-Range` exposed **could not be confirmed from the
> repo — test it against a real bucket before assuming.** If that JSON has to
> change, every existing s3 customer must re-paste it: a migration-shaped cost
> with no room in this brief.
>
> **5. `canThumbnail()` DELIBERATELY REFUSES VIDEO, AND TWO TESTS PIN IT.**
> It requires `startsWith('image/')`, and
> `storage/thumbnails.test.js` asserts `canThumbnail('video/quicktime') === false`
> AND that `generateThumbnail({type:'video/quicktime'})` returns null *without
> invoking the decoder*. **You cannot widen it without rewriting two green,
> deliberately-worded guard tests.** Add a separate entry point
> (`generateVideoThumbnail` / `canThumbnailVideo`) — `generateThumbnail`'s
> injectable seams are `createBitmap` (`createImageBitmap`) and `makeCanvas`,
> and **`createImageBitmap` cannot express seek-and-decode on a
> `HTMLVideoElement`**, so this is a new function, not an option object.
> Reusable from S39/S44: `scaleToFit`, the `THUMBNAIL_*` constants,
> **`putThumbnailTo` / `removeThumbnailFrom`** (S44 — use these, not the
> Supabase-only `putThumbnail` / `removeThumbnail` they now wrap),
> `thumbnailKeyFor`, `signedThumbnailUrls`. **Not reusable: `generateThumbnail`,
> `canThumbnail`.**
>
> ---
>
> ## 🚨 S37 SHIPPED A THIRD PROVIDER AND THIS BRIEF PREDATES IT
>
> A grep of this file for `s3` / `presign` / `provider` returned **zero hits**
> before this block. It reasons throughout in a two-provider world (Petal cloud
> + local/NAS). **There are now three**, and the differences are not cosmetic:
>
> | | Petal cloud (`petal`) | Customer bucket (`s3`) | Local / NAS (`network`) |
> |---|---|---|---|
> | Bytes come from | Supabase Storage | **the customer's bucket, direct** | local disk / SMB |
> | **Who pays egress** | **Petal** | **the customer** | nobody |
> | Upload ceiling | **50 MB** (`rabbit-files` `file_size_limit`, 0027) | ~5 GB per presigned PUT | none |
> | Range support | signed URL, yes | **presigned URL, yes** (`X-Amz-SignedHeaders=host` + `UNSIGNED-PAYLOAD`, so `Range` travels unsigned) | `res.sendFile`, yes |
> | `downloaded` logging | works | **impossible** (§12.7a) | works via the new route |
>
> Three consequences that change the plan:
>
> - **Part 4's cost gate inverts for s3.** §12.7a: *"the bytes travel straight
>   between the app and the bucket — Petal never proxies them, never pays their
>   egress, and never holds them."* So cloud video preview is **free to Petal**
>   on an s3 workspace and can ship alongside local/NAS. Gating all "cloud"
>   playback behind a Petal cost decision would withhold the feature from
>   exactly the customers already paying for their own storage.
> - **The 50 MB cap is Petal-only, and video is what makes it bite.** Almost
>   every real clip exceeds it, so on Petal cloud essentially no video uploads
>   today — while an s3 workspace takes ~5 GB from a browser. **A blanket "too
>   large, use the desktop app" dialog is a FALSE REFUSAL on s3.**
> - **s3 may not need Part 1's route at all** — a presigned URL supports Range
>   and can go straight into `<video src>`. Part 1's framing of "a serve route"
>   as the universal answer is wrong: **three providers want three playback
>   paths.**
>
> Also true and unmentioned: `activeWorkspaceProvider` THROWS for a byos row
> naming no provider; `uploadFile` refuses a cloud-mode `network` workspace
> with a sentence; `presignStorage` THROWS by contract (unlike `adminApi`'s
> `{ok,status,data}` bindings — an unchecked await is the otterFetch trap in
> its S37 form); and `storage-presign` is rate-limited at
> `STORAGE_PRESIGN_RPM` (**default 240/caller/minute since S44**, raised from
> 120 because an s3 image upload now costs two presigns — body, then preview),
> which a re-presigning player plus a file grid could still approach. **A video
> still adds a third presign per video upload — redo the arithmetic, do not
> assume the S44 headroom covers you.**
>
> ⚠️ **`NETWORK_STORAGE_DESIGN.md` §5d.1/§5e — which this brief's header sends
> you to read — were ALSO written pre-S37 and were not audited.** Check them
> for the same two-provider framing before absorbing them, or the session will
> re-import the assumption it just corrected.
>
> **What S39 left that this session builds directly on:**
> - **The bucket is `rabbit-thumbnails`** (0053): private, **256 KB**, and
>   `allowed_mime_types = ['image/jpeg']`. 🚨 **That mime allowlist is a real
>   constraint on S40** — a video still must be encoded to JPEG, or the bucket
>   refuses it. Widening the allowlist means widening it for every object.
> - **The key is the SOURCE key plus `.jpg`** — `thumbnailKeyFor()` in
>   `src/tools/rabbit_v0.1.0/storage/thumbnails.js` is the ONE definition. 🚨 The
>   money gate is the THIRD path segment, so any rewrite that shifts a segment
>   moves the derived image out of the gate it inherits. Suite 63 probe 13.
> - **Eight policies, `rabbit_thumbnails_*`** — four base, four money. Do not
>   add a ninth under the `rabbit_files` prefix: 0042's post-conditions, suite
>   53 and 0053's own post-condition 7 all count that prefix and require 8.
> - **Generation is client-side and best-effort** — `generateThumbnail()`
>   returns `null` rather than throwing, because the source body has already
>   landed when it runs. A video path must keep that contract.
> - **`canThumbnail()` gates on MIME TYPE, not extension** — a cloud `files`
>   row has no `extension` column at all. ⚠️ **But the "invisible in cloud" bug
>   was NOT in `canThumbnail`** (which is new S39 code and never ran in
>   production before): the dead gate was `FileThumbnail.jsx`'s
>   `IMAGE_EXTS.has(file.extension)`, in the DISPLAY path, so the `<img>`
>   branch was never entered and no request was ever made. The fix is the
>   `thumbnailUrl` prop taking priority plus the exported `extensionOf(file)`.
>   **S40 will edit that file for video, and three literal source-text
>   assertions guard it** — attributing the bug to the wrong symbol sends you
>   to the wrong file.
> - 🚨 **S39's cloud machinery does NOT cover desktop MANAGED files, and Part 2
>   assumes it does.** `putThumbnail(client, key, blob)` needs a Supabase
>   client, `thumbnailKeyFor(storagePath)` needs a `files.storage_path`, and
>   `thumbnail_url` is a column on `public.files`. **A managed file has none of
>   the three** — it lives in the project bundle's `managedFiles` array and its
>   preview is an on-disk JPEG at `getThumbCacheDir()/{mf.id}.jpg` served by
>   the Express route, refused for non-raster extensions with 415 via
>   `isThumbableExt`. So for a Local-Server managed video there is **no
>   `rabbit-thumbnails` write and nowhere to record a key**. Planning one
>   implementation across both backends will fail here: either generate into
>   the desktop cache (ffmpeg writes the `.jpg` directly — `sharp` cannot
>   decode ProRes) or do nothing for managed files, but do not "reuse the
>   bucket".
> - ⚠️ **`storage/thumbnails.test.js` is a source-text guard suite over files
>   S40 will edit.** It regex-matches the executable text of
>   `supabaseAdapter.js`, `RabbitProvider.jsx`, `FileManager.jsx`,
>   `FileThumbnail.jsx`, `main.cjs`, `storage-gc`, `operator-workspaces` and
>   0053 **and 0054** — including EXACTLY-TWO-occurrence counts (`thumbnailUrl={thumbUrls.get(f.thumbnail_url)`,
>   `downloadFile, thumbnailUrls,`). **These break on refactor, not on
>   defect.** Budget for it; the close-out's "full vitest" does not warn you.
>   **S44 broke seven of them and repointed each at the new executable form** —
>   do the same, and never delete an assertion that has become inconvenient.
> - ⚠️ **A hand-replaced frame MUST be written at `thumbnailKeyFor(storage_path)`
>   with `putThumbnailTo`'s `upsert:true` Supabase arm** (S3 presigned PUTs
>   always overwrite). There is no orphan scan over this
>   bucket, and `fn_files_gc_enqueue` only ever enqueues `files.thumbnail_url`
>   — so a custom-suffixed key is invisible to disposal and **uncollectable
>   forever**. Good news the brief omitted: 0053's `rabbit_thumbnails_update` /
>   `_money_update` policies exist precisely so in-place regeneration
>   succeeds, so hand-replacement in cloud needs no migration.
> - **Disposal already covers this bucket**: `fn_files_gc_enqueue` enqueues the
>   thumbnail alongside the body, teardown sweeps it, and `WIL-7005` counts it.
>   **There is still no ORPHAN SCAN over it** (§12.7b) — if S40 creates
>   thumbnails on a path that is not `uploadFile`, it owns their cleanup.
> - ⚠️ **The desktop tier is still separate and still `sharp`** — six Express
>   routes, 256/q80 for managed files and **512/q85** for assets and entities.
>   S39 matched 256/q80 and did not resolve the split.
> - ⚠️ **Open decision S39 flagged and did not take:** a BYO-storage
>   workspace's previews live on Petal while its media does not (§12.7b).
>   Video stills make that a larger question, not a smaller one.


## Start ritual (before touching anything)

1. **Load the `wilson-app` skill** and skim its `versioning.md`.
2. **Re-measure the STATE block**: `git log --oneline -3`, `git status
   --short`, `ls supabase/migrations | tail`, `ls supabase/tests/rls | tail`,
   and `supabase/.temp/linked-project.json` **and** `project-ref` (both must
   say wilson-dev before anything writes).
3. **Read `docs/OUTSTANDING.md`** (what is broken) and
   **`docs/SYSTEMS_HANDBOOK.md` §17** (limits by design — a gate, not an
   oracle).
4. **Read the design sections this brief names in its header.**
5. **Re-verify every `file:line` citation in this brief by SYMBOL before using
   it** — sessions between its writing and now have moved them. The session
   that edits a file is the one that breaks its own citations.

---

## Why this exists

**Audrey, 2026-08-05:** *"can we add a way to preview videos on the app?"* and
*"for videos i would want to be able to get a single still frame and make it the
thumbnail automatically lets add that."* Then, after the licensing question:
*"ok keep ffmpeg then, desktop generation is fine."*

---

## Part 1 — a serve route that supports Range

**MEASURED (re-verified 2026-08-08): there is no serve route for managed files
at all.** `main.cjs` has **SIX** managed-files Express routes — GET (list),
POST (create; this is where `folder_path` is derived, `ASSETS/` vs `SCENES/`
vs `SHOTS/`), PATCH, DELETE (`?hard=true` unlinks body **and** thumbnail, and
carries the containment + cache-cleanup idiom the serve route should copy),
GET `/thumbnail`, and POST `/import-folder` — and **none of them streams the
bytes**. They are opened through the OS (`rabbit:open-in-explorer` →
`shell.showItemInFolder`).

⚠️ **An earlier draft said "PATCH, DELETE and /thumbnail"** — three of six.
The two it omitted are the two whose idioms you want to copy.

🚨 **It must support HTTP Range requests.** Without ranges a `<video>` cannot
seek and the browser pulls the entire file before playing — on a 5 GB master
that is not a slow preview, it is a hang.

- `res.sendFile` handles ranges automatically — the existing download route
  **`expressApp.get('/api/rabbit/projects/:projectId/files/:id/download')`**
  gets this free. (Confirmed: express `^5.2.1` → `send` `1.2.1`, whose
  `acceptRanges` defaults true, so `Accept-Ranges: bytes` and 206 responses
  are automatic. Setting `Content-Type` first is safe — `send` only sets it
  when unset.) ⚠️ **Cite it by symbol: the old `:2038` is now ~2149, and the
  wrong line lands in the POST upload route, whose `rabbitLogFileEvent` uses
  `event: 'uploaded'` and `new_path` — the wrong event and the wrong field
  for a read.**
- **A hand-rolled `createReadStream` does NOT**, unless the `Range` header is
  implemented explicitly. **This is the single most likely thing to get wrong.**

Everything served here goes through `resolveContainedFilePath` — the guard S33
fixed (it lives in `electron/pathContainment.cjs` now). Do not add a second
path-resolution route.

🚨 **AS-2.9 rides in with this route (S33 hand-off).** S33 added the
`downloaded` event to the files-plane download on both backends, and measured
that the default desktop managed-files flow has **no WILSON-mediated read to
log** — its "download" button is `openInExplorer`. The serving route this
session builds is the first time WILSON mediates managed-file reads, so it
must log the read the way the files download route does
(`rabbitLogFileEvent`, event `'downloaded'`, try/catch + `touch: false` —
copy that call site, including why a read must not stamp `updated_at`).

## Part 2 — auto still-frame thumbnails

Same shape as S39's images, reusing its machinery:

```
<video src={blobURL}> → seek → drawImage to canvas → toBlob('image/jpeg')
```

Same 256px output, same `rabbit-thumbnails` bucket, same upload-time timing,
same zero egress.

**Which frame:** not frame 0 — video routinely opens on black, a fade-in or a
slate, and a wall of black thumbnails is worse than icons. **Seek to ~10% of
duration, clamped to 1–10 seconds.** If the seek or decode fails, fall back to
the file icon rather than storing a black frame. Make the frame **replaceable by
hand** — the automatic pick is right most of the time, not always.

⚠️ **Managed files have no `File` object.** They arrive via `rabbit:pick-files`
→ **`ipcMain.handle('rabbit:copy-file')`** — a streamed
`createReadStream`→`createWriteStream` pipe with `rabbit:copy-progress` events
— so the renderer never holds the file. (Cite it by symbol: the old `:3009`
is now ~3292, and 3009 lands in unrelated Express code.) **For MANAGED FILES
ONLY, extract the frame AFTER the copy, through Part 1's route** — a hidden
`<video crossorigin="anonymous">` pointed at the endpoint.

🚨 **Do NOT generalise "one implementation covers both backends" to cloud.**
For a managed file the read-back is a local disk read and costs nothing. For a
cloud file it means **re-reading the uploaded body** — Petal egress on a
`petal` workspace, a presign round trip plus customer egress on an `s3` one —
which is exactly the design `thumbnails.js`'s own header and §12.7b forbid:
*"Generating on demand, or server-side, means downloading the source first:
gigabytes of egress at Petal's expense to produce a postage stamp."* S39's
whole cost argument rests on generating **from the copy already in memory**.

**So there are two paths, by design:**
- **Browser / cloud upload** — the renderer HOLDS the `File`. Generate from
  memory before or during upload, same as S39's images. A `blob:` URL is
  same-origin, so no tainting.
- **Desktop managed files** — no `File`; read back through Part 1's route with
  `crossorigin="anonymous"`, or let ffmpeg write the `.jpg` straight into the
  desktop thumbnail cache (which it must anyway for ProRes, since `sharp`
  cannot decode it).

⭐ **And a case the brief had no row for:** a **cloud** workspace on **s3**
whose media is a professional codec. The desktop app in cloud mode has ffmpeg
locally *and* the source file on disk, so it can generate the still **before
upload** — better than every read-back option, and it matches §12.7b. Part 2's
"extract after the copy" points the other way; prefer generate-before-upload
wherever the local file exists.

## Part 3 — ffmpeg, for the codecs a browser cannot decode

Chromium plays H.264/AAC MP4, VP8/VP9 WebM and AV1. It **cannot** play ProRes,
DNxHD/DNxHR or most professional MOV/MXF variants — a large share of what a
studio holds. The same decoder answers both questions, so **a file that will not
preview will not thumbnail either.**

### 🚨 ffmpeg does NOT force WILSON to be open source

Audrey raised this and nearly dropped the dependency over it. **The concern does
not apply at this scope:**

- The **LGPL** build is explicitly intended for proprietary, closed-source
  software. Invoked as a **separate executable** — as WILSON would — it creates
  **no obligation to publish any of WILSON's code**.
- The **GPL** build is the one with copyleft consequences, and you get it only by
  deliberately including GPL components (`libx264`, `libx265`, `--enable-gpl`).
  **You have to opt in.**
- **Still-frame extraction from ProRes/DNxHD needs the LGPL build and nothing
  more.** Both decoders are in it; JPEG encoding is in it; JPEG's patents
  expired long ago.

**Rules:**
1. Ship an **LGPL build** — no `--enable-gpl`, no libx264/x265.
2. Invoke it as a **separate process**, never linked in.
3. If a preview *proxy* is ever transcoded, target **VP9/WebM** — `libvpx` is
   BSD and VP9 is royalty-free, which removes both the GPL question and the
   H.264 patent pool in one decision.

⚠️ **Verify the licence of whichever build is packaged** — some npm ffmpeg
distributions ship GPL builds. WILSON is sold to studios who ask about
third-party licensing in their own assessments; worth a real check by whoever
handles contracts.

### Two implementation rules that will otherwise cost a session

1. 🚨 **`-ss` BEFORE `-i`, not after.** Input seeking jumps to the timestamp;
   output seeking decodes from frame zero. On a 5 GB ProRes file over a NAS
   share that is the difference between a second and several minutes.
2. 🚨 **`execFile`/`spawn` with an argument array — never a command string.**
   Filenames from a NAS are outside WILSON's control and may contain shell
   metacharacters. This is already a standing rule in this repo; **ffmpeg is
   exactly the case it exists for.**

### Packaging

Native binary, **desktop only** — it cannot run in a browser, and ffmpeg.wasm is
not viable for multi-GB ProRes. +50–80 MB per platform, shipped as an
**unpacked extra resource**. It joins the dependency-scanning story (TS-4.0) —
ffmpeg has a steady CVE stream.

🚨 **PUT IT IN THE RIGHT PACKAGER — THERE ARE TWO, AND ONLY ONE SHIPS.**
Measured 2026-08-08:

| | builds | configured in | ships to users? |
|---|---|---|---|
| electron-**forge** | `npm run package`, `npm run make` | `forge.config.cjs` (`packagerConfig`) | ❌ no |
| electron-**builder** | **`npm run dist`**, `dist:publish` | **`package.json` → `build` key** | ✅ **yes** — nsis installer → `updates.petalstudios.co/wilson`, consumed by `electron/updater.cjs` |

**Use `build.extraResources` and/or `build.asarUnpack` in `package.json`.**
`packagerConfig.extraResource` does nothing for the shipped build, **and the
two packagers have OPPOSITE asar defaults** — so an earlier draft's advice
("unpacked extra resource in `forge.config.cjs`, not inside the asar") was
both the wrong file and an inverted fact for the build that reaches users.

⚠️ **Verify with `npm run dist`, not `npm run package`.** Packaging via forge
will look correct while the installer ships without ffmpeg — a whole-session
failure that only surfaces on someone else's machine. Resolve the binary path
through `process.resourcesPath` at runtime and confirm it exists in the
unpacked `release/` output before believing it.

✅ **Desktop-only generation still satisfies Audrey's requirement.** Thumbnails
are generated once, uploaded, and **every web user sees them**. Only *generation*
for professional codecs is desktop-side — the person adding studio media is next
to the NAS anyway.

## Part 4 — the notice (§5f)

**Agreed treatment (Audrey): inline note on the file row + one summary line per
batch. NOT a popup.** Thirty clips must not mean thirty dialogs — that trains
people to dismiss the one that matters.

| Trigger | Reality | Treatment |
|---|---|---|
| exceeds the cap **on a `petal` workspace** | ❌ upload **fails** | **dialog** — *"Too large to add from a browser. Add it from the desktop app."* |
| very large, under cap | ⚠️ slow | inline note |
| ProRes / professional | ✅ uploads, **no thumbnail** | inline note — *"Preview images aren't available for this format in a browser. Add it from the desktop app to get one."* |

🚨 **Only the first blocks. The other two must NOT prevent the upload** — the
file is valid and the user may not have a desktop app to hand.

🚨 **THE CAP IS PROVIDER-DEPENDENT, AND VIDEO IS WHAT MAKES IT BITE.** The
50 MB limit is `rabbit-files`'s `file_size_limit` (0027) and applies to
**`petal` workspaces only**. An `s3` workspace takes ~5 GB per presigned PUT;
a `network` workspace has no ceiling at all. Almost every real clip exceeds
50 MB, so on Petal cloud essentially no video uploads succeed today — while
the same file is fine from the same browser on an s3 workspace. **Key the
dialog on the ACTIVE PROVIDER, not on "cloud":** a blanket "too large, use the
desktop app" is a false refusal that tells a customer to install software for
an upload their browser can complete.

**Detection:** extension heuristic (`.mov`, `.mxf`, `.r3d`, `.ari`, `.braw`,
`.dnx`) for the pre-upload courtesy; and **accurate by construction** after the
attempt — if the decode failed, the browser genuinely cannot read it.

⚠️ **Playback cost is PER PROVIDER — the old "cloud bills per view" was only
ever half true.**

| Provider | Who pays for a play/scrub | Gate it? |
|---|---|---|
| `petal` | **Petal**, per byte, every time | ✅ yes — this is the real cost decision |
| `s3` | **the customer** (direct to their bucket, §12.7a) | ❌ no — free to Petal |
| `network` | nobody | ❌ no (but a WAN link buffers — §4c at full force) |

So gating *all* cloud playback behind a Petal cost decision would withhold the
feature from exactly the customers already paying for their own storage.

**Recommended order:** local/NAS first (no egress, proves the Range
implementation) → **s3 second** (also free to Petal, and a presigned URL goes
straight into `<video src>` with Range support, so it may need no serve route
at all) → **`petal` last**, behind the cost decision.

⚠️ **AS-2.9 / `downloaded` logging is NOT achievable for s3, and a certificate
must not claim otherwise.** §12.7a states it as already-decided: a presigned
GET is served by the customer's provider and WILSON never sees the read. Part
1's logging works for local/NAS and `petal`. **Say the s3 gap plainly in the
outcome block** rather than writing a conformance line that is true for two
backends and false for the third — that is the WIL-7005 failure S39's review
caught, repeating.

🚨 **§12.7b's open decision was TAKEN on 2026-08-08, and it goes against what
S39 shipped.** Audrey: *"the image should be kept in the company storage. if
the thumbnail lived in the petal cloud it would break tpn inherently."*

> **A thumbnail lives where its source lives, and dies with it.**

**So DO NOT extend the current behaviour to video stills.** S39 writes every
thumbnail to Petal's `rabbit-thumbnails` regardless of provider; that is now a
tracked defect (`OUTSTANDING.md`) with zero exposure only because no workspace
has yet configured BYO storage. A video still makes it worse, not equal: it is
a legible frame of the actual production footage a studio chose BYO storage to
keep off Petal's infrastructure.

**What this means for S40, concretely:**
- A video still for a `petal` workspace → `rabbit-thumbnails`, as now.
- A video still for an `s3` workspace → **the customer's bucket**, presigned
  PUT at `thumbnailKeyFor(storage_path)` (appending `.jpg` shifts no path
  segment, so `checkRowShapedPath` already accepts that key).
- A video still for a `network` workspace → the desktop thumbnail cache, as
  managed files already do.
- **Money-gated files are the rule applied, not an exception** — invoices
  never leave Supabase, so their previews stay in `rabbit-thumbnails`.
- 🚨 **Whoever writes a thumbnail to a customer bucket owns its disposal.**
  There is no orphan sweep over any thumbnail location, and `storage-gc`'s
  scan is Supabase-only.

✅ **RESOLVED 2026-08-08 — this is NOT S40's work. `SESSION_44_prompt.md` does
it, and RUNS FIRST.** A pre-session audit measured the real cost: three layers
independently hardcode Petal (the write via `putThumbnail`'s Supabase client
and fixed bucket, the display via `signedThumbnailUrls`' batch Supabase
signing, and 0053's enqueue which hardcodes provider `'supabase'`), and the
display path is genuinely unsolved — **there is no batch presign, and a
presigned GET expires in 300s against Supabase's 3600s.** That is a migration
plus three subsystem changes, comparable in size to S40's own work.

**So: do not build video stills on the current thumbnail path — it is about to
move.** Read S44's outcome block before starting Part 2, and follow whatever
routing it leaves.

---

## Standing traps

Never `supabase config push`. `git add -A` sweeps untracked files into a PUBLIC
repo. Never interpolate content into a shell command. Query the database rather
than trusting migration text. Count `<!--` / `-->` after editing long markdown.

⚠️ **Deploy order: dev → staging → prod BEFORE the git push** — `feat/multi-user-v1` auto-deploys the STAGING-backed beta, so a push before the staging migration means the beta runs new code against an old schema. **Re-link the CLI to `wilson-dev`** when the last env is verified.

## Close-out ritual

1. `docs/OUTSTANDING.md` — delete what is fixed, cite the commit.
2. Sequence table in `MASTER_PLAN_S19_ONWARD.md`.
3. `tap-all` clean + full vitest.
4. **Prove it with a real file of each kind** — an H.264 MP4 and a ProRes MOV:
   thumbnail generated, preview plays or declines gracefully, seeking works.
   🚨 **And prove the packaging with `npm run dist`, not `npm run package`** —
   confirm ffmpeg is present in the unpacked `release/` output and resolves at
   runtime. Forge will look correct while the shipped installer has no binary.
   🚨 **Test a clip LONGER THAN FIVE MINUTES on an s3 workspace** — that is the
   presigned-GET expiry, and a shorter clip will never reveal it.
5. **Refresh the STATE block of the next session's brief** (`SESSION_41_prompt.md`) with the numbers you leave behind — that block decays the moment you commit. Update the Claude auto-memory in the same pass.
6. **Close out in the chat** with the remaining-session list and a plain-English
   breakdown. Never let a diagnosis read as a fix.
