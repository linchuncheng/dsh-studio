#!/usr/bin/env node
// 一次性数据修复（默认只预览，--apply 才写库）。必须在目标机**停掉 dsh-web 之后**跑：
// 运行中的进程把状态握在内存里，直接改库会被下一次保存覆盖。
//
// 修三件事（2026-11-23 用户点名）：
//   1. 历史撞号重排：同一前缀的卡按创建时间全局重排（REQ 前缀的需求卡直接用需求编号），
//      保证界面上看到的编号不再重复；
//   2. 悬空父卡：把「父卡已经不存在」的子卡收拢到一张**重建的**父卡下（父卡上写明是重建的）；
//   3. 专家改名：把名字就是 id 的专家换成给定名字。
//
// 用法（在仓库根，指向目标机的库文件）：
//   node tools/repair-data.mjs --db ~/.dsh/dsh-studio.db                  # 预览
//   node tools/repair-data.mjs --db ~/.dsh/dsh-studio.db --apply          # 写入
//   可选：--rename-expert expert-2d22ad=通用助手
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const argv = process.argv.slice(2)
const argOf = (name, fallback = '') => {
  const at = argv.indexOf(name)
  return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback
}
const apply = argv.includes('--apply')
const dbArg = argOf('--db', '').trim()
if (dbArg === '') { console.error('需要 --db <库文件路径>'); process.exit(2) }
const dbFile = dbArg.startsWith('~') ? resolve(homedir(), dbArg.slice(dbArg.indexOf('~') + 1).replace(/^[\\/]+/, '')) : resolve(dbArg)

const renames = new Map()
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] !== '--rename-expert') continue
  const spec = String(argv[index + 1] ?? '')
  const [id, name] = spec.split('=')
  if (id && name) renames.set(id.trim(), name.trim())
}

const { StudioStore } = await import('../src/host/store.js')
const store = new StudioStore(dbFile)
await store.ready
const state = store.snapshot()

const PREFIX = { requirement: 'REQ', design: 'DES', dev: 'DEV', test: 'TEST', bug: 'BUG', ops: 'OPS' }
const plan = { renumber: [], rebuildParent: null, reparent: [], renameExpert: [] }

/* ------------------------------------------------------------ 1. 重排 --- */
const tasks = [...(state.tasks ?? [])]
const requirements = new Map((state.requirements ?? []).map(r => [r.id, r]))
const groups = new Map()
for (const task of tasks) {
  if (task.type === 'requirement') continue
  const prefix = PREFIX[task.type] ?? 'TASK'
  groups.set(prefix, [...(groups.get(prefix) ?? []), task])
}
const stamp = task => Number(task.createdAt ?? 0) || 0
for (const [prefix, list] of groups) {
  list.sort((a, b) => stamp(a) - stamp(b) || String(a.id).localeCompare(String(b.id)))
  list.forEach((task, index) => {
    const next = `${prefix}-${String(index + 1).padStart(3, '0')}`
    if (String(task.code ?? '') !== next) plan.renumber.push({ id: task.id, from: task.code ?? '', to: next, title: String(task.title).slice(0, 24) })
  })
}
/* 需求型卡：同一条需求下可能有多张（拆卡时也会建），全用需求编号就会撞。
   最早那张用需求编号，其余加 -2 / -3 后缀，既唯一又能看出归属。 */
const requirementCards = new Map()
for (const task of tasks.filter(t => t.type === 'requirement')) {
  requirementCards.set(task.requirementId, [...(requirementCards.get(task.requirementId) ?? []), task])
}
for (const [requirementId, list] of requirementCards) {
  const base = requirements.get(requirementId)?.code ?? ''
  if (base === '') continue
  list.sort((a, b) => stamp(a) - stamp(b) || String(a.id).localeCompare(String(b.id)))
  list.forEach((task, index) => {
    const to = index === 0 ? base : `${base}-${index + 1}`
    if (String(task.code ?? '') !== to) plan.renumber.push({ id: task.id, from: task.code ?? '', to, title: String(task.title).slice(0, 24) })
  })
}

/* -------------------------------------------------- 2. 悬空父卡收拢 --- */
const ids = new Set(tasks.map(t => t.id))
const orphans = tasks.filter(task => task.parent && !ids.has(task.parent))
if (orphans.length > 0) {
  const sameCase = orphans.every(task => String(task.title ?? '') === String(orphans[0].title ?? ''))
  plan.rebuildParent = {
    title: sameCase
      ? `（重建）${String(orphans[0].title).slice(0, 40)} 的父卡`
      : '（重建）原父卡已丢失：这些卡当初挂在这里',
    type: 'test',
    reason: `原父卡 ${[...new Set(orphans.map(task => task.parent))].join('、')} 已被删除，重建一张把它们收拢`,
  }
  plan.reparent = orphans.map(task => ({ id: task.id, from: task.parent, title: String(task.title).slice(0, 24), code: task.code ?? '' }))
}

/* -------------------------------------------------------- 3. 专家改名 --- */
for (const [id, name] of renames) {
  const expert = (state.config?.experts ?? []).find(item => item.id === id)
  if (expert === undefined) { plan.renameExpert.push({ id, from: '（不存在）', to: name }); continue }
  plan.renameExpert.push({ id, from: expert.name, to: name })
}

/* --------------------------------------------------------------- 输出 --- */
console.log(`库：${dbFile}`)
console.log(`卡 ${tasks.length} · 需求 ${requirements.size} · 专家 ${(state.config?.experts ?? []).length}`)
console.log(`\n① 重排编号 ${plan.renumber.length} 张`)
for (const row of plan.renumber.slice(0, 12)) console.log(`   ${row.id}  ${row.from || '（空）'} → ${row.to}   ${row.title}`)
if (plan.renumber.length > 12) console.log(`   … 其余 ${plan.renumber.length - 12} 张`)
console.log(plan.rebuildParent === null
  ? '\n② 悬空父卡：无'
  : `\n② 悬空父卡 ${plan.reparent.length} 张 → 重建父卡「${plan.rebuildParent.title}」`)
for (const row of plan.reparent) console.log(`   ${row.id}  ${row.code || '（空编号）'}  ${row.title}`)
console.log(`\n③ 专家改名 ${plan.renameExpert.length} 位`)
for (const row of plan.renameExpert) console.log(`   ${row.id}  ${row.from} → ${row.to}`)

if (apply === false) {
  console.log('\n（只预览；加 --apply 才写库。写之前记得停掉 dsh-web 并备份 .db/-wal/-shm）')
  process.exit(0)
}

const renameMap = new Map(plan.renumber.map(row => [row.id, row.to]))
let rebuiltParentId = ''
await store.mutate(current => {
  if (plan.rebuildParent !== null) {
    rebuiltParentId = `t-${Math.random().toString(16).slice(2, 10)}`
    current.tasks.unshift({
      id: rebuiltParentId,
      title: plan.rebuildParent.title,
      type: plan.rebuildParent.type,
      code: '',
      requirementId: '',
      status: 'done',
      priority: 'normal',
      severity: 'p2',
      owner: '',
      expert: '',
      checklist: [],
      comments: [{ id: `c-${Math.random().toString(16).slice(2, 8)}`, author: '系统', kind: 'agent', at: Date.now(), body: plan.rebuildParent.reason }],
      history: [{ at: Date.now(), by: '系统', status: 'done', note: plan.rebuildParent.reason }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  }
  for (const task of current.tasks) {
    const next = renameMap.get(task.id)
    if (next !== undefined && next !== String(task.code ?? '')) {
      task.history = [...(task.history ?? []), { at: Date.now(), by: '系统', status: task.status, note: `编号重排：${task.code || '（空）'} → ${next}` }]
      task.code = next
      task.updatedAt = Date.now()
    }
    if (plan.reparent.some(row => row.id === task.id) && rebuiltParentId !== '') {
      task.history = [...(task.history ?? []), { at: Date.now(), by: '系统', status: task.status, note: `父卡 ${task.parent} 已不存在，改挂到重建的父卡 ${rebuiltParentId}` }]
      task.parent = rebuiltParentId
      task.updatedAt = Date.now()
    }
  }
  for (const [id, name] of renames) {
    const expert = (current.config?.experts ?? []).find(item => item.id === id)
    if (expert !== undefined) expert.name = name
  }
})
console.log('\n已写入。')
