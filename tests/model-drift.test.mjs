// 派单会话的模型漂移：配置是 Flash 但会话还按创建时的 Pro 跑——判定与路径推算。
import assert from 'node:assert/strict'
import test from 'node:test'

import { driftNote, isModelDrift, sessionDirOf, sessionWorkspaceSlug } from '../src/host/model-drift.js'

const flash = { provider: 'deepseek-official', model: 'deepseek-v4.1-flash' }
const pro = { provider: 'deepseek-official', model: 'deepseek-v4-pro' }

test('isModelDrift：型号不同就是漂移（真机：配 flash、会话跑 pro）', () => {
  assert.equal(isModelDrift(pro, flash), true)
  assert.equal(isModelDrift(flash, flash), false)
})

test('isModelDrift：provider 只在配置里写了才比', () => {
  assert.equal(isModelDrift({ model: 'm', provider: 'a' }, { model: 'm', provider: 'b' }), true)
  assert.equal(isModelDrift({ model: 'm', provider: 'a' }, { model: 'm' }), false, '配置没写 provider = 借宿主默认')
})

test('isModelDrift：判断不出来的情况不当漂移（不误杀）', () => {
  assert.equal(isModelDrift(null, flash), false, '会话还没发过请求')
  assert.equal(isModelDrift(pro, null), false, '没有配置')
  assert.equal(isModelDrift(pro, { model: '' }), false, '配置为空')
})

test('sessionWorkspaceSlug：DSH 的会话目录命名', () => {
  assert.equal(sessionWorkspaceSlug('C:\\Users\\hp\\dsh-workspace'), '--C-Users-hp-dsh-workspace--')
  assert.equal(sessionWorkspaceSlug('/home/lyf/dsh-workspace'), '--home-lyf-dsh-workspace--')
  assert.equal(sessionWorkspaceSlug(''), '')
})

test('sessionDirOf：home + slug + 会话名；缺参数返回空串（调用方据此跳过归档）', () => {
  assert.equal(
    sessionDirOf('/home/lyf', '/home/lyf/dsh-workspace', 'studio-t-1-dev'),
    '/home/lyf/.dsh/sessions/--home-lyf-dsh-workspace--/studio-t-1-dev',
  )
  assert.equal(sessionDirOf('/home/lyf', '', 'studio-t-1-dev'), '')
  assert.equal(sessionDirOf('/home/lyf', '/tmp/x', ''), '')
})

test('driftNote：写明实际型号、期望型号和已经采取的动作', () => {
  const note = driftNote(pro, flash)
  assert.match(note, /deepseek-official\/deepseek-v4-pro/)
  assert.match(note, /deepseek-official\/deepseek-v4\.1-flash/)
  assert.match(note, /归档旧会话并按配置重建/)
})
