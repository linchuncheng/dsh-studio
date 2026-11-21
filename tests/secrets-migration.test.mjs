// 批 5：口令哈希不落 state / 快照，只进 0600 密钥文件；老库能迁移，重启能登录。
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { hashLocalPassword, sanitizeLocalAuth, verifyLocalPassword } from '../src/host/domain.js'
import { SecretStore, StudioStore } from '../src/host/store.js'

const openStore = (dir, secrets) => new StudioStore(join(dir, 'state.json'), {
  dbFile: join(dir, 'state.db'),
  secrets: secrets ?? new SecretStore(join(dir, 'secrets.json')),
})

const closeAll = stores => {
  for (const store of stores) {
    try { store?.db?.close?.() } catch { /* 已关闭 */ }
  }
}

const cleanup = dir => rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 80 })

const stateRow = store => JSON.parse(store.db.prepare("SELECT value FROM meta WHERE key = 'state'").get().value)
const lastSnapshot = store => store.db.prepare('SELECT blob FROM snapshots ORDER BY id DESC LIMIT 1').get()?.blob ?? ''
const vaultOf = dir => JSON.parse(readFileSync(join(dir, 'secrets.json'), 'utf8'))

const setPassword = (store, password) => store.mutate(state => {
  state.config.localAuth = {
    ...sanitizeLocalAuth(state.config.localAuth),
    password: hashLocalPassword(password),
    mustChange: false,
  }
})

test('口令哈希：state 与快照不带，密钥文件带；重开后仍能登录', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-studio-localauth-'))
  const stores = []
  try {
    const store = openStore(dir)
    stores.push(store)
    await store.ready
    await setPassword(store, 'newpass-123')

    const saved = stateRow(store)
    assert.equal(saved.config.localAuth.password, null, 'state 里不能留哈希')
    assert.equal(saved.config.localAuth.mustChange, false, '不要让界面误报「默认口令」')
    assert.doesNotMatch(lastSnapshot(store), /"password":\s*\{/, '快照里也不能留哈希')

    const vault = vaultOf(dir)
    assert.equal(typeof vault.localAuth?.hash, 'string', '密钥文件里要有哈希')
    assert.ok(!JSON.stringify(saved).includes(vault.localAuth.hash), '哈希不能同时出现在 state 里')

    const reopened = openStore(dir)
    stores.push(reopened)
    await reopened.ready
    const local = reopened.snapshot().config.localAuth
    assert.equal(typeof local.password?.hash, 'string', '重开后要把哈希补回内存')
    assert.equal(local.mustChange, false)
    assert.equal(verifyLocalPassword(local, 'admin', 'newpass-123').ok, true, '重开后新口令要能登录')
    assert.equal(verifyLocalPassword(local, 'admin', 'admin').ok, false)
  } finally {
    closeAll(stores)
    cleanup(dir)
  }
})

test('老库迁移：state 里已有哈希 + 密钥文件没有 → 下一次落盘迁走且不丢口令', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-studio-localauth-migrate-'))
  const stores = []
  try {
    const store = openStore(dir)
    stores.push(store)
    await store.ready
    await setPassword(store, 'oldpass-123')
    const legacyHash = store.snapshot().config.localAuth.password

    // 模拟升级前：哈希还在 state 里，密钥文件里没有 localAuth
    const saved = stateRow(store)
    saved.config.localAuth.password = legacyHash
    saved.config.localAuth.mustChange = false
    store.db.prepare("UPDATE meta SET value = ? WHERE key = 'state'").run(JSON.stringify(saved))
    const vault = vaultOf(dir)
    delete vault.localAuth
    writeFileSync(join(dir, 'secrets.json'), JSON.stringify(vault))

    const reopened = openStore(dir)
    stores.push(reopened)
    await reopened.ready
    assert.equal(typeof reopened.snapshot().config.localAuth.password?.hash, 'string', '老库的哈希先在内存里')
    await reopened.mutate(state => { state.updatedAt = Date.now() })
    assert.equal(stateRow(reopened).config.localAuth.password, null, '下一次落盘要迁走')
    assert.equal(typeof vaultOf(dir).localAuth?.hash, 'string', '迁进密钥文件')

    const again = openStore(dir)
    stores.push(again)
    await again.ready
    assert.equal(verifyLocalPassword(again.snapshot().config.localAuth, 'admin', 'oldpass-123').ok, true, '迁移后老口令仍能登录')
  } finally {
    closeAll(stores)
    cleanup(dir)
  }
})

test('默认口令：state 与密钥文件都不带哈希，mustChange 仍为 true', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-studio-localauth-default-'))
  const stores = []
  try {
    const store = openStore(dir)
    stores.push(store)
    await store.ready
    await store.mutate(state => { state.updatedAt = Date.now() })
    const saved = stateRow(store)
    assert.equal(saved.config.localAuth.password, null)
    assert.equal(saved.config.localAuth.mustChange, true)
    assert.equal(vaultOf(dir).localAuth, null)

    const reopened = openStore(dir)
    stores.push(reopened)
    await reopened.ready
    assert.equal(reopened.snapshot().config.localAuth.password, null)
    assert.equal(reopened.snapshot().config.localAuth.mustChange, true)
  } finally {
    closeAll(stores)
    cleanup(dir)
  }
})

test('密钥文件写失败时：哈希留在 state 里，不能为了「干净」把口令弄丢', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-studio-localauth-fail-'))
  const stores = []
  try {
    const failing = {
      load: async () => ({ gitlab: {}, feishu: {}, ldap: {}, legacy: {}, localAuth: null }),
      replace: async () => { throw new Error('disk full') },
    }
    const store = openStore(dir, failing)
    stores.push(store)
    await store.ready
    await setPassword(store, 'keepme-123')
    assert.equal(typeof stateRow(store).config.localAuth.password?.hash, 'string', '密钥写失败就必须把哈希留在 state')
  } finally {
    closeAll(stores)
    cleanup(dir)
  }
})
