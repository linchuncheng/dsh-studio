#!/usr/bin/env node
/* 找出「已经没有引用的 .ds-* 规则」并**整条**删掉（含递归 @media）。
 *
 * 迁移到 BoardUI 的纪律是「迁一块删一块」，但手工找漏网容易删错（可能在别处还用着）。
 * 这个脚本把判定做成可复查的：先只报告，`--apply` 才落盘。
 *
 * 判定口径：
 *   - 引用面 = client.src.js（**去掉内嵌的 CSS 段**）+ web/src/**（排除 legacy.js 与 index.css）+ tools/**
 *   - 定义面 = client.src.js 的内嵌 CSS 段 + web/src/index.css
 *   - 选择器里只要有一个 .ds-* 已经没有引用，这个选择器分支就永远不会匹配 → 删掉该分支；
 *     一条规则的分支全没了 → 整条规则删；@media/@supports 里的子规则删空 → 外层 at-rule 一起删。
 *
 * 为什么按「规则块」而不是按行删：一行可能是多行规则的**第一行**（声明续在下一行），
 * 一行也可能挂着多个选择器。按行切会把 `border-bottom:… }` 这种续行留在原地，直接写出坏 CSS。
 *
 * 用法：
 *   node tools/ui/prune-ds-css.mjs            # 只报告（默认）
 *   node tools/ui/prune-ds-css.mjs --apply    # 落盘
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const apply = process.argv.includes('--apply')
const root = process.cwd()
const clientPath = join(root, 'client.src.js')
const cssPath = join(root, 'web/src/index.css')

/* 永远不自动删：Markdown 排版作用域、以及 tests/overlay-titlebar.test.mjs 断言「规则必须存在」的那几条。
   覆盖层迁到 BoardUI 后这些类可能已无消费者，但删了会让测试红；要删得先改测试判据。 */
const NEVER_DELETE = new Set([
  'ds-md', 'ds-md-field', 'ds-md-bar', 'ds-md-preview',
  'ds-drawer', 'ds-drawer-wrap', 'ds-modal-wrap', 'ds-side-wrap', 'ds-side-mask', 'ds-side', 'ds-palette-veil',
])

/* ------------------------------------------------------------------ 1. 引用面 --- */

const walk = dir => {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (/node_modules|dist|\.git/.test(p)) continue
      out.push(...walk(p))
    } else if (/\.(js|jsx|tsx|mjs)$/.test(entry.name)) out.push(p)
  }
  return out
}

/** 只认**字符串字面量里**的类名：注释里提到「以前用 .ds-xxx」不算消费者，
 *  否则文档性注释会把早就没人用的规则永远钉在原地。扫描器会跳过注释与正则字面量，
 *  免得 `'http://…'` 里的 `//` 或正则里的引号把后面的类名一起吞掉。 */
const REGEX_PREV = new Set(['', '(', '[', '{', ',', ';', ':', '=', '!', '&', '|', '?', '+', '-', '*', '%', '<', '>', '^', '~'])
const REGEX_WORD = /(?:^|[^\w$])(return|typeof|case|in|of|new|delete|void|instanceof|do|else)$/

const stringLiterals = (source, collected) => {
  let index = 0
  let prev = ''
  let prevWord = ''
  while (index < source.length) {
    const ch = source[index]
    if (ch === '/' && source[index + 1] === '/') {
      const nl = source.indexOf('\n', index)
      index = nl < 0 ? source.length : nl
      continue
    }
    if (ch === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2)
      index = close < 0 ? source.length : close + 2
      continue
    }
    if (ch === '/' && (REGEX_PREV.has(prev) || REGEX_WORD.test(prevWord))) {
      let j = index + 1
      let inClass = false
      while (j < source.length) {
        const c = source[j]
        if (c === '\\') { j += 2; continue }
        if (c === '[') inClass = true
        else if (c === ']') inClass = false
        else if (c === '/' && inClass === false) { j += 1; break }
        else if (c === '\n') break
        j += 1
      }
      index = j
      prev = '/'
      prevWord = ''
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = index + 1
      while (j < source.length) {
        if (source[j] === '\\') { j += 2; continue }
        if (source[j] === ch) break
        j += 1
      }
      collected.push(source.slice(index + 1, j))
      index = j + 1
      prev = ch
      prevWord = ''
      continue
    }
    if (/\s/.test(ch)) { index += 1; continue }
    prev = ch
    if (/[\w$]/.test(ch)) prevWord = (prevWord + ch).slice(-12)
    else prevWord = ''
    index += 1
  }
  return collected
}

/* client.src.js 的内嵌 CSS 段；引用面要把它剔掉，否则「定义」会被当成「引用」。
   段里没有反引号也没有 ${}（assert 下面两行兜住）。 */
const clientText = readFileSync(clientPath, 'utf8')
const cssMarker = 'const CSS = `'
const cssMarkerAt = clientText.indexOf(cssMarker)
if (cssMarkerAt < 0) throw new Error('client.src.js 里找不到 `const CSS = \\`` 段')
const clientCssStart = cssMarkerAt + cssMarker.length
const clientCssEnd = clientText.indexOf('`', clientCssStart)
if (clientCssEnd < 0) throw new Error('client.src.js 的内嵌 CSS 段没有闭合反引号')
const clientCss = clientText.slice(clientCssStart, clientCssEnd)

const stripClientCss = text => text.slice(0, clientCssStart) + text.slice(clientCssEnd)

const referenceCount = new Map()
const toolPath = join(root, 'tools/ui/prune-ds-css.mjs')
const sourceFiles = [
  ...walk(join(root, 'web/src')).filter(p => p !== cssPath),
  ...walk(join(root, 'tools')),
  clientPath,
].filter(p => !/legacy\.js$|dist\/|tmp\//.test(p) && p !== toolPath)

for (const file of sourceFiles) {
  const raw = file === clientPath ? stripClientCss(clientText) : readFileSync(file, 'utf8')
  for (const content of stringLiterals(raw, [])) {
    for (const m of content.matchAll(/(?<![\w-])ds-[a-z0-9][a-z0-9-]*/g)) {
      referenceCount.set(m[0], (referenceCount.get(m[0]) ?? 0) + 1)
    }
  }
}

const isDead = name => !NEVER_DELETE.has(name) && (referenceCount.get(name) ?? 0) === 0

/* ------------------------------------------------------------ 2. 规则块扫描 --- */

const skipString = (text, i, end) => {
  const quote = text[i]
  let j = i + 1
  while (j < end) {
    if (text[j] === '\\') { j += 2; continue }
    if (text[j] === quote) return j + 1
    j += 1
  }
  return end
}

const skipComment = (text, i, end) => {
  const close = text.indexOf('*/', i + 2)
  return close < 0 || close + 2 > end ? end : close + 2
}

/** 扫 from..to 之间的直接子节点（不进入 at-rule 内部，交给 pruneRange 递归）。 */
const scanNodes = (text, from, to) => {
  const nodes = []
  let i = from
  while (i < to) {
    const ch = text[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i += 1; continue }
    if (ch === '/' && text[i + 1] === '*') { i = skipComment(text, i, to); continue }
    if (ch === '}') { i += 1; continue }
    const start = i
    let j = i
    while (j < to) {
      const c = text[j]
      if (c === '"' || c === "'") { j = skipString(text, j, to); continue }
      if (c === '/' && text[j + 1] === '*') { j = skipComment(text, j, to); continue }
      if (c === '(') {
        let depth = 0
        while (j < to) {
          if (text[j] === '(') depth += 1
          else if (text[j] === ')') { depth -= 1; if (depth === 0) { j += 1; break } }
          j += 1
        }
        continue
      }
      if (c === '{' || c === ';' || c === '}') break
      j += 1
    }
    if (j >= to) break
    if (text[j] === ';') { i = j + 1; continue }
    if (text[j] === '}') { i = j + 1; continue }
    const selector = text.slice(start, j).trim()
    const bodyStart = j + 1
    let k = bodyStart
    let level = 1
    while (k < to && level > 0) {
      const c = text[k]
      if (c === '"' || c === "'") { k = skipString(text, k, to); continue }
      if (c === '/' && text[k + 1] === '*') { k = skipComment(text, k, to); continue }
      if (c === '{') level += 1
      else if (c === '}') { level -= 1; if (level === 0) break }
      k += 1
    }
    const bodyEnd = k
    const atRule = selector.startsWith('@')
    const nested = atRule && /^@(media|supports|layer|container|scope)\b/.test(selector)
    nodes.push({ start, selectorStart: start, selectorEnd: j, selector, bodyStart, bodyEnd, end: k + 1, atRule, nested })
    i = k + 1
  }
  return nodes
}

/** 按顶层逗号切选择器（括号与字符串里的逗号不算）。 */
const splitSelector = text => {
  const parts = []
  let depth = 0
  let last = 0
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (c === '"' || c === "'") { i = skipString(text, i, text.length) - 1; continue }
    if (c === '/' && text[i + 1] === '*') { i = skipComment(text, i, text.length) - 1; continue }
    if (c === '(' || c === '[') depth += 1
    else if (c === ')' || c === ']') depth -= 1
    else if (c === ',' && depth === 0) { parts.push(text.slice(last, i)); last = i + 1 }
  }
  parts.push(text.slice(last))
  return parts.map(part => part.trim()).filter(part => part !== '')
}

const dsNamesOf = part => [...part.matchAll(/\.(ds-[a-z0-9-]+)/g)].map(m => m[1])

/** 一个选择器分支只要带了一个「已无引用」的类，它就永远匹配不到 → 分支可以删。 */
const partIsDead = part => {
  const names = dsNamesOf(part)
  return names.length > 0 && names.some(isDead)
}

/** 删一条规则时把所在行一起吃掉，免得留一堆空行。偏移量都是 out 自己的坐标系。 */
const deletionRange = (out, start, end) => {
  let from = start
  let probe = from
  while (probe > 0 && (out[probe - 1] === ' ' || out[probe - 1] === '\t')) probe -= 1
  if (probe > 0 && out[probe - 1] === '\n') from = probe
  let to = end
  while (to < out.length && (out[to] === ' ' || out[to] === '\t' || out[to] === '\r')) to += 1
  if (out[to] === '\n') to += 1
  return { start: from, end: to }
}

const report = []

/* 返回 text.slice(from, to) 的裁剪结果（返回的是**片段**，不是整份文本：
   递归处理完子规则后外层 at-rule 的 bodyEnd 会因为长度变化而失效，用片段就没这个问题）。 */
const pruneRange = (text, from, to) => {
  const nodes = scanNodes(text, from, to)
  let out = text.slice(from, to)
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (node.nested) {
      const inner = pruneRange(text, node.bodyStart, node.bodyEnd)
      const bodyAt = node.bodyStart - from
      // 用子片段替换 body，再按新长度找闭合花括号
      out = out.slice(0, bodyAt) + inner + out.slice(node.bodyEnd - from)
      const bare = inner.replace(/\/\*[\s\S]*?\*\//g, '').trim()
      if (bare === '') {
        const currentEnd = bodyAt + inner.length + 1 // inner 之后紧跟闭合的 '}'
        const range = deletionRange(out, node.start - from, currentEnd)
        report.push({ kind: 'at-rule', label: node.selector.replace(/\s+/g, ' ').slice(0, 48) })
        out = out.slice(0, range.start) + out.slice(range.end)
      }
      continue
    }
    if (node.atRule) continue // @keyframes / @font-face / @import 之类整块保留
    const parts = splitSelector(node.selector)
    const kept = parts.filter(part => !partIsDead(part))
    if (kept.length === parts.length) continue
    if (kept.length === 0) {
      const range = deletionRange(out, node.start - from, node.end - from)
      report.push({ kind: 'rule', label: node.selector.replace(/\s+/g, ' ').slice(0, 72) })
      out = out.slice(0, range.start) + out.slice(range.end)
      continue
    }
    report.push({ kind: 'branch', label: parts.filter(partIsDead).join(', ').replace(/\s+/g, ' ').slice(0, 72) })
    out = out.slice(0, node.selectorStart - from) + kept.join(',\n') + out.slice(node.selectorEnd - from)
  }
  return out
}

/* ------------------------------------------------------------------ 3. 执行 --- */

const beforeClient = clientCss.length
const nextCss = pruneRange(clientCss, 0, clientCss.length)
const nextClient = clientText.slice(0, clientCssStart) + nextCss + clientText.slice(clientCssEnd)

const cssText = readFileSync(cssPath, 'utf8')
const cssReportStart = report.length
const nextIndex = pruneRange(cssText, 0, cssText.length)

const clientReport = report.slice(0, cssReportStart)
const indexReport = report.slice(cssReportStart)

const show = (title, entries) => {
  console.log(`\n${title}：${entries.length} 处`)
  for (const entry of entries) console.log(`  [${entry.kind}] ${entry.label}`)
}
console.log(`引用面 ${sourceFiles.length} 个文件（已剔除内嵌 CSS 段与 index.css）`)
show('client.src.js', clientReport)
show('web/src/index.css', indexReport)

if (apply) {
  writeFileSync(clientPath, nextClient)
  writeFileSync(cssPath, nextIndex)
  const saved = (beforeClient - nextCss.length) + (cssText.length - nextIndex.length)
  console.log(`\n已落盘：规则 ${report.filter(entry => entry.kind !== 'branch').length} 块、`
    + `选择器分支 ${report.filter(entry => entry.kind === 'branch').length} 个、共 ${saved} 字节`)
} else {
  console.log('\n（只报告；加 --apply 才会落盘）')
}
