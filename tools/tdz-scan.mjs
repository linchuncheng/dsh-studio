#!/usr/bin/env node
/**
 * 作用域级「先用后声明」扫描（TDZ）：issue #6 在 macOS 桌面版上报
 * `Cannot access 're' before initialization`，而 node --check / 契约测试都看不见。
 *
 * 做法：把每个文件切成作用域（按花括号深度），在**同一作用域**里找
 * 「名字被使用的位置早于它 const/let 声明的位置」。嵌套函数是独立作用域，不会误报。
 *
 *   node tools/tdz-scan.mjs [目录或文件...]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const roots = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['web/src']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git'])
const files = []
const walk = path => {
  const info = statSync(path)
  if (info.isFile()) {
    if (/\.(js|jsx|mjs)$/.test(path)) files.push(path)
    return
  }
  for (const name of readdirSync(path)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
    walk(join(path, name))
  }
}
for (const root of roots) walk(root)

/** 去掉注释与字符串，保留长度（索引仍对应原文位置）。 */
function strip(source) {
  let out = ''
  let mode = 'code'
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]
    if (mode === 'code') {
      if (char === '/' && next === '/') { mode = 'line'; out += '  '; index += 1; continue }
      if (char === '/' && next === '*') { mode = 'block'; out += '  '; index += 1; continue }
      if (char === '"' || char === "'") { mode = char; out += ' '; continue }
      if (char === '`') { mode = 'template'; out += ' '; continue }
      out += char
      continue
    }
    if (mode === 'line') { out += char === '\n' ? '\n' : ' '; if (char === '\n') mode = 'code'; continue }
    if (mode === 'block') { if (char === '*' && next === '/') { mode = 'code'; out += '  '; index += 1; continue } out += char === '\n' ? '\n' : ' '; continue }
    if (mode === 'template') { if (char === '`' && source[index - 1] !== '\\') mode = 'code'; out += char === '\n' ? '\n' : ' '; continue }
    if (mode === '"' || mode === "'") { if (char === mode && source[index - 1] !== '\\') mode = 'code'; out += char === '\n' ? '\n' : ' ' }
  }
  return out
}

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new', 'function', 'await', 'yield', 'in', 'of', 'case', 'do', 'else', 'throw'])

function scanFile(file) {
  const raw = readFileSync(file, 'utf8')
  const text = strip(raw)
  const lineOf = position => text.slice(0, position).split('\n').length

  // 1) 花括号作用域：记录每段代码所属的 scope id
  const scopeAt = new Int32Array(text.length + 1)
  const scopeStart = []
  let depth = 0
  let scopeCounter = 0
  const stack = [0]
  scopeStart.push(0)
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    scopeAt[index] = stack[stack.length - 1]
    if (char === '{') {
      depth += 1
      scopeCounter += 1
      stack.push(scopeCounter)
      scopeStart.push(index)
    } else if (char === '}') {
      if (stack.length > 1) stack.pop()
    }
  }
  scopeAt[text.length] = stack[stack.length - 1]

  // 2) 每个作用域里的 const/let 声明位置
  const declarationAt = new Map() // scope -> Map(name -> position)
  for (const match of text.matchAll(/(?:^|[;{}(\n])\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/g)) {
    const name = match[1]
    let position = match.index + match[0].indexOf(name)
    // for (let i = 0 …) / while：声明属于循环头，把位置前移到 for 关键字，避免把循环体里的 i 误报
    const before = text.slice(Math.max(0, match.index - 24), match.index + match[0].indexOf(name))
    if (/(?:for|if|while)\s*\($/.test(before.trimEnd())) position = match.index
    const scope = scopeAt[position]
    if (!declarationAt.has(scope)) declarationAt.set(scope, new Map())
    const bucket = declarationAt.get(scope)
    if (!bucket.has(name)) bucket.set(name, position)
  }

  // 3) 每个作用域里名字的第一次「被读取」位置
  const findings = []
  for (const match of text.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)(?![\w$])/g)) {
    const name = match[1]
    if (KEYWORDS.has(name)) continue
    const position = match.index
    const scope = scopeAt[position]
    const bucket = declarationAt.get(scope)
    if (bucket === undefined || !bucket.has(name)) continue
    const declaredAt = bucket.get(name)
    if (position >= declaredAt) continue
    // 声明语句本身（const name = ...）不算使用
    const before = text.slice(Math.max(0, position - 24), position)
    // 跳过声明语句本身：const name / let name / for (let name …)
    if (/(?:const|let)\s+$/.test(before) || /for\s*\(\s*(?:const|let)\s+$/.test(before)) continue
    // 属性访问 / 对象键不算
    const after = text.slice(position + name.length, position + name.length + 2)
    if (after.startsWith(':') && /[{,]\s*$/.test(text.slice(Math.max(0, position - 40), position))) continue
    findings.push({ name, line: lineOf(position), declaredLine: lineOf(declaredAt), scope })
  }

  // 同一名字同一作用域只报一次最早的那条
  const seen = new Set()
  return findings.filter(item => {
    const key = `${item.scope}:${item.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

let total = 0
for (const file of files) {
  for (const finding of scanFile(file)) {
    total += 1
    console.log(`${relative(process.cwd(), file)}:${finding.line}  ${finding.name} 在声明（第 ${finding.declaredLine} 行）之前就被用了`)
  }
}
console.log(total === 0 ? `TDZ 扫描通过（${files.length} 个文件，按作用域）` : `TDZ 扫描发现 ${total} 处“同作用域内先用后声明”`)
process.exit(total === 0 ? 0 : 1)
