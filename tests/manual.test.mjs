// 使用说明（docs/manual.md）是人与 AI 共用的操作手册：它写错了比没写更糟。
// 这里锁三件事：结构在、工具清单与代码一致、排障手册覆盖已知症状。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const manual = readFileSync(join(repo, 'docs', 'manual.md'), 'utf8')
const readme = readFileSync(join(repo, 'README.md'), 'utf8')
const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8')
const toolsSource = readFileSync(join(repo, 'src', 'host', 'tools.js'), 'utf8')

test('manual: 十个章节都在（人看 §1–§4，AI 看 §5/§7/§8）', () => {
  for (const heading of ['## §1 一分钟看懂', '## §2 对象与关系', '## §3 一条需求的完整旅程', '## §4 门禁到底在拦什么',
    '## §5 AI 怎么用', '## §6 设置项地图', '## §7 数据在哪里', '## §8 排障手册', '## §9 日常运维', '## §10 术语表']) {
    assert.ok(manual.includes(heading), '缺章节：' + heading)
  }
})

test('manual: 工具清单与代码里的名字一致（不多不少，漏一个就等于教错）', () => {
  const fromCode = [...toolsSource.matchAll(/name: '(studio_[a-z_]+)'/g)].map(match => match[1])
  assert.ok(fromCode.length >= 40, '工具数量异常：' + fromCode.length)
  const missing = fromCode.filter(name => !manual.includes(name))
  assert.deepEqual(missing, [], '手册里没写这些工具：' + missing.join('、'))
})

test('manual: 排障手册覆盖我们真实踩过的坑', () => {
  for (const symptom of ['unsafe file path', 'larkJson is not a function', 'windowsVerbatimArguments',
    '渲染失败', 'sync:profile', 'drive:gc', '先把澄清答完', '先过评审']) {
    assert.ok(manual.includes(symptom), '排障手册缺这个症状：' + symptom)
  }
})

test('manual: README 与 AGENTS 都链到它（不然没人找得到）', () => {
  assert.match(readme, /docs\/manual\.md/, 'README 没链接使用说明')
  assert.match(agents, /docs\/manual\.md/, 'AGENTS 的文档表没登记使用说明')
})

test('manual: 门禁与默认值描述和代码一致', () => {
  // 两道闸门默认开：文档说「默认都开」，代码 defaultConfig 里也应是 true
  const domain = readFileSync(join(repo, 'src', 'host', 'domain.js'), 'utf8')
  assert.match(domain, /design: \{ enabled: true/, '设计闸门默认值变了，手册 §4 要同步')
  assert.match(domain, /reviewGate: \{ enabled: true/, '评审闸门默认值变了，手册 §4 要同步')
  assert.match(manual, /默认都开/, '手册 §4 要写清闸门默认状态')
})
