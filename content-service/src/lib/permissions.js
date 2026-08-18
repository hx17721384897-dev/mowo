export const STAFF_ROLE = Object.freeze({
  OWNER: 'OWNER',
  CUSTOMER_SERVICE: 'CUSTOMER_SERVICE',
  PRODUCTION: 'PRODUCTION',
  COLLAB_OPS: 'COLLAB_OPS'
})

export const PERMISSION = Object.freeze({
  ORDER_SUPPORT: 'ORDER_SUPPORT',
  CONTACT: 'CONTACT',
  CATALOG: 'CATALOG',
  PRODUCTION: 'PRODUCTION',
  COLLAB: 'COLLAB',
  USERS_READ: 'USERS_READ',
  USERS_BAN: 'USERS_BAN',
  ACCOUNT_DELETIONS_READ: 'ACCOUNT_DELETIONS_READ',
  ACCOUNT_DELETIONS_MANAGE: 'ACCOUNT_DELETIONS_MANAGE',
  STAFF_MANAGE: 'STAFF_MANAGE',
  SECURITY_LOGS: 'SECURITY_LOGS'
})

const ROLE_PERMISSIONS = Object.freeze({
  [STAFF_ROLE.OWNER]: new Set(['*']),
  [STAFF_ROLE.CUSTOMER_SERVICE]: new Set([
    PERMISSION.ORDER_SUPPORT,
    PERMISSION.CONTACT,
    PERMISSION.CATALOG,
    PERMISSION.USERS_READ,
    PERMISSION.USERS_BAN,
    PERMISSION.ACCOUNT_DELETIONS_READ
  ]),
  [STAFF_ROLE.PRODUCTION]: new Set([PERMISSION.PRODUCTION]),
  [STAFF_ROLE.COLLAB_OPS]: new Set([PERMISSION.COLLAB])
})

export function effectiveStaffRole(user) {
  if (user?.staffRole && ROLE_PERMISSIONS[user.staffRole]) return user.staffRole
  if (user?.role >= 3) return STAFF_ROLE.OWNER
  if (user?.role === 2) return STAFF_ROLE.CUSTOMER_SERVICE
  if (user?.role === 1) return STAFF_ROLE.PRODUCTION
  return null
}

export function hasPermission(user, permission) {
  const permissions = ROLE_PERMISSIONS[effectiveStaffRole(user)]
  return !!permissions && (permissions.has('*') || permissions.has(permission))
}

export function roleNumberForStaffRole(staffRole) {
  if (staffRole === STAFF_ROLE.OWNER) return 3
  if ([STAFF_ROLE.CUSTOMER_SERVICE, STAFF_ROLE.PRODUCTION, STAFF_ROLE.COLLAB_OPS].includes(staffRole)) return 2
  return 0
}

export function requiredPermissionForRequest(method, rawUrl) {
  const path = String(rawUrl || '').split('?')[0]
  const verb = String(method || 'GET').toUpperCase()

  if (path === '/api/admin/logs') return PERMISSION.SECURITY_LOGS
  if (path.startsWith('/api/admin/account-deletions')) {
    return verb === 'GET' ? PERMISSION.ACCOUNT_DELETIONS_READ : PERMISSION.ACCOUNT_DELETIONS_MANAGE
  }
  if (/^\/api\/admin\/users\/[^/]+\/role$/.test(path)) return PERMISSION.STAFF_MANAGE
  if (/^\/api\/admin\/users\/[^/]+\/ban$/.test(path)) return PERMISSION.USERS_BAN
  if (path === '/api/admin/users') return PERMISSION.USERS_READ
  if (path.startsWith('/api/admin/contact')) return PERMISSION.CONTACT

  if (
    path.startsWith('/api/admin/collab') ||
    path.startsWith('/api/admin/contracts') ||
    path.startsWith('/api/admin/revenue') ||
    path.startsWith('/api/admin/settlement') ||
    path.startsWith('/api/admin/bull') ||
    path.startsWith('/api/admin/links') ||
    path.startsWith('/api/certify/review')
  ) return PERMISSION.COLLAB

  if (
    path.startsWith('/api/inventory') ||
    path.startsWith('/api/materials') ||
    path.startsWith('/api/frame-packs') ||
    path.startsWith('/api/admin/production') ||
    path.startsWith('/api/admin/batches') ||
    path.startsWith('/api/admin/scan')
    || path.startsWith('/api/admin/import')
    || path.startsWith('/api/admin/auth-codes')
  ) return PERMISSION.PRODUCTION

  if (
    path.startsWith('/api/admin/sku-mapping') ||
    path.startsWith('/api/machine-models/admin') ||
    (path.startsWith('/api/machine-models') && verb !== 'GET')
  ) return PERMISSION.CATALOG

  if (path.startsWith('/api/admin')) return PERMISSION.ORDER_SUPPORT
  return null
}

export function staffRoleLabel(staffRole) {
  return ({
    [STAFF_ROLE.OWNER]: '负责人',
    [STAFF_ROLE.CUSTOMER_SERVICE]: '运营客服',
    [STAFF_ROLE.PRODUCTION]: '生产人员',
    [STAFF_ROLE.COLLAB_OPS]: '合作运营'
  })[staffRole] || '普通用户'
}
