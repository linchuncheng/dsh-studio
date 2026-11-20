// 设计评审（一期）：卡上的设计状态 + 「进开发前必须评审过」的闸门。纯函数，方便单测。

export const DESIGN_STATUS = ['pending', 'approved', 'changes_requested']

/** 一张卡最多放这么多稿：再多就不是"对比"，是没人看得完的清单。 */
export const DESIGN_DRAFT_LIMIT = 8

/** 一稿：名字 + 链接（或封面图）+ 一句说明。没名字按序号兜底，没链接也没图就不算一稿。 */
function sanitizeDraft(raw, index) {
  if (raw === null || typeof raw !== 'object') return undefined
  const link = String(raw.link ?? raw.url ?? '').trim().slice(0, 500)
  const image = String(raw.image ?? '').trim().slice(0, 500)
  if (link === '' && image === '') return undefined
  return {
    id: String(raw.id ?? '').trim().slice(0, 24) || `d${index + 1}`,
    name: String(raw.name ?? '').trim().slice(0, 60) || `第 ${index + 1} 稿`,
    link,
    image,
    note: String(raw.note ?? '').slice(0, 300),
    by: String(raw.by ?? '').slice(0, 40),
    at: Number(raw.at) || 0,
  }
}

/**
 * 多稿列表。
 * 老数据只有 `design.link`：升级时把它当成唯一的「原稿」，否则一升级所有已通过评审的卡
 * 都会因为「没稿可定」被挡在开发之外。只在 **drafts 字段根本不存在** 时才合成——
 * 人手动清空成 [] 就是清空，不该被复活。
 */
export function sanitizeDrafts(input, legacyLink) {
  const list = Array.isArray(input) ? input.slice(0, DESIGN_DRAFT_LIMIT) : []
  const out = []
  for (const [index, raw] of list.entries()) {
    const draft = sanitizeDraft(raw, index)
    if (draft === undefined || out.some(item => item.id === draft.id)) continue
    out.push(draft)
  }
  if (out.length === 0 && Array.isArray(input) !== true && String(legacyLink ?? '').trim() !== '') {
    out.push({ id: 'd1', name: '原稿', link: String(legacyLink).trim().slice(0, 500), image: '', note: '', by: '', at: 0 })
  }
  return out
}

/** 设计区：多稿、定案、评审状态、评审意见。没填过就是 null。 */
export function sanitizeDesign(raw) {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null
  const status = DESIGN_STATUS.includes(String(raw.status ?? '')) ? String(raw.status) : 'pending'
  const link = String(raw.link ?? '').trim().slice(0, 500)
  const drafts = sanitizeDrafts(raw.drafts, link)
  const wanted = String(raw.chosenId ?? '').trim()
  // 定案必须指向真实存在的一稿；只有一稿时不用再点一次「选为定案」（哪怕传了过期的 id）。
  const chosenId = drafts.some(item => item.id === wanted)
    ? wanted
    : (drafts.length === 1 ? drafts[0].id : '')
  return {
    link,
    /** 多稿对比：每稿一条，`chosenId` 指向定案的那一稿。 */
    drafts,
    chosenId,
    status,
    note: String(raw.note ?? '').slice(0, 500),
    by: String(raw.by ?? '').slice(0, 40),
    at: Number(raw.at) || 0,
    // 设计还原度：tools/visual/design-diff.mjs 算出来的差异百分比（0 = 一模一样）。
    diff: raw.diff === null || raw.diff === undefined || typeof raw.diff !== 'object'
      ? null
      : {
        percent: Math.min(100, Math.max(0, Number(raw.diff.percent) || 0)),
        url: String(raw.diff.url ?? '').slice(0, 500),
        at: Number(raw.diff.at) || 0,
        by: String(raw.diff.by ?? '').slice(0, 40),
      },
    // 还原度历史：最近 10 次。只留最新一次看不出「是在变好还是变坏」。
    diffHistory: (Array.isArray(raw.diffHistory) ? raw.diffHistory : [])
      .filter(item => item !== null && typeof item === 'object')
      .slice(0, 10)
      .map(item => ({
        percent: Math.min(100, Math.max(0, Number(item.percent) || 0)),
        url: String(item.url ?? '').slice(0, 500),
        at: Number(item.at) || 0,
        by: String(item.by ?? '').slice(0, 40),
      })),
    // 设计规范体检（design-audit.mjs）的结果摘要：查了多少元素、几处野值、最扎眼的前三条。
    spec: raw.spec === null || raw.spec === undefined || typeof raw.spec !== 'object'
      ? null
      : {
        checked: Math.max(0, Number(raw.spec.checked) || 0),
        violations: Math.max(0, Number(raw.spec.violations) || 0),
        at: Number(raw.spec.at) || 0,
        by: String(raw.spec.by ?? '').slice(0, 40),
        top: (Array.isArray(raw.spec.top) ? raw.spec.top : []).slice(0, 5).map(item => ({
          kind: String(item?.kind ?? '').slice(0, 20),
          value: String(item?.value ?? '').slice(0, 40),
          count: Math.max(0, Number(item?.count) || 0),
          // 谁在用这个值：修的时候不用再翻 DOM。
          sample: String(item?.sample ?? '').slice(0, 120),
        })),
      },
  }
}

/** 新的还原度插到最前面；和上一条完全一样就不重复记（重复跑同一次截图不该刷屏）。 */
export function pushDiffHistory(history, entry) {
  const list = (Array.isArray(history) ? history : []).filter(item => item !== null && typeof item === 'object')
  const next = { percent: Math.min(100, Math.max(0, Number(entry?.percent) || 0)), url: String(entry?.url ?? '').slice(0, 500), at: Number(entry?.at) || Date.now(), by: String(entry?.by ?? '').slice(0, 40) }
  const last = list[0]
  if (last !== undefined && last.percent === next.percent && last.url === next.url) return list.slice(0, 10)
  return [next, ...list].slice(0, 10)
}

/** 还原度低于这个值就算没还原。 */
export const FIDELITY_TARGET = 95

/**
 * 把还原度写进验收清单：找到「设计还原度」那一行就更新，没有就补一行。
 * 低于 FIDELITY_TARGET 就留成未勾——验收时人一眼能看到差在哪。
 */
export function applyFidelityItem(checklist, percent) {
  const list = Array.isArray(checklist) ? checklist : []
  const score = Math.max(0, 100 - (Number(percent) || 0))
  const text = `设计还原度 ≥ ${FIDELITY_TARGET}%（当前 ${score.toFixed(1)}%）`
  const index = list.findIndex(item => String(item?.text ?? '').startsWith('设计还原度'))
  const item = { id: index >= 0 ? list[index].id : `k-fidelity-${Date.now().toString(36)}`, text, done: score >= FIDELITY_TARGET }
  if (index >= 0) list[index] = { ...list[index], ...item }
  else list.push(item)
  return list
}

/** 把规范体检结果写进验收清单：0 处才勾，有野值就留成待复核并列出前两条。 */
export function applySpecItem(checklist, spec) {
  const list = Array.isArray(checklist) ? checklist : []
  const count = Math.max(0, Number(spec?.violations) || 0)
  const top = (Array.isArray(spec?.top) ? spec.top : []).slice(0, 2).map(item => `${item.value}×${item.count}`).join('、')
  const text = count === 0
    ? '设计规范体检：没有野值'
    : `设计规范体检：${count} 处待复核${top === '' ? '' : `（${top}）`}`
  const index = list.findIndex(item => String(item?.text ?? '').startsWith('设计规范体检'))
  const item = { id: index >= 0 ? list[index].id : `k-spec-${Date.now().toString(36)}`, text, done: count === 0 }
  if (index >= 0) list[index] = { ...list[index], ...item }
  else list.push(item)
  return list
}

/**
 * 进开发前的闸门：只有开了开关、且目标列在 columns 里才拦。
 * 返回 { needed, ready, blockers }；override 在调用方处理（填了原因就放行）。
 */
export function designGate(config, task, nextStatus) {
  const design = config?.design ?? {}
  const columns = Array.isArray(design.columns) && design.columns.length > 0 ? design.columns : ['dev']
  const needed = design.enabled === true && columns.includes(String(nextStatus ?? ''))
  if (needed !== true) return { needed: false, ready: true, blockers: [] }
  const state = String(task?.design?.status ?? '')
  if (state === 'approved') {
    /* 「评审通过」不等于「定案」：多稿的项目里最常见的翻车是评审说"这几稿都行"，
       结果研发照着错的那稿做。所以通过之后还必须指认一稿。 */
    const drafts = Array.isArray(task?.design?.drafts) ? task.design.drafts : []
    const chosenId = String(task?.design?.chosenId ?? '')
    if (drafts.length === 0) return { needed: true, ready: false, blockers: ['设计评审通过了，但卡上一稿都没有：先放一稿（或填 override 说明原因）'] }
    if (!drafts.some(item => item.id === chosenId)) {
      return { needed: true, ready: false, blockers: [`设计有 ${drafts.length} 稿但没定案：先选定哪一稿再进开发（或填 override 说明原因）`] }
    }
    return { needed: true, ready: true, blockers: [] }
  }
  const label = { pending: '还没评审', changes_requested: '评审要求修改' }[state] ?? '还没有设计记录'
  return { needed: true, ready: false, blockers: [`设计${label}：先把设计稿放进卡片并让评审通过（或填 override 说明原因）`] }
}

/** 请求体里到底有没有"要改设计评审"的内容。
 *
 *  以前 /task/design 只带 id 也会写一条 `{link:"",status:"pending",by:"人"}` 并让 revision +1 ——
 *  一个读请求却改了状态，被轮询打到就会反复刷版本（issue #5 第 5 条）。
 *  这里只做判断：没有任何字段就返回 null，路由据此走只读分支。 */
export function designPatchFrom(body) {
  const source = body !== null && typeof body === 'object' ? body : {}
  const design = source.design !== null && typeof source.design === 'object' ? source.design : null
  const fields = [ 'link', 'status', 'note', 'diff', 'spec', 'drafts', 'chosenId' ]
  const fromDesign = design !== null && fields.some(key => design[key] !== undefined && design[key] !== null)
  const fromTop = fields.some(key => source[key] !== undefined && source[key] !== null)
  if (!fromDesign && !fromTop) return null
  return design ?? Object.fromEntries(fields.filter(key => source[key] !== undefined && source[key] !== null).map(key => [key, source[key]]))
}

/**
 * 设计闸门**关着**、但这一步正好落在闸门列：返回一句留痕文案（否则空串）。
 *
 * 为什么不直接改默认值：改了会卡住存量里没做设计评审的卡，这是产品取舍。
 * 但"闸门关着且没人知道"不该发生 —— 所以留在卡的历史里，事后能查。
 */
export function designGateOffNote(config, nextStatus, currentStatus) {
  const gate = config?.design ?? {}
  const columns = Array.isArray(gate.columns) && gate.columns.length > 0 ? gate.columns : ['dev']
  if (gate.enabled === true) return ''
  if (!columns.includes(String(nextStatus ?? ''))) return ''
  if (String(currentStatus ?? '') === String(nextStatus ?? '')) return ''
  return '设计闸门当时是关闭的：这一步没有经过设计评审'
}
