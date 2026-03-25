import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.js';
import {
  deleteDocumentsByIds,
  deleteDocSyncRepo,
  getDocSyncRepo,
  getDocumentById,
  listDocSyncRepos,
  listDocuments,
  upsertDocSyncRepo,
  upsertDocument
} from './redis.js';

const execFileAsync = promisify(execFile);
const RESERVED_FILES = new Set(['README.md', 'ABOUT.md']);
const SKIP_DIRECTORIES = new Set(['.git', 'images', 'assets', 'node_modules']);
const ALLOWED_STATUS = new Set(['published', 'draft']);
const CATEGORY_PATTERN = /^\d{2}-[a-z0-9-]+$/;
const FILE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function sanitizeName(value, fallback = 'repo') {
  return String(value || fallback)
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/\.git$/i, '')
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || fallback;
}

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function parseScalar(value) {
  const trimmed = String(value || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseValue(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => parseScalar(item))
      .filter(Boolean);
  }

  return parseScalar(trimmed);
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

    result[key] = parseValue(value);
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

function normalizeCategory(segment) {
  return String(segment || '').replace(/^\d+-/, '');
}

function parseTimestamp(value, label) {
  const timestamp = new Date(String(value || '')).getTime();
  if (Number.isNaN(timestamp)) {
    throw new Error(`${label} must be a valid date`);
  }
  return timestamp;
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

function isHttpRepo(repoUrl) {
  return /^https?:\/\//i.test(String(repoUrl || '').trim());
}

async function withAskPass(secret, fn) {
  const safeSecret = String(secret || '').trim();
  if (!safeSecret) {
    return fn({
      ...process.env,
      GIT_TERMINAL_PROMPT: '0'
    });
  }

  const scriptPath = path.join(os.tmpdir(), `redisrag-git-askpass-${crypto.randomUUID()}.sh`);
  const script = [
    '#!/bin/sh',
    'case "$1" in',
    '  *sername*) printf "%s\\n" "${GIT_AUTH_USERNAME:-x-access-token}" ;;',
    '  *) printf "%s\\n" "$GIT_AUTH_SECRET" ;;',
    'esac'
  ].join('\n');

  await fs.writeFile(scriptPath, script, { mode: 0o700 });
  try {
    return await fn({
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: scriptPath,
      GIT_AUTH_USERNAME: 'x-access-token',
      GIT_AUTH_SECRET: safeSecret
    });
  } finally {
    await fs.rm(scriptPath, { force: true });
  }
}

async function runGit(args, cwd, env) {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    env,
    maxBuffer: 1024 * 1024 * 8
  });

  return {
    stdout: String(stdout || '').trim(),
    stderr: String(stderr || '').trim()
  };
}

async function execGit(repo, args, cwd = process.cwd()) {
  const secret = isHttpRepo(repo.repoUrl) ? repo.secret : '';
  return withAskPass(secret, (env) => runGit(args, cwd, env));
}

async function collectMarkdownFiles(rootDirectory, baseDirectory) {
  const entries = await fs.readdir(rootDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDirectory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) {
        continue;
      }
      files.push(...await collectMarkdownFiles(fullPath, baseDirectory));
      continue;
    }

    if (!entry.name.endsWith('.md')) {
      continue;
    }

    files.push({
      fullPath,
      relativePath: toPosixPath(path.relative(baseDirectory, fullPath))
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

function validateAndNormalizeArticle({ relativePath, markdown, manifest, repoConfig }) {
  const segments = relativePath.split('/').filter(Boolean);
  const filename = segments[segments.length - 1] || '';

  if (filename.startsWith('_') || RESERVED_FILES.has(filename)) {
    return {
      skipped: true,
      draft: false
    };
  }

  if (segments.length < 2) {
    throw new Error('article must be placed inside a category directory');
  }

  if (!CATEGORY_PATTERN.test(segments[0])) {
    throw new Error('top-level directory must use NN-name format');
  }

  if (!FILE_PATTERN.test(filename)) {
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

  if (!id || !ID_PATTERN.test(id)) {
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
  if (!ALLOWED_STATUS.has(status)) {
    throw new Error('frontmatter.status must be published or draft');
  }

  const createdAt = parseTimestamp(frontmatter.createdAt, 'frontmatter.createdAt');
  const updatedAt = parseTimestamp(frontmatter.updatedAt, 'frontmatter.updatedAt');
  if (updatedAt < createdAt) {
    throw new Error('frontmatter.updatedAt must be greater than or equal to createdAt');
  }
  if (heading && heading !== title) {
    throw new Error('first H1 heading must match frontmatter.title');
  }

  const sourceBase = String(manifest.sourceBase || manifest.source_base || repoConfig.name || repoConfig.id).trim() || repoConfig.id;
  const checksum = createChecksum(markdown);

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
      repo: repoConfig.id,
      path: relativePath,
      checksum,
      syncManaged: true,
      body,
      content: buildIndexableContent({
        title,
        summary,
        category,
        tags,
        source: `${sourceBase}/${relativePath}`,
        body
      })
    }
  };
}

function createRepoStatus(repo = {}) {
  return {
    id: repo.id || '',
    name: repo.name || repo.id || '',
    repoUrl: repo.repoUrl || '',
    branch: repo.branch || 'main',
    docsRoot: repo.docsRoot || '.',
    enabled: repo.enabled !== false,
    hasSecret: Boolean(repo.hasSecret || repo.secret),
    running: false,
    lastTrigger: '',
    lastRunAt: 0,
    lastSuccessAt: 0,
    lastRevision: '',
    documentsScanned: 0,
    documentsSynced: 0,
    documentsSkipped: 0,
    draftsSkipped: 0,
    staleDeleted: 0,
    validationErrors: [],
    lastError: '',
    lastTestAt: 0,
    lastTestError: '',
    lastTestRevision: '',
    repoPath: ''
  };
}

function summarizeStatuses(statuses) {
  const repos = [...statuses].sort((left, right) => {
    if (left.enabled !== right.enabled) {
      return left.enabled ? -1 : 1;
    }
    return (left.name || left.id).localeCompare(right.name || right.id);
  });

  return repos.reduce((summary, repo) => {
    summary.totalRepos += 1;
    summary.enabledRepos += repo.enabled ? 1 : 0;
    summary.runningRepos += repo.running ? 1 : 0;
    summary.documentsScanned += Number(repo.documentsScanned || 0);
    summary.documentsSynced += Number(repo.documentsSynced || 0);
    summary.documentsSkipped += Number(repo.documentsSkipped || 0);
    summary.draftsSkipped += Number(repo.draftsSkipped || 0);
    summary.staleDeleted += Number(repo.staleDeleted || 0);
    summary.validationErrorCount += Array.isArray(repo.validationErrors) ? repo.validationErrors.length : 0;
    summary.lastRunAt = Math.max(summary.lastRunAt, Number(repo.lastRunAt || 0));
    summary.lastSuccessAt = Math.max(summary.lastSuccessAt, Number(repo.lastSuccessAt || 0));
    summary.repos.push(repo);
    return summary;
  }, {
    intervalMs: Math.max(10000, Number(config.docSyncIntervalMs || 180000)),
    totalRepos: 0,
    enabledRepos: 0,
    runningRepos: 0,
    documentsScanned: 0,
    documentsSynced: 0,
    documentsSkipped: 0,
    draftsSkipped: 0,
    staleDeleted: 0,
    validationErrorCount: 0,
    lastRunAt: 0,
    lastSuccessAt: 0,
    repos: []
  });
}

async function ensureRepoCheckout(repoConfig, cacheDir) {
  const repoCacheKey = sanitizeName(repoConfig.id || repoConfig.name || repoConfig.repoUrl, 'repo');
  const repoPath = path.join(cacheDir, repoCacheKey);
  const gitDirectory = path.join(repoPath, '.git');

  await fs.mkdir(cacheDir, { recursive: true });

  if (!(await pathExists(gitDirectory))) {
    await fs.rm(repoPath, { recursive: true, force: true });
    await execGit(repoConfig, ['clone', '--branch', repoConfig.branch, repoConfig.repoUrl, repoPath]);
    const revision = (await execGit(repoConfig, ['rev-parse', 'HEAD'], repoPath)).stdout;
    return { repoPath, revision, updated: true };
  }

  try {
    await execGit(repoConfig, ['rev-parse', 'HEAD'], repoPath);
  } catch (_error) {
    await fs.rm(repoPath, { recursive: true, force: true });
    await execGit(repoConfig, ['clone', '--branch', repoConfig.branch, repoConfig.repoUrl, repoPath]);
    const revision = (await execGit(repoConfig, ['rev-parse', 'HEAD'], repoPath)).stdout;
    return { repoPath, revision, updated: true };
  }

  const before = (await execGit(repoConfig, ['rev-parse', 'HEAD'], repoPath)).stdout;
  await execGit(repoConfig, ['fetch', 'origin', repoConfig.branch], repoPath);
  const remote = (await execGit(repoConfig, ['rev-parse', `origin/${repoConfig.branch}`], repoPath)).stdout;
  if (before !== remote) {
    await execGit(repoConfig, ['pull', '--ff-only', 'origin', repoConfig.branch], repoPath);
  }

  const revision = (await execGit(repoConfig, ['rev-parse', 'HEAD'], repoPath)).stdout;
  return {
    repoPath,
    revision,
    updated: before !== remote
  };
}

export class DocumentSyncService {
  constructor() {
    this.timer = null;
    this.statuses = new Map();
  }

  async initialize() {
    await this.ensureSeedReposFromConfig();
    const repos = await this.loadRepoConfigs({ includeSecrets: false });
    this.syncStatuses(repos);

    const enabledRepos = repos.filter((repo) => repo.enabled);
    if (enabledRepos.length) {
      await this.runAll('startup');
      this.startAutoSync();
    }

    return this.getStatus();
  }

  async ensureSeedReposFromConfig() {
    if (!Array.isArray(config.docSyncRepos) || !config.docSyncRepos.length) {
      return;
    }

    const existing = await listDocSyncRepos();
    if (existing.length) {
      return;
    }

    for (const repo of config.docSyncRepos) {
      await upsertDocSyncRepo({
        id: repo.id,
        name: repo.name,
        repoUrl: repo.repoUrl,
        branch: repo.branch,
        docsRoot: repo.docsRoot,
        repoName: repo.repoName,
        enabled: repo.enabled !== false,
        secret: repo.secret || '',
        secretProvided: true
      });
    }
  }

  async loadRepoConfigs({ includeSecrets = false } = {}) {
    return listDocSyncRepos({ includeSecrets });
  }

  syncStatuses(repos) {
    const activeIds = new Set();

    for (const repo of repos) {
      activeIds.add(repo.id);
      const previous = this.statuses.get(repo.id) || createRepoStatus(repo);
      this.statuses.set(repo.id, {
        ...previous,
        id: repo.id,
        name: repo.name,
        repoUrl: repo.repoUrl,
        branch: repo.branch,
        docsRoot: repo.docsRoot,
        enabled: repo.enabled !== false,
        hasSecret: Boolean(repo.hasSecret || repo.secret)
      });
    }

    for (const id of this.statuses.keys()) {
      if (!activeIds.has(id)) {
        this.statuses.delete(id);
      }
    }
  }

  getStatus() {
    return summarizeStatuses([...this.statuses.values()].map((item) => ({
      ...item,
      validationErrors: [...item.validationErrors]
    })));
  }

  async listRepos() {
    const repos = await this.loadRepoConfigs();
    this.syncStatuses(repos);
    const statusById = new Map(this.getStatus().repos.map((repo) => [repo.id, repo]));
    return repos.map((repo) => ({
      ...repo,
      ...(statusById.get(repo.id) || createRepoStatus(repo)),
      status: statusById.get(repo.id) || createRepoStatus(repo)
    }));
  }

  startAutoSync() {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.runAll('interval').catch((error) => {
        console.error('[doc-sync] scheduled sync failed:', error.message);
      });
    }, Math.max(10000, Number(config.docSyncIntervalMs || 180000)));
  }

  async saveRepo(input = {}) {
    const payload = await upsertDocSyncRepo(input);
    const repos = await this.loadRepoConfigs();
    this.syncStatuses(repos);
    if (repos.some((repo) => repo.enabled)) {
      this.startAutoSync();
    }
    return payload;
  }

  async removeRepo(id) {
    const deleted = await deleteDocSyncRepo(id);
    this.statuses.delete(String(id || '').trim());
    return deleted;
  }

  async testRepo(input = {}) {
    const repo = input.id && !input.repoUrl
      ? await getDocSyncRepo(input.id, { includeSecret: true })
      : {
          id: String(input.id || input.name || 'test-repo').trim() || 'test-repo',
          name: String(input.name || input.id || 'test-repo').trim() || 'test-repo',
          repoUrl: String(input.repoUrl || '').trim(),
          branch: String(input.branch || 'main').trim() || 'main',
          docsRoot: String(input.docsRoot || '.').trim() || '.',
          repoName: String(input.repoName || '').trim(),
          secret: String(input.secret || '').trim()
        };

    if (!repo || !repo.repoUrl) {
      throw new Error('repoUrl is required');
    }

    const now = Date.now();
    let revision = '';
    let errorMessage = '';

    try {
      if (!(await pathExists(repo.repoUrl)) && !/^([a-z]+):\/\//i.test(repo.repoUrl) && !repo.repoUrl.includes('@')) {
        throw new Error('repository path does not exist');
      }

      const result = await execGit(repo, ['ls-remote', '--heads', repo.repoUrl, repo.branch]);
      revision = result.stdout.split(/\s+/)[0] || '';
      if (!revision && !repo.repoUrl.startsWith('/')) {
        throw new Error(`branch "${repo.branch}" was not found or access was denied`);
      }

      const previous = this.statuses.get(repo.id) || createRepoStatus(repo);
      this.statuses.set(repo.id, {
        ...previous,
        id: repo.id,
        name: repo.name,
        repoUrl: repo.repoUrl,
        branch: repo.branch,
        docsRoot: repo.docsRoot,
        hasSecret: Boolean(repo.secret),
        lastTestAt: now,
        lastTestError: '',
        lastTestRevision: revision
      });

      return {
        ok: true,
        checkedAt: now,
        revision,
        message: revision ? 'repository is reachable' : 'repository is reachable'
      };
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      const previous = this.statuses.get(repo.id) || createRepoStatus(repo);
      this.statuses.set(repo.id, {
        ...previous,
        id: repo.id,
        name: repo.name,
        repoUrl: repo.repoUrl,
        branch: repo.branch,
        docsRoot: repo.docsRoot,
        hasSecret: Boolean(repo.secret),
        lastTestAt: now,
        lastTestError: errorMessage,
        lastTestRevision: ''
      });

      return {
        ok: false,
        checkedAt: now,
        revision: '',
        message: errorMessage
      };
    }
  }

  async runAll(trigger = 'manual') {
    const repos = await this.loadRepoConfigs({ includeSecrets: true });
    this.syncStatuses(repos);
    const results = [];

    for (const repo of repos) {
      if (!repo.enabled) {
        continue;
      }

      try {
        const status = await this.runRepo(repo.id, trigger);
        results.push({
          repoId: repo.id,
          ok: true,
          status
        });
      } catch (error) {
        results.push({
          repoId: repo.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      ...this.getStatus(),
      results
    };
  }

  async runRepo(repoId, trigger = 'manual') {
    const repo = await getDocSyncRepo(repoId, { includeSecret: true });
    if (!repo) {
      throw new Error('repository configuration not found');
    }

    const previous = this.statuses.get(repo.id) || createRepoStatus(repo);
    if (previous.running) {
      return previous;
    }

    this.statuses.set(repo.id, {
      ...previous,
      id: repo.id,
      name: repo.name,
      repoUrl: repo.repoUrl,
      branch: repo.branch,
      docsRoot: repo.docsRoot,
      enabled: repo.enabled !== false,
      hasSecret: Boolean(repo.hasSecret || repo.secret),
      running: true,
      lastTrigger: trigger,
      lastRunAt: Date.now(),
      lastError: '',
      validationErrors: []
    });

    try {
      const checkout = await ensureRepoCheckout(repo, config.docSyncCacheDir);
      const manifest = await loadManifest(checkout.repoPath);
      const docsRoot = path.resolve(checkout.repoPath, repo.docsRoot || '.');
      const relativeDocsRoot = path.relative(checkout.repoPath, docsRoot);
      if (relativeDocsRoot.startsWith('..')) {
        throw new Error('docsRoot must stay inside the repository');
      }

      const markdownFiles = await collectMarkdownFiles(docsRoot, checkout.repoPath);
      const publishedArticles = [];
      let documentsSkipped = 0;
      let draftsSkipped = 0;
      const validationErrors = [];

      for (const file of markdownFiles) {
        const raw = await fs.readFile(file.fullPath, 'utf8');
        try {
          const parsed = validateAndNormalizeArticle({
            relativePath: file.relativePath,
            markdown: raw,
            manifest,
            repoConfig: repo
          });

          if (parsed.skipped) {
            documentsSkipped += 1;
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
            error: error instanceof Error ? error.message : String(error)
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
        const desiredIds = new Set(publishedArticles.map((item) => item.id));
        const staleIds = existingDocuments
          .filter((document) => document.syncManaged && document.repo === repo.id && !desiredIds.has(document.id))
          .map((document) => document.id);
        staleDeleted = await deleteDocumentsByIds(staleIds);
      }

      const nextStatus = {
        ...(this.statuses.get(repo.id) || createRepoStatus(repo)),
        id: repo.id,
        name: repo.name,
        repoUrl: repo.repoUrl,
        branch: repo.branch,
        docsRoot: repo.docsRoot,
        enabled: repo.enabled !== false,
        hasSecret: Boolean(repo.hasSecret || repo.secret),
        running: false,
        lastTrigger: trigger,
        lastRunAt: Date.now(),
        lastSuccessAt: Date.now(),
        lastRevision: checkout.revision,
        documentsScanned: markdownFiles.length,
        documentsSynced,
        documentsSkipped,
        draftsSkipped,
        staleDeleted,
        validationErrors,
        lastError: '',
        repoPath: checkout.repoPath
      };

      this.statuses.set(repo.id, nextStatus);
      return nextStatus;
    } catch (error) {
      const current = this.statuses.get(repo.id) || createRepoStatus(repo);
      const nextStatus = {
        ...current,
        id: repo.id,
        name: repo.name,
        repoUrl: repo.repoUrl,
        branch: repo.branch,
        docsRoot: repo.docsRoot,
        enabled: repo.enabled !== false,
        hasSecret: Boolean(repo.hasSecret || repo.secret),
        running: false,
        lastError: error instanceof Error ? error.message : String(error)
      };
      this.statuses.set(repo.id, nextStatus);
      throw error;
    }
  }
}

export function createDocumentSyncService() {
  return new DocumentSyncService();
}
