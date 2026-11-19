#!/usr/bin/env node
/**
 * 无障碍巡检（真机 + 真 Chrome）：对比度、可访问名称、键盘可达、抽屉焦点圈。
 *
 *   STUDIO_TOKEN=… STUDIO_BASE=http://<host>:18080 npm run verify:a11y
 *
 * 为什么先量再写：ACCESSIBILITY.md 里如果写「已支持键盘操作 / 对比度达标」，
 * 那必须是量出来的，不能是愿望。这个探针只报事实，不自动修。
 *
 * 判据按 WCAG 2.2：
 *   - 正文对比度 ≥ 4.5:1，大字号（≥24px，或 ≥18.66px 且粗体）≥ 3:1
 *   - 交互元素必须有可访问名称（文字 / aria-label / title）
 *   - 图片必须有 alt（装饰性用 alt=""）
 *   - 焦点必须看得见（outline 或 box-shadow 变化）
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let puppeteer
try {
  puppeteer = require('puppeteer-core')
} catch {
  console.error('需要 puppeteer-core：pnpm add -D puppeteer-core')
  process.exit(2)
}

const token = String(process.env.STUDIO_TOKEN ?? '').trim()
const baseUrl = String(process.env.STUDIO_BASE ?? '').trim().replace(/\/+$/, '')
if (token === '' || baseUrl === '') {
  console.error('需要 STUDIO_TOKEN 与 STUDIO_BASE')
  process.exit(2)
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox'],
  defaultViewport: { width: 1600, height: 1000 },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', error => errors.push(String(error).slice(0, 160)))

/** 页面里跑的采集逻辑：对比度 + 可访问名称 + 图片 alt。 */
const collectAudit = () => {
  const parseColor = input => {
    const match = String(input).match(/rgba?\(([^)]+)\)/)
    if (match === null) return null
    const parts = match[1].split(',').map(part => Number(part.trim()))
    const [r, g, b] = parts
    const a = parts.length > 3 ? parts[3] : 1
    return { r, g, b, a }
  }
  const luminance = ({ r, g, b }) => {
    const channel = value => {
      const v = value / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }
  const blend = (front, back) => ({
    r: front.r * front.a + back.r * (1 - front.a),
    g: front.g * front.a + back.g * (1 - front.a),
    b: front.b * front.a + back.b * (1 - front.a),
    a: 1,
  })
  const effectiveBackground = node => {
    let current = node
    let acc = null
    while (current !== null && current !== document.documentElement) {
      const found = parseColor(getComputedStyle(current).backgroundColor)
      if (found !== null && found.a > 0) acc = acc === null ? found : blend(acc, found)
      if (acc !== null && acc.a >= 1) return acc
      current = current.parentElement
    }
    const body = parseColor(getComputedStyle(document.body).backgroundColor)
    const fallback = { r: 255, g: 255, b: 255, a: 1 }
    return acc === null ? (body ?? fallback) : blend(acc, body ?? fallback)
  }

  const contrast = []
  const unnamed = []
  const images = []
  const root = document.querySelector('[data-dsh-studio]') ?? document.body

  for (const node of root.querySelectorAll('*')) {
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue
    const rect = node.getBoundingClientRect()
    if (rect.width < 4 || rect.height < 4) continue
    const ownText = [...node.childNodes]
      .filter(child => child.nodeType === 3)
      .map(child => child.textContent.trim())
      .join('')
      .trim()
    // 只看"自己直接带文字"的节点，避免祖先重复计
    if (ownText !== '') {
      const fg = parseColor(style.color)
      if (fg !== null) {
        const bg = effectiveBackground(node)
        const front = fg.a < 1 ? blend(fg, bg) : fg
        const l1 = luminance(front)
        const l2 = luminance(bg)
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
        const size = Number.parseFloat(style.fontSize)
        const bold = Number(style.fontWeight) >= 700
        const large = size >= 24 || (size >= 18.66 && bold)
        const need = large ? 3 : 4.5
        if (ratio + 0.01 < need) {
          contrast.push({
            text: ownText.slice(0, 40),
            ratio: Number(ratio.toFixed(2)),
            need,
            size,
            color: style.color,
            bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
            cls: String(node.className ?? '').slice(0, 40),
          })
        }
      }
    }
    const tag = node.tagName.toLowerCase()
    if (tag === 'button' || (tag === 'a' && node.hasAttribute('href')) || node.getAttribute('role') === 'button') {
      const name = (node.getAttribute('aria-label') ?? node.getAttribute('title') ?? node.textContent ?? '').trim()
      if (name === '') unnamed.push({ tag, cls: String(node.className ?? '').slice(0, 40), html: node.outerHTML.slice(0, 120) })
    }
    if (tag === 'img' && !node.hasAttribute('alt')) images.push(node.outerHTML.slice(0, 120))
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      const id = node.getAttribute('id')
      const labelled = (id !== null && document.querySelector(`label[for="${CSS.escape(id)}"]`) !== null)
        || node.getAttribute('aria-label') !== null
        || node.getAttribute('aria-labelledby') !== null
        || node.getAttribute('title') !== null
      if (!labelled && node.getAttribute('type') !== 'hidden') unnamed.push({ tag, cls: String(node.className ?? '').slice(0, 40), html: node.outerHTML.slice(0, 120) })
    }
  }
  return {
    contrast: contrast.slice(0, 40),
    contrastCount: contrast.length,
    unnamed: unnamed.slice(0, 20),
    unnamedCount: unnamed.length,
    images: images.slice(0, 10),
    imagesCount: images.length,
  }
}

const report = { tabs: {}, keyboard: {}, drawer: {}, pageerrors: errors }

const theme = String(process.env.A11Y_THEME ?? '').trim()

async function enterPanel() {
  await page.goto(`${baseUrl}/?token=${token}`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(1500)
  if (theme === 'dark' || theme === 'light') {
    // 主题存在 localStorage 里（键名 dsh-studio:theme），写完重新加载才生效。
    await page.evaluate(key => localStorage.setItem('dsh-studio:theme', key), theme)
    await page.reload({ waitUntil: 'networkidle2', timeout: 60000 })
  }
  await sleep(2500)
  await page.evaluate(() => {
    const node = [...document.querySelectorAll('*')].find(el => el.children.length === 0 && (el.textContent || '').trim() === '需求&任务工作空间')
    node?.closest('button,a,li,[role="button"],[tabindex]')?.click()
  })
  await page.waitForSelector('[data-dsh-studio]', { timeout: 30000 })
  await sleep(1500)
}

try {
  await enterPanel()

  // 1) 每个页签的可访问性巡检
  const tabs = await page.$$eval('[data-dsh-studio] .ds-head-tabs button', nodes => nodes.map(node => node.textContent.trim()))
  for (const name of tabs) {
    for (const tab of await page.$$('[data-dsh-studio] .ds-head-tabs button')) {
      if (((await tab.evaluate(node => node.textContent)) || '').trim() === name) { await tab.click(); break }
    }
    await sleep(1800)
    report.tabs[name] = await page.evaluate(collectAudit)
  }

  // 2) 键盘可达：Tab 走一圈，看焦点是否可见
  await page.evaluate(() => document.body.focus())
  const focusTrail = []
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('Tab')
    await sleep(120)
    focusTrail.push(await page.evaluate(() => {
      const node = document.activeElement
      if (node === null || node === document.body) return { tag: 'body', name: '', visible: false }
      const style = getComputedStyle(node)
      const visible = (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0)
        || (style.boxShadow !== 'none' && style.boxShadow !== '')
      return {
        tag: node.tagName.toLowerCase(),
        name: (node.getAttribute('aria-label') ?? node.textContent ?? '').trim().slice(0, 30),
        visible,
      }
    }))
  }
  report.keyboard = { trail: focusTrail, invisible: focusTrail.filter(item => item.tag !== 'body' && item.visible !== true).length }

  // 3) 抽屉：能不能打开、焦点是否被困在里面、Esc 能不能关
  for (const tab of await page.$$('[data-dsh-studio] .ds-head-tabs button')) {
    if (((await tab.evaluate(node => node.textContent)) || '').trim() === '看板') { await tab.click(); break }
  }
  await sleep(1500)
  const opened = await page.evaluate(() => {
    const card = document.querySelector('[data-dsh-studio] .ds-card')
    if (card === null) return false
    card.click()
    return true
  })
  await sleep(1500)
  const drawer = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"], [data-dsh-studio-portal]')
    return {
      present: dialog !== null,
      inside: dialog !== null ? dialog.contains(document.activeElement) : false,
      role: dialog?.getAttribute('role') ?? '',
      label: dialog?.getAttribute('aria-label') ?? '',
    }
  })
  const focusInside = []
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab')
    await sleep(100)
    focusInside.push(await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"], [data-dsh-studio-portal]')
      return dialog === null ? null : dialog.contains(document.activeElement)
    }))
  }
  await page.keyboard.press('Escape')
  await sleep(800)
  const closed = await page.evaluate(() => document.querySelector('[role="dialog"]') === null)
  report.drawer = {
    opened,
    ...drawer,
    trapOk: focusTrail.length > 0 && focusInside.every(item => item !== false),
    escaped: focusInside.filter(item => item === false).length,
    closedByEscape: closed,
  }
} catch (error) {
  report.error = String(error?.message ?? error).slice(0, 200)
} finally {
  await browser.close()
}

// ---- 输出 ----
const allContrast = Object.entries(report.tabs).flatMap(([tab, data]) => (data.contrast ?? []).map(item => ({ tab, ...item })))
const allUnnamed = Object.entries(report.tabs).flatMap(([tab, data]) => (data.unnamed ?? []).map(item => ({ tab, ...item })))
console.log('== 对比度 ==')
console.log(allContrast.length === 0 ? 'ok   所有正文对比度都达到 WCAG AA' : `FAIL ${allContrast.length} 处低于 AA：`)
for (const item of allContrast.slice(0, 12)) console.log(`  [${item.tab}] ${item.ratio}:1（需 ${item.need}:1）${item.size}px ${item.color} on ${item.bg} —「${item.text}」`)
console.log('')
console.log('== 可访问名称 ==')
console.log(allUnnamed.length === 0 ? 'ok   每个交互元素都有名称' : `FAIL ${allUnnamed.length} 个没有名称：`)
for (const item of allUnnamed.slice(0, 8)) console.log(`  [${item.tab}] <${item.tag}> ${item.html}`)
console.log('')
console.log('== 键盘焦点 ==')
console.log(report.keyboard.invisible === 0 ? 'ok   焦点一路可见' : `FAIL ${report.keyboard.invisible} 次焦点不可见`)
console.log('  轨迹：' + (report.keyboard.trail ?? []).map(item => `${item.tag}${item.visible ? '' : '(无焦点环)'}`).join(' → '))
console.log('')
console.log('== 抽屉 ==')
console.log(`  present=${report.drawer.present} role=${report.drawer.role || '(无)'} 焦点进入=${report.drawer.inside} 圈内=${report.drawer.trapOk} 逃出 ${report.drawer.escaped} 次 Esc 关闭=${report.drawer.closedByEscape}`)
console.log('')
console.log('== pageerror ==', report.pageerrors.length === 0 ? 'ok 空' : report.pageerrors)
console.log('')
const summary = {
  theme: theme === '' ? 'current' : theme,
  contrast: allContrast.length,
  unnamed: allUnnamed.length,
  images: Object.values(report.tabs).reduce((sum, item) => sum + (item.imagesCount ?? 0), 0),
  focusInvisible: report.keyboard.invisible,
  drawer: report.drawer,
  error: report.error ?? null,
}
console.log(JSON.stringify(summary, null, 2))

/* 当闸门用：任何一项不达标就退出码 1。
   不加这一条的话，探针只会「输出一堆字」，release:preflight 照样绿 —— 那就是假绿。 */
const failed = summary.error !== null
  || summary.contrast > 0
  || summary.unnamed > 0
  || summary.focusInvisible > 0
  || summary.drawer.trapOk !== true
  || summary.drawer.closedByEscape !== true
  || summary.drawer.present !== true
console.log(failed
  ? `无障碍巡检不通过：对比度 ${summary.contrast} 处 · 无名称 ${summary.unnamed} 个 · 焦点不可见 ${summary.focusInvisible} 次 · 抽屉 ${summary.drawer.trapOk ? 'ok' : '焦点圈失效'}`
  : `无障碍巡检通过（${summary.theme}）：对比度 0 处不达标 · 交互元素都有名称 · 焦点 0 次不可见 · 抽屉 role=dialog 焦点圈 ok`)
process.exit(failed ? 1 : 0)
