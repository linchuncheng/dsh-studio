// DocSink 纯逻辑：出口解析、项目覆盖、主从关系、幂等键。
import assert from 'node:assert/strict'
import test from 'node:test'

import { artifactDocKey, docProviderFor, docSinksFor, publicDocsConfig, sanitizeDocsConfig } from '../src/host/doc-sink.js'

test('配置：默认 feishu；垃圾值回落；未知项目不写进表', () => {
  assert.equal(sanitizeDocsConfig({}).provider, 'feishu')
  assert.equal(sanitizeDocsConfig({ provider: 'nonsense' }).provider, 'feishu')
  const cfg = sanitizeDocsConfig({ provider: 'both', perProject: { p1: 'weknora', p2: 'oops', '': 'feishu' } })
  assert.equal(cfg.provider, 'both')
  assert.deepEqual(cfg.perProject, { p1: 'weknora' }, '未知值不该留下半配置')
})

test('WeKnora 连接形状：字段截断、空串保留', () => {
  const sink = sanitizeDocsConfig({ weknora: { baseUrl: ' http://h:8080 ', apiKey: 'k', tenantId: '10000', knowledgeBaseId: 'kb' } }).weknora
  assert.deepEqual(sink, { baseUrl: 'http://h:8080', apiKey: 'k', tenantId: '10000', knowledgeBaseId: 'kb' })
  assert.deepEqual(sanitizeDocsConfig({}).weknora, { baseUrl: '', apiKey: '', tenantId: '', knowledgeBaseId: '' })
})

test('对外配置不泄露 apiKey：只给 apiKeySet', () => {
  const raw = sanitizeDocsConfig({ weknora: { baseUrl: 'http://h', apiKey: 'sk-secret', tenantId: '1', knowledgeBaseId: 'kb' } })
  const pub = publicDocsConfig(raw)
  assert.equal(pub.weknora.apiKey, '')
  assert.equal(pub.weknora.apiKeySet, true)
  assert.equal(pub.weknora.baseUrl, 'http://h')
  assert.ok(!JSON.stringify(pub).includes('sk-secret'), 'apiKey 不能出现在对外配置里')
})

test('保存时 apiKey 留空 = 保持原值；输入新值才覆盖', () => {
  const base = sanitizeDocsConfig({ weknora: { baseUrl: 'http://h', apiKey: 'sk-old', tenantId: '1', knowledgeBaseId: 'kb' } })
  const kept = sanitizeDocsConfig({ weknora: { baseUrl: 'http://h2', apiKey: '', tenantId: '1', knowledgeBaseId: 'kb' } }, base)
  assert.equal(kept.weknora.apiKey, 'sk-old', '面板回显是空的，保存不能把 key 冲掉')
  assert.equal(kept.weknora.baseUrl, 'http://h2')
  const changed = sanitizeDocsConfig({ weknora: { baseUrl: 'http://h2', apiKey: 'sk-new', tenantId: '1', knowledgeBaseId: 'kb' } }, base)
  assert.equal(changed.weknora.apiKey, 'sk-new')
})

test('优先级：需求级 > 项目级 > 全局', () => {
  const config = { docs: sanitizeDocsConfig({ provider: 'feishu', perProject: { p1: 'weknora' } }) }
  assert.equal(docProviderFor(config, { project: 'p1' }), 'weknora', '项目覆盖全局')
  assert.equal(docProviderFor(config, { project: 'p2' }), 'feishu', '没配的项目用全局')
  assert.equal(docProviderFor(config, { project: 'p1', docsProvider: 'both' }), 'both', '需求级最高')
  assert.equal(docProviderFor({}, { docsProvider: 'weknora' }), 'weknora')
})

test('both：两个出口，飞书为主（主从不许反转）', () => {
  const plan = docSinksFor({ docs: sanitizeDocsConfig({ provider: 'both' }) }, {})
  assert.deepEqual(plan.sinks, ['feishu', 'weknora'])
  assert.equal(plan.primary, 'feishu')
  const only = docSinksFor({ docs: sanitizeDocsConfig({ provider: 'weknora' }) }, {})
  assert.deepEqual(only.sinks, ['weknora'])
  assert.equal(only.primary, 'weknora')
})

test('幂等键：按卡编号 + 交付物 id，换出口不变', () => {
  assert.equal(artifactDocKey({ code: 'DEV-001' }, { id: 'a1' }), 'DEV-001::a1')
  assert.equal(artifactDocKey({ id: 't-9' }, { id: 'a2' }), 't-9::a2', '没编号就用卡 id')
})
