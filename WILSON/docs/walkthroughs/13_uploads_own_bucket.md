# Walkthrough 13 — uploads: the quota reservation (and, later, your own bucket)

**Track C, bundle C1.** This walkthrough has two halves. The first half is
ready to test now. The second half (previews and long video on a company's own
S3 bucket) waits until your S3-compatible test bucket exists as a workspace on
dev, and will be appended here when that half ships.

What you need: the app run from the `track-c-storage` branch (see the box
below; the beta only once this has merged), a company you can sign into as an
**admin**, and two files bigger than **50 MB** each (only uploads above 50 MB
take the resumable path that reserves space — a 30 MB file will not exercise
any of this). A screen recording of a few minutes is plenty; two ~200 MB video
clips are ideal.

Where things are: the Petal cloud plan for a company is set from the
**operator console** (Storage column → the company's plan panel); the
company's own view of it is the **Admin Terminal → Storage** card.

⚠️ **Where to run it.** Dev's database and staging's both carry migration
0073 and the new `storage-gc` already; the APP side is on the
`track-c-storage` branch and reaches the beta only with the merge that
follows your report. So run it from the branch: in `WILSON/`,
`git checkout track-c-storage`, `npm install`, `npm run dev`, and sign in as
usual (your `.env.local` decides whether that is dev or staging — either
works). On the beta before the merge, uploads simply behave as they did.

---

## Part A — a second upload that would not fit is refused at START

1. In the operator console, give your test company a small Petal plan: set
   `quota` to a number just larger than ONE of your two files but smaller
   than both together. The field takes **gigabytes** and accepts decimals, so
   two 200 MB clips → type `0.3`. Status `active`.
2. Sign in as an admin of that company. Open a project, then **Files**.
   Confirm the Admin Terminal → Storage card shows the new quota.
3. Add the first clip. While it is uploading (you will see the progress bar),
   add the second clip **from a second browser tab**: open the same project's
   Files in another tab and use Add files there. (In the tab that is
   uploading, the Add files button is disabled until the upload finishes, and
   files chosen together upload one after the other — so a second tab is the
   only way to have two uploads in flight from one machine. That is exactly
   the two-people-uploading-at-once situation this bundle exists for.)

   **Expected:** the second clip is refused **immediately**, with a sentence
   that names the file, says how much space is left "once uploads already in
   progress are counted", and says that deleting files does not free space
   straight away. The first upload continues and completes. (The refusal may
   come from the app's own pre-check rather than the server; both say the
   same sentence, and both count the upload in progress.)

   **Before this bundle** both would have started and both would have landed,
   because the quota could only see files that had finished.

   ☐ Refused at once, not after minutes: yes / no
   ☐ The sentence names the file and mentions uploads in progress: yes / no
   ☐ The first clip still completed: yes / no

4. Add the second clip again now that the first has finished.

   **Expected:** refused again — this time by the ordinary quota, unchanged:
   with one clip landed of a 0.3 GB plan the sentence is the not-enough-space
   one: "Not enough Petal cloud storage for "clip.mov": it needs 200 MB, but
   only 107 MB of this company's 307 MB is left once uploads already in
   progress are counted …" (the figures follow your clip's real size; those
   are for a clip of exactly 200 MiB). The "has used all …" wording appears
   only once a plan is completely full, which two 200 MB clips against 0.3 GB
   never reach.

5. Open Admin Terminal → Storage while an upload is in progress. (If nothing
   fits any more, raise the quota first so a clip fits, start it, and look at
   the card while the progress bar is moving.)

   **Expected:** the "used" figure INCLUDES the upload in progress. Reserved
   space shows as used space until the upload lands, is released, or expires.

   ☐ Used figure includes the in-flight upload: yes / no

## Part B — an upload you abandon is certified, next day

1. Raise the quota so a clip fits. Start uploading one clip and, while the
   progress bar is moving, **close the browser tab** (or the desktop app).
   Do not come back to it.

   ⚠️ Close the tab (pulling the network cable also works — the app then
   cannot reach the server to release the reservation either). What is NOT
   certified is an upload the SERVER refused mid-way (a storage error, an
   expired session): the app releases that reservation on the way out, a
   stated limit — see the Systems Handbook §17. There is no cancel button on
   an upload in progress, so closing the tab is the abandonment this test
   needs.
2. Wait **24 hours** — the reservation lasts exactly as long as Supabase keeps
   an unfinished upload, and it cannot be called abandoned before then.
3. Next day, as the company admin, look for the certificate. The sweep runs
   on its own every hour at :39 across every company, so by the time you look
   it has almost certainly already done the work — and a reservation is
   certified ONCE.

   **Expected:** the workspace takeout's `file_events` contains one
   `upload_abandoned` row naming the clip's intended path and size — that row
   IS the certificate, whichever run wrote it. If you also run Admin Terminal
   → **Storage cleanup**, its green banner and its `WIL-3003` audit line
   report `reservations_abandoned`: `1` only if your click beat the hourly job
   to it, otherwise `0`, which is correct (nothing was left to certify). The
   Files grid shows NOTHING for it — nothing ever landed.

   ⚠️ **Stated limit:** the per-file audit drawer will not show this row
   (there is no file to open it from). The certificate records that the
   upload was *abandoned*; the partial bytes are disposed of by Supabase
   itself after 24 hours, which WILSON cannot see and does not claim.

   ☐ One `upload_abandoned` row in the takeout's `file_events`: yes / no
   ☐ Nothing appeared in the Files grid: yes / no

## Part C — nothing else changed

1. Upload a file **under 50 MB** with the quota nearly full.

   **Expected:** exactly as before — it lands if it fits and is refused if it
   does not. Small uploads do not reserve; they are weighed as they land.

2. Upload an invoice (a file dropped on a Crew or Talent invoice line) as a
   manager while the company is over quota.

   **Expected:** it uploads. Invoices are how a company pays Petal and were
   never quota-gated; the reservation follows the same rule.

   ☐ Small upload behaves as before: yes / no
   ☐ Invoice upload still allowed over quota: yes / no

---

## Part D — your own bucket (not yet)

Previews for images and video, and playback of a video longer than five
minutes, on a company whose storage is its own S3-compatible bucket. Waits on
your test bucket being configured as a workspace on **dev** (Admin Terminal →
Storage → S3-compatible, with the CORS rule from the Systems Handbook §12.7a —
`AllowedOrigins: ["*"]`, because the desktop app's origin carries a dynamic
port). The steps will be added here by the session that ships it.

---

**Report back:** the ☐ lines above, the exact wording of the refusal in Part
A step 3, and anything that surprised you.
