// 版本比较：只覆盖本仓库会产生的两种形状 —— x.y.z 与 x.y.z-<pre>（同号时预发布小于正式版）。
// 不引 semver 依赖：这里只需要「谁更新」，多一个依赖就多一处发版风险。
// 单测在 tests/release-workflows.test.mjs。

export const cmpSemver = (a, b) => {
  const split = (v) => {
    const [core, pre = ''] = String(v).split('-', 2)
    return { nums: core.split('.').map((n) => Number(n) || 0), pre }
  }
  const pa = split(a)
  const pb = split(b)
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  if (pa.pre === pb.pre) return 0
  if (pa.pre === '') return 1
  if (pb.pre === '') return -1
  return pa.pre < pb.pre ? -1 : 1
}

// 只认 1.2.3 / 1.2.3-pre 这种形状；'(无)' 之类的脏值一律当「不认识」，别拿去比较。
export const isVersion = (v) => /^\d+\.\d+\.\d+/.test(String(v))
