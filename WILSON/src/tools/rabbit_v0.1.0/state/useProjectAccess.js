// =============================================================================
// useProjectAccess — Session 29. One place that assembles the project-permission
// context, so no call site has to remember its fields again (four until S3a
// added `noRoles`).
//
// Before this, every view rebuilt the same object by hand:
//
//   canOnProject({ appRole: role, projectRole: ctx?.myProjectRole,
//                  isStaffed: ctx?.projectIsStaffed, ready: permsReady },
//                'project.entity.write')
//
// …and `TimelineView.jsx` never built it at all, which is the whole reason S29
// exists: it offered task creation to users the database would always refuse,
// and the refusal reached them as a raw Postgres policy string.
//
// 🚨 `ready` is the field that gets forgotten, and forgetting it is silent.
// It defaults to TRUE inside canOnProject, so omitting it turns "permissions
// are still loading" into "denied" — the control disappears (or, now, greys
// out) for someone fully authorised, and if getSession() never settles it never
// comes back. That is the S23 bug, and it cost four sessions to find. Assembling
// the context in exactly one place is how it stops being possible to forget.
//
// Returns:
//   canWrite     — boolean, project.entity.write (the common case, pre-computed)
//   writeReason  — string|null, why not (null when allowed)
//   can(action)  — boolean, for the other project actions (the shot-list pair
//                  included: project.shotlist.write / project.shotlist.activate)
//   reasonFor(a) — string|null, the matching explanation
//
// `noRoles` (post-overhaul S3a, 0084 / D8): the Local Server has no roles, and
// its shot-list routes check no seat, so set-active and archive are labels
// there, always allowed. Without this flag a signed-out Local Server user
// (appRole null, no roster) would see those two controls greyed for a rule
// nothing below enforces. canOnProject applies it to the shot-list actions
// only; every older action resolves exactly as before.
//
// Pair the reason with <GatedAction> to render a denied control greyed and
// self-explaining rather than absent. The DATABASE is the real gate; all of this
// exists so the user is told, not stopped.
// =============================================================================

import { useMemo } from 'react'
import { useRabbit } from './RabbitProvider'
import { usePermissions } from '../../../permissions/usePermissions'
import { canOnProject, projectActionDeniedReason } from '../../../permissions/projectRoleMatrix'

export function useProjectAccess() {
  const ctx = useRabbit()
  const { role, ready } = usePermissions()

  const projectRole = ctx?.myProjectRole ?? null
  const isStaffed = ctx?.projectIsStaffed ?? false
  const noRoles = ctx?.adapterMode === 'local_server'

  return useMemo(() => {
    const gateCtx = { appRole: role, projectRole, isStaffed, ready, noRoles }
    return {
      gateCtx,
      canWrite: canOnProject(gateCtx, 'project.entity.write'),
      writeReason: projectActionDeniedReason(gateCtx, 'project.entity.write'),
      can: (action) => canOnProject(gateCtx, action),
      reasonFor: (action) => projectActionDeniedReason(gateCtx, action),
    }
  }, [role, projectRole, isStaffed, ready, noRoles])
}
