import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { actorKind, automationRate, cardInterventions, isAiActor, requirementInterventions } from '../src/host/intervention.js'

/* 产品定义第 13 条（自动化率）今天算不出来。这个模块只做「把已有事实读出来」：
   评论的 by、卡片 history 的 by、签字记录 —— 不需要新增埋点。 */
describe('intervention: 人工介入统计', () => {
  it('认得出 AI 会话与人', () => {
    assert.equal(isAiActor('studio-t-123-architect'), true)
    assert.equal(isAiActor('张三'), false)
    assert.equal(actorKind('studio-t-1-dev'), 'ai')
    assert.equal(actorKind('李四'), 'human')
    assert.equal(actorKind(''), 'unknown', '空值不能算成人，也不能算成 AI')
    // 实测：系统记账写成 agent / 系统，只认 studio- 会把它们算成人
    assert.equal(actorKind('agent'), 'ai')
    assert.equal(actorKind('系统'), 'ai')
    assert.equal(actorKind('system'), 'ai')
  })

  it('一张卡：只数人做的，AI 评论与系统记账不算', () => {
    const task = {
      comments: [
        { by: 'studio-t-1-architect', at: 1 },   // AI，不算
        { by: '张三', at: 2 },                     // 人，算
      ],
      history: [
        { action: 'moved', by: 'studio-t-1-dev', at: 3 },  // AI，不算
        { action: 'moved', by: '张三', at: 4 },            // 人，算
        { action: 'dispatched', at: 5 },                   // 系统无 by，不算
      ],
      signoffs: [{ by: '李四', at: 6 }],
    }
    const points = cardInterventions(task)
    assert.equal(points.length, 3)
    assert.deepEqual(points.map(point => point.kind).sort(), ['comment', 'moved', 'signoff'])
  })

  it('一条需求：把卡上的介入点汇总，并带上需求自身签字', () => {
    const state = {
      tasks: [
        { id: 't-1', requirementId: 'r-1', comments: [{ by: '张三', at: 1 }], history: [], signoffs: [] },
        { id: 't-2', requirementId: 'r-1', comments: [{ by: 'studio-t-2-dev', at: 2 }], history: [], signoffs: [] },
        { id: 't-9', requirementId: 'r-other', comments: [{ by: '王五', at: 3 }], history: [], signoffs: [] },
      ],
    }
    const requirement = { id: 'r-1', signoffs: [{ by: '李四', at: 4 }] }
    const summary = requirementInterventions(state, requirement)
    assert.equal(summary.tasks, 2, '只统计属于这条需求的卡')
    assert.equal(summary.interventions, 2, '一张卡的人评论 + 需求签字')
    assert.deepEqual(summary.actors.sort(), ['张三', '李四'].sort())
  })

  it('自动化率：零人工介入的已交付需求占比', () => {
    const state = {
      requirements: [
        { id: 'r-1', code: 'REQ-1', signoffs: [] },
        { id: 'r-2', code: 'REQ-2', signoffs: [{ by: '张三', at: 1 }] },
      ],
      tasks: [
        { id: 't-1', requirementId: 'r-1', comments: [{ by: 'studio-t-1-dev', at: 1 }], history: [], signoffs: [] },
        { id: 't-2', requirementId: 'r-2', comments: [], history: [], signoffs: [] },
      ],
    }
    const result = automationRate(state, ['r-1', 'r-2', 'r-missing'])
    assert.equal(result.delivered, 2, '只算已交付且存在的需求')
    assert.equal(result.untouched, 1)
    assert.equal(result.rate, 0.5)
  })

  it('没有已交付需求时 rate 是 null，不是 0 —— 「没数据」和「0%」必须分开', () => {
    const result = automationRate({ requirements: [], tasks: [] }, [])
    assert.equal(result.rate, null)
    assert.equal(result.delivered, 0)
  })
})

describe('intervention: 和签字同一套口径（专家名 = AI）', () => {
  const config = { experts: [{ id: 'e1', name: '测试工程师' }, { id: 'e2', name: '产品经理' }] }

  it('AI 用专家名发的评论不算人工介入', () => {
    const task = {
      comments: [
        { by: '测试工程师', kind: 'agent', at: 1 },   // 显式 kind
        { by: '产品经理', at: 2 },                     // 只有名字，但在名册里
        { by: '张三', at: 3 },                         // 真人
      ],
      history: [{ action: 'moved', by: '测试工程师', at: 4 }],
      signoff: { by: '测试工程师', at: 5, note: 'ok' },
    }
    // 不传 config 时：专家名册用不上，但「角色名」仍然按来源不明处理（老数据里这两种混着用）
    assert.equal(cardInterventions(task).length, 1, '只有真人张三那一条算人工介入')
    assert.ok(cardInterventions(task).unknown >= 3, '角色名写的记录记成来源不明，并如实计数')
    const withConfig = cardInterventions(task, config)
    assert.equal(withConfig.length, 1, '传了 config 之后仍然只剩真人那一条')
    assert.equal(withConfig[0].by, '张三')
    assert.equal(withConfig[0].kind, 'comment')
    assert.equal(withConfig.unknown, 0, '传了 config：名册里的名字都算 AI，没有来源不明的了')
  })

  it('自动化率跟着这套口径走：角色名既不冒充人也算不出介入', () => {
    const aiOnly = {
      requirements: [{ id: 'r-1', code: 'REQ-1', signoff: { by: '测试工程师', at: 1, note: 'ok' } }],
      tasks: [{ id: 't-1', requirementId: 'r-1', comments: [{ by: '测试工程师', at: 2 }], history: [], signoffs: [] }],
    }
    assert.equal(automationRate(aiOnly, ['r-1'], config).untouched, 1, '名册里的名字 = AI，零人工介入')
    assert.equal(automationRate(aiOnly, ['r-1']).untouched, 1, '不传 config 时角色名记来源不明，也不冒充人工介入')

    const humanTouched = {
      requirements: [{ id: 'r-1', code: 'REQ-1', signoff: { by: '张三', at: 1, note: '人看过' } }],
      tasks: [{ id: 't-1', requirementId: 'r-1', comments: [], history: [], signoffs: [] }],
    }
    assert.equal(automationRate(humanTouched, ['r-1'], config).untouched, 0, '真人签过字 = 有人工介入')
  })
})
