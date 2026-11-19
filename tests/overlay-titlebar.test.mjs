// issue #4：桌面版是无边框窗口 + Window Controls Overlay，fixed 覆盖层必须避开顶部标题栏
import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('../', import.meta.url)
const read = relative => fs.readFileSync(new URL(relative, root), 'utf8')

const OFFSET = 'env(titlebar-area-height, 0px)'

test('抽屉/弹窗/侧栏/登录浮层/命令面板遮罩都避开桌面标题栏', () => {
  const legacy = read('client.src.js')
  const css = read('web/src/index.css')
  const drawer = read('web/src/studio/drawer.js')

  for (const [name, source] of [['client.src.js', legacy], ['web/src/index.css', css]]) {
    const lines = source.split(/\r?\n/).filter(line => /position:\s*fixed;\s*inset:\s*0/.test(line))
    assert.ok(lines.length > 0, `${name} 里应该能找到覆盖层规则`)
    for (const line of lines) {
      assert.ok(line.includes('titlebar-area-height'), `${name} 里有覆盖层没避开标题栏：${line.slice(0, 120)}`)
    }
  }

  for (const selector of ['.ds-drawer-wrap', '.ds-modal-wrap', '.ds-side-wrap', '.ds-palette-veil']) {
    const line = legacy.split(/\r?\n/).concat(css.split(/\r?\n/)).find(item => item.includes(selector + ' {'))
    assert.ok(line !== undefined, `没找到 ${selector}`)
    assert.ok(line.includes('titlebar-area-height'), `${selector} 少了 ${OFFSET}`)
  }

  // 图片查看器是内联样式，单独查
  assert.ok(drawer.includes('env(titlebar-area-height, 0px)'), '图片查看器的 fixed 覆盖层也要避开标题栏')

  // 桌面客户端里 env(titlebar-area-height) 实测为 0，必须有保底下沉（issue #4 二次复现）
  assert.ok(legacy.includes('max(env(titlebar-area-height, 0px), var(--ds-titlebar-floor, 0px))'), '覆盖层要有保底下沉')
  const shell = read('web/src/studio/shell.js')
  assert.match(shell, /titlebarFloor\(\) === 0/, '需要下沉时不能再用宿主 SheetDrawer')
  const titlebar = read('web/src/studio/titlebar.js')
  assert.match(titlebar, /app-region/, '要量 -webkit-app-region: drag 那条标题栏（UA 会被客户端去掉，不能当主判据）')
  assert.match(titlebar, /setProperty\('--ds-titlebar-floor'/, '要把量到的高度写进 CSS 变量')
  assert.match(legacy, /applyTitlebarFloor\(\)/, '客户端要调用它')
  assert.match(legacy, /applyTitlebarFloor\(\)/, '客户端要调用它')
  // 覆盖层不该落进拖拽区，否则点击会被当成拖窗口
  assert.ok(legacy.includes('-webkit-app-region:no-drag') || legacy.includes('-webkit-app-region: no-drag'), '覆盖层要标 no-drag')
})

test('产物里带上标题栏偏移（否则桌面版会退回 issue #4 的遮挡）', () => {
  const bundle = read('dist/client.js')
  const count = (bundle.match(/titlebar-area-height/g) ?? []).length
  assert.ok(count >= 5, `dist/client.js 里只有 ${count} 处 titlebar-area-height，覆盖层可能漏了`)
})
