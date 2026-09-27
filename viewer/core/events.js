// Server-Sent Events client for GET /api/events (spec 9.2). Package: live-client.
//
//   const events = createEvents(env, { enabled });
//   events.on('revision', (data, meta) => …);   // meta: { id, session, seq }
//   events.on('connection', ({ state, connected, session }) => …);
//   events.connect({ clientId });                 // false when disabled or unsupported
//
// Under the legacy seam (VS) `enabled` is false: connect() opens nothing and
// no request is made.
//
// Reconnect: the browser's EventSource retries on its own (the server sends
// `retry: 2000`) and sends Last-Event-ID, so the server replays what was
// missed or, after a restart (another session), answers a fresh `hello`.
// If the EventSource gives up (readyState CLOSED, e.g. a non-200 answer while
// the server restarts), a new one is opened with backoff and the last event
// id as `?lastEventId=`. Event ids are `<session>:<seq>`; an event of the
// current session whose seq was already handled is dropped, so a replay that
// overlaps what arrived before is harmless. `hello` always passes and resets
// the position.
export const EVENT_NAMES = Object.freeze([
  'hello', 'source-changed', 'build-queued', 'build-started', 'build-phase', 'build-cancelled',
  'revision', 'build-failed', 'worker-failed', 'workspace-changed',
]);

const CONNECTING = 0;
const CLOSED = 2;

// '<session>:<seq>' -> { session, seq } (null for anything else).
export function parseEventId(id) {
  const match = typeof id === 'string' ? /^([^:]+):(\d+)$/.exec(id) : null;
  return match ? { session: match[1], seq: Number(match[2]) } : null;
}

export function eventsUrl(base, { clientId, lastEventId } = {}) {
  const query = [];
  if (clientId) query.push(`client=${encodeURIComponent(clientId)}`);
  if (lastEventId) query.push(`lastEventId=${encodeURIComponent(lastEventId)}`);
  return query.length ? `${base}?${query.join('&')}` : base;
}

export function createEvents(env, {
  enabled = false,
  url = '/api/events',
  names = EVENT_NAMES,
  retryMs = 2000,
  maxRetryMs = 15000,
  log = () => {},
} = {}) {
  const handlers = new Map();
  let source = null;
  let clientId = null;
  let state = 'idle';
  let position = null;
  let lastEventId = null;
  let reconnects = 0;
  let timer = null;
  let attempt = 0;

  const emit = (name, data, meta) => {
    for (const handler of [...(handlers.get(name) ?? [])]) {
      try {
        handler(data, meta);
      } catch (error) {
        log(`events: ${name} handler failed:`, error);
      }
    }
  };
  const setState = next => {
    if (next === state) return;
    state = next;
    emit('connection', { state, connected: state === 'open', session: position?.session ?? null });
  };

  function receive(name, event) {
    const id = parseEventId(event.lastEventId);
    if (name !== 'hello' && id && position && id.session === position.session
      && id.seq <= position.seq) return;
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      log(`events: ${name} carried invalid JSON`);
      return;
    }
    if (id) {
      position = id;
      lastEventId = event.lastEventId;
    }
    if (state !== 'open') setState('open');
    emit(name, data, { id: event.lastEventId || null, ...id });
  }

  function open() {
    const Source = env.EventSource;
    const target = eventsUrl(url, {
      clientId, lastEventId: attempt ? lastEventId : null,
    });
    source = new Source(target);
    for (const name of names) {
      source.addEventListener(name, event => receive(name, event));
    }
    source.onopen = () => {
      attempt = 0;
      setState('open');
    };
    source.onerror = () => {
      if (source?.readyState === CLOSED) {
        source.close?.();
        source = null;
        schedule();
      } else if (source?.readyState === CONNECTING) {
        reconnects++;
      }
      setState(source ? 'connecting' : 'closed');
    };
  }

  function schedule() {
    if (timer !== null) return;
    const delay = Math.min(maxRetryMs, retryMs * 2 ** Math.min(attempt, 4));
    attempt++;
    reconnects++;
    timer = env.setTimeout(() => {
      timer = null;
      if (!source && state !== 'idle') open();
    }, delay);
  }

  return {
    on(name, handler) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(handler);
      return () => handlers.get(name).delete(handler);
    },
    emit,
    connect(options = {}) {
      if (!enabled || source || !env.EventSource) return false;
      clientId = options.clientId ?? clientId;
      setState('connecting');
      open();
      return true;
    },
    connected: () => state === 'open',
    status: () => ({
      state, clientId, lastEventId, session: position?.session ?? null, reconnects,
    }),
    close() {
      if (timer !== null) env.clearTimeout(timer);
      timer = null;
      source?.close?.();
      source = null;
      if (state !== 'idle') setState('idle');
    },
  };
}
