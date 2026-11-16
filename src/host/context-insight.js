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

/** 字符 → token 的粗略换算（中英混排约 3 字符/token）；只用来排序和看比例。 */
export function charsToTokens(chars) {
  return Math.round(Number(chars ?? 0) / 3)
}

/**
 * 单次会话的上下文构成：峰值窗口 + 四类内容的体积占比。
 * 系统提示来自平台自己的配置（日志里没有），其余来自日志各类事件的文本体积。
 */
export function breakdownContext(session, promptChars) {
  const volume = session?.volume ?? {}
  const parts = [
    { key: 'prompt', label: '系统提示（平台拼的）', chars: Number(promptChars ?? 0) },
    { key: 'tool', label: '工具调用与结果', chars: Number(volume.tool ?? 0) },
    { key: 'assistant', label: '助手输出', chars: Number(volume.assistant ?? 0) },
    { key: 'user', label: '输入与人机往返', chars: Number(volume.user ?? 0) },
    { key: 'other', label: '事件与会话元数据', chars: Number(volume.other ?? 0) },
  ]
  const total = parts.reduce((sum, part) => sum + part.chars, 0)
  const peak = contextOfUsage(session?.usage).peak
  return {
    peak,
    peakTokens: peak,
    chars: total,
    approxTokens: charsToTokens(total),
    parts: parts.map(part => ({ ...part, percent: total === 0 ? 0 : Math.round((part.chars / total) * 100) })),
    turns: Number(session?.counts?.turns ?? 0),
    toolCalls: Number(session?.counts?.toolCalls ?? 0),
    retries: Number(session?.counts?.retries ?? 0),
    at: Number(session?.at ?? 0),
    taskId: String(session?.taskId ?? ''),
  }
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
