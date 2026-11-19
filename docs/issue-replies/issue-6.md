## 已修复：0.9.3（并补上了这类问题的自动检查）

感谢报告，这条信息很关键：**"新装 + 空看板"** 才触发。

### 根因：`&&` 短路掩盖的一个 TDZ

`web/src/studio/board.js` 里两行顺序错了：

```js
const boardEmpty = (state.tasks ?? []).length === 0 && filtering === false   // ← 先用了 filtering
const filtering  = query !== '' || expertFilter !== '' || …                 // ← 下一行才声明
```

- **板上有卡**：第一个条件就是 `false`，`&&` 短路 → `filtering` 根本不会被求值 → 一直正常（所以我们自己有 31 张卡的实例从没暴露）；
- **空看板（新装）**：第一个条件 `true` → 立刻去读还没初始化的 `filtering` → `ReferenceError`，压缩后就是你看到的
  `Cannot access 're' before initialization`。

跟 macOS 无关，Windows / Linux 新装一样会崩。现在先声明 `filtering` 再算 `boardEmpty`。

### 新增：作用域级 TDZ 扫描

`npm run verify:tdz`（`tools/tdz-scan.mjs`）：按**作用域**找「同一作用域内先用后声明」，已接进 `release:check`。
把上面两行换回原顺序，扫描当场报：

```
web/src/studio/board.js:71  filtering 在声明（第 72 行）之前就被用了
```

顺带修了它自己的两个误报（`for (let i …)` 循环头、注释/字符串里的同名标识符），否则它不可信。

### 另一层保障：空数据巡检

`npm run verify:empty`（`tools/visual/empty-state-probe.mjs`）：真拉一份 `/state`，把集合清空（config 保留），
用 CDP 拦截响应替换，然后**走一遍全部 8 个页签**，断言不出现「渲染失败」、空看板给出「还没有任何卡」的引导。
已接进 `release:preflight`。

### 实测

本机 DSH Desktop（真实空库，0 张卡）：看板 8 列正常、显示「还没有任何卡」引导、无渲染失败。
218 的 dsh-web（有数据）上 `verify:empty` 11 项全过。

升级到 `@marsken/dsh-studio@0.9.14` 或更新即可。
