# SESSION 13 launch prompt — change-request approval that actually applies

> Paste into a new Claude Code conversation from the WILSON repo.
> **Master plan: `docs/MASTER_PLAN.md` — read §2–§6 and §10 BEFORE any code.**
> **First tool call** per standing rule: `git status` on `feat/multi-user-v1`.

> Two sessions remain after this one: **S14 file lifecycle & data stewardship ·
> S15 operator console + TPN + v1.0.0.**

> **Why this session exists.** It was briefly specced as an S12 "Block C".
> Audrey pulled it into its own session (2026-07-29) rather than have S12 carry
> the web build, a new Edge Function *and* a new migration — the same
> double-booking that cost S10 and S11 half their scope. It is one coherent
> feature: **one migration, one RPC, two dialogs.** Resist growing it.

---

## Context recap

- Branch **`feat/multi-user-v1`**. S11 (the O.T.T.E.R. UI) landed as `5707895`.
  See `docs/MASTER_PLAN.md` §4 for the S12 SHAs and deploy state — **check them
  rather than assuming, and confirm there is no migration backlog before adding
  0025.**
- **CI is readable without `gh`.** `pretty-aud/wilson` is public:
  `curl https://api.github.com/repos/pretty-aud/wilson/actions/runs?head_sha=<sha>`
  gives the conclusion; `.../runs/<id>/jobs` gives per-step results.
- The feature already half-exists from S11: the `otter_change_requests` table
  (migration 0022), the **submit** dialog
  (`src/tools/otter_v0.3.1/components/ChangeRequestDialog.jsx`), and the
  **review queue** (`src/components/AdminTerminal/ChangeRequestsSection.jsx`).
  Today, approving is a decision record that moves no content. This session makes
  it real.
- Read **db/README §19** (the O.T.T.E.R. model, the editor-grant trap) and **§20**
  (the trash index) first. Then read 0022's `fn_otter_cr_review` and
  `otter_fork_course` in full — you will rewrite one and reuse the other.

---

## The feature (locked #22)

**Audrey, 2026-07-29, verbatim:** *"yes we need to make sure the approval
automatically updates the course. the admin should be able to review. and approve
or they should be able to decline for the end user be able to review the decision
and either accept or do changes the admin is asking for. that said the admin
should be able to add a note/explanation for the decline that can be shared with
the user"* and *"we need to allow the admin to review the update. and decide to
accept it or not. when the user submits the change that should allow the admin to
see the course now"*.

Two follow-up decisions she made when asked:

- **Additive only.** Approval adds new subjects and updates changed ones, and
  **never deletes**. One approval must not silently strip lessons from
  everyone's official course. Consequence to state in the UI: a proposer cannot
  propose a removal — they say so in the summary and the admin deletes by hand.
- **Auto-archive before every apply.** O.T.T.E.R. is deliberately not
  edit-history captured (db/README §19), so overwriting lesson text is otherwise
  unrecoverable. Each approval first snapshots the target to a private copy
  owned by the approving admin.

### The status flow

```
open ──approve──►  approved   (terminal, and APPLIES)
  │
  └──decline───►  changes_requested   (note REQUIRED)
                        │
                        ├── proposer: "Accept the decision" ──► rejected + acknowledged_at
                        └── proposer: revise + resubmit ──────► open  (revision + 1)

open ──proposer withdraws──► withdrawn   (terminal)
```

`rejected` stays reachable directly for a flat no. `approved` and `rejected` are
terminal; nothing else may transition out of them.

### Migration 0025 — what to write

**The part that needs care: 0022 actively forbids this flow today.**
`fn_otter_cr_review` raises `'change request already % — reopen is not
permitted'` on ANY status change out of a non-`open` state, so
revise-and-resubmit is impossible until it is rewritten. 0025 is not optional.

1. **Status CHECK** += `'changes_requested'`.
2. **New columns:** `applied_at TIMESTAMPTZ`, `applied_by UUID`,
   `archive_course_id UUID`, `revision INTEGER NOT NULL DEFAULT 1`,
   `acknowledged_at TIMESTAMPTZ`. Keep `review_note` (already there — and 0022's
   trigger already stops a proposer forging it; **preserve that**).
3. **Rewrite `fn_otter_cr_review`** for the flow above. Preserve everything it
   already gets right: reviewer stamped server-side from `auth.uid()`, immutable
   `proposed_by`/`target_course_id`/`workspace_id`, and a proposer never writing
   review fields. Add: a decline **requires** a non-empty `review_note`;
   `changes_requested → open` bumps `revision` and clears
   `reviewed_by`/`reviewed_at`; only the proposer may set `acknowledged_at`.
4. **Review-window read access — must go through a DEFINER helper.**
   `otter_has_open_review_access(p_course_id UUID)` SECURITY DEFINER: true when
   the caller is a workspace admin or the target course's owner, AND a change
   request exists with `source_course_id = p_course_id` and
   `status IN ('open','changes_requested')`. Then add
   `OR public.otter_has_open_review_access(id)` to `otter_courses_select`.
   > **Do NOT inline `current_app_role()` into that policy.** 0022 ships a
   > post-condition that RAISES if any SELECT policy on `otter_courses` or
   > `otter_progress` mentions `current_app_role`, and 0022 is documented safe to
   > re-run. Wrapping the role check inside the helper keeps that true and puts
   > the consented exception in one auditable place.
   Subjects come along for free — `otter_subjects_select`'s live-parent `EXISTS`
   runs under the caller's own RLS. Read only: add no write arm, so a reviewer
   can read a fork but never edit it.
5. **`otter_cr_apply(p_cr_id UUID) RETURNS UUID`** SECURITY DEFINER, returning
   the archive course id. One transaction, and the only path in:
   - re-check the caller is an admin or the target's owner; the request is
     `open`; the target is still `company_standard`; the source still exists;
   - **archive** the target (reuse `otter_fork_course`'s copy logic) into a
     `personal` course owned by the caller, named
     `<name> (before change #<revision>)`, and record `archive_course_id`;
   - **apply additively**: for each live subject in the source, match the target
     by `slug` — INSERT when absent, UPDATE content columns when present.
     **Never delete.** Do not touch the target's `owner_id`, `workspace_id`,
     `slug` or `visibility`;
   - stamp `status='approved'`, reviewer, `applied_at`, `applied_by`.
   - **Subjects only:** the five reference documents have merge semantics living
     in client JS (`otterRoutes.js`'s `mergeHotkeys`/`mergeFunctions`/
     `mergeNodes`); reimplementing them in plpgsql would duplicate load-bearing
     logic, and overwriting them would break additive-only. Say so in the
     approve dialog.
6. **pgTAP `32_otter_cr_apply.sql`.** Pin at minimum: every legal transition and
   every illegal one; a decline without a note is refused; the review window
   opens on submit and **closes on settle**; an admin still cannot read an
   unrelated personal course; apply is additive (a subject deleted in the source
   survives in the target); the archive exists and is owned by the approver;
   apply is refused on a non-`open` request and on a non-standard target.

### UI

- **Admin Terminal → Requests**: an "Open their course" affordance (it is
  readable now), Approve (state plainly that it adds and updates but does not
  delete, that reference documents are untouched, and that an archive is kept),
  and Decline with a **required** note.
- **O.T.T.E.R.'s `ChangeRequestDialog`**: show the decision state — the admin's
  note, plus "Accept the decision" and "Make the changes and resubmit".
- **Remove the "also share my copy with the company" checkbox.** Submitting now
  grants review access automatically, so the checkbox is obsolete and its
  presence would imply sharing is still required.

---

## HOW to build it

### Change as little of the existing UI as possible

The S11 constraint still holds for O.T.T.E.R.: its layout is settled. This
session adds **states to two dialogs that already exist** — it should not add a
`currentView`, a page, or a nav item. The Admin Terminal's Requests section is
also already there; it gains buttons, not a redesign.

Invoke the **`laws-of-ux` skill** before designing the decision surfaces and name
≥5 laws applied, in each file header and again at close-out. The ones with real
purchase here:

- **Cognitive Bias** — approving writes to the company's canonical course. It
  confirms, and the confirm says exactly what will change (added/updated counts,
  that nothing is deleted, that reference documents are untouched, and that an
  archive is kept).
- **Postel's Law** — a decline is a conversation, not an error. The proposer sees
  the note in context and has two clear ways forward.
- **Zeigarnik Effect** — a `changes_requested` request is unfinished work for the
  *proposer*, so it must be visible to them in O.T.T.E.R., not only in the admin
  queue.
- **Peak-End Rule** — the end of an approval is the moment to say what happened:
  "3 subjects updated, 1 added, archive kept as …".
- **Mental Model** — this is the review model people already know from pull
  requests: approve / request changes / resubmit. Do not invent new vocabulary.

### Sequence that de-risks it

1. Write 0025 and pgTAP 32 **first**, and verify against real Postgres with the
   `BEGIN; … ROLLBACK;` harness before touching any JSX. The apply RPC is the
   only part of this session that can corrupt data.
2. Prove additive-apply and the review-window open/close **by probe, not by eye**.
3. Only then wire the two dialogs.

---

## Traps & discipline (inherited — full list in MASTER_PLAN §8)

- **No Docker on this machine.** pgTAP cannot run locally. The working method:
  `supabase db query --linked --file X.sql` accepts a multi-statement
  `BEGIN; … ROLLBACK;`, and `pgtap` can be `CREATE EXTENSION`-ed *inside* it.
  Rewrite each assertion as `INSERT INTO tap_out SELECT is(...)` and select the
  failures at the end.
  **Two corrections learned in S11 — the harness lies without them:**
  1. Keep `SELECT plan(N);` in the script. Removing it makes pgTAP raise
     *"You tried to run a test without a plan"* on the first assertion.
  2. The rewrite must cover **every** pgTAP function the suite uses, including
     `has_table`. A missed one still RUNS and still counts toward pgTAP's
     internal numbering, but never lands in `tap_out` — so it silently vanishes
     from the pass count and a failure in it would be invisible. Always compare
     the collected row count against `max(test number)` and treat a mismatch as
     a broken harness, not as a clean run.
  Also: `GRANT ALL ON tap_out TO PUBLIC` — suites switch into the `authenticated`
  role partway through and cannot otherwise insert. Run the CLI from `WILSON/`,
  which is where `supabase/config.toml` and the link live; the git root has no
  Supabase project and must not gain one.
- **`NOT (… OR current_app_role() = 'admin' OR …)` is a trap.**
  `current_app_role()` is NULL for plain members, so the predicate is NULL and
  plpgsql treats `IF NULL` as false. RLS survives it (NULL = deny); anything that
  INVERTS it must `COALESCE(…, false)`.
- **`.upsert()` cannot infer a PARTIAL unique index** — 42P10. All O.T.T.E.R.
  subject uniqueness is partial (`WHERE deleted_at IS NULL`), which matters
  directly for the apply RPC's insert-or-update loop.
- **A refused UPDATE returns 204 with no error.** Always
  `.select(...).maybeSingle()` on writes and throw on 0 rows.
- **`otter_course_editors.workspace_id` has NO DEFAULT** — the one O.T.T.E.R.
  table like that, and its trigger validates rather than defaults. Every fixture
  supplies it by hand, which is why 94 probes missed a dead client path in S11.
  If 0025 touches grants, send the column explicitly.
- **BEFORE triggers still fire under SECURITY DEFINER.** DEFINER bypasses RLS,
  not triggers — so `fn_otter_pin_subject_identity` runs during the apply RPC's
  inserts. Check it does not block a legitimate copy.
- pgTAP: `throws_ok` message-form only; de-auth before every `tests.login_as`;
  role-gated probes build claims by hand (`login_as` sets NO app_role);
  edited-applied migration on dev = `supabase migration repair --status reverted
  NNNN` + `db push --include-all`.
- CI stack: NO realtime schema, NO pg_cron, and NO storage-api container.
- Token discipline: hard cap 15 agents; finders paste excerpts; **adversarial
  review before the feature commit** — it has caught a real defect in every
  session it has run, including two in S11.
- The agent NEVER enters credentials — browser eyeballs owed by Audrey.

## Non-goals (S13)

- **A subject-level diff view** (§6 #28). Reviewers compare by eye in v1. Worth
  proposing to Audrey as the natural follow-on; not worth building here.
- **Merging the five per-course reference documents** on approval (§6 #29) —
  subjects only.
- **Proposing a deletion.** Additive-only is locked (#22).
- CSV export, file audit, storage relink, blob GC (**S14**).
- Operator console, final TPN hardening, v1.0.0 (**S15**).

## Close-out ritual (MASTER_PLAN §8 — do ALL of it)

Feature commit → CI green (read it from the public REST API) → deploy 0025 to
staging + prod (dry-run each) → deploy any new/edited Edge Functions → re-link
CLI to `wilson-dev` → write `docs/sessions/SESSION_14_prompt.md` (**file
lifecycle & data stewardship**, scope in MASTER_PLAN §5) → update
`docs/MASTER_PLAN.md` (§4 ledger, §5 scope, §6 gaps, §7 statuses, §10) → update
the Claude auto-memory → docs commit + push → list Audrey's owed browser checks.

**Browser checks this session will owe Audrey** — she has two accounts, one admin
and one plain member, and the whole flow needs both:

1. Submit a change request, then confirm the admin can open the proposer's course
   *before* deciding — and can **no longer** open it after approving or rejecting.
2. Approve, and check the standard course actually gained/updated the content,
   that the archive copy exists and is named clearly, and that a subject the
   proposer deleted is **still present** in the standard.
3. Decline with a note; as the proposer, confirm the note is visible and that both
   "accept the decision" and "revise and resubmit" work. Resubmit, and confirm the
   admin sees it as open again.
