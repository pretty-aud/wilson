# Walkthrough 13 — uploads: the quota reservation (and, later, your own bucket)

**Track C, bundle C1.** This walkthrough has two halves. The first half is
ready to test now. The second half (previews and long video on a company's own
S3 bucket) waits until your S3-compatible test bucket exists as a workspace on
dev, and will be appended here when that half ships.

What you need: the beta (staging-backed), a company you can sign into as an
**admin**, and two files bigger than **50 MB** each (only uploads above 50 MB
take the resumable path that reserves space — a 30 MB file will not exercise
any of this). A screen recording of a few minutes is plenty; two ~200 MB video
clips are ideal.

Where things are: the Petal cloud plan for a company is set from the
**operator console** (Storage column → the company's plan panel); the
company's own view of it is the **Admin Terminal → Storage** card.

---

## Part A — a second upload that would not fit is refused at START

1. In the operator console, give your test company a small Petal plan: set
   `quota` to a number just larger than ONE of your two files but smaller
   than both together (e.g. two 200 MB clips → a 300 MB quota). Status
   `active`.
2. Sign in to the beta as an admin of that company. Open a project, then
   **Files**. Confirm the Admin Terminal → Storage card shows the new quota.
3. Add the first clip. While it is uploading (you will see the progress bar),
   add the second clip.

   **Expected:** the second clip is refused **immediately**, with a sentence
   that names the file, says how much space is left "once uploads already in
   progress are counted", and says that deleting files does not free space
   straight away. The first upload continues and completes.

   **Before this bundle** both would have started and both would have landed,
   because the quota could only see files that had finished.

   ☐ Refused at once, not after minutes: yes / no
   ☐ The sentence names the file and mentions uploads in progress: yes / no
   ☐ The first clip still completed: yes / no

4. Add the second clip again now that the first has finished.

   **Expected:** refused again — this time because the company is genuinely
   full ("has used all …"). That is the ordinary quota working, unchanged.

5. Open Admin Terminal → Storage while an upload is in progress (start a third
   one if you need to — it will be refused, that is fine; instead, raise the
   quota first if you want to watch this).

   **Expected:** the "used" figure INCLUDES the upload in progress. Reserved
   space shows as used space until the upload lands, is released, or expires.

   ☐ Used figure includes the in-flight upload: yes / no

## Part B — an upload you abandon is certified, next day

1. Raise the quota so a clip fits. Start uploading one clip and, while the
   progress bar is moving, **close the browser tab** (or the desktop app).
   Do not come back to it.
2. Wait **24 hours** — the reservation lasts exactly as long as Supabase keeps
   an unfinished upload, and it cannot be called abandoned before then.
3. Next day, as the company admin: Admin Terminal → run **Storage cleanup**
   (or simply wait — the same sweep runs on its own every hour at :39).

   **Expected:** the cleanup certificate (the `WIL-3003` line in the audit)
   shows `reservations_abandoned: 1`. The workspace takeout's `file_events`
   contains one `upload_abandoned` row naming the clip's intended path and
   size. The Files grid shows NOTHING for it — nothing ever landed.

   ⚠️ **Stated limit:** the per-file audit drawer will not show this row
   (there is no file to open it from). The certificate records that the
   upload was *abandoned*; the partial bytes are disposed of by Supabase
   itself after 24 hours, which WILSON cannot see and does not claim.

   ☐ `reservations_abandoned: 1` on the certificate: yes / no
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
