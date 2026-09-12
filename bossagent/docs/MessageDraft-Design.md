# Message Draft Center Design

## 功能定位

AI Message Draft Center 用于生成沟通话术草稿，不负责真实发送。

适用两端：

- 招聘端：HR 给候选人的第一句沟通话术。
- 求职端：求职者给 HR / 招聘方的第一句沟通话术。

草稿作为真实发送前的安全中间层，便于人工检查、复制和后续审批。

## Provider 接口

`AIProvider` 新增：

```python
generate_recruiter_message(candidate, recruiter_profile, match_analysis=None)
generate_jobseeker_message(job, jobseeker_profile, match_analysis=None)
```

## 招聘端话术

输入：

- candidate
- recruiter_profile
- match_analysis

输出：

- 中文
- 简短
- 礼貌
- 不超过 100 字
- 不夸张
- 不编造经历
- 不承诺薪资、面试、offer 或结果

## 求职端话术

输入：

- job
- jobseeker_profile
- match_analysis

输出同样遵守：

- 中文
- 简短
- 礼貌
- 不超过 100 字
- 不夸张
- 不编造经历
- 不承诺无法确定的信息

## Mock / DeepSeek 行为

### Mock Provider

默认启用：

- 不调用外部 API
- 输出稳定
- 可用于测试和本地演示

### DeepSeek Provider

只有当 AI Settings 选择 `deepseek` 且环境变量 `DEEPSEEK_API_KEY` 存在时，才会调用真实 API。

DeepSeek 失败时会 fallback 到本地模板草稿。

## 草稿保存

不修改 schema。草稿保存到 `logs.payload`：

```json
{
  "message_draft": true,
  "draft_type": "recruiter",
  "target_id": "",
  "target_name": "",
  "content": "",
  "ai_provider": "mock",
  "fallback_used": false,
  "status": "draft",
  "real_send": false,
  "draft_only": true,
  "match_analysis": {}
}
```

## 页面

### `/message-drafts`

展示草稿列表：

- 类型
- 对象
- 草稿内容摘要
- AI Provider
- 状态
- 创建时间
- 查看详情

### `/message-drafts/{draft_id}`

展示：

- 草稿全文
- 关联对象
- 匹配分析摘要
- AI Provider
- fallback 状态
- 复制按钮

## Flow 接入

Recruit Flow 结果页增加：

```text
生成沟通草稿
```

Job Flow 结果页增加：

```text
生成求职沟通草稿
```

两个按钮都只生成草稿，不发送。

## 安全限制

Message Draft Center 不允许：

- 出现“发送”按钮
- 调用 Boss
- 真实发送
- 真实投递
- 展示 API Key
- 展示 `.env`

logs payload 必须包含：

```json
{
  "real_send": false,
  "draft_only": true
}
```

## 为什么只生成草稿不发送

真实发送属于高风险动作，必须经过：

- Safety Guard
- 频率限制
- 用户确认短语
- 人工可见日志
- 单次 limit 限制

草稿中心先把 AI 内容生产与真实发送解耦，避免用户在未检查话术时触发平台行为。

## 后续真实发送入口规划

后续如果开发真实发送入口，应复用草稿内容，但必须：

- 只允许选中单条草稿
- 通过 Safety Guard
- 要求确认短语
- 写入 conversations/messages/logs
- 明确标记 `real_send=true`

本步骤不实现真实发送。
