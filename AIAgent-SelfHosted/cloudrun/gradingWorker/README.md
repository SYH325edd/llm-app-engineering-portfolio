# grading-worker · Runtime V10.9.0

- Runtime: `V10.9.0`
- Runtime Build ID: `build-20260815-primary-review-question-contract-v10.9.0`
- Strategy contract: `1.6.19`

当前构建包含两项当前有效的运行时一致性机制：

1. 马虎链路最终分类：当 `analysisStatus=ok` 时，学生真实漏填某一格属于 `WRONG`；只有证据不足/不可读时才进入 `UNDETERMINED/INCOMPLETE`。
2. PRIMARY → REVIEW 题目身份契约：PRIMARY 已确认存在的题目由 Runtime 生成内部固定 `primaryQuestionId`；REVIEW 必须逐题返回，允许修改判断并允许有证据地新增漏题，但不得遗漏、删除或合并 PRIMARY 题目。第一次 REVIEW 缺题时记录精确缺失身份并进行一次定向 REVIEW 恢复；最终题目对齐硬校验仍保留，禁止伪造 REVIEW 结果。

`primaryQuestionId` 仅用于内部 REVIEW 归属恢复，Schema 校验和最终业务结果前会被移除，不对最终结果泄漏。

此目录是当前 Cloud Run 源码/部署上下文，不保存旧版本部署记录。
