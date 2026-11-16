// 提示词 A/B：同一张卡、两个专家（提示词只差一段），跑完比较「用例通过 / 代码事实 / 返工 / 耗时」。
//
//   node tools/prompt-ab.mjs --task <id> --variant '提交前必须先跑 pnpm test'          # 只看计划，不派单（免费）
//   node tools/prompt-ab.mjs --task <id> --variant '...' --setup-only                  # 只建两个临时专家再删掉（免费，验通路）
//   node tools/prompt-ab.mjs --task <id> --variant '...' --run                         # 真跑两次（花 token）
//
// 一个变体 = 一次真实的 AI 会话。--run 之前先读一眼计划里的成本。
const BASE = process.env.STUDIO_BASE ?? 'http://192.168.120.218:18080'
const argv = process.argv.slice(2)
const flag = (name) => argv.includes('--' + name)
const value = (name, fallback) => { const at = argv.indexOf('--' + name); return at >= 0 ? String(argv[at + 1] ?? '') : fallback }
const TASK = value('task', '')
const VARIANT = value('variant', '')
const RUN = flag('run')
const SETUP_ONLY = flag('setup-only')
const TIMEOUT_MS = Number(value('timeout', '480')) * 1000
const post = async (path, body) => {
  const res = await fetch(BASE + '/studio-api' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  return res.json().catch(() => ({}))
}
const state = async () => (await (await fetch(BASE + '/studio-api/state')).json()).state
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

if (TASK === '' || VARIANT === '') { console.error('用法：--task <卡片 id> --variant "这段提示词" [--run|--setup-only]'); process.exit(2) }
const before = await state()
const card = (before.tasks ?? []).find(item => item.id === TASK)
if (card === undefined) { console.error('没有这张卡：' + TASK); process.exit(2) }
const baseExpert = (before.config.experts ?? []).find(item => item.id === card.expert)
const basePrompt = String(baseExpert?.prompt ?? '角色说明（内置）')
const cases = Array.isArray(card.cases) ? card.cases : []
const stamp = Date.now().toString(36).slice(-4)
const plan = {
  card: card.code + ' ' + card.title,
  column: card.status,
  baselineExpert: baseExpert === undefined ? '（卡上没专家，用变体专家直接派）' : baseExpert.name,
  variantPrompt: VARIANT,
  judgedBy: ['用例通过数 ' + cases.length + ' 条', '代码事实核对 verified', '评论条数（返工痕迹）', '耗时'],
  cost: '两个变体 = 两次真实 AI 会话',
}
if (!RUN && !SETUP_ONLY) {
  console.log(JSON.stringify(plan, null, 2))
  console.log('\n这是 dry-run：没有建专家、没有派单、没有花 token。加 --setup-only 验通路，加 --run 真跑。')
  process.exit(0)
}

const makeExpert = async (name, prompt) => {
  // /experts/save 返回 { ok, experts, state }：新专家没有单独字段，按 id 差集找出来最稳
  const known = new Set(((await state()).config.experts ?? []).map(item => item.id))
  const saved = await post('/experts/save', { expert: { name, role: 'dev', description: 'A/B 临时专家', prompt, enabled: true } })
  const list = saved.experts ?? saved.state?.config?.experts ?? []
  const created = list.find(item => !known.has(item.id))
  if (created === undefined) throw new Error('建专家失败：' + JSON.stringify(saved).slice(0, 160))
  return String(created.id)
}
const delExpert = async (id) => { await post('/experts/delete', { id }) }

// 专家 id 由名字归一化而来，中文会被剥掉导致两个变体撞成同一个 id（实测），所以用 ASCII 名字
const expertA = await makeExpert('AB-base-' + stamp, String(baseExpert?.prompt ?? ''))
const expertB = await makeExpert('AB-variant-' + stamp, String(baseExpert?.prompt ?? '') + '\n\n' + VARIANT)
console.log('建好两个临时专家：基线=' + expertA + ' 变体=' + expertB)
if (SETUP_ONLY) {
  await delExpert(expertA); await delExpert(expertB)
  console.log('--setup-only：通路验证完成，已删除两个临时专家。数据库里没有留下东西。')
  process.exit(0)
}

const runVariant = async (label, expertId) => {
  const started = Date.now()
  await post('/task/update', { id: TASK, expert: expertId })
  const launched = await post('/agents/run', { id: TASK, expert: expertId })
  if (launched.ok !== true) return { label, ok: false, error: JSON.stringify(launched.error ?? launched).slice(0, 160) }
  while (Date.now() - started < TIMEOUT_MS) {
    await sleep(5000)
    const running = (await post('/agents', {})).agents ?? []
    const mine = running.filter(item => item.taskId === TASK)
    if (mine.length === 0) break
  }
  const after = await state()
  const done = (after.tasks ?? []).find(item => item.id === TASK) ?? {}
  const list = Array.isArray(done.cases) ? done.cases : []
  return {
    label,
    ms: Date.now() - started,
    passed: list.filter(item => item.result === 'pass').length,
    failed: list.filter(item => item.result === 'fail').length,
    cases: list.length,
    verified: done.coding?.verified?.ok === true,
    comments: (done.history ?? []).filter(item => item.kind === 'comment').length,
  }
}
const a = await runVariant('基线', expertA)
const b = await runVariant('变体', expertB)
await delExpert(expertA); await delExpert(expertB)
const line = (row) => [row.label, 'ok=' + row.ok, '用例 ' + (row.passed ?? 0) + '/' + (row.cases ?? 0), '核对=' + String(row.verified), '评论 ' + (row.comments ?? 0), Math.round((row.ms ?? 0) / 1000) + 's'].join('  ')
console.log(line(a))
console.log(line(b))
const better = (b.passed ?? 0) > (a.passed ?? 0) || (b.verified === true && a.verified !== true)
console.log('\n结论：' + (better ? '变体更好（用例更多或核对通过）' : '这次没有分出高下') + '；两次都是真实会话，样本太小，要反复几次再下判断。')