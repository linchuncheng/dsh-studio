// 「这条技能有没有用」的读数：只看台账，不加埋点。
// 判据：卡被挂技能的那位专家接手 = 这张卡用上了该技能；卡被打回 = 一次返工。
import assert from 'node:assert/strict'
import test from 'node:test'

import { skillUsage, skillUsageLine } from '../src/host/skill-usage.js'

const card = (overrides = {}) => ({
  id: 't-1', code: 'DEV-001', title: 'x', status: 'done', history: [], agentFailures: 0, reopenCount: 0,
  ...overrides,
})
// 列往回退 = 返工（和效能页 taskRework 同一条定义）
const reworked = { id: 't-2', code: 'DEV-002', title: 'y', status: 'dev', expert: 'dev', history: [{ status: 'review' }, { status: 'dev' }] }

const state = (expertSkills, tasks, extraExperts = []) => ({
  config: { experts: [{ id: 'dev', name: '开发工程师', skills: expertSkills }, ...extraExperts] },
  tasks,
})

test('技能使用证据：被用上几张卡、其中几张被打回', () => {
  const rows = skillUsage(state(['order-filter'], [card({ expert: 'dev' }), reworked]))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'order-filter')
  assert.equal(rows[0].cards, 2)
  assert.equal(rows[0].done, 1)
  assert.equal(rows[0].rework, 1)
  assert.equal(rows[0].reworkRate, 50, '2 张卡里 1 张被打回 = 50%')
  assert.deepEqual(rows[0].experts, ['开发工程师'])
  assert.match(rows[0].reasons.map(item => item.reason).join(' '), /被打回 1 次/)
})

test('技能使用证据：没被任何卡用上的技能不出现（面板显示「还没被用上」，不是 0%）', () => {
  const rows = skillUsage(state(['never-used'], [card()]))
  assert.equal(rows.length, 0, '不产生 0 张卡的行')
  assert.match(skillUsageLine(undefined), /还没被用上/)
  assert.equal(skillUsageLine({ name: 'x', cards: 0, done: 0, rework: 0, reworkRate: null }).includes('0%'), false, '0 张卡不该显示成 0%')
})

test('技能使用证据：停用的专家、没派单的卡都不算', () => {
  const disabled = { id: 'qa', name: '测试工程师', skills: ['qa-check'], enabled: false }
  const idle = card({ id: 't-9', expert: '', dispatch: null })
  const rows = skillUsage(state(['dev-skill'], [card({ expert: 'dev' }), idle], [disabled]))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].cards, 1, '没派单的卡不算用上')
  assert.equal(rows.some(row => row.name === 'qa-check'), false, '停用专家挂的技能不该被统计')
})

test('技能使用证据：按覆盖卡数降序，同数按名字', () => {
  const multi = { id: 'multi', name: '多面手', skills: ['b-skill', 'a-skill'] }
  const rows = skillUsage({
    config: { experts: [{ id: 'dev', name: '开发工程师', skills: ['c-skill'] }, multi] },
    tasks: [card({ expert: 'multi' }), card({ id: 't-3', expert: 'dev' }), card({ id: 't-4', expert: 'multi' })],
  })
  assert.deepEqual(rows.map(row => `${row.name}:${row.cards}`), ['a-skill:2', 'b-skill:2', 'c-skill:1'])
})
