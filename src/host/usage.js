// 会话用量解析：从 dsh 的 session.v4.jsonl 里把每次模型调用的 token 取出来。
// 纯函数，方便单测；读文件那半在 session-usage.js。
//
// 日志形状（实测）：
//   {"type":"assistant/message","seq":19,"time":...,"data":{"turn":1,"step":1,"message":{...},
//    "usage":{"inputTokens":3033,"outputTokens":116,"cacheReadTokens":17024,"cacheWriteTokens":0,"totalTokens":20173},
//    "stream":[{"type":"chunk","chunk":{"type":"usage",...}}]}}
// 同一条消息里 usage 会出现两次（消息体 + 流式 chunk），所以只认 assistant/message 上的那一份。

/** 从日志里挑出一条记录对应的用量；不是 assistant/message 就返回 null。 */
export function usageOfEntry(entry) {
  if (entry === null || typeof entry !== 'object') return null
  if (entry.type !== 'assistant/message') return null
  const data = entry.data ?? {}
  const usage = data.usage ?? data.message?.usage ?? null
  if (usage === null || typeof usage !== 'object') return null
  const number = (value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }
  const input = number(usage.inputTokens)
  const output = number(usage.outputTokens)
  const cacheRead = number(usage.cacheReadTokens)
  const cacheWrite = number(usage.cacheWriteTokens)
  return {
    at: Number(entry.time) || 0,
    turn: Number(data.turn) || 0,
    model: String(data.model ?? entry.model ?? ''),
    input,
    output,
    cacheRead,
    cacheWrite,
    total: number(usage.totalTokens) || input + output + cacheRead + cacheWrite,
  }
}

/** 解析整个 jsonl（已解压的行数组），返回每条消息的用量。坏行跳过，不抛。 */
export function parseUsageLines(lines) {
  const out = []
  // 模型名不挂在每条消息上：它在会话头 / 请求上下文里（data.header.config.model 或 data.model），
  // 所以一边扫一边记，后面没有 model 的消息沿用最近一次看到的。
  let model = ''
  for (const line of Array.isArray(lines) ? lines : []) {
    const trimmed = String(line ?? '').trim()
    if (trimmed === '' || trimmed[0] !== '{') continue
    let entry = null
    try { entry = JSON.parse(trimmed) } catch { continue }
    const declared = entry?.data?.model ?? entry?.data?.header?.config?.model
    if (typeof declared === 'string' && declared !== '') model = declared
    const usage = usageOfEntry(entry)
    if (usage !== null) out.push({ ...usage, model: usage.model === '' ? model : usage.model })
  }
  return out
}

/** 汇总：token 数按类型分开，别把缓存命中混进普通输入。 */
export function summarizeUsage(entries) {
  const list = Array.isArray(entries) ? entries : []
  const sum = (field) => list.reduce((total, item) => total + (Number(item?.[field]) || 0), 0)
  return {
    calls: list.length,
    input: sum('input'),
    output: sum('output'),
    cacheRead: sum('cacheRead'),
    cacheWrite: sum('cacheWrite'),
    total: sum('total'),
  }
}

/** 订阅套餐通道：*-coding / *-token-plan —— 走包月额度，token 照记但不算钱。 */
export function isSubscriptionModel(model) {
  return /-(coding|token-plan)$/.test(String(model ?? ''))
}

/**
 * 价目表按 model 查：prices 来自 config.costs.prices（单位：元 / 百万 token）。
 * 查不到就返回 null —— 宁可显示"未知"，也不能按 0 算成免费。
 */
export function priceOf(prices, model) {
  const name = String(model ?? '')
  if (name === '') return null
  const list = Array.isArray(prices) ? prices : []
  const hit = list.find((item) => String(item?.model ?? '') === name)
  if (hit === undefined) return null
  const price = {
    input: Number(hit.input) || 0,
    output: Number(hit.output) || 0,
    cacheRead: Number(hit.cacheRead) || 0,
    cacheWrite: Number(hit.cacheWrite) || 0,
  }
  // 四个单价都是 0 = 「这行只建了还没填钱」（设置页「补价目」补进来的空行就长这样）。
  // 当成命中价目表会算出 ¥0.00，比「未知」更能误导人，所以按未配处理。
  if (price.input === 0 && price.output === 0 && price.cacheRead === 0 && price.cacheWrite === 0) return null
  return price
}

/**
 * 算钱：命中价目表才给数字，订阅通道给 0（明确"不额外收费"），
 * 其它情况给 null（未知）。
 */
export function costOf(prices, entries) {
  const list = Array.isArray(entries) ? entries : []
  if (list.length === 0) return { cost: 0, priced: true, unknownCalls: 0 }
  let cost = 0
  let unknownCalls = 0
  for (const item of list) {
    if (isSubscriptionModel(item.model)) continue
    const price = priceOf(prices, item.model)
    if (price === null) { unknownCalls += 1; continue }
    const million = 1000000
    cost += (Number(item.input) || 0) / million * price.input
    cost += (Number(item.output) || 0) / million * price.output
    cost += (Number(item.cacheRead) || 0) / million * price.cacheRead
    cost += (Number(item.cacheWrite) || 0) / million * price.cacheWrite
  }
  return { cost: unknownCalls > 0 && cost === 0 ? null : Math.round(cost * 10000) / 10000, priced: unknownCalls === 0, unknownCalls }
}

export function sanitizePrices(raw) {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 50).map((item) => ({
    model: String(item?.model ?? '').trim().slice(0, 80),
    input: Number(item?.input) || 0,
    output: Number(item?.output) || 0,
    cacheRead: Number(item?.cacheRead) || 0,
    cacheWrite: Number(item?.cacheWrite) || 0,
  })).filter((item) => item.model !== '')
}
