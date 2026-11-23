/* 卡片抽屉评论框里的 @ 选择面板。
 *
 * 外观按参考稿：宽约 340 的弹层，顶部「专家 / 专家团」两段式页签，下面是搜索框，
 * 再往下是按分组（角色位 / 专家 / 专家团）列的清单，每行「头像 + 名字 + 一行说明」。
 *
 * 位置：正常流内、紧贴输入框上方（以前用 position:absolute + bottom:100% 锚不到定位祖先，
 * 整块被顶到视口外，打 @ 什么都看不见）。
 */

import { uiIcon } from './icons.js'
import { filterRoster } from './roster.js'

const POP = 'flex w-full max-w-[360px] flex-col overflow-hidden rounded-xl border border-separator-border bg-background-primary-default shadow-2xl'
const TABS = 'flex shrink-0 items-center gap-1 border-b border-separator-border p-1'
const TAB_ON = 'flex-1 rounded-lg bg-background-secondary-default px-3 py-1.5 text-caption-1-medium text-text-primary'
const TAB_OFF = 'flex-1 rounded-lg px-3 py-1.5 text-caption-1-medium text-text-tertiary hover:bg-background-secondary-default'
const GROUP = 'px-3 pt-2 pb-1 text-caption-2-medium text-text-tertiary'
const ITEM = 'flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-body-2-regular text-text-primary hover:bg-background-secondary-default data-[active="1"]:bg-background-secondary-default'
const AVATAR = 'flex size-6 shrink-0 items-center justify-center rounded-full bg-background-secondary-default text-caption-2-medium'
const HINT = 'min-w-0 truncate text-caption-1-regular text-text-tertiary'
const EMPTY = 'px-3 py-4 text-caption-1-regular text-text-tertiary'

export function createMentionPicker({ h, React, TextField }) {
  function MentionPicker({ roster, query, active, onQuery, onActive, onPick, onClose }) {
    const [tab, setTab] = React.useState('expert')
    /* 页签决定看哪一类：专家页签含「角色位」（按角色派单的兜底），专家团页签只看团。 */
    const inTab = item => (tab === 'team' ? item.group === '专家团' : item.group !== '专家团')
    const hits = filterRoster(roster, query).filter(inTab)
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
      style: { position: 'relative', zIndex: 5, marginBottom: 8 },
      onKeyDown,
    },
      h('div', { className: TABS, role: 'tablist', 'data-mention-tabs': '' },
        h('button', { type: 'button', role: 'tab', 'aria-selected': tab === 'expert', 'data-mention-tab': 'expert', className: tab === 'expert' ? TAB_ON : TAB_OFF, onClick: () => { setTab('expert'); onActive(0) } }, '专家'),
        h('button', { type: 'button', role: 'tab', 'aria-selected': tab === 'team', 'data-mention-tab': 'team', className: tab === 'team' ? TAB_ON : TAB_OFF, onClick: () => { setTab('team'); onActive(0) } }, '专家团'),
      ),
      h('div', { className: 'shrink-0 border-b border-separator-border p-2' },
        h(TextField, {
          autoFocus: true, value: query,
          placeholder: '搜名字、领域或关键词',
          onChange: event => onQuery(event.target.value),
          onFocus: () => onQuery(query),
          'data-mention-search': '',
        }),
      ),
      h('div', { className: 'max-h-[260px] overflow-y-auto py-1', 'data-mention-list': '' },
        hits.length === 0
          ? h('div', { className: EMPTY, 'data-mention-empty': '' }, tab === 'team' ? '没有匹配的专家团' : '没有匹配的专家')
          : hits.map((item, index) => {
            const first = index === 0 || hits[index - 1].group !== item.group
            return [
              first ? h('div', { key: `g-${item.group}`, className: GROUP }, item.group) : null,
              h('button', {
                key: item.key, type: 'button', className: ITEM, 'data-mention-item': '', 'data-active': index === active ? '1' : '0',
                onMouseEnter: () => onActive(index),
                onClick: () => onPick(item.name),
              },
              h('span', { className: AVATAR }, uiIcon(h, item.icon) ?? (item.name ?? '?').slice(0, 1)),
              h('span', { className: 'min-w-0 flex-1' },
                h('span', { className: 'block truncate text-body-2-medium text-text-primary' }, item.name),
                item.hint === undefined || item.hint === '' ? null : h('span', { className: `block ${HINT}` }, item.hint),
              )),
            ]
          }).flat().filter(Boolean),
      ),
    )
  }
  return MentionPicker
}
