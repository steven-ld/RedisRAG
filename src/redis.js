import { createClient } from '@redis/client';
import crypto from 'node:crypto';
import { config } from './config.js';
import { getEmbedding, toFloat32Buffer } from './embeddings.js';

const client = createClient({
  url: config.redisUrl
});

client.on('error', (error) => {
  console.error('Redis Client Error:', error);
});

function buildSchemaArgs() {
  return [
    'FT.CREATE',
    config.indexName,
    'ON',
    'HASH',
    'PREFIX',
    '1',
    config.keyPrefix,
    'SCHEMA',
    'id',
    'TAG',
    'content',
    'TEXT',
    'source',
    'TAG',
    'tags',
    'TAG',
    'SEPARATOR',
    ',',
    'createdAt',
    'NUMERIC',
    'embedding',
    'VECTOR',
    'HNSW',
    '10',
    'TYPE',
    'FLOAT32',
    'DIM',
    String(config.embeddingDim),
    'DISTANCE_METRIC',
    'COSINE',
    'M',
    '16',
    'EF_CONSTRUCTION',
    '200'
  ];
}

function parseSearchResults(rawReply) {
  const total = Number(rawReply?.[0] || 0);
  const results = [];

  for (let index = 1; index < rawReply.length; index += 2) {
    const key = rawReply[index];
    const rawFields = rawReply[index + 1];
    const fields = {};

    for (let fieldIndex = 0; fieldIndex < rawFields.length; fieldIndex += 2) {
      fields[rawFields[fieldIndex]] = rawFields[fieldIndex + 1];
    }

    results.push({
      key,
      id: fields.id,
      content: fields.content,
      source: fields.source,
      tags: fields.tags ? fields.tags.split(',').filter(Boolean) : [],
      createdAt: Number(fields.createdAt || 0),
      vectorScore: fields.vector_score ? Number(fields.vector_score) : null
    });
  }

  return { total, results };
}

function parseInfo(infoString = '') {
  const lines = infoString.split(/\r?\n/);
  return lines.reduce((acc, line) => {
    if (!line || line.startsWith('#')) {
      return acc;
    }

    const [key, value] = line.split(':');
    if (key && value !== undefined) {
      acc[key] = value;
    }

    return acc;
  }, {});
}

const searchMetricsKey = 'metrics:search';
const searchTimelineKey = 'metrics:search:timeline';
const authProfileKey = 'auth:user:amdin';
const authTokenPrefix = 'auth:token:';
const authApiKeyPrefix = 'auth:apikey:';
const authApiKeyIndexKey = 'auth:apikey:index';
const defaultUsername = 'amdin';
const defaultPassword = 'RedisRAG@2026';
const authTokenTtlSeconds = 60 * 60 * 24;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) {
    return false;
  }

  const [salt, expected] = storedHash.split(':');
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  if (expected.length !== actual.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}

function buildTokenKey(token) {
  return `${authTokenPrefix}${token}`;
}

function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(String(apiKey)).digest('hex');
}

function buildApiKeyRedisKey(apiKeyHash) {
  return `${authApiKeyPrefix}${apiKeyHash}`;
}

async function recordSearchMetrics(resultsCount) {
  const now = Date.now();
  const commands = [
    client.hIncrBy(searchMetricsKey, 'queries', 1),
    client.hIncrBy(searchMetricsKey, 'results', resultsCount),
    client.hSet(searchMetricsKey, 'lastQueryAt', String(now)),
    client.zAdd(searchTimelineKey, [{ score: now, value: String(now) }]),
    client.zRemRangeByScore(searchTimelineKey, 0, now - (1000 * 60 * 60 * 24))
  ];

  if (resultsCount > 0) {
    commands.push(client.hIncrBy(searchMetricsKey, 'hits', 1));
  } else {
    commands.push(client.hIncrBy(searchMetricsKey, 'misses', 1));
  }

  await Promise.all(commands);
}

function normalizePageNumber(value, defaultValue) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return defaultValue;
  }
  if (parsed < 1) {
    return 1;
  }

  return parsed;
}

export async function connectRedis() {
  if (!client.isOpen) {
    await client.connect();
  }

  try {
    await client.sendCommand(buildSchemaArgs());
    console.log(`Created index ${config.indexName}`);
  } catch (error) {
    if (!String(error?.message || '').includes('Index already exists')) {
      throw error;
    }
  }

  return client;
}

export async function ensureAuthProfile() {
  const exists = await client.exists(authProfileKey);
  if (Number(exists) > 0) {
    return;
  }

  await client.hSet(authProfileKey, {
    username: defaultUsername,
    passwordHash: hashPassword(defaultPassword),
    requirePasswordChange: '1',
    updatedAt: String(Date.now())
  });
}

async function issueToken({ username, scope = 'full', expiresInSeconds = authTokenTtlSeconds }) {
  const token = crypto.randomBytes(32).toString('hex');
  const key = buildTokenKey(token);
  await client.setEx(key, expiresInSeconds, JSON.stringify({
    username,
    scope,
    createdAt: Date.now()
  }));
  return token;
}

export async function loginWithPassword({ username, password }) {
  const profile = await client.hGetAll(authProfileKey);
  if (!profile.username || username !== profile.username) {
    return { ok: false };
  }

  const valid = verifyPassword(password, profile.passwordHash);
  if (!valid) {
    return { ok: false };
  }

  const requirePasswordChange = profile.requirePasswordChange === '1';
  const scope = requirePasswordChange ? 'change' : 'full';
  const token = await issueToken({
    username: profile.username,
    scope,
    expiresInSeconds: authTokenTtlSeconds
  });

  return {
    ok: true,
    username: profile.username,
    requirePasswordChange,
    token,
    scope
  };
}

export async function verifyAuthToken(token) {
  if (!token) {
    return null;
  }

  const raw = await client.get(buildTokenKey(token));
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

export async function changePasswordWithToken({ token, newPassword }) {
  const session = await verifyAuthToken(token);
  if (!session || (session.scope !== 'change' && session.scope !== 'full')) {
    return { ok: false, reason: 'INVALID_TOKEN' };
  }

  const nextHash = hashPassword(newPassword);
  await client.hSet(authProfileKey, {
    passwordHash: nextHash,
    requirePasswordChange: '0',
    updatedAt: String(Date.now())
  });

  await client.del(buildTokenKey(token));
  const fullToken = await issueToken({
    username: session.username,
    scope: 'full',
    expiresInSeconds: authTokenTtlSeconds
  });

  return {
    ok: true,
    username: session.username,
    token: fullToken
  };
}

export async function createMcpApiKey({
  name = 'mcp-client',
  createdBy = defaultUsername,
  expiresInDays = 3650
} = {}) {
  const safeName = String(name || 'mcp-client').trim().slice(0, 60) || 'mcp-client';
  const parsedDays = Number(expiresInDays);
  const safeDays = Number.isNaN(parsedDays) ? 3650 : Math.max(1, Math.min(parsedDays, 36500));
  const ttlSeconds = safeDays * 24 * 60 * 60;
  const createdAt = Date.now();
  const apiKey = `mcp_${crypto.randomBytes(24).toString('hex')}`;
  const apiKeyHash = hashApiKey(apiKey);
  const keyId = apiKeyHash.slice(0, 12);
  const redisKey = buildApiKeyRedisKey(apiKeyHash);
  const expiresAt = createdAt + (ttlSeconds * 1000);

  await client.hSet(redisKey, {
    keyId,
    name: safeName,
    createdBy: String(createdBy || defaultUsername),
    scope: 'mcp',
    createdAt: String(createdAt),
    lastUsedAt: '0',
    expiresAt: String(expiresAt),
    status: 'active'
  });
  await client.expire(redisKey, ttlSeconds);
  await client.sAdd(authApiKeyIndexKey, redisKey);

  return {
    apiKey,
    keyId,
    name: safeName,
    expiresAt
  };
}

export async function listMcpApiKeys() {
  const redisKeys = await client.sMembers(authApiKeyIndexKey);
  if (!redisKeys.length) {
    return [];
  }

  const all = await Promise.all(redisKeys.map(async (redisKey) => {
    const item = await client.hGetAll(redisKey);
    if (!item.keyId) {
      await client.sRem(authApiKeyIndexKey, redisKey);
      return null;
    }

    return {
      keyId: item.keyId,
      name: item.name || 'mcp-client',
      createdBy: item.createdBy || defaultUsername,
      scope: item.scope || 'mcp',
      createdAt: Number(item.createdAt || 0),
      lastUsedAt: Number(item.lastUsedAt || 0),
      expiresAt: Number(item.expiresAt || 0),
      status: item.status || 'active'
    };
  }));

  return all
    .filter(Boolean)
    .sort((left, right) => right.createdAt - left.createdAt);
}

export async function revokeMcpApiKey(apiKey) {
  if (!apiKey) {
    return false;
  }

  const apiKeyHash = hashApiKey(apiKey);
  const redisKey = buildApiKeyRedisKey(apiKeyHash);
  const deleted = await client.del(redisKey);
  await client.sRem(authApiKeyIndexKey, redisKey);
  return Number(deleted) > 0;
}

export async function verifyMcpApiKey(apiKey) {
  if (!apiKey) {
    return null;
  }

  const apiKeyHash = hashApiKey(apiKey);
  const redisKey = buildApiKeyRedisKey(apiKeyHash);
  const item = await client.hGetAll(redisKey);
  if (!item.keyId || item.status !== 'active' || item.scope !== 'mcp') {
    return null;
  }

  const now = Date.now();
  const expiresAt = Number(item.expiresAt || 0);
  if (expiresAt && now >= expiresAt) {
    await client.del(redisKey);
    await client.sRem(authApiKeyIndexKey, redisKey);
    return null;
  }

  await client.hSet(redisKey, {
    lastUsedAt: String(now)
  });

  return {
    keyId: item.keyId,
    name: item.name || 'mcp-client',
    scope: item.scope,
    createdBy: item.createdBy || defaultUsername
  };
}

function extractTitleFromContent(content) {
  if (!content) return 'Untitled';
  const h1Match = String(content).match(/^#\s+(.+)$/m);
  if (h1Match && h1Match[1]) {
    const title = h1Match[1].trim();
    return title.length > 80 ? title.slice(0, 80) + '…' : title;
  }
  const plainText = String(content).replace(/[#*`_~\[\]]/g, '').trim();
  return plainText.slice(0, 50) + (plainText.length > 50 ? '…' : '');
}

export async function upsertDocument({
  id = crypto.randomUUID(),
  content,
  source = 'manual',
  tags = []
}) {
  const embedding = await getEmbedding(content);
  const key = `${config.keyPrefix}${id}`;
  const createdAt = Date.now();
  const title = extractTitleFromContent(content);

  await client.hSet(key, {
    id,
    content,
    title,
    source,
    tags: tags.join(','),
    createdAt: String(createdAt),
    embedding: toFloat32Buffer(embedding)
  });

  return {
    id,
    key,
    content,
    title,
    source,
    tags,
    createdAt
  };
}

export async function listDocuments() {
  let cursor = '0';
  const keys = [];

  do {
    const reply = await client.scan(cursor, {
      MATCH: `${config.keyPrefix}*`,
      COUNT: 100
    });

    cursor = reply.cursor;
    keys.push(...reply.keys);
  } while (cursor !== '0');

  if (!keys.length) {
    return [];
  }

  const documents = await Promise.all(
    keys.map(async (key) => {
      const hash = await client.hGetAll(key);
      return {
        id: hash.id,
        key,
        content: hash.content,
        source: hash.source,
        tags: hash.tags ? hash.tags.split(',').filter(Boolean) : [],
        createdAt: Number(hash.createdAt || 0)
      };
    })
  );

  return documents.sort((left, right) => right.createdAt - left.createdAt);
}

function normalizeFilterText(value) {
  return String(value || '').trim().toLowerCase();
}

function filterDocuments(documents, filters = {}) {
  const keyword = normalizeFilterText(filters.keyword);
  const source = normalizeFilterText(filters.source);
  const tags = Array.isArray(filters.tags)
    ? filters.tags.map((tag) => normalizeFilterText(tag)).filter(Boolean)
    : [];

  if (!keyword && !source && !tags.length) {
    return documents;
  }

  return documents.filter((document) => {
    if (keyword && !normalizeFilterText(document.content).includes(keyword)) {
      return false;
    }

    if (source && normalizeFilterText(document.source) !== source) {
      return false;
    }

    if (tags.length) {
      const documentTags = Array.isArray(document.tags)
        ? document.tags.map((tag) => normalizeFilterText(tag))
        : [];
      if (!documentTags.some((tag) => tags.includes(tag))) {
        return false;
      }
    }

    return true;
  });
}

export async function deleteDocument(id) {
  return client.del(`${config.keyPrefix}${id}`);
}

function escapeTagValue(value) {
  return String(value).replace(/([\\{}[\]"':;,.<>\/?+=~!@#$%^&*() -])/g, '\\$1');
}

export async function searchDocuments({
  query,
  topK = 5,
  page = 1,
  limit = 5,
  keyword = '',
  source = '',
  tags = [],
  tagMode = 'any'
}) {
  const embedding = await getEmbedding(query);
  const queryVector = toFloat32Buffer(embedding);
  const clauses = [];

  if (keyword.trim()) {
    clauses.push(`@content:${keyword.trim()}`);
  }

  if (source.trim()) {
    clauses.push(`@source:{${escapeTagValue(source.trim())}}`);
  }

  if (Array.isArray(tags) && tags.length) {
    const normalizedTags = tags
      .filter(Boolean)
      .map((tag) => escapeTagValue(tag));
    if (normalizedTags.length) {
      if (String(tagMode || 'any').trim().toLowerCase() === 'all') {
        normalizedTags.forEach((tag) => {
          clauses.push(`@tags:{${tag}}`);
        });
      } else {
        clauses.push(`@tags:{${normalizedTags.join('|')}}`);
      }
    }
  }

  const safePage = normalizePageNumber(page, 1);
  const parsedLimit = Number(limit);
  const safeLimit = Number.isNaN(parsedLimit) ? 5 : Math.max(1, Math.min(parsedLimit, 50));
  const candidateK = Math.max(1, Math.max(Number(topK) || 5, safePage * safeLimit));
  const offset = (safePage - 1) * safeLimit;
  const filterPart = clauses.length ? `(${clauses.join(' ')})` : '*';
  const searchQuery = `${filterPart}=>[KNN ${candidateK} @embedding $vec AS vector_score]`;

  const rawReply = await client.sendCommand([
    'FT.SEARCH',
    config.indexName,
    searchQuery,
    'PARAMS',
    '2',
    'vec',
    queryVector,
    'RETURN',
    '6',
    'id',
    'content',
    'source',
    'tags',
    'createdAt',
    'vector_score',
    'SORTBY',
    'vector_score',
    'LIMIT',
    String(offset),
    String(safeLimit),
    'DIALECT',
    '2'
  ]);

  const { results, total } = parseSearchResults(rawReply);
  const mapped = results.map((item) => ({
    ...item,
    similarity: item.vectorScore == null ? null : Number((1 - item.vectorScore).toFixed(4))
  }));

  await recordSearchMetrics(mapped.length);

  return {
    total,
    results: mapped,
    pageInfo: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit))
    }
  };
}

export async function seedDocumentsIfEmpty() {
  const existing = await listDocuments();
  if (existing.length > 0) {
    return existing;
  }

  const samples = [
    {
      content: 'Redis Stack supports vector similarity search with HNSW indexes and hybrid filtering.',
      source: 'redis-docs',
      tags: ['redis', 'vector', 'rag']
    },
    {
      content: 'A small RAG pipeline usually includes chunking, embedding, retrieval, and answer synthesis.',
      source: 'rag-notes',
      tags: ['rag', 'pipeline']
    },
    {
      content: 'Redis can combine full-text search, tags, and vector search in one query for knowledge apps.',
      source: 'engineering-blog',
      tags: ['redis', 'search', 'hybrid']
    }
  ];

  await Promise.all(samples.map((sample) => upsertDocument(sample)));
  return listDocuments();
}

export async function listDocumentsPaginated({ page = 1, limit = 6, filters = {} } = {}) {
  const allDocuments = await listDocuments();
  const filteredDocuments = filterDocuments(allDocuments, filters);
  const requestedPage = normalizePageNumber(page, 1);
  const parsedLimit = Number(limit);
  const safeLimit = Number.isNaN(parsedLimit) ? 6 : Math.max(1, Math.min(parsedLimit, 50));
  const total = filteredDocuments.length;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const pageNumber = Math.min(requestedPage, totalPages);
  const startIndex = (pageNumber - 1) * safeLimit;
  const paged = filteredDocuments.slice(startIndex, startIndex + safeLimit);

  return {
    documents: paged,
    pageInfo: {
      page: pageNumber,
      limit: safeLimit,
      total,
      totalPages
    }
  };
}

export async function getMetrics() {
  const now = Date.now();
  const oneHourAgo = now - (1000 * 60 * 60);
  const fiveHoursAgo = now - (1000 * 60 * 60 * 5);
  const [memoryInfo, statsInfo, searchCounters, hourQueries, fiveHourQueries] = await Promise.all([
    client.info('memory'),
    client.info('stats'),
    client.hGetAll(searchMetricsKey),
    client.zCount(searchTimelineKey, oneHourAgo, '+inf'),
    client.zCount(searchTimelineKey, fiveHoursAgo, '+inf')
  ]);

  const memory = parseInfo(memoryInfo);
  const stats = parseInfo(statsInfo);
  const queries = Number(searchCounters.queries || 0);
  const resultsTotal = Number(searchCounters.results || 0);
  const hits = Number(searchCounters.hits || 0);
  const misses = Number(searchCounters.misses || 0);
  const lastQueryAt = Number(searchCounters.lastQueryAt || 0);
  const searchHitRate = queries ? Math.min(1, hits / queries) : 0;
  const searchMissRate = queries ? Math.min(1, misses / queries) : 0;
  const avgResults = queries ? resultsTotal / queries : 0;
  const redisHits = Number(stats.keyspace_hits || 0);
  const redisMisses = Number(stats.keyspace_misses || 0);
  const redisTotal = redisHits + redisMisses;
  const used = Number(memory.used_memory || 0);
  const maxmemory = Number(memory.maxmemory || 0);
  const memoryUsageRate = maxmemory > 0 ? used / maxmemory : 0;

  return {
    memory: {
      used,
      usedHuman: memory.used_memory_human || '0B',
      peak: Number(memory.used_memory_peak || 0),
      rss: Number(memory.used_memory_rss || 0),
      max: maxmemory,
      usageRate: Number(memoryUsageRate.toFixed(3)),
      fragmentationRatio: Number(memory.mem_fragmentation_ratio || 0)
    },
    stats: {
      redisHitRate: redisTotal ? Number((redisHits / redisTotal).toFixed(3)) : 0,
      redisMissRate: redisTotal ? Number((redisMisses / redisTotal).toFixed(3)) : 0,
      totalCommands: Number(stats.total_commands_processed || 0),
      instantaneousOpsPerSec: Number(stats.instantaneous_ops_per_sec || 0)
    },
    search: {
      queries,
      hits,
      misses,
      results: resultsTotal,
      avgResults: Number(avgResults.toFixed(2)),
      hitRate: Number(searchHitRate.toFixed(3)),
      missRate: Number(searchMissRate.toFixed(3)),
      lastQueryAt
    },
    mcp: {
      queriesLastHour: Number(hourQueries || 0),
      queriesLastFiveHours: Number(fiveHourQueries || 0)
    }
  };
}
