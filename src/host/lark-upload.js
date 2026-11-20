// lark-cli 的 markdown 上传参数：**文件用相对名 + cwd 指到临时目录**。
//
// 2026-11-20 真机踩到：lark-cli 只允许「当前工作目录子树」里的文件，传绝对路径
// （~/.dsh/tmp/artifact-xxx/x.md）会被判成 unsafe file path，交付物同步全线失败；
// 而错误只落在 artifact.doc.error 里，看板上表现为「点了同步但没有文档」。
// 把参数形状单独抽出来锁住，避免再退回绝对路径。
export function larkUploadArgs({ dir, name, existing = '', folderToken = '' }) {
  const cwd = String(dir ?? '').trim()
  const fileName = String(name ?? '').trim().split(/[\\/]/).pop() ?? ''
  if (cwd === '') throw new Error('上传需要一个临时目录（cwd）：lark-cli 只认当前工作目录子树里的文件')
  if (fileName === '') throw new Error('上传需要一个文件名')
  const args = String(existing).trim() === ''
    ? ['markdown', '+create', '--folder-token', String(folderToken), '--file', fileName, '--name', fileName]
    : ['markdown', '+overwrite', '--file-token', String(existing), '--file', fileName]
  return { cwd, args }
}
