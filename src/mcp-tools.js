import { listDocumentsPaginated, searchDocuments } from './redis.js';

function normalizeString(value) {
  if (value == null) {
    return '';
  }

  return String(value).trim();
}

function normalizeNumber(value, defaultValue) {
  if (value == null || value === '') {
    return defaultValue;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return defaultValue;
  }

  return parsed;
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(item)).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => normalizeString(item))
      .filter(Boolean);
  }

  return [];
}

function normalizeSearchArgs(args = {}) {
  return {
    query: normalizeString(args.query),
    topK: normalizeNumber(args.topK, 5),
    page: normalizeNumber(args.page, 1),
    limit: normalizeNumber(args.limit, 5),
    keyword: normalizeString(args.keyword),
    source: normalizeString(args.source),
    tags: normalizeTags(args.tags)
  };
}

function normalizeListArgs(args = {}) {
  return {
    page: normalizeNumber(args.page, 1),
    limit: normalizeNumber(args.limit, 6),
    filters: {
      keyword: normalizeString(args.keyword),
      source: normalizeString(args.source),
      tags: normalizeTags(args.tags)
    }
  };
}

export const MCP_TOOLS = [
  {
    name: 'search_documents',
    description: 'Search Redis-backed knowledge documents by semantic query with optional keyword, source, and tag filters.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query.'
        },
        topK: {
          type: 'integer',
          description: 'Maximum number of candidates to rank in the vector search.',
          default: 5
        },
        page: {
          type: 'integer',
          description: 'Page number for paginated results.',
          default: 1
        },
        limit: {
          type: 'integer',
          description: 'Number of results per page.',
          default: 5
        },
        keyword: {
          type: 'string',
          description: 'Optional keyword filter applied to content.'
        },
        source: {
          type: 'string',
          description: 'Optional source filter.'
        },
        tags: {
          oneOf: [
            {
              type: 'array',
              items: {
                type: 'string'
              }
            },
            {
              type: 'string',
              description: 'Comma-separated tags.'
            }
          ],
          description: 'Optional tag filters.'
        }
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'list_documents',
    description: 'List stored documents with optional keyword, source, and tag filters.',
    inputSchema: {
      type: 'object',
      properties: {
        page: {
          type: 'integer',
          description: 'Page number for paginated results.',
          default: 1
        },
        limit: {
          type: 'integer',
          description: 'Number of documents per page.',
          default: 6
        },
        keyword: {
          type: 'string',
          description: 'Optional keyword filter applied to content.'
        },
        source: {
          type: 'string',
          description: 'Optional source filter.'
        },
        tags: {
          oneOf: [
            {
              type: 'array',
              items: {
                type: 'string'
              }
            },
            {
              type: 'string',
              description: 'Comma-separated tags.'
            }
          ],
          description: 'Optional tag filters.'
        }
      },
      additionalProperties: false
    }
  }
];

export async function executeMcpTool(name, args = {}) {
  try {
    switch (name) {
      case 'search_documents': {
        const normalized = normalizeSearchArgs(args);
        if (!normalized.query) {
          return {
            ok: false,
            error: 'query is required'
          };
        }

        const result = await searchDocuments(normalized);
        return {
          ok: true,
          result
        };
      }
      case 'list_documents': {
        const normalized = normalizeListArgs(args);
        const result = await listDocumentsPaginated(normalized);
        return {
          ok: true,
          result
        };
      }
      default:
        return {
          ok: false,
          error: `Unknown MCP tool: ${name}`
        };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
