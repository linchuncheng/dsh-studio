// issue #21：工具层补齐 discovery / points / 拆卡。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { splitRequirement } from '../src/host/split.js'
import { SecretStore, StudioStore } from '../src/host/store.js'
import { configureToolHost, registerTools } from '../src/host/tools.js'

const requirement = (overrides = {}) => ({
  id: 'req-1', code: 'REQ-2026-001', title: '收藏夹批量导出', status: 'active', project: '',
  review: { status: 'approved', by: '产品', at: 1, note: '' },
  discovery: { server: '没有服务端，纯前端 localStorage', auth: '不做鉴权', boundary: '只交付界面' },
  points: [
    { id: 'p1', title: '列表页多选导出 JSON', description: '', acceptance: [{ id: 'a1', text: '勾选 3 条后导出含 3 条的 JSON' }, { id: 'a2', text: '文件名含日期' }] },
    { id: 'p2', title: '导出的空态提示', description: '', acceptance: [{ id: 'a3', text: '没勾选时提示先勾选' }] },
  ],
  docs: [], questions: [], dependsOn: [], history: [], ...overrides,
})

const withStore = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-split-'))
  const store = new StudioStore(join(dir, 'state.json'), { dbFile: join(dir, 'state.db'), secrets: new SecretStore(join(dir, '.secrets.json')) })
  try {
    await store.ready
    return await fn(store)
  } finally {
    store.db?.close?.()
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 测试里的建卡：直接写进 store，返回刚建的那张。 */
const makeCreateTask = store => async (target, input) => {
  let created
  await target.mutate(state => {
    const id = `t-${state.tasks.length + 1}`
    created = {
      id, code: `DEV-00${state.tasks.length + 1}`, title: input.title, type: input.type, status: input.status,
      role: 'product', requirementId: input.requirementId, pointId: input.pointId,
      checklist: (input.checklist ?? []).map((item, index) => ({ id: `c${index + 1}`, text: item.text, done: false, by: '', at: 0, note: '' })),
      comments: [], history: [], cases: [], artifacts: [], blocked: null,
    }
    state.tasks.push(created)
  })
  void store
  return created
}

test('拆卡：一个功能点一张卡，卡的验收清单 = 功能点的验收条件', async () => {
  await withStore(async store => {
    await store.mutate(state => { state.requirements.push(requirement()) })
    const out = await splitRequirement(store, { id: 'REQ-2026-001' }, makeCreateTask(store))
    assert.equal(out.created.length, 2)
    const first = store.snapshot().tasks.find(item => item.pointId === 'p1')
    assert.equal(first.title, 'p1 列表页多选导出 JSON')
    assert.equal(first.checklist.length, 2, '两条验收条件要进清单')
    assert.match(first.checklist[0].text, /勾选 3 条/)
    assert.equal(first.status, 'clarify', '默认落在待澄清')
    assert.ok(Array.isArray(out.warnings), 'warnings 必须回传（以前工具层拿不到）')
  })
})

test('拆卡：已经建过卡的功能点跳过；全都建过就报错', async () => {
  await withStore(async store => {
    await store.mutate(state => { state.requirements.push(requirement()) })
    await splitRequirement(store, { id: 'req-1', pointIds: ['p1'] }, makeCreateTask(store))
    const second = await splitRequirement(store, { id: 'req-1', pointIds: ['p1', 'p2'] }, makeCreateTask(store))
    assert.equal(second.created.length, 1, '只拆还没建卡的那个')
    assert.equal(second.created[0].pointId, 'p2')
    await assert.rejects(() => splitRequirement(store, { id: 'req-1' }, makeCreateTask(store)), /都已经有卡/)
  })
})

test('拆卡门禁：需求没评审通过、澄清没答完都拒（给的是下一步该做什么）', async () => {
  await withStore(async store => {
    // status=draft：既没评审通过、也还没开始 → 拆卡该被拦（active/delivered/closed 视为已开始，可以直接拆）
    await store.mutate(state => { state.requirements.push(requirement({ status: 'draft', review: { status: 'pending' } })) })
    await assert.rejects(() => splitRequirement(store, { id: 'req-1' }, makeCreateTask(store)), /先过评审/)

    await store.mutate(state => {
      const target = state.requirements[0]
      target.review = { status: 'approved' }
      target.discovery = { server: '', auth: '', boundary: '' }
    })
    await assert.rejects(() => splitRequirement(store, { id: 'req-1' }, makeCreateTask(store)), /澄清答完/)

    // 编号也能传
    await store.mutate(state => { state.requirements[0].discovery = { server: '无', auth: '无', boundary: '界面' } })
    const out = await splitRequirement(store, { id: 'REQ-2026-001' }, makeCreateTask(store))
    assert.equal(out.created.length, 2)
  })
})

test('工具层：requirement_save 能写 discovery / points，requirement_split 能拆', async () => {
  await withStore(async store => {
    const registered = []
    const ctx = { tools: { register: tool => { registered.push(tool); return () => {} } }, effect: () => () => {} }
    configureToolHost({
      toolOperator: () => '自检', toolLevel: () => 'write',
      checkToolAccess: () => ({ level: 'write', denial: null }), recordAudit: async () => {},
      publicConfig: config => config, getActiveDispatcher: () => undefined, getActiveSkills: () => undefined,
      createTask: makeCreateTask(store),
    })
    registerTools(ctx, store)
    const save = registered.find(tool => tool.name === 'studio_requirement_save')
    const split = registered.find(tool => tool.name === 'studio_requirement_split')
    assert.ok(split !== undefined, '应该有 studio_requirement_split 工具')

    const text = await save.execute({
      title: '收藏夹批量导出',
      discovery: { server: '没有服务端', auth: '不做鉴权', boundary: '只交付界面' },
      points: [{ id: 'p1', title: '多选导出 JSON', acceptance: [{ id: 'a1', text: '导出含 3 条的 JSON' }] }],
    }, {})
    assert.match(String(text), /已保存需求/)
    const saved = store.snapshot().requirements[0]
    assert.equal(saved.discovery.server, '没有服务端', 'discovery 要真的落库（以前工具层传不进去）')
    assert.equal(saved.points.length, 1, 'points 要真的落库')

    // 没评审前拆 → 报错（门禁在工具层同样生效）
    await assert.rejects(() => split.execute({ id: saved.id }, {}), /先过评审/)
    // 评审通过后拆 → 出一张卡
    const review = registered.find(tool => tool.name === 'studio_requirement_review')
    await review.execute({ id: saved.id, decision: 'approve', by: '产品' }, {})
    const out = await split.execute({ id: saved.id }, {})
    assert.match(String(out), /拆出 1 张卡/)
    assert.equal(store.snapshot().tasks.length, 1)
    assert.equal(store.snapshot().tasks[0].pointId, 'p1')
  })
})
