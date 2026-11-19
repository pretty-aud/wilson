# 102 — PDF TEXT ON THE DESKTOP (from 2026-11-19)

One small session, **F13** (`docs/sessions/briefs/po-f13-pdf-text-and-notes-test.md`),
on her word of 2026-11-19. The desktop app reads the text of a PDF, in
R.A.B.B.I.T.'s intake and in the rate card's PDF import, which it never did.
In plain words below: what was broken, what works now and only in the desktop
app, how to see it, what stays as it was in the browser, and the numbers
before and after. One small thing rides along: the last way a test of the
Notes tab could fail by chance. The two tests that had turned the automatic
checks red were fixed by F12, at her word, the same night.

## What was broken

The desktop app has never been able to read the words in a PDF. The part of WILSON that reads them arrived in April,
written for an older version of the PDF reader than the one installed, which works differently, so every attempt
failed. Two places were affected:

- **The rate card's PDF import** (Rate Card, Import, a `.pdf` file) said "PDF text extraction failed: extract-pdf 500"
  for every PDF.
- **R.A.B.B.I.T.'s intake** (a script, brief or schedule dropped in as a PDF to build a project from) treated every PDF
  as if it were blank, without saying so. The AI was given nothing from it.

## What works now, and only in the desktop app

- **The words of a PDF are read now**, page by page, in order, with a blank line between pages. Nothing is added
  between pages: the reader on its own writes a line like "-- 1 of 2 --" after each page, and WILSON leaves that out,
  so neither the rate card nor the AI sees it.
- **The rate card's PDF import finds the rows** of a rate card whose PDF has real text in it, on every page.
- **A file that is not a PDF** (renamed, damaged or empty) now says, in the import: "PDF text extraction failed: This
  file is not a PDF, or it is damaged."
- **A PDF locked with a password** now says: "PDF text extraction failed: This PDF is locked with a password. Save a
  copy without the password and try again."
- **Intake reads a PDF's words now.** When a PDF cannot be read, intake still says nothing and goes on without it,
  as before; whether it should tell you is your call (question 2).
- A PDF that is only pictures (a scan with no text in it) still has no words to read, and the import says so, as before.
- **Two gaps the review found, recorded for a later session:** in some PDFs written in Chinese, Japanese or Korean,
  those words are not read (the numbers and any English are); and a PDF with one damaged page still says
  "extract-pdf 500" instead of reading the pages that are fine.

## How to see it (after your next installer; nothing needs checking)

The new reading was proved inside the same engine the desktop app runs on, and on the files exactly as the installer
packs them, but never inside the running app itself: starting a built app opens your real data folder, so no session
does that. These two tries cover the rest:

1. **A real rate card.** In a spreadsheet, make a small rate card (a role and a day rate on each line, such as
   "Producer 1250") and save it as a PDF. In the desktop app, open the Rate Card, choose Import and pick that PDF. The
   preview should show its rows.
2. **A file that is not a PDF.** Copy any text file, rename the copy so it ends in `.pdf`, and import it the same way.
   You should see "This file is not a PDF, or it is damaged." and not "extract-pdf 500". Those words prove that the
   reader started inside the installed app, which is the one thing only the installed app can show.

## In the browser, as it was

Nothing in the browser reads a PDF's words, by an older choice: the rate card says "PDF import runs in the desktop app
only. Export the rate card as CSV or XLSX and import that instead.", and intake treats a PDF as blank. That is
unchanged (question 1).

## Before and after

| | Before | After |
|---|---|---|
| A PDF in the desktop's reader | refused every time ("extract-pdf 500") | its words, page by page |
| A file that is not a PDF, or a locked one | "extract-pdf 500" | plain words saying which |
| The app's main script | 4,277,505 bytes | 4,277,618 (113 bytes more: the import's new lines) |
| The tests, two full runs each | 562 files; 14,869 passed | 563 files; 14,881 passed (the twelve new checks among them) |
| The Notes tab's test file, run alone | 10 runs of 10 passed | 30 of 30 |

**The Notes test.** One check in the Notes tab's tests could fail by chance. When a note you are typing in is moved to
the trash on another device, the test looked for the editor's lock a split second before the app applies it. It failed
once on the automatic checks, on 17 November. The check now waits for the lock, and a new test holds the lock back on
purpose to show the old check failing. Nothing in the Notes tab itself changed.

## Questions for you

(Asked in F13's chat too. The recommended answer is first; until you answer, nothing changes.)

1. **Should the browser read PDFs too?** a) Not now (recommended): the browser keeps saying "desktop app only" and
   suggests CSV or XLSX. b) Yes: a later session adds the reader to the browser version; it loads only when a PDF is
   imported (about half a megabyte, plus one 2 MB file).
2. **Should intake tell you when it could not read a PDF?** a) Yes (recommended): a later session makes intake name
   the PDF it could not read and why (not a PDF, or locked), and go on with the other files. b) No: it stays silent, as
   today.
3. **The PDF reader adds about 94 MB to the desktop app's files, and most of it is never used.** a) Leave it for now
   (recommended): it works, and the installer's size is not on the way to 1.0. b) Have a later session look for a
   smaller reader.
