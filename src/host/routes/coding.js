import { CODING_REVIEW_STATUS, cleanId, mergeCoding, sanitizeCoding } from '../domain.js'
import { isSelfReview, reviewDecision } from '../quality.js'
import { clearAgentFailure, noteAgentFailure } from '../dispatcher.js'
import { codingVerifyLine, qualitySummary, runCommand, runTaskQuality, taskExitGate, verifyCodingRecord } from '../executor.js'
import { compareCodingFacts } from '../gitlab-facts.js'
import { mergeGateFor } from '../merge-gate.js'
import { rejectUnknownFields } from '../route-contract.js'
const INJECTED = ["applyConfig","ensureWorktree","mergeMergeRequest","publicState","publishMergeGate","readJsonBody","removeWorktree","sendJson","serviceOf","upsertById","workProjectOf"]
let host = {
  applyConfig: () => {},
  ensureWorktree: () => {},
  mergeMergeRequest: async () => ({}),
  publicState: () => {},
  publishMergeGate: async () => ({}),
  readJsonBody: () => {},
  removeWorktree: () => {},
  sendJson: () => {},
  serviceOf: () => {},
  upsertById: () => {},
  workProjectOf: () => {},
}
/** 执行记录核对、Agent 失败重试、worktree 与项目配置。宿主能力由 configureCodingRoutes() 注入。 */
export function configureCodingRoutes(services) {
  host = { ...host, ...(services ?? {}) }
}

export async function handleCodingRoute({ method, route, req, res, store, url }) {
if (method === 'POST' && route === '/coding/gitlab') {
  // 从 GitLab 核对：拉 MR + changes，和卡上自报的文件数/提交数比一遍，结果记进 coding.gitlab。
  const body = await host.readJsonBody(req)
  const id = String(body.id ?? '')
  const snapshot = store.snapshot()
  const task = snapshot.tasks.find(t => t.id === id)
  if (task === undefined) throw new Error(`no task ${id}`)
  const iid = Number(task.gitlabMR?.iid ?? 0)
  if (iid <= 0) throw new Error('这张卡还没关联 MR：先提 MR，把 !iid 填进卡片的 GitLab 区块')
  const config = snapshot.config
  const projects = config.gitlab?.projects ?? []
  const project = projects.find(item => item.id === task.gitlabProject) ?? projects[0]
  if (project === undefined) throw new Error('还没配 GitLab 项目（设置 → 代码仓库）')
  const mr = await host.gitlabRequest(config, project, `/merge_requests/${iid}`)
  const detail = await host.gitlabMergeRequestDetail(config, project, iid)
  const facts = compareCodingFacts(task.coding, mr, detail)
  await store.mutate(state => {
    const target = state.tasks.find(t => t.id === id)
    if (target === undefined) return
    target.coding = { ...(target.coding ?? {}), gitlab: facts }
    target.updatedAt = Date.now()
  })
  host.sendJson(res, 200, { ok: true, facts, state: host.publicState(store) })
  return true
}
if (method === 'POST' && route === '/task/coding') {
  const body = await host.readJsonBody(req)
  const id = String(body.id ?? '')
  const action = String(body.action ?? 'update')
  const by = String(body.by ?? '人').slice(0, 40)
  const snapshot = await store.mutate(state => {
    const task = state.tasks.find(t => t.id === id)
    if (task === undefined) throw new Error(`no task ${id}`)
    if (action === 'clear') {
      task.coding = null
    } else if (action === 'review') {
      const base = sanitizeCoding(task.coding ?? {})
      /* 与 studio_task_coding 工具同一套规则：不传结论 → pending；作者不能给自己盖"通过"。
         以前这里默认 approved，面板点一下"评审通过"就完事，评审形同虚设。 */
      /* 两个入参都认：HTTP 一直用 status，工具用 reviewStatus；传错那个以前返回 200 但落库仍是 pending（issue #13）。 */
    const wanted = body.status ?? body.reviewStatus
    if (wanted === undefined || String(wanted).trim() === '') {
      throw new Error('评审要给结论：status 或 reviewStatus（approved / changes_requested / pending）')
    }
    if (!CODING_REVIEW_STATUS.includes(String(wanted).trim())) {
      throw new Error(`评审结论「${String(wanted)}」不认识：只认 ${CODING_REVIEW_STATUS.join(' / ')}`)
    }
    const status = reviewDecision(wanted, CODING_REVIEW_STATUS)
      const author = String(base.agent ?? '').trim()
      if (status === 'approved' && isSelfReview(author, by)) {
        throw new Error(`不能自评：这份执行记录的作者是「${author}」，评审人也是「${by}」。让另一个专家评审`)
      }
      task.coding = sanitizeCoding({
        ...base,
        review: { status, by, at: Date.now(), note: String(body.note ?? '').slice(0, 600) },
      })
    } else if (action === 'merge') {
      // 与工具同一条判据：门禁没过不许自报「已合并」。
      const gate = mergeGateFor(state, task)
      if (gate.ready !== true) throw new Error(`合并门禁没过：${gate.blockers.join('；')}`)
      const base = sanitizeCoding(task.coding ?? {})
      task.coding = sanitizeCoding({ ...base, mergedBy: by, mergedAt: Date.now() })
    } else {
      const patch = body.coding ?? body.patch ?? body
      task.coding = mergeCoding(task.coding ?? null, patch)
    }
    task.updatedAt = Date.now()
    return task
  })
  const task = snapshot.tasks.find(entry => entry.id === id)
  host.sendJson(res, 200, { ok: true, task, state: host.publicState(store) })
  return true
}
if (method === 'POST' && route === '/task/coding/verify') {
  // 拿 worktree 里的 git 事实核对执行记录：agent 说改了哪些提交/文件，真的在分支上吗。
  const body = await host.readJsonBody(req)
  const id = String(body.id ?? '')
  const current = store.snapshot().tasks.find(entry => entry.id === id)
  if (current === undefined) throw new Error(`no task ${id}`)
  const report = await verifyCodingRecord(store.snapshot(), current)
  if (report.skipped === undefined) {
    await store.mutate(state => {
      const task = state.tasks.find(entry => entry.id === id)
      if (task !== undefined && task.coding !== null && task.coding !== undefined) {
        task.coding = sanitizeCoding({ ...task.coding, verified: report })
      }
      return task
    })
  }
  const state = store.snapshot()
  const task = state.tasks.find(entry => entry.id === id)
  host.sendJson(res, 200, {
    ok: true,
    report,
    line: codingVerifyLine(report),
    gate: taskExitGate(state, task),
    task,
    state: host.publicState(store),
  })
  return true
}
if (method === 'POST' && route === '/task/agent/fail') {
  // 记一次 AI 失败（真失败时由派单器调用；也可由 agent 自己上报）。
  const body = await host.readJsonBody(req)
  const id = String(body.id ?? '')
  const plan = await noteAgentFailure(store, id, String(body.error ?? 'AI 没有完成这一轮'), String(body.by ?? '系统').slice(0, 60))
  if (plan === undefined) throw new Error(`no task ${id}`)
  const state = store.snapshot()
  const task = state.tasks.find(entry => entry.id === id)
  host.sendJson(res, 200, { ok: true, plan, task, gate: taskExitGate(state, task), state: host.publicState(store) })
  return true
}
if (method === 'POST' && route === '/task/agent/retry') {
  const body = await host.readJsonBody(req)
  const id = String(body.id ?? '')
  const changed = await clearAgentFailure(store, id, String(body.by ?? '人').slice(0, 60))
  if (!changed) throw new Error(`no task ${id}`)
  /* 光清失败计数不够：tick() 见到 dispatch.status === task.status 就跳过，
     所以「重新派单」以前是个假按钮 —— 提示"下一轮自动接手"，实际永不重派。
     这里把派单印记一起清掉，下一次 tick 才会真的重新派。 */
  await store.mutate(state => {
    const task = state.tasks.find(entry => entry.id === id)
    if (task !== undefined) task.dispatch = null
  })
  const state = store.snapshot()
  const task = state.tasks.find(entry => entry.id === id)
  host.sendJson(res, 200, { ok: true, task, state: host.publicState(store) })
  return true
}
if (method === 'POST' && route === '/task/worktree') {
  const body = await host.readJsonBody(req)
  const id = String(body.id ?? '')
  const action = String(body.action ?? 'create')
  const snapshotNow = store.snapshot()
  const task = snapshotNow.tasks.find(entry => entry.id === id)
  if (task === undefined) throw new Error(`no task ${id}`)
  if (action === 'remove') {
    const result = await host.removeWorktree(store, task, snapshotNow.config)
    host.sendJson(res, 200, { ok: result.ok, result, state: host.publicState(store) })
    return true
  }
  if (action === 'list') {
    // 纯读：列 worktree 不改库，不该推 revision（issue #17）
    req.__studioReadOnly = true
    const service = host.serviceOf(snapshotNow.config, task)
    const project = host.workProjectOf(snapshotNow.config, task)
    const repo = String(service?.repoPath ?? project?.repoPath ?? '').trim()
    const listed = repo.length === 0
      ? { ok: false, stdout: '', stderr: '项目没配本机代码目录' }
      : await runCommand('git', ['-C', repo, 'worktree', 'list', '--porcelain'], 20000)
    host.sendJson(res, 200, { ok: listed.ok, output: String(listed.stdout ?? ''), error: String(listed.stderr ?? ''), state: host.publicState(store) })
    return true
  }
  const info = await host.ensureWorktree(store, task, snapshotNow.config)
  host.sendJson(res, 200, {
    ok: info?.path !== undefined,
    worktree: info ?? null,
    skipped: info?.skipped ?? '',
    state: host.publicState(store),
  })
  return true
}
if (method === 'POST' && route === '/task/merge') {
  /* 真的去 GitLab 合并：门禁在服务端判，没过就拒绝。
     GitLab CE 没有「外部状态检查」，提交状态只是可见记录 —— 要让门禁生效，合并必须由平台执行。 */
  const body = await host.readJsonBody(req)
  rejectUnknownFields('/task/merge', body)
  try {
    const merged = await host.mergeMergeRequest(store, String(body.id ?? ''), { by: String(body.by ?? '人').slice(0, 40) })
    host.sendJson(res, 200, { ok: true, merge: merged, state: host.publicState(store) })
  } catch (error) {
    host.sendJson(res, 400, { ok: false, error: String(error?.message ?? error).slice(0, 300) })
  }
  return true
}
if (method === 'POST' && route === '/task/merge-gate') {
  // 合并门禁：算一次「能不能合」，并把结论发成 GitLab 提交状态（仓库开了「状态检查必须通过」时这就是合并按钮）。
  const body = await host.readJsonBody(req)
  rejectUnknownFields('/task/merge-gate', body)
  const id = String(body.id ?? '')
  if (body.publish === false) {
    // 只出结论不发状态：没配 GitLab 的机器也能验门禁本身（自检脚本走这条路）。
    const snapshot = store.snapshot()
    const task = snapshot.tasks.find(entry => entry.id === id)
    if (task === undefined) throw new Error(`no task ${id}`)
    host.sendJson(res, 200, { ok: true, gate: mergeGateFor(snapshot, task), mergeGate: task.mergeGate ?? null, published: false })
    return true
  }
  try {
    const result = await host.publishMergeGate(store, id, { by: String(body.by ?? '人').slice(0, 40) })
    host.sendJson(res, 200, { ok: true, gate: result.gate, mergeGate: result.status, published: true, state: host.publicState(store) })
  } catch (error) {
    // 没配 GitLab / 没有 MR / 发不出去：都是「做不了」，用 400 说清原因，别让面板只看到 500
    host.sendJson(res, 400, { ok: false, error: String(error?.message ?? error).slice(0, 300) })
  }
  return true
}
if (method === 'POST' && route === '/task/quality') {
  // 项目检查：在这个项目/服务的代码目录（有 worktree 就用 worktree）里跑一次质量命令，
  // 结果写回卡片，准出会按它拦。触发方式：卡片抽屉的「跑一次」，或专家调 studio_task_quality。
  const body = await host.readJsonBody(req)
  const id = String(body.id ?? '')
  const result = await runTaskQuality(store, id, { by: String(body.by ?? '人').slice(0, 40) })
  const snapshot = store.snapshot()
  host.sendJson(res, 200, {
    ok: true,
    quality: result.quality,
    summary: qualitySummary(snapshot, result.task),
    gate: taskExitGate(snapshot, result.task),
    state: host.publicState(store),
  })
  return true
}
if (method === 'POST' && route === '/projects/save') {
  const body = await host.readJsonBody(req)
  const incoming = body.project ?? body
  if (String(incoming.name ?? '').trim() === '') throw new Error('项目名称不能为空')
  const existing = store.snapshot().config.projects
  const wantedId = cleanId(incoming.id ?? incoming.name ?? incoming.key, 'proj')
  const saved = existing.find(item => item.id === wantedId)
  const merged = { ...incoming, id: wantedId, iterations: incoming.iterations ?? saved?.iterations ?? [] }
  await host.applyConfig(store, { projects: host.upsertById(existing, merged) })
  host.sendJson(res, 200, { ok: true, projects: store.snapshot().config.projects, state: host.publicState(store) })
  return true
}
if (method === 'POST' && route === '/projects/delete') {
  const body = await host.readJsonBody(req)
  const id = cleanId(body.id, 'proj')
  /* 不存在就报错：以前删不掉的也回 200 ok:true，调用方以为删了（issue #16）。 */
  const existing = store.snapshot().config.projects
  if (!existing.some(entry => entry.id === id)) throw new Error(`no project ${id}`)
  await host.applyConfig(store, { projects: existing.filter(entry => entry.id !== id) })
  host.sendJson(res, 200, { ok: true, state: host.publicState(store) })
  return true
}
if (method === 'POST' && route === '/projects/iteration') {
  const body = await host.readJsonBody(req)
  const action = String(body.action ?? 'save')
  const projectId = cleanId(body.project, 'proj')
  const projects = store.snapshot().config.projects.map(project => {
    if (project.id !== projectId) return project
    if (action === 'remove') {
      return { ...project, iterations: project.iterations.filter(item => item.id !== cleanId(body.iteration, 'iter')) }
    }
    const wantedId = cleanId(body.iteration ?? body.name, 'iter')
    const saved = project.iterations.find(item => item.id === wantedId)
    const merged = {
      ...saved,
      id: wantedId,
      name: String(body.name ?? saved?.name ?? wantedId).slice(0, 60),
      start: Number(body.start ?? saved?.start) || 0,
      due: Number(body.due ?? saved?.due) || 0,
      status: ['planned', 'active', 'closed'].includes(String(body.status)) ? String(body.status) : (saved?.status ?? 'planned'),
    }
    return { ...project, iterations: host.upsertById(project.iterations, merged) }
  })
  await host.applyConfig(store, { projects })
  host.sendJson(res, 200, { ok: true, state: host.publicState(store) })
  return true
}
  return false
}
