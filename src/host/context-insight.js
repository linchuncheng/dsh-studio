// 每个专家会话的「上下文洞察」：窗口占用峰值、回合数、工具调用、模型重试。
// 数据来自会话日志：usage.cacheReadTokens 基本就是这一轮送进模型的上下文前缀，按引擎口径取峰值。
// 纯函数，读盘在 session-usage.js。

/** 一轮的上下文规模：输入 + 缓存命中（缓存命中也是真的喂进去了）。 */
export function contextOfUsage(usage) {
  let peak = 0
  let model = ''
  for (const item of Array.isArray(usage) ? usage : []) {
    const size = Number(item.input ?? 0) + Number(item.cacheRead ?? 0)
    if (size > peak) peak = size
    const name = String(item.model ?? '').trim()
    if (name !== '') model = name
  }
  return { peak, model, calls: Array.isArray(usage) ? usage.length : 0 }
}

/** 按专家汇总；sessions 每项 { expert, taskId, at, usage, counts }。 */
export function aggregateContext(sessions) {
  const byExpert = new Map()
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const key = String(session.expert ?? '').trim() || '(未知)'
    const stats = contextOfUsage(session.usage)
    const counts = session.counts ?? {}
    const row = byExpert.get(key) ?? { expert: key, sessions: 0, peak: 0, calls: 0, turns: 0, toolCalls: 0, retries: 0, lastAt: 0, model: '' }
    row.sessions += 1
    row.peak = Math.max(row.peak, stats.peak)
    row.calls += stats.calls
    row.turns += Number(counts.turns ?? 0)
    row.toolCalls += Number(counts.toolCalls ?? 0)
    row.retries += Number(counts.retries ?? 0)
    row.lastAt = Math.max(row.lastAt, Number(session.at ?? 0))
    if (stats.model !== '') row.model = stats.model
    byExpert.set(key, row)
  }
  const rows = [...byExpert.values()].sort((a, b) => b.peak - a.peak)
  const totals = {
    experts: rows.length,
    sessions: rows.reduce((sum, row) => sum + row.sessions, 0),
    peak: rows.reduce((max, row) => Math.max(max, row.peak), 0),
    toolCalls: rows.reduce((sum, row) => sum + row.toolCalls, 0),
    retries: rows.reduce((sum, row) => sum + row.retries, 0),
  }
  return { rows, totals }
}
