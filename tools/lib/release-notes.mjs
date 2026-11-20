// GitHub Release 正文的判据。纯函数，方便单测（verify-release 只负责取数）。
//
// 背景：release.yml 用 tools/changelog-section.mjs 从 CHANGELOG 里摘这一版当正文；
// 摘不到时会**回退**成「提交主题列表」，开头是 `## v<version>` + 一句「这一版没有写更新日志」。
// 之前 verify:release 只比 Latest 的 tag 名，这种"发了个没有说明的版本"看不出来。
//
// 为什么不按占位句做字符串匹配：CHANGELOG 本身会引用这句话（0.9.29、0.9.30 都因为
// 各自正文里提到"没写更新日志"被误判成占位）。**结构比措辞可靠**：
// CHANGELOG 抽出来的段落一定以 `## [<version>]` 开头，回退生成的一定是 `## v<version>`。

/**
 * @param body      Release 正文
 * @param version   版本号（不带 v）；给了就按「有没有 `## [version]` 这一行」判结构
 * @returns {string|null} null = 正文没问题；否则是给人看的原因。
 */
export function releaseBodyIssue(body, version = '') {
  const text = String(body ?? '').trim()
  if (text === '') return '正文是空的：release.yml 没取到 CHANGELOG 的这一版'
  const wanted = String(version ?? '').trim().replace(/^v/, '')
  if (wanted === '') {
    return /^## \[/m.test(text) ? null : '正文里没有「## [版本]」这一段'
  }
  const heading = new RegExp('^## \\[' + wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]', 'm')
  if (heading.test(text)) return null
  return `正文不是 CHANGELOG 的 ${wanted} 这一版（回退成了提交列表，或正文被截断）`
}
