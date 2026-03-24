# Redis-RAG 控制台

一个基于 JavaScript + Redis Stack 的小规模 RAG 控制台，支持：

- 文档新增、删除、分页管理
- 语义检索 + 关键词/来源/标签过滤
- 检索结果分页
- Redis 内存、命中率、搜索命中率、MCP 监控指标面板
- 登录鉴权 + Redis Token 会话 + 首次登录强制改密
- MCP API Key（长期凭证）鉴权

## 默认登录账号

- 用户名：`amdin`
- 密码：`redisrag`
- 首次登录后可进入控制台，但会立即弹出强制改密窗口；改完无需重新登录
- 登录 token 有效期：`24h`

## 1. 功能概览

### 文档管理分页

- 文档列表接口：`GET /api/documents?page=1&limit=6`
- 页面支持：`首页 / 上一页 / 下一页 / 末页 / 跳页 / 每页条数`
- 后端会自动把超出总页数的页码回退到最后一页

### 检索分页

- 检索接口：`POST /api/search`
- 新增参数：`page`、`limit`
- 响应包含 `pageInfo`，前端可直接渲染翻页控件

### MCP 指标（监控视角）

- 指标接口：`GET /api/metrics`
- 包含：
  - Redis 内存：`used/peak/rss/usageRate/fragmentationRatio`
  - Redis 命中：`redisHitRate/redisMissRate/totalCommands/instantaneousOpsPerSec`
  - 搜索命中：`queries/hits/misses/hitRate/missRate/avgResults/lastQueryAt`
  - MCP 时间窗口：`queriesLastMinute/queriesLastFiveMinutes`

## 2. 快速启动

### 方式 A：Docker Compose（推荐）

```bash
docker compose up --build -d
```

访问：

- Login: [http://localhost:3000/login.html](http://localhost:3000/login.html)
- App: [http://localhost:3000](http://localhost:3000)（未登录会自动跳转到登录页）
- Redis Insight: [http://localhost:8001](http://localhost:8001)

停止：

```bash
docker compose down
```

### 方式 B：本地 Node + 本地 Redis Stack

先启动 Redis Stack（示例）：

```bash
docker run -d --name redis-stack \
  -p 6379:6379 \
  -p 8001:8001 \
  redis/redis-stack:latest
```

再启动应用：

```bash
npm install
npm start
```

## 3. 页面使用说明

### 新增文档

1. 填写来源（可选）  
2. 填写标签（逗号分隔）  
3. 填写正文并提交  

提交后会自动生成 embedding 并写入 Redis。

### 文档管理（分页）

- 在“文档管理”区域可设置每页条数：`3 / 6 / 12`
- 支持首页、末页、输入页码跳转
- 删除文档后会保留当前页；若当前页越界会自动回退到最后页

### 查询与检索（分页）

1. 输入 query
2. 可选关键词、来源、标签过滤
3. 设置 `Top K`
4. 点击检索

检索结果区域支持上一页/下一页，底部显示 `total` 与 `page / totalPages`。

## 4. API 使用方式

### 先登录获取 token

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"amdin","password":"redisrag"}'
```

若返回 `requirePasswordChange=true`，先改密：

```bash
curl -X POST http://localhost:3000/api/auth/change-password \
  -H "Authorization: Bearer <LOGIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"newPassword":"your-new-password"}'
```

### 健康检查（需鉴权）

```bash
curl http://localhost:3000/api/health \
  -H "Authorization: Bearer <TOKEN>"
```

### 新增文档（需鉴权）

```bash
curl -X POST http://localhost:3000/api/documents \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Redis Stack supports vector search with HNSW.",
    "source": "redis-docs",
    "tags": ["redis", "vector", "rag"]
  }'
```

### 文档分页查询（需鉴权）

```bash
curl "http://localhost:3000/api/documents?page=1&limit=6" \
  -H "Authorization: Bearer <TOKEN>"
```

### 删除文档（需鉴权）

```bash
curl -X DELETE http://localhost:3000/api/documents/<id> \
  -H "Authorization: Bearer <TOKEN>"
```

### 检索（含分页，需鉴权）

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Redis 如何做向量搜索",
    "topK": 20,
    "page": 1,
    "limit": 5,
    "keyword": "vector",
    "source": "redis-docs",
    "tags": ["rag"]
  }'
```

### MCP 指标查询（需鉴权）

```bash
curl http://localhost:3000/api/metrics \
  -H "Authorization: Bearer <TOKEN>"
```

### 生成 MCP API Key（推荐给 MCP 用）

```bash
curl -X POST http://localhost:3000/api/auth/api-keys \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "mcp-prod-monitor",
    "expiresInDays": 3650
  }'
```

响应中的 `key` 为完整 API Key，仅返回一次。

### 查询 API Key 列表

```bash
curl http://localhost:3000/api/auth/api-keys \
  -H "Authorization: Bearer <TOKEN>"
```

### 吊销 API Key

```bash
curl -X DELETE http://localhost:3000/api/auth/api-keys \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"key":"<FULL_API_KEY>"}'
```

### 用 API Key 访问 MCP 指标

```bash
curl http://localhost:3000/api/metrics \
  -H "X-API-Key: <FULL_API_KEY>"
```

## 5. MCP 介入方式

这里的 MCP 提供两种介入思路：

### 方案 A：作为“监控数据源”接入（当前已支持）

- 直接把 `/api/metrics` 作为你的 AI/Agent 工具数据源
- 推荐先登录创建 MCP API Key，再由 Agent 在请求头附带 `X-API-Key: <KEY>`
- 也可直接用 24h token（`Authorization: Bearer <TOKEN>`）
- Agent 按周期读取该接口，生成告警或日报
- 适用于“监控分析、检索质量观察、容量跟踪”

建议最小采集字段：

- `memory.usageRate`
- `stats.redisHitRate`
- `search.hitRate`
- `search.missRate`
- `mcp.queriesLastMinute`

### 方案 B：作为标准 MCP Server 接入（当前未内置）

当前仓库未内置标准 Model Context Protocol Server。  
如果你需要标准 MCP，可在外层加一层 MCP Server，把以下 HTTP API 封装为工具：

- `get_health -> GET /api/health`
- `list_documents -> GET /api/documents`
- `search_documents -> POST /api/search`
- `get_metrics -> GET /api/metrics`

## 6. 环境变量

- `PORT`: 默认 `3000`
- `REDIS_URL`: 默认 `redis://localhost:6379`
- `VECTOR_INDEX_NAME`: 默认 `rag_idx`
- `VECTOR_KEY_PREFIX`: 默认 `doc:`
- `EMBEDDING_DIM`: `simple` 默认 `256`，`openai` 默认 `1536`
- `EMBEDDING_PROVIDER`: `simple` / `openai`
- `OPENAI_API_KEY`: 使用 openai embedding 时必填
- `OPENAI_EMBEDDING_MODEL`: 默认 `text-embedding-3-small`

## 7. 常见问题

### 页面看到的分页不明显

请先把“每页”设置为 `3`，并确保文档总数 > 3，即可明显看到翻页。

### 指标里内存占用率是 0%

Redis `maxmemory=0` 时表示未设置上限，此时 `usageRate` 会显示为 `0`（不可比）。

### 首次启动无数据

应用会在库空时自动写入样例文档；如果未出现，检查 Redis 连接与日志输出。
# RedisRAG
