#!/usr/bin/env node
/* 问 registry：latest 指向哪个版本。
 *
 *   node tools/registry-latest.mjs                      # 只打印
 *   node tools/registry-latest.mjs --expect 0.9.30      # 不一致就以 1 退出
 *   REGISTRY_WAIT_SECONDS=120 node tools/registry-latest.mjs --expect 0.9.30
 *
 * 替掉 `npm view @marsken/dsh-studio version`：
 *   npm view = 启一次 npm + 拉完整 packument（这个包 400 KB）；
 *   dist-tags 端点 = 20 字节。刚 publish 完边缘缓存会差几秒，所以带一个有限重试窗口。
 *
 * 退出码：0 一致（或只查询）；1 不一致；2 查询失败。
 */
import { readDistTags, pollUntil } from './lib/registry.mjs'

const PKG = '@marsken/dsh-studio'
const argv = process.argv.slice(2)
const expectIndex = argv.indexOf('--expect')
const expected = expectIndex >= 0 ? String(argv[expectIndex + 1] ?? '').trim().replace(/^v/, '') : ''
const waitSeconds = Math.max(0, Number(process.env.REGISTRY_WAIT_SECONDS ?? 60) || 0)

const { value, error } = await pollUntil(
  () => readDistTags(PKG),
  tags => expected === '' || String(tags?.latest ?? '') === expected,
  { waitMs: waitSeconds * 1000 },
)

// 不调 process.exit()：Windows 上边收 socket 边硬退会撞 UV_HANDLE_CLOSING 断言
if (value === undefined) {
  console.error(`查询失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 2
} else {
  const latest = String(value.latest ?? '')
  console.log(`latest=${latest || '(无)'}${value.next === undefined ? '' : ` next=${value.next}`}`)
  if (expected !== '' && latest !== expected) {
    console.error(`::error::registry latest=${latest} 与 package.json=${expected} 不一致`)
    process.exitCode = 1
  } else if (expected !== '') {
    console.log(`registry 已指向 ${expected}`)
  }
}
