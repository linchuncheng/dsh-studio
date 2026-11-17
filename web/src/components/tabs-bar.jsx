// 选项卡：按 BoardUI `Tabs` 的视觉与语义自己实现（role=tablist/tab、aria-selected、
// 方向键 + Home/End、下划线指示器）。
//
// 为什么不用他们那份 `components/base/tabs/tabs.tsx`：在宿主页里一挂载就抛
// `TypeError: Cannot read properties of undefined (reading 'title')`（试过精简 props、
// 加 I18nProvider 都不行）。但**语义必须对**——之前用的胶囊（PillTabList）是「视图切换」
// 的组件，没有 role=tab、没有方向键、也没有 aria-selected，放在选项卡的位置上是错的。
//
// 契约不变：{ items: [{ id, label, count?, hint? }], value, onChange, className }
import * as React from 'react'
import { cn } from '../lib/utils.js'

export function TabsBar({ items, value, onChange, className }) {
  const listRef = React.useRef(null)
  const [thumb, setThumb] = React.useState(null)

  const measure = React.useCallback(() => {
    const list = listRef.current
    if (list === null) return
    const selected = list.querySelector('[role="tab"][aria-selected="true"]')
    if (selected === null) { setThumb(null); return }
    setThumb({ left: selected.offsetLeft, width: selected.offsetWidth })
  }, [])

  React.useLayoutEffect(() => {
    measure()
    const list = listRef.current
    if (list === null || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    for (const tab of list.querySelectorAll('[role="tab"]')) observer.observe(tab)
    return () => observer.disconnect()
  }, [measure, value, items.length])

  const onKeyDown = (event) => {
    const index = items.findIndex((item) => item.id === value)
    if (index < 0) return
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % items.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else return
    event.preventDefault()
    onChange(items[next].id)
    const list = listRef.current
    requestAnimationFrame(() => list?.querySelectorAll('[role="tab"]')[next]?.focus())
  }

  return (
    <div ref={listRef} role="tablist" onKeyDown={onKeyDown} className={cn('studio-tabs relative flex min-w-0 items-center', className)}>
      {items.map((item) => {
        const selected = item.id === value
        const hasCount = item.count !== undefined && item.count !== null && item.count !== ''
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            title={item.hint || undefined}
            onClick={() => onChange(item.id)}
            className={cn(
              'studio-tab relative z-10 inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap outline-none',
              selected ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary',
            )}
          >
            <span className={cn('text-body-medium', selected ? 'font-semibold' : 'font-normal')}>{item.label}</span>
            {hasCount ? (
              <span className={cn('rounded-sm px-1 py-px text-caption-1-medium tabular-nums', selected ? 'bg-tab-count-selected-background text-accent-600' : 'bg-black/8 text-text-tertiary')}>
                {String(item.count)}
              </span>
            ) : null}
          </button>
        )
      })}
      {thumb === null ? null : (
        <span
          aria-hidden
          className="ds-tabs-thumb pointer-events-none absolute bottom-0 left-0 h-0.5 bg-accent-600 transition-[transform,width] duration-200 ease"
          style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }}
        />
      )}
    </div>
  )
}
