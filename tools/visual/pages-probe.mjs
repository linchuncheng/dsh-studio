#!/usr/bin/env node
/**
 * 六页回归（假宿主 + 真 Chrome）：把每个页签都点一遍，验三件事——
 *   1. 这一页真的渲染出了它该有的东西（不是空白、也不是「渲染失败」）
 *   2. 页面里没有 pageerror，边界里没有「工作空间渲染失败」
 *   3. 顺手截图到 tmp/pages/<页签>.png，方便肉眼对标
 *
 * 为什么要有它：换组件（BoardUI 那套）最容易整页崩，而 React 的错误边界会把异常
 * 吞在自己的渲染树里，pageerror 是空的（见 AGENTS.md §11）。所以必须看 innerText。
 *
 * 页签换成了 BoardUI 的胶囊（button[aria-pressed]），不再是 role=tab，
 * 所以这里按文案点 .ds-head-tabs 下的 button。
 *
 *   node tools/visual/pages-probe.mjs
 */
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
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

const now = Date.now()
const baseTask = {
  type: 'requirement', priority: 'normal', requirementId: '', artifacts: [], cases: [],
  checklist: [], history: [], tags: [], acceptance: [], links: {}, dispatch: {},
  design: null, worktree: null, blocked: null, sla: null, dueAt: 0, pointId: '',
  domain: '', requirement: '', updatedAt: now, commentCount: 0, coding: null,
}
const state = {
  revision: 3,
  updatedAt: now,
  profile: 'web',
  statuses: STATUSES,
  roles: ROLE_IDS,
  priorities: PRIORITIES,
  config: defaultConfig(),
  tasks: [
    { ...baseTask, id: 't-1', code: 'DEV-1', title: '库存预占与超时释放', status: 'dev' },
    { ...baseTask, id: 't-2', code: 'DEV-2', title: '支付回调重试', status: 'test' },
  ],
  requirements: [],
  releases: [],
  experts: [],
  agents: [],
  locked: false,
}
// 效能页要的形状（照 index.js 的 buildAnalytics 给空数据版）
const analyticsBody = {
  ok: true,
  analytics: {
    days: 30, project: '', generatedAt: now, scope: { tasks: 2, moved: 0, done: 0 },
    cycle: { count: 0, avgDays: 0, medianDays: 0, p90Days: 0, buckets: [{ id: 'fast', label: '≤1 天', count: 0 }, { id: 'normal', label: '1–3 天', count: 0 }, { id: 'slow', label: '3–7 天', count: 0 }, { id: 'verySlow', label: '>7 天', count: 0 }] },
    rework: { moved: 0, reworked: 0, rate: 0, reviewRework: 0, testRework: 0, firstPassRate: 0, worst: [{ id: 't-1', code: 'DEV-1', title: '库存预占与超时释放', backward: 2, status: 'dev' }] },
    columns: STATUSES.map(item => ({ status: item.id, label: item.label, avgDays: 0, cards: 0 })),
    throughput: [],
    ai: { artifactsTotal: 0, artifactsAi: 0, artifactsEmpty: 0, aiShare: 0, accepted: 0, acceptedRate: 0, emptyBody: 0, aiEmptyBody: 0, codingTasks: 0, codingApproved: 0, codingChanges: 0, codingApprovedRate: 0, unitTests: 0, unitPassed: 0, unitPassRate: 0, merged: 0 },
  },
}
const html = `<!doctype html><html><head><meta charset="utf-8"><title>pages probe</title></head>
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
  if (url.pathname === '/studio-api/analytics') return sendJson(200, analyticsBody)
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

// 每页「该有的东西」：至少一个能证明它不是空白页的标记；
// 第三项是「必须真的存在」的组件标记（用来盯住新换的 BoardUI 组件，别被别的选择器蒙混）
const PAGES = [
  ['工作台', '.ds-body, .ds-kpi, .ds-reg-banner', ''],
  ['看板', '.ds-col .ds-card, .ds-col', ''],
  ['需求', '.ds-panel, .ds-empty, .ds-req-desc', ''],
  ['用例', '.ds-panel, .ds-empty, .ds-listrow', ''],
  ['版本', '.ds-panel, .ds-empty, .ds-listrow', ''],
  ['效能', '[data-stat-card], [data-chart-card]', '[data-task-row]'],
  ['设置', '.ds-panel', ''],
]

let browser
const outDir = join(REPO, 'tmp', 'pages')
try {
  await mkdir(outDir, { recursive: true })
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1600, height: 1000 } })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error).slice(0, 200)))
  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('[data-dsh-studio] .ds-head-tabs button', { timeout: 45000 })

  for (const [label, marker, mustHave] of PAGES) {
    const clicked = await page.evaluate(sel => {
      const button = [...document.querySelectorAll('[data-dsh-studio] .ds-head-tabs button')]
        .find(node => (node.textContent || '').trim() === sel)
      if (!button) return false
      button.click()
      return true
    }, label)
    await sleep(900)
    const info = await page.evaluate((sel, required) => {
      const text = document.body.innerText || ''
      return {
        failed: text.includes('渲染失败'),
        failText: (text.match(/渲染失败[\s\S]{0,160}/) || [''])[0].replace(/\s+/g, ' '),
        marker: document.querySelector('[data-dsh-studio] ' + sel) !== null,
        required: required === '' ? true : document.querySelector('[data-dsh-studio] ' + required) !== null,
        length: text.length,
        selected: [...document.querySelectorAll('[data-dsh-studio] .ds-head-tabs button')]
          .filter(node => node.getAttribute('aria-pressed') === 'true')
          .map(node => (node.textContent || '').trim()),
      }
    }, marker, mustHave)
    check(`切到「${label}」`, clicked === true)
    check(`「${label}」渲染出了内容（${marker}）`, info.marker === true && info.required === true && info.failed === false, `${info.length} 字${info.failed ? ' / ' + info.failText : ''}${info.required ? '' : ' / 缺 ' + mustHave}`)
    check(`「${label}」的页签是高亮状态`, info.selected.includes(label), info.selected.join(','))
    await page.screenshot({ path: join(outDir, `${label}.png`) })
  }

  check('全程没有 pageerror', errors.length === 0, errors.join(' | '))
} catch (error) {
  console.error('探针中断：' + (error?.message ?? error))
  checks.push({ name: '运行', ok: false })
} finally {
  await browser?.close?.()
  server.close()
}
const failed = checks.filter(item => item.ok !== true)
console.log('')
console.log((failed.length === 0 ? '全部通过' : failed.length + ' 项失败') + '（' + checks.length + ' 项）· 截图在 tmp/pages/')
process.exit(failed.length === 0 ? 0 : 1)
