# 安全策略

## 支持范围

只对**当前发布的 minor 版本**提供安全修复（例：`0.8.x`）。更早的版本请先升级 ——
这个插件的改动节奏很快，旧版本通常也拿不到宿主接口的兼容修复。

| 版本 | 是否维护 |
| --- | --- |
| 最新 `latest`（npm 上 `@marsken/dsh-studio`） | ✅ |
| 上一个 minor | ⚠️ 仅修高危 |
| 更早 | ❌ 请升级 |

## 怎么报告

**请不要开公开 issue。** 用 GitHub 的私有渠道：

👉 <https://github.com/marsken88/dsh-studio/security/advisories/new>

（仓库 Security 页 → Report a vulnerability。只有维护者能看到内容。）

请尽量带上：

- 受影响的版本、DSH 版本、profile 名（`desktop` / `web`）
- 复现步骤；能给出最小请求/命令最好
- 影响判断：能读到什么、能改到什么、需不需要已登录/本机访问
- 你希望的处置方式（如果你已经有补丁，欢迎直接贴 diff）

我会在**能复现之后**给一个明确结论（承认 / 不承认 + 理由），修复会随下一个补丁版本发布，
并在 GitHub Security Advisory 与 `CHANGELOG.md` 里写清。修复前不会公开细节。

## 这个项目的安全边界（判断"算不算漏洞"时先看这里）

**在本项目的威胁模型里：**

1. **webhook 出站地址受白名单约束**：默认只允许公网地址，回环/私网/链路本地/云元数据地址会被拒，
   除非在「设置 → 测试执行 → 允许访问的域名」里显式放行。绕过它 → 是漏洞（SSRF）。
2. **敏感管理操作只允许本机来源**（未启用登录时）：插件安装/卸载、快照恢复、审计导出。
3. **跨站 POST 一律拒绝**（`isCrossSiteRequest`）：即便没开登录，恶意网页也不能凭 `no-cors` 简单请求改数据。
4. **令牌与口令只落 `~/.dsh/dsh-studio.secrets.json`（0600）**，不写进 state、日志、README。
5. **AI 不能代签**：验收签字带来源标记，AI 签的字在准出时被拦（0.3.9 起）。
6. **shell / 数据库用例执行器默认关闭**：开了等于允许被测命令在被测机上执行，属于运维决策，会在设置里显式提示。

**不在本项目范围（请去对应仓库）：**

- 需要**本机已有权限**才能做的事（能读 `~/.dsh/` 就已经拿到一切）。
- DSH 宿主自身的问题 → [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。
- 「面板里能改数据」本身 —— 这是设计意图；权限模型见 README 的「安全与权限」一节。
- 依赖包（`puppeteer-core` 等 devDependency 不进运行时）的漏洞，请报给上游。

## 已知的、有意为之的取舍

- **默认口令 `admin/admin`**：本地超管账号用来在没配 LDAP 时进得来；开启登录后请到
  「设置 → 权限与审计」改口令。要在局域网暴露面板，请先改口令或接 LDAP。
- **强推（override）是逃生舱**：门禁拦住的卡可以带原因强推，记录会进审计与效能页，不会静默。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
