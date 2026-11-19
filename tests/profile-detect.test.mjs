// 用**真实的 profile package.json** 验证 profile 识别（issue #5 第 2 条）
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { isStudioProfile } from '../src/host/profile-detect.js'

const profilesRoot = join(process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '', '.dsh'), 'profiles')
const readProfile = name => {
  const file = join(profilesRoot, name, 'package.json')
  if (!existsSync(file)) return null
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

test('识别：scoped 依赖名 / 短名 / 任意 scope 的同名包都算', () => {
  assert.equal(isStudioProfile({ '@marsken/dsh-studio': '^0.9.7' }, []), true, 'scoped 依赖')
  assert.equal(isStudioProfile({ 'dsh-studio': '0.9.7' }, []), true, '短名依赖（老装法）')
  assert.equal(isStudioProfile({}, ['@marsken/dsh-studio']), true, 'bundle 里的 scoped 名')
  assert.equal(isStudioProfile({}, ['some-scope/dsh-studio']), true, '任意 scope 的同名包')
  assert.equal(isStudioProfile({}, ['dsh-studio']), true, 'bundle 里的短名')
  assert.equal(isStudioProfile({}, ['dsh-ontology-studio']), false, '名字相近但不是本插件')
  assert.equal(isStudioProfile({ 'dsh-taskboard': '0.10.0' }, ['dsh-pet']), false, '别的插件')
  assert.equal(isStudioProfile(undefined, undefined), false, '空输入不炸')
})

test('用真实的 desktop profile 数据验一遍（加进本插件后必须认得出）', () => {
  const desktop = readProfile('desktop')
  if (desktop === null) {
    console.log('（本机没有 desktop profile，跳过真实数据校验）')
    return
  }
  const all = desktop.dependencies ?? {}
  assert.ok(Object.keys(all).length > 0, 'desktop profile 应该有依赖')
  // 把本插件摘掉，模拟"装之前"：必须认不出（这就是 issue #5 里回退成 web 的前提）
  const dependencies = { ...all }
  delete dependencies['@marsken/dsh-studio']
  delete dependencies['dsh-studio']
  assert.equal(isStudioProfile(dependencies, Object.keys(dependencies)), false)
  // 加上本插件（npm 装法用 scoped 名，本地开发用 link: 也是 scoped 名）→ 必须认得出
  const withStudio = { ...dependencies, '@marsken/dsh-studio': 'link:E:/deepseekWorkSpace/super-agents/dsh-studio' }
  assert.equal(isStudioProfile(withStudio, Object.keys(withStudio)), true, 'desktop profile 装了 scoped 包必须认得出')
  const legacy = { ...dependencies, 'dsh-studio': '0.9.7' }
  assert.equal(isStudioProfile(legacy, Object.keys(legacy)), true, '老装法（短名）也要认得出')
})
