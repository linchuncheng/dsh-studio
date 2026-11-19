// 测试环境解析（issue #5 第 7 条：新装没配环境时不该把卡锁死）
import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveTestingEnv } from '../src/host/executor.js'

test('配了环境就用配的（默认环境优先，否则第一个）', () => {
  const config = { testing: { envs: [{ id: 'demo', name: '演示', baseUrl: 'http://a' }, { id: 'prod', name: '线上', baseUrl: 'http://b' }], defaultEnv: 'prod' } }
  assert.equal(resolveTestingEnv(config).env.id, 'prod')
  assert.equal(resolveTestingEnv(config, { env: 'demo' }).env.id, 'demo')
  assert.equal(resolveTestingEnv({ testing: { envs: config.testing.envs, defaultEnv: '' } }).env.id, 'demo', '没有默认就用第一个')
  assert.equal(resolveTestingEnv(config).fallback, false)
})

test('没配环境 + 有请求来源 → 回退到宿主自身地址', () => {
  const resolved = resolveTestingEnv({ testing: { envs: [], defaultEnv: '' } }, { origin: 'http://127.0.0.1:18080' })
  assert.equal(resolved.fallback, true)
  assert.equal(resolved.env.baseUrl, 'http://127.0.0.1:18080')
  assert.equal(resolved.env.inline, true)
  assert.match(resolved.env.name, /回退/)
})

test('没配环境 + 没有来源（例如 agent 直接调）→ 明确失败，不硬跑', () => {
  const resolved = resolveTestingEnv({ testing: { envs: [], defaultEnv: '' } }, {})
  assert.equal(resolved.env, undefined)
  assert.equal(resolved.fallback, false)
})

test('配置缺字段也不炸', () => {
  assert.equal(resolveTestingEnv(undefined).env, undefined)
  assert.equal(resolveTestingEnv({}).env, undefined)
})
