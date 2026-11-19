/* The shared right-hand drawer. Radix Sheet when the host provides one,
   otherwise the legacy mask + panel markup with Escape-to-close. */

/** 当前需要的标题栏下沉量（px）；Web 版没有标题栏，是 0。 */
function titlebarFloor() {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--ds-titlebar-floor')
    const value = Number.parseFloat(raw)
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

export function createSideDrawer({ h, kit }) {
    function SideDrawer({ title, hint, onClose, footer, children }) {
      const Sheet = kit('SheetDrawer')
      /* 桌面客户端有窗口标题栏，覆盖层要整体下沉（issue #4）。宿主的 SheetDrawer 是它自己的 DOM，
         我们没法保证它的 top 能被我们的 CSS 改到 —— 实测用户截图里它就压在窗口按钮上。
         所以：需要下沉时（--ds-titlebar-floor > 0）用自家标记，和卡片抽屉走同一套定位规则。 */
      if (Sheet !== null && titlebarFloor() === 0) {
        return h(Sheet, { title, hint, onClose, footer }, children)
      }
      return h('div', {
        className: 'ds-side-wrap',
        onKeyDown: e => { if (e.key === 'Escape') onClose() },
      },
        h('div', { className: 'ds-side-mask', onClick: onClose }),
        h('div', { className: 'ds-side', role: 'dialog', 'aria-modal': 'true' },
          h('div', { className: 'ds-side-head' },
            h('div', {},
              h('div', { className: 'ds-side-title' }, title),
              hint === undefined || hint === null ? null : h('div', { className: 'ds-hint' }, hint),
            ),
            h('button', { className: 'ds-btn', onClick: onClose }, '关闭'),
          ),
          h('div', { className: 'ds-side-body' }, children),
          footer === undefined || footer === null ? null : h('div', { className: 'ds-side-foot' }, footer),
        ),
      )
    }

  return SideDrawer
}
