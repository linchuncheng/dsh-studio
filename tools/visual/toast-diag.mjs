/* toast 挂载诊断（不是断言工具，是**取证**工具）。
 *
 *   STUDIO_TOKEN=xxx node tools/visual/toast-diag.mjs
 *
 * 背景：把官方 <Toaster> 渲染进 ToastHost 后面板会挂。错误被 bridge.jsx 的
 * ErrorBoundary 吞在渲染树里，`pageerror` 有时拿不到，页面上只留一行
 * 「工作空间渲染失败：xxx」。所以这里三路取证：
 *   ① console.error 全量（含 React 的警告与异常栈首行）
 *   ② pageerror 全量
 *   ③ 把页面上含「渲染失败」的那块文本原样打出来 —— 这是最直接的那条
 *
 * 用法纪律（2026-11-18 踩过）：部署坏版本、跑本脚本、回滚，**必须是三条独立命令**。
 * 不要用 `&&` 串成一串：前面任何一步失败或语法错误，回滚就会被跳过，坏版本留在线上。
 *
 * 退出码恒为 0 —— 它的产出是给人看的证据，不是通过/失败。
 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const requireFromRoot = createRequire(resolve(import.meta.dirname, '../..', 'package.json'))
const puppeteer = requireFromRoot('puppeteer-core')
const BASE = process.env.STUDIO_BASE ?? 'http://192.168.120.218:18080'
const TOKEN = process.env.STUDIO_TOKEN ?? ''
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const consoleErrors = []
const pageErrors = []

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1400, height: 900 } })
const page = await browser.newPage()
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') consoleErrors.push(`[${msg.type()}] ${msg.text().slice(0, 400)}`)
})
page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 400)))

await page.goto(`${BASE}/?token=${TOKEN}`, { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(3000)
// 点侧栏进入面板（和其他探针同一套入口）
await page.evaluate(() => {
  const node = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && (el.textContent || '').trim() === '需求&任务工作空间')
  node?.closest('button,a,li,[role="button"],[tabindex]')?.click?.()
})
await sleep(4500)

const survey = await page.evaluate(() => {
  const boundary = [...document.querySelectorAll('*')]
    .map((n) => (n.textContent || '').trim())
    .filter((t) => t.includes('渲染失败'))
    .sort((a, b) => a.length - b.length)
    .slice(0, 1)
  return {
    hasTabs: document.querySelector('[data-dsh-studio] [role="tablist"]') !== null,
    hasPanel: document.querySelector('[data-dsh-studio]') !== null,
    boundaryText: boundary[0] ?? null,
    portalRegions: document.querySelectorAll('[data-dsh-studio-portal] [role="region"]').length,
  }
})

await browser.close()

console.log(JSON.stringify({
  url: BASE,
  面板是否挂载: survey.hasPanel,
  页签是否渲染: survey.hasTabs,
  错误边界文本: survey.boundaryText,
  portal里的region: survey.portalRegions,
  console: consoleErrors.slice(0, 6),
  pageerror: pageErrors.slice(0, 6),
}, null, 1))

if (survey.hasTabs === false) {
  console.log('\n判读：页签没渲染出来 —— 面板在挂载阶段就崩了。先看「错误边界文本」里那句 xxx，')
  console.log('那通常就是根本原因（例如 toast.tsx 调了我们 notification.tsx 上不存在的 prop）。')
}
