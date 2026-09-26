> **Historical freeze snapshot.** 本文记录 Production Semantics 首次冻结时的迁移状态；当前运行契约以 `STAGE_CONTRACT_MATRIX.md` 为准。

# Production Semantics v1 Freeze

Build `02d7e7bec7e1` 冻结的是一套受控生产语义迁移，不是对某篇小说的规则补丁。

## 迁移路径

1. Acceptance tests first
2. Scene Plan v4 + context-aware state stack
3. Production Semantics v1a：visual/audio/renderability
4. v1b：production choices / frozen dialogue / diegetic text
5. v1c：appearance overlays
6. Director v11 consumption migration
7. Consumption v2a parallel A/B with fallback
8. Consumption v2b authoritative, fallback removed
9. Six-category Production Semantic Gate
10. Production Freeze

## Frozen boundary

本次不修改 Frozen Core 1.3、PVB v3、PSB v3、Style v2、State Resolver / ShotSpec output contract、W003 formula、Ark strategy。

## Failure policy

- Story/identity/reference/state hard error：Block / current Unit repair according to owning stage.
- Production Semantics `needs_adaptation/blocked`：不得进入最终 Shot Prompt，不使用 description fallback。
- Audio-only information：保留 metadata，不伪装成视觉 action。
- Diegetic text：只允许 source-evidence 明示内容；其他可阅读文字继续禁止。
