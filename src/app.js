import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
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
    tags
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
    tags: Array.isArray(tags) ? tags.map((item) => String(item).trim()).filter(Boolean) : []
  });

  return response.json(results);
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
