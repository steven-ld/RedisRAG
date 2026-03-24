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
  documents: first('#page-documents', '[data-page="documents"]', '#documents-page'),
  api: first('#page-api', '[data-page="api"]', '#api-page'),
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

function maskApiKey(value) {
  if (!value || value.length < 16) return value || '';
  return `${value.slice(0, 12)}...${value.slice(-6)}`;
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

async function request(url, options = {}) {
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

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }

  return payload;
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
    const node = resultTemplate?.content?.firstElementChild
      ? resultTemplate.content.firstElementChild.cloneNode(true)
      : document.createElement('article');

    if (!resultTemplate?.content?.firstElementChild) {
      node.className = 'result-card';
      node.innerHTML = `
        <div class="result-top">
          <strong class="result-id"></strong>
          <span class="score-badge"></span>
        </div>
        <p class="result-content"></p>
        <div class="meta-row">
          <span class="result-source"></span>
          <span class="result-tags"></span>
        </div>
      `;
    }

    node.querySelector('.result-id').textContent = item.id;
    node.querySelector('.score-badge').textContent = `相似度 ${item.similarity ?? '-'}`;
    node.querySelector('.result-content').textContent = item.content;
    node.querySelector('.result-source').textContent = `来源: ${item.source || 'unknown'}`;
    node.querySelector('.result-tags').textContent = `标签: ${(item.tags || []).join(', ') || '无'}`;
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
  setText(searchCount, `${pageInfo.total} 条结果`);
}

function renderDocuments(items) {
  if (!documentsContainer) return;
  documentsContainer.innerHTML = '';

  if (!items.length) {
    documentsContainer.innerHTML = '<p class="empty">当前还没有文档，点击右上角“新建”开始添加。</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const node = documentTemplate?.content?.firstElementChild
      ? documentTemplate.content.firstElementChild.cloneNode(true)
      : document.createElement('article');

    if (!documentTemplate?.content?.firstElementChild) {
      node.className = 'doc-card';
      node.innerHTML = `
        <div class="result-top">
          <strong class="doc-title"></strong>
          <div class="doc-actions">
            <button class="ghost doc-preview-button" type="button">全屏查看</button>
            <button class="ghost danger doc-delete-button" type="button">删除</button>
          </div>
        </div>
        <p class="doc-content"></p>
        <div class="meta-row">
          <span class="doc-source"></span>
          <span class="doc-tags"></span>
          <span class="doc-date"></span>
        </div>
      `;
    }

    node.querySelector('.doc-title').textContent = item.id;
    node.querySelector('.doc-content').textContent = truncateText(item.content);
    node.querySelector('.doc-source').textContent = `来源: ${item.source || 'manual'}`;
    node.querySelector('.doc-tags').textContent = `标签: ${(item.tags || []).join(', ') || '无'}`;
    node.querySelector('.doc-date').textContent = new Date(item.createdAt).toLocaleString();

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
  }

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
    setText(mcpQpm, payload.mcp.queriesLastMinute);
    setText(mcpQp5m, payload.mcp.queriesLastFiveMinutes);
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

  try {
    const payload = await request('/api/search', {
      method: 'POST',
      body: JSON.stringify({
        ...currentSearchPayload,
        page,
        limit: SEARCH_PAGE_LIMIT
      })
    });

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
  documentCreateContentInput?.focus();
}

function closeDocumentModal() {
  if (!documentModal) return;
  setHidden(documentModal, true);
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
  const nextView = ['monitor', 'documents', 'api', 'about'].includes(view) ? view : 'monitor';

  if (state.requirePasswordChange && nextView !== 'monitor') {
    showForcePasswordModal('请先完成首次改密。');
    return;
  }

  setNavActive(nextView);

  if (nextView === 'monitor') {
    await Promise.allSettled([loadHealth(), loadMetrics()]);
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
}

if (!isSidebarLayout()) {
  renderAbout();
}
