/* 桌面客户端（Electron）的标题栏下沉量。
 *
 * issue #4 二次复现（2026-11-20，用户截图 + 像素测量）：Electron 走的是无边框窗口，
 * 但渲染进程里 env(titlebar-area-height) 取到的是 **0** —— 覆盖层仍然从窗口最顶端开始，
 * 抽屉自己的关闭按钮（y 25–60）和窗口按钮（y 15–40）叠在一起。
 *
 * 所以：检测到 Electron 就把 --ds-titlebar-floor 设成 32px，覆盖层用
 * max(env(titlebar-area-height, 0px), var(--ds-titlebar-floor, 0px)) 兜底。
 * 系统标题栏更高时改这个变量即可；Web 版不设，行为不变。
 */
export function applyTitlebarFloor(win = typeof window === 'undefined' ? undefined : window) {
  try {
    const agent = String(win?.navigator?.userAgent ?? '')
    if (!/Electron/i.test(agent)) return 0
    win.document?.documentElement?.style?.setProperty('--ds-titlebar-floor', '32px')
    return 32
  } catch {
    return 0
  }
}
