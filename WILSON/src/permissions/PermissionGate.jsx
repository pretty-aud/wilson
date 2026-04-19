// =============================================================================
// PermissionGate — drop-in replacement for `{isAdmin && <X />}` patterns.
//
// Usage:
//   <PermissionGate requires="member.invite">
//     <Button>Invite member</Button>
//   </PermissionGate>
//
//   <PermissionGate requires="rate_card.edit" fallback={<ReadOnlyRateCard />}>
//     <EditableRateCard />
//   </PermissionGate>
//
//   <PermissionGate requiresPlatformOperator>
//     <PlatformConsoleLink />
//   </PermissionGate>
//
// Props:
//   requires                 action string (must exist in roleMatrix.ACTIONS)
//   requiresPlatformOperator boolean — show only to platform operators
//   fallback                 element to render when the check fails (default: null)
//   children                 element to render when the check passes
//
// Exactly one of `requires` / `requiresPlatformOperator` must be provided.
// Supplying both or neither logs a dev warning and renders nothing.
//
// While the permissions hook is still resolving the first session (ready=false)
// we render the fallback rather than flashing privileged UI. This matters
// briefly at cold boot.
// =============================================================================

import { usePermissions } from './usePermissions'

export default function PermissionGate({
  requires,
  requiresPlatformOperator,
  fallback = null,
  children,
}) {
  const perms = usePermissions()

  if (!!requires === !!requiresPlatformOperator) {
    if (import.meta.env?.DEV) {
      console.warn('[PermissionGate] exactly one of `requires` or `requiresPlatformOperator` must be set.')
    }
    return fallback
  }

  if (!perms.ready) return fallback

  if (requiresPlatformOperator) {
    return perms.isPlatformOperator ? children : fallback
  }

  return perms.can(requires) ? children : fallback
}
