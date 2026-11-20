// 浏览器用例执行器：真开一个 Chromium 内核浏览器（Chrome / Edge / Chromium），
// 跳到页面、按步骤操作、然后断言页面上看得见的东西。
//
// 为什么单独一个执行器：接口用例能证明「接口对」，证明不了「按钮点得动」。
// AGENTS.md 记着一次事故——shell / db 用例在抽屉里建得出来、却永远跑不了；
// 所以这里同时给「形状（sanitizeCaseBrowser）」和「执行（runBrowserCase）」，两边都不缺。
//
// 默认关闭（config.testing.allowBrowser）：打开它等于允许看板在你的机器上开浏览器、访问内网地址，
// 和 allowShell 同一档风险。
import { resolveAllowedUrl } from './url-guard.js'

export const BROWSER_STEP_KINDS = ['click', 'fill', 'wait', 'waitFor']
const MAX_STEPS = 10
const DEFAULT_TIMEOUT = 30_000

/** 常见安装位置：装了 Chrome / Edge 任意一个就能跑，不要求是哪一个。 */
const KNOWN_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

/** 浏览器用例的形状：地址 + 步骤 + 断言。认 `path` 当 `url` 的别名（和接口用例一致）。 */
export function sanitizeCaseBrowser(raw) {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null
  const url = String(raw.url ?? raw.path ?? '').trim().slice(0, 500)
  const expectText = String(raw.expectText ?? '').slice(0, 300)
  const expectSelector = String(raw.expectSelector ?? '').slice(0, 200)
  const expectUrl = String(raw.expectUrl ?? '').slice(0, 300)
  const expectStatus = Math.max(0, Math.min(599, Number(raw.expectStatus) || 0))
  const steps = []
  for (const step of (Array.isArray(raw.steps) ? raw.steps : []).slice(0, MAX_STEPS)) {
    if (step === null || typeof step !== 'object') continue
    const kind = String(step.kind ?? '').trim()
    /* 认两种形状：手写的 `{click}` / `{fill,text}` / `{wait}` / `{waitFor}`，以及存库后的 `{kind,selector|ms}`。
       **清洗必须幂等**：一条用例写库时过一遍 sanitizeCase，跑的时候 item.browser 已经是存库形状，
       再清洗一遍如果只认手写形状，步骤会被静默丢光（2026-11-20 真机就是这么翻的车：点了没反应，
       断言报"页面上没有…"，看起来像产品 bug）。 */
    const clickSelector = kind === 'click' ? step.selector : step.click
    if (String(clickSelector ?? '').trim() !== '') {
      steps.push({ kind: 'click', selector: String(clickSelector).trim().slice(0, 200) })
      continue
    }
    const fillSelector = kind === 'fill' ? step.selector : step.fill
    if (String(fillSelector ?? '').trim() !== '') {
      steps.push({ kind: 'fill', selector: String(fillSelector).trim().slice(0, 200), text: String(step.text ?? '').slice(0, 1000) })
      continue
    }
    const waitMs = kind === 'wait' ? step.ms : step.wait
    if (Number(waitMs) > 0) {
      steps.push({ kind: 'wait', ms: Math.max(1, Math.min(10_000, Number(waitMs))) })
      continue
    }
    const waitSelector = kind === 'waitFor' ? step.selector : step.waitFor
    if (String(waitSelector ?? '').trim() !== '') {
      steps.push({ kind: 'waitFor', selector: String(waitSelector).trim().slice(0, 200) })
    }
  }
  if (url === '' && steps.length === 0 && expectText === '' && expectSelector === '' && expectUrl === '') return null
  return {
    url,
    expectStatus,
    expectText,
    expectSelector,
    expectUrl,
    steps,
    timeoutMs: Math.max(5_000, Math.min(120_000, Number(raw.timeoutMs) || DEFAULT_TIMEOUT)),
  }
}

/**
 * 找可用的浏览器：设置里指定的 → 环境变量 CHROME_PATH → 常见安装位置。
 * 返回 null 表示这台机器上没有；不抛错（"没装"是一个可解释的结果，不是异常）。
 */
export function resolveBrowserExecutable(config, exists = undefined) {
  const explicit = String(config?.testing?.browserPath ?? '').trim() || String(process.env.CHROME_PATH ?? '').trim()
  if (explicit !== '') return explicit
  if (typeof exists === 'function') {
    for (const path of KNOWN_PATHS) {
      try { if (exists(path) === true) return path } catch { /* 权限之类，继续找下一个 */ }
    }
    return null
  }
  return KNOWN_PATHS[0]
}

/** 一条浏览器用例跑完的结论，形状与 http / shell / db 执行器一致。 */
export async function runBrowserCase(item, env, config, seedVars = {}) {
  const started = Date.now()
  const fail = error => ({ ok: false, status: 0, ms: Date.now() - started, error: String(error).slice(0, 300), preview: '' })
  const spec = sanitizeCaseBrowser(item?.browser)
  if (spec === null) return fail('这条用例还没有浏览器动作定义（url / steps / 断言至少要有一个）')
  if (config?.testing?.allowBrowser !== true) {
    return fail('这台机器没开浏览器用例：设置 → 测试执行 里打开「允许浏览器用例」')
  }
  const { existsSync } = await import('node:fs')
  const executablePath = resolveBrowserExecutable(config, existsSync)
  if (executablePath === null) {
    return fail('没找到可用的浏览器：在 设置 → 测试执行 → 浏览器路径 里填 Chrome / Edge 的路径，或设环境变量 CHROME_PATH')
  }
  let puppeteer
  try {
    const loaded = await import('puppeteer-core')
    puppeteer = loaded.default ?? loaded
  } catch {
    return fail('这台机器没装 puppeteer-core（它是 devDependency）：在部署机上装一份，或改用接口用例')
  }

  const timeout = spec.timeoutMs
  let browser = null
  let status = 0
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    page.setDefaultTimeout(timeout)
    const problems = []

    if (spec.url !== '') {
      const target = resolveAllowedUrl(spec.url, env?.baseUrl ?? '', config?.testing?.allowHosts ?? [])
      const response = await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout })
      status = response === null ? 0 : response.status()
      if (spec.expectStatus > 0 && status !== spec.expectStatus) {
        problems.push(`页面返回 ${status}（期望 ${spec.expectStatus}）`)
      }
    }

    for (const step of spec.steps) {
      if (step.kind === 'wait') {
        await new Promise(resolve => setTimeout(resolve, step.ms))
        continue
      }
      if (step.kind === 'click') {
        await page.click(step.selector)
        continue
      }
      if (step.kind === 'fill') {
        await page.click(step.selector, { clickCount: 3 })
        await page.keyboard.press('Backspace')
        await page.type(step.selector, step.text, { delay: 20 })
        continue
      }
      if (step.kind === 'waitFor') {
        await page.waitForSelector(step.selector, { timeout })
      }
    }

    const text = await page.evaluate(() => (document.body === null ? '' : document.body.innerText))
    if (spec.expectText !== '' && text.includes(spec.expectText) !== true) {
      problems.push(`页面上没有「${spec.expectText}」`)
    }
    if (spec.expectSelector !== '') {
      const found = await page.$(spec.expectSelector)
      if (found === null) problems.push(`页面上没有元素 ${spec.expectSelector}`)
      else await found.dispose()
    }
    if (spec.expectUrl !== '' && page.url().includes(spec.expectUrl) !== true) {
      problems.push(`当前地址是 ${page.url()}（期望包含 ${spec.expectUrl}）`)
    }

    return {
      ok: problems.length === 0,
      status,
      ms: Date.now() - started,
      error: problems.join('；').slice(0, 300),
      preview: text.trim().slice(-600),
    }
  } catch (error) {
    return fail(error?.message ?? error)
  } finally {
    if (browser !== null) await browser.close().catch(() => {})
  }
}
