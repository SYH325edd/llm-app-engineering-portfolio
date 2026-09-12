# LakeJob Core V1 ERD

本文件使用 Mermaid 描述 LakeJob Core V1 数据骨架。它只表示实体关系，不表示业务流程。

```mermaid
erDiagram
    PLATFORMS {
        uuid id PK
        text code UK
        text name
        text category
        text base_url
        text status
        jsonb config
        timestamptz created_at
        timestamptz updated_at
    }

    ACCOUNTS {
        uuid id PK
        uuid platform_id FK
        text account_type
        text display_name
        text external_account_id
        text profile_ref
        text status
        jsonb metadata
        timestamptz last_seen_at
        timestamptz created_at
        timestamptz updated_at
    }

    PLATFORM_SESSIONS {
        uuid id PK
        uuid account_id FK
        uuid platform_id FK
        text session_type
        text profile_dir
        text storage_state_ref
        text status
        timestamptz last_checked_at
        timestamptz expires_at
        jsonb metadata
        timestamptz created_at
        timestamptz updated_at
    }

    JOBS {
        uuid id PK
        uuid platform_id FK
        uuid account_id FK
        text external_job_id
        text source_url
        text title
        text company_name
        numeric salary_min
        numeric salary_max
        text salary_text
        text currency
        text city
        text location
        text experience_text
        text education_text
        text description
        text status
        jsonb raw_data
        timestamptz created_at
        timestamptz updated_at
    }

    CANDIDATES {
        uuid id PK
        uuid platform_id FK
        uuid account_id FK
        text external_candidate_id
        text source_url
        text name
        text headline
        text current_company
        text current_title
        text city
        text location
        text experience_text
        text education_text
        jsonb skills
        text resume_text
        text status
        jsonb raw_data
        timestamptz created_at
        timestamptz updated_at
    }

    APPLICATIONS {
        uuid id PK
        uuid platform_id FK
        uuid account_id FK
        uuid job_id FK
        uuid candidate_id FK
        text direction
        text external_application_id
        text stage
        text status
        timestamptz submitted_at
        timestamptz last_activity_at
        jsonb metadata
        timestamptz created_at
        timestamptz updated_at
    }

    CONVERSATIONS {
        uuid id PK
        uuid platform_id FK
        uuid account_id FK
        uuid application_id FK
        uuid job_id FK
        uuid candidate_id FK
        text external_conversation_id
        text subject_type
        uuid subject_id
        text counterparty_name
        text counterparty_role
        timestamptz last_message_at
        text last_message_preview
        integer unread_count
        text status
        jsonb metadata
        timestamptz created_at
        timestamptz updated_at
    }

    MESSAGES {
        uuid id PK
        uuid conversation_id FK
        uuid platform_id FK
        uuid account_id FK
        text external_message_id
        text sender_type
        text sender_name
        text content
        text content_type
        text direction
        timestamptz sent_at
        timestamptz delivered_at
        timestamptz read_at
        text status
        jsonb metadata
        timestamptz created_at
        timestamptz updated_at
    }

    MATCH_SCORES {
        uuid id PK
        uuid job_id FK
        uuid candidate_id FK
        uuid application_id FK
        uuid strategy_id FK
        numeric score
        text score_type
        text summary
        jsonb details
        text status
        timestamptz computed_at
        timestamptz created_at
        timestamptz updated_at
    }

    TASKS {
        uuid id PK
        uuid platform_id FK
        uuid account_id FK
        uuid strategy_id FK
        text task_type
        text name
        text schedule_type
        text schedule_expr
        jsonb payload
        text status
        timestamptz last_run_at
        timestamptz next_run_at
        timestamptz created_at
        timestamptz updated_at
    }

    TASK_RUNS {
        uuid id PK
        uuid task_id FK
        text status
        timestamptz started_at
        timestamptz finished_at
        jsonb result
        text error_message
        timestamptz created_at
        timestamptz updated_at
    }

    STRATEGIES {
        uuid id PK
        uuid account_id FK
        uuid platform_id FK
        text strategy_type
        text name
        text description
        jsonb config
        text status
        timestamptz created_at
        timestamptz updated_at
    }

    TAGS {
        uuid id PK
        text name
        text slug UK
        text color
        text status
        jsonb metadata
        timestamptz created_at
        timestamptz updated_at
    }

    TAGGINGS {
        uuid id PK
        uuid tag_id FK
        text entity_type
        uuid entity_id
        text status
        timestamptz created_at
        timestamptz updated_at
    }

    POOLS {
        uuid id PK
        uuid account_id FK
        text pool_type
        text product
        text name
        text description
        text status
        jsonb metadata
        timestamptz created_at
        timestamptz updated_at
    }

    POOL_ITEMS {
        uuid id PK
        uuid pool_id FK
        text item_type
        uuid job_id FK
        uuid candidate_id FK
        text status
        text note
        jsonb metadata
        timestamptz created_at
        timestamptz updated_at
    }

    LOGS {
        uuid id PK
        uuid platform_id FK
        uuid account_id FK
        uuid task_id FK
        uuid conversation_id FK
        text log_type
        text level
        text message
        text entity_type
        uuid entity_id
        jsonb payload
        text status
        timestamptz created_at
        timestamptz updated_at
    }

    PLATFORMS ||--o{ ACCOUNTS : owns
    PLATFORMS ||--o{ PLATFORM_SESSIONS : has
    PLATFORMS ||--o{ JOBS : provides
    PLATFORMS ||--o{ CANDIDATES : provides
    PLATFORMS ||--o{ APPLICATIONS : tracks
    PLATFORMS ||--o{ CONVERSATIONS : hosts
    PLATFORMS ||--o{ MESSAGES : carries
    PLATFORMS ||--o{ TASKS : schedules
    PLATFORMS ||--o{ STRATEGIES : scopes
    PLATFORMS ||--o{ LOGS : emits

    ACCOUNTS ||--o{ PLATFORM_SESSIONS : has
    ACCOUNTS ||--o{ JOBS : owns_or_collects
    ACCOUNTS ||--o{ CANDIDATES : owns_or_collects
    ACCOUNTS ||--o{ APPLICATIONS : performs
    ACCOUNTS ||--o{ CONVERSATIONS : owns
    ACCOUNTS ||--o{ MESSAGES : sends_or_receives
    ACCOUNTS ||--o{ TASKS : owns
    ACCOUNTS ||--o{ STRATEGIES : owns
    ACCOUNTS ||--o{ POOLS : owns
    ACCOUNTS ||--o{ LOGS : generates

    JOBS ||--o{ APPLICATIONS : has
    CANDIDATES ||--o{ APPLICATIONS : has
    APPLICATIONS ||--o{ CONVERSATIONS : relates

    JOBS ||--o{ CONVERSATIONS : subject
    CANDIDATES ||--o{ CONVERSATIONS : subject
    CONVERSATIONS ||--o{ MESSAGES : contains

    JOBS ||--o{ MATCH_SCORES : scored
    CANDIDATES ||--o{ MATCH_SCORES : scored
    APPLICATIONS ||--o{ MATCH_SCORES : scored
    STRATEGIES ||--o{ MATCH_SCORES : computes

    STRATEGIES ||--o{ TASKS : configures
    TASKS ||--o{ TASK_RUNS : runs
    TASKS ||--o{ LOGS : records
    CONVERSATIONS ||--o{ LOGS : records

    TAGS ||--o{ TAGGINGS : applies
    POOLS ||--o{ POOL_ITEMS : contains
    JOBS ||--o{ POOL_ITEMS : pooled
    CANDIDATES ||--o{ POOL_ITEMS : pooled
```

## Relationship Summary

一对多关系：

- Platform 到 Account、Job、Candidate、Conversation、Task。
- Account 到 PlatformSession、Job、Candidate、Conversation、Task、Strategy、Pool。
- Job 到 Application、MatchScore、PoolItem。
- Candidate 到 Application、MatchScore、PoolItem。
- Application 到 Conversation、MatchScore。
- Conversation 到 Message、Log。
- Strategy 到 Task、MatchScore。
- Task 到 TaskRun、Log。
- Pool 到 PoolItem。

多对多关系：

- Tag 到多个核心实体，通过 `taggings` 的 `entity_type/entity_id` 表达。
- Pool 到 Job，通过 `pool_items` 表达。
- Pool 到 Candidate，通过 `pool_items` 表达。

约束说明：

- `pool_items` 中 `item_type='job'` 时应有 `job_id`。
- `pool_items` 中 `item_type='candidate'` 时应有 `candidate_id`。
- `conversations.subject_type` 和 `subject_id` 用于未来扩展，当前仍保留直接 `job_id/candidate_id/application_id` 外键。
- `taggings.entity_id` 是多态引用，无法用单一外键表达，必须通过应用层或迁移约束维护一致性。
