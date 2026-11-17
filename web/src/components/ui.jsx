// shadcn/ui primitives, vendored (Tailwind + Radix). Source follows
// https://ui.shadcn.com/docs/components/* with the class names kept verbatim so
// later `npx shadcn add` can drop replacements in without a rewrite.
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cva } from 'class-variance-authority'
import { X, Check } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { portalRoot } from '../lib/portal.js'
// 非 asChild 分支直接渲染 BoardUI 的 Button（原来只用了、没 import，登录卡一渲染就 ReferenceError）
import { Button as BoarduiButton } from '../boardui/index'

const buttonVariants = cva(
  // BoardUI 的 Button 变体矩阵（Figma: Type × Size × OnlyIcon），移植到我们这层：
  // 高度 36/32/24、圆角 radius-2lg/8/4、focus 用 border-focus-ring + 3px 柔光环。
  // 保留我们的 variant 名字（default/secondary/ghost/destructive/outline/link）与 asChild，
  // 调用方一行都不用改。
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap outline-none transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*=\'size-\'])]:size-4 [&_svg]:shrink-0 focus-visible:ring-[3px]',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:ring-ring/50',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 focus-visible:ring-destructive/20',
        outline: 'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-ring/50',
        secondary: 'border border-input bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80 focus-visible:ring-ring/50',
        ghost: 'hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      // medium=36 / small=32 / xs=24，圆角 medium→10、small→8、xs→4
      size: {
        default: 'h-9 px-3 rounded-[10px] has-[>svg]:px-2.5',
        sm: 'h-8 gap-1.5 px-2.5 rounded-lg has-[>svg]:px-2',
        xs: 'h-6 gap-1 px-2 rounded has-[>svg]:px-1.5',
        lg: 'h-10 px-4 rounded-[10px] has-[>svg]:px-3',
        icon: 'size-9 rounded-[10px]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  // 非 asChild 时直接走 BoardUI 原样引入的 Button（适配层做 default→primary 这类命名映射）
  if (!asChild) return <BoarduiButton ref={ref} variant={variant} size={size} className={className} {...props} />
  const Comp = Slot
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
})
Button.displayName = 'Button'

const Input = React.forwardRef(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      'flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm outline-none transition-[color,box-shadow] selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive',
      className,
    )}
    ref={ref}
    {...props}
  />
))
Input.displayName = 'Input'

const Textarea = React.forwardRef(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      'flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive',
      className,
    )}
    ref={ref}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

const Label = React.forwardRef(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn('flex items-center gap-2 text-sm leading-none font-medium select-none', className)} {...props} />
))
Label.displayName = 'Label'

const Card = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex flex-col gap-6 rounded-xl border border-border bg-card py-6 text-card-foreground shadow-sm', className)} {...props} />
))
Card.displayName = 'Card'
const CardHeader = ({ className, ...props }) => <div className={cn('grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6', className)} {...props} />
const CardTitle = ({ className, ...props }) => <div className={cn('leading-none font-semibold', className)} {...props} />
const CardDescription = ({ className, ...props }) => <div className={cn('text-sm text-muted-foreground', className)} {...props} />
const CardContent = ({ className, ...props }) => <div className={cn('px-6', className)} {...props} />
const CardFooter = ({ className, ...props }) => <div className={cn('flex items-center px-6 [.border-t]:pt-6', className)} {...props} />

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground shadow',
        outline: 'text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)
const Badge = ({ className, variant, ...props }) => <div className={cn(badgeVariants({ variant }), className)} {...props} />

const Tabs = TabsPrimitive.Root
const TabsList = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('inline-flex w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground data-[orientation=horizontal]:h-8 data-[orientation=vertical]:h-fit data-[orientation=vertical]:flex-col', className)}
    {...props}
  />
))
TabsList.displayName = 'TabsList'
const TabsTrigger = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium text-foreground/60 transition-all hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:text-muted-foreground dark:hover:text-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 dark:data-[state=active]:text-foreground',
      className,
    )}
    {...props}
  />
))
TabsTrigger.displayName = 'TabsTrigger'
const TabsContent = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('mt-3 focus-visible:outline-none', className)} {...props} />
))
TabsContent.displayName = 'TabsContent'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close
const DialogPortal = ({ ...props }) => <DialogPrimitive.Portal container={portalRoot()} {...props} />
const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-[95] bg-black/50', className)}
    {...props}
  />
))
DialogOverlay.displayName = 'DialogOverlay'
const DialogContent = React.forwardRef(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-[50%] top-[50%] z-[96] grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg sm:max-w-lg',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring">
        <X className="h-4 w-4" />
        <span className="sr-only">关闭</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = 'DialogContent'
const DialogHeader = ({ className, ...props }) => <div className={cn('flex flex-col gap-1.5 text-left', className)} {...props} />
const DialogFooter = ({ className, ...props }) => <div className={cn('flex flex-row justify-end gap-2', className)} {...props} />
const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('text-base font-semibold leading-none tracking-tight', className)} {...props} />
))
DialogTitle.displayName = 'DialogTitle'
const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
))
DialogDescription.displayName = 'DialogDescription'


const Checkbox = React.forwardRef(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer h-4 w-4 shrink-0 rounded-sm border border-input shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn('flex items-center justify-center text-current')}>
      <Check className="h-3.5 w-3.5" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = 'Checkbox'

export {
  buttonVariants,
  Button,
  Input,
  Textarea,
  Label,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Badge,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  Checkbox,
}
