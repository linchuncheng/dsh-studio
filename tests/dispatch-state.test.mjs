import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { countStalled, dispatchPhase, isStalled } from '../src/host/dispatch-state.js'

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
