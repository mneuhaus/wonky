# Loading checked Bend modules

`src/bend-loader.mjs` caches JavaScript emitted by the pinned Bend 2.0.25
compiler. `loadKernel()` uses it for topology, analytic geometry, real arithmetic,
precise vectors, Boolean operations, comparison, identity, face classification
and halfspace clipping. Geometry and predicates still execute code compiled from
Bend. No vendor source, input fixture or kernel algorithm is changed.

The measured motivation is repeated compilation in fresh Node processes:
`out/halfspace/load-profile.json` attributed roughly 543 ms to face-classification
and 2,501 ms to halfspace imports in one observed process. Those observations
identify compilation work to reuse; they are not measurements of this cache's
speedup. The final benchmark on 22 September 2026, Apple M5 Pro / Node 22.23.1,
measures the same bracket CLI build in five fresh processes without the cache
and ten fresh processes with a prepared cache: median **4,088 ms → 333 ms**
(12.3×), p95 4,125 ms → 334 ms. The implementation stayed unchanged during the
run. Raw startup observations and source hashes are in `out/benchmark.json`.
OS file caches may already be warm; this is a startup improvement, not a speedup
of warmed geometry or a native/Metal measurement.

## API and bypass

```js
import { loadBend, compileBend } from './bend-loader.mjs';

const native = await loadBend(new URL('../kernel/real.bend', import.meta.url));
const result = native.add(native.from_f32(2), native.from_f32(3));

// Checked JS text and provenance, without evaluating the resulting module:
const { source, key, cacheHit, cachePath } = await compileBend(
  new URL('../kernel/real.bend', import.meta.url),
);

// Parse, check and compile on this call, without reading or writing a cache:
await loadBend(new URL('../kernel/real.bend', import.meta.url), { cache: false });
```

The entry may be an absolute file URL or a filesystem path. `loadBend` returns
the upstream module's default export. `compileBend` returns the original checked
JS source, its input key, a cache-hit flag and the artifact path. A bypass has
`cacheHit: false` and `cachePath: null`.

`WONKY_BEND_CACHE=0` disables cache reads and writes for both APIs and therefore
for `loadKernel`. It overrides per-call cache settings. This is the explicit
mode for fresh-process compilation measurements. The compiler implementation
can remain loaded in a worker within one process, but every bypass call invokes
the upstream parse/check/compile path again. Existing `loadKernel` process-local
memoization remains: call it in a new process to measure a fresh startup.

Default artifacts live in **`.tools/bend-js-cache/`**, already covered by the
repository's `.tools/` ignore rule. They are disposable local build outputs.
Deleting this cache causes later loads to compile again. No automatic eviction
or background cleanup is performed.

Options `cacheDirectory`, `compilerDirectory` and `lockFile` select explicit local
locations for isolated tests or embedding. Defaults use this project's pinned
lock and installed compiler. Only compiler version 2.0.25 is accepted: an upgrade
requires reviewing the dependency-discovery contract against the new loader.

## Input binding and execution

The SHA-256 key contains:

- The cache schema and actual cache-loader source bytes.
- The canonical entry path, full transitive local Bend imports, `Base`, lexical
  and resolved dependency paths, and their content hashes.
- Foreign JS source declarations, including an absence record for an unused
  missing foreign file. The compiler decides whether a declared file is needed.
- For a `PROOF.bend` entry, the sibling `LAWS.bend` presence/content observed by
  the upstream loader's additional import requirement.
- The complete installed compiler-directory file contents and paths, including
  `main.ts`, `bend.ts`, `comp.ts`, Base, effects and embedded runtime sources.
  Hashing this whole small directory is intentionally conservative.
- Lock-file bytes, version, Node version, platform and architecture.

Every lookup reads and hashes current contents; equal size or modification time
is insufficient for reuse. Local relative and absolute imports follow the pinned
loader's import-header rules. Symlink target changes affect the key, and import
cycles are rejected. Hub imports are explicitly unsupported by this local cache
API; it does not download dependencies or guess their closure.

On a miss, an isolated worker calls the unmodified `main.ts` exported `load`
function. That function reads the program, checks its definitions and proof
obligations, and emits JS. Compilations are serialized within a process because
the upstream compiler owns mutable compilation state. A changed compiler
fingerprint creates a new worker, avoiding Node's retained ESM instances of an
older compiler. Idle workers are unreferenced and do not keep a process alive.

Fingerprints are compared before and after compilation or a cache read. A
detected source/compiler change raises `BEND_SOURCES_CHANGED`; no artifact is
published for that attempt. If the cache loader itself is edited during a
running process, start a fresh process. Input trees are expected to remain stable
during a load; these checks detect intervening edits rather than lock source
files against other writers.

The cache contains a single JSON record with its key, input manifest, JS source
and JS content hash. A hit must match both the expected manifest key and content
hash. The verified bytes are imported using a data URL keyed by the input hash;
execution does not reread a cache path that another process could replace.
Explicit `loadBend` calls can therefore load changed source revisions in one
process. Existing module objects already returned to callers remain unchanged.

Writers use unique temporary files and atomically rename a complete record into
place. Independent processes may duplicate compilation on the first miss, but
readers see a complete artifact and concurrent writers cannot expose partial
JSON. A killed writer may leave a disposable `.tmp` file; it is never a hit.

Compile/check failures propagate. They do not return an older artifact, suppress
an unsupported capability or publish a successful entry. Corrupt artifacts raise
`BEND_CACHE_CORRUPT` with the path; remove that artifact or use the explicit bypass.
Filesystem errors also propagate instead of silently disabling validation or
changing backends. The cache is a trusted local build directory, not a signed
artifact-distribution system.

`registerBendImports()` retains the original pinned `.bend` import hook for
adapters that still use raw dynamic imports. Those imports keep their existing
uncached loader and Node module semantics. New adapters should use `loadBend`,
or reuse a module already exposed by `loadKernel`, such as `k.faceClassifier`
and `k.halfspace`.

## Focused validation

`node --test test/bend-loader.test.mjs` checks cross-process hits; entry and
transitive invalidation despite preserved timestamps; Base, lock and actual
compiler changes; a semantic compiler change proving a fresh worker was loaded;
foreign sources and symlink targets; compile failure after a warm hit; concurrent
publication from three processes; both bypasses; corruption; an edit during
compilation; explicit unsupported contracts; and the implicit PROOF/LAWS rule.

All test sources, compiler copies and cache artifacts are temporary directories
under the ignored `.tools/` tree. Tests do not edit the installed compiler,
project proof, frozen FeatureScript or dependency snapshots. The focused test
log is retained at `out/bend-loader/test-results.tap` during development.
