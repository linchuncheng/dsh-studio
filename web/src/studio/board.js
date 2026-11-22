/* The board itself: filters, eight columns, drag & drop and WIP limits.
   Data comes in as props; every mutation is a callback from the panel. */

import { ROLE_LABEL, TYPE_LABEL } from './labels.js'
import { artifactsWithoutBody, buildRoster, filterRoster, ownerLabel } from './roster.js'

/** 每列先渲染这么多张；上千张卡时 DOM 会先炸，而不是服务端。 */
const COLUMN_PAGE = 40

export function createBoard({ h, React, Card, TextField, SearchField, SelectField, CheckField, toast }) {
function Board({ state, onOpen, onMove, onWip, onCreate }) {
  const config = state.config ?? {}
  const experts = config.experts ?? []
  const [query, setQuery] = React.useState('')
  const [expertFilter, setExpertFilter] = React.useState('')
  const [typeFilter, setTypeFilter] = React.useState('')
  const [projectFilter, setProjectFilter] = React.useState('')
  const [iterationFilter, setIterationFilter] = React.useState('')
  const [serviceFilter, setServiceFilter] = React.useState('')
  const [requirementFilter, setRequirementFilter] = React.useState('')
  const [hideEmpty, setHideEmpty] = React.useState(false)
  // 列多时默认给可读列宽、横向滚；打开这个把列压到一屏看全（记在本地）
  const [fitWidth, setFitWidth] = React.useState(() => { try { return window.localStorage.getItem('studio.boardFit') === '1' } catch { return false } })
  const [onlyBlocked, setOnlyBlocked] = React.useState(false)
  const [onlyNoBody, setOnlyNoBody] = React.useState(false)
  // 每列当前渲染到第几张；点「显示更多」一页一页加。
  const [shown, setShown] = React.useState({})
  // 筛选后视角常停在最左边的空列：自动滚到第一个有卡的列（只在开启筛选时做，别打断正常浏览）
  React.useEffect(() => {
    const filtering = query !== '' || expertFilter !== '' || typeFilter !== '' || projectFilter !== '' || iterationFilter !== '' || serviceFilter !== '' || requirementFilter !== '' || onlyBlocked === true || onlyNoBody === true
    if (!filtering) return undefined
    const timer = setTimeout(() => {
      const columns = [...document.querySelectorAll('[data-dsh-studio] [data-col]')]
      // 空列里也有一行「暂无任务」，所以要看真正的卡片，不能数子节点
      const first = columns.find(node => (node.querySelectorAll('.ds-col-body .ds-card').length) > 0)
      if (first !== undefined && typeof first.scrollIntoView === 'function') first.scrollIntoView({ block: 'nearest', inline: 'start' })
    }, 150)
    return () => clearTimeout(timer)
  }, [query, expertFilter, typeFilter, projectFilter, iterationFilter, serviceFilter, requirementFilter, onlyBlocked, onlyNoBody])

  const projects = config.projects ?? []
  const activeProject = projects.find(item => item.id === projectFilter)
  const byStatus = React.useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const map = new Map()
    for (const column of state.statuses) map.set(column.id, [])
    for (const task of state.tasks) {
      if (onlyBlocked && (task.blocked ?? null) === null) continue
      if (onlyNoBody && artifactsWithoutBody(task).length === 0) continue
      if (typeFilter !== '' && (task.type ?? 'requirement') !== typeFilter) continue
      if (projectFilter !== '' && task.project !== projectFilter) continue
      if (iterationFilter !== '' && task.iteration !== iterationFilter) continue
      if (serviceFilter !== '' && (task.service ?? '') !== serviceFilter) continue
      if (requirementFilter !== '' && (task.requirementId ?? '') !== requirementFilter) continue
      if (expertFilter !== '' && task.expert !== expertFilter && task.dispatch?.expert !== expertFilter) continue
      if (keyword !== '' && !`${task.title} ${task.requirement} ${task.domain} ${task.id}`.toLowerCase().includes(keyword)) continue
      if (!map.has(task.status)) map.set(task.status, [])
      map.get(task.status).push(task)
    }
    const weight = { urgent: 0, normal: 1, relaxed: 2 }
    for (const list of map.values()) {
      list.sort((left, right) => (weight[left.priority] ?? 1) - (weight[right.priority] ?? 1) || right.updatedAt - left.updatedAt)
    }
    return map
  }, [state, query, expertFilter, typeFilter, projectFilter, iterationFilter, serviceFilter, requirementFilter, onlyBlocked, onlyNoBody])
  const total = [...byStatus.values()].reduce((sum, list) => sum + list.length, 0)
  const bugCount = [...byStatus.values()].reduce((sum, list) => sum + list.filter(task => task.type === 'bug').length, 0)
  const designPending = state.tasks.filter(task => task.design !== null && task.design !== undefined && task.design.status !== 'approved').length
  const blockedCount = state.tasks.filter(task => (task.blocked ?? null) !== null).length
  const noBodyCount = state.tasks.filter(task => artifactsWithoutBody(task).length > 0).length
  const columns = state.statuses.filter(column => !hideEmpty || (byStatus.get(column.id) ?? []).length > 0)
  /* 一张卡都没有时给一条「从零到一」的路，而不是让 8 列各写一句「暂无任务」。
     注意顺序：filtering 必须先声明。以前它写在 boardEmpty 后面，靠 && 短路侥幸不触发 ——
     空看板（新装用户）第一条就为 true，于是去读还没初始化的 filtering：
     `Cannot access 're' before initialization`（issue #6，macOS 桌面版首次打开看板）。 */
  const filtering = query !== '' || expertFilter !== '' || typeFilter !== '' || onlyBlocked || onlyNoBody || projectFilter !== '' || iterationFilter !== '' || serviceFilter !== '' || requirementFilter !== ''
  const boardEmpty = (state.tasks ?? []).length === 0 && filtering === false
  return h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
    /* 闸门关掉时要一眼看见：数据来自 /state.gates（服务端算好的按钮态），不是前端猜配置 */
    (() => {
      const gates = state.gates ?? {}
      const off = []
      if (gates.design !== undefined && gates.design.enabled !== true) off.push('设计闸门')
      if (gates.review !== undefined && gates.review.enabled === false) off.push('评审闸门')
      if (off.length === 0) return null
      return h('div', { className: 'ds-hint', 'data-gate-off': '1', style: { padding: '4px 20px 0' } },
        off.join(' / ') + ' 已关闭：卡可以跳过对应的评审直接推进。要打开在「设置 → 每一列由谁负责」。')
    })(),
    boardEmpty && typeof onCreate === 'function'
      ? h('div', { className: 'ds-empty', style: { margin: '16px 20px 0' } },
        h('div', null, '还没有任何卡。先建一张卡，再把需求、用例、版本挂上去。'),
        h('button', { className: 'ds-btn ds-btn-primary', onClick: () => onCreate() }, '建第一张卡'))
      : null,
    h('div', { className: 'ds-board-bar' },
      h('span', { className: 'ds-search' },
        /* 搜索用官方 SearchField：放大镜与清除键都是组件自带的，以前是给普通 Input 用 ::before 画了个假放大镜。 */
        h(SearchField, {
          className: 'ds-input', style: { width: 200 }, value: query, placeholder: '搜标题 / 需求 / 领域 / 编号',
          onChange: event => setQuery(event.target.value),
        }),
      ),
      projects.length > 0
        ? h(SelectField, {
          className: 'ds-select', style: { width: 150, fontSize: 12 }, value: projectFilter,
          onChange: event => { setProjectFilter(event.target.value); setIterationFilter(''); setServiceFilter('') },
        },
          h('option', { value: '' }, `全部项目（${projects.filter(item => item.status !== 'archived').length}）`),
          projects.map(item => h('option', { key: item.id, value: item.id }, `${item.key ? `${item.key} · ` : ''}${item.name}`)),
        )
        : null,
      activeProject !== undefined && (activeProject.iterations ?? []).length > 0
        ? h(SelectField, {
          className: 'ds-select', style: { width: 132, fontSize: 12 }, value: iterationFilter,
          onChange: event => setIterationFilter(event.target.value),
        },
          h('option', { value: '' }, '全部迭代'),
          activeProject.iterations.map(item => h('option', { key: item.id, value: item.id }, item.name)),
        )
        : null,
      activeProject !== undefined && (activeProject.services ?? []).length > 0
        ? h(SelectField, {
          className: 'ds-select', style: { width: 150, fontSize: 12 }, value: serviceFilter,
          onChange: event => setServiceFilter(event.target.value),
        },
          h('option', { value: '' }, `全部服务（${(activeProject.services ?? []).length}）`),
          activeProject.services.map(item => h('option', { key: item.id, value: item.id }, item.name || item.id)),
        )
        : null,
      (state.requirements ?? []).length > 0
        ? h(SelectField, {
          className: 'ds-select', style: { width: 190, fontSize: 12 }, value: requirementFilter,
          title: '只看某条需求下的卡（需求是整条链路的锚点）',
          onChange: event => setRequirementFilter(event.target.value),
        },
          h('option', { value: '' }, `全部需求（${(state.requirements ?? []).length}）`),
          (state.requirements ?? []).map(item =>
            h('option', { key: item.id, value: item.id }, `${item.code || item.id} ${item.title}`)),
        )
        : null,
      h(SelectField, {
        className: 'ds-select', style: { width: 108, fontSize: 12 }, value: typeFilter,
        onChange: event => setTypeFilter(event.target.value),
      },
        h('option', { value: '' }, '全部类型'),
        ['requirement', 'bug', 'design', 'dev', 'test', 'ops'].map(value =>
          h('option', { key: value, value }, TYPE_LABEL[value] ?? value)),
      ),
      h(SelectField, {
        className: 'ds-select', style: { width: 158, fontSize: 12 }, value: expertFilter,
        onChange: event => setExpertFilter(event.target.value),
      },
        h('option', { value: '' }, '全部专家'),
        experts.filter(expert => expert.enabled !== false).map(expert =>
          h('option', { key: expert.id, value: expert.id }, expert.name)),
      ),
      h('label', { className: 'ds-row', style: { gap: 4, fontSize: 12, cursor: 'pointer', opacity: .8 } },
        h(CheckField, { checked: hideEmpty, onChange: event => setHideEmpty(event.target.checked) }),
        h('span', {}, '隐藏空列'),
      ),
      h('label', {
        className: 'ds-row',
        style: { gap: 4, fontSize: 12, cursor: 'pointer', opacity: .8 },
        title: '把每列压到能一屏看全：列多的时候比横向滚动快，代价是卡片标题会换行',
      },
        h(CheckField, {
          checked: fitWidth,
          onChange: event => {
            const next = event.target.checked
            setFitWidth(next)
            try { window.localStorage.setItem('studio.boardFit', next ? '1' : '0') } catch { /* 隐私模式下写不进去就算了 */ }
          },
        }),
        h('span', {}, '适应宽度'),
      ),
      blockedCount > 0
        ? h('label', {
          className: 'ds-row', style: { gap: 4, fontSize: 12, cursor: 'pointer', color: 'var(--color-notification-error-foreground)' },
          title: '只看被标记为阻塞的卡（它们停在原列，等人决定怎么继续）',
        },
          h(CheckField, { checked: onlyBlocked, onChange: event => setOnlyBlocked(event.target.checked) }),
          h('span', {}, `只看阻塞 ${blockedCount}`),
        )
        : null,
      noBodyCount > 0
        ? h('label', {
          className: 'ds-row', style: { gap: 4, fontSize: 12, cursor: 'pointer', color: 'var(--color-notification-error-foreground)' },
          title: '只看有交付物但没写正文的卡（云盘文档里只有标题，等于没交付）',
        },
          h(CheckField, { checked: onlyNoBody, onChange: event => setOnlyNoBody(event.target.checked) }),
          h('span', {}, `只看缺正文 ${noBodyCount}`),
        )
        : null,
      filtering
        ? h('button', {
          className: 'ds-btn', style: { padding: '4px 12px' },
          onClick: () => { setQuery(''); setExpertFilter(''); setTypeFilter(''); setOnlyBlocked(false); setOnlyNoBody(false); setProjectFilter(''); setIterationFilter(''); setServiceFilter(''); setRequirementFilter('') },
        }, '清除筛选')
        : null,
      h('span', { className: 'ds-stat', style: { marginLeft: 'auto' } },
        `${total} 张卡 · ${designPending > 0 ? `${designPending} 个设计待评审 · ` : ''}${bugCount > 0 ? `${bugCount} 个缺陷` : `${columns.length} 列`}`),
    ),
    h('div', {
      className: 'ds-board',
      'data-fit': fitWidth ? '1' : '0',
      tabIndex: 0,
      'aria-label': '看板列，左右滚动或用方向键',
    },
      columns.map(column => {
        const tasks = byStatus.get(column.id) ?? []
        const owner = ownerLabel(config, config.columns?.[column.id])
        return h('div', {
          className: 'ds-col', key: column.id, 'data-col': column.id, 'data-role': column.role,
          onDragOver: event => { event.preventDefault(); if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'; event.currentTarget.setAttribute('data-drag-over', '1') },
          onDragLeave: event => event.currentTarget.removeAttribute('data-drag-over'),
          onDrop: event => { event.preventDefault(); event.currentTarget.removeAttribute('data-drag-over'); const id = event.dataTransfer === null ? '' : event.dataTransfer.getData('text/plain'); if (id === '' || id === undefined) return; const wip = Number(config.columns?.[column.id]?.wip) || 0; /* 用**全量**任务数判定 WIP：byStatus 是筛选后的结果，拿它计数会让「开着筛选就能绕过上限」 */
            const filled = state.tasks.filter(task => task.status === column.id).length; if (wip > 0 && filled >= wip) { toast(`「${column.label}」已到 WIP 上限 ${wip}，先把列里的卡往前推`, 'error'); return } void onMove(id, column.id) },
        },
          h('div', { className: 'ds-col-head' },
            h('div', { className: 'ds-col-title' },
              h('span', { className: 'ds-col-name' }, column.label),
              (() => {
                const wip = Number(config.columns?.[column.id]?.wip) || 0
                const over = wip > 0 && tasks.length > wip
                return h('span', { className: 'ds-count', 'data-zero': tasks.length === 0 ? '1' : '0', 'data-over': over ? '1' : '0', onClick: event => { event.stopPropagation(); if (typeof onWip === 'function') onWip(column.id, wip) }, title: wip > 0 ? `WIP 上限 ${wip} 张，当前 ${tasks.length} 张${over ? '（已超出，先消化再加）' : ''}` : '这一列没有设 WIP 上限' }, wip > 0 ? `${tasks.length}/${wip}` : String(tasks.length))
              })(),
            ),
            h('div', { className: 'ds-col-owner', 'data-empty': owner.length === 0 ? '1' : '0', title: '这一列的默认负责人：卡推进到本列后由它接手' },
              h('span', { className: 'ds-col-owner-name' }, owner.length === 0 ? '未配置负责人' : owner),
            ),
          ),
          h('div', { className: 'ds-col-body' },
            tasks.length === 0
              ? h('div', { className: 'ds-empty' }, query !== '' || expertFilter !== '' ? '没有匹配的卡' : '暂无任务')
              : tasks.slice(0, shown[column.id] ?? COLUMN_PAGE).map(task => h(Card, {
                  key: task.id,
                  task,
                  onOpen,
                  config,
                  requirements: state.requirements ?? [],
                  onPickRequirement: id => setRequirementFilter(current => (current === id ? '' : id)),
                  onPickProject: id => { setProjectFilter(current => (current === id ? '' : id)); setIterationFilter('') },
                })),
            tasks.length > (shown[column.id] ?? COLUMN_PAGE)
              ? h('button', {
                className: 'ds-btn ds-btn-ghost',
                style: { width: '100%', marginTop: 8, fontSize: 12 },
                onClick: () => setShown(previous => ({ ...previous, [column.id]: (previous[column.id] ?? COLUMN_PAGE) + COLUMN_PAGE })),
              }, `显示更多（还有 ${tasks.length - (shown[column.id] ?? COLUMN_PAGE)} 张）`)
              : null,
          ),
        )
      }),
    ),
  )
}

  return Board
}
