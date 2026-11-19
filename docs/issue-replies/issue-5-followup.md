## 剩下两条也做完了（0.9.15）

接上一条：报告里第 5、第 9 条已修，实测数据附下。

### 第 9 条 · `/state` 同时下发空数组和计数

以前 `publicCases` / `publicChecklist` / `publicComments` 会带上 `cases: []`、`checklist: []`、`comments: []`，
于是 `/state` 里既有空数组、又有 `caseSummary` / `checkSummary` / `commentCount` ——
任何读 `task.comments.length` 的视图永远显示 0。

现在**只下发计数**，正文一律走 `/task/parts`。前端本来两种形状都认（`commentCountOf` / `checkSummaryOf` /
`caseSummaryOf`），所以前端没有改动。

顺带修了根因里的一处：`...task` 会把库里存的三个数组又摊回来，所以是在 `publicState` 里显式摘掉的。

### 第 5 条 · `/task/design` 只带 id 也会写数据

以前只传 `{id}` 就会写 `{link:"", status:"pending", by:"人"}` 并让 `revision +1` ——
一个读请求改状态，被轮询打到就反复刷版本。

现在用纯函数 `designPatchFrom()` 判断请求体里到底有没有设计字段：

- **没有** → 只读分支：返回当前设计，**不写库、不加 revision、不记历史**，响应里带 `readOnly: true`
- **有** → 照旧合并写入（`design.link` 和顶层 `link` 两种写法都兼容）

还发现并修了一个同源问题：**只读的 POST 仍然会记审计**，而审计写库同样会推 revision。
请求管线现在识别 `__studioReadOnly` 标记，只读请求不留任何写痕迹。

### 实测（218 真机）

```
/state 里没有空的 comments/checklist/cases 数组 — 检查 32 张卡，带数组的 0 张
计数仍在（commentCount / checkSummary / caseSummary） — 32/32
只带 id 的 /task/design 走只读分支 — 200 readOnly=true
只读请求不推进 revision — 19485 → 19485
带字段的 /task/design 仍然正常写入 — 200 status=pending
写入会推进 revision — 19485 → 19487
```

### 测试

- `tests/state-contract.test.mjs`（4 条）：三个投影不再含数组、`designPatchFrom` 的读写判断、
  路由只读分支必须在 `store.mutate` 之前返回；
- `tests/repo.test.mjs` 里两条"旧契约"断言（要求下发空数组）同步改成新契约。

到这里 #5 的 11 项状态：**5 项已修（1/2/3/8/11）+ 2 项已修（5/9）**，
剩下 **4/6/7/10** 四条仍然需要你们先定产品行为（空 body 校验策略、建卡是否强制挂需求、
测试环境默认值、市场源配置），我按你们的方向做。

升级到 `@marsken/dsh-studio@0.9.15` 或更新即可。
