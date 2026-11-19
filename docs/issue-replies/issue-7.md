## 已修复：只读 POST 不再写审计（0.9.17）

你的因果链完全正确，而且这段代码最讽刺的地方是：**它已经识别出只读 POST 了，注释也把危害写清楚了，只差最后一行没执行。**

### 修法

请求管线的审计步骤现在三个条件一起判：

```js
if (method === 'POST' && !readOnlyPost && req.__studioReadOnly !== true && res.statusCode !== 404) {
  await recordAudit(...)
}
```

- `readOnlyPost`：`READ_ONLY_POST_ROUTES` + `/task/artifact?action=get`（本来就已经算出来了，只是没用在审计上）
- `req.__studioReadOnly`：路由自己声明"这次是读"（例如 `/task/design` 只带 id）
- `404`：未知路由不算用户操作留下的痕迹

### 真机实测（218）

```
只读 POST 不推 revision：/task/parts + /task/comments → 19586 → 19586
404 不推 revision：POST /definitely-not-a-route → 19586 → 19586
```

顺带把 `revision` 的另一个来源也堵了：`/task/design` 只带 id 时以前会真写一条设计记录（issue #5 第 5 条），
现在走只读分支，不写库、不加 revision。

### 你的表里还剩两类

- `POST /cases`、`/requirement/matrix`、`/audit/list`、`/task/gate` —— 这些在 `READ_ONLY_POST_ROUTES` 里或属于同类，
  现在都走同一条判定；如果你那边还有 Δrev ≠ 0 的只读路由，把路由名给我，我加进集合。
- 历史里 86 条 `level: "read"` 的审计记录还在库里。要不要我加一个「清理只读审计」的一次性接口？
  （走破坏性确认词，不会误删）

升级到 `@marsken/dsh-studio@0.9.17` 或更新即可。
