# Collections (bend-collections)

The kernel stores almost everything as `List<&2, T>`. Index access (`List.get`) and lookups are O(n), so
several validation and classification passes are quadratic or cubic. Wonky now vendors
[bend-collections](https://github.com/Giulio2002/bend-collections), a library of containers for stock
Bend 2.0.25 with machine-checked proofs, and wraps the parts the kernel needs in `kernel/lib/`.
**Status: vendored, tested, and used by the solid-validation passes** (face connectivity, per-edge use
counts, used vertices, vertex remap; see "Hotspot rewrite" below). The r10b run's kernel time dropped from
68.0 s to 2.6 s with byte-identical outputs. The planar Booleans' cell classification now prepares each
operand once ("Planar Boolean classification"): cut-h1 and frame-with-tab run 2.7 to 4.1x faster, JS and
native, byte-identical. The other passes in "Where it pays" are follow-ups.

The retired Bend kernel uses this library. Upstream publishes no licence (except for its Keccak module), so the vendored copy is not part of the public repository, and a public checkout cannot build the Bend modules that import it.

## What is vendored

| | |
|---|---|
| Where | `kernel/vendor/bend-collections/src/` (local only; upstream `src/`, byte for byte, 49 files, 696 KB) |
| Pin | commit `5af9089cb0c70e696d5a47dc697fa873ff8fb97c` (2026-09-23), `PIN.json`, sha256 per file in `MANIFEST.sha256` |
`local design note` (local only)
| Proofs | not vendored (15 MB); [upstream `proofs/`](https://github.com/Giulio2002/bend-collections/tree/5af9089cb0c70e696d5a47dc697fa873ff8fb97c/proofs) |
| License | **none upstream except Keccak (MIT)**; therefore not redistributed here |
| Verify | `node scripts/vendor/bend-collections.mjs` (re-fetches the pin from GitHub, byte-for-byte compare), `--offline` (manifest only) |

Upstream pins the same Bend binary and `base.bend` as wonky's `.tools/bend-2.0.25` (sha256 `3850c7cd…` and
`e5639663…`). The internal relative imports are unchanged, so the tree loads with `src/bend-loader.mjs` (which
only accepts local `import ./x.bend as X` lines, no hub hashes) and builds with the `bend` CLI.

Available upstream modules: dynamic array, deque, queue, stack, simple/priority queue, binary heap, doubly
linked list (+ iterator), tree map (indexed red-black), bitset, hash map (String keys), LRU, 64-bit words,
SHA-256, Keccak-256, BLAKE2s/2b, BLAKE3.

## What the kernel uses, and why

The kernel's keys are U32 ids (vertex, edge, face indexes), undirected edge pairs `(a, b)`, and points.
Checked against the vendored API:

| Need | Covered by | Adapter |
|---|---|---|
| read element `id` of a list (`halfspace.bend vertex`, `side_at`, `List.get` on ids) | dynamic array: O(1) get/set, amortized push | `kernel/lib/id-vec.bend` (U32 ids, List.get fallback semantics) |
| "is face/edge `id` in the set" (`touches_*`, `all_used`, masks) | bitset: fixed capacity, O(1) get/set | `kernel/lib/id-set.bend` (U32 ids, range flags) |
| U32 id → value, sparse | tree map `TreeMap<U32, V, U32.cmp>` | none needed |
| edge pair → value (`find_cut`, `unique_edges`) | tree map with a pair comparator | `kernel/lib/keys.bend` `IdPair`, `edge`, `pair_cmp` |
| exact point → value | tree map with a lexicographic comparator | `kernel/lib/keys.bend` `Key3`, `vec3_key`, `f32_order` |
| String → value | hash map (String keys only) | not used by the kernel |

The hash map is String-only, so it is not the tool for ids: stringifying ids would cost more than the tree
map. The tree map is generic (`TreeMap<K, V, cmp>`, comparator as a template), so every ordered key only
needs a key type and a comparator. Dense ids (0..n-1) go to the dynamic array or bitset, which are one
indexed access natively.

## API

All three modules are plain Bend; import them by relative path, e.g. from `kernel/`:
`import ./lib/id-vec.bend as IdVec`. Every container owns an array, so every operation hands the container
back beside its answer (`IdVec<T> & T`). Bend only destructures parameters and variables, not call results:
thread the pair into the next def as a parameter (see `kernel/lib/collections-probe.bend` for complete
examples).

### `kernel/lib/id-vec.bend`: dense vector by U32 id

```
IdVec<-T: Data>                                   # over DynArray<&2, T>
new(T) -> IdVec<T>
from_list(T, xs) -> IdVec<T> & Bool               # xs[k] under id k; False only past 2^31 elements
filled(T, n: U32, +x) -> IdVec<T> & Bool          # n copies of x
length(T, v) -> IdVec<T> & U32
get(T, v, id: U32, fallback: T) -> IdVec<T> & T   # fallback when id >= length (as List.get + default)
find(T, v, id: U32) -> IdVec<T> & Maybe<&2, T>    # None when id >= length
set(T, v, id: U32, x) -> IdVec<T> & Bool          # False, unchanged, when id >= length
push(T, v, x) -> IdVec<T> & Bool                  # id = old length
to_list(T, v) -> IdVec<T> & List<&2, T>           # id order: to_list(from_list(xs)) = xs
```

### `kernel/lib/id-set.bend`: set of U32 ids in [0, capacity)

```
IdSet                                             # over Bitset
new(n: U32) -> IdSet                              # capacity n, empty
from_ids(n, ids) -> IdSet & Bool                  # False if any id >= n (the others are added)
capacity(s) -> IdSet & U32
has(s, id) -> IdSet & Bool                        # False for id >= capacity
add(s, id) / remove(s, id) -> IdSet & Bool        # False, unchanged, for id >= capacity
add_all(s, ids) -> IdSet & Bool
has_any(s, ids) -> IdSet & Bool                   # stops at the first member
count(s) -> IdSet & U32                           # O(capacity / 32)
members(s) -> IdSet & List<&2, U32>               # ascending, independent of insertion order
dispose(s) -> Unit
```

### `kernel/lib/keys.bend`: ordered keys for the vendored tree map

```
IdPair = P{a: U32, b: U32};  pair_cmp;  edge(a, b) = P{min, max}   # undirected: edge(a, b) = edge(b, a)
Key3 = K3{x: U32, y: U32, z: U32};  key3_cmp                        # lexicographic x, y, z
f32_order(x: F32) -> U32      # order-preserving, injective on bits; -0.0 just below 0.0
vec3_key(x, y, z: F32) -> Key3
then(first: Cmp, next: Cmp) -> Cmp                                  # lexicographic tie-break
```

With the tree map (`import ./vendor/bend-collections/src/containers/balanced_search_tree.bend as TM`):
`TM.new(~K.IdPair, ~U32, ~K.pair_cmp)`, `TM.put(~K.IdPair, ~U32, ~K.pair_cmp, m, K.edge(a, b), v)` (replaces;
`put_if_absent` keeps the first), `TM.get(...) -> TreeMap & Maybe<&2, V>`, `TM.size`, `TM.first_key`,
`TM.higher_key`, `TM.remove`, `TM.lower_key`/`floor_key`/`ceiling_key`. `put` answers
`Result<Rejected, Maybe<old>>`; `Fail` is `CapacityExceeded` (2^31 nodes).

`vec3_key` is an **exact** key: two points share it only when all three coordinates are bit-identical. It
cannot replace a tolerance test such as `halfspace.bend unique_vertices` (distance above a resolution): a
grid-cell `Key3` built from quantized coordinates still has to compare neighbouring cells to give the same
answer as the pairwise test. For F32x2 points (`precise.bend Vec3`, `Real{hi, lo}`) an exact key needs six
words; build it from `f32_order` of each word with nested `then` comparisons.

## Rules for keeping results bit-identical

- The collections answer questions; they must not decide output order. Emit vertices, edges, faces and loops
  by walking the original lists (or `IdVec.to_list`, which keeps id order), and use a collection only for
  membership, counts and lookups. Tree-map iteration is comparator order and `IdSet.members` is ascending
  order; neither is the kernel's list order. Hash-map `keys` are bucket order: never use them for output.
- Replacing a scan by a lookup must keep the scan's tie-break. `find_cut` returns the first match in list
  order; a tree map built with `put` keeps the last value put, with `put_if_absent` the first. Pick the one
  that equals the scan, and keep a differential test.
- Out-of-range ids: `IdVec.get` returns the caller's fallback like `vertex` does today (`G.v3(0, 0, 0)` via
  `point(None)`); keep that fallback when switching.
- Termination stays structural or fuelled: every loop in `kernel/lib` recurses on a list or a `Nat`.

## Where it pays

From `docs/native-bridge/profile.md`: in r10b, 94 % of kernel self time was four list folds in
`solid-classification.bend`, driven by `halfspace.bend connectivity_pass`. U = edge uses, F = faces,
E = edges, V = vertices.

| Pass | Before | Now | Status |
|---|---|---|---|
| `connectivity_steps` / `connected` | `fuel` Jacobi rounds; per round every use of every face ran `count_faces` over the known faces: O(F · U²) | edge → faces table once, level-synchronous BFS: O(U + F + max edge id); sparse edge ids are ranked to dense ids by one sort first: O(U log U) | **done** |
| `edges_closed`, `open_uses`, `section closed_edges`, `occt edge_pack` (`count_faces` per edge) | O(E · U) | `S.edge_counts`: one fold over all uses into an `IdVec<UseCount>`: O(E + U) | **done** |
| `all_used`, `compact` (`vertex_used` per vertex) | O(V · E) | `IdSet` of edge endpoints: O(V + E) | **done** |
| `remap_edges` (`mapped` per endpoint) | O(E · map) | `IdVec` table before → after: O(E + map + max id) | **done** |
| `vertex(vertices, i)`, `side_at`, `use_start`, `face-classification prepare_uses` | O(i) per read | `IdVec` built once per pass: O(1) per read | follow-up |
| `unique_edges`, `find_cut` | O(E²), O(cuts) per lookup | tree map on `edge(a, b)`: O(log E) | follow-up (small today) |
| `unique_vertices` / `separated_vertices` | O(V²) distance tests | tolerance test: needs a sort or grid with neighbour checks, not an exact key | follow-up (37 ms in r10b) |

## Hotspot rewrite (2026-09-24)

### What changed

| File | Change |
|---|---|
| `kernel/halfspace.bend` | `connectivity_steps`: builds the edge → faces table (`IdVec<List<U32>>`) once from the shared edge ids and runs a level-synchronous BFS for at most `fuel` levels (`IdSet` for reached faces and expanded edges). After k Jacobi rounds the old mask held exactly the faces within k edge-sharing steps of a seed, so the BFS returns the same flags. It keeps the old zip semantics (one flag per face of the prefix min(faces, mask); fuel 0 returns the mask unchanged). Edge ids above 4 · uses + 1024 are first renamed to dense ranks by one `List.sort` of the uses (`sparse_steps`, see "Sparse edge ids" below), so the table stays linear in the input; the old definition (`connectivity_steps_list`, `connectivity_pass`, `touches_*`) is gone. `all_used` and `compact` use `used_flags` (an `IdSet` of edge endpoints). `remap_edges` uses a before → after `IdVec` written back to front, so the first map entry wins as in `mapped` (sparse maps take `remap_list`). `open_uses` uses `S.edge_counts`. |
| `kernel/solid-classification.bend` | `edge_counts(faces, index, n)` = `[count_faces(faces, index + k) for k < n]` in one pass over the uses. Slots are `edge - index` in U32, so the old wrapping index is reproduced. `edges_closed` is `all_pairs(edge_counts(...))`. The sums are the same U32 sums in a different, commutative order. |
| `kernel/section.bend` | `closed_edges` reads `S.edge_counts` (still the first failing edge, same `SourceNotClosed` fields). |
| `kernel/ports/occt.bend` | `edge_pack` reads `S.edge_counts`. |

Output order never comes from a collection. Every list is still produced by walking the original lists. The
collections only answer "is it reached", "how many uses" and "what does id map to". No public definition was
removed or renamed in this step; `count_faces`, `vertex_used` and `mapped` remain for their other callers
(the follow-up "Sparse edge ids" removed the list-based connectivity fold, which had no caller left). Bend 2
needs names defined above their use (no forward references, no mutual recursion), and a match branch cannot
destructure a computed tuple. Hence the small `*_of`/`*_done` helper defs that take the
container pair as a parameter.

### Proof of bit-identity

The two trees were frozen copies taken at the same moment: `base` (HEAD versions of the four files) and
`dev` (the rewrite). Everything else, including other agents' in-progress `src/` and `python/` edits,
was identical. Scripts are in `tmp/collections/` (untracked).

| Check | Result |
|---|---|
| Output files (`.brep.json`, `.step`, `.stl`, `.html`, exit code, stderr) of r10b `singleStepR10b --check`, r10b `r10bRetainedContext`, all `examples/*.fs` and `*.py`, bored-spacer `--format print`, fuse-g1, cut-h1, and all 8 build123d performance cases, JS target (`ab-run.mjs`, `compare.mjs`) | 26 of 26 byte-identical (source paths normalized) |
| Same 24 non-r10b cases, native planar slice (`WONKY_BACKEND=native`, one build per tree) | 24 of 24 byte-identical (native build hash normalized); native = JS apart from backend metadata in both trees |
| SHA-256 of every host → kernel call result, in call order (`hash-kernel-calls.mjs` preload): r10b strict, r10b tolerated-regularized, fuse-g1, cut-h1, bored-spacer | identical: 18,602 + 24,609 + 198 + 418 + 78 = 43,905 calls |
| Differential of the 10 rewritten definitions against HEAD's (`diff-hotspot.mjs`), 609 seeded cases incl. fuel 0, short/long masks, edge ids near 2^32, index wrap, sparse ids | 0 differences |
| `test/collections-hotspot.test.mjs`: JS oracles restating the old list definitions, 363 cases incl. 60 connected spanning-tree cases | 3/3 pass |
| `npm run check:bend` (PROOF.bend) and `bend kernel/laws/pilot/PROOF.bend` (laws that reduce `S.edges_closed` by evaluation) | All terms check |
| Live tree after applying: r10b `r10bRetainedContext` brep.json and STEP against the pre-change live baseline (`tmp/collections/baseline/js`) | byte-identical |

### Measurements

Apple M5 Pro (18 logical CPUs), Node v22.23.1, warm Bend JS cache, shared machine. Wall ms of the whole CLI
process, one run each. Round 1 ran base, then dev, at load 10 to 15. Round 3 ran dev first, then base, at
load 37 → 15, as an order control.

| Workload | base (round 1) | dev (round 1) | dev / base (round 3) |
|---|---:|---:|---:|
| r10b `singleStepR10b --check` (stops at the known r10b.fs:25:2 error) | 91,982 | **5,244** | (not rerun) |
| r10b `r10bRetainedContext` (5 bodies, writes brep.json + STEP) | 3,092 | 2,271 | |
| examples/bracket.fs | 1,834 | 1,687 | 1,824 / 1,392 |
| fuse-g1 | 4,246 | 3,673 | 3,651 / 3,378 |
| cut-h1 | 11,160 | 8,772 | 9,034 / 8,639 |
| build123d frame-with-tab | 23,290 | 18,444 | 18,752 / 18,948 |
| build123d planar-pocket | 6,598 | 5,213 | 5,286 / 5,844 |
| build123d planar-union | 4,487 | 3,697 | 3,955 / 3,769 |

In the live tree, `npm run check:r10b` went from 101.9 s (load 16, before) to 3.5 s (load 33, after), with the
same stop at r10b.fs:25:2. r10b gets 17.5x on wall time in the controlled A/B. The planar Booleans are unchanged within noise: round 3 reverses round 1's
apparent 20 %. The planar selection stage calls these passes, but their cost there was small. Native
planar slice, same cases, base → dev: fuse-g1 1,135 → 1,111, cut-h1 3,632 → 3,839, frame-with-tab
9,651 → 8,342, planar-union 1,319 → 1,230 ms (load 60 to 120, noise).

CPU profiles (`node --cpu-prof`, attributed with `scripts/native-bridge/analyze-profiles.mjs:analyzeProfile`,
load 13 to 17):

| | r10b base | r10b dev |
|---|---:|---:|
| wall | 86,723 ms | 5,227 ms |
| kernel bucket | 67,955 ms | 2,610 ms |
| GC | 12,532 ms | 711 ms |
| self time in `count_uses`/`count_faces`/`plus_uses`/`count_loops` | 64,056 ms | 0 ms |
| `connectivity_pass` inclusive | 64,095 ms | not called |
| self time in the new code (`kernel/lib`, vendored containers, BFS/table defs) | | 85 ms |

Where the time goes now (dev, inclusive kernel time):

- **r10b** (2.6 s kernel): `curved-intersection clip_body` 1.9 s, of which `curved-validate audit` 742 ms,
  `face-plane probe_surface` 647 ms, `curved-faces build_faces` 624 ms. `face-classification edges_scale`
  takes 440 ms (recomputed per query). Top self: JS `run_loop` 390 ms, `List.get` 320 ms.
- **cut-h1** (7.1 s kernel) and **frame-with-tab** (19.7 s kernel): `planar-boolean-selection classify_cell`
  takes 6.4 s and 18.1 s (91 to 92 %). Per arrangement cell it casts 5 rays against every face, and every
  root runs a point-in-face test: `face-classification classify_rays` → `ray_edges` (4.3 s and 11.9 s), which
  prepares the face's loops again each time (`prepare_loops` 0.9 s and 2.3 s). Self time is double-word
  arithmetic (`real.bend`), exact products (`intersections.bend`) and the JS trampoline (`run_loop`,
  `f32_bits`: 20 to 22 % of kernel self time, JS target only).

### Sparse edge ids (fix-1, 2026-09-24)

The first version of the BFS fell back to the old Jacobi fold, O(fuel · F · U), whenever the largest edge
id reached 4 · uses + 1024. A plain id offset triggers that, and it happens in practice: `ports/curved.bend`
`components`, `ports/occt.bend` `components` and `ports/curved-contact.bend` `parts` split off one
component and call `connectivity_steps` again on the faces left, which keep their global edge ids. A
400-face chain took 16 ms with dense ids and 15.7 s with offset ids (cubic).

Now `sparse_steps` renames the ids instead: one `IdUse{edge, face}` per use, Base `List.sort` by edge id
(the fuel-bounded merge sort, O(U log U), no new import), then equal runs get the next rank 0 .. d-1, written
into each face's dense id list. The unchanged `graph_steps` BFS then runs on the ranks with top = d - 1.
Ranking is injective on edge ids and the BFS answer is a set of reached faces, so the order of the ids
inside a face does not matter. Dense inputs take exactly the same defs as before. The old fold
(`connectivity_steps_list`, `connectivity_pass`, `touches_*`) had no caller left and is removed.

| Check | Result |
|---|---|
| `H.connected` on an n-face chain, JS, ids offset by 8n + 1024: n = 100 / 200 / 400 | old 282 / 2,025 / 15,728 ms (verify-1) → new 5 / 9 / 10 ms; dense 4 / 6 / 9 ms |
| Same, n = 1,000 / 1,500 / 3,000 (JS) | 30 / 18 / 19 ms |
| Native: 3 chains with ids at c · 10^6, `connected` (sparse) | old n = 300: 7.4 s, n = 1,000: no answer in 300 s → new n = 1,000 / 20,000: 0.27 / 0.34 s (process incl. startup) |
| Native: offset chain, reach count | old n = 1,000: 17.7 s → new n = 1,000 / 20,000 / 100,000: 0.31 / 0.31 / 0.38 s |
| Differential, JS: new vs old vs JS Jacobi oracle, 3,000 random multi-shell cases (2,703 on the sparse path: offset, stride, scattered up to 2^32 - 1, duplicate ids, short/long masks, fuel 0 ..) + `diff-hotspot.mjs` 3,009 cases × 10 functions | 0 differences |
| JS A/B, frozen `old`/`new` copies (31 cases: r10b strict/tolerated/retained, all examples, bored-spacer print, 6 public-boolean regressions, 8 build123d cases) | 31 / 31 byte-identical |
| Same 31 cases with a third copy that forces **every** connectivity call through the ranked path | 31 / 31 byte-identical to old |
| Native A/B (planar slice rebuilt in each copy, 28 non-r10b cases) | 28 / 28 byte-identical |
| r10b `r10bRetainedContext` brep.json / STEP (root paths normalized) | `1bd069fd…` / `54cca972…`, same as before the hotspot rewrite |
| Wall time on the dense workloads (2 reps, alternating order) | unchanged within noise (r10b-strict 3.4 s both) |

`test/collections-hotspot.test.mjs` now runs every case also with renamed sparse ids, and has a
regression test (2 × 1,500-face chains, component split, offset ids): 25 ms now, the old code times out
after 150 s. Scripts: `tmp/collections/fix1/` (untracked).

### Next quadratic spots (follow-ups)

1. **Cell classification**: done, see "Planar Boolean classification" below (each operand prepared once per
   Boolean, far edges bounded per in-plane ray; every ray still votes).
2. **`List.get` by id**: `face-classification prepare_uses`/`edge_curve_valid` (edge per use),
   `halfspace vertex`/`side_at`/`use_start` (`clip_ring`, `volume`, `lines_valid`), `curved-metrics
   edge_domain`/`vector_use`: 320 to 406 ms self per run. Fix with an `IdVec` built once per pass, keeping the
   `G.v3(0, 0, 0)` and `Side{3, 0}` fallbacks.
3. **`face-classification edges_scale`** recomputed for every query point (O(E) each): 440 ms in r10b.
4. **Remaining per-edge scans**: `truck-topology` `vertex_used` and `count_faces` (lines 459 and 522 to 538),
   `solvespace used_count(S.count_faces)` (line 476), `curved-edges is_seam` (`S.count_loops` per edge),
   `occt remap_uses` (`H.mapped` per use). All can use `S.edge_counts`, `H.used_flags` or the remap table.
5. **Small O(n²) validators**: `unique_vertices` (37 ms in r10b; needs a grid with neighbour cells, not an
   exact key), `unique_edges` (7 ms; tree map on `K.edge`), `find_cut` (the newest cut wins, so `put`).
6. **`remap_edges` sparse maps** still take the list path `remap_list` (O(E · map)) when the largest map id
   reaches 4 · map + 1024. Same shape as the connectivity cliff, but quadratic, not cubic; the same
   sort-and-rank step would remove it.

## Planar Boolean classification (2026-09-24)

After the hotspot rewrite the planar Booleans spent almost all kernel time in cell classification
(`ports/planar-boolean-selection.bend classify_cell`: 6.4 of 7.1 s in cut-h1, 18.1 of 19.7 s in
frame-with-tab). Every arrangement cell ran `S.classify` against both operands, and every call redid work
that does not depend on the query point:

- per face query (the boundary pass at the cell point, then again at every root of the five solid rays):
  `List.get` of the face, `F.edges_scale` over all edges of the solid, and `F.prepare_loops` with a `List.get`
  of edge, domain and both vertices per use, O(F + E + uses · E);
- per in-plane ray (five per face query) and edge: the cut plane from the face normal and the exact parallel
  certificate (`I.exact_dot`, an expansion product) of curve-plane `classify`, then the whole curve-plane
  pipeline for every edge, although only the edges near the cut plane can cross it or be undecidable.

### What changed

| File | Change |
|---|---|
| `kernel/ports/planar-boolean-classification.bend` (new, K) | `prepare(solid, domains, tolerance, budget)` once per operand and Boolean; `classify(prepared, point)` answers exactly `S.classify(solid, domains, point, tolerance, budget)`, the whole `Classification` (ray count, unresolved reason and face index included). |
| `kernel/ports/planar-boolean-selection.bend` | `select` (same signature) prepares both operands and hands them to `select_cells`, the former recursion (same halving and simultaneous binding); `classify_cell` calls `K.classify`. `choose`, `membership`, `Membership` and `Selection` are unchanged (the laws pilot mutates `choose`). |

`S.classify` and `F.classify` are untouched; their other callers (validation, r10b's curved path) keep the
per-query form. Cylinder faces in K call `CY.classify` (cylinder classification) unchanged; other surfaces answer `FaceUnknown` as before.

**Prepared once** (the same expressions on the same values, only moved):

| Work | Before, per query | Now |
|---|---|---|
| `nonempty` and `edges_closed` of the solid | per cell and operand | once |
| face lookup | `List.get`, O(F) | faces walked in order next to their prepared form |
| `edges_scale(edges, s)` | O(E) per face query and per solid query | `R.max(s, M)` with `M` the same fold started at the first curve scale. `R.max` keeps its left argument on ties, so the fold returns the first maximal element; `R.less` is a strict weak order on Reals without a NaN word, so that element is `R.max(s, M)`. With a NaN word among the curve scales K keeps the list and folds per query. |
| loop preparation (`F.prepare_uses`) | per face query, `List.get` per use | once, with `IdVec` lookups of vertices, edges and domains (`kernel/lib/id-vec.bend`). Only its last test depends on the point (both edge errors at most source budget + resolution, else `InputGap`), so each use keeps its fixed failure (`InvalidIndex`, `InvalidInput`, `MissingTrim`, `InvalidTrim`, in F's order) or its two error values; a query scans for the first failing use of the first failing loop, exactly the `join_edges`/`join_loops` order, and then `InvalidTopology` for an open loop. |
| face normal, its input checks, `outer_count` | per face query | once per face |
| the five in-plane rays of `F.classify_rays` | direction, `cut`, `normalize(cut)` and their checks per ray | once per face (they depend on the face normal only) |
| per line edge and in-plane ray: `b`, the exact parallel certificate, the near-parallel test | per ray and edge | once; a near-parallel, non-parallel edge makes curve-plane answer `NearParallel` (or an earlier `Unresolved`) for every point, so that ray is invalid for every query ("dead") |
| `magnitude(origin)` in `input_scale(origin, point, 0)` | per ray and edge | once per edge; `max(magnitude(point), 0)` once per face query |
| per face and solid ray: the point-independent half of `ray.bend plane_intersection` (`length(normal)`, `b`, its certificate, direction and surface checks), `normalize(direction)` of `Y.point` | per solid ray and face | once |

**Early exits.** `F.add_agreement` and `S.add_vote` ignore an invalid ray's flags and counts, so an in-plane ray
stops at its first invalid edge and a solid ray at its first invalid face; valid rays still see every edge and
every face, and their counts are the same U32 sums. The boundary pass stops at the first `Unresolved` face,
which is the one `S.boundary_join` returns; otherwise the first `Boundary` wins, as before.

**Far edges.** An edge is skipped only where the answer of the skipped step is certain, and then that answer is
used:

- in-plane ray, line edge: both vertices farther than `3 (linear + margin + budget)` plus slack from the cut
  plane, on the same side. Then `ray_avoids_vertices` is true and curve-plane answers `Disjoint`: for a
  parallel line because the whole line is that far (it passes within the loop budget of its vertices); for a
  non-parallel line because its root lies outside the trimmed interval by more than the parameter resolution,
  provided the root parameter is below 1e9 (`scalar_valid`) and `ray.bend`'s guard bound times
  `1 + |direction| / |b|` (the linear resolution of `line_root`) stays below half the tolerance, which K checks.
  The result is `RayCount{linear_ok, 0}`; `linear_ok` is decided by the same bound when certain, else computed
  exactly.
- boundary pass, line edge: the max-norm distance from the point to the box of the edge's vertices exceeds
  `2 (linear + resolution + source + budget)` plus slack. A trimmed line edge lies within the loop budget of its
  vertex segment, so `F.edge_boundary` would answer `ClearBoundary`.

The bounds are plain F32 on approximations (`hi + lo`) of the stored values, with a slack of 2^-14 times the
magnitudes involved; F32 rounds at 2^-24 per operation and the skipped Real arithmetic is accurate to about
2^-44, so the slack dominates both by orders of magnitude. The inputs are finite (vertices and line curves
passed `vec_valid`/`curve_valid` in the loop preparation, the point `vec_valid` in the face query); a NaN or
overflow of the bound arithmetic fails the comparison, and the edge is then evaluated exactly. Edges near the cut plane, which decide the parity, always go through the exact
curve-plane pipeline. All loops recurse on lists (structural); `select_cells` keeps its fuel.

### Proof of bit-identity

Frozen trees, as for the hotspot rewrite: `tmp/planar-hotspot/old` is the live tree at 02:51 (HEAD plus other
agents' uncommitted work), `new` is `old` plus the two files above. Scripts are in `tmp/planar-hotspot/`
(untracked).

| Check | Result |
|---|---|
| `PLANAR_HOTSPOT_FULL=1 node --test test/planar-hotspot.test.mjs`: `K.classify` against `S.classify` on 16 solids (box, notch, slanted prism, 0.001 mm slab, cavity, separated shells, rotated/translated box, a notch at (5000, -3000, 2000), the 8 captured build123d operands incl. frame-with-tab's 32-face `GivenDomain` operand), 2 tolerances × 2 budgets, grid, vertex, edge, near-vertex (1e-9 to 1e-3 mm), far and random points | 44,800 points, 0 differences (Outside 24,324, Boundary 12,341, Inside 7,481, FaceUnresolved 508, AmbiguousRays 146); an earlier run with fewer random points: 18,148, 0 differences |
| JS A/B (`run.mjs`, `compare.mjs`): all 31 cases (r10b strict/tolerated/retained, all examples, bored-spacer print, 6 public-boolean regressions, 8 build123d cases), 2 reps, alternating order | 62 / 62 byte-identical: every output file (`.brep.json`, `.step`, `.stl`, `.html`), stdout, stderr, exit code, brep id order |
| Native A/B (planar slice built in each tree), 28 non-r10b cases, 2 reps | 56 / 56 byte-identical; the native vs JS difference (backend metadata only) is the same in both trees for all 28 files |
| SHA-256 of every host → kernel call result (`hash-kernel-calls.mjs`): fuse-g1, cut-h1, bored-spacer, planar-union, planar-pocket, frame-with-tab, r10b strict, r10b tolerated-regularized | identical running digests: 198 + 418 + 78 + 249 + 409 + 833 + 18,602 + 24,609 calls |
| r10b anchor: `r10bRetainedContext` brep.json / STEP of the new tree (root path → `<root>`) | `1bd069fd…` / `54cca972…`, the values recorded before the hotspot rewrite |
| `build-native.mjs --set planar` smoke: the captured build123d planar Boolean calls replay bit-exact | passes in the new tree and live (build `6a6a456e…`) |
| `npm run check:bend`, `bend kernel/laws/pilot/PROOF.bend` (imports the selection) | All terms check |
| Final source (a comment and `List.reverse` for a hand-written reverse after the runs above; native build `6a6a456e…` instead of `6e356432…`) | native A/B 28 / 28 and JS A/B of the 11 planar and r10b cases byte-identical again |
| Live tree: `node --test test/native-bridge*.test.mjs` (build `6a6a456e…`); `test/planar-hotspot`, `collections-hotspot`, `solid-classification`, `classification-input`, `planar-boolean-integration`, `planar-difference-integration`, `planar-boolean-native`, `planar-difference-native` | 60 / 60 and 49 / 49 pass |

### Measurements

Apple M5 Pro, Node v22.23.1, warm Bend JS cache, shared machine. Wall / CPU ms of the whole process, two
reps; `*` marks the variant that ran first in its pair. New's very first case (r10b strict) paid the JS
compile of the changed modules and is left out.

| JS | old rep 1 | old rep 2 | new rep 1 | new rep 2 | best old → new |
|---|---:|---:|---:|---:|---:|
| cut-h1 | 10,659 / 12,042* | 6,568 / 7,540* | 3,602 / 4,753 | 2,273 / 3,079 | 2.9x |
| frame-with-tab | 21,827 / 23,702 | 13,929 / 15,234 | 5,331 / 6,702* | 3,373 / 4,375* | 4.1x |
| planar-pocket | 6,484 / 7,648* | 4,069 / 4,909* | 3,232 / 4,309 | 1,993 / 2,715 | 2.0x |
| planar-union | 4,643 / 5,711 | 2,975 / 3,733 | 2,682 / 3,528* | 1,723 / 2,327* | 1.7x |
| fuse-g1 | 4,026 / 5,231 | 2,621 / 3,433 | 2,587 / 3,514* | 1,541 / 2,196* | 1.7x |
| fuse-g7 | 4,138 / 5,398* | 2,644 / 3,456* | 2,468 / 3,376 | 1,549 / 2,220 | 1.7x |
| r10b tolerated-regularized | 64,786 / 69,792 | 63,781 / 68,885 | 23,474 / 27,777* | 22,845 / 26,848* | 2.8x |
| r10b strict (rep 2) | | 5,396 / 6,895* | | 5,353 / 6,865 | 1.0x |

Load 4.1 to 6.4 (1-minute average before each run). The machine sped up between rep 1 and rep 2 for both
variants alike; the other 23 cases (1.1 to 2.0 s, no planar Boolean) are unchanged within noise. r10b
tolerated-regularized gains as well, so its run reaches the planar selection too.

| Native planar slice | old | new | |
|---|---:|---:|---:|
| cut-h1 | 887 / 884 | 326 / 326 | 2.7x |
| frame-with-tab | 2,169 / 2,133 | 690 / 695 | 3.1x |
| planar-pocket | 571 / 580 | 309 / 319 | 1.8x |
| planar-union | 381 / 394 | 225 / 230 | 1.7x |
| fuse-g1 | 273 / 273 | 140 / 137 | 2.0x |
| fuse-g7 | 274 / 276 | 141 / 137 | 2.0x |

Wall ms, both reps, load 3.9 to 4.5; the other 22 cases are unchanged. One captured Boolean call in the
native smoke test (load 6.6 to 7): planar-union 310 → 84 ms, planar-pocket 544 → 166, frame-with-tab subtract
502 → 157, frame-with-tab union 1,963 → 391.

CPU profiles (`node --cpu-prof`, 1 ms sampling, `analyzeProfile`, load 3.4 to 4.0):

| | cut-h1 old | cut-h1 new | frame-with-tab old | frame-with-tab new |
|---|---:|---:|---:|---:|
| wall | 7,461 | 2,920 | 15,282 | 4,346 |
| kernel bucket | 5,855 | 1,652 | 13,040 | 2,855 |
| `classify_cell` inclusive | 5,255 | 950 | 11,997 | 1,576 |
| of which in-plane rays (`classify_rays`) | 3,978 | 727 | 9,008 | 1,164 |
| `exact_dot` / `F.prepare_loops` inclusive, whole run (new: `K.prepare` and the validation passes) | 872 / 711 | 16 / 70 | 2,143 / 1,415 | 53 / 120 |
| arrangement (`arrange`) | 221 | 220 | 283 | 283 |

Per query point (JS, `tmp/planar-hotspot/micro.mjs`, the two operands of frame-with-tab's union, 40 random
points): `S.classify` 115 / 15.6 ms, `K.classify` 11.3 / 1.54 ms, after a `K.prepare` of 48 / 5 ms.

### What is left

- Of the remaining classification time about 40 % is the exact curve-plane evaluation of the edges that an
  in-plane ray actually crosses (`line_budget`: 410 of 950 ms in cut-h1, 595 of 1,576 ms in frame-with-tab).
  Certifying those crossings by bounds as well (hit ahead or behind, far from both ends) would replace exact
  predicate evaluations, not only the search around them; not done.
- `S.classify`/`F.classify` themselves still prepare per query for their other callers (item 3 of "Next
  quadratic spots" for r10b); the prepared form here is specific to the planar selection.

## Container benchmarks

### Upstream (BENCHMARK.md at the pin; native C backend, one thread, arm64 macOS)

Nanoseconds per operation; sizes as upstream defines them (small / medium / large).

| Operation | small | medium | large | vs C (large) |
|---|---:|---:|---:|---:|
| dynamic array get | 22.8 | 22.0 | 21.2 | 15.0x |
| dynamic array set | 5.9 | 2.7 | 4.3 | 2.0x |
| dynamic array push | 25.9 | 25.0 | 46.8 | 2.1x |
| bitset get | 2.2 | 2.3 | 2.7 | 1.2x |
| bitset set | 2.7 | 2.0 | 1.2 | 0.6x |
| tree map insert | 194 | 352 | 3300 | 9.8x |
| tree map lookup | 145 | 315 | 575 | 6.0x |
| hash map get (String) | 36 | 51 | 388 | 9.9x |

Hash map against `Base.Map` (both Bend, String keys): set 0.02 to 0.07x, get 0.04 to 0.15x of `Base.Map` time.

### Wonky (our drivers, 2026-09-23, this machine)

`tmp/collections/bench.bend` (not tracked; rerun with `node tmp/collections/bench.mjs` after building
`bend bench.bend -o bench` there) generates n values and n queries with an LCG and runs the kernel-shaped list
version against the collection version. Every list/collection pair returns the same checksum, and so do the
JS and native targets. Wall time of the whole run in ms, median; native includes ~4 to 8 ms process start, the
input generation alone is 6 to 24 ms (native, n = 16000; noisy) and 2 ms (JS, n = 4000).

| Workload | list (today) | collection | native n = 4000 | native n = 16000 | JS n = 1000 | JS n = 4000 |
|---|---|---|---:|---:|---:|---:|
| read by id | `List.get` | `IdVec.get` | 103 → 6.5 | 1745 → 7.8 | 21.9 → 4.3 | 416 → 12.9 |
| id membership | list scan | `IdSet.has` | 258 → 11.1 | 3528 → 5.3 | 28.4 → 7.8 | 603 → 6.0 |
| edge-pair lookup | `find_cut` scan | tree map, `edge` key | 143 → 32 | 2177 → 133 | 56 → 52 | 878 → 98 |

Larger native runs (collection side only): n = 262144 takes 22 ms (`IdVec`) and 14 ms (`IdSet`), i.e. below
the generation noise, and 2.7 s for the tree map (about 5 µs per put + get pair at that size; 557 ms at
n = 65536). Packing the edge into one U32 key (`min * n + max`) instead of `IdPair` gives 460 ms at 65536, so
the pair comparator is not the tree map's cost. On the JS target the tree map only wins from a few thousand
entries; below that a list scan is as fast.

Compile cost on the JS target (cold, cache off): `id-vec.bend` 0.44 s, `id-set.bend` 0.20 s, `keys.bend`
0.11 s. The full probe, which imports all 25 vendored modules including the hashes, takes 13.4 s (cached
afterwards); for scale, `halfspace.bend` takes 4.8 s. Import only the modules a pass needs.

## Tests and checks

- `node --test test/collections.test.mjs` (part of `npm test`): manifest and pin; every vendored public module
  compiles through `src/bend-loader.mjs` (`kernel/lib/collections-probe.bend` imports all of them); dynamic
  array, tree map, bitset, hash map and SHA-256 test vectors; `IdVec`, `IdSet`, edge-keyed tree map and exact
  point keys against JS oracles on seeded random scripts, including out-of-range ids and 32-bit word
  boundaries.
- `WONKY_COLLECTIONS_NATIVE=1 node --test test/collections.test.mjs` additionally builds the same drivers
  with `.tools/bend-2.0.25/bin/bend` (about 30 s) and requires byte-identical answers natively.
- `bend kernel/lib/<file>.bend --check-only` checks a module alone.
- `node scripts/vendor/bend-collections.mjs` re-verifies the vendored bytes against GitHub.

- `node --test test/collections-hotspot.test.mjs` (part of `npm test`): the rewritten passes against JS
  oracles of the former list definitions (connectivity: the Jacobi fold), on dense and on sparse edge ids, plus
  a regression test for the sparse-id cliff (a 2 × 1,500-face component split must stay near-linear).

- `node --test test/planar-hotspot.test.mjs` (part of `npm test`, about 30 s): the prepared planar cell
  classification (`ports/planar-boolean-classification.bend`) against `S.classify` on 16 planar solids,
  including the captured build123d operands, on a quarter of the points; `PLANAR_HOTSPOT_FULL=1` compares all
  points for 2 tolerances × 2 budgets (44,800 points, about 9 minutes).

The native N-API planar slice imports the rewritten passes (planar Boolean validation calls `edges_closed` and
`open_uses`), so it was rebuilt with `node scripts/native-bridge/build-native.mjs --set planar` (live build
`e5c4e514…`, 2026-09-24; after the sparse-id fix `5f243667…`; with the prepared planar classification
`6a6a456e…`).
