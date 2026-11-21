# 登录与免登录

从 README 拆出来的登录相关三节。看完回 [README](../README.md)。

## 统一登录（LDAP，2026-11-09）

平台自己不做密码库：账号和密码交给目录服务验证，验过之后把用户名记下来，归属和审计都挂在这个名字上。

### 配置
- `config.ldap = { enabled, url, baseDN, bindDN, bindPassword, userFilter, nameAttr, mailAttr, deptAttr, defaultRole, requireLogin, timeoutMs }`：
  - `url` 必须是 `ldap://` 或 `ldaps://`；`userFilter` 里必须带 `{user}`（登录时替换成输入的用户名，且已经按 RFC 2254 转义 `\ * ( ) \0`）；
  - `nameAttr` / `mailAttr` / `deptAttr` 决定显示名、邮箱、部门取哪个属性（AD 一般是 `displayName` / `mail` / `department`）；
  - `requireLogin` 才是「锁门」，`enabled` 只表示启用登录（可以先配好、后开门）。
- **服务账号密码只存在 `~/.dsh/dsh-studio.secrets.json`（0600）**：`/state` 里只有 `bindPasswordSet: true/false`，导出、快照、日志里都没有明文；保存时不传密码就沿用旧密码，要清掉得显式传 `clearBindPassword: true`。
- 依赖系统里有 `ldapsearch`（Ubuntu：`apt-get install ldap-utils`），实现走 `ldapsearch -y <0600 临时文件>`，密码不出现在进程参数里，用完即删。

### 登录与会话
- `POST /auth/login { username, password, mode }`：`mode` 有三个值——
  - `'ldap'`：只走目录（`userFilter` 查人 → 用这个人的 DN 重新绑一次验密码）；
  - `'local'`：只走本地超管（scrypt 哈希比对），失败直接 401 并给出「本地超管的账号或口令不对…」；
  - 不传（老调用方）：先本地、后目录，即目录故障时超管能兜底。
  成功后返回 `{ token, expiresAt, user }`。
- 会话是内存里的 `Map`（12 小时过期），请求头 `x-studio-session: <token>`；重启服务会话即失效，需要重新登录。
- `GET /auth/me` 查当前会话，`POST /auth/logout` 主动销毁。
- 首次登录把用户写进 `config.users`（`{ id, name, mail, dept, dn, role, source:'ldap', firstLoginAt, lastLoginAt, loginCount, lastIp }`），之后只更新登录次数与最近时间——这就是「获取正确的用户名并记录」。
- 登录成功/失败都进审计日志（`登录失败` / `LDAP 登录成功` / `本地超管登录成功`）。

### 锁门行为（requireLogin = true）
- 未登录访问业务接口 → `401 { code: 'login_required' }`。
- 未登录访问 `/state` → 200 但只回 `{ ok: true, locked: true, state: { revision, config, tasks: [], requirements: [], releases: [] } }`，前端据此渲染登录框（不进看板）。
- 开放集合只有：`/`、`/state`、`/auth/login`、`/auth/me`、`/auth/logout`、`/auth/ldap/test`。

### 界面
- 登录框顶部是**两档切换**：`LDAP 账号` / `本地超管`，下面只有**一个**「登录」按钮，文案跟着当前档变（「登录（LDAP）」/「登录（本地超管）」）。
  - 切到 `本地超管`：账号自动填成 `localAuth.username`（默认 `admin`），密码框占位提示「默认口令 admin」，回车即提交；
  - LDAP 没启用时 `LDAP 账号` 那一档是禁用态，默认落在 `本地超管`；
  - 失败提示分档：本地侧给「本地超管的账号或口令不对（账号 admin，还没改过口令就是默认的 admin）」，目录侧给中文原因。
- 登录后页头 `👤` 显示「超级管理员」（本地）或 LDAP 的显示名，旁边是「退出登录」。
- 设置 →「安全」→「统一登录（LDAP）」：启用、必须登录、服务器、超时、BASE DN、服务账号 DN、密码（已保存则留空表示不改）、过滤器、三个属性名；**「测试连接」**逐条给出「绑定服务账号 / 查人 / 验密码」的结果与耗时；底部列出登录过的人及次数。
- 登录框只有开启「必须登录」时才强制出现；只开 `enabled` 时行为与以前一致。

### 联调记录与网络前提（2026-11-09）
- 本机用临时 slapd（`dc=test,dc=local`，`alice/Passw0rd!`、`bob/BobPass123`）跑过 `tools/verify-ldap.mjs`：**23/23 PASS**（配置写入、状态里无明文、测试连接、登录成功、显示名/邮箱/部门、users 记录、`/auth/me`、错密码 `badpass`、不存在 `notfound`、锁门 `/state` 与 401、带会话可访问、退出后失效、收尾关开关）；联调用的 slapd 与测试账号已卸载清空。
- **公司 LDAP（`ldap.<公司域>:389`）从目标机不可达**（解析到内网地址，ping 全丢、TCP 389 不通，`ldapsearch` 超时）。真实参数已经写进配置（`url / baseDN / bindDN / 密码`），但 `enabled` 与 `requireLogin` **都关着**：等这台机器能访问目录服务（内网路由 / VPN / 防火墙放行 389），到设置里点「测试连接」通过后再打开开关，否则会把所有人锁在门外。
- `parseLdif` 支持 RFC 2849 的 `attr:: base64`（AD 的中文 `displayName` 就是这样编码的）；`ldapsearch` 的过滤器必须排在属性**前面**，否则会被当成属性名、搜索退化成 `(objectClass=*)` 并触发 `Size limit exceeded`。

## 本地超管账号与免登录（2026-11-09）

登录界面一直都在（`LoginGate`），但**默认不需要登录**：没有配置 LDAP 的时候，平台直接以本地超管身份运行，写操作和审计都记在它名下。

### 默认账号

- 账号 `admin`，口令 `admin`（`config.localAuth.password === null` 表示「还是默认口令」，这样默认值稳定、不随服务启动变化）。页头会显示「· 默认口令」提醒；改掉之后这个标记消失。
- 改过密码之后，`{ salt, hash, at }`（`scryptSync` + 16 字节随机盐）只存在 **0600 的密钥文件** `~/.dsh/dsh-studio.secrets.json` 里；台账与快照只留 `password: null`（加载时补回内存，老库在下一次写盘时自动迁走）。`/state` 只下发 `{ enabled, username, hasPassword, mustChange, updatedAt }`，**永远不下发口令或哈希**。
- 官方建议：进「设置 → 安全 → 统一登录（LDAP）」把默认口令改掉，或直接点一下「重置为默认口令」（需要知道当前口令）。

### 什么时候要登录

`locked = ldap.enabled && ldap.requireLogin`：

| LDAP 启用 | 必须登录 | 行为 |
| --- | --- | --- |
| 否 | 否 | **免登录**，请求算「超管 admin」，页头显示 `👤 超管 admin` + 「登录」按钮（可选用域账号登录） |
| 是 | 否 | 免登录，但可以主动点「登录」换成个人身份 |
| 是 | 是 | 弹登录框；LDAP 账号或本地超管都能登 |

### 接口

- `POST /auth/login { username, password }`：**先试本地超管**（用户名大小写不敏感），不匹配再走 LDAP；本地成功返回 `user.source = 'local'`、`role = 'admin'`。
- `POST /auth/password { currentPassword, newPassword }`：改超管口令（新口令 ≥ 8 位）；`{ currentPassword, reset: true }` 重置回默认口令。
- `GET /auth/me`、`POST /auth/logout` 不变。

### 身份解析（谁写的、记谁）

`resolveActor(req, config)`：有会话 → 会话里的显示名；没锁门 → 本地超管（`超管 admin`）；锁门且没会话 → 空（由权限检查拦）。请求管线和审计包装层都用它，所以免登录时的写操作不会记成匿名或请求头里的假名字。

会话里直接带了 `{ userId, name, role, source }`，`sessionOf()` 不再要求这个人出现在 `config.users` 里——本地超管本来就不在 LDAP 名册中。

### 界面

- 页头：未登录显示 `👤 超管 admin` + 「登录」；登录后显示 `👤 姓名` + 「退出登录」（退出后回到超管身份）。
- 登录框：提示「也可以用它自己的超管账号（本地）：admin」；LDAP 没启用时底部写「LDAP 还没启用：直接用超管账号登录」，并有「先不登录」按钮（免登录模式下可随时关掉）。
- 设置 → 安全 →「统一登录（LDAP）」：最上面一块是「本地超管账号」，显示当前账号、是否已设密码，可改密码。

### 验证

`tools/verify-auth.mjs`（在 `.218` 上 `node /tmp/verify-auth.mjs`）**22/22 PASS**：默认不锁、下发 `localAuth` 不含口令、`admin/admin` 能登录、`/auth/me`、带会话写卡审计记「超级管理员」、不带会话写卡审计记「超管 admin」、错口令 401、改口令后旧口令失效新口令可用、短口令被拒、重置回默认、用户名大小写不敏感、清理测试卡后状态回基线。

## 登录会话落库（2026-11-10）

之前会话只存在服务端内存 `Map` 里，**每次部署重启都会把所有人踢下线**。现在会话同时写进 SQLite：

- 新表 `sessions(token TEXT PRIMARY KEY, user_id, name, role, source, at, expires_at, ip)`，跟状态库同一个文件（`~/.dsh/dsh-studio.db`）。
- `issueSession()` 发牌时既写内存也写库；`/auth/logout`、过期清理都会同时删两边；启动后第一次请求时把未过期的会话读回内存。
- 会话仍然 12 小时过期，`source` 区分 `local`（内置超管）与 `ldap`（域账号），审计与卡片归属照旧读会话里的名字。

### 踩过的坑：`attachSessionStore` 挂得太早

`registerRoutes()` 是同步调用的，那时 `#boot()` 里的 `await import('node:sqlite')` 还没跑完，`store.db` 仍是 `null`——如果此时就记下「store 已挂载」，之后永远不会再读库，会话看起来「写进去了但恢复不出来」（`sessions` 表里有行、`/auth/me` 仍报 `login_required`）。

修法：`attachSessionStore()` 见到 `store.db === null` 直接返回，不设标记；请求管线里 `await store.ready` 之后再 `if (SESSION_STORE === null) attachSessionStore(store)`，这样第一次请求一定能把库里的会话装回来。

验证：登录拿到 token → `systemctl restart dsh-web` → 同一个 token 调 `/auth/me` 仍返回 `{ok:true,user:{id:'admin',role:'admin',source:'local'}}`。
﻿
### 卡片详情页签也换成 shadcn Tabs（2026-11-10）

抽屉顶部原来是自己画的下划线页签（`.ds-dw-tabs` + `<button>`），现在有 UIKIT 时走 `TabsBar`：

- `TabsBar` 的 `items` 支持 `{ id, label, count }`，`count` 会渲染成小号计数徽章（「讨论 3」这种），空值不显示；
- 抽屉里的 7 个页签（概览 / 内容 / 计划 / 交付物 / 测试 / 执行记录 / 讨论）通过 `kit('TabsBar')` 渲染，键盘左右键可在页签间切换；
- 没有 UIKIT 时仍回落原来的 `.ds-dw-tabs` 按钮组，单文件产物不会失样式。

验证：Chrome 里点开看板任意一张卡，UIA 能枚举到 7 个 `TabItem`（含「讨论 3」的计数），切换页签内容正常刷新。
﻿
### 燃尽改成折线面积图（2026-11-10）

效能页「燃尽（近 14 天剩余）」原来画柱子，剩余量常年是 0–2 张时柱高被 `min-height:2px` 压成一排小横线，看不出趋势。现在改成内联 SVG：

- `client.js` 新增 `BurnChart({ series })`：`viewBox="0 0 100 40"` + `preserveAspectRatio="none"`，`y = 38 - (remaining / max) * 32`，折线用 `path` 拼 `M/L`，面积是折线闭合到基线后填充 14% 主色；
- 每个点有 `circle` + `<title>`（悬停显示「11-05：还剩 3 张」），底部左右各标一个日期（首日 / 末日）；
- CSS：`[data-dsh-studio] .ds-burn-svg { height:84px }`、`.ds-burn-area { fill: color-mix(in srgb, var(--ds-accent) 14%, transparent) }`、`.ds-burn-line { stroke: var(--ds-accent); stroke-width:1.6 }`、`.ds-burn-axis` 两端对齐 10.5px muted 文字。
- 顺手给卡片详情页签补了轨道外观：`.ds-dw-shadcn-tabs [role="tablist"]` 28px 高、`var(--muted)` 底、`radius 8px`，`[role="tab"]` 24px 高 / 11.5px。

验证：构建 625.33 kB / gzip 189.42 kB，01:20:01 部署；效能页截图确认折线 + 面积 + 日期轴正常，抽屉里 7 个页签是 Radix TabItem（含「讨论 3」计数），切页正常。
﻿
### 成本预算条换成 Radix Progress（2026-11-10）

效能页「AI 执行成本」里的预算条原来是自绘的 `.ds-an-track` + `.ds-an-fill`，现在走 UIKIT：

- `web/src/components/studio-ui.jsx` 新增 `ProgressBar({ value, tone })`：`ProgressPrimitive.Root`（`h-2 rounded-full bg-muted`）+ `Indicator`（`translateX(-${100-pct}%)`），`tone` 取 `over` 用 `bg-destructive`、`warn` 用 `bg-amber-500`、否则 `bg-primary`；
- `client.js` 新增适配器 `ProgressField({ value, tone })`：有 `kit('ProgressBar')` 用 Radix，没有就回落原来的 `ds-an-track` 自绘条（单文件产物仍可用）；
- 预算面板调用改成 `h(ProgressField, { value: Math.min(100, Math.max(runRate, hourRate)), tone: costs.budget.level })`。

验证：构建 653794 字节部署（01:24），效能页预算条正常显示（3/500 次 · 1/80 小时），产物里 `role="progressbar"` 只出现一次（说明走的是 Radix 版本，回退分支不含该属性）。
﻿
### 关键按钮的 Tooltip 与看板状态点（2026-11-10）

- `client.js` 新增 `tipOf(label, node)`：有 UIKIT 时用 Radix `Tip`（250ms 延迟、深色气泡 + 箭头、门户挂 `[data-dsh-studio-portal]`），同时**保留原生 `title`** 作为兜底（单文件产物 / 宿主没有 UIKIT 时也有提示）。
- 挂上的四处：抽屉里「AI 失败 N 次 · 重新派单」、执行记录「核对代码事实」、版本详情「强制发布」、页头「退出登录」。
- 看板卡片状态点改成有语义的颜色：`[data-running="1"]::after` 绿色（浅色 `hsl(152 62% 38%)` / 深色 `hsl(152 60% 56%)`）+ 光晕；`[data-blocked="1"]::after` 红色圆点（与红色描边、淡红底一起表示阻塞）；两者同时存在时按阻塞显示红色。
- 之前用 `--primary`（近黑）画运行中圆点，浅色下几乎看不见，这次换成绿色后一眼能分辨。

验证：构建 626.46 kB / gzip 189.82 kB，01:34 部署；看板截图里能看到开发中卡片右上角的绿色运行点，阻塞卡片是红点 + 红描边。
﻿## 悬停说明与评论编辑区（2026-11-10）

### 三种提示写法
- `tipOf(label, node)`：给已有按钮/链接补一个 help 光标的气泡，同时保留原生 `title`（浏览器提示是兜底，Radix 气泡是主视觉）。
- `tipLabel(text, hint)`：表单标签专用，返回 `.ds-label`（`cursor:help`）再包 `tipOf`；`hint` 为空时退化成普通标签。
- `web/src/components/studio-ui.jsx` 里的内部 `Hint`：`TabsBar` 的 `item.hint` 走它——`TooltipProvider delayDuration={260}` + `Portal container={portalRoot()}`，所以抽屉/上下文中都能正常定位。

覆盖范围：顶部 8 个页签、卡片详情 7 个页签、设置左导航全部条目、12 个行内/关键按钮、9 个容易填错的字段（Agent 预设、沙箱档位、角色位、业务领域、Coding Agent、单测总数、通过数、baseUrl、连续失败几次后升级）。

### 评论编辑区
- 结构：`.ds-composer`（外框 + `focus-within` 时的 3px 淡环）内放 `TextAreaField`，下面是 `.ds-composer-bar`（左提示、中间字数、右发表按钮）。
- 快捷键：`Ctrl/⌘ + Enter` 直接发送；`@` 仍会唤起专家联想（↑↓ 选择、Enter 补全、Esc 关闭）。
- `.ds-composer .ds-textarea` 去掉了自身边框/阴影/背景，让外框承担视觉。
- 提示文案：`Markdown 可用 · 打 @ 派活 · Ctrl/⌘+Enter 发送`；空内容时右侧显示「还没写」，有内容显示字数。

﻿## 轻提示（toast）（2026-11-10）

保存、同步、归档这类动作的结果原来只写在各面板自己的小字里，面板一滚或一切页签就看不见了。现在多一层右下角的轻提示：

- `toast(text, tone = 'success', ttl = 3200)`：右上角勾/感叹号图标区分成功与失败，3.2 秒自动消失；`dismissToast(id)` 可提前关；点提示上的 × 也能关。
- 宿主是 `ToastHost`，挂在 `StudioPage` 根部（紧跟 `DialogHost`），只订阅 `TOAST_LISTENERS`，不持有业务状态；同一时刻的多条会纵向堆叠。
- 样式在 `web/src/index.css`：`.ds-toasts` 固定右下 `z-index:120`、`pointer-events:none`（只有提示本身可点），`.ds-toast` 用 `--card` 底 + `--border` 描边 + 大阴影，`[data-tone="error"]` 换红描边与红图标。
- 已接上的位置：专家/专家团/技能保存、部署环境保存、测试连接结果、云盘归档结果，以及三处 `catch` 分支（失败原因既写面板内小字、也弹一条红提示）。
- 版本页的保存/发布/回滚/登记部署/灰度/挂卡全部走 `act(path, body, done)`，`done` 文案会同时进页面小条和 toast。
- 需求页：正文保存、状态切换、签字/取消签字、排序与依赖保存。
- 面板内的 `.ds-ok` / `.ds-err` 同时改成「图标 + 文字」的药丸（成功绿、失败红，深色主题各有一版），和 toast 的观感一致；`::before` 用 `content` 画 ✓ / !，不需要额外标签。

### 发布门禁的操作区（2026-11-10）
- 原来四个按钮平铺一行、主次不分；现在分成两段：左边「生成发布说明 / 审批通过」（辅助动作），右边「发布（主按钮）/ 强制发布（琥珀色描边）」，已发布状态右侧多一个「回滚」。
- 容器是 `.ds-action-bar`：`space-between` + 顶部细线分隔，`.ds-action-bar-right` 用 `margin-left:auto` 贴右；窄屏自动换行。
- 「强制发布」用 `data-force="1"` 单独配色（浅色 #b45309、深色 #fbbf24 文字 + 琥珀描边），不再是 ghost 灰按钮，避免和「取消」类混淆。

### toast 去重
- 同一个动作可能在极短时间内触发两次（按钮重复绑定、`onBlur` 与 `onClick` 各跑一遍等）。`toast()` 现在记住上一条文案与时间，600ms 内相同文案直接吞掉。
- 实测：「生成发布说明」原来会在右下角堆两条一模一样的提示，加去重后只弹一条（2026-11-10 02:57 截图确认）。

### 需求页的操作区（2026-11-10）
- 需求抬头右侧从「状态下拉 + 编辑 + 删除（同等份量）」改成：状态下拉（宽度收窄）→ 编辑（常规按钮）→ 删除（红色 ghost）。
- 评审面板里的「打回」也改成红色 ghost；「提交评审 / 评审通过」仍是主按钮。这样一屏里只有一个主操作，破坏性动作永远是弱化的红字。
- CSS 新增 `.ds-req-actions`（flex + gap 8 + 窄状态下拉）与 `.ds-btn-ghost[data-danger="1"]`（红字红边，深色版用 #fca5a5）。

### 按钮主次与深色表面（2026-11-10）
- 主按钮 `.ds-btn-primary`、次级 `.ds-btn-ghost`、危险 `[data-danger="1"]`、警告 `[data-warn="1"]` 全部改用**实色**（不依赖 `hsl(var(--primary))`）。原因：变量在部分子树（尤其 Radix Portal）里解析不到，主按钮会退回成纯文字，主次看不出来。
- 卡片详情「推进到」按列的先后自动分级：下一列是主按钮，往前退的列是 ghost，其余常规；「标记阻塞」是琥珀色警告，解除阻塞里的「只解除，先不派」是 ghost。
- **Portal 要同时带两个属性**：抽屉/弹窗挂在 `document.body` 下，只带 `[data-dsh-studio-portal]` 时所有以 `[data-dsh-studio]` 为前缀的既有样式（按钮、chip、表单行）都不生效。现在 `portalRoot()` 会同时设置 `data-dsh-studio` 与 `data-dsh-studio-portal`，并用 `[data-dsh-studio]:not([data-dsh-studio-portal])` 读取主树的主题，避免自引用把主题锁死。
- 深色主题下补了 legacy 的表面变量（`--ds-surface:#181b22`、`--ds-surface-2:#1e222a`、`--ds-line:#2c323d`）：legacy CSS 把 `--ds-surface` 写死成 `#ffffff`，导致抽屉在暗色下依然是白底。

### 空状态统一（2026-11-10）
- 面板里「还没有… / 暂无… / 没有可用的…」这类说明行统一用 `.ds-empty`：虚线框 + 淡底 + 居中 12px 文案，取代原来 40% 透明度的小灰字（对比度太低，容易被当成没加载出来）。
- 本轮把 20 处 `className: 'ds-hint'` 的说明行换成 `.ds-empty`（专家/专家团/技能/机器人/项目/迭代/环境/成员/审计/评论等），加上原有的 5 处，全站 25 处空状态外观一致。
- 需要「标题 + 说明」两级时用 `.ds-empty-title`（12.5px/600、前景色），正文仍走 `.ds-empty` 的 muted 色。

### 项目页与市场页的卡片（2026-11-10）
- 项目页原来三张卡被挤成 ~145px 的窄列（外层容器参与父级网格导致），现在用 `.ds-body:has(> .ds-proj-grid){display:block;width:100%}` 回到整行布局，每张项目卡占满一行，统计项与清单进度条不再换行挤压。
- 项目卡、市场卡统一 shadcn Card 的解剖：`1px var(--border)` + `calc(var(--radius) - 1px)` 圆角 + `var(--ds-shadow)`，hover 时描边加深 + 抬起阴影；卡头（`.ds-proj-head/.ds-mc-head`）flex 对齐，标题 13px/600。
- `.ds-proj-stats` 改成 `flex-wrap` + 6/12 间距，窄屏自动折行；`.ds-proj-bar` 高度 6px、圆角 999px、muted 底。

### 效能页条形与零值（2026-11-10）
- 周期分布 / 每列停留的条形：计数为 0 时不再画满宽的空轨道（会被误读成满格），改成一条虚线基线；非零但很小时保留 2px 最小宽度，避免"看不见"。
- 实现：行上带 `data-empty`，CSS ` .ds-an-track[data-empty="1"]{ background:transparent; border-top:1px dashed var(--border) }`，填充条 `min-width:2px`。

### 多实例派单锁与 SLA 升级（2026-11-10）
- **派单租约**：多开一个 dsh-web（或两台机器连同一个库）时，卡片不能被两个进程同时派出去。实现是 SQLite 里的 `locks` 表（`name/owner/at`）+ 12 秒租约：`Dispatcher.tick()` 开头先 `claimDispatchLock()`，抢不到就跳过这一轮，抢到则每轮续租。没有数据库（纯内存模式）时直接放行，单实例行为不变。
- `Dispatcher.status()` 现在带 `instance`（`pid-随机串`）与 `lock`（`{owner, at, mine}`），排查「谁在派单」时看这两个字段（`/state` 的 `state.agents`）。实测：进程重启后 `instance` 变化、`lock.owner` 在 12 秒租约过期后自动交接给新进程。
- **缺陷 SLA 升级**：`escalateOverdue()` 在每轮 tick 里扫缺陷卡，`bugSla()` 判定 `overdue` 且还没升级过的，写一次 `escalatedAt` + 一条历史「SLA 超时 N 小时，已升级提醒」，并按现有飞书机器人配置广播一条；同一张卡只升一次（重复 tick 不会再写）。
- 验证：`tools/test-sla-escalation.mjs`（在 .218 跑，会临时停服改库再起服）——建 p0 缺陷卡 → 把 `createdAt` 回拨 10 小时 → 等一个 tick → 断言 `escalatedAt > 0`、历史正好一条「SLA 超时 6 小时」→ 删测试卡，7/7 PASS。

