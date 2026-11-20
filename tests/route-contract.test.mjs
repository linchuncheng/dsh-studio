// 路由层白名单（issue #11 剩下的「路由严格化」）。
//
// 和工具层的区别：路由有面板这个自家调用方，所以只对「字段少、形状明确」的写路由启用白名单。
// 这里的测试既证明未知字段会被拒，也证明**面板实际的 payload 不会被误伤**。
import assert from 'node:assert/strict'
import test from 'node:test'

import { declaredRoutes, rejectUnknownFields } from '../src/host/route-contract.js'

test('白名单：未知字段直接拒，并列出这个路由接受什么', () => {
  assert.throws(() => rejectUnknownFields('/requirement/review', { id: 'req-1', decision: 'approve', bogus: 1 }), /未知字段「bogus」/)
  assert.throws(() => rejectUnknownFields('/requirement/review', { id: 'req-1', bogus: 1 }), /只接受/)
  // 多个未知字段一起点名
  assert.throws(() => rejectUnknownFields('/task/merge', { id: 't-1', a: 1, b: 2 }), /未知字段「a、b」/)
})

test('白名单：面板实际发的 payload 必须原样通过（不能误伤自家调用方）', () => {
  // 这些形状是逐条 grep 面板调用点抄下来的，见 web/src/studio/**
  const panelPayloads = [
    ['/task/comment', { id: 't-1', body: '评论', author: '人', kind: 'human' }],
    ['/task/comment', { id: 't-1', action: 'remove', commentId: 'c-1', by: '架构师' }],
    ['/task/checklist', { id: 't-1', action: 'toggle', itemId: 'c1', done: true, note: '' }],
    ['/requirement/review', { id: 'req-1', decision: 'approve', note: '', by: '产品', operator: '产品' }],
    ['/requirement/signoff', { id: 'req-1', action: 'sign', note: 'ok', by: '张三' }],
    ['/task/merge-gate', { id: 't-1', by: '人' }],
    ['/task/merge', { id: 't-1', by: '人' }],
  ]
  for (const [route, body] of panelPayloads) {
    assert.doesNotThrow(() => rejectUnknownFields(route, body), `${route} 的面板 payload 被误伤了：${JSON.stringify(body)}`)
  }
})

test('白名单：没登记的路由与非法 body 一律放过（那是别人的事）', () => {
  assert.doesNotThrow(() => rejectUnknownFields('/task/update', { id: 't-1', anything: 1 }), '没登记的路由不参与')
  assert.doesNotThrow(() => rejectUnknownFields('/task/merge', null))
  assert.doesNotThrow(() => rejectUnknownFields('/task/merge', 'not-an-object'))
  assert.doesNotThrow(() => rejectUnknownFields('/task/merge', [1, 2]))
})

test('白名单：登记表本身要合理（路由唯一、字段非空）', () => {
  const list = declaredRoutes()
  assert.ok(list.length >= 6, `登记的路由太少：${list.length}`)
  const routes = new Set()
  for (const item of list) {
    assert.ok(item.route.startsWith('/'), `路由要以 / 开头：${item.route}`)
    assert.ok(item.fields.length > 0, `${item.route} 的字段不能为空`)
    assert.ok(!routes.has(item.route), `重复登记：${item.route}`)
    routes.add(item.route)
  }
})
