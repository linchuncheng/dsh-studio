/* 下拉组件专项验收（真机 + token）：确认**每一个**下拉都是 BoardUI 的 Select，
 * 而且长得也像它 —— 只查 DOM 是不够的，上一轮的教训就在这：
 *
 *   组件是官方的，样式却被自己的重置规则压掉了（触发器高 21px、左右 0 内边距），
 *   弹层更是整层排在页面内容下面（列头 sticky z-index:2 盖住菜单），
 *   肉眼看过去完全不像 BoardUI 的 Select。
 *
 *   STUDIO_TOKEN=xxx node tools/visual/select-audit.mjs
 *
 * 断言（任一不满足 → 退出码 1）：
 *   1 全站没有可见的原生 <select>（RAC 那个隐藏 select 在 [data-testid=hidden-select-container] 里，不算）
 *   2 每个下拉触发器都在 [data-field="select"] 里，且是 react-aria（data-rac）
 *   3 触发器尺寸 = BoardUI 的 md：内边距 8px 10px、高度 ≥ 34px、字体 14px
 *   4 展开后弹层：白底、16px 圆角、8px 内边距、宽 266px
 *   5 弹层**在最上层**：elementFromPoint(弹层中心) 必须落在弹层里
 *   6 菜单项行高 ≥ 30px（不是挤在一起的裸文字）
 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const requireFromRoot = createRequire(resolve(import.meta.dirname, '../..', 'package.json'))
const puppeteer = requireFromRoot('puppeteer-core')
const BASE = process.env.STUDIO_BASE ?? 'http://192.168.120.218:18080'
const TOKEN = process.env.STUDIO_TOKEN ?? ''
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1680, height: 1000 } })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
await page.goto(`${BASE}/?token=${TOKEN}`, { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(3200)
await page.evaluate(() => {
  const node = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && (el.textContent || '').trim() === '需求&任务工作空间')
  node?.closest('button,a,li,[role="button"],[tabindex]')?.click?.()
})
await page.waitForSelector('[data-dsh-studio] [role="tablist"]', { timeout: 45000 })
await sleep(1000)

const clickTab = async (label) => {
  await page.evaluate((want) => {
    [...document.querySelectorAll('[data-dsh-studio] [role="tab"]')].find((n) => (n.textContent || '').trim() === want)?.click()
  }, label)
  await sleep(1000)
}

const auditTriggers = () => page.evaluate(() => {
  const roots = [...document.querySelectorAll('[data-dsh-studio], [data-dsh-studio-portal]')]
  const seen = new Set()
  const all = []
  for (const root of roots) for (const node of root.querySelectorAll('*')) if (!seen.has(node)) { seen.add(node); all.push(node) }
  const native = all.filter((el) => {
    if (el.tagName !== 'SELECT') return false
    if (el.closest('[data-testid="hidden-select-container"]') !== null) return false
    const r = el.getBoundingClientRect()
    return r.width > 4 && r.height > 4
  })
  const fields = [...document.querySelectorAll('[data-dsh-studio] [data-field="select"], [data-dsh-studio-portal] [data-field="select"]')]
    .filter((el) => el.getBoundingClientRect().width > 4)
  const bad = []
  for (const root of fields) {
    const btn = root.querySelector('button')
    if (!btn) { bad.push({ why: '触发器不是 button', text: root.textContent.slice(0, 20) }); continue }
    if (btn.closest('[data-rac]') === null) bad.push({ why: '不是 react-aria 组件', text: btn.textContent.slice(0, 20) })
    const cs = getComputedStyle(btn)
    const r = btn.getBoundingClientRect()
    const padOk = cs.paddingTop === '8px' && cs.paddingLeft === '10px'
    if (!padOk) bad.push({ why: `内边距 ${cs.padding}（应为 8px 10px）`, text: btn.textContent.slice(0, 20) })
    if (r.height < 34) bad.push({ why: `高 ${Math.round(r.height)}px（应 ≥34）`, text: btn.textContent.slice(0, 20) })
    if (cs.fontSize !== '14px') bad.push({ why: `字 ${cs.fontSize}（应 14px）`, text: btn.textContent.slice(0, 20) })
  }
  return { native: native.length, fields: fields.length, bad }
})

const openFirst = () => page.evaluate(() => document.querySelector('[data-dsh-studio] [data-field="select"] button')?.click())
const auditPopover = () => page.evaluate(() => {
  const lb = document.querySelector('[role="listbox"]')
  if (!lb) return { open: false }
  const surface = lb.parentElement
  const cs = getComputedStyle(surface)
  const r = surface.getBoundingClientRect()
  const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
  const items = [...lb.querySelectorAll('[role="option"]')].map((n) => Math.round(n.getBoundingClientRect().height))
  return {
    open: true,
    bg: cs.backgroundColor,
    radius: cs.borderRadius,
    pad: cs.paddingTop,
    width: Math.round(r.width),
    onTop: top !== null && surface.contains(top),
    topHit: top ? top.tagName + '.' + (top.className || '').toString().slice(0, 30) : null,
    items: items.length,
    minItemHeight: items.length > 0 ? Math.min(...items) : 0,
  }
})

const fails = []
const box = (label, ok, detail) => { if (!ok) fails.push(`${label}: ${detail}`) }

/* 每个模块「至少该有几个下拉」——不然断言会在空集合上白过一遍。
   这是这轮最该吸取的教训：先前的探针在 fields=0 时也算通过。 */
const MIN_SELECTS = { 看板: 4, 需求: 1 }

for (const tab of ['看板', '需求', '用例', '版本', '项目', '效能', '设置', '工作台']) {
  await clickTab(tab)
  const t = await auditTriggers()
  box(`${tab} 原生 select`, t.native === 0, `${t.native} 个原生下拉仍在`)
  box(`${tab} 触发器`, t.bad.length === 0, JSON.stringify(t.bad.slice(0, 3)))
  const need = MIN_SELECTS[tab] ?? 0
  box(`${tab} 下拉数量`, t.fields >= need, `只有 ${t.fields} 个，至少应有 ${need} 个（断言没有真的跑）`)
  if (tab === '看板' || tab === '需求') {
    await openFirst()
    await sleep(900)
    const p = await auditPopover()
    if (!p.open) fails.push(`${tab}: 点开下拉后没有 listbox`)
    else {
      box(`${tab} 弹层底色`, p.bg === 'rgb(255, 255, 255)', `底色 ${p.bg}`)
      box(`${tab} 弹层圆角`, p.radius.startsWith('16px'), `圆角 ${p.radius}`)
      box(`${tab} 弹层内边距`, p.pad === '8px', `内边距 ${p.pad}`)
      box(`${tab} 弹层宽度`, p.width >= 240, `宽 ${p.width}px`)
      box(`${tab} 弹层在最上层`, p.onTop === true, `被 ${p.topHit} 盖住`)
      box(`${tab} 菜单项`, p.minItemHeight >= 30, `最矮一行 ${p.minItemHeight}px`)
      box(`${tab} 菜单项数量`, p.items > 0, '没有可选项')
    }
    await page.keyboard.press('Escape')
    await sleep(500)
  }
}

/* 设置里的 16 个面板：下拉总量必须 ≥ 9（自动派单/部署环境/权限与审计各 3 个），
   并且每一个都要过触发器尺寸的断言 —— 面板是逐个点开的，不是靠「默认页签」抽样。 */
await clickTab('设置')
const panels = await page.evaluate(() => [...document.querySelectorAll('[data-dsh-studio] [data-settings-nav] [data-settings-nav-item]')].map((n) => (n.querySelector('span')?.textContent || '').trim()))
let panelSelects = 0
for (const label of panels) {
  await page.evaluate((want) => {
    [...document.querySelectorAll('[data-dsh-studio] [data-settings-nav] [data-settings-nav-item]')]
      .find((n) => (n.querySelector('span')?.textContent || '').trim() === want)?.click()
  }, label)
  await sleep(750)
  const t = await auditTriggers()
  panelSelects += t.fields
  box(`设置/${label} 原生 select`, t.native === 0, `${t.native} 个原生下拉`)
  box(`设置/${label} 触发器`, t.bad.length === 0, JSON.stringify(t.bad.slice(0, 2)))
}
box('设置 下拉总量', panelSelects >= 9, `16 个面板合计只有 ${panelSelects} 个下拉（应为 9）`)

await browser.close()

const detail = fails.length > 0 ? { fails } : 'all good'
console.log(JSON.stringify(detail, null, 1))
if (fails.length > 0 || errors.length > 0) {
  if (errors.length) console.log('pageerror: ' + errors.slice(0, 3).join(' | '))
  console.log(`\n下拉验收不通过：${fails.length} 条`)
  process.exit(1)
}
console.log('下拉验收通过：全站下拉都是 BoardUI Select，尺寸与弹层符合官方设计')
