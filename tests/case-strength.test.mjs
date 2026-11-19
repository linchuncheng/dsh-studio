import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { COVERAGE_TARGET, coverageStrength, draftCasesFromCriteria, isExecutable, meetsCoverageTarget } from '../src/host/case-strength.js'

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

describe('case-strength: 从验收条件生成用例', () => {
  it('条件里有 URL → 生成接口用例（可执行）', () => {
    const cases = draftCasesFromCriteria(['登录接口 https://api.example.com/login 返回 200'])
    assert.equal(cases.length, 1)
    assert.equal(isExecutable(cases[0]), true)
    assert.equal(cases[0].draft, false)
    assert.equal(cases[0].http.url, 'https://api.example.com/login')
  })

  it('允许 shell 时，带命令行的条件生成 shell 用例', () => {
    const cases = draftCasesFromCriteria(['跑 $ npm test 全绿'], { allowShell: true })
    assert.equal(isExecutable(cases[0]), true)
    assert.match(cases[0].shell.command, /npm test/)
  })

  it('不允许 shell 时，同一条件只能是草稿', () => {
    const cases = draftCasesFromCriteria(['跑 $ npm test 全绿'], { allowShell: false })
    assert.equal(isExecutable(cases[0]), false)
    assert.equal(cases[0].draft, true)
  })

  it('推断不出断言 → 标草稿，且不计入覆盖率', () => {
    const cases = draftCasesFromCriteria(['页面看起来正常', '交互顺畅'])
    assert.equal(cases.every(item => item.draft === true), true)
    assert.equal(coverageStrength(cases).rate, 0)
  })

  it('混合场景：能推断的那条算覆盖，推不出的算草稿', () => {
    const cases = draftCasesFromCriteria(['登录接口 https://api.example.com/login 返回 200', '页面看起来正常'])
    const strength = coverageStrength(cases)
    assert.equal(strength.total, 2)
    assert.equal(strength.executable, 1)
    assert.equal(strength.rate, 0.5)
  })
})
