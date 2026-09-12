# Match Analysis Design

## 为什么需要匹配分析

原有 Recruit Flow / Job Flow 主要展示匹配分数。分数可以排序，但不能解释为什么匹配、风险在哪里、下一步该做什么。

Match Analysis 将评分升级为结构化解释：

- 匹配度
- 匹配理由
- 优势
- 风险点
- 建议动作
- 标签

## 统一接口

新增 `match_analysis.py`：

```python
analyze_candidate_match(candidate, recruiter_profile)
analyze_job_match(job, jobseeker_profile)
```

统一返回：

```json
{
  "score": 0,
  "level": "A/B/C",
  "reasons": [],
  "strengths": [],
  "risks": [],
  "suggested_action": "",
  "tags": [],
  "ai_provider": "mock",
  "fallback_used": false
}
```

## 招聘端分析逻辑

Recruit Flow 调用：

```text
candidate vs recruiter_profile
```

用于判断候选人与招聘画像是否匹配。结果页展示：

- 分数
- 等级
- 匹配理由摘要
- 优势
- 风险
- 建议动作
- 标签

## 求职端分析逻辑

Job Flow 调用：

```text
job vs jobseeker_profile
```

用于判断岗位与求职者画像是否匹配。结果页展示同样字段。

## AI Provider 扩展

`AIProvider` 新增：

```python
analyze_candidate_match(candidate, job_profile)
analyze_job_match(job, user_profile)
```

### Mock Provider

默认使用 Mock Provider：

- 不调用外部 API
- 结果稳定
- 适合测试和本地演示

### DeepSeek Provider

当 AI Settings 选择 `deepseek` 且环境变量存在 `DEEPSEEK_API_KEY` 时，DeepSeek Provider 会调用真实接口。

Prompt 要求：

- 输出 JSON
- 不夸张
- 不编造经历
- 不泄露 API Key
- 不生成违法/违规建议
- 不建议绕过平台

## fallback 机制

如果 DeepSeek 或其他 Provider 失败：

1. 使用规则分析 fallback。
2. 返回 `fallback_used=true`。
3. 保留安全错误摘要，不泄露 API Key。
4. 页面显示“AI分析失败，已使用规则分析”。
5. logs payload 中记录 fallback 状态。

## 写入策略

`match_scores` 保持原有写法：

- `score`
- `score_type`
- `summary`
- `details`

详细分析写入 `logs.payload`：

```json
{
  "match_analysis": true,
  "target_type": "candidate",
  "target_id": "",
  "score": 88,
  "level": "A",
  "reasons": [],
  "strengths": [],
  "risks": [],
  "suggested_action": "",
  "tags": [],
  "ai_provider": "mock",
  "fallback_used": false
}
```

## 页面展示

Recruit Flow 和 Job Flow 结果页直接展示完整分析字段。

新增可选详情页：

```text
/match-analysis/{log_id}
```

该页面从 logs 读取 `match_analysis=true` 的 payload 并展示完整分析。

## 安全限制

Match Analysis 不会：

- 触发 Boss
- 发送真实消息
- 真实投递
- 修改 schema
- 展示 API Key
- 展示 `.env`

DeepSeek 默认不启用，除非 AI Settings 选择 `deepseek` 且环境变量提供 key。
