-- ============================================================
-- RABBIT v0.1 schema  (Supabase Postgres)
-- Apply to a fresh Supabase project. Re-runnable with IF NOT EXISTS.
-- ============================================================

create extension if not exists "pgcrypto";

-- ─── Enumerated taxonomies ────────────────────────────────────────────
do $$ begin
  create type project_status as enum ('active','on_hold','completed','archived','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type asset_type as enum (
    'character','environment','prop','vehicle','vfx','animation','rig','model',
    'texture','audio','vo','music','cinematic','ui','level','script','treatment',
    'concept','storyboard','illustration','document','deliverable','other'
  );
exception when duplicate_object then null; end $$;

-- 10-value task status modeled on ShotGrid + VFX industry
do $$ begin
  create type task_status as enum (
    'bidding',           -- bid in progress / not yet awarded
    'waiting_to_start',  -- ShotGrid rdy  (ready, unblocked, unassigned-work)
    'in_progress',       -- ShotGrid ip
    'blocked',           -- upstream blocker
    'on_hold',           -- ShotGrid hld  (paused by decision)
    'pending_review',    -- ShotGrid rev  (submitted, awaiting feedback)
    'revisions',         -- cbb / retake  (notes received, iterating)
    'approved',          -- internal supervisor approved
    'final',             -- ShotGrid fin  (client/director final)
    'omitted'            -- ShotGrid omt  (cut from project)
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_priority as enum ('low','medium','high','critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type file_kind as enum ('source','reference','deliverable','export','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type storage_provider as enum ('supabase','google_drive','local_server');
exception when duplicate_object then null; end $$;

do $$ begin
  create type dep_type as enum ('FS','SS','FF','SF');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ingestion_status as enum ('queued','running','partial','complete','failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type document_kind as enum (
    'script','treatment','gdd','brief','deck','outline','notes',
    'pitch_bible','lookbook','other'
  );
exception when duplicate_object then null; end $$;

-- ─── Workspaces (reserved for multi-user v0.2) ────────────────────────
create table if not exists workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Seed a single default workspace row for v0.1 single-user mode.
insert into workspaces (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Default Workspace')
on conflict do nothing;

-- ─── Users (reserved for multi-user v0.2) ─────────────────────────────
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  display_name  text,
  created_at    timestamptz not null default now()
);

-- ─── Projects ────────────────────────────────────────────────────────
create table if not exists projects (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade
                    default '00000000-0000-0000-0000-000000000001',
  title           text not null,
  description     text default '',
  status          project_status not null default 'active',
  status_tag      text,
  start_date      date,
  end_date        date,
  budget_total    numeric(12,2),
  budget_currency text default 'USD',
  client_name     text,
  cover_image_url text,
  created_by      uuid references users(id) on delete set null,  -- nullable for v0.1
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists projects_workspace_idx on projects(workspace_id);
create index if not exists projects_status_idx on projects(status);
create index if not exists projects_updated_at_idx on projects(updated_at desc);

-- ─── Phases ──────────────────────────────────────────────────────────
create table if not exists phases (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  name         text not null,
  description  text default '',
  start_date   date,
  end_date     date,
  sort_order   integer not null default 0,
  color        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists phases_project_idx on phases(project_id, sort_order);

-- ─── Assets ──────────────────────────────────────────────────────────
-- Independent status field + free-text type_label overflow on top of enum.
create table if not exists assets (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  phase_id       uuid references phases(id) on delete set null,
  name           text not null,
  type           asset_type not null default 'other',
  type_label     text,                        -- free-text override when enum insufficient
  description    text default '',
  thumbnail_url  text,
  status         text default 'not_started',  -- free-form; client shows warning if set to approved/final while tasks incomplete
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists assets_project_idx on assets(project_id);
create index if not exists assets_phase_idx on assets(phase_id);
create index if not exists assets_type_idx on assets(type);

-- ─── Tasks ───────────────────────────────────────────────────────────
-- assigned_position = role slot (e.g. "Lead Animator"). assigned_user_id reserved for v0.2.
create table if not exists tasks (
  id                 uuid primary key default gen_random_uuid(),
  asset_id           uuid not null references assets(id) on delete cascade,
  project_id         uuid not null references projects(id) on delete cascade,
  title              text not null,
  description        text default '',
  status             task_status not null default 'waiting_to_start',
  priority           task_priority not null default 'medium',
  start_date         date,
  end_date           date,
  bid_days           numeric(6,2),
  logged_days        numeric(6,2) default 0,
  assigned_position  text,
  assigned_role_slug text,
  assigned_user_id   uuid references users(id) on delete set null,  -- reserved, nullable
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint task_min_duration_chk
    check (end_date is null or start_date is null or end_date >= start_date)
);
create index if not exists tasks_asset_idx   on tasks(asset_id);
create index if not exists tasks_project_idx on tasks(project_id);
create index if not exists tasks_status_idx  on tasks(status);
create index if not exists tasks_dates_idx   on tasks(start_date, end_date);

-- ─── Task dependencies (4 Gantt link types) ──────────────────────────
create table if not exists task_dependencies (
  id             uuid primary key default gen_random_uuid(),
  predecessor_id uuid not null references tasks(id) on delete cascade,
  successor_id   uuid not null references tasks(id) on delete cascade,
  type           dep_type not null default 'FS',
  lag_days       integer not null default 0,
  unique (predecessor_id, successor_id)
);

-- ─── Task links (free-form URLs) ─────────────────────────────────────
create table if not exists task_links (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  label      text,
  url        text not null,
  created_at timestamptz not null default now()
);

-- ─── Files ───────────────────────────────────────────────────────────
create table if not exists files (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  phase_id          uuid references phases(id) on delete set null,
  asset_id          uuid references assets(id) on delete set null,
  task_id           uuid references tasks(id) on delete set null,
  name              text not null,
  mime_type         text,
  size_bytes        bigint,
  storage_provider  storage_provider not null,
  storage_path      text not null,
  thumbnail_url     text,
  kind              file_kind not null default 'source',
  is_core_definer   boolean not null default false,
  uploaded_at       timestamptz not null default now()
);
create index if not exists files_project_idx on files(project_id);
create index if not exists files_core_idx    on files(project_id) where is_core_definer = true;

-- ─── Asset version history ───────────────────────────────────────────
create table if not exists asset_versions (
  id            uuid primary key default gen_random_uuid(),
  asset_id      uuid not null references assets(id) on delete cascade,
  version_no    integer not null,
  notes         text default '',
  thumbnail_url text,
  file_id       uuid references files(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (asset_id, version_no)
);

-- ─── Comments (any entity) ───────────────────────────────────────────
create table if not exists comments (
  id             uuid primary key default gen_random_uuid(),
  entity_type    text not null check (entity_type in ('project','phase','asset','task')),
  entity_id      uuid not null,
  body           text not null,
  author_name    text,
  author_user_id uuid references users(id) on delete set null,  -- reserved
  created_at     timestamptz not null default now()
);
create index if not exists comments_entity_idx on comments(entity_type, entity_id);

-- ─── Rate cards ──────────────────────────────────────────────────────
create table if not exists rate_cards (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade
                    default '00000000-0000-0000-0000-000000000001',
  name            text not null,
  source_file_id  uuid references files(id) on delete set null,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now()
);

create table if not exists rate_card_entries (
  id              uuid primary key default gen_random_uuid(),
  rate_card_id    uuid not null references rate_cards(id) on delete cascade,
  role_label      text not null,
  role_slug       text not null,
  region          text,
  project_size    text,
  day_rate        numeric(10,2),
  week_rate       numeric(10,2),
  month_rate      numeric(10,2),
  currency        text default 'USD',
  source_row      integer
);
create index if not exists rate_card_entries_card_idx on rate_card_entries(rate_card_id);
create index if not exists rate_card_entries_role_idx on rate_card_entries(role_slug);

-- ─── Ingestion runs ──────────────────────────────────────────────────
create table if not exists ingestion_runs (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  status         ingestion_status not null default 'queued',
  document_kind  document_kind not null default 'other',
  chunks_total   integer default 0,
  chunks_done    integer default 0,
  model_used     text,
  started_at     timestamptz default now(),
  finished_at    timestamptz,
  error_message  text
);

create table if not exists ingestion_chunks (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references ingestion_runs(id) on delete cascade,
  file_id     uuid references files(id) on delete set null,
  chunk_index integer not null,
  chunk_label text,
  raw_text    text,
  parsed_json jsonb,
  status      ingestion_status not null default 'queued'
);
create index if not exists ingestion_chunks_run_idx on ingestion_chunks(run_id, chunk_index);

-- ─── Updated-at triggers ─────────────────────────────────────────────
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$ begin
  create trigger projects_touch  before update on projects  for each row execute function touch_updated_at();
  create trigger phases_touch    before update on phases    for each row execute function touch_updated_at();
  create trigger assets_touch    before update on assets    for each row execute function touch_updated_at();
  create trigger tasks_touch     before update on tasks     for each row execute function touch_updated_at();
exception when duplicate_object then null; end $$;
