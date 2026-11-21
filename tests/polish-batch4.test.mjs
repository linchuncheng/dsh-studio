// 第四批：性能与公开接口边界。
import assert from 'node:assert/strict'
import test from 'node:test'

test('intake/mine/query 按来源限流：10 分钟最多 30 次', async () => {
  const { configureRequirementRoutes, handleRequirementRoute } = await import('../src/host/routes/requirements.js')
  const responses = []
  configureRequirementRoutes({
    readJsonBody: async () => ({ contact: '13800000000' }),
    sendJson: (_res, status, body) => responses.push({ status, body }),
    publicState: () => ({}),
  })
  const store = { snapshot: () => ({ requirements: [], tasks: [] }) }
  const req = { socket: { remoteAddress: '203.0.113.9' } }
  for (let index = 0; index < 31; index += 1) {
    const handled = await handleRequirementRoute({
      method: 'POST', route: '/intake/mine/query', req, res: {}, store,
      url: new URL('http://localhost/intake/mine/query'),
    })
    assert.equal(handled, true)
  }
  assert.equal(responses.length, 31)
  assert.equal(responses[0].status, 200)
  assert.equal(responses[29].status, 200, '前 30 次仍然放行')
  assert.equal(responses[30].status, 429, '第 31 次必须限流')
  assert.match(String(responses[30].body.error), /10 分钟/)
})
