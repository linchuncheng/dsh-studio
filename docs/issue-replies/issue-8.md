## 已修复：`studio_task_artifact` 不再"报错但已写入"（0.9.17）

根因你定位得很准：`store.mutate()` 返回的是**整份 state**，不是回调的返回值，而这段代码把它当任务对象用 ——
写完再读 `task.artifacts` 就抛 `TypeError: Cannot read properties of undefined (reading 'length')`。

### 修法

在 `store.mutate` 的回调里把任务对象带出来，不再依赖返回值：

```js
let updated = null
await store.mutate(state => {
  const target = state.tasks.find(t => t.id === args.id)
  …
  updated = target
})
const task = updated
```

`add` / `update` / `remove` 三个动作都覆盖到了（`sync: true` 分支也走同一段）。

### 回归测试（这次不是只靠肉眼）

新增 `tests/artifact-tool.test.mjs`：真起一个 `StudioStore`、注册工具，依次跑
add → update → remove，断言**不抛错**且库里真的改了。

把代码改回旧写法（`const task = await store.mutate(...)`），这条测试立刻红 —— 我验证过。

```
✔ studio_task_artifact：add / update / remove 都不抛错，且写入是真的
```

### 顺带

你的判定「报错 ≠ 没写 → 用户会重试 → 产物重复」很关键。除了修这里，我把**同类写法**也扫了一遍：

```
$ grep -rn "= await store.mutate(" src/host
```

除了这个工具，其余调用点都是 `const snapshot = await store.mutate(...)`（本来就把它当整份 state 用，正确），
或者 `void task`（多余变量，无副作用）。没有发现第二处会踩这个语义的地方。

### 真机验收（218）

```
登记交付物不报错 → 200
只读 POST 不推 revision：19586 → 19586
```

升级到 `@marsken/dsh-studio@0.9.17` 或更新即可。
