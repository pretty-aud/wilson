# SESSION 43b — THE OPERATOR EMAILS A SETUP LINK

> **Audrey, 2026-08-10, verbatim:**
> *"lets remove the new company button. right now, any one can login and create
> their own company. it needs to be invite only for now."*
>
> ...and, refining it:
>
> *"lets make it that the operator and wilson overall admin can send this as a
> link for when they establish a new company in the operator console for the new
> company to set up their workspace."*
>
> **S43 shipped the first sentence. This session is the second.**
>
> Size: 1 session. Blocked by: nothing. Needs a migration (see §4).

---

## 1. What is already done — do not redo it

S43 closed the security half, and it closed it *properly*. Verified against the
live projects on 2026-08-14, not inferred from the repo:

- **`NewCompanyWizard.jsx` is deleted.** `authMode` has three values now
  (`'login' | 'forgot-password' | 'recovery'`); `'new-company'` is gone.
- **The `provision-workspace` Edge Function is deleted from the repo AND
  undeployed from all three environments.** `supabase functions list` returns
  the same 16 functions on dev, staging and prod, and `provision-workspace` is
  on none of them. The three listings were proven to be three distinct projects
  by their differing `ai-proxy` function ids (`43e8dccc…`, `9951c54b…`,
  `3a3f4476…`), because identical output from three commands is also the
  signature of querying one project three times.

🚨 **SEVERAL DOCS STILL DESCRIBE THAT ENDPOINT AS LIVE AND PUBLIC** —
`docs/MASTER_PLAN.md:113`, `:543`, `:823` and `CHANGELOG.md:182`, `:185` all
speak of it in the present tense, and `CHANGELOG.md:182` is a *Known
limitations* entry asserting that an unauthenticated path can still mint an
admin. **That is no longer true.** A reviewer reading those docs will conclude
there is an open hole and go hunting for it. Fixing that prose is §7 work.

**So there is no security work in this session.** This is a feature: the
operator can create a company but cannot yet *hand it over* without reading a
password down the phone.

---

## 2. 🚨 THE FINDING THAT CHANGES THE SHAPE

**The master plan's sequence row guesses this is "mint an invite like
`invite-member` does". It is not, and building it that way fails immediately.**

`operator-workspaces` action `create` **already creates the admin account and
the workspace**, before any link could be sent:

```ts
const password = generatePassword(20)
await ctx.admin.auth.admin.createUser({
  email: finalEmail, password, email_confirm: true, app_metadata: {},
})
await ctx.admin.rpc('provision_workspace_and_admin', { … })   // workspace + membership, atomic
await ctx.admin.auth.admin.updateUserById(id, { app_metadata: { workspace_id } })
await logPlatformEvent(ctx, { action: 'workspace.created', code: 'WIL-7001', … })
return reply({ …, password /* show-once */ }, 201)
```

`invite-member` mints its user with `admin.inviteUserByEmail`, which **creates**
the auth row. Pointed at a user that already exists it returns
*"already been registered"* — the function's own `email_taken` / 409 branch.
**The two flows collide.** Whatever gets built must reckon with the account
already existing at link time.

### The two honest shapes

**A. A second action, `send_setup_link`** *(recommended)*
Leave `create` alone. Add an action that mints a **recovery** link for the
already-created admin and lets GoTrue mail it. Smallest diff, no change to a
path that already works, and it is re-sendable — which matters, because the
first email will sometimes go to a typo'd address.

**B. Fold it into `create`**
When a real `admin_email` is supplied, skip `createUser`+password and use
`inviteUserByEmail`, then provision against the returned user id. Cleaner
end-state, but it rewrites a working, audited, rollback-handling path, and it
leaves no way to re-send.

⚠️ **The session must pick one and say which in the close-out.** A recommends
itself, but B is defensible if Audrey would rather the password never exist for
a company that has a real mailbox. **Ask her if it is close.**

---

## 3. 🚨 The `.invalid` mailbox — why the password path must survive

`admin_email` is **optional** today:

```ts
const emailSynthesized = !email
const finalEmail = email || `${username}.${slug}@wilson.invalid`
```

The comment above it is explicit that this is a deliberate convention — *"an
admin-created account may have no real mailbox … a synthesized address means
resets are admin-only by design"*.

**So this feature is additive, never a replacement.** A company created without
an email has nowhere to send a link, and the show-once password stays the only
hand-over for it. The new action must refuse politely on a synthesized address
(a real error code, not a silent no-op) rather than mailing `@wilson.invalid`.

---

## 4. The migration, and why it is one

The only reason this needs schema work: **auditing the send**. Reusing
`workspace.created` would make the operator console unable to distinguish
"company created" from "setup link emailed", which is precisely the thing an
operator will want to check when a new company says they never got it.

So: **a new `platform_audit.action` value** — suggest `workspace.invite_sent`.

### 🚨 ADDING AN ACTION IS A FOUR-PLACE EDIT

| # | Place | File |
|---|---|---|
| 1 | the SQL `CHECK` | the newest migration that widens it — **`0066`** |
| 2 | the TypeScript union | `supabase/functions/_shared/operatorGuard.ts` → `PlatformAuditFields` |
| 3 | the console filter list | `src/admin/AuditSection.jsx` → `const ACTIONS = [` |
| 4 | the call site | `operator-workspaces/index.ts` |

**Places 1–3 are guarded** by `src/admin/platformAuditActions.test.js`, which
parses all three and fails on drift in either direction — its own test names
state the asymmetry: a union *narrower* than the CHECK makes a legal action
unloggable; a union *wider* makes the INSERT fail **on the error channel,
silently**. Place 4 is not guarded by anything. Add all four.

### 🚨 THE CHECK IS A FULL RESTATEMENT — DROP AND ADD, LISTING EVERY VALUE

`0055` widened it and left the reason in the file:

> `-- 🚨 EXPLICIT DROP + ADD. See the header: a wrapped ADD is a silent no-op
> against every already-migrated environment, and all three carry this
> constraint already.`

`0066` must `DROP CONSTRAINT IF EXISTS platform_audit_action_check` and re-add
it with **all 19 current values plus the new one**. Dropping a value here is the
exact shape of the `0059` incident, where a `CREATE OR REPLACE` silently deleted
`0020`'s grant-flag guards and became a live privilege escalation that CI went
red on for two days before anyone read it as real.

**Current 19, verbatim from `0055`:** `workspace.created`, `workspace.renamed`,
`workspace.suspended`, `workspace.restored`, `workspace.teardown`,
`blob.purged`, `ai_key.set`, `ai_key.cleared`, `operator.granted`,
`operator.revoked`, `model.approved`, `model.retired`, `model.restored`,
`model.default_set`, `model.default_cleared`, `storage_plan.set`,
`storage_plan.cleared`, `storage_plan.suspended`, `storage_plan.restored`.

⚠️ `operator.granted` and `operator.revoked` are in the CHECK and **written by
nothing**. That is pre-existing drift, recorded in `operatorGuard.ts`'s own
comment. Do not "tidy" them out — removing a CHECK value is the dangerous
direction, and inert is not broken.

⚠️ **`0055:188` claims an "IDENTICAL 15-value CHECK".** It is 19. The comment
was true when written and nobody updated it. Do not trust it; count the list.

### Numbering

- **Migration `0066`.** `0065_otter_subject_shares.sql` is the highest on disk.
- **No new pgTAP suite.** `platform_audit` already has
  `supabase/tests/rls/35_platform_audit.sql`, and `platform_audit` is already in
  `rls.yml`'s `RLS_TABLES`. **Extend suite 35**; do not mint 71.

> 🚨 **`0065` IS AN UNEXPLODED TRAP DIRECTLY UNDER THIS WORK.**
> `0065_otter_subject_shares.sql` is committed and pushed, applied to **no**
> environment (`migration list --linked` shows local `0065` with an empty remote
> column), has **no pgTAP suite**, and `otter_subject_shares` is **not** in
> `rls.yml`'s `RLS_TABLES`. The coverage guard iterates that hand-maintained
> allowlist, so **CI will stay green over it forever**. Whoever next runs
> `db push` lands an untested RLS table with no warning. This session does not
> have to fix it, but **must not `db push` without noticing it**, and should say
> so in the close-out.

---

## 5. What to build

1. **`send_setup_link` action** on `operator-workspaces` (shape A).
   - Add the string to the module-level `ACTIONS` Set — it is a closed enum,
     validated before any work, and an unlisted action is rejected.
   - Place the block **after** the shared `workspace_id` resolution: it targets
     an existing workspace, unlike `list` and `create`.
   - Rate limit as `'operator-write'` (`OPERATOR_WRITE_RPM`, default 20), the
     same bucket every other mutating action uses. ⚠️ **`invite-member` has no
     rate limiting at all** — do not copy that.
   - Refuse when the workspace's admin email is synthesized (`@wilson.invalid`).
   - Log `workspace.invite_sent` with a fresh `WIL-70xx` code.
2. **The console affordance** in `src/admin/CompaniesSection.jsx`.
   - Reuse the module-level `cardStyle` / `darkBtnClass` tokens; do not invent.
   - ⚠️ `CreateCompanyDialog` is **not a `<form>`** — no `onSubmit`, no
     Enter-to-submit. The create call is an inline async `onClick`. Match it.
   - 🚨 **Add an entry to the `FRIENDLY` map for every new error code.** Its own
     comment: *"Every server error code needs an entry here or `callOperatorFn`
     falls back to `Request failed (<status>)` and the operator sees a bare
     number."* S41 is on record for shipping that mistake.
3. **The four-place audit vocabulary edit** (§4), plus extending suite 35.

---

## 6. Non-negotiables and traps

- 🚨 **`redirectTo` IS DECORATIVE ON THIS PATH.** `invite-member` passes
  `redirectTo: ${SITE_URL}/#/recovery`, but `supabase/templates/invite.html`
  builds its link from `{{ .SiteURL }}/#/recovery?token_hash={{ .TokenHash }}&type=invite`
  **on purpose** — the template says so, because the desktop app runs on
  `http://127.0.0.1:<dynamic port>`. Changing `redirectTo` changes nothing the
  invitee sees. The **project's Site URL** is what decides where the link lands.
- ⚠️ **This will only work on staging/beta at first.** The redirect allow-list
  was configured for staging on 2026-07-29; `OWED_AUDREY` §B records dev and
  prod as *"for whenever those envs need a web surface"* — i.e. not done.
  **State this in the close-out rather than discovering it in testing.**
  ⚠️ Auto-memory says *"auth email templates: staging only"*; that traces to a
  single uncited sentence in `SESSION_33_prompt.md` and a later doc appears to
  contradict it. **Verify the hosted template state per env before relying on
  either claim** — nothing in this repo can read hosted template state.
- **The invitee lands on `ResetPasswordWizard`** ("NEW PASSWORD"), and on
  success it calls `updateUser({password})` then an **unscoped
  `signOut()`** — deliberately. They set a password, then sign in fresh. Do not
  "fix" that into an auto-login without asking; it is the existing contract for
  every invited member.
- **`parseRecoveryLink` already accepts `type=invite`** via
  `ACCEPTED_TYPES = new Set(['recovery','invite'])`. Two S18 fixes live there.
  Do not touch it.
- 🚨 **Check every status.** The house failure is a UI that reports success over
  a write that never happened. If the mail send fails, the operator must see it.
- ❌ **Do not gate or re-add self-serve company creation.** It is deleted and
  undeployed; keep it that way.
- ❌ **Do not edit `docs/OWED_AUDREY.md` entries as if done** without measuring.

### 🚨 A SECOND COPY OF THE TREE IS SITTING IN THE REPO

`WILSON/.claude/worktrees/sleepy-meninsky-0b4ae6/WILSON/` is a full duplicate
including `src/cloud/auth/*.jsx` and `supabase/templates/invite.html`. It is
git-ignored, so it cannot be committed — but **every repo-wide grep double-hits,
and an edit made against a path copied out of a grep result lands in the
worktree instead of the live tree.** Anchor every path at `WILSON/src/...`.
After any edit: `git status` for stray paths, and grep one distinctive string
per edit to confirm it landed where you meant.

---

## 7. Housekeeping found while auditing (not the main work, but cheap)

- `docs/MASTER_PLAN.md:113`, `:543`, `:823` and `CHANGELOG.md:182`, `:185`
  describe `provision-workspace` as a live public endpoint. It is deployed
  nowhere. `CHANGELOG.md:182` is a *Known limitations* entry that is now false.
- **`MASTER_PLAN_S19_ONWARD.md`'s prose contradicts its own S43b row** in three
  places: the `S38 ⏸️ **NEXT AND LAST**` marker, *"→ S43, then S38"*, and
  *"S43 is now the only thing before S38"*. The row was inserted; the prose
  around it was not updated.
- `0055:188`'s "15-value CHECK" is 19.

---

## 8. Definition of done

- [ ] The operator can create a company **with a real email** and send a setup
      link from the console, without ever seeing a password
- [ ] A company created **without** an email still yields the show-once
      password, unchanged
- [ ] Sending to a synthesized `@wilson.invalid` address is refused with a
      readable message, not silently "sent"
- [ ] The link lands the new admin on NEW PASSWORD, they set one, and can then
      sign in to their own workspace as `admin`
- [ ] The send is auditable — `workspace.invite_sent` appears in the operator
      console's audit filter and in `platform_audit`
- [ ] All four vocabulary places updated; `platformAuditActions.test.js` green
- [ ] `0066` restates **all 19** existing CHECK values plus the new one, via
      explicit DROP + ADD
- [ ] Suite `35_platform_audit.sql` extended; no new suite minted
- [ ] A failed send surfaces an error; no green tick over a mail that never went
- [ ] Which shape (A or B) was chosen is stated, with why
- [ ] Whether dev/prod can deliver these emails at all is stated, measured
- [ ] `0065`'s untested state is restated in the close-out, not quietly stepped over

---

## 9. Test plan (Audrey)

1. **Create a company with your real email** in the operator console at
   `/wilsonadmin`, and send the setup link. You should get an email.
2. **Follow the link.** It should take you to NEW PASSWORD, let you set one,
   and then ask you to sign in. Signing in should land you in the new company
   as its admin.
3. **Create a company with no email.** You should still get the show-once
   password, exactly as today — this is the path that must not regress.
4. **Try to send a link to that company.** It should refuse, and tell you why.
5. **Check the audit tab.** You should be able to filter for the send and see
   it separately from the company creation.
6. **Send the link twice** to the same company. Decide whether that should work
   — it is the realistic recovery when the first email bounces or is typo'd —
   and say which behaviour you want.

⚠️ **Point 6 is the one I most want your judgement on.** Re-sending is either
the feature's most useful property or an invitation to spray links at an
address; it depends on how you expect to use it.
