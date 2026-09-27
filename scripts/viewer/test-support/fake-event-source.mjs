// Fake EventSource for viewer client tests (the live SSE client and the
// workspace feature): the test opens the stream and sends named events.
// Instances are collected in FakeEventSource.instances; reset it per test.
export class FakeEventSource {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    FakeEventSource.instances.push(this);
  }
  addEventListener(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(handler);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  send(name, data, id = '') {
    for (const handler of this.listeners.get(name) ?? []) {
      handler({ data: JSON.stringify(data), lastEventId: id });
    }
  }
  fail(readyState) {
    this.readyState = readyState;
    this.onerror?.();
  }
  close() {
    this.readyState = 2;
    this.closed = true;
  }
}
