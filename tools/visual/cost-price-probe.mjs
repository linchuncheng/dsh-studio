#!/usr/bin/env node
/**
 * 成本这一栏的自验：效能页能不能说清「钱是怎么算出来的」，以及「补价目」这条路走不走得通。
 *
 * 不需要真实 dsh 宿主：假宿主页面挂上构建产物，/costs 用一份"有 2 个模型没价目"的假数据，
 * 然后在真 Chrome 里走一遍：
 *   效能页 → 看到币种 / 价目来源 / 未配价目 → 点「补价目」→ 落到设置的成本与预算
 *   → 价目表里确实多了那两行（且提示"从效能页带过来 2 个"）。
 *
 *   node tools/visual/cost-price-probe.mjs
 *   CHROME_PATH=... node tools/visual/cost-price-probe.mjs
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
// 只配了一个模型的价目；deepseek-v4.1-pro 与 qwen3-coder 都还没价 → 效能页应该点名并给「补价目」
config.costs = { ...config.costs, prices: [{ model: 'deepseek-v4.1-flash', input: 2, output: 8, cacheRead: 0.2, cacheWrite: 0 }] }
const state = {
  revision: 5,
  updatedAt: Date.now(),
  profile: 'web',
  statuses: STATUSES,
  roles: ROLE_IDS,
  priorities: PRIORITIES,
  config,
  tasks: [{ id: 't-1', code: 'DEV-1', title: '预占', status: 'dev', type: 'requirement', priority: 'normal', requirements: [], artifacts: [], updatedAt: Date.now() }],
  requirements: [],
  releases: [],
  experts: [],
  agents: [],
  locked: false,
}
const costsBody = {
  ok: true,
  costs: { total: 12, avgMs: 4000, byModel: [{ key: 'deepseek-v4.1-flash', runs: 9 }], byPromptVersion: [], note: '' },
  usage: {
    totals: { calls: 12, input: 12000, output: 3000, cacheRead: 0, cacheWrite: 0, total: 15000, cost: 0.05, unknownCalls: 3 },
    byCard: [],
    byExpert: [],
    unpricedModels: [{ model: 'deepseek-v4.1-pro', calls: 2 }, { model: 'qwen3-coder', calls: 1 }],
  },
  budget: { ...config.costs, runs: 12, hours: 1, runRate: 2, hourRate: 1, level: 'ok', hint: '' },
}
// 效能页要的那几份数据：形状照 index.js 的 buildAnalytics / insights 路由给（空数据版）。
const analyticsBody = {
  ok: true,
  analytics: {
    days: 30,
    project: '',
    generatedAt: Date.now(),
    scope: { tasks: 1, moved: 0, done: 0 },
    cycle: {
      count: 0, avgDays: 0, medianDays: 0, p90Days: 0,
      buckets: [{ id: 'fast', label: '≤1 天', count: 0 }, { id: 'normal', label: '1–3 天', count: 0 }, { id: 'slow', label: '3–7 天', count: 0 }, { id: 'verySlow', label: '>7 天', count: 0 }],
    },
    rework: { moved: 0, reworked: 0, rate: 0, reviewRework: 0, testRework: 0, firstPassRate: 0, worst: [] },
    columns: STATUSES.map(item => ({ status: item.id, label: item.label, avgDays: 0, cards: 0 })),
    throughput: [],
    ai: {
      artifactsTotal: 0, artifactsAi: 0, artifactsEmpty: 0, aiShare: 0, accepted: 0, acceptedRate: 0, emptyBody: 0, aiEmptyBody: 0,
      codingTasks: 0, codingApproved: 0, codingChanges: 0, codingApprovedRate: 0, unitTests: 0, unitPassed: 0, unitPassRate: 0, merged: 0,
    },
  },
}
const qualityBody = { ok: true, quality: { experts: [], totals: { dispatched: 0, avgMs: 0, failures: 0, reopens: 0, reworkRate: 0 }, cost: { note: '' } } }
const workloadBody = { ok: true, workload: { experts: [] } }
const burndownBody = { ok: true, burndown: { series: [] } }
const contextsBody = { ok: true, rows: [], totals: { experts: 0, sessions: 0, peak: 1 } }

const html = `<!doctype html><html><head><meta charset="utf-8"><title>cost probe</title></head>
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
  if (url.pathname === '/studio-api/costs') return sendJson(200, costsBody)
  if (url.pathname === '/studio-api/analytics') return sendJson(200, analyticsBody)
  if (url.pathname === '/studio-api/quality') return sendJson(200, qualityBody)
  if (url.pathname === '/studio-api/workload') return sendJson(200, workloadBody)
  if (url.pathname === '/studio-api/burndown') return sendJson(200, burndownBody)
  if (url.pathname === '/studio-api/contexts') return sendJson(200, contextsBody)
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
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1600, height: 1000 } })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error).slice(0, 160)))
  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('[data-dsh-studio] .ds-head-tabs button', { timeout: 45000 })
  // 切到「效能」
  for (const tab of await page.$$('[data-dsh-studio] .ds-head-tabs button')) {
    const label = ((await tab.evaluate(node => node.textContent)) ?? '').trim()
    if (label === '效能') { await tab.click(); break }
  }
  await page.waitForSelector('[data-price-source]', { timeout: 30000 }).catch(async error => {
    const dump = await page.evaluate(() => ({
      error: window.__HARNESS_ERROR__ ?? null,
      text: (document.body.innerText || '').slice(0, 800),
    }))
    console.error('没看到成本栏：' + JSON.stringify(dump, null, 1))
    console.error('pageerror：' + errors.join(' | '))
    throw error
  })
  await sleep(500)
  const perf = await page.evaluate(() => ({
    source: document.querySelector('[data-price-source]')?.textContent ?? '',
    unpriced: document.querySelector('[data-unpriced]')?.textContent ?? '',
    hasButton: [...document.querySelectorAll('button')].some(node => (node.textContent || '').trim() === '补价目'),
  }))
  check('效能页写清了币种与价目来源', perf.source.includes('币种 ¥') && perf.source.includes('已配 1 个模型'), perf.source.slice(0, 60))
  check('点名了两个没价目的模型', perf.unpriced.includes('deepseek-v4.1-pro') && perf.unpriced.includes('qwen3-coder'), perf.unpriced.slice(0, 60))
  check('给了「补价目」入口', perf.hasButton === true)

  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(node => (node.textContent || '').trim() === '补价目')
    button?.click()
  })
  await page.waitForSelector('[data-suggested]', { timeout: 30000 })
  await sleep(400)
  const settings = await page.evaluate(() => ({
    hint: document.querySelector('[data-suggested]')?.textContent ?? '',
    models: [...document.querySelectorAll('input')].map(node => node.value).filter(value => value === 'deepseek-v4.1-pro' || value === 'qwen3-coder'),
    housing: (document.body.innerText.match(/成本与预算/) ?? []).length > 0,
  }))
  check('跳到设置 → 成本与预算', settings.housing === true)
  check('价目表里补上了那两行', settings.models.length === 2, settings.models.join(','))
  check('提示了是从效能页带过来的', settings.hint.includes('带过来 2 个'), settings.hint.slice(0, 50))
  check('页面没有 pageerror', errors.length === 0, errors.join(' | '))
  await page.screenshot({ path: join(REPO, 'tmp', 'cost-price-probe.png') })
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
