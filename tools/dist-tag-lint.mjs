#!/usr/bin/env node
/* 发版之后：npm 上有没有「悬空的预发布通道」。
 *
 *   node tools/dist-tag-lint.mjs            只报告（CI 用，永远退出 0，只往日志里打 ::warning::）
 *   node tools/dist-tag-lint.mjs --strict   有问题退出 1（本机用）
 *   node tools/dist-tag-lint.mjs 0.9.20     比较的基准版本（默认取 package.json 的 version）
 *
 * 为什么需要：预发布版本按 npm 的规则必须发到某个 tag（release.yml 用的是 next）；之后同号的
 * 正式版发出去，next 就自然落后了，而 npm 不会自动把它挪走 —— 0.2.2-rc.3 就是这么在 next 上
 * 挂了一整代，于是 `npm i @marsken/dsh-studio@next` 装到的是早于全部功能的构建。
 *
 * CI 只有 publish 权限（Trusted Publishing），动不了 dist-tag，所以这里只把该敲的命令喊出来；
 * 本机的硬断言在 tools/verify-release.mjs（发版一致性检查会 FAIL）。
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { cmpSemver, isVersion } from './lib/semver.mjs'

export const PKG = '@marsken/dsh-studio'

/* 纯函数：拿 dist-tags 和「这次发的版本」比一比。
   返回 { ok, message, fix } —— ok=false 时 message 是给人看的结论，fix 是能直接敲的命令。 */
export const lintNext = (tags, target) => {
  const next = String(tags?.next ?? '')
  const all = Object.keys(tags ?? {})
  if (next === '') return { ok: true, message: '没有 next 通道（当前 tags: ' + (all.join(', ') || '无') + '）', fix: '' }
  if (!isVersion(next) || !isVersion(target)) return { ok: true, message: 'next = ' + next + '（版本号形状不认识，跳过比较）', fix: '' }
  if (cmpSemver(next, target) >= 0) return { ok: true, message: 'next = ' + next + '（不落后于 ' + target + '）', fix: '' }
  return {
    ok: false,
    message: 'npm 上的 next 还指着 ' + next + '，比 ' + target + ' 旧',
    fix: 'npm dist-tag rm ' + PKG + ' next（或 npm dist-tag add ' + PKG + '@' + target + ' next）',
  }
}

const runCli = async () => {
  const strict = process.argv.includes('--strict')
  const explicit = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const target = explicit ?? pkg.version
  try {
    const res = await fetch('https://registry.npmjs.org/' + encodeURIComponent(PKG), {
      headers: { 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw new Error('registry 返回 ' + res.status)
    const verdict = lintNext((await res.json())['dist-tags'] ?? {}, target)
    if (verdict.ok) {
      console.log('ok   ' + verdict.message)
      return 0
    }
    const line = verdict.message + '。本机修：' + verdict.fix
    if (strict) console.error(line)
    else console.log('::warning::' + line)
    return strict ? 1 : 0
  } catch (error) {
    console.log('skip 读不到 registry：' + (error instanceof Error ? error.message : String(error)))
    return 0
  }
}

/* 用 exitCode 而不是 process.exit()：刚 await 完 fetch 就硬退，Windows 上会撞
   "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" 并给出 0xC0000409。 */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli()
}
