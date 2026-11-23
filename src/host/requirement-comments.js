// 需求级评论的数据形状（issue #115）。
//
// 卡片有 comments（增 / 删 / 改都留历史），需求这一层以前什么都没有：讨论只能覆盖
// description 或挂到某张卡上，需求页看到的永远是静止的正文。这里给需求一套和卡片对齐的评论，
// 单独成模块是为了不把 domain.js 顶过 2000 行的拆分上限。
const cleanOne = (raw, index) => {
  if (raw === null || typeof raw !== 'object') return undefined
  const body = String(raw.body ?? '').trim().slice(0, 4000)
  if (body === '') return undefined
  return {
    id: String(raw.id ?? '').trim() || `rc-${index + 1}`,
    by: String(raw.by ?? '').trim().slice(0, 60) || '人',
    at: Number(raw.at) > 0 ? Number(raw.at) : 0,
    body,
    // 改过的评论留一版旧正文，和卡片的 comments 一样「改删都留痕」
    edits: Array.isArray(raw.edits)
      ? raw.edits.slice(-5).map(item => ({
        at: Number(item?.at) > 0 ? Number(item.at) : 0,
        by: String(item?.by ?? '').slice(0, 60),
        body: String(item?.body ?? '').slice(0, 4000),
      }))
      : [],
  }
}

export function sanitizeRequirementComments(raw) {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 200).map(cleanOne).filter(item => item !== undefined)
}

/** 追加一条需求评论：返回写入后的数组（不改原数组）。 */
export function appendRequirementComment(list, { body, by, at = Date.now(), id } = {}) {
  const next = sanitizeRequirementComments(list)
  const text = String(body ?? '').trim()
  if (text === '') throw new Error('评论不能为空')
  if (next.length >= 200) throw new Error('一条需求最多 200 条评论：先删掉过期的')
  const entry = cleanOne({ id: id ?? `rc-${Math.random().toString(16).slice(2, 8)}`, by, at, body: text }, next.length)
  if (entry === undefined) throw new Error('评论不能为空')
  return [...next, entry]
}

/** 改一条需求评论：旧正文进 edits，和卡片侧的「改也留痕」一致。 */
export function updateRequirementComment(list, { commentId, body, by, at = Date.now() } = {}) {
  const next = sanitizeRequirementComments(list)
  const id = String(commentId ?? '')
  const target = next.find(item => item.id === id)
  if (target === undefined) throw new Error(`no comment ${id}`)
  const text = String(body ?? '').trim()
  if (text === '') throw new Error('评论不能为空')
  return next.map(item => (item.id === id
    ? { ...item, body: text.slice(0, 4000), edits: [...(item.edits ?? []), { at, by: String(by ?? '人').slice(0, 60), body: item.body }].slice(-5) }
    : item))
}

/** 删一条需求评论：留一条「谁删的」记录在历史里由调用方写，这里只做删除。 */
export function removeRequirementComment(list, commentId) {
  const next = sanitizeRequirementComments(list)
  const id = String(commentId ?? '')
  if (!next.some(item => item.id === id)) throw new Error(`no comment ${id}`)
  return next.filter(item => item.id !== id)
}
