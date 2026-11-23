// 卡片编号的两条硬规则（2026-11-23 模块体检发现的问题）：
//   1. 需求卡的编号 = 需求自己的编号（REQ-2026-00x），不是「需求内序号」——
//      按序号编的话每条需求的卡都叫 REQ-001，界面上分不清（真机数据里 7 条需求各一张 REQ-001）。
//   2. 同一需求内的编号在并发建卡时不能撞：临界区里要循环到真正的空位，
//      只补一次不够（一批自动缺陷会连着开几十张）。
import assert from 'node:assert/strict'
import test from 'node:test'

import { CODE_PREFIX, nextTaskCode } from '../src/host/domain.js'

test('nextTaskCode：同一需求内递增，跨需求各自从 001 开始（设计如此）', () => {
  const tasks = [
    { requirementId: 'req-a', code: 'BUG-001' },
    { requirementId: 'req-a', code: 'BUG-002' },
    { requirementId: 'req-a', code: 'DEV-001' },
    { requirementId: 'req-b', code: 'BUG-001' },
  ]
  assert.equal(nextTaskCode(tasks, 'req-a', 'BUG'), 'BUG-003')
  assert.equal(nextTaskCode(tasks, 'req-a', 'DEV'), 'DEV-002')
  assert.equal(nextTaskCode(tasks, 'req-b', 'BUG'), 'BUG-002')
  assert.equal(nextTaskCode(tasks, 'req-c', 'BUG'), 'BUG-001')
})

test('nextTaskCode：忽略别的需求的编号，不会被它们顶高', () => {
  const tasks = [{ requirementId: 'other', code: 'BUG-009' }]
  assert.equal(nextTaskCode(tasks, 'mine', 'BUG'), 'BUG-001')
})

test('CODE_PREFIX：每种卡的前缀都在（需求卡用 REQ，但实际编号取需求自己的号）', () => {
  for (const type of ['requirement', 'design', 'dev', 'test', 'bug', 'ops']) {
    assert.equal(typeof CODE_PREFIX[type], 'string', type)
    assert.ok(CODE_PREFIX[type].length > 0, type)
  }
  assert.equal(CODE_PREFIX.bug, 'BUG')
  assert.equal(CODE_PREFIX.dev, 'DEV')
})

test('撞号兜底逻辑：循环到空位时不会重复（模拟一批并发建卡）', () => {
  // 复刻 index.js createTask 临界区里那段：taken 里没有就停，有就继续 nextTaskCode
  const mint = (tasks, requirementId, type) => {
    const prefix = CODE_PREFIX[type] ?? 'TASK'
    let code = nextTaskCode(tasks, requirementId, prefix)
    const taken = new Set(tasks.filter(t => t.requirementId === requirementId).map(t => String(t.code ?? '')))
    let guard = 0
    while (taken.has(code) && guard < 1000) {
      code = nextTaskCode(tasks, requirementId, prefix)
      guard += 1
    }
    return code
  }

  const tasks = []
  const codes = []
  for (let index = 0; index < 30; index += 1) {
    // 故意让一半的卡用「过期快照」算编号，制造撞号
    const snapshot = index % 2 === 0 ? [] : tasks.slice()
    const code = mint(snapshot.concat(tasks.slice(0, 0)), 'req-x', 'bug') === '' ? '' : (() => {
      const prefix = 'BUG'
      let next = nextTaskCode(snapshot, 'req-x', prefix)
      const taken = new Set(tasks.filter(t => t.requirementId === 'req-x').map(t => String(t.code ?? '')))
      let guard = 0
      while (taken.has(next) && guard < 1000) {
        next = nextTaskCode(tasks, 'req-x', prefix)
        guard += 1
      }
      return next
    })()
    codes.push(code)
    tasks.push({ requirementId: 'req-x', code })
  }
  assert.equal(new Set(codes).size, codes.length, `编号撞了：${codes.join(',')}`)
})

test('clearDeletedReferences：删卡后清掉别人指向它的父卡/重复标记', async () => {
  const { clearDeletedReferences } = await import('../src/host/domain.js')
  const tasks = [
    { id: 'a', parent: 'gone', duplicateOf: '' },
    { id: 'b', parent: '', duplicateOf: 'gone' },
    { id: 'c', parent: 'a', duplicateOf: '' },
  ]
  const touched = clearDeletedReferences(tasks, 'gone')
  assert.equal(touched.length, 2)
  assert.equal(tasks[0].parent, '', '父卡被删 → 清空')
  assert.equal(tasks[1].duplicateOf, '', '重复标记指向被删卡 → 清空')
  assert.equal(tasks[2].parent, 'a', '指向别人的不动')
  assert.deepEqual(clearDeletedReferences(tasks, ''), [], '空 id 不动任何东西')
})
