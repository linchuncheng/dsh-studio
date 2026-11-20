// 评论的修改与删除。
//
// 为什么需要：评论是 agent 读卡时的主要输入（进度、评审结论、交接说明都写在里面）。
// 以前只能增不能改——写错一句话、重复发一条、过时的结论，都只能留着误导下一个人（issue #19）。
//
// 两条纪律：
//   1. 改/删都留历史（谁、什么时候、原来是什么），台账不能看起来像"一直都是这么写的"；
//   2. 不存在就报错，不做静默成功。
import { text } from './domain.js'

const clip = (value, max = 30) => {
  const raw = String(value ?? '')
  return raw.length > max ? `${raw.slice(0, max)}…` : raw
}

/** 改一条评论（只改正文）。 */
export async function updateTaskComment(store, taskId, commentId, body, by = '人') {
  const content = text(body, 20000)
  if (content === undefined) throw new Error('body is required（改评论要给出新的正文）')
  const wanted = String(commentId ?? '').trim()
  if (wanted === '') throw new Error('commentId is required')
  let result
  await store.mutate(state => {
    const task = state.tasks.find(item => item.id === String(taskId ?? ''))
    if (task === undefined) throw new Error(`no task ${taskId}`)
    const target = (task.comments ?? []).find(item => item.id === wanted)
    if (target === undefined) throw new Error(`no comment ${wanted}`)
    const before = String(target.body ?? '')
    if (before === content) throw new Error('新正文和原来一样：要么改内容，要么用 action=remove 删掉')
    target.body = content
    target.editedAt = Date.now()
    target.editedBy = String(by ?? '人').slice(0, 60)
    task.history = [...(task.history ?? []), {
      at: Date.now(), by: String(by ?? '人').slice(0, 60), status: task.status,
      note: `改了评论 ${target.id}（${clip(before, 20)} → ${clip(content, 20)}）`,
    }]
    task.updatedAt = Date.now()
    result = task
  })
  return { task: result }
}

/** 删一条评论。 */
export async function removeTaskComment(store, taskId, commentId, by = '人') {
  const wanted = String(commentId ?? '').trim()
  if (wanted === '') throw new Error('commentId is required')
  let result
  await store.mutate(state => {
    const task = state.tasks.find(item => item.id === String(taskId ?? ''))
    if (task === undefined) throw new Error(`no task ${taskId}`)
    const target = (task.comments ?? []).find(item => item.id === wanted)
    if (target === undefined) throw new Error(`no comment ${wanted}`)
    task.comments = task.comments.filter(item => item.id !== wanted)
    task.history = [...(task.history ?? []), {
      at: Date.now(), by: String(by ?? '人').slice(0, 60), status: task.status,
      note: `删了评论 ${wanted}（${String(target.author ?? '')}：${clip(target.body)}）`,
    }]
    task.updatedAt = Date.now()
    result = task
  })
  return { task: result }
}
