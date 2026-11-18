/* 派单阶段的状态判定（纯函数）。
 *
 * 为什么要单独抽出来：`tick()` 判「这张卡这一列派过没有」的依据是
 *
 *     if (task.dispatch?.status === task.status) continue
 *
 * 而 `reconcile()` 以前只把 dispatch.state 改成 stopped、保留 dispatch.status，
 * 于是重启后那张卡的 dispatch.status 等于当前列 → 永远跳过 → **永久停摆**，
 * 界面上却显示「已停止」，看着像正常状态（2026-11-18 后端架构师实测）。
 *
 * 「重新派单」按钮当时也一样：只清失败计数、不清 dispatch 印记，所以按下去永不重派。
 *
 * 这两个 bug 的共同点是「状态形状看着对、语义不对」，只能靠断言而不是肉眼防住。
 * 所以把判定抽成纯函数，并在这里写死四种阶段的定义。
 */

/** 派单阶段。
 *  running  正在跑（会话活着）
 *  stalled  印记还在、但已经不在跑 —— 这就是「永久停摆」的形状，必须能被识别出来
 *  queued   没有被本列派过（或印记已清），下一轮 tick 会拾起它
 *  done     本列派完了（这里不区分结果，只看「要不要再派」）
 */
export function dispatchPhase(task) {
  const dispatch = task?.dispatch ?? null
  if (dispatch === null || typeof dispatch !== 'object') return 'queued'
  if (dispatch.status !== task?.status) return 'queued'
  return dispatch.state === 'running' ? 'running' : 'stalled'
}

/** 停摆判定：印记匹配当前列，但会话已经不在跑。
 *  看板上出现任何一张这样的卡都算异常 —— 它们不会自己恢复，也不会再被派单。 */
export function isStalled(task) {
  return dispatchPhase(task) === 'stalled'
}

/** 统计停摆的卡（给探针与工作台用）。 */
export function countStalled(tasks) {
  const list = Array.isArray(tasks) ? tasks : []
  return list.filter(isStalled).length
}
