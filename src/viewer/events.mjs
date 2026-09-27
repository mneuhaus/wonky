// Server-Sent Events hub (spec 9.2). Package: live-server.
//
//   const hub = createEventHub({ session, hello })
//   hub.publish(name, data)     -> event record { id: '<session>:<seq>', name, data }
//   hub.subscribe(listener)     -> unsubscribe (the terminal listens this way)
//   hub.recent(lastEventId)     -> events after that id (all kept events if unknown)
//   hub.connect(req, res, { clientId })   streams GET /api/events
//   hub.onConnection(listener)  -> unsubscribe; listener({ type: 'open'|'close', clientId })
//   hub.clients()               -> number of open streams
//   hub.close()                 -> ends every stream
//
// A stream starts with `retry: 2000`. A Last-Event-ID of this session that is
// still among the last 100 events replays what followed; otherwise the client
// gets a fresh `hello` snapshot whose id is the current sequence, so its next
// reconnect replays from there. Heartbeat comments every 15 s keep proxies and
// the socket alive. Revision events carry no deltas.
import { randomBytes } from 'node:crypto';

export const EVENT_NAMES = Object.freeze([
  'hello', 'source-changed', 'build-queued', 'build-started', 'build-phase', 'build-cancelled',
  'revision', 'build-failed', 'worker-failed', 'workspace-changed',
]);

const frame = ({ id, name, data }) => {
  const lines = JSON.stringify(data).split('\n').map(line => `data: ${line}`).join('\n');
  return `${id ? `id: ${id}\n` : ''}event: ${name}\n${lines}\n\n`;
};

export function createEventHub({
  session = randomBytes(4).toString('hex'),
  replay = 100,
  heartbeatMs = 15000,
  retryMs = 2000,
  hello = () => ({}),
} = {}) {
  const history = [];
  const listeners = new Set();
  const connectionListeners = new Set();
  const streams = new Set();
  let sequence = 0;
  let helloData = hello;

  // Events after `<session>:<n>` when that position is still covered by the
  // kept history (a hello carries the current position); null otherwise.
  const eventsAfter = last => {
    const match = typeof last === 'string' ? /^([^:]+):(\d+)$/.exec(last) : null;
    if (!match || match[1] !== session) return null;
    const position = Number(match[2]);
    const oldest = history.length ? Number(history[0].id.split(':')[1]) : sequence + 1;
    if (position > sequence || position < oldest - 1) return null;
    return history.filter(event => Number(event.id.split(':')[1]) > position);
  };

  const notifyConnection = event => {
    for (const listener of [...connectionListeners]) listener(event);
  };

  return {
    session,
    publish(name, data = {}) {
      if (!EVENT_NAMES.includes(name)) throw new Error(`Unknown viewer event ${name}`);
      const event = { id: `${session}:${++sequence}`, name, data };
      history.push(event);
      if (history.length > replay) history.shift();
      for (const listener of [...listeners]) listener(event);
      return event;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    recent(lastEventId) {
      const index = history.findIndex(event => event.id === lastEventId);
      return index >= 0 ? history.slice(index + 1) : history.slice();
    },
    setHello(provider) {
      helloData = provider;
    },
    hello: clientId => ({ session, clientId, ...helloData(clientId) }),
    connect(req, res, { clientId = randomBytes(6).toString('hex'), lastEventId } = {}) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
        'X-Accel-Buffering': 'no',
      });
      res.write(`retry: ${retryMs}\n\n`);
      const replayed = eventsAfter(lastEventId ?? req.headers['last-event-id']);
      if (replayed) {
        for (const event of replayed) res.write(frame(event));
      } else {
        const id = `${session}:${sequence}`;
        const data = { session, clientId, ...helloData(clientId) };
        res.write(frame({ id, name: 'hello', data }));
      }
      const stream = { res, clientId };
      const send = event => res.write(frame(event));
      listeners.add(send);
      const heartbeat = setInterval(() => res.write(`: heartbeat ${Date.now()}\n\n`), heartbeatMs);
      heartbeat.unref?.();
      stream.end = () => {
        clearInterval(heartbeat);
        listeners.delete(send);
        if (streams.delete(stream)) notifyConnection({ type: 'close', clientId });
      };
      streams.add(stream);
      req.on('close', stream.end);
      res.on('error', stream.end);
      notifyConnection({ type: 'open', clientId });
      return stream;
    },
    onConnection(listener) {
      connectionListeners.add(listener);
      return () => connectionListeners.delete(listener);
    },
    clients: () => streams.size,
    clientIds: () => [...streams].map(stream => stream.clientId),
    close() {
      for (const stream of [...streams]) {
        stream.end();
        stream.res.end();
      }
      listeners.clear();
      connectionListeners.clear();
    },
  };
}
