// AI Coding 执行记录「自报值 vs 仓库事实」的对账。纯函数，方便单测；
// 取数（MR / changes / commits / 流水线单测）在 integrations 里，这里只管比。
//
// 事实的四个层次，从弱到强：
//   1. 数量对得上（自报 N 个文件 / M 个提交，MR 里也是 N / M）——只能证明"差不多"；
//   2. 逐条对得上（自报的每个 sha 都能在 MR 的提交列表里找到）——这才是"这些提交真在这个 MR 里"；
//   3. 流水线跑过（pipeline 状态）——证明代码被 CI 编译/测试过；
//   4. 单测数字对得上（CI 的 test_report vs 自报的单测通过数）——证明"我跑过了"不是嘴上说说。
// 1 只有能被 2/3/4 佐证时才可信，所以这里尽量把它们都取回来写进 facts。

/** 提交集合比对：自报的 sha 和 MR 里的 sha 用前缀对（自报常是 7~40 位，GitLab 的 short_id 是 8 位）。 */
export function missingDeclaredCommits(declared, actual) {
  const norm = (value) => String(value ?? '').trim().toLowerCase().slice(0, 12)
  const pool = (Array.isArray(actual) ? actual : [])
    .map((item) => norm(item?.sha ?? item?.id))
    .filter((item) => item !== '')
  const out = []
  for (const item of Array.isArray(declared) ? declared : []) {
    const sha = norm(item?.sha ?? item?.id)
    if (sha === '') continue
    const hit = pool.some((entry) => entry.startsWith(sha) || sha.startsWith(entry))
    if (!hit && !out.includes(sha)) out.push(sha)
  }
  return out
}

/** 把对账结果收敛成能落库的形状（写进 card.coding.gitlab）。白名单跟对账逻辑放一起，改字段只改一处。 */
export function sanitizeGitlabFacts(raw) {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null
  const number = (value) => Math.max(0, Number(value) || 0)
  return {
    at: Number(raw.at) || 0,
    state: String(raw.state ?? '').slice(0, 20),
    title: String(raw.title ?? '').slice(0, 200),
    pipeline: raw.pipeline === null || raw.pipeline === undefined ? null : String(raw.pipeline).slice(0, 20),
    files: { declared: number(raw.files?.declared), actual: number(raw.files?.actual) },
    commits: { declared: number(raw.commits?.declared), actual: number(raw.commits?.actual) },
    // MR 里的逐条提交（事实）：自报的 sha 能不能在这里找到，是「提交数对得上」之上的一层证据。
    commitList: (Array.isArray(raw.commitList) ? raw.commitList : []).slice(0, 30).map((item, index) => ({
      id: String(item?.id ?? `c${index + 1}`).slice(0, 60),
      sha: String(item?.sha ?? '').slice(0, 40),
      title: String(item?.title ?? '').slice(0, 160),
      author: String(item?.author ?? '').slice(0, 60),
    })),
    // 流水线跑出来的单测结果（test_report）或任务汇总（jobs）；没有就是 null——"没证据"不等于"没跑过"。
    ci: raw.ci === null || raw.ci === undefined
      ? null
      : {
        total: number(raw.ci.total),
        passed: number(raw.ci.passed),
        failed: number(raw.ci.failed),
        skipped: number(raw.ci.skipped),
        source: String(raw.ci.source ?? '').slice(0, 20),
      },
    missingCommits: (Array.isArray(raw.missingCommits) ? raw.missingCommits : []).map((item) => String(item).slice(0, 40)).slice(0, 6),
    mismatches: (Array.isArray(raw.mismatches) ? raw.mismatches : []).map((item) => String(item).slice(0, 120)).slice(0, 6),
  }
}

/** 把自报的文件数、提交数、提交明细和单测数，跟 MR 里的事实比一遍，返回可直接写进 card.coding.gitlab 的结果。 */
export function compareCodingFacts(coding, mr, detail, now = Date.now()) {
  const declaredFiles = Array.isArray(coding?.files) ? coding.files.length : 0
  const declaredCommits = Array.isArray(coding?.commits) ? coding.commits.length : 0
  const actualFiles = Array.isArray(detail?.changes?.files) ? detail.changes.files.length : 0
  const actualCommits = Number(detail?.changes?.commits) || 0
  const commitList = Array.isArray(detail?.commits) ? detail.commits : []
  const ci = detail?.ci ?? null
  const mismatches = []
  if (declaredFiles !== actualFiles) mismatches.push(`自报 ${declaredFiles} 个文件，MR 里是 ${actualFiles} 个`)
  if (declaredCommits !== actualCommits) mismatches.push(`自报 ${declaredCommits} 个提交，MR 里是 ${actualCommits} 个`)
  const missingCommits = missingDeclaredCommits(coding?.commits, commitList)
  if (commitList.length > 0 && missingCommits.length > 0) {
    mismatches.push(`自报的 ${missingCommits.length} 个提交在 MR 里找不到：${missingCommits.map((sha) => sha.slice(0, 8)).join('、')}`)
  }
  // 单测：只有 CI 真的报过测试结果、且自己也写了单测数时才比，缺一边就只是"没证据"，不算造假。
  // source 是 jobs 时那是任务数不是用例数，拿它跟单测数比会冤枉人，所以只认 test_report。
  const declaredTests = Number(coding?.unitTests?.total) || 0
  const declaredPassed = Number(coding?.unitTests?.passed) || 0
  const ciTotal = Number(ci?.total) || 0
  if (ci !== null && ci.source === 'test_report' && ciTotal > 0 && declaredTests > 0 && (declaredTests !== ciTotal || declaredPassed !== (Number(ci.passed) || 0))) {
    mismatches.push(`自报单测 ${declaredPassed}/${declaredTests}，CI 是 ${Number(ci.passed) || 0}/${ciTotal}`)
  }
  // 比的形状和落库的形状走同一个白名单，避免"界面看到的"和"存下来的"不一样。
  return sanitizeGitlabFacts({
    at: now,
    state: mr?.state,
    title: mr?.title,
    pipeline: detail?.pipeline === null || detail?.pipeline === undefined ? null : detail.pipeline.status,
    files: { declared: declaredFiles, actual: actualFiles },
    commits: { declared: declaredCommits, actual: actualCommits },
    commitList,
    ci,
    missingCommits,
    mismatches,
  })
}
