/* 真机功能巡检（需要 .218 的地址与 token）：
 *   STUDIO_TOKEN=xxx node tools/visual/sweep.mjs
 * 覆盖：需求页逐条点开、卡片抽屉全页签、设置页全分区。
 * 页面级探针只证明「页面在」，这三条证明「里面的每个分区/页签都能点开且不炸」。 */
// 真机功能巡检：需求（逐条点开）、看板（开卡 + 逐个页签）、设置（逐个分区）。
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const requireFromRoot = createRequire(resolve(import.meta.dirname, '../..', 'package.json'))
const puppeteer = requireFromRoot('puppeteer-core')
const BASE = process.env.STUDIO_BASE ?? 'http://192.168.120.218:18080'
const TOKEN = process.env.STUDIO_TOKEN ?? ''
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const outDir = resolve(import.meta.dirname, '../../tmp/zoom')
await mkdir(outDir, { recursive: true })

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: ok === true })
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail === '' ? '' : ' — ' + detail))
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1600, height: 1000 } })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
await page.goto(`${BASE}/?token=${TOKEN}`, { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(3500)
await page.evaluate(() => {
  const node = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && (el.textContent || '').trim() === '需求&任务工作空间')
  node?.closest('button,a,li,[role="button"],[tabindex]')?.click?.()
})
await page.waitForSelector('[data-dsh-studio] .ds-head-tabs [role="tab"]', { timeout: 45000 })
await sleep(1200)
const goTab = async (label) => {
  await page.evaluate((want) => {
    const b = [...document.querySelectorAll('[data-dsh-studio] .ds-head-tabs [role="tab"]')].find((n) => (n.textContent || '').trim() === want)
    b?.click()
  }, label)
  await sleep(1400)
}

// ---------- 需求：逐条点开，看布局是否稳定 ----------
await goTab('需求')
const reqCount = await page.evaluate(() => document.querySelectorAll('[data-dsh-studio] .ds-req-item').length)
let stable = true
let worst = ''
for (let index = 0; index < Math.min(reqCount, 5); index += 1) {
  await page.evaluate((i) => {
    const items = document.querySelectorAll('[data-dsh-studio] .ds-req-item')
    items[i]?.click()
  }, index)
  await sleep(900)
  const shape = await page.evaluate(() => {
    const list = document.querySelector('[data-dsh-studio] .ds-req-list')
    const detail = document.querySelector('[data-dsh-studio] .ds-req-detail')
    if (!list || !detail) return null
    const a = list.getBoundingClientRect()
    const b = detail.getBoundingClientRect()
    return { sameRow: Math.abs(a.top - b.top) < 40, rightOf: b.left > a.right - 4, detailW: Math.round(b.width) }
  })
  if (!shape || shape.sameRow !== true || shape.rightOf !== true || shape.detailW < 400) {
    stable = false
    worst = `第 ${index + 1} 条：${JSON.stringify(shape)}`
  }
}
check(`需求页逐条点开（${Math.min(reqCount, 5)}/${reqCount}）布局稳定`, stable === true, worst)
check('需求页无 pageerror', errors.length === 0, errors.join(' | '))

// ---------- 看板：开一张卡，逐个页签走一遍 ----------
await goTab('看板')
await page.waitForSelector('[data-dsh-studio] .ds-card', { timeout: 20000 })
await page.evaluate(() => document.querySelector('[data-dsh-studio] .ds-card')?.click())
await page.waitForSelector('[data-dsh-studio] .ds-drawer', { timeout: 20000 })
await sleep(900)
const paneLabels = await page.evaluate(() => [...document.querySelectorAll('[data-dsh-studio] .ds-drawer [role="tab"]')].map((n) => (n.textContent || '').trim()))
let paneOk = true
for (const label of paneLabels) {
  const clicked = await page.evaluate((want) => {
    const b = [...document.querySelectorAll('[data-dsh-studio] .ds-drawer [role="tab"]')].find((n) => (n.textContent || '').trim() === want)
    if (!b) return false
    b.click()
    return true
  }, label)
  await sleep(700)
  const info = await page.evaluate(() => {
    const body = document.querySelector('[data-dsh-studio] .ds-drawer')
    return { text: (body?.innerText ?? '').length, broken: (document.body.innerText || '').includes('渲染失败') }
  })
  if (!clicked || info.text < 30 || info.broken) { paneOk = false; console.log(`  页签「${label}」异常：clicked=${clicked} text=${info.text} broken=${info.broken}`) }
}
check(`卡片抽屉 ${paneLabels.length} 个页签逐个切换`, paneOk === true)
await page.screenshot({ path: resolve(outDir, '抽屉-最后一页.png') })
await page.keyboard.press('Escape')
await sleep(700)

// ---------- 设置：逐个分区 ----------
await goTab('设置')
await sleep(600)
const navItems = await page.evaluate(() => [...document.querySelectorAll('[data-dsh-studio] [data-settings-nav-item]')].map((n) => (n.textContent || '').trim()))
let navOk = true
for (const label of navItems) {
  const clicked = await page.evaluate((want) => {
    const b = [...document.querySelectorAll('[data-dsh-studio] [data-settings-nav-item]')].find((n) => (n.textContent || '').trim().startsWith(want))
    if (!b) return false
    b.click()
    return true
  }, label)
  await sleep(650)
  const info = await page.evaluate(() => ({
    text: (document.querySelector('[data-dsh-studio] [data-settings-pane]')?.innerText ?? '').length,
    broken: (document.body.innerText || '').includes('渲染失败'),
  }))
  if (!clicked || info.text < 20 || info.broken) { navOk = false; console.log(`  分区「${label}」异常：clicked=${clicked} text=${info.text} broken=${info.broken}`) }
}
check(`设置页 ${navItems.length} 个分区逐个切换`, navOk === true)
check('全程无 pageerror', errors.length === 0, errors.join(' | '))
await browser.close()

const failed = checks.filter((item) => item.ok !== true)
console.log('')
console.log((failed.length === 0 ? '全部通过' : failed.length + ' 项失败') + `（${checks.length} 项）`)
process.exit(failed.length === 0 ? 0 : 1)
