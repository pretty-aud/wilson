# SESSION 9 launch prompt — Admin Terminal + MFA + Auto-Update Infra

> Paste into a new Claude Code conversation from the WILSON repo to start Session 9.
> **Master plan: `docs/MASTER_PLAN.md` — read §2–§6 and §10 BEFORE any code.**
> Session 8 handoff detail: this file, below.
> **First tool call** per standing rule: `git status` on `feat/multi-user-v1`.

---

## Context recap — where Session 8 left the repo

- Branch **`feat/multi-user-v1`**. Sessions 1–8 committed, pushed, CI green
  (S8 feature: `1ef4d10` + docs follow-up). Migrations **0000–0019 deployed to
  dev + staging + prod. NO migration backlog.** pgTAP suites 01–23.
- **Session 8 delivered (see MASTER_PLAN §4 + db/README.md §16–§17):**
  - **Dashboard page** (Home, below the tools; page id `dashboard`):
    table/kanban/gallery over the user's cross-project tasks
    (`src/components/Dashboard/`), TaskDetailPopup reused via synthetic ctx
    (FileManager suppressed; asset field read-only there), project-role write
    gating via `projectRoleMatrix`, WILSON light tokens, no budget surfaces.
  - **Notes** (Dashboard tab): TipTap v3 + **Yjs** note bodies —
    snapshot-merge-write (`ydoc_state` base64 + `version` guard;
    `noteSync.saveWithMerge` bounded retry). Owner-only RLS **with NO admin
    bypass**; not history-captured; never broadcast; hard delete v1.
    Subject options table w/ rename cascade (`retagNoteSubject`).
  - **Workspace channel** `rabbit:workspace:{id}` (0018): broadcast triggers
    on projects / workspace_members / assigned-tasks / assets
    (transitive-hide path, churn-filtered) / project_members.
    `can_read_workspace_topic()` = workspace match + active membership
    (**deliberately stricter than table reads for deactivated members** —
    pinned by pgTAP 23; S9 aligns table reads). RabbitProvider owns the
    subscription: projectsIndex live-merges (stale-guarded on BOTH delivery
    paths), `subscribeWorkspaceEvents` fan-out feeds `useMyTasks` and the
    Dashboard presence strip's roster reload.
  - **Avatars**: reused the **existing `user-avatars` bucket** (0009) — the
    brief's "create an avatars bucket" was already satisfied; ProfileSection
    gained Remove/Discard; real avatars render in RABBIT + Dashboard
    presence chips (`isOwnAvatarUrl` guard everywhere).
  - **Task UI/DB parity (0019):** `tasks.notes` column + `'urgent'` priority
    label — two pre-existing cloud landmines TaskDetailPopup/kanban tripped.
  - Deps: `@tiptap/*@3.29.2` (lockstep pins), `@tiptap/y-tiptap@3.0.8`,
    `yjs@13.6.31`, `y-protocols@1.0.7`; `resolve.dedupe: ['yjs','y-protocols']`
    in vite.config.js (the duplicate-yjs hazard).
  - Adversarial review: 9/9 confirmed findings fixed + 8 minors
    (S6: 12/12 · S7: 11 · S8: 9+8 — keep the streak).
  - Vitest 209/209; Playwright/smoke unchanged.

## Session 9 goal — from MASTER_PLAN §5 (read it; scope confirmed there)

**Company Admin Terminal + MFA + auto-update + backups + BYO-storage UI +
multi-invite + roster polish.** Highlights (full detail in the plan):

- **Admin Terminal** (company-admin tier): create users (show-once
  credentials + copy popup), reset passwords, deactivate/reactivate **+ token
  revocation** (S4 deferral; also aligns the deactivated-member table-read gap
  with the workspace channel's stricter gate — pgTAP 20 probe 20 + 23 probe 12
  pin both sides), last-admin protection, teams/company details, **per-user
  rate-card view/edit toggles w/ admin confirm (REINSTATED — §10-A)**.
  **UX requirement (Audrey, 2026-07-28): invoke the `laws-of-ux` skill BEFORE
  designing the Admin Terminal UI, and apply MORE laws than the skill's
  baseline asks — at least FIVE, chosen deliberately and named in the
  close-out summary with where each one landed.** Strong candidates for an
  admin surface: Hick's Law (prune choices per screen — the terminal has many
  actions), Fitts's Law (big, close targets for frequent actions; destructive
  ones small/far), Jakob's Law (follow familiar admin-console conventions),
  Miller's Law (chunk the user list / settings into digestible groups),
  Doherty Threshold (<400ms feedback — optimistic UI + spinners on RPCs),
  Postel's Law (forgiving inputs for usernames/emails), and the Peak-End Rule
  (the show-once-credentials popup is the peak moment — make it excellent).
  All of it still inside the WILSON visual language (tokens, no new colors).
- **Slack-style multi-invite** (NewCompanyWizard + terminal — §10-D).
- **Roster polish (§10-B/E):** producer/CD row highlight; producer/creator
  auto-manager staffing; Team Members assigned-projects column
  (`project_members` data is live on the workspace channel already).
- **Logs & diagnostics** over edit-history/audit infra + error-code system.
- **Backend storage connection UI** (locked #14: local / Supabase / Drive).
- **MFA** for all admin tiers (Supabase Auth MFA).
- **Auto-update**: electron-updater + Backblaze B2 (locked #10/#15); version
  check at login; Settings version panel.
- **Backups**: nightly `pg_dump` → Backblaze B2 (locked #11).
- Deferred-in: storage blob GC (w/ S11), roster edit-history capture, legacy
  `useTeamMembers` sweep.

## Expected DB work (migration 0020+, pgTAP 24+)

- Admin RPCs (user create/reset/deactivate w/ token revocation), last-admin
  guard, per-user grant columns/toggles, MFA enforcement hooks, log/error
  tables as needed. Remember: **rls.yml lives at the GIT ROOT
  (`Dev_Work\wilson\`)** — RLS_TABLES + replay list for every new table.
- Consider closing §6 gap: `has_active_membership` on SELECT policies
  (deactivated members), matching the workspace-topic gate.

## Traps & discipline (inherited — full list in MASTER_PLAN §8)

- pgTAP: `throws_ok` message-form only; de-auth before every
  `tests.login_as`; edited-applied migration on dev =
  `supabase migration repair --status reverted NNNN` + `db push --include-all`
  (used again in S8 — works); `supabase db query --linked` runs SQL on the
  linked env; CI stack has NO realtime schema (guard every realtime.* touch)
  but HAS the storage schema.
- Fresh-env realtime partition trap (README §14) still applies.
- StrictMode-safe `mountedRef` (body resets true); seq-guards on async
  effects; never depend on a hook's whole return object in an effect
  (S8 review finding C6 — depend on the stable callback or use a ref).
- `window.prompt` does NOT exist in Electron renderers (S8 finding C8) —
  in-app inputs or IPC dialogs only.
- All-pages-rendered pattern in App.jsx; adapter seams (local/drive return
  sensible empties); notes tables stay owner-only + off every channel.
- Token discipline: hard cap 15 agents; finders paste excerpts; never resume
  nondeterministic fan-out pipelines; adversarial review before the feature
  commit.
- The agent NEVER enters credentials — browser eyeballs owed by Audrey (see
  the list at the end of MASTER_PLAN §8 / Session 8 close-out).

## Non-goals (S9)

- O.T.T.E.R. cloud content model (**S10**); operator console, web build (all
  3 tools), final TPN hardening (**S11**).
- Field-level cell presence (S8 stretch, not started — earliest S10).
- No cloud tables for milestones/scenes/levels/experiences (unchanged).

## Close-out ritual (MASTER_PLAN §8 — do ALL of it)

Feature commit → CI green → deploy 0020+ to staging + prod (dry-run each) →
re-link CLI to `wilson-dev` → write `docs/sessions/SESSION_10_prompt.md` →
update `docs/MASTER_PLAN.md` (§4 ledger, §5 scope, §6 gaps, §7 statuses,
§10) → update the Claude auto-memory → docs commit + push → list Audrey's
owed browser checks.

## Reminder

**No code before the branch is confirmed.** First tool call: `git status` on
`feat/multi-user-v1`, verify clean, read the Session 8 commits (`1ef4d10` +
docs), then `docs/MASTER_PLAN.md`, then start.
