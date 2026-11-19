// 验收条件这条线：拆卡继承 → 用例挂条件 → 矩阵逐条判。
// 以前的 bug：功能点里任意一条用例通过，就把所有验收条件标成 covered（"5/5" 可能只对应 1 条用例）。
import assert from 'node:assert/strict'
import test from 'node:test'

import { checklistFromAcceptance } from '../src/host/acceptance.js'
import { requirementMatrix } from '../src/host/executor.js'
import { sanitizeCase } from '../src/host/domain.js'

const point = {
  id: 'p1',
  title: '登录失败锁定',
  acceptance: [
    { id: 'a1', text: '连续 5 次错误后第 6 次返回 423', done: false },
    { id: 'a2', text: '锁定期内正确密码也返回 423', done: false },
  ],
  status: 'active',
  priority: 'p1',
}
const requirement = { id: 'r1', code: 'REQ-1', title: '登录', points: [point], status: 'active' }

test('矩阵：只有挂在某条验收条件上的通过用例才算覆盖', () => {
  const state = {
    config: {},
    requirements: [requirement],
    tasks: [{
      id: 't1', code: 'DEV-001', title: '登录失败次数', requirementId: 'r1', pointId: 'p1', status: 'test',
      cases: [
        { id: 'c1', title: '第 6 次 423', result: 'pass', acceptanceId: 'a1', pointId: 'p1' },
        { id: 'c2', title: '锁定期正确密码', result: 'pending', acceptanceId: 'a2', pointId: 'p1' },
      ],
    }],
  }
  const matrix = requirementMatrix(state, requirement)
  const [line1, line2] = matrix.points[0].acceptance
  assert.equal(line1.covered, true, 'a1 有通过用例 → 覆盖')
  assert.equal(line2.covered, false, 'a2 只有 pending 用例 → 不算覆盖')
  assert.equal(matrix.points[0].unmappedCases, 0)
})

test('矩阵：没挂验收条件的通过用例不算任何条件的覆盖', () => {
  const state = {
    config: {},
    requirements: [requirement],
    tasks: [{
      id: 't1', code: 'DEV-001', title: '登录失败次数', requirementId: 'r1', pointId: 'p1', status: 'test',
      cases: [{ id: 'c1', title: '随手写的用例', result: 'pass', acceptanceId: '', pointId: 'p1' }],
    }],
  }
  const matrix = requirementMatrix(state, requirement)
  assert.equal(matrix.points[0].acceptance.every(item => item.covered === false), true, '一条都不算覆盖')
  assert.equal(matrix.points[0].unmappedCases, 1, '没挂条件的用例要单独数出来')
  assert.equal(matrix.points[0].covered, false, '功能点整体不能算覆盖')
})

test('用例形状：acceptanceId 能存下来（不然重启就丢了）', () => {
  const saved = sanitizeCase({ title: '第 6 次 423', acceptanceId: 'a1' }, 0)
  assert.equal(saved.acceptanceId, 'a1')
  assert.equal(sanitizeCase({ title: 'x' }, 0).acceptanceId, '')
})

test('拆卡：功能点的验收条件原样变成卡的验收清单（id 保持一致）', () => {
  const checklist = checklistFromAcceptance(point.acceptance)
  assert.equal(checklist.length, 2, '两条验收条件 → 两条清单项')
  assert.deepEqual(checklist.map(item => item.id), ['a1', 'a2'], 'id 要跟需求上的一致，矩阵才认得出')
  assert.match(checklist[0].text, /423/)
  assert.equal(checklist.every(item => item.done === false), true, '新拆出来的卡一项都没勾')
  assert.deepEqual(checklistFromAcceptance(undefined), [], '没有验收条件时返回空数组（路由会退回模板）')
  assert.deepEqual(checklistFromAcceptance(['纯文本条件']).map(item => item.text), ['纯文本条件'], '字符串也能收')
})
