// 登录门自验（假宿主）：以 locked 状态启动 → 看登录卡是不是 BoardUI 输入 → 提交后能进面板。
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultConfig, PRIORITIES, ROLE_IDS, STATUSES } from '../../src/host/domain.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core')
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'

const now = Date.now()
const state = {
  revision: 1, updatedAt: now, profile: 'web', statuses: STATUSES, roles: ROLE_IDS, priorities: PRIORITIES,
  config: defaultConfig(), tasks: [], requirements: [], releases: [], experts: [], agents: [], locked: false,
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>login probe</title></head>
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
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(registered.studio, {}))
} catch (e) { window.__HARNESS_ERROR__ = String(e) } })()</script></body></html>`

let unlocked = false
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)) }
  if (url.pathname === '/studio-api/state') {
    return json(200, unlocked ? { ok: true, state } : { ok: true, locked: true, state })
  }
  if (url.pathname === '/studio-api/auth/login') { unlocked = true; return json(200, { ok: true, user: { name: 'admin', role: 'admin' }, token: 'x' }) }
  if (url.pathname === '/studio-api/auth/me') return json(200, unlocked ? { ok: true, user: { name: 'admin', role: 'admin' } } : { ok: false })
  if (url.pathname.startsWith('/studio-api/')) return json(200, { ok: true, state })
  if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); return }
  const file = url.pathname === '/client.js' ? join(REPO, 'client.js')
    : url.pathname === '/react.js' ? join(REPO, 'web/node_modules/react/umd/react.production.min.js')
      : url.pathname === '/react-dom.js' ? join(REPO, 'web/node_modules/react-dom/umd/react-dom.production.min.js') : ''
  if (file === '') { res.writeHead(404).end(); return }
  try { const body = await readFile(file); res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' }); res.end(body) } catch { res.writeHead(500).end() }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const checks = []
const check = (name, ok, detail = '') => { checks.push({ name, ok: ok === true }); console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail === '' ? '' : ' — ' + detail)) }

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1200, height: 800 } })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForSelector('[data-dsh-studio] form', { timeout: 45000 }).catch(() => {})
await sleep(800)
console.log('页面文本：' + (await page.evaluate(() => (document.body.innerText || '').slice(0, 160).replace(/\s+/g, ' '))))

const gate = await page.evaluate(() => {
  const scope = document.querySelector('[data-dsh-studio]')
  const inputs = [...(scope?.querySelectorAll('[data-field="input"] input') ?? [])]
  return {
    found: inputs.length > 0,
    boardInputs: inputs.length,
    password: inputs.some((el) => el.type === 'password'),
    labels: [...(scope?.querySelectorAll('label') ?? [])].map((n) => (n.textContent || '').trim()).filter(Boolean).slice(0, 4),
  }
})
check('locked 状态下出现登录卡', gate.found === true)
check('两个输入框走 BoardUI 的壳子', gate.boardInputs >= 2, `${gate.boardInputs} 个`)
check('密码框仍是 type=password', gate.password === true)
check('两个字段都有标签', (gate.labels ?? []).length >= 2, (gate.labels ?? []).join(' / '))
await page.screenshot({ path: join(REPO, 'tmp', 'login-gate.png') })

await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('[data-dsh-studio] [data-field="input"] input')]
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  const set = (el, v) => { setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
  if (inputs[0]) set(inputs[0], 'admin')
  if (inputs[1]) set(inputs[1], 'admin')
})
await sleep(200)
const submitted = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('[data-dsh-studio] button')].find((el) => /登录/.test((el.textContent || '').trim()))
  if (!btn) return false
  btn.click()
  return true
})
await sleep(2000)
const after = await page.evaluate(() => ({
  gate: document.querySelector('[data-dsh-studio] [data-field="input"]') !== null,
  panel: document.querySelector('[data-dsh-studio] [data-head-tabs]') !== null,
}))
check('点得到「登录」按钮', submitted === true)
check('登录后进到面板', after.gate === false && after.panel === true)
check('全程没有 pageerror', errors.length === 0, errors.join(' | '))
await browser.close()
server.close()

const failed = checks.filter((item) => item.ok !== true)
console.log('')
console.log((failed.length === 0 ? '全部通过' : failed.length + ' 项失败') + `（${checks.length} 项）`)
process.exit(failed.length === 0 ? 0 : 1)
