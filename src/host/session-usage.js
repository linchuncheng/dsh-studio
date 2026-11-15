// 从 dsh 的会话日志里读用量：<home>/.dsh/sessions/<ws>/studio-<taskId>-<expert>/session.v4.jsonl.zstd
// 用 zstd 解压（宿主上本来就有），按 mtime 缓存，避免每刷新一次效能页都重解一遍。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseUsageLines, summarizeUsage } from './usage.js'

const run = promisify(execFile)
const CACHE = new Map()

export function sessionsRoot() {
  return join(homedir(), '.dsh', 'sessions')
}

/** studio-<taskId>-<expertId>：taskId 形如 t-01a3c8d3，剩下都算专家。 */
export function parseSessionName(name) {
  const match = /^studio-(t-[a-z0-9]+)-(.+)$/.exec(String(name ?? ''))
  if (match === null) return null
  return { taskId: match[1], expert: match[2] }
}

async function readFileUsage(file) {
  let mtimeMs = 0
  try { mtimeMs = (await stat(file)).mtimeMs } catch { return null }
  const cached = CACHE.get(file)
  if (cached !== undefined && cached.mtimeMs === mtimeMs) return cached.usage
  let usage = []
  try {
    const { stdout } = await run('zstd', ['-dc', file], { maxBuffer: 256 * 1024 * 1024 })
    usage = parseUsageLines(stdout.split('\n'))
  } catch {
    // 没装 zstd 或者文件坏了：当作读不到，不抛，页面上显示未知
    usage = []
  }
  CACHE.set(file, { mtimeMs, usage })
  return usage
}

/** 扫一遍所有 studio-* 会话，返回 [{ taskId, expert, at, usage }]。 */
export async function collectSessionUsage(root = sessionsRoot()) {
  const out = []
  let workspaces = []
  try { workspaces = await readdir(root) } catch { return out }
  for (const workspace of workspaces) {
    const dir = join(root, workspace)
    let entries = []
    try { entries = await readdir(dir) } catch { continue }
    for (const entry of entries) {
      const parsed = parseSessionName(entry)
      if (parsed === null) continue
      const usage = await readFileUsage(join(dir, entry, 'session.v4.jsonl.zstd'))
      if (usage === null || usage.length === 0) continue
      out.push({ taskId: parsed.taskId, expert: parsed.expert, usage })
    }
  }
  return out
}

/** 按卡 / 按专家汇总 token 与钱；prices 来自 config.costs.prices。 */
export function aggregateUsage(sessions, tasks, prices, costOf) {
  const byCard = new Map()
  const byExpert = new Map()
  const totals = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  for (const session of sessions) {
    const summary = summarizeUsage(session.usage)
    const money = costOf(prices, session.usage)
    for (const key of ['calls', 'input', 'output', 'cacheRead', 'cacheWrite', 'total']) totals[key] += summary[key]
    const card = byCard.get(session.taskId) ?? { taskId: session.taskId, ...{ calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0, unknownCalls: 0 }
    for (const key of ['calls', 'input', 'output', 'cacheRead', 'cacheWrite', 'total']) card[key] += summary[key]
    if (money.cost !== null) card.cost += money.cost
    card.unknownCalls += money.unknownCalls
    byCard.set(session.taskId, card)
    const expert = byExpert.get(session.expert) ?? { expert: session.expert, calls: 0, total: 0, cost: 0, unknownCalls: 0 }
    expert.calls += summary.calls
    expert.total += summary.total
    if (money.cost !== null) expert.cost += money.cost
    expert.unknownCalls += money.unknownCalls
    byExpert.set(session.expert, expert)
  }
  const taskOf = new Map((Array.isArray(tasks) ? tasks : []).map((task) => [String(task.id ?? ''), task]))
  const cards = [...byCard.values()].map((card) => {
    const task = taskOf.get(card.taskId)
    return { ...card, code: String(task?.code ?? ''), title: String(task?.title ?? ''), project: String(task?.project ?? '') }
  }).sort((a, b) => b.total - a.total)
  const round = (value) => Math.round(value * 10000) / 10000
  return {
    totals: {
      ...totals,
      // 有算不出价的调用且一分钱都没算出来时，给 null（未知），不要报成 0
      cost: cards.reduce((sum, card) => sum + card.unknownCalls, 0) > 0 && cards.reduce((sum, card) => sum + card.cost, 0) === 0
        ? null
        : round(cards.reduce((sum, card) => sum + card.cost, 0)),
      unknownCalls: cards.reduce((sum, card) => sum + card.unknownCalls, 0),
    },
    cards: cards.slice(0, 50),
    experts: [...byExpert.values()].map((row) => ({ ...row, cost: round(row.cost) })).sort((a, b) => b.total - a.total),
  }
}
