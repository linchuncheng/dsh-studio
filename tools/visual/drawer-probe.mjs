#!/usr/bin/env node
/**
 * 抽屉自验（假宿主 + 真 Chrome）。
 *
 * `web/src/boardui/drawer.tsx` 是我们自己用 react-aria 的 ModalOverlay + Modal + Dialog
 * 拼出来的右侧抽屉（BoardUI 的 Drawer 是 Pro，不买不抄）。这个探针验四件事：
 *   1. 从设置页的「新增专家」能打开它（面板真的出现在 portal 容器里）
 *   2. 面板用的是 BoardUI 的 token 类（背景/描边/标题字号）
 *   3. Esc 能关掉（react-aria 接管的键盘行为）
 *   4. 全程 pageerror 为空
 *
 *   node tools/visual/drawer-probe.mjs
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

const now = Date.now()
const state = {
  revision: 3,
  updatedAt: now,
  profile: 'web',
  statuses: STATUSES,
  roles: ROLE_IDS,
  priorities: PRIORITIES,
  config: defaultConfig(),
  tasks: [],
  requirements: [],
  releases: [],
  experts: [{ id: 'e1', name: '产品经理', emoji: '📋', role: 'product', domain: '', description: '', prompt: '', skills: [], model: '', preset: '', sandbox: '', enabled: true }],
  agents: [],
  locked: false,
}
const html = `<!doctype html><html><head><meta charset="utf-8"><title>drawer probe</title></head>
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
  page.on('pageerror', error => errors.push(String(error).slice(0, 200)))
  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('[data-dsh-studio] .ds-head-tabs button', { timeout: 45000 })

  const click = async (selector, text) => page.evaluate((sel, want) => {
    const node = [...document.querySelectorAll(sel)].find(item => (item.textContent || '').trim() === want)
    if (!node) return false
    node.click()
    return true
  }, selector, text)

  check('切到设置', await click('[data-dsh-studio] .ds-head-tabs button', '设置'))
  await sleep(800)
  check('点开「新增专家」', await click('[data-dsh-studio] button', '新增专家'))
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 })

  const shape = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    const panel = dialog?.closest('[class*="border-separator-border"]') ?? dialog?.parentElement
    const host = dialog?.closest('[data-dsh-studio-portal]')
    const title = dialog?.querySelector('[slot="title"]') ?? dialog?.querySelector('h1,h2,h3')
    return {
      found: dialog !== null,
      inPortal: host !== null && host !== undefined,
      panelBg: /bg-background-primary-default/.test(panel?.className ?? ''),
      titleText: (title?.textContent ?? '').trim(),
      titleType: /text-title-3-(medium|semibold)/.test(title?.className ?? ''),
      closeLabel: dialog?.querySelector('button[aria-label="关闭"]') !== null,
      width: Math.round(panel?.getBoundingClientRect?.().width ?? 0),
    }
  })
  check('抽屉打开在 data-dsh-studio-portal 容器里', shape.found === true && shape.inPortal === true)
  check('面板用了 BoardUI 的背景/描边 token', shape.panelBg === true, `宽 ${shape.width}px`)
  check('标题是 BoardUI 的标题字号', shape.titleType === true, shape.titleText.slice(0, 20))
  check('右上角有关闭按钮', shape.closeLabel === true)
  const focused = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    const active = document.activeElement
    return {
      inside: dialog !== null && active !== null && dialog.contains(active),
      tag: active?.tagName ?? '',
      overlayAttr: dialog !== undefined && (dialog.hasAttribute('data-boardui-overlay') || dialog.querySelector('[data-boardui-overlay]') !== null),
    }
  })
  check('打开后焦点在抽屉里面（真机踩过：焦点留在 body 就按 Esc 关不掉）', focused.inside === true, `active=${focused.tag}`)
  check('抽屉根节点带 data-boardui-overlay（Esc 只关最上层靠它）', focused.overlayAttr === true)
  await page.screenshot({ path: join(REPO, 'tmp', 'drawer-probe.png') })

  await page.keyboard.press('Escape')
  await sleep(600)
  const closed = await page.evaluate(() => document.querySelector('[role="dialog"]') === null)
  check('Esc 能把抽屉关掉', closed === true)

  // ---- 确认弹窗：板子上「删除」走的也是我们自己写的 Modal（boardui/dialog.tsx）
  check('点「删除」弹出确认框', await click('[data-dsh-studio] button', '删除'))
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 })
  const confirmShape = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    const buttons = [...(dialog?.querySelectorAll('button') ?? [])].map(node => (node.textContent || '').trim())
    return {
      inPortal: dialog?.closest('[data-dsh-studio-portal]') !== null,
      bg: /bg-background-primary-default/.test(dialog?.parentElement?.className ?? dialog?.className ?? ''),
      buttons,
      text: (dialog?.textContent ?? '').slice(0, 40),
    }
  })
  check('确认框在 portal 容器里且用 BoardUI 的背景 token', confirmShape.inPortal === true && confirmShape.bg === true, confirmShape.text)
  check('确认框有「取消 + 确认」两个按钮', confirmShape.buttons.length === 2 && confirmShape.buttons.includes('取消'), confirmShape.buttons.join(','))
  await page.screenshot({ path: join(REPO, 'tmp', 'dialog-probe.png') })
  check('点「取消」能关掉', await click('[data-dsh-studio] [role="dialog"] button', '取消'))
  await sleep(500)
  check('取消之后弹窗消失', (await page.evaluate(() => document.querySelector('[role="dialog"]') === null)) === true)

  check('页面没有 pageerror', errors.length === 0, errors.join(' | '))
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
