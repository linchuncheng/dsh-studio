#!/usr/bin/env node
/* 发版前自检：文档有没有跟上代码。
 *
 *   node tools/release-check.mjs          # 本地跑
 *   npm run release:check
 *
 * 检查两件事：
 *   A. **一致性**：CHANGELOG 有没有当前版本的条目、docs/compatibility.md 的版本号是否等于
 *      package.json、README 里提到的探针脚本是否都真的存在。
 *   B. **新鲜度**：从上一个 tag 到现在，如果代码改了（index.js / client.src.js / web/src/**）
 *      但 README.md 没改 —— 直接失败。这条是「发布前必须更新 README」的可执行版本，
 *      不再依赖人和 AI 记得。
 *
 * 为什么需要 B：0.2.0~0.2.3 连着发四版，README 里还写着旧行为（安全边界、发版流程、
 * 探针清单全没有），版本号在三处文档里各说各的。那种情况下所有检查都是绿的。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const problems = []
const notes = []
const read = (path) => readFileSync(path, 'utf8')
const git = (argv) => execFileSync('git', argv, { encoding: 'utf8' }).trim()

const pkg = JSON.parse(read('package.json'))
const version = String(pkg.version)

/* ── A1. CHANGELOG 有当前版本条目 ────────────────────────────────────── */
if (!existsSync('CHANGELOG.md')) problems.push('CHANGELOG.md 不存在')
else if (!new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(read('CHANGELOG.md'))) {
  problems.push(`CHANGELOG.md 里没有 ${version} 的条目（每个版本都要一条，只写用户能感知的变化）`)
} else notes.push(`CHANGELOG 有 ${version}`)

/* ── A2. compatibility.md 版本号一致 ────────────────────────────────── */
if (existsSync('docs/compatibility.md')) {
  const compat = read('docs/compatibility.md')
  if (!compat.includes(`version: ${version}`)) {
    problems.push(`docs/compatibility.md 的版本号不是 ${version}（找到：${(compat.match(/version: [\d.]+/) ?? ['无'])[0]}）`)
  } else notes.push(`compatibility 版本号 ${version}`)
} else problems.push('docs/compatibility.md 不存在')

/* ── A3. README 里写的 npm 脚本都存在 ──────────────────────────────── */
const scripts = pkg.scripts ?? {}
const named = [...read('README.md').matchAll(/`npm run ([a-z:-]+[a-z])`/g)].map((m) => m[1])
const missing = [...new Set(named)].filter((name) => scripts[name] === undefined)
if (missing.length > 0) problems.push(`README 提到但 package.json 里没有的脚本：${missing.join('、')}`)
else notes.push(`README 提到的 ${new Set(named).size} 个脚本都存在`)

/* ── B. 代码改了、README 没改 ───────────────────────────────────────── */
const CODE_PATHS = ['index.js', 'client.src.js', 'src/host', 'web/src']
const DOC_PATHS = ['README.md', 'CHANGELOG.md', 'docs']
let lastTag = ''
try { lastTag = git(['describe', '--tags', '--abbrev=0']) } catch { lastTag = '' }

if (lastTag === '') {
  notes.push('没有上一个 tag，跳过「代码改了文档没改」检查')
} else {
  const changed = git(['diff', '--name-only', `${lastTag}..HEAD`]).split('\n').filter(Boolean)
  const codeTouched = changed.filter((file) => CODE_PATHS.some((prefix) => file === prefix || file.startsWith(prefix + '/')))
  const docTouched = changed.filter((file) => DOC_PATHS.some((prefix) => file === prefix || file.startsWith(prefix + '/')))
  if (codeTouched.length > 0 && docTouched.length === 0) {
    problems.push(
      `自 ${lastTag} 以来改了 ${codeTouched.length} 个代码文件，但 README/CHANGELOG/docs 一个字都没动。\n` +
      `     这次发布涉及：${codeTouched.slice(0, 5).join('、')}${codeTouched.length > 5 ? ' 等' : ''}\n` +
      '     用户看的是 README 和 npm 页面 —— 先把「变了什么」写进去，再发版。',
    )
  } else if (codeTouched.length > 0) {
    notes.push(`自 ${lastTag} 以来改了 ${codeTouched.length} 个代码文件，文档也同步改了 ${docTouched.length} 个`)
  } else {
    notes.push(`自 ${lastTag} 以来没有代码改动`)
  }
}

/* ── 输出 ───────────────────────────────────────────────────────────── */
for (const note of notes) console.log(`ok    ${note}`)
for (const problem of problems) console.log(`FAIL  ${problem}`)

if (problems.length > 0) {
  console.log(`\n发版自检不通过（${problems.length} 项）。修完再打 tag —— 顺序是：改代码 → 改文档 → npm test → 构建 → 提交 → 打 tag。`)
  process.exit(1)
}
console.log(`\n发版自检通过（${notes.length} 项）。`)
