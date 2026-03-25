# 本地 Redis-RAG 启动与调试指南

## 1. 目标
- 把 `RedisRAG` 作为本地 RAG 服务运行起来，确保控制台、HTTP API、MCP 工具都可用；
- 确定身份验证链路（登录、改密、API Key、MCP Token）正常；
- 提供常用自检命令，便于快速定位 Redis 或节点的状态。

## 2. 环境准备
1. **系统**：任意 macOS/Linux，需支持 Docker Desktop；
2. **Node.js**：>=22（`package.json` 要求），在容器内运行；
3. **Docker & Docker Compose**：用于一键搭建 Express + Redis Stack；
4. **网络**：确保本地 `3000`、`8001` 等端口可用。

## 3. 配置变量（可写入 `.env`）
| 变量 | 推荐值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | Express + MCP HTTP 服务器监听端口 |
| `REDIS_URL` | `redis://redis:6379`（Docker Compose 网络） | 连接 Redis Stack 的地址 |
| `VECTOR_INDEX_NAME` | `rag_idx` | RediSearch 向量索引名，服务启动时自动创建 |
| `VECTOR_KEY_PREFIX` | `doc:` | 所有文档 hash 的前缀 |
| `EMBEDDING_PROVIDER` | `simple` | `simple` 使用内置向量，`openai` 需要额外密钥 |
| `EMBEDDING_DIM` | `256`（simple）/`1536`（OpenAI） | 向量维度需与 embedding provider 保持一致 |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | 仅 `openai` 供应商需要设置 |
| `DOC_SYNC_REPO_URL` | `/Users/ga666666/Desktop/RedisRAG-Doc` | Git 文档仓库地址，也可以是本地 Git 仓库路径 |
| `DOC_SYNC_BRANCH` | `main` | 文档仓库分支 |
| `DOC_SYNC_DOCS_ROOT` | `.` | 仓库内文档根目录 |
| `DOC_SYNC_INTERVAL_MS` | `180000` | 自动同步周期 |

示例 `.env`：
```env
PORT=3000
REDIS_URL=redis://redis:6379
EMBEDDING_PROVIDER=simple
EMBEDDING_DIM=256
DOC_SYNC_REPO_URL=/Users/ga666666/Desktop/RedisRAG-Doc
DOC_SYNC_BRANCH=main
```

## 4. 启动流程
1. 切换到项目目录：
   ```bash
   cd /Users/ga666666/Desktop/RedisRAG
   ```
2. 安装依赖：
   ```bash
   npm install
   ```
3. 启动服务（包含 Redis Stack）：
   ```bash
   docker compose up --build -d
   ```
4. 查看 API 日志确认后端就绪：
   ```bash
   docker compose logs -f api
   ```
   等到日志出现 `Express server listening on port 3000`。
5. 验证页面/工具：
   - 控制台登录页：`http://localhost:3000/login.html`
   - 控制台主页：`http://localhost:3000`
   - Redis Insight：`http://localhost:8001`

## 5. 身份认证链路
1. 默认账号：用户名 `amdin`，密码 `RedisRAG@2026`（非 `admin`）；
2. 登录获取初始 token：
   ```bash
   curl -sS -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"amdin","password":"RedisRAG@2026"}'
   ```
3. 使用返回的 token 调用改密接口，拿到 `scope=full`：
   ```bash
   curl -sS -X POST http://localhost:3000/api/auth/change-password \
     -H "Authorization: Bearer <LOGIN_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"newPassword":"your-new-password"}'
   ```
4. 之后所有私人接口都要用 `Authorization: Bearer <FULL_TOKEN>`；
5. 生成 MCP Token（API Key）：
   ```bash
   curl -sS -X POST http://localhost:3000/api/auth/api-keys \
     -H "Authorization: Bearer <FULL_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"name":"local-skill","expiresInDays":365}'
   ```
   返回的 `key` 字段即 `MCP_TOKEN`，搭配 `MCP_URL=http://localhost:3000/mcp` 给 AI 客户端使用。

## 6. 健康与观测
- `GET /api/health`：确认主要 API 可达；
- `GET /api/metrics`：观察搜索次数、命中率、Redis 内存占比；
- Redis Stack 途径：
  ```bash
  docker compose exec redis redis-cli INFO memory
  ```
- `docker compose ps` 看 Redis、API、Insight 的状态。

## 7. 本地开发建议
- `npm run dev`：跳过 Docker，直接在本机跑 Express（便于打断点和简单变更）；
- `npm run mcp:start`：手动启动 MCP stdio 服务，调试 `tools/list`/`tools/call`；
- `npm run check`：语法校验，建议在提交前跑一遍。

## 8. 排障小贴士
1. Redis 报 `OOM`：检查 `redis.conf` 中 `maxmemory`、`maxmemory-policy`，适当限制；
2. 连接失败：确认 `.env` 里的 `REDIS_URL` host 与 Docker Compose 服务名一致；
3. MCP 返回 401：检查是否传了 `Bearer` 且 key 未过期；
4. 控制台加载缓慢：打开 DevTools，确认 `/api/documents` 等接口未返回 500；
5. 快速清空索引：
   ```bash
   docker compose exec redis redis-cli FT.DROPINDEX rag_idx DD
   ```
   然后重启服务触发 `connectRedis` 重新建表。
