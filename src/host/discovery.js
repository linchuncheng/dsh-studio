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

/** 还缺哪几项澄清；空了才允许拆卡。 */
export function discoveryGaps(requirement) {
  const discovery = requirement?.discovery ?? {}
  return DISCOVERY_FIELDS
    .filter(([key]) => String(discovery[key] ?? '').trim() === '')
    .map(([, label]) => label)
}
