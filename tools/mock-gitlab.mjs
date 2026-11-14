// 本地 GitLab 打桩：没有真实令牌也能把「MR 事实 → 与自报值对账」这条链跑通。
// 只实现核对用到的三个接口，返回的形状和 GitLab v4 一致。
//
//   node tools/mock-gitlab.mjs            # 默认 127.0.0.1:18098
//   MOCK_GITLAB_PORT=18099 node tools/mock-gitlab.mjs
import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_GITLAB_PORT ?? 18098)
const IID = Number(process.env.MOCK_GITLAB_IID ?? 7)

const MR = {
  iid: IID,
  title: 'feat: 库存预占（打桩）',
  state: 'opened',
  web_url: 'http://gitlab.local/demo/order/-/merge_requests/' + IID,
}
const PIPELINES = [{ id: 101, status: 'success', ref: 'task/DEV-001', web_url: 'http://gitlab.local/p/101' }]
// 三个文件、三个提交：卡上自报 2 文件 1 提交时，核对应该报出两处不一致
const CHANGES = {
  commits_count: 3,
  changes: [{ new_path: 'src/a.js' }, { new_path: 'src/b.js' }, { new_path: 'src/c.js' }],
}

const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url ?? '')
  const send = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (url.includes('/merge_requests/' + IID + '/pipelines')) return send(200, PIPELINES)
  if (url.includes('/merge_requests/' + IID + '/changes')) return send(200, CHANGES)
  if (url.includes('/merge_requests/' + IID)) return send(200, MR)
  return send(404, { message: 'mock gitlab: no route for ' + url })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('mock gitlab on http://127.0.0.1:' + PORT + ' (iid ' + IID + ', 3 files / 3 commits)')
})
