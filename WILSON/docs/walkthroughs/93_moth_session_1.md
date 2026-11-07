# 93 — M.O.T.H. SESSION 1

M.O.T.H. is the new page for working with files across projects. This file says what is there now, how to see it, what
it does not do yet, and what was checked. Nothing here waits on you except the two things under **What to do**.

None of this is on staging or production. The database changes are on your test database, and the code is on its own
branch until the planning session merges it.

## What you see now

- **A page of its own.** M.O.T.H. sits in the sidebar with the other tools. On the left: your personal space, the
  projects you can see, and Trash. On the right: the open project's files, a search over what has loaded, and *Show more*
  when there is more.
- **Your personal space.** Everyone gets one the first time they open the page, for files that belong to no project yet.
  Nobody else sees it in M.O.T.H. An admin can open it from Files, and each time that is recorded in the Logs.
- **Move to.** Tick files and move them to a folder or to another project you may change. Where the move needs a new copy
  of the file, the copy is made and checked first, so a file is never without its contents. A file's links to tasks,
  shots and assets stay with the project it left, and you are told how many did.
- **Delete asks first.** It names the file, or says how many, and says if any are hidden by your search. Deleted files
  stay in Trash for 30 days, with the days left beside each one.
- **Undo and Redo.** The buttons, Ctrl+Z and Ctrl+Y work on the last ten things you did here. If Undo fails because the
  server has gone away or a program has the file open, it stays there to try again. It goes only when trying again could
  never work, and then you are told why.
- **Files that are not shown.** Invoices, Legal files and anything an expense names never appear here, in the list, the
  search, a move or the trash. They stay where they are looked after.
- **A company on an office server.** WILSON lists the files and leaves them where they are. Only names and details go to
  the cloud, never the file itself. A line above the list says when it was last checked and by whom, and how many files
  were not found. The desktop app checks by itself when you open a project, at most every ten minutes, and *Refresh* asks
  for a check now. A browser can look at the list but cannot change a file on the server, and says so.
- **A person who has left.** Once someone is no longer an active member, an admin sees their files in Files, with a way to
  move them into a project. The move is recorded in the admin activity list. It offers only what can move: invoices and
  Legal files stay, and so does anything only on that person's computer or in their folder on the office server. On a
  company that keeps its files on an office server, or in its own bucket, nothing can be moved this way yet.
- **Storage.** A member is told only that the company's storage is full or nearly full, and sees no amounts. The figures
  are an admin's, because the total now holds people's personal files. Nearly full is nine parts in ten.

## What to do

1. **See it, with no server and no risk.** In a dev build, open M.O.T.H. with `?storage=network` on the address, as in
   `http://localhost:5302/moth?storage=network`. That is a pretend company on an office server: Salt Hours has a dozen
   listed files, one not found at the last check, one in Trash, and one move left unfinished. Add `&fixtures=member` to
   see it as a plain member. Nothing can be changed there; a write says so.
2. **Try it on a real office server, when you can.** `docs/RELEASE_TESTING.md` §T lists the steps. Nothing but a real server
   can show how it behaves with its own links, its own permissions and a slow connection.

## Worth knowing

- **A link already made keeps working.** A link to a file, made before that file was moved or deleted, works until it
  expires, which can be up to an hour. Moving or deleting a file does not call it back.
- **The office-server list shows what the person checking can open.** If someone with narrow rights on the server presses
  Refresh, everyone on the project sees only what that person could open. The line above the list says so, and so does
  the Storage page.
- **A moved file can count twice for a while.** When a move makes a new copy in Petal's storage, the old copy counts toward
  the company's storage until it is cleared. So a nearly full company can go over during a move, and come back down once
  it is cleared. A move is not refused for that, because in the end it adds nothing.
- **A folder of numbered images reads as one item.** That is how frame sequences stay one row. If you move two numbered
  stills into a folder of their own they keep their own rows, but new files added to that folder on the server will not
  appear until the folder holds something that is not numbered.
- **Someone whose access is removed can go on hearing live updates for a while.** If a person is deactivated or an admin is demoted
  while WILSON is open, the updates already reaching them carry on until their sign-in next renews or runs out, at most an
  hour. They cannot join anything new once deactivated, and a project made private is cut off at once. This was measured on a
  throwaway database, and it was already so before this work. It is on the outstanding list as MO1-01.
- **A file deleted on the desktop has its own 30 days.** It sits in a hidden folder beside the project's files. A project
  with deleted files waits to change where its files live, until they have been restored or their time is up, so none is
  left behind.

## Not built yet

- A way to empty the desktop's trash before its 30 days are up.
- Moving a file between folders within one project on the office server. Do that on the server, and the next check follows it.
- A trash screen for deleted invoices and Legal files on the desktop. They have the Undo on the toast, then 30 days.
- Move to from the Files page. M.O.T.H. has it.
- Live updates for M.O.T.H.: another person's change shows when the list next reads. They come in a later session.

## What was checked

Two independent reviews of everything this work built, each by 30 helper agents who had not seen the other's findings.
The first found 74 things and the second 65, and every one was either fixed or written down with the reason it was left.
The worst of them:

- Two renames of one file on an office server, at the same moment, could delete it.
- After a crash during a copy between two drives, recovery could delete the only whole copy.
- A move's Undo could be lost for good because of a passing network blip.

Those are fixed, each with a test shown failing first. The last database change, 0121, then went through about 6,100 database
checks and 90 deliberately broken versions of itself on a throwaway database, to prove the checks catch what they
claim to. The ten that were not caught are named in the hand-off, each for a reason that was read and understood. All of this
was on test data; your real data has not been read or changed.

## Pictures

In the folder *93_moth_session_1 pictures* beside this file, all from the pretend company:

- **office-server list.jpg:** the line above the list, and a file not found at the last check.
- **trash and a move left over.jpg:** a deleted file with its days left, and a move a laptop never finished. From a browser it
  asks you to check where the file is before you call the move off.

## Questions

None. The merge, the deploy to the test database's functions and the change for companies on their own bucket are for
the planning session, which will ask you what it needs.
