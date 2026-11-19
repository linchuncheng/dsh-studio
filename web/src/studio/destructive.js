/* 破坏性路由的确认词（纯数据 + 一个拼装函数）。
 *
 * 宿主（0.9.6 起）对删数据/清审计/改权限/动发布这类路由强制要求 `confirm` 字段，
 * 值是这里的词。界面上这些操作本来都弹过确认框，所以前端统一在这里补 ——
 * 免得每个调用点都要记一遍词，也免得漏一个就 400。
 */

export const DESTRUCTIVE_CONFIRM = {
  '/audit/clear': 'CLEAR',
  '/team/memory/clear': 'CLEAR',
  '/task/delete': 'DELETE',
  '/requirement/delete': 'DELETE',
  '/release/delete': 'DELETE',
  '/projects/delete': 'DELETE',
  '/repos/delete': 'DELETE',
  '/bots/delete': 'DELETE',
  '/experts/delete': 'DELETE',
  '/teams/delete': 'DELETE',
  '/suite/delete': 'DELETE',
  '/skills/delete': 'DELETE',
  '/access/delete': 'DELETE',
  '/snapshot/restore': 'RESTORE',
  '/market/install': 'INSTALL',
  '/market/uninstall': 'UNINSTALL',
  '/release/publish': 'PUBLISH',
  '/release/rollback': 'ROLLBACK',
  '/reset': 'RESET',
  '/access/save': 'SAVE ACCESS',
}

/** 破坏性路由补 confirm；其它路由原样返回。 */
export function withDestructiveConfirm(path, body) {
  const word = DESTRUCTIVE_CONFIRM[path]
  if (word === undefined) return body
  const base = body !== null && typeof body === 'object' ? body : {}
  if (base.confirm !== undefined) return base
  return { ...base, confirm: word }
}
