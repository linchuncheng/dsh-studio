// 「写好的尺子要接到界面上」的回归：停摆计数、可执行用例占比。
//
// 背景：`dispatch-state.js` 的 isStalled / countStalled 和 `case-strength.js` 的 meetsCoverageTarget
// 一直只有单测在用 —— 尺子做了，没人量。2026-11-20 把它们接进工作台与需求准出。
import assert from 'node:assert/strict'
import test from 'node:test'

import { configureExecutor, buildDashboard, requirementProgress } from '../src/host/executor.js'

configureExecutor(new Proxy({
  bugSla: () => ({ state: 'ok', dueAt: 0, leftMs: 0 }),
  healthReport: () => ({ broken: 0 }),
  activeDispatcher: null,
  releaseGate: () => ({ blockers: [] }),
  serviceDependencies: () => undefined,
  serviceConflicts: () => undefined,
}, { get: (target, key) => (key in target ? target[key] : () => undefined) }))

const card = (overrides = {}) => ({
  id: 't-1', code: 'DEV-001', title: '登录锁定', status: 'dev', role: 'dev',
  requirementId: 'r1', checklist: [], artifacts: [], comments: [], history: [], cases: [], blocked: null,
  ...overrides,
})

test('工作台数得清「停摆」：派单印记还在这一列、但会话已经不在跑', () => {
  // 真停摆 = 印记匹配这一列但没人收：用 abandoned（停止键写的是 stopped，那是人主动停的，不算故障）
  const stalled = card({ dispatch: { status: 'dev', state: 'abandoned', attempts: 2 } })
  const running = card({ id: 't-2', code: 'DEV-002', dispatch: { status: 'dev', state: 'running' } })
  const queued = card({ id: 't-3', code: 'DEV-003', dispatch: null })
  const dash = buildDashboard({ tasks: [stalled, running, queued], requirements: [], releases: [], config: { experts: [] } })
  assert.equal(dash.risks.stalled, 1, '只有那 1 张是真的停摆（running 在跑、queued 没派过）')
  assert.deepEqual(dash.list.stalled.map(item => item.id), ['t-1'])
})

test('需求准出：可执行用例占比低于 60% 会拦住签字，并给出读数', () => {
  const requirement = { id: 'r1', code: 'REQ-2026-001', title: '退款流水', points: [], status: 'active' }
  const tasks = [card({
    cases: [
      { id: 'c1', title: '真用例', result: 'pass', http: { method: 'GET', url: '/x', expectStatus: 200 } },
      { id: 'c2', title: '只有标题 1', result: 'pending' },
      { id: 'c3', title: '只有标题 2', result: 'pending' },
      { id: 'c4', title: '只有标题 3', result: 'pending' },
    ],
  })]
  const progress = requirementProgress({ tasks, requirements: [requirement], releases: [], config: { experts: [], design: {} } }, requirement)
  const blockers = (progress.gate?.blockers ?? []).join(' ')
  assert.equal(progress.gate?.ready, false, '低于 60% 不该放行')
  assert.match(blockers, /可执行用例只有 1\/4/, '要把 1/4 这个数字说出来：' + blockers)
  assert.match(blockers, /60%/, '要带上目标值，否则人不知道差多少')
  assert.deepEqual(progress.coverage, { total: 4, executable: 1, draft: 3, rate: 0.25 }, '列表/详情要能直接显示覆盖率')
})

test('需求准出：用例都带断言时不提这条（别在达标的时候唠叨）', () => {
  const requirement = { id: 'r1', code: 'REQ-2026-002', title: 'x', points: [], status: 'active' }
  const tasks = [card({
    cases: [
      { id: 'c1', title: 'a', result: 'pass', http: { method: 'GET', url: '/a', expectStatus: 200 } },
      { id: 'c2', title: 'b', result: 'pass', shell: { command: 'true', expectExit: 0 } },
    ],
  })]
  const progress = requirementProgress({ tasks, requirements: [requirement], releases: [], config: { experts: [], design: {} } }, requirement)
  assert.ok(!(progress.gate?.blockers ?? []).join(' ').includes('可执行用例只有'), '达标了不该有这条')
})
