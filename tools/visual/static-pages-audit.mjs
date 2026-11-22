// 3 个公开页（提单 / 我的 / 进度）+ 窄屏抽查：都是纯静态渲染，直接量。
import { mkdirSync, writeFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { MINE_HTML, STATUS_HTML, INTAKE_HTML } from '../../src/host/intake-pages.js'

const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core')
const CHROME = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => existsSync(p))
const OUT = join(process.cwd(), 'tmp', 'static-audit')
mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const rows = []
try {
  const page = await browser.newPage()
  for (const [name, html] of [['intake', INTAKE_HTML], ['intake-mine', MINE_HTML], ['intake-status', STATUS_HTML]]) {
    const file = join(OUT, name + '.html')
    writeFileSync(join(OUT, name + '.html'), html)
    for (const width of [1200, 390]) {
      await page.setViewport({ width, height: 900 })
      await page.goto('file://' + file.replace(/\\/g, '/'), { waitUntil: 'load' })
      const info = await page.evaluate(() => {
        const body = document.body
        const cs = getComputedStyle(body)
        const all = [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 })
        const sizes = {}; const off = {}
        for (const el of all) {
          const s = getComputedStyle(el)
          sizes[s.fontSize] = (sizes[s.fontSize] ?? 0) + 1
          for (const p of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginBottom', 'rowGap', 'columnGap']) {
            const v = Math.round(parseFloat(s[p]))
            if (!Number.isFinite(v) || v === 0 || v <= 2) continue
            if (v % 4 !== 0) off[p + '=' + v] = (off[p + '=' + v] ?? 0) + 1
          }
        }
        const emoji = new Set()
        const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
        while (w.nextNode() !== null) for (const ch of String(w.currentNode.textContent ?? '').match(/\p{Extended_Pictographic}/gu) ?? []) emoji.add(ch)
        return {
          title: document.title,
          bg: cs.backgroundColor, font: cs.fontFamily.split(',')[0].replace(/"/g, ''),
          sizes: Object.keys(sizes).sort(), off, emoji: [...emoji],
          overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
          text: String(body.innerText).replace(/\n{2,}/g, '\n').slice(0, 260),
        }
      })
      const tag = `${name}-${width}`
      await page.screenshot({ path: join(OUT, tag + '.png'), fullPage: true })
      rows.push({ tag, width, ...info })
      console.log(`· ${tag.padEnd(22)} 字号${info.sizes.join('/')} 非网格${Object.keys(info.off).length} emoji${info.emoji.length} 横向溢出${info.overflowX ? '有' : '无'}`)
    }
  }
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(rows, null, 2))
  console.log('\n写了', OUT)
} finally { await browser.close() }
