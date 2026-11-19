import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { addAssertedCases } from '../src/host/executor.js'
import { coverageStrength, isExecutable } from '../src/host/case-strength.js'

/* 用例入库的口子：写不出来的用例必须在**生成这一刻**失败。
 * 历史教训：全库 101 条用例 0 条带断言，谁也不知道哪条真的验过（docs/product.md §5.1）。 */

function fakeStore(config, tasks = [{ id: 't-1', title: '卡片', cases: [], updates: 0, updatedAt: 0 }]) {
  const state = { config, tasks }
  return {
    state,
    snapshot: () => state,
    async mutate(fn) {
      fn(state)
      for (const task of state.tasks) task.updates += 1
      return state
    },
  }
}

const testing = extra => ({ envs: [], defaultEnv: '', timeoutMs: 3000, allowHosts: ['127.0.0.1', 'localhost'], concurrency: 1, allowShell: false, ...extra })

test('用例入库：不给断言的不收（不能又攒一条草稿）', async () => {
  const store = fakeStore({ testing: testing({}) })
  await assert.rejects(
    () => addAssertedCases(store, 't-1', [{ title: '登录看起来正常' }], { by: '测试专家' }),
    /跑不了/,
  )
  assert.equal(store.state.tasks[0].cases.length, 0, '不合格的用例一条都不该写进去')
})

test('用例入库：缺期望状态码的不收（跑完也判不出对错）', async () => {
  const store = fakeStore({ testing: testing({ envs: [{ id: 'e1', name: '本地', baseUrl: 'http://127.0.0.1:1' }], defaultEnv: 'e1' }) })
  await assert.rejects(
    () => addAssertedCases(store, 't-1', [{ title: '查健康', method: 'GET', path: '/health' }]),
    /expectStatus/,
  )
})

test('用例入库：只有相对地址又没配环境时不收', async () => {
  const store = fakeStore({ testing: testing({}) })
  await assert.rejects(
    () => addAssertedCases(store, 't-1', [{ title: '查健康', method: 'GET', path: '/health', expectStatus: 200 }]),
    /baseUrl/,
  )
})

test('用例入库：一条不合法就整体拒绝，能跑的也不写（全有或全无）', async () => {
  const store = fakeStore({ testing: testing({ envs: [{ id: 'e1', name: '本地', baseUrl: 'http://127.0.0.1:1' }], defaultEnv: 'e1' }) })
  await assert.rejects(
    () => addAssertedCases(store, 't-1', [
      { title: '查健康', method: 'GET', path: '/health', expectStatus: 200 },
      { title: '看着没问题' },
    ]),
    /1\/2 条用例不合法/,
  )
  assert.equal(store.state.tasks[0].cases.length, 0)
})

test('用例入库：合法用例写进去、算作可执行，并当场试跑', async () => {
  const server = createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, path: req.url }))
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const port = server.address().port
  try {
    const store = fakeStore({
      testing: testing({ envs: [{ id: 'e1', name: '本地桩', baseUrl: `http://127.0.0.1:${port}` }], defaultEnv: 'e1' }),
    })
    const result = await addAssertedCases(store, 't-1', [
      { title: '健康检查返回 200', method: 'GET', path: '/health', expectStatus: 200, expectContains: 'ok' },
    ], { by: '测试专家' })

    assert.equal(result.added, 1)
    assert.equal(result.total, 1)
    const saved = store.state.tasks[0].cases[0]
    assert.equal(isExecutable(saved), true, '写进去的用例必须算可执行')
    assert.equal(coverageStrength(store.state.tasks[0].cases).rate, 1)
    assert.equal(result.verified.ok, true, '当场试跑要真的打过去并成功')
    assert.equal(result.verified.status, 200)
    assert.equal(saved.result, 'pass', '试跑结果要落在用例上，不能只回个话')
    assert.match(saved.note, /生成时试跑/)
  } finally {
    await new Promise(done => server.close(done))
  }
})

test('用例入库：试跑打不通要说实话，不能报成已生成', async () => {
  const store = fakeStore({
    testing: testing({ envs: [{ id: 'e1', name: '打不通', baseUrl: 'http://127.0.0.1:1' }], defaultEnv: 'e1' }),
  })
  const result = await addAssertedCases(store, 't-1', [
    { title: '连不上也要如实回报', method: 'GET', path: '/health', expectStatus: 200 },
  ])
  assert.equal(result.verified.ok, false)
  assert.equal(store.state.tasks[0].cases[0].result, 'fail')
  assert.match(store.state.tasks[0].cases[0].note, /失败/)
})

test('用例入库：重名的跳过但不重复写入', async () => {
  const store = fakeStore({ testing: testing({}) }, [{ id: 't-1', title: '卡片', cases: [{ id: 'c-old', title: '已有用例', result: 'pending' }], updates: 0, updatedAt: 0 }])
  const result = await addAssertedCases(store, 't-1', [
    { title: '已有用例', method: 'GET', path: 'http://127.0.0.1:1/x', expectStatus: 200 },
  ])
  assert.equal(result.added, 0)
  assert.equal(result.skipped, 1)
  assert.equal(store.state.tasks[0].cases.length, 1)
})

test('用例入库：shell 用例的字段名必须和 runner 读的一致（expectExit）', async () => {
  const store = fakeStore({ testing: testing({ allowShell: true }) })
  const result = await addAssertedCases(store, 't-1', [
    { title: '跑一条一定成功的命令', command: 'node -e "process.exit(0)"', expectExit: 0 },
  ], { by: '测试专家' })
  assert.equal(result.added, 1)
  const saved = store.state.tasks[0].cases[0]
  // 这一天踩过的坑：这里写成 expectExitCode，runner 读 shell.expectExit 得到 undefined，
  // 于是「退出码 0（期望 undefined）」→ 平台自动开了一张假缺陷卡。
  assert.equal(Object.hasOwn(saved.shell, 'expectExitCode'), false, '不该出现 expectExitCode 这个自造字段')
  assert.equal(saved.shell.expectExit, 0)
  assert.equal(result.verified.ok, true, '当场试跑要能真的跑通，字段名错了这里就会红')
})

test('用例入库：写进 state 的形状 = 从磁盘重新加载后的形状（sanitizeCase 一致）', async () => {
  const { sanitizeCase } = await import('../src/host/domain.js')
  const store = fakeStore({ testing: testing({}) })
  await addAssertedCases(store, 't-1', [
    { title: '形状一致', method: 'GET', path: 'http://127.0.0.1:1/x', expectStatus: 200, expectContains: 'ok' },
  ])
  const saved = store.state.tasks[0].cases[0]
  const reloaded = sanitizeCase(JSON.parse(JSON.stringify(saved)), 0)
  assert.deepEqual(Object.keys(saved).sort(), Object.keys(reloaded).sort(), '字段集合必须一致，否则重启后行为会变')
  assert.deepEqual(saved.http, reloaded.http)
})
