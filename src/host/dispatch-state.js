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
/* 2026-11-22 补第三种坑：**state 写着 running，会话其实早就没了**。
   本机实测：派单记录 status=review / state=running，会话文件只有头，18 分钟没有任何输出。
   因为 state 仍是 running，既不算 stalled（不提示）、也不会被下一轮 tick 拾起（永不重派）——
   比「stopped 停摆」更隐蔽。

   ctx（可不传，不传就按 10 分钟兜底）：
     now               当前时间戳
     runningTimeoutMs  running 多久没动静算挂死
     isLive(sessionId) 会话是否真的活着；传了就以它为准（真会话表比时间戳可靠）
*/
export const RUNNING_TIMEOUT_MS = 10 * 60 * 1000

export function dispatchPhase(task, ctx = {}) {
  const dispatch = task?.dispatch ?? null
  if (dispatch === null || typeof dispatch !== 'object') return 'queued'
  if (dispatch.status !== task?.status) return 'queued'
  if (dispatch.state !== 'running') return 'stalled'
  const isLive = typeof ctx.isLive === 'function' ? ctx.isLive : null
  if (isLive !== null) return isLive(dispatch.sessionId) ? 'running' : 'stalled'
  const now = Number(ctx.now ?? Date.now())
  const timeout = Number(ctx.runningTimeoutMs ?? RUNNING_TIMEOUT_MS)
  const at = Number(dispatch.at ?? 0)
  if (timeout > 0 && at > 0 && now - at > timeout) return 'stalled'
  return 'running'
}

/** 停摆判定：印记匹配当前列，但会话已经不在跑。
 *  看板上出现任何一张这样的卡都算异常 —— 它们不会自己恢复，也不会再被派单。 */
export function isStalled(task, ctx = {}) {
  return dispatchPhase(task, ctx) === 'stalled'
}

/** 统计停摆的卡（给探针与工作台用）。 */
export function countStalled(tasks, ctx = {}) {
  const list = Array.isArray(tasks) ? tasks : []
  return list.filter(task => isStalled(task, ctx)).length
}

/** 进程重启把「跑着的派单」收掉时，这张卡该记成第几次尝试。
 *
 *  注释里一直写着「并把本轮记为一次 abandoned 尝试」，但代码只是原样保留 attempts ——
 *  崩过的这一轮不进计数，重试上限就永远判不到（CTO 评审点名的"注释与代码不一致"）。
 *  返回新的 attempts 与是否已经用尽（用尽就不该再自动派）。 */
export function abandonedRetry(dispatch, maxAttempts = 3) {
  const previous = Number(dispatch?.attempts ?? 0) || 0
  const attempts = previous + 1
  const limit = Number(maxAttempts) > 0 ? Number(maxAttempts) : 3
  return { attempts, previous, exhausted: attempts >= limit }
}
