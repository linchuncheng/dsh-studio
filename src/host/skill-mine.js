// 技能沉淀：把一张已经做完的卡上的「真实证据」压成一条可复用的 SKILL.md 草稿。
//
// 为什么不用模型写：仓库里唯一的模型入口是 ctx.agents.create（没有一次性问答 API），
// 而且「让模型总结一张卡」正好是它最会编的地方——总结出来的步骤没人能核对。
// 所以这里只做**可核对**的事：把卡上已经发生过的验收锚点、验证命令、失败、评审意见、
// 改动面原样搬到技能正文里。没有证据的段落直接不写，不补 TODO、不猜步骤。
//
// 产物默认 enabled=false（草稿）：沉淀不等于启用，人看过再启用——启用后专家派单才会注入它。
import { isSkillName, slugifySkill } from './skill-shape.js'

const MAX_LIST = 8

/** 卡片短号：DEV-001 / BUG-002 → dev-001。给技能名一个稳定的兜底。 */
function cardSlug(task) {
  const code = String(task?.code ?? '').trim()
  if (code === '') return 'card'
  return code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** 技能名：优先用调用方给的名字；否则用卡号（标题多是中文，做不出合法 kebab）。 */
export function mineSkillName(task, wanted) {
  const trimmed = String(wanted ?? '').trim().toLowerCase()
  if (isSkillName(trimmed)) return trimmed
  return slugifySkill(`from-${cardSlug(task)}`)
}

/** 一个能跑的用例 → 一行「怎么验」。接口用例写请求，shell 用例写命令。 */
function verificationLine(item) {
  const title = String(item?.title ?? '').trim() || '（未命名用例）'
  const http = item?.http ?? null
  const shell = item?.shell ?? null
  if (http !== null && typeof http === 'object' && String(http.url ?? '').trim() !== '') {
    const status = Number(http.expectStatus) || 0
    const contains = String(http.expectContains ?? '').trim()
    return `${String(http.method ?? 'GET').toUpperCase()} ${http.url}${status > 0 ? ` → ${status}` : ''}${contains === '' ? '' : `，响应含「${contains}」`}（${title}）`
  }
  if (shell !== null && typeof shell === 'object' && String(shell.command ?? '').trim() !== '') {
    const exit = Number(shell.expectExit) || 0
    const contains = String(shell.expectContains ?? '').trim()
    return `\`${shell.command}\` → 退出码 ${exit}${contains === '' ? '' : `，输出含「${contains}」`}（${title}）`
  }
  return null
}

/** 这张卡上真实发生过的坑：阻塞、失败用例、评审要求修改、Agent 失败重试。 */
function pitfalls(task) {
  const out = []
  if (task?.blocked !== null && task?.blocked !== undefined) {
    const reason = String(task.blocked.reason ?? '').trim()
    if (reason !== '') out.push(`卡被阻塞${task.blocked.by ? `（${task.blocked.by}）` : ''}：${reason}`)
  }
  for (const item of (task?.cases ?? []).filter(entry => entry.result === 'fail').slice(0, MAX_LIST)) {
    const note = String(item.note ?? '').trim()
    out.push(`用例「${String(item.title ?? '').trim()}」跑挂了${note === '' ? '' : `：${note.slice(0, 200)}`}`)
  }
  const reviewNote = String(task?.coding?.review?.note ?? '').trim()
  if (String(task?.coding?.review?.status ?? '') === 'changes_requested' && reviewNote !== '') {
    out.push(`代码评审要求修改：${reviewNote.slice(0, 300)}`)
  }
  if (Number(task?.agentFailures) > 0) out.push(`这只 Agent 中途失败过 ${Number(task.agentFailures)} 次（重试前先看它卡在哪一步）`)
  const verified = task?.coding?.verified ?? null
  if (verified !== null && verified !== undefined && verified.ok !== true) {
    const bits = []
    if (verified.branchOk !== true) bits.push(`分支对不上（记录 ${verified.declaredBranch || '?'} / 实际 ${verified.branch || '?'}）`)
    if ((verified.missingCommits ?? []).length > 0) bits.push(`${verified.missingCommits.length} 个自报提交不在分支上`)
    if ((verified.missingFiles ?? []).length > 0) bits.push(`${verified.missingFiles.length} 个自报文件没有实际改动`)
    if (bits.length > 0) out.push(`执行记录和代码对不上：${bits.join('；')}`)
  }
  const quality = task?.quality ?? null
  if (quality !== null && quality.ok !== true) {
    out.push(`项目检查没通过：\`${String(quality.cmd ?? '')}\`（${quality.timedOut === true ? '超时' : `退出码 ${String(quality.exitCode)}`}）`)
  }
  return out
}

/**
 * 从一张卡挖出一条技能草稿。
 *
 * @returns {{ok: true, skill: object, evidence: object} | {ok: false, reason: string}}
 */
export function mineSkillFromCard(state, task, { name, projects } = {}) {
  if (task === undefined || task === null) return { ok: false, reason: '找不到这张卡' }
  const requirement = (state?.requirements ?? []).find(item => item.id === String(task.requirementId ?? ''))
  /* 项目可能只写在需求上（拆卡时项目字段常常是空的）：范围要跟着需求走，
     否则一条只属于某个项目的做法会被当成全局技能，注入到所有项目里。 */
  const projectId = String(task.project ?? '').trim() || String(requirement?.project ?? '').trim()
  const project = (state?.config?.projects ?? []).find(item => item.id === projectId)
  const service = (project?.services ?? []).find(item => item.id === String(task.service ?? ''))
  const cases = Array.isArray(task.cases) ? task.cases : []
  const verifications = cases.map(verificationLine).filter(line => line !== null).slice(0, 12)
  const anchors = []
  for (const point of requirement?.points ?? []) {
    for (const item of point.acceptance ?? []) {
      const text = String(item?.text ?? '').trim()
      if (text !== '') anchors.push(`${point.title}：${text}`)
    }
  }
  const hits = pitfalls(task)
  const files = (task.coding?.files ?? []).map(item => String(item.path ?? '')).filter(path => path !== '').slice(0, 10)

  // 什么证据都没有的卡不许沉淀：那样只会得到一段"看起来很对"的空话。
  const evidence = {
    verifications: verifications.length,
    pitfalls: hits.length,
    anchors: anchors.length,
    files: files.length,
    comments: (task.comments ?? []).length,
  }
  if (verifications.length + hits.length + anchors.length + files.length === 0) {
    return { ok: false, reason: '这张卡上没有可沉淀的证据（没有验收锚点、没有能跑的用例、没有踩坑记录、没有改动文件）——先去把它做完，别凭标题编技能' }
  }

  const title = String(task.title ?? '').trim() || String(task.code ?? task.id)
  const whenToUse = [
    project === undefined ? '' : `在项目「${project.name || project.id}」${service === undefined ? '' : `的 ${service.name || service.id} 服务`}里做同类改动时`,
    requirement === undefined ? '' : `（本技能来自需求「${requirement.title}」）`,
  ].filter(Boolean).join('')
  const scope = Array.isArray(projects) && projects.length > 0
    ? projects.map(String).filter(Boolean).slice(0, 6)
    : (projectId === '' ? [] : [projectId])

  const lines = [`# ${title}`, '']
  lines.push('## 什么时候用', whenToUse === '' ? `做「${title}」这类改动、或要在同一模块再动一次时。` : whenToUse, '')

  if (anchors.length > 0) {
    lines.push('## 验收锚点（来自需求的验收条件，不是推断）', '')
    for (const item of anchors.slice(0, 20)) lines.push(`- ${item}`)
    lines.push('')
  }
  if (verifications.length > 0) {
    lines.push('## 怎么验（这张卡真跑过的）', '')
    verifications.forEach((line, index) => lines.push(`${index + 1}. ${line}`))
    lines.push('')
  }
  if (hits.length > 0) {
    lines.push('## 踩过的坑（都是这张卡上真实发生过的）', '')
    for (const item of hits) lines.push(`- ${item}`)
    lines.push('')
  }
  if (files.length > 0) {
    lines.push('## 改动面', '')
    const branch = String(task.coding?.branch ?? '').trim()
    const commits = (task.coding?.commits ?? []).length
    lines.push(`- 分支${branch === '' ? '（未记录）' : ` \`${branch}\``}${commits > 0 ? ` · ${commits} 次提交` : ''}`)
    for (const path of files) lines.push(`- \`${path}\``)
    lines.push('')
  }
  lines.push('## 出处', '')
  const refs = [`卡 ${String(task.code ?? task.id)}`]
  if (requirement !== undefined) refs.push(`需求 ${String(requirement.code || requirement.id)}`)
  if (task.gitlabMR?.iid > 0) refs.push(`MR !${task.gitlabMR.iid}`)
  lines.push(`- ${refs.join(' · ')}`)
  lines.push(`- 由 ${String(task.coding?.agent ?? '平台')} 的执行记录自动汇总（${new Date().toISOString().slice(0, 10)}），没有人工润色过的推断`)

  const skill = {
    name: mineSkillName(task, name),
    description: `做「${title}」这类改动时的验证步骤与踩坑（来自 ${String(task.code ?? task.id)}）`.slice(0, 300),
    whenToUse: whenToUse === '' ? `做「${title}」这类改动时` : whenToUse.slice(0, 400),
    content: lines.join('\n'),
    tags: [project?.key ?? project?.id ?? 'skill', 'mined'].filter(Boolean).map(tag => String(tag).toLowerCase().slice(0, 30)),
    projects: scope,
    // 草稿：人看过再启用。启用之后才会注入派单提示并落成 SKILL.md。
    enabled: false,
  }
  return { ok: true, skill, evidence }
}
