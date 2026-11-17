# 界面：样式与构建链

从 README 拆出来的界面实现记录。要看界面长什么样，回 [README](../README.md) 看图。

## 样式对齐 shadcn/ui（2026-11-09）

参考 <https://ui.shadcn.com/> 的默认主题（zinc / neutral），把整套界面换成它的视觉语言。
**没有引入 Tailwind，也没有加构建步骤**——仍然是一个 `client.js`，在原有 `<style>` 末尾追加
一层「token + 组件规则」，用同名变量覆盖旧样式，所以不会破坏既有功能。

### 为什么不是直接装 shadcn 组件

shadcn 是「把 React + Tailwind 源码拷进项目」的分发方式，需要构建管线（Tailwind 编译、
tsconfig 路径别名、Radix 依赖）。这个插件是宿主里的单文件 bundle（`window.__ModuleLoader__`
+ `React.createElement`），加构建会破坏现在的零依赖部署方式。因此这里对齐的是**设计系统本身**：
同一套 CSS 变量名、同一套圆角/描边/阴影/焦点环尺度、同样的组件外观。

### Token

```css
[data-dsh-studio][data-theme="light"] {
  --background:#fafafa; --foreground:#09090b;
  --card:#ffffff;       --primary:#18181b; --primary-foreground:#fafafa;
  --secondary:#f4f4f5;  --muted:#f4f4f5;  --muted-foreground:#71717a;
  --destructive:#dc2626; --border:#e4e4e7; --input:#e4e4e7; --ring:#a1a1aa;
}
[data-dsh-studio][data-theme="dark"] {
  --background:#09090b; --foreground:#fafafa;
  --card:#111113;       --primary:#fafafa; --primary-foreground:#18181b;
  --secondary:#1b1b1f;  --muted:#1b1b1f;  --muted-foreground:#a1a1aa;
  --destructive:#ef4444; --border:#27272a; --input:#27272a; --ring:#52525b;
}
```

旧的 `--ds-*` 变量保留，但都指向新 token（`--ds-bg→--background`、`--ds-surface→--card`、
`--ds-surface-2→--muted`、`--ds-line→--border`、`--ds-accent→--primary`、`--ds-shadow`），
所以几百处既有样式不用改。统一圆角 `--radius:10px`。

### 逐项检查过的组件

| 组件 | 处理 |
| --- | --- |
| 按钮 `.ds-btn` | shadcn `Button` 默认档：32px 高、12px 内边距、1px `--input` 描边、`--card` 底、`--muted` hover、圆角 10、`--ds-shadow` |
| 主按钮 `.ds-btn-primary` | `bg-primary + text-primary-foreground`（浅色近黑、深色近白） |
| 幽灵按钮 `.ds-btn-ghost` | 透明底、hover 出 `--muted`，用于「退出登录 / 导出」 |
| 输入框 `.ds-input/.ds-select/.ds-textarea` | 1px `--input`、32px 高、hover 变 `--ring`、focus 出 `0 0 0 3px ring/35%` 光晕 |
| 卡片/面板 `.ds-panel/.ds-card/.ds-kpi` | `--card` 底 + 1px `--border` + `--ds-shadow`，圆角 12 |
| 徽标 `.ds-chip` | 21px 高胶囊，`--secondary` 底 + `--border`，语义色（缺陷/超时/通过）保留色相 |
| 页签 `.ds-tabs/.ds-tab` | shadcn `Tabs` 胶囊：`--muted` 容器，选中项 `--card` + 阴影 |
| 分段控件 `.ds-seg` | 同款胶囊，用于主题三档与登录方式切换 |
| 看板 `.ds-col/.ds-card` | 列底 `--muted` + 描边；卡片白底、13px 标题、11px 元信息 |
| 抽屉/弹窗 `.ds-side/.ds-drawer/.ds-modal` | `--card` 底、1px 描边、大阴影、遮罩 `rgb(9 9 11 / .5)` |
| 表格化行 `.ds-listrow/.ds-doc-row/.ds-audit-row` | 行间 1px `--border`，hover 出 `--muted` |
| 登录卡 | `Card` 同款：描边 + 20px 阴影 + 圆角 14 |
| 焦点环 | 全局 `:focus-visible` → `2px solid --ring`，offset 2（键盘可达性那层仍然生效） |
| 滚动条 | 拇指用 `foreground 20%/32%` 透明色，两套主题都可见 |

### 验证

- 浅色：工作台（KPI、分区、清单）、看板（列/卡片/徽标）、项目卡、设置-专家列表逐一截图核对。
- 深色：截图整页平均亮度 **23.2**（浅色约 **246**），卡片/描边/文字在 `#09090b` 上可读。
- 登录页、抽屉、表单沿用同一套 token，未单独写样式分支。

## 构建链：真实 shadcn/ui（2026-11-09）

前面几版是「手写一套 shadcn 风格 CSS」。现在 `dsh-studio/web/` 是一个真正的 Vite + Tailwind + Radix 工程，组件按 shadcn 官网源码 vendored 进来。

### 为什么需要构建，以及为什么要桥接

- 宿主只提供 `window.__ModuleLoader__.load({ id, factory })` 这个入口，`factory` 里 `require('react')` 拿到的是**宿主的 React**。
- shadcn/Radix 需要 React 18 的 hooks dispatcher，且组件在自己的树里跑；两棵 React 树不能共享渲染。
- 所以：React 打进插件自己的 bundle，宿主那边只渲染一个**类组件桥**（`web/src/bridge.jsx`，无 hooks），桥里用一个 `div`（`display:contents`）承载我们自己的 `createRoot`。两棵树互不干扰，元素对象靠 `Symbol.for('react.element')` 互通。

### 目录

| 路径 | 作用 |
| --- | --- |
| `web/vite.config.mjs` | IIFE、单文件 `../dist/client.js`、`cssCodeSplit:false`、`inlineDynamicImports` |
| `web/tailwind.config.js` | `corePlugins.preflight=false`（CSS 会注入宿主页面，不能带全局 reset）、`darkMode:['selector','[data-theme="dark"]']`、颜色映射到 shadcn 的 HSL 变量 |
| `web/src/index.css` | shadcn token（浅/深两套），作用域限定在 `[data-dsh-studio]` 与 `[data-dsh-studio-portal]`（Radix 浮层会被传送到 `<body>`） |
| `web/src/components/ui.jsx` | vendored 原子组件：Button/Input/Textarea/Label/Card/Badge/Tabs/Dialog/Switch/Checkbox |
| `web/src/components/login-gate.jsx` | 第一个真正替换的界面：登录卡片（Card + Tabs + Input + Button） |
| `web/src/bridge.jsx` | 宿主 React ↔ 自带 React 的类组件桥 |
| `web/src/main.jsx` | 入口：注入 Tailwind CSS、注册 `window.__ModuleLoader__.load` |
| `web/scripts/make-legacy.mjs` | 把 `dsh-studio/client.src.js`（手写源码）转成 `web/src/legacy.js`（去掉 loader 包装，导出 `createStudio(React, h)`） |
| `web/scripts/sync-client.mjs` | 构建后把 `dist/client.js` 复制回包根的 `client.js`，保证「仓库里的 `client.js` = 线上实际加载的那份」 |

### 构建与部署

```bash
cd dsh-studio/web
pnpm install          # pnpm 10 默认拦 esbuild 的构建脚本，首次可能提示 approve-builds
pnpm build            # make-legacy → vite build → sync-client，一次跑完
```

三个文件的关系：

| 文件 | 是什么 | 谁读它 |
| --- | --- | --- |
| `client.src.js` | 手写的单文件源码（约 520 KB，前端逻辑全量实现） | 构建第一步 `make-legacy.mjs` 读它生成 `web/src/legacy.js` |
| `dist/client.js` | Vite 产物：单文件 IIFE，React 与 CSS 都打进（约 696 KB / gzip 207 KB） | 部署时上传它就是根目录 `client.js` 的来源 |
| `client.js`（包根） | 构建产物的副本，由 `sync-client.mjs` 写出 | DSH 按 `package.json` 的 `./client` 导出加载它 |

所以：**只改前端逻辑 → 改 `client.src.js`；改样式/组件 → 改 `web/src/**`**；两边都要在 `web/` 里跑一次 `pnpm build`，根目录 `client.js` 会自动同步，然后提交。

部署到另一台机器只需要 `index.js` + `dist/client.js` + 整个 `src/host`：用 `node tools/deploy.mjs`（目标机、账号从环境变量传，脚本会备份、自检、`active` 不对就非零退出），具体命令见 `docs/quickstart.md`。

### 已验证

- 构建产物 `526 kB`（gzip 161 kB），单文件、无独立 CSS 资源。
- Chrome 实测：刷新后登录卡是新组件（胶囊页签 + 圆角输入框 + 黑色主按钮），切「本地超管」后直接打字即可，`admin`/`admin` 登录进入工作台，主题切换与看板正常。
﻿
---

## 对话框与列表行（2026-11-10）

原生 `window.confirm` / `window.prompt` 已全部换成 shadcn 风格的 Radix Dialog，23 处调用点（删除卡/需求/版本/专家/专家团/环境/项目/仓库/机器人/技能/文档/功能点、市场移除、插件装卸、清空审计、快照回滚、worktree 回收、标记阻塞、改领域、强制发布、回滚原因、评审打回）。

- `web/src/components/studio-ui.jsx` 的 `DialogBox({ open, title, message, danger, okText, cancelText, input, value, placeholder, onChange, onOk, onCancel })`：标题 + 说明 + 「取消 / 确定」，`danger` 时确定按钮用破坏色，`input` 为真时带 3 行文本域（用于「强制发布原因」「回滚原因」这类需要写理由的场合）。
- `client.js` 的 `confirmDialog(message, options)` / `promptDialog(message, options)` 返回 Promise，`DialogHost` 挂在工作区根节点上；没有 UIKIT 时自动回落原生弹窗，保证纯单文件产物仍可用。
- 列表行统一：`.ds-listrow` 内按钮 26px 高、幽灵按钮 hover 才显形；`[data-danger="1"]` 的按钮红字 + 淡红 hover；`.ds-audit-row` 行高 7/14；窄屏（≤900px）缩小 spark 日期字号、≤760px 隔天显示，避免 14 个标签挤成一排。

### 踩过的坑：Radix 门户跑出作用域

Tailwind 产物被 `web/scripts/scope-css.mjs` 改写成 `[data-dsh-studio] .fixed …`；而 Radix 的 Portal 默认挂到 `document.body`，门户里的元素不在这个子树里，定位类全部失效，弹窗会掉到页面末尾变成一段普通文本流（UIA 能读到文字、肉眼看不见）。

修法两处：① 作用域插件同时产出 `[data-dsh-studio-portal] …` 前缀；② `studio-ui.jsx` 提供 `portalRoot()` 懒创建一个带 `data-dsh-studio-portal` + `data-theme` 的容器，四个 Portal（Dialog ×2、Select、Tooltip）都用 `container={portalRoot()}` 挂进去，明暗主题随工作区同步。
﻿
---

## 布局与 Markdown 一致性（2026-11-10）

这一轮修的是「看起来哪里都不对」的根因，而不是逐个页面调参数。

### 1. 同名 CSS token 被两种格式覆盖
- `web/src/index.css` 里 shadcn token 原本是 HSL 三元组（`--border: 240 6% 90%`），约定 `hsl(var(--x))`；
  legacy `client.js` 又把同名变量定义成 hex（`--border:#e4e4e7`），特异性更高、注入更晚。
- 结果：所有 `hsl(var(--x))` 变成 `hsl(#e4e4e7)`，声明非法被丢弃 —— 列底色透明、卡片描边消失、按钮没底色。
- 修法：**全站统一为 hex + 裸 `var(--x)`**。`tailwind.config.js` 19 处、`index.css` 92 处、`client.js` 1 处；
  `hsl(var(--x) / a)` 改写成 `color-mix(in srgb, var(--x) N%, transparent)`。判断依据是页面内
  `getComputedStyle(el).getPropertyValue('--border')` 返回的是 `#e4e4e7` 而不是三元组。

### 2. `.ds-row` / `.ds-field` 只有 min-width，没有 display
- 全站 97 处 `ds-row`、151 处 `ds-field`，布局原本靠行内 `style={{ gap, alignItems, flex }}`；
  但 CSS 里这两个类只有 `min-width:0`，于是它们退化成块级堆叠 —— 专家编辑里标签和控件互相压住。
- 修法（`index.css`）：
  `[data-dsh-studio] .ds-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;min-width:0}`、
  `[data-dsh-studio] .ds-field{display:flex;flex-direction:column;gap:5px;min-width:0}`、
  `.ds-row > .ds-field{flex:1 1 220px}`；字段内的 `.ds-hint` 取消 `margin-left:auto`。

### 3. uiKit 缺 Input / Textarea，多行输入只剩 32px
- `web/src/main.jsx` 的 `uiKit` 只注入了 SheetDrawer/TabsBar/SelectBox/SwitchBox/Tip/ProgressBar/DialogBox/Badge，
  `kit('Input')`、`kit('Textarea')` 全是 null → 112 处 TextField、14 处 TextAreaField 回落成原生控件。
- 原生 textarea 又被表单 reset 清了 padding，`rows=9` 实测只有 32px 高（角色提示词框就是这个）。
- 修法：uiKit 补 `Input, Textarea, Label`；`TextAreaField` 不再丢弃调用方 className，
  并按 `rows` 计算 `minHeight = max(84, rows*21+26)`（9 行 → 215px）。

### 4. Markdown：输入处给预览，展示处统一渲染
- 新增 `MdField`（`client.js`，在 `tipLabel` 之前）：工具行「支持 Markdown：标题 / 列表 / 粗体 / 代码块 / 表格」+
  「预览渲染 / 回到编辑」切换，预览复用 `renderMarkdown()`。
- 换用位置：需求正文、文档正文、交付物正文、技能正文、任务需求/背景、功能点说明、发布说明。
- 展示处保持渲染 Markdown 的：需求明细、功能点说明、评论、发布说明（复制前可预览）。
- 验收方式：无头 Chrome 打开「需求 → 编辑」，`.ds-md-bar` 存在、textarea 219px、点「预览渲染」后
  `.ds-md-preview` 出现且 `li` 数量与原文条目一致。

### 5. 看板列与滚轮
- `.ds-col` 实色底 + 1px 描边 + `scroll-snap-align:start`；`.ds-col-head` 卡片底色；`.ds-card{min-width:0;max-width:100%}`。
- 滚轮改原生 `{ passive:false }` 监听（React 的 onWheel 在 root 上是 passive，`preventDefault` 无效），
  命中 `.ds-board` 时把 `deltaY` 转成 `scrollLeft`。
﻿

## 直接阅读与暗色巡检（2026-11-10）

### A. 交付物 / 文档正文可直接展开阅读

- 交付物：`artRead` 状态记「当前展开的交付物 id」，行按钮「阅读 / 收起」；展开区 `.ds-md-preview.ds-reader`（`max-height:360px; overflow:auto`）用 `renderMarkdown(content)` 渲染，空正文提示「这条交付物还没有正文。」
- 文档：`docReader` 状态 + `readDoc(docId)`——点「阅读」时按需 `POST /studio-api/requirement/get` 取回完整 `docs[]`（列表接口只给 `contentLength`），再渲染 Markdown；读取中显示「读取中…」，空正文提示「这条文档还没有正文。」；再点「收起」关闭。
- 实测：TEST-002 卡片 → 交付物 → 阅读，`.ds-reader` 高 360、65 个块；需求 `REQ-2026-001` → 文档 → 阅读，`.ds-reader` 高 235、5 个块、正文以「会员积分抵扣背景…」开头。

### B. 暗色逐页巡检（明亮 + 黑暗各一遍）

- 巡检方式：`tools/visual/probe-dark-sweep.mjs`（headless Chrome 登录 → 挂载面板 → 逐页签截图 + 采集 `getComputedStyle`），截图落在 `tmp/dark-*.png` / `tmp/dark2-*.png`。
- 修复：看板工具栏 `.ds-board-bar` 之前被压成 `padding: 0 0 10px`，第一个搜索框紧贴面板左边缘、看着像被裁掉；改成 `padding: 12px 20px 10px; border-bottom: 1px solid var(--border)`，与看板列的 20px 内边距对齐，工具行与内容之间也有分隔线。
- 复核：看板（列底 `--muted`、列头 `--card`、卡片描边与文字 `rgb(230,232,238)`）、版本（面板/操作区/发布按钮）、效能（KPI 卡、柱状与日期轴、燃尽折线）、项目（整行卡片、统计框、服务行 chip）、市场（专家卡与角色 chip、空态虚线框）、需求（评审、矩阵、文档、变更影响）六页在暗色下均无白底突兀、无不可读文字。
- 已知边界：无头 Chrome 未装 emoji 字体，截图里 📎 ✅ 之类的图标会显示成空心方块，这不是页面问题。


## 换骨：把 BoardUI 的组件源码真接进来（2026-11-17）

不是照着图重画，是把 [BoardUI](https://www.boardui.com/zh-hans/installation) 的**源码文件原样复制**进仓库，再让我们的调用点去用它。
免费组件 MIT（保留头注释），Pro 组件不买，需要的话自己实现等价物。

### 通道
- 源码落在 `web/src/components/base/**`（`buttons/`、`input/`、`textarea/`、`checkbox/`），一行没改；
  `web/src/utils/{cx,directional-icon}.ts` 是它们的工具依赖，同样原样。
- `web/vite.config.mjs` 加了 `@ -> web/src` 别名，esbuild/vite 直接吃 `.tsx`，不需要 tsconfig。
- Tailwind v4（`@tailwindcss/postcss`）+ `web/src/boardui/theme.css` 的 315 个 token 提供它们的视觉变量；
  preflight 保持关闭，`web/scripts/scope-css.mjs` 把所有选择器改写进 `[data-dsh-studio]`。

### 适配层（`web/src/boardui/index.tsx`）
调用点一行不改，语义翻译都在这层：
- `Button`：`default→primary`、`secondary→secondary`、`outline→secondary`、`ghost→ghost`、`destructive→danger`、`link→ghost`；
  尺寸 `default/lg→medium`、`sm→small`、`xs→xs`、`icon→medium`。
- `Input` / `Textarea`：`value` / `onChange(e.target.value)` 的 DOM 语义 → react-aria 的 `value` / `onChange(string)`；
  `disabled / readOnly / required` → `isDisabled / isReadOnly / isRequired`；
  调用方传的 `ds-input` / `ds-textarea` 这类 legacy 类名被过滤掉（视觉由 BoardUI 的壳子负责），`style` 挂到字段根节点。
- `Checkbox`：`checked` + `onChange(e.target.checked)` → `isSelected` + `onChange(boolean)`。
- 没给 `aria-label` 时用 `placeholder` 兜底，避免 react-aria 报「字段没有可访问名」。

### 已换到源码组件的
| 调用点 | 用的源码 |
| --- | --- |
| `components/ui.jsx` 的 `Button`（全站按钮） | `base/buttons/button.tsx` |
| `studio/fields.js` 的 `TextField`（看板搜索、抽屉表单、设置页） | `base/input/input.tsx`（`TextField` + `InputBase`） |
| `studio/fields.js` 的 `TextAreaField`（评论、需求正文、角色提示词） | `base/textarea/textarea.tsx` |
| `studio/fields.js` 的 `CheckField`（看板筛选、自动派单、权限开关） | `base/checkbox/checkbox.tsx` |

**还没换**：`SelectField`（仍是 Radix `SelectBox`）、Tabs、Drawer、Modal、Table —— 下一批。

### 验证
- `npm run verify:fields`（新）：真 Chrome 打字 / 勾选 / 清空 / 读回值，15 项全过 —— 关键是「受控回写没断」：
  输入「超时」后卡片只剩 1 张且 `input.value` 还是「超时」，勾上「隐藏空列」后列数 8→2 且 glyph 变色。
- `verify:facts` 5/5、`verify:costs` 7/7、`verify:scale` 9/9、`npm test` 108/108，`pageerror` 全程为空。
- 体积：857.71 kB → **914.85 kB**（gzip 242.33 → 261.05）。涨的部分是 react-aria 的 textfield / checkbox
  真正进包了（之前只是裸 import，被 tree-shake 掉了）。

### 踩过的坑
- 组件之间有同目录兄弟依赖（`input` 要 `label` / `hint-text`，`checkbox` 要 `checkbox-glyph`，`textarea` 还要
  `@/components/base/input/*`），少一个就红构建 —— 扫 `@/` 与相对 import 补齐，别手写。
- react-aria 的 `Checkbox` 根节点是 `<label>`，`role=checkbox` 在那个视觉隐藏的 `input` 上；
  自绘的 16px 方块是 `span[aria-hidden]`，选中态靠 `shadow-checkbox-selected` 这个类。
- `type=date` 仍然是原生 input（react-aria 的 `useTextField` 不做日期格式化，那是 `useDateField`），
  包进 BoardUI 的壳子后行为与以前一致。

### 第二批：Select（下拉）

- 源码来源改成**直接从 GitHub 原样拉**：`web/scripts/fetch-boardui.mjs components/base/select/select.tsx`
  会按 `@/` 与相对 import 递归补齐依赖（这次带进来 `dropdown/menu-styles.ts`、
  `foundations/icons/chevrons.tsx`、`utils/use-dismiss-on-outside-press.ts`）。
  已存在的文件默认不覆盖，`--force` 才重拉；文件头统一一行
  `// copied verbatim from BoardUI (MIT) — https://github.com/BoardUI/boardui/blob/main/<path>`。
  （文档站 `boardui.com` 的 RSC payload 里也有同一份源码，但 GitHub 更干净，别再扒页面。）
- 适配：`studio/fields.js` 的 `SelectField` 把调用点的原生 `<option>` 子节点拍平成
  `{value,label}`，适配层再渲染 `Select` + `SelectItem`；`selectedKey`/`onSelectionChange`
  与我们 `value`/`onChange(e.target.value)` 互译，空串仍走 `__empty__` 哨兵。
- **坑（这轮最大的一个）**：react-aria 的 Popover 默认 portal 到 `document.body`，落在
  `[data-dsh-studio]` 外面，作用域化的 Tailwind 全失效 —— 下拉会变成没有样式的裸列表。
  官方解法是 `react-aria/PortalProvider` 的 `UNSAFE_PortalProvider`：在 `web/src/bridge.jsx`
  用它包住整个面板，`getContainer` 指向 Radix 那个 `data-dsh-studio-portal` 容器，
  react-aria 的浮层和 Radix 的浮层从此共用一个容器、一套样式。为此把 `react-aria`
  提成直接依赖（版本与 react-aria-components 一致，3.53.1，不会打第二份）。
- 验证：`verify:fields` 20/20（新增 5 项：点开下拉、弹层在 portal 容器里、面板有壳子、
  选「缺陷」后按钮跟着变且卡片被筛成 0、清回「全部类型」卡片回来）。

### 体积：914.85 kB → 1058.88 kB（gzip 261.05 → 305.89）

涨的 144 kB 全在 react-aria 的 Select / ListBox / Popover / Overlays / Collections 这一串上，
不是我们的代码。原来定的 900 kB 红线在这条路上守不住 —— 要真组件就只能接受；
真要压回去，唯一办法是退回 Radix Select（等于不换骨）。取舍记在这里：
**保留真组件，体积红线改为 1.1 MB**，后续 tabs/drawer/modal 还会再涨，涨到离谱时再谈按页拆包。

### 第三批：Tabs（页面顶栏 + 卡片抽屉的页签）

- 用的是 `components/base/tabs/pill-tab.tsx` 的 `PillTabList` + `PillTab`（带滑动选中背景的胶囊页签，
  不是 `tabs.tsx` 那个下划线版本 —— 我们的场景是「切视图」而不是「切面板」，胶囊更贴）。
- 只改了一处实现：`components/studio-ui.jsx` 的 `TabsBar`，契约 `{items, value, onChange}` 一字未动，
  所以页面顶栏（8 个页签）和卡片抽屉（7 个页签）同时换掉。
- 顶栏原来是优先走 Radix 的 `Tabs/TabsList/TabsTrigger` 三件套，`TabsBar` 只在抽屉里用；
  这次把 `client.src.js` 的判断顺序改成**先 TabsBar**，Radix 那套降为兜底。
- `hint` 用原生 `title`：`PillTab` 不收 `title`，套 Radix Tooltip 又要求 forwardRef（会报 ref 警告）。
- 代价：DOM 里不再有 `role="tab"`，胶囊是 `button[aria-pressed]`。**所有探针**里
  `[data-dsh-studio] [role="tab"]` 都换成了 `.ds-head-tabs button`（抽屉里是
  `.ds-drawer [role="group"] button`），`capture.mjs` / `smoke.mjs` / `probe-unpriced.mjs` 也一起换了。
- 验证：`verify:fields` 20/20、`verify:facts` 5/5、`verify:costs` 7/7、`verify:scale` 9/9、
  `npm test` 108/108，七页逐个走一遍无 pageerror。体积 1058.88 → 1065.17 kB（胶囊几乎不要钱）。

### 六页回归固化成 `npm run verify:pages`

`tools/visual/pages-probe.mjs`：假宿主 + 真 Chrome，把七个页签逐个点一遍，每页三项断言
（点得动 / 渲染出了该有的标记 / 页签是高亮态），最后统一断言 `pageerror` 为空，
截图落到 `tmp/pages/<页签>.png`。共 22 项。

- 判据里专门查了 `innerText` 有没有「渲染失败」——React 的错误边界会吞异常，
  `pageerror` 是空的，只看它就等于没查（AGENTS.md §11 记过两次误判）。
- 页签选择器用 `.ds-head-tabs button`（胶囊是 `button[aria-pressed]`，没有 `role=tab`）。
- 每页的「该有的标记」：工作台 `.ds-body`；看板 `.ds-col`；需求/用例/版本/效能 `.ds-panel` 一族；设置 `.ds-panel`。
- 顺手确认：**仓库里没有 table/表格组件**（`grep ds-table` 空），所以 BoardUI 的 `base/table` 暂时没有调用点，
  清单里「table 接线」这一项其实无事可做，等真有表格页再说。

### 第四批：抽屉（Drawer）—— 自己实现，因为它是 Pro

- **BoardUI 的 Drawer / Modal 是 Pro**：公共仓库 `components/base/drawer|modal` 都 404，按既定约束
  「不买、不复制付费源码」，所以**没有源码可抄**。这一批是**我们自己写的等价物**：
  `web/src/boardui/drawer.tsx`，照公开文档的视觉与行为，用 react-aria 的
  `ModalOverlay + Modal + Dialog`（免费、和 Select/Input 同一套无障碍实现）拼出来。
- 行为交给 react-aria：Esc 关闭、焦点锁在抽屉内、关掉后焦点归还触发元素、portal 到
  `data-dsh-studio-portal` 容器（上一步的 `UNSAFE_PortalProvider` 直接复用）。
  原来手挂的 `window.addEventListener('keydown')` 整段删掉。
- 视觉用他们的 token：面板 `bg-background-primary-default`、左边 `border-separator-border`、
  标题 `text-title-3-semibold`、说明 `text-caption-1-medium text-text-secondary`、
  关闭按钮直接复用他们 MIT 的 `Button`（`iconOnly` + `leadingIcon={RiCloseLine}`）。
- 接线只改一处：`components/studio-ui.jsx` 的 `SheetDrawer`（`shell.js` 的 `SideDrawer`
  本来就把活交给它），所以设置页/集成页所有抽屉一起换掉。构建后的守卫从「6 个 Radix portal」
  降到 5 个 —— Radix Dialog 少了一个。
- 验证：新增 `npm run verify:drawer`（8 项）：能打开、开在 portal 容器里、面板用 BoardUI token、
  标题字号对、有关闭按钮、Esc 能关、无 pageerror。截图 `tmp/drawer-probe.png`。
- 已知小瑕疵：打开时焦点落在右上角关闭按钮上（react-aria 默认聚焦第一个可聚焦元素），
  所以截图里 X 带着一圈焦点环。可接受，但如果以后嫌吵，就把 autoFocus 指到第一个输入框。

### 清单口径（写清楚，别自己骗自己）

- **[5] tabs ✔ / table 无事可做 / drawer+modal → 归到 [8]**：仓库里没有表格组件
  （`grep ds-table` 为空），BoardUI 的 `base/table` 没有调用点；drawer/modal 是 Pro，
  自研等价物已落地（本轮）。

### 第五批：确认弹窗 + 状态标签

- **弹窗**（`DialogBox` → `web/src/boardui/dialog.tsx`）：同样是 Pro 组件，同样自己写。
  用 react-aria 的 `ModalOverlay + Modal + Dialog`，遮罩 `bg-black/55`、居中卡片
  `min(440px,92vw)`、标题用 `text-body-semibold`、按钮复用他们 MIT 的 `Button`
  （secondary + primary/danger）。确定性动作走 `danger` 变体（截图里「删除」是红的）。
  原来手写的 Radix Dialog 版整段删掉；构建后守卫从 5 个 Radix portal 降到 **4 个**。
- **状态标签**（`ChipField` → `base/badges/chip.tsx` + 适配层 `Chip`）：
  老代码用 `ds-chip-blocked` / `ds-chip-bug` / `ds-chip-code` 这类 **class 表达语义**，
  适配层把语义翻成他们的 `color`：阻塞/缺陷/危险 → `rose`，代码/缺服务 → `soft`，其余 → `gray`；
  变体统一用 `caption`（12/16/500），因为他们的 `bold` 是 14/20，会把密集列表的行高撑起来。
- `base/badges/badge.tsx` 也拉下来了，但它是「导航计数小球」，跟我们的状态标签不是一类，没硬套。
- 验证：`verify:drawer` 扩到 13 项（多了：点「删除」弹确认框、在 portal 里、用 BoardUI 背景、
  有取消 + 确认两个按钮、点取消能关掉），截图 `tmp/dialog-probe.png`；pages 22/22 仍全绿。

### 体积与 token 裁剪：算过了，不值当

- `theme.css` 定义行 575 行、**唯一 token 232 个**；用 postcss 跑一遍真实构建产物（`@tailwindcss/postcss`
  + 作用域插件），对每个 token 找 `var(--x)` 引用，再沿「token 引用 token」做一次可达性传播，
  结果是 **37 个 token 没人引用**（`--color-slate-200`、`--shadow-sm/md/lg/xl`、`--radius-2-5xl` 这类）。
- 37 个定义 ≈ 2–3 kB，而产物已经 1081 kB —— 裁了也回不到 900 kB，收益和「改错一个 token 就悄悄变色」的风险不成比例，
  所以**没有裁**。真想再瘦，只能退组件（退回 Radix Select 一类），那等于不换骨。
- 结论：**900 kB 这条红线取消，改成 1.1 MB 的观察线**；超过 1.1 MB 再来谈按页拆包。

### 第六批：统计卡 / 图表卡（[8] Pro 等价物，自研）

- **同样是 Pro，同样自己写**：`web/src/boardui/chart-card.tsx` 里三个小组件，
  照 BoardUI 图表卡公开文档的结构（标题 + 右侧附注 + 一句「所以呢」+ 主数字 + 图 + 脚注）拼的：
  - `StatCard`：KPI 方块（标签 / 主数字 / 解释），`warn` 时主数字走 `text-text-error-primary`
  - `ChartCard`：图表外壳（标题 + aside + hint + children + footer）
  - `BarRow`：卡片里的一行横条（名字 / 轨道 / 数值），比例 0–1，`tone` 控制配色
- 接线：效能页的 `kpi()` 改成渲染 `StatCard`（质量区 4 个 + 后面几块一起生效）；
  「周期分布」「每列停留（平均）」两块换成 `ChartCard + BarRow`。
- 没有引入任何图表库 —— 图仍然是 div 画出来的横条，体积只涨 3 kB。
- `verify:pages` 里「效能」页的判据从 `.ds-kpi` 改成 `[data-stat-card], [data-chart-card]`，
  这样组件没了会直接红，而不是被 `.ds-panel` 蒙混过去。
- **[8] 另外两项按现状搁置**，理由写在下面，不是「没做」而是「没有对象/风险不对等」：
  - 数据网格：仓库里没有表格组件（`grep ds-table` 为空），全是 `.ds-listrow` 行卡片；
    要做网格得先有一个真的表格场景，否则就是为组件而组件。
  - 任务列表：看板列本身就是「任务列表」，但它绑着拖拽、WIP 上限、分页（每列 40 张 + 显示更多）；
    抽壳会直接碰到 `verify:scale` 那条 1000 张卡的性能断言，收益不抵风险。

### 第七批：任务列表（[8] Pro 等价物的第三块）

- `web/src/boardui/task-list.tsx`：`TaskList`（复用 ChartCard 的外壳 + 空态）+ `TaskRow`
  （左标题 / 一行说明 / 右侧动作）。进效能页「返工最多的卡」，那一块原来是 `.ds-panel` +
  `.ds-listrow` + `.ds-btn` 三套 legacy 标记。
- 看板列**没有**动：那里绑着拖拽、WIP 上限和分页（每列 40 张 + 显示更多），
  抽壳会直接撞 `verify:scale` 的 1000 张卡断言，收益不抵风险。
- `verify:pages` 的页签判据加了第三段「必须存在」的选择器：效能页除了
  `[data-stat-card]/[data-chart-card]` 还要求 `[data-task-row]` 真的在，
  以免以后组件被换掉却因为别的选择器仍然匹配而蒙混过关。

### [8] 三块的最终口径

| 要的 | 结果 |
| --- | --- |
| 图表卡 | ✅ 自研 `StatCard` / `ChartCard` / `BarRow`，效能页已用 |
| 任务列表 | ✅ 自研 `TaskList` / `TaskRow`，效能页已用（看板列不动，理由见上） |
| 数据网格 | ⛔ **没有对象**：全仓库没有表格组件（`grep ds-table` 为空），也没有表格页面；
没有调用点就写一个没人用的网格，等于为组件而组件。真要做得先有表格场景。 |

### 体积观察线：1.1 MB（用户 2026-11-17 确认）

- 900 kB 那条作废 —— 真组件的成本摆在那里（react-aria 的 Select / ListBox / Popover / Modal
  一串占了 150 kB 上下），压回去只能退回 Radix，等于不换骨。
- 现在把口径写进**构建守卫**（`web/scripts/guard.mjs` 的 `--post`）：`dist/client.js` 超过
  **1126 kB**（1.1 MB）直接构建失败，并提示「查查又引了什么」。观察线要能拦人，光写在文档里没用。
- 当前 1085.68 kB / gzip 311.92 kB，离观察线还有 40 kB 余量。

## 真机验证（.218，2026-11-17）：逮到一个只有在真机才复现的 bug

部署：`DSH_DEPLOY_HOST=192.168.120.218 DSH_DEPLOY_USER=lyf node tools/deploy.mjs` → `active=active files=41`。
（脚本报的 `state=502` 是**假警报**：它 curl 的是 `127.0.0.1:18080`，而这台机器上 dsh 只绑在
`192.168.120.218:18080`，用局域网地址请求是 200、rev 16887。）

真机上跑出来的结果：
- `tools/visual/smoke.mjs`：`ok: true`（30 张卡 / 100 行用例 / 面板没崩 / pageerror 空）。
- 逐页：7 个页签全过，效能页的 `[data-stat-card]`、`[data-chart-card]` 在真数据下正常
  （一次通过率 60%、返工率 48% 标红、每列停留的横条有真实占比）。
- 抽屉与弹窗：**第一次跑挂了 3 项**。

### 抓到的 bug：抽屉打开后焦点留在 `<body>`，Esc 关不掉

- 现象：设置页抽屉能打开、也能点关闭，但**按 Esc 没反应**；`document.activeElement` 是 `BODY`。
- 原因：react-aria 的 Esc 处理要求事件发生在浮层内部，焦点在 body 上时它直接忽略。
  我们删掉了原来手挂的 `window.addEventListener('keydown')`，就没人兜底了。
- 为什么假宿主测不出来：那边没有宿主的全局焦点处理，焦点正好落在浮层里，Esc 一直好使。
  **`verify:drawer` 在这条上是假绿** —— 现在补了两条断言（打开后焦点在抽屉内 + 根节点带
  `data-boardui-overlay`），本地就能盯住。
- 修法（`web/src/boardui/overlay-escape.ts`）：
  1. `useFocusOnMount`：打开后如果焦点不在浮层里，把浮层容器（`tabIndex=-1`）聚焦；
  2. `useEscapeFallback`：在 `window` 上补 Esc 监听，**只关最上层那个浮层**
     （按 `data-boardui-overlay` 的出现顺序判断），免得关弹窗把底下的抽屉一起关了。
- 修完重新部署，真机复跑：抽屉 10/10、逐页 17/17、smoke `ok: true`。
