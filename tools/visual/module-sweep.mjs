// 逐模块体检：把面板能打开的每一屏都点一遍，断言「有内容 / 不崩 / 无 console 错」。
//
// 为什么不用现成探针：它们各管一块（pages 只看 8 个页签、sweep 看设置分区、drawer-probe 看抽屉），
// 而「适配层吞 children」「面板整块 ReferenceError」这类问题是**跨模块**的，
// 需要一次把所有屏都走遍，才能回答「还有没有别的模块坏着」。
//
// 用法：STUDIO_BASE=http://192.168.120.218:18080 STUDIO_TOKEN=xxx node tools/visual/module-sweep.mjs
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const requireFromRoot = createRequire(resolve(import.meta.dirname, '../..', 'package.json'))
const puppeteer = requireFromRoot('puppeteer-core')
const BASE = process.env.STUDIO_BASE ?? 'http://192.168.120.218:18080'
const TOKEN = process.env.STUDIO_TOKEN ?? ''
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const outDir = resolve(import.meta.dirname, '../../tmp/module-sweep')
await mkdir(outDir, { recursive: true })

const results = []
const record = (module, name, ok, detail = '') => {
  results.push({ module, name, ok: ok === true, detail })
  console.log(`${ok === true ? 'ok  ' : 'FAIL'}  [${module}] ${name}${detail === '' ? '' : ' — ' + detail}`)
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1600, height: 1000 } })
const page = await browser.newPage()
const consoleErrors = []
let phase = '启动'
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(`${phase}: ${message.text().slice(0, 200)}`) })
page.on('pageerror', error => consoleErrors.push(`${phase}: pageerror ${String(error).slice(0, 200)}`))

const state = () => page.evaluate(() => ({
  text: (document.querySelector('[data-dsh-studio]')?.innerText ?? '').length,
  crashed: (document.body.innerText || '').includes('渲染失败'),
}))

await page.goto(`${BASE}/?token=${TOKEN}`, { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(3500)
await page.evaluate(() => {
  const node = [...document.querySelectorAll('*')].find(el => el.children.length === 0 && (el.textContent || '').trim() === '需求&任务工作空间')
  node?.closest('button,a,li,[role="button"],[tabindex]')?.click?.()
})
await page.waitForSelector('[data-dsh-studio] [data-head-tabs] [role="tab"]', { timeout: 45000 })
await sleep(1200)

/* ---------------------------------------------------------------- 页签 --- */
const tabs = await page.$$eval('[data-dsh-studio] [data-head-tabs] [role="tab"]', nodes => nodes.map(n => (n.textContent || '').trim()))
record('页签', `发现 ${tabs.length} 个页签`, tabs.length >= 8, tabs.join(' / '))
for (const tab of tabs) {
  phase = `页签:${tab}`
  const before = consoleErrors.length
  await page.evaluate(want => { [...document.querySelectorAll('[data-dsh-studio] [data-head-tabs] [role="tab"]')].find(n => (n.textContent || '').trim() === want)?.click() }, tab)
  await sleep(1400)
  const info = await state()
  const errors = consoleErrors.length - before
  record('页签', tab, info.text > 80 && info.crashed === false && errors === 0, `${info.text} 字${info.crashed ? ' / 渲染失败' : ''}${errors > 0 ? ` / console ${errors}` : ''}`)
  await page.screenshot({ path: resolve(outDir, `页签-${tab}.png`) })
}

/* ------------------------------------------------------------- 设置分区 --- */
await page.evaluate(() => { [...document.querySelectorAll('[data-dsh-studio] [data-head-tabs] [role="tab"]')].find(n => (n.textContent || '').trim() === '设置')?.click() })
await sleep(1200)
const panes = await page.$$eval('[data-dsh-studio] [data-settings-nav-item]', nodes => nodes.map(n => (n.textContent || '').trim()))
record('设置', `发现 ${panes.length} 个分区`, panes.length >= 15, '')
for (const label of panes) {
  phase = `设置:${label}`
  const before = consoleErrors.length
  const clicked = await page.evaluate(want => {
    const button = [...document.querySelectorAll('[data-dsh-studio] [data-settings-nav-item]')].find(n => (n.textContent || '').trim().startsWith(want.split(' ')[0]))
    if (!button) return false
    button.click()
    return true
  }, label)
  await sleep(900)
  const info = await page.evaluate(() => {
    const pane = document.querySelector('[data-dsh-studio] [data-settings-pane]')
    return {
      pane: (pane?.innerText ?? '').length,
      controls: pane ? pane.querySelectorAll('input,textarea,select,button').length : 0,
      crashed: (document.body.innerText || '').includes('渲染失败'),
    }
  })
  const errors = consoleErrors.length - before
  record('设置', label, clicked && (info.pane > 40 || info.controls > 0) && info.crashed === false && errors === 0, `${info.pane} 字 · 控件 ${info.controls}${info.crashed ? ' / 渲染失败' : ''}${errors > 0 ? ` / console ${errors}` : ''}`)
}

/* ------------------------------------------------------------- 卡片抽屉 --- */
phase = '抽屉'
await page.evaluate(() => { [...document.querySelectorAll('[data-dsh-studio] [data-head-tabs] [role="tab"]')].find(n => (n.textContent || '').trim() === '看板')?.click() })
await sleep(1500)
const cardOpened = await page.evaluate(() => {
  const card = document.querySelector('[data-dsh-studio] [data-kanban-card]')
  if (!card) return false
  card.click()
  return true
})
await sleep(1300)
const drawerTabs = await page.$$eval('[data-dsh-studio] [data-drawer] [role="tab"], [data-dsh-studio] [role="dialog"] [role="tab"]', nodes => nodes.map(n => (n.textContent || '').trim()))
record('抽屉', `打开卡片（${drawerTabs.length} 个页签）`, cardOpened && drawerTabs.length > 0, '')
for (const tab of drawerTabs) {
  phase = `抽屉:${tab}`
  const before = consoleErrors.length
  await page.evaluate(want => {
    const root = document.querySelector('[data-dsh-studio] [data-drawer], [data-dsh-studio] [role="dialog"]')
    const button = [...(root?.querySelectorAll('[role="tab"]') ?? [])].find(n => (n.textContent || '').trim() === want)
    button?.click()
  }, tab)
  await sleep(700)
  const info = await page.evaluate(() => {
    const root = document.querySelector('[data-dsh-studio] [data-drawer], [data-dsh-studio] [role="dialog"]')
    return { text: (root?.innerText ?? '').length, crashed: (document.body.innerText || '').includes('渲染失败') }
  })
  const errors = consoleErrors.length - before
  record('抽屉', tab, info.text > 200 && info.crashed === false && errors === 0, `${info.text} 字${info.crashed ? ' / 渲染失败' : ''}${errors > 0 ? ` / console ${errors}` : ''}`)
}
await page.keyboard.press('Escape')
await sleep(800)
const drawerClosed = await page.evaluate(() => document.querySelector('[data-dsh-studio] [data-drawer], [data-dsh-studio] [role="dialog"]') === null)
record('抽屉', 'Esc 能关掉', drawerClosed)

/* ------------------------------------------------------------- 新建对话框 --- */
phase = '新建任务'
const opened = await page.evaluate(() => {
  const button = [...document.querySelectorAll('[data-dsh-studio] button')].find(n => (n.textContent || '').trim().includes('新建'))
  if (!button) return false
  button.click()
  return true
})
await sleep(600)
const menu = await page.evaluate(() => {
  const item = [...document.querySelectorAll('[data-dsh-studio] [role="menuitem"], [data-dsh-studio] button')].find(n => (n.textContent || '').trim().includes('新建任务'))
  if (!item) return false
  item.click()
  return true
})
await sleep(1000)
const dialog = await page.evaluate(() => ({
  exists: Boolean(document.querySelector('[data-dsh-studio] [data-dialog="new-task"], [data-dsh-studio] [data-dialog-card]')),
  fields: document.querySelectorAll('[data-dsh-studio] [data-dialog-card] input, [data-dsh-studio] [data-dialog="new-task"] input').length,
  text: (document.querySelector('[data-dsh-studio] [data-dialog-card], [data-dsh-studio] [data-dialog="new-task"]')?.innerText ?? '').length,
}))
record('新建任务', '能打开且字段齐全', opened && menu && dialog.exists && dialog.fields >= 3, `字段 ${dialog.fields} · ${dialog.text} 字`)
await page.screenshot({ path: resolve(outDir, '新建任务.png') })
await page.keyboard.press('Escape')
await sleep(600)

/* ------------------------------------------------------------- 命令面板 --- */
phase = '命令面板'
await page.keyboard.down('Control')
await page.keyboard.press('KeyK')
await page.keyboard.up('Control')
await sleep(900)
const palette = await page.evaluate(() => {
  const root = document.querySelector('[data-dsh-studio] [data-palette]')
  const items = root?.querySelectorAll('[data-palette-item], [role="option"], li').length ?? 0
  return { open: Boolean(root), items, text: (root?.innerText ?? '').length }
})
record('命令面板', '⌘K 打开且有结果', palette.open && palette.items > 0, `条目 ${palette.items} · ${palette.text} 字`)
await page.keyboard.press('Escape')
await sleep(500)

/* --------------------------------------------------------------- 收尾 --- */
record('全局', 'console 无 error', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '))
await browser.close()

const failed = results.filter(item => item.ok !== true)
console.log('')
console.log(`${failed.length === 0 ? '全部通过' : failed.length + ' 项失败'}（${results.length} 项）· 截图 tmp/module-sweep/`)
process.exit(failed.length === 0 ? 0 : 1)
