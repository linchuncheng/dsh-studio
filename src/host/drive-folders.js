// 云盘目录结构：项目 → 需求 → 按类型分类的产物。纯函数，IO 在 executor.js。
//
// 为什么改成按项目分层：以前所有需求文件夹平铺在云盘根下，两三个「库存预占」长得一模一样，
// 分不清谁是谁；而 agent 找文档是「这个项目的这个需求」，不是「某个叫库存预占的文件夹」。
//
// 目标形状：
//   根文件夹（设置里的「云盘根文件夹」）
//     ├─ ORD 订单中心/                  ← 项目（按业务项目）
//     │    ├─ REQ-2026-001 积分抵扣/     ← 需求
//     │    │    ├─ 01 需求文档/
//     │    │    ├─ 02 设计文档/
//     │    │    ├─ 03 用例/
//     │    │    ├─ 04 测试报告/
//     │    │    └─ 07 其它/
//     │    └─ REQ-2026-002 …
//     └─ 未归属项目/                    ← 没挂项目的需求（缺陷、临时需求）落这里

/** 产物类型 → 子文件夹名。带序号是为了在云盘里天然按「需求→设计→用例→测试」的顺序排。 */
export const ARTIFACT_FOLDERS = {
  requirement: '01 需求文档',
  design: '02 设计文档',
  cases: '03 用例',
  report: '04 测试报告',
  release: '05 发布',
  mr: '06 代码评审',
  doc: '07 其它',
  screenshot: '07 其它',
  other: '07 其它',
}

/** 没挂项目的需求落这里（不丢，但要能一眼看出没归属）。 */
export const UNASSIGNED_PROJECT_FOLDER = '未归属项目'

/** 云盘文件名/文件夹名里不能出现的字符：换成全角或下划线，避免建文件夹直接失败。 */
export function safeFolderName(raw, max = 120) {
  const cleaned = String(raw ?? '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  const clipped = cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned
  return clipped === '' ? '未命名' : clipped
}

/** 项目文件夹名：`KEY 名称`（没有 key 就只用名称，没有项目就「未归属项目」）。 */
export function projectFolderName(project) {
  if (project === null || project === undefined) return UNASSIGNED_PROJECT_FOLDER
  const key = String(project.key ?? '').trim()
  const name = String(project.name ?? project.id ?? '').trim()
  if (name === '' && key === '') return UNASSIGNED_PROJECT_FOLDER
  return safeFolderName(key === '' || name === '' ? `${key}${name}` : `${key} ${name}`)
}

/** 需求文件夹名：`REQ-2026-001 标题`（编号在前，云盘里排序即按编号）。 */
export function requirementFolderNameOf(requirement) {
  const code = String(requirement?.code ?? '').trim()
  const id = String(requirement?.id ?? '').trim()
  const title = String(requirement?.title ?? '').trim()
  const head = code !== '' ? code : id
  return safeFolderName(head === '' ? title : `${head} ${title}`)
}

/** 产物类型对应的子文件夹名（未知类型归「其它」）。 */
export function artifactFolderName(kind) {
  return ARTIFACT_FOLDERS[String(kind ?? '').trim()] ?? ARTIFACT_FOLDERS.other
}

/**
 * 在一份文件夹清单里按名字找可复用的目录（同层同名就算同一个）。
 * 云盘接口返回的条目里 `type` 可能是 'folder'，有的版本放在 `type` 或 `file_type`，两种都认。
 */
export function findFolder(list, name) {
  const wanted = String(name ?? '').trim()
  if (wanted === '') return undefined
  const items = Array.isArray(list) ? list : []
  return items.find(item => {
    const kind = String(item?.type ?? item?.file_type ?? '').trim()
    if (kind !== '' && kind !== 'folder') return false
    return String(item?.name ?? '').trim() === wanted
  })
}

/** 目录路径（用于面板展示「现在这条需求会落到哪」，不含 token）。 */
export function folderPath(input) {
  const parts = [input?.root, input?.project, input?.requirement].map(part => String(part ?? '').trim()).filter(part => part !== '')
  return parts.join(' / ')
}

/** 只认 http(s) / mailto / # 锚点 / 站内路径（和 domain 里 sanitizeUrl 同口径，但这里自己实现，避免反向 import）。 */
function folderUrl(raw) {
  const value = String(raw ?? '').trim().slice(0, 800)
  if (value === '') return ''
  if (/^(https?:\/\/|mailto:|#|\/)/i.test(value)) return value
  return ''
}

/** 需求上的云盘目录记录：token / 父目录 / 按类型分的子目录，坏数据一律当没有。 */
export function sanitizeRequirementFolder(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const kinds = {}
  if (input.kinds !== null && typeof input.kinds === 'object') {
    for (const [name, entry] of Object.entries(input.kinds).slice(0, 12)) {
      if (entry === null || typeof entry !== 'object') continue
      const token = String(entry.token ?? '').trim().slice(0, 80)
      if (token === '') continue
      kinds[String(name).slice(0, 40)] = { token, url: folderUrl(entry.url), name: String(name).slice(0, 40), at: Number(entry.at) || 0 }
    }
  }
  return {
    token: String(input.token ?? '').trim().slice(0, 80),
    url: folderUrl(input.url),
    name: String(input.name ?? '').trim().slice(0, 200),
    parentToken: String(input.parentToken ?? '').trim().slice(0, 80),
    parentName: String(input.parentName ?? '').trim().slice(0, 200),
    kinds,
    at: Number(input.at) || 0,
    error: String(input.error ?? '').slice(0, 300),
  }
}

/** 项目级目录缓存：{ 项目 id: { token, url, name, at, error } }。 */
export function sanitizeProjectFolders(raw) {
  const out = {}
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [key, entry] of Object.entries(raw).slice(0, 60)) {
    if (entry === null || typeof entry !== 'object') continue
    const token = String(entry.token ?? '').trim().slice(0, 80)
    if (token === '') continue
    out[String(key).slice(0, 60)] = {
      token,
      url: folderUrl(entry.url),
      name: String(entry.name ?? '').slice(0, 200),
      at: Number(entry.at) || 0,
      error: String(entry.error ?? '').slice(0, 300),
    }
  }
  return out
}
