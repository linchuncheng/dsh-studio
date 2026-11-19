#!/usr/bin/env node
/**
 * 本地演练镜像 workflow 的改写步骤：在临时目录里跑一遍，确认它不再依赖产物里的字面量。
 *
 *   node tools/mirror-dry-run.mjs
 *
 * CI 里那段是 heredoc，本地跑不了原样；这里跑同一套逻辑（读 package.json / cordis.patch.yml，
 * 改名、写回、自检），差别只在目录。它挂在 release:check 里 —— 之前这个步骤改过一次产物、
 * 又随产物变化整条失败，而没有任何检查能在本地发现。
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const work = mkdtempSync(join(tmpdir(), 'dsh-studio-mirror-'))
try {
  for (const file of ['package.json', 'cordis.patch.yml', 'client.js']) {
    cpSync(file, join(work, file))
  }
  const script = `
import { readFileSync, writeFileSync } from 'node:fs'
const mirror = '@marsken88/dsh-studio'
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const before = pkg.name
pkg.name = mirror
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\\n')
const yml = readFileSync('cordis.patch.yml', 'utf8')
const patched = yml.replaceAll(\`name: "\${before}"\`, \`name: "\${mirror}"\`)
if (patched === yml) throw new Error('patch 里没有 name: ' + before)
writeFileSync('cordis.patch.yml', patched)
// 再跑一遍 workflow 里的自检：patch 的 name 必须等于包名
const after = JSON.parse(readFileSync('package.json', 'utf8'))
const names = [...readFileSync('cordis.patch.yml', 'utf8').matchAll(/^\\s+name:\\s*"?([^"\\n]+)"?\\s*$/gm)].map(m => m[1].trim())
if (names.length === 0) throw new Error('patch 里没有 name')
for (const name of names) if (name !== after.name) throw new Error('patch 的 name 与包名不一致')
console.log(before + ' → ' + after.name)
`
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: work, encoding: 'utf8' })
  console.log('ok   镜像改写演练通过：' + out.trim())
} catch (error) {
  console.log('FAIL 镜像改写演练失败：' + String(error.stdout ?? error.message).slice(0, 300))
  process.exit(1)
} finally {
  rmSync(work, { recursive: true, force: true })
}
