// 浏览器用例：形状、可执行判定、默认关闭、以及「真开一个浏览器」跑一遍。
// 真跑那段在没有浏览器的机器上会自动跳过（CI 里没有 Chrome/Edge），所以两条路径都留着。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import test from 'node:test'

import { isExecutable, coverageStrength, resolveCaseResult } from '../src/host/case-strength.js'
import { resolveBrowserExecutable, runBrowserCase, sanitizeCaseBrowser } from '../src/host/browser-runner.js'

const executablePath = resolveBrowserExecutable({ testing: {} }, existsSync)
const skip = executablePath === null ? '这台机器上没有 Chrome / Edge' : false

test('形状：url / path 都认，步骤归一化，垃圾步骤丢掉，超时夹紧', () => {
  assert.equal(sanitizeCaseBrowser(null), null)
  assert.equal(sanitizeCaseBrowser({}), null, '什么都没有就不该产生一条空用例')
  const spec = sanitizeCaseBrowser({
    path: '/login',
    expectText: '登录',
    steps: [
      { click: '#submit' },
      { fill: '#user', text: 'zhang' },
      { wait: 999999 },
      { waitFor: '.toast' },
      { nonsense: true },
      'not-an-object',
    ],
    timeoutMs: 999999,
  })
  assert.equal(spec.url, '/login')
  assert.equal(spec.expectText, '登录')
  assert.equal(spec.steps.length, 4)
  assert.deepEqual(spec.steps.map(step => step.kind), ['click', 'fill', 'wait', 'waitFor'])
  assert.equal(spec.steps[2].ms, 10000, 'wait 要夹在 10 秒内')
  assert.equal(spec.timeoutMs, 120000, '超时夹在 2 分钟内')

  const many = sanitizeCaseBrowser({ url: '/', steps: Array.from({ length: 20 }, () => ({ click: '#a' })) })
  assert.equal(many.steps.length, 10, '最多 10 步，防止一条用例跑十分钟')
})

test('可执行判定：有地址才算能验（和接口用例同一把尺子）', () => {
  assert.equal(isExecutable({ browser: { url: '/x' } }), true)
  assert.equal(isExecutable({ browser: { url: '' } }), false)
  assert.equal(isExecutable({ browser: { expectText: 'x' } }), false)
  assert.equal(resolveCaseResult('pass', { browser: { url: '/x' } }), 'pass', '能跑的用例才允许标通过')
  assert.equal(resolveCaseResult('pass', { browser: { expectText: 'x' } }), 'pending', '没有地址还是草稿')
  const strength = coverageStrength([{ browser: { url: '/x' } }, { title: '只有标题' }])
  assert.equal(strength.executable, 1)
  assert.equal(strength.draft, 1)
})

test('默认关闭：没开 allowBrowser 就明确拒绝，不偷偷开浏览器', async () => {
  const result = await runBrowserCase({ browser: { url: 'http://127.0.0.1:1/' } }, { baseUrl: '' }, { testing: {} })
  assert.equal(result.ok, false)
  assert.match(result.error, /没开浏览器用例/)
})

test('没有浏览器：给出可照做的提示，不是崩一个堆栈', async () => {
  const result = await runBrowserCase(
    { browser: { url: 'http://127.0.0.1:1/' } },
    { baseUrl: '' },
    { testing: { allowBrowser: true, browserPath: '' , allowHosts: ['127.0.0.1'] } },
  )
  if (executablePath !== null) return // 有浏览器的机器上这条走真跑，跳过
  assert.equal(result.ok, false)
  assert.match(result.error, /没找到可用的浏览器/)
})

test('执行链：▶ 跑（runTaskCases）真的会挑到浏览器用例，不是「没有可执行的用例」', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { SecretStore, StudioStore } = await import('../src/host/store.js')
  const { configureExecutor, runTaskCases } = await import('../src/host/executor.js')
  configureExecutor(new Proxy({}, { get: () => () => undefined }))
  const dir = mkdtempSync(join(tmpdir(), 'dsh-browser-run-'))
  const store = new StudioStore(join(dir, 'state.json'), { dbFile: join(dir, 'state.db'), secrets: new SecretStore(join(dir, '.secrets.json')) })
  try {
    await store.ready
    await store.mutate(state => {
      state.config.testing = { ...state.config.testing, allowBrowser: false, allowHosts: ['127.0.0.1'], envs: [{ id: 'e1', name: '本地', baseUrl: 'http://127.0.0.1:1', headers: {} }], defaultEnv: 'e1' }
      state.tasks.push({
        id: 't-b2', code: 'TEST-002', title: '（自检）浏览器用例执行链', type: 'test', status: 'test', role: 'qa',
        requirementId: '', checklist: [], artifacts: [], comments: [], history: [], blocked: null,
        cases: [{ id: 'c-b1', title: '页面能打开', expected: '能打开', result: 'pending', browser: { url: 'http://127.0.0.1:1/', expectText: 'x' } }],
      })
    })
    // allowBrowser 关着：用例照样要进清单（否则就是「没有可执行的用例」那个老坑），跑出来是一条带原因的失败
    const result = await runTaskCases(store, 't-b2', { by: '测试' })
    assert.equal(result.run.total, 1, '浏览器用例要进执行清单')
    assert.equal(result.run.failed, 1)
    assert.match(String(result.run.results[0].error), /没开浏览器用例/)
  } finally {
    store.db?.close?.()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('真跑：打开页面、点按钮、填输入框，断言看得见的东西', { skip }, async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><html><body>'
      + '<h1 id="title">订单中心</h1>'
      + '<button id="go" onclick="document.getElementById(\'out\').textContent=\'已点击\'">点我</button>'
      + '<div id="out">未点击</div>'
      + '<input id="q" />'
      + '</body></html>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const config = { testing: { allowBrowser: true, allowHosts: ['127.0.0.1'], browserPath: executablePath, timeoutMs: 20000 } }
  try {
    const ok = await runBrowserCase({
      browser: {
        url: `http://127.0.0.1:${port}/`,
        steps: [{ click: '#go' }, { fill: '#q', text: 'abc' }, { waitFor: '#out' }],
        expectText: '已点击',
        expectSelector: '#out',
        expectStatus: 200,
      },
    }, { baseUrl: '' }, config)
    assert.equal(ok.ok, true, ok.error)
    assert.equal(ok.status, 200)
    assert.match(ok.preview, /订单中心/, 'preview 要带回页面上看到的内容')

    const bad = await runBrowserCase({
      browser: { url: `http://127.0.0.1:${port}/`, expectText: '这段文字不存在' },
    }, { baseUrl: '' }, config)
    assert.equal(bad.ok, false)
    assert.match(bad.error, /没有「这段文字不存在」/)

    // 相对地址要拼测试环境 baseUrl（浏览器用例和接口用例走同一套地址守卫）
    const relative = await runBrowserCase({ browser: { url: '/', expectText: '订单中心' } }, { baseUrl: `http://127.0.0.1:${port}` }, config)
    assert.equal(relative.ok, true, relative.error)

    // 白名单外的 host 直接拒，不启动浏览器
    const blocked = await runBrowserCase({ browser: { url: 'http://example.com/' } }, { baseUrl: '' }, config)
    assert.equal(blocked.ok, false)
    assert.match(blocked.error, /不在允许列表/)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
