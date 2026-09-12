# Message Draft Safe Send

## 为什么必须人工确认

话术草稿发送是危险动作：消息会通过 BOSS 发出，且不可撤回。

因此发送必须满足：

- 用户在草稿详情页人工查看草稿全文。
- 用户输入确认短语。
- 单次只发送当前 `draft_id` 对应的一条消息。
- 发送前必须经过 Safety Guard。
- 成功、失败、拦截都写入 logs。

## 确认流程

草稿详情页 `/message-drafts/{draft_id}` 增加“发送此草稿”区域。

提示：

```text
真实发送前请确认：该消息会通过 BOSS 发出，且不可撤回。
```

确认短语：

```text
SEND_DRAFT_ONCE
```

未输入或输入错误会拒绝发送。

## Safety Guard 集成

发送前调用：

```python
guard_real_message(...)
```

如果 Safety Guard 拦截：

- 不调用 sender。
- 页面显示拦截原因。
- logs 写入：

```json
{
  "message_draft_send": true,
  "blocked": true,
  "reason": "daily_real_message_limit_reached"
}
```

## 发送路径

### recruiter 草稿

`draft_type=recruiter`

目标是候选人草稿。发送时读取 candidate，并要求存在 `source_url`。

默认真实 sender 使用：

```python
BossAdapter.send_message(...)
```

### jobseeker 草稿

`draft_type=jobseeker`

目标是岗位草稿。发送时读取 job，并要求存在 `source_url`。

默认真实 sender 同样通过：

```python
BossAdapter.send_message(...)
```

如果缺少真实目标页面链接，或链接是 `mock://`，会拒绝：

```text
缺少目标页面链接，无法发送，请先通过真实搜索或补充 source_url。
```

## 状态记录方式

不修改 schema。发送状态写入 `logs.payload`：

```json
{
  "message_draft_send": true,
  "draft_id": "",
  "draft_type": "jobseeker",
  "target_id": "",
  "real_send": true,
  "sent": true,
  "success": true,
  "content": ""
}
```

草稿列表读取最新发送事件并显示：

- `draft`
- `sent`
- `failed`
- `blocked`

已发送草稿不允许重复发送。

## 失败场景

会拒绝发送并写 logs：

- 确认短语错误
- 空内容
- 内容超过 300 字
- Safety Guard 拦截
- 缺少 `source_url`
- `source_url` 为 `mock://`
- sender 抛异常或返回 false

## 安全限制

- 不允许批量发送
- 不允许绕过确认短语
- 不允许发送空内容
- 不允许发送超过 300 字内容
- 不展示 API Key
- 不展示 `.env`
- 不绕过 Safety Guard

## 后续优化

- 为 recruiter/jobseeker 分别提供更细的发送上下文适配。
- 发送成功后同步写入 conversations/messages。
- 增加发送前截图确认。
- 增加更严格的每日和单公司频控视图。
