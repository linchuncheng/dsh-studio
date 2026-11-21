// 用例定义可改：接口 / shell / 数据库 / 浏览器四种都要能 update，且尊重执行开关。
import assert from 'node:assert/strict'
import test from 'node:test'

import { configureTaskRoutes, handleTaskRoute } from '../src/host/routes/tasks.js'

const makeStore = (config, cases = []) => {
  const state = {
    config,
    tasks: [{
      id: 't-1', title: '卡', status: 'test', role: 'qa', cases,
      checklist: [], artifacts: [], comments: [], history: [], updatedAt: 0,
    }],
  }
  return { state, snapshot: () => state, mutate: async fn => { fn(state); return state } }
}
const testing = extra => ({
  envs: [], defaultEnv: '', timeoutMs: 3000, allowHosts: [], concurrency: 1,
  allowShell: false, allowDb: false, allowBrowser: false, ...extra,
})
const call = async (store, body) => {
  configureTaskRoutes({
    readJsonBody: async () => body,
    sendJson: () => {},
    publicState: () => ({}),
    autoBugFromCase: async () => ({}),
  })
  return handleTaskRoute({
    method: 'POST', route: '/task/case', req: {}, res: {}, store,
    url: new URL('http://localhost/task/case'),
  })
}

test('用例定义：shell 命令可以改，lastRun 不被清掉', async () => {
  const store = makeStore({ testing: testing({ allowShell: true }) }, [{
    id: 'c1', title: 'shell', result: 'pass', lastRun: { at: 1, ok: true }, shell: { command: 'old', expectExit: 0 },
  }])
  assert.equal(await call(store, { id: 't-1', action: 'update', caseId: 'c1', shell: { command: 'npm test', expectContains: 'ok' } }), true)
  const saved = store.state.tasks[0].cases[0]
  assert.equal(saved.shell.command, 'npm test')
  assert.equal(saved.shell.expectContains, 'ok')
  assert.equal(saved.lastRun.at, 1, '改定义不该丢执行记录')
})

test('用例定义：开关没开时拒绝改 shell / db / 浏览器，不让"跑不了还改得欢"', async () => {
  const store = makeStore({ testing: testing({}) }, [
    { id: 'c1', title: 'shell', shell: { command: 'x' } },
    { id: 'c2', title: 'db', db: { file: '/tmp/a.db', sql: 'select 1' } },
    { id: 'c3', title: 'browser', browser: { url: '/x' } },
  ])
  await assert.rejects(() => call(store, { id: 't-1', action: 'update', caseId: 'c1', shell: { command: 'y' } }), /allowShell/)
  await assert.rejects(() => call(store, { id: 't-1', action: 'update', caseId: 'c2', db: { file: '/tmp/a.db', sql: 'select 1' } }), /allowDb/)
  await assert.rejects(() => call(store, { id: 't-1', action: 'update', caseId: 'c3', browser: { url: '/y' } }), /allowBrowser/)
})

test('用例定义：db / browser 开关打开后能改，传 null 能清掉', async () => {
  const store = makeStore({ testing: testing({ allowDb: true, allowBrowser: true, allowShell: true }) }, [
    { id: 'c1', title: 'db', db: { file: '/tmp/a.db', sql: 'select 1' } },
    { id: 'c2', title: 'browser', browser: { url: '/x' } },
  ])
  await call(store, { id: 't-1', action: 'update', caseId: 'c1', db: { file: '/tmp/b.db', sql: 'select 2', expectColumn: 'n', expectValue: '2' } })
  await call(store, { id: 't-1', action: 'update', caseId: 'c2', browser: { url: '/y', expectText: '欢迎' } })
  const cases = store.state.tasks[0].cases
  assert.equal(cases[0].db.sql, 'select 2')
  assert.equal(cases[0].db.expectColumn, 'n')
  assert.equal(cases[1].browser.url, '/y')
  assert.equal(cases[1].browser.expectText, '欢迎')
  await call(store, { id: 't-1', action: 'update', caseId: 'c1', db: null })
  assert.equal(store.state.tasks[0].cases[0].db, null)
})
