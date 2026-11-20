// 云盘孤儿目录判定（npm run drive:gc 的判据）：保守、只删「像需求目录且没人引用」的文件夹。
import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyDriveFolders, gcSummary } from '../src/host/drive-gc.js'

const folder = (name, token) => ({ name, token, type: 'folder' })

test('孤儿：名字像 REQ-* 且台账没引用 → 删；引用中的 → 留', () => {
  const items = [
    folder('REQ-2026-001 积分抵扣', 't-req-live'),
    folder('REQ-2026-001 积分抵扣', 't-req-orphan'),
    folder('未归属项目', 't-unassigned'),
    folder('ORD 订单中心', 't-project'),
    { name: 'report.md', token: 't-file', type: 'file' },
  ]
  const out = classifyDriveFolders(items, {
    requirementTokens: ['t-req-live'],
    projectFolders: { 'proj-1': 't-project' },
    liveProjectIds: ['proj-1'],
    unassignedToken: 't-unassigned',
  })
  assert.deepEqual(out.orphan.map(item => item.token), ['t-req-orphan'])
  assert.deepEqual(out.keep.map(item => item.token).sort(), ['t-file', 't-project', 't-req-live', 't-unassigned'])
  assert.match(gcSummary(out), /保留 4 个，孤儿 1 个/)
})

test('保守：看不懂的东西一律保留，文件永不删', () => {
  const out = classifyDriveFolders([
    folder('备份 2026-11', 't-a'),
    folder('REQ-2026-002 也像需求但没引用', 't-b'),
    { name: 'x.md', token: 't-c', type: 'file' },
    { name: '没 type 也不是 REQ', token: 't-d' },
  ], { requirementTokens: [], projectFolders: {} })
  assert.deepEqual(out.orphan.map(item => item.token), ['t-b'], '只有 REQ-* 才可能是孤儿')
  assert.equal(out.keep.length, 3)
})

test('没有引用的 REQ-* 全算孤儿；空清单不炸', () => {
  const many = Array.from({ length: 3 }, (_, i) => folder(`REQ-2026-10${i} x`, `t-${i}`))
  assert.equal(classifyDriveFolders(many, {}).orphan.length, 3)
  assert.deepEqual(classifyDriveFolders([], {}), { keep: [], orphan: [] })
  assert.deepEqual(classifyDriveFolders(undefined, {}), { keep: [], orphan: [] })
})

test('项目已删但目录还留着 → 也算孤儿（删项目忘带 deleteFolder 就会这样）', () => {
  const items = [
    { name: 'ADM admin-portal', token: 't-orphan-project', type: 'folder' },
    { name: 'ORD 订单中心', token: 't-live-project', type: 'folder' },
    { name: '未归属项目', token: 't-unassigned', type: 'folder' },
  ]
  const out = classifyDriveFolders(items, {
    requirementTokens: [],
    projectFolders: { 'proj-gone': 't-orphan-project', 'proj-ord': 't-live-project', __unassigned__: 't-unassigned' },
    liveProjectIds: ['proj-ord'],
    unassignedToken: 't-unassigned',
  })
  assert.deepEqual(out.orphan.map(item => item.token), ['t-orphan-project'])
  assert.equal(out.keep.length, 2, '在用的项目目录与未归属项目要保留')
  // 不传 liveProjectIds 时不做这项判定（保守）
  const lenient = classifyDriveFolders(items, { projectFolders: { 'proj-gone': 't-orphan-project' }, requirementTokens: [] })
  assert.equal(lenient.orphan.length, 0)
})
