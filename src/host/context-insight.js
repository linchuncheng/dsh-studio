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

/**
 * 每一轮的上下文规模（input + cacheRead），用来画上升曲线：
 * 看它在第几步顶到天花板、压缩之后有没有掉下来。
 * usage 本来就是按消息顺序排的，直接取；点太多时按等距抽样。
 */
export function trendOfUsage(usage, maxPoints = 48) {
  const list = Array.isArray(usage) ? usage : []
  const points = list.map(item => Number(item.input ?? 0) + Number(item.cacheRead ?? 0))
  if (points.length <= maxPoints) return points
  const step = points.length / maxPoints
  return Array.from({ length: maxPoints }, (_, index) => points[Math.min(points.length - 1, Math.round(index * step))])
}

/**
 * 曲线掉下来的地方就是压缩点：某一轮上下文比上一轮少了 ratio 以上，
 * 说明引擎把历史裁掉了。返回 [{ index, from, to, drop }]，index 是掉下去那一轮。
 */
export function contextDrops(trend, ratio = 0.7) {
  const list = Array.isArray(trend) ? trend : []
  const drops = []
  for (let index = 1; index < list.length; index += 1) {
    const from = Number(list[index - 1] ?? 0)
    const to = Number(list[index] ?? 0)
    if (from <= 0) continue
    if (to >= from * ratio) continue
    drops.push({ index, from, to, drop: Math.round(((from - to) / from) * 100) })
  }
  return drops
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
    window: Number(session?.counts?.contextWindow ?? 0),
    percent: Number(session?.counts?.contextWindow ?? 0) > 0 ? Math.round((peak / Number(session.counts.contextWindow)) * 100) : 0,
    trend: trendOfUsage(session?.usage),
    drops: contextDrops(trendOfUsage(session?.usage)),
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

/** 工具结果占上下文的比例上限：超过就提示「这次会话是工具喂胖的」。 */
export const TOOL_HEAVY_THRESHOLD = 60

/**
 * 工具结果是否吃掉了上下文：按最近一次会话的构成算，超阈值返回一句人话，否则 null。
 * 只提示不改任何数据——精简工具输出是人的决定。
 */
export function toolHeavyWarning(breakdown, threshold = TOOL_HEAVY_THRESHOLD) {
  const parts = Array.isArray(breakdown?.parts) ? breakdown.parts : []
  const tool = parts.find(part => part.key === 'tool')
  if (tool === undefined) return null
  if (tool.percent < threshold) return null
  return '最近一次会话里工具结果占了 ' + tool.percent + '%（' + Math.round(tool.chars / 1000) + 'k 字），上下文主要是被工具输出撑满的'
}

/** 按专家汇总；sessions 每项 { expert, taskId, at, usage, counts }。 */
export function aggregateContext(sessions, threshold = TOOL_HEAVY_THRESHOLD) {
  const byExpert = new Map()
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const key = String(session.expert ?? '').trim() || '(未知)'
    const stats = contextOfUsage(session.usage)
    const counts = session.counts ?? {}
    const row = byExpert.get(key) ?? { expert: key, sessions: 0, peak: 0, calls: 0, turns: 0, toolCalls: 0, retries: 0, lastAt: 0, model: '', toolShare: 0, latestTaskId: '', alert: '', window: 0, percent: 0 }
    row.sessions += 1
    row.peak = Math.max(row.peak, stats.peak)
    row.calls += stats.calls
    row.turns += Number(counts.turns ?? 0)
    row.toolCalls += Number(counts.toolCalls ?? 0)
    row.retries += Number(counts.retries ?? 0)
    const at = Number(session.at ?? 0)
    // 最近一次会话的构成决定「是不是工具喂胖的」；只留最新那条
    if (at >= row.lastAt) {
      const breakdown = breakdownContext(session, 0)
      const tool = (breakdown.parts ?? []).find(part => part.key === 'tool')
      row.toolShare = tool === undefined ? 0 : tool.percent
      row.latestTaskId = String(session.taskId ?? '')
      row.alert = toolHeavyWarning(breakdown, threshold) ?? ''
    }
    const window = Number(counts.contextWindow ?? 0)
    if (window > row.window) row.window = window
    row.lastAt = Math.max(row.lastAt, at)
    const modelName = String(counts.model ?? '')
    if (stats.model !== '') row.model = stats.model
    if (modelName !== '') row.model = modelName
    // 真实占用率：窗口来自 request/context，峰值来自 usage
    row.percent = row.window > 0 ? Math.round((row.peak / row.window) * 100) : 0
    byExpert.set(key, row)
  }
  const rows = [...byExpert.values()].sort((a, b) => b.peak - a.peak)
  const totals = {
    experts: rows.length,
    sessions: rows.reduce((sum, row) => sum + row.sessions, 0),
    peak: rows.reduce((max, row) => Math.max(max, row.peak), 0),
    toolCalls: rows.reduce((sum, row) => sum + row.toolCalls, 0),
    retries: rows.reduce((sum, row) => sum + row.retries, 0),
    alerts: rows.filter(row => row.alert !== '').length,
    percent: rows.reduce((max, row) => Math.max(max, row.percent), 0),
    window: rows.reduce((max, row) => Math.max(max, row.window), 0),
  }
  return { rows, totals }
}
