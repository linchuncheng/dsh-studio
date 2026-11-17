import puppeteer from 'puppeteer-core'
const TOKEN = process.argv[2]
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1600, height: 1000 } })
const p = await b.newPage()
const errs = []
p.on('pageerror', e => errs.push(String(e).slice(0, 140)))
await p.goto('http://192.168.120.218:18080/?token=' + TOKEN, { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(3500)
await p.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find(n => n.children.length === 0 && (n.textContent || '').trim() === '需求&任务工作空间')
  el?.closest('button,a,li,[role="button"],[tabindex]')?.click?.()
})
await p.waitForSelector('[data-dsh-studio]', { timeout: 30000 })
await sleep(1500)
for (const tab of await p.$$('[data-dsh-studio] .ds-head-tabs button')) {
  if ((((await tab.evaluate(n => n.textContent)) || '').trim()) === '效能') { await tab.click(); break }
}
await sleep(5000)
const out = await p.evaluate(() => {
  const text = document.body.innerText.replace(/\s+/g, ' ')
  return {
    unpriced: (text.match(/未配价目的模型[^。]*/) ?? [null])[0],
    tokens: (text.match(/token 用量[^。]*/) ?? [null])[0],
    cost: (text.match(/预估花费[^。]*/) ?? [null])[0],
    crash: text.includes('渲染失败'),
  }
})
await p.screenshot({ path: 'E:/deepseekWorkSpace/super-agents/tmp/analytics-unpriced.png' })
console.log(JSON.stringify({ out, errs }, null, 1))
await b.close()
