#!/usr/bin/env node
/**
 * 从 CHANGELOG.md 里取出某个版本那一段，给 GitHub Release 当正文。
 *
 *   node tools/changelog-section.mjs 0.5.2                      # 只取 CHANGELOG
 *   node tools/changelog-section.mjs 0.1.10 --prev v0.1.9       # 日志没写这版时，退回列提交
 *
 * 为什么要有回退：仓库早期 60 多个 tag 大多没写 CHANGELOG，Release 正文只有一句
 * "没写更新日志" 等于没信息。给了 --prev 就把 prev..tag 之间的提交主题列出来，
 * 至少让人看见这一版动了什么。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const version = String(args.find(item => !item.startsWith('--')) ?? '').replace(/^v/, '').trim()
const prevIndex = args.indexOf('--prev')
const prev = prevIndex >= 0 ? String(args[prevIndex + 1] ?? '').trim() : ''

if (version === '') {
  console.error('用法：node tools/changelog-section.mjs <版本，如 0.5.2> [--prev <上一个 tag>]')
  process.exit(2)
}

const repo = 'marsken88/dsh-studio'
const text = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const lines = text.split(/\r?\n/)
const start = lines.findIndex(line => line.startsWith(`## [${version}]`))

if (start >= 0) {
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^## \[/.test(lines[index])) { end = index; break }
  }
  console.log(lines.slice(start, end).join('\n').trim())
  console.log('')
  console.log(`安装：\`dsh plugin --profile web install @marsken/dsh-studio@${version}\``)
} else {
  // CHANGELOG 里没有这一版：列出 prev..tag 之间的提交，别只留一句"没写日志"。
  console.log(`## v${version}`)
  console.log('')
  console.log(`这一版没有写更新日志，下面是它包含的提交（完成后对比完整 diff）：`)
  console.log('')
  let commits = ''
  try {
    const range = prev === '' ? '' : `${prev}..v${version}`
    commits = execFileSync('git', ['log', '--no-merges', '--pretty=- %s (%h)', range === '' ? '.' : range], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .slice(0, 40)
      .join('\n')
  } catch (error) {
    commits = `（读 git 历史失败：${String(error?.message ?? error).slice(0, 120)}）`
  }
  console.log(commits === '' ? '（这个区间里没有可用提交信息）' : commits)
  console.log('')
  console.log(`完整对比：https://github.com/${repo}/compare/${prev === '' ? '' : `${prev}...`}v${version}`)
  console.log('')
  console.log(`安装：\`dsh plugin --profile web install @marsken/dsh-studio@${version}\``)
}
