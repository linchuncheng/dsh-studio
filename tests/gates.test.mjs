// P1 三条的契约测试：评审进准出、禁自评、签字来源
import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveSigner } from '../src/host/access.js'
import { isSelfReview } from '../src/host/quality.js'
import { configureExecutor, taskExitGate } from '../src/host/executor.js'

configureExecutor(new Proxy({}, { get: () => () => undefined }))

const baseCard = {
  id: 't-1', code: 'DEV-001', title: '登录锁定', status: 'accept',
  cases: [{ id: 'c1', title: 'x', result: 'pass', http: { url: '/x', expectStatus: 200 } }],
  checklist: [], artifacts: [{ kind: 'doc', title: '报告', status: 'ready' }],
  blocked: null, gitlabMR: null,
  signoff: { by: '张三', at: 1, note: '人看过', actorKind: 'human' },
}
const gate = card => taskExitGate({ tasks: [card], config: { experts: [] } }, card)
const blocked = (result, keyword) => result.blockers.some(item => item.includes(keyword))

test('准出：代码评审没给结论就拦（以前 review 完全不参与准出）', () => {
  const pending = { ...baseCard, coding: { agent: '开发工程师', review: { status: 'pending', by: '', at: 0, note: '' } } }
  assert.equal(blocked(gate(pending), '代码评审还没给出结论'), true, 'pending 要拦')
  const empty = { ...baseCard, coding: { agent: '开发工程师', review: null } }
  assert.equal(blocked(gate(empty), '代码评审'), true, '没有评审记录也要拦')
  const rejected = { ...baseCard, coding: { agent: '开发工程师', review: { status: 'changes_requested', by: '架构师', at: 1, note: '接口没做幂等' } } }
  assert.equal(blocked(gate(rejected), '代码评审要改'), true, 'changes_requested 要拦')
  const approved = { ...baseCard, coding: { agent: '开发工程师', review: { status: 'approved', by: '架构师', at: 1, note: 'ok' } } }
  assert.equal(blocked(gate(approved), '代码评审'), false, 'approved 放行')
  const noCoding = { ...baseCard, coding: null }
  assert.equal(blocked(gate(noCoding), '代码评审'), false, '没有执行记录的卡不受这条影响')
})

test('禁自评：作者与评审人是同一个（或名字互相包含）就算自评', () => {
  assert.equal(isSelfReview('开发工程师', '开发工程师'), true)
  assert.equal(isSelfReview('开发', '开发工程师'), true, '名字互相包含也算')
  assert.equal(isSelfReview('开发工程师', '架构师'), false)
  assert.equal(isSelfReview('', '架构师'), false, '没有作者信息时不算（老记录）')
  assert.equal(isSelfReview('开发工程师', ''), false)
})

test('签字来源：登录会话优先于请求体自报', () => {
  assert.deepEqual(resolveSigner({ session: 'admin', body: '李四' }), { by: 'admin', source: 'session' })
  assert.deepEqual(resolveSigner({ header: 'proxy-user', body: '李四' }), { by: 'proxy-user', source: 'header' })
  assert.deepEqual(resolveSigner({ body: '李四' }), { by: '李四', source: 'body' }, '免登录单机模式才轮到自报')
  assert.deepEqual(resolveSigner({}), { by: '人', source: 'none' })
  assert.deepEqual(resolveSigner({ session: '  ', body: ' 李四 ' }), { by: '李四', source: 'body' }, '空白当没有')
})

test('签字路由：override 必须声明在 store.mutate 之前（0.4.0~0.9.0 之间这里一直是运行时 ReferenceError）', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../src/host/routes/requirements.js', import.meta.url), 'utf8')
  const declared = source.indexOf('const override = String(body.override')
  const used = source.indexOf('if (override !== \'\') target.override')
  assert.ok(declared > 0, '签字路由里应该有 override 声明')
  assert.ok(used > 0, '签字路由里应该用 override 写记录')
  assert.ok(declared < used, 'override 必须先声明再使用（以前声明在 if 块里，mutate 里用会 ReferenceError）')
})

// issue #9 第 3 条：评审闸门以前只在「已完成」检查，待评审→待测试直接放行。
test('评审闸门：进待测试之前代码评审必须有结论（默认开）', async () => {
  const { reviewGate } = await import('../src/host/quality.js')
  const pending = { coding: { review: { status: 'pending' } } }
  const approved = { coding: { review: { status: 'approved' } } }
  const changes = { coding: { review: { status: 'changes_requested', note: '接口没做幂等' } } }

  const on = { reviewGate: { enabled: true } }
  assert.equal(reviewGate(on, pending, 'test').needed, true)
  assert.equal(reviewGate(on, pending, 'test').ready, false)
  assert.match(reviewGate(on, pending, 'test').blockers.join(), /还没通过/)
  assert.equal(reviewGate(on, changes, 'test').ready, false)
  assert.match(reviewGate(on, changes, 'test').blockers.join(), /要求修改/)
  assert.equal(reviewGate(on, approved, 'test').ready, true, '评审通过就放行')
  assert.equal(reviewGate(on, pending, 'review').needed, false, '别的列不管')
  assert.equal(reviewGate(on, { coding: null }, 'test').ready, false, '没有执行记录也要拦')

  // 默认（配置里没写）= 开；显式 false 才关
  assert.equal(reviewGate({}, pending, 'test').needed, true, '默认就生效，不写配置不算关')
  assert.equal(reviewGate({ reviewGate: { enabled: false } }, pending, 'test').needed, false, '显式关掉才不拦')
  assert.equal(reviewGate({ reviewGate: { enabled: true, columns: ['accept'] } }, pending, 'test').needed, false, '换列也认')
})

test('评审闸门配置：默认开、显式 false 才关、columns 回落 test', async () => {
  const { sanitizeReviewGate } = await import('../src/host/domain.js')
  assert.deepEqual(sanitizeReviewGate(undefined), { enabled: true, columns: ['test'] })
  assert.deepEqual(sanitizeReviewGate(null), { enabled: true, columns: ['test'] })
  assert.equal(sanitizeReviewGate({ enabled: false }).enabled, false, '只有显式 false 才算关')
  assert.equal(sanitizeReviewGate({ enabled: 'false' }).enabled, true, '字符串不算关，免得配错静默关掉闸门')
  assert.deepEqual(sanitizeReviewGate({ columns: [] }).columns, ['test'], '空数组回落到默认列')
  assert.deepEqual(sanitizeReviewGate({ columns: ['accept', 'done'] }).columns, ['accept', 'done'])
})
