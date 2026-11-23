// issue #107 / #108 / #109 / #110 / #111 的回归测试。
//
// 这些都是「工具层与路由/执行器语义不一致」的问题：工具写得进去、看得见，但少了字段或者语义不同，
// 而且大多不会报错——只能靠断言把行为钉住。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { SecretStore, StudioStore } from '../src/host/store.js'
import { configureToolHost, registerTools } from '../src/host/tools.js'
import { requirementMatrix } from '../src/host/requirement-gate.js'
import { runShellCase } from '../src/host/shell-runner.js'

const withTools = async fn => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-studio-issues-'))
  const store = new StudioStore(join(dir, 'state.json'), {
    dbFile: join(dir, 'state.db'),
    secrets: new SecretStore(join(dir, '.secrets.json')),
  })
  try {
    await store.ready
    const tools = []
    const ctx = { tools: { register: tool => { tools.push(tool); return () => {} } }, effect: () => () => {} }
    configureToolHost({
      toolOperator: () => '自检',
      toolLevel: () => 'write',
      checkToolAccess: () => ({ level: 'write', denial: null }),
      recordAudit: async () => {},
      getActiveDispatcher: () => undefined,
      getActiveSkills: () => undefined,
    })
    registerTools(ctx, store)
    const find = name => tools.find(tool => tool.name === name)
    return await fn({ store, tools, find })
  } finally {
    // Windows 上 SQLite 句柄还没释放时 rmSync 会 EPERM：清理失败不该把断言结果盖掉
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

const seedTask = (store, extra = {}) => store.mutate(state => {
  state.tasks.push({
    id: 't-issue-1', code: 'DEV-901', title: '（自检）issue 回归', type: 'dev',
    status: 'dev', role: 'dev', comments: [], history: [], checklist: [], cases: [], artifacts: [],
    updatedAt: Date.now(), ...extra,
  })
})

test('#107 只改标题时，交付物的 ref / content / stage / by 不能被清空', async () => {
  await withTools(async ({ store, find }) => {
    await seedTask(store)
    const tool = find('studio_task_artifact')
    await tool.execute({ id: 't-issue-1', action: 'add', kind: 'design', title: '设计稿', ref: 'docs/design/evidence.md', content: '这是一段正文。', stage: 'dev', by: '研发', sync: false })
    const before = store.snapshot().tasks[0].artifacts[0]
    assert.equal(before.ref, 'docs/design/evidence.md')
    assert.equal(before.by, '研发')

    await tool.execute({ id: 't-issue-1', action: 'update', artifactId: before.id, title: '设计稿（改标题）', sync: false })
    const after = store.snapshot().tasks[0].artifacts[0]
    assert.equal(after.id, before.id, '交付物 id 不能变')
    assert.equal(after.title, '设计稿（改标题）', '标题要改到')
    assert.equal(after.ref, before.ref, 'ref 不能被清空')
    assert.equal(after.content, before.content, 'content 不能被清空')
    assert.equal(after.stage, before.stage, 'stage 不能被清空')
    assert.equal(after.by, before.by, 'by 不能被改成 agent')
    assert.equal(after.kind, before.kind, 'kind 不能被重置成 other')
  })
})

test('#108 用例工具能写 acceptanceId / db，update 也能改 pointId 与 acceptanceId', async () => {
  await withTools(async ({ store, find }) => {
    await seedTask(store)
    const tool = find('studio_task_case')
    await tool.execute({
      id: 't-issue-1', action: 'add', by: '测试',
      cases: [{
        title: '登录失败 5 次锁定', expected: '第 6 次 423',
        pointId: 'p1', acceptanceId: 'a1',
        url: 'http://127.0.0.1:1/api/login', method: 'POST', expectStatus: 423,
      }],
    })
    let card = store.snapshot().tasks[0].cases[0]
    assert.equal(card.pointId, 'p1', 'pointId 要落到用例上')
    assert.equal(card.acceptanceId, 'a1', 'acceptanceId 要落到用例上')

    await tool.execute({ id: 't-issue-1', action: 'update', caseId: card.id, pointId: 'p2', acceptanceId: 'a2', by: '测试' })
    card = store.snapshot().tasks[0].cases[0]
    assert.equal(card.pointId, 'p2')
    assert.equal(card.acceptanceId, 'a2')
  })
})

test('#109 coverageRate 与 coveredPoints 不再自相矛盾', () => {
  const tasks = [{
    id: 't-1', code: 'DEV-1', title: '卡', status: 'dev', requirementId: 'req-1', pointId: 'p1', cases: [
      { id: 'c1', title: '有定义没跑过', result: 'pending', http: { method: 'GET', url: 'http://127.0.0.1:1/x', expectStatus: 200 } },
    ], artifacts: [],
  }]
  const requirement = {
    id: 'req-1', code: 'REQ-2026-901', title: '需求', status: 'active',
    points: [{ id: 'p1', title: '功能点一', acceptance: [{ id: 'a1', text: '验收一' }] }],
  }
  const matrix = requirementMatrix({ tasks, requirements: [requirement] }, requirement)
  const summary = matrix.summary
  assert.equal(summary.points, 1)
  assert.equal(summary.pointsWithoutCases, 0, '有用例 → 不算「没有任何用例」')
  assert.equal(summary.pointsWithCasesRate, 100, '有用例的功能点占 100%')
  assert.equal(summary.coveredPoints, 0, '还没跑通 → 覆盖 0')
  assert.equal(summary.coverageRate, 0, 'coverageRate 必须与 coveredPoints 一致（以前这里是 100）')
})

test('#110 澄清问题有工具入口：ask → answer → 读回', async () => {
  await withTools(async ({ store, find }) => {
    await store.mutate(state => {
      state.requirements.push({ id: 'req-issue-1', code: 'REQ-2026-902', title: '（自检）需求', status: 'draft', points: [], questions: [], changes: [], history: [], docs: [], updatedAt: Date.now() })
    })
    const tool = find('studio_requirement_questions')
    assert.ok(tool !== undefined, '应该注册了 studio_requirement_questions')
    await tool.execute({ id: 'REQ-2026-902', action: 'ask', text: '要不要支持 LDAP？', owner: '产品' })
    let questions = store.snapshot().requirements[0].questions
    assert.equal(questions.length, 1)
    assert.equal(questions[0].status, 'open')
    await tool.execute({ id: 'REQ-2026-902', action: 'answer', questionId: questions[0].id, answer: '本期不做' })
    questions = store.snapshot().requirements[0].questions
    assert.equal(questions[0].status, 'answered')
    assert.equal(questions[0].answer, '本期不做')
  })
})

test('#111 shell 用例超时要报「超时」，不是「退出码 1」', async () => {
  const caseItem = {
    title: '慢命令',
    shell: { command: 'node -e "setTimeout(()=>{}, 5000)"', cwd: '', timeoutMs: 300, expectExit: 0, expectContains: '', expectNotContains: '' },
  }
  const result = await runShellCase(caseItem, { testing: { allowShell: true } })
  assert.equal(result.ok, false)
  assert.match(result.error, /超时/, `要明确说是超时，实际：${result.error}`)
  assert.doesNotMatch(result.error, /退出码 1（期望 0）/, '超时不该被报成退出码不对')
})

test('#112 登记交付物时不把请求体顶层的卡 id 当成交付物 id', async () => {
  const { artifactInputFromBody, sanitizeArtifact } = await import('../src/host/domain.js')
  const body = { id: 't-f330bbe9', action: 'add', kind: 'design', title: '需求来源', ref: 'docs/x.md', by: '研发' }
  const input = artifactInputFromBody(body)
  assert.equal(input.id, undefined, '卡 id 不能被当成交付物的 id')
  const created = sanitizeArtifact(input, 2)
  assert.match(created.id, /^a3-[0-9a-f]{4}$/, `交付物 id 形状不对：${created.id}`)
  // 显式用 artifact 包一层时仍照原样传
  assert.equal(artifactInputFromBody({ artifact: { title: '包里带的' }, id: 't-1' }).title, '包里带的')
})
