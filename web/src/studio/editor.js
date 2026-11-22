/* Small list editor: a title, a hint, add button and a per-row renderer.
 *
 * 外观走 BoardUI token：卡片表面 rounded-xl + border-separator-border + bg-background-primary-default，
 * 标题行 text-body-2-semibold，提示 text-caption-1-regular，动作是 boardui/index 的 Button。
 * 三个设置面板（集成 / 人员 / 平台）都用这个壳，改这里会一起变。
 */

import { Button } from '../boardui/index'

const SURFACE = 'mb-4 flex min-w-0 flex-col overflow-hidden rounded-xl border border-separator-border bg-background-primary-default shadow-sm'
const HEAD = 'flex items-center justify-between gap-3 border-b border-separator-border px-4 py-3'
const HEAD_TITLE = 'min-w-0 truncate text-body-2-semibold text-text-primary'
const BODY = 'flex min-w-0 flex-col gap-3 px-4 py-4'
const HINT = 'text-caption-1-regular text-text-tertiary'

export function createEditor({ h, React }) {
function Editor({ title, hint, rows, onAdd, addLabel, render, empty }) {
  return h('div', { className: SURFACE, 'data-editor': '' },
    h('div', { className: HEAD },
      h('span', { className: HEAD_TITLE }, title),
      h(Button, { variant: 'secondary', size: 'sm', onClick: onAdd }, addLabel ?? '新增'),
    ),
    h('div', { className: BODY },
      hint !== undefined ? h('div', { className: HINT }, hint) : null,
      rows.length === 0 ? h('div', { className: HINT }, empty ?? '还没有内容。') : null,
      rows.map(render),
    ),
  )
}

  return Editor
}
