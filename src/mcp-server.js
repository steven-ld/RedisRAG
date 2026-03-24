import { connectRedis, ensureAuthProfile, seedDocumentsIfEmpty } from './redis.js';
import { MCP_TOOLS, executeMcpTool } from './mcp-tools.js';

const SERVER_NAME = 'redis-rag-mcp';
const SERVER_VERSION = '1.0.0';
const DEFAULT_PROTOCOL_VERSION = '2025-11-25';
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05'
]);

const HEADER_DELIMITER = Buffer.from('\r\n\r\n');
const REQUEST_ID_ERROR = null;

let initialized = false;
let inputBuffer = Buffer.alloc(0);
let messageQueue = Promise.resolve();

function log(...parts) {
  console.error('[mcp]', ...parts);
}

function writeMessage(message) {
  const json = JSON.stringify(message);
  const body = Buffer.from(json, 'utf8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8');
  process.stdout.write(Buffer.concat([header, body]));
}

function sendResponse(id, result) {
  writeMessage({
    jsonrpc: '2.0',
    id,
    result
  });
}

function sendError(id, code, message, data) {
  const error = {
    code,
    message
  };

  if (data !== undefined) {
    error.data = data;
  }

  writeMessage({
    jsonrpc: '2.0',
    id,
    error
  });
}

function normalizeHeaderName(value) {
  return String(value || '').trim().toLowerCase();
}

function parseHeaders(headerText) {
  const headers = {};

  for (const line of headerText.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const separatorIndex = line.indexOf(':');
    if (separatorIndex < 0) {
      continue;
    }

    const name = normalizeHeaderName(line.slice(0, separatorIndex));
    const value = line.slice(separatorIndex + 1).trim();
    if (name) {
      headers[name] = value;
    }
  }

  return headers;
}

function findHeaderBlock(buffer) {
  const crlfIndex = buffer.indexOf(HEADER_DELIMITER);
  if (crlfIndex >= 0) {
    return {
      index: crlfIndex,
      delimiterLength: HEADER_DELIMITER.length
    };
  }

  const lfDelimiter = Buffer.from('\n\n');
  const lfIndex = buffer.indexOf(lfDelimiter);
  if (lfIndex >= 0) {
    return {
      index: lfIndex,
      delimiterLength: lfDelimiter.length
    };
  }

  return null;
}

function parseJsonBody(bodyBuffer) {
  return JSON.parse(bodyBuffer.toString('utf8'));
}

function isRequest(message) {
  return (
    message &&
    typeof message === 'object' &&
    !Array.isArray(message) &&
    Object.prototype.hasOwnProperty.call(message, 'id')
  );
}

function isNotification(message) {
  return (
    message &&
    typeof message === 'object' &&
    !Array.isArray(message) &&
    !Object.prototype.hasOwnProperty.call(message, 'id')
  );
}

function getProtocolVersion(requestedVersion) {
  const normalized = String(requestedVersion || '').trim();
  if (SUPPORTED_PROTOCOL_VERSIONS.has(normalized)) {
    return normalized;
  }
  return DEFAULT_PROTOCOL_VERSION;
}

function buildInitializeResult(requestedProtocolVersion) {
  return {
    protocolVersion: getProtocolVersion(requestedProtocolVersion),
    capabilities: {
      tools: {}
    },
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION
    },
    instructions: 'Use search_documents and list_documents to query RedisRAG content.'
  };
}

function buildToolSuccess(name, result) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ tool: name, result }, null, 2)
      }
    ]
  };
}

function buildToolError(message, details) {
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

function validateRequestEnvelope(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return 'Invalid request';
  }
  if (message.jsonrpc !== '2.0') {
    return 'Invalid JSON-RPC version';
  }
  if (typeof message.method !== 'string' || !message.method.trim()) {
    return 'Missing method';
  }
  return null;
}

async function handleToolCall(id, params) {
  const name = params && params.name ? String(params.name).trim() : '';
  const args =
    params &&
    typeof params.arguments === 'object' &&
    params.arguments !== null &&
    !Array.isArray(params.arguments)
      ? params.arguments
      : {};

  if (!name) {
    sendResponse(id, buildToolError('Tool name is required'));
    return;
  }

  const execution = await executeMcpTool(name, args);
  if (!execution.ok) {
    sendResponse(id, buildToolError(`Tool call failed: ${name}`, execution.error));
    return;
  }

  sendResponse(id, buildToolSuccess(name, execution.result));
}

async function handleRequest(message) {
  const requestError = validateRequestEnvelope(message);
  const id = Object.prototype.hasOwnProperty.call(message, 'id') ? message.id : REQUEST_ID_ERROR;
  if (requestError) {
    sendError(id, -32600, requestError);
    return;
  }

  const method = String(message.method).trim();
  if (!initialized && method !== 'initialize' && method !== 'ping') {
    sendError(id, -32002, 'Server not initialized');
    return;
  }

  if (method === 'initialize') {
    initialized = true;
    sendResponse(id, buildInitializeResult(message.params?.protocolVersion));
    return;
  }

  if (method === 'ping') {
    sendResponse(id, {});
    return;
  }

  if (method === 'tools/list') {
    sendResponse(id, { tools: MCP_TOOLS });
    return;
  }

  if (method === 'tools/call') {
    await handleToolCall(id, message.params);
    return;
  }

  sendError(id, -32601, `Method not found: ${method}`);
}

async function handleNotification(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') {
    return;
  }

  const method = String(message.method || '').trim();
  if (method === 'notifications/initialized') {
    log('client initialized');
  }
}

async function handleMessage(message) {
  if (Array.isArray(message)) {
    for (const item of message) {
      await handleMessage(item);
    }
    return;
  }

  if (isRequest(message)) {
    await handleRequest(message);
    return;
  }

  if (isNotification(message)) {
    await handleNotification(message);
    return;
  }

  log('ignored non-JSON-RPC payload');
}

function consumeFrames() {
  while (true) {
    const headerBlock = findHeaderBlock(inputBuffer);
    if (!headerBlock) {
      return;
    }

    const headerEnd = headerBlock.index + headerBlock.delimiterLength;
    const headerText = inputBuffer.slice(0, headerBlock.index).toString('utf8');
    const headers = parseHeaders(headerText);
    const contentLength = Number.parseInt(headers['content-length'] || '', 10);

    if (Number.isNaN(contentLength) || contentLength < 0) {
      inputBuffer = inputBuffer.slice(headerEnd);
      continue;
    }

    if (inputBuffer.length - headerEnd < contentLength) {
      return;
    }

    const body = inputBuffer.slice(headerEnd, headerEnd + contentLength);
    inputBuffer = inputBuffer.slice(headerEnd + contentLength);

    let message;
    try {
      message = parseJsonBody(body);
    } catch (error) {
      sendError(REQUEST_ID_ERROR, -32700, 'Parse error', error?.message || 'Invalid JSON payload');
      continue;
    }

    messageQueue = messageQueue.then(() => handleMessage(message)).catch((error) => {
      log('unhandled MCP request error', error);
      sendError(
        Object.prototype.hasOwnProperty.call(message || {}, 'id') ? message.id : REQUEST_ID_ERROR,
        -32603,
        'Internal error',
        error?.message || String(error)
      );
    });
  }
}

async function main() {
  await connectRedis();
  await ensureAuthProfile();
  await seedDocumentsIfEmpty();

  process.stdin.on('data', (chunk) => {
    inputBuffer = Buffer.concat([inputBuffer, chunk]);
    consumeFrames();
  });

  process.stdin.on('error', (error) => {
    log('stdin error', error);
  });

  process.stdin.resume();
  log('MCP stdio server ready');
}

main().catch((error) => {
  console.error('[mcp] failed to start', error);
  process.exit(1);
});
