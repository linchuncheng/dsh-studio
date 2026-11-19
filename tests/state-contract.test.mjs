// issue #5 剩下两条代码问题的契约测试：
//   #5  /task/design 只带 id 不应该写数据（读请求不该加 revision）
//   #9  /state 不再同时下发空数组和真实计数
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { designPatchFrom } from '../src/host/design.js'
import { publicCases, publicChecklist, publicComments } from '../src/host/domain.js'

test('/state 契约：用例/清单/评论只给计数，不再下发空数组', () => {
  const task = {
    cases: [{ id: 'c1', result: 'pass' }, { id: 'c2', result: 'fail' }],
    checklist: [{ id: 'k1', done: true }, { id: 'k2', done: false }],
    comments: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
  }

  const cases = publicCases(task)
  assert.equal('cases' in cases, false, 'publicCases 不该再下发 cases 数组')
  assert.deepEqual(cases.caseSummary, { total: 2, pass: 1, fail: 1 })

  const checklist = publicChecklist(task)
  assert.equal('checklist' in checklist, false, 'publicChecklist 不该再下发 checklist 数组')
  assert.deepEqual(checklist.checkSummary, { done: 1, total: 2 })

  const comments = publicComments(task)
  assert.equal('comments' in comments, false, 'publicComments 不该再下发 comments 数组')
  assert.equal(comments.commentCount, 3)

  // 空卡也不能出现数组（老契约会下发 []，读 .length 的视图永远是 0）
  for (const out of [publicCases({}), publicChecklist({}), publicComments({})]) {
    assert.equal(Object.values(out).some(value => Array.isArray(value)), false)
  }
})

test('/task/design：只带 id（读）不产生任何设计补丁', () => {
  assert.equal(designPatchFrom({ id: 't-1' }), null, '只有 id 应该走只读分支')
  assert.equal(designPatchFrom({}), null)
  assert.equal(designPatchFrom(null), null)
  assert.equal(designPatchFrom({ id: 't-1', design: {} }), null, '空 design 对象也不算写')
  assert.equal(designPatchFrom({ id: 't-1', by: '人' }), null, '只有 by 不算改设计')
})

test('/task/design：带字段才算写，且保持两种写法都兼容', () => {
  assert.deepEqual(designPatchFrom({ id: 't-1', design: { link: 'https://x' } }), { link: 'https://x' })
  assert.deepEqual(designPatchFrom({ id: 't-1', status: 'approved' }), { status: 'approved' })
  const merged = designPatchFrom({ id: 't-1', link: 'https://y', note: 'ok' })
  assert.deepEqual(merged, { link: 'https://y', note: 'ok' })
})

test('路由：只读分支不发 state、不写库', () => {
  // 结构断言：只带 id 时必须走 readOnly 分支并直接返回，不进入 store.mutate
  const source = readFileSync(new URL('../src/host/routes/tasks.js', import.meta.url), 'utf8')
  const at = source.indexOf("route === '/task/design'")
  assert.ok(at > 0)
  const block = source.slice(at, at + 1400)
  assert.match(block, /designPatchFrom\(body\)/, '要用纯函数判断有没有字段')
  assert.match(block, /readOnly: true/, '只读分支要标记 readOnly')
  const readOnlyAt = block.indexOf('readOnly: true')
  const firstMutate = source.indexOf('store.mutate', at)
  assert.ok(readOnlyAt > 0 && firstMutate > at, '两处都要在 design 分支里')
  assert.ok(readOnlyAt < firstMutate, '只读分支必须在 mutate 之前返回')
})
