/* 入站幂等（纯函数）。
 *
 * 为什么需要：评论、用例、交付物这些 POST 都可能被客户端重试（网络抖动、双击、
 * 代理重放）。以前重试就是**真的写两条**——产品定义第 5 条要求「同 Idempotency-Key
 * 连发 2 次 → 评论数 = 1」。
 *
 * 做法很土但够用：把 key 和第一次的响应存进 store 的 side 键（不涨 revision、不占快照），
 * 再来一次同样的 key 就把那份响应原样回放，并带上 x-idempotent-replay 头。
 */

export const IDEMPOTENCY_TTL_MS = 24 * 3600 * 1000
export const IDEMPOTENCY_MAX = 200
export const IDEMPOTENCY_SIDE_KEY = 'idempotency'

/** 只认 8–128 位、字母数字与 . _ : - —— 太短容易撞，太脏会污染 side 键。 */
export function normalizeIdempotencyKey(raw) {
  const value = String(raw ?? '').trim()
  if (value.length < 8 || value.length > 128) return ''
  return /^[A-Za-z0-9._:-]+$/.test(value) ? value : ''
}

/** side 键里存的记录清洗：坏数据一律当没有，别让一条脏记录挡住所有请求。 */
export function sanitizeIdempotencyRecord(raw) {
  const out = {}
  if (raw === null || typeof raw !== 'object') return out
  for (const [key, entry] of Object.entries(raw).slice(0, IDEMPOTENCY_MAX)) {
    if (entry === null || typeof entry !== 'object') continue
    const at = Number(entry.at) || 0
    if (at <= 0) continue
    out[key] = { at, status: Number(entry.status) || 200, body: entry.body ?? null }
  }
  return out
}

/** 过期的丢掉（默认 24 小时）。 */
export function pruneIdempotency(record, now = Date.now(), ttl = IDEMPOTENCY_TTL_MS) {
  const out = {}
  for (const [key, entry] of Object.entries(sanitizeIdempotencyRecord(record))) {
    if (now - entry.at > ttl) continue
    out[key] = entry
  }
  return out
}

/** 命中返回那一份历史响应，没命中返回 null。 */
export function findIdempotent(record, key, now = Date.now()) {
  if (String(key ?? '') === '') return null
  const entry = sanitizeIdempotencyRecord(record)[key]
  if (entry === undefined) return null
  if (now - entry.at > IDEMPOTENCY_TTL_MS) return null
  return entry
}

/** 记一条（同一个 key 重复写入时保留**第一次**的结果，幂等的语义就是"先到的说了算"）。 */
export function rememberIdempotent(record, key, response, now = Date.now()) {
  const out = pruneIdempotency(record, now)
  if (String(key ?? '') === '' || response === null || typeof response !== 'object') return out
  if (out[key] !== undefined) return out
  out[key] = { at: now, status: Number(response.status) || 200, body: response.body ?? null }
  const keys = Object.keys(out)
  if (keys.length > IDEMPOTENCY_MAX) {
    keys.sort((a, b) => out[a].at - out[b].at)
    for (const stale of keys.slice(0, keys.length - IDEMPOTENCY_MAX)) delete out[stale]
  }
  return out
}

/**
 * 并发闸：同一个 key 同一时刻只允许一个请求真正执行。
 *
 * 为什么需要：只有 findIdempotent（查记录）+ rememberIdempotent（事后落记录）时，
 * 两个并发请求都会查空 → 都执行 → 写两条（issue #18：2 并发写 2 条、5 并发写 5 条）。
 * 这个闸在**执行前**先把 key 占住，后来的直接挡回。
 *
 * 只在进程内有效：本插件是单写者（store 有单写者校验），不需要跨进程锁；
 * 进程重启时正在处理的请求本来也一起没了。
 */
export function createIdempotencyGate() {
  const inflight = new Set()
  return {
    /** 抢到了返回 true；别人正在处理返回 false。 */
    claim(scope) {
      const key = String(scope ?? '')
      if (key === '') return true
      if (inflight.has(key)) return false
      inflight.add(key)
      return true
    },
    release(scope) {
      const key = String(scope ?? '')
      if (key !== '') inflight.delete(key)
    },
    get size() {
      return inflight.size
    },
  }
}
