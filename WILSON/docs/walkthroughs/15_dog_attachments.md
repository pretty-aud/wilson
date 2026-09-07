# Walkthrough 15 — deck attachments, in the cloud and on the desktop

**Track C, bundle C3.** Five parts. Parts A–C are the beta (cloud); Part D is
the desktop in Local Server mode, including the one-time move of your older
projects; Part E is the thing this bundle was really about — that a deck
generated from an old project comes out the same afterwards. Each part is
independent apart from **E, which must come after D on the same project**.
Do them in any order otherwise, and report the ☐ lines.

**What you need:** a project you can open in **Projects** (any company you are
an admin of); **one small PDF** whose filename does NOT contain the words
brief / treatment / script / deck / outline / notes — call it something like
`Nightjar_v3.pdf`, because that is the case that broke first; **two reference
images**; and, for Part D, the desktop app in **Local Server** mode with at
least one older project that already had attachments on it. Nothing here
destroys anything, but Part D's MOVE step is one-way, which is why it makes
you dry-run first.

**Where things are:** the drop zone is **Projects → open a project →
Resources**; D.O.G.'s project picker and its **File roles** list are at the
top of the D.O.G. panel; the one-time move is **Settings → RABBIT → "Move deck
attachments into project files"**.

⚠️ **Where to run it.** Dev's database and staging's both carry migration
0075; the app side is on the `track-c-storage` branch and reaches the beta
only with the merge that follows your report. So run it from the branch: in
`WILSON/`, `git checkout track-c-storage`, `npm install`, `npm run dev`, and
sign in as usual (your `.env.local` decides whether that is dev or staging —
either works). For Part D you want the same branch but the **desktop** app in
Local Server mode.

---

## Part A — the Resources drop zone actually stores something

What changed: in cloud mode this drop zone used to show an error and go
nowhere — "Cloud projects store files as file records, not on the project
row" — because there was no column on the project row for it to write to and
the adapter refused rather than losing your files quietly. Now it uploads.

1. **Projects → open a project → Resources.** Drop the PDF and the two
   images on the drop zone (or click it and pick them).
   **Expected:** a brief "Uploading…", then all three appear in the files
   table below. No red error text. ☐
2. Look at the **Kind** column for the PDF.
   **Expected:** it says something — probably *other*, possibly *brief* or
   *notes* if the name suggested one. It must NOT be blank ("—"). ☐
   *(A blank kind here is the exact defect this bundle found and fixed: the
   file would upload, appear in this table, and be invisible to D.O.G.)*
   The two images should show "—" in Kind, which is correct: an image is not
   a document.
3. Change the PDF's **Kind** with the dropdown (pick *brief*), and type
   something in its **Description** cell. Then leave the project (back to the
   list) and open it again.
   **Expected:** both stuck. ☐
   *(Before this bundle both of these silently did nothing in cloud mode —
   the change appeared on screen and was gone on the next load. If either is
   blank when you come back, say so; that is the whole of migration 0075.)*
4. Read the sentence above the drop zone.
   **Expected:** it tells you deleting moves a file to the trash and keeps it
   for 30 days, holding storage. ☐

## Part B — RABBIT and Projects show the same files

5. Open the same project in **RABBIT → Files**.
   **Expected:** the three files you just dropped are there. ☐
6. Upload one more file from RABBIT's Files view, then go back to
   **Projects → Resources** on that project.
   **Expected:** it is in the list here too. ☐
   **Expected:** its **Kind** is blank ("—"). ☐
   *That is deliberate and worth understanding: a file uploaded from RABBIT is
   a production file, not deck source material, until you give it a Kind. It
   is how a project's plates and renders stay out of your deck.*

## Part C — D.O.G. can see them and use them

7. Open **D.O.G.** and pick that project in the project dropdown.
   **Expected:** under the project description it says how many attachments,
   briefly showing "Reading project attachments…" first. ☐
   **Expected:** a **File roles** list with a Core/Ref tag beside each of the
   three files you dropped in Part A. ☐
   **Expected:** the file you uploaded from RABBIT in step 6 is NOT in that
   list (it has no Kind yet). ☐
8. Click one file's **Ref** tag to promote it to **Core**.
   **Expected:** it turns orange and says Core. ☐
   Now go to **Projects → Resources** on that project.
   **Expected:** that same file's **Core** checkbox is ticked. ☐
   *(One flag, two screens. If they disagree, say which one is wrong.)*
9. Back in D.O.G., generate a deck (any prompt, "Full deck" is fine).
   **Expected:** the deck reflects what is actually in your PDF — the
   attachment reached the model, not just its name. ☐
   *This is the part that could look right and be wrong: if the outline is
   generic and could have been written from the project title alone, say so.*

## Part D — the desktop, and moving your old attachments

Run this on the **desktop app in Local Server mode**, on a project that
already had attachments before today.

10. **Projects → open that old project → Resources.**
    **Expected:** its existing attachments are still listed, exactly as
    before. ☐
    *(Nothing was moved yet. If anything is missing at this step, stop and
    tell me — that would be the serious failure.)*
11. Drop one new file on the drop zone.
    **Expected:** it appears in the list. ☐
    **Expected:** the sentence above the drop zone now says deleting removes
    the file from this computer immediately, with no trash. ☐
    *(That is true on the desktop and not in the cloud, which is why the two
    say different things.)*
12. **Settings → RABBIT →** find **"Move deck attachments into project
    files"**. Click **DRY-RUN**.
    **Expected:** a report — projects checked, how many had old attachments,
    how many attachments would move, and the total size. Nothing changes. ☐
    **Expected:** the **MOVE** button was greyed out until the dry run
    finished. ☐
13. Read the report. If it lists anything under "Left in place (too large)",
    note the names — those stay where they are on purpose.
14. Click **MOVE**.
    **Expected:** "Done. These files now appear in each project's Resources
    list and in RABBIT's Files view." ☐
15. Go back to **Projects → Resources** on that old project.
    **Expected:** the same files are still all there. ☐
    **Expected:** their **Kind** cells are filled in, not blank. ☐
16. Click **DRY-RUN** again.
    **Expected:** it finds nothing left to move (0 attachments found, or only
    the oversized ones from step 13). ☐

## Part E — 🚨 the one that matters: the deck did not change

Do this on the **same project you migrated in Part D**. It is the whole reason
this bundle took the shape it did.

The risk: D.O.G. treats files marked **Core** as "the primary sources of truth
for what this project IS" and everything else as "supporting reference
material only", and it says so to the model in as many words. Old attachments
were Core unless you had said otherwise; the new file records are the reverse
by default. If the move had got that backwards, every one of your old projects
would quietly start generating a different deck, with nothing failing and no
error anywhere.

17. **BEFORE you migrated** — if you still have it — you should have a deck
    generated from this project. If not, that is fine; do step 18 first on a
    project you have NOT yet migrated, keep the outline, then migrate it and
    do step 19.
18. In **D.O.G.**, pick the project and look at the **File roles** list.
    **Expected:** the same files are Core, and the same files are Ref, as
    before the move. ☐
    *This is the single most important line in this walkthrough. If a file
    that used to be Core now says Ref — or the reverse — stop and tell me
    which file.*
19. Generate a deck with the **same prompt** you used before.
    **Expected:** an outline that reads like the previous one: same shape,
    same emphasis, drawing on the same documents. It will not be word for
    word — the model never repeats itself exactly — so what you are judging
    is whether it still treats the same files as the important ones. ☐

---

## What to report

For each ☐, "yes" or what actually happened. If something is wrong, the two
most useful things are **which file** and **which screen**, because most of
this bundle is one flag or one field being read in two places.

Three specific things worth calling out even if everything else is fine:

- **Step 2** — a blank Kind on a freshly dropped PDF.
- **Step 3** — a Kind or Description that does not survive leaving and
  reopening the project.
- **Step 18** — any file that changed between Core and Ref across the move.

And one honest limit, so it is not a surprise: D.O.G. reads the **newest 20**
attachments per project, up to **32 MB in total**. If a project has more than
that, the panel says so in a line under the count. A project with a hundred
production files is not going to feed all of them to the model, and it should
not — but if that line appears when you think it should not, tell me.
