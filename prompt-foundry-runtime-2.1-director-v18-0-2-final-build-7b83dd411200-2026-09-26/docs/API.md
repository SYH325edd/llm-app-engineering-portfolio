# Prompt Foundry Runtime 2.1 API

Base URL 默认：`http://127.0.0.1:8000`

## Health

`GET /api/health`

```json
{"status":"ok","version":"2.1.0","runtime":"2.1","framework":"1.3-frozen","build_id":"7b83dd411200","contracts":{"story_bible":"story_bible.v14","scene_plan":"scene_plan.v8","script":"script_scene.v12","storyboard":"storyboard_scene.v16","pvb":"pvb_character.v3_1","psb":"psb_scene.v5","style_guide":"style_guide.v3","production_semantics":"production_semantics_shot.v1j","director":"director_shot.v18_0_2","state_shotspec":"state_shotspec.v2","compiler":"consumption_v2m"}}
```

## Model configuration

- `GET /api/config`：安全配置状态和 Key 掩码；不返回完整 Key。
- `PUT /api/config`：保存 `api_key / model / base_url / timeout_seconds / max_completion_tokens`。
- `POST /api/model/test`：测试当前 Ark 配置。

## Runs

### `POST /api/runs`

```json
{"title":"项目标题","source_text":"小说全文"}
```

生产模式立即返回 Run，后台按 Unit 执行。

### `GET /api/runs`

历史摘要：runtime/framework version、stage/unit、status、counts。

### `GET /api/runs/{run_id}`

完整 Run、Units、validations、artifacts、events。

### `GET /api/runs/{run_id}/events`

Unit start/reuse/complete/fail/runtime restart 等事件。

### `GET /api/runs/{run_id}/outputs`

返回当前可见 canonical 结果。Stage 08 尚未执行时允许查看 upstream Script/Storyboard/PVB/PSB/Style candidates，但 Character/Scene/Shot final prompts 为空。

### `POST /api/runs/{run_id}/resume`

从 canonical checkpoints 继续，input hash 未变化的 completed Unit 不重跑。

### `POST /api/runs/{run_id}/units/{unit_id}/retry`

只主动失效目标 Unit。真正受影响的下游由 input hash 自动失效。
