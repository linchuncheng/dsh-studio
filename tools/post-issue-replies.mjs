#!/usr/bin/env node
/**
 * 把 tmp/issue-N-reply.md 作为评论发到对应 issue 上。
 *
 *   GITHUB_TOKEN=xxx node tools/post-issue-replies.mjs --dry-run     # 只打印，不发（默认）
 *   GITHUB_TOKEN=xxx node tools/post-issue-replies.mjs               # 真发
 *   GITHUB_TOKEN=xxx node tools/post-issue-replies.mjs --only 3,6    # 只发某几条
 *
 * token 只从环境变量读，不落盘、不进日志。没有 token 时只打印将要发的内容。
 */
import { existsSync, readFileSync } from 'node:fs'

const REPO = process.env.GITHUB_REPO ?? 'marsken88/dsh-studio'
const TOKEN = String(process.env.GITHUB_TOKEN ?? '').trim()
const dryRun = process.argv.includes('--dry-run') || TOKEN === ''
const onlyArg = process.argv.indexOf('--only')
const only = onlyArg >= 0 ? String(process.argv[onlyArg + 1] ?? '').split(',').map(item => item.trim()).filter(Boolean) : []

const issues = [3, 4, 5, 6].filter(number => only.length === 0 || only.includes(String(number)))
if (issues.length === 0) {
  console.error('没有要发的 issue（--only 3,6 这样指定）')
  process.exit(2)
}

let failed = 0
for (const number of issues) {
  const candidates = [`docs/issue-replies/issue-${number}.md`, `tmp/issue-${number}-reply.md`]
  const file = candidates.find(item => existsSync(item)) ?? candidates[0]
  if (!existsSync(file)) {
    console.log(`skip  #${number}：没有 ${file}`)
    continue
  }
  const body = readFileSync(file, 'utf8')
  if (dryRun) {
    console.log(`\n===== #${number}（${body.length} 字符）=====`)
    console.log(body.split('\n').slice(0, 6).join('\n') + '\n…')
    continue
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/issues/${number}/comments`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'dsh-studio-post-reply',
      },
      body: JSON.stringify({ body }),
    })
    const text = await res.text()
    if (!res.ok) {
      failed += 1
      console.log(`FAIL  #${number}：HTTP ${res.status} ${text.slice(0, 160)}`)
      continue
    }
    const json = JSON.parse(text)
    console.log(`ok    #${number}：${json.html_url}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL  #${number}：${String(error?.message ?? error).slice(0, 160)}`)
  }
}

if (dryRun) {
  console.log('\n（dry-run：没有发出去。带 GITHUB_TOKEN 再跑一次才会真发）')
}
process.exit(failed === 0 ? 0 : 1)
