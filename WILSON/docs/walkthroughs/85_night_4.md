# 85 — NIGHT 4

One file for the night (`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one
section per session: **M2** (the desktop → cloud migration, part 2), **P1**
(previews for a workspace on its own storage), **D1** (the desktop keeps its
stored state across a relaunch) and **R2** (release readiness). Each section
stands on its own; answer its questions by their numbers.

## M2 — The migration carries budgets, levels and experiences

1. **A desktop project now moves whole, but for its team.** Its budget —
   the bid versions, every line, the actuals with their invoices, the
   expenses with their receipts, the role rates — its levels and
   experiences (and their folders and files, the assets' and tasks' links to
   them), and the links on its tasks go up with everything that moved
   before. The locked bid version arrives locked; an open one arrives open,
   with the rows it had set aside still aside.
2. **A budget moves only for someone who may see it.** In the cloud only a
   workspace admin or the project's manager sees a project's budget. You
   become a project's manager when the migration puts it in the cloud, so
   your own run carries the budget. Someone else running it for a project
   that is already there sees one line saying the budget stayed on their
   computer, and nothing fails.
3. **A second run brings back nothing a teammate removed.** The project on
   your computer now keeps a record of every row the migration carried. Run
   it again after someone deletes a budget line or a level in the browser,
   and that row stays deleted. The report names it.
4. **Your three statuses exist in the cloud.** Draft, Wrapped and Inactive
   save in the browser now, and a migrated project keeps its own. Clearing
   the Director or the Producer saves too.

**What this is.** M2 of night 4 (`docs/sessions/briefs/po-m2-migration-part-2.md`),
your two rulings of 2026-10-28 (*"Add the three to the cloud"*; *"A night
after part 2"*). Every row shape was tried on wilson-dev first and rolled
back. Migration **0103** adds the three statuses, and the controller puts it
on staging before you start. The team, an asset's version history, the files
your desktop keeps with its rows, and the company's rate cards and task
templates move in night 5 (M3).

**Before you start.** The controller has said 0103 is on staging. Use the
desktop app, signed in to the beta's company, on a desktop project with a
budget: bid versions (one locked), lines, an actual with an invoice, an
expense with a receipt. If you have a game project, its levels and
experiences go too. A second person in the browser helps with step 7, or
use a second browser window signed in as yourself.

1. **Dry-run.** Settings → Storage → *Migrate to cloud* → **Dry-run first**.
   The table has new rows: **levels**, **experiences** (above *assets*),
   **task dependencies** and **links on tasks** (the old *task links* row was
   the dependencies, and now says so), and after *files*: **bid versions**,
   **budget lines**, **actuals**, **expenses**, **role rates**. *Would insert*
   counts what will go.
2. **Read the lines under the table.** Only those that apply appear:
   - *Stays on this computer for now (a later run of the migration carries
     it): … team members named on budget lines, … team member's project rate
     …* A crew line priced for someone on your desktop team goes up without
     the person; the person comes with the team in night 5. A rate set for a
     person stays here; a role's rate goes.
   - *Stays on this computer (the migration does not carry it): … invoice
     attached by a path on this computer …* An invoice attached in the old
     desktop-only way (a path on your disk) is not uploaded; its actual goes
     without it.
   - *… receipt kept as an ordinary file on this computer goes up behind the
     money gate, as the expense or actual naming it does.* Only if a receipt
     was added before the money gate existed: it goes where only managers
     and admins see it.
   - In the progress log: *the locked bid version will be set in the cloud
     as on this computer, if none is there.*
3. **Migrate.** Press **Migrate**. The log streams. When it ends, hover
   **Migrate** and read: *Done. Running it again writes nothing already in
   the cloud and brings back nothing a teammate removed there since: this
   computer keeps a record of every row the migration carried. The team,
   asset versions and the files kept with assets, scenes, shots, levels and
   experiences on this computer move in a later run of the migration.*
4. **Check it in the browser.** Open the project on the beta:
   - **Budget**: the versions, the locked one locked (*Versions*), the lines
     with their rates and days, the actuals in their periods. An actual's
     invoice opens (**Open invoice**). The expenses carry their receipts.
     A crew line priced for one of your desktop team members has no person
     yet: its actuals count in the Summary's totals, but the **Crew** tab,
     which lists people, shows it only once night 5 moves the team.
   - **Levels** and **Experiences**: each row, its status, its folder and
     files. An asset in a level shows the level.
   - **Tasks**: a task's links, if your project had any.
5. **Run it again at once.** **Dry-run**, then **Migrate**: nothing is
   inserted, and no line says anything was removed.
6. **The statuses, in the browser.** On another project: R.A.B.B.I.T. →
   the project's settings → **Status** → **Draft**, then **Wrapped**; reload
   each time, and it stays. On the **Projects** page, set one to
   **Inactive**; reload. In the settings, clear the **Director** (*Select
   director…*) and the **Producer**; reload: both empty, no error.
7. **A teammate removes something.** In the browser, delete one budget line
   (Budget → the line's delete) and one level (Levels → delete).
8. **Run it again on the desktop.** **Dry-run**: the first line under the
   table reads *Removed in the cloud since an earlier run, so not carried
   again: 1 level, 1 budget line*, with each one's name below it.
   **Migrate**, then reload the browser: neither came back.
9. **If someone else runs it** (optional: a workspace manager who is not
   the project's manager, on a project you migrated): their report shows
   one line, *1 project's budget (… rows, with its receipts) stays on this
   computer: in the cloud only a workspace admin or the project's manager
   sees its budget, and you are neither (a workspace admin can make you the
   project's manager; then run again).* Nothing else of the project fails.
   **Archive and clear local** is not offered (it would clear the only copy
   of that budget), and hovering **Migrate** reads *1 project's budget is
   still on this computer, so it keeps its copy: once a workspace admin
   makes you the project's manager, Migrate again.*

**Questions**

- **Q1.** A crew line priced for one of your desktop team members arrives
  in the cloud without the person until night 5 moves the team: its money
  is in the Summary's totals, but the Crew tab does not list it until then.
  Is that fine for a few days, or should night 5 come before you migrate a
  project with crew actuals?
- **Q2.** The record means a project you delete in the cloud is never put
  back by the migration, even if you want it back. Should night 5 add a
  way to make this computer forget what it carried (*Carry everything
  again*), or is deleting the project for good the right answer?
- **Q3.** An invoice attached the old way (a path on one computer) is not
  carried, and its actual goes without it. Should the report list those
  actuals by name, so you can attach the invoice again in the browser?
