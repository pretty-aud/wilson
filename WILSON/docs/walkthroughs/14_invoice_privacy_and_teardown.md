# Walkthrough 14 — invoice privacy on the activity stream, and what a teardown leaves behind

**Track C, bundle C2.** Four parts. Parts A–C are things a company sees;
Part D is the operator console. Each part is independent — do them in any
order, and report the ☐ lines.

What you need: a company you can sign into as an **admin** (money access) and
as a **plain member** (a second account that is NOT a manager of the project);
one small PDF to attach to an invoice; one file over **50 MB** for Parts B–D
(only uploads above 50 MB take the resumable path that reserves space — a
200 MB clip is ideal); and, for Part D, a **throwaway company** you are happy
to destroy, whose admin has uploaded a profile picture.

Where things are: the company's storage plan is set from the **operator
console** (`/wilsonadmin` → Companies → the company's Storage panel; the
quota field takes gigabytes and accepts decimals); the company's own view is
**Admin Terminal → Storage**; the export is **Admin Terminal → Takeout**; the
operator's certificates are **operator console → Audit**.

⚠️ **Where to run it.** Dev's database and staging's both carry migration
0074 and the new `operator-workspaces`; the APP side is on the
`track-c-storage` branch and reaches the beta only with the merge that
follows your report (walkthrough 13's report is part of that merge too). So run
it from the branch: in `WILSON/`, `git checkout track-c-storage`,
`npm install`, `npm run dev`, and sign in as usual (your `.env.local` decides
whether that is dev or staging — either works).

---

## Part A — invoice activity is manager-only

What changed: every file's history (`file_events`) used to be readable by
every project member, including an invoice's upload, move and download — the
invoice's name, path and size — even though the invoice itself was hidden
from them. Now a member who cannot see an invoice sees nothing of its history
either, except a deletion record if it is ever purged (your ruling: deletion
records stay visible).

1. As the **admin**: open a project → **Budget** → attach the PDF to an
   invoice line (the invoice attachment control). Then add any small image in
   **Files** as a plain file, for comparison.
2. **Admin Terminal → Takeout** → export → open `file_events.csv`.
   **Expected:** the invoice's `uploaded` row is there with `is_financial` =
   `true`; the plain file's `uploaded` row with `false`. ☐
3. Still as the admin: open the project's **Summary** tab and open the plain
   file's history (the file audit drawer).
   **Expected:** its `uploaded` event is listed. ☐ (This is the same drawer a
   member will use in step 4; it proves the drawer still works after the
   change.)
4. As the **plain member**: open the same project. **Files** does not list the
   invoice (that has been true since the invoice gate shipped); open the plain
   file's history from the Summary tab.
   **Expected:** the plain file's history opens and shows its upload, exactly
   as for the admin. ☐
5. **What you cannot see, and why.** The member-side negative — "the member
   reads nothing of the invoice's history" — has no screen: the product never
   had a page that shows a member another file's events, so the leak was at
   the API (anything that talks to the database as that member). It is pinned
   by pgTAP suite 78 (probes 15, 16 and 22; removing the new rule makes them
   fail). If you want to see it with your own eyes, say so and I will give you
   a one-line check to paste into the browser console while signed in as the
   member. ☐ (report: "skip" or "send me the check")

## Part B — an upload that fails is certified at once

What changed: a resumable upload that failed with an error used to release
its reserved space quietly and leave no record. Now the failure is recorded the
moment it happens, with the error text, and the space is released the same
way.

1. Operator console: set the company's plan quota so that ONE of your big
   files fits with a little room and two would not (for a 200 MB clip, `0.3`).
2. As the admin, start uploading the big file. **While the progress bar is
   moving**, in the operator console lower the quota to well below the file's
   size (for example `0.1`) and save.
   **Expected:** the upload ends in an error — the storage policy re-checks at
   the final step and refuses the object. Note the exact wording. ☐
3. **Admin Terminal → Storage**: the used figure is back to what was there
   before the attempt (a failed upload holds no space). ☐
4. **Admin Terminal → Takeout** → `file_events.csv`: one `upload_abandoned`
   row whose path ends in your file's name, with `details` containing
   `"reported_by":"client"` and the refusal text under `"reason"`. ☐
   (Before this bundle there was no row at all for this case.)
5. Put the quota back to `0.3`.

## Part C — a closed tab no longer holds its space for a day

What changed: an upload interrupted by a closed tab or a crash kept its
reserved space for 24 hours, so on a small plan your own retry was refused for
a day. Now opening Files releases your own stale reservations.

1. As the admin, start uploading the big file again and, when it is about half
   way, **close the browser tab** (on the desktop app: quit the app).
2. Open the app again and go straight to **Admin Terminal → Storage**.
   **Expected:** the used figure still includes the interrupted upload — its
   reservation is open. ☐
3. Open the same project → **Files** (any Files panel), then back to **Admin
   Terminal → Storage** and refresh.
   **Expected:** the figure has dropped back. Opening Files released your own
   stale reservation. ☐
4. Upload the file again.
   **Expected:** accepted straight away (before this bundle it would have been
   refused for a day on this plan). ☐

Two things to know: a reservation released this way gets NO abandoned record
(your ruling — those rows lose their certificate), and if you have an upload
running in one tab and open Files in a SECOND tab, the second tab releases the
first tab's reservation early; the upload still completes or is refused
correctly at the end, it just loses its early refusal for other uploads
meanwhile.

## Part D — teardown: the avatar and the upload in flight (operator console)

What changed: tearing down a company swept two of Petal's three buckets and
left every member's profile picture in the third, permanently, while the
certificate said the company was destroyed. And an upload still in flight at
teardown vanished uncertified. Now avatars are removed and counted, and open
uploads are certified before the company row goes.

1. In the throwaway company, as its admin: **Settings → Profile → Upload
   avatar** (any image). Right-click the picture → copy the image address, and
   keep it.
2. Still in that company, start uploading the big file and close the tab about
   half way, exactly as in Part C step 1 — but do **not** open Files again.
3. Operator console → **Companies** → the throwaway company → **Tear down** →
   type its slug to confirm.
   **Expected on the "torn down" card:** `1 of 1 avatar(s) removed` and
   `1 upload(s) in flight certified abandoned` (beside the usual blob
   counts). ☐
4. Operator console → **Audit** (the table shows each row's message and its
   context, not its code — find rows by their wording):
   - the row **"Tore down workspace …"**: its context shows
     `avatars_removed: 1`, `reservations_abandoned: 1`,
     `reservation_sweep_failed: false` and a `thumbnails_note` sentence; ☐
   - a row **"Certified 1 abandoned upload(s) during teardown of …"** whose
     context lists the upload's path; ☐
   - a row **"Purged 1 avatar(s) during teardown of …"** whose context lists
     the avatar's path with `"avatars": true`. ☐
5. Paste the copied avatar address into a new browser tab.
   **Expected:** an error instead of the picture. The bucket is public and
   sits behind a cache, so if the picture still shows, wait a minute and
   reload once before reporting it. ☐

---

## Reporting

For each ☐, a tick, or the exact wording you saw. Part B step 2's error text
and Part D step 3's card sentence are the two I most want verbatim. If Part D
step 3 says **"The open-upload sweep did not answer"**, stop and send me that
— it means the environment's database is not at 0074, and the certificate is
saying so rather than claiming a sweep that never ran.
