// Adapters that let the legacy panel (client.js, plain React.createElement) use
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
// real shadcn/ui primitives without rewriting its markup.
//
// Every adapter keeps the legacy prop contract, so client.js can do:
//     const Sheet = UIKIT?.SheetDrawer ?? LegacySideDrawer
// and fall back safely when the kit is missing.
import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '../lib/utils.js'
import { portalRoot } from '../lib/portal.js'
import { Button, Input, Label, Textarea, Badge, Tabs, TabsList, TabsTrigger } from './ui.jsx'
import { SegmentedControl as BoarduiSegmented, SegmentedControlItem as BoarduiSegmentedItem } from '../components/base/segmented-control/segmented-control'
import { Tooltip as BoarduiTooltip, TooltipTrigger as BoarduiTooltipTrigger } from '../components/base/tooltip/tooltip'
import { Meter as BoarduiMeter } from '../components/base/meter/meter'
import { ProgressBar as BoarduiProgressBar } from '../components/base/progress/progress'
import { Drawer as BoarduiDrawer } from '../boardui/drawer'
import { ConfirmDialog as BoarduiConfirmDialog } from '../boardui/dialog'

const TooltipProvider = TooltipPrimitive.Provider


/* ------------------------------------------------------------------ Sheet ---
   Right-side editor drawer: same API as the legacy SideDrawer
   ({ title, hint, onClose, footer, children }) but backed by Radix Dialog, so
   it gets focus trapping, Esc handling, scroll lock and aria wiring for free. */
export function SheetDrawer({ title, hint, onClose, footer, children }) {
  // 抽屉本身换成我们自己用 react-aria Modal 写的等价物（见 boardui/drawer.tsx）：
  // Esc 关闭、焦点锁定与归还、portal 都由 react-aria 负责，不用再手挂 keydown。
  return (
    <BoarduiDrawer title={title} hint={hint} onClose={onClose} footer={footer}>
      {children}
    </BoarduiDrawer>
  )
}

/* ------------------------------------------------------------- Tabs bar ---
   { items: [{ id, label }], value, onChange }  → shadcn Tabs (Radix) */
/* --------------------------------------------------------------- Tabs ----
   { items: [{ id, label, count?, hint? }], value, onChange } */

function Hint({ label, children }) {
  if (label === undefined || label === null || label === '') return children
  return (
    <TooltipProvider delayDuration={260}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal container={portalRoot()}>
          <TooltipPrimitive.Content
            sideOffset={6}
            className="z-[120] max-w-[240px] rounded-md border border-border bg-card px-2 py-1 text-[11.5px] leading-[1.45] text-foreground shadow-md"
          >
            {label}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipProvider>
  )
}

export { TabsBar } from './tabs-bar.jsx'

export function SegGroup({ value, onChange, options, className }) {
  // 官方 SegmentedControl（分段控件）：这才是「互斥按钮组」该用的组件，
  // 之前用胶囊（PillTab）是视图切换的语义，用错了。
  return (
    <BoarduiSegmented
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const next = [...keys][0]
        if (next !== undefined && next !== null) onChange(String(next))
      }}
      className={cn('ds-seg-control', className)}
    >
      {options.map((opt) => (
        <BoarduiSegmentedItem key={opt.id} id={opt.id}>
          {opt.label}
        </BoarduiSegmentedItem>
      ))}
    </BoarduiSegmented>
  )
}

/* ------------------------------------------------------ tooltip wrapper --- */
export function Tip({ label, children }) {
  // 官方 Tooltip（TooltipTrigger + Tooltip）：原来挂在 Radix Tooltip 上。
  // react-aria 的 trigger 会克隆子元素挂事件，所以子元素必须是单个可交互节点。
  if (!label) return children
  return (
    <BoarduiTooltipTrigger delay={260}>
      {children}
      <BoarduiTooltip>{label}</BoarduiTooltip>
    </BoarduiTooltipTrigger>
  )
}

/* ------------------------------------------------------------- progress --- */
/* 原来是自己用 Radix Progress 拼的 8px 条。BoardUI 有现成的两个组件：
   Meter（已知区间里的一个量，带 tone）和 ProgressBar（向完成推进的任务）。
   看板里那些「本列占 X%」是**量**，而且要靠 tone 表达 over/warn，所以走 Meter ——
   它就是画在 ProgressBar 同一条轨道上的，视觉一致。
   注：这两个组件只存在于官方 registry（www.boardui.com/r/<name>.json），
   公开仓库 main 里没有 —— 之前就是因此误判「BoardUI 没有进度条」。 */
const METER_TONE = { over: 'error', warn: 'warning' }

export function ProgressBar({ value, tone, className, size = 'md', label }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0))
  return (
    <BoarduiMeter
      aria-label={typeof label === 'string' && label !== '' ? label : 'progress'}
      value={pct}
      maxValue={100}
      size={size}
      tone={METER_TONE[tone] ?? 'accent'}
      className={className}
    />
  )
}

/** 需要「任务推进」语义（role=progressbar）时用这个，不要再用 Meter 顶替。 */
export { BoarduiProgressBar as Progress }

export { Button, Input, Textarea, Label, Badge }


/* ----------------------------------------------------------------- dialogs ---
   Centered confirm / input dialog. The legacy panel used window.confirm and
   window.prompt, which drop the browser's own chrome into a shadcn-styled app.
   DialogBox keeps the same decision flow (resolve with true/false or text) but
   renders as a proper modal with focus trap, Esc and aria wiring. */
export function DialogBox({
  open,
  title,
  message,
  danger = false,
  okText = '确定',
  cancelText = '取消',
  input = false,
  value = '',
  placeholder = '',
  onChange,
  onOk,
  onCancel,
}) {
  // 弹窗换成自己用 react-aria Modal 写的等价物（见 boardui/dialog.tsx）：
  // 焦点锁定 / Esc / 焦点归还都交给 react-aria，样式用 BoardUI 的 token。
  return (
    <BoarduiConfirmDialog
      open={open === true}
      title={title}
      message={message}
      danger={danger}
      okText={okText}
      cancelText={cancelText}
      input={input}
      value={value}
      placeholder={placeholder}
      onChange={onChange}
      onOk={onOk}
      onCancel={onCancel}
    />
  )
}
