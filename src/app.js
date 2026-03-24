import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { MCP_TOOLS, executeMcpTool } from './mcp-tools.js';
import {
  changePasswordWithToken,
  connectRedis,
  createMcpApiKey,
  deleteDocument,
  ensureAuthProfile,
  getMetrics,
  listMcpApiKeys,
  loginWithPassword,
  listDocumentsPaginated,
  revokeMcpApiKey,
  searchDocuments,
  seedDocumentsIfEmpty,
  verifyAuthToken,
  verifyMcpApiKey,
  upsertDocument
} from './redis.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const asyncHandler = (handler) => (request, response, next) =>
  Promise.resolve(handler(request, response, next)).catch(next);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function getBearerToken(request) {
  const header = request.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return '';
  }
  return header.slice('Bearer '.length).trim();
}

function getApiKeyToken(request) {
  const value = request.headers['x-api-key'];
  return value ? String(value).trim() : '';
}

function getMcpApiKeyToken(request) {
  const bearer = getBearerToken(request);
  if (bearer) {
    return bearer;
  }

  return getApiKeyToken(request);
}

function isJsonRpcNotification(message) {
  return message && typeof message === 'object' && !Array.isArray(message) && !Object.prototype.hasOwnProperty.call(message, 'id');
}

function normalizeJsonRpcId(id) {
  if (id == null) {
    return null;
  }

  return id;
}

function buildMcpTextResponse(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

function buildMcpErrorResponse(message, details) {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: details ? `${message}\n${details}` : message
      }
    ]
  };
}

function getMcpProtocolVersion(requestedVersion) {
  const normalized = String(requestedVersion || '').trim();
  const supportedVersions = new Set([
    '2025-11-25',
    '2025-06-18',
    '2025-03-26',
    '2024-11-05'
  ]);

  if (supportedVersions.has(normalized)) {
    return normalized;
  }

  return '2025-11-25';
}

function buildMcpInitializeResult(requestedProtocolVersion) {
  return {
    protocolVersion: getMcpProtocolVersion(requestedProtocolVersion),
    capabilities: {
      tools: {}
    },
    serverInfo: {
      name: 'redis-rag-http-mcp',
      version: '1.0.0'
    },
    instructions: 'Use search_documents and list_documents to query RedisRAG content over HTTP.'
  };
}

async function handleMcpToolCall(id, params) {
  const name = params && params.name ? String(params.name).trim() : '';
  const args = params && typeof params.arguments === 'object' && params.arguments !== null && !Array.isArray(params.arguments)
    ? params.arguments
    : {};

  if (!name) {
    return {
      jsonrpc: '2.0',
      id: normalizeJsonRpcId(id),
      result: buildMcpErrorResponse('Tool name is required')
    };
  }

  const execution = await executeMcpTool(name, args);
  if (!execution.ok) {
    return {
      jsonrpc: '2.0',
      id: normalizeJsonRpcId(id),
      result: buildMcpErrorResponse(`Tool call failed: ${name}`, execution.error)
    };
  }

  return {
    jsonrpc: '2.0',
    id: normalizeJsonRpcId(id),
    result: buildMcpTextResponse({
      tool: name,
      result: execution.result
    })
  };
}

async function handleMcpJsonRpcMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32600,
        message: 'Invalid request'
      }
    };
  }

  if (message.jsonrpc !== '2.0') {
    return {
      jsonrpc: '2.0',
      id: normalizeJsonRpcId(message.id),
      error: {
        code: -32600,
        message: 'Invalid JSON-RPC version'
      }
    };
  }

  if (typeof message.method !== 'string' || !message.method.trim()) {
    return {
      jsonrpc: '2.0',
      id: normalizeJsonRpcId(message.id),
      error: {
        code: -32600,
        message: 'Missing method'
      }
    };
  }

  const method = String(message.method).trim();
  const params = message.params && typeof message.params === 'object' ? message.params : {};
  const id = normalizeJsonRpcId(message.id);

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: buildMcpInitializeResult(params.protocolVersion)
    };
  }

  if (method === 'ping') {
    return {
      jsonrpc: '2.0',
      id,
      result: {}
    };
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: MCP_TOOLS }
    };
  }

  if (method === 'tools/call') {
    return handleMcpToolCall(id, params);
  }

  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method}`
    }
  };
}

async function authenticateMcpRequest(request, response) {
  const token = getMcpApiKeyToken(request);
  if (!token) {
    response.status(401).json({ error: 'missing api key' });
    return null;
  }

  const apiKeySession = await verifyMcpApiKey(token);
  if (!apiKeySession) {
    response.status(401).json({ error: 'invalid api key' });
    return null;
  }

  return apiKeySession;
}

async function handleMcpHttpPayload(request, response) {
  if (!(await authenticateMcpRequest(request, response))) {
    return;
  }

  const payload = request.body;
  const processItem = async (item) => {
    if (isJsonRpcNotification(item)) {
      return null;
    }

    return handleMcpJsonRpcMessage(item);
  };

  if (Array.isArray(payload)) {
    if (!payload.length) {
      return response.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'Invalid request'
        },
        id: null
      });
    }

    const results = await Promise.all(payload.map(async (item) => processItem(item)));
    const filtered = results.filter(Boolean);
    if (!filtered.length) {
      return response.status(204).end();
    }

    return response.json(filtered);
  }

  if (isJsonRpcNotification(payload)) {
    return response.status(204).end();
  }

  const result = await processItem(payload);
  if (!result) {
    return response.status(204).end();
  }

  if (Object.prototype.hasOwnProperty.call(result, 'error')) {
    return response.status(200).json(result);
  }

  return response.json(result);
}

app.post('/api/auth/login', asyncHandler(async (request, response) => {
  const { username, password } = request.body || {};
  if (!username || !password) {
    return response.status(400).json({ error: 'username and password are required' });
  }

  const login = await loginWithPassword({
    username: String(username).trim(),
    password: String(password)
  });

  if (!login.ok) {
    return response.status(401).json({ error: 'invalid credentials' });
  }

  return response.json({
    token: login.token,
    username: login.username,
    requirePasswordChange: login.requirePasswordChange
  });
}));

app.post('/api/auth/change-password', asyncHandler(async (request, response) => {
  const token = getBearerToken(request);
  const { newPassword } = request.body || {};
  const parsedPassword = newPassword == null ? '' : String(newPassword);
  const passwordLength = Array.from(parsedPassword).length;
  if (!token) {
    return response.status(401).json({ error: 'missing token' });
  }
  if (!parsedPassword || passwordLength < 6) {
    return response.status(400).json({ error: 'newPassword must be at least 6 characters' });
  }

  const changed = await changePasswordWithToken({
    token,
    newPassword: parsedPassword
  });

  if (!changed.ok) {
    return response.status(401).json({ error: 'invalid or expired token' });
  }

  return response.json({
    token: changed.token,
    username: changed.username,
    requirePasswordChange: false
  });
}));

app.get('/api/auth/session', asyncHandler(async (request, response) => {
  const token = getBearerToken(request);
  if (!token) {
    return response.status(401).json({ error: 'missing token' });
  }

  const session = await verifyAuthToken(token);
  if (!session) {
    return response.status(401).json({ error: 'invalid or expired token' });
  }

  return response.json({
    username: session.username,
    requirePasswordChange: session.scope !== 'full'
  });
}));

app.use('/api', asyncHandler(async (request, response, next) => {
  if (
    request.path === '/auth/login' ||
    request.path === '/auth/change-password' ||
    request.path === '/auth/session'
  ) {
    return next();
  }

  const token = getBearerToken(request);
  if (token) {
    const session = await verifyAuthToken(token);
    if (!session) {
      return response.status(401).json({ error: 'invalid or expired token' });
    }

    if (session.scope !== 'full') {
      if (request.path === '/health') {
        request.auth = {
          ...session,
          authType: 'token'
        };
        return next();
      }
      return response.status(403).json({ error: 'PASSWORD_CHANGE_REQUIRED' });
    }

    request.auth = {
      ...session,
      authType: 'token'
    };
    return next();
  }

  const apiKey = getApiKeyToken(request);
  if (apiKey) {
    const apiKeySession = await verifyMcpApiKey(apiKey);
    if (!apiKeySession) {
      return response.status(401).json({ error: 'invalid api key' });
    }

    if (request.path !== '/metrics') {
      return response.status(403).json({ error: 'api key can only access /api/metrics' });
    }

    request.auth = {
      ...apiKeySession,
      authType: 'api-key'
    };
    return next();
  }

  return response.status(401).json({ error: 'missing token or api key' });
}));

app.post('/api/auth/api-keys', asyncHandler(async (request, response) => {
  const { name, expiresInDays } = request.body || {};
  const created = await createMcpApiKey({
    name: name ? String(name) : 'mcp-client',
    expiresInDays: Number(expiresInDays || 3650),
    createdBy: request.auth?.username || 'amdin'
  });

  return response.status(201).json({
    key: created.apiKey,
    keyInfo: {
      keyId: created.keyId,
      name: created.name,
      expiresAt: created.expiresAt
    }
  });
}));

app.get('/api/auth/api-keys', asyncHandler(async (_request, response) => {
  const keys = await listMcpApiKeys();
  return response.json({ keys });
}));

app.delete('/api/auth/api-keys', asyncHandler(async (request, response) => {
  const { key } = request.body || {};
  if (!key) {
    return response.status(400).json({ error: 'key is required' });
  }

  const revoked = await revokeMcpApiKey(String(key));
  return response.json({ revoked });
}));

app.get('/api/health', asyncHandler(async (_request, response) => {
  response.json({
    ok: true,
    embeddingProvider: config.embeddingProvider,
    indexName: config.indexName
  });
}));

app.get('/api/documents', asyncHandler(async (request, response) => {
  const parsedPage = Number.parseInt(request.query.page, 10);
  const parsedLimit = Number.parseInt(request.query.limit, 10);
  const page = Number.isNaN(parsedPage) ? 1 : Math.max(1, parsedPage);
  const limit = Number.isNaN(parsedLimit) ? 6 : Math.min(50, Math.max(1, parsedLimit));
  const keyword = request.query.keyword ? String(request.query.keyword).trim() : '';
  const source = request.query.source ? String(request.query.source).trim() : '';
  const tags = request.query.tags
    ? String(request.query.tags)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    : [];
  const payload = await listDocumentsPaginated({
    page,
    limit,
    filters: {
      keyword,
      source,
      tags
    }
  });
  response.json(payload);
}));

app.get('/api/metrics', asyncHandler(async (_request, response) => {
  const metrics = await getMetrics();
  response.json(metrics);
}));

app.post('/api/documents', asyncHandler(async (request, response) => {
  const { content, source, tags } = request.body || {};

  if (!content || !String(content).trim()) {
    return response.status(400).json({ error: 'content is required' });
  }

  const document = await upsertDocument({
    content: String(content).trim(),
    source: source ? String(source).trim() : 'manual',
    tags: Array.isArray(tags)
      ? tags.map((item) => String(item).trim()).filter(Boolean)
      : []
  });

  return response.status(201).json({ document });
}));

app.delete('/api/documents/:id', asyncHandler(async (request, response) => {
  const deleted = await deleteDocument(request.params.id);
  response.json({ deleted: Number(deleted) > 0 });
}));

app.post('/api/search', asyncHandler(async (request, response) => {
  const {
    query,
    topK,
    page,
    limit,
    keyword,
    source,
    tags,
    tagMode
  } = request.body || {};

  if (!query || !String(query).trim()) {
    return response.status(400).json({ error: 'query is required' });
  }

  const results = await searchDocuments({
    query: String(query).trim(),
    topK: Number(topK || 5),
    page: Number(page || 1),
    limit: Number(limit || 5),
    keyword: keyword ? String(keyword).trim() : '',
    source: source ? String(source).trim() : '',
    tags: Array.isArray(tags) ? tags.map((item) => String(item).trim()).filter(Boolean) : [],
    tagMode: tagMode ? String(tagMode).trim().toLowerCase() : 'any'
  });

  return response.json(results);
}));

app.post('/mcp', asyncHandler(async (request, response) => {
  await handleMcpHttpPayload(request, response);
}));

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({
    error: error.message || 'Internal Server Error'
  });
});

async function start() {
  await connectRedis();
  await ensureAuthProfile();
  await seedDocumentsIfEmpty();

  app.listen(config.port, () => {
    console.log(`Redis RAG app listening on http://localhost:${config.port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start app:', error);
  process.exit(1);
});
