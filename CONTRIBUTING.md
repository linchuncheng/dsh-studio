# 参与贡献

这个仓库是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的一个插件
（需求&任务工作空间），宿主半边跑在 DSH 进程里，浏览器半边是一个侧栏面板。

**先说明一条原则**：本项目不接受「改完看着差不多」的贡献 —— 改动必须能**在真实浏览器与真实 dsh 上验证**，
验证不出来的改动不算完成。下面每一条都是门槛，不是建议。

---

## 1. 本地起环境

需要 Node ≥ 22（仓库里用到的 `node:sqlite`、`node --test` 都是较新的 API）。

```bash
git clone https://github.com/marsken88/dsh-studio.git
cd dsh-studio
npm install                      # 只有 devDependencies（puppeteer-core / ssh2 / pngjs…）

npm test                         # 契约测试：manifest / 产物一致 / 跨模块导入 / 文档同步…
TZ=UTC npm test                  # ← 必须也跑这一遍，见第 3 节
```

前端产物是**提交进仓库**的（`dist/client.js` + 根 `client.js`），所以 clone 下来就能被 dsh 加载，不需要先构建。
改了前端才需要重新构建：

```bash
cd web
pnpm install --frozen-lockfile
pnpm build        # make-legacy → guard --pre → vite build → sync-client → guard --post
cd ..
cmp -s dist/client.js client.js && echo same   # 必须一致
```

## 2. 代码放在哪

| 改什么 | 放哪里 |
| --- | --- |
| 宿主逻辑（路由、工具、派单） | 新逻辑**优先放 `src/host/**`**；`index.js` 只做装配，硬上限 2700 行 |
| 纯函数（口径、判定、清洗） | `src/host/*.js`，单文件上限 2000 行；每个模块顶部写清「这个口径是什么」 |
| 前端逻辑 | `client.src.js`（无 JSX 的 `h()`） |
| 样式与组件 | `web/src/**` |
| 文档 | `README.md` / `docs/**`，改动用户能感知的行为时**必须同步** |

两条容易踩的约定：

- **样式**：颜色用实色，不要 `hsl(var(--primary))`（部分子树解析不到会让主按钮退化成纯文字）；
  弹层必须走 Radix Portal 且容器带 `data-dsh-studio`，否则样式失效（表现为「弹窗存在但看不见」）。
- **模块依赖方向**：子模块不得反向 `import index.js`（会成环）。需要宿主能力时用
  `configureDispatcher()` / `configureExecutor()` 注入。

## 3. 提交前必须过的门槛

```bash
node --check index.js && node --check client.src.js
npm test                 # 全绿
TZ=UTC npm test          # 全绿 —— CI 在 UTC 里跑，本地在 Asia/Shanghai
```

> **为什么单独强调 `TZ=UTC`**：测试里写 `new Date('2026-11-16T00:00:00+08:00')` 这种带时区的字面量，
> 本地通过、CI 必挂（0.8.0 就是这么挂的）。请用本地构造器 `new Date(2026, 10, 16)`。

改了前端再加上这两条：

```bash
cd web && pnpm build && cd ..
cmp -s dist/client.js client.js && echo same
```

改了文档相关的东西（脚本清单、版本号、行为描述）：

```bash
npm run release:check
```

**不要为了让测试通过而放宽断言。** 契约测试里那些「必须等于」的检查（产物一致、patch 里的包名等于包名、
AGENTS.md 列出每个 host 模块、config 白名单不漏键）每一条都对应一次真实事故；
觉得某条不对，请单独提 issue 讲清为什么，而不是顺手改弱它。

## 4. 提交信息与分支

**开发工作流（必须按这个顺序，不许跳步）**

| 步 | 做什么 | 完成的判据 |
| --- | --- | --- |
| 1 | **在 git worktree 里开发**：从 `main` 拉一条 `fix/…`、`feat/…`、`docs/…` 分支并开独立 worktree | `git worktree list` 能看到；改动不落在主检出上 |
| 2 | 写代码 + 写测试 | 改动带测试；没有测试要在 PR 里说明为什么不需要 |
| 3 | **测试通过** | `npm test` 与 `TZ=UTC npm test` 全绿、`node --check`、`npm run verify:tdz`；改前端再加 `cd web && pnpm build` 与 `cmp dist/client.js client.js` |
| 4 | **审核完成** | 自查清单 + 证据贴进 PR 正文；有第二个人时由他 approve。**评审没过不许提 PR** |
| 5 | **提 PR** | `gh pr create`，正文写现象/根因/验证方式 + 检查清单结果 |
| 6 | **合并主干 → 构建与发布** | PR 合并后 CI 必须绿；再打 tag `vX.Y.Z` 触发 `release.yml` 与镜像流水线，最后 `npm run verify:release` 必须「发版一致」 |

- **不许直接往 `main` 推代码**：改了就在 worktree 分支上提交、开 PR。
- 分支：`fix/…`、`feat/…`、`docs/…`、`ci/…`，一个 PR 只做一件事。
- 提交标题一句话说清做了什么，与既有历史保持同一风格（中文/英文都行，本项目主要用中文）。
  正文写**为什么**：现象、根因、你验证的方式。
- 涉及行为的改动，PR 里请附**验证证据**：命令与输出、截图、或真机探针的结果。

## 5. PR 检查清单

见 [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md)。CI（`.github/workflows/ci.yml`）
会跑语法 → 契约 → 前端构建 → 产物一致性，红了就是不能合。

## 6. 报问题

- **功能缺陷 / 异常行为**：用 [Bug 报告模板](https://github.com/marsken88/dsh-studio/issues/new?template=bug_report.yml)。
  请带上 dsh-studio 版本（`npm view @marsken/dsh-studio version` 或面板里的版本号）、DSH 版本、`dsh` profile 名。
- **功能建议**：用 [功能请求模板](https://github.com/marsken88/dsh-studio/issues/new?template=feature_request.yml)。
- **安全问题**：**不要开公开 issue**，见 [SECURITY.md](SECURITY.md)。

贴日志时请**先脱敏**：`/studio-api/state` 里有成员名单，`?token=…` 是登录凭据，
`~/.dsh/dsh-studio.secrets.json` 里是令牌。这些都不要贴出来。

## 7. 行为准则

参与本项目即表示你同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)（Contributor Covenant 2.1）。

先看 [README](README.md) 的功能与安装说明，再看 [docs/product.md](docs/product.md) 决定一件事该不该做
（那里写明了 V1 范围与**明确不做**的清单）。新功能先讨论再动手，比写完被拒更省时间。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
