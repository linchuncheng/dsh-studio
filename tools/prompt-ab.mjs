// 提示词 A/B：同一张卡、两个专家（提示词只差一段），跑完比较「用例通过 / 代码事实 / 返工 / 耗时」。
//
//   node tools/prompt-ab.mjs --task <id> --variant '...'                 # 只看计划（免费）
//   node tools/prompt-ab.mjs --task <id> --variant '...' --setup-only   # 建两个临时专家再删（免费）
//   node tools/prompt-ab.mjs --task <id> --variant '...' --run          # 真跑两次（花 token）
//
// 完成判定读宿主上的 session 日志（/agents 不报这类手动派单，靠它会在第一次轮询就收工）。
import { Client } from 'ssh2'
const BASE = process.env.STUDIO_BASE ?? 'http://192.168.120.218:18080'
const SSH = { host: process.env.DSH_DEPLOY_HOST ?? '192.168.120.218', username: process.env.DSH_DEPLOY_USER ?? 'lyf', password: process.env.DSH_DEPLOY_PASSWORD ?? '1234', readyTimeout: 15000 }
const argv = process.argv.slice(2)
const flag = (name) => argv.includes('--' + name)
const value = (name, fallback) => { const at = argv.indexOf('--' + name); return at >= 0 ? String(argv[at + 1] ?? '') : fallback }
const TASK = value('task', '')
const VARIANT = value('variant', '')
const RUN = flag('run')
const SETUP_ONLY = flag('setup-only')
const TIMEOUT_MS = Number(value('timeout', '1800')) * 1000
const post = async (path, body) => {
  const res = await fetch(BASE + '/studio-api' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  return res.json().catch(() => ({}))
}
const state = async () => (await (await fetch(BASE + '/studio-api/state')).json()).state
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const ssh = (command) => new Promise((resolve, reject) => {
  const client = new Client()
  client.on('ready', () => client.exec(command, (err, stream) => {
    if (err) { client.end(); reject(err); return }
    let out = ''
    stream.on('data', (d) => { out += d })
    stream.stderr.on('data', (d) => { out += d })
    stream.on('close', () => { client.end(); resolve(out) })
  })).on('error', reject)
  client.connect(SSH)
})
if (TASK === '' || VARIANT === '') { console.error('用法：--task <卡片 id> --variant "这段提示词" [--run|--setup-only]'); process.exit(2) }
const before = await state()
const card = (before.tasks ?? []).find(item => item.id === TASK)
if (card === undefined) { console.error('没有这张卡：' + TASK); process.exit(2) }
const baseExpert = (before.config.experts ?? []).find(item => item.id === card.expert)
const cases = Array.isArray(card.cases) ? card.cases : []
const stamp = Date.now().toString(36).slice(-4)
if (!RUN && !SETUP_ONLY) {
  console.log(JSON.stringify({
    card: card.code + ' ' + card.title,
    column: card.status,
    baselineExpert: baseExpert === undefined ? '（卡上没专家，直接用变体专家派）' : baseExpert.name,
    variantPrompt: VARIANT,
    judgedBy: ['用例通过数 ' + cases.length + ' 条', '代码事实核对 verified', '卡上评论数（返工痕迹）', '耗时'],
    completion: '读宿主 session 日志的 turn/end，不看 /agents（它不报手动派单）',
    cost: '两个变体 = 两次真实 AI 会话',
  }, null, 2))
  console.log('\n这是 dry-run：没有建专家、没有派单、没有花 token。')
  process.exit(0)
}
const makeExpert = async (name, prompt) => {
  const known = new Set(((await state()).config.experts ?? []).map(item => item.id))
  const saved = await post('/experts/save', { expert: { name, role: 'dev', description: 'A/B 临时专家', prompt, enabled: true } })
  const list = saved.experts ?? saved.state?.config?.experts ?? []
  const created = list.find(item => !known.has(item.id))
  if (created === undefined) throw new Error('建专家失败：' + JSON.stringify(saved).slice(0, 160))
  return String(created.id)
}
const delExpert = async (id) => { await post('/experts/delete', { id }) }
const expertA = await makeExpert('AB-base-' + stamp, String(baseExpert?.prompt ?? ''))
const expertB = await makeExpert('AB-variant-' + stamp, String(baseExpert?.prompt ?? '') + '\n\n' + VARIANT)
console.log('建好两个临时专家：基线=' + expertA + ' 变体=' + expertB)
if (SETUP_ONLY) {
  await delExpert(expertA); await delExpert(expertB)
  console.log('--setup-only：通路验证完成，已删除两个临时专家。')
  process.exit(0)
}
const sessionFile = async (expertId) => {
  const found = await ssh('ls -1t /home/lyf/.dsh/sessions/*/studio-' + TASK + '-' + expertId + '/session.v4.jsonl.zstd 2>/dev/null | head -1')
  return found.trim()
}
const runVariant = async (label, expertId) => {
  const started = Date.now()
  await post('/task/update', { id: TASK, expert: expertId })
  const launched = await post('/agents/run', { id: TASK, expert: expertId })
  if (launched.ok !== true) return { label, ok: false, error: JSON.stringify(launched.error ?? launched).slice(0, 160), ms: 0 }
  let file = ''
  for (let attempt = 0; attempt < 10 && file === ''; attempt += 1) { await sleep(3000); file = await sessionFile(expertId) }
  if (file === '') return { label, ok: false, error: '没有找到会话日志', ms: Date.now() - started }
  let turns = 0
  while (Date.now() - started < TIMEOUT_MS) {
    await sleep(6000)
    turns = Number((await ssh('zstd -dc ' + file + ' 2>/dev/null | grep -c turn/end')).trim() || '0')
    const running = (await ssh('pgrep -fc "studio-' + TASK + '-' + expertId + '" || true')).trim()
    if (turns > 0 && running === '0') break
  }
  const after = await state()
  const done = (after.tasks ?? []).find(item => item.id === TASK) ?? {}
  const list = Array.isArray(done.cases) ? done.cases : []
  const comments = (done.history ?? []).filter(item => item.by === 'agent' && String(item.text ?? '').trim() !== '')
  return {
    label,
    ok: turns > 0,
    ms: Date.now() - started,
    turns,
    passed: list.filter(item => item.result === 'pass').length,
    cases: list.length,
    verified: done.coding?.verified?.ok === true,
    comments: comments.length,
    lastComment: String(comments.slice(-1)[0]?.text ?? '').slice(0, 120),
  }
}
const a = await runVariant('基线', expertA)
await post('/agents/stop', { id: TASK })
const b = await runVariant('变体', expertB)
await post('/agents/stop', { id: TASK })
await delExpert(expertA); await delExpert(expertB)
const line = (row) => [row.label, 'ok=' + row.ok, '轮次 ' + (row.turns ?? 0), '用例 ' + (row.passed ?? 0) + '/' + (row.cases ?? 0), '核对=' + String(row.verified), '评论 ' + (row.comments ?? 0), Math.round((row.ms ?? 0) / 1000) + 's'].join('  ')
console.log(line(a))
console.log(line(b))
if (a.error !== undefined) console.log('基线错误：' + a.error)
if (b.error !== undefined) console.log('变体错误：' + b.error)
const better = (b.passed ?? 0) > (a.passed ?? 0) || (b.verified === true && a.verified !== true)
console.log('\n结论：' + (better ? '变体更好（用例更多或核对通过）' : '这次没有分出高下') + '；两次都是真实会话，样本太小，要反复几次再下判断。')