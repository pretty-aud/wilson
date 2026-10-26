# 76 — THE AI'S FILE STORE: WHAT D.O.G. SENT, AND LETTING GO OF IT

1. **What was wrong.** To make a deck, D.O.G. hands your PDFs, pictures and
   long texts to the AI provider's file store so the AI can read them. Until
   now nothing ever took them back out. They piled up there, under the one key
   that every company and every copy of WILSON shares (OUTSTANDING DG1-03).
2. **D.O.G. lets go now.** A file you remove from the upload list, a
   reference you untick, a References set you clear, and everything D.O.G.
   holds when you sign out or close WILSON are deleted from the store. Making
   the deck again still reuses what is there, on purpose: *Regenerate* does
   not upload the same PDF a second time.
3. **New files delete themselves after a day.** Every upload now asks the
   store to delete it by itself after 24 hours. A crash, a window killed while
   closing, or an older WILSON therefore leaves nothing behind for long.
   D.O.G. uploads a file again after 20 hours rather than use one about to go.
4. **A card in the Admin Terminal.** *Diagnostics → The AI's file store*
   shows what this company has in the store now: how many files, their size,
   the oldest, and how many are older than 24 hours. A button deletes those,
   after a question that says exactly what will go. It never shows a file's
   name, and never another company's files.
5. **The operator's view.** The operator console gains **AI files**: the
   whole store under the platform key, as counts, and the same clean-up across
   every company of that copy of WILSON. Files that copy has no record of
   (another copy's) are counted and left alone.

**What this is.** FX12 of the post-overhaul plan
(`docs/sessions/briefs/po-fx12-ai-file-store-cleanup.md`). Written 2026-10-25
against `feat/post-overhaul-edit-versioning` (`po/fx12-ai-file-store-cleanup`).
No database change. Two server functions: `ai-files` changed and
`operator-ai-files` is new. Both are on wilson-dev now; staging and live get
them when the controller deploys them.

**🚨 Your deadline: 9 November** (your answer: *"Clean up before 9 November
(Recommended)"*). WILSON can tell whose a stored file is only from its receipt
in WILSON's own log, and the log throws away pages older than 90 days. The
first files went into the store on 11 August, so their receipts go on
9 November. After that no clean-up can prove whose those files are, and they
stay in the store. Files from now on are safe either way: they delete
themselves after a day. So on staging and on live, once the controller has
deployed this, press the clean-up (part C) before 9 November.

## 1. Step by step

**A. The card, on the development copy's test data** (port 5302, the
`fx12-worktree` entry: the fixtures answer for the store, since the real one
is reached only when signed in)

| # | Do | You should see |
|---|----|----------------|
| 1 | Open the **Admin Terminal**, **Diagnostics**, and scroll to the last card | **The AI's file store**: *Files 3*, *Total size 2.7 MB*, *Oldest 2 days*, *Older than 24 h 2*; **Delete files older than 24 hours** and **Check again**; a grey line at the foot: *This company's files only, never another's. File names are never shown or recorded.* |
| 2 | **Delete files older than 24 hours** | A red question in its place: *Permanently delete 2 files older than 24 hours?* with **Yes, delete** and **Cancel**. Nothing is deleted yet. |
| 3 | **Cancel**, then the button again and **Yes, delete** | Green: *Deleted 2 files. Kept 1 younger than 24 hours.* The tiles now read *1*, *94 KB*, *2 hours*, *0*, and the button is greyed. |
| 4 | Add `?aiFiles=empty` to the address, reload, open the card again | *Files 0*; the button greyed. |
| 5 | `?aiFiles=error` instead | Red: *The AI's file store could not be read just now — try again.* |

**B. The real store, on wilson-dev (your settling test)**

Run the development copy against wilson-dev. Sign in as a seeded smoke user,
never your own account. Use a small PDF of a few KB with nothing confidential
in it.

```bash
npx vite C:/Users/Audrey/Documents/My_Work/Dev_Work/wilson/WILSON/.claude/worktrees/hopeful-merkle-b794b2/WILSON --port 5302
```

| # | Do | You should see |
|---|----|----------------|
| 6 | Sign in as the smoke admin; **Admin Terminal → Diagnostics → The AI's file store** | The smoke company's files, most likely *Files 0* (the CI probe deletes its own test file within seconds). |
| 7 | **D.O.G.**: upload the small PDF and make a single page | A page. |
| 8 | Back to the card, **Check again** | *Files 1*, *Oldest under an hour*, *Older than 24 h 0*; the delete button greyed (nothing is old enough). |
| 9 | In D.O.G., make the page again | Back on the card, **Check again** still says *Files 1*: the deck reused the file. |
| 10 | Remove the PDF from D.O.G.'s upload list (its ×), then **Check again** on the card | *Files 0*. |
| 11 | Upload it again, make a page, then close WILSON with the window's close button (**Close** in its question) | WILSON may take a second longer to close: it is deleting the file first. |
| 12 | Reopen WILSON, sign in, and open the card | *Files 0*. |
| 13 | **Logs**, code **WIL-6001** | Rows *AI file deleted*, their context `tool: ai-files`, `stage: delete`, `via: member`, an outcome, a size; never a file name. |

**C. Staging and live, before 9 November** (after the controller deploys)

| # | Do | You should see |
|---|----|----------------|
| 14 | On staging, signed in as a company admin: the card | That company's files, with how many are older than 24 hours. |
| 15 | **Delete files older than 24 hours**, **Yes, delete** | *Deleted n files.* If more than 150 were due, *More are waiting: run it again.* (a run deletes at most 150, so the store's limit is never crowded); press it again until it stops saying so. |
| 16 | The operator console (`/wilsonadmin`), **AI files** | The whole store as counts: *In the store (every environment)*, *Tied to a company of this environment*, *No receipt here (another environment's): left alone*, *A receipt that does not match its file: left alone*, with files, size and oldest. |
| 17 | **Delete files older than 24 hours**, **Yes, delete** | *Deleted n file(s) across m companies.* Each company's Logs gains a row per file it lost, and the operator's **Audit** a *blob.purged* row naming `ai-files`. |
| 18 | The same on live | The same, for live's companies. |

## 2. What changed, in a sentence each

- **D.O.G.** deletes an uploaded file from the store when it leaves the
  upload list or the References, and everything it holds when you sign out or
  close WILSON. It never deletes after making a deck.
- **Every upload** asks the store to delete it by itself after 24 hours,
  and reaches it under a plain name (*document.pdf*), never the file's own.
- **A file that has gone from the store** (cleaned up, or expired) is uploaded
  again once if a deck still needs it, before anything is said to you.
- **The Admin Terminal's** new card shows this company's stored files as
  counts and cleans up those older than 24 hours.
- **The operator console's** new *AI files* section does the same across
  every company of that copy of WILSON, as counts only.

## 3. Your answers (2026-10-25, verbatim)

| Question | Your answer |
|---|---|
| The shared key's balance cannot be read; the probe's calls are free Files calls and one call Anthropic refuses before reading. How to handle the balance check? | *"Go ahead, free calls (Recommended)"* |
| Keep the CI probe (one 44-byte test file, deleted seconds later) on every push? | *"Every push (Recommended)"* |
| The 90-day receipts (asked twice; the first time you wrote *"elaborate more here please and ask again. explain it to me like im 10 years old"*) | *"Clean up before 9 November (Recommended)"* |

No questions are open.

## 4. What was measured

| What | Result |
|---|---|
| A deck call naming a file that was deleted | Refused before the AI reads anything: HTTP 404, *not found*, the message naming the file. No tokens spent. D.O.G.'s "upload it again once" is built to exactly this. |
| A file asking to expire in an hour | The store set it to expire exactly 3,600 seconds after it was made. |
| WILSON's receipt, against the store's own clock | Written 229 ms after the store made the file. |
| Closing the desktop app while deletes are being sent | Sent at the last moment, they die with the app whenever the network takes a round trip; sent first and waited for (at most 4 seconds), they arrive. So WILSON waits for them when it closes. |

## 5. Left as it is, and why

- **The file's name stays on your computer.** Each upload reaches the store
  as *document.pdf*, *image.png* and so on; the AI still reads the file's
  name where D.O.G.'s own prompt lists the files, as before.
- **A company's own AI key** (set by the operator for that company) holds
  that company's uploads in the company's own store; its admin's card cleans
  those up. The operator's view reads only the platform key's store.
- **Quitting WILSON another way** (an update restarting it, the task manager)
  skips the close's deletes; those files delete themselves within a day.
