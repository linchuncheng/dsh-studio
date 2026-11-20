// 云盘孤儿目录的判定：纯函数，CLI 在 tools/drive-gc.mjs。
//
// 背景：自检/演示每跑一次都会建「项目/需求」目录，删台账时如果没带 deleteFolder，
// 目录就留在云盘里。2026-11-20 真机上根目录攒了 300 多个同名文件夹。
//
// 判定原则（保守）：
//   - 只认「名字像需求目录（REQ-…）」且**没有任何台账引用**的；
//   - 项目目录、未归属项目、以及任何看不懂的东西一律保留；
//   - 文件永远不删（`--apply` 只处理文件夹）。

const REQUIREMENT_NAME = /^REQ-\d{4}-\d{3}/i

/**
 * @param items      云盘根目录下的条目（{ name, token, type }）
 * @param references { requirementTokens: string[], projectTokens: string[], unassignedToken?: string }
 * @returns { keep: [{name,token,reason}], orphan: [{name,token,reason}] }
 */
export function classifyDriveFolders(items, references = {}) {
  const requirementTokens = new Set((references.requirementTokens ?? []).map(String))
  const projectTokens = new Set((references.projectTokens ?? []).map(String))
  const unassigned = String(references.unassignedToken ?? '')
  const keep = []
  const orphan = []
  for (const item of Array.isArray(items) ? items : []) {
    const name = String(item?.name ?? '')
    const token = String(item?.token ?? '')
    const type = String(item?.type ?? item?.file_type ?? '')
    if (token === '') continue
    if (type !== '' && type !== 'folder') { keep.push({ name, token, reason: '不是文件夹' }); continue }
    if (type === '' && !REQUIREMENT_NAME.test(name)) { keep.push({ name, token, reason: '看不出来是什么，保留' }); continue }
    if (requirementTokens.has(token)) { keep.push({ name, token, reason: '需求台账在用' }); continue }
    if (projectTokens.has(token)) { keep.push({ name, token, reason: '项目台账在用' }); continue }
    if (unassigned !== '' && token === unassigned) { keep.push({ name, token, reason: '未归属项目目录' }); continue }
    if (REQUIREMENT_NAME.test(name)) {
      orphan.push({ name, token, reason: 'REQ-* 目录，台账里没有它' })
      continue
    }
    keep.push({ name, token, reason: '不是 REQ-* 目录，保留' })
  }
  return { keep, orphan }
}

/** 给人看的一行摘要。 */
export function gcSummary(result) {
  return `保留 ${result.keep.length} 个，孤儿 ${result.orphan.length} 个`
}
