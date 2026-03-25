import express from 'express';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';
import { promisify } from 'node:util';
import { config } from './config.js';
import { createDocumentSyncService } from './doc-sync.js';
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
const docSyncService = createDocumentSyncService();
const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const asyncHandler = (handler) => (request, response, next) =>
  Promise.resolve(handler(request, response, next)).catch(next);

function extractRepoNameFromUrl(repoUrl) {
  const normalized = String(repoUrl || '').trim().replace(/\/+$/, '');
  if (!normalized) {
    return '';
  }

  const withoutQuery = normalized.split('?')[0];
  const lastSegment = withoutQuery.split('/').filter(Boolean).pop() || '';
  return lastSegment.replace(/\.git$/i, '') || '';
}

function toNumberOrDefault(value, fallback, min = null, max = null) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  let result = parsed;
  if (typeof min === 'number') {
    result = Math.max(min, result);
  }
  if (typeof max === 'number') {
    result = Math.min(max, result);
  }
  return result;
}

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeDocsRoot(value) {
  const normalized = String(value || '').trim();
  return normalized || '.';
}

function normalizeRepoSecret(value) {
  return String(value || '').trim();
}

function normalizeRepoUrl(repoUrl, secret) {
  const normalized = String(repoUrl || '').trim();
  if (!normalized || !secret) {
    return normalized;
  }

  if (!/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  try {
    const url = new URL(normalized);
    if (secret.includes(':')) {
      const [username, password] = secret.split(':', 2);
      if (username) {
        url.username = username;
      }
      if (password) {
        url.password = password;
      }
    } else {
      if (!url.username) {
        url.username = 'oauth2';
      }
      url.password = secret;
    }
    return url.toString();
  } catch (_error) {
    return normalized;
  }
}

function normalizeRepoConfig(input, fallbackId = '') {
  const id = String(input?.id || fallbackId || crypto.randomUUID()).trim();
  const repoUrl = String(input?.repoUrl || input?.url || input?.gitRepo || '').trim();
  if (!repoUrl) {
    return null;
  }

  const secret = normalizeRepoSecret(input?.secret || input?.repoSecret);
  return {
    id,
    name: String(input?.name || extractRepoNameFromUrl(repoUrl) || id).trim() || id,
    repoUrl,
    secret,
    branch: String(input?.branch || input?.repoBranch || config.docSyncBranch || 'main').trim() || 'main',
    docsRoot: normalizeDocsRoot(input?.docsRoot || input?.mdPath || config.docSyncDocsRoot || '.'),
    repoName: String(input?.repoName || '').trim() || extractRepoNameFromUrl(repoUrl) || id,
    intervalMs: toNumberOrDefault(input?.intervalMs || input?.autoSyncInterval || config.docSyncIntervalMs || 180000, 180000, 10000, 24 * 60 * 60 * 1000),
    enabled: parseBoolean(input?.enabled, true),
    secretConfigured: Boolean(secret)
  };
}

function sanitizeRepoForClient(repo) {
  if (!repo) {
    return null;
  }

  return {
    id: repo.id,
    name: repo.name,
    repoUrl: repo.repoUrl,
    branch: repo.branch,
    docsRoot: repo.docsRoot,
    repoName: repo.repoName,
    intervalMs: repo.intervalMs,
    enabled: repo.enabled,
    secretConfigured: Boolean(repo.secret),
    createdAt: repo.createdAt,
    updatedAt: repo.updatedAt,
    lastTestAt: repo.lastTestAt || 0,
    lastTestOk: Boolean(repo.lastTestOk),
    lastTestError: repo.lastTestError || '',
    lastSyncAt: repo.lastSyncAt || 0,
    lastSyncOk: Boolean(repo.lastSyncOk),
    lastSyncError: repo.lastSyncError || '',
    lastSyncRevision: repo.lastSyncRevision || '',
    lastSyncDocumentsScanned: repo.lastSyncDocumentsScanned || 0,
    lastSyncDocumentsSynced: repo.lastSyncDocumentsSynced || 0,
    lastSyncDocumentsSkipped: repo.lastSyncDocumentsSkipped || 0,
    lastSyncDraftsSkipped: repo.lastSyncDraftsSkipped || 0,
    lastSyncStaleDeleted: repo.lastSyncStaleDeleted || 0,
    lastSyncValidationErrors: Array.isArray(repo.lastSyncValidationErrors) ? repo.lastSyncValidationErrors : [],
    syncRuns: repo.syncRuns || 0,
    syncFailures: repo.syncFailures || 0
  };
}

function sanitizeRepoList(repos) {
  return repos.map((repo) => sanitizeRepoForClient(repo));
}

function buildRepoStats(repos) {
  const now = Date.now();
  const enabled = repos.filter((repo) => repo.enabled).length;
  const running = repos.filter((repo) => repo.running).length;
  const lastSyncAt = repos.reduce((max, repo) => Math.max(max, repo.lastSyncAt || 0), 0);
  const lastTestAt = repos.reduce((max, repo) => Math.max(max, repo.lastTestAt || 0), 0);
  const lastSyncSummary = repos
    .filter((repo) => repo.lastSyncAt)
    .sort((left, right) => (right.lastSyncAt || 0) - (left.lastSyncAt || 0))[0] || null;

  return {
    total: repos.length,
    enabled,
    disabled: repos.length - enabled,
    running,
    lastSyncAt,
    lastTestAt,
    lastSyncSummary: lastSyncSummary ? {
      id: lastSyncSummary.id,
      name: lastSyncSummary.name,
      lastSyncAt: lastSyncSummary.lastSyncAt,
      lastSyncOk: Boolean(lastSyncSummary.lastSyncOk)
    } : null,
    updatedAt: now
  };
}

const syncRepoStore = new Map();
let syncRunLock = Promise.resolve();
let syncTimerHandles = new Map();

function withLock(task) {
  const next = syncRunLock.then(task, task);
  syncRunLock = next.catch(() => {});
  return next;
}

function getConfigSnapshot() {
  return {
    docSyncEnabled: config.docSyncEnabled,
    docSyncRepoUrl: config.docSyncRepoUrl,
    docSyncBranch: config.docSyncBranch,
    docSyncDocsRoot: config.docSyncDocsRoot,
    docSyncRepoName: config.docSyncRepoName,
    docSyncIntervalMs: config.docSyncIntervalMs,
    docSyncCacheDir: config.docSyncCacheDir
  };
}

function restoreConfigSnapshot(snapshot) {
  config.docSyncEnabled = snapshot.docSyncEnabled;
  config.docSyncRepoUrl = snapshot.docSyncRepoUrl;
  config.docSyncBranch = snapshot.docSyncBranch;
  config.docSyncDocsRoot = snapshot.docSyncDocsRoot;
  config.docSyncRepoName = snapshot.docSyncRepoName;
  config.docSyncIntervalMs = snapshot.docSyncIntervalMs;
  config.docSyncCacheDir = snapshot.docSyncCacheDir;
}

function applyRepoConfig(repo) {
  config.docSyncEnabled = true;
  config.docSyncRepoUrl = normalizeRepoUrl(repo.repoUrl, repo.secret);
  config.docSyncBranch = repo.branch || 'main';
  config.docSyncDocsRoot = normalizeDocsRoot(repo.docsRoot);
  config.docSyncRepoName = repo.repoName || repo.name || repo.id;
  config.docSyncIntervalMs = repo.intervalMs || 180000;
}

async function withRepoConfig(repo, task) {
  const snapshot = getConfigSnapshot();
  applyRepoConfig(repo);
  try {
    return await task();
  } finally {
    restoreConfigSnapshot(snapshot);
  }
}

function getRepoById(repoId) {
  const id = String(repoId || '').trim();
  if (!id) {
    return null;
  }

  return syncRepoStore.get(id) || null;
}

function upsertRepo(repo) {
  const now = Date.now();
  const existing = syncRepoStore.get(repo.id);
  const next = {
    ...existing,
    ...repo,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    running: existing?.running || false
  };

  syncRepoStore.set(next.id, next);
  return next;
}

function deleteRepo(repoId) {
  const repo = syncRepoStore.get(repoId);
  if (!repo) {
    return false;
  }

  const handle = syncTimerHandles.get(repoId);
  if (handle) {
    clearInterval(handle);
    syncTimerHandles.delete(repoId);
  }

  syncRepoStore.delete(repoId);
  return true;
}

function buildRepoStatus(repo) {
  return {
    ...sanitizeRepoForClient(repo),
    running: Boolean(repo.running)
  };
}

async function testRepoConnection(repo) {
  const repoUrl = normalizeRepoUrl(repo.repoUrl, repo.secret);
  const args = ['ls-remote', '--heads', repoUrl];
  if (repo.branch) {
    args.push(repo.branch);
  }

  const { stdout } = await execFileAsync('git', args, {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024 * 4
  });

  return {
    ok: true,
    refs: String(stdout || '').trim(),
    checkedAt: Date.now()
  };
}

async function syncRepoOnce(repoId, trigger = 'manual') {
  const repo = getRepoById(repoId);
  if (!repo) {
    const error = new Error('repository not found');
    error.code = 'REPO_NOT_FOUND';
    throw error;
  }

  return withLock(async () => {
    const current = syncRepoStore.get(repo.id) || repo;
    syncRepoStore.set(repo.id, {
      ...current,
      running: true,
      lastSyncError: '',
      lastSyncAt: Date.now()
    });

    try {
      const checkout = await ensureRepoCheckout(repo);
      const manifest = await loadManifest(checkout.repoPath);
      const docsRoot = path.resolve(checkout.repoPath, normalizeDocsRoot(repo.docsRoot));
      const relativeDocsRoot = path.relative(checkout.repoPath, docsRoot);
      if (relativeDocsRoot.startsWith('..')) {
        throw new Error('docsRoot must stay inside the repository');
      }

      const markdownFiles = await collectMarkdownFiles(docsRoot, checkout.repoPath);
      const publishedArticles = [];
      let skipped = 0;
      let draftsSkipped = 0;
      const validationErrors = [];
      const sourceBase = String(repo.repoName || repo.name || repo.id).trim() || repo.id;

      for (const file of markdownFiles) {
        const raw = await fs.readFile(file.fullPath, 'utf8');
        try {
          const parsed = validateAndNormalizeArticle({
            relativePath: file.relativePath,
            markdown: raw,
            manifest,
            repoKey: repo.id,
            sourceBase
          });

          if (parsed.skipped) {
            skipped += 1;
            continue;
          }

          if (parsed.draft) {
            draftsSkipped += 1;
            continue;
          }

          publishedArticles.push(parsed.article);
        } catch (error) {
          validationErrors.push({
            path: file.relativePath,
            error: error.message
          });
        }
      }

      let documentsSynced = 0;
      for (const article of publishedArticles) {
        const existing = await getDocumentById(article.id);
        if (
          existing &&
          existing.syncManaged &&
          existing.repo === repo.id &&
          existing.checksum === article.checksum &&
          existing.path === article.path
        ) {
          continue;
        }

        await upsertDocument(article);
        documentsSynced += 1;
      }

      let staleDeleted = 0;
      if (!validationErrors.length) {
        const existingDocuments = await listDocuments();
        const desiredIds = new Set(publishedArticles.map((article) => article.id));
        const staleIds = existingDocuments
          .filter((document) => document.syncManaged && document.repo === repo.id && !desiredIds.has(document.id))
          .map((document) => document.id);
        staleDeleted = await deleteDocumentsByIds(staleIds);
      }

      const status = {
        enabled: true,
        repoKey: repo.id,
        running: false,
        intervalMs: repo.intervalMs || config.docSyncIntervalMs || 180000,
        lastTrigger: trigger,
        lastRunAt: Date.now(),
        lastSuccessAt: Date.now(),
        lastRevision: checkout.revision,
        documentsScanned: markdownFiles.length,
        documentsSynced,
        documentsSkipped: skipped,
        draftsSkipped,
        staleDeleted,
        validationErrors,
        lastError: '',
        repoPath: checkout.repoPath
      };

      syncRepoStore.set(repo.id, {
        ...syncRepoStore.get(repo.id),
        running: false,
        lastSyncOk: true,
        lastSyncAt: status.lastSuccessAt,
        lastSyncError: '',
        lastSyncRevision: status.lastRevision || '',
        lastSyncDocumentsScanned: status.documentsScanned || 0,
        lastSyncDocumentsSynced: status.documentsSynced || 0,
        lastSyncDocumentsSkipped: status.documentsSkipped || 0,
        lastSyncDraftsSkipped: status.draftsSkipped || 0,
        lastSyncStaleDeleted: status.staleDeleted || 0,
        lastSyncValidationErrors: Array.isArray(status.validationErrors) ? status.validationErrors : [],
        syncRuns: (syncRepoStore.get(repo.id)?.syncRuns || 0) + 1
      });

      return status;
    } catch (error) {
      const currentRepo = syncRepoStore.get(repo.id) || repo;
      syncRepoStore.set(repo.id, {
        ...currentRepo,
        running: false,
        lastSyncOk: false,
        lastSyncAt: Date.now(),
        lastSyncError: error.message,
        syncFailures: (currentRepo.syncFailures || 0) + 1
      });
      throw error;
    }
  });
}

function scheduleRepo(repoId) {
  const repo = syncRepoStore.get(repoId);
  if (!repo) {
    return;
  }

  const existing = syncTimerHandles.get(repoId);
  if (existing) {
    clearInterval(existing);
    syncTimerHandles.delete(repoId);
  }

  if (!repo.enabled) {
    return;
  }

  const intervalMs = Math.max(10000, Number(repo.intervalMs || config.docSyncIntervalMs || 180000));
  const handle = setInterval(() => {
    syncRepoOnce(repoId, 'interval').catch((error) => {
      const current = syncRepoStore.get(repoId);
      if (current) {
        syncRepoStore.set(repoId, {
          ...current,
          running: false,
          lastSyncOk: false,
          lastSyncError: error.message,
          lastSyncAt: Date.now(),
          syncFailures: (current.syncFailures || 0) + 1
        });
      }
      console.error(`[doc-sync] scheduled sync failed for ${repoId}:`, error.message);
    });
  }, intervalMs);

  syncTimerHandles.set(repoId, handle);
}

function rescheduleRepos() {
  for (const repoId of syncRepoStore.keys()) {
    scheduleRepo(repoId);
  }
}

async function syncAllRepos(trigger = 'manual') {
  const statuses = [];
  for (const repoId of syncRepoStore.keys()) {
    const repo = syncRepoStore.get(repoId);
    if (!repo?.enabled) {
      continue;
    }
    const status = await syncRepoOnce(repoId, trigger);
    statuses.push({
      repoId,
      repoName: repo.name,
      status
    });
  }
  return statuses;
}

function initSyncRepos() {
  const seeds = Array.isArray(config.docSyncRepos) ? config.docSyncRepos : [];
  for (const seed of seeds) {
    const repo = normalizeRepoConfig(seed);
    if (repo) {
      upsertRepo(repo);
    }
  }

  if (!syncRepoStore.size && config.docSyncEnabled && config.docSyncRepoUrl) {
    const fallback = normalizeRepoConfig({
      id: 'default',
      name: 'default',
      repoUrl: config.docSyncRepoUrl,
      secret: '',
      branch: config.docSyncBranch,
      docsRoot: config.docSyncDocsRoot,
      repoName: config.docSyncRepoName,
      intervalMs: config.docSyncIntervalMs,
      enabled: true
    }, 'default');
    if (fallback) {
      upsertRepo(fallback);
    }
  }
}

initSyncRepos();

const reservedDocFiles = new Set(['README.md', 'ABOUT.md']);
const skipDocDirectories = new Set(['.git', 'images', 'assets', 'node_modules']);
const allowedDocStatuses = new Set(['published', 'draft']);
const categoryPattern = /^\d{2}-[a-z0-9-]+$/;
const filenamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseScalar(value) {
  const text = String(value || '').trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith('\'') && text.endsWith('\''))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function parseYamlBlock(text) {
  const result = {};
  let currentListKey = '';

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '  ');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    if (trimmed.startsWith('- ') && currentListKey) {
      if (!Array.isArray(result[currentListKey])) {
        result[currentListKey] = [];
      }
      result[currentListKey].push(parseScalar(trimmed.slice(2)));
      continue;
    }

    currentListKey = '';
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!value) {
      result[key] = [];
      currentListKey = key;
      continue;
    }

    if (value.startsWith('[') && value.endsWith(']')) {
      result[key] = value
        .slice(1, -1)
        .split(',')
        .map((item) => parseScalar(item))
        .filter(Boolean);
      continue;
    }

    result[key] = parseScalar(value);
  }

  return result;
}

function parseFrontmatter(markdown) {
  const match = String(markdown || '').match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) {
    return {
      frontmatter: null,
      body: String(markdown || '')
    };
  }

  return {
    frontmatter: parseYamlBlock(match[1]),
    body: match[2]
  };
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  const text = String(value || '').trim();
  if (!text) {
    return [];
  }

  return text.split(',').map((item) => item.trim()).filter(Boolean);
}

function uniqueStrings(values) {
  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))];
}

function getFirstHeading(markdown) {
  const match = String(markdown || '').match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

function createChecksum(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function buildIndexableContent(article) {
  return [
    `# ${article.title}`,
    '',
    `Summary: ${article.summary}`,
    `Category: ${article.category}`,
    `Tags: ${article.tags.join(', ')}`,
    `Source: ${article.source}`,
    '',
    article.body.trim()
  ].join('\n').trim();
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function runGit(args, cwd) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 1024 * 1024 * 8
  });

  return String(stdout || '').trim();
}

async function collectMarkdownFiles(rootDirectory, baseDirectory) {
  const entries = await fs.readdir(rootDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDirectory, entry.name);
    if (entry.isDirectory()) {
      if (skipDocDirectories.has(entry.name)) {
        continue;
      }
      const nestedFiles = await collectMarkdownFiles(fullPath, baseDirectory);
      files.push(...nestedFiles);
      continue;
    }

    if (!entry.name.endsWith('.md')) {
      continue;
    }

    files.push({
      fullPath,
      relativePath: path.relative(baseDirectory, fullPath).replace(/\\/g, '/')
    });
  }

  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function loadManifest(repoPath) {
  const manifestPath = path.join(repoPath, '_manifest.yml');
  if (!(await pathExists(manifestPath))) {
    return {};
  }

  const raw = await fs.readFile(manifestPath, 'utf8');
  return parseYamlBlock(raw);
}

function normalizeCategory(segment) {
  return String(segment || '').replace(/^\d+-/, '');
}

function validateAndNormalizeArticle({ relativePath, markdown, manifest, repoKey, sourceBase }) {
  const segments = String(relativePath || '').split('/').filter(Boolean);
  const filename = segments[segments.length - 1] || '';

  if (filename.startsWith('_') || reservedDocFiles.has(filename)) {
    return {
      skipped: true
    };
  }

  if (segments.length < 2) {
    throw new Error('article must be placed inside a category directory');
  }

  if (!categoryPattern.test(segments[0])) {
    throw new Error('top-level directory must use NN-name format');
  }

  if (!filenamePattern.test(filename)) {
    throw new Error('filename must use kebab-case.md');
  }

  const { frontmatter, body } = parseFrontmatter(markdown);
  if (!frontmatter) {
    throw new Error('frontmatter is required');
  }

  const category = normalizeCategory(segments[0]);
  const defaultTags = normalizeStringArray(manifest.defaultTags || manifest.default_tags);
  const tags = uniqueStrings([...defaultTags, ...normalizeStringArray(frontmatter.tags), category]);
  const id = String(frontmatter.id || '').trim();
  const title = String(frontmatter.title || '').trim();
  const summary = String(frontmatter.description || frontmatter.summary || '').trim();
  const declaredCategory = String(frontmatter.category || '').trim();
  const status = String(frontmatter.status || '').trim().toLowerCase();
  const fileStem = filename.replace(/\.md$/i, '');
  const heading = getFirstHeading(body);

  if (!id || !idPattern.test(id)) {
    throw new Error('frontmatter.id is required and must use kebab-case');
  }

  if (fileStem !== id) {
    throw new Error('filename must match frontmatter.id');
  }

  if (!title) {
    throw new Error('frontmatter.title is required');
  }

  if (!summary) {
    throw new Error('frontmatter.description is required');
  }

  if (!declaredCategory) {
    throw new Error('frontmatter.category is required');
  }

  if (declaredCategory !== category) {
    throw new Error(`frontmatter.category must match directory category "${category}"`);
  }

  if (!tags.length) {
    throw new Error('frontmatter.tags must contain at least one tag');
  }

  if (!allowedDocStatuses.has(status)) {
    throw new Error('frontmatter.status must be published or draft');
  }

  const createdAt = new Date(String(frontmatter.createdAt || '')).getTime();
  const updatedAt = new Date(String(frontmatter.updatedAt || '')).getTime();
  if (Number.isNaN(createdAt) || Number.isNaN(updatedAt)) {
    throw new Error('frontmatter.createdAt and frontmatter.updatedAt must be valid dates');
  }

  if (updatedAt < createdAt) {
    throw new Error('frontmatter.updatedAt must be greater than or equal to createdAt');
  }

  if (heading && heading !== title) {
    throw new Error('first H1 heading must match frontmatter.title');
  }

  const content = buildIndexableContent({
    title,
    summary,
    category,
    tags,
    source: `${sourceBase}/${relativePath}`,
    body
  });

  return {
    skipped: false,
    draft: status === 'draft',
    article: {
      id,
      title,
      summary,
      category,
      tags,
      source: `${sourceBase}/${relativePath}`,
      createdAt,
      updatedAt,
      repo: repoKey,
      path: relativePath,
      checksum: createChecksum(markdown),
      syncManaged: true,
      body,
      content
    }
  };
}

async function ensureRepoCheckout(repo) {
  const cacheRoot = config.docSyncCacheDir;
  const repoKey = repo.repoName || repo.name || repo.id;
  const repoPath = path.join(cacheRoot, repoKey);
  const gitDirectory = path.join(repoPath, '.git');
  const branch = repo.branch || 'main';
  const repoUrl = normalizeRepoUrl(repo.repoUrl, repo.secret);

  await fs.mkdir(cacheRoot, { recursive: true });

  if (!(await pathExists(gitDirectory))) {
    await fs.rm(repoPath, { recursive: true, force: true });
    await execFileAsync('git', ['clone', '--branch', branch, repoUrl, repoPath], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024 * 8
    });
    const revision = await runGit(['rev-parse', 'HEAD'], repoPath);
    return {
      repoPath,
      revision,
      updated: true,
      initialClone: true
    };
  }

  try {
    await runGit(['rev-parse', 'HEAD'], repoPath);
  } catch (_error) {
    await fs.rm(repoPath, { recursive: true, force: true });
    await execFileAsync('git', ['clone', '--branch', branch, repoUrl, repoPath], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024 * 8
    });
    const revision = await runGit(['rev-parse', 'HEAD'], repoPath);
    return {
      repoPath,
      revision,
      updated: true,
      initialClone: true
    };
  }

  const before = await runGit(['rev-parse', 'HEAD'], repoPath);
  await runGit(['fetch', 'origin', branch], repoPath);
  const remote = await runGit(['rev-parse', `origin/${branch}`], repoPath);
  if (before !== remote) {
    await runGit(['pull', '--ff-only', 'origin', branch], repoPath);
  }

  const revision = await runGit(['rev-parse', 'HEAD'], repoPath);
  return {
    repoPath,
    revision,
    updated: before !== remote,
    initialClone: false
  };
}

function validateRepoPayload(body, existingRepo = null) {
  const isUpdate = Boolean(existingRepo);
  const repoUrlInput = Object.prototype.hasOwnProperty.call(body || {}, 'repoUrl')
    ? body.repoUrl
    : existingRepo?.repoUrl;
  const repoUrl = String(repoUrlInput || '').trim();
  if (!repoUrl) {
    throw new Error('repoUrl is required');
  }

  const nameInput = Object.prototype.hasOwnProperty.call(body || {}, 'name')
    ? body.name
    : existingRepo?.name;
  const branchInput = Object.prototype.hasOwnProperty.call(body || {}, 'branch')
    ? body.branch
    : existingRepo?.branch;
  const docsRootInput = Object.prototype.hasOwnProperty.call(body || {}, 'docsRoot')
    ? body.docsRoot
    : existingRepo?.docsRoot;
  const repoNameInput = Object.prototype.hasOwnProperty.call(body || {}, 'repoName')
    ? body.repoName
    : existingRepo?.repoName;
  const secretInput = Object.prototype.hasOwnProperty.call(body || {}, 'secret')
    ? body.secret
    : existingRepo?.secret || '';
  const intervalMsInput = Object.prototype.hasOwnProperty.call(body || {}, 'intervalMs')
    ? body.intervalMs
    : existingRepo?.intervalMs;
  const enabledInput = Object.prototype.hasOwnProperty.call(body || {}, 'enabled')
    ? body.enabled
    : existingRepo?.enabled;

  const branch = String(branchInput || config.docSyncBranch || 'main').trim() || 'main';
  const docsRoot = normalizeDocsRoot(docsRootInput);
  const repoName = String(repoNameInput || extractRepoNameFromUrl(repoUrl) || (existingRepo?.id || '')).trim() || extractRepoNameFromUrl(repoUrl) || existingRepo?.id || '';
  const secret = normalizeRepoSecret(secretInput);
  const intervalMs = toNumberOrDefault(intervalMsInput, existingRepo?.intervalMs || config.docSyncIntervalMs || 180000, 10000, 24 * 60 * 60 * 1000);
  const enabled = parseBoolean(enabledInput, existingRepo?.enabled ?? true);

  return {
    id: existingRepo?.id || String(body?.id || crypto.randomUUID()).trim(),
    name: String(nameInput || repoName || existingRepo?.id || '').trim() || repoName || existingRepo?.id || '',
    repoUrl,
    secret,
    branch,
    docsRoot,
    repoName,
    intervalMs,
    enabled,
    secretConfigured: Boolean(secret),
    createdAt: existingRepo?.createdAt || Date.now()
  };
}

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
    indexName: config.indexName,
    sync: docSyncService.getStatus()
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
  response.json({
    ...metrics,
    sync: docSyncService.getStatus()
  });
}));

function normalizeRepoMutationPayload(body = {}, existingRepo = null) {
  const normalized = validateRepoPayload(body, existingRepo);
  return {
    id: normalized.id,
    name: normalized.name,
    repoUrl: normalized.repoUrl,
    branch: normalized.branch,
    docsRoot: normalized.docsRoot,
    repoName: normalized.repoName,
    enabled: normalized.enabled,
    secret: normalized.secret,
    secretProvided: Object.prototype.hasOwnProperty.call(body, 'secret'),
    clearSecret: parseBoolean(body.clearSecret, false)
  };
}

app.get(['/api/sync/status', '/api/doc-sync/status'], asyncHandler(async (_request, response) => {
  const repositories = await docSyncService.listRepos();
  response.json({
    ...docSyncService.getStatus(),
    repositories
  });
}));

app.post(['/api/sync/run', '/api/doc-sync/run'], asyncHandler(async (request, response) => {
  const repoId = request.body?.repoId ? String(request.body.repoId).trim() : '';
  if (repoId) {
    const status = await docSyncService.runRepo(repoId, 'api');
    return response.json({ repoId, status });
  }

  const status = await docSyncService.runAll('api');
  return response.json(status);
}));

app.get(['/api/sync/repos', '/api/doc-sync/repos'], asyncHandler(async (_request, response) => {
  const repositories = await docSyncService.listRepos();
  response.json({
    repositories
  });
}));

app.post(['/api/sync/repos', '/api/doc-sync/repos'], asyncHandler(async (request, response) => {
  const repository = await docSyncService.saveRepo(normalizeRepoMutationPayload(request.body || {}));
  return response.status(201).json({ repository });
}));

app.get(['/api/sync/repos/:id', '/api/doc-sync/repos/:id'], asyncHandler(async (request, response) => {
  const repositories = await docSyncService.listRepos();
  const repository = repositories.find((item) => item.id === String(request.params.id || '').trim());
  if (!repository) {
    return response.status(404).json({ error: 'repository not found' });
  }

  return response.json({ repository });
}));

app.put(['/api/sync/repos/:id', '/api/doc-sync/repos/:id'], asyncHandler(async (request, response) => {
  const repositories = await docSyncService.listRepos();
  const existing = repositories.find((item) => item.id === String(request.params.id || '').trim());
  if (!existing) {
    return response.status(404).json({ error: 'repository not found' });
  }

  const repository = await docSyncService.saveRepo({
    ...normalizeRepoMutationPayload(request.body || {}, existing),
    id: existing.id
  });

  return response.json({ repository });
}));

app.delete(['/api/sync/repos/:id', '/api/doc-sync/repos/:id'], asyncHandler(async (request, response) => {
  const deleted = await docSyncService.removeRepo(request.params.id);
  if (!deleted) {
    return response.status(404).json({ error: 'repository not found' });
  }

  return response.json({ deleted: true });
}));

app.post(['/api/sync/repos/:id/test', '/api/doc-sync/repos/:id/test'], asyncHandler(async (request, response) => {
  const repositories = await docSyncService.listRepos();
  const exists = repositories.some((item) => item.id === String(request.params.id || '').trim());
  if (!exists) {
    return response.status(404).json({ error: 'repository not found' });
  }

  const result = await docSyncService.testRepo({ id: request.params.id });
  if (!result.ok) {
    return response.status(400).json(result);
  }

  return response.json(result);
}));

app.post(['/api/sync/test', '/api/doc-sync/repos/test', '/api/doc-sync/test'], asyncHandler(async (request, response) => {
  const result = await docSyncService.testRepo(normalizeRepoMutationPayload(request.body || {}));
  if (!result.ok) {
    return response.status(400).json(result);
  }

  return response.json(result);
}));

app.post(['/api/sync/repos/:id/sync', '/api/doc-sync/repos/:id/sync'], asyncHandler(async (request, response) => {
  const repositories = await docSyncService.listRepos();
  const exists = repositories.some((item) => item.id === String(request.params.id || '').trim());
  if (!exists) {
    return response.status(404).json({ error: 'repository not found' });
  }

  const status = await docSyncService.runRepo(request.params.id, 'api');
  return response.json({ repoId: request.params.id, status });
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

  let syncStatus = null;
  try {
    syncStatus = await docSyncService.initialize();
  } catch (error) {
    console.error('[doc-sync] startup sync failed:', error.message);
    syncStatus = docSyncService.getStatus();
  }

  if (!syncStatus.totalRepos) {
    await seedDocumentsIfEmpty();
  }

  app.listen(config.port, () => {
    console.log(`Redis RAG app listening on http://localhost:${config.port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start app:', error);
  process.exit(1);
});
