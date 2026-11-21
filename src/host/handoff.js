/* 交接契约（纯函数）：一棒交给下一棒时，把「决策 / 假设 / 未决 / 风险 / 影响面」
 * 写成结构化字段，而不是埋在评论里。产品定义 V1 必做第 5 条。
 *
 * 为什么要结构化：换专家、换会话之后，读卡的人只有评论可看；评论是流水，
 * 决策和未决问题会被后来几十条讨论顶走。这里把交接的「结论面」固定下来，
 * 派单提示词先读契约、再读最近评论。
 *
 * 这个模块不碰台账、不依赖 domain.js（domain 有 2000 行上限，规则放这里）。
 */

/** 五段式：顺序就是展示顺序。 */
export const HANDOFF_FIELDS = [
  ['decision', '决策'],
  ['assumptions', '假设'],
  ['openQuestions', '未决'],
  ['risks', '风险'],
  ['impactScope', '影响面'],
]

/** 单段上限：够写清一段结论，又不至于把卡撑成文档。 */
export const HANDOFF_FIELD_LIMIT = 1000

/** 空契约：UI 初始化用，和 null 区分开（null = 从没写过）。 */
export function emptyHandoff() {
  const out = {}
  for (const [key] of HANDOFF_FIELDS) out[key] = ''
  return out
}

/**
 * 清洗一份交接契约。
 * - 非对象 / 全空 → null（把契约清掉，而不是留一堆空字符串）；
 * - 逐段 trim + 截断；
 * - by / at 由调用方带进来，没带就记空/现在。
 */
export function sanitizeHandoff(raw) {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out = emptyHandoff()
  let any = false
  for (const [key] of HANDOFF_FIELDS) {
    const value = String(raw[key] ?? '').trim().slice(0, HANDOFF_FIELD_LIMIT)
    out[key] = value
    if (value !== '') any = true
  }
  if (!any) return null
  out.by = String(raw.by ?? '').trim().slice(0, 40)
  out.at = Number(raw.at) || Date.now()
  return out
}

/** 非空的段（渲染 / 提示词 / 统计共用一套顺序）。 */
export function handoffLines(handoff) {
  if (handoff === null || handoff === undefined || typeof handoff !== 'object') return []
  return HANDOFF_FIELDS
    .map(([key, label]) => ({ key, label, text: String(handoff[key] ?? '').trim() }))
    .filter(item => item.text !== '')
}

/** 写了几段（0 表示没有契约）。 */
export function handoffFilled(handoff) {
  return handoffLines(handoff).length
}

/** 派单提示词里的那一段：有契约才出现，放在「最近评论」之前。 */
export function handoffBlock(handoff) {
  const lines = handoffLines(handoff)
  if (lines.length === 0) return ''
  const by = String(handoff?.by ?? '').trim()
  return `\n这张卡的交接契约（上一棒留下的结论，先读它，再看下面的评论）：\n${lines.map(item => `- ${item.label}：${item.text}`).join('\n')}${by === '' ? '' : `\n（交接人：${by}）`}`
}
