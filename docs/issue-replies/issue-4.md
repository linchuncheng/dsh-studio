## 已修复：0.9.14（像素级验证，附四次踩坑记录）

先说结论：**0.9.14 起，覆盖层从窗口标题栏下沿开始**。实测遮罩层起点 y=40px，窗口按钮占 y 15–40，
抽屉头部的「设计：未登记」「关闭」在 y 42–57 —— 不再重叠。

### 为什么修了四次（这条值得留档）

| 版本 | 做法 | 为什么没成 |
| --- | --- | --- |
| 0.9.5 | `top: env(titlebar-area-height, 0px)` | 该客户端里这个环境变量取到的就是 **0**，覆盖层仍从最顶端开始 |
| 0.9.12 | UA 含 `Electron` → 下沉 32px | **这个客户端把 UA 里的 `Electron` 段去掉了** |
| 0.9.13 | 量顶部 `-webkit-app-region: drag` 元素的高度 | 量法对，但设置页那个抽屉是**宿主的 SheetDrawer**，改我们自己的 CSS 对它无效 |
| **0.9.14** | 需要下沉时**不用宿主弹层**，改走自家标记 | 生效 |

### 现在的实现

1. 用 `elementsFromPoint` 在窗口顶部几个位置找 `-webkit-app-region: drag` 的元素，**量它的高度**；
   量不到依次退回 `process.versions.electron` → UA → 0；
2. 结果写进 `--ds-titlebar-floor`，覆盖层统一
   `top: max(env(titlebar-area-height, 0px), var(--ds-titlebar-floor, 0px))`；
3. 覆盖层 6 处都吃这个值：卡片抽屉、弹窗、侧栏遮罩、登录浮层、命令面板遮罩、图片查看器；
4. 需要下沉时（floor > 0），共享 `SideDrawer` 不再用宿主 SheetDrawer，改用自带标记，与卡片抽屉同一套定位。

系统标题栏更高/更矮的话，改 `--ds-titlebar-floor` 一个变量就行。

### 验证方法（可复现）

截图后取页面区域一列（例如 x=1000）向下扫：应用标题栏是亮色，**y=40 处颜色变暗**（遮罩开始），
说明覆盖层正好落在标题栏下沿。抽屉自己的关闭按钮也在那之下。

### 防回归

- `tests/titlebar.test.mjs`（5 条）：量到标题栏用它的高度、量不到但进程有 Electron 用 32、UA 兜底、
  普通浏览器不设变量、环境异常不抛；
- `tests/overlay-titlebar.test.mjs`：所有 `position: fixed; inset: 0` 的覆盖层必须带下沉，且判定不能只靠 UA。

升级到 `@marsken/dsh-studio@0.9.14` 或更新即可。
