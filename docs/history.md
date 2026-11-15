# 过程记录（按日期）

从 README 里移出来的实现流水账，保留原文。要看平台现在是什么样，看 [README](../README.md)。
## 全模块体检（2026-11-08）

`tools/audit-modules.mjs` 在服务器上跑 19 项断言，覆盖：状态接口、配置结构、需求新建/编号、需求文件夹、需求文档与基线、任务新建（模板清单 + 编号）、推进与评论 @、阻塞/解除、验收清单、交付物登记与归档、测试用例执行、AI Coding 记录/评审/合并、项目与迭代指标、专家/专家团/列负责人/技能、仓库与机器人 CRUD、内部市场、派单状态、技能库磁盘、清理。当前 **19/19 PASS**。

这一轮发现并修掉的缺陷：

1. **交付物全是空的、看板上看不到**：`syncArtifact` 硬性要求「卡必须挂需求」，没挂需求的卡一律抛错 → 从未归档；且老交付物只有 `ref` 路径没有正文。修法：未挂需求归到「未挂需求的产物」文件夹；正文缺失时按 `ref` 从工作区回读文件并回写。
2. **老数据标题是文件路径、`ref` 丢失**：`sanitizeArtifact` 把路径搬进 `ref` 再把人可读的文件名留给标题；历史 7 条用 `tools/repair-artifacts.mjs` 按文件名规范化匹配补回正文。
3. **`/repos/save` 只认 `{project}` 字段**：发 `{repo}` 时会静默存下一条空记录。修法：两种字段都认，且名字/项目路径都为空时直接 400。
4. **纯中文名字每次保存都新建一条**：`cleanId` 对非 ASCII 名字返回随机 id → 改成按名字哈希生成稳定 id（仓库、专家、机器人、项目都受益）。
5. **保存接口不回实体**：`/experts/save`、`/teams/save`、`/projects/save`、`/repos/save`、`/bots/save` 现在都返回保存后的集合；仓库与机器人返回脱敏视图（只有 `tokenSet` / `webhookHint`，不回传密钥）。
6. 清掉了体检产生的重复项目、重复缺陷卡与探测数据。

## 字段显示规范（2026-11-08 逐字段体检）

设计原则：**「没有」要说清楚是什么没有，不能只留一个 `—` 或一片空白。** 人看到空白会以为坏了。

| 位置 | 空值时的显示 |
| --- | --- |
| 卡片「需求/背景/验收标准」 | 输入框保留可编辑，但空时缩成 4 行并给出填写提示 + 一行红字「这张卡还没有需求描述：专家只能按标题猜」 |
| 抽屉「其它信息」 | `未挂需求（无编号）` / `未挂需求` / `未归属项目` / `未排期` / `父任务：无` / `来源用例：无（不是用例自动开的缺陷）` / `关联缺陷：无` / `飞书会话：未关联` |
| 状态历史 | 中文列名（待方案、开发中…）+ 备注，不再显示 `dev@11-08 17:34` 这种原始 id |
| 评论作者 | 一律显示专家本名（`架构师`、`开发工程师`、`支付架构师`）；历史里写成「架构」「🏛️ 支付架构师」的，加载时由 `canonicalAuthor()` 归一后落库 |
| 评论头像 | 人 = 姓名首字圆点，AI = 专家 emoji；只有专家才有角色/领域 chip |
| 评论正文 | 上限 20000 字（原 8000 会截断长报告）；渲染为空时显示「（这条评论没有正文）」 |
| 项目卡 | `N 个迭代`、`inProgress`、`checklistRate`、`cycleDays` 都是后端算好的数字，不再出现 `[object Object] 个迭代` 与 `undefined%` |
| 版本内卡片状态 | 显示中文列名（已完成、待开发），不显示 `done` / `dev_ready` |
| 市场页 | 显示真实 profile（`profile web`）；profile 由 `detectProfile()` 识别（扫描 `~/.dsh/profiles/*/package.json` 里装了 dsh-studio 的那个），因为宿主启动后 argv 里已经没有 `--profile` |

一键复验：`node /tmp/verify-fields.mjs`（在 .218 上跑）——11 项：profile、需求描述已补、产物无空正文、作者名归一、评论上限、状态中文名、项目指标三项、需求可读。

## 补完的一批（2026-11-09）

这几块是「文档九模块」里剩下、且不依赖真实 GitLab 环境的部分。

### 测试执行：多步接口 + 批量并发

- 用例的 `http` 现在支持 `steps[]`（多步串联：先登录取 token，再带 token 调业务接口）与 `vars`（变量表）；`{{name}}` 在 url / body / header 里替换，每步的 `extract` 用 `pickJsonPath` 取值（支持 `data.token`、`items.0.id`、`header:x-request-id`）。
- **任何一步失败就停**，后面步骤依赖前面的 token / id，硬跑下去只会得到一串假失败。
- `POST /studio-api/tests/run`（工具 `studio_test_suite`）批量跑：默认对象是「待测试」列，卡与卡之间并发（1-8，默认取 `testing.concurrency`），同一张卡内部串行。返回逐卡结果与本次开出的缺陷数。
- 每步的结果（方法 / url / 状态 / 耗时 / 错误 / 响应片段）都写进 `lastRun.steps`，抽屉里能看到是哪一步断的。

### 发布：审批留痕 + 灰度批次 + 部署记录

- `release.approvals[]`：点「审批通过」时记录谁、什么时候、什么结论（`{by, role, at, note}`）。
- `release.grayBatches[]`：`{name, percent, status: pending|running|passed|rolled_back}`，`POST /release/gray` 支持 `add / start / advance / rollback`；**灰度回滚会把整个版本置为已回滚**并写 `rollbackReason`。
- `release.deployLog[]`：审批、发布、灰度动作、回滚都记一条（保留最近 200 条），版本页显示最近 8 条时间线。
- 门禁新增提醒：没有审批记录、没有灰度批次（将全量发布）、还有灰度批次没走完。

### 成本：预算条

- `config.costs = { budgetRuns, budgetHours, warnAt }`（默认 500 次 / 80 小时 / 80%）。
- `GET /costs` 返回 `budget: { runs, hours, runRate, hourRate, level, hint }`，`level` 为 `ok|warn|over`；效能页「AI 执行成本」下方是一条预算进度条，超 `warnAt` 变黄、超 100% 变红。
- 口径分两层：**次数 + 机上时长**（派单日志）与 **token + 花费**（会话日志 + 价目表），两者口径不同，别混着看。

### 集成失败升级

- `config.feishu.escalateWebhook` + `escalateAfter`（默认 3）：某通道连续失败达到阈值时，**只在跨过阈值那一次**往升级群发一条，包含通道名、连续失败次数、最近错误与时间。
- 与日常通知分开配，坏消息不会淹在状态流里。

### 需求依赖与排序

- `requirement.dependsOn[]`：被依赖的需求没到 `delivered` / `closed` 时，**依赖方的门禁多一条 ⛔ 拦截**（`依赖的需求还没交付：REQ-…`），签字前必须等。
- `requirement.order`：`GET /requirements` 按 `order` 再按编号排序。

### 导出

- `GET /studio-api/export/tasks.csv`、`/studio-api/export/requirements.csv`：带 BOM 的 CSV（Excel 直接打开不乱码），页头「导出卡 / 导出需求」两个按钮就是下载链接。
- 卡表包含编号 / 标题 / 类型 / 状态 / 负责人 / 需求 / 项目 / 迭代 / 版本 / 阻塞原因 / 截止 / 用例通过数 / 交付物数；需求表包含功能点覆盖、卡完成数、用例通过率、交付物数、签字人。

### GitLab MR 回写（真机待 token）

- `POST /studio-api/gitlab/sync` 现在同时同步 **Issue** 与 **MR**：先按 `source_branch` 里的卡编号匹配，匹配不上再用 `related_merge_requests` 兜底。
- 每个 MR 会拉 `/pipelines` 与 `/changes`：流水线状态写进 `gitlabMR.pipeline`，改动文件写进 `coding.files`（研发没自报时自动补，提交按 MR 的 commits 计）。
- **`opened` 且卡在「开发中」→ 自动推进到「待评审」**；**`merged` 且在「开发中/待评审」→ 自动推进到「待测试」**，两次都带一条评论说明来源；流水线失败追加一条失败评论。
- 卡状态流转、阻塞、解除也会回写一条到 MR 的 notes（`broadcastChange`）。
- 用 `tools/mock-gitlab.mjs`（127.0.0.1:18098）验证过 7/7：匹配、流水线、改动文件、自动推进都通；**真实 GitLab 还需要令牌**（Role Developer+、scope `api`）。

### 工具数

插件现在提供 **39 个** `studio_*` 工具（新增 `studio_test_suite`、`studio_release_gray`、`studio_dashboard`、`studio_project_save`）。

## 面板上的编辑入口（2026-11-09 补齐）

前面几块能力原先只有接口与 agent 工具，面板上没有入口；这一轮补齐了：

- **多步接口用例**：卡片详情 → 测试 → 加用例时多一个「多步接口」输入框，一行一步
  `METHOD url | 期望状态码 | 提取变量`，例如
  ```
  POST /api/auth/login | 200 | data.token
  GET /api/points | 200 |
  ```
  提取变量默认按路径末段命名（`data.token` → `token`），想自己命名写 `token=data.token`；正文里用 `{{token}}` 引用。
  用例行会显示「多步 N」，执行后展开每一步的成功/失败与状态码。
- **需求依赖与排序**：需求详情 → 「依赖与排序」面板，填排序号、勾选依赖哪些需求，保存后：
  列表按排序号排，被依赖的需求没交付时准出多一条 `⛔ 依赖的需求还没交付：REQ-…`。
- **成本与预算**：设置 → 运行 → 成本与预算，改每月派单次数、机上时长、警告阈值。
- **通知升级**：设置 → 接入 → 飞书机器人，下方「通知升级」卡片配升级群 Webhook 与连续失败阈值。
- **专家提示词**：设置 → 团队 → 专家，每行直接显示提示词摘要（前 150 字，`title` 里有全文），点这行就打开编辑；没写提示词的会标「还没有写，会退回内置角色说明」。

### 专家的默认提示词

四个内置角色位（产品经理 / 架构师 / 开发工程师 / 测试工程师）出厂就带完整提示词，写的是各自该干什么、动手前读什么、产出必须包含什么、收口前怎么自检。早期版本这几个字段是空的（面板上看着像「没配」），`schema 4` 迁移会给空的补上、`schema 5` 会把「按业务领域批量生成」留下的 13 字一句话提示词换成带业务领域前缀的完整版（已经写过 20 字以上的保持不动）。

## 闭环补齐（2026-11-09）

「需求 → 研发 → 交付」与「Agent → 改动 → 证据」之间原先有两处断点：需求改完没人被通知要复核，Agent 报的提交/文件也没人跟代码对过。这一轮补上：

### 需求变更影响面

改需求不再只是覆盖字段，会留下一条「这次改了什么、影响谁」：

- 保存时对比 `title / description / points / links` 四项，记成 `change.parts`（标题、需求明细、功能点、文档链接）。
- 受影响卡 = 这条需求下**已经产出过东西**的卡：状态在 `test/accept/done`，或有验收签字，或有通过的用例，或有执行记录里的提交。
- 改了「实质内容」（标题/明细/功能点；只改文档链接不算）且受影响卡 > 0 时，把需求上的验收签字清空，`change.invalidated = true`。
- 需求准出多一条 `⛔ 需求改过（需求明细）：N 张已产出的卡要复核（卡号…），验收签字已作废`；只增不删时降级成提醒。
- 面板：需求详情 →「变更影响」面板，列出改了哪几块、几张卡要复核（点卡号直接打开）、签字是否作废。

### 执行记录 vs 代码事实

Agent 的「我改了 A、B、C」现在可以和 worktree 里的 git 对账：

- `POST /task/coding/verify`（body `{ id }`）：读 worktree 的真实分支（`rev-parse --abbrev-ref HEAD`）、最近 200 条提交、`<base>...HEAD` 的改动文件、`status --porcelain` 的未提交改动，和 `coding.branch/commits/files` 逐项比对。
- 提交只比前缀（完整 sha 或前 8 位都算）；文件容忍路径前缀差异；比对结果写回 `coding.verified`。
- 卡片准出：核对过且 `ok === false` → `⛔ 执行记录和代码不一致：分支对不上 / N 个记录的提交在分支上找不到 / N 个记录的文件没有实际改动`；有 worktree 有执行记录但**从没核对过** → 提醒。
- 面板：卡片详情 →「执行记录」右上角「核对代码事实」（有 worktree 才出现），结果显示「分支 X · 提交 N 个 · 改动 M 个文件」与缺失项，再次核对显示「再核对一次」。

### 版本 ↔ 需求

版本不用再手工挑需求：`/release/get` 与看板状态里，每个版本自动带出 `requirements`（由 `task.releaseId` 反查），版本详情顶部显示「这个版本涉及 N 条需求：REQ-…（状态）」，重新生成的发布说明里也多一节 `## 需求（N 条）`。

复验：`tools/verify-closed-loop.mjs`（29/29 PASS，覆盖假提交被揪出、真改动核对通过、需求改动清签字、只改链接不清签字、版本带出需求、收尾还原基线）。

## 评审与闭环补齐（2026-11-09）

这一节补的是「体检报告里 A 类：真没写的功能」，六项都是平台自己算的，不需要外部令牌。

### 需求评审
- 需求状态多了 `review`（待评审），状态流：`draft → review → active → delivered → closed`；打回会退回 `draft`。
- `review = { status: pending | approved | changes_requested, by, at, note }` 存在需求对象上。
- `POST /requirement/review`：`{ id, decision: submit | approve | reject, by, note }`。
  - `submit` → 状态 `review`、`review.status = pending`；
  - `approve` → 状态 `active`（已交付/已关闭保持）、`approved`；
  - `reject` → 状态 `draft`、`changes_requested`，**必须写 note**，否则接口报错。
- 门禁：没评审通过（或被打回）时，`requirementGate` 直接给阻塞项，拆卡和「准出」都过不去。
- 界面：需求详情顶部有「需求评审」面板——状态 chip、提交评审 / 评审通过 / 打回（打回弹窗填意见）、评审时间与人。

### 按功能点批量拆卡
- `POST /requirement/split`：`{ id, pointIds?, status? }`，只为**还没有卡**的功能点建卡（一条功能点一张卡，挂好 `requirementId` + `pointId`），标题是 `<pointId> <功能点标题>`，默认进「待澄清」列。
- 要求需求已评审通过（或早就开始了），否则报「需求还没评审通过，先过评审再拆卡」；全部覆盖时报「这些功能点都已经有卡了」。
- 界面：功能点面板底部「按未覆盖的功能点拆卡」，结果直接提示建了哪几张卡。

### 卡级 AI 失败重试 / 退避 / 升级
- 配置 `config.agents.retry = { max: 2, baseMs: 60000, factor: 2 }`：第 N 次失败后等 `min(base * factor^(N-1), 30min)` 再派；超过 `max` 次不再重试。
- 失败记录在卡上：`agentFailures`（次数）、`retryAt`（下次自动重试的时间戳，0 表示不排了）。
- 超过上限自动挂阻塞（`blocked.by = '系统'`）并飞书广播；派单器 `tick()` 会跳过 `retryAt > now` 的卡。
- 接口：`POST /task/agent/fail`（`{ id, error, by }`，一般由派单器或 agent 自己调）、`POST /task/agent/retry`（`{ id, by }`，人工清零失败计数并摘掉系统挂的阻塞）。
- 界面：卡详情右上角出现「AI 失败 N 次 · 重新派单」，鼠标悬停能看到下次重试时间。

### 同服务并行冲突预检
- `serviceConflicts(state, task)`：同项目、同服务、状态在 `dev / review / test` 的其他卡会算进来。
- 卡准出时给提醒：`同一个服务「X」还有 N 张卡在改（…），合并前先对齐，避免互相覆盖`（是提醒不是阻塞——并行本身合法，只是要人知道）。
- 派单提示词里也会写「只改本卡范围，动公共文件前先看别人的分支」。

### 用例字段与覆盖率
- 用例新增 `type`（functional / api / ui / performance / security / other）、`priority`（p0–p3）、`preconditions`（前置条件，≤800 字）、`steps`（手工步骤，一行一步，≤20 步）。
- 功能点矩阵新增 `pointsWithoutCases` 与 `coverageRate`（有用例的功能点占比）；需求准出在「有功能点但一条用例都没有」时给提醒。
- 界面：用例列表每条显示类型 / 优先级 / 前置条件 / 步骤条数；新增用例那一排多了类型、优先级、前置条件的选择与步骤多行输入。

### 发布准入（软校验 + 强制留痕）
- 配置 `config.releaseRules = { requireStaging: false, requireRequirementSignoff: false }`：
  - `requireStaging`：发布前必须在 `kind === 'staging'` 的环境上登记过一次 `action === 'deploy'` 的部署；
  - `requireRequirementSignoff`：这个版本关联的每条需求都要有验收签字。
- `/release/publish` 先过版本门禁，再过准入：准入不过且没带 `force: true` 直接拒绝；强制发布必须带 `forceNote`，原因会写进部署日志 `· 强制发布（违例）原因：…`，复盘时能查。
- 界面：设置 →「部署环境」面板底部两个开关；版本详情「发布」旁边多一个「强制发布」（弹窗填原因）。两个开关默认都不勾，不勾时行为与以前完全一致。

### 踩过的坑（同类问题已第二次出现）
- `publicConfig()` 与 `mergeConfig()` **都是白名单**：新加的配置段（`environments`、`releaseRules`）如果只在 `defaultConfig()` 里加，`/state` 拿不到、`applyConfig` 里 `config.releaseRules.xxx = ...` 会直接 `Cannot set properties of undefined`。加配置段要同时改这三处。

复验：`tools/verify-full-loop.mjs`（35/35 PASS：评审流转与门禁、拆卡与 pointId、矩阵覆盖率、用例四个新字段、同服务提醒、失败重试→耗尽阻塞→重新派单、准入拦截→必须写原因→强制发布留痕、收尾还原）。

## UI 收尾交接（2026-11-10 末尾）

线上产物 `dsh-studio/dist/client.js` 661.14 kB / gzip 198.65 kB，rev 3767，无 console error。

### 已完成（本轮）
- 卡片详情「推进到」：8 个状态按钮 → 「推进到「下一列」」主按钮 + 「其他状态（N）」下拉（退回项标「AI 会重跑」）。锚点 `dsh-studio/client.js` 的 `ds-listrow-actions` + `forward`/`later`/`earlier` 计算。
- 「AI 处理」：负责人下拉提成独立 `.ds-field`（标签「派给谁」），「马上处理 / 停止」单独一行。
- 「准出检查」：签字行与未签字输入行用虚线分隔（`.ds-gate-sign`、`.ds-gate .ds-row`）。
- 主题三档改为 Radix ToggleGroup（`SegGroup`，`uiKit` 已注入）；顶部 8 页签直用 `Tabs/TabsList/TabsTrigger`；两者选中态均为实心主色。
- `studio-ui.jsx` 补 `import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'`（此前缺失导致整页白屏，被 `Boundary` 接住）。

### 待做（新会话从这里接）
1. 看板拖拽换列 + 列悬停高亮（`client.js` 的 `function Card` / 列容器 `.ds-col`）。
2. 每列 WIP 上限：后端 `sanitizeColumns` 增 `wip`，`ColumnsPanel` 加输入，列头渲染 `done / wip`，超限列头变琥珀。
3. 需求文档「全部展开」：`readDoc(docId)` 已有，改成一次 `/requirement/get` 拉全部 docs 并批量展开。
4. 验证套路：`node tools/visual/probe-mount.mjs`（挂载 + 报错）、`probe-open-card.mjs`（抽屉段与动作行）、`probe-states.mjs`（页签/radiogroup）。

## 新建入口合并为「＋ 新建」（2026-11-12）

看板上的「＋ 新建任务」和需求页的「＋ 新建需求」原来各管一边，用户要记住「建卡去哪个页面」。现在头部只留一个入口：

- 右上角「＋ 新建」展开一个两项菜单（`role="menu"`、`aria-haspopup`、`aria-expanded`）：
  - **新建需求** → 切到需求页并**直接展开新建表单**（副标题「需求 → 功能点 → 拆成卡」）；
  - **新建任务** → 切到看板并打开新建卡弹窗（副标题「直接在看板上建一张卡」）。
- 点菜单外部、或选完任一项自动收起；菜单绝对定位（`zIndex 80`、`minWidth 232`），不撑开头部布局。
- 需求页原按钮位置改成一行提示「新建需求请用右上角「＋ 新建」」，避免两个入口并存。

实现要点（`client.js`）：

- `StudioPage` 增 `newMenu`（开合）与 `newReq`（信号计数），`useEffect` 监听 `document.click` 关闭菜单；主按钮与菜单本体都 `stopPropagation`，否则点一次会被自己的关闭逻辑吃掉。
- 菜单项「新建需求」执行 `setTab('requirements')` + `setNewReq(n => n + 1)`；「新建任务」执行 `setTab('board')` + `setCreating(true)`。
- `RequirementsPage({ …, createSignal })` 用 `useEffect(() => { if (Number(createSignal) > 0) openNew() }, [createSignal])` 响应信号。

### 顺带修掉的隐藏 bug

需求页原来的「＋ 新建需求」绑的是 `intakeOpen` 这个**只写不读**的 state（`setIntakeOpen('form')` 之后再没有任何地方读它），所以点了没有任何反应——真正的建单面板由 `form` 状态控制（`form === null` 不渲染）。

现在统一走 `openNew()`：

```js
const openNew = () => {
  setForm({ title: '', description: '', project: '', iteration: '', owner: '', priority: 'normal', status: 'draft', links: {} })
  setError(null)
}
```

### 验证

- 构建 `dist/client.js` 696.62 kB / gzip 207.21 kB，`deploy2.py` 部署后 `dsh-web.service` active。
- headless（1600×1000）实测：头部文案为「＋ 新建」；展开后菜单两项文案正确；点「新建需求」后活动页签为「需求」，面板头出现**新建需求**，字段齐全（标题 / 业务项目 / 状态 / 业务负责人 / 业务领域 / PRD·原型·验收链接 / 正文），`pageerror` 为 0。脚本 `tools/visual/newmenu-check.mjs`、`tools/visual/drawercheck.mjs`。
