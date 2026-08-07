# SESSION 38 launch prompt — VIDEO PREVIEW AND VIDEO THUMBNAILS

> **Unit 2d** of `docs/NETWORK_STORAGE_DESIGN.md` (§5d.1b, §5d.2, §5e-pre, §5e,
> §5f). **DEPENDS ON S36** (thumbnails) — this reuses its bucket, its canvas
> pipeline and its `thumbnail_url` writer.
>
> ⚠️ **Sized 1–2 sessions.** ffmpeg packaging alone is fiddly. If it splits,
> split at "browser-decodable formats work" → "ffmpeg for professional codecs".

> **STATE — re-measure.** Confirm migration number, suite count, vitest counts
> and HEAD from the working tree.

---

## Why this exists

**Audrey, 2026-08-05:** *"can we add a way to preview videos on the app?"* and
*"for videos i would want to be able to get a single still frame and make it the
thumbnail automatically lets add that."* Then, after the licensing question:
*"ok keep ffmpeg then, desktop generation is fine."*

---

## Part 1 — a serve route that supports Range

**MEASURED: there is no serve route for managed files at all.** `main.cjs` has
PATCH, DELETE and `/thumbnail` for managed files and **nothing that streams the
bytes** — they are opened through the OS (`rabbit:open-in-explorer`).

🚨 **It must support HTTP Range requests.** Without ranges a `<video>` cannot
seek and the browser pulls the entire file before playing — on a 5 GB master
that is not a slow preview, it is a hang.

- `res.sendFile` handles ranges automatically (the existing `files` download
  route at `:2038` gets this free).
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

Same shape as S36's images, reusing its machinery:

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
→ `rabbit:copy-file`, a native path-to-path stream in the main process
(`:3009`), so the renderer never holds the file. **Extract the frame AFTER the
copy, through Part 1's route** — a hidden `<video>` pointed at the endpoint. One
implementation covers both backends, and it costs nothing extra because that
route is being built anyway.

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
not viable for multi-GB ProRes. +50–80 MB per platform, as an **unpacked extra
resource** in `forge.config.cjs` (`packagerConfig`), not inside the asar. It
joins the dependency-scanning story (TS-4.0) — ffmpeg has a steady CVE stream.

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
| exceeds the cloud cap | ❌ upload **fails** | **dialog** — *"Too large to add from a browser. Add it from the desktop app."* |
| very large, under cap | ⚠️ slow | inline note |
| ProRes / professional | ✅ uploads, **no thumbnail** | inline note — *"Preview images aren't available for this format in a browser. Add it from the desktop app to get one."* |

🚨 **Only the first blocks. The other two must NOT prevent the upload** — the
file is valid and the user may not have a desktop app to hand.

**Detection:** extension heuristic (`.mov`, `.mxf`, `.r3d`, `.ari`, `.braw`,
`.dnx`) for the pre-upload courtesy; and **accurate by construction** after the
attempt — if the decode failed, the browser genuinely cannot read it.

⚠️ **Cloud playback bills per view.** A signed Supabase URL in a `<video>` works
and supports ranges, but every play and scrub is egress Petal pays for. Gate
cloud video preview behind that cost decision; local and NAS playback cost
nothing. **NAS over a WAN link buffers** — §4c's caveat at full force.

**Recommended order:** local/NAS first (no egress, proves the Range
implementation), cloud second.

---

## Standing traps

Never `supabase config push`. `git add -A` sweeps untracked files into a PUBLIC
repo. Never interpolate content into a shell command. Query the database rather
than trusting migration text. Count `<!--` / `-->` after editing long markdown.

## Close-out ritual

1. `docs/OUTSTANDING.md` — delete what is fixed, cite the commit.
2. Sequence table in `MASTER_PLAN_S19_ONWARD.md`.
3. `tap-all` clean + full vitest.
4. **Prove it with a real file of each kind** — an H.264 MP4 and a ProRes MOV:
   thumbnail generated, preview plays or declines gracefully, seeking works.
5. **Close out in the chat** with the remaining-session list and a plain-English
   breakdown. Never let a diagnosis read as a fix.
