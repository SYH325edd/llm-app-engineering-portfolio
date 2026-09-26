# FROZEN-07 State/ShotSpec Freeze Report

原本隐藏在最终 compile 内的 State Resolver + ShotSpec 已拆成独立 deterministic checkpoint。

冻结结论：

- 输入仅 validated Director Storyboard；
- Runtime 不拥有状态语义；
- `state_in` 由 Frozen Resolver 决定；
- ShotSpec 由 Frozen Builder 决定；
- output count/order 必须与 Storyboard Shot 一致；
- 失败不会进入 Compiler。
