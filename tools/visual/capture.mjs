// 把面板的主要页面截成一张图，输出到 docs/images/。README 里那些图就是它生成的。
//   STUDIO_TOKEN=<token> STUDIO_BASE=http://<host>:18080 node tools/visual/capture.mjs
import puppeteer from 'puppeteer-core'
const TOKEN = process.env.STUDIO_TOKEN ?? process.argv[2] ?? ''
const BASE = process.env.STUDIO_BASE ?? 'http://127.0.0.1:18080'
const OUT = new URL('../../docs/images/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox'],
  defaultViewport: { width: 1600, height: 1000 },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))

await page.goto(BASE + '/?token=' + TOKEN, { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(3500)
await page.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find(n => n.children.length === 0 && (n.textContent || '').trim() === '需求&任务工作空间')
  el?.closest('button,a,li,[role="button"],[tabindex]')?.click?.()
})
await page.waitForSelector('[data-dsh-studio]', { timeout: 30000 })
await sleep(1500)

const tabs = [
  ['工作台', 'workbench'],
  ['看板', 'board'],
  ['需求', 'requirements'],
  ['用例', 'cases'],
  ['版本', 'releases'],
  ['效能', 'quality'],
]
const shots = []
for (const [label, file] of tabs) {
  let clicked = false
  for (const tab of await page.$$('[data-dsh-studio] .ds-head-tabs button')) {
    if ((((await tab.evaluate(n => n.textContent)) || '').trim()) === label) { await tab.click(); clicked = true; break }
  }
  await sleep(3000)
  const path = OUT + file + '.png'
  await page.screenshot({ path })
  shots.push({ label, file, clicked })
}

// 设置页：测试执行面板（执行开关 / 上限 / webhook）+ 成本价目表
let settingsClicked = false
for (const tab of await page.$$('[data-dsh-studio] .ds-head-tabs button')) {
  if ((((await tab.evaluate(n => n.textContent)) || '').trim()) === '设置') { await tab.click(); settingsClicked = true; break }
}
await sleep(2500)
// 设置页的左侧还有二级导航：把「测试执行」「成本与预算」也单独截出来，
// 否则 README 里只能看到默认打开的「专家」面板。
for (const [label, file] of [['测试执行', 'settings-execution'], ['成本与预算', 'settings-cost'], ['专家', 'settings-experts']]) {
  let hit = false
  for (const node of await page.$$('[data-dsh-studio] .ds-head-tabs button, [data-dsh-studio] button, [data-dsh-studio] li')) {
    const text = ((await node.evaluate(n => n.textContent)) || '').trim()
    if (text.startsWith(label)) { await node.click(); hit = true; break }
  }
  await sleep(2200)
  await page.screenshot({ path: OUT + file + '.png' })
  shots.push({ label: '设置/' + label, file, clicked: hit })
}

// 卡片抽屉：回看板点第一张卡
for (const tab of await page.$$('[data-dsh-studio] .ds-head-tabs button')) {
  if ((((await tab.evaluate(n => n.textContent)) || '').trim()) === '看板') { await tab.click(); break }
}
await page.waitForSelector('[data-dsh-studio] .ds-card', { timeout: 20000 }).catch(() => {})
await sleep(1500)
const card = (await page.$$('[data-dsh-studio] .ds-card'))[0]
let drawer = false
if (card !== undefined) {
  await card.click()
  await sleep(2500)
  drawer = await page.evaluate(() => document.querySelectorAll('[data-dsh-studio] .ds-drawer').length > 0)
  await page.screenshot({ path: OUT + 'drawer.png' })
}
shots.push({ label: '卡片抽屉', file: 'drawer', clicked: drawer })

const crash = await page.evaluate(() => document.body.innerText.includes('渲染失败'))
console.log(JSON.stringify({ shots, drawer, crash, errors }, null, 1))
await browser.close()
