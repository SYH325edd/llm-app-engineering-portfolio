# FROZEN-06 Director Freeze Report

Director 已从旧的“容错式 canonicalization”收紧为明确的 per-Shot semantic contract。

冻结结论：

- Director 只拥有导演语义；机械字段归程序。
- first global Shot reset 是 program-owned。
- 非法 primary/reaction 不再静默删除。
- partial inheritance 在当前 Unit checkpoint 前真实试算。
- performance evidence 在当前 Unit 锚定。
- Phase-E 三条状态一致性提前到当前 Unit，同时最终 Static Evaluation 继续二次验收。
- Director 仍不生成 image/video/platform prompt。

Core v1.3 文件不修改。
