/* 用例强度（纯函数）：一条用例到底能不能"验"。
 *
 * 背景（会诊共识）：现在的用例生成是字符串模板 —— 一条验收条件 = 一个用例标题，
 * 没有验收条件就给一条"主流程"。于是「用例全绿」不代表验过，门禁强度是虚高的。
 *
 * 这里不做生成（那需要模型），只做**度量与判定**：
 * 一条用例只有带可执行断言（http / shell / db）才算"能验"，否则只是草稿。
 * 产品定义第 8 条要求带可执行断言的用例占比 ≥ 60%，这张尺子就是它。
 */

/** 这条用例带没带可执行的断言。 */
export function isExecutable(testCase) {
  const item = testCase ?? {}
  const http = item.http
  if (http !== null && typeof http === 'object' && String(http.url ?? '').trim() !== '') return true
  const shell = item.shell
  if (shell !== null && typeof shell === 'object' && String(shell.command ?? '').trim() !== '') return true
  if (item.db !== null && item.db !== undefined && typeof item.db === 'object') return true
  return false
}

/** 一批用例的强度：总数、可执行数、占比（没有用例时是 null，不是 0）。 */
export function coverageStrength(cases) {
  const list = Array.isArray(cases) ? cases : []
  const executable = list.filter(isExecutable).length
  return {
    total: list.length,
    executable,
    draft: list.length - executable,
    rate: list.length === 0 ? null : executable / list.length,
  }
}

/** 产品定义第 8 条的门槛。 */
export const COVERAGE_TARGET = 0.6

/** 是否达到门槛。没有用例时返回 null —— 「没数据」和「不达标」必须分开。 */
export function meetsCoverageTarget(cases, target = COVERAGE_TARGET) {
  const strength = coverageStrength(cases)
  if (strength.rate === null) return null
  return strength.rate >= target
}

/** 用例结果：**没有可执行定义就不许标 pass** —— 跑不起来的用例点成通过就是假绿。
 *  规则放这里而不是 domain.js：那边有 2000 行上限，规则也该跟其他判定放一起。 */
export function resolveCaseResult(rawResult, raw) {
  const value = String(rawResult ?? 'pending')
  if (value !== 'pass') return value
  return isExecutable(raw) ? 'pass' : 'pending'
}
