#!/usr/bin/env node
/**
 * 从 CHANGELOG.md 里取出某个版本那一段，给 GitHub Release 当正文。
 *
 *   node tools/changelog-section.mjs 0.5.2            # 打印正文
 *   node tools/changelog-section.mjs 0.5.2 > notes.md # 写文件（workflow 里这么用）
 *
 * 找不到就打印一句说明并退出 0 —— 发版流程不该因为「日志没写」而失败，
 * 但会在 Release 正文里明说「这条没有写更新日志」，比空白强。
 */
import { readFileSync } from 'node:fs'

const version = String(process.argv[2] ?? '').replace(/^v/, '').trim()
if (version === '') {
  console.error('用法：node tools/changelog-section.mjs <版本，如 0.5.2>')
  process.exit(2)
}

const text = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const lines = text.split(/\r?\n/)
const heading = `## [${version}]`
const start = lines.findIndex(line => line.startsWith(heading))
if (start < 0) {
  console.log(`这一版（${version}）没有写更新日志，看提交记录：https://github.com/marsken88/dsh-studio/commits/v${version}`)
  process.exit(0)
}
let end = lines.length
for (let index = start + 1; index < lines.length; index += 1) {
  if (/^## \[/.test(lines[index])) { end = index; break }
}
const body = lines.slice(start, end).join('\n').trim()
console.log(body)
console.log('')
console.log(`安装：\`dsh plugin --profile web install @marsken/dsh-studio@${version}\``)
