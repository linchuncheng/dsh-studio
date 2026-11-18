import { sanitizeAccess } from '../domain.js'
const INJECTED = ["applyConfig","checkToolAccess","operatorFromSessionId","operatorOf","publicState","readJsonBody","sendJson"]
let host = {
  applyConfig: () => {},
  checkToolAccess: () => {},
  operatorFromSessionId: () => {},
  operatorOf: () => {},
  publicState: () => {},
  readJsonBody: () => {},
  sendJson: () => {},
}
/** 配置、权限成员、审计与快照。宿主能力由 configureAdminRoutes() 注入。 */
export function configureAdminRoutes(services) {
  host = { ...host, ...(services ?? {}) }
}

export async function handleAdminRoute({ method, route, req, res, store, url }) {
if (method === 'POST' && route === '/config') {
  const body = await host.readJsonBody(req)
  /* access 归 /access/save 管：从 /config 传进来会被 mergeConfig 静默丢掉却返回 200
     （这一轮实测踩到）。只针对它给明确报错，其它形状保持原样 —— 面板用的是「直接给配置键」，
     一律拒绝未知顶层键会把「保存角色模板」打成 400。 */
  if (body?.access !== undefined || body?.patch?.access !== undefined) {
    host.sendJson(res, 400, { ok: false, error: '权限名单请用 /access/save（enabled / agents / member），/config 不接受 access' })
    return true
  }
  await host.applyConfig(store, body)
  host.sendJson(res, 200, { ok: true, state: host.publicState(store) })
  return true
}
if (method === 'POST' && route === '/access/save') {
  const body = await host.readJsonBody(req)
  /* 传 {"access":{"enabled":true}} 会 200 但无效 —— 字段名写错就是静默失败。 */
  if (body?.access !== undefined) {
    host.sendJson(res, 400, { ok: false, error: 'enabled / agents / member 要放在顶层，不要包在 access 里' })
    return true
  }
  const member = body.member !== null && typeof body.member === 'object' ? body.member : null
  await store.mutate(state => {
    const access = state.config.access ?? { enabled: false, agents: 'inherit', members: [] }
    const wasEnabled = access.enabled === true
    if (typeof body.enabled === 'boolean') access.enabled = body.enabled
    if (body.agents === 'inherit' || body.agents === 'bypass') access.agents = body.agents
    if (member !== null) {
      const name = String(member.name ?? '').trim()
      if (name !== '') {
        const key = name.toLowerCase()
        const rest = access.members.filter(item => item.name.toLowerCase() !== key)
        access.members = sanitizeAccess({ members: [...rest, member] }).members
      }
    }
    // 刚打开权限时，把现有专家按「成员」自动登记：否则所有 AI 会在下一张卡上被自己人拦死。
    if (wasEnabled !== true && access.enabled === true) {
      const known = new Set(access.members.map(item => item.name.toLowerCase()))
      for (const expert of state.config.experts ?? []) {
        if (expert.enabled === false) continue
        const name = String(expert.name ?? '').trim()
        if (name === '' || known.has(name.toLowerCase())) continue
        known.add(name.toLowerCase())
        access.members.push({ name, role: 'member' })
      }
    }
    state.config.access = access
  })
  host.sendJson(res, 200, { ok: true, access: store.snapshot().config.access, state: host.publicState(store) })
  return true
}
if (method === 'POST' && route === '/access/delete') {
  const body = await host.readJsonBody(req)
  const name = String(body.name ?? '').trim().toLowerCase()
  await store.mutate(state => {
    state.config.access.members = state.config.access.members.filter(item => item.name.toLowerCase() !== name)
  })
  host.sendJson(res, 200, { ok: true, access: store.snapshot().config.access, state: host.publicState(store) })
  return true
}
if (method === 'POST' && route === '/audit/clear') {
  await store.mutate(state => { state.audit = [] })
  host.sendJson(res, 200, { ok: true, state: host.publicState(store) })
  return true
}
if (method === 'POST' && route === '/access/explain') {
  const body = await host.readJsonBody(req)
  const config = store.snapshot().config
  const sessionId = String(body.sessionId ?? '')
  const tool = String(body.tool ?? '')
  const resolved = host.operatorFromSessionId(sessionId, config)
  const who = host.operatorOf(req)
  const operator = resolved ?? { id: who, name: who }
  const verdict = host.checkToolAccess(config, operator, tool)
  host.sendJson(res, 200, {
    ok: true,
    operator,
    tool,
    level: verdict.level,
    allowed: verdict.denial === null,
    reason: verdict.denial ?? '',
    mode: config?.access?.enabled === true ? (config.access.agents ?? 'inherit') : 'off',
  })
  return true
}
if (method === 'GET' && route === '/snapshots') {
  host.sendJson(res, 200, { ok: true, storage: store.describe(), snapshots: store.snapshots() })
  return true
}
if (method === 'POST' && route === '/snapshot/restore') {
  const body = await host.readJsonBody(req)
  await store.restoreSnapshot(String(body.id ?? ''))
  host.sendJson(res, 200, { ok: true, state: host.publicState(store) })
  return true
}
  return false
}
