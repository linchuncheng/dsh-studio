/**
 * 一套线性图标（lucide，MIT），一个尺寸（14）、一种描边（1.75）。
 *
 * 为什么要有这个文件：体检（npm run audit:ui）在 32 个面里量到 18 个 emoji 图形符号
 * 当图标用 —— 每个系统渲染出来的样子都不一样，尺寸、基线、颜色全不由我们控制。
 * 这里把「符号 → 语义」收成一张表，界面只按语义取图标。
 *
 * 两个约定：
 *   1. 图标永远跟着文字的颜色走（currentColor），不单独上色；
 *   2. 状态不用图标表达，用 `.ds-dot`（6px 圆点）+ 文字：形状固定、颜色只表意。
 *
 * 用法（这些模块都是 h() 写法，所以图标也从 h 构造）：
 *   import { icon, dot, expertIconName } from './icons.js'
 *   icon(h, 'file')                      // 14px 线性图标
 *   icon(h, 'checks', { size: 12 })      // 小一号
 *   dot(h, 'danger')                     // 6px 状态点
 *   icon(h, expertIconName(expert))      // 按专家角色取图标
 */
import {
  Bot, Brain, CircleCheck, CircleDashed, CircleX, ClipboardList, Clock, FileText,
  FlaskConical, Landmark, ListChecks, Package, Paperclip, Play, Puzzle, SkipForward,
  Target, TriangleAlert, Users, Wrench,
} from 'lucide-react'

const GLYPHS = {
  file: FileText,
  checks: ListChecks,
  attach: Paperclip,
  clock: Clock,
  warn: TriangleAlert,
  team: Users,
  skill: Puzzle,
  role: Target,
  suite: Package,
  run: Play,
  memory: Brain,
  resultPass: CircleCheck,
  resultFail: CircleX,
  resultPending: CircleDashed,
  resultSkip: SkipForward,
  expertProduct: ClipboardList,
  expertArchitect: Landmark,
  expertDev: Wrench,
  expertQa: FlaskConical,
  expertDefault: Bot,
}

export const ICON_NAMES = Object.keys(GLYPHS)

/** 渲染一个图标；名字不认识时返回 null（宁可不画，也不画错的）。 */
export function icon(h, name, props = {}) {
  const glyph = GLYPHS[name]
  if (glyph === undefined) return null
  const className = ['ds-icon', props.className].filter(Boolean).join(' ')
  return h(glyph, {
    size: 14,
    strokeWidth: 1.75,
    'aria-hidden': 'true',
    focusable: 'false',
    ...props,
    className,
  })
}

/** 6px 状态点。kind: ok / warn / danger / info / idle。 */
export function dot(h, kind, props = {}) {
  return h('span', { className: 'ds-dot', 'data-kind': kind, 'aria-hidden': 'true', ...props })
}

const ROLE_ICON = {
  product: 'expertProduct',
  architect: 'expertArchitect',
  dev: 'expertDev',
  qa: 'expertQa',
}

/**
 * 专家/角色 → 图标名。
 * 专家的 emoji 是历史数据字段（config.experts[].emoji），界面不再渲染它：
 * 图标由角色决定，同角色同图标，一眼能认出这是产品还是测试。
 */
export function expertIconName(entity) {
  if (entity === null || entity === undefined) return 'expertDefault'
  return ROLE_ICON[entity.role] ?? ROLE_ICON[entity.id] ?? 'expertDefault'
}

/** 用例/清单四态的语义键，配 CSS 上色用。 */
export const RESULT_KIND = {
  pending: 'idle',
  pass: 'ok',
  fail: 'danger',
  skip: 'idle',
}
