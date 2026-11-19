## 这个 PR 做了什么

<!-- 一句话说清；行为变了的话，写清「改之前 → 改之后」 -->

## 为什么

<!-- 现象 / 根因。有 issue 就带上 #编号 -->

## 怎么验证的

<!-- 命令 + 输出、截图、真机探针结果。只说「本地跑过了」不算 -->

---

## 提交前自检（缺一项都别急着开 PR）

- [ ] `node --check index.js && node --check client.src.js`
- [ ] `npm test` 全绿
- [ ] **`TZ=UTC npm test` 全绿**（CI 在 UTC 里跑，本地在 Asia/Shanghai；带时区的 `new Date('…+08:00')` 字面量会「本地绿、CI 红」）
- [ ] 改了前端：`cd web && pnpm build`，并且 `cmp -s dist/client.js client.js`
- [ ] 没有为了让测试通过而放宽断言（产物一致 / patch 包名 / config 白名单 / AGENTS 模块清单 这些「必须等于」一条都不改弱）
- [ ] 新逻辑放在 `src/host/**`；`index.js` ≤ 2700 行、单个 host 模块 ≤ 2000 行
- [ ] 子模块没有反向 `import index.js`（需要宿主能力时走 `configure*()` 注入）

## 文档同步

- [ ] 用户能感知的行为变了 → 改 `README.md`
- [ ] 每个版本都要一条 `CHANGELOG.md`
- [ ] 改了宿主调用 / 版本号 → `docs/compatibility.md`
- [ ] 改了界面组件或样式体系 → `docs/ui.md`
- [ ] 改了范围或验收口径 → `docs/product.md`
- [ ] `npm run release:check` 通过

## 风险与遗留

<!-- 这一版没处理的边界、需要人盯着的地方。没有就写「无」 -->

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
