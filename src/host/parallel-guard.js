// 并发派单的隔离护栏（纯函数，单测在 tests/parallel-guard.test.mjs）。
//
// 问题：并发派单（maxConcurrent > 1）本来是为了让多张卡同时推进，但**每张卡必须有自己的工作区**。
// 隔离设成 none 时，多张卡会在同一个目录里并行改代码 —— 后写的覆盖先写的，git 事后也说不清谁覆盖了谁。
// 以前这个组合没有任何提示：面板上「并发 2/2」看起来一切正常，实际两张卡在同一个目录里打架。
//
// 处理方式（保守，不硬拒派单）：把**有效并发降到 1**，并把原因显式返回给面板与派单日志，
// 等人自己把隔离切成 worktree。这样既不会让正在跑的部署突然停摆，也不会静默并行写同一个目录。

/** 派单并发上限的硬边界（与面板下拉一致）。 */
export const MAX_CONCURRENT_CEILING = 8

/**
 * 算出「实际生效的并发数」，并说明为什么被降级。
 *
 * @param config 面板配置（config.agents）
 * @returns {{ limit: number, configured: number, isolated: boolean, capped: boolean, reason: string }}
 */
export function effectiveConcurrency(config) {
  const raw = Number(config?.maxConcurrent)
  const configured = Math.max(1, Math.min(MAX_CONCURRENT_CEILING, Number.isFinite(raw) && raw > 0 ? raw : 2))
  // 只有显式 worktree 才算隔离；none / 其它值都当成「共用目录」
  const isolated = String(config?.isolation ?? 'none') === 'worktree'
  if (configured > 1 && !isolated) {
    return {
      limit: 1,
      configured,
      isolated,
      capped: true,
      reason: `并发派单要求每张卡一个 worktree：当前隔离是「${String(config?.isolation ?? 'none')}」，`
        + `已把并发从 ${configured} 降到 1，避免多张卡在同一目录里互相覆盖。要并行请把「隔离」切成 worktree。`,
    }
  }
  return { limit: configured, configured, isolated, capped: false, reason: '' }
}
