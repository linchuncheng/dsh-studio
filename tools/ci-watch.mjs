// 等 CI：推完就盯着这次提交的流水线，绿了直接返回，红了把失败步骤的日志尾巴打出来。
//
// 为什么要它：以前我用 `sleep 75` + 轮询匿名 API——慢、还看不到日志（未认证的日志接口 403）。
// 有 gh 之后一次调用就能阻塞到结束：
//
//   node tools/ci-watch.mjs              # 盯 HEAD 这一提交
//   node tools/ci-watch.mjs --timeout 600
//   node tools/ci-watch.mjs --sha <sha>  # 盯指定提交
//
// 退出码：0 = 绿；1 = 红（已打印失败日志）；2 = 超时/找不到这次 run。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const argv = process.argv.slice(2)
const flag = name => {
  const index = argv.indexOf(name)
  return index >= 0 ? String(argv[index + 1] ?? '') : ''
}
const timeoutSec = Math.max(60, Number(flag('--timeout')) || 900)

const gh = async (args, options = {}) => {
  try {
    const { stdout, stderr } = await run('gh', args, { maxBuffer: 8 * 1024 * 1024, ...options })
    return { ok: true, out: stdout, err: stderr }
  } catch (error) {
    return { ok: false, out: String(error?.stdout ?? ''), err: String(error?.stderr ?? error?.message ?? error) }
  }
}
const git = async args => (await run('git', args)).stdout.trim()

const sha = flag('--sha') || await git(['rev-parse', 'HEAD'])
const short = sha.slice(0, 7)
console.log(`等 CI：${short}`)

/** 刚 push 完 GitHub 可能还没注册这次 run，所以先短轮询找 run id（只等这个，不等流水线）。 */
const findRun = async () => {
  const started = Date.now()
  while (Date.now() - started < 60_000) {
    const list = await gh(['run', 'list', `--commit=${sha}`, '--limit', '1', '--json', 'databaseId,status,conclusion,workflowName,displayTitle'])
    if (list.ok) {
      const rows = JSON.parse(list.out || '[]')
      if (rows.length > 0) return rows[0]
    }
    await new Promise(resolve => setTimeout(resolve, 5000))
  }
  return null
}

const found = await findRun()
if (found === null) {
  console.error(`✖ 60 秒内没找到 ${short} 的 workflow run。检查：git push 是否真的推上去了（git status / git log origin/main -1）`)
  process.exit(2)
}
console.log(`run ${found.databaseId}（${found.workflowName ?? 'ci'}）当前状态 ${found.status}`)

// --exit-status：流水线失败时退出码非 0，不用自己解析
const watch = await run('gh', ['run', 'watch', String(found.databaseId), '--exit-status', '--interval', '10'], {
  maxBuffer: 8 * 1024 * 1024,
  timeout: timeoutSec * 1000,
}).then(result => ({ ok: true, out: result.stdout }))
  .catch(error => ({ ok: false, timedOut: error?.killed === true || error?.code === 'ETIMEDOUT', out: String(error?.stdout ?? '') }))

if (watch.timedOut === true) {
  console.error(`✖ ${timeoutSec} 秒还没跑完：${found.databaseId}（可以再加 --timeout）`)
  process.exit(2)
}

const view = await gh(['run', 'view', String(found.databaseId), '--json', 'status,conclusion,url'])
let conclusion = ''
let url = ''
try {
  const parsed = JSON.parse(view.out || '{}')
  conclusion = String(parsed.conclusion ?? parsed.status ?? '')
  url = String(parsed.url ?? '')
} catch { /* 拿不到就当没绿 */ }

if (conclusion === 'success') {
  console.log(`✓ CI 绿了：${url}`)
  process.exit(0)
}

console.error(`✖ CI ${conclusion || '失败'}：${url}`)
console.error('--- 失败步骤日志（尾部）---')
const failed = await gh(['run', 'view', String(found.databaseId), '--log-failed'])
const text = (failed.out || failed.err || '').trim()
console.error(text === '' ? '（gh 没给出失败日志：可能是 job 启动失败，去网页看）' : text.split('\n').slice(-60).join('\n'))
process.exit(1)
