#!/usr/bin/env node
/**
 * 打包后自检（P0）：验的是**要发出去的那个 tarball**，不是源码树。
 *
 *   node tools/pack-check.mjs            # 打包 → 解包 → 断言 → 清理
 *   node tools/pack-check.mjs --keep     # 留下解包目录，方便手工看
 *
 * 为什么要有：0.5.1 那次「装完不加载」的根因（cordis.patch.yml 里写裸名）在源码树上看不出来，
 * 所有校验都在源码上做，而用户加载的是 tarball 里那份。三条断言：
 *   1. patch 在包里，且 name === 包名（含 scope）
 *   2. exports['.'] / exports['./client'] / dsh.bundle.patch / dsh.client 指向的文件都在包里
 *   3. index.js 能被 node 真的 import 起来（不是只看语法）
 */
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const keep = process.argv.includes('--keep')
const root = resolve('.')
const work = mkdtempSync(join(tmpdir(), 'dsh-studio-pack-'))
const problems = []
const notes = []

const run = (cmd, args, options = {}) => execFileSync(cmd, args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  // Windows 上 npm 是 .cmd 垫片，不加 shell 会 ENOENT
  shell: process.platform === 'win32',
  ...options,
})

try {
  // 1) 打包
  let tgz
  try {
    const out = run('npm', ['pack', '--silent', '--pack-destination', work], { cwd: root })
    tgz = join(work, out.trim().split('\n').pop())
  } catch (error) {
    console.error('npm pack 失败：', String(error?.stderr ?? error?.message ?? error).slice(0, 300))
    process.exit(2)
  }
  if (!existsSync(tgz)) {
    console.error('npm pack 没有产出 tarball')
    process.exit(2)
  }
  notes.push(`tarball ${(statSync(tgz).size / 1024 / 1024).toFixed(2)} MB`)

  // 2) 解包
  const dir = join(work, 'unpacked')
  try {
    run('tar', ['-xzf', tgz, '-C', work])
  } catch (error) {
    console.error('解包失败（需要 tar）：', String(error?.message ?? error).slice(0, 200))
    process.exit(2)
  }
  cpSync(join(work, 'package'), dir, { recursive: true })

  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  notes.push(`包名 ${pkg.name}@${pkg.version}`)

  // 3a) bundle patch 在包里，且 name 等于包名
  const patchPath = join(dir, String(pkg.dsh?.bundle?.patch ?? 'cordis.patch.yml').replace(/^\.\//, ''))
  if (!existsSync(patchPath)) {
    problems.push(`包里没有 bundle patch：${pkg.dsh?.bundle?.patch}`)
  } else {
    const patch = readFileSync(patchPath, 'utf8')
    const names = [...patch.matchAll(/^\s+name:\s*"?([^"\n]+)"?\s*$/gm)].map(match => match[1].trim())
    if (names.length === 0) problems.push('cordis.patch.yml 里没有 name 行（加载器无从解析）')
    for (const name of names) {
      if (name !== pkg.name) problems.push(`patch 里的 name（${name}）≠ 包名（${pkg.name}）：装完会 ERR_MODULE_NOT_FOUND`)
    }
    notes.push(`patch 挂载名 ${names.join(', ') || '(无)'}`)
  }

  // 3b) exports / dsh 指向的文件都在包里
  const targets = []
  /* 只认路径（./ 开头）。dsh.client 里还有 platform: 'web'、inject: ['@deepseek-ai/...']
     这类**不是文件**的字段，早先版本把它们当成路径去 existsSync，报了三个假失败。 */
  const collectPaths = value => {
    if (typeof value === 'string') {
      if (value.startsWith('./') || value.startsWith('/')) targets.push(value)
      return
    }
    if (value !== null && typeof value === 'object') for (const item of Object.values(value)) collectPaths(item)
  }
  collectPaths(pkg.exports ?? {})
  if (typeof pkg.main === 'string') targets.push(pkg.main)
  if (typeof pkg.dsh?.bundle?.patch === 'string') targets.push(pkg.dsh.bundle.patch)

  const expand = target => {
    const rel = String(target).replace(/^\.\//, '')
    if (!rel.includes('*')) return [rel]
    // 通配（如 locale/*.json）：至少要匹配到一个真实文件
    const star = rel.indexOf('*')
    const slash = rel.lastIndexOf('/', star)
    const base = slash >= 0 ? rel.slice(0, slash) : '.'
    const suffix = rel.slice(star + 1)
    if (!existsSync(join(dir, base))) return []
    return readdirSync(join(dir, base)).filter(name => name.endsWith(suffix)).map(name => join(base, name))
  }

  let checked = 0
  for (const target of [...new Set(targets)]) {
    const matches = expand(target)
    if (matches.length === 0) problems.push(`package.json 指向的文件不在包里：${target}`)
    else checked += matches.length
  }
  notes.push(`清单里的 ${new Set(targets).size} 个路径都已随包发布（展开后 ${checked} 个文件）`)

  // 3c) 宿主半边能被真的 import 起来（语法 + 顶层副作用）
  const entry = String(pkg.main ?? 'index.js').replace(/^\.\//, '')
  if (existsSync(join(dir, entry))) {
    // 写成临时脚本再执行：Windows 上 shell + -e 的多行代码会被引号吞掉
    const probe = join(work, 'import-probe.mjs')
    fs.writeFileSync(probe, [
      `const m = await import(${JSON.stringify(pathToFileURL(join(dir, entry)).href)})`,
      "const apply = m.apply ?? m.default?.apply",
      "if (typeof apply !== 'function') throw new Error('没有导出 apply')",
      "console.log('ok')",
    ].join('\n'))
    try {
      run(process.execPath, [probe], { cwd: dir, shell: false })
      notes.push(`${entry} 可被 import，且导出了 apply`)
    } catch (error) {
      const detail = String(error?.stderr ?? error?.message ?? error).split('\n').filter(Boolean).slice(0, 6).join(' | ')
      problems.push(`import ${entry} 失败：${detail.slice(0, 240)}`)
    }
  }

  // 3d) 客户端产物：两个副本必须一模一样（否则用户装的和你验的不是同一份）
  const clientA = join(dir, 'client.js')
  const clientB = join(dir, 'dist/client.js')
  if (existsSync(clientA) && existsSync(clientB)) {
    const a = readFileSync(clientA)
    const b = readFileSync(clientB)
    if (a.length !== b.length || !a.equals(b)) problems.push('client.js 与 dist/client.js 内容不一致')
    else notes.push(`client.js = dist/client.js（${(a.length / 1024 / 1024).toFixed(2)} MB）`)
  }
} finally {
  if (keep) console.log('保留解包目录：', work)
  else rmSync(work, { recursive: true, force: true })
}

for (const note of notes) console.log('ok   ' + note)
for (const problem of problems) console.log('FAIL ' + problem)
console.log(problems.length === 0 ? '\n打包后自检通过：tarball 里的东西能被 dsh 加载' : `\n打包后自检不通过（${problems.length} 项）`)
process.exit(problems.length === 0 ? 0 : 1)
