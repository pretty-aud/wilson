// =============================================================================
// roleMatrix — single source of truth for app-level role capabilities.
//
// The matrix maps actions (string keys like 'member.invite') to a set of
// roles that are allowed to perform them. Consumers call can(role, action)
// and receive a boolean. This is the ONLY place where an action string maps
// to a role list; UI and server code both read from here.
//
// Roles (app-level, from JWT app_metadata.app_role):
//   'admin'    — company admin; full workspace management
//   'manager'  — manages projects + people within assigned scope
//   'user'     — regular contributor
//
// The 'platform_operator' flag (separate JWT claim) is orthogonal to these
// three; platform_operator checks happen via isPlatformOperator() from the
// usePermissions hook, NOT through this matrix. Matrix actions are scoped
// per-workspace.
//
// Project-level roles (Manager / Reviewer / Member on a specific project)
// are a Session 6 concern and live in a separate matrix.
//
// Adding a new action: add a key to ACTIONS below (keep it alphabetised),
// add it to the role sets that should be allowed, and mirror it in the
// EXPECTED table in roleMatrix.test.js — the suite fails on any mismatch,
// including forgotten test entries.
// =============================================================================

export const ROLES = Object.freeze(['admin', 'manager', 'user'])

// Every action recognised by the permission system. Unrecognised actions
// passed to can() throw at development time (dev-build) and return false
// in production. Keep this list alphabetised.
export const ACTIONS = Object.freeze([
  'member.invite',
  'member.profile.edit_others',
  'member.remove',
  'member.role.change',
  'project.create',
  'project.delete',
  'rabbit.history.view',
  'rate_card.edit',
  'rate_card.view',
  'workspace.settings.read',
  'workspace.settings.write',
])

// role -> Set<action>. Built once from a human-readable table.
const ALLOW = {
  admin:   new Set([
    'member.invite',
    'member.profile.edit_others',
    'member.remove',
    'member.role.change',
    'project.create',
    'project.delete',
    'rabbit.history.view',
    'rate_card.edit',
    'rate_card.view',
    'workspace.settings.read',
    'workspace.settings.write',
  ]),
  manager: new Set([
    'member.profile.edit_others',
    'project.create',
    'rabbit.history.view',
    'rate_card.view',
    'workspace.settings.read',
  ]),
  user:    new Set([
    'workspace.settings.read',
  ]),
}

/**
 * Returns true if the given app-level role is permitted to perform the
 * given action. Returns false for unknown roles or unknown actions.
 *
 * @param {'admin'|'manager'|'user'|null|undefined} role
 * @param {string} action
 * @returns {boolean}
 */
export function can(role, action) {
  if (!role || !ACTIONS.includes(action)) {
    if (import.meta.env?.DEV && action && !ACTIONS.includes(action)) {
      console.warn(`[permissions] unknown action "${action}". Add it to ACTIONS in roleMatrix.js.`)
    }
    return false
  }
  const set = ALLOW[role]
  return set ? set.has(action) : false
}

/**
 * Returns true if the role is at or above the given level in the admin
 * hierarchy (admin > manager > user). Convenience for components that
 * just want "is this user at least a manager" without checking a specific
 * capability.
 */
export function atLeast(role, level) {
  const order = { user: 0, manager: 1, admin: 2 }
  return (order[role] ?? -1) >= (order[level] ?? 99)
}
