# Julian M. Smith, "Towards robust inexact geometric computation" (UCAM-CL-TR-766)

- Kind: technical report (PhD dissertation, University of Cambridge Computer Laboratory), 186 pages.
- Canonical URL: https://www.cl.cam.ac.uk/techreports/UCAM-CL-TR-766.html (PDF: https://www.cl.cam.ac.uk/techreports/UCAM-CL-TR-766.pdf)
- Other URLs: the same text is redistributed by Manifold as https://github.com/elalish/manifold/blob/master/docs/RobustBoolean.pdf (verified locally: same content as the TR, only ligature/glyph differences in pdftotext output); Manifold's 2D engine design doc https://github.com/elalish/manifold/blob/master/docs/Boolean2.md cites it section by section.
- Authors/organization, year: Julian M. Smith, St Edmund's College, Cambridge; supervisor Neil A. Dodgson, second advisor Malcolm Sabin. Dissertation July 2009, TR December 2009. Industrial precursor: Smith and Dodgson's Boolean in Cadcentre/AVEVA PDMS (1997 onwards). DOCUMENTED (TR front matter, ch. 5).
- License: report text copyright 2009 Julian M. Smith; Cambridge TRs are freely downloadable. No code is shipped with the TR, only short C++ fragments (tables 7.1, 7.2). Algorithms are not patented as far as the TR states (INFERRED: nothing in the TR mentions patents). Porting implication: re-implement from the math; the only public implementation is Manifold (Apache-2.0, https://github.com/elalish/manifold), which is also portable.
- Status: finished academic work, cited and productized by Manifold (3D `src/boolean3.cpp` since 2020; 2D `Boolean2` CrossSection engine that replaced Clipper2 by 2026-09, HEAD 36d0aab checked 2026-09-22). DOCUMENTED (https://github.com/elalish/manifold/blob/master/docs/Boolean2.md). Re-checked 2026-09-24: Manifold upstream HEAD 213b655 (2026-09-23) is a CI dependency bump, so the line map below, taken from the local clone at 36d0aab, is current. Manifold: 2288 stars, Apache-2.0. DOCUMENTED (`gh api repos/elalish/manifold`).

## What it is

A theory plus algorithm for Booleans on polygon meshes (3D) and polygons (2D) in plain floating point that is **topologically robust**: if the inputs are topologically valid, the output is topologically valid regardless of rounding, even for random vertex coordinates. Geometric validity (no self-intersection, planar facets) is explicitly NOT guaranteed; the thesis argues full geometric robustness in inexact arithmetic is an open problem (ch. 9). DOCUMENTED (TR ch. 3, 4.9, 9, https://www.cl.cam.ac.uk/techreports/UCAM-CL-TR-766.pdf).

The six robustness criteria it adopts (ch. 3): clear path (well-defined behavior on every input), termination, valid result, accurate result, reasonable time, reasonable memory. "Topological robustness" = valid topology in implies valid topology out, so any sequence of operations stays topologically valid. DOCUMENTED (TR ch. 3).

## How it works

### Validity model (4.2)
- Topological rules for a polygon mesh: facet boundary closure (each facet boundary is a closed set of half-edges) and shape boundary closure (for every vertex pair P,Q, count of half-edges P->Q equals count Q->P). Non-manifold shapes and coincident vertices are allowed; only these counting rules matter.
- Geometric rules (planar facet, facet enclosure, shape enclosure) are not enforced by the algorithm. DOCUMENTED (TR 4.2).

### Operation hierarchy (4.3, table 4.1)
Sixteen pairwise operations X_ij between an i-dimensional entity of A and a j-dimensional entity of B (0 = vertex, 1 = edge, 2 = facet, 3 = solid), organized in levels 0..6 = i+j. Levels 0-3 compute relations (signed intersection counts), levels 3-6 construct the result. Each X is computed only from lower-level shadow functions S, which are X gated by a symbolic coordinate comparison:

- Shadow rule (eq. 4.1): `S_ij(oA,oB) = X_ij(oA,oB)` if `X_ij != 0` and `xi_B^(i+j+1) >= xi_A^(i+j+1)`, else 0, where xi^(k) is the k-th coordinate (x, then y, then z). Ties resolve as "B is above A" (B symbolically perturbed in +axis direction). Consequence: A union B is not bit-identical to B union A. DOCUMENTED (TR 4.3).
- Table 4.1 "Formulae for intersection functions" (DOCUMENTED, TR 4.3):
  - X00 = 1
  - X01(vA,eB) = S00(vA, ve(eB)) - S00(vA, vs(eB))
  - X10(eA,vB) = -S00(ve(eA),vB) + S00(vs(eA),vB)
  - X02(vA,fB) = -sum_{h in dfB} S01(vA,h)
  - X11(eA,eB) = S01(ve(eA),eB) - S01(vs(eA),eB) + S10(eA,ve(eB)) - S10(eA,vs(eB))
  - X20(fA,vB) = sum_{h in dfA} S10(h,vB)
  - X03(vA,B) = sum_{f in dB} S02(vA,f)   (winding number of vA w.r.t. B)
  - X12(eA,fB) = -S02(ve(eA),fB) + S02(vs(eA),fB) - sum_{h in dfB} S11(eA,h)
  - X21(fA,eB) = -sum_{h in dfA} S11(h,eB) + S20(fA,ve(eB)) - S20(fA,vs(eB))
  - X30(A,vB) = -sum_{f in dA} S20(f,vB)
  Level-1 projections use x only, level-2 use (x,y), level-3 use (x,y,z). Only comparisons of input coordinates and of interpolated coordinates are needed, never an orientation determinant.
- Interpolation (eqs. 4.2-4.6): the intersection point of an edge crossing is interpolated as `xA = xA+ - t(xA+ - xA-)`, `t = D+/(D+ - D-)`, `D+ = xiB+ - xiA+ >= 0`, `D- < 0` by construction of the shadow signs, so the denominator is never zero; use 1-t from the other end when t > 1/2 for accuracy. Positions are consumed only for output geometry, not for topology decisions, except that level-2/3 shadow tests compare interpolated coordinates. DOCUMENTED (TR 4.4).
- Inclusion (eqs. 4.7-4.13): `I03 = cA + cI*X03`, `I12 = cI*X12`, `I21 = cI*X21`, `I30 = cB + cI*X30`; union (cA,cB,cI) = (1,1,-1), intersection (0,0,1), difference A-B (1,0,-1). Generalized to arbitrary winding numbers via `phi(x) = cA*a + cB*b + cI*a*b` (4.7, eqs. 4.17-4.20) so geometrically invalid input with winding outside [0,1] still gives a defined result. DOCUMENTED.
- Level 4: composite edges (retained pieces of input edges plus new intersection edges from X12/X21 and X22) carry signed net end-vertex counts; start and end vertices along an edge are paired by sorting on `v = sum xe - sum xs` (4.14-4.16). Level 5: each retained facet of A collects retained half-edges plus forward intersection half-edges; facets of B take the backward ones. Level 6: union of retained facets. DOCUMENTED (TR 4.5-4.6).
- Theorems 1-4 (4.9): interpolation pairs always exist; composite edges are balanced (E13+E22+E31 sum to 0); facet boundary closure holds; shape boundary closure holds. The algorithm is a fixed sequence of finite operations, so it terminates and stays topologically valid "even with random vertex data". DOCUMENTED.
- Triangulating a non-planar/invalid output polygon should minimize the extension of the invalid region (4.8). DOCUMENTED.

### Data smoothing (ch. 5, appendix A)
Symbolic perturbation keeps topology valid but leaves zero-area facets, slivers and zero-thickness gaps (cube-on-cube example: result depends on which operand is B). A tolerance-based post-process fixes this: vertex merge, zero-length edge removal, edge cracking (by vertex and between edges), half-edge and facet cancellation (full or partial, by swapping half-edges into a maximal closed-loop subset), removal ops, iterated "until no further operations are possible" with forced termination. Default tolerance 0.1 mm; running it once at the end of a sequence of Booleans was cheaper than after each op. DOCUMENTED (TR ch. 5, appendix A).

### 2D sweep in rounded arithmetic (ch. 7)
A Bentley-Ottmann style polygon Boolean in IEEE arithmetic:
- yAtX (table 7.1) and interpolate (table 7.2) choose the nearer endpoint for interpolation (`dxLLess = dxL < -dxR`), which bounds the error by the shorter sub-interval. DOCUMENTED (TR 7.1).
- Rounded edge splitting can reorder edges in the sweep line and create downward-vertical edges (7.5). Fix 7.6.1: reverse downward buffer edges and negate their multiplicity, never reverse the sweep-line edge. Fix 7.6.2, the **block rule**: at an event, scan up from the bottom until an edge ends at the event or does not pass under it, scan down from the top likewise; every edge in between is treated as passing through the event point and split there. DOCUMENTED.
- 7.6.3: topological validity maintained; O(n(n+I)) time, O(n) memory; non-iterative (newly split edges are not re-tested). DOCUMENTED.

## Robustness and guarantees

- 3D: topological validity guaranteed for all inputs satisfying the counting rules (Theorems 1-4). No geometric guarantee, no 3D error bound. DOCUMENTED (TR 4.9, 8.x covers 2D only).
- 2D error analysis (ch. 8), with u = 2^-24 (single) or 2^-53 (double), L = coordinate magnitude bound:
  - yAtX error |err yS| <= 4uL_Y (table 8.1); adjusted interpolation bounds xI within 3uL_X, yI within 7uL_Y (tables 8.2, 8.3).
  - Computed intersection point lies within |eA| <= sqrt(58) uL of segment A (eq. 8.14) and |eB| <= sqrt(153) uL = 12.37 uL of both segments (eq. 8.17): 7.37e-7 L single, 1.37e-15 L double. DOCUMENTED.
  - Point-in-polygon winding is correct if the point is at least 4uL from all edges. DOCUMENTED.
  - Empirical (8.3): over 1e7 random cases, 99.87% of errors < u, 99.99% < 1.5u, max 2.57u; distance to the true intersection point is unbounded (324u observed) for near-parallel segments. DOCUMENTED.
  - No division by zero or overflow: numerator <= denominator and one multiplicand < 1; the intersection point always lies in the intersection of both segments' AABBs (eqs. 8.18, 8.19). DOCUMENTED (8.5).
- Epsilon-tolerant correctness definition (8.4): a result is correct if it is the exact Boolean of inputs perturbed by at most eps. The basic 2D Boolean achieves eps = alpha (alpha = 12.37 uL); the sweep with splitting achieves eps = (kmax+1) alpha where kmax (the adjustment count, max number of times a vertex is moved) is unbounded a priori. DOCUMENTED (8.4, p. 153).

## Parallelism and performance

- The level 0-3 hierarchy is embarrassingly parallel per entity pair: each X_ij depends only on the two entities and lower-level S values of their boundary entities; no global ordering. INFERRED from table 4.1; confirmed by Manifold's implementation as parallel kernels `Kernel02`, `Kernel11`, `Kernel12`, `Winding03` over broad-phase pairs (https://github.com/elalish/manifold/blob/master/src/boolean3.cpp). DOCUMENTED (code).
- Naive complexity is O(nA*nB) pairs; Smith's thesis does not supply a broad phase for 3D; Manifold adds a BVH/sort-based broad phase. INFERRED/DOCUMENTED (Manifold code).
- The 2D sweep is inherently sequential (event order) and O(n(n+I)) worst case. DOCUMENTED (7.6.3).
- Production data point: PDMS deployment since 1997, used mostly for hidden-line engineering drawings, clash detection and rendering; in the five years after release users reported one Boolean fault. Smith also reports it was "much easier" to reach high reliability with the topologically robust core plus smoothing than by patching a standard inexact implementation. DOCUMENTED (TR 5.2).

## Known failures, limitations, war stories

- The one PDMS field fault: smoothing did not terminate on four coincident near-vertical facets; fixed by forced early termination, which leaves "shard" artifacts. Smoothing has no theory, can distort facets, and may not terminate without the cap. DOCUMENTED (TR ch. 5).
- Symbolic tie-breaking creates zero-area facets and zero-thickness gaps (coplanar inputs); only smoothing removes them, at unbounded accumulated tolerance kε. DOCUMENTED (ch. 5, 8.4).
- Non-planar polygon-mesh facets and near-vertical facets create shards (ch. 9). DOCUMENTED.
- Accuracy of the 3D algorithm is not analyzed. DOCUMENTED (ch. 8 scope).
- Test hygiene: IEEE compliance had to be forced by disabling compiler optimization (x87 80-bit extended registers changed results). DOCUMENTED (7.6.3 test notes). Relevant to any F32x2 port: compiler FMA contraction or reassociation silently breaks the error analysis. INFERRED.
- Manifold's 2D history: an earlier broad-phase-only Boolean2 design (manifold issue #289 thread) failed on dense near-concurrent edge clusters (non-manifold results, closed-walk assert); fixed by letting sweep order decide clusters globally via the block rule. DOCUMENTED (https://github.com/elalish/manifold/blob/master/docs/Boolean2.md).
- Manifold deviates from pure axis shadows: ties are broken using vertex normals (`Shadows(p,q,dir) = p==q ? dir<0 : p<q`, with `withSign(expandP, normal)` where expandP is true for union), so coincident faces expand under union and shrink under subtract/intersect rather than depending on operand order. DOCUMENTED (https://github.com/elalish/manifold/blob/master/src/shared.h, src/boolean3.cpp).
- Future-work ideas (ch. 9): offset sequences (+eps/2, -eps, +eps/2) to close gaps and slivers; Luby-style integer geometry (2D only); a topologically robust curved B-rep Boolean "seems unlikely", though rational Bezier edges might work in 2D (9.2.4). DOCUMENTED.

## Relevance for wonky

- This is the theoretical basis of candidate 1 in the bake-off (Manifold-style tagged mesh plus SoS) and underlies the leading hybrid (B-rep recovery from a tagged mesh). Reading the primary source rather than Manifold's code gives the proofs (Theorems 1-4) that show which parts must be exact and which may round. INFERRED.
- Bend fit: levels 0-3 are pure functions over (entity pair, lower-level results); no mutation, fork-join over a candidate pair list, uniform work per pair (fixed-size sums over triangle boundaries). Good fit for Bend and for GPU-uniform execution. INFERRED.
- Arithmetic: topology decisions need only comparisons of input coordinates and of interpolated values. Topology stays valid under any rounding; only geometric accuracy depends on u. For the concrete F32x2 derivation and the Metal hazards, see "Porting the chapter 8 bounds to F32x2 on Bend/Metal" below. INFERRED.
- SoS caveat from later work: Smith's shadow rule is a symbolic tie-break, so exactly coplanar or collinear input, which is common in CAD, resolves by axis order rather than intent. The trueform paper's box-divider example shows 2^4 = 16 SoS outcomes, of which only one gives the intended two domains (arXiv 2607.15905, Fig. "sos box divider"; see `trueform-polydera-and-sajovic-et-al-2026-uncertainty-aware-m.md`). Wonky should classify exact coincidences explicitly with multi-limb U32 predicates before any symbolic tie-break is used. INFERRED.
- Wonky's "explicit tolerances, explicit failure" principle: Smith's epsilon-tolerant definition (result = exact Boolean of eps-perturbed input) is a usable contract to state in the API, with eps derived from scale as in Manifold's `EpsilonFromScale(L,k) = (k+1) alpha`. INFERRED.
- Smoothing is the weak spot and conflicts with explicit failure: no termination proof, unbounded drift. Wonky should replace smoothing with either (a) exact predicates on input coordinates (multi-limb U32) to decide coplanar/collinear cases exactly, or (b) the B-rep recovery step of the hybrid, which re-derives faces from tags instead of merging by tolerance. INFERRED.
- Operand-order asymmetry (A union B != B union A) must be documented or replaced by Manifold's normal-based expand/shrink tie rule. INFERRED.

## Porting the chapter 8 bounds to F32x2 on Bend/Metal

Manifold publishes Smith's 2D constant (`alpha = sqrt(153) u L`, `EpsilonFromScale(L,k) = (k+1) alpha`, https://github.com/elalish/manifold/blob/master/docs/Boolean2.md). It publishes no bound for its 3D Boolean, and Smith himself does not analyze 3D accuracy. What follows is a worked template for wonky, INFERRED unless marked.

1. **Assumptions to restate.** Smith's tables 8.1-8.3 assume:
   - IEEE round-to-nearest, with each binary operation rounded once (eq. 8.5);
   - inputs exact;
   - L_X and L_Y powers of two;
   - all values in the normal range.
   - He uses the relative model `fl(x) = x(1+delta), |delta| < u` (eq. 8.3) for products and quotients, and the absolute model `|Delta| <= uL/2` (eq. 8.4) for sums. DOCUMENTED (TR 8.1-8.2).
2. **Double-word replaces u per operation, not uniformly.** Joldes-Muller-Popescu (TOMS 44(2) 2017, Table 1; local `tmp/research/pdf/joldes2017-hal.pdf`) prove these relative bounds with base-precision unit u (u = 2^-24 for F32 pairs). DOCUMENTED.
   - DW+DW (Alg. 6): 3u^2 + 13u^3.
   - DW*DW: 5u^2 with FMA (Alg. 12), 7u^2 without (Alg. 10).
   - DW/DW: 15u^2 + 56u^3 (Alg. 17), or 9.8u^2 with FMA (Alg. 18).
   - Never use the "sloppy" DW add (Alg. 5), which has no bound for mixed signs. DOCUMENTED.
   - Conservative uniform choice: u' = 16u^2 = 2^-44 ≈ 5.7e-14.
3. **Gain: first differences become exact.** A difference of two F32 input coordinates is exactly representable as a double-word (TwoSum). So the input rows of Smith's tables (dx_L, dx, dy) have zero error, and only the quotient lambda and the products after it carry u'. Redoing tables 8.1-8.3 with those rows set to 0 gives bounds at or below Smith's with u -> u'.
4. **Resulting tolerance.** Take Smith's alpha = 12.37 u' L as an upper envelope. With L = 2^10 mm (a 1 m bed), alpha is about 7e-10 mm. This is five or more orders of magnitude below FDM resolution, so an explicit wonky tolerance of 1e-6 mm stays conservative even after thousands of adjustments ((k_max+1) alpha). The unbounded k_max of the 2D sweep (8.4) still needs a runtime counter that fails explicitly past a cap.
5. **Metal hazards that void the analysis unless pinned.** DOCUMENTED (`tmp/research/pdf/msl-spec.txt`, MSL 4.1 §1.6 and §8.1-8.2):
   - The default math mode is "fast": reassociation and "FP contract to be fast". Error-free transforms and Smith's per-operation rounding assumption both break under reassociation. Use `-fmetal-math-mode=safe` (contract "on") plus `-ffp-contract=off`, or `#pragma METAL fp contract(off)`, except where FMA is used deliberately for TwoProd.
   - Geogram hit exactly this on Apple Silicon: clang contracted predicate code into FMAs, breaking its predicates. DOCUMENTED (https://github.com/BrunoLevy/geogram/issues/382).
   - Bend 2 already pins contraction. Its generated C/Metal template starts with `#pragma clang fp contract(off)`, Metal compiles with `opts.mathMode = MTLMathModeSafe`, and CUDA with `--fmad=false`. DOCUMENTED (`tmp/research/bend/bend2/comp.ts` L3324, L5020, L5162, commit ff7a40c 2026-09-22).
   - Bend exposes only `f32_add/sub/mul/div`: no FMA primitive, and `u32_mul` returns the low word only (JS `Math.imul`). So TwoProd must use Dekker/Veltkamp splitting (the no-FMA DW*DW bound is 7u^2, not 5u^2). Multi-limb integers need 16-bit half-limbs so that 16x16 -> 32 products are exact. The JS backend computes `Math.fround(a op b)` via binary64, which is still correctly rounded for + - * / because 53 >= 2*24 + 2. DOCUMENTED (comp.ts `OPERATIONS`); correctness of double rounding INFERRED from the standard p' >= 2p+2 result.
   - Denormals "may be flushed to zero". Smith's §8.5 argument that distinct values never subtract to zero relies on subnormals. Keep coordinates on a grid well inside the normal range, e.g. integers times 2^-k mm with |x| >= 2^-100, so no difference is subnormal.
   - "Either round ties to even or round toward zero rounding mode may be supported." TwoSum needs round-to-nearest. Add a startup self-test for RN, no FTZ on the used range, and no contraction, and refuse to run otherwise, in the style of Geogram's runtime flag checks (https://github.com/BrunoLevy/geogram/issues/391).
6. **Same discipline on the C backend.** Smith himself had to disable optimization to stop x87 80-bit registers changing results (TR 8.1, 7.6.3). DOCUMENTED.

## Manifold's realization of Smith's hierarchy (line map, local clone 36d0aab)

This is the only public implementation of the TR's 3D and 2D algorithms. It is Apache-2.0, so wonky may port it with attribution. Each row maps TR notation to code. All rows are DOCUMENTED from `tmp/research/manifold` at 36d0aab unless marked.

| TR concept | Manifold code | Notes |
|---|---|---|
| Interpolation with nearer endpoint (eqs. 4.2-4.6, table 7.2) | `src/shared.h` L68-83 `Interpolate(aL, aR, x)` | `useL = abs(x-aL.x) < abs(x-aR.x)`, `lambda = (useL ? dxL : dxR) / dLR.x`. If lambda or dLR is not finite, it returns `aL.yz` silently. |
| 2D crossing of two projected segments (level 2/3) | `src/shared.h` L89-111 `Intersect(aL,aR,bL,bR)` returns `(x, y, a.z, b.z)` | Nearer endpoint for lambda. For y it interpolates along the segment with the smaller `abs(dy)`. A non-finite lambda is replaced by 0. |
| Shadow rule, eq. 4.1 | `src/shared.h` L116 `Shadows(p,q,dir) = p==q ? dir<0 : p<q` | Ties are broken by a direction value, not by operand identity. |
| S01 / S10 (table 4.1 X01 plus the level-2 gate) | `src/boolean3.cpp` L53-83 `Shadow01<expandP, forward>` | The x-shadow tie direction is `withSign(expandP, vertNormal_a.x) - vertNormal_b.x`. The y gate uses the sum of the two adjacent face normals' y. |
| X11 | `src/boolean3.cpp` L85-152 `Kernel11<expandP>` | Four `Shadow01` calls, then `Intersect`, then a z-shadow gate. |
| X02 | `src/boolean3.cpp` L154-206 `Kernel02<expandP, forward>` | Sum of S01 over the triangle's 3 edges, then z by `Interpolate`, gated by `faceNormal_.z`. |
| X12 / X21 | `src/boolean3.cpp` L208-280 `Kernel12`, plus `Kernel12Recorder` L282 and `Intersect12` L337 | S02 at both edge ends plus the sum of S11 over the triangle edges. Driven by BVH collider pairs. |
| X03 (winding of A's vertices in B) | `src/boolean3.cpp` L387-460 `Winding03_` | See the paragraph below. |
| Operation constants (union, difference) | `src/boolean3.cpp` L475 `expandP_(op == OpType::Add)` | Coplanar faces grow under union and shrink under difference and intersection. |
| 2D alpha and eps budget (8.2, 8.4) | `src/boolean2.h` L36-37 `kU = 2^-53`, `kAlphaCoeff = 12.37`; `src/boolean2_predicates.cpp` L50-55 `EpsilonFromScale(L,k) = ldexp((k+1)*12.37*kU, exponent(L))` | `frexp` rounds L up to a power of two, which is Smith's L_X assumption. |
| Block rule 7.6.2 | `src/boolean2_sweep.cpp` L331-360 `ProcessEvent` | Scan from the bottom past strictly-UNDER edges and from the top past strictly-OVER edges. Every edge in between either ENDS at p or is "forced through p": emit `[e.l, p]`, re-enter `[p, e.r]`. |
| Reversal negates multiplicity (7.1.2 / 6.5) | `src/boolean2_sweep.cpp` L97 | |

`Winding03_` does not cast one ray per vertex:
1. A union-find joins the endpoints of every A edge that no B face crosses (L399-411).
2. X03 is evaluated only for one representative vertex per component. It uses `Kernel02` against B's faces from the collider, i.e. a vertical shadow ray (L437-450).
3. The result is flood-filled to the other vertices (L452-458).

The contribution is skipped when `z02` is not finite (L445). This is the same idea as one ray per patch in Cherchi 2022 and one segment per connected component in trueform. DOCUMENTED (code).

Where Manifold departs from the TR. DOCUMENTED (code), consequences INFERRED:
- **Tie direction is geometric.** Smith perturbs B by a fixed axis direction, which makes A∪B ≠ B∪A (TR 4.3). Manifold uses vertex and face normals as the perturbation direction, so the result depends on the operation, not on operand order. If the normal components are also equal, `Shadows` returns `p<q`, i.e. false: a deterministic but unexplained fall-through. A Bend port should make this third-level tie explicit, or decide it with an exact predicate.
- **Silent fallbacks where Smith has proofs.** Smith proves the interpolation denominators nonzero, since the shadow signs guarantee D+ ≥ 0 > D-. Manifold still guards `!isfinite` and substitutes an endpoint or `lambda = 0`, and `Winding03_` drops non-finite contributions. These guards only fire on degenerate input such as zero-length edges or NaNs. Under wonky's explicit-failure rule each one should become an error return. INFERRED.
- **Broad phase.** Manifold adds a BVH collider (`collider.h`, doc `docs/ParallelBVH.pdf`) that the TR lacks. This makes the hierarchy O((n + k) log n) in practice rather than O(nA·nB). DOCUMENTED (files present), complexity INFERRED.

For Bend: each `Kernel*` is a pure function of (entity pair, input arrays), with parallel `for_each` over collider pairs. That is a direct fork-join map. The two serial pieces are the union-find in `Winding03_` and the hash set of components. Replace them with a pure sort-based connected-components pass. INFERRED.

## Pointers worth porting or studying

1. Table 4.1 plus eq. 4.1: the full X/S recursion; ~10 formulas, each a small fixed-arity sum. Port directly as Bend functions.
2. Eqs. 4.2-4.6 interpolation with guaranteed nonzero denominator and nearer-endpoint choice; tables 7.1 and 7.2 (yAtX, interpolate) as the numeric kernels in F32x2.
3. Eqs. 4.17-4.20 generalized inclusion phi(a,b) for invalid input (gives defined output instead of crash).
4. Chapter 8 error-analysis template (tables 8.1-8.3, eqs. 8.14, 8.17-8.19) to redo for F32x2 arithmetic; produces wonky's documented alpha.
5. Section 7.6.2 block rule plus 7.6.1 downward-edge reversal for a 2D sketch/profile Boolean (wonky's sketch-level region Booleans). Manifold's `src/boolean2_sweep.cpp` `ProcessEvent` (L331-360) is an Apache-2.0 reference.
5a. Manifold `src/shared.h` L61-117 (`withSign`, `Interpolate`, `Intersect`, `Shadows`) and `src/boolean3.cpp` L53-460 (`Shadow01`, `Kernel11`, `Kernel02`, `Kernel12`, `Winding03_`). This is a compact, Apache-2.0, line-for-line reference of table 4.1 to transliterate into Bend; see the line map above.
6. Theorems 1-4 as the invariant list for property tests (facet boundary closure, shape boundary closure as integer half-edge counting).
7. Appendix A smoothing ops: study as a list of failure modes to detect and report, not as something to run silently.

## Verdict: adapt

Adapt, not adopt: the topologically robust X/S hierarchy, the interpolation scheme, the inclusion algebra and the 2D block-rule sweep are directly portable ideas and are proven to keep topology valid under any rounding, which matches Bend's F32x2 constraints and the fork-join model. The smoothing post-process should not be ported (no termination or accuracy guarantee, contradicts explicit failure); wonky should close the geometric gap with exact multi-limb U32 predicates for tie cases or with tag-based B-rep recovery, and re-derive Smith's chapter 8 bounds for F32x2.
