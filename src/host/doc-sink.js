// 文档出口（DocSink）：一条交付物该写到哪儿。
//
// 原则（REQ-2026-001 定案）：真源永远是 Studio 里的 artifact；飞书与 WeKnora 都只是投影。
// 所以这一层只决定「往哪写、谁是主」，不负责搬运，也不做 IO —— 纯函数，方便被两处复用
// （同步交付物、设置面板回显配置）。

/** 支持的出口。both = 两边都写，飞书为主（人看的先落地）。 */
export const DOC_PROVIDERS = ['feishu', 'weknora', 'both']

const pickProvider = value => (DOC_PROVIDERS.includes(String(value ?? '').trim()) ? String(value).trim() : '')

/** WeKnora 连接的形状。空串表示还没配，不报错（配错才报错）。 */
export function sanitizeWeKnoraSink(raw) {
  const src = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    baseUrl: String(src.baseUrl ?? '').trim().slice(0, 300),
    apiKey: String(src.apiKey ?? '').trim().slice(0, 200),
    tenantId: String(src.tenantId ?? '').trim().slice(0, 40),
    knowledgeBaseId: String(src.knowledgeBaseId ?? '').trim().slice(0, 60),
  }
}

/** 出口配置：全局默认 + 按项目覆盖。未知值一律回落到 feishu，不留半配置状态。 */
export function sanitizeDocsConfig(raw, base = {}) {
  const src = raw !== null && typeof raw === 'object' ? raw : {}
  const fallback = base !== null && typeof base === 'object' ? base : {}
  const provider = pickProvider(src.provider ?? fallback.provider) || 'feishu'
  const table = src.perProject ?? fallback.perProject
  const perProject = {}
  if (table !== null && typeof table === 'object' && !Array.isArray(table)) {
    for (const [key, value] of Object.entries(table)) {
      const id = String(key ?? '').trim().slice(0, 60)
      const picked = pickProvider(value)
      if (id !== '' && picked !== '') perProject[id] = picked
    }
  }
  return {
    provider,
    perProject,
    weknora: sanitizeWeKnoraSink(src.weknora ?? fallback.weknora),
  }
}

/** 谁说了算：需求级 > 项目级 > 全局默认。 */
export function docProviderFor(config, requirement) {
  const docs = config?.docs !== null && typeof config?.docs === 'object' ? config.docs : {}
  const fromRequirement = pickProvider(requirement?.docsProvider)
  if (fromRequirement !== '') return fromRequirement
  const projectId = String(requirement?.project ?? '').trim()
  if (projectId !== '') {
    const fromProject = pickProvider(docs.perProject?.[projectId])
    if (fromProject !== '') return fromProject
  }
  return pickProvider(docs.provider) || 'feishu'
}

/**
 * 这条交付物要写哪几个出口、谁是主。
 * both 时飞书是主：主从不许反转 —— WeKnora 失败只记 error，不阻塞交付物登记。
 */
export function docSinksFor(config, requirement) {
  const provider = docProviderFor(config, requirement)
  if (provider === 'both') return { provider, sinks: ['feishu', 'weknora'], primary: 'feishu' }
  return { provider, sinks: [provider], primary: provider }
}

/** 台账键：同一份交付物换出口不换身份（幂等键，别用远端文档 id）。 */
export function artifactDocKey(task, artifact) {
  const head = String(task?.code ?? '').trim() || String(task?.id ?? '').trim()
  return `${head}::${String(artifact?.id ?? '').trim()}`
}
/** 交付物在每个出口上的台账。形状很小，但要能在重启后活下来（换出口不丢历史）。 */
export function sanitizeArtifactDocs(raw) {
  const src = raw !== null && typeof raw === 'object' ? raw : {}
  const wk = src.weknora !== null && typeof src.weknora === 'object' ? src.weknora : {}
  return {
    weknora: {
      knowledgeId: String(wk.knowledgeId ?? '').trim().slice(0, 80),
      url: String(wk.url ?? '').trim().slice(0, 500),
      at: Number(wk.at) || 0,
      error: String(wk.error ?? '').slice(0, 300),
    },
  }
}
