// 批 6：会话 token 不落明文——台账只存 SHA-256，内存表按哈希键查找，旧数据自动迁移。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { findSession, looksHashed, sessionTokenHash } from '../src/host/sessions.js'
import { verifyLocalPassword } from '../src/host/domain.js'
import { SecretStore, StudioStore } from '../src/host/store.js'
import { configureAuthRoutes, handleAuthRoute } from '../src/host/routes/auth.js'

const openStore = dir => new StudioStore(join(dir, 'state.json'), {
  dbFile: join(dir, 'state.db'),
  secrets: new SecretStore(join(dir, 'secrets.json')),
})

test('session 键：hash 固定 64 位十六进制，旧 token 不算 hash', () => {
  const raw = 'abc123'
  assert.match(sessionTokenHash(raw), /^[0-9a-f]{64}$/)
  assert.equal(sessionTokenHash(raw), sessionTokenHash(raw), '同 token 必须同键')
  assert.notEqual(sessionTokenHash(raw), sessionTokenHash('abc124'))
  assert.equal(sessionTokenHash(''), '')
  assert.equal(looksHashed(sessionTokenHash(raw)), true)
  assert.equal(looksHashed(raw), false)
})

test('findSession：按原始 token 查到哈希键；旧键自动迁移；过期顺手删', () => {
  const raw = 'tok-1'
  const key = sessionTokenHash(raw)
  const sessions = new Map([[key, { name: '张三', expiresAt: Date.now() + 60_000 }]])
  assert.equal(findSession(sessions, raw)?.name, '张三')

  // 升级过渡：表里还是原始 token 为键
  const legacy = new Map([[raw, { name: '李四', expiresAt: Date.now() + 60_000 }]])
  assert.equal(findSession(legacy, raw)?.name, '李四')
  assert.equal(legacy.has(raw), false, '旧键要迁走')
  assert.equal(legacy.get(key)?.name, '李四')

  // 过期：返回 null 并从表里删掉
  const expired = new Map([[key, { name: '王五', expiresAt: 1 }]])
  assert.equal(findSession(expired, raw), null)
  assert.equal(expired.size, 0)
  assert.equal(findSession(new Map(), raw), null)
})

test('store：session 行只存哈希，明文 token 不在库里；drop/clear 都按哈希', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-studio-session-'))
  try {
    const store = openStore(dir)
    await store.ready
    const raw = 'token-that-must-not-land'
    store.saveSession({ token: raw, userId: 'admin', name: '超管', role: 'admin', source: 'local', at: Date.now(), expiresAt: Date.now() + 60_000, ip: '127.0.0.1' })
    const rows = store.db.prepare('SELECT token FROM sessions').all()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].token, sessionTokenHash(raw), '库里必须是哈希')
    assert.ok(!JSON.stringify(rows).includes(raw), '明文 token 不能出现在 session 表')

    const listed = store.listSessions()
    assert.equal(listed.length, 1)
    assert.equal(listed[0].token, sessionTokenHash(raw))
    assert.equal(listed[0].userId, 'admin')

    store.dropSession(raw)
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0)

    store.saveSession({ token: 'a2', userId: 'u', name: 'u', role: 'member', source: 'ldap', at: Date.now(), expiresAt: Date.now() + 60_000, ip: '' })
    store.clearSessions()
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0)
    store.db?.close?.()
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 80 })
  }
})

test('store：升级前明文 token 行在 listSessions 时迁成哈希，原 token 仍可查', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-studio-session-migrate-'))
  try {
    const store = openStore(dir)
    await store.ready
    const raw = 'legacy-plain-token'
    store.db.prepare('INSERT INTO sessions (token, user_id, name, role, source, at, expires_at, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(raw, 'admin', '超管', 'admin', 'local', Date.now(), Date.now() + 60_000, '')
    const listed = store.listSessions()
    assert.equal(listed[0].token, sessionTokenHash(raw))
    const rows = store.db.prepare('SELECT token FROM sessions').all()
    assert.ok(!rows.some(row => row.token === raw), '迁移后不能留着明文行')
    assert.ok(rows.some(row => row.token === sessionTokenHash(raw)))
    store.db?.close?.()
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 80 })
  }
})

test('auth：改口令会吊销全部会话，且新口令能校验通过', async () => {
  const state = {
    config: {
      localAuth: { enabled: true, username: 'admin', password: null, mustChange: true, updatedAt: 0 },
      users: [],
    },
  }
  const store = {
    snapshot: () => state,
    mutate: async fn => { fn(state); return state },
  }
  const sessions = new Map([['hash-key', { expiresAt: Date.now() + 60_000 }]])
  let cleared = 0
  let sent = null
  configureAuthRoutes({
    readJsonBody: async () => ({ currentPassword: 'admin', newPassword: 'newpass-123' }),
    sendJson: (_res, code, body) => { sent = { code, body } },
    recordAudit: async () => {},
    sessions,
    sessionKeyFor: sessionTokenHash,
    clearSessions: () => { cleared += 1; sessions.clear() },
    publicState: () => ({}),
  })
  const handled = await handleAuthRoute({
    method: 'POST', route: '/auth/password', req: {}, res: {}, store,
    url: new URL('http://localhost/auth/password'),
  })
  assert.equal(handled, true)
  assert.equal(sent.code, 200)
  assert.equal(cleared, 1, '改口令必须吊销旧会话')
  assert.equal(sessions.size, 0)
  assert.equal(verifyLocalPassword(state.config.localAuth, 'admin', 'newpass-123').ok, true)
  assert.equal(verifyLocalPassword(state.config.localAuth, 'admin', 'admin').ok, false)
})

test('auth：退出登录按哈希删会话（原始 token 进、哈希键出）', async () => {
  const raw = 'logout-raw-token'
  const sessions = new Map([[sessionTokenHash(raw), { expiresAt: Date.now() + 60_000 }]])
  let dropped = ''
  configureAuthRoutes({
    readJsonBody: async () => ({}),
    sendJson: () => {},
    recordAudit: async () => {},
    sessions,
    sessionKeyFor: sessionTokenHash,
    hasSessionStore: () => true,
    dropSession: token => { dropped = token },
  })
  await handleAuthRoute({
    method: 'POST', route: '/auth/logout', req: { headers: { 'x-studio-session': raw } }, res: {},
    url: new URL('http://localhost/auth/logout'), store: { snapshot: () => ({ config: {} }) },
  })
  assert.equal(sessions.size, 0)
  assert.equal(dropped, raw, 'store 层拿原始 token 自己算 hash')
})
