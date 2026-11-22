#!/usr/bin/env node
/**
 * 浮层/交互态审计（第二轮）：把 ui-audit 没覆盖的弹窗、抽屉、选择器、toast、登录都打开量一遍。
 *
 *   node tmp/audit-overlays.mjs --base http://127.0.0.1:<端口>
 *
 * 每个浮层：只量**浮层本身**（[role=dialog] 优先，否则取 portal 里面积最大的容器），
 * 记录字号档位 / 非 4px 网格（>2px）/ emoji / 是否有可关闭入口，并截图。
 */
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const argv = process.argv.slice(2)
const base = (() => { const i = argv.indexOf('--base'); return i >= 0 ? argv[i + 1] : '' })()
if (base === '') { console.error('用法：node tmp/audit-overlays.mjs --base http://127.0.0.1:<端口>'); process.exit(2) }
const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core')
const CHROME = [process.env.CHROME_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(path => existsSync(path))
const OUT = join(repo, 'tmp', 'overlay-audit')
mkdirSync(OUT, { recursive: true })

const HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style></head>
<body><div id="root"></div><pre id="err" style="color:#b91c1c"></pre>
<script src="/react.js"></script><script src="/react-dom.js"></script>
<script>window.__ModuleLoader__={load(c){window.__studioFactory=c.factory}}</script>
<script src="/client.js"></script>
<script>
try{
  const React=window.React, ReactDOM=window.ReactDOM
  const mod=window.__studioFactory(n=>{if(n==='react')return React;throw new Error(n)})
  const captured={}
  const ctx={slots:{inject:(n,fn)=>fn(),register:(slot,c)=>{captured[(slot.name??'')]=c;return()=>{}}},effect:fn=>(typeof fn==='function'?fn():()=>{})}
  if(typeof mod.apply==='function')mod.apply(ctx)
  window.__mounted=true
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(captured.main,{}))
}catch(e){window.__bootFailed=String(e&&e.message?e.message:e);document.getElementById('err').textContent='BOOT '+window.__bootFailed}
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
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : (chunks.length > 0 ? Buffer.concat(chunks) : undefined),
      })
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' })
      res.end(await upstream.text())
    } catch (error) { res.writeHead(502); res.end(String(error?.message ?? error)) }
    return
  }
  if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(HTML); return }
  const files = { '/client.js': join(repo, 'client.js'), '/react.js': join(repo, 'web/node_modules/react/umd/react.development.js'), '/react-dom.js': join(repo, 'web/node_modules/react-dom/umd/react-dom.development.js') }
  const file = files[url.pathname]
  if (file === undefined || !existsSync(file)) { res.writeHead(404); res.end('x'); return }
  res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
  res.end(readFileSync(file))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

/** 只量浮层本身：优先 role=dialog，其次 portal 里面积最大的可见容器。 */
const COLLECT = () => {
  const visible = el => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 20 }
  const dialogs = [...document.querySelectorAll('[role="dialog"], [data-drawer], .ds-modal, .ds-menu, [role="listbox"]')].filter(visible)
  const portals = [...document.querySelectorAll('[data-dsh-studio-portal]')].filter(visible)
  const picks = dialogs.length > 0 ? dialogs.sort((a, b) => {
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
    return rb.width * rb.height - ra.width * ra.height
  }) : portals
  const inline = picks.length === 0
  const layer = inline ? document.querySelector('[data-dsh-studio]') : picks[0]
  if (layer === null) return { found: false }
  const box = layer.getBoundingClientRect()
  const inner = [...layer.querySelectorAll('*')].filter(visible)
  const sizes = {}, weights = {}, off = {}
  for (const el of inner) {
    const cs = getComputedStyle(el)
    sizes[cs.fontSize] = (sizes[cs.fontSize] ?? 0) + 1
    weights[cs.fontWeight] = (weights[cs.fontWeight] ?? 0) + 1
    for (const prop of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap']) {
      const v = Math.round(parseFloat(cs[prop]))
      if (!Number.isFinite(v) || v === 0 || v <= 2) continue
      if (v % 4 !== 0) off[prop + '=' + v] = (off[prop + '=' + v] ?? 0) + 1
    }
  }
  const emoji = new Set()
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
  while (walker.nextNode() !== null) {
    for (const ch of String(walker.currentNode.textContent ?? '').match(/\p{Extended_Pictographic}/gu) ?? []) emoji.add(ch)
  }
  const text = String(layer.innerText ?? '').replace(/\n{2,}/g, '\n')
  return {
    found: true,
    mode: inline ? 'inline' : 'overlay',
    tag: layer.getAttribute('role') ?? layer.className ?? layer.tagName,
    size: [Math.round(box.width), Math.round(box.height)],
    text: text.slice(0, 500),
    fonts: Object.keys(sizes).sort(),
    weights: Object.keys(weights).sort(),
    offGrid: off,
    emoji: [...emoji],
    hasClose: /关闭|取消|×|Esc/.test(text),
  }
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const rows = []
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  const errors = []
  page.on('pageerror', e => errors.push(String(e?.message ?? e)))
  page.on('console', m => { if (m.type() === 'error' && !/favicon|404 \(Not Found\)/.test(m.text())) errors.push('console: ' + m.text().slice(0, 140)) })
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__mounted === true || window.__bootFailed !== undefined, { timeout: 20000 })
  await new Promise(r => setTimeout(r, 1200))

  const sleep = ms => new Promise(r => setTimeout(r, ms))
  // 页面重渲染后 handle 会失效，统一用 DOM click（页签也认）；点完再确认一遍目标消失了/浮层出来了
  const clickText = async (label, { prefix = false } = {}) => {
    const hit = await page.evaluate((target, usePrefix) => {
      const norm = n => String(n.textContent ?? '').replace(/\s+/g, ' ').trim()
      const node = [...document.querySelectorAll('[data-dsh-studio] button, [role="tab"], [role="menuitem"], a')]
        .find(n => (usePrefix ? norm(n).startsWith(target) : norm(n) === target))
      if (node === undefined) return false
      node.click()
      return true
    }, label, prefix)
    await sleep(750)
    return hit
  }
  const esc = async () => {
    await page.evaluate(() => {
      const norm = n => String(n.textContent ?? '').trim()
      const btn = [...document.querySelectorAll('[data-dsh-studio-portal] button, [role="dialog"] button')].find(n => ['关闭', '取消', '×'].includes(norm(n)))
      if (btn !== undefined) btn.click()
    })
    await sleep(400)
    await page.keyboard.press('Escape')
    await sleep(400)
  }
  const dump = async label => { const list = await page.evaluate(() => [...document.querySelectorAll('[data-dsh-studio] button, [role="tab"]')].map(n => String(n.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 30)); console.log('   ↳ 没找到「' + label + '」，当前可点：', list.join(' / ')) }
  const shot = async (name, note) => {
    const data = await page.evaluate(COLLECT)
    await page.screenshot({ path: join(OUT, name + '.png') })
    rows.push({ name, note, ...data })
    if (data.found !== true) { console.log(`✗ ${name.padEnd(24)} 没打开`); return }
    console.log(`· ${name.padEnd(24)} ${String(data.size[0]).padStart(4)}×${String(data.size[1]).padStart(4)} 字号${data.fonts.length}档 非网格${Object.keys(data.offGrid).length} emoji${data.emoji.length} 可关${data.hasClose ? '有' : '无'}`)
  }

  // 1) 需求页 → 新建需求
  await clickText('需求'); await sleep(500)
  if (await clickText('新建需求')) { await sleep(600); await shot('overlay-req-editor', '需求编辑抽屉') } else await dump('新建需求')
  await esc()

  // 2) 需求页 → 删除确认（danger）
  const deleteHit = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('[data-dsh-studio] button')].find(n => String(n.textContent ?? '').trim() === '删除')
    if (btn === undefined) return false
    btn.click(); return true
  })
  if (deleteHit) { await sleep(800); await shot('overlay-confirm-danger', '删除确认（danger）') }
  await esc()

  // 3) 版本页 → 新建版本
  await clickText('版本'); await sleep(600)
  if (await clickText('＋ 新建版本', { prefix: true })) { await sleep(700); await shot('overlay-release-editor', '版本编辑抽屉') } else await dump('＋ 新建版本')
  await esc()

  // 4) 看板 → WIP 输入框（promptDialog）
  await clickText('看板'); await sleep(700)
  const wip = await page.evaluate(() => { const n = document.querySelector('[data-dsh-studio] [data-wip-count]'); if (n === null) return false; n.click(); return true })
  if (wip) { await sleep(800); await shot('overlay-prompt', 'promptDialog（WIP 上限）') }
  await esc()

  // 5) 看板筛选下拉（Radix Select / listbox）
  const selectHit = await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('[data-dsh-studio] button')].find(n => String(n.textContent ?? '').trim().startsWith('全部项目'))
    if (trigger === undefined) return false
    trigger.click(); return true
  })
  if (selectHit) { await sleep(800); await shot('overlay-select', '下拉选择器展开') }
  await esc()

  // 6) 卡片抽屉 → 讨论 → @ 选择器
  await page.evaluate(() => { const c = document.querySelector('[data-dsh-studio] [data-kanban-card]'); if (c) c.click() })
  await sleep(1200)
  await clickText('讨论'); await sleep(600)
  const mention = await page.evaluate(() => {
    const area = document.querySelector('[data-dsh-studio] textarea')
    if (area === null) return false
    area.focus(); area.value = '@'; area.dispatchEvent(new Event('input', { bubbles: true })); return true
  })
  if (mention) { await sleep(800); await shot('overlay-mention', '@ 选择器') }
  await esc(); await sleep(300)
  await clickText('关闭'); await sleep(700)

  // 7) 设置 → 项目与迭代 → 新增项目
  await clickText('设置'); await clickText('项目与迭代', { prefix: true }); await sleep(600)
  if (await clickText('新增项目')) { await sleep(700); await shot('overlay-project-form', '项目表单抽屉') } else await dump('新增项目')
  await esc()

  // 8) 设置 → 专家 → 新增专家
  await clickText('专家', { prefix: true }); await sleep(600)
  if (await clickText('新增专家')) { await sleep(700); await shot('overlay-expert-form', '专家表单抽屉') } else await dump('新增专家')
  await esc()

  // 9) 设置 → 技能库 → 上传
  await clickText('技能库'); await sleep(600)
  if (await clickText('新建技能', { prefix: true })) { await sleep(700); await shot('overlay-skill-upload', '技能新建/上传抽屉') } else await dump('新建技能')
  await esc()

  // 10) 表头「登录」→ 登录浮层
  if (!(await clickText('登录'))) await dump('登录'); await sleep(900); await shot('overlay-login', '登录浮层')

  writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ base, rows, errors }, null, 2))
  const ok = rows.filter(r => r.found === true)
  console.log('\n抓到浮层：', ok.length, '/', rows.length, '｜页面错误：', errors.slice(0, 3).join(' | ') || '无')
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
