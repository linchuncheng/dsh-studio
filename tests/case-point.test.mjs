// issue #11 可发现性：用例不写 pointId 就继承卡上的功能点，写了就以自己为准。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { addAssertedCases, configureExecutor } from '../src/host/executor.js'
import { SecretStore, StudioStore } from '../src/host/store.js'

configureExecutor(new Proxy({}, { get: () => () => undefined }))

test('加用例：不填 pointId 继承卡的功能点，填了就以自己为准', async () => {
  const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const dir = mkdtempSync(join(tmpdir(), 'dsh-case-point-'))
  const store = new StudioStore(join(dir, 'state.json'), { dbFile: join(dir, 'state.db'), secrets: new SecretStore(join(dir, '.secrets.json')) })
  try {
    await store.ready
    await store.mutate(state => {
      state.config.testing = { ...(state.config.testing ?? {}), envs: [], defaultEnv: '', allowShell: false, allowDb: false, allowBrowser: false }
      state.tasks.push({
        id: 't-p1', code: 'TEST-001', title: '归属功能点', status: 'test', role: 'qa', pointId: 'p1',
        requirementId: '', checklist: [], artifacts: [], comments: [], history: [], cases: [], blocked: null,
      })
    })
    const result = await addAssertedCases(store, 't-p1', [
      { title: '默认继承', method: 'GET', path: `${base}/a`, expectStatus: 200 },
      { title: '自己指定', method: 'GET', path: `${base}/b`, expectStatus: 200, pointId: 'p2' },
      { title: '带上验收条件', method: 'GET', path: `${base}/c`, expectStatus: 200, acceptanceId: 'a1' },
    ], { by: '测试专家' })
    assert.equal(result.added, 3)
    const cases = store.snapshot().tasks.find(item => item.id === 't-p1').cases
    const byTitle = title => cases.find(item => item.title === title)
    assert.equal(byTitle('默认继承').pointId, 'p1', '不填就继承卡上的功能点')
    assert.equal(byTitle('自己指定').pointId, 'p2', '自己填的不该被覆盖')
    assert.equal(byTitle('带上验收条件').acceptanceId, 'a1', 'acceptanceId 要一起存下来')
    assert.equal(byTitle('带上验收条件').pointId, 'p1')
  } finally {
    store.db?.close?.()
    await new Promise(resolve => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})
