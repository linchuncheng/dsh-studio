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
