// 设计多稿与定案：形状、老数据兼容、进开发闸门、派单提示词。
// 核心判据：「评审通过」≠「定案」。多稿项目里最常见的翻车是评审说"都行"，研发照错的那稿做。
import assert from 'node:assert/strict'
import test from 'node:test'

import { designGate, designPatchFrom, sanitizeDesign } from '../src/host/design.js'
import { buildExpertPrompt, configureDispatcher } from '../src/host/dispatcher.js'

const config = (extra = {}) => ({ design: { enabled: true, columns: ['dev'] }, experts: [], ...extra })
const card = design => ({ id: 't-1', code: 'DEV-001', title: 'x', comments: [], cases: [], design })

test('形状：老数据只有 link 时当成唯一一稿，自动定案（否则升级后所有卡都被卡住）', () => {
  const design = sanitizeDesign({ link: 'https://figma.com/file/abc', status: 'approved' })
  assert.equal(design.drafts.length, 1)
  assert.equal(design.drafts[0].id, 'd1')
  assert.equal(design.drafts[0].name, '原稿')
  assert.equal(design.chosenId, 'd1', '只有一稿时不用再点一次「选为定案」')
  assert.equal(design.link, 'https://figma.com/file/abc', '老字段保留，别让老地方读不到')
})

test('形状：多稿不定案就是没定案；chosenId 指向不存在的稿要清掉', () => {
  const design = sanitizeDesign({
    drafts: [
      { id: 'a', name: '方案 A', link: 'https://x/a' },
      { id: 'b', name: '方案 B', link: 'https://x/b' },
    ],
    status: 'approved',
  })
  assert.equal(design.drafts.length, 2)
  assert.equal(design.chosenId, '', '两稿以上必须显式定案')
  assert.equal(sanitizeDesign({ drafts: [{ id: 'a', link: 'https://x/a' }, { id: 'b', link: 'https://x/b' }], chosenId: 'ghost' }).chosenId, '')
  assert.equal(sanitizeDesign({ drafts: [{ id: 'a', link: 'https://x/a' }, { id: 'b', link: 'https://x/b' }], chosenId: 'b' }).chosenId, 'b')
  // 只有一稿时显式给了别的 id，也回落成那一稿
  assert.equal(sanitizeDesign({ drafts: [{ id: 'a', link: 'https://x/a' }], chosenId: 'zzz' }).chosenId, 'a')
})

test('形状：没链接也没封面的稿不算一稿；最多 8 稿；重复 id 去重', () => {
  const design = sanitizeDesign({
    drafts: [
      { name: '只有名字' },
      { id: 'a', link: 'https://x/a' },
      { id: 'a', link: 'https://x/dup' },
    ],
  })
  assert.equal(design.drafts.length, 1, '没链接也没封面 + 重复 id 都该被丢掉')
  assert.equal(design.drafts[0].id, 'a')
  assert.equal(design.drafts[0].link, 'https://x/a', '重复 id 保留第一个')

  const many = sanitizeDesign({ drafts: Array.from({ length: 12 }, (_, index) => ({ id: `n${index}`, link: `https://x/${index}` })) })
  assert.equal(many.drafts.length, 8, '超过 8 稿就不是对比了')
})

test('形状：人把稿清空成 [] 就是清空，不许被老 link 复活', () => {
  const design = sanitizeDesign({ link: 'https://old', drafts: [] })
  assert.equal(design.drafts.length, 0)
  assert.equal(design.chosenId, '')
})

test('闸门：评审通过但没定案 → 拦；定案了才放行', () => {
  const twoDraftApproved = sanitizeDesign({
    drafts: [{ id: 'a', name: '方案 A', link: 'https://x/a' }, { id: 'b', name: '方案 B', link: 'https://x/b' }],
    status: 'approved',
  })
  const blocked = designGate(config(), card(twoDraftApproved), 'dev')
  assert.equal(blocked.needed, true)
  assert.equal(blocked.ready, false)
  assert.match(blocked.blockers.join(), /没定案/)

  const chosen = { ...twoDraftApproved, chosenId: 'b' }
  assert.equal(designGate(config(), card(chosen), 'dev').ready, true)

  // 通过评审但一稿都没有
  const noDraft = sanitizeDesign({ status: 'approved', drafts: [] })
  const noDraftGate = designGate(config(), card(noDraft), 'dev')
  assert.equal(noDraftGate.ready, false)
  assert.match(noDraftGate.blockers.join(), /一稿都没有/)

  // 没通过评审
  const pending = sanitizeDesign({ drafts: [{ id: 'a', link: 'https://x/a' }], status: 'pending' })
  assert.equal(designGate(config(), card(pending), 'dev').ready, false)

  // 开关没开 / 不是设计闸门的列：不管
  assert.equal(designGate({ design: { enabled: false, columns: ['dev'] } }, card(pending), 'dev').needed, false)
  assert.equal(designGate(config(), card(pending), 'test').needed, false)
})

test('升级兼容：老库里只有 design.link 的已通过卡，重新加载后仍然能进开发', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { SecretStore, StudioStore } = await import('../src/host/store.js')
  const dir = mkdtempSync(join(tmpdir(), 'dsh-design-migrate-'))
  const paths = { dbFile: join(dir, 'state.db'), secrets: new SecretStore(join(dir, '.secrets.json')) }
  try {
    const first = new StudioStore(join(dir, 'state.json'), paths)
    await first.ready
    await first.mutate(state => {
      state.tasks.push({
        id: 't-old', code: 'DEV-900', title: '老卡', type: 'dev', status: 'design', role: 'dev',
        project: '', service: '', requirementId: '', checklist: [], artifacts: [], comments: [], history: [], blocked: null,
        design: { link: 'https://figma.com/old', status: 'approved', note: '', by: '产品', at: 1 },
      })
    })
    first.db?.close?.()
    // 再开一次：走 #load 的迁移
    const second = new StudioStore(join(dir, 'state.json'), paths)
    await second.ready
    const card = second.snapshot().tasks.find(item => item.id === 't-old')
    assert.equal(card.design.drafts.length, 1, '老 link 要变成一稿')
    assert.equal(card.design.chosenId, 'd1')
    second.db?.close?.()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('路由：drafts / chosenId 会被当成「要改设计」的字段（不是只读请求）', () => {
  assert.equal(designPatchFrom({ id: 't-1' }), null, '只带 id = 读，不该写')
  const fromDesign = designPatchFrom({ id: 't-1', design: { chosenId: 'b' } })
  assert.equal(fromDesign.chosenId, 'b')
  const fromTop = designPatchFrom({ id: 't-1', drafts: [{ id: 'a', link: 'https://x/a' }] })
  assert.ok(Array.isArray(fromTop.drafts))
})

test('派单：定案的那一稿要进提示词，没定案要提醒先确认', () => {
  configureDispatcher(new Proxy({}, { get: () => () => undefined }))
  const expert = { id: 'e-1', name: '开发工程师', emoji: '🛠️', role: 'dev', skills: [] }
  const column = { label: '开发中' }
  const base = { id: 't-1', code: 'DEV-001', title: 'x', comments: [], cases: [], project: '' }

  const chosen = sanitizeDesign({
    drafts: [{ id: 'a', name: '方案 A', link: 'https://x/a' }, { id: 'b', name: '方案 B', link: 'https://x/b' }],
    chosenId: 'b',
    status: 'approved',
  })
  const prompt = String(buildExpertPrompt({ ...base, design: chosen }, expert, column, { experts: [expert], projects: [] }, undefined, '', undefined, {}, []))
  assert.match(prompt, /设计定案（按这一稿实现/)
  assert.match(prompt, /方案 B/)
  assert.match(prompt, /另有 1 稿未采用/)

  const undecided = sanitizeDesign({ drafts: [{ id: 'a', link: 'https://x/a' }, { id: 'b', link: 'https://x/b' }] })
  const prompt2 = String(buildExpertPrompt({ ...base, design: undecided }, expert, column, { experts: [expert], projects: [] }, undefined, '', undefined, {}, []))
  assert.match(prompt2, /还没定案：先确认用哪一稿/)
})
