// 自动建缺陷卡时的严重级别：按失败用例自己的优先级来，别再一律 p2。
// 纯函数，方便单测；建卡在 index.js 的 autoBugFromCase。

export const SEVERITY_ORDER = ['p0', 'p1', 'p2', 'p3']

/**
 * @param casePriority 用例优先级（p0-p3，缺省按 p2）
 * @param cardStatus   卡当前所在列；已验收/已完成上失败说明是回归，严重级别升一级
 */
export function bugSeverityFor(casePriority, cardStatus) {
  const raw = String(casePriority ?? '').trim().toLowerCase()
  let index = SEVERITY_ORDER.indexOf(raw)
  if (index < 0) index = SEVERITY_ORDER.indexOf('p2')
  // 「已完成/待验收的卡跑失败了」比开发中的失败更要紧：往上升一级（p0 封顶）
  const regression = cardStatus === 'done' || cardStatus === 'accept'
  if (regression && index > 0) index -= 1
  const severity = SEVERITY_ORDER[index]
  const priority = severity === 'p0' ? 'urgent' : severity === 'p3' ? 'relaxed' : 'normal'
  return { severity, priority, regression }
}
