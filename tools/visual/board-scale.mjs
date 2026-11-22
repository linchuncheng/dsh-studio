#!/usr/bin/env node
/**
 * 上千张卡的看板能不能用：不用真实 dsh 宿主，直接把构建产物挂到一个假宿主页面上量。
 *
 * 为什么要这个：真实宿主要在 .218 上，而「1000 张卡会不会卡」这件事只要浏览器 + 一份假状态
 * 就能量出来。这里做四件事：
 *   1. 造 N 张卡（默认 1000）的 /state，量整包多大；
 *   2. 在真 Chrome 里挂载面板，量首屏出卡时间与 DOM 里真正渲染了几张卡；
 *   3. 点「显示更多」，确认它按 COLUMN_PAGE（40）递增而不是一次铺开；
 *   4. 校验 /state 的 ETag：带 if-none-match 再来一次必须 304（没变就不重传整包）。
 *
 *   node tools/visual/board-scale.mjs            # 1000 张卡
 *   CARDS=3000 node tools/visual/board-scale.mjs # 更多
 *   CHROME_PATH=... node tools/visual/board-scale.mjs
 *
 * 依赖 puppeteer-core（devDependency）与系统 Chrome。
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { defaultConfig, PRIORITIES, ROLE_IDS, STATUSES } from '../../src/host/domain.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const CARDS = Number(process.env.CARDS ?? 1000)
const COLUMN_PAGE = 40
const require = createRequire(import.meta.url)

let puppeteer
try {
  puppeteer = require('puppeteer-core')
} catch {
  console.error('需要 puppeteer-core：pnpm add -D puppeteer-core（或设 PUPPETEER_CORE 指向已装的目录）')
  process.exit(2)
}
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'

// ---- 假状态：字段照 publicState() 的形状给，够看板和卡片用 --------------------------
const config = defaultConfig()
const requirements = Array.from({ length: 20 }, (_, i) => ({ id: `req-${i}`, code: `REQ-${String(i + 1).padStart(3, '0')}`, title: `需求 ${i + 1}` }))
const tasks = Array.from({ length: CARDS }, (_, i) => {
  const status = STATUSES[i % STATUSES.length].id
  return {
    id: `t-scale${String(i).padStart(5, '0')}`,
    code: `DEV-${1000 + i}`,
    title: `第 ${i + 1} 张卡：库存预占与超时释放`,
    status,
    type: 'requirement',
    priority: ['urgent', 'normal', 'relaxed'][i % 3],
    expert: config.experts?.[i % (config.experts?.length || 1)]?.id ?? '',
    owner: '李四',
    project: '',
    iteration: '',
    service: '',
    requirementId: i % 4 === 0 ? '' : `req-${i % requirements.length}`,
    releaseId: '',
    dueAt: 0,
    tags: ['库存'],
    blocked: null,
    dispatch: {},
    coding: null,
    design: null,
    artifacts: [],
    commentCount: i % 5,
    caseSummary: { total: 3, pass: 2, fail: i % 7 === 0 ? 1 : 0 },
    checkSummary: { done: i % 3, total: 3 },
    sla: null,
    updatedAt: Date.now() - i * 1000,
  }
})
const state = {
  revision: 1,
  updatedAt: Date.now(),
  profile: 'web',
  statuses: STATUSES,
  roles: ROLE_IDS,
  priorities: PRIORITIES,
  config,
  tasks,
  requirements,
  releases: [],
  experts: [],
  agents: [],
  locked: false,
}
const bodyOf = () => JSON.stringify({ ok: true, state })
const statePayload = bodyOf()
const etag = `W/"${state.revision}-scale"`
const pageHtml = `<!doctype html><html><head><meta charset="utf-8"><title>board scale</title></head>
<body><div id="root"></div>
<script>window.__ModuleLoader__ = { load(entry) {
  window.__STUDIO_PLUGIN__ = entry.factory(function (name) {
    if (name === 'react') return window.React
    throw new Error('harness: no module ' + name)
  })
} }</script>
<script src="/react.js"></script>
<script src="/react-dom.js"></script>
<script src="/client.js"></script>
<script>
(function () {
  try {
    var registered = {}
    var ctx = {
      slots: {
        inject: function (name, fn) { fn() },
        register: function (def, Comp) { registered[def.key || def.name] = Comp; return function () {} },
      },
      effect: function (fn) { return fn() },
    }
    window.__STUDIO_PLUGIN__.apply(ctx)
    var Page = registered.studio
    if (!Page) { window.__HARNESS_ERROR__ = 'no page registered'; return }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Page, {}))
    window.__HARNESS_MOUNTED__ = true
  } catch (error) { window.__HARNESS_ERROR__ = String(error) }
})()
</script></body></html>`

const staticFiles = {
  '/': { body: pageHtml, type: 'text/html; charset=utf-8' },
  '/client.js': { file: join(REPO, 'client.js'), type: 'application/javascript; charset=utf-8' },
  '/react.js': { file: join(REPO, 'web/node_modules/react/umd/react.production.min.js'), type: 'application/javascript; charset=utf-8' },
  '/react-dom.js': { file: join(REPO, 'web/node_modules/react-dom/umd/react-dom.production.min.js'), type: 'application/javascript; charset=utf-8' },
}
let stateHits = 0
let notModified = 0
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname === '/studio-api/state') {
    stateHits += 1
    if (req.headers['if-none-match'] === etag) {
      notModified += 1
      res.writeHead(304, { etag, 'cache-control': 'no-cache' })
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', etag, 'cache-control': 'no-cache' })
    res.end(statePayload)
    return
  }
  if (url.pathname.startsWith('/studio-api/')) {
    // 其它接口一律成功，页面轮询/统计这些不影响本脚本的判定
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true, state }))
    return
  }
  const asset = staticFiles[url.pathname]
  if (asset === undefined) { res.writeHead(404).end(); return }
  try {
    const body = asset.body === undefined ? await readFile(asset.file) : Buffer.from(asset.body)
    res.writeHead(200, { 'content-type': asset.type })
    res.end(body)
  } catch (error) {
    res.writeHead(500).end(String(error))
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const checks = []
const check = (name, ok, detail = '') => { checks.push({ name, ok: ok === true, detail }); console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail === '' ? '' : ' — ' + detail)); return ok === true }

let browser
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1600, height: 1000 } })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error).slice(0, 160)))
  const started = Date.now()
  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('[data-dsh-studio] .ds-head-tabs button', { timeout: 45000 })
  // 面板默认停在「工作台」，要看板得点页签（Radix Tabs 不认 DOM .click()，用 elementHandle）
  for (const tab of await page.$$('[data-dsh-studio] .ds-head-tabs button')) {
    const label = ((await tab.evaluate(node => node.textContent)) ?? '').trim()
    if (label === '看板') { await tab.click(); break }
  }
  try {
    await page.waitForSelector('[data-dsh-studio] [data-kanban-card]', { timeout: 45000 })
  } catch (cause) {
    // 挂不上时先看页面自己说了什么（AGENTS §4：「找不到元素」先截图再说）
    const dump = await page.evaluate(() => ({
      harness: window.__HARNESS_ERROR__ ?? null,
      mounted: window.__HARNESS_MOUNTED__ === true,
      studio: document.querySelector('[data-dsh-studio]') !== null,
      text: (document.body.innerText || '').slice(0, 600),
    }))
    await page.screenshot({ path: join(REPO, 'tmp', 'board-scale-fail.png') })
    console.error('页面没出卡：' + JSON.stringify(dump, null, 1))
    console.error('截图：tmp/board-scale-fail.png；pageerror：' + errors.join(' | '))
    throw cause
  }
  const firstCardMs = Date.now() - started
  await new Promise(resolve => setTimeout(resolve, 800))

  const mounted = await page.evaluate(() => ({
    error: window.__HARNESS_ERROR__ ?? null,
    cards: document.querySelectorAll('[data-kanban-card]').length,
    columns: document.querySelectorAll('[data-col]').length,
    moreButtons: [...document.querySelectorAll('[data-col] button')].filter(node => (node.textContent || '').startsWith('显示更多')).length,
    text: document.body.innerText.includes('渲染失败'),
  }))
  check('面板挂载没有报错', mounted.error === null && mounted.text === false, mounted.error ?? '')
  check('八列都在', mounted.columns === STATUSES.length, String(mounted.columns))
  const cap = STATUSES.length * COLUMN_PAGE
  const expected = Math.min(CARDS, cap)
  check('首屏不是一次铺开：DOM 卡片数 = min(卡数, 每列 ' + COLUMN_PAGE + ')', mounted.cards === expected, mounted.cards + ' 张 / ' + CARDS + ' 张')
  const paged = CARDS > cap
  if (paged) {
    check('有「显示更多」的列数', mounted.moreButtons > 0, String(mounted.moreButtons))
  } else {
    check('卡少于一屏时不该出现「显示更多」', mounted.moreButtons === 0, String(mounted.moreButtons))
  }
  check('首屏出卡时间 < 8s', firstCardMs < 8000, firstCardMs + 'ms')

  const before = mounted.cards
  let after = before
  if (paged) {
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('[data-col] button')].find(node => (node.textContent || '').startsWith('显示更多'))
      button?.click()
    })
    await new Promise(resolve => setTimeout(resolve, 400))
    after = await page.evaluate(() => document.querySelectorAll('[data-kanban-card]').length)
    check('点「显示更多」只多渲染 ' + COLUMN_PAGE + ' 张', after === before + COLUMN_PAGE, before + ' → ' + after)
  }

  // ETag：等一轮自动轮询（15s），确认浏览器真的带上了 If-None-Match 并拿到 304
  const waitFor = async (test, timeoutMs) => {
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      if (test()) return true
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    return test()
  }
  const polled = await waitFor(() => notModified > 0, 22000)
  check('浏览器轮询真的带上了 If-None-Match（拿到 304）', polled, '304 次数 ' + notModified + ' / 请求 ' + stateHits)
  const probe = await page.evaluate(async () => (await fetch('/studio-api/state', { headers: { 'if-none-match': 'W/"1-scale"' } })).status)
  check('/state 命中 ETag 回 304', probe === 304, 'HTTP ' + probe)
  check('页面没有 pageerror', errors.length === 0, errors.join(' | '))

  const raw = Buffer.byteLength(statePayload)
  console.log('')
  console.log('卡片数           ' + CARDS)
  console.log('/state 整包      ' + Math.round(raw / 1024) + ' KB · gzip ' + Math.round(gzipSync(Buffer.from(statePayload)).length / 1024) + ' KB')
  console.log('DOM 卡片数       ' + after + '（每列上限 ' + COLUMN_PAGE + '）')
  console.log('首屏出卡         ' + firstCardMs + 'ms')
  console.log('/state 请求次数  ' + stateHits + '（其中 304：' + notModified + '）')
} catch (error) {
  console.error('规模检查中断：' + (error?.message ?? error))
  checks.push({ name: '运行', ok: false, detail: String(error?.message ?? error) })
} finally {
  await browser?.close?.()
  server.close()
}
const failed = checks.filter(item => item.ok !== true)
console.log('')
console.log((failed.length === 0 ? '全部通过' : failed.length + ' 项失败') + '（' + checks.length + ' 项）')
process.exit(failed.length === 0 ? 0 : 1)
