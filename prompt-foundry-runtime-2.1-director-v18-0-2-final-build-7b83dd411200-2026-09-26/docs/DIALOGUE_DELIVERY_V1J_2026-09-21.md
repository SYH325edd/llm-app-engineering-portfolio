# Dialogue Delivery v1j — 2026-09-21

## 目标

保持对白正文、speaker、可见性全部冻结/程序拥有，只把真正需要语义判断的“交付方式”留给模型；对 direct 对白中的内层转述原话使用程序候选 + 模型 index 选择。

## 两层结构

Canonical dialogue item：

```text
dialogue item
├─ character_id       program-owned
├─ line               program-owned
├─ offscreen          program-owned
├─ delivery_mode      direct | quoted | voiceover
└─ embedded_quotes[]  program-owned exact text
```

Runtime 从冻结 `line` 中的嵌套引号提取：

```json
{"quote_index":0,"text":"周哥，帮我收着，我回来拿"}
```

模型只允许在对应 dialogue decision 中返回：

```json
{"dialogue_index":0,"mode":"direct","embedded_quote_indices":[0]}
```

模型不得返回 quote text。未知 index、重复 index、非 direct mode 携带 embedded quote 均为 hard validation error。

## Compiler 映射

- direct + onscreen → 画内
- direct + offscreen → 画外
- quoted + onscreen → 画内转述
- quoted + offscreen → 画外转述
- voiceover → 画外旁白
- direct + embedded quote → 画内，含转述原话
- direct + offscreen + embedded quote → 画外，含转述原话

Compiler 不拆句、不改写原话，只增加交付标签。
