// 专家团的团队记忆：跨卡的经验沉淀。存在 SQLite 的 side 键里——
// 不占 state、不涨 revision、不抢快照；读不到就当没有。

const KEY = 'team-memory'
const PER_TEAM = 20
const IN_PROMPT = 5

/** 全部团的记忆：{ [teamId]: [{ at, taskId, title, outcome, note }] } */
export async function loadTeamMemory(store) {
  const saved = await store.readSide(KEY).catch(() => null)
  if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) return {}
  return saved
}

/** 记一条；同一个团最多留 PER_TEAM 条。 */
export async function appendTeamMemory(store, teamId, entry) {
  const id = String(teamId ?? '')
  if (id === '') return null
  const all = await loadTeamMemory(store)
  const list = Array.isArray(all[id]) ? all[id] : []
  const row = {
    at: Number(entry?.at) || Date.now(),
    taskId: String(entry?.taskId ?? '').slice(0, 60),
    title: String(entry?.title ?? '').slice(0, 120),
    outcome: String(entry?.outcome ?? '').slice(0, 40),
    note: String(entry?.note ?? '').slice(0, 300),
  }
  all[id] = [row, ...list].slice(0, PER_TEAM)
  await store.writeSide(KEY, all).catch(() => {})
  return row
}

/** 清空某个团的记忆（人从面板上点）。 */
export async function clearTeamMemory(store, teamId) {
  const all = await loadTeamMemory(store)
  delete all[String(teamId ?? '')]
  await store.writeSide(KEY, all).catch(() => {})
}

/** 归一化一条经验：去掉数字和标点，留下能比对的主干。 */
function lessonKey(note) {
  return String(note ?? '').toLowerCase().replace(/[0-9]+/g, '#').replace(/[^\p{L}\p{N}#]+/gu, '').slice(0, 24)
}

/** 二元组集合，用来算相似度（中文没有空格，按字符切最稳）。 */
function bigrams(text) {
  const set = new Set()
  for (let index = 0; index < text.length - 1; index += 1) set.add(text.slice(index, index + 2))
  return set
}

/** Jaccard 相似度：0 完全不同，1 完全相同。 */
function similarity(a, b) {
  const left = bigrams(a)
  const right = bigrams(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const gram of left) if (right.has(gram)) shared += 1
  return shared / (left.size + right.size - shared)
}

/**
 * 从一堆记忆里提炼「反复出现」的坑：同一条经验出现 ≥ minHits 次才算数。
 * 措辞不会每次都一样（多了个「了」、换个说法），所以按相似度聚类，不做精确匹配。
 * 只记下来不回流，等于没记——这段会被拼进派单提示词当约束。
 */
export function memoryLessons(entries, minHits = 2, limit = 3) {
  const clusters = []
  for (const item of Array.isArray(entries) ? entries : []) {
    const note = String(item?.note ?? '').trim()
    if (note === '') continue
    const key = lessonKey(note)
    if (key.length < 4) continue
    const bucket = clusters.find(cluster => similarity(cluster.key, key) >= 0.6)
    if (bucket === undefined) clusters.push({ key, note: note.slice(0, 80), hits: 1 })
    else bucket.hits += 1
  }
  return clusters
    .filter(item => item.hits >= Math.max(2, Number(minHits) || 2))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, Math.max(0, Number(limit) || 3))
    .map(item => ({ note: item.note, hits: item.hits }))
}

/** 拼进专家提示词的那一段；纯函数，方便单测。 */
export function teamMemoryBlock(entries, limit = IN_PROMPT) {
  const list = Array.isArray(entries) ? entries.slice(0, Math.max(0, limit)) : []
  if (list.length === 0) return ''
  const lines = list.map(item => `- ${item.outcome || '经手'}：${item.title}${item.note ? `（${item.note}）` : ''}`)
  const lessons = memoryLessons(entries)
  const lessonText = lessons.length === 0
    ? ''
    : `\n这个团反复出过的问题（这次先规避）：\n${lessons.map(item => `- ${item.note}（出现 ${item.hits} 次）`).join('\n')}`
  return `\n这个团最近经手过的卡（先看有没有踩过的坑，别重复犯）：\n${lines.join('\n')}` + lessonText
}
