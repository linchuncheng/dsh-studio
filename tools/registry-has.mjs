#!/usr/bin/env node
/* 问 registry：这个版本在不在。退出码 0 = 在，1 = 不在，2 = 查询失败。
 *
 *   node tools/registry-has.mjs 0.9.30
 *
 * 为什么不用 `npm view`：它走本地/边缘缓存，刚发布的版本可能持续返回 E404，
 * 于是 CI 的「确认版本进了 registry」在发布成功后仍然报红（0.2.5 就是这么误判的）。
 * 也不学早期版本去拉完整 packument（400 KB）：单版本端点只回 200/404，够用且快得多。
 *
 * 注意：不调 process.exit()。Node 在 Windows 上边收 socket 边硬退会撞
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`，改成设 exitCode 让它自然收尾。
 */
import { readDistTags, versionExists } from './lib/registry.mjs'

const PKG = '@marsken/dsh-studio'
const version = String(process.argv[2] ?? '').trim()

const main = async () => {
  if (version === '') {
    console.error('用法：node tools/registry-has.mjs <version>')
    return 2
  }
  try {
    if (await versionExists(PKG, version)) {
      // 顺带说一句它是不是 latest（也就 20 字节，失败不影响结论）
      const tags = await readDistTags(PKG).catch(() => ({}))
      console.log(`yes ${version}${tags?.latest === version ? ' (latest)' : ''}`)
      return 0
    }
    const tags = await readDistTags(PKG).catch(() => ({}))
    console.log(`no ${version}（registry 上 latest 是 ${tags?.latest ?? '?'}）`)
    return 1
  } catch (error) {
    console.error(`查询失败：${error instanceof Error ? error.message : String(error)}`)
    return 2
  }
}

process.exitCode = await main()
