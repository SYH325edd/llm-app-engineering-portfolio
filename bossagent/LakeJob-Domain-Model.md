# LakeJob Core V1 Domain Model

目标：建立 LakeJob Core 的长期数据骨架，支撑未来 JobRadar、RecruitRadar、多平台、多账号、岗位池、候选池、会话、消息和调度系统。

本文件只描述领域模型和数据库结构，不包含 API、前端、AI、搜索、自动聊天或任何业务实现。

## 设计原则

1. Core 数据模型必须中立，不绑定 Boss、猎聘、智联任一平台。
2. Core 数据模型必须中立，不绑定 JobRadar 或 RecruitRadar 任一产品。
3. 所有实体都有 `id`、`created_at`、`updated_at`、`status`。
4. 平台原始 ID 只作为映射字段，不作为 Core 主键。
5. 岗位池和候选池共用通用池模型。
6. 会话和消息支持岗位、候选人、申请等多种主题。
7. 调度任务只描述任务骨架，不实现任务执行逻辑。
8. 策略只描述配置骨架，不实现 AI、搜索、聊天或匹配规则。
9. 标签通过多对多关联支持所有核心对象。
10. 日志记录系统事件和审计信息，不替代业务状态。

## 状态字段约定

所有核心表都有 `status TEXT NOT NULL DEFAULT 'active'`。不同实体可以使用不同状态集合。

建议状态：

| 实体 | 状态 |
|---|---|
| Platform | `active`, `disabled`, `deprecated` |
| Account | `active`, `inactive`, `locked`, `expired`, `disabled` |
| Job | `active`, `archived`, `closed`, `deleted` |
| Candidate | `active`, `archived`, `unavailable`, `deleted` |
| Application | `draft`, `pending`, `submitted`, `responded`, `rejected`, `withdrawn`, `archived` |
| Conversation | `active`, `paused`, `closed`, `archived` |
| Message | `draft`, `sent`, `received`, `failed`, `deleted` |
| MatchScore | `active`, `stale`, `archived` |
| Task | `scheduled`, `running`, `paused`, `failed`, `completed`, `cancelled` |
| Strategy | `active`, `draft`, `disabled`, `archived` |
| Tag | `active`, `archived` |
| Log | `active`, `archived` |
| Pool | `active`, `archived` |

## Entity: Platform

平台定义。Boss、猎聘、智联都应作为 Platform 记录存在。

字段：

| 字段 | 说明 |
|---|---|
| `id` | UUID 主键 |
| `code` | 平台唯一代码，如 `boss`, `liepin`, `zhaopin` |
| `name` | 平台显示名 |
| `category` | 平台类型，如 `job_board`, `social`, `internal` |
| `base_url` | 平台基础地址 |
| `status` | 平台状态 |
| `config` | 平台级扩展配置 JSON |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

关系：

- 一个 Platform 有多个 Account。
- 一个 Platform 有多个 Job。
- 一个 Platform 有多个 Candidate。
- 一个 Platform 有多个 Conversation。
- 一个 Platform 有多个 Task。

后续扩展字段：

- 平台限流配置。
- 平台验证码处理状态。
- 平台地区编码表。
- 平台能力声明，如是否支持候选搜索、岗位搜索、消息发送。

## Entity: Account

平台账号。支持 JobRadar 求职账号，也支持 RecruitRadar 招聘账号。

字段：

| 字段 | 说明 |
|---|---|
| `id` | UUID 主键 |
| `platform_id` | 所属平台 |
| `account_type` | `job_seeker`, `recruiter`, `admin`, `system` |
| `display_name` | 账号显示名 |
| `external_account_id` | 平台账号 ID |
| `profile_ref` | 浏览器 profile 或账号资料引用 |
| `status` | 账号状态 |
| `metadata` | 账号扩展信息 JSON |
| `last_seen_at` | 最后可用时间 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

关系：

- 多个 Account 属于一个 Platform。
- 一个 Account 可以拥有多个 PlatformSession。
- 一个 Account 可以创建多个 Job、Candidate、Conversation、Task、Strategy、Pool、Log。

一对多：

- Platform 1 - N Account。
- Account 1 - N Conversation。
- Account 1 - N Task。
- Account 1 - N Strategy。

后续扩展字段：

- 登录方式。
- 账号安全等级。
- 账号每日限额。
- 账号所属团队。

## Entity: PlatformSession

账号的平台会话状态。它是多账号浏览器 session 的基础骨架。

字段：

| 字段 | 说明 |
|---|---|
| `id` | UUID 主键 |
| `account_id` | 账号 |
| `platform_id` | 平台 |
| `session_type` | `browser`, `api`, `cookie`, `manual` |
| `profile_dir` | 浏览器 profile 路径引用 |
| `storage_state_ref` | storage state 引用 |
| `status` | 会话状态 |
| `last_checked_at` | 最后检查时间 |
| `expires_at` | 过期时间 |
| `metadata` | 扩展信息 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

关系：

- Account 1 - N PlatformSession。
- Platform 1 - N PlatformSession。

后续扩展字段：

- session 健康分。
- 风控标记。
- 最近验证码时间。

## Entity: Job

岗位标准模型。可由 JobRadar 搜索得到，也可被 RecruitRadar 用作招聘职位。

字段：

| 字段 | 说明 |
|---|---|
| `id` | UUID 主键 |
| `platform_id` | 来源平台 |
| `account_id` | 采集或拥有该岗位的账号 |
| `external_job_id` | 平台岗位 ID |
| `source_url` | 平台原始 URL |
| `title` | 岗位标题 |
| `company_name` | 公司名称 |
| `salary_min` | 薪资下限 |
| `salary_max` | 薪资上限 |
| `salary_text` | 原始薪资文本 |
| `currency` | 币种 |
| `city` | 城市 |
| `location` | 更详细地点 |
| `experience_text` | 经验要求 |
| `education_text` | 学历要求 |
| `description` | JD 描述 |
| `status` | 岗位状态 |
| `raw_data` | 平台原始数据 JSON |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

关系：

- Platform 1 - N Job。
- Account 1 - N Job。
- Job 1 - N Application。
- Job N - N Tag。
- Job N - N Pool。
- Job 1 - N MatchScore。

后续扩展字段：

- 岗位技能解析。
- 福利标签。
- 公司实体。
- 岗位有效期。
- 平台刷新时间。

## Entity: Candidate

候选人标准模型。RecruitRadar 的核心对象，也可被 JobRadar 用于自我画像。

字段：

| 字段 | 说明 |
|---|---|
| `id` | UUID 主键 |
| `platform_id` | 来源平台 |
| `account_id` | 采集或拥有该候选人的账号 |
| `external_candidate_id` | 平台候选人 ID |
| `source_url` | 平台原始 URL |
| `name` | 候选人姓名或展示名 |
| `headline` | 候选人标题 |
| `current_company` | 当前公司 |
| `current_title` | 当前职位 |
| `city` | 城市 |
| `location` | 详细地点 |
| `experience_text` | 经验摘要 |
| `education_text` | 学历摘要 |
| `skills` | 技能 JSON |
| `resume_text` | 简历文本 |
| `status` | 候选人状态 |
| `raw_data` | 平台原始数据 JSON |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

关系：

- Platform 1 - N Candidate。
- Account 1 - N Candidate。
- Candidate 1 - N Application。
- Candidate N - N Tag。
- Candidate N - N Pool。
- Candidate 1 - N MatchScore。

后续扩展字段：

- 期望薪资。
- 求职状态。
- 最近活跃时间。
- 联系方式安全引用。

## Entity: Application

岗位和候选人之间的关系记录。对 JobRadar 来说是求职申请；对 RecruitRadar 来说可表示邀约、推荐或招聘流程。

字段：

| 字段 | 说明 |
|---|---|
| `id` | UUID 主键 |
| `platform_id` | 平台 |
| `account_id` | 执行动作的账号 |
| `job_id` | 岗位 |
| `candidate_id` | 候选人 |
| `direction` | `jobradar`, `recruitradar` |
| `external_application_id` | 平台申请或流程 ID |
| `stage` | 流程阶段 |
| `status` | 申请状态 |
| `submitted_at` | 提交时间 |
| `last_activity_at` | 最近活动时间 |
| `metadata` | 扩展信息 JSON |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

关系：

- Job 1 - N Application。
- Candidate 1 - N Application。
- Application 1 - N Conversation。
- Application 1 - N MatchScore。

后续扩展字段：

- 面试阶段。
- offer 阶段。
- 拒绝原因。
- 负责人。

## Entity: Conversation

会话标准模型。支持围绕岗位、候选人或申请建立会话。

字段：

| 字段 | 说明 |
|---|---|
| `id` | UUID 主键 |
| `platform_id` | 平台 |
| `account_id` | 所属账号 |
| `application_id` | 可选，关联申请 |
| `job_id` | 可选，关联岗位 |
| `candidate_id` | 可选，关联候选人 |
| `external_conversation_id` | 平台会话 ID |
| `subject_type` | `job`, `candidate`, `application`, `general` |
| `subject_id` | 主题对象 ID |
| `counterparty_name` | 对方名称 |
| `counterparty_role` | `hr`, `candidate`, `recruiter`, `system`, `unknown` |
| `last_message_at` | 最后消息时间 |
| `last_message_preview` | 最后消息摘要 |
| `unread_count` | 未读数 |
| `status` | 会话状态 |
| `metadata` | 扩展信息 JSON |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

关系：

- Account 1 - N Conversation。
- Platform 1 - N Conversation。
- Application 1 - N Conversation。
- Conversation 1 - N Message。
- Conversation N - N Tag。

后续扩展字段：

- 会话优先级。
- 是否允许自动聊天。
- 最近同步 cursor。
- 联系方式交换记录。

## Entity: Message

消息标准模型。

字段：

| 字段 | 说明 |
|---|---|
| `id` | UUID 主键 |
| `conversation_id` | 会话 |
| `platform_id` | 平台 |
| `account_id` | 所属账号 |
| `external_message_id` | 平台消息 ID |
| `sender_type` | `self`, `counterparty`, `system`, `ai`, `unknown` |
| `sender_name` | 发送方显示名 |
| `content` | 文本内容 |
| `content_type` | `text`, `image`, `file`, `system`, `unknown` |
| `direction` | `inbound`, `outbound`, `internal` |
| `sent_at` | 平台发送时间 |
| `delivered_at` | 送达时间 |
| `read_at` | 已读时间 |
| `status` | 消息状态 |
| `metadata` | 扩展信息 JSON |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

关系：

- Conversation 1 - N Message。
- Account 1 - N Message。
- Platform 1 - N Message。

后续扩展字段：

- 附件引用。
- 消息审核状态。
- AI 生成引用。

## Entity: MatchScore

匹配分。只保存匹配结果骨架，不实现 AI 或匹配算法。

字段：

| 字段 | 说明 |
|---|---|
| `id` | UUID 主键 |
| `job_id` | 岗位 |
| `candidate_id` | 候选人 |
| `application_id` | 可选申请 |
| `strategy_id` | 使用的策略 |
| `score` | 总分 |
| `score_type` | `manual`, `rule`, `ai`, `hybrid` |
| `summary` | 匹配摘要 |
| `details` | 分项结果 JSON |
| `status` | 状态 |
| `computed_at` | 计算时间 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

关系：

- Job 1 - N MatchScore。
- Candidate 1 - N MatchScore。
- Strategy 1 - N MatchScore。

后续扩展字段：

- 可解释性字段。
- 分项权重。
- 模型版本。

## Entity: Task

调度任务骨架。支持自动搜索、自动聊天、同步消息等未来任务，但本阶段不实现任务逻辑。

字段：

| 字段 | 说明 |
|---|---|
| `id` | UUID 主键 |
| `platform_id` | 平台 |
| `account_id` | 账号 |
| `strategy_id` | 策略 |
| `task_type` | `search_jobs`, `search_candidates`, `sync_messages`, `auto_chat`, `match`, `cleanup`, `custom` |
| `name` | 任务名 |
| `schedule_type` | `manual`, `interval`, `cron`, `event` |
| `schedule_expr` | cron 或 interval 表达式 |
| `payload` | 任务参数 JSON |
| `status` | 任务状态 |
| `last_run_at` | 上次执行时间 |
| `next_run_at` | 下次执行时间 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

关系：

- Account 1 - N Task。
- Platform 1 - N Task。
- Strategy 1 - N Task。
- Task 1 - N TaskRun。
- Task 1 - N Log。

后续扩展字段：

- 并发锁。
- 重试策略。
- SLA。
- 任务所有者。

## Entity: TaskRun

任务运行记录。

字段：

| 字段 | 说明 |
|---|---|
| `id` | UUID 主键 |
| `task_id` | 任务 |
| `status` | 运行状态 |
| `started_at` | 开始时间 |
| `finished_at` | 结束时间 |
| `result` | 运行结果 JSON |
| `error_message` | 错误摘要 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

关系：

- Task 1 - N TaskRun。

## Entity: Strategy

策略配置骨架。可用于搜索策略、聊天策略、匹配策略、限流策略等，但本阶段不实现策略逻辑。

字段：

| 字段 | 说明 |
|---|---|
| `id` | UUID 主键 |
| `account_id` | 策略所有账号，可为空 |
| `platform_id` | 策略适用平台，可为空 |
| `strategy_type` | `search`, `chat`, `match`, `schedule`, `rate_limit`, `custom` |
| `name` | 策略名称 |
| `description` | 描述 |
| `config` | 策略配置 JSON |
| `status` | 策略状态 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

关系：

- Strategy 1 - N Task。
- Strategy 1 - N MatchScore。
- Strategy N - N Tag。

后续扩展字段：

- 版本号。
- 发布状态。
- 适用产品。

## Entity: Tag

标签。用于岗位、候选人、会话、申请、策略等对象。

字段：

| 字段 | 说明 |
|---|---|
| `id` | UUID 主键 |
| `name` | 标签名 |
| `slug` | 唯一标识 |
| `color` | 显示颜色 |
| `status` | 标签状态 |
| `metadata` | 扩展信息 JSON |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

关系：

- Tag N - N Job。
- Tag N - N Candidate。
- Tag N - N Conversation。
- Tag N - N Application。
- Tag N - N Strategy。

中间表：

- `taggings`

## Entity: Pool

通用池。支持岗位池和候选池。

字段：

| 字段 | 说明 |
|---|---|
| `id` | UUID 主键 |
| `account_id` | 所属账号 |
| `pool_type` | `job`, `candidate` |
| `product` | `jobradar`, `recruitradar`, `core` |
| `name` | 池名称 |
| `description` | 描述 |
| `status` | 池状态 |
| `metadata` | 扩展 JSON |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

关系：

- Account 1 - N Pool。
- Pool 1 - N PoolItem。

## Entity: PoolItem

池条目。

字段：

| 字段 | 说明 |
|---|---|
| `id` | UUID 主键 |
| `pool_id` | 所属池 |
| `item_type` | `job`, `candidate` |
| `job_id` | 可选岗位 |
| `candidate_id` | 可选候选人 |
| `status` | 条目状态 |
| `note` | 备注 |
| `metadata` | 扩展 JSON |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

关系：

- Pool 1 - N PoolItem。
- Job 1 - N PoolItem。
- Candidate 1 - N PoolItem。

## Entity: Log

日志和审计记录。

字段：

| 字段 | 说明 |
|---|---|
| `id` | UUID 主键 |
| `platform_id` | 可选平台 |
| `account_id` | 可选账号 |
| `task_id` | 可选任务 |
| `conversation_id` | 可选会话 |
| `log_type` | `audit`, `system`, `task`, `platform`, `error`, `security` |
| `level` | `debug`, `info`, `warning`, `error`, `critical` |
| `message` | 日志文本 |
| `entity_type` | 相关实体类型 |
| `entity_id` | 相关实体 ID |
| `payload` | 结构化日志 JSON |
| `status` | 日志状态 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

关系：

- Account 1 - N Log。
- Platform 1 - N Log。
- Task 1 - N Log。
- Conversation 1 - N Log。

后续扩展字段：

- trace id。
- request id。
- actor id。
- IP 或设备信息。

## 一对多关系

| 父实体 | 子实体 |
|---|---|
| Platform | Account |
| Platform | Job |
| Platform | Candidate |
| Platform | Conversation |
| Platform | Task |
| Account | PlatformSession |
| Account | Job |
| Account | Candidate |
| Account | Conversation |
| Account | Task |
| Account | Strategy |
| Account | Pool |
| Job | Application |
| Candidate | Application |
| Application | Conversation |
| Conversation | Message |
| Task | TaskRun |
| Strategy | Task |
| Pool | PoolItem |

## 多对多关系

| 关系 | 中间表 |
|---|---|
| Tag N - N Job | `taggings` |
| Tag N - N Candidate | `taggings` |
| Tag N - N Conversation | `taggings` |
| Tag N - N Application | `taggings` |
| Tag N - N Strategy | `taggings` |
| Pool N - N Job | `pool_items` |
| Pool N - N Candidate | `pool_items` |

`taggings` 使用 `entity_type` + `entity_id` 支持多实体标签。`pool_items` 使用 `item_type` + 具体外键支持岗位池和候选池。

## 索引设计

核心索引：

| 表 | 索引 |
|---|---|
| `platforms` | `code` 唯一 |
| `accounts` | `(platform_id, external_account_id)` 唯一 |
| `platform_sessions` | `(account_id, session_type)` |
| `jobs` | `(platform_id, external_job_id)` 唯一 |
| `jobs` | `status`, `city`, `company_name`, `created_at` |
| `candidates` | `(platform_id, external_candidate_id)` 唯一 |
| `candidates` | `status`, `city`, `current_company`, `created_at` |
| `applications` | `(job_id, candidate_id, direction)` |
| `conversations` | `(platform_id, external_conversation_id)` |
| `conversations` | `account_id`, `status`, `last_message_at` |
| `messages` | `conversation_id`, `sent_at`, `(platform_id, external_message_id)` |
| `match_scores` | `(job_id, candidate_id, strategy_id)` |
| `tasks` | `account_id`, `task_type`, `status`, `next_run_at` |
| `strategies` | `strategy_type`, `status` |
| `tags` | `slug` 唯一 |
| `taggings` | `(tag_id, entity_type, entity_id)` 唯一 |
| `pools` | `(account_id, pool_type, name)` |
| `pool_items` | `(pool_id, item_type, job_id, candidate_id)` |
| `logs` | `created_at`, `level`, `log_type`, `entity_type/entity_id` |

JSONB 索引：

- `jobs.raw_data`
- `candidates.raw_data`
- `tasks.payload`
- `strategies.config`
- `logs.payload`

这些使用 GIN 索引，便于后续按平台原始字段查询。

## 后续扩展字段

建议保留但本阶段不实现的扩展方向：

| 方向 | 可扩展位置 |
|---|---|
| 公司标准实体 | `companies` 表 |
| 联系方式安全存储 | `contacts` 表 |
| AI 输出追踪 | `ai_runs` 表 |
| 事件溯源 | `events` 表 |
| 多租户 | 所有表增加 `tenant_id` |
| 团队协作 | `users`, `teams`, `memberships` |
| 附件 | `attachments` 表 |
| 审批流 | `approvals` 表 |
| 平台能力声明 | `platform_capabilities` 表 |
| 消息模板 | `message_templates` 表 |

## V1 数据骨架边界

V1 只建立以下内容：

- 实体定义。
- 实体关系。
- PostgreSQL schema。
- 索引。
- JSONB 扩展字段。

V1 不包含：

- API。
- FastAPI。
- 前端。
- 搜索实现。
- 自动聊天实现。
- AI 匹配实现。
- 平台适配器实现。
- 调度执行器实现。
