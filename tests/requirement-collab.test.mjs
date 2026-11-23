// issue #115 / #116 / #117 的回归测试：需求级的对话渠道、历史覆盖、文档与提出人入口。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { SecretStore, StudioStore } from '../src/host/store.js'
import { saveRequirement } from '../src/host/executor.js'
import { configureToolHost, registerTools } from '../src/host/tools.js'
import { appendRequirementComment, removeRequirementComment, sanitizeRequirementComments, updateRequirementComment } from '../src/host/requirement-comments.js'

const withStore = async fn => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-studio-reqcollab-'))
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
    return await fn({ store, find })
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* Windows 句柄未释放 */ }
  }
}

test('#115 需求评论：增 / 改（旧版进 edits）/ 删', () => {
  let list = appendRequirementComment([], { body: '产品：这里还要考虑退货', by: '产品经理', at: 1 })
  assert.equal(list.length, 1)
  assert.equal(list[0].by, '产品经理')
  const id = list[0].id
  list = updateRequirementComment(list, { commentId: id, body: '产品：退货也要，含运费', by: '产品经理', at: 2 })
  assert.equal(list[0].body, '产品：退货也要，含运费')
  assert.equal(list[0].edits.length, 1, '旧正文要留在 edits 里')
  assert.equal(list[0].edits[0].body, '产品：这里还要考虑退货')
  list = removeRequirementComment(list, id)
  assert.equal(list.length, 0)
  assert.throws(() => appendRequirementComment([], { body: '   ' }), /不能为空/)
  assert.deepEqual(sanitizeRequirementComments(null), [])
  assert.equal(sanitizeRequirementComments([{ body: '' }]).length, 0, '空正文不入库')
})

test('#115 工具 studio_requirement_comment 能写进需求并读回', async () => {
  await withStore(async ({ store, find }) => {
    await store.mutate(state => {
      state.requirements.push({ id: 'req-c1', code: 'REQ-2026-911', title: '（自检）评论', status: 'draft', comments: [], history: [], points: [], questions: [], docs: [], updatedAt: Date.now() })
    })
    const tool = find('studio_requirement_comment')
    assert.ok(tool !== undefined, '应该注册了 studio_requirement_comment')
    await tool.execute({ id: 'REQ-2026-911', body: '架构：接口边界要写清', by: '架构师' })
    const requirement = store.snapshot().requirements.find(item => item.id === 'req-c1')
    assert.equal(requirement.comments.length, 1)
    assert.equal(requirement.comments[0].by, '架构师')
  })
})

test('#116 改功能点/文档链接会写进 history，by 用调用方给的名字', async () => {
  await withStore(async ({ store }) => {
    const created = await saveRequirement(store, { title: '（自检）历史', description: '初版', by: '产品' })
    await saveRequirement(store, {
      id: created.id,
      points: [{ id: 'p1', title: '功能点一', acceptance: [{ id: 'a1', text: '验收一' }] }],
      links: { prd: 'https://example.com/prd', proto: '', acceptance: '' },
      by: '架构师',
    })
    const requirement = store.snapshot().requirements.find(item => item.id === created.id)
    const fields = (requirement.history ?? []).map(item => item.field)
    assert.ok(fields.includes('功能点'), `history 要有「功能点」：${JSON.stringify(fields)}`)
    assert.ok(fields.includes('文档链接'), `history 要有「文档链接」：${JSON.stringify(fields)}`)
    const row = requirement.history.find(item => item.field === '功能点')
    assert.equal(row.by, '架构师', 'agent 改需求，历史里不能记成「人」')
    assert.ok(String(row.to).length > 0, '要留下改成了什么')
  })
})

test('#117 提出人工具能写 requester / source，并能清空', async () => {
  await withStore(async ({ store, find }) => {
    const created = await saveRequirement(store, { title: '（自检）提出人' })
    const tool = find('studio_requirement_requester')
    await tool.execute({ id: created.code, name: '张三', dept: '财务部', contact: 'zhangsan@example.com', source: 'business', by: '产品' })
    let requirement = store.snapshot().requirements.find(item => item.id === created.id)
    assert.equal(requirement.requester.name, '张三')
    assert.equal(requirement.requester.dept, '财务部')
    assert.equal(requirement.source, 'business')
    await tool.execute({ id: created.code, action: 'clear', by: '产品' })
    requirement = store.snapshot().requirements.find(item => item.id === created.id)
    assert.equal(requirement.requester, null)
  })
})

test('#117 文档工具能把 PRD 正文写进 requirement.docs', async () => {
  await withStore(async ({ store, find }) => {
    const created = await saveRequirement(store, { title: '（自检）文档正文' })
    const tool = find('studio_requirement_doc')
    assert.ok(tool !== undefined, '应该注册了 studio_requirement_doc')
    await tool.execute({ id: created.code, action: 'add', kind: 'prd', title: 'PRD v1', content: '# 背景\n\n要解决的问题。', version: 'v1.0', by: '产品' })
    const requirement = store.snapshot().requirements.find(item => item.id === created.id)
    assert.equal((requirement.docs ?? []).length, 1, '文档要写进 requirement.docs')
    assert.match(String(requirement.docs[0].content ?? ''), /要解决的问题/)
  })
})
