import { Client } from 'ssh2'
const client = new Client()
client.on('ready', () => {
  client.exec("echo 1234 | sudo -S journalctl -u dsh-web -n 120 --no-pager 2>/dev/null | grep -o 'token=[A-Za-z0-9_-]*' | tail -1", (err, stream) => {
    if (err) { console.log('ERR ' + err.message); client.end(); return }
    let data = ''
    stream.on('data', (c) => { data += c })
    stream.on('close', () => { console.log(data.trim().replace('token=', '')); client.end() })
  })
}).on('error', (e) => { console.log('CONN ' + e.message); process.exit(1) })
client.connect({ host: '192.168.120.218', username: 'lyf', password: '1234', readyTimeout: 15000 })
