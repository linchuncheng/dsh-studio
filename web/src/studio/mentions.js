/* The @ expert picker shown above the comment box in the card drawer.
 *
 * 外观走 BoardUI token（表面 card + separator-border + 大阴影，行 hover/选中用 secondary 底）。
 * 定位仍是「贴着输入框上沿、左右各留 20px」的绝对定位：这层要盖住输入框上方的空间，
 * 用内联样式写死，不依赖 legacy 的弹出层规则（那些会被删）。
 */

import { uiIcon } from './icons.js'
import { filterRoster } from './roster.js'

const POP = 'flex flex-col overflow-hidden rounded-xl border border-separator-border bg-background-primary-default shadow-2xl'
const GROUP = 'px-3 pt-2 pb-1 text-caption-2-medium text-text-tertiary'
const ITEM = 'flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-body-2-regular text-text-primary hover:bg-background-secondary-default data-[active="1"]:bg-background-secondary-default'
const HINT = 'ml-auto shrink-0 text-caption-1-regular text-text-tertiary'
const EMPTY = 'px-3 py-3 text-caption-1-regular text-text-tertiary'

export function createMentionPicker({ h, TextField }) {
function MentionPicker({ roster, query, active, onQuery, onActive, onPick, onClose }) {
  const hits = filterRoster(roster, query)
  const move = delta => {
    if (hits.length === 0) return
    onActive((active + delta + hits.length) % hits.length)
  }
  const onKeyDown = event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1) }
    else if (event.key === 'Enter') { event.preventDefault(); if (hits[active] !== undefined) onPick(hits[active].name) }
    else if (event.key === 'Escape') { event.preventDefault(); onClose() }
  }
  return h('div', {
    className: POP,
    'data-mention-pop': '',
    style: { position: 'absolute', left: 20, right: 20, bottom: 'calc(100% - 4px)', zIndex: 60, maxHeight: 260 },
    onKeyDown,
  },
    h('div', { className: 'border-b border-separator-border p-2' },
      h(TextField, {
        autoFocus: true, value: query,
        placeholder: '搜专家或专家团，Enter 选中，Esc 关闭',
        onChange: event => onQuery(event.target.value),
        'data-mention-search': '',
      }),
    ),
    h('div', { className: 'overflow-y-auto py-1', 'data-mention-list': '' },
      hits.length === 0
        ? h('div', { className: EMPTY, 'data-mention-empty': '' }, '没有匹配的专家或专家团')
        : hits.map((item, index) => {
          const first = index === 0 || hits[index - 1].group !== item.group
          return [
            first ? h('div', { key: item.group, className: GROUP }, item.group) : null,
            h('button', {
              key: item.key, className: ITEM, 'data-mention-item': '', 'data-active': index === active ? '1' : '0',
              onMouseEnter: () => onActive(index),
              onClick: () => onPick(item.name),
            }, item.icon === undefined ? null : uiIcon(h, item.icon), h('span', { className: 'min-w-0 truncate' }, item.name), h('span', { className: HINT }, item.hint)),
          ]
        }).flat().filter(Boolean),
    ),
  )
}

  return MentionPicker
}
