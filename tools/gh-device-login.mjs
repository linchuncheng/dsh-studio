#!/usr/bin/env node
/**
 * GitHub 设备码登录（不依赖 gh 的交互提示）：把一次性码打出来，用户去浏览器授权，
 * 脚本轮询拿到 token，直接写进 gh 的凭据（gh auth login --with-token），然后删掉临时文件。
 *
 *   node tools/gh-device-login.mjs          # 打印码并开始轮询（最多 15 分钟）
 *
 * 只用 gh 自己的公开 OAuth client id，不新增任何第三方 app。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CLIENT_ID = process.env.GH_CLIENT_ID ?? 'Iv1.b507a08c87ecfe98'   // gh CLI 的公开 client id
const SCOPE = process.env.GH_SCOPE ?? 'public_repo'
const GH = process.env.GH_BIN ?? findGh()

function findGh() {
  const candidates = [
    join(process.env.LOCALAPPDATA ?? '', 'Microsoft/WinGet/Packages/GitHub.cli_Microsoft.Winget.Source_8wekyb3d8bbwe/bin/gh.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs/GitHub CLI/bin/gh.exe'),
    '/usr/bin/gh',
    '/usr/local/bin/gh',
  ]
  return candidates.find(item => existsSync(item)) ?? 'gh'
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const start = await fetch('https://github.com/login/device/code', {
  method: 'POST',
  headers: { accept: 'application/json', 'content-type': 'application/json' },
  body: JSON.stringify({ client_id: CLIENT_ID, scope: SCOPE }),
})
const startJson = await start.json()
if (!start.ok || startJson.user_code === undefined) {
  console.error('申请设备码失败：', JSON.stringify(startJson).slice(0, 300))
  process.exit(1)
}
const { device_code: deviceCode, user_code: userCode, verification_uri: uri = 'https://github.com/login/device', interval = 5, expires_in: expiresIn = 900 } = startJson
console.log(`DEVICE_CODE ${userCode}`)
console.log(`VERIFY_URL ${uri}`)
console.log(`请打开 ${uri}，输入代码 ${userCode}，授权后脚本会自动继续（最多 ${Math.round(expiresIn / 60)} 分钟）`)

const deadline = Date.now() + expiresIn * 1000
let token = ''
while (Date.now() < deadline) {
  await sleep(interval * 1000)
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  })
  const json = await res.json()
  if (typeof json.access_token === 'string' && json.access_token !== '') { token = json.access_token; break }
  if (json.error === 'authorization_pending') continue
  if (json.error === 'slow_down') { await sleep(5000); continue }
  console.error('授权失败：', json.error ?? JSON.stringify(json).slice(0, 200))
  process.exit(1)
}

if (token === '') {
  console.error('超时：没有拿到 token')
  process.exit(1)
}

// 写进 gh 的凭据（不落明文到工作区：写到临时文件后立刻删）
const temp = join(homedir(), '.dsh', '.gh-token-tmp')
writeFileSync(temp, token, { mode: 0o600 })
const login = spawnSync(GH, ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--with-token'], {
  input: readFileSync(temp, 'utf8'),
  encoding: 'utf8',
})
rmSync(temp, { force: true })
if (login.status !== 0) {
  console.error('gh auth login 失败：', String(login.stderr ?? '').slice(0, 300))
  process.exit(1)
}
const status = spawnSync(GH, ['auth', 'status'], { encoding: 'utf8' })
console.log(status.stdout?.trim() ?? status.stderr?.trim() ?? '')
console.log('OK 已登录并写入 gh 凭据（临时文件已删除）')
