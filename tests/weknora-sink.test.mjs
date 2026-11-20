// WeKnora 出口：配置校验、两步调用（建文档 → reparse）、失败不抛。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { uploadToWeknora, weknoraReady } from '../src/host/weknora-sink.js'

const sink = { baseUrl: 'http://127.0.0.1:1', apiKey: 'k', tenantId: '10000', knowledgeBaseId: 'kb1' }

test('配置校验：缺什么就说缺什么', () => {
  assert.deepEqual(weknoraReady({}), { ok: false, missing: ['baseUrl', 'apiKey', 'knowledgeBaseId'] })
  assert.equal(weknoraReady(sink).ok, true)
})

test('两步调用：先建 manual 文档，再触发 reparse，且带上鉴权头', async () => {
  const seen = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, key: req.headers['x-api-key'], tenant: req.headers['x-tenant-id'], body })
      res.setHeader('Content-Type', 'application/json')
      if (req.url.endsWith('/knowledge/manual')) return res.end(JSON.stringify({ data: { id: 'k-1' } }))
      if (req.url.endsWith('/reparse')) return res.end(JSON.stringify({ success: true }))
      res.statusCode = 404
      res.end('{}')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    const result = await uploadToWeknora({
      sink: { ...sink, baseUrl: `http://127.0.0.1:${port}` },
      title: 'REQ-2026-001 定案',
      markdown: '# 定案\n内容',
    })
    assert.equal(result.ok, true)
    assert.equal(result.knowledgeId, 'k-1')
    assert.equal(result.warning, '')
    assert.equal(seen.length, 2, '建文档 + reparse 各一次')
    assert.equal(seen[0].method, 'POST')
    assert.match(seen[0].url, /\/knowledge-bases\/kb1\/knowledge\/manual$/)
    assert.equal(seen[0].key, 'k')
    assert.equal(seen[0].tenant, '10000')
    assert.equal(JSON.parse(seen[0].body).knowledge_type, 'manual')
    assert.match(seen[1].url, /\/knowledge\/k-1\/reparse$/)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('reparse 失败：文档算写进去了，但要把 warning 说清楚', async () => {
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url.endsWith('/knowledge/manual')) return res.end(JSON.stringify({ data: { id: 'k-2' } }))
      res.statusCode = 500
      res.end(JSON.stringify({ message: 'boom' }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    const result = await uploadToWeknora({ sink: { ...sink, baseUrl: `http://127.0.0.1:${port}` }, title: 't', markdown: 'm' })
    assert.equal(result.ok, true)
    assert.match(result.warning, /需要人工 reparse/)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('没配全 / 连不上：回 error，不抛', async () => {
  const missing = await uploadToWeknora({ sink: {}, title: 't', markdown: 'm' })
  assert.equal(missing.ok, false)
  assert.match(missing.error, /没配全/)
  const down = await uploadToWeknora({ sink: { ...sink, baseUrl: 'http://127.0.0.1:1' }, title: 't', markdown: 'm', timeoutMs: 2000 })
  assert.equal(down.ok, false)
  assert.match(down.error, /建文档失败/)
})
