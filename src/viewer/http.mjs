// HTTP helpers for the viewer server (frozen contract, docs/viewer/contracts.md).
//
// send / sendJson / sendBinary / sendText write every response with
// `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
// HttpError carries a status; legacy routes map everything else to 400,
// new routes to 500 (see router.mjs).

export class HttpError extends Error {
  constructor(status, message, { cause, details } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'HttpError';
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

// An explicit capability error: the viewer cannot answer this honestly yet.
export class CapabilityError extends HttpError {
  constructor(message, options) {
    super(501, message, options);
    this.name = 'CapabilityError';
  }
}

export const capability = message => {
  throw new CapabilityError(message);
};

const baseHeaders = type => ({
  'Content-Type': type,
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
});

export const JSON_TYPE = 'application/json; charset=utf-8';
export const TEXT_TYPE = 'text/plain; charset=utf-8';

// Pretty JSON as served by the pre-foundation server.
export const prettyJson = value => JSON.stringify(value, null, 2) + '\n';

// Legacy signature: JSON bodies are pretty-printed, other types sent as given.
export function send(res, status, data, type = JSON_TYPE) {
  res.writeHead(status, baseHeaders(type));
  res.end(type.startsWith('application/json') ? prettyJson(data) : data);
}

export function sendJson(res, status, data, { compact = false, headers = {} } = {}) {
  res.writeHead(status, { ...baseHeaders(JSON_TYPE), ...headers });
  res.end(compact ? JSON.stringify(data) : prettyJson(data));
}

export function sendText(res, status, text, type = TEXT_TYPE) {
  res.writeHead(status, baseHeaders(type));
  res.end(text);
}

export function sendBinary(res, status, buffer, {
  type = 'application/octet-stream', etag, headers = {},
} = {}) {
  res.writeHead(status, {
    ...baseHeaders(type),
    ...(etag ? { ETag: etag } : {}),
    ...headers,
  });
  res.end(buffer);
}

export function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

// Reads a request body up to `limit` bytes. An oversized body rejects with
// 413 at once; the rest is drained (never buffered) so the response still
// reaches the client.
export function readBody(req, { limit = 2 * 1024 * 1024, tooLarge } = {}) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };
    const onData = chunk => {
      bytes += chunk.length;
      if (bytes <= limit) {
        chunks.push(chunk);
        return;
      }
      cleanup();
      req.resume();
      reject(new HttpError(413, tooLarge ?? `Request body exceeds ${limit} bytes`));
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

// Reads a JSON request body. Non-JSON content types answer 415, oversized
// bodies 413, unparsable JSON 400.
export async function readJson(req, {
  limit = 2 * 1024 * 1024,
  tooLarge,
  wrongType = 'Use application/json',
} = {}) {
  if (!req.headers['content-type']?.startsWith('application/json')) {
    throw new HttpError(415, wrongType);
  }
  const bytes = await readBody(req, { limit, tooLarge });
  try {
    return JSON.parse(bytes);
  } catch (error) {
    throw new HttpError(400, error.message, { cause: error });
  }
}

const localOrigins = origin => [origin, origin.replace('127.0.0.1', 'localhost')];

// Same-origin rule of the pre-foundation server: a request that carries an
// Origin header must come from this server (127.0.0.1 or localhost form).
export function checkOrigin(req, origin) {
  const value = req.headers.origin;
  if (value && !localOrigins(origin).includes(value)) {
    throw new HttpError(403, 'Cross-origin request rejected');
  }
}

// Host allowlist against DNS rebinding (SRV-13): only 127.0.0.1:<port> and
// localhost:<port> are served.
export function checkHost(req, origin) {
  const { host } = new URL(origin);
  const allowed = [host, host.replace('127.0.0.1', 'localhost')];
  if (!allowed.includes(req.headers.host ?? '')) {
    throw new HttpError(403, 'Host header rejected; use ' + allowed.join(' or '));
  }
}
