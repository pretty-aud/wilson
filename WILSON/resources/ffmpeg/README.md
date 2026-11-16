# `resources/ffmpeg/` — the still-frame decoder

WILSON uses ffmpeg for exactly one thing: **decoding a single frame out of a
video file into a JPEG**, for formats a browser cannot read (ProRes, DNxHD/DNxHR,
most professional MOV/MXF variants). Nothing else. It is never linked in; it is
invoked as a separate executable with an argument array — see
`electron/ffmpeg.cjs`.

## The binary is not in git, on purpose

`pretty-aud/wilson` is a **public** repository, and `git add -A` sweeps untracked
files into it. An 80 MB third-party binary does not belong in it. So this folder
is committed, and `.gitignore` here excludes the executables.

**Nothing breaks when the binary is absent.** `hasFfmpeg()` answers `false`,
the managed-file thumbnail route returns `415 { code: 'ffmpeg_missing' }`, and
the renderer falls back to decoding browser-native formats itself. Professional
codecs simply get a file-type icon, which is exactly the state before Session 40.

## Installing it

Drop the executable in beside this file:

```
resources/ffmpeg/ffmpeg.exe      (Windows)
resources/ffmpeg/ffmpeg          (macOS / Linux)
```

That is the whole install. `package.json`'s `build.extraResources` stages this
folder into the packaged app, and `electron/ffmpeg.cjs` resolves it at runtime
through `process.resourcesPath`.

To test a specific build without repackaging, set `WILSON_FFMPEG_PATH` to its
full path — that wins over both locations.

## 🚨 Which build to download — this is the part that matters commercially

**Ship an LGPL build. Not a GPL build.**

| | What you get | Consequence for WILSON |
|---|---|---|
| **LGPL** (`--disable-gpl`, no libx264/libx265) | ProRes + DNxHD **decode**, JPEG encode | ✅ Intended for proprietary closed-source software. **No obligation to publish any of WILSON's code.** |
| **GPL** (`--enable-gpl`, libx264/libx265) | Adds H.264/H.265 **encoding** | 🚨 Copyleft. Bundling it with a proprietary desktop app creates an obligation WILSON must not take on. |

Still-frame extraction needs **decode only**, and both ProRes and DNxHD decoders
are in the LGPL build. JPEG encoding is in it. JPEG's patents expired long ago.
So there is nothing WILSON needs that requires opting into GPL.

⚠️ **Verify the licence of whatever you actually download.** Several convenience
distributions — including some npm ffmpeg packages — ship GPL builds by default.
Run `ffmpeg -version` and read the `configuration:` line: if it contains
`--enable-gpl`, `--enable-libx264` or `--enable-libx265`, it is the wrong build.

```bash
ffmpeg -version
```

WILSON is sold to studios who ask about third-party licensing in their own
security assessments, so this is worth a real check by whoever handles contracts.
It is a five-minute question with a clear answer; it is expensive only if nobody
asks it.

## If a preview proxy is ever transcoded

Not in Session 40 — this folder decodes, it does not encode video. But when it
comes up: **target VP9/WebM.** `libvpx` is BSD-licensed and VP9 is royalty-free,
which removes the GPL question and the H.264 patent pool in one decision.

## Maintenance

ffmpeg is a large C codebase with a steady CVE stream, so it joins the
dependency-scanning story (TS-4.0). Record the version and build date here when
one is installed.

| Installed version | Build | Date | By |
|---|---|---|---|
| _(none yet)_ | | | |
