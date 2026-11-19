// webhook 订阅者：把事件 POST 给配置里的地址。失败只记健康，不重试、不阻塞。
import { emitEvent, subscribeDurable } from './events.js'
import { markHealth } from './integrations.js'

export const WEBHOOK_EVENTS = ['task/moved', 'case/failed', 'gate/blocked', 'agent/failed', 'regression/finished']

export function sanitizeWebhooks(raw) {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 20).map((item, index) => {
    const source = item !== null && typeof item === 'object' ? item : {}
    const url = String(source.url ?? '').trim().slice(0, 500)
    const events = (Array.isArray(source.events) ? source.events : []).map(String).filter(name => WEBHOOK_EVENTS.includes(name))
    return {
      id: String(source.id ?? '').trim().slice(0, 40) || 'hook-' + (index + 1),
      url,
      events: events.length > 0 ? events : [...WEBHOOK_EVENTS],
      enabled: source.enabled !== false,
    }
  }).filter(hook => hook.url !== '')
}

/** 私网 / 链路本地 / 回环地址：盲打这些地址等于让平台替调用方扫内网（SSRF）。
 *  配置里 testing.allowHosts 可以显式放行（默认只放 127.0.0.1 / localhost）。 */
function isPrivateHost(hostname) {
  const host = String(hostname ?? '').replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) return true
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)) return true
  if (/^169\.254\./.test(host)) return true          // 云元数据
  if (/^fc00:|^fd[0-9a-f]{2}:|^fe80:/.test(host)) return true
  return false
}

/** 这个出站地址是否允许。允许 = 公网地址，或在 allowHosts 白名单里。 */
export function isAllowedOutbound(url, allowHosts = []) {
  let parsed
  try { parsed = new URL(String(url ?? '')) } catch { return false }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const host = parsed.hostname
  if (!isPrivateHost(host)) return true
  const list = Array.isArray(allowHosts) ? allowHosts.map(item => String(item).trim().toLowerCase()) : []
  return list.includes(host.toLowerCase())
}

/** 真正发出去：每个订阅地址一次 POST，5 秒超时。 */
export async function deliverWebhooks(config, event) {
  const hooks = (config?.webhooks ?? []).filter(hook => hook.enabled !== false && (hook.events ?? []).includes(event.type))
  for (const hook of hooks) {
    const allowHosts = config?.testing?.allowHosts ?? []
    if (!isAllowedOutbound(hook.url, allowHosts)) {
      markHealth('webhook', 'fail', hook.id + ' 目标地址在内网，且不在 testing.allowHosts 白名单里')
      continue
    }
    try {
      const response = await fetch(hook.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(5000),
      })
      // 投递结果进「集成健康」，否则地址写错了没人知道——事件是 fire-and-forget，不会报错给你。
      if (response.ok) markHealth('webhook', 'ok', hook.id + ' ' + event.type)
      else markHealth('webhook', 'fail', hook.id + ' HTTP ' + response.status)
    } catch (error) {
      markHealth('webhook', 'fail', hook.id + ' ' + String(error?.message ?? error).slice(0, 120))
    }
  }
}

/** 进程内接上：事件 → webhook。返回取消订阅函数。
 *  用 subscribeDurable：**账本先落盘，再往外发**，所以外部收到的每个 seq 都能查回来。 */
export function attachWebhooks(store) {
  return subscribeDurable(event => {
    void deliverWebhooks(store?.snapshot?.()?.config, event)
  })
}

export { emitEvent }
