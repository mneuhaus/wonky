// Browser selection routes (spec 3.7, 9.2). Package: reviews-context.
//
//   POST /api/selection { references, visible?, client? }
//     The browser posts its selection whenever it changes (same-origin only,
//     like every POST). Answers the described selection.
//   GET  /api/selection
//     { schema, updatedAt, sequence, client, modelId, revision, model, visible,
//       references: [{ ref, alias, logical, summary, identity, source?, detail }],
//       note }; before the first post `references` is empty.
//
// Ephemeral: the selection lives in server memory (src/viewer/selection.mjs).
// Exact summaries are closed forms over the stored parameters and take well
// under 5 ms once the kernel is loaded; the first post loads it.
import { loadKernel } from '../../kernel.mjs';
import { readJson, sendJson } from '../http.mjs';
import { createSelectionStore, describeSelection, readSelection } from '../selection.mjs';

export function register(router, ctx) {
  const { registry } = ctx;
  const store = createSelectionStore();
  let described = null;

  async function current() {
    const selection = store.get();
    if (described && described.sequence === (selection?.sequence ?? 0)) return described.value;
    const kernel = selection?.references.length ? await loadKernel() : null;
    const value = describeSelection(selection, { registry, kernel });
    if ((store.get()?.sequence ?? 0) === value.sequence) {
      described = { sequence: value.sequence, value };
    }
    return value;
  }

  router.add('GET', '/api/selection', async (_req, res) => {
    sendJson(res, 200, await current());
  });

  // The browser posts its (empty) selection when it starts; that first post
  // warms the kernel (about 1 s, at most ~130 ms of event-loop lag), so the
  // first click is answered within the 500 ms budget.
  let warming = null;
  router.add('POST', '/api/selection', async (req, res) => {
    const body = await readJson(req, { limit: 64 * 1024 });
    const selection = readSelection(body, { has: id => registry.has(id) });
    warming ??= loadKernel().catch(() => null);
    store.set(selection);
    sendJson(res, 200, await current());
  });
}
