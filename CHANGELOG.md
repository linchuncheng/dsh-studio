# 更新日志


## [0.9.43] — 2026-11-20

### 工具层补齐「会话里聊完需求 → 拆成卡」（issue #21）

这条链路平台早就设计好了门禁，但**工具层三步全缺**——agent 只能绕 HTTP、还得自己想办法知道端口。
现在三步都能用工具走完：

| 要做的事 | 之前 | 现在 |
| --- | --- | --- |
| 写澄清三问 `discovery` | 只有 HTTP 认 | `studio_requirement_save` 的 `discovery: {server, auth, boundary}` |
| 写功能点 `points`（带 acceptance） | 只有 HTTP 认 | `studio_requirement_save` 的 `points: [{id, title, acceptance}]` |
| 把功能点拆成卡 | **完全没有** | **新工具 `studio_requirement_split`**（46 个） |

- 拆卡逻辑抽成 `src/host/split.js`，**HTTP 路由与工具共用一份**，行为不会漂：
  一个功能点一张卡，卡的验收清单 = 该功能点的 `acceptance`；已建过卡的功能点跳过；
  门禁照旧（评审通过 + 澄清答完才让拆），错误文案直接给下一步该做什么。
- `warnings`（说了有后端却没覆盖 / 说了没后端却要动接口 / 功能点太空）一并回给工具层，
  以前只出现在 HTTP 响应的 `body.warnings` 里，agent 拿到就丢。
- `/requirement/split` 与 `/requirement/pool` 进 `route-contract.js` 的未知字段白名单。

### 测试
`tests/split.test.mjs` 4 条：验收条件进清单、已建卡跳过、两道门禁、工具层全链路（save 带
discovery/points → review → split 出卡）。`npm test` 300 条全绿（本地 + `TZ=UTC`）。


## [0.9.42] — 2026-11-20

### 文档：README 截图全部重拍（12 张）

原来的截图停在 **11-18**，之后界面变了：设置左栏换成 BoardUI 语言、设计/评审两道闸门上线、
用例能归功能点、shadcn 整体退场——README 上还是旧样子。

- **`npm run shots -- --base <端口>`** 现在能一条命令重拍：造一套演示数据（标题都带「演示·」）→
  用**真实 client.js** 渲染面板 → 逐页截图到 `docs/images/` → 断言没有「渲染失败」→ 跑完把数据
  连同云盘目录一起删掉。不需要 token（面板只依赖 `/studio-api`，脚本用最小假宿主挂起来再反代）。
- 新增两张图：**设置·列的负责人**（设计闸门 / 评审闸门开关）与**设置·技能库**（技能被用上几张卡、返工率）。
- 顺手修掉 README 截图区的一处重复行（cases/quality 出现了两次）。


## [0.9.41] — 2026-11-20

### 云盘目录改成「项目 → 需求 → 产物」三级

**问题**：所有需求文件夹平铺在云盘根下。实测根目录里有 **200 个文件夹、只有 10 个不同名字**——
「REQ-2026-001 管理后台」重复 54 份、「好链接」52 份…… 因为每次自检都会新建目录，而删需求时从不删目录。

**现在**：

```
云盘根文件夹
├─ ORD 订单中心/            ← 项目（按业务项目；KEY + 名称）
│   ├─ REQ-2026-001 积分抵扣/   ← 需求（编号在前，同项目内天然唯一）
│   │   ├─ 01 需求文档/
│   │   ├─ 02 设计文档/
│   │   ├─ 03 用例/
│   │   ├─ 04 测试报告/
│   │   ├─ 05 发布/
│   │   └─ 07 其它/
│   └─ REQ-2026-002 …
└─ 未归属项目/              ← 没挂项目的需求（缺陷、临时需求）落这里
```

- **建之前先列同层同名并复用**：重复建会让同一个东西出现两份目录（就是上面那 200 个的来源）。
- **删需求时可连带删目录**：`POST /requirement/delete { deleteFolder: true }`，默认不动（删台账和删文件是两件事）。
- 项目文件夹的 token 缓存在 `config.feishu.projectFolders`，需求子目录缓存在 `requirement.folder.kinds`，重启不丢。

### 修复
- **`drive files list` 不能用 `--page-all`**：它会把 `[page 1] fetching...` 打到 stdout，和 JSON 混在一起直接解析失败。
  改成 `--page-size 200`（一个父目录足够）。

### 测试
`tests/drive-tree.test.mjs` 9 条（命名/类型映射/复用/删除/未归属项目，全部用桩 larkJson）；
另用**真云盘**跑了一遍完整链路 8/8：建项目 → 建需求 → 建子目录 → 重复调用复用 → 删除清理干净。
面板渲染探针跑完也会连带删掉自己造的需求目录（不再污染云盘）。


## [0.9.40] — 2026-11-20

### 界面组件：shadcn 全部换成 BoardUI

面板里最后三处 shadcn/Radix 实现清理完毕：

| 原来 | 现在 |
| --- | --- |
| `components/ui.jsx`（shadcn：Button/Input/Textarea/Label/Card/Badge/Tabs/Dialog/Checkbox + 6 个 Radix 包） | **删除**；用到的地方改 BoardUI |
| `studio-ui.jsx` 里给 legacy 面板的 `Button/Input/Textarea/Label/Badge` 再导出 | 改从 `boardui/index`、`components/base/input/label`、`components/base/badges/badge` 取 |
| `studio-ui.jsx` 里遗留的 Radix Tooltip 包装 `Hint`（已无引用） | 删除 |
| `login-gate.jsx` 的 Card/Tabs/Label/Button（shadcn） | BoardUI：`PillTabList + PillTab` 切换登录方式、BoardUI Input/Button、卡片用 BoardUI token 拼 |

顺带把 `web/package.json` 里已无引用的 **10 个 `@radix-ui/*`** 删掉（锁文件同步）。

**体积与依赖**：产物 1,453 → **1,368 kB**（-85 kB），gzip 422 → 398 kB；
构建守卫报告的 Radix 门户 **2 → 0**（面板里不再有 Radix Portal）。

### 验证
- 面板渲染探针 `npm run probe:panel` **16/16**（看板/抽屉/需求/设置/技能库，全程无 pageerror）
- 登录门单独渲染验证：点开「登录」→ BoardUI pill 页签 + 账号框 + 密码框 + 蓝主按钮，无报错
- `npm test` 287 条全绿（本地 + `TZ=UTC`）；CI 绿


## [0.9.39] — 2026-11-20

### 界面
- **设置页左侧导航改成跟看板页签同一套语言**：以前选中的那一项是「实心强调色 + 白字 + 右侧竖线」，
  而看板顶部的页签是 shadcn 的「灰底轨道 + 选中浮起」，同一屏里像两个产品。
  现在左栏也是一个圆角灰底轨道，选中项是白卡 + 阴影 + 前景色文字，未选中是 muted 文字、hover 变浅。
- 样式放在 `web/src/index.css`（带 `!important`）：构建会把 legacy 里的 `[data-dsh-studio]` 前缀压平
  并合并同名规则，只写 legacy 会有一部分声明被吃掉；而 `client.src.js` 有「行数只许变小」的棘轮，
  不该往里加样式。所以单文件产物（无构建）沿用旧的左栏样子，构建产物是新的。

### 测试
面板渲染探针 `npm run probe:panel` 16/16；另外用 `getComputedStyle` 核对了三处取值：
轨道底色为前景 6% 混色、选中项为 `--card` + `--ds-shadow`、未选中为 `--muted-foreground`（#6b6b74）。


## [0.9.38] — 2026-11-20

### 行为变更：设计闸门默认开启

- `config.design.enabled` 默认值从 `false` 改成 `true`（与评审闸门一致）。
  卡进「开发中」之前要「设计评审通过**且**已定案」，否则被拦——要用 `override` 写原因才能强推。
- **已有实例里显式存过 `enabled: false` 的不会自动改**：那是人做过的选择，程序不去推翻它。
  想开就在设置 →「每一列由谁负责」点一次「设计闸门：已关闭」，或者
  `POST /studio-api/config {"design":{"enabled":true}}`。
- 关着时仍然**留痕**（0.9.36 起）：推进到闸门列会在卡的历史里写一行「设计闸门当时是关闭的」。

### 新增（开发体验）
- `npm run probe:panel -- --base http://127.0.0.1:<端口>`：**面板渲染探针**。假宿主挂真实 `client.js`，
  把 `/studio-api/*` 反代到正在跑的实例，puppeteer 逐页断言 + 截图到 `tmp/probe/`。
  0.9.36 那个「评审闸门插错面板」的 bug 接口测试和单测都抓不到——这条能。
  自己造「（探针）」数据、跑完自删；没装 `puppeteer-core` 或没 Chrome 时跳过不判红。

### 测试
`npm test` 287 条全绿（本地 + `TZ=UTC`）；探针对着真实例 16/16（看板闸门提示、抽屉功能点默认继承、
需求页覆盖率口径、设置页两道闸门开关、技能使用读数、全程无 pageerror）。


## [0.9.37] — 2026-11-20

### 修复（自测渲染时抓到的，0.9.36 里带着这个 bug）
- **「评审闸门」开关被渲染到了「数据与备份」面板里**：0.9.36 加这段 JSX 时锚点匹配错了，插进了
  `StoragePanel`，而 `reviewEnabled` / `saveReview` / `statuses` 在那里并不存在——设置页
  「列的负责人」里根本看不到它（点进「数据与备份」才会报错）。
  已移到 `ColumnsPanel` 的设计闸门下方，并加回归锁：断言 `data-review-gate` 落在
  `ColumnsPanel` 与 `StoragePanel` 之间。
- 为什么测试没拦住：接口测试与单元测试都看不到「渲染在哪个面板里」。这轮补了**真实渲染探针**
  （假宿主 + 真 `client.js` + 真 `/studio-api` 数据 + puppeteer），逐页验证并截图，16/16 通过。


## [0.9.36] — 2026-11-20

### 新增（issue #11 剩下的「路由层严格化」）
- **写路由也吃白名单了**：`src/host/route-contract.js` 提供 `declareRoute(route, fields)` 与
  `rejectUnknownFields(route, body)`。已启用的路由：

  ```
  /task/comment        id body author kind action commentId by
  /task/checklist      id action text itemId done note by
  /requirement/review  id decision note by operator
  /requirement/signoff id action note by override operator
  /task/merge-gate     id by publish action
  /task/merge          id by
  ```

  多传未知字段直接 400 并列出可接受字段。选这几条的判断标准是**字段少、形状明确**，
  且面板的 payload 已逐条 grep 对齐（`tests/route-contract.test.mjs` 里把这些 payload 原样跑一遍，
  保证不误伤自家调用方）。
- **边界如实写在这里**：`/task/update` 这类**收整张卡**做部分更新的路由仍是宽松的。
  收紧它需要先把面板与脚本的调用全部改成显式字段，是另一件事——不做「看起来严了」的半成品。

### 闸门关闭也要留痕（issue #11 第 3 条的收尾）
- **设计闸门关着时，卡推进到闸门列会在历史里留一行**：「设计闸门当时是关闭的：这一步没有经过设计评审」。
  默认值改不改是产品取舍（改了会卡住存量需求），但关着且没人知道不该发生——留在卡上是可查的。

### 测试
`tests/repo.test.mjs` 加 1 条「评审闸门必须渲染在 ColumnsPanel 里」；`tests/route-contract.test.mjs` 4 条：未知字段拒绝并点名、面板真实 payload 全通过、
未登记路由与非法 body 放过、登记表本身自洽（路由唯一、字段非空）。
`npm test` 287 条全绿（本地 + `TZ=UTC`），产物 `cmp` 一致，`release:check` 7 项通过。


## [0.9.35] — 2026-11-20

### 新增（issue #11 的可发现性部分）
- **用例能归到功能点了，而且默认继承卡上的**：`studio_task_add_cases` / `studio_task_case` 的每条用例
  可以带 `pointId`（算在哪个需求功能点）与 `acceptanceId`（验哪条验收条件）。
  **不填 `pointId` 就继承卡的 `pointId`** —— 一个功能点通常多条用例，不让调用方每条重复写。
  抽屉里加用例时也给了选择器（默认跟卡走，可改），连加几条不用重复选。shell 用例以前硬编码 `pointId: ''`，现在也认。
- **约束写进工具描述，不再只藏在源码里**：
  - `studio_task_add_cases` 写明 `pointId` / `acceptanceId` 的语义与默认值、相对地址用测试环境 `baseUrl` 解析、
    完整地址只认 `http(s)`；一条不合法就整体拒绝并点名第几条为什么。
  - `studio_requirement_save` 写明：id 可传编号（`REQ-2026-001`）、链接只认 `http(s)://` / `mailto:` / `#` / `/` 开头、
    RICE 的 `pool` 可以直接带也可以走 `/requirement/pool`。
  - `studio_task_case` 说明「要可执行的用例请用 `studio_task_add_cases`，它会当场试跑」。
- **需求页把覆盖率口径写出来了**：「覆盖率按功能点算：一个功能点可以对应多张卡、多条用例；
  用例自带的 `pointId` 优先，没填就沿用卡上的」——避免读者推成「一卡一点，覆盖率有天花板」
  （这正是 issue #9 里那位 agent 当时的误判）。

### 闸门可见性收尾（issue #11 第二块）
- **评审闸门进了配置白名单**：`config.reviewGate = { enabled, columns }`（默认 `{ enabled: true, columns: ['test'] }`），
  和 `design` 一样四处齐活（默认值 / mergeConfig 归一 / publicConfig 下发 / 运行时判据），
  重启不会被 mergeConfig 抹掉。
- **设置页能开关了**：「每一列由谁负责」面板里，设计闸门下面新增评审闸门开关 + 可勾选哪几列要拦，
  关闭时按钮显示「评审闸门：已关闭」并附一句「关掉意味着卡可以跳过评审直接进测试」。
- **看板顶部会挂提示**：`/state.gates` 里任一闸门关闭时，看板顶部出现
  「⚠ 设计闸门 / 评审闸门 已关闭：卡可以跳过对应的评审直接推进」——不再出现「看起来有保护、其实裸奔」。

### 写操作契约（issue #11 第三块）
- **未知字段直接拒绝**（45 个工具全部受管，一处实现）：白名单就是工具自己声明的 `parameters`
  （扁平写法与 JSON Schema 写法都认）。报错写明这个工具接受哪些字段，以及「以前多传的字段会被静默忽略，所以这里直接拒绝」。
  契约测试：把每个已注册工具都用 `{__bogus_field:1}` 调一遍，全部必须拒绝。
- **写工具回读库里那份**：`studio_task_create` / `studio_task_update` / `studio_requirement_save` /
  `studio_task_artifact` 的返回值末尾带 `库里的记录：{...}`，内容来自 store 快照（不是回显入参）——
  `pool` 有没有生效、`content` 有没有落库、需求的 `code/status` 是什么，一眼可对账。
- **边界说明**：HTTP 路由未做严格白名单（面板与老脚本会带整对象做部分更新，一刀切会打断它们）。
  「路由层严格化」留在 #11 里继续跟踪，等面板侧的调用全部改成显式字段后再收。

### 一致性一批（issue #12–#19）
- **#16 删除不再静默成功**：`/projects|experts|teams|suite|release/delete` 与 `task/artifact action=remove`
  在目标不存在时直接报错。以前一律 `200 {"ok":true}`，调用方以为删干净了，实际库里还在。
- **#13 代码评审入参统一**：工具与 HTTP 都认 `reviewStatus`（工具老写法）与 `status`（HTTP 老写法）；
  两个都不给、或给了不认识的值 → 直接报错。根因是 `reviewDecision` 会把不认识的值回落成 `pending`，
  于是「传错字段」变成「评审白写一次」，一直潜伏到准出闸才炸。
- **#17 只读 POST 补齐**：`/task/gate`、`/requirement/matrix`、`/requirement/impact`、
  `/task/worktree action=list` 打上只读标记，不再推 revision。`/task/coding/verify` **保留写入**：
  它会把核对结果存进 `coding.verified`（准出要读），不是纯读。
- **#15 签字口径收成一个函数**：新增 `signoffActorKind(name, config)`，写入口（需求签字、卡签字）与判据
  （`isAiSignoff`）共用。以前写入口只认 `studio-*` 这类名字，闸门还额外认专家名册 ——
  于是「产品经理」签的字记成 `human`、闸门判成 AI，记录与结论互相矛盾。
- **#14 structuredClone 不再作废整次流转**：换成 `safeClone`（structuredClone 失败再 JSON 兜底），
  展示用的快照克隆失败不该让换列整体失败。
- **#18 幂等并发闸**：新增 `createIdempotencyGate()`，执行前先占住 key，同一 key 的并发请求直接
  `409 {code:"idempotent_inflight"}`。以前两个并发请求都查空 → 都执行 → 写两条。
- **#19 评论可改可删**：`POST /task/comment action=update|remove` 与 `studio_task_comment` 的
  `action`/`commentId`；改删都写历史（谁、什么时候、原来是什么）。评论是 agent 读卡的主要输入，
  以前只能增，写错/重复/过时的只能留着误导下一个人。

### 测试
本版新增的断言：
- `tests/case-point.test.mjs`：不填 `pointId` 继承卡的功能点、填了不被覆盖、`acceptanceId` 一起存下来；
- `tests/consistency.test.mjs`（6 条）：改删评论留痕、签字口径统一、评审两种入参 + 写错要报错、
  删除存在性校验与只读标记、幂等并发闸；
- `tests/tools-audit.test.mjs`（+3 条）：每个工具都用 `{__bogus_field:1}` 调一遍必须拒绝、
  写工具回读可解析、描述里说能传的 `pool` 真能传且分数 > 0；
- `tests/gates.test.mjs`（+2 条）：`sanitizeReviewGate` 归一化（默认开、显式 false 才关）、评审闸门拦/放；
- `tests/repo.test.mjs`（+2 条）：`reviewGate` 四处齐活（默认值 / mergeConfig / publicConfig / patch）、
  计数回归锁（计数用原对象算）。

`npm test` 280 条全绿（本地 + `TZ=UTC`），产物 `cmp` 一致，`release:check` 7 项通过。


## [0.9.34] — 2026-11-20

### 修复（GitHub issue #10：计数恒为 0 的回归）
- **所有卡片的「评论数」「清单进度」角标恒为 0**：`publicState` 先把三个数组解构剥掉，再把
  **剥掉数组的对象**传给统计函数；`Array.isArray(undefined)` 兜成空数组 → 计数静默归零。
  数据一直在库里（`/task/comments` 能取到 38 条），只是轮询那一份算错了。
  现在计数在解构**之前**用原对象算，并加了一条回归锁（静态断言 + 真机核对）。

### 修复（GitHub issue #9：agent 走完整条需求后的 7 条体验问题）
- **标识符归一化（第 2 条）**：`resolveRequirement` 同时认内部 id（`req-078f16`）与编号（`REQ-2026-001`，大小写不敏感）。
  `studio_requirement_get/save/signoff/folder`、`studio_task_create/update`、`POST /task/create` 都走它；
  找不到时直接给「可用的有：REQ-2026-001（req-078f16）…」——不再是 `no requirement REQ-2026-001`。
  以前写路径不归一化，`requirementId:"REQ-2026-002"` 会被原样存成外键，卡变成脏引用、需求汇总显示「卡 0/0」。
- **补齐两个评审工具（第 4 条）**：`studio_requirement_review`（submit / approve / reject）、
  `studio_task_design`（多稿 + 定案 + 评审状态）。逻辑抽到 `src/host/reviews.js`，**HTTP 路由与工具共用一份**，
  不再出现「面板能做、agent 只能绕 HTTP」。工具数 43 → 45。
- **评审闸门默认生效（第 3 条）**：进「待测试」之前 `coding.review.status` 必须是 `approved`，
  与设计闸门同构；要关得显式 `config.reviewGate.enabled = false`。
  `/state` 新增 `gates`，把两道闸门当前是否生效直接下发——关掉时不再"看起来有保护"。
- **路由层同样归一（真机验证时抓到的）**：`/requirement/get|matrix|save|signoff|split|doc|sync` 只用内部 id，
  传编号直接 400。现在全部走 `reqRef()`；同时补上路由里缺的「顶层 `prd/proto/acceptance` → `links`」映射
  —— 以前这两个字段在路由上被静默忽略，只有工具才认。
- **静默失真收口（第 1 条）**：
  - 需求链接写坏（相对路径 / ftp 等）现在直接报错并说明合法格式，不再存成空串；
  - `POST /task/artifact action=update` 认顶层 `content` 等字段，找不到目标交付物直接报错，
    不再「200 但什么都没变」。
- **第 6 条（读操作写审计）与第 7 条（`markDuplicate is not defined`）已在 0.9.17 / 0.9.20 修复**，
  本次复核后一并回复在 issue 里。

### 测试
新增 `tests/reviews.test.mjs` 5 条、`tests/requirement-routes.test.mjs` 2 条（引用归一化 / 找不到时的提示 / 三段评审 / 设计部分更新不抹多稿 / 链接校验）、
`tests/gates.test.mjs` 加 1 条评审闸门、`tests/repo.test.mjs` 加 1 条计数回归锁。
`npm test` 268 条全绿（本地 + `TZ=UTC`），产物 `cmp` 一致，`release:check` 7 项通过。


## [0.9.33] — 2026-11-20

### 新增
- **技能库多了「有没有被用上」这一列**：每条技能显示「用上 N 张卡（完成 M），其中 K 张被打回（x%）」。
  - 数据全部来自台账，**不加埋点**：卡上记着谁在负责（`task.expert` / `task.dispatch.expert`）、
    专家名册记着谁挂了哪些技能、历史里记着列有没有往回退（复用 `quality.js` 的 `taskRework`，
    和效能页的返工率同一条口径）。
  - 没被用上的技能显示「还没被用上（挂它的专家还没接过卡）」，而不是 0%（「没数据」≠「0%」）。
  - `studio_skill_list` 每行也带读数；`/skills` 返回里每条技能带 `usage`。
  - 只报数、不判定「有用/没用」：技能挂上去之后卡变好也可能是需求本身更清楚了，
    要下因果结论得有对照组，现在没有。

### 测试
新增 `tests/skill-usage.test.mjs` 4 条（用上几卡/几张返工、没用上不造 0 行、停用专家与未派单卡不计、排序）。
`npm test` 259 条全绿（本地 + `TZ=UTC`），产物 `cmp` 一致，`release:check` 7 项通过。


## [0.9.32] — 2026-11-20

> 0.9.31 没有单独发布，那一批改动并入本版（下面的「同批改动」）。



### 新增
- **GitLab 合并由平台执行**：`POST /task/merge` 与 `studio_merge_gate action=merge`。
  门禁通过才调 `PUT /merge_requests/:iid/merge`，没过直接拒绝、一个请求都不发；
  合并成功后把 `mergedBy / mergedAt / gitlabMR.state=merged / merge commit` 一起记进卡片，历史留一行。
  抽屉「合并门禁」块多了「合并 MR」按钮（只有门禁状态为 success 时可点，点了还要二次确认）。
  - 为什么这么做：**GitLab CE 拦不住人工点合并**。极狐 15.3 实测没有 approvals 接口（404）、
    也没有外部状态检查，提交状态只是可见记录。要让门禁真的生效，合并就必须由平台执行。

### 修复（真机才暴露的版本差异）
- **GitLab 15.3 的 `/changes` 不再返回 `commits_count`**：自报「1 个提交」、MR 里也是 1 个，
  却被判成「MR 里是 0 个」。现在用 `/commits` 端点的条数兜底。
- 顺带在真机上把 GitLab 链路跑通并留档：issue 同步建卡（`Closes #1` 后自动挂上 MR）、
  执行记录 vs MR 事实对账（文件数不一致会点名）、提交状态发布。

### 同批改动（原 0.9.31）
#### 新增
- **两把早就写好、却没人用的尺子接上了**：
  - **停摆**（`dispatch-state.js` 的 `isStalled`）以前只有卡片上有提示，工作台从不数、`/state` 也不下发。
    现在工作台风险里多一格「停摆」，列表可点开；`/state` 每张卡带 `stalled`，外部脚本也能识别。
    这类卡**不会自己恢复、也不会再被自动派单**（2026-11-18 线上一次发现 5 张，最早卡了 8 天）。
  - **可执行用例占比**（`case-strength.js` 的 `meetsCoverageTarget`，目标 60%）以前只有单测在用。
    现在需求准出会给出读数：「可执行用例只有 1/4（25%），低于 60% 的目标」。
    只提示不拦：存量需求里草稿居多，一刀切会把正在交付的需求全卡住。

#### 修正
- **`docs/product.md` 的「今天」列停在 0.8.0 之前**：崩溃自愈（0.9.10 修好）、停摆可测、写不丢（单写者）
  三条早就做了，却一直标着 ❌。已按代码与测试的实际状态改正。

## [0.9.30] — 2026-11-20

### 修复
- **0.9.29 的 Release 正文检查把自己误伤了**：判据用的是 `body.includes('没写更新日志')`，
  而 0.9.29 的 CHANGELOG 正文里正好**引用**了这句话（"CHANGELOG 少了这一版时只剩一句「没写更新日志」"），
  于是真发版时 `verify:release` 判红，实际 Release 正文是完整的。
- 判据收紧到生成器真正打出来的整句：`这一版没有写更新日志`（见 `tools/changelog-section.mjs` 的 else 分支），
  并补一条断言：正文里正常引用这四个字不算占位。已用 v0.9.29 的真实正文验证通过。
- **发版后补的（npm 上的 0.9.30 内容不变，只影响仓库脚本）**：上面那条"收紧到整句"仍然会误伤——
  0.9.30 自己的说明里就原样引用了那句话。现在判据改成**按结构**：CHANGELOG 抽出来的段落一定以
  `## [<version>]` 开头，回退生成的一定是 `## v<version>`，不再做任何措辞匹配。
  两条真实 Release（v0.9.29 / v0.9.30）的正文都验证通过。
- **发版后补的（同样只影响仓库脚本）**：`release.yml` 的「发布后核对」原来用 `npm view` 查 latest，
  它要启一次 npm、拉完整 packument（0.9.30 时已 400 KB），冷机器上十几秒。现在改问 dist-tags 端点（**20 字节**）：
  `tools/registry-latest.mjs`（带 `--expect` 断言与 `REGISTRY_WAIT_SECONDS` 重试窗口）、
  `tools/registry-has.mjs` 改成单版本端点（只回 200/404），共同的取数在 `tools/lib/registry.mjs`。
  `verify:release` 也换成这套：npm 段从 ~2s / 400 KB 降到 ~1s / 几十字节。

## [0.9.29] — 2026-11-20

### 开发体验
- **发版一致性多了「Release 正文」这一条**：以前 `verify:release` 只比 Latest 的 tag 名，
  `release.yml` 的正文是从 CHANGELOG 摘的，**CHANGELOG 少了这一版时 Release 里只剩一句「没写更新日志」，
  而检查是绿的**。现在用 `gh release view` 读正文（已登录 → 不受匿名 API 限流），
  空正文 / 占位句 / 少于 20 字都判红；本机没 gh 或这个版本还没打 tag 时只跳过、不判红。
- 判据抽成 `tools/lib/release-notes.mjs`（纯函数），配 `tests/repo.test.mjs` 里的 1 条断言。

## [0.9.28] — 2026-11-20

### 开发体验
- **推完等 CI 不再靠 sleep 轮询**：新增 `npm run ci:watch`（`tools/ci-watch.mjs`）。
  它盯 HEAD 这一提交的 workflow run（用 `gh run watch --exit-status` 阻塞到结束），
  绿了返回 0；红了自动打 `gh run view --log-failed` 的尾巴。
  - 之前：`sleep 75` + 2~3 次匿名 API 轮询，**每次多等 1~2 分钟**，而且失败时拿不到日志
    （未认证的日志接口 403）——0.9.23~0.9.27 连推 5 个提交全红，就是这么漏掉的。
  - 现在：一条命令阻塞到出结果；失败时日志直接打到终端（实测 8 秒就能确认一个已结束的 run）。
- 本机已装并登录 `gh`（marsken88，repo scope），所以 GitHub 侧的查询/日志都走 CLI，不再用匿名 curl。


## [0.9.27] — 2026-11-20

### 修复
- **CI 从 0.9.23 起一直是红的**：`ci.yml` 在跑 `npm test` 之前**不装依赖**（契约测试本来就不该依赖
  node_modules），而浏览器用例那条「真跑」测试只判了「有没有 Chrome/Edge」，没判「装没装 puppeteer-core」。
  于是 GitHub 上每次都红在 `Repository contract`，构建步骤被跳过。
- 真跑那条测试的跳过条件补上依赖检查：没有 `puppeteer-core` 就 skip，并打印原因。
  按 CI 条件本地复现：**245 passed / 1 skipped / 0 failed**（修之前是 1 failed）。


## [0.9.26] — 2026-11-20

### 修复
- **浏览器用例的步骤在真机上会被静默丢光**：`sanitizeCaseBrowser` 只认手写形状
  （`{click: '#b'}`），不认存库后的形状（`{kind: 'click', selector: '#b'}`）。
  而真实路径是「写库时清洗一次 → 跑的时候再清洗一次」，于是第二次把步骤全丢了：
  页面能打开、断言却报「页面上没有…」，看起来像产品缺陷。真机跑出来才发现（单测里
  喂的是手写形状，正好绕过这个坑）。
- 清洗函数改成同时认两种形状，并加一条**幂等**断言：`sanitizeCaseBrowser(x)` 的结果
  再清洗一遍必须完全一致、步骤一条不少。顺带把四种用例（http / shell / db / browser）
  都过了一遍幂等检查，都对得上。
- 真跑那条测试改成先用存库形状再跑（之前测的是手写形状，测不到这个 bug）。

### 部署提示
- 浏览器用例需要在**插件目录**里能解析到 `puppeteer-core`：profile 是拷贝时它没有 node_modules，
  运行时会明确提示「这台机器没装 puppeteer-core」。本机已装（`npm i --no-save puppeteer-core@25`）。


## [0.9.25] — 2026-11-20

### 修复
- **「改了代码、也重启了，却没生效」的根因**：desktop profile 里的 `@marsken/dsh-studio` 是一份**拷贝**
  （版本停在 0.9.14），而 profile 的 `package.json` 里写的是 `link:` —— Windows 上那个 link 没真正建成。
  于是宿主半边（`index.js` / `src/host`）一直加载旧代码，重启多少次都没用；面板也是旧 bundle。
- 新增 `npm run sync:profile`（`tools/sync-profile.mjs`）：先把「仓库版本 → profile 版本」打出来，
  备份到 `~/.dsh/backups/dsh-studio-<时间>` 后整体替换运行时文件，再校验版本与 `client.js` 一致，
  最后提醒重启。目录整体替换（不是逐文件覆盖），避免删掉的模块以旧文件的形式留在 profile 里。

### 说明
- 远程部署有 `tools/deploy.mjs`，本地 profile 之前只有文档里的手工 `cp` —— 两边现在都有脚本，且都会先打印版本。
- `AGENTS.md` 的排障表把「改了没生效」的第一条改成「先跑 `npm run sync:profile` 看版本」。


## [0.9.24] — 2026-11-20

### 新增
- **设计多稿与定案**：一张卡可以放多稿（每稿 = 名称 + 链接 + 一句思路，最多 8 稿），
  抽屉多了「设计」页签：加稿、删除、**选为定案**、评审通过 / 要求修改。
  - **「评审通过」不再等于放行**：被配置成设计闸门的列，要求「评审通过 **且** 已定案」才进得去。
    多稿项目里最常见的翻车是评审说"这几稿都行"，研发照错的那稿做——`approved` + 没指认 `chosenId`
    现在会被明确拦住（`override` 仍可强推）。
  - **定案的那一稿进派单提示词**：研发拿到的是「按这一稿实现：方案 B + 链接（另有 1 稿未采用）」，
    没定案时提醒「先确认用哪一稿，再动手」——图里「选中交互稿与 PRD 交给研发」那根箭头这才接上。
  - 定案是一次决定：`/task/design` 会往卡片历史里写一行「设计定案：<稿名>」。

### 兼容
- 老数据只有 `design.link`（没有多稿）：**加载时归一成唯一一稿并自动定案**，升级后已通过评审的卡
  不会被设计闸门挡在开发之外。人手动把稿清空成 `[]` 就是清空，不会被老 link 复活。

### 顺带
- 体积观察线 1460 → 1470 kB：项目检查 / 合并门禁 / 技能沉淀 / 浏览器用例 / 设计多稿五块 UI 合计 +9 kB
  （1451 → 1461.7）。涨的是能力不是组件库；**这是最后一档**，再涨就要拆包（记在 `web/scripts/guard.mjs` 与 `docs/ui.md`）。

### 测试
新增 `tests/design-drafts.test.mjs` 8 条（老数据兼容 / 多稿未定案 / chosenId 失效 / 8 稿上限 /
清空不复活 / 闸门 / 路由字段识别 / 派单提示词 / 重开一次 store 的迁移）。
`npm test` 共 245 条全绿（本地 + `TZ=UTC`），产物 `cmp` 一致，`release:check` 7 项通过。


## [0.9.23] — 2026-11-20

### 新增
- **浏览器用例：第四种执行器**。用例可以真的打开一个页面、点按钮、填输入框，然后断言
  「页面上有没有这段文字 / 有没有这个元素 / 地址对不对 / 首屏状态码」——接口用例证明不了按钮点得动。
  - 形状：`{ browser: { url | path, expectText?, expectSelector?, expectUrl?, expectStatus?, steps?: [{click}|{fill,text}|{wait}|{waitFor}] } }`。
  - 默认关闭（`config.testing.allowBrowser`），和 shell 同一档：打开等于允许看板在这台机器上开浏览器、访问内网地址。
  - 浏览器自动找 Chrome / Edge / Chromium（也可以配 `testing.browserPath` 或环境变量 `CHROME_PATH`）；
    没装 `puppeteer-core` 时给出可照做的提示，不会崩堆栈。
  - 地址守卫和接口用例共用一套（`url-guard.js`）：相对地址拼测试环境 baseUrl，host 必须在允许列表里。
  - 抽屉里多了「＋ 浏览器」按钮；设置 → 测试执行 里多了开关与浏览器路径。
- **顺手修掉三个老问题**（都是 AGENTS.md 记过的那类）：
  - 用例行上的「▶ 跑」以前只给**接口**用例显示，shell / 数据库用例建得出来却永远点不了跑。
  - 用例定义那一行是个三元链，**数据库用例的来源永远显示不出来**（走不到 db 分支）。
  - 更根本的一处：`runTaskCases` 判「哪些用例能跑」时手写了 `http || shell` 两个条件，
    **数据库与浏览器用例永远进不了执行清单**（报「没有可执行的用例」）。现在统一走 `isExecutable`。

### 顺带
- `hostAllowed` / 相对地址解析抽到 `src/host/url-guard.js`，接口用例与浏览器用例共用。
- 公开提单/查询页的三张静态 HTML 从 `domain.js` 搬到 `src/host/intake-pages.js`（domain 又贴到 2000 行上限了）。

### 测试
新增 `tests/browser-case.test.mjs` 5 条，其中一条**真开浏览器**（本机用 Edge）跑完整链路：
打开页面 → 点按钮 → 填输入框 → 断言文字/元素/状态码 → 相对地址与白名单拒绝。
`npm test` 共 236 条全绿（本地 + `TZ=UTC`），产物 `cmp` 一致，`release:check` 7 项通过。
CI 机器上没有 Chrome/Edge 时这条会自动跳过（其余 4 条照跑）。


## [0.9.22] — 2026-11-20

### 新增
- **合并门禁：这一关拦在 GitLab 上**。卡片「执行记录」页多了「合并门禁」，
  点一次就把「这段代码能不能合」算出来并发成 GitLab 的提交状态 `studio/merge-gate`：
  - 判据只有证据：代码评审通过、可执行用例没有失败且至少跑过一次、项目检查跑过并通过、
    执行记录与分支上的提交/文件对得上、GitLab 流水线没失败。**不看验收签字**——
    合并看证据，验收看人，两件事不该用同一套标准（先合后验收是常态）。
  - 仓库开了「状态检查必须通过（Status checks must succeed）」时，这条状态就是合并按钮上的灯：
    failed 就合不了。没开那个设置时它至少是一条可核对的记录，比写在评论里强。
  - 状态挂在 **MR 的头提交 sha** 上（不是卡上自报的最后一个提交）：挂在旧提交上，合并按钮显示的是上一次的结论。
  - 卡上记「已合并」（`studio_task_coding action=merge`）也要先过这一关——以前这一步只写 `mergedBy/mergedAt`，
    等于让 agent 自己宣布合并成功。
  - 新工具 `studio_merge_gate`（第 43 个，`publish=false` 可只出结论）、路由 `POST /studio-api/task/merge-gate`。

### 顺带
- `tools/mock-gitlab.mjs` 现在会接住 `POST /statuses/:sha`，`GET /__statuses` 能把发过来的状态取回来看。
- 全闭环自检补了「评审通过」和「合并门禁（只算不发）」两步——以前这条链从「待评审」直接跳到「待测试」，没人写评审结论。

### 测试
新增 `tests/merge-gate.test.mjs` 6 条（门禁判据 / 与准出分离 / 路由 dry-run / 真起本地桩发布提交状态）。
`npm test` 共 231 条全绿（本地 + `TZ=UTC`），产物 `cmp` 一致，`release:check` 7 项通过。
**没验的**：真 GitLab 上的拦截效果（需要仓库打开状态检查），本机只对桩验过。


## [0.9.21] — 2026-11-20

### 新增
- **技能沉淀：做完的卡可以一键变成技能草稿**。卡片「执行记录」页多了「把这张卡沉淀成技能」，
  平台把这张卡上**真实发生过**的东西汇总成一条 SKILL.md：需求的验收锚点、真跑过的请求/命令、
  踩过的坑（阻塞原因、失败用例、评审要求修改、项目检查没通过）、改动面与出处。
  - **不做推断**：没有证据的段落直接不写，不许补 TODO；什么证据都没有的卡拒绝沉淀，不是给一段空话。
  - **草稿默认停用**：存进技能库但不写盘、也不注入派单，人看过再启用——沉淀不等于启用。
  - 新工具 `studio_skill_mine`（第 42 个）、路由 `POST /studio-api/skill/mine`；纯函数在 `src/host/skill-mine.js`。
- **技能可以限定项目范围**：技能多了以后，「支付对账」这类做法不该出现在无关项目的派单里。
  SKILL.md 的 frontmatter 新增 `projects:`，派单时按卡的项目过滤；没声明的仍是全局技能。
  被过滤掉的技能会在提示词里说明原因（「只用于 proj-9」「已停用」），不会静默消失。

### 顺带
- 技能的数据形状从 `index.js` 抽到 `src/host/skill-shape.js`：`projects` 要能单测「存进去 → 写成 SKILL.md → 读回来」不丢字段。
- 技能库面板显示草稿/项目范围，编辑时可改范围。

### 测试
新增 `tests/skill-mine.test.mjs` 5 条（证据齐全的卡 / 空卡拒绝 / 技能名兜底 / frontmatter 往返 / 派单按项目过滤）。
`npm test` 225 条全绿（本地 + `TZ=UTC`），产物 `cmp` 一致，`release:check` 7 项通过。


## [0.9.20] — 2026-11-20

### 新增
- **项目检查（本地质量命令）进准出**：项目或服务上配一条 `qualityCmd`（如 `npm run check`），
  卡片抽屉的「执行记录 → 项目检查」点「跑一次」，平台就在这个服务的代码目录（**有 worktree 就用 worktree**）
  真跑这条命令，退出码、耗时、输出尾部写回卡片。配了命令的项目里，**改过代码的卡没跑过或跑挂了不许收口**。
  这是准出里第一条「机器跑出来的证据」——在此之前，单测通过数只能靠专家自报。
  新工具 `studio_task_quality`（第 41 个），路由 `POST /studio-api/task/quality`；
  默认超时 120 秒，可配（夹在 10 秒 ~ 10 分钟），输出只留尾部 4000 字，不撑大轮询与快照。

### 修复
- **`studio_config_get` / `studio_config_set` 一调就崩**：`ReferenceError: publicConfig is not defined`。
  `publicConfig` 定义在 `index.js`，`tools.js` 却裸调用且没登记进 `INJECTED` —— 专家连读一眼配置都做不到。
- **`studio_bug_duplicate` 一调就崩**：同一类问题（`markDuplicate` 裸调用）。两个都是「把代码搬出去忘了接线」。
- **契约测试只执行了一个写工具**，所以上面两个 bug 一直没被拦住。现在会把**每一个**已注册工具都用空参数跑一遍：
  只放过「任务不存在」这类业务错误，`is not defined` / `Cannot access ... before initialization` 一律红。


## [0.9.19-next.0] — 2026-11-20（预发布，npm 通道 next）

### 说明
- 代码与 0.9.18 相同，**只是把 `next` 这个预发布通道从 2026-11-18 遗留的 `0.2.2-rc.3` 顶到当前版本**。
  它一直悬在 97 个版本之前：`npm i @marsken/dsh-studio@next` 会装到一个对着老宿主接口写的构建。
- 清 `next` 需要 npm 写权限（dist-tag 操作不受 Trusted Publishing 覆盖），本机只有只读令牌；
  所以改为按预发布流程走一次：`*-*` 的 tag 由 `release.yml` 自动 `--tag next` 发布，
  并且 `npm run verify:release` 的断言是「next 不比 latest 旧」—— 现在转绿。
- 正式版 `latest` 仍是 0.9.18，没有变化。


## [0.9.18] — 2026-11-20

### 说明
- 这一版是 **issue 清账版**：把 GitHub 上最后三个未结 issue（#5 全链路自测 11 项、#7 只读 POST 写审计、
  #8 交付物工具报错但已写入）的修复、实测数据与结论整理进仓库（`docs/issue-replies/`），并在 GitHub 上评论后关闭。
  功能代码与 0.9.17 相同，没有新增行为。

### 顺带
- 发布后清掉 `next` 这个悬空的 dist-tag（它一直指着 2026-11-18 调 CI 时的 `0.2.2-rc.3`）。
  `npm run verify:release` 里那条「next 不比 latest 旧」的断言就是为它加的。


## [0.9.17] — 2026-11-20

这一版把 [#5](https://github.com/marsken88/dsh-studio/issues/5) 剩下的四条、[#7](https://github.com/marsken88/dsh-studio/issues/7)
和 [#8](https://github.com/marsken88/dsh-studio/issues/8) 一起清了。

### 修复
- **#7 只读 POST 仍在写审计**：审计是一次 `store.mutate()`，会让 `revision +1`，而 `/state` 的 ETag 就是 revision ——
  打开一次卡片抽屉（`/task/parts` + `/task/comments`）就能让所有在线客户端的缓存失效。
  请求管线现在对 **readOnlyPost / 显式只读标记 / 404** 一律不记审计。实测：连续两个只读 POST + 一个 404，revision 不动。
- **#8 `studio_task_artifact` 每次调用都抛错但已经写入**：`store.mutate()` 返回的是**整份 state** 而不是回调返回值，
  代码却把它当任务对象用，于是写完再读 `task.artifacts` 抛 `TypeError` —— 用户看到报错会重试，产物就重复。
  改成在回调里把任务对象带出来。add / update / remove 三个动作都补了回归测试（把代码改回旧写法这条测试会红）。

### 修复（issue #5 剩余四条）
- **第 4 条 空 body 造垃圾记录**：`/projects/save`、`/experts/save`、`/teams/save`、`/bots/save`、`/suite/save`
  现在要求名称非空，否则 400（以前 `POST {} ` 会造出 `proj-8ac46c` 这种记录）。
- **第 6 条 手工建的卡不挂需求**：`/task/create` 对**非缺陷**卡要求 `requirementId`，
  否则 400「建卡要挂到一条需求上」；缺陷仍可不挂（缺陷常常还没有需求）。
- **第 7 条 测试环境默认值为空 → 新装即卡**：没配环境时，从面板/接口触发的用例执行会**回退到宿主自身地址**跑一遍，
  不再直接 "还没有配置测试环境" 把卡锁死；agent 直接调用仍然明确报错（没有请求来源可回退）。
  解析逻辑抽成 `resolveTestingEnv()` 纯函数并补了 4 条单测。
- **第 10 条 市场目录为空**：`/market` 在目录为空时返回一条可照做的 `hint`（面板空态直接显示），
  不再是一块白板。

### 测试
新增 `tests/artifact-tool.test.mjs`、`tests/testing-env.test.mjs`；总计 209 条。
真机验收 12/12（空 body 400 ×5、不挂需求 400、缺陷可建、用例可跑、市场 hint、只读不推 revision、404 不推 revision、产物不报错）。


## [0.9.16] — 2026-11-20

### 修复（npm 的 `next` 通道悬空了一整代）
- **`npm i @marsken/dsh-studio@next` 装到的是 `0.2.2-rc.3`**：2026-11-18 为了调 CI 连发了
  `0.2.2-rc.1` / `rc.2` / `rc.3` 三个预发布版，`release.yml` 按「版本号带 `-` 就走 `--tag next`」
  把它们发到 `next` 通道；紧接着 0.3 → 0.9 十几个正式版都只走 `latest`，**没有任何一步会把
  `next` 挪走**。于是一个早于全部功能、还对着老宿主接口写的构建在 `next` 上挂了整整一天多。
  三个 rc 已在 npm 上 `deprecate`，`next` 标签从 `0.2.2-rc.3` 上摘掉。
- `npm run verify:release` 新增断言 **「`next` 不比 `latest` 旧」**：`next` 要么不存在，
  要么不落后于 `latest`（预发布本来就该更新）；落后就 FAIL，并直接印出
  `npm dist-tag rm|add` 的修法。
- `release.yml` 发预发布时打 `::warning::`，写明「下一个正式版发完必须清掉 `next`」——
  CI 走 Trusted Publishing，只有 `publish` 权限、**没有 `dist-tag` 权限**，这一步只能在本机做。
- `tests/release-workflows.test.mjs` 加两条契约：`verify-release.mjs` 必须读 `dist-tags.next`
  并真的比版本号（不是只判空），`release.yml` 必须留着那句警告。

### 文档
- README 的 DSH 徽章与「运行环境」改成 `>=0.2.2-rc.1`（宿主**最低**版本），不再读起来像
  「当前就是 rc.1」；安装章节写明**只装 `@latest`**，「装完不对劲」表加一行 `@next` 的坑。
- 兼容性文档（`docs/compatibility.md`）同步版本号，并注明装哪个通道。

### 一次性清理（需要本机 npm 登录态，CI 做不了）
```bash
npm dist-tag rm @marsken/dsh-studio next
npm deprecate @marsken/dsh-studio@0.2.2-rc.1 "调 CI 的试发版，已废弃：请装 @marsken/dsh-studio@latest"
npm deprecate @marsken/dsh-studio@0.2.2-rc.2 "调 CI 的试发版，已废弃：请装 @marsken/dsh-studio@latest"
npm deprecate @marsken/dsh-studio@0.2.2-rc.3 "调 CI 的试发版，已废弃：请装 @marsken/dsh-studio@latest"
npm run verify:release   # 应看到「npm next 不比 latest 旧 — 没有 next 通道」
```

## [0.9.15] — 2026-11-20

### 修复（issue #5 剩下两条）
- **`/state` 同时下发空数组和真实计数**（第 9 条）：以前 `publicCases` / `publicChecklist` /
  `publicComments` 会带上 `cases: []`、`checklist: []`、`comments: []`，于是 `/state` 里既有
  空数组又有 `caseSummary` / `checkSummary` / `commentCount` —— 任何读 `task.comments.length` 的视图永远显示 0。
  现在**只给计数**，正文一律走 `/task/parts`。前端两个形状本来就都认，没有改动。

- **`/task/design` 只带 id 也会写数据**（第 5 条）：以前只传 `{id}` 就会写一条
  `{link:"", status:"pending", by:"人"}` 并让 `revision +1` —— 一个读请求改状态，被轮询打到就反复刷版本。
  现在用纯函数 `designPatchFrom()` 判断"请求体里到底有没有设计字段"：
  - 没有 → **只读分支**：返回当前设计，不写库、不加 revision、不记历史（打 `readOnly: true`）
  - 有 → 照旧合并写入

  顺带修了一处同源问题：**只读的 POST 也会记审计**，而审计写库同样会推 revision。
  请求管线现在识别 `req.__studioReadOnly`，只读请求不留写痕迹。

### 测试
- `tests/state-contract.test.mjs`（4 条）：三个投影不再含数组、`designPatchFrom` 的读写判断、
  路由只读分支必须在 `store.mutate` 之前返回；并把 `tests/repo.test.mjs` 里两条旧契约断言同步更新。

### 实测（218 真机）
```
/state 里没有空的 comments/checklist/cases 数组 — 检查 32 张卡，带数组的 0 张
计数仍在（commentCount / checkSummary / caseSummary） — 32/32
只带 id 的 /task/design 走只读分支 — 200 readOnly=true
只读请求不推进 revision — 19485 → 19485
带字段的 /task/design 仍然正常写入 — 200 status=pending
写入会推进 revision — 19485 → 19487
```


## [0.9.14] — 2026-11-20

### 修复（issue #4 第四次，找到了真凶）
上一版 0.9.13 的下沉逻辑是对的，但**用户截图里的那个抽屉根本不吃我们的 CSS**：
设置页的「编辑专家」用的是共享 `SideDrawer`，而它优先用**宿主的 SheetDrawer**（Radix 弹层，
它自己的 DOM 和样式）。我们改 `.ds-side-wrap` 的 top，对宿主组件毫无影响 ——
所以截图量出来还是 y≈13，但那是宿主弹层，不是我们的卡片抽屉。

现在：需要下沉时（`--ds-titlebar-floor > 0`）**不用宿主 SheetDrawer**，改用自带标记，
与卡片抽屉走同一套定位规则。Web 版下沉量是 0，仍然用宿主组件，行为不变。

### 回溯（同一件事错了四次，值得记）
| 版本 | 做法 | 为什么没成 |
| --- | --- | --- |
| 0.9.5 | `env(titlebar-area-height)` | 客户端里是 0 |
| 0.9.12 | UA 含 Electron → 32px | UA 被客户端去掉 |
| 0.9.13 | 量 `-webkit-app-region: drag` 的高度 | 逻辑对，但改的样式对宿主弹层无效 |
| **0.9.14** | 需要下沉时不用宿主弹层 | 待验证 |

教训：**改之前先确认那个元素到底是谁渲染的**。我前三次都在改自己的 CSS，而截图里那个抽屉是宿主的。


## [0.9.13] — 2026-11-20

### 修复（issue #4 第三次，这次是量的）
覆盖层没避开桌面窗口顶部标题栏，前两版都没真正修好，过程如实记下来：

| 版本 | 做法 | 实测结果 |
| --- | --- | --- |
| 0.9.5 | `top: env(titlebar-area-height, 0px)` | 客户端里该环境变量是 **0**，覆盖层仍从最顶端开始 |
| 0.9.12 | UA 含 `Electron` → 下沉 32px | 这个客户端把 UA 里的 Electron 段去掉了，**仍然 0** |
| **0.9.13** | 用 `elementsFromPoint` 找顶部那条 `-webkit-app-region: drag` 的元素，**量它的高度**；量不到再依次退回 `process.versions.electron`、UA、0 | — |

用户截图里的像素证据（0.9.12 之后仍是）：抽屉白底起点 y≈13、抽屉关闭按钮 y 25–60、窗口按钮 y 15–40 —— 三者重叠。

- 下沉量写进 CSS 变量 `--ds-titlebar-floor`，覆盖层统一 `top: max(env(titlebar-area-height, 0px), var(--ds-titlebar-floor, 0px))`
- 覆盖层 6 处都吃同一个值：卡片抽屉、弹窗、侧栏遮罩、登录浮层、命令面板遮罩、图片查看器
- Web 版没有可拖拽标题栏、也不是 Electron → 保持 0，行为不变

### 测试
- `tests/titlebar.test.mjs`（5 条）：量到标题栏就用它的高度、量不到但进程里有 Electron 用 32、UA 兜底、
  普通浏览器不设变量、环境异常不抛。
- `tests/overlay-titlebar.test.mjs`：断言覆盖层必须有保底下沉，且判定不能只靠 UA。


## [0.9.12] — 2026-11-20

### 修复（issue #4 第二次）
- **0.9.5 的标题栏避让在桌面客户端上没生效**：那次用的是
  `top: env(titlebar-area-height, 0px)`，但在这台 Windows 客户端里实测环境变量是 **0**
  —— 覆盖层仍然从窗口最顶端开始。用户截图量出来的数据：抽屉白底从 y≈13 开始、
  抽屉自己的关闭按钮落在 y 25–60，而窗口按钮占 y 15–40，**两者正好叠在一起**。

  现在改成 `top: max(env(titlebar-area-height, 0px), var(--ds-titlebar-floor, 0px))`，
  检测到 Electron（UA 里带 `Electron`）时把 `--ds-titlebar-floor` 设成 **32px**。
  系统标题栏更高的环境改这一个变量即可。Web 版没有 Electron UA，下限仍是 0，行为不变。

- 覆盖层清单（都吃同一个下限）：卡片抽屉、弹窗、侧栏遮罩、登录浮层、命令面板遮罩、交付物图片查看器。

### 说明
- 这是"信了 CSS 环境变量、没在目标机器上量过"的教训：0.9.5 我当时就写了"没法在客户端里亲眼确认"，
  这次用户截图 + 像素测量才把它暴露出来。测试从"有没有写 env()"升级成"有没有保底下沉"。


## [0.9.11] — 2026-11-20

### 修复
- **`tools/deploy.mjs` 跑完不退出**：以前上传和重启都做完了，脚本却一直挂着（我这一天里撞了两次，
  只能人肉去目标机核对文件时间才知道成功）。根因有两处：ssh2 连接关掉后事件循环还有残留句柄；
  安装脚本里的状态校验用错地址且没超时，一旦连不上就会一直等。

  现在：上传/安装分阶段打印进度、状态校验改成 **最多重试 20 次（每次 2 秒）+ curl --max-time 5**、
  成功路径显式 `process.exit(0)`、外加 10 分钟看门狗（真挂住时明确说明"上传可能已完成，去目标机核对"）。
  实测：`active=active files=51 state=200`，退出码 0，用时约 40 秒。

### 实测记录（本机 DSH Desktop + desktop profile）
- host 半边 `npm run verify:desktop`：插件加载、`/state.profile = desktop`、`/market.installed` 22 项、
  破坏性路由 400 —— 4/4 通过
- 客户端半边（侧栏「需求&任务工作空间」入口）**用户已确认出现** —— issue #3 的注册名修复在真实桌面环境生效
- 本地挂载的坑已写进 README：只写 `dependencies` 不加载，必须同时写 `dsh.profile.bundles`


## [0.9.10] — 2026-11-20

### 修复
- **`abandoned` 事件以前只写在注释里**：`reconcile()` 的注释一直写着「并把本轮记为一次 abandoned 尝试」，
  但代码只是原样保留 `attempts` —— 崩溃的那一轮不进计数，重试上限永远判不到；
  事件账本里也看不到任何"这张卡崩过"的痕迹。

  现在进程重启收掉跑着的派单时：
  - `attempts` 递增（到上限时事件里带 `exhausted: true`）
  - 发一条 `task/abandoned` 事件（带 taskId / title / attempts / sessionId / reason）
  - 卡片历史留一行「abandoned：上次进程结束时这张卡还在跑（第 N 次尝试）」

  判定逻辑抽成 `src/host/dispatch-state.js` 的 `abandonedRetry()`（纯函数，可单测）。

### 测试
- `tests/abandoned.test.mjs`：attempts 递增 / 上限标记 / 脏数据不炸；
  以及契约检查——`reconcile` 里确实发了 `task/abandoned` 并写了历史。


## [0.9.9] — 2026-11-19

### 新增
- **桌面版验收脚本** `npm run verify:desktop`：在真实 Electron 客户端上验 host 半边 ——
  插件是否加载、`/state.profile` 是否等于当前 profile、`/market.installed` 里有没有本插件、
  破坏性路由是否要求 `confirm`。跑完会列出**脚本验不了的人工确认项**（见下）。

### 实测（本机 DSH Desktop + desktop profile，0.9.8 代码）
- 插件能加载（真实空库，tasks=0）
- `/state.profile` = **desktop**（以前永远回退成 web —— issue #5 第 2 条，第一次在真实桌面环境验证）
- `/market.installed` = 22 项且包含本插件（以前恒为空）
- `POST /studio-api/task/delete {}` → **400 confirm_required**（issue #5 第 3 条）

### 文档
- README 新增「本地开发：把插件挂进某个 profile」：**只写 dependencies 不会加载**，
  必须同时写 `dsh.profile.bundles`，再把文件放进 `node_modules/@marsken/dsh-studio`，然后重启。
  （这次就是漏了 bundles，白重启一次。）

### 说明
- **客户端半边（侧栏入口 / 面板渲染）没有自动验**：桌面窗口走 `dsh-app://` + 启动令牌，
  外部浏览器打不开那个页面。三项人工确认写在 `verify:desktop` 的输出里。


## [0.9.8] — 2026-11-19

### 修复
- **`backfill-releases` / `reorder-releases` 以前每次发版都跑**：两个 workflow 写的是
  `on.push.paths: [本文件]`，但 **GitHub 对 tag push 不评估 `paths` 过滤器** —— 于是每次打 tag
  都会额外跑一遍「删掉全部 release 再按版本升序重建」和「补建历史 release」，和 `release.yml` 抢着建 release
  （靠 `concurrency` 串行才没出事）。现在两者都只在**手动 Run workflow** 时跑。
- 正常发版本来就不需要它们：`release.yml` 建当前 tag 的 release 时带 `--latest`，GitHub 会把上一版降级。

### 新增
- `npm run verify:release` 多一条断言：**GitHub Releases 的 `latest` 必须等于当前版本**
  （GitHub 的 Latest 是按创建时间定的，不是版本号；补建历史 release 那次就把 v0.1.0 顶成了 Latest）。
  接口限流时只记「未检查」，不阻塞发版。
- 契约测试 `tests/release-workflows.test.mjs`：两个维修 workflow 不许再挂 `push`、
  `release.yml` 必须带 `--latest` / 预发布 `--latest=false`、发版校验必须查 `releases/latest`。


## [0.9.7] — 2026-11-19

### 新增
- **空数据巡检** `npm run verify:empty`（`tools/visual/empty-state-probe.mjs`）：真拉一份 `/state`，
  把集合清空（config 保留），用 CDP 拦截响应替换，然后**走一遍全部 8 个页签**，断言不出现「渲染失败」、
  空看板给出「还没有任何卡」的引导。已接进 `release:preflight`。

  这条补的是 issue #6 暴露的空白：新装、零数据是完全不同的代码路径。
  我们自己的实例有 31 张卡，boardEmpty 那个分支的短路条件根本不成立，所以一直没暴露；
  新装用户第一条就是 true，直接崩。以前的探针全是"有数据"的实例。

  实测（0.9.7）：11 项全过 —— 面板起得来、8 个页签在空数据下都不崩、空看板显示引导且 0 张卡。

### 说明
- 探针**不改服务器数据**：它只拦截浏览器侧的响应。想验真实空库还要另一个实例（需要 `dsh` CLI 建临时 profile），
  这一步在桌面版上做，见下个版本。


## [0.9.6] — 2026-11-19

[issue #5](https://github.com/marsken88/dsh-studio/issues/5) 的 11 项里，三条高危 + 两条中危已修；
其余四条按"需要产品决策"记录在下面，没有假装做过。

### 修复（高危）
- **4 个只读工具被当成写工具**：`studio_dashboard` / `studio_workload` / `studio_burndown` / `studio_costs`
  不在权限表里，`toolLevel()` 兜底成 `write` → 走审计 → 抛错（#3 那条 `recordAudit` 之后仍然会踩）。
  现在 40 个工具**全部显式登记**（读的 `read`、写的 `write`、发布/灰度/改名 `admin`），
  权限表搬到 `src/host/tool-access.js`，并有契约测试遍历注册表要求无一遗漏。
- **`detectProfile()` 认不出 scoped 包名**：只匹配 `dsh-studio` 短名 → desktop profile 永远回退成 `web`，
  于是 `/state.profile` 错、`/market.installed` 恒为空、面板里点安装会装到 web profile。
  现在同时认 `@marsken/dsh-studio`、`*/dsh-studio` 与短名。
- **破坏性路由零确认**（安全）：删数据 / 清审计 / 改成员 / 发布 / 回滚 / 装机等 20 条路由，
  现在必须带 `confirm` 且值等于约定词（`DELETE` / `CLEAR` / `RESTORE` / `INSTALL` / `UNINSTALL` /
  `PUBLISH` / `ROLLBACK` / `RESET` / `SAVE ACCESS`），否则 400 `confirm_required`。
  面板的 `api()` 会自动补（界面上本来就有确认框）；自写脚本要按 README 的表格带上。
  实测：`POST /audit/clear {}` 现在是 400，不再是"真删"。

### 修复（中）
- **新建需求不再永久卡「评审中」**：以前没有 PRD 的新需求自动置成 `status=review` + `review.pending`
  （评审人写"系统"），但既没有评审人也没有自动流转 → 准出长期挂 blocker。现在落 `draft`。
- **错误信息被审计顶掉**：写工具业务体抛错后，catch 里的审计又抛错，原始报错被覆盖。
  现在审计失败不影响原始错误。

### 未做（需要产品决策，不假装完成）
- #5 `/task/design` 只带 id 就写数据、#9 `/state` 同时下发 `comments: []` 与 `commentCount`（契约不一致）、
  #7 测试环境默认值为空导致新装即卡、#10 插件市场目录需要配源 —— 这四条都要先定"新装默认该怎么表现"，
  不是纯 bug，留给下一轮和「空库实例探针」一起做。


## [0.9.5] — 2026-11-19

修的是 [issue #4](https://github.com/marsken88/dsh-studio/issues/4)：桌面版里卡片详情抽屉盖住窗口标题栏，
头部的「设计：…」和「关闭」被原生窗口按钮遮挡、点不动。

### 修复
- 根因：桌面客户端是**无边框窗口 + Window Controls Overlay**，系统在窗口顶部画了一条标题栏
  （最小化/最大化/关闭）。我们的覆盖层写的是 `position: fixed; inset: 0`，即从 `top: 0` 开始，
  于是钻到那条标题栏下面 —— 视觉上被盖住，点击也落在原生按钮上。
- 所有全屏覆盖层（卡片抽屉、弹窗、侧栏遮罩、登录浮层、命令面板遮罩、交付物图片查看器）
  改为 `top: env(titlebar-area-height, 0px)`，并标 `-webkit-app-region: no-drag`（避免被当成拖拽窗口）。
  普通浏览器/Web 版里 `env()` 没有值，退回 0，行为完全不变。

### 测试
- `tests/overlay-titlebar.test.mjs`：扫描源码里所有 `position: fixed; inset: 0` 的覆盖层，
  必须带标题栏偏移；并检查产物里确实有偏移（`dist/client.js` 至少 5 处）。
  把抽屉那一行改回 `inset:0`，这条会红（实测过）。

### 说明
- 这台机器上没有运行中的桌面客户端，所以**没有在 Windows 客户端里亲眼验证**遮挡是否消失；
  验证到的是：① 桌面应用确实启用了 Window Controls Overlay（`app.asar` 里有 `titleBarOverlay` /
  `titlebar-area`）；② Web 版里 `env()` 回退为 0，抽屉位置与之前一致（探针通过）；
  ③ 覆盖层规则有测试兜底。仍需要在真实客户端上确认一次。


## [0.9.4] — 2026-11-19

### 修复
- **GitHub Packages 镜像 workflow 整条失败**（CI 红）：
  `publish-github-packages.yml` 里还在用字符串替换把产物里的
  `id:"@marsken/dsh-studio"` 改成镜像包名，但 0.9.3 起注册名是**运行时推导**的，
  产物里已经没有那个字面量了 → 替换失败 → 抛错退出。

  这一步本来就不再需要：运行时解析会从 `__DSH_BOOT__.entries` / 自己的 script 地址取到
  宿主分配的真实 id，镜像装到哪儿都自动对得上（issue #3 修的就是"写死名字会失效"）。
  已删掉这段改写，并留了注释说明为什么不能加回来。

### 新增
- `npm run verify:mirror`（`tools/mirror-dry-run.mjs`）：在临时目录里把镜像 workflow 的
  **改名 + 自检**整套跑一遍，已接进 `release:check`。
  这类"只在 CI 打 tag 时才跑"的步骤以前没有本地覆盖，坏一次要等到发版才知道。


## [0.9.3] — 2026-11-19

修的是 [issue #6](https://github.com/marsken88/dsh-studio/issues/6)：macOS 桌面版点开「看板」报
`工作空间渲染失败：Cannot access 're' before initialization`。

### 修复
- **空看板必崩**：`web/src/studio/board.js` 里 `boardEmpty` 的判断用了下面一行才声明的 `filtering`：

  ```js
  const boardEmpty = (state.tasks ?? []).length === 0 && filtering === false  // ← 先用了
  const filtering = query !== '' || …                                        // ← 才声明
  ```

  `&&` 短路把它藏住了：**板上有卡时**第一个条件就是 `false`，`filtering` 根本不会被求值，所以
  我们自己的实例（31 张卡）一直没暴露；**新装用户第一次打开看板**（0 张卡）第一个条件为 `true`，
  立刻去读还没初始化的 `filtering` → `ReferenceError`（压缩后就是 `Cannot access 're' before initialization`）。
  现在先声明 `filtering` 再算 `boardEmpty`。

### 新增
- `npm run verify:tdz`（`tools/tdz-scan.mjs`）：按**作用域**扫「同作用域内先用后声明」。
  已在 `release:check` 里每次发版都跑。把上面两行换回原顺序，这条扫描会当场红（实测过）。
- 实测它能覆盖 `for (let i …)` 这类循环头（不会误报），也不会把注释/字符串里的同名标识符算进去。


## [0.9.2] — 2026-11-19

修的是 [issue #3](https://github.com/marsken88/dsh-studio/issues/3) 报的两个阻断级缺陷。

### 修复
- **侧边栏入口完全不出现**（工具能用、面板不见）：浏览器端注册名必须等于**宿主给这个插件分配的模块 id**，
  写死任何一个名字都会在另一种安装方式下失效：
  - npm / profile 安装：id 是包名（`@marsken/dsh-studio`）
  - 本地目录挂载：id 是目录名（`dsh-studio`）

  现在改成**运行时解析**：优先读宿主写进页面的 `window.__DSH_BOOT__.entries`（每项 `{id,url}`，id 就是宿主分配的模块 id），
  取不到再从自己的 script 地址推（`/plugins/<id>/client.js`，要吃掉 `??` 多入口前缀与 `&rev=`），最后才退回包名。实测：改回短名 → 本地面板复活但 npm 装的不显示；改成包名 → npm 正常但本地面板消失
  （`web boot: 1 entry did not activate`）；运行时推导后两边都对。
- **所有写工具抛 `recordAudit is not defined`**：`src/host/tools.js` 裸引用了 index.js 的
  `recordAudit`（没走 `configureToolHost` 注入）。已加进注入列表并改成 `host.recordAudit(...)`。

### 测试（两类都补了防回归）
- `tests/module-id.test.mjs`：`dist/client.js` / `client.js` / `client.src.js` 的注册名必须等于包名；
  vite 入口必须用编译期常量；镜像 workflow 必须同步改名。（把产物改回短名，这条会红。）
- `tests/tools-audit.test.mjs`：静态检查 `INJECTED` 里的宿主能力不许裸调用；
  动态起一个真 `StudioStore`、注册工具、跑一个写工具，确认不抛 `ReferenceError`。
- `tests/repo.test.mjs` 里那条「bundle 注册名」断言原来写死的正是短名 —— 已改成按包名比对。

### 为什么之前没被发现
- 面板探针一直打的是**手工部署**的那份，宿主按目录名解析，短名恰好能对上；npm 装到 profile 里才暴露。
- 写工具只在**真的调用工具**时触发，而之前的验收全走 HTTP 路由（路由用的是 `host.recordAudit`，一直是对的）。


## [0.9.1] — 2026-11-19

### 修复
- **需求签字从 0.4.0 起一直是 400**：`override` 变量声明在 `if (action === 'sign')` 块里，
  却在 `store.mutate` 里被引用 —— 每次签字都抛 `ReferenceError: override is not defined`。
  这条路径此前没有任何测试覆盖，所以四个版本都没被发现。已修，并加了作用域回归测试。
- **代码评审进准出**：有执行记录就必须有评审结论，`pending`（或没有记录）与 `changes_requested`
  现在都会拦住卡片完成。以前 `coding.review` 完全不参与准出，评审为「要改」的卡照样能推到已完成。
- **不能自评**：执行记录的作者给自己盖「通过」会被拒（名字互相包含也算自评，如「开发」vs「开发工程师」）。
- **评审不传结论不再默认通过**：工具与 HTTP 两条入口都改成默认 `pending`，要放行必须显式说 `approved`。
  （这一版先只改了工具，实测面板照旧默认 approved —— 两个入口现在共用同一个判定函数。）

### 变更
- **签字人取服务端认定的身份**：登录会话 > 反代注入的 `x-studio-user` > 请求体（免登录单机模式才轮到自报），
  记录里带 `source`（session / header / body / none）。以前直接取 `body.by`，开了 LDAP 也能用别人的名字签字。
  真机实测：请求体写「李四」、会话是「超管 admin」时，记录里是 `by: 超管 admin, source: session`。


## [0.9.0] — 2026-11-19

### 修复
- **可追溯矩阵以前不可追溯**：功能点里任意一条用例通过，就把**所有**验收条件标成覆盖 ——
  于是矩阵上「5/5 覆盖」可能只对应 1 条用例。现在逐条判：只有**挂在某条条件上**（`acceptanceId` 相符）
  的**通过**用例才算覆盖它；没挂条件的用例单独计数，不冒充覆盖。
- **拆卡不再铺通用模板**：以前卡的验收清单是按类型的 3 条通用文字（勾完跟这条需求的验收毫无关系）。
  现在功能点的验收条件会原样变成卡的验收清单项，id 与需求上一致，矩阵才认得出对应关系。

### 新增
- 用例支持 `acceptanceId`（`studio_task_add_cases` 可传）；`src/host/acceptance.js` 收口验收条件的形状与清单构造。
- 需求准出多一条提醒：「N/M 条验收条件没有对应的通过用例」。

### 工程
- 新增契约测试：**`index.js` 必须能被真的 import 起来**。这一版我自己就踩了它 ——
  把 `sanitizeAcceptanceItem` 从 domain.js 搬到新模块后 index.js 还在老地方导入，
  `node --check` 通过、当时 164 条测试全绿，但目标机上插件 import 失败、整个面板 405。
  现在这条测试会当场红。


## [0.8.6] — 2026-11-19

### 新增
- **打包后自检** `npm run verify:pack`：直接验 `npm pack` 出来的 tarball ——
  bundle patch 在不在包里、它的 `name` 是否等于包名（含 scope）、`exports` / `dsh` 指向的文件是否都在、
  `index.js` 能不能被真的 `import` 起来。已接进 `release:check`，CI 也会跑。
  **它抓的正是 0.5.1 那次「装完不加载」的根因**：把 patch 改回裸名 `dsh-studio`，
  这条会红并直接说「patch 里的 name ≠ 包名：装完会 ERR_MODULE_NOT_FOUND」。

### 修复
- **GitHub Packages 镜像不再过期**：镜像 workflow 的 `push` 同时要求 `tags` 和 `paths: [本文件]`，
  两者必须同时成立 —— 所以正常打 tag 永远不会触发，内网用户一直拿到旧版本。现在只按 tag 触发。
- README 不再写死测试条数（写的是 108，实际 164），兼容文档的工具数 39 → 40。

### 说明
- 探针本身仍跑在**部署好的实例**上；要做到「探针打的就是 tarball 里的东西」，下一步是把部署改成
  从 pack 产物安装到临时 profile（需要 dsh CLI，本机没有）。这一版先把「产物能不能加载」这条堵住。


## [0.8.5] — 2026-11-19

### 新增
- `npm run verify:ax`：用 CDP 的无障碍树（`Accessibility.getFullAXTree`）检查 6 个页签 + 卡片抽屉 ——
  交互节点有没有可访问名称、有没有"可聚焦却被 ignored"、标题是否跳级、对话框是否有名字。
  **这一层比看 DOM 准**：DOM 里旁边摆一个 `<div>标题</div>` 不算关联，读屏照样念"编辑框"。

### 修复
- 无障碍树第一轮扫出 **12 个没有名字的控件**（DOM 探针全部漏掉）：
  版本页灰度批次比例、设置页三个数量上限、需求页 6 个表单字段、搜索框等。已修 11 个：
  - 表单适配层加了兜底：有 `placeholder` 就拿它当 `aria-label`
  - 搜索框默认名「搜索」
  - 没有 placeholder 的（灰度比例、数量上限、需求标题/负责人/链接等）逐个补 `aria-label`

### 说明
- **还有 1 处没修好**：需求页上一个 react-aria 的 `input` 仍报空名称，还没定位到源码位置。
  所以 `verify:ax` **暂不接入发版闸门**（接了会一直红）；宁可让它红着提醒，也没把它加进白名单假装通过。
- 真读屏（NVDA/VoiceOver）仍未实测：NVDA 需要装 Guidepup + 管理员权限；VoiceOver 需要 macOS（本机与 218 都没有）。


## [0.8.4] — 2026-11-19

### 新增
- **尊重系统的「减少动态效果」**（`prefers-reduced-motion`，WCAG 2.3.3）：开着这个设置时，
  抽屉滑入、toast 淡出等过渡压到 0.001ms。实测：过渡 / 动画都变成 0.001ms。
- **重排检查**（WCAG 1.4.10）：320px（≈400% 缩放）与 800px（≈200% 缩放）下实测**没有横向滚动**。

### 说明
- `npm run verify:a11y` 现在同时检查：对比度、可访问名称、键盘焦点、抽屉焦点圈、**重排**、**减少动态效果**。
  任何一项不达标就退出码 1，已接进 `release:preflight`。
- **版本页的弹窗仍然没扫到**：那些动作收在「⋯」菜单里，探针自动点开的链路没跑通。
  这条如实写进 `ACCESSIBILITY.md` 的已知限制，没有当成"扫过了"。


## [0.8.3] — 2026-11-19

### 修复
- **设置页 16 个面板与命令面板的对比度**：之前的无障碍只覆盖 6 个页签，设置页里
  集成健康的红/绿状态点（3.91 / 3.51:1）、命令面板「操作」标签（4.48:1）都没达标；
  暗色主题下更差（3.03 / 3.18 / 2.15:1）。这些颜色是**内联写死的 hex**，不会跟着主题变 ——
  现在改成按主题定义的 `--ds-ok-text` / `--ds-violet-text` / `--ds-danger-text`。
- **a11y 探针的误报**：包在 `<label>` 里的开关被报成「没有可访问名称」，
  实际上那是 HTML 规范的隐式标签。判定已修正（探针自己也要讲道理）。

### 新增
- `npm run verify:a11y` 的覆盖面扩到 **6 页签 + 16 设置面板 + 命令面板 + 卡片抽屉**，
  并新增「图表必须有文字替代」一项。
- 燃尽图与上下文占用趋势图补 `aria-label` + `<title>`（例如「最近 N 次会话，峰值占用 Xk token」）。

### 实测
- 浅色：对比度 0 处不达标、无名称 0 个、焦点 0 次不可见、抽屉焦点圈 ok。
- 暗色：同上（这一轮把暗色也扫了设置面板，才发现上面那批内联色的问题）。


## [0.8.2] — 2026-11-19

### 修复
- **小字号文字对比度不达标**（WCAG AA 要求 4.5:1）：红色提示只有 3.91:1、琥珀色提醒 4.24:1、
  次要文字 4.40:1。现在把「文字颜色」和「底色/边框/色条」拆开，文字改用按主题定义的
  `--ds-danger-text` / `--ds-warn-text` / `--ds-muted`，视觉风格不变。
  **浅色主题 24 处 → 0 处，暗色主题 10 处 → 0 处。**
- **卡片抽屉的键盘可达性**：以前没有 `role="dialog"`、焦点不进入、Tab 会跑到被遮住的页面上（实测逃出 8 次）。
  现在有 dialog 语义 + `aria-label`、打开即聚焦、Tab 只在抽屉内循环、Esc 关闭、关闭后焦点回到触发它的元素。

### 新增
- `npm run verify:a11y`（真机 + 真 Chrome）：扫 6 个页签的对比度、可访问名称、焦点可见性，以及抽屉的焦点圈。
  支持 `A11Y_THEME=dark` 量暗色主题。已接进 `release:preflight`。
- [ACCESSIBILITY.md](ACCESSIBILITY.md)：量出来的结论 + **还没验证的 7 项**（读屏实测、200% 缩放、图表替代文本等）。

### 说明
- 这次只扫了 6 个页签与卡片抽屉；设置页 17 个面板、命令面板、版本页弹窗**没有**逐屏扫过对比度，
  已写进 ACCESSIBILITY.md 的已知限制，没有当成"全站达标"。


## [0.8.1] — 2026-11-19

内容和 0.8.0 一样（交付节奏三把尺子）。

**为什么跳号**：0.8.0 的 tag 推上去后 CI 挂了 —— 不是产品代码的问题，
是新加的那条「周一为一周之始」测试用了带 `+08:00` 的时间字面量，在本地（Asia/Shanghai）通过、
在 CI（UTC）不通过。已改成用本地时间构造器，并且**整个测试套件现在都在 `TZ=UTC` 下过了一遍**。


## [0.8.0] — 2026-11-19

### 新增
- **效能页多了三把尺子**（产品定义第 9 / 10 / 14 条，之前都是「未测量」）：
  - **门禁一次通过率**：到过「待验收」的卡里，第一次进待验收就直接完成（中途没被打回测试/开发/评审）的比例。
    太低说明上游澄清没做到位，太高（接近 100%）说明门禁没在挡人。被打回的卡会列出来。
  - **派单周活**：一周内有 AI 评论的卡片数，近 8 周序列 + 是否达到「每周 ≥15 张」的目标。
  - **需求交付时长**：需求创建 → 验收签字的间隔中位数（按需求算，不按卡）。

### 说明
- 「需求交付时长」用的是**验收签字**的时间戳，不是发布：发布那一步还没有可靠时间（版本对象上没有"需求什么时候上的线"）。
  口径写死在 `src/host/delivery.js` 文件头，三个数字都能在代码里对出来。


## [0.7.2] — 2026-11-19

内容和 0.7.0 / 0.7.1 一样（事件账本 + webhook 先落账再投递）。

**为什么又跳号**：0.7.1 的 tag 在 Actions 里跑了 48 秒后被 CANCELLED，0.7.0 更是 1 秒就被取消，
两次都不是代码问题（ci.yml 一直是绿的）。怀疑是 release.yml 里用 `workflow_call` 调镜像 workflow
导致的，现在把它拆成**两个独立 workflow**（镜像自己响应 tag push），发版主链路不再依赖它。


## [0.7.1] — 2026-11-19

内容和 0.7.0 一样（事件账本 + webhook 先落账再投递）。

**为什么跳号**：0.7.0 的 tag 在 GitHub Actions 里被取消两次 —— tag 先删再推之后，
`release.yml` 的运行每次都在 1 秒内变成 `CANCELLED`，npm 上从来没有 0.7.0。
去掉 workflow 的 `concurrency` 也没用，所以改成**用一个全新的 tag** 发布，不再动已经删过的 ref。


## [0.7.0] — 2026-11-19

### 新增
- **事件有账本了，能按 seq 查**：`GET /studio-api/events?since=<seq>&limit=100&type=task/moved`
  返回 `{ lastSeq, total, events }`。以前事件只在进程里扇出一次，外部收到什么都无法事后核对。
- **webhook 改成「先落账再投递」**：每条事件先写进账本拿到 `seq`，再发给订阅地址；
  落账失败就**不发**——宁可外部收不到，也不让它收到一条查不回来的事件。
  账本保留最近 500 条（`seq` 只增不减），存在 side 键里，不涨 revision、不占快照。

### 真机验收
- 起一个本地接收器 + 配一个 `task/moved` webhook，挪一张卡：
  接收器收到 `seq=1` 的 `task/moved`，`/events?since=0` 里查到的正是同一条（类型、时间一致）。


## [0.6.0] — 2026-11-19

### 新增
- **重复请求不再写两遍**：POST 带上 `Idempotency-Key` 时，同一个 key 只真正执行一次，
  后面几次直接回放第一次的响应（响应头 `x-idempotent-replay: 1`）。网络抖动、手抖双击、
  代理重放都不会再多出一条评论 / 一个用例。有效期 24 小时，最多记 200 个 key。
- **并发改同一张卡不再静默覆盖**：卡上多了一个 `version`，`/task/update` 带 `ifVersion` 时，
  基于旧版本的写入会被拒（HTTP **409** + `code: version_conflict` + **当前卡**），
  前端据此刷新重做即可。不传 `ifVersion` 的调用方行为不变（面板、agent 都不用改）。

### 真机验收
- 同 key 连发 2 次评论 → 只有 1 条，第二次带回放头；换 key 能正常写第二条。
- 两人基于同一版本改同一张卡 → 一个 200、一个 409 且带回当前卡，被拒那次没落库。


## [0.5.2] — 2026-11-19

### 修复
- **从 npm / 插件市场装完插件根本不加载**（issue 报的 `ERR_MODULE_NOT_FOUND: Cannot find package 'dsh-studio'`）：
  `cordis.patch.yml` 里写的是裸名 `dsh-studio`，而 npm 包叫 `@marsken/dsh-studio`。加载器把 `name`
  当模块说明符去 profile 的 `node_modules` 里解析，裸名必然找不到 —— 于是宿主日志里只有
  `plugin.not-loaded`，面板、工具、路由全都没有。现在 `name` 是完整包名。

### 说明
- **已经装过 ≤0.5.1 的人需要处理一次**：profile 的 `cordis.patch.yml` 里那行还是旧的裸名。
  升级到 0.5.2 后如果仍不加载，删掉 `~/.dsh/profiles/<profile>/cordis.patch.yml` 里
  `id: dsh-studio` / `name: dsh-studio` 那两行再装一次（或整条删除后重装）。
- 为什么以前没发现：发版只跑 `npm test` 和真机探针，而探针打的是**已经手工部署**的那份，
  patch 里的名字从来没被真正解析过。现在多了一条契约测试（patch 里的 `name` 必须等于包名），
  发布清单也加了「在临时 profile 里真装一遍」。


## [0.5.1] — 2026-11-19

### 新增
- **效能页多了「自动化率」**：已交付需求里，全程没有任何人工介入（评论 / 换列 / 签字）的占比。
  这是产品定义第 13 条，之前根本算不出来；现在有 KPI 和逐需求明细。

### 修复
- **人工介入的判定改成和验收签字同一套口径**：AI 用「测试工程师」这类专家名发的评论、动过的列，
  以前被算成人的介入，自动化率因此恒为 0%（统计口径错了，不是真的一直有人在介入）。
- 只写了角色名（产品 / 架构师 / 开发 / 测试…）的记录会被记成**来源不明**：既不算人也不算 AI，
  并在页面上单独报出条数——「这个百分比只对能归因的部分负责」。


## [0.5.0] — 2026-11-19

### 新增
- **强制放行分得清是谁推的了**：效能页那一块现在写明「AI 推 N 次 · 人推 M 次 · 没记签名人 K 次」，
  判定和验收签字同一套口径（专家名册里的名字算 AI，会话痕迹算 AI）。
- **超上限会自己冒头**：区间内强制放行超过 `overrideMax`（默认 3 次，可在配置里调）时，
  效能页标题打 ⚠ 并写明「超过上限 N 次」，工作台同时出现「强制放行」风险格（近 30 天）——
  这个口子用得太勤会被人看见，而不是埋在明细里。


## [0.4.0] — 2026-11-19

### 新增
- **效能页多了一块「强制放行」**：门禁说不行、有人（或 agent）硬推的每一次，都在这里列出来——
  多少次、卡几次/需求几次、谁放的、什么时候、为什么，还有多少次压根没写原因。
  `override` 本来就是有意开的逃生舱，但它必须**被看见**：以前只写进卡片历史里一句话，没人统计过。

### 修复
- **需求级的 override 以前不落库**：只在当次请求里放行，事后查不到谁签的、为什么放行。现在会和卡片级一样存下来。


## [0.3.9] — 2026-11-19

### 变化
- **AI 不能代签了**：卡片准出与需求准出现在都把「签字是 AI 写的」当成**拦**，不再只是提醒。
  判定不看名字写法：写入时记了 `agent`/`ai`、名字是会话痕迹、**或者名字在专家名册里**，都算 AI。
  所以早期被误记成 `actorKind: human` 的老记录也会被正确识别（`t-a55ccbfc` 就是这种）。
- 确实要提前放行：走 `override` 写一句原因，留痕放行——不是偷偷摸摸改状态。

### 修复
- 需求级签字以前不保存 `actorKind`（卡片那边保存了），重启一轮又只能靠名字猜；现在两处一致。


## [0.3.8] — 2026-11-19

### 修复
- **AI 签的字不再被当成人工签字**：派单出去的专家调用验收签字工具时，记录里一律写 `actorKind: agent`。
  以前是按名字猜（`测试工程师` 不是 `studio-*` 就被判成「人」），于是 AI 自己验收、自己签字的卡片，
  在门禁和介入统计里都显示成「人工签字」。这是 2026-11-19 真派单给一张待验收卡补断言时撞到的。
- 卡片准出与需求准出现在会明说「签字是 AI 写的（谁签的）：人还要再看一眼」，不再静默放行；
  是否直接**拦死**留给人拍板（`docs/product.md` §6 第 3 条）。

### 变化
- 卡上还有「没有可执行断言」的用例时，**任何列的专家**接单都会在提示词里看到并被告知去补（以前只有测试列提）。


## [0.3.7] — 2026-11-19

### 新增
- **用例库能筛「没有断言」的那批了**：以前只有标题、跑不了的用例跟手工用例长得一样，
  混在列表里没人找得出来（全库 111 条里有 41 条）。现在类型列如实显示「草稿 / 无断言」，
  多了「只看无断言 / 只可跑」筛选，工具栏还会直接告诉你还有多少条跑不了。

### 修复
- 生成器标出来的 `draft` 以前存取一圈就丢了（`sanitizeCase` 没保留这个字段），
  所以草稿和「人工写的用例」在数据上根本分不开。现在这个标记会一路带到用例库。

### 质量闸门
- 新增 `npm run verify:cases`（真机 + 真 Chrome）：草稿必须看得见、筛得出来、切回全部能复原。
  它已接进 `npm run release:preflight`，跑它需要额外给 `STUDIO_BASE`（不猜默认地址，免得打到别的机器上）。


## [0.3.6] — 2026-11-19

### 新增
- **用例可以带断言了**：新工具 `studio_task_add_cases` 让测试专家把「做什么 / 打哪个接口 / 期望什么状态码」
  一次写完落库；接口用例给 `method` + `path` + `expectStatus`（`path` 常相对地址，用测试环境 `baseUrl` 解析），
  shell 用例给 `command` + `expectExit`。**写完会当场试跑第一条**：跑不通就把原因原样回给专家去改，
  只有标题没有断言的「用例」直接拒收（一条不合法就整批不写）。

### 修复
- **shell 用例字段名不一致导致假失败**：工具写入的是 `expectExitCode`，执行器读的是 `expectExit`，
  于是命令明明退出码 0 也被判「退出码 0（期望 undefined）」，还会自动开一张假缺陷卡。
  现在统一用 `expectExit`（旧的 `expectExitCode` 调用仍兼容），并且**写进库的用例先过一遍 `sanitizeCase`**，
  保证「刚写入的形状」和「重启后加载的形状」完全一致——这类漂移以后不会再躲过验证。

### 说明
- 存量用例不会自动补断言：它们仍是旧生成器产出的草稿（不计入可执行覆盖率），需要重新生成或人工补。
- 规则推断对「错误密码返回 401」这类语义型验收条件依然无效，正确做法见 `docs/product.md` §5.1。

只记**用户能感知**的变化。内部重构、测试增补不单列（看 `git log`）。
日期是发布日，格式参照 Keep a Changelog，版本号遵循语义化。

## [0.3.5] — 2026-11-19

### 修复
- **生成的用例不再是"永远跑不了"的空壳**：以前生成器把可执行定义写死成空值，
  所以全库 101 条用例没有一条能跑。现在会按验收条件推断：条件里有地址就生成接口用例，
  允许 shell 且有命令行就生成 shell 用例。
- **推断不出断言的用例会被明确标成草稿**，不计入覆盖率 —— 不再假装它是一条用例。

### 说明
- 规则推断对「错误密码返回 401」这类**语义型**验收条件仍然无效（需要模型来补地址）。
  这一点和后续做法已经写进 `docs/product.md` §5.1，不在本版解决。
- 存量用例不会自动变好：它们仍是旧生成器产出的草稿，需要重新生成或人工补断言。

## [0.3.4] — 2026-11-19

### 变更（会影响准出，请先读）
- **用例不再能"假绿"**：
  - 没有可执行定义（http / shell / db）的用例，**不能**再标成"通过" —— 点了也会回到未跑。
    跑不起来的用例点成通过，本来就是自欺。
  - **门禁不再接受 0/0**：有用例但一条都跑不了、或跑得了但一条都没通过，都会**阻断准出**，
    并写明原因（以前这两种情况只是提示）。
  - **代价**：现有 101 条用例全部只有标题、没有断言，相关卡会因此过不了准出。
    要推进请补可执行断言，或用「绕过准出」留痕放行（会记录谁、何时、为什么）。

### 新增
- **自动化率可以算了**：直接读现有数据（评论的 by、卡片 history、签字记录），不加埋点。
  `npm run` 里没有对应脚本，用 `tools/report-intervention.mjs <state.json>`。
- **用例强度可以算了**：`node tools/report-case-strength.mjs http://<host>:18080`
  给出「可执行 / 只有标题 / 占比」，门槛 60%。
- **签字记录带 actorKind**：以后能分清是人工签还是 AI 签（历史签字无法追溯）。

## [0.3.3] — 2026-11-19

### 修复
- **崩溃后卡住的卡现在看得见了**：进程重启或会话中断后，那些派单没正常结束的卡
  既不在跑、也不会再被自动派单，却和「排队中」长得一模一样。现在卡片会显示
  「⚠ AI 上次没有正常结束，这张卡不会再被自动派单 —— 需要手动「重新派单」」。
  上线后立即在真实数据里发现 **5 张这样的卡**（最早的一张卡了 8 天）。
- **「重新派单」真的会重派**：以前只清失败计数、不清派单印记，按下去永远不重派。
- **重启后不再永久停摆**：清掉残留的印记，下一轮调度会重新拾起这张卡。
- **两个进程同时写不再静默丢数据**：以前后写的会整包覆盖先写的（磁盘上只剩一边的卡，
  没有日志也没有报错）。现在落盘前比对版本，冲突会明确报错。
- **落盘失败会回滚内存**：以前失败后内存留着半截改动，调用方重试时会被一起写进去，
  一次变更变两次。

## [0.3.2] — 2026-11-18

### 修复（0.3.1 引入的回归，必须升级）
- **保存角色模板 / 角色与模型等设置会报 400**：0.3.1 给配置接口加的「拒绝未知字段」
  规则定得太宽 —— 面板实际是把配置键直接放在请求体顶层（不是包在 patch 里），
  于是被当成未知字段拦下。现在只针对 access 给明确报错（它本来就归权限接口管），
  其它形状恢复原样。

## [0.3.1] — 2026-11-18

### 修复
- **配置接口不再静默忽略写错的字段**：以前往配置接口传了不认识的字段，接口照样返回成功，
  实际什么都没改（排查时很容易误判成"开关坏了"）。现在会明确报 400 并列出不认识的字段名。
- **关掉 shell 执行开关后，shell 用例真的建不出来**：以前关掉只是"不能跑"，用接口仍能建出
  shell 用例 —— 等于安全开关是假的。现在开关关着时，保存链路会丢弃用例里的 shell 定义，
  其它字段照常保存。

### 说明
- 两条都不改变正常用法；只有在"字段名写错"和"想建 shell 用例但开关没开"时才会碰到。

## [0.3.0] — 2026-11-18

### 安全
- **跨站请求被拒绝**：浏览器从别的站点发起的写操作一律 403。正常使用（同站点、curl、服务端互调）不受影响。
- **业务提单查询限流**：查询接口按来源 IP 计数，10 分钟内失败 20 次即返回 429 ——
  以前可以通过编号 + 联系方式后四位穷举出别人的需求。
- **webhook 出站白名单**：目标地址是内网 / 回环 / 云元数据（169.254.x）时默认不发送，
  除非显式写进「测试执行 → 允许的主机」。命中时会在「集成健康」里记一条失败并写明原因。

### 说明
- 这三条都不改变日常用法；限制只在「跨站」「穷举」「往内网发」这三种情况下生效。

## [0.2.8] — 2026-11-18

### 调整
- **顶栏减负**：刷新 / 导出卡 / 导出需求收进「⋯」菜单，顶栏从 8 个同级控件减到 6 个。
  菜单用原生展开控件，键盘与焦点行为跟浏览器一致。
- **间距归位**：页面内边距从 81 种收成 6 档（2 / 4 / 8 / 12 / 16 / 24）。
  相邻两栏、卡片与面板之间的留白现在有固定节奏，不再靠临时调数值。

## [0.2.7] — 2026-11-18

### 调整
- **工作台首屏分两级**：以前 8 个指标平铺（20px 与 18px 差 2px，读不出层级）。
  现在上面 4 个是「今天要处理」——逾期 / 阻塞 / 缺陷超时 / 准出被拦，数字放大到 24px、
  超阈值的标红；下面 4 个是「整体情况」。窄屏自动折成 2×2。
- 两个指标区之间补了间距（原来贴在一起）。

## [0.2.6] — 2026-11-18

### 调整
- **字号收成一套**：以前一页里有 7~10 档字号，最常用的四档是 11 / 11.5 / 12 / 12.5 ——
  两两差 0.5px，看不出层级只觉得数字不齐。现在每页 5~7 档，最小 11px。
- **圆角收成三档**：控件 10px / 容器 16px / 胶囊 999px。以前同屏会出现 8、10、11、12、14、16
  六种圆角，同屏两张卡片的圆角半径不一样。

### 修复
- 主按钮跟随品牌色（上一版遗留的细节：hover 态一并走 token）。
- 键盘 Tab 不再停在卡片内的装饰性元素上（上一版修的是"假按钮"，这版补齐继承判定）。

## [0.2.5] — 2026-11-18

### 修复
- **空态不再是一句话**：看板没有卡时整块提示 +「建第一张卡」；用例库空态加了「去看板开一张卡」
  （原来只说"用例登记在卡片详情的测试里"，没有入口）；需求页的"请用右上角新建"换成就地按钮。
- **主按钮终于跟随品牌色**：以前引用的色值变量全仓库没有定义，回退成了近黑，
  和旁边官方按钮的蓝不同源。
- **GitLab 同步/测试失败现在看得见**：以前错误只渲染在抽屉里，抽屉不开就等于静默失败。
- **键盘 Tab 不再卡在"假按钮"上**：卡片里的 chip 因为继承了父级的 cursor 被误判成可点，
  一张卡能多出 6~10 个按了没反应的停靠点（8 列合计上千个），已修正为 0。

### 其他
- 清掉 16 个已无引用的样式类（25 条规则），产物体积回收约 2 KB。
- 发版流程加自动门禁：`npm run release:check` 会校验 CHANGELOG / compatibility / README 与代码同步，
  改了代码却没改文档会在 CI 里直接失败。

## [0.2.4] — 2026-11-18

### 修复
- **拖卡进「已完成」但准出没过时，界面不再毫无反应**：以前是静默失败（卡弹回去，看着像看板坏了），
  现在会弹出服务端给的具体原因。设计闸门同理。
- **WIP 上限不再能被筛选绕过**：列的占用张数改成按全量任务算（以前取的是筛选后的张数）。
- **切卡后抽屉内容错位**：在 A 卡抽屉里点开 B 卡，会显示 A 卡的内容、保存还把 A 的标题写到 B 上。已修。
- **需求「排序与依赖」保存会覆盖别人的修改**：现在只回写顺序与依赖两个字段，不再整包覆盖标题/正文/功能点。
- **命令面板 Esc**：Tab 到列表项之后 Esc 关不掉了，已修；方向键高亮也会自动滚入可视区。
- **看板滚轮**：列里卡片溢出时滚轮改为滚这一列（以前会把整个看板横向推走）；到边界后页面能正常滚动。

### 安全
- 未启用登录时，**插件安装/卸载、快照恢复、审计日志导出**只允许服务器本机执行（其余管理操作不变）。
- **LDAP 测试**：更换服务器地址必须重新输入口令，不再拿已保存的服务账号口令去连新地址。
- 需求里的外部链接（PRD/原型/验收/文档/云盘）**只接受 http(s)/mailto/站内路径**，堵住 `javascript:` 链接。
- 只读接口不再写审计（以前每开一次卡片抽屉，所有人的页面缓存都会失效）。

## [0.1.47] — 2026-11-17

### 新增
- **GitLab 核对到提交级**：卡上挂了 MR 后点「从 GitLab 核对」，除了文件数与提交数，还会拉**逐条提交**并按 sha 前缀核对——
  自报里有、MR 里没有的提交会被单独点名列出来（不静默覆盖）；流水线有测试报告时连**单测数**一起比，没有报告就只报 CI 任务成败。
- **「补价目」一键跳转**：效能页的成本栏现在写明「币种 / 单位 / 价目来源（已配 N 个模型）」，
  「未配价目的模型」后面多一个入口——点一下跳到设置的成本面板，缺的模型预填成空行，填好单价保存即可算钱。

### 修复
- **空价目行不再算成 ¥0.00**：四个单价全为 0 的行按「未配价」处理（以前当成命中价目表，报表显示 0 元，比"未知"更能骗人）。
- **Windows 上「从链接拉正文」不再误报没有 lark-cli**：npm 装的 `lark-cli` 是 `.cmd` 壳，`spawn` 直接调必然 ENOENT，改成经 `cmd.exe` 调用。
- **拉飞书正文的解析不再吞错误**：JSON 坏掉时以前会静默把整段当正文，现在按「空正文 / 拉取失败 / lark-cli 报错」分别说清楚。

### 改进
- **上千张卡不再每 15 秒重传整包**：`/studio-api/state` 带 `ETag`（数据版本 + 观察者），浏览器轮询带上 `If-None-Match`，
  数据没变就回 **304**、一个字节正文都不发。1000 张卡实测：整包 498 KB（gzip 23 KB）、轮询 304、DOM 只渲染每列 40 张、首屏 594ms。
- **文档纠正**：「需求基线不能回滚」是错的——回滚早就有（正文回到基线、版本号 +1、验收签字作废、历史留痕）；
  飞书链接只认 docx / wiki，云盘的 `file/` 链接会被明确拒绝。

## [0.1.46] — 2026-11-17

### 修复（协作纪律 + 可检查）
- **派单一直坏着**：`buildExpertPrompt` 里裸引用 `activeSkills`，**只要专家配了技能就 ReferenceError**，
  派单直接失败。之前所有演示都没派过单，所以没暴露。改成 `host.getActiveSkills?.()?.get?.(name)`，并补了测试
  （用「任何属性都是空函数」的 Proxy 桩，以后再注入新依赖不用改测试）。
- **协作写进纪律**：`AGENTS.md` 新增 §4.6——一条需求 = 产品澄清 → 架构方案 → 研发实现 → 测试验证，
  每棒都要留评论 + 交付物 + 提交；禁止用 API 伪造执行过程；需求正文要六段（背景/目标/范围/不做/验收/风险）。
- **纪律变成检查**：需求准出新增两条提示——「卡上没有产品/架构专家的讨论（只有自动跑用例的汇总）」、
  「完成的卡上没有任何讨论」。实测：REQ-2026-006（当初脚本直推的那条）被点名，REQ-2026-007 因为新卡有真协作而不告警。

## [0.1.45] — 2026-11-16

### 新增
- **交付物截图能看了**：卡片抽屉里，`ref` 是图片的交付物多一个「看图」，点开是全屏灯箱（fixed 覆盖层，不挤行内布局）。
  图片由 `POST /studio-api/task/artifact/image` 读成 data URL 回传，**只认 `~/.dsh/dsh-studio-artifacts` 目录下的 png/jpg/webp/gif，单张 ≤3MB**；
  实测白名单外（/tmp/evil.png）被拒：「截图必须放在 … 目录下」。不把磁盘路径挂成静态资源，避免开一个只读文件系统通道。

### 改进
- **筛选后自动滚到第一个有卡的列**：以前按需求筛完，视角还停在最左边的空列，已完成的卡在右边要横向拖。
  实测 scrollLeft 0 → 1200，直接落在「已完成」列（注意空列里也有「暂无任务」，要数真卡片不能数子节点）。

## [0.1.44] — 2026-11-16

### 新增（第七条盲点）
- **「通过」要能分出是跑出来的还是手标的**：用例执行会写 `lastRun`，人工改结果不会——
  需求准出据此点名：「N 条用例的「通过」是手工标的、没有执行记录：…（跑一次才算验证过）」。只提示不拦。
  实测：手标 pass → 点名；真跑一次 → 点名消失。

## [0.1.43] — 2026-11-16

### 新增（第六条盲点）
- **跑一条就算验过？** 需求准出现在分开点名：`N 条用例还没跑过：…`、`N 条用例被标成跳过：…（跳过要有理由）`。
  跑过一条是「有证据」的下限（0.1.41 那条 blocker），但一半用例从没跑过同样不该被当成验完——这里只提示，不拦。

### 修复
- `/task/case` 的 add 分支以前**静默成功**：传错 payload（漏 title）加不进去也返回 200，调用方以为建好了。
  现在一条都没加进去就 400：「没有用例被加进去：每条用例至少要有标题」。这是我这轮自己踩到的——记用例结果要用 `action: 'update'`，
  不传 action 会走 add 分支并被静默吞掉。

## [0.1.42] — 2026-11-16

### 修复（第五条盲点）
- **绕过门禁的卡以前是隐形的**：`override` 只写进 history 的一句话，需求准出完全看不到，
  「这张卡是正常完成还是被强推的」没人分得出来。现在 override 记成结构化字段 `task.override = { by, at, reason }`，
  需求准出会列出「N 张卡是绕过准出完成的：REQ-001（客户催，先收口）」。
  只提示不拦——override 本来就是有意开的逃生舱，但交付时必须被看见。

## [0.1.41] — 2026-11-16

### 修复（第四条盲点）
- **零证据交付**：整条需求下一条跑过的用例都没有时，准出门禁拦下——「做完了」和「验过了」是两件事。
  只要求「跑过」（pass/fail 都算），失败由上面那条 blocker 管；实测：卡全完成但没跑用例 → 拦，跑一条后 → 放行。

## [0.1.40] — 2026-11-16

### 新增
- **功能点太虚会提示**：拆卡时如果某个功能点**没有验收标准**（acceptance 为空），提示「写清楚怎么算做完才能长成用例」。
  这是第三种拆卡体检：前两种查关键词（说有后端却没覆盖 / 说没后端却要建表），这一条查结构——
  **写得模糊的需求，关键词体检查不出来，只能看它有没有可验收的东西**。同样只提示不拦。

### 自检
- `e2e-loop` 的功能点补上了验收标准（真实需求本来就有），否则新提示会让「不该有警告」的断言变红。

## [0.1.39] — 2026-11-16

### 新增
- **反向拆卡体检**：澄清里说「没有服务端」，但功能点要建表 / 写接口 / 加鉴权时给提示——
  「要么补上后端，要么把这条改成前端能做的范围」。与「说有大后端却没覆盖后端」那条对称，都只提示不拦。
  实测三态：说没后端+要建表 → 警告；说没后端+只做界面 → 安静；说有后端+要建表 → 安静。

## [0.1.38] — 2026-11-16

### 修复（门禁被绕过）
- **需求签字以前不看自己的准出门禁**：卡全完成就能签，签完自动「已交付」——哪怕门禁明说「还没有产品输出」。
  现在签字前先算 `requirementGate`，有 blocker 直接 400 并逐条列出；确实要提前签可以传 `override` 写原因（与卡片门禁一致）。
- 修这个又暴露第二个问题：门禁把「需求还没签字」当 blocker，而签字动作本身就是在造这个签字——**自己挡自己，永远签不上**。
  改成用「假设本次签字已生效」的副本算门禁。

### 自检
- `e2e-loop` 里补了 PRD 正文与 RICE 打分：新门禁一上，自检立刻红了 3 轮，正好证明这道门是真的在拦。

## [0.1.37] — 2026-11-16

### 新增
- **引擎计量接上了**：派单会话空闲时（`dispatcher.settle`），趁 session 还活着调
  `sessionProjections.stateOf(session, 'tokenMeasurement')`，把引擎自己算的 token 记到卡的 `insight` 上；
  上下文面板的详情里多一行「引擎计量：total 38.7k · 输入 2.0k · 缓存读 36.2k」。
  实测：一次真实派单 60 秒后采到 `totalTokens=38713`（input 1981 / cacheRead 36224 / output 508）。

### 说明
- `tokenMeasurement` 给的是**引擎的 token 总量**（input/output/cacheRead/total），**不是**「工具 vs 助手 vs 输入」的构成拆分；
  构成占比仍是按日志体积估算（面板上两行分开放，来源写清楚）。

## [0.1.36] — 2026-11-16

### 修复（重要）
- **上下文窗口是 1,000,000，不是我猜的 180k**：会话日志里有 `request/context` 事件，带引擎真实的 `contextWindow`（实测 `deepseek-v4-pro` = 1000000）。
  原来按「峰值 >180k 就算接近上限」标注，**是错的**——最忙的专家 227k 也只占 23%。
- 面板改成显示**真实占用率**（峰值 ÷ 窗口）：顶部新增「最高占用 23%」，每行显示 `227k · 23%`，条长按占用率画，≥80% 才标暖色；
  详情行写成「峰值 178k / 窗口 1000k（18%）」。

## [0.1.35] — 2026-11-16

### 新增
- **压缩点标记**：上下文曲线掉下去的那一轮画一条竖虚线，标题写成「压缩 N 次（虚线处掉了 X% / Y%）」；
  判定口径：某一轮比上一轮少 30% 以上算一次压缩（`contextDrops`，纯函数 + 单测）。
  线上暂时没有会话出现过压缩，用一具临时 fixture 会话（260k → 90k）验过渲染：6 个采样点、1 条虚线、掉了 65%，验完已删。

## [0.1.34] — 2026-11-16

### 改进
- **上下文面板重画**：从「一段段文字 + 细条」改成看板式布局——顶部四个指标块（专家 / 会话 / 最高窗口 / 工具喂胖），
  每行「专家 + 模型 · 会话数 · 最近活动」+ 相对峰值条 + 峰值数字 + 重试 + 工具占比，超 180k 与重试 >100 用暖色标出；
  展开后是一条**堆叠构成条** + 两列图例 + 增长曲线（带面积填充）。
- 配色沿用 dsh-context 的视觉语言（`#4A5699 / #C45FA0 / #6277BA / #F39A2B`）。

### 说明
- 没有直接复用 dsh-context 的组件：它的客户端是自注册 bundle（`window.__ModuleLoader__.load({id:'dsh-context'})`），
  包只导出 `Config / apply / inject / name / startFoldWorkerChannel`，没有对外 React 组件。所以是**照它的形态与配色重画**，不是引用它的代码。

## [0.1.33] — 2026-11-16

### 新增
- **「工具喂胖」告警**：专家最近一次会话里工具结果占上下文 ≥60% 时，效能页那一行改成「工具占 X%」并在面板标题上计数
  （`N 个是工具喂胖的`）。阈值可传：`POST /studio-api/contexts { threshold: 35 }`。只提示，不改任何数据——精简工具输出是人的决定。
  线上当前最高 40%，所以默认阈值下它是安静的；用 35% 实测能触发 2 条。

## [0.1.32] — 2026-11-16

### 新增
- **每轮上下文增长曲线**：点开专家后，除了构成占比，还画一条折线——每轮 `input + cacheRead` 的相对高度。
  一路往上说明整个会话没压缩过、上下文一直堆到上限；突然掉下来说明中途压缩过。实测 dev 最近一次会话 17 个采样点，
  从 50 爬到 6（越靠上越大），全程无回落。

## [0.1.31] — 2026-11-16

### 新增
- **单次会话的上下文构成**：在效能页点开某个专家，展开它最近一次会话的构成条——
  系统提示（平台拼的）/ 工具调用与结果 / 助手输出 / 输入与人机往返 / 事件与会话元数据，各占多少百分比与多少千字。
  接口 `POST /studio-api/contexts/session { expert }`。
  口径说明：宿主不暴露真实 token 分配，占比按**会话日志里各类事件的文本体积**估算（约 3 字符/token），是比例不是账目。

### 修复
- 会话日志的 mtime 缓存命中时没带上 `at`，导致「最近一次会话」显示成 `—`（`session-usage.js`）。

## [0.1.30] — 2026-11-16

### 新增
- **上下文洞察（每个专家）**：效能页新增一块，按专家汇总会话数、**上下文窗口峰值**（`input + cacheRead` 的最大值）、
  回合数、工具调用数、模型重试数、最近活动时间；峰值 >180k 标「接近上限」。
  数据来自会话日志（`usage.cacheReadTokens` 就是每轮喂进去的上下文前缀），**读盘不花 token**，接口 `POST /studio-api/contexts`。

### 修复
- 自检把 worktree/分支一起清掉（原来每轮残留 2 个，攒到 27 个）。

## [0.1.29] — 2026-11-16

### 新增
- `npm run selfcheck`：全闭环自检连跑 3 轮看成功率（`--k 3`），约 107 秒；任何一轮失败退出码非 0。
  周检直接跑它即可——定时任务由用户移除，不再自动重建，需要时用 crontab：`0 9 * * 1 cd <repo> && npm run selfcheck`。

## [0.1.28] — 2026-11-16

### 文档
- README 按**读者**重组：登录三节（LDAP / 本地超管 / 会话落库，211 行）拆到 `docs/auth.md`，
  界面五节（shadcn 对齐 / 构建链 / 对话框 / 布局一致性 / 暗色巡检，187 行）拆到 `docs/ui.md`，
  README 从 1264 行降到 896 行。
- 两节准出合并成「准出与验收（卡片 / 需求）」，下设「卡片准出」「需求准出」：原来两个标题几乎一样，
  读者会以为是同一件事（实际是 taskExitGate 与 requirementGate 两道门）。
- 「已知限制」「过程记录」挪到文末，许可证收尾；顶部新增「更多文档」表，一处找齐六份文档。

## [0.1.27] — 2026-11-16

### 文档
- README 末尾补「许可证」：Apache-2.0，指向 `LICENSE`，并写明仓库里不含公司数据、示例地址都是占位值。

## [0.1.26] — 2026-11-16

### 文档
- README 补齐徽标：npm 版本 / 下载量 / 许可证 / Node / DSH 版本（原来只有 CI 一个）。
- 去掉重复的「## 它长什么样」（截图那一节把标题又插了一次，页内锚点永远指向第一个）。
- 新增「它是怎么跑的」mermaid 架构图：浏览器只认 `/studio-api`，状态全在 SQLite，专家是 DSH 会话，
  外部系统只被平台调用。
- 8 节按日期的**实现流水账**（体检 / 补完 / UI 收尾等，约 225 行）移到 `docs/history.md`，README 从 1471 行降到 1247 行。
  注意：README 里其余带日期的小节是**现行功能文档**（准出规则、抽屉布局、矩阵），只是写在那个日期，没有动。

## [0.1.25] — 2026-11-15

### 修复
- 团级经验的聚类太严：`提交前忘了跑 pnpm build` 和 `提交前忘了跑 pnpm build 了` 被当成两条（各出现 1 次，
  于是永远组不成「反复出过的问题」）。改成按二元组 Jaccard 相似度聚类（≥0.6 算同一条），措辞变化不再漏掉。

## [0.1.24] — 2026-11-15

### 新增
- **团级记忆开始影响派单**：同一条经验在团里出现 ≥2 次，会自动提炼成「这次先规避」的约束，
  跟最近 5 条记忆一起拼进专家提示词。以前只记不用——记下来却不回流，等于没记。

## [0.1.23] — 2026-11-15

### 新增
- **多维表格镜像**：`POST /studio-api/feishu/mirror`（可选 `dryRun`）把卡片写成飞书多维表格记录，
  一条记录一张卡、200 条一批串行写；字段：编号 / 标题 / 状态 / 负责人 / 优先级 / 需求 / 更新时间。
  没配表、没装 lark-cli、没授权都会如实报错，失败不写假成功。

## [0.1.22] — 2026-11-15

### 新增
- **缺陷严重级跟着用例优先级走**：p0 用例失败 → 缺陷 p0/紧急，p3 → p3/宽松；卡已经在「已完成 / 待验收」
  上失败说明是回归，严重级再升一级（p0 封顶）。以前一律 p2，验收用例挂了和错别字同级。
- **角色模板可编辑**：设置 → 团队 → 专家 顶部新增「角色模板」（产品 / 架构 / 研发 / 测试 的角色名、模型、提示词），
  改完影响以后新建的专家；以前只能改配置文件。

## [0.1.21] — 2026-11-15

### 新增
- **需求基线可回滚**：点「回滚到基线」把 PRD 正文恢复成基线那一版，版本号 +1（v1.0 → v1.1），
  **验收签字作废**，并在历史里留一条「PRD 回滚」。回滚是实质变更，不能悄悄改。

## [0.1.20] — 2026-11-15

### 新增
- 拆卡时检查「说了有服务端，功能点却没有一条讲接口 / 数据表 / 鉴权」，命中就在结果里给一句提示（**不拦**，
  后端可能确实在别的需求里）。三问是门禁，这条是体检。

## [0.1.19] — 2026-11-15

### 新增
- **需求澄清三问**：有没有服务端 / 鉴权谁做 / 交付边界。需求表单里必须填，**没答完不让拆卡**
  （提示会逐条列出还缺什么）。起因：做「管理后台」时只交付了前端 + 内存 mock，
  还把缺口写进签收记录当「遗留」，等于用文档把没问清楚的东西合法化了。

### 修复
- 需求更新时的字段白名单漏了 `discovery`，导致「先建需求、之后再补答三问」保存不上——
  这就是「白名单第五处」；补了一条真库回归测试（建 → 补答 → 读回）。

## [0.1.18] — 2026-11-15

### 修复（都是拿真实项目跑全闭环才暴露的）
- **worktree 基准分支写死 main**：用 master 的仓库直接 `git worktree add` 失败，卡片永远没有工作树、代码事实也永远核不了。
  现在先确认配置的分支存在，不存在就退回仓库当前检出的分支。
- **纯 shell / 数据库用例被测试环境挡住**：`/task/case/run` 在跑之前就要求测试环境可达，只有 shell 用例的卡直接报错。
  现在只有接口用例才探环境，报错文案也区分三种执行方式。
- **worktree 分支按卡号命名会撞车**：两条需求都会拆出 REQ-001，git 不允许同一分支挂两个 worktree，第二次就失败。
  分支与目录改成「卡号 + 任务 id 后 8 位」。

### 新增
- `tools/e2e-loop.mjs`：一条命令跑完 需求评审 → 拆卡 → 各列推进 → 自动代码事实核对 → 用例真跑 → 验收签字 → 需求交付 → 版本发布。

## [0.1.17] — 2026-11-15

### 文档
- 截图从 3 张（看板 / 用例 / 效能，还是 11-13 的旧界面）补到 **10 张**：工作台、看板、卡片抽屉、需求、用例、版本、效能、
  设置·测试执行、设置·成本与预算、设置·专家。
- 截图不再手截：`npm run shots`（`tools/visual/capture.mjs`）登录面板后逐页签截图，并断言没有「渲染失败」。

## [0.1.16] — 2026-11-15

### 文档
- quickstart 里 `npm test` 写着「77 条测试」（实际 94），条数不再写死；冒烟命令补上 `STUDIO_BASE`——
  远程主机上漏了它只会连本机 127.0.0.1，得到的是一句 ERR_CONNECTION_REFUSED。
- quickstart 增加「没有 GitLab 令牌也能验」的两条命令（打桩 + verify-gitlab-facts）。
- AGENTS 常见故障加一条：用脚本改文档时文本里的反引号会截断模板字符串，编辑一句都不执行却只报个 ReferenceError。

## [0.1.15] — 2026-11-15

### 文档
- 清掉三处已经过期的「已知限制」：成本说「未接入」（0.1.12 已接）、说「没有回归套件这个对象」（已支持）、
  说「不同步流水线状态」（核对时已拉 pipelines 接口）。README 的指标表、成本来历、GitLab 限制、用例段一起改。

## [0.1.14] — 2026-11-15

### 修复
- 效能页「AI 执行成本」下方还挂着老文案「宿主没有回传 token 用量」——和上面刚显示的 token 数字自相矛盾。
  现在改成说明口径（token 读会话日志、钱要有价目表），quality 摘要里的同一句话和 README 也一起改了。

## [0.1.13] — 2026-11-15

### 新增
- 设置 → 成本与预算多了**价目表编辑器**（模型 / 输入 / 输出 / 缓存读，加减行、单独保存）。
- `/costs` 的 `usage` 增加 `unpricedModels`：直接列出「哪个模型还没配价目、被调用了多少次」，
  效能页也会显示这一行，不用再猜该补哪些。

### 修复
- 保存预算时会把价目表一起带上——之前只提交三个预算字段，`sanitizeCosts` 会把没传的 prices 当成空表清掉。

## [0.1.12] — 2026-11-15

### 新增
- **真实 token 成本**：`GET /costs` 增加 `usage`（读 `session.v4.jsonl.zstd`），按卡 / 按专家汇总入、出、缓存读、缓存写；
  效能页「AI 执行成本」显示 `token 用量` 与 `预估花费`。
- `config.costs.prices` 价目表（元 / 百万 token）：配了才算钱，没配的模型记「未知」，不按 0 算；订阅通道记 token 不计钱。

## [0.1.11] — 2026-11-15

### 新增
- 需求页「需求变更影响面」：一键算出这条需求下面有多少张卡、多少条用例要重看，
  并列出受影响的卡（接口 `POST /requirement/impact`）。

### 修复
- 影响面里的「能自动跑」以前只认接口用例，shell / 数据库用例一律算成手工；
  现在与执行器一致（三种都算能自动跑）。

### 文档
- README 新增「成本口径」七条（只统计 studio-* 会话、订阅通道不计钱只计 token、按 turn 记、三级汇总、缓存分开记、价目表按当时、拿不到就不写 0）。

## [0.1.10] — 2026-11-15

### 修复
- **shell / 数据库用例跑不了**：抽屉的「▶ 跑」按钮与用例库的勾选只认接口用例，
  另外两种建得出来却没入口。现在按 `runnable`（接口 / shell / 数据库任一）判断，
  按钮文案改为「跑用例」，用例库行内标签显示 shell / 数据库。
- **`coding.gitlab` 写了看不见**：GitLab 核对结果只在弹窗提示里出现一次，刷新即消失；
  现在「执行记录」里常驻一行「上次 GitLab 核对 …：文件 2→3 · 提交 1→3 · 流水线 success」。

### 新增
- `regression/finished` 事件带上 `truncated`，外部系统能区分「跑完了」和「只跑了一部分」。
- 设计评审对话可以顺带录入两个工具产出的数字（还原度百分比、规范野值数）。
- 老派单记录按角色归并：一个角色只有一位专家时才归到他名下，有歧义就不猜。
- webhook 一个事件都不勾时，界面上明确写「订阅全部事件」。

## [0.1.9] — 2026-11-14

### 新增
- 准出门禁里会提示「代码事实核对不通过：N 个提交 / M 个文件在仓库里找不到」。
  **只提醒，不拦**——要不要拦是产品决定，代码里留着开关的位置。

## [0.1.8] — 2026-11-14

### 新增
- 卡片进入「待评审」时**自动核对代码事实**：agent 自报的提交 / 文件，和 worktree 的 git 记录比对，
  结果写进 `coding.verified` 与卡片的 history；对不上时发 `gate/blocked` 事件。

### 注意
- 核对依赖 worktree；**卡片没挂业务项目时工作树建不出来**，此时会明确写「代码事实没法核对」，
  不会假装通过。

## [0.1.7] — 2026-11-14

### 新增
- webhook 每次投递的结果进「集成健康」（成功 / HTTP 码 / 错误信息、失败次数）。

## [0.1.6] — 2026-11-14

### 新增
- `regression/finished` 事件：一批用例跑完（含夜间定时）发出卡数 / 条数 / 通过 / 失败 / 自动开缺陷。
- 数据库用例可以指定「断言哪一列」，不再固定 `n`。

## [0.1.5] — 2026-11-14

### 新增
- `agent/failed` 事件（派单失败，含次数与是否耗尽重试）。
- 设置 → 测试执行：**执行开关**（shell / 数据库用例，默认都关）、**数量上限**、**出站 webhook**
  （地址 + 启用 + 按事件订阅）。
- 卡片抽屉的「＋ 数据库」入口。

## [0.1.4] — 2026-11-14

### 新增
- **SQLite 用例**：`db { file, sql, params, expectRows, expectColumn, expectValue }`，
  默认只读打开，需 `config.testing.allowDb`。
- **出站 webhook**：卡片流转 / 用例失败 / 门禁拦截 / 派单失败推给外部系统（不重试、5 秒超时）。
- **可配置上限**：`config.limits` 取代硬编码的 60 / 60 / 40。
- **执行器注册表**：`registerRunner(kind, { match, run })`，加新执行方式不用改 `runOneCase`。

## [0.1.3] — 2026-11-13

### 新增
- **shell 用例**：跑一条命令，断言退出码与输出（`expectContains` / `expectNotContains`）。
  默认关闭（`config.testing.allowShell`）——打开等于允许看板在宿主机执行任意命令。

## [0.1.2] — 2026-11-13

### 修复
- 卡片**挂不上 MR**：`gitlabMR` 被文本归一化器压成空字符串，只能等 GitLab 同步。
- **换列清空负责人**：列负责人是候选池（id 为空）时，每次换列都把 `task.expert` 抹掉，
  连带把「按专家看质量」的卡数算少。
- **三处静默截断**（用例 60 / 批量跑 60 / 交付物 40）改成明确报错；套件超限仍继续跑但标 `truncated`。
- 设计还原度只留最新一次 → 存最近 10 次并显示趋势。
- 设计规范体检只给数字 → 附带「哪个元素在违规」。

## [0.1.1] — 2026-11-13

### 变更
- README 加三张真机截图，npm 页面可见。
- 默认值与文档去掉公司内网信息（LDAP 默认值、部署示例、探针默认地址）。

## [0.1.0] — 2026-11-13

首个公开版：角色化多智能体看板、需求基线、用例与回归、效能度量、设计评审、GitLab / 飞书联动。

## 已知限制

- **代码事实核对依赖 worktree**，而 worktree 依赖卡片挂在业务项目上；没挂项目的卡无法核对。
- **GitLab 集成未接真实令牌**：MR 回写、流水线状态只做过模拟验证。
- **飞书机器人**：夜间回归的结果靠 `regression/finished` webhook 外发，飞书多机器人一直没配起来。
- **成本**：token 用量已从会话日志读出（0.1.12），但**价目表要自己配**；没配的模型记「未知」而不是 0。
- **规模**：看板每列先渲染 40 张（「显示更多」翻页），500+ 卡的性能未实测。
- **权限**：只有 read / write / admin 三档，没有 SSO 与细粒度 RBAC。
