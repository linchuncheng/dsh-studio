// 多步用例的分步请求头：sanitize 要留住，执行时按「环境 → 用例 → 该步」覆盖合并并做变量替换。
// 起因：给一张卡的链式用例写 step.headers 时发现写了没用——sanitize 丢弃、执行器只读顶层 headers。
import assert from 'node:assert/strict'
import test from 'node:test'

import { sanitizeCaseHttp } from '../src/host/domain.js'
import { stepHeaders, substituteVars } from '../src/host/executor.js'
import { isExecutable } from '../src/host/case-strength.js'

test('sanitizeCaseHttp：每一步的 headers 要原样留住（以前被静默丢弃）', () => {
  const spec = sanitizeCaseHttp({
    steps: [
      { method: 'POST', url: 'http://127.0.0.1:1/login', body: '{}', headers: { 'content-type': 'application/json' } },
      { method: 'GET', url: 'http://127.0.0.1:1/me', headers: { cookie: 'sid={{sid}}' } },
    ],
  })
  assert.equal(spec.steps.length, 2)
  assert.deepEqual(spec.steps[0].headers, { 'content-type': 'application/json' })
  assert.deepEqual(spec.steps[1].headers, { cookie: 'sid={{sid}}' })
})

test('sanitizeCaseHttp：没有 headers 的步给空对象，不塞 undefined', () => {
  const spec = sanitizeCaseHttp({ steps: [{ method: 'GET', url: 'http://127.0.0.1:1/x' }] })
  assert.deepEqual(spec.steps[0].headers, {})
})

test('stepHeaders：三层覆盖顺序是 环境 → 用例 → 该步', () => {
  const merged = stepHeaders(
    { 'x-env': 'e', 'x-common': 'env', cookie: 'stale' },
    { 'x-common': 'case', cookie: 'sid={{sid}}' },
    { 'x-common': 'step', 'x-step': 's' },
    { sid: 'abc123' },
  )
  assert.equal(merged['x-env'], 'e', '环境头保留')
  assert.equal(merged['x-common'], 'step', '该步覆盖用例、用例覆盖环境')
  assert.equal(merged['x-step'], 's')
  assert.equal(merged.cookie, 'sid=abc123', '变量要替换')
})

test('stepHeaders：登录步不带业务 cookie —— 该步 headers 为空时继承顶层', () => {
  const top = { cookie: 'sid={{sid}}' }
  const loginStep = stepHeaders({}, top, {}, { sid: '' })
  assert.equal(loginStep.cookie, 'sid=', '没有 sid 时替换成空值（调用方据此判断未登录）')
  const withOverride = stepHeaders({}, top, { cookie: '' }, { sid: 'abc' })
  assert.equal(withOverride.cookie, '', '该步可以显式清掉顶层头')
})

test('变量占位符是 {{name}}：${name} 不会被替换（写错就是静默不生效）', () => {
  assert.equal(substituteVars('sid={{sid}}', { sid: 'x' }), 'sid=x')
  assert.equal(substituteVars('sid=${sid}', { sid: 'x' }), 'sid=${sid}')
})

test('带 steps 的用例算「可执行」（覆盖率门槛不能因为只有 steps 就判成草稿）', () => {
  const spec = sanitizeCaseHttp({
    steps: [
      { method: 'POST', url: 'http://127.0.0.1:1/login', body: '{}', extract: { sid: 'sid' } },
      { method: 'GET', url: 'http://127.0.0.1:1/me', headers: { cookie: 'sid={{sid}}' }, expectStatus: 200 },
    ],
  })
  assert.equal(isExecutable({ http: spec }), true)
})
