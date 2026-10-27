# 80 — D.O.G.'S UPLOADS MOVE INTO REFERENCES; CARD 1 IS "1 PROJECT"

1. **Your uploads are now the first group of card 2, References.** Each upload
   is a row like the other references: its glyph (a page, a picture or a
   video), its name, its size and a × to remove it. **Choose file** sits under
   them, with the same hint, the same file kinds and the same limit of 20.
2. **The card reads as one list of what the AI reads**, top to bottom:
   **Uploads**, then **Items**, **Files** and **Notes**, the meter, and **Add
   references**. Its first line now reads *"What goes to the AI: what is
   listed here and the project's title and description, with what you write
   below."* The count in its title bar counts the uploads too.
3. **Card 1 is now "1 Project"**: the Project dropdown, its hint, **New
   project** and the project's description, as before. Nothing else changed in
   it.
4. **Nothing about what is read or sent changed.** The same files go to the
   AI in the same way; the meter counts exactly what it counted before; Enter
   and **Generate** work as they did; removing an upload still tells the AI's
   file store to forget it.

**What this is.** DG2 of the post-overhaul plan
(`docs/sessions/briefs/po-dg2-uploads-in-references.md`), your ask of
2026-10-26 and your three answers (section 2). Written 2026-10-26 against
`feat/post-overhaul-edit-versioning` (`po/dg2-uploads-in-references`). No
database change, no server function.

## 1. Step by step

On the development copy (port 5306, the `dg2-worktree` entry), D.O.G. at
`/dog`. The two files to upload are neutral ones from this session's checkout,
so no real file name is on screen:
`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.claude\worktrees\silly-diffie-bf1870\WILSON\src\dev\fixtures\data\clip-noise.mp4`
(the test data's own video) and, in the same checkout,
`WILSON\public\logo.png` (WILSON's logo).

| # | Do | You should see |
|---|----|----------------|
| 1 | Open D.O.G. | **1 Project**: the Project dropdown and **New project**, nothing else. **2 References** (*None chosen*): the first line, then **Uploads (0)** with *"Source material for generating slide content (max 20 files)"* and **Choose file (PDF, MD, TXT, images)**, then *"Choose a project to reference its items and files…"*, the meter and **Add references** (`po-dg2-after-01-cards-empty`; before: `po-dg2-before-01-cards-empty`). |
| 2 | **Choose file**, pick `clip-noise.mp4` | A row under **Uploads (1)**: a video glyph, the name, *(54.1 KB)*, *placed only, not read* (a video is never sent to the AI; with **Use visual assets** ticked it can be placed in a slide), and ×. The title bar says *1 chosen*. |
| 3 | **Choose file** again, pick `logo.png` | A second row with a picture glyph and *(107.2 KB)*. **Uploads (2)**, *2 chosen*. The meter reads *About 2% of what D.O.G. can read for one deck*, as it did before the move (`po-dg2-after-02-cards-two-uploads`; before, the same two files were chips in card 1: `po-dg2-before-02-cards-two-uploads`). |
| 4 | Choose **Salt Hours**. **Add references**, **Scenes**, tick **The storm**, **Done** | In card 2, top to bottom: **Uploads (2)** with its two rows and **Choose file**, then **Items (1)** *Scene · The storm* with its eye and ×, the meter, **Add references**. The title bar says *3 chosen* (`po-dg2-after-03-one-list`). |
| 5 | **Add references** again, **Your notes**, tick the first, **Done**. Then **Remove all references** (it was *Remove all*; hover it: *"Removes the chosen items, files and notes. Your uploads stay."*) | The scene and the note go, and a line says *"2 references removed."* with **Undo**. Your two uploads stay; the title bar says *2 chosen*. **Undo** brings the two references back. |
| 6 | Press × on the `logo.png` row | That row goes, **Uploads (1)**, and the count follows. **Choose file** is still there. |
| 7 | **Choose file**, and in the file window choose *All files* and pick any file that is not a PDF, a text, a picture or a video | Nothing is added, and a red line right under **Choose file** says *"Please upload a PDF, Markdown, Text, Image, or Video file"*. Before, it was a red bar at the top of the page, out of sight once a dozen uploads had pushed **Choose file** down. The next upload clears it. |
| 8 | Click the **References** title bar | The card folds; its title bar still says how many are chosen, uploads included. Click again to open it. |
| 9 | Click an empty part of the page and press **Tab** until the orange ring reaches the chevron of **1 Project**, then keep pressing **Tab** | The chevron (a screen reader says *"PROJECT, button, expanded"*), the Project dropdown, **New project**, the **References** chevron, then each upload's × (a screen reader names it *"Remove"* and the file's name), then **Add references**. **Choose file** is not reached by **Tab**, as before (section 4). |
| 10 | With words in the deck context box, Tab to the first upload's × and press **Enter**, then **Enter** again | Each Enter removes one upload, and the ring moves on to the next ×, then to **Add references**. No deck starts. Before, the ring fell off the page after the first Enter, and the second Enter made a full deck from whatever was left. With the mouse, a × works as before. |

## 2. Your ask and your answers (2026-10-26, verbatim)

| Question | Your answer |
|---|---|
| The ask | *"one thing id like to fix. lets move the upload documents section in dog tool to the 2 References card. make a session chip for this"* |
| Card 1 after the move | "Keep it, renamed \"1 Project\" (Recommended)": three cards stay, *1 Project*, *2 References*, *3 Generate outline*; only the name changes. |
| Where in References | "First, above the chosen items (Recommended)": **Uploads (n)** is the first group, with its Choose file button; then Items, Files, Notes, the meter, Add references. |
| How the uploads look | "Rows like the other references (Recommended)": each upload a row with its glyph, name, size and Remove, in the same list style as Items, Files and Notes. |

No questions are open.

## 3. How it was checked

- **In Chromium, before and after**, at 1280x800 and 1440x900, the two sizes
  the same. Everything the upload area did was measured first and again
  after: the file kinds the picker offers, a kind it refuses (the same red
  line at the top), a second upload with the same name (both kept, as
  before), Remove, the limit of 20 (**Choose file** goes at 20 and comes back
  when one is removed), and **Choose file** opening the file picker under the
  mouse. The meter's figure and its hover were the same before and after in
  every state: no project, two uploads, a project, references chosen, folded,
  after **Remove all** and **Undo**, and past the limit. Enter with an upload
  asked for the deck context with the box empty and started a full deck with
  words in it. No request left the page.
- **A walk with Tab** from the top of the page went through 28 stops with no
  upload, before and after. With two uploads it went through 31, before and
  after: the two × buttons moved from card 1 to card 2, and each is now named
  by its file (before, both were *"Remove file"*).
- **Tests** on the real D.O.G. and on the References card. Each was made to
  fail first, by running it on the code before the move and by breaking the
  new code on purpose sixteen ways.
- **Code review, round 1**, by a separate reviewer driving Chromium. It found
  that nothing read, sent or counted had changed, and that the card's first
  line is true. It found three things to fix, all now fixed and tested.
  Enter on an upload's × left the keyboard nowhere, so the next Enter made a
  deck (step 10). The refusal was out of sight with many uploads (step 7).
  *Remove all* read as if it took the uploads too (step 5). It also noted the
  repeated "Project", the *(0.0 KB)* sizes and the hint without videos
  (section 4).

## 4. Left as it is

- **Choose file cannot be reached with Tab**, before and after. It is a
  label wrapped round a hidden file field, so neither takes keyboard focus and
  a screen reader does not hear it as a button. It was kept exactly as it was,
  as the brief asked; it is written down to fix (`docs/OUTSTANDING.md`,
  DG2-01).
- **No eye on an upload.** The eye shows what D.O.G. reads for a chosen
  reference. An upload is your own file, already on your computer, and showing
  it here would need new plumbing.
- **Card 1's title and its field label both say "Project".** The label is the
  dropdown's own; FX15 ties it to the dropdown as its name (written down as
  FX14-04), so it stays. Whether one of the two should go is yours to say.
- **Remove all references** removes the chosen references only, as *Remove
  all* did; an upload goes by its own ×. Only its name changed.
- **A file under about 50 bytes shows as *(0.0 KB)***, as its chip did.
- **Choose file's hint says *(PDF, MD, TXT, images)*** and does not name
  videos, though videos can be uploaded, as before.
- **A PDF upload over 100 pages** says nothing on its row, as its chip said
  nothing before. A chosen file's row does say so.
- **The pictures** show the two neutral files only.
