# WILSON — Systems Design Pack

**v1.0.0 · 2026-07-30 · diagrams only.**

Source pack for the visual design session. Every diagram is engineering-honest
(real route, table and function names). **All explanation lives in
`SYSTEMS_HANDBOOK.md`** — the section link under each diagram is where to go.

---

## Inventory

| ID | Shows | Handbook |
|---|---|---|
| **D1** | Every system and every connection between them | §2, §14 |
| **D2** | The three Supabase environments and which client hits which | §4.1 |
| **D3** | Trust boundaries — where authorization actually happens | §4.4 |
| **W1** | Desktop app screen layout | §13.4 |
| **W2** | Web + operator console screen layouts | §3.2, §5.1 |
| **W3** | D.O.G. screen | §13.1 |
| **W4** | O.T.T.E.R. screen | §13.2 |
| **W5** | R.A.B.B.I.T. screen | §13.3 |
| **W6** | Admin Terminal screen | §13.4 |
| **W7** | Operator console screen | §5.6 |
| **T1** | D.O.G. brief → outline → exports | §13.1 |
| **T2** | O.T.T.E.R. generate → study → quiz → validate | §13.2 |
| **T3** | R.A.B.B.I.T. intake → breakdown → views | §13.3 |
| **F1** | Login: resolve → password → MFA → workspace → session | §4.2 |
| **F2** | Invite → onboarding | §4.6, §9 |
| **F3** | Realtime broadcast + merge | §4.5 |
| **F4** | Soft delete → trash → restore → purge → GC certificate | §12.3, §12.4 |
| **F5** | Storage relink: scan → match → preview → apply | §12.2 |
| **F6** | ai-proxy call path | §6 |
| **F7** | Change request: submit → review → apply | §13.2 |
| **F8** | CSV exports + workspace takeout | §12.5 |
| **F9** | Workspace provision + teardown | §5.4 |
| **F10** | Auto-update + nightly backups | §7.2, §11 |
| **S1** | Change-request state machine | §13.2 |
| **S2** | Pet life cycle | §13.5 |

---

## D1 — System map

Every external system as a node; every arrow labelled with protocol and payload.

```mermaid
graph TB
  subgraph Clients
    EL["Electron desktop<br/>renderer + main"]
    WEB["Web app<br/>beta.petalstudios.co/wilson"]
    OPS["Operator console<br/>/wilsonadmin"]
  end

  EXP["Local Express<br/>127.0.0.1:ephemeral"]
  DISK[("otter-data/<br/>rabbit-data/")]

  subgraph Supabase
    AUTH["Auth / GoTrue<br/>ES256"]
    PG[("Postgres 17<br/>+ RLS")]
    RT["Realtime<br/>broadcast"]
    ST["Storage<br/>user-avatars · rabbit-files"]
    EF["Edge Functions ×12"]
    CRON["pg_cron ×5"]
  end

  ANTH["Anthropic API"]
  GH["GitHub Actions"]
  B2["Backblaze B2"]
  RES["Resend SMTP"]
  SEN["Sentry"]
  GD["Google Drive"]
  VER["Vercel"]

  EL -->|HTTP same-origin| EXP
  EL -->|IPC| DISK
  EXP --> DISK
  EL -->|read-only OAuth| GD

  EL & WEB -->|"signIn / MFA / refresh"| AUTH
  EL & WEB -->|"PostgREST + RPC"| PG
  EL & WEB -->|"websocket"| RT
  EL & WEB -->|"upload / download"| ST
  EL & WEB -->|"bearer token"| EF
  OPS -->|"bearer token"| EF
  OPS -->|"platform_audit read"| PG

  EF -->|service_role| PG
  EF -->|admin API| AUTH
  EF -->|"stream:true"| ANTH
  EF -->|teardown sweep| ST
  AUTH -->|SMTP| RES
  PG --> RT
  CRON --> PG

  GH -->|"pgTAP · smoke · e2e"| PG
  GH -->|"nightly pg_dump"| B2
  VER -->|"build on push"| WEB
  VER --> OPS
  B2 -->|"NSIS update feed"| EL
  EL & WEB --> SEN

  classDef no fill:#fff,stroke:#c00,stroke-dasharray:4
  NEVER["✗ No client ever reaches Anthropic<br/>✗ No customer content on B2<br/>✗ Desktop cannot reach /wilsonadmin"]:::no
```

- Arrows into Postgres from clients are **direct** — RLS is the boundary, not a middle tier.
- Edge Functions run as `service_role` (RLS bypassed), so each re-checks a live row itself.

→ Handbook §2, §14

---

## D2 — Environments

Which client talks to which Supabase project.

```mermaid
graph LR
  DEV["wilson-dev"]
  STG["wilson-staging"]
  PRD["wilson-prod"]

  LOCAL["Local dev"] --> DEV
  CI["GitHub Actions<br/>smoke + Playwright"] --> DEV
  BETA["Vercel beta<br/>/wilson + /wilsonadmin"] --> STG
  SHIP["Shipped desktop app"] --> PRD

  BK["B2 nightly dumps"]
  STG --> BK
  PRD --> BK
```

- Migrations 0000–0029 and all 12 Edge Functions are deployed to all three.
- CI's pgTAP job uses a **throwaway local stack**, not any of these.

→ Handbook §4.1

---

## D3 — Trust boundaries

Where authorization actually happens.

```mermaid
graph TB
  C["Client<br/>UNTRUSTED"]
  RM["roleMatrix.js<br/>presentation only"]
  RLS["Postgres RLS<br/>THE BOUNDARY"]
  G["Edge guards<br/>adminGuard · memberGuard · operatorGuard"]
  SR["service_role<br/>RLS BYPASSED"]

  C --> RM
  RM -.->|"hides UI, enforces nothing"| C
  C -->|"token"| RLS
  C -->|"bearer"| G
  G -->|"live-row re-check"| SR
  SR --> RLS

  N1["JWT claims may be stale up to 1h<br/>→ reads may use them<br/>→ anything that ACTS re-checks a live row"]
  RLS --- N1
```

- `roleMatrix.js` mirrors SQL helpers for UI only; **lockstep is a hard invariant**.
- `operatorGuard` fails **closed**; the rate limiter fails **open**. Both deliberate.

→ Handbook §4.4, §4.6

---

## W1 — Desktop shell

Every page mounted at once; `display` toggles one visible.

```mermaid
graph TB
  subgraph Window
    TB["TitleBar — Electron only, frameless"]
    BAR["Orange page bar + back"]
    BODY["Active page<br/>(all 11 rendered, one shown)"]
    PET["Pet companion — floating, always mounted"]
    TOAST["Undo toast — bottom centre, 8s"]
  end
  TB --> BAR --> BODY
```

- Pages: `home · dog · otter · rabbit · dashboard · project-manager · rate-card · team-members · admin-terminal · settings · help`.
- Consequence: every page's effects and hooks run everywhere — gate on `currentPage`.

→ Handbook §13.4

---

## W2 — Web and operator surfaces

Two separate build targets on one origin.

```mermaid
graph LR
  subgraph "beta.petalstudios.co"
    A["/wilson<br/>index.html → src/App.jsx<br/>key: wilson.dev.session"]
    B["/wilsonadmin<br/>admin.html → src/admin/<br/>key: wilson.operator.session"]
  end
  V["vercel.json<br/>2 builds, path rewrites"] --> A & B
  E["Electron installer<br/>packages dist/ only"] -.->|"cannot reach"| B
```

- `vite --mode admin` gates `rollupOptions.input` — that gate is what keeps the console out of the installer.
- localStorage is per-**origin**: the differing key string is the *entire* isolation mechanism.

→ Handbook §3.2, §5.1, §5.2

---

## W3 — D.O.G. screen

```mermaid
graph TB
  subgraph "D.O.G."
    L["Left: project picker<br/>source files<br/>theme + settings"]
    C["Centre: slide tabs<br/>outline text editor"]
    R["Right: LayoutVisualizer<br/>WYSIWYG preview"]
    F["Footer: Generate · Regenerate · Export"]
  end
  L --- C --- R
  C --- F
```

→ Handbook §13.1

---

## W4 — O.T.T.E.R. screen

```mermaid
graph TB
  subgraph "O.T.T.E.R."
    N["Nav: Library · Hotkeys · Nodes · Quiz · Validate · Requests"]
    S1["Sidebar 1<br/>courses + subjects<br/>tier chips · trash<br/>collapses Ctrl+\\"]
    S2["Sidebar 2<br/>lessons (view-dependent)"]
    M["Main pane<br/>one of 9 currentView values"]
  end
  N --> S1 --- S2 --- M
```

- Views: `library · prompt · study · quiz · hotkeys · nodes · sources · requests · validator`.
- `requests` and `validator` are conditionally **mounted**, not just hidden.

→ Handbook §13.2

---

## W5 — R.A.B.B.I.T. screen

```mermaid
graph TB
  subgraph "R.A.B.B.I.T."
    H["Header: project switcher · presence chips · LIVE pill"]
    T["View tabs: Intake · Summary · Team · Tasks · Timeline · Budget · Assets · [Scenes] [Levels] [Experiences]"]
    M["Active view"]
    P["TaskDetailPopup / FileManager / EditHistoryDrawer"]
  end
  H --> T --> M --> P
```

- Bracketed tabs appear only when the project enables that module.

→ Handbook §13.3

---

## W6 — Admin Terminal

```mermaid
graph LR
  NAV["Users · Company · Requests · Logs · Diagnostics"]
  U["Roster · role · grants · MFA<br/>Add People → invite / create"]
  CO["Workspace · departments<br/>+ Workspace Takeout"]
  RQ["O.T.T.E.R. change-request queue"]
  LG["app_events · edit_history"]
  DG["Build info · error codes<br/>+ Storage Cleanup"]
  NAV --> U & CO & RQ & LG & DG
```

- Each section lazy-fetches on first activation (`isActive`), never at page mount.

→ Handbook §13.4

---

## W7 — Operator console

```mermaid
graph LR
  NAV["Companies · Audit"]
  C["Company table<br/>members · projects · files · AI key<br/>→ rename · suspend · restore · TEARDOWN · set/clear key"]
  A["platform_audit<br/>latest 200, read-only"]
  NAV --> C & A
```

- No router, no tools, no pet. Sign-in is email + password + TOTP.

→ Handbook §5.6

---

## T1 — D.O.G. dataflow

```mermaid
flowchart LR
  IN["Source files<br/>+ project context"] --> ASM["Assemble messages"]
  ASM --> AI["ai-proxy<br/>Sonnet 4"]
  AI --> P["parseSlideContent"]
  P --> G["correctGeometryIconOrder"]
  G --> TABS["Slide tabs"]
  TABS --> E1["_DECKOUTLINE.md"]
  TABS --> E2["_VIS_DECKOUTLINE.md"]
  TABS --> E3["_IMG_PROMPTS.md"]
  TABS --> E4["_VIS_ASSETS_* raw files"]
```

- Full-deck generation loops up to 3 **continuations** on `stop_reason: max_tokens`.
- COMPONENT GEOMETRY JSON is exported for an external Slides extension — nothing in-app renders it.

→ Handbook §13.1

---

## T2 — O.T.T.E.R. dataflow

```mermaid
flowchart LR
  P["Software / topic<br/>+ tier + refs"] --> O["Outline call<br/>Sonnet 4"]
  O --> ST["Subject stubs<br/>is_stub=true"]
  ST --> GC["Content call<br/>Sonnet 4 + web_search"]
  GC --> SUB["Sections → lessons"]
  SUB --> STUDY["Study + progress"]
  SUB --> QZ["Quiz — Haiku 4.5<br/>session-only"]
  SUB --> VAL["Validator — Sonnet 4 + search<br/>session-only"]
  VAL --> FIX["Proposed fixes → apply"]
```

- Quiz scores and Validator findings are **not persisted**.

→ Handbook §13.2

---

## T3 — R.A.B.B.I.T. dataflow

```mermaid
flowchart LR
  F["is_core_definer files"] --> X["Extract text<br/>txt·md·docx·pdf·pptx"]
  X --> K["Detect document kind<br/>hint → regex → Haiku"]
  K --> CH["1 of 9 chunkers"]
  CH --> W["Worker pool ×3<br/>+ persona block"]
  W --> MG["Fuzzy-dedup merge"]
  MG --> RV["Review"]
  RV --> ACC["Accept → phases → assets → tasks"]
  ACC --> V["Tasks · Timeline · Budget · Assets"]
```

- Partial chunk failure is tolerated; **all** chunks failing throws loudly.

→ Handbook §13.3

---

## F1 — Login

```mermaid
sequenceDiagram
  participant U as User
  participant C as Client
  participant RL as resolve-login
  participant A as Auth
  participant IS as issue-session

  U->>C: username + password
  C->>RL: {username}
  RL-->>C: {exists, email} (uniform, ≥180ms)
  Note over C: miss → sign in against a fake<br/>address so timing is identical
  C->>A: signInWithPassword
  A-->>C: ES256 JWT (hook mints claims)
  opt verified TOTP factor
    C->>A: mfa.challenge → mfa.verify
    A-->>C: aal2
  end
  C->>C: list workspaces (RLS-scoped)
  C->>IS: {workspace_id}
  IS->>A: set app_metadata.workspace_id
  C->>A: refreshSession
  A-->>C: token with final claims
```

→ Handbook §4.2

---

## F2 — Invite and onboarding

```mermaid
sequenceDiagram
  participant AD as Admin
  participant IM as invite-member
  participant A as Auth
  participant R as Resend
  participant NU as New user

  AD->>IM: email + username + app_role
  IM->>IM: claims + live-row admin check
  IM->>A: inviteUserByEmail
  A->>R: SMTP
  R->>NU: link → /#/recovery
  IM->>IM: insert membership (onboarded_at NULL)
  NU->>A: set password → signed out
  NU->>A: real sign-in
  NU->>NU: NewUserWelcome → stamps onboarded_at
```

→ Handbook §4.6, §9

---

## F3 — Realtime

```mermaid
flowchart LR
  W["Write"] --> TR["AFTER trigger"]
  TR --> BC["realtime.broadcast_changes"]
  BC --> T1["rabbit:project:{id}"]
  BC --> T2["rabbit:workspace:{id}"]
  T1 & T2 --> J["Join authz — once<br/>can_read_*_topic()"]
  J --> CL["Client"]
  CL --> M["realtimeMerge<br/>LWW per field"]
  M --> PF["pending fields keep local"]
  M --> SG["stale updated_at dropped"]
```

- **Not** `postgres_changes`: it re-checks the NEW row per event, so soft-delete events would be withheld.

→ Handbook §4.5

---

## F4 — Delete lifecycle

```mermaid
flowchart LR
  L["Live row"] -->|soft_delete_row RPC| T["Trashed"]
  T -->|restore_soft_deleted| L
  T -->|"cron 04:47, 30d"| H["Hard delete"]
  H --> C1["file_events 'purged'<br/>= certificate"]
  H --> Q["storage_gc_queue"]
  Q -->|"admin clicks"| GC["storage-gc"]
  GC --> BLOB["Blob removed"]
  GC --> C2["WIL-3003 / WIL-3004"]
```

- GC is admin-invoked, never cron: the click is TPN's second authorization factor.
- `purged` rows have no FKs, so the certificate outlives its subject.

→ Handbook §12.3, §12.4

---

## F5 — Storage relink

```mermaid
flowchart LR
  PK["User picks folder<br/>rabbit:pick-directory"] --> AU["userAuthorizedDirs"]
  AU --> SC["relink-scan"]
  SC --> R1["1 exact<br/>basename"]
  R1 --> R2["2 strong<br/>name + size"]
  R2 --> R3["3 name only"]
  R3 --> PV["Preview: matched · ambiguous · unmatched"]
  PV --> AP["relink-apply"]
  AP --> FD["files_dir override<br/>= new files home"]
  AP --> EV["'relinked' events"]
```

- 403 for any folder not picked through the dialog; 409 if the recorded home is merely offline, or if the change would strand a file.

→ Handbook §12.2

---

## F6 — ai-proxy

```mermaid
sequenceDiagram
  participant C as Client
  participant P as ai-proxy
  participant DB as Postgres
  participant AN as Anthropic

  C->>P: {model, max_tokens, messages, tool}
  P->>DB: requireActiveMember (live row)
  P->>DB: fn_rate_limit_hit (fail-OPEN)
  P->>DB: workspace_ai_keys → decrypt
  Note over P: else platform ANTHROPIC_API_KEY<br/>else 501 ai_not_configured
  P->>AN: stream:true (always)
  AN-->>P: SSE
  P-->>C: SSE passthrough
  C->>C: reassemble → message object
  P->>DB: WIL-6001/6002 + key_source
```

- Always streams: the 150 s Edge response deadline would kill long generations.
- An SSE `error` event closes the stream *normally* — both sides sniff for it.

→ Handbook §6

---

## F7 — Change request

```mermaid
sequenceDiagram
  participant U as Proposer
  participant R as Reviewer
  participant DB as Postgres

  U->>DB: fork company_standard → personal copy
  U->>DB: edit + submit request
  Note over DB: review window OPENS<br/>reviewers can read the fork
  R->>DB: otter_cr_apply()
  DB->>DB: 1 archive target → approver's copy
  DB->>DB: 2 apply subjects ADDITIVELY
  DB->>DB: 3 status = approved
  Note over DB: window CLOSES
```

- Approving **applies**; a bare status flip raises.
- Additive only — update by slug, insert when absent, never delete. Reference docs untouched.

→ Handbook §13.2

---

## F8 — Export and takeout

```mermaid
flowchart LR
  V["Page view"] -->|"exactly what you see"| CSV["roster / rate-card / tasks CSV"]
  AD["Admin"] --> TK["Workspace Takeout"]
  TK --> RD["Admin's own RLS-scoped reads<br/>19 tables, paged"]
  RD --> ZIP["zip + manifest.json"]
  EX["EXCLUDED: O.T.T.E.R. · Notes<br/>· gc queue · blobs"] --- TK
```

- Never a DEFINER sweep — a takeout can only contain what that admin already reads.
- `csvExport.js` guards: BOM, RFC 4180, formula-injection prefix on `= + @ -`.

→ Handbook §12.5

---

## F9 — Workspace provision and teardown

```mermaid
flowchart TB
  subgraph Provision
    P1["create auth user"] --> P2["provision_workspace_and_admin"] --> P3["seed workspace_id"] --> P4["WIL-7001 certificate"]
  end
  subgraph "Teardown — the ORDER is the design"
    T1["1 snapshot slug + name"] --> T2["2 require typed slug"]
    T2 --> T3["3 collect blob paths<br/>files + gc_queue, .range() paged"]
    T3 --> T3a["3b list avatars by prefix<br/>user-avatars/{ws}/…"]
    T3a --> T3b["3c sweep OPEN upload reservations<br/>sweep_open_uploads → abandoned paths"]
    T3b --> T3c["3d WIL-7012 certificate ×40<br/>before any blob moves"]
    T3c --> T4["4 refuse foreign paths → WIL-7008"]
    T4 --> T5["5 delete blobs ×100<br/>certificate ×40 → WIL-7006"]
    T5 --> T5a["6b delete avatars ×100<br/>certificate ×40 → WIL-7006"]
    T5a --> T6["7 DELETE workspace → CASCADE"]
    T6 --> T7["8 drop queue rows AFTER cascade"]
    T7 --> T8["9 WIL-7005 certificate"]
  end
```

- Collect **before** the cascade: afterwards nothing can tell which blobs were the tenant's.
- Queue rows are dropped **after**, because the cascade re-enqueues them.
- **Three buckets, not two** (Track C / C2): `user-avatars` is *listed* by
  prefix rather than derived from rows, because no row names an avatar object.
- The reservation sweep and its certificate come **first**, before any blob is
  touched: the sweep commits its rows immediately, and `file_events` is
  destroyed by the cascade a moment later.

→ Handbook §5.4

---

## F10 — Update and backup

```mermaid
flowchart LR
  subgraph "Auto-update"
    LI["Sign-in"] --> CK["checkForUpdates"]
    CK --> OF{"available and<br/>not skipped?"}
    OF -->|yes| PR["UpdatePrompt"]
    PR --> DL["download → Restart & install"]
    PR --> SK["Skip → localStorage"]
    B2A["B2 generic feed"] --> CK
  end
  subgraph "Backups"
    CR["cron 08:15 UTC<br/>on main branch only"] --> PD["pg_dump prod + staging"]
    PD --> UP["B2, 90d, Object Lock"]
    UP --> VF["re-list or fail"]
  end
```

- A `schedule` workflow only fires from the **default branch** — otherwise it is decoration.
- NSIS is the only auto-updatable artifact; Forge/Squirrel degrades to `unsupported`.

→ Handbook §7.2, §11

---

## S1 — Change-request states

```mermaid
stateDiagram-v2
  [*] --> open: submit
  open --> approved: otter_cr_apply() ONLY
  open --> rejected: decline
  open --> changes_requested: decline + note (required)
  open --> withdrawn: proposer
  changes_requested --> open: resubmit (revision+1)
  changes_requested --> rejected: accept decision
  approved --> [*]
  rejected --> [*]
  withdrawn --> [*]
```

→ Handbook §13.2

---

## S2 — Pet life cycle

```mermaid
stateDiagram-v2
  [*] --> egg
  egg --> baby: hatch
  baby --> adult: evolve
  adult --> sleeping: 15 interactions / 30 min
  sleeping --> adult: wake
  adult --> corpse: hunger ≤ 0
  corpse --> ghost: 10s
  ghost --> egg: new egg
```

- Two independent 30 s intervals: decay, and auto-save.

→ Handbook §13.5
