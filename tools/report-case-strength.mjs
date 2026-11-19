import { readFileSync } from 'node:fs'
import { COVERAGE_TARGET, coverageStrength } from '../src/host/case-strength.js'

/* 现场算用例强度：多少条能真的验、多少条只是标题。
 *   node tools/report-case-strength.mjs <state.json>
 */
const file = process.argv[2] ?? process.env.STUDIO_STATE ?? ''
if (file === '') {
  console.error('用法：node tools/report-case-strength.mjs <state.json>')
  process.exit(2)
}
const raw = JSON.parse(readFileSync(file, 'utf8'))
const state = raw.state ?? raw
const tasks = state.tasks ?? []
const all = tasks.flatMap(task => (task.cases ?? []).map(item => ({ ...item, taskId: task.id })))
const strength = coverageStrength(all)

console.log(`全库用例 ${strength.total} 条：可执行 ${strength.executable}、只有标题 ${strength.draft}`)
console.log(strength.rate === null
  ? '强度：无数据'
  : `强度：${(strength.rate * 100).toFixed(1)}%（门槛 ${(COVERAGE_TARGET * 100).toFixed(0)}% → ${strength.rate >= COVERAGE_TARGET ? '达标' : '不达标'}）`)

const worst = tasks
  .map(task => ({ id: task.id, title: String(task.title ?? '').slice(0, 22), ...coverageStrength(task.cases ?? []) }))
  .filter(item => item.total > 0)
  .sort((a, b) => b.draft - a.draft)
  .slice(0, 5)
console.log('\n只有标题最多的卡：')
for (const item of worst) {
  console.log(` ${item.id} ${item.title.padEnd(24)} 用例 ${String(item.total).padStart(2)} · 可执行 ${String(item.executable).padStart(2)} · 草稿 ${String(item.draft).padStart(2)}`)
}
