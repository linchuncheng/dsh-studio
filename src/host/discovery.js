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

const BACKEND_NO = /^(没有|无|不需要|不涉及|纯前端|不做)/i

/**
 * 反向体检：澄清里说「没有服务端」，功能点却要建表 / 写接口 / 加鉴权。
 * 和 backendCoverageWarning 对称——一个防"少做"，一个防"说了不做却写了要做"。只提示不拦。
 */
export function frontendOnlyWarning(requirement) {
  const answer = String(requirement?.discovery?.server ?? '').trim()
  if (answer === '' || BACKEND_NO.test(answer) !== true) return null
  const points = Array.isArray(requirement?.points) ? requirement.points : []
  const hit = points.find(point => BACKEND_HINT.test(String(point?.title ?? '') + ' ' + String(point?.description ?? '')))
  if (hit === undefined) return null
  return '澄清里说没有服务端，但功能点「' + String(hit.title ?? '').slice(0, 24) + '」要动接口 / 数据表：要么补上后端，要么把这条改成前端能做的范围'
}

/**
 * 功能点太虚：没有验收标准（acceptance 为空），拆出来的卡也没法长成用例。
 * 关键词体检查不出这种"写得模糊"的情况，只能从结构上判断。只提示不拦。
 */
export function vaguePointsWarning(requirement) {
  const points = Array.isArray(requirement?.points) ? requirement.points : []
  if (points.length === 0) return null
  const vague = points.filter(point => !Array.isArray(point?.acceptance) || point.acceptance.length === 0)
  if (vague.length === 0) return null
  const names = vague.slice(0, 3).map(point => String(point?.title ?? '').slice(0, 20)).join('、')
  return '有 ' + vague.length + ' 个功能点没有验收标准（' + names + (vague.length > 3 ? ' 等' : '') + '）：写清楚怎么算做完，才能长成用例'
}

/** 还缺哪几项澄清；空了才允许拆卡。 */
export function discoveryGaps(requirement) {
  const discovery = requirement?.discovery ?? {}
  return DISCOVERY_FIELDS
    .filter(([key]) => String(discovery[key] ?? '').trim() === '')
    .map(([, label]) => label)
}
