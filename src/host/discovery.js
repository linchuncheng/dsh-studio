// 需求澄清的必答项：不问清楚就会出现「管理后台只交付了前端」这类返工。
// 纯函数，拆卡门禁和界面提示共用。

export const DISCOVERY_FIELDS = [
  ['server', '有没有服务端？数据存在哪、刷新会不会丢'],
  ['auth', '鉴权谁做：前端隐藏按钮，还是服务端拒绝'],
  ['boundary', '交付边界：只交付界面，还是点开就能用'],
]

export function sanitizeDiscovery(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    server: String(input.server ?? '').trim().slice(0, 300),
    auth: String(input.auth ?? '').trim().slice(0, 300),
    boundary: String(input.boundary ?? '').trim().slice(0, 300),
  }
}

const BACKEND_HINT = /接口|api|数据库|数据表|建表|后端|服务端|鉴权|sqlite|postgres|持久化|存储/i
const BACKEND_YES = /^(有|yes|是|需要|要)/i

/**
 * 说了「有服务端」，功能点里却没有一条跟后端有关 —— 大概率又要只交付一半。
 * 只提示、不拦：有的需求后端在别的仓库或别的需求里，硬拦会误伤。
 */
export function backendCoverageWarning(requirement) {
  const answer = String(requirement?.discovery?.server ?? '').trim()
  if (answer === '' || BACKEND_YES.test(answer) !== true) return null
  const points = Array.isArray(requirement?.points) ? requirement.points : []
  const hit = points.some(point => BACKEND_HINT.test(String(point?.title ?? '') + ' ' + String(point?.description ?? '')))
  if (hit) return null
  return '澄清里说有服务端，但功能点没有一条讲接口 / 数据表 / 鉴权：后端在哪一块交付？'
}

/** 还缺哪几项澄清；空了才允许拆卡。 */
export function discoveryGaps(requirement) {
  const discovery = requirement?.discovery ?? {}
  return DISCOVERY_FIELDS
    .filter(([key]) => String(discovery[key] ?? '').trim() === '')
    .map(([, label]) => label)
}
