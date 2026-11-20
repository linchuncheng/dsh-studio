// BUG-001 回归：一张卡上只有 shell / db 用例、且**没有配置测试环境**时，
// runTaskCases 以前会直接踩 env.id → Cannot read properties of undefined (reading 'id')，
// 整卡跑不动（用例建得出来、单条试跑也过，就是不能整卡跑）。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('未配置测试环境时，整卡跑 shell 用例不崩，落库 env 记空串', async () => {
  const { SecretStore, StudioStore } = await import('../src/host/store.js')
  const { configureExecutor, runTaskCases } = await import('../src/host/executor.js')
  configureExecutor(new Proxy({}, { get: () => () => undefined }))

  const dir = mkdtempSync(join(tmpdir(), 'dsh-shell-run-'))
  const store = new StudioStore(join(dir, 'state.json'), {
    dbFile: join(dir, 'state.db'),
    secrets: new SecretStore(join(dir, '.secrets.json')),
  })
  try {
    await store.ready
    await store.mutate(state => {
      state.config.testing = {
        ...state.config.testing,
        allowShell: true,
        shellCwd: dir,
        envs: [],
        defaultEnv: '',
      }
      state.tasks.push({
        id: 't-s1', code: 'TEST-001', title: '（自检）无环境跑 shell 用例', type: 'test',
        status: 'test', role: 'qa', requirementId: '', checklist: [], artifacts: [],
        comments: [], history: [], blocked: null,
        cases: [{
          id: 'c-s1', title: 'echo 命中', expected: '输出 HIT-OK', result: 'pending',
          shell: { command: 'echo HIT-OK', expectExit: 0, expectContains: 'HIT-OK' },
        }],
      })
    })

    // 修复前：这里抛 Cannot read properties of undefined (reading 'id')
    const result = await runTaskCases(store, 't-s1', { by: '测试' })
    assert.equal(result.run.total, 1, 'shell 用例要进执行清单')
    assert.equal(result.run.failed, 0, 'echo 用例应当通过')
    assert.equal(result.env.id, '', '没配置环境时返回空的 env 描述，而不是崩')

    const card = store.snapshot().tasks.find(item => item.id === 't-s1')
    assert.equal(card.cases[0].result, 'pass')
    assert.equal(card.cases[0].lastRun.env, '', '执行记录里的 env 记空串')
    assert.equal(card.testRuns.at(-1).env, '')
  } finally {
    /* Windows 上 SQLite 句柄还开着，删不掉临时目录不是测试失败 */
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
})
