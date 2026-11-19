import { readFileSync } from 'node:fs'
import { automationRate, requirementInterventions } from '../src/host/intervention.js'

/* 现场算一遍：人工介入点与自动化率。
 *   node tools/report-intervention.mjs [state.json]
 * 不给文件就读 STUDIO_STATE 指向的文件；都没有就提示用法。 */
const file = process.argv[2] ?? process.env.STUDIO_STATE ?? ''
if (file === '') {
  console.error('用法：node tools/report-intervention.mjs <state.json>\n       （用 curl /studio-api/state 存一份）')
  process.exit(2)
}

const raw = JSON.parse(readFileSync(file, 'utf8'))
const state = raw.state ?? raw
const requirements = state.requirements ?? []
const delivered = requirements
  .filter(requirement => ['done', 'released', 'delivered'].includes(String(requirement.status ?? '')))
  .map(requirement => requirement.id)

console.log(`需求 ${requirements.length} 条 · 已交付 ${delivered.length} 条 · 卡 ${(state.tasks ?? []).length} 张\n`)
for (const requirement of requirements.slice(0, 10)) {
  const summary = requirementInterventions(state, requirement)
  const who = summary.actors.slice(0, 3).join('、') || '—'
  console.log(
    ` ${String(requirement.code ?? requirement.id).padEnd(14)} ${String(requirement.status ?? '').padEnd(10)}`
    + ` 卡 ${String(summary.tasks).padStart(2)} · 人工介入 ${String(summary.interventions).padStart(3)} · ${who}`,
  )
}

/* 「产品 / 架构师 / 开发 / 测试」这类名字是**角色名**：既可能是 AI 专家写的（派单时用角色命名），
   也可能是真的由人签的。现有数据分不出来，所以两种口径都给，不替用户选。 */
const ROLE_NAMES = new Set(['产品', '产品经理', '架构师', '开发', '开发工程师', '测试', '测试工程师'])
const asHuman = (by) => ROLE_NAMES.has(String(by ?? '').trim()) ? 'unknown' : 'human'
const strictDelivered = delivered.map(id => {
  const req = requirements.find(item => item.id === id)
  const summary = requirementInterventions(state, req)
  const points = summary.points.filter(point => asHuman(point.by) === 'human')
  return { id, interventions: points.length }
})
const strictUntouched = strictDelivered.filter(item => item.interventions === 0).length

const rate = automationRate(state, delivered)
console.log('')
console.log(`口径二（把「产品/架构师/开发/测试」这类角色名当成 AI，不算人工介入）：`
  + (delivered.length === 0 ? '无数据' : `${(strictUntouched / delivered.length * 100).toFixed(0)}%（${strictUntouched}/${delivered.length} 条）`))
console.log('')
console.log(rate.rate === null
  ? '自动化率：无数据（还没有已交付的需求）'
  : `自动化率：${(rate.rate * 100).toFixed(0)}%（${rate.untouched}/${rate.delivered} 条需求零人工介入）`)
