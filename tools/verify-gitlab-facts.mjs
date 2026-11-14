// 端到端验证「MR 事实 vs 自报执行记录」：不依赖真实 GitLab。
// 前置：在跑 dsh 的那台机器上起打桩 —— node tools/mock-gitlab.mjs
//
//   STUDIO_BASE=http://<host>:18080 node tools/verify-gitlab-facts.mjs
const BASE = process.env.STUDIO_BASE ?? 'http://127.0.0.1:18080'
const MOCK = process.env.MOCK_GITLAB ?? 'http://127.0.0.1:18098'
const IID = Number(process.env.MOCK_GITLAB_IID ?? 7)

const post = async (path, body) => {
  const res = await fetch(BASE + '/studio-api' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}
const stateOf = async () => (await (await fetch(BASE + '/studio-api/state')).json()).state

const before = await stateOf()
const gitlabBefore = before.config.gitlab ?? {}
const beforeIds = new Set(before.tasks.map((t) => t.id))
let failed = false
const check = (name, ok, detail) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail === undefined ? '' : ' — ' + detail))
  if (!ok) failed = true
}

try {
  await post('/config', {
    gitlab: { ...gitlabBefore, url: MOCK, projects: [{ id: 'mock', name: '演示仓库', project: 'demo/order' }] },
  })

  const card = await post('/task/create', { title: '（验证用）GitLab 对账', type: 'requirement', priority: 'normal', status: 'dev' })
  const id = card.body.task?.id
  check('建卡', typeof id === 'string' && id !== '', id)

  await post('/task/update', { id, gitlabMR: { iid: IID, title: 'feat: 库存预占（打桩）' } })
  await post('/task/coding', {
    id,
    action: 'update',
    coding: { agent: 'dev', branch: 'task/DEV-001', files: [{ path: 'src/a.js' }, { path: 'src/b.js' }], commits: [{ sha: 'aaa' }] },
  })

  const out = await post('/coding/gitlab', { id })
  const facts = out.body.facts ?? {}
  check('接口返回 ok', out.body.ok === true, 'HTTP ' + out.status)
  check('文件数：自报 2 / MR 3', facts.files?.declared === 2 && facts.files?.actual === 3, JSON.stringify(facts.files))
  check('提交数：自报 1 / MR 3', facts.commits?.declared === 1 && facts.commits?.actual === 3, JSON.stringify(facts.commits))
  check('流水线取到 success', facts.pipeline === 'success', String(facts.pipeline))
  check('报出两处不一致', Array.isArray(facts.mismatches) && facts.mismatches.length === 2, JSON.stringify(facts.mismatches))

  const after = await stateOf()
  const saved = after.tasks.find((t) => t.id === id)
  check('结果写进卡片 coding.gitlab', saved?.coding?.gitlab?.files?.actual === 3, JSON.stringify(saved?.coding?.gitlab?.files))

  for (const task of after.tasks) {
    if (!beforeIds.has(task.id)) await post('/task/delete', { id: task.id })
  }
  await post('/config', { gitlab: gitlabBefore })
  const final = await stateOf()
  console.log('清理完成：' + final.tasks.length + ' 张卡，gitlab 配置已还原')
} catch (error) {
  console.error('验证中断：' + (error?.message ?? error))
  failed = true
}

process.exit(failed ? 1 : 0)
