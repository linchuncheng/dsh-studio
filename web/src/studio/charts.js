/* Page-level components lifted out of client.src.js; shared handles come from the studio context.
 *
 * 外观全部走 BoardUI token：
 *   - 进度条：宿主的 ProgressBar（BoardUI Meter）在就用它；取不到时用同一条轨道 + token 底色，
 *     不再自己写轨道 / 填充那套手写类；
 *   - 燃尽图：SVG 的填充/描边走 Tailwind 的 fill-* / stroke-*（accent 色族），
 *     不再依赖 legacy CSS 里的手写规则；
 *   - 空态：boardui/empty-state。
 */

import { client } from './context.js'
import { EmptyState } from '../boardui/empty-state'

/* 轨道与填充：accent 是 BoardUI 的主色族；over/warn 用 status 的 rose / orange。 */
const TRACK = 'relative h-1.5 w-full overflow-hidden rounded-full bg-border-button-default'
const FILL = 'block h-full rounded-full transition-[width] duration-200'
const FILL_TONE = {
  over: 'bg-status-rose-text',
  warn: 'bg-status-orange-text',
  ok: 'bg-accent-500',
}

export function ProgressField({ value, tone }) {
  const { h, kit } = client()
  const Bar = kit('ProgressBar')
  const pctValue = Math.max(0, Math.min(100, Number(value) || 0))
  if (Bar !== null) return h(Bar, { value: pctValue, tone })
  const fill = FILL_TONE[tone] ?? FILL_TONE.ok
  return h('div', { className: TRACK, 'data-progress-track': '', role: 'progressbar', 'aria-valuenow': pctValue, 'aria-valuemin': 0, 'aria-valuemax': 100 },
    h('span', { className: `${FILL} ${fill}`, style: { width: `${pctValue}%` } }))
}

export function BurnChart({ series }) {
  const { h } = client()
  const points = Array.isArray(series) ? series : []
  if (points.length === 0) return h(EmptyState, { title: '还没有数据。' })
  const values = points.map(item => Math.max(0, Number(item.remaining) || 0))
  const max = Math.max(1, ...values)
  const step = points.length === 1 ? 100 : 100 / (points.length - 1)
  const coords = points.map((item, index) => ({
    x: index * step,
    y: 38 - (values[index] / max) * 32,
    remaining: values[index],
    day: String(item.day ?? ''),
  }))
  const line = coords.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')
  const area = `${line} L100,40 L0,40 Z`
  return h('div', { className: 'flex flex-col gap-1', 'data-burn-chart': '' },
    h('svg', { viewBox: '0 0 100 40', preserveAspectRatio: 'none', className: 'h-10 w-full', role: 'img', 'aria-label': '燃尽趋势', 'data-burn-svg': '' },
      h('title', null, '燃尽趋势'),
      h('path', { d: area, className: 'fill-accent-500/10 stroke-none' }),
      h('path', { d: line, className: 'fill-none stroke-accent-500', strokeWidth: '1', vectorEffect: 'non-scaling-stroke' }),
      coords.map(point => h('circle', { key: point.day, cx: point.x, cy: point.y, r: 1.1, className: 'fill-accent-500 stroke-accent-500' },
        h('title', {}, `${point.day}：还剩 ${point.remaining} 张`))),
    ),
    h('div', { className: 'flex justify-between text-caption-2-regular text-text-tertiary', 'data-burn-axis': '' },
      h('span', {}, coords[0].day),
      h('span', {}, coords[coords.length - 1].day),
    ),
  )
}
