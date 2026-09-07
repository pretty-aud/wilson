// =============================================================================
// useProjectAccess — Session 29. One place that assembles the project-permission
// context, so no call site has to remember the four fields again.
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
//   can(action)  — boolean, for the other three project actions
//   reasonFor(a) — string|null, the matching explanation
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

  return useMemo(() => {
    const gateCtx = { appRole: role, projectRole, isStaffed, ready }
    return {
      gateCtx,
      canWrite: canOnProject(gateCtx, 'project.entity.write'),
      writeReason: projectActionDeniedReason(gateCtx, 'project.entity.write'),
      can: (action) => canOnProject(gateCtx, action),
      reasonFor: (action) => projectActionDeniedReason(gateCtx, action),
    }
  }, [role, projectRole, isStaffed, ready])
}
