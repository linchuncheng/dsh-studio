// Adapters that let the legacy panel (client.js, plain React.createElement) use
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
// real shadcn/ui primitives without rewriting its markup.
//
// Every adapter keeps the legacy prop contract, so client.js can do:
//     const Sheet = UIKIT?.SheetDrawer ?? LegacySideDrawer
// and fall back safely when the kit is missing.
import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as SelectPrimitive from '@radix-ui/react-select'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import * as ProgressPrimitive from '@radix-ui/react-progress'
import { Check, ChevronDown, X } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { portalRoot } from '../lib/portal.js'
import { Button, Input, Label, Textarea, Badge, Tabs, TabsList, TabsTrigger } from './ui.jsx'
import { PillTabList, PillTab } from '../components/base/tabs/pill-tab'
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

export function TabsBar({ items, value, onChange, className }) {
  // BoardUI 的 PillTabList + PillTab：一层带滑动背景的胶囊页签。
  // 契约没变（items/value/onChange），页面顶栏和卡片抽屉都走这里。
  // hint 用原生 title：PillTab 不接受 title，套 Radix Tooltip 又要求 forwardRef。
  return (
    <PillTabList className={cn('min-w-0 flex-wrap', className)}>
      {items.map((item) => (
        <span key={item.id} title={item.hint || undefined} className="shrink-0">
          <PillTab
            variant="gray"
            isSelected={item.id === value}
            onSelect={() => onChange(item.id)}
            className="ds-pill"
          >
            {item.label}
            {item.count === undefined || item.count === null || item.count === '' ? null : (
              <span className="ml-0.5 rounded-[4px] bg-black/8 px-1 text-[10.5px] font-medium tabular-nums opacity-70">
                {String(item.count)}
              </span>
            )}
          </PillTab>
        </span>
      ))}
    </PillTabList>
  )
}

export function SegGroup({ value, onChange, options, className }) {
  // 换成 BoardUI 的胶囊（和顶栏页签同一套），原来那套 Radix ToggleGroup 与现在的视觉不搭：
  // 一个灰底小方框里塞三个 11px 的按钮，跟旁边的胶囊页签站在一起像两个年代的控件。
  return (
    <PillTabList className={cn('min-w-0', className)}>
      {options.map((opt) => (
        <PillTab
          key={opt.id}
          variant="gray"
          isSelected={opt.id === value}
          onSelect={() => onChange(opt.id)}
          className="ds-pill ds-pill-sm"
        >
          {opt.label}
        </PillTab>
      ))}
    </PillTabList>
  )
}

/* --------------------------------------------------------------- Select ---
   { value, onChange, options: [{ value, label }], placeholder, id, disabled } */
export function SelectBox({ value, onChange, options, placeholder = '请选择', id, disabled, className, style }) {
  return (
    <SelectPrimitive.Root value={value === '' || value === undefined ? undefined : String(value)} onValueChange={onChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        id={id}
        style={style}
        className={cn(
          'flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-sm whitespace-nowrap shadow-sm transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground [&_svg:not([class*=text-])]:text-muted-foreground dark:hover:bg-input/50',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal container={portalRoot()}>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="relative z-[120] max-h-[280px] min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={String(option.value)}
                value={String(option.value)}
                className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-1.5 flex items-center">
                  <Check className="h-3.5 w-3.5" />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

/* --------------------------------------------------------------- Switch ---
   Boolean row: { checked, onChange, label, hint, disabled } */
export function SwitchBox({ checked, onChange, label, hint, disabled, bare = false }) {
  const control = (
    <SwitchPrimitive.Root
      checked={checked === true}
      onCheckedChange={(next) => onChange(next)}
      disabled={disabled}
      className="h-5 w-9 shrink-0 rounded-full border border-transparent bg-input transition-colors data-[state=checked]:bg-primary disabled:opacity-50"
    >
      <SwitchPrimitive.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-card shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  )
  if (bare === true || (label === undefined && hint === undefined)) return control
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <div className="text-[12.5px] leading-snug">{label}</div>
        {hint ? <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{hint}</div> : null}
      </div>
      <div className="mt-0.5">{control}</div>
    </div>
  )
}

/* ------------------------------------------------------ tooltip wrapper --- */
export function Tip({ label, children }) {
  if (!label) return children
  return (
    <TooltipProvider delayDuration={250}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal container={portalRoot()}>
          <TooltipPrimitive.Content
            sideOffset={6}
            className="z-[130] max-w-[280px] rounded-md bg-primary px-2 py-1 text-[11.5px] leading-snug text-primary-foreground shadow"
          >
            {label}
            <TooltipPrimitive.Arrow className="fill-primary" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipProvider>
  )
}

/* ------------------------------------------------------------- progress --- */
export function ProgressBar({ value, tone, className }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0))
  const color = tone === 'over' ? 'bg-destructive' : tone === 'warn' ? 'bg-amber-500' : 'bg-primary'
  return (
    <ProgressPrimitive.Root className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)} value={pct}>
      <ProgressPrimitive.Indicator className={'h-full w-full transition-transform ' + color} style={{ transform: `translateX(-${100 - pct}%)` }} />
    </ProgressPrimitive.Root>
  )
}

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
