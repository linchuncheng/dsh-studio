// issue #3 第二条的防回归：
//   1) 静态：tools.js 里的宿主能力必须带 host. 前缀（裸引用 index.js 的函数 → 运行时 ReferenceError）
//   2) 动态：真的注册一遍工具并执行一个写工具，抓 ReferenceError
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { SecretStore, StudioStore } from '../src/host/store.js'
import { configureToolHost, registerTools } from '../src/host/tools.js'

const toolsSource = readFileSync(new URL('../src/host/tools.js', import.meta.url), 'utf8')

test('tools.js：宿主能力必须经由 host.* 调用（裸引用 = 运行时 ReferenceError，如 recordAudit）', () => {
  const list = /const INJECTED = \[([^\]]+)\]/.exec(toolsSource)
  assert.ok(list !== null, 'tools.js 里应该有 INJECTED 列表')
  const names = [...list[1].matchAll(/"([^"]+)"/g)].map(match => match[1])
  assert.ok(names.length > 0, 'INJECTED 不能是空的')

  const bare = []
  for (const name of names) {
    const pattern = new RegExp(`(?<!host\\.)(?<![\\w$.])${name}\\s*\\(`, 'g')
    for (const match of toolsSource.matchAll(pattern)) {
      // host 默认值那个对象里是 `name: () => {}`，带冒号，不会被上面的正则命中
      bare.push(`${name}（偏移 ${match.index}）`)
    }
  }
  assert.deepEqual(bare, [], `这些宿主能力被裸调用了，运行时会 ReferenceError：${bare.join('、')}`)
})

test('tools.js：每个已注册工具都能执行，且不抛 ReferenceError / 初始化顺序错误', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-studio-tools-'))
  const store = new StudioStore(join(dir, 'state.json'), { dbFile: join(dir, 'state.db'), secrets: new SecretStore(join(dir, '.secrets.json')) })
  try {
    await store.ready
    const registered = []
    const ctx = { tools: { register: tool => { registered.push(tool); return () => {} } }, effect: () => () => {} }
    // 宿主能力全部给最小实现：只关心"有没有裸引用导致 ReferenceError"
    configureToolHost({
      toolOperator: () => '自检',
      toolLevel: () => 'write',
      checkToolAccess: () => ({ level: 'write', denial: null }),
      recordAudit: async () => {},
      publicConfig: config => config,
      getActiveDispatcher: () => undefined,
      getActiveSkills: () => undefined,
    })
    registerTools(ctx, store)
    assert.ok(registered.length > 0, '应该注册出工具')

    // 直接写一张最小卡（不依赖 host.createTask 的注入实现），然后跑写工具
    await store.mutate(state => {
      state.tasks.push({
        id: 't-self-1', code: 'DEV-999', title: '（自检）写工具不崩', type: 'requirement',
        status: 'clarify', role: 'product', comments: [], history: [], checklist: [], cases: [], artifacts: [],
        updatedAt: Date.now(),
      })
    })

    const comment = registered.find(tool => tool.name === 'studio_task_comment')
    assert.ok(comment !== undefined, '应该有 studio_task_comment 工具')
    // 这一步以前会 ReferenceError: recordAudit is not defined（写工具全挂）
    await comment.execute({ id: 't-self-1', body: '写工具能跑' }, {})
    const card = store.snapshot().tasks.find(item => item.id === 't-self-1')
    assert.equal((card?.comments ?? []).length, 1, '评论应该落在卡上')

    /* 全量冒烟：每个工具都用空参数执行一次。
       报「任务不存在」「需求不存在」是正常业务错误，不算问题；只有
       ReferenceError / TDZ（is not defined / Cannot access ... before initialization）
       才是接线坏了。studio_config_get 曾经裸调 index.js 里的 publicConfig，
       上一版这条测试只跑了一个写工具，所以没拦住。 */
    const broken = []
    for (const tool of registered) {
      try {
        await tool.execute({}, {})
      } catch (error) {
        const message = String(error?.message ?? error)
        if (/is not defined|before initialization|Cannot access/.test(message)) broken.push(`${tool.name}：${message}`)
      }
    }
    assert.deepEqual(broken, [], `这些工具的宿主能力没接好：\n${broken.join('\n')}`)
  } finally {
    store.db?.close?.()
    rmSync(dir, { recursive: true, force: true })
  }
})
