import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { COVERAGE_TARGET, coverageStrength, isExecutable, meetsCoverageTarget } from '../src/host/case-strength.js'

/* 会诊共识：模板生成的用例只有标题、没有断言，于是「全绿」不代表验过。
   这张尺子用来把「能验的」和「只是标题」分开 —— 产品定义第 8 条要求 ≥60%。 */
describe('case-strength: 用例强度', () => {
  it('带 http / shell / db 定义的才算能验', () => {
    assert.equal(isExecutable({ http: { url: 'http://x/y' } }), true)
    assert.equal(isExecutable({ shell: { command: 'echo hi' } }), true)
    assert.equal(isExecutable({ db: { sql: 'select 1' } }), true)
  })

  it('只有标题、或定义是空的 → 不能验', () => {
    assert.equal(isExecutable({ title: '主流程' }), false)
    assert.equal(isExecutable({ title: '主流程', http: { url: '   ' } }), false)
    assert.equal(isExecutable({ title: '主流程', shell: {} }), false)
    assert.equal(isExecutable(null), false)
  })

  it('强度：总数 / 可执行 / 草稿 / 占比', () => {
    const strength = coverageStrength([
      { http: { url: 'http://a' } },
      { title: '只有标题' },
      { shell: { command: 'ls' } },
      { title: '也是只有标题' },
    ])
    assert.equal(strength.total, 4)
    assert.equal(strength.executable, 2)
    assert.equal(strength.draft, 2)
    assert.equal(strength.rate, 0.5)
  })

  it('没有用例时占比是 null —— 「没数据」不等于「0%」', () => {
    assert.equal(coverageStrength([]).rate, null)
    assert.equal(meetsCoverageTarget([]), null)
  })

  it('门槛：50% 不达标、60% 达标（边界要算达标）', () => {
    const half = [{ http: { url: 'http://a' } }, { title: 'x' }]
    assert.equal(meetsCoverageTarget(half), false)

    const sixty = [
      { http: { url: 'http://a' } }, { http: { url: 'http://b' } }, { http: { url: 'http://c' } },
      { title: 'x' }, { title: 'y' },
    ]
    assert.equal(meetsCoverageTarget(sixty), true)
    assert.equal(COVERAGE_TARGET, 0.6)
  })
})
