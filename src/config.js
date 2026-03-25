import path from 'node:path';

const embeddingProvider = process.env.EMBEDDING_PROVIDER || 'simple';
const defaultEmbeddingDim = embeddingProvider === 'openai' ? 1536 : 256;
const docSyncRepoUrl = String(process.env.DOC_SYNC_REPO_URL || '').trim();
const docSyncRepoSecret = String(process.env.DOC_SYNC_REPO_SECRET || '').trim();
const docSyncEnabled = docSyncRepoUrl.length > 0;

function parseJsonEnv(value, fallback) {
  const text = String(value || '').trim();
  if (!text) {
    return fallback;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return fallback;
  }
}

function normalizeRepoSeed(repo, index) {
  if (!repo || typeof repo !== 'object' || Array.isArray(repo)) {
    return null;
  }

  const id = String(repo.id || repo.repoId || repo.name || `repo-${index + 1}`).trim();
  const repoUrl = String(repo.repoUrl || repo.url || repo.gitRepo || '').trim();
  if (!repoUrl) {
    return null;
  }

  return {
    id,
    name: String(repo.name || id).trim() || id,
    repoUrl,
    secret: String(repo.secret || repo.repoSecret || '').trim(),
    branch: String(repo.branch || repo.repoBranch || docSyncBranch || 'main').trim() || 'main',
    docsRoot: String(repo.docsRoot || repo.mdPath || '.').trim() || '.',
    repoName: String(repo.repoName || '').trim(),
    intervalMs: Number(repo.intervalMs || repo.autoSyncInterval || 180000),
    enabled: repo.enabled !== false
  };
}

const docSyncBranch = process.env.DOC_SYNC_BRANCH || 'main';
const docSyncReposSeed = parseJsonEnv(process.env.DOC_SYNC_REPOS, null);
const normalizedDocSyncRepos = Array.isArray(docSyncReposSeed)
  ? docSyncReposSeed.map(normalizeRepoSeed).filter(Boolean)
  : [];
if (!normalizedDocSyncRepos.length && docSyncRepoUrl) {
  normalizedDocSyncRepos.push(normalizeRepoSeed({
    id: 'default',
    name: 'default',
    repoUrl: docSyncRepoUrl,
    secret: docSyncRepoSecret,
    branch: docSyncBranch,
    docsRoot: String(process.env.DOC_SYNC_DOCS_ROOT || '.').trim() || '.',
    repoName: String(process.env.DOC_SYNC_REPO_NAME || '').trim(),
    intervalMs: Number(process.env.DOC_SYNC_INTERVAL_MS || 180000),
    enabled: true
  }, 0));
}

export const config = {
  port: Number(process.env.PORT || 3000),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  indexName: process.env.VECTOR_INDEX_NAME || 'rag_idx',
  keyPrefix: process.env.VECTOR_KEY_PREFIX || 'doc:',
  embeddingDim: Number(process.env.EMBEDDING_DIM || defaultEmbeddingDim),
  embeddingProvider,
  openAiApiKey: process.env.OPENAI_API_KEY || '',
  openAiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
  docSyncEnabled,
  docSyncRepoUrl,
  docSyncRepoSecret,
  docSyncBranch,
  docSyncDocsRoot: String(process.env.DOC_SYNC_DOCS_ROOT || '.').trim() || '.',
  docSyncRepoName: String(process.env.DOC_SYNC_REPO_NAME || '').trim(),
  docSyncIntervalMs: Number(process.env.DOC_SYNC_INTERVAL_MS || 180000),
  docSyncCacheDir: process.env.DOC_SYNC_CACHE_DIR || path.join(process.cwd(), '.doc-sync-cache'),
  docSyncRepos: normalizedDocSyncRepos
};
