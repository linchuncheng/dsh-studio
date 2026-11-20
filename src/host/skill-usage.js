// 技能的使用证据：这条技能到底被用上过没有、用上的卡有没有返工。
//
// 为什么只算已有事实：product.md 的原则是「不加埋点，只读已有事实」。这里不需要新字段——
// 卡上记着「谁在负责」（task.expert / task.dispatch.expert），专家名册记着「谁挂了哪些技能」，
// 历史里记着「列往回退过没有」（quality.js 的 taskRework）。三者一拼就是答案。
//
// 口径（和效能页的返工率同一条定义，两处数字能对上）：
//   卡片被某个专家接手      → 算这张卡「用上了」这个专家挂的每一条技能
//   这张卡被打回过（列后退） → 算这条技能的一次返工
// 注意：这是**相关性**不是因果。技能挂上去之后卡变好，也可能是需求本身更清楚了；
// 所以只报数，不自动判定「这条技能有用/没用」——那种判断要对照组，现在没有。
import { taskRework } from './quality.js'

/** 每条技能：被哪些专家用过、覆盖多少张卡、其中多少张返工。按覆盖卡数降序。 */
export function skillUsage(state) {
  const experts = (Array.isArray(state?.config?.experts) ? state.config.experts : []).filter(expert => expert.enabled !== false)
  const tasks = Array.isArray(state?.tasks) ? state.tasks : []
  const rows = new Map()
  const touch = name => {
    if (!rows.has(name)) rows.set(name, { name, experts: [], expertsSet: new Set(), cards: 0, done: 0, rework: 0, reworkReasons: new Map() })
    return rows.get(name)
  }
  for (const task of tasks) {
    const expertId = String(task.expert ?? task.dispatch?.expert ?? '').trim()
    if (expertId === '') continue
    const expert = experts.find(entry => entry.id === expertId)
    if (expert === undefined) continue
    const names = Array.isArray(expert.skills) ? expert.skills : []
    if (names.length === 0) continue
    const { rework, reasons } = taskRework(task)
    for (const name of names) {
      const row = touch(name)
      if (!row.expertsSet.has(expert.name)) {
        row.expertsSet.add(expert.name)
        row.experts.push(expert.name)
      }
      row.cards += 1
      if (String(task.status) === 'done') row.done += 1
      if (rework) {
        row.rework += 1
        for (const reason of reasons) row.reworkReasons.set(reason, (row.reworkReasons.get(reason) ?? 0) + 1)
      }
    }
  }
  return [...rows.values()]
    .map(row => ({
      name: row.name,
      experts: row.experts,
      cards: row.cards,
      done: row.done,
      rework: row.rework,
      /** 返工率：分母是「用上的卡」，不是全部卡。0 张时 null（「没数据」≠「0%」）。 */
      reworkRate: row.cards === 0 ? null : Math.round((row.rework / row.cards) * 100),
      // 字段名不叫 text：domain.js 导出了一个 text() 助手，跨模块扫描器会把它当成「用了没导入」
      reasons: [...row.reworkReasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 3),
    }))
    .sort((a, b) => b.cards - a.cards || a.name.localeCompare(b.name))
}

/** 一句话读数（工具与面板共用）：没被用过要说「还没被用上」，而不是显示 0 张卡。 */
export function skillUsageLine(row) {
  if (row === undefined || row === null || row.cards === 0) return '还没被用上（挂它的专家还没接过卡）'
  const rate = row.reworkRate === null ? '' : `，其中 ${row.rework} 张被打回（${row.reworkRate}%）`
  return `用上 ${row.cards} 张卡（完成 ${row.done}）${rate}`
}
