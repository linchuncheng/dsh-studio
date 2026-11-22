import assert from 'node:assert/strict'
import { describe, it, test } from 'node:test'

import { countStalled, dispatchPhase, isStalled, RUNNING_TIMEOUT_MS } from '../src/host/dispatch-state.js'

/* 这两个 bug 都是「状态形状看着对、语义不对」，只能靠断言防住：
   ① 崩溃重启后 reconcile 只清 state 不清 status → 卡永久停摆
   ② 「重新派单」只清失败计数、不清 dispatch 印记 → 永不重派 */
describe('dispatch-state: 派单阶段判定', () => {
  it('没有派单印记 → queued（等着被派）', () => {
    assert.equal(dispatchPhase({ status: 'dev', dispatch: null }), 'queued')
    assert.equal(dispatchPhase({ status: 'dev' }), 'queued')
  })

  it('印记的列与当前列不同 → queued（换列了，该重新派）', () => {
    assert.equal(dispatchPhase({ status: 'test', dispatch: { status: 'dev', state: 'running' } }), 'queued')
  })

  it('印记匹配且正在跑 → running', () => {
    assert.equal(dispatchPhase({ status: 'dev', dispatch: { status: 'dev', state: 'running' } }), 'running')
  })

  it('印记匹配但已不在跑 → stalled（这就是崩溃后的形状，必须报警）', () => {
    const task = { status: 'dev', dispatch: { status: 'dev', state: 'stopped' } }
    assert.equal(dispatchPhase(task), 'stalled')
    assert.equal(isStalled(task), true)
  })

  it('reconcile 修好后（status 清空）→ queued，能重新派单', () => {
    const task = { status: 'dev', dispatch: { status: '', state: 'stopped', attempts: 2 } }
    assert.equal(dispatchPhase(task), 'queued')
    assert.equal(isStalled(task), false)
  })

  it('「重新派单」修好后（dispatch 置空）→ queued', () => {
    const task = { status: 'dev', dispatch: null }
    assert.equal(dispatchPhase(task), 'queued')
  })

  it('countStalled 能一次数出所有停摆的卡', () => {
    const tasks = [
      { id: 'a', status: 'dev', dispatch: { status: 'dev', state: 'stopped' } },   // 停摆
      { id: 'b', status: 'dev', dispatch: { status: 'dev', state: 'running' } },   // 正常
      { id: 'c', status: 'test', dispatch: null },                                  // 排队
      { id: 'd', status: 'test', dispatch: { status: 'dev', state: 'stopped' } },  // 换列了
    ]
    assert.equal(countStalled(tasks), 1)
  })
})

test('dispatchPhase：running 挂死超过阈值算 stalled（以前永远算 running，既不提示也不重派）', () => {
  const at = 1_000_000
  const task = { status: 'review', dispatch: { status: 'review', state: 'running', sessionId: 's1', at } }
  assert.equal(dispatchPhase(task, { now: at + 60_000 }), 'running', '一分钟内仍算在跑')
  assert.equal(dispatchPhase(task, { now: at + RUNNING_TIMEOUT_MS + 1 }), 'stalled', '超过阈值算停摆')
  assert.equal(isStalled(task, { now: at + RUNNING_TIMEOUT_MS + 1 }), true)
  assert.equal(countStalled([task], { now: at + RUNNING_TIMEOUT_MS + 1 }), 1)
})

test('dispatchPhase：能问到会话是否活着时以它为准（真会话比时间戳可靠）', () => {
  const at = 1_000_000
  const task = { status: 'dev', dispatch: { status: 'dev', state: 'running', sessionId: 's1', at } }
  const live = new Set(['s1'])
  const dead = new Set()
  assert.equal(dispatchPhase(task, { now: at + 10 * RUNNING_TIMEOUT_MS, isLive: id => live.has(id) }), 'running', '会话活着再久也算在跑')
  assert.equal(dispatchPhase(task, { now: at + 1, isLive: id => dead.has(id) }), 'stalled', '会话没了立刻算停摆，不用等阈值')
})

test('dispatchPhase：不传 ctx 时默认就按 10 分钟兜底（否则挂死的卡永远看不出来）', () => {
  const fresh = { status: 'dev', dispatch: { status: 'dev', state: 'running', sessionId: 's1', at: Date.now() } }
  const stale = { status: 'dev', dispatch: { status: 'dev', state: 'running', sessionId: 's1', at: Date.now() - RUNNING_TIMEOUT_MS - 1000 } }
  assert.equal(dispatchPhase(fresh), 'running', '刚派出去的算在跑')
  assert.equal(dispatchPhase(stale), 'stalled', '没动静超过阈值算停摆')
  assert.equal(isStalled({ status: 'dev', dispatch: { status: 'dev', state: 'idle', at: 1 } }), true, 'idle 仍然立刻算停摆')
})
