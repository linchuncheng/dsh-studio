// 全闭环验收：需求澄清三问 → 评审 → 拆卡 → 设计/开发列 → 自动代码事实核对 → 用例真跑 →
// 验收签字 → 完成 → 版本发布。
//
//   STUDIO_BASE=http://<host>:18080 node tools/e2e-loop.mjs
//
// 会在看板里真的建一条需求和若干张卡（标题带时间戳），跑完打印每一步的结果。
// 需要：目标项目在主机上有 git 仓库、config.testing.allowShell 打开、shellCwd 指向仓库。
const BASE = process.env.STUDIO_BASE ?? 'http://192.168.120.218:18080'
const PROJECT = process.env.E2E_PROJECT ?? 'admin-portal'
const SHELL_CWD = process.env.E2E_SHELL_CWD ?? '/home/lyf/repos/admin-portal'

const post = async (path, body) => {
  const res = await fetch(BASE + '/studio-api' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}
const state = async () => (await (await fetch(BASE + '/studio-api/state')).json()).state
const step = (label, value) => console.log(label.padEnd(22) + value)
const failures = []
const expect = (label, ok, detail) => {
  if (!ok) failures.push(label + ' — ' + detail)
  step(label, (ok ? 'ok' : 'FAIL ') + (detail === undefined ? '' : detail))
}

const stamp = new Date().toISOString().slice(5, 16).replace('T', ' ')
const cfg = (await state()).config
await post('/config', { testing: { ...cfg.testing, allowShell: true, shellCwd: SHELL_CWD } })

// 功能点里有一条讲后端，拆卡时才不会触发「有后端但没覆盖后端」的提示
const points = [
  { id: 'p1', title: '订单接口与建表', description: 'API + SQLite', priority: 'normal', status: 'draft', acceptance: [] },
  { id: 'p2', title: '可拆卡并建 worktree', description: '拆卡 + 分支', priority: 'normal', status: 'draft', acceptance: [] },
]
const saved = await post('/requirement/save', { requirement: {
  title: '全闭环自检 ' + stamp,
  description: '由 tools/e2e-loop.mjs 生成：验证澄清门禁 → 评审 → 拆卡 → 代码事实 → 用例 → 验收 → 版本。',
  project: PROJECT,
  points,
} })
const req = saved.body.requirement
step('需求', req?.code + ' ' + (req?.id ?? ''))
await post('/requirement/review', { id: req.id, decision: 'submit', by: '产品' })
const approved = await post('/requirement/review', { id: req.id, decision: 'approve', by: '架构师', note: '范围清楚' })
expect('评审', approved.body.review?.status === 'approved', String(approved.body.review?.status))

// 1) 三问没答：拆卡必须被拦
const blocked = await post('/requirement/split', { id: req.id })
expect('未答三问被拦', blocked.status === 400 && String(blocked.body.error ?? '').includes('澄清'), String(blocked.status) + ' ' + String(blocked.body.error ?? '').slice(0, 40))

// 2) 答完三问再拆，且不该出现「后端没覆盖」的提示
await post('/requirement/save', { requirement: { id: req.id, title: req.title, description: req.description, project: PROJECT,
  discovery: { server: '有，node:sqlite 持久化', auth: '服务端校验角色，viewer 写接口 403', boundary: '前后端都交付，含测试' }, points } })
const split = await post('/requirement/split', { id: req.id })
const created = split.body.created ?? []
expect('答完三问可拆卡', split.status === 200 && created.length > 0, created.length + ' 张')
expect('没有后端覆盖提示', (split.body.warnings ?? []).length === 0, JSON.stringify(split.body.warnings ?? []))

const cards = (await state()).tasks.filter(t => t.requirementId === req.id)
for (const card of cards) {
  const wt = await post('/task/worktree', { id: card.id, action: 'create' })
  const info = wt.body.worktree ?? {}
  await post('/task/coding', { id: card.id, action: 'update', coding: { agent: 'dev', branch: info.branch ?? '', files: [], commits: [], tests: { total: 16, passed: 16 } } })
  await post('/task/case', { id: card.id, action: 'add', cases: [
    // 断言用「fail 0」而不是条数：加测试不该让用例变红
    { title: 'pnpm test', expected: '没有失败', shell: { command: 'pnpm test', expectExit: 0, expectContains: 'fail 0', timeoutMs: 180000 } },
    { title: 'pnpm build', expected: 'built in', shell: { command: 'pnpm build', expectExit: 0, expectContains: 'built in', timeoutMs: 180000 } },
  ] })
  for (const status of ['design', 'dev_ready', 'dev', 'review']) await post('/task/update', { id: card.id, status })
  await new Promise(r => setTimeout(r, 2500))
  const reviewed = (await state()).tasks.find(t => t.id === card.id)
  await post('/task/update', { id: card.id, status: 'test' })
  const run = await post('/task/case/run', { id: card.id })
  const parts = (await post('/task/parts', { id: card.id })).body
  for (const item of (parts.checklist ?? [])) await post('/task/checklist', { id: card.id, action: 'check', itemId: item.id, by: '产品' })
  await post('/task/update', { id: card.id, status: 'accept' })
  await post('/task/signoff', { id: card.id, by: '产品', note: '用例通过' })
  const done = await post('/task/update', { id: card.id, status: 'done' })
  const ok = reviewed?.coding?.verified?.ok === true && run.body.run?.failed === 0 && done.body.task?.status === 'done'
  expect('卡 ' + card.code, ok, 'worktree=' + (info.base ?? '?') + ' 核对=' + String(reviewed?.coding?.verified?.ok) + ' 用例=' + String(run.body.run?.passed) + '/' + String(run.body.run?.total))
}

const fin = await post('/requirement/signoff', { id: req.id, by: '产品', note: '全闭环自检通过' })
const after = (await state()).requirements.find(r => r.id === req.id)
expect('需求交付', (fin.body.requirement?.status ?? after?.status) === 'delivered', String(fin.body.requirement?.status ?? after?.status))

const cardsNow = (await state()).tasks.filter(t => t.requirementId === req.id)
const rel = await post('/release/save', { release: { name: '全闭环自检版本 ' + stamp, version: '0.0.0-' + stamp.replace(/[^0-9]/g, ''), project: PROJECT, tagName: 'e2e-' + stamp.replace(/[^0-9]/g, ''), smoke: [{ text: '自检脚本跑通', done: true }] } })
const release = rel.body.release ?? {}
await post('/release/link', { id: release.id, taskIds: cardsNow.map(c => c.id) })
const published = await post('/release/publish', { id: release.id, by: '产品' })
expect('版本发布', published.body.release?.status === 'released', String(published.body.release?.status ?? published.body.error).slice(0, 60))

// 自检会真的建需求和卡：默认跑完就删，避免看板里堆垃圾；想看结果就带 --keep
const keep = process.argv.includes('--keep')
if (!keep) {
  for (const card of cardsNow) await post('/task/delete', { id: card.id })
  await post('/requirement/delete', { id: req.id })
  if (release.id !== undefined) await post('/release/delete', { id: release.id })
  const left = await state()
  step('清理', left.tasks.filter(t => t.requirementId === req.id).length === 0 ? 'ok 已删除自检数据' : 'FAIL 还有残留')
}

console.log('')
console.log(failures.length === 0 ? '全闭环通过' : '失败 ' + failures.length + ' 项：' + failures.join(' / '))
process.exit(failures.length === 0 ? 0 : 1)