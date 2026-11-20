// 发版链路的约定：正常发版只走 release.yml；backfill/reorder 是手动维修工具
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = rel => readFileSync(new URL(rel, root), 'utf8')
const releaseYml = read('.github/workflows/release.yml')
const onBlock = source => {
  const start = source.indexOf('\non:')
  const end = source.indexOf('\npermissions:', start)
  return source.slice(start, end < 0 ? undefined : end)
}

test('backfill / reorder 只在手动触发时跑（tag push 不评估 paths，挂着 push 会每次发版都跑）', () => {
  for (const file of ['.github/workflows/backfill-releases.yml', '.github/workflows/reorder-releases.yml']) {
    const block = onBlock(read(file))
    assert.ok(block.includes('workflow_dispatch'), file + ' 必须保留手动触发')
    assert.ok(!/\bpush:/.test(block), file + ' 不能再挂 push 触发：GitHub 对 tag push 不评估 paths 过滤器，会每次发版都跑')
  }
})

test('正常发版由 release.yml 建 release 并抢 Latest', () => {
  const release = read('.github/workflows/release.yml')
  assert.match(release, /gh release create/, 'release.yml 要建 release')
  assert.match(release, /--latest/, '稳定版要带 --latest')
  assert.match(release, /--prerelease --latest=false/, '预发布不能抢 Latest')
})

test('发版校验会盯 GitHub Releases 的 Latest', () => {
  const script = read('tools/verify-release.mjs')
  assert.match(script, /releases\/latest/, 'verify:release 要查 releases/latest')
  assert.match(script, /Latest ==/, '要有可读的断言名')
})

// 0.2.2-rc.3 的教训：next 是预发布通道，正式版不会把它挪走，于是 `npm i @xxx/name@next`
// 装到的是早于全部功能的构建。verify:release 必须断言它不落后于 latest。
test('发版校验会盯 npm 的 next 通道不落后于 latest', () => {
  const script = read('tools/verify-release.mjs')
  assert.match(script, /dist-tags'\]\?\.next|dist-tags\?\.next/, 'verify:release 要读 dist-tags.next')
  assert.match(script, /npm next 不比 latest 旧/, '要有可读的断言名')
  assert.match(script, /cmpSemver/, '要真的比版本号，不是只判空')
})

test('预发布占住 next 时 release.yml 必须给出提醒', () => {
  const release = read('.github/workflows/release.yml')
  assert.match(release, /--tag next/, '预发布预览版本仍走 next 通道')
  assert.match(release, /::warning::[^\n]*next/, '要提醒维护者在正式版之后清掉 next（CI 没有 dist-tag 令牌）')
})

// 正式版发完，上一次预发布留在 next 上的版本就落后了，npm 不会自动挪它。
// 流水线要在发布之后把它喊出来（CI 没权限改 tag，只能提示），本机则由 verify:release 硬拦。
test('发布之后流水线会检查 next 有没有悬空（只提示不阻塞）', () => {
  const release = read('.github/workflows/release.yml')
  assert.match(release, /tools\/dist-tag-lint\.mjs/, '发版后要跑 dist-tag-lint')
  assert.match(release, /continue-on-error:\s*true/, '这条只提示，不能阻塞发版')
  assert.ok(release.indexOf('dist-tag-lint.mjs') > release.indexOf('npm publish'), '必须排在 publish 之后')
})

test('cmpSemver：同号预发布小于正式版，号大的更新', async () => {
  const { cmpSemver, isVersion } = await import('../tools/lib/semver.mjs')
  assert.equal(cmpSemver('0.2.2-rc.3', '0.9.15'), -1)
  assert.equal(cmpSemver('0.9.16', '0.9.15'), 1)
  assert.equal(cmpSemver('0.9.15', '0.9.15'), 0)
  assert.equal(cmpSemver('0.2.2', '0.2.2-rc.3'), 1, '正式版 > 同号预发布')
  assert.equal(cmpSemver('0.2.2-rc.1', '0.2.2-rc.3'), -1)
  assert.equal(cmpSemver('0.10.0', '0.9.18'), 1, '0.10 比 0.9 新（按数字比，不按字符串）')
  assert.equal(isVersion('0.9.19-next.0'), true)
  assert.equal(isVersion('(无)'), false, '脏值不能被拿去比较')
})

test('lintNext：next 落后才报警，且必须给出能直接敲的命令', async () => {
  const { lintNext } = await import('../tools/dist-tag-lint.mjs')
  // 没有 next 通道 —— 通过
  assert.equal(lintNext({ latest: '0.9.18' }, '0.9.18').ok, true)
  // next 比最新版新 —— 通过（预发布通道正常）
  assert.equal(lintNext({ latest: '0.9.18', next: '0.9.19-next.0' }, '0.9.18').ok, true)
  // 正式版发完，next 还停在同号预发布 —— 必须报
  const stale = lintNext({ latest: '0.9.20', next: '0.9.19-next.0' }, '0.9.20')
  assert.equal(stale.ok, false)
  assert.match(stale.fix, /npm dist-tag rm @marsken\/dsh-studio next/, '要给出可以直接敲的命令')
  assert.match(stale.message, /0\.9\.19-next\.0/)
  // 脏值不参与比较
  assert.equal(lintNext({ latest: '0.9.18', next: '(无)' }, '0.9.18').ok, true)
})

// 预发布约定：*-* 的 tag 走 npm next 通道，不抢 GitHub Latest

test('预发布 tag（含 -）走 next 通道', () => {
  assert.match(releaseYml, /\*-\*\) TAG_ARG="--tag next"/, '预发布要带 --tag next')
  assert.match(releaseYml, /\*-\*\) FLAGS="--prerelease --latest=false"/, 'GitHub Release 要标 prerelease 且不抢 Latest')
})

test('发布后"latest 一致"的核对只对正式版生效', () => {
  assert.match(releaseYml, /if: success\(\) && !contains\(github\.ref_name, '-'\)/, '预发布不该被 latest 比对挡住')
})

test('registry 校验按版本查，不依赖 latest', () => {
  assert.match(releaseYml, /tools\/registry-has\.mjs "\$VER"/, '要按版本号查 registry')
})
