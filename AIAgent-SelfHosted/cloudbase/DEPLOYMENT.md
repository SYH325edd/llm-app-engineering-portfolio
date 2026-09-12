# 客户 CloudBase 与 gradingWorker 正式部署清单

## 1. 客户环境

- 小程序 AppID：`wx000000000000000000`
- CloudBase 环境 ID：`cloudbase-d5g764d4w29a8d93e`
- 运营主体：示例教育科技有限公司

不得继续连接开发者个人 CloudBase、个人 Ark Key 或个人 TTS Key。真实密钥只配置在客户自己的服务环境变量中，不写入源码、文档或压缩包。

## 2. 当前批改执行架构

正式批改执行器只有一个：

```text
小程序 → appApi.dispatchTask() → grading_tasks(PENDING)
→ gradingWorker Scheduler → DISPATCHED
→ claim → RUNNING + owner/attempt/lease
→ 执行当前业务阶段
```

阶段完成后的状态：

- 仍有下一阶段：保存 `currentStage`，队列回到 `PENDING`，Scheduler 继续调度。
- 需要补充答案或确认：业务状态进入 `NEED_ANSWER` / `NEED_CONFIRMATION`，队列进入 `WAITING_USER`。
- 用户完成补充或确认：`appApi.dispatchTask()` 重新投递原任务。
- 最终结果：只有 `task.status=COMPLETED` 且 `resultId` 存在，队列才进入 `COMPLETED`。

`cloudfunctions/taskWorker` 目录为兼容入口，只把 `taskId` 转发到 `gradingWorker`，不再执行批改、阶段续跑或 Ark 调用。不得为它配置阶段自调用触发器。

## 3. 创建数据库与索引

1. 创建 `collections.json` 中的全部集合，包括 `teacher_privacy_consents`。
2. 导入 `database.rules.json`，客户端对业务集合默认禁止直接读写。
3. 导入 `indexes.json` 中的索引。
4. 确认 `grading_tasks` 支持按 `workerQueueStatus`、`workerNextDispatchAt`、`workerLeaseUntil` 查询。

## 4. 配置云存储

导入 `storage.rules.json`。存储规则限制为已登录微信身份，单文件不超过 5MB。不得将存储桶设置为公开读写。

## 5. 部署 gradingWorker（CloudRun / 云托管）

构建目录：

```text
cloudrun/gradingWorker
```

Dockerfile 已使用锁文件确定性安装：

```dockerfile
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
```

必须配置：

- `CLOUDBASE_ENV_ID`
- `GRADING_WORKER_TOKEN`
- `ARK_API_KEY`
- `ARK_MINI_ENDPOINT`
- `ARK_LITE_ENDPOINT`
- `GRADING_WORKER_CONCURRENCY=5`
- `GRADING_WORKER_QUEUE_LIMIT=100`
- `GRADING_WORKER_LEASE_MS=300000`
- `GRADING_WORKER_HEARTBEAT_MS=30000`
- `GRADING_WORKER_SHUTDOWN_GRACE_MS=30000`

正式启用远程策略授权时，还必须配置：

- `STRATEGY_SERVICE_URL`
- `STRATEGY_CUSTOMER_ID`
- `STRATEGY_LICENSE_ID`
- `STRATEGY_APP_ID_HASH`
- `STRATEGY_LICENSE_KEY`
- `STRATEGY_PUBLIC_KEY_BASE64`
- `STRATEGY_REMOTE_REQUIRED=true`

健康检查：

- `GET /health`：进程和 Scheduler 状态。
- `GET /ready`：必需环境变量、CloudBase 普通读取和服务初始化状态。返回 200 才可接收流量。

内部接口必须通过：

```text
Authorization: Bearer <GRADING_WORKER_TOKEN>
```

## 6. 配置并部署 CloudBase 云函数

在微信开发者工具中执行“上传并部署：云端安装依赖”：

1. `appApi`
2. `taskWorker`（兼容转发入口）
3. `ttsWorker`
4. `purgeArchived`
5. `exportData`
6. `initDatabase`

### appApi

配置：

- `GRADING_WORKER_BASE_URL`
- `GRADING_WORKER_TOKEN`
- `GRADING_WORKER_ENQUEUE_TIMEOUT_MS=5000`

创建任务、失败重试、补充答案、确认答案和马虎训练恢复均通过同一个 `dispatchTask()` 投递。

### taskWorker

仅配置：

- `GRADING_WORKER_BASE_URL`
- `GRADING_WORKER_TOKEN`
- `GRADING_WORKER_ENQUEUE_TIMEOUT_MS=5000`

它只作为旧调用兼容桥，不配置 Ark Key，不配置阶段自调用，不承担批改执行。

### ttsWorker

配置客户自己的 TTS 参数；需要 Ark 旁白或远程策略时，再配置对应 Ark 与策略变量。

### initDatabase

只临时配置一次性 `DATABASE_BOOTSTRAP_TOKEN`。初始化完成后关闭或删除该函数，并删除或轮换 Token。

## 7. 触发器与恢复机制

- `gradingWorker`：使用内置数据库 Scheduler；启动恢复、3 秒活跃扫描、60 秒空闲保险扫描继续保留。
- `taskWorker`：不得配置定时触发器，不得配置自调用。
- `purgeArchived`：保留每日清理触发器。
- `ttsWorker`：按现有业务链调用，不配置每分钟扫描。
- 当前阶段暂时保留 `getTask` 中的 kick；待真实环境证明后台 Scheduler 可独立恢复后，再降级或移除。

## 8. 数据库初始化

1. 临时配置高强度 `DATABASE_BOOTSTRAP_TOKEN`。
2. 调用 `initDatabase` 完成集合初始化。
3. 核验集合、规则和索引。
4. 停用或删除 `initDatabase`。
5. 删除或轮换 `DATABASE_BOOTSTRAP_TOKEN`。

## 9. 客户超级管理员

客户方首位教师进入小程序后，在 `users` 集合设置：

```text
role = super_admin
status = ACTIVE
```

必须使用客户方微信账号，不得保留开发者测试管理员、测试教师或测试学生。

## 10. 上线前真实验收

必须使用客户测试环境完成：

1. 普通难题任务完整经过准备图片、首次批改、独立复核、最终结果阶段。
2. 马虎检测完整完成。
3. 补充答案、确认答案和失败重试均继续同一任务。
4. 中间阶段不会提前进入结果页。
5. 没有 `resultId` 时不能进入结果页。
6. PENDING、DISPATCHED 和过期 RUNNING 任务能够自动恢复。
7. 未过期 RUNNING 不会被重复领取。
8. Worker 重启后任务能够继续。
9. 两个实例短暂并存时，同一阶段只由一个 owner/attempt 栅栏通过。
10. 模拟 100 条任务、并发上限 5 时不丢失、不重复并达到明确终态；真实 Ark 先使用 10—20 条并发验证限流、耗时和费用。

本地自动化测试通过不等于客户云环境已部署成功。正式上线前仍需结合 CloudRun 日志、CloudBase 数据记录和真实 Ark 返回完成上述验收。
