// 项目检查执行器：在被交付的项目目录（优先卡的 worktree）里跑一条本地质量命令，
// 比如 `npm run check` / `pnpm test` / `go vet ./...`。
//
// 为什么和 shell 用例分开：
//   - shell 用例挂在一张卡上、靠 config.testing.allowShell 开关，是"测这条需求"；
//   - 项目检查是"这个仓库自己的闸门"，命令配在项目/服务上，一次结果直接进准出。
// 两者都执行外部命令，所以超时、输出截断、退出码这三件事按同一套规矩处理。
import { exec } from 'node:child_process'

export const QUALITY_DEFAULT_TIMEOUT_MS = 120_000
/** 输出只留尾部：足够看失败原因，又不至于把 state 撑大。 */
export const QUALITY_TAIL = 4000

/**
 * 跑一次检查。永远不抛：跑不起来（命令不存在、目录不存在）也是一次"不通过"，带上原因。
 * @returns {Promise<{ok:boolean, exitCode:number|null, ms:number, timedOut:boolean, output:string}>}
 */
export async function runQualityCommand({ cmd, cwd = '', timeoutMs = QUALITY_DEFAULT_TIMEOUT_MS } = {}) {
  const command = String(cmd ?? '').trim()
  if (command === '') {
    return { ok: false, exitCode: null, ms: 0, timedOut: false, output: '没有配置项目检查命令' }
  }
  const started = Date.now()
  const result = await new Promise(finish => {
    exec(command, {
      cwd: cwd === '' ? undefined : cwd,
      timeout: Math.max(1_000, Number(timeoutMs) || QUALITY_DEFAULT_TIMEOUT_MS),
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      finish({ error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
  const combined = `${result.stdout}${result.stderr}`
  const error = result.error ?? null
  // 超时被杀：error.killed 为 true 且 signal 是 SIGTERM；exit code 在 Windows 上可能为空。
  const timedOut = error !== null && (error.killed === true || error.signal === 'SIGTERM')
  let exitCode = 0
  if (error !== null) {
    exitCode = Number.isFinite(Number(error.code)) ? Number(error.code) : 1
  }
  const tail = combined.trim().slice(-QUALITY_TAIL)
  return {
    ok: error === null,
    exitCode: timedOut ? null : exitCode,
    ms: Date.now() - started,
    timedOut,
    output: timedOut ? `（超时 ${Math.round((Date.now() - started) / 1000)}s 被终止）\n${tail}` : tail,
  }
}
