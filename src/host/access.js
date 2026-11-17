/* 权限判定（纯函数）：HTTP 面板与工具层共用同一张成员名单、同一套档位。
   原来住在 index.js 里，被「index.js < 2700 行」的契约测试逼着要搬家；
   这些都是没有宿主依赖的纯逻辑，本来就该待在这里。 */
import { ACCESS_ROLE_LABEL, ADMIN_ROUTES, LEVEL_RANK, ROLE_LEVEL } from './domain.js'

/** 只是读、但走 POST 的入口（前端只有一处 api() 封装，固定发 POST）。 */
export const READ_ONLY_POST_ROUTES = new Set(['/task/comments', '/task/parts', '/cases', '/team/memory', '/suite/list'])

/** 这个请求需要什么权限：读、写、还是管理员。 */
export function accessLevelFor(route, method) {
  if (method !== 'POST') return 'read'
  return ADMIN_ROUTES.has(route) ? 'admin' : 'write'
}

/** 权限判定，返回 null 表示放行，否则返回给人看的原因。
 *  `trusted` = 这个 operator 是服务端认定的身份（登录会话 / 本地超管）还是请求头自报的。
 *  只有可信身份才认「超级管理员」豁免，否则加个 x-studio-user 头就能过全部写权限；
 *  名字也必须是完全相同的匹配，不能用后缀（叫「小admin」不该匹配到 admin）。 */
export function checkAccess(config, operator, level, trusted = false) {
  const access = config?.access ?? { enabled: false, members: [] }
  if (access.enabled !== true) return null
  const raw = String(operator ?? '').trim()
  if (trusted === true && raw.includes('超级管理员')) return null
  const name = raw.toLowerCase()
  const member = access.members.find((item) => {
    const ids = [item.id, item.name].map((value) => String(value ?? '').trim().toLowerCase()).filter(Boolean)
    return ids.includes(name)
  })
  if (member === undefined) {
    // 名单外的人还能看（否则名字对不上就直接进不去），但一个写操作都不许做。
    if (level === 'read') return null
    return `「${operator}」不在成员名单里：让管理员到「设置 → 权限与审计」把你加进去，或用页头的「我是…」换个名字`
  }
  const rank = ROLE_LEVEL[member.role] ?? 0
  if ((LEVEL_RANK[level] ?? 0) > rank) {
    const need = level === 'admin' ? '管理员' : '成员'
    return `「${operator}」是${ACCESS_ROLE_LABEL[member.role] ?? member.role}，这一步需要${need}权限`
  }
  return null
}
