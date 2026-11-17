// Bundled entry point.
//
// The shipped artifact must still look like the hand-written client.js to the
// host: `window.__ModuleLoader__.load({ id, factory })`. Everything else changed:
// React, Radix and Tailwind now come from this bundle instead of the page.
import * as React from 'react'
import tailwindCss from './index.css?inline'
import { createStudio } from './legacy.js'
import { createBridge } from './bridge.jsx'
import { ShadcnLoginGate } from './components/login-gate.jsx'
import { SheetDrawer, SegGroup, TabsBar, Tip, ProgressBar, DialogBox } from './components/studio-ui.jsx'
import { Badge, Input, Textarea, Label } from './components/ui.jsx'
import { Button as BoarduiButton, ButtonLink as BoarduiButtonLink } from './boardui/index'
import { TaskRow as BoarduiTaskRow } from './boardui/task-list'
import { EmptyState as BoarduiEmptyState } from './boardui/empty-state'
import { Notification as BoarduiNotification } from './components/base/notification/notification'
import { Chip as BoarduiChip, Select as BoarduiSelect } from './boardui/index'

const STYLE_ID = 'dsh-studio-tw'

function injectStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = tailwindCss
  // Appended to <body> on purpose: the legacy panel injects its own <style>
  // (all the .ds-* rules) when the plugin applies, and equal-specificity rules
  // resolve in document order. Keeping ours last lets the token layer win.
  ;(document.body ?? document.head).appendChild(style)
}

window.__ModuleLoader__.load({
  id: 'dsh-studio',
  factory(require) {
    injectStyles()

    const hostReact = require('react')
    // The legacy panel keeps using the React copy it was written against; that
    // copy ships inside this bundle, so hooks have a dispatcher even though the
    // host renders the bridge with its own React.
    // 把 legacy 的 `h('button', { className: 'ds-btn…' })` 就地翻译成 BoardUI 的 Button 组件。
    // 这样 16 个设置分区 + 各页面里上百个按钮不用逐个改调用点，就直接变成真组件了：
    //   ds-btn-primary → primary，ds-btn-ghost → ghost，其余 → secondary（统一 small 号）。
    // 非 button 标签、没有 ds-btn 类的元素一律原样返回，行为不变。
    const buttonVariant = (props) => props['data-danger'] === '1'
      ? 'danger'
      : /\bds-btn-primary\b/.test(props.className) ? 'primary' : /\bds-btn-ghost\b/.test(props.className) ? 'ghost' : 'secondary'
    const h = (type, props, ...children) => {
      if (type === 'button' && typeof props?.className === 'string' && props.className.includes('ds-btn')) {
        const variant = buttonVariant(props)
        const { className, ...rest } = props
        return React.createElement(BoarduiButton, { ...rest, variant, size: 'small' }, ...children)
      }
      // 同一招用在「长得像按钮的链接」上：顶栏的「导出卡 / 导出需求」原本是
      // `h('a', { className: 'ds-btn ds-btn-ghost', href })`，第一条规则只认 button，
      // 于是它们一直是老式灰按钮 —— 同一个工具栏里并列着两套按钮皮。官方有 ButtonLink，
      // href 原样透传，渲染出来还是 <a>，新标签页打开/右键复制链接都不受影响。
      if (type === 'a' && typeof props?.className === 'string' && props.className.includes('ds-btn') && typeof props.href === 'string') {
        const variant = buttonVariant(props)
        const { className, ...rest } = props
        return React.createElement(BoarduiButtonLink, { ...rest, variant, size: 'small' }, ...children)
      }
      // 同一招再用于列表行：legacy 的 `div.ds-listrow > (main[标题,说明], actions[按钮…])`
      // 结构非常固定，就地渲染成 TaskRow。只在**结构完全对得上**时才换，其余原样透传，
      // 免得把某个自定义行改坏。
      if (type === 'div' && typeof props?.className === 'string' && /(^|\s)ds-listrow(\s|$)/.test(props.className)) {
        const flat = children.flat().filter((child) => child !== null && child !== undefined && child !== false)
        const main = flat.find((child) => typeof child?.props?.className === 'string' && child.props.className.includes('ds-listrow-main'))
        const actions = flat.find((child) => typeof child?.props?.className === 'string' && child.props.className.includes('ds-listrow-actions'))
        if (main !== undefined) {
          const content = React.Children.toArray(main.props.children).filter(Boolean)
          const [title, ...restContent] = content
          const { className, ...restProps } = props
          return React.createElement(
            BoarduiTaskRow,
            { ...restProps, title, hint: restContent.length > 0 ? restContent : undefined, action: actions?.props?.children },
          )
        }
      }
      // 第三条：legacy 的空态 `div.ds-empty` → 自研的 EmptyState（BoardUI 没有空态组件）
      if (type === 'div' && typeof props?.className === 'string' && /(^|\s)ds-empty(\s|$)/.test(props.className)) {
        const { className, ...restProps } = props
        return React.createElement(BoarduiEmptyState, { ...restProps, title: children.flat().filter(Boolean) })
      }
      // 第五条：原生 <select> → BoardUI Select。legacy 里还有 h('select', {...}, option…)
      // 这种写法（业务提单表单），补上之后全站就没有原生下拉了。
      if (type === 'select') {
        const options = []
        const collect = (nodes) => {
          React.Children.forEach(nodes, (child) => {
            if (!React.isValidElement(child)) return
            if (child.type === 'option') {
              options.push({ value: child.props.value ?? '', label: React.Children.toArray(child.props.children).join('') })
            } else if (child.type === 'optgroup') {
              collect(child.props.children)
            }
          })
        }
        collect(children)
        const { className, value, onChange, children: _children, ...restProps } = props ?? {}
        return React.createElement(BoarduiSelect, { ...restProps, className, options, value, onChange })
      }
      // 第四条：裸的 span.ds-chip（ChipField 之外直接写的标签）→ BoardUI Chip
      if (type === 'span' && typeof props?.className === 'string' && /(^|\s)ds-chip(\s|$)/.test(props.className)) {
        return React.createElement(BoarduiChip, { ...props }, ...children)
      }
      return React.createElement(type, props, ...children)
    }
    const studio = createStudio(React, h)
    // Hand the shadcn-based primitives to the legacy panel. It keeps its own
    // markup but swaps the high-traffic controls for the real components.
    const uiKit = { SegGroup, SheetDrawer, TabsBar, Tip, ProgressBar, DialogBox, Badge, Input, Textarea, Label, Notification: BoarduiNotification }
    if (typeof studio.useUIKit === 'function') studio.useUIKit(uiKit)
    const StudioBridge = createBridge(studio, hostReact, { pageProps: { loginGate: ShadcnLoginGate, ui: uiKit } })

    return {
      inject: ['slots'],
      apply(ctx) {
        const disposers = []
        disposers.push(ctx.slots.inject('main', () => ctx.slots.register(
          { name: 'main', key: 'studio' }, StudioBridge,
        )))
        disposers.push(ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
          { name: 'sidebar.panellist', id: 'studio', order: 12, label: () => '需求&任务工作空间' }, studio.StudioIcon,
        )))
        const cleanup = () => { for (const dispose of disposers.splice(0).reverse()) dispose() }
        if (typeof ctx.effect === 'function') ctx.effect(() => cleanup)
        return cleanup
      },
      StudioPage: studio.StudioPage,
      StudioIcon: studio.StudioIcon,
    }
  },
})

// 原样引入的 BoardUI 组件（验证编译通道；后续按需替换 UI 时直接从这里 import）
import "./components/base/buttons/button";

// BoardUI 适配层（Button 等组件原样引入后在这里接线）
import "./boardui/index";

// 原样引入的 BoardUI 组件（验证编译通道）

import "./components/base/input/input";
import "./components/base/textarea/textarea";
import "./components/base/checkbox/checkbox";
