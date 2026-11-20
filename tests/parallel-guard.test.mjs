// 并发派单的隔离护栏：并发只有在「每张卡一个 worktree」时才安全。
import assert from 'node:assert/strict'
import test from 'node:test'

import { MAX_CONCURRENT_CEILING, effectiveConcurrency } from '../src/host/parallel-guard.js'

test('隔离是 worktree 时才允许并发', () => {
  const ok = effectiveConcurrency({ maxConcurrent: 3, isolation: 'worktree' })
  assert.equal(ok.limit, 3)
  assert.equal(ok.capped, false)
  assert.equal(ok.isolated, true)
})

test('隔离不是 worktree 时把并发降到 1，并说明原因（不静默）', () => {
  for (const isolation of ['none', '', undefined, 'shared']) {
    const out = effectiveConcurrency({ maxConcurrent: 4, isolation })
    assert.equal(out.limit, 1, `isolation=${String(isolation)} 应降到 1`)
    assert.equal(out.capped, true)
    assert.equal(out.configured, 4, '要记住用户配的原始值，面板上要显示')
    assert.match(out.reason, /worktree/)
    assert.match(out.reason, /降到 1/)
  }
})

test('并发本来就是 1 时不算降级（不发警告）', () => {
  const out = effectiveConcurrency({ maxConcurrent: 1, isolation: 'none' })
  assert.equal(out.limit, 1)
  assert.equal(out.capped, false)
  assert.equal(out.reason, '')
})

test('边界：没配、非数字、超上限', () => {
  assert.equal(effectiveConcurrency({}).limit, 1, '默认 maxConcurrent=2 且隔离 none → 降 1')
  assert.equal(effectiveConcurrency({ maxConcurrent: 'x', isolation: 'worktree' }).limit, 2, '非法值回到默认 2')
  assert.equal(effectiveConcurrency({ maxConcurrent: 0, isolation: 'worktree' }).limit, 2, '0 也回到默认 2')
  assert.equal(effectiveConcurrency({ maxConcurrent: 99, isolation: 'worktree' }).limit, MAX_CONCURRENT_CEILING)
  assert.equal(effectiveConcurrency({ maxConcurrent: -3, isolation: 'worktree' }).limit, 2)
})
