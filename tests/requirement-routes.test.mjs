// 需求路由层的回归：按编号读写、坏链接报错（issue #9 第 1、2 条）。
// 驱动真实的 handleRequirementRoute（不是复制逻辑），宿主能力用桩注入。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { configureRequirementRoutes, handleRequirementRoute } from '../src/host/routes/requirements.js'
import { configureExecutor } from '../src/host/executor.js'
import { SecretStore, StudioStore } from '../src/host/store.js'

configureExecutor(new Proxy({ serviceDependencies: () => [], serviceConflicts: () => undefined }, { get: (target, key) => (key in target ? target[key] : () => undefined) }))

configureRequirementRoutes({
  readJsonBody: async req => req.body ?? {},
  sendJson: (res, status, payload) => { res.status = status; res.body = payload },
  publicState: () => ({ revision: 1 }),
  createTask: async () => ({}),
})

const call = (store, route, body) => {
  const res = {}
  return handleRequirementRoute({ method: 'POST', route, req: { body }, res, store, url: new URL('http://x' + route) }).then(handled => ({ handled, res }))
}

test('需求路由：按编号（REQ-2026-001）也能读，找不到时列出可用的引用', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-req-route-'))
  const store = new StudioStore(join(dir, 'state.json'), { dbFile: join(dir, 'state.db'), secrets: new SecretStore(join(dir, '.secrets.json')) })
  try {
    await store.ready
    await store.mutate(state => {
      state.requirements.push({ id: 'req-078f16', code: 'REQ-2026-001', title: '退款流水', status: 'draft', points: [], docs: [], history: [], pool: null, review: null })
    })
    const byCode = await call(store, '/requirement/get', { id: 'REQ-2026-001' })
    assert.equal(byCode.handled, true)
    assert.equal(byCode.res.status, 200)
    assert.equal(byCode.res.body.requirement.id, 'req-078f16', '编号要归一成内部 id')
    assert.ok(byCode.res.body.matrix !== undefined)

    await assert.rejects(() => call(store, '/requirement/get', { id: 'REQ-9999' }), /找不到需求/)
    await assert.rejects(() => call(store, '/requirement/get', { id: 'REQ-9999' }), /可用的有/, '要告诉人正确格式')
  } finally {
    store.db?.close?.()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('需求路由：坏链接直接拒绝，好链接落到 links 上（顶层 prd 不再被静默忽略）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-req-links-'))
  const store = new StudioStore(join(dir, 'state.json'), { dbFile: join(dir, 'state.db'), secrets: new SecretStore(join(dir, '.secrets.json')) })
  try {
    await store.ready
    await assert.rejects(
      () => call(store, '/requirement/save', { requirement: { title: '坏链接', prd: 'docs/prd.md' } }),
      /不合法/,
    )
    const saved = await call(store, '/requirement/save', { requirement: { title: '好链接', prd: 'https://example.com/prd' } })
    assert.equal(saved.res.status, 200)
    assert.equal(saved.res.body.requirement.links.prd, 'https://example.com/prd', '顶层 prd 要映射进 links')
  } finally {
    store.db?.close?.()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('/task/signoff 用的是卡 id，不是需求引用（批量归一化误伤过）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-task-signoff-'))
  const store = new StudioStore(join(dir, 'state.json'), { dbFile: join(dir, 'state.db'), secrets: new SecretStore(join(dir, '.secrets.json')) })
  try {
    await store.ready
    await store.mutate(state => {
      state.config.experts.push({ id: 'pm', name: '产品经理', emoji: '📋', role: 'product', skills: [], enabled: true })
      state.tasks.push({
        id: 't-1', code: 'DEV-001', title: '签字卡', status: 'accept', role: 'product',
        requirementId: '', checklist: [], artifacts: [], comments: [], history: [], cases: [], blocked: null,
      })
    })
    const out = await call(store, '/task/signoff', { id: 't-1', by: '产品经理', note: '人看过' })
    assert.equal(out.res.status, 200, JSON.stringify(out.res.body?.error ?? ''))
    const task = store.snapshot().tasks.find(item => item.id === 't-1')
    assert.equal(task.signoff?.by, '产品经理')
    assert.equal(task.signoff?.actorKind, 'ai', '专家名册里的名字 = AI（与闸门同一口径）')
  } finally {
    store.db?.close?.()
    rmSync(dir, { recursive: true, force: true })
  }
})
