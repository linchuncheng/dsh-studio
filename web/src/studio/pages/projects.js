/* 项目页：业务项目 / 迭代 / 每个服务的本机目录与卡数。
 * 从 client.src.js 抬出来，给 2500 行闸门留空间；组合根只留一行工厂调用。
 */

export function createProjectsPage({ h, React, api }) {
  return function ProjectsOverview({ state, onOpenBoard }) {
    const [metrics, setMetrics] = React.useState(null)
    const [error, setError] = React.useState(null)
    React.useEffect(() => {
      let alive = true
      api('/metrics')
        .then(out => { if (alive) setMetrics(out.metrics) })
        .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)) })
      return () => { alive = false }
    }, [state.revision])

    if (error !== null) return h('div', { className: 'ds-body' }, h('div', { className: 'ds-err' }, error))
    /* /metrics 回包缺 metrics 字段时（版本错配 / 后端换形状）不能整页崩：
       以前只判 === null，undefined 会走到 metrics.projects 直接抛，
       React 错误边界把整个工作空间换成「渲染失败」。 */
    if (metrics === null || metrics === undefined) return h('div', { className: 'ds-loading' }, '正在统计…')

    const card = (title, subtitle, data, key) => h('div', { className: 'ds-proj-card', key },
      h('div', { className: 'ds-proj-head' },
        h('div', null,
          h('div', { className: 'ds-proj-name' }, title),
          h('div', { className: 'ds-hint' }, subtitle),
        ),
        h('button', { className: 'ds-btn', onClick: () => onOpenBoard(key) }, '看这些卡'),
      ),
      h('div', { className: 'ds-proj-stats' },
        h('div', null, h('b', {}, data.inProgress), h('span', {}, '进行中')),
        h('div', null, h('b', { 'data-warn': data.blocked > 0 ? '1' : '0' }, data.blocked), h('span', {}, '阻塞')),
        h('div', null, h('b', { 'data-warn': data.overdue > 0 ? '1' : '0' }, data.overdue), h('span', {}, '逾期')),
        h('div', null, h('b', {}, data.done), h('span', {}, '已完成')),
        h('div', null, h('b', {}, `${data.checklistRate}%`), h('span', {}, '清单完成')),
        h('div', null, h('b', {}, data.artifacts), h('span', {}, '交付物')),
      ),
      h('div', { className: 'ds-proj-bar' },
        h('div', { className: 'ds-check-bar', 'data-full': data.checklistRate === 100 ? '1' : '0' },
          h('span', { style: { width: `${data.checklistRate}%` } }),
        ),
      ),
      data.cycleDays > 0 ? h('div', { className: 'ds-hint' }, `平均周期 ${data.cycleDays} 天 · 近 7 天完成 ${data.throughput7d} 张`) : h('div', { className: 'ds-hint' }, `近 7 天完成 ${data.throughput7d} 张`),
    )

    return h('div', { className: 'ds-body' },
      h('div', { className: 'ds-proj-grid' },
        (metrics.projects ?? []).map(project => card(
          `${project.key ? `[${project.key}] ` : ''}${project.name}`,
          `${(project.iterations ?? []).length} 个迭代`,
          project.metrics,
          project.id,
        )),
        metrics.unassigned !== null && metrics.unassigned !== undefined && metrics.unassigned.total > 0
          ? card('未归属项目', '还没挂到项目上的卡', metrics.unassigned, '')
          : null,
      ),
      (metrics.projects ?? []).length === 0 && (metrics.unassigned === null || metrics.unassigned === undefined || metrics.unassigned.total === 0)
        ? h('div', { className: 'ds-empty' }, '还没有卡片。先去「设置 → 项目与迭代」建一个项目，再新建任务。')
        : null,
    )
  }
}
