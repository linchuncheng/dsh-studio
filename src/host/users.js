/* 成员（本地/LDAP 登录过的人）的数据形状。从 domain.js 抬出来，给 2000 行闸门留余量。 */

export const ACCESS_ROLES = ['admin', 'member', 'viewer']

/** 登录过的人：最多 500 条，id 统一小写，按最近登录排序。 */
export function sanitizeUsers(raw) {
  const list = Array.isArray(raw) ? raw : []
  const out = []
  const seen = new Set()
  for (const item of list) {
    if (out.length >= 500) break
    if (item === null || typeof item !== 'object') continue
    const id = String(item.id ?? item.name ?? '').trim().toLowerCase().slice(0, 80)
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      name: String(item.name ?? id).trim().slice(0, 80) || id,
      mail: String(item.mail ?? '').trim().slice(0, 160),
      dept: String(item.dept ?? '').trim().slice(0, 120),
      dn: String(item.dn ?? '').trim().slice(0, 400),
      role: ACCESS_ROLES.includes(item.role) ? item.role : 'member',
      source: item.source === 'ldap' ? 'ldap' : 'local',
      firstLoginAt: Number(item.firstLoginAt) || 0,
      lastLoginAt: Number(item.lastLoginAt) || 0,
      loginCount: Math.max(0, Math.round(Number(item.loginCount) || 0)),
      lastIp: String(item.lastIp ?? '').trim().slice(0, 60),
    })
  }
  return out.sort((a, b) => b.lastLoginAt - a.lastLoginAt)
}
