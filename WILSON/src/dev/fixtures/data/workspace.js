// =============================================================================
// workspace.js — one fake workspace, eight fake people.
//
// "Lantern & Ash Pictures" makes short films. The reviewer signs in as Mara
// Okonkwo, the producer and a workspace admin, so every page opens the way an
// admin sees it and the Dashboard has her assignments. Names, addresses and
// the studio are invented; the domain is `.example`, which cannot resolve.
//
// Row shape = what the workspace_directory() RPC returns (useWorkspaceMembers'
// header), plus the 0059 `is_full_time` flag and the 0020 rate-card grants.
// =============================================================================

import { fid, stamp } from '../ids'
import { avatar, tintFor } from '../svg'

export const WORKSPACE_ID = fid('workspace', 1)

export const WORKSPACE = {
  id: WORKSPACE_ID,
  name: 'Lantern & Ash Pictures',
  slug: 'lantern-ash',
  created_at: stamp(-120),
}

const PEOPLE = [
  // [n, display_name, username, pronouns, title, department, app_role, is_full_time]
  [1, 'Mara Okonkwo',   'mara.okonkwo',   'she/her',   'Producer',                 'Production', 'admin',   true],
  [2, 'Theo Lindqvist', 'theo.lindqvist', 'he/him',    'Director',                 'Direction',  'manager', true],
  [3, 'Priya Raman',    'priya.raman',    'she/her',   'Director of Photography',  'Camera',     'user',    false],
  [4, 'Jonah Beck',     'jonah.beck',     'he/him',    'Production Designer',      'Art',        'user',    true],
  [5, 'Sofia Aldana',   'sofia.aldana',   'she/her',   'Editor',                   'Post',       'user',    true],
  [6, 'Kenji Morimoto', 'kenji.morimoto', 'he/him',    'VFX Supervisor',           'VFX',        'manager', true],
  [7, 'Lena Fischer',   'lena.fischer',   'they/them', 'Sound Designer',           'Sound',      'user',    false],
  [8, 'Dev Patel',      'dev.patel',      'he/him',    'Production Coordinator',   'Production', 'user',    true],
]

function initials(name) {
  return name.split(/\s+/).map(w => w[0]).join('').toUpperCase()
}

export const MEMBERS = PEOPLE.map(([n, display_name, username, pronouns, title, department, app_role, is_full_time], i) => ({
  workspace_id: WORKSPACE_ID,
  user_id: fid('member', n),
  app_role,
  username,
  display_name,
  pronouns,
  title,
  department,
  avatar_url: avatar({ initials: initials(display_name), tint: tintFor(i) }),
  is_active: true,
  onboarded_at: stamp(-90 + i * 3, 9),
  created_at: stamp(-100 + i * 3, 9),
  email: `${username}@lanternash.example`,
  is_full_time,
  grant_rate_card_view: false,
  grant_rate_card_edit: false,
}))

export const MEMBER_ID = Object.fromEntries(PEOPLE.map(([n, , username]) => [username.split('.')[0], fid('member', n)]))
// MEMBER_ID.mara, .theo, .priya, .jonah, .sofia, .kenji, .lena, .dev

/** The reviewer's identity: Mara, admin. What usePermissions hands out. */
export const FIXTURE_USER = MEMBERS[0]

export const PERMISSIONS = Object.freeze({
  userId: FIXTURE_USER.user_id,
  role: 'admin',
  workspaceId: WORKSPACE_ID,
  workspaceIds: [WORKSPACE_ID],
  isPlatformOperator: false,
})

export const PROFILE = Object.freeze({
  email: FIXTURE_USER.email,
})
