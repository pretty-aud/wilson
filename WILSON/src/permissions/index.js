// Barrel re-exports so call sites can `import { PermissionGate, usePermissions, can } from 'src/permissions'`.
export { default as PermissionGate } from './PermissionGate'
export { usePermissions } from './usePermissions'
export { can, atLeast, ROLES, ACTIONS } from './roleMatrix'
