/* 人工介入统计（纯函数）。
 *
 * 为什么需要：产品定义里第 13、14 条验收标准是「自动化率」和「按需求的平均交付时长」，
 * 而这两项**今天算不出来** —— 审计只到路由级、没有需求维度；评论不区分人和 AI；
 * 派单日志只在内存 300 条、重启清零。
 *
 * 好消息是「人有没有介入」这件事**已经能从现有数据里读出来**，不需要新增埋点：
 *   - 评论的 by 字段：AI 会话写的是 studio-<task>-<expert>，人写的是名字
 *   - 卡片 history：换列/改负责人/签字都会留痕
 *   - 签字记录：agent 签的 vs 人签的
 *
 * 所以这里只做「把已有事实读出来」，不加新表、不改写路径。
 */

/* 实测发现：history / 评论里的"非人"写法不止一种 ——
   会话痕迹是 studio-<taskId>-<expertId>，而系统自己记账写成 agent / 系统 / system。
   只认 studio- 会把 agent 和系统算成"人"，于是自动化率一直是 0%（看起来像没人用 AI，
   实际是统计口径错了）。这里把已知的非人写法都列进来。 */
const AI_ACTOR = /^(studio-|agent$|system$|ai$|系统$)/i

export function isAiActor(name) {
  return AI_ACTOR.test(String(name ?? '').trim())
}

/** 人 vs AI：空值算「未知」，不计入任何一边（宁可少算，不要算错）。 */
export function actorKind(name) {
  const text = String(name ?? '').trim()
  if (text === '') return 'unknown'
  return isAiActor(text) ? 'ai' : 'human'
}

/** 一张卡上的人工介入点：人写的评论 + 人动过的列 + 人签的字。 */
export function cardInterventions(task) {
  const points = []
  for (const comment of task?.comments ?? []) {
    if (actorKind(comment?.by) === 'human') points.push({ kind: 'comment', by: comment.by, at: Number(comment.at) || 0 })
  }
  for (const entry of task?.history ?? []) {
    // history 里凡是有人名的都算人动过；系统自己写的（dispatcher/tick）没有 by
    if (actorKind(entry?.by) === 'human') points.push({ kind: String(entry.action ?? 'update'), by: entry.by, at: Number(entry.at) || 0 })
  }
  for (const sign of task?.signoffs ?? []) {
    if (actorKind(sign?.by) === 'human') points.push({ kind: 'signoff', by: sign.by, at: Number(sign.at) || 0 })
  }
  return points
}

/** 一条需求的汇总：卡上的介入点 + 需求自身的签字。 */
export function requirementInterventions(state, requirement) {
  const tasks = (state?.tasks ?? []).filter(task => task.requirementId === requirement?.id)
  const points = []
  for (const task of tasks) {
    for (const point of cardInterventions(task)) points.push({ ...point, taskId: task.id })
  }
  for (const sign of requirement?.signoffs ?? []) {
    if (actorKind(sign?.by) === 'human') points.push({ kind: 'requirement-signoff', by: sign.by, at: Number(sign.at) || 0 })
  }
  const taskIds = tasks.map(task => task.id)
  return {
    requirementId: String(requirement?.id ?? ''),
    tasks: taskIds.length,
    interventions: points.length,
    byKind: points.reduce((acc, point) => { acc[point.kind] = (acc[point.kind] ?? 0) + 1; return acc }, {}),
    actors: [...new Set(points.map(point => point.by))],
    points,
  }
}

/** 自动化率：已交付需求里，**零人工介入**走完的占比。
 *  「已交付」= 需求状态是 done 或 released（不由这里判断业务口径，调用方传进来）。 */
export function automationRate(state, deliveredIds) {
  const delivered = new Set(Array.isArray(deliveredIds) ? deliveredIds : [])
  const requirements = (state?.requirements ?? []).filter(item => delivered.has(item.id))
  if (requirements.length === 0) return { delivered: 0, untouched: 0, rate: null, perRequirement: [] }
  const perRequirement = requirements.map(item => {
    const summary = requirementInterventions(state, item)
    return { id: item.id, code: item.code ?? '', tasks: summary.tasks, interventions: summary.interventions }
  })
  const untouched = perRequirement.filter(item => item.interventions === 0).length
  return {
    delivered: requirements.length,
    untouched,
    rate: untouched / requirements.length,
    perRequirement,
  }
}
