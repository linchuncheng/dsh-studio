## 已修复：0.9.2（桌面客户端实测通过）

感谢报告，两个正是"工具能用、面板没有"的根因，都在真实 DSH Desktop 上验证过了。

### 1. 客户端模块 id 用了短名

确认无误：注册 id 必须等于**宿主分配给这个插件的模块 id**，而它不是固定值：

| 安装方式 | 宿主分配的 id | 脚本地址 |
| --- | --- | --- |
| npm / profile 安装 | 包名 `@marsken/dsh-studio` | `/plugins/??@marsken/dsh-studio/client.js&rev=…` |
| 本地目录挂载 | 目录名 `dsh-studio` | `/plugins/??dsh-studio/client.js&rev=…` |

所以**写死任何一个都会在另一种安装方式下失效**（我实测过三种写法：写死短名 → 本地活、npm 死；写死包名 → npm 活、本地死；运行时解析 → 都对）。

现在的做法：优先读宿主写进页面的 `window.__DSH_BOOT__.entries` 找到自己那条 `{ id, url }` 取 `id`，
取不到再从自己的 `document.currentScript.src` 推（要吃掉 `/plugins/??` 前缀、逗号分隔和 `&rev=`），
最后才退回包名。GitHub Packages 镜像（`@marsken88/dsh-studio`）也因此自动适配，不再需要字符串替换。

### 2. 写工具抛 `recordAudit is not defined`

`src/host/tools.js` 里三处裸引用了 `index.js` 的 `recordAudit`（没走 `configureToolHost` 注入）。
已加进注入列表并改成 `host.recordAudit(...)`。

另外按 issue #5 第 1 条的建议，把 **40 个工具的权限档位全部显式登记**（读 `read` / 写 `write` / 发布类 `admin`），
并加契约测试遍历注册表——漏登记会让读工具退化成 write，这正是这条 bug 的温床。

### 防回归

- `tests/module-id.test.mjs`：产物里必须有运行时解析、不许写死短名；
- `tests/tools-audit.test.mjs`：静态禁止裸调用宿主能力 + 动态起真 `StudioStore` 跑一个写工具；
- 原来 `tests/repo.test.mjs` 里那条「bundle 注册名必须是 `dsh-studio`」的断言就是同源 bug，已改掉。

### 实测

- 本机 DSH Desktop + `desktop` profile：侧栏「需求&任务工作空间」正常出现，面板可用；
- `npm run verify:desktop`：插件已加载、`/state.profile = desktop`、`/market.installed` 22 项、破坏性路由 400。

升级到 `@marsken/dsh-studio@0.9.14`（或更新）即可。
