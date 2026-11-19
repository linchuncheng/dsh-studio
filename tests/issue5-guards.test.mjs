// issue #5 的防回归：工具权限表完整性 + 破坏性路由必须带确认 + profile 认 scoped 名
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { DESTRUCTIVE_ROUTES, confirmWordFor, needsConfirm } from '../src/host/access.js'

const root = new URL('../', import.meta.url)
const read = relative => readFileSync(new URL(relative, root), 'utf8')

test('工具权限表：每个已注册工具都必须登记档位（漏登记会按 write 处理，读工具就会意外被审计）', () => {
  const tools = [...read('src/host/tools.js').matchAll(/name: '(studio_[a-z_]+)'/g)].map(match => match[1])
  assert.ok(tools.length >= 40, `只扫到 ${tools.length} 个工具，解析可能失效`)
  const source = read('src/host/tool-access.js')
  const registered = new Set([...source.matchAll(/(studio_[a-z_]+):/g)].map(match => match[1]))
  const missing = tools.filter(name => !registered.has(name))
  assert.deepEqual(missing, [], `这些工具没登记权限档位：${missing.join('、')}`)
})

test('读工具确实被登记成 read（issue #5 第 1 条的那 4 个）', () => {
  const table = read('src/host/tool-access.js')
  for (const name of ['studio_dashboard', 'studio_workload', 'studio_burndown', 'studio_costs']) {
    assert.match(table, new RegExp(`${name}: 'read'`), `${name} 应该是 read`)
  }
})

test('破坏性路由：缺确认词一律拒，确认词对了才放行', () => {
  const destructive = [...DESTRUCTIVE_ROUTES.keys()]
  assert.ok(destructive.length >= 15, `破坏性路由表太小：${destructive.length}`)
  for (const route of ['/audit/clear', '/task/delete', '/requirement/delete', '/snapshot/restore', '/market/install', '/release/publish']) {
    assert.ok(DESTRUCTIVE_ROUTES.has(route), `${route} 应该在破坏性路由表里`)
    assert.equal(needsConfirm(route, 'POST', {}), confirmWordFor(route), `${route} 缺确认时应该要求确认`)
    assert.equal(needsConfirm(route, 'POST', { confirm: confirmWordFor(route) }), null, `${route} 带对确认词应放行`)
    assert.equal(needsConfirm(route, 'POST', { confirm: 'yes' }), confirmWordFor(route), `${route} 确认词不对应拒绝`)
    assert.equal(needsConfirm(route, 'GET', {}), null, `${route} 的 GET 不需要确认`)
  }
  // 普通写路由不受影响
  assert.equal(needsConfirm('/task/update', 'POST', {}), null)
})

test('前端 api() 会自动给破坏性路由补 confirm（否则界面上的删除按钮全 400）', () => {
  const client = read('client.src.js') + read('web/src/studio/destructive.js')
  assert.match(read('web/src/studio/destructive.js'), /export const DESTRUCTIVE_CONFIRM = \{/)
  for (const route of ['/task/delete', '/requirement/delete', '/audit/clear', '/snapshot/restore', '/access/save']) {
    assert.ok(client.includes(`'${route}':`), `前端的确认表里缺 ${route}`)
  }
  assert.match(client, /body = withDestructiveConfirm\(path, body\)/)
})

test('detectProfile 认 scoped 包名（只认短名会让 desktop profile 回退成 web）', () => {
  const module = read('src/host/profile-detect.js')
  assert.match(module, /@marsken\/dsh-studio/, '要认 scoped 依赖名')
  assert.match(module, /endsWith\('\/dsh-studio'\)/, '要认任意 scope 的同名包')
  assert.match(read('index.js'), /isStudioProfile\(deps, bundles\)/, 'detectProfile 要用这个判据')
})

test('新建需求不再自动落「评审中」（没有评审人只会永久卡住）', () => {
  assert.ok(!/status: needsProduct === true \? 'review'/.test(read('src/host/executor.js')), '新建需求不应该自动置成 review')
})
