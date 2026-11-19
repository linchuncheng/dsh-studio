// #8 回归：studio_task_artifact 三个动作都不能"报错但已写入"
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { SecretStore, StudioStore } from '../src/host/store.js'
import { configureToolHost, registerTools } from '../src/host/tools.js'

test('studio_task_artifact：add / update / remove 都不抛错，且写入是真的', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-studio-artifact-'))
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
    await store.mutate(state => {
      state.tasks.push({
        id: 't-art-1', code: 'DEV-999', title: '（自检）产物工具', type: 'requirement',
        status: 'dev', role: 'dev', comments: [], history: [], checklist: [], cases: [], artifacts: [],
        updatedAt: Date.now(),
      })
    })
    const artifactTool = tools.find(tool => tool.name === 'studio_task_artifact')
    assert.ok(artifactTool !== undefined, '应该注册了 studio_task_artifact')

    // add：以前这一句必抛 Cannot read properties of undefined (reading 'length')
    const added = await artifactTool.execute({ id: 't-art-1', kind: 'doc', title: '自检产物', ref: 'tmp/x.md', content: '正文', sync: false }, {})
    assert.match(String(added), /当前 1 件/)
    const card = store.snapshot().tasks.find(item => item.id === 't-art-1')
    assert.equal(card.artifacts.length, 1, '产物要真的写进去')
    const artifactId = card.artifacts[0].id

    // update
    const updated = await artifactTool.execute({ id: 't-art-1', action: 'update', artifactId, kind: 'doc', title: '改过的标题', content: '新正文', sync: false }, {})
    assert.match(String(updated), /当前 1 件/)
    assert.equal(store.snapshot().tasks.find(item => item.id === 't-art-1').artifacts[0].title, '改过的标题')

    // remove
    const removed = await artifactTool.execute({ id: 't-art-1', action: 'remove', artifactId, sync: false }, {})
    assert.match(String(removed), /当前 0 件/)
    assert.equal(store.snapshot().tasks.find(item => item.id === 't-art-1').artifacts.length, 0)
  } finally {
    store.db?.close?.()
    rmSync(dir, { recursive: true, force: true })
  }
})
