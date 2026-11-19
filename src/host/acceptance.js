/* 验收条件（纯函数）：功能点上的一行行「怎么算做到」，是整条链的锚点。
 *
 * 它连着三处：
 *   1. 拆卡 —— 功能点的验收条件要原样变成卡的验收清单（以前铺的是按类型的通用模板，勾完跟验收无关）
 *   2. 用例 —— 每条用例可以挂一条验收条件（acceptanceId）
 *   3. 矩阵 —— 只有挂在某条条件上的**通过**用例才算覆盖它
 *
 * 放在独立模块是为了不把 domain.js 顶过 2000 行闸门，也方便单测直接验这三段。
 */

export function sanitizeAcceptanceItem(raw, index) {
  if (raw === null || raw === undefined) return undefined
  const source = typeof raw === 'string' ? { text: raw } : raw
  const text = String(source.text ?? '').trim().slice(0, 300)
  if (text.length === 0) return undefined
  return {
    id: String(source.id ?? `a${index + 1}`).trim().slice(0, 24) || `a${index + 1}`,
    text,
    done: source.done === true,
  }
}

/** 拆卡时用：把功能点的验收条件变成卡的验收清单（id 保持一致，矩阵才认得出）。 */
export function checklistFromAcceptance(acceptance) {
  const list = Array.isArray(acceptance) ? acceptance : []
  return list
    .map((item, index) => sanitizeAcceptanceItem(item, index))
    .filter(item => item !== undefined)
    .map(item => ({ id: item.id, text: item.text.slice(0, 200), done: false, by: '', at: 0, note: '' }))
}
