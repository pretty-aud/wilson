-- ============================================================
-- RABBIT v0.1 demo seed: "Sample Short Film"
-- 1 project, 2 phases, 3 assets, 6 tasks, 2 dependencies.
-- Apply AFTER schema.sql against a fresh Supabase project to
-- sanity-check the adapter round-trip.
-- ============================================================

-- Use stable UUIDs so subsequent re-runs reference the same rows.
-- Reset (optional): delete from projects where id = '11111111-0000-0000-0000-000000000001';

insert into projects (id, workspace_id, title, description, status, status_tag,
                      start_date, end_date, budget_total, budget_currency, client_name)
values (
  '11111111-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Sample Short Film',
  'A 6-minute animated short used to verify the RABBIT v0.1 adapter round-trip. '
    || 'Two phases, three hero assets, six representative tasks across departments.',
  'active',
  'in production',
  '2026-04-01',
  '2026-09-30',
  185000.00,
  'USD',
  'Petal Studios Internal'
)
on conflict (id) do nothing;

-- ─── Phases ────────────────────────────────────────────────────────────
insert into phases (id, project_id, name, description, start_date, end_date, sort_order, color)
values
  ('22222222-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001',
   'Pre-Production',
   'Story lock, design, and visual development.',
   '2026-04-01', '2026-05-31', 0, '#f4a261'),
  ('22222222-0000-0000-0000-000000000002',
   '11111111-0000-0000-0000-000000000001',
   'Production',
   'Modeling, rigging, animation, lighting, comp.',
   '2026-06-01', '2026-09-30', 1, '#ea580c')
on conflict (id) do nothing;

-- ─── Assets ────────────────────────────────────────────────────────────
insert into assets (id, project_id, phase_id, name, type, description, status, sort_order)
values
  ('33333333-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000002',
   'Hero Character — Mira',
   'character',
   'Lead protagonist. Hero rig, full facial blendshapes, cloth sim.',
   'in_progress', 0),
  ('33333333-0000-0000-0000-000000000002',
   '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000002',
   'Forest Environment',
   'environment',
   'Mossy old-growth forest with volumetric lighting.',
   'not_started', 1),
  ('33333333-0000-0000-0000-000000000003',
   '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000001',
   'Style Frame Pack',
   'concept',
   'Eight visual development paintings establishing tone.',
   'approved', 2)
on conflict (id) do nothing;

-- ─── Tasks ─────────────────────────────────────────────────────────────
-- Mira (character)
insert into tasks (id, asset_id, project_id, title, description, status, priority,
                   start_date, end_date, bid_days, assigned_position, assigned_role_slug)
values
  ('44444444-0000-0000-0000-000000000001',
   '33333333-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001',
   'Model Mira — base mesh',
   'Quad-only base mesh, A-pose, ready for sculpt detail.',
   'in_progress', 'high', '2026-06-01', '2026-06-12', 9.0,
   'Lead Modeler', 'lead_modeler'),
  ('44444444-0000-0000-0000-000000000002',
   '33333333-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001',
   'Rig Mira — hero rig',
   'Full skeleton + facial blendshapes + cloth attachment points.',
   'waiting_to_start', 'high', '2026-06-15', '2026-07-03', 14.0,
   'Lead Rigger', 'lead_rigger'),
  ('44444444-0000-0000-0000-000000000003',
   '33333333-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001',
   'Surface + groom Mira',
   'Skin shader, hair groom, eye shader, cloth materials.',
   'waiting_to_start', 'medium', '2026-07-06', '2026-07-24', 14.0,
   'Lookdev Lead', 'lookdev_lead'),
-- Forest environment
  ('44444444-0000-0000-0000-000000000004',
   '33333333-0000-0000-0000-000000000002',
   '11111111-0000-0000-0000-000000000001',
   'Block out forest geometry',
   'Greybox + scatter pass for camera coverage.',
   'waiting_to_start', 'medium', '2026-06-01', '2026-06-19', 14.0,
   'Environment Artist', 'environment_artist'),
  ('44444444-0000-0000-0000-000000000005',
   '33333333-0000-0000-0000-000000000002',
   '11111111-0000-0000-0000-000000000001',
   'Light + comp forest',
   'Volumetric god rays, atmosphere, final beauty pass.',
   'waiting_to_start', 'high', '2026-08-10', '2026-09-04', 19.0,
   'Lighting TD', 'lighting_td'),
-- Style frame pack
  ('44444444-0000-0000-0000-000000000006',
   '33333333-0000-0000-0000-000000000003',
   '11111111-0000-0000-0000-000000000001',
   'Paint 8 style frames',
   'Eight key moments, painted to final-look quality.',
   'final', 'high', '2026-04-15', '2026-05-15', 21.0,
   'Art Director', 'art_director')
on conflict (id) do nothing;

-- ─── Task dependencies ────────────────────────────────────────────────
-- Rig depends on model (Finish-to-Start)
-- Lighting depends on blockout (Finish-to-Start, with 5-day lag for layout review)
insert into task_dependencies (id, predecessor_id, successor_id, type, lag_days)
values
  ('55555555-0000-0000-0000-000000000001',
   '44444444-0000-0000-0000-000000000001',
   '44444444-0000-0000-0000-000000000002',
   'FS', 0),
  ('55555555-0000-0000-0000-000000000002',
   '44444444-0000-0000-0000-000000000004',
   '44444444-0000-0000-0000-000000000005',
   'FS', 5)
on conflict do nothing;
