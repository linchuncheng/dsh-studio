// Windows 上 npm 装的 CLI 是 .cmd 壳，只能经 cmd.exe 执行；而 cmd.exe 会把
// & | < > ^ % " 当语法字符 —— 参数里带这些就会把命令截断。
//
// 2026-11-20 真机两次踩到：
//   1) 云盘 list 的 --page-token 里带 `|` → cmd 当成管道，命令直接废掉；
//   2) 交付物标题带 `&`（「退款&对账」）→ 上传命令在 & 处断掉。
// 所以经 cmd.exe 时必须逐个参数加引号（引号内的这些字符是安全文本）。

const NEEDS_QUOTE = /[\s&|<>^%"'`()]/

/** 给 cmd.exe 用的参数：含空白或 cmd 语法字符时用双引号包起来（内部引号翻倍）。 */
export function quoteForCmd(args) {
  return (Array.isArray(args) ? args : []).map(raw => {
    const arg = String(raw ?? '')
    if (arg === '') return '""'
    if (!NEEDS_QUOTE.test(arg)) return arg
    return `"${arg.replace(/"/g, '""')}"`
  })
}

/** 组装 spawn 的参数：Windows 走 cmd /c（带引号），其它平台原样。 */
export function commandArgs(command, args, platform = process.platform, comspec = process.env.ComSpec) {
  if (platform === 'win32') return { file: comspec ?? 'cmd.exe', argv: ['/c', command, ...quoteForCmd(args)] }
  return { file: command, argv: [...args] }
}
