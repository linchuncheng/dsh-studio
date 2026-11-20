// 出口分发：按 config.docs 决定投递到哪儿；WeKnora 为主时失败要抛，both 时只记 error。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { sanitizeDocsConfig } from '../src/host/doc-sink.js'

const stubWeknora = () => {
  const calls = []
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      calls.push(req.url)
      res.setHeader('Content-Type', 'application/json')
      if (req.url.endsWith('/knowledge/manual')) return res.end(JSON.stringify({ data: { id: 'k-9' } }))
      if (req.url.endsWith('/reparse')) return res.end(JSON.stringify({ success: true }))
      res.statusCode = 404
      res.end('{}')
    })
  })
  return { server, calls }
}

test('provider=weknora：只写知识库，台账落在 artifact.docs.weknora', async () => {
  const { SecretStore, StudioStore } = await import('../src/host/store.js')
  const { syncArtifact } = await import('../src/host/executor.js')
  const { server, calls } = stubWeknora()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const dir = mkdtempSync(join(tmpdir(), 'dsh-docsink-'))
  const store = new StudioStore(join(dir, 'state.json'), { dbFile: join(dir, 'state.db'), secrets: new SecretStore(join(dir, '.secrets.json')) })
  try {
    await store.ready
    await store.mutate(state => {
      state.config.docs = sanitizeDocsConfig({
        provider: 'weknora',
        weknora: { baseUrl: `http://127.0.0.1:${port}`, apiKey: 'k', tenantId: '10000', knowledgeBaseId: 'kb1' },
      })
      state.requirements.push({ id: 'r1', code: 'REQ-1', title: '需求一' })
      state.tasks.push({
        id: 't1', code: 'DEV-001', title: '交付物卡', type: 'dev', status: 'dev', role: 'dev',
        requirementId: 'r1', checklist: [], comments: [], history: [], cases: [], artifacts: [
          { id: 'a1', kind: 'design', title: '方案定稿', ref: '', content: '# 方案\n正文', stage: 'design', status: 'delivered', at: 0 },
        ],
      })
    })
    const out = await syncArtifact(store, 't1', 'a1')
    assert.equal(out.provider, 'weknora')
    assert.equal(out.primary, 'weknora')
    assert.equal(out.sinks.weknora.ok, true)
    assert.match(String(out.url), /\/knowledge\/k-9$/, '只写知识库时也要给消费方一个链接')
    assert.equal(out.token, '', 'token 空串，与老形状兼容')
    assert.deepEqual(calls.map(url => url.split('/').slice(-1)[0]), ['manual', 'reparse'])
    const card = store.snapshot().tasks.find(item => item.id === 't1')
    assert.equal(card.artifacts[0].docs.weknora.knowledgeId, 'k-9')
    assert.equal(card.artifacts[0].docs.weknora.error, '')
  } finally {
    await new Promise(resolve => server.close(resolve))
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
})

test('provider=weknora 但连不上：主出口失败要抛，不能假装写成功', async () => {
  const { SecretStore, StudioStore } = await import('../src/host/store.js')
  const { syncArtifact } = await import('../src/host/executor.js')
  const dir = mkdtempSync(join(tmpdir(), 'dsh-docsink-fail-'))
  const store = new StudioStore(join(dir, 'state.json'), { dbFile: join(dir, 'state.db'), secrets: new SecretStore(join(dir, '.secrets.json')) })
  try {
    await store.ready
    await store.mutate(state => {
      state.config.docs = sanitizeDocsConfig({ provider: 'weknora', weknora: { baseUrl: 'http://127.0.0.1:1', apiKey: 'k', knowledgeBaseId: 'kb1' } })
      state.requirements.push({ id: 'r1', code: 'REQ-1', title: '需求一' })
      state.tasks.push({
        id: 't1', code: 'DEV-001', title: '卡', type: 'dev', status: 'dev', role: 'dev', requirementId: 'r1',
        checklist: [], comments: [], history: [], cases: [],
        artifacts: [{ id: 'a1', kind: 'design', title: '方案', content: 'x', stage: '', status: 'delivered', at: 0 }],
      })
    })
    await assert.rejects(() => syncArtifact(store, 't1', 'a1'), /WeKnora 入库失败/)
    const card = store.snapshot().tasks.find(item => item.id === 't1')
    assert.match(card.artifacts[0].docs.weknora.error, /建文档失败/)
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
})
