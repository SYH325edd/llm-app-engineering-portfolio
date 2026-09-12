# AIAgent 腾讯云 Self-Hosted 部署说明

本文针对当前生产目标：腾讯云北京 `82.157.189.196`，现有 `learning-ai` 必须保留并与 AIAgent 隔离。

## 固定边界

- 不停止、不重建现有 `learning-ai-nginx` / `learning-ai-backend`。
- 不占用现有 `80 / 443 / 8000 / 8188 / 8443 / 6379 / 3306`。
- AIAgent 对宿主机只发布 `127.0.0.1:3100`。
- MongoDB 不发布公网端口，只存在 `aiagent_net`。
- gradingWorker 不发布宿主机端口，只通过 Docker 内网访问。
- 程序放 `/opt/aiagent`，持久数据放 `/data/aiagent`。
- 对外 API 使用 `https://api.example.invalid`。

## 1. DNS

在 DNSPod 只新增：

```text
类型：A
主机记录：api
记录值：82.157.189.196
```

不要修改 `example.invalid` 或 `xuexi.example.invalid` 的现有记录。

## 2. 准备目录

```bash
mkdir -p /opt/aiagent
mkdir -p /data/aiagent/mongo /data/aiagent/files /data/aiagent/backups
chmod 700 /data/aiagent
```

将 AIAgent 工程上传并解压到 `/opt/aiagent`，确保：

```bash
cd /opt/aiagent
pwd
# /opt/aiagent

ls docker-compose.yml server strategy miniapp
```

## 3. 生产环境变量

```bash
cd /opt/aiagent
cp .env.example .env
chmod 600 .env
```

分别生成 5 个不同随机值：

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

依次填写：

```text
SESSION_SECRET
FILE_SIGNING_SECRET
INTERNAL_SERVICE_TOKEN
GRADING_WORKER_TOKEN
DATABASE_BOOTSTRAP_TOKEN
```

必须自行填写的外部服务凭证：

```text
WECHAT_APP_SECRET
ARK_API_KEY / ARK endpoints
QWEN_API_KEY（若使用 Qwen）
TTS_API_KEY / TTS_SPEAKER
```

Strategy 的 customer/license/appIdHash/license key/public key 不需要重复填写，容器启动时直接读取 `strategy/private/`。

真实 Key 只能写服务器 `.env` 或 `strategy/private/`，不要提交 Git、不要写进 miniapp、不要发送到聊天记录。

## 4. 首次构建

```bash
cd /opt/aiagent
docker compose config
docker compose build
```

如果 build 失败，先停止，不要继续执行 `up`。

## 5. 启动数据库与 API

```bash
docker compose up -d mongo mongo-init api
docker compose ps
curl -fsS http://127.0.0.1:3100/health
```

`/health` 返回 `ok: true` 后再初始化业务集合。

## 6. 初始化数据库

读取 `.env` 中自己填写的 `DATABASE_BOOTSTRAP_TOKEN`，执行：

```bash
docker compose run --rm api node server/scripts/bootstrap-db.js '这里替换成你自己的 DATABASE_BOOTSTRAP_TOKEN'
```

首次初始化完成后，不要把这个 Token 记录到文档或聊天中。

## 7. 启动 Worker 与维护任务

```bash
docker compose up -d worker maintenance
docker compose ps
```

查看日志：

```bash
docker compose logs --tail=100 api
docker compose logs --tail=100 worker
docker compose logs --tail=100 maintenance
```

## 8. SSL 与现有 Nginx

当前公网 `80/443` 由 `learning-ai-nginx` 使用 host 网络接管。AIAgent 不新建第二个公网 Nginx，只给现有入口新增一个独立 `api.example.invalid` server block。

申请 `api.example.invalid` 的 Nginx SSL 证书后，将证书放入当前已挂载到容器 `/etc/nginx/ssl` 的宿主机目录，并使用独立文件名，不覆盖 `xuexi.example.invalid` 证书。

修改前先备份：

```bash
cp /www/wwwroot/bushu_learning/nginx.conf \
  /root/pre-aiagent-nginx-$(date +%Y%m%d-%H%M%S).conf
```

在现有 `/www/wwwroot/bushu_learning/nginx.conf` 末尾追加：

```nginx
server {
  listen 80;
  listen [::]:80;
  server_name api.example.invalid;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  listen [::]:443 ssl http2;
  server_name api.example.invalid;

  ssl_certificate /etc/nginx/ssl/api.example.invalid_bundle.pem;
  ssl_certificate_key /etc/nginx/ssl/api.example.invalid.key;
  ssl_protocols TLSv1.2 TLSv1.3;

  client_max_body_size 20m;

  location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 360s;
    proxy_send_timeout 360s;
  }
}
```

只做配置检查和 reload，不重建旧容器：

```bash
docker exec learning-ai-nginx nginx -t
docker exec learning-ai-nginx nginx -s reload
```

验证：

```bash
curl -fsS https://api.example.invalid/health
```

## 9. 微信小程序

小程序生产 API 已配置为：

```text
https://api.example.invalid
```

在微信小程序后台把该 HTTPS 域名配置到网络请求相关合法域名后，再使用微信开发者工具做真机验证。

推荐至少验证：登录/注册、图片上传与普通批改、难题/马虎模式、TTS、Excel 导出、教师/学生关键页面。

## 10. 旧 CloudBase 测试账号数据

如果需要保留旧测试老师/学生身份，优先导出对应 CloudBase collection 为 JSON，再放到服务器临时目录，例如 `/opt/aiagent/migration/`。

项目提供通用导入器：

```bash
docker compose run --rm \
  -v /opt/aiagent/migration:/migration:ro \
  api node server/scripts/import-cloudbase-json.js users /migration/users.json
```

其他集合按实际需要逐个导入。正式迁移前先备份新 MongoDB，不要把测试数据直接覆盖生产同名用户。

## 11. 更新代码

以后只有一份源码。更新流程：本地修改和测试 → 上传同一 AIAgent 工程 → 服务器重新 build/up。

```bash
cd /opt/aiagent
docker compose build
docker compose up -d
```

`/data/aiagent` 不属于程序目录，因此重新部署程序不会覆盖 MongoDB 和用户文件。
