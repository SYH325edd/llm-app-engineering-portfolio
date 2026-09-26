# Stage 08 — Production Lock + Compilers + Static Evaluation

Status: **FROZEN-08**  
Units: `compile:assets`, `compile`

Stage 08 是最终 deterministic production consumption，不调用 LLM。

## Input

- FROZEN-01 Story Bible
- FROZEN-03 Script
- FROZEN-05A PVB candidate
- FROZEN-05B PSB candidate
- FROZEN-05C Style candidate
- FROZEN-06 validated Storyboard
- FROZEN-07 ShotSpecs

## Production lock

候选 checkpoint 不被修改。Runtime 在 deep copy 上执行显式 `runtime_auto_production_lock.v1`：

- PVB 使用 Frozen confirm → lock helper；
- PSB/Style 因 Core 无独立 review helper，仅把 validated candidate/confirmed leaf 转 locked；
- Story Bible-owned skipped 保留；
- lock errors 在 Compiler 前停止。

## Compilation

只调用 Frozen Core：

- Character Compiler
- Scene Compiler
- Shot Compiler

最终只生成 Character / Scene / Shot 三类 Prompt。

## Evaluation

Frozen Static Evaluation 对最终 story/script/storyboard/ShotSpecs/compiled prompts 做二次结构、引用、authority、compiler、state consistency 检查。失败归属 `compile` Unit。
