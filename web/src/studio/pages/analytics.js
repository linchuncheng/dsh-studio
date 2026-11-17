/* Page-level components lifted out of client.src.js; shared handles come from the studio context. */

import { client } from '../context.js'
import { BurnChart, ProgressField } from '../charts.js'
import { fmtTime } from '../format.js'
import { StatCard, ChartCard, BarRow } from '../../boardui/chart-card'
import { TaskList, TaskRow } from '../../boardui/task-list'
import { Button as BoarduiButton } from '../../boardui/index'

const CTX_COLORS = ['#4A5699', '#C45FA0', '#6277BA', '#F39A2B', '#94a3b8']
const CTX_NUM = { width: 56, textAlign: 'right', fontSize: 12, flexShrink: 0 }
const CTX_ROW = { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 6px', borderTop: '1px solid var(--ds-line)', cursor: 'pointer' }
const CTX_DETAIL = { padding: '6px 8px 12px', borderTop: '1px dashed var(--ds-line)' }
const CTX_STACK = { display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: 'var(--ds-line)', margin: '4px 0 10px' }
const CTX_LEGEND = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12 }
const CTX_CHIP = { display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 10px', border: '1px solid var(--ds-line)', borderRadius: 8, minWidth: 84 }

export function AnalyticsPage({ state, onOpenTask, onFixPrices }) {
  const { h, React, api, SelectField } = client()
  const [days, setDays] = React.useState(30)
  const [project, setProject] = React.useState('')
  const [data, setData] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [load, setLoad] = React.useState(null)
  const [burn, setBurn] = React.useState(null)
  const [costs, setCosts] = React.useState(null)
  // 价目表行数：/costs 的 budget 里带着 config.costs.prices —— 就是设置页里维护的那张表。
  const priceCount = Array.isArray(costs?.budget?.prices) ? costs.budget.prices.length : 0
  const [quality, setQuality] = React.useState(null)
  // 上下文洞察：每个专家的窗口占用峰值 / 回合 / 工具调用 / 重试（读会话日志，不额外花 token）
  const [contexts, setContexts] = React.useState(null)
  const [ctxDetail, setCtxDetail] = React.useState(null)
  const [ctxOpen, setCtxOpen] = React.useState('')
  // 折线：每轮 input+cacheRead 的相对高度（0-56 的 viewBox）
  const trendPointsOf = (trend) => {
    const list = Array.isArray(trend) ? trend : []
    if (list.length === 0) return ''
    const max = Math.max(1, ...list)
    return list.map((value, index) => `${(index / Math.max(1, list.length - 1)) * 560},${56 - (value / max) * 50}`).join(' ')
  }
  const openContext = async (expert) => {
    if (ctxOpen === expert) { setCtxOpen(''); return }
    setCtxOpen(expert)
    setCtxDetail(null)
    try { setCtxDetail(await api('/contexts/session', { expert })) } catch (cause) { setCtxDetail({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }) }
  }

  React.useEffect(() => {
    let alive = true
    api('/contexts', {})
      .then(out => { if (alive) setContexts(out) })
      .catch(() => { if (alive) setContexts({ rows: [], totals: { experts: 0, sessions: 0, peak: 1 } }) })
    return () => { alive = false }
  }, [state.revision])

  React.useEffect(() => {
    let alive = true
    const query = `/analytics?days=${days}${project === '' ? '' : `&project=${encodeURIComponent(project)}`}`
    api(query)
      .then(out => { if (alive) { setData(out.analytics); setError(null) } })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)) })
    const suffix = project === '' ? '' : `&project=${encodeURIComponent(project)}`
    Promise.all([api('/workload'), api(`/burndown?days=14${suffix}`), api('/costs'), api('/quality')])
      .then(([loadOut, burnOut, costOut, qualityOut]) => {
        if (!alive) return
        setLoad(loadOut.workload ?? null)
        setBurn(burnOut.burndown ?? null)
        setCosts({ ...(costOut.costs ?? {}), budget: costOut.budget ?? null, usage: costOut.usage ?? null })
        setQuality(qualityOut.quality ?? null)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [days, project, state.revision])

  if (error !== null) return h('div', { className: 'ds-body' }, h('div', { className: 'ds-err' }, error))
  if (data === null) return h('div', { className: 'ds-loading' }, '正在统计…')

  const pct = value => `${Math.round((value ?? 0) * 100)}%`
  const fmtSpan = value => {
    const days = Number(value) || 0
    if (days <= 0) return '0'
    if (days * 1440 < 60) return `${Math.max(1, Math.round(days * 1440))} 分钟`
    if (days < 1) return `${(days * 24).toFixed(1)} 小时`
    return `${days.toFixed(1)} 天`
  }
  // KPI 方块换成我们自己写的 StatCard（BoardUI 的 stats 卡是 Pro，按公开行为自研）
  const kpi = (label, value, hint, warn) => h(StatCard, { label, value, hint, warn: warn === true })

  const cycleTotal = (data.cycle.buckets ?? []).reduce((sum, bucket) => sum + bucket.count, 0)
  const peak = Math.max(1, ...(data.throughput ?? []).map(point => point.count), ...(data.cycle.buckets ?? []).map(bucket => bucket.count))
  const maxDwell = Math.max(0.001, ...(data.columns ?? []).map(column => column.avgDays))
  // 面板底部的小注：把每块面板补满（等高栅格里不会被撑出一片空白），顺带给一句「所以呢」
  const slowestColumn = (data.columns ?? []).reduce((best, column) => (best === null || column.avgDays > best.avgDays ? column : best), null)
  const done14 = (data.throughput ?? []).reduce((sum, point) => sum + point.count, 0)
  const enabledExperts = (load?.experts ?? []).filter(item => item.enabled)
  const loadOpen = enabledExperts.reduce((sum, item) => sum + item.open, 0)
  const loadOverdue = enabledExperts.reduce((sum, item) => sum + (item.overdue ?? 0), 0)
  const burnSeries = burn?.series ?? []
  const burnTail = burnSeries.length === 0 ? null : burnSeries[burnSeries.length - 1]

  // 上下文洞察面板：数据已经算好，这里只负责画（内联样式，避免再引一套 CSS）
  const renderContextDetail = () => {
    if (ctxDetail === null) return h('div', { className: 'ds-hint', style: CTX_DETAIL }, '正在算这次会话的上下文构成…')
    if (ctxDetail.ok !== true) return h('div', { className: 'ds-hint', style: CTX_DETAIL }, ctxDetail.error ?? '读不到')
    const data = ctxDetail.breakdown ?? {}
    const parts = Array.isArray(data.parts) ? data.parts : []
    const head = '最近一次会话 ' + fmtTime(Math.round(data.at)) + ' · 峰值 ' + Math.round(data.peak / 1000) + 'k / 窗口 ' + Math.round((data.window ?? 0) / 1000) + 'k（' + (data.percent ?? 0) + '%）· 全程约 ' + Math.round(data.approxTokens / 1000) + 'k token'
    const stack = h('div', { style: CTX_STACK }, parts.map((part, index) => h('span', { key: part.key, title: part.label + ' ' + part.percent + '%', style: { width: Math.max(part.percent, 0.5) + '%', background: CTX_COLORS[index % CTX_COLORS.length] } })))
    const legend = h('div', { style: CTX_LEGEND }, parts.map((part, index) => h('div', { key: part.key, style: { display: 'flex', alignItems: 'center', gap: 6 } },
      h('span', { style: { width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: CTX_COLORS[index % CTX_COLORS.length] } }),
      h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, part.label),
      h('span', { style: { width: 34, textAlign: 'right' } }, part.percent + '%'),
      h('span', { className: 'ds-hint', style: { width: 58, textAlign: 'right' } }, Math.round(part.chars / 1000) + 'k 字'))))
    const trend = Array.isArray(data.trend) ? data.trend : []
    const drops = Array.isArray(data.drops) ? data.drops : []
    // 压缩点：曲线掉下去的那一轮画一条竖虚线 + 一个点，标出掉了多少
    const marks = drops.map((drop, index) => h('line', {
      key: 'drop-' + index,
      x1: (drop.index / Math.max(1, trend.length - 1)) * 560,
      y1: 0,
      x2: (drop.index / Math.max(1, trend.length - 1)) * 560,
      y2: 56,
      stroke: CTX_COLORS[3],
      strokeWidth: 1,
      strokeDasharray: '3 3',
      vectorEffect: 'non-scaling-stroke',
    }))
    const chart = h('svg', { style: { display: 'block', width: '100%', height: 52 }, viewBox: '0 0 560 60', preserveAspectRatio: 'none' },
      h('polygon', { points: '0,60 ' + trendPointsOf(trend) + ' 560,60', fill: CTX_COLORS[0], opacity: 0.12 }),
      h('polyline', { points: trendPointsOf(trend), fill: 'none', stroke: CTX_COLORS[0], strokeWidth: 1.6, vectorEffect: 'non-scaling-stroke' }),
      marks)
    const engine = ctxDetail.engine ?? null
    const engineLine = engine === null
      ? null
      : h('div', { className: 'ds-hint', style: { marginTop: 4 } }, '引擎计量（派单收尾取自宿主 tokenMeasurement）：total ' + Math.round(engine.total / 1000) + 'k · 输入 ' + Math.round(engine.input / 1000) + 'k · 缓存读 ' + Math.round(engine.cacheRead / 1000) + 'k · 输出 ' + Math.round(engine.output / 1000) + 'k')
    return h('div', { style: CTX_DETAIL }, h('div', { className: 'ds-hint', style: { marginBottom: 6 } }, head), stack, legend, engineLine,
      h('div', { className: 'ds-hint', style: { margin: '10px 0 2px' } }, '每轮上下文增长'), chart,
      h('div', { className: 'ds-hint' }, trend.length + ' 个采样点 · ' + (drops.length === 0 ? '全程没有压缩' : '压缩 ' + drops.length + ' 次（虚线处掉了 ' + drops.map(drop => drop.drop + '%').join(' / ') + '）')))
  }
  const renderContextRow = (row) => {
    const share = Math.max(2, Math.round((row.peak / Math.max(1, contexts?.totals?.peak ?? 1)) * 100))
    const open = ctxOpen === row.expert
    const main = h('div', { onClick: () => void openContext(row.expert), style: CTX_ROW },
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { fontWeight: 600, fontSize: 13 } }, row.expert),
        h('div', { className: 'ds-hint', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          (row.model === '' ? '模型未知' : row.model) + ' · ' + row.sessions + ' 个会话 · 最近 ' + fmtTime(Math.round(row.lastAt)))),
      h('div', { style: { width: 130, height: 6, background: 'var(--ds-line)', borderRadius: 3, overflow: 'hidden', flexShrink: 0 } },
        h('span', { style: { display: 'block', height: '100%', width: Math.max(2, row.percent) + '%', background: row.percent >= 80 ? CTX_COLORS[3] : CTX_COLORS[2] } })),
      h('div', { style: CTX_NUM }, Math.round(row.peak / 1000) + 'k'),
      h('div', { style: { ...CTX_NUM, width: 44, color: row.percent >= 80 ? CTX_COLORS[3] : 'inherit' } }, (row.window > 0 ? row.percent + '%' : '—')),
      h('div', { style: { ...CTX_NUM, color: row.retries > 100 ? CTX_COLORS[3] : 'inherit' } }, '重试 ' + row.retries),
      h('div', { style: { ...CTX_NUM, color: row.alert === '' ? 'inherit' : CTX_COLORS[3] } }, '工具 ' + row.toolShare + '%'),
      h('div', { style: { width: 12, textAlign: 'right', fontSize: 11, opacity: 0.6 } }, open ? '▲' : '▼'))
    return h('div', { key: row.expert }, main, open ? renderContextDetail() : null)
  }
  const renderContextPanel = () => {
    const totals = contexts?.totals ?? {}
    const rows = Array.isArray(contexts?.rows) ? contexts.rows : []
    const head = h('div', { className: 'ds-panel-head' }, '上下文洞察（每个专家）',
      h('span', { className: 'ds-hint', style: { marginLeft: 'auto' } }, contexts === null ? '正在读会话日志…' : '点开一行看这次会话被什么占满'))
    const chip = (label, text, warn) => h('div', { style: CTX_CHIP },
      h('span', { className: 'ds-hint', style: { fontSize: 11 } }, label),
      h('span', { style: { fontSize: 15, fontWeight: 600, color: warn ? CTX_COLORS[3] : 'inherit' } }, text))
    const kpis = h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', paddingBottom: 10 } },
      chip('专家', String(totals.experts ?? 0)), chip('会话', String(totals.sessions ?? 0)),
      chip('最高窗口', Math.round((totals.peak ?? 0) / 1000) + 'k', false),
      chip('最高占用', (totals.percent ?? 0) + '%', (totals.percent ?? 0) >= 80),
      chip('工具喂胖', String(totals.alerts ?? 0), (totals.alerts ?? 0) > 0))
    const body = contexts === null ? h('div', { className: 'ds-hint' }, '正在读会话日志…')
      : rows.length === 0 ? h('div', { className: 'ds-hint' }, '还没有专家会话记录。')
        : h('div', null, kpis, rows.map(renderContextRow))
    return h('div', { className: 'ds-panel', style: { marginTop: 12 } }, head, h('div', { className: 'ds-panel-body' }, body))
  }

  return h('div', { className: 'ds-body' },
    h('div', { className: 'ds-board-bar' },
      h('span', { className: 'ds-hint' }, `统计口径：最近 ${data.days} 天 · ${data.scope.tasks} 张卡（${data.scope.done} 张已完成）`),
      h(SelectField, {
        className: 'ds-select', value: project, style: { width: 'auto', minWidth: 130 },
        onChange: event => setProject(event.target.value),
      },
      h('option', { value: '' }, '全部项目'),
      (state.config.projects ?? []).map(item => h('option', { key: item.id, value: item.id }, `${item.key ? `[${item.key}] ` : ''}${item.name}`))),
      h(SelectField, {
        className: 'ds-select', value: String(days), style: { width: 'auto', minWidth: 96 },
        onChange: event => setDays(Number(event.target.value)),
      },
      h('option', { value: '7' }, '近 7 天'),
      h('option', { value: '30' }, '近 30 天'),
      h('option', { value: '90' }, '近 90 天')),
    ),
    h('div', { className: 'ds-an-sec' },
      '质量',
      h('span', { className: 'ds-hint' }, '先看这四个数：返工多不多、多久能做完、AI 交的东西有多少被人验收'),
    ),
    h('div', { className: 'ds-kpi-grid' },
      kpi('一次通过率', pct(data.rework.firstPassRate), '完成的卡里，从没被退回过的比例', data.rework.firstPassRate < 0.6),
      kpi('返工率', pct(data.rework.rate), `${data.rework.reworked}/${data.rework.moved} 张卡倒退过`, data.rework.rate > 0.3),
      kpi('中位周期', fmtSpan(data.cycle.medianDays), `平均 ${fmtSpan(data.cycle.avgDays)} · P90 ${fmtSpan(data.cycle.p90Days)}`),
      kpi('AI 交付物采纳率', pct(data.ai.acceptedRate), `${data.ai.accepted}/${data.ai.artifactsAi} 件已被验收 · 占全部交付物 ${pct(data.ai.aiShare)}`),
    ),
    h('div', { className: 'ds-an-sec' },
      '流程与产能',
      h('span', { className: 'ds-hint' }, '完成的卡各花了多久 · 时间都卡在哪一列 · 最近每天完成几张'),
    ),
    h('div', { className: 'ds-an-grid' },
      h('div', { className: 'ds-span-4', style: { display: 'grid', gap: 12, gridTemplateRows: 'auto 1fr', alignContent: 'stretch' } },
        h(ChartCard, {
          title: '周期分布',
          aside: `${cycleTotal} 张已完成`,
          hint: cycleTotal === 0 ? '这个区间里还没有完成的卡。' : '',
          footer: `平均 ${fmtSpan(data.cycle.avgDays)} · 中位 ${fmtSpan(data.cycle.medianDays)} · P90 ${fmtSpan(data.cycle.p90Days)}`,
        },
          (data.cycle.buckets ?? []).map(bucket => h(BarRow, {
            key: bucket.id,
            label: bucket.label,
            ratio: bucket.count / peak,
            display: `${bucket.count}`,
            title: `${bucket.label}：${bucket.count} 张`,
          })),
        ),
        h('div', { className: 'ds-panel' },
          h('div', { className: 'ds-panel-head' }, '近 14 天完成'),
          h('div', { className: 'ds-panel-body' },
            h('div', { className: 'ds-spark' },
              (data.throughput ?? []).map((point, index) => h('div', { key: point.day, className: 'ds-spark-col', title: `${point.day}：完成 ${point.count} 张` },
                h('div', { className: 'ds-spark-bar', style: { height: `${Math.round((point.count / Math.max(1, Math.max(...data.throughput.map(item => item.count)))) * 100)}%` } }),
                h('span', { className: 'ds-spark-day' }, index % 2 === 0 ? point.day : ''),
              )),
            ),
            h('div', { className: 'ds-an-foot' }, `近 14 天合计 ${done14} 张 · 日均 ${(done14 / 14).toFixed(1)} 张 · 空着的日子是没卡完成，不是没数据`),
          ),
        ),
      ),
      h('div', { className: 'ds-span-8' },
        h(ChartCard, {
          title: '每列停留（平均）',
          aside: slowestColumn === null ? '' : `最慢：${slowestColumn.label} ${fmtSpan(slowestColumn.avgDays)}`,
          footer: slowestColumn === null ? '还没有数据。' : `最慢的是「${slowestColumn.label}」：平均 ${fmtSpan(slowestColumn.avgDays)}，时间主要压在这一列。`,
        },
          (data.columns ?? []).map(column => h(BarRow, {
            key: column.status,
            label: column.label,
            ratio: column.avgDays / maxDwell,
            display: fmtSpan(column.avgDays),
            tone: 'warn',
            title: `${column.label}：平均停留 ${fmtSpan(column.avgDays)} · 当前 ${column.cards} 张`,
          })),
        ),
      ),
    ),
    h('div', { className: 'ds-an-sec' },
      '交付、成本与返工',
      h('span', { className: 'ds-hint' }, 'AI 交的东西被验收多少 · 谁手上压得最多 · 派单花了多少 · 哪些卡来回折腾'),
    ),
    h('div', { className: 'ds-an-grid' },
      h('div', { className: 'ds-panel ds-span-4' },
        h('div', { className: 'ds-panel-head' }, '按专家看质量', h('span', { className: 'ds-hint' }, '派单量来自运行日志（内存最近 300 条）')),
        h('div', { className: 'ds-panel-body' },
          quality === null
            ? h('div', { className: 'ds-hint' }, '还没算出来')
            : (quality.experts ?? []).length === 0
              ? h('div', { className: 'ds-hint' }, '还没有派出过活')
              : h('div', null,
                (quality.experts ?? []).slice(0, 8).map(item => h('div', { className: 'ds-an-kv', key: item.expert },
                  h('span', {}, `${item.label} · ${item.dispatched} 次`),
                  h('b', { 'data-warn': item.reworkRate !== null && item.reworkRate >= 40 ? '1' : '0' },
                    `${item.done}/${item.cards} 完成 · 一次过 ${item.firstPassRate === null ? '—' : item.firstPassRate + '%'}`),
                )),
                h('div', { className: 'ds-hint', style: { marginTop: 6 } },
                  `合计：派单 ${quality.totals.dispatched} 次 · 平均耗时 ${quality.totals.avgMs > 0 ? Math.round(quality.totals.avgMs / 1000) + ' 秒' : '—'} · 返工率 ${quality.totals.reworkRate === null ? '—' : quality.totals.reworkRate + '%'} · AI 失败 ${quality.totals.failures} 次 · 缺陷重开 ${quality.totals.reopens} 次`),
                h('div', { className: 'ds-hint' }, quality.cost?.note ?? ''),
              ),
        ),
      ),
      h('div', { className: 'ds-panel ds-span-4' },
        h('div', { className: 'ds-panel-head' }, 'AI 产出质量'),
        h('div', { className: 'ds-panel-body' },
          h('div', { className: 'ds-an-kv' }, h('span', {}, '交付物由专家登记'), h('b', {}, `${data.ai.artifactsAi} / ${data.ai.artifactsTotal}`)),
          h('div', { className: 'ds-an-kv' }, h('span', {}, '其中被人验收'), h('b', {}, `${data.ai.accepted}（${pct(data.ai.acceptedRate)}）`)),
          h('div', { className: 'ds-an-kv' }, h('span', {}, '缺正文（只有标题）'), h('b', { 'data-warn': data.ai.emptyBody > 0 ? '1' : '0' }, `${data.ai.emptyBody}`)),
          h('div', { className: 'ds-an-kv' }, h('span', {}, '写码卡有执行记录'), h('b', {}, `${data.ai.codingTasks}`)),
          h('div', { className: 'ds-an-kv' }, h('span', {}, '评审通过 / 要求修改'), h('b', {}, `${data.ai.codingApproved} / ${data.ai.codingChanges}`)),
          h('div', { className: 'ds-an-kv' }, h('span', {}, '单测通过'), h('b', {}, `${data.ai.unitPassed}/${data.ai.unitTests}（${pct(data.ai.unitPassRate)}）`)),
          h('div', { className: 'ds-an-kv' }, h('span', {}, '已合并'), h('b', {}, `${data.ai.merged}`)),
        ),
      ),
      h('div', { className: 'ds-panel ds-span-4' },
        h('div', { className: 'ds-panel-head' }, '团队负载', h('span', { className: 'ds-hint', style: { marginLeft: 'auto' } }, `${load?.busy ?? 0} 位在跑`)),
        h('div', { className: 'ds-panel-body' },
          (load?.experts ?? []).filter(item => item.enabled).length === 0
            ? h('div', { className: 'ds-empty' }, '还没有启用的专家。')
            : (load?.experts ?? []).filter(item => item.enabled).map(item => h('div', { key: item.id, className: 'ds-an-row' },
              h('span', { className: 'ds-an-name' }, `${item.emoji} ${item.name}`),
              // 这里原来是自己画的 .ds-an-track/.ds-an-fill —— 同一页里出现了两条进度条实现
              // （另一条走 kit('ProgressBar')）。统一交给 ProgressField，它渲染官方 Meter。
              h(ProgressField, {
                value: Math.round((item.open / Math.max(1, ...(load.experts ?? []).map(entry => entry.open))) * 100),
              }),
              h('span', { className: 'ds-an-num' }, `在办 ${item.open}${item.running > 0 ? ` · 跑 ${item.running}` : ''}${item.overdue > 0 ? ` · 逾期 ${item.overdue}` : ''}`),
            )),
          h('div', { className: 'ds-an-foot' },
            `${enabledExperts.length} 位在岗，手上合计 ${loadOpen} 张${loadOverdue > 0 ? `，其中 ${loadOverdue} 张逾期` : '，没有逾期的'}`),
        ),
      ),
      h('div', { className: 'ds-panel ds-span-4' },
        h('div', { className: 'ds-panel-head' }, '燃尽（近 14 天剩余）', h('span', { className: 'ds-hint', style: { marginLeft: 'auto' } }, `现在还剩 ${burn?.now?.remaining ?? 0} 张`)),
        h('div', { className: 'ds-panel-body' },
          h(BurnChart, { series: burn?.series ?? [] }),
          h('div', { className: 'ds-an-foot' },
            burnTail === null
              ? '还没有数据。'
              : `累计建 ${burnTail.created} · 累计完成 ${burnTail.done} · 现在还剩 ${burnTail.remaining} 张`),
        ),
      ),
      h('div', { className: 'ds-panel ds-span-4' },
        h('div', { className: 'ds-panel-head' }, 'AI 执行成本', h('span', { className: 'ds-hint', style: { marginLeft: 'auto' } }, `${costs?.total ?? 0} 次派单`)),
        h('div', { className: 'ds-panel-body' },
          costs?.usage?.totals === null || costs?.usage?.totals === undefined
            ? null
            : h('div', { className: 'ds-an-kv' }, h('span', {}, 'token 用量'),
              h('b', {}, (costs.usage.totals.total / 1000).toFixed(1) + 'k'),
              h('span', { className: 'ds-hint', style: { marginLeft: 8 } },
                '入 ' + (costs.usage.totals.input / 1000).toFixed(1) + 'k · 出 ' + (costs.usage.totals.output / 1000).toFixed(1) + 'k · 缓存 ' + (costs.usage.totals.cacheRead / 1000).toFixed(1) + 'k')),
          costs?.usage?.totals === null || costs?.usage?.totals === undefined
            ? null
            : h('div', { className: 'ds-an-kv' }, h('span', {}, '预估花费'),
              h('b', {}, costs.usage.totals.cost === null ? '未知（价目表没配）' : '¥' + Number(costs.usage.totals.cost).toFixed(2)),
              (costs.usage.totals.unknownCalls ?? 0) > 0
                ? h('span', { className: 'ds-hint', style: { marginLeft: 8 } }, costs.usage.totals.unknownCalls + ' 次无价目')
                : null),
          h('div', { className: 'ds-an-kv' }, h('span', {}, '平均执行时长'), h('b', {}, `${Math.round((costs?.avgMs ?? 0) / 1000)} 秒`)),
          (costs?.byModel ?? []).slice(0, 3).map(item => h('div', { key: `m-${item.key}`, className: 'ds-an-kv' }, h('span', {}, `模型 ${item.key}`), h('b', {}, `${item.runs} 次`))),
          (costs?.byPromptVersion ?? []).slice(0, 3).map(item => h('div', { key: `p-${item.key}`, className: 'ds-an-kv' }, h('span', {}, `提示词 ${item.key}`), h('b', {}, `${item.runs} 次`))),
          // 钱是怎么来的，得写在钱旁边：币种、单位、价目表在哪维护、配了几个模型。
          h('div', { className: 'ds-hint', 'data-price-source': String(priceCount) },
            `币种 ¥（元）· 单位：元 / 百万 token · 价目来源：设置 →「成本与预算」的价目表（已配 ${priceCount} 个模型）` +
            (priceCount === 0 ? '，现在只统计 token、不算钱' : '')),
          (costs?.usage?.unpricedModels ?? []).length === 0
            ? null
            : h('div', { className: 'ds-hint', 'data-unpriced': String(costs.usage.unpricedModels.length) },
              '未配价目的模型：' + costs.usage.unpricedModels.map(item => item.model + ' ×' + item.calls).join('、'),
              typeof onFixPrices === 'function'
                ? h('button', {
                  className: 'ds-btn ds-btn-ghost', style: { marginLeft: 8, padding: '2px 8px', fontSize: 12 },
                  title: '把缺价目的模型带进设置页的价目表，填好单价保存即可算钱',
                  onClick: () => onFixPrices(costs.usage.unpricedModels.map(item => item.model)),
                }, '补价目')
                : null),
          h('div', { className: 'ds-hint' }, costs?.note ?? ''),
          costs?.budget === null || costs?.budget === undefined
            ? null
            : h('div', { style: { marginTop: 8 } },
              h('div', { className: 'ds-an-kv' },
                h('span', {}, '预算使用'),
                h('b', { style: { color: costs.budget.level === 'over' ? '#e5484d' : costs.budget.level === 'warn' ? '#d97706' : undefined } },
                  `${Math.max(costs.budget.runRate, costs.budget.hourRate)}%`),
              ),
              h(ProgressField, {
                value: Math.min(100, Math.max(costs.budget.runRate, costs.budget.hourRate)),
                tone: costs.budget.level,
              }),
              h('div', { className: 'ds-hint' },
                `${costs.budget.runs}/${costs.budget.budgetRuns} 次 · ${costs.budget.hours}/${costs.budget.budgetHours} 小时 · ${costs.budget.hint}`),
            ),
        ),
      ),
      h('div', { className: 'ds-span-8' },
        h(TaskList, {
          title: '返工最多的卡',
          aside: `评审打回 ${data.rework.reviewRework} 次 · 测试打回 ${data.rework.testRework} 次`,
          empty: '没有卡倒退过，挺好。',
        },
          (data.rework.worst ?? []).map(item => h(TaskRow, {
            key: item.id,
            title: `${item.code === '' ? '' : `${item.code} `}${item.title}`,
            hint: `倒退 ${item.backward} 次 · 现在在「${(state.statuses.find(entry => entry.id === item.status) ?? {}).label ?? item.status}」`,
            action: h(BoarduiButton, { variant: 'ghost', size: 'small', onClick: () => onOpenTask(item.id) }, '打开'),
          })),
        ),
      ),
    ),
    renderContextPanel(),
  )
}
