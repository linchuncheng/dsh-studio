// 标题栏下沉量的判定（issue #4 二次/三次修复）—— 不依赖 UA 也要能认出来
import assert from 'node:assert/strict'
import test from 'node:test'

import { applyTitlebarFloor } from '../web/src/studio/titlebar.js'

const fakeWindow = ({ dragHeight = 0, ua = 'Mozilla/5.0 (Windows NT 10.0)', electron = false } = {}) => {
  const set = []
  const dragElement = {
    getBoundingClientRect: () => ({ top: 0, height: dragHeight }),
    nodeType: 1,
  }
  return {
    innerWidth: 1200,
    navigator: { userAgent: ua },
    ...(electron ? { process: { versions: { electron: '30.0.0' } } } : {}),
    document: {
      documentElement: { style: { setProperty: (key, value) => set.push([key, value]) } },
      elementsFromPoint: () => (dragHeight > 0 ? [dragElement] : [{ getBoundingClientRect: () => ({ top: 0, height: 40 }) }]),
    },
    getComputedStyle: el => ({ getPropertyValue: name => (name.includes('app-region') && el === dragElement && dragHeight > 0 ? 'drag' : '') }),
    __set: set,
  }
}

test('量得到可拖拽标题栏就用它的高度（不看 UA）', () => {
  const win = fakeWindow({ dragHeight: 38 })
  assert.equal(applyTitlebarFloor(win), 38)
  assert.deepEqual(win.__set[0], ['--ds-titlebar-floor', '38px'])
})

test('量不到、但进程里有 Electron 也要下沉 32（UA 可能被去掉）', () => {
  const win = fakeWindow({ electron: true })
  assert.equal(applyTitlebarFloor(win), 32)
  assert.deepEqual(win.__set[0], ['--ds-titlebar-floor', '32px'])
})

test('UA 带 Electron 时同样下沉（兜底信号）', () => {
  const win = fakeWindow({ ua: 'Mozilla/5.0 Electron/30.0.0' })
  assert.equal(applyTitlebarFloor(win), 32)
})

test('普通浏览器：不设任何变量，行为不变', () => {
  const win = fakeWindow({})
  assert.equal(applyTitlebarFloor(win), 0)
  assert.deepEqual(win.__set, [])
})

test('环境炸了也不抛（拿不到 document 就返回 0）', () => {
  assert.equal(applyTitlebarFloor(undefined), 0)
  assert.equal(applyTitlebarFloor({}), 0)
  assert.equal(applyTitlebarFloor({ document: { documentElement: { style: { setProperty() { throw new Error('x') } } } } }), 0)
})
