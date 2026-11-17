// 从 BoardUI 原样拉组件源码（不移植、不改一行），依赖递归补齐。
// 两个源，按顺序试：
//   ① registry —— https://www.boardui.com/r/<name>.json（官方 CLI `npx boardui add` 用的就是它，
//      **新组件只在这里**：meter / progress / spinner / drawer / modal … 公开仓库 main 里根本没有）
//   ② GitHub raw —— 老组件在那边更稳
// 教训（2026-11-17）：只看 GitHub main 的 components/base 就断言「BoardUI 没有进度条」，
// 结果官方站点上有 meter 和 progress 两个组件，白让 Radix Progress 躺了一轮。
//   node web/scripts/fetch-boardui.mjs components/base/select/select.tsx
// 已存在的文件不覆盖（除非 --force），写法与 web/src/components/base/** 现有的一致：
// 顶部一行出处注释 + 上游原文。
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'

const RAW = 'https://raw.githubusercontent.com/BoardUI/boardui/main/'
const force = process.argv.includes('--force')
const seeds = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
if (seeds.length === 0) { console.error('用法：node web/scripts/fetch-boardui.mjs <repo/path.tsx> [...]'); process.exit(2) }

const fetched = []
const skipped = []
const missing = []

const REGISTRY = 'https://www.boardui.com/r/'
const registryCache = new Map()

/** 组件名 → [{path, content}]。名字取文件所在目录（components/base/meter/meter.tsx → meter）。 */
async function registryItem(path) {
  const name = posix.basename(posix.dirname(path))
  if (registryCache.has(name)) return registryCache.get(name)
  let payload = null
  try {
    const res = await fetch(REGISTRY + name + '.json')
    if (res.status === 200) payload = await res.json()
  } catch { payload = null }
  const files = new Map()
  for (const file of payload?.files ?? []) if (file.path && typeof file.content === 'string') files.set(file.path, file.content)
  registryCache.set(name, files)
  return files
}

async function get(path) {
  const fromRegistry = await registryItem(path)
  if (fromRegistry.has(path)) return fromRegistry.get(path)
  const res = await fetch(RAW + path)
  if (res.status !== 200) return null
  return await res.text()
}

/** @/components/x/y → components/x/y；补扩展名 */
function resolveSpec(spec, fromPath) {
  if (spec.startsWith('@/')) return spec.slice(2)
  if (spec.startsWith('.')) return posix.normalize(posix.join(posix.dirname(fromPath), spec))
  return null
}

async function ensure(path) {
  const target = join('web/src', path)
  if (existsSync(target) && !force) { skipped.push(path); return readFileSync(target, 'utf8') }
  const body = await get(path)
  if (body === null) { missing.push(path); return null }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `// copied verbatim from BoardUI (MIT) — https://github.com/BoardUI/boardui/blob/main/${path}\n${body}`)
  fetched.push(path)
  return body
}

const loaded = new Map()
async function pull(path) {
  if (loaded.has(path)) return
  const body = await ensure(path)
  if (body === null) return
  loaded.set(path, body)
  const specs = [...body.matchAll(/from\s+"([^"]+)"/g)].map(m => m[1])
  for (const spec of specs) {
    const base = resolveSpec(spec, path)
    if (base === null) continue
    const candidates = /\.(tsx?|css)$/.test(base) ? [base] : [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`]
    let done = false
    for (const candidate of candidates) {
      const text = existsSync(join('web/src', candidate)) ? readFileSync(join('web/src', candidate), 'utf8') : await get(candidate)
      if (text !== null) { await pull(candidate); done = true; break }
    }
    if (!done) missing.push(`${base} (from ${path})`)
  }
}

for (const seed of seeds) await pull(seed)

console.log(`抓到 ${fetched.length} 个文件：`)
for (const path of fetched) console.log(`  + ${path}`)
if (skipped.length > 0) console.log(`已存在跳过 ${skipped.length} 个：${skipped.join(', ')}`)
if (missing.length > 0) { console.log(`找不到 ${missing.length} 个（可能要手工处理）：`); for (const item of missing) console.log(`  ! ${item}`) }
