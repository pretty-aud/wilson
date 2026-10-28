# 85 — NIGHT 4

One file for the night (`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one
section per session: **M2** (the desktop → cloud migration, part 2), **P1**
(previews on your own storage), **R2** (release readiness) and **D1** (the
desktop keeps its stored state across a relaunch), which you added. Each
section stands on its own; answer its questions by their numbers.

## P1 — Previews on your own storage

1. **A company that keeps its files in its own S3 bucket now sees their
   pictures.** In the Files panel of an asset, scene, shot, level or
   experience, a picture or a video in the company's bucket shows its
   thumbnail, in the table and in the gallery, as a file on Petal's storage
   does. Until tonight those rows were file-type icons.
2. **The Files tab previews and plays them.** A picture, a PDF or a text file
   in the company's bucket opens in the preview; a video plays. The bytes go
   straight from the company's bucket to your browser or the desktop app;
   Petal never carries them.
3. **Money and Legal files are as before**: they never leave Petal's
   storage, and nothing new can ask for them.
4. **A company that keeps its media on its own server (a NAS)**: in the
   browser its Files panels and its Files tab now say where that media is,
   instead of looking empty: *This company keeps its media on its own
   server, so files are added and opened in the WILSON desktop app (Local
   Server mode). Footage on the server is listed in Bins.* What comes after
   that is your Q1 and Q2 below.

**What this is.** P1 of night 4 (`docs/sessions/briefs/po-p1-own-storage-previews.md`),
measured and designed first (`docs/NETWORK_STORAGE_DESIGN.md` §9, one review
round), then built: a new cloud function, `storage-read-urls`, signs the
addresses of a company's own files for a short time, only for a file the
person may already open. It is on wilson-dev; **the controller deploys it to
staging first**, and only then does the beta show any of this. No company
with its own bucket exists on any environment tonight, so the proof is the
tests and the function on dev; your test bucket on the beta is the first
real one.

### What to do with your test bucket (once the function is on staging)

| # | Do | You should see |
|---|---|---|
| 1 | On the beta, as a workspace admin: **Admin Terminal › Storage › Your own storage › S3-compatible bucket**; your bucket, its key and secret; the CORS rule from the handbook (§12.7a) pasted into the bucket's settings; **Test connection** | Both halves pass |
| 2 | Choose your own storage with that bucket and save | *Saved* |
| 3 | In a project, open an asset, **Files › Add files**: one picture (PNG or JPEG) and one short H.264 MP4 | Both upload, and each row shows its thumbnail (the video's still frame) |
| 4 | **Gallery** | The same two pictures, larger |
| 5 | Close the asset and open it again | The pictures are back at once |
| 6 | **Files** tab, the asset's folder, double-click the picture | The preview shows it |
| 7 | Double-click the video | It plays when you press play, and seeking works |
| 8 | Leave the asset's Files panel open for more than an hour, then open the gallery or scroll | The pictures are still there (renewed every few minutes while they are shown) |
| 9 | Add an invoice or a Legal file to that project | It goes to Petal's storage as always; your bucket does not get it |

If the pictures stay icons, **Test connection** first: a missing CORS rule is
the likeliest cause, and it says so.

### What a company on its own server shows

In the browser (and in the desktop app with the cloud backend): an empty
Files panel says the sentence above; the Files tab says it above the
project's folders. In the desktop app with Local Server mode nothing changed:
its files and their pictures are there as before. The sentence is pinned by
tests rather than photographed: the dev fixtures have no such company.

### Pictures

From Chromium at a real 1280×800 and 1440×900 window, on the dev fixtures'
tester (made-up projects; one file of the fixtures sits in a company bucket,
the Lamp Room level's blockout picture, and the fixtures stand in for that
bucket). In the folder *85_night_4 pictures* beside this file:

- `po-p1-after-level-files-1280x800`, `…-1440x900` — the Lamp Room level's
  window: its Files table shows the blockout's thumbnail, signed in the
  company's bucket (before tonight that row would have been a file-type
  icon; there is no before picture, because the fixtures had no file in a
  company bucket until tonight).
- `po-p1-after-level-gallery-…` — the same panel in Gallery.
- `po-p1-after-files-preview-…` — the Files tab, LEVELS › Lamp-Room, the
  blockout opened in the preview (its details say *Your own bucket*).

### Questions

- **Q1. A company that keeps its media on its own server: its project files
  in the browser.** Today the browser lists none of them; only the Bins tab
  lists the server's footage. (a) For 1.0 they stay on the server and in the
  desktop app; the browser says so where they would be, and night 5's M3
  leaves them where they are on such a company and says so (Recommended:
  listing them in the cloud is a feature of its own, a design night and a
  build night at least, and Bins already gives footage a view in the
  browser). (b) Night 5's M3 lists them in the cloud: a row per file naming
  where it is on the server, the file staying there, as a Bins clip is; the
  browser shows the list (pictures as Q2; playing them would wait for the
  file gateway). (c) List them after 1.0, in a design night of their own.
- **Q2. If they are listed (Q1 b or c), their pictures.** (a) As your rule
  for footage in Bins: made by the desktop that adds the file and kept on
  Petal's storage only while the company's remote viewing is on
  (Recommended: it is how Bins already works). (b) Never on Petal's storage:
  icons in the browser, pictures only later through the file gateway (a
  gateway release with its own signed build and a TPN review). (c) No
  pictures for them in the browser at all.

### How it was checked

- **Reviews:** the design, then the build twice, each by a second model
  reading the code to break it (the design and the first build round on
  Opus, the second on Fable); everything that broke a claim was fixed the
  same night, the rest is in the list below.
- **Tests:** the full suite, 417 files, 10,496 passed and 9 skipped (10,404
  before tonight: 92 new). Every piece has a failing control, run and seen
  to fail for the predicted reason: 40 in all (the money key, a key outside
  a project, an unreadable project, an inactive member, a workspace not on
  S3, the project asked once, the order, the row and its own project, the
  thumbnail's own key, the hour only for video and audio, the read by
  folder, the folder's own files only, the paging, the batches, the icon
  for a refused file, a money key never sent, the renewal, the two maps,
  getUrl required, the video, read-once, the sign-out, the storage choice
  after a sign-out, the server sentence).
- **On wilson-dev** (deployed tonight, nowhere else; version 3): the function
  answers a browser's preflight, refuses anything but POST (405) and every
  call without a real sign-in (401), and the copy running there is the
  repository's. No session signs in, so nothing further is measured live.
- **The app's size:** the main bundle grows by 4,305 bytes.

### Left as it is

`docs/OUTSTANDING.md`, P1: OSP-01 the older signer still signs by path, not by
row (it needs the same row check and a redeploy everywhere); OSP-02 a download
from a bucket still reads the whole file into memory; OSP-03 a clip longer
than an hour restarts at 0:00 on its renewal, on Petal and on a bucket alike;
OSP-04 files written to a bucket before a switch to a server answer "configure
S3"; OSP-05 a receipt uploaded to a bucket before migration 0076 is not marked
as money (none exists; the release runbook counts them); OSP-06 the live check
is your test bucket; OSP-07 someone who can write to a project can still make a
file row stand for any key in that project (a database rule, for a migration
night); OSP-09 after failed renewals a late tile can load a dead link once;
OSP-10 a clip that plays by its type alone, with an extension the list does
not know, gets five minutes; OSP-11 the dev fixtures try a storage read that
fails harmlessly.
