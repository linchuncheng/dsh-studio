// 「声明被注释吞掉」的守卫。
//
// 2026-11-23 真机踩到：改一段注释时把 `/*` 留成未闭合，后面的 `const PANE` / `SECTION` … 十五条声明
// 全被吞进注释里。文件照样能被 `node --check` 解析（注释是合法的），单测也全绿——
// 因为只有真机上点到那个面板才会抛 `ReferenceError: PANE is not defined`。
//
// 判据很直接：把注释剥掉之后，代码里出现的顶层声明必须和原文件里的一致。
// 少了的那些，就是被注释吞掉的。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (/node_modules|dist|\.git/.test(full)) continue
      walk(full, out)
    } else if (/\.(js|jsx|tsx)$/.test(entry.name) && entry.name !== 'legacy.js') {
      out.push(full)
    }
  }
  return out
}

/** 去掉 // 行注释与 /* *\/ 块注释，字符串里的内容保持不动。 */
const stripComments = source => {
  let out = ''
  let index = 0
  let mode = 'code' // code | line | block | single | double | template
  while (index < source.length) {
    const ch = source[index]
    const next = source[index + 1]
    if (mode === 'code') {
      if (ch === '/' && next === '/') { mode = 'line'; index += 2; continue }
      if (ch === '/' && next === '*') { mode = 'block'; index += 2; continue }
      if (ch === "'") { mode = 'single'; out += ch; index += 1; continue }
      if (ch === '"') { mode = 'double'; out += ch; index += 1; continue }
      if (ch === '`') { mode = 'template'; out += ch; index += 1; continue }
      out += ch
      index += 1
      continue
    }
    if (mode === 'line') {
      if (ch === '\n') { mode = 'code'; out += ch }
      index += 1
      continue
    }
    if (mode === 'block') {
      if (ch === '*' && next === '/') { mode = 'code'; index += 2; continue }
      if (ch === '\n') out += ch // 保留行号
      index += 1
      continue
    }
    if (mode === 'single' || mode === 'double') {
      out += ch
      if (ch === '\\') { out += source[index + 1] ?? ''; index += 2; continue }
      if ((mode === 'single' && ch === "'") || (mode === 'double' && ch === '"')) mode = 'code'
      index += 1
      continue
    }
    // template
    out += ch
    if (ch === '\\') { out += source[index + 1] ?? ''; index += 2; continue }
    if (ch === '`') mode = 'code'
    index += 1
  }
  return out
}

const declarations = text => {
  const found = []
  text.split(/\r?\n/).forEach((line, index) => {
    const m = /^\s*(?:export\s+)?(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/.exec(line)
    if (m !== null) found.push(`${m[2]}@${index + 1}`)
  })
  return found
}

const files = [...walk(path.join(root, 'web/src')), path.join(root, 'client.src.js')].filter(p => fs.existsSync(p))

test('没有声明被注释吞掉（真机 PANE is not defined 那一类）', () => {
  const failures = []
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    const raw = declarations(source)
    const stripped = new Set(declarations(stripComments(source)).map(entry => entry.split('@')[0]))
    for (const entry of raw) {
      const [name] = entry.split('@')
      if (!stripped.has(name)) failures.push(`${path.relative(root, file)} 里的 ${entry} 落在注释里`)
    }
  }
  assert.deepEqual(failures, [], '有声明被注释吞掉：运行到那一屏才会 ReferenceError')
})

test('注释剥离器本身可信：剥完注释不会吃掉代码', () => {
  const sample = '/* a\nb */\nconst A = 1\n// c\nconst B = "x/*y*/"\n'
  const out = stripComments(sample)
  assert.match(out, /const A = 1/)
  assert.match(out, /const B = "x\/\*y\*\/"/, '字符串里的注释符号不能被当注释')
  assert.equal(/const B/.test(stripComments('/* const B = 2 */\n')), false)
})
