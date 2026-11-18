import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { StudioStore } from '../src/host/store.js'

/* 两个进程同时开着时，以前是「整包覆盖」——后写的那个把对方的改动抹掉，
   磁盘上只剩一边的数据，**没有日志、没有审计、没有报错**（2026-11-18 后端架构师实测：
   A 建 taskA、B 建 taskB → 磁盘上只有 taskB）。
   现在落盘前比对基础版本，第二个写入直接报冲突，而不是静默覆盖。 */
describe('store: 单写者校验（不允许静默覆盖）', () => {
  it('两个实例先后写：第二个被拒，第一个的数据留在磁盘上', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-studio-cas-'))
    const file = join(dir, 'state.db')
    try {
      const first = new StudioStore(file)
      await first.ready
      const second = new StudioStore(file)
      await second.ready

      await first.mutate(state => { state.tasks.push({ id: 'taskA', title: 'A' }) })

      // 第二个实例还基于旧版本 —— 必须被拒，而不是把 taskA 覆盖掉
      await assert.rejects(
        () => second.mutate(state => { state.tasks.push({ id: 'taskB', title: 'B' }) }),
        /已被其它进程修改/,
      )

      const reader = new StudioStore(file)
      await reader.ready
      const ids = reader.state.tasks.map(task => task.id)
      assert.deepEqual(ids, ['taskA'], '磁盘上应保留先写的那张卡，而不是被后者覆盖')
    } finally {
      // Windows 上 SQLite 句柄没关时删不掉目录：清理失败不该让断言变红
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* 留给系统临时目录 */ }
    }
  })

  it('同一实例连续写不受影响（校验不能误伤自己）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-studio-cas-'))
    const file = join(dir, 'state.db')
    try {
      const store = new StudioStore(file)
      await store.ready
      await store.mutate(state => { state.tasks.push({ id: 'one' }) })
      await store.mutate(state => { state.tasks.push({ id: 'two' }) })

      const reader = new StudioStore(file)
      await reader.ready
      assert.deepEqual(reader.state.tasks.map(task => task.id), ['one', 'two'])
    } finally {
      // Windows 上 SQLite 句柄没关时删不掉目录：清理失败不该让断言变红
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* 留给系统临时目录 */ }
    }
  })
})
