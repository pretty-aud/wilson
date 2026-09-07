# Hand-off protocol for the track sessions

Audrey, 2026-09-04: *"i dont want to keep starting new sessions. as we hit
certain milestones in each track i want you to check context and memory
length of a session and think about when it may help to move onto an entirely
new session. at that point you give me a hand off md to give the next session
... we can also just have you create the hand off and kick off the next
session."*

This file is that rule, made concrete. Every track session reads it first.

---

## 1. One bundle per session

A session does ONE bundle of its track brief (`TRACK_A_…`, `TRACK_B_…`,
`TRACK_C_…`), then hands off. A two-session bundle (A2, B2, C1) hands off at
the split its brief names. Do not start the next bundle "while you are here":
the point of the hand-off is a fresh context for the next piece of work.

Hand off EARLY, mid-bundle, if any of these is true:

- the harness has compacted the conversation once already (a summary of
  earlier context appeared at the top of your view);
- you have read more than roughly 300 KB of files or tool output;
- you are about to start an adversarial review round (reviews are where
  context bloats fastest);
- a migration has landed on dev and staging and the next step is client work
  (a natural seam).

A hand-off is cheap. A session that runs past its context and loses the
thread is not.

## 2. Fresh-worktree setup (every spawned session does this first)

The desktop app spawns you into a NEW worktree under
`WILSON/.claude/worktrees/<name>/` on a `claude/<name>` branch. 🚨 **It is cut
from `main`, not from `feat/multi-user-v1`** (Track B measured this on
2026-09-06: `docs/sessions/` was missing). It has no dependencies, no local
env, no Supabase link, and **its auto-memory folder is empty** — memory is
per project path, so nothing this repo's main sessions remember reaches you.
The brief, the fix plan, the hand-off and the repo docs are your whole
context; do not expect recalled rules.

```
git fetch origin
git checkout track-a-product         # if the branch exists (a continuation)
# — or, on the very first session of a track —
git merge --ff-only feat/multi-user-v1 && git branch -m track-a-product
npm install --ignore-scripts         # the worktree has no node_modules
git checkout -- package-lock.json    # the install rewrites it; do not commit that
```

Copy `.env.local` from the canonical checkout
(`C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\.env.local`) into
the worktree's `WILSON/`. **Never commit it**; it is gitignored and must stay so.

```
supabase link --project-ref eqjzmnvkrakroyqxfsvw --password ""   # wilson-dev; run from WILSON/ in the worktree
```

Then confirm `supabase/.temp/linked-project.json` and `supabase/.temp/project-ref`
both say wilson-dev. `supabase/.temp/` is gitignored, so a fresh worktree is
UNLINKED until you do this, and `db query --linked` fails with "Cannot find
project ref". Reading another environment uses the throwaway `--workdir`
recipe (copy `supabase/config.toml` and `supabase/templates/` into a scratch
directory, `link` there, `db query --linked --workdir <dir>`; put
`inet_server_addr()` and a workspace count in every query).

If a hand-off file names a branch that already exists (a continuation), check
it out instead of renaming: `git checkout track-a-product`. If git refuses
because the branch is still checked out in the previous session's stale
worktree, use `git checkout --ignore-other-worktrees track-a-product`; do
not try to detach or remove the other worktree (the classifier blocks it,
and it is not yours).

**`RLS_TABLES` entries land with their suite.** The coverage guard runs on
the branch being tested and demands the `*_<table>.sql` file there, so each
track adds its own table names to `RLS_TABLES` in the same commit as the
suite, on its own branch. Track C's ownership of that list means it resolves
the (adjacent-line) conflicts when branches meet, not that it makes every
addition.

🚨 **Staging is behind a permission wall in spawned sessions.** The desktop
app's classifier allows `supabase link` and `functions deploy` against dev
(the linked project) and allows `functions list --project-ref …` reads
against any project, but BLOCKS `link` and `deploy` against staging. Do not
work around it. Land the change on dev, verify there, and write the exact
staging command into the hand-off's "Waiting on Audrey" section; she either
allows it when the app prompts or runs it herself. A bundle whose function
must be on staging before its client merges (a merge deploys the beta)
does not merge until that command has run.

Run `supabase db query --linked` **one query per call**; three in one shell
loop hung. Write files longer than ~100 lines with the Write tool, not a
heredoc.

**Local-only docs.** `docs/fixes/` (the phase briefs and their README) is
gitignored by Audrey's choice (*"these docs dont need to be pushed"*), so it
is absent from every worktree. Read those files by absolute path from the
canonical checkout, `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON\docs\fixes\`,
and never add them to git. `.env.local` is the same: copy, never commit.

## 3. Milestones, and what "check context" means

Milestones are bundle boundaries, the sub-boundaries a brief names, and the
moments in §1. At each one, before deciding to continue, write down in the
chat: what has been merged, what is committed but unmerged, what is
uncommitted (should be nothing), and a one-line estimate of how much context
has been consumed (how many large files and tool outputs are behind you). If
the honest answer is "a lot", hand off. Audrey reads that line; make it
plain.

## 4. The hand-off file

Path: `docs/sessions/handoffs/<track>-<bundle>-<YYYY-MM-DD>.md` on the track
branch, committed and pushed BEFORE the hand-off, so the next session (in a
fresh worktree) can read it. Contents, in this order:

1. **Where you are:** track, bundle, branch name, last commit hash, whether the
   bundle is merged into `feat/multi-user-v1` or not.
2. **State, measured, not remembered:** migration numbers used from the
   track's reservation; what is applied on dev / staging / prod BY QUERY;
   which Edge Functions were deployed where, with versions from
   `functions list`; pgTAP suite count; vitest count; CI status on the pushed
   head.
3. **Done and verified:** each finished item with the commit that did it and
   how it was verified (query, harness, test, walkthrough report).
4. **In flight:** anything started and not finished, with the exact next
   action. Never hand off with uncommitted work; commit it on the track branch
   even if it is a draft, and say so.
5. **Traps hit:** anything this session learned the hard way that the brief
   did not say.
6. **Waiting on Audrey:** walkthroughs sent and not yet reported; decisions
   asked and not yet answered; anything hers (a test bucket, a paste, a
   rotation).
7. **Next session's first three steps**, verbatim, so it can start without
   re-deriving anything.
8. **Auto-memory: none.** Your worktree has its own, empty memory folder, and
   the main repo's memory is not yours to edit. The hand-off file IS the
   memory; put every lesson in §5 "Traps hit". The controller session reads
   hand-offs and records cross-track lessons in the main memory.

## 5. Kicking off the next session

After the hand-off file is committed and pushed, create the next session for
Audrey with the `spawn_task` tool (the desktop app shows a chip she clicks
once): `cwd` = `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson\WILSON`; the
title `Continue Track X: bundle Xn+1`; a self-contained prompt that names, in
order, this protocol file, the hand-off file, the track brief and the fix
plan, says which bundle to do, and states that the worktree is cut from
`main` so the first command is `git fetch origin && git checkout <track
branch>` (the paths it names do not exist until then). She has given standing permission for
this (2026-09-04); the chip is her click.

Then close out in the chat as the briefs say: remaining bundles, plain
English, fixed / diagnosed / hers to do.

## 6. Merging, in tandem

- Merge `feat/multi-user-v1` INTO the track branch before every bundle
  starts and before every merge back; resolve; re-run vitest.
- A bundle merges back only after its two review rounds AND Audrey's
  walkthrough report. If the report has not come back by the hand-off, the
  bundle stays on the track branch and the hand-off says so; the next session
  merges it when she reports.
- Always a merge commit (`git merge --no-ff`), never squash; push the branch
  and `feat/multi-user-v1` after.
- Shared-file owners and reserved migration/suite numbers are in
  `FIX_PLAN_2026-09-04.md` "Rules for running tracks in tandem". Ask, do not
  take.
- `feat/multi-user-v1` auto-deploys the staging-backed beta on push. A merge
  is a deploy; its migration must already be on staging.
- **Shared docs have no single owner, so edit them narrowly.** `OUTSTANDING.md`,
  `SYSTEMS_HANDBOOK.md`, `CHANGELOG.md`, `MASTER_PLAN*.md`, `OWED_AUDREY.md`,
  `RELEASE_TESTING.md`, `NETWORK_STORAGE_DESIGN.md`: change only the lines
  about your own bundle, append rather than restructure, never reflow a
  paragraph you did not write. Three tracks touch these files; the merges
  must stay trivial.
- **Discard lockfile noise.** `npm install` in a fresh worktree tends to
  rewrite `WILSON/package-lock.json`; `git checkout -- WILSON/package-lock.json`
  before committing unless you deliberately changed `package.json`.
- 🚨 **A dev schema difference is probably another track's migration, not
  drift.** Before writing any "repair", read `supabase_migrations.schema_migrations`
  on that environment for the other tracks' reserved numbers (A 0067–0069,
  B 0070–0072, C 0073–0075). On 2026-09-06 Track A read Track C's 0073 on dev
  as corruption and wrote a re-narrow script that would have reverted it.
  Suites also diverge across branches until merges land: another track's
  probe going red on your branch is a transient, not a fault — say which
  branch's suite you ran.
- **CI runs on every push to a `track-*` branch** since `136030a` (root
  `rls.yml`, trigger block). Merge `feat/multi-user-v1` in to receive it, and
  state the run's URL and result in the hand-off instead of "unknown".
- **The permission classifier decides per command, not per project.** In one
  session `functions deploy --project-ref <staging>` was allowed while a DDL
  `db query` against dev and a read against prod were refused; in another the
  staging deploy was refused. Try the command, record exactly what was
  refused, hand that to Audrey, never work around it.
- **One `tap-all` run per project at a time.** Two on the same project race
  the CLI's temporary login role and the loser's suites report QUERY FAILED,
  which is not a red assertion and is not counted — read the per-suite lines.
- **`OUTSTANDING.md`'s session log takes new rows at the top**, so two tracks
  that both add a row conflict trivially on merge: keep both rows.

## 7. What the controller session does

The session that wrote this (or whichever session Audrey checks in with)
keeps `MEMORY.md`'s index current, watches the three track branches, and
answers cross-track questions. Track sessions do not edit each other's owned
files and do not touch the index.
