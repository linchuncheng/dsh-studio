// 绕过准出的记录：以前只写进 history 的一句话，需求准出看不到。
/** 绕过准出的清单：卡级 task.override + 需求级 requirement.override。
 *
 *  为什么单独拎出来：override 是「门禁说不行，人/agent 硬推」的逃生舱，它本身合法，
 *  但如果没人统计，就等于「绕过多少次、谁绕的、为什么」，平台自己都不知道。
 *  这里只读已有事实，不加埋点。 */
export function overrideSummary(state, options = {}) {
  const since = Number(options?.since) || 0
  const cards = []
  for (const task of state?.tasks ?? []) {
    const entry = task?.override
    if (entry === null || entry === undefined || typeof entry !== 'object') continue
    const at = Number(entry.at) || 0
    if (at < since) continue
    cards.push({
      kind: 'card',
      id: String(task.id ?? ''),
      code: String(task.code ?? ''),
      title: String(task.title ?? ''),
      status: String(task.status ?? ''),
      by: String(entry.by ?? ''),
      at,
      reason: String(entry.reason ?? ''),
    })
  }
  const requirements = []
  for (const requirement of state?.requirements ?? []) {
    const entry = requirement?.override
    if (entry === null || entry === undefined || typeof entry !== 'object') continue
    const at = Number(entry.at) || 0
    if (at < since) continue
    requirements.push({
      kind: 'requirement',
      id: String(requirement.id ?? ''),
      code: String(requirement.code ?? ''),
      title: String(requirement.title ?? ''),
      status: String(requirement.status ?? ''),
      by: String(entry.by ?? ''),
      at,
      reason: String(entry.reason ?? ''),
    })
  }
  const list = [...cards, ...requirements].sort((a, b) => b.at - a.at)
  const counts = new Map()
  for (const item of list) {
    const key = item.by.trim() === '' ? '（没记签名人）' : item.by
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return {
    total: list.length,
    cards: cards.length,
    requirements: requirements.length,
    noReason: list.filter(item => item.reason.trim() === '').length,
    byPerson: [...counts.entries()].map(([by, count]) => ({ by, count })).sort((a, b) => b.count - a.count),
    list: list.slice(0, 50),
  }
}

/** 结构化 override：谁、什么时候、为什么跳过了门禁。null 表示清掉记录。 */
export function sanitizeOverride(raw) {
  if (raw === null) return null
  if (raw === undefined || typeof raw !== 'object') return undefined
  return {
    by: String(raw.by ?? '').trim().slice(0, 60),
    at: Number(raw.at) || Date.now(),
    reason: String(raw.reason ?? '').trim().slice(0, 300),
  }
}
