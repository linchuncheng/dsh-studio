/* 运行托盘：1.5 秒轻轮询 /agents，在顶栏显示「谁在跑 / 有没有停摆」。
 *
 * 为什么单独一个模块：client.src.js 有 2500 行闸门，而且整包 /state 是给看板用的
 * （几百 KB、15 秒一次）。运行态要的是「现在谁在跑」这种几 KB、秒级的数据，
 * 所以只打 /agents，不碰整包状态。
 *
 * 显示三态：
 *   - 有会话在跑：绿点 + 「AI 在跑 N」，点开看卡片 / 专家 / 跑了多久；
 *   - 没会话但有停摆卡：红点 + 「停摆 N 张」（崩过 / 被中断，不会自己恢复）；
 *   - 都 0：灰点 + 「AI 空闲」。
 *
 * 零新依赖、零新页面：原生 <details> 负责展开/收起和键盘操作。
 */

export function createRunTray({ h, React, api }) {
  const elapsed = ms => {
    const total = Math.max(0, Math.round((Number(ms) || 0) / 1000))
    if (total < 60) return `${total}s`
    return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s`
  }

  function RunTray({ state }) {
    const [agents, setAgents] = React.useState(null)
    const [failed, setFailed] = React.useState(false)

    React.useEffect(() => {
      let alive = true
      const read = async () => {
        try {
          const out = await api('/agents')
          if (!alive) return
          if (out !== null && out !== undefined && out.ok !== false) {
            setAgents(out)
            setFailed(false)
          } else {
            setFailed(true)
          }
        } catch {
          if (alive) setFailed(true)
        }
      }
      void read()
      const timer = window.setInterval(() => {
        if (document.hidden !== true) void read()
      }, 1500)
      const onVisible = () => {
        if (document.hidden !== true) void read()
      }
      document.addEventListener('visibilitychange', onVisible)
      return () => {
        alive = false
        window.clearInterval(timer)
        document.removeEventListener('visibilitychange', onVisible)
      }
    }, [])

    const running = Array.isArray(agents?.running) ? agents.running : []
    const stalled = (state.tasks ?? []).filter(task => task.stalled === true).length
    const label = failed
      ? '运行态读取失败'
      : running.length > 0
        ? `AI 在跑 ${running.length}`
        : stalled > 0 ? `停摆 ${stalled} 张` : 'AI 空闲'
    const dot = failed || stalled > 0
      ? 'var(--ds-danger-text)'
      : running.length > 0 ? 'var(--ds-ok-text)' : 'var(--ds-muted)'

    const row = info => {
      const task = (state.tasks ?? []).find(item => item.id === info.taskId)
      const expert = (state.config?.experts ?? []).find(item => item.id === info.expert)
      return h('div', {
        key: String(info.sessionId ?? info.taskId ?? info.expert),
        style: { padding: '5px 4px', borderTop: '1px solid var(--ds-line-soft, var(--ds-line))' },
      },
        h('div', { style: { fontSize: 12, lineHeight: 1.4 } },
          h('b', null, task?.code || String(info.taskId ?? '任务')),
          ' ',
          task?.title ?? '（卡可能已被删除）'),
        h('div', { style: { fontSize: 11, color: 'var(--ds-muted)' } },
          `${expert?.name ?? info.expert ?? '专家'} · 已跑 ${elapsed(Date.now() - (Number(info.at) || Date.now()))}`),
      )
    }

    return h('details', {
      className: 'ds-run-tray',
      'data-run-tray': String(running.length),
      'data-stalled': String(stalled),
      style: { position: 'relative', display: 'inline-block' },
    },
      h('summary', {
        title: '运行托盘：谁在跑、有没有卡停摆（1.5 秒刷新；点开看明细）',
        style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--ds-muted)', listStyle: 'none', padding: '2px 4px' },
      },
        h('span', { 'aria-hidden': 'true', style: { width: 7, height: 7, borderRadius: '50%', background: dot, flex: 'none' } }),
        label,
        running.length > 0
          ? h('span', { style: { color: 'var(--ds-muted)', fontSize: 11 } }, `${running.length}/${agents?.maxConcurrent ?? '—'}`)
          : null),
      h('div', {
        style: {
          position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 30, minWidth: 280, maxWidth: 380,
          background: 'var(--ds-surface, var(--ds-card))', border: '1px solid var(--ds-line)',
          borderRadius: 8, boxShadow: 'var(--ds-shadow, 0 8px 24px rgba(0,0,0,.18))', padding: '6px 8px',
        },
      },
        failed
          ? h('div', { style: { fontSize: 11, color: 'var(--ds-danger-text)', padding: '4px' } }, '读不到 /agents：可能是派单引擎还没起来，或服务刚重启。')
          : null,
        running.length === 0 && stalled === 0 && !failed
          ? h('div', { style: { fontSize: 11, color: 'var(--ds-muted)', padding: '4px' } }, '没有正在跑的专家会话。')
          : null,
        running.map(row),
        stalled > 0 && running.length === 0
          ? h('div', { style: { fontSize: 11, color: 'var(--ds-danger-text)', padding: '4px' } },
            `${stalled} 张卡停在「正在跑」但会话已不在：去工作台看「停摆」清单，或打开卡片重试。`)
          : null,
        agents?.lastError
          ? h('div', { style: { fontSize: 11, color: 'var(--ds-danger-text)', padding: '4px' } }, `最近错误：${String(agents.lastError).slice(0, 160)}`)
          : null,
      ),
    )
  }

  return RunTray
}
