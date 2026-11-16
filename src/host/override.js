// 绕过准出的记录：以前只写进 history 的一句话，需求准出看不到。
/** 结构化 override：谁、什么时候、为什么跳过了门禁。null 表示清掉记录。 */
export function sanitizeOverride(raw) {
  if (raw === null) return null
  if (raw === undefined || typeof raw !== 'object') return undefined
  return {
    by: String(raw.by ?? '').trim().slice(0, 60),
    at: Number(raw.at) || Date.now(),
    reason: String(raw.reason ?? '').trim().slice(0, 300),
  }
}
