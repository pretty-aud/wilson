# Walkthrough 04 — uploads and files in the cloud (S27 + S42)

**What this checks.** Files on every backend (S27, `5384d4e`): the
FileManager in cloud mode, the Resources drop zone on the Projects page and
the folder + manifest panel; and multi-GB resumable uploads (S42, migrations
0057 + 0058): the 50 GiB cap, progress, and resume after a dropped connection.
Every one of these is complete in code and has not been watched working by a
signed-in person.

**Where and who.** The beta https://beta.petalstudios.co/wilson,
**Browser 1 = you (admin)**, one project of your own. Have ready: three small
files (an image, a PDF, a short video) and one large file between 1 GB and
4 GB (a video is ideal). The desktop app is used once at the end, for parity.

## Steps

1. **Browser 1:** Home → `Projects` → select a project (or create one) so the
   `Project Details` panel shows it. Scroll to the `Project folder` panel.
   - **Expect:** either a folder list with the sentence explaining that
     `PROJECT.json` sits at the top of the folder and that WILSON writes it,
     or the empty state "No folder structure yet. It is created the first
     time this project is opened in R.A.B.B.I.T., or when its first asset or
     scene is added."
   - **If instead** the panel errors or is missing: record it.
2. **Browser 1:** drag the small image onto the box that reads "Drop files
   here or click to browse".
   - **Expect:** "Drop to upload" while dragging, then "Uploading…", then
     the file appears in the resources area with a thumbnail.
   - **If instead** an error appears: record it verbatim. Before S27 this
     box refused cloud uploads with a message pointing you at RABBIT; that
     message must be gone.
3. **Browser 1:** `Open this project in RABBIT` → `Assets` tab → click an
   asset (create one if needed) to open its detail → find the Files area →
   `Add files` → pick the PDF and the short video.
   - **Expect:** "Uploading..." then a row per file with `Name`, `Version`,
     `Size`, `Date` and `Actions`; `Download` on a row fetches the file; the
     `Gallery` / `Table` toggle switches the view.
   - **If instead:** record the exact error text and which file.
4. **Browser 1:** back to Home → `Projects` → the same project →
   `Project folder`.
   - **Expect:** the panel now lists folders with a count, and the
     `PROJECT.json` sentence.
   - **If instead** it still says "No folder structure yet": record it.
5. **Large upload.** In RABBIT, `Add files` → the 1–4 GB file. Note the start
   time.
   - **Expect:** a progress percentage that climbs; when done, a row whose
     `Size` matches the file. Note the end time.
   - **If instead** it fails: record the exact message, the percentage where
     it stopped, and the time.
6. **Resume.** Start the same large upload again (a new version is fine) and
   when it is around 30%, turn Wi-Fi off for 20 seconds, then back on.
   - **Expect:** the upload picks up and completes.
   - **If instead** it fails or restarts from 0%: record the message and the
     percentage.
7. Delete one small file with `Delete file`.
   - **Expect:** it leaves the list. Deleted cloud files keep their quota for
     30 days; that is an accepted limit, not a defect.
   - **If instead:** record what happened.
8. **Desktop parity (optional but useful):** in the desktop app on Local
   Server, repeat step 3 on a local project.
   - **Expect:** the rows appear the same way, and `Show in explorer` opens
     the project folder on disk with the files in it.
   - **If instead:** record which step differs from the web.

## Report (paste back)

```
Walkthrough 04 — uploads and files — date:
1 Project folder panel state:  folders listed / empty state / error:
2 drop zone upload OK: Y/N   message if any:
3 Add files (PDF + video) OK, Download works, Gallery/Table toggles: Y/N
4 folders appeared after use: Y/N
5 large file size:      started:      finished:      OK: Y/N   message:
6 resume after Wi-Fi drop: Y/N   message:
7 delete OK: Y/N
8 desktop parity: same / differs at step:
Anything odd (exact text):
```
