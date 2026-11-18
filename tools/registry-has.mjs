#!/usr/bin/env node
/* 问 registry：这个版本在不在。退出码 0 = 在，1 = 不在。
 *
 *   node tools/registry-has.mjs 0.2.5
 *
 * 为什么不用 `npm view`：它走本地/边缘缓存，刚发布的版本可能持续返回 E404，
 * 于是 CI 的「确认版本进了 registry」在发布成功后仍然报红（0.2.5 就是这么误判的）。
 * 这里直接读 registry 的 packument（带 no-cache 头），才是权威答案。
 */
const version = String(process.argv[2] ?? '').trim()
if (version === '') {
  console.error('用法：node tools/registry-has.mjs <version>')
  process.exit(2)
}

const url = 'https://registry.npmjs.org/@marsken%2Fdsh-studio'
try {
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache', pragma: 'no-cache' } })
  if (res.status !== 200) {
    console.error(`registry 返回 ${res.status}`)
    process.exit(1)
  }
  const packument = await res.json()
  const versions = Object.keys(packument.versions ?? {})
  const latest = packument['dist-tags']?.latest ?? ''
  if (versions.includes(version)) {
    console.log(`yes ${version}${latest === version ? ' (latest)' : ''}`)
    process.exit(0)
  }
  console.log(`no ${version}（registry 上最新是 ${latest}，共 ${versions.length} 个版本）`)
  process.exit(1)
} catch (error) {
  console.error(`查询失败：${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
