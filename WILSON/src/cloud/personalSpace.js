// =============================================================================
// personalSpace — MO1 (migration 0110, MOTH_DESIGN §2.2 PS-1): what a personal
// space is, for the client. A personal space is an ordinary projects row with
// personal_owner_id set (the database's own test is that column), or, on the
// signed-out desktop, the one bundle at {userData}/personal-space, whose project
// says `personal: true`.
//
// It is kept out of every ordinary list (listProjects, the Team page, Workspace
// Takeout) and reached only from Files, by its owner and by a workspace admin.
// =============================================================================

// projects.personal_owner_id arrives with 0110 and the client ships first, so
// the column is PROBED once per session rather than assumed (naming a column
// the database lacks fails the WHOLE request).
//   true  — the column is here
//   false — this database has no personal spaces yet
//   null  — not now (a network failure says nothing about the column); asked
//           again next time. A reader that must keep personal spaces out fails
//           closed on it instead of reading as if there were none.
let columnKnown = null
export async function personalSpacesAvailable(client) {
  if (columnKnown !== null) return columnKnown
  const { error } = await client.from('projects').select('personal_owner_id').limit(1)
  if (!error) { columnKnown = true; return true }
  if (error.code === '42703' || /personal_owner_id/.test(error.message || '')) {
    columnKnown = false
    return false
  }
  return null
}

/** Whether a project row (or a row's embedded project) is a personal space. */
export function isPersonalSpace(row) {
  return row?.personal_owner_id != null || row?.personal === true
}

/**
 * What Files calls a personal space: 'My personal space' for its owner, and for
 * an admin the owner's name, with what is known about them. Until the members
 * have loaded (`membersKnown` false) nobody is called a former member.
 */
export function personalSpaceLabel(row, { me = null, members = [], membersKnown = false } = {}) {
  if (row?.personal === true) return 'Personal space on this computer'
  if (row?.personal_owner_id === me) return 'My personal space'
  const owner = members.find(m => m.user_id === row?.personal_owner_id)
  if (!owner) return membersKnown ? 'Personal space · (former member)' : 'Personal space'
  const name = owner.display_name || owner.username || owner.email || 'Unnamed'
  return `Personal space · ${name}${owner.is_active === false ? ' (inactive)' : ''}`
}
