// 测试改成断言"运行时推导"这套做法（不再断言某个写死的 id）
import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('../', import.meta.url)
const read = relative => fs.readFileSync(new URL(relative, root), 'utf8')
const pkg = JSON.parse(read('package.json'))

test('浏览器端注册 id 必须从自己的 script 地址推导，且能处理 ?? 多入口前缀（issue #3）', () => {
  const bundle = read('dist/client.js')
  const copy = read('client.js')
  for (const [name, source] of [['dist/client.js', bundle], ['client.js', copy]]) {
    assert.ok(source.includes('/plugins/'), `${name} 里应该有从 script 地址解析模块 id 的逻辑`)
    assert.ok(source.includes(pkg.name), `${name} 里应保留包名作为兜底`)
    // 写死短名就是 issue #3 的根因
    assert.ok(!/__ModuleLoader__\.load\(\{\s*id:\s*["']dsh-studio["']/.test(source), `${name} 不许把短名写死在 load() 上`)
  }
})

test('vite 入口：id 走 resolveModuleId()，兜底用编译期包名常量', () => {
  const main = read('web/src/main.jsx')
  assert.match(main, /id:\s*resolveModuleId\(\)/, 'main.jsx 应该写 id: resolveModuleId()')
  assert.match(main, /__STUDIO_PKG_NAME__/, '兜底要用编译期包名常量')
  assert.match(main, /replace\(\/\^\\\?\+/, '解析要吃掉 ?? 多入口前缀')
  const config = read('web/vite.config.mjs')
  assert.match(config, /__STUDIO_PKG_NAME__:\s*JSON\.stringify\(/, 'vite.config 应该定义 __STUDIO_PKG_NAME__')
})
