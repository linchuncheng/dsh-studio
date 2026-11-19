// 交付节奏三把尺子：口径错了会让"看起来好"变成"实际很差"，所以逐条钉住。
import assert from 'node:assert/strict'
import test from 'node:test'

import { dispatchWeekly, gateFirstPass, requirementDelivery, statusFlow, weekStart } from '../src/host/delivery.js'

const flow = (...pairs) => pairs.map(([status, at]) => ({ status, at }))

test('#9 门禁一次通过率：进待验收后直接完成才算一次过', () => {
  const tasks = [
    // 一次过
    { id: 't1', code: 'A', history: flow(['test', 1], ['accept', 2], ['done', 3]) },
    // 进待验收后被打回测试，再回来完成 → 不算一次过
    { id: 't2', code: 'B', history: flow(['test', 1], ['accept', 2], ['test', 3], ['accept', 4], ['done', 5]) },
    // 没到过验收 → 不参与统计
    { id: 't3', code: 'C', history: flow(['dev', 1], ['test', 2]) },
    // 到了验收但还没完成 → 不参与
    { id: 't4', code: 'D', history: flow(['accept', 1]) },
  ]
  const result = gateFirstPass(tasks)
  assert.equal(result.cards, 2, '只算"到了验收且完成"的卡')
  assert.equal(result.firstPass, 1)
  assert.equal(result.rate, 0.5)
  assert.deepEqual(result.bounced.map(item => item.code), ['B'])
  assert.equal(gateFirstPass([]).rate, null, '没数据是 null，不是 0%')
})

test('#9 只按时间排序，不依赖 history 写入顺序', () => {
  const task = { id: 't', code: 'X', history: [{ status: 'done', at: 3 }, { status: 'accept', at: 2 }, { status: 'test', at: 1 }] }
  assert.deepEqual(statusFlow(task).map(step => step.status), ['test', 'accept', 'done'])
  assert.equal(gateFirstPass([task]).rate, 1)
})

test('#10 派单周活：只数有 AI 评论的卡，按周分桶', () => {
  // 用本地构造器（不用带 +08:00 的字面量）：CI 跑在 UTC，字面量会把「周四」算成别的日子。
  const now = new Date(2026, 10, 19, 10, 0, 0).getTime() // 本地时间的周四
  const thisWeek = weekStart(now)
  const lastWeek = thisWeek - 7 * 86_400_000
  const tasks = [
    { id: 't1', comments: [{ kind: 'agent', at: thisWeek + 1000 }] },
    { id: 't2', comments: [{ kind: 'agent', at: thisWeek + 2000 }, { kind: 'agent', at: thisWeek + 3000 }] },
    { id: 't3', comments: [{ kind: 'human', at: thisWeek + 4000 }] }, // 人评论不算
    { id: 't4', comments: [{ kind: 'agent', at: lastWeek + 1000 }] },
  ]
  const result = dispatchWeekly(tasks, { weeks: 8, now })
  assert.equal(result.weeks.length, 8, '固定 8 个桶')
  assert.equal(result.latest, 2, '本周两张卡（t1/t2，t2 两条评论只算一张卡）')
  assert.equal(result.weeks.find(item => item.week === lastWeek).cards, 1)
  assert.equal(result.meetsTarget, false)
  assert.equal(result.target, 15)
})

test('#10 周一为一周之始（不是周日）', () => {
  const monday = new Date(2026, 10, 16, 0, 0, 0).getTime()
  const sunday = new Date(2026, 10, 22, 23, 59, 0).getTime()
  assert.equal(weekStart(monday), monday)
  assert.equal(weekStart(sunday), monday, '周日晚仍算这一周')
})

test('#14 需求交付时长：创建 → 签字，中位数；没签字的跳过', () => {
  const day = 86_400_000
  const base = new Date(2026, 10, 1, 0, 0, 0).getTime()
  const requirements = [
    { id: 'r1', code: 'REQ-1', createdAt: base, signoff: { at: base + 2 * day, note: 'ok' } },
    { id: 'r2', code: 'REQ-2', createdAt: base, signoff: { at: base + 4 * day, note: 'ok' } },
    { id: 'r3', code: 'REQ-3', createdAt: base, signoff: { at: base + 9 * day, note: 'ok' } },
    { id: 'r4', code: 'REQ-4', createdAt: base, signoff: null }, // 还没签
  ]
  const result = requirementDelivery(requirements)
  assert.equal(result.count, 3)
  assert.equal(result.medianDays, 4, '中位数是 4 天')
  assert.equal(Number(result.avgDays.toFixed(2)), 5)
  assert.equal(requirementDelivery([]).medianDays, null, '没数据是 null')
})
