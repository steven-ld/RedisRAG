# Git 文档仓库同步规范

## 目标

`RedisRAG` 现在支持把一个 Git 仓库当作文档唯一真源：

- 服务启动时先拉取或更新文档仓库；
- 之后按固定周期自动同步；
- 只同步符合规范的 Markdown 文章；
- 文章删除后会清理对应的 RAG 文档；
- `draft` 文档不会进入向量库。

同步逻辑参考了 `PowerWiki` 的思路，但额外增加了 RAG 需要的幂等写入、校验和陈旧数据清理。

## 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `DOC_SYNC_REPO_URL` | Git 仓库地址，也可以是本地 Git 仓库路径 | 空 |
| `DOC_SYNC_BRANCH` | 同步分支 | `main` |
| `DOC_SYNC_DOCS_ROOT` | 仓库内的文档根目录 | `.` |
| `DOC_SYNC_REPO_NAME` | 同步仓库标识，作为本地缓存目录名和 repo 元数据 | 自动从仓库地址推导 |
| `DOC_SYNC_INTERVAL_MS` | 自动同步周期，毫秒 | `180000` |
| `DOC_SYNC_CACHE_DIR` | 本地 Git 缓存目录 | `<project>/.doc-sync-cache` |

只要设置了 `DOC_SYNC_REPO_URL`，应用启动时就会启用文档同步，并跳过内置示例数据。

## 仓库结构

推荐目录结构：

```text
RedisRAG-Doc/
├── README.md
├── ABOUT.md
├── _manifest.yml
├── 01-architecture/
│   ├── README.md
│   └── rag-sync-spec.md
├── 02-ingestion/
│   ├── README.md
│   └── article-template.md
├── 03-examples/
│   ├── README.md
│   ├── valid-article.md
│   └── draft-article.md
└── assets/
```

约束：

- 文章必须放在一级分类目录下；
- 一级目录必须使用 `NN-name` 格式；
- 正式文章文件名必须是 `kebab-case.md`；
- 文件名必须和 `frontmatter.id` 完全一致；
- `README.md`、`ABOUT.md`、`_manifest.yml` 只做说明，不会同步进 RAG。

## `_manifest.yml`

`_manifest.yml` 是可选文件，用于定义仓库级默认值：

```yaml
repo: redisrag-doc
sourceBase: redisrag-doc
defaultAuthor: ga666666
defaultLang: zh-CN
defaultTags:
  - redisrag
  - knowledge-base
```

当前同步器会读取 `sourceBase` 和 `defaultTags`。

## 文章 Frontmatter

每篇正式文章都必须带 frontmatter：

```yaml
---
id: rag-sync-spec
title: Git 文档同步规范
description: 说明 RedisRAG 如何从 Git 文档仓库解析和同步文章
category: architecture
tags:
  - sync
  - git
  - rag
status: published
createdAt: 2026-03-25
updatedAt: 2026-03-25
---
```

必填字段：

- `id`：全局唯一，固定不变，使用 `kebab-case`
- `title`：文章标题
- `description`：摘要，写入检索内容
- `category`：必须和所属目录匹配，例如 `01-architecture` 对应 `architecture`
- `tags`：数组格式
- `status`：只允许 `published` 或 `draft`
- `createdAt`：创建日期
- `updatedAt`：更新日期

## 正文规则

- 第一行标题必须使用 `# 标题`，并且和 `frontmatter.title` 一致；
- 一篇文章只表达一个主题；
- 推荐使用稳定章节，如 `## 背景`、`## 方案`、`## 操作步骤`、`## 风险`、`## 参考`；
- 图片请放在 `images/` 或 `assets/` 目录，正文使用相对路径。

## 同步行为

同步器会做这些事情：

1. `git clone` 或 `git fetch + git pull`；
2. 扫描 `DOC_SYNC_DOCS_ROOT` 下所有 `.md` 文件；
3. 跳过 `README.md`、`ABOUT.md` 和草稿文档；
4. 校验 frontmatter 和命名规则；
5. 用 `id` 做幂等写入；
6. 内容未变化时跳过重建；
7. 删除仓库里已经不存在的已发布文章。

如果某次同步检测到不合规文章，本次会保留历史 RAG 数据，不执行陈旧文档删除。

## 手动触发

可以直接执行：

```bash
npm run sync:docs
```

也可以通过接口触发：

```bash
curl -X POST http://localhost:3000/api/sync/run \
  -H "Authorization: Bearer <FULL_TOKEN>"
```

查看状态：

```bash
curl http://localhost:3000/api/sync/status \
  -H "Authorization: Bearer <FULL_TOKEN>"
```
