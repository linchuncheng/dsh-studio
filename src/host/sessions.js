/* 登录会话的键：**台账里只存 token 的 SHA-256，不存明文**。
 *
 * 为什么要单独一个模块：会话键被三处用到——内存表（index.js）、HTTP 路由
 * （auth 的退出登录 / exports 的 CSV 下载）与 SQLite（store.js）。三处各自
 * 算 hash 迟早会漂；放这里一份，纯函数，可单测。
 *
 * 兼容：升级前内存表与台账里都是原始 token。findSession 找不到哈希键时会
 * 回退到原始键并顺手迁移到哈希键；store.listSessions 会把老行改写成哈希。
 * 老 token 本身仍然有效（客户端拿着的是原始 token，服务端算 hash 查）。
 */

import { createHash } from 'node:crypto'

/** 64 位十六进制 = 已经是哈希（迁移判定用）。 */
export function looksHashed(token) {
  return /^[0-9a-f]{64}$/.test(String(token ?? ''))
}

/** token → 台账/内存表里的键。空 token 也返回空串（调用方先判空）。 */
export function sessionTokenHash(token) {
  const text = String(token ?? '').trim()
  if (text === '') return ''
  return createHash('sha256').update(text).digest('hex')
}

/** HTTP 层要的别名：同一个函数，名字表达「这是 map 的键」。 */
export function sessionKeyFor(token) {
  return sessionTokenHash(token)
}

/**
 * 从内存表里按原始 token 找会话。
 * - 正常情况：表以哈希为键；
 * - 升级过渡：表里可能还是原始 token 为键，找到后迁到哈希键；
 * - 过期：顺手删掉，返回 null。
 * 返回的 session 对象不包含明文 token（调用方也不需要）。
 */
export function findSession(sessions, token, now = Date.now()) {
  if (sessions === null || sessions === undefined || typeof sessions.get !== 'function') return null
  const raw = String(token ?? '').trim()
  if (raw === '') return null
  const key = sessionTokenHash(raw)
  let session = sessions.get(key)
  if (session === undefined) {
    session = sessions.get(raw)
    if (session !== undefined) {
      /* 旧键迁到新键：删旧、写新，避免同一会话在表里有两份。 */
      sessions.delete(raw)
      sessions.set(key, session)
    }
  }
  if (session === undefined || session === null) return null
  if ((Number(session.expiresAt) || 0) <= now) {
    sessions.delete(key)
    sessions.delete(raw)
    return null
  }
  return session
}
