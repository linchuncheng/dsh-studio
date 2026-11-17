/* 全站组件盘点（真机 + token）：每个页面与抽屉里还剩多少「老控件」。
 *   STUDIO_TOKEN=xxx node tools/visual/audit.mjs
 * 判据：BoardUI = [data-field] / button[data-variant]；老 = .ds-input / button.ds-btn。
 * 注意：RAC 的 Select 会渲染一个隐藏原生 select，所以「原生select」与「B下拉」通常是 1:1。 */
// 全站盘点：每个页面 + 两个抽屉，数一数还剩多少「老控件」。
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const requireFromRoot = createRequire(resolve(import.meta.dirname, '../..', 'package.json'))
const puppeteer = requireFromRoot('puppeteer-core')
const BASE = process.env.STUDIO_BASE ?? 'http://192.168.120.218:18080'
const TOKEN = process.env.STUDIO_TOKEN ?? ''
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const COUNT = `(() => {
  const scope = document.querySelector('[data-dsh-studio]')
  if (!scope) return null
  const q = (sel) => scope.querySelectorAll(sel).length
  return {
    boardInput: q('[data-field="input"]'),
    boardSelect: q('[data-field="select"]'),
    boardBtn: q('button[data-variant]'),
    chip: q('[class*="bg-badge"], .ds-chip'),
    legacyInput: q('input.ds-input, textarea.ds-input, select.ds-input'),
    rawSelect: q('select:not(.ds-input)'),
    legacyBtn: q('button.ds-btn'),
    listrow: q('.ds-listrow'),
    empty: q('.ds-empty'),
    rawCheckbox: q('input[type="checkbox"]:not([data-field])'),
  }
})()`

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1600, height: 1000 } })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)))
await page.goto(`${BASE}/?token=${TOKEN}`, { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(3500)
await page.evaluate(() => {
  const node = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && (el.textContent || '').trim() === '需求&任务工作空间')
  node?.closest('button,a,li,[role="button"],[tabindex]')?.click?.()
})
await page.waitForSelector('[data-dsh-studio] .ds-head-tabs button', { timeout: 45000 })
await sleep(1200)

const rows = []
const record = async (name) => {
  await sleep(900)
  const counts = await page.evaluate(COUNT)
  rows.push({ name, ...counts })
}

for (const label of ['工作台', '看板', '需求', '用例', '版本', '效能', '设置']) {
  await page.evaluate((want) => {
    const b = [...document.querySelectorAll('[data-dsh-studio] .ds-head-tabs button')].find((n) => (n.textContent || '').trim() === want)
    b?.click()
  }, label)
  await record(label)
}

// 卡片抽屉
await page.evaluate(() => {
  const b = [...document.querySelectorAll('[data-dsh-studio] .ds-head-tabs button')].find((n) => (n.textContent || '').trim() === '看板')
  b?.click()
})
await sleep(1200)
await page.evaluate(() => document.querySelector('[data-dsh-studio] .ds-card')?.click())
await sleep(1500)
await record('卡片抽屉')
await page.keyboard.press('Escape')
await sleep(600)

// 设置抽屉
await page.evaluate(() => {
  const b = [...document.querySelectorAll('[data-dsh-studio] .ds-head-tabs button')].find((n) => (n.textContent || '').trim() === '设置')
  b?.click()
})
await sleep(1200)
const opened = await page.evaluate(() => {
  const b = [...document.querySelectorAll('[data-dsh-studio] button')].find((n) => (n.textContent || '').trim() === '新增专家')
  if (!b) return false
  b.click()
  return true
})
if (opened) { await sleep(1400); await record('设置抽屉') }

const pad = (t, w) => String(t ?? '').padEnd(w, ' ')
console.log(pad('位置', 12) + pad('B输入', 7) + pad('B下拉', 7) + pad('B按钮', 7) + pad('B勾选', 7) + pad('老input', 9) + pad('原生select', 11) + pad('老按钮', 8) + pad('listrow', 9) + 'empty')
for (const r of rows) {
  console.log(pad(r.name, 12) + pad(r.boardInput, 7) + pad(r.boardSelect, 7) + pad(r.boardBtn, 7) + pad(r.rawCheckbox, 7) + pad(r.legacyInput, 9) + pad(r.rawSelect, 11) + pad(r.legacyBtn, 8) + pad(r.listrow, 9) + r.empty)
}
console.log('')
console.log('pageerror: ' + (errors.length === 0 ? '无' : errors.join(' | ')))
await browser.close()
