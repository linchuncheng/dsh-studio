// 事件总线：平台内部发生的事，外面也应该能知道（CI 触发、IM 通知、工单同步）。
// 订阅者可以注册任意多个；一个订阅者抛错不影响其它订阅者，也不影响主流程。
//
// 两类订阅者，语义不同：
//   subscribe()        —— 进程内、同步、立即。给内部逻辑用（测试也靠它断言同步扇出）。
//   subscribeDurable() —— **先落账再投递**。给外部（webhook）用：投出去的事件一定已经
//                         在 events 账本里，能按 seq 查回来（产品定义第 7 条：无幻影事件）。
import { appendEvents, sanitizeLedger, EVENT_LEDGER_SIDE_KEY } from './event-ledger.js'

const subscribers = []
const durableSubscribers = []

/** 订阅：返回取消订阅的函数。 */
export function subscribe(handler) {
  if (typeof handler !== 'function') throw new Error('subscribe 需要函数')
  subscribers.push(handler)
  return () => {
    const at = subscribers.indexOf(handler)
    if (at >= 0) subscribers.splice(at, 1)
  }
}

/** 落账之后的订阅（webhook 用这个）：handler 收到的事件一定带 seq，且已在 events 账本里。 */
export function subscribeDurable(handler) {
  if (typeof handler !== 'function') throw new Error('subscribeDurable 需要函数')
  durableSubscribers.push(handler)
  return () => {
    const at = durableSubscribers.indexOf(handler)
    if (at >= 0) durableSubscribers.splice(at, 1)
  }
}

/* 账本读写由 index.js 注入（store 有 readSide/writeSide）。
   没注入时（单元测试、纯逻辑）就退化成"不落账、直接投递"，不阻断业务。 */
let sink = null
export function configureEventLedger(store) {
  sink = store ?? null
}

let queue = []
let flushing = null

/** 发事件：同步扇出给进程内订阅者，同时排队落账，落账成功后再投给 durable 订阅者。 */
export function emitEvent(type, payload = {}) {
  const event = { type: String(type), at: Date.now(), payload }
  for (const handler of subscribers) {
    try { handler(event) } catch { /* 订阅者自己的事 */ }
  }
  queue.push(event)
  void drain()
  return event
}

/** 把队列里的写进账本，然后投递。返回一个 promise，测试与 verify 脚本可以等它。 */
export function flushEvents() {
  return drain()
}

function drain() {
  if (flushing !== null) return flushing
  flushing = (async () => {
    // 让出一次事件循环：同一轮里连着发的事件合并成一批，少写几次盘。
    await new Promise(resolve => setTimeout(resolve, 0))
    while (queue.length > 0) {
      const batch = queue.splice(0)
      if (sink === null) {
        // 没接账本（比如纯函数测试）：直接投递，seq 缺省为 0，调用方自己知道没账本。
        for (const event of batch) fanOutDurable(event)
        continue
      }
      let stamped = batch
      try {
        const raw = await sink.readSide(EVENT_LEDGER_SIDE_KEY)
        const result = appendEvents(sanitizeLedger(raw), batch)
        await sink.writeSide(EVENT_LEDGER_SIDE_KEY, result.ledger)
        stamped = result.stamped
      } catch {
        /* 落账失败就不投递：宁可外部收不到，也不能让它收到一条查不回来的事件。 */
        continue
      }
      for (const event of stamped) fanOutDurable(event)
    }
  })().catch(() => {}).finally(() => {
    flushing = null
    if (queue.length > 0) void drain()
  })
  return flushing
}

function fanOutDurable(event) {
  for (const handler of durableSubscribers) {
    try { handler(event) } catch { /* 同上 */ }
  }
}

export function subscriberCount() {
  return subscribers.length + durableSubscribers.length
}
