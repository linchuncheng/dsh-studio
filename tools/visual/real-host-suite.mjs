// 把需要真机（部署实例 + token）的探针挨个跑一遍，只输出结论行。
// 用途：发版前的真机回归——假宿主夹具数据太简单，这类问题只有真数据才暴露。
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const TOKEN = process.env.STUDIO_TOKEN ?? ''
const BASE = process.env.STUDIO_BASE ?? 'http://192.168.120.218:18080'
if (TOKEN === '') {
  console.error('需要 STUDIO_TOKEN')
  process.exit(2)
}

/** 这些脚本要真机：都接受 STUDIO_BASE / STUDIO_TOKEN。 */
const scripts = readdirSync('tools/visual')
  .filter(name => name.endsWith('.mjs'))
  .filter(name => !/pages-probe|overlay-audit|static-pages/.test(name)) // 假宿主探针，不需要真机
  .filter(name => !/^(real-host-suite|design-audit|design-diff|capture|component-audit|layout-audit|select-audit|drawer-tabs|probe-unpriced|toast-diag|ui-audit|state-audit)/.test(name)) // 诊断/审计脚本，不带 ok/FAIL 约定
  .sort()

const results = []
for (const name of scripts) {
  const started = Date.now()
  const run = spawnSync(process.execPath, [resolve('tools/visual', name)], {
    env: { ...process.env, STUDIO_BASE: BASE, STUDIO_TOKEN: TOKEN },
    encoding: 'utf8',
    timeout: 240000,
  })
  const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
  const failed = (run.stdout ?? '').match(/^FAIL .*$/gm) ?? []
  const passed = (run.stdout ?? '').match(/^ok .*$/gm) ?? []
  const summary = ((run.stdout ?? '').match(/^.*(全部通过|项失败|跳过).*$/gm) ?? []).slice(-1)[0] ?? ''
  const seconds = Math.round((Date.now() - started) / 1000)
  const status = run.status === 0 ? 'PASS' : 'FAIL'
  results.push({ name, status, passed: passed.length, failed: failed.length, summary: summary.trim(), seconds })
  console.log(`${status}  ${name.padEnd(24)} ok=${String(passed.length).padStart(2)} fail=${failed.length} ${String(seconds).padStart(3)}s  ${summary.slice(0, 60)}`)
  for (const line of failed.slice(0, 3)) console.log(`        ${line.slice(0, 120)}`)
  const errorish = /Error|Timeout|not defined/i.test(output) && run.status !== 0
  if (errorish) console.log(`        ${output.split('\n').filter(l => /Error|Timeout|not defined/i.test(l))[0]?.slice(0, 140) ?? ''}`)
}

const bad = results.filter(r => r.status === 'FAIL')
console.log('')
console.log(`真机探针：${results.length} 个脚本，失败 ${bad.length} 个`)
if (bad.length > 0) console.log('失败清单：' + bad.map(r => r.name).join(', '))
process.exit(bad.length === 0 ? 0 : 1)
