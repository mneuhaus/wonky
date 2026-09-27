# Metro: measuring error on simplified surfaces (Cignoni, Rocchini, Scopigno)

- Kind: paper (technical note / short contribution) plus a reference tool. Canonical: https://doi.org/10.1111/1467-8659.00236 (Computer Graphics Forum 17(2):167-174, June 1998). Other: author PDF (dvips, 1998-06-19, 8 pp.) formerly at http://vcg.isti.cnr.it/publications/papers/metro.pdf, now 404, retrieved via Wayback http://web.archive.org/web/20240227195138/https://vcg.isti.cnr.it/publications/papers/metro.pdf (local copy `tmp/research/pdf/metro-cignoni-1998.pdf`). EG Digital Library handle https://diglib.eg.org/handle/10.2312/8468 . Current code: `apps/metro/` in vcglib, https://github.com/cnr-isti-vclab/vcglib/tree/devel/apps/metro (sparse clone at `tmp/research/metro-measuring-error-on-simplified-surfaces-cignoni-rocchin/`). The generalized sampler used by MeshLab's "Hausdorff Distance" filter is `HausdorffSampler` in `vcg/complex/algorithms/point_sampling.h`.
- Authors/organization: Paolo Cignoni, Claudio Rocchini, Roberto Scopigno; IEI-CNR / CNUCE-CNR Pisa, today the Visual Computing Lab at ISTI-CNR. 1998 (Metro v2 in the paper; code release Metro 4.07, 2007-05-11).
- License: the paper is (c) Eurographics / Blackwell, closed access (OpenAlex `oa_status: closed`). The 1998 paper says "Metro v.2 is available as public domain software" (sec. 5, DOCUMENTED), but the maintained code is GPL: file headers say GPL-2.0-or-later (`apps/metro/metro.cpp`, `sampling.h`, `readme.txt`), and the vcglib repo LICENSE is GPL-3.0 (DOCUMENTED). Implication: do not copy vcglib code into wonky. The method is a few textbook equations and is trivially reimplementable from the paper, which is what wonky should do. Running the `metro` binary as an external test oracle would be a separate process (no linking), which is fine for tests (INFERRED).
- Status: historical and canonical. About 1,831 citations (Semantic Scholar) and 1,491 (OpenAlex) as of 2026-09-24. vcglib (DOCUMENTED, `gh api`): C++, 1,295 stars, 384 forks, 80 open issues, 35 contributors, pushed 2026-09-16, latest release 2025.07. `apps/metro/metro.cpp` itself was last touched 2018-02-13 and is effectively frozen.

## What it is

A tool and a definition set for measuring the geometric difference between two triangle meshes that represent "the same" surface (original vs simplified). It estimates the one-sided and two-sided (Hausdorff) distance, mean and RMS distance, signed variants and an approximate "volume of difference" by **sampling one surface and computing exact point-to-mesh distances to the other**. It makes no assumption about how either mesh was produced. It became the de-facto standard metric for mesh-approximation error (MeshLab's Hausdorff filter is its descendant).

## How it works

**Definitions (paper sec. 2, DOCUMENTED):**
- point-surface distance `e(p,S) = min_{p' in S} d(p,p')`, d = Euclidean;
- one-sided distance `E(S1,S2) = max_{p in S1} e(p,S2)` (not symmetric);
- Hausdorff distance `H = max(E(S1,S2), E(S2,S1))`;
- mean distance `E_m(S1,S2) = (1/|S1|) * integral_{S1} e(p,S2) ds`, estimated from uniformly distributed samples;
- signed distance for orientable S1: `e'(p,S2)` takes the sign of `N_p . (p' - p)`, with p' the nearest point on S2 and N_p the S1 normal. `E+ = max e'`, `E- = |min e'|`. This separates "S2 lies outside" from "S2 lies inside". The nearest point is not unique, and Metro then picks one at random for the sign, which the paper admits "introduces a potential imprecision" (sec. 3).

**Algorithm, paper version (Metro v2, sec. 3):**
1. The *pivot* mesh S1 is sampled by **scan-converting** each triangle at a user step (default guidance: "a sufficiently thin sampling step size is 0.1% of the bounding box diagonal"). An alternative is **Monte Carlo**: k random points per face, k proportional to face area. For triangles smaller than step^2, a random draw with probability area/step^2 decides whether to take one sample, which keeps the sampling unbiased.
2. For each sample, the nearest face of S2 is found via a **3D uniform grid** over S2's bbox: each cell stores the faces intersecting it. The search tests faces in the sample's cell, then expands ring by ring in increasing distance "until we find that all not tested cells are farther than the current nearest face". The point-triangle distance kernel comes from the POV-Ray source.
3. Accumulate max, mean, histogram. With option `-s`, swap roles and rerun to get the symmetric Hausdorff distance.
4. Output: topology/size stats (orientable, 2-manifold, closed, vertices, triangles, connected components, bbox diagonal, feature-edge length at a crease angle, area, volume). Errors are reported in absolute terms and as a percentage of the bbox diagonal. The "volume of difference" `Vt = vol((S1-S2) u (S2-S1))`, split into V+ and V-, is only computed for orientable, single-connected inputs (Fig. 4). Meshes whose bbox diagonals differ by more than 10% are rejected as "excessive difference".
5. Complexity: worst case `O(A(S1) * n_f)` (sample count times S2 faces). With the grid, only "few tens" of faces are tested per sample (Table 1).

**Algorithm, current code (Metro 4.07, `apps/metro/sampling.h`, DOCUMENTED):**
- Samples come from three sources: **vertices** (every referenced vertex of S1), **edges** (the unique undirected edge list, sorted and uniqued; `n = len * sqrt(samples_per_area)` interior points evenly spaced, endpoints excluded) and **faces**.
- Face sampling modes: Monte Carlo (`AddRandomSample`: two uniforms `r1,r2`, reflect if `r1+r2>1`, point `p0 + r1*(p1-p0) + r2*(p2-p0)`); longest-edge **subdivision** to depth `floor(log2 n)` with the centroid of each leaf; **similar triangles** (the default, `-s2`): `n_edge = floor((sqrt(1+8n)+5)/2)`, then the interior lattice points `v0 + i*V1 + j*V2`, with `V1 = (v1-v0)/(n_edge-1)`, `i = 1..n_edge-2`, `j = 1..n_edge-2-i`. Edges and vertices are sampled separately, so face sampling is interior only.
- **Error diffusion of sample counts**: `n_samples_decimal += area * samples_per_area; n = floor(n_samples_decimal); n_samples_decimal -= n`. The fractional remainder carries across faces, so the total hits the target and tiny faces are sampled occasionally without randomness (this replaces the paper's random acceptance for scan conversion).
- Budget: the default target is `10 * max(fn1, fn2)` samples. Vertex samples are taken first, then the rest is split between edges and faces.
- Nearest-face search: static uniform grid (default), hashed grid, AABB binary tree or octree (`GetClosestFaceEP`). The point-triangle kernel `PointDistanceEP` (`vcg/simplex/face/distance.h:49-180`) uses a precomputed face plane and edge vectors. It computes the signed plane distance d (early out if `|d| > current best`), projects q onto the plane, and runs 2D edge-side tests in the dominant axis plane (`NORMX/NORMY/NORMZ` flags). If a test is `<= 0`, it falls back to point-segment distance `PSDist` for that edge. There is a robustness fudge: if `min(b0,b1,b2) < 1e-6 * doubleArea`, it also uses the segment distance.
- `AddSample` returns -1 and **silently drops** samples whose distance equals `dist_upper_bound`. In `metro.cpp` that bound is the diagonal of the *union* bbox inflated by 2%, so no real sample is dropped there. The generic `HausdorffSampler` in `point_sampling.h` has the same "not considered" behaviour with a caller-set bound (DOCUMENTED; a trap if reused with a small bound).
- Statistics: `max` (L_inf), `mean` (L1 sum / n), `RMS = sqrt(sum d^2 / n)`, and a crude `volume = mean_sum / samples_per_area / 2`. A 256-bin histogram over `[0, diag/100]` (`-h` writes `forward_result.csv`/`backward_result.csv`). `-c` writes per-vertex error as quality and color into `*_metro.ply`.
- Numerics: vertex coordinates and normals are `double` (`vcg::vertex::Coord3d`, `Normal3d`). The paper mentions ad hoc handling of nearly coincident vertices, near-zero-area facets and elongated triangles, and "to minimize rounding errors in the computation of the sum ... a fanin algorithm (binary tree structured sum)" (sec. 3, citing Linz 1970).

## Robustness and guarantees

- **What the sampled number is:** the reported max is a **lower bound** of the true one-sided distance, because it is a max over a finite subset of S1 (INFERRED, standard). The paper gives no convergence bound; it only observes empirically that a 0.1%-of-diagonal step suffices "in most cases". Mean/RMS are quadrature estimates of the area integral.
- **How to make it an upper bound (INFERRED, the key idea for wonky):** `p -> e(p,S2)` is 1-Lipschitz. So if every point of S1 lies within the covering radius rho of some sample, then `E(S1,S2) <= max_i e(s_i,S2) + rho`. With similar-triangles lattice sampling, rho is at most the largest sub-triangle's minmax vertex distance. That is the circumradius for non-obtuse sub-triangles, and in all cases at most `l_max / sqrt(3)` with `l_max` the longest sub-triangle edge (my derivation: the equilateral case is extremal). Vertices and edge samples cover the triangle boundary. Monte Carlo sampling gives no deterministic rho, so certification needs lattice sampling.
- **Exactness of each sample:** the inner min is computed exactly, up to floating-point error, over *all* faces, so each `e(s_i,S2)` is an exact value, not an estimate. Any explicit point q in S2 gives an *upper* bound `d(p,q) >= e(p,S2)`. A conservative SDF-style bound (for example min/max CSG of primitive SDFs) gives only a *lower* bound. Mixing the two directions wrongly is the classic bug (INFERRED).
- **Signed distance** is heuristic: sign ambiguity at non-unique nearest points, and it is undefined for non-orientable or multi-component inputs (paper sec. 3).
- **What it cannot see:** topology changes are only partially detected (number of connected components; paper sec. 4). Feature-edge preservation is only compared by total length; the paper proposes sampling feature edges against feature edges (max/mean displacement and angles), which is not implemented. Unsigned surface distance can miss inverted orientation or an interior/exterior swap (INFERRED).

## Parallelism and performance

- Paper Table 1 (DOCUMENTED; SGI O2, R5000 180 MHz, 96 MB):

| S1 faces | S2 faces | step | samples | faces tested per sample | time |
|---:|---:|---:|---:|---:|---:|
| 4,001 | 69,451 | 0.2 | 365,307 | 30.3 | 29 s |
| 2,867 | 28,322 | 0.1 | 540,667 | 29.3 | 24.7 s |
| 6,369 | 67,607 | 0.1 | 1,670,420 | 24.8 | 89.8 s |

- Fig. 4 example: 179 vs 7,960 triangles, 2,462,768 samples, Hausdorff max about 0.97-1.0% of bbox diagonal.
- The code is single-threaded. `metro.cpp` prints samples/second but publishes no modern numbers.
- Structure (INFERRED): every sample is independent, so the whole thing is `map(sample -> min over faces) |> reduce(max, sum, sum_sq)`. Pairwise (fan-in) summation, which the paper already uses for accuracy, *is* a balanced reduction tree.

## Known failures, limitations, war stories

- MeshLab filter bug: "Hausdorff Distance: cannot compute, it is the same mesh" for any input in v2016.12, a broken sameness test (https://github.com/cnr-isti-vclab/meshlab/issues/184). Users repeatedly ask for signed output (same thread).
- Unit confusion: "Distance does not have units, it depends on the input meshes" (https://github.com/cnr-isti-vclab/meshlab/issues/1052). Reports need explicit units and should be relative to the bbox diagonal.
- The default Monte Carlo generator in `sampling.h` is `srand(clock()); rand()`, which is nondeterministic run to run. Similar-triangles, the default, is deterministic (DOCUMENTED, code).
- Silent sample dropping beyond `dist_upper_bound` (see above).
- Uniform-grid search degrades on very non-uniform meshes (INFERRED; the reason 4.06 added hash grid, AABB tree and octree options, `history.txt`).

## Relevance for wonky

- **Direct gap it fills:** `src/comparison.mjs` (Bend-backed, F32x2) today only compares coaxial cylinders and lists "No general surface distance, Hausdorff distance, or minimum translation vector" as a limitation. A Metro-style sampled Hausdorff distance is the general, representation-agnostic comparison for (a) regression tests of Booleans and fillets against Onshape/OCCT exports (STL/mesh), (b) the diff/review viewer (per-sample error colors, exactly Metro's error-texture idea), and (c) the bake-off, to score the four Boolean prototypes against a common reference with a number instead of eyeballing.
- **Sound, tolerance-aware comparison (INFERRED, the design to prototype).** Let B be wonky's exact B-rep, M its print mesh with certified deviation `delta_M` (`src/print-mesh.mjs` reports `achievedDeviationMm`), and R a reference mesh with stated chord tolerance `delta_R` to its exact solid R*. By the triangle inequality of the Hausdorff metric:
  `H(B,R*) <= delta_M + max(Ehat(M,R) + rho_M, Ehat(R,M) + rho_R) + delta_R + eps_fp`
  and `H(B,R*) >= max(Ehat(M,R), Ehat(R,M)) - delta_M - delta_R - eps_fp`,
  with `Ehat` the sampled maxima and `rho` the lattice covering radii. Test verdict: **pass** if upper <= tol, **fail** if lower > tol, otherwise **undecided -> refine** (halve rho) or fail explicitly. This matches the project rules "approximations need explicit tolerances" and "unsupported cases must fail explicitly".
- **Even better when the reference is analytic:** for faces that are planes, cylinders or cones, distance from a sample to the *trimmed* face can be computed in closed form: foot point on the surface, then an in-trim test in (u,v), else distance to the boundary curves. That removes `delta_R`. Useful for comparing against closed-form expected solids in tests (INFERRED).
- **Bend fit:**
  - The sample generation is pure and deterministic (similar-triangles lattice, per-face counts via a prefix sum of `area * density`; the error-diffusion trick becomes `floor(prefix[i+1]) - floor(prefix[i])`, which is parallel and mutation-free).
  - Per-sample min over faces is a map; max/sum/sum-of-squares is a balanced fork-join reduction, and pairwise summation keeps the error at O(eps log n).
  - For the GPU, **brute force** (each sample against all faces) is perfectly uniform work, `N_s * N_f` point-triangle kernels. For typical FDM parts (1e3-1e4 triangles, 1e4-1e5 samples) that is 1e7-1e9 evaluations: fine on Metal, slow in interpreted JS.
  - A grid or BVH (Morton sort by U32 keys, balanced build) gives CPU speed but divergent GPU traversal. A uniform-grid bucket via sort-by-cell-key is mutation-free (INFERRED).
- **Precision:** the point-triangle kernel involves differences of nearby coordinates. F32 alone (24-bit mantissa, about 1.2e-5 mm absolute at 200 mm extents) is enough for FDM-level acceptance (0.01-0.05 mm) but not for the 1e-7 mm tolerances wonky uses in `validate-step.py`/`comparison.mjs`. F32x2 (about 48-bit) gives about 1e-12 mm at 200 mm, which covers everything. The `1e-6 * doubleArea` fudge in `PointDistanceEP` should be replaced by an exact-or-fallback rule: take the min over all three segment distances and the interior projection, so the kernel is branch-uniform and needs no epsilon (INFERRED).
- **Testing and FDM:** Hausdorff plus signed E+/E- directly answers the FDM question "is any wall more than X mm off, and in which direction?". Complement it with volume/valprop checks, because unsigned surface distance misses orientation errors.
- **LLM ergonomics:** report `{maxFwd, maxBwd, mean, rms, rho, delta_M, delta_R, bound:[lo,hi], verdict}` in mm and as % of bbox diagonal, with the worst sample location and the face id (provenance). An agent can then act on "face F12 is 0.3 mm inside the reference near (x,y,z)".

## Pointers worth porting or studying

- Paper sec. 2 (the definitions above), sec. 3 (scan conversion vs Monte Carlo, uniform-grid ring search, random acceptance for small triangles, fan-in sum), Fig. 4 (output schema worth mirroring), sec. 4 (the feature-edge comparison proposal, which is worth implementing for B-rep edges: sample wonky's edges against the reference's sharp edges).
- `apps/metro/sampling.h`: `SimilarTriangles` / `SimilarFaceSampling` (lattice and `n_edge` formula), `EdgeSampling` (unique edge list and per-length density `sqrt(samples_per_area)`), the error-diffusion counter, and `Hausdorff()` (budget split and statistics).
- `vcg/simplex/face/distance.h:49` `PointDistanceEP`: the point-triangle kernel (study; rewrite branch-free for the GPU).
- `vcg/complex/algorithms/point_sampling.h:229` `HausdorffSampler`: the modern variant, which also records min distance and emits sample/closest-point clouds for visualization. Also `FaceSimilar`, `StratifiedMontecarlo`, and Poisson-disk pruning for nicer sample distributions.
- `apps/metro/metro.cpp`: CLI contract (default 10 samples per face of the larger mesh, union bbox inflated 2%, report relative to the diagonal).

## Verdict: adapt

Reimplement from the paper (not from GPL vcglib) as wonky's general `compare` metric: a deterministic lattice sampling, exact per-sample distance in F32x2, and a balanced reduction. Add the covering-radius and certified-mesh-deviation terms so that it yields a sound [lower, upper] Hausdorff interval and a pass/fail/undecided verdict. It is a natural fit for Bend (independent samples, fork-join reductions, brute-force variant is uniform GPU work). It fills the "no general surface distance" gap listed in `src/comparison.mjs`. Optionally run the stock `metro` binary out of process as a cross-check oracle during development.

