import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
// Returns a node:test skip reason when a local-only fixture is absent, else false.
export const missing = (...paths) => {
  const gone = paths.filter(p => !existsSync(ROOT + p));
  return gone.length ? `local-only fixture not in the public tree: ${gone.join(', ')}` : false;
};

// These integration suites execute the retired Bend implementation, not Rust.
export const missingBend = () => {
  const reason = missing('kernel/vendor/bend-collections/src', 'kernel/ports/occt.bend', 'kernel/ports/solvespace.bend');
  return reason ? 'Bend toolchain: retired local-only sources are absent' : missing('.tools/bend');
};
