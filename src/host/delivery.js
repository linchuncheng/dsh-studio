/* 交付节奏的三把尺子（纯函数）：门禁一次通过率、派单周活、需求交付时长。
 *
 * 这三项在产品定义 §4 (#9 / #10 / #14) 里一直是「未测量」——
 * 数据其实都在（卡片的 history、评论的 kind、需求的 signoff），只是没人按口径算。
 *
 * 口径写死在注释里，免得下次又各算各的：
 *   #9  门禁一次通过率 = 到过「待验收」的卡里，**第一次进待验收就直接完成**（中间没被打回测试/开发/评审）的占比。
 *       太低说明上游澄清/方案没做到位；太高（接近 100%）说明门禁没在挡人。
 *   #10 派单周活     = 一周内有 ≥1 条 AI 评论的卡片数（按 ISO 周分桶，最近 N 周）。
 *   #14 需求交付时长 = 需求创建 → 验收签字的间隔（中位数，按需求算，不按卡）。
 */

const DAY = 86_400_000
const BACK_TO = new Set(['design', 'dev_ready', 'dev', 'review', 'test', 'clarify'])

/** 一条 history 里的状态流：去掉没有 status 的（有些记录只写 note）。 */
export function statusFlow(task) {
  return (task?.history ?? [])
    .filter(entry => entry !== null && typeof entry === 'object' && String(entry.status ?? '') !== '')
    .map(entry => ({ at: Number(entry.at) || 0, status: String(entry.status) }))
    .sort((a, b) => a.at - b.at)
}

/** #9 门禁一次通过率。只算"到过待验收"的卡；没有这种卡时 rate 是 null（不是 0%）。 */
export function gateFirstPass(tasks) {
  const reached = []
  for (const task of tasks ?? []) {
    const flow = statusFlow(task)
    const acceptAt = flow.findIndex(step => step.status === 'accept')
    if (acceptAt < 0) continue
    const doneAt = flow.findIndex(step => step.status === 'done')
    if (doneAt < 0) continue
    // 进了待验收之后、完成之前，有没有被打回去过
    const bounced = flow.slice(acceptAt + 1, doneAt).some(step => BACK_TO.has(step.status))
    reached.push({ id: task.id, code: task.code ?? '', bounced })
  }
  if (reached.length === 0) return { cards: 0, firstPass: 0, rate: null, bounced: [] }
  const firstPass = reached.filter(item => item.bounced === false).length
  return {
    cards: reached.length,
    firstPass,
    rate: firstPass / reached.length,
    bounced: reached.filter(item => item.bounced).slice(0, 10),
  }
}

/** 本周一 00:00（本地时区）——按周分桶用，"周"从周一开始。 */
export function weekStart(at) {
  const date = new Date(Number(at) || 0)
  const day = (date.getDay() + 6) % 7 // 周一=0
  date.setHours(0, 0, 0, 0)
  return date.getTime() - day * DAY
}

/** #10 派单周活：一周内有多少张卡拿到过 AI 评论。 */
export function dispatchWeekly(tasks, options = {}) {
  const weeks = Math.max(1, Math.min(52, Number(options.weeks) || 8))
  const now = Number(options.now) || Date.now()
  const thisWeek = weekStart(now)
  const buckets = new Map()
  for (let index = 0; index < weeks; index += 1) {
    buckets.set(thisWeek - index * 7 * DAY, new Set())
  }
  for (const task of tasks ?? []) {
    for (const comment of task?.comments ?? []) {
      if (comment === null || typeof comment !== 'object') continue
      const isAi = String(comment.kind ?? '') === 'agent'
      if (!isAi) continue
      const at = Number(comment.at) || 0
      const bucket = weekStart(at)
      if (buckets.has(bucket)) buckets.get(bucket).add(task.id)
    }
  }
  const series = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([week, set]) => ({ week, cards: set.size }))
  const latest = series.length === 0 ? 0 : series[series.length - 1].cards
  return {
    weeks: series,
    latest,
    // 产品定义 #10 的目标：每周 ≥15 张卡有 AI 参与
    target: 15,
    meetsTarget: latest >= 15,
    average: series.length === 0 ? 0 : series.reduce((sum, item) => sum + item.cards, 0) / series.length,
  }
}

/** #14 需求交付时长：创建 → 验收签字。没有签字的（还在进行中）不算。 */
export function requirementDelivery(requirements) {
  const days = []
  const rows = []
  for (const requirement of requirements ?? []) {
    const createdAt = Number(requirement?.createdAt) || 0
    const signedAt = Number(requirement?.signoff?.at) || 0
    if (createdAt <= 0 || signedAt <= 0 || signedAt < createdAt) continue
    const value = (signedAt - createdAt) / DAY
    days.push(value)
    rows.push({ id: requirement.id, code: requirement.code ?? '', days: value })
  }
  if (days.length === 0) return { count: 0, medianDays: null, avgDays: null, rows: [] }
  const sorted = [...days].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  return {
    count: days.length,
    medianDays: median,
    avgDays: days.reduce((sum, value) => sum + value, 0) / days.length,
    rows: rows.sort((a, b) => a.days - b.days),
  }
}
