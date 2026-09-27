// Isolated feature loading: every feature module is imported on its own, so
// one broken module becomes an explicit failure notice ("Feature <id> failed
// to load") instead of a broken app.
//
// entries: [{ id, legacy, load: () => import('./x/x.js') }]
// -> { features: [{ id, legacy, setup }], failures: [{ id, error }] }
export async function loadFeatures(entries) {
  const settled = await Promise.allSettled(entries.map(entry => entry.load()));
  const features = [];
  const failures = [];
  settled.forEach((result, index) => {
    const entry = entries[index];
    try {
      if (result.status === 'rejected') throw result.reason;
      const module = result.value;
      if (module.id !== entry.id) {
        throw new Error(`module id ${module.id} does not match ${entry.id}`);
      }
      if (typeof module.setup !== 'function') throw new Error('module does not export setup(ctx)');
      features.push({ id: module.id, legacy: !!module.legacy, setup: module.setup });
    } catch (error) {
      failures.push({ id: entry.id, error });
    }
  });
  return { features, failures };
}
