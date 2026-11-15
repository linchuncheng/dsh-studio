// 发版一致性检查：package.json / 本地 tag / origin HEAD / origin tag / npm registry 五处对齐。
// 起因：0.1.15/0.1.16 发到 npm 了，git 却没推上去——「tag && push | tail -1」把失败吞了。
//
//   node tools/verify-release.mjs
//   npm run verify:release
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const PKG = '@marsken/dsh-studio'
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const tag = 'v' + pkg.version
const env = { ...process.env, GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -p 443 -o BatchMode=yes' }

const rows = []
const add = (name, ok, detail) => rows.push({ name, ok, detail })
const git = (args) => execFileSync('git', args, { env, encoding: 'utf8' }).trim()

let head = ''
try { head = git(['rev-parse', 'HEAD']) } catch (e) { add('能读到 git HEAD', false, String(e.message).slice(0, 120)) }

if (head !== '') {
  const branch = git(['status', '-sb']).split('\n')[0]
  add('没有未推送的提交', !branch.includes('ahead'), branch)
  let remote = ''
  try { remote = git(['ls-remote', 'origin', 'refs/heads/main', 'refs/tags/' + tag]) } catch (e) {
    add('能连上 origin', false, String(e.message).slice(0, 120))
  }
  if (remote !== '') {
    add('origin/main 与本机 HEAD 一致', remote.includes(head), head.slice(0, 8))
    add('tag ' + tag + ' 已推到 origin', new RegExp('refs/tags/' + tag + '(\\t|$)', 'm').test(remote), tag)
  }
  // 发版之后还会补文档提交，所以 tag 不必指向 HEAD；只要「tag 里的 package.json 版本对」且「tag 在 main 历史里」。
  let localTag = ''
  try { localTag = git(['rev-parse', '-q', '--verify', 'refs/tags/' + tag]) } catch { localTag = '' }
  add('本地有 tag ' + tag, localTag !== '', localTag === '' ? '没有这个 tag' : localTag.slice(0, 8))
  if (localTag !== '') {
    let taggedVersion = ''
    try {
      taggedVersion = JSON.parse(git(['show', tag + ':package.json'])).version
    } catch (e) { taggedVersion = 'ERR ' + String(e.message).slice(0, 60) }
    add('tag 里的版本号是 ' + pkg.version, taggedVersion === pkg.version, taggedVersion)
    let ancestor = true
    try { git(['merge-base', '--is-ancestor', localTag, 'origin/main']) } catch { ancestor = false }
    add('tag 在 origin/main 的历史里', ancestor, ancestor ? 'yes' : '不在历史里（可能是孤儿 tag）')
  }
}

// npm 侧：版本必须已发布；latest 可能滞后几分钟，只当警告
try {
  const res = await fetch('https://registry.npmjs.org/' + encodeURIComponent(PKG), { signal: AbortSignal.timeout(20000) })
  const reg = await res.json()
  add('npm 上已发布 ' + pkg.version, Boolean(reg.versions?.[pkg.version]), pkg.version)
  const latest = reg['dist-tags']?.latest ?? '(无)'
  add('npm latest == ' + pkg.version, latest === pkg.version, latest === pkg.version ? latest : 'latest 还是 ' + latest + '（可能还没同步，等几分钟）')
} catch (e) {
  add('能读 npm registry', false, String(e.message).slice(0, 120))
}

const hardFail = rows.some((row) => row.ok !== true && !row.name.startsWith('npm latest'))
for (const row of rows) {
  const mark = row.ok === true ? 'ok  ' : row.name.startsWith('npm latest') ? 'warn' : 'FAIL'
  console.log(mark + ' ' + row.name + (row.detail === undefined ? '' : ' — ' + row.detail))
}
console.log(hardFail ? '\n发版不一致：上面标 FAIL 的必须先修。' : '\n发版一致。')
process.exit(hardFail ? 1 : 0)
