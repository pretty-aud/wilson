// =============================================================================
// money.js — the rate card and the budget.
//
// Two rate cards, as useRateCard expects to find them: the GENERAL card
// (industry day rates by role) and the INTERNAL card (one entry per salaried
// member, priced from a wage). The budget has the three sheets BudgetView
// tabs over — crew, talent and expenses (the client view is a rollup of the
// same lines) — plus actuals, two bid versions and three expenses.
// Rates are round invented USD figures.
// =============================================================================

import { fid, day, stamp } from '../ids'
import { WORKSPACE_ID, MEMBER_ID, MEMBERS } from './workspace'
import { PROJECT_ID, ASSET_ID, PHASE_ID, TASK_ID } from './project'

export const RATE_CARDS = [
  { id: fid('rateCard', 1), workspace_id: WORKSPACE_ID, name: 'General Rate Card',  type: 'general',  is_default: true,  source_file_id: null, created_at: stamp(-100, 10), deleted_at: null },
  { id: fid('rateCard', 2), workspace_id: WORKSPACE_ID, name: 'Internal Rate Card', type: 'internal', is_default: false, source_file_id: null, created_at: stamp(-100, 10, 1), deleted_at: null },
]
export const GENERAL_CARD_ID = RATE_CARDS[0].id
export const INTERNAL_CARD_ID = RATE_CARDS[1].id

const GENERAL_ROWS = [
  // [n, role_label, role_slug, department, day_rate]
  [1,  'Producer',                 'producer',            'Production', 650],
  [2,  'Director',                 'director',            'Direction',  800],
  [3,  'Director of Photography',  'dop',                 'Camera',     750],
  [4,  '1st AC',                   'first_ac',            'Camera',     420],
  [5,  'Gaffer',                   'gaffer',              'Lighting',   480],
  [6,  'Production Designer',      'production_designer', 'Art',        520],
  [7,  'Art Department Assistant', 'art_assistant',       'Art',        260],
  [8,  'Sound Recordist',          'sound_recordist',     'Sound',      450],
  [9,  'Sound Designer',           'sound_designer',      'Sound',      500],
  [10, 'Editor',                   'editor',              'Post',       550],
  [11, 'VFX Supervisor',           'vfx_supervisor',      'VFX',        700],
  [12, 'Compositor',               'compositor',          'VFX',        480],
  [13, 'Colourist',                'colourist',           'Post',       650],
  [14, 'Production Coordinator',   'coordinator',         'Production', 320],
]

const INTERNAL_ROWS = [
  // salaried members priced from a wage (0059): [n, member key, role_slug, annual wage]
  [1, 'mara',  'producer',            78000],
  [2, 'theo',  'director',            82000],
  [3, 'jonah', 'production_designer', 61000],
  [4, 'sofia', 'editor',              64000],
  [5, 'kenji', 'vfx_supervisor',      88000],
  [6, 'dev',   'coordinator',         42000],
]

const memberByKey = Object.fromEntries(Object.entries(MEMBER_ID).map(([k, id]) => [k, MEMBERS.find(m => m.user_id === id)]))

export const RATE_CARD_ENTRIES = [
  ...GENERAL_ROWS.map(([n, role_label, role_slug, department, day_rate], i) => ({
    id: fid('rateEntry', n),
    rate_card_id: GENERAL_CARD_ID,
    role_label,
    role_slug,
    region: 'US',
    project_size: 'tier_1',
    day_rate,
    week_rate: day_rate * 5,
    month_rate: day_rate * 20,
    currency: 'USD',
    source_row: i + 2,
    department,
    member_id: null,
    wage: null,
    burden: 12,
    burden_type: 'percent',
    overhead: 8,
    overhead_type: 'percent',
  })),
  ...INTERNAL_ROWS.map(([n, key, role_slug, wage]) => {
    const m = memberByKey[key]
    const dayRate = Math.round(wage / 220)
    return {
      id: fid('rateEntry', 100 + n),
      rate_card_id: INTERNAL_CARD_ID,
      role_label: m.title,
      role_slug,
      region: 'US',
      project_size: null,
      day_rate: dayRate,
      week_rate: dayRate * 5,
      month_rate: Math.round(wage / 12),
      currency: 'USD',
      source_row: null,
      department: m.department,
      member_id: m.user_id,
      wage,
      burden: 18,
      burden_type: 'percent',
      overhead: 10,
      overhead_type: 'percent',
    }
  }),
]

// ── Budget lines ─────────────────────────────────────────────────────────────

const M = MEMBER_ID
const LINE_ROWS = [
  // [n, sheet, department, label, is_section_header, team_member_id, role_slug, rate, days, qty, talent_type, agent_name, agency_name, email, phone, union_id]
  [1,  'crew', 'Production', 'Production',              true,  null,    null,                  null, null, null],
  [2,  'crew', 'Production', 'Producer',                false, M.mara,  'producer',            650,  30,   1],
  [3,  'crew', 'Production', 'Production Coordinator',  false, M.dev,   'coordinator',         320,  40,   1],
  [4,  'crew', 'Direction',  'Direction',               true,  null,    null,                  null, null, null],
  [5,  'crew', 'Direction',  'Director',                false, M.theo,  'director',            800,  24,   1],
  [6,  'crew', 'Camera',     'Camera',                  true,  null,    null,                  null, null, null],
  [7,  'crew', 'Camera',     'Director of Photography', false, M.priya, 'dop',                 750,  14,   1],
  [8,  'crew', 'Camera',     '1st AC',                  false, null,    'first_ac',            420,  10,   1],
  [9,  'crew', 'Lighting',   'Lighting',                true,  null,    null,                  null, null, null],
  [10, 'crew', 'Lighting',   'Gaffer',                  false, null,    'gaffer',              480,  10,   1],
  [11, 'crew', 'Art',        'Art',                     true,  null,    null,                  null, null, null],
  [12, 'crew', 'Art',        'Production Designer',     false, M.jonah, 'production_designer', 520,  26,   1],
  [13, 'crew', 'Art',        'Art Department Assistant',false, null,    'art_assistant',       260,  15,   2],
  [14, 'crew', 'Sound',      'Sound',                   true,  null,    null,                  null, null, null],
  [15, 'crew', 'Sound',      'Sound Recordist',         false, null,    'sound_recordist',     450,  10,   1],
  [16, 'crew', 'Sound',      'Sound Designer',          false, M.lena,  'sound_designer',      500,  16,   1],
  [17, 'crew', 'Post',       'Post',                    true,  null,    null,                  null, null, null],
  [18, 'crew', 'Post',       'Editor',                  false, M.sofia, 'editor',              550,  28,   1],
  [19, 'crew', 'Post',       'Colourist',               false, null,    'colourist',           650,  4,    1],
  [20, 'crew', 'VFX',        'VFX',                     true,  null,    null,                  null, null, null],
  [21, 'crew', 'VFX',        'VFX Supervisor',          false, M.kenji, 'vfx_supervisor',      700,  22,   1],
  [22, 'crew', 'VFX',        'Compositor',              false, null,    'compositor',          480,  18,   1],
  [23, 'talent', 'Cast',     'Cast',                    true,  null,    null,                  null, null, null],
  [24, 'talent', 'Cast',     'Mara (lead)',             false, null,    null,                  900,  10,   1, 'actor',    'Ruth Calder',  'Calder & Voss',   'ruth@calder-voss.example',  '+44 20 7946 0101', 'EQ-118820'],
  [25, 'talent', 'Cast',     "Mara's Father",           false, null,    null,                  750,  3,    1, 'actor',    'Ruth Calder',  'Calder & Voss',   'ruth@calder-voss.example',  '+44 20 7946 0101', 'EQ-207731'],
  [26, 'talent', 'Cast',     'Café owner',              false, null,    null,                  450,  1,    1, 'actor',    'Sam Ibe',      'Northlight Agency','sam@northlight.example',   '+44 161 496 0222', null],
  [27, 'talent', 'Voice',    'Log book VO',             false, null,    null,                  600,  1,    1, 'voice',    'Sam Ibe',      'Northlight Agency','sam@northlight.example',   '+44 161 496 0222', null],
  [28, 'expenses_travel', 'Travel', 'Travel and accommodation', true, null, null,              null, null, null],
  [29, 'expenses_travel', 'Travel', 'Crew accommodation, 12 nights', false, null, null,        95,   12,   8],
  [30, 'expenses_travel', 'Travel', 'Van hire',                 false, null, null,             120,  14,   1],
  [31, 'expenses_travel', 'Travel', 'Fuel and ferry',           false, null, null,             1,    1,    900],
  [32, 'expenses_travel', 'Kit',    'Kit and consumables',      true,  null, null,             null, null, null],
  [33, 'expenses_travel', 'Kit',    'Camera package hire',      false, null, null,             1400, 12,   1],
  [34, 'expenses_travel', 'Kit',    'Lighting package hire',    false, null, null,             900,  12,   1],
  [35, 'expenses_travel', 'Kit',    'Set timber and paint',     false, null, null,             1,    1,    4200],
]

export const BUDGET_LINES = LINE_ROWS.map(([n, sheet, department, label, is_section_header, team_member_id, role_slug, rate, days, qty, talent_type = null, agent_name = null, agency_name = null, email = null, phone = null, union_id = null], i) => ({
  id: fid('budgetLine', n),
  project_id: PROJECT_ID,
  workspace_id: WORKSPACE_ID,
  sheet,
  department,
  sort_order: i,
  label,
  description: '',
  is_section_header,
  team_member_id,
  role_slug,
  rate,
  days,
  qty,
  cost: is_section_header ? null : (rate ?? 0) * (days ?? 1) * (qty ?? 1),
  is_na_days: false,
  is_na_qty: false,
  margin_pct: null,
  contingency_pct: null,
  agency_opt_out: false,
  talent_agency_fee_pct: sheet === 'talent' ? 15 : null,
  talent_type,
  agent_name,
  agency_name,
  email,
  phone,
  union_id,
  created_by: M.mara,
  updated_by: M.mara,
  created_at: stamp(-8, 10, i),
  updated_at: stamp(30, 10, i),
}))

export const BUDGET_ACTUALS = [
  { id: fid('budgetActual', 1), project_id: PROJECT_ID, workspace_id: WORKSPACE_ID, line_id: fid('budgetLine', 33), column_index: 0, value: 16800, invoice_number: 'INV-0041', expense_id: fid('expense', 1), source: 'invoice', notes: 'Camera hire, deposit paid.', attachment_name: 'INV-0041_camera_hire.pdf', attachment_path: null, created_by: M.mara, updated_by: M.mara, created_at: stamp(36, 12), updated_at: stamp(36, 12) },
  { id: fid('budgetActual', 2), project_id: PROJECT_ID, workspace_id: WORKSPACE_ID, line_id: fid('budgetLine', 35), column_index: 0, value: 3860, invoice_number: 'INV-0042', expense_id: fid('expense', 2), source: 'invoice', notes: 'Timber under estimate.', attachment_name: 'INV-0042_set_timber.pdf', attachment_path: null, created_by: M.jonah, updated_by: M.jonah, created_at: stamp(38, 12), updated_at: stamp(38, 12) },
  { id: fid('budgetActual', 3), project_id: PROJECT_ID, workspace_id: WORKSPACE_ID, line_id: fid('budgetLine', 12), column_index: 0, value: 7280, invoice_number: null, expense_id: null, source: 'timesheet', notes: '14 of 26 days logged.', attachment_name: null, attachment_path: null, created_by: M.jonah, updated_by: M.jonah, created_at: stamp(39, 9), updated_at: stamp(39, 9) },
  { id: fid('budgetActual', 4), project_id: PROJECT_ID, workspace_id: WORKSPACE_ID, line_id: fid('budgetLine', 2),  column_index: 0, value: 9750, invoice_number: null, expense_id: null, source: 'timesheet', notes: '15 of 30 days logged.', attachment_name: null, attachment_path: null, created_by: M.mara, updated_by: M.mara, created_at: stamp(39, 9, 1), updated_at: stamp(39, 9, 1) },
]

export const BUDGET_VERSIONS = [
  { id: fid('budgetVersion', 1), project_id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: 'Bid v1 (fund application)', type: 'bid', is_active: false, snapshot: { total: 171500, lines: 31 }, locked_at: stamp(9, 17), locked_by: M.mara, created_by: M.mara, updated_by: M.mara, created_at: stamp(9, 17), updated_at: stamp(9, 17) },
  { id: fid('budgetVersion', 2), project_id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: 'Bid v2 (pre-production)', type: 'bid', is_active: true,  snapshot: { total: 186000, lines: 35 }, locked_at: null, locked_by: null, created_by: M.mara, updated_by: M.mara, created_at: stamp(30, 17), updated_at: stamp(38, 17) },
]

export const EXPENSES = [
  { id: fid('expense', 1), project_id: PROJECT_ID, workspace_id: WORKSPACE_ID, title: 'Camera package hire', description: 'Two-week hire, one body, three primes.', estimated_cost: 16800, actual_cost: 16800, purchase_date: day(36), asset_ids: [], phase_ids: [PHASE_ID.prod], task_ids: [], file_ids: [fid('file', 30)], created_by: M.mara, updated_by: M.mara, created_at: stamp(36, 12), updated_at: stamp(36, 12) },
  { id: fid('expense', 2), project_id: PROJECT_ID, workspace_id: WORKSPACE_ID, title: 'Set timber and paint', description: 'Lamp-room build materials.', estimated_cost: 4200, actual_cost: 3860, purchase_date: day(33), asset_ids: [ASSET_ID(7)], phase_ids: [PHASE_ID.pre], task_ids: [TASK_ID(16)], file_ids: [fid('file', 31)], created_by: M.jonah, updated_by: M.jonah, created_at: stamp(38, 12), updated_at: stamp(38, 12) },
  { id: fid('expense', 3), project_id: PROJECT_ID, workspace_id: WORKSPACE_ID, title: 'Compass props', description: 'Two brass compasses, one to weather.', estimated_cost: 260, actual_cost: 284, purchase_date: day(24), asset_ids: [ASSET_ID(10)], phase_ids: [PHASE_ID.pre], task_ids: [TASK_ID(24)], file_ids: [], created_by: M.jonah, updated_by: M.jonah, created_at: stamp(24, 12), updated_at: stamp(24, 12) },
]

export const PROJECT_RATE_OVERRIDES = [
  { id: fid('override', 1), project_id: PROJECT_ID, workspace_id: WORKSPACE_ID, role_slug: 'editor', member_id: M.sofia, day_rate: 500, week_rate: 2500, month_rate: 10000, wage: null, currency: 'USD', notes: 'Agreed short-film rate.', created_by: M.mara, updated_by: M.mara, created_at: stamp(20, 10), updated_at: stamp(20, 10) },
]
