// #7 无幻影事件：webhook 收到的每个 seq 都必须能在 events 账本里查到。
import assert from 'node:assert/strict'
import test from 'node:test'

import { appendEvents, queryLedger, sanitizeLedger, EVENT_LEDGER_CAP } from '../src/host/event-ledger.js'
import { configureEventLedger, emitEvent, flushEvents, subscribeDurable } from '../src/host/events.js'

test('账本：seq 单调递增，按追加顺序给号', () => {
  const first = appendEvents(null, [{ type: 'a' }, { type: 'b' }])
  assert.deepEqual(first.stamped.map(e => e.seq), [1, 2])
  assert.equal(first.ledger.seq, 2)
  const second = appendEvents(first.ledger, [{ type: 'c' }])
  assert.equal(second.stamped[0].seq, 3, '接着上一条往下发号')
  assert.equal(queryLedger(second.ledger, { since: 0 }).events.length, 3)
  assert.deepEqual(queryLedger(second.ledger, { since: 1 }).events.map(e => e.type), ['b', 'c'], 'since 不含自己')
  assert.equal(queryLedger(second.ledger, { since: 0, type: 'c' }).events.length, 1)
})

test('账本：只留最近 N 条，但 seq 不回退', () => {
  const batch = Array.from({ length: EVENT_LEDGER_CAP + 30 }, (_, i) => ({ type: `e${i}` }))
  const { ledger } = appendEvents(null, batch)
  assert.equal(ledger.events.length, EVENT_LEDGER_CAP, '有上限')
  assert.equal(ledger.seq, EVENT_LEDGER_CAP + 30, 'seq 仍是总数，不会因为裁剪回退')
  assert.equal(ledger.events[ledger.events.length - 1].seq, EVENT_LEDGER_CAP + 30)
})

test('账本：坏数据当没有，不会把账本搞崩', () => {
  assert.deepEqual(sanitizeLedger(null), { seq: 0, events: [] })
  assert.deepEqual(sanitizeLedger({ seq: 'abc', events: [{ seq: 0 }, null, { seq: 2, type: 'x' }] }).events.map(e => e.seq), [2])
  assert.equal(queryLedger(undefined, {}).lastSeq, 0)
})

/** 内存版 store（只需要 readSide / writeSide）。 */
function fakeStore() {
  const side = new Map()
  return {
    side,
    async readSide(key) { return side.get(key) },
    async writeSide(key, value) { side.set(key, value) },
  }
}

test('落账之后才投递：durable 订阅收到的事件一定在账本里', async () => {
  const store = fakeStore()
  configureEventLedger(store)
  const seen = []
  const off = subscribeDurable(event => seen.push(event))
  try {
    emitEvent('task/moved', { taskId: 't-1' })
    emitEvent('case/failed', { caseId: 'c-1' })
    await flushEvents()
    assert.equal(seen.length, 2, '两条都投出去了')
    const ledger = await store.readSide('event-ledger')
    const { events } = queryLedger(ledger, { since: 0 })
    assert.equal(events.length, 2, '账本里也有两条')
    // 核心断言：投出去的每条 seq 都能在账本里查到
    for (const event of seen) {
      assert.ok(events.some(entry => entry.seq === event.seq), `seq ${event.seq} 必须能在 events 查到`)
    }
    assert.deepEqual(seen.map(e => e.seq), [1, 2], 'seq 从 1 开始单调')
  } finally {
    off()
    configureEventLedger(null)
  }
})

test('落账失败就不投递：宁可外部收不到，也不能收到查不回来的事件', async () => {
  const store = fakeStore()
  store.writeSide = async () => { throw new Error('disk full') }
  configureEventLedger(store)
  const seen = []
  const off = subscribeDurable(event => seen.push(event))
  try {
    emitEvent('task/moved', { taskId: 't-2' })
    await flushEvents()
    assert.equal(seen.length, 0, '写不进账本就不该投出去')
  } finally {
    off()
    configureEventLedger(null)
  }
})
