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

/* 只比本仓库会产生的两种形状：x.y.z 与 x.y.z-<pre>（同号时预发布小于正式版）。
   不引 semver 依赖：这里只需要「谁更新」，多一个依赖反而多一处发版风险。 */
const cmpSemver = (a, b) => {
  const split = (v) => {
    const [core, pre = ''] = String(v).split('-', 2)
    return { nums: core.split('.').map((n) => Number(n) || 0), pre }
  }
  const pa = split(a)
  const pb = split(b)
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  if (pa.pre === pb.pre) return 0
  if (pa.pre === '') return 1
  if (pb.pre === '') return -1
  return pa.pre < pb.pre ? -1 : 1
}
const git = (args) => execFileSync('git', args, { env, encoding: 'utf8' }).trim()

let head = ''
try { head = git(['rev-parse', 'HEAD']) } catch (e) { add('能读到 git HEAD', false, String(e.message).slice(0, 120)) }

if (head !== '') {
  const branch = git(['status', '-sb']).split('\n')[0]
  add('没有未推送的提交', !branch.includes('ahead'), branch)
  let remote = ''
  // 这条 SSH 连接很容易被掐（本机到 ssh.github.com:443 这一整轮会话里抖了十几次），
  // 单独一次失败会把「发版一致性」整个判红。重试 3 次，每次间隔 2 秒。
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      remote = git(['ls-remote', 'origin', 'refs/heads/main', 'refs/tags/' + tag])
      lastError = null
      break
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
  if (remote === '' && lastError !== null) {
    add('能连上 origin', false, String(lastError.message).slice(0, 120) + '（已重试 3 次）')
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

// npm 侧：版本必须已发布；latest 可能滞后几分钟，只当警告。
// 刚 publish 完的那几分钟 registry 还看不到新版本，所以支持 --wait <秒> 轮询等待。
const waitArg = process.argv.indexOf('--wait')
const waitSeconds = waitArg > 0 ? Number(process.argv[waitArg + 1]) || 0 : 0
const readRegistry = async () => {
  const res = await fetch('https://registry.npmjs.org/' + encodeURIComponent(PKG), { signal: AbortSignal.timeout(20000) })
  return res.json()
}
try {
  let reg = await readRegistry()
  const deadline = Date.now() + waitSeconds * 1000
  while (reg.versions?.[pkg.version] === undefined && Date.now() < deadline) {
    console.log('… npm 上还没有 ' + pkg.version + '，15 秒后再查（最多等到 ' + waitSeconds + ' 秒）')
    await new Promise(r => setTimeout(r, 15000))
    reg = await readRegistry()
  }
  add('npm 上已发布 ' + pkg.version, Boolean(reg.versions?.[pkg.version]), reg.versions?.[pkg.version] === undefined ? pkg.version + '（刚发布的话可以用 --wait 120 等一等）' : pkg.version)
  const latest = reg['dist-tags']?.latest ?? '(无)'
  add('npm latest == ' + pkg.version, latest === pkg.version, latest === pkg.version ? latest : 'latest 还是 ' + latest + '（可能还没同步，等几分钟）')

  /* dist-tags.next 悬空过一整代：0.2.2-rc.1/2/3 是 2026-11-18 调 CI 的试发版，之后
     0.3 → 0.9 十几个正式版全走 latest，next 一直钉在 0.2.2-rc.3 上，于是
     `npm i @marsken/dsh-studio@next` 装到的是早于全部功能、还对着老宿主接口的构建。
     规则：next 要么不存在（没有预发布通道），要么不比 latest 旧（预发布本来就该更新）。 */
  const next = reg['dist-tags']?.next ?? ''
  const comparable = /^\d+\.\d+\.\d+/.test(next) && /^\d+\.\d+\.\d+/.test(latest)
  const nextBehind = comparable && cmpSemver(next, latest) < 0
  add(
    'npm next 不比 latest 旧',
    !nextBehind,
    next === ''
      ? '没有 next 通道'
      : nextBehind
        ? next + ' 落后于 latest ' + latest + '；修：npm dist-tag rm ' + PKG + ' next（或 npm dist-tag add ' + PKG + '@' + latest + ' next）'
        : next,
  )
} catch (e) {
  add('能读 npm registry', false, String(e.message).slice(0, 120))
}

/* GitHub Releases 的 Latest 必须指向当前版本。
   GitHub 的 Latest 是按**创建时间**定的，不是版本号 —— 补建历史 release 那次就把 v0.1.0 顶成了 Latest。
   正常发版走 release.yml（会带 --latest），这条平时应该绿；一旦变红说明有人乱序建了 release，
   手动跑一次 reorder-releases 就能修（它自带"Latest 对了就跳过"的自愈判断）。
   限流/网络问题时只当"未检查"，不阻塞发版。 */
{
  const repoField = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  const slug = typeof repoField === 'string' ? (/github\.com[/:]([^/]+\/[^/.]+)/.exec(repoField)?.[1] ?? '') : ''
  if (slug !== '') {
    try {
      const res = await fetch('https://api.github.com/repos/' + slug + '/releases/latest', {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-studio-verify-release' },
      })
      if (res.status === 404) add('GitHub Releases Latest == ' + tag, false, '还没有任何 release')
      else if (res.ok) {
        const latestTag = (await res.json()).tag_name ?? '(无)'
        add('GitHub Releases Latest == ' + tag, latestTag === tag, latestTag === tag ? latestTag : 'Latest 是 ' + latestTag)
      } else add('GitHub Releases Latest（未检查）', true, 'API ' + res.status + '（限流时不阻塞）')
    } catch (error) {
      add('GitHub Releases Latest（未检查）', true, String(error?.message ?? error).slice(0, 80))
    }
  }
}

const hardFail = rows.some((row) => row.ok !== true && !row.name.startsWith('npm latest'))
for (const row of rows) {
  const mark = row.ok === true ? 'ok  ' : row.name.startsWith('npm latest') ? 'warn' : 'FAIL'
  console.log(mark + ' ' + row.name + (row.detail === undefined ? '' : ' — ' + row.detail))
}
console.log(hardFail ? '\n发版不一致：上面标 FAIL 的必须先修。' : '\n发版一致。')
process.exit(hardFail ? 1 : 0)
