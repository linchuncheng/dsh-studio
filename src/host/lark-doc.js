// 飞书文档正文的解析：把 lark-cli docs +fetch 的输出变成 { ok, title, text, error }。
// 纯函数，方便单测；起进程那半在 executor.js 的 pullFeishuDoc。
//
// lark-cli 的形状（1.0.x）：
//   { ok: true, identity: 'user', data: { document: { content: '<title>…</title>\n正文 markdown' } } }
// 失败时：{ ok: false, error: { message: '…' } }

/** 解析 lark-cli 的 fetch 输出。坏 JSON 按「原样当正文」处理，不抛。 */
export function parseFeishuDocFetch(raw) {
  const text = String(raw ?? '').trim()
  if (text === '') return { ok: false, text: '', title: '', error: '拉到了空正文：这个文档可能是空的，或者应用没有阅读权限' }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    // 有的版本/包装会直接吐 markdown：那就原样当正文
    return { ok: true, title: '', text: text.slice(0, 60000), error: '' }
  }
  if (parsed?.ok === false) {
    const message = parsed?.error?.message ?? '未知错误'
    return { ok: false, text: '', title: '', error: `lark-cli 报错：${String(message).slice(0, 260)}（可能是这个应用还没被加进文档协作者）` }
  }
  const content = String(parsed?.data?.document?.content ?? '')
  if (content.trim() === '') return { ok: false, text: '', title: '', error: '拉到了空正文：这个文档可能是空的，或者应用没有阅读权限' }
  const title = content.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? ''
  const body = content.replace(/<title>[\s\S]*?<\/title>\s*/, '')
  return { ok: true, title, text: body.slice(0, 60000), error: '' }
}
