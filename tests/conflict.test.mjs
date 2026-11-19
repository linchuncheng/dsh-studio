// #5 入站幂等 + #6 请求级版本冲突：这两条是「同一张卡被重复/并发写」时的正确性保证。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { configureExecutor, updateTask, VersionConflictError } from '../src/host/executor.js'
import { SecretStore, StudioStore } from '../src/host/store.js'
import {
  findIdempotent, IDEMPOTENCY_MAX, normalizeIdempotencyKey, pruneIdempotency,
  rememberIdempotent, sanitizeIdempotencyRecord,
} from '../src/host/idempotency.js'

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-studio-conflict-'))
  const store = new StudioStore(join(dir, 'dsh-studio.json'), { dbFile: join(dir, 'dsh-studio.db'), secrets: new SecretStore(join(dir, '.secrets.json')) })
  await store.ready
  await store.mutate(state => {
    state.tasks.push({
      id: 't-conflict1', title: '并发改同一张卡', type: 'requirement', status: 'clarify',
      priority: 'normal', requirementId: '', pointId: '', comments: [], history: [], checklist: [],
      cases: [], artifacts: [], tags: [], links: {}, acceptance: [], dispatch: {},
    })
  })
  return { store, dir }
}

test('#6 版本冲突：两个人基于同一版改同一张卡 → 后一个被拒，并带回当前卡', async () => {
  // 门禁/广播这些注入在 updateTask 里会用到，给个空函数桩。
  configureExecutor(new Proxy({}, { get: () => () => undefined }))
  const { store, dir } = await tempStore()
  try {
    const before = store.snapshot().tasks.find(t => t.id === 't-conflict1')
    const version = Number(before.version) || 0

    const first = await updateTask(store, 't-conflict1', { ifVersion: version, priority: 'urgent', by: '张三' })
    assert.equal(Number(first.version), version + 1, '成功一次，版本 +1')

    // 第二个人手里还是旧版本号
    await assert.rejects(
      () => updateTask(store, 't-conflict1', { ifVersion: version, priority: 'relaxed', by: '李四' }),
      error => {
        assert.ok(error instanceof VersionConflictError, '要抛版本冲突')
        assert.equal(error.code, 'version_conflict', '路由靠这个 code 回 409')
        assert.equal(error.current?.priority, 'urgent', '带回当前卡（已经是别人改后的样子）')
        return true
      },
    )
    assert.equal(store.snapshot().tasks.find(t => t.id === 't-conflict1').priority, 'urgent', '被拒的那次不能写进去')

    // 不带 ifVersion 的老调用方行为不变
    const legacy = await updateTask(store, 't-conflict1', { priority: 'normal', by: '王五' })
    assert.equal(legacy.priority, 'normal')
  } finally {
    // Windows 上 SQLite 的 -wal 句柄没关就删不掉（EBUSY），先 close 再删。
    try { store.db?.close?.() } catch { /* already closed */ }
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(() => {})
  }
})

test('#5 幂等键：格式校验', () => {
  assert.equal(normalizeIdempotencyKey('short'), '', '太短的不认（容易撞）')
  assert.equal(normalizeIdempotencyKey('has space inside'), '', '非法字符不认')
  assert.equal(normalizeIdempotencyKey('a'.repeat(200)), '', '太长不认')
  assert.equal(normalizeIdempotencyKey('abc12345'), 'abc12345')
  assert.equal(normalizeIdempotencyKey('  Key-1.2:3_4  '), 'Key-1.2:3_4', '前后空格会 trim')
})

test('#5 幂等键：同一个 key 只认第一次的响应', () => {
  const now = Date.now()
  let record = {}
  record = rememberIdempotent(record, '/task/comment:abc12345', { status: 200, body: { ok: true, n: 1 } }, now)
  const hit = findIdempotent(record, '/task/comment:abc12345', now + 1000)
  assert.deepEqual(hit?.body, { ok: true, n: 1 })

  // 同一个 key 再来一次：保留第一次（幂等的语义就是"先到的说了算"）
  record = rememberIdempotent(record, '/task/comment:abc12345', { status: 200, body: { ok: true, n: 2 } }, now + 2000)
  assert.equal(findIdempotent(record, '/task/comment:abc12345', now + 3000)?.body.n, 1)

  // 不同 key 互不影响
  assert.equal(findIdempotent(record, '/task/comment:other999', now), null)
})

test('#5 幂等键：24 小时后失效，坏数据当没有', () => {
  const now = Date.now()
  const record = rememberIdempotent({}, 'k:abc12345', { status: 200, body: { ok: true } }, now)
  assert.notEqual(findIdempotent(record, 'k:abc12345', now + 1000), null)
  assert.equal(findIdempotent(record, 'k:abc12345', now + 25 * 3600 * 1000), null, '过期就当没命中')
  assert.deepEqual(pruneIdempotency(record, now + 25 * 3600 * 1000), {}, '过期的会被清掉')
  assert.deepEqual(sanitizeIdempotencyRecord({ bad: null, worse: { at: 0 } }), {}, '脏记录直接跳过')
})

test('#5 幂等键：条数有上限，清最旧的', () => {
  const now = Date.now()
  let record = {}
  for (let i = 0; i < IDEMPOTENCY_MAX + 20; i += 1) {
    record = rememberIdempotent(record, `k:${String(i).padStart(8, '0')}`, { status: 200, body: { i } }, now + i)
  }
  const keys = Object.keys(record)
  assert.equal(keys.length, IDEMPOTENCY_MAX, '不会无限长')
  assert.equal(record['k:00000000'], undefined, '最旧的被清掉')
  assert.notEqual(record[`k:${String(IDEMPOTENCY_MAX + 19).padStart(8, '0')}`], undefined, '最新的还在')
})
