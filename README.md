# RedisRAG

RedisRAG 是一个基于 **JavaScript + Redis Stack** 的轻量 RAG 控制台与 API 服务，支持文档入库、语义检索、文档筛选、标准 MCP 检索接入和 API Key 管理。

适合场景：
- 中小规模知识库检索
- 给 AI Agent 提供可写入的文档库
- 通过 `/api/metrics` 做检索健康度监控

---

## 1. 核心能力

- 文档管理：创建、删除、分页、筛选（关键词/来源/标签）
- 语义检索：向量检索 + 来源/标签过滤 + 分页
- 标准 MCP 检索：面向 AI 客户端暴露检索工具
- 监控指标：Redis 内存、命中率、搜索命中率、请求统计
- 鉴权体系：账号密码登录 + Token + 首次改密
- API Key：为 HTTP 监控接口生成/吊销长期 key

---

## 2. 快速开始（推荐 Docker）

### 2.1 一条命令启动

```bash
docker compose up --build -d
```

访问地址：
- 登录页: [http://localhost:3000/login.html](http://localhost:3000/login.html)
- 控制台: [http://localhost:3000](http://localhost:3000)
- Redis Insight: [http://localhost:8001](http://localhost:8001)

停止服务：

```bash
docker compose down
```

### 2.2 默认账号

- 用户名：`amdin`
- 密码：`redisrag`

注意：首次登录会强制改密，改密后可继续当前会话。

---

## 3. 接入路径（最短）

### Step 1：登录获取 token

```bash
curl -sS -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"amdin","password":"redisrag"}'
```

如果返回 `requirePasswordChange=true`，先改密：

```bash
curl -sS -X POST http://localhost:3000/api/auth/change-password \
  -H "Authorization: Bearer <LOGIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"newPassword":"your-new-password"}'
```

### Step 2：写入一条文档

```bash
curl -sS -X POST http://localhost:3000/api/documents \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "content":"Redis Stack supports vector search with HNSW index.",
    "source":"redis-docs",
    "tags":["redis","vector","rag"]
  }'
```

### Step 3：做一次语义检索

```bash
curl -sS -X POST http://localhost:3000/api/search \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "query":"Redis 如何支持向量检索？",
    "topK":10,
    "page":1,
    "limit":5,
    "source":"redis-docs",
    "tags":["rag"]
  }'
```

---

## 4. API 一览

### 4.1 认证

- `POST /api/auth/login`
- `POST /api/auth/change-password`
- `GET /api/auth/session`

### 4.2 文档

- `POST /api/documents` 新增文档
- `DELETE /api/documents/:id` 删除文档
- `GET /api/documents` 文档分页 + 筛选

`GET /api/documents` 查询参数：
- `page`：页码（默认 1）
- `limit`：每页数量（默认 6，最大 50）
- `keyword`：按 `content` 模糊匹配（不区分大小写）
- `source`：按来源精确匹配（不区分大小写）
- `tags`：逗号分隔，任一标签命中即可，例如 `redis,rag`

示例：

```bash
curl -sS "http://localhost:3000/api/documents?page=1&limit=6&keyword=vector&source=redis-docs&tags=redis,rag" \
  -H "Authorization: Bearer <TOKEN>"
```

### 4.3 检索

- `POST /api/search` 语义检索（支持分页、来源/标签/关键词过滤）

### 4.4 监控

- `GET /api/health`
- `GET /api/metrics`

### 4.5 API Key（监控接口）

- `POST /api/auth/api-keys` 创建 key
- `GET /api/auth/api-keys` 列表
- `DELETE /api/auth/api-keys` 吊销

用 API Key 访问监控：

```bash
curl -sS http://localhost:3000/api/metrics \
  -H "X-API-Key: <FULL_API_KEY>"
```

---

## 5. AI 自动添加文档（重点）

这个章节是给 AI Agent / 自动化任务直接接入用的。

### 5.1 推荐流程

1. 登录获取 token（或维护一个长期会话）
2. 将待入库文本切分为 chunk
3. 逐条调用 `POST /api/documents`
4. 对失败请求重试（指数退避）
5. 定期抽样调用 `/api/search` 做质量回归

### 5.2 最小可用：AI 直接写入文档

```bash
curl -sS -X POST http://localhost:3000/api/documents \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "content":"<AI 生成或抽取的知识文本>",
    "source":"ai-ingestion",
    "tags":["ai","auto-import"]
  }'
```

### 5.3 批量入库脚本模板（bash）

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE_URL="http://localhost:3000"
TOKEN="<TOKEN>"

# demo: 你可以把这里换成从文件/数据库/消息队列读取
DOCS=(
  "Redis Stack supports vector similarity search."
  "RAG pipeline usually includes chunking and retrieval."
)

for content in "${DOCS[@]}"; do
  curl -sS -X POST "$BASE_URL/api/documents" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"content\":\"$content\",\"source\":\"ai-batch\",\"tags\":[\"ai\",\"batch\"]}" >/dev/null
  echo "ingested: $content"
done
```

### 5.4 给 AI 的实践建议（避免脏数据）

- 每条文档尽量单主题、短段落（便于向量检索）
- `source` 固定为稳定来源名（如 `notion-sync`、`confluence-bot`）
- `tags` 使用受控词表（降低标签碎片化）
- 入库前去重（可按内容 hash）
- 建议保留原文链接到 `content` 或标签中，便于追溯

---

## 6. 标准 MCP Server

仓库提供标准的 MCP stdio 服务，适合 Claude Desktop、Cursor 等支持 MCP 的客户端直接接入检索能力。

### 6.1 启动

```bash
npm run mcp:start
```

默认会通过 `stdio` 与 MCP 客户端通信，不需要额外开放 HTTP 端口。

### 6.2 工具清单

- `search_documents`：语义检索文档，支持 `query`、`topK`、`page`、`limit`、`keyword`、`source`、`tags`
- `list_documents`：分页列出文档，支持 `page`、`limit`、`keyword`、`source`、`tags`

### 6.3 Claude Desktop 配置示例

在 Claude Desktop 的 MCP 配置中加入类似下面的内容：

```json
{
  "mcpServers": {
    "redis-rag": {
      "command": "npm",
      "args": ["run", "mcp:start"],
      "cwd": "/Users/ga666666/Desktop/Redis-RAG"
    }
  }
}
```

如果你的环境里 `npm` 不在 PATH，也可以改成绝对路径，例如：

```json
{
  "mcpServers": {
    "redis-rag": {
      "command": "/opt/homebrew/bin/npm",
      "args": ["run", "mcp:start"],
      "cwd": "/Users/ga666666/Desktop/Redis-RAG"
    }
  }
}
```

### 6.4 Cursor 配置示例

Cursor 也可以用同样的 stdio 启动方式，核心是 command + args + cwd：

```json
{
  "mcpServers": {
    "redis-rag": {
      "command": "npm",
      "args": ["run", "mcp:start"],
      "cwd": "/Users/ga666666/Desktop/Redis-RAG"
    }
  }
}
```

### 6.5 返回格式说明

MCP 工具返回的是面向客户端消费的结构化结果，适合直接交给模型总结、引用或继续检索。它和 `/api/metrics` 这种监控接口不是一类能力。

---

## 7. MCP / Agent 监控接入

把 `/api/metrics` 作为 Agent 的只读监控数据源即可。这个接口只用于监控，不承担标准 MCP 检索能力。

建议最小采集字段：
- `memory.usageRate`
- `stats.redisHitRate`
- `search.hitRate`
- `search.missRate`
- `mcp.queriesLastMinute`

---

## 8. 环境变量

- `PORT`：默认 `3000`
- `REDIS_URL`：默认 `redis://localhost:6379`
- `VECTOR_INDEX_NAME`：默认 `rag_idx`
- `VECTOR_KEY_PREFIX`：默认 `doc:`
- `EMBEDDING_PROVIDER`：`simple` / `openai`
- `EMBEDDING_DIM`：`simple` 默认 `256`，`openai` 默认 `1536`
- `OPENAI_API_KEY`：`openai` provider 必填
- `OPENAI_EMBEDDING_MODEL`：默认 `text-embedding-3-small`

---

## 9. 常见问题

### Q1: 为什么内存占用率可能是 0%？
Redis `maxmemory=0` 表示未设上限，`usageRate` 会显示 0。

### Q2: 首次启动看不到数据？
系统会在空库时自动写入样例文档；若没有，请检查 Redis 连接和应用日志。

### Q3: API Key 能访问哪些接口？
当前仅允许访问 `GET /api/metrics`，它是监控接口，不是标准 MCP 工具入口。
