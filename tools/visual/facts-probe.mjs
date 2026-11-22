#!/usr/bin/env node
/**
 * 卡片抽屉的「从 GitLab 核对」结果真浏览器自验（假宿主 + 真 Chrome）：
 *   逐条提交、CI 单测、自报里找不到的提交，三样都要看得见。
 *
 * 需求页那半不放这里：它要 matrix / impact / gate / progress 四份真数据，
 * 手搓假数据等于把宿主半边重写一遍；那几项由 tests/repo.test.mjs 的源码契约测试盯着。
 *
 *   node tools/visual/facts-probe.mjs
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultConfig, PRIORITIES, ROLE_IDS, STATUSES } from '../../src/host/domain.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const require = createRequire(import.meta.url)
let puppeteer
try {
  puppeteer = require('puppeteer-core')
} catch {
  console.error('需要 puppeteer-core：pnpm add -D puppeteer-core')
  process.exit(2)
}
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'

const config = defaultConfig()
const now = Date.now()
const task = {
  id: 't-1',
  code: 'DEV-1',
  title: '库存预占与超时释放',
  status: 'dev',
  type: 'requirement',
  priority: 'normal',
  requirementId: 'req-1',
  artifacts: [],
  cases: [],
  checklist: [],
  history: [],
  tags: [],
  acceptance: [],
  links: {},
  dispatch: {},
  design: null,
  worktree: null,
  blocked: null,
  sla: null,
  dueAt: 0,
  pointId: '',
  domain: '',
  severity: '',
  requirement: '',
  updatedAt: now,
  commentCount: 0,
  coding: {
    agent: 'dev',
    branch: 'task/DEV-1',
    files: [{ id: 'f1', path: 'src/reserve.js', change: 'modified', additions: 10, deletions: 2 }],
    commits: [{ id: 'c1', sha: 'a1b2c3d4', message: 'feat: 预占', files: 2 }],
    unitTests: { total: 12, passed: 10, failed: 2, at: now },
    review: { status: 'pending', by: '', at: 0, note: '' },
    gitlab: {
      at: now - 600_000,
      state: 'merged',
      title: 'feat: 库存预占（打桩）',
      pipeline: 'success',
      files: { declared: 1, actual: 3 },
      commits: { declared: 1, actual: 3 },
      commitList: [
        { id: 'x1', sha: 'a1b2c3d4', title: 'feat: 预占表与锁', author: 'Dev One' },
        { id: 'x2', sha: 'b2c3d4e5', title: 'feat: 超时释放', author: 'Dev One' },
        { id: 'x3', sha: 'c3d4e5f6', title: 'test: 预占用例', author: 'QA Two' },
      ],
      ci: { total: 12, passed: 11, failed: 1, skipped: 0, source: 'test_report' },
      missingCommits: ['deadbeef'],
      mismatches: ['自报 1 个文件，MR 里是 3 个', '自报的 1 个提交在 MR 里找不到：deadbeef'],
    },
  },
}
const state = {
  revision: 3,
  updatedAt: now,
  profile: 'web',
  statuses: STATUSES,
  roles: ROLE_IDS,
  priorities: PRIORITIES,
  config,
  tasks: [task],
  requirements: [],
  releases: [],
  experts: [],
  agents: [],
  locked: false,
}
const html = `<!doctype html><html><head><meta charset="utf-8"><title>facts probe</title></head>
<body><div id="root"></div>
<script>window.__ModuleLoader__ = { load(entry) { window.__STUDIO_PLUGIN__ = entry.factory(function (name) {
  if (name === 'react') return window.React
  throw new Error('harness: no module ' + name)
}) } }</script>
<script src="/react.js"></script><script src="/react-dom.js"></script><script src="/client.js"></script>
<script>(function () { try {
  var registered = {}
  var ctx = { slots: { inject: function (n, fn) { fn() }, register: function (def, Comp) { registered[def.key || def.name] = Comp; return function () {} } }, effect: function (fn) { return fn() } }
  window.__STUDIO_PLUGIN__.apply(ctx)
  var Page = registered.studio
  if (!Page) { window.__HARNESS_ERROR__ = 'no page'; return }
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Page, {}))
  window.__HARNESS_MOUNTED__ = true
} catch (e) { window.__HARNESS_ERROR__ = String(e) } })()</script></body></html>`

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const sendJson = (code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)) }
  if (url.pathname === '/studio-api/state') return sendJson(200, { ok: true, state })
  if (url.pathname === '/studio-api/analytics') return sendJson(200, { ok: true, analytics: null })
  if (url.pathname.startsWith('/studio-api/')) return sendJson(200, { ok: true, state })
  if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); return }
  const file = url.pathname === '/client.js' ? join(REPO, 'client.js')
    : url.pathname === '/react.js' ? join(REPO, 'web/node_modules/react/umd/react.production.min.js')
      : url.pathname === '/react-dom.js' ? join(REPO, 'web/node_modules/react-dom/umd/react-dom.production.min.js') : ''
  if (file === '') { res.writeHead(404).end(); return }
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' })
    res.end(body)
  } catch (error) { res.writeHead(500).end(String(error)) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const checks = []
const check = (name, ok, detail = '') => { checks.push({ name, ok: ok === true }); console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail === '' ? '' : ' — ' + detail)) }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let browser
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1600, height: 1100 } })
  const page = await browser.newPage()
  const errors = []
  const consoleErrors = []
  page.on('pageerror', error => errors.push(String(error).slice(0, 160)))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 400)) })
  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('[data-dsh-studio] .ds-head-tabs button', { timeout: 45000 })
  const clickTab = async label => {
    for (const tab of await page.$$('[data-dsh-studio] .ds-head-tabs button')) {
      if ((((await tab.evaluate(node => node.textContent)) ?? '').trim()) === label) { await tab.click(); return true }
    }
    return false
  }

  // ---- 1) 抽屉里的 GitLab 核对结果
  check('切到看板', await clickTab('看板'))
  await page.waitForSelector('[data-dsh-studio] [data-kanban-card]', { timeout: 30000 })
  await page.evaluate(() => document.querySelector('[data-dsh-studio] [data-kanban-card]')?.click())
  await page.waitForSelector('[data-gitlab-facts]', { timeout: 30000 }).catch(async error => {
    const dump = await page.evaluate(() => ({
      drawer: document.querySelector('[data-drawer]') !== null,
      text: (document.body.innerText || '').slice(0, 700),
    }))
    console.error('抽屉里没看到 GitLab 核对行：' + JSON.stringify(dump, null, 1))
    console.error('pageerror：' + errors.join(' | '))
    throw error
  })
  await sleep(400)
  const facts = await page.evaluate(() => {
    const node = document.querySelector('[data-gitlab-facts]')
    const text = document.body.textContent || ''
    return {
      line: node?.textContent ?? '',
      hasCommits: ['a1b2c3d4', 'b2c3d4e5', 'c3d4e5f6'].every(sha => text.includes(sha)),
      missing: text.includes('这些自报提交在 MR 里找不到') && text.includes('deadbeef'),
    }
  })
  check('GitLab 核对行写到了 CI 单测', facts.line.includes('CI 单测 11/12'), facts.line.slice(-40))
  check('逐条提交都列出来了', facts.hasCommits === true)
  check('自报里找不到的提交被点名', facts.missing === true)
  await page.evaluate(() => { document.querySelector('[data-drawer-overlay]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

  check('页面没有 pageerror', errors.length === 0, errors.join(' | '))
  await page.screenshot({ path: join(REPO, 'tmp', 'facts-probe.png') })
} catch (error) {
  console.error('探针中断：' + (error?.message ?? error))
  checks.push({ name: '运行', ok: false })
} finally {
  await browser?.close?.()
  server.close()
}
const failed = checks.filter(item => item.ok !== true)
console.log('')
console.log((failed.length === 0 ? '全部通过' : failed.length + ' 项失败') + '（' + checks.length + ' 项）')
process.exit(failed.length === 0 ? 0 : 1)
