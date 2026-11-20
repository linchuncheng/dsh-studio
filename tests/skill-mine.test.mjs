// 技能沉淀闭环：证据 → 草稿（停用）→ 人启用 → 派单按项目注入。
// 判据只有一条：**搬的都是卡上真发生过的事**，没有证据的卡不给沉淀。
import assert from 'node:assert/strict'
import test from 'node:test'

import { buildExpertPrompt, configureDispatcher } from '../src/host/dispatcher.js'
import { mineSkillFromCard, mineSkillName } from '../src/host/skill-mine.js'
import { sanitizeSkill, skillFromMarkdown, skillMarkdown } from '../src/host/skill-shape.js'

const state = () => ({
  config: {
    experts: [],
    projects: [
      {
        id: 'proj-1',
        name: '订单中心',
        key: 'ORD',
        services: [{ id: 'svc-1', name: 'order-service', repoPath: '/srv/order', baseBranch: 'main' }],
      },
    ],
  },
  requirements: [
    {
      id: 'req-1',
      code: 'REQ-2026-001',
      title: '订单列表加筛选',
      project: 'proj-1',
      points: [{ id: 'p1', title: '列表筛选', acceptance: [{ id: 'a1', text: '选状态=已支付后只剩已支付订单' }] }],
    },
  ],
  tasks: [],
})

const richCard = () => ({
  id: 't-1',
  code: 'DEV-001',
  title: '订单列表筛选',
  project: 'proj-1',
  service: 'svc-1',
  requirementId: 'req-1',
  blocked: null,
  cases: [
    { id: 'c1', title: '按状态筛选', result: 'pass', http: { method: 'GET', url: '/api/orders?status=paid', expectStatus: 200, expectContains: 'paid' } },
    { id: 'c2', title: '错误状态码', result: 'fail', note: '返回 500：status 没做白名单校验', http: { method: 'GET', url: '/api/orders?status=xx', expectStatus: 400 } },
    { id: 'c3', title: '老接口不回归', result: 'pass', shell: { command: 'pnpm test', expectExit: 0, expectContains: 'fail 0' } },
  ],
  coding: {
    agent: 'claude-code',
    branch: 'feat/order-filter',
    commits: [{ sha: 'abc1234', message: 'feat: filter' }],
    files: [{ path: 'src/order/list.js', change: 'modified' }],
    review: { status: 'changes_requested', note: 'status 参数要白名单校验' },
  },
  quality: { cmd: 'npm run check', ok: false, exitCode: 2, timedOut: false },
  comments: [{ author: '产品', body: '筛选要先做状态白名单' }],
})

test('矿工：把卡上真实的证据搬进技能，没证据的段落不写', () => {
  const mined = mineSkillFromCard(state(), richCard())
  assert.equal(mined.ok, true, mined.reason)
  const body = mined.skill.content
  assert.match(body, /## 验收锚点/, '要有需求的验收条件')
  assert.match(body, /选状态=已支付后只剩已支付订单/)
  assert.match(body, /## 怎么验/, '要有真跑过的命令/请求')
  assert.match(body, /GET \/api\/orders\?status=paid → 200/, '接口用例要写成请求')
  assert.match(body, /`pnpm test` → 退出码 0/, 'shell 用例要写成命令')
  assert.match(body, /## 踩过的坑/)
  assert.match(body, /返回 500：status 没做白名单校验/, '失败用例要带原因')
  assert.match(body, /代码评审要求修改：status 参数要白名单校验/)
  assert.match(body, /项目检查没通过/, '项目检查的结果也是坑')
  assert.match(body, /## 改动面/)
  assert.match(body, /feat\/order-filter/)
  assert.match(body, /## 出处/)
  assert.match(body, /卡 DEV-001 · 需求 REQ-2026-001/, '要能追回来源')
  assert.ok(!/TODO|待补充|建议/.test(body), '不许留待办或泛泛的建议')
  assert.equal(mined.skill.enabled, false, '沉淀出来的必须是草稿')
  assert.deepEqual(mined.skill.projects, ['proj-1'], '默认按卡的项目限定范围')

  // 卡上项目是空的、项目只写在需求上（拆卡后常见）：范围要跟着需求走，不能退化成全局技能
  const inherited = mineSkillFromCard(state(), { ...richCard(), project: '', service: '' })
  assert.deepEqual(inherited.skill.projects, ['proj-1'], '项目只写在需求上时，技能范围也要限定到那个项目')
  assert.equal(mined.evidence.verifications, 3)
  assert.equal(mined.evidence.anchors, 1)
})

test('矿工：什么证据都没有的卡不给沉淀（不许凭标题编技能）', () => {
  const mined = mineSkillFromCard(state(), {
    id: 't-2', code: 'DEV-002', title: '空卡', project: 'proj-1', cases: [], coding: null, comments: [], blocked: null,
  })
  assert.equal(mined.ok, false)
  assert.match(mined.reason, /没有可沉淀的证据/)
})

test('矿工：技能名走 kebab-case，中文标签兜底成 from-<卡号>', () => {
  assert.equal(mineSkillName({ code: 'DEV-001' }, 'order-filter-check'), 'order-filter-check')
  assert.equal(mineSkillName({ code: 'DEV-001' }, '不合法的名字'), 'from-dev-001')
  assert.equal(mineSkillName({ code: '', id: 't-1' }, ''), 'from-card')
})

test('技能形状：projects 能写进 frontmatter 再读回来，空范围不写那一行', () => {
  const skill = sanitizeSkill({ name: 'order-filter', description: 'd', content: '# x', tags: ['a'], projects: ['proj-1', ' proj-2 '], enabled: false })
  assert.deepEqual(skill.projects, ['proj-1', 'proj-2'])
  const markdown = skillMarkdown(skill)
  assert.match(markdown, /^projects: proj-1, proj-2$/m)
  const back = skillFromMarkdown('SKILL.md', markdown)
  assert.equal(back.name, 'order-filter')
  assert.deepEqual(back.projects, ['proj-1', 'proj-2'])
  assert.match(back.content, /# x/)

  const global = skillMarkdown(sanitizeSkill({ name: 'g', description: 'd', content: '# y' }))
  assert.ok(!/^projects:/m.test(global), '全局技能不该写 projects 行')
  assert.deepEqual(skillFromMarkdown('SKILL.md', global).projects, [])
})

test('派单注入：停用的与别的项目的技能不注入，全局的照旧注入', () => {
  const library = {
    get: name => ({
      'order-filter': { name: 'order-filter', description: '订单筛选', enabled: true, projects: ['proj-1'] },
      'pay-check': { name: 'pay-check', description: '对账', enabled: true, projects: ['proj-9'] },
      'draft-one': { name: 'draft-one', description: '草稿', enabled: false, projects: [] },
      'global-one': { name: 'global-one', description: '通用', enabled: true, projects: [] },
    })[name],
  }
  configureDispatcher(new Proxy({ getActiveSkills: () => library }, {
    get: (target, key) => (key in target ? target[key] : () => undefined),
  }))
  const expert = { id: 'e-1', name: '开发工程师', emoji: '🛠️', role: 'dev', skills: ['order-filter', 'pay-check', 'draft-one', 'global-one', 'not-in-library'] }
  const task = { id: 't-1', code: 'DEV-001', title: 'x', comments: [], cases: [], project: 'proj-1' }
  const prompt = String(buildExpertPrompt(task, expert, { label: '开发中' }, { experts: [expert], projects: [] }, undefined, '', undefined, {}, []))
  assert.match(prompt, /order-filter（订单筛选）/, '同项目的技能要注入')
  assert.match(prompt, /global-one（通用）/, '全局技能要注入')
  assert.match(prompt, /not-in-library/, '库里没有的名字保持原样（可能是宿主自带的技能）')
  assert.match(prompt, /这个项目用不上的技能：.*pay-check.*只用于 proj-9/, '别的项目的要说明为什么没用')
  assert.match(prompt, /draft-one（已停用）/, '停用的要说明')
})
