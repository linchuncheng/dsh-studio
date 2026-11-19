/* 判断某个 profile 里装的是不是本插件（纯函数）。
 *
 * issue #5 第 2 条：以前只认短名 `dsh-studio`，但包里注册的是 scoped 的 `@marsken/dsh-studio` ——
 * desktop profile 永远匹配不上，`detectProfile()` 一路回退到 `web`：
 * /state.profile 错、/market.installed 恒空、面板里点安装会装进 web profile。
 *
 * 抽成纯函数是为了能用**真实 profile 的 package.json**做测试（见 tests/profile-detect.test.mjs）。
 */

/** 依赖表 / bundle 列表里有没有本插件（认 scoped 名、短名与任意 scope 的同名包）。 */
export function isStudioProfile(deps, bundles) {
  const dependencies = deps !== null && typeof deps === 'object' ? deps : {}
  const list = Array.isArray(bundles) ? bundles : []
  const byDep = dependencies['@marsken/dsh-studio'] !== undefined || dependencies['dsh-studio'] !== undefined
  const byBundle = list.some(item => {
    if (typeof item !== 'string') return false
    return item === 'dsh-studio' || item.endsWith('/dsh-studio')
  })
  return byDep || byBundle
}
