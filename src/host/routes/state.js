// /state 的 HTTP 层：数据 + ETag/304。
//
// 为什么要单独一层：上千张卡时整包状态 1~2 MB，前端 15 秒轮询一次、每次都重传，
// 而绝大多数轮询拿到的东西和上一次一模一样。用 ETag（数据版本 + 谁在看）挡住重复正文：
// 没变就回 304，一个字节都不发；变了才给整包。
//
// 单独成模块还有个好处：这段逻辑能用假 req/res 单测，不用起整个 dsh 宿主。

import { createHash } from 'node:crypto'

const INJECTED = ['publicState', 'getDispatcher', 'sendJson']
let host = {
  publicState: () => ({}),
  getDispatcher: () => undefined,
  sendJson: () => {},
}

/** 宿主能力由 configureStateRoutes() 注入（跟其它 routes/*.js 一个套路）。 */
export function configureStateRoutes(services) {
  host = { ...host, ...(services ?? {}) }
}

/**
 * ETag = 数据版本 + 观察者。版本变了一定要重发；不同的人可见范围不同，不能共用一份缓存。
 * 观察者来自统一登录写下的 req.studioActor（没登录就是空串，所有人共用一版）。
 */
export function stateEtag(revision, viewer) {
  // 名字要哈希：中文名直接过滤成下划线的话，两个人会拿到同一个 ETag。
  const name = String(viewer ?? '').trim()
  const who = name === '' ? 'anon' : createHash('sha1').update(name).digest('hex').slice(0, 10)
  return 'W/"' + String(Number(revision) || 0) + '-' + who + '"'
}

/** GET /state（和 `/`）：带 ETag，命中就 304。返回 true 表示这个请求已处理。 */
export function handleStateRoute({ method, route, req, res, store }) {
  if (method !== 'GET' || (route !== '/' && route !== '/state')) return false
  const dispatcher = host.getDispatcher()
  const state = host.publicState(store)
  const body = dispatcher === undefined ? { ok: true, state } : { ok: true, state: { ...state, agents: dispatcher.status() } }
  const etag = stateEtag(body.state?.revision, req?.studioActor ?? '')
  const asked = String(req?.headers?.['if-none-match'] ?? '')
  if (asked !== '' && asked === etag) {
    if (typeof res?.writeHead === 'function') res.writeHead(304, { etag, 'cache-control': 'no-cache' })
    else if (typeof res?.setHeader === 'function') res.setHeader('etag', etag)
    res?.end?.()
    return true
  }
  if (typeof res?.setHeader === 'function') {
    res.setHeader('etag', etag)
    res.setHeader('cache-control', 'no-cache')
  }
  host.sendJson(res, 200, body)
  return true
}
