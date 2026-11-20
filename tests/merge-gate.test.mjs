// 合并门禁：算「能不能合」+ 把结论发布成 GitLab 提交状态。
// 和准出的区别写在两个断言里：没签字也能合（合并看证据，验收看人）。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { SecretStore, StudioStore } from '../src/host/store.js'
import { publishMergeGate } from '../src/host/integrations.js'
import { MERGE_GATE_NAME, mergeGateFor } from '../src/host/merge-gate.js'
import { configureCodingRoutes, handleCodingRoute } from '../src/host/routes/coding.js'

const baseTask = (overrides = {}) => ({
  id: 't-m1',
  code: 'DEV-001',
  title: '（自检）合并门禁',
  type: 'dev',
  status: 'review',
  project: 'proj-1',
  service: '',
  gitlabProject: 'gl-1',
  gitlabMR: { iid: 7, title: 'feat', state: 'opened', url: '' },
  blocked: null,
  checklist: [],
  artifacts: [],
  comments: [],
  cases: [
    { id: 'c1', title: '主流程', result: 'pass', http: { method: 'GET', url: '/api/x', expectStatus: 200 } },
  ],
  coding: {
    agent: 'claude-code',
    branch: 'feat/m',
    commits: [{ sha: 'a1b2c3d4e5f6' }],
    files: [{ path: 'src/x.js' }],
    review: { status: 'approved', by: '架构师', note: '可以' },
    verified: { ok: true },
    gitlab: { pipeline: 'success', commitList: [] },
  },
  ...overrides,
})

const stateFor = task => ({
  config: { experts: [], projects: [], gitlab: { projects: [] } },
  requirements: [],
  tasks: [task],
})

test('合并门禁：没代码改动的卡不适用，不会被拦', () => {
  const gate = mergeGateFor(stateFor(baseTask({ coding: null, gitlabMR: { iid: 0 } })), baseTask({ coding: null, gitlabMR: { iid: 0 } }))
  assert.equal(gate.applicable, false)
  assert.equal(gate.ready, true)
})

test('合并门禁：评审没过 / 用例没跑过 / 用例挂了都要拦', () => {
  const pending = baseTask({ coding: { ...baseTask().coding, review: { status: 'pending' } } })
  assert.equal(mergeGateFor(stateFor(pending), pending).ready, false)
  assert.match(mergeGateFor(stateFor(pending), pending).blockers.join(), /代码评审还没通过/)

  const draftOnly = baseTask({ cases: [{ id: 'c1', title: '只有标题', result: 'pending' }] })
  assert.match(mergeGateFor(stateFor(draftOnly), draftOnly).blockers.join(), /只有标题/)

  const failed = baseTask({ cases: [{ id: 'c1', title: '挂了', result: 'fail', shell: { command: 'pnpm test', expectExit: 0 } }] })
  assert.match(mergeGateFor(stateFor(failed), failed).blockers.join(), /用例不通过/)

  const neverRan = baseTask({ cases: [{ id: 'c1', title: '没跑', result: 'pending', http: { method: 'GET', url: '/api/x', expectStatus: 200 } }] })
  assert.match(mergeGateFor(stateFor(neverRan), neverRan).blockers.join(), /一条都没通过/)
})

test('合并门禁：项目检查没跑/没通过、执行记录对不上、流水线失败都要拦', () => {
  const withQuality = (quality) => {
    const state = stateFor(baseTask())
    state.config.projects = [{
      id: 'proj-1', name: 'p', key: 'P', qualityCmd: 'npm run check', qualityTimeoutMs: 60000, services: [],
    }]
    const task = { ...baseTask(), quality }
    state.tasks = [task]
    return { state, task }
  }
  const notRun = withQuality(null)
  assert.match(mergeGateFor(notRun.state, notRun.task).blockers.join(), /还没跑过/)
  const failedQuality = withQuality({ cmd: 'npm run check', ok: false, exitCode: 2, timedOut: false })
  assert.match(mergeGateFor(failedQuality.state, failedQuality.task).blockers.join(), /项目检查不通过/)
  const okQuality = withQuality({ cmd: 'npm run check', ok: true, exitCode: 0 })
  assert.equal(mergeGateFor(okQuality.state, okQuality.task).ready, true, '全都过了就该放行')

  const mismatch = baseTask({ coding: { ...baseTask().coding, verified: { ok: false, missingCommits: ['abc'], missingFiles: [] } } })
  assert.match(mergeGateFor(stateFor(mismatch), mismatch).blockers.join(), /执行记录和代码对不上/)

  const pipeline = baseTask({ coding: { ...baseTask().coding, gitlab: { pipeline: 'failed', commitList: [] } } })
  assert.match(mergeGateFor(stateFor(pipeline), pipeline).blockers.join(), /流水线没通过/)
})

test('合并门禁：和准出不是一回事——没签字也能合（合并看证据）', () => {
  const task = baseTask({ signoff: null, checklist: [] })
  assert.equal(mergeGateFor(stateFor(task), task).ready, true, '验收签字不该挡合并')
})

test('路由：publish=false 只出结论，没配 GitLab 也能用（自检脚本走这条路）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-merge-route-'))
  const store = new StudioStore(join(dir, 'state.json'), { dbFile: join(dir, 'state.db'), secrets: new SecretStore(join(dir, '.secrets.json')) })
  try {
    await store.ready
    await store.mutate(state => { state.tasks.push(baseTask()) })
    let captured = null
    configureCodingRoutes({
      readJsonBody: async () => ({ id: 't-m1', publish: false }),
      sendJson: (res, status, body) => { captured = { status, body } },
      publicState: () => ({}),
      publishMergeGate: async () => { throw new Error('publish=false 时不该发 GitLab') },
    })
    const handled = await handleCodingRoute({ method: 'POST', route: '/task/merge-gate', req: {}, res: {}, store, url: new URL('http://x/task/merge-gate') })
    assert.equal(handled, true)
    assert.equal(captured.status, 200)
    assert.equal(captured.body.published, false)
    assert.equal(captured.body.gate.applicable, true)
    assert.equal(captured.body.gate.ready, true, JSON.stringify(captured.body.gate.blockers))
  } finally {
    store.db?.close?.()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('发布：把结论发成 studio/merge-gate 提交状态，并写回卡片', async () => {
  const posted = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      if (req.method === 'GET' && req.url.includes('/merge_requests/7')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ iid: 7, sha: 'feedfacecafe', state: 'opened' }))
        return
      }
      if (req.method === 'POST' && req.url.includes('/statuses/')) {
        posted.push({ url: req.url, body: JSON.parse(body === '' ? '{}' : body) })
        res.writeHead(201, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ id: 1 }))
        return
      }
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{}')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  const dir = mkdtempSync(join(tmpdir(), 'dsh-merge-gate-'))
  const store = new StudioStore(join(dir, 'state.json'), { dbFile: join(dir, 'state.db'), secrets: new SecretStore(join(dir, '.secrets.json')) })
  try {
    await store.ready
    await store.mutate(state => {
      state.config.gitlab = {
        url: `http://127.0.0.1:${port}`, token: 'test-token', group: '', project: '', syncEnabled: false, syncLabel: '',
        lastSyncAt: 0, lastSyncError: '',
        projects: [{ id: 'gl-1', name: 'demo', url: '', project: 'demo/order', group: '', token: '', syncEnabled: false, syncLabel: '', lastSyncAt: 0, lastSyncError: '' }],
      }
      state.tasks.push(baseTask({ coding: { ...baseTask().coding, review: { status: 'pending' } } }))
    })

    const failed = await publishMergeGate(store, 't-m1', { by: '架构师' })
    assert.equal(failed.status.state, 'failed')
    assert.equal(posted.length, 1)
    assert.match(posted[0].url, /statuses\/feedfacecafe$/, '状态要挂在 MR 的头提交上')
    assert.equal(posted[0].body.name, MERGE_GATE_NAME)
    assert.equal(posted[0].body.state, 'failed')
    assert.ok(posted[0].body.description.length > 0, '描述不能是空的')
    const stored = store.snapshot().tasks.find(item => item.id === 't-m1')
    assert.equal(stored.mergeGate.state, 'failed')
    assert.equal(stored.mergeGate.sha, 'feedfacecafe')
    assert.ok(stored.mergeGate.blockers.some(item => item.includes('评审')), '拦阻原因要一起存下来')

    // 修好之后重新发布：这次必须是 success
    await store.mutate(state => {
      const target = state.tasks.find(item => item.id === 't-m1')
      target.coding = { ...target.coding, review: { status: 'approved', by: '架构师', note: 'ok' } }
    })
    const passed = await publishMergeGate(store, 't-m1', { by: '架构师' })
    assert.equal(passed.status.state, 'success')
    assert.equal(posted.length, 2)
    assert.equal(posted[1].body.state, 'success')
    assert.equal(store.snapshot().tasks.find(item => item.id === 't-m1').mergeGate.state, 'success')

    // 没有 MR 的卡：明确报错，不允许静默通过
    await store.mutate(state => {
      const target = state.tasks.find(item => item.id === 't-m1')
      target.gitlabMR = { iid: 0, title: '', state: '', url: '' }
    })
    await assert.rejects(() => publishMergeGate(store, 't-m1', { by: '架构师' }), /还没关联 MR/)
  } finally {
    store.db?.close?.()
    await new Promise(resolve => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})
