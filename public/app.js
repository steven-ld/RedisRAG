const APP_VERSION = '1.0.0';
const authTokenKey = 'redis_rag_token';
const SEARCH_PAGE_LIMIT = 5;
const DEFAULT_DOCUMENT_LIMIT = 6;
const DOCUMENT_SNIPPET_LIMIT = 300;

const state = {
  requirePasswordChange: false,
  currentView: 'monitor',
  session: null,
  health: null,
  metrics: null,
  sync: {
    summary: null,
    repositories: [],
    selectedRepoId: '',
    loading: false,
    error: '',
    lastLoadedAt: 0
  },
  metricsTimer: null,
  documents: {
    page: 1,
    totalPages: 1,
    limit: DEFAULT_DOCUMENT_LIMIT,
    filters: {
      keyword: '',
      source: '',
      tags: []
    }
  },
  search: {
    page: 1,
    totalPages: 1,
    payload: null
  }
};

const METRICS_AUTO_REFRESH_INTERVAL = 5000;
const SYNC_STATUS_ENDPOINTS = ['/api/doc-sync/status', '/api/sync/status'];
const SYNC_REPO_ENDPOINTS = ['/api/doc-sync/repos', '/api/sync/repos'];
const SYNC_REPO_TEST_ENDPOINTS = ['/api/doc-sync/repos/test', '/api/sync/repos/test'];

function first(...selectors) {
  for (const selector of selectors.flat()) {
    if (!selector) continue;
    const element = document.querySelector(selector);
    if (element) return element;
  }
  return null;
}

function all(...selectors) {
  const elements = [];
  for (const selector of selectors.flat()) {
    if (!selector) continue;
    elements.push(...document.querySelectorAll(selector));
  }
  return elements;
}

function on(element, eventName, handler, options) {
  if (element) {
    element.addEventListener(eventName, handler, options);
  }
}

function setHidden(element, hidden) {
  if (element) {
    element.classList.toggle('hidden', hidden);
  }
}

function setText(element, value) {
  if (element) {
    element.textContent = value == null ? '' : String(value);
  }
}

function getToken() {
  return localStorage.getItem(authTokenKey) || '';
}

function clearTokenAndRedirect() {
  localStorage.removeItem(authTokenKey);
  window.location.href = '/login.html';
}

if (!getToken()) {
  clearTokenAndRedirect();
}

const root = document.documentElement;
const body = document.body;
const sidebarNav = first('#sidebar-nav', '[data-sidebar-nav]', '.sidebar-nav');
const navControls = sidebarNav
  ? Array.from(sidebarNav.querySelectorAll('[data-view], button, a'))
  : all('[data-view]', '[data-nav-view]');

const viewRoots = {
  monitor: first('#page-monitor', '[data-page="monitor"]', '#monitor-page'),
  search: first('#page-search', '[data-page="search"]', '#search-page'),
  documents: first('#page-documents', '[data-page="documents"]', '#documents-page'),
  api: first('#page-api', '[data-page="api"]', '#api-page'),
  settings: first('#page-settings', '[data-page="settings"]', '#settings-page'),
  about: first('#page-about', '[data-page="about"]', '#about-page')
};

const addForm = first('#add-form', '#document-create-form');
const searchForm = first('#search-form');
const documentsContainer = first('#documents', '#document-list');
const resultsContainer = first('#results', '#search-results');
const healthStatus = first('#health-status', '#monitor-health-status');
const healthMeta = first('#health-meta', '#monitor-health-meta');
const healthIndicator = first('#health-indicator');
const healthIndex = first('#health-index');
const healthDims = first('#health-dims');
const resultTemplate = first('#result-template');
const documentTemplate = first('#document-template');
const documentsCount = first('#documents-count', '#document-count');
const pageInfoText = first('#page-info', '#document-page-info');
const pageFirstButton = first('#page-first', '#document-page-first');
const prevPageButton = first('#page-prev', '#document-page-prev');
const nextPageButton = first('#page-next', '#document-page-next');
const pageLastButton = first('#page-last', '#document-page-last');
const pageLimitSelect = first('#page-limit', '#document-page-limit');
const pageJumpInput = first('#page-jump', '#document-page-jump');
const pageGoButton = first('#page-go', '#document-page-go');
const refreshMetricsButton = first('#refresh-metrics');
const metricMemoryUsed = first('#metric-memory-used');
const metricMemoryPeak = first('#metric-memory-peak');
const metricMemoryBar = first('#metric-memory-bar');
const metricMemoryUsageRate = first('#metric-memory-usage-rate');
const metricMemoryRss = first('#metric-memory-rss');
const metricRedisHitRate = first('#metric-redis-hit-rate');
const metricRedisBar = first('#metric-redis-bar');
const metricTotalCommands = first('#metric-total-commands');
const metricSearchHitRate = first('#metric-search-hit-rate');
const metricSearchAvg = first('#metric-search-avg');
const metricSearchQueries = first('#metric-search-queries');
const metricSearchResults = first('#metric-search-results');
const mcpHitRate = first('#mcp-hit-rate');
const mcpAvgResults = first('#mcp-avg-results');
const mcpLastQuery = first('#mcp-last-query');
const mcpHits = first('#mcp-hits');
const mcpQueries = first('#mcp-queries');
const mcpQpm = first('#mcp-qpm');
const mcpQp5m = first('#mcp-qp5m');
const mcpMissRate = first('#mcp-miss-rate');
const searchLatency = first('#search-latency');
const searchHitRate = first('#search-hit-rate');
const searchResultCount = first('#search-result-count');
const searchAvgScore = first('#search-avg-score');
const apiKeyForm = first('#apikey-form', '#api-key-form');
const apiKeyNameInput = first('#apikey-name', '#api-key-name');
const apiKeyDaysInput = first('#apikey-days', '#api-key-days');
const apiKeyGenerated = first('#apikey-generated', '#api-key-generated-result');
const apiKeyList = first('#apikey-list', '#api-key-list');
const searchCount = first('#search-count');
const searchPageInfoText = first('#search-page-info');
const searchPrevPageButton = first('#search-page-prev');
const searchNextPageButton = first('#search-page-next');
const logoutButton = first('#logout-btn', '#logout-button');
const passwordModal = first('#password-modal');
const forcePasswordForm = first('#force-password-form');
const forceNewPasswordInput = first('#force-new-password');
const forcePasswordMessage = first('#force-password-message');
const documentFilterForm = first('#document-filter-form');
const documentFilterResetButton = first('#document-filter-reset');
const documentKeywordInput = first('#document-keyword');
const documentSourceInput = first('#document-source');
const documentTagsInput = first('#document-tags');
const documentCreateButton = first('#document-create-btn', '#open-document-modal');
const documentModal = first('#document-modal', '#document-create-modal');
const documentModalCloseButton = first('#document-modal-close', '#document-create-close');
const documentCreateCancelButton = first('#document-create-cancel');
const documentCreateForm = first('#document-create-form', '#add-form');
const documentCreateSourceInput = first('#document-create-source', '#source');
const documentCreateTagsInput = first('#document-create-tags', '#tags');
const documentCreateContentInput = first('#document-create-content', '#content');
const aboutVersion = first('#about-version', '#about-version-value');
const aboutStatusList = first('#about-status-list', '#about-system-status');
const aboutHealthStatus = first('#about-health-status');
const aboutEmbeddingProvider = first('#about-embedding-provider');
const aboutIndexName = first('#about-index-name');
const aboutEmbeddingModel = first('#about-embedding-model');
const aboutUptime = first('#about-uptime');
const aboutLoginUser = first('#about-login-user');
const aboutPasswordState = first('#about-password-state');
const aboutRedisHitRate = first('#about-redis-hit-rate');
const aboutTotalCommands = first('#about-total-commands');
const aboutSearchHitRate = first('#about-search-hit-rate');
const aboutMcpQpm = first('#about-mcp-qpm');
const aboutLastQuery = first('#about-last-query');
const aboutMemoryUsage = first('#about-memory-usage');
const aboutMemoryRss = first('#about-memory-rss');
const aboutVersionHint = first('#about-version-hint');
const syncMonitorBadge = first('#sync-monitor-badge');
const syncMonitorSummary = first('#sync-monitor-summary');
const syncMonitorList = first('#sync-monitor-list');
const syncMonitorRepos = first('#sync-monitor-repos');
const syncMonitorLastRun = first('#sync-monitor-last-run');
const syncMonitorLastSuccess = first('#sync-monitor-last-success');
const syncMonitorDocsSynced = first('#sync-monitor-docs-synced');
const syncMonitorDocsSkipped = first('#sync-monitor-docs-skipped');
const syncMonitorStaleDeleted = first('#sync-monitor-stale-deleted');
const syncMonitorValidationErrors = first('#sync-monitor-validation-errors');
const syncMonitorEnabledRepos = first('#sync-monitor-enabled-repos');
const syncMonitorTotalRepos = first('#sync-monitor-total-repos');
const syncMonitorLastError = first('#sync-monitor-last-error');
const syncRepoAddButton = first('#sync-repo-add-button');
const syncRepoList = first('#sync-repo-list');
const syncRepoForm = first('#sync-repo-form');
const syncRepoIdInput = first('#sync-repo-id');
const syncRepoNameInput = first('#sync-repo-name');
const syncRepoUrlInput = first('#sync-repo-url');
const syncRepoBranchInput = first('#sync-repo-branch');
const syncRepoRootInput = first('#sync-repo-root');
const syncRepoSecretInput = first('#sync-repo-secret');
const syncRepoEnabledInput = first('#sync-repo-enabled');
const syncRepoTestButton = first('#sync-repo-test-button');
const syncRepoSaveButton = first('#sync-repo-save-button');
const syncRepoDeleteButton = first('#sync-repo-delete-button');
const syncRepoResetButton = first('#sync-repo-reset-button');
const syncRepoMessage = first('#sync-repo-message');
const syncRepoStatusBadge = first('#sync-repo-status-badge');
const syncRepoCardCount = first('#sync-repo-card-count');
const syncRepoRunButton = first('#sync-repo-run-button');
const syncRepoSelectedName = first('#sync-repo-selected-name');
const syncRepoSelectedState = first('#sync-repo-selected-state');
const syncRepoSelectedSuccess = first('#sync-repo-selected-success');
const syncRepoSelectedRun = first('#sync-repo-selected-run');
const syncRepoSelectedSynced = first('#sync-repo-selected-synced');
const syncRepoSelectedErrors = first('#sync-repo-selected-errors');
const settingsOverviewTotal = first('#settings-overview-total');
const settingsOverviewSuccess = first('#settings-overview-success');
const settingsOverviewErrors = first('#settings-overview-errors');
const settingsOverviewSynced = first('#settings-overview-synced');
const settingsSelectionCard = first('.settings-selection-card');
const documentPreviewModal = first('#document-preview-modal');
const documentPreviewCloseButton = first('#document-preview-close');
const documentPreviewTitle = first('#document-preview-title');
const documentPreviewMeta = first('#document-preview-meta');
const documentPreviewToc = first('#document-preview-toc');
const documentPreviewTocCount = first('#document-preview-toc-count');
const documentPreviewContent = first('#document-preview-content');

let documentsPageLimit = Number(pageLimitSelect?.value || DEFAULT_DOCUMENT_LIMIT);
let currentPage = 1;
let totalPages = 1;
let currentSearchPage = 1;
let totalSearchPages = 1;
let currentSearchPayload = null;

function splitTags(input) {
  return String(input || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function truncateText(value, maxLength = DOCUMENT_SNIPPET_LIMIT) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

function slugifyHeading(text, index) {
  const normalized = String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');

  return normalized ? `section-${index + 1}-${normalized}` : `section-${index + 1}`;
}

function parseInlineMarkdown(value) {
  let html = escapeHtml(value);

  html = html.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, '<img src="$2" alt="$1" />');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  return html;
}

function renderMarkdownDocument(value) {
  const source = String(value || '').replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const html = [];
  const headings = [];
  let paragraph = [];
  let listItems = [];
  let listType = '';
  let quoteLines = [];
  let inCodeBlock = false;
  let codeLines = [];
  let codeLanguage = '';

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${parseInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    const tag = listType || 'ul';
    html.push(`<${tag}>${listItems.map((item) => `<li>${parseInlineMarkdown(item)}</li>`).join('')}</${tag}>`);
    listItems = [];
    listType = '';
  };

  const flushQuote = () => {
    if (!quoteLines.length) return;
    const content = quoteLines
      .map((line) => `<p>${parseInlineMarkdown(line)}</p>`)
      .join('');
    html.push(`<blockquote>${content}</blockquote>`);
    quoteLines = [];
  };

  const flushCode = () => {
    if (!inCodeBlock) return;
    html.push(
      `<pre><code${codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : ''}>${escapeHtml(codeLines.join('\n'))}</code></pre>`
    );
    inCodeBlock = false;
    codeLines = [];
    codeLanguage = '';
  };

  for (const rawLine of lines) {
    const line = rawLine ?? '';
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        flushCode();
      } else {
        flushParagraph();
        flushList();
        flushQuote();
        inCodeBlock = true;
        codeLanguage = trimmed.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      flushQuote();
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      const id = slugifyHeading(title, headings.length);
      headings.push({ id, level, title });
      html.push(`<h${level} id="${id}">${parseInlineMarkdown(title)}</h${level}>`);
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (unorderedMatch || orderedMatch) {
      flushParagraph();
      flushQuote();
      const nextType = orderedMatch ? 'ol' : 'ul';
      if (listType && listType !== nextType) {
        flushList();
      }
      listType = nextType;
      listItems.push((orderedMatch || unorderedMatch)[1].trim());
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushParagraph();
      flushList();
      quoteLines.push(trimmed.replace(/^>\s?/, ''));
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushQuote();
  flushCode();

  if (!html.length) {
    html.push('<p>该文档暂无内容。</p>');
  }

  return {
    html: html.join(''),
    headings
  };
}

function formatBytes(value) {
  if (!value) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let number = Number(value);

  while (number >= 1024 && index < units.length - 1) {
    number /= 1024;
    index += 1;
  }

  return `${number.toFixed(2)} ${units[index]}`;
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return '-';
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function formatDateTime(value) {
  if (!value) return '暂无查询';
  return new Date(Number(value)).toLocaleString();
}

function formatSyncDateTime(value) {
  if (!value) return '暂无';
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return '暂无';
  return new Date(parsed).toLocaleString();
}

function maskApiKey(value) {
  if (!value || value.length < 16) return value || '';
  return `${value.slice(0, 12)}...${value.slice(-6)}`;
}

function normalizeSyncRepo(repo = {}) {
  return {
    id: String(repo.id || repo.repoId || repo.name || repo.repoUrl || '').trim(),
    name: String(repo.name || repo.repoName || '未命名仓库').trim(),
    repoUrl: String(repo.repoUrl || repo.url || '').trim(),
    branch: String(repo.branch || 'main').trim(),
    docsRoot: String(repo.docsRoot || repo.docsPath || '.').trim() || '.',
    secret: String(repo.secret || repo.token || '').trim(),
    hasSecret: Boolean(repo.hasSecret || repo.secretMasked || repo.secret),
    enabled: repo.enabled !== false,
    running: Boolean(repo.running),
    lastRunAt: Number(repo.lastRunAt || repo.lastSyncAt || 0),
    lastSuccessAt: Number(repo.lastSuccessAt || repo.lastSyncedAt || 0),
    lastTestAt: Number(repo.lastTestAt || 0),
    documentsScanned: Number(repo.documentsScanned || repo.scanned || 0),
    documentsSynced: Number(repo.documentsSynced || repo.synced || 0),
    documentsSkipped: Number(repo.documentsSkipped || repo.skipped || 0),
    draftsSkipped: Number(repo.draftsSkipped || repo.draftSkipped || 0),
    staleDeleted: Number(repo.staleDeleted || 0),
    validationErrors: Array.isArray(repo.validationErrors) ? repo.validationErrors : [],
    lastError: String(repo.lastError || '').trim(),
    lastStatus: String(repo.lastStatus || repo.status || '').trim(),
    repoKey: String(repo.repoKey || repo.cacheKey || '').trim(),
    lastRevision: String(repo.lastRevision || '').trim()
  };
}

function normalizeSyncSummary(summary = {}) {
  const repositories = Array.isArray(summary.repositories)
    ? summary.repositories
    : Array.isArray(summary.repos)
      ? summary.repos
      : (summary.repoUrl || summary.repoKey || summary.repoPath || summary.name ? [summary] : []);

  const normalizedRepos = repositories.map((repo) => normalizeSyncRepo(repo));
  const enabledRepos = normalizedRepos.filter((repo) => repo.enabled).length;
  const validationErrors = Number(
    summary.validationErrors ||
    summary.validationErrorCount ||
    summary.errorCount ||
    normalizedRepos.reduce((total, repo) => total + repo.validationErrors.length, 0)
  );

  return {
    enabled: summary.enabled !== false,
    totalRepos: Number(summary.totalRepos || summary.repoCount || normalizedRepos.length),
    enabledRepos: Number(summary.enabledRepos || enabledRepos),
    lastRunAt: Number(summary.lastRunAt || 0),
    lastSuccessAt: Number(summary.lastSuccessAt || 0),
    documentsScanned: Number(summary.documentsScanned || summary.scanned || normalizedRepos.reduce((total, repo) => total + repo.documentsScanned, 0)),
    documentsSynced: Number(summary.documentsSynced || summary.synced || normalizedRepos.reduce((total, repo) => total + repo.documentsSynced, 0)),
    documentsSkipped: Number(summary.documentsSkipped || summary.skipped || normalizedRepos.reduce((total, repo) => total + repo.documentsSkipped, 0)),
    draftsSkipped: Number(summary.draftsSkipped || summary.draftSkipped || normalizedRepos.reduce((total, repo) => total + repo.draftsSkipped, 0)),
    staleDeleted: Number(summary.staleDeleted || summary.deleted || normalizedRepos.reduce((total, repo) => total + repo.staleDeleted, 0)),
    validationErrors,
    lastError: String(summary.lastError || summary.error || '').trim(),
    lastMessage: String(summary.lastMessage || summary.message || '').trim(),
    repositories: normalizedRepos
  };
}

function showForcePasswordModal(message = '') {
  setHidden(passwordModal, false);
  if (message) {
    setText(forcePasswordMessage, message);
  }
}

function hideForcePasswordModal() {
  setHidden(passwordModal, true);
  setText(forcePasswordMessage, '');
  forcePasswordForm?.reset();
}

function ensurePasswordChange(message = '请先完成首次改密。') {
  if (state.requirePasswordChange) {
    showForcePasswordModal(message);
    return true;
  }
  return false;
}

function setNavActive(view) {
  state.currentView = view;
  root.dataset.activeView = view;
  if (body) {
    body.dataset.activeView = view;
  }

  for (const control of navControls) {
    const target = control.dataset.view || control.dataset.page || control.getAttribute('href')?.replace(/^#/, '');
    const active = target === view;
    control.classList.toggle('active', active);
    control.classList.toggle('is-active', active);
    control.setAttribute('aria-current', active ? 'page' : 'false');
  }

  for (const [name, element] of Object.entries(viewRoots)) {
    setHidden(element, Boolean(element) && name !== view);
  }
}

function updateHealthSummary(health, errorMessage = '') {
  const status = health ? '在线' : '异常';
  setText(healthStatus, status);

  if (healthIndicator) {
    healthIndicator.className = 'status-indicator ' + (health ? 'online' : 'offline');
  }

  if (healthIndex) {
    setText(healthIndex, health?.indexName || '-');
  }
  if (healthDims) {
    setText(healthDims, health?.vectorDimension || '-');
  }

  if (!healthMeta) return;

  if (health) {
    setText(healthMeta, health.errorMessage || 'Redis 连接正常');
  } else {
    setText(healthMeta, errorMessage || '正在检测 Redis 与索引');
  }
}

function renderAbout() {
  const health = state.health || {};
  const metrics = state.metrics || {};
  const version = health.version || health.appVersion || APP_VERSION;

  setText(aboutVersion, version);
  setText(aboutIndexName, health.indexName || '-');
  setText(aboutEmbeddingProvider, health.embeddingProvider || '-');

  if (aboutEmbeddingModel && health.embeddingModel) {
    setText(aboutEmbeddingModel, health.embeddingModel);
  }
}

function renderSyncSummary() {
  const summary = state.sync.summary || normalizeSyncSummary({});

  setText(syncMonitorBadge, summary.enabled ? '已启用' : '未启用');
  setText(syncMonitorTotalRepos, String(summary.totalRepos || 0));
  setText(syncMonitorEnabledRepos, String(summary.enabledRepos || 0));
  setText(syncMonitorLastRun, formatSyncDateTime(summary.lastRunAt));
  setText(syncMonitorLastSuccess, formatSyncDateTime(summary.lastSuccessAt));
  setText(syncMonitorDocsSynced, String(summary.documentsSynced || 0));
  setText(syncMonitorDocsSkipped, String(summary.documentsSkipped || 0));
  setText(syncMonitorStaleDeleted, String(summary.staleDeleted || 0));
  setText(syncMonitorValidationErrors, String(summary.validationErrors || 0));
  setText(syncMonitorLastError, summary.lastError || summary.lastMessage || '暂无异常');
  setText(settingsOverviewTotal, String(summary.totalRepos || 0));
  setText(settingsOverviewSuccess, formatSyncDateTime(summary.lastSuccessAt));
  setText(settingsOverviewErrors, String(summary.validationErrors || 0));
  setText(settingsOverviewSynced, String(summary.documentsSynced || 0));

  if (syncMonitorSummary) {
    syncMonitorSummary.classList.toggle('is-empty', !summary.totalRepos);
  }
}

function getRepoVisualState(repo) {
  if (!repo) {
    return { label: '未配置', className: 'offline' };
  }
  if (repo.running) {
    return { label: '同步中', className: 'running' };
  }
  if (repo.lastError) {
    return { label: '异常', className: 'offline' };
  }
  if (!repo.enabled) {
    return { label: '停用', className: 'offline' };
  }
  return { label: '正常', className: 'online' };
}

function renderSelectedRepoSnapshot(repo = null) {
  const current = repo ? normalizeSyncRepo(repo) : null;
  const visual = getRepoVisualState(current);

  setText(syncRepoSelectedName, current?.name || '新建仓库');
  setText(syncRepoSelectedSuccess, formatSyncDateTime(current?.lastSuccessAt || 0));
  setText(syncRepoSelectedRun, formatSyncDateTime(current?.lastRunAt || 0));
  setText(syncRepoSelectedSynced, String(current?.documentsSynced || 0));
  setText(syncRepoSelectedErrors, String(current?.validationErrors?.length || 0));

  if (syncRepoSelectedState) {
    syncRepoSelectedState.className = `sync-repo-badge ${visual.className}`;
    setText(syncRepoSelectedState, visual.label);
  }

  if (settingsSelectionCard) {
    settingsSelectionCard.dataset.state = visual.className;
    settingsSelectionCard.classList.toggle('is-empty', !current);
  }
}

function renderSyncRepoList() {
  const repositories = state.sync.repositories || [];
  if (syncRepoCardCount) {
    setText(syncRepoCardCount, `${repositories.length} 个仓库`);
  }

  const containers = [syncRepoList, syncMonitorRepos, syncMonitorList].filter(Boolean);
  if (!containers.length) return;

  for (const container of containers) {
    container.innerHTML = '';
    if (!repositories.length) {
      container.innerHTML = '<p class="empty">暂未配置仓库。点击“新增仓库”开始配置。</p>';
      continue;
    }

    const fragment = document.createDocumentFragment();
    repositories.forEach((repo, index) => {
      const visual = getRepoVisualState(repo);
      const issueText = repo.lastError
        ? repo.lastError
        : (repo.validationErrors.length ? `${repo.validationErrors.length} 个校验问题待处理` : '最近一次同步无异常');
      const card = document.createElement('article');
      card.className = `sync-repo-card${repo.id === state.sync.selectedRepoId ? ' active' : ''}`;
      card.dataset.state = visual.className;
      card.style.setProperty('--reveal-index', String(index));
      card.innerHTML = `
        <div class="sync-repo-card-top">
          <div>
            <strong class="sync-repo-title">${escapeHtml(repo.name || repo.id || '未命名仓库')}</strong>
            <p class="sync-repo-url">${escapeHtml(repo.repoUrl || '未配置仓库地址')}</p>
          </div>
          <span class="sync-repo-badge ${visual.className}">${visual.label}</span>
        </div>
        <div class="sync-repo-meta">
          <span>分支 ${escapeHtml(repo.branch || 'main')}</span>
          <span>根目录 ${escapeHtml(repo.docsRoot || '.')}</span>
          <span>最近成功 ${escapeHtml(formatSyncDateTime(repo.lastSuccessAt))}</span>
          <span>同步 ${escapeHtml(String(repo.documentsSynced || 0))}</span>
          <span>校验 ${escapeHtml(String(repo.validationErrors.length || 0))}</span>
        </div>
        <p class="sync-repo-note">${escapeHtml(issueText)}</p>
        <div class="sync-repo-actions">
          <button class="ghost sync-repo-edit-btn" type="button">编辑</button>
          <button class="ghost sync-repo-test-btn" type="button">测试</button>
          <button class="ghost sync-repo-run-btn" type="button">同步</button>
        </div>
      `;

      on(card.querySelector('.sync-repo-edit-btn'), 'click', () => {
        selectSyncRepo(repo.id);
      });

      on(card.querySelector('.sync-repo-test-btn'), 'click', async () => {
        await testSyncRepo(repo.id);
      });

      on(card.querySelector('.sync-repo-run-btn'), 'click', async () => {
        await runSyncRepoNow(repo.id);
      });

      fragment.appendChild(card);
    });

    container.appendChild(fragment);
  }
}

function syncRepoFormMode() {
  return syncRepoIdInput?.value ? 'edit' : 'create';
}

function clearSyncRepoMessage(message = '') {
  if (syncRepoMessage) {
    setText(syncRepoMessage, message);
  }
}

function populateSyncRepoForm(repo = null) {
  const current = repo ? normalizeSyncRepo(repo) : null;
  if (syncRepoIdInput) syncRepoIdInput.value = current?.id || '';
  if (syncRepoNameInput) syncRepoNameInput.value = current?.name || '';
  if (syncRepoUrlInput) syncRepoUrlInput.value = current?.repoUrl || '';
  if (syncRepoBranchInput) syncRepoBranchInput.value = current?.branch || 'main';
  if (syncRepoRootInput) syncRepoRootInput.value = current?.docsRoot || '.';
  if (syncRepoSecretInput) syncRepoSecretInput.value = '';
  if (syncRepoEnabledInput) syncRepoEnabledInput.checked = current ? Boolean(current.enabled) : true;
  if (syncRepoStatusBadge) {
    const visual = getRepoVisualState(current);
    setText(syncRepoStatusBadge, current ? visual.label : '新建仓库');
  }
  if (syncRepoForm) {
    syncRepoForm.dataset.mode = current ? 'edit' : 'create';
  }
  clearSyncRepoMessage(current ? `正在编辑 ${current.name || current.id}` : '填写仓库信息后保存即可启用同步。');
  renderSelectedRepoSnapshot(current);
  updateSyncRepoActionButtons();
}

function updateSyncRepoActionButtons() {
  const editing = Boolean(syncRepoIdInput?.value);
  if (syncRepoDeleteButton) {
    syncRepoDeleteButton.disabled = !editing;
  }
  if (syncRepoSaveButton) {
    setText(syncRepoSaveButton, editing ? '保存修改' : '保存仓库');
  }
  if (syncRepoTestButton) {
    setText(syncRepoTestButton, editing ? '测试当前配置' : '测试新配置');
  }
  if (syncRepoRunButton) {
    syncRepoRunButton.disabled = !editing;
    setText(syncRepoRunButton, editing ? '立即同步' : '保存后可同步');
  }
}

function selectSyncRepo(repoId) {
  const repo = (state.sync.repositories || []).find((item) => item.id === repoId);
  state.sync.selectedRepoId = repo ? repo.id : '';
  populateSyncRepoForm(repo || null);
  renderSyncRepoList();
}

function readSyncRepoForm() {
  return {
    id: syncRepoIdInput?.value.trim() || '',
    name: syncRepoNameInput?.value.trim() || '',
    repoUrl: syncRepoUrlInput?.value.trim() || '',
    branch: syncRepoBranchInput?.value.trim() || 'main',
    docsRoot: syncRepoRootInput?.value.trim() || '.',
    secret: syncRepoSecretInput?.value.trim() || '',
    enabled: Boolean(syncRepoEnabledInput?.checked)
  };
}

async function request(url, options = {}) {
  const result = await requestDetailed(url, options);
  if (!result.ok) {
    throw new Error(result.payload.error || 'Request failed');
  }

  return result.payload;
}

async function requestDetailed(url, options = {}) {
  const token = getToken();
  if (!token) {
    clearTokenAndRedirect();
    throw new Error('Not authenticated');
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({}));

  if (response.status === 401 || response.status === 403) {
    if (payload.error === 'PASSWORD_CHANGE_REQUIRED') {
      state.requirePasswordChange = true;
      showForcePasswordModal('首次登录请先修改密码。');
      throw new Error('PASSWORD_CHANGE_REQUIRED');
    }

    clearTokenAndRedirect();
    throw new Error(payload.error || 'Authentication required');
  }

  return {
    ok: response.ok,
    status: response.status,
    payload
  };
}

async function requestWithFallback(urls, options = {}) {
  const targets = Array.isArray(urls) ? urls : [urls];
  let lastError = null;

  for (const target of targets) {
    try {
      const result = await requestDetailed(target, options);
      if (result.ok) {
        return result.payload;
      }

      if (result.status === 404) {
        lastError = new Error('NOT_FOUND');
        continue;
      }

      throw new Error(result.payload.error || 'Request failed');
    } catch (error) {
      if (error.message === 'NOT_FOUND') {
        lastError = error;
        continue;
      }
      lastError = error;
      if (error.message === 'PASSWORD_CHANGE_REQUIRED') {
        throw error;
      }
    }
  }

  if (lastError && lastError.message === 'NOT_FOUND') {
    return null;
  }

  throw lastError || new Error('Request failed');
}

function renderResults(items) {
  if (!resultsContainer) return;
  resultsContainer.innerHTML = '';

  if (!items.length) {
    resultsContainer.innerHTML = '<p class="empty">没有检索到结果，试试更换查询或放宽过滤条件。</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const node = document.createElement('article');
    node.className = 'result-card';
    node.innerHTML = `
      <div class="result-top">
        <strong class="result-id">${escapeHtml(item.id)}</strong>
        <span class="score-badge">相似度 ${item.similarity != null ? item.similarity.toFixed(3) : '—'}</span>
      </div>
      <p class="result-content doc-content">${escapeHtml(item.content)}</p>
      <div class="meta-row">
        <span class="result-source">来源: ${escapeHtml(item.source || 'unknown')}</span>
        <span class="result-tags">标签: ${escapeHtml((item.tags || []).join(', ') || '无')}</span>
      </div>
      <div class="doc-actions">
        <button class="ghost doc-preview-button search-preview-btn" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          全文预览
        </button>
      </div>
    `;

    const previewBtn = node.querySelector('.search-preview-btn');
    on(previewBtn, 'click', () => {
      openDocumentPreview(item);
    });

    fragment.appendChild(node);
  }

  resultsContainer.appendChild(fragment);
}

function renderSearchPagination(pageInfo) {
  if (!pageInfo) return;

  currentSearchPage = pageInfo.page;
  totalSearchPages = pageInfo.totalPages;
  setText(searchPageInfoText, `${pageInfo.page} / ${pageInfo.totalPages}`);
  if (searchPrevPageButton) searchPrevPageButton.disabled = pageInfo.page <= 1;
  if (searchNextPageButton) searchNextPageButton.disabled = pageInfo.page >= pageInfo.totalPages;
  if (searchCount) setText(searchCount, `${pageInfo.total} 条结果`);
}

function renderDocuments(items) {
  if (!documentsContainer) return;
  documentsContainer.innerHTML = '';

  if (!items.length) {
    documentsContainer.innerHTML = '<p class="empty">当前还没有文档，点击右上角“新建”开始添加。</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach((item, index) => {
    const node = documentTemplate?.content?.firstElementChild
      ? documentTemplate.content.firstElementChild.cloneNode(true)
      : document.createElement('article');
    node.style.setProperty('--reveal-index', String(index));

    if (!documentTemplate?.content?.firstElementChild) {
      node.className = 'doc-card';
      node.innerHTML = `
        <div class="doc-card-header">
          <strong class="doc-card-title"></strong>
          <div class="doc-card-actions">
            <button class="ghost doc-preview-button" type="button">查看</button>
            <button class="ghost danger doc-delete-button" type="button">删除</button>
          </div>
        </div>
        <p class="doc-card-preview"></p>
        <div class="doc-card-meta">
          <span class="doc-card-meta-item doc-source"></span>
          <span class="doc-card-meta-item doc-date"></span>
        </div>
        <div class="doc-card-tags"></div>
      `;
    }

    node.querySelector('.doc-card-title').textContent = item.title || item.id;
    node.querySelector('.doc-card-preview').textContent = truncateText(item.content);
    node.querySelector('.doc-source').textContent = `来源: ${item.source || 'manual'}`;
    node.querySelector('.doc-date').textContent = new Date(item.createdAt).toLocaleDateString('zh-CN');

    const tagsContainer = node.querySelector('.doc-card-tags');
    tagsContainer.innerHTML = '';
    if (item.tags && item.tags.length > 0) {
      for (const tag of item.tags.slice(0, 3)) {
        const tagEl = document.createElement('span');
        tagEl.className = 'doc-tag';
        tagEl.textContent = tag;
        tagsContainer.appendChild(tagEl);
      }
    }

    const previewButton = node.querySelector('.doc-preview-button');
    on(previewButton, 'click', () => {
      openDocumentPreview(item);
    });

    const deleteButton = node.querySelector('.doc-delete-button') || node.querySelector('button');
    on(deleteButton, 'click', async () => {
      const confirmed = window.confirm(`确认删除文档“${item.id}”吗？此操作无法撤销。`);
      if (!confirmed) return;

      deleteButton.disabled = true;
      try {
        await request(`/api/documents/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
        await loadDocuments(state.documents.page);
      } catch (error) {
        alert(error.message);
        deleteButton.disabled = false;
      }
    });

    fragment.appendChild(node);
  });

  documentsContainer.appendChild(fragment);
}

function renderDocumentPreviewToc(headings) {
  if (!documentPreviewToc || !documentPreviewTocCount) return;

  setText(documentPreviewTocCount, String(headings.length));

  if (!headings.length) {
    documentPreviewToc.innerHTML = '<p class="empty">当前文档未检测到 Markdown 标题，已直接展示正文。</p>';
    return;
  }

  documentPreviewToc.innerHTML = headings
    .map((heading) => `
      <a href="#${escapeHtml(heading.id)}" class="preview-toc-link" data-level="${heading.level}">
        <span class="preview-toc-level">H${heading.level}</span>
        <span>${escapeHtml(heading.title)}</span>
      </a>
    `)
    .join('');
}

function openDocumentPreview(item) {
  if (!documentPreviewModal || !documentPreviewContent) return;

  const rendered = renderMarkdownDocument(item.content);
  const metadata = [
    `来源 ${item.source || 'manual'}`,
    `标签 ${(item.tags || []).join(', ') || '无'}`,
    `创建于 ${new Date(item.createdAt).toLocaleString()}`
  ];

  setText(documentPreviewTitle, item.id || '文档预览');
  setText(documentPreviewMeta, metadata.join(' · '));
  documentPreviewContent.innerHTML = rendered.html;
  renderDocumentPreviewToc(rendered.headings);
  setHidden(documentPreviewModal, false);
  documentPreviewModal.setAttribute('aria-hidden', 'false');
  body?.classList.add('preview-open');
}

function closeDocumentPreview() {
  if (!documentPreviewModal) return;
  setHidden(documentPreviewModal, true);
  documentPreviewModal.setAttribute('aria-hidden', 'true');
  body?.classList.remove('preview-open');
}

function renderPagination(pageInfo) {
  if (!pageInfo) return;

  totalPages = pageInfo.totalPages;
  currentPage = pageInfo.page;
  setText(pageInfoText, `${pageInfo.page} / ${pageInfo.totalPages}`);

  if (pageJumpInput) {
    pageJumpInput.value = String(pageInfo.page);
    pageJumpInput.max = String(pageInfo.totalPages);
  }
  if (pageFirstButton) pageFirstButton.disabled = pageInfo.page <= 1;
  if (prevPageButton) prevPageButton.disabled = pageInfo.page <= 1;
  if (nextPageButton) nextPageButton.disabled = pageInfo.page >= pageInfo.totalPages;
  if (pageLastButton) pageLastButton.disabled = pageInfo.page >= pageInfo.totalPages;
  if (pageGoButton) pageGoButton.disabled = pageInfo.totalPages <= 1;
  setText(documentsCount, `${pageInfo.total} 条文档`);
}

function readDocumentFilters() {
  return {
    keyword: documentKeywordInput ? documentKeywordInput.value.trim() : '',
    source: documentSourceInput ? documentSourceInput.value.trim() : '',
    tags: splitTags(documentTagsInput ? documentTagsInput.value : '')
  };
}

function syncDocumentLimit() {
  const nextLimit = Number(pageLimitSelect?.value || DEFAULT_DOCUMENT_LIMIT);
  documentsPageLimit = Number.isNaN(nextLimit) ? DEFAULT_DOCUMENT_LIMIT : nextLimit;
  state.documents.limit = documentsPageLimit;
}

async function loadHealth() {
  try {
    const health = await request('/api/health');
    state.health = health;
    updateHealthSummary(health);
    renderAbout();
  } catch (error) {
    state.health = null;
    updateHealthSummary(null, error.message);
    renderAbout();
  }
}

async function loadDocuments(page = 1) {
  if (state.requirePasswordChange) {
    showForcePasswordModal('请先完成首次改密。');
    return;
  }

  syncDocumentLimit();
  const filters = readDocumentFilters();
  state.documents.filters = filters;

  const params = new URLSearchParams({
    page: String(page),
    limit: String(documentsPageLimit)
  });

  if (filters.keyword) params.set('keyword', filters.keyword);
  if (filters.source) params.set('source', filters.source);
  if (filters.tags.length) params.set('tags', filters.tags.join(','));

  try {
    const payload = await request(`/api/documents?${params.toString()}`);
    renderDocuments(payload.documents || []);
    renderPagination(payload.pageInfo);
    state.documents.page = payload.pageInfo?.page || page;
    state.documents.totalPages = payload.pageInfo?.totalPages || 1;
  } catch (error) {
    if (error.message === 'PASSWORD_CHANGE_REQUIRED') return;
    if (documentsContainer) {
      documentsContainer.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
    }
  }
}

async function loadMetrics() {
  if (state.requirePasswordChange) {
    showForcePasswordModal('请先完成首次改密。');
    return;
  }

  if (refreshMetricsButton) {
    refreshMetricsButton.disabled = true;
  }

  try {
    const payload = await request('/api/metrics');
    state.metrics = payload;
    setText(metricMemoryUsed, formatBytes(payload.memory.used));
    setText(metricMemoryPeak, `峰值 ${formatBytes(payload.memory.peak)}`);
    setText(metricMemoryUsageRate, formatPercent(payload.memory.usageRate));
    setText(metricMemoryRss, formatBytes(payload.memory.rss));
    setText(metricRedisHitRate, formatPercent(payload.stats.redisHitRate));
    setText(metricTotalCommands, payload.stats.totalCommands.toLocaleString());
    setText(metricSearchHitRate, formatPercent(payload.search.hitRate));
    setText(metricSearchAvg, payload.search.avgResults);
    setText(metricSearchQueries, payload.search.queries);
    setText(metricSearchResults, payload.search.results);
    setText(mcpHitRate, formatPercent(payload.search.hitRate));
    setText(mcpAvgResults, payload.search.avgResults);
    setText(mcpLastQuery, formatDateTime(payload.search.lastQueryAt));
    setText(mcpHits, payload.search.hits);
    setText(mcpQueries, payload.search.queries);
    setText(mcpQpm, payload.mcp.queriesLastHour);
    setText(mcpQp5m, payload.mcp.queriesLastFiveHours);
    setText(mcpMissRate, formatPercent(payload.search.missRate));

    // Update progress bars
    if (metricMemoryBar) {
      metricMemoryBar.style.width = `${Math.min(100, payload.memory.usageRate || 0)}%`;
    }
    if (metricRedisBar) {
      metricRedisBar.style.width = `${payload.stats.redisHitRate || 0}%`;
    }

    renderAbout();
  } catch (error) {
    if (error.message !== 'PASSWORD_CHANGE_REQUIRED') {
      setText(metricMemoryUsed, '加载失败');
      setText(metricMemoryPeak, '加载失败');
      setText(metricMemoryUsageRate, '-');
      setText(metricMemoryRss, '-');
      setText(metricRedisHitRate, '-');
      setText(metricTotalCommands, '-');
      setText(metricSearchHitRate, '-');
      setText(metricSearchAvg, '-');
      setText(metricSearchQueries, '-');
      setText(metricSearchResults, '-');
      setText(mcpHitRate, '-');
      setText(mcpAvgResults, '-');
      setText(mcpLastQuery, error.message);
      setText(mcpHits, '-');
      setText(mcpQueries, '-');
      setText(mcpQpm, '-');
      setText(mcpQp5m, '-');
      setText(mcpMissRate, '-');
    }
  } finally {
    if (refreshMetricsButton) {
      refreshMetricsButton.disabled = false;
    }
  }

  await loadSyncOverview({ silent: true });
}

async function loadSyncOverview({ silent = false } = {}) {
  state.sync.loading = true;
  try {
    const payload = await requestWithFallback(SYNC_STATUS_ENDPOINTS);
    if (!payload) {
      state.sync.summary = normalizeSyncSummary({});
      state.sync.repositories = [];
      state.sync.lastLoadedAt = Date.now();
      renderSyncSummary();
      renderSyncRepoList();
      return;
    }

    const summary = normalizeSyncSummary(payload);
    state.sync.summary = summary;
    state.sync.repositories = summary.repositories;
    state.sync.error = '';
    state.sync.lastLoadedAt = Date.now();

    const selected = summary.repositories.find((repo) => repo.id === state.sync.selectedRepoId);
    if (selected) {
      populateSyncRepoForm(selected);
    } else if (summary.repositories.length) {
      state.sync.selectedRepoId = summary.repositories[0].id;
      populateSyncRepoForm(summary.repositories[0]);
    } else {
      state.sync.selectedRepoId = '';
      populateSyncRepoForm(null);
    }

    renderSyncSummary();
    renderSyncRepoList();
  } catch (error) {
    state.sync.error = error.message;
    if (!silent) {
      console.error('[sync] failed to load overview:', error.message);
    }
    state.sync.summary = normalizeSyncSummary({});
    state.sync.repositories = [];
    renderSyncSummary();
    renderSyncRepoList();
  } finally {
    state.sync.loading = false;
  }
}

async function loadSyncRepositories({ silent = false } = {}) {
  try {
    const payload = await requestWithFallback(SYNC_REPO_ENDPOINTS);
    const repositories = Array.isArray(payload?.repositories)
      ? payload.repositories
      : Array.isArray(payload)
        ? payload
        : [];
    if (repositories.length) {
      state.sync.repositories = repositories.map((repo) => normalizeSyncRepo(repo));
      const selected = state.sync.repositories.find((repo) => repo.id === state.sync.selectedRepoId);
      if (selected) {
        populateSyncRepoForm(selected);
      } else if (state.sync.repositories.length) {
        state.sync.selectedRepoId = state.sync.repositories[0].id;
        populateSyncRepoForm(state.sync.repositories[0]);
      }
    } else if (!state.sync.repositories.length) {
      state.sync.selectedRepoId = '';
      populateSyncRepoForm(null);
    }
    renderSyncRepoList();
  } catch (error) {
    if (!silent) {
      console.error('[sync] failed to load repositories:', error.message);
    }
  }
}

async function refreshSyncData({ silent = false } = {}) {
  await loadSyncOverview({ silent });
  await loadSyncRepositories({ silent });
}

async function submitSyncRepoForm(event) {
  event.preventDefault();

  if (state.requirePasswordChange) {
    showForcePasswordModal('请先完成首次改密。');
    return;
  }

  const payload = readSyncRepoForm();
  if (!payload.name || !payload.repoUrl) {
    clearSyncRepoMessage('名称和仓库地址不能为空。');
    return;
  }

  const isEdit = Boolean(payload.id);
  const submitButton = syncRepoSaveButton;
  if (submitButton) {
    submitButton.disabled = true;
  }
  clearSyncRepoMessage(isEdit ? '正在保存修改…' : '正在创建仓库…');

  try {
    const body = {
      name: payload.name,
      repoUrl: payload.repoUrl,
      branch: payload.branch,
      docsRoot: payload.docsRoot,
      enabled: payload.enabled
    };

    if (payload.secret) {
      body.secret = payload.secret;
    }

    const target = isEdit
      ? `/api/doc-sync/repos/${encodeURIComponent(payload.id)}`
      : '/api/doc-sync/repos';
    const method = isEdit ? 'PUT' : 'POST';

    const result = await request(target, {
      method,
      body: JSON.stringify(body)
    });

    const repo = normalizeSyncRepo(result.repo || result.repository || result);
    state.sync.selectedRepoId = repo.id;
    clearSyncRepoMessage(isEdit ? '保存成功。' : '创建成功。');
    await refreshSyncData({ silent: true });
    selectSyncRepo(repo.id);
  } catch (error) {
    clearSyncRepoMessage(`保存失败：${error.message}`);
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
    }
  }
}

async function testSyncRepo(repoId = '') {
  if (state.requirePasswordChange) {
    showForcePasswordModal('请先完成首次改密。');
    return;
  }

  const payload = readSyncRepoForm();
  const body = {
    name: payload.name,
    repoUrl: payload.repoUrl,
    branch: payload.branch,
    docsRoot: payload.docsRoot,
    enabled: payload.enabled
  };
  if (payload.secret) {
    body.secret = payload.secret;
  }

  const target = repoId
    ? `/api/doc-sync/repos/${encodeURIComponent(repoId)}/test`
    : '/api/doc-sync/repos/test';

  if (syncRepoTestButton) {
    syncRepoTestButton.disabled = true;
  }
  clearSyncRepoMessage('正在测试仓库连通性…');

  try {
    const result = await request(target, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    clearSyncRepoMessage(result.message || '测试成功。');
    await loadSyncOverview({ silent: true });
  } catch (error) {
    clearSyncRepoMessage(`测试失败：${error.message}`);
  } finally {
    if (syncRepoTestButton) {
      syncRepoTestButton.disabled = false;
    }
  }
}

async function runSyncRepoNow(repoId = '') {
  if (state.requirePasswordChange) {
    showForcePasswordModal('请先完成首次改密。');
    return;
  }

  const targetId = String(repoId || syncRepoIdInput?.value || '').trim();
  if (!targetId) {
    clearSyncRepoMessage('请先保存仓库，再执行同步。');
    return;
  }

  if (syncRepoRunButton) {
    syncRepoRunButton.disabled = true;
  }
  clearSyncRepoMessage('正在执行同步…');

  try {
    await request(`/api/doc-sync/repos/${encodeURIComponent(targetId)}/sync`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    clearSyncRepoMessage('同步完成。');
    await refreshSyncData({ silent: true });
  } catch (error) {
    clearSyncRepoMessage(`同步失败：${error.message}`);
  } finally {
    if (syncRepoRunButton) {
      syncRepoRunButton.disabled = false;
    }
  }
}

async function deleteSyncRepo() {
  if (state.requirePasswordChange) {
    showForcePasswordModal('请先完成首次改密。');
    return;
  }

  const repoId = syncRepoIdInput?.value.trim() || '';
  if (!repoId) {
    clearSyncRepoMessage('请选择一个仓库后再删除。');
    return;
  }

  const repoName = syncRepoNameInput?.value.trim() || repoId;
  const confirmed = window.confirm(`确认删除仓库“${repoName}”吗？此操作不会删除 Git 远端仓库。`);
  if (!confirmed) {
    return;
  }

  if (syncRepoDeleteButton) {
    syncRepoDeleteButton.disabled = true;
  }
  clearSyncRepoMessage('正在删除仓库…');

  try {
    await request(`/api/doc-sync/repos/${encodeURIComponent(repoId)}`, {
      method: 'DELETE'
    });
    state.sync.selectedRepoId = '';
    populateSyncRepoForm(null);
    clearSyncRepoMessage('删除成功。');
    await refreshSyncData({ silent: true });
    if (state.sync.repositories.length) {
      selectSyncRepo(state.sync.repositories[0].id);
    }
  } catch (error) {
    clearSyncRepoMessage(`删除失败：${error.message}`);
  } finally {
    if (syncRepoDeleteButton) {
      syncRepoDeleteButton.disabled = false;
    }
  }
}

function startMetricsAutoRefresh() {
  stopMetricsAutoRefresh();
  if (state.currentView === 'monitor') {
    state.metricsTimer = setInterval(() => {
      if (state.currentView === 'monitor') {
        loadMetrics();
      }
    }, METRICS_AUTO_REFRESH_INTERVAL);
  }
}

function stopMetricsAutoRefresh() {
  if (state.metricsTimer) {
    clearInterval(state.metricsTimer);
    state.metricsTimer = null;
  }
}

function renderApiKeyList(items) {
  if (!apiKeyList) return;
  apiKeyList.innerHTML = '';

  if (!items.length) {
    apiKeyList.innerHTML = '<p class="empty">暂无 API Key，可点击上方按钮生成。</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const node = document.createElement('article');
    node.className = 'doc-card';
    node.innerHTML = `
      <div class="result-top">
        <strong>Key ID: ${escapeHtml(item.keyId)}</strong>
        <button class="ghost danger" type="button">吊销</button>
      </div>
      <p class="doc-content">名称: ${escapeHtml(item.name || 'mcp-client')}</p>
      <div class="meta-row">
        <span>创建者: ${escapeHtml(item.createdBy || '-')}</span>
        <span>创建时间: ${formatDateTime(item.createdAt)}</span>
        <span>最近使用: ${formatDateTime(item.lastUsedAt)}</span>
        <span>过期时间: ${formatDateTime(item.expiresAt)}</span>
      </div>
    `;

    const revokeButton = node.querySelector('button');
    on(revokeButton, 'click', async () => {
      const raw = prompt(`请输入要吊销的完整 API Key（Key ID: ${item.keyId}）`);
      if (!raw) return;

      revokeButton.disabled = true;
      try {
        const payload = await request('/api/auth/api-keys', {
          method: 'DELETE',
          body: JSON.stringify({ key: raw.trim() })
        });
        if (!payload.revoked) {
          alert('未匹配到该 API Key，请确认输入完整且正确。');
        }
        await loadApiKeys();
      } catch (error) {
        alert(error.message);
      } finally {
        revokeButton.disabled = false;
      }
    });

    fragment.appendChild(node);
  }

  apiKeyList.appendChild(fragment);
}

async function loadApiKeys() {
  if (state.requirePasswordChange) {
    showForcePasswordModal('请先完成首次改密。');
    return;
  }

  try {
    const payload = await request('/api/auth/api-keys');
    renderApiKeyList(payload.keys || []);
  } catch (error) {
    if (error.message === 'PASSWORD_CHANGE_REQUIRED') return;
    if (apiKeyList) {
      apiKeyList.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
    }
  }
}

async function loadSession() {
  const response = await request('/api/auth/session');
  state.session = response;
  state.requirePasswordChange = Boolean(response.requirePasswordChange);

  if (state.requirePasswordChange) {
    showForcePasswordModal('首次登录请先修改密码。');
    renderAbout();
    return true;
  }

  hideForcePasswordModal();
  renderAbout();
  return false;
}

async function runSearch(page = 1) {
  if (!currentSearchPayload || state.requirePasswordChange) {
    showForcePasswordModal('请先完成首次改密。');
    return;
  }

  const startTime = performance.now();

  try {
    const payload = await request('/api/search', {
      method: 'POST',
      body: JSON.stringify({
        ...currentSearchPayload,
        page,
        limit: SEARCH_PAGE_LIMIT
      })
    });

    const latency = performance.now() - startTime;

    // Update search metrics
    if (searchLatency) {
      setText(searchLatency, `${latency.toFixed(0)}ms`);
    }
    if (searchResultCount) {
      setText(searchResultCount, String(payload.results?.length || 0));
    }
    if (searchAvgScore && payload.results?.length > 0) {
      const avgScore = payload.results.reduce((sum, r) => sum + (r.similarity || 0), 0) / payload.results.length;
      setText(searchAvgScore, `${(avgScore * 100).toFixed(1)}%`);
    }
    if (searchHitRate) {
      const hitRate = payload.results?.length > 0 ? (payload.results.length / (currentSearchPayload.topK || 5) * 100) : 0;
      setText(searchHitRate, `${hitRate.toFixed(0)}%`);
    }

    renderResults(payload.results || []);
    renderSearchPagination(payload.pageInfo);
    await loadMetrics();
  } catch (error) {
    if (error.message !== 'PASSWORD_CHANGE_REQUIRED' && resultsContainer) {
      resultsContainer.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
    }
  }
}

function openDocumentModal() {
  if (!documentModal) return;
  setHidden(documentModal, false);
  documentModal.setAttribute('aria-hidden', 'false');
  documentCreateContentInput?.focus();
}

function closeDocumentModal() {
  if (!documentModal) return;
  setHidden(documentModal, true);
  documentModal.setAttribute('aria-hidden', 'true');
  documentCreateForm?.reset();
}

async function submitCreateDocument(event) {
  event.preventDefault();

  if (state.requirePasswordChange) {
    showForcePasswordModal('请先完成首次改密。');
    return;
  }

  const submitButton = documentCreateForm?.querySelector('button[type="submit"]');
  if (submitButton) {
    submitButton.disabled = true;
  }

  try {
    const sourceValue = documentCreateSourceInput?.value?.trim() || document.querySelector('#source')?.value?.trim() || '';
    const tagsValue = documentCreateTagsInput?.value ?? document.querySelector('#tags')?.value ?? '';
    const contentValue = documentCreateContentInput?.value?.trim() || document.querySelector('#content')?.value?.trim() || '';

    await request('/api/documents', {
      method: 'POST',
      body: JSON.stringify({
        source: sourceValue,
        tags: splitTags(tagsValue),
        content: contentValue
      })
    });

    closeDocumentModal();
    await loadDocuments(state.documents.page || 1);
  } catch (error) {
    alert(error.message);
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
    }
  }
}

async function activateView(view) {
  const nextView = ['monitor', 'search', 'documents', 'api', 'settings', 'about'].includes(view) ? view : 'monitor';

  if (state.requirePasswordChange && nextView !== 'monitor') {
    showForcePasswordModal('请先完成首次改密。');
    return;
  }

  // Stop auto-refresh when leaving monitor view
  if (state.currentView === 'monitor' && nextView !== 'monitor') {
    stopMetricsAutoRefresh();
  }

  setNavActive(nextView);

  if (nextView === 'monitor') {
    await Promise.allSettled([loadHealth(), loadMetrics()]);
    startMetricsAutoRefresh();
    return;
  }

  if (nextView === 'search') {
    // Search page is self-contained, no special loading needed
    return;
  }

  if (nextView === 'documents') {
    await loadDocuments(state.documents.page || 1);
    return;
  }

  if (nextView === 'api') {
    await loadApiKeys();
    return;
  }

  if (nextView === 'settings') {
    await refreshSyncData();
    if (!state.sync.selectedRepoId && state.sync.repositories.length) {
      selectSyncRepo(state.sync.repositories[0].id);
    }
    return;
  }

  if (nextView === 'about') {
    if (!state.health) {
      await loadHealth();
    }
    if (!state.metrics) {
      await loadMetrics();
    }
    renderAbout();
  }
}

function bindNavControls() {
  for (const control of navControls) {
    on(control, 'click', (event) => {
      const target = control.dataset.view || control.dataset.page || control.getAttribute('href')?.replace(/^#/, '');
      if (!target) return;
      event.preventDefault();
      activateView(target);
    });
  }
}

function bindDocumentModalControls() {
  on(documentCreateButton, 'click', () => {
    if (state.requirePasswordChange) {
      showForcePasswordModal('请先完成首次改密。');
      return;
    }
    openDocumentModal();
  });

  on(documentModalCloseButton, 'click', () => {
    closeDocumentModal();
  });

  on(documentCreateCancelButton, 'click', () => {
    closeDocumentModal();
  });

  on(documentModal, 'click', (event) => {
    if (event.target === documentModal) {
      closeDocumentModal();
    }
  });

  on(document, 'keydown', (event) => {
    if (event.key === 'Escape') {
      if (documentPreviewModal && !documentPreviewModal.classList.contains('hidden')) {
        closeDocumentPreview();
        return;
      }
      closeDocumentModal();
    }
  });
}

function bindDocumentPreviewControls() {
  on(documentPreviewCloseButton, 'click', () => {
    closeDocumentPreview();
  });

  on(documentPreviewModal, 'click', (event) => {
    if (event.target === documentPreviewModal) {
      closeDocumentPreview();
    }
  });

  on(documentPreviewToc, 'click', (event) => {
    const targetElement = event.target instanceof Element ? event.target : null;
    const link = targetElement?.closest('a[href^="#"]');
    if (!link) return;
    event.preventDefault();
    const target = document.querySelector(link.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

function bindDocumentFilters() {
  on(documentFilterForm, 'submit', async (event) => {
    event.preventDefault();
    await loadDocuments(1);
  });

  on(documentFilterResetButton, 'click', async () => {
    if (documentKeywordInput) {
      documentKeywordInput.value = '';
    }
    if (documentSourceInput) {
      documentSourceInput.value = '';
    }
    if (documentTagsInput) {
      documentTagsInput.value = '';
    }
    await loadDocuments(1);
  });

  on(pageLimitSelect, 'change', async () => {
    syncDocumentLimit();
    await loadDocuments(1);
  });

  on(pageGoButton, 'click', () => {
    const page = Number(pageJumpInput?.value || 1);
    const target = Number.isNaN(page) ? 1 : Math.min(Math.max(1, page), totalPages);
    loadDocuments(target);
  });

  on(pageFirstButton, 'click', () => {
    if (currentPage > 1) {
      loadDocuments(1);
    }
  });

  on(prevPageButton, 'click', () => {
    if (currentPage > 1) {
      loadDocuments(currentPage - 1);
    }
  });

  on(nextPageButton, 'click', () => {
    if (currentPage < totalPages) {
      loadDocuments(currentPage + 1);
    }
  });

  on(pageLastButton, 'click', () => {
    if (currentPage < totalPages) {
      loadDocuments(totalPages);
    }
  });
}

function bindSearchForm() {
  on(searchForm, 'submit', async (event) => {
    event.preventDefault();

    if (state.requirePasswordChange) {
      showForcePasswordModal('请先完成首次改密。');
      return;
    }

    const submitButton = searchForm.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
    }
    if (resultsContainer) {
      resultsContainer.innerHTML = '<p class="empty">正在检索，请稍候...</p>';
    }

    try {
      currentSearchPayload = {
        query: document.querySelector('#query')?.value || '',
        topK: Number(document.querySelector('#topK')?.value || 5),
        keyword: '',
        source: document.querySelector('#search-source')?.value || '',
        tags: splitTags(document.querySelector('#search-tags')?.value || '')
      };
      await runSearch(1);
    } catch (error) {
      if (resultsContainer) {
        resultsContainer.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });

  on(searchPrevPageButton, 'click', () => {
    if (currentSearchPage > 1) {
      runSearch(currentSearchPage - 1);
    }
  });

  on(searchNextPageButton, 'click', () => {
    if (currentSearchPage < totalSearchPages) {
      runSearch(currentSearchPage + 1);
    }
  });
}

function bindApiKeyForm() {
  on(apiKeyForm, 'submit', async (event) => {
    if (state.requirePasswordChange) {
      showForcePasswordModal('请先完成首次改密。');
      return;
    }

    event.preventDefault();
    const submitButton = apiKeyForm.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
    }
    setText(apiKeyGenerated, '正在生成 API Key...');

    try {
      const payload = await request('/api/auth/api-keys', {
        method: 'POST',
        body: JSON.stringify({
          name: apiKeyNameInput?.value || 'mcp-client',
          expiresInDays: Number(apiKeyDaysInput?.value || 3650)
        })
      });
      const key = payload.key || '';
      if (apiKeyGenerated) {
        apiKeyGenerated.innerHTML = `新 Key（仅展示一次）: <code>${escapeHtml(maskApiKey(key))}</code><br/>完整值: <code>${escapeHtml(key)}</code>`;
      }
      await loadApiKeys();
    } catch (error) {
      setText(apiKeyGenerated, error.message);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });
}

function bindSyncRepoControls() {
  on(syncRepoForm, 'submit', submitSyncRepoForm);
  on(syncRepoTestButton, 'click', (event) => {
    event.preventDefault();
    testSyncRepo(syncRepoIdInput?.value.trim() || '');
  });
  on(syncRepoRunButton, 'click', (event) => {
    event.preventDefault();
    runSyncRepoNow(syncRepoIdInput?.value.trim() || '');
  });
  on(syncRepoDeleteButton, 'click', (event) => {
    event.preventDefault();
    deleteSyncRepo();
  });
  on(syncRepoResetButton, 'click', (event) => {
    event.preventDefault();
    const selected = (state.sync.repositories || []).find((repo) => repo.id === state.sync.selectedRepoId) || null;
    populateSyncRepoForm(selected);
  });
  on(syncRepoAddButton, 'click', (event) => {
    event.preventDefault();
    state.sync.selectedRepoId = '';
    populateSyncRepoForm(null);
  });
  on(syncRepoForm, 'input', () => {
    updateSyncRepoActionButtons();
  });
}

function bindGlobalActions() {
  on(refreshMetricsButton, 'click', () => {
    if (state.requirePasswordChange) {
      showForcePasswordModal('请先完成首次改密。');
      return;
    }
    loadMetrics();
  });

  on(logoutButton, 'click', () => {
    clearTokenAndRedirect();
  });

  on(forcePasswordForm, 'submit', async (event) => {
    event.preventDefault();
    const submitButton = forcePasswordForm.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
    }
    setText(forcePasswordMessage, '正在修改密码…');

    try {
      const payload = await request('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          newPassword: forceNewPasswordInput?.value || ''
        })
      });
      if (!payload?.token) {
        throw new Error('修改失败：未返回新会话 token');
      }

      localStorage.setItem(authTokenKey, payload.token);
      state.requirePasswordChange = false;
      setText(forcePasswordMessage, '密码修改成功，正在进入控制台…');
      hideForcePasswordModal();

      if (isSidebarLayout()) {
        await activateView('monitor');
      } else {
        await Promise.allSettled([loadHealth(), loadDocuments(1), loadMetrics(), loadApiKeys()]);
      }
    } catch (error) {
      setText(forcePasswordMessage, `修改失败：${error.message}`);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });
}

function bindCreateDocumentForm() {
  on(documentCreateForm, 'submit', submitCreateDocument);
}

function bindLegacyAddForm() {
  if (!addForm || addForm === documentCreateForm) return;

  on(addForm, 'submit', async (event) => {
    event.preventDefault();

    if (state.requirePasswordChange) {
      showForcePasswordModal('请先完成首次改密。');
      return;
    }

    const submitButton = addForm.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
    }

    try {
      await request('/api/documents', {
        method: 'POST',
        body: JSON.stringify({
          source: first('#source')?.value || '',
          tags: splitTags(first('#tags')?.value || ''),
          content: first('#content')?.value || ''
        })
      });

      addForm.reset();
      await loadDocuments(1);
    } catch (error) {
      alert(error.message);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });
}

function bootstrapDefaultSearchState() {
  renderSearchPagination({ page: 1, totalPages: 1, total: 0 });
}

function isSidebarLayout() {
  return Boolean(sidebarNav || navControls.length || Object.values(viewRoots).some(Boolean));
}

bindNavControls();
bindDocumentModalControls();
bindDocumentPreviewControls();
bindDocumentFilters();
bindSearchForm();
bindApiKeyForm();
bindSyncRepoControls();
bindGlobalActions();
bindCreateDocumentForm();
bindLegacyAddForm();
bootstrapDefaultSearchState();

const forced = await loadSession();

if (forced) {
  await loadHealth();
} else if (isSidebarLayout()) {
  await activateView('monitor');
} else {
  await Promise.allSettled([
    loadHealth(),
    loadDocuments(1),
    loadMetrics(),
    loadApiKeys()
  ]);
}

if (documentModal) {
  setHidden(documentModal, true);
  documentModal.setAttribute('aria-hidden', 'true');
}

if (documentPreviewModal) {
  setHidden(documentPreviewModal, true);
  documentPreviewModal.setAttribute('aria-hidden', 'true');
}

if (!isSidebarLayout()) {
  renderAbout();
}
