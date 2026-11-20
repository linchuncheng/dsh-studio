// GitHub Release 正文的判据。纯函数，方便单测（verify-release 只负责取数）。
//
// 背景：release.yml 用 tools/changelog-section.mjs 从 CHANGELOG 里摘这一版当正文。
// CHANGELOG 少了这一版时，Release 会带着一句占位（"没写更新日志"）发出去——
// 之前 verify:release 只比 Latest 的 tag 名，这种"发了个没有说明的版本"是看不出来的。

/** Release 正文的占位句：出现了就等于"没写更新日志"。 */
export const RELEASE_BODY_PLACEHOLDER = '没写更新日志'

/**
 * @returns {string|null} null = 正文没问题；否则是给人看的原因。
 */
export function releaseBodyIssue(body) {
  const text = String(body ?? '').trim()
  if (text === '') return '正文是空的：release.yml 没取到 CHANGELOG 的这一版'
  if (text.includes(RELEASE_BODY_PLACEHOLDER)) return '正文只有占位句：CHANGELOG 里没有这一版'
  if (text.length < 20) return `正文只有 ${text.length} 字，基本等于没写`
  return null
}
