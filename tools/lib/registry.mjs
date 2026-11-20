// registry 的三个小查询。抽出来是因为「问一个版本在不在 / latest 是谁」被三处用到：
// release.yml 的发布后核对、tools/registry-has.mjs、tools/verify-release.mjs。
//
// 为什么不走 `npm view`：它要启一次 npm，并且拉**完整 packument**（这个包 0.9.x 时已经 400 KB）。
// 而 dist-tags 端点只回几十字节、单版本端点只回 200/404 —— 同样是权威答案，快两个数量级。
// 也不读 npm 的本地/边缘缓存：刚 publish 完用缓存会持续 404，0.2.5 就因此误判过。

const REGISTRY = 'https://registry.npmjs.org'

/** 包名 → 路径编码（scoped 包的 `/` 要编码成 %2F）。 */
export const packageSlug = name => encodeURIComponent(String(name))

/** dist-tags：几十字节。返回 { latest, next, ... }。 */
export async function readDistTags(name, { timeoutMs = 15000 } = {}) {
  const res = await fetch(`${REGISTRY}/-/package/${packageSlug(name)}/dist-tags`, {
    headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`dist-tags 返回 HTTP ${res.status}`)
  return await res.json()
}

/** 这个版本在不在：只回 200 / 404，不下载任何正文。 */
export async function versionExists(name, version, { timeoutMs = 15000 } = {}) {
  const res = await fetch(`${REGISTRY}/${packageSlug(name)}/${encodeURIComponent(version)}`, {
    headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
    method: 'GET',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 200) return true
  if (res.status === 404) return false
  throw new Error(`版本端点返回 HTTP ${res.status}`)
}

/** 轮询直到 predicate 为真或超时；返回最后一次的值（不抛超时）。 */
export async function pollUntil(read, predicate, { waitMs = 60_000, intervalMs = 3000 } = {}) {
  const deadline = Date.now() + Math.max(0, waitMs)
  let value
  let lastError = null
  for (;;) {
    try { value = await read(); lastError = null } catch (error) { lastError = error }
    if (lastError === null && predicate(value) === true) return { value, error: null }
    if (Date.now() >= deadline) return { value, error: lastError }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}
