// 出站地址的守卫：host 白名单与 URL 解析。接口用例和浏览器用例共用一套规则，
// 不能一边拦一边放——浏览器能访问的地址面比 fetch 大得多（会跟着跳转、会加载子资源）。
export function hostAllowed(host, allowHosts) {
  const target = String(host ?? '').toLowerCase()
  if (target.length === 0) return false
  for (const rule of allowHosts ?? []) {
    if (rule === '*') return true
    if (rule.startsWith('*.')) {
      const tail = rule.slice(1)
      if (target.endsWith(tail) && target.length > tail.length) return true
      continue
    }
    if (target === rule) return true
  }
  return false
}

/** 把用例里的相对地址拼成绝对 URL；不合法或 host 不在白名单就抛错（错误文案直接给人看）。 */
export function resolveAllowedUrl(raw, baseUrl, allowHosts) {
  const value = String(raw ?? '').trim()
  if (value.length === 0) throw new Error('这条用例没有配访问地址')
  let url
  try {
    url = new URL(value, String(baseUrl ?? '').trim() === '' ? undefined : String(baseUrl).trim())
  } catch {
    throw new Error(`地址不合法：${value}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`只允许 http/https：${url.protocol}`)
  }
  if (!hostAllowed(url.hostname, allowHosts)) {
    throw new Error(`host ${url.hostname} 不在允许列表里（设置 → 测试执行 → 允许访问的域名）`)
  }
  return url
}
