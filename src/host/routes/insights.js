import {
  buildDashboard,
} from '../executor.js'
import { runSummary } from '../dispatcher.js'
import { collectSessionUsage, aggregateUsage } from '../session-usage.js'
import { aggregateContext, breakdownContext } from '../context-insight.js'
import { costOf } from '../usage.js'
const INJECTED = ['readJsonBody', 'getDispatcher', "buildAnalytics","buildMetrics","burndownReport","sendJson","workloadReport"]
let host = {
  getDispatcher: () => undefined,
  readJsonBody: async () => ({}),
  buildAnalytics: () => {},
  buildMetrics: () => {},
  burndownReport: () => {},
  sendJson: () => {},
  workloadReport: () => {},
}
/** 度量与工作台（指标、分析、工作量、燃尽、成本）相关路由。宿主能力由 configureInsightsRoutes() 注入。 */
import { buildQuality } from '../quality.js'

export function configureInsightsRoutes(services) {
  host = { ...host, ...(services ?? {}) }
}
export async function handleInsightsRoute({ method, route, req, res, store, url }) {
if (method === 'POST' && route === '/contexts') {
    // 每个专家会话的上下文洞察：窗口峰值、回合、工具调用、重试
    const sessions = await collectSessionUsage()
    const aggregated = aggregateContext(sessions)
    host.sendJson(res, 200, { ok: true, ...aggregated, at: Date.now() })
    return true
  }
  if (method === 'POST' && route === '/contexts/session') {
    // 单个专家的最近一次会话：峰值窗口 + 四类内容的体积占比（系统提示来自平台配置，其余按日志体积估算）
    const body = await host.readJsonBody(req)
    const expert = String(body.expert ?? '')
    const sessions = await collectSessionUsage()
    const mine = sessions.filter(item => item.expert === expert).sort((a, b) => Number(b.at) - Number(a.at))
    if (mine.length === 0) {
      host.sendJson(res, 200, { ok: false, error: '这个专家还没有会话记录' })
      return true
    }
    const expertConfig = (store.snapshot().config.experts ?? []).find(item => item.id === expert) ?? {}
    host.sendJson(res, 200, {
      ok: true,
      expert,
      sessions: mine.length,
      breakdown: breakdownContext(mine[0], String(expertConfig.prompt ?? '').length),
    })
    return true
  }
  if (method === 'GET' && route === '/metrics') {
    host.sendJson(res, 200, { ok: true, metrics: host.buildMetrics(store.snapshot()) })
    return true
  }
  if (method === 'GET' && route === '/analytics') {
    const snapshot = store.snapshot()
    host.sendJson(res, 200, {
      ok: true,
      analytics: host.buildAnalytics(snapshot, {
        days: url.searchParams.get('days') ?? '',
        project: url.searchParams.get('project') ?? '',
      }),
    })
    return true
  }
  if (method === 'GET' && route === '/dashboard') {
    // 最近一次回归（定时或人跑的）也一起给工作台，早上打开就知道昨晚跑成什么样。
    const regressions = await store.readSide('regressions').catch(() => null)
    host.sendJson(res, 200, {
      ok: true,
      dashboard: buildDashboard(store.snapshot()),
      regression: Array.isArray(regressions) && regressions.length > 0 ? regressions[0] : null,
    })
    return true
  }
  if (method === 'GET' && route === '/quality') {
    // AI 质量：派单量 / 一次通过率 / 返工率 / 平均耗时；成本见 /costs 的 usage（读会话日志 + 价目表）。
    host.sendJson(res, 200, { ok: true, quality: buildQuality(store.snapshot(), runSummary()) })
    return true
  }
  if (method === 'GET' && route === '/workload') {
    const dispatcher = host.getDispatcher()
    const running = dispatcher === undefined ? [] : [...dispatcher.running.values()]
    host.sendJson(res, 200, { ok: true, workload: host.workloadReport(store.snapshot(), running) })
    return true
  }
  if (method === 'GET' && route === '/burndown') {
    host.sendJson(res, 200, {
      ok: true,
      burndown: host.burndownReport(store.snapshot(), {
        days: url.searchParams.get('days') ?? '',
        project: url.searchParams.get('project') ?? '',
      }),
    })
    return true
  }
  if (method === 'GET' && route === '/costs') {
    const summary = runSummary()
    const budget = store.snapshot().config.costs
    const runs = summary.total
    const hours = Math.round(((summary.avgMs * summary.finished) / 3600_000) * 10) / 10
    const runRate = budget.budgetRuns > 0 ? Math.min(100, Math.round((runs / budget.budgetRuns) * 100)) : 0
    const hourRate = budget.budgetHours > 0 ? Math.min(100, Math.round((hours / budget.budgetHours) * 100)) : 0
    const level = Math.max(runRate, hourRate) >= 100
      ? 'over'
      : Math.max(runRate, hourRate) >= budget.warnAt ? 'warn' : 'ok'
    // 真实 token 用量：读 studio-* 会话日志，按卡 / 按专家汇总；价目表为空时只给 token。
    const usage = aggregateUsage(await collectSessionUsage(), store.snapshot().tasks, budget.prices ?? [], costOf)
    host.sendJson(res, 200, {
      ok: true,
      costs: summary,
      usage,
      budget: {
        ...budget,
        runs,
        hours,
        runRate,
        hourRate,
        level,
        hint: level === 'over'
          ? '已经超出预算：要么调高预算，要么停下来看看是不是有卡在空转'
          : level === 'warn'
            ? `已用到 ${Math.max(runRate, hourRate)}%，超过 ${budget.warnAt}% 会在这里标黄`
            : '预算内',
      },
    })
    return true
  }
  return false
}
