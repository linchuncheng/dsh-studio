/* 事件账本（纯函数）。
 *
 * 为什么要有：webhook 收到的事件以前是**闭包里直接发**的——库里没留痕，
 * 事后问「这条 seq 是什么时候发的、内容对不对」根本查不到（产品定义第 7 条：
 * webhook 收到的每个 seq 都必须能在 events 查到）。
 *
 * 这里只做账本的形状与追加：单调 seq、保留最近 N 条、坏数据当没有。
 * 「先落账再投递」的顺序在 events.js 里保证。
 */

export const EVENT_LEDGER_SIDE_KEY = 'event-ledger'
export const EVENT_LEDGER_CAP = 500

/** 账本清洗：seq 只增不减，事件必须是对象。 */
export function sanitizeLedger(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const seq = Number(source.seq) > 0 ? Math.floor(Number(source.seq)) : 0
  const events = Array.isArray(source.events)
    ? source.events
      .filter(item => item !== null && typeof item === 'object' && Number(item.seq) > 0)
      .map(item => ({
        seq: Math.floor(Number(item.seq)),
        type: String(item.type ?? ''),
        at: Number(item.at) || 0,
        payload: item.payload !== null && typeof item.payload === 'object' ? item.payload : {},
      }))
      .sort((a, b) => a.seq - b.seq)
    : []
  return { seq: Math.max(seq, events.length > 0 ? events[events.length - 1].seq : 0), events }
}

/** 追加一批事件：给每条分配 seq，返回新账本 + 带 seq 的事件（顺序不变）。 */
export function appendEvents(raw, batch, cap = EVENT_LEDGER_CAP) {
  const ledger = sanitizeLedger(raw)
  const list = Array.isArray(batch) ? batch.filter(item => item !== null && typeof item === 'object') : []
  const stamped = []
  let seq = ledger.seq
  for (const event of list) {
    seq += 1
    const entry = {
      seq,
      type: String(event.type ?? ''),
      at: Number(event.at) || Date.now(),
      payload: event.payload !== null && typeof event.payload === 'object' ? event.payload : {},
    }
    ledger.events.push(entry)
    stamped.push({ ...event, seq })
  }
  // 只留最近 cap 条：账本用于排障与对账，不是永久审计（审计另有 recordAudit）。
  if (ledger.events.length > cap) ledger.events.splice(0, ledger.events.length - cap)
  return { ledger: { seq, events: ledger.events }, stamped }
}

/** 查账本：since 之后的事件（不含 since），按 seq 升序。 */
export function queryLedger(raw, options = {}) {
  const ledger = sanitizeLedger(raw)
  const since = Number(options.since) > 0 ? Math.floor(Number(options.since)) : 0
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 100))
  const type = String(options.type ?? '').trim()
  const events = ledger.events.filter(item => item.seq > since && (type === '' || item.type === type))
  return {
    lastSeq: ledger.seq,
    total: ledger.events.length,
    events: events.slice(0, limit),
  }
}
