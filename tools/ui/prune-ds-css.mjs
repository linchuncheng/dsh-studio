#!/usr/bin/env node
/* 找出「已经没有引用的 .ds-* 规则」并从两份样式里删掉。
 *
 * 迁移到 BoardUI 的纪律是「迁一块删一块」，但手工找漏网容易删错（可能在别处还用着）。
 * 这个脚本把判定做成可复查的：先只报告，`--apply` 才落盘。
 *
 * 判定口径：
 *   - 引用面 = client.src.js + web/src/**（排除 legacy.js / dist 等生成物）
 *   - 定义面 = client.src.js 里的单行规则 + web/src/index.css 里的 [data-dsh-studio] 块
 *   - 一个类在引用面里只剩「定义那一行」自己 → 视为无引用
 *   - 动态拼类名（`ds-${…}`）时保守跳过：脚本会把这些前缀列出来，交给人确认
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const apply = process.argv.includes('--apply')
const root = process.cwd()

const walk = dir => {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (/node_modules|dist|\.git/.test(p)) continue
      out.push(...walk(p))
    } else if (/\.(js|jsx|tsx|mjs|md|css)$/.test(entry.name)) out.push(p)
  }
  return out
}

const sourceFiles = [...walk(join(root, 'web/src')), join(root, 'client.src.js'), ...walk(join(root, 'tools'))]
  .filter(p => !/legacy\.js$|dist\/|tmp\//.test(p))

/* 引用面：任何地方出现的 ds-xxx（含 className 字符串、模板、探针选择器） */
const referenceCount = new Map()
const dynamicPrefixes = new Set()
for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/ds-[a-z0-9][a-z0-9-]*/g)) {
    referenceCount.set(m[0], (referenceCount.get(m[0]) ?? 0) + 1)
  }
  for (const m of text.matchAll(/ds-(?:[a-z0-9-]*?)\$\{/g)) dynamicPrefixes.add(m[0])
}

/* 定义面 1：client.src.js 的单行规则（CSS 段里以 .ds- 开头） */
const clientPath = join(root, 'client.src.js')
const clientLines = readFileSync(clientPath, 'utf8').split(/\r?\n/)
const clientDefs = []
clientLines.forEach((line, index) => {
  if (!/^\s*[.\[]/.test(line) || !line.includes('{')) return
  const head = line.slice(0, line.indexOf('{'))
  for (const m of head.matchAll(/\.(ds-[a-z0-9-]+)/g)) clientDefs.push({ index, name: m[1], line })
})

/* 定义面 2：index.css 里 [data-dsh-studio] 选择器块 */
const cssPath = join(root, 'web/src/index.css')
const cssText = readFileSync(cssPath, 'utf8')
const cssBlocks = []
{
  const re = /\[data-dsh-studio\][^{}]*\{[^{}]*\}/g
  let m
  while ((m = re.exec(cssText)) !== null) {
    const names = [...m[0].matchAll(/\.(ds-[a-z0-9-]+)/g)].map(x => x[1])
    if (names.length > 0) cssBlocks.push({ text: m[0], names })
  }
}

/* 永远不自动删：Markdown 排版作用域、以及 tests/overlay-titlebar.test.mjs 断言「规则必须存在」的那几条。
   覆盖层迁到 BoardUI 后这些类可能已无消费者，但删了会让测试红；要删得先改测试判据。 */
const NEVER_DELETE = new Set([
  'ds-md', 'ds-md-field', 'ds-md-bar', 'ds-md-preview',
  'ds-drawer', 'ds-drawer-wrap', 'ds-modal-wrap', 'ds-side-wrap', 'ds-side-mask', 'ds-side', 'ds-palette-veil',
])

const countReferences = name => {
  const total = referenceCount.get(name) ?? 0
  const definedInClient = clientDefs.filter(d => d.name === name).length
  const definedInCss = cssBlocks.filter(b => b.names.includes(name)).length
  return total - definedInClient - definedInCss
}

const deadInClient = clientDefs.filter(d => !NEVER_DELETE.has(d.name) && countReferences(d.name) <= 0)
const deadCssBlocks = cssBlocks.filter(b => b.names.every(n => !NEVER_DELETE.has(n) && countReferences(n) <= 0))

console.log(`引用面 ${sourceFiles.length} 个文件；动态拼类名前缀 ${dynamicPrefixes.size} 个`)
if (dynamicPrefixes.size > 0) console.log('  需人工确认（动态）：', [...dynamicPrefixes].join(' '))
console.log(`\nclient.src.js 无引用规则 ${deadInClient.length} 条：`)
for (const d of deadInClient) console.log(`  L${d.index + 1}  .${d.name}`)
console.log(`\nindex.css 无引用块 ${deadCssBlocks.length} 块：`)
for (const b of deadCssBlocks) console.log(`  .${b.names.join(' .')}`)

if (apply) {
  const dropIndexes = new Set(deadInClient.map(d => d.index))
  const kept = clientLines.filter((_, i) => !dropIndexes.has(i))
  writeFileSync(clientPath, kept.join('\n'))
  let next = cssText
  for (const block of deadCssBlocks) {
    next = next.replace(block.text, '')
  }
  writeFileSync(cssPath, next)
  console.log(`\n已删除：client.src.js ${deadInClient.length} 行、index.css ${deadCssBlocks.length} 块`)
} else {
  console.log('\n（只报告；加 --apply 才会落盘）')
}
