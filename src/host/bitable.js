// 把看板卡片镜像到飞书多维表格：一条 Record = 一张卡。
// 只负责“卡片 → 记录字段”和分批；真正跑 lark-cli 在 index.js 里（要 markHealth、要复用 runCommand）。
//
// 表里需要有这些列（名字要对得上）：编号 / 标题 / 状态 / 负责人 / 优先级 / 需求 / 更新时间

export const BITABLE_FIELDS = ['编号', '标题', '状态', '负责人', '优先级', '需求', '更新时间']
export const BATCH_LIMIT = 200

export function cardToRecord(task) {
  return {
    '编号': String(task?.code ?? '').trim() || String(task?.id ?? ''),
    '标题': String(task?.title ?? '').slice(0, 200),
    '状态': String(task?.status ?? ''),
    '负责人': String(task?.expert ?? ''),
    '优先级': String(task?.priority ?? ''),
    '需求': String(task?.requirementId ?? ''),
    '更新时间': Number(task?.updatedAt) > 0 ? new Date(Number(task.updatedAt)).toISOString() : '',
  }
}

/** 一批最多 200 条，超过就分批（同一张表要串行写，否则会撞并发错误）。 */
export function recordsPayload(cards) {
  const list = (Array.isArray(cards) ? cards : []).map(cardToRecord)
  const batches = []
  for (let index = 0; index < list.length; index += BATCH_LIMIT) batches.push(list.slice(index, index + BATCH_LIMIT))
  return batches
}

/**
 * 真正镜像：按 200 条一批串行写多维表格。
 * runCommand / markHealth 由 index.js 注入（子模块不反向依赖宿主）。
 */
export async function mirrorCards(store, config, options, deps) {
  // 用别名接收注入能力：同名的 runCommand / markHealth 属于宿主模块，子模块不该 import 它们
  const { runCommand: run, markHealth: health } = deps ?? {}
  const gaps = mirrorConfigGaps(config)
  if (gaps.length > 0) return { ok: false, error: '还没配多维表格：' + gaps.join('、') + '（设置 → 飞书机器人）' }
  const requirementId = String(options?.requirementId ?? '')
  const cards = (store.snapshot().tasks ?? []).filter(task => requirementId === '' || task.requirementId === requirementId)
  const batches = recordsPayload(cards)
  if (options?.dryRun === true) return { ok: true, dryRun: true, cards: cards.length, batches: batches.map(batch => batch.length) }
  const probe = await run('lark-cli', ['--version'], 8000)
  if (!probe.ok) {
    health?.('feishu', 'fail', '没有可用的 lark-cli')
    return { ok: false, error: '服务器上没有可用的 lark-cli，镜像需要它在服务器上并完成用户授权' }
  }
  const created = []
  for (const batch of batches) {
    const result = await run('lark-cli', [
      'base', '+record-batch-create',
      '--base-token', String(config.feishu.baseToken).trim(),
      '--table-id', String(config.feishu.tableId).trim(),
      '--json', JSON.stringify({ create_records: batch }),
      '--as', 'user',
    ], 60000)
    if (!result.ok) {
      health?.('feishu', 'fail', '多维表格写入失败：' + String(result.stderr || '').slice(0, 160))
      return { ok: false, error: '多维表格写入失败：' + String(result.stderr || result.stdout || '').slice(0, 300), created }
    }
    let parsed = {}
    try { parsed = JSON.parse(String(result.stdout || '{}')) } catch { parsed = {} }
    for (const id of (parsed.record_id_list ?? [])) created.push(String(id))
  }
  health?.('feishu', 'ok', '多维表格镜像 ' + created.length + ' 条')
  return { ok: true, cards: cards.length, created: created.length, batches: batches.map(batch => batch.length) }
}

/** 没配表就直说，别让调用方以为写进去了。 */
export function mirrorConfigGaps(config) {
  const gaps = []
  if (String(config?.feishu?.baseToken ?? '').trim() === '') gaps.push('baseToken（多维表格 app_token）')
  if (String(config?.feishu?.tableId ?? '').trim() === '') gaps.push('tableId（数据表 id）')
  return gaps
}
