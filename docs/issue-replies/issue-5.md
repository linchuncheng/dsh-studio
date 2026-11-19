## 已修 + 桌面实测结果（0.9.6 → 0.9.14）

这份报告质量很高，逐条跟进了。**三条高危已修**，其余八条里修了两条，还剩四条需要产品决策 —— 如实列在最后。

### 1（高）4 个只读工具被当成写工具 ✅

确认是权限表漏登记而非工具逻辑问题。现在 **40 个工具全部显式登记**（读 `read` / 写 `write` / 发布灰度 `admin`），
权限表搬到 `src/host/tool-access.js`，并加契约测试**遍历注册表**——以后新增工具忘了登记，发版检查直接失败。
`toolLevel()` 的 `'write'` 兜底保留（收紧方向），但不再被静默依赖。

### 2（高）`detectProfile()` 认不出 scoped 包名 ✅

按建议改成认 `@marsken/dsh-studio` / 任意 `*/dsh-studio` / 短名，并抽成 `isStudioProfile()` 纯函数。
没有采纳"取不到就报错"——那会让没装进 profile 的本地目录挂载直接起不来，这点与建议有出入，说明一下。

**桌面实测**（本机 DSH Desktop，profile=`desktop`）：
```
/state.profile   = desktop      ← 以前恒为 web
/market.installed = 22 项，含 @marsken/dsh-studio   ← 以前恒为空
```

### 3（高，安全）破坏性路由零确认 ✅

20 条路由现在要求确认词，缺了或词不对 → `400 {"code":"confirm_required"}`：

| 路由 | `confirm` |
| --- | --- |
| `*/delete`（task / requirement / release / projects / repos / bots / experts / teams / suite / skills / access） | `"DELETE"` |
| `/audit/clear`、`/team/memory/clear` | `"CLEAR"` |
| `/snapshot/restore`、`/market/install`、`/market/uninstall`、`/release/publish`、`/release/rollback`、`/reset` | `"RESTORE"` / `"INSTALL"` / `"UNINSTALL"` / `"PUBLISH"` / `"ROLLBACK"` / `"RESET"` |
| `/access/save` | `"SAVE ACCESS"` |

面板的 `api()` 会自动补（界面上本来就有确认框），自写脚本要按 README 的表格带上。
**实测**：`POST /studio-api/audit/clear {}` → 400，不再真删。你丢的 58 条审计是这条缺陷最有力的证明。

### 8（中）错误被 `ReferenceError` 顶掉 ✅
写工具的 catch 里审计自带 try/catch，业务原始错误能透出来。

### 11（中）新建需求永久卡「评审中」 ✅
以前没有 PRD 的新需求自动置 `status=review` + `review.pending`（评审人写"系统"），但没有评审人也没有自动流转；
现在落 `draft`，要评审就显式点。

### 未做（需要先定产品行为，没有假装完成）

| # | 问题 | 需要什么决定 |
| --- | --- | --- |
| 5 | `/task/design` 只带 id 就写数据 | 拆读/写要动前端调用点，想和 `/task/gate`、`/task/worktree` 一起统一 |
| 9 | `/state` 同时下发 `comments: []` 与 `commentCount` | 改契约要改所有读方；倾向"不再下发数组"，但要配套迁移 |
| 7 | 测试环境默认值为空 → 新装即卡 | 默认用宿主 origin 会引入"往哪打"的安全问题，要和沙箱白名单一起定 |
| 10 / 4 / 6 | 市场无源、空 body 造记录、建卡不挂需求 | 10 是部署配置；4/6 会改掉"先建空壳再补"的现有用法，想先确认团队习惯 |

### 防回归

`tests/issue5-guards.test.mjs`（6 条）：工具权限表完整性、4 个读工具档位、确认词表与 `needsConfirm` 行为、
前端 `api()` 自动补确认、`detectProfile` 认 scoped 名、新建需求不落 review。

另外为了能在真实桌面环境验证 #2，把判据抽成 `src/host/profile-detect.js` 的 `isStudioProfile()`，
测试直接读**本机真实 profile 的 package.json**：加进本插件必须认得出，摘掉必须认不出。

升级到 `@marsken/dsh-studio@0.9.14` 或更新即可。剩下四条如果你们同意按上面的方向改，我下一轮连"空库实例探针"一起做。
