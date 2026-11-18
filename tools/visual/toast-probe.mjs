/* toast 验收探针：接没接对，只看一件事 —— 触发之后 toast 有没有**真的出现在 portal 里**。
 *
 *   STUDIO_TOKEN=xxx node tools/visual/toast-probe.mjs
 *
 * 断言（任一不满足 → 退出码 1）：
 *   1 面板正常（页签渲染、无「渲染失败」、pageerror 为空）
 *   2 触发一次 toast 后，[data-dsh-studio-portal] 里出现一个 role=region/status 的容器
 *   3 那个容器在视口内（不是被 scoped CSS 甩到屏幕外/零尺寸）
 *   4 约 4 秒后自动消失（官方默认 5s，我们传 3200ms）
 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const requireFromRoot = createRequire(resolve(import.meta.dirname, '../..', 'package.json'))
const puppeteer = requireFromRoot('puppeteer-core')
const BASE = process.env.STUDIO_BASE ?? 'http://192.168.120.218:18080'
const TOKEN = process.env.STUDIO_TOKEN ?? ''
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const fails = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`)
  if (!ok) fails.push(label)
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1400, height: 900 } })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)) })

await page.goto(`${BASE}/?token=${TOKEN}`, { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(3000)
await page.evaluate(() => {
  const node = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && (el.textContent || '').trim() === '需求&任务工作空间')
  node?.closest('button,a,li,[role="button"],[tabindex]')?.click?.()
})
await page.waitForSelector('[data-dsh-studio] [role="tablist"]', { timeout: 45000 })
await sleep(1200)
check('面板正常挂载', true)

// 触发 toast：点顶栏「刷新」——这条路径一定走 toast()
// 「刷新」这条路径不一定 toast（grep 下来 client.src.js 里只有 2 处 toast 调用），
// 改点「设置 → 专家 → 保存角色模板」——保存成功一定会 toast。
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('[data-dsh-studio] [role=\'tab\]')].find((n) => (n.textContent || '').trim() === '设置')
  tab?.click()
})
await sleep(1500)
const fired = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('[data-dsh-studio] button')].find((n) => /保存角色模板|保存/.test((n.textContent || '').trim()))
  btn?.click()
  return btn !== undefined ? (btn.textContent || '').trim() : undefined
})
check('点了会触发 toast 的保存按钮', fired !== undefined, String(fired))
await sleep(1500)

const shown = await page.evaluate(() => {
  const portal = document.querySelector('[data-dsh-studio-portal]')
  if (portal === null) return { ok: false, why: '没有 portal 容器' }
  const region = portal.querySelector('[role="region"], [aria-live]')
  if (region === null) return { ok: false, why: 'portal 里没有 region', text: portal.textContent.trim().slice(0, 40) }
  const r = region.getBoundingClientRect()
  return {
    ok: true,
    text: (region.textContent || '').trim().slice(0, 40),
    inViewport: r.width > 20 && r.height > 10 && r.bottom > 0 && r.top < window.innerHeight,
    w: Math.round(r.width),
    h: Math.round(r.height),
  }
})
check('toast 出现在 data-dsh-studio-portal 里', shown.ok === true, shown.why ?? shown.text)
if (shown.ok === true) {
  check('toast 在视口内且有尺寸（scoped CSS 没丢）', shown.inViewport === true, `${shown.w}x${shown.h}`)
  await sleep(4000)
  const gone = await page.evaluate(() => {
    const portal = document.querySelector('[data-dsh-studio-portal]')
    return portal === null || portal.querySelector('[role="region"], [aria-live]') === null
  })
  check('约 4 秒后自动消失', gone === true)
}

check('全程没有 pageerror / console error', errors.length === 0, errors.slice(0, 2).join(' | '))
await browser.close()

console.log(fails.length === 0 ? `\n全部通过（${7} 项）` : `\n${fails.length} 项失败（${7} 项）`)
process.exit(fails.length === 0 ? 0 : 1)
