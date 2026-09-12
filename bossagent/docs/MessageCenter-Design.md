# Message Center Design

## 定位

Message Center 是 Web Console 的沟通记录中心，用于统一查看和管理 Core 中的 `conversations` / `messages`。

本步骤只做查看和本地状态管理，不提供真实发送入口。

## 页面

### `/messages`

展示会话列表：

- `conversation_id`
- 对象类型：candidate / job / company / application / general
- 对象名称
- 最新消息摘要
- 最新消息时间
- 消息数量
- 状态
- 来源 source
- 查看详情

支持筛选：

- keyword
- status
- source
- date

### `/messages/{conversation_id}`

展示：

- 会话基础信息
- 关联 candidate / job / application
- 消息时间线
- message direction
- message content
- created_at
- status
- logs 摘要

## 数据读取逻辑

`message_center.py` 提供：

- `list_conversations(filters)`
- `get_conversation_detail(conversation_id)`
- `get_latest_conversation_status(conversation_id)`
- `update_conversation_status(conversation_id, status)`
- `list_messages(conversation_id)`

会话列表从 `conversations` 左连接：

- `messages`
- `candidates`
- `jobs`
- `applications`

详情页读取：

- 当前 conversation
- 对应 messages
- 关联 candidate/job/application
- 相关 logs

## 状态管理方案

页面允许本地状态：

- `open`
- `replied`
- `pending`
- `closed`
- `archived`
- `failed`

Core `conversations.status` 当前 schema 只允许：

- `active`
- `paused`
- `closed`
- `archived`

因此本步骤不直接写 `conversations.status`，统一使用 `logs.payload` 作为事件源。

## logs 事件源

状态修改写入 logs：

```json
{
  "message_center": true,
  "conversation_id": "",
  "action": "update_conversation_status",
  "old_status": "open",
  "new_status": "replied",
  "success": true
}
```

读取状态时：

1. 优先读取最新 `message_center=true` 状态事件。
2. 如果没有事件，则从 Core conversation status 映射：
   - `active` -> `open`
   - `closed` -> `closed`
   - `archived` -> `archived`
   - 其他 -> `pending`

## 安全限制

Message Center 不允许：

- 出现“发送消息”按钮
- 出现“真实沟通”按钮
- 调用 BossAutomation
- 触发 BOSS
- 发送真实消息
- 真实投递
- 展示 API Key
- 展示 `.env`

## 后续真实发送入口规划

如后续增加真实发送入口，必须：

- 走 Safety Guard
- 要求确认短语
- 限制单次发送数量
- 写入 messages/logs
- 与 Message Center 状态管理分离

本步骤不实现真实发送。
