# 86 — NIGHT 5

One file for the night (`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one
section per session: **M3** (the desktop → cloud migration, part 3) and
**P8** (the four areas' ten High findings fixed). Each section stands on its
own; answer its questions by their numbers.

## M3 — The migration carries the team, the rate cards, the templates and your files

1. **Your desktop team arrives, matched by email.** Each desktop team
   member whose email is a company account's is that account in the cloud
   (your ruling of 2026-10-28: *"Match by email, leave the rest here"*).
   Only a workspace admin or manager can make the match — the cloud shows
   emails to nobody else — so run it as one. Anyone without a WILSON account
   is named in the report, by name, and stays on this computer: their seats,
   crew lines, rates and tasks arrive without the person until they join. No
   email is sent to anyone.
2. **The project's roster, and every person on every row.** Team
   assignments become the project's roster, with the role as the desktop
   says and the member's job title. A crew line priced for a team member, a
   rate set for one, a task's assignee and reviewer, the project's producer
   and director: all name the account now. A crew line an earlier run
   carried without its person gets the person on this run (walkthrough 85,
   Q1), as do tasks and the project a run before tonight's build carried
   with a name nobody could read.
3. **The files kept with your assets, scenes, shots, levels and
   experiences go up, with their contents.** Each becomes a file in the
   cloud with its own name, in its folder, linked to its row, where the
   company keeps its media. A large file goes up in pieces, never held whole
   in memory. A company that keeps its media on its own server keeps these
   files there (your ruling the same evening); the browser says where they
   are.
4. **The company's rate cards and task templates go once.** Each desktop
   card arrives beside the cloud's own General and Internal pair, with its
   entries (a workspace admin, or someone with the rate card edit grant);
   each template with its tasks (a workspace admin or manager), and an asset
   made from one is linked to it again.
5. **A receipt an earlier run left open is behind the money gate now.** If
   you moved a project with night 3's build and it had a receipt kept
   before receipts became money, this run moves it — its picture, its file,
   its row — so only managers and admins see it.
6. **Archive and clear local keeps its promise.** The team members, rate
   cards and task templates on this computer are archived and cleared with
   the projects.

**What this is.** M3 of night 5 (`docs/sessions/briefs/po-m3-migration-part-3.md`),
your three rulings of 2026-10-28 (*"A night after part 2"*; *"Match by
email, leave the rest here"*; *"Stay on the server for 1.0"*). Every row
shape was tried on wilson-dev first and rolled back; a design round on Fable
came before any code. No migration: staging owes nothing from M3.

**Before you start.** The desktop app, signed in to the beta's company as a
**workspace admin**, on a desktop project with a team (Team tab: a few
people assigned, one of them a manager), a budget with a crew line priced
for one of them, and a file or two added to an asset in its folder (Files →
the asset). On the desktop's Team Members page, one person should have an
email that matches their WILSON account, and one should have none (or an
email nobody has an account for). A second browser window signed in as
yourself helps for steps 5 and 6.

1. **Dry-run.** Settings → Storage → *Migrate to cloud* → **Dry-run**. The
   table has new rows: **roster seats** right after *projects*, **files kept
   with rows** after *files*, and **rate cards**, **rate card entries** and
   **task templates** at the end. *Would insert* counts what will go.
2. **Read the people lines under the table.** They come first:
   - *N of M desktop team members matched a company account by email.*
   - *K desktop team members not matched to a company account (no WILSON
     account yet: …; no email on this computer: …): their seats, crew lines,
     rates and tasks arrive without the person until they join (no email is
     sent).* The names are your desktop team's; no email is shown anywhere.
   - *N people seated as a project's manager — as on this computer, or as
     its producer, whom the cloud seats so: in the cloud a project manager
     sees its budget and sets its roster (make them members in the browser if
     that is too much): …* — Q1 below.
   - *N files kept with assets, scenes, shots, levels and experiences (X MB)
     will upload to the company's storage.* The total is said before
     anything moves.
   - If a receipt an earlier run left open is there: *N receipts an earlier
     run carried as ordinary files will be put behind the money gate.*
   - If you are not a workspace admin or manager, one line instead: *the
     team stays on this computer: in the cloud only a workspace admin or
     manager may read the company's emails, which the migration matches your
     desktop team by (ask one to run it)* — and Migrate will not say Done
     until an admin runs it.
3. **Migrate.** Press **Migrate**. The log streams; the files' line reads
   *… uploaded to the company's storage* when they are in. When it ends,
   hover **Migrate** and read: *Done. Running it again writes nothing already
   in the cloud and brings back nothing a teammate removed there since: this
   computer keeps a record of every row the migration carried.* If a file's
   body was not on this computer (a drive not mounted), the line *N files …
   have no body on this computer right now …* appears and Migrate is not
   Done: make the folder reachable and Migrate again.
4. **Check it in the browser.** Open the project on the beta:
   - **Team**: the roster shows your desktop team's people who had accounts,
     with their roles and job titles; the person without an account is not
     there (they arrive when they join and you run again).
   - **Budget → Crew**: the crew line priced for a team member now shows the
     person, and their actuals sit under them (walkthrough 85's Q1 is
     answered by this run).
   - **Rate card** (Admin Terminal or the Rate card page): the company's
     General and Internal cards as before, and your desktop's cards beside
     them with their entries; an entry for a person without an account is
     not there.
   - **Files**: a file you kept with an asset is in the asset's folder,
     named as on the desktop; its preview opens. A second version of the
     same file is a second row whose description starts with its label
     (*v002*) — Q2 below.
   - **New asset → Task template**: your desktop's templates are in the
     list, and an asset you made from one shows it.
5. **Run it again at once.** **Dry-run**, then **Migrate**: nothing is
   inserted, no file is uploaded again, and no line says anything was
   removed.
6. **A teammate removes a seat.** In the browser, remove one person from the
   project's roster (Team). On the desktop, **Dry-run**: the first line under
   the table reads *Removed in the cloud since an earlier run, so not carried
   again: 1 roster seat*, with the person's name below it. **Migrate**: the
   seat does not come back.

**Questions**

- **Q1.** A desktop team member assigned as a *manager*, and anyone named
  as the project's *producer*, is seated as the project's **manager** in the
  cloud — which there means they see the budget and set the roster. The
  report names them. Keep it (Recommended: the desktop said manager, and the
  cloud seats a producer so itself), or seat everyone as a plain member and
  promote by hand in the browser?
- **Q2.** A file kept with an asset in two versions on the desktop (v001,
  v002) arrives as two files of the same name; the second's description
  starts with *v002* so you can tell them apart. Keep that (Recommended),
  or put the label into the file's name (*plate (v002).png*)?
- **Q3.** For a company whose media is in its own S3 bucket, a file past
  5 GiB is left on this computer and counted: the bucket takes a file in one
  piece. Fine for 1.0 (Recommended), or should the migration wait for a
  multipart upload before carrying such a company's files at all?
- **Q4.** A desktop team member with no email on this computer can never be
  matched. Should the morning note ask you to add emails on the desktop's
  Team Members page before migrating (Recommended), or should a later build
  match by name as well (not recommended: two people can share a name)?
