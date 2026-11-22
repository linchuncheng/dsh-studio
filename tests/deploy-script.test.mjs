// 部署脚本必须"做完就退出"，不能靠事件循环自己空
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../tools/deploy.mjs', import.meta.url), 'utf8')

test('deploy.mjs：ssh2 成功路径要显式退出（以前会卡在收尾不退）', () => {
  assert.match(source, /setTimeout\(\(\) => process\.exit\(0\), 200\)/, '成功路径要主动 process.exit(0)')
})

test('deploy.mjs：状态校验要重试（服务刚重启时端口先通、HTTP 还没起来）', () => {
  assert.match(source, /for i in \$\(seq 1 20\)/, '要重试而不是一次 curl 定生死')
  assert.match(source, /state=\\\$\{STATE\}/, 'state 要打印重试后的值')
})

test('deploy.mjs：有进度日志（卡住时能看出卡在哪一步）', () => {
  assert.match(source, /开始上传/, '要有上传进度')
  assert.match(source, /安装脚本执行中/, '要有安装阶段提示')
})

test('deploy.mjs：有看门狗，真挂住时给结论而不是无限等', () => {
  assert.match(source, /WATCHDOG/, '要有看门狗定时器')
  assert.match(source, /强制退出/, '超时要说明"上传可能已完成"')
})

test('deploy.mjs：元数据文件也要传（否则目标机的 package.json 停在老版本）', () => {
  assert.match(source, /const META = \['package.json', 'cordis\.patch\.yml', 'icon\.svg', 'README\.md'\]/, '要列出宿主元数据')
  assert.match(source, /readdirSync\(join\(root, 'locale'\)\)/, 'locale/*.json 也要传')
  assert.match(source, /for f in package\.json cordis\.patch\.yml icon\.svg README\.md/, '安装脚本要覆盖元数据')
  assert.match(source, /mkdir -p \$\{TMP\}\/src\/host\/routes \$\{TMP\}\/locale/, '临时目录要先建出来，否则 sftp/scp 报 No such file')
})

test('deploy.mjs：服务没重启不能当成功（以前 || true 把失败吞了）', () => {
  assert.match(source, /ExecMainStartTimestamp/, '要对比重启前后的服务启动时间')
  assert.match(source, /restart=NOT-APPLIED/, '没重启要显式打印')
  assert.match(source, /process\.exit\(4\)/, '没重启要非零退出')
  assert.match(source, /--no-restart/, '要留一个「只传文件」的开关')
  assert.match(source, /version=\$\(node -p/, '要打印目标机的实际版本号')
})
