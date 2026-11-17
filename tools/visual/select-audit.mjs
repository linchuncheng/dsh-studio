// 找出「页面上真实可见的原生 <select>」——注意 react-aria 的 Select 内部也有一个隐藏
// select（aria-hidden + 0 尺寸），那不是问题；这里只报可见的。
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const requireFromRoot = createRequire(resolve('dsh-studio/package.json'))
const puppeteer = requireFromRoot('puppeteer-core')
const BASE = process.env.STUDIO_BASE ?? 'http://192.168.120.218:18080'
const TOKEN = process.env.STUDIO_TOKEN ?? ''
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1600, height: 1000 } })
const page = await browser.newPage()
await page.goto(`${BASE}/?token=${TOKEN}`, { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(3500)
await page.evaluate(() => {
  const node = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && (el.textContent || '').trim() === '需求&任务工作空间')
  node?.closest('button,a,li,[role="button"],[tabindex]')?.click?.()
})
await page.waitForSelector('[data-dsh-studio] [role="tablist"]', { timeout: 45000 })
await sleep(1200)

const visibleNativeSelects = () => page.evaluate(() => {
  const scope = document.querySelector('[data-dsh-studio]')
  if (!scope) return []
  return [...scope.querySelectorAll('select')]
    .filter((el) => {
      const rect = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return rect.width > 4 && rect.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none' && el.closest('[aria-hidden="true"]') === null
    })
    .map((el) => ({
      id: el.id || '',
      cls: (el.className || '').toString().slice(0, 40),
      options: el.options.length,
      first: el.options[0]?.textContent?.trim().slice(0, 12) ?? '',
      parent: (el.parentElement?.className || '').toString().slice(0, 40),
    }))
})

const report = []
for (const label of ['工作台', '看板', '需求', '用例', '版本', '效能', '设置']) {
  await page.evaluate((want) => {
    const tab = [...document.querySelectorAll('[data-dsh-studio] [role="tab"]')].find((n) => (n.textContent || '').trim() === want)
    tab?.click()
  }, label)
  await sleep(1100)
  const found = await visibleNativeSelects()
  report.push({ where: label, count: found.length, samples: found.slice(0, 4) })
}

// 业务提单（新建需求）抽屉：这里原来有两个原生 select
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('[data-dsh-studio] [role="tab"]')].find((n) => (n.textContent || '').trim() === '需求')
  tab?.click()
})
await sleep(1200)
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('[data-dsh-studio] button')].find((n) => /新建/.test((n.textContent || '').trim()))
  btn?.click()
})
await sleep(1800)
const intake = await visibleNativeSelects()
report.push({ where: '业务提单(新建需求)', count: intake.length, samples: intake.slice(0, 4) })
await page.keyboard.press('Escape')
await sleep(600)

// 卡片抽屉
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('[data-dsh-studio] [role="tab"]')].find((n) => (n.textContent || '').trim() === '看板')
  tab?.click()
})
await sleep(1200)
await page.evaluate(() => document.querySelector('[data-dsh-studio] .ds-card')?.click())
await sleep(1600)
report.push({ where: '卡片抽屉', count: (await visibleNativeSelects()).length, samples: (await visibleNativeSelects()).slice(0, 6) })
await page.keyboard.press('Escape')
await sleep(600)

// 设置抽屉
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('[data-dsh-studio] [role="tab"]')].find((n) => (n.textContent || '').trim() === '设置')
  tab?.click()
})
await sleep(1200)
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('[data-dsh-studio] button')].find((n) => (n.textContent || '').trim() === '新增专家')
  btn?.click()
})
await sleep(1500)
const drawer = await visibleNativeSelects()
report.push({ where: '设置抽屉', count: drawer.length, samples: drawer.slice(0, 6) })

for (const row of report) {
  console.log(`${row.where}: 可见原生 select ${row.count} 个`)
  for (const sample of row.samples) console.log(`   - id=${sample.id} cls=${sample.cls} options=${sample.options} first=${sample.first} parent=${sample.parent}`)
}
await browser.close()
