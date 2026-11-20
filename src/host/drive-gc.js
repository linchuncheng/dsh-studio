// 云盘孤儿目录的判定：纯函数，CLI 在 tools/drive-gc.mjs。
//
// 背景：自检/演示每跑一次都会建「项目/需求」目录，删台账时如果没带 deleteFolder，
// 目录就留在云盘里。2026-11-20 真机上根目录攒了 300 多个同名文件夹。
//
// 判定原则（保守）：
//   1. 需求目录（REQ-YYYY-NNN）且**没有任何台账引用** → 孤儿；
//   2. 项目目录指向的**项目已经被删**（缓存里还有、config.projects 里没了）→ 孤儿；
//   3. 未归属项目、看不懂的东西、文件 → 一律保留（`--apply` 只处理文件夹）。

const REQUIREMENT_NAME = /^REQ-\d{4}-\d{3}/i

/**
 * @param items     云盘根目录下的条目（{ name, token, type }）
 * @param references {
 *   requirementTokens?: string[]        // 现有需求目录的 token
 *   projectFolders?: Record<string,string>  // 项目 id → 目录 token（缓存原样传进来）
 *   liveProjectIds?: string[]           // 目前还存在的项目 id；不传就不判「项目已删」
 *   unassignedToken?: string
 * }
 * @returns {{ keep: Array<{name:string,token:string,reason:string}>, orphan: Array<{name:string,token:string,reason:string}> }}
 */
export function classifyDriveFolders(items, references = {}) {
  const requirementTokens = new Set((references.requirementTokens ?? []).map(String))
  const projectFolders = references.projectFolders ?? {}
  const projectTokens = new Set(Object.values(projectFolders).map(token => String(token ?? '')).filter(Boolean))
  const unassigned = String(references.unassignedToken ?? '')
  const liveProjects = new Set((references.liveProjectIds ?? []).map(String))
  // 项目已经被删、目录还在：这些 token 对应的目录没人认领
  const staleProjectTokens = new Set()
  if (liveProjects.size > 0) {
    for (const [key, token] of Object.entries(projectFolders)) {
      if (key === '__unassigned__') continue
      if (!liveProjects.has(String(key))) staleProjectTokens.add(String(token ?? ''))
    }
  }

  const keep = []
  const orphan = []
  for (const item of Array.isArray(items) ? items : []) {
    const name = String(item?.name ?? '')
    const token = String(item?.token ?? '')
    const type = String(item?.type ?? item?.file_type ?? '')
    if (token === '') continue
    if (type !== '' && type !== 'folder') { keep.push({ name, token, reason: '不是文件夹' }); continue }
    if (requirementTokens.has(token)) { keep.push({ name, token, reason: '需求台账在用' }); continue }
    if (unassigned !== '' && token === unassigned) { keep.push({ name, token, reason: '未归属项目目录' }); continue }
    if (staleProjectTokens.has(token)) { orphan.push({ name, token, reason: '项目已删除，目录没人认领' }); continue }
    if (projectTokens.has(token)) { keep.push({ name, token, reason: '项目台账在用' }); continue }
    if (REQUIREMENT_NAME.test(name)) { orphan.push({ name, token, reason: 'REQ-* 目录，台账里没有它' }); continue }
    keep.push({ name, token, reason: '不是 REQ-* 目录，保留' })
  }
  return { keep, orphan }
}

/** 给人看的一行摘要。 */
export function gcSummary(result) {
  return `保留 ${result.keep.length} 个，孤儿 ${result.orphan.length} 个`
}
