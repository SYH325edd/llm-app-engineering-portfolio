# Dialogue Delivery v1i — 2026-09-21

> 历史版本说明：v1i 已由 `Dialogue Delivery v1j` 取代。本文件仅保留变更历史，不代表当前契约。

## 目标

将“说话人是否在画面内”和“声音的叙事交付方式”拆成两个正交维度，避免用一个枚举混合不同语义。

## 契约

- `offscreen: bool`：程序根据当前 Shot 可见角色确定。
- `delivery_mode: direct | quoted | voiceover`：由可选 `dialogue_delivery` override 决定；缺省为 `direct`。
- 模型不输出 canonical `dialogue`，只在非默认情形下输出 `{dialogue_index, mode}`。
- 缺失 `dialogue_delivery` 时 Runtime 确定性补 `[]`，不触发 Repair。

## 最终消费

- direct + onscreen → 画内
- direct + offscreen → 画外
- quoted + onscreen → 画内转述
- quoted + offscreen → 画外转述
- voiceover → 画外旁白

## 不变边界

冻结对白正文、speaker、FrozenText refs、Shot 可见角色关系均不由 delivery 模型改写。
