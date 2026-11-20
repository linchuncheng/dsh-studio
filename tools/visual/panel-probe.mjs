#!/usr/bin/env node
/**
 * 面板渲染探针：把**真实的 client.js** 挂在一个最小假宿主上，用 puppeteer 跑起来逐页断言。
 *
 * 为什么需要它：
 *   接口测试和单元测试只验数据，验不到「渲染在哪个面板里」。0.9.36 就把「评审闸门」开关
 *   插进了「数据与备份」面板——所有测试都是绿的，设置页里却根本看不到它。
 *   这个探针把那类问题变成可断言的：组件是否渲染、在哪个页签、文案是否正确、有没有报错。
 *
 * 它验的是**真数据**：探针自己起一个静态服务，把 /studio-api/* 反向代理到正在运行的 dsh 实例，
 * 所以页面里看到的是这个实例真实的看板与设置。跑完会删掉自己造的数据（标题带「（探针）」）。
 *
 *   node tools/visual/panel-probe.mjs --base http://127.0.0.1:55222
 *   node tools/visual/panel-probe.mjs --base http://127.0.0.1:55222 --keep   # 保留数据看现场
 *   npm run probe:panel -- --base http://127.0.0.1:55222
 *
 * 依赖 puppeteer-core（devDependency，不进插件运行时）。没有它或没有 Chrome 时**跳过而不是判红**：
 * CI 里不装依赖，这条只在本地/发版前跑。
 */
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback
}
const base = argOf('base', process.env.STUDIO_BASE ?? '')
const keep = argv.includes('--keep')
if (base === '') {
  console.error('用法：node tools/visual/panel-probe.mjs --base http://127.0.0.1:<dsh 端口> [--keep]')
  process.exit(2)
}

// ---------------------------------------------------------------- 依赖探测（缺了就跳过）
const require = createRequire(import.meta.url)
let puppeteer
try {
  puppeteer = require('puppeteer-core')
} catch {
  console.log('跳过：没装 puppeteer-core（devDependency，只在本地/发版前跑）')
  process.exit(0)
}
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean).find(path => existsSync(path))
if (CHROME === undefined) {
  console.log('跳过：找不到 Chrome/Edge（可用 CHROME_PATH 指定）')
  process.exit(0)
}

const api = async (path, body) => {
  const res = await fetch(base + '/studio-api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
const state = async () => (await api('/state')).json.state

// ---------------------------------------------------------------- 假宿主（静态 + 代理）
const HARNESS_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>panel probe</title>
<style>html,body,#root{height:100%;margin:0}body{font-family:system-ui,"Microsoft YaHei",sans-serif}</style></head>
<body><div id="root"></div><pre id="boot-error" style="color:#b91c1c;font:13px monospace"></pre>
<script src="/react.js"></script><script src="/react-dom.js"></script>
<script>
  window.__ModuleLoader__ = { load(config) { window.__studioFactory = config.factory } }
</script>
<script src="/client.js"></script>
<script>
  try {
    const React = window.React, ReactDOM = window.ReactDOM
    const mod = window.__studioFactory(name => { if (name === 'react') return React; throw new Error('没有提供模块：' + name) })
    const captured = {}
    const ctx = { slots: { inject: (n, fn) => fn(), register: (slot, component) => { captured[(slot.name ?? '') + ':' + (slot.key ?? slot.id ?? '')] = component; return () => {} } }, effect: fn => { try { return fn() } catch { return () => {} } } }
    if (typeof mod.apply === 'function') mod.apply(ctx)
    const key = Object.keys(captured).find(k => k.startsWith('main:'))
    if (key === undefined) throw new Error('没有拿到 main 槽页面：' + Object.keys(captured).join(','))
    window.__pageMounted = true
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(captured[key], {}))
  } catch (error) {
    document.getElementById('boot-error').textContent = 'BOOT ERROR: ' + (error && error.stack ? error.stack : error)
    window.__bootFailed = String(error && error.message ? error.message : error)
  }
</script></body></html>`

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname.startsWith('/studio-api/')) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    try {
      const upstream = await fetch(base + url.pathname + url.search, {
        method: req.method,
        headers: { 'content-type': req.headers['content-type'] ?? 'application/json' },
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : (chunks.length > 0 ? Buffer.concat(chunks) : undefined),
      })
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' })
      res.end(await upstream.text())
    } catch (error) {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }))
    }
    return
  }
  const staticFiles = {
    '/': null,
    '/client.js': join(repo, 'client.js'),
    '/react.js': join(repo, 'web/node_modules/react/umd/react.development.js'),
    '/react-dom.js': join(repo, 'web/node_modules/react-dom/umd/react-dom.development.js'),
  }
  if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(HARNESS_HTML); return }
  const file = staticFiles[url.pathname]
  if (file === undefined || !existsSync(file)) { res.writeHead(404); res.end('not found'); return }
  res.writeHead(200, { 'content-type': extname(file) === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream' })
  res.end(await readFile(file))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const harnessUrl = `http://127.0.0.1:${server.address().port}`

// ---------------------------------------------------------------- 造数据（自检标记 + 跑完清理）
const rows = []
const check = (name, ok, detail = '') => {
  rows.push({ name, ok: ok === true })
  console.log(`${ok === true ? '✓' : '✗'} ${name}${detail === '' ? '' : ` — ${String(detail).slice(0, 120)}`}`)
}
let requirementId = ''
let taskId = ''
let browser
const outDir = join(repo, 'tmp', 'probe')
try {
  await mkdir(outDir, { recursive: true })
  const requirement = await api('/requirement/save', {
    requirement: {
      title: '（探针）面板渲染自检',
      description: 'panel-probe 造的临时数据，跑完会删掉',
      discovery: { server: '有', auth: '服务端', boundary: '含测试' },
      points: [{ id: 'p1', title: '探针功能点 A' }, { id: 'p2', title: '探针功能点 B' }],
    },
  })
  requirementId = requirement.json.requirement?.id ?? ''
  const card = await api('/task/create', { title: '（探针）看板卡片', type: 'dev', role: 'dev', status: 'dev', requirementId, pointId: 'p1' })
  taskId = card.json.task?.id ?? ''
  check('准备：造出需求与卡片', requirementId !== '' && taskId !== '')

  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 1100 })
  const errors = []
  page.on('pageerror', error => errors.push('pageerror: ' + String(error?.message ?? error)))
  page.on('console', message => { if (message.type() === 'error' && !/favicon|404/.test(message.text())) errors.push('console: ' + message.text().slice(0, 140)) })

  const clickExact = async label => {
    const hit = await page.evaluate(target => {
      const nodes = [...document.querySelectorAll('button, [role="tab"]')]
      const node = nodes.find(item => String(item.textContent ?? '').trim() === target)
      if (node === undefined) return false
      node.click()
      return true
    }, label)
    await new Promise(resolve => setTimeout(resolve, 700))
    return hit
  }
  const waitText = async (needle, timeout = 6000) => {
    try { await page.waitForFunction(t => document.body.innerText.includes(t), { timeout, polling: 200 }, needle); return true } catch { return false }
  }

  await page.goto(harnessUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__pageMounted === true || window.__bootFailed !== undefined, { timeout: 20000 })
  check('面板能在假宿主里挂起来', await page.evaluate(() => window.__pageMounted === true), await page.evaluate(() => window.__bootFailed ?? ''))
  await waitText('看板', 8000)

  // ① 看板：卡片 + 闸门关闭提示
  await clickExact('看板')
  check('① 看板渲染出探针卡片', await waitText('（探针）看板卡片'))
  const gateOff = await page.evaluate(() => document.querySelector('[data-gate-off]')?.textContent ?? null)
  const gates = (await state()).gates
  check('① 闸门关闭时看板顶部有提示', (gates?.design?.enabled !== true) === (gateOff !== null), gateOff ?? '(闸门都开着，应该没有提示)')
  await page.screenshot({ path: join(outDir, 'board.png') })

  // ② 抽屉：用例归功能点
  await page.evaluate(() => document.querySelector('.ds-card')?.click())
  await new Promise(resolve => setTimeout(resolve, 900))
  const sections = await page.evaluate(() => [...document.querySelectorAll('.ds-sec-head')].map(node => String(node.textContent ?? '')))
  check('② 抽屉打开且有分区', sections.length > 0, `${sections.length} 个分区`)
  check('② 抽屉里有「测试用例」区', sections.some(text => text.includes('测试用例')))
  const casePoint = await page.evaluate(() => {
    const select = [...document.querySelectorAll('select')].find(node => [...node.options].some(option => String(option.textContent).includes('不归功能点')))
    return select === undefined ? null : { value: select.value, hint: [...document.querySelectorAll('.ds-hint')].some(node => String(node.textContent).includes('默认跟卡上的功能点')) }
  })
  check('② 新用例表单的功能点选择器默认继承卡（p1）', casePoint !== null && casePoint.value === 'p1', JSON.stringify(casePoint))
  check('② 选择器旁有「默认跟卡上的功能点」说明', casePoint?.hint === true)
  await page.screenshot({ path: join(outDir, 'drawer.png') })

  // ③ 需求页：覆盖率口径
  // 先关掉抽屉：不关的话设置页截图会被挡住一半，看不出左栏的样式
  await clickExact('关闭')
  await new Promise(resolve => setTimeout(resolve, 400))
  await clickExact('需求')
  check('③ 需求页矩阵渲染', await waitText('功能点与可追溯矩阵'))
  check('③ 覆盖率口径写出来了', (await page.evaluate(() => document.body.innerText)).includes('覆盖率按功能点算'))
  await page.screenshot({ path: join(outDir, 'requirement.png') })

  // ④ 设置 → 列的负责人：两道闸门开关
  await clickExact('设置')
  await clickExact('列的负责人')
  await waitText('每一列由谁负责')
  const gateButtons = await page.evaluate(() => ({
    design: document.querySelector('[data-design-gate]')?.getAttribute('data-design-gate') ?? null,
    review: document.querySelector('[data-review-gate]')?.getAttribute('data-review-gate') ?? null,
    reviewText: document.querySelector('[data-review-gate]')?.textContent ?? null,
  }))
  check('④ 设置页有设计闸门开关', gateButtons.design !== null, gateButtons.design ?? '')
  check('④ 设置页有评审闸门开关（在「列的负责人」里）', gateButtons.review !== null, gateButtons.reviewText ?? '没找到 [data-review-gate]')
  check('④ 评审闸门默认开启', gateButtons.review === 'on', gateButtons.reviewText ?? '')
  await page.screenshot({ path: join(outDir, 'settings-gates.png') })

  // ⑤ 设置 → 技能库：使用读数
  const skillsNav = await clickExact('技能库')
  if (skillsNav === true) await new Promise(resolve => setTimeout(resolve, 800))
  const skillText = await page.evaluate(() => document.body.innerText)
  check('⑤ 技能库面板能打开', skillsNav === true, skillsNav ? '' : '没找到「技能库」入口')
  check('⑤ 技能行有使用读数', skillText.includes('用上') || skillText.includes('还没被用上'))
  await page.screenshot({ path: join(outDir, 'skills.png') })

  check('全程没有 pageerror / console 错误', errors.length === 0, errors.slice(0, 3).join(' | '))
} finally {
  if (browser !== undefined) await browser.close()
  await new Promise(resolve => server.close(resolve))
  if (keep !== true) {
    try {
      if (taskId !== '') await api('/task/delete', { id: taskId, confirm: 'DELETE' })
      // 连云盘目录一起删：不删的话每跑一次探针就在云盘根下多一个同名文件夹（真的发生过 200 个）
      if (requirementId !== '') await api('/requirement/delete', { id: requirementId, confirm: 'DELETE', deleteFolder: true })
    } catch { /* 清理失败不影响结论 */ }
  }
  const left = keep === true ? '' : ` 清理：${taskId === '' ? '' : '卡片已删 '}${requirementId === '' ? '' : '需求已删'}`
  if (left !== '') console.log(left.trim())
}

const failed = rows.filter(row => row.ok !== true)
console.log(`\n${rows.length - failed.length}/${rows.length} 通过（截图：tmp/probe/）`)
process.exitCode = failed.length === 0 ? 0 : 1
